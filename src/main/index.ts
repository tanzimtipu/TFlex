import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import type {
  AppSettings,
  AddStampPayload,
  AddTextBoxPayload,
  CreateAnnotationPayload,
  CropEntry,
  DocxImageEntry,
  EditAnnotationPayload,
  EditImagePayload,
  EditTextRunPayload,
  ExportPagesPayload,
  FillFormFieldPayload,
  MenuEnabledState,
  MovePagesBetweenDocsPayload,
  MoveSignaturePayload,
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  OpEntry,
  OptimizePreset,
  PageLabelEntry,
  PlaceSignaturePayload,
  PrintJobPayload,
  RecentFile,
  TextBoxStylePatch,
  WatermarkInfo,
  WatermarkSettings,
} from '../shared/types';
import type { SignatureSource } from '../shared/types';
import { openPdfDialog, savePdfDialog } from './services/dialog';
import { EngineService } from './services/engine';
import { OcrService } from './services/ocr';
import { loadPdfFile, loadFdfFile } from './services/pdf-file';
import { listPrinters, printJob } from './services/print';
import { setBundledFontDir } from './services/fonts';
import { SamplesService } from './services/samples';
import { DEFAULT_SETTINGS, SettingsService } from './services/settings';
import { SignatureService } from './services/signature-service';
import { UpdateService } from './services/update-service';
import { applyMenuEnabledState, buildAppMenu } from './menu';
import { createMainWindow } from './window';
import { closePrintWindow, notifyPrintDocumentGone, openPrintWindow } from './print-window';
import { extractFileArgument, looksLikePdfPath } from './open-path';

function mainModuleDir(): string {
  return __dirname;
}

// Test harness: export start() so unit tests can call it directly.
// In production the module-level init below calls start() automatically;
// during vitest runs that block is skipped and the test drives start().
const _isVitest = typeof process !== 'undefined' && process.env.VITEST === 'true';

// Phase 35 — paths the OS handed us (launch argv or a second instance) that
// arrived before the renderer was ready to receive them. Flushed once the
// window's webContents finishes loading (see createWindow below).
const pendingOpenPaths: string[] = [];

// DEF-300 — the main application window, held explicitly. An OS file-open is
// routed to THIS window, never to "whichever window is first" in
// getAllWindows(): with the standalone print window open, index 0 is the
// PRINT window, which does not subscribe to open-path requests, so the event
// was silently discarded.
let mainWindow: BrowserWindow | null = null;

// DEF-300 — set by start() once createWindow exists. A request that arrives
// with no live main window (a launch race before the window was created, or
// the window was closed while a print window kept the app alive) recreates a
// main window and the queued path is delivered on its did-finish-load.
let recreateMainWindow: (() => void) | null = null;

/** Flush paths queued before the main window's renderer was ready. */
function flushPendingOpenPaths(win: BrowserWindow): void {
  for (const path of pendingOpenPaths.splice(0)) {
    win.webContents.send(IPC.appOpenPathRequestEvent, path);
  }
}

/**
 * DEF-300 — deliver a validated OS-open request to the MAIN window, or queue
 * it. The main window is targeted by explicit reference, never by window
 * index, so the print window can never receive (or swallow) the request.
 *
 * Rules:
 * - A live, loaded main window receives the request immediately, even when a
 *   different window (the print window) is focused.
 * - A live but still-loading main window queues the request; it is flushed on
 *   did-finish-load.
 * - No live main window (startup race, or closed while a print window kept
 *   the app alive): queue the request and recreate the main window — never a
 *   silent no-op and never a delivery to a non-main window.
 *
 * Exported for the unit tests (the second-instance/second-launch path is not
 * registered under vitest, so the routing is driven directly there).
 */
