import { vi, describe, it, expect, beforeEach } from 'vitest';
import { IPC } from '../../../src/shared/ipc';
import {
  isPdfFamilyTarget,
  pdfFamilyTargetFor,
} from '../../../src/shared/file-associations';
import {
  isPdfFamilyTarget as isPdfFamilyTargetFromMain,
  pdfFamilyTargetFor as pdfFamilyTargetForFromMain,
} from '../../../src/main/open-path';

// Phase 97 - PDF-family open routing. The shared registry classifies the eight
// registration-only extensions and the `acrobat:` URL protocol. The main
// process `handleOsOpenPath` must route those through `sendOpenPath` (the
// existing app:openPathRequest IPC, reused - no new channel) instead of the
// fail-loud `dialog.showErrorBox` reserved for genuinely unsupported paths.
// A `.pdf` must keep its own loadPdfFile branch.

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
  _onBeforeSendHeaders,
  _showErrorBox,
} = vi.hoisted(() => ({
  _settingsInstance: {
    load: vi.fn().mockResolvedValue({
      ok: true,
      value: { theme: 'dark', geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: [] },
    }),
    save: vi.fn().mockResolvedValue(undefined),
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
  _onBeforeSendHeaders: vi.fn(),
  _showErrorBox: vi.fn(),
}));

vi.mock('electron', async () => ({
  app: {
    requestSingleInstanceLock: vi.fn().mockReturnValue(true),
    setName: vi.fn(),
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
  dialog: { showSaveDialog: vi.fn(), showErrorBox: _showErrorBox },
  shell: { openPath: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((text: string) =>
      Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
    ),
    decryptString: vi.fn().mockImplementation((buf: Buffer) =>
      Buffer.from(buf.toString('utf8'), 'base64').toString('utf8'),
    ),
  },
  screen: { getAllDisplays: vi.fn().mockReturnValue([{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]) },
  session: (await import('./helpers/electronSessionMock')).createElectronSessionMock(_onBeforeSendHeaders),
}));

vi.mock('../../../src/main/window', () => ({
  createMainWindow: _createMainWindow,
  installAuthPopupHandler: vi.fn(),
  deriveAuthHost: vi.fn().mockReturnValue(null),
}));
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

interface FakeWindow {
  isDestroyed: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: {
    isLoading: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
}

function makeWindow(): { win: FakeWindow; loadHandlers: Array<() => void> } {
  const loadHandlers: Array<() => void> = [];
  const win: FakeWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    isMinimized: vi.fn().mockReturnValue(false),
    isMaximized: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isLoading: vi.fn().mockReturnValue(false),
      send: vi.fn(),
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'did-finish-load') loadHandlers.push(cb);
      }),
    },
    on: vi.fn(),
  };
  return { win, loadHandlers };
}

type IndexModule = typeof import('../../../src/main/index');

async function loadIndex(): Promise<IndexModule> {
  vi.resetModules();
  return import('../../../src/main/index');
}

const FAMILY_EXTENSIONS = ['.aaui', '.bpdx', '.fdf', '.pdx', '.rmf', '.sequ', '.xdp', '.xfdf'] as const;

beforeEach(() => {
  vi.clearAllMocks();
  _getAllWindows.mockReturnValue([]);
  _getFocusedWindow.mockReturnValue(null);
});

describe('Phase 97 - shared PDF-family lookup', () => {
  it('accepts each family extension case-insensitively and marks it non-renderable', () => {
    for (const ext of FAMILY_EXTENSIONS) {
      expect(isPdfFamilyTarget(`C:\\docs\\sample${ext}`)).toBe(true);
      expect(isPdfFamilyTarget(`C:\\docs\\SAMPLE${ext.toUpperCase()}`)).toBe(true);
      const target = pdfFamilyTargetFor(`report${ext}`);
      expect(target).not.toBeNull();
      expect(target !== null && 'ext' in target ? target.ext : null).toBe(ext);
      expect(target !== null && 'renderable' in target ? target.renderable : true).toBe(false);
    }
  });

  it('accepts the acrobat: URL protocol and reports the scheme', () => {
    expect(isPdfFamilyTarget('acrobat:anything')).toBe(true);
    expect(isPdfFamilyTarget('ACROBAT:foo')).toBe(true);
    expect(pdfFamilyTargetFor('Acrobat://open')).toEqual({
      scheme: 'acrobat',
      label: 'acrobat URL protocol',
    });
  });

  it('rejects .pdf (renderable, its own path) and unknown types', () => {
    expect(isPdfFamilyTarget('C:\\docs\\report.pdf')).toBe(false);
    expect(isPdfFamilyTarget('notes.xyz')).toBe(false);
    expect(pdfFamilyTargetFor('report.pdf')).toBeNull();
    expect(pdfFamilyTargetFor('report.xyz')).toBeNull();
  });

  it('re-exports the same lookups through src/main/open-path', () => {
    expect(isPdfFamilyTargetFromMain).toBe(isPdfFamilyTarget);
    expect(pdfFamilyTargetForFromMain).toBe(pdfFamilyTargetFor);
  });
});

describe('Phase 97 - handleOsOpenPath family routing', { retry: 2 }, () => {
  it('routes a family path through sendOpenPath, never the error box', async () => {
    const main = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);

    const index = await loadIndex();
    await index.start();

    await index.handleOsOpenPath('C:\\docs\\sample.xdp');

    expect(main.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, 'C:\\docs\\sample.xdp');
    expect(_showErrorBox).not.toHaveBeenCalled();
  });

  it('routes the acrobat: protocol through sendOpenPath too', async () => {
    const main = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);

    const index = await loadIndex();
    await index.start();

    await index.handleOsOpenPath('acrobat:menu');

    expect(main.win.webContents.send).toHaveBeenCalledWith(IPC.appOpenPathRequestEvent, 'acrobat:menu');
    expect(_showErrorBox).not.toHaveBeenCalled();
  });

  it('still fails loud with the error box for an unregistered type', async () => {
    const main = makeWindow();
    _createMainWindow.mockImplementation(() => main.win);

    const index = await loadIndex();
    await index.start();

    await index.handleOsOpenPath('C:\\docs\\notes.xyz');

    expect(_showErrorBox).toHaveBeenCalledTimes(1);
    expect(main.win.webContents.send).not.toHaveBeenCalled();
  });
});
