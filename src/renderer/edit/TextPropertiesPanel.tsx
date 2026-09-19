// Phase 21 — the docked left text-properties panel.
//
// A Word/Adobe-class control set for the selected text object (or the
// per-tool defaults when nothing is selected yet). The panel is a pure,
// controlled component: the host owns the values and the engine call, and
// this component only renders the current state and reports the smallest
// possible `TextBoxStylePatch` per gesture.
//
// Geometry: docked to the RIGHT of the thumbnail rail via the canonical
// AnimatedPanel (Phase 20 motion tokens only). The host adds the
// `--tf-text-w` grid column so the page view reflows with the panel — the
// same "page adjusts, never overlapped" contract the Tools panel follows.

import { useCallback, type ReactElement } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  RemoveFormatting,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import type { EditFont, TextBoxStylePatch, TextAlign, TextListStyle } from "../../shared/types";
import { AnimatedPanel } from "../components/AnimatedPanel";
import { hexToEditColor } from "./model";
import {
  TEXT_INDENT_STEP,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SUB_SHIFT,
  TEXT_SUPER_SHIFT,
  TEXT_NO_HIGHLIGHT,
  clampFontSize,
  clampIndent,
  clampLineHeight,
  editColorToHex,
  type TextStyleValues,
} from "./textStyle";

export interface TextPropertiesPanelProps {
  /** Whether the panel is mounted (slides on the Phase-20 panel band). */
  open: boolean;
  /** The selected object's actual values, or the per-tool defaults. */
  values: TextStyleValues;
  /** Per-tool defaults — "clear formatting" resets to these. */
  defaults: TextStyleValues;
  /** Emit the smallest style patch for a control gesture. */
  onPatch: (patch: TextBoxStylePatch) => void;
  /** Phase 21 per-family scope. "text" (default) is the full Word/Adobe
   *  control set for TFlex-owned text objects. "annotation" is the
   *  annotation text object mode: the engine bakes the annotation's
   *  glyphs, so only the COLOUR control is live; every other control
   *  renders disabled with `ANNOTATION_DISABLED_REASON` as its tooltip
   *  and must never dispatch a patch. */
  mode?: "text" | "annotation";
}

/** Exact tooltip every control disabled in annotation mode carries. The
 *  reason is contract text (REQUIREMENTS.md Phase 21, per-family scope);
 *  a disabled control must never silently no-op, so this is the only
 *  explanation the user gets for the whole disabled set. */
export const ANNOTATION_DISABLED_REASON =
  "not supported for annotations - the annotation's text is baked by the annotation engine";

const FONT_OPTIONS: readonly EditFont[] = ["Helvetica", "Times", "Courier"];

/** Disabled-state props for a control in annotation mode. Returns an
 *  empty object in text mode so the control stays fully live; the
 *  caller spreads this AFTER its own `title` so the reason overrides
 *  the control's own tooltip when the control is annotation-disabled. */
function annotationOff(annotationMode: boolean): { disabled?: boolean; title?: string } {
  return annotationMode ? { disabled: true, title: ANNOTATION_DISABLED_REASON } : {};
}

/** Parse a numeric input; null when the field is empty / not finite. */
function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A titled control group. */
function Group(props: { title: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <section className="text-props-group" aria-label={props.title}>
      <div className="text-props-group-title">{props.title}</div>
      <div className="text-props-group-body">{props.children}</div>
    </section>
  );
}

