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
 * 1-based page number the viewport is showing at CSS pixel position `top`
 * (measured from the scroller's scrollTop). Returns a value clamped to
 * [1, pageCount].
 *
 * DEF-098 — the "current page" boundary must agree with where a page
 * jump LANDS. `jumpToPage` scrolls so the target page's top sits
 * `CONTENT_PADDING_PX` below the viewport top edge (the content's own
 * top padding stays visible above the page). A naive "which page does
 * the top edge touch" test reports the PREVIOUS page at that exact
 * landing position (9 when the user clicked 10), and the old
 * mount-sync effect then re-scrolled the scroller to that previous
 * page — the "jump lands on 8/9, then snaps back toward page 1"
 * cascade. Counting the page whose top is at-or-below the landing
 * point (`top + CONTENT_PADDING_PX`, the same offset the jump
 * targets) makes a landed page read as itself, and matches what a
 * user scrolling sees: the page that fills the viewport.
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
  const adjusted = top + CONTENT_PADDING_PX;
  const page = Math.floor(adjusted / slotHeight) + 1;
  return Math.max(1, Math.min(pageCount, page));
}

// ---------------------------------------------------------------------------
// Mixed-size scroller geometry (DEF-141)
//
// The uniform helpers above describe a scroller where every page shares the
// first page's size. That breaks the moment pages DIFFER in size — the
// canonical case is a per-page crop of page 1: `firstPageSize` reflects the
// cropped page, so `slotOffsetTop` / `pageAtScrollTop` / `visiblePageRange`
// collapse EVERY slot to the crop box and the full pages render clipped
// inside crop-sized squares. The mixed helpers below take a per-page layout
// array (each entry the page's own post-rotation CSS size) so slots keep
// their OWN dimensions and the scrollbar / mount math tracks the true
// document height.
//
// The DOM layout contract is identical to the uniform case: the scroller is
// a flex column with `gap: PAGE_GAP_PX` between slots; slot N's top sits at
// `CONTENT_PADDING_PX + Σ_{i<N} (heightCss_i + PAGE_GAP_PX)`. When every
// page has the same height these helpers reduce to the uniform ones.

export interface MixedPageGeom {
  /** CSS px width of the page element (post-rotation). */
  widthCss: number;
  /** CSS px height of the page element (post-rotation), EXCLUDING
   *  the inter-slot gap (the flex `gap` supplies it). */
  heightCss: number;
}

/** Top offset of slot N inside a mixed-size scroller, in CSS px.
 *  1-based; slot 1 starts at the container's top padding. */
export function mixedSlotOffsetTop(
  pageNumber: number,
  geom: readonly MixedPageGeom[],
): number {
  if (pageNumber <= 1) {
    return CONTENT_PADDING_PX;
  }
  let top = CONTENT_PADDING_PX;
  const count = Math.min(pageNumber - 1, geom.length);
  for (let i = 0; i < count; i += 1) {
    const h = geom[i]?.heightCss ?? 0;
    top += (h > 0 ? h : 0) + PAGE_GAP_PX;
  }
  return top;
}

/** 1-based page number the viewport is showing at CSS pixel position `top`,
 *  for a mixed-size scroller. Mirrors `pageAtScrollTop`'s semantics: the
 *  page whose top is at-or-below the landing point (`top +
 *  CONTENT_PADDING_PX`), clamped to [1, pageCount]. Reduces to
 *  `pageAtScrollTop` when every page has the same height. */
export function mixedPageAtScrollTop(
  top: number,
  geom: readonly MixedPageGeom[],
  pageCount: number,
): number {
  if (pageCount <= 0) {
    return 1;
  }
  const adjusted = top + CONTENT_PADDING_PX;
  let acc = 0;
  let covered = 0;
  for (let p = 1; p <= pageCount; p += 1) {
    const h = geom[p - 1]?.heightCss ?? 0;
    if (h <= 0) {
      break;
    }
    acc += h + PAGE_GAP_PX;
    if (acc <= adjusted) {
      covered = p;
    } else {
      break;
    }
  }
  return Math.max(1, Math.min(pageCount, covered + 1));
}

/** Inclusive 1-based [start, end] range of pages currently visible inside a
 *  mixed-size scroller, plus a buffer of `bufferPages` on each side.
 *  Mirrors `visiblePageRange` for the per-page case: the first index is the
 *  page whose slot contains the viewport's top edge, and the range extends
 *  until the accumulated slot heights cover the viewport. */
