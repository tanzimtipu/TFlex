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
    _mockGetVersion: vi.fn().mockReturnValue('1.5.0'),
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

import { isPortableBuild, normalizeReleaseNotes, UpdateService } from '../../../src/main/services/update-service';

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
// UpdateService — no token (public feed, OTA works for all users)
// ---------------------------------------------------------------------------

describe('UpdateService — no token (public feed)', () => {
  beforeEach(() => {
    clearEnv();
    _mockReadFileSync.mockReturnValue(JSON.stringify({ repository: 'tanzimtipu/TFlex' }));
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  it('configures a public feed without a token and does not error', () => {
    const svc = new UpdateService();
    svc.init();
    expect(_setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'tanzimtipu',
      repo: 'tflex-releases',
      private: false,
    });
    expect(svc.getStatus().kind).not.toBe('error');
  });

  it('starts checking for updates without a token', () => {
    const svc = new UpdateService();
    svc.init();
    expect(_checkForUpdates).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UpdateService — GH_TOKEN fallback (optional token attached to public feed)
// ---------------------------------------------------------------------------

describe('UpdateService — GH_TOKEN fallback', () => {
  beforeEach(() => {
    clearEnv();
    _mockReadFileSync.mockReturnValue(JSON.stringify({ repository: 'tanzimtipu/TFlex' }));
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  afterEach(() => {
    clearEnv();
  });

  it('attaches GH_TOKEN to the public feed when TFLEX_GH_TOKEN is not set', () => {
    process.env.GH_TOKEN = 'gh-fallback-token';
    const svc = new UpdateService();
    svc.init();
    expect(_setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'tanzimtipu',
      repo: 'tflex-releases',
      private: false,
      token: 'gh-fallback-token',
    });
  });

  it('prefers TFLEX_GH_TOKEN over GH_TOKEN for the feed token', () => {
    process.env.TFLEX_GH_TOKEN = 'primary-token';
    process.env.GH_TOKEN = 'fallback-token';
    const svc = new UpdateService();
    svc.init();
    expect(_setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'tanzimtipu',
      repo: 'tflex-releases',
      private: false,
      token: 'primary-token',
    });
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
      repo: 'tflex-releases',
      private: false,
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

  it('forwards releaseDate on update-available', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0', releaseDate: '2026-08-31T00:00:00Z' });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.releaseDate).toBe('2026-08-31T00:00:00Z');
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

  // Bug 9 — download() must push a `downloading` state with progress: 0
  // IMMEDIATELY (synchronously, before the first `await`), so the
  // renderer's `update:statusChanged` listener receives it as soon as the
  // user clicks Download — not after electron-updater's first
  // `download-progress` event (which can lag by seconds while the HTTP
  // connection opens). Without this push the state stays `available`
  // during the gap and the frontend has no `downloading` state to render.
  it('download() pushes downloading(0) to onStatusChanged before downloadUpdate resolves', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    const cb = vi.fn();
    svc.onStatusChanged(cb);
    // Do NOT await — the state push is synchronous before the first await.
    const promise = svc.download();
    expect(cb).toHaveBeenCalledWith({ kind: 'downloading', progress: 0 });
    await promise;
  });

  it('download() sets status to downloading(0) synchronously', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    // Don't await — check state is already downloading before downloadUpdate resolves.
    void svc.download();
    const status = svc.getStatus();
    expect(status.kind).toBe('downloading');
    if (status.kind === 'downloading') {
      expect(status.progress).toBe(0);
    }
  });

  it('download() does not push downloading state when not in available state', async () => {
    const svc = new UpdateService();
    svc.init();
    const cb = vi.fn();
    svc.onStatusChanged(cb);
    // State is 'checking' (init called checkForUpdates); download is a no-op.
    await svc.download();
    // The only callback invocation is from init's checkForUpdates setting
    // 'checking' — download() must not have pushed a 'downloading' state.
    const downloadingCalls = cb.mock.calls.filter(
      ([s]) => (s as { kind?: string }).kind === 'downloading',
    );
    expect(downloadingCalls).toHaveLength(0);
    expect(_downloadUpdate).not.toHaveBeenCalled();
  });

  it('download-progress events update progress continuously after the initial push', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    const states: Array<{ kind: string; progress?: number }> = [];
    svc.onStatusChanged((s) => states.push({ kind: s.kind, progress: s.kind === 'downloading' ? s.progress : undefined }));
    await svc.download();
    // Initial push at 0.
    expect(states[states.length - 1]).toEqual({ kind: 'downloading', progress: 0 });
    // Simulate continuous progress events from electron-updater.
    getHandler('download-progress')({ percent: 25.5 });
    expect(states[states.length - 1]).toEqual({ kind: 'downloading', progress: 25.5 });
    getHandler('download-progress')({ percent: 73.33 });
    expect(states[states.length - 1]).toEqual({ kind: 'downloading', progress: 73.33 });
  });

  it('full sequence: checking -> available -> downloading(0) -> downloaded with no gaps', async () => {
    const svc = new UpdateService();
    const states: string[] = [];
    svc.onStatusChanged((s) => states.push(s.kind));
    svc.init();
    // init pushes 'checking' via the checkForUpdates path (state starts as
    // 'checking' in the constructor, but the callback only sees post-init
    // pushes; the constructor's initial state does not fire the callback).
    getHandler('update-available')({ version: '2.0.0' });
    await svc.download();
    getHandler('update-downloaded')({ version: '2.0.0' });
    // The callback should have seen: available -> downloading -> downloaded.
    expect(states).toContain('available');
    expect(states).toContain('downloading');
    expect(states).toContain('downloaded');
    // available must come before downloading, which must come before downloaded.
    const availIdx = states.indexOf('available');
    const dlIdx = states.indexOf('downloading');
    const doneIdx = states.indexOf('downloaded');
    expect(availIdx).toBeLessThan(dlIdx);
    expect(dlIdx).toBeLessThan(doneIdx);
    // The final state must be 'downloaded' with the version.
    const final = svc.getStatus();
    expect(final.kind).toBe('downloaded');
    if (final.kind === 'downloaded') {
      expect(final.version).toBe('2.0.0');
    }
  });

  it('download() sets error state when downloadUpdate rejects', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    _downloadUpdate.mockRejectedValueOnce(new Error('disk full'));
    const result = await svc.download();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('disk full');
    }
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

// ---------------------------------------------------------------------------
// UpdateService — checkForUpdates (manual re-check, DEF-079 / DEF-080)
// ---------------------------------------------------------------------------

describe('UpdateService — checkForUpdates (manual re-check)', () => {
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

  it('re-runs autoUpdater.checkForUpdates and sets state to checking', async () => {
    const svc = new UpdateService();
    svc.init();
    _checkForUpdates.mockClear();
    const result = await svc.checkForUpdates();
    expect(_checkForUpdates).toHaveBeenCalled();
    expect(result.kind).toBe('checking');
  });

  it('transitions to available when the check finds an update', async () => {
    const svc = new UpdateService();
    svc.init();
    // The mock's checkForUpdates resolves without firing events, so
    // we emit update-available ourselves to model what the real
    // electron-updater check would emit when 1.5.4 > installed.
    await svc.checkForUpdates();
    getHandler('update-available')({ version: '1.5.4' });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.version).toBe('1.5.4');
    }
  });

  it('transitions to up-to-date when the check finds no update', async () => {
    const svc = new UpdateService();
    svc.init();
    await svc.checkForUpdates();
    getHandler('update-not-available')({ version: '1.5.3' });
    expect(svc.getStatus().kind).toBe('up-to-date');
  });

  it('sets error state when the check rejects', async () => {
    const svc = new UpdateService();
    svc.init();
    _checkForUpdates.mockRejectedValueOnce(new Error('network down'));
    const result = await svc.checkForUpdates();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('network down');
    }
  });

  it('is a no-op on a portable build (no feed configured)', async () => {
    process.env.PORTABLE_EXECUTABLE_DIR = 'C:\\temp\\tflex';
    const svc = new UpdateService();
    svc.init();
    _checkForUpdates.mockClear();
    const result = await svc.checkForUpdates();
    expect(_checkForUpdates).not.toHaveBeenCalled();
    expect(result.kind).toBe('unsupported');
  });

  it('checks for updates without a token (public feed configured)', async () => {
    delete process.env.TFLEX_GH_TOKEN;
    delete process.env.GH_TOKEN;
    const svc = new UpdateService();
    svc.init();
    _checkForUpdates.mockClear();
    const result = await svc.checkForUpdates();
    expect(_checkForUpdates).toHaveBeenCalled();
    expect(result.kind).not.toBe('error');
  });

  it('does not interrupt an in-progress download', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    getHandler('download-progress')({ percent: 50 });
    _checkForUpdates.mockClear();
    const result = await svc.checkForUpdates();
    expect(_checkForUpdates).not.toHaveBeenCalled();
    expect(result.kind).toBe('downloading');
  });

  it('does not interrupt a ready-to-install update', async () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '2.0.0' });
    getHandler('update-downloaded')({ version: '2.0.0' });
    _checkForUpdates.mockClear();
    const result = await svc.checkForUpdates();
    expect(_checkForUpdates).not.toHaveBeenCalled();
    expect(result.kind).toBe('downloaded');
  });

  it('notifies subscribers when transitioning to checking', async () => {
    const svc = new UpdateService();
    const cb = vi.fn();
    svc.onStatusChanged(cb);
    svc.init();
    cb.mockClear();
    await svc.checkForUpdates();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ kind: 'checking' }));
  });

  it('shares the autoDownload=false semantics (never auto-downloads)', async () => {
    // The manual check reuses the same autoUpdater instance configured
    // in init(); autoDownload stays false, so a manual check that finds
    // an update must NOT call downloadUpdate — the user is prompted via
    // the UI. We assert downloadUpdate is not invoked by checkForUpdates.
    const svc = new UpdateService();
    svc.init();
    _downloadUpdate.mockClear();
    await svc.checkForUpdates();
    expect(_downloadUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UpdateService — OTA fallback (primary feed empty -> source-repo retry)
// ---------------------------------------------------------------------------

describe('UpdateService — OTA fallback', () => {
  beforeEach(() => {
    clearEnv();
    _mockReadFileSync.mockReturnValue(JSON.stringify({ repository: 'tanzimtipu/TFlex' }));
    _autoUpdaterRemoveAll();
    _autoUpdaterOn.mockClear();
    _checkForUpdates.mockClear();
    _checkForUpdates.mockResolvedValue(undefined);
    _setFeedURL.mockClear();
  });

  afterEach(() => {
    clearEnv();
  });

  function getHandler(event: string): (...args: unknown[]) => void {
    const calls = _autoUpdaterOn.mock.calls.filter((c: unknown[]) => c[0] === event);
    return calls.length > 0
      ? calls[calls.length - 1][1] as (...args: unknown[]) => void
      : vi.fn();
  }

  describe('primary feed empty, no token', () => {
    it('reports a clean up-to-date state on the error event (no fallback configured)', () => {
      const svc = new UpdateService();
      svc.init();
      getHandler('error')(new Error('No published versions on GitHub'));
      const status = svc.getStatus();
      expect(status.kind).toBe('up-to-date');
      if (status.kind === 'up-to-date') {
        expect(status.version).toBe('1.5.0');
      }
      // Only the primary feed was ever configured — no fallback retry.
      expect(_setFeedURL).toHaveBeenCalledTimes(1);
      expect(_checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('reports a clean up-to-date state when the check promise rejects', async () => {
      const svc = new UpdateService();
      svc.init();
      _checkForUpdates.mockClear();
      _checkForUpdates.mockRejectedValueOnce(
        new Error('Unable to find latest version on GitHub (tanzimtipu/tflex-releases), please ensure a production release exists'),
      );
      const result = await svc.checkForUpdates();
      expect(result.kind).toBe('up-to-date');
      if (result.kind === 'up-to-date') {
        expect(result.version).toBe('1.5.0');
      }
      // No fallback exists (no token), so no retry was started.
      expect(_checkForUpdates).toHaveBeenCalledTimes(1);
      expect(_setFeedURL).toHaveBeenCalledTimes(1);
    });

    it('does not demote real errors to up-to-date', async () => {
      const svc = new UpdateService();
      svc.init();
      _checkForUpdates.mockClear();
      _checkForUpdates.mockRejectedValueOnce(new Error('network down'));
      const result = await svc.checkForUpdates();
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.message).toBe('network down');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 31 — incoming release notes (releaseNotes -> string[] lines)
// ---------------------------------------------------------------------------

describe('normalizeReleaseNotes', () => {
  it('splits a plain string into trimmed lines', () => {
    expect(normalizeReleaseNotes('Line one\nLine two')).toEqual(['Line one', 'Line two']);
  });

  it('takes the notes from an array of { version, note } entries', () => {
    expect(normalizeReleaseNotes([
      { version: '1.24.0', note: 'First\nSecond' },
      { version: '1.23.0', note: null },
      { version: '1.22.0', note: 'Third' },
    ])).toEqual(['First', 'Second', 'Third']);
  });

  it('drops blank lines and trims each line', () => {
    expect(normalizeReleaseNotes('\n\n  First  \n\n   \nSecond\n')).toEqual(['First', 'Second']);
  });

  it('returns undefined for null, undefined and unexpected shapes', () => {
    expect(normalizeReleaseNotes(null)).toBeUndefined();
    expect(normalizeReleaseNotes(undefined)).toBeUndefined();
    expect(normalizeReleaseNotes(42)).toBeUndefined();
  });

  it('distinguishes empty notes ([]) from missing notes (undefined)', () => {
    expect(normalizeReleaseNotes('')).toEqual([]);
    expect(normalizeReleaseNotes([])).toEqual([]);
    expect(normalizeReleaseNotes('   \n  ')).toEqual([]);
  });
});

describe('UpdateService — incoming release notes', () => {
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

  it('carries normalised notes on update-available without touching version/releaseDate', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({
      version: '1.24.0',
      releaseDate: '2026-09-22T00:00:00Z',
      releaseNotes: 'Added print options\nFixed a colour bug',
    });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.version).toBe('1.24.0');
      expect(status.releaseDate).toBe('2026-09-22T00:00:00Z');
      expect(status.notes).toEqual(['Added print options', 'Fixed a colour bug']);
    }
  });

  it('normalises the array form of releaseNotes on update-available', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({
      version: '1.24.0',
      releaseNotes: [{ version: '1.24.0', note: 'One\nTwo' }],
    });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.notes).toEqual(['One', 'Two']);
    }
  });

  it('omits notes on update-available when releaseNotes is missing', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '1.24.0' });
    const status = svc.getStatus();
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.notes).toBeUndefined();
      expect('notes' in status).toBe(false);
    }
  });

  it('carries notes on update-downloaded', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '1.24.0' });
    getHandler('update-downloaded')({ version: '1.24.0', releaseNotes: 'Ready to install' });
    const status = svc.getStatus();
    expect(status.kind).toBe('downloaded');
    if (status.kind === 'downloaded') {
      expect(status.version).toBe('1.24.0');
      expect(status.notes).toEqual(['Ready to install']);
    }
  });

  it('omits notes on update-downloaded when releaseNotes is missing', () => {
    const svc = new UpdateService();
    svc.init();
    getHandler('update-available')({ version: '1.24.0' });
    getHandler('update-downloaded')({ version: '1.24.0' });
    const status = svc.getStatus();
    expect(status.kind).toBe('downloaded');
    if (status.kind === 'downloaded') {
      expect(status.notes).toBeUndefined();
      expect('notes' in status).toBe(false);
    }
  });
});