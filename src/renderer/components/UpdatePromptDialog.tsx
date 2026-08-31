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
import { Download, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "../../shared/types";

/** What the dialog can render. Mirrors the live backend state
 *  mapped to a presentational kind so the dialog can never show
 *  the wrong prompt for the wrong state. Pure: see unit tests. */
export type UpdatePromptKind =
  | "available"
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
      // The dialog handles the transitional "downloading" state
      // the same as a passive update-info state — the toolbar
      // indicator is already rendering the progress chip, so the
      // prompt stays a passive "checking" affordance rather than
      // duplicating it.
      return "checking";
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

  if (!open) {
    // Reset the post-click snapshot whenever the dialog closes so
    // a future open starts clean.
    if (pendingVersion !== null) setPendingVersion(null);
    return null;
  }

  const kind = promptKindFromState(state);

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
      case "checking":
        // While downloading, the live state may briefly flip to
        // `checking` (the backend re-resolves metadata); show the
        // post-click progress header instead so the user still
        // sees what's happening. Falls back to "Checking for
        // updates" when no post-click snapshot is set yet.
        if (pendingVersion !== null) {
          return (
            <h2 id="update-prompt-title" className="sheet-title">
              Downloading update to v{pendingVersion}
            </h2>
          );
        }
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
      case "checking":
        // Two reasons we land here:
        //   1. The backend is genuinely "checking" (a manual re-check
        //      started from somewhere else).
        //   2. The user clicked Update and the live state is now
        //      `downloading` (mapped to "checking" above). The dialog
        //      should show a progress bar and a Cancel action —
        //      previously it sat on the passive "Looking for the
        //      latest version" copy with no feedback (DEF: update
        //      pop-up doesn't dismiss or show download progress).
        const isDownloading =
          state !== null &&
          state !== undefined &&
          state.kind === "downloading";
        const liveProgress =
          isDownloading && state.kind === "downloading"
            ? Math.max(0, Math.min(100, Math.round(state.progress)))
            : null;
        // When we're post-click but the live state hasn't pushed a
        // progress event yet, show an indeterminate progress bar so
        // the user gets immediate feedback after the click.
        const effectiveProgress =
          liveProgress ?? (pendingVersion !== null ? 0 : null);
        if (effectiveProgress !== null) {
          return (
            <div className="update-prompt-body" data-update-prompt-kind="downloading">
              <p className="update-prompt-text">
                Downloading the update in the background. You can keep
                working — TFlex will prompt you when the new version is
                ready to install.
              </p>
              <div
                className="update-prompt-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={effectiveProgress}
                aria-label="Update download progress"
                data-update-prompt-progress={effectiveProgress}
              >
                <div
                  className="update-prompt-progress-bar"
                  style={{ width: `${effectiveProgress}%` }}
                />
              </div>
              <p className="update-prompt-progress-label">
                {effectiveProgress}%
              </p>
            </div>
          );
        }
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
              <Download size={14} aria-hidden />
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
              <RefreshCw size={14} aria-hidden />
              Restart
            </button>
          </div>
        );
      // Non-actionable states get a single OK button that just
      // dismisses — the dialog stays useful as an explanation
      // surface without offering a false primary action.
      case "checking": {
        // During a post-click download the user expects a Cancel
        // action that closes the dialog (the toolbar indicator
        // continues to surface the progress independently). Before
        // the user clicks Update we render the passive "Close"
        // affordance.
        const isPostClick = pendingVersion !== null;
        return (
          <div className="update-prompt-actions" data-update-prompt-actions={isPostClick ? "downloading" : "checking"}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-update-prompt-cancel={isPostClick ? "true" : undefined}
              data-update-prompt-close={isPostClick ? undefined : "true"}
            >
              {isPostClick ? "Cancel" : "Close"}
            </button>
          </div>
        );
      }
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
    <div
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
      <div
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
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className="sheet-body sheet-body-update-prompt">
          {renderBody()}
          {renderActions()}
        </div>
      </div>
    </div>
  );
}