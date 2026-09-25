// @vitest-environment jsdom
//
// DEF-349 (Phase 39) — at a narrow window in Multi Mode each pane's floating
// pills were wider than that pane's page column, so anchored at the pane's
// outer edge they floated over the pane's thumbnail strip and its page-action
// bar (qa: 3643.2 px^2 pill/strip at a 700px window; the page pill also covered
// the strip's page-action bar by 639.9 px^2).
//
// The fix is unchanged in OUTCOME and updated in GEOMETRY by Phase 40 (item 1):
// when the page column can no longer hold the two pills, the pane reserves a
// bottom band (`multiPillBandPx`), the strip stops above it and the pills span
// the full pane inside the band. Phase 40 supersedes the STACKED band: the two
// pills are always one row (page left, zoom right), so the band is a single
// pill row (56px) and the fit threshold is the FULL horizontal pair. These
// tests pin the pure band rule, the zero-intersection geometry it produces at
// the two measured window widths (700 -> pane 292px, 640 -> pane 262px) and
// the static CSS contract that mirrors it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MULTI_PILL_BAND_PX,
  MULTI_PILL_FIT_PAGE_PX,
  multiPillBandPx,
  multiPillLayerWidthPx,
  multiPillMetrics,
  multiPillSpanPx,
  multiPillTier,
  stripAndPageWidths,
} from "../../../src/renderer/components/multiPaneLayout";

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

/** Pane A's strip is at the pane's inner (right) edge; pane B's is at its inner
 *  (left) edge (data-rail-side). The strip stops above the reserved band. */
function stripBox(pane: "A" | "B", width: number, height: number, band: number): Box {
  const { strip } = stripAndPageWidths(width);
  const bottom = height - band;
  return pane === "A"
    ? { left: width - strip, top: 0, right: width, bottom }
    : { left: 0, top: 0, right: strip, bottom };
}

/** The two pills' boxes as the CSS lays them out at `width` — Phase 40: one
 *  row, page at the layer's left, zoom at its right, inside the pane's reserved
 *  band when one is reserved (the layer then spans the whole pane). */
function pillBoxes(pane: "A" | "B", width: number, height: number): { page: Box; zoom: Box } {
  const layerWidth = multiPillLayerWidthPx(width);
  const m = multiPillMetrics(multiPillTier(layerWidth));
  const layerLeft = pane === "A" ? 0 : width - layerWidth;
  const bottom = height - 12;
  const box = (left: number, w: number): Box => ({
    left,
    top: bottom - m.height,
    right: left + w,
    bottom,
  });
  return {
    page: box(layerLeft + m.inset, m.pageW),
    zoom: box(layerLeft + layerWidth - m.inset - m.zoomW, m.zoomW),
  };
}

const HEIGHT = 600;

