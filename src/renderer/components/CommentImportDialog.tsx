// Phase 12 — Comment import dialog.
//
// One-click import: the user clicks "Import comments" and the
// dialog prompts the host's OS open dialog for an FDF file. The
// selected bytes are passed to `engine.importFdf`, which merges
// the annotations into the active document. On success the
// dialog reports the imported annotation count back to the user.
//
// The dialog is purely a UI shell — it owns no engine state.

import { useEffect, useState, type ReactElement } from "react";
import { Upload } from "lucide-react";
import { Icon } from "../icons/Icon";
import { DialogShell, type DialogAction } from "./DialogShell";

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

  useEffect(() => {
    if (!open) return;
    setRunning(false);
    setError(null);
  }, [open]);

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
        label: running ? "Importing…" : "Import comments",
        variant: "primary" as const,
        icon: <Icon icon={Upload} size="sm" />,
        onClick: (): void => {
          void onConfirmClick();
        },
        disabled: running,
        default: true,
      },
      { "data-comment-import-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Import comments"
      titleId="comment-import-dialog-title"
      onClose={onClose}
      blockBackdropClose={running}
      actions={actions}
      data-comment-import-dialog
    >
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
    </DialogShell>
  );
}