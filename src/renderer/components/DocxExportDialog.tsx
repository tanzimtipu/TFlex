// Phase 9 — Export to Word (.docx) dialog.
//
// The renderer rasterizes every page of the active document to PNG
// at the user's chosen DPI, hands the buffers to
// `engine.createDocxFromImages(entries)`, and the engine assembles
// them into a single .docx ZIP. The renderer triggers the per-file
// download via the standard anchor-download trick.
//
// Why renderer-side rasterization? The main process has no canvas /
// DOM surface. Page rasterization is already a renderer-side
// concern (the export-pages pipeline uses pdf.js in the renderer
// for the same reason). We re-use `rasterizePageToBlob` so the
// JPEG-quality + DPI math is shared.
//
// Each page becomes one full-width image on its own DOCX page. The
// engine sets page dimensions to the page's PDF-point size so the
// result preserves the original layout (portrait / landscape) for
// viewing in Word / Google Docs / LibreOffice.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";
import { defaultPageRange, parsePageRange } from "../engine/types";
import {
  clampExportImageDpi,
  DEFAULT_EXPORT_IMAGE_DPI,
} from "../state/preferences";
import {
  rasterizePageToBlob,
} from "../pdf/rasterize";
import {
  defaultDocxExportFilename,
  downloadBlob,
} from "../utils/exportDownload";
import type {
  DocxImageEntry,
  ExportPagesPayload,
} from "../../shared/types";

export interface DocxExportConfirm {
  range: number[];
  dpi: number;
}

interface DocxExportDialogProps {
  open: boolean;
  totalPages: number;
  /** Calls `engine.exportPages(docId, rangePayload)` to fetch
   *  per-page PDF buffers (the same pipeline the raster export
   *  uses). The dialog owns the rasterization + DOCX assembly
   *  steps from there. */
  runEngineExport: (
    payload: ExportPagesPayload,
  ) => Promise<
    | {
        pageIndex: number;
        buffer: Uint8Array;
        format: "png" | "jpeg" | "tiff";
        width: number;
        height: number;
      }[]
    | { error: string }
  >;
  /** Calls `engine.createDocxFromImages(entries)` to assemble the
   *  DOCX. The dialog never inspects the bytes; it just hands them
   *  to the renderer-side download. */
  runAssemble: (
    entries: DocxImageEntry[],
  ) => Promise<Uint8Array | { error: string }>;
  onConfirm: (result: DocxExportConfirm) => void;
  sourceName: string;
  onClose: () => void;
}

