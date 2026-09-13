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
 * Only the `owner` is consumed at runtime — the source repo NAME is the
 * private code repo and is NOT the update feed. Release artifacts are
 * published to the separate public repo named below.
 */
function parseRepo(repository: string): { owner: string; repo: string } | null {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Name of the PUBLIC GitHub repository that holds only release artifacts
 * (latest.yml, the NSIS installer and its blockmap). The source repo
 * (package.json `repository`) stays private; only release binaries live
 * here, so end users need NO token to check for or download updates.
 *
 * MUST match the `publish.repo` in electron-builder.yml — that is where
 * electron-builder uploads the assets this feed reads. The owner is taken
 * from package.json so the two stay on the same GitHub account.
 */
const RELEASES_REPO = 'tflex-releases';

/**
 * GitHub feed configuration passed to `autoUpdater.setFeedURL`.
 *
 * electron-updater v6 selects the provider by TOKEN, not by the `private`
 * flag: whenever a token is present it uses the API-based
 * PrivateGitHubProvider (Authorization: token), which can read releases in
 * BOTH public and private repositories. `private: false` plus an explicit
 * token keeps the documented TFLEX_GH_TOKEN > GH_TOKEN precedence and stops
 * the provider factory from substituting a raw GH_TOKEN env value.
 */
type GithubFeedConfig = {
  provider: 'github';
  owner: string;
  repo: string;
  private: boolean;
  token?: string;
};

/**
 * Matches the error signatures electron-updater emits when the feed
 * repository EXISTS but has ZERO releases (as opposed to network, auth or
 * malformed-feed failures):
 *
 * - "No published versions on GitHub" — feed without a token: the Atom
 *   feed at github.com/{owner}/{repo}/releases.atom is an empty <feed>
 *   with no <entry> elements, and the provider throws
 *   (ERR_XML_MISSED_ELEMENT).
 * - "Unable to find latest version on GitHub (...), please ensure a
 *   production release exists" — the same empty state via the
 *   releases/latest lookup.
 * - "Cannot read properties of undefined (reading 'assets')" — feed WITH
 *   a token: the API releases list is an empty array and
 *   PrivateGitHubProvider (electron-updater v6) dereferences `assets` on
 *   the missing first element instead of reporting a friendly error.
 */
function isNoReleasesError(message: string): boolean {
  return (
    /no published versions/i.test(message) ||
    /ensure a production release exists/i.test(message) ||
    /cannot read properties of undefined \(reading 'assets'\)/i.test(message)
  );
}

export type StatusCallback = (state: UpdateState) => void;

export class UpdateService {
  private _callbacks: StatusCallback[] = [];
  private _state: UpdateState;
  private _initialised = false;
  /** True once `init()` has configured the autoUpdater with a real feed
   *  (not portable, repo resolved). Gates the manual `checkForUpdates()`
   *  path so it is a clean no-op when there is no feed to query instead of
   *  calling autoUpdater with an unconfigured client. A token is NOT
   *  required — the public releases repo needs no auth. */
  private _feedConfigured = false;
  /** The feed currently configured on autoUpdater (primary public feed, or
   *  the source-repo fallback once the latter has been activated). Used to
   *  name the feed in user-facing "no releases published" messages. */
  private _activeFeed: { owner: string; repo: string } | null = null;
  /** Fallback feed: the PRIVATE source repo (package.json `repository`),
   *  which holds the full historical release list. Set in `init()` only
   *  when a runtime token is available — a token is what makes the private
   *  repo readable. Consumed at most once (see `_fallbackUsed`). */
  private _fallbackFeed: GithubFeedConfig | null = null;
  /** True once the source-repo fallback check has run, so a failing
   *  fallback cannot loop the fallback logic. */
  private _fallbackUsed = false;

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

    // The auto-updater reads from a PUBLIC GitHub repository that holds only
    // release artifacts (latest.yml + installer + blockmap). The source repo
    // (package.json `repository`) stays PRIVATE; release binaries are
    // published to the separate public repo `tflex-releases` by
    // electron-builder (see the `publish` block in electron-builder.yml).
    //
    // Because the feed repo is public, NO token is required to check for or
    // download updates — this is what makes OTA work for every user, not
    // just the developer's machine. A token is still OPTIONAL: when
    // TFLEX_GH_TOKEN / GH_TOKEN is present in the environment it is attached
    // to the feed so the GitHub API calls are authenticated (higher rate
    // limit). Users never set it; the developer may, for convenience.
    //
    // `private: false` tells electron-updater's GitHubProvider to make
    // unauthenticated requests by default (and to send `Authorization` only
    // when a token is supplied below). Release assets on a public repo are
    // downloadable without auth — the 404-on-private-asset problem that the
    // old `private: true` + mandatory-token path worked around is gone.
    //
    // Feed assets consumed from the GitHub release (uploaded by the
    // `electron-builder --publish` release pipeline — see
    // electron-builder.yml for the exact asset names):
    //   latest.yml                           — update manifest (version + sha512)
    //   TFlex-Setup-<version>.exe             — NSIS installer
    //   TFlex-Setup-<version>.exe.blockmap    — differential update blockmap
    // The portable build (TFlex-<version>-portable.exe) is NOT listed in
    // latest.yml and is gated by isPortableBuild() above.
    //
    // Token env vars (read at RUNTIME from the process environment, never
    // committed to source):
    //   TFLEX_GH_TOKEN  — primary (TFlex-specific; avoids clashing with
    //                    other tooling that reads GH_TOKEN)
    //   GH_TOKEN        — fallback (matches electron-builder / gh CLI)
    const token = process.env.TFLEX_GH_TOKEN ?? process.env.GH_TOKEN ?? '';

    autoUpdater.setFeedURL({
      provider: 'github',
      owner: repoInfo.owner,
      repo: RELEASES_REPO,
      private: false,
      ...(token ? { token } : {}),
    });
    this._activeFeed = { owner: repoInfo.owner, repo: RELEASES_REPO };
    if (token) {
      // The private source repo (package.json `repository`) holds the full
      // historical release list. It is only reachable WITH a token, so the
      // fallback feed exists only when a token is present. `private: true`
      // plus the token keeps electron-updater on the API-based provider,
      // which can read releases in private repos.
      this._fallbackFeed = {
        provider: 'github',
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        private: true,
        token,
      };
    }
    this._fallbackUsed = false;
    this._feedConfigured = true;
    // Operator-facing diagnostics (main process only).
    console.log(
      `[update] feed ${this._activeFeed.owner}/${this._activeFeed.repo}` +
        (this._fallbackFeed
          ? `, fallback ${this._fallbackFeed.owner}/${this._fallbackFeed.repo}`
          : ''),
    );

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
      this._handleCheckError(err.message ?? String(err));
    });

    // Start checking (but don't auto-download — the user is prompted to
    // download via the About/toolbar indicator, per the Phase-6 requirement:
    // "silent download + prompt restart" means the CHECK is silent on start
    // and the DOWNLOAD is user-initiated, not auto-triggered on availability).
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // Kick off the initial check. autoUpdater emits events asynchronously.
    autoUpdater.checkForUpdates().catch((err: Error) => {
      this._handleCheckError(err.message ?? String(err));
    });
  }

  /** Returns the current update state synchronously. */
  getStatus(): UpdateState {
    return this._state;
  }

  /** DEF-079 / DEF-080 — manually re-trigger an update check
   *  (Help -> Check for Update). Mirrors the start-path check in
   *  `init()` but driven by the user instead of launch. Reuses the
   *  same `autoUpdater` instance, so the `autoDownload = false`
   *  semantics set in `init()` carry over: the check never
   *  auto-downloads; the renderer prompts the user to download via
   *  `update.download()` once the state flips to 'available'. Both
   *  the launch check and this manual check therefore share the
   *  same "check, then let the user download" semantics.
   *
   *  Returns the resulting `UpdateState` after the check resolves.
   *  Portable builds and misconfigured feeds (no repo) return their
   *  current state without re-checking — there is no feed to query. An in-progress download or a ready-to-install
   *  update is not interrupted (the user should finish or install
   *  those, not re-check). */
  async checkForUpdates(): Promise<UpdateState> {
    if (!this._feedConfigured) {
      return this._state;
    }
    // Don't interrupt an active download or a ready-to-install update.
    if (this._state.kind === 'downloading' || this._state.kind === 'downloaded') {
      return this._state;
    }
    // autoDownload stays false (set in init): the manual check never
    // auto-downloads; the user is prompted via the UI, matching the
    // start-path check.
    this._setState({ kind: 'checking' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._handleCheckError(msg);
    }
    return this._state;
  }

  /** Shared handler for a failed update check. Both the `error` event and
   *  the rejected `checkForUpdates()` promise report the same failure, so
   *  both routes funnel through here (the `_fallbackUsed` flag makes the
   *  double delivery idempotent).
   *
   *  A "no releases published" failure on the active feed is not something
   *  the user can act on: if a token-backed fallback feed (the private
   *  source repo, which keeps the full historical release list) is
   *  configured and has not been consumed yet, switch to it and retry
   *  once. Otherwise — and when the fallback itself finds no releases —
   *  report a clean `up-to-date` state instead of a raw error. Genuine
   *  failures (network, auth, malformed feed) still surface as `error`. */
  private _handleCheckError(message: string): void {
    if (!isNoReleasesError(message)) {
      this._setState({ kind: 'error', message });
      return;
    }
    if (this._fallbackFeed && !this._fallbackUsed) {
      this._fallbackUsed = true;
      this._activeFeed = { owner: this._fallbackFeed.owner, repo: this._fallbackFeed.repo };
      autoUpdater.setFeedURL(this._fallbackFeed);
      void autoUpdater.checkForUpdates().catch((err: Error) => {
        this._handleCheckError(err.message ?? String(err));
      });
      return;
    }
    this._setState({ kind: 'up-to-date', version: app.getVersion() });
  }

  /** Trigger download of the available update. No-op if not in 'available' state.
   *
   *  Pushes a `downloading` state with `progress: 0` IMMEDIATELY before calling
   *  `autoUpdater.downloadUpdate()`, so the renderer receives the
   *  `downloading` state via `update:statusChanged` as soon as the user
   *  clicks Download — not after the first `download-progress` event (which
   *  can lag by seconds while electron-updater opens the HTTP connection and
   *  waits for the first bytes). Subsequent `download-progress` events update
   *  the progress continuously; `update-downloaded` flips to `downloaded`. */
  async download(): Promise<UpdateState> {
    if (this._state.kind !== 'available') {
      return this._state;
    }
    this._setState({ kind: 'downloading', progress: 0 });
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