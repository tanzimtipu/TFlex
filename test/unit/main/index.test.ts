import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted() — all shared mutable state so vi.mock factories can see it
// ---------------------------------------------------------------------------

const {
  _settingsInstance,
  _samplesInstance,
  _engineInstance,
  _sigInstance,
  _handle,
  _on,
  _setApplicationMenu,
  _showSaveDialog,
  _getAllWindows,
  _fromWebContents,
  _quit,
  _createMainWindow,
  _buildAppMenu,
    _updateServiceInstance,
    _openPath,
    _ipcOn,
    _applyMenuEnabled,
} = vi.hoisted(() => {
  const engineState = { pageCount: 1, modified: false, pageOrder: [0], rotations: [0], deleted: [false] };

  return {
    _settingsInstance: {
      load: vi.fn().mockResolvedValue({
        ok: true,
        value: { theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
      }),
      save: vi.fn().mockResolvedValue(undefined),
      saveCurrent: vi.fn().mockResolvedValue(undefined),
      addRecentFile: vi.fn().mockResolvedValue(undefined),
      getCurrent: vi.fn().mockReturnValue({ theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] }),
    },
    _samplesInstance: {
      list: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue({ ok: true, value: { name: 'test.pdf', path: 'samples/test.pdf' } }),
      read: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
    },
    _engineInstance: {
      loadDocument: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      loadDocumentBytes: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      applyOp: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      undo: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      redo: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      merge: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      split: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      extract: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      save: vi.fn().mockResolvedValue({ ok: true, value: '/mock/path.pdf' }),
      saveAs: vi.fn().mockResolvedValue({ ok: true, value: '/mock/new.pdf' }),
      getState: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      isModified: vi.fn().mockResolvedValue({ ok: true, value: false }),
      getDocumentBytes: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      createAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      editAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      deleteAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      getFormFields: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      fillFormField: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      flattenForms: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      placeSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      moveSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      deleteSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      moveTextBox: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      deleteTextBox: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      optimize: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      auditSpace: vi.fn().mockResolvedValue({ ok: true, value: { totalBytes: 0, breakdown: { images: 0, fonts: 0, contentStreams: 0, metadata: 0, other: 0 } } }),
      createFromImages: vi.fn().mockResolvedValue({ ok: true, value: new ArrayBuffer(8) }),
      createDocxFromDoc: vi.fn().mockResolvedValue({ ok: true, value: new Uint8Array(8) }),
      exportPages: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
    _sigInstance: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue([]),
    },
    _buildAppMenu: vi.fn(),
    _updateServiceInstance: {
      init: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ kind: 'up-to-date', version: '1.0.0' }),
      download: vi.fn().mockResolvedValue({ kind: 'downloading', progress: 0 }),
      install: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue({ kind: 'checking' }),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    _openPath: vi.fn().mockResolvedValue(''),
    _handle: vi.fn(),
    _on: vi.fn(),
    _ipcOn: vi.fn(),
    _applyMenuEnabled: vi.fn(),
    _setApplicationMenu: vi.fn(),
    _showSaveDialog: vi.fn(),
    _getAllWindows: vi.fn().mockReturnValue([]),
    _fromWebContents: vi.fn(),
    _quit: vi.fn(),
    _createMainWindow: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mocks — all factories reference hoisted variables only
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    quit: _quit,
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: _on,
    getPath: vi.fn((name: string) => name === 'userData' ? '/mock/user/data' : '/mock/app'),
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getVersion: vi.fn().mockReturnValue('1.5.0'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: _getAllWindows,
    fromWebContents: _fromWebContents,
    getFocusedWindow: vi.fn().mockReturnValue(null),
  },
  ipcMain: {
    handle: _handle,
    on: _ipcOn,
  },
  Menu: {
    setApplicationMenu: _setApplicationMenu,
    buildFromTemplate: vi.fn().mockReturnValue({}),
  },
  dialog: {
    showSaveDialog: _showSaveDialog,
  },
  shell: {
    openPath: _openPath,
  },
  screen: {
    getAllDisplays: vi.fn().mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    ]),
  },
}));

vi.mock('../../../src/main/window', () => ({
  createMainWindow: _createMainWindow,
}));

vi.mock('../../../src/main/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(function() { return _settingsInstance; }),
  DEFAULT_SETTINGS: { theme: 'frosted', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
}));

vi.mock('../../../src/main/services/samples', () => ({
  SamplesService: vi.fn().mockImplementation(function() { return _samplesInstance; }),
}));

