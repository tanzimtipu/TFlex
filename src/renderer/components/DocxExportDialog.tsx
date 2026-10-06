// Phase 9 — Export to Word (.docx) dialog.
//
// The renderer rasterizes every page of the active document to PNG
// at the user's chosen DPI, hands the buffers to `runAssemble`
// (the App host), and the engine assembles a single .docx ZIP.
// The renderer triggers the per-file download via the standard
// anchor-download trick.
//
// Why renderer-side rasterization? The main process has no canvas /
// DOM surface. Page rasterization is already a renderer-side
// concern (the export-pages pipeline uses pdf.js in the renderer
// for the same reason). We re-use `rasterizePageToBlob` so the
// JPEG-quality + DPI math is shared.
//
// TEXT-FIRST export: the host prefers the engine's
// `createDocxFromDoc(docId, entries)` channel, which emits real
// editable text (w:p/w:r/w:t paragraphs) for every page that has
// extractable text. Pages without text (scans, image-only pages)
// are embedded as full-page images from the rasterised entries.
// The per-page raster is therefore BOTH the image fallback for
// text-free pages and the safety net if the text channel is
// unavailable.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DialogShell, type DialogAction } from "./DialogShell";
import { ExportFidelityNotes } from "./ExportFidelityNotes";
import { ExportPagesWithoutTextNotice } from "./ExportPagesWithoutTextNotice";
import {
  fetchTextFreePageNumbers,
  type TextFreePagesEngine,
} from "../utils/exportWithoutText";
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
import { contiguousPageRuns, exportOutputNameStem } from "./exportConfig";
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
  /** Calls the host's `runAssembleDocx(entries)` to assemble the
   *  DOCX (text-first via the DEF-060 channel, with a per-page
   *  image fallback for text-free pages). The dialog never inspects
   *  the bytes; it just hands them to the renderer-side download. */
  runAssemble: (
    entries: DocxImageEntry[],
  ) => Promise<Uint8Array | { error: string }>;
  onConfirm: (result: DocxExportConfirm) => void;
  sourceName: string;
  /** Phase 112 (C5 follow-up) - the Inspector's prepared page range as the
   *  dialog's own TEXT expression. Re-parsed by the dialog; absent = all. */
  initialRange?: string | null;
  /** Phase 112 (C5 follow-up) - the Inspector's prepared resolution. Clamped by
   *  the dialog; absent falls back to the persisted default. */
  initialDpi?: number | null;
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
    initialRange,
    initialDpi,
    initialOutputName,
    docId = null,
    engine,
    onClose,
  } = props;
  const initialRangeText = useMemo(
    () => (initialRange != null && initialRange.length > 0 ? initialRange : defaultPageRange(totalPages)),
    [initialRange, totalPages],
  );
  const initialDpiValue = useMemo(
    () => clampExportImageDpi(initialDpi ?? DEFAULT_EXPORT_IMAGE_DPI),
    [initialDpi],
  );
  const [rangeText, setRangeText] = useState<string>(initialRangeText);
  const [dpi, setDpi] = useState<number>(initialDpiValue);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    pageIndex: number | null;
  }>({ current: 0, total: 0, pageIndex: null });
  const [error, setError] = useState<string | null>(null);
  const [pagesWithoutText, setPagesWithoutText] = useState<number[] | null>(null);
  const cancelRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!open) return;
    setRangeText(initialRangeText);
    setDpi(initialDpiValue);
    setRunning(false);
    setProgress({ current: 0, total: 0, pageIndex: null });
    setError(null);
    setPagesWithoutText(null);
    cancelRef.current.aborted = false;
  }, [open, totalPages, initialRangeText, initialDpiValue]);

  // DEF-390 — name the pages with no extractable text, as the xlsx/pptx
  // surfaces do. The read is async and NEVER blocks the dialog: the form
  // renders immediately and the notice appears only if/when exportText
  // resolves with pages whose text is empty. A missing channel, a typed
  // failure or a rejection yields null and simply renders no notice — the
  // export itself never depends on this read, so it always proceeds.
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

  const parsed = useMemo(
    () => parsePageRange(rangeText, totalPages),
    [rangeText, totalPages],
  );
  const valid = parsed !== null && parsed.length > 0 && !running;

  // Esc-to-close, the backdrop drag guard and initial focus are owned by
  // DialogShell. The primary Export action is marked `default` so it
  // receives focus on open.

  const onConfirmClick = async (): Promise<void> => {
    if (!valid || parsed === null) return;
    cancelRef.current.aborted = false;
    setRunning(true);
    setError(null);
    setProgress({ current: 0, total: parsed.length, pageIndex: null });
    try {
      const exportRes: {
        pageIndex: number;
        buffer: Uint8Array;
        format: "png" | "jpeg" | "tiff";
        width: number;
        height: number;
      }[] = [];
      // DEF-602 — the engine range is ONE continuous [start,end]; export each
      // contiguous run of the parsed selection so a non-contiguous range never
      // silently widens to the span between its first and last pages.
      for (const [start, end] of contiguousPageRuns(parsed)) {
        const runRes = await runEngineExport({
          range: [start, end],
          format: "png", // rasterize PNG for DOCX assembly
          dpi,
        });
        if ("error" in runRes) {
          setError(runRes.error);
          setRunning(false);
          return;
        }
        exportRes.push(...runRes);
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
        const pageNumber = parsed[i] ?? i + 1;
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
      // Phase 112 (C5 follow-up) - the Inspector's prepared output name seeds
      // the filename stem; otherwise the source name does.
      const nameStem =
        initialOutputName != null && initialOutputName.length > 0
          ? exportOutputNameStem(initialOutputName)
          : sourceName;
      downloadBlob(blob, defaultDocxExportFilename(nameStem));
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

  // The exit action swaps label/hook with the running gate; the primary
  // Export action carries the shipped `data-docx-export-confirm` hook.
  const actions: DialogAction[] = [
    running
      ? Object.assign(
          {
            key: "cancel",
            label: "Cancel export",
            variant: "secondary" as const,
            onClick: onCancelRun,
          },
          { "data-docx-export-cancel": true },
        )
      : Object.assign(
          {
            key: "close",
            label: "Close",
            variant: "secondary" as const,
            onClick: onClose,
          },
          { "data-docx-export-close": true },
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
      { "data-docx-export-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Export to Word"
      titleId="docx-export-dialog-title"
      size="tool"
      onClose={onClose}
      blockBackdropClose={running}
      closeDisabled={running}
      actions={actions}
      data-docx-export-dialog
    >
      <p className="modal-help">
        Convert <strong>{sourceName}</strong> ({totalPages} pages) into
        a single .docx. Text is exported as real, editable text you can
        select and re-edit in Word; pages without readable text (such as
        scans) are embedded as images. The result opens in Word / Google
        Docs / LibreOffice. The layout may simplify — the text is the
        point.
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
          Resolution only affects pages embedded as images
          (scans); text pages stay crisp at any DPI. 150 is a
          balanced default.
        </span>
      </label>

      <ExportFidelityNotes format="docx" />

      <ExportPagesWithoutTextNotice pages={pagesWithoutText} />

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
    </DialogShell>
  );
}
