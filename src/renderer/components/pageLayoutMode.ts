// Phase 40 (item 7) — the SINGLE-VIEW page-layout mode.
//
// The single-view canvas can show one page (the default), two pages side by
// side, or four pages in a 2x2 grid. The choice is PER-TAB, session-scoped
// view state (REQUIREMENTS.md Phase 40, Settings impact: none) — it lives in
// DocumentView's local state and is never persisted as an AppSettings field.
//
// The continuous page list is the SAME virtualized scroller as before; the
// mode only changes (a) how many COLUMNS the flow uses and (b) what the fit
// modes must accommodate, so the fit rule is well defined:
//
//   ONE   columns 1, fit rows 1  -> fit one page (byte-identical to pre-change:
//                                   fit-width = availW / pageW,
//                                   fit-page  = min(availW / pageW, availH / pageH)).
//   TWO   columns 2, fit rows 1  -> fit two pages side by side:
//                                   fit-width = (availW - gap) / (2 * pageW),
//                                   fit-page  = min((availW - gap) / (2 * pageW), availH / pageH).
//   FOUR  columns 2, fit rows 2  -> fit four pages in two rows (2x2):
//                                   fit-width = (availW - gap) / (2 * pageW),
//                                   fit-page  = min((availW - gap) / (2 * pageW),
//                                                   (availH - gap) / (2 * pageH)).
//
// The mode is applied to the REAL `computeEffectiveScale` by transforming the
// fit box / anchor (see `layoutFitViewport` / `layoutFitAnchor`), so the
// single fit formula keeps its one home in `paneFit.ts` — the DEF-338 fit
// gate's exact `computeEffectiveScale(viewportBox, fitAnchor, zoom,
// CONTENT_PADDING_PX)` call is untouched for ONE.
//
// Pure: no DOM, safe to call inside render.

import { PAGE_GAP_PX, type MixedPageGeom } from "./pageGeometry";
import type { FitBoxSize } from "./paneFit";
import type { ZoomMode } from "../state/zoom";

export type PageLayoutMode = "one" | "two" | "four";

/** The three modes in the control's display order. */
export const PAGE_LAYOUT_MODES: readonly PageLayoutMode[] = ["one", "two", "four"];

/** The default layout: one page (REQUIREMENTS criterion 9). */
export const DEFAULT_PAGE_LAYOUT: PageLayoutMode = "one";

export function isPageLayoutMode(value: unknown): value is PageLayoutMode {
  return value === "one" || value === "two" || value === "four";
}

/** The number of COLUMNS the continuous page list flows into. */
export function pageLayoutColumns(mode: PageLayoutMode): 1 | 2 {
  return mode === "one" ? 1 : 2;
}

/** Rows of pages the FIT must accommodate inside the viewport. */
export function pageLayoutFitRows(mode: PageLayoutMode): 1 | 2 {
  return mode === "four" ? 2 : 1;
}

/** How many pages fill the viewport for the mode (columns x fit rows). */
export function pageLayoutFitPages(mode: PageLayoutMode): 1 | 2 | 4 {
  return (pageLayoutColumns(mode) * pageLayoutFitRows(mode)) as 1 | 2 | 4;
}

/**
 * The fit a mode ESTABLISHES when it is selected (Phase 40 item 9 follow-up).
 *
 * It is `fit-page` for every mode, because `fit-page` is the only fit that
 * clamps BOTH axes and therefore the only one that can actually place the
 * pages a mode promises fully inside the viewport:
 *
 *   - FOUR at `fit-width` produced the SAME page boxes as TWO (fit-width never
 *     constrains height), so its second row simply scrolled away and the mode
 *     did not deliver the four pages it promises;
 *   - ONE at `fit-width` shows the page at full width but taller than the
 *     viewport, so not one page is FULLY visible either.
 *
 * ONE's LAYOUT is unchanged (single column, one page per row) and its default
 * on open is still the App's `fit-width`; only an explicit mode selection
 * re-fits. The manual zoom controls still override this afterwards.
 */
export function pageLayoutFitMode(mode: PageLayoutMode): ZoomMode {
  void mode;
  return "fit-page";
}

/**
 * Transform the viewport box so `computeEffectiveScale` sees the space left
 * once the inter-column / inter-row gaps are removed. Only the axis the zoom
 * mode actually constrains is reduced: fit-width never clamps vertically, so
 * its height is left whole.
 */
export function layoutFitViewport(
  mode: PageLayoutMode,
  zoomMode: ZoomMode,
  box: FitBoxSize,
): FitBoxSize {
  const cols = pageLayoutColumns(mode);
  const rows = zoomMode === "fit-page" ? pageLayoutFitRows(mode) : 1;
  return {
    ...box,
    w: Math.max(box.w - (cols - 1) * PAGE_GAP_PX, 1),
    h: Math.max(box.h - (rows - 1) * PAGE_GAP_PX, 1),
  };
}

/**
 * Transform the fit anchor so `computeEffectiveScale` measures the laid-out
 * footprint (columns pages across, fit-rows pages down) instead of one page.
 */
export function layoutFitAnchor(
  mode: PageLayoutMode,
  zoomMode: ZoomMode,
  anchor: FitBoxSize,
): FitBoxSize {
  const cols = pageLayoutColumns(mode);
  const rows = zoomMode === "fit-page" ? pageLayoutFitRows(mode) : 1;
  return { ...anchor, w: cols * anchor.w, h: rows * anchor.h };
}

