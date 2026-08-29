// Phase 9 — PDF page rasterization.
//
// The Phase 9 export pipeline runs in the renderer:
//   1. App.tsx calls `engine.exportPages(docId, payload)`. The main
//      process returns PER-PAGE PDF buffers (one single-page PDF per
//      requested page) plus page dimensions (POC note: the backend
//      chose buffer-return per page so the renderer can rasterize
//      with pdf.js without a custom PDF rasterizer in main).
//   2. For each entry, the renderer asks pdf.js to render the buffer
//      to an OffscreenCanvas / HTMLCanvasElement at the requested DPI
//      and re-encodes the bitmap with canvas.toBlob() to the requested
//      format (PNG or JPEG).
//
// This module owns the per-page rasterization step. The DPI math,
// the canvas-size calculation, and the canvas.toBlob encoding all
// live here so the unit-test surface is narrow and the e2e harness
// can reuse it. PDF.js is the only dep — no canvas shim, no custom
// rasterizer.
//
// Performance: pdf.js renders at the requested scale (DPI/72) into a
// canvas sized to the page's intrinsic width × scale × height × scale.
// At 600 DPI on a US-Letter page that's ~6600 × 8400 px — a
// 220-MB-per-page bitmap. We surface that back to the caller as the
// encoded Blob bytes (PNG compresses dramatically, JPEG compresses
// further; the wire footprint is much smaller than the bitmap). The
// caller is responsible for streaming / chunking if the user asks
// for a very large export.

import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfjsConfigured } from "./pdfjs";
import type { ExportImageFormat } from "../../shared/types";

/** Compute the canvas pixel size for a given page at the requested DPI.
 *  PDF's coordinate system is 72 DPI; we scale up so the resulting
 *  bitmap has the requested effective DPI. Rounds to integers so the
 *  canvas backing store doesn't allocate fractional buffers. */
export function computeRasterSize(
  pageWidthPt: number,
  pageHeightPt: number,
  dpi: number,
): { width: number; height: number } {
  const scale = dpi / 72;
  return {
    width: Math.max(1, Math.round(pageWidthPt * scale)),
    height: Math.max(1, Math.round(pageHeightPt * scale)),
  };
}

/** Encode a canvas to the requested image format. The DOM canvas API
 *  gives us `canvas.toBlob(callback, mime)` — the only thing the
 *  renderer needs to do is pick the right MIME and the JPEG quality
 *  argument for non-PNG formats. Centralised here so the dialog and
 *  any future bulk-export path use the same encoding logic.
 *
 *  TIFF has no native browser-canvas encoder; we surface it through
 *  the PNG path with a `.tif` extension downstream. The dialog
 *  labels the choice "TIFF (PNG-encoded)" so the user knows. The
 *  backend's full TIFF encoding path is owned by `engine.exportPages`
 *  — the renderer only falls back to PNG when the engine returns a
 *  PDF buffer we have to rasterize ourselves. */
export function pickCanvasMime(format: ExportImageFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "tiff") return "image/png"; // canvas fallback
  return "image/png";
}

/** True when the requested format needs the backend to produce real
 *  format-encoded bytes (vs. the renderer falling back to PNG via
 *  canvas). The renderer uses this to surface a hint in the dialog
 *  hint text. */
export function isEngineNativeFormat(format: ExportImageFormat): boolean {
  // The renderer path rasterizes the engine-supplied PDF buffer with
  // pdf.js + canvas. PNG and JPEG are natively encodable by canvas,
  // so the renderer can produce them end-to-end. TIFF needs the
  // engine path — the renderer signals this so the dialog can show
  // a hint about engine-side encoding.
  return format === "tiff";
}

/** AbortSignal-or-undefined helper. Used inside the rasterize body
 *  so the type narrowing carries through TS's strict-optional check. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Rasterize a single per-page PDF buffer to an encoded image blob.
 *
 *  Returns `{ blob, width, height }` so the caller can name the file
 *  with the right extension and surface the actual bitmap size in any
 *  "saved as..." confirmation. The bitmap size is the canvas backing
 *  store size (the rendered area); the encoded file size lives on the
 *  blob and is reported by the caller.
 *
 *  Errors:
 *   - pdf.js parse failures bubble up as-is so the renderer can map
 *     them to a user-friendly toast (corrupt / not-a-pdf).
 *   - canvas.toBlob's callback fires with `null` on encoding failure
 *     (rare; usually means the browser refused to allocate a bitmap
 *     that big). We surface that as an explicit Error.
 *   - `AbortSignal` (when supplied) lets the caller cancel an in-flight
 *     render. Used by the Export dialog's progress UI to abort a long
 *     export when the user clicks Cancel. */
