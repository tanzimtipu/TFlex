// Phase 32 — Multi Mode: the focus -> active-tab routing rules.
//
// THE key insight of the phase: dozens of document-scoped operations read
// the app's active tab id (`App.tsx`'s `activeTabIdRefLocal`, which mirrors
// `tabs.activeId`). If the FOCUSED PANE decides what that active tab is,
// every existing operation path — toolbar/CommandBar page ops, dialogs,
// Save/Save As, undo/redo, annotations — targets the focused pane with NO
// pane awareness in any handler.
//
// So the routing lives HERE, in one place, as pure decisions:
//
//   - `resolveTabStripActivation` — the two tab-strip rules.
//   - `resolvePaneFocus` — a focus move carries its pane's tab id, or
//     `null` when the pane is empty (the app then has no active document;
//     a document-scoped op is a clean no-op rather than hitting the
//     previously active tab).
//
// App applies the decision by routing through `activateTab` (which updates
// both `tabs.activeId` and the ref) — never by touching operation handlers.

import { paneTabId, type MultiModeState, type PaneId } from "./multiMode";

/** What the app must do when a tab in the strip is clicked. */
export interface TabStripDecision {
  /** Pane to focus, or `null` when focus does not move (single mode). */
  focus: PaneId | null;
  /** Pane the clicked document must be assigned to, or `null`. */
  assign: PaneId | null;
  /** The tab id the app's active tab becomes. Always the clicked tab. */
  activate: string;
}

/**
 * The tab-strip rules in Multi Mode:
 *   1. a tab that IS in a pane focuses that pane;
 *   2. a tab that is NOT in a pane is assigned to the focused pane
 *      (replacing that pane's document) — and a tab that happens to be
 *      the OTHER pane's document focuses that pane instead (rule 1).
 *
 * With the mode off this is the untouched single-mode activation.
 */
export function resolveTabStripActivation(
  state: MultiModeState,
  tabId: string,
): TabStripDecision {
  if (!state.enabled) return { focus: null, assign: null, activate: tabId };
  if (state.paneA === tabId) return { focus: "A", assign: null, activate: tabId };
  if (state.paneB === tabId) return { focus: "B", assign: null, activate: tabId };
  return { focus: state.focused, assign: state.focused, activate: tabId };
}

/** What the app must do when a pane is focused (click / header / assign). */
export interface PaneFocusDecision {
  focus: PaneId;
  /** The tab to activate, or `null` when the pane holds no document. */
  activate: string | null;
}

/** Focusing a pane makes that pane's document the app's active tab. */
export function resolvePaneFocus(
  state: MultiModeState,
  pane: PaneId,
): PaneFocusDecision {
  return { focus: pane, activate: paneTabId(state, pane) };
}

/**
 * Phase 39 (item 2 / DEF-348-adjacent) — when a pane is EMPTY, may the app
 * clear its active document? Only when NO pane owns a document. If the other
 * pane still holds one, the active document must be KEPT: the Inspector's
 * inset (`--tf-tools-inset`) keys on "is there an active document", so
 * clearing it while an empty pane is focused collapses the Inspector, and a
 * subsequent Open into that pane would reopen it and move the divider — the
 * operator's "clicking Open changes the pane layout". Keeping the workspace's
 * document active (exactly what the workspace-level shared dock already reads)
 * makes the inset — and therefore the divider — stable across the open.
 */
export function shouldClearActiveOnEmptyFocus(
  state: MultiModeState,
  pane: PaneId,
): boolean {
  // `pane` is the newly focused (empty) pane; the OTHER pane decides.
  const other = pane === "A" ? "B" : "A";
  return paneTabId(state, other) === null;
}

/**
 * Which tab the app must activate after a pane is emptied. `null` means the
 * app has no active document (the focused pane is empty), so document-scoped
 * operations must not fall back to the previously active tab.
 */
export function resolvePaneClear(
  state: MultiModeState,
  pane: PaneId,
  activeTabId: string | null,
): string | null {
  const cleared = paneTabId(state, pane);
  if (cleared !== null && cleared === activeTabId) return null;
  return activeTabId;
}
