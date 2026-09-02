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

import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfjsConfigured } from "./pdfjs";
import type { FormFieldKind, OcrPageImage } from "../../shared/types";

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

/** Minimal projection of the renderer's form state the OCR rasterizer
 *  consumes. The dialog / host passes the active tab's `forms.fields`
 *  (the full `FormField[]`); this module only reads `name`, `kind`,
 *  `value`, `page`, and `rect`, so `FormField` is structurally assignable
 *  here. `page` and `rect` are optional so a caller that only has values
 *  (e.g. a stub echo) still type-checks; the border-erase pass skips any
 *  field without them. */
export interface OcrRasterizeFormField {
  name: string;
  kind: FormFieldKind;
  value: string | string[];
  /** 1-based VISIBLE page the field sits on (mirrors `FormField.page`). */
  page?: number;
  /** Field rect in PDF POINTS as the engine reports it (pdf-lib
   *  `widget.getRectangle()`, BOTTOM-LEFT origin — see
   *  `fieldDeviceRect`). Mirrors `FormField.rect` / `FormFieldRect`. */
  rect?: { x: number; y: number; width: number; height: number };
}

/** Shape of a single field object returned by
 *  `PDFDocumentProxy.getFieldObjects()` (pdf.js 4.10.38). Only the
 *  fields the rasterizer reads are declared. */
interface PdfFieldObject {
  id?: unknown;
  exportValues?: unknown;
}

/** Seed pdf.js's AnnotationStorage with the renderer's current form
 *  values BEFORE the first page render (DEF-112).
 *
 *  pdf.js 4.x (pinned 4.10.38) removed `renderInteractiveForms` from
 *  `RenderParameters`; the v3 flag drew each widget's appearance from
 *  the PDF's stored /V values. Since TFlex edits forms through the
 *  ENGINE (pdf-lib, over IPC) while pdf.js only renders, the pdf.js
 *  document proxy never sees the user's typed values — widgets render
 *  with their blank default appearance and tesseract misses text like
 *  "John Doe". The 4.x way to bake the CURRENT form state into the
 *  canvas is `AnnotationMode.ENABLE_STORAGE`, which makes pdf.js
 *  regenerate each widget's appearance from `doc.annotationStorage`.
 *
 *  The renderer's field ids (`form-<page>-<name>`) are synthetic —
 *  AnnotationStorage keys are the widget annotations' pdf.js ids
 *  (e.g. "12R") — so the seed path maps renderer field NAMES to ids
 *  via `doc.getFieldObjects()`. Value shapes per kind:
 *    - text / dropdown / listbox: `{ value: string | string[] }`
 *    - checkbox / radio: `{ value: boolean }` (per widget; a radio
 *      group's widgets each carry their own export value, so the
 *      group's selection is compared against each widget's value).
 *
 *  Seeding is best-effort: a malformed AcroForm that makes pdf.js
 *  reject `getFieldObjects` must not abort the whole OCR run — the
 *  pages still rasterize (with blank widget appearances, the
 *  pre-DEF-112 behavior) while we log the miss loudly. */
async function seedAnnotationStorage(
  doc: PDFDocumentProxy,
  fields: readonly OcrRasterizeFormField[],
): Promise<void> {
  let fieldObjects: { [name: string]: PdfFieldObject[] } | null;
  try {
    fieldObjects = (await doc.getFieldObjects()) as { [name: string]: PdfFieldObject[] } | null;
  } catch (e) {
    // pdf.js failed to enumerate the AcroForm field tree; the run
    // continues without seeded values.
    console.warn(
      "ocrRasterize: could not enumerate form fields for storage seeding",
      e instanceof Error ? e.message : String(e),
    );
    return;
  }
  if (fieldObjects === null) return;
  const storage = doc.annotationStorage;
  for (const field of fields) {
    const objects = fieldObjects[field.name];
    if (objects === undefined || objects.length === 0) continue;
    for (const obj of objects) {
      const id = obj.id;
      if (typeof id !== "string" || id.length === 0) continue;
      storage.setValue(id, storageValueFor(field, obj));
    }
  }
}

/** Convert a renderer form value into the pdf.js AnnotationStorage
 *  entry shape for the widget annotation `obj` (see the seeding
 *  comment above for the per-kind contract). */
function storageValueFor(
  field: OcrRasterizeFormField,
  obj: PdfFieldObject,
): { value: string | string[] | boolean } {
  if (field.kind === "checkbox") {
    const checked =
      field.value === "true" || (Array.isArray(field.value) && field.value[0] === "true");
    return { value: checked };
  }
  if (field.kind === "radio") {
    const selected =
      typeof field.value === "string"
        ? field.value
        : Array.isArray(field.value)
          ? (field.value[0] ?? "")
          : "";
    return { value: selected.length > 0 && obj.exportValues === selected };
  }
  // text / dropdown / listbox: pdf.js reads the raw value directly.
  return { value: field.value };
}

/** Device-pixel rect of a field on the rasterised page, clamped to the
 *  canvas. The renderer's `FormField.rect` is in PDF POINTS with a
 *  BOTTOM-LEFT origin (the engine passes pdf-lib's `widget.getRectangle()`
 *  through unchanged — verified live: applicant_name on form.pdf reports
 *  `y: 694.5` on a 800pt page), while the OCR canvas uses a TOP-LEFT
 *  device origin (pdf.js's default viewport flips the Y axis so the top
 *  of the PDF page maps to device row 0). We therefore flip the y axis
 *  here: `deviceY0 = (pageHeightPt - rect.y - rect.height) * scale`.
 *  Exported so unit tests can assert the geometry independently of the
 *  canvas. */
