// DEF-292 — renderer half of the joint cross-document undo/redo.
//
// Phase 32 lets the user move pages between the two Multi Mode panes in
// one atomic engine op. The engine records ONE joint entry on BOTH
// documents, so undoing (or redoing) from EITHER pane must revert (or
// re-apply) BOTH. The engine already does that and echoes the OTHER
// document's post-op state as `EngineState.pairedState` on the undo/redo
// result (the adapter normalizes it — see `engineClient.finishUndoRedo`).
//
// This module turns that echo into the concrete refresh plan for the
// other pane: which tab to update, its new normalized state, and its
// post-undo/redo counters/flags. Keeping the decision pure (no React, no
// DOM) lets the App wiring stay a thin apply-the-plan block and lets the
// mapping be unit-tested without mounting App.
//
// Returns `null` when there is nothing to do: no paired echo (a plain
// single-document undo/redo), or the paired document has no live tab
// (its tab was closed between the engine call and this read — the engine
// would normally have refused the joint undo in that case, so this is
// only a defensive guard).

import type { EngineState } from "../engine/types";
import {
  ZERO_COUNTERS,
  countersAfterRedo,
  countersAfterUndo,
  flagsFromCounters,
  type UndoCounters,
} from "./undoCounters";

/** The other pane's post-undo/redo mirror update. */
export interface JointPaneRefresh {
  /** Tab id whose `engineUi` mirror must be updated and whose pdf.js
   *  proxy must be refreshed. */
  tabId: string;
  /** The other document's renderer-normalized state. */
  state: EngineState;
  /** Counters for the other document: the joint entry was popped from
   *  its undo stack (undo) or its redo stack (redo) by the same call. */
  counters: UndoCounters;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Plan the other pane's refresh after a joint undo/redo.
 *
 * @param direction  `'undo'` or `'redo'` — decides which counter transition
 *                   the other document went through.
 * @param activeTabId The tab whose undo/redo was invoked (already mirrored
 *                   by the caller). A paired doc resolving to this tab is
 *                   ignored (defensive: the two panes never share a doc).
 * @param paired      The normalized paired echo, or `undefined`.
 * @param tabIdForEngineDoc Maps an engine doc id to its live tab id, or
 *                   `null` when no tab holds that document.
 * @param countersFor Reads the other tab's current counters (undefined
 *                   before any op — treated as zero).
 */
export function planJointPaneRefresh(
  direction: "undo" | "redo",
  activeTabId: string,
  paired: { docId: string; state: EngineState } | undefined,
  tabIdForEngineDoc: (engineDocId: string) => string | null,
  countersFor: (tabId: string) => UndoCounters | undefined,
): JointPaneRefresh | null {
  if (paired === undefined) return null;
  const tabId = tabIdForEngineDoc(paired.docId);
  if (tabId === null || tabId === activeTabId) return null;
  const prev = countersFor(tabId) ?? ZERO_COUNTERS;
  const counters =
    direction === "undo" ? countersAfterUndo(prev) : countersAfterRedo(prev);
  const flags = flagsFromCounters(counters);
  return {
    tabId,
    state: paired.state,
    counters,
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
  };
}