// ---------------------------------------------------------------------------
// Row geometry — the scroller's math works on ROWS.
//
// A 2-column flow lays pages out in rows: pages 1..2 in row 1, 3..4 in row 2,
// and so on. The CSS grid sizes each row to its tallest page and each row's
// top is the sum of the rows above it plus the gap — exactly what the mixed
// scroll helpers already model, so we feed them a per-ROW geometry array and
// translate rows back to pages at the call sites. With `columns === 1` every
// row holds one page and this reduces to the pre-change geometry.
// ---------------------------------------------------------------------------

/** 1-based row a 1-based visible page falls in. */
export function pageToRow(page: number, columns: number): number {
  if (page <= 1 || columns <= 1) return Math.max(1, page);
  return Math.floor((page - 1) / columns) + 1;
}

/** 1-based first page of a 1-based row. */
export function rowToFirstPage(row: number, columns: number): number {
  if (row <= 1) return 1;
  return (row - 1) * columns + 1;
}

/**
 * The HONEST page readout for the layout (Phase 40 item 9 follow-up).
 *
 * In a multi-column grid the viewport shows a ROW of up to `columns` pages, so
 * reporting the row's first page alone hides the page the user actually
 * navigated to (jumping to page 4 reported 3). Normalize `page` to the row it
 * belongs to, then report the row's inclusive page RANGE ("3-4") when the row
 * holds more than one page, or the single page otherwise. A single-column
 * layout is the identity, so ONE's readout is byte-identical to before; an
 * incomplete last row also collapses to its one page ("5").
 */
export function pageReadoutLabel(
  page: number,
  columns: number,
  pageCount: number,
): string {
  const cols = Math.max(1, columns);
  const counted = Math.max(1, pageCount);
  const startPage = Math.min(
    counted,
    rowToFirstPage(pageToRow(Math.max(1, page), cols), cols),
  );
  const endPage = Math.min(counted, startPage + cols - 1);
  return endPage > startPage ? `${startPage}-${endPage}` : String(startPage);
}

/**
 * The HONEST visible-range readout for a grid layout (TFL-1116 R24).
 *
 * `pageReadoutLabel` reports one ROW's page range, which is the right string
 * for a two-page layout (columns 2, one fit row). A FOUR layout puts TWO fit
 * rows in the viewport, so the visible group is `columns * fitRows` pages: the
 * focused page's row plus the row below it. Reporting only the row range hid
 * half the group the user actually sees. This normalizes `page` to its row
 * (the SAME `pageToRow` / `rowToFirstPage` math `pageReadoutLabel` uses) and
 * extends the end by the fit rows, e.g. focused page 7 at columns 2 / rows 2
 * reads "7-10". A single-page layout collapses to a bare page ("7"), and the
 * caller suppresses the summary entirely when the layout shows one page.
 *
 * Pure: no DOM, safe to call inside render. `pageReadoutLabel`'s own range
 * math is untouched — this is a separate viewport-sized readout.
 */
export function pageVisibleRangeLabel(
  page: number,
  columns: number,
  rows: number,
  pageCount: number,
): string {
  const cols = Math.max(1, columns);
  const fitRows = Math.max(1, rows);
  const counted = Math.max(1, pageCount);
  // `pageReadoutLabel` stays the truthful range source: its first number is the
  // focused page's ROW-start, which is also the visible group's start. Extend
  // that start by the pages the extra fit rows put on screen.
  const rowLabel = pageReadoutLabel(page, cols, counted);
  const rowStart = Number.parseInt(rowLabel, 10);
  const startPage = Number.isFinite(rowStart) ? rowStart : Math.max(1, page);
  const endPage = Math.min(counted, startPage + cols * fitRows - 1);
  return endPage > startPage ? `${startPage}-${endPage}` : String(startPage);
}

/** Collapse the per-page geometry into per-ROW geometry (CSS grid rows). */
export function buildRowGeom(
  geom: readonly MixedPageGeom[],
  columns: number,
): MixedPageGeom[] {
  const cols = columns < 1 ? 1 : columns;
  const rows: MixedPageGeom[] = [];
  for (let i = 0; i < geom.length; i += cols) {
    let widthCss = 0;
    let heightCss = 0;
    const end = Math.min(i + cols, geom.length);
    for (let j = i; j < end; j += 1) {
      const g = geom[j];
      if (g === undefined) continue;
      heightCss = Math.max(heightCss, g.heightCss);
      widthCss += g.widthCss;
    }
    // The inter-column gap the grid paints between the pages in this row.
    widthCss += Math.max(0, end - i - 1) * PAGE_GAP_PX;
    rows.push({ widthCss, heightCss });
  }
  return rows;
}

/** The number of rows a page count occupies at the given column count. */
export function rowCountForPages(pageCount: number, columns: number): number {
  if (pageCount <= 0) return 0;
  return Math.ceil(pageCount / Math.max(1, columns));
}

/** Map an inclusive 1-based [rowStart, rowEnd] range back to a page range,
 *  clamped to the document's page count. */
export function rowsToPageRange(
  rowStart: number,
  rowEnd: number,
  columns: number,
  pageCount: number,
): { start: number; end: number } {
  const start = rowToFirstPage(rowStart, columns);
  const end = Math.min(pageCount, rowToFirstPage(rowEnd, columns) + Math.max(1, columns) - 1);
  return { start: Math.max(1, start), end: Math.max(start, end) };
}
