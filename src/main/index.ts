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
  MoveSignaturePayload,
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  OpEntry,
  OptimizePreset,
  PageLabelEntry,
  PlaceSignaturePayload,
  RecentFile,
  TextBoxStylePatch,
  WatermarkInfo,
  WatermarkSettings,
} from '../shared/types';
import type { SignatureSource } from '../shared/types';
import { openPdfDialog } from './services/dialog';
import { EngineService } from './services/engine';
import { OcrService } from './services/ocr';
import { loadPdfFile, loadFdfFile } from './services/pdf-file';
import { setBundledFontDir } from './services/fonts';
import { SamplesService } from './services/samples';
import { DEFAULT_SETTINGS, SettingsService } from './services/settings';
import { SignatureService } from './services/signature-service';
import { UpdateService } from './services/update-service';
import { applyMenuEnabledState, buildAppMenu } from './menu';
import { createMainWindow } from './window';

function mainModuleDir(): string {
  return __dirname;
}

// Test harness: export start() so unit tests can call it directly.
// In production the module-level init below calls start() automatically;
// during vitest runs that block is skipped and the test drives start().
const _isVitest = typeof process !== 'undefined' && process.env.VITEST === 'true';

if (!_isVitest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win !== undefined) {
        if (win.isMinimized()) {
          win.restore();
        }
        win.focus();
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
  });

  // DEF-065 — renderer -> main: toggle named menu items' enabled state so
  // the native menu reflects doc-open / undo-stack / modified state. Uses
  // `on` (not handle) because the renderer fire-and-forgets; main applies
  // the partial map via applyMenuEnabledState, which is a no-op when no
  // application menu is set.
  ipcMain.on(IPC.menuSetEnabled, (_event, state: MenuEnabledState) => {
    applyMenuEnabledState(state);
  });

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
    const result = await dialog.showSaveDialog({
      title: 'Save PDF As',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePath === undefined) {
      return { ok: false, error: { code: 'cancelled' as const, message: 'save cancelled' } };
    }
    return engine.saveAs(docId, result.filePath);
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

  const onGeometryChanged = (geometry: AppSettings['geometry']): void => {
    const current = settings.getCurrent();
    void settings.save({ ...current, geometry });
  };

  const createWindow = (): void => {
    createMainWindow(currentSettings, {
      rendererHtml,
      rendererDevUrl,
      onGeometryChanged,
      // DEF-142 — gate the whole-window close on unsaved edits.
      onCloseRequested: onWindowCloseRequested,
    });
  };
createWindow();

  app.on('window-all-closed', async () => {
    await settings.saveCurrent();
    await ocr.terminate();
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
