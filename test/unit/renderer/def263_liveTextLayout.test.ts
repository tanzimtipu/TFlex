// @vitest-environment node
//
// DEF-263 — the pure live-text layout helpers. These reproduce the engine's
// baked layout (`wrapTextToWidth`, `listPrefixWidth`, the text-box auto-fit in
// `drawTextBoxes`), so the Edit-mode box mirror and the run preview render the
// same wrapped lines, prefixes and fitted size the save bakes.
import { describe, expect, it } from "vitest";
import {
  LIVE_TEXT_MIN_FIT_PX,
  layoutEditTextBox,
  layoutEditTextRun,
  listPrefixText,
  listPrefixWidthPx,
  splitExplicitLines,
  styledTextWidthPx,
  wrapTextToWidthPx,
} from "../../../src/renderer/edit/liveText";

/** Deterministic 0.5em-per-glyph measure (points as px), mirroring the
 *  jsdom fallback but half-width so the expected line breaks are easy to
 *  state. */
const measure = (t: string, s: number): number => t.length * s * 0.5;

describe("DEF-263 — wrapTextToWidthPx mirrors the engine wrapping", () => {
  it("greedily wraps words to the max width", () => {
    // 4 chars/word * 0.5 * 10 = 20px per word; max 50 fits 2 words.
    const lines = wrapTextToWidthPx({
      text: "aaaa bbbb cccc dddd",
      measure,
      sizePx: 10,
      maxWidthPx: 50,
      charSpacingPx: 0,
    });
    expect(lines).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  it("preserves explicit newlines as empty-line paragraphs", () => {
    const lines = wrapTextToWidthPx({
      text: "one\n\ntwo",
      measure,
      sizePx: 10,
      maxWidthPx: 1000,
      charSpacingPx: 0,
    });
    expect(lines).toEqual(["one", "", "two"]);
  });

  it("hard-breaks a single word wider than the box", () => {
    // 10px per char at size 10; max 30 -> 3-char chunks.
    const lines = wrapTextToWidthPx({
      text: "abcdefghij",
      measure,
      sizePx: 10,
      maxWidthPx: 15,
      charSpacingPx: 0,
    });
    expect(lines).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("counts character spacing toward the measured width", () => {
    // "aa bb" = 5 glyphs -> 5*5 + 4*10 = 65 at size 10, spacing 10.
    expect(styledTextWidthPx(measure, "aa bb", 10, 10)).toBe(65);
    const lines = wrapTextToWidthPx({
      text: "aa bb",
      measure,
      sizePx: 10,
      maxWidthPx: 65,
      charSpacingPx: 10,
    });
    expect(lines).toEqual(["aa bb"]);
  });
});

describe("DEF-263 — list prefixes", () => {
  it("numbers from 1 and continues across lines", () => {
    expect(listPrefixText("none", 0)).toBe("");
    expect(listPrefixText("bullet", 0)).toBe("\u2022 ");
    expect(listPrefixText("number", 0)).toBe("1. ");
    expect(listPrefixText("number", 4)).toBe("5. ");
  });

  it("reserves the widest plausible number prefix (999. ) for wrapping", () => {
    expect(listPrefixWidthPx("bullet", measure, 10, 0)).toBe(10);
    expect(listPrefixWidthPx("number", measure, 10, 0)).toBe(25);
    expect(listPrefixWidthPx("none", measure, 10, 0)).toBe(0);
  });
});

describe("DEF-263 — layoutEditTextBox (auto-fit + indent + prefix reserve)", () => {
  it("returns one entry per wrapped line with its prefix and last-line flag", () => {
    const layout = layoutEditTextBox({
      text: "aaaa bbbb cccc dddd",
      widthPx: 50,
      heightPx: 1000,
      userSizePx: 10,
      indentPx: 0,
      lineHeight: 1.2,
      list: "number",
      charSpacingPx: 0,
      measure,
    });
    // Wrap width = 50 - 25 (number reserve) = 25 -> one word per line.
    expect(layout.lines.map((l) => l.text)).toEqual(["aaaa", "bbbb", "cccc", "dddd"]);
    expect(layout.lines.map((l) => l.prefix)).toEqual(["1. ", "2. ", "3. ", "4. "]);
    expect(layout.lines.map((l) => l.isLast)).toEqual([false, false, false, true]);
    expect(layout.fontSizePx).toBe(10);
    expect(layout.contentWidthPx).toBe(50);
  });

  it("shifts the content box and the wrap width by the indent", () => {
    const layout = layoutEditTextBox({
      text: "aaaa bbbb cccc",
      widthPx: 100,
      heightPx: 1000,
      userSizePx: 10,
      indentPx: 40,
      lineHeight: 1.2,
      list: "none",
      charSpacingPx: 0,
      measure,
    });
    expect(layout.indentPx).toBe(40);
    expect(layout.contentWidthPx).toBe(60);
    // Wrap width = 60 -> "aaaa bbbb" (45) fits, "cccc" wraps.
    expect(layout.lines.map((l) => l.text)).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("shrinks the font when the wrapped block is taller than the box", () => {
    const layout = layoutEditTextBox({
      text: "aaaa bbbb cccc dddd eeee ffff",
      widthPx: 50,
      heightPx: 20, // 3 wrapped lines need 36 > 20, so the font shrinks
      userSizePx: 10,
      indentPx: 0,
      lineHeight: 1.2,
      list: "none",
      charSpacingPx: 0,
      measure,
    });
    expect(layout.fontSizePx).toBeLessThan(10);
    expect(layout.fontSizePx).toBeGreaterThanOrEqual(LIVE_TEXT_MIN_FIT_PX);
  });

  it("uses the STORED line height in the fit (1.8 needs a smaller font than 1.2)", () => {
    const mk = (lineHeight: number): number =>
      layoutEditTextBox({
        text: "aaaa bbbb cccc dddd eeee ffff",
        widthPx: 50,
        heightPx: 36,
        userSizePx: 10,
        indentPx: 0,
        lineHeight,
        list: "none",
        charSpacingPx: 0,
        measure,
      }).fontSizePx;
    expect(mk(1.8)).toBeLessThan(mk(1.2));
  });

  it("never grows past the user size (auto-fit only shrinks)", () => {
    const layout = layoutEditTextBox({
      text: "aaaa",
      widthPx: 200,
      heightPx: 200,
      userSizePx: 12,
      indentPx: 0,
      lineHeight: 1.2,
      list: "none",
      charSpacingPx: 0,
      measure,
    });
    expect(layout.fontSizePx).toBe(12);
  });
});

describe("DEF-263 — layoutEditTextRun (explicit lines, no auto-fit)", () => {
  it("splits on explicit newlines and keeps the run size", () => {
    expect(splitExplicitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    const layout = layoutEditTextRun({
      text: "one\ntwo\nthree",
      widthPx: 100,
      userSizePx: 14,
      indentPx: 0,
      list: "bullet",
    });
    expect(layout.fontSizePx).toBe(14);
    expect(layout.lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(layout.lines.map((l) => l.prefix)).toEqual(["\u2022 ", "\u2022 ", "\u2022 "]);
  });
});