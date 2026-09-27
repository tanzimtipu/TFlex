import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { defaultPageRange, parsePageRange } from "../engine/types";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset text when reopened.
  useEffect(() => {
    if (open) {
      setText(defaultPageRange(totalPages));
      setMode("extract");
    }
  }, [open, totalPages]);

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
      "input, button, [tabindex]",
    );
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const parsed = useMemo(() => parsePageRange(text, totalPages), [text, totalPages]);
  const valid = parsed !== null && parsed.length > 0;

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the range input must not dismiss).
  const backdrop = useBackdropClose(onClose);

  

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
      <TfDialog
        className="modal-dialog dialog modal-dialog-tool"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-dialog-title"
      >
        <div className="modal-header">
          <h2 id="split-dialog-title" className="modal-title">
            Extract or split pages
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
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={(): void => {
              if (parsed !== null) onConfirm({ range: parsed, mode });
            }}
          >
            {mode === "extract" ? "Extract" : "Split"}
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}