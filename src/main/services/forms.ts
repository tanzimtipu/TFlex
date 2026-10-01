import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  type PDFField,
} from '@cantoo/pdf-lib';
import type {
  FormField,
  FormFieldKind,
  FormFieldOption,
  FormFieldRect,
  FormFieldWidget,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Form snapshot for undo (DEF-028: flatten+undo must restore form fields)
// ---------------------------------------------------------------------------

/** Rich snapshot of a single form field, containing enough data to recreate
 *  the field from scratch on the pdfDoc after flatten has destroyed it. */
export interface FormSnapshotEntry {
  name: string;
  kind: FormFieldKind;
  pageIndex: number; // 0-based original page index in the pdfDoc
  rect: FormFieldRect;
  value: string | string[];
  options?: FormFieldOption[];
  multi?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** /Ff bit 1 — the ReadOnly flag (PDF 32000-1 Table 227). */
const READONLY_FLAG = 1;

/** Number of widget annotations a field carries. A button field with more
 *  than one widget is an option GROUP (radio-like), not a single check box. */
export function formFieldWidgetCount(field: PDFField): number {
  try {
    return field.acroField.getWidgets().length;
  } catch {
    return 0;
  }
}

/** True for a button field (check box OR radio group). */
export function isButtonField(field: PDFField): boolean {
  return field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
}

/** Phase 59 item 4 — /Ff bit 1 (ReadOnly). */
export function formFieldReadOnly(field: PDFField): boolean {
  try {
    return (field.acroField.getFlags() & READONLY_FLAG) !== 0;
  } catch {
    return false;
  }
}

/** True for a digital signature field (/FT /Sig). */
export function isSignatureField(field: PDFField): boolean {
  if (field instanceof PDFSignature) return true;
  try {
    return (field.acroField as { FT?: () => PDFName }).FT?.()?.toString() === '/Sig';
  } catch {
    return false;
  }
}

/** Decode a PDF name object to its bare token (no leading '/'). */
export function nameToken(value: unknown): string {
  try {
    const text = (value as { asString?: () => string })?.asString?.();
    if (typeof text === 'string') return text.replace(/^\//, '');
  } catch {
    // fall through
  }
  return '';
}

/** Decode a PDF number object to a JS number (0 when absent). */
export function numberFrom(value: unknown): number {
  try {
    const n = (value as { asNumber?: () => number })?.asNumber?.();
    if (typeof n === 'number') return n;
  } catch {
    // fall through
  }
  return 0;
}

/** The on-state name of one widget (the non-Off key of its /AP /N). */
export function widgetOnValue(widget: { getOnValue?: () => unknown; dict: { get: (n: PDFName) => unknown } }): string {
  try {
    const on = widget.getOnValue?.();
    const token = nameToken(on);
    if (token !== '') return token;
  } catch {
    // fall through — read the /AP /N dict directly.
  }
  try {
    const ap = widget.dict.get(PDFName.of('AP')) as { get: (n: PDFName) => unknown } | undefined;
    const n = ap?.get?.(PDFName.of('N')) as { keys?: () => unknown[]; get: (n: PDFName) => unknown } | undefined;
    const keys = n?.keys?.() ?? [];
    for (const key of keys) {
      const token = nameToken(key);
      if (token !== '' && token !== 'Off') return token;
    }
  } catch {
    // No on-state discoverable.
  }
  return '';
}

/** The field's current button value as its on-state string (or ''). */
export function buttonGroupValue(field: PDFField): string {
  try {
    if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
    const raw = (field.acroField as unknown as { V?: () => unknown }).V?.();
    return nameToken(raw);
  } catch {
    return '';
  }
}

/** The distinct on-state option values of a multi-widget button group. */
function buttonGroupOptions(field: PDFField): FormFieldOption[] {
  const seen = new Set<string>();
  const options: FormFieldOption[] = [];
  for (const widget of field.acroField.getWidgets()) {
    const value = widgetOnValue(widget as unknown as { getOnValue?: () => unknown; dict: { get: (n: PDFName) => unknown } });
    if (value === '' || value === 'Off' || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: value });
  }
  return options;
}

/** Phase 59 item 4 — kind. A button field with more than one widget is a
 *  `radio` group even when the PDF has no Radio bit set (pdf-lib models it
 *  as a PDFCheckBox). A genuine single check box stays a `checkbox`. */
export function formFieldKind(field: PDFField): FormFieldKind {
  // DEF-423 — a digital-signature field (/FT /Sig) is not fillable. Classify
  // it as its own kind so the renderer's fillable allow-list rejects it
  // instead of mounting an editable text control whose value is discarded.
  // `signature` is deliberately outside the `FormFieldKind` union: the
  // renderer's `isFillableFieldKind` is an allow-list over a widened `string`
  // and its own tests cast this kind, so an unfillable kind never needs to be
  // in the union (adding it there would break the renderer's exhaustive
  // switches, which are reached only for fillable kinds).
  if (isSignatureField(field)) return 'signature' as FormFieldKind;
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) {
    return formFieldWidgetCount(field) > 1 ? 'radio' : 'checkbox';
  }
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'listbox';
  return 'text';
}

/** The stable field id used by `getFormFields` / `fillFormField`. */
export function formFieldId(pdfDoc: PDFDocument, field: PDFField): string {
  const page = findFieldPage(pdfDoc, field);
  return `form-${page}-${field.getName().replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Phase 59 item 4 — select one option of a multi-widget button GROUP.
 *
 * `PDFCheckBox.check()` only ever writes the FIRST widget's on-value into
 * /V, so every other option is unreachable through the typed API. The PDF
 * model is field-level: `/V` names the chosen on-state and each widget's
 * `/AS` names its own visual state. This sets `/V` on the field's acro dict
 * and `/AS` on every widget (Off for the ones not chosen), which is what an
 * independent reader reads back. An unknown option name leaves the field
 * untouched. `'true'`/`'false'` are accepted as a legacy convenience: true
 * selects the first widget's on-value, false clears every widget to Off.
 *
 * Returns true when the field was written and false when the option is not
 * one of the widgets' on-states (nothing changed) — so a caller can report a
 * truthful status instead of claiming a fill that never happened (ADV-126).
 */
export function setButtonGroupValue(field: PDFCheckBox, value: string): boolean {
  const acro = field.acroField as unknown as {
    dict: { set: (n: PDFName, v: unknown) => void };
    getWidgets: () => Array<{ dict: { get: (n: PDFName) => unknown }; setAppearanceState?: (n: PDFName) => void }>;
  };
  const widgets = acro.getWidgets();
  const onValues: string[] = [];
  for (const widget of widgets) {
    const on = widgetOnValue(widget);
    if (on !== '' && on !== 'Off') onValues.push(on);
  }

  let chosen = value;
  if (value === 'true') chosen = onValues.length > 0 ? onValues[0] : '';
  if (value === 'false') chosen = '';
  if (chosen !== '' && !onValues.includes(chosen)) return false;

  acro.dict.set(PDFName.of('V'), PDFName.of(chosen === '' ? 'Off' : chosen));
  for (const widget of widgets) {
    const on = widgetOnValue(widget);
    const state = chosen !== '' && on === chosen ? chosen : 'Off';
    try {
      widget.setAppearanceState?.(PDFName.of(state));
    } catch {
      // A widget with no appearance dictionary still keeps its /V.
    }
  }
  return true;
}

function pdfFieldGetValue(field: PDFField): string | string[] {
  if (field instanceof PDFCheckBox) {
    // A multi-widget button is an option group: report the selected on-state
    // string rather than a boolean, so the renderer can pick any option.
    if (formFieldWidgetCount(field) > 1) return buttonGroupValue(field);
    try {
      return field.isChecked() ? 'true' : 'false';
    } catch {
      return 'false';
    }
  }
  if (field instanceof PDFOptionList) {
    try {
      return field.getSelected();
    } catch {
      return [];
    }
  }
  if (field instanceof PDFRadioGroup) {
    try {
      return field.getSelected() ?? '';
    } catch {
      return '';
    }
  }
  if (field instanceof PDFDropdown) {
    try {
      const selected = field.getSelected();
      // pdf-lib may return string or string[] depending on version
      if (Array.isArray(selected)) {
        return selected.length > 0 ? selected[0] : '';
      }
      return selected ?? '';
    } catch {
      return '';
    }
  }
  if (field instanceof PDFTextField) {
    try {
      return field.getText() ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

function pdfFieldGetOptions(field: PDFField): FormFieldOption[] | undefined {
  if (field instanceof PDFCheckBox && formFieldWidgetCount(field) > 1) {
    const options = buttonGroupOptions(field);
    return options.length > 0 ? options : undefined;
  }
  if (field instanceof PDFRadioGroup) {
    try {
      return field.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      return undefined;
    }
  }
  if (field instanceof PDFDropdown) {
    try {
      return field.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      return undefined;
    }
  }
  if (field instanceof PDFOptionList) {
    try {
      return field.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pdfFieldGetMulti(field: PDFField): boolean | undefined {
  if (field instanceof PDFOptionList) {
    try {
      return field.isMultiselect();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolve a widget/annotation `/P` page reference to a 0-based page index by
 * comparing it against each page's own ref. Returns -1 when the ref is absent
 * or does not match any page.
 */
function pageIndexByRef(pdfDoc: PDFDocument, pageRef: unknown): number {
  if (!pageRef || typeof (pageRef as { tag?: unknown }).tag !== 'string') return -1;
  const tag = (pageRef as { tag: string }).tag;
  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    if (pdfDoc.getPage(p).ref?.tag === tag) return p;
  }
  return -1;
}

/**
 * Find the 0-based page index for a field. Every widget carries its own `/P`
 * page reference; `acroField.getWidgets()` returns the widget dicts for both
 * field shapes pdf-lib models:
 *   - merged field/widget: the field dict IS the widget (no `/Kids`), and
 *     `getWidgets()` returns `[the field dict]`;
 *   - `/Kids`-style terminal: `getWidgets()` returns the kid widgets.
 * Resolving `/P` off those widget dicts covers both. `/Parent`-style widgets
 * (annotation in a page's `/Annots` carrying `/Parent` instead of `/P`) are
 * handled by the page-scan fallback below.
 */
function findFieldPage(pdfDoc: PDFDocument, field: PDFField): number {
  const acro = field.acroField as any;

  // Path 1: each widget's own /P reference.
  try {
    const widgets: any[] = acro.getWidgets?.() ?? [];
    for (const widget of widgets) {
      try {
        const pageRef = widget?.dict?.get?.(PDFName.of('P'));
        const idx = pageIndexByRef(pdfDoc, pageRef);
        if (idx >= 0) return idx;
      } catch {
        // Try the next widget.
      }
    }
  } catch {
    // Fall through to the page scan.
  }

  // Path 2 (fallback): scan every page's /Annots for widget annotations
  // whose /Parent matches the field's ref. Use page.node.get() which
  // returns the raw PDFArray (no type argument needed).
  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    try {
      const pageNode: any = (pdfDoc.getPage(p) as any).node;
      const annots = pageNode?.get?.(PDFName.of('Annots'));
      if (!annots || typeof annots.size !== 'function') continue;
      for (let i = 0; i < annots.size(); i++) {
        const aRef = annots.get(i);
        if (!aRef || typeof aRef.tag !== 'string') continue;
        let aObj: any;
        try {
          aObj = pdfDoc.context.lookup(aRef);
        } catch {
          continue;
        }
        const parentRef = aObj?.dict?.get?.(PDFName.of('Parent'));
        if (parentRef && typeof parentRef.tag === 'string' && field.ref) {
          if (parentRef.tag === field.ref.tag) {
            return p;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return 0;
}

/**
 * Extract the widget rect from a field. Uses the acro field's getWidgets()
 * because widget annotations carry the actual /Rect. Returns the last
 * non-empty rect found, or a 0-rect fallback.
 *
 * pdf-lib reports /Rect with a BOTTOM-LEFT origin; the FormFieldRect contract
 * is TOP-LEFT, so `y` is flipped here (`pageHeight - y - height`).
 */
function getFieldRect(
  pdfDoc: PDFDocument,
  field: PDFField,
  pageIndex: number,
): FormFieldRect {
  try {
    const acro = field.acroField;

    // Walk widget annotations — they carry the /Rect.
    const widgets = acro.getWidgets();
    if (widgets && widgets.length > 0) {
      let lastRect: FormFieldRect | null = null;
      for (const widget of widgets) {
        try {
          const r = widget.getRectangle();
          if (r.width > 0 || r.height > 0) {
            lastRect = { x: r.x, y: r.y, width: r.width, height: r.height };
          }
        } catch {
          continue;
        }
      }
      if (lastRect) {
        let pageHeight = 0;
        try {
          pageHeight = pdfDoc.getPage(pageIndex).getHeight();
        } catch {
          pageHeight = 0;
        }
        return {
          x: lastRect.x,
          y: pageHeight - lastRect.y - lastRect.height,
          width: lastRect.width,
          height: lastRect.height,
        };
      }
    }
  } catch {
    // Fall through
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Phase 59 item 4 — per-widget descriptors for a multi-widget button group:
 * every widget's own rect (top-left FormFieldRect), its on-state value and
 * whether that on-state is the field's current /V. Returns undefined for
 * every non-group kind so single check boxes keep their boolean value.
 */
function getFieldWidgets(pdfDoc: PDFDocument, field: PDFField): FormFieldWidget[] | undefined {
  if (!isButtonField(field) || formFieldWidgetCount(field) <= 1) return undefined;
  const current = buttonGroupValue(field);
  const widgets: FormFieldWidget[] = [];
  for (const widget of field.acroField.getWidgets()) {
    let pageIndex: number;
    try {
      pageIndex = pageIndexByRef(pdfDoc, widget.dict.get(PDFName.of('P')));
    } catch {
      pageIndex = -1;
    }
    if (pageIndex < 0) pageIndex = findFieldPage(pdfDoc, field);

    let rect: FormFieldRect = { x: 0, y: 0, width: 0, height: 0 };
    try {
      const r = widget.getRectangle();
      let pageHeight = 0;
      try {
        pageHeight = pdfDoc.getPage(pageIndex).getHeight();
      } catch {
        pageHeight = 0;
      }
      rect = { x: r.x, y: pageHeight - r.y - r.height, width: r.width, height: r.height };
    } catch {
      // Degenerate widget — keep the zero rect.
    }

    const value = widgetOnValue(widget as unknown as { getOnValue?: () => unknown; dict: { get: (n: PDFName) => unknown } });
    widgets.push({ value, rect, selected: value !== '' && value === current });
  }
  return widgets;
}

/** Phase 59 item 4 — a widget annotation reachable from a page /Annots but
 *  NOT from the AcroForm /Fields tree. Orphan widgets cannot be reached by
 *  pdf-lib's form API, so they are listed for diagnostics and reported as
 *  `orphan-unfilled` by a native fill instead of being dropped silently. */
export interface OrphanWidgetInfo {
  pageIndex: number; // 0-based
  name: string;
  kind: FormFieldKind;
  rect: FormFieldRect;
  value: string;
  readOnly: boolean;
}

/** Decode a /T or /V value (PDFString, PDFHexString or PDFName) to text. */
function decodeTextObject(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    const text = (value as { decodeText?: () => string }).decodeText?.();
    if (typeof text === 'string') return text;
  } catch {
    // fall through
  }
  return nameToken(value);
}

function orphanKindFor(dict: { get: (n: PDFName) => unknown }): FormFieldKind {
  const ft = nameToken(dict.get(PDFName.of('FT')));
  if (ft === 'Btn') return 'checkbox';
  if (ft === 'Ch') return 'dropdown';
  return 'text';
}

/** Scan every page /Annots for /Widget annotations not reachable from the
 *  AcroForm /Fields tree. Order: page order, then /Annots order. */
export function findOrphanWidgets(pdfDoc: PDFDocument): OrphanWidgetInfo[] {
  const result: OrphanWidgetInfo[] = [];
  let formFields: PDFField[] = [];
  try {
    formFields = pdfDoc.getForm().getFields();
  } catch {
    return result;
  }
  const reachable = new Set<unknown>();
  const fieldNames = new Set<string>();
  for (const field of formFields) {
    try {
      for (const widget of field.acroField.getWidgets()) reachable.add(widget.dict);
    } catch {
      // A malformed field contributes no reachable widgets.
    }
    try {
      const partial = (field.acroField as unknown as { getPartialName?: () => string | undefined })
        .getPartialName?.();
      if (partial) fieldNames.add(partial);
    } catch {
      // fall through to the fully qualified name
    }
    try {
      fieldNames.add(field.getName());
    } catch {
      // A field with no name cannot dedupe anything.
    }
  }

  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    const pageNode = (pdfDoc.getPage(p) as unknown as { node: { get: (n: PDFName) => unknown } }).node;
    let annots: PDFArray;
    try {
      const raw = pdfDoc.context.lookupMaybe(pageNode.get(PDFName.of('Annots')) as never, PDFArray);
      if (raw === undefined) continue;
      annots = raw;
    } catch {
      continue;
    }
    for (let i = 0; i < annots.size(); i++) {
      let dict: PDFDict;
      try {
        const resolved = pdfDoc.context.lookupMaybe(annots.get(i) as never, PDFDict);
        if (resolved === undefined) continue;
        dict = resolved;
      } catch {
        continue;
      }
      if (nameToken(dict.get(PDFName.of('Subtype'))) !== 'Widget') continue;
      if (reachable.has(dict)) continue;

      // A stale duplicate of a listed field is not an orphan: e.g. a merge
      // copies the source page's widgets AND recreates the field, so the
      // copied widget's /Parent still names a field that IS in the tree.
      // Skip any widget whose own /T or /Parent /T matches a listed field.
      const ownT = decodeTextObject(dict.get(PDFName.of('T')));
      const parentValue = dict.get(PDFName.of('Parent'));
      const parentDict = parentValue instanceof PDFRef
        ? pdfDoc.context.lookupMaybe(parentValue, PDFDict)
        : parentValue instanceof PDFDict
          ? parentValue
          : undefined;
      const parentT = parentDict !== undefined ? decodeTextObject(parentDict.get(PDFName.of('T'))) : '';
      if ((ownT !== '' && fieldNames.has(ownT)) || (parentT !== '' && fieldNames.has(parentT))) {
        continue;
      }

      const nameText = ownT;
      const name = nameText !== '' ? nameText : `orphan-${p + 1}-${result.length + 1}`;
      const rect = widgetRectFromDict(pdfDoc, p, dict);
      result.push({
        pageIndex: p,
        name,
        kind: orphanKindFor(dict),
        rect,
        value: decodeTextObject(dict.get(PDFName.of('V'))),
        readOnly: (numberFrom(dict.get(PDFName.of('Ff'))) & READONLY_FLAG) !== 0,
      });
    }
  }
  return result;
}

/** Rect of a raw widget dict, flipped to the top-left FormFieldRect space. */
function widgetRectFromDict(
  pdfDoc: PDFDocument,
  pageIndex: number,
  dict: { get: (n: PDFName) => unknown },
): FormFieldRect {
  try {
    const arr = pdfDoc.context.lookupMaybe(dict.get(PDFName.of('Rect')) as never, PDFArray);
    if (arr === undefined || arr.size() < 4) return { x: 0, y: 0, width: 0, height: 0 };
    const x = numberFrom(arr.get(0));
    const y = numberFrom(arr.get(1));
    const x2 = numberFrom(arr.get(2));
    const y2 = numberFrom(arr.get(3));
    let pageHeight = 0;
    try {
      pageHeight = pdfDoc.getPage(pageIndex).getHeight();
    } catch {
      pageHeight = 0;
    }
    return { x, y: pageHeight - y2, width: x2 - x, height: y2 - y };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the 0-based page index for a field by walking the page tree and
 * matching the page reference stored in the field widget's /P entry.
 * Exported for use by serializeDoc to migrate form fields.
 */
export { findFieldPage };

/**
 * Read all fillable AcroForm fields from a PDFDocument and return them as
 * a flat array of FormField descriptors.
 */
export function getFormFields(pdfDoc: PDFDocument): FormField[] {
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const result: FormField[] = [];

  for (const field of fields) {
    const name = field.getName();
    const kind = formFieldKind(field);
    const page = findFieldPage(pdfDoc, field);
    const rect = getFieldRect(pdfDoc, field, page);
    const value = pdfFieldGetValue(field);
    const options = pdfFieldGetOptions(field);
    const multi = pdfFieldGetMulti(field);
    const widgets = getFieldWidgets(pdfDoc, field);

    // Generate a stable id from field name + page number
    const id = `form-${page}-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const formField: FormField = {
      id,
      name,
      page: page + 1, // 1-based
      kind,
      rect,
      value,
    };

    if (options !== undefined) {
      formField.options = options;
    }
    if (multi !== undefined) {
      formField.multi = multi;
    }
    if (widgets !== undefined) {
      formField.widgets = widgets;
    }
    if (formFieldReadOnly(field)) {
      formField.readOnly = true;
    }
    if (field instanceof PDFButton) {
      formField.pushButton = true;
    }
    if (isSignatureField(field)) {
      // DEF-423 — second signal alongside `kind: 'signature'`: a fill against
      // this field silently no-ops, so it must never look fillable.
      (formField as FormField & { fillable?: boolean }).fillable = false;
    }

    result.push(formField);
  }

  // Phase 59 item 4 — orphan sweep: page widgets not reachable from the
  // AcroForm /Fields tree are listed (not dropped silently) so diagnostics
  // and a native fill can report them.
  try {
    for (const orphan of findOrphanWidgets(pdfDoc)) {
      const id = `orphan-${orphan.pageIndex}-${orphan.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const formField: FormField = {
        id,
        name: orphan.name,
        page: orphan.pageIndex + 1,
        kind: orphan.kind,
        rect: orphan.rect,
        value: orphan.value,
      };
      // ADV-124 / DEF-424 — an orphan widget has no field in the AcroForm tree,
      // so it can never be written through the form API. Expose it as
      // read-only (never an editable control) while keeping its `orphan-` id
      // so the UI and the fill report can tell it apart from a real field.
      formField.readOnly = true;
      result.push(formField);
    }
  } catch {
    // Best-effort diagnostics; a malformed /Annots array is skipped.
  }

  return result;
}

/**
 * Fill a form field value. The field is identified by its `id` (the stable
 * id generated by `getFormFields`). The `value` must match the field kind.
 */
export function fillFormField(
  pdfDoc: PDFDocument,
  fieldId: string,
  value: string | string[],
): void {
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  // Resolve field id back to field name
  for (const field of fields) {
    if (formFieldId(pdfDoc, field) !== fieldId) continue;

    if (field instanceof PDFTextField) {
      const str = Array.isArray(value) ? value.join(', ') : value;
      field.setText(str);
      return;
    }
    if (field instanceof PDFCheckBox) {
      // Phase 59 item 4 — a multi-widget button is an option group whose
      // non-first options the typed check()/uncheck() API cannot reach.
      if (formFieldWidgetCount(field) > 1) {
        setButtonGroupValue(field, Array.isArray(value) ? value[0] : value);
        return;
      }
      const checked = Array.isArray(value) ? value[0] === 'true' : value === 'true';
      if (checked) {
        field.check();
      } else {
        field.uncheck();
      }
      return;
    }
    if (field instanceof PDFRadioGroup) {
      const str = Array.isArray(value) ? value[0] : value;
      if (str) {
        field.select(str);
      }
      return;
    }
    if (field instanceof PDFDropdown) {
      const str = Array.isArray(value) ? value[0] : value;
      if (str) {
        field.select(str);
      }
      return;
    }
    if (field instanceof PDFOptionList) {
      const vals = Array.isArray(value) ? value : [value];
      field.clear();
      for (const v of vals) {
        if (v) {
          try {
            field.select(v);
          } catch {
            // Option not found — skip
          }
        }
      }
      return;
    }
  }
}

/**
 * Flatten all form fields — bake their current appearances into page content
 * and remove the AcroForm dictionary and field annotations.
 */
export function flattenForm(pdfDoc: PDFDocument): void {
  const form = pdfDoc.getForm();
  form.flatten();
}

// ---------------------------------------------------------------------------
// Form snapshot for undo: capture enough data to rebuild fields from scratch
// ---------------------------------------------------------------------------

/**
 * Capture a deep snapshot of all form fields so they can be recreated
 * after flatten destroys the AcroForm dictionary. Returns undefined when
 * the document has no form or no fields.
 */
export function snapshotAllFormFields(pdfDoc: PDFDocument): FormSnapshotEntry[] | undefined {
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    if (fields.length === 0) return undefined;

    const entries: FormSnapshotEntry[] = [];
    for (const field of fields) {
      try {
        const name = field.getName();
        const kind = formFieldKind(field);
        const page = findFieldPage(pdfDoc, field);
        const rect = getFieldRect(pdfDoc, field, page);
        const value = pdfFieldGetValue(field);
        const options = pdfFieldGetOptions(field);
        const multi = pdfFieldGetMulti(field);

        entries.push({
          name,
          kind,
          pageIndex: page,
          rect,
          value,
          options,
          multi,
        });
      } catch {
        // Skip unreadable fields
      }
    }
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Restore form fields from a snapshot. If the form currently has fields
 * (was not flattened), this just restores values via fillFormField. If the
 * form is empty (post-flatten), this recreates all fields from scratch using
 * pdf-lib's form creation API.
 */
export function restoreFormFieldsFromSnapshot(
  pdfDoc: PDFDocument,
  entries: FormSnapshotEntry[],
): void {
  try {
    const existingFields = pdfDoc.getForm().getFields();

    if (existingFields.length > 0) {
      // Form still exists — just restore values
      for (const entry of entries) {
        const id = `form-${entry.pageIndex}-${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        try {
          fillFormField(pdfDoc, id, entry.value);
        } catch {
          // Field name mismatch or page changed — skip
        }
      }
      return;
    }

    // Form was destroyed (flattened) — rebuild from scratch
    const form = pdfDoc.getForm();
    for (const entry of entries) {
      try {
        const page = pdfDoc.getPage(entry.pageIndex);
        const name = entry.name;
        // DEF-403: restore the captured widget geometry. entry.rect is in the
        // FormFieldRect UI space (TOP-LEFT origin; see getFieldRect), while
        // addToPage/addOptionToPage expect PDF user space (BOTTOM-LEFT), so
        // flip y back. Keep today's default-rect behaviour when the captured
        // rect is degenerate (a zero-size box would be rejected).
        const box = entry.rect.width > 0 && entry.rect.height > 0
          ? {
              x: entry.rect.x,
              y: page.getHeight() - entry.rect.y - entry.rect.height,
              width: entry.rect.width,
              height: entry.rect.height,
            }
          : undefined;

        switch (entry.kind) {
          case 'text': {
            const f = form.createTextField(name);
            f.setText(typeof entry.value === 'string' ? entry.value : '');
            f.addToPage(page, box);
            break;
          }
          case 'checkbox': {
            const f = form.createCheckBox(name);
            if (entry.value === 'true') f.check();
            f.addToPage(page, box);
            break;
          }
          case 'radio': {
            const f = form.createRadioGroup(name);
            if (entry.options && entry.options.length > 0) {
              for (const opt of entry.options) {
                f.addOptionToPage(opt.value, page, box);
              }
            }
            const sel = typeof entry.value === 'string' ? entry.value
              : (Array.isArray(entry.value) && entry.value.length > 0 ? entry.value[0] : '');
            if (sel) {
              try { f.select(sel); } catch { /* option not found */ }
            }
            break;
          }
          case 'dropdown': {
            const f = form.createDropdown(name);
            if (entry.options && entry.options.length > 0) {
              f.addOptions(entry.options.map((o) => o.value));
            }
            f.addToPage(page, box);
            const sel = typeof entry.value === 'string' ? entry.value
              : (Array.isArray(entry.value) && entry.value.length > 0 ? entry.value[0] : '');
            if (sel) {
              try { f.select(sel); } catch { /* option not found */ }
            }
            break;
          }
          case 'listbox': {
            const f = form.createOptionList(name);
            if (entry.options && entry.options.length > 0) {
              f.addOptions(entry.options.map((o) => o.value));
            }
            f.addToPage(page, box);
            const vals = Array.isArray(entry.value) ? entry.value : [entry.value as string];
            for (const v of vals) {
              if (v) {
                try { f.select(v); } catch { /* option not found */ }
              }
            }
            break;
          }
        }
      } catch {
        // Skip fields that fail to recreate
      }
    }
  } catch {
    // Best-effort restore — ignore errors
  }
}