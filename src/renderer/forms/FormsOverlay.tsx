// Per-page forms layer.
//
// Renders the fillable editors for every AcroForm field on a given page.
// The overlay sits on top of PageView at the same z-index as the annotation
// layer (z-index: 2) and never blocks selection in the underlying text
// layer (pointer-events: none on the wrapping container; individual
// editors opt back in).
//
// Editors by field kind:
//   text      -> <input> or <textarea> (multi-line when rect.height > 24pt)
//   checkbox  -> custom checkbox toggle (input type=checkbox would inherit
//                OS chrome that fights our dark-mode styles)
//   radio     -> one radio swatch per option, labelled, single-select
//   dropdown  -> <select> with the field's options
//   listbox   -> multi-select list of options
//
// Editors are placed in page-point coords; the overlay multiplies by
// cssScale to size them on screen. Click-outside blurs an editor without
// dispatching a fillFormField (the debounce in App handles that).

import { useMemo, type ReactElement } from "react";
import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../icons/Icon";
import type { FormField, FormFieldRect, FormFillReport } from "../../shared/types";
import { isFillableFieldKind, nonFillableFieldReason, reportStatusReason } from "./model";
import { FormFieldControl } from "./FormFieldControl";

// Phase 59 item 4 — the truthful read-only reason now lives with the shared
// value control and is re-exported here for existing importers.
export { READ_ONLY_REASON } from "./FormFieldControl";

interface FormsOverlayProps {
  page: number;
  cssScale: number;
  fields: FormField[];
  onValueChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
  /** Phase 65 item 4 (DEF-438) — the page's clockwise quarter-turn rotation
   *  (0..3) and its UNROTATED page-point dims. Widget rects are mapped through
   *  `mapRectForRotation` before placement so every control sits on its printed
   *  box on a rotated page. Defaults keep the unrotated mount unchanged. */
  rotation?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  /** Phase 115 E - the field linked to the Guided Fill panel's focused row.
   *  Its editor is highlighted with `data-form-focused`; no focus is moved. */
  focusedFieldId?: string | null;
  /** Phase 115 E - reports that a canvas editor gained focus. Never moves
   *  focus; the host only records the id. */
  onFieldFocus?: (id: string) => void;
}

// Minimum editor height so a 1-line text field doesn't collapse to a
// single pixel of hit area when the AcroForm author left a tight rect.
const MIN_EDITOR_HEIGHT_PT = 14;
const CHECKBOX_BOX_PT = 12;
const RADIO_DOT_PT = 11;

/** Phase 94 — the two marks this overlay draws, routed through the shared
 *  `Icon` wrapper (no hand-declared inline SVG element). Declared as a typed
 *  record of Lucide components, mirroring `STAGE_ICONS` in
 *  `components/StageRail.tsx`. */
const MARK_ICONS: Record<"check" | "close", LucideIcon> = {
  check: Check,
  close: X,
};

