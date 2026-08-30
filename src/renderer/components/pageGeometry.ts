// Page slot geometry for the virtualized document scroller.
//
// The scroller uses flexbox with a fixed gap between slots and padding on the
// container. Each slot occupies a fixed CSS height = (page height in CSS px)
// plus the gap. The padding is set on the container, not on the slot, so
// `slotOffsetTop(n) = PADDING_TOP + (n - 1) * (pageSlotHeight + GAP)`. The
// container's full scroll height equals PADDING_TOP + pageCount * slotHeight
// (including the trailing gap which the last slot sits in front of, but
// scrollable just past it) so the scrollbar tracks 1..pageCount cleanly.
//
// These helpers are pure so the math is unit-testable without mounting React.
// The DOM layout must agree with them exactly.

export const PAGE_GAP_PX = 18;
export const CONTENT_PADDING_PX = 28;

/**
 * Height in CSS px occupied by one page slot: page height in CSS px, plus the
 * gap that follows it (so consecutive slots' tops are exactly `slotHeight`
 * apart after the first).
 */
export function pageSlotHeight(
  pageHeightPt: number,
  cssScale: number,
): number {
  if (pageHeightPt <= 0 || cssScale <= 0) {
    return 0;
  }
  return pageHeightPt * cssScale + PAGE_GAP_PX;
}

/**
 * Top offset of slot N inside the scroller, in CSS px. 1-based; slot 1 starts
 * at the container's top padding.
 */
export function slotOffsetTop(
  pageNumber: number,
  pageHeightPt: number,
  cssScale: number,
): number {
  if (pageNumber <= 1) {
    return CONTENT_PADDING_PX;
  }
  return CONTENT_PADDING_PX + (pageNumber - 1) * pageSlotHeight(pageHeightPt, cssScale);
}

/**
 * 1-based page number containing the CSS pixel position `top` (measured from
 * the scroller's scrollTop). Returns a value clamped to [1, pageCount].
 */
export function pageAtScrollTop(
  top: number,
  pageHeightPt: number,
  cssScale: number,
  pageCount: number,
): number {
  if (pageCount <= 0) {
    return 1;
  }
  const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
  if (slotHeight <= 0) {
    return 1;
  }
  const adjusted = top - CONTENT_PADDING_PX;
  if (adjusted <= 0) {
    return 1;
  }
  const page = Math.floor(adjusted / slotHeight) + 1;
  return Math.max(1, Math.min(pageCount, page));
}

/**
 * Total scrollable height of the container in CSS px. Used to keep the
 * scrollbar in sync with the (possibly virtualized) page count.
 */
export function documentScrollHeight(
  pageCount: number,
  pageHeightPt: number,
  cssScale: number,
): number {
  if (pageCount <= 0 || pageHeightPt <= 0 || cssScale <= 0) {
    return CONTENT_PADDING_PX * 2;
  }
  return CONTENT_PADDING_PX * 2 + pageCount * pageSlotHeight(pageHeightPt, cssScale);
}

/**
 * Inclusive 1-based [start, end] page range that is currently visible inside
 * the scroller's viewport, given the scroller's `scrollTop` and `clientHeight`
 * and a buffer of `bufferPages` extra pages on each side. The buffer is what
 * keeps fast scrolls from revealing blank slots. Returns [1, 1] for degenerate
 * geometry.
 *
 * This is the geometry-based fallback for page virtualization: it works
 * regardless of whether IntersectionObserver has fired (and regardless of
 * whether the IO rootMargin is "huge" — some real configurations, including
 * headless harnesses, never trigger IO callbacks for slots far from the
 * viewport, so we must be able to compute visible slots from geometry alone).
 */
export function visiblePageRange(
  scrollTop: number,
  viewportHeight: number,
  pageHeightPt: number,
  cssScale: number,
  pageCount: number,
  bufferPages = 1,
): { start: number; end: number } {
  if (pageCount <= 0) {
    return { start: 1, end: 1 };
  }
  const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
  if (slotHeight <= 0) {
    return { start: 1, end: 1 };
  }
  const adjusted = scrollTop - CONTENT_PADDING_PX;
  const first = adjusted <= 0 ? 0 : Math.floor(adjusted / slotHeight);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / slotHeight));
  const last = first + visibleCount;
  const start = Math.max(0, first - bufferPages);
  const end = Math.min(pageCount - 1, last + bufferPages);
  return { start: start + 1, end: end + 1 };
}

/**
 * Map a 1-based visible page slot to the 1-based source page the underlying
 * pdf.js document should be asked to load.
 *
 * The engine's `EngineState.pageOrder` is an array of 0-based source indices
 * keyed by 0-based visible position. After a delete, e.g. deleting visible
 * page 3 from a 5-page doc, `pageOrder` becomes `[0, 1, 2, 4]` and the
 * `pageCount` becomes 4 — so the visual scroller renders 4 slots, and the
 * slot at visible position 3 must show the source page that was at original
 * position 4 (i.e. `pageOrder[2] + 1 = 4`).
 *
 * `pageOrder` and the visible count are assumed to agree (`pageOrder.length
 * >= visiblePage`). When they don't (defensive — should never happen in
 * production), the helper falls back to the identity mapping so the
 * scroller still renders something instead of throwing.
 *
 * Pure: no side effects, safe to call inside render.
 */
export function visibleToSourcePage(
  visiblePage: number,
  pageOrder: readonly number[],
): number {
  if (visiblePage < 1) return 1;
  const orderIndex = visiblePage - 1;
  const sourceIndex = pageOrder[orderIndex];
  if (sourceIndex === undefined) {
    return visiblePage;
  }
  return sourceIndex + 1;
}
