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

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { CSSProperties } from "react";
import type {
  FormField,
  FormFieldOption,
  FormFieldRect,
  FormFieldWidget,
  FormFillReport,
} from "../../shared/types";
import { fieldKindLabel, isFillableFieldKind, nonFillableFieldReason, reportStatusReason } from "./model";

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
}

// Minimum editor height so a 1-line text field doesn't collapse to a
// single pixel of hit area when the AcroForm author left a tight rect.
const MIN_EDITOR_HEIGHT_PT = 14;
const CHECKBOX_BOX_PT = 12;
const RADIO_DOT_PT = 11;

// Phase 59 item 4 — the truthful reason shown on every non-editable control.
export const READ_ONLY_REASON = "This field is read-only";

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
      return <TextEditor field={field} cssScale={cssScale} onChange={onValueChange} />;
    case "checkbox":
      return <CheckboxEditor field={field} cssScale={cssScale} onChange={onValueChange} />;
    case "radio":
      return <RadioEditor field={field} cssScale={cssScale} onChange={onValueChange} />;
    case "dropdown":
      return <DropdownEditor field={field} cssScale={cssScale} onChange={onValueChange} />;
    case "listbox":
      return <ListboxEditor field={field} cssScale={cssScale} onToggle={onToggleListbox} />;
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

// ---- Text editor ---------------------------------------------------------

function TextEditor({
  field,
  cssScale,
  onChange,
}: {
  field: FormField;
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // Keep the DOM focused text in sync with the reducer. We don't want to
  // trample the user's caret position, so only push external value
  // changes (e.g. from the engine echoing back after a debounce flush).
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (el.value !== field.value) {
      el.value = String(field.value);
    }
  }, [field.value]);
  const style = editorStyle(field.rect, cssScale);
  const multiline = field.rect.height >= 24;
  const value = String(field.value);
  const readOnly = field.readOnly === true;
  if (multiline) {
    return (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        className="form-editor form-textarea"
        data-form-field={field.id}
        data-form-kind="text"
        data-form-readonly={readOnly ? "true" : undefined}
        aria-label={fieldKindLabel(field.kind)}
        title={readOnly ? READ_ONLY_REASON : undefined}
        disabled={readOnly}
        defaultValue={value}
        onChange={(e): void => onChange(field.id, e.target.value)}
        style={style}
        rows={2}
      />
    );
  }
  return (
    <input
      ref={ref as React.Ref<HTMLInputElement>}
      type="text"
      className="form-editor form-input"
      data-form-field={field.id}
      data-form-kind="text"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      title={readOnly ? READ_ONLY_REASON : undefined}
      disabled={readOnly}
      defaultValue={value}
      onChange={(e): void => onChange(field.id, e.target.value)}
      style={style}
    />
  );
}

// ---- Checkbox ------------------------------------------------------------

