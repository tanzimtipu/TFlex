// Flatten-forms confirm dialog.
//
// Two-step gate before flattening: this is a destructive action (every
// field disappears; values stay baked into the page content), so we want
// a deliberate click before sending `engine.flattenForms`. Also offers
// "Cancel" as the obvious exit.

import { useEffect, useRef, type ReactElement } from "react";

interface FlattenConfirmDialogProps {
  open: boolean;
  fieldCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FlattenConfirmDialog(props: FlattenConfirmDialogProps): ReactElement | null {
  const { open, fieldCount, onCancel, onConfirm } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="flatten-title"
      >
        <div className="modal-header">
          <h2 id="flatten-title" className="modal-title">
            Flatten form fields
          </h2>
        </div>
        <div className="modal-body">
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
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Flatten
          </button>
        </div>
      </div>
    </div>
  );
}