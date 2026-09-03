// Phase 10 — renderer-side image transform (crop / resize) for the
// Edit-content image overlay.
//
// The engine's `editImage` contract is "give me a rect of bytes and
// I'll mask the old placement and draw the bytes at the new rect".
// The renderer is responsible for the per-op transform:
//
//   move:     no transform — the engine gets the source bytes
//             unchanged and uses newRect to place them.
//   resize:   downscale / upscale the source bytes to newRect's
//             pixel dimensions. The canvas draws the image at the
//             target size, and the result is the new bytes.
//   replace:  the user picked a file from the OS dialog; the bytes
//             are already in the right shape, but the engine still
//             needs them sized to the new rect's pixel space (so
//             the visual area is the same regardless of the
//             source's resolution). The transform re-encodes the
//             replacement bytes to newRect's pixel dims.
//   crop:     take the source bytes, draw the cropped sub-rect into
//             a new canvas, encode to PNG. newRect in this case is
//             the cropped region of the page, not the full image.
//
// We deliberately use the OffscreenCanvas / HTMLCanvasElement
// path that already lives in `pdf/rasterize.ts`. The export dialog
// already proved the canvas->PNG pipeline works under jsdom in
// unit tests, so we reuse the same surface.
//
// All functions in this module are DOM-touching (they construct
// canvases). Unit tests stub the canvas via jsdom's
// `HTMLCanvasElement.prototype` so the math + shape can be exercised
// without a real GPU.

import type { ImageRect } from "./geometry";
import { colorToHex, fontFamilyFor } from "./EditInlineEditor";
import type { EditFont } from "../../shared/types";

/** Detect the image format from magic bytes. Mirrors the engine's
 *  "PNG or JPEG" requirement on `EditImagePayload.imageBytes`:
 *  pdf-lib's `embedPng` / `embedJpg` need the right mime. */
export function detectImageFormat(bytes: Uint8Array): "png" | "jpeg" | "unknown" {
  if (bytes.byteLength >= 8) {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "png";
    }
  }
  if (bytes.byteLength >= 3) {
    // JPEG signature: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "jpeg";
    }
  }
  return "unknown";
}

/** Compute the output pixel dimensions for a target rect. The
 *  engine draws at PDF's 72 DPI; we keep the same density so a
 *  100pt-wide placement rasterises to ~100px wide. The export
 *  dialog (which targets 150-600 DPI) isn't relevant here: the
 *  edit overlay is a visual on-screen tool, not an export. */
