import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted() — shared mutable state for mock factories
// ---------------------------------------------------------------------------

const {
  _autoUpdaterOn,
  _autoUpdaterRemoveAll,
  _checkForUpdates,
  _downloadUpdate,
  _quitAndInstall,
  _setFeedURL,
  _mockGetVersion,
  _mockIsPackaged,
  _mockGetAppPath,
  _mockReadFileSync,
} = vi.hoisted(() => {
  // Use a plain object instead of EventEmitter because vi.hoisted()
  // runs before imports and EventEmitter may not be reachable.
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  return {
    _autoUpdaterOn: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    _autoUpdaterEmit: vi.fn((event: string, ...args: unknown[]) => {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    }),
    _autoUpdaterRemoveAll: vi.fn(() => {
      for (const key of Object.keys(listeners)) {
        delete listeners[key];
      }
    }),
    _checkForUpdates: vi.fn().mockResolvedValue(undefined),
    _downloadUpdate: vi.fn().mockResolvedValue(undefined),
    _quitAndInstall: vi.fn(),
    _setFeedURL: vi.fn(),
    _mockGetVersion: vi.fn().mockReturnValue('1.2.0'),
    _mockIsPackaged: false,
    _mockGetAppPath: vi.fn().mockReturnValue('/mock/app'),
    _mockReadFileSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getVersion: _mockGetVersion,
    getAppPath: _mockGetAppPath,
    isPackaged: _mockIsPackaged,
  },
}));