vi.mock('../../../src/main/services/engine', () => ({
  EngineService: vi.fn().mockImplementation(function() { return _engineInstance; }),
}));

vi.mock('../../../src/main/services/signature-service', () => ({
  SignatureService: vi.fn().mockImplementation(function() { return _sigInstance; }),
}));

vi.mock('../../../src/main/services/update-service', () => ({
  UpdateService: vi.fn().mockImplementation(function() { return _updateServiceInstance; }),
}));

vi.mock('../../../src/main/menu', () => ({
  buildAppMenu: _buildAppMenu,
  applyMenuEnabledState: _applyMenuEnabled,
}));

vi.mock('../../../src/main/services/dialog', () => ({
  openPdfDialog: vi.fn().mockResolvedValue('/mock/selected.pdf'),
}));

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

import { start } from '../../../src/main/index';
import { IPC } from '../../../src/shared/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRegisteredChannels(): string[] {
  return _handle.mock.calls.map((call: unknown[]) => call[0] as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('main/index - start()', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();
    _getAllWindows.mockReturnValue([]);
    await start();
  });

  it('builds the application menu via buildAppMenu', () => {
    expect(_buildAppMenu).toHaveBeenCalled();
  });

  it('registers window:minimize handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.windowMinimize);
  });

  it('registers window:maximize handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.windowMaximize);
  });

  it('registers window:close handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.windowClose);
  });

  it('registers dialog:openFile handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.openFileDialog);
  });

  it('registers pdf:load handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.pdfLoad);
  });

  it('registers samples:list handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.samplesList);
  });

  it('registers samples:load handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.samplesLoad);
  });

  it('registers samples:read handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.samplesRead);
  });

  it('registers settings:load handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.settingsLoad);
  });

  it('registers settings:save handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.settingsSave);
  });

  it('registers settings:addRecent handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.settingsAddRecent);
  });

  it('registers engine:loadDocument handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineLoadDocument);
  });

  it('registers engine:loadDocumentBytes handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineLoadDocumentBytes);
  });

  it('registers engine:applyOp handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineApplyOp);
  });

  it('registers engine:undo handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineUndo);
  });

  it('registers engine:redo handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineRedo);
  });

  it('registers engine:merge handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineMerge);
  });

  it('registers engine:split handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineSplit);
  });

  it('registers engine:extract handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineExtract);
  });

  it('registers engine:save handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineSave);
  });

  it('registers engine:saveAs handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineSaveAs);
  });

  it('registers engine:getState handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineGetState);
  });

  it('registers engine:getDocumentBytes handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineGetDocumentBytes);
  });

  it('registers engine:createAnnotation handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineCreateAnnotation);
  });

  it('registers engine:editAnnotation handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineEditAnnotation);
  });

  it('registers engine:deleteAnnotation handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineDeleteAnnotation);
  });

  it('registers engine:getFormFields handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineGetFormFields);
  });

  it('registers engine:fillFormField handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineFillFormField);
  });

  it('registers engine:flattenForms handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineFlattenForms);
  });

  it('registers engine:placeSignature handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.enginePlaceSignature);
  });

  it('registers engine:moveSignature handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineMoveSignature);
  });

  it('registers engine:deleteSignature handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineDeleteSignature);
  });

  it('registers engine:moveTextBox handler (DEF-135/136 registry)', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineMoveTextBox);
  });

  it('registers engine:deleteTextBox handler (DEF-136 registry)', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineDeleteTextBox);
  });

  it('registers signatures:list handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesList);
  });

  it('registers signatures:save handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesSave);
  });

  it('registers signatures:delete handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesDelete);
  });

  it('registers engine:createFromImages handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineCreateFromImages);
  });

  it('registers engine:exportPages handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineExportPages);
  });

  it('creates the main window via createMainWindow', () => {
    expect(_createMainWindow).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// engineSaveAs handler
// ---------------------------------------------------------------------------

describe('main/index - engineSaveAs handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/mock/save-as.pdf' });
    await start();
  });

  it('returns cancelled error when dialog is canceled', async () => {
    _showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    const saveAsCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineSaveAs)!;
    const handler = saveAsCall[1] as (...args: unknown[]) => unknown;
    const result = await handler({}, 'doc-1');

    expect(result).toEqual({
      ok: false,
      error: { code: 'cancelled', message: 'save cancelled' },
    });
  });

  it('calls engine.saveAs on success', async () => {
    const saveAsCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineSaveAs)!;
    const handler = saveAsCall[1] as (...args: unknown[]) => unknown;
    await handler({}, 'doc-1');

    expect(_showSaveDialog).toHaveBeenCalledWith({
      title: 'Save PDF As',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(_engineInstance.saveAs).toHaveBeenCalledWith('doc-1', '/mock/save-as.pdf');
  });

  // DEF-067 / DEF-011 residual: the handler must forward the engine's
  // write-error result unchanged so the renderer can raise the locked
  // toast. It must not swallow or rewrite it.
  it('forwards engine write-error result unchanged', async () => {
    const writeError = {
      ok: false,
      error: { code: 'write-error', message: 'saveAs failed: EACCES' },
    };
    _engineInstance.saveAs.mockResolvedValueOnce(writeError);

    const saveAsCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineSaveAs)!;
    const handler = saveAsCall[1] as (...args: unknown[]) => unknown;
    const result = await handler({}, 'doc-1');

    expect(result).toEqual(writeError);
  });
});