export function rectToPixelSize(rect: ImageRect, dpi: number = 72): { width: number; height: number } {
  const scale = dpi / 72;
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

/** DEF-146 — live-fit a committed text box's mirror font so the box
 *  shows its FULL text, matching the engine / `rasterizeTextBoxToPng`
 *  auto-fit (wrap at the box width, then shrink the font so every
 *  wrapped line fits the box height). The previous mirror rendered the
 *  user's pt size directly (`size * cssScale` px) with `overflow:
 *  hidden`, so a large default font in a small box clipped the text to
 *  the first few characters ("AR" for "ARTIFACT CHECK 88").
 *
 *  Pure apart from the injected `measure` callback (the production
 *  caller measures with a scratch canvas; tests stub it), so the math
 *  is unit-testable without a DOM.
 */
export function fitTextBoxFontSizePx(args: {
  text: string;
  /** User-picked font size in CSS px (`style.size * cssScale`). */
  userSizePx: number;
  /** Box content box in CSS px (the full box minus the mirror's
   *  padding). */
  boxWidthPx: number;
  boxHeightPx: number;
  lineHeight: number;
  measure: (text: string, fontSizePx: number) => number;
}): number {
  const { text, userSizePx, boxWidthPx, boxHeightPx, lineHeight, measure } = args;
  let size = Math.max(1, userSizePx);
  const maxWidth = Math.max(1, boxWidthPx);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && measure(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  if (lines.length === 0) return Math.max(4, size);
  const needed = lines.length * size * lineHeight;
  if (needed > boxHeightPx) {
    size = Math.max(4, boxHeightPx / (lines.length * lineHeight));
  }
  return Math.min(userSizePx, Math.max(4, size));
}

/** Measure text width in CSS px with a scratch canvas 2D context.
 *  Falls back to an average-glyph estimate (~0.55em per character) when
 *  no 2D context exists (jsdom / headless), keeping the mirror's fitted
 *  size deterministic in tests. The scratch canvas is created lazily
 *  and reused so a document with many text boxes doesn't allocate a
 *  canvas per measure. */
export function measureTextWidthCss(
  text: string,
  fontFamily: string,
  fontSizePx: number,
): number {
  const ctx = scratchCtx();
  if (ctx !== null) {
    try {
      ctx.font = `${fontSizePx}px ${fontFamily}`;
      const w = ctx.measureText(text).width;
      if (typeof w === "number" && Number.isFinite(w) && w >= 0) {
        return w;
      }
    } catch {
      // fall through to the estimate below
    }
  }
  return text.length * fontSizePx * 0.55;
}

/** Lazily create + cache a scratch canvas 2D context for text
 *  measurement. Null when the environment has no 2D backend (jsdom). */
let cachedScratchCtx: CanvasRenderingContext2D | null | undefined;
function scratchCtx(): CanvasRenderingContext2D | null {
  if (cachedScratchCtx !== undefined) return cachedScratchCtx;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cachedScratchCtx = canvas.getContext("2d");
  } catch {
    cachedScratchCtx = null;
  }
  return cachedScratchCtx;
}

/** Test-only: drop the cached scratch context. */
export function _resetScratchCtxForTests(): void {
  cachedScratchCtx = undefined;
}

/** Decode the source image bytes into something we can draw onto
 *  a canvas. The production renderer uses an `HTMLImageElement`
 *  (loaded via `Image.src = blobURL`); jsdom unit tests pass a
 *  stub. We keep the surface intentionally narrow so the test
 *  surface is just `{ width, height, draw }`. */
export interface DecodedImage {
  width: number;
  height: number;
  /** Draw the image into a 2D canvas context at the given source
   *  rect -> dest rect. Mirrors the CanvasRenderingContext2D
   *  9-arg `drawImage` signature (image, sx, sy, sw, sh, dx, dy,
   *  dw, dh). */
  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Build a decoded image facade from a loaded HTMLImageElement. The
 *  renderer's image overlay creates one of these from a Blob URL
 *  it sets on an `Image` after the user picks a file. The crop
 *  helper draws through this facade. */
export function facadeFromImage(
  img: HTMLImageElement,
): DecodedImage {
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    draw: (ctx, sx, sy, sw, sh, dx, dy, dw, dh): void => {
      // The real canvas API: image, sx, sy, sw, sh, dx, dy, dw, dh.
      (ctx as CanvasRenderingContext2D).drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    },
  };
}

/** Crop a source image (the bytes the engine holds for this
 *  placement) to a sub-rect and return the encoded bytes.
 *
 *  - `sourceBytes` are the original image bytes (PNG or JPEG)
 *  - `crop` is the absolute page-points rect of the new image
 *  - `imageRect` is the original image's bounding rect
 *  - `decoder` turns bytes into a `DecodedImage` (the caller picks
 *    the right path for production vs. test).
 *
 *  Returns PNG bytes suitable for `EditImagePayload.imageBytes`. */
export async function cropImageToBytes(args: {
  sourceBytes: Uint8Array;
  imageRect: ImageRect;
  crop: ImageRect;
  dpi?: number;
  /** Decode the source into a drawable image. The real renderer
   *  uses `Image.src = blobURL`; the tests pass a stub. */
  decoder: (bytes: Uint8Array) => Promise<DecodedImage>;
  /** Encode a canvas to PNG bytes. The real renderer uses
   *  `OffscreenCanvas.convertToBlob`; the tests pass a stub that
   *  returns the raw bytes the canvas was drawn with. */
  encoder: (canvas: OffscreenCanvas | HTMLCanvasElement) => Promise<Uint8Array>;
}): Promise<Uint8Array> {
  const { sourceBytes, imageRect, crop, decoder, encoder } = args;
  const dpi = args.dpi ?? 72;
  const decoded = await decoder(sourceBytes);
  const outSize = rectToPixelSize(
    { x: 0, y: 0, width: crop.width, height: crop.height },
    dpi,
  );
  const canvas = createCanvas(outSize.width, outSize.height);
  const ctx = getContext(canvas);
  if (ctx === null) {
    throw new Error("cropImageToBytes: failed to acquire 2D context");
  }
  // White-fill before drawing so transparent PNGs don't leak through
  // the crop's background. Matches the on-screen rendering and the
  // Export dialog's behavior (see pdf/rasterize.ts).
  (ctx as CanvasRenderingContext2D).fillStyle = "#ffffff";
  (ctx as CanvasRenderingContext2D).fillRect(0, 0, outSize.width, outSize.height);
  // Map the crop's page rect back to source pixels.
  const wSafe = imageRect.width === 0 ? 1 : imageRect.width;
  const hSafe = imageRect.height === 0 ? 1 : imageRect.height;
  const sx = ((crop.x - imageRect.x) / wSafe) * decoded.width;
  const sy = ((crop.y - imageRect.y) / hSafe) * decoded.height;
  const sw = (crop.width / wSafe) * decoded.width;
  const sh = (crop.height / hSafe) * decoded.height;
  decoded.draw(
    ctx,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    outSize.width,
    outSize.height,
  );
  return encoder(canvas);
}

/** DEF-127/127b — rasterize a COMMITTED text box (text + optional
 *  white background) to PNG bytes so the box can be re-baked at a
 *  new rect through the EXISTING `editImage` contract ("mask
 *  oldRect, draw bytes at newRect"). No new shared op is required:
 *  the engine never knows the box was text. The raster mirrors the
 *  engine's `addTextBox` drawing as closely as the local canvas
 *  allows — white fill for `background: 'white'`, wrapped lines
 *  with a top-left baseline, and the same shrink-to-fit auto sizing
 *  (wrap at the box width, then scale the font down so every line
 *  fits the box height). The transparent `background: 'none'` case
 *  keeps alpha so the moved text draws over whatever content it
 *  lands on (the old position is white-masked by the engine, the
 *  documented Phase 10 visual-redact behavior). */
export function rasterizeTextBoxToPng(args: {
  text: string;
  rect: ImageRect;
  style: {
    font: EditFont;
    size: number;
    color: { r: number; g: number; b: number };
  };
  background: "white" | "none";
  dpi?: number;
  /** Encode a canvas to PNG bytes. The real renderer uses
   *  `OffscreenCanvas.convertToBlob`; the tests pass a stub. */
  encoder: (canvas: OffscreenCanvas | HTMLCanvasElement) => Promise<Uint8Array>;
}): Promise<Uint8Array> {
  const { text, rect, style, background } = args;
  const dpi = args.dpi ?? 72;
  const outSize = rectToPixelSize(
    { x: 0, y: 0, width: rect.width, height: rect.height },
    dpi,
  );
  const canvas = createCanvas(outSize.width, outSize.height);
  // "none" boxes need alpha so pdf-lib's embedPng keeps the
  // transparency; "white" boxes are fully opaque.
  const ctx = getContext(canvas, background === "none");
  if (ctx === null) {
    throw new Error("rasterizeTextBoxToPng: failed to acquire 2D context");
  }
  const c = ctx as CanvasRenderingContext2D;
  if (background === "white") {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, outSize.width, outSize.height);
  }

  // Engine-matching auto-fit: wrap to the box width, then shrink
  // the font so all wrapped lines fit the box height (mirrors
  // `addTextBox`'s DEF-113 auto-fit).
  let size = style.size;
  c.font = `${size}px ${fontFamilyFor(style.font)}`;
  const padPx = 2 * (dpi / 72);
  const maxWidth = Math.max(1, outSize.width - padPx * 2);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && c.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  if (lines.length === 0) lines = [""];
  const lineHeight = size * 1.2 * (dpi / 72);
  const needed = lines.length * lineHeight;
  if (needed > outSize.height) {
    size = Math.max(4 * (dpi / 72), outSize.height / (lines.length * 1.2));
    c.font = `${size}px ${fontFamilyFor(style.font)}`;
  }

  c.fillStyle = colorToHex(style.color);
  const topPad = 2 * (dpi / 72);
  let cursorY = topPad + size;
  for (const ln of lines) {
    c.fillText(ln, padPx, cursorY);
    cursorY += lineHeight;
  }
  return args.encoder(canvas);
}