export function sendOpenPath(path: string): void {
  const win = mainWindow;
  if (win === null || win.isDestroyed()) {
    pendingOpenPaths.push(path);
    // When start() has not reached createWindow yet the imminent window will
    // flush the queue; otherwise recreate the main window for the document.
    if (recreateMainWindow !== null) {
      recreateMainWindow();
    }
    return;
  }
  if (win.webContents.isLoading()) {
    pendingOpenPaths.push(path);
    return;
  }
  win.webContents.send(IPC.appOpenPathRequestEvent, path);
}

/**
 * Phase 35 — validate an OS-supplied path and hand it to the renderer's
 * existing open flow. Fails LOUD (an error box) for a non-PDF path or a
 * file that is not a readable PDF, rather than silently ignoring the launch.
 */
async function handleOsOpenPath(path: string): Promise<void> {
  if (!looksLikePdfPath(path)) {
    dialog.showErrorBox('Cannot open file', `TFlex is a PDF app and cannot open:\n${path}`);
    return;
  }
  const check = await loadPdfFile(path);
  if (!check.ok) {
    dialog.showErrorBox('Cannot open PDF', `Could not open:\n${path}\n\n(${check.error})`);
    return;
  }
  sendOpenPath(path);
}

if (!_isVitest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    // Phase 35 — a second launch (e.g. double-clicking another PDF in
    // Explorer) focuses the running window AND opens the file it was
    // handed, instead of being ignored. The argv shape matches the launch
    // argv, so the same parser extracts the path.
    app.on('second-instance', (_event, argv) => {
      // DEF-300 — focus the MAIN window, not getAllWindows()[0] (which is the
      // print window while it is open).
      const win = mainWindow;
      if (win !== null && !win.isDestroyed()) {
        if (win.isMinimized()) {
          win.restore();
        }
        win.focus();
      }
      const path = extractFileArgument(argv, app.isPackaged);
      if (path !== null) {
        void handleOsOpenPath(path);
      }
    });
    void start();
  }
}

