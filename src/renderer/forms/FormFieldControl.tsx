// Phase 115 - the ONE shared per-kind form value control.
//
// Extracted from FormsOverlay so the canvas overlay and the Guided Fill panel
// render the exact same value semantics from one implementation. This module
// owns no placement: it renders only the native control(s) and lets the caller
// inject `id`, `className` and `style` (the overlay passes its absolute
// `editorStyle(...)`, the panel passes panel styling).
//
// Value semantics are byte-for-byte the ones FormsOverlay shipped:
//   text      -> <input> / <textarea> (multi-line when rect.height >= 24)
//   checkbox  -> toggle button, checked when value is "true" or "Yes"
//   radio     -> one control per option/widget, export value = option.value
//   dropdown  -> <select>
//   listbox   -> multi-select list, toggles membership via onToggleListbox

import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { Check } from "lucide-react";
import { Icon } from "../icons/Icon";
import { Button } from "../components/Button";
import type { FormField, FormFieldOption } from "../../shared/types";
import { fieldKindLabel } from "./model";

// The truthful reason shown on every non-editable control (Phase 59 item 4).
export const READ_ONLY_REASON = "This field is read-only";

// The swatch diameters the overlay geometry was built around, in points.
const RADIO_DOT_PT = 11;

export interface FormFieldControlProps {
  field: FormField;
  onChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
  id?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  /** Phase 115 E - highlight hook linking this canvas control to the Guided
   *  Fill panel's focused row. Highlight only; never moves focus. */
  "data-form-focused"?: string;
  /** Phase 115 E - reports that this control gained focus. Never moves focus. */
  onFocus?: () => void;
}

/** The read-only state: the caller may override, otherwise the field's own
 *  ReadOnly flag decides. */
function isReadOnly(props: FormFieldControlProps): boolean {
  return props.disabled !== undefined ? props.disabled : props.field.readOnly === true;
}

/** Recover the pixel scale the caller baked into its injected `style`. The
 *  canvas passes `editorStyle(rect, cssScale)`, whose width is exactly
 *  `rect.width * cssScale`; the panel passes no style and scales at 1. */
function controlScale(field: FormField, style?: CSSProperties): number {
  if (style !== undefined) {
    const width = typeof style.width === "number" ? style.width : Number.NaN;
    if (Number.isFinite(width) && width > 0 && field.rect.width > 0) {
      const scale = width / field.rect.width;
      if (Number.isFinite(scale) && scale > 0) return scale;
    }
  }
  return 1;
}

/** Phase 115 E - the focus-link attributes shared by every control root. The
 *  `data-form-focused` attribute is the ONLY link between the canvas and the
 *  Guided Fill panel: this module never calls `.focus()`. */
function focusLinkProps(props: FormFieldControlProps): {
  "data-form-focused": string | undefined;
  onFocus: (() => void) | undefined;
} {
  return {
    "data-form-focused": props["data-form-focused"],
    onFocus: props.onFocus === undefined ? undefined : (): void => props.onFocus?.(),
  };
}

/** The native control(s) for a field kind, with no placement of its own. */
export function FormFieldControl(props: FormFieldControlProps): ReactElement {
  switch (props.field.kind) {
    case "text":
      return <TextControl {...props} />;
    case "checkbox":
      return <CheckboxControl {...props} />;
    case "radio":
      return <RadioControl {...props} />;
    case "dropdown":
      return <DropdownControl {...props} />;
    case "listbox":
      return <ListboxControl {...props} />;
  }
}

// ---- Text ----------------------------------------------------------------

function TextControl(props: FormFieldControlProps): ReactElement {
  const { field, onChange, className, style } = props;
  const readOnly = isReadOnly(props);
  const value = String(field.value);
  const multiline = field.rect.height >= 24;
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // Keep the DOM focused text in sync with the reducer without trampling the
  // user's caret: only push external value changes (engine echo after a flush).
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (el.value !== value) {
      el.value = value;
    }
  }, [value]);
  const title = readOnly ? READ_ONLY_REASON : undefined;
  if (multiline) {
    return (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        className={className}
        id={props.id}
        data-form-field={field.id}
        data-form-kind="text"
        data-form-readonly={readOnly ? "true" : undefined}
        aria-label={fieldKindLabel(field.kind)}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={props["aria-required"]}
        title={title}
        disabled={readOnly}
        defaultValue={value}
        onChange={(e): void => onChange(field.id, e.target.value)}
        style={style}
        rows={2}
        {...focusLinkProps(props)}
      />
    );
  }
  return (
    <input
      ref={ref as React.Ref<HTMLInputElement>}
      type="text"
      className={className}
      id={props.id}
      data-form-field={field.id}
      data-form-kind="text"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props["aria-required"]}
      title={title}
      disabled={readOnly}
      defaultValue={value}
      onChange={(e): void => onChange(field.id, e.target.value)}
      style={style}
      {...focusLinkProps(props)}
    />
  );
}

// ---- Checkbox ------------------------------------------------------------

