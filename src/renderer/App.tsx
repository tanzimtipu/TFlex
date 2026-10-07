import { cloneElement, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type {
  AppSettings,
  BatesDefaults,
  BatesInfo,
  BatesSettings,
  BlankPageMeasurement,
  DocxImageEntry,
  DocumentProtectionState,
  EditFont,
  EngineError,
  ExportPageEntry,
  ExportPagesPayload,
  FdfOpenError,
  FillFormFieldPayload,
  FormDataImportReport,
  FormField,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OptimizePreset,
  PageLabelEntry,
  Pdf3dContent,
  PdfCadMetadata,
  PdfLayer,
  PdfOpenError,
  PdfValidationDefaults,
  PrintWindowContext,
  RecentFile,
  ReplaceTextPayload,
  ReplaceTextResult,
  SampleDocument,
  SavedSignature,
  SignaturePlacement,
  SpaceAudit,
  StampId,
  TextBoxStylePatch,
  UpdateState,
  WatermarkInfo,
  WatermarkSettings,
} from "../shared/types";
import { DEFAULT_READING_DEFAULTS } from "../shared/types";
import { err } from "../shared/result";
import type { Result } from "../shared/result";
import type { ApplyRedactions } from "./redaction/RedactionOverlay";
import type { ReviewElementRef } from "./components/ReviewElementsPanel";
import type { TFlexApi, TFlexApiConvert, TFlexApiExport } from "../shared/ipc";
import type { ValidationReport, ValidationTarget } from "../shared/validation";
import type { ConvertFormatId, ConvertManyResult, ConvertSourceInfo, CsvFieldMappingResult } from "../shared/convert";
import { DEFAULT_CONVERT_DEFAULTS } from "../shared/convert";
import { Welcome } from "./components/Welcome";
import { AppHeader } from "./components/AppHeader";
// Phase 111 (chunk D1) — the Split Navigator ratio's clamp is the panel's ONE
// exported contract, so App persists the same value the panel displays.
import { clampSplitRatio } from "./components/ContextPanel";
import { DocumentRail } from "./components/DocumentRail";
import { Toasts, type Toast } from "./components/Toasts";
import { printWindowOpenFailureMessage } from "./print-window/context";
import { TitleBar, type MenuGroup } from "./components/TitleBar";
import {
  Inspector,
  inspectorSelectionFor,
  inspectorTextPanelForSelection,
  resolveInspectorPageSize,
} from "./components/Inspector";
import type { InspectorExportRequest, InspectorTextSelection } from "./components/Inspector";
import { AboutDialog } from "./components/AboutDialog";
import { AccountsDialog } from "./components/AccountsDialog";
import { AccountMenu } from "./components/AccountMenu";
import { requestAutoSync } from "./accounts/autoSync";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { UpdateIndicator } from "./components/UpdateIndicator";
import { UpdatePromptDialog } from "./components/UpdatePromptDialog";
import {
  decideUpdatePromptOpen,
  isUpdatePromptActionable,
  updateActionableKey,
} from "./components/updatePromptMachine";
import { normalizeUpdateState } from "./components/updateStateNormalize";
import { tabsReducer, initialTabsState, resolveOpenId, type TabMeta } from "./state/tabs";
import { isSamePath } from "./state/pathIdentity";
import { allocateColorId } from "./state/tabColour";
import { pagesPanelReducer, initialPagesPanelState } from "./state/pagesPanel";
// Phase 112 (TFL-854 C2) — the PAGES Context Pair's real page meta: the label
// resolver and the multi-select identity check for the Inspector.
import { resolvePageLabel } from "./components/pageGeometry";
import { samePageSelection } from "./state/pageSelection";
// Phase 32 — Multi Mode: the two-pane view state (pure reducer) plus the
// workspace stage that renders the panes.
import {
  multiModeReducer,
  initialMultiModeState,
  paneAssignError,
  paneAssignPathError,
  type PaneId,
} from "./state/multiMode";
// Phase 36 (chunk 1b) — the stage model + the Stage Rail. The rail renders
// from App-owned state; the per-pane routing (Multi Mode tracks a stage per
// pane) is a one-line scope read/write here because the rail component keeps
// no state of its own.
import {
  editModeForStage,
  initialStageState,
  stageEffectsNeedApply,
  stageForPane,
  stageReducer,
  type Stage,
} from "./state/stages";
import { StageRail, isStageRailVisible } from "./components/StageRail";
// Phase 36 (chunk 3a) — the Action Dock's persisted pins and the registry
// lookup that validates them on read.
import {
  officeExportGate,
  readingViewGate,
  pinDockTool,
  sanitizeDockCuration,
  unpinDockTool,
  type DockAvailability,
} from "./state/dockModel";
import { saveIntentFor } from "./state/saveGuard";
import { collapsePreferenceAfterToggle, inspectorCollapsedFor, resolveDockLadder } from "./state/dockResponsive";
import { dockToolsForStage, toolById, type ToolEntry } from "./state/toolsRegistry";
import { DEFAULT_HOME_TOOLS, HOME_FIXED_TOOL_ID, sanitizeHomeTools } from "./state/homeTools";
// Phase 36 (chunk 4) — the Command Palette. `paletteChordFor` owns the
// Ctrl+K / legacy Ctrl+Shift+P chords (Ctrl+P is deliberately absent — it
// stays Print) and `bumpToolUsage` is the frequency counter the palette
// ranking reads back.
import {
  PALETTE_ACTION_REASONS,
  bumpToolUsage,
  paletteChordFor,
  paletteDisabledReasonFor,
} from "./state/commandPalette";import { CommandPalette } from "./components/CommandPalette";
// Phase 32 — the focus -> active-tab routing rules and the close/quit gate
// selection, both pure so the App wiring is a one-liner each.
import {
  resolvePaneClear,
  resolvePaneFocus,
  resolveTabStripActivation,
  shouldClearActiveOnEmptyFocus,
} from "./state/multiModeRouting";
import { collectModifiedTabIds, orderWindowCloseQueue } from "./state/closeGate";
import { resolveDockPane, resolvePaneSelection } from "./state/multiChrome";
import { planJointPaneRefresh, type JointPaneRefresh } from "./state/jointUndo";
import {
  COMPOSITE_TAB_ID,
  advanceCompositeQueue,
  compositeDocIds,
  compositeDocRefs,
  compositeHeaderTab,
  planCompositeClose,
} from "./state/compositeTab";
import { DocumentStage, type StageTab } from "./components/MultiPane";
import { multiDockBandPx } from "./components/multiPaneLayout";
import {
  PanelResizeHandle,
  clampPanelWidth,
  resolvePanelComposition,
  resolvePanelWidth,
  syncPanelWidth,
} from "./components/panels/PanelResizeHandle";
import { MultiActionDock } from "./components/MultiActionDock";
import { SharedToolController } from "./components/multiToolController";
// Phase 33 — the per-pane thumbnail strips are rendered by each pane's own
// DocumentView (`multiRail` + `railSide`), so App no longer composes a
// stage-level shared rail.
import { PageDragProvider } from "./state/PageDragContext";
import { applyPageDrop, type PageDropDeps } from "./state/pageDragApply";
import type { PageDropOp } from "./state/pageDrag";
import { nextTheme, resolveThemeDefault } from "./state/theme";
import { useThemeTransition } from "./hooks/useAnimations";
import { setAnimationsEnabledPreference } from "./hooks/motionPolicy";
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
  DEFAULT_TAB_STYLE,
  clampOcrDownsample,
  preferencesReducer,
} from "./state/preferences";
import { applyAnnotationPaletteChange } from "./state/colorPalette";
import {
  dispatchMenuAction,
  gateOnActiveDoc,
  snapshotMenuEnabled,
  type MenuActionContext,
} from "./state/menuActions";
import { shouldApplyEcho } from "./state/settingsEcho";
import { openPdfDocument, readOutline, resolveOutlinePage, type OutlineNode } from "./pdf/pdfjs";
import {
  DocumentView,
  type DocDiagnostics,
  type PersistedViewer,
  type SearchIndexProgress,
} from "./components/DocumentView";
import type { RailTab } from "./components/SideRail";
import { OutlineEditorContext } from "./components/SideRail";
import {
  seedOutlineEntries,
  type OutlineEntry,
  type SetOutlineFn,
} from "./state/outlineEditor";
import { recordRailTab, restoreRailTab } from "./state/navigatorState";
import { splitRecentPath } from "./utils/recentPath";
import { toArrayBuffer } from "./utils/toArrayBuffer";
import { createDebouncer } from "./utils/debounce";
import { formatBytes as formatBytesForToast } from "./utils/formatBytes";
import { downloadBlob } from "./utils/exportDownload";
import { PasswordPromptDialog } from "./components/PasswordPromptDialog";
import { ProtectionNotice } from "./components/ProtectionNotice";
import { ConversionNotice, ConversionProgress } from "./components/ConversionNotice";
import { ReadingView } from "./components/ReadingView";
import { BookView } from "./components/BookView";
import { BookOpen } from "lucide-react";
import { Icon } from "./icons/Icon";
import {
  associationMessageFor,
  createFromImagesRoute,
  noticeFromManyResult,
  noticeFromResult,
  routeOpenPath,
  runConvertOpen,
  toastForConvertError,
  unsupportedFileMessage,
  type ConvertNoticeState,
  type ConvertProgressState,
} from "./state/convert";
import { EncryptDialog, type EncryptDialogConfirm } from "./components/EncryptDialog";
import {
  IDLE_PASSWORD_PROMPT,
  passwordKindFromEngineError,
  passwordPromptReducer,
  type PasswordPromptKind,
  type PasswordPromptState,
} from "./security/passwordPrompt";
import { SessionPasswordStore } from "./security/sessionPasswords";
import {
  DEFAULT_ENCRYPT_DEFAULTS,
  encryptedFilename,
  normalizeEncryptDefaults,
} from "./security/encrypt";
import {
  saveAsConfirmationText,
  saveConfirmationText,
} from "./security/protection";
import {
  runMergeFromScratch,
  mergeClickStartsFromScratch,
} from "./utils/mergeFromScratch";
import { removeRecent } from "./state/recentFiles";
import { getEngine } from "./engine/engineClient";
import { MergeDialog } from "./components/MergeDialog";
import { SplitDialog } from "./components/SplitDialog";
import { OptimizeDialog } from "./components/OptimizeDialog";
import { AuditSpaceDialog } from "./components/AuditSpaceDialog";
import { SaveAsDialog } from "./components/SaveAsDialog";
import { CreateFromImagesDialog } from "./components/CreateFromImagesDialog";
import { ExportDialog } from "./components/ExportDialog";
import { exportDialogSeed } from "./components/exportConfig";
import { TextExportDialog } from "./components/TextExportDialog";
import { DocxExportDialog } from "./components/DocxExportDialog";
import { OfficeExportDialog } from "./components/OfficeExportDialog";
import { InsertPagesDialog } from "./components/InsertPagesDialog";
import { ReplacePagesDialog } from "./components/ReplacePagesDialog";
import { RenumberPagesDialog } from "./components/RenumberPagesDialog";
import { CropPagesDialog } from "./components/CropPagesDialog";
import { StampDialog } from "./components/StampDialog";
import { WatermarkDialog } from "./components/WatermarkDialog";
import { BatesDialog, type BatesConfirmOutcome } from "./components/BatesDialog";
import { CommentExportDialog } from "./components/CommentExportDialog";
import { CommentImportDialog } from "./components/CommentImportDialog";
import {
  FillFromCsvDialog,
  type FillFromCsvApplied,
} from "./components/FillFromCsvDialog";
import {
  FormDataIoDialog,
  type FormDataFormat,
} from "./components/FormDataIoDialog";
import { ValidateDocumentDialog } from "./components/ValidateDocumentDialog";
import { SanitizeDialog } from "./components/SanitizeDialog";
import { ValidationNotice } from "./components/ValidationNotice";
import { EngineeringLayersPanel } from "./components/EngineeringLayersPanel";
import { DocumentInfoDialog } from "./components/DocumentInfoDialog";
import { Pdf3dNotice } from "./components/Pdf3dNotice";
import {
  blockedSaveMessage,
  effectiveValidationDefaults,
  validationErrorText,
  validationFromSaveResult,
  withValidationDefaults,
  type ValidationNoticeState,
} from "./state/validation";
import {
  normalizeSanitizeOptions,
  type SanitizeOptions,
  type SanitizeReport,
} from "../shared/sanitize";
import { normalizeBatesDefaults } from "../shared/bates";
import { DeletePageDialog } from "./components/DeletePageDialog";
import { BlankPagesDialog } from "./components/BlankPagesDialog";
import { CloseTabPromptDialog, type CloseTabPromptChoice } from "./components/CloseTabPromptDialog";
import { SignatureManagerModal } from "./signatures/SignatureManagerModal";
import { FlattenConfirmDialog } from "./forms/FlattenConfirmDialog";
import {
  OcrDialog,
  type OcrDialogConfirm,
  type OcrScope,
} from "./components/OcrDialog";
import { rasterizePagesForOcr } from "./pdf/ocrRasterize";
import { scanBlankDocument, formatScanReport } from "./pdf/blankScan";
import { classifyPages, DEFAULT_BLANK_INK_THRESHOLD } from "../shared/blankPages";
import { defaultPrintSettings } from "./pdf/printSettings";
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
  editDockVerbFor,
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
import { buildEditTextRunPayload } from "./edit/textStyle";
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
  sameFillReport,
  sameFormFields,
  setFieldValue,
  setFormFillReport,
  toggleListboxValue,
  type FormsState,
} from "./forms/model";
import { getSignatureService } from "./signatures/service";
import { rasterizeSavedSignatureToPng } from "./signatures/canvas";
import {
  diagnosticsPublishAllowed,
  resolveEngineStateForDiagnostics,
} from "./diagnostics/resolve";
import { openRequestedPath } from "./openRequestedPath";
import { useOsFileDrop, useOsOpenPathRequests } from "./hooks/useOsIntegration";
import { useMinimizedPause } from "./hooks/useMinimizedPause";

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
  /** Phase 85 — the editable outline model seeded from `outline`, each node's
   *  destination resolved to a 1-based VISIBLE page (null for no target).
   *  Re-seeded on every bytes refresh (open / save + reload / undo / redo) so
   *  a committed edit reappears after reload. */
  outlineEntries: OutlineEntry[] | null;
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

/** Phase 52 — the source descriptor `openFromBytes` accepts. Hoisted to a
 *  named type so the password-prompt flow can stash a pending open in a ref
 *  and retry it with a password. */
interface OpenSource {
  kind: TabMeta["kind"];
  path: string;
  displayName: string;
  onDiskPath: string | null;
  dedupePath?: boolean;
}

/** Phase 33 — Multi Mode's rail is no longer a stage-level shared rail:
 *  each pane's `DocumentView` renders its OWN thumbnail strip at that
 *  pane's inner edge (see `DocumentView`'s `multiRail` prop), so the
 *  per-section data mirror that lived here is retired. */
interface AppErrorState {
  toasts: Toast[];
  nextId: number;
}type ErrorAction =
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

// Phase 58 (chunk 6c) — a detached window loads with `#detached` in its
// URL hash (packaged `loadFile(html, { hash: 'detached' })`, dev
// `rendererDevUrl#detached`). The SAME renderer is used in both windows, so
// the tear-out gesture must decide whether it moves the tab out (origin
// window) or hands it back (detached window). This is the pure decision.
const IS_DETACHED_WINDOW =
  typeof window !== "undefined" && window.location.hash === "#detached";

/** Phase 58 (chunk 6c) — a tear-out gesture in the ORIGIN window detaches
 *  the tab into a new window; the same gesture in a DETACHED window returns
 *  the tab to the origin. Pure so the branch is unit-tested directly. */
export function tabExitAction(isDetachedWindow: boolean): "return" | "detach" {
  return isDetachedWindow ? "return" : "detach";
}

/** DEF-417 — the tear-out precondition. A tab is detachable only when it
 *  has a live document session; an empty placeholder ("Empty tab") has no
 *  bytes to move, so tearing it out must FAIL LOUD with a visible reason and
 *  keep the tab — never a silent no-op. Returns the warning to surface, or
 *  `null` when the detach may proceed. Pure so the decision is unit-tested. */
export function detachRefusal(
  hasDocument: boolean,
): { kind: Toast["kind"]; text: string } | null {
  if (hasDocument) return null;
  return { kind: "warning", text: "This tab has no document to move." };
}

/** DEF-414 — carry an adopted document's unsaved state. The origin window
 *  reports whether the moved tab was dirty (`payload.modified`); in the
 *  adopting window `openFromBytes` loads the bytes fresh, so the engine
 *  reports the adopted document as CLEAN. The origin's dirty state must be
 *  carried onto the adopted tab's meta (the modified dot + the close gate +
 *  `tflexDiagnostics().tabModified`) AND the engineUi mirror
 *  (`tflexDiagnostics().modified`) so the moved document is never presented
 *  as clean. Pure so the decision is unit-tested. */
export function adoptedModifiedPatch(
  payloadModified: boolean | undefined,
): { tabModified: boolean; engineModified: boolean } {
  const dirty = payloadModified === true;
  return { tabModified: dirty, engineModified: dirty };
}

// Phase 56 (features A / C) — the document column's flow notices plus the
// format-gated reader entry, extracted so the reader trigger's independence
// from the DISMISSIBLE conversion card is pinned by a unit test. The trigger
// reads `sourceFormat` from the tab's OWN state (`sourceFormatByTab`), never
// from `conversion`; `onDismissConversion` removing the card must never remove
// the capability.
export interface DocumentSurfaceColumnProps {
  /** The rendered document surface (the pane's DocumentView). */
  document: ReactElement;
  /** The tab's conversion source format, from non-dismissible tab state. */
  sourceFormat: ConvertFormatId | undefined;
  /** The dismissible conversion card, when this tab has one. */
  conversion: ConvertNoticeState | undefined;
  validation: ValidationNoticeState | undefined;
  protection: DocumentProtectionState | undefined;
  /** Phase 57 (feature A) — 3D annotations the app cannot render. Rendered as
   *  a non-dismissible slim bar above the page area, never an overlay. */
  pdf3d?: readonly Pdf3dContent[];
  onDismissConversion: () => void;
  onDismissValidation: () => void;
  onDismissProtection: () => void;
  onOpenReadingView: () => void;
  /** Phase 66 (chunk 1) — retained on the interface for host/harness
   *  compatibility. The cbz/cbt "Open comic view" trigger was superseded by
   *  the canvas "Book View" entry, so it is no longer rendered here; the
   *  prop stays so existing DocumentSurfaceColumn mounts type-check. */
  onOpenComicView: () => void;
}

export function DocumentSurfaceColumn(props: DocumentSurfaceColumnProps): ReactElement {
  const { sourceFormat } = props;
  // Phase 66 (chunk 1) — the reader entry is EPUB ONLY now. The cbz/cbt
  // "Open comic view" trigger is gone: the canvas "Book View" control (mounted
  // in DocumentView) supersedes it for any open document.
  const showReader = sourceFormat === "epub";
  // Phase 78 (feature A) — the open-triggered notice family (protection,
  // conversion, 3D) is RE-PARENTED out of this flow column and into the
  // document element's canvas-bound overlay (DocumentView's `.canvas-overlay`,
  // via the `canvasNotices` prop). They no longer occupy a row above the
  // scroller and can never paint outside the canvas. `ValidationNotice` stays
  // here in flow: it is not produced by opening a file (Phase 67 ruling 2) and
  // Phase 78 explicitly leaves it untouched.
  const notices: ReactNode =
    props.protection !== undefined ||
    props.conversion !== undefined ||
    (props.pdf3d !== undefined && props.pdf3d.length > 0) ? (
      <>
        {props.protection !== undefined && (
          <ProtectionNotice
            protection={props.protection}
            onDismiss={props.onDismissProtection}
          />
        )}
        {props.conversion !== undefined && (
          <ConversionNotice
            notice={props.conversion}
            onDismiss={props.onDismissConversion}
          />
        )}
        {props.pdf3d !== undefined && props.pdf3d.length > 0 && (
          <Pdf3dNotice entries={props.pdf3d} />
        )}
      </>
    ) : undefined;
  // A component document element (DocumentView) takes the notices through the
  // `canvasNotices` prop and mounts them inside `.canvas-overlay`. A string
  // host element (a unit-test harness stand-in for the document surface)
  // renders them as children instead, so its DOM contract is unchanged; the
  // production mount is always DocumentView or BookView.
  const documentElement =
    notices === undefined
      ? props.document
      : typeof props.document.type === "string"
        ? cloneElement(props.document, {}, notices)
        : cloneElement(
            props.document as ReactElement<{ canvasNotices?: ReactNode }>,
            { canvasNotices: notices },
          );
  return (
    <div
      className="document-column"
      data-document-protected={props.protection !== undefined ? true : undefined}
      data-document-converted={props.conversion !== undefined ? true : undefined}
      data-document-validated={props.validation !== undefined ? true : undefined}
    >
      {props.validation !== undefined && (
        <ValidationNotice
          notice={props.validation}
          onDismiss={props.onDismissValidation}
        />
      )}
      {showReader && (
        <button
          type="button"
          className="reading-open-button"
          data-reading-open
          aria-label="Open reading view"
          onClick={props.onOpenReadingView}
        >
          <Icon icon={BookOpen} size="xs" />
          Open reading view
        </button>
      )}
      {documentElement}
    </div>
  );
}

