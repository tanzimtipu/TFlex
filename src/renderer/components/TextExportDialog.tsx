// Phase 9 — Export text dialog (plain text + RTF).
//
// The user picks a page range + format (TXT or RTF) and the dialog
// calls `engine.exportText(docId)` to read per-page text. The
// renderer composes the per-page strings into a single document:
//   - TXT: page-break separators (FF form-feed char) between pages.
//   - RTF: minimal RTF wrapper with \par page breaks and basic
//     styling (the format every Wordpad / Word / LibreOffice
//     recognises without needing a full RTF encoder library).
//
// Both formats are saved via the renderer-side anchor-download flow
// (see utils/exportDownload.ts). No backend IPC for save is needed —
// the dialog only reads text from the engine, then the renderer
// composes the output bytes.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { defaultPageRange, parsePageRange } from "../engine/types";
import {
  defaultTextExportFilename,
  downloadBlob,
} from "../utils/exportDownload";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

export type TextExportFormat = "txt" | "rtf";

export interface TextExportConfirm {
  range: number[];
  format: TextExportFormat;
  text: string;
}

interface TextExportDialogProps {
  open: boolean;
  totalPages: number;
  /** Calls `engine.exportText(docId)` and returns the per-page text
   *  list. The dialog is ignorant of which tab is active. */
  runExport: () => Promise<
    { pageIndex: number; text: string }[] | { error: string }
  >;
  onConfirm: (result: TextExportConfirm) => void;
  sourceName: string;
  onClose: () => void;
}

export function TextExportDialog(
  props: TextExportDialogProps,
): ReactElement | null {
  const {
    open,
    totalPages,
    runExport,
    onConfirm,
    sourceName,
    onClose,
  } = props;
  const initialRange = useMemo(() => defaultPageRange(totalPages), [totalPages]);
  const [rangeText, setRangeText] = useState<string>(initialRange);
  const [format, setFormat] = useState<TextExportFormat>("txt");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!open) return;
    setRangeText(defaultPageRange(totalPages));
    setFormat("txt");
    setRunning(false);
    setError(null);
    cancelRef.current.aborted = false;
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

  const parsed = useMemo(
    () => parsePageRange(rangeText, totalPages),
    [rangeText, totalPages],
  );
  const valid = parsed !== null && parsed.length > 0 && !running;

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop; blocked entirely while an export is running.
  const backdrop = useBackdropClose(onClose, running);

  

  const onConfirmClick = async (): Promise<void> => {
    if (!valid || parsed === null) return;
    cancelRef.current.aborted = false;
    setRunning(true);
    setError(null);
    try {
      const res = await runExport();
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      // Honour the user-picked range; the engine returns every page
      // and we filter here.
      const inRange = res.filter((p) => parsed.includes(p.pageIndex));
      const ordered = inRange.slice().sort((a, b) => a.pageIndex - b.pageIndex);
      const joined = ordered
        .map((p) => p.text)
        .join(format === "txt" ? "\n\f\n" : "\n");
      setRunning(false);
      // Renderer-side download — we don't ship bytes back to the host
      // for text exports (unlike raster exports which can run into
      // hundreds of MB on a 600 DPI scan). The host's onConfirm is
      // only used for the success toast.
      const blob = new Blob([joined], {
        type: format === "rtf" ? "application/rtf" : "text/plain",
      });
      downloadBlob(blob, defaultTextExportFilename(sourceName, format));
      onConfirm({ range: parsed, format, text: joined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Text export failed: ${msg}`);
      setRunning(false);
    }
  };

  const onCancelRun = (): void => {
    cancelRef.current.aborted = true;
    setError("Text export cancelled.");
    setRunning(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-text-export-dialog
        >
      <TfDialog
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-export-dialog-title"
      >
        <div className="modal-header">
          <h2
            id="text-export-dialog-title"
            className="modal-title"
          >
            Export text
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={running}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Extract text from <strong>{sourceName}</strong> ({totalPages}{" "}
            total). Plain text preserves reading order; RTF preserves
            page breaks for Word / WordPad.
          </p>

          <label className="modal-field">
            <span>Page range</span>
            <input
              type="text"
              className="modal-input"
              value={rangeText}
              onChange={(e): void => setRangeText(e.target.value)}
              placeholder={defaultPageRange(totalPages)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-text-export-range
              disabled={running}
            />
            <span className="modal-hint">
              Examples: <code>10-20</code>, <code>1,3,5-7</code>.
            </span>
          </label>

          <fieldset className="modal-position export-format">
            <legend>Output format</legend>
            <label>
              <input
                type="radio"
                name="text-export-format"
                checked={format === "txt"}
                onChange={(): void => setFormat("txt")}
                disabled={running}
                data-text-export-format="txt"
              />
              <span>Plain text (.txt) — universal, page-break on FF char</span>
            </label>
            <label>
              <input
                type="radio"
                name="text-export-format"
                checked={format === "rtf"}
                onChange={(): void => setFormat("rtf")}
                disabled={running}
                data-text-export-format="rtf"
              />
              <span>Rich Text Format (.rtf) — Word / WordPad / LibreOffice</span>
            </label>
          </fieldset>

          {running && (
            <div className="modal-status export-progress" aria-live="polite">
              <span>Extracting text…</span>
            </div>
          )}

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {running ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancelRun}
              data-text-export-cancel
            >
              Cancel export
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-text-export-close
            >
              Close
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={(): void => {
              void onConfirmClick();
            }}
            data-text-export-confirm
          >
            {running ? "Exporting…" : "Export"}
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
