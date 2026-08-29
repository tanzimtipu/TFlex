import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import type {
  AppSettings,
  CreateAnnotationPayload,
  DocxImageEntry,
  EditAnnotationPayload,
  ExportPagesPayload,
  FillFormFieldPayload,
  MoveSignaturePayload,
  OpEntry,
  OptimizePreset,
  PlaceSignaturePayload,
  RecentFile,
} from '../shared/types';
import type { SignatureSource } from '../shared/types';
import { openPdfDialog } from './services/dialog';
import { EngineService } from './services/engine';
import { loadPdfFile } from './services/pdf-file';
import { SamplesService } from './services/samples';
import { DEFAULT_SETTINGS, SettingsService } from './services/settings';
import { SignatureService } from './services/signature-service';
import { UpdateService } from './services/update-service';
import { buildAppMenu } from './menu';
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

  const broadcast = (settings: AppSettings): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.settingsChangedEvent, settings);
      }
    }
  };

  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'), broadcast);
  const samples = new SamplesService(join(app.getAppPath(), 'assets', 'samples'));
  const engine = new EngineService();
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

  ipcMain.handle(IPC.openFileDialog, () => openPdfDialog());
  ipcMain.handle(IPC.pdfLoad, (_event, path: string) => loadPdfFile(path));
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
    });
  };
createWindow();

  app.on('window-all-closed', async () => {
    await settings.saveCurrent();
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
