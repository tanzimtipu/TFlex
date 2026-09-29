import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
} from '@cantoo/pdf-lib';
import type {
  FormField,
  FormFieldKind,
  FormFieldOption,
  FormFieldRect,
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

function pdfFieldToKind(field: PDFField): FormFieldKind {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'listbox';
  return 'text';
}

function pdfFieldGetValue(field: PDFField): string | string[] {
  if (field instanceof PDFCheckBox) {
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
    const kind = pdfFieldToKind(field);
    const page = findFieldPage(pdfDoc, field);
    const rect = getFieldRect(pdfDoc, field, page);
    const value = pdfFieldGetValue(field);
    const options = pdfFieldGetOptions(field);
    const multi = pdfFieldGetMulti(field);

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

    result.push(formField);
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
    const name = field.getName();
    const page = findFieldPage(pdfDoc, field);
    const id = `form-${page}-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    if (id !== fieldId) continue;

    if (field instanceof PDFTextField) {
      const str = Array.isArray(value) ? value.join(', ') : value;
      field.setText(str);
      return;
    }
    if (field instanceof PDFCheckBox) {
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
        const kind = pdfFieldToKind(field);
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