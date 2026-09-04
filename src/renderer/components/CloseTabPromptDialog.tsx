// Close-tab confirm dialog.
//
// B8 — the user closes a tab that has unsaved engine changes.
// The previous behavior: the tab closed without prompting, the
// engine's undo stack was discarded (along with all the user's
// in-flight changes), and the only recovery was "undo before
// closing" — a state the user can't see at the moment they
// click the close button.
//
// The fix: surface a small confirmation when the close target
// has unsaved engine state. The user picks one of:
//
//   - "Save" — runs `onSave` (the host's save flow), waits for
//     the save to settle, then closes. If the save fails (or the
//     user cancels the OS dialog), the tab STAYS open so the
//     user can recover.
//   - "Don't save" — closes without saving. The engine's undo
//     stack and unsaved annotations / forms / signatures are
//     discarded.
//   - "Cancel" — drops the close; the tab stays open.
//
// The dialog is purely presentational; the host (App.tsx) owns
// the state and the save/close side-effects. We mirror the
// AppHeader's modified dot semantics: the prompt is shown only
// when the tab's engine state reports `modified: true` AND the
// tab has an on-disk path (so Save is meaningful). Untouched
// docs and in-memory tabs (e.g. samples, fresh Optimize output)
// close silently.

import { useEffect, useRef, type ReactElement } from "react";
import { X } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";

export type CloseTabPromptChoice = "save" | "discard" | "cancel";

interface CloseTabPromptDialogProps {
  open: boolean;
  /** Display name shown in the prompt body (the tab's title). */
  tabTitle: string;
  /** True when a save is already in flight; the Save button is
   *  disabled and shows "Saving…". The host sets this when
   *  the user clicks Save and the engine IPC hasn't returned. */
  saving: boolean;
  /** DEF-128 — true when the tab has no on-disk path (bytes-loaded
   *  / sample tab). The Save choice then routes through the host's
   *  Save-As flow (an OS save dialog) instead of an in-place save;
   *  the button is labelled "Save As…" so the user knows a path
   *  picker will appear. */
  saveAsMode?: boolean;
  /** True when the save itself failed (engine error / OS
   *  dialog cancelled). The dialog surfaces an inline error
   *  block and the Save button stays clickable so the user
   *  can retry. The Cancel button always works. */
  saveError: string | null;
  onChoose: (choice: CloseTabPromptChoice) => void;
}

export function CloseTabPromptDialog(
  props: CloseTabPromptDialogProps,
): ReactElement | null {
  const { open, tabTitle, saving, saveError, saveAsMode = false, onChoose } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Esc cancels the close — the same afford every other modal
  // has. We focus the first button on open so keyboard users
  // land on the natural default ("Save").
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onChoose("cancel");
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "button[data-close-prompt-default]",
      );
      first?.focus();
    });
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onChoose]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop. Clicking the backdrop cancels the close (keeps the
  // tab open); a drag that started on a button and released over
  // the backdrop must not fire it.
  const backdrop = useBackdropClose(() => onChoose("cancel"));

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      {...backdrop}
      data-close-tab-prompt
      data-close-prompt
    >
      <div
        ref={dialogRef}
        className="modal-dialog dialog close-tab-prompt-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-tab-prompt-title"
        aria-describedby="close-tab-prompt-body"
      >
        <div className="modal-header">
          <h2 id="close-tab-prompt-title" className="modal-title">
            Unsaved changes
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={(): void => onChoose("cancel")}
            aria-label="Cancel close"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p id="close-tab-prompt-body" className="modal-help">
            <strong>{tabTitle}</strong> has unsaved changes. Save before
            closing to keep your edits, or discard them.
          </p>
          {saveError !== null && (
            <div className="modal-status optimize-error" role="alert" data-close-prompt-error>
              <span>{saveError}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(): void => onChoose("cancel")}
            disabled={saving}
            data-close-prompt-action="cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(): void => onChoose("discard")}
            disabled={saving}
            data-close-prompt-action="discard"
          >
            Don't save
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(): void => onChoose("save")}
            disabled={saving}
            data-close-prompt-action="save"
            data-close-prompt-default
          >
            {saving ? "Saving…" : saveAsMode ? "Save As…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}