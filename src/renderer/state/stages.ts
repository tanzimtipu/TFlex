// Phase 36 — TFlex STAGES: the stage model.
//
// A stage is the STAGE OF WORK the workspace is currently organised
// around: PAGES / EDIT / REVIEW / DELIVER. It is intentionally NOT a
// feature flag and NOT a mode: nothing about a document changes when the
// stage changes. Switching stage swaps only the left context panel, the
// Action Dock contents and the Inspector contents (Phase 36 chunk 3+);
// the title bar, the Stage Rail, the canvas and the floating pills never
// move.
//
// Like the other App-owned reducers (`tabs`, `multiMode`, `pagesPanel`)
// this is a pure value: App holds it, dispatches actions and threads the
// result into the stage. All the phase's structural invariants live here
// so they can be unit-tested without a DOM:
//
//   - SINGLE mode tracks a stage PER TAB, keyed by the tab id, so switching
//     a mode in one tab never propagates to another tab.
//   - MULTI mode tracks a stage PER PANE, keyed by the pane id, so each
//     pane owns its stage (Phase 36 criterion 10) and the two panes can
//     never share one mutable slot.
//   - An unknown stage value is refused (state unchanged) rather than
//     coerced, and an unknown pane id / tab id falls back to the default
//     stage (there is no third pane — `PaneId` has two members).
//   - Every no-op returns the SAME object (identity) so React can skip
//     the re-render.
//   - `Ctrl+1..4` maps to STAGE_ORDER and nothing else.

import type { PaneId } from './multiMode';

/** The four stages of work, in rail order. `global` is NOT a stage: it is
 *  the registry's bucket for commands with no natural stage (the
 *  command palette + title bar / File menu own those). */
export type Stage = 'pages' | 'edit' | 'review' | 'deliver';

/** The canonical stage order: rail order AND the `Ctrl+1..4` order. */
export const STAGE_ORDER: readonly Stage[] = ['pages', 'edit', 'review', 'deliver'];

/** Human labels for the rail's stage buttons. */
export const STAGE_LABELS: Record<Stage, string> = {
  pages: 'Pages',
  edit: 'Edit',
  review: 'Review',
  deliver: 'Deliver',
};

/** The stage a fresh workspace opens on. */
export const DEFAULT_STAGE: Stage = 'pages';

/** True when `value` is one of the four stages. */
export function isStage(value: unknown): value is Stage {
  return value === 'pages' || value === 'edit' || value === 'review' || value === 'deliver';
}

/** True when `value` is one of the two pane slots. */
export function isPaneId(value: unknown): value is PaneId {
  return value === 'A' || value === 'B';
}

/** The `Ctrl+<digit>` shortcut for a stage (`Ctrl+1` for PAGES, ...). */
export function stageShortcutLabel(stage: Stage): string {
  return `Ctrl+${STAGE_ORDER.indexOf(stage) + 1}`;
}

/** The stage bound to a bare digit key ('1'..'4'), or `null` when the key
 *  is outside the mapping. Pure so the rail's key handler can be tested
 *  without a DOM. */
export function stageForDigit(key: string): Stage | null {
  const index = key.length === 1 ? key.charCodeAt(0) - 49 : -1;
  return index >= 0 && index < STAGE_ORDER.length ? STAGE_ORDER[index] : null;
}

/** The subset of a keyboard event the `Ctrl+1..4` binding reads. */
export interface StageKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Resolve a keyboard event to a stage switch. Returns `null` unless the
 * event is exactly `Ctrl+<digit>` with no other modifier — so `Ctrl+Shift+1`
 * and `Alt+1` stay free for other bindings, and the pre-existing document
 * shortcuts (`Ctrl+S`, `Ctrl+F`, `Ctrl+Shift+O`, `Ctrl+Shift+S`, `Ctrl+W`,
 * `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+,`) are never shadowed.
 */
export function stageForCtrlDigit(event: StageKeyEvent): Stage | null {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null;
  return stageForDigit(event.key);
}