export function fieldDeviceRect(
  rect: { x: number; y: number; width: number; height: number },
  pageHeightPt: number,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.floor(rect.x * scale));
  const y0 = Math.max(0, Math.floor((pageHeightPt - rect.y - rect.height) * scale));
  const x1 = Math.min(canvasWidth, Math.ceil((rect.x + rect.width) * scale));
  const y1 = Math.min(canvasHeight, Math.ceil((pageHeightPt - rect.y) * scale));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x0, y0, x1, y1 };
}

/** Erase the thin black box border pdf.js paints around each form widget
 *  from the OCR canvas (DEF-112).
 *
 *  Live debugging showed the seeded form value IS painted into the raster
 *  (both the stored /AP and pdf.js's regenerated appearance draw "John
 *  Doe"), yet tesseract's full-page layout pass drops the field entirely:
 *  a single sparse text line inside a bordered box is classified as a
 *  drawing/table region and skipped, so neither "John Doe" nor the
 *  combobox's selected value ever reaches the OCR text layer. Removing the
 *  box border (filling a thin band along each field rect's edge with
 *  opaque white) lets tesseract see the value as free-standing text — on
 *  the actual 300-DPI raster this turns a zero-word field into
 *  "John Doe" at ~95% confidence (and the combobox value too), matching
 *  how tesseract already reads the header / listbox text.
 *
 *  The band width is derived from the render scale (the widget border is
 *  a 1pt stroke; at dpi/72 device px per point the stroke lands within
 *  ~1.5pt of the rect edge). Only the perimeter is cleared — the field's
 *  interior (its value text / check mark) is untouched. Fields without a
 *  `page`/`rect` (e.g. a caller that only passed values) are skipped. */
export function eraseFormFieldBorders(
  ctx: {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect: (x: number, y: number, w: number, h: number) => void;
  },
  page: number,
  fields: readonly OcrRasterizeFormField[] | undefined,
  pageHeightPt: number,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (fields === undefined) return;
  const band = Math.max(2, Math.ceil(scale * 1.5));
  ctx.fillStyle = "#ffffff";
  for (const field of fields) {
    if (field.page !== page || field.rect === undefined) continue;
    const d = fieldDeviceRect(field.rect, pageHeightPt, scale, canvasWidth, canvasHeight);
    if (d === null) continue;
    const { x0, y0, x1, y1 } = d;
    const w = x1 - x0;
    const h = y1 - y0;
    const b = Math.min(band, w, h);
    if (b <= 0) continue;
    // Top and bottom bands (full width).
    ctx.fillRect(x0, y0, w, b);
    ctx.fillRect(x0, y1 - b, w, b);
    // Left and right bands (middle span, corners already covered).
    const midY = y0 + b;
    const midH = Math.max(0, h - 2 * b);
    if (midH > 0) {
      ctx.fillRect(x0, midY, b, midH);
      ctx.fillRect(x1 - b, midY, b, midH);
    }
  }
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
  /** Current form-field values from the host's per-tab forms state
   *  (the active tab's `forms.fields`). When non-empty, the values
   *  are seeded into pdf.js's AnnotationStorage before the first
   *  render so typed text / checkbox / radio state is baked into the
   *  rasterised bitmap (DEF-112), and each field's box border is
   *  erased from the bitmap afterwards so tesseract's layout pass
   *  reads the field text instead of rejecting it (DEF-112). */
  formFields?: readonly OcrRasterizeFormField[];
  /** Called BEFORE each page render with the 1-based page index so
   *  the dialog can advance its progress bar. Not called after the
   *  page completes (the dialog's confirm flow gates the next call). */
  onProgress?: (page: number) => void;
  signal?: AbortSignal;
}): Promise<OcrPageImage[]> {
  ensurePdfjsConfigured();
  const { doc, pages, dpi, formFields, onProgress, signal } = args;
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
  if (formFields !== undefined && formFields.length > 0) {
    await seedAnnotationStorage(doc, formFields);
  }
  const out: OcrPageImage[] = [];
  for (const page of pages) {
    if (signal?.aborted === true) {
      throw new Error("aborted");
    }
    onProgress?.(page);
    const img = await rasterizeOnePage(doc, page, dpi, formFields);
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
  fields: readonly OcrRasterizeFormField[] | undefined,
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
    // requested DPI by scaling the viewport by dpi/72. The unscaled
    // viewport gives the exact page height in points, which the
    // DEF-112 border-erase pass needs to flip field rects from the
    // engine's bottom-left origin onto the canvas's top-left device
    // space without any scale-derived rounding drift.
    const scale = dpi / 72;
    const targetViewport = pdfPage.getViewport({ scale });
    const width = Math.max(1, Math.floor(targetViewport.width));
    const height = Math.max(1, Math.floor(targetViewport.height));
    const pageHeightPt = pdfPage.getViewport({ scale: 1 }).height;
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
      // DEF-112: OCR must see typed form values ("John Doe" in an
      // AcroForm text field). pdf.js 4.x (pinned 4.10.38) removed
      // `renderInteractiveForms` from `RenderParameters`; the 4.x
      // equivalent is `AnnotationMode.ENABLE_STORAGE`, which makes
      // the worker regenerate every widget's appearance from the
      // document's AnnotationStorage — exactly what the v3 flag did
      // for typed values. The storage is seeded with the renderer's
      // current form values in `seedAnnotationStorage` above before
      // the page loop starts.
      annotationMode: AnnotationMode.ENABLE_STORAGE,
    });
    await task.promise;
    // DEF-112: erase each widget's box border from the bitmap so
    // tesseract's full-page layout pass reads the field value text
    // ("John Doe") instead of rejecting the boxed region. The border
    // must come off AFTER the render and BEFORE the canvas is encoded
    // to PNG (the engine only ever sees the PNG bytes).
    eraseFormFieldBorders(ctxAny, page, fields, pageHeightPt, scale, width, height);
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