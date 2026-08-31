import { useEffect, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import type { MergePosition } from "../engine/types";

export interface MergeConfirm {
  otherPath: string;
  position: MergePosition;
}

/** Controlled by the parent: `open` flips true to show, `onClose` is called
 *  on Cancel/Esc/overlay-click, `onConfirm` is called with the user's choices
 *  when they pick a file and click Merge. */
interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (choice: MergeConfirm) => void;
  /** Returns the file path chosen by the user, or null on cancel. */
  pickFile: () => Promise<string | null>;
  /** Hint label shown above the file picker. */
  sourceName: string;
}

export function MergeDialog(props: MergeDialogProps): ReactElement | null {
  const { open, onClose, onConfirm, pickFile, sourceName } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  const [position, setPosition] = useState<MergePosition>("after");
  const [picking, setPicking] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time we re-open so a stale path doesn't sneak in.
  useEffect(() => {
    if (open) {
      setChosen(null);
      setPosition("after");
      setPicking(false);
    }
  }, [open]);

  // Esc closes; focus first input when opened.
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
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onPick = async (): Promise<void> => {
    setPicking(true);
    try {
      const path = await pickFile();
      if (path !== null) setChosen(path);
    } finally {
      setPicking(false);
    }
  };

  const basename = (path: string): string => {
    const norm = path.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    return idx === -1 ? norm : norm.slice(idx + 1);
  };

  const canConfirm = chosen !== null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
      >
        <div className="modal-header">
          <h2 id="merge-dialog-title" className="modal-title">
            Merge with another PDF
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
            Pick a PDF to combine with <strong>{sourceName}</strong>. Pages from
            the chosen file are inserted either before or after the current
            document.
          </p>
          <div className="modal-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={(): void => {
                void onPick();
              }}
              disabled={picking}
            >
              {picking ? "Picking…" : chosen === null ? "Choose PDF…" : "Change…"}
            </button>
            <div className="modal-picked" aria-live="polite">
              {chosen === null ? (
                <span className="hint">No file selected</span>
              ) : (
                <span title={chosen}>{basename(chosen)}</span>
              )}
            </div>
          </div>
          <fieldset className="modal-position">
            <legend>Insert position</legend>
            <label>
              <input
                type="radio"
                name="merge-pos"
                checked={position === "before"}
                onChange={(): void => setPosition("before")}
              />
              <span>Before {sourceName}</span>
            </label>
            <label>
              <input
                type="radio"
                name="merge-pos"
                checked={position === "after"}
                onChange={(): void => setPosition("after")}
              />
              <span>After {sourceName}</span>
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
            disabled={!canConfirm}
            onClick={(): void => {
              if (chosen !== null) {
                onConfirm({ otherPath: chosen, position });
              }
            }}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}