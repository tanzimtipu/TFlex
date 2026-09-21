// Phase 32 (chunk 2d) — cross-document page drag and drop, pure mapping.
//
// This module owns the ONE drag model both paths share: the rail
// (ThumbnailRail inside the Multi Mode shared rail) and the canvas
// (DocumentView's per-page grip). It is deliberately pure — no React, no
// engine, no DOM — so the payload -> operation mapping (source tab/pages,
// target tab/insertion index, move vs copy, the 1-based translation and
// the -1 append sentinel) is unit-testable on its own.
//
// Conventions match the engine API exactly (chunk 1):
//   - `pages` are 1-BASED visible page numbers in the source document;
//   - `atIndex` is the 1-BASED target insertion slot, with -1 = append;
//   - mode is 'move' (default) or 'copy' (Ctrl / Alt held).

/** Move by default; Ctrl or Alt on the drop makes it a copy. */
export type PageDropMode = "move" | "copy";

/** Where a drag started: one document, one or more 1-based visible pages. */
export interface PageDragSource {
  /** The document the dragged page(s) come from (the tab id). */
  tabId: string;
  /** 1-based visible pages in document order: the whole selection when the
   *  grabbed page is part of it, otherwise just the grabbed page. */
  pages: number[];
  /** The 1-based page the user grabbed (the drag anchor / paint target). */
  anchorPage: number;
}

/** Where a drag would land: a document and a 1-based insertion slot. */
export interface PageDropTarget {
  /** The document the page(s) would land in (the tab id). */
  tabId: string;
  /** 1-based insertion slot: insert BEFORE the page currently at this
   *  position. -1 means "append at the end". */
  atIndex: number;
  /** The mode the live dragover reported (Ctrl / Alt held = copy). Purely
   *  for the affordance: the applied mode always comes from the drop
   *  event, never from a stale hover. */
  mode?: PageDropMode;
}

/** A resolved drop, ready to hand to the apply helper. */
export interface PageDropOp {
  fromTabId: string;
  /** 1-based visible source pages, document order. */
  pages: number[];
  toTabId: string;
  /** 1-based insertion slot, or -1 to append. */
  atIndex: number;
  mode: PageDropMode;
  /** True when source and target are the same document: the EXISTING
   *  intra-document reorder path, never the cross-document engine call. */
  sameDoc: boolean;
}

/**
 * Build the drag source for a grabbed page. When the grabbed page is part
 * of the current selection the WHOLE selection travels (relative order
 * preserved, sorted into document order); otherwise only the grabbed page.
 */
export function buildDragSource(
  tabId: string,
  anchorPage: number,
  selection: readonly number[] | null,
): PageDragSource {
  const inSelection = selection !== null && selection.includes(anchorPage);
  const pages = inSelection
    ? [...selection].sort((a, b) => a - b)
    : [anchorPage];
  return { tabId, anchorPage, pages };
}

/** The insertion slot for a drop on a rail thumbnail: insert BEFORE the
 *  target thumb (today's reorder affordance). */
export function railInsertIndex(targetPage: number): number {
  return targetPage;
}

/** The insertion slot for a canvas drop, from the pointer's position in the
 *  page slot: before the page (top half) or after it (bottom half). */
export function canvasInsertIndex(visiblePage: number, pageCount: number, after: boolean): number {
  if (!after) return visiblePage;
  // After the last page there is no "next" slot to insert before: use the
  // engine's append sentinel.
  return visiblePage >= pageCount ? -1 : visiblePage + 1;
}

/** Whether a canvas pointer sits in the lower half of its page slot. */
export function canvasDropIsAfter(pointerY: number, slotTop: number, slotHeight: number): boolean {
  return pointerY >= slotTop + slotHeight / 2;
}

/** Move vs copy from the drop event's modifiers: Ctrl (or Alt) = copy. */
export function dropModeFromEvent(e: { ctrlKey: boolean; altKey: boolean }): PageDropMode {
  return e.ctrlKey || e.altKey ? "copy" : "move";
}

/** The HTML5 dropEffect (and cursor) that communicates the pending mode. */
export function dropEffectFor(mode: PageDropMode): "copy" | "move" {
  return mode === "copy" ? "copy" : "move";
}

/** The first 1-based position the inserted pages will occupy in the target,
 *  used to reveal the drop after the refresh lands. */
export function insertedStartPage(op: PageDropOp, toPageCount: number): number {
  return op.atIndex === -1 ? toPageCount - op.pages.length + 1 : op.atIndex;
}

/**
 * Resolve a source + target into the operation to apply, or null when the
 * drop is a no-op (no source, no target, empty page list, an out-of-range
 * slot, or an intra-document drop that would not move anything).
 *
 * `pageCount` is the TARGET document's current page count; it is only read
 * for the same-document reorder conversion (and the -1 append slot).
 */
export function resolveDrop(
  source: PageDragSource | null,
  target: PageDropTarget | null,
  mode: PageDropMode,
  pageCount: number,
): PageDropOp | null {
  if (source === null || target === null) return null;
  if (source.pages.length === 0) return null;

  if (source.tabId === target.tabId) {
    // The existing reorder path moves exactly one page.
    if (source.pages.length !== 1) return null;
    const from = source.pages[0];
    const slot = target.atIndex === -1 ? pageCount + 1 : target.atIndex;
    if (slot < 1 || slot > pageCount + 1) return null;
    // Insert before `slot`; when the page sat above it, removing the page
    // first shifts the slot down by one (today's rail math exactly).
    const to = from < slot ? slot - 1 : slot;
    if (to === from) return null;
    if (to < 1 || to > pageCount) return null;
    return {
      fromTabId: source.tabId,
      pages: [from],
      toTabId: target.tabId,
      atIndex: to,
      mode,
      sameDoc: true,
    };
  }

  if (target.atIndex !== -1 && target.atIndex < 1) return null;
  return {
    fromTabId: source.tabId,
    pages: [...source.pages],
    toTabId: target.tabId,
    atIndex: target.atIndex,
    mode,
    sameDoc: false,
  };
}