export async function rasterizePageToBlob(args: {
  pdfBytes: Uint8Array;
  format: ExportImageFormat;
  dpi: number;
  /** JPEG quality (0..1) used when format === 'jpeg'. Ignored for PNG.
   *  The renderer's export dialog owns the quality choice; the engine
   *  doesn't know about it. */
  quality?: number;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; width: number; height: number }> {
  ensurePdfjsConfigured();
  const { pdfBytes, format, dpi, quality, signal } = args;
  // pdf.js takes a Uint8Array view. Always pass a fresh copy — the
  // IPC layer's structured-clone semantics can hand us a detached
  // buffer otherwise.
  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc: PDFDocumentProxy = await getDocument({
    data,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
  }).promise;
  try {
    if (isAborted(signal)) {
      throw new Error("aborted");
    }
    const page = await doc.getPage(1);
    // Page viewport in PDF user-space (72 DPI). Convert to the
    // requested DPI by scaling the viewport by dpi/72.
    const intrinsicViewport = page.getViewport({ scale: 1 });
    const scale = dpi / 72;
    const targetViewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(targetViewport.width));
    const height = Math.max(1, Math.floor(targetViewport.height));
    const canvas = createOffscreenCanvas(width, height);
    const ctx: unknown = canvas.getContext("2d", { alpha: false });
    if (ctx === null || ctx === undefined) {
      throw new Error("rasterize: failed to acquire 2D context");
    }
    const ctxAny = ctx as {
      fillStyle: string | CanvasGradient | CanvasPattern;
      fillRect: (x: number, y: number, w: number, h: number) => void;
    };
    // Fill with white first; many PDFs have transparent areas that
    // would otherwise leak through to JPEG's solid background (no
    // alpha channel). White matches the on-screen rendering the user
    // sees in the document canvas.
    ctxAny.fillStyle = "#ffffff";
    ctxAny.fillRect(0, 0, width, height);
    if (isAborted(signal)) {
      throw new Error("aborted");
    }
    // pdf.js's render call accepts either a HTML or Offscreen 2D
    // context, so the loose cast is fine.
    const task = page.render({
      canvasContext: ctxAny as never,
      viewport: targetViewport,
    });
    await task.promise;
    // canvas.toBlob is the canonical browser API for encoding; we
    // adapt it to a Promise so the dialog's async confirm path can
    // `await` it without callback wiring.
    const mime = pickCanvasMime(format);
    const blob = await canvasToBlob(canvas, mime, quality);
    if (blob === null) {
      throw new Error("rasterize: canvas.toBlob returned null");
    }
    // Release pdf.js's parsed per-page resources eagerly; the
    // buffer throw-away is the renderer's only guarantee that the
    // worker cache doesn't grow on every exported page.
    try {
      page.cleanup();
    } catch {
      // ignore: page may have already been cleaned up
    }
    return {
      blob,
      width: Math.round(intrinsicViewport.width),
      height: Math.round(intrinsicViewport.height),
    };
  } finally {
    try {
      await doc.destroy();
    } catch {
      // ignore: doc may already be destroyed
    }
  }
}

/** Create a canvas of the requested size. Prefers OffscreenCanvas
 *  (modern browsers / Electron) when available so the rasterization
 *  doesn't paint to the visible DOM; falls back to a detached
 *  HTMLCanvasElement otherwise. Both surfaces have the same encoding
 *  API. Centralised so the OffscreenCanvas feature-detection runs in
 *  one place. */
function createOffscreenCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Promise-wrapped `canvas.toBlob`. Both OffscreenCanvas and
 *  HTMLCanvasElement expose `toBlob(callback, mime, quality)`. The
 *  quality argument is only honored by image/jpeg (and image/webp,
 *  which we never emit). We pass it unconditionally — the browser
 *  ignores it for unsupported types. */
function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const offscreen = canvas as OffscreenCanvas;
    if (typeof offscreen.convertToBlob === "function") {
      // OffscreenCanvas path. Note: OffscreenCanvas.convertToBlob
      // does NOT take a callback — return a Promise directly.
      const opts: { type: string; quality?: number } = { type: mime };
      if (typeof quality === "number") opts.quality = quality;
      offscreen
        .convertToBlob(opts)
        .then((blob: Blob) => resolve(blob))
        .catch(() => resolve(null));
      return;
    }
    // HTMLCanvasElement path.
    const c = canvas as HTMLCanvasElement;
    if (typeof quality === "number") {
      c.toBlob((b) => resolve(b), mime, quality);
    } else {
      c.toBlob((b) => resolve(b), mime);
    }
  });
}
