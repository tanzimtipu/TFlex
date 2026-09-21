// Phase 24 — map a stored `AnnTextStyle` onto the LIVE overlay text.
//
// The overlay draws the text of every annotation created / edited in this
// session (DEF-166's live-text rule): the page canvas only paints a baked
// FreeText /AP stream, which the engine re-bakes at save time, so a style
// change made in the text-properties panel would otherwise be invisible
// until save + reopen. This module turns the stored style into the CSS the
// committed textbox / callout text node needs, so the change is visible the
// moment the engine echo lands.
//
// DEFAULTS ARE PRESERVED: every field is `undefined` unless the annotation
// actually stores it, and the overlay falls back to its own pre-Phase-24
// constants. An annotation with no style therefore renders exactly as it did
// before this phase.
//
// DEF-265 — `list` prefixes and `baselineShift` (super/subscript) are NOT
// expressible on a single CSS text node, so they are not part of this
// module's flat `AnnTextCss`. They ARE applied live now, per wrapped line,
// by `annTextLayout.ts` + the shared `liveText.ts` per-line emission (prefix
// span, counter, `vertical-align` baseline shift), matching the baked /AP
// exactly. See `AnnotationOverlay`'s committed-text renderer.

import type { AnnTextStyle, EditFont, TextAlign } from "../../shared/types";

/** CSS family stack for each StandardFont the panel exposes. */
export const ANN_TEXT_FONT_CSS: Record<EditFont, string> = {
  Helvetica: '"Inter", system-ui, sans-serif',
  Times: 'Times, "Times New Roman", serif',
  Courier: '"Courier New", Courier, monospace',
  "Liberation Sans": '"Liberation Sans", Arial, sans-serif',
  "DejaVu Serif": '"DejaVu Serif", Georgia, serif',
  "DejaVu Sans Mono": '"DejaVu Sans Mono", Consolas, monospace',
};

/** The stored style's CSS-relevant fields. Absent means "keep the overlay's
 *  own default". */
export interface AnnTextCss {
  fontFamily?: string;
  /** Stored point size (unscaled — the overlay multiplies by cssScale). */
  sizePt?: number;
  fontWeight?: number;
  fontStyle?: "italic";
  textDecoration?: "underline";
  textAlign?: TextAlign;
  lineHeight?: number;
  /** Highlight band behind the glyphs, as a CSS colour. */
  highlight?: string;
  /** Left inset in points (the panel's indent). */
  indentPt?: number;
  /** Phase 27 — character spacing in points (the panel's tracking). The
   *  overlay scales it by `cssScale` to a CSS `letter-spacing`. */
  charSpacingPt?: number;
}

/** `#rrggbb` for a 0..1 `EditColor`, clamped like `editColorToHex`. */
function colorHex(c: { r: number; g: number; b: number }): string {
  const part = (x: number): string =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

export function annTextCss(style: AnnTextStyle | undefined): AnnTextCss {
  if (style === undefined) return {};
  const css: AnnTextCss = {};
  if (style.font !== undefined) css.fontFamily = ANN_TEXT_FONT_CSS[style.font];
  if (style.size !== undefined) css.sizePt = style.size;
  if (style.bold !== undefined) css.fontWeight = style.bold ? 700 : 400;
  if (style.italic === true) css.fontStyle = "italic";
  if (style.underline === true) css.textDecoration = "underline";
  if (style.align !== undefined) css.textAlign = style.align;
  if (style.lineHeight !== undefined) css.lineHeight = style.lineHeight;
  if (style.highlight != null) css.highlight = colorHex(style.highlight);
  if (style.indent !== undefined && style.indent > 0) css.indentPt = style.indent;
  if (style.charSpacing !== undefined && style.charSpacing !== 0) {
    css.charSpacingPt = style.charSpacing;
  }
  return css;
}
