// Phase 29 (DEF-263 / DEF-266) — the live text layout shared by the
// Edit-mode text-box mirror and the edited-run preview.
//
// Before this module both mirrors applied only font / size / colour /
// character-spacing (plus a hard-coded `lineHeight: 1.2`): bold, italic,
// underline, super/subscript, highlight, alignment, the STORED line
// spacing, list prefixes and indent were invisible until save+reopen.
// A plain DOM text node cannot express per-wrapped-line prefixes or a
// baseline shift (the annotation side documents that limit at
// `annTextStyle.ts:16-19`), so this module reproduces the engine's baked
// layout — the text-box auto-fit and the shared styled-line renderer
// (`drawTextBoxes` engine.ts:4773, `drawStyledTextLines` engine.ts:4581)
// — and hands the component ONE element per wrapped/explicit line. The
// component then renders each line with its prefix, alignment, highlight
// band and baseline offset, so the LIVE view matches what save bakes.

import type { CSSProperties } from "react";
import type { TextAlign, TextListStyle } from "../../shared/types";
import { colorToHex, fontFamilyFor } from "./editColor";
import type { EditTextStyle } from "./model";

/** The auto-fit floor, matching the engine's `MIN_FIT_SIZE` and
 *  `fitTextBoxFontSizePx`. */
export const LIVE_TEXT_MIN_FIT_PX = 4;
/** Documented default line step when the style has never set one. */
export const LIVE_TEXT_DEFAULT_LINE_HEIGHT = 1.2;

export interface LiveTextLine {
  key: number;
  /** 0-based line index — drives the numbered-list counter. */
  index: number;
  /** Drawn prefix (`"• "`, `"3. "`) or `""`. */
  prefix: string;
  /** The wrapped line text, prefix excluded. */
  text: string;
  /** True for the final line (justify leaves it un-stretched). */
  isLast: boolean;
}

export interface LiveTextLayout {
  fontSizePx: number;
  lines: LiveTextLine[];
  /** Left inset of the content box, in CSS px. */
  indentPx: number;
  /** Width available to a line, in CSS px (box width minus indent). */
  contentWidthPx: number;
}

/** Measure a string at a size, in CSS px. Injected so the layout is
 *  unit-testable without a canvas (production passes
 *  `measureTextWidthCss`). */
export type MeasureText = (text: string, fontSizePx: number) => number;

/** The prefix text a list style draws on line `index` (0-based). Mirrors the
 *  engine's `drawStyledTextLines` numbering, which counts from 1 across every
 *  wrapped + explicit line. */
export function listPrefixText(list: TextListStyle, index: number): string {
  if (list === "bullet") return "\u2022 ";
  if (list === "number") return `${index + 1}. `;
  return "";
}

/** Width of `text` with character spacing included — the engine's
 *  `styledTextWidth` rule that wrapping and alignment measure with. */
export function styledTextWidthPx(
  measure: MeasureText,
  text: string,
  sizePx: number,
  charSpacingPx: number,
): number {
  return measure(text, sizePx) + charSpacingPx * Math.max(0, Array.from(text).length - 1);
}

/** Engine `listPrefixWidth`: `number` reserves the widest plausible
 *  `999. ` so the first wrapped lines never overflow the box. */
export function listPrefixWidthPx(
  list: TextListStyle,
  measure: MeasureText,
  sizePx: number,
  charSpacingPx: number,
): number {
  if (list === "bullet") return styledTextWidthPx(measure, "\u2022 ", sizePx, charSpacingPx);
  if (list === "number") return styledTextWidthPx(measure, "999. ", sizePx, charSpacingPx);
  return 0;
}
/** Split on explicit newlines (the edited-RUN rule � the engine never
 *  word-wraps a run; `editTextRun` splits the payload text this way and
 *  draws each explicit line as-is). */
export function splitExplicitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Word-wrap `text` to `maxWidthPx` at `sizePx`, mirroring the engine's
 *  `wrapTextToWidth` (engine.ts:3451): explicit `\n` paragraphs, greedy
 *  word fit, and a per-character hard break for a single word wider than the
 *  box. Character spacing counts toward every measured width. */