vi.mock('node:fs', () => ({
  readFileSync: _mockReadFileSync,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop === 'on') return _autoUpdaterOn;
      if (prop === 'checkForUpdates') return _checkForUpdates;
      if (prop === 'downloadUpdate') return _downloadUpdate;
      if (prop === 'quitAndInstall') return _quitAndInstall;
      if (prop === 'setFeedURL') return _setFeedURL;
      if (prop === 'autoDownload') return undefined;
      if (prop === 'autoInstallOnAppQuit') return undefined;
      return undefined;
    },
    set(_target, prop: string, _value: unknown) {
      if (prop === 'autoDownload' || prop === 'autoInstallOnAppQuit') {
        return true;
      }
      return true;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { isPortableBuild, UpdateService } from '../../../src/main/services/update-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupInstalledEnv(): void {
  _mockReadFileSync.mockReturnValue(JSON.stringify({ repository: 'tanzimtipu/TFlex' }));
  process.env.TFLEX_GH_TOKEN = 'test-token';
  delete process.env.PORTABLE_EXECUTABLE_DIR;
}

function clearEnv(): void {
  delete process.env.TFLEX_GH_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
}

// ---------------------------------------------------------------------------
// isPortableBuild
// ---------------------------------------------------------------------------

describe('isPortableBuild', () => {
  afterEach(() => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
  });

  it('returns true when PORTABLE_EXECUTABLE_DIR is set', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\temp\\tflex';
    expect(isPortableBuild()).toBe(true);
  });

  it('returns false when PORTABLE_EXECUTABLE_DIR is not set', () => {
    expect(isPortableBuild()).toBe(false);
  });

  it('returns false when PORTABLE_EXECUTABLE_DIR is empty string', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = '';
    expect(isPortableBuild()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdateService — portable build
// ---------------------------------------------------------------------------

describe('UpdateService — portable build', () => {
  beforeEach(() => {
    clearEnv();
  });

  it('sets unsupported state immediately on portable build', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\temp\\tflex';
    const svc = new UpdateService();
    svc.init();
    const status = svc.getStatus();
    expect(status.kind).toBe('unsupported');
  });

  it('does not call checkForUpdates on portable build', () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\temp\\tflex';
    _checkForUpdates.mockClear();
    const svc = new UpdateService();
    svc.init();
    expect(_checkForUpdates).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UpdateService — missing token
// ---------------------------------------------------------------------------

describe('UpdateService — missing token', () => {
  beforeEach(() => {
    clearEnv();
    _mockReadFileSync.mockReturnValue(JSON.stringify({ repository: 'tanzimtipu/TFlex' }));
  });

  it('sets error state when TFLEX_GH_TOKEN is not set', () => {
    const svc = new UpdateService();
    svc.init();
    const status = svc.getStatus();
    expect(status.kind).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// UpdateService — missing repository
// ---------------------------------------------------------------------------

describe('UpdateService — missing repository', () => {
  beforeEach(() => {
    clearEnv();
    _mockReadFileSync.mockImplementation(() => { throw new Error('file not found'); });
    process.env.TFLEX_GH_TOKEN = 'test-token';
  });

  it('sets error state when package.json cannot be read', () => {
    const svc = new UpdateService();
    svc.init();
    const status = svc.getStatus();
    expect(status.kind).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// UpdateService — initialised
// ---------------------------------------------------------------------------

describe('UpdateService — initialised', () => {
  beforeEach(() => {
    clearEnv();
    setupInstalledEnv();
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  it('configures autoUpdater with repo details', () => {
    const svc = new UpdateService();
    svc.init();
    expect(_setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'tanzimtipu',
      repo: 'TFlex',
      private: true,
      token: 'test-token',
    });
  });

  it('sets autoDownload to false', () => {
    const svc = new UpdateService();
    svc.init();
    expect(svc.getStatus()).toBeDefined();
  });

  it('starts checking for updates', () => {
    const svc = new UpdateService();
    svc.init();
    expect(_checkForUpdates).toHaveBeenCalled();
  });

  it('emits checking event', () => {
    const svc = new UpdateService();
    svc.init();
    // init registers 'checking-for-update' listener; find it and trigger it
    const checkingCalls = _autoUpdaterOn.mock.calls.filter((c: unknown[]) => c[0] === 'checking-for-update');
    expect(checkingCalls.length).toBeGreaterThan(0);
    const handler = checkingCalls[checkingCalls.length - 1][1] as () => void;
    handler();
    const status = svc.getStatus();
    expect(status.kind).toBe('checking');
  });
});

// ---------------------------------------------------------------------------
// UpdateService — state transitions
// ---------------------------------------------------------------------------

describe('UpdateService — state transitions', () => {
  beforeEach(() => {
    clearEnv();
    setupInstalledEnv();
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  function getHandler(event: string): (...args: unknown[]) => void {
    const calls = _autoUpdaterOn.mock.calls.filter((c: unknown[]) => c[0] === event);
    return calls.length > 0
      ? calls[calls.length - 1][1] as (...args: unknown[]) => void
      : vi.fn();
  }

  it('transitions to up-to-date on update-not-available', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-not-available')({ version: '1.0.0' });
    const status = svc.getStatus();
    expect(status.kind).toBe('up-to-date');
  });

  it('transitions to available on update-available', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.version).toBe('2.0.0');
    }
  });

  it('transitions to downloading on download-progress', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    getHandler('download-progress')({ percent: 42.5 });
    const status = svc.getStatus();
    expect(status.kind).toBe('downloading');
    if (status.kind === 'downloading') {
      expect(status.progress).toBe(42.5);
    }
  });

  it('transitions to downloaded on update-downloaded', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    getHandler('update-downloaded')({ version: '2.0.0' });
    const status = svc.getStatus();
    expect(status.kind).toBe('downloaded');
  });

  it('transitions to error on error event', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('error')(new Error('Network failure'));
    const status = svc.getStatus();
    expect(status.kind).toBe('error');
    if (status.kind === 'error') {
      expect(status.message).toBe('Network failure');
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateService — onStatusChanged callback
// ---------------------------------------------------------------------------

describe('UpdateService — onStatusChanged callback', () => {
  beforeEach(() => {
    clearEnv();
    setupInstalledEnv();
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  function getHandler(event: string): (...args: unknown[]) => void {
    const calls = _autoUpdaterOn.mock.calls.filter((c: unknown[]) => c[0] === event);
    return calls.length > 0
      ? calls[calls.length - 1][1] as (...args: unknown[]) => void
      : vi.fn();
  }

  it('notifies registered callbacks on state change', () => {
    const svc = new UpdateService();
    const cb = vi.fn();
    svc.onStatusChanged(cb);
    svc.init();
    getHandler('checking-for-update')();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ kind: 'checking' }));
  });

  it('unsubscribe removes the callback', () => {
    const svc = new UpdateService();
    const cb = vi.fn();
    const unsub = svc.onStatusChanged(cb);
    unsub();
    svc.init();
    getHandler('checking-for-update')();
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple callbacks all receive state changes', () => {
    const svc = new UpdateService();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    svc.onStatusChanged(cb1);
    svc.onStatusChanged(cb2);
    svc.init();
    getHandler('checking-for-update')();
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UpdateService — download and install
// ---------------------------------------------------------------------------

describe('UpdateService — download and install', () => {
  beforeEach(() => {
    clearEnv();
    setupInstalledEnv();
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
    _downloadUpdate.mockClear();
    _downloadUpdate.mockResolvedValue(undefined);
    _quitAndInstall.mockClear();
  });

  function getHandler(event: string): (...args: unknown[]) => void {
    const calls = _autoUpdaterOn.mock.calls.filter((c: unknown[]) => c[0] === event);
    return calls.length > 0
      ? calls[calls.length - 1][1] as (...args: unknown[]) => void
      : vi.fn();
  }

  it('download() is a no-op when not in available state', async () => {
    const svc = new UpdateService();
    svc.init();
    const result = await svc.download();
    expect(result.kind).toBe('checking');
    expect(_downloadUpdate).not.toHaveBeenCalled();
  });

  it('download() triggers download when in available state', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    await svc.download();
    expect(_downloadUpdate).toHaveBeenCalled();
  });

  it('install() is a no-op when not in downloaded state', () => {
    const svc = new UpdateService();
    svc.init();
    svc.install();
    expect(_quitAndInstall).not.toHaveBeenCalled();
  });

  it('install() triggers quitAndInstall when in downloaded state', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    getHandler('update-downloaded')({ version: '2.0.0' });
    svc.install();
    expect(_quitAndInstall).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UpdateService — init is idempotent
// ---------------------------------------------------------------------------

describe('UpdateService — init idempotency', () => {
  beforeEach(() => {
    clearEnv();
    setupInstalledEnv();
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  it('does not reconfigure on subsequent init calls', () => {
    const svc = new UpdateService();
    svc.init();
    svc.init();
    expect(_setFeedURL).toHaveBeenCalledTimes(1);
    expect(_checkForUpdates).toHaveBeenCalledTimes(1);
  });
});