// Phase 40 (item 7) — the SINGLE-VIEW page-layout mode (one / two / four).
//
// Criterion 9: the control offers exactly three options (one page, two side by
// side, four in two rows), each renders that layout, one page is the default,
// and the icon reflects the current layout. This suite pins the LAYOUT/FIT
// rule per mode, the grid column count, the row geometry the scroller uses,
// and the per-tab (session, non-persisted) nature of the choice.
//
// Without the change these fail: `pageLayoutMode.ts` does not exist and
// `computeEffectiveScale` only ever fits ONE page.

import { describe, expect, it } from "vitest";
import type { ZoomState } from "../../../src/renderer/state/zoom";
import {
  DEFAULT_PAGE_LAYOUT,
  PAGE_LAYOUT_MODES,
  buildRowGeom,
  isPageLayoutMode,
  layoutFitAnchor,
  layoutFitViewport,
  pageLayoutColumns,
  pageLayoutFitMode,
  pageLayoutFitPages,
  pageLayoutFitRows,
  pageReadoutLabel,
  pageToRow,
  rowCountForPages,
  rowToFirstPage,
  rowsToPageRange,
} from "../../../src/renderer/components/pageLayoutMode";
import { computeEffectiveScale } from "../../../src/renderer/components/paneFit";

const FIT_WIDTH: ZoomState = { mode: "fit-width", manualScale: 1 };
const FIT_PAGE: ZoomState = { mode: "fit-page", manualScale: 1 };

/** A4 page 1 at the fit anchor and a 900x700 canvas. */
const PAGE = { w: 595, h: 842 };
const VIEW = { w: 900, h: 700 };

/** The DocumentView fit path for a mode: transform the box + anchor, then run
 *  the ONE fit formula (padding is CONTENT_PADDING_PX = 0). */
function fitFor(mode: "one" | "two" | "four", zoom: ZoomState): number {
  return computeEffectiveScale(
    layoutFitViewport(mode, zoom.mode, VIEW),
    layoutFitAnchor(mode, zoom.mode, PAGE),
    zoom,
    0,
  );
}

describe("Phase 40 (item 7) — the three layout modes", () => {
  it("exactly three modes in the control's order, one is the default", () => {
    expect(PAGE_LAYOUT_MODES).toEqual(["one", "two", "four"]);
    expect(DEFAULT_PAGE_LAYOUT).toBe("one");
    expect(isPageLayoutMode("one")).toBe(true);
    expect(isPageLayoutMode("two")).toBe(true);
    expect(isPageLayoutMode("four")).toBe(true);
    expect(isPageLayoutMode("three")).toBe(false);
    expect(isPageLayoutMode(null)).toBe(false);
  });

  it("the continuous page list flows into 1 or 2 grid columns", () => {
    expect(pageLayoutColumns("one")).toBe(1);
    expect(pageLayoutColumns("two")).toBe(2);
    expect(pageLayoutColumns("four")).toBe(2);
  });

  it("the fit accommodates 1, 2 and 4 pages respectively", () => {
    expect(pageLayoutFitRows("one")).toBe(1);
    expect(pageLayoutFitRows("two")).toBe(1);
    expect(pageLayoutFitRows("four")).toBe(2);
    expect(pageLayoutFitPages("one")).toBe(1);
    expect(pageLayoutFitPages("two")).toBe(2);
    expect(pageLayoutFitPages("four")).toBe(4);
  });
});

describe("Phase 40 (item 7) — the exact fit rule per mode", () => {
  it("ONE is byte-identical to the pre-change fit", () => {
    expect(fitFor("one", FIT_WIDTH)).toBeCloseTo(900 / 595, 6);
    expect(fitFor("one", FIT_PAGE)).toBeCloseTo(700 / 842, 6);
  });

  it("TWO fits two pages side by side: (900 - gap) / (2 * 595)", () => {
    // gap = PAGE_GAP_PX = 18
    expect(fitFor("two", FIT_WIDTH)).toBeCloseTo(882 / 1190, 6);
    // fit-page clamps against the SAME two-across width here (still narrower
    // than one page tall), so it equals fit-width.
    expect(fitFor("two", FIT_PAGE)).toBeCloseTo(882 / 1190, 6);
  });

  it("FOUR fits four pages (2x2): min((W-gap)/(2*w), (H-gap)/(2*h))", () => {
    expect(fitFor("four", FIT_WIDTH)).toBeCloseTo(882 / 1190, 6);
    expect(fitFor("four", FIT_PAGE)).toBeCloseTo(682 / 1684, 6);
    // The 2x2 fit is strictly tighter than two-across on this canvas.
    expect(fitFor("four", FIT_PAGE)).toBeLessThan(fitFor("two", FIT_PAGE));
  });

  it("the fit transforms only the axis the zoom mode constrains", () => {
    // fit-width must not scale down for a second row.
    const box = layoutFitViewport("four", "fit-width", VIEW);
    expect(box.w).toBe(882);
    expect(box.h).toBe(700);
    const anchor = layoutFitAnchor("four", "fit-width", PAGE);
    expect(anchor.w).toBe(1190);
    expect(anchor.h).toBe(842);
  });
});

