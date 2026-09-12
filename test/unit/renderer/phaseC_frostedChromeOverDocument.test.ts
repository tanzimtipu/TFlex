// @vitest-environment jsdom
//
// Phase C — frosted chrome OVER the document (full-bleed scroller).
//
// The frosted sheets only read as real glass when page content can
// pass BEHIND them. The base layout keeps the chrome rows in-flow
// ABOVE the .document-scroller, so the backdrop-filter has nothing
// but flat colour to diffuse — the "frosted looks like a solid light
// theme" defect. The fix:
//   - .workspace-main becomes the positioning context (position:
//     relative).
//   - .document-scroller goes full-bleed (absolute inset 0) under
//     the chrome rows in the frosted theme only.
//   - .toolbar / .ann-toolbar / .search-bar / .edit-toolbar float
//     above it (position: relative; z-index: 1) — one comma-joined
//     rule.
//   - .document-content pads its TOP by the measured chrome stack
//     (--tf-chrome-y) so the first page sits below the floating rows
//     at rest while still scrolling under them.
//
// The existing Phase-D contract pins the 14-surface blur list and the
// PDF-safety audit; this test pins the LAYOUT half of the fix (the
// base in-flow rules must stay in the LIGHT / DARK themes — only the
// frosted scope overrides).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readStyles(): string {
  const file = resolve(process.cwd(), "src/renderer/styles.css");
  return readFileSync(file, "utf8");
}

const cssClean = readStyles().replace(/\/\*[\s\S]*?\*\//g, "");

/** First rule body matching `selector {` */
function firstRule(selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(cssClean);
  return m?.[1] ?? "";
}

/** LAST rule body matching `selector {` — the layout override blocks
 *  live at the END of the file, AFTER the earlier frosted
 *  background / shadow blocks that also match a bare selector
 *  pattern. */
function lastRule(selector: string): string {
  const ms = [...cssClean.matchAll(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
  return ms.at(-1)?.[1] ?? "";
}

describe("Phase C — frosted chrome over the document (full-bleed scroller)", () => {
  it(".workspace-main is the positioning context for the scroller + floating chrome (frosted scope)", () => {
    const m = /:root\[data-theme="frosted"\]\s+\.workspace-main\s*\{([\s\S]*?)\n\}/m
      .exec(cssClean);
    expect(m).not.toBeNull();
    if (m === null) return;
    const body = m[1] ?? "";
    expect(body).toMatch(/position:\s*relative/);
  });

  it("the frosted .document-scroller is full-bleed (absolute inset 0, under the chrome)", () => {
    // The LAST frosted-scoped block is the layout override (the first
    // is the workspace tonal-gradient block).
    const body = lastRule(":root\\[data-theme=\"frosted\"\\]\\s+\\.document-scroller");
    expect(body, "frosted .document-scroller layout override missing").not.toBe("");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toMatch(/right:\s*0/);
    expect(body).toMatch(/bottom:\s*0/);
    expect(body).toMatch(/left:\s*0/);
    // z-index 0 keeps the scroller UNDER the floating chrome rows.
    expect(body).toMatch(/z-index:\s*0/);
  });

  it("the workspace chrome rows float above the scroller (frosted scope, z-index 1)", () => {
    // The four rows live in ONE comma-joined frosted rule at the end
    // of the file (the trailing `.edit-toolbar` must ALSO be
    // frosted-prefixed so the base rule's body is never captured).
    const m = /:root\[data-theme="frosted"\]\s+\.toolbar,[\s\S]*?:root\[data-theme="frosted"\]\s+\.edit-toolbar\s*\{([\s\S]*?)\n\}/
      .exec(cssClean);
    expect(m, "frosted chrome-row float rule missing").not.toBeNull();
    if (m === null) return;
    const body = m[1] ?? "";
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/z-index:\s*1/);
  });

  it("the frosted .document-content pads down by the measured chrome stack (--tf-chrome-y)", () => {
    const body = lastRule(":root\\[data-theme=\"frosted\"\\]\\s+\\.document-content");
    expect(body, "frosted .document-content padding override missing").not.toBe("");
    expect(body).toMatch(/--tf-chrome-y/);
    // Phase 14.2 FIX 8 — the page sits 16px (the floating minimum)
    // below the floating chrome stack and 16px above the bottom edge,
    // instead of the old 28px pair.
    expect(body).toMatch(/padding:\s*calc\(var\(--tf-chrome-y[^)]*\)\s*\+\s*16px\)\s+0\s+16px/);
  });

  it("the base (light / dark) layout is untouched — in-flow chrome, in-flow scroller (no regressions)", () => {
    // The base .document-scroller must keep its in-flow box: the
    // absolute override lives ONLY in the frosted block.
    const base = firstRule("\\.document-scroller");
    expect(base).toMatch(/position:\s*relative/);
    expect(base).toMatch(/height:\s*100%/);
    expect(cssClean).not.toMatch(
      /:root\[data-theme="dark"\]\s+\.document-scroller\s*\{[^}]*position:\s*absolute/s,
    );
    // The chrome rows are NOT rendered over the scroller in any
    // theme except the frosted override (no base z-index on them).
    const toolbarBase = firstRule("\\.toolbar");
    expect(toolbarBase).not.toMatch(/z-index\s*:/);
  });

  it("DEF-178/179 — conditional chrome rows and the scroller own pinned grid rows of .workspace-main", () => {
    // Regression guard for the edit-mode dead-clicks / mid-viewport
    // chrome regressions. .workspace-main is a 5-row grid; the two
    // CONDITIONAL chrome rows (edit toolbar, search bar) and the
    // scroller must be pinned to fixed rows so grid auto-placement
    // can never drop one of them into the 1fr row. Before the fix,
    // the edit toolbar auto-placed into row 3 (1fr), STRETCHED to
    // the full remaining height, covered the full-bleed scroller
    // with a giant hit surface (armed edit tools did nothing — every
    // page click hit the toolbar) and inflated the --tf-chrome-y
    // measure by the whole viewport (the document got shoved a
    // viewport down — DEF-178 / DEF-179).
    const main = firstRule("\\.workspace-main");
    expect(main, ".workspace-main must declare five explicit rows").toMatch(
      /grid-template-rows:\s*auto\s+auto\s+auto\s+auto\s+1fr/,
    );
    // Each conditional chrome row is pinned ABOVE the scroller's row.
    const edit = firstRule("\\.edit-toolbar");
    expect(edit, ".edit-toolbar must be pinned to grid row 3").toMatch(/grid-row:\s*3/);
    const search = firstRule("\\.search-bar");
    expect(search, ".search-bar must be pinned to grid row 4").toMatch(/grid-row:\s*4/);
    const scroller = firstRule("\\.document-scroller");
    expect(scroller, ".document-scroller must own the 1fr row (5)").toMatch(/grid-row:\s*5/);
  });
});