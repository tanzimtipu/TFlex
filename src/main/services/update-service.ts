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
 * In both dev and packaged builds `app.getAppPath()` resolves to the
 * directory that contains package.json (the project root in dev, the
 * app bundle root inside the ASAR archive when packaged).
 */
function readRepo(): string | undefined {
  try {
    const pkgPath = join(app.getAppPath(), 'package.json');
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

    // Configure the auto-updater for a PRIVATE GitHub repository.
    //
    // `private: true` tells electron-updater's GitHubProvider to send
    // `Authorization: token <TOKEN>` on BOTH the release-info API call AND
    // the asset download request. Without it the provider would download
    // without auth and get a 404 from GitHub — private release assets are
    // invisible without the header. This is the private-bin vs public
    // provider distinction: a public repo would omit `private` (or set it
    // false) and need no token for downloads.
    //
    // Token env vars (read at RUNTIME from the process environment, never
    // committed to source):
    //   TFLEX_GH_TOKEN  — primary (TFlex-specific; avoids clashing with
    //                    other tooling that reads GH_TOKEN)
    //   GH_TOKEN        — fallback (matches electron-builder / gh CLI)
    // The operator injects one of these into the environment before
    // launching the app. Without a token the service sets 'error' state
    // above and no update is offered.
    //
    // Feed assets consumed from the GitHub release (uploaded by the
    // `electron-builder --publish` release pipeline — see
    // electron-builder.yml for the exact asset names):
    //   latest.yml                           — update manifest (version + sha512)
    //   TFlex-Setup-<version>.exe             — NSIS installer
    //   TFlex-Setup-<version>.exe.blockmap    — differential update blockmap
    // The portable build (TFlex-<version>-portable.exe) is NOT listed in
    // latest.yml and is gated by isPortableBuild() above.
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

    // Start checking (but don't auto-download — the user is prompted to
    // download via the About/toolbar indicator, per the Phase-6 requirement:
    // "silent download + prompt restart" means the CHECK is silent on start
    // and the DOWNLOAD is user-initiated, not auto-triggered on availability).
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