// ---------------------------------------------------------------------------
// engineLoadDocumentBytes handler
// ---------------------------------------------------------------------------

describe('main/index - engineLoadDocumentBytes handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('normalizes ArrayBuffer to Uint8Array', async () => {
    const loadBytesCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineLoadDocumentBytes)!;
    const handler = loadBytesCall[1] as (...args: unknown[]) => unknown;
    const ab = new ArrayBuffer(8);
    await handler({}, 'doc-1', ab);

    expect(_engineInstance.loadDocumentBytes).toHaveBeenCalledWith('doc-1', expect.any(Uint8Array));
  });

  it('passes Uint8Array through directly', async () => {
    const loadBytesCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineLoadDocumentBytes)!;
    const handler = loadBytesCall[1] as (...args: unknown[]) => unknown;
    const view = new Uint8Array(8);
    await handler({}, 'doc-1', view);

    expect(_engineInstance.loadDocumentBytes).toHaveBeenCalledWith('doc-1', view);
  });
});

// ---------------------------------------------------------------------------
// engineGetDocumentBytes handler
// ---------------------------------------------------------------------------

describe('main/index - engineGetDocumentBytes handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('forwards the docId to engine.getDocumentBytes', async () => {
    const call = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineGetDocumentBytes)!;
    const handler = call[1] as (...args: unknown[]) => unknown;
    await handler({}, 'doc-1');

    expect(_engineInstance.getDocumentBytes).toHaveBeenCalledWith('doc-1');
  });
});

// ---------------------------------------------------------------------------
// settings broadcast
// ---------------------------------------------------------------------------

