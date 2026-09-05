// OTA UX — UpdatePromptDialog.
//
// When the backend pushes an `available` (new version detected) or
// `downloaded` (installer ready) UpdateState, this dialog pops up
// over the app so the user can act on it without hunting for the
// toolbar indicator. The dialog is sheet-styled (matching About /
// Preferences) and renders two action buttons:
//
//   - 'available' state: "Update to X.Y.Z available"
//        Primary button: Update   -> calls update.download()
//        Secondary:      Cancel   -> dismisses the dialog
//
//   - 'downloading' state (Bug 9): immediate progress feedback
//     after Update is clicked (spinner + "Downloading…", then the
//     live percent once events flow). The host dismisses the popup
//     to the background on Update click and the toolbar indicator
//     keeps surfacing progress, so the user can keep working.
//
//   - 'downloaded' state: "Restart to update to X.Y.Z"
//        Primary button: Restart  -> calls update.install()
//        Secondary:      Later    -> dismisses the dialog
//
// Design choices:
//   - One dialog, one open flag in the host. The host decides WHEN
//     to open it; the dialog only reads the current UpdateState
//     passed in via props (the host subscribes to onStatusChanged
//     and surfaces the latest non-trivial state).
//   - Both buttons are real <button> elements, accessible (Escape
//     to dismiss via the backdrop click + the X button), so the
//     dialog is keyboard-friendly.
//   - Cancel/Later is the secondary action; Update/Restart is the
//     primary (accent) action. The user can dismiss with Escape
//     (closes the dialog) or click the backdrop (same).
//   - The toolbar UpdateIndicator continues to work independently
//     — this dialog is the *prompt*, the indicator is the *visible
//     affordance*. After Cancel the indicator still shows the
//     'available' / 'downloaded' chip so the user can re-open the
//     prompt by clicking the chip. (The chip itself routes through
//     update.download() / update.install() — but it doesn't open
//     this dialog. The two surfaces are independent by design: the
//     indicator is always-visible, the dialog is opt-in notification.)
//
// The dialog never throws when the IPC channel is absent — it
// degrades to a passive "Update status unavailable" message.

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Download, RefreshCw, RotateCw, X } from "lucide-react";
import type { UpdateState } from "../../shared/types";
import { TfBackdrop, TfSheet } from "./motion/TfMotion";

/** What the dialog can render. Mirrors the live backend state
 *  mapped to a presentational kind so the dialog can never show
 *  the wrong prompt for the wrong state. Pure: see unit tests. */
export type UpdatePromptKind =
  | "available"
  // Bug 9 — the "downloading" presentation (immediate progress on
  // the Update click) is its own kind; `promptKindFromState` maps
  // the backend's `downloading` here and `dialogKind` pins the
  // dialog here right after an Update click.
  | "downloading"
  | "downloaded"
  | "unsupported"
  | "error"
  | "checking"
  | "up-to-date"
  | "none";

/** Internal: exhaustiveness helper for `UpdateState.kind`. Pinning
 *  a runtime check keeps TS's exhaustiveness honest even when the
 *  union is extended in the future. */
function assertNever(x: never): never {
  throw new Error(`Unhandled UpdateState kind: ${JSON.stringify(x)}`);
}

/** Map a backend `UpdateState` to the dialog's visual kind. Pure.
 *  Exported for unit tests. */
export function promptKindFromState(
  state: UpdateState | null | undefined,
): UpdatePromptKind {
  if (state === null || state === undefined) return "none";
  // Pin the discriminant in a local variable so the `assertNever`
  // below sees `never` (TS can't narrow through a member access
  // inside the default arm of a switch).
  const kind: UpdateState["kind"] = state.kind;
  switch (kind) {
    case "available":
      return "available";
    case "downloaded":
      return "downloaded";
    case "downloading":
      // The transitional "downloading" state renders the progress
      // presentation directly (Bug 9): an indeterminate spinner +
      // "Downloading…" the instant the user commits, then the live
      // percent as progress events flow. No more "no progress for
      // seconds" blank after the Update click.
      return "downloading";
    case "unsupported":
      return "unsupported";
    case "error":
      return "error";
    case "checking":
      return "checking";
    case "up-to-date":
      return "up-to-date";
    default:
      return assertNever(kind);
  }
}