export function TextPropertiesPanel(props: TextPropertiesPanelProps): ReactElement {
  const { open, values, defaults } = props;
  const annotationMode = props.mode === "annotation";
  const rawPatch = props.onPatch;

  // Phase 21 per-family scope — the single dispatch gate. In annotation
  // mode ONLY a colour-only patch may leave the panel: every other
  // control renders `disabled`, and this guard is the belt-and-braces
  // backstop so a programmatically dispatched event on a disabled
  // control can never reach the engine. A disabled control must never
  // silently no-op, and must never silently write either.
  const onPatch = useCallback(
    (patch: TextBoxStylePatch): void => {
      if (!annotationMode) {
        rawPatch(patch);
        return;
      }
      const keys = Object.keys(patch);
      if (keys.length === 1 && keys[0] === "color") rawPatch(patch);
    },
    [annotationMode, rawPatch],
  );

  return (
    <AnimatedPanel
      open={open}
      side="left"
      mode="docked"
      className="text-props-panel"
      testId="text-properties"
    >
      <div
        className="text-props-body"
        data-text-panel
        data-text-panel-mode={annotationMode ? "annotation" : "text"}
      >
        <div className="text-props-header">
          <span className="text-props-title">Text</span>
        </div>
        {annotationMode && (
          <p className="text-props-hint text-props-annotation-note" data-txt-annotation-note>
            Annotation text is drawn by the annotation engine; only its colour can be
            changed here.
          </p>
        )}

        <Group title="Font">
          <label className="text-props-row">
            <span className="text-props-label">Family</span>
            <select
              className="text-props-select"
              data-txt-font
              value={values.font}
              {...annotationOff(annotationMode)}
              onChange={(e): void => onPatch({ font: e.target.value as EditFont })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <p className="text-props-hint">
            Standard fonts only: non-base-14 faces are substituted with the closest of
            Helvetica / Times / Courier on save.
          </p>
          <label className="text-props-row">
            <span className="text-props-label">Size</span>
            <input
              className="text-props-input"
              data-txt-size
              type="number"
              min={TEXT_SIZE_MIN}
              max={TEXT_SIZE_MAX}
              step={1}
              value={values.size}
              {...annotationOff(annotationMode)}
              onChange={(e): void => {
                const n = numberOrNull(e.target.value);
                if (n === null) return;
                onPatch({ size: clampFontSize(n) });
              }}
            />
          </label>
          <div className="text-props-btn-row" role="group" aria-label="Font style">
            <button
              type="button"
              data-txt-bold
              className={values.bold ? "text-props-btn text-props-btn-active" : "text-props-btn"}
              aria-label="Bold"
              aria-pressed={values.bold}
              title="Bold"
              {...annotationOff(annotationMode)}
              onClick={(): void => onPatch({ bold: !values.bold })}
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              data-txt-italic
              className={values.italic ? "text-props-btn text-props-btn-active" : "text-props-btn"}
              aria-label="Italic"
              aria-pressed={values.italic}
              title="Italic"
              {...annotationOff(annotationMode)}
              onClick={(): void => onPatch({ italic: !values.italic })}
            >
              <Italic size={14} />
            </button>
            <button
              type="button"
              data-txt-underline
              className={
                values.underline ? "text-props-btn text-props-btn-active" : "text-props-btn"
              }
              aria-label="Underline"
              aria-pressed={values.underline}
              title="Underline"
              {...annotationOff(annotationMode)}
              onClick={(): void => onPatch({ underline: !values.underline })}
            >
              <Underline size={14} />
            </button>
            <button
              type="button"
              data-txt-super
              className={
                values.baselineShift > 0 ? "text-props-btn text-props-btn-active" : "text-props-btn"
              }
              aria-label="Superscript"
              aria-pressed={values.baselineShift > 0}
              title="Superscript"
              {...annotationOff(annotationMode)}
              onClick={(): void =>
                onPatch({ baselineShift: values.baselineShift > 0 ? 0 : TEXT_SUPER_SHIFT })
              }
            >
              <Superscript size={14} />
            </button>
            <button
              type="button"
              data-txt-sub
              className={
                values.baselineShift < 0 ? "text-props-btn text-props-btn-active" : "text-props-btn"
              }
              aria-label="Subscript"
              aria-pressed={values.baselineShift < 0}
              title="Subscript"
              {...annotationOff(annotationMode)}
              onClick={(): void =>
                onPatch({ baselineShift: values.baselineShift < 0 ? 0 : TEXT_SUB_SHIFT })
              }
            >
              <Subscript size={14} />
            </button>
          </div>
          <label className="text-props-row">
            <span className="text-props-label">Colour</span>
            <input
              className="text-props-color"
              data-txt-color
              type="color"
              value={editColorToHex(values.color)}
              title={annotationMode ? "Annotation colour" : "Text colour"}
              onChange={(e): void => onPatch({ color: hexToEditColor(e.target.value) })}
            />
          </label>
          <label className="text-props-row">
            <span className="text-props-label">Highlight</span>
            <span className="text-props-color-wrap">
              <Highlighter size={13} className="text-props-inline-icon" />
              <input
                className="text-props-color"
                data-txt-highlight
                type="color"
                value={editColorToHex(values.highlight ?? TEXT_NO_HIGHLIGHT)}
                {...annotationOff(annotationMode)}
                onChange={(e): void => onPatch({ highlight: hexToEditColor(e.target.value) })}
              />
              <button
                type="button"
                data-txt-highlight-clear
                className="text-props-mini-btn"
                title="No highlight"
                {...annotationOff(annotationMode)}
                aria-label="No highlight"
                onClick={(): void => onPatch({ highlight: null })}
              >
                None
              </button>
            </span>
          </label>
          <button
            type="button"
            data-txt-clear
            className="text-props-wide-btn"
            title="Clear formatting"
            {...annotationOff(annotationMode)}
            onClick={(): void => onPatch(clearFormattingPatch(defaults))}
          >
            <Eraser size={13} />
            <span>Clear formatting</span>
          </button>
        </Group>

        <Group title="Paragraph">
          <div className="text-props-btn-row" role="group" aria-label="Alignment">
            {(
              [
                ["left", AlignLeft, "Align left"],
                ["center", AlignCenter, "Align centre"],
                ["right", AlignRight, "Align right"],
                ["justify", AlignJustify, "Justify"],
              ] as const
            ).map(([align, Icon, label]) => (
              <button
                key={align}
                type="button"
                {...{ [`data-txt-align-${align}`]: "true" }}
                className={
                  values.align === align ? "text-props-btn text-props-btn-active" : "text-props-btn"
                }
                aria-label={label}
                aria-pressed={values.align === align}
                title={label}
                {...annotationOff(annotationMode)}
                onClick={(): void => onPatch({ align: align as TextAlign })}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <label className="text-props-row">
            <span className="text-props-label">Line spacing</span>
            <input
              className="text-props-input"
              data-txt-line-height
              type="number"
              min={TEXT_LINE_HEIGHT_MIN}
              max={TEXT_LINE_HEIGHT_MAX}
              step={0.1}
              value={values.lineHeight}
              {...annotationOff(annotationMode)}
              onChange={(e): void => {
                const n = numberOrNull(e.target.value);
                if (n === null) return;
                onPatch({ lineHeight: clampLineHeight(n) });
              }}
            />
          </label>
          <div className="text-props-btn-row" role="group" aria-label="List style">
            {(
              [
                ["none", RemoveFormatting, "No list"],
                ["bullet", List, "Bulleted list"],
                ["number", ListOrdered, "Numbered list"],
              ] as const
            ).map(([list, Icon, label]) => (
              <button
                key={list}
                type="button"
                {...{ [`data-txt-list-${list}`]: "true" }}
                className={
                  values.list === list ? "text-props-btn text-props-btn-active" : "text-props-btn"
                }
                aria-label={label}
                aria-pressed={values.list === list}
                title={label}
                {...annotationOff(annotationMode)}
                onClick={(): void => onPatch({ list: list as TextListStyle })}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <div className="text-props-row">
            <span className="text-props-label">Indent</span>
            <div className="text-props-btn-row" role="group" aria-label="Indent">
              <button
                type="button"
                data-txt-indent-dec
                className="text-props-btn"
                aria-label="Decrease indent"
                title={annotationMode ? ANNOTATION_DISABLED_REASON : "Decrease indent"}
                disabled={annotationMode || values.indent <= 0}
                onClick={(): void => onPatch({ indent: clampIndent(values.indent - TEXT_INDENT_STEP) })}
              >
                <IndentDecrease size={14} />
              </button>
              <span className="text-props-indent-value" data-txt-indent-value>
                {values.indent}
              </span>
              <button
                type="button"
                data-txt-indent-inc
                className="text-props-btn"
                aria-label="Increase indent"
                title={annotationMode ? ANNOTATION_DISABLED_REASON : "Increase indent"}
                disabled={annotationMode || values.indent >= 200}
                onClick={(): void => onPatch({ indent: clampIndent(values.indent + TEXT_INDENT_STEP) })}
              >
                <IndentIncrease size={14} />
              </button>
            </div>
          </div>
        </Group>

        {/* Two controls the PDF engine cannot represent: pdf-lib exposes no
            Tc / Tz operators, so they ship disabled-with-tooltip per the
            FEA-011 research decision. */}
        <Group title="Spacing">
          <button
            type="button"
            data-txt-character-spacing
            className="text-props-wide-btn"
            disabled
            title={
              annotationMode
                ? ANNOTATION_DISABLED_REASON
                : "Character spacing is not available: the PDF engine has no Tc operator."
            }
          >
            <span>Character spacing</span>
          </button>
          <button
            type="button"
            data-txt-horizontal-scaling
            className="text-props-wide-btn"
            disabled
            title={
              annotationMode
                ? ANNOTATION_DISABLED_REASON
                : "Horizontal scaling is not available: the PDF engine has no Tz operator."
            }
          >
            <span>Horizontal scaling</span>
          </button>
        </Group>
      </div>
    </AnimatedPanel>
  );
}

/** Build the full reset patch. `defaults` is the per-tool default set. */
export function clearFormattingPatch(defaults: TextStyleValues): TextBoxStylePatch {
  return {
    font: defaults.font,
    size: clampFontSize(defaults.size),
    bold: defaults.bold,
    italic: defaults.italic,
    underline: defaults.underline,
    color: { ...defaults.color },
    highlight: defaults.highlight === null ? null : { ...defaults.highlight },
    baselineShift: defaults.baselineShift,
    align: defaults.align,
    lineHeight: clampLineHeight(defaults.lineHeight),
    list: defaults.list,
    indent: clampIndent(defaults.indent),
  };
}