describe('main/index - settings changed broadcast', () => {
  it('broadcasts to all non-destroyed windows', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    const send = vi.fn();
    _getAllWindows.mockReturnValue([
      { isDestroyed: vi.fn().mockReturnValue(false), webContents: { send } },
    ]);

    await start();

    // Import SettingsService to find the broadcast callback
    const { SettingsService } = await import('../../../src/main/services/settings');
    const svcCtor = SettingsService as ReturnType<typeof vi.fn>;
    const svcCall = svcCtor.mock.calls.at(-1)!;
    const broadcastFn = svcCall[1] as (s: unknown) => void;

    const settings = {
      theme: 'light',
      geometry: { x: 0, y: 0, width: 800, height: 600, maximized: false },
      recentFiles: [],
    };
    broadcastFn(settings);

    expect(send).toHaveBeenCalledWith(IPC.settingsChangedEvent, settings);
  });

  it('skips destroyed windows', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    const send = vi.fn();
    _getAllWindows.mockReturnValue([
      { isDestroyed: vi.fn().mockReturnValue(true), webContents: { send } },
    ]);

    await start();

    const { SettingsService } = await import('../../../src/main/services/settings');
    const svcCtor = SettingsService as ReturnType<typeof vi.fn>;
    const svcCall = svcCtor.mock.calls.at(-1)!;
    const broadcastFn = svcCall[1] as (s: unknown) => void;

    broadcastFn({ theme: 'dark', geometry: { x: 0, y: 0, width: 800, height: 600, maximized: false }, recentFiles: [] });
    expect(send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// windowMaximize toggling
// ---------------------------------------------------------------------------

describe('main/index - window:maximize handler', () => {
  it('maximizes an unmaximized window', async () => {
    vi.clearAllMocks();
    _handle.mockClear();

    const maximize = vi.fn();
    const unmaximize = vi.fn();
    _fromWebContents.mockReturnValue({
      isMaximized: vi.fn().mockReturnValue(false),
      maximize,
      unmaximize,
    });

    await start();

    const maxCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.windowMaximize)!;
    const handler = maxCall[1] as (...args: unknown[]) => unknown;
    await handler({ sender: {} });

    expect(maximize).toHaveBeenCalled();
    expect(unmaximize).not.toHaveBeenCalled();
  });

  it('unmaximizes an already maximized window', async () => {
    vi.clearAllMocks();
    _handle.mockClear();

    const maximize = vi.fn();
    const unmaximize = vi.fn();
    _fromWebContents.mockReturnValue({
      isMaximized: vi.fn().mockReturnValue(true),
      maximize,
      unmaximize,
    });

    await start();

    const maxCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.windowMaximize)!;
    const handler = maxCall[1] as (...args: unknown[]) => unknown;
    await handler({ sender: {} });

    expect(unmaximize).toHaveBeenCalled();
    expect(maximize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// window-all-closed handler
// ---------------------------------------------------------------------------

describe('main/index - window-all-closed handler', () => {
  it('awaits saveCurrent before calling app.quit', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    // Track call order
    const callOrder: string[] = [];
    _settingsInstance.saveCurrent.mockImplementation(() => {
      callOrder.push('saveCurrent');
      return Promise.resolve();
    });
    _quit.mockImplementation(() => {
      callOrder.push('quit');
    });

    await start();

    const windowAllClosedCall = _on.mock.calls.find((c: unknown[]) => c[0] === 'window-all-closed')!;
    expect(windowAllClosedCall).toBeDefined();

    const handler = windowAllClosedCall[1] as () => Promise<void>;
    await handler();

    expect(_settingsInstance.saveCurrent).toHaveBeenCalled();
    expect(_quit).toHaveBeenCalled();
    // saveCurrent must complete before quit is called
    expect(callOrder).toEqual(['saveCurrent', 'quit']);
  });
});

// ---------------------------------------------------------------------------
// onGeometryChanged callback
// ---------------------------------------------------------------------------

describe('main/index - onGeometryChanged callback', () => {
  it('saves settings with updated geometry', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();
    _createMainWindow.mockClear();

    await start();

    // The onGeometryChanged callback is the third argument to createMainWindow
    const call = _createMainWindow.mock.calls[0];
    const deps = call[1] as { onGeometryChanged: (g: unknown) => void };
    expect(deps.onGeometryChanged).toBeDefined();

    const newGeometry = { x: 42, y: 99, width: 1024, height: 768, maximized: false };
    deps.onGeometryChanged(newGeometry);

    expect(_settingsInstance.save).toHaveBeenCalledWith(
      expect.objectContaining({ geometry: newGeometry }),
    );
  });
});

// ---------------------------------------------------------------------------
// activate handler
// ---------------------------------------------------------------------------

describe('main/index - activate handler', () => {
  it('recreates window when no windows exist on activate', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();
    _createMainWindow.mockClear();

    await start();

    const activateCall = _on.mock.calls.find((c: unknown[]) => c[0] === 'activate')!;
    expect(activateCall).toBeDefined();

    _getAllWindows.mockReturnValue([]);
    _createMainWindow.mockClear();

    const handler = activateCall[1] as () => void;
    handler();

    expect(_createMainWindow).toHaveBeenCalled();
  });

  it('does not recreate window when windows exist on activate', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();
    _createMainWindow.mockClear();

    await start();

    const activateCall = _on.mock.calls.find((c: unknown[]) => c[0] === 'activate')!;
    expect(activateCall).toBeDefined();

    _getAllWindows.mockReturnValue([{ isDestroyed: false }]);
    _createMainWindow.mockClear();

    const handler = activateCall[1] as () => void;
    handler();

    expect(_createMainWindow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 6: app:getInfo handler
// ---------------------------------------------------------------------------

describe('main/index - app:getInfo handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers app:getInfo handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.appGetInfo);
  });

  it('returns version and storage paths', async () => {
    const infoCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.appGetInfo)!;
    expect(infoCall).toBeDefined();
    const handler = infoCall[1] as (...args: unknown[]) => unknown;
    const result = await handler();

    expect(result).toEqual(
      expect.objectContaining({
        version: expect.any(String),
        electronVersion: expect.any(String),
        nodeVersion: expect.any(String),
        storagePaths: expect.objectContaining({
          userData: expect.any(String),
          settings: expect.stringContaining('settings.json'),
          signatures: expect.stringContaining('signatures.json'),
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 6: app:openPath handler
// ---------------------------------------------------------------------------

describe('main/index - app:openPath handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _openPath.mockResolvedValue('');
    await start();
  });

  it('registers app:openPath handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.appOpenPath);
  });

  it('calls shell.openPath', async () => {
    const openPathCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.appOpenPath)!;
    const handler = openPathCall[1] as (...args: unknown[]) => unknown;
    await handler({}, '/mock/path');
    expect(_openPath).toHaveBeenCalledWith('/mock/path');
  });

  it('throws when shell.openPath returns an error string', async () => {
    _openPath.mockResolvedValue('some error');
    const openPathCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.appOpenPath)!;
    const handler = openPathCall[1] as (...args: unknown[]) => unknown;
    await expect(handler({}, '/mock/path')).rejects.toThrow('some error');
  });
});

// ---------------------------------------------------------------------------
// Phase 6: update:status handler
// ---------------------------------------------------------------------------

describe('main/index - update:status handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers update:status handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.updateStatus);
  });

  it('returns current update status', async () => {
    const statusCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.updateStatus)!;
    const handler = statusCall[1] as (...args: unknown[]) => unknown;
    const result = await handler();
    expect(_updateServiceInstance.getStatus).toHaveBeenCalled();
    expect(result).toEqual({ kind: 'up-to-date', version: '1.0.0' });
  });
});

// ---------------------------------------------------------------------------
// Phase 6: update:download handler
// ---------------------------------------------------------------------------

describe('main/index - update:download handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers update:download handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.updateDownload);
  });

  it('triggers download', async () => {
    const dlCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.updateDownload)!;
    const handler = dlCall[1] as (...args: unknown[]) => unknown;
    await handler();
    expect(_updateServiceInstance.download).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 6: update:install handler
// ---------------------------------------------------------------------------

describe('main/index - update:install handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers update:install handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.updateInstall);
  });

  it('triggers install', async () => {
    const instCall = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.updateInstall)!;
    const handler = instCall[1] as (...args: unknown[]) => unknown;
    await handler();
    expect(_updateServiceInstance.install).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DEF-079 / DEF-080: update:check handler
// ---------------------------------------------------------------------------

describe('main/index - DEF-080 update:check handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers update:check handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.updateCheck);
  });

  it('triggers checkForUpdates on the update service', async () => {
    const call = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.updateCheck)!;
    expect(call).toBeDefined();
    const handler = call[1] as (...args: unknown[]) => unknown;
    const result = await handler();
    expect(_updateServiceInstance.checkForUpdates).toHaveBeenCalled();
    expect(result).toEqual({ kind: 'checking' });
  });

  it('does not register update:check as a fire-and-forget on() listener', () => {
    // update:check returns a value, so it must be a handle(), not on().
    const onChannels = _ipcOn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(onChannels).not.toContain(IPC.updateCheck);
  });
});