export function wrapTextToWidthPx(args: {
  text: string;
  measure: MeasureText;
  sizePx: number;
  maxWidthPx: number;
  charSpacingPx: number;
}): string[] {
  const { text, measure, sizePx, maxWidthPx, charSpacingPx } = args;
  const width = (t: string): number => styledTextWidthPx(measure, t, sizePx, charSpacingPx);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (word.length === 0) continue;
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (width(candidate) <= maxWidthPx) {
        line = candidate;
      } else {
        if (line.length > 0) {
          out.push(line);
          line = "";
        }
        if (width(word) <= maxWidthPx) {
          line = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            if (width(chunk + ch) <= maxWidthPx) {
              chunk += ch;
            } else {
              if (chunk.length > 0) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** Phase 29 — exported so the annotation live mirror (DEF-262/265) emits the
 *  same per-line shape (prefix, counter index, last-line flag) as the
 *  Edit-mode mirrors. */
export function toLiveTextLines(raw: string[], list: TextListStyle): LiveTextLine[] {
  return raw.map((text, index) => ({
    key: index,
    index,
    prefix: listPrefixText(list, index),
    text,
    isLast: index === raw.length - 1,
  }));
}

function toLines(raw: string[], list: TextListStyle): LiveTextLine[] {
  return toLiveTextLines(raw, list);
}

/** Layout a committed text box's live mirror the way `drawTextBoxes` bakes
 *  it: wrap to the indented content width minus the list-prefix reserve at
 *  the user size, then (when the wrapped block is taller than the box) shrink
 *  the font to fit and re-wrap once. `widthPx`/`heightPx` are the box's
 *  CONTENT box in CSS px (page-scaled rect minus the mirror padding);
 *  `indentPx`/`userSizePx`/`charSpacingPx` are already cssScale-scaled. */
export function layoutEditTextBox(args: {
  text: string;
  widthPx: number;
  heightPx: number;
  userSizePx: number;
  indentPx: number;
  lineHeight: number;
  list: TextListStyle;
  charSpacingPx: number;
  measure: MeasureText;
}): LiveTextLayout {
  const { text, measure, indentPx, lineHeight, list, charSpacingPx } = args;
  const contentWidthPx = Math.max(1, args.widthPx - indentPx);
  const wrap = (sizePx: number): string[] =>
    wrapTextToWidthPx({
      text,
      measure,
      sizePx,
      maxWidthPx: Math.max(
        1,
        contentWidthPx - listPrefixWidthPx(list, measure, sizePx, charSpacingPx),
      ),
      charSpacingPx,
    });
  let size = Math.max(1, args.userSizePx);
  let raw = wrap(size);
  if (args.heightPx > 0 && raw.length > 0) {
    const needed = raw.length * size * lineHeight;
    if (needed > args.heightPx) {
      size = Math.max(LIVE_TEXT_MIN_FIT_PX, args.heightPx / (raw.length * lineHeight));
      raw = wrap(size);
    }
  }
  return {
    fontSizePx: size,
    lines: toLines(raw, list),
    indentPx,
    contentWidthPx,
  };
}

/** Layout the edited-RUN preview. The engine draws a run's explicit lines
 *  at its fixed size with no word-wrap and no auto-fit, so the preview splits
 *  the same way and keeps `userSizePx` unchanged. */
export function layoutEditTextRun(args: {
  text: string;
  widthPx: number;
  userSizePx: number;
  indentPx: number;
  list: TextListStyle;
}): LiveTextLayout {
  const raw = splitExplicitLines(args.text);
  return {
    fontSizePx: Math.max(1, args.userSizePx),
    lines: toLines(raw.length === 0 ? [""] : raw, args.list),
    indentPx: args.indentPx,
    contentWidthPx: Math.max(1, args.widthPx - args.indentPx),
  };
}

/** The block-level inline CSS shared by every line: font family / size /
 *  weight / style / decoration, colour, character spacing and the STORED
 *  line step (as an exact px line box = fitted size x lineHeight, the
 *  engine's `lineStep`). */
export function liveTextBlockStyle(args: {
  style: EditTextStyle;
  cssScale: number;
  fontSizePx: number;
}): CSSProperties {
  const { style, cssScale, fontSizePx } = args;
  const lineHeight = style.lineHeight ?? LIVE_TEXT_DEFAULT_LINE_HEIGHT;
  return {
    color: colorToHex(style.color),
    fontFamily: fontFamilyFor(style.font),
    fontSize: `${fontSizePx}px`,
    letterSpacing: `${(style.charSpacing ?? 0) * cssScale}px`,
fontWeight: style.bold === true ? 700 : 400,
    fontStyle: style.italic === true ? "italic" : "normal",
    // Set on the block AND on each line: the block reading is what an
    // inspector of `.edit-box-text` / `[data-edit-run-preview]` sees, and the
    // per-line reading is what makes the decoration explicit per wrapped line.
    textDecoration: style.underline === true ? "underline" : "none",
    lineHeight: `${fontSizePx * lineHeight}px`,
  };
}

/** Per-line box CSS: the content width and the line's alignment. The indent
 *  is a `padding-left` on the BLOCK (so every line starts at the indented
 *  content edge, exactly like the engine's `contentX`), not a per-line margin.
 *  `justify` stretches every line except the last (the engine excludes the last
 *  line from justification), which the browser needs `text-align-last` to
 *  express for an already-wrapped line. */
export function liveTextLineStyle(args: {
  style: EditTextStyle;
  layout: LiveTextLayout;
  isLast: boolean;
}): CSSProperties {
  const { style, layout, isLast } = args;
  const align = style.align ?? "left";
  const textAlign: TextAlign = align === "justify" && isLast ? "left" : align;
  return {
    width: `${layout.contentWidthPx}px`,
    textAlign,
    textDecoration: style.underline === true ? "underline" : "none",
    ...(align === "justify"
      ? { textAlignLast: isLast ? "left" : "justify" }
      : {}),
  };
}

/** The inline highlight band + baseline shift. The band is a `background`
 *  on the line's inline content (so it spans the text width like the engine's
 *  per-line rectangle); `baselineShift` positive = superscript, negative =
 *  subscript, expressed as a CSS `vertical-align` length in px so the offset
 *  magnitude matches the baked baseline. */
export function liveTextBandStyle(args: {
  style: EditTextStyle;
  cssScale: number;
}): CSSProperties {
  const { style, cssScale } = args;
  const shift = style.baselineShift ?? 0;
  return {
    ...(style.highlight !== undefined ? { background: colorToHex(style.highlight) } : {}),
    ...(shift !== 0 ? { verticalAlign: `${shift * cssScale}px` } : {}),
  };
}
