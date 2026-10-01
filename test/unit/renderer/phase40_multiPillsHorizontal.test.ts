// @vitest-environment jsdom
//
// Phase 40 (item 1) — Multi Mode's page and zoom controls are laid out
// HORIZONTALLY, one on each side of that pane's own canvas: the page pill at
// the pane's left, the zoom pill at its right (mirroring single mode's
// page-bottom-left / zoom-bottom-right). They are NEVER stacked at any window
// width — the Phase 39 stacked band is superseded.
//
// These tests pin the pure geometry (the band decision, the layer width, the
// three fit tiers and the two pill boxes at the widths the acceptance matrix
// measures: 1442 / 700 / 640 with one and two documents) plus the static CSS
// contract that mirrors it. A regression to the old stacked placement (the
// `bottom: 58px` zoom raise) or to the old 230px band threshold fails here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MULTI_PILL_BAND_PX,
  MULTI_PILL_COMPACT_MIN_LAYER_PX,
  MULTI_PILL_FULL_MIN_LAYER_PX,
  MULTI_PILL_MICRO_MIN_LAYER_PX,
  multiPaneGeometry,
  multiPillBandPx,
  multiPillLayerWidthPx,
  multiPillMetrics,
  multiPillSpanPx,
  multiPillTier,
  stripAndPageWidths,
} from "../../../src/renderer/components/multiPaneLayout";
import { PILL_ROW_GAP } from "../../../src/renderer/state/pillFit";

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function area(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return +(w * h).toFixed(1);
}

/** The pane-local boxes of the two pills exactly as the CSS lays them out.
 *  The pills layer spans the page column, or the whole pane inside the
 *  reserved band; the page pill is anchored to the layer's left and the zoom
 *  pill to its right, both at the pane's bottom inset. */
function pillBoxes(
  pane: "A" | "B",
  paneWidth: number,
  paneHeight: number,
): { page: Box; zoom: Box; layerWidth: number; tier: string } {
  const layerWidth = multiPillLayerWidthPx(paneWidth);
  const tier = multiPillTier(layerWidth);
  const m = multiPillMetrics(tier);
  // Pane A's page column is its leftmost track, pane B's its rightmost (each
  // pane's strip is at its INNER edge).
  const layerLeft = pane === "A" ? 0 : paneWidth - layerWidth;
  const bottom = paneHeight - 12;
  const box = (left: number, w: number): Box => ({
    left,
    top: bottom - m.height,
    right: left + w,
    bottom,
  });
  return {
    page: box(layerLeft + m.inset, m.pageW),
    zoom: box(layerLeft + layerWidth - m.inset - m.zoomW, m.zoomW),
    layerWidth,
    tier,
  };
}

/** The pane widths the acceptance matrix produces (pane = (stage - 8) / 2 with
 *  the stage measured at 1114 / 592 / 532 for the 1442 / 700 / 640 windows). */
const MATRIX: ReadonlyArray<{ window: number; pane: number }> = [
  { window: 1442, pane: 553 },
  { window: 700, pane: 292 },
  { window: 640, pane: 262 },
];

