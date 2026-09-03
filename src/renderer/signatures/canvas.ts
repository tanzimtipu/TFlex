// Signature canvas helpers.
//
// The signature manager modal hosts two canvases:
//   - Draw tab:   a pointer-canvas that captures freehand strokes into
//                 a list of polylines (in the canvas's own pixel space).
//                 The polyline list is the `source` we send to the engine.
//   - Type tab:   a text input; we render the typed string into a hidden
//                 canvas at the chosen script-style font and ship the
//                 resulting PNG dimensions as the typed source.
//
// Both canvases' pixel buffers stay local to the renderer: the engine
// only ever sees the vector data (drawn points) or the typed text + the
// rendered canvas's width / height, never the bitmap itself.
//
// At placement time the renderer also rasterises the source to a PNG
// buffer for the engine to embed on save (see `rasterizeSignatureToPng`).

import type { SavedSignature, SignatureSource } from "../../shared/types";

export interface DrawStroke {
  points: { x: number; y: number }[];
}

/** Default size of the drawing canvas, in CSS pixels. Matches the modal's
 *  body width minus padding. */
export const DRAW_CANVAS_W = 360;
export const DRAW_CANVAS_H = 120;

/** Default size of the typed-signature preview canvas. Larger than the
 *  draw canvas so the script-style font has room. */
export const TYPED_CANVAS_W = 480;
export const TYPED_CANVAS_H = 140;

/** Pen colour for the draw canvas. Pure black reads cleanly against the
 *  white canvas background and matches the visual identity of a real
 *  pen signature. */
export const DRAW_PEN_COLOR = "#0f172a";
export const DRAW_PEN_WIDTH = 2.4;

/** Sample threshold (canvas px): a new pointermove within this radius of
 *  the last sample is dropped, so a slow drag doesn't bury the polyline
 *  in hundreds of identical points. */
export const DRAW_SAMPLE_RADIUS = 0.8;

/** Render a typed signature into the given 2D context at the natural
 *  pixel size, using a script-style font. Returns the natural bounding
 *  box (the pixels actually used by the ink) so the host can fit it
 *  into the placement rect without blank margins.
 *
 *  NOTE: the standard Canvas 2D TextMetrics type does NOT expose
 *  `actualAscent` / `actualDescent` (those are part of the
 *  `TextMetricsInternal` extension used by Chromium-only CanvasKit
 *  contexts). We approximate them from `font.measureText`'s reported
 *  `width` plus the supplied `fontSize`: a script-style font's ink
 *  heights are within ~80% of the fontSize above the baseline and ~20%
 *  below it. The host never depends on the exact bbox — it just uses
 *  the bbox to size the placement rect, and a 1-2 px slack either way
 *  is invisible. */
export function renderTypedSignature(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  fontSize: number,
  canvasW: number,
  canvasH: number,
): { width: number; height: number } {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  // Conservative defaults: most script fonts extend ~80% of the
  // em-square above the baseline and ~20% below. We use the rendered
  // font-size as the source of truth.
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.2;
  const x = 12;
  const y = canvasH - Math.max(descent, 4);
  ctx.fillText(text, x, y);
  // Natural bbox in canvas pixels: leave a 2-px pad to avoid clipping
  // anti-aliased edges, and use the approximated ascent + descent so we
  // get an honest crop.
  const w = Math.min(canvasW, Math.ceil(metrics.width + 4));
  const h = Math.ceil(ascent + descent + 4);
  return { width: w, height: h };
}

/** Scale a drawn signature's points from canvas pixel space into a target
 *  pixel-space width / height (e.g. to fit the actual placement rect on
 *  the page). The renderer never changes the polyline data — it scales
 *  at render time so the saved source stays at the original capture
 *  resolution. Returns scaled point lists. */
export function scaleStrokes(
  strokes: readonly DrawStroke[],
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): { x: number; y: number }[][] {
  const sx = targetW / sourceW;
  const sy = targetH / sourceH;
  return strokes.map((stroke) =>
    stroke.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
  );
}

/** DEF-144 — stroke width (in target-space units) that preserves the
 *  drawn pen's proportional thickness when the source canvas is scaled
 *  from `sourceW x sourceH` into a `targetW x targetH` space.
 *
 *  The pen width must scale WITH the points: when points are shrunk by
 *  `sx = targetW/sourceW` the stroke must shrink by the same factor or
 *  it reads as a disproportionately thick blob. The previous code
 *  DIVIDED by the scale factor (`DRAW_PEN_WIDTH / min(sx, sy)`), which
 *  for the 360x120 draw canvas scaled into a 64x22 placement produced
 *  ~13.5-unit strokes in a 64-unit box — the "thin stroke drawn ->
 *  thick black filled blob" report. The corrected value multiplies the
 *  pen width by the smaller of the two axis scales (guards against
 *  aspect distortion on extreme ratios) and stays strictly
 *  proportional — no floor, so a small signature's strokes thin with
 *  the signature. */
