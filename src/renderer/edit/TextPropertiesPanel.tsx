// Phase 21 — the text-properties panel.
//
// A Word/Adobe-class control set for the selected text object (or the
// per-tool defaults when nothing is selected yet). The panel is a pure,
// controlled component: the host owns the values and the engine call, and
// this component only renders the current state and reports the smallest
// possible `TextBoxStylePatch` per gesture.
//
// Geometry (Phase 38 feature C — supersedes the Phase-25 floating card): the
// panel has exactly ONE home, the Inspector's text block, where it is FIXED
// in place. The floating, drag-to-move card and its ContentGrip chrome are
// retired; this component renders no grip, no float attribute, and no drag
// transform. The Phase-20 AnimatedPanel still owns the enter/exit motion
// (token durations, reduced-motion and animations-off paths unchanged).
//
// Phase 24 — the Phase-21 per-family scope is retired. `mode: "annotation"`
// is now IDENTICAL to `"text"` for control gating: every control is live for
// a selected textbox / callout / note annotation, and a patch from any
// control is forwarded verbatim (the host routes it to `editAnnotation`'s
// `style` payload). The `mode` prop is kept only to tag the panel surface
// (`data-text-panel-mode`) and to label the colour control — it must never
// gate a control again.

import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  PaintBucket,
  Paintbrush,
  RemoveFormatting,
  Subscript,
  Superscript,
} from "lucide-react";
import type { EditFont, TextBoxStylePatch, TextAlign, TextListStyle } from "../../shared/types";
import { AnimatedPanel } from "../components/AnimatedPanel";
import { fontFamilyFor } from "./editColor";
import { hexToEditColor } from "./model";
import {
  TEXT_CHAR_SPACING_MAX,
  TEXT_CHAR_SPACING_MIN,
  TEXT_CHAR_SPACING_STEP,
  TEXT_INDENT_STEP,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SUB_SHIFT,
  TEXT_SUPER_SHIFT,
  TEXT_NO_HIGHLIGHT,
  clampCharSpacing,
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
  /** Phase 24 — the target family tag. `"text"` (default) is a
   *  Jovrel-owned text object; `"annotation"` is a textbox / callout /
   *  note annotation. Since Phase 24 the two are identical for control
   *  gating: every control is live in both. The tag survives only for
   *  the panel surface attribute and the colour-control label. */
  mode?: "text" | "annotation";
  /** Phase 26 — the Text field, the single text-editing surface. `text`
   *  is the selected text element's current text, or `null` when
   *  nothing text-bearing is selected (the field renders disabled and
   *  empty). `onTextChange` reports EVERY keystroke — the host renders
   *  the new text on the page immediately (the field is live mid-typing,
   *  not only on blur) — and `onTextCommit` ends the edit session
   *  (blur / Escape) so the host sends exactly ONE engine op for the
   *  session (one undo entry). `focusToken` increments whenever the host
   *  wants the field focused with its content selected: a text element
   *  was placed or clicked. */
  text?: string | null;
  onTextChange?: (text: string) => void;
  /** Phase 26 — end the edit session (blur / target change) so the host
   *  sends exactly ONE engine op for the session. Phase 29 (DEF-266) — a
   *  style-control click moves focus into this card; the host receives the
   *  new focus target and must NOT commit then, so the run stays active and
   *  the controls compose. `relatedTarget` is the `focusout` target (the
   *  element receiving focus), or null/undefined when the session really
   *  ended. */
  onTextCommit?: (relatedTarget?: EventTarget | null) => void;
  focusToken?: number;
  /** Phase 80 (F1) — the Format Painter toggle. `painterArmed` reflects
   *  whether a picked-up format is currently waiting for a target;
   *  `canPickUpPainter` is false when no source text object is selected, so
   *  the button renders disabled-with-tooltip. The panel stays pure: it
   *  reports the arm / cancel gesture and renders the host's hint. */
  painterArmed?: boolean;
  painterHint?: string | null;
  canPickUpPainter?: boolean;
  onArmPainter?: () => void;
  onCancelPainter?: () => void;
}

/** Phase 27 — the font dropdown. The three base-14 families sit in the
 *  "Standard" group; the three OFL families bundled under `assets/fonts/`
 *  sit in "Bundled" and embed a real subset on save. */
const FONT_OPTIONS: readonly { group: string; fonts: readonly EditFont[] }[] = [
  { group: "Standard", fonts: ["Helvetica", "Times", "Courier"] },
  { group: "Bundled", fonts: ["Liberation Sans", "DejaVu Serif", "DejaVu Sans Mono"] },
];

