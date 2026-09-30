// B4 — OCR suspects panel is a TOP BAR + OCR invisible-text
// transparency contracts.
//
// jsdom cannot apply styles.css, so these are textual scans of the
// stylesheet — the same established pattern as formsCssStacking /
// updateIndicatorCss. They pin:
//   1. The suspects panel is a FLOW bar that reserves space at the
//      top of `.app-main` (order: -1, flex-shrink: 0, fixed height
//      via `--ocr-bar-h`), NOT an absolute overlay, so it can never
//      cover the thumbnail rail / toolbar / palette (DEF-126). The
//      old rule had a dead calc gap (56px token vs the real 44px
//      toolbar) and overlapped the left rail.
//   2. The bar is semi-transparent (rgba background + backdrop
//      blur) per DEF-126.
//   3. The Tools palette shifts down below the bar when it is open
//      (`.app-main:has(.ocr-suspects-panel) .tools-palette`).
//   4. The OCR invisible-text layer (pdf.js `.textLayer` spans)
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

describe("DEF-126 — OCR suspects panel reserves space (never covers the rail / palette)", () => {
  it("the panel is a FLOW bar, not an absolute overlay (no top/left/right/z-index calc)", () => {
    const css = stylesCss();
    // Phase 36 (chunk 5) added `.inspector .ocr-suspects-panel` (the Inspector's
    // inline re-parent override), which contains the same substring. Anchor to a
    // line that STARTS with the selector so this scans the bar's own rule.
    const panel = css.slice(
      css.indexOf("\n.ocr-suspects-panel {") + 1,
      css.indexOf(".ocr-suspects-header"),
    );
    // Flow element at the top of the flex column.
    expect(panel).toMatch(/order:\s*-1;/);
    expect(panel).toMatch(/flex-shrink:\s*0;/);
    // Fixed height via the shared token so the palette offset stays
    // exact (no dead gap, no overlap drift).
    expect(panel).toMatch(/height:\s*var\(--ocr-bar-h/);
    // The panel is NOT an absolute-positioned overlay anymore: the
    // old dead-gap calc and the old full-width overlay geometry are
    // gone.
    expect(panel).not.toMatch(/position:\s*absolute/);
    expect(panel).not.toMatch(/top:\s*calc\(var\(--toolbar-h/);
    expect(panel).not.toMatch(/left:\s*0;/);
    // The old right-rail surface shape is gone too.
    expect(panel).not.toMatch(/width:\s*280px/);
    expect(panel).not.toMatch(/border-left/);
  });

  it("the bar is semi-transparent with a backdrop blur (not a fully opaque --bg-rail slab)", () => {
    const css = stylesCss();
    // Phase 36 (chunk 5) added `.inspector .ocr-suspects-panel` (the Inspector's
    // inline re-parent override), which contains the same substring. Anchoring to
    // a line that STARTS with the selector keeps this slice on the bar's OWN
    // rules: a bare indexOf found the `.inspector` occurrence and the slice then
    // ran across ~3k lines of unrelated CSS until the dark-theme override. Phase 59
    // (item 8) inserted the Preferences layout — whose `.prefs-rail` legitimately
    // paints `background: var(--bg-rail)` — inside that over-wide span, tripping
    // the "no opaque rail slab" assertion on a NEIGHBOURING rule. The assertion is
    // unchanged: it still fails if `.ocr-suspects-panel` itself uses --bg-rail.
    const start = css.indexOf("\n.ocr-suspects-panel {");
    expect(start, "the .ocr-suspects-panel rule must exist").toBeGreaterThan(-1);
    const panel = css.slice(
      start + 1,
      css.indexOf(":root[data-theme=\"dark\"] .ocr-suspects-panel"),
    );
    expect(panel).toMatch(/background:\s*rgba\(/);
    expect(panel).toMatch(/backdrop-filter:\s*blur\(/);
    expect(panel).not.toMatch(/background:\s*var\(--bg-rail\)/);
    // The dark theme override is translucent too.
    const dark = css.slice(
      css.indexOf(":root[data-theme=\"dark\"] .ocr-suspects-panel"),
      css.indexOf("/* DEF-126 — Tools palette downshift"),
    );
    expect(dark).toMatch(/background:\s*rgba\(/);
  });

  it("the Tools palette shifts below the bar when the panel is open (:has downshift)", () => {
    const css = stylesCss();
    const toolsBlock = css.slice(css.indexOf(".tools-palette {"), css.indexOf(".tools-palette-grid"));
    // The palette's baseline top (no bar open) stays as-is. Phase 19
    // retired the second annotation row, so the offset is the single
    // CommandBar token and the palette never covers it.
    expect(toolsBlock).toMatch(/top:\s*var\(--toolbar-h,\s*52px\)/);
    expect(toolsBlock).not.toMatch(/--ann-toolbar-h/);
    expect(toolsBlock).toMatch(/z-index:\s*30/);
    // With the bar open, the palette adds the bar's height. The
    // rule is found via lastIndexOf + "{" because the token block
    // comment mentions the selector first.
    const downshiftStart = css.lastIndexOf(".app-main:has(.ocr-suspects-panel) .tools-palette {");
    expect(downshiftStart).toBeGreaterThan(-1);
    const downshift = css.slice(downshiftStart, css.indexOf(".ocr-suspects-header"));
    // Phase 19 — the downshift sums the bar + the single CommandBar row.
    expect(downshift).toMatch(/top:\s*calc\(\s*var\(--ocr-bar-h/);
    expect(downshift).toMatch(/var\(--toolbar-h/);
    expect(downshift).not.toMatch(/--ann-toolbar-h/);
    expect(downshift).toMatch(/148px/);
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