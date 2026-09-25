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

/**
 * Normalises electron-updater's `releaseNotes` into plain text lines for the
 * renderer. The feed gives either a plain string (the GitHub release body) or
 * an array of `{ version, note }` entries; a note may be null.
 *
 * Returns `undefined` when there are no notes at all (missing, null or an
 * unexpected shape) so the UI can tell "no notes" apart from "empty notes"
 * (an empty array). Lines are trimmed and blank lines are dropped. No markup
 * is stripped or injected: the renderer shows these lines as PLAIN TEXT.
 */
export function normalizeReleaseNotes(releaseNotes: unknown): string[] | undefined {
  let text: string | null = null;
  if (typeof releaseNotes === 'string') {
    text = releaseNotes;
  } else if (Array.isArray(releaseNotes)) {
    const notes = releaseNotes
      .map((entry) => (entry && typeof entry === 'object'
        ? (entry as { note?: unknown }).note
        : undefined))
      .filter((note): note is string => typeof note === 'string');
    text = notes.join('\n');
  }
  if (text === null) return undefined;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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
  /** The feed currently configured on autoUpdater. Used to name the feed in
   *  user-facing "no releases published" messages. */
  private _activeFeed: { owner: string; repo: string } | null = null;

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
    //   latest.yml                                — SINGLE manifest listing BOTH
    //                                               arch installers in `files:`
    //   TFlex-Setup-<version>-x64.exe             — x64 NSIS installer
    //   TFlex-Setup-<version>-x64.exe.blockmap    — x64 differential blockmap
    //   TFlex-Setup-<version>-ia32.exe            — ia32 NSIS installer
    //   TFlex-Setup-<version>-ia32.exe.blockmap   — ia32 differential blockmap
    //
    // Windows emits ONLY latest.yml for every architecture (electron-builder's
    // getArchPrefixForUpdateFile returns "" off Linux), so BOTH archs request
    // the same channel file. Per-arch correctness comes from the artifact
    // NAMES: NsisUpdater's findFile(files, "exe") prefers the files[] entry
    // whose URL contains `process.arch`, so an installed x64 build picks the
    // `-x64` installer and an installed ia32 build picks `-ia32`. The names
    // MUST therefore keep the `-x64` / `-ia32` token. A per-machine install
    // additionally carries `isAdminRightsRequired: true` per file, so the
    // updater re-runs the installer elevated via resources/elevate.exe.
    // The portable builds (TFlex-<version>-portable-<arch>.exe) are NOT listed
    // in latest.yml and are gated by isPortableBuild() above.
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
    this._feedConfigured = true;
    // Operator-facing diagnostics (main process only).
    console.log(`[update] feed ${this._activeFeed.owner}/${this._activeFeed.repo}`);

    // Wire up autoUpdater events to our state machine.
    // Event types use the electron-updater UpdateInfo / UpdateDownloadedEvent
    // interfaces, so we use `any` for the version field extraction.
    autoUpdater.on('checking-for-update', () => {
      this._setState({ kind: 'checking' });
    });

    autoUpdater.on('update-available', (info: { version?: unknown; releaseDate?: unknown; releaseNotes?: unknown }) => {
      const version = typeof info.version === 'string' ? info.version : String(info.version ?? '');
      const notes = normalizeReleaseNotes(info.releaseNotes);
      this._setState({
        kind: 'available',
        version,
        releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined,
        ...(notes !== undefined ? { notes } : {}),
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

    autoUpdater.on('update-downloaded', (info: { version?: unknown; releaseNotes?: unknown }) => {
      const version = typeof info.version === 'string' ? info.version : String(info.version ?? '');
      const notes = normalizeReleaseNotes(info.releaseNotes);
      this._setState({
        kind: 'downloaded',
        version,
        ...(notes !== undefined ? { notes } : {}),
      });
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
   *  the rejected `checkForUpdates()` promise report the same failure.
   *
   *  A "no releases published" failure is treated as up-to-date (the user
   *  is on a build that predates the first public release, or the releases
   *  repo is genuine empty for the first push). Genuine failures (network,
   *  auth, malformed feed) surface as `error`. */
  private _handleCheckError(message: string): void {
    if (!isNoReleasesError(message)) {
      this._setState({ kind: 'error', message });
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