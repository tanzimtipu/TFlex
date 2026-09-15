import { createRef, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { AnimatePresence } from "motion/react";
import type {
  AppSettings,
  DocxImageEntry,
  EditFont,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormField,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OptimizePreset,
  PageLabelEntry,
  PdfOpenError,
  RecentFile,
  SampleDocument,
  SavedSignature,
  SignaturePlacement,
  SpaceAudit,
  StampId,
  UpdateState,
} from "../shared/types";
import type { TFlexApi } from "../shared/ipc";
import { Welcome } from "./components/Welcome";
import { AppHeader } from "./components/AppHeader";
import { Toasts, type Toast } from "./components/Toasts";
import { TitleBar, type MenuGroup } from "./components/TitleBar";
import { ToolsPalette } from "./components/ToolsPalette";
import { UnifiedToolbar, type ToolbarTab } from "./components/UnifiedToolbar";
import { AboutDialog } from "./components/AboutDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { UpdateIndicator } from "./components/UpdateIndicator";
import { UpdatePromptDialog } from "./components/UpdatePromptDialog";
import {
  decideUpdatePromptOpen,
  isUpdatePromptActionable,
  updateActionableKey,
} from "./components/updatePromptMachine";
import { tabsReducer, initialTabsState, resolveOpenId, type TabMeta } from "./state/tabs";
import { pagesPanelReducer, initialPagesPanelState } from "./state/pagesPanel";
import { nextTheme, resolveThemeDefault } from "./state/theme";
import { useThemeTransition } from "./hooks/useAnimations";
import { createAmbientController } from "./state/ambient";
import { resolveInitialSettings, settingsRecoveryNotice } from "./state/settings";
import {
  DEFAULT_OPTIMIZE_PRESET,
  DEFAULT_RECENTS_CAP,
  DEFAULT_CREATE_IMAGE_QUALITY,
  DEFAULT_EXPORT_IMAGE_DPI,
  DEFAULT_EXPORT_IMAGE_FORMAT,
  DEFAULT_OCR_DOWNSAMPLE,
  DEFAULT_OCR_LANGUAGE,
  DEFAULT_STAMP_ID,
  clampOcrDownsample,
  preferencesReducer,
  type ThemeDefault,
} from "./state/preferences";
import {
  dispatchMenuAction,
  gateOnActiveDoc,
  snapshotMenuEnabled,
  type MenuActionContext,
} from "./state/menuActions";
import { shouldApplyEcho } from "./state/settingsEcho";
import { openPdfDocument, readOutline, type OutlineNode } from "./pdf/pdfjs";
import {
  DocumentView,
  type DocDiagnostics,
  type DocumentViewHandle,
  type PersistedViewer,
  type SearchIndexProgress,
} from "./components/DocumentView";
import { splitRecentPath } from "./utils/recentPath";
import { toArrayBuffer } from "./utils/toArrayBuffer";
import { createDebouncer } from "./utils/debounce";
import { formatBytes as formatBytesForToast } from "./utils/formatBytes";
import { downloadBlob } from "./utils/exportDownload";
import { removeRecent } from "./state/recentFiles";
import { getEngine } from "./engine/engineClient";
import { MergeDialog } from "./components/MergeDialog";
import { SplitDialog } from "./components/SplitDialog";
import { OptimizeDialog } from "./components/OptimizeDialog";
import { AuditSpaceDialog } from "./components/AuditSpaceDialog";
import { SaveAsDialog } from "./components/SaveAsDialog";
import { CreateFromImagesDialog } from "./components/CreateFromImagesDialog";
import { ExportDialog } from "./components/ExportDialog";
import { TextExportDialog } from "./components/TextExportDialog";
import { DocxExportDialog } from "./components/DocxExportDialog";
import { InsertPagesDialog } from "./components/InsertPagesDialog";
import { ReplacePagesDialog } from "./components/ReplacePagesDialog";
import { RenumberPagesDialog } from "./components/RenumberPagesDialog";
import { CropPagesDialog } from "./components/CropPagesDialog";
import { StampDialog } from "./components/StampDialog";
import { CommentExportDialog } from "./components/CommentExportDialog";
import { CommentImportDialog } from "./components/CommentImportDialog";
import { DeletePageDialog } from "./components/DeletePageDialog";
import { CloseTabPromptDialog, type CloseTabPromptChoice } from "./components/CloseTabPromptDialog";
import { SignatureManagerModal } from "./signatures/SignatureManagerModal";
import { FlattenConfirmDialog } from "./forms/FlattenConfirmDialog";
import {
  OcrDialog,
  type OcrDialogConfirm,
  type OcrScope,
} from "./components/OcrDialog";
import { OcrSuspectsPanel } from "./components/OcrSuspectsPanel";
import { rasterizePagesForOcr } from "./pdf/ocrRasterize";
import type { EngineApi, EngineOp, EngineState } from "./engine/types";
import type { PlacedStamp } from "./annotations/StampAnnotations";
import {
  WHITE_1X1_PNG_BYTES,
  rasterizeStamp,
} from "./annotations/stampOps";
import type { Annotation, AnnotationPatch } from "./annotations/model";
import {
  MAX_ANNOTATIONS_PER_PAGE,
  firstPageOverAnnotationLimit,
} from "./annotations/model";
import { describeEngineError } from "./engine/types";
import { stubRendererEngine } from "./engine/stubEngine";
import {
  editReducer,
  engineTextBoxesToPlacements,
  initialEditState,
  sameTextBoxes,
  type EditAction,
  type EditState,
  type EditTextStyle,
} from "./edit/model";
import {
  defaultImageDecoder,
  defaultImageEncoder,
  resizeImageToBytes,
  cropImageToBytes,
  rasterizeTextBoxToPng,
  detectImageFormat,
} from "./edit/rasterize";
import {
  ZERO_COUNTERS,
  countersAfterApply,
  countersAfterRedo,
  countersAfterSave,
  countersAfterUndo,
  flagsFromCounters,
  type UndoCounters,
} from "./state/undoCounters";
import {
  initialFormsState,
  replaceFields,
  sameFormFields,
  setFieldValue,
  toggleListboxValue,
  type FormsState,
} from "./forms/model";
import { getSignatureService } from "./signatures/service";
import { rasterizeSavedSignatureToPng } from "./signatures/canvas";
import {
  diagnosticsPublishAllowed,
  resolveEngineStateForDiagnostics,
} from "./diagnostics/resolve";

/** Phase 7 — settings persist policy.
 *
 * Every settings write the renderer issues goes through the main
 * process synchronously, not through the previous 300ms debouncer.
 * The debounce was the root cause of DEF-044 (settings overwrite
 * race on app quit): when the user toggled the theme and closed
 * the window inside the debounce window, the pending write never
 * reached main; main's `saveCurrent()` then persisted its stale
 * in-memory state to disk, clobbering the change.
 *
 * Immediate persistence makes that race irrelevant — the IPC call
 * for the latest local state is in-flight (or already resolved)
 * before the window can close. `void window.tflex.saveSettings(s)`
 * fires the IPC immediately, bumps the echo-filter seq, and
 * snapshots the object that went out so the echo filter can drop
 * stale echoes from earlier writes.
 *
 * The renderer used to coalesce rapid theme toggles into one write
 * to avoid a settings.json rename per click. In practice every
 * click already produced an echo that the echo filter accepted
 * once the seq was bumped; the savings were negligible and the
 * latency risk was real. The toggle path is immediate now too. */

declare global {
  interface Window {
    tflex: TFlexApi;
  }
  // QA hook: snapshot of the renderer's view of state.
  function tflexDiagnostics(): unknown;
}

interface DocSession {
  doc: import("pdfjs-dist").PDFDocumentProxy;
  outline: OutlineNode[] | null;
  /** The original PDF's byte length. Held only for the diagnostics
   *  surface (`tflexDiagnostics().activeDocBytes`); the bytes themselves
   *  are dropped as soon as the document is open + parsed, freeing
   *  ~5-10MB of ArrayBuffer on long.pdf idle (DEF-016). pdf.js keeps
   *  its own internal copy of the parsed stream. */
  fileSize: number;
  /** The docId registered with the engine. Stable across the tab's life. */
  engineDocId: string;
  /** On-disk path, or null for samples. Save-As is the only option when
   *  this is null. */
  onDiskPath: string | null;
  /** DEF-139 — whether the current pdf.js `doc` proxy was rebuilt from
   *  `engine.getDocumentBytes` bytes (whose file pages are serialized in
   *  the engine's VISIBLE order) rather than being the ORIGINAL open
   *  bytes (identity file order). Starts false at open; flips to true
   *  once `refreshDocProxyFor` swaps a re-serialized proxy in. Drives
   *  the renderer's visible-slot -> proxy-page mapping in DocumentView
   *  and the thumbnail rail. */
  proxyVisibleOrder: boolean;
}

interface OpenTab {
  meta: TabMeta;
  session: DocSession;
  persisted: PersistedViewer;
  displayName: string;
  engine: EngineState;
  /** Phase 4 — local mirror of the active tab's form fields. The host
   *  seeds this from `engine.getFormFields` on tab open and patches it
   *  optimistically on every edit; the engine echoes back the canonical
   *  list and we resync. The 500ms debounce on text fields means we get
   *  at most one round-trip per quiet window. */
  forms: FormsState;
  /** Phase 4 — local mirror of the active tab's signature placements. */
  placements: SignaturePlacement[];
  /** Phase 10 — Edit-content state (per tab). The Edit overlay lives
   *  per page; this state is the source of truth for the active tool,
   *  the current image-placement list, the selection, and the
   *  in-progress crop. Reset to `initialEditState` on tab close. */
  edit: EditState;
}

interface AppErrorState {
  toasts: Toast[];
  nextId: number;
}

type ErrorAction =
  | { type: "push"; toast: Omit<Toast, "id"> }
  | { type: "dismiss"; id: number };

function errorReducer(state: AppErrorState, action: ErrorAction): AppErrorState {
  switch (action.type) {
    case "push": {
      const id = state.nextId;
      return { toasts: [...state.toasts, { id, ...action.toast }], nextId: id + 1 };
    }
    case "dismiss": {
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    }
  }
}

interface Bootstrap {
  settings: AppSettings;
  recovered: boolean;
}

async function bootSettings(): Promise<Bootstrap> {
  const result = await window.tflex.loadSettings();
  const resolved = resolveInitialSettings(result);
  if (resolved.recovered) {
    void window.tflex.saveSettings(resolved.settings);
  }
  return resolved;
}

/** Engine state augmented with locally-tracked undo / redo counters. The
 *  real engine's `EngineState` doesn't expose stack depths, so we mirror
 *  the engine's undo and redo stacks on the renderer side: every
 *  successful engine IPC call updates the counters (see
 *  `./state/undoCounters.ts`). The `canUndo` / `canRedo` flags the UI
 *  reads are derived from the counters, never hardcoded. */
interface EngineUiState {
  state: EngineState;
  canUndo: boolean;
  canRedo: boolean;
  /** Mirrors the engine's undo / redo stack depths. */
  counters: UndoCounters;
}

const initialUiState = (pageCount: number): EngineUiState => {
  const counters = ZERO_COUNTERS;
  const flags = flagsFromCounters(counters);
  return {
    state: {
      pageCount,
      modified: false,
      pageOrder: Array.from({ length: pageCount }, (_, i) => i),
      rotations: Array.from({ length: pageCount }, () => 0),
      deleted: Array.from({ length: pageCount }, () => false),
      annotations: [],
    },
    counters,
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
  };
};

/** DEF-137 renderer half — build a tab's seeded EngineUiState from the
 *  engine's authoritative post-load state. The engine parses
 *  annotations, rotations, text boxes, form fields and page labels
 *  into its doc state during loadDocument / loadDocumentBytes, so the
 *  tab-open flow calls `getState` right after a successful load and
 *  passes the result here: a reopened saved file renders the saved
 *  content (annotations, rotations, boxes, fields, labels) instead of
 *  an empty fresh document — the old path seeded `initialUiState`
 *  (empty annotations, zero rotations) and never asked the engine
 *  again, so everything the engine had loaded was invisible until the
 *  first UI op forced a getState round-trip (DEF-138 renderer half).
 *
 *  A fresh open carries an empty undo/redo stack, so the counters
 *  start at zero regardless of what the engine reports. `null`
 *  (getState failed, or an older backend) falls back to the same
 *  empty initial state the tab used before — the sync is best-effort
 *  and must never break the open.
 *
 *  Exported for the renderer unit tests (bugDEF137...); the product
 *  code paths only ever call it from `openFromBytes`. */
export function seededEngineUiState(
  hydrated: EngineState | null,
  pageCount: number,
): EngineUiState {
  if (hydrated !== null) {
    return {
      state: hydrated,
      counters: ZERO_COUNTERS,
      canUndo: false,
      canRedo: false,
    };
  }
  return initialUiState(pageCount);
}

/** DEF-166 — empty live-overlay annotation id set. Used by
 *  `liveAnnTextIdsFor` when a tab has never created/edited an
 *  annotation (a reopened saved file: every parsed annotation is
 *  painted by the page canvas, so the overlay text for all of them
 *  is suppressed). */
const EMPTY_ANN_TEXT_IDS: ReadonlySet<string> = new Set();

export function App(): ReactElement {
  const [bootDone, setBootDone] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Phase 16 — the side-rail pages panel can be collapsed to the ruler
  // strip. App owns the value through the pagesPanelReducer (persisted
  // in settings so it survives a restart); the rail itself never owns
  // the state (see SideRail props).
  const [pagesPanel, dispatchPagesPanel] = useReducer(
    pagesPanelReducer,
    initialPagesPanelState,
  );
  const pagesPanelCollapsed = pagesPanel.collapsed;
  const [tabs, dispatchTabs] = useReducer(tabsReducer, initialTabsState);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenTab>>({});
  const [errorState, dispatchError] = useReducer(errorReducer, { toasts: [], nextId: 1 });
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});
  const [sampleCount, setSampleCount] = useState(0);
  // Per-tab UI state (engine state + undo/redo flags). Kept separate from
  // openTabs so the engine state can be updated without churning the rest
  // of the tab record.
  const [engineUi, setEngineUi] = useState<Record<string, EngineUiState>>({});
  // Dialog state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // Phase 4 — signature manager modal + flatten confirm
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [flattenOpen, setFlattenOpen] = useState(false);
  // Phase 8 — Optimize + Audit Space dialogs. Optimistic state: the
  // dialogs themselves drive the engine IPC; the dialog result is
  // routed back into `openFromBytes` (optimize) or rendered directly
  // (audit, which is read-only).
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  // DEF-040 — renderer-side Save-As modal. The backend's engineSaveAs
  // IPC pops the OS dialog directly and can't accept extra options;
  // we surface our own modal first so the "Fast web view (linearize)"
  // checkbox can write through the optimizePreset persist path
  // before the OS save dialog opens.
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  // Phase 9 — Create-from-images + Export-Pages dialogs. The Create
  // dialog is reachable from the welcome screen (no doc required);
  // the Export dialog requires an active document. The dialogs own
  // their engine IPC; the host routes the result back into
  // `openFromBytes` (create) or per-page save (export).
  const [createOpen, setCreateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Phase 9 advanced — text export (TXT / RTF), DOCX export, and
  // insert-pages (blank / from another PDF). Each opens a modal; the
  // dialogs own their own engine IPC. Insert-from-PDF also surfaces a
  // host-side OS file picker for the "other" file.
  const [textExportOpen, setTextExportOpen] = useState(false);
  const [docxExportOpen, setDocxExportOpen] = useState(false);
  const [insertPagesOpen, setInsertPagesOpen] = useState(false);
  // Phase 12 — residual page-organize + annotate parity. Each
  // dialog drives its own engine IPC; the host routes the result
  // back into `noteOpApplied` so the pageCount / pageOrder
  // mirror refreshes. Comment export/import also surface host-
  // side OS file pickers for the .fdf file.
  const [replacePagesOpen, setReplacePagesOpen] = useState(false);
  const [renumberPagesOpen, setRenumberPagesOpen] = useState(false);
  const [cropPagesOpen, setCropPagesOpen] = useState(false);
  const [stampOpen, setStampOpen] = useState(false);
  const [commentExportOpen, setCommentExportOpen] = useState(false);
  const [commentImportOpen, setCommentImportOpen] = useState(false);
  // B8 — delete pages dialog. The toolbar's Delete control opens
  // this dialog; the rail's per-thumb delete still flows through
  // the existing onDelete callback directly (no dialog) so a
  // single-thumb click is unaffected.
  const [deletePageOpen, setDeletePageOpen] = useState(false);
  // B8 — close-tab prompt. The dialog surfaces when the user
  // tries to close a tab with unsaved engine changes. The
  // host tracks which tab id is pending the close and what
  // state the save flow is in (idle / saving / error) so the
  // dialog can disable Save while the IPC is in flight and
  // surface the engine's error message verbatim when it
  // returns. `pendingCloseTabId` is null when no close is
  // pending (the dialog is closed).
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [pendingCloseSaving, setPendingCloseSaving] = useState<boolean>(false);
  const [pendingCloseError, setPendingCloseError] = useState<string | null>(null);
  // DEF-142 — whole-window close-request queue. When main pushes
  // `window:closeRequested` (window X / Alt+F4 / Window menu Close /
  // Exit -> app.quit), the renderer snapshots every modified tab id
  // into this queue and walks it through the CloseTabPromptDialog one
  // tab at a time (reusing `onCloseTabPromptChoose`, whose DEF-128
  // branch routes path-less tabs through Save-As). Non-null only while
  // a window-close flow is in progress; a plain per-tab close
  // (`closeTab`) leaves it null. The queue empties -> `confirmClose(true)`;
  // a Cancel -> `setWindowCloseQueue(null)` with no confirmClose, so
  // the window stays open.
  const [windowCloseQueue, setWindowCloseQueue] = useState<string[] | null>(null);
  /** Per-page sizes (PDF points, top-left origin) for the active
   *  doc. The Crop dialog reads this map to draw per-page
   *  previews. The host seeds it lazily when the dialog opens so
   *  the per-page pdf.js viewport query doesn't run on every doc
   *  open. */
  const [activePageSizes, setActivePageSizes] = useState<
    Record<number, { widthPt: number; heightPt: number }>
  >({});
  // Phase 6 — Tools palette state, About dialog, Preferences dialog.
  // Phase 6 — Tools palette state, About dialog, Preferences dialog.
  // Layout persists via settings.toolsPaletteLayout; open/close is
  // session-only. The toolbar's Tools button toggles the palette and
  // Ctrl+Shift+P from the menu does the same.
  const [toolsPaletteOpen, setToolsPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // OTA UX — the update prompt. Opens automatically when the
  // backend pushes an `available` (Update to X.Y.Z available) or
  // `downloaded` (Restart to update) UpdateState over
  // `tflex.update.onStatusChanged`. Also opens on demand via the
  // Help -> Check for Update menu action and the About dialog's
  // "Check for Updates" button. The toolbar UpdateIndicator
  // continues to render its own affordance independently — the
  // prompt is the *notification*, the indicator is the *always-
  // visible affordance*. Both can coexist; dismissing the prompt
  // does NOT dismiss the indicator (the user can re-open the
  // prompt by clicking the indicator chip, which still routes
  // through the IPC handlers).
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  /** Live UpdateState mirror — feeds both the toolbar indicator
   *  (via UpdateIndicator's own subscription, refactored to read
   *  through this prop) and the prompt dialog. Hoisted here so
   *  the same subscription serves both surfaces and we never
   *  double-subscribe to onStatusChanged. */
  const [updateState, setUpdateState] = useState<UpdateState | null | undefined>(undefined);
  // Bug 9 — OTA UX. True from the moment the user clicks Update
  // until the download reaches a terminal state. Guards the
  // auto-open effect below so a stale `available` push can't re-arm
  // the "Update" prompt while a download runs in the background
  // (the toolbar indicator shows the progress instead).
  const [updateDownloadInFlight, setUpdateDownloadInFlight] = useState(false);
  /** Bug 9 — key of the last actionable update state the user
   *  dismissed (Cancel / Later / X / backdrop). Keeps a dismissed
   *  prompt dismissed for the SAME state (the toolbar chip remains
   *  the always-on affordance); a *different* state (available ->
   *  downloaded) still opens a fresh prompt. */
  const [updateDismissedKey, setUpdateDismissedKey] = useState<string | null>(null);
  // Phase 10 — Edit-content mode. The toolbar shows the Edit
  // button; clicking it (or pressing the menu shortcut) toggles
  // this. When on, the per-page EditOverlay becomes pointer-active
  // and the EditToolbar appears above the document area. The
  // active tool / selection / placements list is per-tab and
  // lives on `openTabs[id].edit`.
  const [editModeOpen, setEditModeOpen] = useState(false);
  // Unified toolbar (ribbon) — App-level state. The ribbon is
  // mounted in App (above the tab stage, not per tab), so the
  // active section tab and the armed Edit tool must live here to
  // survive tab switches and re-renders. `activeEditMode` is the
  // data-tool id the Edit tab's grid has armed (null = none); the
  // per-page edit tool actions that consume it land in a later
  // chunk. Reset alongside the other App-level tool arms on tab
  // close / switch / new tab (see the B7 / B10 resets below).
  const [activeToolbarTab, setActiveToolbarTab] = useState<ToolbarTab>("annotate");
  const [activeEditMode, setActiveEditMode] = useState<string | null>(null);
  // Phase 11 — OCR dialog. The dialog drives its own engine call;
  // the host routes the result back into a refresh of the active
  // tab's engine state. The suspects panel is a side-rail overlay
  // that pops up after a successful OCR run so the user can browse
  // low-confidence words without leaving the document.
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrSuspectsOpen, setOcrSuspectsOpen] = useState(false);
  /** Per-tab OCR suspect list. The engine.ocrSuspects call returns
   *  a fresh list each time; we cache it on the active tab so the
   *  panel renders synchronously after the first load. Empty array
   *  means "no suspects from the most recent run" — the panel
   *  distinguishes that from "no run yet" via the matching
   *  `hasOcrRun` flag. */
  const [ocrSuspectsByTab, setOcrSuspectsByTab] = useState<Record<string, OcrSuspect[]>>({});
  /** Per-tab "an OCR run has completed on this doc" flag. */
  const [ocrRunByTab, setOcrRunByTab] = useState<Record<string, boolean>>({});
  // Saved signatures (renderer mirror). The signature service is the
  // source of truth; we cache the list locally so the modal renders
  // synchronously after the first load.
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  // The id of the signature the user armed for placement (Sign tool).
  // While non-null, the next click on a page places it there. The
  // toolbar's Sign button toggles between this and "open the manager".
  const [armedSignatureId, setArmedSignatureId] = useState<string | null>(null);
  // B10 — armed stamp. While non-null, the next click on a page
  // embeds the renderer-drawn stamp raster at the click point. The
  // ghost overlay (rendered by PageView when this is set) follows
  // the cursor while the user mouses over the page so they can
  // see exactly where the stamp will land. The shape matches
  // `armedSignatureId` so the existing per-tab-override plumbing
  // (PageView re-renders only when its prop identity changes) needs
  // no special handling.
  const [armedStamp, setArmedStamp] = useState<{
    stampId: StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
  } | null>(null);
  /** B10 / DEF-101 — per-tab record of successfully placed stamps.
   *  The engine bakes the stamp into the page bitmap; this mirror
   *  list drives the `.stamp-annotation` DOM surfaces so a placement
   *  is visible/verifiable in the renderer. Each entry is appended
   *  on `addStamp` success and pruned on tab close. */
  const [placedStampsByTab, setPlacedStampsByTab] = useState<
    Record<string, PlacedStamp[]>
  >({});
  // Bug 6 — synchronous mirror ref for the placed-stamp handlers
  // (onMoveStamp / onDeleteStamp / onRetypeStamp). The handlers are
  // stable useCallbacks; they read the freshest mirror through this
  // ref instead of taking the state as a dependency (the same
  // forward-declared-ref pattern as `armedStampRef` above).
  const placedStampsByTabRef = useRef(placedStampsByTab);
  placedStampsByTabRef.current = placedStampsByTab;
  // Page the user last clicked while the Sign tool was armed. We use
  // this to scroll-to-page in the placement flow so the click target is
  // visible (DocumentView's overlay catches the pointerdown and places
  // the signature in place without further page-change logic).

  const engineRef = useRef<EngineApi>(getEngine());

  // DEF-166 — per-tab set of annotation ids whose overlay text must be
  // drawn LIVE by the DOM overlay (created / edited since the tab's
  // current pdf.js bytes were loaded). Starts empty on every tab open:
  // each annotation parsed from the loaded file's /Annots is already
  // painted into the page canvas by pdf.js (it generates the FreeText
  // appearance from /Contents + /DA), so the overlay text for those ids
  // is suppressed — otherwise a reopened saved file renders the text
  // doubled (baked canvas glyphs + DOM overlay text, offset). A create /
  // edit adds its id (the canvas doesn't have that content yet); a
  // `refreshDocProxyFor` rebuild clears the set because the fresh bytes
  // contain every current annotation. A ref (not state) so the overlay
  // reads the current value during the re-render the annotation echo
  // already triggers, with no extra render churn.
  const liveAnnTextIdsRef = useRef<Map<string, Set<string>>>(new Map());
  /** Mark an annotation id as live-overlay (create / edit). */
  const markAnnTextLive = useCallback((tabId: string, id: string): void => {
    const m = liveAnnTextIdsRef.current;
    let s = m.get(tabId);
    if (s === undefined) {
      s = new Set<string>();
      m.set(tabId, s);
    }
    s.add(id);
  }, []);
  /** The tab's current live-overlay id set (empty when unset). */
  const liveAnnTextIdsFor = useCallback((tabId: string): ReadonlySet<string> => {
    return liveAnnTextIdsRef.current.get(tabId) ?? EMPTY_ANN_TEXT_IDS;
  }, []);

  const diagnosticsRef = useRef(diagnostics);
  diagnosticsRef.current = diagnostics;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const engineUiRef = useRef(engineUi);
  engineUiRef.current = engineUi;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bootstrapRef = useRef(bootstrap);
  bootstrapRef.current = bootstrap;
  const savedSignaturesRef = useRef(savedSignatures);
  savedSignaturesRef.current = savedSignatures;
  const activeTabIdRefLocal = useRef<string | null>(null);
  // B7 — keep the latest `editModeOpen` in a ref so the tab close
  // handler can read it synchronously without taking the value as
  // a dependency (the close handler is otherwise stable and we
  // don't want to re-create it on every toggle).
  const editModeOpenRef = useRef(editModeOpen);
  editModeOpenRef.current = editModeOpen;
  // Menu-action handler reads the latest tabs / active id without
  // re-subscribing on every change. Mirrors the openTabsRef pattern
  // above so the listener doesn't churn.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // B11 — mirror of `ocrRunByTab` for the suspects panel's open
  // guard. The suspect panel open-handler reads through this ref
  // so the click handler doesn't need to re-create whenever the
  // per-tab OCR run map updates (the same forward-declared-ref
  // pattern as `activeTabIdRefLocal` above).
  const ocrRunByTabRef = useRef<Record<string, boolean>>({});
  ocrRunByTabRef.current = ocrRunByTab;
  // Forward declaration for `refreshDocProxyFor` (defined later in
  // this component). The ref is filled in after the useCallback
  // resolves; the early callers (e.g. `onCropPagesConfirm`) read
  // through the ref so the function reference is always current
  // without re-creating the useCallback when `refreshDocProxyFor`'s
  // identity changes. Same forward-declared-ref pattern as
  // `activeTabIdRefLocal` above (DEF-062).
  const refreshDocProxyForRef = useRef<((tabId: string) => Promise<boolean>) | null>(null);
  // B8 — mirror ref for the close-tab prompt state. The
  // `onCloseTabPromptChoose` handler is a stable callback the
  // dialog consumes; reading the latest pending tab id through
  // this ref means the dialog doesn't need to re-mount on every
  // state change.
  const pendingCloseTabIdRef = useRef<string | null>(null);
  pendingCloseTabIdRef.current = pendingCloseTabId;
  // DEF-142 — mirror ref for the close-request queue. The close
  // subscription and the prompt handler read the latest queue
  // synchronously through this ref (the same stable-callback pattern
  // as `pendingCloseTabIdRef` above), so neither needs to re-create
  // when the queue changes.
  const windowCloseQueueRef = useRef<string[] | null>(null);
  windowCloseQueueRef.current = windowCloseQueue;
  // DEF-211 — one stable ref per tab so the host can address each
  // DocumentView imperatively (currently: disarm its active annotation
  // tool before a dialog overlays the workspace). Refs are created
  // lazily and kept for the session lifetime; a closed tab's ref just
  // points at an unmounted component and is harmless.
  const docViewRefs = useRef(new Map<string, RefObject<DocumentViewHandle | null>>());
  const getOrCreateDocViewRef = useCallback(
    (tabId: string): RefObject<DocumentViewHandle | null> => {
      let r = docViewRefs.current.get(tabId);
      if (r === undefined) {
        r = createRef<DocumentViewHandle>();
        docViewRefs.current.set(tabId, r);
      }
      return r;
    },
    [],
  );
  // DEF-211 — disarm the active tab's annotation tool (back to
  // "select") before a dialog overlays the workspace, so an armed
  // tool's ghost preview / crosshair never lingers under a dialog.
  // No-op when no tab is active or the tab has no mounted view.
  const disarmActiveDocView = useCallback((): void => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const ref = docViewRefs.current.get(activeId);
    ref?.current?.disarmAnnotationTool();
  }, []);

  /** Persist the latest settings to main immediately. Bumps the
   *  echo-filter seq and snapshots the object that went out so the
   *  `settings.changed` listener can drop stale echoes. Every
   *  renderer-issued settings write — theme toggle, annotation
   *  palette, preferences sheet, recents, optimize preset — routes
   *  through here. See the immediate-persist policy comment block
   *  above (search for "Phase 7 — settings persist policy") for the
   *  DEF-044 quit-race rationale. */

  // Phase 7 — settings echo filter (DEF-037). The main process
  // broadcasts every persisted write back to the renderer. When
  // rapid theme toggles + palette changes happen, the broadcast
  // for an older write can land AFTER we've already issued a
  // newer write locally — applying it would clobber fresher local
  // state (per-theme palette buckets, themeDefault, recentsCap).
  // We track a monotonic local-write seq and the most-recent
  // settings object we handed to main; the echo listener
  // (see the `settings.changed` subscription below) uses
  // `shouldApplyEcho(...)` to drop stale echoes.
  const settingsWriteSeqRef = useRef(0);
  const settingsPersistedRef = useRef<AppSettings | null>(null);

  // DEF-202 — the window's live maximize state, mirrored from main.
  // The geometry inside `settings` is NOT a reliable caption source:
  // the echo filter (DEF-037) discards `settings.changed` payloads
  // that differ from our latest local write, and a geometry report
  // almost always differs (bounds move on every window drag while the
  // renderer's snapshot keeps its last-write bounds). Main owns the
  // window state — it reports geometry on every `maximize` /
  // `unmaximize` / move / resize via the debounced report in
  // window.ts, and each report lands here as a `settings.changed`
  // echo. We therefore read `maximized` off EVERY echo, before the
  // filter decides whether the rest of the payload applies, so the
  // caption refreshes even when a local settings write (theme toggle,
  // palette change, ...) has just advanced the write seq — previously
  // that sequence left the caption showing "Maximize" on an
  // already-maximized window.
  const [windowMaximized, setWindowMaximized] = useState(false);

  // Cross-theme animation system — every theme application (boot, echo,
  // toggle, explicit picker choice) routes through the crossfade
  // controller. The FIRST apply (boot) lands without the transitioning
  // class (nothing is painted yet to crossfade from); every later apply
  // crossfades colours/borders/shadows over --motion-theme-crossfade
  // while the PDF page surfaces stay pinned white (see
  // styles/animations.css — .tf-theme-transitioning rules).
  const { setTheme } = useThemeTransition();

  const trackAndSave = useCallback((s: AppSettings): void => {
    settingsWriteSeqRef.current += 1;
    settingsPersistedRef.current = s;
    void window.tflex.saveSettings(s);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runBoot = async (): Promise<void> => {
      const b = await bootSettings();
      if (cancelled) return;
      setBootstrap(b);
      setSettings(b.settings);
      setTheme(b.settings.theme);
      // Phase 16 — restore the pages-panel collapsed state from the
      // boot settings; absent field means the documented default (false).
      dispatchPagesPanel({
        type: "set",
        collapsed: b.settings.pagesPanelCollapsed ?? false,
      });
      // DEF-202 — seed the caption from the boot settings' geometry.
      setWindowMaximized(b.settings.geometry.maximized);
      setBootDone(true);
      // DEF-207 — corrupted settings must not recover silently. When
      // the backend could not parse settings.json (or it is not an
      // object), resolveInitialSettings substituted the defaults; tell
      // the user instead of letting the substitution pass unnoticed
      // (the ADV-028 finding). Missing-file first boots are NOT
      // recovered (load returns ok with defaults), so this toast only
      // fires on real corruption / io failure.
      if (b.recovered) {
        const notice = settingsRecoveryNotice();
        console.warn(notice.log);
        // dispatchError (not pushToast): this effect is declared before
        // pushToast's useCallback, so the deps array could not reference
        // it; the reducer dispatch is stable and dependency-free.
        dispatchError({
          type: 'push',
          toast: { kind: 'error', text: notice.toast },
        });
      }
    };
    runBoot();
    const unsubscribe = window.tflex.settings.changed((s) => {
      // DEF-202 — window state rides EVERY echo (see the state slot
      // comment above). Main re-reports geometry on maximize /
      // unmaximize / move / resize; taking `maximized` from every echo
      // keeps the caption in sync even when the echo filter drops the
      // rest of the payload as a stale local-write reflection.
      setWindowMaximized(s.geometry.maximized);
      // DEF-037 — echo filter. If we've made a local write since
      // this echo's underlying persist, AND the echo's content
      // doesn't match our latest snapshot, the echo is stale —
      // discard. Local state already carries fresher data.
      if (
        !shouldApplyEcho(
          s,
          settingsWriteSeqRef.current,
          settingsPersistedRef.current,
        )
      ) {
        return;
      }
      setSettings(s);
      // Phase 16 — keep the pages-panel collapsed state in sync with
      // settings echoes (main re-sends the persisted value, e.g. after
      // another window writes it). Absent / invalid field: the reducer
      // leaves local state alone (preserve-if-valid, like the backend).
      dispatchPagesPanel({ type: "sync", value: s.pagesPanelCollapsed });
      // DEF-199 — skip the theme re-apply when the document is already
      // showing the echoed theme. The settings.changed echo of our own
      // write re-applies an identical theme, and that second apply
      // used to start a SECOND View Transition that Chromium skips,
      // rejecting the first transition's .finished promise unhandled
      // (renderer pageerror "Transition was skipped" — at boot and on
      // every flip). The data-theme attribute is the ground truth of
      // what <html> shows; the hook's own identity guards are the
      // second line of defense for the same echo.
      if (document.documentElement.getAttribute("data-theme") !== s.theme) {
        setTheme(s.theme);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setTheme]);

  // Phase 14 — Liquid Glass ambient surface. One controller owns the
  // two app-wide ambient behaviors the frosted theme needs: the
  // window-focus attribute on <html> (drives the focus/defocus blur
  // intensity change) and the background-parallax spring that feeds
  // --tf-parallax-x/--tf-parallax-y on the .tf-ambient layer. Both run
  // OUTSIDE React state on purpose — pointer and focus events fire far
  // too often to re-render the App; the controller writes attributes
  // and CSS vars directly. Mounted only after boot so the layer ref
  // points at the real (post-boot) DOM node.
  const ambientLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bootDone) return;
    const controller = createAmbientController({
      root: document.documentElement,
      layer: ambientLayerRef.current,
      win: window,
    });
    return (): void => {
      controller.destroy();
    };
  }, [bootDone]);

  // DEF-142 — whole-window close-request subscription. Main
  // preventDefaults EVERY window close (caption X, Alt+F4, the Window
  // menu's Close role, and Exit -> app.quit which closes the window)
  // and pushes `window:closeRequested`; the renderer is the source of
  // truth for unsaved edits. The handler either confirms immediately
  // when nothing is modified or walks every modified tab through the
  // existing CloseTabPromptDialog (the same modified check closeTab
  // uses; the DEF-128 Save-As routing for path-less tabs is reused
  // automatically via onCloseTabPromptChoose) and calls
  // `confirmClose(true)` only after each tab Save-succeeded or was
  // discarded. Cancel clears the queue and calls nothing — the window
  // stays open. Unsubscribes on unmount.
  useEffect(() => {
    if (typeof window.tflex.onCloseRequested !== "function") return;
    const unsubscribeCloseRequest = window.tflex.onCloseRequested(() => {
      // Main re-pushes on every close attempt; while a window-close
      // flow is already prompting, ignore the duplicate.
      if (windowCloseQueueRef.current !== null) return;
      // Same modified check closeTab uses: the tabs reducer's
      // `meta.modified` OR the engineUi mirror's `state.modified`
      // (the mirror catches the batched-dispatch window right after
      // an engine op, when `meta.modified` can still read false).
      const modifiedIds = tabsRef.current.tabs
        .filter((t) => t.modified || engineUiRef.current[t.id]?.state.modified === true)
        .map((t) => t.id);
      if (modifiedIds.length === 0) {
        // Nothing to save anywhere — the close may proceed.
        void window.tflex.confirmClose?.(true);
        return;
      }
      // If a per-tab close prompt is already showing, keep that tab
      // first so the open dialog continues to own the flow; the rest
      // of the modified tabs follow.
      const pending = pendingCloseTabIdRef.current;
      const queue =
        pending !== null && modifiedIds.includes(pending)
          ? [pending, ...modifiedIds.filter((id) => id !== pending)]
          : modifiedIds;
      setWindowCloseQueue(queue);
      setPendingCloseTabId(queue[0] ?? null);
      setPendingCloseError(null);
      setPendingCloseSaving(false);
    });
    return unsubscribeCloseRequest;
  }, []);

  // OTA UX — one shared subscription to `tflex.update.onStatusChanged`
  // feeds both the toolbar UpdateIndicator (via `externalState`)
  // and the UpdatePromptDialog (via the `updateState` prop). The
  // auto-open effect below reacts to `updateState` transitions
  // into `available` / `downloaded` and pops the prompt. Manual
  // checks (Help -> Check for Update, About button) call
  // `update.checkForUpdates()` if the preload wired it, otherwise
  // they fall back to `getStatus()` so the user still sees a
  // result instead of a no-op.
  //
  // We mount this subscription in a dedicated effect so it survives
  // across the rest of the App's re-renders (the toolbar indicator
  // no longer subscribes itself when App passes that prop — see
  // UpdateIndicator's `externalState` for the contract).
  useEffect(() => {
    const updateApi = window.tflex.update;
    if (updateApi === undefined) {
      // Preload predates OTA — silently degrade. The toolbar
      // indicator renders nothing and the prompt never opens.
      return (): void => undefined;
    }
    let cancelled = false;
    // Seed the initial state from getStatus() so the toolbar
    // renders synchronously without waiting for the first push.
    if (typeof updateApi.getStatus === "function") {
      void updateApi.getStatus()
        .then((next) => {
          if (!cancelled) setUpdateState(next);
        })
        .catch(() => {
          if (!cancelled) setUpdateState(null);
        });
    }
    if (typeof updateApi.onStatusChanged !== "function") return;
    const unsubscribe = updateApi.onStatusChanged((next) => {
      if (!cancelled) setUpdateState(next);
    });
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // OTA UX — when the live UpdateState becomes 'available' or
  // 'downloaded', auto-open the prompt. The toolbar indicator
  // also reflects these states, but the prompt is the *push*
  // that nudges the user to act. Cancelling the prompt does
  // NOT clear `updateState` — the toolbar chip stays visible
  // so the user can still act via the toolbar (and clicking
  // the toolbar chip routes through the IPC directly without
  // re-opening the prompt; that's by design — the prompt is
  // for the first push, the chip is the always-on affordance).
  //
  // Bug 9 — the decision is delegated to the pure
  // `decideUpdatePromptOpen` so it is testable and so the two
  // regressions stay fixed:
  //   - The dialog never auto-closes here; this effect only
  //     OPENS (a user who already dismissed a prompt isn't
  //     re-prompted by the same state — see `updateDismissedKey`).
  //   - While a download is in flight the prompt is NOT re-armed
  //     on a lingering `available` state (outside-click during a
  //     background download). A completed download (downloaded)
  //     always arms the restart/cancel prompt.
  // Terminal states clear the in-flight latch so a future
  // `available` push may prompt again.
  useEffect(() => {
    if (updateState === null || updateState === undefined) return;
    if (
      updateState.kind === "downloaded" ||
      updateState.kind === "error" ||
      updateState.kind === "up-to-date"
    ) {
      setUpdateDownloadInFlight(false);
    }
    // Only ever OPEN the prompt here — the user's dismiss routes
    // through onCloseUpdatePrompt (which sets updateDismissedKey).
    if (updatePromptOpen) return;
    const decision = decideUpdatePromptOpen({
      state: updateState,
      open: false,
      downloadInFlight: updateDownloadInFlight,
      dismissedKey: updateDismissedKey,
    });
    if (decision.shouldOpen) {
      setUpdatePromptOpen(true);
    }
  }, [updateState, updatePromptOpen, updateDownloadInFlight, updateDismissedKey]);

  const onToggleTheme = useCallback((): void => {
    setSettings((prev) => {
      if (prev === null) return prev;
      const next: AppSettings = { ...prev, theme: nextTheme(prev.theme) };
      setTheme(next.theme);
      trackAndSave(next);
      return next;
    });
  }, [trackAndSave, setTheme]);

  // Phase-15 — the frosted-acrylic theme picker. Receives the
  // picker's selection: one of the three explicit themes (light /
  // dark / frosted) OR the 'system' meta-option. 'system' resolves
  // to the OS's current colour preference at choice time
  // (resolveThemeDefault, same contract as the Preferences sheet);
  // the resolved concrete theme is applied live and persisted as
  // `theme` so the same look boots on the next launch, while
  // `themeDefault` records which option the user picked so the
  // header shows the right entry (e.g. "System default") as
  // selected after a restart. Persists through the same trackAndSave
  // path so the choice survives a restart. Shared shape with
  // onToggleTheme, minus the toggle math.
  const onThemeChange = useCallback((next: ThemeDefault): void => {
    const concrete = resolveThemeDefault(
      next,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    setSettings((prev) => {
      if (prev === null) return prev;
      // No-op guard: the pick resolves to the theme already showing
      // AND the selection hasn't moved. themeDefault falls back to
      // the concrete theme when unset — the same fallback the header
      // display uses, so "re-pick the current selection" never
      // churns a persist.
      if (concrete === prev.theme && (prev.themeDefault ?? prev.theme) === next) return prev;
      const updated: AppSettings = { ...prev, theme: concrete, themeDefault: next };
      setTheme(concrete);
      trackAndSave(updated);
      return updated;
    });
  }, [trackAndSave, setTheme]);

  // Phase 16 — collapse / expand the side-rail pages panel. App owns
  // the value and persists it through the same trackAndSave path as
  // every other settings field. No persist while settings hasn't
  // loaded: the backend save replaces the ENTIRE settings object, so
  // writing a partial object would wipe theme / geometry / recents
  // (same null-guard shape as onToggleTheme above).
  const togglePagesPanelCollapsed = useCallback((): void => {
    const next = !pagesPanel.collapsed;
    dispatchPagesPanel({ type: "set", collapsed: next });
    if (settings === null) return;
    const updated: AppSettings = { ...settings, pagesPanelCollapsed: next };
    trackAndSave(updated);
  }, [pagesPanel.collapsed, settings, trackAndSave]);

  const pushToast = useCallback((kind: Toast["kind"], text: string): void => {
    dispatchError({ type: "push", toast: { kind, text } });
  }, []);
  const dismissToast = useCallback((id: number): void => {
    dispatchError({ type: "dismiss", id });
  }, []);

  // OTA UX — manual re-check handler. Wires Help -> Check for
  // Update and the About dialog's "Check for Updates" button.
  // Calls `update.check()` — the renderer -> main IPC that
  // re-runs electron-updater's check with autoDownload=false.
  // The result lands via the shared onStatusChanged
  // subscription and the auto-open effect reacts if the result
  // is `available` / `downloaded`. We open the prompt
  // proactively so the user sees immediate feedback (the body
  // shows "Checking for updates" while the backend runs); the
  // auto-open effect is a no-op when the prompt is already
  // open, so the proactive open and the push path converge.
  //
  // The IPC channel predates this wiring (DEF-079 / DEF-080);
  // `update.check()` resolves with the resulting UpdateState.
  // The toast fallback below triggers only when the IPC
  // surface is absent entirely (very old builds), which is
  // not a realistic runtime condition — included for unit
  // tests and very-stale preload builds.
  const onCheckForUpdate = useCallback((): void => {
    const updateApi = window.tflex.update;
    if (updateApi === undefined || typeof updateApi.check !== "function") {
      pushToast(
        "info",
        "Update checks are not available in this build of TFlex.",
      );
      return;
    }
    setUpdatePromptOpen(true);
    void updateApi.check().catch(() => undefined);
  }, [pushToast]);

  // OTA UX — Update button handler. Bug 9: clicking Update dismisses
  // the prompt and runs the download in the BACKGROUND — the toolbar
  // indicator shows the progress (the backend pushes
  // `downloading(0)` immediately, no gap) and the user can keep
  // working. The in-flight latch stops the auto-open effect from
  // re-arming the "Update" prompt on any stale `available` state
  // while the background download runs; when the download completes
  // ('downloaded') the effect opens a fresh restart/cancel prompt.
  const onUpdateDownload = useCallback((): void => {
    const updateApi = window.tflex.update;
    if (updateApi?.download === undefined) return;
    setUpdateDownloadInFlight(true);
    setUpdatePromptOpen(false);
    void updateApi.download().catch(() => undefined);
  }, []);

  // OTA UX — Install / Restart button handler. Fires
  // `update.install()` which triggers quitAndInstall. The
  // dialog can stay open — the backend closes the window.
  const onUpdateInstall = useCallback((): void => {
    const updateApi = window.tflex.update;
    if (updateApi?.install === undefined) return;
    void updateApi.install().catch(() => undefined);
  }, []);

  // OTA UX — close handler. Called from Cancel / Later / X /
  // backdrop / Escape. The toolbar indicator continues to reflect
  // the underlying state independently. Bug 9 — the dismissed
  // prompt is recorded by key so the auto-open effect doesn't
  // immediately re-show the same state; the toolbar chip remains
  // the always-on affordance for it.
  const onCloseUpdatePrompt = useCallback((): void => {
    setUpdatePromptOpen(false);
    const s = updateState;
    if (isUpdatePromptActionable(s)) {
      setUpdateDismissedKey(updateActionableKey(s));
    }
  }, [updateState]);

  const toastForPdfError = useCallback(
    (errCode: PdfOpenError, path: string): string => {
      switch (errCode) {
        case "not-pdf":
          return `That file is not a PDF ("${splitRecentPath(path).name}").`;
        case "corrupt":
          return `The file could not be read as a PDF ("${splitRecentPath(path).name}"). It may be corrupt or truncated.`;
        case "encrypted":
          return "Password-protected PDFs are not supported in v1.";
        case "io":
          return `Could not open file: ${splitRecentPath(path).name}`;
      }
    },
    [],
  );

  /** Replace the engine UI state for a tab. The modified flag is mirrored
   *  into the tabs reducer so the AppHeader's tab dot updates with the
   *  same React state — openTabs.meta.modified is NOT used by the header
   *  (which reads tabs.tabs), so this is the single source of truth. */
  const setEngineUiFor = useCallback(
    (tabId: string, ui: EngineUiState): void => {
      setEngineUi((prev) => ({ ...prev, [tabId]: ui }));
      const tabsReducerModified = tabsRef.current.tabs.find((t) => t.id === tabId)?.modified;
      if (tabsReducerModified !== undefined && tabsReducerModified !== ui.state.modified) {
        dispatchTabs({ type: "set-modified", id: tabId, modified: ui.state.modified });
      }
    },
    [],
  );

  /** Mark the active engine ui as having an undo available, and clear
   *  redo. Called after a successful applyOp (rotate / delete / reorder
   *  / merge / split). The engine's undo stack grew by one and its redo
   *  stack was cleared, so we mirror that with the counter helpers. */
  const noteOpApplied = useCallback(
    (tabId: string, next: EngineState): void => {
      const prev = engineUiRef.current[tabId];
      const counters = countersAfterApply(prev?.counters ?? ZERO_COUNTERS);
      const flags = flagsFromCounters(counters);
      setEngineUiFor(tabId, {
        state: next,
        counters,
        canUndo: flags.canUndo,
        canRedo: flags.canRedo,
      });
    },
    [setEngineUiFor],
  );

  const openFromBytes = useCallback(
    async (
      bytes: ArrayBuffer,
      source: {
        kind: TabMeta["kind"];
        path: string;
        displayName: string;
        onDiskPath: string | null;
        /** DEF-170 — set false when opening a derived / in-memory result
         *  (extract, split, optimize, create). Each one is a brand-new
         *  document, so the reducer must not collapse it onto a previous
         *  result tab that shares the same synthetic path. Real files and
         *  samples keep the default (re-opening the same path refocuses
         *  the existing tab). */
        dedupePath?: boolean;
      },
    ): Promise<{ tabId: string } | null> => {
      const parsed = await openPdfDocument(bytes);
      if (!("doc" in parsed)) {
        pushToast("error", toastForPdfError(parsed.error, source.path));
        return null;
      }
      const engineDocId = crypto.randomUUID();
      // DEF-036: single-source id. Compute the tab id BEFORE we touch
      // openTabs / engineUi / dispatchTabs, so the id used for the
      // session map (openTabs[id]) and the meta dispatched to the
      // reducer are identical. resolveOpenId reuses the active empty
      // tab's id when one is active ("+ tab" affordance fills in
      // place), and mints a fresh UUID otherwise.
      const { id } = resolveOpenId(
        tabsRef.current,
        { kind: source.kind, filePath: source.path },
      );
      const meta: TabMeta = {
        id,
        title: source.displayName,
        filePath: source.path,
        kind: source.kind,
        modified: false,
      };
      const session: DocSession = {
        doc: parsed.doc,
        outline: null,
        // Snapshot only the size; the bytes themselves are no longer
        // retained past this point — see DocSession.fileSize comment.
        fileSize: bytes.byteLength,
        engineDocId,
        onDiskPath: source.onDiskPath,
        // DEF-139 — a freshly parsed proxy holds the ORIGINAL open
        // bytes (identity file order): the pageOrder translation stays
        // active until a `refreshDocProxyFor` rebuild swaps in a
        // re-serialized (visible-order) proxy.
        proxyVisibleOrder: false,
      };
      const persisted: PersistedViewer = {
        zoomMode: "fit-width",
        manualScale: 1,
        currentPage: 1,
        searchOpen: false,
        query: "",
        activeHitIndex: -1,
      };
      // Register with the engine. The renderer always talks to the engine
      // (real or stub) so the per-tab state is in place before any ops
      // land.
      //
      //   - onDiskPath set  -> loadDocument(path) so the real engine can
      //                        read the file from disk and the stub gets
      //                        the pageCount it needs.
      //   - onDiskPath null -> loadDocumentBytes(bytes) on the real engine
      //                        (samples / split-output tabs have no file
      //                        yet, but we still want the real engine to
      //                        drive rotate / delete / split / saveAs).
      //                        On the stub we just register the pageCount.
      if (source.onDiskPath !== null) {
        const loadResult = await engineRef.current.loadDocument(
          engineDocId,
          source.onDiskPath,
        );
        if (!loadResult.ok) {
          pushToast("error", describeEngineError("open-error", source.onDiskPath));
          void parsed.doc.destroy().catch(() => undefined);
          return null;
        }
      } else {
        if (engineRef.current.available) {
          // Real engine: hand it the bytes directly. Save (in-place) is
          // intentionally disabled on the renderer side because there is
          // no origin file — Save-As remains available for writing a copy.
          const loadResult = await engineRef.current.loadDocumentBytes(
            engineDocId,
            bytes,
          );
          if (!loadResult.ok) {
            pushToast(
              "error",
              describeEngineError("open-error", source.displayName),
            );
            void parsed.doc.destroy().catch(() => undefined);
            return null;
          }
        } else {
          stubRendererEngine.registerTab(engineDocId, parsed.doc.numPages);
        }
      }
      // DEF-137 renderer half — the engine parses annotations,
      // rotations, text boxes, form fields and page labels into its
      // doc state during loadDocument / loadDocumentBytes, but the
      // tab-open path used to seed an empty `initialUiState` and
      // never asked the engine for its state again, so a reopened
      // saved file rendered clean even though the engine had the
      // content loaded. Pull the authoritative EngineState right
      // after a successful load (both the disk `loadDocument` path
      // and the bytes `loadDocumentBytes` path) and seed the tab's
      // engine / engineUi mirrors from it. A getState failure
      // (transient IPC error, older backend) must not break the
      // open — `seededEngineUiState` falls back to the empty
      // initial state exactly as before.
      const stateResult = await engineRef.current.getState(engineDocId);
      const seeded = seededEngineUiState(
        stateResult.ok ? stateResult.value : null,
        parsed.doc.numPages,
      );
      // DEF-209 — refuse documents whose per-page annotation count
      // exceeds the renderer's mirror limit (ADV-030: a synthetic
      // 5000-annotation PDF rendered zero pages — the annotation
      // overlay and the annotations panel both render the full
      // per-page list, so the open either froze or died mid-way with
      // no feedback). A clear error beats a broken open. The check
      // runs on the seeded state because that is the first moment the
      // renderer sees what the engine parsed; the engine keeps its
      // registered doc (there is no unload in the IPC contract) but
      // no tab ever references it, matching the existing engine-load
      // failure path.
      const overLimitPage = firstPageOverAnnotationLimit(seeded.state.annotations);
      if (overLimitPage !== null) {
        void parsed.doc.destroy().catch(() => undefined);
        pushToast(
          "error",
          `Too many annotations on page ${overLimitPage} (${MAX_ANNOTATIONS_PER_PAGE} max). The document was not opened.`,
        );
        return null;
      }
      setOpenTabs((prev) => ({
        ...prev,
        [id]: {
          meta,
          session,
          persisted,
          displayName: source.displayName,
          engine: seeded.state,
          forms: initialFormsState,
          placements: [],
          edit: initialEditState,
        },
      }));
      setEngineUi((prev) => ({
        ...prev,
        [id]: seeded,
      }));
      dispatchTabs({ type: "open", tab: meta, dedupePath: source.dedupePath });

      // Phase 4 — kick off the form-field load in the background. The
      // editor overlay renders nothing until loaded is true; we don't
      // block the open on it. We pass `engineDocId` explicitly because
      // `openTabsRef.current[id]` is stale at this point — React has
      // not committed the `setOpenTabs` call above yet, so the ref
      // hasn't refreshed. Reading the docId we just minted is exact
      // and avoids a race that previously left the form list empty.
      void loadFormFields(id, engineDocId);

      void readOutline(parsed.doc)
        .then((outline) => {
          if (outline === null) return;
          setOpenTabs((prev) => {
            const existing = prev[id];
            if (existing === undefined) return prev;
            return {
              ...prev,
              [id]: { ...existing, session: { ...existing.session, outline } },
            };
          });
        })
        .catch(() => undefined);
      return { tabId: id };
    },
    [pushToast, toastForPdfError],
  );

  const openPdfFromPath = useCallback(
    async (path: string): Promise<void> => {
      const result = await window.tflex.loadPdf(path);
      if (!result.ok) {
        pushToast("error", toastForPdfError(result.error.code, path));
        if (result.error.code === "io" && settings !== null) {
          const remaining = removeRecent(settings.recentFiles, path);
          if (remaining.length !== settings.recentFiles.length) {
            const next: AppSettings = { ...settings, recentFiles: remaining };
            setSettings(next);
            trackAndSave(next);
          }
        }
        return;
      }
      const displayName = splitRecentPath(path).name;
      await openFromBytes(toArrayBuffer(result.value), {
        kind: "file",
        path,
        displayName,
        onDiskPath: path,
      });
      if (settings !== null) {
        const recent: RecentFile = {
          path,
          name: displayName,
          openedAt: new Date().toISOString(),
        };
        await window.tflex.addRecentFile(recent);
      }
    },
    [openFromBytes, pushToast, settings, toastForPdfError, trackAndSave],
  );

  const onOpenClick = useCallback(async (): Promise<void> => {
    const picked = await window.tflex.openFileDialog();
    if (picked === null) return;
    await openPdfFromPath(picked);
  }, [openPdfFromPath]);

  const onSampleClick = useCallback(
    async (sample: SampleDocument): Promise<void> => {
      const samplePath = `samples/${sample.name}`;
      const bytesRes = await window.tflex.readSample(sample.name);
      if (!bytesRes.ok) {
        pushToast("error", `Sample file unavailable: ${sample.name}.`);
        return;
      }
      try {
        await openFromBytes(toArrayBuffer(bytesRes.value), {
          kind: "sample",
          path: samplePath,
          displayName: sample.name,
          onDiskPath: null,
        });
        if (settings !== null) {
          const recent: RecentFile = {
            path: samplePath,
            name: sample.name,
            openedAt: new Date().toISOString(),
          };
          await window.tflex.addRecentFile(recent);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushToast("error", `Failed to open sample: ${msg}`);
      }
    },
    [openFromBytes, pushToast, settings],
  );

  const onRecentClick = useCallback(
    async (entry: RecentFile): Promise<void> => {
      await openPdfFromPath(entry.path);
    },
    [openPdfFromPath],
  );

  const onRemoveRecent = useCallback(
    (entry: RecentFile): void => {
      if (settings === null) return;
      const remaining = removeRecent(settings.recentFiles, entry.path);
      if (remaining.length === settings.recentFiles.length) return;
      const next: AppSettings = { ...settings, recentFiles: remaining };
      setSettings(next);
      trackAndSave(next);
    },
    [settings, trackAndSave],
  );

  // B7 — clear every tool/arm state on tab close. The annotation
  // tool state + edit state are per-tab (lives in DocumentView +
  // openTabs[id].edit) and unmount with the tab, so they don't
  // need explicit cleanup. App-level state (the edit mode toggle,
  // the armed signature id, the in-flight flatten/optimize
  // confirmations) must be reset explicitly so a stale "Sign tool
  // active" pill doesn't carry over to the next tab the user
  // opens. The flatten / optimize / audit / stamp / crop / renumber
  // dialogs gate on `activeTabIdRefLocal.current !== null` so they
  // auto-close when the active tab disappears; the host still calls
  // `set*Open(false)` to drop the dialog state immediately rather
  // than waiting for the next render to mount a new active tab.
  const closeTab = useCallback((id: string): void => {
    // B8 — close-tab prompt. The user clicked the close button
    // on a tab. The previous implementation closed the tab
    // unconditionally, which discarded the engine's undo
    // stack and any unsaved annotations / forms / signatures.
    // We now check the tab's `modified` flag (engine-side) and
    // surface a prompt before destroying the state. The prompt
    // is skipped for:
    //   - The active tab being missing (already-closed
    //     state, double-close race).
    //   - The tab being an empty placeholder (no document to
    //     save).
    //
    // The "modified" check must consult BOTH the tabs reducer's
    // `meta.modified` AND the engineUi state mirror. After a
    // successful engine op (rotate / delete / annotate / …) the
    // tabs reducer dispatches `set-modified` synchronously inside
    // `setEngineUiFor`, but React batches that update with the
    // engineUi setState — so when the user mashes the close button
    // right after clicking rotate, `tabsRef.current.tabs[i].modified`
    // can still read `false` even though the IPC has already
    // returned and the engine knows the doc is dirty. Reading the
    // engineUi mirror (which is updated in the same `setEngineUiFor`
    // call) catches that case. If either signal says "modified",
    // we surface the prompt — the user has work to lose.
    //
    // NOTE: the old `openTabs[id] === undefined -> return` guard is
    // GONE. Empty placeholder tabs never register an OpenTab entry
    // (onNewEmptyTab only dispatches `open-empty`), so that guard
    // turned every empty-tab close into a silent no-op — an X that
    // did nothing. The real double-close race guard is the
    // `tabMeta === undefined` check below (the reducer state is the
    // source of truth for "this tab exists"), and performCloseTab
    // already tolerates a missing OpenTab entry.
    const tabMeta = tabsRef.current.tabs.find((t) => t.id === id);
    if (tabMeta === undefined) return;
    // Skip the prompt for the empty placeholder tabs — they
    // don't have a doc to save.
    if (tabMeta.kind === "empty") {
      performCloseTab(id);
      return;
    }
    const engineModified = engineUiRef.current[id]?.state.modified === true;
    if (!tabMeta.modified && !engineModified) {
      performCloseTab(id);
      return;
    }
    // Show the prompt.
    setPendingCloseTabId(id);
    setPendingCloseError(null);
    setPendingCloseSaving(false);
  }, []);

  // The actual close side-effects. Split out so the prompt
  // path can call it after the user picks "Save" or "Don't
  // save", and so the unconditional close paths (empty /
  // unmodified / missing) don't re-prompt on a second
  // invocation.
  const performCloseTab = useCallback((id: string): void => {
    setOpenTabs((prev) => {
      const next = { ...prev };
      const removed = next[id];
      delete next[id];
      void removed?.session.doc.destroy().catch(() => undefined);
      return next;
    });
    setEngineUi((prev) => {
      const { [id]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    // Drop the engine's per-tab state too.
    const open = openTabsRef.current[id];
    if (open !== undefined) {
      stubRendererEngine.dispose(open.session.engineDocId);
    }
    // DEF-166 — drop the tab's live-overlay annotation id set with it
    // so a freshly-opened tab never inherits stale live-text marks.
    liveAnnTextIdsRef.current.delete(id);
    dispatchTabs({ type: "close", id });
    // B7 — tool / arm state cleanup. The user armed the Sign tool
    // and the "armed" pill stays on the toolbar after the active
    // tab is closed (because the App-level state outlives the
    // tab). Reset it so the next open tab doesn't inherit a stale
    // armed state. The same applies to Edit mode (a per-tab
    // toggle that lives App-level for the toolbar/palette) and
    // to every dialog that was scoped to the now-closed tab.
    setArmedSignatureId(null);
    setArmedStamp(null);
    if (editModeOpenRef.current) {
      setEditModeOpen(false);
    }
    // B7 — the ribbon's armed Edit tool is App-level too; drop it
    // with the other tool arms so a fresh tab starts with no
    // armed ribbon tool.
    setActiveEditMode(null);
    // B6 — drop the closed tab's per-tab OCR suspect / OCR run
    // maps so a freshly-opened tab (or the welcome screen) doesn't
    // inherit stale "OCR has run on this doc" markers. The maps
    // become inert once the tab id disappears, but explicitly
    // pruning the entries closes the loop so a future refactor
    // that passes the wrong id through can't surface an old
    // suspect list against a new doc.
    setOcrSuspectsByTab((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOcrRunByTab((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // B10 / DEF-101 — drop the closed tab's placed-stamp mirror so
    // a freshly-opened tab (or the welcome screen) doesn't inherit
    // stale stamp surfaces. Same pattern as the OCR maps above.
    setPlacedStampsByTab((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // B6 — if the OCR suspects panel was open against this tab,
    // close it. The panel's render gate already requires a
    // non-null active tab id, so closing the active tab would
    // unmount it on the next render anyway — but explicitly
    // closing here keeps the "open" flag consistent with the
    // visible state.
    setOcrSuspectsOpen(false);
    // Drop any open dialog that targeted the now-closed tab. The
    // menus / toolbar buttons that opened these dialogs all gate
    // on `activeTabIdRefLocal.current`, so once the tab is gone
    // the dialogs would be "zombie" modals. Closing them here
    // keeps the UI clean.
    setFlattenOpen(false);
    setOptimizeOpen(false);
    setAuditOpen(false);
    setSaveAsOpen(false);
    setOcrOpen(false);
    setCropPagesOpen(false);
    setStampOpen(false);
    setRenumberPagesOpen(false);
    setReplacePagesOpen(false);
    setInsertPagesOpen(false);
    setCreateOpen(false);
    setExportOpen(false);
    setTextExportOpen(false);
    setDocxExportOpen(false);
    setCommentExportOpen(false);
    setCommentImportOpen(false);
    setDeletePageOpen(false);
    // B21 — the tools palette is App-level (not per-tab) and
    // renders over the workspace even when no tab is active.
    // Closing the last tab left it mounted on the home / welcome
    // screen. Reset it on close so the palette disappears with
    // the document it belonged to.
    setToolsPaletteOpen(false);
    // B6 — pending close-tab prompt state. If the user closed a
    // tab via the prompt and the dialog is still showing (the
    // save flow is in flight, the error message is rendering),
    // close it so a future tab doesn't see a stuck "Save" prompt.
    setPendingCloseTabId(null);
    setPendingCloseError(null);
    setPendingCloseSaving(false);
    // DEF-097 — clear the per-tab activeTool from the diagnostics
    // mirror so a fresh `tflexDiagnostics()` read after the close
    // returns `null` rather than the closed tab's stale tool.
    // DocumentView's per-tab `annTool` reducer unmounts with the
    // tab (the tab-pane is keyed on `meta.id`), so the renderer's
    // own tool state can't leak — but `diagnosticsRef.current`
    // retains the last published value until a new DocumentView
    // (or no DocumentView, on the welcome screen) overwrites it.
    // Resetting `activeTool: null` here makes the surface honest
    // immediately and closes the gap that qa retest exposed.
    setDiagnostics((prev) => {
      if (prev["activeTool"] === null || prev["activeTool"] === undefined) {
        return prev;
      }
      return { ...prev, activeTool: null };
    });
  }, []);

  const activateTab = useCallback((id: string): void => {
    dispatchTabs({ type: "activate", id });
    // B10 — tool-state reset on tab switch. The active tab
    // changes; App-level tool state (armed Sign / Stamp, Edit
    // mode, the ribbon's armed Edit tool, the OCR suspects
    // panel) must NOT carry into the
    // newly-activated tab. Previously only `performCloseTab`
    // cleared these, so a tab switch inherited the previous
    // tab's arming — the Sign pill stayed lit and the next page
    // click in the new tab spawned a signature instead of the
    // annotation the user reached for. Per-tab state (annotation
    // tool, edit placements) lives in DocumentView keyed on
    // meta.id and is untouched by this reset.
    setArmedSignatureId(null);
    setArmedStamp(null);
    setEditModeOpen(false);
    setActiveEditMode(null);
    setOcrSuspectsOpen(false);
  }, []);

  /** Phase 6 — "+ tab" affordance. Appends an empty placeholder tab
   *  and activates it. The next PDF the user opens (via the menu /
   *  toolbar / Welcome screen) fills this tab in place instead of
   *  stacking a new one — see `tabsReducer.open`. */
  const onNewEmptyTab = useCallback((): void => {
    const id = crypto.randomUUID();
    const meta: TabMeta = {
      id,
      title: 'Empty tab',
      filePath: '',
      kind: 'empty',
      modified: false,
    };
    dispatchTabs({ type: 'open-empty', tab: meta });
    // B10 — a brand-new tab must not inherit tool state from the
    // previous tab. The "+" affordance previously left
    // `armedSignatureId` / `armedStamp` / `editModeOpen` set, so
    // the new (or next) tab carried a stale Sign pill / stamp
    // ghost / Edit toolbar into a document the user had never
    // armed. Same reset set as `activateTab` and
    // `performCloseTab`; the OCR suspects panel is also closed so
    // it can't surface against a doc-less tab (B14).
    setArmedSignatureId(null);
    setArmedStamp(null);
    setEditModeOpen(false);
    setActiveEditMode(null);
    setOcrSuspectsOpen(false);
  }, []);

  const onPersist = useCallback((tabId: string, viewer: PersistedViewer): void => {
    setOpenTabs((prev) => {
      const existing = prev[tabId];
      if (existing === undefined) return prev;
      return { ...prev, [tabId]: { ...existing, persisted: viewer } };
    });
  }, []);

  // ---- engine ops ----
  // B19 — refresh the renderer's pdf.js proxy in-place after ANY
  // engine mutation that mutates the document's page stream. The
  // engine writes the new content into its `pdfDoc` and returns
  // the authoritative `EngineState`; the renderer's `doc` proxy
  // still points at the pre-mutation bytes until a proxy refresh
  // tears down the stale proxy and parses the fresh ones.
  //
  // Op-kind → does the page stream change?
  //   rotate  → no (page stream unchanged; only orientation
  //             flips)
  //   delete  → YES (the engine removes pages; the proxy's
  //             source indices shift, so source-page lookups via
  //             `doc.getPage(n)` start returning the wrong page)
  //   reorder → no (source pages unchanged; the pageOrder array
  //             shifts but the proxy's pages are the same set in
  //             the same order)
  //
  // We refresh after every `applyOp` result so any future op
  // that mutates the page stream automatically inherits the
  // refresh. The cost is one extra `getDocumentBytes` round-trip
  // for rotate / reorder (a no-op stream-wise) — cheap relative
  // to the user-visible cost of a stale page being painted after
  // a delete.
  const applyEngineOp = useCallback(
    async (tabId: string, op: EngineOp): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.applyOp(open.session.engineDocId, op);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      // B19 — rebuild the proxy in place so the next
      // `doc.getPage(sourcePage)` call resolves against the
      // post-mutation stream. Without this, deleting page 2 from
      // a 3-page doc leaves the proxy with 3 stale pages — every
      // subsequent PageView on visible 3 fetches source 3, which
      // is now a different page in the engine's pdfDoc.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  const onRotate = useCallback(
    (tabId: string, page: number, dir: "cw" | "ccw"): void => {
      void applyEngineOp(tabId, { kind: "rotate", page, dir });
    },
    [applyEngineOp],
  );

  // DEF-041 — rotate the current page from the toolbar without
  // selecting a thumbnail first. Reads the persisted viewer state
  // for the tab to learn which page is "current" (the same page the
  // toolbar page indicator shows); defaults to 1 when the persisted
  // state isn't seeded yet (the very first frame after tab open,
  // before DocumentView's useEffect runs).
  const onRotateClockwise = useCallback((tabId: string): void => {
    const open = openTabsRef.current[tabId];
    if (open === undefined) return;
    const currentPage = open.persisted.currentPage > 0 ? open.persisted.currentPage : 1;
    void applyEngineOp(tabId, { kind: "rotate", page: currentPage, dir: "cw" });
  }, [applyEngineOp]);

  // Phase 13 — the counter-clockwise counterpart of the toolbar's
  // Rotate button. Same page-resolution rule (the toolbar's visible
  // page), engine op dir flipped to "ccw".
  const onRotateCounterClockwise = useCallback((tabId: string): void => {
    const open = openTabsRef.current[tabId];
    if (open === undefined) return;
    const currentPage = open.persisted.currentPage > 0 ? open.persisted.currentPage : 1;
    void applyEngineOp(tabId, { kind: "rotate", page: currentPage, dir: "ccw" });
  }, [applyEngineOp]);

  const onDelete = useCallback(
    (tabId: string, pages: number[]): void => {
      void applyEngineOp(tabId, { kind: "delete", pages });
    },
    [applyEngineOp],
  );

  const onReorder = useCallback(
    (tabId: string, fromIndex: number, toIndex: number): void => {
      void applyEngineOp(tabId, { kind: "reorder", fromIndex, toIndex });
    },
    [applyEngineOp],
  );

  /** B10 / Bug 5 — drop the tab's placed-stamp mirror. The mirror
   *  (`placedStampsByTab`) is renderer-side only: the engine bakes
   *  stamps into the page bitmap and never reports them back, so an
   *  undo / redo that reverts the bake leaves the mirror stale.
   *  Clearing it makes the proxy-refreshed page canvas (which
   *  re-renders the engine's actual bytes) the single source of
   *  truth again. Cheap no-op when the tab has no mirror entries. */
  const dropPlacedStamps = useCallback((tabId: string): void => {
    setPlacedStampsByTab((prev) => {
      const list = prev[tabId];
      if (list === undefined || list.length === 0) {
        return prev;
      }
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  /** Bug 6 — update a placed stamp's mirror rect after a confirmed
   *  move / resize (the engine has re-baked the stamp at the new
   *  rect; the mirror must follow so the DOM surface matches). */
  const updatePlacedStampRect = useCallback(
    (tabId: string, id: string, rect: { x: number; y: number; width: number; height: number }): void => {
      setPlacedStampsByTab((prev) => {
        const list = prev[tabId];
        if (list === undefined || !list.some((s) => s.id === id)) {
          return prev;
        }
        return {
          ...prev,
          [tabId]: list.map((s) => (s.id === id ? { ...s, rect } : s)),
        };
      });
    },
    [],
  );

  const onUndo = useCallback(
    (tabId: string): void => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // Local pre-check: don't even fire the IPC if the renderer knows the
      // undo stack is empty. Keeps the rail from sending "undo" against a
      // 0-count stack which the engine would just refuse with
      // 'nothing-to-undo' anyway.
      if ((engineUiRef.current[tabId]?.counters.undoCount ?? 0) <= 0) {
        return;
      }
      void engineRef.current.undo(open.session.engineDocId).then((result) => {
        if (!result.ok) {
          if (result.error.code === "nothing-to-undo") return;
          pushToast("error", describeEngineError(result.error.code, result.error.message));
          return;
        }
        const prev = engineUiRef.current[tabId];
        const counters = countersAfterUndo(prev?.counters ?? ZERO_COUNTERS);
        const flags = flagsFromCounters(counters);
        setEngineUiFor(tabId, {
          state: result.value,
          counters,
          canUndo: flags.canUndo,
          canRedo: flags.canRedo,
        });
        // Bug 5 — undo must apply to stamps too. The engine reverts
        // the baked stamp pixels on undo (addStamp pushes an undo
        // snapshot), so the renderer's placed-stamp mirror — which is
        // NOT engine-backed — goes stale. Clear the tab's mirror so
        // the `.stamp-annotation` DOM surfaces can't outlive the
        // reverted bake; the proxy refresh below re-renders the pages
        // and the baked pixels become the single source of truth.
        dropPlacedStamps(tabId);
        // B8c — undo can revert page-mutating ops (crop, delete,
        // reorder, rotate, OCR, …). The renderer's pdf.js `doc`
        // proxy still paints the PRE-undo bytes, so the visible
        // page stays stale until a save/reopen. Rebuild the proxy
        // in place via the same refresh hook every state-returning
        // op uses — same pattern as OCR / crop / merge / flatten
        // (see DEF-062 for why this reads through the ref).
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(tabId).catch(() => undefined);
        }
      });
    },
    [pushToast, setEngineUiFor, dropPlacedStamps],
  );

  const onRedo = useCallback(
    (tabId: string): void => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      if ((engineUiRef.current[tabId]?.counters.redoCount ?? 0) <= 0) {
        return;
      }
      void engineRef.current.redo(open.session.engineDocId).then((result) => {
        if (!result.ok) {
          if (result.error.code === "nothing-to-redo") return;
          pushToast("error", describeEngineError(result.error.code, result.error.message));
          return;
        }
        const prev = engineUiRef.current[tabId];
        const counters = countersAfterRedo(prev?.counters ?? ZERO_COUNTERS);
        const flags = flagsFromCounters(counters);
        setEngineUiFor(tabId, {
          state: result.value,
          counters,
          canUndo: flags.canUndo,
          canRedo: flags.canRedo,
        });
        // Bug 5 — redo re-applies the stamp bake; the mirror was
        // cleared on the matching undo, so it stays cleared here (the
        // proxy refresh below renders the re-applied pixels). Same
        // reasoning as the undo branch: the mirror is not engine-backed.
        dropPlacedStamps(tabId);
        // B8c — redo re-applies page-mutating ops; the pdf.js proxy
        // must follow the engine bytes so the visible page reverts
        // (same refresh path as undo).
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(tabId).catch(() => undefined);
        }
      });
    },
    [pushToast, setEngineUiFor, dropPlacedStamps],
  );

  // ---- annotation ops (Phase 3) ----
  // The renderer generates the id at creation time (randomUUID); the engine
  // validates, persists and returns the new state. Counter bookkeeping mirrors
  // applyOp: undo gains one, redo is cleared. createAnnotation returns the
  // resolved annotation id so future edits can target it without a search.
  const onCreateAnnotation = useCallback(
    async (tabId: string, ann: Annotation): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // DEF-166 — a just-created annotation is not in the loaded
      // pdf.js bytes, so the overlay must keep drawing its text
      // (nothing baked on the canvas yet).
      markAnnTextLive(tabId, ann.id);
      const result = await engineRef.current.createAnnotation(open.session.engineDocId, ann);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied, markAnnTextLive],
  );

  const onEditAnnotation = useCallback(
    async (tabId: string, id: string, patch: AnnotationPatch): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // DEF-166 — the text just changed on the renderer; the canvas
      // still paints the PRE-edit baked appearance (if any), so the
      // overlay must show the new text.
      markAnnTextLive(tabId, id);
      const result = await engineRef.current.editAnnotation(
        open.session.engineDocId,
        id,
        patch,
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied, markAnnTextLive],
  );

  const onDeleteAnnotation = useCallback(
    async (tabId: string, id: string): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.deleteAnnotation(open.session.engineDocId, id);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied],
  );

  // ---- Phase 4: forms ----
  // Load the form field list on tab open and seed the per-tab `forms`
  // state. The engine returns the canonical list with current values;
  // we mirror it locally so the editors can render without an IPC round
  // trip per keystroke (the text editor's 500ms debounce sits on top).
  //
  // The `engineDocId` is taken as an explicit argument because the
  // setOpenTabs calls inside openFromBytes fire this unawaited promise
  // synchronously — at that moment `openTabsRef.current[tabId]` is
  // still stale (React has not committed the tab-open setOpenTabs yet)
  // and reading the ref races against the very update we just queued.
  // The docId we pass in is the exact UUID minted at tab-open time.
  const loadFormFields = useCallback(
    (tabId: string, engineDocId: string): void => {
      void engineRef.current
        .getFormFields(engineDocId)
        .then((result) => {
          if (!result.ok) {
            if (result.error.code === "engine-error") {
              // The backend predates Phase 4 — keep the UI alive by
              // leaving the local forms state at `loaded: false` so
              // the "Forms" indicator stays hidden.
              return;
            }
            pushToast(
              "error",
              describeEngineError(result.error.code, result.error.message),
            );
            return;
          }
          setOpenTabs((prev) => {
            const existing = prev[tabId];
            if (existing === undefined) return prev;
            return {
              ...prev,
              [tabId]: { ...existing, forms: replaceFields(existing.forms, result.value) },
            };
          });
        })
        .catch(() => undefined);
    },
    [pushToast],
  );

  // After a successful fillFormField, refresh the engine state so the UI
  // sees the modified flag (Save-As enables) and the undo counter
  // increments. fillFormField's wire contract returns only the field
  // list (FormField[]), not the full EngineState — `modified` lives on
  // the engine state, not the per-field echo. We therefore follow up
  // with a getState() round-trip and route the result through
  // noteOpApplied, the same path the rotate / delete / annotation
  // / signature ops use (DEF-023).
  //
  // The follow-up also drives the existing engineUi -> openTabs mirror
  // effect, which re-seeds openTabs[tabId].forms via
  // `replaceFields(tab.forms, fromEngine)` using the engine's
  // authoritative `formFields` list. That makes the explicit
  // `replaceFields(existing.forms, result.value)` call below
  // redundant — but we keep it as a belt-and-braces: if the getState
  // round-trip fails (the backend predates EngineState.modified or the
  // IPC transient-fails), the field values still get synced from the
  // fillFormField echo.
  const syncEngineStateAfterFill = useCallback(
    (tabId: string): void => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      void engineRef.current
        .getState(open.session.engineDocId)
        .then((stateResult) => {
          if (!stateResult.ok) {
            // Don't toast: getState failures here are best-effort sync.
            // The fillFormField echo already resynced the field values,
            // and the user-visible "modified" indicator is the only thing
            // missing — which the next engine op (or save) will fix.
            return;
          }
          noteOpApplied(tabId, stateResult.value);
        })
        .catch(() => undefined);
    },
    [noteOpApplied],
  );

  // Debounced text input: we push the optimistic edit locally
  // immediately, then schedule the engine call 500ms later so the
  // payload coalesces into one IPC per quiet window. The same
  // debouncer is used for every text field; per-field isolation isn't
  // needed because the engine call is keyed by `id`.
  const fillFormDebouncerRef = useRef<ReturnType<typeof createDebouncer<[string, string, string | string[]]>>>(
    createDebouncer<[string, string, string | string[]]>(
      (tabId, id, value) => {
        const open = openTabsRef.current[tabId];
        if (open === undefined) return;
        void engineRef.current.fillFormField(open.session.engineDocId, { id, value } as FillFormFieldPayload)
          .then((result) => {
            if (!result.ok) {
              pushToast("error", describeEngineError(result.error.code, result.error.message));
              return;
            }
            // Resync the local list from the engine's authoritative
            // field echo. The engineUi mirror (triggered by
            // syncEngineStateAfterFill below) also seeds formFields;
            // this call is the fallback for the case where getState
            // transient-fails.
            setOpenTabs((prev) => {
              const existing = prev[tabId];
              if (existing === undefined) return prev;
              return {
                ...prev,
                [tabId]: { ...existing, forms: replaceFields(existing.forms, result.value) },
              };
            });
            // Pipe the engine's authoritative state through noteOpApplied
            // so the modified flag flips and the undo counter increments
            // (DEF-023). fillFormField's wire contract returns FormField[]
            // — modified lives on EngineState, so a follow-up getState
            // round-trip is required.
            syncEngineStateAfterFill(tabId);
          });
      },
      500,
    ),
  );
  const fillFormDebouncer = fillFormDebouncerRef.current;

  const onFormValueChange = useCallback(
    (tabId: string, id: string, value: string | string[]): void => {
      // Optimistic local edit so the editor reflects the keystroke at
      // every frame, then schedule the IPC.
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) return prev;
        return {
          ...prev,
          [tabId]: { ...existing, forms: setFieldValue(existing.forms, id, value) },
        };
      });
      fillFormDebouncer(tabId, id, value);
    },
    [fillFormDebouncer],
  );

  const onFormListboxToggle = useCallback(
    (tabId: string, id: string, option: string): void => {
      // Listbox toggles are not debounced — each click is a discrete
      // user action that must reach the engine immediately so the
      // tick mark is durable.
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) return prev;
        const nextForms = toggleListboxValue(existing.forms, id, option);
        if (nextForms === existing.forms) return prev;
        const nextValue = (() => {
          const f = nextForms.fields.find((x) => x.id === id);
          return f?.value ?? "";
        })();
        const open = existing;
        void engineRef.current
          .fillFormField(open.session.engineDocId, { id, value: nextValue } as FillFormFieldPayload)
          .then((result) => {
            if (!result.ok) {
              pushToast("error", describeEngineError(result.error.code, result.error.message));
              return;
            }
            setOpenTabs((prev2) => {
              const e2 = prev2[tabId];
              if (e2 === undefined) return prev2;
              return {
                ...prev2,
                [tabId]: { ...e2, forms: replaceFields(e2.forms, result.value) },
              };
            });
            // Pipe through noteOpApplied so the modified flag flips
            // and the undo counter increments. Same path as the
            // debounced text input above (DEF-023).
            syncEngineStateAfterFill(tabId);
          });
        return { ...prev, [tabId]: { ...existing, forms: nextForms } };
      });
    },
    [pushToast, syncEngineStateAfterFill],
  );

  // ---- Phase 4: signatures ----

  // Load the saved-signature list once at boot. We don't refetch on every
  // tab open — the list is user-global, not per-document.
  useEffect(() => {
    let cancelled = false;
    void getSignatureService()
      .list()
      .then((list) => {
        if (!cancelled) setSavedSignatures(list);
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, []);

  // The overlay actually calls `onPlaceSignature(sigId, page, rect)`.
  const placeSignatureFull = useCallback(
    async (tabId: string, signatureId: string, page: number, rect: SignaturePlacement["rect"]): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // The engine expects PNG bytes on every placement (it embeds them
      // into the PDF on save). The signature list is the source of
      // truth for the source data (drawn polylines / typed text); we
      // rasterise at placement time so the bytes match the placement
      // rect's aspect ratio and never go stale.
      const saved = savedSignaturesRef.current.find((s) => s.id === signatureId);
      if (saved === undefined) {
        pushToast("error", "Saved signature not found.");
        setArmedSignatureId(null);
        return;
      }
      const pngBytes = rasterizeSavedSignatureToPng(saved);
      const placement: SignaturePlacement = {
        id: crypto.randomUUID(),
        signatureId,
        page,
        rect,
        pngBytes,
      };
      const result = await engineRef.current.placeSignature(open.session.engineDocId, placement);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Sync placements + engine state from the engine's authoritative echo.
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) return prev;
        return {
          ...prev,
          [tabId]: {
            ...existing,
            placements: result.value.signatures ?? [...existing.placements, placement],
          },
        };
      });
      noteOpApplied(tabId, result.value);
      // B1/B2 — the armed state is NOT touched here: the Sign
      // overlay's Confirm action bar button clears it via
      // `onCancelSignatureArm` right after `onPlace` returns
      // (operator requirement: "after confirming a sign, exit
      // Sign mode, no ghost"). Keeping the clear out of the
      // engine-completion path means the placement commit and
      // the Sign-mode exit happen in one user gesture; the
      // engine echo (placements + state) lands after. The
      // overlay's Delete path leaves the tool armed (the user
      // is still placing signatures). The only defensive clear
      // here is the missing-saved-signature guard above.
    },
    [pushToast, noteOpApplied],
  );

  const moveSignature = useCallback(
    async (tabId: string, placementId: string, rect: SignaturePlacement["rect"]): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // The engine's IPC contract is `moveSignature(docId, payload)` —
      // see src/shared/ipc.ts and the `MoveSignaturePayload` type. We
      // look up the placement's current page from this tab's local
      // `placements` mirror (which the engine state also echoes back,
      // but the local copy is the freshest source at drag time) and
      // build the payload with the up-to-date page + id + rect. The
      // previous adapter spread those into three positional args,
      // which the real engine rejected (DEF-059).
      const placement = open.placements.find((p) => p.id === placementId);
      if (placement === undefined) {
        pushToast("error", `Could not move signature: unknown placement ${placementId}.`);
        return;
      }
      const result = await engineRef.current.moveSignature(
        open.session.engineDocId,
        { id: placementId, page: placement.page, rect },
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) return prev;
        return {
          ...prev,
          [tabId]: {
            ...existing,
            placements: result.value.signatures ?? existing.placements,
          },
        };
      });
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied],
  );

  const deleteSignature = useCallback(
    async (tabId: string, placementId: string): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.deleteSignature(open.session.engineDocId, placementId);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) return prev;
        return {
          ...prev,
          [tabId]: {
            ...existing,
            placements: result.value.signatures ?? existing.placements,
          },
        };
      });
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied],
  );

  // ---- Phase 10: Edit content (text run / text box / image) ----

  /** Read the active tab's "current page" (1-based, from the
   *  per-tab persisted viewer state). The Edit overlay is
   *  per-page, so every edit op needs the page number; we read
   *  the user's last-known visible page rather than a separate
   *  "edit page" so the user edits what they see. */
  function currentPageOfTab(
    tabId: string,
    tabsRef: { current: Record<string, OpenTab | undefined> },
  ): number {
    const tab = tabsRef.current[tabId];
    if (tab === undefined) return 1;
    return Math.max(1, Math.floor(tab.persisted.currentPage));
  }

  /** Toggle Edit mode. Closing the mode clears the active tool on
   *  every tab; the placements list is preserved so the user can
   *  re-open and pick up where they left off. Opening the mode
   *  cross-disarms the Sign / Stamp arms (Bug 1): the edit overlay
   *  is a second pointer-active layer, so an armed signature ghost
   *  or stamp ghost must not survive the transition — the next page
   *  click would otherwise both edit and place. The annotation
   *  creation tool is disarmed by DocumentView's own cross-disarm
   *  effect (it watches `editModeOpen` rising). */
  const setEditMode = useCallback((open: boolean): void => {
    setEditModeOpen(open);
    if (open) {
      // Cross-disarm — mirror of the Sign ↔ Stamp guards above.
      setArmedSignatureId(null);
      setArmedStamp(null);
    }
    if (!open) {
      // Reset the tool on every open tab so a stray "text" tool
      // doesn't leak into the next session.
      setOpenTabs((prev) => {
        const next: typeof prev = {};
        for (const [id, tab] of Object.entries(prev)) {
          next[id] = { ...tab, edit: editReducer(tab.edit, { type: "set-tool", tool: "off" }) };
        }
        return next;
      });
    }
  }, []);

  /** Bug 4 — disarm the per-tab Edit-content tools. Escape (and any
   *  other global disarm path) sets every tab's active edit tool to
   *  "off" so the EditOverlay stops consuming page clicks, without
   *  closing Edit mode entirely (the user can pick a tool again). */
  const disarmEditTools = useCallback((): void => {
    setOpenTabs((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [id, tab] of Object.entries(prev)) {
        if (tab.edit.tool !== "off") {
          next[id] = { ...tab, edit: editReducer(tab.edit, { type: "set-tool", tool: "off" }) };
          changed = true;
        } else {
          next[id] = tab;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** Commit a text-run edit. Calls `engine.editTextRun`; the
   *  engine masks the rect and draws the new text at the rect's
   *  top-left. */
  const handleEditTextRun = useCallback(
    async (tabId: string, args: {
      rect: { x: number; y: number; width: number; height: number };
      newText: string;
      style: EditTextStyle;
      /** DEF-151 — when committing a MOVE of an already-edited run,
       *  the engine must mask the ORIGINAL rect (not `rect`) and draw
       *  at `rect`; omit for a plain in-place edit. */
      oldRect?: { x: number; y: number; width: number; height: number };
    }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.editTextRun(open.session.engineDocId, {
        page: currentPageOfTab(tabId, openTabsRef),
        rect: args.rect,
        newText: args.newText,
        font: args.style.font,
        size: args.style.size,
        color: args.style.color,
        ...(args.oldRect !== undefined ? { oldRect: args.oldRect } : {}),
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      // DEF-108 — the engine masked the old run and drew the new
      // text into its copy of the PDF. The renderer's pdf.js `doc`
      // proxy still paints the pre-edit bytes, so the live view
      // keeps showing the ORIGINAL run until a save/reopen. Rebuild
      // the proxy in place via the Phase 11 refresh hook — same
      // pattern OCR / crop / merge / flatten use. Read through the
      // forward-declared ref (refreshDocProxyFor is defined later in
      // this component; a direct dep would be a TDZ reference, see
      // DEF-062).
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        // Phase-C smooth commit — AWAIT the refresh (same DEF-155
        // "no stale frame" contract as handleTextBoxMove): the
        // returned promise is what the EditOverlay holds its white
        // eraser cover open for, so it must resolve only after the
        // engine mask AND the pdf.js proxy swap have both landed.
        // The previous `void refreshFn(...)` resolved the promise
        // before the re-serialized bytes reached the renderer — the
        // cover released while the canvas still painted the old run
        // and the original flashed back mid re-bake.
        await refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** Commit a new text box. */
  const handleAddTextBox = useCallback(
    async (tabId: string, args: {
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: EditTextStyle;
      background: "white" | "none";
    }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // DEF-135/136 — mint the box id BEFORE the engine call and pass
      // it inside the payload (AddTextBoxPayload.id is optional but the
      // renderer may supply one). The engine registers the box under
      // THIS id, so the local mirror and the registry agree — the
      // engine-state mirror effect (below) replaces the local entry
      // with the echoed TextBoxModel carrying the same id, keeping the
      // selection / drag handle on the right box.
      const boxId = crypto.randomUUID();
      const page = currentPageOfTab(tabId, openTabsRef);
      const result = await engineRef.current.addTextBox(open.session.engineDocId, {
        id: boxId,
        page,
        rect: args.rect,
        text: args.text,
        font: args.style.font,
        size: args.style.size,
        color: args.style.color,
        background: args.background,
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      // B5 — register the committed box in the per-tab edit
      // registry so the box tool can select / move it. A registry
      // backend echoes the box back on `EngineState.textBoxes` (the
      // App mirror then adopts the engine's TextBoxModel with this
      // same id); a pre-registry backend leaves the local entry as
      // the only surface (same pattern as the image placements).
      setOpenTabs((prev) => {
        const t = prev[tabId];
        if (t === undefined) return prev;
        return {
          ...prev,
          [tabId]: {
            ...t,
            edit: editReducer(t.edit, {
              type: "upsert-text-box",
              placement: {
                id: boxId,
                page,
                rect: args.rect,
                text: args.text,
                style: args.style,
                background: args.background,
              },
            }),
          },
        };
      });
      // DEF-113 — the engine drew the new text box into its copy of
      // the PDF. The renderer's pdf.js `doc` proxy still paints the
      // pre-edit bytes, so the committed box is invisible in the
      // live view until a save/reopen. Rebuild the proxy via the
      // Phase 11 refresh hook — same pattern as OCR / crop / merge /
      // flatten (and the DEF-108 fix right above). AWAIT the refresh
      // (same contract as handleEditTextRun / handleTextBoxMove): the
      // returned promise resolves only after the engine bytes AND the
      // proxy swap have landed, so the engine commit and the UI update
      // stay synchronized end-to-end.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** DEF-127/127b + DEF-135/136 — commit a COMMITTED text box's drag
   *  (move or resize).
   *
   *  DEF-135/136 — the backend is converting text boxes to an
   *  ENGINE-SIDE REGISTRY (addTextBox / moveTextBox / deleteTextBox
   *  + EngineState.textBoxes, shipped in parallel). When the registry
   *  op is available, moving a box is a REGISTRY UPDATE
   *  (`engine.moveTextBox`): the engine re-targets the box's rect and
   *  the renderer mirror adopts the echoed list. The previous
   *  rasterize + `editImage` mask-and-redraw is demoted to a
   *  FALLBACK for backends that predate the registry — it was
   *  destructive: the white mask erased underlying content for
   *  `background: "none"` boxes (DEF-127's documented Phase-10
   *  visual-redact behavior). On failure the registry rect is
   *  reverted so no orphan surface survives (the box visually snaps
   *  back to its committed position). */
  const handleTextBoxMove = useCallback(
    async (tabId: string, args: {
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      text: string;
      style: EditTextStyle;
      background: "white" | "none";
      id: string;
    }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // Revert helper — restore the registry rect to the committed
      // position (a failed commit must not leave a phantom box).
      const revertRect = (): void => {
        setOpenTabs((prev) => {
          const t = prev[tabId];
          if (t === undefined) return prev;
          return {
            ...prev,
            [tabId]: {
              ...t,
              edit: editReducer(t.edit, {
                type: "set-text-box-rect",
                id: args.id,
                rect: args.oldRect,
              }),
            },
          };
        });
      };
      // DEF-135/136 — preferred path: the engine-side registry. The
      // box's baked content moves with the rect (no mask-and-redraw,
      // so nothing underneath is erased), and the echoed
      // `EngineState.textBoxes` drives the renderer mirror.
      // Signature matches the shared IPC contract
      // `moveTextBox(docId, id, rect)` — the engine looks the box up
      // by id; `page` is not part of the payload (the registry entry
      // owns it).
      const engine = engineRef.current;
      if (engine.moveTextBox !== undefined) {
        const result = await engine.moveTextBox(
          open.session.engineDocId,
          args.id,
          args.newRect,
        );
        if (!result.ok) {
          pushToast("error", describeEngineError(result.error.code, result.error.message));
          revertRect();
          return;
        }
        noteOpApplied(tabId, result.value);
        // The engine registry re-targets the box's content; refresh
        // the pdf.js proxy so the moved text renders without a
        // save/reopen (same pattern as addTextBox). DEF-155 — AWAIT
        // the refresh so the promise the overlay holds resolves only
        // after the proxy swap lands; the overlay keeps its white
        // eraser cover over the OLD rect until then (no stale frame
        // window at release).
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          await refreshFn(tabId).catch(() => false);
        }
        return;
      }
      // Fallback (pre-registry backend): rasterise the box at the
      // new rect and re-bake it through the existing editImage
      // contract ("mask `oldRect`, draw `imageBytes` at `newRect`").
      // The engine never knows the bytes came from a text box; the
      // undo stack gets a single entry.
      let png: Uint8Array;
      try {
        png = await rasterizeTextBoxToPng({
          text: args.text,
          rect: args.newRect,
          style: args.style,
          background: args.background,
          encoder: defaultImageEncoder(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "text box rasterization failed";
        pushToast("error", `Move text box failed: ${message}`);
        revertRect();
        return;
      }
      const result = await engine.editImage(open.session.engineDocId, {
        page: currentPageOfTab(tabId, openTabsRef),
        op: "move",
        oldRect: args.oldRect,
        newRect: args.newRect,
        imageBytes: png,
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        revertRect();
        return;
      }
      noteOpApplied(tabId, result.value);
      // B17 / B19 — the engine masked the old position and baked
      // the raster at the new one; refresh the pdf.js proxy so the
      // moved text renders without a save/reopen. DEF-155 — await
      // the refresh (same no-stale-frame contract as the registry
      // path above).
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(tabId).catch(() => false);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** DEF-135/136 — delete a REGISTERED text box through the engine's
   *  registry. Preferred: `engine.deleteTextBox` removes the box and
   *  its baked content in one registry update; the renderer mirror
   *  adopts the echoed list (the box disappears from every page).
   *
   *  Fallback (pre-registry backend): a WHITE-background box can be
   *  erased by masking its rect with a white raster via the legacy
   *  editImage contract. A TRANSPARENT box (`background: "none"`)
   *  CANNOT be erased without the registry — the white mask would
   *  cover whatever content sits under the box. Fail loud: toast and
   *  keep the box (a "Delete did nothing" would be a silent no-op).
   *  On success the local registry entry is removed along with the
   *  engine-side box. */
  const handleTextBoxDelete = useCallback(
    async (tabId: string, id: string) => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const box = open.edit.textBoxes.find((b) => b.id === id);
      if (box === undefined) return;
      // Local registry removal — used by BOTH the registry path (the
      // engine omits an emptied textBoxes list, so the mirror alone
      // would leave the box on screen) and the fallback path.
      const removeLocal = (): void => {
        setOpenTabs((prev) => {
          const t = prev[tabId];
          if (t === undefined) return prev;
          return {
            ...prev,
            [tabId]: {
              ...t,
              edit: editReducer(t.edit, { type: "delete-text-box", id }),
            },
          };
        });
      };
      const engine = engineRef.current;
      if (engine.deleteTextBox !== undefined) {
        const result = await engine.deleteTextBox(open.session.engineDocId, id);
        if (!result.ok) {
          pushToast("error", describeEngineError(result.error.code, result.error.message));
          return;
        }
        noteOpApplied(tabId, result.value);
        // The engine's state echo OMITS `textBoxes` when the registry
        // empties (the shared contract: "Absent when the doc has no
        // boxes" — same as the stub), so the mirror effect's
        // undefined short-circuit would leave the deleted box on
        // screen. Clear the local registry entry explicitly; the
        // mirror still adopts non-empty echoes for move/add.
        removeLocal();
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(tabId).catch(() => undefined);
        }
        return;
      }
      // Fallback: pre-registry backend.
      if (box.background !== "white") {
        pushToast(
          "error",
          "Deleting a transparent text box requires the backend text-box registry update.",
        );
        return;
      }
      let png: Uint8Array;
      try {
        // White raster at the box rect — masks the baked box away.
        png = await rasterizeTextBoxToPng({
          text: "",
          rect: box.rect,
          style: box.style,
          background: "white",
          encoder: defaultImageEncoder(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "text box erase failed";
        pushToast("error", `Delete text box failed: ${message}`);
        return;
      }
      const result = await engine.editImage(open.session.engineDocId, {
        page: currentPageOfTab(tabId, openTabsRef),
        op: "replace",
        oldRect: box.rect,
        newRect: box.rect,
        imageBytes: png,
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      removeLocal();
      noteOpApplied(tabId, result.value);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** Commit an image edit. The renderer produces the transformed
   *  bytes (resize / crop / replace) and hands them to the engine.
   *  For `move` the bytes are passed through unchanged; for
   *  `resize` / `replace` they're re-encoded to the new rect's
   *  pixel dims; for `crop` they're cropped to the inner rect. */
  const handleEditImage = useCallback(
    async (tabId: string, args: {
      op: "move" | "resize" | "replace" | "crop";
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      bytes: Uint8Array;
      format: "png" | "jpeg";
      id: string;
    }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // Transform the bytes per the op. We do this before the IPC
      // so a render failure surfaces as a friendly toast, not a
      // half-committed engine state.
      let outBytes: Uint8Array;
      try {
        if (args.op === "move") {
          outBytes = args.bytes;
        } else if (args.op === "resize" || args.op === "replace") {
          outBytes = await resizeImageToBytes({
            sourceBytes: args.bytes,
            target: args.newRect,
            decoder: defaultImageDecoder(),
            encoder: defaultImageEncoder(),
          });
        } else {
          // crop
          outBytes = await cropImageToBytes({
            sourceBytes: args.bytes,
            imageRect: args.oldRect,
            crop: args.newRect,
            decoder: defaultImageDecoder(),
            encoder: defaultImageEncoder(),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "image transform failed";
        pushToast("error", `Edit image failed: ${message}`);
        return;
      }
      const format = detectImageFormat(outBytes);
      if (format === "unknown") {
        pushToast("error", "Edit image: re-encoded bytes are not a recognised PNG/JPEG.");
        return;
      }
      const result = await engineRef.current.editImage(open.session.engineDocId, {
        page: currentPageOfTab(tabId, openTabsRef),
        op: args.op,
        oldRect: args.oldRect,
        newRect: args.newRect,
        imageBytes: outBytes,
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Update the local registry so the next crop / resize / move
      // starts from the new bytes + rect.
      setOpenTabs((prev) => {
        const tab = prev[tabId];
        if (tab === undefined) return prev;
        const nextPlacements = tab.edit.placements.map((p) =>
          p.id === args.id
            ? { ...p, rect: args.newRect, bytes: outBytes, format }
            : p,
        );
        return {
          ...prev,
          [tabId]: {
            ...tab,
            edit: { ...tab.edit, placements: nextPlacements },
          },
        };
      });
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied],
  );

  /** Update the default font for the active tab. Persists through
   *  `trackAndSave` so the next open session picks it up. */
  const setEditDefaultFont = useCallback(
    (font: EditFont): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated = preferencesReducer(prev, { type: "set-edit-default-font", value: font });
        if (updated !== prev) trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  // Sign toolbar button handler — opens the manager modal. We dispatch
  // from DocumentView via a CustomEvent so the toolbar stays ignorant
  // of App state.
  useEffect(() => {
    const onSignButton = (): void => {
      disarmActiveDocView();
      // Cross-arming guard — arming the Sign tool while the Stamp
      // tool is armed would leave both overlays visible (the
      // stamp ghost following the cursor AND the signatures
      // crosshair). Tear down the stamp overlay first so the
      // user only ever sees one armed tool at a time. The
      // toolbar's Stamp button does the same in `onStampClick`.
      if (armedStamp !== null) {
        setArmedStamp(null);
      }
      // DEF-125 — clicking Sign while Edit mode is active must
      // exit Edit mode. The edit layer (z-index 4) sits ABOVE the
      // signatures layer (z-index 3), so with Edit mode open the
      // placement click is swallowed by the edit overlay and the
      // signature never lands. Exiting Edit mode (same
      // cross-disarm pattern as Sign↔Stamp) drops the edit layer
      // so the Sign placement works on the page.
      if (editModeOpenRef.current) {
        setEditMode(false);
      }
      if (armedSignatureId !== null) {
        // Already armed -> toggle off.
        setArmedSignatureId(null);
        return;
      }
      setSigModalOpen(true);
    };
    const onFlattenButton = (): void => {
      disarmActiveDocView();
      setFlattenOpen(true);
    };
    // B10 — Esc inside the StampOverlay dispatches this event so
    // the overlay can disarm without owning the host's stamp
    // state. The toolbar's stamp button has the same effect
    // (re-clicking an armed stamp toggles it off via
    // `onStampClick`).
    const onStampDisarm = (): void => {
      setArmedStamp(null);
    };
    window.addEventListener("tflex:sign-button", onSignButton);
    window.addEventListener("tflex:flatten-button", onFlattenButton);
    window.addEventListener("tflex:stamp-disarm", onStampDisarm);
    return (): void => {
      window.removeEventListener("tflex:sign-button", onSignButton);
      window.removeEventListener("tflex:flatten-button", onFlattenButton);
      window.removeEventListener("tflex:stamp-disarm", onStampDisarm);
    };
  }, [armedSignatureId, armedStamp, disarmActiveDocView]);

  const onSigManagerApply = useCallback((signatureId: string): void => {
    // DEF-125 — the modal-confirm arm also exits Edit mode (the
    // user may have opened the manager before reaching the Edit
    // toggle; the placement click must hit the signatures layer,
    // not the edit overlay).
    if (editModeOpenRef.current) {
      setEditMode(false);
    }
    setArmedSignatureId(signatureId);
  }, []);

  const onFlattenConfirm = useCallback(async (): Promise<void> => {
    setFlattenOpen(false);
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    const result = await engineRef.current.flattenForms(open.session.engineDocId);
    if (!result.ok) {
      pushToast("error", describeEngineError(result.error.code, result.error.message));
      return;
    }
    // Drop the local field list — the engine's mirror of formFields
    // is empty after flatten and the engineUi->formFields effect on the
    // next render will pull that through. We set the local list to
    // empty directly so the toolbar's "Flatten" pill / field editors
    // disappear on the very next render instead of waiting for the
    // engine state echo to round-trip.
    setOpenTabs((prev) => {
      const existing = prev[activeId];
      if (existing === undefined) return prev;
      if (existing.forms.fields.length === 0 && existing.forms.loaded) {
        return prev;
      }
      return {
        ...prev,
        [activeId]: { ...existing, forms: { fields: [], loaded: true } },
      };
    });
    noteOpApplied(activeId, result.value);
    // B15 / B19 — flatten bakes every AcroForm widget into the
    // page content and removes the form field dictionaries from
    // the engine's pdfDoc. The renderer's `doc` proxy still points
    // at the pre-flatten bytes; without a refresh, the FormsOverlay
    // keeps rendering the now-removed widgets and the search index
    // keeps walking the stale field-derived text. Rebuild the
    // proxy via the Phase 11 refresh hook so the visual state and
    // the engine state converge without a save+reopen.
    const refreshFn = refreshDocProxyForRef.current;
    if (refreshFn !== null) {
      void refreshFn(activeId).catch(() => undefined);
    }
    pushToast("info", "Form fields flattened.");
  }, [noteOpApplied, pushToast]);

  // Refresh the saved-signature list every time the modal closes so the
  // host's mirror stays current (the modal itself updates its local copy
  // synchronously, but we want the App-level list to reflect additions
  // and deletions too).
  const onSigModalClose = useCallback(async (): Promise<void> => {
    setSigModalOpen(false);
    try {
      const list = await getSignatureService().list();
      setSavedSignatures(list);
    } catch {
      // ignore: signature service is best-effort; the local mirror is
      // the source of truth for the UI.
    }
  }, []);

  // Sync signatures from the engine state on every refresh. The engine
  // echoes the canonical list in `engineState.signatures`, which the
  // engineUi subscription already updates.
  useEffect(() => {
    setOpenTabs((prev) => {
      let changed = false;
      const next: Record<string, OpenTab> = {};
      for (const [tabId, tab] of Object.entries(prev)) {
        const ui = engineUi[tabId];
        const fromEngine = ui?.state.signatures;
        if (fromEngine === undefined) {
          next[tabId] = tab;
          continue;
        }
        // Same-length shallow comparison: the wire-shape objects may be
        // different identities even when nothing changed, so fall back
        // to a quick JSON comparison to avoid re-rendering every tab on
        // every keystroke.
        if (fromEngine.length === tab.placements.length) {
          let same = true;
          for (let i = 0; i < fromEngine.length; i += 1) {
            const a = fromEngine[i];
            const b = tab.placements[i];
            if (a === undefined || b === undefined) { same = false; break; }
            if (a.id !== b.id || a.signatureId !== b.signatureId || a.page !== b.page) { same = false; break; }
            const ar = a.rect;
            const br = b.rect;
            if (ar.x !== br.x || ar.y !== br.y || ar.width !== br.width || ar.height !== br.height) {
              same = false; break;
            }
          }
          if (same) {
            next[tabId] = tab;
            continue;
          }
        }
        next[tabId] = { ...tab, placements: fromEngine };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [engineUi]);

  // Sync form fields from engine state on every refresh. Same pattern
  // as signatures: the engine echoes the canonical list, we mirror.
  //
  // Content-hash gate (DEF-020): the engine echoes back a fresh
  // `FormField[]` array on every `getState` call (new identity, but
  // same shape when nothing changed). Without the `sameFormFields`
  // short-circuit, the previous shape unconditionally built a new
  // `openTabs` map on every echo. Combined with the signatures mirror
  // effect, the per-tab render path was re-running on every
  // engineUi update — and the first `flattenForms` round-trip
  // (which produces a same-shape-but-different-identity echo with
  // the form list collapsed to `[]`) pushed the chain past React-19's
  // max-update-depth guard, un-mounting the tree.
  //
  // With the gate, a same-content echo skips the `replaceFields` call
  // AND the new outer `OpenTab` object, so `openTabs` keeps the same
  // reference and no downstream effect re-fires.
  useEffect(() => {
    setOpenTabs((prev) => {
      let changed = false;
      const next: Record<string, OpenTab> = {};
      for (const [tabId, tab] of Object.entries(prev)) {
        const ui = engineUi[tabId];
        const fromEngine = ui?.state.formFields;
        if (fromEngine === undefined) {
          next[tabId] = tab;
          continue;
        }
        if (sameFormFields(tab.forms.fields, fromEngine)) {
          next[tabId] = tab;
          continue;
        }
        next[tabId] = { ...tab, forms: replaceFields(tab.forms, fromEngine) };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [engineUi]);

  // DEF-135/136 — sync the per-tab text-box mirror from the engine's
  // registry on every state echo. The backend converts text boxes to
  // an engine-side registry (addTextBox / moveTextBox / deleteTextBox
  // + EngineState.textBoxes, shipped in parallel); every op that
  // echoes the registry list is the authoritative source of which
  // boxes exist and where they are. The renderer's `edit.textBoxes`
  // is a pure mirror of that list — "register committed boxes from
  // engine state" — so a box added through `addTextBox` gets the
  // ENGINE's id, a `moveTextBox` echo updates its rect in place, and
  // a `deleteTextBox` echo removes it. Older backends omit the key:
  // `fromEngine === undefined` short-circuits (the local list stays,
  // preserving the pre-registry behavior).
  //
  // The content comparator (sameTextBoxes) keeps same-shape echoes
  // from dispatching; without it, every rotate / undo / reorder
  // round-trip would rebuild the openTabs edit state and re-render
  // every document page.
  useEffect(() => {
    setOpenTabs((prev) => {
      let changed = false;
      const next: Record<string, OpenTab> = {};
      const defaultFont: EditFont = settings?.editDefaultFont ?? "Helvetica";
      for (const [tabId, tab] of Object.entries(prev)) {
        const ui = engineUi[tabId];
        const fromEngine = ui?.state?.textBoxes;
        if (fromEngine === undefined) {
          next[tabId] = tab;
          continue;
        }
        const placements = engineTextBoxesToPlacements(fromEngine, defaultFont);
        if (sameTextBoxes(tab.edit.textBoxes, placements)) {
          next[tabId] = tab;
          continue;
        }
        next[tabId] = {
          ...tab,
          edit: editReducer(tab.edit, { type: "replace-text-boxes", boxes: placements }),
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [engineUi, settings?.editDefaultFont]);

  // ---- save / save-as ----

  // DEF-142 — one modified tab resolved its close prompt (Save
  // succeeded or Don't save). Advance the window-close queue: show
  // the prompt for the next modified tab, or — when the queue
  // empties — tell main the window may shut via `confirmClose(true)`.
  // No-op for a plain per-tab close (the queue is null). Reading the
  // queue through the ref keeps this stable so
  // `onCloseTabPromptChoose` (also stable) never re-creates.
  const advanceWindowCloseQueue = useCallback((): void => {
    const queue = windowCloseQueueRef.current;
    if (queue === null) return;
    const next = queue.slice(1);
    if (next.length === 0) {
      // Every modified tab resolved — the window may now close.
      setWindowCloseQueue(null);
      void window.tflex.confirmClose?.(true);
      return;
    }
    // More modified tabs to walk through: show the next one.
    setWindowCloseQueue(next);
    setPendingCloseTabId(next[0] ?? null);
    setPendingCloseError(null);
    setPendingCloseSaving(false);
  }, []);

  // B8 — close-tab prompt handler. The user picked one of
  // Save / Don't save / Cancel from the CloseTabPromptDialog.
  // We orchestrate the save flow here (the dialog stays
  // mounted while the save runs) and only call
  // `performCloseTab` once the user has either explicitly
  // discarded the changes or the save has succeeded. If the
  // save fails the dialog stays open and the error message
  // is shown inline so the user can retry or cancel.
  const onCloseTabPromptChoose = useCallback(
    async (choice: CloseTabPromptChoice): Promise<void> => {
      const id = pendingCloseTabIdRef.current;
      if (id === null) return;
      if (choice === "cancel") {
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        // DEF-142 — abort any in-flight window-close flow. No
        // confirmClose call: the window stays open.
        setWindowCloseQueue(null);
        return;
      }
      if (choice === "discard") {
        // The user explicitly asked to throw away the work.
        // Close the tab; performCloseTab handles the rest.
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        performCloseTab(id);
        // DEF-142 — this tab resolved; advance the window-close
        // queue (confirmClose(true) fires when the queue empties).
        advanceWindowCloseQueue();
        return;
      }
      // choice === "save"
      const tab = openTabsRef.current[id];
      if (tab === undefined) {
        // Tab already gone — race? Just dismiss the prompt.
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        return;
      }
      if (tab.session.onDiskPath === null) {
        // DEF-128 — the tab has no on-disk path (a bytes-loaded /
        // sample tab). The Save choice MUST NOT hard-block with an
        // inline error: route it through the engine's Save-As flow
        // (an OS save dialog). The tab closes only after a
        // successful Save-As; a user cancel (or a write failure)
        // keeps the tab open so the user can retry or discard.
        setPendingCloseSaving(true);
        setPendingCloseError(null);
        try {
          const saved = await engineRef.current.saveAs(
            tab.session.engineDocId,
          );
          if (!saved.ok) {
            if (saved.error.code === "cancelled") {
              // User dismissed the OS save dialog — the tab stays
              // open, still modified. Stay in the prompt.
              return;
            }
            setPendingCloseError(
              describeEngineError(saved.error.code, saved.error.message),
            );
            return;
          }
          // Save-As succeeded: mark the tab unmodified (mirrors the
          // normal save flow), then close it.
          const ui = engineUiRef.current[id];
          const nextState = ui?.state ?? tab.engine;
          const counters = countersAfterSave(ui?.counters ?? ZERO_COUNTERS);
          const flags = flagsFromCounters(counters);
          setEngineUiFor(id, {
            state: { ...nextState, modified: false },
            counters,
            canUndo: flags.canUndo,
            canRedo: flags.canRedo,
          });
          setPendingCloseSaving(false);
          setPendingCloseTabId(null);
          setPendingCloseError(null);
          performCloseTab(id);
          // DEF-142 — Save-As succeeded; advance the window-close
          // queue (confirmClose(true) fires when the queue empties).
          advanceWindowCloseQueue();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setPendingCloseError(msg);
        } finally {
          setPendingCloseSaving(false);
        }
        return;
      }
      setPendingCloseSaving(true);
      setPendingCloseError(null);
      try {
        const result = await engineRef.current.save(tab.session.engineDocId);
        if (!result.ok) {
          setPendingCloseError(
            describeEngineError(result.error.code, result.error.message),
          );
          return;
        }
        // Save succeeded. Close the tab.
        setPendingCloseSaving(false);
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        performCloseTab(id);
        // DEF-142 — the save resolved; advance the window-close queue
        // (confirmClose(true) fires when the queue empties).
        advanceWindowCloseQueue();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPendingCloseError(msg);
      } finally {
        setPendingCloseSaving(false);
      }
    },
    [],
  );

  const onSave = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = openTabsRef.current[tabId];
      if (tab === undefined) return;
      if (tab.session.onDiskPath === null) {
        pushToast(
          "info",
          "This document is read-only. Use Save As to save a copy.",
        );
        return;
      }
      const result = await engineRef.current.save(tab.session.engineDocId);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      const ui = engineUiRef.current[tabId];
      const nextState = ui?.state ?? tab.engine;
      // The engine clears both undo and redo stacks on save success.
      const counters = countersAfterSave(ui?.counters ?? ZERO_COUNTERS);
      const flags = flagsFromCounters(counters);
      setEngineUiFor(tabId, {
        state: { ...nextState, modified: false },
        counters,
        canUndo: flags.canUndo,
        canRedo: flags.canRedo,
      });
      pushToast("info", `Saved ${tab.displayName}.`);
    },
    [pushToast, setEngineUiFor],
  );

  // DEF-040 — Save-As is now a two-step flow: the renderer modal
  // (SaveAsDialog) collects the linearize choice first; on confirm,
  // the existing engine.saveAs call fires. The modal writes the
  // linearize toggle through the same optimizePreset path the
  // Optimize dialog uses, so the user's choice persists across
  // launches. `onSaveAs(tabId)` opens the modal; the actual save
  // IPC runs from the modal's confirm handler. The keyboard
  // accelerator, menu File -> Save As, and the toolbar's Save…
  // button all funnel through this entry point.
  const onSaveAs = useCallback((tabId: string): void => {
    disarmActiveDocView();
    const tab = openTabsRef.current[tabId];
    if (tab === undefined) return;
    setSaveAsOpen(true);
  }, []);

  // The actual engine.saveAs call, dispatched by the modal's
  // confirm handler. Kept separate from `onSaveAs` so the modal
  // can call it once the linearize choice is captured. The renderer
  // policy is identical to the pre-modal flow:
  //   - cancelled   -> user dismissed the OS save dialog; stay quiet.
  //   - write-error -> real failure (EPERM, locked disk, full disk).
  //                    Surface as an error toast.
  //   - anything else -> generic engine failure; surface it too.
  const performSaveAs = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = openTabsRef.current[tabId];
      if (tab === undefined) return;
      const result = await engineRef.current.saveAs(tab.session.engineDocId);
      if (!result.ok) {
        if (result.error.code === "cancelled") return;
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      const ui = engineUiRef.current[tabId];
      const nextState = ui?.state ?? tab.engine;
      // Same stack reset as onSave: a successful saveAs means the engine
      // cleared both stacks.
      const counters = countersAfterSave(ui?.counters ?? ZERO_COUNTERS);
      const flags = flagsFromCounters(counters);
      setEngineUiFor(tabId, {
        state: { ...nextState, modified: false },
        counters,
        canUndo: flags.canUndo,
        canRedo: flags.canRedo,
      });
      pushToast("info", `Saved a copy of ${tab.displayName}.`);
    },
    [pushToast, setEngineUiFor],
  );

  // Phase 7 — native application menu. The backend builds the menu
  // (see src/main/menu.ts) and pushes every action over IPC as a
  // 'menu:action' channel carrying { action: string }. The preload
  // exposes that channel via `tflex.menu.onAction(cb)`; we subscribe
  // here and route each action through the pure dispatcher in
  // `state/menuActions.ts`, which fans out to the same handlers the
  // toolbar / keyboard accelerator already use. The menu is a thin
  // dispatch surface — no business logic lives here.
  //
  // DEF-038: the renderer used to listen for a DOM CustomEvent
  // named 'menu:action' that the preload bridge never dispatches.
  // Every menu item (Help -> About, File -> Save, ...) silently
  // failed. The fix wires App.tsx to the IPC bridge and removes the
  // DOM listener entirely.
  // Phase 7 — native application menu + Phase 13 menu popover.
// The backend builds the menu (see src/main/menu.ts) and pushes every
// action over IPC as a 'menu:action' channel carrying
// { action: string }. The preload exposes that channel via
// `tflex.menu.onAction(cb)`. Both the native-menu listener AND the
// custom TitleBar's menu popover route through the SAME
// `dispatchMenuAction(action, ctx)` call — they share the same bag of
// handlers, so the two surfaces always behave identically. The menu
// is a thin dispatch surface — no business logic lives here.
//
// We hoist the context into a `useMemo` with stable deps so both
// consumers see the SAME reference across App renders. Resubscribing
// to `onAction` on every render would churn the IPC subscription; the
// menu listener's `useEffect` watches the memoised context's identity
// (deps below) and unsubscribes/resubscribes only when the underlying
// handler identities change — same pattern the rest of the App uses.
//
// DEF-038: the renderer used to listen for a DOM CustomEvent
// named 'menu:action' that the preload bridge never dispatches.
// Every menu item (Help -> About, File -> Save, ...) silently
// failed. The fix wires App.tsx to the IPC bridge and removes the
// DOM listener entirely.
const menuContext: MenuActionContext = useMemo<MenuActionContext>(
    () => ({
      open: (): void => {
        void onOpenClick();
      },
      merge: (): void => {
        disarmActiveDocView();
        setMergeOpen(true);
      },
      // DEF-065 — Save / Save As / Close Tab / Undo / Redo are
      // document-bound menu actions. The renderer's context
      // handlers gate on `tabsRef.current.activeId` via
      // `gateOnActiveDoc`, so clicking them on the welcome
      // screen (zero tabs) is a clean no-op instead of a
      // "silent error". The visual enable state of the menu
      // itself is owned by the main process; this gate only
      // covers the renderer's own side of the click.
      save: gateOnActiveDoc(
        () => tabsRef.current.activeId !== null,
        (): void => {
          const activeId = tabsRef.current.activeId;
          if (activeId !== null) {
            void onSave(activeId);
          }
        },
      ),
      saveAs: gateOnActiveDoc(
        () => tabsRef.current.activeId !== null,
        (): void => {
          const activeId = tabsRef.current.activeId;
          if (activeId !== null) {
            void onSaveAs(activeId);
          }
        },
      ),
      closeTab: gateOnActiveDoc(
        () => tabsRef.current.activeId !== null,
        (): void => {
          const activeId = tabsRef.current.activeId;
          if (activeId !== null) {
            closeTab(activeId);
          }
        },
      ),
      undo: gateOnActiveDoc(
        () => tabsRef.current.activeId !== null,
        (): void => {
          const activeId = tabsRef.current.activeId;
          if (activeId !== null) {
            void onUndo(activeId);
          }
        },
      ),
      redo: gateOnActiveDoc(
        () => tabsRef.current.activeId !== null,
        (): void => {
          const activeId = tabsRef.current.activeId;
          if (activeId !== null) {
            void onRedo(activeId);
          }
        },
      ),
      toggleTheme: (): void => {
        onToggleTheme();
      },
      showToolsPalette: (): void => {
        setToolsPaletteOpen((v) => !v);
      },
      about: (): void => {
        disarmActiveDocView();
        setAboutOpen(true);
      },
      preferences: (): void => {
        disarmActiveDocView();
        setPrefsOpen(true);
      },
      optimize: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setOptimizeOpen(true);
      },
      auditSpace: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setAuditOpen(true);
      },
      // Phase 9 — Create from images is reachable from the welcome
      // screen too (no doc required). Export-Pages requires an
      // active doc; gate on the same active-tab id the other
      // doc-bound actions use.
      createFromImages: (): void => {
        disarmActiveDocView();
        setCreateOpen(true);
      },
      exportPages: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setExportOpen(true);
      },
      // Phase 9 advanced — text export, docx export, and insert
      // pages. Each routes through the same modal-state plumbing
      // as the raster export. The host stays menu-agnostic; the
      // dialogs own their own engine IPC and the user can also
      // reach these via the Tools palette.
      exportText: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setTextExportOpen(true);
      },
      exportDocx: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setDocxExportOpen(true);
      },
      insertPages: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setInsertPagesOpen(true);
      },
      // Phase 11 — Recognize Text (OCR). Same funnel as the
      // toolbar's OCR button and the Tools palette entry.
      recognizeText: (): void => {
        disarmActiveDocView();
        if (activeTabIdRefLocal.current === null) return;
        setOcrOpen(true);
      },
      // OTA UX — Help -> Check for Update. Asks the backend to
      // re-run the electron-updater check (when the preload
      // exposes `update.checkForUpdates()`) or falls back to a
      // `getStatus()` round-trip so the user always sees a
      // result. The prompt auto-opens from the subscription if
      // the result is `available` / `downloaded`. Document-
      // agnostic — reachable from the welcome screen too.
      checkForUpdate: (): void => {
        onCheckForUpdate();
      },
    }),
    // The memoised deps are the underlying handler identities
    // (useCallbacks / useStates that change rarely). The setters
    // are stable; the callback identities only change when their
    // own deps change.
    [
      onOpenClick,
      onSave,
      onSaveAs,
      closeTab,
      onUndo,
      onRedo,
      onToggleTheme,
      onCheckForUpdate,
      disarmActiveDocView,
    ],
  );

useEffect(() => {
    const unsubscribe = window.tflex.menu.onAction((action) => {
      dispatchMenuAction(action, menuContext);
    });
    return unsubscribe;
  }, [menuContext]);

  // ---- merge / split dialogs ----
  const onMergeClick = useCallback((): void => {
    disarmActiveDocView();
    setMergeOpen(true);
  }, []);

  const onCancelMerge = useCallback((): void => {
    setMergeOpen(false);
  }, []);

  const onConfirmMerge = useCallback(
    async (choice: {
      otherPath: string;
      otherBytes: Uint8Array;
      position: "before" | "after" | "afterPage";
      afterPage?: number;
    }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setMergeOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const engine = engineRef.current;
      // B12 — "afterPage" goes through the engine's
      // `insertFromPdf`, which inserts every page of the picked
      // PDF at a specific 1-based position. The legacy
      // `merge()` IPC only supports "before" / "after" the entire
      // doc, so the per-page case needs the dedicated call. The
      // engine returns the new state with pageCount + pageOrder
      // refreshed; we route that through the same `noteOpApplied`
      // path the simple merge uses.
      if (choice.position === "afterPage") {
        if (engine.insertFromPdf === undefined) {
          pushToast(
            "error",
            "Insert-at-position is not supported by this build.",
          );
          return;
        }
        const n = choice.afterPage ?? 0;
        // The dialog passes a 1-based "after N" page number; the
        // engine's `insertFromPdf` consumes a 0-based
        // `afterIndex`. We translate: "after page 0" -> insert
        // before page 1 (afterIndex = -1). "after page N" ->
        // insert between N and N+1 (afterIndex = N - 1).
        const afterIndex = n <= 0 ? -1 : n - 1;
        const result = await engine.insertFromPdf(
          open.session.engineDocId,
          choice.otherBytes,
          afterIndex,
        );
        if (!result.ok) {
          pushToast("error", describeEngineError(result.error.code, result.error.message));
          return;
        }
        noteOpApplied(activeId, result.value);
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(activeId).catch(() => undefined);
        }
        return;
      }
      const result = await engine.merge(
        open.session.engineDocId,
        [choice.otherPath],
        choice.position,
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(activeId, result.value);
      // B14 / B19 — merge mutates page content (the engine writes
      // the merged-in pages into its pdfDoc). The renderer's `doc`
      // proxy still points at the pre-merge bytes; without a
      // refresh, every PageView on the merged-in pages continues to
      // render at the pre-merge viewport, the thumbnails show stale
      // bitmaps, and the search / annotations layers walk stale
      // items. Rebuild the proxy in place via the Phase 11 refresh
      // hook — same pattern crop / stamp / replace / OCR / flatten
      // already use.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
    },
    [noteOpApplied, pushToast],
  );

  const onSplitClick = useCallback((): void => {
    disarmActiveDocView();
    setSplitOpen(true);
  }, []);

  const onCancelSplit = useCallback((): void => {
    setSplitOpen(false);
  }, []);

  /** Open the bytes produced by split/extract as a brand-new tab in the
   *  renderer. The engine returns ArrayBuffer PDF bytes; we feed them into
   *  the same openFromBytes flow the Open button uses, but without an
   *  on-disk path (so Save-As is required to keep the result). */
  const openEngineBytesAsTab = useCallback(
    async (
      bytes: ArrayBuffer,
      originDisplayName: string,
      kind: "extract" | "split",
      pagesSelected: number[],
    ): Promise<void> => {
      // Display name like "report.pdf — pages 10-20" for clarity.
      const tail = pagesSelected.length === 0
        ? ""
        : pagesSelected.length === 1
          ? ` — page ${pagesSelected[0]}`
          : ` — pages ${pagesSelected.length} selected`;
      const displayName = `${originDisplayName}${tail}`;
      const result = await openFromBytes(toArrayBuffer(bytes), {
        kind: "file",
        path: `<${kind}>${originDisplayName}`,
        displayName,
        onDiskPath: null, // never in-place save the result
        // DEF-170 — every split/extract produces a brand-new document;
        // do not collapse it onto a previous result tab sharing the
        // same synthetic path.
        dedupePath: false,
      });
      if (result !== null) {
        // Mark the new tab as modified so the user knows it hasn't been saved.
        dispatchTabs({ type: "set-modified", id: result.tabId, modified: true });
      }
    },
    [openFromBytes],
  );

  const onConfirmSplit = useCallback(
    async (choice: { range: number[]; mode: "extract" | "split" }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setSplitOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const engine = engineRef.current;
      const result =
        choice.mode === "extract"
          ? await engine.extract(open.session.engineDocId, choice.range)
          : await engine.split(open.session.engineDocId, [
              choice.range[0],
              choice.range[choice.range.length - 1],
            ]);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Split removes pages from the engine's current doc — refresh the
      // active tab's cached engineState so the rail / thumbnail rail /
      // toolbar see the new pageCount, the modified dot appears and
      // undo is wired up. Extract leaves the source untouched, so no
      // refresh needed in that case.
      if (choice.mode === "split") {
        const refreshed = await engine.getState(open.session.engineDocId);
        if (refreshed.ok) {
          noteOpApplied(activeId, refreshed.value);
        }
        // B19 — split is a content-stream mutation: the engine
        // re-serialised the remaining pages into a new pdfDoc. The
        // renderer's `doc` proxy still points at the pre-split
        // bytes; without a refresh the pageCount change is hidden
        // behind the stale proxy and the surviving pages continue
        // to render at the wrong viewport. Rebuild the proxy via
        // the Phase 11 refresh hook (same pattern crop / merge /
        // OCR / flatten use).
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(activeId).catch(() => undefined);
        }
      }
      await openEngineBytesAsTab(result.value, open.displayName, choice.mode, choice.range);
      pushToast(
        "info",
        choice.mode === "extract"
          ? `Extracted ${choice.range.length} page${choice.range.length === 1 ? "" : "s"} to a new document.`
          : `Split off ${choice.range.length} page${choice.range.length === 1 ? "" : "s"} to a new document.`,
      );
    },
    [noteOpApplied, openEngineBytesAsTab, pushToast],
  );

  // B12 — merge file picker. The dialog needs both the picked PDF's
// path (for the legacy `merge()` IPC, which loads the file by
// path) AND the raw bytes (for `insertFromPdf`, which inserts
// every page at a specific 1-based position). We always return
// both so the dialog can decide which engine call to make based
// on the user's chosen position; the dialog pins the path in
// `data-merge-path` and the bytes are read on demand.
const onPickMergeFile = useCallback(async (): Promise<{ path: string; bytes: Uint8Array } | null> => {
    const path = await window.tflex.openFileDialog();
    if (path === null) return null;
    const res = await window.tflex.loadPdf(path);
    if (!res.ok) return null;
    return { path, bytes: new Uint8Array(res.value) };
  }, []);

  // ---- Phase 8: optimize + audit space ----

  /** Open the Optimize dialog against the active tab. The toolbar /
   *  Tools palette / menu all funnel through this. The dialog drives
   *  its own engine.optimize call; we hand it a callback that closes
   *  the dialog and routes the resulting bytes into a brand-new tab
   *  via openEngineBytesAsTab (same path split/extract use). */
  const onOptimizeClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setOptimizeOpen(true);
  }, []);

  const onCancelOptimize = useCallback((): void => {
    setOptimizeOpen(false);
  }, []);

  /** Run engine.optimize with the active preset. Returns the bytes
   *  plus a byte-length (the dialog uses it for the FFT comparison
   *  and to render the success toast). */
  const runOptimizeForActiveTab = useCallback(
    async (
      preset: OptimizePreset,
    ): Promise<{ bytes: ArrayBuffer; size: number } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.optimize(
        open.session.engineDocId,
        preset,
      );
      if (!result.ok) {
        return {
          error: describeEngineError(result.error.code, result.error.message),
        };
      }
      return { bytes: result.value, size: result.value.byteLength };
    },
    [],
  );

  const runAuditSpaceForActiveTab = useCallback(
    async (): Promise<SpaceAudit | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.auditSpace(
        open.session.engineDocId,
      );
      if (!result.ok) {
        return {
          error: describeEngineError(result.error.code, result.error.message),
        };
      }
      return result.value;
    },
    [],
  );

  const onConfirmOptimize = useCallback(
    async (preset: OptimizePreset, bytes: ArrayBuffer): Promise<void> => {
      setOptimizeOpen(false);
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const presetLabel =
        preset === 'none' ? 'linearized' : preset === 'compact' ? 'compact' : 'maximum';
      const displayName = `${open.displayName} — optimized (${presetLabel})`;
      const result = await openFromBytes(toArrayBuffer(bytes), {
        kind: "file",
        path: `<optimize>${open.displayName}`,
        displayName,
        onDiskPath: null,
        dedupePath: false,
      });
      if (result !== null) {
        // Mark the new tab as modified so the user knows it hasn't been
        // saved yet. The engine's `optimize` is read-only on the
        // source doc, so the source tab's modified flag does NOT flip.
        // We update BOTH the tabs reducer (for the AppHeader's
        // modified-dot indicator) AND the App's openTabs map (for
        // `tflexDiagnostics().tabModified`, which the e2e harness
        // reads to verify the new tab needs saving).
        dispatchTabs({ type: "set-modified", id: result.tabId, modified: true });
        setOpenTabs((prev) => {
          const tab = prev[result.tabId];
          if (tab === undefined) return prev;
          return {
            ...prev,
            [result.tabId]: { ...tab, meta: { ...tab.meta, modified: true } },
          };
        });
      }
      pushToast(
        "info",
        `Reduced ${formatBytesForToast(bytes.byteLength)} → open the new tab to save.`,
      );
    },
    [openFromBytes, pushToast],
  );

  const onAuditClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setAuditOpen(true);
  }, []);

  const onCancelAudit = useCallback((): void => {
    setAuditOpen(false);
  }, []);

  // ---- Phase 9: Create-from-images + Export-Pages ----

  const onCreateClick = useCallback((): void => {
    disarmActiveDocView();
    setCreateOpen(true);
  }, []);

  const onCancelCreate = useCallback((): void => {
    setCreateOpen(false);
  }, []);

  /** Host callback: invoke `engine.createFromImages` and route the
   *  result into a brand-new tab. Mirrors the Optimize / Split /
   *  Extract flow: read image bytes off disk, hand them to the
   *  engine, open the resulting PDF in a fresh tab. */
  const runCreateFromImages = useCallback(
    async (
      files: File[],
      quality: number,
    ): Promise<{ bytes: ArrayBuffer; size: number; name: string } | { error: string }> => {
      if (files.length === 0) return { error: "No images selected." };
      try {
        const buffers: Uint8Array[] = [];
        for (const f of files) {
          const buf = new Uint8Array(await f.arrayBuffer());
          buffers.push(buf);
        }
        const docId = `create-${crypto.randomUUID()}`;
        const result = await engineRef.current.createFromImages(docId, buffers, quality);
        if (!result.ok) {
          return { error: describeEngineError(result.error.code, result.error.message) };
        }
        return {
          bytes: result.value,
          size: result.value.byteLength,
          name: files[0]?.name ?? "new.pdf",
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: msg };
      }
    },
    [],
  );

  const onCreateConfirm = useCallback(
    async (files: File[], quality: number): Promise<void> => {
      setCreateOpen(false);
      const result = await runCreateFromImages(files, quality);
      if ("error" in result) {
        pushToast("error", `Could not create PDF: ${result.error}`);
        return;
      }
      // Open the result as a new tab. We seed a synthesised
      // display name from the first image's name (strip extension
      // and prefix with "Created from ").
      const firstName = files[0]?.name ?? "new.pdf";
      const baseName = firstName.replace(/\.[^/.]+$/, "");
      const displayName = `Created from ${baseName}.pdf`;
      const opened = await openFromBytes(toArrayBuffer(result.bytes), {
        kind: "file",
        path: `<create>${firstName}`,
        displayName,
        onDiskPath: null,
        dedupePath: false,
      });
      if (opened !== null) {
        dispatchTabs({ type: "set-modified", id: opened.tabId, modified: true });
        pushToast("info", `Created PDF from ${files.length} image${files.length === 1 ? "" : "s"}.`);
      }
    },
    [openFromBytes, pushToast, runCreateFromImages],
  );

  /** Host callback: `engine.exportPages` against the active tab. The
   *  dialog supplies its own engine.docId() lookup via the active tab
   *  state; we hand back an error string when no document is open. */
  const runExportPages = useCallback(
    async (
      payload: ExportPagesPayload,
    ): Promise<ExportPageEntry[] | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.exportPages(open.session.engineDocId, payload);
      if (!result.ok) {
        return { error: describeEngineError(result.error.code, result.error.message) };
      }
      return result.value;
    },
    [],
  );

  const onExportClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setExportOpen(true);
  }, []);

  const onCancelExport = useCallback((): void => {
    setExportOpen(false);
  }, []);

  const onExportConfirm = useCallback(
    (result: { entries: ExportPageEntry[] }): void => {
      // The dialog itself already triggered per-page downloads via
      // URL.createObjectURL + anchor click. We close the dialog here
      // and surface a confirmation toast so the user knows how many
      // pages were saved.
      setExportOpen(false);
      pushToast(
        "info",
        `Exported ${result.entries.length} page${result.entries.length === 1 ? "" : "s"}.`,
      );
    },
    [pushToast],
  );

  // ---- Phase 9 advanced: text + docx + insert ----

  const onTextExportClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setTextExportOpen(true);
  }, []);

  const onCancelTextExport = useCallback((): void => {
    setTextExportOpen(false);
  }, []);

  /** Host callback for the text export dialog. Calls
   *  `engine.exportText(docId)` against the active tab; the dialog
   *  formats the per-page strings as TXT or RTF and saves via the
   *  renderer-side download flow. */
  const runExportText = useCallback(
    async (): Promise<
      { pageIndex: number; text: string }[] | { error: string }
    > => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.exportText(open.session.engineDocId);
      if (!result.ok) {
        return { error: describeEngineError(result.error.code, result.error.message) };
      }
      return result.value;
    },
    [],
  );

  const onTextExportConfirm = useCallback(
    (result: { range: number[]; format: "txt" | "rtf"; text: string }): void => {
      setTextExportOpen(false);
      pushToast(
        "info",
        `Exported ${result.range.length} page${result.range.length === 1 ? "" : "s"} as ${result.format.toUpperCase()}.`,
      );
    },
    [pushToast],
  );

  const onDocxExportClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setDocxExportOpen(true);
  }, []);

  const onCancelDocxExport = useCallback((): void => {
    setDocxExportOpen(false);
  }, []);

/** DOCX assembly — text-first (editable) export. The renderer
   *  rasterises every page to PNG so the fallback always has
   *  pixels, then hands the entries to the engine. The engine's
   *  `createDocxFromDoc(docId, entries)` channel (DEF-060) pulls
   *  REAL per-page text from the loaded document and emits editable
   *  `w:p`/`w:r`/`w:t` runs in the .docx — text the user can select
   *  and re-edit in Word / Google Docs / LibreOffice. Pages with no
   *  extractable text (scans, image-only pages) fall back to an
   *  inline page image from the matching entry.
   *
   *  Why text-first now? The previous Bug-7 preference for
   *  `engine.createDocxFromImages(entries)` produced a one-image-per-
   *  page .docx — visually identical, but the text was painted-in
   *  raster: not selectable, not editable. The product decision
   *  reverses that preference: editable text IS the point of a Word
   *  export. Some layout fidelity is lost (fonts, weights, colors,
   *  exact positioning become the page's plain text), but text
   *  remains fully editable. `createDocxFromImages` stays as the
   *  graceful fallback for backends that predate the DEF-060 channel
   *  or where the text pass errors, so the user still gets a usable
   *  file either way.
   *
   *  The dialog's `runAssemble` prop signature is `(entries) => Promise<Uint8Array | { error: string }>`
   *  — same shape as before — so the existing DocxExportDialog
   *  component doesn't change. We resolve the active tab's
   *  `engineDocId` here so the host (which owns the tab state) is
   *  the only place that knows the docId; the dialog stays a
   *  pure-presentational renderer of the export form. */
  const runAssembleDocx = useCallback(
    async (
      entries: DocxImageEntry[],
    ): Promise<Uint8Array | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) {
        return { error: describeEngineError("engine-error", "no active document for DOCX assembly") };
      }
      const open = openTabsRef.current[activeId];
      if (open === undefined) {
        return { error: describeEngineError("engine-error", "active document closed before DOCX assembly") };
      }
      const docId = open.session.engineDocId;
      // Preferred path — TEXT-FIRST assembly. The engine extracts the
      // loaded document's own per-page text (reusing its exportText
      // machinery) and emits editable w:p/w:r/w:t paragraphs; pages
      // without extractable text fall back to the rasterised entry.
      // The entries array is still required — the engine needs the
      // pixels for the image-fallback pages.
      const engine = engineRef.current;
      if (typeof engine.createDocxFromDoc === "function") {
        // DEF-106 (B12) — MUST be a MEMBER call, never a detached
        // extraction (`const f = engineRef.current.createDocxFromDoc;
        // await f(...)`): the engine client's createDocxFromDoc reads
        // `this.inner`, and a detached reference loses the `this`
        // binding (undefined in strict mode), so every export threw
        // "Cannot read properties of undefined (reading 'inner')".
        // The invocation stays on the client instance.
        const result = await engine.createDocxFromDoc(docId, entries);
        if (result.ok) {
          return result.value;
        }
        // Text pass failed AND the backend has the raster-only
        // channel — fall through to it (graceful degradation).
        if (typeof engine.createDocxFromImages === "function") {
          const fallback = await engine.createDocxFromImages(entries);
          if (fallback.ok) {
            return fallback.value;
          }
          return {
            error: describeEngineError(fallback.error.code, fallback.error.message),
          };
        }
        return {
          error: describeEngineError(result.error.code, result.error.message),
        };
      }
      // Backend predates the DEF-060 text channel — raster-only.
      if (typeof engine.createDocxFromImages === "function") {
        const fallback = await engine.createDocxFromImages(entries);
        if (fallback.ok) {
          return fallback.value;
        }
        return {
          error: describeEngineError(fallback.error.code, fallback.error.message),
        };
      }
      return {
        error: describeEngineError(
          "engine-error",
          "DOCX assembly requires the Phase 9 backend update.",
        ),
      };
    },
    [],
  );

  const onDocxExportConfirm = useCallback(
    (result: { range: number[]; dpi: number }): void => {
      setDocxExportOpen(false);
      pushToast(
        "info",
        `Exported ${result.range.length} page${result.range.length === 1 ? "" : "s"} as DOCX at ${result.dpi} DPI.`,
      );
    },
    [pushToast],
  );

  const onInsertPagesClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setInsertPagesOpen(true);
  }, []);

  const onCancelInsertPages = useCallback((): void => {
    setInsertPagesOpen(false);
  }, []);

  /** OS file picker for the "from another PDF" insert path. Returns
   *  the picked PDF's bytes + path. The renderer reads the bytes
   *  off disk via the standard file dialog, then forwards them to
   *  `engine.insertFromPdf`. */
  const pickOtherPdf = useCallback(async (): Promise<
    { bytes: Uint8Array; path: string } | null
  > => {
    const path = await window.tflex.openFileDialog();
    if (path === null) return null;
    const res = await window.tflex.loadPdf(path);
    if (!res.ok) return null;
    const displayName = splitRecentPath(path).name;
    void displayName;
    return { bytes: new Uint8Array(res.value), path };
  }, []);

  const onInsertPagesConfirm = useCallback(
    async (choice: {
      mode: "blank" | "fromPdf";
      position: number;
      widthPt?: number;
      heightPt?: number;
      otherBytes?: Uint8Array;
      otherPath?: string;
    }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) {
        setInsertPagesOpen(false);
        return;
      }
      const open = openTabsRef.current[activeId];
      if (open === undefined) {
        setInsertPagesOpen(false);
        return;
      }
      let res;
      if (choice.mode === "blank") {
        const width = choice.widthPt ?? 612;
        const height = choice.heightPt ?? 792;
        // DEF-129 — "before page 1" (slot 0) is a legitimate dialog
        // position in blank mode too. The engine now consumes an
        // `afterIndex` of -2 as the PREPEND sentinel, so the renderer
        // maps slot 0 to -2: the new blank page becomes page 1
        // (pageOrder[0] is the new page's index) and the originals
        // shift right by one.
        // DEF-122 — the dialog's `position` is the 0-based rank slot
        // the new page becomes (field value v -> slot v - 1; -1 =
        // append). The engine's `insertBlankPage` consumes an
        // `afterIndex` (0-based index AFTER which to insert; -1 =
        // append per DEF-114), so the two contracts are offset by
        // one: a rank slot S maps to afterIndex S - 1, slot 0 maps to
        // the -2 prepend sentinel, and the append sentinel passes
        // straight through. Field "2" (slot 1) therefore becomes
        // afterIndex 0 — the blank lands between page 1 and page 2,
        // i.e. after page 1, becoming page 2.
        const afterIndex =
          choice.position === 0
            ? -2
            : choice.position < 0
              ? -1
              : choice.position - 1;
        res = await engineRef.current.insertBlankPage(
          open.session.engineDocId,
          afterIndex,
          width,
          height,
        );
      } else {
        // insertFromPdf consumes the slot directly (position is the
        // 0-based index at which the copied pages start inserting).
        if (choice.otherBytes === undefined) {
          setInsertPagesOpen(false);
          return;
        }
        res = await engineRef.current.insertFromPdf(
          open.session.engineDocId,
          choice.otherBytes,
          choice.position,
        );
      }
      setInsertPagesOpen(false);
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      // After an insert the pageCount can change and the modified flag
      // flips — push through noteOpApplied so the rail / thumbnail /
      // toolbar refresh. The engine echoes the updated EngineState in
      // res.value.
      const isReal = !engineRef.current.available;
      if (isReal) {
        noteOpApplied(activeId, res.value);
      } else {
        // Stub path: refresh by re-querying state.
        const stateResult = await engineRef.current.getState(open.session.engineDocId);
        if (stateResult.ok) noteOpApplied(activeId, stateResult.value);
      }
      // B17 / B19 — both insert paths (blank page + pages from
      // another PDF) mutate page content. The engine writes a new
      // page / range of pages into its pdfDoc; the renderer's
      // `doc` proxy still points at the pre-insert bytes and shows
      // the wrong pageCount until rebuilt. Refresh the proxy via
      // the Phase 11 hook so the inserted pages render at the
      // correct viewport and the search / annotations / forms /
      // signatures layers see the updated document.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      pushToast(
        "info",
        choice.mode === "blank"
          ? "Inserted blank page."
          : "Inserted pages from PDF.",
      );
    },
    [noteOpApplied, pushToast],
  );

  // ---- Phase 12: residual page-organize + annotate parity ----

  /** Phase 12 — open the Replace-pages dialog. Lazy-load the page
   *  sizes for the active doc (used by the Crop dialog, not Replace,
   *  but we share the same seed function so the dialog opens
   *  instantly). */
  const onReplacePagesClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setReplacePagesOpen(true);
  }, []);

  const onCancelReplacePages = useCallback((): void => {
    setReplacePagesOpen(false);
  }, []);

  const onReplacePagesConfirm = useCallback(
    async (choice: {
      otherBytes: Uint8Array;
      otherPath: string;
      targetRange: [number, number];
    }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setReplacePagesOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const res = await engineRef.current.replacePages?.(
        open.session.engineDocId,
        choice.otherBytes,
        choice.targetRange,
      );
      if (res === undefined) {
        pushToast(
          "error",
          describeEngineError("engine-error", "Replace pages requires the Phase 12 backend update."),
        );
        return;
      }
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      noteOpApplied(activeId, res.value);
      // B14 / B16 / B19 — replace mutates page content: the engine
      // swaps the target range with the new PDF's pages in its
      // pdfDoc. The renderer's `doc` proxy still points at the
      // pre-replace bytes; without a refresh every PageView on the
      // affected pages continues to render at the un-replaced
      // viewport, and annotations / form fields / signatures on
      // surviving pages stay at their old positions. Rebuild the
      // proxy via the Phase 11 refresh hook.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      pushToast(
        "info",
        `Replaced pages ${choice.targetRange[0] + 1}-${choice.targetRange[1] + 1}.`,
      );
    },
    [noteOpApplied, pushToast],
  );

  /** Phase 12 — open the Renumber-pages dialog. The dialog seeds
   *  itself from the engine state's pageLabels so the user sees
   *  their previous choice. */
  const onRenumberPagesClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setRenumberPagesOpen(true);
  }, []);

  const onCancelRenumberPages = useCallback((): void => {
    setRenumberPagesOpen(false);
  }, []);

  const onRenumberPagesConfirm = useCallback(
    async (choice: { labels: { page: number; label: string }[] }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setRenumberPagesOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      // Filter sparse entries (empty labels are omitted by the dialog)
      // and translate to the engine's wire shape (PageLabelEntry).
      const entries: PageLabelEntry[] = choice.labels.map((l) => ({
        page: l.page,
        label: l.label,
      }));
      const res = await engineRef.current.renumberPages?.(
        open.session.engineDocId,
        entries,
      );
      if (res === undefined) {
        pushToast(
          "error",
          describeEngineError("engine-error", "Renumber pages requires the Phase 12 backend update."),
        );
        return;
      }
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      noteOpApplied(activeId, res.value);
      pushToast("info", `Applied ${entries.length} page label${entries.length === 1 ? "" : "s"}.`);
    },
    [noteOpApplied, pushToast],
  );

  /** Phase 12 — open the Crop-pages dialog. Lazy-load the page
   *  sizes for the active doc so the per-page preview is accurate. */
  const onCropPagesClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setCropPagesOpen(true);
    void seedActivePageSizes();
  }, []);

  const onCancelCropPages = useCallback((): void => {
    setCropPagesOpen(false);
  }, []);

  const onCropPagesConfirm = useCallback(
    async (choice: { entries: { page: number; box: { x: number; y: number; width: number; height: number } }[] }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setCropPagesOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const res = await engineRef.current.cropPages?.(
        open.session.engineDocId,
        choice.entries,
      );
      if (res === undefined) {
        pushToast(
          "error",
          describeEngineError("engine-error", "Crop pages requires the Phase 12 backend update."),
        );
        return;
      }
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      noteOpApplied(activeId, res.value);
      // DEF-062 — the engine writes the new CropBox / TrimBox to its
      // copy of the doc, but the renderer's `doc` proxy still points
      // at the pre-crop bytes. Without a refresh, every PageView on
      // the affected pages continues to render at the pre-crop
      // dimensions (the un-cropped viewport, then the un-cropped
      // annotations + form fields + signatures layer laid out over
      // it). Rebuild the proxy in place via the Phase 11 refresh
      // hook — same pattern OCR uses after it writes the invisible
      // text layer. The `doc` identity change cascades through
      // DocumentView's `useEffect([doc])` deps so the search effect
      // and any doc-bound effect re-run against the post-crop
      // bytes. If the backend predates Phase 11 (no `getDocumentBytes`),
      // `refreshed` is false and the user can save + reopen to pick
      // up the new dimensions — same fallback as the OCR path.
      // The function is read through `refreshDocProxyForRef` because
      // it's defined later in the component (forward-declared ref
      // pattern, see the ref's declaration at the top of the file).
      //
      // Bug 7 (visual half): guard the optional chain so a stale
      // null ref (first render, post-unmount) does not throw a
      // TypeError on `.catch()` of an undefined return — only
      // attach the catch when the function reference is present.
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
pushToast(
        "info",
        `Cropped ${choice.entries.length} page${choice.entries.length === 1 ? "" : "s"}.`,
      );
    },
    [noteOpApplied, pushToast],
  );

  /** Lazy-load per-page viewport sizes for the active doc so the
   *  Crop dialog can draw an accurate preview per page. Uses
   *  pdf.js's `getPage().getViewport({scale:1})` — the same call
   *  the renderer uses for display. Idempotent: subsequent calls
   *  just overwrite the cache. */
  const seedActivePageSizes = useCallback(async (): Promise<void> => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    const sizes: Record<number, { widthPt: number; heightPt: number }> = {};
    for (let p = 1; p <= open.session.doc.numPages; p += 1) {
      try {
        const page = await open.session.doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        sizes[p] = { widthPt: vp.width, heightPt: vp.height };
      } catch {
        // Defensive: skip pages we can't read. The dialog falls
        // back to US Letter dimensions when a page is missing.
      }
    }
    setActivePageSizes(sizes);
  }, []);

  /** Phase 12 — open the Stamp dialog. The dialog confirms with
   *  the renderer-drawn PNG raster; we stash the raster in
   *  `armedStamp` and wait for the next page click to place it
   *  (B10 click-to-embed flow). The dialog's "Place on page" button
   *  no longer bakes the stamp directly — instead it arms the
   *  stamp so the next page click embeds it at the cursor point.
   *  Esc / a second Stamp toolbar click disarms. */
  const onStampClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    if (armedStampRef.current !== null) {
      // Already armed — toggle off.
      setArmedStamp(null);
      return;
    }
    // Cross-arming guard — mirror of `onSignButton` above. If
    // the Sign tool is armed, the user would otherwise see both
    // the stamp ghost and the signatures crosshair at once. Tear
    // down the signatures arm first so only one tool is active
    // at a time.
    if (armedSignatureIdRef.current !== null) {
      setArmedSignatureId(null);
    }
    setStampOpen(true);
  }, []);

  const onCancelStamp = useCallback((): void => {
    setStampOpen(false);
  }, []);

  const onStampConfirm = useCallback(
    (choice: {
      stampId: StampId;
      pngBytes: Uint8Array;
      pngWidth: number;
      pngHeight: number;
      page: number;
    }): void => {
      setStampOpen(false);
      // B10 — arm the stamp instead of immediately embedding. The
      // ghost overlay appears on every page and follows the
      // cursor; the next click on a page embeds the stamp at the
      // click point. The dialog's `page` field is ignored in the
      // click-to-place flow — the click wins, the dialog's page
      // is just a default-size hint. We retain the page count
      // (via `size`) so the ghost's default width / height match
      // what the embedded stamp would have been on the dialog's
      // picked page.
      void choice.page;
      setArmedStamp({
        stampId: choice.stampId,
        pngBytes: choice.pngBytes,
        pngWidth: choice.pngWidth,
        pngHeight: choice.pngHeight,
      });
      pushToast(
        "info",
        `Click a page to place the ${choice.stampId} stamp. Press Esc to cancel.`,
      );
    },
    [pushToast],
  );

  /** B10 — handle a stamp click on a page. Resolves the click
   *  point in page-space, computes the stamp's rect, and calls
   *  `engine.addStamp`. On success the proxy is refreshed (same
   *  pattern as the old centered flow) and the armed stamp is
   *  cleared. */
  const onPlaceStamp = useCallback(
    async (args: {
      stampId: StampId;
      pngBytes: Uint8Array;
      pngWidth: number;
      pngHeight: number;
      page: number;
      atPt: { x: number; y: number };
    }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const size = activePageSizes[args.page] ?? {
        widthPt: 612,
        heightPt: 792,
      };
      const aspect =
        args.pngHeight === 0 ? 1 : args.pngWidth / args.pngHeight;
      const targetHeightPt = Math.min(80, size.heightPt * 0.12);
      const targetWidthPt = Math.max(
        120,
        Math.min(size.widthPt * 0.4, targetHeightPt * aspect),
      );
      // Anchor the stamp so the click point lands at the stamp's
      // top-left corner, with a small visual inset so the click
      // point sits inside the stamp body rather than on its edge.
      const x = Math.max(
        0,
        Math.min(size.widthPt - targetWidthPt, args.atPt.x),
      );
      const y = Math.max(
        0,
        Math.min(size.heightPt - targetHeightPt, args.atPt.y),
      );
      const rect = {
        x,
        y,
        width: targetWidthPt,
        height: targetHeightPt,
      };
      const res = await engineRef.current.addStamp?.(
        open.session.engineDocId,
        {
          page: args.page,
          rect,
          stampId: args.stampId,
          name: args.stampId,
          pngBytes: args.pngBytes,
        },
      );
      if (res === undefined) {
        pushToast(
          "error",
          describeEngineError("engine-error", "Stamp requires the Phase 12 backend update."),
        );
        return;
      }
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      noteOpApplied(activeId, res.value);
      // B10 / DEF-101 — record the placement for the `.stamp-annotation`
      // DOM surface. The engine bakes the pixels into the page
      // bitmap; this mirror makes the placement visible/verifiable
      // in the renderer (and gives QA a stable selector). Keyed by
      // the active tab; pruned on tab close.
      setPlacedStampsByTab((prev) => {
        const existing = prev[activeId] ?? [];
        return {
          ...prev,
          [activeId]: [
            ...existing,
            {
              id: crypto.randomUUID(),
              stampId: args.stampId,
              page: args.page,
              rect,
              pngBytes: args.pngBytes,
              pngWidth: args.pngWidth,
              pngHeight: args.pngHeight,
            },
          ],
        };
      });
      // B10 / B19 — refresh the proxy so the baked stamp is
      // visible without a save+reopen cycle (same pattern as
      // crop / merge / replace / OCR / flatten).
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      setArmedStamp(null);
      pushToast(
        "info",
        `Placed ${args.stampId} stamp on page ${args.page}.`,
      );
    },
    [activePageSizes, noteOpApplied, pushToast],
  );

  /** Bug 6 — MOVE / RESIZE a placed stamp. The engine bakes stamps
   *  into the page bitmap with no registry, so the only lever is the
   *  Phase 10 `editImage` contract: mask the OLD rect with white and
   *  draw the stamp's PNG at the NEW rect (the documented
   *  visual-redact-and-redraw behavior — same as editTextRun / the
   *  pre-registry text-box move). On success the mirror entry's rect
   *  is updated and the proxy refreshed so the canvas shows the
   *  re-baked position. */
  const onMoveStamp = useCallback(
    async (tabId: string, id: string, rect: { x: number; y: number; width: number; height: number }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const stamps = placedStampsByTabRef.current[tabId] ?? [];
      const stamp = stamps.find((s) => s.id === id);
      if (stamp === undefined) {
        pushToast("error", `Could not move stamp: unknown placement ${id}.`);
        return;
      }
      const result = await engineRef.current.editImage(
        open.session.engineDocId,
        {
          page: stamp.page,
          op: "move",
          oldRect: stamp.rect,
          newRect: rect,
          imageBytes: stamp.pngBytes,
        },
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      updatePlacedStampRect(tabId, id, rect);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** Bug 6 — DELETE a placed stamp. Masks the stamp's rect with a
   *  solid-white raster via the same `editImage` lever (the stamp
   *  pixels are covered — the documented Phase-10 visual-redact
   *  behavior; content beneath the stamp is covered too, the known
   *  tradeoff of the bake-only stamp surface) and drops the mirror
   *  entry so the DOM surface disappears immediately. */
  const onDeleteStamp = useCallback(
    async (tabId: string, id: string): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const stamps = placedStampsByTabRef.current[tabId] ?? [];
      const stamp = stamps.find((s) => s.id === id);
      if (stamp === undefined) {
        pushToast("error", `Could not delete stamp: unknown placement ${id}.`);
        return;
      }
      const result = await engineRef.current.editImage(
        open.session.engineDocId,
        {
          page: stamp.page,
          op: "move",
          oldRect: stamp.rect,
          newRect: stamp.rect,
          imageBytes: WHITE_1X1_PNG_BYTES,
        },
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      setPlacedStampsByTab((prev) => {
        const list = prev[tabId] ?? [];
        if (!list.some((s) => s.id === id)) return prev;
        const next = { ...prev, [tabId]: list.filter((s) => s.id !== id) };
        return next;
      });
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  /** Bug 6 — RETYPE a placed stamp (the "Edit" verb: change
   *  APPROVED -> DRAFT / CONFIDENTIAL / FINAL). Re-rasterises the
   *  new stamp id, masks the old rect and draws the fresh PNG at the
   *  same rect via editImage, then updates the mirror's stamp id +
   *  raster so the DOM surface matches. */
  const onRetypeStamp = useCallback(
    async (tabId: string, id: string, stampId: StampId): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const stamps = placedStampsByTabRef.current[tabId] ?? [];
      const stamp = stamps.find((s) => s.id === id);
      if (stamp === undefined) {
        pushToast("error", `Could not edit stamp: unknown placement ${id}.`);
        return;
      }
      if (stamp.stampId === stampId) return;
      const png = rasterizeStamp(stampId);
      const result = await engineRef.current.editImage(
        open.session.engineDocId,
        {
          page: stamp.page,
          op: "move",
          oldRect: stamp.rect,
          newRect: stamp.rect,
          imageBytes: png.pngBytes,
        },
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      setPlacedStampsByTab((prev) => {
        const list = prev[tabId] ?? [];
        if (!list.some((s) => s.id === id)) return prev;
        return {
          ...prev,
          [tabId]: list.map((s) =>
            s.id === id
              ? { ...s, stampId, pngBytes: png.pngBytes, pngWidth: png.width, pngHeight: png.height }
              : s,
          ),
        };
      });
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(tabId).catch(() => undefined);
      }
    },
    [pushToast, noteOpApplied],
  );

  const armedStampRef = useRef(armedStamp);
  armedStampRef.current = armedStamp;
  // Mirror ref for `armedSignatureId` so `onStampClick` can read
  // the latest arm state without taking it as a useCallback
  // dependency. Same forward-declared-ref pattern as
  // `armedStampRef` above and `activeTabIdRefLocal` higher up.
  // Without this, `onStampClick` would have to depend on
  // `armedSignatureId` and be re-created on every signature arm,
  // which the toolbar's stable listener doesn't need.
  const armedSignatureIdRef = useRef(armedSignatureId);
  armedSignatureIdRef.current = armedSignatureId;

  /** Phase 12 — open the Comment-export dialog. The dialog calls
   *  `engine.exportFdf` and hands the bytes to a host-side OS save
   *  dialog. */
  const onCommentExportClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setCommentExportOpen(true);
  }, []);

  const onCancelCommentExport = useCallback((): void => {
    setCommentExportOpen(false);
  }, []);

  const onCommentExportConfirm = useCallback(
    (result: { path: string; annotationCount: number }): void => {
      setCommentExportOpen(false);
      pushToast(
        "info",
        `Exported ${result.annotationCount} comment${result.annotationCount === 1 ? "" : "s"} to ${result.path}.`,
      );
    },
    [pushToast],
  );

  /** Phase 12 — open the Comment-import dialog. The dialog calls
   *  a host-side OS open dialog for the .fdf file, then calls
   *  `engine.importFdf`. */
  const onCommentImportClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setCommentImportOpen(true);
  }, []);

  const onCancelCommentImport = useCallback((): void => {
    setCommentImportOpen(false);
  }, []);

  const onCommentImportConfirm = useCallback(
    (result: { path: string; annotationCount: number }): void => {
      setCommentImportOpen(false);
      // Force a refresh of the active tab's engine state so the
      // newly merged annotations show up in the Annotations panel
      // + on-page overlays. We could try to read the result value
      // off the engine directly, but the dialog already routed it
      // through `noteOpApplied`. Here we just refresh from state.
      pushToast(
        "info",
        `Imported ${result.annotationCount} comment${result.annotationCount === 1 ? "" : "s"} from ${result.path}.`,
      );
    },
    [pushToast],
  );

  // ---- Phase 12: Delete pages dialog (B8) ----

  /** Open the B8 delete pages dialog against the active tab. The
   *  toolbar / Tools palette both funnel through this; the rail's
   *  per-thumb delete still uses `onDelete(tabId, [page])`
   *  directly (no dialog) for the single-thumb case. */
  const onDeletePageClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setDeletePageOpen(true);
  }, []);

  const onCancelDeletePage = useCallback((): void => {
    setDeletePageOpen(false);
  }, []);

  const onDeletePageConfirm = useCallback(
    (choice: { mode: "current" | "range"; pages: number[] }): void => {
      setDeletePageOpen(false);
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      if (choice.pages.length === 0) return;
      void applyEngineOp(activeId, { kind: "delete", pages: choice.pages });
      pushToast(
        "info",
        `Deleted ${choice.pages.length} page${choice.pages.length === 1 ? "" : "s"}.`,
      );
    },
    [applyEngineOp, pushToast],
  );

  // ---- Phase 11: OCR (recognize text) ----

  /** Open the OCR dialog against the active tab. The toolbar /
   *  Tools palette / "Recognize Text" menu entry all funnel through
   *  this. */
  const onOcrClick = useCallback((): void => {
    disarmActiveDocView();
    if (activeTabIdRefLocal.current === null) return;
    setOcrOpen(true);
  }, []);

  const onCancelOcr = useCallback((): void => {
    setOcrOpen(false);
  }, []);

  // DEF-050 — per-tab search-index invalidator. DocumentView registers
  // a callback that clears its cached per-page `PageTextIndex` map and
  // bumps a state tick so the search effect re-runs even when `query`,
  // `doc`, and `pageCount` are unchanged. We call the invalidator from
  // `onOcrConfirm` after a successful OCR run (and from `onBatchOcr`
  // for each tab it processes), so the next `Ctrl+F` search rebuilds
  // the per-page index from current `pdf.js` `getTextContent()` calls
  // rather than returning pre-OCR cached entries.
  //
  // Keyed by tabId because each tab has its own DocumentView instance
  // (and its own `indexesRef`). The invalidator ref holds one entry
  // per tab; `registerSearchIndexInvalidatorFor` writes the callback
  // the matching DocumentView passed in, `invalidateSearchIndexFor`
  // looks it up by tabId and invokes it.
  const searchIndexInvalidatorsRef = useRef(new Map<string, () => void>());
  const registerSearchIndexInvalidatorFor = useCallback(
    (tabId: string, fn: () => void): void => {
      searchIndexInvalidatorsRef.current.set(tabId, fn);
    },
    [],
  );
  const invalidateSearchIndexFor = useCallback((tabId: string): void => {
    searchIndexInvalidatorsRef.current.get(tabId)?.();
  }, []);

  // DEF-050 — rebuild the renderer's pdf.js proxy in-place after a
  // content-stream mutation the engine wrote that the original load
  // bytes no longer reflect. OCR is the primary caller: the engine
  // writes an invisible Tr=3 text layer onto each page, and the
  // renderer's `doc` proxy still points at the pre-OCR bytes until
  // the user Saves and reopens. We call `engine.getDocumentBytes`
  // (the "render-to-refresh hook" backend shipped for Phase 11),
  // parse the fresh bytes with `openPdfDocument`, destroy the old
  // proxy, and swap the new one into `openTabs[id].session.doc`.
  // The new `doc` identity cascades through DocumentView's
  // `useEffect([doc])` deps, so the first-page-dims fetch, the
  // search effect, and any other doc-bound effect re-run afresh.
  //
  // Returns true on success, false on any failure (no active tab,
  // backend missing the hook, or pdf.js parse error). Failures
  // fall through to a soft toast — the existing search invalidator
  // still keeps the index map from serving pre-OCR entries, so the
  // search hit experience degrades gracefully rather than crashing.
  const refreshDocProxyFor = useCallback(
    async (tabId: string): Promise<boolean> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return false;
      // No backend hook yet (pre-Phase-11 engine / stub) — nothing
      // we can do beyond the search-index invalidator below.
      if (engineRef.current.getDocumentBytes === undefined) {
        return false;
      }
      const bytesRes = await engineRef.current.getDocumentBytes(
        open.session.engineDocId,
      );
      if (!bytesRes.ok) {
        pushToast(
          "error",
          `Could not refresh document proxy: ${describeEngineError(bytesRes.error.code, bytesRes.error.message)}`,
        );
        return false;
      }
      const bytes = toArrayBuffer(bytesRes.value);
      const parsed = await openPdfDocument(bytes);
      if (!("doc" in parsed)) {
        pushToast(
          "error",
          `Could not refresh document proxy: ${toastForPdfError(parsed.error, open.displayName)}`,
        );
        return false;
      }
      const oldDoc = open.session.doc;
      setOpenTabs((prev) => {
        const existing = prev[tabId];
        if (existing === undefined) {
          // Tab closed between the read and the set; the new
          // proxy is orphaned. Destroy it and bail.
          void parsed.doc.destroy().catch(() => undefined);
          return prev;
        }
        return {
          ...prev,
          [tabId]: {
            ...existing,
            session: {
              ...existing.session,
              doc: parsed.doc,
              fileSize: bytes.byteLength,
              // DEF-139 — `getDocumentBytes` runs the engine's
              // `serializeDoc`, which writes the output file in the
              // engine's VISIBLE order (`pageOrder` sequence). The
              // swapped-in proxy is therefore a visible-order proxy:
              // from here on the renderer maps visible slot N to
              // `doc.getPage(N)` directly (see
              // `visibleToSourcePageForProxy` / `proxyVisibleOrder`).
              proxyVisibleOrder: true,
            },
          },
        };
      });
      // The `doc` prop on DocumentView changed identity, which
      // re-runs every doc-bound useEffect. Destroy the old proxy
      // after the swap commits so any in-flight per-page cleanup
      // hooks (PageView's own `pdfPage.cleanup()` on unmount) can
      // run before pdf.js tears the document down.
      void oldDoc.destroy().catch(() => undefined);
      // DEF-166 — the swapped-in bytes come from the engine's
      // `getDocumentBytes`, which serializes EVERY current annotation
      // into the output /Annots. From this point the page canvas
      // paints every annotation's baked appearance, so no id keeps a
      // live overlay text: drop the tab's live set (the next create /
      // edit re-seeds it). A fresh open tab has no entry at all.
      liveAnnTextIdsRef.current.delete(tabId);
      return true;
    },
    [pushToast, toastForPdfError],
  );
  // Mirror the latest reference into the forward-declared ref so
  // early callers (e.g. onCropPagesConfirm at line ~2480) can read it
  // without temporal-dead-zone complaints and without taking a dep on
  // the useCallback identity (DEF-062).
  refreshDocProxyForRef.current = refreshDocProxyFor;

  /** Resolve the active pdf.js document proxy for the OCR dialog.
   *  Returns null when no tab is active (the dialog should not be
   *  open in that case; we guard anyway). */
  const resolveActiveDocForOcr = useCallback((): import("pdfjs-dist").PDFDocumentProxy | null => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return null;
    const open = openTabsRef.current[activeId];
    return open?.session.doc ?? null;
  }, []);

  /** Subscribe to OCR progress events. Returns an unsubscribe
   *  function. Routes through the engine client so the dialog sees
   *  a unified surface. */
  const subscribeOcrProgress = useCallback(
    (cb: (p: OcrProgress) => void): (() => void) => {
      // The Phase 11 progress channel is optional on the engine
      // surface. Guard the call site so a pre-Phase-11 backend
      // doesn't crash the renderer; the dialog treats a no-op
      // unsubscribe as "engine doesn't surface progress", and
      // the per-page progress still advances through the
      // renderer's own rasterisation step.
      if (engineRef.current.onOcrProgress === undefined) {
        return (): void => undefined;
      }
      return engineRef.current.onOcrProgress(cb);
    },
    [],
  );

  /** Run engine.ocrRecognize against the active tab. Returns the
   *  engine's echo on success, OR an error string. We follow up
   *  with engine.ocrSuspects on success to populate the suspects
   *  panel without a separate dialog interaction. */
  const runOcrForActiveTab = useCallback(
    async (
      options: OcrRecognizeOptions,
    ): Promise<{ ok: true; suspects: OcrSuspect[] } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.ocrRecognize(
        open.session.engineDocId,
        options,
      );
      if (!result.ok) {
        return {
          error: describeEngineError(result.error.code, result.error.message),
        };
      }
      // Refresh the active tab's engine state mirror so any
      // renderer-side readers (annotation overlays, undo counters)
      // see the engine's authoritative post-OCR view.
      noteOpApplied(activeId, result.value);
      // Fetch the suspect list. ocrSuspects returns
      // engine-error when the backend hasn't been upgraded; the
      // dialog already surfaces that as an error toast, so we
      // gracefully degrade here.
      const suspectsResult = await engineRef.current.ocrSuspects(
        open.session.engineDocId,
      );
      const suspects = suspectsResult.ok ? suspectsResult.value : [];
      return { ok: true, suspects };
    },
    [noteOpApplied],
  );

  /** Dialog confirm: the dialog has already routed the engine
   *  call; we close the dialog and surface a toast with the
   *  suspect count, then auto-open the suspects panel so the user
   *  can browse the results without a second click. */
  const onOcrConfirm = useCallback(
    (result: OcrDialogConfirm): void => {
      setOcrOpen(false);
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      setOcrSuspectsByTab((prev) => ({
        ...prev,
        [activeId]: result.suspects,
      }));
      setOcrRunByTab((prev) => ({
        ...prev,
        [activeId]: true,
      }));
      setOcrSuspectsOpen(true);
      // DEF-050 — OCR writes an invisible Tr=3 text layer onto each
      // page in the engine's copy of the doc. The renderer's `doc`
      // proxy still reflects the pre-OCR bytes until the proxy is
      // rebuilt, so the next Ctrl+F search would walk pre-OCR items
      // and miss every OCR word. We rebuild the proxy in place via
      // `engine.getDocumentBytes` (the Phase 11 refresh hook) and
      // `openPdfDocument`: parse the fresh bytes, destroy the old
      // proxy, swap the new one into the same tab. The `doc` prop
      // identity change cascades through DocumentView's
      // `useEffect([doc])` deps so the search effect re-runs against
      // post-OCR items — no new tab, no Save required to see OCR
      // words. The search-index invalidator is still called as a
      // belt-and-braces guard for the case where the backend doesn't
      // expose the refresh hook.
      void refreshDocProxyFor(activeId).then((refreshed) => {
        if (!refreshed) {
          invalidateSearchIndexFor(activeId);
        }
      });
      const suspectCount = result.suspects.length;
      const scopeLabel: OcrScope = result.scope;
      const pageLabel = scopeLabel === "currentPage"
        ? "current page"
        : `${result.pages.length} pages`;
      const verdict = suspectCount === 0
        ? "no low-confidence words"
        : `${suspectCount} low-confidence ${suspectCount === 1 ? "word" : "words"}`;
      pushToast(
        "info",
        `Recognized text on ${pageLabel}: ${verdict}. Save the document to keep the searchable layer.`,
      );
    },
    [invalidateSearchIndexFor, pushToast, refreshDocProxyFor],
  );

  /** Navigate to a suspect's page and pulse a short-lived
   *  highlight so the user can spot the word on the page. The
   *  navigation lands on the page; the highlight is a UI
   *  affordance we surface through the existing page-jump
   *  mechanism. The suspects panel does not edit text (the
   *  correction flow is out of contract for Phase 11). */
  const onSuspectNavigate = useCallback(
    (suspect: OcrSuspect): void => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      // Persist the navigation target so DocumentView's per-tab
      // `currentPage` advances to the suspect's page on next
      // render. We use `setOpenTabs` directly because the tab is
      // already active — the page input updates synchronously.
      setOpenTabs((prev) => {
        const existing = prev[activeId];
        if (existing === undefined) return prev;
        return {
          ...prev,
          [activeId]: {
            ...existing,
            persisted: {
              ...existing.persisted,
              currentPage: suspect.page,
            },
          },
        };
      });
      // Also push to the diagnostics store so any consumer that
      // reads currentPage from there sees the new value.
      setDiagnostics((prev) => ({
        ...prev,
        currentPage: suspect.page,
      }));
      // Push a transient toast naming the suspect so the user
      // can correlate the click with the word on the page.
      pushToast(
        "info",
        `Navigated to page ${suspect.page} — "${suspect.word}" (${suspect.confidence.toFixed(0)}% confidence).`,
      );
    },
    [pushToast],
  );

  /** Batch OCR — runs OCR against every open tab in turn. The
   *  Tools palette's batch entry calls this. We surface a single
   *  toast per tab so the user sees the progress without a modal
   *  dialog overlay; the dialog remains available for the per-doc
   *  user-driven flow. */
  const onBatchOcr = useCallback(async (): Promise<void> => {
    const tabIds = Object.keys(openTabsRef.current);
    if (tabIds.length === 0) {
      pushToast("info", "No documents open for batch OCR.");
      return;
    }
    let completed = 0;
    for (const tabId of tabIds) {
      const open = openTabsRef.current[tabId];
      if (open === undefined) continue;
      const doc = open.session.doc;
      const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);
      const downsample = settingsRef.current?.ocrDownsample ?? DEFAULT_OCR_DOWNSAMPLE;
      const language = settingsRef.current?.ocrLanguage ?? DEFAULT_OCR_LANGUAGE;
      try {
        // Rasterise every page through the same renderer-side
        // helper the dialog uses, then send to the engine. The
        // tab's current form values are seeded into pdf.js's
        // AnnotationStorage first so typed form text ("John Doe")
        // and checkbox/radio state are visible to tesseract
        // (DEF-112).
        const pageImages = await rasterizePagesForOcr({
          doc,
          pages,
          dpi: downsample,
          formFields: open.forms.fields,
        });
        const result = await engineRef.current.ocrRecognize(
          open.session.engineDocId,
          { language, downsample, pageImages },
        );
        if (!result.ok) {
          pushToast(
            "error",
            `OCR failed on "${open.displayName}": ${describeEngineError(result.error.code, result.error.message)}`,
          );
          continue;
        }
        noteOpApplied(tabId, result.value);
        const suspects = await engineRef.current.ocrSuspects(
          open.session.engineDocId,
        );
        const suspectList = suspects.ok ? suspects.value : [];
        setOcrSuspectsByTab((prev) => ({ ...prev, [tabId]: suspectList }));
        setOcrRunByTab((prev) => ({ ...prev, [tabId]: true }));
        // DEF-050 — rebuild this tab's pdf.js proxy in place so the
        // search effect's `useEffect([doc])` re-runs against the
        // post-OCR bytes. Same rationale as `onOcrConfirm`: OCR
        // writes an invisible Tr=3 text layer onto each page and
        // the renderer must observe it before the next Ctrl+F
        // search. Falls back to the cached index invalidator when
        // the backend doesn't expose the refresh hook.
        const refreshed = await refreshDocProxyFor(tabId);
        if (!refreshed) {
          invalidateSearchIndexFor(tabId);
        }
        completed += 1;
        pushToast(
          "info",
          `Recognized text on "${open.displayName}" (${pageImages.length} pages): ${suspectList.length} low-confidence ${suspectList.length === 1 ? "word" : "words"}.`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushToast(
          "error",
          `OCR failed on "${open.displayName}": ${msg}`,
        );
      }
    }
    if (completed > 0) {
      setOcrSuspectsOpen(true);
      pushToast(
        "info",
        `Batch OCR finished on ${completed} of ${tabIds.length} ${tabIds.length === 1 ? "document" : "documents"}.`,
      );
    }
  }, [invalidateSearchIndexFor, noteOpApplied, pushToast, refreshDocProxyFor]);

  const onCloseOcrSuspects = useCallback((): void => {
    setOcrSuspectsOpen(false);
  }, []);

  /** B11 — open the OCR suspects panel. The previous wiring
   *  (`setOcrSuspectsOpen(true)` from the Tools palette) ignored
   *  whether a document was actually open, so the user could
   *  click the button from the welcome screen / an empty tab
   *  and see nothing happen. The panel's render is also gated
   *  on `activeTabIdRefLocal.current !== null`, but the open
   *  flag would still flip — meaning a later open-doc step would
   *  surface a panel against an unrelated tab. We now require
   *  an active document AND a successful OCR run on that tab
   *  before opening; otherwise the button click is a no-op
   *  (matches the onOcrSuspects button's `hasOcrSuspects` gate
   *  in the Tools palette). */
  const onOpenOcrSuspects = useCallback((): void => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    if (ocrRunByTabRef.current[activeId] !== true) return;
    setOcrSuspectsOpen(true);
  }, []);

  // ---- Phase 12: FDF IO helpers ----

  /** Run the engine.exportFdf call against the active doc. Returns
   *  the FDF bytes + the current annotation count (we read the
   *  count from the engine state so the dialog's success toast
   *  matches what the engine actually wrote). */
  const runExportFdfForActiveTab = useCallback(async (): Promise<
    { bytes: ArrayBuffer; annotationCount: number } | { error: string }
  > => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return { error: "No active document." };
    const open = openTabsRef.current[activeId];
    if (open === undefined) return { error: "No active document." };
    if (engineRef.current.exportFdf === undefined) {
      return {
        error: describeEngineError(
          "engine-error",
          "Export FDF requires the Phase 12 backend update.",
        ),
      };
    }
    const result = await engineRef.current.exportFdf(open.session.engineDocId);
    if (!result.ok) {
      return { error: describeEngineError(result.error.code, result.error.message) };
    }
    const annotationCount = open.engine.annotations?.length ?? 0;
    return { bytes: result.value, annotationCount };
  }, []);

  /** Run the engine.importFdf call against the active doc. Returns
   *  the merged annotation count (the engine state's annotations
   *  array length after the import). */
  const runImportFdfForActiveTab = useCallback(
    async (
      bytes: Uint8Array,
    ): Promise<{ annotationCount: number } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      if (engineRef.current.importFdf === undefined) {
        return {
          error: describeEngineError(
            "engine-error",
            "Import FDF requires the Phase 12 backend update.",
          ),
        };
      }
      const result = await engineRef.current.importFdf(
        open.session.engineDocId,
        bytes,
      );
      if (!result.ok) {
        return { error: describeEngineError(result.error.code, result.error.message) };
      }
      noteOpApplied(activeId, result.value);
      const annotationCount = result.value.annotations?.length ?? 0;
      return { annotationCount };
    },
    [noteOpApplied],
  );

  /** Save FDF bytes to the user's chosen file. Uses the renderer-
   *  side `downloadBlob` helper (same path the Phase 9 export
   *  pipeline uses); the OS save dialog comes up through the
   *  browser's download attribute. Returns the saved path on
   *  success, null on cancel, or throws on IO error. The
   *  Electron renderer surfaces the path through Electron's
   *  `downloadItem.getSavePath()` API; for the renderer-only
   *  path we use `webUtils.getPathForFile` (Electron 30+) which
   *  exposes the path of a freshly downloaded File. */
  const saveFdfToFile = useCallback(
    async (
      bytes: ArrayBuffer,
      suggestedName: string,
    ): Promise<string | null> => {
      // The renderer-side `downloadBlob` returns true/false; the
      // path requires Electron's webUtils bridge (which is only
      // available in the preload). For the v1 flow we treat the
      // user's path as the suggested filename (since the OS save
      // dialog uses it as the default) — the download itself
      // writes to the chosen path via Electron's download manager.
      const blob = new Blob([bytes], { type: "application/vnd.adobe.fdf" });
      const accepted = downloadBlob(blob, suggestedName);
      if (!accepted) return null;
      // Best-effort path extraction. The preload may not expose
      // webUtils on every build; we degrade gracefully by returning
      // the suggested name as the "path" so the success toast still
      // tells the user where the file went.
      const webUtils = (
        window as unknown as {
          tflex?: {
            webUtils?: {
              getPathForFile?: (file: File) => string;
            };
          };
        }
      ).tflex?.webUtils;
      try {
        const file = new File([blob], suggestedName, {
          type: "application/vnd.adobe.fdf",
        });
        const path = webUtils?.getPathForFile?.(file);
        if (typeof path === "string" && path.length > 0) return path;
      } catch {
        // Fall through to the suggested-name fallback below.
      }
      return suggestedName;
    },
    [],
  );

  /** Open an OS file picker and read the chosen FDF file. Returns
   *  the picked file's bytes + path, or null on cancel. Uses the
   *  dedicated `openFileDialog('fdf')` so the OS dialog only shows
   *  `.fdf` files, and the dedicated `loadFdf` IPC so the backend's
   *  `%FDF-` header sniff (rather than `%PDF-`) reads the bytes.
   *  Routing through `loadPdf` here previously rejected every FDF
   *  file with `not-pdf`, making the picker silently return null
   *  (DEF-053). */
  const pickFdfFile = useCallback(async (): Promise<
    { bytes: Uint8Array; path: string } | null
  > => {
    const path = await window.tflex.openFileDialog("fdf");
    if (path === null) return null;
    const res = await window.tflex.loadFdf(path);
    if (!res.ok) return null;
    return { bytes: new Uint8Array(res.value), path };
  }, []);

  /** Reads the OS clipboard via the existing signatures IPC bridge
   *  is not appropriate (signatures save drawn signatures, not raw
   *  image bytes). Instead we expose a small renderer-side helper
   *  that uses the browser-standard `navigator.clipboard.read` /
   *  Electron's native `clipboard.readImage` / `clipboard.readText`.
   *  The helper falls back to `null` (empty / unsupported), which
   *  the dialog surfaces as "Clipboard is empty". */
  const readClipboard = useCallback(async (): Promise<
    Uint8Array | string | null | { error: string }
  > => {
    // Browser-side: navigator.clipboard is the only portable API.
    // Electron's renderer also exposes `electron.clipboard` via the
    // preload bridge; we use it when available so image bytes
    // survive (navigator.clipboard.read on images isn't universally
    // supported in Chromium yet).
    const electronClipboard = (
      window as unknown as {
        electron?: {
          clipboard?: {
            readImage?: () => { toPNG?: () => Uint8Array } | null;
            readText?: () => string;
            readBuffer?: (format: string) => Uint8Array;
          };
        };
      }
    ).electron?.clipboard;
    if (electronClipboard !== undefined) {
      try {
        const img = electronClipboard.readImage?.();
        if (img !== null && img !== undefined && typeof img.toPNG === "function") {
          const png = img.toPNG();
          if (png.length > 0) return png;
        }
        if (typeof electronClipboard.readBuffer === "function") {
          const buf = electronClipboard.readBuffer("image/png");
          if (buf.length > 0) return buf;
        }
        const text = electronClipboard.readText?.();
        if (typeof text === "string" && text.length > 0) return text;
      } catch {
        // fall through
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("image/png")) {
            const blob = await item.getType("image/png");
            return new Uint8Array(await blob.arrayBuffer());
          }
          if (item.types.includes("image/jpeg")) {
            const blob = await item.getType("image/jpeg");
            return new Uint8Array(await blob.arrayBuffer());
          }
          if (item.types.includes("text/plain")) {
            const blob = await item.getType("text/plain");
            return await blob.text();
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `Could not read clipboard: ${msg}` };
      }
    }
    return null;
  }, []);

  const onCreateFromClipboardConfirm = useCallback(
    async (choice: { content: Uint8Array | string; quality: number }): Promise<void> => {
      setCreateOpen(false);
      const docId = `create-clipboard-${crypto.randomUUID()}`;
      const result = await engineRef.current.createFromClipboard(
        docId,
        choice.content,
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Synthesise a display name from the content shape (text vs. image).
      const isText = typeof choice.content === "string";
      const displayName = isText
        ? "Created from clipboard text.pdf"
        : "Created from clipboard image.pdf";
      const opened = await openFromBytes(toArrayBuffer(result.value), {
        kind: "file",
        path: `<create-clipboard>${displayName}`,
        displayName,
        onDiskPath: null,
        dedupePath: false,
      });
      void choice.quality; // currently unused; engine.createFromClipboard doesn't take a quality
      if (opened !== null) {
        dispatchTabs({ type: "set-modified", id: opened.tabId, modified: true });
        pushToast("info", "Created PDF from clipboard content.");
      }
    },
    [openFromBytes, pushToast],
  );

  const searchIndexProgressRef = useRef<SearchIndexProgress | null>(null);

  const onDiagnosticsFor = useCallback(
    (tabId: string, d: Record<string, unknown>): void => {
      // DEF-097 — drop diagnostics publishes for tabs that are no
      // longer open. `closeTab` resets `activeTool: null` in the
      // mirror; the closing tab's DocumentView unmount (or a late
      // effect / async callback keyed to the closed id) may still
      // fire a diagnostics publish during the close commit. Without
      // this gate that publish re-spreads the stale tool over the
      // reset and the diagnostics surface keeps reporting the
      // closed tab's tool. `diagnosticsPublishAllowed` is the pure
      // helper (unit-tested); the ref read here keeps the decision
      // synchronous with the last committed openTabs.
      if (!diagnosticsPublishAllowed(openTabsRef.current, tabId)) {
        return;
      }
      const ip = d["searchIndexProgress"];
      if (ip === null || ip === undefined) {
        searchIndexProgressRef.current = null;
      } else if (typeof ip === "object") {
        const built = (ip as { built?: unknown }).built;
        const total = (ip as { total?: unknown }).total;
        if (typeof built === "number" && typeof total === "number") {
          searchIndexProgressRef.current = { built, total };
        }
      }
      setDiagnostics((prev) => ({ ...prev, ...d, _activeTab: tabId }));
    },
    [],
  );

  const persistFor = useMemo(() => {
    const cache = new Map<string, (v: PersistedViewer) => void>();
    return (tabId: string): ((v: PersistedViewer) => void) => {
      const existing = cache.get(tabId);
      if (existing !== undefined) return existing;
      const fn = (v: PersistedViewer): void => onPersist(tabId, v);
      cache.set(tabId, fn);
      return fn;
    };
  }, [onPersist]);

  const diagnosticsFor = useMemo(() => {
    const cache = new Map<
      string,
      { sampleCount: number; fn: (d: DocDiagnostics) => void }
    >();
    return (tabId: string): ((d: DocDiagnostics) => void) => {
      const existing = cache.get(tabId);
      if (existing !== undefined && existing.sampleCount === sampleCount) {
        return existing.fn;
      }
      const fn = (d: DocDiagnostics): void =>
        onDiagnosticsFor(tabId, { ...d, sampleCount });
      cache.set(tabId, { sampleCount, fn });
      return fn;
    };
  }, [onDiagnosticsFor, sampleCount]);

  const searchIndexProgressFor = useMemo(() => {
    const cache = new Map<string, (p: SearchIndexProgress | null) => void>();
    return (tabId: string): ((p: SearchIndexProgress | null) => void) => {
      const existing = cache.get(tabId);
      if (existing !== undefined) {
        return existing;
      }
      const fn = (p: SearchIndexProgress | null): void => {
        searchIndexProgressRef.current = p;
        setDiagnostics((prev) => ({ ...prev, searchIndexProgress: p }));
      };
      cache.set(tabId, fn);
      return fn;
    };
  }, []);

  // Per-tab engine callback wrappers. Keyed by tabId so DocumentView's
  // effects see stable function identities (the existing pattern in this
  // file).
  const engineFor = useMemo(() => {
    const cache = new Map<
      string,
      {
        engineState: EngineState;
        canUndo: boolean;
        canRedo: boolean;
        op?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
        deletePages?: (pages: number[]) => void;
        reorder?: (fromIndex: number, toIndex: number) => void;
        undo?: () => void;
      }
    >();
    return (tabId: string) => {
      const open = openTabs[tabId];
      const ui = engineUi[tabId];
      const cached = cache.get(tabId);
      const engineState = ui?.state ?? open?.engine ?? initialUiState(0).state;
      const canUndo = ui?.canUndo ?? false;
      const canRedo = ui?.canRedo ?? false;
      const fns = {
        engineState,
        canUndo,
        canRedo,
        op: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }): void =>
          onRotate(tabId, op.page, op.dir),
        deletePages: (pages: number[]): void => onDelete(tabId, pages),
        reorder: (fromIndex: number, toIndex: number): void =>
          onReorder(tabId, fromIndex, toIndex),
        undo: (): void => onUndo(tabId),
      };
      if (
        cached !== undefined &&
        cached.engineState === engineState &&
        cached.canUndo === canUndo &&
        cached.canRedo === canRedo
      ) {
        return cached;
      }
      const out = { ...fns };
      cache.set(tabId, out);
      return out;
    };
  }, [openTabs, engineUi, onDelete, onReorder, onRotate, onUndo]);

  const saveHandlers = useMemo(() => {
    const cache = new Map<string, { save: () => void; saveAs: () => void }>();
    return (tabId: string) => {
      const cached = cache.get(tabId);
      if (cached !== undefined) return cached;
      const out = {
        save: (): void => {
          void onSave(tabId);
        },
        saveAs: (): void => {
          void onSaveAs(tabId);
        },
      };
      cache.set(tabId, out);
      return out;
    };
  }, [onSave, onSaveAs]);

  // Per-tab annotation handler wrappers. Stable per tab so the DocumentView's
  // effects don't re-fire just because the parent re-rendered.
  const annotationHandlers = useMemo(() => {
    const cache = new Map<
      string,
      {
        annotations: Annotation[];
        liveAnnTextIds: ReadonlySet<string>;
        createAnnotation: (a: Annotation) => void;
        editAnnotation: (id: string, patch: AnnotationPatch) => void;
        deleteAnnotation: (id: string) => void;
      }
    >();
    return (tabId: string) => {
      const cached = cache.get(tabId);
      const ui = engineUi[tabId];
      const annotations: Annotation[] = ui?.state.annotations ?? [];
      const liveAnnTextIds = liveAnnTextIdsFor(tabId);
      if (
        cached !== undefined &&
        cached.annotations === annotations &&
        cached.liveAnnTextIds === liveAnnTextIds
      ) {
        return cached;
      }
      const out = {
        annotations,
        liveAnnTextIds,
        createAnnotation: (a: Annotation): void => {
          void onCreateAnnotation(tabId, a);
        },
        editAnnotation: (id: string, patch: AnnotationPatch): void => {
          void onEditAnnotation(tabId, id, patch);
        },
        deleteAnnotation: (id: string): void => {
          void onDeleteAnnotation(tabId, id);
        },
      };
      cache.set(tabId, out);
      return out;
    };
  }, [engineUi, onCreateAnnotation, onEditAnnotation, onDeleteAnnotation, liveAnnTextIdsFor]);

  // Per-tab forms + signatures handlers.
  const formsAndSignaturesHandlers = useMemo(() => {
    const cache = new Map<
      string,
      {
        formFields: FormField[];
        signatures: SignaturePlacement[];
        savedSignatures: SavedSignature[];
        armedSignatureId: string | null;
        onFormValueChange: (id: string, value: string | string[]) => void;
        onFormListboxToggle: (id: string, option: string) => void;
        onPlaceSignature: (signatureId: string, page: number, rect: SignaturePlacement["rect"]) => void;
        onMoveSignature: (placementId: string, rect: SignaturePlacement["rect"]) => void;
        onDeleteSignature: (placementId: string) => void;
        /** B1 — exit Sign mode. Wired to the pending action bar's
         *  Cancel button. The host clears `armedSignatureId`
         *  (the App is the source of truth for the crosshair /
         *  ghost preview). */
        onCancelSignatureArm: () => void;
      }
    >();
    return (tabId: string) => {
      const cached = cache.get(tabId);
      const tab = openTabs[tabId];
      const formFields: FormField[] = tab?.forms.fields ?? [];
      const signatures: SignaturePlacement[] = tab?.placements ?? [];
      // Reference-stable memoisation: only rebuild when any of these
      // inputs actually change.
      if (
        cached !== undefined &&
        cached.formFields === formFields &&
        cached.signatures === signatures &&
        cached.savedSignatures === savedSignatures &&
        cached.armedSignatureId === armedSignatureId
      ) {
        return cached;
      }
      const out = {
        formFields,
        signatures,
        savedSignatures,
        armedSignatureId,
        onFormValueChange: (id: string, value: string | string[]): void => {
          onFormValueChange(tabId, id, value);
        },
        onFormListboxToggle: (id: string, option: string): void => {
          onFormListboxToggle(tabId, id, option);
        },
        onPlaceSignature: (signatureId: string, page: number, rect: SignaturePlacement["rect"]): void => {
          void placeSignatureFull(tabId, signatureId, page, rect);
        },
        onMoveSignature: (placementId: string, rect: SignaturePlacement["rect"]): void => {
          void moveSignature(tabId, placementId, rect);
        },
        onDeleteSignature: (placementId: string): void => {
          void deleteSignature(tabId, placementId);
        },
        // B1/B2 — exit Sign mode. The pending action bar's
        // Confirm AND Cancel buttons call this (after a confirmed
        // placement the Sign session is over — the operator's
        // explicit requirement); the overlay's Delete does NOT
        // (the user is still placing signatures).
        onCancelSignatureArm: (): void => {
          setArmedSignatureId(null);
        },
      };
      cache.set(tabId, out);
      return out;
    };
  }, [
    openTabs,
    savedSignatures,
    armedSignatureId,
    onFormValueChange,
    onFormListboxToggle,
    placeSignatureFull,
    moveSignature,
    deleteSignature,
  ]);

  // ---- Phase 10: Edit-content handlers ----
  // Per-tab bag of Edit callbacks. Memoized with the same
  // reference-stable pattern as the other per-tab handlers so
  // PageView's props don't churn on every render. The pickImage
  // helper uses the renderer-side file picker — it returns null
  // on cancel so the overlay can silently no-op.
  const pickImage = useCallback(async (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> => {
    // Use a synthetic file input to keep the renderer pure (no
    // direct `dialog` access from this layer). Returns null when
    // the user cancels.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg";
      input.style.position = "fixed";
      input.style.left = "-10000px";
      const cleanup = (): void => {
        input.remove();
        window.removeEventListener("focus", onFocus);
      };
      const onFocus = (): void => {
        // The picker is closing; if the user picked a file the
        // change handler fires first, otherwise we resolve null
        // after a microtask.
        setTimeout(() => {
          // No-op: change handler resolves with the file. If
          // no file was picked, the cleanup also handles it.
        }, 0);
      };
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        cleanup();
        if (file === undefined) {
          resolve(null);
          return;
        }
        void file.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          const format = detectImageFormat(bytes);
          if (format === "unknown") {
            pushToast("error", "Unsupported image format. Use PNG or JPEG.");
            resolve(null);
            return;
          }
          resolve({ bytes, format });
        }).catch(() => {
          resolve(null);
        });
      });
      window.addEventListener("focus", onFocus);
      document.body.appendChild(input);
      input.click();
    });
  }, [pushToast]);

  const editHandlers = useMemo(() => {
    const cache = new Map<
      string,
      {
        state: EditState;
        onAction: (action: EditAction) => void;
        defaultFont: EditFont;
        onDefaultFontChange: (font: EditFont) => void;
        pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
        onCommitTextEdit: (args: {
          rect: { x: number; y: number; width: number; height: number };
          newText: string;
          style: EditTextStyle;
          oldRect?: { x: number; y: number; width: number; height: number };
        }) => void | Promise<void>;
        onCommitTextBox: (args: {
          rect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
        }) => void;
        onCommitImageEdit: (args: {
          op: "move" | "resize" | "replace" | "crop";
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          bytes: Uint8Array;
          format: "png" | "jpeg";
          id: string;
        }) => void;
        onCommitTextBoxMove: (args: {
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
          id: string;
        }) => void | Promise<void>;
        onDeleteTextBox: (id: string) => void;
      }
    >();
    return (tabId: string) => {
      const cached = cache.get(tabId);
      const tab = openTabs[tabId];
      if (tab === undefined) {
        return {
          state: initialEditState,
          onAction: (): void => undefined,
          defaultFont: "Helvetica" as EditFont,
          onDefaultFontChange: (): void => undefined,
          pickImage,
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
          onDeleteTextBox: (): void => undefined,
        };
      }
      if (cached !== undefined && cached.state === tab.edit) {
        return cached;
      }
      const out = {
        state: tab.edit,
        onAction: (action: EditAction): void => {
          setOpenTabs((prev) => {
            const t = prev[tabId];
            if (t === undefined) return prev;
            return {
              ...prev,
              [tabId]: { ...t, edit: editReducer(t.edit, action) },
            };
          });
        },
        defaultFont: settings?.editDefaultFont ?? "Helvetica",
        onDefaultFontChange: setEditDefaultFont,
        pickImage,
        onCommitTextEdit: (args: {
          rect: { x: number; y: number; width: number; height: number };
          newText: string;
          style: EditTextStyle;
          oldRect?: { x: number; y: number; width: number; height: number };
        }): void | Promise<void> => handleEditTextRun(tabId, args),
        onCommitTextBox: (args: {
          rect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
        }): void => {
          void handleAddTextBox(tabId, args);
        },
        onCommitImageEdit: (args: {
          op: "move" | "resize" | "replace" | "crop";
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          bytes: Uint8Array;
          format: "png" | "jpeg";
          id: string;
        }): void => {
          void handleEditImage(tabId, args);
        },
        onCommitTextBoxMove: (args: {
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
          id: string;
        }): Promise<void> => handleTextBoxMove(tabId, args),
        onDeleteTextBox: (id: string): void => {
          void handleTextBoxDelete(tabId, id);
        },
      };
      cache.set(tabId, out);
      return out;
    };
  }, [
    openTabs,
    settings?.editDefaultFont,
    pickImage,
    setEditDefaultFont,
    handleEditTextRun,
    handleAddTextBox,
    handleEditImage,
    handleTextBoxMove,
    handleTextBoxDelete,
  ]);

  // DEF-065 — push the active-doc snapshot to main on every
  // active-tab change so the application menu items
  // (Save / Save As / Close Tab / Undo / Redo) flip their
  // `.enabled` state in lock-step with the renderer's view. The
  // menu items are document-bound; with zero tabs open, the
  // "click Save and get a silent error" path was the original
  // bug. main looks each id up via
  // `Menu.getApplicationMenu()?.getMenuItemById(id)` and sets
  // `.enabled` accordingly. We push the snapshot after React
  // commits the active-id change so the effect's dep is stable.
  useEffect(() => {
    window.tflex.menu.setEnabled(
      snapshotMenuEnabled(tabs.activeId !== null),
    );
  }, [tabs.activeId]);

  activeTabIdRefLocal.current = tabs.activeId;

  const w = window as unknown as { tflexDiagnostics: () => unknown };
  w.tflexDiagnostics = (): unknown => {
    const activeId = activeTabIdRefLocal.current;
    const tabs2 = openTabsRef.current;
    const ui = engineUiRef.current;
    const tab = activeId !== null ? tabs2[activeId] ?? null : null;
    const livePageCount = tab?.session.doc.numPages ?? 0;

    // DEF-077 — tflexDiagnostics is a PURE read. No IPC, no React
    // state updates, no fire-and-forget `getState` poll. The previous
    // implementation scheduled a `getState` round-trip + a
    // `setEngineUiFor` dispatch on every call, which tripped
    // React-19's max-update-depth guard (Error #520) when an e2e
    // harness polled `tflexDiagnostics()` in a tight loop: each
    // scheduled dispatch queued more renders, the renderer ran out
    // of update budget, and the tree collapsed.
    //
    // Read priority: React `engineUi` mirror first (UI-handler-
    // fresh), engine adapter's `peekLastState` cache as the fallback.
    // The mirror is updated by every op-completion handler
    // (`noteOpApplied` for state-returning ops, `setEngineUiFor` for
    // non-state-returning ops like save / saveAs / split / extract /
    // optimize), so it converges with the engine the moment any UI
    // op lands. The cache is the synchronous snapshot used when the
    // mirror hasn't been seeded yet — e.g. between a direct
    // `window.tflex.engine.applyOp(...)` call and the next React
    // render — so an e2e harness that asserts against the
    // diagnostics surface right after a direct engine call still
    // sees the post-op value.
    const engineDocId = tab?.session.engineDocId ?? null;
    const mirroredEngineState =
      activeId !== null ? ui[activeId]?.state ?? null : null;
    const cachedEngineState =
      mirroredEngineState !== null
        ? null
        : engineDocId !== null && engineRef.current.peekLastState !== undefined
          ? engineRef.current.peekLastState(engineDocId) ?? null
          : null;
    const activeEngineState = resolveEngineStateForDiagnostics(
      mirroredEngineState,
      cachedEngineState,
    );
    const cachedPageCount = activeEngineState?.pageCount;
    const pageCount =
      cachedPageCount !== null && cachedPageCount !== undefined
        ? cachedPageCount
        : livePageCount > 0
          ? livePageCount
          : (diagnosticsRef.current["pageCount"] as number | undefined) ?? 0;
    const currentPage = (diagnosticsRef.current["currentPage"] as number | undefined) ?? 0;
    const zoom = (diagnosticsRef.current["zoom"] as number | undefined) ?? 1;
    const mode = (diagnosticsRef.current["mode"] as string | undefined) ?? "manual";
    const searchQuery =
      (diagnosticsRef.current["searchQuery"] as string | undefined) ?? "";
    const searchHits =
      (diagnosticsRef.current["searchHits"] as number | undefined) ?? 0;
    // DEF-093 — the active annotation tool. Read from the diagnostics
    // mirror that DocumentView seeds via `onDiagnostics`. The mirror
    // stores `AnnotationTool | null`; before this fix the field was
    // absent entirely, so e2e harnesses saw `undefined` (because
    // `diagnosticsRef.current["activeTool"]` was undefined and the
    // nullish-coalesce fell through to `undefined`). Default to
    // `null` so the surface contract is uniform: a missing key reads
    // as `null`, never `undefined`. DocumentView's `useEffect` emits
    // a fresh value on every `annTool.tool` change, so this stays in
    // step with the renderer's actual tool state without forcing
    // tflexDiagnostics to subscribe to React (DEF-077 — read-only).
    const rawActiveTool = diagnosticsRef.current["activeTool"];
    const activeTool: string | null =
      typeof rawActiveTool === "string" ? rawActiveTool : null;

    // DEF-077 — the fire-and-forget `getState` poll that used to
    // live here was removed. Scheduling a state-returning IPC +
    // a `setEngineUiFor` dispatch on every read tripped
    // React-19's max-update-depth guard (Error #520) when an
    // e2e harness polled `tflexDiagnostics()` in a tight loop.
    // The mirror converges via op-completion handlers
    // (`noteOpApplied` / `setEngineUiFor`) — the React UI
    // (AppHeader tab dot / Save button enabled) reflects every
    // op exactly as it lands, without diagnostics driving
    // additional renders.

    return {
      pageCount,
      currentPage,
      zoom,
      mode,
      theme: settingsRef.current?.theme ?? "frosted",
      openTabs: Object.keys(tabs2).length,
      activeTabId: activeId,
      activeDocBytes: tab?.session.fileSize ?? 0,
      searchQuery,
      searchHits,
      searchIndexProgress: searchIndexProgressRef.current,
      sampleCount,
      recovered: bootstrapRef.current?.recovered ?? false,
      engineAvailable: engineRef.current.available,
      modified: activeEngineState?.modified ?? false,
      // Full engine state for the active tab — exposed via the QA hook
      // so e2e harnesses can verify rotate / delete / reorder / undo
      // behaviour without scraping the DOM. Priority: React
      // `engineUi` mirror first (UI-handler-fresh); adapter
      // `peekLastState` cache as the fallback when the mirror is
      // still null (DEF-077 — the previous getState-poll was the
      // React #520 cause and has been removed).
      engineState: activeEngineState,
      canUndo: activeId !== null ? ui[activeId]?.canUndo ?? false : false,
      canRedo: activeId !== null ? ui[activeId]?.canRedo ?? false : false,
      // Phase 4 — mirror of the active tab's form fields / signature
      // placements. The host seeds these from `engine.getFormFields` on
      // tab open and keeps them in sync with the engine echo. The
      // diagnostics surface exposes them so e2e harnesses can verify
      // the fields-detected / signature-placed flow without scraping
      // the DOM (the editors live inside per-page overlays, not at the
      // top level). Both fields default to empty arrays so a stale
      // baseline never throws `undefined.map`.
      formFields: tab?.forms.fields ?? [],
      signatures: tab?.placements ?? [],
      hasFormFields: (tab?.forms.fields.length ?? 0) > 0,
      formFieldsLoaded: tab?.forms.loaded ?? false,
      // Engine-side document id (distinct from the tab id). The real
      // engine IPC keys everything by this; exposing it lets e2e
      // harnesses probe engine methods directly without scraping.
      engineDocId,
      // Phase 8 — optimize / audit space. Expose the open flags so the
      // e2e harness can drive the dialog open/closed state and read
      // the active preset without scraping DOM. The audit dialog's
      // last-seen audit data lives in a ref so the harness can poll
      // for the bar percentages without waiting on a re-render.
      optimizeDialogOpen: optimizeOpen,
      auditDialogOpen: auditOpen,
      optimizePreset: settingsRef.current?.optimizePreset ?? null,
      // Phase 9 — export image defaults (mirrored so e2e harnesses
      // can drive Export dialogs without scraping the DOM, same
      // pattern as optimizePreset).
      exportImageFormat:
        settingsRef.current?.exportImageFormat ?? null,
      exportImageDpi: settingsRef.current?.exportImageDpi ?? null,
      createImageQuality:
        settingsRef.current?.createImageQuality ?? null,
      // Per-tab reducer-level modified flag — distinct from
      // engineState.modified (which tracks engine-level mutation
      // only). Set for tabs whose only mutation is a render-side
      // flag (e.g. the "needs saving" marker on the new tab an
      // Optimize action creates). Surfaces the tabs reducer's
      // truth so e2e harnesses can verify without scraping the DOM.
      tabModified: activeId !== null ? tabs2[activeId]?.meta.modified ?? false : false,
      // DEF-093 — active annotation tool. `null` when no tool is
      // armed (i.e. the toolbar's "Select" tool, or no tab open).
      // The qa harness was getting `undefined` here because the
      // key wasn't on the diagnostics surface at all; the spec
      // wants `null` (a definite "no tool" value, not a missing
      // key). DocumentView seeds this on every `annTool.tool`
      // change via `onDiagnostics`.
      activeTool,
    };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Bug 4 — Escape disarms any armed tool. The per-document
      // annotation tool is disarmed by DocumentView's own keydown
      // handler (its reducer lives there); App-owned arms (Sign,
      // Stamp, the Edit-content tools) are cleared here. The
      // signatures / stamp overlays also handle Escape while they
      // are mounted, but this global branch is the safety net that
      // fires regardless of overlay mount state.
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (armedSignatureIdRef.current !== null) {
          setArmedSignatureId(null);
        }
        if (armedStampRef.current !== null) {
          setArmedStamp(null);
        }
        disarmEditTools();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void onOpenClick();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "w" &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        closeTab(tabs.activeId);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "s" &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        void onSave(tabs.activeId);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y") &&
        tabs.activeId !== null &&
        !e.shiftKey
      ) {
        e.preventDefault();
        if (e.key.toLowerCase() === "z") void onUndo(tabs.activeId);
        else void onRedo(tabs.activeId);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "z" &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        void onRedo(tabs.activeId);
      } else if (
        // DEF-049 — Ctrl/Cmd+Shift+R opens the OCR dialog. The native
        // menu already wires the same accelerator (src/main/menu.ts:
        // Tools -> Recognize Text...), but Electron's menu
        // accelerator occasionally races the focused renderer for the
        // keystroke (modal children, focus transitions, native menu
        // re-paint), and the action never reaches the renderer-side
        // `tflex.menu.onAction` listener. We mirror the accelerator
        // here as a fallback so the dialog opens reliably. Both
        // paths route through `onOcrClick`, which is identical to
        // the menu's `recognizeText` action.
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "r" &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        onOcrClick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenClick, closeTab, onSave, onUndo, onRedo, onOcrClick, tabs.activeId, disarmEditTools]);

  useEffect(() => {
    let cancelled = false;
    void window.tflex.listSamples().then((list) => {
      if (!cancelled) setSampleCount(list.length);
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  // DEF-077 / DEF-078 residual — Welcome `samplesResolver` inline arrow
  // identity churn (React-19 Error #520 on boot).
  //
  // Welcome's samples list lives in component-local state set inside
  // `useEffect([samplesResolver])`. Every App render that rebuilt the
  // inline `samplesResolver` arrow created a new function reference,
  // retriggered the effect, called `setSamples(list)`, queued another
  // App render, rebuilt the arrow again, and so on — the loop tripped
  // React-19's max-update-depth guard (Error #520) and collapsed the
  // tree on initial boot, when no tab is open and Welcome mounts as
  // the visible surface.
  //
  // The fix mirrors the `openFromBytes` useCallback pattern: hoist
  // the resolver into a stable useCallback with empty deps so its
  // identity survives across App renders. Welcome's effect runs once
  // on mount, samples settle, no churn.
  //
  // The same apply-everywhere pass audited every inline callback fed
  // from App.tsx to a child component whose `useEffect` dep array
  // references the prop (DEF-078 scope). The complete inventory:
  //
  //   - `<Welcome samplesResolver={...}>` — THIS prop. Welcome has
  //     `useEffect([samplesResolver])` and calls setSamples inside.
  //     Fixed by extracting this useCallback.
  //
  //   - `<DocumentView onPersist={persistFor(meta.id)}>` — already
  //     routed through the persistFor cache so per-tab identity is
  //     stable across re-renders.
  //   - `<DocumentView onDiagnostics={diagnosticsFor(meta.id)}>` —
  //     same diagnosticsFor pattern.
  //   - `<DocumentView onSearchIndexProgress={searchIndexProgressFor(meta.id)}>`
  //     — same factory pattern.
  //   - `<Toasts onDismiss={dismissToast}>` — dismissToast is a
  //     useCallback; Toasts's `useEffect([toast.id, onDismiss])` is
  //     stable.
  //   - `<OcrDialog subscribeOcrProgress={subscribeOcrProgress}>` —
  //     subscribeOcrProgress is a useCallback; OcrDialog's effect
  //     dep `[open, running, subscribeOcrProgress]` is stable.
  //   - `<PageView onActiveHitTop={onActiveHitTop}>` (via DocumentView)
  //     — onActiveHitTop is a useCallback inside DocumentView.
  //   - `<PageView onPageSize={NOOP_PAGE_SIZE}>` (via DocumentView)
  //     — module-level stable no-op.
  //   - `<PageView onRenderStart / onRenderEnd>` (via DocumentView)
  //     — useCallback'd inside DocumentView.
  //
  // Every other inline arrow in the App return (ToolsPalette buttons,
  // Dialog `onConfirm` / `onLanguageChange` / `onOptimizePresetChange`
  // / `onFormatChange` / `onDpiChange` / `onSaveAsLinearizeChange` /
  // `onStampIdChange` / `onQualityChange` / `onSetThemeDefault` /
  // `onSetRecentsCap` / `onAnnotationPaletteChange` / `onLayoutChange`
  // / `onEditModeToggle` / `onToolsPaletteToggle` / `onRotateClockwise`
  // / `onExtract` / `onRotate` / `onDelete` / `onSign` / `onForms` /
  // `onBatchOcr` / `onOcrSuspects` / `onClose` / `onCancel` /
  // `onCreateFromClipboard`) does NOT appear in any child component's
  // `useEffect` dep array. They are wired to user-event callbacks
  // (onClick / onChange / onConfirm), which fire only on user input
  // and don't drive the boot-time render loop. They're left as
  // inline arrows for now — converting them to useCallbacks would
  // add ~30 memoized handlers for zero React #520 benefit and
  // obscure the existing inline-closure-over-settings pattern that
  // captures the latest `settings` reference inside each dialog's
  // settings write (DEF-037 / DEF-039 / DEF-073 etc. rely on the
  // closure seeing the freshest settings). The orchestrator's task
  // scope is "components with useEffect deps"; those other arrows
  // are intentionally out of scope.
  const samplesResolver = useCallback(
    async (): Promise<SampleDocument[]> => window.tflex.listSamples(),
    [],
  );

  const allRecents = settings?.recentFiles ?? [];
  const recentDisplays = useMemo(
    () => allRecents.map((entry) => ({ entry, meta: splitRecentPath(entry.path) })),
    [allRecents],
  );

  // Stable projection of tabs.tabs for AppHeader. We rebuild this list
    // only when the underlying tabs array actually changes (open / close
    // / activate / set-modified / rename). Without the memo, every App
    // re-render (theme toggle, settings echo, engine state mirror effects)
    // would produce new outer tab objects, which would force AppHeader
    // to re-render every tab element and — combined with a mousedown /
    // mouseup crossing the re-render — lose the click. Identity-stable
    // props keep the React tree stable so the mousedown semantics in
    // AppHeader resolve to the same DOM node the user pressed
    // (DEF-034: state-churn click loss).
  const headerTabs = useMemo(
    () => tabs.tabs.map((meta) => ({ id: meta.id, title: meta.title, modified: meta.modified })),
    [tabs.tabs],
  );

  // Phase 13 / DEF-202 — maximize / restore icon for the custom title
  // bar. This reads the dedicated `windowMaximized` mirror, NOT
  // `settings.geometry.maximized`: the echo filter (DEF-037) discards
  // `settings.changed` payloads that disagree with our latest local
  // write, and a geometry report disagrees as soon as the window has
  // moved/resized/maximized since that write — so reading the geometry
  // off `settings` left the caption stale ("Maximize" on an
  // already-maximized window). `windowMaximized` is updated from every
  // echo (see the subscription near the top of the component) and
  // seeded at boot, which keeps it in sync with the real window state
  // main reports on maximize / unmaximize.
  const isMaximized = windowMaximized;

  // Phase 13 — menu popover entries. The TitleBar renders a popover
  // listing every menu action with its accelerator; clicking an entry
  // routes through the same `dispatchMenuAction` the native menu
  // listener uses. The `menuContext` mirrors the one App.tsx hands to
  // `tflex.menu.onAction` (same handlers, same gating). Defined here
  // as a memoised constant so its reference is stable across App
  // re-renders — the popover only re-mounts when the dependency set
  // actually changes (theme toggle, dialog open state, etc).
  const menuGroups = useMemo<MenuGroup[]>(
    () => [
      {
        id: "file",
        label: "File",
        entries: [
          { id: "open", label: "Open...", accelerator: "Ctrl+O", action: "open" },
          { id: "merge", label: "Merge...", accelerator: "Ctrl+Shift+O", action: "merge" },
          { id: "save", label: "Save", accelerator: "Ctrl+S", action: "save" },
          { id: "saveAs", label: "Save As...", accelerator: "Ctrl+Shift+S", action: "saveAs" },
          { id: "closeTab", label: "Close Tab", accelerator: "Ctrl+W", action: "closeTab" },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        entries: [
          { id: "undo", label: "Undo", accelerator: "Ctrl+Z", action: "undo" },
          { id: "redo", label: "Redo", accelerator: "Ctrl+Shift+Z", action: "redo" },
          { id: "prefs", label: "Preferences...", accelerator: "Ctrl+,", action: "preferences" },
        ],
      },
      {
        id: "view",
        label: "View",
        entries: [
          { id: "theme", label: "Toggle Theme", accelerator: "Ctrl+Shift+T", action: "toggleTheme" },
          { id: "tools", label: "Show Tools Palette", accelerator: "Ctrl+Shift+P", action: "showToolsPalette" },
        ],
      },
      {
        id: "tools",
        label: "Tools",
        entries: [
          { id: "ocr", label: "Recognize Text...", accelerator: "Ctrl+Shift+R", action: "recognizeText" },
        ],
      },
      {
        id: "help",
        label: "Help",
        entries: [
          { id: "check", label: "Check for Update...", accelerator: "Ctrl+Shift+U", action: "checkForUpdate" },
          { id: "about", label: "About TFlex", action: "about" },
        ],
      },
    ],
    [],
  );

  /** True when the active tab is an empty placeholder (no document).
   *  The renderer mounts the Welcome screen instead of a DocumentView
   *  so the user has somewhere to drop a PDF. */
  const activeIsEmpty = tabs.activeId !== null
    && tabs.tabs.find((t) => t.id === tabs.activeId)?.kind === 'empty';

  const activeTab = tabs.activeId !== null ? openTabs[tabs.activeId] : null;
  const activeEngineUi = tabs.activeId !== null ? engineUi[tabs.activeId] : null;

  if (!bootDone || settings === null) {
    return (
      <div className={isMaximized ? "app app-maximized" : "app"}>
        <TitleBar maximized={false} />
        <div className="app-main" data-tools-open="false" data-tools-mode="list" />
        <Toasts items={[]} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <div className={isMaximized ? "app app-maximized" : "app"}>
      {/* Phase 14 — the frosted theme's ambient backdrop. Paints the
       * wallpaper-style gradient the glass panels diffuse; invisible
       * in light/dark (the opaque .app background covers it). The
       * parallax controller writes --tf-parallax-* here. */}
      <div className="tf-ambient" ref={ambientLayerRef} aria-hidden />
      <TitleBar
        menuGroups={menuGroups}
        menuContext={menuContext}
        maximized={isMaximized}
      >
        <AppHeader
          activeId={tabs.activeId}
          // `headerTabs` is memoised above so its reference is stable
          // across App re-renders that don't actually change tab state.
          // AppHeader reads `modified` from this list (mirrored by the
          // tabs reducer on every successful engine op).
          tabs={headerTabs}
          onActivate={activateTab}
          onClose={closeTab}
          theme={settings.theme}
          // The picker's selection state: the persisted preference
          // ('light' | 'dark' | 'frosted' | 'system'). Absent on
          // first run — the header then falls back to the concrete
          // theme, the legacy behaviour.
          themeDefault={settings.themeDefault}
          onThemeChange={onThemeChange}
          onNewEmptyTab={onNewEmptyTab}
          // Phase 13 — the Settings (gear) affordance in the title bar
          // opens the same Preferences sheet the Edit menu and Ctrl+,
          // open. Same single source of truth (`prefsOpen`).
          onOpenPreferences={(): void => {
            disarmActiveDocView();
            setPrefsOpen(true);
          }}
          // OTA UX — the toolbar update indicator reads its state
          // from the App's shared `onStatusChanged` subscription via
          // `externalState` so the same push that opens the prompt
          // also drives the toolbar chip. We disable the indicator's
          // own IPC subscription (`enabled={false}` would also work,
          // but `externalState !== undefined` short-circuits it
          // internally — same effect) so we never double-subscribe.
          updateIndicator={<UpdateIndicator externalState={updateState} />}
        />
      </TitleBar>
      {/* Phase 14.2 FIX 4/5 — the open Tools panel's state lives on
          .app-main as data attributes, driven by the SAME
          `toolsPaletteOpen` state that mounts the palette below. The
          CSS animates --tf-tools-inset from these (registered
          @property, transitioned on .workspace-main, consumed by the
          scroller's margin-right) so the page view narrows beside the
          open panel in EVERY theme and panel + page move together on
          the same 300ms ease-out. data-tools-mode mirrors the
          persisted palette layout (list 344px / grid 380px).

          Phase 16 — data-rail-collapsed is driven by the SAME
          `pagesPanel` state that swaps the rail body to the ruler
          strip: it flips the registered --tf-rail-w token (220px ->
          48px) that .workspace's grid column tweens over the shared
          280ms panel motion token, so the rail shrinks and the page
          reflows together in every theme. */}
      <div
        className="app-main"
        data-tools-open={toolsPaletteOpen ? "true" : "false"}
        data-tools-mode={settings.toolsPaletteLayout ?? 'list'}
        data-rail-collapsed={pagesPanelCollapsed ? "true" : "false"}
      >
        {/* Unified toolbar (ribbon) — the tabbed Annotate / Edit /
            Document surface that replaced the former per-view
            annotation / edit toolbars. App-owned (section tab +
            armed Edit tool are App state) and mounted above the
            tab stage, only while a document is open — on the
            welcome / empty-tab screen the old toolbars never
            rendered either, so no ribbon appears there. Document
            actions resolve the ACTIVE tab: save / save-as go
            through the per-tab saveHandlers, the rest reuse the
            active-tab dialog openers the menu + Tools palette
            already share. Print / Share / Props have no app
            action yet (no IPC channel), so the host passes no
            callback and those three ribbon buttons stay inert. */}
        {tabs.tabs.length > 0 && !activeIsEmpty && (
          <UnifiedToolbar
            activeTab={activeToolbarTab}
            onTabChange={setActiveToolbarTab}
            editMode={activeEditMode}
            onEditModeChange={setActiveEditMode}
            onSave={tabs.activeId !== null ? saveHandlers(tabs.activeId).save : undefined}
            onSaveAs={tabs.activeId !== null ? saveHandlers(tabs.activeId).saveAs : undefined}
            onExport={onExportClick}
            onMerge={onMergeClick}
            onSplit={onSplitClick}
            onOptimize={onOptimizeClick}
            onFlatten={(): void => {
              disarmActiveDocView();
              setFlattenOpen(true);
            }}
          />
        )}
        <div className="tab-stage">
          {tabs.tabs.length === 0 || activeIsEmpty ? (
            <div className="tab-pane" key={tabs.activeId ?? 'welcome'}>
              <Welcome
                recentFiles={recentDisplays}
                onOpenRecent={onRecentClick}
                onRemoveRecent={onRemoveRecent}
                onOpenFile={onOpenClick}
                onSampleClick={onSampleClick}
                onMergeClick={onMergeClick}
                onCreateFromImages={onCreateClick}
                samplesResolver={samplesResolver}
              />
            </div>
          ) : (
            tabs.tabs.map((meta) => {
              const open = openTabs[meta.id];
              if (open === undefined) return null;
              const handlers = saveHandlers(meta.id);
              const engine = engineFor(meta.id);
              const ann = annotationHandlers(meta.id);
              const fs = formsAndSignaturesHandlers(meta.id);
              const saveInPlaceEnabled = open.session.onDiskPath !== null;
              // DEF-042 — Save-As enablement. The toolbar's `modified`
              // prop must reflect EITHER the engine's `modified` flag
              // (set by rotate / delete / reorder / annotations /
              // forms / signatures) OR the tabs reducer's `modified`
              // flag (set explicitly when a brand-new tab is born
              // unsaved, e.g. the "Reduce and open as new tab" path
              // of Optimize or Split/Extract). Without the OR, the
              // tab-dot indicator (which reads tabs.tabs) lights up
              // but Save-As (which only read engineState.modified)
              // stayed disabled with the "Nothing to save" tooltip.
              const saveModified =
                meta.modified || engine.engineState.modified;
              return (
                <div
                  className="tab-pane"
                  key={meta.id}
                  style={{
                    visibility: meta.id === tabs.activeId ? "visible" : "hidden",
                  }}
                  aria-hidden={meta.id !== tabs.activeId}
                >
                  <DocumentView
                    // DEF-211 — stable per-tab ref so the host can address
                    // this view imperatively (disarm the active annotation
                    // tool before a dialog overlays the workspace).
                    ref={getOrCreateDocViewRef(meta.id)}
                    doc={open.session.doc}
                    pageCount={engine.engineState.pageCount}
                    outline={open.session.outline}
                    initial={open.persisted}
                    onPersist={persistFor(meta.id)}
                    onDiagnostics={diagnosticsFor(meta.id)}
                    onSearchIndexProgress={searchIndexProgressFor(meta.id)}
                    registerSearchIndexInvalidator={(
                      fn,
                    ): void => registerSearchIndexInvalidatorFor(meta.id, fn)}
                    onToast={pushToast}
                    engineState={engine.engineState}
                    // DEF-139 — visible-order flag for the slot ->
                    // proxy-page mapping (original bytes vs a
                    // re-serialized getDocumentBytes proxy).
                    proxyVisibleOrder={open.session.proxyVisibleOrder}
                    modified={saveModified}
                    // Phase 14.1 — the command bar's accent Open button
                    // (moved out of the title bar per the reference).
                    onOpenFile={onOpenClick}
                    canUndo={engine.canUndo}
                    saveInPlaceEnabled={saveInPlaceEnabled}
                    onRotate={engine.op}
                    onDelete={engine.deletePages}
                    onReorder={engine.reorder}
                    onUndo={engine.undo}
                    onSave={handlers.save}
                    onSaveAs={handlers.saveAs}
                    onMerge={onMergeClick}
                    onSplit={onSplitClick}
                    onOptimize={onOptimizeClick}
                    onAuditSpace={onAuditClick}
                    // DEF-041 — toolbar Rotate clockwise button. The
                    // page indicator's "current" page is what the
                    // user sees on screen; rotating that page is
                    // what the button does.
                    onRotateClockwise={(): void => onRotateClockwise(meta.id)}
                    // Phase 13 — counter-clockwise rotate from the
                    // toolbar's second rotate button.
                    onRotateCounterClockwise={(): void => onRotateCounterClockwise(meta.id)}
                    // Phase 13 — pan mode cascade. When the toolbar's
                    // Hand button arms while a stamp ghost is pending,
                    // the pending stamp drops (the pan drag owns the
                    // pointer).
                    onDisarmStamp={(): void => setArmedStamp(null)}
                    // B8 — toolbar Delete pages button. Disabled
                    // when only one page remains so the user can't
                    // drop below the "must keep at least one"
                    // floor.
                    onDeletePage={onDeletePageClick}
                    canDeletePage={engine.engineState.pageCount > 1}
                    annotations={ann.annotations}
                    liveAnnTextIds={ann.liveAnnTextIds}
                    onCreateAnnotation={ann.createAnnotation}
                    onEditAnnotation={ann.editAnnotation}
                    onDeleteAnnotation={ann.deleteAnnotation}
                    formFields={fs.formFields}
                    onFormValueChange={fs.onFormValueChange}
                    onFormListboxToggle={fs.onFormListboxToggle}
                    signatures={fs.signatures}
                    savedSignatures={fs.savedSignatures}
                    armedSignatureId={fs.armedSignatureId}
                    onPlaceSignature={fs.onPlaceSignature}
                    onMoveSignature={fs.onMoveSignature}
                    onDeleteSignature={fs.onDeleteSignature}
                    // B1 — exit Sign mode. Wired to the pending
                    // action bar's Cancel button.
                    onCancelSignatureArm={fs.onCancelSignatureArm}
                    // B10 — armed stamp ghost + click-to-embed.
                    armedStamp={armedStamp}
                    onPlaceStamp={onPlaceStamp}
                    // B10 / DEF-101 — placed-stamp DOM surfaces for
                    // this tab (mirror of successful addStamp ops).
                    stampAnnotations={placedStampsByTab[meta.id] ?? []}
                    // Bug 6 — placed stamps are editable / movable /
                    // deletable like every annotation: Confirm/Delete/
                    // Edit route through the host's re-bake handlers.
                    onMoveStamp={(id, rect): void => {
                      void onMoveStamp(meta.id, id, rect);
                    }}
                    onDeleteStamp={(id): void => {
                      void onDeleteStamp(meta.id, id);
                    }}
                    onRetypeStamp={(id, stampId): void => {
                      void onRetypeStamp(meta.id, id, stampId);
                    }}
                    toolsPaletteOpen={toolsPaletteOpen}
                    onToolsPaletteToggle={(): void => setToolsPaletteOpen((v) => !v)}
                    themeName={settings.theme}
                    editModeOpen={editModeOpen}
                    onEditModeToggle={(): void => setEditMode(!editModeOpen)}
                    edit={editModeOpen ? editHandlers(meta.id) : null}
                    // Phase 16 — pages-panel collapsed state: App owns
                    // the persisted value; DocumentView threads it to
                    // the SideRail (the rail never owns the state).
                    pagesPanelCollapsed={pagesPanelCollapsed}
                    onTogglePagesPanelCollapsed={togglePagesPanelCollapsed}
                  />
                </div>
              );
            })
          )}
        </div>
        <AnimatePresence>
          {toolsPaletteOpen && (
            <ToolsPalette
              layout={settings.toolsPaletteLayout ?? 'list'}
              // Phase 14.2 FIX 5 — the persisted layout mode the panel
              // is EXITING with. TfPanel pins the exit transform to the
              // mode's travel the mount target promised; without the
              // persisted value the exit reads `layout === 'list'`
              // (component-local) and a closed-in-grid-mode panel
              // snapped to the list travel mid-fade.
              exitLayout={settings.toolsPaletteLayout ?? 'list'}
              onLayoutChange={(next): void => {
                setSettings((prev) => {
                  if (prev === null) return prev;
                  const updated = preferencesReducer(prev, {
                    type: 'set-tools-palette-layout',
                    value: next,
                  });
                  trackAndSave(updated);
                  return updated;
                });
              }}
              onMerge={onMergeClick}
              onSplit={onSplitClick}
              onExtract={(): void => {
                disarmActiveDocView();
                setSplitOpen(true);
              }}
              onRotate={(): void => {
                // DEF: palette rotate was a no-op stub (the
                // comment claimed "rotate happens per-page in the
                // rail" but the palette entry is reachable without
                // a rail thumbnail selection — e.g. after closing
                // the rail tab to the annotations panel). Wire it
                // through the same path the toolbar's Rotate
                // clockwise button uses (which reads the active
                // tab's persisted currentPage and dispatches the
                // engine rotate op).
                const id = activeTabIdRefLocal.current;
                if (id === null) return;
                onRotateClockwise(id);
              }}
              onDelete={(): void => {
                // B11 — the palette's Delete entry opens the SAME
                // DeletePageDialog the toolbar's Delete button uses
                // (current page / custom range, with the "must keep
                // at least one page" validation inside the dialog).
                // The previous wiring was a toast no-op ("Select a
                // thumbnail in the left rail…") that told the user
                // to go elsewhere — a silent dead end for an entry
                // that looks exactly like the toolbar control. The
                // dialog gates on the active tab and resolves the
                // current page itself.
                onDeletePageClick();
              }}
              onSign={(): void => {
                disarmActiveDocView();
                if (armedSignatureId !== null) {
                  setArmedSignatureId(null);
                } else {
                  // DEF-125 — arming Sign from the palette exits Edit
                  // mode too (same cross-disarm as the toolbar path):
                  // the edit layer would otherwise swallow the
                  // placement click.
                  if (editModeOpenRef.current) {
                    setEditMode(false);
                  }
                  setSigModalOpen(true);
                }
              }}
              onForms={(): void => {
                disarmActiveDocView();
                setFlattenOpen(true);
              }}
              onFlatten={(): void => {
                disarmActiveDocView();
                setFlattenOpen(true);
              }}
              onOptimize={onOptimizeClick}
              onAudit={onAuditClick}
              onCreateFromImages={onCreateClick}
              onExportPages={onExportClick}
              onExportText={onTextExportClick}
              onExportDocx={onDocxExportClick}
              onInsertPages={onInsertPagesClick}
              onRecognizeText={onOcrClick}
              onBatchOcr={(): void => {
                void onBatchOcr();
              }}
              onOcrSuspects={(): void => onOpenOcrSuspects()}
              onReplacePages={onReplacePagesClick}
              onRenumberPages={onRenumberPagesClick}
              onCropPages={onCropPagesClick}
              onStamp={onStampClick}
              onExportComments={onCommentExportClick}
              onImportComments={onCommentImportClick}
              hasOcrSuspects={Object.values(ocrRunByTab).some(Boolean)}
              onClose={(): void => setToolsPaletteOpen(false)}
              // B11 / DEF-102 — `documentRequired` must be false on an
              // empty tab. The previous shape was
              // `activeTab !== null`; on an empty tab `openTabs[id]`
              // has NO entry (empty tabs only exist in the tab bar),
              // so `activeTab` is `undefined` — and
              // `undefined !== null` is TRUE, which told the palette
              // "a document is active" and enabled Recognize Text /
              // OCR on a doc-less tab. Gating on the active tab not
              // being empty makes every document-required entry
              // (Recognize text, OCR suspects, batch OCR, ...)
              // disabled on the welcome screen and on empty tabs.
              documentRequired={tabs.activeId !== null && !activeIsEmpty}
              hasFormFields={(activeTab?.forms.fields.length ?? 0) > 0}
            />
          )}
        </AnimatePresence>
        {/* B14 — the suspects panel must only render against a
            REAL document. The previous guard checked
            `activeTabIdRefLocal.current !== null`, which is true
            on an empty tab too (empty tabs have an id but no
            openTabs entry) — so a stale `ocrSuspectsOpen` flag
            surfaced the panel over the welcome / empty-tab
            screen. `activeTab` (openTabs[activeId]) is null on
            empty tabs, so the panel can never render without a
            document. The flag is also reset on new-tab / tab-
            switch / close (B10 / B14). */}
        <AnimatePresence mode="popLayout">
        {ocrSuspectsOpen && activeTab !== null && (
          <OcrSuspectsPanel
            suspects={
              ocrSuspectsByTab[activeTabIdRefLocal.current ?? ""] ?? []
            }
            hasRun={ocrRunByTab[activeTabIdRefLocal.current ?? ""] === true}
            onNavigate={onSuspectNavigate}
            onClose={onCloseOcrSuspects}
          />
        )}
      </AnimatePresence>
      </div>
      <MergeDialog
        open={mergeOpen}
        onClose={onCancelMerge}
        onConfirm={(c): void => {
          void onConfirmMerge(c);
        }}
        pickFile={onPickMergeFile}
        sourceName={activeTab?.displayName ?? "this document"}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
      />
      <SplitDialog
        open={splitOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        onClose={onCancelSplit}
        onConfirm={(c): void => {
          void onConfirmSplit(c);
        }}
      />
      <CreateFromImagesDialog
        open={createOpen}
        initialQuality={
          settings.createImageQuality ?? DEFAULT_CREATE_IMAGE_QUALITY
        }
        onQualityChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-create-image-quality',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onConfirm={(c): void => {
          void onCreateConfirm(c.files, c.quality);
        }}
        onCreateFromClipboard={(c): void => {
          void onCreateFromClipboardConfirm(c);
        }}
        readClipboard={readClipboard}
        onClose={onCancelCreate}
      />
      <ExportDialog
        open={exportOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        initialFormat={
          settings.exportImageFormat ?? DEFAULT_EXPORT_IMAGE_FORMAT
        }
        initialDpi={
          settings.exportImageDpi ?? DEFAULT_EXPORT_IMAGE_DPI
        }
        onFormatChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-export-image-format',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onDpiChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-export-image-dpi',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        runExport={runExportPages}
        onConfirm={(c): void => {
          onExportConfirm(c);
        }}
        sourceName={activeTab?.displayName ?? "this document"}
        onClose={onCancelExport}
      />
      <SignatureManagerModal
        open={sigModalOpen}
        onClose={(): void => {
          void onSigModalClose();
        }}
        onApply={onSigManagerApply}
        savedSignatures={savedSignatures}
        onToast={pushToast}
      />
      <FlattenConfirmDialog
        open={flattenOpen}
        fieldCount={activeTab?.forms.fields.length ?? 0}
        onCancel={(): void => setFlattenOpen(false)}
        onConfirm={(): void => {
          void onFlattenConfirm();
        }}
      />
      <OptimizeDialog
        open={optimizeOpen}
        initialPreset={settings.optimizePreset ?? DEFAULT_OPTIMIZE_PRESET}
        originalBytes={activeTab?.session.fileSize ?? 0}
        runOptimize={runOptimizeForActiveTab}
        runAuditSpace={runAuditSpaceForActiveTab}
        onConfirm={(preset, bytes): void => {
          void onConfirmOptimize(preset, bytes);
        }}
        // DEF-039 — surface the user's preset choice through the
        // preferences reducer so AppSettings.optimizePreset survives
        // across launches. Same pattern as the Preferences sheet: the
        // reducer is idempotent (equal value -> same reference), the
        // updater-form of setSettings keeps the write inside React's
        // latest pending state, and the persist goes through
        // trackAndSave so the settings echo filter can drop stale
        // echoes that arrive after a newer local write.
        onOptimizePresetChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-optimize-preset',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onClose={onCancelOptimize}
      />
      <AuditSpaceDialog
        open={auditOpen}
        runAuditSpace={runAuditSpaceForActiveTab}
        onClose={onCancelAudit}
      />
      <OcrDialog
        open={ocrOpen}
        totalPages={
          activeTab?.session.doc.numPages ?? 0
        }
        currentPage={(() => {
          const id = activeTabIdRefLocal.current;
          if (id === null) return 1;
          const tab = openTabsRef.current[id];
          return tab ? Math.max(1, Math.floor(tab.persisted.currentPage)) : 1;
        })()}
        formFields={activeTab?.forms.fields ?? []}
        initialLanguage={
          settings.ocrLanguage ?? DEFAULT_OCR_LANGUAGE
        }
        initialDownsample={
          settings.ocrDownsample ?? DEFAULT_OCR_DOWNSAMPLE
        }
        onLanguageChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-ocr-language',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onDownsampleChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-ocr-downsample',
              value: clampOcrDownsample(next),
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        resolveActiveDoc={resolveActiveDocForOcr}
        subscribeOcrProgress={subscribeOcrProgress}
        runOcr={runOcrForActiveTab}
        onConfirm={(result): void => {
          onOcrConfirm(result);
        }}
        onClose={onCancelOcr}
      />
      <SaveAsDialog
        open={saveAsOpen}
        // DEF-073 / ADV-020 — the linearize checkbox now owns its
        // own `saveAsLinearize` AppSettings boolean instead of
        // piggy-backing on `optimizePreset`. The previous design
        // coupled two unrelated features (Optimize compression
        // level vs Save-As linearization) — opening Optimize, picking
        // 'max', then opening Save-As and toggling linearize
        // silently overwrote 'max' with 'none'. The two flows now
        // share no state and never collide.
        saveAsLinearize={settings.saveAsLinearize ?? false}
        onSaveAsLinearizeChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-save-as-linearize',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onConfirm={(): void => {
          setSaveAsOpen(false);
          const activeId = activeTabIdRefLocal.current;
          if (activeId !== null) {
            void performSaveAs(activeId);
          }
        }}
        onClose={(): void => setSaveAsOpen(false)}
      />
      <TextExportDialog
        open={textExportOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        runExport={runExportText}
        onConfirm={onTextExportConfirm}
        sourceName={activeTab?.displayName ?? "this document"}
        onClose={onCancelTextExport}
      />
      <DocxExportDialog
        open={docxExportOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        runEngineExport={runExportPages}
        runAssemble={runAssembleDocx}
        onConfirm={onDocxExportConfirm}
        sourceName={activeTab?.displayName ?? "this document"}
        onClose={onCancelDocxExport}
      />
      <InsertPagesDialog
        open={insertPagesOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        pickOtherFile={pickOtherPdf}
        onConfirm={(c): void => {
          void onInsertPagesConfirm(c);
        }}
        onClose={onCancelInsertPages}
      />
      <ReplacePagesDialog
        open={replacePagesOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        pickOtherFile={pickOtherPdf}
        onConfirm={(c): void => {
          void onReplacePagesConfirm(c);
        }}
        onClose={onCancelReplacePages}
      />
      <RenumberPagesDialog
        open={renumberPagesOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        initialLabels={
          (activeEngineUi?.state.pageLabels ?? []).map((l) => ({
            page: l.page,
            label: l.label,
          }))
        }
        onConfirm={(c): void => {
          void onRenumberPagesConfirm(c);
        }}
        onClose={onCancelRenumberPages}
      />
      <CropPagesDialog
        open={cropPagesOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        pageSizes={activePageSizes}
        // B16 — pass the active doc so the CropEditor can render
        // a real page preview (pdf.js) behind the dashed crop
        // box. Without this the editor surface is the dialog's
        // background and operators reported a "black canvas".
        doc={activeTab?.session.doc ?? null}
        onConfirm={(c): void => {
          void onCropPagesConfirm(c);
        }}
        onClose={onCancelCropPages}
      />
      <StampDialog
        open={stampOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        currentPage={(() => {
          const id = activeTabIdRefLocal.current;
          if (id === null) return 1;
          const tab = openTabsRef.current[id];
          return tab ? Math.max(1, Math.floor(tab.persisted.currentPage)) : 1;
        })()}
        initialStampId={settings.defaultStampId ?? DEFAULT_STAMP_ID}
        onStampIdChange={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-default-stamp-id',
              value: next,
            });
            if (updated !== prev) trackAndSave(updated);
            return updated;
          });
        }}
        onConfirm={(c): void => {
          void onStampConfirm(c);
        }}
        onClose={onCancelStamp}
      />
      <CommentExportDialog
        open={commentExportOpen}
        annotationCount={activeTab?.engine.annotations.length ?? 0}
        runExportFdf={runExportFdfForActiveTab}
        saveFile={saveFdfToFile}
        sourceName={activeTab?.displayName ?? "document"}
        onConfirm={onCommentExportConfirm}
        onClose={onCancelCommentExport}
      />
      <CommentImportDialog
        open={commentImportOpen}
        pickFile={pickFdfFile}
        runImportFdf={runImportFdfForActiveTab}
        onConfirm={onCommentImportConfirm}
        onClose={onCancelCommentImport}
      />
      <DeletePageDialog
        open={deletePageOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        currentPage={(() => {
          const id = activeTabIdRefLocal.current;
          if (id === null) return 1;
          const tab = openTabsRef.current[id];
          return tab ? Math.max(1, Math.floor(tab.persisted.currentPage)) : 1;
        })()}
        onConfirm={onDeletePageConfirm}
        onClose={onCancelDeletePage}
      />
      {/* B8 — close-tab prompt. Shown when the user closes a tab
          with unsaved engine changes. The dialog stays mounted
          while a save is in flight; on save success we close the
          tab, on save failure we keep the tab open and surface the
          engine's error inline. */}
      <CloseTabPromptDialog
        open={pendingCloseTabId !== null}
        tabTitle={
          pendingCloseTabId === null
            ? ""
            : tabsRef.current.tabs.find((t) => t.id === pendingCloseTabId)?.title ?? ""
        }
        // DEF-128 — bytes-loaded / sample tabs have no on-disk path;
        // their Save button must read "Save As…" so the user expects
        // the OS path picker the save flow will pop.
        saveAsMode={
          pendingCloseTabId !== null &&
          (openTabsRef.current[pendingCloseTabId]?.session.onDiskPath ?? null) === null
        }
        saving={pendingCloseSaving}
        saveError={pendingCloseError}
        onChoose={(choice): void => {
          void onCloseTabPromptChoose(choice);
        }}
      />
      <Toasts items={errorState.toasts} onDismiss={dismissToast} />
      <AboutDialog
        open={aboutOpen}
        onClose={(): void => setAboutOpen(false)}
        // OTA UX — Help -> Check for Update shortcut inside the
        // About sheet. Same handler the menu routes through; opens
        // the prompt and triggers a backend re-check.
        onCheckForUpdate={onCheckForUpdate}
      />
      <UpdatePromptDialog
        open={updatePromptOpen}
        state={updateState}
        onUpdate={onUpdateDownload}
        onInstall={onUpdateInstall}
        onClose={onCloseUpdatePrompt}
      />
      <PreferencesDialog
        open={prefsOpen}
        onClose={(): void => setPrefsOpen(false)}
        themeDefault={settings.themeDefault ?? 'dark'}
        recentsCap={settings.recentsCap ?? DEFAULT_RECENTS_CAP}
        onSetThemeDefault={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, { type: 'set-theme-default', value: next });
            trackAndSave(updated);
            return updated;
          });
        }}
        // Immediate apply: flipping the dropdown also flips the LIVE
        // theme right now (the shared contract promises "the live
        // theme flips too"). 'system' resolves to the OS's current
        // colour preference at choice time (resolveThemeDefault); the
        // resolved concrete theme is persisted alongside
        // themeDefault (written by onSetThemeDefault above) so boot —
        // which applies `settings.theme` — shows the same look on the
        // next launch. Same trackAndSave + setTheme path as the
        // header picker; the no-op guard skips a redundant persist
        // when the pick resolves to the theme already showing.
        onThemeChange={(next): void => {
          const concrete = resolveThemeDefault(
            next,
            window.matchMedia("(prefers-color-scheme: dark)").matches,
          );
          setSettings((prev) => {
            if (prev === null) return prev;
            if (concrete === prev.theme) return prev;
            const updated: AppSettings = { ...prev, theme: concrete };
            setTheme(concrete);
            trackAndSave(updated);
            return updated;
          });
        }}
        onSetRecentsCap={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, { type: 'set-recents-cap', value: next });
            trackAndSave(updated);
            return updated;
          });
        }}
      />
    </div>
  );
}