import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  AppSettings,
  FillFormFieldPayload,
  FormField,
  PdfOpenError,
  RecentFile,
  SampleDocument,
  SavedSignature,
  SignaturePlacement,
} from "../shared/types";
import type { TFlexApi } from "../shared/ipc";
import { Welcome } from "./components/Welcome";
import { AppHeader } from "./components/AppHeader";
import { Toasts, type Toast } from "./components/Toasts";
import { ToolsPalette } from "./components/ToolsPalette";
import { AboutDialog } from "./components/AboutDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { tabsReducer, initialTabsState, type TabMeta } from "./state/tabs";
import { applyTheme, nextTheme } from "./state/theme";
import { resolveInitialSettings } from "./state/settings";
import {
  DEFAULT_RECENTS_CAP,
  preferencesReducer,
} from "./state/preferences";
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
import { removeRecent } from "./state/recentFiles";
import { getEngine } from "./engine/engineClient";
import { MergeDialog } from "./components/MergeDialog";
import { SplitDialog } from "./components/SplitDialog";
import { SignatureManagerModal } from "./signatures/SignatureManagerModal";
import { FlattenConfirmDialog } from "./forms/FlattenConfirmDialog";
import type { EngineApi, EngineOp, EngineState } from "./engine/types";
import type { Annotation, AnnotationPatch } from "./annotations/model";
import { describeEngineError } from "./engine/types";
import { stubRendererEngine } from "./engine/stubEngine";
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

/** Coalesce rapid settings writes from the theme toggle so each click does not
 *  trigger its own settings.json rename. The theme itself flips immediately;
 *  only the persistence is debounced. */
