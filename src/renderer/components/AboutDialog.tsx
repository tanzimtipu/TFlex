// Phase 6/13 — About dialog.
//
// Opens as a Sheet on top of the app. Reads `AppInfo` from the backend
// over IPC (app.getInfo) — the contract entry is in src/shared/ipc.ts,
// but the renderer is defensive: if the preload wiring hasn't shipped
// yet (the backend side is still being added in parallel), the dialog
// shows a sensible fallback ("Version unavailable") instead of
// crashing. Once backend-dev lands the wiring, the real version and
// electron / node versions will populate automatically.
//
// Phase 13 / DEF-074 — the dialog now also surfaces the OTA update
// state. The update service reports one of seven `kind`s (see
// UpdateState in src/shared/types.ts); each gets an explicit
// renderer-side branch so the UI can never silently mislabel an
// `'unsupported'` portable build as "Up to date". The reason string
// for `'unsupported'` is rendered so the user sees why auto-update
// isn't available (e.g. portable build vs missing publisher creds).

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { AppInfo, UpdateState } from '../../shared/types';
import { whatsNewFor, whatsNewHistory } from '../../shared/whatsNew';
import { TfBackdrop, TfSheet } from './motion/TfMotion';
import { BrandMark } from './BrandMark';
import { BrandWordmark } from './BrandWordmark';

/** Phase 31 — how many older changelog entries the compact history
 *  list shows. The changelog is bundled (offline) and grows by one
 *  entry per release, so we cap the list rather than rendering an
 *  unbounded column; the running version's own entry is always
 *  shown above it in full. */
const WHATS_NEW_HISTORY_LIMIT = 3;

/** Phase 31 — the INCOMING-version notes carried by the OTA feed.
 *  Only `available` and `downloaded` carry notes; every other kind
 *  returns null so the incoming block (and its empty state) is not
 *  rendered at all. Kept as a small pure helper so the narrowing is
 *  in one place and stays exhaustive-safe.
 *
 *  DEF-275 — the payload crosses the IPC boundary, so it is treated
 *  as untrusted even though the contract types it as `string` /
 *  `string[]`. A non-primitive `version` and a non-array `notes` (or
 *  non-string lines inside it) previously threw during render and
 *  unmounted the whole app. Normalising here keeps the render path
 *  clean: the version is coerced to a string, and notes become a
 *  `string[]` (or `undefined`) so the existing empty states handle
 *  every malformed shape. */
export function incomingNotesState(
  state: UpdateState | null | undefined,
): { version: string; notes: string[] | undefined } | null {
  if (state === null || state === undefined) return null;
  if (state.kind === 'available' || state.kind === 'downloaded') {
    const version = typeof state.version === 'string' ? state.version : String(state.version);
    const notes = Array.isArray(state.notes)
      ? state.notes.filter((line): line is string => typeof line === 'string')
      : undefined;
    return { version, notes };
  }
  return null;
}

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  /** OTA UX — Help -> Check for Update handler. The host wires
   *  this to the same trigger that drives UpdatePromptDialog
   *  (calls `update.checkForUpdates()` if available, opens the
   *  prompt). The About dialog surfaces it as a button in the
   *  meta footer so users on the about sheet have a direct path
   *  to manual update checks without going through the menu. */
  onCheckForUpdate?: () => void;
}

const FALLBACK_INFO: AppInfo = {
  version: 'unavailable',
  electronVersion: 'unavailable',
  nodeVersion: 'unavailable',
  storagePaths: {
    userData: 'unavailable',
    settings: 'unavailable',
    signatures: 'unavailable',
    cache: 'unavailable',
  },
};

/** Map an UpdateState to the label the About dialog shows. Kept
 *  here (not in shared/) because the strings are UI copy. The
 *  switch is exhaustive over UpdateState's seven kinds — adding
 *  a new kind to the union will trigger a TS error here, which
 *  is exactly what we want so the label list never goes stale
 *  relative to the backend contract.
 *
 *  DEF-074 — `'unsupported'` MUST show "Portable build (no
 *  auto-update)" (or the build's `reason` if present) so the
 *  user can distinguish a portable build from a build that's
 *  actually up to date. The previous render path didn't have
 *  this branch and fell through to the up-to-date label,
 *  misleading the user. */
export function describeUpdateState(state: UpdateState): string {
  switch (state.kind) {
    case 'unsupported':
      // Phase 13 / DEF-074 — explicit portable-build label so
      // users on an auto-update-incapable build can tell at a
      // glance. Surface the backend's reason when it carries
      // additional context (e.g. "Portable build does not
      // support auto-update").
      return state.reason.length > 0
        ? `Portable build (${state.reason})`
        : 'Portable build (no auto-update)';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `Up to date${state.version.length > 0 ? ` (v${state.version})` : ''}`;
    case 'available':
      return `Update available: v${state.version}`;
    case 'downloading':
      return `Downloading… ${Math.round(state.progress)}%`;
    case 'downloaded':
      return `Update ready: v${state.version}`;
    case 'error':
      return `Update error: ${state.message}`;
  }
}