export async function start(): Promise<void> {
  await app.whenReady();

  // Phase 6: build the application menu. The menu sends actions to the
  // focused window's renderer via IPC, where the same handlers as toolbar
  // buttons pick them up.
  buildAppMenu({
    sendToFocused(_action: string, ...args: unknown[]): void {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (win !== undefined && !win.isDestroyed()) {
        win.webContents.send(IPC.menuActionEvent, ...args);
      }
    },
    // Phase 30 — File > Print / Ctrl+P pushes the dedicated print:request
    // event (not a menu:action) so the renderer opens its print dialog.
    sendPrintRequest(): void {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (win !== undefined && !win.isDestroyed()) {
        win.webContents.send(IPC.printRequestEvent);
      }
    },
  });

  // DEF-065 — renderer -> main: toggle named menu items' enabled state so
  // the native menu reflects doc-open / undo-stack / modified state. Uses
  // `on` (not handle) because the renderer fire-and-forgets; main applies
  // the partial map via applyMenuEnabledState, which is a no-op when no
  // application menu is set.
  ipcMain.on(IPC.menuSetEnabled, (_event, state: MenuEnabledState) => {
    applyMenuEnabledState(state);
  });

  // Phase 30 — print. The renderer asks for the OS printer list (via the
  // invoking webContents, since getPrintersAsync lives on it), then hands the
  // composed page images + settings to the hidden-window print pipeline.
  // printJob never rejects: a failure resolves with a reason for the dialog.
  ipcMain.handle(IPC.printListPrinters, (event) => listPrinters(event.sender));
  ipcMain.handle(IPC.printJob, (_event, payload: PrintJobPayload) => printJob(payload));

  const broadcast = (settings: AppSettings): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.settingsChangedEvent, settings);
      }
    }
  };

  // DEF-230 — a failed settings write no longer rejects the IPC call; the
  // renderer learns about it here instead.
  const broadcastWriteError = (message: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.settingsWriteErrorEvent, message);
      }
    }
  };

  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'), broadcast, broadcastWriteError);
  const samples = new SamplesService(join(app.getAppPath(), 'assets', 'samples'));
  // Phase 11 — OCR runs tesseract.js with language data loaded from the
  // bundled `assets/tessdata` directory so recognition is fully offline.
  // The directory is resolved from the app root (`assets/tessdata`) in both
  // dev and packaged builds (electron-builder ships `assets/**`).
  const ocr = new OcrService(join(app.getAppPath(), 'assets', 'tessdata'));
  // Phase 27 — the bundled OFL font families are read from `assets/fonts`
  // (electron-builder ships `assets/**`) and embedded on demand. Resolved
  // from the app root in both dev and packaged builds, like the samples and
  // tessdata directories above.
  setBundledFontDir(join(app.getAppPath(), 'assets', 'fonts'));
  const engine = new EngineService(ocr);
  const signatures = new SignatureService(join(app.getPath('userData'), 'signatures.json'));

  ipcMain.handle(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle(IPC.windowMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== null) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  ipcMain.handle(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // DEF-142 — close/quit gate. The window's 'close' event fires for every
  // close path (caption X via window:close, OS Alt+F4, the Window menu's
  // Close role, and app.quit() which closes every window). The per-tab
  // closeTab path already gated on `modified`; the whole-window close
  // bypassed it and silently discarded unsaved edits. We intercept here:
  // on every 'close', if the window is not already close-confirmed we
  // preventDefault and push window:closeRequested so the renderer can
  // show its existing CloseTabPromptDialog (it knows which tabs are
  // modified — it is the source of truth for unsaved state). The renderer
  // calls window:confirmClose(true) once the user has chosen Save (after
  // it succeeded) / Don't save; Cancel means it does nothing and the
  // window stays open. A confirmed window is re-closed via win.close();
  // the gate sees the WeakSet entry and skips the preventDefault so the
  // window actually shuts (the geometry report in window.ts still runs).
  const closeConfirmedWindows = new WeakSet<BrowserWindow>();
  const onWindowCloseRequested = (
    win: BrowserWindow,
    event: { preventDefault(): void },
  ): void => {
    if (closeConfirmedWindows.has(win)) return;
    if (win.isDestroyed()) return;
    // Abort this close — the renderer decides whether to proceed. The
    // geometry report in window.ts already ran, so the last window
    // position is persisted even if the user later cancels.
    event.preventDefault();
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(IPC.windowCloseRequested);
    }
  };
  ipcMain.handle(IPC.windowConfirmClose, (event, proceed: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null || win.isDestroyed()) return;
    if (!proceed) return;
    // Mark confirmed so the re-entrant win.close() 'close' event skips
    // the gate, then actually close. The WeakSet entry is collectable
    // once the window is destroyed (Electron releases its ref).
    closeConfirmedWindows.add(win);
    win.close();
  });

  ipcMain.handle(IPC.openFileDialog, (_event, kind?: OpenFileDialogKind) => openPdfDialog(kind));
  ipcMain.handle(IPC.pdfLoad, (_event, path: string) => loadPdfFile(path));
  ipcMain.handle(IPC.fdfLoad, (_event, path: string) => loadFdfFile(path));
  ipcMain.handle(IPC.samplesList, () => samples.list());
  ipcMain.handle(IPC.samplesLoad, (_event, name: string) => samples.load(name));
  ipcMain.handle(IPC.samplesRead, (_event, name: string) => samples.read(name));
  ipcMain.handle(IPC.settingsLoad, () => settings.load());
  ipcMain.handle(IPC.settingsSave, (_event, s: AppSettings) => settings.save(s));
  ipcMain.handle(IPC.settingsAddRecent, (_event, f: RecentFile) => settings.addRecentFile(f));

  // Phase 2: page organization engine
  ipcMain.handle(IPC.engineLoadDocument, (_event, docId: string, path: string) =>
    engine.loadDocument(docId, path),
  );
  ipcMain.handle(IPC.engineLoadDocumentBytes, (_event, docId: string, bytes: ArrayBuffer | Uint8Array) => {
    // Electron structured-clone preserves Uint8Array vs ArrayBuffer types,
    // but we accept both for renderer flexibility. Normalise to a view
    // against the underlying buffer before handing to pdf-lib.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return engine.loadDocumentBytes(docId, view);
  });
  ipcMain.handle(IPC.engineApplyOp, (_event, docId: string, op: OpEntry) =>
    engine.applyOp(docId, op),
  );
  ipcMain.handle(IPC.engineUndo, (_event, docId: string) =>
    engine.undo(docId),
  );
  ipcMain.handle(IPC.engineRedo, (_event, docId: string) =>
    engine.redo(docId),
  );
  ipcMain.handle(IPC.engineMerge, (_event, docId: string, otherPaths: string[], position: 'before' | 'after') =>
    engine.merge(docId, otherPaths, position),
  );
  ipcMain.handle(IPC.engineSplit, (_event, docId: string, range: [number, number]) =>
    engine.split(docId, range),
  );
  ipcMain.handle(IPC.engineExtract, (_event, docId: string, pages: number[]) =>
    engine.extract(docId, pages),
  );
  ipcMain.handle(IPC.engineSave, (_event, docId: string) =>
    engine.save(docId),
  );
  ipcMain.handle(IPC.engineSaveAs, async (_event, docId: string) => {
    // Phase 35 — the Save-As destination picker is shared with the
    // virtual-PDF print path (`savePdfDialog`), so the app has one dialog.
    const filePath = await savePdfDialog();
    if (filePath === null) {
      return { ok: false, error: { code: 'cancelled' as const, message: 'save cancelled' } };
    }
    return engine.saveAs(docId, filePath);
  });
  ipcMain.handle(IPC.engineGetState, (_event, docId: string) =>
    engine.getState(docId),
  );
  // DEF-085 (Bug 4) — dirty-check the renderer calls before closing a tab
  // to decide whether to prompt "save unsaved changes?". Cheap (no
  // buildState) and queue-ordered so it reflects every prior mutation.
  ipcMain.handle(IPC.engineIsModified, (_event, docId: string) =>
    engine.isModified(docId),
  );
  ipcMain.handle(IPC.engineGetDocumentBytes, (_event, docId: string) =>
    engine.getDocumentBytes(docId),
  );

  // Phase 3: annotations
  ipcMain.handle(IPC.engineCreateAnnotation, (_event, docId: string, payload: CreateAnnotationPayload) =>
    engine.createAnnotation(docId, payload),
  );
  ipcMain.handle(IPC.engineEditAnnotation, (_event, docId: string, annId: string, payload: EditAnnotationPayload) =>
    engine.editAnnotation(docId, annId, payload),
  );
  ipcMain.handle(IPC.engineDeleteAnnotation, (_event, docId: string, annId: string) =>
    engine.deleteAnnotation(docId, annId),
  );
  // Phase 28 — comment threads: creates the thread on the first call and
  // appends a reply on every later call (one op for both). Persisted in the
  // PDF catalog and dropped when the annotation is deleted.
  ipcMain.handle(IPC.engineAddComment, (_event, docId: string, annotationId: string, text: string, author?: string) =>
    engine.addComment(docId, annotationId, text, author),
  );

  // Phase 4: forms
  ipcMain.handle(IPC.engineGetFormFields, (_event, docId: string) =>
    engine.getFormFields(docId),
  );
  ipcMain.handle(IPC.engineFillFormField, (_event, docId: string, payload: FillFormFieldPayload) =>
    engine.fillFormField(docId, payload),
  );
  ipcMain.handle(IPC.engineFlattenForms, (_event, docId: string) =>
    engine.flattenForms(docId),
  );

  // Phase 4: signatures (page placements)
  ipcMain.handle(IPC.enginePlaceSignature, (_event, docId: string, payload: PlaceSignaturePayload) =>
    engine.placeSignature(docId, payload),
  );
  ipcMain.handle(IPC.engineMoveSignature, (_event, docId: string, payload: MoveSignaturePayload) =>
    engine.moveSignature(docId, payload),
  );
  ipcMain.handle(IPC.engineDeleteSignature, (_event, docId: string, sigPlacementId: string) =>
    engine.deleteSignature(docId, sigPlacementId),
  );

  // Phase 8: optimize — file size reduction and space audit
  ipcMain.handle(IPC.engineOptimize, (_event, docId: string, preset: OptimizePreset) =>
    engine.optimize(docId, preset),
  );
  ipcMain.handle(IPC.engineAuditSpace, (_event, docId: string) =>
    engine.auditSpace(docId),
  );

  // Phase 9: create + export
  ipcMain.handle(IPC.engineCreateFromImages, (_event, docId: string, imageBuffers: Uint8Array[]) =>
    engine.createFromImages(docId, imageBuffers),
  );
  ipcMain.handle(IPC.engineCreateFromClipboard, (_event, docId: string, content: Uint8Array | string) =>
    engine.createFromClipboard(docId, content),
  );
  ipcMain.handle(IPC.engineInsertBlankPage, (_event, docId: string, afterIndex: number, widthPx: number, heightPx: number) =>
    engine.insertBlankPage(docId, afterIndex, widthPx, heightPx),
  );
  ipcMain.handle(IPC.engineInsertFromPdf, (_event, docId: string, otherBytes: Uint8Array, position: number) =>
    engine.insertFromPdf(docId, otherBytes, position),
  );
  // Phase 32 (Multi Mode) — one atomic cross-document page move/copy. The
  // payload carries both doc ids, the source pages and the target position;
  // the engine returns both documents' states.
  ipcMain.handle(IPC.engineMovePagesBetween, (_event, payload: MovePagesBetweenDocsPayload) =>
    engine.movePagesBetweenDocs(payload),
  );
  ipcMain.handle(IPC.engineExportPages, (_event, docId: string, payload: ExportPagesPayload) =>
    engine.exportPages(docId, payload),
  );
  ipcMain.handle(IPC.engineExportText, (_event, docId: string) =>
    engine.exportText(docId),
  );
  ipcMain.handle(IPC.engineCreateDocxFromImages, (_event, entries: DocxImageEntry[]) =>
    engine.createDocxFromImages(entries),
  );
  // DEF-060 — DOCX from the loaded document's own text (image fallback for
  // text-free pages). The renderer rasterises every page ahead of time so
  // the fallback always has pixels; the engine picks text where present.
  ipcMain.handle(IPC.engineCreateDocxFromDoc, (_event, docId: string, entries: DocxImageEntry[]) =>
    engine.createDocxFromDoc(docId, entries),
  );

  // Phase 10: edit content (text run, text box, image)
  ipcMain.handle(IPC.engineEditTextRun, (_event, docId: string, payload: EditTextRunPayload) =>
    engine.editTextRun(docId, payload),
  );
  ipcMain.handle(IPC.engineAddTextBox, (_event, docId: string, payload: AddTextBoxPayload) =>
    engine.addTextBox(docId, payload),
  );
  ipcMain.handle(IPC.engineEditImage, (_event, docId: string, payload: EditImagePayload) =>
    engine.editImage(docId, payload),
  );
  // Phase 14 / DEF-135 / DEF-136 — text-box registry move/delete. Boxes are
  // registry-only (drawn once at save time), so move updates the rect without
  // masking the content under the old rect (the root cause of DEF-135); delete
  // removes the box from the registry (DEF-136).
  ipcMain.handle(IPC.engineMoveTextBox, (_event, docId: string, id: string, rect: import('../shared/types').AnnRect) =>
    engine.moveTextBox(docId, id, rect),
  );
  ipcMain.handle(IPC.engineDeleteTextBox, (_event, docId: string, id: string) =>
    engine.deleteTextBox(docId, id),
  );
  // Phase 21 — apply a Word/Adobe-class style patch to a registry text box
  // (font family/size, bold/italic/underline, colour, highlight, alignment,
  // line spacing, super/subscript, list style, text). Preserve-if-valid /
  // reject-if-invalid; unknown id or unsupported font -> typed engine-error.
  ipcMain.handle(IPC.engineUpdateTextBox, (_event, docId: string, id: string, patch: TextBoxStylePatch) =>
    engine.updateTextBox(docId, id, patch),
  );

  // Phase 11: OCR — recognize text (build invisible text layer) + suspects.
  // Progress is forwarded only to the window that issued the request. The
  // sender WebContents is captured once and re-checked on every emit: a long
  // OCR run can outlive the invoking renderer, and `event.sender` becomes
  // null/destroyed after the window closes. Calling `.send` (or even
  // `.isDestroyed()`) on a null sender throws "sendWithPromise null" inside
  // Electron, so both states must be guarded.
  ipcMain.handle(IPC.engineOcrRecognize, (event, docId: string, options: OcrRecognizeOptions) => {
    const sender = event.sender;
    return engine.ocrRecognize(docId, options, (p: OcrProgress) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(IPC.engineOcrProgressEvent, p);
      }
    });
  });
  ipcMain.handle(IPC.engineOcrSuspects, (_event, docId: string) =>
    engine.ocrSuspects(docId),
  );

  // Phase 12: residual page-organize + annotate parity
  ipcMain.handle(IPC.engineReplacePages, (_event, docId: string, otherBytes: Uint8Array, targetRange: [number, number]) =>
    engine.replacePages(docId, otherBytes, targetRange),
  );
  ipcMain.handle(IPC.engineRenumberPages, (_event, docId: string, labels: PageLabelEntry[]) =>
    engine.renumberPages(docId, labels),
  );
  ipcMain.handle(IPC.engineCropPages, (_event, docId: string, entries: CropEntry[]) =>
    engine.cropPages(docId, entries),
  );
  ipcMain.handle(IPC.engineAddStamp, (_event, docId: string, payload: AddStampPayload) =>
    engine.addStamp(docId, payload),
  );
  ipcMain.handle(IPC.engineExportFdf, (_event, docId: string) =>
    engine.exportFdf(docId),
  );
  ipcMain.handle(IPC.engineImportFdf, (_event, docId: string, fdfBytes: Uint8Array) =>
    engine.importFdf(docId, fdfBytes),
  );
  // Phase 18 / DEF-216: watermarks — apply, list (by the marker baked
  // into each page's content stream), delete by id.
  ipcMain.handle(IPC.engineAddWatermark, (_event, docId: string, settings: WatermarkSettings) =>
    engine.addWatermark(docId, settings),
  );
  ipcMain.handle(
    IPC.engineGetWatermarks,
    (_event, docId: string): Promise<import('../shared/result').Result<WatermarkInfo[], import('../shared/types').EngineError>> =>
      engine.getWatermarks(docId),
  );
  ipcMain.handle(IPC.engineDeleteWatermark, (_event, docId: string, watermarkId: string) =>
    engine.deleteWatermark(docId, watermarkId),
  );

  // Phase 4: saved signatures service
  ipcMain.handle(IPC.signaturesList, () => signatures.list());
  ipcMain.handle(IPC.signaturesSave, (_event, source: SignatureSource, label?: string) =>
    signatures.save(source, label),
  );
  ipcMain.handle(IPC.signaturesDelete, (_event, id: string) => signatures.delete(id));

  // Phase 6: About / preferences — app info
  ipcMain.handle(IPC.appGetInfo, () => {
    return {
      version: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      storagePaths: {
        userData: app.getPath('userData'),
        settings: join(app.getPath('userData'), 'settings.json'),
        signatures: join(app.getPath('userData'), 'signatures.json'),
        cache: app.getPath('sessionData'),
      },
    };
  });

  // Phase 6: open a folder or file in the OS shell
  ipcMain.handle(IPC.appOpenPath, async (_event, path: string) => {
    const error = await shell.openPath(path);
    if (error) {
      throw new Error(error);
    }
  });

  // Phase 6: OTA updates via electron-updater
  const updateService = new UpdateService();
  updateService.init();

  ipcMain.handle(IPC.updateStatus, () => {
    return updateService.getStatus();
  });

  ipcMain.handle(IPC.updateDownload, async () => {
    return updateService.download();
  });

  ipcMain.handle(IPC.updateInstall, () => {
    updateService.install();
  });

  // DEF-079 / DEF-080 — manual re-check (Help -> Check for Update).
  // Re-runs autoUpdater.checkForUpdates() with autoDownload=false (the
  // same semantics as the start-path check in updateService.init()) and
  // resolves with the resulting UpdateState. Routed from the
  // `checkForUpdate` menu action the renderer dispatches to
  // `tflex.update.check()` -> this `update:check` channel.
  ipcMain.handle(IPC.updateCheck, () => {
    return updateService.checkForUpdates();
  });

  // Push update status changes to all windows
  updateService.onStatusChanged((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.updateStatusChangedEvent, state);
      }
    }
  });

  let currentSettings: AppSettings = DEFAULT_SETTINGS;
  const loaded = await settings.load();
  if (loaded.ok) {
    currentSettings = loaded.value;
  }

  const rendererHtml = join(mainModuleDir(), '../renderer/index.html');
  const rendererDevUrl = app.isPackaged
    ? undefined
    : (process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173');

  // Phase 35 - the standalone print window. `print:openWindow` validates the
  // context in main (openPrintWindow) and creates/focuses its own top-level OS
  // window; `print:notifyDocumentGone` forwards "document closed" to the print
  // window when it belongs to that document. The print window then drives the
  // SAME print:listPrinters / print:job pipeline as the in-app dialog.
  const printWindowSource = { rendererHtml, rendererDevUrl };
  ipcMain.handle(IPC.printOpenWindow, (_event, context: unknown) =>
    openPrintWindow(context, printWindowSource),
  );
  ipcMain.handle(IPC.printNotifyDocumentGone, (_event, docId: string) => {
    notifyPrintDocumentGone(docId);
  });

  const onGeometryChanged = (geometry: AppSettings['geometry']): void => {
    const current = settings.getCurrent();
    void settings.save({ ...current, geometry });
  };

  const createWindow = (): void => {
    const win = createMainWindow(currentSettings, {
      rendererHtml,
      rendererDevUrl,
      onGeometryChanged,
      // DEF-142 — gate the whole-window close on unsaved edits.
      onCloseRequested: onWindowCloseRequested,
    });
    // Phase 35 / DEF-300 — track the main window explicitly so OS file-opens
    // are routed to it, and flush any path that was queued before its
    // renderer was ready.
    if (win !== undefined) {
      mainWindow = win;
      win.webContents.once('did-finish-load', () => {
        flushPendingOpenPaths(win);
      });
      // Phase 35 — the print window is independent, but must never outlive
      // the app (no orphan window / zombie process). Closing the main window
      // closes it; with it gone `window-all-closed` then fires as before.
      win.on('closed', () => {
        if (mainWindow === win) {
          mainWindow = null;
        }
        closePrintWindow();
      });
    }
  };
  recreateMainWindow = createWindow;
  createWindow();

  // Phase 35 — a PDF path passed on the launch command line opens that
  // document (the `.pdf` file association / "Open with" path). Skipped
  // under vitest, where process.argv belongs to the test runner.
  if (!_isVitest) {
    const initialPath = extractFileArgument(process.argv, app.isPackaged);
    if (initialPath !== null) {
      void handleOsOpenPath(initialPath);
    }
  }

  app.on('window-all-closed', async () => {
    await settings.saveCurrent();
    await ocr.terminate();
    app.quit();
  });
  // Phase 35 — belt-and-braces quit path: any app.quit() (menu Exit, update
  // install) closes the print window so it can never survive the app.
  app.on('before-quit', () => {
    closePrintWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
