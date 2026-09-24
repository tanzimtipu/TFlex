// Phase 36 (chunk 7) — the ONE shared Action Dock for Multi Mode.
//
// Phase 33's decision, kept by Phase 36: the Multi Mode workspace shows ONE
// dock for the whole workspace, at its bottom-centre, instead of one per pane.
// The pane whose document is FOCUSED decides what it shows — the focused
// pane's stage drives the verb set (`activeStage` is the App's focused-pane
// stage) and the focused pane's own published context drives the selection
// override, the availability gates and the idle suppression.
//
// The component subscribes to the `SharedToolController` (a plain revision
// signal, no React state in the controller) and re-reads the focused pane's
// context on every emit, so a pane's selection / arming change reaches the
// dock without the dock owning any of it. When the focused pane has published
// nothing yet (an empty pane) it renders NOTHING rather than a dock whose
// verbs would be silent no-ops.

import { useEffect, useLayoutEffect, useReducer } from "react";
import type { ReactElement } from "react";
import { ActionDock } from "./ActionDock";
import type { SharedToolController } from "./multiToolController";
import type { PaneId } from "../state/multiMode";
import type { Stage } from "../state/stages";

export interface MultiActionDockProps {
  controller: SharedToolController;
  /** The FOCUSED pane whose stage + context drive the dock. */
  pane: PaneId;
  /** The FOCUSED pane's stage (App owns the per-pane stage model). */
  activeStage: Stage;
  /** Registry tool ids pinned to the dock (App's validated settings field). */
  dockPins: readonly string[];
  onPinTool: (id: string) => void;
  onUnpinTool: (id: string) => void;
  /** Run a verb. App routes it to the focused pane's view-level command or to
   *  its own app-level handler — the dock never re-implements one. */
  onRunTool: (id: string) => void;
  /** Per-tool run counts — the compact overflow ranks by usage. */
  toolUsage?: Readonly<Record<string, number>>;
  /** Verb ids whose tool is currently ON (the `editMode` toggle). */
  activeToolIds?: readonly string[];
  /** State 4 reporter: App shares the idle flip with the panes' pills. */
  onIdleChange?: (idle: boolean) => void;
}

export function MultiActionDock(props: MultiActionDockProps): ReactElement | null {
  const { controller, pane } = props;
  // The controller holds no React state: re-read the pane's context on every
  // revision bump (a pane registered, changed its selection, armed a tool).
  const [, bump] = useReducer((n: number): number => n + 1, 0);
  useEffect((): (() => void) => controller.subscribe(bump), [controller]);
  // The panes register their context in the SAME commit that mounts this dock
  // (their effects run first — they are earlier siblings in the stage), so the
  // first read can miss. One pre-paint re-read picks the registration up in the
  // same frame, and it is harmless when the context is already there.
  useLayoutEffect((): void => {
    bump();
  }, []);

  const dock = controller.getDock(pane);
  if (dock === null) return null;

  return (
    <ActionDock
      activeStage={props.activeStage}
      pageSelection={dock.pageSelection}
      onClearPageSelection={dock.clearPageSelection}
      bulk={dock.bulk}
      dockPins={props.dockPins}
      onPinTool={props.onPinTool}
      onUnpinTool={props.onUnpinTool}
      onRunTool={props.onRunTool}
      isToolEnabled={dock.isToolEnabled}
      disabledReasonFor={dock.disabledReasonFor}
      toolArmed={dock.toolArmed}
      dragInProgress={dock.dragInProgress}
      toolUsage={props.toolUsage}
      activeToolIds={props.activeToolIds}
      onIdleChange={props.onIdleChange}
    />
  );
}
