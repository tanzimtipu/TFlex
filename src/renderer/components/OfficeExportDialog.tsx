// Phase 55 (feature D) — the ONE parameterised office-export dialog.
//
// `.xlsx` and `.pptx` are genuinely the SAME form: a page range, the docx
// dialog's DPI control, a confirm action, progress while pages rasterise and a
// cancel. They differ only in the engine member (`export:xlsx` / `export:pptx`),
// the payload key (`images` / `entries`) and the download extension. So this is
// ONE component parameterised by `format`, not two near-identical files.
//
// It mirrors DocxExportDialog closely and REUSES the same pipeline:
//   engine.exportPages(docId, {range, format:'png', dpi})
//     -> rasterizePageToBlob(page) per selected page
//     -> window.tflex.export.xlsx|pptx(docId, {images|entries})
//     -> downloadBlob(bytes, default<Format>Filename(sourceName))
//
// The bridge members are OPTIONAL and are called as MEMBERS of the client
// object, never extracted into a local: an extracted local loses `this` and
// throws (DEF-106 / DEF-374 — that bug has been filed three times; not a
// fourth). The dialog consumes the shared export CONTRACT only — it imports
// `EXPORT_FIDELITY_NOTES` rather than retyping the warning text.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DialogShell, type DialogAction } from "./DialogShell";
import { defaultPageRange, parsePageRange } from "../engine/types";
import {
  clampExportImageDpi,
  DEFAULT_EXPORT_IMAGE_DPI,
} from "../state/preferences";
import { OFFICE_EXPORT_DISABLED_REASON } from "../state/dockModel";
import { rasterizePageToBlob } from "../pdf/rasterize";
import {
  defaultPptxExportFilename,
  defaultXlsxExportFilename,
  downloadBlob,
  mimeForOfficeExportFormat,
} from "../utils/exportDownload";
import { contiguousPageRuns, exportOutputNameStem } from "./exportConfig";
import { ExportFidelityNotes } from "./ExportFidelityNotes";
import { ExportPagesWithoutTextNotice } from "./ExportPagesWithoutTextNotice";
import type { ExportBuild, ExportErrorCode } from "../../shared/export";
import type { Result } from "../../shared/result";
import type { TFlexApiExport } from "../../shared/ipc";
import type {
  DocxImageEntry,
  ExportPagesPayload,
} from "../../shared/types";

export type OfficeExportFormat = "xlsx" | "pptx";

export interface OfficeExportConfirm {
  range: number[];
  dpi: number;
}

/** Translate a typed export failure into readable, user-facing copy. */
export function exportErrorText(
  code: ExportErrorCode,
  message?: string,
): string {
  switch (code) {
    case "unsupported-format":
      return "That export format is not supported in this build.";
    case "empty-range":
      return "Specify at least one page in the range.";
    case "engine-error":
      return message !== undefined && message.length > 0
        ? `Export failed: ${message}`
        : "Export failed.";
  }
}

const FORMAT_COPY: Record<
  OfficeExportFormat,
  { title: string; blurb: string; fileName: (source: string) => string }
> = {
  xlsx: {
    title: "Export to Excel (.xlsx)",
    blurb:
      "Detect tables and text from the selected pages into one .xlsx workbook.",
    fileName: defaultXlsxExportFilename,
  },
  pptx: {
    title: "Export to PowerPoint (.pptx)",
    blurb: "Render each selected page as one slide in a single .pptx deck.",
    fileName: defaultPptxExportFilename,
  },
};

export interface OfficeExportDialogProps {
  open: boolean;
  format: OfficeExportFormat;
  totalPages: number;
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
  docId: string | null;
  /** The optional office-export bridge object (`window.tflex.export`). Its
   *  `xlsx` / `pptx` members are called as MEMBERS (never detached). */
  client: TFlexApiExport | undefined;
  /** Calls `engine.exportPages(docId, rangePayload)` to fetch per-page PDF
   *  buffers — the SAME pipeline the docx dialog rasterises. */
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
  /** Post-success hook (the host shows its toast; the dialog stays open so the
   *  result's `pagesWithoutText` notice remains readable). */
  onConfirm: (result: OfficeExportConfirm) => void;
  onClose: () => void;
}

