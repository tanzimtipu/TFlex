// Phase 29 (DEF-262 / DEF-265) — the shared live layout for ANNOTATION text.
//
// The annotation overlay draws the text of annotations created / edited in
// this session (DEF-166). It must mirror the engine's baked FreeText /AP
// layout (`buildFreeTextAPStream` -> `drawStyledTextLines`,
// annotations.ts:1379 / engine.ts:4581): word-wrap at the stored size, the
// per-line list prefixes, the baseline shift, indent, highlight band,
// per-line underline and alignment. This module reuses the shared
// `liveText.ts` wrap / prefix / line primitives (the same ones the
// Edit-mode mirrors use) so live and baked agree, and adds the two
// annotation-specific pieces: the per-side pad + border inset, and the
// auto-GROW rule that replaces the old 4pt auto-fit collapse (DEF-262).
//
// DEF-262 — the old overlay shrank the font to fit the FIXED one-line rect
// created at empty placement (`textBoxRectFor`), so multi-line text hit the
// 4pt floor and the Size control was invisible. A textbox / callout now
// GROWS its height to the wrapped block at the requested size (Adobe-style
// FreeText), up to `ANN_TEXT_MAX_GROW_PT` and the page bound; only if that
// cap is exceeded does it fall back to the engine's shrink-to-fit.

import type { AnnRect, AnnTextStyle } from "../../shared/types";
import type { EditTextStyle } from "../edit/model";
import {
  listPrefixWidthPx,
  toLiveTextLines,
  wrapTextToWidthPx,
  type LiveTextLine,
  type MeasureText,
} from "../edit/liveText";

/** Per-side content inset (points), matching `FREETEXT_PAD_PT` /
 *  `FREETEXT_BORDER_PT` / `CALLOUT_BORDER_PT` in the engine. */
export const ANN_TEXT_PAD_PT = 5;
export const ANN_TEXT_BOX_BORDER_PT = 1;
export const ANN_TEXT_CALLOUT_BORDER_PT = 1.5;
/** Legacy FreeText defaults (the engine's `FREETEXT_FONT_PT` /
 *  `FREETEXT_LINE_HEIGHT`). */
export const ANN_TEXT_DEFAULT_SIZE_PT = 12;
export const ANN_TEXT_DEFAULT_LINE_HEIGHT = 1.35;
/** The engine's `FREETEXT_MIN_SIZE_PT` — the shrink floor when the grown
 *  block would exceed the cap. */
export const ANN_TEXT_MIN_FIT_PT = 4;
/** Sane maximum the auto-grow will ever produce, in points. A pathological
 *  payload cannot create a 10000pt-tall box; the page bound usually bites
 *  first. */
export const ANN_TEXT_MAX_GROW_PT = 1200;
/** Gutter kept between the grown box bottom and the page edge. */
export const ANN_TEXT_PAGE_GUTTER_PT = 6;

export function annTextInsetPt(kind: "textbox" | "callout"): number {
  return (
    ANN_TEXT_PAD_PT +
    (kind === "textbox" ? ANN_TEXT_BOX_BORDER_PT : ANN_TEXT_CALLOUT_BORDER_PT)
  );
}

/** The `EditTextStyle` shape the shared `liveText` per-line helpers need,
 *  filled with the annotation defaults for any absent field. */
export function annTextEditStyle(style: AnnTextStyle | undefined): EditTextStyle {
  return {
    font: style?.font ?? "Helvetica",
    size: style?.size ?? ANN_TEXT_DEFAULT_SIZE_PT,
    color: { r: 0, g: 0, b: 0 },
    align: style?.align,
    lineHeight: style?.lineHeight,
    bold: style?.bold,
    italic: style?.italic,
    underline: style?.underline,
    baselineShift: style?.baselineShift,
    highlight: style?.highlight ?? undefined,
    list: style?.list,
    indent: style?.indent,
    charSpacing: style?.charSpacing,
  };
}
export interface AnnTextLayoutResult {
  /** Sized font in points (the requested size, or the shrink fallback). */
  fontSizePt: number;
  /** Grown box height in points (never below the stored height). */
  heightPt: number;
  lines: LiveTextLine[];
  indentPt: number;
  /** Content width in points (box width minus both insets). */
  contentWidthPt: number;
}

