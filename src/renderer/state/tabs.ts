export type DocKind = 'file' | 'sample';

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
  | { type: 'rename'; id: string; title: string };

export const initialTabsState: TabsState = { tabs: [], activeId: null };

/**
 * Tab bar state. Opening re-uses an existing tab for the same path; closing
 * the active tab activates its nearest neighbor (left if possible).
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
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
  }
}