export function OfficeExportDialog(
  props: OfficeExportDialogProps,
): ReactElement | null {
  const {
    open,
    format,
    totalPages,
    sourceName,
    initialRange,
    initialDpi,
    initialOutputName,
    docId,
    client,
    runEngineExport,
    onConfirm,
    onClose,
  } = props;
  const copy = FORMAT_COPY[format];
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
  }, [open, totalPages, format, initialRangeText, initialDpiValue]);

  const parsed = useMemo(
    () => parsePageRange(rangeText, totalPages),
    [rangeText, totalPages],
  );
  // The optional bridge member for THIS format, guarded for absence. This read
  // only detects presence for the enable gate; the actual call below is a
  // member call on `client`.
  const methodPresent =
    format === "xlsx" ? client?.xlsx !== undefined : client?.pptx !== undefined;
  const ready = docId !== null && methodPresent;
  const valid =
    parsed !== null && parsed.length > 0 && !running && ready;

  // Esc-to-close, the backdrop drag guard and initial focus are owned by
  // DialogShell. The primary Export action is marked `default` so it
  // receives focus on open.

  const onConfirmClick = async (): Promise<void> => {
    if (!valid || parsed === null) return;
    if (docId === null) {
      setError("Open a document before exporting.");
      return;
    }
    if (client === undefined || !methodPresent) {
      setError(OFFICE_EXPORT_DISABLED_REASON);
      return;
    }
    cancelRef.current.aborted = false;
    setRunning(true);
    setError(null);
    setPagesWithoutText(null);
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
          format: "png",
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
          setError(`${format.toUpperCase()} export cancelled.`);
          setRunning(false);
          return;
        }
        const e = exportRes[i];
        if (e === undefined) continue;
        const pageNumber = parsed[i] ?? i + 1;
        setProgress({ current: i, total: exportRes.length, pageIndex: pageNumber });
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
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          pageWidth: (width * 72) / Math.max(1, dpi),
          pageHeight: (height * 72) / Math.max(1, dpi),
        });
        setProgress({ current: i + 1, total: exportRes.length, pageIndex: pageNumber });
      }
      // MEMBER call — never `const fn = client.xlsx; fn(...)`. The bridge
      // object (and its peers on the engine client) read `this`, so a
      // detached reference throws (DEF-106 / DEF-374).
      let res: Result<ExportBuild, ExportErrorCode>;
      if (format === "xlsx") {
        if (client.xlsx === undefined) {
          setError(OFFICE_EXPORT_DISABLED_REASON);
          setRunning(false);
          return;
        }
        res = await client.xlsx(docId, { images: entries });
      } else {
        if (client.pptx === undefined) {
          setError(OFFICE_EXPORT_DISABLED_REASON);
          setRunning(false);
          return;
        }
        res = await client.pptx(docId, { entries });
      }
      if (!res.ok) {
        setError(exportErrorText(res.error.code, res.error.message));
        setRunning(false);
        return;
      }
      const build = res.value;
      const out = new Blob([build.bytes.slice().buffer as ArrayBuffer], {
        type: mimeForOfficeExportFormat(format),
      });
      // Phase 112 (C5 follow-up) - the Inspector's prepared output name seeds
      // the filename stem; otherwise the source name does.
      const nameStem =
        initialOutputName != null && initialOutputName.length > 0
          ? exportOutputNameStem(initialOutputName)
          : sourceName;
      downloadBlob(out, copy.fileName(nameStem));
      setRunning(false);
      setPagesWithoutText(build.pagesWithoutText);
      onConfirm({ range: parsed, dpi });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`${format.toUpperCase()} export failed: ${msg}`);
      setRunning(false);
    }
  };

  const onCancelRun = (): void => {
    cancelRef.current.aborted = true;
    setError(`${format.toUpperCase()} export cancelled.`);
    setRunning(false);
  };

  // The exit action swaps label/hook with the running gate; the primary
  // Export action carries the shipped `data-office-export-confirm` hook.
  const actions: DialogAction[] = [
    running
      ? Object.assign(
          {
            key: "cancel",
            label: "Cancel export",
            variant: "secondary" as const,
            onClick: onCancelRun,
          },
          { "data-office-export-cancel": true },
        )
      : Object.assign(
          {
            key: "close",
            label: "Close",
            variant: "secondary" as const,
            onClick: onClose,
          },
          { "data-office-export-close": true },
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
      { "data-office-export-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title={copy.title}
      titleId="office-export-dialog-title"
      size="tool"
      onClose={onClose}
      blockBackdropClose={running}
      closeDisabled={running}
      actions={actions}
      data-office-export-dialog={format}
    >
      <p className="modal-help">
        {copy.blurb} Source: <strong>{sourceName}</strong> ({totalPages}{" "}
        pages).
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
          data-office-export-range
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
            if (Number.isFinite(next)) setDpi(clampExportImageDpi(next));
          }}
          onBlur={(): void => {
            setDpi(clampExportImageDpi(dpi));
          }}
          data-office-export-dpi
          disabled={running}
          aria-label="Resolution in DPI"
        />
        <span className="modal-hint">
          Applies to the page images the writer embeds (scans). 150 is
          a balanced default.
        </span>
      </label>

      <ExportFidelityNotes format={format} />

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

      <ExportPagesWithoutTextNotice pages={pagesWithoutText} />
    </DialogShell>
  );
}
