// B4 — OCR suspects panel is a TOP BAR + OCR invisible-text
// transparency contracts.
//
// jsdom cannot apply styles.css, so these are textual scans of the
// stylesheet — the same established pattern as formsCssStacking /
// updateIndicatorCss. They pin:
//   1. The suspects panel is a full-width top bar (left: 0; right:
//      0) with z-index ABOVE the Tools palette's 30, so an open
//      palette can never cover the suspect entries (B4).
//   2. The OCR invisible-text layer (pdf.js `.textLayer` spans)
//      stays transparent at the fill level too
//      (`-webkit-text-fill-color`), including on selection, so no
//      "overlapping white text after OCR" can paint over the page.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stylesCss(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

describe("B4 — OCR suspects panel stacks ABOVE the Tools palette", () => {
  it("the panel is a full-width top bar (not a 280px right rail)", () => {
    const css = stylesCss();
    const panel = css.slice(css.indexOf(".ocr-suspects-panel {"));
    // The panel must span the full width...
    expect(panel).toMatch(/left:\s*0;/);
    expect(panel).toMatch(/right:\s*0;/);
    // ...and must NOT be the old 280px right-rail surface.
    expect(panel).not.toMatch(/width:\s*280px/);
    expect(panel).not.toMatch(/border-left/);
  });

  it("the panel z-index (40) is above the Tools palette's 30", () => {
    const css = stylesCss();
    const toolsBlock = css.slice(css.indexOf(".tools-palette {"), css.indexOf(".tools-palette-grid"));
    expect(toolsBlock).toMatch(/z-index:\s*30/);
    const panelBlock = css.slice(css.indexOf(".ocr-suspects-panel {"), css.indexOf(".ocr-suspects-header"));
    expect(panelBlock).toMatch(/z-index:\s*40/);
  });
});

describe("B4 — OCR invisible text can never render as white glyphs", () => {
  it("the .textLayer span rule pins the fill transparent (color + -webkit-text-fill-color)", () => {
    const css = stylesCss();
    const rule = css.slice(css.indexOf(".textLayer :is(span, br) {"));
    expect(rule).toMatch(/color:\s*transparent/);
    expect(rule).toMatch(/-webkit-text-fill-color:\s*transparent/);
  });

  it("selection over the textLayer keeps the fill transparent so no white overlap", () => {
    const css = stylesCss();
    const rule = css.slice(css.indexOf(".textLayer :is(span, br)::selection {"));
    expect(rule).toMatch(/color:\s*transparent/);
    expect(rule).toMatch(/-webkit-text-fill-color:\s*transparent/);
  });
});