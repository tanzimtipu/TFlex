// Phase 21 — text-properties panel value model.
//
// The panel is a pure/controlled component: the host owns the selected
// object's ACTUAL values (or the per-tool defaults when nothing is
// selected) and the engine call. This module holds the value shape and
// the pure conversions so the panel, the edit reducer and the unit tests
// share one source of truth.
//
// Highlight (Phase 21 follow-up): the shared `TextBoxStylePatch` now
// widens `highlight` to `EditColor | null`, where `null` is an explicit
// REMOVAL (the stored model loses its band and save draws none) and an
// absent field preserves the existing band. The panel's "None" button
// therefore emits `highlight: null`; `TEXT_NO_HIGHLIGHT` remains only as
// the neutral swatch value the colour input shows while no band is set.

import type {
  AnnTextStyle,
  EditColor,
  EditFont,
  TextAlign,
  TextBoxStylePatch,
  TextListStyle,
} from "../../shared/types";
import { clamp, type EditTextStyle } from "./model";

export const TEXT_SIZE_MIN = 1;
export const TEXT_SIZE_MAX = 2000;
export const TEXT_LINE_HEIGHT_MIN = 0.5;
export const TEXT_LINE_HEIGHT_MAX = 5;
export const TEXT_BASELINE_MIN = -200;
export const TEXT_BASELINE_MAX = 200;
export const TEXT_INDENT_MIN = 0;
export const TEXT_INDENT_MAX = 200;
export const TEXT_INDENT_STEP = 12;
export const TEXT_DEFAULT_LINE_HEIGHT = 1.2;
export const TEXT_DEFAULT_SIZE = 12;
/** Baseline offsets the super/sub buttons apply (points). */
export const TEXT_SUPER_SHIFT = 6;
export const TEXT_SUB_SHIFT = -6;

/** The renderer's "no highlight" sentinel (see the module header). */
export const TEXT_NO_HIGHLIGHT: EditColor = { r: 1, g: 1, b: 1 };

/** The panel's controlled value set. `highlight: null` = no highlight. */
export interface TextStyleValues {
  font: EditFont;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: EditColor;
  highlight: EditColor | null;
  baselineShift: number;
  align: TextAlign;
  lineHeight: number;
  list: TextListStyle;
  indent: number;
}

/** Per-tool defaults: size 12, black, left, 1.2 line step, no list/indent. */
export function defaultTextStyleValues(font: EditFont): TextStyleValues {
  return {
    font,
    size: TEXT_DEFAULT_SIZE,
    bold: false,
    italic: false,
    underline: false,
    color: { r: 0, g: 0, b: 0 },
    highlight: null,
    baselineShift: 0,
    align: "left",
    lineHeight: TEXT_DEFAULT_LINE_HEIGHT,
    list: "none",
    indent: 0,
  };
}

/** True when a colour equals the white "no highlight" sentinel. */
export function isNoHighlight(color: EditColor | null | undefined): boolean {
  if (color === null || color === undefined) return true;
  return color.r === 1 && color.g === 1 && color.b === 1;
}

/** Read the panel's value set out of a placement/edit style, falling back
 *  to the documented defaults for every Phase-21 field. */
export function textStyleValuesFromStyle(style: EditTextStyle): TextStyleValues {
  return {
    font: style.font,
    size: style.size,
    bold: style.bold ?? false,
    italic: style.italic ?? false,
    underline: style.underline ?? false,
    color: { ...style.color },
    highlight: isNoHighlight(style.highlight) ? null : { ...(style.highlight as EditColor) },
    baselineShift: style.baselineShift ?? 0,
    align: style.align ?? "left",
    lineHeight: style.lineHeight ?? TEXT_DEFAULT_LINE_HEIGHT,
    list: style.list ?? "none",
    indent: style.indent ?? 0,
  };
}

/** Merge a patch into a value set — the renderer-local mirror of the
 *  engine's preserve-if-valid semantics. `highlight` is only touched when
 *  the patch carries one; the white sentinel normalises to null. */
export function applyPatchToValues(
  values: TextStyleValues,
  patch: TextBoxStylePatch,
): TextStyleValues {
  const next: TextStyleValues = { ...values, color: { ...values.color } };
  if (patch.font !== undefined) next.font = patch.font;
  if (patch.size !== undefined) next.size = clampFontSize(patch.size);
  if (patch.bold !== undefined) next.bold = patch.bold;
  if (patch.italic !== undefined) next.italic = patch.italic;
  if (patch.underline !== undefined) next.underline = patch.underline;
  if (patch.color !== undefined) next.color = { ...patch.color };
  if (patch.highlight !== undefined) {
    next.highlight =
      patch.highlight === null || isNoHighlight(patch.highlight)
        ? null
        : { ...patch.highlight };
  }
  if (patch.baselineShift !== undefined) next.baselineShift = clampBaselineShift(patch.baselineShift);
  if (patch.align !== undefined) next.align = patch.align;
  if (patch.lineHeight !== undefined) next.lineHeight = clampLineHeight(patch.lineHeight);
  if (patch.list !== undefined) next.list = patch.list;
  if (patch.indent !== undefined) next.indent = clampIndent(patch.indent);
  return next;
}