// ---------------------------------------------------------------------------
// Phase 6: update status broadcast
// ---------------------------------------------------------------------------

describe('main/index - update status broadcast', () => {
  it('broadcasts update status to all non-destroyed windows', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    const send = vi.fn();
    _getAllWindows.mockReturnValue([
      { isDestroyed: vi.fn().mockReturnValue(false), webContents: { send } },
    ]);

    await start();

    // Find the onStatusChanged callback registered during start()
    const onStatusChangedCalls = _updateServiceInstance.onStatusChanged.mock.calls;
    expect(onStatusChangedCalls.length).toBeGreaterThan(0);
    const broadcastFn = onStatusChangedCalls[onStatusChangedCalls.length - 1][0] as (s: unknown) => void;

    const state = { kind: 'available', version: '2.0.0' };
    broadcastFn(state);

    expect(send).toHaveBeenCalledWith(IPC.updateStatusChangedEvent, state);
  });

  it('skips destroyed windows for update status broadcast', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    const send = vi.fn();
    _getAllWindows.mockReturnValue([
      { isDestroyed: vi.fn().mockReturnValue(true), webContents: { send } },
    ]);

    await start();

    const onStatusChangedCalls = _updateServiceInstance.onStatusChanged.mock.calls;
    expect(onStatusChangedCalls.length).toBeGreaterThan(0);
    const broadcastFn = onStatusChangedCalls[onStatusChangedCalls.length - 1][0] as (s: unknown) => void;

    broadcastFn({ kind: 'available', version: '2.0.0' });
    expect(send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 6: application menu is built
// ---------------------------------------------------------------------------

describe('main/index - application menu', () => {
  it('builds the application menu via buildAppMenu', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _buildAppMenu.mockClear();

    await start();
    expect(_buildAppMenu).toHaveBeenCalled();
  });

  it('menu action handler sends to focused window', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _buildAppMenu.mockClear();

    const send = vi.fn();
    _getAllWindows.mockReturnValue([
      { isDestroyed: vi.fn().mockReturnValue(false), webContents: { send } },
    ]);

    await start();

    // Extract the sendToFocused callback passed to buildAppMenu
    const menuCall = _buildAppMenu.mock.calls[0][0] as { sendToFocused: (action: string) => void };
    menuCall.sendToFocused('menu:action');

    expect(send).toHaveBeenCalledWith('menu:action');
  });
});

// ---------------------------------------------------------------------------
// DEF-065: menu:setEnabled listener
// ---------------------------------------------------------------------------

describe('main/index - DEF-065 menu:setEnabled listener', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _ipcOn.mockClear();
    _applyMenuEnabled.mockClear();
    await start();
  });

  it('registers an ipcMain.on listener for menu:setEnabled', () => {
    const channels = _ipcOn.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(channels).toContain(IPC.menuSetEnabled);
  });

  it('forwards the renderer state to applyMenuEnabledState', async () => {
    const setEnabledCall = _ipcOn.mock.calls.find((c: unknown[]) => c[0] === IPC.menuSetEnabled)!;
    const handler = setEnabledCall[1] as (...args: unknown[]) => void;
    const state = { 'menu.save': false, 'menu.undo': false };
    handler({}, state);

    expect(_applyMenuEnabled).toHaveBeenCalledTimes(1);
    expect(_applyMenuEnabled).toHaveBeenCalledWith(state);
  });

  it('does not register menu:setEnabled as a handle (it is fire-and-forget on)', () => {
    // menu:setEnabled must NOT be in the handle() registrations — it uses on().
    const handled = _handle.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(handled).not.toContain(IPC.menuSetEnabled);
  });
});

