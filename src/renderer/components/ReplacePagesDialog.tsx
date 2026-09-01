// Phase 12 — Replace pages dialog.
//
// Two pages of state:
//   1. Pick another PDF file (host-side OS file picker).
//   2. Pick a target range in the active document (1-based inclusive).
//   3. Confirm.
//
// On confirm the host calls `engine.replacePages(docId, otherBytes,
// [start, end])` which replaces the visible page range with every
// page of `otherBytes`. Surviving pages keep their annotations and
// outline; the other PDF's annotations and outline are carried
// across via a page-ref remap. The dialog is purely a UI shell —
// it owns no engine state. The host wires the result through the
// standard `noteOpApplied` path so the pageCount / pageOrder
// mirror refreshes.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FilePlus2, X } from "lucide-react";
import { defaultPageRange, parsePageRange } from "../engine/types";

export interface ReplacePagesConfirm {
  /** Other PDF bytes. */
  otherBytes: Uint8Array;
  /** Other PDF path (display + engine fallback). */
  otherPath: string;
  /** 0-based inclusive target range. */
  targetRange: [number, number];
}

interface ReplacePagesDialogProps {
  open: boolean;
  totalPages: number;
  /** Lets the host open its own OS file picker. Returns the picked
   *  PDF's bytes + path. */
  pickOtherFile: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  onConfirm: (choice: ReplacePagesConfirm) => void;
  onClose: () => void;
}

export function ReplacePagesDialog(
  props: ReplacePagesDialogProps,
): ReactElement | null {
  const { open, totalPages, pickOtherFile, onConfirm, onClose } = props;
  const [rangeText, setRangeText] = useState<string>(defaultPageRange(totalPages));
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedBytes, setPickedBytes] = useState<Uint8Array | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time we re-open so stale state from a previous open
  // doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setRangeText(defaultPageRange(totalPages));
    setPickedPath(null);
    setPickedBytes(null);
    setPicking(false);
    setError(null);
  }, [open, totalPages]);

// B13 — focus the first interactive control ONLY on the rising
  // edge of `open`. The previous effect re-ran on every `onClose`
  // identity change; the host passes a fresh `onClose` identity
  // whenever it re-renders, which re-ran the focus call on every
  // re-render and stole focus from any `<input>` the user was
  // actively interacting with. The `focusedOnceRef` gate runs the
  // focus call exactly once per dialog open; the ref resets on
  // close so the next open re-focuses. Microtask deferral so
  // focus lands after React's commit phase and doesn't race the
  // parent click that opened the dialog.
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

  // B18 — modal blocking while the OS file picker is open. Same
  // pattern as MergeDialog / InsertPagesDialog: bind the backdrop
  // to a no-op while `picking` is true and swallow Esc in the
  // capture phase so the picker owns input.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return (): void => window.removeEventListener("keydown", onKey, true);
  }, [picking]);

  // The user's range text parses to a list of 1-based pages; the
  // engine consumes the [start, end] inclusive slice. We accept only
  // contiguous ranges so the "replace" semantics are unambiguous.
  const parsed = useMemo<{
    start: number;
    end: number;
    valid: boolean;
    error?: string;
  }>(() => {
    const list = parsePageRange(rangeText, totalPages);
    if (list === null) {
      return {
        start: 0,
        end: 0,
        valid: false,
        error: "Invalid range",
      };
    }
    if (list.length === 0) {
      return { start: 0, end: 0, valid: false, error: "Range is empty" };
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (first === undefined || last === undefined) {
      return { start: 0, end: 0, valid: false, error: "Invalid range" };
    }
    // Contiguous guard: parsePageRange accepts comma lists, but
    // replacePages requires a contiguous span. Detect gaps.
    for (let i = 1; i < list.length; i += 1) {
      const cur = list[i];
      const prev = list[i - 1];
      if (cur === undefined || prev === undefined) continue;
      if (cur !== prev + 1) {
        return {
          start: 0,
          end: 0,
          valid: false,
          error: "Range must be contiguous (e.g. 2-5)",
        };
      }
    }
    return { start: first, end: last, valid: true };
  }, [rangeText, totalPages]);

  const valid = parsed.valid && pickedBytes !== null && pickedPath !== null;

  if (!open) return null;

  const onPickFile = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      const picked = await pickOtherFile();
      if (picked !== null) {
        setPickedBytes(picked.bytes);
        setPickedPath(picked.path);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not open file picker: ${msg}`);
    } finally {
      setPicking(false);
    }
  };

  const onConfirmClick = (): void => {
    if (!valid) return;
    if (pickedBytes === null || pickedPath === null) return;
    onConfirm({
      otherBytes: pickedBytes,
      otherPath: pickedPath,
      // Translate 1-based visible to 0-based inclusive for the engine.
      targetRange: [parsed.start - 1, parsed.end - 1],
    });
  };

  return (
    <div
      className="modal-backdrop"
      // B18 — backdrop click is a no-op while the OS file picker
      // is open. Same modal-blocking pattern as MergeDialog.
      onClick={picking ? undefined : onClose}
      data-picking={picking ? "true" : "false"}
      data-replace-pages-dialog
    >
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-pages-dialog-title"
      >
        <div className="modal-header">
          <h2 id="replace-pages-dialog-title" className="modal-title">
            Replace pages
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
            Replace a contiguous range of pages in the active document with
            every page of another PDF. Surviving pages keep their annotations
            and outline; the other PDF's annotations and outline are carried
            across via a page-ref remap.
          </p>

          <div className="modal-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={(): void => {
                void onPickFile();
              }}
              disabled={picking}
              data-replace-pick
            >
              <FilePlus2 size={14} aria-hidden />
              {picking
                ? "Picking…"
                : pickedPath === null
                  ? "Pick PDF…"
                  : "Replace pick…"}
            </button>
            <div className="modal-picked">
              {pickedPath === null ? (
                <span className="hint">No PDF selected</span>
              ) : (
                <span title={pickedPath}>
                  {pickedPath.split(/[\\/]/).pop()}
                </span>
              )}
            </div>
          </div>

          <label className="modal-field">
            <span>Target pages</span>
            <input
              type="text"
              className="modal-input"
              value={rangeText}
              onChange={(e): void => setRangeText(e.target.value)}
              placeholder={defaultPageRange(totalPages)}
              data-replace-range
            />
            <span className="modal-hint">
              Contiguous range (e.g. <code>2-5</code>) in the active document.
              Pages are 1-based; the entire range is replaced with every page
              of the picked PDF.
            </span>
          </label>

          {parsed.error !== undefined && rangeText.trim().length > 0 && (
            <div className="modal-status optimize-error" role="alert">
              <span>{parsed.error}</span>
            </div>
          )}

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
            disabled={!valid}
            onClick={onConfirmClick}
            data-replace-confirm
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}