/** Effective presentation kind for the dialog. Once the user clicks
 *  Update (`pendingVersion` set), the dialog pins itself to the
 *  "downloading" presentation IMMEDIATELY — independent of the
 *  backend's progress events — so the Update click always gets
 *  instant progress feedback instead of a blank moment (Bug 9). A
 *  terminal state (`downloaded` / `error` / `unsupported`)
 *  supersedes it. Pure: exported for unit tests. */
export function dialogKind(
  state: UpdateState | null | undefined,
  pendingVersion: string | null,
): UpdatePromptKind {
  if (pendingVersion !== null && state !== null && state !== undefined) {
    switch (state.kind) {
      case "downloaded":
        return "downloaded";
      case "error":
        return "error";
      case "unsupported":
        return "unsupported";
      default:
        // available / checking / downloading / up-to-date — all stay
        // on the download progress the user just asked for.
        return "downloading";
    }
  }
  return promptKindFromState(state);
}

interface UpdatePromptDialogProps {
  /** True when the host wants the dialog visible. The host opens
   *  this when an `available` or `downloaded` state arrives. */
  open: boolean;
  /** Current backend state (passed through from the host's
   *  UpdateIndicator subscription). The dialog renders its UI
   *  from this prop; when `open` is true and `state` is an
   *  actionable kind, the user sees the prompt. */
  state: UpdateState | null | undefined;
  /** Update button handler. Parent owns the IPC (calls
   *  `tflex.update.download()`). */
  onUpdate: () => void;
  /** Install / Restart button handler. */
  onInstall: () => void;
  /** Close button (X), Escape key, and backdrop click all
   *  funnel through this. */
  onClose: () => void;
}

