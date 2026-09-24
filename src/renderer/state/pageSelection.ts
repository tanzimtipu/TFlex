// Phase 36 (chunk 3a) — the thumbnail multi-select model.
//
// Chunk 2 re-parented the rail's ThumbnailRail into the PAGES ContextPanel and
// deliberately deferred multi-select. This module is that deferral's pure core:
// a SET of VISIBLE 1-based page numbers (ascending, de-duped, clamped to the
// live page count) plus the gesture that mutates it.
//
// The set is the only thing the host (DocumentView) holds and the only thing
// the ActionDock consumes — `pageSelection.length >= 1` is exactly State 2's
// trigger. The ANCHOR is a gesture cursor, not app state: it records the last
// plain/ctrl click so a Shift click can extend the range from it. It travels
// with the set so the reducer stays a single pure value.
//
// Gestures (the rail's Thumb click maps its modifiers onto these):
//   - `replace` (plain click): TODAY's navigate gesture also leaves exactly
//     ONE page selected, so the dock's selection override and the rail's own
//     action bar both key off the same single page.
//   - `toggle`  (Ctrl/Cmd+click): add the page, or drop it when already in.
//   - `extend`  (Shift+click): select the inclusive range anchor..page.
//
// Every no-op returns the SAME object (identity) so React can skip re-renders,
// mirroring the other App-owned reducers (`stages`, `tabs`, `pagesPanel`).

/** The multi-select value: the selected pages plus the extend anchor. */
export interface PageSelectionState {
  /** The selected VISIBLE 1-based pages, ascending and de-duped. */
  readonly pages: readonly number[];
  /** The last plain/ctrl-clicked page a Shift click extends from, or null. */
  readonly anchor: number | null;
}

/** The empty selection (the dock's State 1 / a cleared panel). */
export const EMPTY_PAGE_SELECTION: PageSelectionState = { pages: [], anchor: null };

/** The gesture a thumbnail click maps to, from its modifiers. */
export type PageSelectGesture = 'replace' | 'toggle' | 'extend';

/**
 * Map a click's modifier keys onto a gesture. Ctrl/Cmd wins over Shift (the
 * rail's long-standing precedence), and a bare click is `replace`.
 */
export function pageSelectGestureFor(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): PageSelectGesture {
  if (event.ctrlKey || event.metaKey) return 'toggle';
  if (event.shiftKey) return 'extend';
  return 'replace';
}

/** True when `page` is a valid VISIBLE page for a `pageCount`-page document. */
function inRange(page: number, pageCount: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= pageCount;
}

/** Sort, de-dupe and clamp a raw page list to `1..pageCount`. */
export function normalizePageSelection(
  pages: Iterable<number>,
  pageCount: number,
): number[] {
  const seen = new Set<number>();
  for (const page of pages) {
    if (inRange(page, pageCount)) seen.add(page);
  }
  return [...seen].sort((a, b) => a - b);
}

/** True when two page lists hold the same pages in the same order. */
export function samePageSelection(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Apply one thumbnail gesture. An out-of-range page is refused (the state is
 * returned unchanged, by identity) — the rail only ever passes a visible page,
 * but a stale click after a delete must never invent one.
 */
export function applyPageSelectGesture(
  state: PageSelectionState,
  page: number,
  gesture: PageSelectGesture,
  pageCount: number,
): PageSelectionState {
  if (!inRange(page, pageCount)) return state;

  switch (gesture) {
    case 'replace': {
      if (state.pages.length === 1 && state.pages[0] === page && state.anchor === page) {
        return state;
      }
      return { pages: [page], anchor: page };
    }
    case 'toggle': {
      const has = state.pages.includes(page);
      const next = has
        ? state.pages.filter((p) => p !== page)
        : normalizePageSelection([...state.pages, page], pageCount);
      return { pages: next, anchor: page };
    }
    case 'extend': {
      const anchor = state.anchor;
      if (anchor === null) return { pages: [page], anchor: page };
      const lo = Math.min(anchor, page);
      const hi = Math.max(anchor, page);
      const range: number[] = [];
      for (let p = lo; p <= hi; p += 1) range.push(p);
      const next = normalizePageSelection(range, pageCount);
      return samePageSelection(next, state.pages) ? state : { pages: next, anchor };
    }
  }
}

/** Clear the selection (the dock's Clear verb, an empty-panel click). */
export function clearPageSelection(state: PageSelectionState): PageSelectionState {
  return state.pages.length === 0 && state.anchor === null ? state : EMPTY_PAGE_SELECTION;
}

/**
 * Drop selected pages that no longer exist (a delete shrank the document).
 * Returns the SAME object when nothing changed.
 */
export function prunePageSelection(
  state: PageSelectionState,
  pageCount: number,
): PageSelectionState {
  const next = normalizePageSelection(state.pages, pageCount);
  if (samePageSelection(next, state.pages)) return state;
  const anchor = state.anchor !== null && inRange(state.anchor, pageCount) ? state.anchor : null;
  return { pages: next, anchor };
}
