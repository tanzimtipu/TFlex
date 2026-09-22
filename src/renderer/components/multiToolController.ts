// Phase 33 (chunk 4) — ONE shared toolbar in Multi Mode.
//
// In Multi Mode the workspace shows a single toolbar (the same one single
// mode shows) instead of one per pane. This module is the small bridge that
// lets that single bar drive BOTH panes without lifting either pane's
// internals (so single mode stays byte-for-byte unchanged):
//
//   - `toolbar` entries: each pane's DocumentView publishes a read-only
//     "model" (page / zoom / search / hand values plus the matching command
//     callbacks) keyed by its pane. The shared bar reads the FOCUSED pane's
//     entry, so its display follows the pane the user is working in.
//   - `ann` sinks: each pane registers its annotation-tool reducer dispatch.
//     Every annotation action (from the shared bar OR from a pane's own
//     internal disarm) is broadcast to all registered panes, so arming and
//     disarming stay coherent across both.
//
// The controller is NOT a store: it holds no React state. Components
// subscribe to a plain revision signal and re-read the values they need.

import type {
  AnnotationToolAction,
  AnnotationToolState,
} from "../annotations/model";
import type { PaneId } from "../state/multiMode";
import type { ZoomMode } from "../state/zoom";

/** The values the shared bar displays for one pane. */
export interface PaneToolbarValues {
  page: number;
  pageCount: number;
  pageLabel: string | null;
  zoomPercent: number;
  zoomMode: ZoomMode;
  searchOpen: boolean;
  handActive: boolean;
}

/** The commands the shared bar runs against one pane. */
export interface PaneToolbarCommands {
  onJump: (input: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onToggleSearch: () => void;
  onHandToggle: () => void;
}

export interface PaneToolbarEntry {
  /** Reads the pane's LATEST toolbar values (a live ref, not a snapshot). */
  values: () => PaneToolbarValues | null;
  /** Reads the pane's command callbacks (a live ref). */
  commands: () => PaneToolbarCommands | null;
}

/** An annotation-tool reducer dispatch owned by one pane. */
export type AnnToolSink = (action: AnnotationToolAction) => void;

export class SharedToolController {
  private toolbars = new Map<PaneId, PaneToolbarEntry>();
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

  // ---- the shared bar's model -------------------------------------------

  registerToolbar(pane: PaneId, entry: PaneToolbarEntry): () => void {
    this.toolbars.set(pane, entry);
    this.emit();
    return (): void => {
      if (this.toolbars.get(pane) === entry) this.toolbars.delete(pane);
      this.emit();
    };
  }

  getToolbar(pane: PaneId): PaneToolbarEntry | undefined {
    return this.toolbars.get(pane);
  }

  /** A pane's own values/commands changed — let the bar re-read them. */
  notifyToolbar(): void {
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
   * from either the shared bar or a pane's internal disarm keeps BOTH panes
   * in lockstep.
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
   *  their shared wiring and no stale arm state may survive. */
  reset(): void {
    this.toolbars.clear();
    this.annSinks.clear();
    this.annState.clear();
    this.emit();
  }
}