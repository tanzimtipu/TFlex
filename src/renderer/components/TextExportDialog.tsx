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
import { DialogShell, type DialogAction } from "./DialogShell";
import { classifyPageRange, defaultPageRange } from "../engine/types";
import {
  defaultTextExportFilename,
  downloadBlob,
} from "../utils/exportDownload";
import { exportOutputNameStem } from "./exportConfig";
import { ExportFidelityNotes } from "./ExportFidelityNotes";
import { ExportPagesWithoutTextNotice } from "./ExportPagesWithoutTextNotice";
import {
  fetchTextFreePageNumbers,
  type TextFreePagesEngine,
} from "../utils/exportWithoutText";

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
  /** Phase 112 (C5 follow-up) - the Inspector's prepared page range as the
   *  dialog's own TEXT expression. Re-parsed by the dialog; absent = all. */
  initialRange?: string | null;
  /** Phase 112 (C5 follow-up) - the Inspector's prepared output name. Its stem
   *  seeds the downloaded filename; absent falls back to `sourceName`. */
  initialOutputName?: string | null;
  /** The active document's engine id, or null when none is open. */
  docId?: string | null;
  /** The engine client the dialog reads `exportText(docId)` from, as a MEMBER
   *  (never detached — the client reads `this.inner`; DEF-106 / DEF-374). */
  engine?: TextFreePagesEngine;
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
    initialRange,
    initialOutputName,
    docId = null,
    engine,
    onClose,
  } = props;
  const initialRangeText = useMemo(
    () => (initialRange != null && initialRange.length > 0 ? initialRange : defaultPageRange(totalPages)),
    [initialRange, totalPages],
  );
  const [rangeText, setRangeText] = useState<string>(initialRangeText);
  const [format, setFormat] = useState<TextExportFormat>("txt");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagesWithoutText, setPagesWithoutText] = useState<number[] | null>(null);
  const cancelRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!open) return;
    setRangeText(initialRangeText);
    setFormat("txt");
    setRunning(false);
    setError(null);
    setPagesWithoutText(null);
    cancelRef.current.aborted = false;
  }, [open, totalPages, initialRangeText]);

  // DEF-390 — name the pages with no extractable text, as the xlsx/pptx
  // surfaces do. `engine.exportText(docId)` is the same source the export
  // reads; the call is a MEMBER call (DEF-106 / DEF-374). The read is async
  // and NEVER blocks the dialog: the form renders immediately and the notice
  // appears only if/when it resolves. A missing channel, a typed failure or a
  // rejection yields null and renders no notice — the export proceeds
  // regardless, so a slow or failed extraction never breaks it.
  useEffect(() => {
    if (!open) return;
    setPagesWithoutText(null);
    if (docId === null || engine === undefined) return;
    let cancelled = false;
    void fetchTextFreePageNumbers(engine, docId).then((pages): void => {
      if (!cancelled) setPagesWithoutText(pages);
    });
    return (): void => {
      cancelled = true;
    };
  }, [open, docId, engine]);

  // Esc-to-close, the backdrop drag guard and initial focus are owned by
  // DialogShell. The primary Export action is marked `default` so it
  // receives focus on open.

  const rangeCheck = useMemo(
    () => classifyPageRange(rangeText, totalPages),
    [rangeText, totalPages],
  );
  const parsed = rangeCheck.pages;
  const valid = rangeCheck.state === "valid" && !running;

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
      // Phase 112 (C5 follow-up) - the Inspector's prepared output name seeds
      // the filename stem; otherwise the source name does.
      const nameStem =
        initialOutputName != null && initialOutputName.length > 0
          ? exportOutputNameStem(initialOutputName)
          : sourceName;
      downloadBlob(blob, defaultTextExportFilename(nameStem, format));
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

  // The exit action swaps label/hook with the running gate; the primary
  // Export action carries the shipped `data-text-export-confirm` hook.
  const actions: DialogAction[] = [
    running
      ? Object.assign(
          {
            key: "cancel",
            label: "Cancel export",
            variant: "secondary" as const,
            onClick: onCancelRun,
          },
          { "data-text-export-cancel": true },
        )
      : Object.assign(
          {
            key: "close",
            label: "Close",
            variant: "secondary" as const,
            onClick: onClose,
          },
          { "data-text-export-close": true },
        ),
    Object.assign(
      {
        key: "confirm",
        label: running ? "Exporting…" : "Export",
        variant: "primary" as const,
        onClick: (): void => {
          void onConfirmClick();
        },
        disabled: !valid,
        default: true,
      },
      { "data-text-export-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Export text"
      titleId="text-export-dialog-title"
      size="tool"
      onClose={onClose}
      blockBackdropClose={running}
      closeDisabled={running}
      actions={actions}
      data-text-export-dialog
    >
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
              aria-describedby={
                rangeCheck.state === "valid" ? "text-range-help" : "text-range-error"
              }
              aria-invalid={rangeCheck.state !== "valid"}
            />
            <span className="modal-hint" id="text-range-help">
              Examples: <code>10-20</code>, <code>1,3,5-7</code>.
            </span>
            {rangeCheck.state !== "valid" && (
              <span
                className="export-config-error"
                id="text-range-error"
                role="alert"
                data-text-range-error
              >
                {rangeCheck.message}
              </span>
            )}
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

          <ExportFidelityNotes format="txt" />

          <ExportPagesWithoutTextNotice pages={pagesWithoutText} />

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
    </DialogShell>
  );
}