/** The full patch that writes every field back. Used by "clear formatting"
 *  and by the host when it needs a complete style write. A null highlight
 *  goes out as the explicit `null` removal. */
export function valuesToPatch(values: TextStyleValues): TextBoxStylePatch {
  return {
    font: values.font,
    size: clampFontSize(values.size),
    bold: values.bold,
    italic: values.italic,
    underline: values.underline,
    color: { ...values.color },
    highlight: values.highlight === null ? null : { ...values.highlight },
    baselineShift: clampBaselineShift(values.baselineShift),
    align: values.align,
    lineHeight: clampLineHeight(values.lineHeight),
    list: values.list,
    indent: clampIndent(values.indent),
  };
}

/** Convert the panel's value set into the `EditTextStyle` the creation /
 *  run-edit payloads carry. A null highlight is OMITTED (the payload/model
 *  fields keep `EditColor`; removal is a patch operation only), so a newly
 *  created box simply has no band. This is what threads the panel's
 *  pending defaults into `addTextBox` / `editTextRun`. */
export function editTextStyleFromValues(values: TextStyleValues): EditTextStyle {
  return {
    font: values.font,
    size: clampFontSize(values.size),
    color: { ...values.color },
    align: values.align,
    lineHeight: clampLineHeight(values.lineHeight),
    bold: values.bold,
    italic: values.italic,
    underline: values.underline,
    baselineShift: clampBaselineShift(values.baselineShift),
    ...(values.highlight !== null ? { highlight: { ...values.highlight } } : {}),
    list: values.list,
    indent: clampIndent(values.indent),
  };
}

export function clampFontSize(v: number): number {
  return clamp(v, TEXT_SIZE_MIN, TEXT_SIZE_MAX);
}

export function clampLineHeight(v: number): number {
  return clamp(v, TEXT_LINE_HEIGHT_MIN, TEXT_LINE_HEIGHT_MAX);
}

export function clampBaselineShift(v: number): number {
  return clamp(v, TEXT_BASELINE_MIN, TEXT_BASELINE_MAX);
}

export function clampIndent(v: number): number {
  return clamp(v, TEXT_INDENT_MIN, TEXT_INDENT_MAX);
}

/** Serialise an `EditColor` (0..1 components) to `#rrggbb` for the native
 *  colour inputs. Mirrors EditInlineEditor's `colorToHex` without pulling
 *  the component module into pure callers. */
export function editColorToHex(c: EditColor): string {
  const part = (x: number): string =>
    Math.round(clamp(x, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

/** Phase 24 — reduce a panel patch to the `AnnTextStyle` the annotation
 *  `editAnnotation` payload carries. `color` is routed separately (it is
 *  the annotation's own colour, not a text-style field), and the text-box
 *  patch's `text` / `background` are not annotation style fields.
 *
 *  Contract: `AnnTextStyle.highlight` is `EditColor | null | undefined` —
 *  null means REMOVAL of the stored band, absent preserves it (mirrors
 *  `TextBoxStylePatch`). The panel's "None" button and "clear formatting"
 *  therefore pass `highlight: null` through to `editAnnotation`. */
export function annotationStyleFromPanelPatch(patch: TextBoxStylePatch): AnnTextStyle {
  const style: AnnTextStyle = {};
  if (patch.font !== undefined) style.font = patch.font;
  if (patch.size !== undefined) style.size = clampFontSize(patch.size);
  if (patch.bold !== undefined) style.bold = patch.bold;
  if (patch.italic !== undefined) style.italic = patch.italic;
  if (patch.underline !== undefined) style.underline = patch.underline;
  if (patch.highlight !== undefined) {
    style.highlight = patch.highlight === null ? null : { ...patch.highlight };
  }
  if (patch.baselineShift !== undefined) {
    style.baselineShift = clampBaselineShift(patch.baselineShift);
  }
  if (patch.align !== undefined) style.align = patch.align;
  if (patch.lineHeight !== undefined) style.lineHeight = clampLineHeight(patch.lineHeight);
  if (patch.list !== undefined) style.list = patch.list;
  if (patch.indent !== undefined) style.indent = clampIndent(patch.indent);
  return style;
}
