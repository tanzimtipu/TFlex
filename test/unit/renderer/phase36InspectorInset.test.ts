// @vitest-environment node
//
// Phase 36 (chunk 5) — the panel-inset invariants AT THE INSPECTOR'S WIDTH.
//
// The Inspector replaces the retired All-tools palette in the SAME inset
// machinery, so the Phase 33/34 + DEF-286/287 behaviour must hold with the new
// single width (264px, the 240-280px band): BOTH panes shrink equally, the
// page-area floor holds at every supported width, the stored split fraction
// re-clamps on a geometry change, and the DEF-297 frosted rules are untouched.
//
// The trigger paths (a window resize and the panel open/close driving the
// stored fraction) are pinned in `def287_fractionReclamp.test.tsx`, which now
// uses INSPECTOR_W_PX; this suite pins the pure geometry + the stylesheet.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INSPECTOR_W_PX,
  MIN_PAGE_WIDTH_PX,
  MIN_PANE_PANE_PX,
  clampSplitFraction,
  effectiveToolsInset,
  insetCapFor,
  multiPaneGeometry,
} from "../../../src/renderer/components/multiPaneLayout";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(STYLES_PATH, "utf8");
const CLEAN = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Phase 36 chunk 5 — the Inspector's width", () => {
  it("sits in the spec's 240-280px band", () => {
    expect(INSPECTOR_W_PX).toBeGreaterThanOrEqual(240);
    expect(INSPECTOR_W_PX).toBeLessThanOrEqual(280);
  });

  it("is the ONE width the stylesheet declares (no layout modes)", () => {
    const driver = CLEAN.match(/\.app-main\[data-tools-open="true"\]\s*\{([^}]*)\}/);
    expect(driver, "the inset driver rule missing").not.toBeNull();
    expect(driver?.[1] ?? "").toMatch(/--tools-panel-w:\s*264px/);
    expect(driver?.[1] ?? "").toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*264px\)/);
    expect(CLEAN).not.toMatch(/\[data-tools-mode="grid"\]/);
  });

  it("the Inspector surface consumes the shared token (no magic width)", () => {
    const rule = CLEAN.match(/\.inspector\s*\{([^}]*)\}/);
    expect(rule, ".inspector rule missing").not.toBeNull();
    expect(rule?.[1] ?? "").toMatch(/width:\s*var\(--tools-panel-w,\s*264px\)/);
  });
});

describe("Phase 36 chunk 5 — DEF-286: both panes shrink EQUALLY", () => {
  it("gives each pane up half the Inspector inset at every split", () => {
    for (const [width, fraction] of [
      [1600, 0.5],
      [1200, 0.35],
      [1000, 0.65],
    ] as const) {
      const closed = multiPaneGeometry(width, 0, fraction);
      const open = multiPaneGeometry(width, INSPECTOR_W_PX, fraction);
      const shrinkA = closed.paneA.width - open.paneA.width;
      const shrinkB = closed.paneB.width - open.paneB.width;
      expect(shrinkA, `pane A at ${width}`).toBeCloseTo(INSPECTOR_W_PX / 2, 6);
      expect(shrinkB, `pane B at ${width}`).toBeCloseTo(INSPECTOR_W_PX / 2, 6);
      expect(Math.abs(shrinkA - shrinkB)).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe("Phase 36 chunk 5 — DEF-287: the page-area floor holds", () => {
  it("keeps both panes' page area at the floor at the 640px minimum window", () => {
    const g = multiPaneGeometry(640, INSPECTOR_W_PX, 0.5);
    expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    expect(g.paneA.width).toBeGreaterThanOrEqual(MIN_PANE_PANE_PX);
    expect(g.paneB.width).toBeGreaterThanOrEqual(MIN_PANE_PANE_PX);
  });

  it("caps the requested inset rather than collapsing a pane below its floor", () => {
    const stage = 480;
    const cap = insetCapFor(stage);
    const inset = effectiveToolsInset(stage, INSPECTOR_W_PX);
    expect(inset).toBeLessThan(INSPECTOR_W_PX);
    expect(inset).toBe(cap);
    const g = multiPaneGeometry(stage, INSPECTOR_W_PX, 0.5);
    expect(g.inset).toBe(inset);
    expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
  });
});

describe("Phase 36 chunk 5 — the stored fraction re-clamps at the new width", () => {
  it("clamps a carried fraction up to the pane minimum (and is idempotent)", () => {
    const once = clampSplitFraction(1000, INSPECTOR_W_PX, 0.35);
    expect(once).toBeCloseTo((320 + INSPECTOR_W_PX / 2) / 1000, 9);
    expect(clampSplitFraction(1000, INSPECTOR_W_PX, once)).toBe(once);
  });

  it("pins to 0.5 when even an even split cannot satisfy the minimum", () => {
    expect(clampSplitFraction(640, INSPECTOR_W_PX, 0.35)).toBe(0.5);
    expect(clampSplitFraction(500, INSPECTOR_W_PX, 0.9)).toBe(0.5);
  });
});

describe("Phase 36 chunk 5 — DEF-297 frosted rules are untouched", () => {
  it("the frosted single-mode scroller rule still confines the opaque canvas", () => {
    const selector = ':root[data-theme="frosted"] .tab-stage[data-multi-mode="false"] .document-scroller';
    const idx = CLEAN.indexOf(selector);
    expect(idx).toBeGreaterThan(-1);
    const body = CLEAN.slice(CLEAN.indexOf("{", idx) + 1, CLEAN.indexOf("}", idx));
    expect(body).toMatch(/linear-gradient\(/);
    expect(body).toMatch(/transparent\s+var\(--tf-chrome-y/);
  });

  it("the Inspector stylesheet is token-only (no hardcoded colours)", () => {
    const idx = CLEAN.indexOf(".inspector {");
    const block = CLEAN.slice(idx, CLEAN.indexOf(".inspector .ocr-suspects-panel"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});
