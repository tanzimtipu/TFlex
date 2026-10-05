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

import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { DialogShell, type DialogAction } from "./DialogShell";

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

  useEffect(() => {
    if (!open) return;
    setRunning(false);
    setError(null);
  }, [open]);

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
        label: running ? "Exporting…" : "Export comments",
        variant: "primary" as const,
        icon: <Icon name="exportComments" size="sm" />,
        onClick: (): void => {
          void onConfirmClick();
        },
        disabled: running,
        default: true,
      },
      { "data-comment-export-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Export comments"
      titleId="comment-export-dialog-title"
      onClose={onClose}
      actions={actions}
      data-comment-export-dialog
    >
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
    </DialogShell>
  );
}