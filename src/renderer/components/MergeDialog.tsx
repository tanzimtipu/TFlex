import { useEffect, useRef, useState, type ReactElement } from "react";
import type { MergePosition } from "../engine/types";
import { DialogShell, type DialogAction } from "./DialogShell";

export interface MergeConfirm {
  otherPath: string;
  /** Other PDF's raw bytes, returned alongside the path so the
   *  host can route "afterPage" inserts through the engine's
   *  `insertFromPdf` IPC (which accepts bytes, not paths). */
  otherBytes: Uint8Array;
  position: MergePosition;
  /** When `position === "afterPage"`, the 1-based page number the
   *  inserted pages go after. 1-based against the active doc's
   *  CURRENT visible order (the same scale the engine consumes for
   *  `insertFromPdf`). Undefined for the other positions. */
  afterPage?: number;
}

/** Picked file payload. The dialog needs the path (for the engine's
 *  `merge` IPC, which loads by path) AND the bytes (for
 *  `insertFromPdf`, which inserts every page at a specific
 *  1-based position — used when the user picks the new
 *  "After page N" position). Always both, even if the user only
 *  picks one of the simple positions. */
export interface MergePickedFile {
  path: string;
  bytes: Uint8Array;
}

/** Controlled by the parent: `open` flips true to show, `onClose` is called
 *  on Cancel/Esc/overlay-click, `onConfirm` is called with the user's choices
 *  when they pick a file and click Merge. */
interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (choice: MergeConfirm) => void;
  /** Returns the picked file (path + bytes), or null on cancel.
   *  B12 — the dialog needs the bytes even for the simple
   *  before/after positions so a future merge flow that needs the
   *  bytes (e.g. encryption stripping) can consume them without a
   *  second file picker. */
  pickFile: () => Promise<MergePickedFile | null>;
  /** Hint label shown above the file picker. */
  sourceName: string;
  /** Total page count of the active doc. When > 0 we expose the
   *  "After page N" option (B12) — the user can pin the merge
   *  position to a specific page instead of just "before / after
   *  the entire doc". When 0 (no active doc), the option is
   *  hidden so the user only sees the binary before/after. */
  totalPages?: number;
}