const SETTINGS_PERSIST_DEBOUNCE_MS = 300;

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
  // Phase 6 — Tools palette state, About dialog, Preferences dialog.
  // Layout persists via settings.toolsPaletteLayout; open/close is
  // session-only. The toolbar's Tools button toggles the palette and
  // Ctrl+Shift+P from the menu does the same.
  const [toolsPaletteOpen, setToolsPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
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

  const debouncedPersistRef = useRef<ReturnType<typeof createDebouncer<[AppSettings]>>>(
    createDebouncer<[AppSettings]>(
      (s) => {
        void window.tflex.saveSettings(s);
      },
      SETTINGS_PERSIST_DEBOUNCE_MS,
    ),
  );
  const debouncedPersist = debouncedPersistRef.current;

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const b = await bootSettings();
      if (cancelled) return;
      setBootstrap(b);
      setSettings(b.settings);
      applyTheme(b.settings.theme);
      setBootDone(true);
    })();
    const unsubscribe = window.tflex.settings.changed((s) => {
      setSettings(s);
      applyTheme(s.theme);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      debouncedPersist.flush();
    };
  }, []);

  const onToggleTheme = useCallback((): void => {
    setSettings((prev) => {
      if (prev === null) return prev;
      const next: AppSettings = { ...prev, theme: nextTheme(prev.theme) };
      applyTheme(next.theme);
      debouncedPersist(next);
      return next;
    });
  }, [debouncedPersist]);

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
      const existing = openTabsRef.current[tabId];
      if (existing !== undefined && existing.meta.modified !== ui.state.modified) {
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
      const id = crypto.randomUUID();
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
            void window.tflex.saveSettings(next);
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
    [openFromBytes, pushToast, settings, toastForPdfError],
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
      void window.tflex.saveSettings(next);
    },
    [settings],
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

  const onSaveAs = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = openTabsRef.current[tabId];
      if (tab === undefined) return;
      // Renderer policy:
      //   - cancelled   -> user dismissed the OS save dialog; stay quiet.
      //   - write-error -> real failure (EPERM, locked disk, full disk).
      //                    Surface as an error toast.
      //   - anything else -> generic engine failure; surface it too.
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

  // Phase 6 — native application menu. The backend builds the menu
  // (see src/main/menu.ts) and dispatches every action over IPC as
  // a single 'menu:action' channel carrying { action: string }. We
  // route each action into the same single-source handler the
  // toolbar / keyboard accelerator already use, so the menu is a
  // thin dispatch surface — no business logic lives here.
  useEffect(() => {
    type MenuAction =
      | 'open'
      | 'merge'
      | 'save'
      | 'saveAs'
      | 'closeTab'
      | 'undo'
      | 'redo'
      | 'toggleTheme'
      | 'zoomIn'
      | 'zoomOut'
      | 'fitWidth'
      | 'fitPage'
      | 'showToolsPalette'
      | 'about'
      | 'preferences';

    const onMenuAction = (e: Event): void => {
      const detail = (e as CustomEvent<{ action: string }>).detail;
      const action = detail?.action as MenuAction | undefined;
      if (action === undefined) return;
      switch (action) {
        case 'open':
          void onOpenClick();
          return;
        case 'merge':
          setMergeOpen(true);
          return;
        case 'save':
          if (tabsRef.current.activeId !== null) {
            void onSave(tabsRef.current.activeId);
          }
          return;
        case 'saveAs':
          if (tabsRef.current.activeId !== null) {
            void onSaveAs(tabsRef.current.activeId);
          }
          return;
        case 'closeTab':
          if (tabsRef.current.activeId !== null) {
            closeTab(tabsRef.current.activeId);
          }
          return;
        case 'undo':
          if (tabsRef.current.activeId !== null) {
            void onUndo(tabsRef.current.activeId);
          }
          return;
        case 'redo':
          if (tabsRef.current.activeId !== null) {
            void onRedo(tabsRef.current.activeId);
          }
          return;
        case 'toggleTheme':
          onToggleTheme();
          return;
        case 'showToolsPalette':
          setToolsPaletteOpen((v) => !v);
          return;
        case 'about':
          setAboutOpen(true);
          return;
        case 'preferences':
          setPrefsOpen(true);
          return;
        // Zoom / fitWidth / fitPage are handled by DocumentView
        // internally — the menu action is just a shortcut into the
        // same keyboard accelerator DocumentView already listens for.
        case 'zoomIn':
        case 'zoomOut':
        case 'fitWidth':
        case 'fitPage':
          return;
      }
    };
    window.addEventListener('menu:action', onMenuAction);
    return (): void => {
      window.removeEventListener('menu:action', onMenuAction);
    };
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenClick, closeTab, onSave, onUndo, onRedo, tabs.activeId]);

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
                    onToast={pushToast}
                    engineState={engine.engineState}
                    modified={engine.engineState.modified}
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
                      setSettings((prev) => {
                        if (prev === null) return prev;
                        return { ...prev, annotationColors: next };
                      });
                      debouncedPersist({ ...settings, annotationColors: next });
                    }}
                    themeName={settings.theme}
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
                debouncedPersist(updated);
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
            onClose={(): void => setToolsPaletteOpen(false)}
            documentRequired={activeTab !== null}
            hasFormFields={(activeTab?.forms.fields.length ?? 0) > 0}
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
      <Toasts items={errorState.toasts} onDismiss={dismissToast} />
      <AboutDialog open={aboutOpen} onClose={(): void => setAboutOpen(false)} />
      <PreferencesDialog
        open={prefsOpen}
        onClose={(): void => setPrefsOpen(false)}
        themeDefault={settings.themeDefault ?? 'dark'}
        recentsCap={settings.recentsCap ?? DEFAULT_RECENTS_CAP}
        onSetThemeDefault={(next): void => {
          const updated = preferencesReducer(settings, { type: 'set-theme-default', value: next });
          setSettings(updated);
          debouncedPersist(updated);
        }}
        onSetRecentsCap={(next): void => {
          const updated = preferencesReducer(settings, { type: 'set-recents-cap', value: next });
          setSettings(updated);
          debouncedPersist(updated);
        }}
      />
    </div>
  );
}