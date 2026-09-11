// Phase 13 — Hand (pan) mode helpers.
//
// When the toolbar's Hand button is armed, the document scroller
// becomes grab-and-drag pannable: pressing anywhere on the scroller
// (except on interactive chrome) and dragging scrolls the viewport,
// exactly like a PDF reader's hand tool.
//
// The gesture lives in DocumentView as pointer handlers on
// `.document-scroller`; the interactive-ancestor bail-out and the
// scroll math are extracted here so the cross-bubbling contract
// (AGENTS.md — never swallow a click that lands on an interactive
// element) is unit-testable without mounting the workspace.

/** A scroller press captured at drag start. */
export interface PanDragStart {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Selectors that must NEVER start (or be swallowed by) a pan drag.
 *  A press on any of these — or on a descendant of one — belongs to
 *  the control itself: PDF link annotations, form widgets, floating
 *  editor chrome, page action bars. The pan handler must bail out
 *  BEFORE it calls preventDefault so the native click still lands. */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]';

/** True when the pointerdown target (or one of its ancestors) is an
 *  interactive element the pan gesture must not swallow. Element-only:
 *  non-Element targets (text nodes, document) are treated as pannable
 *  because they cannot be controls. */
export function isPanBlockingTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/** The scroll position for a pan drag frame: invert the pointer delta
 *  (dragging right moves content right, i.e. scrolls left) and clamp
 *  to the non-negative scroll range. The browser clamps the upper
 *  bound to the scroller's overflow range on assignment, so only the
 *  >= 0 side is pinned here. */
export function panScrollPosition(
  start: PanDragStart,
  deltaX: number,
  deltaY: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, start.scrollLeft - deltaX),
    top: Math.max(0, start.scrollTop - deltaY),
  };
}