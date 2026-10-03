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
// state and both side-effects.
//
// Phase 92 (TFL-513 chunk A) — this is the canonical DialogShell exemplar.
// The shell owns Esc, the backdrop-close drag guard and initial focus to the
// `default` action once, so the hand-rolled keydown/focus/backdrop effects
// this file used to carry are gone. Every shipped hook survives: the root
// `data-confirm-dialog` and `aria-describedby` are forwarded as extra props,
// and each action keeps its legacy `data-confirm-dialog-action` (and the
// confirm action its `data-confirm-dialog-default`) via the extra keys on the
// action object, which the shell forwards unchanged.

import { type ReactElement } from "react";
import { DialogShell, type DialogAction } from "./DialogShell";

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
): ReactElement {
  const {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
  } = props;

  // Actions render in order (cancel then confirm, primary right-most). The
  // extra hyphenated keys are the pre-Phase-92 e2e hooks; Object.assign keeps
  // them typed as the canonical DialogAction while carrying them at runtime.
  const actions: DialogAction[] = [
    Object.assign(
      { key: "cancel", label: cancelLabel, variant: "secondary" as const, onClick: onCancel },
      { "data-confirm-dialog-action": "cancel" },
    ),
    Object.assign(
      {
        key: "confirm",
        label: confirmLabel,
        variant: "primary" as const,
        onClick: onConfirm,
        default: true,
      },
      { "data-confirm-dialog-action": "confirm", "data-confirm-dialog-default": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title={title}
      titleId="confirm-dialog-title"
      role="alertdialog"
      onClose={onCancel}
      actions={actions}
      data-confirm-dialog
      aria-describedby="confirm-dialog-body"
    >
      <p id="confirm-dialog-body" className="modal-help">
        {message}
      </p>
    </DialogShell>
  );
}
