// Phase 9 — Export-Pages dialog.
//
// The user picks a page range + format (PNG / JPEG / TIFF) + DPI for the
// active document. The dialog drives the export pipeline end-to-end:
//
//   1. On confirm, the dialog asks the engine for the per-page PDF
//      buffers via `engine.exportPages(docId, payload)`. The backend
//      returns one single-page PDF buffer per requested page (POC
//      note: the backend chose buffer-return per page so the renderer
//      can rasterize with pdf.js without a custom rasterizer in main).
//   2. For each entry, the renderer rasterizes the per-page PDF
//      buffer at the requested DPI with pdf.js, then re-encodes the
//      bitmap to the requested format with canvas.toBlob(). For
//      TIFF, the canvas path falls back to PNG bytes (canvas has no
//      TIFF encoder) and the dialog writes the file with a .tif
//      extension. The backend can override with proper TIFF bytes
//      when its TIFF encoder is ready.
//   3. Each encoded blob triggers a per-page browser download via the
//      standard anchor-download pattern (see utils/exportDownload.ts).
//
// The dialog surfaces a per-page progress indicator while the export
// runs, and offers a Cancel button that aborts the in-flight work.
// Confirm is disabled while a previous export is still running.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_EXPORT_IMAGE_DPI,
  DEFAULT_EXPORT_IMAGE_FORMAT,
  EXPORT_IMAGE_FORMATS,
  clampExportImageDpi,
} from "../state/preferences";
import { defaultPageRange, parsePageRange } from "../engine/types";
import {
  isEngineNativeFormat,
  rasterizePageToBlob,
} from "../pdf/rasterize";
import {
  defaultExportFilename,
  downloadBlob,
  mimeForExportFormat,
} from "../utils/exportDownload";
import { useBackdropClose } from "./modalBackdrop";
import type {
  ExportImageFormat,
  ExportPageEntry,
  ExportPagesPayload,
} from "../../shared/types";

export interface ExportDialogConfirm {
  range: number[];
  format: ExportImageFormat;
  dpi: number;
  /** Per-page images ready to save. The dialog has already rasterized
   *  each PDF buffer to the chosen format. The host can either:
   *    - call `downloadEntries(entries)` to trigger per-page downloads
   *      through the renderer, or
   *    - take the entries verbatim and route them through a host-owned
   *      save flow (e.g. main-process IPC).
   *  This module ships the renderer-side download helper as the
   *  default path; main-process save is a future backend feature. */
  entries: ExportPageEntry[];
}

interface ExportDialogProps {
  open: boolean;
  totalPages: number;
  /** Mirrors AppSettings.exportImageFormat. Re-seeds on open. */
  initialFormat: ExportImageFormat;
  /** Mirrors AppSettings.exportImageDpi. Re-seeds on open. */
  initialDpi: number;
  /** Fires when the user changes format / DPI. The host persists the
   *  choice through the preferences reducer. */
  onFormatChange?: (format: ExportImageFormat) => void;
  onDpiChange?: (dpi: number) => void;
  /** Host callback: runs `engine.exportPages(docId, payload)` against
   *  the active tab and returns the per-page entries. The dialog is
   *  ignorant of which tab is active; the host supplies the docId. */
  runExport: (payload: ExportPagesPayload) => Promise<ExportPageEntry[] | { error: string }>;
  /** Fires when the export pipeline finishes successfully. The host
   *  is responsible for the per-page save flow (renderer-side blob
   *  download or main-process IPC). The dialog already rasterizes each
   *  entry; the host receives the ready-to-save entries verbatim. */
  onConfirm: (result: ExportDialogConfirm) => void;
  /** Display name of the active doc. Used for the default filename. */
  sourceName: string;
  onClose: () => void;
}

interface Progress {
  current: number;
  total: number;
  /** Current page label (1-based) when running; null when idle. */
  pageIndex: number | null;
}

export { DEFAULT_EXPORT_IMAGE_DPI, DEFAULT_EXPORT_IMAGE_FORMAT, EXPORT_IMAGE_FORMATS, clampExportImageDpi };