function CheckboxEditor({
  field,
  cssScale,
  onChange,
}: {
  field: FormField;
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
}): ReactElement {
  const checked = field.value === "true" || (Array.isArray(field.value) === false && field.value === "Yes");
  const box = CHECKBOX_BOX_PT;
  const wrap: CSSProperties = {
    position: "absolute",
    left: field.rect.x * cssScale,
    top: field.rect.y * cssScale + (field.rect.height * cssScale - box * cssScale) / 2,
    width: box * cssScale,
    height: box * cssScale,
  };
  return (
    <button
      type="button"
      className={checked ? "form-checkbox form-checkbox-checked" : "form-checkbox"}
      data-form-field={field.id}
      data-form-kind="checkbox"
      data-form-readonly={field.readOnly === true ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-pressed={checked}
      title={field.readOnly === true ? READ_ONLY_REASON : undefined}
      disabled={field.readOnly === true}
      onClick={(): void => onChange(field.id, checked ? "false" : "true")}
      style={wrap}
    >
      {checked && <CheckMark size={box * cssScale * 0.7} strokeWidth={3} />}
    </button>
  );
}

// Inline Lucide-style check so we don't have to import the icon here;
// the Forms layer only needs a single check shape.
function CheckMark({
  size,
  strokeWidth,
}: {
  size: number;
  strokeWidth: number;
}): ReactElement {
  const s = String(size);
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ---- Radio ---------------------------------------------------------------

function RadioEditor({
  field,
  cssScale,
  onChange,
}: {
  field: FormField;
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
}): ReactElement {
  // Phase 59 item 4 — a multi-widget button group ships one entry per widget
  // position. Render one control per widget at its own rect (the group may
  // have 6 options spread across 24 widget boxes), each showing its own
  // on-state value. Single-control groups without per-widget data keep the
  // options-based layout below.
  const widgets = field.widgets;
  if (widgets !== undefined && widgets.length > 1) {
    return (
      <WidgetRadioEditor
        field={field}
        widgets={widgets}
        cssScale={cssScale}
        onChange={onChange}
      />
    );
  }
  const options: FormFieldOption[] = field.options ?? [];
  const current = String(field.value);
  // Lay radio options out horizontally when the rect is wide enough for
  // a single row, otherwise stack vertically (the AcroForm author
  // controls whether a radio group is laid out in a column or a row by
  // drawing the rects of the individual buttons — but here we use the
  // enclosing field rect as the bounding box).
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
    <div
      className="form-radio-group"
      data-form-field={field.id}
      data-form-kind="radio"
      aria-label={fieldKindLabel(field.kind)}
      style={wrap}
    >
      {options.map((opt) => {
        const selected = opt.value === current;
        const dotSize = RADIO_DOT_PT * cssScale;
        return (
          <button
            key={opt.value}
            type="button"
            className={selected ? "form-radio form-radio-checked" : "form-radio"}
            data-form-option={opt.value}
            data-form-readonly={field.readOnly === true ? "true" : undefined}
            title={field.readOnly === true ? READ_ONLY_REASON : undefined}
            disabled={field.readOnly === true}
            onClick={(): void => onChange(field.id, opt.value)}
          >
            <span
              className="form-radio-dot"
              style={{ width: dotSize, height: dotSize }}
              aria-hidden
            >
              {selected && (
                <span
                  className="form-radio-dot-inner"
                  style={{
                    width: dotSize * 0.45,
                    height: dotSize * 0.45,
                  }}
                />
              )}
            </span>
            <span className="form-radio-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Radio (per-widget) --------------------------------------------------

/** One control per widget of a multi-widget button group. Each control sits
 *  at its own widget rect and shows that widget's on-state value; selecting
 *  one sets the GROUP value (mutually exclusive — the engine deselects the
 *  others), so exactly one control reads selected. `widgets[].selected` is
 *  the engine's authoritative mark; the live field value takes precedence
 *  while the optimistic local edit is in flight. */
function WidgetRadioEditor({
  field,
  widgets,
  cssScale,
  onChange,
}: {
  field: FormField;
  widgets: FormFieldWidget[];
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
}): ReactElement {
  const current = String(Array.isArray(field.value) ? field.value[0] ?? "" : field.value);
  const readOnly = field.readOnly === true;
  const dotSize = RADIO_DOT_PT * cssScale;
  return (
    <>
      {widgets.map((widget, index) => {
        const selected =
          current !== "" ? widget.value === current : widget.selected === true;
        const style: CSSProperties = {
          position: "absolute",
          left: widget.rect.x * cssScale,
          top: widget.rect.y * cssScale,
          width: Math.max(widget.rect.width * cssScale, dotSize),
          minHeight: Math.max(widget.rect.height * cssScale, dotSize),
        };
        return (
          <button
            key={`${widget.value}-${index}`}
            type="button"
            className={
              selected
                ? "form-radio form-radio-widget form-radio-checked"
                : "form-radio form-radio-widget"
            }
            data-form-field={field.id}
            data-form-kind="radio"
            data-form-widget={index}
            data-form-widget-value={widget.value}
            data-form-readonly={readOnly ? "true" : undefined}
            aria-label={widget.value}
            aria-pressed={selected}
            title={readOnly ? READ_ONLY_REASON : widget.value}
            disabled={readOnly}
            onClick={(): void => onChange(field.id, widget.value)}
            style={style}
          >
            <span
              className="form-radio-dot"
              style={{ width: dotSize, height: dotSize }}
              aria-hidden
            >
              {selected && (
                <span
                  className="form-radio-dot-inner"
                  style={{ width: dotSize * 0.45, height: dotSize * 0.45 }}
                />
              )}
            </span>
            <span className="form-radio-label">{widget.value}</span>
          </button>
        );
      })}
    </>
  );
}

// ---- Dropdown ------------------------------------------------------------

function DropdownEditor({
  field,
  cssScale,
  onChange,
}: {
  field: FormField;
  cssScale: number;
  onChange: (id: string, value: string | string[]) => void;
}): ReactElement {
  const options: FormFieldOption[] = field.options ?? [];
  const style = editorStyle(field.rect, cssScale);
  const readOnly = field.readOnly === true;
  return (
    <select
      className="form-editor form-select"
      data-form-field={field.id}
      data-form-kind="dropdown"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      title={readOnly ? READ_ONLY_REASON : undefined}
      disabled={readOnly}
      value={String(field.value)}
      onChange={(e): void => onChange(field.id, e.target.value)}
      style={style}
    >
      <option value="">— select —</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ---- Listbox -------------------------------------------------------------

function ListboxEditor({
  field,
  cssScale,
  onToggle,
}: {
  field: FormField;
  cssScale: number;
  onToggle: (id: string, option: string) => void;
}): ReactElement {
  const options: FormFieldOption[] = field.options ?? [];
  const selected = Array.isArray(field.value) ? field.value : [];
  const readOnly = field.readOnly === true;
  const style: CSSProperties = {
    ...editorStyle(field.rect, cssScale),
    overflowY: "auto",
    padding: "2px 4px",
  };
  return (
    <ul
      className="form-editor form-listbox"
      data-form-field={field.id}
      data-form-kind="listbox"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-multiselectable={field.multi === true ? "true" : undefined}
      title={readOnly ? READ_ONLY_REASON : undefined}
      style={style}
    >
      {options.map((opt) => {
        const on = selected.includes(opt.value);
        return (
          <li key={opt.value}>
            <button
              type="button"
              className={on ? "form-listbox-row form-listbox-row-on" : "form-listbox-row"}
              data-form-option={opt.value}
              disabled={readOnly}
              onClick={(): void => onToggle(field.id, opt.value)}
            >
              <span className="form-listbox-tick" aria-hidden>
                {on ? "\u2713" : ""}
              </span>
              <span className="form-listbox-label">{opt.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
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
            className="form-fill-report-dismiss"
            data-form-fill-dismiss
            aria-label="Dismiss form fill report"
            title="Dismiss"
            onClick={onDismiss}
          >
            <XMark size={12} />
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

// Inline Lucide-style close, mirroring CheckMark's "no extra import" rule.
function XMark({ size }: { size: number }): ReactElement {
  const s = String(size);
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
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