export function MergeDialog(props: MergeDialogProps): ReactElement | null {
  const { open, onClose, onConfirm, pickFile, sourceName, totalPages = 0 } = props;
  const [chosen, setChosen] = useState<MergePickedFile | null>(null);
  const [position, setPosition] = useState<MergePosition>("after");
  const [afterPage, setAfterPage] = useState<number>(1);
  const [picking, setPicking] = useState(false);
  const pickButtonRef = useRef<HTMLButtonElement | null>(null);

  // Reset every time we re-open so a stale path doesn't sneak in.
  useEffect(() => {
    if (open) {
      setChosen(null);
      setPosition("after");
      // Default "After page N" to the active doc's current page so
      // the natural action is "insert at the page I'm looking at".
      // We default to "end of doc" (pageCount) — same value the
      // engine expects for "append"; the user can move it back.
      const seedAfter = totalPages > 0 ? totalPages : 1;
      setAfterPage(seedAfter);
      setPicking(false);
    }
  }, [open, totalPages]);

  // DialogShell owns Esc-to-close and the backdrop drag guard. The shipped
  // first-control focus is kept here: the pick button (the dialog's primary
  // affordance) receives focus on open. The Merge action is deliberately NOT
  // marked `default` because it stays disabled until a file is chosen.
  useEffect(() => {
    if (!open) return;
    pickButtonRef.current?.focus();
  }, [open]);

  // B12 — modal blocking while the OS file picker is open. The
  // previous dialog left the backdrop click handler live during
  // `picking`, so the user could click outside the dialog mid-pick
  // and dismiss the picker (the file-picker button is disabled but
  // the backdrop swallows the click anyway). We now also block
  // Esc-while-picking, and the JSX wires the backdrop to a no-op
  // when `picking` is true so the dialog stays put until the OS
  // picker returns (success or cancel).
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        // Swallow Esc while picking — the OS picker owns the input
        // and the dialog must stay put so the user knows which
        // file they're confirming.
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // capture phase so we beat any other Esc listener that might
    // dismiss the dialog underneath the picker.
    window.addEventListener("keydown", onKey, true);
    return (): void => window.removeEventListener("keydown", onKey, true);
  }, [picking]);

  const onPick = async (): Promise<void> => {
    setPicking(true);
    try {
      const picked = await pickFile();
      if (picked !== null) setChosen(picked);
    } finally {
      setPicking(false);
    }
  };

  const basename = (path: string): string => {
    const norm = path.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    return idx === -1 ? norm : norm.slice(idx + 1);
  };

  const showAfterPage = totalPages > 0;
  const afterPageValid =
    !showAfterPage ||
    position !== "afterPage" ||
    (Number.isFinite(afterPage) &&
      afterPage >= 0 &&
      afterPage <= totalPages);
  // 0 means "at the very beginning" (before page 1). For positions
  // 1..totalPages, "after N" places the inserted pages between
  // pages N and N+1. Position totalPages+1 (e.g. "after last
  // page") is equivalent to appending — we accept it but the
  // canonical "append" path uses position "after" instead.
  const canConfirm = chosen !== null && afterPageValid;

  // The Merge action carries the shipped `data-merge-confirm` hook and
  // stays disabled until a file is chosen; it is NOT the shell `default`
  // (focus is kept on the pick button via the effect above).
  const actions: DialogAction[] = [
    {
      key: "cancel",
      label: "Cancel",
      variant: "secondary",
      onClick: onClose,
      disabled: picking,
    },
    Object.assign(
      {
        key: "confirm",
        label: "Merge",
        variant: "primary" as const,
        onClick: (): void => {
          if (chosen !== null) {
            onConfirm({
              otherPath: chosen.path,
              otherBytes: chosen.bytes,
              position,
              ...(position === "afterPage" ? { afterPage } : {}),
            });
          }
        },
        disabled: !canConfirm,
      },
      { "data-merge-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Merge with another PDF"
      titleId="merge-dialog-title"
      size="tool"
      className="merge-dialog"
      onClose={onClose}
      blockBackdropClose={picking}
      closeDisabled={picking}
      actions={actions}
      // data-picking and aria-busy signal the modal-block state while
      // the OS picker is open.
      data-picking={picking ? "true" : "false"}
      aria-busy={picking}
    >
      <p className="modal-help">
            Pick a PDF to combine with <strong>{sourceName}</strong>. Pages from
            the chosen file are inserted before, after, or at a chosen page of
            the current document.
          </p>
          <div className="modal-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={(): void => {
                void onPick();
              }}
              disabled={picking}
              data-merge-pick
              ref={pickButtonRef}
            >
              {picking ? "Picking…" : chosen === null ? "Choose PDF…" : "Change…"}
            </button>
            <div className="modal-picked" aria-live="polite">
              {chosen === null ? (
                <span className="hint">No file selected</span>
              ) : (
                <span title={chosen.path}>{basename(chosen.path)}</span>
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
                disabled={picking}
              />
              <span>Before {sourceName}</span>
            </label>
            <label>
              <input
                type="radio"
                name="merge-pos"
                checked={position === "after"}
                onChange={(): void => setPosition("after")}
                disabled={picking}
              />
              <span>After {sourceName}</span>
            </label>
            {/* B12 — merge at a specific page. The user picks a
                1-based page of the active doc; the inserted pages
                land between that page and the next. Default is the
                last page so the natural action is "append". Hidden
                when the active doc has zero pages so the user
                can't enter a meaningless number. */}
            {showAfterPage && (
              <label className="merge-after-page">
                <input
                  type="radio"
                  name="merge-pos"
                  checked={position === "afterPage"}
                  onChange={(): void => setPosition("afterPage")}
                  disabled={picking}
                  data-merge-pos="afterPage"
                />
                <span>After page</span>
                <input
                  type="number"
                  className="modal-input merge-after-page-input"
                  min={0}
                  max={totalPages}
                  step={1}
                  value={afterPage}
                  onChange={(e): void => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setAfterPage(n);
                  }}
                  onFocus={(): void => {
                    // Selecting the number input alone doesn't
                    // check the matching radio; do that for the
                    // user so the option they're typing into is
                    // visibly the active one.
                    setPosition("afterPage");
                  }}
                  disabled={picking || position !== "afterPage"}
                  aria-label="Insert after page number"
                  data-merge-after-page
                />
                <span className="merge-after-page-of">of {totalPages}</span>
              </label>
            )}
          </fieldset>
    </DialogShell>
  );
}