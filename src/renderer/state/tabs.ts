export type DocKind = 'file' | 'sample' | 'empty';

/** A tab whose `kind` is `'empty'` is a placeholder — it does not yet have
 *  a real document behind it. The renderer renders the Welcome screen
 *  for the active tab when the active id points at an empty tab, but the
 *  tab itself still occupies a slot so the user can open a PDF into it
 *  and not lose their place (DEF-P6-empty-tab). */
export interface TabMeta {
  id: string;
  title: string;
  filePath: string;
  kind: DocKind;
  /**
   * Whether the engine holds unsaved changes for this tab. Owned by the
   * renderer (kept in sync via engine-state events); cleared on save success
   * and set true the moment any successful engine op lands.
   */
  modified: boolean;
}

export interface TabsState {
  tabs: TabMeta[];
  activeId: string | null;
}

export type TabsAction =
  | { type: 'open'; tab: TabMeta }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'set-modified'; id: string; modified: boolean }
  | { type: 'rename'; id: string; title: string }
  /** Phase 6 — promote an empty tab to a real document. The renderer
   *  keeps the same id but flips the kind, title, and filePath so the
   *  user opens the PDF *into* the empty tab instead of stacking a new
   *  one. */
  | { type: 'fill-empty'; id: string; title: string; filePath: string }
  /** Phase 6 — open a brand-new empty tab. The reducer appends and
   *  activates it. */
  | { type: 'open-empty'; tab: TabMeta };

export const initialTabsState: TabsState = { tabs: [], activeId: null };

/**
 * Tab bar state. Opening re-uses an existing tab for the same path; closing
 * the active tab activates its nearest neighbor (left if possible).
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      // Phase 6 — when the active tab is an empty placeholder, opening a
      // PDF fills it in place instead of stacking a new tab. The user
      // expects the "+ tab" affordance to behave as "the next PDF I open
      // will land here".
      if (
        action.tab.kind !== 'empty' &&
        state.activeId !== null &&
        state.tabs.some((t) => t.id === state.activeId && t.kind === 'empty')
      ) {
        const targetId = state.activeId;
        let changed = false;
        const tabs = state.tabs.map((t) => {
          if (t.id !== targetId) return t;
          if (
            t.kind === 'empty' &&
            (t.title !== action.tab.title || t.filePath !== action.tab.filePath)
          ) {
            changed = true;
            return {
              ...t,
              kind: 'file' as const,
              title: action.tab.title,
              filePath: action.tab.filePath,
            };
          }
          return t;
        });
        if (changed) {
          return { tabs, activeId: targetId };
        }
      }
      const existing = state.tabs.find((t) => t.filePath === action.tab.filePath);
      if (existing !== undefined) {
        return { ...state, activeId: existing.id };
      }
      return { tabs: [...state.tabs, action.tab], activeId: action.tab.id };
    }
    case 'close': {
      const index = state.tabs.findIndex((t) => t.id === action.id);
      if (index === -1) {
        return state;
      }
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeId = state.activeId;
      if (state.activeId === action.id) {
        activeId = tabs.length === 0 ? null : tabs[Math.min(index, tabs.length - 1)].id;
      }
      return { tabs, activeId };
    }
    case 'activate': {
      if (!state.tabs.some((t) => t.id === action.id)) {
        return state;
      }
      return { ...state, activeId: action.id };
    }
    case 'set-modified': {
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (t.id === action.id && t.modified !== action.modified) {
          changed = true;
          return { ...t, modified: action.modified };
        }
        return t;
      });
      if (!changed) return state;
      return { ...state, tabs };
    }
    case 'rename': {
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (t.id === action.id && t.title !== action.title) {
          changed = true;
          return { ...t, title: action.title };
        }
        return t;
      });
      if (!changed) return state;
      return { ...state, tabs };
    }
    case 'open-empty': {
      // A brand-new empty tab. Append and activate. We deliberately
      // don't dedupe — multiple empty tabs would be useful for
      // "open A here, B there" workflows, and a duplicate-detection
      // pass would close real tabs by accident.
      return { tabs: [...state.tabs, action.tab], activeId: action.tab.id };
    }
    case 'fill-empty': {
      // The user picked a file while an empty tab was active. Flip that
      // tab's kind / title / filePath in place; the rest of the list is
      // unchanged so activation and ordering stay intact.
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (t.id !== action.id) return t;
        if (t.kind === 'empty' && (t.title !== action.title || t.filePath !== action.filePath)) {
          changed = true;
          return { ...t, kind: 'file' as const, title: action.title, filePath: action.filePath };
        }
        return t;
      });
      if (!changed) return state;
      return { ...state, tabs };
    }
  }
}