export function App(): ReactElement {
  const [bootDone, setBootDone] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Phase 112 (C6b) — recent paths known to be missing / unopenable on disk.
  // The record is KEPT (removing history never deletes a file); the Home row
  // renders its missing state and offers Locate missing instead. Populated by
  // an open that fails with an `io` error and by `recent:showInFolder`
  // reporting `missing`.
  const [missingRecents, setMissingRecents] = useState<ReadonlySet<string>>(
    (): ReadonlySet<string> => new Set<string>(),
  );
  // Phase 16 — the side-rail pages panel can be collapsed to the ruler
  // strip. App owns the value through the pagesPanelReducer (persisted
  // in settings so it survives a restart); the rail itself never owns
  // the state (see SideRail props).
  const [pagesPanel, dispatchPagesPanel] = useReducer(
    pagesPanelReducer,
    initialPagesPanelState,
  );
  const pagesPanelCollapsed = pagesPanel.collapsed;
  // Phase 59 (item 7 follow-up) — the rail's ACTIVE TAB is HOST-owned. The
  // Pages panel's outline section and the rail's own tab strip read this one
  // value, and the palette's "Page thumbnails" / "Bookmarks" commands write it
  // (see `paletteAppActions`), so a command and a rail control can never
  // disagree. Session-only state; the entity that owns the panel.
  const [railTab, setRailTab] = useState<RailTab>("thumbs");
  // Phase 37 (items 2 + 6) — the ONE responsive controller. It keys on the
  // measured WORKSPACE width (the window content box), NOT the post-collapse
  // canvas: collapsing the Inspector/panel widens the canvas, so a ladder keyed
  // on its own output would oscillate. `resolveDockLadder` is the single pure
  // implementation and App consumes all four rungs here.
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect((): (() => void) => {
    const onResize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return (): void => window.removeEventListener("resize", onResize);
  }, []);
  const dockLadder = useMemo(() => resolveDockLadder(viewportWidth), [viewportWidth]);
  // The panel's EFFECTIVE collapsed state: the user's preference OR the
  // ladder's rung 2. The ladder never writes the persisted preference.
  const pagesPanelCollapsedEffective = pagesPanelCollapsed || dockLadder.panelCollapsed;
  // Phase 37 (items 3 + 6) — the Inspector's collapse signal: the user's own
  // collapse OR the ladder's rung 1 (the ONE `userCollapsed || rung`
  // precedence rule, `inspectorCollapsedFor`). The collapse CONTROL (this
  // chunk) toggles only the user's preference, so a manual expand can never
  // fight the ladder.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const inspectorCollapsedEffective = inspectorCollapsedFor(inspectorCollapsed, dockLadder);
  // Phase 112 (TFL-854, chunk H) — the resizable side-panel widths. App owns
  // the live value (a drag updates it without a settings write per frame); the
  // settings write happens on gesture commit through the shared trackAndSave
  // path, and the boot restore / settings echo keep it in sync. The defaults
  // (240 left / 280 right) apply only when the persisted field is absent.
  const [panelLeftWidth, setPanelLeftWidth] = useState<number>(
    (): number => resolvePanelWidth("left", undefined),
  );
  const [panelRightWidth, setPanelRightWidth] = useState<number>(
    (): number => resolvePanelWidth("right", undefined),
  );
  // Phase 111 (chunk D1) — the Split Navigator's persisted layout + ratio. App
  // owns the live values; the panel reports a settled change (layout-menu
  // selection / divider gesture settle) and App persists it through the shared
  // trackAndSave path, exactly like the panel widths above.
  const [navigatorLayout, setNavigatorLayout] = useState<'stacked' | 'split'>('stacked');
  const [navigatorSplitRatio, setNavigatorSplitRatio] = useState<number>(0.6);
  // Phase 32 — Multi Mode. The mode + the two pane slots live in App
  // (session-only, per the phase's Settings-impact line); the split is a
  // pure view value the divider drag writes.
  const [multiMode, dispatchMultiMode] = useReducer(
    multiModeReducer,
    initialMultiModeState,
  );
  // Phase 36 (chunk 1b) — the stage of work. SINGLE mode has one active
  // stage; Multi Mode tracks one per pane, so the rail reads and writes the
  // FOCUSED pane's stage while the mode is on.
  const [stageState, dispatchStage] = useReducer(stageReducer, initialStageState);
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [tabs, dispatchTabs] = useReducer(tabsReducer, initialTabsState);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenTab>>({});
  const [errorState, dispatchError] = useReducer(errorReducer, { toasts: [], nextId: 1 });
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});
  const [sampleCount, setSampleCount] = useState(0);
  // Per-tab UI state (engine state + undo/redo flags). Kept separate from
  // openTabs so the engine state can be updated without churning the rest
  // of the tab record.
  const [engineUi, setEngineUi] = useState<Record<string, EngineUiState>>({});
  // DEF-336 — print needs a real document on the ACTIVE tab. An empty
  // placeholder tab has a `tabs.activeId` but no `OpenTab` entry (no engine
  // session), so `buildActivePrintContext` returns null. Every print entry
  // point keys off this same predicate: the title-bar icon disables, the File >
  // Print item disables through the menu snapshot, and a direct request still
  // fails loud with a toast rather than a silent no-op.
  const activeTabHasDocument =
    tabs.activeId !== null && openTabs[tabs.activeId] !== undefined;
  // Dialog state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // Phase 4 — signature manager modal + flatten confirm
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [flattenOpen, setFlattenOpen] = useState(false);
  // Phase 36 (chunk 6) — the LIVE text-object selection published by the
  // active DocumentView (the edit model's selected box, or the text-run
  // target the panel edits). The Inspector's EDIT/text section reads it;
  // there is no second selection model — the view owns the selection and
  // this merely mirrors the snapshot it hands up.
  const [inspectorTextSelection, setInspectorTextSelection] =
    useState<InspectorTextSelection | null>(null);
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
  // Phase 52 (feature A) — the password prompt's state machine + the
  // pending open it is retrying. The open attempt is stashed here so a
  // cancel simply drops it (no half-open tab).
  const [passwordPrompt, setPasswordPrompt] =
    useState<PasswordPromptState>(IDLE_PASSWORD_PROMPT);
  const pendingPasswordOpenRef = useRef<{
    bytes: ArrayBuffer;
    source: OpenSource;
  } | null>(null);
  // DEF-372 — the session-only password cache that makes a password follow the
  // FILE, not the transient engine doc id. Main's `docPasswords` is keyed by
  // the engine doc id and is cleared by `closeDocument`, so a re-open of the
  // same file in the same session would re-prompt. This renderer-side store is
  // in-memory only (gone on restart), consulted before an open that would need
  // a password, and never persisted, logged or sent over IPC.
  const sessionPasswordsRef = useRef<SessionPasswordStore | null>(null);
  if (sessionPasswordsRef.current === null) {
    sessionPasswordsRef.current = new SessionPasswordStore();
  }
  const sessionPasswords = sessionPasswordsRef.current;
  // Phase 52 (feature B) — per-tab protection state from
  // `engine.getDocumentProtection`. A tab with no entry (or `null`) is a
  // plain document.
  const [protectionByTab, setProtectionByTab] = useState<
    Record<string, DocumentProtectionState>
  >({});
  // Phase 53 (feature I) — the import surface. `convertNotices` is the
  // conversion card payload per tab (dismissed entries are deleted);
  // `convertProgress` is the live affordance, null when no import runs.
  const [convertNotices, setConvertNotices] = useState<Record<string, ConvertNoticeState>>({});
  // Phase 56 (features A / C) — the NON-dismissible source format per tab. The
  // conversion card above can be dismissed; this record cannot, so the
  // reading / comic trigger stays reachable for the tab's whole lifetime. It is
  // the ONLY gate for the document-surface reader entry.
  const [sourceFormatByTab, setSourceFormatByTab] = useState<
    Record<string, ConvertFormatId>
  >({});
  const [convertProgress, setConvertProgress] = useState<ConvertProgressState | null>(null);
  // Phase 52 (feature D) — the Encrypt dialog + its in-flight flag.
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [encryptBusy, setEncryptBusy] = useState(false);
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
  // Phase 55 (feature D) — the two office-export dialogs (`export:xlsx` /
  // `export:pptx`). They share ONE parameterised dialog component.
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const [pptxExportOpen, setPptxExportOpen] = useState(false);
  // Phase 112 (C5 follow-up, TFL-985) - the Deliver inspector's prepared export
  // request, held only while an export dialog is open so the EXISTING dialog is
  // seeded with the user's configured format / range / DPI / output name. The
  // effect below clears it the moment every export dialog is closed, so a later
  // toolbar open is unseeded.
  const [inspectorExportSeed, setInspectorExportSeed] =
    useState<InspectorExportRequest | null>(null);
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
  // Phase 18 — watermark dialog (text or image overlay). Opened from
  // the toolbar / tools palette entry; the dialog drives its own
  // engine IPC through onWatermarkConfirm.
  const [watermarkOpen, setWatermarkOpen] = useState(false);
  // Phase 89 (FEA-033) — Bates-numbering dialog. Opened from the REVIEW
  // dock / palette entry; the dialog drives its own engine IPC through
  // onBatesConfirm.
  const [batesOpen, setBatesOpen] = useState(false);
  // Phase 18 — applied-watermark list for the active doc, fetched from
  // `engine.getWatermarks` each time the dialog opens (informational
  // only: the dialog's list also drives per-id delete).
  const [watermarkList, setWatermarkList] = useState<WatermarkInfo[]>([]);
  // DEF-219 — single-flight delete: id whose delete is in flight (drives
  // the dialog row's disabled Delete), backed by a ref so the guard does
  // not read a stale state value when two clicks land in one tick.
  const [deletingWatermarkId, setDeletingWatermarkId] = useState<string | null>(null);
  const deleteInFlightRef = useRef<boolean>(false);
  // Phase 90 (TFL-509-C1) — applied-Bates list for the active doc, fetched
  // from `engine.getBates` (feeds the unified review list's Bates category).
  const [batesList, setBatesList] = useState<BatesInfo[]>([]);
  // Phase 90 (TFL-509-C2) — the run / watermark a review-list edit is updating.
  // Null means the dialogs open in APPLY mode; a target switches them to UPDATE.
  const [batesEditTarget, setBatesEditTarget] = useState<BatesInfo | null>(null);
  const [watermarkEditTarget, setWatermarkEditTarget] = useState<WatermarkInfo | null>(null);
  // Phase 90 (TFL-509-C1) — per-row fail-loud messages for the unified review
  // list, keyed by `<type>:<id>`. A failed delete sets the row's message; a
  // successful one clears it (Ruling 9: never silently hidden).
  const [reviewElementErrors, setReviewElementErrors] = useState<Record<string, string>>({});
  const [commentExportOpen, setCommentExportOpen] = useState(false);
  const [commentImportOpen, setCommentImportOpen] = useState(false);
  // Phase 53 (feature G mode 2) — the Fill-form-fields-from-CSV dialog.
  const [fillFromCsvOpen, setFillFromCsvOpen] = useState(false);
  // Phase 57 (feature B) — the Export / Import form-data dialog. `mode`
  // decides which half renders; the format selector lives on the dialog.
  const [formDataIo, setFormDataIo] = useState<{
    open: boolean;
    mode: "export" | "import";
  }>({ open: false, mode: "export" });
  // Phase 54 (features D + E) — the Validate-document dialog and the per-tab
  // report cards (keyed by tab id; dismissing deletes the entry for good).
  const [validateOpen, setValidateOpen] = useState(false);
  // Phase 88 (FEA-037) — the Sanitize-document dialog. The op runs through the
  // engine client; the per-class report renders inline in the dialog.
  const [sanitizeOpen, setSanitizeOpen] = useState(false);
  const [validationNotices, setValidationNotices] = useState<
    Record<string, ValidationNoticeState>
  >({});
  // Phase 57 (feature A) — the per-document engineering surfaces, keyed by the
  // engine doc id (stable for the tab's life). Fetched when the active doc
  // changes and refreshed after a successful layer toggle. The 3D list is
  // also rendered as a non-dismissible notice above the page area.
  const [layersByDoc, setLayersByDoc] = useState<Record<string, PdfLayer[]>>({});
  const [cadByDoc, setCadByDoc] = useState<Record<string, PdfCadMetadata | null>>({});
  const [content3dByDoc, setContent3dByDoc] = useState<Record<string, Pdf3dContent[]>>({});
  // Phase 111 (chunk D2a) — the active navigator view, remembered SEPARATELY
  // per document (keyed by the stable engine doc id). Session-only: never
  // persisted to settings. The refs hold the latest values so the restore
  // effect keys ONLY on a document change, never on a tab click.
  const [railTabByDoc, setRailTabByDoc] = useState<Record<string, RailTab>>({});
  const railTabRef = useRef<RailTab>(railTab);
  railTabRef.current = railTab;
  const railTabByDocRef = useRef<Record<string, RailTab>>(railTabByDoc);
  railTabByDocRef.current = railTabByDoc;
  const prevEngineDocIdRef = useRef<string | null>(null);
  // The two feature-A dialogs.
  const [engineeringLayersOpen, setEngineeringLayersOpen] = useState(false);
  const [documentInfoOpen, setDocumentInfoOpen] = useState(false);
  // B8 — delete pages dialog. The toolbar's Delete control opens
  // this dialog; the rail's per-thumb delete still flows through
  // the existing onDelete callback directly (no dialog) so a
  // single-thumb click is unaffected.
  const [deletePageOpen, setDeletePageOpen] = useState(false);
  // Phase 87 (FEA-039) — Remove blank pages. The scan dialog is a pure UI
  // shell; App owns the measurements, the scan lifecycle and the removal op.
  // `blankScanAbortRef` cancels an in-flight raster sweep when the dialog
  // closes; `blankScanMeasurementsRef` lets the removal callback read the
  // latest measurements without being re-created (same pattern as settingsRef).
  const [blankPagesOpen, setBlankPagesOpen] = useState(false);
  const [blankScanRunning, setBlankScanRunning] = useState(false);
  const [blankScanProgress, setBlankScanProgress] = useState(0);
  const [blankScanMeasurements, setBlankScanMeasurements] =
    useState<BlankPageMeasurement[] | null>(null);
  const [blankScanReport, setBlankScanReport] = useState<string | null>(null);
  const blankScanAbortRef = useRef<AbortController | null>(null);
  // Phase 36 (chunk 2) — the PAGES panel's "Delete…" gesture seeds the
  // dialog with the page it landed on. null means "no seed": the toolbar's
  // Delete button and the palette open the dialog seeded from the tab's
  // current page, exactly as before.
  const [deletePageSeed, setDeletePageSeed] = useState<number | null>(null);
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
  // Phase 36 (chunk 5) — the INSPECTOR. It REPLACES the retired All-tools
  // palette as the workspace's right panel. It is not a toggled overlay any
  // more: it is visible whenever a real document is open, and the panel-inset
  // machinery below reads the same derived flag (`inspectorOpen`). The
  // palette's `toolsPaletteLayout` setting stays a tolerated legacy key with
  // no renderer writer (AppSettings, main-process validator).
  //
  // Phase 36 (chunk 4) — the Command Palette (`Ctrl+K`). Session-only; it is
  // the browse-everything surface that superseded the All-tools panel.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Phase 56 (features A / C) — the active reading session (null = closed).
  // One shell serves both EPUB and comic modes (feature D).
  const [readingView, setReadingView] = useState<{ mode: "epub" | "comic" } | null>(null);
  // Phase 66 (chunk 1) — the in-canvas read-only Book View. Session-only; the
  // value is the tab it belongs to, so switching tabs cannot leave a stale
  // book surface on a different document. Opens from the canvas entry and is
  // cleared by its own close control.
  const [bookViewTabId, setBookViewTabId] = useState<string | null>(null);
  // True only while the Book View belongs to the ACTIVE tab. It forces the
  // rail and Inspector collapse (derived, never persisted) and is cleared
  // simply by the mode closing or the active tab changing.
  const bookViewActive = bookViewTabId !== null && bookViewTabId === tabs.activeId;
  const inspectorCollapsedForBookView = inspectorCollapsedEffective || bookViewActive;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Phase 44 — the account surface. `accountsOpen` is only ever meaningful
  // while `settings.accountsEnabled` is true; the flag gates BOTH the top-bar
  // control and this dialog, so with the flag off nothing account-related is
  // reachable. The status/email mirror the account surface for the top-bar
  // label, reported back through `onStatusChange`.
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState<{
    signedIn: boolean;
    email: string | null;
    name: string | null;
    image: string | null;
  }>({
    signedIn: false,
    email: null,
    name: null,
    image: null,
  });
  // Phase 44 (operator amendment) — read the held session once so the top-bar
  // account section shows the signed-in avatar on boot, before any dialog
  // opens. Local vault IPC only (no network): the encrypted session already
  // holds the name and avatar URL, so both are available at launch.
  // `name` / `image` are treated as "unknown" when null (legacy sessions).
  useEffect(() => {
    if (settings?.accountsEnabled !== true) return undefined;
    const api = (window as unknown as {
      tflex?: { accounts?: { getStatus?: () => Promise<{ status: string; email: string | null; name: string | null; image: string | null }> } };
    }).tflex?.accounts;
    if (api?.getStatus === undefined) return undefined;
    let cancelled = false;
    void api.getStatus().then((result) => {
      if (cancelled) return;
      setAccountStatus({
        signedIn: result.status === "signed-in",
        email: result.email,
        name: result.name,
        image: result.image,
      });
    }).catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [settings?.accountsEnabled]);
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
  // and the EDIT stage's dock arms the edit-layer tools on the
  // page. The
  // active tool / selection / placements list is per-tab and
  // lives on `openTabs[id].edit`.
  const [editModeOpen, setEditModeOpen] = useState(false);
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
  /** Phase 84 (True redaction) — the Redact tool is armed. While true,
   *  every PageView mounts the RedactionOverlay so the user can drag a
   *  region into a pending mark and Apply it through the engine. */
  const [redactArmed, setRedactArmed] = useState(false);
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
  const blankScanMeasurementsRef = useRef<BlankPageMeasurement[] | null>(null);
  blankScanMeasurementsRef.current = blankScanMeasurements;
  const bootstrapRef = useRef(bootstrap);
  bootstrapRef.current = bootstrap;
  const savedSignaturesRef = useRef(savedSignatures);
  savedSignaturesRef.current = savedSignatures;
  const activeTabIdRefLocal = useRef<string | null>(null);
  // Phase 37 item 17 — forward declaration for the print entry point (defined
  // later, next to the other dialog handlers). The `onPrintRequest` menu
  // subscription below is mounted once with empty deps, so it reaches the
  // latest opener through this ref instead of re-subscribing. Same
  // forward-declared-ref pattern as `activeTabIdRefLocal` above.
  const openPrintWindowRef = useRef<() => void>(() => undefined);
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
  // Phase 32 (DEF-277/DEF-278) — the generic open handlers (`onOpenClick`,
  // `onSampleClick`, `onRecentClick`) are declared BEFORE the Multi Mode
  // handlers, so they reach the open routing through this forward-declared
  // ref instead of a useCallback dependency on a later const (which would
  // be a TDZ reference in the dep array). Same pattern as
  // `refreshDocProxyForRef` above. The ref is filled in every render next to
  // `assignPaneDocument`, so its closure always sees the current focused
  // pane.
  const routeOpenedTabRef = useRef<{
    /** Refuse the open when the file is already the other pane's document
     *  (shows the message itself). Returns true when the open must stop. */
    refuseFocused: (filePath: string | null) => boolean;
    /** Assign a freshly opened tab to the FOCUSED pane (Multi Mode only;
     *  single mode is a no-op and the open's own activation stands). */
    show: (tabId: string) => void;
  } | null>(null);
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

  // Phase 34 (chunk 2) — the composite tab's close flow. Like the DEF-142
  // window-close queue, but it DEFERS every close until the whole queue
  // resolves: the composite tab owns BOTH pane documents, so Cancel must
  // abort the close and leave both alive (a per-step `performCloseTab`
  // would strand a half-empty workspace). `compositeCloseIdsRef` is both
  // documents to close at the end; `compositeCloseQueueRef` is the modified
  // subset still to prompt. Both null outside a composite close.
  const compositeCloseIdsRef = useRef<string[] | null>(null);
  const compositeCloseQueueRef = useRef<string[] | null>(null);

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

  // Phase 84 — persist the chosen redaction mark colour through the same
  // settings write path every other preference uses.
  const onMarkColorChange = useCallback(
    (hex: string): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const next = { ...prev, redactionColor: hex };
        trackAndSave(next);
        return next;
      });
    },
    [trackAndSave],
  );

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
      // Phase 112 (TFL-854, chunk H) — restore the resizable panel widths and
      // the inspector collapse preference. Absent fields resolve to the
      // documented defaults (240 / 280 / false).
      setPanelLeftWidth(resolvePanelWidth("left", b.settings.panelLeftWidthPx));
      setPanelRightWidth(resolvePanelWidth("right", b.settings.panelRightWidthPx));
      setInspectorCollapsed(b.settings.inspectorCollapsed ?? false);
      // Phase 111 (chunk D1) — restore the Split Navigator layout + ratio.
      // Absent / invalid fields resolve to the documented defaults
      // ('stacked' / 0.6); the ratio is clamped to 0.1-0.9.
      setNavigatorLayout(b.settings.navigatorLayout === "split" ? "split" : "stacked");
      setNavigatorSplitRatio(
        typeof b.settings.navigatorSplitRatio === "number"
          ? clampSplitRatio(b.settings.navigatorSplitRatio)
          : 0.6,
      );
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
      // Phase 112 (TFL-854, chunk H) — keep the panel widths + inspector
      // collapse in sync with settings echoes (preserve-if-valid: an absent /
      // invalid field leaves the local value alone).
      setPanelLeftWidth((prev) => syncPanelWidth("left", s.panelLeftWidthPx, prev));
      setPanelRightWidth((prev) => syncPanelWidth("right", s.panelRightWidthPx, prev));
      if (typeof s.inspectorCollapsed === "boolean") {
        setInspectorCollapsed(s.inspectorCollapsed);
      }
      // Phase 111 (chunk D1) — keep the Split Navigator in sync with settings
      // echoes (preserve-if-valid: an absent / invalid field leaves the local
      // value alone, so a stale echo can never revert the live layout).
      if (s.navigatorLayout === "stacked" || s.navigatorLayout === "split") {
        setNavigatorLayout(s.navigatorLayout);
      }
      if (typeof s.navigatorSplitRatio === "number" && Number.isFinite(s.navigatorSplitRatio)) {
        setNavigatorSplitRatio(clampSplitRatio(s.navigatorSplitRatio));
      }
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

  // Phase 23 — the Animations setting drives BOTH motion layers from one
  // place: the module-level effective-motion store (read by every JS
  // motion hook through `useInstantMotion`) and the CSS root hook
  // (`<html data-animations="off">`, which neutralises the CSS
  // animations/transitions app-wide). A null/absent settings blob means
  // the default (ON); `!== false` is the read rule the shared contract
  // documents. Runs whenever the stored value changes, so the Preferences
  // toggle applies immediately.
  useEffect(() => {
    const enabled = settings?.animationsEnabled !== false;
    setAnimationsEnabledPreference(enabled);
    document.documentElement.dataset.animations = enabled ? "on" : "off";
  }, [settings?.animationsEnabled]);

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
      // an engine op). Phase 32 — this iterates EVERY tab, so it
      // already covers the unsaved changes of BOTH Multi Mode panes
      // (a pane's document is a tab); it never looks at the focused
      // pane or the active tab alone.
      const modifiedIds = collectModifiedTabIds(
        tabsRef.current.tabs,
        engineUiRef.current,
      );
      if (modifiedIds.length === 0) {
        // Nothing to save anywhere — the close may proceed.
        void window.tflex.confirmClose?.(true);
        return;
      }
      // If a per-tab close prompt is already showing, keep that tab
      // first so the open dialog continues to own the flow; the rest
      // of the modified tabs follow.
      const queue = orderWindowCloseQueue(
        modifiedIds,
        pendingCloseTabIdRef.current,
      );
      setWindowCloseQueue(queue);
      setPendingCloseTabId(queue[0] ?? null);
      setPendingCloseError(null);
      setPendingCloseSaving(false);
    });
    return unsubscribeCloseRequest;
  }, []);

  // Phase 37 item 17 — File > Print / Ctrl+P (pushed from the main-process
  // menu) opens the STANDALONE print window for the active document, exactly
  // like the title-bar Print icon. Guard on an active tab: with no document
  // open there is nothing to print. The opener reads the live tab through
  // refs, so the subscription stays stable and unsubscribes on unmount.
  useEffect(() => {
    if (typeof window.tflex.onPrintRequest !== "function") return;
    const unsubscribePrintRequest = window.tflex.onPrintRequest(() => {
      openPrintWindowRef.current();
    });
    return unsubscribePrintRequest;
  }, []);

  // DEF-303 — `backgroundThrottling: false` was tried and reverted (Chromium
  // still suspends a minimised window's frames), and `visibilitychange` does
  // not report a minimise, so the explicit `onMinimizedChanged` signal is
  // what parks the PDF render/raster work while minimised. Main pushes
  // `window:minimizedChanged` on minimise/restore; this one subscription
  // drives the renderer's single
  // suspend state (`state/renderSuspend`), which the page render and
  // thumbnail raster entry points consult to park their expensive work and
  // flush it on resume. Mounted once; unsubscribes on unmount.
  useMinimizedPause();

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
          if (!cancelled) setUpdateState(normalizeUpdateState(next));
        })
        .catch(() => {
          if (!cancelled) setUpdateState(normalizeUpdateState(null));
        });
    }
    if (typeof updateApi.onStatusChanged !== "function") return;
    const unsubscribe = updateApi.onStatusChanged((next) => {
      if (!cancelled) setUpdateState(normalizeUpdateState(next));
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

  // Phase 105 (chunk C) — the borderless 4-option theme picker is RETIRED
  // from the title row; the application menu's "Toggle Theme" row (the
  // existing `toggleTheme` action) is the title-row route, and the Preferences
  // sheet keeps its own themed picker. `onToggleTheme` above is the single
  // cycle handler both the menu row and the accelerator use.

  // Phase 16 — collapse / expand the side-rail pages panel. App owns
  // the value and persists it through the same trackAndSave path as
  // every other settings field. No persist while settings hasn't
  // loaded: the backend save replaces the ENTIRE settings object, so
  // writing a partial object would wipe theme / geometry / recents
  // (same null-guard shape as onToggleTheme above).
  const togglePagesPanelCollapsed = useCallback((): void => {
    // DEF-335 — record the intent the control's label shows. While rung 2
    // forces the panel collapsed the control reads "Expand", so one click
    // records the expand preference; the panel then expands once the window
    // grows past 1000. At a ladder-idle width this is a both-ways toggle.
    const next = collapsePreferenceAfterToggle(pagesPanelCollapsedEffective);
    dispatchPagesPanel({ type: "set", collapsed: next });
    if (settings === null) return;
    const updated: AppSettings = { ...settings, pagesPanelCollapsed: next };
    trackAndSave(updated);
  }, [pagesPanelCollapsedEffective, settings, trackAndSave]);

  // Phase 112 (TFL-854, chunk H) — the Inspector collapse control persists its
  // preference through the SAME trackAndSave path. DEF-335: the control records
  // the intent its label shows (while the ladder forces the collapse it reads
  // "Expand", so one click records the expand preference).
  const toggleInspectorCollapsed = useCallback((): void => {
    const next = collapsePreferenceAfterToggle(inspectorCollapsedEffective);
    setInspectorCollapsed(next);
    setSettings((prev) => {
      if (prev === null) return prev;
      const updated: AppSettings = { ...prev, inspectorCollapsed: next };
      trackAndSave(updated);
      return updated;
    });
  }, [inspectorCollapsedEffective, trackAndSave]);

  const pushToast = useCallback((kind: Toast["kind"], text: string): void => {
    dispatchError({ type: "push", toast: { kind, text } });
  }, []);
  const dismissToast = useCallback((id: number): void => {
    dispatchError({ type: "dismiss", id });
  }, []);

  // DEF-230 (ADV-049) — a failed settings write no longer rejects:
  // the backend rolls the in-memory state back to the last persisted
  // value and resolves, then pushes `settings:writeError`. This
  // subscription is the ONLY signal the renderer gets that the value
  // did not persist, so surface it as an error toast (the DEF-207
  // settings-recovery notice style) instead of letting the failure
  // pass as a silent no-op. Mirrors the settings.changed subscription
  // above, including its unsubscribe.
  useEffect(() => {
    const settingsApi = window.tflex.settings;
    if (settingsApi === undefined || typeof settingsApi.writeError !== "function") {
      return;
    }
    return settingsApi.writeError((message): void => {
      pushToast("error", `Settings could not be saved: ${message}`);
    });
  }, [pushToast]);

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
        "Update checks are not available in this build of Jovrel.",
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
          return `This PDF is encrypted and could not be opened ("${splitRecentPath(path).name}").`;
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
      // TFL-776.6 (DEF-564) — a successful op advances the engine history. The
      // renderer-only text-run commit registry mirrors it: stamp any commit
      // whose engine op just landed with this post-op depth, and drop commits
      // the new op's cleared-redo branch has permanently overwritten. Guarded
      // inside the updater so a tab with no commits never re-renders.
      setOpenTabs((tabs) => {
        const t = tabs[tabId];
        if (t === undefined) return tabs;
        const edit = editReducer(t.edit, {
          type: "reconcile-text-run-history",
          undoCount: counters.undoCount,
          phase: "op",
        });
        if (edit === t.edit) return tabs;
        return { ...tabs, [tabId]: { ...t, edit } };
      });
    },
    [setEngineUiFor],
  );

  /** Phase 85 — commit an edited outline tree through the engine and mirror
   *  the resulting state (modified flag / undo availability) into the owning
   *  tab. Shared by every pane via the OutlineEditorContext. */
  const commitOutline = useCallback<SetOutlineFn>(
    async (docId, entries) => {
      const engine = engineRef.current;
      if (engine.setOutline === undefined) {
        return err(
          "engine-error",
          "Outline editing requires the Phase 85 backend update.",
        );
      }
      const result = await engine.setOutline(docId, entries);
      if (result.ok) {
        const tabId = Object.keys(openTabsRef.current).find(
          (candidate) =>
            openTabsRef.current[candidate]?.session.engineDocId === docId,
        );
        if (tabId !== undefined) noteOpApplied(tabId, result.value);
      }
      return result;
    },
    [noteOpApplied],
  );


  const openFromBytes = useCallback(
    async (
      bytes: ArrayBuffer,
      source: OpenSource,
      options?: {
        /** Phase 52 — a password to try on both open paths. */
        password?: string;
        /** Phase 52 — called instead of toasting when either open path
         *  reports `need-password` / `incorrect-password`. The caller owns
         *  the prompt + retry. */
        onPasswordRequired?: (kind: PasswordPromptKind) => void;
        /** Phase 53 — an engine doc id ALREADY registered by
         *  `convert.toDocument`. When set, the engine-registration block is
         *  SKIPPED (the engine holds the doc already; loading again would
         *  re-register it and mint a phantom document) and this id is used
         *  instead of a fresh one — the single-docId invariant. */
        engineDocId?: string;
      },
    ): Promise<{ tabId: string; engineDocId: string } | null> => {
      const parsed = await openPdfDocument(bytes, options?.password);
      if ("password" in parsed) {
        // Encrypted: hand the classification to the caller (the open flow
        // prompts + retries); no toast, no tab. A caller with no prompt
        // (a derived-bytes open) fails loud rather than silently.
        if (options?.onPasswordRequired !== undefined) {
          options.onPasswordRequired(parsed.password);
        } else {
          pushToast("error", `"${source.displayName}" is password-protected.`);
        }
        return null;
      }
      if (!("doc" in parsed)) {
        pushToast("error", toastForPdfError(parsed.error, source.path));
        return null;
      }
      const doc = parsed.doc;
      // Phase 53 — the convert route passes the docId it already registered
      // with the engine; every other caller mints a fresh one.
      const engineDocId = options?.engineDocId ?? crypto.randomUUID();
      const password = options?.password;
      const onPasswordRequired = options?.onPasswordRequired;
      // DEF-036: single-source id. Compute the tab id BEFORE we touch
      // openTabs / engineUi / dispatchTabs, so the id used for the
      // session map (openTabs[id]) and the meta dispatched to the
      // reducer are identical. resolveOpenId reuses the active empty
      // tab's id when one is active ("+ tab" affordance fills in
      // place), and mints a fresh UUID otherwise.
      const { id, fillsEmptyId } = resolveOpenId(
        tabsRef.current,
        { kind: source.kind, filePath: source.path },
      );
      // DEF-277 — the id the reducer will actually ACTIVATE. When the same
      // path is already open, `tabsReducer.open` collapses the incoming
      // meta onto the existing tab (path dedupe) and activates THAT tab, so
      // the freshly minted `id` would name no live tab. Multi Mode assigns
      // the returned id to a pane, so the return must be the live id.
      // Mirrors the reducer's own rule: dedupe is skipped when the open
      // fills an empty tab (`fillsEmptyId`) or when the caller opts out.
      const dedupeTarget =
        fillsEmptyId === null && source.dedupePath !== false && source.path !== ""
          ? tabsRef.current.tabs.find((t) => isSamePath(t.filePath, source.path))
          : undefined;
      const effectiveId = dedupeTarget?.id ?? id;
      // Phase 105 (chunk B) — mint the session identity alongside the id, at
      // this single source of truth. If this open FILLS an existing empty tab,
      // preserve that tab's identity so filling never recolours the session;
      // otherwise allocate the first unused id against the sessions currently
      // open. Never derived from strip index.
      const filledTab =
        fillsEmptyId !== null
          ? tabsRef.current.tabs.find((t) => t.id === fillsEmptyId)
          : undefined;
      const usedColorIds = tabsRef.current.tabs
        .map((t) => t.colorId)
        .filter((c): c is string => c !== undefined);
      const colorId = filledTab?.colorId ?? allocateColorId(usedColorIds);
      const meta: TabMeta = {
        id,
        title: source.displayName,
        filePath: source.path,
        kind: source.kind,
        colorId,
        modified: false,
      };
      const session: DocSession = {
        doc,
        outline: null,
        outlineEntries: null,
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
        // Phase 59 (item 6) — every new document opens at fit-page (the whole
        // first page visible), not fit-width. The user's later zoom change
        // (fit-width or a manual step) is persisted back through `onPersist`
        // and honoured until the next open.
        zoomMode: "fit-page",
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
      //
      // Phase 52 — the same optional password opens an encrypted document
      // on the edit path; a password failure is reported to the caller so
      // it can prompt rather than toast.
      const passwordFailure = (loadError: unknown): boolean => {
        const kind = passwordKindFromEngineError(
          loadError as Parameters<typeof passwordKindFromEngineError>[0],
        );
        if (kind === null) return false;
        if (onPasswordRequired !== undefined) {
          onPasswordRequired(kind);
        } else {
          pushToast("error", `"${source.displayName}" is password-protected.`);
        }
        void doc.destroy().catch(() => undefined);
        return true;
      };
      // Phase 53 — skip engine registration when the convert route already
      // registered this docId (see the `engineDocId` option above).
      if (options?.engineDocId === undefined) {
        if (source.onDiskPath !== null) {
          const loadResult = await engineRef.current.loadDocument(
            engineDocId,
            source.onDiskPath,
            password,
          );
          if (!loadResult.ok) {
            if (passwordFailure(loadResult.error)) return null;
            pushToast("error", describeEngineError("open-error", source.onDiskPath));
            void doc.destroy().catch(() => undefined);
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
              password,
            );
            if (!loadResult.ok) {
              if (passwordFailure(loadResult.error)) return null;
              pushToast(
                "error",
                describeEngineError("open-error", source.displayName),
              );
              void doc.destroy().catch(() => undefined);
              return null;
            }
          } else {
            stubRendererEngine.registerTab(engineDocId, doc.numPages);
          }
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
        doc.numPages,
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
        void doc.destroy().catch(() => undefined);
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
      // Phase 52 (feature B) — read the source document's encryption state
      // once so the banner can report it truthfully. A backend without the
      // channel simply leaves the tab unmarked (plain).
      if (engineRef.current.getDocumentProtection !== undefined) {
        const protectionResult =
          await engineRef.current.getDocumentProtection(engineDocId);
        if (protectionResult.ok && protectionResult.value !== null) {
          setProtectionByTab((prev) => ({ ...prev, [id]: protectionResult.value as DocumentProtectionState }));
        }
      }
      dispatchTabs({ type: "open", tab: meta, dedupePath: source.dedupePath });

      // Phase 4 — kick off the form-field load in the background. The
      // editor overlay renders nothing until loaded is true; we don't
      // block the open on it. We pass `engineDocId` explicitly because
      // `openTabsRef.current[id]` is stale at this point — React has
      // not committed the `setOpenTabs` call above yet, so the ref
      // hasn't refreshed. Reading the docId we just minted is exact
      // and avoids a race that previously left the form list empty.
      void loadFormFields(id, engineDocId);

      void readOutline(doc)
        .then(async (outline) => {
          // Phase 85 — seed the editable model with each node's destination
          // resolved to a 1-based VISIBLE page. An outline-less document
          // seeds an empty (non-null) model so the panel can add a first
          // entry.
          const entries = await seedOutlineEntries(outline ?? [], (dest) =>
            resolveOutlinePage(doc, dest),
          );
          setOpenTabs((prev) => {
            const existing = prev[id];
            if (existing === undefined) return prev;
            return {
              ...prev,
              [id]: {
                ...existing,
                session: { ...existing.session, outline, outlineEntries: entries },
              },
            };
          });
        })
        .catch(() => undefined);
      // Phase 40 item 4 — the engine doc id is returned alongside the
      // tab id so the from-scratch merge flow can address the freshly
      // opened document without racing the `openTabs` state commit
      // (`openTabsRef` is stale until React re-renders — see the
      // loadFormFields comment above).
      //
      // DEF-372 — a password that successfully opened a real on-disk file is
      // remembered for the rest of the session, keyed by the file (not the
      // transient engine doc id), so closing and re-opening that file does not
      // re-prompt. Byte-only opens (samples, derived create/split outputs)
      // have no stable on-disk identity and are never cached. A failed open
      // returned before this point, so only a password that worked is stored;
      // a later stale entry is overwritten when a retry succeeds.
      if (
        source.onDiskPath !== null &&
        typeof password === "string" &&
        password.length > 0
      ) {
        sessionPasswords.remember(source.onDiskPath, password);
      }
      return { tabId: effectiveId, engineDocId };
    },
    [pushToast, sessionPasswords, toastForPdfError],
  );

  /** Phase 52 — keep the Recents list honest after a successful open (the
   *  plain path and the post-password retry both call it). */
  const recordRecentOpen = useCallback(
    async (path: string, displayName: string): Promise<void> => {
      if (settings === null) return;
      const recent: RecentFile = {
        path,
        name: displayName,
        openedAt: new Date().toISOString(),
      };
      await window.tflex.addRecentFile(recent);
    },
    [settings],
  );

  /** Phase 52 (feature A) — one open attempt that routes password failures
   *  into the prompt instead of a toast. The pending open is stashed so a
   *  cancel can drop it without creating a tab. */
  const attemptFileOpen = useCallback(
    async (
      bytes: ArrayBuffer,
      source: OpenSource,
      password: string | undefined,
    ): Promise<{ tabId: string; engineDocId: string } | null> => {
      return openFromBytes(bytes, source, {
        password,
        onPasswordRequired: (kind: PasswordPromptKind): void => {
          pendingPasswordOpenRef.current = { bytes, source };
          setPasswordPrompt((prev) =>
            passwordPromptReducer(
              prev,
              kind === "incorrect"
                ? { type: "incorrect" }
                : { type: "need", target: source.displayName },
            ),
          );
        },
      });
    },
    [openFromBytes],
  );

  /**
   * The unchanged PDF open path. Phase 53 only renamed this from
   * `openPdfFromPath`: the body is byte-for-byte the pre-Phase-53 open, so a
   * real `.pdf` (and a corrupt one) keeps today's exact behaviour, messages
   * and error codes. `openPdfFromPath` below routes to it whenever the file
   * is not a recognised convertible.
   */
  const openPdfBytesFromPath = useCallback(
    // Phase 32 — returns the opened tab's id (or null when the open
    // failed / was cancelled) so the empty pane's Open action can put the
    // new document straight into that pane. Existing callers ignore it.
    async (path: string): Promise<string | null> => {
      const result = await window.tflex.loadPdf(path);
      if (!result.ok) {
        pushToast("error", toastForPdfError(result.error.code, path));
        // Phase 112 (C6b) — a file that cannot be read keeps its history
        // record (removing history never deletes a file) and is flagged
        // missing so the Home row offers Locate missing instead of a dead
        // entry. Replaces the old silent removal on an `io` error.
        if (result.error.code === "io") {
          setMissingRecents((prev) => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
          });
        }
        return null;
      }
      const displayName = splitRecentPath(path).name;
      const source: OpenSource = {
        kind: "file",
        path,
        displayName,
        onDiskPath: path,
      };
      // DEF-372 — if this file's password is already known for the session,
      // hand it to the open so neither pdf.js nor the engine prompts again.
      // An absent entry (first open, a different file, or a fresh app session)
      // falls through to the normal prompt. A stale entry fails with
      // `incorrect-password`, which routes into the same prompt/retry.
      const sessionPassword = sessionPasswords.recall(path);
      const opened = await attemptFileOpen(toArrayBuffer(result.value), source, sessionPassword);
      if (opened === null) return null;
      await recordRecentOpen(path, displayName);
      return opened.tabId;
    },
    [
      attemptFileOpen,
      pushToast,
      recordRecentOpen,
      sessionPasswords,
      toastForPdfError,
    ],
  );

  /**
   * Phase 53 (feature I) — the convert route. `sourceInfo` already
   * recognised the file. Mint ONE docId (the job id AND the engine doc id —
   * never a second) and hand it to `convert.toDocument`, which registers it
   * with the engine; read the produced bytes back under that SAME id and run
   * the shared tab setup with `registerEngine: false` so nothing re-registers
   * the document. The source file is NOT the tab's save target: `onDiskPath`
   * stays null so a converted import can never overwrite its `.txt` / `.csv`
   * / `.rtf` origin (Save is disabled, Save As writes a new PDF).
   */
  const openConvertedFromPath = useCallback(
    async (
      path: string,
      info: ConvertSourceInfo,
      api: TFlexApiConvert,
    ): Promise<string | null> => {
      const displayName = splitRecentPath(path).name;
      const source: OpenSource = {
        kind: "file",
        path,
        displayName,
        onDiskPath: null,
      };
      const docId = crypto.randomUUID();
      // A visible affordance from the first frame; runConvertOpen refines
      // the phase as main pushes progress.
      setConvertProgress({ docId, phase: "Preparing" });
      const opened = await runConvertOpen({
        path,
        displayName,
        api,
        // The Phase 11 bytes hook. A backend without it cannot hand the
        // converted bytes to PDF.js; runConvertOpen reports it once.
        getDocumentBytes: (id) => {
          // DEF-374 — call the method ON the engine. Extracting it into a
          // local alias loses `this` on RealEngineAdapter's prototype method
          // and throws `Cannot read properties of undefined (reading 'inner')`.
          if (engineRef.current.getDocumentBytes === undefined) {
            return Promise.resolve({ ok: false as const, error: { code: "internal", message: "no-bytes-api" } });
          }
          return engineRef.current.getDocumentBytes(id);
        },
        // The converted bytes enter the SAME tab-setup as a PDF open, with
        // `engineDocId` set so the engine — which already holds the doc from
        // `convert.toDocument` — is not re-registered.
        createTab: async ({ docId: registeredId, bytes }) => {
          const opened = await openFromBytes(bytes, source, { engineDocId: registeredId });
          return opened === null ? null : opened.tabId;
        },
        onOpened: ({ tabId, result }) => {
          setConvertNotices((prev) => ({
            ...prev,
            [tabId]: noticeFromResult(info.label, result),
          }));
          // The non-dismissible tab state the reader trigger gates on.
          setSourceFormatByTab((prev) => ({ ...prev, [tabId]: result.sourceFormat }));
        },
        onProgress: setConvertProgress,
        pushToast,
        mintDocId: () => docId,
      });
      if (opened === null) return null;
      await recordRecentOpen(path, displayName);
      return opened.tabId;
    },
    [openFromBytes, recordRecentOpen],
  );

  const openPdfFromPath = useCallback(
    // Phase 32 — returns the opened tab's id (or null when the open
    // failed / was cancelled) so the empty pane's Open action can put the
    // new document straight into that pane. Existing callers ignore it.
    //
    // Phase 53 — `routeOpenPath` probes `window.tflex.convert.sourceInfo`
    // first: an absent bridge, an `unsupported-format` result, or ANY other
    // `sourceInfo` failure for a `.pdf` falls straight through to
    // `openPdfBytesFromPath` (the unchanged PDF path). Only a recognised
    // convertible takes the convert route. DEF-418 — a NON-`.pdf` that the
    // convert route cannot take is reported truthfully and opens nothing;
    // the PDF loader is never handed a non-PDF. This is the ONE place the
    // branch lives, so the Open dialog, the OS-open listener, the OS drop
    // and the recent list all inherit it.
    (path: string): Promise<string | null> =>
      routeOpenPath(path, {
        api: window.tflex.convert,
        openPdf: openPdfBytesFromPath,
        openConverted: openConvertedFromPath,
        onUnsupported: (unsupportedPath): void => {
          const displayName = splitRecentPath(unsupportedPath).name;
          pushToast("error", associationMessageFor(unsupportedPath, displayName) ?? unsupportedFileMessage(displayName));
        },
      }),
    [openConvertedFromPath, openPdfBytesFromPath, pushToast],
  );

  /** Phase 52 (feature A) — the prompt's retry. Reopens the pending file
   *  with the submitted password; an incorrect one leaves the prompt open
   *  with the inline sentence, a correct one opens the tab and records the
   *  recent. A cancel never reaches here. */
  const onPasswordPromptSubmit = useCallback(
    async (password: string): Promise<void> => {
      const pending = pendingPasswordOpenRef.current;
      if (pending === null) return;
      setPasswordPrompt((prev) => passwordPromptReducer(prev, { type: "submit" }));
      const opened = await openFromBytes(pending.bytes, pending.source, {
        password,
        onPasswordRequired: (kind: PasswordPromptKind): void => {
          setPasswordPrompt((prev) =>
            passwordPromptReducer(
              prev,
              kind === "incorrect"
                ? { type: "incorrect" }
                : { type: "need", target: pending.source.displayName },
            ),
          );
        },
      });
      if (opened === null) return;
      pendingPasswordOpenRef.current = null;
      setPasswordPrompt((prev) => passwordPromptReducer(prev, { type: "opened" }));
      await recordRecentOpen(pending.source.path, pending.source.displayName);
      routeOpenedTabRef.current?.show(opened.tabId);
    },
    [openFromBytes, recordRecentOpen],
  );

  const onPasswordPromptCancel = useCallback((): void => {
    pendingPasswordOpenRef.current = null;
    setPasswordPrompt((prev) => passwordPromptReducer(prev, { type: "cancel" }));
  }, []);

  /** Phase 35 — the ONE renderer open path shared by the Open dialog, the
   *  OS-open listener and the OS file drop. It is exactly the dialog flow
   *  (Phase 32/33 Multi Mode routing included: the new document is ASSIGNED
   *  to the focused pane, a file that is already the other pane's document is
   *  refused). Reads `routeOpenedTabRef.current` at call time so it always
   *  sees the current focused pane. */
  const openFromRequest = useCallback(
    async (path: string): Promise<void> => {
      await openRequestedPath(path, openPdfFromPath, routeOpenedTabRef.current);
    },
    [openPdfFromPath],
  );

  // DEF-610 — a synchronous re-entry guard for the generic Open. A title-bar
  // double-click (or two rapid clicks) invokes `onOpenClick` twice in the same
  // tick before the first `openFileDialog` promise settles, so the native picker
  // opened twice. The ref is set synchronously on entry and released in
  // `finally`, so the second invocation is a no-op until the first resolves.
  const openInFlightRef = useRef(false);
  const onOpenClick = useCallback(async (): Promise<void> => {
    if (openInFlightRef.current) return;
    openInFlightRef.current = true;
    try {
      // DEF-375 — the generic Open path routes non-PDF files through the
      // conversion bridge, so the OS dialog must offer the grouped Phase 53
      // filters (`openFileDialog('document')`), not the PDF-only default.
      const picked = await window.tflex.openFileDialog("document");
      if (picked === null) return;
      // Phase 32 (DEF-277/DEF-278) — in Multi Mode this generic open lands in
      // the focused pane; a file that is already the OTHER pane's document is
      // refused up front so no tab is created for a document that would never
      // become visible. Single mode: the ref's methods are no-ops/false.
      await openFromRequest(picked);
    } finally {
      openInFlightRef.current = false;
    }
  }, [openFromRequest]);

  // Phase 35 — Windows integration. A PDF dropped from Explorer opens the
  // document through the SAME shared path as the dialog (DEF-295); main's
  // launch-argv / second-instance path push routes through it too.
  useOsFileDrop({
    openPath: openFromRequest,
    onError: (message): void => pushToast("error", message),
    onNotice: (message): void => pushToast("info", message),
  });
  useOsOpenPathRequests({
    openPath: openFromRequest,
    onError: (message): void => pushToast("error", message),
  });

  // DEF-429 — the sample-open flow, shared by the welcome-grid sample
  // cards and a Recents row whose stored path is `samples/<name>`. The
  // stored bytes path never touches the filesystem open.
  const openSampleByName = useCallback(
    async (name: string): Promise<void> => {
      const samplePath = `samples/${name}`;
      // Phase 32 (DEF-277/DEF-278) — a sample card open in Multi Mode lands
      // in the focused pane; it is refused when it is already the other
      // pane's document (same path identity the pane Open guard uses).
      const routing = routeOpenedTabRef.current;
      if (routing !== null && routing.refuseFocused(samplePath)) return;
      const bytesRes = await window.tflex.readSample(name);
      if (!bytesRes.ok) {
        pushToast("error", `Sample file unavailable: ${name}.`);
        return;
      }
      try {
        const opened = await openFromBytes(toArrayBuffer(bytesRes.value), {
          kind: "sample",
          path: samplePath,
          displayName: name,
          onDiskPath: null,
        });
        if (opened !== null && routing !== null) routing.show(opened.tabId);
        if (settings !== null) {
          const recent: RecentFile = {
            path: samplePath,
            name,
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

  const onSampleClick = useCallback(
    async (sample: SampleDocument): Promise<void> => {
      await openSampleByName(sample.name);
    },
    [openSampleByName],
  );

  const onRecentClick = useCallback(
    async (entry: RecentFile): Promise<void> => {
      // DEF-429 — a Recents row for a bundled sample stores the display
      // path `samples/<name>`; reopen it through the sample flow rather
      // than a filesystem open, which cannot resolve that path.
      const meta = splitRecentPath(entry.path);
      if (meta.isSample) {
        await openSampleByName(meta.name);
        return;
      }
      // Phase 32 (DEF-277/DEF-278) — a recent-file open is a generic open:
      // it lands in the focused pane, or is refused when it is already the
      // other pane's document. Phase 35 — the same shared open path the
      // dialog, the OS-open listener and the OS file drop use.
      await openFromRequest(entry.path);
    },
    [openFromRequest, openSampleByName],
  );

  const onRemoveRecent = useCallback(
    (entry: RecentFile): void => {
      if (settings === null) return;
      const remaining = removeRecent(settings.recentFiles, entry.path);
      if (remaining.length === settings.recentFiles.length) return;
      const next: AppSettings = { ...settings, recentFiles: remaining };
      setSettings(next);
      trackAndSave(next);
      // Removing history must NOT delete a file; clear the stale missing flag
      // so a later re-add starts clean.
      setMissingRecents((prev) => {
        if (!prev.has(entry.path)) return prev;
        const nextMissing = new Set(prev);
        nextMissing.delete(entry.path);
        return nextMissing;
      });
    },
    [settings, trackAndSave],
  );

  // Phase 112 (C6b) — pin / unpin walks the EXISTING settings save path (no new
  // IPC). Toggling the record's `pinned` boolean only; the display order lifts
  // pinned rows to the top (see `recentDisplays`).
  const onToggleRecentPin = useCallback(
    (entry: RecentFile): void => {
      if (settings === null) return;
      const target = settings.recentFiles.find((r) => r.path === entry.path);
      if (target === undefined) return;
      const next = settings.recentFiles.map((r) =>
        r.path === entry.path ? { ...r, pinned: r.pinned !== true } : r,
      );
      const updated: AppSettings = { ...settings, recentFiles: next };
      setSettings(updated);
      trackAndSave(updated);
    },
    [settings, trackAndSave],
  );

  // Phase 112 (C6b) — reveal the file through the C6a `recent:showInFolder`
  // bridge. A typed `missing` result flags the row; a real failure toasts.
  // The handler never deletes or moves a file.
  const onShowRecentInFolder = useCallback(
    (entry: RecentFile): void => {
      void window.tflex.showInFolder(entry.path).then((res) => {
        if (res.ok) return;
        if (res.reason === "missing") {
          setMissingRecents((prev) => {
            if (prev.has(entry.path)) return prev;
            const next = new Set(prev);
            next.add(entry.path);
            return next;
          });
          return;
        }
        pushToast("error", `Could not show "${entry.name}" in its folder.`);
      });
    },
    [pushToast],
  );

  // Phase 112 (C6b) — re-point a missing entry through the C6a
  // `recent:locateMissing` bridge (the single Open-PDF picker). A chosen path
  // opens through the EXISTING open flow (which records a fresh recent) and the
  // old missing flag clears; a cancel resolves null and changes nothing.
  const onLocateRecentMissing = useCallback(
    (entry: RecentFile): void => {
      void window.tflex.locateMissing().then((found) => {
        if (found === null || found.length === 0) return;
        setMissingRecents((prev) => {
          if (!prev.has(entry.path)) return prev;
          const next = new Set(prev);
          next.delete(entry.path);
          return next;
        });
        void openFromRequest(found);
      });
    },
    [openFromRequest],
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
      // Phase 52 — drop the engine document and clear its session password
      // (a password lives only in main's per-document session).
      // DEF-372 — the renderer's FILE-keyed session password cache is
      // deliberately NOT cleared here: the acceptance requires that closing
      // and re-opening the same file in one session does not re-prompt. It
      // lives in renderer memory only and is gone when the app restarts.
      void engineRef.current.closeDocument?.(open.session.engineDocId);
      // Phase 35 item 8 — if the standalone print window was opened for this
      // tab's document, tell it the document is gone so it shows its gone
      // state instead of stale pages (main forwards the event only when the
      // docId matches the live print window, so a window opened for another
      // document is untouched).
      void window.tflex.printWindow?.notifyDocumentGone(open.session.engineDocId);
    }
    // Phase 52 — forget the tab's protection state.
    setProtectionByTab((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // DEF-166 — drop the tab's live-overlay annotation id set with it
    // so a freshly-opened tab never inherits stale live-text marks.
    liveAnnTextIdsRef.current.delete(id);
    dispatchTabs({ type: "close", id });
    // Phase 32 — reconcile the Multi Mode panes in the SAME commit as the
    // close so a pane whose document just closed falls back to its empty
    // state without a frame that renders the stale pane (the tab list is
    // already short one entry). The effect below is the safety net for any
    // other removal path.
    dispatchMultiMode({
      type: "reconcile",
      tabIds: tabsRef.current.tabs.filter((t) => t.id !== id).map((t) => t.id),
    });
    // B7 — tool / arm state cleanup. The user armed the Sign tool
    // and the "armed" pill stays on the toolbar after the active
    // tab is closed (because the App-level state outlives the
    // tab). Reset it so the next open tab doesn't inherit a stale
    // armed state. The same applies to Edit mode (a per-tab
    // toggle that lives App-level for the toolbar/palette) and
    // to every dialog that was scoped to the now-closed tab.
    setArmedSignatureId(null);
    setArmedStamp(null);
    setRedactArmed(false);
    if (editModeOpenRef.current) {
      setEditModeOpen(false);
    }
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
    setXlsxExportOpen(false);
    setPptxExportOpen(false);
    setCommentExportOpen(false);
    setCommentImportOpen(false);
    setDeletePageOpen(false);
    setDeletePageSeed(null);
    // B21 — the tools palette is App-level (not per-tab) and
    // renders over the workspace even when no tab is active.
    // Closing the last tab left it mounted on the home / welcome
    // screen. Phase 36 (chunk 5): the palette is retired and the
    // Inspector is derived from "a document is open", so closing the
    // last tab hides it without any explicit reset.
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

  // ---------------------------------------------------------------------
  // Phase 58 (chunk 6b) — tab detach into a second app window.
  //
  // The origin side of the move: `detachTab` hands the tab's bytes to
  // main, which opens (or reaches) a new window and pushes the payload
  // to it. The origin tab stays OPEN until the new window confirms it
  // adopted the payload (`onDetachResolved` -> `performCloseTab`); a
  // failed adopt keeps the tab and toasts. `pendingDetachRef` maps the
  // new window id back to the tab id so the ack can find it.
  // ---------------------------------------------------------------------
  const pendingDetachRef = useRef<Map<number, string>>(new Map());
  // Phase 58 (chunk 6c) — the detached window closes itself once its last
  // tab is gone. `hadTabRef` records that this window actually held a tab at
  // some point (a freshly-loaded detached window starts empty and must NOT
  // close before its adopt arrives); `notifiedEmptyRef` makes `notifyEmpty`
  // fire exactly once.
  const hadTabRef = useRef(false);
  const notifiedEmptyRef = useRef(false);

  const detachTab = useCallback(async (id: string): Promise<void> => {
    const tabsApi = window.tflex.tabs;
    if (tabsApi === undefined) {
      pushToast("error", "Moving a tab to a new window is not available.");
      return;
    }
    const open = openTabsRef.current[id];
    if (open === undefined) {
      // DEF-417 — an empty placeholder tab has no document to move. The
      // tear-out affordance still arms on it, so failing loud (a readable
      // warning, tab kept) beats the old silent early-return no-op.
      const refusal = detachRefusal(false);
      if (refusal !== null) pushToast(refusal.kind, refusal.text);
      return;
    }
    // Read the current bytes exactly like the convert path: call the
    // method ON the engine (DEF-374 — extracting it loses `this`).
    const engine = engineRef.current;
    if (engine.getDocumentBytes === undefined) {
      pushToast("error", "Could not move the tab: the document bytes are unavailable.");
      return;
    }
    let bytesResult;
    try {
      bytesResult = await engine.getDocumentBytes(open.session.engineDocId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast("error", `Could not move the tab to a new window: ${msg}`);
      return;
    }
    if (!bytesResult.ok) {
      pushToast("error", describeEngineError(bytesResult.error.code, bytesResult.error.message));
      return;
    }
    // The modified signal is read from BOTH mirrors, exactly like
    // `closeTab`: the tabs reducer's meta and the engineUi state mirror
    // (React batches the two setStates, so either can lag the other).
    const metaModified = tabsRef.current.tabs.find((t) => t.id === id)?.modified === true;
    const engineModified = engineUiRef.current[id]?.state.modified === true;
    // Phase 105 (chunk C) — carry the session identity across the move so the
    // adopted tab keeps its colour. The chunk-A contract (`TabTransferPayload`)
    // relays `colorId` opaquely through main; a tab with no identity yet sends
    // `undefined`, which the adopter treats as "allocate one".
    const colorId = tabsRef.current.tabs.find((t) => t.id === id)?.colorId;
    const payload = {
      title: open.displayName,
      bytes: new Uint8Array(bytesResult.value),
      modified: metaModified || engineModified,
      colorId,
    };
    // Phase 58 (chunk 6c) — the same tear-out gesture means opposite things
    // depending on the window: in the origin it detaches the tab out, in a
    // detached window it returns the tab to the origin. `tabExitAction`
    // owns that decision.
    if (tabExitAction(IS_DETACHED_WINDOW) === "return") {
      // The detached window hands the tab back; main delivers it to the
      // origin window, which opens it through its own `onAdopt` handler.
      // There is no ack to wait on here, so once `returnToOrigin` resolves
      // ok the local tab is closed immediately — the bytes are already on
      // their way to the other window.
      let returned;
      try {
        returned = await tabsApi.returnToOrigin(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushToast("error", `Could not return the tab to the original window: ${msg}`);
        return;
      }
      if (!returned.ok) {
        pushToast("error", "Could not return the tab to the original window.");
        return;
      }
      performCloseTab(id);
      return;
    }
    let result;
    try {
      result = await tabsApi.detach(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast("error", `Could not move the tab to a new window: ${msg}`);
      return;
    }
    if (!result.ok) {
      pushToast("error", "Could not move the tab to a new window.");
      return;
    }
    // Leave the tab open until the new window confirms the adopt.
    pendingDetachRef.current.set(result.windowId, id);
  }, [performCloseTab, pushToast]);

  // The origin's outcome subscription. The document already moved, so a
  // confirmed detach uses the UNCONDITIONAL `performCloseTab` (no save
  // prompt) — prompting would ask the user to save a document that is
  // already alive in the other window.
  useEffect(() => {
    const tabsApi = window.tflex.tabs;
    if (tabsApi === undefined) return;
    return tabsApi.onDetachResolved((r): void => {
      const id = pendingDetachRef.current.get(r.windowId);
      if (id === undefined) return;
      pendingDetachRef.current.delete(r.windowId);
      if (r.ok) performCloseTab(id);
      else pushToast("error", "Could not move the tab to a new window.");
    });
  }, [performCloseTab, pushToast]);

  // The ADOPTING window's subscription: main pushes the transferred
  // payload once this window is ready. We open it through the SAME
  // `openFromBytes` path every other open uses, then ack main with
  // whether a tab was actually created (a false ack makes the origin
  // keep its tab — fail loud, never lose a document).
  useEffect(() => {
    const tabsApi = window.tflex.tabs;
    if (tabsApi === undefined) return;
    return tabsApi.onAdopt((payload): void => {
      void (async (): Promise<void> => {
        const buffer = payload.bytes.buffer.slice(
          payload.bytes.byteOffset,
          payload.bytes.byteOffset + payload.bytes.byteLength,
        ) as ArrayBuffer;
        const source: OpenSource = {
          kind: "file",
          path: `detached:${payload.title}`,
          displayName: payload.title,
          onDiskPath: null,
          // A detached document is a distinct in-memory instance: never
          // collapse it onto a same-path tab already open in this window.
          dedupePath: false,
        };
        const opened = await openFromBytes(buffer, source);
        if (opened !== null) {
          // DEF-414 — the origin may hand us a document with UNSAVED
          // changes. `openFromBytes` parses the bytes fresh, so both the
          // engine and the tab meta come back clean; the origin's dirty
          // state must be carried onto the adopted tab explicitly or the
          // moved document is presented as clean and can be lost. Patch
          // BOTH signals the close gate / diagnostics read: the tab meta
          // (dot + `tabModified`) and the engineUi mirror (`modified`).
          const patch = adoptedModifiedPatch(payload.modified);
          // Phase 105 (chunk C) — carry the ORIGIN session's identity onto the
          // adopted tab. `openFromBytes` mints a fresh colorId for the new
          // session; the origin's `colorId` (when present) overrides it so the
          // moved document keeps its colour. The reducer meta is patched with a
          // same-id `open` (an in-place row replace) and the App-level mirror
          // is patched to match, exactly like the DEF-414 modified patch below.
          const adoptedColorId = payload.colorId;
          if (adoptedColorId !== undefined) {
            dispatchTabs({
              type: "open",
              tab: {
                id: opened.tabId,
                title: payload.title,
                filePath: source.path,
                kind: "file",
                colorId: adoptedColorId,
                modified: patch.tabModified,
              },
              dedupePath: false,
            });
            setOpenTabs((prev) => {
              const tab = prev[opened.tabId];
              if (tab === undefined) return prev;
              return {
                ...prev,
                [opened.tabId]: { ...tab, meta: { ...tab.meta, colorId: adoptedColorId } },
              };
            });
          }
          if (patch.tabModified) {
            dispatchTabs({ type: "set-modified", id: opened.tabId, modified: true });
            setOpenTabs((prev) => {
              const tab = prev[opened.tabId];
              if (tab === undefined) return prev;
              return {
                ...prev,
                [opened.tabId]: { ...tab, meta: { ...tab.meta, modified: true } },
              };
            });
          }
          if (patch.engineModified) {
            setEngineUi((prev) => {
              const ui = prev[opened.tabId];
              if (ui === undefined) return prev;
              return {
                ...prev,
                [opened.tabId]: { ...ui, state: { ...ui.state, modified: true } },
              };
            });
          }
        }
        await tabsApi.adoptAck(opened !== null);
      })();
    });
  }, [openFromBytes]);

  // Phase 58 (chunk 6c) — the detached window closes itself once its last
  // tab has gone. Track whether this window ever held a tab; on the drop to
  // zero (returned to origin, or closed normally) tell main to close the
  // now-empty detached window, exactly once. A fresh detached window that has
  // not yet adopted anything is empty by design and must not close itself.
  useEffect(() => {
    if (tabs.tabs.length > 0) {
      hadTabRef.current = true;
      return;
    }
    if (!IS_DETACHED_WINDOW || !hadTabRef.current || notifiedEmptyRef.current) return;
    notifiedEmptyRef.current = true;
    void window.tflex.tabs?.notifyEmpty();
  }, [tabs.tabs.length]);

  const activateTab = useCallback((id: string): void => {
    dispatchTabs({ type: "activate", id });
    // B10 — tool-state reset on tab switch. The active tab
    // changes; App-level tool state (armed Sign / Stamp, Edit
    // mode, the OCR suspects panel) must NOT carry into the
    // newly-activated tab. Previously only `performCloseTab`
    // cleared these, so a tab switch inherited the previous
    // tab's arming — the Sign pill stayed lit and the next page
    // click in the new tab spawned a signature instead of the
    // annotation the user reached for. Per-tab state (annotation
    // tool, edit placements) lives in DocumentView keyed on
    // meta.id and is untouched by this reset.
    setArmedSignatureId(null);
    setArmedStamp(null);
    setRedactArmed(false);
    setEditModeOpen(false);
    setOcrSuspectsOpen(false);
  }, []);

  /** Phase 6 — "+ tab" affordance. Appends an empty placeholder tab
   *  and activates it. The next PDF the user opens (via the menu /
   *  toolbar / Welcome screen) fills this tab in place instead of
   *  stacking a new one — see `tabsReducer.open`. */
  const onNewEmptyTab = useCallback((): void => {
    // DEF-288 — while Multi Mode is on the tab strip shows ONE composite
    // workspace tab, so a new empty tab would be a hidden state mutation
    // that only appears after leaving the mode. The header's "+" is
    // disabled; this guard keeps any other caller honest too.
    if (multiMode.enabled) return;
    const id = crypto.randomUUID();
    // Phase 105 (chunk B) — a brand-new empty tab also gets a stable identity
    // minted here, allocated against the sessions currently open.
    const colorId = allocateColorId(
      tabsRef.current.tabs
        .map((t) => t.colorId)
        .filter((c): c is string => c !== undefined),
    );
    const meta: TabMeta = {
      id,
      title: 'Empty tab',
      filePath: '',
      kind: 'empty',
      colorId,
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
    setRedactArmed(false);
    setEditModeOpen(false);
    setOcrSuspectsOpen(false);
  }, [multiMode.enabled]);

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

  /** DEF-292 — map an engine document id back to the live tab that holds
   *  it. A joint cross-document undo/redo echoes the OTHER document's
   *  state keyed by its engine doc id; the App needs that document's tab
   *  id to mirror its `engineUi` and refresh its pdf.js proxy. Scans the
   *  live tabs (not the pane slots) so it works whether the other pane is
   *  focused, unfocused, or the document sits in a background tab. */
  const tabIdForEngineDoc = useCallback((engineDocId: string): string | null => {
    for (const [id, open] of Object.entries(openTabsRef.current)) {
      if (open.session.engineDocId === engineDocId) return id;
    }
    return null;
  }, []);

  /** DEF-292 — apply the OTHER pane's post-joint-undo/redo refresh plan:
   *  mirror its `engineUi` (state + counters + flags), drop its
   *  renderer-only stamp mirror, and rebuild its pdf.js proxy through the
   *  same refresh hook the active pane uses. A `null` plan (a plain
   *  single-document undo/redo) is a clean no-op — the other pane is not
   *  touched, so no unchanged document is re-serialized for nothing. */
  const applyJointPaneRefresh = useCallback(
    (plan: JointPaneRefresh | null): void => {
      if (plan === null) return;
      setEngineUiFor(plan.tabId, {
        state: plan.state,
        counters: plan.counters,
        canUndo: plan.canUndo,
        canRedo: plan.canRedo,
      });
      dropPlacedStamps(plan.tabId);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(plan.tabId).catch(() => undefined);
      }
    },
    [setEngineUiFor, dropPlacedStamps],
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
        // TFL-776.6 (DEF-564) — the engine just reverted the op at depth
        // `counters.undoCount + 1`. Reconcile the per-tab text-run commit
        // registry: the reverted commit stops suppressing, so a run restored
        // by this undo is hoverable/selectable again.
        setOpenTabs((tabs) => {
          const t = tabs[tabId];
          if (t === undefined) return tabs;
          const edit = editReducer(t.edit, {
            type: "reconcile-text-run-history",
            undoCount: counters.undoCount,
            phase: "undo",
          });
          if (edit === t.edit) return tabs;
          return { ...tabs, [tabId]: { ...t, edit } };
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
        // DEF-292 — a joint cross-document move is recorded on BOTH
        // documents, so this undo may ALSO have reverted the other pane's
        // document. The engine echoes that document's post-undo state as
        // `pairedState`; mirror it and refresh its proxy so both panes are
        // correct from this one call. A plain single-document undo has no
        // pairedState, so the plan is null and the other pane is untouched.
        applyJointPaneRefresh(
          planJointPaneRefresh(
            "undo",
            tabId,
            result.value.pairedState,
            tabIdForEngineDoc,
            (id) => engineUiRef.current[id]?.counters,
          ),
        );
      });
    },
    [pushToast, setEngineUiFor, dropPlacedStamps, applyJointPaneRefresh, tabIdForEngineDoc],
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
        // TFL-776.6 (DEF-564) — symmetric to `onUndo`: the engine re-applied
        // the op at depth `counters.undoCount`, so its commit suppresses the
        // vacated rect again (a redone delete stays inert).
        setOpenTabs((tabs) => {
          const t = tabs[tabId];
          if (t === undefined) return tabs;
          const edit = editReducer(t.edit, {
            type: "reconcile-text-run-history",
            undoCount: counters.undoCount,
            phase: "redo",
          });
          if (edit === t.edit) return tabs;
          return { ...tabs, [tabId]: { ...t, edit } };
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
        // DEF-292 — symmetric to the undo branch: a joint cross-document
        // move redo re-applies the move on BOTH documents, so the other
        // pane's mirror and proxy must follow. See `onUndo`.
        applyJointPaneRefresh(
          planJointPaneRefresh(
            "redo",
            tabId,
            result.value.pairedState,
            tabIdForEngineDoc,
            (id) => engineUiRef.current[id]?.counters,
          ),
        );
      });
    },
    [pushToast, setEngineUiFor, dropPlacedStamps, applyJointPaneRefresh, tabIdForEngineDoc],
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

  // Phase 28 — append a comment / reply to an annotation's thread. The
  // engine creates the thread on the first call and appends a reply
  // thereafter; the echoed state carries the refreshed `comments` array,
  // which `noteOpApplied` mirrors so the comment box's list and the
  // annotation's comment badge update from the same round-trip.
  const onAddComment = useCallback(
    async (tabId: string, annotationId: string, text: string): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.addComment(
        open.session.engineDocId,
        annotationId,
        text,
      );
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

  // Phase 59 item 4 — a save runs the native fill pass, so the engine's
  // post-save state carries the `formFillReport` (and the post-fill field
  // list). Refresh the state best-effort WITHOUT touching the just-reset
  // undo/redo counters (a save clears both stacks, so noteOpApplied would
  // wrongly re-arm undo).
  const refreshStateForReport = useCallback(
    (tabId: string): void => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      void engineRef.current
        .getState(open.session.engineDocId)
        .then((stateResult) => {
          if (!stateResult.ok) return;
          const cur = engineUiRef.current[tabId];
          if (cur === undefined) return;
          setEngineUiFor(tabId, {
            ...cur,
            // The save just cleared the modified flag; keep it cleared even
            // if the echoed state races back a stale value.
            state: { ...stateResult.value, modified: false },
          });
        })
        .catch(() => undefined);
    },
    [setEngineUiFor],
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

  /** DEF-232 — every overlay-originated edit commit now carries the
   *  page the committing EditOverlay owns (threaded through
   *  PageView/DocumentView) or derives it from the placement itself
   *  (text-box registry entry). The old `currentPageOfTab` helper is
   *  gone: the viewer's "current page" readout reports the page whose
   *  TOP has passed the chrome line, so at a scroll position where the
   *  target page's top is still below that line it reports the
   *  PREVIOUS page and the engine op landed on the wrong page. */

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
      setRedactArmed(false);
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
      /** DEF-232 — the page the committing EditOverlay owns. The
       *  engine op MUST be targeted at this page, never at the
       *  viewer's current-page readout: the current-page heuristic
       *  reports the page whose TOP has passed the chrome line, so at
       *  a scroll position where the target page's top is still below
       *  that line (page 2 top at viewport y=197 in the DEF-232
       *  repro) it reports the PREVIOUS page while the run under the
       *  cursor is on the target page. The old code read
       *  `currentPageOfTab` and silently masked/drew on page 1. */
      page: number;
    }): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      // DEF-258 — the run commit must forward the panel's full style,
      // not just font/size/color: `EditTextRunPayload extends
      // TextStyleFields` (Phase 21) plus `charSpacing` (Phase 27), and
      // dropping them silently discarded every set field (bold, italic,
      // underline, align, lineHeight, highlight, baselineShift, list,
      // indent, charSpacing) on this path. `buildEditTextRunPayload`
      // forwards each set field and omits documented defaults, so a
      // default-style run keeps the legacy minimal payload.
      const payload = buildEditTextRunPayload(args);
      const result = await engineRef.current.editTextRun(open.session.engineDocId, payload);
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
      /** Phase 26 — the id the renderer already minted for a freshly
       *  dragged box (the panel Text field's session commit). The engine
       *  registers the box under THIS id so the local mirror and the
       *  registry agree; absent for the legacy editor flow. */
      id?: string;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: EditTextStyle;
      background: "white" | "none";
      /** DEF-232 sibling — the page the committing EditOverlay owns.
       *  Same rule as the text-run commit: never resolve the target
       *  page from the viewer's current-page readout, which reports
       *  the PREVIOUS page while the target page's top is still below
       *  the chrome line. */
      page: number;
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
      const boxId = args.id ?? crypto.randomUUID();
      const page = args.page;
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
      /** DEF-232 sibling — the page the committing EditOverlay owns.
       *  Only the pre-registry FALLBACK below targets a page (the
       *  registry path looks the box up by id). */
      page: number;
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
        page: args.page,
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
        // DEF-232 sibling — the registry entry owns the box's page, so
        // derive the target from the box itself rather than the
        // viewer's current-page readout (which can be a page behind).
        page: box.page,
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

  /** Phase 21 — apply a text-properties panel patch to a COMMITTED
   *  text box through the engine's registry (`engine.updateTextBox`).
   *  The engine is preserve-if-valid per field and rejects an unknown id
   *  or an unsupported font with a typed engine-error (fail loud, never
   *  a silent drop). On success the renderer mirror adopts the echoed
   *  registry list and the local edit state is updated immediately so
   *  the panel reflects the change without waiting for the echo; the
   *  pdf.js proxy is rebuilt so the re-baked box renders live (same
   *  pattern as addTextBox / moveTextBox). */
  const handleTextBoxStylePatch = useCallback(
    async (tabId: string, id: string, patch: TextBoxStylePatch): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const engine = engineRef.current;
      if (engine.updateTextBox === undefined) {
        pushToast("error", "Text styling requires the backend text-style update.");
        return;
      }
      const result = await engine.updateTextBox(open.session.engineDocId, id, patch);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
      // Local mirror — keep the panel's selected values in sync even
      // before the engine-state echo lands (the App mirror effect then
      // adopts the authoritative registry list).
      setOpenTabs((prev) => {
        const t = prev[tabId];
        if (t === undefined) return prev;
        return {
          ...prev,
          [tabId]: {
            ...t,
            edit: editReducer(t.edit, { type: "patch-text-box-style", id, patch }),
          },
        };
      });
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(tabId).catch(() => undefined);
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
      /** DEF-232 sibling — the page the committing EditOverlay owns.
       *  Never resolve the target from the viewer's current-page
       *  readout (see handleAddTextBox). */
      page: number;
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
        page: args.page,
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
  }, [armedSignatureId, armedStamp]);

  // Phase 51 (item 2) — a saved-signature add/delete requests an automatic
  // sync through the existing coordinator. Only while a session is live; the
  // coordinator guards the network itself, but skipping signed-out avoids a
  // no-op status broadcast.
  const onSignaturesChanged = useCallback((): void => {
    requestAutoSync({ signedIn: accountStatus.signedIn });
  }, [accountStatus.signedIn]);

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
        const report = ui?.state.formFillReport;
        let forms = tab.forms;
        if (fromEngine !== undefined && !sameFormFields(tab.forms.fields, fromEngine)) {
          forms = replaceFields(forms, fromEngine);
        }
        // Phase 59 item 4 — mirror the native-fill report. Content-gated so a
        // same-shape engine echo (fresh array identity) never churns openTabs.
        if (report !== undefined && !sameFillReport(forms.report, report)) {
          forms = setFormFillReport(forms, report);
        }
        if (forms === tab.forms) {
          next[tabId] = tab;
          continue;
        }
        next[tabId] = { ...tab, forms };
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

  // Phase 34 (chunk 2) — advance the composite tab's close queue. The
  // resolved document is NOT closed here: the flow waits until every
  // modified pane document has been answered, then closes BOTH and leaves
  // Multi Mode (the composite tab IS the workspace). This is what makes
  // Cancel abort the whole close instead of stranding one pane.
  const advanceCompositeClose = useCallback((): void => {
    const queue = compositeCloseQueueRef.current;
    if (queue === null) return;
    const { next, done } = advanceCompositeQueue(queue);
    if (done) {
      const ids = compositeCloseIdsRef.current ?? [];
      compositeCloseQueueRef.current = null;
      compositeCloseIdsRef.current = null;
      setPendingCloseTabId(null);
      setPendingCloseError(null);
      setPendingCloseSaving(false);
      for (const closeId of ids) performCloseTab(closeId);
      // Both pane documents are gone: the single workspace tab no longer
      // exists, so leave the mode. Any other open tab becomes the active
      // single-mode tab (the tabs reducer picked the neighbour); with none
      // the welcome screen shows.
      dispatchMultiMode({ type: "disable" });
      return;
    }
    // More modified pane documents to walk through: show the next prompt.
    compositeCloseQueueRef.current = next;
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
        // Phase 34 (chunk 2) — cancel also aborts a composite close: both
        // pane documents survive and neither is closed.
        compositeCloseQueueRef.current = null;
        compositeCloseIdsRef.current = null;
        return;
      }
      if (choice === "discard") {
        // The user explicitly asked to throw away the work.
        // Close the tab; performCloseTab handles the rest.
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        // Phase 34 (chunk 2) — in a composite close the discard is
        // recorded and the queue advances; BOTH documents close only once
        // every prompt has resolved.
        if (compositeCloseQueueRef.current !== null) {
          advanceCompositeClose();
          return;
        }
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
            // Phase 54 — a blocked Save-As carries the validation report.
            const blocked = validationFromSaveResult(saved);
            if (blocked !== null) {
              setValidationNotices((prev) => ({
                ...prev,
                [id]: { report: blocked, variant: "blocked" },
              }));
              setPendingCloseError(blockedSaveMessage(blocked));
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
          // Phase 34 (chunk 2) — composite close: record the save and
          // advance; the pair closes when every prompt has resolved.
          if (compositeCloseQueueRef.current !== null) {
            advanceCompositeClose();
            return;
          }
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
          // Phase 54 — a blocked save names the target and says no file was
          // written; the report card carries the findings behind this prompt.
          const blocked = validationFromSaveResult(result);
          if (blocked !== null) {
            setValidationNotices((prev) => ({
              ...prev,
              [id]: { report: blocked, variant: "blocked" },
            }));
            setPendingCloseError(blockedSaveMessage(blocked));
            return;
          }
          setPendingCloseError(
            describeEngineError(result.error.code, result.error.message),
          );
          return;
        }
        // Save succeeded. Close the tab.
        setPendingCloseSaving(false);
        setPendingCloseTabId(null);
        setPendingCloseError(null);
        // Phase 34 (chunk 2) — composite close: record the save and advance.
        if (compositeCloseQueueRef.current !== null) {
          advanceCompositeClose();
          return;
        }
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
      // Phase 40 post-gate — mirror the disabled toolbar Save: a CLEAN document
      // is a silent no-op, so the Ctrl+S accelerator can no longer rewrite an
      // unchanged file (the UI and the accelerator must agree).
      const intent = saveIntentFor({
        onDiskPath: tab.session.onDiskPath,
        modified:
          tab.meta.modified === true ||
          (engineUiRef.current[tabId]?.state ?? tab.engine).modified === true,
      });
      if (intent === 'readonly') {
        pushToast(
          "info",
          "This document is read-only. Use Save As to save a copy.",
        );
        return;
      }
      if (intent === 'clean') return;
      const result = await engineRef.current.save(tab.session.engineDocId);
      if (!result.ok) {
        // Phase 54 — a blocked save carries the report; show the card naming
        // what blocked it and state plainly that NO file was written instead of
        // the generic engine-error toast.
        const blocked = validationFromSaveResult(result);
        if (blocked !== null) {
          setValidationNotices((prev) => ({
            ...prev,
            [tabId]: { report: blocked, variant: "blocked" },
          }));
          pushToast("info", blockedSaveMessage(blocked));
          return;
        }
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Phase 54 — with `onViolation: 'warn'` the save succeeded and the report
      // rides along: surface it as a non-blocking notice.
      const warned = validationFromSaveResult(result);
      if (warned !== null) {
        setValidationNotices((prev) => ({
          ...prev,
          [tabId]: { report: warned, variant: "warned" },
        }));
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
      // Phase 59 item 4 — surface the native-fill report the save produced.
      refreshStateForReport(tabId);
      pushToast(
        "info",
        saveConfirmationText(tab.displayName, protectionByTab[tabId] !== undefined),
      );
    },
    [protectionByTab, pushToast, refreshStateForReport, setEngineUiFor],
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
        // Phase 54 — a blocked Save-As carries the validation report.
        const blocked = validationFromSaveResult(result);
        if (blocked !== null) {
          setValidationNotices((prev) => ({
            ...prev,
            [tabId]: { report: blocked, variant: "blocked" },
          }));
          pushToast("info", blockedSaveMessage(blocked));
          return;
        }
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      // Phase 54 — a warned Save-As succeeded; surface the report non-blockingly.
      const warned = validationFromSaveResult(result);
      if (warned !== null) {
        setValidationNotices((prev) => ({
          ...prev,
          [tabId]: { report: warned, variant: "warned" },
        }));
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
      // Phase 59 item 4 — surface the native-fill report a Save-As produced.
      refreshStateForReport(tabId);
      pushToast(
        "info",
        saveAsConfirmationText(tab.displayName, protectionByTab[tabId] !== undefined),
      );
    },
    [protectionByTab, pushToast, refreshStateForReport, setEngineUiFor],
  );

  // Phase 40 item 4 — "Merge PDFs" with NO document open. The Welcome
  // screen (and the File menu) can start a merge from scratch: one
  // multi-select picker, the first picked file opens as a brand-new
  // in-memory document, and the rest are merged into it by path. The
  // sequencing lives in the pure `runMergeFromScratch` helper so it is
  // unit-tested without mounting App; these closures supply the real
  // picker / engine / tab wiring.
  // DEF-610 — a synchronous re-entry guard for the from-scratch Merge. The
  // Home hero tile, the File menu and the dock all funnel into this callback;
  // a rapid double activation started the multi-select picker twice before the
  // first promise settled. The ref is set on entry and released in `finally`,
  // and a short cooldown from the last START also de-duplicates a real OS
  // double-click (two independent completed flows, clicks ~60ms apart) which a
  // per-flow `finally` alone would not cover once a cancelled picker resolves
  // in a few milliseconds.
  const MERGE_REENTRY_WINDOW_MS = 500;
  const mergeInFlightRef = useRef(false);
  const mergeLastStartRef = useRef(0);
  const runFromScratchMerge = useCallback(async (): Promise<void> => {
    const startedAt = Date.now();
    if (
      mergeInFlightRef.current ||
      startedAt - mergeLastStartRef.current < MERGE_REENTRY_WINDOW_MS
    ) {
      return;
    }
    mergeLastStartRef.current = startedAt;
    mergeInFlightRef.current = true;
    try {
      const pickPdfPaths = window.tflex.openFilesDialog;
      if (pickPdfPaths === undefined) {
        pushToast("error", "This build cannot select multiple PDFs.");
        return;
      }
      await runMergeFromScratch({
        pickPdfPaths: (): Promise<string[]> => pickPdfPaths("pdf"),
        openSinglePdf: (path: string): Promise<unknown> => openPdfFromPath(path),
        openFirstAsCombined: async (
          firstPath: string,
          totalPicked: number,
        ): Promise<{ tabId: string; engineDocId: string } | null> => {
          const loaded = await window.tflex.loadPdf(firstPath);
          if (!loaded.ok) {
            pushToast("error", toastForPdfError(loaded.error.code, firstPath));
            return null;
          }
          // In-memory: a from-scratch merge is a NEW document and must
          // never overwrite the first source file (Save-As is required
          // to keep it, exactly like split / extract / optimize).
          const opened = await openFromBytes(toArrayBuffer(loaded.value), {
            kind: "file",
            path: `<merge>${firstPath}`,
            displayName: `Merged (${totalPicked} files)`,
            onDiskPath: null,
            dedupePath: false,
          });
          if (opened === null) return null;
          return { tabId: opened.tabId, engineDocId: opened.engineDocId };
        },
        mergeRest: async (
          tabId: string,
          engineDocId: string,
          otherPaths: string[],
        ): Promise<{ ok: boolean; message?: string }> => {
          const result = await engineRef.current.merge(
            engineDocId,
            otherPaths,
            "after",
          );
          if (!result.ok) {
            return {
              ok: false,
              message: describeEngineError(result.error.code, result.error.message),
            };
          }
          noteOpApplied(tabId, result.value);
          // Merge mutates page content: rebuild the tab's PDF.js proxy
          // so the merged-in pages render (same refresh crop / stamp /
          // the doc-bound merge already use).
          const refreshFn = refreshDocProxyForRef.current;
          if (refreshFn !== null) {
            void refreshFn(tabId).catch(() => undefined);
          }
          return { ok: true };
        },
        onError: (message: string): void => {
          pushToast("error", message);
        },
        onMerged: (tabId: string, totalPicked: number): void => {
          // Mark the combined tab modified so the header dot shows it
          // has not been saved yet (mirrors the split / extract flow).
          dispatchTabs({ type: "set-modified", id: tabId, modified: true });
          setOpenTabs((prev) => {
            const tab = prev[tabId];
            if (tab === undefined) return prev;
            return {
              ...prev,
              [tabId]: { ...tab, meta: { ...tab.meta, modified: true } },
            };
          });
          pushToast("info", `Merged ${totalPicked} PDFs into one document.`);
        },
      });
    } finally {
      mergeInFlightRef.current = false;
    }
  }, [openFromBytes, openPdfFromPath, pushToast, noteOpApplied, toastForPdfError]);

  /** Phase 40 item 4 — one Merge entry point for the Welcome screen,
   *  the File menu and the dock. No document open -> from-scratch
   *  multi-select merge; otherwise the existing doc-bound dialog. */
  const openMergeFlow = useCallback((): void => {
    // "No document open" includes an active EMPTY tab (a "+ tab" with
    // no document registered in openTabs) — not just activeId === null.
    const activeId = tabsRef.current.activeId;
    const hasDocument =
      activeId !== null && openTabsRef.current[activeId] !== undefined;
    if (mergeClickStartsFromScratch(hasDocument ? activeId : null)) {
      void runFromScratchMerge();
      return;
    }
    setMergeOpen(true);
  }, [runFromScratchMerge]);

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
        openMergeFlow();
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
        // Phase 36 (chunk 5) — RE-POINTED. The All-tools panel is retired, so
        // the File > Tools route now opens the Command Palette (the
        // browse-everything surface that superseded it). The action id and
        // the Ctrl+Shift+P accelerator stay the same legacy aliases.
        setCommandPaletteOpen(true);
      },
      about: (): void => {
        setAboutOpen(true);
      },
      preferences: (): void => {
        setPrefsOpen(true);
      },
      optimize: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setOptimizeOpen(true);
      },
      auditSpace: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setAuditOpen(true);
      },
      // Phase 9 — Create from images is reachable from the welcome
      // screen too (no doc required). Export-Pages requires an
      // active doc; gate on the same active-tab id the other
      // doc-bound actions use.
      createFromImages: (): void => {
        setCreateOpen(true);
      },
      exportPages: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setExportOpen(true);
      },
      // Phase 9 advanced — text export, docx export, and insert
      // pages. Each routes through the same modal-state plumbing
      // as the raster export. The host stays menu-agnostic; the
      // dialogs own their own engine IPC and the user can also
      // reach these via the Tools palette.
      exportText: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setTextExportOpen(true);
      },
      exportDocx: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setDocxExportOpen(true);
      },
      insertPages: (): void => {
        if (activeTabIdRefLocal.current === null) return;
        setInsertPagesOpen(true);
      },
      // Phase 11 — Recognize Text (OCR). Same funnel as the
      // toolbar's OCR button and the Tools palette entry.
      recognizeText: (): void => {
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
      openMergeFlow,
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
    // Phase 40 item 4 — routes from-scratch (no doc) or doc-bound.
    openMergeFlow();
  }, [openMergeFlow]);

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
    if (activeTabIdRefLocal.current === null) return;
    setAuditOpen(true);
  }, []);

  // ---- Phase 52 (feature D): Encrypt document ----

  const onEncryptClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setEncryptOpen(true);
  }, []);

  const onCancelEncrypt = useCallback((): void => {
    setEncryptOpen(false);
  }, []);

  /** Produce the encrypted bytes via the engine, then write them through the
   *  renderer's existing bytes-save flow (`downloadBlob`, the same OS save
   *  picker the FDF / export flows use). The persisted defaults are
   *  PASSWORD-FREE (algorithm + permissions only). */
  const onEncryptConfirm = useCallback(
    async (confirm: EncryptDialogConfirm): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      const open = activeId === null ? undefined : openTabsRef.current[activeId];
      if (open === undefined) {
        setEncryptOpen(false);
        return;
      }
      if (engineRef.current.encryptDocument === undefined) {
        pushToast("error", "Encrypting requires the Phase 52 backend update.");
        return;
      }
      setEncryptBusy(true);
      try {
        const result = await engineRef.current.encryptDocument(
          open.session.engineDocId,
          confirm.options,
        );
        if (!result.ok) {
          pushToast(
            "error",
            describeEngineError(result.error.code, result.error.message),
          );
          return;
        }
        setEncryptOpen(false);
        // Remember the defaults WITHOUT a password.
        setSettings((prev) => {
          if (prev === null) return prev;
          const updated = preferencesReducer(prev, {
            type: "set-encrypt-defaults",
            value: confirm.defaults,
          });
          if (updated !== prev) trackAndSave(updated);
          return updated;
        });
        const suggested = encryptedFilename(open.displayName);
        downloadBlob(
          new Blob([result.value], { type: "application/pdf" }),
          suggested,
        );
        pushToast(
          "info",
          `Encrypted copy of ${open.displayName} saved. It opens with the user password.`,
        );
      } finally {
        setEncryptBusy(false);
      }
    },
    [pushToast, trackAndSave],
  );

  const onCancelAudit = useCallback((): void => {
    setAuditOpen(false);
  }, []);

  // ---- Phase 9: Create-from-images + Export-Pages ----

  const onCreateClick = useCallback((): void => {
    setCreateOpen(true);
  }, []);

  const onCancelCreate = useCallback((): void => {
    setCreateOpen(false);
  }, []);

  /** Host callback: invoke the create-from-images routing and hand the
   *  result to a brand-new tab. Phase 54 — when every picked input is a real
   *  on-disk image, the conversion service's `toDocumentMany` produces the
   *  document so each page's size comes from the image's own DPI metadata;
   *  clipboard images and virtual files keep the legacy
   *  `engine.createFromImages` path byte-for-byte. The routing (single docId,
   *  bound bytes read-back, warning toast) lives in `createFromImagesRoute`
   *  so it is unit-testable without booting the App. */
  const runCreateFromImages = useCallback(
    async (
      files: File[],
      quality: number,
    ): Promise<
      { bytes: ArrayBuffer; size: number; name: string; conversion?: ConvertManyResult } | { error: string }
    > => {
      const webUtils = window.tflex.webUtils;
      const getPathForFile =
        webUtils !== undefined && typeof webUtils.getPathForFile === "function"
          ? (file: File): string => webUtils.getPathForFile(file)
          : undefined;
      return createFromImagesRoute({
        files,
        quality,
        getPathForFile,
        convert: window.tflex.convert,
        createFromImages: (docId, buffers, q) =>
          engineRef.current.createFromImages(docId, buffers, q),
        getDocumentBytes: (id) => {
          // DEF-374 — call the method ON the engine. Extracting it into a
          // local alias loses `this` on RealEngineAdapter's prototype method
          // and throws `Cannot read properties of undefined (reading 'inner')`.
          if (engineRef.current.getDocumentBytes === undefined) {
            return Promise.resolve({ ok: false as const, error: { code: "internal", message: "no-bytes-api" } });
          }
          return engineRef.current.getDocumentBytes(id);
        },
        pushToast,
      });
    },
    [pushToast],
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
        // Phase 54 — the conversion service already registered its docId (the
        // engine holds the merged document). Reuse it so `openFromBytes` does
        // not re-register the same bytes and mint a phantom document; the
        // legacy route has no registered doc and keeps its fresh id.
        ...(result.conversion !== undefined
          ? { engineDocId: result.conversion.docId }
          : {}),
      });
      if (opened !== null) {
        dispatchTabs({ type: "set-modified", id: opened.tabId, modified: true });
        // Phase 54 — a DPI-aware multi-image import carries the conversion
        // metadata; surface the full warning set in the same per-tab card
        // Phase 53 uses for converted imports (keyed by tab id).
        if (result.conversion !== undefined) {
          const conversion = result.conversion;
          setConvertNotices((prev) => ({
            ...prev,
            [opened.tabId]: noticeFromManyResult(conversion),
          }));
          setSourceFormatByTab((prev) => ({
            ...prev,
            [opened.tabId]: conversion.sourceFormats[0] ?? "png",
          }));
        }
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

  // ---- Phase 55 (feature D): office export (.xlsx / .pptx) ----
  //
  // The two verbs ride the DELIVER Action Dock and the Command Palette. The
  // dialogs stay OPEN after a successful export so the result's
  // `pagesWithoutText` notice stays readable; the host only toasts.
  const onXlsxExportClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setXlsxExportOpen(true);
  }, []);

  const onCancelXlsxExport = useCallback((): void => {
    setXlsxExportOpen(false);
  }, []);

  const onXlsxExportConfirm = useCallback(
    (result: { range: number[]; dpi: number }): void => {
      pushToast(
        "info",
        `Exported ${result.range.length} page${result.range.length === 1 ? "" : "s"} as XLSX at ${result.dpi} DPI.`,
      );
    },
    [pushToast],
  );

  const onPptxExportClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setPptxExportOpen(true);
  }, []);

  const onCancelPptxExport = useCallback((): void => {
    setPptxExportOpen(false);
  }, []);

  const onPptxExportConfirm = useCallback(
    (result: { range: number[]; dpi: number }): void => {
      pushToast(
        "info",
        `Exported ${result.range.length} page${result.range.length === 1 ? "" : "s"} as PPTX at ${result.dpi} DPI.`,
      );
    },
    [pushToast],
  );

  // Phase 112 (C5) - the Deliver inspector's export surface routes the prepared
  // configuration to the EXISTING export flows: the raster dialog for image
  // formats and the matching text / docx / office dialog for the writers. The
  // inspector never reimplements an export; it only launches the same command.
  const onInspectorExportRun = useCallback(
    (request: InspectorExportRequest): void => {
      if (activeTabIdRefLocal.current === null) return;
      // Seed the EXISTING flow with exactly what the inspector prepared; the
      // dialog still owns parsing, validation, progress, errors and the save.
      setInspectorExportSeed(request);
      switch (request.format) {
        case "png":
        case "jpeg":
        case "tiff":
          setExportOpen(true);
          break;
        case "txt":
          setTextExportOpen(true);
          break;
        case "docx":
          setDocxExportOpen(true);
          break;
        case "xlsx":
          setXlsxExportOpen(true);
          break;
        case "pptx":
          setPptxExportOpen(true);
          break;
      }
    },
    [],
  );

  // Phase 112 (C5 follow-up, TFL-985) - clear the inspector seed once every
  // export dialog is closed, so a later toolbar / menu export opens unseeded
  // while the inspector-seeded flow keeps its request for the whole open.
  useEffect(() => {
    if (
      !exportOpen &&
      !textExportOpen &&
      !docxExportOpen &&
      !xlsxExportOpen &&
      !pptxExportOpen
    ) {
      setInspectorExportSeed(null);
    }
  }, [exportOpen, textExportOpen, docxExportOpen, xlsxExportOpen, pptxExportOpen]);

  // Phase 112 (C5 follow-up) - the seed mapped to the dialog's initial props,
  // gated on the format so a modal never receives another format's request.
  const inspectorSeed =
    inspectorExportSeed !== null ? exportDialogSeed(inspectorExportSeed) : null;
  const seedFormat = inspectorExportSeed?.format ?? null;
  const imageSeedFormat =
    seedFormat === "png" || seedFormat === "jpeg" || seedFormat === "tiff"
      ? seedFormat
      : null;
  const imageSeed = imageSeedFormat !== null ? inspectorSeed : null;
  const textSeed = seedFormat === "txt" ? inspectorSeed : null;
  const docxSeed = seedFormat === "docx" ? inspectorSeed : null;
  const xlsxSeed = seedFormat === "xlsx" ? inspectorSeed : null;
  const pptxSeed = seedFormat === "pptx" ? inspectorSeed : null;

  const onInsertPagesClick = useCallback((): void => {
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

  /** Phase 36 (chunk 2) — the PAGES panel's "Insert blank after" menu item.
   *  The label promises an IMMEDIATE action on the clicked page, so it calls
   *  the engine's EXISTING `insertBlankPage` directly with
   *  afterIndex = page - 1 (0-based visible index after which to insert)
   *  instead of opening InsertPagesDialog. The dialog stays reachable from
   *  the toolbar and the All-tools palette. The blank page takes the clicked
   *  page's size when pdf.js can report it (US Letter otherwise), and the
   *  proxy/state refresh matches the dialog path (B17/B19: the inserted page
   *  is not visible until the proxy is rebuilt). */
  const onInsertBlankAfterPage = useCallback(
    async (page: number): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      let widthPt = 612;
      let heightPt = 792;
      try {
        const pdfPage = await open.session.doc.getPage(page);
        const vp = pdfPage.getViewport({ scale: 1 });
        widthPt = vp.width;
        heightPt = vp.height;
      } catch {
        // Keep the US Letter fallback when the page cannot be measured.
      }
      const res = await engineRef.current.insertBlankPage(
        open.session.engineDocId,
        page - 1,
        widthPt,
        heightPt,
      );
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      // Same post-op contract as the dialog path: mirror the engine's
      // echoed state, then rebuild the pdf.js proxy so the new blank page
      // renders at the right viewport.
      if (!engineRef.current.available) {
        noteOpApplied(activeId, res.value);
      } else {
        const stateResult = await engineRef.current.getState(open.session.engineDocId);
        if (stateResult.ok) noteOpApplied(activeId, stateResult.value);
      }
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      pushToast("info", "Inserted blank page.");
    },
    [noteOpApplied, pushToast],
  );

  // ---- Phase 12: residual page-organize + annotate parity ----

  /** Phase 12 — open the Replace-pages dialog. Lazy-load the page
   *  sizes for the active doc (used by the Crop dialog, not Replace,
   *  but we share the same seed function so the dialog opens
   *  instantly). */
  const onReplacePagesClick = useCallback((): void => {
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
          describeEngineError("engine-error", "Rename pages requires the Phase 12 backend update."),
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

  /** Phase 18 — fetch the applied-watermark list for the active doc
   *  (informational: it feeds the dialog's "Applied watermarks"
   *  section and its per-id delete buttons). A failure — or a
   *  pre-Phase-18 backend without `getWatermarks` — just clears the
   *  list; no toast, the list is not a user action. */
  const refreshWatermarkList = useCallback(async (): Promise<void> => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    const res = await engineRef.current.getWatermarks?.(open.session.engineDocId);
    if (res === undefined || !res.ok) {
      setWatermarkList([]);
      return;
    }
    setWatermarkList(res.value);
  }, []);

  /** Phase 90 (TFL-509-C1) — fetch the applied-Bates list for the active doc
   *  (feeds the unified review list's Bates category). A failure — or a
   *  pre-Phase-90 backend without `getBates` — just clears the list; no toast,
   *  the list is not a user action. */
  const refreshBatesList = useCallback(async (): Promise<void> => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    const res = await engineRef.current.getBates?.(open.session.engineDocId);
    if (res === undefined || !res.ok) {
      setBatesList([]);
      return;
    }
    setBatesList(res.value);
  }, []);

  /** Phase 18 — open the Watermark dialog from the toolbar / tools
   *  palette. The palette entry is disabled on doc-less tabs, so the
   *  guard here is a safety net for the other entry points. */
  const onWatermarkClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setWatermarkEditTarget(null);
    setWatermarkOpen(true);
    void refreshWatermarkList();
  }, [refreshWatermarkList]);

  const onCancelWatermark = useCallback((): void => {
    setWatermarkOpen(false);
    setWatermarkEditTarget(null);
  }, []);

  /** Phase 89 (FEA-033) — open the Bates-numbering dialog from the REVIEW
   *  dock / palette. The registry verb is disabled on doc-less tabs, so the
   *  guard here is a safety net for the other entry points. */
  const onBatesClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setBatesEditTarget(null);
    setBatesOpen(true);
    void refreshBatesList();
  }, [refreshBatesList]);

  const onCancelBates = useCallback((): void => {
    setBatesOpen(false);
    setBatesEditTarget(null);
  }, []);

  /** Phase 89 (FEA-033) — persist the dialog's defaults through the existing
   *  settings path (mirrors `onSanitizeOptionsChange`), so the next open
   *  re-seeds from what the user last chose. */
  const onBatesDefaultsChange = useCallback(
    (defaults: BatesDefaults): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const current = prev.batesDefaults;
        if (
          current !== undefined &&
          current.prefix === defaults.prefix &&
          current.suffix === defaults.suffix &&
          current.startNumber === defaults.startNumber &&
          current.padding === defaults.padding &&
          current.position === defaults.position
        ) {
          return prev;
        }
        const updated: AppSettings = { ...prev, batesDefaults: defaults };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  /** Phase 89 (FEA-033) — bake the configured Bates numbers into the active
   *  document through `engine.addBates`. On success the mirror refreshes via
   *  `noteOpApplied`, the pdf.js proxy reloads so the baked numbers are
   *  visible without a save+reopen cycle, and the stamped count + labels are
   *  returned to the dialog's report. A failure returns the readable error
   *  text for the same report (the toast is pushed here too). */
  const onBatesConfirm = useCallback(
    async (
      settings: BatesSettings,
      editId?: string,
    ): Promise<BatesConfirmOutcome | void> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      onBatesDefaultsChange({
        prefix: settings.prefix,
        suffix: settings.suffix,
        startNumber: settings.startNumber,
        padding: settings.padding,
        position: settings.position,
      });
      const res =
        editId === undefined
          ? await engineRef.current.addBates?.(open.session.engineDocId, settings)
          : await engineRef.current.updateBates?.(
              open.session.engineDocId,
              editId,
              settings,
            );
      if (res === undefined) {
        const message =
          editId === undefined
            ? "Bates numbering requires the Phase 89 backend update."
            : "Bates numbering update requires the Phase 90 backend update.";
        pushToast("error", describeEngineError("engine-error", message));
        return { error: message };
      }
      if (!res.ok) {
        const message = describeEngineError(res.error.code, res.error.message);
        pushToast("error", message);
        return { error: message };
      }
      noteOpApplied(activeId, res.value.state as EngineState);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      pushToast(
        "info",
        editId === undefined ? "Bates numbers applied." : "Bates numbering updated.",
      );
      void refreshBatesList();
      return { stamped: res.value.stamped, labels: res.value.labels };
    },
    [noteOpApplied, pushToast, onBatesDefaultsChange, refreshBatesList],
  );

  /** Phase 18 — apply the configured watermark to the active document
   *  through `engine.addWatermark` (the engine bakes it into the
   *  selected pages' content streams, one-way like stamps). On
   *  success the mirror refreshes via `noteOpApplied` and the pdf.js
   *  proxy is reloaded so the baked watermark is visible without a
   *  save+reopen cycle (same pattern as stamp / crop / OCR). */
  const onWatermarkConfirm = useCallback(
    async (settings: WatermarkSettings, editId?: string): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      setWatermarkOpen(false);
      setWatermarkEditTarget(null);
      const res =
        editId === undefined
          ? await engineRef.current.addWatermark?.(
              open.session.engineDocId,
              settings,
            )
          : await engineRef.current.updateWatermark?.(
              open.session.engineDocId,
              editId,
              settings,
            );
      if (res === undefined) {
        pushToast(
          "error",
          describeEngineError("engine-error", "Watermark requires the Phase 18 backend update."),
        );
        return;
      }
      if (!res.ok) {
        pushToast("error", describeEngineError(res.error.code, res.error.message));
        return;
      }
      noteOpApplied(activeId, res.value);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        void refreshFn(activeId).catch(() => undefined);
      }
      pushToast(
        "info",
        editId === undefined ? "Watermark applied." : "Watermark updated.",
      );
    },
    [noteOpApplied, pushToast],
  );

  /** Phase 18 — delete an applied watermark by id from the active
   *  document through `engine.deleteWatermark`. On success the mirror
   *  refreshes via `noteOpApplied` and the pdf.js proxy reloads (the
   *  watermark's content stream was removed from the pages), then the
   *  dialog's applied-watermark list refreshes. The dialog stays open
   *  so the user can delete more watermarks in one pass. */
  const onDeleteWatermark = useCallback(
    async (id: string): Promise<void> => {
      // DEF-219 — single-flight: a second click while the first delete is
      // still awaiting the engine must not fire a delete for an id the
      // engine already removed (the stale row stays in the DOM until the
      // list refresh returns). The ref is authoritative; the state value
      // would be stale inside this callback.
      if (deleteInFlightRef.current) return;
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      deleteInFlightRef.current = true;
      setDeletingWatermarkId(id);
      try {
        const res = await engineRef.current.deleteWatermark?.(
          open.session.engineDocId,
          id,
        );
        if (res === undefined) {
          pushToast(
            "error",
            describeEngineError("engine-error", "Watermark requires the Phase 18 backend update."),
          );
          return;
        }
        if (!res.ok) {
          pushToast("error", describeEngineError(res.error.code, res.error.message));
          return;
        }
        noteOpApplied(activeId, res.value);
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(activeId).catch(() => undefined);
        }
        pushToast("info", "Watermark deleted.");
        void refreshWatermarkList();
      } finally {
        deleteInFlightRef.current = false;
        setDeletingWatermarkId(null);
      }
    },
    [noteOpApplied, pushToast, refreshWatermarkList],
  );

  /** Phase 90 (TFL-509-C1) — jump the workspace to a review element's page
   *  through the existing rail-jump path (the same `jumpRequest` mechanism a
   *  page drop reveal uses; `seq` makes a repeat click land). */
  const jumpToReviewPage = useCallback((page: number): void => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    railJumpSeqRef.current += 1;
    setRailJump({
      tabId: activeId,
      page: Math.max(1, Math.floor(page)),
      seq: railJumpSeqRef.current,
    });
  }, []);

  /** Phase 90 (TFL-509-C1) — the unified review list's select. */
  const onSelectReviewElement = useCallback(
    (el: ReviewElementRef): void => {
      jumpToReviewPage(el.page);
    },
    [jumpToReviewPage],
  );

  /** Phase 90 (TFL-509-C2) — the unified review list's edit. Annotations edit
   *  through their own panel; Bates / Watermarks open their dialog in update
   *  mode seeded from the row's record; a signature's "edit" is the existing
   *  on-canvas move/resize reached by selecting the row (Ruling 7). A row whose
   *  record vanished fails loud (never a silent no-op). */
  const onEditReviewElement = useCallback(
    (el: ReviewElementRef): void => {
      if (el.type === 'annotation') return;
      if (el.type === 'signature') {
        onSelectReviewElement(el);
        return;
      }
      if (el.type === 'bates') {
        const info = batesList.find((b) => b.id === el.id);
        if (info === undefined) {
          pushToast(
            'error',
            describeEngineError('engine-error', 'This Bates run is no longer in the document.'),
          );
          return;
        }
        setBatesEditTarget(info);
        setBatesOpen(true);
        return;
      }
      const info = watermarkList.find((w) => w.id === el.id);
      if (info === undefined) {
        pushToast(
          'error',
          describeEngineError('engine-error', 'This watermark is no longer in the document.'),
        );
        return;
      }
      setWatermarkEditTarget(info);
      setWatermarkOpen(true);
    },
    [batesList, watermarkList, onSelectReviewElement, pushToast],
  );

  /** Phase 90 (TFL-509-C1) — the unified review list's delete: exactly ONE
   *  engine call for the row's type, then refresh the doc proxy + the list.
   *  A refusal pushes an error toast AND sets the row's fail-loud message
   *  (Ruling 9). Single-flight, mirroring `onDeleteWatermark`. */
  const onDeleteReviewElement = useCallback(
    async (el: ReviewElementRef): Promise<void> => {
      const key = `${el.type}:${el.id}`;
      if (deleteInFlightRef.current) return;
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      deleteInFlightRef.current = true;
      const setRowError = (message: string): void => {
        setReviewElementErrors((prev) => ({ ...prev, [key]: message }));
      };
      const clearRowError = (): void => {
        setReviewElementErrors((prev) => {
          if (prev[key] === undefined) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      };
      try {
        const docId = open.session.engineDocId;
        if (el.type === 'annotation') {
          await onDeleteAnnotation(activeId, el.id);
          return;
        }
        if (el.type === 'signature') {
          const res = await engineRef.current.deleteSignature(docId, el.id);
          if (!res.ok) {
            const message = describeEngineError(res.error.code, res.error.message);
            pushToast('error', message);
            setRowError(message);
            return;
          }
          clearRowError();
          setOpenTabs((prev) => {
            const existing = prev[activeId];
            if (existing === undefined) return prev;
            return {
              ...prev,
              [activeId]: {
                ...existing,
                placements: res.value.signatures ?? existing.placements,
              },
            };
          });
          noteOpApplied(activeId, res.value);
          const refreshFn = refreshDocProxyForRef.current;
          if (refreshFn !== null) {
            void refreshFn(activeId).catch(() => undefined);
          }
          pushToast('info', 'Signature deleted.');
          return;
        }
        const res =
          el.type === 'bates'
            ? await engineRef.current.deleteBates?.(docId, el.id)
            : await engineRef.current.deleteWatermark?.(docId, el.id);
        if (res === undefined) {
          const message = describeEngineError(
            'engine-error',
            el.type === 'bates'
              ? 'Bates numbering requires the Phase 90 backend update.'
              : 'Watermark requires the Phase 18 backend update.',
          );
          pushToast('error', message);
          setRowError(message);
          return;
        }
        if (!res.ok) {
          const message = describeEngineError(res.error.code, res.error.message);
          pushToast('error', message);
          setRowError(message);
          return;
        }
        clearRowError();
        noteOpApplied(activeId, res.value);
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(activeId).catch(() => undefined);
        }
        if (el.type === 'bates') {
          pushToast('info', 'Bates numbering deleted.');
          void refreshBatesList();
        } else {
          pushToast('info', 'Watermark deleted.');
          void refreshWatermarkList();
        }
      } finally {
        deleteInFlightRef.current = false;
      }
    },
    [
      noteOpApplied,
      pushToast,
      refreshBatesList,
      refreshWatermarkList,
      onDeleteAnnotation,
    ],
  );

  /** The unified review list's row-level fail-loud lookup (Ruling 9). */
  const reviewErrorFor = useCallback(
    (el: ReviewElementRef): string | null =>
      reviewElementErrors[`${el.type}:${el.id}`] ?? null,
    [reviewElementErrors],
  );

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

  /** Phase 84 (True redaction) — commit one page's pending redaction marks
   *  through the active engine client. The overlay supplies a docId, but the
   *  host binds the ACTIVE document so the call can never target a stale
   *  tab. On success the state is mirrored (noteOpApplied) and the pdf.js
   *  proxy is refreshed so the rewritten content stream is visible without
   *  a save+reopen cycle. */
  const onApplyRedactions = useCallback<ApplyRedactions>(
    async (_docId, payload) => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) {
        return err("engine-error", "No active document.");
      }
      const open = openTabsRef.current[activeId];
      if (open === undefined) {
        return err("engine-error", "No active document.");
      }
      const res = await engineRef.current.applyRedactions?.(
        open.session.engineDocId,
        payload,
      );
      if (res === undefined) {
        return err(
          "engine-error",
          "Redaction requires the Phase 84 backend update.",
        );
      }
      if (res.ok) {
        noteOpApplied(activeId, res.value.state as EngineState);
        const refreshFn = refreshDocProxyForRef.current;
        if (refreshFn !== null) {
          void refreshFn(activeId).catch(() => undefined);
        }
      }
      return res;
    },
    [noteOpApplied],
  );

  /** Phase 86 (FEA-038) — replace the glyphs covered by the Find bar's
   *  occurrences. Bound to the pane's OWN tab id so a Multi Mode replace can
   *  never target the wrong document. On success the echoed state is
   *  mirrored (noteOpApplied) and the pdf.js proxy is rebuilt in place —
   *  the same lever `handleEditTextRun` uses — so the rewritten text is
   *  visible without a save/reopen. */
  const handleReplaceText = useCallback(
    async (
      tabId: string,
      payload: ReplaceTextPayload,
    ): Promise<Result<ReplaceTextResult, EngineError>> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) {
        return err("engine-error", "No active document.");
      }
      const result = await engineRef.current.replaceText?.(
        open.session.engineDocId,
        payload,
      );
      if (result === undefined) {
        return err(
          "engine-error",
          "Replace requires the Phase 86 backend update.",
        );
      }
      if (!result.ok) {
        return result;
      }
      noteOpApplied(tabId, result.value.state as EngineState);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(tabId).catch(() => undefined);
      }
      return result;
    },
    [noteOpApplied],
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

  // ---- Phase 53 (feature G mode 2): Fill form fields from CSV ----------
  //
  // The verb is gated on the active document actually having AcroForm
  // fields (the registry's `form-fields` precondition, read live by the
  // dock/palette). The dialog runs `convert.csvToDocumentFields` against
  // the ACTIVE document's engine id; a success refreshes form state
  // through the SAME path a normal form fill uses.

  const onFillFromCsvClick = useCallback((): void => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    // Fail loud by construction: with no fields the verb is disabled (and
    // carries this reason), so this guard only protects a direct call.
    if (open.forms.fields.length === 0) return;
    setFillFromCsvOpen(true);
  }, []);

  const pickCsvFile = useCallback(async (): Promise<string | null> => {
    if (window.tflex.openFileDialog === undefined) return null;
    // `'document'` already groups `.csv` under Spreadsheets; no new dialog
    // kind is introduced for this feature.
    return window.tflex.openFileDialog("document");
  }, []);

  const runCsvToFieldsForActiveTab = useCallback(
    async (
      path: string,
    ): Promise<{ result: CsvFieldMappingResult } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const convert = window.tflex.convert;
      if (convert?.csvToDocumentFields === undefined) {
        return { error: "Filling form fields from CSV requires a newer build." };
      }
      const res = await convert.csvToDocumentFields(open.session.engineDocId, path);
      if (!res.ok) {
        return { error: toastForConvertError(res.error.code, path) };
      }
      // The values were written by the ENGINE. Refresh the active tab's
      // form state + modified flag through the same getState -> noteOpApplied
      // path a normal form fill uses; the engineUi mirror then re-seeds
      // openTabs[tabId].forms via replaceFields. No React form state is
      // hand-mutated here.
      syncEngineStateAfterFill(activeId);
      return { result: res.value };
    },
    [syncEngineStateAfterFill],
  );

  const onFillFromCsvApplied = useCallback(
    (applied: FillFromCsvApplied): void => {
      pushToast(
        "info",
        `Filled ${applied.filled} form field${applied.filled === 1 ? "" : "s"} from ${applied.path}.`,
      );
    },
    [pushToast],
  );

  // ---- Phase 57 (feature B): Export / Import form data (FDF | XFDF) -----
  //
  // Distinct from the Phase-12 comment FDF verbs above: this payload is the
  // AcroForm field VALUES, not annotations. Both verbs are gated on the
  // active document actually having form fields (the registry's
  // `form-fields` precondition). The export flow is TWO IPC calls —
  // `exportFormData` yields the bytes, `saveFormDataFile` writes them; the
  // import flow is `loadFormData` then `importFormData`, and a success
  // refreshes form state through the SAME path a normal fill uses.

  const onExportFormDataClick = useCallback((): void => {
    setFormDataIo({ open: true, mode: "export" });
  }, []);

  const onImportFormDataClick = useCallback((): void => {
    setFormDataIo({ open: true, mode: "import" });
  }, []);

  const pickFormDataFile = useCallback(async (): Promise<string | null> => {
    if (window.tflex.openFileDialog === undefined) return null;
    return window.tflex.openFileDialog("formData");
  }, []);

  /** Describe an `FdfOpenError` (a load failure) in user terms. */
  const describeFormDataLoadError = (code: FdfOpenError): string => {
    switch (code) {
      case "not-fdf":
        return "That file is not an FDF or XFDF form-data file.";
      case "corrupt":
        return "The form-data file is corrupt or unreadable.";
      case "io":
        return "Could not read the form-data file.";
    }
  };

  /** Describe an `FdfOpenError` (a save/write failure) in user terms. */
  const describeFormDataSaveError = (code: FdfOpenError): string =>
    code === "io"
      ? "Could not write the form-data file."
      : "The form-data file could not be written.";

  const runFormDataExport = useCallback(
    async (
      format: FormDataFormat,
    ): Promise<
      { path: string; count: number } | { cancelled: true } | { error: string }
    > => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      if (engineRef.current.exportFormData === undefined) {
        return {
          error: describeEngineError(
            "engine-error",
            "Export form data requires the Phase 57 backend update.",
          ),
        };
      }
      const bytes = await engineRef.current.exportFormData(open.session.engineDocId, format);
      if (!bytes.ok) {
        return { error: describeEngineError(bytes.error.code, bytes.error.message) };
      }
      if (window.tflex.saveFormDataFile === undefined) {
        return {
          error: describeEngineError(
            "engine-error",
            "Saving form data requires the Phase 57 backend update.",
          ),
        };
      }
      const saved = await window.tflex.saveFormDataFile(
        format,
        new Uint8Array(bytes.value),
        `jovrel-form-data.${format}`,
      );
      if (!saved.ok) {
        return { error: describeFormDataSaveError(saved.error.code) };
      }
      // A null result is the user cancelling the OS save dialog: an explicit
      // cancelled result, a silent no-op (no toast, no error text).
      if (saved.value === null) return { cancelled: true };
      return { path: saved.value.path, count: open.forms.fields.length };
    },
    [],
  );

  const runFormDataImport = useCallback(
    async (
      format: FormDataFormat,
      path: string,
    ): Promise<{ report: FormDataImportReport; path: string } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      if (
        window.tflex.loadFormData === undefined ||
        engineRef.current.importFormData === undefined
      ) {
        return {
          error: describeEngineError(
            "engine-error",
            "Import form data requires the Phase 57 backend update.",
          ),
        };
      }
      const loaded = await window.tflex.loadFormData(path);
      if (!loaded.ok) {
        return { error: describeFormDataLoadError(loaded.error.code) };
      }
      const result = await engineRef.current.importFormData(
        open.session.engineDocId,
        format,
        new Uint8Array(loaded.value),
      );
      if (!result.ok) {
        return { error: describeEngineError(result.error.code, result.error.message) };
      }
      // The values were written by the ENGINE. Refresh the active tab's form
      // state through the same getState -> noteOpApplied path a normal form
      // fill uses; the report carries no engine state.
      syncEngineStateAfterFill(activeId);
      return { report: result.value, path };
    },
    [syncEngineStateAfterFill],
  );

  const onFormDataIoApplied = useCallback(
    (
      applied:
        | { kind: "export"; path: string; count: number }
        | { kind: "import"; report: FormDataImportReport; path: string },
    ): void => {
      if (applied.kind === "export") {
        pushToast(
          "info",
          `Exported ${applied.count} form field${applied.count === 1 ? "" : "s"} to ${applied.path}.`,
        );
        return;
      }
      const updated = applied.report.matched.length;
      pushToast(
        "info",
        `Imported ${updated} form field${updated === 1 ? "" : "s"} from ${applied.path}.`,
      );
    },
    [pushToast],
  );

  // ---- Phase 54 (features D + E): validate the active document ----------
  //
  // The verb rides the REVIEW Action Dock and the Command Palette (both run
  // through `dockAppActions`). `window.tflex.validation` is optional: its
  // absence disables the verb with a declared reason, never a throw. A run
  // writes the per-tab report card AND returns the report for the dialog's
  // inline view; a blocked/warned save writes the same card from the engine's
  // report.

  const onValidateDocumentClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setValidateOpen(true);
  }, []);

  const dismissValidationNotice = useCallback((tabId: string): void => {
    setValidationNotices((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const noteValidationReport = useCallback(
    (
      tabId: string,
      report: ValidationReport,
      variant: ValidationNoticeState["variant"],
    ): void => {
      setValidationNotices((prev) => ({ ...prev, [tabId]: { report, variant } }));
    },
    [],
  );

  const runValidationForActiveTab = useCallback(
    async (
      target: ValidationTarget,
    ): Promise<{ report: ValidationReport } | { error: string }> => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const validation = window.tflex.validation;
      if (validation?.validate === undefined) {
        return { error: "Validation is not available in this build." };
      }
      const res = await validation.validate(open.session.engineDocId, target);
      if (!res.ok) return { error: validationErrorText(res.error.code) };
      noteValidationReport(activeId, res.value, "report");
      return { report: res.value };
    },
    [noteValidationReport],
  );

  const onValidationDefaultsChange = useCallback(
    (defaults: PdfValidationDefaults): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated = withValidationDefaults(prev, defaults);
        if (updated !== prev) trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  // ---- Phase 88 (FEA-037): sanitize the active document -----------------
  //
  // The verb rides the REVIEW Action Dock and the Command Palette (both run
  // through `dockAppActions`). The renderer client's `sanitizeDoc` is
  // optional: its absence degrades with a readable reason, never a throw. A
  // successful run mirrors the echoed state, rebuilds the pdf.js proxy and
  // returns the per-class report for the dialog's inline view.

  const onSanitizeClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setSanitizeOpen(true);
  }, []);

  const runSanitizeForActiveTab = useCallback(
    async (
      options: SanitizeOptions,
    ): Promise<
      { report: SanitizeReport; warnings: string[] } | { error: string }
    > => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const client = engineRef.current;
      if (client.sanitizeDoc === undefined) {
        return { error: "Sanitize requires the Phase 88 backend update." };
      }
      const res = await client.sanitizeDoc(open.session.engineDocId, { options });
      if (!res.ok) {
        return { error: describeEngineError(res.error.code, res.error.message) };
      }
      noteOpApplied(activeId, res.value.state as EngineState);
      // The engine rewrote the working document; rebuild the pdf.js proxy so
      // the live view paints the sanitized bytes (DEF-108 refresh hook).
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(activeId).catch(() => undefined);
      }
      return { report: res.value.report, warnings: res.value.warnings };
    },
    [noteOpApplied],
  );

  const onSanitizeOptionsChange = useCallback(
    (options: SanitizeOptions): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const current = prev.sanitizeOptions;
        if (
          current !== undefined &&
          current.javascript === options.javascript &&
          current.launchActions === options.launchActions &&
          current.embeddedFiles === options.embeddedFiles &&
          current.metadata === options.metadata
        ) {
          return prev;
        }
        const updated: AppSettings = { ...prev, sanitizeOptions: options };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  // ---- Phase 57 (feature A): engineering layers / document info ---------
  //
  // Two REVIEW verbs. The layers panel toggles a document's OCG visibility
  // through the engine (undoable, marks the doc modified); the echoed state is
  // applied and the pdf.js proxy rebuilt so the page re-renders with the layer
  // off. The document-info dialog reports the PDF/E block, the layer count and
  // the 3D content. A missing bridge is a declared engine-error, never a throw.

  /** Re-fetch the engineering surfaces for one document (used after a toggle). */
  const refetchEngineeringFor = useCallback((docId: string): void => {
    const client = engineRef.current;
    void (async () => {
      // Call THROUGH the receiver: a detached `const f = client.getLayers`
      // loses `this` on the real adapter (its methods read `this.inner`).
      if (client.getLayers !== undefined) {
        const r = await client.getLayers(docId);
        if (r.ok) setLayersByDoc((prev) => ({ ...prev, [docId]: r.value }));
      }
      if (client.getCadMetadata !== undefined) {
        const r = await client.getCadMetadata(docId);
        if (r.ok) setCadByDoc((prev) => ({ ...prev, [docId]: r.value }));
      }
      if (client.get3dContent !== undefined) {
        const r = await client.get3dContent(docId);
        if (r.ok) setContent3dByDoc((prev) => ({ ...prev, [docId]: r.value }));
      }
    })();
  }, []);

  const onEngineeringLayersClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setEngineeringLayersOpen(true);
  }, []);

  const onDocumentInfoClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setDocumentInfoOpen(true);
  }, []);

  /** The engine call the layers panel drives. A bridge-absent build returns a
   *  declared engine-error so the panel toasts it and reverts the checkbox. */
  const runLayerToggle = useCallback(
    async (docId: string, index: number, visible: boolean) => {
      const client = engineRef.current;
      if (client.setLayerVisibility === undefined) {
        return {
          ok: false as const,
          error: {
            code: "engine-error" as const,
            message: "PDF/E layers require the Phase 57 backend update.",
          },
        };
      }
      return client.setLayerVisibility(docId, index, visible);
    },
    [],
  );

  /** After a successful toggle: mirror the echoed state and re-fetch the
   *  document's engineering surfaces so the panel shows the engine's truth. */
  const onLayerStateApplied = useCallback(
    (state: EngineState): void => {
      const tabId = activeTabIdRefLocal.current;
      if (tabId !== null) noteOpApplied(tabId, state);
      const docId = tabId === null ? undefined : openTabsRef.current[tabId]?.session.engineDocId;
      if (docId !== undefined) refetchEngineeringFor(docId);
    },
    [noteOpApplied, refetchEngineeringFor],
  );

  const refreshActiveDocProxy = useCallback(async (): Promise<boolean> => {
    const tabId = activeTabIdRefLocal.current;
    const fn = refreshDocProxyForRef.current;
    if (tabId === null || fn === null) return false;
    return fn(tabId);
  }, []);

  // ---- Phase 12: Delete pages dialog (B8) ----

  /** Open the B8 delete pages dialog against the active tab. The
   *  toolbar / Tools palette both funnel through this; the rail's
   *  per-thumb delete still uses `onDelete(tabId, [page])`
   *  directly (no dialog) for the single-thumb case.
   *
   *  Phase 36 (chunk 2) — `page` is the optional seed the PAGES panel's
   *  "Delete…" menu item passes (the visible page the gesture landed on);
   *  the dialog uses it in place of the tab's current page. The toolbar
   *  and palette pass no argument, so their behaviour is unchanged. */
  const onDeletePageClick = useCallback((page?: number): void => {
    if (activeTabIdRefLocal.current === null) return;
    setDeletePageSeed(page !== undefined && page > 0 ? page : null);
    setDeletePageOpen(true);
  }, []);

  const onCancelDeletePage = useCallback((): void => {
    setDeletePageOpen(false);
    setDeletePageSeed(null);
  }, []);

  const onDeletePageConfirm = useCallback(
    (choice: { mode: "current" | "range"; pages: number[] }): void => {
      setDeletePageOpen(false);
      setDeletePageSeed(null);
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

  // ---- Phase 87 (FEA-039): remove blank pages ----

  /** The persisted ink threshold, read through the ref so the scan callbacks
   *  stay stable across an unrelated settings re-render. */
  const blankThreshold =
    settingsRef.current?.blankPageInkThreshold ?? DEFAULT_BLANK_INK_THRESHOLD;

  const onChangeBlankThreshold = useCallback(
    (value: number): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated: AppSettings = { ...prev, blankPageInkThreshold: value };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  const onOpenBlankPages = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setBlankScanMeasurements(null);
    setBlankScanReport(null);
    setBlankScanProgress(0);
    setBlankPagesOpen(true);
  }, []);

  const onCloseBlankPages = useCallback((): void => {
    blankScanAbortRef.current?.abort();
    setBlankPagesOpen(false);
  }, []);

  const onRunBlankScan = useCallback(async (): Promise<void> => {
    const id = activeTabIdRefLocal.current;
    const tab = id === null ? undefined : openTabsRef.current[id];
    if (!id || tab === undefined) return;
    const controller = new AbortController();
    blankScanAbortRef.current = controller;
    setBlankScanRunning(true);
    setBlankScanReport(null);
    try {
      const measurements = await scanBlankDocument({
        doc: tab.session.doc,
        dpi: 96,
        threshold: blankThreshold,
        signal: controller.signal,
        onProgress: setBlankScanProgress,
      });
      setBlankScanMeasurements(measurements);
    } catch (e) {
      setBlankScanReport(
        "Scan failed: " + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBlankScanRunning(false);
      blankScanAbortRef.current = null;
    }
  }, [blankThreshold]);

  const handleRemoveBlankPages = useCallback(
    async (tabId: string, pages: number[]): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) {
        setBlankScanReport("No active document.");
        return;
      }
      const result = await engineRef.current.removeBlankPages?.(
        open.session.engineDocId,
        { pages },
      );
      if (result === undefined) {
        setBlankScanReport(
          "Remove blank pages requires the Phase 87 backend update.",
        );
        return;
      }
      if (!result.ok) {
        setBlankScanReport(
          describeEngineError(result.error.code, result.error.message),
        );
        return;
      }
      noteOpApplied(tabId, result.value.state as EngineState);
      const refreshFn = refreshDocProxyForRef.current;
      if (refreshFn !== null) {
        await refreshFn(tabId).catch(() => undefined);
      }
      const unclassified = classifyPages(
        blankScanMeasurementsRef.current ?? [],
        blankThreshold,
      ).unclassified;
      setBlankScanMeasurements([]);
      setBlankScanReport(
        formatScanReport(result.value.removed, result.value.skipped, unclassified),
      );
      pushToast(
        "info",
        "Removed " + result.value.removed.length + " blank page(s).",
      );
    },
    [noteOpApplied, pushToast, blankThreshold],
  );

  const onConfirmBlankScan = useCallback(
    (pages: number[]): void => {
      const id = activeTabIdRefLocal.current;
      if (id === null) return;
      void handleRemoveBlankPages(id, pages);
    },
    [handleRemoveBlankPages],
  );

  // ---- Phase 11: OCR (recognize text) ----

  /** Open the OCR dialog against the active tab. The toolbar /
   *  Tools palette / "Recognize Text" menu entry all funnel through
   *  this. */
  const onOcrClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setOcrOpen(true);
  }, []);

  const onCancelOcr = useCallback((): void => {
    setOcrOpen(false);
  }, []);

  // ---- Phase 30 / Phase 37 item 17: print ----

  /** Build the standalone print window's context for the ACTIVE document:
   *  the engine doc id, the display name, the page count and the default
   *  print settings. There is no persisted print-settings store, so the
   *  settings are the control defaults the removed in-app dialog seeded with
   *  (`defaultPrintSettings`); the standalone window seeds its own controls
   *  from them via `seedPrintDialogState`. Returns null when no document is
   *  open (or the active tab has no engine entry - an empty tab). */
  const buildActivePrintContext = useCallback((): PrintWindowContext | null => {
    const id = activeTabIdRefLocal.current;
    if (id === null) return null;
    const tab = openTabsRef.current[id];
    if (tab == null) return null;
    return {
      docId: tab.session.engineDocId,
      documentName: tab.displayName,
      pageCount: tab.session.doc.numPages,
      settings: defaultPrintSettings(),
    };
  }, []);

  /** Open the standalone print window for the active document. The title-bar
   *  Print icon, File > Print and Ctrl+P all funnel through this. A refusal
   *  (a malformed context, or a window that could not be created) surfaces
   *  through the app's existing error toast instead of a silent no-op. */
  const openPrintWindow = useCallback((): void => {
    const context = buildActivePrintContext();
    if (context === null) {
      // DEF-336 — an empty placeholder tab active while another tab holds a
      // document: the title-bar control and File > Print are disabled, but a
      // direct Ctrl+P / programmatic request must still fail loud rather than
      // silently do nothing.
      pushToast("error", "Open a document to print. The active tab is empty.");
      return;
    }
    const bridge = window.tflex.printWindow;
    if (bridge === undefined) {
      pushToast("error", "This build cannot open a separate print window.");
      return;
    }
    void bridge.open(context).then((result) => {
      const failure = printWindowOpenFailureMessage(result);
      if (failure !== null) {
        pushToast("error", failure);
      }
    });
  }, [buildActivePrintContext, pushToast]);

  // Keep the stable `onPrintRequest` subscription pointed at the latest
  // opener (the ref pattern documented at its declaration).
  openPrintWindowRef.current = openPrintWindow;

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
        // The engine's own serialized bytes are already decrypted, so a
        // password failure here is a corrupt/unreadable refresh rather
        // than an interactive prompt.
        const code = "error" in parsed ? parsed.error : "corrupt";
        pushToast(
          "error",
          `Could not refresh document proxy: ${toastForPdfError(code, open.displayName)}`,
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
      // Phase 85 — the refreshed bytes carry the engine's CURRENT outline
      // (setOutline writes catalog /Outlines before serialization). Re-read
      // it and re-seed the editable model so a committed edit reappears
      // after save + reload / undo / redo, and a refused edit can never
      // linger.
      void readOutline(parsed.doc)
        .then(async (freshOutline) => {
          const entries = await seedOutlineEntries(freshOutline ?? [], (dest) =>
            resolveOutlinePage(parsed.doc, dest),
          );
          setOpenTabs((prev) => {
            const existing = prev[tabId];
            if (existing === undefined) return prev;
            return {
              ...prev,
              [tabId]: {
                ...existing,
                session: {
                  ...existing.session,
                  outline: freshOutline,
                  outlineEntries: entries,
                },
              },
            };
          });
        })
        .catch(() => undefined);
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
   *  panel without a separate dialog interaction. Phase 51 (item 9):
   *  a cancelled run resolves as `{ cancelled: true }` — either our
   *  abort fired or the engine returned `error.code === 'cancelled'`
   *  after restoring the pre-run bytes — and is never an error. */
  const runOcrForActiveTab = useCallback(
    async (
      options: OcrRecognizeOptions,
      signal?: AbortSignal,
    ): Promise<
      | { ok: true; suspects: OcrSuspect[] }
      | { cancelled: true }
      | { error: string }
    > => {
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return { error: "No active document." };
      const open = openTabsRef.current[activeId];
      if (open === undefined) return { error: "No active document." };
      const result = await engineRef.current.ocrRecognize(
        open.session.engineDocId,
        options,
      );
      // Phase 51 (item 9) — the user cancelled while the engine call was in
      // flight. Skip the state mirror and the suspects fetch so no partial
      // result is applied. The engine's cancel path restores the pre-run
      // bytes, so the document is unchanged.
      if (signal?.aborted === true) return { cancelled: true };
      if (!result.ok) {
        // The engine confirmed the cancellation: `ocrCancel` flagged the run
        // and `ocrRecognize` resolved with error.code === 'cancelled' after
        // restoring the snapshot. Expected outcome, not an error toast.
        if (result.error.code === "cancelled") return { cancelled: true };
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

  /** Phase 51 (item 9) — flag the active tab's in-flight OCR run for
   *  cancellation. Wired to the OCR dialog's Cancel control. Main
   *  restores the pre-run bytes and resolves the pending `ocrRecognize`
   *  with `error.code === 'cancelled'`, which `runOcrForActiveTab` maps
   *  to `{ cancelled: true }`. The call never throws; a missing backend
   *  channel is a silent no-op (the dialog still leaves its running
   *  state). Fire-and-forget: the dialog settles its own UI immediately
   *  and the pending run's result is discarded. */
  const cancelOcrForActiveTab = useCallback((): void => {
    const activeId = activeTabIdRefLocal.current;
    if (activeId === null) return;
    const open = openTabsRef.current[activeId];
    if (open === undefined) return;
    void engineRef.current.ocrCancel?.(open.session.engineDocId);
  }, []);

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
    // Phase 51 (item 10) — the suspects view is an Inspector section now, so
    // opening it must also make sure the panel is not collapsed; otherwise
    // the control would look like a no-op.
    setInspectorCollapsed(false);
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

  /** Reads the OS clipboard and returns raw image bytes, a string when
   *  the clipboard holds only text, or null when empty/unavailable.
   *  Phase 45 item 1 — the Create-from-images dialog is the only
   *  consumer: it inserts image bytes into its list and refuses a
   *  string with a clear message, so plain text can never become a
   *  bogus PDF. Image MIME types are checked before text so a copied
   *  image wins when the clipboard carries both.
   *
   *  The renderer path is `navigator.clipboard.read()` (Chromium's
   *  async clipboard); the previous `window.electron.clipboard` shim
   *  was dead — preload exposes only `window.tflex` — and Electron
   *  44's main-process clipboard no longer has send-sync readImage.
   *  Electron's `clipboard` module lives in the MAIN process; if a
   *  future requirement needs formats the async API cannot see
   *  (e.g. an image FILE copied in the OS file manager), it needs a
   *  new main-side IPC channel — not reachable from here. */
  const readClipboard = useCallback(async (): Promise<
    Uint8Array | string | null | { error: string }
  > => {
    // Browser-side: navigator.clipboard is the only portable API.
    // Electron's renderer session grants `clipboard-read`, so reading
    // a real OS image (a copied bitmap / screenshot) yields
    // `image/png` here.
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      try {
        const items = await navigator.clipboard.read();
        // Two passes: return any image first, so an item that also
        // carries text/plain cannot be mistaken for text.
        for (const item of items) {
          for (const mime of ["image/png", "image/jpeg"]) {
            if (item.types.includes(mime)) {
              const blob = await item.getType(mime);
              return new Uint8Array(await blob.arrayBuffer());
            }
          }
        }
        for (const item of items) {
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

  // Phase 45 item 1 — clipboard content no longer becomes a PDF directly.
  // The Create-from-images dialog reads the clipboard itself, inserts a
  // copied image into its list (with a preview) and refuses plain text;
  // the confirm path above (`onCreateConfirm` -> engine.createFromImages)
  // is then the single creation route. `engine.createFromClipboard`
  // remains available on the engine client for other callers.

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
        addComment: (annotationId: string, text: string) => void;
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
        addComment: (annotationId: string, text: string): void => {
          void onAddComment(tabId, annotationId, text);
        },
      };
      cache.set(tabId, out);
      return out;
    };
  }, [engineUi, onCreateAnnotation, onEditAnnotation, onDeleteAnnotation, onAddComment, liveAnnTextIdsFor]);

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
          /** DEF-232 — the page the committing overlay owns. */
          page: number;
        }) => void | Promise<void>;
        onCommitTextBox: (args: {
          id?: string;
          rect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
        }) => void;
        onCommitImageEdit: (args: {
          op: "move" | "resize" | "replace" | "crop";
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          bytes: Uint8Array;
          format: "png" | "jpeg";
          id: string;
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
        }) => void;
        onCommitTextBoxMove: (args: {
          oldRect: { x: number; y: number; width: number; height: number };
          newRect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
          id: string;
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
        }) => void | Promise<void>;
        onDeleteTextBox: (id: string) => void;
        /** Phase 21 — apply a style patch to the selected committed box. */
        onTextStylePatch: (patch: TextBoxStylePatch) => void;
        /** Phase 26 — apply a patch (the panel Text field's session
         *  commit) to a specific committed box, by id. */
        onTextPatch: (id: string, patch: TextBoxStylePatch) => void;
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
          onTextStylePatch: (): void => undefined,
          onTextPatch: (): void => undefined,
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
          /** DEF-232 — the page the committing overlay owns. */
          page: number;
        }): void | Promise<void> => handleEditTextRun(tabId, args),
        onCommitTextBox: (args: {
          id?: string;
          rect: { x: number; y: number; width: number; height: number };
          text: string;
          style: EditTextStyle;
          background: "white" | "none";
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
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
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
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
          /** DEF-232 sibling — the page the committing overlay owns. */
          page: number;
        }): Promise<void> => handleTextBoxMove(tabId, args),
        onDeleteTextBox: (id: string): void => {
          void handleTextBoxDelete(tabId, id);
        },
        onTextStylePatch: (patch: TextBoxStylePatch): void => {
          const id = openTabsRef.current[tabId]?.edit.selectedTextBox;
          if (id === undefined || id === null) return;
          void handleTextBoxStylePatch(tabId, id, patch);
        },
        onTextPatch: (id: string, patch: TextBoxStylePatch): void => {
          void handleTextBoxStylePatch(tabId, id, patch);
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
    handleTextBoxStylePatch,
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
    // DEF-336 — Save / Save As / Close / Undo / Redo stay keyed to the active
    // TAB (unchanged); Print additionally needs a real document, so an empty
    // placeholder tab disables File > Print instead of accepting a click that
    // does nothing. The dep includes `activeTabHasDocument` because a document
    // loads into an already-active tab without `tabs.activeId` changing.
    window.tflex.menu.setEnabled(
      snapshotMenuEnabled(tabs.activeId !== null, activeTabHasDocument),
    );
  }, [tabs.activeId, activeTabHasDocument]);

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
        // DEF-243 — `!e.shiftKey` keeps Ctrl/Cmd+Shift+S out of the Save
        // branch. Without it the Shift variant was swallowed here (it
        // called `onSave` and preventDefault'd), so the keystroke saved
        // silently IN PLACE over the source file instead of opening the
        // Save-As flow. The guard mirrors the Ctrl+Z branch just below.
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "s" &&
        !e.shiftKey &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        void onSave(tabs.activeId);
      } else if (
        // DEF-243 — Ctrl/Cmd+Shift+S reaches Save As. This is the same
        // route the menu's `menuContext.saveAs` entry takes (identical
        // `tabs.activeId !== null` gate, identical `onSaveAs` handler),
        // mirrored into the renderer for the same reason as the DEF-049
        // OCR accelerator below: the native menu registers the matching
        // accelerator (src/main/menu.ts `menu.saveAs`), but Electron's
        // menu accelerator can race the focused renderer for the
        // keystroke, so the dialog must not depend on that race.
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "s" &&
        tabs.activeId !== null
      ) {
        e.preventDefault();
        void onSaveAs(tabs.activeId);
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
  }, [onOpenClick, closeTab, onSave, onSaveAs, onUndo, onRedo, onOcrClick, tabs.activeId, disarmEditTools]);

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
  // `onBatchOcr` / `onOcrSuspects` / `onClose` / `onCancel`) does NOT
  // appear in any child component's
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
  // Phase 112 (C6b) — pinned rows lift to the top of the display order without
  // rewriting the persisted list (the persisted order is unchanged). Every
  // history record is kept.
  const recentDisplays = useMemo(() => {
    const rows = allRecents.map((entry) => ({ entry, meta: splitRecentPath(entry.path) }));
    const pinned = rows.filter((row) => row.entry.pinned === true);
    const rest = rows.filter((row) => row.entry.pinned !== true);
    return [...pinned, ...rest];
  }, [allRecents]);
  // Phase 112 (C6b) — the missing-file paths handed to the Home rows.
  const missingRecentList = useMemo(() => [...missingRecents], [missingRecents]);
  // Phase 112 follow-up (TFL-1006) — proactively seed the missing set at mount
  // and whenever the recent list changes, so a row whose file vanished renders
  // its Missing / Locate state on the first paint of Home (no click, no open).
  // Keyed on the joined path signature (never on `missingRecents`) so the effect
  // cannot re-trigger itself; it only UNIONS, the existing removal paths clear.
  const recentPathsKey = useMemo(
    () => allRecents.map((r) => r.path).join("\n"),
    [allRecents],
  );
  useEffect((): (() => void) | undefined => {
    if (typeof window.tflex.checkMissing !== "function") return undefined;
    const paths = allRecents.map((r) => r.path).filter((p) => p.length > 0);
    if (paths.length === 0) return undefined;
    let cancelled = false;
    void window.tflex.checkMissing(paths).then((missing) => {
      if (cancelled || missing.length === 0) return;
      setMissingRecents((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const p of missing) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [recentPathsKey]);

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
    () =>
      tabs.tabs.map((meta) => ({
        id: meta.id,
        title: meta.title,
        modified: meta.modified,
        // Phase 105 (chunk B) — the stable per-session identity travels with
        // the tab through every reorder; it is never re-derived from index.
        colorId: meta.colorId,
        // Phase 105 (chunk D) — the full path feeds the All-tabs switcher's
        // duplicate-name context (never painted across the rail).
        filePath: meta.filePath,
      })),
    [tabs.tabs],
  );

  // Phase 34 (chunk 2) — while Multi Mode is on the strip shows ONE tab for
  // the combined workspace (the operator's rule), not one per pane document.
  // This is a PRESENTATION projection over the unchanged two-session model:
  // the pane documents resolve through the same `meta` shape the individual
  // tabs used, the label joins both names, and `modified` is true when
  // EITHER document is dirty. Single mode (and the mode-off restore) keep
  // `headerTabs` untouched, so the focused pane's document is active again.
  const multiHeaderDocRefs = useMemo(
    () =>
      compositeDocRefs(multiMode.paneA, multiMode.paneB, (id) => {
        const meta = tabs.tabs.find((t) => t.id === id);
        return meta === undefined
          ? null
          : { id: meta.id, title: meta.title, modified: meta.modified };
      }),
    [multiMode.paneA, multiMode.paneB, tabs.tabs],
  );
  const stripTabs = useMemo(
    () => (multiMode.enabled ? [compositeHeaderTab(multiHeaderDocRefs)] : headerTabs),
    [multiMode.enabled, multiHeaderDocRefs, headerTabs],
  );
  // The single composite tab is the only visible tab, so it must read as
  // active; single mode keeps the tab-store active id.
  const stripActiveId = multiMode.enabled ? COMPOSITE_TAB_ID : tabs.activeId;

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
          // Phase 36 (chunk 5) — the label follows the route: the All-tools
          // panel is retired and this row opens the Command Palette. The
          // action id stays `showToolsPalette` so the main-process menu IPC
          // (src/main/menu.ts, which still sends 'showToolsPalette' and whose
          // own label needs the same update) keeps dispatching.
          { id: "tools", label: "Command Palette...", accelerator: "Ctrl+Shift+P", action: "showToolsPalette" },
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
          { id: "about", label: "About Jovrel", action: "about" },
        ],
      },
    ],
    [],
  );

  // Phase 105 (chunk C) — the File trigger and the application menu consume
  // DISJOINT slices of the same audited group list. The File popover keeps the
  // File group only; the application menu takes Edit / View / Tools / Help.
  // No group, row, label or action id is added, removed or renamed.
  const fileMenuGroups = useMemo<MenuGroup[]>(
    () => menuGroups.filter((g) => g.id === "file"),
    [menuGroups],
  );
  const appMenuGroups = useMemo<MenuGroup[]>(
    () => menuGroups.filter((g) => g.id !== "file"),
    [menuGroups],
  );

  /** True when the active tab is an empty placeholder (no document).
   *  The renderer mounts the Welcome screen instead of a DocumentView
   *  so the user has somewhere to drop a PDF. */
  const activeIsEmpty = tabs.activeId !== null
    && tabs.tabs.find((t) => t.id === tabs.activeId)?.kind === 'empty';

  const activeTab = tabs.activeId !== null ? openTabs[tabs.activeId] : null;
  const activeEngineUi = tabs.activeId !== null ? engineUi[tabs.activeId] : null;

  // Phase 57 (feature A) — fetch the active document's engineering surfaces
  // (layers, PDF/E metadata, 3D content) whenever the active engine doc id
  // changes. A document without layers / CAD / 3D resolves to empty results,
  // never an error; a pre-Phase-57 build's missing methods are skipped.
  const activeEngineDocId = activeTab?.session.engineDocId ?? null;
  useEffect(() => {
    if (activeEngineDocId === null) return;
    const client = engineRef.current;
    let cancelled = false;
    const load = async (): Promise<void> => {
      // Receiver calls only — a detached binding loses `this` on the real
      // adapter whose methods read `this.inner` (DEF-106 / DEF-374 class).
      const [layerRes, cadRes, threeRes] = await Promise.all([
        client.getLayers === undefined ? Promise.resolve(null) : client.getLayers(activeEngineDocId),
        client.getCadMetadata === undefined ? Promise.resolve(null) : client.getCadMetadata(activeEngineDocId),
        client.get3dContent === undefined ? Promise.resolve(null) : client.get3dContent(activeEngineDocId),
      ]);
      if (cancelled) return;
      if (layerRes !== null && layerRes.ok) {
        setLayersByDoc((prev) => ({ ...prev, [activeEngineDocId]: layerRes.value }));
      }
      if (cadRes !== null && cadRes.ok) {
        setCadByDoc((prev) => ({ ...prev, [activeEngineDocId]: cadRes.value }));
      }
      if (threeRes !== null && threeRes.ok) {
        setContent3dByDoc((prev) => ({ ...prev, [activeEngineDocId]: threeRes.value }));
      }
    };
    void load();
    // Phase 90 (TFL-509-C1) — keep the unified review list's Bates / Watermark
    // categories in step with a newly active document (the annotations mirror
    // refreshes through the same active-doc change).
    void refreshWatermarkList();
    void refreshBatesList();
    return (): void => {
      cancelled = true;
    };
  }, [activeEngineDocId, refreshWatermarkList, refreshBatesList]);

  // Phase 111 (chunk D2a) — on a document change, first record the OUTGOING
  // document's current rail view (a tab set outside `selectRailTab`, e.g. by a
  // restore, is still captured), then restore the INCOMING document's view,
  // defaulting to 'thumbs' for a document never seen. The refs make this run
  // only on the id change, never on a tab click.
  useEffect(() => {
    const prev = prevEngineDocIdRef.current;
    if (prev === activeEngineDocId) return;
    if (prev !== null) {
      setRailTabByDoc((prevMap) => recordRailTab(prevMap, prev, railTabRef.current));
    }
    setRailTab(restoreRailTab(railTabByDocRef.current, activeEngineDocId));
    prevEngineDocIdRef.current = activeEngineDocId;
  }, [activeEngineDocId]);

  // Phase 111 (chunk D2a) — the ONE rail-view setter. Every entry point (the
  // Pages panel's own toggle and the palette's "Page thumbnails" / "Bookmarks"
  // rows) writes both the live value and this document's remembered value.
  const selectRailTab = useCallback(
    (tab: RailTab): void => {
      setRailTab(tab);
      setRailTabByDoc((prevMap) => recordRailTab(prevMap, activeEngineDocId, tab));
    },
    [activeEngineDocId],
  );

  // Phase 36 (chunk 5) — the Inspector's visibility: a real document is open
  // (an empty placeholder tab or the welcome screen has none to inspect). The
  // panel-inset machinery below and the .app-main data attribute both read
  // this one flag, so the panel and the page inset can never disagree.
  const inspectorOpen = tabs.activeId !== null && !activeIsEmpty;
  // Phase 37 (items 2 + 6) — the Inspector is MOUNTED whenever a document is
  // open (so the next chunk's collapse control has a home), but its EFFECTIVE
  // visibility also honours the ladder's rung 1. The inset machinery and the
  // .app-main data attributes read this ONE derived flag.
  const inspectorVisible = inspectorOpen && !inspectorCollapsedEffective;

  // Phase 112 (TFL-854, chunk H) — the ONE panel composition. The rail's
  // effective collapse folds in the ladder rung + book view (the same condition
  // the .app-main attribute uses); the inspector's folds in the ladder rung +
  // book view. The widths resolve from the persisted preferences, clamped so a
  // usable document column always remains. These values drive `--tf-rail-w` /
  // `--tools-panel-w` / `--tf-tools-inset` inline on .app-main, and the SAME
  // `toolsInsetPx` feeds the panes' geometry target, so the CSS, the dock and
  // the zoom math can never disagree.
  const railCollapsedEffective = pagesPanelCollapsedEffective || bookViewActive;
  const panelComposition = resolvePanelComposition({
    viewportWidth,
    railWidthPx: panelLeftWidth,
    railCollapsed: railCollapsedEffective,
    toolsWidthPx: panelRightWidth,
    toolsCollapsed: inspectorCollapsedForBookView,
    inspectorOpen,
  });
  const railWidthPx = panelComposition.railPx;
  const toolsWidthPx = panelComposition.toolsPx;
  const toolsInsetPx = panelComposition.toolsInsetPx;
  const appMainPanelStyle: CSSProperties = {
    "--tf-rail-w": `${railWidthPx}px`,
    "--tf-tools-inset": `${toolsInsetPx}px`,
    ...(inspectorOpen ? { "--tools-panel-w": `${toolsWidthPx}px` } : {}),
  } as CSSProperties;

  const onPanelLeftResize = useCallback((next: number): void => {
    setPanelLeftWidth(clampPanelWidth("left", next));
  }, []);
  const onPanelRightResize = useCallback((next: number): void => {
    setPanelRightWidth(clampPanelWidth("right", next));
  }, []);
  const commitPanelLeftWidth = useCallback(
    (next: number): void => {
      const clamped = clampPanelWidth("left", next);
      setPanelLeftWidth(clamped);
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated: AppSettings = { ...prev, panelLeftWidthPx: clamped };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );
  const commitPanelRightWidth = useCallback(
    (next: number): void => {
      const clamped = clampPanelWidth("right", next);
      setPanelRightWidth(clamped);
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated: AppSettings = { ...prev, panelRightWidthPx: clamped };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  // Phase 111 (chunk D1) — the Split Navigator commits. The layout writes only
  // on a layout-menu selection; the ratio writes only on a divider gesture
  // settle or a keyboard step (never per drag frame).
  const commitNavigatorLayout = useCallback(
    (layout: 'stacked' | 'split'): void => {
      setNavigatorLayout(layout);
      setSettings((prev) => {
        if (prev === null || prev.navigatorLayout === layout) return prev;
        const updated: AppSettings = { ...prev, navigatorLayout: layout };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );
  const commitNavigatorSplitRatio = useCallback(
    (next: number): void => {
      const clamped = clampSplitRatio(next);
      setNavigatorSplitRatio(clamped);
      setSettings((prev) => {
        if (prev === null || prev.navigatorSplitRatio === clamped) return prev;
        const updated: AppSettings = { ...prev, navigatorSplitRatio: clamped };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave],
  );

  // ---- Phase 32 — Multi Mode ----------------------------------------
  // The mode is a VIEW over the tab store: a pane holds a tab id and the
  // stage renders that tab's existing DocumentView. App owns the state;
  // the CommandBar control and the All-tools entry both read it, so the
  // two entry points can never disagree.

  /** The tabs that can fill a pane: real documents with a name/page count. */
  const stageTabs = useMemo<StageTab[]>(
    () =>
      tabs.tabs.flatMap((meta) => {
        const open = openTabs[meta.id];
        if (open === undefined) return [];
        return [
          {
            id: meta.id,
            title: open.displayName,
            pageCount:
              engineUi[meta.id]?.state.pageCount ?? open.session.doc.numPages,
          },
        ];
      }),
    [tabs.tabs, openTabs, engineUi],
  );

  /** Leave the Multi Mode workspace and guarantee a real active tab when
   *  the active id was cleared (an empty focused pane). Single mode renders
   *  no visible pane when the active id is null, so restore a real document
   *  — pane A's, else the first tab — or fall through to the welcome screen
   *  when no tabs remain. Shared by the toolbar toggle and the composite
   *  tab's close so the leave path is one piece of logic. */
  const leaveMultiMode = useCallback((): void => {
    const fallback = multiMode.paneA ?? multiMode.paneB;
    dispatchMultiMode({ type: "disable" });
    if (tabs.activeId === null) {
      const restore =
        fallback !== null && tabs.tabs.some((t) => t.id === fallback)
          ? fallback
          : tabs.tabs[0]?.id ?? null;
      if (restore !== null) activateTab(restore);
    }
  }, [multiMode, tabs.activeId, tabs.tabs, activateTab]);

  /** Toggle the mode. Enabling seeds pane A from the tab that is active
   *  now; disabling returns to the single-pane layout and touches no tab. */
  const onMultiModeToggle = useCallback((): void => {
    if (multiMode.enabled) {
      leaveMultiMode();
      return;
    }
    const activeId = tabs.activeId;
    if (activeId === null) {
      pushToast("error", "Open a document before turning on Multi Mode.");
      return;
    }
    dispatchMultiMode({ type: "enable", activeTabId: activeId });
  }, [multiMode, leaveMultiMode, tabs.activeId, pushToast]);

  /** Focus a pane. The focused pane drives the app's effective active tab,
   *  so every existing document-scoped operation path (which reads the
   *  active tab id) targets this pane with no handler changes. An empty
   *  pane has no document: the active tab is cleared so an operation is a
   *  clean no-op rather than hitting the previously active tab. */
  const onFocusPane = useCallback(
    (pane: PaneId): void => {
      if (!multiMode.enabled) return;
      const decision = resolvePaneFocus(multiMode, pane);
      dispatchMultiMode({ type: "focus", pane: decision.focus });
      if (decision.activate !== null) {
        if (decision.activate !== tabs.activeId) activateTab(decision.activate);
      } else if (
        tabs.activeId !== null &&
        shouldClearActiveOnEmptyFocus(multiMode, pane)
      ) {
        // Phase 39 (item 2) — only clear the active document when the
        // workspace has NO document left. If the other pane still holds one,
        // keeping it active holds the Inspector's inset (and the divider)
        // stable when a document is subsequently opened into this pane.
        dispatchTabs({ type: "deactivate" });
      }
    },
    [multiMode, tabs.activeId, activateTab],
  );

  /** The `filePath` a tab id maps to, or null when the tab is unknown. The
   *  DEF-278 path guard needs the OTHER pane's document path; the mode
   *  state knows only tab ids, so the caller resolves it here. */
  const tabFilePath = useCallback(
    (tabId: string): string | null =>
      tabs.tabs.find((t) => t.id === tabId)?.filePath ?? null,
    [tabs.tabs],
  );

  /** Put a document in a pane. BOTH identity rules are enforced: the other
   *  pane's TAB (`paneAssignError`) and the other pane's FILE PATH
   *  (`paneAssignPathError`, DEF-278) — opening one file twice mints two
   *  tab ids, so the tab rule alone cannot see "the same file is already
   *  there". Either conflict is REFUSED with a user-visible message (never
   *  a silent no-op); the reducer applies the tab rule as the last line of
   *  defence. The assignment focuses the pane and makes its document the
   *  active tab (same invariant as a focus move). */
  const assignPaneDocument = useCallback(
    (pane: PaneId, tabId: string): void => {
      const error =
        paneAssignError(multiMode, pane, tabId) ??
        paneAssignPathError(multiMode, pane, tabFilePath(tabId), tabFilePath);
      if (error !== null) {
        pushToast("error", error);
        return;
      }
      dispatchMultiMode({ type: "assign", pane, tabId });
      dispatchMultiMode({ type: "focus", pane });
      if (tabs.activeId !== tabId) activateTab(tabId);
    },
    [multiMode, tabs.activeId, activateTab, pushToast, tabFilePath],
  );

  /** DEF-278 — refuse an OPEN whose file is already the other pane's
   *  document, before a tab is created for it (a document must never end
   *  up as a hidden tab with no visible effect). The comparison is
   *  `TabMeta.filePath` equality — the user's intent is "that file is
   *  already in the other pane"; the message matches the assign guard. */
  const refuseOpenIntoPane = useCallback(
    (pane: PaneId, filePath: string | null): boolean => {
      const error = paneAssignPathError(multiMode, pane, filePath, tabFilePath);
      if (error === null) return false;
      pushToast("error", error);
      return true;
    },
    [multiMode, tabFilePath, pushToast],
  );

  /** DEF-277 — after a generic open, Multi Mode puts the new document in
   *  the FOCUSED pane (so it is immediately visible and replaces that
   *  pane's document; the previous document stays open as a tab), through
   *  the SAME assign+focus+activate path the tab strip uses. Single mode
   *  is untouched: the open's own activation already stands. */
  const showOpenedTab = useCallback(
    (tabId: string): void => {
      if (!multiMode.enabled) return;
      assignPaneDocument(multiMode.focused, tabId);
    },
    [multiMode, assignPaneDocument],
  );

  // Fill the forward-declared ref the early open handlers read. Re-assigned
  // every render so `refuseFocused` sees the CURRENT focused pane.
  routeOpenedTabRef.current = {
    refuseFocused: (filePath: string | null): boolean =>
      refuseOpenIntoPane(multiMode.focused, filePath),
    show: showOpenedTab,
  };

  const onPickPane = useCallback(
    (pane: PaneId, tabId: string): void => {
      assignPaneDocument(pane, tabId);
    },
    [assignPaneDocument],
  );

  /** Clear a pane's document. When the cleared document was the app's
   *  active tab the active id is cleared with it, so the empty pane cannot
   *  leave a document-scoped operation pointing at the closed pane. */
  const onClearPane = useCallback(
    (pane: PaneId): void => {
      const nextActive = resolvePaneClear(multiMode, pane, tabs.activeId);
      dispatchMultiMode({ type: "clear", pane });
      if (nextActive === null && tabs.activeId !== null) {
        dispatchTabs({ type: "deactivate" });
      }
    },
    [multiMode, tabs.activeId],
  );

  /** The tab strip's activation in Multi Mode:
   *  1. a tab that IS in a pane focuses that pane;
   *  2. a tab that is NOT in a pane is assigned to the focused pane
   *     (replacing its document) — and a tab that is the other pane's
   *     document focuses that pane instead (rule 1).
   *  Single mode is the untouched `activateTab`. */
  const onTabStripActivate = useCallback(
    (id: string): void => {
      // Phase 34 (chunk 2) — while the single composite tab is shown the
      // Phase-32 strip rules have no target (there is one tab, not the
      // per-document entries), so a click is a no-op beyond the focus the
      // pane itself already holds. The rules apply again the moment the
      // mode is off and `headerTabs` restores the individual tabs.
      if (multiMode.enabled) return;
      const decision = resolveTabStripActivation(multiMode, id);
      if (decision.assign !== null) {
        assignPaneDocument(decision.assign, id);
        return;
      }
      if (decision.focus !== null) {
        dispatchMultiMode({ type: "focus", pane: decision.focus });
      }
      activateTab(decision.activate);
    },
    [multiMode, assignPaneDocument, activateTab],
  );

  /** Phase 34 (chunk 2) — close the ONE composite tab: run the existing
   *  per-document modified prompt for EACH dirty pane document (Cancel
   *  aborts the whole close), then close BOTH and leave Multi Mode so the
   *  app returns to the remaining tab or the welcome screen. */
  const onCloseCompositeTab = useCallback((): void => {
    const ids = compositeDocIds(multiMode.paneA, multiMode.paneB);
    if (ids.length === 0) {
      // DEF-289 — with no document in either pane there is nothing to close
      // or prompt for, but the close control must still ACT: leave the
      // Multi Mode workspace and return to the remaining tabs (or the
      // welcome screen when none remain) with a real active tab, exactly
      // like the toolbar toggle. A rendered close that silently no-ops is
      // a fail-loud defect (AGENTS.md).
      leaveMultiMode();
      return;
    }
    // Reuse the EXACT modified selection the window-close gate uses
    // (`meta.modified` OR the engineUi mirror) so a dirty document cannot
    // slip through the batched-dispatch window.
    const modified = collectModifiedTabIds(
      ids.map((id) => ({
        id,
        modified: tabsRef.current.tabs.find((t) => t.id === id)?.modified === true,
      })),
      engineUiRef.current,
    );
    const plan = planCompositeClose(multiMode.paneA, multiMode.paneB, modified);
    if (plan.promptIds.length === 0) {
      for (const closeId of plan.ids) performCloseTab(closeId);
      dispatchMultiMode({ type: "disable" });
      return;
    }
    compositeCloseIdsRef.current = plan.ids;
    compositeCloseQueueRef.current = [...plan.promptIds];
    setPendingCloseTabId(plan.promptIds[0] ?? null);
    setPendingCloseError(null);
    setPendingCloseSaving(false);
  }, [multiMode, performCloseTab, leaveMultiMode]);

  /** The header's close handler: the composite tab owns the workspace close
   *  flow; every real tab keeps the unchanged `closeTab`. */
  const onHeaderClose = useCallback(
    (id: string): void => {
      if (id === COMPOSITE_TAB_ID) {
        onCloseCompositeTab();
        return;
      }
      closeTab(id);
    },
    [onCloseCompositeTab, closeTab],
  );

  /** The empty pane's Open action: pick a file, then put it in that pane.
   *  DEF-278 — the same-file guard runs on this path too, BEFORE the open,
   *  so picking the other pane's document is refused with a message and
   *  creates no stray tab. */
  const onOpenIntoPane = useCallback(
    (pane: PaneId): void => {
      void (async (): Promise<void> => {
        // DEF-375 — this feeds the generic open path (`openPdfFromPath`
        // -> `routeOpenPath`), so it gets the grouped document filters.
        const picked = await window.tflex.openFileDialog("document");
        if (picked === null) return;
        if (refuseOpenIntoPane(pane, picked)) return;
        const tabId = await openPdfFromPath(picked);
        if (tabId !== null) assignPaneDocument(pane, tabId);
      })();
    },
    [openPdfFromPath, assignPaneDocument, refuseOpenIntoPane],
  );

  // ---- Phase 33: Multi Mode's per-pane thumbnail strips -----------------
  //
  // The phase-32 shared rail is retired: each pane's DocumentView renders
  // its OWN strip at that pane's inner edge (`multiRail` + `railSide`), so
  // pane A's strip sits to the RIGHT of A's pages and pane B's to the LEFT
  // of B's, meeting side by side in the middle. A thumbnail click navigates
  // its own pane through the view's own `jumpToPage`; the cross-document
  // drag seam is the SAME `onPageDrop` App already owns. The only rail
  // state App still holds is the reveal jump a completed page drop issues
  // (see `onPageDrop` -> `reveal`).

  // How many documents are loaded across the strips (1 or 2): the strips
  // share the middle region, so each keeps the Phase-32 area-preserving
  // thumb width for that count.
  const loadedDocumentCount = multiMode.enabled
    ? (multiMode.paneA !== null ? 1 : 0) + (multiMode.paneB !== null ? 1 : 0)
    : 0;

  // ---- Phase 33 (chunk 4): ONE shared toolbar in Multi Mode --------------
  //
  // App owns the bridge that lets the single stage-level toolbar drive both
  // panes. Each pane's DocumentView publishes its toolbar model and its
  // annotation-tool reducer to this controller; the shared bar reads the
  // FOCUSED pane's model (page / zoom / search / hand) and fans every
  // annotation action out to BOTH panes' reducers, so a tool armed in the
  // bar applies to whichever pane the user then works in. Single mode hands
  // `null`, so nothing about its internals changes.
  const sharedToolController = useMemo(() => new SharedToolController(), []);
  useEffect((): void => {
    if (!multiMode.enabled) sharedToolController.reset();
  }, [multiMode.enabled, sharedToolController]);

  const sharedToolsCache = useRef(
    new Map<PaneId, { pane: PaneId; controller: SharedToolController }>(),
  );
  const sharedToolsFor = useCallback(
    (pane: PaneId): { pane: PaneId; controller: SharedToolController } => {
      const cached = sharedToolsCache.current.get(pane);
      if (cached !== undefined) return cached;
      const entry = { pane, controller: sharedToolController };
      sharedToolsCache.current.set(pane, entry);
      return entry;
    },
    [sharedToolController],
  );

  // Phase 36 (chunk 7) — the workspace's ONE Action Dock is the surface that
  // picks an EDIT tool now. Its EDIT verbs route to the FOCUSED pane's own
  // edit model (each pane keeps its own stage and its own tools), so the
  // retired shared bar's both-panes broadcast is gone with it.

  // The rail's jump request. `seq` is what makes two clicks on the same
  // page both land (DocumentView's external-jump effect ignores a repeat).
  const railJumpSeqRef = useRef(0);
  const [railJump, setRailJump] = useState<{ tabId: string; page: number; seq: number } | null>(
    null,
  );

  // Phase 32 (chunk 2d) — apply a resolved cross-document (or same-document)
  // page drop. Both drag paths (rail and canvas) funnel here through the
  // shared drag model: one engine call, BOTH echoed states recorded, BOTH
  // pdf.js proxies refreshed through the existing render-to-refresh hook, and
  // the target pane revealed at the inserted page. A same-document drop takes
  // the EXISTING reorder path and never calls the engine. A failure toasts
  // the typed engine error and leaves both panes untouched.
  const onPageDrop = useCallback(
    (op: PageDropOp): void => {
      const deps: PageDropDeps = {
        engine: {
          movePagesBetweenDocs: (fromDocId, pages, toDocId, atIndex, mode) =>
            engineRef.current.movePagesBetweenDocs(fromDocId, pages, toDocId, atIndex, mode),
        },
        docIdFor: (tabId) => openTabsRef.current[tabId]?.session.engineDocId ?? null,
        onReorder: (tabId, fromIndex, toIndex) => onReorder(tabId, fromIndex, toIndex),
        onStates: (fromTabId, toTabId, from, to, mode) => {
          // A move changed BOTH documents (both grew an undo entry); a copy
          // left the source untouched, so only the target is noted.
          if (mode === "move") noteOpApplied(fromTabId, from);
          noteOpApplied(toTabId, to);
        },
        refresh: (tabId) => {
          const fn = refreshDocProxyForRef.current;
          if (fn !== null) void fn(tabId).catch(() => undefined);
        },
        reveal: (tabId, page) => {
          railJumpSeqRef.current += 1;
          setRailJump({ tabId, page, seq: railJumpSeqRef.current });
        },
        toast: (error) => pushToast("error", describeEngineError(error.code, error.message)),
      };
      void applyPageDrop(op, deps);
    },
    [noteOpApplied, onReorder, pushToast],
  );

  // A closed tab must never leave a stale pane: reconcile the pane slots
  // against the live tab ids whenever the tab list changes.
  const liveTabIds = useMemo(() => tabs.tabs.map((t) => t.id), [tabs.tabs]);
  useEffect(() => {
    dispatchMultiMode({ type: "reconcile", tabIds: liveTabIds });
  }, [liveTabIds]);

  // ---- Phase 22 — the title bar's relocated File actions (Open / Save /
  // Save As moved out of the CommandBar). The caption strip is a single
  // strip, not per-tab, so it reads the ACTIVE tab only. The semantics
  // are carried over verbatim from the CommandBar props the DocumentView
  // used to receive: `saveModified` = the tab reducer's flag OR the
  // engine mirror's flag (DEF-042), `saveInPlaceEnabled` = the source
  // has an on-disk path (samples are Save-As only). The handlers gate on
  // the live active id exactly like the menu context does, so a click on
  // the welcome screen is a clean no-op.
  const activeTabMeta = tabs.activeId !== null
    ? tabs.tabs.find((t) => t.id === tabs.activeId) ?? null
    : null;
  const activeSaveModified =
    activeTabMeta?.modified === true || activeEngineUi?.state.modified === true;
  const activeSaveInPlaceEnabled =
    activeTab !== null && activeTab !== undefined && activeTab.session.onDiskPath !== null;
  const onHeaderSave = useCallback((): void => {
    const activeId = tabs.activeId;
    if (activeId !== null) void onSave(activeId);
  }, [tabs.activeId, onSave]);
  const onHeaderSaveAs = useCallback((): void => {
    const activeId = tabs.activeId;
    if (activeId !== null) void onSaveAs(activeId);
  }, [tabs.activeId, onSaveAs]);

  // Phase 36 (chunk 1b) — the Stage Rail's scope. Multi Mode renders ONE
  // rail for the workspace, so while the mode is on the rail reads and
  // writes the FOCUSED pane's stage (each pane owns its stage); single mode
  // drives the one active stage.
  const stagePane: PaneId | null = multiMode.enabled ? multiMode.focused : null;
  const activeStage: Stage = stageForPane(stageState, stagePane);
  // Phase 39 (DEF-348a) — the shared Action Dock is WORKSPACE-level: when the
  // focused pane is EMPTY it reads the pane that actually owns a document, so
  // it stays present and functional. `resolveDockPane` is the pure rule; the
  // dock's stage follows the same pane.
  const dockPane: PaneId | null = multiMode.enabled
    ? resolveDockPane(multiMode, multiMode.focused)
    : null;
  const dockStage: Stage = stageForPane(stageState, dockPane);
  // DEF-358 — the shared dock's pressed verb follows the DOCK pane's own edit
  // tool (text/box/image/off). The retired `editMode` verb never matched a
  // rendered verb, so an armed edit tool used to look unarmed in Multi Mode too.
  const dockTabId: string | null =
    dockPane === null ? null : dockPane === "A" ? multiMode.paneA : multiMode.paneB;
  const dockEditTool =
    editModeOpen && dockTabId !== null ? openTabs[dockTabId]?.edit.tool ?? null : null;
  const dockActiveToolIds: string[] =
    dockEditTool === null ? [] : [editDockVerbFor(dockEditTool)];
  const onStageChange = useCallback(
    (stage: Stage): void => {
      dispatchStage({ type: "set", pane: stagePane, stage });
    },
    [stagePane],
  );

  // Phase 37 (item 13) — the stage IS the Edit-mode switch. Entering the
  // EDIT stage turns the canvas's edit mode on and every other stage turns
  // it off; the `editMode` dock verb is retired. ONE effect keyed on the
  // active stage AND the active document identity, so there is no second
  // source of truth for edit mode.
  //
  // DEF-342 — the effect must re-apply when the stage becomes APPLICABLE
  // again, not only when the stage value changes. Closing the only tab
  // clears edit mode App-side while the rail keeps showing EDIT, so
  // re-opening a document (docId null -> a tab id) has to re-apply EDIT's
  // side effects even though the stage value never changed. The decision is
  // the pure `stageEffectsNeedApply`, so the rule is unit-testable.
  const prevStageApplyRef = useRef<{ stage: Stage; docId: string | null }>({
    stage: activeStage,
    docId: tabs.activeId,
  });
  useEffect((): void => {
    const docId = tabs.activeId;
    const prev = prevStageApplyRef.current;
    prevStageApplyRef.current = { stage: activeStage, docId };
    const needApply = stageEffectsNeedApply({
      prevStage: prev.stage,
      prevDocId: prev.docId,
      stage: activeStage,
      docId,
    });
    if (!needApply) return;
    setEditMode(editModeForStage(activeStage));
  }, [activeStage, tabs.activeId, setEditMode]);

  // Phase 36 (chunk 6) — the Inspector's LIVE selection.
  //
  //   - The TEXT-OBJECT selection is the active DocumentView's published
  //     snapshot (`inspectorTextSelection`, single mode only).
  //   - The SIGNATURE selection is the host's own armed-signature state.
  //   - Everything else falls back to the active page.
  //
  // ONE source per selection kind — the Inspector never keeps its own copy.
  // The mapping is the pure `inspectorSelectionFor` / `inspectorTextPanelFor`
  // helpers so the wiring is unit-testable without mounting App.
  const armedSignature =
    armedSignatureId === null
      ? null
      : savedSignatures.find((s) => s.id === armedSignatureId) ?? null;
  // Phase 112 (TFL-854 C2) — each mounted DocumentView reports its thumbnail
  // multi-select; the host reads the FOCUSED pane's set for the right
  // Inspector's scope header and Mixed values. Keyed by pane ("single" in
  // single mode), the same shape as the view-command / dock-availability maps.
  const [pageSelections, setPageSelections] = useState<Record<string, number[]>>({});
  const reportPageSelectionFor = useCallback(
    (pane: PaneId | null, pages: readonly number[]): void => {
      const key = pane ?? "single";
      setPageSelections((prev) => {
        const existing = prev[key];
        if (existing !== undefined && samePageSelection(existing, pages)) return prev;
        return { ...prev, [key]: [...pages] };
      });
    },
    [],
  );

  // Phase 112 (TFL-854 C2 follow-up) — each mounted DocumentView publishes the
  // page sizes it has ALREADY measured for its mounted PageViews (its
  // `onPageSize` map). The host reads the FOCUSED pane's map first so a
  // normally-opened document shows real dimensions WITHOUT opening the Crop
  // dialog (which is what seeds `activePageSizes`). Keyed by pane, mirroring
  // `pageSelections`. Nothing extra is measured here: no getPage sweep on open.
  const [livePageSizes, setLivePageSizes] = useState<
    Record<string, ReadonlyMap<number, { w: number; h: number }>>
  >({});
  const reportPageSizesFor = useCallback(
    (pane: PaneId | null, sizes: ReadonlyMap<number, { w: number; h: number }>): void => {
      const key = pane ?? "single";
      setLivePageSizes((prev) => (prev[key] === sizes ? prev : { ...prev, [key]: sizes }));
    },
    [],
  );
  const livePageSizesForScope = livePageSizes[stagePane ?? "single"];
  const activePageSelection: number[] = useMemo(() => {
    if (multiMode.enabled) return pageSelections[multiMode.focused] ?? [];
    return pageSelections["single"] ?? [];
  }, [pageSelections, multiMode.enabled, multiMode.focused]);

  // Phase 112 (TFL-854 C2) — the PAGES inspector's REAL page meta. The label
  // comes from the engine's sparse label map; the size from the seeded page
  // sizes (the SAME doc.getPage viewport the Crop dialog reads). Unknown stays
  // unknown ("Not available"), never a guessed A4 or a zero.
  const inspectorPageNumber = Math.max(1, Math.floor(activeTab?.persisted.currentPage ?? 1));
  const inspectorPageLabel = resolvePageLabel(
    inspectorPageNumber,
    activeEngineUi?.state.pageLabels,
  );
  const inspectorPageSize = resolveInspectorPageSize(
    inspectorPageNumber,
    livePageSizesForScope,
    activePageSizes,
  );
  const inspectorPageMetaMixed = useMemo(() => {
    const pages = activePageSelection;
    if (pages.length <= 1) return { size: false, rotation: false, label: false };
    const rotations = activeEngineUi?.state.rotations ?? [];
    const labels = activeEngineUi?.state.pageLabels;
    const rotationSet = new Set<number | null>(pages.map((p) => rotations[p - 1] ?? null));
    const labelSet = new Set<string>(pages.map((p) => resolvePageLabel(p, labels) ?? ""));
    const sizeKeys = pages.map((p) => {
      const s = resolveInspectorPageSize(p, livePageSizesForScope, activePageSizes);
      return s === null ? null : `${s.widthPt}x${s.heightPt}`;
    });
    const sizeMixed = sizeKeys.every((k) => k !== null) && new Set(sizeKeys).size > 1;
    return { size: sizeMixed, rotation: rotationSet.size > 1, label: labelSet.size > 1 };
  }, [activePageSelection, activeEngineUi, activePageSizes, livePageSizesForScope]);

  const inspectorSelection = inspectorSelectionFor({
    stage: activeStage,
    text: inspectorTextSelection,
    signatureLabel: armedSignature === null ? null : armedSignature.label,
    page: Math.max(1, Math.floor(activeTab?.persisted.currentPage ?? 1)),
  });
  const inspectorTextPanel = inspectorTextPanelForSelection(
    inspectorSelection,
    inspectorTextSelection,
  );
  // Multi Mode's shared Inspector follows the FOCUSED pane (Phase 36 chunk 7):
  // entering the mode withdraws a single-mode selection, and a focus switch
  // withdraws the previous pane's, so the panel never shows a background
  // pane's object. The newly focused pane re-publishes on its next change.
  useEffect((): void => {
    if (multiMode.enabled) setInspectorTextSelection(null);
  }, [multiMode.enabled, multiMode.focused]);

  // ---- Phase 36 (chunk 3a): the Action Dock's host wiring -----------------
  //
  // The dock renders every verb of the active stage from the registry. This
  // view cannot run the APP-level verbs (dialogs, OCR, export, sign, forms),
  // so it supplies them here as a map keyed by the registry's `action` — the
  // dock's DocumentView runs the view-level verbs itself and defers the rest.
  // Nothing is reimplemented: each entry calls the SAME handler the command
  // toolbar / palette already uses. A registry entry with no handler ANYWHERE
  // is disabled by the availability gate below (never a silent no-op).
  const openReadingView = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setReadingView({ mode: "epub" });
  }, []);
  const openComicView = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setReadingView({ mode: "comic" });
  }, []);
  // Phase 66 (chunk 1) — the canvas Book View verb. It closes over no render
  // state (only the stable setter and the active-tab ref), so the DocumentView
  // prop identity never churns.
  const openBookView = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setBookViewTabId(activeTabIdRefLocal.current);
  }, []);
  const closeBookView = useCallback((): void => {
    setBookViewTabId(null);
  }, []);

  const dockAppActions = useMemo<Record<string, () => void>>(
    () => ({
      merge: onMergeClick,
      split: onSplitClick,
      extract: (): void => setSplitOpen(true),
      deletePages: (): void => onDeletePageClick(),
      insertPages: onInsertPagesClick,
      replacePages: onReplacePagesClick,
      renumberPages: onRenumberPagesClick,
      cropPages: onCropPagesClick,
      sign: (): void => {
        if (armedSignatureId !== null) {
          setArmedSignatureId(null);
          return;
        }
        if (editModeOpenRef.current) setEditMode(false);
        setSigModalOpen(true);
      },
      forms: (): void => setFlattenOpen(true),
      flatten: (): void => setFlattenOpen(true),
      stamp: onStampClick,
      redact: (): void => setRedactArmed(true),
      watermark: onWatermarkClick,
      bates: onBatesClick,
      exportComments: onCommentExportClick,
      importComments: onCommentImportClick,
      fillFromCsv: onFillFromCsvClick,
      exportFormData: onExportFormDataClick,
      importFormData: onImportFormDataClick,
      validateDocument: onValidateDocumentClick,
      sanitize: onSanitizeClick,
      engineeringLayers: onEngineeringLayersClick,
      documentInfo: onDocumentInfoClick,
      optimize: onOptimizeClick,
      auditSpace: onAuditClick,
      createFromImages: onCreateClick,
      exportPages: onExportClick,
      exportText: onTextExportClick,
      exportDocx: onDocxExportClick,
      exportXlsx: onXlsxExportClick,
      exportPptx: onPptxExportClick,
      encryptDocument: onEncryptClick,
      // Phase 56 (features A / C) — the two reading-view verbs (global).
      openReadingView,
      openComicView,
      recognizeText: onOcrClick,
      batchOcr: (): void => {
        void onBatchOcr();
      },
      ocrSuspects: (): void => onOpenOcrSuspects(),
      // DEF-327 — the live-GATED global commands (an empty undo stack, Multi
      // Mode off). They are not stage verbs, but they ARE pinnable, so the dock
      // must be able to RUN a pin of them once `appActionGates` opens; the
      // Command Palette reads this same map. One implementation, no no-op pin.
      undo: (): void => {
        const id = activeTabIdRefLocal.current;
        if (id !== null) void onUndo(id);
      },
      redo: (): void => {
        const id = activeTabIdRefLocal.current;
        if (id !== null) void onRedo(id);
      },
      paneOpen: (): void => {
        if (multiMode.enabled) onOpenIntoPane(multiMode.focused);
      },
      paneClear: (): void => {
        if (multiMode.enabled) onClearPane(multiMode.focused);
      },
    }),
    [
      onMergeClick,
      onSplitClick,
      onDeletePageClick,
      onInsertPagesClick,
      onReplacePagesClick,
      onRenumberPagesClick,
      onCropPagesClick,
      armedSignatureId,
      setEditMode,
      onStampClick,
      onWatermarkClick,
      onBatesClick,
      onCommentExportClick,
      onCommentImportClick,
      onFillFromCsvClick,
      onValidateDocumentClick,
      onSanitizeClick,
      onEngineeringLayersClick,
      onDocumentInfoClick,
      onOptimizeClick,
      onAuditClick,
      onCreateClick,
      onExportClick,
      onTextExportClick,
      onDocxExportClick,
      onXlsxExportClick,
      onPptxExportClick,
      onEncryptClick,
      openReadingView,
      openComicView,
      onOcrClick,
      onBatchOcr,
      onOpenOcrSuspects,
      onUndo,
      onRedo,
      multiMode.enabled,
      multiMode.focused,
      onOpenIntoPane,
      onClearPane,
    ],
  );

  // The dock's persisted pins + un-pins, both validated against the registry on
  // read (unknown ids dropped, de-duped, capped). These are the ONLY writers.
  // DEF-353 — resolve them as ONE mutually-exclusive pair so a hostile settings
  // file (an id in both `dockPins` and `dockUnpinned`) can never make the dock
  // and the palette disagree. The un-pin wins; see `sanitizeDockCuration`.
  const dockCuration = useMemo(
    () => sanitizeDockCuration({ pins: settings?.dockPins, unpinned: settings?.dockUnpinned }),
    [settings?.dockPins, settings?.dockUnpinned],
  );
  const dockPins = dockCuration.pins;
  const dockUnpinned = dockCuration.unpinned;
  // Phase 37 (item 21) — the CURRENT stage's default verb ids, used to decide
  // whether a pin RESTORES an un-pinned default tool or records a cross-stage
  // pin (see `pinDockTool`). The focused pane's stage drives the shared dock.
  const dockDefaultIds = useMemo(
    () => dockToolsForStage(activeStage).map((entry) => entry.id),
    [activeStage],
  );

  // Phase 40 (item 6) — the palette's pin toggle reads the SAME dock curation
  // the Action Dock uses: an explicit cross-stage pin OR a focused-stage
  // default the user has not un-pinned. The toggle icon then reflects what the
  // dock is actually showing, and the writers below (`onDockPin` /
  // `onDockUnpin`, Phase 37's `pinDockTool` / `unpinDockTool`) keep both
  // directions coherent and persisted.
  const isPaletteToolPinned = useCallback(
    (id: string): boolean =>
      dockDefaultIds.includes(id) ? !dockUnpinned.includes(id) : dockPins.includes(id),
    [dockDefaultIds, dockPins, dockUnpinned],
  );

  const onDockPin = useCallback(
    (id: string): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const current = sanitizeDockCuration({ pins: prev.dockPins, unpinned: prev.dockUnpinned });
        const next = pinDockTool(current, id, dockDefaultIds);
        const updated: AppSettings = { ...prev, dockPins: next.pins, dockUnpinned: next.unpinned };
        if (
          next.pins.length === current.pins.length &&
          next.unpinned.length === current.unpinned.length
        ) {
          return prev;
        }
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave, dockDefaultIds],
  );

  const onDockUnpin = useCallback(
    (id: string): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const current = sanitizeDockCuration({ pins: prev.dockPins, unpinned: prev.dockUnpinned });
        const next = unpinDockTool(current, id, dockDefaultIds);
        if (
          next.pins.length === current.pins.length &&
          next.unpinned.length === current.unpinned.length
        ) {
          return prev;
        }
        const updated: AppSettings = { ...prev, dockPins: next.pins, dockUnpinned: next.unpinned };
        trackAndSave(updated);
        return updated;
      });
    },
    [trackAndSave, dockDefaultIds],
  );

  // DEF-352 — the palette's pin toggle may only report "dock full" for a
  // cross-stage pin; a restore of a focused-stage default writes no slot.
  const isPaletteStageDefault = useCallback(
    (id: string): boolean => dockDefaultIds.includes(id),
    [dockDefaultIds],
  );

  // The app-level availability gate for the dock. The registry DECLARES the
  // precondition; this reads the live App state for it.
  const dockHasDocument = tabs.activeId !== null && !activeIsEmpty;

  // Phase 54 (features D + E) — `window.tflex.validation` is optional. Its
  // absence disables the validate verb with the registry's declared reason
  // instead of throwing on click.
  const hasValidationBridge = typeof window.tflex.validation?.validate === "function";

  // Phase 55 (feature D) — the office-export bridge members are OPTIONAL.
  // The presence of each format's member is a live gate: its absence disables
  // the verb with its own reason (`officeExportGate`), never a dead click.
  const hasExportXlsxBridge = typeof window.tflex.export?.xlsx === "function";
  const hasExportPptxBridge = typeof window.tflex.export?.pptx === "function";
  const officeExportBridgePresent = useCallback(
    (action: string): boolean => {
      if (action === "exportXlsx") return hasExportXlsxBridge;
      if (action === "exportPptx") return hasExportPptxBridge;
      return false;
    },
    [hasExportXlsxBridge, hasExportPptxBridge],
  );

  // Phase 54 — the remembered validation defaults the dialog re-seeds from.
  const validationDefaults = effectiveValidationDefaults(settings);

  // Phase 88 (FEA-037) — the remembered sanitize selection the dialog
  // re-seeds from; absent settings fall back to DEFAULT_SANITIZE_OPTIONS
  // (all four true). Memoized so the dialog's re-seed effect is stable.
  const sanitizeOptions = useMemo(
    () => normalizeSanitizeOptions(settings?.sanitizeOptions),
    [settings?.sanitizeOptions],
  );

  // Phase 89 (FEA-033) — the remembered Bates defaults the dialog re-seeds
  // from; absent settings fall back to DEFAULT_BATES_DEFAULTS. Memoized so
  // the dialog's re-seed effect is stable.
  const batesDefaults = useMemo(
    () => normalizeBatesDefaults(settings?.batesDefaults),
    [settings?.batesDefaults],
  );

  // ---- Phase 56 (features A / C / D): the shared reading-view verbs -------
  //
  // `readingDocument` is OPTIONAL (its absence degrades the EPUB reader with
  // its own reason). The source format comes from the tab's OWN non-dismissible
  // state (`sourceFormatByTab`), NOT from the conversion card: a dismissed card
  // must never make the reader unreachable. The reader is enabled only for its
  // own format (epub vs cbz/cbt).
  const hasReadingDocumentBridge =
    typeof window.tflex.convert?.readingDocument === "function";
  const activeSourceFormat =
    tabs.activeId !== null ? sourceFormatByTab[tabs.activeId] : undefined;
  const readingGateFor = useCallback(
    (
      mode: "epub" | "comic",
    ): { enabled: boolean; reason: string | undefined } =>
      readingViewGate({
        mode,
        hasDocument: dockHasDocument,
        sourceFormat: activeSourceFormat,
        bridgePresent: hasReadingDocumentBridge,
      }),
    [dockHasDocument, activeSourceFormat, hasReadingDocumentBridge],
  );

  // DEF-327 — the live per-ACTION gates for the commands whose registry
  // precondition cannot express their real state: an EMPTY undo stack, Multi
  // Mode OFF. Both surfaces that can show these verbs (the dock's pins and the
  // Command Palette) read this ONE map, so neither can offer a no-op.
  const appActionGates = useMemo<Record<string, () => boolean>>(
    () => ({
      undo: (): boolean => activeEngineUi?.canUndo ?? false,
      redo: (): boolean => activeEngineUi?.canRedo ?? false,
      paneOpen: (): boolean => multiMode.enabled,
      paneClear: (): boolean => multiMode.enabled,
    }),
    [activeEngineUi, multiMode.enabled],
  );

  const dockAppToolEnabled = useCallback(
    (id: string): boolean => {
      const entry = toolById(id);
      if (entry === undefined) return false;
      const actionGate = appActionGates[entry.action];
      if (actionGate !== undefined) return actionGate();
      if (dockAppActions[entry.action] === undefined) return false;
      switch (entry.availability) {
        case "always":
          return true;
        case "document":
          return dockHasDocument;
        case "validation":
          return hasValidationBridge && dockHasDocument;
        case "office-export":
          return officeExportGate({
            hasDocument: dockHasDocument,
            bridgePresent: officeExportBridgePresent(entry.action),
          }).enabled;
        case "reading-view":
          return readingGateFor(
            entry.action === "openComicView" ? "comic" : "epub",
          ).enabled;
        case "recents":
          return recentDisplays.length > 0;
        case "form-fields":
          return (activeTab?.forms.fields.length ?? 0) > 0;
        case "ocr-run":
          return ocrRunByTab[tabs.activeId ?? ""] === true;
        case "multi-doc":
          return Object.keys(openTabs).length > 1;
        case "tab":
          return tabs.activeId !== null;
        // The dock has no colour/pen popover and no updater surface, and the
        // selection gate is owned by the pane's DocumentView.
        case "colour-tool":
        case "ink-tool":
        case "update-pending":
        case "selection":
          return false;
      }
    },
    [
      dockAppActions,
      appActionGates,
      dockHasDocument,
      hasValidationBridge,
      officeExportBridgePresent,
      readingGateFor,
      recentDisplays.length,
      activeTab,
      ocrRunByTab,
      tabs.activeId,
      openTabs,
    ],
  );

  const onDockToolAction = useCallback(
    (id: string): boolean => {
      const entry = toolById(id);
      if (entry === undefined) return false;
      const run = dockAppActions[entry.action];
      if (run === undefined) return false;
      run();
      return true;
    },
    [dockAppActions],
  );

  // ---- Phase 36 (chunk 7): the Multi Mode shared workspace chrome ---------
  //
  // The ONE shared Action Dock reports its State-4 idle flip; App shares it
  // with BOTH panes' floating pills, so the whole workspace's chrome fades in
  // lockstep (single mode's per-view dock keeps reporting to its own view).
  const [sharedDockIdle, setSharedDockIdle] = useState(false);
  // Phase 39 (DEF-348b/c) — the shared dock's measured vertical yield, in px.
  // The dock reports it so the panes/strips can reserve exactly the band the
  // dock needs (84px base + the lift): no dock verb, strip, page-action bar or
  // pill can then intersect another surface in Multi Mode.
  const [sharedDockLift, setSharedDockLift] = useState(0);

  // The shared Inspector's text-selection rule: in Multi Mode only the FOCUSED
  // pane's publish may drive the panel (`resolvePaneSelection`); the
  // focus-switch clear below withdraws the previous pane's selection.
  const onPaneTextSelection = useCallback(
    (pane: PaneId | null, selection: InspectorTextSelection | null): void => {
      const decision = resolvePaneSelection<InspectorTextSelection>(
        pane,
        multiMode.focused,
        selection,
      );
      if (decision.apply) setInspectorTextSelection(decision.value);
    },
    [multiMode.focused],
  );

  // ---- Phase 36 (chunk 4): the Command Palette's host wiring -------------
  //
  // The palette is MOUNTED HERE, once, for the whole window: it must work on
  // the welcome screen (its recent-file rows) and must never mount twice in
  // Multi Mode. Every command it runs is routed to the SAME handler its
  // existing control already calls — the dock's map, the App's own global
  // verbs, or the focused DocumentView's published view commands. Nothing
  // here re-implements a command.

  // ONE entry point for every route that opens the palette: `Ctrl+K`, the
  // legacy `Ctrl+Shift+P` alias, the File > Tools menu row and the registry's
  // `openCommandPalette` row. Phase 36 (chunk 5) — the All-tools panel is
  // retired, so there is no panel to close any more.
  const openCommandPalette = useCallback((): void => {
    setCommandPaletteOpen(true);
  }, []);

  // Each mounted DocumentView publishes the view-level commands it owns
  // (zoom presets, page stepping, find, pan, the edit / annotation tools),
  // keyed by the pane — single mode is `null`. The palette reads the FOCUSED
  // pane's set, so a Multi Mode palette row runs in the pane the user is
  // working in.
  const viewCommandsRef = useRef<Map<string, Record<string, () => void>>>(new Map());
  const registerViewCommandsFor = useCallback(
    (pane: PaneId | null, commands: Record<string, () => void> | null): void => {
      const key = pane ?? "single";
      if (commands === null) {
        viewCommandsRef.current.delete(key);
        return;
      }
      viewCommandsRef.current.set(key, commands);
    },
    [],
  );
  const focusedViewCommands = useCallback((): Record<string, () => void> => {
    const map = viewCommandsRef.current;
    if (!multiMode.enabled) return map.get("single") ?? {};
    return map.get(multiMode.focused) ?? map.get("A") ?? map.get("B") ?? map.get("single") ?? {};
  }, [multiMode.enabled, multiMode.focused]);

  // Phase 40 (item 5) — the top bar's Ctrl+F icon opens the SAME find surface
  // the Ctrl+F chord and the palette's `find` row open: the focused pane's own
  // `find` view command. One implementation of "find", three entry points.
  const openFindInDocument = useCallback((): void => {
    focusedViewCommands()["find"]?.();
  }, [focusedViewCommands]);

  // DEF-327 — each mounted DocumentView ALSO publishes the dock availability it
  // already gives the Action Dock (the live gate + the refusal copy). The
  // palette reads the FOCUSED pane's pair, so a palette row for a dock verb can
  // never disagree with the dock about whether it can run: one gate, two
  // consumers, no silent no-op. `null` withdraws a closed pane's verdict.
  const dockAvailabilityRef = useRef<Map<string, DockAvailability>>(new Map());
  const registerDockAvailabilityFor = useCallback(
    (pane: PaneId | null, availability: DockAvailability | null): void => {
      const key = pane ?? "single";
      if (availability === null) {
        dockAvailabilityRef.current.delete(key);
        return;
      }
      dockAvailabilityRef.current.set(key, availability);
    },
    [],
  );
  const focusedDockAvailability = useCallback((): DockAvailability | null => {
    const map = dockAvailabilityRef.current;
    if (!multiMode.enabled) return map.get("single") ?? null;
    return (
      map.get(multiMode.focused) ?? map.get("A") ?? map.get("B") ?? map.get("single") ?? null
    );
  }, [multiMode.enabled, multiMode.focused]);

  // The App-level verbs: the dock's own map (identical handlers) plus the
  // global commands the title bar / File menu / Stage Rail own. A registry
  // action that appears in neither this map nor the view commands renders
  // DISABLED in the palette (never a silent no-op).
  const paletteAppActions = useMemo<Record<string, () => void>>(
    () => ({
      ...dockAppActions,
      open: (): void => {
        void onOpenClick();
      },
      save: (): void => {
        const id = activeTabIdRefLocal.current;
        if (id !== null) void onSave(id);
      },
      saveAs: (): void => {
        const id = activeTabIdRefLocal.current;
        if (id !== null) void onSaveAs(id);
      },
      print: openPrintWindow,
      closeTab: (): void => {
        const id = activeTabIdRefLocal.current;
        if (id !== null) closeTab(id);
      },
      tabNew: onNewEmptyTab,
      multiModeToggle: onMultiModeToggle,
      toggleTheme: onToggleTheme,
      preferences: (): void => setPrefsOpen(true),
      checkForUpdate: onCheckForUpdate,
      updateDownload: onUpdateDownload,
      updateInstall: onUpdateInstall,
      about: (): void => setAboutOpen(true),
      openCommandPalette,
      railCollapse: togglePagesPanelCollapsed,
      // Phase 59 (item 7 follow-up) — the rail-tab commands, now WIRED rather
      // than pruned. Each ensures the Pages panel is showing (the rail lives
      // there) and sets the host-owned tab; re-selecting the current tab is an
      // idempotent no-op, and neither handler reads the document, so a command
      // fired with no document open simply switches the tab and never throws.
      railTabThumbnails: (): void => {
        onStageChange("pages");
        selectRailTab("thumbs");
      },
      railTabOutline: (): void => {
        onStageChange("pages");
        selectRailTab("outline");
      },
      // The clipboard-create command's UI is the Create sheet's own button
      // (the sheet reads the OS clipboard and asks for the quality), so the
      // palette row opens that same sheet rather than inventing a second flow.
      createFromClipboard: onCreateClick,
      stagePages: (): void => onStageChange("pages"),
      stageEdit: (): void => onStageChange("edit"),
      stageReview: (): void => onStageChange("review"),
      stageDeliver: (): void => onStageChange("deliver"),
      windowMinimize: (): void => window.tflex.minimizeWindow(),
      windowMaximize: (): void => window.tflex.maximizeWindow(),
      windowClose: (): void => window.tflex.closeWindow(),
    }),
    [
      dockAppActions,
      onOpenClick,
      onSave,
      onSaveAs,
      openPrintWindow,
      onUndo,
      onRedo,
      closeTab,
      onNewEmptyTab,
      onMultiModeToggle,
      onToggleTheme,
      onCheckForUpdate,
      onUpdateDownload,
      onUpdateInstall,
      openCommandPalette,
      togglePagesPanelCollapsed,
      onCreateClick,
      multiMode.enabled,
      multiMode.focused,
      onOpenIntoPane,
      onClearPane,
      onStageChange,
      selectRailTab,
    ],
  );
  // Phase 58 (chunk 4) — the HOME row's run map. It carries ONLY tools that
  // genuinely run from the welcome surface (no document open): the row's fixed
  // Open tile plus the shipped/editable tools. Every id maps to an EXISTING App
  // handler, keyed by REGISTRY id, so the picker can offer exactly this set and
  // a tile can never be a dead click. Document-dependent tools (rotate /
  // annotate / export / ...) are deliberately absent.
  const homeActions = useMemo<Record<string, () => void>>(
    () => ({
      [HOME_FIXED_TOOL_ID]: (): void => {
        void onOpenClick();
      },
      createFromImages: onCreateClick,
      merge: onMergeClick,
      preferences: (): void => setPrefsOpen(true),
      toolsPalette: openCommandPalette,
      // The theme command: the same no-arg cycle handler the palette / the
      // Ctrl+Shift+T accelerator runs (`onToggleTheme`). The header picker's
      // `onThemeChange` needs a target theme, so a one-click tile uses the
      // cycle exactly like the registry's `toggleTheme` entry does.
      toggleTheme: onToggleTheme,
      checkForUpdate: onCheckForUpdate,
      about: (): void => setAboutOpen(true),
    }),
    [
      onOpenClick,
      onCreateClick,
      onMergeClick,
      openCommandPalette,
      onToggleTheme,
      onCheckForUpdate,
    ],
  );
  // The picker's candidate set: the run map's ids minus the fixed Open tile.
  const homeCandidates = useMemo(
    () => Object.keys(homeActions).filter((id) => id !== HOME_FIXED_TOOL_ID),
    [homeActions],
  );
  // The persisted row (absent -> the shipped default). Re-sanitized on read so
  // a stale/foreign value can never render an unknown id or overflow the cap.
  const homeToolIds = useMemo(
    () =>
      settings?.homeTools === undefined
        ? [...DEFAULT_HOME_TOOLS]
        : sanitizeHomeTools(settings.homeTools),
    [settings?.homeTools],
  );

  // The live availability gate. DEF-327 — the FOCUSED pane's published dock
  // gate answers first for every verb the dock hosts (the edit-layer tools need
  // Edit mode on, the page selection, the undo stacks): the palette cannot
  // offer a command the dock knows cannot run. Everything the dock never hosts
  // (the title bar / File menu / global commands) keeps this host-level
  // availability, plus the same live per-action gates the dock's pins read.
  const paletteToolEnabled = useCallback(
    (entry: ToolEntry): boolean => {
      const dockVerdict = focusedDockAvailability()?.isToolEnabled(entry);
      if (dockVerdict !== undefined) return dockVerdict;
      const hasHandler =
        paletteAppActions[entry.action] !== undefined ||
        focusedViewCommands()[entry.action] !== undefined;
      if (!hasHandler) return false;
      const actionGate = appActionGates[entry.action];
      if (actionGate !== undefined) return actionGate();
      switch (entry.availability) {
        case "always":
          return true;
        case "document":
          return dockHasDocument;
        case "validation":
          return hasValidationBridge && dockHasDocument;
        case "office-export":
          return officeExportGate({
            hasDocument: dockHasDocument,
            bridgePresent: officeExportBridgePresent(entry.action),
          }).enabled;
        case "reading-view":
          return readingGateFor(
            entry.action === "openComicView" ? "comic" : "epub",
          ).enabled;
        case "tab":
          return tabs.activeId !== null;
        case "form-fields":
          return (activeTab?.forms.fields.length ?? 0) > 0;
        case "ocr-run":
          return ocrRunByTab[tabs.activeId ?? ""] === true;
        case "update-pending":
          return (
            updateState?.kind === "available" || updateState?.kind === "downloaded"
          );
        case "multi-doc":
          return Object.keys(openTabs).length > 1;
        // The view layer owns these gates (it owns the page selection and the
        // armed tools); the handler's existence is the palette's own check.
        case "recents":
          return recentDisplays.length > 0;
        case "selection":
        case "colour-tool":
        case "ink-tool":
          return true;
      }
    },
    [
      focusedDockAvailability,
      paletteAppActions,
      focusedViewCommands,
      appActionGates,
      dockHasDocument,
      hasValidationBridge,
      officeExportBridgePresent,
      readingGateFor,
      tabs.activeId,
      activeTab,
      ocrRunByTab,
      updateState,
      openTabs,
      recentDisplays.length,
    ],
  );

  // DEF-327 — the disabled row's refusal copy, in the dock's own order: the
  // focused pane's live reason first ("Turn on Edit content first"), then the
  // shared per-action copy ("Nothing to undo"), and otherwise `undefined` so
  // the palette falls back to the registry's declared availability ("Run
  // Recognize text first").
  const paletteDisabledReason = useCallback(
    (entry: ToolEntry): string | undefined => {
      if (paletteToolEnabled(entry)) return undefined;
      // Phase 55 (feature D) — the office-export verbs have TWO distinct
      // disabled states; read the ONE live gate so the no-document case reads
      // "Open a document first" and the bridge-absent case its own copy.
      if (entry.availability === "office-export") {
        return officeExportGate({
          hasDocument: dockHasDocument,
          bridgePresent: officeExportBridgePresent(entry.action),
        }).reason;
      }
      // Phase 56 (features A / C) — the reading-view verbs have a
      // format-specific refusal; read the ONE live gate for the exact reason.
      if (entry.availability === "reading-view") {
        return readingGateFor(
          entry.action === "openComicView" ? "comic" : "epub",
        ).reason;
      }
      return paletteDisabledReasonFor({
        entry,
        paneReason: focusedDockAvailability()?.disabledReasonFor,
        actionReasons: PALETTE_ACTION_REASONS,
      });
    },
    [paletteToolEnabled, focusedDockAvailability, officeExportBridgePresent, dockHasDocument, readingGateFor],
  );

  // Run a palette row: the view layer first (exactly like the dock's own
  // `runDockTool`), then the App verbs. The frequency counter is written
  // through the SAME settings path everything else uses, and only when a
  // handler actually ran.
  const onPaletteRun = useCallback(
    (id: string): void => {
      const entry = toolById(id);
      if (entry === undefined) return;
      const run =
        focusedViewCommands()[entry.action] ?? paletteAppActions[entry.action] ?? undefined;
      if (run === undefined) return;
      run();
      setSettings((prev) => {
        if (prev === null) return prev;
        const updated: AppSettings = { ...prev, toolUsage: bumpToolUsage(prev.toolUsage, id) };
        trackAndSave(updated);
        return updated;
      });
    },
    [focusedViewCommands, paletteAppActions, trackAndSave],
  );

  // Phase 36 (chunk 7) — the ONE shared Action Dock's verb runner in Multi
  // Mode. Same order as the dock's own `runDockTool` (and as the palette): the
  // FOCUSED pane's view-level command first (rotate, edit / annotation tools,
  // pan, clear, the REVIEW Annotate flyout), then App's own app-level handler.
  // A verb with neither stays DISABLED through the pane's published gate, so a
  // missing handler can never be a silent no-op.
  const runSharedDockTool = useCallback(
    (id: string): void => {
      const entry = toolById(id);
      if (entry === undefined) return;
      const run =
        focusedViewCommands()[entry.action] ?? dockAppActions[entry.action] ?? undefined;
      run?.();
    },
    [focusedViewCommands, dockAppActions],
  );

  const paletteRecents = useMemo(
    () => recentDisplays.map((row) => ({ path: row.entry.path, label: row.meta.name })),
    [recentDisplays],
  );
  const onPaletteOpenRecent = useCallback(
    (path: string): void => {
      const match = recentDisplays.find((row) => row.entry.path === path);
      if (match === undefined) return;
      void onRecentClick(match.entry);
    },
    [recentDisplays, onRecentClick],
  );

  // The keyboard chords. `paletteChordFor` owns exactly two: `Ctrl+K` (toggle)
  // and `Ctrl+Shift+P` (the legacy aliases opens). It deliberately returns
  // null for `Ctrl+P` — the PRINT accelerator is never intercepted here, so it
  // keeps reaching the same handler it always did.
  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      const chord = paletteChordFor(event);
      if (chord === null) return;
      event.preventDefault();
      if (chord === "legacy-open") {
        openCommandPalette();
        return;
      }
      if (commandPaletteOpen) setCommandPaletteOpen(false);
      else openCommandPalette();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [commandPaletteOpen, openCommandPalette]);

  // Phase 58 (chunk 5) — tab reorder. State-driven through the reducer's
  // `move` action; the reducer preserves `activeId`, so reordering the
  // strip never changes which document is focused. Multi Mode shows ONE
  // composite tab, so the header's own gate disables reordering there.
  const onMoveTab = useCallback((id: string, toIndex: number): void => {
    dispatchTabs({ type: "move", id, toIndex });
  }, []);

  if (!bootDone || settings === null) {
    return (
      <div className={isMaximized ? "app app-maximized" : "app"}>
        <TitleBar maximized={false} />
        <div className="app-main" data-tools-open="false" />
        <Toasts items={[]} onDismiss={dismissToast} />
      </div>
    );
  }

  // Phase 37 (item 8) — the Stage Rail is a DOCUMENT surface: hidden on the
  // welcome (home) screen, present once a document is open. Keyed to the SAME
  // condition that shows the welcome pane (and therefore hides the
  // ContextPanel/Inspector) via ONE helper, so the rail and the welcome pane
  // can never disagree. The app's stage state lives in App, not in the rail,
  // so hiding the rail never loses it.
  const stageRailVisible = isStageRailVisible(
    tabs.tabs.length,
    activeIsEmpty === true,
    multiMode.enabled,
  );
  const showWelcomeEffective = !stageRailVisible;

  // Phase 84 — the persisted redaction mark colour (six-digit hex, main
  // process normalizes; absent field means the documented default black).
  const redactionColor = settings?.redactionColor ?? "#000000";

  return (
    <div className={isMaximized ? "app app-maximized" : "app"}>
      {/* Phase 14 — the frosted theme's ambient backdrop. Paints the
       * wallpaper-style gradient the glass panels diffuse; invisible
       * in light/dark (the opaque .app background covers it). The
       * parallax controller writes --tf-parallax-* here. */}
      <div className="tf-ambient" ref={ambientLayerRef} aria-hidden />
      <TitleBar
        menuGroups={fileMenuGroups}
        menuContext={menuContext}
        maximized={isMaximized}
      >
        <AppHeader
          activeId={stripActiveId}
          // Phase 105 (chunk C) — the application menu's groups (Edit / View /
          // Tools / Help) and the dispatcher context its id-backed rows run
          // through. The relocated Multi Mode / Find rows call their handlers
          // directly, exactly like the icon controls they replace.
          appMenuGroups={appMenuGroups}
          menuContext={menuContext}
          onMultiModeToggle={onMultiModeToggle}
          onOpenFind={openFindInDocument}
          findEnabled={activeTabHasDocument}
          // Phase 30 — the Print icon. Phase 40 (item 5) — Ctrl+K Search tools.
          onPrint={openPrintWindow}
          // DEF-336 — enabled only with a real document on the active tab.
          printEnabled={activeTabHasDocument}
          onOpenToolSearch={openCommandPalette}
          // Phase 44 (operator amendment) — the account section is built by
          // the App and passed as a slot, so AppHeader stays presentational.
          // It is rendered while the internal `accountsEnabled` escape hatch
          // is on (default true); an explicit false removes it live.
          accountSlot={settings.accountsEnabled === true ? (
            <AccountMenu
              signedIn={accountStatus.signedIn}
              user={accountStatus.signedIn ? {
                id: "",
                email: accountStatus.email ?? "",
                emailVerified: true,
                name: accountStatus.name ?? undefined,
                image: accountStatus.image,
              } : null}
              imageUrl={accountStatus.image}
              onOpenSignIn={(): void => setAccountsOpen(true)}
              onSignedOut={(): void => setAccountStatus({ signedIn: false, email: null, name: null, image: null })}
              onProfileUpdated={(user): void => {
                setAccountStatus((prev) => ({ ...prev, name: user.name ?? null, image: user.image ?? prev.image }));
              }}
            />
          ) : null}
          // Phase 22 — the relocated Open / Save / Save As. The CommandBar
          // no longer renders them; the title row owns them now.
          onOpenFile={onOpenClick}
          onSave={onHeaderSave}
          onSaveAs={onHeaderSaveAs}
          saveModified={activeSaveModified}
          saveInPlaceEnabled={activeSaveInPlaceEnabled}
          // OTA UX — the toolbar update indicator reads its state
          // from the App's shared `onStatusChanged` subscription via
          // `externalState`.
          updateIndicator={<UpdateIndicator externalState={updateState} />}
        />
      </TitleBar>
      {/* Phase 105 (chunk C) — the document rail: a SECOND 40px row below the
          title row. It owns the tab strip (`.tab-area`/`.tab-list`), the "+"
          new tab affordance, the reorder / tear-out gesture and the uniform
          overflow plan. The Multi Mode composite tab and its disabled "+"
          reason are unchanged; chunk D adds the All-tabs switcher. */}
      <DocumentRail
        activeId={stripActiveId}
        // `stripTabs` is memoised above so its reference is stable across App
        // re-renders that don't actually change tab state.
        tabs={stripTabs}
        // Phase 32 — the strip click is the Multi Mode routing seam.
        onActivate={onTabStripActivate}
        // Phase 34 (chunk 2) — the composite tab's close runs the
        // per-document modified queue over BOTH pane documents.
        onClose={onHeaderClose}
        // Phase 58 (chunk 5) — reorder the strip.
        onMoveTab={onMoveTab}
        // Phase 58 (chunk 6b) — tear a tab out into a new app window.
        onDetachTab={detachTab}
        onNewEmptyTab={onNewEmptyTab}
        // DEF-288 — while Multi Mode is on the "+" is disabled with a reason.
        multiModeEnabled={multiMode.enabled}
        // Phase 58 — the tab-strip style preference.
        tabStyle={settings.tabStyle ?? DEFAULT_TAB_STYLE}
      />
      {/* Phase 36 (chunk 5) — the open INSPECTOR's state lives on .app-main
          as a data attribute, driven by the SAME `inspectorOpen` flag that
          mounts the panel below. The CSS animates --tf-tools-inset from it
          (registered @property, transitioned on .workspace-main, consumed by
          the scroller's margin-right) so the page view narrows beside the
          open panel in EVERY theme and panel + page move together on the
          shared panel-slide tokens. The retired palette's layout-mode width
          attribute (list 344px / grid 380px) is gone: the Inspector has ONE
          width.

          Phase 16 — data-rail-collapsed is driven by the SAME
          `pagesPanel` state that swaps the rail body to the ruler
          strip: it flips the registered --tf-rail-w token (220px ->
          48px) that .workspace's grid column tweens over the shared
          280ms panel motion token, so the rail shrinks and the page
          reflows together in every theme. */}
      <div
        className="app-main"
        style={appMainPanelStyle}
        data-tools-open={inspectorVisible ? "true" : "false"}
        data-rail-collapsed={pagesPanelCollapsedEffective || bookViewActive ? "true" : "false"}
        data-inspector-collapsed={inspectorCollapsedForBookView ? "true" : "false"}
        // Phase 37 (item 8) — true on the welcome/home screen. Collapses the
        // rail's 44px track and lets the stage span the full frame.
        data-stage-rail-hidden={stageRailVisible ? "false" : "true"}
      >
        {/* Phase 112 (TFL-854, chunk H) — the resizable panel separators. The
            LEFT handle exists only while the navigator is expanded (Multi Mode
            draws its own per-pane strips instead); the RIGHT handle only while
            the inspector is expanded. Both edit the SAME App state the panels
            read, so a drag, a key press and a settings echo all agree. */}
        {stageRailVisible && !railCollapsedEffective && !multiMode.enabled && (
          <PanelResizeHandle
            side="left"
            width={panelLeftWidth}
            onResize={onPanelLeftResize}
            onCommit={commitPanelLeftWidth}
            data-testid="panel-resize-left"
          />
        )}
        {inspectorOpen && !inspectorCollapsedForBookView && (
          <PanelResizeHandle
            side="right"
            width={panelRightWidth}
            onResize={onPanelRightResize}
            onCommit={commitPanelRightWidth}
            data-testid="panel-resize-right"
          />
        )}
        {/* Phase 36 (chunk 1b) — the Stage Rail. Mounted here as a REAL 44px
         * grid track inside .app-main (already `position: relative`); it
         * claims only its own column and reflows nothing. The gear opens the
         * same Preferences sheet as the title-bar gear. Phase 37 (item 8) —
         * it is NOT rendered on the welcome screen (a document surface). */}
        {stageRailVisible && (
          <StageRail
            activeStage={activeStage}
            onStageChange={onStageChange}
            onOpenPreferences={(): void => setPrefsOpen(true)}
          />
        )}
        <PageDragProvider>
        <DocumentStage
          tabs={stageTabs}
          activeId={tabs.activeId}
          // Phase 32 — in Multi Mode the stage always renders the panes
          // (even if the tab strip's active tab happens to be an empty
          // placeholder), so toggling the mode can never remount a
          // DocumentView. With the mode off this is the pre-Phase-32
          // condition exactly.
          showWelcome={showWelcomeEffective}
          welcomeKey={tabs.activeId ?? 'welcome'}
          welcome={
            <Welcome
              recentFiles={recentDisplays}
              onOpenRecent={onRecentClick}
              onRemoveRecent={onRemoveRecent}
              onToggleRecentPin={onToggleRecentPin}
              onShowRecentInFolder={onShowRecentInFolder}
              onLocateRecentMissing={onLocateRecentMissing}
              missingRecentPaths={missingRecentList}
              onOpenFile={onOpenClick}
              onSampleClick={onSampleClick}
              onMergeClick={onMergeClick}
              onCreateFromImages={onCreateClick}
              homeTools={homeToolIds}
              homeCandidates={homeCandidates}
              onRunHomeTool={(id): void => homeActions[id]?.()}
              onSetHomeTools={(ids): void =>
                setSettings((prev) => {
                  if (prev === null) return prev;
                  const updated: AppSettings = { ...prev, homeTools: sanitizeHomeTools(ids) };
                  trackAndSave(updated);
                  return updated;
                })
              }
              // TFL-938 — the Home decorative-motion pause is its own
              // persisted preference; it never touches the global Animations
              // setting.
              homeMotionPaused={settings.homeMotionPaused === true}
              onSetHomeMotionPaused={(next): void => {
                setSettings((prev) => {
                  if (prev === null) return prev;
                  const updated = preferencesReducer(prev, {
                    type: "set-home-motion-paused",
                    value: next,
                  });
                  trackAndSave(updated);
                  return updated;
                });
              }}
              samplesResolver={samplesResolver}
            />
          }
          multiMode={multiMode}
          splitFraction={splitFraction}
          onSplitChange={setSplitFraction}
          // DEF-287 (residual) — the Inspector's requested inset target: 0
          // when no document is open, the Inspector's live width when it is,
          // or the narrow strip width while collapsed (Phase 37 item 3), so the
          // panes' geometry always matches the CSS inset. Phase 112 (chunk H):
          // the width is the SAME resolved `toolsInsetPx` the inline
          // `--tf-tools-inset` uses, so a resize can never desync them.
          toolsInsetTarget={toolsInsetPx}
          onFocusPane={onFocusPane}
          onClearPane={onClearPane}
          onPickPane={onPickPane}
          onOpenIntoPane={onOpenIntoPane}
          dockBandPx={multiDockBandPx(sharedDockLift)}
          // Phase 36 (chunk 7) — the workspace's ONE Action Dock: rendered
          // once, floating at the workspace's bottom-centre while Multi Mode
          // is on. It reads the FOCUSED pane's stage (the verb set) and that
          // pane's published context (selection, gates, idle suppression), so
          // a focus switch changes its contents. Every verb routes through
          // `runSharedDockTool` (the focused view's command, then App's).
          sharedDock={
            multiMode.enabled ? (
              <MultiActionDock
                controller={sharedToolController}
                pane={dockPane ?? multiMode.focused}
                activeStage={dockStage}
                dockPins={dockPins}
                dockUnpinned={dockUnpinned}
                ladder={dockLadder}
                onPinTool={onDockPin}
                onUnpinTool={onDockUnpin}
                onRunTool={runSharedDockTool}
                toolUsage={settings.toolUsage}
                activeToolIds={dockActiveToolIds}
                onIdleChange={setSharedDockIdle}
                onLiftChange={setSharedDockLift}
                onOpenTools={openCommandPalette}
              />
            ) : null
          }
          // Phase 36 (chunk 5) — the All Tools badge is RETIRED (the
          // Inspector is the right panel and needs no toggle affordance). The
          // stage no longer receives a `toolsBadge` node; the DEF-284
          // single-badge rule is moot because there is no badge at all.
          // Phase 33 — each pane's own DocumentView renders its own
          // thumbnail strip (pane A on the right, pane B on the left), so
          // the stage no longer hosts a shared rail.
          renderDocument={(tabId, pane) => {
            const meta = tabs.tabs.find((t) => t.id === tabId);
            const open = openTabs[tabId];
            if (meta === undefined || open === undefined) return null;
            const engine = engineFor(tabId);
            const ann = annotationHandlers(tabId);
            const fs = formsAndSignaturesHandlers(tabId);
            // Phase 66 (chunk 3) — the annotation palette / theme / MRU
            // expressions handed to BookView's toolbar. Same source as the
            // DocumentView mount below; defined here so the expressions are
            // written once for Book View.
            const bookAnnotationPalette =
              settings.annotationColors === undefined
                ? null
                : {
                    light: (settings.annotationColors.light ?? []).map((p) =>
                      typeof p === 'string' ? { id: `legacy-${p}`, hex: p } : p,
                    ),
                    dark: (settings.annotationColors.dark ?? []).map((p) =>
                      typeof p === 'string' ? { id: `legacy-${p}`, hex: p } : p,
                    ),
                  };
            const onBookAnnotationPaletteChange = (next: {
              light?: Array<{ id: string; hex: string }>;
              dark?: Array<{ id: string; hex: string }>;
            }): void => {
              setSettings((prev) => {
                if (prev === null) return prev;
                const updated = applyAnnotationPaletteChange(prev, next);
                if (updated !== prev) trackAndSave(updated);
                return updated;
              });
            };
            const bookAnnotationRecentTools = settings.annotationRecentTools ?? [];
            const onBookAnnotationRecentToolsChange = (ids: string[]): void => {
              setSettings((prev) => {
                if (prev === null) return prev;
                const updated = preferencesReducer(prev, {
                  type: 'set-annotation-recent-tools',
                  value: ids,
                });
                if (updated !== prev) trackAndSave(updated);
                return updated;
              });
            };
            // Phase 66 (chunk 1) — while Book View is on for this tab, render
            // the read-only BookView INSTEAD of the DocumentView in the active
            // (single-mode) pane. The rail, dock and flyout live inside
            // DocumentView, so they vanish naturally; App separately forces the
            // Inspector and rail track collapsed.
            const bookViewForPane =
              pane === null && bookViewTabId !== null && bookViewTabId === meta.id;
            const outlineEditorConfig =
              open.session.outlineEntries === null
                ? null
                : {
                    docId: open.session.engineDocId,
                    entries: open.session.outlineEntries,
                    visiblePageCount: engine.engineState.pageCount,
                    commit: commitOutline,
                  };
            const document = (
              <OutlineEditorContext.Provider value={outlineEditorConfig}>
                {bookViewForPane ? (
              <BookView
                doc={open.session.doc}
                pageCount={engine.engineState.pageCount}
                title={meta.title}
                defaultLayout={
                  (settings.readingDefaults ?? DEFAULT_READING_DEFAULTS).comics.layout
                }
                onClose={closeBookView}
                annotations={ann.annotations}
                liveAnnTextIds={ann.liveAnnTextIds}
                onCreateAnnotation={ann.createAnnotation}
                onEditAnnotation={ann.editAnnotation}
                onDeleteAnnotation={ann.deleteAnnotation}
                annotationPalette={bookAnnotationPalette}
                onAnnotationPaletteChange={onBookAnnotationPaletteChange}
                themeName={settings.theme}
                annotationRecentTools={bookAnnotationRecentTools}
                onAnnotationRecentToolsChange={onBookAnnotationRecentToolsChange}
              />
            ) : (
                  <DocumentView
                    doc={open.session.doc}
                    pageCount={engine.engineState.pageCount}
                    outline={open.session.outline}
                    initial={open.persisted}
                    // Phase 66 (chunk 1) — the canvas Book View entry.
                    onOpenBookView={openBookView}
                    // Phase 36 (chunk 3a) — the Action Dock. The stage is the
                    // pane's own stage in Multi Mode (the shared dock arrives
                    // with the shared-workspace chunk; per-pane docks are
                    // suppressed there), the pins are the validated settings
                    // field, and the app-level verbs are routed through
                    // `onDockToolAction`.
                    activeStage={stageForPane(stageState, pane)}
                    dockPins={dockPins}
                    dockUnpinned={dockUnpinned}
                    dockLadder={dockLadder}
                    onDockPin={onDockPin}
                    onDockUnpin={onDockUnpin}
                    toolUsage={settings.toolUsage}
                    onDockToolAction={onDockToolAction}
                    isDockToolEnabled={dockAppToolEnabled}
                    // Phase 104 (chunk 1) — the dock's labelled Tools button
                    // opens the SAME command palette Ctrl+K and the header use.
                    onOpenTools={openCommandPalette}
                    // Phase 82 — the offline spell-check preference for the
                    // text-edit surfaces. The flip persists through
                    // `trackAndSave` (the sole settings write path).
                    spellCheckEnabled={settings.spellCheck?.enabled ?? true}
                    onSpellCheckEnabledChange={(enabled): void =>
                      setSettings((prev) => {
                        if (!prev) return prev;
                        const updated: AppSettings = {
                          ...prev,
                          spellCheck: { enabled, language: 'en-US' },
                        };
                        trackAndSave(updated);
                        return updated;
                      })
                    }
                    onPersist={persistFor(meta.id)}
                    onDiagnostics={diagnosticsFor(meta.id)}
                    onSearchIndexProgress={searchIndexProgressFor(meta.id)}
                    registerSearchIndexInvalidator={(
                      fn,
                    ): void => registerSearchIndexInvalidatorFor(meta.id, fn)}
                    // Phase 36 (chunk 4) — the Command Palette's view-command
                    // bridge: this pane publishes the commands it owns (zoom,
                    // page stepping, find, pan, the edit / annotation tools) so
                    // the palette runs them here rather than re-implementing
                    // them. Keyed by pane; `null` withdraws them on unmount.
                    registerViewCommands={(commands): void =>
                      registerViewCommandsFor(pane, commands)
                    }
                    // DEF-327 — the SAME availability pair this pane gives the
                    // Action Dock is published up so the Command Palette's rows
                    // for the dock's verbs use the dock's verdict and copy.
                    registerDockAvailability={(availability): void =>
                      registerDockAvailabilityFor(pane, availability)
                    }
                    // Phase 112 (TFL-854 C2) — publish this pane's thumbnail
                    // multi-select so the right Inspector names the scope.
                    onPageSelectionReport={(pages): void =>
                      reportPageSelectionFor(pane, pages)
                    }
                    // Phase 112 (TFL-854 C2 follow-up) — publish this pane's
                    // live measured page sizes so the Inspector's Size row is
                    // real on a normally-opened document.
                    onPageSizesReport={(sizes): void => reportPageSizesFor(pane, sizes)}
                    onToast={pushToast}
                    engineState={engine.engineState}
                    // DEF-139 — visible-order flag for the slot ->
                    // proxy-page mapping (original bytes vs a
                    // re-serialized getDocumentBytes proxy).
                    proxyVisibleOrder={open.session.proxyVisibleOrder}
                    canUndo={engine.canUndo}
                    canRedo={engine.canRedo}
                    onRotate={engine.op}
                    onDelete={engine.deletePages}
                    onReorder={engine.reorder}
                    onUndo={engine.undo}
                    onMerge={onMergeClick}
                    onSplit={onSplitClick}
                    // Phase 36 (chunk 2) — the PAGES ContextPanel's right-click
                    // verbs. Extract / replace / renumber reuse the SAME dialog
                    // entries the toolbar and the All-tools palette already
                    // open; "Delete…" opens the existing delete-pages dialog
                    // seeded with the clicked page (onDeletePageClick's optional
                    // seed); "Insert blank after" is an IMMEDIATE engine insert
                    // (no dialog), because its label promises the action. The
                    // panel is the default single-mode left slot since chunk 6.
                    onExtractPages={(): void => onSplitClick()}
                    onInsertBlankPage={(page): void => {
                      void onInsertBlankAfterPage(page);
                    }}
                    onReplacePages={onReplacePagesClick}
                    onOptimize={onOptimizeClick}
                    onAuditSpace={onAuditClick}
                    // Phase 36 (chunk 6) — the EDIT / REVIEW / DELIVER
                    // ContextPanel's host wiring. Every entry reuses an
                    // EXISTING handler: the OCR dialog, the suspects panel's
                    // gated opener, the signature manager + its apply path,
                    // Optimize and the "from images" dialog. The panel is the
                    // default single-mode left slot now (the chunk-2 dev flag
                    // is retired). `onTextSelectionChange` publishes the live
                    // text-object selection up so the Inspector's EDIT/text
                    // section shows the REAL selected object.
                    ocrStatus={ocrRunByTab[meta.id] === true ? 'Recognized' : null}
                    ocrHasRun={ocrRunByTab[meta.id] === true}
                    ocrSuspectCount={ocrSuspectsByTab[meta.id]?.length ?? 0}
                    onRecognizeText={onOcrClick}
                    onOpenOcrSuspects={onOpenOcrSuspects}
                    onSignSignature={onSigManagerApply}
                    onManageSignatures={(): void => setSigModalOpen(true)}
                    fileSize={open.session.fileSize}
                    onCreateFromImages={onCreateClick}
                    onTextSelectionChange={
                      // Phase 36 (chunk 7) — the shared Inspector follows the
                      // FOCUSED pane, so BOTH panes publish and the host's
                      // `resolvePaneSelection` guard drops a background pane's
                      // publish (single mode passes `null` as the pane and
                      // always applies, unchanged).
                      (selection): void => onPaneTextSelection(pane, selection)
                    }
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
                    onRemoveBlankPages={onOpenBlankPages}
                    canDeletePage={engine.engineState.pageCount > 1}
                    annotations={ann.annotations}
                    liveAnnTextIds={ann.liveAnnTextIds}
                    onCreateAnnotation={ann.createAnnotation}
                    onEditAnnotation={ann.editAnnotation}
                    onDeleteAnnotation={ann.deleteAnnotation}
                    onAddComment={ann.addComment}
                    formFields={fs.formFields}
                    onFormValueChange={fs.onFormValueChange}
                    onFormListboxToggle={fs.onFormListboxToggle}
                    signatures={fs.signatures}
                    savedSignatures={fs.savedSignatures}
                    // Phase 90 (TFL-509-C1) — the unified review list's
                    // non-annotation sources + handlers (reaches the REVIEW
                    // ContextPanel through DocumentView).
                    bates={batesList}
                    watermarks={watermarkList}
                    onSelectReviewElement={onSelectReviewElement}
                    onEditReviewElement={onEditReviewElement}
                    onDeleteReviewElement={onDeleteReviewElement}
                    reviewErrorFor={reviewErrorFor}
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
                    redactArmed={redactArmed}
                    onApplyRedactions={onApplyRedactions}
                    onReplaceText={(payload): Promise<Result<ReplaceTextResult, EngineError>> =>
                      handleReplaceText(meta.id, payload)
                    }
                    markColor={redactionColor}
                    onMarkColorChange={onMarkColorChange}
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
                    annotationPalette={
                      settings.annotationColors === undefined
                        ? null
                        : {
                            light: (settings.annotationColors.light ?? []).map((p) =>
                              typeof p === 'string'
                                ? { id: `legacy-${p}`, hex: p }
                                : p,
                            ),
                            dark: (settings.annotationColors.dark ?? []).map((p) =>
                              typeof p === 'string'
                                ? { id: `legacy-${p}`, hex: p }
                                : p,
                            ),
                          }
                    }
                    onAnnotationPaletteChange={(next): void => {
                      // DEF-037 — use the updater-form of `setSettings`
                      // so `prev` is React's latest pending state, not
                      // the render-scope `settings` (which can be stale
                      // when the user toggles the theme and adds a
                      // custom color back-to-back before a re-render).
                      // Building the persisted object inside the
                      // updater also guarantees the theme matches the
                      // current renderer state — the previous
                      // implementation wrote the captured-render
                      // settings object with an old theme, which then
                      // echoed back from the backend and clobbered the
                      // per-theme palette buckets.
                      //
                      // The persist goes through `trackAndSave`
                      // so the echo filter in the settings.changed
                      // listener can detect stale echoes that arrive
                      // after a newer local write has already
                      // superseded them.
                      setSettings((prev) => {
                        if (prev === null) return prev;
                        const updated = applyAnnotationPaletteChange(prev, next);
                        if (updated !== prev) trackAndSave(updated);
                        return updated;
                      });
                    }}
                    themeName={settings.theme}
                    // Phase 19 — MRU annotation tool order. The group
                    // (next chunk) promotes a tool and reports the new
                    // order; App persists it through the preferences
                    // reducer so it survives restart. The backend
                    // sanitises the field on the way in, so the reducer
                    // only guards against an unchanged-order no-op.
                    annotationRecentTools={settings.annotationRecentTools ?? []}
                    onAnnotationRecentToolsChange={(ids): void => {
                      setSettings((prev) => {
                        if (prev === null) return prev;
                        const updated = preferencesReducer(prev, {
                          type: 'set-annotation-recent-tools',
                          value: ids,
                        });
                        if (updated !== prev) trackAndSave(updated);
                        return updated;
                      });
                    }}
                    editModeOpen={editModeOpen}
                    onEditModeToggle={(): void => setEditMode(!editModeOpen)}
                    edit={editModeOpen ? editHandlers(meta.id) : null}
                    // Phase 16 — pages-panel collapsed state: App owns
                    // the persisted value; DocumentView threads it to
                    // the SideRail (the rail never owns the state).
                    pagesPanelCollapsed={pagesPanelCollapsedEffective}
                    onTogglePagesPanelCollapsed={togglePagesPanelCollapsed}
                    // Phase 59 (item 7 follow-up) — the host-owned rail tab,
                    // threaded to the Pages ContextPanel so the palette's
                    // "Page thumbnails" / "Bookmarks" commands switch it and
                    // the panel's own outline toggle writes it back.
                    // Phase 111 (chunk D2a) — routed through `selectRailTab` so
                    // the view is remembered per document.
                    railTab={railTab}
                    onRailTabChange={selectRailTab}
                    // Phase 111 (chunk D1) — the Split Navigator layout + ratio
                    // and their settled-change handlers, threaded through
                    // DocumentView to the Pages ContextPanel.
                    navigatorLayout={navigatorLayout}
                    navigatorSplitRatio={navigatorSplitRatio}
                    onNavigatorLayoutChange={commitNavigatorLayout}
                    onNavigatorSplitRatioChange={commitNavigatorSplitRatio}
                    // Phase 32 — Multi Mode suppresses each pane's OWN rail
                    // (the shared two-section rail is the next chunk); the
                    // CommandBar control reads the same App-owned state as
                    // the All-tools entry, so both always agree.
                    // Phase 33 — Multi Mode: this pane's OWN thumbnail strip on the
                    // correct side (A right, B left) so the two strips meet
                    // side by side in the middle of the workspace. Single
                    // mode keeps the unchanged left-side SideRail.
                    railSide={pane === "A" ? "right" : "left"}
                    multiRail={
                      pane === null
                        ? null
                        : {
                            pane,
                            tabId: meta.id,
                            title: meta.title,
                            documentCount: loadedDocumentCount,
                            onFocusPane: (): void => onFocusPane(pane),
                            onDrop: onPageDrop,
                          }
                    }
                    // Phase 32 (chunk 2b) — a completed page drop reveals
                    // the landing page in the target pane.
                    jumpRequest={railJump !== null && railJump.tabId === meta.id ? railJump : null}
                    multiModeEnabled={multiMode.enabled}
                    onMultiModeToggle={onMultiModeToggle}
                    // Phase 33 (chunk 4) — in Multi Mode this pane suppresses
                    // its own toolbar rows and publishes its model + arm
                    // state to the shared controller instead. Single mode
                    // passes null: the existing toolbar is untouched.
                    sharedTools={
                      multiMode.enabled && pane !== null ? sharedToolsFor(pane) : null
                    }
                    // Phase 36 (chunk 7) — the per-pane Multi Mode chrome: the
                    // pane id gates the pane's OWN floating pills, `paneFocused`
                    // owns the ONE shared annotations flyout, and `chromeIdle`
                    // is the shared dock's State-4 flip so the whole workspace's
                    // chrome fades together.
                    multiPane={pane}
                    paneFocused={pane !== null && pane === multiMode.focused}
                    // DEF-343 — the Inspector's REQUESTED inset, so a Multi Mode
                    // pane's first-fit gate cannot release while the panel slide
                    // is still pending (the SAME target the stage's
                    // `toolsInsetTarget` above hands the panes' geometry).
                    // Phase 112 (chunk H): the resolved `toolsInsetPx`.
                    paneInsetTarget={toolsInsetPx}
                    // DEF-343 — the pane's tab must be a REAL document before
                    // its first fit can settle: engine.pageCount can be >0 one
                    // commit before `kind` flips and the Inspector target (and
                    // the panel slide) changes.
                    paneContentReady={meta.kind !== "empty"}
                    chromeIdle={sharedDockIdle}
                    // Phase 32 (chunk 2d) — canvas page drag and drop is a
                    // Multi Mode feature: the hover grip and the page drop
                    // targets exist only while the mode is on. Single mode
                    // passes null, so the canvas renders exactly as before.
                    pageDrag={
                      multiMode.enabled
                        ? { tabId: meta.id, onDrop: onPageDrop }
                        : null
                    }
                  />
                )}
              </OutlineEditorContext.Provider>
            );
            // Phase 52 (feature B) — an encrypted document keeps every tool
            // enabled; the banner only reports the encryption state.
            const protection = protectionByTab[meta.id];
            // Phase 53 (feature I) — the conversion card for an imported tab.
            // Dismissing deletes the entry, so it never returns for that tab.
            const conversion = convertNotices[meta.id];
            // Phase 56 (features A / C) — the NON-dismissible source format.
            // It survives dismissing the card above, so the reader trigger
            // stays reachable (standing rule 1: a capability that can be
            // dismissed away is unreachable).
            const sourceFormat = sourceFormatByTab[meta.id];
            // Phase 54 (features D + E) — the validation report card for a tab
            // that ran a validation or whose save was blocked/warned. Dismissing
            // deletes the entry, so it never returns for that tab.
            const validation = validationNotices[meta.id];
            // Phase 57 (feature A) — this tab's 3D content, keyed by its own
            // engine doc id (so a Multi Mode background pane shows its own).
            const tabEngineDocId = openTabs[meta.id]?.session.engineDocId;
            const pdf3d =
              tabEngineDocId !== undefined ? content3dByDoc[tabEngineDocId] ?? [] : [];
            if (
              protection === undefined &&
              conversion === undefined &&
              validation === undefined &&
              sourceFormat === undefined &&
              pdf3d.length === 0
            ) {
              return document;
            }
            return (
              <DocumentSurfaceColumn
                document={document}
                sourceFormat={sourceFormat}
                conversion={conversion}
                validation={validation}
                protection={protection}
                pdf3d={pdf3d}
                onDismissConversion={(): void =>
                  setConvertNotices((prev) => {
                    if (!(meta.id in prev)) return prev;
                    const next = { ...prev };
                    delete next[meta.id];
                    return next;
                  })
                }
                onDismissValidation={(): void => dismissValidationNotice(meta.id)}
                onDismissProtection={(): void =>
                  setProtectionByTab((prev) => {
                    if (!(meta.id in prev)) return prev;
                    const next = { ...prev };
                    delete next[meta.id];
                    return next;
                  })
                }
                onOpenReadingView={openReadingView}
                onOpenComicView={openComicView}
              />
            );
          }}
        />
        </PageDragProvider>
        {/* Phase 36 (chunk 5 + 6) — the INSPECTOR. It replaces the retired
            All-tools palette as the workspace's right panel, so it is mounted
            whenever a real document is open. Phase 37 (items 3 + 6) — the
            panel is now MOUNTED even while collapsed so its own collapse control
            (next chunk) has a home; the ladder's rung 1 drives
            `inspectorCollapsedEffective`, which the .app-main attributes, the
            inset and the CSS all read. `data-tools-open` still reflects the
            EFFECTIVE visibility (`inspectorVisible`).

            The HOST owns the selection. Chunk 6 wires the LIVE selections:
            the active DocumentView publishes its text-object selection up
            (`inspectorTextSelection`), and the signature selection reads the
            host's armed-signature state — one source per kind, no duplicates.
            Every affordance routes through the SAME handler the toolbar /
            menu / dialog already uses — the Inspector owns no command. */}
        {inspectorOpen && activeTab !== null && tabs.activeId !== null && (
          <Inspector
            stage={activeStage}
            collapsed={inspectorCollapsedForBookView}
            // DEF-335 — the control's label follows the EFFECTIVE state, so a
            // click records the intent it shows: while the ladder forces the
            // collapse the control reads "Expand" and one click records the
            // expand preference (the surface then expands when the window
            // grows past the rung). At a ladder-idle width this is a plain
            // both-ways toggle. Phase 112 (chunk H): the preference persists.
            onToggleCollapsed={toggleInspectorCollapsed}
            selection={inspectorSelection}
            textPanel={inspectorTextPanel}
            signatureStyle={
              armedSignature === null
                ? null
                : armedSignature.source.kind === 'typed'
                  ? 'Typed'
                  : 'Drawn'
            }
            signatureHint={armedSignature === null ? null : 'Click a page to place'}
            pageCount={activeEngineUi?.state.pageCount ?? activeTab.session.doc.numPages}
            pageRotation={
              activeEngineUi?.state.rotations[
                Math.max(1, Math.floor(activeTab.persisted.currentPage)) - 1
              ] ?? null
            }
            // Phase 112 (TFL-854 C2) — the REAL page meta + the multi-select
            // scope. Unknown size/label reads "Not available"; a multi-page
            // selection names its scope and shows Mixed for differing values.
            pageSize={inspectorPageSize}
            pageLabel={inspectorPageLabel}
            pageSelection={activePageSelection}
            pageSizeMixed={inspectorPageMetaMixed.size}
            pageRotationMixed={inspectorPageMetaMixed.rotation}
            pageLabelMixed={inspectorPageMetaMixed.label}
            annotationCount={annotationHandlers(tabs.activeId).annotations.length}
            formFieldCount={activeTab.forms.fields.length}
            formFillReport={activeTab.forms.report}
            fileSize={activeTab.session.fileSize}
            documentTitle={activeTab.displayName}
            onRenumberPages={onRenumberPagesClick}
            // Section 3A ruling 6 — the read-only "Annotations: N" count jumps
            // to REVIEW. The jump is the stage switch `set` on the FOCUSED pane
            // (`onStageChange` -> `dispatchStage({ type: 'set', pane: stagePane })`),
            // exactly like the Stage Rail's own buttons.
            onJumpToReview={(): void => onStageChange('review')}
            // Ruling 1 of the 3A cleanups — the annotations section is a
            // read-only count + the jump above: the list, its per-row jump/edit/
            // delete verbs and every other handler live in the REVIEW panel, so
            // the Inspector is handed no per-annotation callbacks at all.
            annotations={annotationHandlers(tabs.activeId).annotations}
            // Phase 90 (TFL-509-C1) — Ruling 6: the Inspector's REVIEW stage
            // re-parents the SAME unified review list. The annotations
            // handlers and the non-annotation sources/handlers are threaded
            // straight from App (the Inspector owns no command).
            onJumpToAnnotation={(page): void => jumpToReviewPage(page)}
            onEditAnnotation={(id, patch): void => {
              const tabId = activeTabIdRefLocal.current;
              if (tabId !== null) void onEditAnnotation(tabId, id, patch);
            }}
            onDeleteAnnotation={(id): void => {
              const tabId = activeTabIdRefLocal.current;
              if (tabId !== null) void onDeleteAnnotation(tabId, id);
            }}
            bates={batesList}
            watermarks={watermarkList}
            signatures={activeTab?.engine.signatures ?? []}
            onSelectReviewElement={onSelectReviewElement}
            onEditReviewElement={onEditReviewElement}
            onDeleteReviewElement={onDeleteReviewElement}
            reviewErrorFor={reviewErrorFor}
            onExportComments={onCommentExportClick}
            onImportComments={onCommentImportClick}
            // Phase 112 (C5) - the Deliver export surface prepares the format,
            // the parser-validated page scope, the output name and the options,
            // then launches the EXISTING flow. `exportBridge` carries the same
            // optional `window.tflex.export` guard the dock/palette read.
            exportFormat={settings.exportImageFormat ?? null}
            exportSourceName={activeTab.displayName}
            exportDpi={settings.exportImageDpi ?? DEFAULT_EXPORT_IMAGE_DPI}
            exportCurrentPage={Math.max(1, Math.floor(activeTab.persisted.currentPage))}
            exportBridge={{
              xlsx: hasExportXlsxBridge,
              pptx: hasExportPptxBridge,
            }}
            onExportRun={onInspectorExportRun}
            onExport={onExportClick}
            // Phase 51 (item 10) — the OCR suspects view is re-parented into
            // the Inspector (the workspace's right panel). The B14 empty-tab
            // guard is preserved verbatim: the section only materializes
            // against a REAL document (`activeTab != null`).
            ocrSuspects={
              ocrSuspectsOpen && activeTab != null
                ? {
                    suspects:
                      ocrSuspectsByTab[activeTabIdRefLocal.current ?? ""] ?? [],
                    hasRun:
                      ocrRunByTab[activeTabIdRefLocal.current ?? ""] === true,
                    onNavigate: onSuspectNavigate,
                    onClose: onCloseOcrSuspects,
                  }
                : null
            }
          />
        )}

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
        sourceName={activeTab?.displayName}
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
          imageSeedFormat ?? settings.exportImageFormat ?? DEFAULT_EXPORT_IMAGE_FORMAT
        }
        initialDpi={
          imageSeed?.initialDpi ?? settings.exportImageDpi ?? DEFAULT_EXPORT_IMAGE_DPI
        }
        // Phase 112 (C5 follow-up, TFL-985) - the inspector's prepared range /
        // output name seed the SAME dialog; the dialog re-parses both.
        initialRange={imageSeed?.initialRange ?? null}
        initialOutputName={imageSeed?.initialOutputName ?? null}
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
        onSignaturesChanged={onSignaturesChanged}
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
        cancelOcr={cancelOcrForActiveTab}
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
        // Phase 52 (feature C) — saving an opened encrypted document
        // writes a decrypted copy; the dialog says so before the OS
        // picker opens.
        protectedDocument={
          tabs.activeId !== null && protectionByTab[tabs.activeId] !== undefined
        }
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
      {/* Phase 52 (feature A) — the password prompt for an encrypted open.
          Cancel clears the pending open (no half-open tab). */}
      <PasswordPromptDialog
        open={passwordPrompt.phase !== "idle"}
        target={passwordPrompt.target}
        error={passwordPrompt.error}
        busy={passwordPrompt.phase === "checking"}
        attempts={passwordPrompt.attempts}
        onSubmit={(password): void => {
          void onPasswordPromptSubmit(password);
        }}
        onCancel={onPasswordPromptCancel}
      />
      {/* Phase 52 (feature D) — the Create-encrypted dialog. Defaults are
          remembered WITHOUT a password. */}
      <EncryptDialog
        open={encryptOpen}
        defaults={normalizeEncryptDefaults(settings.encryptDefaults ?? DEFAULT_ENCRYPT_DEFAULTS)}
        busy={encryptBusy}
        onConfirm={(confirm): void => {
          void onEncryptConfirm(confirm);
        }}
        onClose={onCancelEncrypt}
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
        initialRange={textSeed?.initialRange ?? null}
        initialOutputName={textSeed?.initialOutputName ?? null}
        docId={activeTab?.session.engineDocId ?? null}
        engine={engineRef.current}
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
        initialRange={docxSeed?.initialRange ?? null}
        initialDpi={docxSeed?.initialDpi ?? null}
        initialOutputName={docxSeed?.initialOutputName ?? null}
        docId={activeTab?.session.engineDocId ?? null}
        engine={engineRef.current}
        onClose={onCancelDocxExport}
      />
      <OfficeExportDialog
        open={xlsxExportOpen}
        format="xlsx"
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        sourceName={activeTab?.displayName ?? "this document"}
        initialRange={xlsxSeed?.initialRange ?? null}
        initialDpi={xlsxSeed?.initialDpi ?? null}
        initialOutputName={xlsxSeed?.initialOutputName ?? null}
        docId={activeTab?.session.engineDocId ?? null}
        client={window.tflex.export as TFlexApiExport | undefined}
        runEngineExport={runExportPages}
        onConfirm={onXlsxExportConfirm}
        onClose={onCancelXlsxExport}
      />
      <OfficeExportDialog
        open={pptxExportOpen}
        format="pptx"
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        sourceName={activeTab?.displayName ?? "this document"}
        initialRange={pptxSeed?.initialRange ?? null}
        initialDpi={pptxSeed?.initialDpi ?? null}
        initialOutputName={pptxSeed?.initialOutputName ?? null}
        docId={activeTab?.session.engineDocId ?? null}
        client={window.tflex.export as TFlexApiExport | undefined}
        runEngineExport={runExportPages}
        onConfirm={onPptxExportConfirm}
        onClose={onCancelPptxExport}
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
      <WatermarkDialog
        open={watermarkOpen}
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
        onConfirm={(s, editId): void => {
          void onWatermarkConfirm(s, editId);
        }}
        onClose={onCancelWatermark}
        watermarks={watermarkList}
        busyWatermarkId={deletingWatermarkId}
        onDeleteWatermark={(id): void => {
          void onDeleteWatermark(id);
        }}
        editTarget={watermarkEditTarget ?? undefined}
      />
      <BatesDialog
        open={batesOpen}
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
        initialDefaults={batesDefaults}
        defaultFont={settings?.editDefaultFont ?? "Helvetica"}
        onConfirm={onBatesConfirm}
        onClose={onCancelBates}
        editTarget={batesEditTarget ?? undefined}
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
      <FillFromCsvDialog
        open={fillFromCsvOpen}
        pickCsvFile={pickCsvFile}
        runCsvFill={runCsvToFieldsForActiveTab}
        onApplied={onFillFromCsvApplied}
        onClose={(): void => setFillFromCsvOpen(false)}
      />
      <FormDataIoDialog
        open={formDataIo.open}
        mode={formDataIo.mode}
        pickFormDataFile={pickFormDataFile}
        runExport={runFormDataExport}
        runImport={runFormDataImport}
        onApplied={onFormDataIoApplied}
        onClose={(): void => setFormDataIo((s) => ({ ...s, open: false }))}
      />
      <ValidateDocumentDialog
        open={validateOpen}
        initialTarget={validationDefaults.target}
        initialOnViolation={validationDefaults.onViolation}
        runValidation={runValidationForActiveTab}
        onRememberDefaults={onValidationDefaultsChange}
        onClose={(): void => setValidateOpen(false)}
      />
      <SanitizeDialog
        open={sanitizeOpen}
        initialOptions={sanitizeOptions}
        runSanitize={runSanitizeForActiveTab}
        onOptionsChange={onSanitizeOptionsChange}
        onClose={(): void => setSanitizeOpen(false)}
      />
      <EngineeringLayersPanel
        open={engineeringLayersOpen}
        docId={activeEngineDocId ?? ""}
        layers={activeEngineDocId !== null ? layersByDoc[activeEngineDocId] ?? [] : []}
        setLayerVisibility={runLayerToggle}
        onStateApplied={onLayerStateApplied}
        refreshDocProxyFor={refreshActiveDocProxy}
        pushToast={pushToast}
        onClose={(): void => setEngineeringLayersOpen(false)}
      />
      <DocumentInfoDialog
        open={documentInfoOpen}
        metadata={activeEngineDocId !== null ? cadByDoc[activeEngineDocId] ?? null : null}
        layerCount={
          activeEngineDocId !== null ? (layersByDoc[activeEngineDocId] ?? []).length : 0
        }
        content3dCount={
          activeEngineDocId !== null ? (content3dByDoc[activeEngineDocId] ?? []).length : 0
        }
        onClose={(): void => setDocumentInfoOpen(false)}
      />
      <DeletePageDialog
        open={deletePageOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        currentPage={deletePageSeed ?? (() => {
          const id = activeTabIdRefLocal.current;
          if (id === null) return 1;
          const tab = openTabsRef.current[id];
          return tab ? Math.max(1, Math.floor(tab.persisted.currentPage)) : 1;
        })()}
        onConfirm={onDeletePageConfirm}
        onClose={onCancelDeletePage}
      />
      <BlankPagesDialog
        open={blankPagesOpen}
        totalPages={
          activeEngineUi?.state.pageCount ??
          activeTab?.session.doc.numPages ??
          0
        }
        threshold={blankThreshold}
        running={blankScanRunning}
        progress={blankScanProgress}
        measurements={blankScanMeasurements}
        report={blankScanReport}
        onThresholdChange={onChangeBlankThreshold}
        onRun={(): void => {
          void onRunBlankScan();
        }}
        onConfirm={onConfirmBlankScan}
        onClose={onCloseBlankPages}
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
      {/* Phase 53 (feature I) — the import progress affordance. Mounted once
       * for the whole window (a conversion runs before its tab exists), with
       * a cancel control addressed by the job id. */}
      {convertProgress !== null && (
        <ConversionProgress
          progress={convertProgress}
          onCancel={(docId): void => {
            window.tflex.convert?.cancel(docId);
          }}
        />
      )}
      <Toasts items={errorState.toasts} onDismiss={dismissToast} />
      {/* Phase 36 (chunk 4) — the Command Palette. Mounted once for the whole
       * window (so it works on the welcome screen and never doubles up in
       * Multi Mode); every row runs an EXISTING handler, and `Ctrl+Enter` pins
       * through the same `dockPins` writer the Action Dock uses. */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={(): void => setCommandPaletteOpen(false)}
        onRunTool={onPaletteRun}
        onPinTool={onDockPin}
        onUnpinTool={onDockUnpin}
        dockPins={dockPins}
        isToolPinned={isPaletteToolPinned}
        isStageDefault={isPaletteStageDefault}
        activeStage={activeStage}
        isToolEnabled={paletteToolEnabled}
        disabledReasonFor={paletteDisabledReason}
        toolUsage={settings.toolUsage}
        recentFiles={paletteRecents}
        onOpenRecent={onPaletteOpenRecent}
      />
      {/* Phase 56 (features A / C / D) — the ONE shared reading-view shell.
          The stored `readingDefaults` seed the session; the user can change
          font size / line height / theme / layout / fit / RTL in session. */}
      <ReadingView
        open={readingView !== null}
        mode={readingView?.mode ?? "epub"}
        title={activeTab?.meta.title ?? ""}
        sourcePath={activeTab?.meta.filePath ?? ""}
        defaults={settings.readingDefaults ?? DEFAULT_READING_DEFAULTS}
        onNotice={(kind, text): void =>
          pushToast(kind === "error" ? "error" : "info", text)
        }
        onClose={(): void => setReadingView(null)}
        comicPageCount={activeTab?.session.doc.numPages ?? 0}
        comicDoc={activeTab?.session.doc ?? null}
      />
      <AccountsDialog
        open={settings.accountsEnabled === true && accountsOpen}
        onClose={(): void => setAccountsOpen(false)}
        onStatusChange={(status, email, name): void => {
          const signedIn = status === "signed-in";
          // Preserve the boot-derived avatar URL across a sign-in/status echo;
          // a sign-out clears it. `null` name is "unknown" and flows through.
          setAccountStatus((prev) => ({
            signedIn,
            email,
            name,
            image: signedIn ? prev.image : null,
          }));
        }}
      />
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
        // DEF-213 — an absent themeDefault means the app boots on
        // the concrete `settings.theme`; show that, not 'dark'.
        themeDefault={settings.themeDefault ?? settings.theme}
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
        animationsEnabled={settings.animationsEnabled !== false}
        onSetAnimationsEnabled={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, {
              type: 'set-animations-enabled',
              value: next,
            });
            trackAndSave(updated);
            return updated;
          });
        }}
        convertDefaults={settings.convertDefaults ?? DEFAULT_CONVERT_DEFAULTS}
        onSetConvertDefaults={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated: AppSettings = { ...prev, convertDefaults: next };
            trackAndSave(updated);
            return updated;
          });
        }}
        // Phase 58 — the tab-strip style. Mirrors the onSetThemeDefault
        // shape: persist through the reducer, then save.
        tabStyle={settings.tabStyle ?? DEFAULT_TAB_STYLE}
        onSetTabStyle={(next): void => {
          setSettings((prev) => {
            if (prev === null) return prev;
            const updated = preferencesReducer(prev, { type: 'set-tab-style', value: next });
            trackAndSave(updated);
            return updated;
          });
        }}
      />
    </div>
  );
}