export function FormsOverlay(props: FormsOverlayProps): ReactElement | null {
  const {
    page,
    cssScale,
    fields,
    onValueChange,
    onToggleListbox,
    rotation = 0,
    pageWidthPt = 0,
    pageHeightPt = 0,
    focusedFieldId = null,
    onFieldFocus,
  } = props;
  const pageFields = useMemo(() => fields.filter((f) => f.page === page), [fields, page]);
  // Phase 65 item 4 (DEF-436) — PER-FIELD degenerate-rect fallback. The
  // previous heuristic looked at the whole page: if ANY field had a zero
  // rect it restacked EVERY editor down the left margin, which piled a
  // well-formed form's controls on top of each other. A usable rect is now
  // rendered at its own `field.rect`; only a genuinely degenerate rect
  // (non-finite or non-positive width/height) gets a sensible default box.
  // Degenerate boxes are staggered by index so several of them never
  // overlap, and each keeps a positive width/height so it always has a
  // visible, hit-testable surface — never an invisible one.
  //
  // The memo runs unconditionally so the hook count stays stable across
  // renders (an early return before a later hook is the DEF-020 "rendered
  // fewer hooks than expected" cascade). It only iterates the already
  // filtered pageFields, so it is cheap.
  const fallbackRects = useMemo(() => {
    const out = new Map<string, FormFieldRect>();
    let degenerateIndex = 0;
    for (const f of pageFields) {
      if (isUsableRect(f.rect)) continue;
      const height =
        f.kind === "listbox" ? 80 :
        f.kind === "radio" ? 32 :
        24;
      out.set(f.id, { x: 36, y: 24 + degenerateIndex * (height + 8), width: 240, height });
      degenerateIndex += 1;
    }
    return out;
  }, [pageFields]);
  // Early return AFTER all hooks have run. With `pageFields.length === 0`
  // (the post-flatten case where the AcroForm is gone), there's nothing
  // to render; the host still keeps the overlay mounted in the React tree
  // so a subsequent re-fill round-trip re-pops the editors in place.
  if (pageFields.length === 0) return null;
  return (
    <div className="forms-layer" data-page={page}>
      {pageFields.map((field) => {
        const fallback = fallbackRects.get(field.id);
        const renderField: FormField =
          fallback === undefined ? field : { ...field, rect: fallback };
        // DEF-438 — ONE mapping applied here, per field AND per widget, so
        // every editor kind below consumes an already-rotated rect. The raw
        // rect is never read by a placement math site.
        const mappedField = mapFieldForRotation(
          renderField,
          rotation,
          pageWidthPt,
          pageHeightPt,
        );
        return (
          <FieldEditor
            key={field.id}
            field={mappedField}
            cssScale={cssScale}
            onValueChange={onValueChange}
            onToggleListbox={onToggleListbox}
            focused={field.id === focusedFieldId}
            onFocus={
              onFieldFocus === undefined ? undefined : (): void => onFieldFocus(field.id)
            }
          />
        );
      })}
    </div>
  );
}

/** A rect is usable when it is finite and strictly positive in both
 *  dimensions; only then can an editor be positioned at page coords. */
