// Phase 12 — Renumber pages dialog.
//
// Set logical page labels (/PageLabels number tree). One row per
// page; the user edits the label text inline and the dialog sends
// the full list back to the host. Empty labels clear the override
// for that page. The dialog is purely a UI shell — it owns no
// engine state. The host wires the result through the standard
// `noteOpApplied` path so the pageLabels mirror refreshes.
//
// Pages are presented in visible 1-based order. The user's edits
// are kept in a working copy so cancel doesn't leak partial
// changes to the host.

import { useEffect, useState, type ReactElement } from "react";
import { DialogShell, type DialogAction } from "./DialogShell";

export interface RenumberPagesConfirm {
  /** One label per page, in 1-based visible order. An empty string
   *  means "no override for this page". */
  labels: { page: number; label: string }[];
}

interface RenumberPagesDialogProps {
  open: boolean;
  totalPages: number;
  /** Current logical labels (1-based, sparse — pages without an
   *  override are absent from the list). Seed the dialog's working
   *  copy with these on open so the user sees their previous choice. */
  initialLabels: { page: number; label: string }[];
  onConfirm: (choice: RenumberPagesConfirm) => void;
  onClose: () => void;
}

export function RenumberPagesDialog(
  props: RenumberPagesDialogProps,
): ReactElement | null {
  const { open, totalPages, initialLabels, onConfirm, onClose } = props;
  const [labels, setLabels] = useState<string[]>(() =>
    Array.from({ length: totalPages }, () => ""),
  );
  const [error, setError] = useState<string | null>(null);

  // Reset every time we re-open so stale state from a previous open
  // doesn't leak in. Seed labels with the existing per-page overrides.
  useEffect(() => {
    if (!open) return;
    const seeded = Array.from({ length: totalPages }, () => "");
    for (const l of initialLabels) {
      if (l.page >= 1 && l.page <= totalPages) {
        seeded[l.page - 1] = l.label;
      }
    }
    setLabels(seeded);
    setError(null);
  }, [open, totalPages, initialLabels]);

  const onConfirmClick = (): void => {
    // Build the payload: one entry per non-empty label. Empty labels
    // mean "no override for this page" — omitted from the list.
    const out: { page: number; label: string }[] = [];
    for (let i = 0; i < labels.length; i += 1) {
      const v = (labels[i] ?? "").trim();
      if (v.length > 0) {
        out.push({ page: i + 1, label: v });
      }
    }
    if (out.length === 0) {
      setError(
        "Provide at least one label, or click Cancel to keep the current numbering.",
      );
      return;
    }
    setError(null);
    onConfirm({ labels: out });
  };

  const setLabel = (index: number, value: string): void => {
    setLabels((prev) => {
      const next = prev.slice();
      next[index] = value;
      return next;
    });
  };

  const actions: DialogAction[] = [
    {
      key: "cancel",
      label: "Cancel",
      variant: "secondary",
      onClick: onClose,
    },
    Object.assign(
      {
        key: "confirm",
        label: "Apply labels",
        variant: "primary" as const,
        onClick: onConfirmClick,
        default: true,
      },
      { "data-renumber-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Rename pages"
      titleId="renumber-pages-dialog-title"
      size="tool"
      className="modal-dialog-wide"
      onClose={onClose}
      actions={actions}
      data-renumber-pages-dialog
    >
      <p className="modal-help">
            Set a logical label for any page. The viewer (and the page
            indicator in this app) shows the label instead of the raw page
            number when a label is set. Leave the field blank to keep the
            default numbering for that page.
          </p>

          <ul className="renumber-list" data-renumber-list>
            {labels.map((label, i) => (
              <li key={i} className="renumber-row">
                <span className="renumber-page" aria-label="Page">
                  Page {i + 1}
                </span>
                <input
                  type="text"
                  className="modal-input renumber-input"
                  value={label}
                  placeholder="(default)"
                  aria-label={`Label for page ${i + 1}`}
                  data-renumber-input={i + 1}
                  onChange={(e): void => setLabel(i, e.target.value)}
                />
              </li>
            ))}
          </ul>

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
    </DialogShell>
  );
}