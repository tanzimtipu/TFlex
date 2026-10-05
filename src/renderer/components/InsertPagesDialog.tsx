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

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import {
  defaultInsertPosition,
} from "../engine/types";
import { DialogShell, type DialogAction } from "./DialogShell";
import { TfResize } from "./motion/TfResize";

export type InsertMode = "blank" | "fromPdf";

export interface InsertPagesConfirm {
  mode: InsertMode;
  /** Rank slot the new content lands at, 0-based: field value v maps
   *  to slot v - 1 ("the new content becomes page v"). -1 means
   *  "appended at end". The host translates per engine contract
   *  (insertBlankPage's afterIndex is one less than this slot — slot 0
   *  maps to the -2 PREPEND sentinel so the blank becomes page 1 —
   *  while insertFromPdf consumes the slot directly — DEF-122). Slot
   *  0 ("before page 1") is a VALID dialog choice in both modes
   *  (DEF-129). */
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

  // B18 — modal blocking while the OS file picker is open. The
  // dialog's pick button is disabled during `picking`, but the
  // backdrop click handler still fired `onClose` and dismissed
  // the picker mid-pick. The same pattern MergeDialog uses: bind
  // the backdrop to a no-op while `picking` is true and swallow
  // Esc in the capture phase so the picker owns input.
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

  // Position validation. The field value is the 1-based page number
  // the new content BECOMES (rank semantics: 1 = before page 1,
  // 2 = after page 1, ..., totalPages + 1 = appended after the last
  // page). "end" / empty maps to the append sentinel (-1). Position 1
  // is valid in BOTH modes (DEF-129): the DEF-114-era blanket
  // "blank mode minimum is 2 on a non-empty doc" silently disabled a
  // legitimate position on the engine's behalf. The dialog no longer
  // hides the choice; the host owns the engine-contract translation
  // (slot 0 -> afterIndex -2, the PREPEND sentinel; -1 = append).
  const parsed = useMemo((): { position: number; valid: boolean } => {
    const trimmed = positionText.trim().toLowerCase();
    if (trimmed === "end" || trimmed === "") {
      return { position: -1, valid: true };
    }
    const n = Number.parseInt(trimmed, 10);
    const min = 1;
    if (!Number.isFinite(n) || n < min || n > totalPages + 1) {
      return { position: -1, valid: false };
    }
    return { position: n - 1, valid: true };
  }, [positionText, totalPages, mode]);

  const valid =
    parsed.valid &&
    (mode === "blank" ||
      (mode === "fromPdf" && pickedBytes !== null && pickedPath !== null));

  // DEF-122 — the field value is the rank the new content lands at
  // ("becomes page v"), but users reason about placement in terms of
  // "after page N". The hint phrases the value in those terms so the
  // intent matches the result: entering 2 means "after page 1" (the
  // new content becomes page 2). DEF-129 — position 1 (before page
  // 1) is offered in blank mode too and maps to the engine's -2
  // prepend sentinel.
  let positionHint: ReactElement;
  if (mode === "blank") {
    positionHint = totalPages > 0 ? (
      <>
        The blank page becomes this page number — 1 inserts before
        page 1, 2 after page 1, {totalPages + 1} appends after the
        last page. Use <code>end</code> to append.
      </>
    ) : (
      <>
        The blank page becomes page 1 (the document is empty). Use{" "}
        <code>end</code> to append.
      </>
    );
  } else {
    positionHint = (
      <>
        The inserted pages start at this page number — 1 inserts
        before page 1, 2 after page 1, {totalPages + 1} appends after
        the last page. Use <code>end</code> to append.
      </>
    );
  }

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
        label: "Insert",
        variant: "primary" as const,
        onClick: onConfirmClick,
        disabled: !valid,
        default: true,
      },
      { "data-insert-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Insert pages"
      titleId="insert-pages-dialog-title"
      size="tool"
      onClose={onClose}
      blockBackdropClose={picking}
      actions={actions}
      data-picking={picking ? "true" : "false"}
      data-insert-pages-dialog
    >
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
        <span className="modal-hint">{positionHint}</span>
      </label>

      <TfResize axes="height">
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
            <Icon name="insertPages" size="sm" />
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
      </TfResize>

      {error !== null && (
        <div className="modal-status optimize-error" role="alert">
          <span>{error}</span>
        </div>
      )}
    </DialogShell>
  );
}

/** Re-export for the host's renderer-side test surface. */
export const _INTERNAL_BLANK_PRESETS = BLANK_PRESETS;
