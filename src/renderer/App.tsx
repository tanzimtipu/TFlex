import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
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
} from "../shared/types";
import type { TFlexApi } from "../shared/ipc";
import { Welcome } from "./components/Welcome";
import { AppHeader } from "./components/AppHeader";
import { Toasts, type Toast } from "./components/Toasts";
import { ToolsPalette } from "./components/ToolsPalette";
import { AboutDialog } from "./components/AboutDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { tabsReducer, initialTabsState, resolveOpenId, type TabMeta } from "./state/tabs";
import { applyTheme, nextTheme } from "./state/theme";
import { resolveInitialSettings } from "./state/settings";
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
} from "./state/preferences";
import { applyAnnotationPaletteChange } from "./state/colorPalette";
import { dispatchMenuAction, type MenuActionContext } from "./state/menuActions";
import { shouldApplyEcho } from "./state/settingsEcho";
import { openPdfDocument, readOutline, type OutlineNode } from "./pdf/pdfjs";
import {
  DocumentView,
  type DocDiagnostics,
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
import type { Annotation, AnnotationPatch } from "./annotations/model";
import { describeEngineError } from "./engine/types";
import { stubRendererEngine } from "./engine/stubEngine";
import {
  editReducer,
  initialEditState,
  type EditAction,
  type EditState,
  type EditTextStyle,
} from "./edit/model";
import {
  defaultImageDecoder,
  defaultImageEncoder,
  resizeImageToBytes,
  cropImageToBytes,
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

export function App(): ReactElement {
  const [bootDone, setBootDone] = useState(false);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
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
  // Phase 10 — Edit-content mode. The toolbar shows the Edit
  // button; clicking it (or pressing the menu shortcut) toggles
  // this. When on, the per-page EditOverlay becomes pointer-active
  // and the EditToolbar appears above the document area. The
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
  // Page the user last clicked while the Sign tool was armed. We use
  // this to scroll-to-page in the placement flow so the click target is
  // visible (DocumentView's overlay catches the pointerdown and places
  // the signature in place without further page-change logic).

  const engineRef = useRef<EngineApi>(getEngine());

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
  // Menu-action handler reads the latest tabs / active id without
  // re-subscribing on every change. Mirrors the openTabsRef pattern
  // above so the listener doesn't churn.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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
      applyTheme(b.settings.theme);
      setBootDone(true);
    };
    runBoot();
    const unsubscribe = window.tflex.settings.changed((s) => {
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
      applyTheme(s.theme);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const onToggleTheme = useCallback((): void => {
    setSettings((prev) => {
      if (prev === null) return prev;
      const next: AppSettings = { ...prev, theme: nextTheme(prev.theme) };
      applyTheme(next.theme);
      trackAndSave(next);
      return next;
    });
  }, [trackAndSave]);

  const pushToast = useCallback((kind: Toast["kind"], text: string): void => {
    dispatchError({ type: "push", toast: { kind, text } });
  }, []);
  const dismissToast = useCallback((id: number): void => {
    dispatchError({ type: "dismiss", id });
  }, []);

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
      // DEF-041 follow-up — read the canonical `modified` flag from
      // the tabs reducer (which the AppHeader reads), NOT from
      // openTabs.meta.modified. The two used to be kept in sync by
      // every caller of setEngineUiFor setting openTabs.meta.modified
      // alongside, but the pre-Phase-8 callers didn't always do
      // that (only onConfirmOptimize did). That left openTabs.meta
      // stuck at `false`, which made the equality guard below
      // return false for subsequent ops — so a save that flipped
      // engineUi.state.modified to false wouldn't dispatch the
      // corresponding set-modified, and the AppHeader kept showing
      // the dot as modified even after Ctrl+S. The tabs reducer
      // IS authoritative for the header; the openTabs.meta field
      // is the engine-state side of the same flag and doesn't need
      // its own copy here. The openTabs.meta.modified value is
      // best-effort and only consumed by tflexDiagnostics (the
      // `tabModified` field), which intentionally reads from
      // tabs2[activeId]?.meta.modified (the tabs reducer's view)
      // instead — see `tflexDiagnostics` near the bottom of this
      // file.
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
      setOpenTabs((prev) => ({
        ...prev,
        [id]: {
          meta,
          session,
          persisted,
          displayName: source.displayName,
          engine: initialUiState(parsed.doc.numPages).state,
          forms: initialFormsState,
          placements: [],
          edit: initialEditState,
        },
      }));
      setEngineUi((prev) => ({
        ...prev,
        [id]: initialUiState(parsed.doc.numPages),
      }));
      dispatchTabs({ type: "open", tab: meta });

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

  const closeTab = useCallback((id: string): void => {
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
    dispatchTabs({ type: "close", id });
  }, []);

  const activateTab = useCallback((id: string): void => {
    dispatchTabs({ type: "activate", id });
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
  }, []);

  const onPersist = useCallback((tabId: string, viewer: PersistedViewer): void => {
    setOpenTabs((prev) => {
      const existing = prev[tabId];
      if (existing === undefined) return prev;
      return { ...prev, [tabId]: { ...existing, persisted: viewer } };
    });
  }, []);

  // ---- engine ops ----
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
      });
    },
    [pushToast, setEngineUiFor],
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
      });
    },
    [pushToast, setEngineUiFor],
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
      const result = await engineRef.current.createAnnotation(open.session.engineDocId, ann);
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
    },
    [pushToast, noteOpApplied],
  );

  const onEditAnnotation = useCallback(
    async (tabId: string, id: string, patch: AnnotationPatch): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
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
    [pushToast, noteOpApplied],
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
      setArmedSignatureId(null);
    },
    [pushToast, noteOpApplied],
  );

  const moveSignature = useCallback(
    async (tabId: string, placementId: string, rect: SignaturePlacement["rect"]): Promise<void> => {
      const open = openTabsRef.current[tabId];
      if (open === undefined) return;
      const result = await engineRef.current.moveSignature(open.session.engineDocId, placementId, rect);
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
   *  re-open and pick up where they left off. */
  const setEditMode = useCallback((open: boolean): void => {
    setEditModeOpen(open);
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

  /** Commit a text-run edit. Calls `engine.editTextRun`; the
   *  engine masks the rect and draws the new text at the rect's
   *  top-left. */
  const handleEditTextRun = useCallback(
    async (tabId: string, args: {
      rect: { x: number; y: number; width: number; height: number };
      newText: string;
      style: EditTextStyle;
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
      });
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(tabId, result.value);
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
      const result = await engineRef.current.addTextBox(open.session.engineDocId, {
        page: currentPageOfTab(tabId, openTabsRef),
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
    window.addEventListener("tflex:sign-button", onSignButton);
    window.addEventListener("tflex:flatten-button", onFlattenButton);
    return (): void => {
      window.removeEventListener("tflex:sign-button", onSignButton);
      window.removeEventListener("tflex:flatten-button", onFlattenButton);
    };
  }, [armedSignatureId]);

  const onSigManagerApply = useCallback((signatureId: string): void => {
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
    pushToast("info", "Form fields flattened.");
  }, [pushToast, noteOpApplied]);

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

  // ---- save / save-as ----
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
  useEffect(() => {
    const ctx: MenuActionContext = {
      open: (): void => {
        void onOpenClick();
      },
      merge: (): void => {
        setMergeOpen(true);
      },
      save: (): void => {
        const activeId = tabsRef.current.activeId;
        if (activeId !== null) {
          void onSave(activeId);
        }
      },
      saveAs: (): void => {
        const activeId = tabsRef.current.activeId;
        if (activeId !== null) {
          void onSaveAs(activeId);
        }
      },
      closeTab: (): void => {
        const activeId = tabsRef.current.activeId;
        if (activeId !== null) {
          closeTab(activeId);
        }
      },
      undo: (): void => {
        const activeId = tabsRef.current.activeId;
        if (activeId !== null) {
          void onUndo(activeId);
        }
      },
      redo: (): void => {
        const activeId = tabsRef.current.activeId;
        if (activeId !== null) {
          void onRedo(activeId);
        }
      },
      toggleTheme: (): void => {
        onToggleTheme();
      },
      showToolsPalette: (): void => {
        setToolsPaletteOpen((v) => !v);
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
    };
    const unsubscribe = window.tflex.menu.onAction((action) => {
      dispatchMenuAction(action, ctx);
    });
    return unsubscribe;
  }, [
    onOpenClick,
    onSave,
    onSaveAs,
    closeTab,
    onUndo,
    onRedo,
    onToggleTheme,
  ]);

  // ---- merge / split dialogs ----
  const onMergeClick = useCallback((): void => {
    setMergeOpen(true);
  }, []);

  const onCancelMerge = useCallback((): void => {
    setMergeOpen(false);
  }, []);

  const onConfirmMerge = useCallback(
    async (choice: { otherPath: string; position: "before" | "after" }): Promise<void> => {
      const activeId = activeTabIdRefLocal.current;
      setMergeOpen(false);
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      const result = await engineRef.current.merge(
        open.session.engineDocId,
        [choice.otherPath],
        choice.position,
      );
      if (!result.ok) {
        pushToast("error", describeEngineError(result.error.code, result.error.message));
        return;
      }
      noteOpApplied(activeId, result.value);
    },
    [pushToast, noteOpApplied],
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

  const onPickMergeFile = useCallback(async (): Promise<string | null> => {
    return window.tflex.openFileDialog();
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

  /** DOCX assembly — runs after the renderer has rasterised every
   *  page to PNG. The renderer owns the rasterization step; the
   *  engine just assembles the .docx ZIP. */
  const runAssembleDocx = useCallback(
    async (
      entries: DocxImageEntry[],
    ): Promise<Uint8Array | { error: string }> => {
      const result = await engineRef.current.createDocxFromImages(entries);
      if (!result.ok) {
        return { error: describeEngineError(result.error.code, result.error.message) };
      }
      return result.value;
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
        res = await engineRef.current.insertBlankPage(
          open.session.engineDocId,
          choice.position,
          width,
          height,
        );
      } else {
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
   *  `armedStamp` and wait for the next page click to place it. */
  const onStampClick = useCallback((): void => {
    if (activeTabIdRefLocal.current === null) return;
    setStampOpen(true);
  }, []);

  const onCancelStamp = useCallback((): void => {
    setStampOpen(false);
  }, []);

  const onStampConfirm = useCallback(
    async (choice: {
      stampId: StampId;
      pngBytes: Uint8Array;
      pngWidth: number;
      pngHeight: number;
      page: number;
    }): Promise<void> => {
      setStampOpen(false);
      const activeId = activeTabIdRefLocal.current;
      if (activeId === null) return;
      const open = openTabsRef.current[activeId];
      if (open === undefined) return;
      // Look up the picked page's dimensions so the stamp lands
      // centered. Falls back to US Letter for unknown pages (the
      // dialog should always supply a valid page; the fallback is
      // defensive against a stale dialog render).
      const size = activePageSizes[choice.page] ?? {
        widthPt: 612,
        heightPt: 792,
      };
      const aspect =
        choice.pngHeight === 0
          ? 1
          : choice.pngWidth / choice.pngHeight;
      const targetHeightPt = Math.min(80, size.heightPt * 0.12);
      const targetWidthPt = Math.max(
        120,
        Math.min(size.widthPt * 0.4, targetHeightPt * aspect),
      );
      const rect = {
        x: (size.widthPt - targetWidthPt) / 2,
        y: (size.heightPt - targetHeightPt) / 2,
        width: targetWidthPt,
        height: targetHeightPt,
      };
      const res = await engineRef.current.addStamp?.(
        open.session.engineDocId,
        {
          page: choice.page,
          rect,
          stampId: choice.stampId,
          name: choice.stampId,
          pngBytes: choice.pngBytes,
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
      pushToast(
        "info",
        `Placed ${choice.stampId} stamp on page ${choice.page}.`,
      );
    },
    [activePageSizes, noteOpApplied, pushToast],
  );

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
      return true;
    },
    [pushToast, toastForPdfError],
  );

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
        // helper the dialog uses, then send to the engine.
        const pageImages = await rasterizePagesForOcr({
          doc,
          pages,
          dpi: downsample,
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
      setOpenTabs((prev) => {
        if (prev[tabId] === undefined) return prev;
        return prev;
      });
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
        createAnnotation: (a: Annotation) => void;
        editAnnotation: (id: string, patch: AnnotationPatch) => void;
        deleteAnnotation: (id: string) => void;
      }
    >();
    return (tabId: string) => {
      const cached = cache.get(tabId);
      const ui = engineUi[tabId];
      const annotations: Annotation[] = ui?.state.annotations ?? [];
      if (cached !== undefined && cached.annotations === annotations) {
        return cached;
      }
      const out = {
        annotations,
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
  }, [engineUi, onCreateAnnotation, onEditAnnotation, onDeleteAnnotation]);

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
        }) => void;
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
        }): void => {
          void handleEditTextRun(tabId, args);
        },
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
  ]);

  activeTabIdRefLocal.current = tabs.activeId;

  const w = window as unknown as { tflexDiagnostics: () => unknown };
  w.tflexDiagnostics = (): unknown => {
    const activeId = activeTabIdRefLocal.current;
    const tabs2 = openTabsRef.current;
    const ui = engineUiRef.current;
    const tab = activeId !== null ? tabs2[activeId] ?? null : null;
    const livePageCount = tab?.session.doc.numPages ?? 0;
    const enginePageCount = activeId !== null ? ui[activeId]?.state.pageCount : null;
    const pageCount =
      enginePageCount !== null && enginePageCount !== undefined
        ? enginePageCount
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
    return {
      pageCount,
      currentPage,
      zoom,
      mode,
      theme: settingsRef.current?.theme ?? "dark",
      openTabs: Object.keys(tabs2).length,
      activeTabId: activeId,
      activeDocBytes: tab?.session.fileSize ?? 0,
      searchQuery,
      searchHits,
      searchIndexProgress: searchIndexProgressRef.current,
      sampleCount,
      recovered: bootstrapRef.current?.recovered ?? false,
      engineAvailable: engineRef.current.available,
      // Convenience top-level mirror of the active tab's engine modified
      // flag, so QA harnesses don't have to dig into engineState.modified.
      modified: activeId !== null ? ui[activeId]?.state.modified ?? false : false,
      // Full engine state for the active tab — exposed via the QA hook
      // so e2e harnesses can verify rotate / delete / reorder / undo
      // behaviour without scraping the DOM.
      engineState: activeId !== null ? ui[activeId]?.state ?? null : null,
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
      engineDocId: tab?.session.engineDocId ?? null,
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
    };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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
  }, [onOpenClick, closeTab, onSave, onUndo, onRedo, onOcrClick, tabs.activeId]);

  useEffect(() => {
    let cancelled = false;
    void window.tflex.listSamples().then((list) => {
      if (!cancelled) setSampleCount(list.length);
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

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

  /** True when the active tab is an empty placeholder (no document).
   *  The renderer mounts the Welcome screen instead of a DocumentView
   *  so the user has somewhere to drop a PDF. */
  const activeIsEmpty = tabs.activeId !== null
    && tabs.tabs.find((t) => t.id === tabs.activeId)?.kind === 'empty';

  const activeTab = tabs.activeId !== null ? openTabs[tabs.activeId] : null;
  const activeEngineUi = tabs.activeId !== null ? engineUi[tabs.activeId] : null;

  if (!bootDone || settings === null) {
    return (
      <div className="app">
        <div className="app-main" />
        <Toasts items={[]} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <div className="app">
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
        onToggleTheme={onToggleTheme}
        onOpen={onOpenClick}
        onNewEmptyTab={onNewEmptyTab}
      />
      <div className="app-main">
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
                samplesResolver={async (): Promise<SampleDocument[]> =>
                  window.tflex.listSamples()
                }
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
                    doc={open.session.doc}
                    pageCount={open.session.doc.numPages}
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
                    modified={saveModified}
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
                    annotations={ann.annotations}
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
                    toolsPaletteOpen={toolsPaletteOpen}
                    onToolsPaletteToggle={(): void => setToolsPaletteOpen((v) => !v)}
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
                    editModeOpen={editModeOpen}
                    onEditModeToggle={(): void => setEditMode(!editModeOpen)}
                    edit={editModeOpen ? editHandlers(meta.id) : null}
                  />
                </div>
              );
            })
          )}
        </div>
        {toolsPaletteOpen && (
          <ToolsPalette
            layout={settings.toolsPaletteLayout ?? 'list'}
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
            onExtract={(): void => setSplitOpen(true)}
            onRotate={(): void => {
              // No-op stub: rotate happens per-page in the rail.
              // The palette keeps the entry visible so the user can
              // discover the rail action via the same label.
            }}
            onDelete={(): void => {
              // Same — delete lives on the rail selection.
            }}
            onSign={(): void => {
              if (armedSignatureId !== null) {
                setArmedSignatureId(null);
              } else {
                setSigModalOpen(true);
              }
            }}
            onForms={(): void => setFlattenOpen(true)}
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
            onOcrSuspects={(): void => setOcrSuspectsOpen(true)}
            onReplacePages={onReplacePagesClick}
            onRenumberPages={onRenumberPagesClick}
            onCropPages={onCropPagesClick}
            onStamp={onStampClick}
            onExportComments={onCommentExportClick}
            onImportComments={onCommentImportClick}
            hasOcrSuspects={Object.values(ocrRunByTab).some(Boolean)}
            onClose={(): void => setToolsPaletteOpen(false)}
            documentRequired={activeTab !== null}
            hasFormFields={(activeTab?.forms.fields.length ?? 0) > 0}
          />
        )}
        {ocrSuspectsOpen && activeTabIdRefLocal.current !== null && (
          <OcrSuspectsPanel
            suspects={
              ocrSuspectsByTab[activeTabIdRefLocal.current] ?? []
            }
            hasRun={ocrRunByTab[activeTabIdRefLocal.current] === true}
            onNavigate={onSuspectNavigate}
            onClose={onCloseOcrSuspects}
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
        optimizePreset={settings.optimizePreset}
        // DEF-040 — the linearize checkbox writes through the same
        // preferences reducer the Optimize dialog uses. ON writes
        // preset='none' (linearized output), OFF writes preset='compact'
        // (default compression). The reducer is idempotent so a same-
        // value toggle no-ops.
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
      <Toasts items={errorState.toasts} onDismiss={dismissToast} />
      <AboutDialog open={aboutOpen} onClose={(): void => setAboutOpen(false)} />
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