// Phase 32 — Multi Mode: the two-pane / mode state model.
//
// Multi Mode is a VIEW over the existing tab/document store, never a new
// document model: a pane's document IS a tab id, and the two-pane layout
// renders two `DocumentView`s (each keyed by its tab id) over two tab ids.
// Nothing about tabs, the tab strip or single-document behaviour changes
// while the mode is off.
//
// The state is a pure value driven by this reducer, exactly like the other
// App-owned reducers (`tabs`, `pagesPanel`): App holds it, dispatches
// actions and threads the result into the stage. All the phase's structural
// invariants live here so they can be unit-tested without a DOM:
//
//   - TWO panes, exactly. The pane id type has two members; no action can
//     mint a third pane.
//   - Enabling seeds pane A with the tab that was active at that moment and
//     leaves pane B empty (the explicit empty state).
//   - The same document never occupies both panes: the conflicting assign is
//     REFUSED (state unchanged) and `paneAssignError` hands the caller the
//     message to show — never a silent no-op.
//   - Disabling clears both panes and returns to the single-pane layout
//     without touching any tab.
//   - `reconcile` clears a pane whose tab is gone (closed tab) so a stale
//     pane can never survive its document.

import { isSamePath } from './pathIdentity';

/** The two — and only two — pane slots. */
export type PaneId = 'A' | 'B';

export interface MultiModeState {
  enabled: boolean;
  /** Tab id shown in the left pane. `null` while the pane is empty. */
  paneA: string | null;
  /** Tab id shown in the right pane. `null` while the pane is empty. */
  paneB: string | null;
  /** Exactly one pane is focused at a time. */
  focused: PaneId;
}

export type MultiModeAction =
  /** Turn the mode on, seeding pane A from the tab that is active now.
   *  A `null` active tab id cannot seed pane A, so the action is a no-op
   *  (the caller gates the control on a real document anyway). */
  | { type: 'enable'; activeTabId: string | null }
  /** Turn the mode off and clear both panes. */
  | { type: 'disable' }
  /** Put a tab in a pane, replacing whatever was there. Refused (state
   *  unchanged) when it would duplicate the other pane's document, or
   *  while the mode is off. */
  | { type: 'assign'; pane: PaneId; tabId: string }
  /** Empty a pane. The layout then shows that pane's empty state. */
  | { type: 'clear'; pane: PaneId }
  /** Move focus. Meaningful only while the mode is on. */
  | { type: 'focus'; pane: PaneId }
  /** Drop panes whose tab no longer exists (a closed tab must never leave
   *  a stale pane). Auto-disables the mode when no tabs remain at all. */
  | { type: 'reconcile'; tabIds: readonly string[] };

export const initialMultiModeState: MultiModeState = {
  enabled: false,
  paneA: null,
  paneB: null,
  focused: 'A',
};

/** The pane that is NOT `pane`. */
export function otherPane(pane: PaneId): PaneId {
  return pane === 'A' ? 'B' : 'A';
}

/** The tab id a pane currently holds (`null` when empty). */
export function paneTabId(state: MultiModeState, pane: PaneId): string | null {
  return pane === 'A' ? state.paneA : state.paneB;
}

/** True when the pane holds a document. */
export function isPaneFilled(state: MultiModeState, pane: PaneId): boolean {
  return paneTabId(state, pane) !== null;
}

/**
 * The single source of truth for the assign guard. Returns `null` when the
 * assignment is legal, otherwise the user-facing message the caller must
 * show (the app's toasts). The reducer applies the same rule, so a caller
 * that skips the guard still cannot corrupt the state.
 */
export function paneAssignError(
  state: MultiModeState,
  pane: PaneId,
  tabId: string,
): string | null {
  if (!state.enabled) {
    return 'Turn on Multi Mode before assigning a document to a pane.';
  }
  if (state.paneA !== null && state.paneA === state.paneB) {
    // Defensive: the invariant says this can never happen, but if a caller
    // ever forced it the layout would show one document twice.
    return 'A document cannot be shown in both panes.';
  }
  if (paneTabId(state, otherPane(pane)) === tabId) {
    return 'That document is already shown in the other pane.';
  }
  return null;
}

