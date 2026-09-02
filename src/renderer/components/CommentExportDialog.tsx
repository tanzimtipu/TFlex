// Phase 12 — Comment export dialog.
//
// One-click export: the user clicks "Export comments" and the
// dialog calls `engine.exportFdf`, hands the returned bytes to
// the host's OS save dialog, and reports the saved path back to
// the user. The dialog is purely a UI shell — it owns no engine
// state.
//
// On confirm:
//   1. `engine.exportFdf(docId)` returns FDF bytes.
//   2. The host pops an OS save dialog (passed in as a prop).
//   3. On a saved path, the dialog shows a success state with the
//      path; on cancel, the dialog simply closes.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { X, Download } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";

export interface CommentExportConfirm {
  path: string;
  /** Number of annotations written to the FDF, for the success
   *  message. */
  annotationCount: number;
}

interface CommentExportDialogProps {
  open: boolean;
  /** Total annotations on the active doc. Used to gate the
   *  confirm button — exporting zero annotations would still
   *  produce a valid (empty) FDF, but the user almost certainly
   *  meant to add comments first. We surface a hint instead of
   *  blocking, so a power user can still dump an empty FDF. */
  annotationCount: number;
  /** Run the engine export. Returns the FDF bytes or an error
   *  string. */
  runExportFdf: () => Promise<
    { bytes: ArrayBuffer; annotationCount: number } | { error: string }
  >;
  /** Pop the OS save dialog and write the bytes to the chosen
   *  path. Returns the saved path or null (user cancelled). */
  saveFile: (bytes: ArrayBuffer, suggestedName: string) => Promise<string | null>;
  /** Source file name used to build the default suggested name
   *  (`<name>-comments.fdf`). */
  sourceName: string;
  onConfirm: (result: CommentExportConfirm) => void;
  onClose: () => void;
}

export function CommentExportDialog(
  props: CommentExportDialogProps,
): ReactElement | null {
  const {
    open,
    annotationCount,
    runExportFdf,
    saveFile,
    sourceName,
    onConfirm,
    onClose,
  } = props;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setRunning(false);
    setError(null);
  }, [open]);

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
  // backdrop.
  const backdrop = useBackdropClose(onClose);

  if (!open) return null;

  const onConfirmClick = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const res = await runExportFdf();
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      // Build a friendly suggested name from the source file name.
      const stem = sourceName.replace(/\.pdf$/i, "") || "document";
      const suggested = `${stem}-comments.fdf`;
      const savedPath = await saveFile(res.bytes, suggested);
      if (savedPath === null) {
        // User cancelled the OS save dialog — close quietly.
        setRunning(false);
        onClose();
        return;
      }
      setRunning(false);
      onConfirm({ path: savedPath, annotationCount: res.annotationCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRunning(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      {...backdrop}
      data-comment-export-dialog
    >
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-export-dialog-title"
      >
        <div className="modal-header">
          <h2
            id="comment-export-dialog-title"
            className="modal-title"
          >
            Export comments
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
            Save every annotation on the active document to an FDF
            (Forms Data Format) file. FDF round-trips with{" "}
            <strong>Import comments</strong>: re-importing the saved
            file merges the annotations into the active document.
          </p>

          <div className="modal-row modal-row-pad">
            <span className="modal-hint">
              <strong>{annotationCount}</strong> annotation
              {annotationCount === 1 ? "" : "s"} on the active
              document.
            </span>
          </div>

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
            disabled={running}
            onClick={(): void => {
              void onConfirmClick();
            }}
            data-comment-export-confirm
          >
            <Download size={14} aria-hidden />
            {running ? "Exporting…" : "Export comments"}
          </button>
        </div>
      </div>
    </div>
  );
}