/** DEF-256 — the gutter (CSS px) kept between the text-properties panel and
 *  the open Tools palette's left edge. The same value drives the palette's
 *  coexistence cap through `--text-panel-gap` in styles.css (keep the two in
 *  lockstep). Phase 38 feature C — the panel no longer drags, so only the
 *  stylesheet relation survives; the constant stays the shared source value. */
export const TEXT_PANEL_PALETTE_GAP = 8;

/** Parse a numeric input; null when the field is empty / not finite. */
function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Phase 29 (DEF-266) — true when a focus target lives inside the
 *  text-properties card. When a style control (a number / colour input or a
 *  select) takes focus, the host must keep the text session alive: committing
 *  on that blur deselected the run and the remaining controls could no longer
 *  compose. Phase 38 feature C — the panel's one home is the Inspector, so the
 *  predicate keys on the control surface (`[data-text-panel]`), which both the
 *  retired floating card and the Inspector instance carried. Exported so the
 *  host's `commitTextSession` and its unit tests use the exact predicate. */
export function isTextPanelFocusTarget(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    (target.closest("[data-text-panel]") !== null ||
      // Phase 51 item 12 — the on-canvas run editor is a second surface of
      // the SAME session, so moving focus between it and the Inspector field
      // must keep the session alive (no commit, no lost draft).
      target.closest("[data-edit-run-editor]") !== null)
  );
}

