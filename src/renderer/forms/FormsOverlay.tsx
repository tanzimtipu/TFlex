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
import type { FormField, FormFieldOption } from "../../shared/types";
import { fieldKindLabel } from "./model";

interface FormsOverlayProps {
  page: number;
  cssScale: number;
  fields: FormField[];
  onValueChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
}

// Minimum editor height so a 1-line text field doesn't collapse to a
// single pixel of hit area when the AcroForm author left a tight rect.
const MIN_EDITOR_HEIGHT_PT = 14;
const CHECKBOX_BOX_PT = 12;
const RADIO_DOT_PT = 11;

export function FormsOverlay(props: FormsOverlayProps): ReactElement | null {
  const { page, cssScale, fields, onValueChange, onToggleListbox } = props;
  const pageFields = useMemo(() => fields.filter((f) => f.page === page), [fields, page]);
  // Fallback auto-layout: if the engine returns zero-sized rects for a
  // field (which happens for some AcroForm PDFs where the /Rect entry
  // is on a child widget rather than the field itself, and pdf-lib's
  // widget lookup doesn't reach it), stack the editors down the left
  // margin so they don't all pile up on top of each other. The real
  // production PDFs (form.pdf ships 0,0,0,0 from this path) still
  // show the form, just in a vertical list rather than over the
  // original widget positions.
  const hasUsableRects = pageFields.every(
    (f) => f.rect.width > 0 && f.rect.height > 0,
  );
  // Run the layout memo unconditionally so the hook count stays
  // stable across renders. An early-return-when-empty path here would
  // short-circuit a later useMemo, which the Rules of Hooks detect as
  // "rendered fewer hooks than expected" and React-19 (correctly)
  // reports as max-update-depth — that's exactly the cascade that
  // blanked the UI on the flatten round-trip (DEF-020). The memo is
  // cheap (it just iterates the already-filtered pageFields) so the
  // unconditional call has no real cost.
  const laidOut = useMemo(() => {
    if (hasUsableRects) return pageFields;
    // Stack fields vertically with a default editor size. We start
    // 24pt below the top of the page to leave room for the toolbar /
    // search-bar overlap.
    let y = 24;
    const out: { field: FormField; rect: { x: number; y: number; width: number; height: number } }[] = [];
    for (const f of pageFields) {
      const height =
        f.kind === "listbox" ? 80 :
        f.kind === "radio" ? 32 :
        24;
      out.push({ field: f, rect: { x: 36, y, width: 240, height } });
      y += height + 8;
    }
    return out;
  }, [hasUsableRects, pageFields]);
  // Early return AFTER all hooks have run. With `pageFields.length === 0`
  // (the post-flatten case where the AcroForm is gone), there's nothing
  // to render; the host still keeps the overlay mounted in the React tree
  // so a subsequent re-fill round-trip re-pops the editors in place.
  if (pageFields.length === 0) return null;
  return (
    <div className="forms-layer" data-page={page}>
      {laidOut.map((entry) => {
        const field = "field" in entry ? entry.field : entry;
        const renderField: FormField = hasUsableRects
          ? field
          : { ...field, rect: (entry as { rect: FormField["rect"] }).rect };
        return (
          <FieldEditor
            key={field.id}
            field={renderField}
            cssScale={cssScale}
            onValueChange={onValueChange}
            onToggleListbox={onToggleListbox}
          />
        );
      })}
    </div>
  );
}

interface FieldEditorProps {
  field: FormField;
  cssScale: number;
  onValueChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
}

function FieldEditor(props: FieldEditorProps): ReactElement {
  const { field, cssScale, onValueChange, onToggleListbox } = props;
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
  if (multiline) {
    return (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        className="form-editor form-textarea"
        data-form-field={field.id}
        data-form-kind="text"
        aria-label={fieldKindLabel(field.kind)}
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
      aria-label={fieldKindLabel(field.kind)}
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
      aria-label={fieldKindLabel(field.kind)}
      aria-pressed={checked}
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
  return (
    <select
      className="form-editor form-select"
      data-form-field={field.id}
      data-form-kind="dropdown"
      aria-label={fieldKindLabel(field.kind)}
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
      aria-label={fieldKindLabel(field.kind)}
      aria-multiselectable={field.multi === true ? "true" : undefined}
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

// ---- helpers -------------------------------------------------------------

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