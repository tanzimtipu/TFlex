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
} = vi.hoisted(() => {
  const engineState = { pageCount: 1, modified: false, pageOrder: [0], rotations: [0], deleted: [false] };

  return {
    _settingsInstance: {
      load: vi.fn().mockResolvedValue({
        ok: true,
        value: { theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
      }),
      save: vi.fn().mockResolvedValue(undefined),
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
      createAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      editAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      deleteAnnotation: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      getFormFields: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      fillFormField: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      flattenForms: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      placeSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      moveSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
      deleteSignature: vi.fn().mockResolvedValue({ ok: true, value: engineState }),
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
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    _openPath: vi.fn().mockResolvedValue(''),
    _handle: vi.fn(),
    _on: vi.fn(),
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
    getVersion: vi.fn().mockReturnValue('1.1.0'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: _getAllWindows,
    fromWebContents: _fromWebContents,
    getFocusedWindow: vi.fn().mockReturnValue(null),
  },
  ipcMain: {
    handle: _handle,
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
  DEFAULT_SETTINGS: { theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
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

  it('registers signatures:list handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesList);
  });

  it('registers signatures:save handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesSave);
  });

  it('registers signatures:delete handler', () => {
    expect(getRegisteredChannels()).toContain(IPC.signaturesDelete);
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
  it('saves settings and quits', async () => {
    vi.clearAllMocks();
    _handle.mockClear();
    _on.mockClear();

    await start();

    const windowAllClosedCall = _on.mock.calls.find((c: unknown[]) => c[0] === 'window-all-closed')!;
    expect(windowAllClosedCall).toBeDefined();

    const handler = windowAllClosedCall[1] as () => void;
    handler();

    expect(_settingsInstance.save).toHaveBeenCalled();
    expect(_quit).toHaveBeenCalled();
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