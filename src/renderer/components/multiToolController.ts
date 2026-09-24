// Phase 33 (chunk 4) + Phase 36 (chunk 7) — the Multi Mode workspace bridge.
//
// In Multi Mode ONE shared surface serves the whole workspace (Phase 33's
// decision, kept by Phase 36): a single Action Dock at the workspace's
// bottom-centre showing the FOCUSED pane's stage verbs. The panes publish the
// context that surface needs instead of each rendering its own copy, so no
// pane's internals are lifted and single mode stays untouched:
//
//   - `dock` entries: each pane's DocumentView publishes a live read-only
//     context (its page selection, the State-2 bulk verbs, the live
//     availability gate and its armed / dragging flags) keyed by pane. The
//     shared dock reads the FOCUSED pane's entry, so its display AND its
//     availability follow the pane the user is working in.
//   - `ann` sinks: each pane registers its annotation-tool reducer dispatch.
//     Every annotation action (from the shared dock / the REVIEW flyout OR
//     from a pane's own internal disarm) is broadcast to all registered
//     panes, so arming and disarming stay coherent across both.
//
// Phase 36 (chunk 7) RETIRED the shared toolbar ROW (`MultiToolbar`): the
// pane's page / zoom / search / hand model is no longer published here — the
// floating pills read that from the pane's own view state, and the dock's
// view-level verbs route through `registerViewCommands` (App's
// `focusedViewCommands`).
//
// The controller is NOT a store: it holds no React state. Components
// subscribe to a plain revision signal and re-read the values they need.

import type {
  AnnotationToolAction,
  AnnotationToolState,
} from "../annotations/model";
import type { PaneId } from "../state/multiMode";
import type { ToolEntry } from "../state/toolsRegistry";
import type { DockBulkActions } from "./ActionDock";

/** The pane context the ONE shared Action Dock consumes for one pane. */
export interface PaneDockContext {
  /** The visible 1-based pages selected in THIS pane's PAGES panel. */
  pageSelection: readonly number[];
  /** State 2's Clear — empties this pane's selection (back to State 1). */
  clearPageSelection: () => void;
  /** State 2's bulk verbs, wired to this pane's existing engine/dialog paths. */
  bulk: DockBulkActions;
  /** This pane's live availability gate (it owns the selection + edit mode). */
  isToolEnabled: (entry: ToolEntry) => boolean;
  /** This pane's live disabled-reason copy (DEF-311). */
  disabledReasonFor: (entry: ToolEntry) => string | undefined;
  /** Idle suppression: a tool is armed in this pane. */
  toolArmed: boolean;
  /** Idle suppression: a page drag is in progress in this pane. */
  dragInProgress: boolean;
}

export interface PaneDockEntry {
  /** Reads the pane's LATEST dock context (a live ref, not a snapshot). */
  dock: () => PaneDockContext | null;
}

/** An annotation-tool reducer dispatch owned by one pane. */
export type AnnToolSink = (action: AnnotationToolAction) => void;

export class SharedToolController {
  private panes = new Map<PaneId, PaneDockEntry>();
  private annSinks = new Map<PaneId, AnnToolSink>();
  private annState = new Map<PaneId, AnnotationToolState>();
  private listeners = new Set<() => void>();

  /** Subscribe to "something changed, re-read it" signals. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  // ---- the shared dock's per-pane context -------------------------------

  registerPane(pane: PaneId, entry: PaneDockEntry): () => void {
    this.panes.set(pane, entry);
    this.emit();
    return (): void => {
      if (this.panes.get(pane) === entry) this.panes.delete(pane);
      this.emit();
    };
  }

  /** The pane's current dock context, or `null` before it registers (the
   *  shared dock renders nothing rather than a dock with no verbs). */
  getDock(pane: PaneId): PaneDockContext | null {
    return this.panes.get(pane)?.dock() ?? null;
  }

  /** A pane's own context changed — let the shared dock re-read it. */
  notifyPane(): void {
    this.emit();
  }

  // ---- the shared annotation arm state ----------------------------------

  registerAnnSink(pane: PaneId, sink: AnnToolSink): () => void {
    this.annSinks.set(pane, sink);
    return (): void => {
      if (this.annSinks.get(pane) === sink) this.annSinks.delete(pane);
      this.annState.delete(pane);
      this.emit();
    };
  }

  /**
   * Fan an annotation action out to every registered pane. `self` (the pane
   * whose own reducer originated the action) is invoked once, directly; the
   * remaining panes receive it through their registered sinks, so an action
   * from either the shared dock / flyout or a pane's internal disarm keeps
   * BOTH panes in lockstep.
   */
  annToolAction(action: AnnotationToolAction, self?: AnnToolSink): void {
    if (self !== undefined) self(action);
    for (const sink of this.annSinks.values()) {
      if (sink !== self) sink(action);
    }
  }

  /** A pane published its current annotation-tool state (its reducer echo). */
  publishAnn(pane: PaneId, state: AnnotationToolState): void {
    this.annState.set(pane, state);
    this.emit();
  }

  /** The FOCUSED pane's armed tool state, with a stable fallback for the
   *  brief window before a pane has published. */
  getAnn(pane: PaneId): AnnotationToolState | null {
    const own = this.annState.get(pane);
    if (own !== undefined) return own;
    for (const state of this.annState.values()) return state;
    return null;
  }

  /** Drop every registration — the mode was left, so the panes unmounted
   *  their shared wiring and no stale context may survive. */
  reset(): void {
    this.panes.clear();
    this.annSinks.clear();
    this.annState.clear();
    this.emit();
  }
}
