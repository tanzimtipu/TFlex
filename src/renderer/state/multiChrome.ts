// Phase 36 (chunk 7) — Multi Mode's shared-chrome decisions (pure, DOM-free).
//
// The workspace has exactly ONE Inspector and ONE Action Dock in Multi Mode,
// while the two panes each have their own DocumentView publishing live
// selections. These rules decide which pane's publish may drive the shared
// surface, so the wiring is unit-testable without mounting App.

import { paneTabId, type MultiModeState, type PaneId } from "./multiMode";

/**
 * Phase 39 (DEF-348a) — which pane the ONE shared Action Dock reads.
 *
 * The dock is WORKSPACE-level in Multi Mode: the operator's ruling is that it
 * must be present and functional whenever a document exists in the workspace,
 * whichever pane is focused. The focused pane normally drives it, but an EMPTY
 * pane has published no dock context (nothing to show) — historically that
 * made the whole dock vanish while the empty pane was focused. Fall back to the
 * other pane exactly when it owns a document; if neither pane has a document
 * the focused pane is returned (and the dock renders nothing, which is
 * correct: there is no document in the workspace).
 */
export function resolveDockPane(multi: MultiModeState, focused: PaneId): PaneId {
  if (paneTabId(multi, focused) !== null) return focused;
  const other: PaneId = focused === "A" ? "B" : "A";
  return paneTabId(multi, other) !== null ? other : focused;
}

/** What the host must do with a pane's published selection. */
export interface PaneSelectionDecision<T> {
  /** True when the publish may be applied to the shared Inspector. */
  apply: boolean;
  /** The value to store (`null` clears the shared selection). */
  value: T | null;
}

/**
 * The shared Inspector's text-selection rule:
 *   - SINGLE mode (`pane === null`) always applies (the pre-Phase-36 path,
 *     unchanged);
 *   - MULTI mode applies a publish only from the FOCUSED pane — a background
 *     pane's publish is ignored, so a pane that is not being worked in can
 *     never flap the shared panel.
 * The host additionally clears the shared selection on a focus switch (the
 * newly focused pane re-publishes on its next selection change).
 */
export function resolvePaneSelection<T>(
  pane: PaneId | null,
  focused: PaneId,
  next: T | null,
): PaneSelectionDecision<T> {
  if (pane === null) return { apply: true, value: next };
  return { apply: pane === focused, value: pane === focused ? next : null };
}