/** Layout a live annotation textbox / callout the way the baked /AP will:
 *  wrap at the requested size, then GROW the box height to the wrapped
 *  block. Only when the grown block would exceed `maxHeightPt` (the page
 *  bound / sane cap) does it fall back to the engine's shrink-to-fit at the
 *  `ANN_TEXT_MIN_FIT_PT` floor. `measure` measures raw glyph width at a
 *  point size; character spacing is handled by the wrap helper exactly like
 *  `styledTextWidth`. */
export function layoutAnnTextBox(args: {
  text: string;
  style: AnnTextStyle | undefined;
  /** Box rect width in points. */
  boxWidthPt: number;
  /** Stored rect height in points (the grown height never shrinks below it). */
  boxHeightPt: number;
  insetPt: number;
  /** Hard ceiling in points (page bound / cap), already including the top. */
  maxHeightPt: number;
  measure: MeasureText;
}): AnnTextLayoutResult {
  const style = args.style ?? {};
  const lineHeight = style.lineHeight ?? ANN_TEXT_DEFAULT_LINE_HEIGHT;
  const list = style.list ?? "none";
  const indentPt = style.indent ?? 0;
  const charSpacingPt = style.charSpacing ?? 0;
  const contentWidthPt = Math.max(1, args.boxWidthPt - args.insetPt * 2);
  const contentHeightCap = Math.max(1, args.maxHeightPt - args.insetPt * 2);
  const baseSizePt = style.size ?? ANN_TEXT_DEFAULT_SIZE_PT;
  const wrap = (sizePt: number): string[] =>
    wrapTextToWidthPx({
      text: args.text,
      measure: args.measure,
      sizePx: sizePt,
      maxWidthPx: Math.max(
        1,
        contentWidthPt -
          indentPt -
          listPrefixWidthPx(list, args.measure, sizePt, charSpacingPt),
      ),
      charSpacingPx: charSpacingPt,
    });
  let fontSizePt = baseSizePt;
  let raw = wrap(fontSizePt);
  let heightPt = raw.length * fontSizePt * lineHeight + args.insetPt * 2;
  if (heightPt > args.maxHeightPt) {
    fontSizePt = Math.max(
      ANN_TEXT_MIN_FIT_PT,
      contentHeightCap / Math.max(1, raw.length * lineHeight),
    );
    raw = wrap(fontSizePt);
    heightPt = Math.min(
      args.maxHeightPt,
      raw.length * fontSizePt * lineHeight + args.insetPt * 2,
    );
  }
  return {
    fontSizePt,
    heightPt: Math.max(Math.max(1, args.boxHeightPt), heightPt),
    lines: toLiveTextLines(raw, list),
    indentPt,
    contentWidthPt,
  };
}

/** The grown rect for a textbox / callout at its CURRENT text + style, or
 *  null when the stored height already fits. This is what the commit path
 *  persists so a save + reopen keeps the legible box. `maxHeightPt` is the
 *  page bound / `ANN_TEXT_MAX_GROW_PT`, whichever is smaller. */
export function grownAnnTextRect(args: {
  kind: "textbox" | "callout";
  rect: AnnRect;
  text: string;
  style: AnnTextStyle | undefined;
  maxHeightPt: number;
  measure: MeasureText;
}): AnnRect | null {
  const layout = layoutAnnTextBox({
    text: args.text,
    style: args.style,
    boxWidthPt: args.rect.width,
    boxHeightPt: args.rect.height,
    insetPt: annTextInsetPt(args.kind),
    maxHeightPt: args.maxHeightPt,
    measure: args.measure,
  });
  if (layout.heightPt <= args.rect.height + 0.5) return null;
  return { ...args.rect, height: layout.heightPt };
}

/** The page-bound ceiling for a box whose top is `topPt`: never grow past
 *  the page bottom, and never past `ANN_TEXT_MAX_GROW_PT`. */
export function annTextMaxHeightPt(pageHeightPt: number, topPt: number): number {
  return Math.max(
    1,
    Math.min(
      ANN_TEXT_MAX_GROW_PT,
      pageHeightPt - topPt - ANN_TEXT_PAGE_GUTTER_PT,
    ),
  );
}