describe("Phase 40 (item 7) — row geometry drives the scroller", () => {
  const geom = [
    { widthCss: 100, heightCss: 200 },
    { widthCss: 120, heightCss: 260 },
    { widthCss: 100, heightCss: 200 },
    { widthCss: 90, heightCss: 180 },
  ];

  it("collapses pages into grid rows (row height = tallest page)", () => {
    const rows = buildRowGeom(geom, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ widthCss: 100 + 120 + 18, heightCss: 260 });
    expect(rows[1]).toEqual({ widthCss: 100 + 90 + 18, heightCss: 200 });
  });

  it("one column leaves one page per row (the ONE-mode identity)", () => {
    const rows = buildRowGeom(geom, 1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ widthCss: 100, heightCss: 200 });
    expect(rowCountForPages(4, 1)).toBe(4);
  });

  it("maps between pages and rows and back", () => {
    expect(rowCountForPages(5, 2)).toBe(3);
    expect(pageToRow(1, 2)).toBe(1);
    expect(pageToRow(2, 2)).toBe(1);
    expect(pageToRow(3, 2)).toBe(2);
    expect(rowToFirstPage(1, 2)).toBe(1);
    expect(rowToFirstPage(3, 2)).toBe(5);
    // One column is the identity mapping.
    expect(pageToRow(4, 1)).toBe(4);
    expect(rowToFirstPage(4, 1)).toBe(4);
  });

  it("expands a visible row range to the page range those rows hold", () => {
    expect(rowsToPageRange(1, 1, 2, 10)).toEqual({ start: 1, end: 2 });
    expect(rowsToPageRange(2, 3, 2, 10)).toEqual({ start: 3, end: 6 });
    // Clamped to the document's page count.
    expect(rowsToPageRange(2, 3, 2, 5)).toEqual({ start: 3, end: 5 });
    expect(rowsToPageRange(1, 2, 1, 3)).toEqual({ start: 1, end: 2 });
  });
});

// ---------------------------------------------------------------------------
// Phase 40 (item 9) follow-up — the mode must DELIVER the pages it promises.
//
// The pre-fix defect: the default zoom is fit-width, where TWO and FOUR
// produced the SAME page boxes (fit-width never clamps height, so FOUR only
// ever showed its first row). Selecting a mode now establishes its fit:
// ONE -> fit-width (unchanged), TWO / FOUR -> fit-page. These tests fail
// without `pageLayoutFitMode` and the fit switch.
// ---------------------------------------------------------------------------
describe("Phase 40 (item 9) — each mode's established fit keeps its promised pages fully visible", () => {
  const GAP = 18;
  // Representative viewport (canvas) boxes at the two acceptance window sizes;
  // the running-app counts are measured separately (page boxes vs canvas box).
  const VIEWS = [
    { name: "1440", w: 1440, h: 760 },
    { name: "900", w: 900, h: 640 },
  ];

  it("the mode's fit is fit-page (the only fit that clamps height)", () => {
    expect(pageLayoutFitMode("one")).toBe("fit-page");
    expect(pageLayoutFitMode("two")).toBe("fit-page");
    expect(pageLayoutFitMode("four")).toBe("fit-page");
  });

  it("the full cols x fit-rows footprint fits inside the viewport", () => {
    for (const view of VIEWS) {
      for (const mode of ["one", "two", "four"] as const) {
        const zoom: ZoomState = { mode: pageLayoutFitMode(mode), manualScale: 1 };
        const scale = computeEffectiveScale(
          layoutFitViewport(mode, zoom.mode, view),
          layoutFitAnchor(mode, zoom.mode, PAGE),
          zoom,
          0,
        );
        const cols = pageLayoutColumns(mode);
        const rows = pageLayoutFitRows(mode);
        const totalW = cols * PAGE.w * scale + (cols - 1) * GAP;
        const totalH = rows * PAGE.h * scale + (rows - 1) * GAP;
        expect(totalW, `${mode} width @${view.name}`).toBeLessThanOrEqual(view.w + 1e-6);
        expect(totalH, `${mode} height @${view.name}`).toBeLessThanOrEqual(view.h + 1e-6);
      }
    }
  });

  it("without the fit switch FOUR's second row spills out of the viewport", () => {
    const view = { w: 1200, h: 700 };
    // The pre-fix behaviour: FOUR inherited fit-width (height never clamped).
    const buggy = computeEffectiveScale(
      layoutFitViewport("four", "fit-width", view),
      layoutFitAnchor("four", "fit-width", PAGE),
      FIT_WIDTH,
      0,
    );
    expect(2 * PAGE.h * buggy + GAP).toBeGreaterThan(view.h);
    // The fix (fit-page) brings the 2x2 footprint inside the viewport.
    const fixed = computeEffectiveScale(
      layoutFitViewport("four", "fit-page", view),
      layoutFitAnchor("four", "fit-page", PAGE),
      FIT_PAGE,
      0,
    );
    expect(2 * PAGE.h * fixed + GAP).toBeLessThanOrEqual(view.h + 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Phase 40 (item 9) follow-up — the honest page readout in a grid.
//
// The pre-fix defect: jumping to an even page reported the row's FIRST page
// (page 4 showed 3). The readout is now the row's inclusive page RANGE.
// ---------------------------------------------------------------------------
describe("Phase 40 (item 9) — the honest page readout per layout", () => {
  it("single column is byte-identical to the pre-change readout", () => {
    expect(pageReadoutLabel(1, 1, 10)).toBe("1");
    expect(pageReadoutLabel(4, 1, 10)).toBe("4");
    expect(pageReadoutLabel(5, 1, 10)).toBe("5");
  });

  it("two columns report the row's page range and normalize even-page jumps", () => {
    expect(pageReadoutLabel(3, 2, 10)).toBe("3-4");
    expect(pageReadoutLabel(4, 2, 10)).toBe("3-4");
    expect(pageReadoutLabel(5, 2, 10)).toBe("5-6");
    expect(pageReadoutLabel(6, 2, 10)).toBe("5-6");
  });

  it("an incomplete last row collapses to its one page", () => {
    expect(pageReadoutLabel(5, 2, 5)).toBe("5");
    expect(pageReadoutLabel(1, 2, 1)).toBe("1");
    // Clamps a page beyond the document to the last row's real page.
    expect(pageReadoutLabel(9, 2, 5)).toBe("5");
  });
});
