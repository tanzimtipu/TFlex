import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/ipc';
import type {
  AppSettings,
  CreateAnnotationPayload,
  EditAnnotationPayload,
  FillFormFieldPayload,
  MoveSignaturePayload,
  OpEntry,
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
import { createMainWindow } from './window';

function mainModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
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
  Menu.setApplicationMenu(null);
  await app.whenReady();

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

  // Phase 4: saved signatures service
  ipcMain.handle(IPC.signaturesList, () => signatures.list());
  ipcMain.handle(IPC.signaturesSave, (_event, source: SignatureSource, label?: string) =>
    signatures.save(source, label),
  );
  ipcMain.handle(IPC.signaturesDelete, (_event, id: string) => signatures.delete(id));

  let currentSettings: AppSettings = DEFAULT_SETTINGS;
  const loaded = await settings.load();
  if (loaded.ok) {
    currentSettings = loaded.value;
  }

  const rendererHtml = join(mainModuleDir(), '../renderer/index.html');
  const rendererDevUrl = app.isPackaged
    ? undefined
    : (process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173');

  const persistGeometry = (): void => {
    void settings.save({ ...settings.getCurrent() });
  };
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

  app.on('window-all-closed', () => {
    persistGeometry();
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