export interface StageState {
  /** SINGLE mode: one stage per tab, keyed by the tab id. An unknown tab id
   *  falls back to the default stage, so a fresh tab renders the default
   *  context until it is explicitly initialised. */
  perTab: Record<string, Stage>;
  /** MULTI mode: one stage per pane, keyed by the pane id. */
  panes: Record<PaneId, Stage>;
}

export const initialStageState: StageState = {
  perTab: {},
  panes: { A: DEFAULT_STAGE, B: DEFAULT_STAGE },
};

export type StageAction =
  /** Set a stage. A `pane` id targets that pane's own (MULTI mode) stage; a
   *  `tabId` targets that tab's own (SINGLE mode) stage. An unknown stage
   *  value or pane id is refused. */
  | { type: 'set'; tabId?: string; pane?: PaneId; stage: Stage }
  /** Return a scope to the default stage (PAGES). A `pane` id resets that
   *  pane; a `tabId` drops that tab's stored stage (it reads the default
   *  again). */
  | { type: 'reset'; tabId?: string; pane?: PaneId };

/**
 * The stage in force for a scope. A `pane` id reads that pane's own stage
 * (MULTI mode); otherwise a `tabId` reads that tab's own stage (SINGLE mode),
 * falling back to the default for an unknown/unfilled tab. With neither, the
 * default stage is returned so a surface can never render nothing.
 */
export function stageForScope(
  state: StageState,
  tabId: string | null,
  pane: PaneId | null,
): Stage {
  if (pane !== null) {
    if (!isPaneId(pane)) return DEFAULT_STAGE;
    return state.panes[pane] ?? DEFAULT_STAGE;
  }
  if (tabId !== null) return state.perTab[tabId] ?? DEFAULT_STAGE;
  return DEFAULT_STAGE;
}

/**
 * Phase 37 (item 13) — the stage IS the Edit-mode switch: entering the
 * EDIT stage turns the canvas's edit mode ON, leaving it turns it OFF.
 * Pure so the mapping is unit-testable without mounting App; App applies
 * it in ONE effect keyed on the active stage (the single source of truth —
 * no second edit-mode toggle).
 */
export function editModeForStage(stage: Stage): boolean {
  return stage === 'edit';
}

/**
 * Phase 38 / DEF-342 — whether the stage effect must (re-)apply its side
 * effects. The stage's side effects must re-apply not only on a stage CHANGE
 * but whenever the stage becomes APPLICABLE again: closing the only tab
 * clears edit mode App-side while the rail keeps showing EDIT, so a document
 * ARRIVING (`prevDocId` null -> `docId` set) must re-apply them even though
 * the stage value never changed. Closing (`docId` -> null) does NOT re-apply:
 * the tab-close path already turns the stage's side effects off, and there is
 * no document surface to apply them to. Pure so the rule is unit-testable
 * without mounting App.
 */
export function stageEffectsNeedApply(args: {
  prevStage: Stage;
  prevDocId: string | null;
  stage: Stage;
  docId: string | null;
}): boolean {
  if (args.prevStage !== args.stage) return true;
  return args.docId !== null && args.docId !== args.prevDocId;
}

export function stageReducer(state: StageState, action: StageAction): StageState {
  switch (action.type) {
    case 'set': {
      if (!isStage(action.stage)) return state;
      if (action.pane !== undefined) {
        if (!isPaneId(action.pane)) return state;
        if (state.panes[action.pane] === action.stage) return state;
        return { ...state, panes: { ...state.panes, [action.pane]: action.stage } };
      }
      if (action.tabId !== undefined) {
        if (state.perTab[action.tabId] === action.stage) return state;
        return { ...state, perTab: { ...state.perTab, [action.tabId]: action.stage } };
      }
      return state;
    }
    case 'reset': {
      if (action.pane !== undefined) {
        if (!isPaneId(action.pane)) return state;
        if (state.panes[action.pane] === DEFAULT_STAGE) return state;
        return { ...state, panes: { ...state.panes, [action.pane]: DEFAULT_STAGE } };
      }
      if (action.tabId !== undefined) {
        if (!(action.tabId in state.perTab)) return state;
        const nextPerTab = { ...state.perTab };
        delete nextPerTab[action.tabId];
        return { ...state, perTab: nextPerTab };
      }
      return state;
    }
  }
}