/** Resize / re-encode a source image to the target rect's pixel
 *  dimensions. Used for the `resize` and `replace` ops. */
export async function resizeImageToBytes(args: {
  sourceBytes: Uint8Array;
  target: ImageRect;
  dpi?: number;
  decoder: (bytes: Uint8Array) => Promise<DecodedImage>;
  encoder: (canvas: OffscreenCanvas | HTMLCanvasElement) => Promise<Uint8Array>;
}): Promise<Uint8Array> {
  const { sourceBytes, target, decoder, encoder } = args;
  const dpi = args.dpi ?? 72;
  const decoded = await decoder(sourceBytes);
  const outSize = rectToPixelSize(
    { x: 0, y: 0, width: target.width, height: target.height },
    dpi,
  );
  const canvas = createCanvas(outSize.width, outSize.height);
  const ctx = getContext(canvas);
  if (ctx === null) {
    throw new Error("resizeImageToBytes: failed to acquire 2D context");
  }
  (ctx as CanvasRenderingContext2D).fillStyle = "#ffffff";
  (ctx as CanvasRenderingContext2D).fillRect(0, 0, outSize.width, outSize.height);
  decoded.draw(
    ctx,
    0,
    0,
    decoded.width,
    decoded.height,
    0,
    0,
    outSize.width,
    outSize.height,
  );
  return encoder(canvas);
}

