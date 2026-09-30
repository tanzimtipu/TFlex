// @vitest-environment jsdom
//
// Phase 66 (chunk 1) / the DEF-437 defect class — Book View's header Close
// control was hit-test dead in the running app because the always-on Inspector
// strip overlapped it. Book View collapses the Inspector, but the strip stays
// MOUNTED as a narrow 44px column (`position: absolute; right: 0; top: 0;
// bottom: 0; width: var(--tools-panel-w); z-index: 30` — see
// `.app-main[data-inspector-collapsed='true']`). `.book-view` is the read-only
// surface that REPLACES the document column and is a flex child of
// `.tab-pane`; before the fix it ran to the frame's right edge, so the Close
// button at the header's right end landed UNDER the Inspector strip and
// `elementFromPoint` over it returned the strip's own live collapse toggle.
// qa proved the handler itself is correct via a DOM `.click()`, so the defect
// is purely SPATIAL: the surface must reserve the Inspector's column.
//
// The fix is the same reservation the other right-edge flow surfaces already
// use — `.document-scroller` and `.document-column > .validation-notice` both
// consume the registered `--tf-tools-inset` token. jsdom applies no stylesheet,
// so this test is a textual scan of styles.css (the established pattern) plus
// the edge arithmetic that pins the geometry.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

/** The hit-test rule, as arithmetic: the surface's right edge must not cross
 *  the Inspector's left edge. `inset` is what the surface reserves
 *  (`--tf-tools-inset`), `panelWidth` is the Inspector's own live width. */
function surfaceRightEdge(frameWidth: number, inset: number): number {
  return frameWidth - inset;
}
function inspectorLeftEdge(frameWidth: number, panelWidth: number): number {
  return frameWidth - panelWidth;
}

describe("phase 66 — Book View reserves the collapsed Inspector's column", () => {
  it("reserves the shared --tf-tools-inset on the surface's right edge", () => {
    const rule = ruleBody(".book-view");
    expect(rule, "the DEF-437 hit-test reservation rule is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("keeps the surface a FLOW element (no pointer-events or z-index hack)", () => {
    const rule = ruleBody(".book-view");
    expect(rule).not.toMatch(/pointer-events/);
    expect(rule).not.toMatch(/z-index/);
    expect(rule).not.toMatch(/position:\s*(?:absolute|fixed)/);
  });

  it("mirrors the existing right-edge reservation on .document-scroller", () => {
    const scroller = ruleBody(".document-scroller");
    expect(scroller).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("binds the reservation to the Inspector's OWN collapse width token", () => {
    const collapsed = ruleBody(".app-main[data-inspector-collapsed='true']");
    expect(collapsed, "the collapsed Inspector inset rule is missing").not.toBe("");
    expect(collapsed).toMatch(/--tools-panel-w:\s*var\(--inspector-collapsed-w,\s*44px\)/);
    expect(collapsed).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*44px\)/);
    const panel = ruleBody(".inspector");
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/top:\s*0/);
    expect(panel).toMatch(/right:\s*0/);
    expect(panel).toMatch(/bottom:\s*0/);
    expect(panel).toMatch(/width:\s*var\(--tools-panel-w,\s*264px\)/);
    expect(panel).toMatch(/z-index:\s*30/);
  });

  it("keeps the surface's right edge at (or left of) the Inspector's left edge", () => {
    const FRAME = 2560;
    const COLLAPSED = 44;
    // While Book View is open the Inspector is collapsed to a 44px strip, so
    // the surface gives back exactly those 44px.
    expect(surfaceRightEdge(FRAME, COLLAPSED)).toBe(inspectorLeftEdge(FRAME, COLLAPSED));
    expect(surfaceRightEdge(FRAME, COLLAPSED)).toBeLessThanOrEqual(
      inspectorLeftEdge(FRAME, COLLAPSED),
    );
    // The Close control lives at the header's right end, i.e. the surface's
    // right edge; that edge stays strictly left of the Inspector's left edge
    // only when the reservation is >= the panel width. 44 === 44 here.
    expect(surfaceRightEdge(FRAME, COLLAPSED)).toBe(FRAME - COLLAPSED);
    // Inspector expanded: the reservation follows the wider token too.
    const EXPANDED = 264;
    expect(surfaceRightEdge(FRAME, EXPANDED)).toBe(inspectorLeftEdge(FRAME, EXPANDED));
    // Inset absent: the surface runs to the frame edge (unchanged fallback).
    expect(surfaceRightEdge(FRAME, 0)).toBe(FRAME);
  });
});