export function ExportDialog(props: ExportDialogProps): ReactElement | null {
  const {
    open,
    totalPages,
    initialFormat,
    initialDpi,
    onFormatChange,
    onDpiChange,
    runExport,
    onConfirm,
    sourceName,
    onClose,
  } = props;
  const initialRange = useMemo(() => defaultPageRange(totalPages), [totalPages]);
  const [rangeText, setRangeText] = useState<string>(initialRange);
  const [format, setFormat] = useState<ExportImageFormat>(initialFormat);
  const [dpi, setDpi] = useState<number>(clampExportImageDpi(initialDpi));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ current: 0, total: 0, pageIndex: null });
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<{ aborted: boolean }>({ aborted: false });

  // Reset every time we re-open. The range resets to "all pages";
  // format / DPI reset to the persisted defaults so the dialog opens
  // with the same selection next time.
  useEffect(() => {
    if (!open) return;
    setRangeText(defaultPageRange(totalPages));
    setFormat(initialFormat);
    setDpi(clampExportImageDpi(initialDpi));
    setRunning(false);
    setProgress({ current: 0, total: 0, pageIndex: null });
    setError(null);
    cancelRef.current.aborted = false;
  }, [open, totalPages, initialFormat, initialDpi]);

  // Esc closes; focus first interactive control on open.
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

  if (!open) return null;

  const onConfirmClick = async (): Promise<void> => {
    if (!valid || parsed === null) return;
    cancelRef.current.aborted = false;
    setRunning(true);
    setError(null);
    setProgress({ current: 0, total: parsed.length, pageIndex: null });
    try {
      // Step 1: ask the engine for per-page PDF buffers.
      const [start, end] = [
        parsed[0] ?? 1,
        parsed[parsed.length - 1] ?? totalPages,
      ] as [number, number];
      const exportRes = await runExport({
        range: [start, end],
        format,
        dpi,
      });
      if ("error" in exportRes) {
        setError(exportRes.error);
        setRunning(false);
        return;
      }
      const entries: ExportPageEntry[] = [];
      for (let i = 0; i < exportRes.length; i += 1) {
        if (cancelRef.current.aborted) {
          setError("Export cancelled.");
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
        // Step 2: rasterize the per-page PDF buffer at the requested DPI.
        // Quality only matters for JPEG; we pass `quality` undefined
        // for PNG so the encoder picks its default.
        const rasterizeQuality =
          format === "jpeg" ? clampCreateImageQualityForExport(initialDpi) : undefined;
        const { blob, width, height } = await rasterizePageToBlob({
          pdfBytes: e.buffer,
          format,
          dpi,
          ...(rasterizeQuality !== undefined ? { quality: rasterizeQuality } : {}),
          signal: undefined,
        });
        entries.push({
          pageIndex: pageNumber,
          buffer: new Uint8Array(await blob.arrayBuffer()),
          format,
          width,
          height,
        });
        setProgress({
          current: i + 1,
          total: exportRes.length,
          pageIndex: pageNumber,
        });
      }
      setRunning(false);
      // Step 3: hand the rendered entries back to the host for the
      // actual save flow. The host can either fire per-page downloads
      // here or forward the entries to main-process IPC. We default
      // to the renderer-side download path so the user's first run
      // works without any backend changes.
      //
      // For TIFF the canvas path produces PNG bytes; the file
      // gets a `.tif` extension (via `defaultExportFilename`) and
      // a PNG mime so the browser can save it. A real TIFF
      // encoder would replace this in the engine path.
      for (const entry of entries) {
        if (cancelRef.current.aborted) break;
        const blob = new Blob([entry.buffer.slice().buffer as ArrayBuffer], {
          type: mimeForExportFormat(entry.format),
        });
        downloadBlob(
          blob,
          defaultExportFilename(sourceName, entry.pageIndex, entry.format),
        );
      }
      onConfirm({ range: parsed, format, dpi, entries });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Export failed: ${msg}`);
      setRunning(false);
    }
  };

  const onCancelRun = (): void => {
    cancelRef.current.aborted = true;
    setError("Export cancelled.");
    setRunning(false);
  };

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        data-export-dialog
      >
        <div className="modal-header">
          <h2 id="export-dialog-title" className="modal-title">
            Export pages as images
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
            Export pages of <strong>{sourceName}</strong> ({totalPages} total)
            as raster images. Each page downloads separately. The
            originals stay untouched.
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
              data-export-range
              disabled={running}
            />
            <span className="modal-hint">
              Examples: <code>10-20</code>, <code>1,3,5-7</code>.
            </span>
          </label>

          <fieldset className="modal-position export-format">
            <legend>Image format</legend>
            <label>
              <input
                type="radio"
                name="export-format"
                checked={format === "png"}
                onChange={(): void => {
                  setFormat("png");
                  onFormatChange?.("png");
                }}
                disabled={running}
                data-export-format="png"
              />
              <span>PNG — lossless, larger files</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                checked={format === "jpeg"}
                onChange={(): void => {
                  setFormat("jpeg");
                  onFormatChange?.("jpeg");
                }}
                disabled={running}
                data-export-format="jpeg"
              />
              <span>JPEG — smaller files, lossy</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-format"
                checked={format === "tiff"}
                onChange={(): void => {
                  setFormat("tiff");
                  onFormatChange?.("tiff");
                }}
                disabled={running}
                data-export-format="tiff"
              />
              <span>TIFF — print-grade raster {isEngineNativeFormat("tiff") ? "(engine path)" : ""}</span>
            </label>
          </fieldset>

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
                  const clamped = clampExportImageDpi(next);
                  setDpi(clamped);
                  onDpiChange?.(clamped);
                }
              }}
              onBlur={(): void => {
                const clamped = clampExportImageDpi(dpi);
                if (clamped !== dpi) setDpi(clamped);
                onDpiChange?.(clamped);
              }}
              data-export-dpi
              disabled={running}
              aria-label="Resolution in DPI"
            />
            <span className="modal-hint">
              72 (screen) to 600 (print). 150 is a balanced default.
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
              data-export-cancel
            >
              Cancel export
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-export-close
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
            data-export-confirm
          >
            {running ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** JPEG quality helper for the export rasterization path. The Export
 *  dialog doesn't surface its own quality slider (the spec pins the
 *  export flow to format + DPI only); we reuse the create-images
 *  JPEG quality setting, clamped to [0.1, 1.0] so canvas.toBlob
 *  doesn't reject out-of-range values. */
function clampCreateImageQualityForExport(_dpi: number): number {
  // We don't read AppSettings here — the host wires
  // `createImageQuality` into the dialog via a future enhancement.
  // For now we pass a sensible 0.92 default so JPEG exports look
  // crisp at the cost of slightly larger files.
  return 0.92;
}