describe("DEF-349 multi narrow-pane pill band (Phase 40 horizontal geometry)", () => {
  it("reserves a band only once the page column can no longer hold the pair", () => {
    // The fit width is the FULL horizontal pair (FULL_MIN_CANVAS + the live
    // sub-pixel guard) — 408px, not the old stacked 230px.
    expect(MULTI_PILL_FIT_PAGE_PX).toBe(408);
    // pane 558 => page 408: the pair still fits, no band.
    expect(stripAndPageWidths(558).page).toBe(408);
    expect(multiPillBandPx(558)).toBe(0);
    // pane 557 => page 407: one pixel short, the band is reserved.
    expect(multiPillBandPx(557)).toBe(MULTI_PILL_BAND_PX);
    // ONE pill row (42) + the 12px inset + a 2px clearance (the stacked
    // 102px band is retired with the stack).
    expect(MULTI_PILL_BAND_PX).toBe(56);
    // The two measured narrow widths and the default window's pane.
    expect(multiPillBandPx(292)).toBe(MULTI_PILL_BAND_PX);
    expect(multiPillBandPx(262)).toBe(MULTI_PILL_BAND_PX);
    expect(multiPillBandPx(553)).toBe(MULTI_PILL_BAND_PX);
    // No measurement / no pane => no band (jsdom, closed panes).
    expect(multiPillBandPx(0)).toBe(0);
    expect(multiPillBandPx(Number.NaN)).toBe(0);
  });

  it("spans the pills layer across exactly the strip column only when a band is reserved", () => {
    expect(multiPillSpanPx(558)).toBe(0);
    expect(multiPillSpanPx(553)).toBe(stripAndPageWidths(553).strip);
    expect(multiPillSpanPx(292)).toBe(stripAndPageWidths(292).strip);
    expect(multiPillSpanPx(262)).toBe(stripAndPageWidths(262).strip);
  });

  it("zero pill/strip intersection at the measured narrow and default widths, both panes", () => {
    const widths = [262, 292, 379, 380, 413, 557, 558, 721];
    for (const width of widths) {
      for (const pane of ["A", "B"] as const) {
        const band = multiPillBandPx(width);
        const strip = stripBox(pane, width, HEIGHT, band);
        const { page, zoom } = pillBoxes(pane, width, HEIGHT);
        expect(area(page, strip), `pane ${pane} w${width} page/strip`).toBe(0);
        expect(area(zoom, strip), `pane ${pane} w${width} zoom/strip`).toBe(0);
        // The pills stay inside the pane (never reach the divider or the other
        // pane) and inside the reserved band when there is one.
        for (const [name, box] of [
          ["page", page],
          ["zoom", zoom],
        ] as const) {
          expect(box.left, `pane ${pane} w${width} ${name} left`).toBeGreaterThanOrEqual(0);
          expect(box.right, `pane ${pane} w${width} ${name} right`).toBeLessThanOrEqual(width);
          expect(box.bottom, `pane ${pane} w${width} ${name} bottom`).toBeLessThanOrEqual(HEIGHT);
          if (band > 0) {
            expect(box.top, `pane ${pane} w${width} ${name} in band`).toBeGreaterThanOrEqual(
              HEIGHT - band,
            );
          }
        }
        // The two pills never intersect each other (Phase 40: one row, page
        // left of zoom).
        expect(area(page, zoom), `pane ${pane} w${width} pill/pill`).toBe(0);
        expect(page.right, `pane ${pane} w${width} page before zoom`).toBeLessThanOrEqual(
          zoom.left,
        );
        // The page-action bar lives inside the strip, so a pill clear of the
        // strip is automatically clear of the bar.
        expect(area(page, strip), `pane ${pane} w${width} page/actionbar`).toBe(0);
      }
    }
  });

  it("keeps the wide placement untouched: band 0 means the pills layer does not offset", () => {
    // The custom properties that drive the offsets have 0px fallbacks, so a
    // pane with no band keeps `right/left/bottom: 0` exactly.
    expect(STYLES).toMatch(/bottom:\s*calc\(-1 \* var\(--tf-multi-pill-band, 0px\)\)/);
    expect(STYLES).toMatch(/right:\s*calc\(-1 \* var\(--tf-multi-pill-span, 0px\)\)/);
    expect(STYLES).toMatch(/left:\s*calc\(-1 \* var\(--tf-multi-pill-span, 0px\)\)/);
    expect(STYLES).toMatch(/padding-bottom:\s*var\(--tf-multi-pill-band, 0px\)/);
    expect(STYLES).toContain('.workspace:has(> .pane-thumb-strip)');
    // Phase 40 — the stacked zoom raise is retired: the pane pills always share
    // one row at the pane's bottom inset.
    expect(STYLES).not.toMatch(/data-pill-pane\]\s*\.canvas-pill-zoom\s*\{\s*bottom:\s*58px/);
    // The full pill content is retained at the wide tier (no compact yield
    // below 408px of layer width), so the shared dock's pill-width reserve
    // basis is identical to single mode where the pills do not compact.
    expect(STYLES).not.toContain(".tab-pane[data-multi-pill-band]");
  });
});
