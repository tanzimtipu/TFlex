// Generic confirm dialog.
//
// Phase 17 — a small alertdialog with a message and a
// confirm / cancel action pair. The first Phase 17 consumer is
// the "confirm before closing multiple tabs" preference
// (AppSettings.confirmCloseMultipleTabs): when a window close
// request arrives while two or more documents are open and the
// preference is on, App.tsx surfaces this dialog before running
// the DEF-142 close flow. Confirming continues the flow
// (which still walks any modified tabs through the per-tab
// Save / Don't-save prompt); cancelling aborts it and the
// window stays open.
//
// Purely presentational — the host (App.tsx) owns the open
// state and both side-effects. The interaction contract mirrors
// CloseTabPromptDialog: Escape cancels, a genuine backdrop click
// cancels (the B3/B6 drag guard), and the confirm button is
// focused on open so keyboard users land on the default action.

import { useEffect, useRef, type ReactElement } from "react";
import { X } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

interface ConfirmDialogProps {
  open: boolean;
  /** Heading rendered in the dialog title bar. */
  title: string;
  /** Body copy explaining what the confirm action will do. */
  message: string;
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(
  props: ConfirmDialogProps,
): ReactElement | null {
  const {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
  } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Esc cancels — the same affordance every other modal has. We
  // focus the confirm button on open so keyboard users land on the
  // natural default action.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "button[data-confirm-dialog-default]",
      );
      first?.focus();
    });
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // B3/B6 — backdrop close only when the interaction started on
  // the backdrop. Clicking the backdrop cancels (aborts the
  // pending action); a drag that started inside the dialog and
  // released over the backdrop must not fire it.
  const backdrop = useBackdropClose(onCancel);

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-confirm-dialog
        >
          <TfDialog
            ref={dialogRef}
            className="modal-dialog dialog confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-body"
          >
            <div className="modal-header">
              <h2 id="confirm-dialog-title" className="modal-title">
                {title}
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={(): void => onCancel()}
                aria-label="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="modal-body">
              <p id="confirm-dialog-body" className="modal-help">
                {message}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(): void => onCancel()}
                data-confirm-dialog-action="cancel"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={(): void => onConfirm()}
                data-confirm-dialog-action="confirm"
                data-confirm-dialog-default
              >
                {confirmLabel}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}