// ---------------------------------------------------------------------------
// DEF-060: engine:createDocxFromDoc handler registration
// ---------------------------------------------------------------------------

describe('main/index - DEF-060 engine:createDocxFromDoc handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers engine:createDocxFromDoc handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineCreateDocxFromDoc);
  });

  it('forwards docId and entries to engine.createDocxFromDoc', async () => {
    const call = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineCreateDocxFromDoc)!;
    const handler = call[1] as (...args: unknown[]) => unknown;
    const entries = [{
      pageNumber: 1,
      pngBuffer: new Uint8Array([1, 2, 3]),
      width: 10,
      height: 10,
      pageWidth: 612,
      pageHeight: 792,
    }];
    await handler({}, 'doc-1', entries);

    expect(_engineInstance.createDocxFromDoc).toHaveBeenCalledWith('doc-1', entries);
  });
});

// ---------------------------------------------------------------------------
// DEF-085 (Bug 4): engine:isModified handler registration
// ---------------------------------------------------------------------------

describe('main/index - DEF-085 engine:isModified handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('registers engine:isModified handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.engineIsModified);
  });

  it('forwards docId to engine.isModified', async () => {
    const call = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.engineIsModified)!;
    const handler = call[1] as (...args: unknown[]) => unknown;
    await handler({}, 'doc-1');
    expect(_engineInstance.isModified).toHaveBeenCalledWith('doc-1');
  });
});

// ---------------------------------------------------------------------------
// DEF-142 — close/quit gate. The whole-window close (caption X, Alt+F4,
// app.quit) must not silently discard unsaved edits. index.ts intercepts the
// window 'close' event via the onCloseRequested dep passed to createMainWindow:
// it preventDefaults and pushes window:closeRequested so the renderer can
// show its existing CloseTabPromptDialog; the renderer calls window:confirmClose
// to actually close. A confirmed window is re-closed via win.close() and the
// gate skips the second 'close' (WeakSet) so the window shuts.
// ---------------------------------------------------------------------------