export function mixedVisiblePageRange(
  scrollTop: number,
  viewportHeight: number,
  geom: readonly MixedPageGeom[],
  pageCount: number,
  bufferPages = 1,
): { start: number; end: number } {
  if (pageCount <= 0) {
    return { start: 1, end: 1 };
  }
  const topContent = scrollTop - CONTENT_PADDING_PX;
  let first = 0;
  if (topContent > 0) {
    let acc = 0;
    let covered = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const h = geom[i]?.heightCss ?? 0;
      if (h <= 0) {
        break;
      }
      acc += h + PAGE_GAP_PX;
      if (acc <= topContent) {
        covered = i + 1;
      } else {
        break;
      }
    }
    // `covered` counts full slots below the viewport top; clamp to the
    // last page index so a scroll far past the end can't produce an
    // empty / inverted range.
    first = Math.min(covered, pageCount - 1);
  }
  let last = first;
  let acc = 0;
  for (let i = first; i < pageCount; i += 1) {
    const h = geom[i]?.heightCss ?? 0;
    if (h <= 0) {
      break;
    }
    last = i;
    acc += h + PAGE_GAP_PX;
    if (acc >= viewportHeight) {
      break;
    }
  }
  const start = Math.max(0, first - bufferPages);
  const end = Math.min(pageCount - 1, last + bufferPages);
  return { start: start + 1, end: end + 1 };
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

/**
 * DEF-139 — resolve the 1-based pdf.js page the renderer must ask its
 * CURRENT proxy for at a given visible slot.
 *
 * The engine's `EngineState.pageOrder` entries are 0-based indices INTO
 * THE ENGINE'S pdf-lib document (its in-memory page array), NOT indices
 * into any serialized file: `insertBlankPage` / `insertFromPdf` append
 * new pages to the END of the pdf-lib doc and splice only `doc.order`,
 * `delete` flags a page without removing it from pdf-lib, and
 * `serializeDoc` (which `getDocumentBytes` runs) writes the output file
 * in `pageOrder` (VISIBLE) sequence. So a pdf.js proxy rebuilt from
 * `getDocumentBytes` bytes has its file pages in VISIBLE order, and
 * `pageOrder[k]` is NOT a file-page index anymore — asking that proxy
 * for `pageOrder[visible-1] + 1` returns the WRONG page whenever the
 * engine reordered or inserted pages (DEF-139: inserting a blank at
 * position 2 of a 34-page doc rendered the LAST page at slot 2).
 *
 * The renderer knows which of two proxy families it holds, carried as
 * `proxyVisibleOrder` on the tab's session:
 *  - `false` — the ORIGINAL open bytes. Its file order is the identity
 *    (on open the engine seeds `order = [0..N-1]`), so `pageOrder`
 *    entries still address it correctly. This is also the correct
 *    fallback during the brief post-op / pre-refresh window (DEF-121).
 *  - `true` — a RE-SERIALIZED proxy after `refreshDocProxyFor`
 *    succeeded. Its file pages ARE the visible pages, so slot N is
 *    file page N (identity) regardless of `pageOrder`.
 *
 * Pure; safe to call inside render. Keep `visibleToSourcePage` itself
 * untouched — it remains the "original proxy" mapping and keeps its
 * own DEF-064 semantics + tests.
 */
export function visibleToSourcePageForProxy(
  visiblePage: number,
  pageOrder: readonly number[],
  proxyVisibleOrder: boolean,
): number {
  if (proxyVisibleOrder) {
    return visiblePage;
  }
  return visibleToSourcePage(visiblePage, pageOrder);
}

/** Resolve the logical page label for a visible 1-based page slot.
 *
 *  Phase 12 — `renumberPages` lets the user override the displayed
 *  label for any page (e.g. roman numerals, chapter prefixes). The
 *  engine echoes a sparse `{page, label}` array; we look up the
 *  matching entry by page number and return the override string, or
 *  `null` when no override is set so the caller can fall back to the
 *  default `n / total` display.
 *
 *  Pure: no side effects, safe to call inside render. The lookup is
 *  O(n) over the labels array; callers that hit this on every page
 *  render should memoize the resulting `Map<page, label>` once per
 *  `pageLabels` change (the sidebar's `labelForPage` does exactly
 *  that — see `SideRail.tsx`). */
export interface PageLabelEntry {
  page: number;
  label: string;
}

export function resolvePageLabel(
  visiblePage: number,
  pageLabels: readonly PageLabelEntry[] | undefined,
): string | null {
  if (pageLabels === undefined || pageLabels.length === 0) return null;
  for (const entry of pageLabels) {
    if (entry.page === visiblePage && entry.label.trim().length > 0) {
      return entry.label;
    }
  }
  return null;
}

/** Build a `Map<page, label>` from a sparse label array. Used by the
 *  toolbar / sidebar to do O(1) per-page lookups when rendering many
 *  pages. Returns `null` when there are no labels (callers short-
 *  circuit on null). */
export function buildPageLabelMap(
  pageLabels: readonly PageLabelEntry[] | undefined,
): Map<number, string> | null {
  if (pageLabels === undefined || pageLabels.length === 0) return null;
  let map: Map<number, string> | null = null;
  for (const entry of pageLabels) {
    if (entry.label.trim().length === 0) continue;
    if (map === null) map = new Map();
    map.set(entry.page, entry.label);
  }
  return map;
}