describe("Phase 40 item 1 — Multi Mode's pills are HORIZONTAL per pane", () => {
  it("reserves the one-row band only when the page column cannot hold the full pair", () => {
    // The fit width is the FULL horizontal pair (FULL_MIN_CANVAS + guard).
    expect(MULTI_PILL_FULL_MIN_LAYER_PX).toBeGreaterThanOrEqual(404);
    // pane 558 => page 408: the full pair fits, no band.
    expect(stripAndPageWidths(558).page).toBe(408);
    expect(multiPillBandPx(558)).toBe(0);
    // pane 557 => page 407: one pixel short, the band is reserved.
    expect(multiPillBandPx(557)).toBe(MULTI_PILL_BAND_PX);
    // The band is ONE pill row (42) + the 12px inset + a 2px clearance.
    expect(MULTI_PILL_BAND_PX).toBe(56);
    // The default window's pane (553) and the measured narrow panes.
    expect(multiPillBandPx(553)).toBe(MULTI_PILL_BAND_PX);
    expect(multiPillBandPx(721)).toBe(0);
    expect(multiPillBandPx(292)).toBe(MULTI_PILL_BAND_PX);
    expect(multiPillBandPx(262)).toBe(MULTI_PILL_BAND_PX);
    // No measurement / no pane => no band (jsdom, closed panes).
    expect(multiPillBandPx(0)).toBe(0);
    expect(multiPillBandPx(Number.NaN)).toBe(0);
  });

  it("spans the layer across exactly the strip column only when a band is reserved", () => {
    expect(multiPillSpanPx(558)).toBe(0);
    expect(multiPillLayerWidthPx(558)).toBe(stripAndPageWidths(558).page);
    expect(multiPillSpanPx(292)).toBe(stripAndPageWidths(292).strip);
    expect(multiPillLayerWidthPx(292)).toBe(292);
    expect(multiPillLayerWidthPx(262)).toBe(262);
    expect(multiPillSpanPx(262)).toBe(stripAndPageWidths(262).strip);
  });

  it("resolves the three fit tiers from the layer width, and every tier fits", () => {
    expect(multiPillTier(MULTI_PILL_FULL_MIN_LAYER_PX)).toBe("full");
    expect(multiPillTier(MULTI_PILL_FULL_MIN_LAYER_PX - 1)).toBe("compact");
    expect(multiPillTier(MULTI_PILL_COMPACT_MIN_LAYER_PX)).toBe("compact");
    expect(multiPillTier(MULTI_PILL_COMPACT_MIN_LAYER_PX - 1)).toBe("micro");
    // The micro pair's own floor: both insets + both pills + the row gap.
    expect(MULTI_PILL_MICRO_MIN_LAYER_PX).toBe(
      2 * multiPillMetrics("micro").inset +
        multiPillMetrics("micro").pageW +
        PILL_ROW_GAP +
        multiPillMetrics("micro").zoomW,
    );
    // Every tier's pair fits inside its layer with the row gap to spare.
    for (const tier of ["full", "compact", "micro"] as const) {
      const m = multiPillMetrics(tier);
      const need = 2 * m.inset + m.pageW + PILL_ROW_GAP + m.zoomW;
      const floor =
        tier === "full"
          ? MULTI_PILL_FULL_MIN_LAYER_PX
          : tier === "compact"
            ? MULTI_PILL_COMPACT_MIN_LAYER_PX
            : MULTI_PILL_MICRO_MIN_LAYER_PX;
      expect(need, `${tier} pair fits`).toBeLessThanOrEqual(floor);
    }
  });

  it("the acceptance matrix: same row, no self-intersection, inside the pane", () => {
    for (const { window, pane: paneWidth } of MATRIX) {
      for (const pane of ["A", "B"] as const) {
        const { page, zoom, tier } = pillBoxes(pane, paneWidth, 600);
        const label = `${pane} @${window} (${tier})`;
        // Same row: the two boxes' y ranges overlap (never stacked).
        const yOverlap =
          Math.min(page.bottom, zoom.bottom) - Math.max(page.top, zoom.top);
        expect(yOverlap, `${label} same row`).toBeGreaterThan(0);
        expect(page.top, `${label} page top`).toBe(zoom.top);
        expect(page.bottom, `${label} page bottom`).toBe(zoom.bottom);
        // They never intersect each other.
        expect(area(page, zoom), `${label} pill/pill`).toBe(0);
        // Page left of zoom, both inside the pane.
        expect(page.right, `${label} page before zoom`).toBeLessThanOrEqual(zoom.left);
        expect(page.left, `${label} page left`).toBeGreaterThanOrEqual(0);
        expect(zoom.right, `${label} zoom right`).toBeLessThanOrEqual(paneWidth);
      }
    }
  });

  it("at 1442/700/640 with one and two documents the pills clear the strip and its bar", () => {
    for (const { window, pane: paneWidth } of MATRIX) {
      for (const pane of ["A", "B"] as const) {
        const band = multiPillBandPx(paneWidth);
        const { page, zoom } = pillBoxes(pane, paneWidth, 600);
        // The strip stops above the band; its page-action bar lives inside it.
        const { strip } = stripAndPageWidths(paneWidth);
        const stripBox: Box =
          pane === "A"
            ? { left: paneWidth - strip, top: 0, right: paneWidth, bottom: 600 - band }
            : { left: 0, top: 0, right: strip, bottom: 600 - band };
        expect(area(page, stripBox), `${pane}@${window} page/strip`).toBe(0);
        expect(area(zoom, stripBox), `${pane}@${window} zoom/strip`).toBe(0);
        // The pills sit in the reserved band's row (or the page-column row).
        expect(page.bottom, `${pane}@${window} inset`).toBe(600 - 12);
        expect(zoom.bottom, `${pane}@${window} inset`).toBe(600 - 12);
      }
    }
  });

  it("the two panes' pills never leave the pane budget at every reachable pane width", () => {
    // 238px is the micro pair's own floor (2 insets + both pills + the row
    // gap). The 640px minimum window yields 262px panes, so every reachable
    // pane width sits above it.
    expect(MULTI_PILL_MICRO_MIN_LAYER_PX).toBe(238);
    for (let paneWidth = MULTI_PILL_MICRO_MIN_LAYER_PX; paneWidth <= 800; paneWidth += 1) {
      for (const pane of ["A", "B"] as const) {
        const { page, zoom } = pillBoxes(pane, paneWidth, 600);
        const label = `pane ${pane} ${paneWidth}`;
        expect(area(page, zoom), `${label} pill/pill`).toBe(0);
        expect(page.left, `${label} page left`).toBeGreaterThanOrEqual(0);
        expect(zoom.right, `${label} zoom right`).toBeLessThanOrEqual(paneWidth);
      }
    }
  });

  it("mirrors the CSS contract: horizontal anchors, one row, the three tiers", () => {
    // The page pill anchors LEFT and the zoom pill RIGHT in every pane (both
    // panes read the same inset token) — no per-pane stack.
    expect(STYLES).toMatch(
      /\.canvas-pills\[data-pill-pane\] \.canvas-pill-page\s*\{\s*left:\s*var\(--tf-multi-pill-inset, 12px\);\s*right: auto;/,
    );
    expect(STYLES).toMatch(
      /\.canvas-pills\[data-pill-pane\] \.canvas-pill-zoom\s*\{\s*right:\s*var\(--tf-multi-pill-inset, 12px\);\s*left: auto;/,
    );
    // The retired stack: no `bottom: 58px` raise survives for the pane pills.
    expect(STYLES).not.toMatch(/data-pill-pane\]\s*\.canvas-pill-zoom\s*\{\s*bottom:\s*58px/);
    expect(STYLES).toMatch(/data-pill-pane\]\s*\.canvas-pill-zoom\s*\{[^}]*bottom:\s*12px/);
    // The layer is the query container and the tiers use the module's numbers.
    expect(STYLES).toMatch(
      /\.canvas-pills\[data-pill-pane\]\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*multi-pills;/,
    );
    expect(STYLES).toContain(`@container multi-pills (max-width: ${MULTI_PILL_FULL_MIN_LAYER_PX - 1}px)`);
    expect(STYLES).toContain(
      `@container multi-pills (max-width: ${MULTI_PILL_COMPACT_MIN_LAYER_PX - 1}px)`,
    );
    // The micro tier: 24px buttons, the 6px inset and the tightened chrome.
    const micro = STYLES.slice(STYLES.indexOf("@container multi-pills (max-width: 311px)"));
    expect(micro).toMatch(/--tf-multi-pill-inset:\s*6px/);
    expect(micro).toMatch(/\.canvas-pill \.tool-btn\s*\{\s*width:\s*24px;\s*height:\s*28px;/);
    // The band offsets and the workspace padding stay (Phase 39 contract).
    expect(STYLES).toMatch(/bottom:\s*calc\(-1 \* var\(--tf-multi-pill-band, 0px\)\)/);
    expect(STYLES).toMatch(/right:\s*calc\(-1 \* var\(--tf-multi-pill-span, 0px\)\)/);
    expect(STYLES).toMatch(/left:\s*calc\(-1 \* var\(--tf-multi-pill-span, 0px\)\)/);
    expect(STYLES).toMatch(/padding-bottom:\s*var\(--tf-multi-pill-band, 0px\)/);
  });

  it("single mode's pill placement is untouched", () => {
    // The single-mode anchors keep their literal 12px insets and the stacked
    // ladder stays scoped to the single-mode container.
    expect(STYLES).toMatch(/\.canvas-pill-page\s*\{\s*left:\s*12px;/);
    expect(STYLES).toMatch(/\.canvas-pill-zoom\s*\{\s*right:\s*12px;/);
    expect(STYLES).toMatch(
      /\.tab-stage\[data-multi-mode='false'\] \.canvas-overlay\s*\{\s*container-type:\s*size;\s*container-name:\s*canvas-pills;/,
    );
    expect(STYLES).toMatch(
      /@container canvas-pills \(max-width: 307px\)\s*\{\s*\.canvas-pill-zoom\s*\{\s*bottom:\s*60px;/,
    );
  });

  it("the pane geometry itself is unchanged (the band rides the same split)", () => {
    const g = multiPaneGeometry(1114, 0, 0.5);
    expect(g.paneA.width).toBe(553);
    expect(g.paneB.width).toBe(553);
    expect(multiPillBandPx(g.paneA.width)).toBe(MULTI_PILL_BAND_PX);
  });
});
