import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../../shared/types';

/**
 * Detects whether the app is running as a portable build.
 *
 * electron-builder portable builds extract the app to a temporary directory
 * and set PORTABLE_EXECUTABLE_DIR in the environment. If this variable is
 * present, the app is running from a portable build and auto-update is not
 * supported.
 */
export function isPortableBuild(): boolean {
  return process.env.PORTABLE_EXECUTABLE_DIR !== undefined
    && process.env.PORTABLE_EXECUTABLE_DIR !== '';
}

/**
 * Reads the `repository` field from package.json.
 * The field should be in "owner/repo" format, e.g. "tanzimtipu/TFlex".
 */
function readRepo(): string | undefined {
  try {
    const pkgPath = app.isPackaged
      ? join(app.getAppPath(), 'package.json')
      : join(app.getAppPath(), 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return typeof pkg.repository === 'string' ? pkg.repository : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parses the package.json `repository` field to extract owner and repo name.
 */
function parseRepo(repository: string): { owner: string; repo: string } | null {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

export type StatusCallback = (state: UpdateState) => void;

export class UpdateService {
  private _callbacks: StatusCallback[] = [];
  private _state: UpdateState;
  private _initialised = false;

  constructor() {
    this._state = { kind: 'checking' };
  }

  /**
   * Initialise the update service. If running as a portable build, sets
   * state to 'unsupported' immediately. Otherwise configures electron-updater
   * with the private GitHub repository and starts listening for update events.
   */
  init(): void {
    if (this._initialised) return;
    this._initialised = true;

    if (isPortableBuild()) {
      this._setState({
        kind: 'unsupported',
        reason: 'Portable builds do not support automatic updates.',
      });
      return;
    }

    const repoStr = readRepo();
    if (!repoStr) {
      this._setState({
        kind: 'error',
        message: 'Update repository not configured.',
      });
      return;
    }

    const repoInfo = parseRepo(repoStr);
    if (!repoInfo) {
      this._setState({
        kind: 'error',
        message: 'Update repository not configured.',
      });
      return;
    }

    const token = process.env.TFLEX_GH_TOKEN ?? process.env.GH_TOKEN ?? '';
    if (!token) {
      this._setState({
        kind: 'error',
        message: 'Update token not set (TFLEX_GH_TOKEN).',
      });
      return;
    }

    // Configure the auto-updater for a private GitHub repository.
    // The token is read from the environment and never committed to source.
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      private: true,
      token,
    });

    // Wire up autoUpdater events to our state machine.
    // Event types use the electron-updater UpdateInfo / UpdateDownloadedEvent
    // interfaces, so we use `any` for the version field extraction.
    autoUpdater.on('checking-for-update', () => {
      this._setState({ kind: 'checking' });
    });

    autoUpdater.on('update-available', (info: { version?: unknown; releaseDate?: unknown }) => {
      const version = typeof info.version === 'string' ? info.version : String(info.version ?? '');
      this._setState({
        kind: 'available',
        version,
        releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
      });
    });

    autoUpdater.on('update-not-available', (_info: unknown) => {
      this._setState({ kind: 'up-to-date', version: app.getVersion() });
    });

    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      this._setState({
        kind: 'downloading',
        progress: Math.round(progress.percent * 100) / 100,
      });
    });

    autoUpdater.on('update-downloaded', (info: { version?: unknown }) => {
      const version = typeof info.version === 'string' ? info.version : String(info.version ?? '');
      this._setState({ kind: 'downloaded', version });
    });

    autoUpdater.on('error', (err: Error) => {
      this._setState({
        kind: 'error',
        message: err.message ?? String(err),
      });
    });

    // Start checking (but don't auto-download — the user triggers download).
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // Kick off the initial check. autoUpdater emits events asynchronously.
    autoUpdater.checkForUpdates().catch((err: Error) => {
      this._setState({
        kind: 'error',
        message: err.message ?? String(err),
      });
    });
  }

  /** Returns the current update state synchronously. */
  getStatus(): UpdateState {
    return this._state;
  }

  /** Trigger download of the available update. No-op if not in 'available' state. */
  async download(): Promise<UpdateState> {
    if (this._state.kind !== 'available') {
      return this._state;
    }
    try {
      await autoUpdater.downloadUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._setState({ kind: 'error', message: msg });
    }
    return this._state;
  }

  /** Trigger quit-and-install. No-op if not in 'downloaded' state. */
  install(): void {
    if (this._state.kind !== 'downloaded') return;
    autoUpdater.quitAndInstall();
  }

  /** Register a callback for update state changes. Returns an unsubscribe function. */
  onStatusChanged(cb: StatusCallback): () => void {
    this._callbacks.push(cb);
    return () => {
      const idx = this._callbacks.indexOf(cb);
      if (idx >= 0) this._callbacks.splice(idx, 1);
    };
  }

  /** Update state and notify all listeners. */
  private _setState(state: UpdateState): void {
    this._state = state;
    const cbs = [...this._callbacks];
    for (const cb of cbs) {
      try { cb(state); } catch { /* ignore listener errors */ }
    }
  }
}