export function scaledStrokeWidth(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): number {
  if (sourceW <= 0 || sourceH <= 0) return DRAW_PEN_WIDTH;
  const sx = targetW / sourceW;
  const sy = targetH / sourceH;
  return DRAW_PEN_WIDTH * Math.min(sx, sy);
}

/** Default rasterisation target in pixels (per side). 256×128 is the
 *  rough size of a signature line on screen; the engine embeds the
 *  PNG into the page at the placement rect's pt dimensions, so the
 *  rasterisation is just a "good-enough" bitmap for export. The host
 *  can override by passing `targetW` / `targetH` to
 *  `rasterizeSignatureToPng`. */
const DEFAULT_RASTER_W = 512;
const DEFAULT_RASTER_H = 192;

/** Script-style font for typed signatures. Mirrors the font in the
 *  SignatureManagerModal's Type tab — see `SignatureManagerModal.tsx`. */
const TYPED_FONT_FAMILY = "'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive";

/** Render a SavedSignature's source into a PNG buffer at the requested
 *  pixel dimensions. The result is what the engine embeds into the PDF
 *  on save (a transparent-background raster, monochrome ink). Pure
 *  function — owns its own scratch canvas, callers don't have to
 *  manage one. */
export function rasterizeSignatureToPng(
  source: SignatureSource,
  targetW: number = DEFAULT_RASTER_W,
  targetH: number = DEFAULT_RASTER_H,
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    // Headless / no 2D context — return a tiny transparent PNG so the
    // call site doesn't have to special-case the failure path.
    return emptyPng();
  }
  // Transparent background — the engine embeds the PNG with alpha so a
  // white fill would show as a white box on white pages and as a black
  // box on dark pages.
  ctx.clearRect(0, 0, targetW, targetH);
  if (source.kind === "drawn") {
    drawStrokes(ctx, source.points, source.width, source.height, targetW, targetH);
  } else {
    drawTyped(ctx, source.text, targetW, targetH);
  }
  // canvas.toDataURL returns a base64 PNG ("data:image/png;base64,...")
  // — strip the prefix and decode to raw bytes.
  const dataUrl = canvas.toDataURL("image/png");
  return decodeDataUrlToBytes(dataUrl);
}

/** Same as `rasterizeSignatureToPng(SavedSignature.source, ...)` — convenience
 *  helper for callers that hold a `SavedSignature`. */
export function rasterizeSavedSignatureToPng(
  signature: SavedSignature,
  targetW?: number,
  targetH?: number,
): Uint8Array {
  return rasterizeSignatureToPng(signature.source, targetW, targetH);
}

/** Paint the polyline strokes into the canvas, scaled from the
 *  source-space to the target-space. The pen colour and width mirror
 *  the modal's Draw tab so the export matches what the user drew. */
function drawStrokes(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[][],
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): void {
  const sx = targetW / sourceW;
  const sy = targetH / sourceH;
  ctx.strokeStyle = DRAW_PEN_COLOR;
  // DEF-144 — the pen width scales WITH the points (see
  // `scaledStrokeWidth`); the previous fixed width painted too-thin
  // strokes into an upscaled target and the SVG mirror (which scaled
  // the points) disagreed with the PNG on save.
  ctx.lineWidth = scaledStrokeWidth(sourceW, sourceH, targetW, targetH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of points) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const [first, ...rest] = stroke;
    ctx.moveTo(first.x * sx, first.y * sy);
    for (const p of rest) ctx.lineTo(p.x * sx, p.y * sy);
    ctx.stroke();
  }
}

/** Paint the typed text into the canvas at a fitted script font. The
 *  font-size scales so the text fits the target width with a small
 *  horizontal margin. */
function drawTyped(
  ctx: CanvasRenderingContext2D,
  text: string,
  targetW: number,
  targetH: number,
): void {
  if (text.trim().length === 0) return;
  ctx.fillStyle = DRAW_PEN_COLOR;
  ctx.textBaseline = "alphabetic";
  // Choose a font-size that fills ~90% of the target width.
  const pad = 16;
  const usableW = targetW - pad * 2;
  // Rough avg-glyph-width estimate (script fonts are mostly italic):
  // 0.55 × font-size per character at this style.
  const estimateFont = Math.max(
    12,
    Math.min(targetH * 0.95, usableW / Math.max(text.length * 0.55, 1)),
  );
  ctx.font = `italic ${estimateFont}px ${TYPED_FONT_FAMILY}`;
  const metrics = ctx.measureText(text);
  const descent = estimateFont * 0.2;
  const y = targetH - Math.max(descent, 4);
  ctx.fillText(text, pad, y);
  void metrics;
}

/** Minimal valid PNG (1×1, fully transparent). Used when canvas isn't
 *  available (SSR / tests). PNG bytes are well-documented; this is a
 *  hard-coded 67-byte file. */
function emptyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
  ]);
}

/** Strip the "data:image/png;base64," prefix and decode the rest into
 *  a Uint8Array. Browser-side only — server-side Node would use
 *  Buffer.from(s, "base64"). */
function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const prefix = "data:image/png;base64,";
  const b64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}