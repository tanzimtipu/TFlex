// @vitest-environment jsdom
//
// B3 — annotationColorToCss must resolve any custom hex correctly.
//
// The renderer stores the active annotation color as either a
// built-in name (`"yellow"`) or a free-form hex string picked
// through the ColorPalette (DEF-070). The picker's
// `normalizeHex` always returns lowercase `#rrggbb` so the happy
// path is fine. The bug: legacy / hand-typed / round-tripped hex
// values can be uppercase (`#ABCDEF`), 3-digit shorthand (`#0F0`),
// or missing the leading `#` (`abcdef`) and the original
// `annotationColorToCss` only matched lowercase / 6-or-3-digit /
// #-prefixed forms. Anything else fell through to `currentColor`,
// so the highlight / rectangle / arrow / etc. painted invisible —
// the user saw the bounding box (rect / ellipse preview) without
// the colour, and a freshly-saved annotation came back from the
// engine painted in `currentColor` if anything in the chain had
// re-cased the string.
//
// We test the new behaviour: every accepted hex form resolves to
// the same canonical lowercase hex the picker would have
// produced. Anything outside that envelope still falls through
// to `currentColor` so the overlay doesn't paint a wrong colour
// by accident (the failure mode is "highlight invisible", not
// "highlight wrong shade").
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLOR_HEX,
  annotationColorToCss,
  type AnnotationColorValue,
} from "../../../src/renderer/annotations/model";

describe("B3 — annotationColorToCss resolves any custom hex correctly", () => {
  it("lowercase #rrggbb resolves verbatim (happy path)", () => {
    expect(annotationColorToCss("#abcdef")).toBe("#abcdef");
    expect(annotationColorToCss("#0000ff")).toBe("#0000ff");
  });

  it("uppercase #RRGGBB resolves to lowercase canonical form", () => {
    expect(annotationColorToCss("#ABCDEF")).toBe("#abcdef");
    expect(annotationColorToCss("#0000FF")).toBe("#0000ff");
  });

  it("mixed-case #RrGgBb resolves to lowercase canonical form", () => {
    expect(annotationColorToCss("#aBcDeF")).toBe("#abcdef");
  });

  it("3-digit shorthand #rgb expands to #rrggbb", () => {
    expect(annotationColorToCss("#0f0")).toBe("#00ff00");
    expect(annotationColorToCss("#F0F")).toBe("#ff00ff");
    expect(annotationColorToCss("#abc")).toBe("#aabbcc");
  });

  it("uppercase 3-digit shorthand expands + lowercases", () => {
    expect(annotationColorToCss("#0F0")).toBe("#00ff00");
    expect(annotationColorToCss("#ABC")).toBe("#aabbcc");
  });

  it("hex without leading # resolves (picker's hex field has it, but legacy values may not)", () => {
    expect(annotationColorToCss("abcdef")).toBe("#abcdef");
    expect(annotationColorToCss("ABCDEF")).toBe("#abcdef");
    expect(annotationColorToCss("0f0")).toBe("#00ff00");
  });

  it("hex with surrounding whitespace still resolves", () => {
    expect(annotationColorToCss("  #abcdef  ")).toBe("#abcdef");
    expect(annotationColorToCss("\tabcdef\n")).toBe("#abcdef");
  });

  it("every built-in color name still resolves to its canonical hex", () => {
    for (const [name, hex] of Object.entries(ANNOTATION_COLOR_HEX)) {
      expect(annotationColorToCss(name as AnnotationColorValue)).toBe(hex);
    }
  });

  it("the same canonical hex is returned regardless of input case (uppercase == lowercase)", () => {
    expect(annotationColorToCss("#ff0000")).toBe(annotationColorToCss("#FF0000"));
    expect(annotationColorToCss("#ff0000")).toBe(annotationColorToCss("FF0000"));
    expect(annotationColorToCss("#ff0000")).toBe(annotationColorToCss("ff0000"));
  });

  it("garbage values still fall through to currentColor (no false-positive paints)", () => {
    expect(annotationColorToCss("not a color")).toBe("currentColor");
    expect(annotationColorToCss("#xyzxyz")).toBe("currentColor");
    expect(annotationColorToCss("#12345")).toBe("currentColor"); // 5 chars
    expect(annotationColorToCss("#1234567")).toBe("currentColor"); // 7 chars
    expect(annotationColorToCss("")).toBe("currentColor");
    // Non-string values (defensive — type system should already
    // prevent this, but the renderer used to throw on some of
    // these before the function was hardened).
    expect(annotationColorToCss(undefined as unknown as AnnotationColorValue)).toBe(
      "currentColor",
    );
    expect(annotationColorToCss(null as unknown as AnnotationColorValue)).toBe(
      "currentColor",
    );
    expect(annotationColorToCss(42 as unknown as AnnotationColorValue)).toBe(
      "currentColor",
    );
  });
});