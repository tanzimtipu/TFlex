// Phase 30 — print page rasterization.
//
// The print pipeline is renderer-driven for the same reason OCR is: the
// main process cannot rasterise a PDF page (pdf-lib has no rasteriser,
// and running pdf.js in the main process crashes the native canvas
// backend). The renderer already owns a working pdf.js DOM-canvas path,
// so this module mirrors `pdf/ocrRasterize.ts` to produce ONE PNG data
// URL per selected PDF page.
//
// The main process composes the printed sheets itself: it chunks these
// images into sheets of `pagesPerSheet` and applies `pageOrder`,
// `scaling`/`scalePercent` and `landscape`. The renderer therefore must
// NOT pre-compose sheets — it sends one image per page, in the order the
// selection logic resolved.
//
// Rendering budget: 200 DPI (scale = 200/72) is the print default. It is
// a large step up from the ~96 DPI screen raster while keeping a
// US-Letter page at ~1700 x 2200 px (~15 MB ARGB), far below the ~50 MB
// / ~3300 x 4200 guard the OCR module documents. Pages whose requested
// area would exceed `MAX_PRINT_PIXELS` are downscaled so a pathological
// page cannot exhaust the renderer heap.
//
// Pages are rendered SEQUENTIALLY (the OCR module documents why parallel
// renders on one pdf.js document/worker thrash and can exhaust memory).
// An AbortSignal lets the dialog cancel an in-flight print raster.

import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfjsConfigured } from "./pdfjs";

/** Default print raster resolution (DPI-equivalent at 72 DPI user space). */
export const PRINT_DPI = 200;

/** Upper bound on a single page's device pixels (~48 MB ARGB). Any page
 *  whose viewport would exceed this is uniformly downscaled. */
export const MAX_PRINT_PIXELS = 12_000_000;

/** One rasterised print page. `dataUrl` is a PNG data URL handed straight
 *  to the main process inside `PrintJobPayload.images`. */
export interface PrintPageImage {
  page: number;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Device-pixel scale for a page at `dpi`, reduced if the resulting area
 * would exceed `MAX_PRINT_PIXELS`. Exported so the bound is unit-tested
 * independently of a canvas.
 */
export function boundedPrintScale(
  pageWidthPt: number,
  pageHeightPt: number,
  dpi: number = PRINT_DPI,
): number {
  const requested = dpi / 72;
  const width = pageWidthPt * requested;
  const height = pageHeightPt * requested;
  const area = width * height;
  if (area <= MAX_PRINT_PIXELS || area <= 0) return requested;
  return requested * Math.sqrt(MAX_PRINT_PIXELS / area);
}

/**
 * Rasterise the supplied 1-based page list to PNG data URLs at the print
 * resolution. Pages must be unique, in range and in the desired print
 * order; out-of-range values throw rather than silently skipping, so a
 * partially-rendered run never leaves the caller guessing.
 */
export async function rasterizePagesForPrint(args: {
  doc: PDFDocumentProxy;
  /** 1-based PDF page numbers, already selected and ordered. */
  pages: number[];
  /** Print with the document's annotation appearances (ENABLE_STORAGE) or
   *  without them (DISABLE). */
  includeAnnotations: boolean;
  /** Optional override for tests; defaults to `PRINT_DPI`. */
  dpi?: number;
  /** Called BEFORE each page render with its 1-based page number. */
  onProgress?: (page: number) => void;
  signal?: AbortSignal;
}): Promise<PrintPageImage[]> {
  ensurePdfjsConfigured();
  const { doc, pages, includeAnnotations, onProgress, signal } = args;
  const dpi = args.dpi ?? PRINT_DPI;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("printRaster: pages must be a non-empty list");
  }
  const total = doc.numPages;
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > total) {
      throw new Error(`printRaster: page ${p} out of range (1..${total})`);
    }
  }
  const out: PrintPageImage[] = [];
  for (const page of pages) {
    if (signal?.aborted === true) throw new Error("aborted");
    onProgress?.(page);
    out.push(await rasterizeOnePage(doc, page, dpi, includeAnnotations));
    if (signal !== undefined && signal.aborted) throw new Error("aborted");
  }
  return out;
}

async function rasterizeOnePage(
  doc: PDFDocumentProxy,
  page: number,
  dpi: number,
  includeAnnotations: boolean,
): Promise<PrintPageImage> {
  // DEF-050 applies here too: the session document's lifetime is owned by
  // App.closeTab; we must NOT call doc.destroy() per page. Per-page
  // cleanup is handled by pdfPage.cleanup() below.
  const pdfPage = await doc.getPage(page);
  try {
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = boundedPrintScale(base.width, base.height, dpi);
    const viewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = createPrintCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false }) as {
      fillStyle: string;
      fillRect: (x: number, y: number, w: number, h: number) => void;
    } | null;
    if (ctx === null) {
      throw new Error("printRaster: failed to acquire 2D context");
    }
    // Paper is white: fill first so any transparent page area does not
    // leak to the PNG's alpha channel (the print sheet is opaque paper).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const task = pdfPage.render({
      canvasContext: ctx as never,
      viewport,
      // Phase 30 — the annotations toggle. ENABLE_STORAGE makes pdf.js
      // regenerate annotation/widget appearances from the document's
      // AnnotationStorage (form values, stored PDF annotations); DISABLE
      // renders the page content only.
      annotationMode: includeAnnotations
        ? AnnotationMode.ENABLE_STORAGE
        : AnnotationMode.DISABLE,
    });
    await task.promise;
    const dataUrl = await canvasToDataUrl(canvas);
    try {
      pdfPage.cleanup();
    } catch {
      // Best-effort teardown.
    }
    return { page, dataUrl, widthPx: width, heightPx: height };
  } finally {
    // See the DEF-050 note above: no doc.destroy() here.
  }
}

function createPrintCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Encode a canvas to a PNG data URL, supporting both OffscreenCanvas
 *  (convertToBlob + FileReader) and HTMLCanvasElement (toDataURL). */
async function canvasToDataUrl(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<string> {
  const offscreen = canvas as OffscreenCanvas;
  if (typeof offscreen.convertToBlob === "function") {
    const blob = await offscreen.convertToBlob({ type: "image/png" });
    return blobToDataUrl(blob);
  }
  const html = canvas as HTMLCanvasElement;
  return html.toDataURL("image/png");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("printRaster: data URL encoding failed"));
    };
    reader.onerror = (): void => reject(new Error("printRaster: data URL encoding failed"));
    reader.readAsDataURL(blob);
  });
}