/** A titled control group. */
function Group(props: { title: string; children: ReactNode }): ReactElement {
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
  const text = props.text ?? null;
  const painterArmed = props.painterArmed ?? false;
  const painterHint = props.painterHint ?? null;
  const canPickUpPainter = props.canPickUpPainter ?? false;

  // Phase 26 — focus + select-on-demand for the Text field. The token
  // is consumed ONLY once the field actually has a value to show: a
  // placement request arrives before the selection report resolves (the
  // overlay calls it during the gesture, the selection report runs in an
  // effect afterwards), so the effect waits for `text` and then takes
  // focus. `el.select()` selects the whole content so the user can type
  // over it immediately.
  //
  // Phase 38 feature D — the Inspector instance mounts fresh when the first
  // text object is selected, with the focus token ALREADY bumped (the token
  // is bumped in the same commit as the selection, and the Inspector mounts
  // on that commit). The old `lastFocusTokenRef` initialised to the incoming
  // token, so the effect saw no change and never focused. The ref now starts
  // at -1, so a mount carrying a POSITIVE token focuses and selects; a token
  // of 0 still means "no request" and never steals focus.
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusTokenRef = useRef<number>(-1);
  const focusToken = props.focusToken ?? 0;
  useEffect(() => {
    if (focusToken === lastFocusTokenRef.current) return;
    const el = textRef.current;
    if (el === null || text === null) return;
    lastFocusTokenRef.current = focusToken;
    if (focusToken === 0) return;
    el.focus();
    el.select();
  }, [focusToken, text]);

  // Phase 24 — no dispatch gate. The panel forwards the control's patch
  // verbatim; the host decides the route (text-object patch vs annotation
  // `style` / colour payload). Kept as a useCallback so the panel's own
  // identity churn stays zero for the memoized children.
  const rawPatch = props.onPatch;
  const onPatch = useCallback(
    (patch: TextBoxStylePatch): void => {
      rawPatch(patch);
    },
    [rawPatch],
  );

  return (
    <div className="text-props-float">
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
          onMouseDown={(e): void => {
            // Phase 29 (DEF-266) — a style-button press must not blur the
            // Text field: the blur committed the session and deselected the
            // run, so the controls could not compose. Keeping focus leaves
            // the still-active run session in place while the patch applies.
            if ((e.target as Element).closest("button") !== null) e.preventDefault();
          }}
        >
        {/* Phase 26 — the Text field: the single text-editing surface.
            Placement / click focus it through `focusToken`; every
            keystroke is reported live (the host paints it on the page
            immediately) and the session commits ONE engine op on blur. */}
        <Group title="Text">
          <textarea
            ref={textRef}
            className="text-props-text"
            data-txt-text
            rows={3}
            spellCheck={false}
            value={text ?? ""}
            disabled={text === null}
            placeholder={
              text === null ? "Select a text element to edit" : "Type text..."
            }
            aria-label="Element text"
            onChange={(e): void => props.onTextChange?.(e.target.value)}
            onBlur={(e): void => props.onTextCommit?.(e.relatedTarget)}
          />
        </Group>
        <Group title="Font">
          {/* Phase 27 — a one-line live preview. It mirrors the chosen
              family / size / weight / decoration AND the character
              spacing, so a spacing change is visible in the panel before
              the engine bakes it. The spacing is drawn 1:1 (points as CSS
              px) because the card is not page-scaled. */}
          <div
            className="text-props-preview"
            data-txt-preview
            aria-hidden
            style={{
              fontFamily: fontFamilyFor(values.font),
              fontSize: `${Math.min(Math.max(values.size, 8), 28)}px`,
              fontWeight: values.bold ? 700 : 400,
              fontStyle: values.italic ? "italic" : "normal",
              textDecoration: values.underline ? "underline" : "none",
              letterSpacing: `${values.charSpacing}px`,
            }}
          >
            {text !== null && text.trim() !== "" ? text : "Preview"}
          </div>
          <label className="text-props-row">
            <span className="text-props-label">Family</span>
            <select
              className="text-props-select"
              data-txt-font
              value={values.font}
              onChange={(e): void => onPatch({ font: e.target.value as EditFont })}
            >
              {FONT_OPTIONS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.fonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="text-props-hint">
            Standard faces use the base-14 fonts; bundled faces embed a real subset on
            save.
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
              onClick={(): void => onPatch({ underline: !values.underline })}
            >
              <Baseline size={14} />
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
              onClick={(): void =>
                onPatch({ baselineShift: values.baselineShift < 0 ? 0 : TEXT_SUB_SHIFT })
              }
            >
              <Subscript size={14} />
            </button>
            <button
              type="button"
              data-txt-format-painter
              className={painterArmed ? "text-props-btn text-props-btn-active" : "text-props-btn"}
              aria-label="Format Painter"
              aria-pressed={painterArmed}
              disabled={!canPickUpPainter && !painterArmed}
              title={
                !canPickUpPainter && !painterArmed
                  ? "Format Painter: select a text object first to pick up its format."
                  : painterArmed
                    ? "Format Painter: click to cancel. Select a text box or text annotation to apply."
                    : "Format Painter: pick up this text's format, then select a text box or text annotation to apply."
              }
              onClick={(): void => {
                if (painterArmed) props.onCancelPainter?.();
                else props.onArmPainter?.();
              }}
            >
              <Paintbrush size={14} />
            </button>
          </div>
          {painterHint !== null ? (
            <p className="text-props-hint" data-txt-format-painter-hint>
              {painterHint}
            </p>
          ) : null}
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
              <PaintBucket size={13} className="text-props-inline-icon" />
              <input
                className="text-props-color"
                data-txt-highlight
                type="color"
                value={editColorToHex(values.highlight ?? TEXT_NO_HIGHLIGHT)}
                onChange={(e): void => onPatch({ highlight: hexToEditColor(e.target.value) })}
              />
              <button
                type="button"
                data-txt-highlight-clear
                className="text-props-mini-btn"
                title="No highlight"
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
                title="Decrease indent"
                disabled={values.indent <= 0}
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
                title="Increase indent"
                disabled={values.indent >= 200}
                onClick={(): void => onPatch({ indent: clampIndent(values.indent + TEXT_INDENT_STEP) })}
              >
                <IndentIncrease size={14} />
              </button>
            </div>
          </div>
        </Group>

        {/* Phase 27 — character spacing is LIVE: the engine now emits the
            `Tc` text-state operator, so the control writes `charSpacing`
            into the style patch. Horizontal scaling stays disabled — the
            engine still exposes no `Tz` operator. */}
        <Group title="Spacing">
          <label className="text-props-row">
            <span className="text-props-label">Character spacing</span>
            <input
              className="text-props-input"
              data-txt-character-spacing
              type="number"
              min={TEXT_CHAR_SPACING_MIN}
              max={TEXT_CHAR_SPACING_MAX}
              step={TEXT_CHAR_SPACING_STEP}
              value={values.charSpacing}
              title="Extra space between glyphs, in points (PDF Tc). 0 = default."
              onChange={(e): void => {
                const n = numberOrNull(e.target.value);
                if (n === null) return;
                onPatch({ charSpacing: clampCharSpacing(n) });
              }}
            />
          </label>
          <button
            type="button"
            data-txt-horizontal-scaling
            className="text-props-wide-btn"
            disabled
            title="Horizontal scaling is not available: the PDF engine has no Tz operator."
          >
            <span>Horizontal scaling</span>
          </button>
        </Group>
        </div>
      </AnimatedPanel>
    </div>
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
    charSpacing: clampCharSpacing(defaults.charSpacing),
  };
}
