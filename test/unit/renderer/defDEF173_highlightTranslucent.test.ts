// DEF-173 — a committed text highlight renders as an OPAQUE orange
// block: the SVG <rect class="ann-highlight"> (and the drag-markup
// preview rect, which carries the extra .ann-preview class) paints
// fill="#e07a2d" with no alpha, hiding the text underneath. The save
// path is unaffected (backend bakes a native translucent /Highlight);
// this is the renderer overlay only.
//
// jsdom cannot apply styles.css, so this is a textual scan of the
// stylesheet — the same established pattern as bugB4_ocrTopBarCss /
// formsCssStacking. Contracts pinned:
//   1. Every rule styling a highlight rect that declares a
//      fill-opacity keeps it BELOW 1 (committed rects + the drag
//      preview), so the underlying text stays readable.
//   2. The committed rule and the preview rule both carry the
//      translucent fill.
//   3. Underline/strikeout are line strokes (no fill); the
//      fill-opacity never leaks onto `.ann-markup line`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stylesCss(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

describe("DEF-173 — highlight rects are translucent (text stays readable)", () => {
  it("every ann-highlight rect rule that sets fill-opacity keeps it below 1", () => {
    const css = stylesCss();
    // Pull every rule block whose selector references an
    // ann-highlight rect: the committed `.ann-markup rect.ann-highlight`
    // and the drag preview `rect.ann-highlight.ann-preview`.
    const rules = [...css.matchAll(/[^{}]*rect\.ann-highlight[^{}]*\{([^{}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    // At least one rule must carry the translucent fill (the
    // pointer-events rule alone would fail this contract).
    const translucent = rules.filter((m) => /fill-opacity\s*:/.test(m[1] ?? ""));
    expect(translucent.length).toBeGreaterThan(0);
    for (const m of translucent) {
      const selector = (m[0] ?? "").trim();
      const body = m[1] ?? "";
      const op = /fill-opacity:\s*([0-9]*\.?[0-9]+)/.exec(body);
      expect(op, `rule "${selector}" must declare a numeric fill-opacity`).not.toBeNull();
      if (op === null) continue;
      const value = Number(op[1]);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("the committed rule and the drag-preview rule share the translucent fill", () => {
    const css = stylesCss();
    // The committed rect rule and the preview rule collapse into one
    // selector list sharing the same fill-opacity declaration.
    expect(css).toMatch(
      /\.ann-markup\s+rect\.ann-highlight,\s*rect\.ann-highlight\.ann-preview\s*\{[\s\S]*?fill-opacity:\s*0\.35/,
    );
  });

  it("underline/strikeout line strokes keep full opacity (fill-opacity never touches .ann-markup line)", () => {
    const css = stylesCss();
    const lineRules = [...css.matchAll(/[^{}]*\.ann-markup\s+line[^{}]*\{([^{}]*)\}/g)];
    expect(lineRules.length).toBeGreaterThan(0);
    for (const m of lineRules) {
      const body = m[1] ?? "";
      // Underline/strikeout are strokes, not fills — a translucent
      // fill-opacity would wrongly wash them out.
      expect(body).not.toMatch(/fill-opacity\s*:/);
    }
  });
});