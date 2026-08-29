// Phase 9 — Insert pages dialog.
//
// Two insertion modes:
//   - Blank page: insert a blank page at a chosen position (before
//     page 1, between two pages, or appended at the end). Width /
//     height default to US-Letter (612 x 792 pt); the user can pick
//     A4 (595 x 842 pt) too. The engine's `insertBlankPage` adds the
//     page to the active doc's PDF and updates the page-order array.
//   - From another PDF: pick a second PDF file, choose a position,
//     and the engine copies every page of the source into the
//     active doc at that position. The engine handles the bytes
//     load + page copy; the renderer just supplies the path the
//     user picked.
//
// Both flows are undoable through the existing engine undo path.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FilePlus2, X } from "lucide-react";
import {
  defaultInsertPosition,
} from "../engine/types";

export type InsertMode = "blank" | "fromPdf";

export interface InsertPagesConfirm {
  mode: InsertMode;
  /** 0-based visible index. -1 means "appended at end". */
  position: number;
  /** Blank-page dimensions in PDF points (only used when mode = "blank"). */
  widthPt?: number;
  heightPt?: number;
  /** Other PDF bytes (only used when mode = "fromPdf"). */
  otherBytes?: Uint8Array;
  /** Other PDF path (for display + engine fallback). */
  otherPath?: string;
}

interface InsertPagesDialogProps {
  open: boolean;
  totalPages: number;
  /** Lets the host open its own OS file picker for the "from PDF"
   *  flow. Returns the picked PDF's bytes + path. */
  pickOtherFile: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  onConfirm: (choice: InsertPagesConfirm) => void;
  onClose: () => void;
}

const BLANK_PRESETS = [
  { id: "letter", label: "US Letter", widthPt: 612, heightPt: 792 },
  { id: "a4", label: "A4", widthPt: 595, heightPt: 842 },
  { id: "legal", label: "US Legal", widthPt: 612, heightPt: 1008 },
  { id: "square", label: "Square (1:1)", widthPt: 612, heightPt: 612 },
] as const;

export function InsertPagesDialog(
  props: InsertPagesDialogProps,
): ReactElement | null {
  const { open, totalPages, pickOtherFile, onConfirm, onClose } = props;
  const [mode, setMode] = useState<InsertMode>("blank");
  const [positionText, setPositionText] = useState<string>(
    defaultInsertPosition(totalPages),
  );
  const [presetId, setPresetId] = useState<(typeof BLANK_PRESETS)[number]["id"]>(
    "letter",
  );
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedBytes, setPickedBytes] = useState<Uint8Array | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time we re-open so stale state from a previous open
  // doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setMode("blank");
    setPositionText(defaultInsertPosition(totalPages));
    setPresetId("letter");
    setPickedPath(null);
    setPickedBytes(null);
    setPicking(false);
    setError(null);
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
      "button, input, [tabindex]",
    );
    first?.focus();
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Position validation. Accepts an integer 1..totalPages+1, or "end".
  const parsed = useMemo((): { position: number; valid: boolean } => {
    const trimmed = positionText.trim().toLowerCase();
    if (trimmed === "end" || trimmed === "") {
      return { position: -1, valid: true };
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > totalPages + 1) {
      return { position: -1, valid: false };
    }
    return { position: n - 1, valid: true };
  }, [positionText, totalPages]);

  const valid =
    parsed.valid &&
    (mode === "blank" ||
      (mode === "fromPdf" && pickedBytes !== null && pickedPath !== null));

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
    if (mode === "blank") {
      const preset = BLANK_PRESETS.find((p) => p.id === presetId);
      if (preset === undefined) return;
      onConfirm({
        mode: "blank",
        position: parsed.position,
        widthPt: preset.widthPt,
        heightPt: preset.heightPt,
      });
    } else {
      if (pickedBytes === null || pickedPath === null) return;
      onConfirm({
        mode: "fromPdf",
        position: parsed.position,
        otherBytes: pickedBytes,
        otherPath: pickedPath,
      });
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      data-insert-pages-dialog
    >
      <div
        className="modal-dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="insert-pages-dialog-title"
      >
        <div className="modal-header">
          <h2
            id="insert-pages-dialog-title"
            className="modal-title"
          >
            Insert pages
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
            Insert a blank page, or import every page from another
            PDF, into the active document. Both modes are undoable.
          </p>

          <fieldset className="modal-position">
            <legend>What to insert</legend>
            <label>
              <input
                type="radio"
                name="insert-mode"
                checked={mode === "blank"}
                onChange={(): void => setMode("blank")}
                data-insert-mode="blank"
              />
              <span>Blank page</span>
            </label>
            <label>
              <input
                type="radio"
                name="insert-mode"
                checked={mode === "fromPdf"}
                onChange={(): void => setMode("fromPdf")}
                data-insert-mode="fromPdf"
              />
              <span>Pages from another PDF</span>
            </label>
          </fieldset>

          <label className="modal-field">
            <span>Insert at page</span>
            <input
              type="text"
              className="modal-input"
              value={positionText}
              onChange={(e): void => setPositionText(e.target.value)}
              placeholder={defaultInsertPosition(totalPages)}
              data-insert-position
            />
            <span className="modal-hint">
              Page number where the new content lands. Use{" "}
              <code>end</code> to append. 1 means "before page 1";{" "}
              {totalPages + 1} means "appended after the last page".
            </span>
          </label>

          {mode === "blank" && (
            <fieldset className="modal-position">
              <legend>Page size</legend>
              {BLANK_PRESETS.map((p) => (
                <label key={p.id}>
                  <input
                    type="radio"
                    name="blank-preset"
                    checked={presetId === p.id}
                    onChange={(): void => setPresetId(p.id)}
                    data-insert-preset={p.id}
                  />
                  <span>
                    {p.label} ({p.widthPt} × {p.heightPt} pt)
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {mode === "fromPdf" && (
            <div className="modal-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(): void => {
                  void onPickFile();
                }}
                disabled={picking}
                data-insert-pick
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
                  <span title={pickedPath}>{pickedPath.split(/[\\/]/).pop()}</span>
                )}
              </div>
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
            data-insert-confirm
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

/** Re-export for the host's renderer-side test surface. */
export const _INTERNAL_BLANK_PRESETS = BLANK_PRESETS;
