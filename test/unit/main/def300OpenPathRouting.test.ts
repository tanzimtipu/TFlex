import { vi, describe, it, expect, beforeEach } from 'vitest';
import { IPC } from '../../../src/shared/ipc';

// DEF-300 — with the standalone print window open and focused, an OS file-open
// was silently dropped. `sendOpenPath` pushed `app:openPathRequest` to
// `BrowserWindow.getAllWindows()[0]`, which with the print window open is the
// PRINT window (it never subscribes). These tests pin the explicit
// main-window routing: the request must land on the main window's webContents
// regardless of window order/focus, never on any other window.

const {
  _settingsInstance,
  _samplesInstance,
  _engineInstance,
  _sigInstance,
  _updateServiceInstance,
  _handle,
  _on,
  _ipcOn,
  _createMainWindow,
  _getAllWindows,
  _getFocusedWindow,
  _fromWebContents,
  _quit,
  _buildAppMenu,
  _applyMenuEnabled,
} = vi.hoisted(() => ({
  _settingsInstance: {
    load: vi.fn().mockResolvedValue({
      ok: true,
      value: { theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
    }),
    save: vi.fn().mockResolvedValue(undefined),
    // DEF-303 — real service gained the disk-only geometry persist; keep the
    // mock shape in sync so an onGeometryChanged path can never throw here.
    saveGeometryOnly: vi.fn().mockResolvedValue(undefined),
    saveCurrent: vi.fn().mockResolvedValue(undefined),
    addRecentFile: vi.fn().mockResolvedValue(undefined),
    getCurrent: vi.fn().mockReturnValue({ theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] }),
  },
  _samplesInstance: { list: vi.fn().mockResolvedValue([]), load: vi.fn(), read: vi.fn() },
  _engineInstance: {},
  _sigInstance: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
  _updateServiceInstance: {
    init: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ kind: 'up-to-date', version: '1.0.0' }),
    download: vi.fn(),
    install: vi.fn(),
    checkForUpdates: vi.fn(),
    onStatusChanged: vi.fn(),
  },
  _handle: vi.fn(),
  _on: vi.fn(),
  _ipcOn: vi.fn(),
  _createMainWindow: vi.fn(),
  _getAllWindows: vi.fn().mockReturnValue([]),
  _getFocusedWindow: vi.fn().mockReturnValue(null),
  _fromWebContents: vi.fn(),
  _quit: vi.fn(),
  _buildAppMenu: vi.fn(),
  _applyMenuEnabled: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    quit: _quit,
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: _on,
    getPath: vi.fn((name: string) => (name === 'userData' ? '/mock/user/data' : '/mock/session')),
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getVersion: vi.fn().mockReturnValue('1.5.0'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: _getAllWindows,
    getFocusedWindow: _getFocusedWindow,
    fromWebContents: _fromWebContents,
  },
  ipcMain: { handle: _handle, on: _ipcOn },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn().mockReturnValue({}) },
  dialog: { showSaveDialog: vi.fn(), showErrorBox: vi.fn() },
  shell: { openPath: vi.fn() },
  screen: { getAllDisplays: vi.fn().mockReturnValue([{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]) },
}));

vi.mock('../../../src/main/window', () => ({ createMainWindow: _createMainWindow }));

vi.mock('../../../src/main/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(function () { return _settingsInstance; }),
  DEFAULT_SETTINGS: { theme: 'frosted', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
}));
vi.mock('../../../src/main/services/samples', () => ({
  SamplesService: vi.fn().mockImplementation(function () { return _samplesInstance; }),
}));
vi.mock('../../../src/main/services/engine', () => ({
  EngineService: vi.fn().mockImplementation(function () { return _engineInstance; }),
}));
vi.mock('../../../src/main/services/signature-service', () => ({
  SignatureService: vi.fn().mockImplementation(function () { return _sigInstance; }),
}));
vi.mock('../../../src/main/services/update-service', () => ({
  UpdateService: vi.fn().mockImplementation(function () { return _updateServiceInstance; }),
}));
vi.mock('../../../src/main/menu', () => ({
  buildAppMenu: _buildAppMenu,
  applyMenuEnabledState: _applyMenuEnabled,
}));
vi.mock('../../../src/main/services/dialog', () => ({
  openPdfDialog: vi.fn().mockResolvedValue(''),
  savePdfDialog: vi.fn().mockResolvedValue('/mock/saved.pdf'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeWindow {
  isDestroyed: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    isLoading: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
}

interface FakeWindowFixture {
  win: FakeWindow;
  loadHandlers: Array<() => void>;
  closedHandlers: Array<() => void>;
}

/** A fake main/print window. `sent` records every webContents.send call so a
 *  test can assert exactly which webContents received the request. */
function makeWindow(): FakeWindowFixture {
  const loadHandlers: Array<() => void> = [];
  const closedHandlers: Array<() => void> = [];
  const win: FakeWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    isMinimized: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isLoading: vi.fn().mockReturnValue(false),
      send: vi.fn(),
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'did-finish-load') loadHandlers.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'closed') closedHandlers.push(cb);
    }),
  };
  return { win, loadHandlers, closedHandlers };
}

