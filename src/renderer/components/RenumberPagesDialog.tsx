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

import { useEffect, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, [tabindex]",
    );
    first?.focus();
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from a page-label input must not dismiss).
  const backdrop = useBackdropClose(onClose);

  

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

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-renumber-pages-dialog
        >
      <TfDialog
        className="modal-dialog modal-dialog-wide dialog modal-dialog-tool"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="renumber-pages-dialog-title"
      >
        <div className="modal-header">
          <h2 id="renumber-pages-dialog-title" className="modal-title">
            Rename pages
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
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
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmClick}
            data-renumber-confirm
          >
            Apply labels
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}