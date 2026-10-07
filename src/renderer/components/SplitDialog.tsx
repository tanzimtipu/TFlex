import { useEffect, useMemo, useState, type ReactElement } from "react";
import { classifyPageRange, defaultPageRange } from "../engine/types";
import type { DialogAction } from "./DialogShell";
import { TaskDialog } from "./TaskDialog";

export type SplitMode = "extract" | "split";

export interface SplitConfirm {
  range: number[];
  mode: SplitMode;
}

interface SplitDialogProps {
  open: boolean;
  totalPages: number;
  /** Real source document name for the header context line, e.g.
   *  `report.pdf`. Optional: when absent no context line is rendered
   *  (never a fabricated name). */
  sourceName?: string;
  onClose: () => void;
  onConfirm: (choice: SplitConfirm) => void;
}

export function SplitDialog(props: SplitDialogProps): ReactElement | null {
  const { open, totalPages, sourceName, onClose, onConfirm } = props;
  const [text, setText] = useState<string>(defaultPageRange(totalPages));
  const [mode, setMode] = useState<SplitMode>("extract");

  // Reset text when reopened.
  useEffect(() => {
    if (open) {
      setText(defaultPageRange(totalPages));
      setMode("extract");
    }
  }, [open, totalPages]);

  const check = useMemo(() => classifyPageRange(text, totalPages), [text, totalPages]);
  const parsed = check.state === "valid" ? check.pages : null;
  const valid = check.state === "valid" && parsed !== null;

  // DialogShell owns Esc-to-close, the backdrop drag guard and initial focus.
  const actions: DialogAction[] = [
    { key: "cancel", label: "Cancel", variant: "secondary", onClick: onClose },
    {
      key: "confirm",
      label: mode === "extract" ? "Extract" : "Split",
      variant: "primary",
      onClick: (): void => {
        if (parsed !== null) onConfirm({ range: parsed, mode });
      },
      disabled: !valid,
      default: true,
    },
  ];

  // Header context line: the real source basename plus the live page count.
  // Rendered only when the host supplies a name, so no fabricated document
  // name ever appears.
  const headerContext =
    sourceName !== undefined && sourceName.length > 0
      ? `${sourceName} - ${totalPages} page${totalPages === 1 ? "" : "s"}`
      : undefined;

  return (
    <TaskDialog
      open={open}
      title="Extract or split pages"
      titleId="split-dialog-title"
      width="compact"
      headerContext={headerContext}
      onClose={onClose}
      actions={actions}
    >
      <p className="modal-help">
            Specify which pages to keep. Examples: <code>10-20</code>,
            <code>1,3,5-7</code>. The source has <strong>{totalPages}</strong>{" "}
            page{totalPages === 1 ? "" : "s"}.
          </p>
          <label className="modal-field">
            <span>Page range</span>
            <input
              id="split-page-range"
              type="text"
              className="modal-input"
              value={text}
              onChange={(e): void => setText(e.target.value)}
              placeholder={defaultPageRange(totalPages)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              aria-describedby="split-range-status"
              aria-invalid={!valid}
            />
          </label>
          <div
            id="split-range-status"
            className="modal-status"
            aria-live="polite"
            data-range-state={check.state}
          >
            {valid && parsed !== null ? (
              <span>{parsed.length} page{parsed.length === 1 ? "" : "s"} selected</span>
            ) : (
              <span className="hint" data-range-error>
                {check.message}
              </span>
            )}
          </div>
          <fieldset className="modal-position">
            <legend>Result</legend>
            <label>
              <input
                type="radio"
                name="split-mode"
                checked={mode === "extract"}
                onChange={(): void => setMode("extract")}
              />
              <span>Extract — copy the selected pages to a new document; the source keeps all its pages.</span>
            </label>
            <label>
              <input
                type="radio"
                name="split-mode"
                checked={mode === "split"}
                onChange={(): void => setMode("split")}
              />
              <span>Split — move the selected pages to a new document; the rest stay here.</span>
            </label>
          </fieldset>
    </TaskDialog>
  );
}