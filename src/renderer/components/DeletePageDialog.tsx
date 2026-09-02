// Phase 12 / B8 — Delete pages dialog.
//
// Lets the user pick what to delete:
//   - Current page (the page the toolbar is on, from
//     `initialPage`).
//   - Custom range (1-based inclusive, e.g. "2-5" or "3,5,7-9").
//
// The dialog is purely a UI shell — it owns no engine state. The
// host wires the result through the standard
// `engine.applyOp({kind:"delete", pages:[...]})` path so the
// pageCount / pageOrder / undo / modified flag all update
// correctly. The rail's per-page delete is still wired through
// this dialog when there's no range (the rail sends `[selected]`
// directly, so a single-thumb click is unaffected — the dialog
// only opens for the explicit "Delete" toolbar action).

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Trash2, X } from "lucide-react";
import { parsePageRange } from "../engine/types";
import { useBackdropClose } from "./modalBackdrop";

export type DeletePageMode = "current" | "range";

export interface DeletePageConfirm {
  mode: DeletePageMode;
  /** Resolved 1-based visible page numbers to delete. Always
   *  non-empty. */
  pages: number[];
}

interface DeletePageDialogProps {
  open: boolean;
  totalPages: number;
  /** The page the toolbar is currently showing. Used to seed the
   *  "current page" mode so the natural action is "delete the
   *  page I'm on". */
  currentPage: number;
  onConfirm: (choice: DeletePageConfirm) => void;
  onClose: () => void;
}

export function DeletePageDialog(
  props: DeletePageDialogProps,
): ReactElement | null {
  const { open, totalPages, currentPage, onConfirm, onClose } = props;
  const [mode, setMode] = useState<DeletePageMode>("current");
  const [rangeText, setRangeText] = useState<string>(
    currentPage > 0 ? String(currentPage) : "1",
  );
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time we re-open so stale state from a previous
  // open doesn't leak in. Re-seed from `currentPage` so the user
  // always lands on "delete the page they're on".
  useEffect(() => {
    if (!open) return;
    setMode("current");
    setRangeText(currentPage > 0 ? String(currentPage) : "1");
    setError(null);
  }, [open, currentPage]);

// B13 — focus the first interactive control ONLY on the rising
  // edge of `open`. The previous effect re-ran on every
  // dependency change (the host passes a fresh `onClose`
  // identity on every render), which stole focus from any
  // `<input>` the user was actively typing into. Microtask
  // deferral so the focus call lands after React's commit phase.
  const focusedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    if (!open) {
      focusedOnceRef.current = false;
      return;
    }
    if (focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "button, input, [tabindex]",
      );
      first?.focus();
    });
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const parsedRange = useMemo<{
    pages: number[];
    valid: boolean;
    error?: string;
  }>(() => {
    if (mode !== "range") {
      return { pages: [], valid: true };
    }
    const list = parsePageRange(rangeText, totalPages);
    if (list === null) {
      return { pages: [], valid: false, error: "Invalid range" };
    }
    if (list.length === 0) {
      return { pages: [], valid: false, error: "Range is empty" };
    }
    if (list.length >= totalPages) {
      return {
        pages: list,
        valid: false,
        error: "Cannot delete every page. Documents must keep at least one.",
      };
    }
    return { pages: list, valid: true };
  }, [mode, rangeText, totalPages]);

  // Single-page check: the "current page" mode must also leave at
  // least one page behind.
  const currentValid = useMemo<{ valid: boolean; error?: string }>(() => {
    if (mode !== "current") return { valid: true };
    if (currentPage < 1 || currentPage > totalPages) {
      return { valid: false, error: "No active page" };
    }
    if (totalPages <= 1) {
      return {
        valid: false,
        error: "Cannot delete the only page. Documents must keep at least one.",
      };
    }
    return { valid: true };
  }, [mode, currentPage, totalPages]);

  const valid = parsedRange.valid && currentValid.valid;
  const displayError =
    error ?? parsedRange.error ?? (currentValid.valid ? null : currentValid.error);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the range input must not dismiss).
  const backdrop = useBackdropClose(onClose);

  if (!open) return null;

  const onConfirmClick = (): void => {
    if (!valid) return;
    if (mode === "current") {
      if (currentPage < 1 || currentPage > totalPages) return;
      onConfirm({ mode: "current", pages: [currentPage] });
    } else {
      if (parsedRange.pages.length === 0) return;
      onConfirm({ mode: "range", pages: parsedRange.pages });
    }
  };

  return (
    <div
      className="modal-backdrop"
      {...backdrop}
      data-delete-pages-dialog
    >
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-pages-dialog-title"
      >
        <div className="modal-header">
          <h2 id="delete-pages-dialog-title" className="modal-title">
            Delete pages
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Delete the current page or a custom range. Deletions are
            undoable and the document must keep at least one page.
          </p>

          <fieldset className="modal-position">
            <legend>What to delete</legend>
            <label>
              <input
                type="radio"
                name="delete-page-mode"
                checked={mode === "current"}
                onChange={(): void => setMode("current")}
                data-delete-mode="current"
              />
              <span>Current page ({currentPage})</span>
            </label>
            <label>
              <input
                type="radio"
                name="delete-page-mode"
                checked={mode === "range"}
                onChange={(): void => setMode("range")}
                data-delete-mode="range"
              />
              <span>Custom range</span>
            </label>
          </fieldset>

          {mode === "range" && (
            <label className="modal-field">
              <span>Pages to delete</span>
              <input
                type="text"
                className="modal-input"
                value={rangeText}
                onChange={(e): void => setRangeText(e.target.value)}
                placeholder={String(currentPage)}
                data-delete-range
              />
              <span className="modal-hint">
                Contiguous range (e.g. <code>2-5</code>) or comma list
                (e.g. <code>3,5,7-9</code>). Pages are 1-based.
              </span>
            </label>
          )}

          {displayError !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{displayError}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-danger"
            onClick={onConfirmClick}
            disabled={!valid}
            data-delete-confirm
          >
            <Trash2 size={14} aria-hidden />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
