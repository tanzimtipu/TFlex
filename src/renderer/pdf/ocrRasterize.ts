// Phase 11 — OCR page rasterization.
//
// The OCR pipeline is renderer-driven: the engine cannot rasterise
// pages (pdf-lib has no rasteriser) and running pdf.js in main
// crashes the native canvas backend (heap corruption during
// feasibility testing). The renderer already has a working pdf.js
// DOM-canvas path; this module reuses it to produce the per-page
// PNG bytes the OCR engine consumes.
//
// Each call rasterises a contiguous 1-based-visible range of pages
// at the requested DPI to PNG bytes. Progress events fire via an
// optional callback so the dialog can render a per-page progress
// bar without freezing. An AbortSignal lets the host cancel an
// in-flight run.
//
// Performance: at the default 300 DPI on a US-Letter page each
// canvas is ~3300 x 4200 px (~50 MB ARGB backing store). The PNG
// encoder compresses dramatically; the wire footprint is much
// smaller than the bitmap. We free the per-page bitmap as soon as
// the PNG bytes are produced so the renderer doesn't accumulate
// 50-MB-per-page buffers across a long run.

import { type PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfjsConfigured } from "./pdfjs";
import type { OcrPageImage } from "../../shared/types";

/** True when the supplied value is a non-empty list of 1-based visible
 *  page numbers. Exported so the dialog can pre-validate the user's
 *  page-range choice before dispatch. */
export function isValidPageRange(pages: number[], totalPages: number): boolean {
  if (pages.length === 0) return false;
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > totalPages) return false;
  }
  return true;
}

/** Rasterise a contiguous 1-based-visible range of pages of the
 *  supplied pdf.js document to PNG bytes at the requested DPI.
 *  The supplied pages list must be unique, sorted ascending, and
 *  bounded by `doc.numPages`; out-of-range values produce an error
 *  rather than a silent skip.
 *
 *  Returns one OcrPageImage per input page, in input order. The
 *  returned `pngBytes` is a fresh Uint8Array the caller may safely
 *  hand to the engine (the renderer drops its bitmap reference as
 *  soon as the PNG is produced).
 *
 *  Errors:
 *    - pdf.js parse / getPage failures bubble up as-is so the
 *      caller can map them to a user-friendly toast.
 *    - canvas.toBlob returns `null` on encoding failure (rare;
 *      usually means the browser refused to allocate a bitmap that
 *      big). We surface that as an explicit Error.
 *    - `AbortSignal` (when supplied) lets the caller cancel an
 *      in-flight run. The next call to `signal.aborted` will throw.
 */
export async function rasterizePagesForOcr(args: {
  doc: PDFDocumentProxy;
  /** 1-based visible page numbers to rasterise. */
  pages: number[];
  dpi: number;
  /** Called BEFORE each page render with the 1-based page index so
   *  the dialog can advance its progress bar. Not called after the
   *  page completes (the dialog's confirm flow gates the next call). */
  onProgress?: (page: number) => void;
  signal?: AbortSignal;
}): Promise<OcrPageImage[]> {
  ensurePdfjsConfigured();
  const { doc, pages, dpi, onProgress, signal } = args;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("ocrRasterize: pages must be a non-empty list");
  }
  // Validate the range up front so a partially-rendered run doesn't
  // leave the caller wondering which page failed.
  const total = doc.numPages;
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > total) {
      throw new Error(`ocrRasterize: page ${p} out of range (1..${total})`);
    }
  }
  const out: OcrPageImage[] = [];
  for (const page of pages) {
    if (signal?.aborted === true) {
      throw new Error("aborted");
    }
    onProgress?.(page);
    const img = await rasterizeOnePage(doc, page, dpi);
    if (signal !== undefined && signal.aborted) {
      throw new Error("aborted");
    }
    out.push(img);
  }
  return out;
}

async function rasterizeOnePage(
  doc: PDFDocumentProxy,
  page: number,
  dpi: number,
): Promise<OcrPageImage> {
  // DEF-050: the previous implementation called `doc.destroy()` in
  // `finally`, which terminates pdf.js's worker and tears down the
  // entire document for the caller. Because OCR calls this helper once
  // per page, the FIRST page's render destroyed the doc; every
  // subsequent call (and any later UI work that uses the same doc —
  // search index build, page render, annotation overlay) would then
  // hang or reject on `doc.getPage(...)`. The session document's
  // lifetime is owned by `App.closeTab` (via
  // `removed.session.doc.destroy()`); per-page cleanup is handled by
  // `pdfPage.cleanup()` below. Do NOT call `doc.destroy()` here.
  const pdfPage = await doc.getPage(page);
  try {
    // Page viewport in PDF user-space (72 DPI). Convert to the
    // requested DPI by scaling the viewport by dpi/72.
    const scale = dpi / 72;
    const targetViewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.floor(targetViewport.width));
    const height = Math.max(1, Math.floor(targetViewport.height));
    const canvas = createOcrCanvas(width, height);
    const ctx: unknown = canvas.getContext("2d", { alpha: false });
    if (ctx === null || ctx === undefined) {
      throw new Error("ocrRasterize: failed to acquire 2D context");
    }
    const ctxAny = ctx as {
      fillStyle: string | CanvasGradient | CanvasPattern;
      fillRect: (x: number, y: number, w: number, h: number) => void;
    };
    // Fill with white first; many scanned-style pages have
    // transparent areas that would otherwise leak through to the
    // PNG's alpha channel (tesseract expects opaque white paper).
    ctxAny.fillStyle = "#ffffff";
    ctxAny.fillRect(0, 0, width, height);
    const task = pdfPage.render({
      canvasContext: ctxAny as never,
      viewport: targetViewport,
    });
    await task.promise;
    const blob = await canvasToBlob(canvas, "image/png");
    if (blob === null) {
      throw new Error("ocrRasterize: canvas.toBlob returned null");
    }
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    try {
      pdfPage.cleanup();
    } catch {
      // Best-effort teardown.
    }
    return {
      page,
      pngBytes,
      dpi,
      widthPx: width,
      heightPx: height,
    };
  } finally {
    // Per-page resources already released via `pdfPage.cleanup()`
    // above; the host (App.closeTab / engine.ocrRecognize error path)
    // owns document lifetime. Intentionally no `doc.destroy()` here —
    // see the DEF-050 comment at the top of this function.
  }
}

function createOcrCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mime: string,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const offscreen = canvas as OffscreenCanvas;
    if (typeof offscreen.convertToBlob === "function") {
      offscreen
        .convertToBlob({ type: mime })
        .then((b: Blob) => resolve(b))
        .catch(() => resolve(null));
      return;
    }
    const c = canvas as HTMLCanvasElement;
    c.toBlob((b) => resolve(b), mime);
  });
}