/** True when the update indicator carries a warning tone rather
 *  than the neutral info tone. Used by the dialog to pick the
 *  `.about-update-warn` class so the visual weight matches the
 *  message (an `'unsupported'` portable-build notice is not an
 *  error, but it isn't a positive status either; a true error or
 *  a downloaded-but-not-installed update warrant the warning
 *  tone). */
export function updateStateIsWarning(state: UpdateState): boolean {
  switch (state.kind) {
    case 'unsupported':
    case 'error':
    case 'downloaded':
      return true;
    case 'checking':
    case 'up-to-date':
    case 'available':
    case 'downloading':
      return false;
  }
}

export function AboutDialog(props: AboutDialogProps): ReactElement | null {
  const { open, onClose, onCheckForUpdate } = props;
  const [info, setInfo] = useState<AppInfo>(FALLBACK_INFO);
  const [unavailable, setUnavailable] = useState(false);
  // Update state: undefined while we haven't yet asked, null when
  // the IPC channel is absent (graceful fallback), or the actual
  // UpdateState once it lands. The three-way state avoids a flash
  // of "Update: unavailable" before the first getStatus() resolves.
  const [updateState, setUpdateState] = useState<UpdateState | null | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tflex = (window as unknown as { tflex?: { app?: { getInfo?: () => Promise<AppInfo> } } }).tflex;
    if (tflex === undefined || tflex.app === undefined || typeof tflex.app.getInfo !== 'function') {
      setUnavailable(true);
      return (): void => {
        cancelled = true;
      };
    }
    void tflex.app.getInfo().then((value) => {
      if (cancelled) return;
      setInfo(value);
    }).catch(() => {
      if (cancelled) return;
      setUnavailable(true);
    });
    return (): void => {
      cancelled = true;
    };
  }, [open]);

  // Fetch the OTA update state on open and subscribe to live
  // changes. Same defensive pattern as the AppInfo fetch above —
  // if `tflex.update` isn't wired yet, the row renders nothing
  // rather than crashing. The subscription is unsubscribed on
  // close so we don't leak listeners across multiple opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const w = window as unknown as {
      tflex?: {
        update?: {
          getStatus?: () => Promise<UpdateState>;
          onStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
        };
      };
    };
    const updateApi = w.tflex?.update;
    if (updateApi === undefined) {
      // Channel absent — render nothing for the update row.
      // We still set updateState to null so subsequent renders
      // know the channel is missing (vs. "haven't asked yet").
      setUpdateState(null);
      return (): void => {
        cancelled = true;
      };
    }
    // Reset to "haven't asked yet" so the user briefly sees the
    // empty row before the first response lands, instead of a
    // stale value from a previous open.
    setUpdateState(undefined);
    if (typeof updateApi.getStatus === 'function') {
      void updateApi.getStatus().then((state) => {
        if (cancelled) return;
        setUpdateState(state);
      }).catch(() => {
        if (cancelled) return;
        setUpdateState(null);
      });
    }
    const unsubscribe = typeof updateApi.onStatusChanged === 'function'
      ? updateApi.onStatusChanged((state) => {
        if (cancelled) return;
        setUpdateState(state);
      })
      : (): void => undefined;
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  // DEF-430 — close the About sheet on Escape. Every other dialog in the app
  // (DeletePageDialog, MergeDialog, OptimizeDialog, ...) installs a
  // window-level keydown listener while open; the About sheet was the odd
  // one out, so Escape only closed it via the X button or a backdrop click.
  // The listener is installed only while `open` so it is gone as soon as
  // the sheet closes.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleOpenPath = (path: string): void => {
    const tflex = (window as unknown as { tflex?: { app?: { openPath?: (p: string) => Promise<void> } } }).tflex;
    if (tflex?.app?.openPath === undefined) return;
    void tflex.app.openPath(path).catch(() => undefined);
  };

  // Phase 31 — "What's New" section.
  //
  // Three independent blocks, all plain text:
  //   1. the RUNNING version's bundled entry (offline: `whatsNewFor`
  //      reads the module that ships in the bundle), with an explicit
  //      empty state when the version has no entry;
  //   2. the compact history of older bundled entries, newest first;
  //   3. the INCOMING update's notes from the OTA feed, when the
  //      state is `available`/`downloaded`, labelled with the incoming
  //      version and visually separated from the installed notes.
  //
  // Plain-text guarantee: every note line is rendered as a React
  // child string, so markup like `<b>bold</b>` appears literally and
  // no element is ever created from feed content. There is no
  // dangerouslySetInnerHTML anywhere in this component.
  const renderWhatsNew = (): ReactElement => {
    const installed = whatsNewFor(info.version);
    const history = whatsNewHistory(info.version, WHATS_NEW_HISTORY_LIMIT);
    const incoming = incomingNotesState(updateState);
    return (
      <section className="about-whats-new" data-whats-new aria-label="What's New">
        <h3 className="about-whats-new-title">What's New</h3>
        {installed !== null ? (
          <div className="about-whats-new-current">
            <div className="about-whats-new-version" data-whats-new-version>
              v{installed.version}
              {installed.date !== undefined ? ` — ${installed.date}` : ''}
            </div>
            <ul className="about-whats-new-list">
              {installed.highlights.map((line, i) => (
                <li className="about-whats-new-item" data-whats-new-highlight key={`installed-${i}`}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="about-whats-new-empty" data-whats-new-empty>
            No release notes for this version.
          </p>
        )}
        {incoming !== null && (
          <div className="about-whats-new-incoming" data-whats-new-incoming>
            <div className="about-whats-new-incoming-head">
              <span className="about-whats-new-badge">Update</span>
              <span className="about-whats-new-version" data-whats-new-incoming-version>
                What's new in v{incoming.version}
              </span>
            </div>
            {incoming.notes !== undefined && incoming.notes.length > 0 ? (
              <ul className="about-whats-new-list">
                {incoming.notes.map((line, i) => (
                  <li className="about-whats-new-incoming-item" data-whats-new-incoming-highlight key={`incoming-${i}`}>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="about-whats-new-incoming-empty" data-whats-new-incoming-empty>
                No release notes available for this update.
              </p>
            )}
          </div>
        )}
        {history.length > 0 && (
          <div className="about-whats-new-history" data-whats-new-history>
            <div className="about-whats-new-history-head">Earlier releases</div>
            <ul className="about-whats-new-history-list">
              {history.map((entry) => (
                <li className="about-whats-new-history-item" data-whats-new-history-item key={entry.version}>
                  <span className="about-whats-new-history-version">v{entry.version}</span>
                  <ul className="about-whats-new-history-highlights">
                    {entry.highlights.map((line, i) => (
                      <li key={`${entry.version}-${i}`}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  };

  // Render the update row when we have a state. The
  // three-way updateState (undefined | null | UpdateState)
  // distinguishes "haven't asked yet" (no row yet),
  // "channel absent" (no row), and "have a state" (show).
  const renderUpdateRow = (): ReactElement | null => {
    if (updateState === undefined || updateState === null) return null;
    const label = describeUpdateState(updateState);
    const warn = updateStateIsWarning(updateState);
    return (
      <div className="about-row">
        <span className="about-row-label">Updates</span>
        <span
          className={warn ? 'about-row-value about-update-warn' : 'about-row-value'}
          data-about-update
          data-about-update-kind={updateState.kind}
          data-about-update-warn={warn ? 'true' : 'false'}
        >
          {label}
        </span>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="sheet-backdrop"
          role="presentation"
          onClick={(e): void => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <TfSheet
            className="sheet sheet-about"
            role="dialog"
            aria-labelledby="about-title"
            aria-modal="true"
            data-about-dialog
          >
            <header className="sheet-header">
              <h2 id="about-title" className="sheet-title">About Jovrel</h2>
              <button
                type="button"
                className="sheet-close"
                onClick={onClose}
                aria-label="Close about dialog"
              >
                <Icon icon={X} size="sm" />
              </button>
            </header>
            <div className="sheet-body">
              <BrandMark size={56} className="about-mark" />
              <h3 className="about-name"><BrandWordmark /></h3>
              <p className="about-tagline">A modern PDF studio for Windows.</p>
              <div className="about-meta">
                <div className="about-row">
                  <span className="about-row-label">Version</span>
                  <span className="about-row-value" data-about-version>{info.version}</span>
                </div>
                <div className="about-row">
                  <span className="about-row-label">Electron</span>
                  <span className="about-row-value">{info.electronVersion}</span>
                </div>
                <div className="about-row">
                  <span className="about-row-label">Node</span>
                  <span className="about-row-value">{info.nodeVersion}</span>
                </div>
                {renderUpdateRow()}
              </div>
              {renderWhatsNew()}
              {onCheckForUpdate !== undefined && (
                <div className="about-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onCheckForUpdate}
                    data-about-check-update
                  >
                    Check for Updates
                  </button>
                </div>
              )}
              {unavailable && (
                <div className="about-warning">
                  The app info channel isn't wired yet. The About dialog will populate
                  automatically once the backend finishes the IPC handler.
                </div>
              )}
              <div className="about-paths">
                <div className="about-row about-row-path">
                  <span className="about-row-label">User data</span>
                  <button
                    type="button"
                    className="about-row-value about-row-value-link"
                    onClick={(): void => handleOpenPath(info.storagePaths.userData)}
                    title={info.storagePaths.userData}
                  >
                    {info.storagePaths.userData}
                  </button>
                </div>
                <div className="about-row about-row-path">
                  <span className="about-row-label">Settings</span>
                  <button
                    type="button"
                    className="about-row-value about-row-value-link"
                    onClick={(): void => handleOpenPath(info.storagePaths.settings)}
                    title={info.storagePaths.settings}
                  >
                    {info.storagePaths.settings}
                  </button>
                </div>
                <div className="about-row about-row-path">
                  <span className="about-row-label">Signatures</span>
                  <button
                    type="button"
                    className="about-row-value about-row-value-link"
                    onClick={(): void => handleOpenPath(info.storagePaths.signatures)}
                    title={info.storagePaths.signatures}
                  >
                    {info.storagePaths.signatures}
                  </button>
                </div>
              </div>
            </div>
          </TfSheet>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}