export function DocxExportDialog(
  props: DocxExportDialogProps,
): ReactElement | null {
  const {
    open,
    totalPages,
    runEngineExport,
    runAssemble,
    onConfirm,
    sourceName,
    onClose,
  } = props;
  const initialRange = useMemo(() => defaultPageRange(totalPages), [totalPages]);
  const [rangeText, setRangeText] = useState<string>(initialRange);
  const [dpi, setDpi] = useState<number>(DEFAULT_EXPORT_IMAGE_DPI);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    pageIndex: number | null;
  }>({ current: 0, total: 0, pageIndex: null });
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!open) return;
    setRangeText(defaultPageRange(totalPages));
    setDpi(DEFAULT_EXPORT_IMAGE_DPI);
    setRunning(false);
    setProgress({ current: 0, total: 0, pageIndex: null });
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

  // B3/B6 — backdrop close only when the interaction STARTED on the
  // backdrop (a text-selection drag that begins in the range/DPI
  // input and releases over the backdrop must not dismiss the
  // dialog). Blocked entirely while an export is running.
  const backdrop = useBackdropClose(onClose, running);

  

  const onConfirmClick = async (): Promise<void> => {
    if (!valid || parsed === null) return;
    cancelRef.current.aborted = false;
    setRunning(true);
    setError(null);
    setProgress({ current: 0, total: parsed.length, pageIndex: null });
    try {
      const [start, end] = [
        parsed[0] ?? 1,
        parsed[parsed.length - 1] ?? totalPages,
      ] as [number, number];
      const exportRes = await runEngineExport({
        range: [start, end],
        format: "png", // rasterize PNG for DOCX assembly
        dpi,
      });
      if ("error" in exportRes) {
        setError(exportRes.error);
        setRunning(false);
        return;
      }
      const entries: DocxImageEntry[] = [];
      for (let i = 0; i < exportRes.length; i += 1) {
        if (cancelRef.current.aborted) {
          setError("DOCX export cancelled.");
          setRunning(false);
          return;
        }
        const e = exportRes[i];
        if (e === undefined) continue;
        const pageNumber = start + i;
        setProgress({
          current: i,
          total: exportRes.length,
          pageIndex: pageNumber,
        });
        // Rasterize the per-page PDF buffer at the chosen DPI to PNG.
        // PNG is required because the DOCX assembler embeds the bytes
        // verbatim into the .docx ZIP; lossless keeps the output
        // visually identical to the source PDF.
        const { blob, width, height } = await rasterizePageToBlob({
          pdfBytes: e.buffer,
          format: "png",
          dpi,
          signal: undefined,
        });
        const pngBuffer = new Uint8Array(await blob.arrayBuffer());
        entries.push({
          pageNumber,
          pngBuffer,
          // intrinsic viewport — the rendered bitmap's pixel size.
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          // pageWidth / pageHeight are in PDF points (72 DPI); we
          // record the source page's intrinsic dimensions so the
          // engine can size each DOCX page correctly. The width /
          // height fields above are bitmap pixels; the engine
          // converts to points using the supplied DPI.
          pageWidth: (width * 72) / Math.max(1, dpi),
          pageHeight: (height * 72) / Math.max(1, dpi),
        });
        setProgress({
          current: i + 1,
          total: exportRes.length,
          pageIndex: pageNumber,
        });
      }
      // Hand the entries to the engine for assembly. The engine
      // returns .docx bytes (a ZIP container). The renderer hands
      // those bytes to the standard anchor-download flow.
      const assembled = await runAssemble(entries);
      if (typeof assembled === "object" && "error" in assembled) {
        setError(assembled.error);
        setRunning(false);
        return;
      }
      if (!(assembled instanceof Uint8Array)) {
        setError("DOCX assembly failed.");
        setRunning(false);
        return;
      }
      const blob = new Blob([assembled.slice().buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      downloadBlob(blob, defaultDocxExportFilename(sourceName));
      setRunning(false);
      onConfirm({ range: parsed, dpi });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`DOCX export failed: ${msg}`);
      setRunning(false);
    }
  };

  const onCancelRun = (): void => {
    cancelRef.current.aborted = true;
    setError("DOCX export cancelled.");
    setRunning(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-docx-export-dialog
        >
      <TfDialog
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="docx-export-dialog-title"
      >
        <div className="modal-header">
          <h2 id="docx-export-dialog-title" className="modal-title">
            Export to Word
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
            Convert <strong>{sourceName}</strong> ({totalPages} pages) into
            a single .docx. Each page becomes an image on its own Word
            page, sized to the source layout. The result opens in
            Word / Google Docs / LibreOffice.
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
              data-docx-export-range
              disabled={running}
            />
            <span className="modal-hint">
              Examples: <code>10-20</code>, <code>1,3,5-7</code>.
            </span>
          </label>

          <label className="modal-field">
            <span>Resolution (DPI)</span>
            <input
              type="number"
              min={72}
              max={600}
              step={1}
              className="modal-input"
              value={dpi}
              onChange={(e): void => {
                const next = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(next)) {
                  setDpi(clampExportImageDpi(next));
                }
              }}
              onBlur={(): void => {
                setDpi(clampExportImageDpi(dpi));
              }}
              data-docx-export-dpi
              disabled={running}
              aria-label="Resolution in DPI"
            />
            <span className="modal-hint">
              Higher DPI = sharper text in the .docx but a much larger
              file. 150 is a balanced default; pick 300 for print-grade
              output.
            </span>
          </label>

          {running && (
            <div className="modal-status export-progress" aria-live="polite">
              <span>
                Rendering page {progress.pageIndex ?? "—"} of{" "}
                {progress.total}…
              </span>
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
              data-docx-export-cancel
            >
              Cancel export
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-docx-export-close
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
            data-docx-export-confirm
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
