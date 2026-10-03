// Flatten-forms confirm dialog.
//
// Two-step gate before flattening: this is a destructive action (every
// field disappears; values stay baked into the page content), so we want
// a deliberate click before sending `engine.flattenForms`. Also offers
// "Cancel" as the obvious exit.
//
// Phase 92 (TFL-513 chunk A) — adopts the shared DialogShell. The shell now
// owns Esc, the backdrop-close guard and initial focus; this file keeps only
// the Enter-to-flatten accelerator (Enter confirms anywhere in the dialog) and
// its content. `data-animated-dialog="flatten-confirm"` is forwarded as an
// extra prop so the shipped selector survives the AnimatedDialog -> DialogShell
// move, and the shell adds `data-dialog-shell="flatten-confirm"`.

import { useEffect, type ReactElement } from "react";
import { DialogShell, type DialogAction } from "../components/DialogShell";

interface FlattenConfirmDialogProps {
  open: boolean;
  fieldCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FlattenConfirmDialog(props: FlattenConfirmDialogProps): ReactElement {
  const { open, fieldCount, onCancel, onConfirm } = props;

  // Enter confirms. The keydown handler preventDefaults so the focused
  // default action's native Enter-click is suppressed: exactly one flatten
  // callback fires per Enter, never two.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onConfirm]);

  const actions: DialogAction[] = [
    { key: "cancel", label: "Cancel", variant: "secondary", onClick: onCancel },
    { key: "confirm", label: "Flatten", variant: "primary", onClick: onConfirm, default: true },
  ];

  return (
    <DialogShell
      open={open}
      title="Flatten form fields"
      titleId="flatten-title"
      onClose={onCancel}
      actions={actions}
      testId="flatten-confirm"
      data-animated-dialog="flatten-confirm"
    >
      <p className="modal-help">
        This will bake every filled value into the page content and
        remove {fieldCount} form field{fieldCount === 1 ? "" : "s"}.
        After flattening, the values can no longer be edited in any
        reader.
      </p>
      <p className="modal-help" style={{ color: "var(--fg-faint)", fontSize: "var(--fs-xs)" }}>
        Tip: Save a non-flattened copy with Save As first if you want
        to keep an editable version.
      </p>
    </DialogShell>
  );
}