type IndexModule = typeof import('../../../src/main/index');

async function loadIndex(): Promise<IndexModule> {
  vi.resetModules();
  return import('../../../src/main/index');
}

const A = 'C:\\docs\\a.pdf';
const B = 'C:\\docs\\b.pdf';

beforeEach(() => {
  vi.clearAllMocks();
  _handle.mockClear();
  _on.mockClear();
  _ipcOn.mockClear();
  _getAllWindows.mockReturnValue([]);
  _getFocusedWindow.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// DEF-300 routing
// ---------------------------------------------------------------------------

describe('DEF-300 — OS file-open routes to the main window', () => {
  it('delivers to the main window when the print window is first and focused', async () => {
    const main = makeWindow();
    const print = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);

    const index = await loadIndex();
    await index.start();

    // Two windows open: the print window is index 0 AND focused.
    _getAllWindows.mockReturnValue([print.win, main.win]);
    _getFocusedWindow.mockReturnValue(print.win);

    index.sendOpenPath(A);

    expect(main.win.webContents.send).toHaveBeenCalledTimes(1);
    expect(main.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, A);
    expect(print.win.webContents.send).not.toHaveBeenCalled();
  });

  it('queues for a still-loading main window and flushes on did-finish-load', async () => {
    const main = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);

    const index = await loadIndex();
    await index.start();

    main.win.webContents.isLoading.mockReturnValue(true);
    index.sendOpenPath(A);

    // Not delivered yet — the renderer is not ready.
    expect(main.win.webContents.send).not.toHaveBeenCalled();

    // The window finishes loading: the queued path is delivered.
    for (const cb of main.loadHandlers) cb();
    expect(main.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, A);
  });

  it('queues a launch-race request fired before the main window exists, then delivers it', async () => {
    // start() has not run: no main window, no recreate hook yet.
    const index = await loadIndex();

    index.sendOpenPath(A); // must not throw and must not vanish

    const main = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);
    await index.start();

    for (const cb of main.loadHandlers) cb();
    expect(main.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, A);
  });

  it('recreates a main window for the document when the main window was closed', async () => {
    const first = makeWindow();
    _createMainWindow.mockImplementation(() => first.win);

    const index = await loadIndex();
    await index.start();

    index.sendOpenPath(A);
    expect(first.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, A);

    // Main window closes while a print window keeps the app alive.
    for (const cb of first.closedHandlers) cb();

    const second = makeWindow();
    _createMainWindow.mockClear();
    _createMainWindow.mockImplementation(() => second.win);

    index.sendOpenPath(B);

    // A fresh main window is created and the path is delivered once it loads.
    expect(_createMainWindow).toHaveBeenCalledTimes(1);
    expect(second.win.webContents.send).not.toHaveBeenCalled();
    for (const cb of second.loadHandlers) cb();
    expect(second.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, B);
  });

  it('never routes to a non-main window when no main window exists', async () => {
    // No main window was ever created (createMainWindow returns undefined).
    const print = makeWindow();
    _createMainWindow.mockImplementation(() => undefined);

    const index = await loadIndex();
    await index.start();
    _getAllWindows.mockReturnValue([print.win]);
    _getFocusedWindow.mockReturnValue(print.win);

    expect(() => index.sendOpenPath(A)).not.toThrow();
    expect(print.win.webContents.send).not.toHaveBeenCalled();
  });
});