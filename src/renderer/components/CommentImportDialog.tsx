// Phase 12 — Comment import dialog.
//
// One-click import: the user clicks "Import comments" and the
// dialog prompts the host's OS open dialog for an FDF file. The
// selected bytes are passed to `engine.importFdf`, which merges
// the annotations into the active document. On success the
// dialog reports the imported annotation count back to the user.
//
// The dialog is purely a UI shell — it owns no engine state.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { X, Upload } from "lucide-react";

export interface CommentImportConfirm {
  /** Path the user picked. */
  path: string;
  /** Annotations merged into the doc. */
  annotationCount: number;
}

interface CommentImportDialogProps {
  open: boolean;
  /** Pop the OS open dialog. Returns the picked file's bytes +
   *  path, or null (user cancelled). */
  pickFile: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  /** Run the engine import. Returns the merged annotation count or
   *  an error string. */
  runImportFdf: (
    bytes: Uint8Array,
  ) => Promise<{ annotationCount: number } | { error: string }>;
  onConfirm: (result: CommentImportConfirm) => void;
  onClose: () => void;
}

export function CommentImportDialog(
  props: CommentImportDialogProps,
): ReactElement | null {
  const { open, pickFile, runImportFdf, onConfirm, onClose } = props;
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

  if (!open) return null;

  const onConfirmClick = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const picked = await pickFile();
      if (picked === null) {
        // User cancelled — close quietly.
        setRunning(false);
        onClose();
        return;
      }
      const res = await runImportFdf(picked.bytes);
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      setRunning(false);
      onConfirm({ path: picked.path, annotationCount: res.annotationCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRunning(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      data-comment-import-dialog
    >
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-import-dialog-title"
      >
        <div className="modal-header">
          <h2
            id="comment-import-dialog-title"
            className="modal-title"
          >
            Import comments
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
            Merge annotations from an FDF file into the active
            document. The original PDF content is untouched — only
            the comments are added. Use <strong>Export
            comments</strong> to save comments from one document for
            later re-import into another.
          </p>

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
            data-comment-import-confirm
          >
            <Upload size={14} aria-hidden />
            {running ? "Importing…" : "Import comments"}
          </button>
        </div>
      </div>
    </div>
  );
}