describe('main/index - DEF-142 close/quit gate', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    await start();
  });

  it('passes an onCloseRequested dep to createMainWindow', () => {
    expect(_createMainWindow).toHaveBeenCalled();
    const deps = _createMainWindow.mock.calls[0][1] as { onCloseRequested?: unknown };
    expect(typeof deps.onCloseRequested).toBe('function');
  });

  it('registers window:confirmClose handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.windowConfirmClose);
  });

  function getOnCloseRequested(): (win: unknown, event: { preventDefault(): void }) => void {
    const deps = _createMainWindow.mock.calls[0][1] as { onCloseRequested: (win: unknown, event: { preventDefault(): void }) => void };
    return deps.onCloseRequested;
  }

  function getConfirmCloseHandler(): (event: { sender: unknown }, proceed: boolean) => Promise<void> {
    const call = _handle.mock.calls.find((c: unknown[]) => c[0] === IPC.windowConfirmClose)!;
    return call[1] as (event: { sender: unknown }, proceed: boolean) => Promise<void>;
  }

  it('onCloseRequested preventDefaults and pushes window:closeRequested to the renderer', () => {
    const onCloseRequested = getOnCloseRequested();
    const send = vi.fn();
    const mockWin = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    };
    const mockEvent = { preventDefault: vi.fn() };

    onCloseRequested(mockWin, mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC.windowCloseRequested);
  });

  it('onCloseRequested is a no-op for an already-destroyed window (no preventDefault, no push)', () => {
    const onCloseRequested = getOnCloseRequested();
    const send = vi.fn();
    const mockWin = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => false, send },
    };
    const mockEvent = { preventDefault: vi.fn() };

    onCloseRequested(mockWin, mockEvent);

    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('confirmClose(true) marks the window confirmed and re-closes it', async () => {
    const handler = getConfirmCloseHandler();
    const close = vi.fn();
    const mockWin = {
      isDestroyed: () => false,
      close,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    _fromWebContents.mockReturnValue(mockWin);

    await handler({ sender: {} }, true);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('confirmClose(false) does NOT close the window (user cancelled the prompt)', async () => {
    const handler = getConfirmCloseHandler();
    const close = vi.fn();
    const mockWin = {
      isDestroyed: () => false,
      close,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    _fromWebContents.mockReturnValue(mockWin);

    await handler({ sender: {} }, false);

    expect(close).not.toHaveBeenCalled();
  });

  it('confirmClose(true) is a no-op when the window is already destroyed', async () => {
    const handler = getConfirmCloseHandler();
    const close = vi.fn();
    const mockWin = {
      isDestroyed: () => true,
      close,
      webContents: { isDestroyed: () => true, send: vi.fn() },
    };
    _fromWebContents.mockReturnValue(mockWin);

    await handler({ sender: {} }, true);

    expect(close).not.toHaveBeenCalled();
  });

  it('after confirmClose(true), a re-entrant close skips the gate (no second preventDefault, no re-push)', async () => {
    // The whole flow: first close attempt -> gate prevents + pushes. The
    // renderer shows the prompt; user picks Save/Don't-save -> renderer
    // calls confirmClose(true), which marks the window confirmed and calls
    // win.close(). That re-fires the 'close' event -> onCloseRequested runs
    // again, but this time the gate MUST skip (the window is confirmed) so
    // the window actually shuts instead of looping forever on the prompt.
    const onCloseRequested = getOnCloseRequested();
    const handler = getConfirmCloseHandler();
    const send = vi.fn();
    const close = vi.fn();
    const mockWin = {
      isDestroyed: () => false,
      close,
      webContents: { isDestroyed: () => false, send },
    };
    _fromWebContents.mockReturnValue(mockWin);

    // First close attempt — gate prevents and pushes.
    const event1 = { preventDefault: vi.fn() };
    onCloseRequested(mockWin, event1);
    expect(event1.preventDefault).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC.windowCloseRequested);

    // User confirms — window is marked + win.close() is called.
    await handler({ sender: {} }, true);
    expect(close).toHaveBeenCalledTimes(1);

    // The re-entrant 'close' event from win.close() re-enters the gate.
    // The window is now confirmed, so the gate MUST NOT preventDefault
    // again and MUST NOT re-push window:closeRequested (else the prompt
    // would re-show and the window could never close).
    const event2 = { preventDefault: vi.fn() };
    send.mockClear();
    onCloseRequested(mockWin, event2);
    expect(event2.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