/**
 * DEF-278 — the same FILE must never be shown in both panes either.
 * `paneAssignError` owns the tab-identity rule, but opening the same file
 * twice (a sample and its on-disk twin, or two separate open sessions of
 * one path) mints two tab ids, so the tab-id rule cannot see the conflict.
 * The user's intent is "that file is already in the other pane", so the
 * comparison here is `TabMeta.filePath` IDENTITY — by canonical path key
 * (`isSamePath`, DEF-279), so a case-variant or separator-variant
 * spelling of the same file is refused too. The caller
 * resolves those paths from the tabs store (the mode state knows only ids).
 * Returns the message to show, or `null` when the assignment is allowed.
 * The reducer does not apply this rule (it has no path knowledge); App
 * calls it on every assignment path — pick list, tab strip and open.
 */
export function paneAssignPathError(
  state: MultiModeState,
  pane: PaneId,
  filePath: string | null,
  filePathForTab: (tabId: string) => string | null,
): string | null {
  if (!state.enabled) return null;
  if (filePath === null || filePath === '') return null;
  const other = paneTabId(state, otherPane(pane));
  if (other === null) return null;
  const otherPath = filePathForTab(other);
  // DEF-279 — compare canonical keys, not raw strings: a case-variant path
  // (or a different separator spelling) names the same on-disk file.
  if (otherPath === null || otherPath === '' || !isSamePath(otherPath, filePath)) {
    return null;
  }
  return 'That file is already shown in the other pane.';
}

export function multiModeReducer(
  state: MultiModeState,
  action: MultiModeAction,
): MultiModeState {
  switch (action.type) {
    case 'enable': {
      if (action.activeTabId === null) return state;
      if (state.enabled && state.paneA === action.activeTabId) return state;
      return {
        enabled: true,
        paneA: action.activeTabId,
        // Pane B always starts empty: the user picks or opens a second
        // document through the pane's own empty state.
        paneB: null,
        focused: 'A',
      };
    }
    case 'disable': {
      if (!state.enabled && state.paneA === null && state.paneB === null) {
        return state;
      }
      return { ...initialMultiModeState };
    }
    case 'assign': {
      // No third pane exists: anything other than the two known ids is
      // refused rather than coerced into a slot.
      if (action.pane !== 'A' && action.pane !== 'B') return state;
      if (paneAssignError(state, action.pane, action.tabId) !== null) return state;
      if (paneTabId(state, action.pane) === action.tabId) return state;
      return action.pane === 'A'
        ? { ...state, paneA: action.tabId }
        : { ...state, paneB: action.tabId };
    }
    case 'clear': {
      if (paneTabId(state, action.pane) === null) return state;
      return action.pane === 'A'
        ? { ...state, paneA: null }
        : { ...state, paneB: null };
    }
    case 'focus': {
      if (action.pane !== 'A' && action.pane !== 'B') return state;
      if (state.focused === action.pane) return state;
      return { ...state, focused: action.pane };
    }
    case 'reconcile': {
      const live = new Set(action.tabIds);
      const paneA = state.paneA !== null && live.has(state.paneA) ? state.paneA : null;
      const paneB = state.paneB !== null && live.has(state.paneB) ? state.paneB : null;
      if (state.enabled && paneA === null && paneB === null && action.tabIds.length === 0) {
        // Every tab is gone: the two-pane layout has nothing to show, so
        // fall back to the single-pane (welcome) state rather than an
        // empty split.
        return { ...initialMultiModeState };
      }
      if (paneA === state.paneA && paneB === state.paneB) return state;
      return { ...state, paneA, paneB };
    }
  }
}