function isUsableRect(rect: FormFieldRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

interface FieldEditorProps {
  field: FormField;
  cssScale: number;
  onValueChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
  /** Phase 115 E - true when this editor is the panel-linked field. */
  focused?: boolean;
  /** Phase 115 E - reports focus upward; never moves focus. */
  onFocus?: () => void;
}

function FieldEditor(props: FieldEditorProps): ReactElement | null {
  const { field, cssScale, onValueChange, onToggleListbox } = props;
  // Phase 65 chunk 2 (driver TFL-49 / DEF-436) — the SINGLE suppression gate.
  // With `annotationMode: AnnotationMode.ENABLE_FORMS` pdf.js sets
  // `hasOwnCanvas` — i.e. it keeps painting the widget's own /AP appearance
  // onto the canvas — ONLY for:
  //   - TextWidgetAnnotation (`readOnly && !noHTML`),
  //   - the push-button branch of ButtonWidgetAnnotation,
  //   - SignatureWidgetAnnotation.
  // Checkbox, radio and choice widgets NEVER set `hasOwnCanvas`, so pdf.js
  // does NOT canvas-paint them even when read-only. For those, the overlay
  // editor is the ONLY surface (not a duplicate), and suppressing it would
  // make a read-only control completely invisible (DEF-444).
  //
  //   - `kind === "signature"`: always canvas-painted -> suppress.
  //   - push buttons (`field.pushButton`): the push-button branch of
  //     ButtonWidgetAnnotation is canvas-painted -> suppress.
  //   - `readOnly === true` on a REAL TEXT field (a real field id is never
  //     `orphan-…`) -> canvas-painted -> suppress.
  //   - a read-only checkbox / radio / dropdown / listbox is NOT canvas-painted
  //     -> fall through and render its disabled overlay control.
  //
  // An orphan widget keeps its existing `NonFillableView` surface: its id
  // starts with `orphan-` (the engine convention at src/main/services/forms.ts)
  // so it is excluded here, and its canvas-paint status is not knowable — it
  // must never become invisible. Kept at this one gate so a single place
  // decides the surface.
  const isRealField = !field.id.startsWith("orphan-");
  const kind: string = field.kind;
  if (
    kind === "signature" ||
    field.pushButton === true ||
    (field.readOnly === true && isRealField && kind === "text")
  ) {
    return null;
  }
  // Phase 59 (ADV-123 / ADV-124) — the SINGLE fail-safe gate. Only an
  // allow-listed, fillable kind may reach the editable editors below; a
  // signature field, an orphan widget, or any future unfillable kind renders
  // the one non-editable surface with a truthful reason. A read-only or
  // signature field that pdf.js paints on the canvas was already suppressed
  // above; every other unfillable case still reaches this fail-safe.
  const widened = field as FormField & { fillable?: boolean; unfillableReason?: string };
  if (!isFillableFieldKind(field.kind) || widened.fillable === false) {
    const reason =
      widened.fillable === false && widened.unfillableReason !== undefined
        ? widened.unfillableReason
        : nonFillableFieldReason(field.kind);
    return (
      <NonFillableView field={field} cssScale={cssScale} reason={reason} />
    );
  }
  switch (field.kind) {
    case "text":
      return (
        <TextEditor
          field={field}
          cssScale={cssScale}
          onChange={onValueChange}
          onToggleListbox={onToggleListbox}
          focused={props.focused}
          onFocus={props.onFocus}
        />
      );
    case "checkbox":
      return (
        <CheckboxEditor
          field={field}
          cssScale={cssScale}
          onChange={onValueChange}
          onToggleListbox={onToggleListbox}
          focused={props.focused}
          onFocus={props.onFocus}
        />
      );
    case "radio":
      return (
        <RadioEditor
          field={field}
          cssScale={cssScale}
          onChange={onValueChange}
          onToggleListbox={onToggleListbox}
          focused={props.focused}
          onFocus={props.onFocus}
        />
      );
    case "dropdown":
      return (
        <DropdownEditor
          field={field}
          cssScale={cssScale}
          onChange={onValueChange}
          onToggleListbox={onToggleListbox}
          focused={props.focused}
          onFocus={props.onFocus}
        />
      );
    case "listbox":
      return (
        <ListboxEditor
          field={field}
          cssScale={cssScale}
          onChange={onValueChange}
          onToggleListbox={onToggleListbox}
          focused={props.focused}
          onFocus={props.onFocus}
        />
      );
  }
}

/** Phase 59 (ADV-123 / ADV-124) — the one non-editable rendering for a field
 *  the renderer cannot fill. It is a plain labelled div (never an input /
 *  textarea / select / button), so it offers no editable affordance and no
 *  fill can be dispatched from it. The truthful reason rides both the visible
 *  label and the tooltip / accessible name. */
function NonFillableView({
  field,
  cssScale,
  reason,
}: {
  field: FormField;
  cssScale: number;
  reason: string;
}): ReactElement {
  return (
    <div
      className="form-editor form-nonfillable"
      data-form-field={field.id}
      data-form-kind={field.kind}
      data-form-nonfillable="true"
      data-form-readonly="true"
      aria-label={reason}
      title={reason}
      style={editorStyle(field.rect, cssScale)}
    >
      <span className="form-nonfillable-reason">{reason}</span>
    </div>
  );
}

// ---- Shared editor props -------------------------------------------------

/** The callbacks and scale every per-kind editor forwards to the shared
 *  `FormFieldControl`. */
interface EditorProps {
  field: FormField;
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
  /** Phase 115 E - highlight hook + focus report, forwarded to the shared
   *  control. Neither moves focus. */
  focused?: boolean;
  onFocus?: () => void;
}

// ---- Text editor ---------------------------------------------------------

function TextEditor(props: EditorProps): ReactElement {
  const { field, cssScale } = props;
  const multiline = field.rect.height >= 24;
  return (
    <FormFieldControl
      field={field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      className={multiline ? "form-editor form-textarea" : "form-editor form-input"}
      style={editorStyle(field.rect, cssScale)}
    />
  );
}

// ---- Checkbox ------------------------------------------------------------

function CheckboxEditor(props: EditorProps): ReactElement {
  const { field, cssScale } = props;
  const box = CHECKBOX_BOX_PT;
  const wrap: CSSProperties = {
    position: "absolute",
    left: field.rect.x * cssScale,
    top: field.rect.y * cssScale + (field.rect.height * cssScale - box * cssScale) / 2,
    width: box * cssScale,
    height: box * cssScale,
  };
  return (
    <FormFieldControl
      field={field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      className="form-checkbox"
      style={wrap}
    />
  );
}

// ---- Radio ---------------------------------------------------------------

function RadioEditor(props: EditorProps): ReactElement {
  const { field, cssScale } = props;
  // A multi-widget button group ships one entry per widget position; its
  // controls are placed per widget (see WidgetRadioEditor). Single-control
  // groups without per-widget data use the options layout below.
  const widgets = field.widgets;
  if (widgets !== undefined && widgets.length > 1) {
    return <WidgetRadioEditor {...props} />;
  }
  // Lay radio options out horizontally when the rect is wide enough for a
  // single row, otherwise stack vertically (the enclosing field rect is the
  // bounding box).
  const horizontal = field.rect.width >= 80;
  const wrap: CSSProperties = {
    position: "absolute",
    left: field.rect.x * cssScale,
    top: field.rect.y * cssScale,
    width: field.rect.width * cssScale,
    minHeight: Math.max(field.rect.height * cssScale, RADIO_DOT_PT * cssScale + 8),
    display: "flex",
    flexDirection: horizontal ? "row" : "column",
    flexWrap: "wrap",
    gap: horizontal ? "10px" : "4px",
    alignItems: horizontal ? "center" : "flex-start",
  };
  return (
    <FormFieldControl
      field={field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      className="form-radio-group"
      style={wrap}
    />
  );
}

// ---- Radio (per-widget) --------------------------------------------------

/** One control per widget of a multi-widget button group. Each control sits
 *  at its own widget rect and shows that widget's on-state value; selecting
 *  one sets the GROUP value (mutually exclusive — the engine deselects the
 *  others), so exactly one control reads selected. `widgets[].selected` is
 *  the engine's authoritative mark; the live field value takes precedence
 *  while the optimistic local edit is in flight. */
function WidgetRadioEditor(props: EditorProps): ReactElement {
  const { field, cssScale } = props;
  // The injected absolute style doubles as the pixel-scale source for the
  // per-widget controls FormFieldControl places.
  return (
    <FormFieldControl
      field={field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      style={editorStyle(field.rect, cssScale)}
    />
  );
}

// ---- Dropdown ------------------------------------------------------------

function DropdownEditor(props: EditorProps): ReactElement {
  return (
    <FormFieldControl
      field={props.field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      className="form-editor form-select"
      style={editorStyle(props.field.rect, props.cssScale)}
    />
  );
}

// ---- Listbox -------------------------------------------------------------

function ListboxEditor(props: EditorProps): ReactElement {
  const style: CSSProperties = {
    ...editorStyle(props.field.rect, props.cssScale),
    overflowY: "auto",
    padding: "2px 4px",
  };
  return (
    <FormFieldControl
      field={props.field}
      onChange={props.onChange}
      onToggleListbox={props.onToggleListbox}
      data-form-focused={props.focused === true ? "true" : undefined}
      onFocus={props.onFocus}
      className="form-editor form-listbox"
      style={style}
    />
  );
}

// ---- Fill report summary -------------------------------------------------

export interface FormFillReportSummaryProps {
  report: FormFillReport[];
  onDismiss?: () => void;
}

/** Phase 59 item 4 — a compact, dismissible summary of the native-fill
 *  outcome. Counts the filled fields and lists each skipped field with its
 *  kind and the plain-language reason (read-only, signature, font does not
 *  support the text, XFA, orphan widget). Renders nothing for an empty
 *  report, so hosts can mount it unconditionally. */
export function FormFillReportSummary({
  report,
  onDismiss,
}: FormFillReportSummaryProps): ReactElement | null {
  if (report.length === 0) return null;
  const filled = report.filter((r) => r.status === "filled").length;
  const skipped = report.filter((r) => r.status !== "filled");
  return (
    <div className="form-fill-report" data-form-fill-report role="status" aria-live="polite">
      <div className="form-fill-report-head">
        <span className="form-fill-report-title">Form fill</span>
        <span className="form-fill-report-counts" data-form-fill-counts>
          {filled} filled
          {skipped.length > 0 ? `, ${skipped.length} skipped` : ""}
        </span>
        {onDismiss !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon form-fill-report-dismiss"
            data-form-fill-dismiss
            aria-label="Dismiss form fill report"
            title="Dismiss"
            onClick={onDismiss}
          >
            <Icon icon={MARK_ICONS.close} size="md" />
          </button>
        )}
      </div>
      {skipped.length > 0 && (
        <ul className="form-fill-report-list">
          {skipped.map((row, i) => (
            <li
              key={`${row.name}-${row.page ?? "na"}-${row.status}-${i}`}
              className="form-fill-report-row"
              data-form-fill-skip={row.name}
            >
              <span className="form-fill-report-name">{row.name}</span>
              <span className="form-fill-report-kind">{row.kind}</span>
              <span className="form-fill-report-reason" data-form-fill-reason={row.status}>
                {reportStatusReason(row.status)}
                {row.detail !== undefined ? ` \u2014 ${row.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- helpers -------------------------------------------------------------

/** A page-point rect (top-left origin) that can be mapped through a page
 *  rotation. Structural, so `FormFieldRect` and any widget rect satisfy it. */
export interface RotatableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalize an engine rotation to a clockwise quarter-turn count 0..3. */
function normalizeRotation(rotation: number): number {
  return ((Math.trunc(rotation) % 4) + 4) % 4;
}

/** DEF-438 — the ONE rotation mapping for a field/widget rect. Page-point
 *  coords, top-left origin, unrotated page W=`pageWidthPt` x H=`pageHeightPt`,
 *  clockwise quarter turns:
 *    rot 1 (90 CW):  x' = H-(y+h), y' = x,       w' = h, h' = w
 *    rot 2 (180):    x' = W-(x+w), y' = H-(y+h), w' = w, h' = h
 *    rot 3 (270 CW): x' = y,       y' = W-(x+w), w' = h, h' = w
 *    rot 0: unchanged
 *  The caller multiplies the result by `cssScale` exactly as before. Exported
 *  so the mapping is unit-testable in isolation. */
export function mapRectForRotation(
  rect: RotatableRect,
  rotation: number,
  pageWidthPt: number,
  pageHeightPt: number,
): RotatableRect {
  const rot = normalizeRotation(rotation);
  const { x, y, width: w, height: h } = rect;
  switch (rot) {
    case 1:
      return { x: pageHeightPt - (y + h), y: x, width: h, height: w };
    case 2:
      return {
        x: pageWidthPt - (x + w),
        y: pageHeightPt - (y + h),
        width: w,
        height: h,
      };
    case 3:
      return { x: y, y: pageWidthPt - (x + w), width: h, height: w };
    default:
      return { x, y, width: w, height: h };
  }
}

/** Map a field's own rect AND every widget rect through the rotation, once.
 *  At rot 0 the field is returned untouched so the unrotated path is a
 *  zero-allocation identity. */
function mapFieldForRotation(
  field: FormField,
  rotation: number,
  pageWidthPt: number,
  pageHeightPt: number,
): FormField {
  if (normalizeRotation(rotation) === 0) return field;
  const rect = mapRectForRotation(field.rect, rotation, pageWidthPt, pageHeightPt);
  if (field.widgets === undefined) return { ...field, rect };
  const widgets = field.widgets.map((widget) => ({
    ...widget,
    rect: mapRectForRotation(widget.rect, rotation, pageWidthPt, pageHeightPt),
  }));
  return { ...field, rect, widgets };
}

function editorStyle(rect: { x: number; y: number; width: number; height: number }, cssScale: number): CSSProperties {
  const heightPt = Math.max(rect.height, MIN_EDITOR_HEIGHT_PT);
  return {
    position: "absolute",
    left: rect.x * cssScale,
    top: rect.y * cssScale,
    width: rect.width * cssScale,
    minHeight: heightPt * cssScale,
    fontSize: Math.max(11, Math.min(rect.height * cssScale * 0.7, 14)),
  };
}