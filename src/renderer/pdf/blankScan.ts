// Phase 87 (FEA-039) — renderer rasterisation for blank-page detection.
//
// Blank-page detection is renderer-driven for the same reason OCR is:
// pdf-lib cannot rasterise, and pdf.js in the main process crashes the
// native canvas backend. This module rasterises one page at a time to raw
// RGBA pixels, then hands them to the pure `computeInkCoverage` helper in
// `src/shared/blankPages.ts`; classification stays in shared code so the
// renderer and the engine agree on what "blank" means.
//
// One page's pixels are produced and measured, then dropped before the
// next page renders, so a long scan never accumulates per-page bitmaps.

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfjsConfigured } from "./pdfjs";
import { computeInkCoverage } from "../../shared/blankPages";
import type {
  BlankPageMeasurement,
  BlankPageSkip,
  BlankPageUnclassified,
} from "../../shared/types";

/** One page's rasterised pixels for blank-page measurement. */
export interface BlankPagePixels {
  page: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/** Arguments for a single-page blank-scan rasterisation. */
export interface BlankScanRasterizeArgs {
  doc: PDFDocumentProxy;
  page: number;
  dpi: number;
  signal?: AbortSignal;
}

/** Rasterise `page` (1-based visible) to opaque-white RGBA pixels at `dpi`.
 *
 *  DEF-050: the session document is owned by the host (`App.closeTab`); the
 *  per-page resources are released with `pdfPage.cleanup()`. Never call
 *  `doc.destroy()` here — it terminates the shared pdf.js worker and breaks
 *  every later render/search/annotation on the same document. */
export async function rasterizePagePixelsForBlankScan(
  args: BlankScanRasterizeArgs,
): Promise<BlankPagePixels> {
  ensurePdfjsConfigured();
  const { doc, page, dpi, signal } = args;
  if (signal?.aborted === true) {
    throw new Error("aborted");
  }
  const pdfPage = await doc.getPage(page);
  try {
    const scale = dpi / 72;
    const viewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = createBlankScanCanvas(width, height);
    const ctxRaw: unknown = canvas.getContext("2d", { alpha: false });
    if (ctxRaw === null || ctxRaw === undefined) {
      throw new Error("blankScan: failed to acquire 2D context");
    }
    const ctx = ctxRaw as {
      fillStyle: string | CanvasGradient | CanvasPattern;
      fillRect: (x: number, y: number, w: number, h: number) => void;
      getImageData: (sx: number, sy: number, sw: number, sh: number) => ImageData;
    };
    // Fill white first: scanned-style pages often carry transparent areas
    // that would otherwise read as zero-luminance ink.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const task = pdfPage.render({
      canvasContext: ctx as never,
      viewport,
    });
    await task.promise;
    const data = ctx.getImageData(0, 0, width, height).data;
    return { page, width, height, pixels: data };
  } finally {
    try {
      pdfPage.cleanup();
    } catch {
      // Best-effort per-page teardown.
    }
  }
}

function createBlankScanCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Arguments for a whole-document blank-page scan. */
export interface BlankScanArgs {
  doc: PDFDocumentProxy;
  dpi: number;
  threshold: number;
  onProgress?: (page: number) => void;
  signal?: AbortSignal;
  rasterize?: typeof rasterizePagePixelsForBlankScan;
}

/** Measure every page in `doc` (1..numPages). Every page yields a
 *  measurement: a page whose rasterisation fails is recorded with
 *  `coverage: null` and a readable `reason` rather than dropped, so the
 *  classifier can report it as unclassified instead of silently treating it
 *  as blank. Aborts loudly when `signal` fires before a page starts. */
export async function scanBlankDocument(
  args: BlankScanArgs,
): Promise<BlankPageMeasurement[]> {
  const rasterize = args.rasterize ?? rasterizePagePixelsForBlankScan;
  const measurements: BlankPageMeasurement[] = [];
  const total = args.doc.numPages;
  for (let page = 1; page <= total; page += 1) {
    if (args.signal?.aborted === true) {
      throw new Error("aborted");
    }
    args.onProgress?.(page);
    try {
      const px = await rasterize({
        doc: args.doc,
        page,
        dpi: args.dpi,
        signal: args.signal,
      });
      const { coverage } = computeInkCoverage(px.pixels, px.width, px.height);
      measurements.push({ page, coverage });
    } catch (e) {
      measurements.push({
        page,
        coverage: null,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return measurements;
}

/** Render a one-line human summary of a removal run, appending a
 *  "Page N: reason" line for each unclassified page. Never returns an empty
 *  string once the scan has produced counts. */
export function formatScanReport(
  removed: readonly number[],
  skipped: readonly BlankPageSkip[],
  unclassified: readonly BlankPageUnclassified[],
): string {
  const pageWord = removed.length === 1 ? "page" : "pages";
  let report =
    `Removed ${removed.length} ${pageWord}; ` +
    `${skipped.length} skipped; ` +
    `${unclassified.length} unclassified`;
  for (const entry of unclassified) {
    report += `\nPage ${entry.page}: ${entry.reason}`;
  }
  return report;
}
