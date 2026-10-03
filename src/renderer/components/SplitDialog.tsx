import { useEffect, useMemo, useState, type ReactElement } from "react";
import { defaultPageRange, parsePageRange } from "../engine/types";
import { DialogShell, type DialogAction } from "./DialogShell";

export type SplitMode = "extract" | "split";

export interface SplitConfirm {
  range: number[];
  mode: SplitMode;
}

interface SplitDialogProps {
  open: boolean;
  totalPages: number;
  onClose: () => void;
  onConfirm: (choice: SplitConfirm) => void;
}

export function SplitDialog(props: SplitDialogProps): ReactElement | null {
  const { open, totalPages, onClose, onConfirm } = props;
  const [text, setText] = useState<string>(defaultPageRange(totalPages));
  const [mode, setMode] = useState<SplitMode>("extract");

  // Reset text when reopened.
  useEffect(() => {
    if (open) {
      setText(defaultPageRange(totalPages));
      setMode("extract");
    }
  }, [open, totalPages]);

  const parsed = useMemo(() => parsePageRange(text, totalPages), [text, totalPages]);
  const valid = parsed !== null && parsed.length > 0;

  // The primary Extract/Split action is marked `default`; DialogShell owns
  // Esc-to-close, the backdrop drag guard and initial focus.
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

  return (
    <DialogShell
      open={open}
      title="Extract or split pages"
      titleId="split-dialog-title"
      size="tool"
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
              type="text"
              className="modal-input"
              value={text}
              onChange={(e): void => setText(e.target.value)}
              placeholder={defaultPageRange(totalPages)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </label>
          <div className="modal-status" aria-live="polite">
            {valid ? (
              <span>{parsed.length} page{parsed.length === 1 ? "" : "s"} selected</span>
            ) : (
              <span className="hint">Enter at least one page (e.g. 1-3).</span>
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
              <span>Extract — keep only the selected pages in a new document.</span>
            </label>
            <label>
              <input
                type="radio"
                name="split-mode"
                checked={mode === "split"}
                onChange={(): void => setMode("split")}
              />
              <span>Split — selected pages go to a new document, the rest stay here.</span>
            </label>
          </fieldset>
    </DialogShell>
  );
}