// ---------------------------------------------------------------------------
// Production encode/decode factories
//
// The tests in `editRasterize.test.ts` pass stub encoders/decoders
// so they don't need a real GPU. The components in
// `EditImageOverlay.tsx` use the real factory below.

/** Build the production encoder (canvas -> PNG bytes). Uses
 *  OffscreenCanvas.convertToBlob when available (Electron / modern
 *  browsers); falls back to HTMLCanvasElement.toBlob for older
 *  runtimes. Centralised so the test surface can stub the whole
 *  pipeline. */
export function defaultImageEncoder(): (canvas: OffscreenCanvas | HTMLCanvasElement) => Promise<Uint8Array> {
  return async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> => {
    const blob = await canvasToBlob(canvas, "image/png");
    if (blob === null) {
      throw new Error("defaultImageEncoder: canvas.toBlob returned null");
    }
    return new Uint8Array(await blob.arrayBuffer());
  };
}

/** Build the production decoder (bytes -> DecodedImage). Loads the
 *  bytes into an `Image` via a Blob URL and resolves once the
 *  decode completes. */
export function defaultImageDecoder(): (bytes: Uint8Array) => Promise<DecodedImage> {
  return async (bytes: Uint8Array): Promise<DecodedImage> => {
    const format = detectImageFormat(bytes);
    if (format === "unknown") {
      throw new Error("defaultImageDecoder: unsupported image format");
    }
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: format === "png" ? "image/png" : "image/jpeg" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      return facadeFromImage(img);
    } finally {
      // Always release the blob URL — keeping it around leaks memory
      // on long editing sessions. The Image itself stays alive as
      // long as the caller's `DecodedImage` reference does.
      URL.revokeObjectURL(url);
    }
  };
}

/** Promise-wrapped `Image` load. Works in both the browser and
 *  jsdom (the latter exposes Image as a no-op by default; tests
 *  inject their own loader). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error(`loadImage: failed to load ${url}`));
    img.src = url;
  });
}

/** Promise-wrapped `canvas.toBlob` / `OffscreenCanvas.convertToBlob`. */
function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mime: string,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const offscreen = canvas as OffscreenCanvas;
    if (typeof offscreen.convertToBlob === "function") {
      offscreen
        .convertToBlob({ type: mime })
        .then((blob: Blob) => resolve(blob))
        .catch(() => resolve(null));
      return;
    }
    (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), mime);
  });
}

/** Create a canvas of the requested size. Prefers OffscreenCanvas
 *  (modern browsers / Electron); falls back to a detached
 *  HTMLCanvasElement. */
function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Get a 2D context or null. Both OffscreenCanvas and
 *  HTMLCanvasElement expose the same call. `alpha` follows the
 *  backing surface's needs: opaque for image transforms / white
 *  text boxes, transparent for `background: 'none'` text boxes. */
function getContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  alpha: boolean = false,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.getContext("2d", { alpha });
  }
  return (canvas as HTMLCanvasElement).getContext("2d", { alpha });
}
