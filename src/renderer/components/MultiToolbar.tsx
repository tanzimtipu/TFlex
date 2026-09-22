// Phase 33 (chunk 4) — the ONE shared toolbar for the Multi Mode workspace.
//
// The bar is the SAME `Toolbar` (CommandBar) + `EditToolbar` single mode
// renders, placed once in the stage above the two panes. It reads the
// FOCUSED pane's model from the `SharedToolController` and runs every page
// command against that pane; its annotation group arms BOTH panes through
// the controller's fan-out, so a tool picked here applies to whichever pane
// the user then works in. The per-pane rows are suppressed inside
// DocumentView while the controller is supplied.

import { useEffect, useReducer } from "react";
import type { ReactElement, ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Toolbar } from "./Toolbar";
import { AnnotationToolbar } from "../annotations/AnnotationToolbar";
import { EditToolbar, defaultEditHint } from "../edit/EditToolbar";
import { initialAnnotationToolState } from "../annotations/model";
import type { SharedToolController } from "./multiToolController";
import type { PaneId } from "../state/multiMode";
import type { AnnotationColors } from "../state/colorPalette";
import type { EditFont } from "../../shared/types";
import type { EditTool } from "../edit/model";

export interface MultiToolbarProps {
  controller: SharedToolController;
  /** The focused pane whose model drives the bar. */
  pane: PaneId;
  theme: "light" | "dark";
  annotationPalette?: AnnotationColors | null;
  onAnnotationPaletteChange?: (next: AnnotationColors) => void;
  annotationRecentTools?: string[];
  onAnnotationRecentToolsChange?: (ids: string[]) => void;
  // App-owned command-bar state / handlers (identical to the single-mode
  // DocumentView wiring; page ops route through the focused pane already).
  editModeOpen: boolean;
  onEditModeToggle: () => void;
  multiModeEnabled: boolean;
  onMultiModeToggle: () => void;
  signToolActive: boolean;
  onSignClick: () => void;
  hasFormFields: boolean;
  onFlattenClick: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onOptimize: () => void;
  onAuditSpace: () => void;
  onRotateClockwise?: () => void;
  onRotateCounterClockwise?: () => void;
  onDeletePage?: () => void;
  canDeletePage: boolean;
  // The Edit toolbar's tool is App-owned (per-pane tab state); selecting a
  // tool here broadcasts to BOTH pane tabs' edit reducers.
  editTool: EditTool;
  editDefaultFont: EditFont;
  onEditSelect: (tool: EditTool) => void;
  onEditDefaultFontChange: (font: EditFont) => void;
}

export function MultiToolbar(props: MultiToolbarProps): ReactElement {
  const { controller, pane, theme, editModeOpen } = props;
  // The controller holds no React state: re-read it on every revision bump
  // (a pane registered, published values, armed a tool, ...).
  const [, bump] = useReducer((n: number): number => n + 1, 0);
  useEffect((): (() => void) => controller.subscribe(bump), [controller]);

  const entry = controller.getToolbar(pane);
  const values = entry?.values() ?? null;
  const commands = entry?.commands() ?? null;
  const annState = controller.getAnn(pane) ?? initialAnnotationToolState;

  const annotationTools: ReactNode = (
    <AnnotationToolbar
      state={annState}
      onAction={(action): void => controller.annToolAction(action)}
      editModeOpen={editModeOpen}
      handModeOpen={values?.handActive ?? false}
      palette={
        props.annotationPalette === undefined || props.annotationPalette === null
          ? undefined
          : {
              light: props.annotationPalette.light ?? [],
              dark: props.annotationPalette.dark ?? [],
            }
      }
      onPaletteChange={
        props.onAnnotationPaletteChange === undefined
          ? undefined
          : (next): void => props.onAnnotationPaletteChange?.(next)
      }
      theme={theme}
      annotationRecentTools={props.annotationRecentTools}
      onAnnotationRecentToolsChange={props.onAnnotationRecentToolsChange}
    />
  );

  return (
    <div className="multi-toolbar" data-multi-toolbar>
      <Toolbar
        page={values?.page ?? 1}
        pageCount={values?.pageCount ?? 0}
        pageLabel={values?.pageLabel ?? null}
        zoomPercent={values?.zoomPercent ?? 100}
        zoomMode={values?.zoomMode ?? "fit-width"}
        onJump={(input): void => commands?.onJump(input)}
        onZoomIn={(): void => commands?.onZoomIn()}
        onZoomOut={(): void => commands?.onZoomOut()}
        onFitWidth={(): void => commands?.onFitWidth()}
        onFitPage={(): void => commands?.onFitPage()}
        searchOpen={values?.searchOpen ?? false}
        onToggleSearch={(): void => commands?.onToggleSearch()}
        onMerge={props.onMerge}
        onSplit={props.onSplit}
        signToolActive={props.signToolActive}
        onSignClick={props.onSignClick}
        hasFormFields={props.hasFormFields}
        onFlattenClick={props.onFlattenClick}
        editModeOpen={editModeOpen}
        onEditModeToggle={props.onEditModeToggle}
        onOptimize={props.onOptimize}
        onAuditSpace={props.onAuditSpace}
        onRotateClockwise={props.onRotateClockwise}
        onRotateCounterClockwise={props.onRotateCounterClockwise}
        handActive={values?.handActive ?? false}
        onHandToggle={(): void => commands?.onHandToggle()}
        onDeletePage={props.onDeletePage}
        canDeletePage={props.canDeletePage}
        multiModeEnabled={props.multiModeEnabled}
        onMultiModeToggle={props.onMultiModeToggle}
        annotationTools={annotationTools}
      />
      <AnimatePresence>
        {editModeOpen && (
          <EditToolbar
            tool={props.editTool}
            onSelect={props.onEditSelect}
            defaultFont={props.editDefaultFont}
            onDefaultFontChange={props.onEditDefaultFontChange}
            enabled
            hint={defaultEditHint(props.editTool)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}