function CheckboxControl(props: FormFieldControlProps): ReactElement {
  const { field, onChange, className, style } = props;
  const readOnly = isReadOnly(props);
  const checked =
    field.value === "true" || (Array.isArray(field.value) === false && field.value === "Yes");
  const composed = [className, checked ? "form-checkbox-checked" : null]
    .filter((part): part is string => part !== null && part !== undefined && part !== "")
    .join(" ");
  return (
    <Button
      intent="secondary"
      kind="toggle"
      density="compact"
      className={composed === "" ? undefined : composed}
      id={props.id}
      data-form-field={field.id}
      data-form-kind="checkbox"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props["aria-required"]}
      aria-pressed={checked}
      title={readOnly ? READ_ONLY_REASON : undefined}
      disabled={readOnly}
      onClick={(): void => onChange(field.id, checked ? "false" : "true")}
      style={style}
      {...focusLinkProps(props)}
    >
      {checked && <Icon icon={Check} size="xs" variant="bold" />}
    </Button>
  );
}

// ---- Dropdown ------------------------------------------------------------

function DropdownControl(props: FormFieldControlProps): ReactElement {
  const { field, onChange, className, style } = props;
  const readOnly = isReadOnly(props);
  const options: FormFieldOption[] = field.options ?? [];
  return (
    <select
      className={className}
      id={props.id}
      data-form-field={field.id}
      data-form-kind="dropdown"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props["aria-required"]}
      title={readOnly ? READ_ONLY_REASON : undefined}
      disabled={readOnly}
      value={String(field.value)}
      onChange={(e): void => onChange(field.id, e.target.value)}
      style={style}
      {...focusLinkProps(props)}
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

function ListboxControl(props: FormFieldControlProps): ReactElement {
  const { field, onToggleListbox, className, style } = props;
  const readOnly = isReadOnly(props);
  const options: FormFieldOption[] = field.options ?? [];
  const selected = Array.isArray(field.value) ? field.value : [];
  return (
    <ul
      className={className}
      id={props.id}
      data-form-field={field.id}
      data-form-kind="listbox"
      data-form-readonly={readOnly ? "true" : undefined}
      aria-label={fieldKindLabel(field.kind)}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props["aria-required"]}
      aria-multiselectable={field.multi === true ? "true" : undefined}
      title={readOnly ? READ_ONLY_REASON : undefined}
      style={style}
      {...focusLinkProps(props)}
    >
      {options.map((opt) => {
        const on = selected.includes(opt.value);
        return (
          <li key={opt.value}>
            <Button
              intent="secondary"
              kind="toggle"
              density="compact"
              className={on ? "form-listbox-row form-listbox-row-on" : "form-listbox-row"}
              data-form-option={opt.value}
              disabled={readOnly}
              onClick={(): void => onToggleListbox(field.id, opt.value)}
            >
              <span className="form-listbox-tick" aria-hidden>
                {on ? "\u2713" : ""}
              </span>
              <span className="form-listbox-label">{opt.label}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Radio ---------------------------------------------------------------

function RadioDot({ size, selected }: { size: number; selected: boolean }): ReactElement {
  return (
    <span className="form-radio-dot" style={{ width: size, height: size }} aria-hidden>
      {selected && (
        <span
          className="form-radio-dot-inner"
          style={{ width: size * 0.45, height: size * 0.45 }}
        />
      )}
    </span>
  );
}

function RadioControl(props: FormFieldControlProps): ReactElement {
  const { field, onChange, className, style } = props;
  const readOnly = isReadOnly(props);
  const scale = controlScale(field, style);
  const dotSize = RADIO_DOT_PT * scale;
  const widgets = field.widgets;
  // A multi-widget button group ships one entry per widget position. The
  // canvas injects an absolute style (positioned per widget); the panel injects
  // none, so the widgets fall back to a natural flow list.
  if (widgets !== undefined && widgets.length > 1) {
    const positioned = style !== undefined;
    const current = String(Array.isArray(field.value) ? field.value[0] ?? "" : field.value);
    return (
      <>
        {widgets.map((widget, index) => {
          const selected =
            current !== "" ? widget.value === current : widget.selected === true;
          const widgetStyle: CSSProperties | undefined = positioned
            ? {
                position: "absolute",
                left: widget.rect.x * scale,
                top: widget.rect.y * scale,
                width: Math.max(widget.rect.width * scale, dotSize),
                minHeight: Math.max(widget.rect.height * scale, dotSize),
              }
            : undefined;
          return (
            <Button
              key={`${widget.value}-${index}`}
              intent="secondary"
              kind="exclusive-selection"
              density="compact"
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
              style={widgetStyle}
              {...focusLinkProps(props)}
            >
              <RadioDot size={dotSize} selected={selected} />
              <span className="form-radio-label">{widget.value}</span>
            </Button>
          );
        })}
      </>
    );
  }
  const options: FormFieldOption[] = field.options ?? [];
  const current = String(field.value);
  return (
    <div
      className={className}
      id={props.id}
      data-form-field={field.id}
      data-form-kind="radio"
      aria-label={fieldKindLabel(field.kind)}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props["aria-required"]}
      style={style}
      {...focusLinkProps(props)}
    >
      {options.map((opt) => {
        const selected = opt.value === current;
        return (
          <Button
            key={opt.value}
            intent="secondary"
            kind="exclusive-selection"
            density="compact"
            className={selected ? "form-radio form-radio-checked" : "form-radio"}
            data-form-option={opt.value}
            data-form-readonly={readOnly ? "true" : undefined}
            title={readOnly ? READ_ONLY_REASON : undefined}
            disabled={readOnly}
            onClick={(): void => onChange(field.id, opt.value)}
            {...focusLinkProps(props)}
          >
            <RadioDot size={dotSize} selected={selected} />
            <span className="form-radio-label">{opt.label}</span>
          </Button>
        );
      })}
    </div>
  );
}