/** Dialog content + accessibility hooks. */
export function UpdatePromptDialog(
  props: UpdatePromptDialogProps,
): ReactElement | null {
  const { open, state, onUpdate, onInstall, onClose } = props;
  // Local flash of a "checking..." text after the user clicks
  // Check for Update so the dialog gives feedback while the
  // backend re-runs the GitHub call. Host-controlled via the
  // `state` prop (a `checking` state is the signal).
  const [busy, setBusy] = useState(false);

  // Whenever the dialog opens with an actionable state, the user
  // can hit Update/Restart. After clicking we briefly disable
  // the buttons so a second click doesn't fire the IPC twice.
  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }
    // If the state transitions to "checking" while the dialog
    // is open, treat it as busy (the host initiated a manual
    // check). Reset busy when an actionable state lands.
    if (state !== null && state !== undefined && state.kind === "checking") {
      setBusy(true);
    } else if (
      state !== null &&
      state !== undefined &&
      (state.kind === "available" || state.kind === "downloaded")
    ) {
      setBusy(false);
    }
  }, [open, state]);

  // Local "post-click" snapshot. When the user clicks Update we
  // record the version we asked for, so the dialog can keep
  // showing a meaningful title (and progress text) while the
  // backend streams the download — the live `state` may briefly
  // switch between `checking` (backend re-resolved the version)
  // and `downloading` (progress events), and we want the dialog
  // to stay anchored on the user's intent rather than flicker.
  // `null` when the dialog hasn't transitioned through an Update
  // click yet. See Bug 16: Update click must transition to a
  // progress state, then to a restart prompt.
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);

  // The post-click snapshot resets whenever the dialog closes so a
  // future open starts clean. Kept in an effect (instead of a
  // setState-during-render next to an early return) so the dialog
  // can participate in exit animations without a render-phase
  // state write.
  useEffect(() => {
    if (!open && pendingVersion !== null) setPendingVersion(null);
  }, [open, pendingVersion]);

  // Bug 9 — the effective kind takes the post-click `pendingVersion`
  // into account so the dialog flips to the "downloading" progress
  // presentation the moment the user clicks Update, without waiting
  // for the backend's first progress event to arrive.
  const kind = dialogKind(state, pendingVersion);

  const renderHeader = (): ReactElement => {
    // Exhaustive switch over UpdatePromptKind. New kinds added
    // to the union will surface as a TS error here, which is
    // exactly what we want — the dialog never silently
    // misrenders an unknown state.
    switch (kind) {
      case "available":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Update available
          </h2>
        );
      case "downloaded":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Restart to update
          </h2>
        );
      case "downloading":
        // Immediate feedback on the Update click. `pendingVersion`
        // is normally set (the user just clicked Update); fall back
        // to a generic label if the dialog somehow renders this kind
        // without a committed version.
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            {pendingVersion !== null
              ? `Downloading update to v${pendingVersion}`
              : "Downloading update…"}
          </h2>
        );
      case "checking":
        // Headline for the passive "Looking for the latest version"
        // copy below. Reached only when no post-click version is
        // pending (a manual re-check); the post-click path renders
        // the "downloading" kind instead (see `dialogKind`).
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Checking for updates
          </h2>
        );
      case "up-to-date":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            You're up to date
          </h2>
        );
      case "unsupported":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Updates not available
          </h2>
        );
      case "error":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Update check failed
          </h2>
        );
      case "none":
        return (
          <h2 id="update-prompt-title" className="sheet-title">
            Update
          </h2>
        );
      default:
        return assertNever(kind);
    }
  };

  const renderBody = (): ReactElement => {
    switch (kind) {
      case "available": {
        const version =
          state !== null && state !== undefined && state.kind === "available"
            ? state.version
            : "";
        return (
          <div className="update-prompt-body" data-update-prompt-kind="available">
            <p className="update-prompt-text">
              Update to <strong>v{version}</strong> is available. The new
              version will download in the background; you can keep
              working while it does.
            </p>
          </div>
        );
      }
      case "downloaded": {
        const version =
          state !== null && state !== undefined && state.kind === "downloaded"
            ? state.version
            : "";
        return (
          <div className="update-prompt-body" data-update-prompt-kind="downloaded">
            <p className="update-prompt-text">
              v{version} has downloaded. Restart TFlex to install the
              new version — any unsaved work will be lost.
            </p>
          </div>
        );
      }
      case "downloading":
        // Immediate feedback on the Update click (Bug 9). The moment
        // the user commits, the dialog shows an indeterminate spinner
        // + animated bar ("Downloading…"); once `downloading(N)`
        // events flow (the backend pushes `downloading(0)` with no
        // gap), the bar + label go determinate with the live percent.
        // The host dismisses this to the background on Update click;
        // if it ever renders while open (or the IPC is absent), the
        // user still sees progress instantly instead of a blank.
        {
          const liveProgress =
            state !== null &&
            state !== undefined &&
            state.kind === "downloading"
              ? Math.max(0, Math.min(100, Math.round(state.progress)))
              : null;
          const indeterminate = liveProgress === null;
          return (
            <div
              className="update-prompt-body"
              data-update-prompt-kind="downloading"
              data-update-prompt-downloading
            >
              <p className="update-prompt-text update-prompt-downloading-text">
                <RotateCw
                  size={16}
                  aria-hidden
                  className="update-prompt-spinner"
                />
                <span>
                  {indeterminate
                    ? "Downloading the update…"
                    : "Downloading the update in the background."}
                </span>
              </p>
              <div
                className={
                  indeterminate
                    ? "update-prompt-progress update-prompt-progress-indeterminate"
                    : "update-prompt-progress"
                }
                role="progressbar"
                aria-label="Update download progress"
                aria-busy={indeterminate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={liveProgress ?? 0}
                data-update-prompt-progress={liveProgress}
              >
                <div
                  className="update-prompt-progress-bar"
                  style={
                    indeterminate ? undefined : { width: `${liveProgress}%` }
                  }
                />
              </div>
              {!indeterminate && (
                <p className="update-prompt-progress-label">{liveProgress}%</p>
              )}
            </div>
          );
        }
      case "checking":
        // Passive "Looking for the latest version" (a manual re-check).
        // The post-click download path renders the "downloading" kind
        // instead (see `dialogKind`).
        return (
          <div className="update-prompt-body" data-update-prompt-kind="checking">
            <p className="update-prompt-text">
              Looking for the latest version of TFlex.
            </p>
          </div>
        );
      case "up-to-date":
        return (
          <div className="update-prompt-body" data-update-prompt-kind="up-to-date">
            <p className="update-prompt-text">
              You're running the latest version.
            </p>
          </div>
        );
      case "unsupported":
        return (
          <div className="update-prompt-body" data-update-prompt-kind="unsupported">
            <p className="update-prompt-text">
              {state !== null && state !== undefined && state.kind === "unsupported"
                ? state.reason
                : "This build of TFlex doesn't support automatic updates."}
            </p>
          </div>
        );
      case "error":
        return (
          <div className="update-prompt-body" data-update-prompt-kind="error">
            <p className="update-prompt-text">
              {state !== null && state !== undefined && state.kind === "error"
                ? state.message
                : "Something went wrong checking for updates."}
            </p>
          </div>
        );
      case "none":
        return (
          <div className="update-prompt-body" data-update-prompt-kind="none">
            <p className="update-prompt-text">
              Update status is not available right now.
            </p>
          </div>
        );
      default:
        return assertNever(kind);
    }
  };

  const renderActions = (): ReactElement => {
    // Primary action depends on the actionable kind. Both buttons
    // disable themselves while `busy` is true (user just clicked
    // and we want to prevent a double-fire).
    switch (kind) {
      case "available":
        return (
          <div className="update-prompt-actions" data-update-prompt-actions="available">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
              data-update-prompt-cancel
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={(): void => {
                // Snapshot the version we asked for so the
                // dialog can keep showing a meaningful title +
                // progress UI while the backend streams the
                // download (the live `state` may briefly switch
                // between `checking` and `downloading`).
                const v =
                  state !== null && state !== undefined && state.kind === "available"
                    ? state.version
                    : null;
                if (v !== null) setPendingVersion(v);
                setBusy(true);
                onUpdate();
              }}
              disabled={busy}
              data-update-prompt-update
            >
              <Download size={16} aria-hidden />
              Update
            </button>
          </div>
        );
      case "downloaded":
        return (
          <div className="update-prompt-actions" data-update-prompt-actions="downloaded">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
              data-update-prompt-later
            >
              Later
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onInstall}
              disabled={busy}
              data-update-prompt-restart
            >
              <RefreshCw size={16} aria-hidden />
              Restart
            </button>
          </div>
        );
      // Non-actionable states get a single OK/Close button that just
      // dismisses — the dialog stays useful as an explanation
      // surface without offering a false primary action.
      case "downloading":
        // Bug 9 — the only action while the (background) download
        // runs is "Cancel", which dismisses the prompt to the
        // background: the download continues and the toolbar
        // indicator keeps showing the progress. The host closes the
        // popup on the Update click itself, so this is mostly the
        // path for a dialog that stays open during downloading.
        return (
          <div className="update-prompt-actions" data-update-prompt-actions="downloading">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-update-prompt-cancel
            >
              Cancel
            </button>
          </div>
        );
      case "checking":
        // Passive manual re-check — a single Close (no action).
        return (
          <div className="update-prompt-actions" data-update-prompt-actions="checking">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-update-prompt-close
            >
              Close
            </button>
          </div>
        );
      // Non-actionable states get a single OK button that just
      // dismisses — the dialog stays useful as an explanation
      // surface without offering a false primary action.
      case "up-to-date":
      case "unsupported":
      case "error":
      case "none":
        return (
          <div className="update-prompt-actions" data-update-prompt-actions={kind}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onClose}
              data-update-prompt-close
            >
              OK
            </button>
          </div>
        );
      default:
        return assertNever(kind);
    }
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
          onKeyDown={(e): void => {
            if (e.key === "Escape") onClose();
          }}
          tabIndex={-1}
        >
          <TfSheet
            className="sheet sheet-update-prompt"
            role="dialog"
            aria-labelledby="update-prompt-title"
            aria-modal="true"
            data-update-prompt
            data-update-prompt-kind={kind}
          >
        <header className="sheet-header">
          {renderHeader()}
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="Close update prompt"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="sheet-body sheet-body-update-prompt">
          {renderBody()}
          {renderActions()}
        </div>
        </TfSheet>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}