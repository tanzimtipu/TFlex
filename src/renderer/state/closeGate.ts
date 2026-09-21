// Phase 32 — Multi Mode: the close / quit safety gate, as pure decisions.
//
// The DEF-142 whole-window close gate snapshots EVERY modified tab into a
// queue and walks the CloseTabPromptDialog through it one tab at a time.
// Because a pane's document IS a tab, the gate already covers both panes —
// this module keeps that "every modified document" selection explicit and
// unit-testable instead of buried in the App callback:
//
//   - `collectModifiedTabIds` is the same modified check `closeTab` uses:
//     the tabs reducer's `meta.modified` OR the engineUi mirror's
//     `state.modified` (the mirror catches the batched-dispatch window
//     right after an engine op).
//   - `orderWindowCloseQueue` keeps an already-showing per-tab prompt first
//     so the open dialog continues to own the flow; every other modified
//     tab follows, in tab order. Cancel clears the queue and the window
//     stays open.

/** The tab fields the gate reads. */
export interface CloseGateTab {
  id: string;
  modified: boolean;
}

/** The engineUi mirror shape the gate consults. */
export interface CloseGateEngineUi {
  [tabId: string]: { state: { modified: boolean } } | undefined;
}

/** Every tab with unsaved changes, in tab order — both panes included. */
export function collectModifiedTabIds(
  tabs: readonly CloseGateTab[],
  engineUi: CloseGateEngineUi,
): string[] {
  return tabs
    .filter((t) => t.modified || engineUi[t.id]?.state.modified === true)
    .map((t) => t.id);
}

/**
 * Order the prompt queue. A per-tab close prompt that is already showing
 * stays first so the open dialog keeps owning the flow; the rest of the
 * modified tabs follow in tab order.
 */
export function orderWindowCloseQueue(
  modifiedIds: readonly string[],
  pendingId: string | null,
): string[] {
  if (pendingId !== null && modifiedIds.includes(pendingId)) {
    return [pendingId, ...modifiedIds.filter((id) => id !== pendingId)];
  }
  return [...modifiedIds];
}
