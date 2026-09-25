// @vitest-environment jsdom
//
// DEF-349 — at a narrow window in Multi Mode each pane's floating pills were
// wider than that pane's page column, so anchored at the pane's outer edge they
// floated over the pane's thumbnail strip and its page-action bar (qa: 3643.2
// px^2 pill/strip at a 700px window; the page pill also covered the strip's
// page-action bar by 639.9 px^2).
//
// The fix: when the page column can no longer hold the full pills, the pane
// reserves a bottom band (`multiPillBandPx`), the strip stops above it and the
// pills span the full pane inside the band. These tests pin the pure band rule,
// the zero-intersection geometry it produces at the two measured window widths
// (700 -> pane 292px, 640 -> pane 262px) and the static CSS contract that
// mirrors it. At the default window (pane far wider than the fit width) the
// band is 0px and the Phase 36/37/38 placement is untouched.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MULTI_PILL_BAND_PX,
  MULTI_PILL_FIT_PAGE_PX,
  multiPillBandPx,
  multiPillSpanPx,
  stripAndPageWidths,
} from "../../../src/renderer/components/multiPaneLayout";
import {
  PAGE_FULL_W,
  PILL_HEIGHT,
  PILL_INSET,
  ZOOM_FULL_W,
} from "../../../src/renderer/state/pillFit";

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
 *  (left) edge (data-rail-side). */
function stripBox(pane: "A" | "B", width: number, height: number, band: number): Box {
  const { strip, page } = stripAndPageWidths(width);
  const bottom = height - band;
  return pane === "A"
    ? { left: page, top: 0, right: width, bottom }
    : { left: 0, top: 0, right: strip, bottom };
}

/** The two pills' boxes as the CSS lays them out at `width`. With a band the
 *  pills span the full pane and stack in the band; without one they stack at
 *  the page column's outer edge (the Phase 36/37/38 placement). The pill
 *  content is full width in both modes so the shared dock's pill-width
 *  reserve basis is unchanged. */
function pillBoxes(pane: "A" | "B", width: number, height: number): { page: Box; zoom: Box } {
  const pageW = PAGE_FULL_W;
  const zoomW = ZOOM_FULL_W;
  const pageBottom = height - PILL_INSET;
  const zoomBottom = height - 58;
  const outerLeft = pane === "A";
  const pageLeft = outerLeft ? PILL_INSET : width - PILL_INSET - pageW;
  const zoomLeft = outerLeft ? PILL_INSET : width - PILL_INSET - zoomW;
  const box = (left: number, w: number, bottom: number): Box => ({
    left,
    top: bottom - PILL_HEIGHT,
    right: left + w,
    bottom,
  });
  return {
    page: box(pageLeft, pageW, pageBottom),
    zoom: box(zoomLeft, zoomW, zoomBottom),
  };
}

const HEIGHT = 600;

describe("DEF-349 multi narrow-pane pill band", () => {
  it("reserves a band only once the page column can no longer hold the full pills", () => {
    // The fit width is the wider (zoom) pill plus its inset — 230px.
    expect(MULTI_PILL_FIT_PAGE_PX).toBe(PILL_INSET + ZOOM_FULL_W);
    // pane 380 => page 230: full pills still fit, no band.
    expect(stripAndPageWidths(380).page).toBe(230);
    expect(multiPillBandPx(380)).toBe(0);
    // pane 379 => page 229: one pixel of overlap, the band is reserved.
    expect(multiPillBandPx(379)).toBe(MULTI_PILL_BAND_PX);
    // The default window's pane and the 0.30 split are wide, no band.
    expect(multiPillBandPx(721)).toBe(0);
    expect(multiPillBandPx(413)).toBe(0);
    // The two measured narrow widths.
    expect(multiPillBandPx(292)).toBe(MULTI_PILL_BAND_PX);
    expect(multiPillBandPx(262)).toBe(MULTI_PILL_BAND_PX);
    // No measurement / no pane => no band (jsdom, closed panes).
    expect(multiPillBandPx(0)).toBe(0);
    expect(multiPillBandPx(Number.NaN)).toBe(0);
  });

  it("spans the pills layer across exactly the strip column only when a band is reserved", () => {
    expect(multiPillSpanPx(380)).toBe(0);
    expect(multiPillSpanPx(721)).toBe(0);
    expect(multiPillSpanPx(292)).toBe(stripAndPageWidths(292).strip);
    expect(multiPillSpanPx(262)).toBe(stripAndPageWidths(262).strip);
  });

  it("zero pill/strip intersection at the measured narrow and default widths, both panes", () => {
    const widths = [262, 292, 379, 380, 413, 721];
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
        // The two pills never intersect each other (stacked with a gap).
        expect(area(page, zoom), `pane ${pane} w${width} pill/pill`).toBe(0);
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
    // The band keeps the existing stacked zoom rule (58px), so the two pills
    // stay one row apart inside the band.
    expect(STYLES).toMatch(
      /\.canvas-pills\[data-pill-pane\] \.canvas-pill-zoom\s*\{\s*bottom:\s*58px/,
    );
    // The full pill content is retained (no compact yield), so the shared
    // dock's pill-width reserve basis is identical to single mode.
    expect(STYLES).not.toContain(".tab-pane[data-multi-pill-band]");
  });
});
