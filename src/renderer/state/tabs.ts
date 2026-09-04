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
  | {
      type: 'open';
      tab: TabMeta;
      /** DEF-170 — a derived / in-memory result tab (extract, split,
       *  optimize, create) must never be collapsed onto a previously
       *  opened tab that happens to share the same synthetic filePath.
       *  The same-path dedupe exists for re-opening a real on-disk
       *  document; without this opt-out every extract result from the
       *  same source would share `<extract>report.pdf` and the second
       *  one would be silently dropped (orphaning its session). Set
       *  to false only for brand-new derived documents. */
      dedupePath?: boolean;
    }
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

/** Decide which id the next `open` action should carry. Single source of
 *  truth for tab id allocation — callers (`openFromBytes`) must use the
 *  returned id for BOTH the per-tab document session (`openTabs[id]`)
 *  AND the dispatched `tab` meta, so the tab bar and the session stay
 *  in sync.
 *
 *  - If the active tab is an empty placeholder and we're not opening
 *    another empty placeholder, the empty tab's id is reused and the
 *    caller is signalling "fill this in place".
 *  - Otherwise a fresh UUID is minted and the reducer will append.
 *
 *  Empty tabs hold `filePath === ''`, so the caller's `meta.filePath`
 *  must be the real document path; only the `id` is reused.
 */
export function resolveOpenId(
  state: TabsState,
  incoming: { kind: DocKind; filePath: string },
  mint: () => string = (): string => {
    // crypto.randomUUID is available in the renderer; tests override
    // `mint` for deterministic ids. The default branch (test envs
    // without crypto.randomUUID) produces a recognisable id so unit
    // tests can assert "a fresh id was minted".
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (c?.randomUUID !== undefined) return c.randomUUID();
    return `fresh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  },
): { id: string; fillsEmptyId: string | null } {
  if (
    incoming.kind !== 'empty' &&
    state.activeId !== null &&
    state.tabs.some((t) => t.id === state.activeId && t.kind === 'empty')
  ) {
    return { id: state.activeId, fillsEmptyId: state.activeId };
  }
  return { id: mint(), fillsEmptyId: null };
}

/**
 * Tab bar state. Opening re-uses an existing tab for the same path; closing
 * the active tab activates its nearest neighbor (left if possible).
 */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      // The caller (`openFromBytes` via `resolveOpenId`) decides the id
      // before dispatching. The reducer trusts that id and performs one
      // of three operations:
      //
      //   1. id matches an existing tab -> mutate in place (empty-fill
      //      case: the caller reused the empty tab's id; we replace
      //      its kind/title/filePath with the incoming meta so the
      //      placeholder becomes a real document without moving the
      //      slot).
      //   2. filePath matches an existing real tab -> activate that
      //      tab and drop the incoming meta (re-opening an already-open
      //      document). Derive-tab opens pass `dedupePath: false` to
      //      skip this branch (DEF-170): their synthetic filePath would
      //      otherwise collide with the previous result tab and the new
      //      tab would be dropped, orphaning its session.
      //   3. otherwise -> append.
      //
      // The pre-DEF-036 implementation did (1) implicitly using
      // `state.activeId`. That silently allocated an id different from
      // the one `openFromBytes` had stored the session under, breaking
      // `openTabs[activeId]` lookups. Now the id is computed once in
      // the caller and passed in on the meta.
      const byId = state.tabs.find((t) => t.id === action.tab.id);
      if (byId !== undefined) {
        const isSame =
          byId.kind === action.tab.kind &&
          byId.title === action.tab.title &&
          byId.filePath === action.tab.filePath &&
          byId.modified === action.tab.modified;
        if (isSame) {
          // Nothing to update, but ensure the tab is activated (caller
          // intent: this id is now the focus).
          if (state.activeId === action.tab.id) return state;
          return { ...state, activeId: action.tab.id };
        }
        const tabs = state.tabs.map((t) => (t.id === action.tab.id ? action.tab : t));
        return { tabs, activeId: action.tab.id };
      }
      if (action.tab.filePath !== '' && action.dedupePath !== false) {
        const existing = state.tabs.find((t) => t.filePath === action.tab.filePath);
        if (existing !== undefined) {
          return { ...state, activeId: existing.id };
        }
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
