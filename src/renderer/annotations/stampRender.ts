// Phase 12 — built-in stamp rendering.
//
// The renderer draws each built-in stamp id to a canvas as a PNG
// buffer and forwards the bytes to the engine for embedding. The
// engine has no rasteriser (pdf-lib can't draw text), so the
// renderer owns the canvas painting. Stamps are drawn at a high
// resolution so they survive zoom-in without pixelating.
//
// Per-id visual contract:
//   - APPROVED        green border + text
//   - DRAFT           gray border + text
//   - CONFIDENTIAL    red border + text
//   - FINAL           blue border + text
//
// The canvas size and font are fixed so the stamp reads cleanly at
// any placement rect the user chooses. The returned PNG is the
// canonical raster the engine embeds via `addStamp`.

import type { StampId } from "../../shared/types";

/** Allowlist of built-in stamp ids. Mirrors the `StampId` union in
 *  `src/shared/types.ts` and the backend's stamp allowlist. The
 *  renderer uses this to validate the user's pick + seed the
 *  stamp picker with the right options. */
export const STAMP_IDS: readonly StampId[] = [
  "APPROVED",
  "DRAFT",
  "CONFIDENTIAL",
  "FINAL",
];

export interface StampStyle {
  /** Hex border color. */
  border: string;
  /** Hex fill color (semi-transparent). */
  fill: string;
  /** Hex text color. */
  text: string;
  /** Label text (defaults to the stamp id). */
  label: string;
}

/** Per-stamp visual config. The palette is deliberately
 *  business-document neutral (no rainbow / brand colors) so the
 *  stamps read like real rubber stamps. */
export const STAMP_STYLES: Record<StampId, StampStyle> = {
  APPROVED: {
    border: "#15803d",
    fill: "rgba(34, 197, 94, 0.18)",
    text: "#15803d",
    label: "APPROVED",
  },
  DRAFT: {
    border: "#475569",
    fill: "rgba(100, 116, 139, 0.18)",
    text: "#475569",
    label: "DRAFT",
  },
  CONFIDENTIAL: {
    border: "#b91c1c",
    fill: "rgba(239, 68, 68, 0.18)",
    text: "#b91c1c",
    label: "CONFIDENTIAL",
  },
  FINAL: {
    border: "#1d4ed8",
    fill: "rgba(37, 99, 235, 0.18)",
    text: "#1d4ed8",
    label: "FINAL",
  },
};

/** Default stamp id used when the user opens the Stamp tool without
 *  picking one. Mirrors `AppSettings.defaultStampId` — the renderer
 *  applies this default when the settings field is absent (same
 *  pattern as `editDefaultFont` / `ocrLanguage`). */
export const DEFAULT_STAMP_ID: StampId = "APPROVED";

/** Default stamp raster canvas dimensions (pixels). The user picks
 *  the on-page rect at stamp-placement time; this constant just
 *  sets the rendered-raster pixel size. */
export const STAMP_CANVAS_W = 480;
export const STAMP_CANVAS_H = 200;

/** Render the chosen stamp id to a hidden canvas and return the
 *  PNG bytes + the canvas's intrinsic dimensions. The host places
 *  the returned raster at the user's chosen on-page rect via
 *  `engine.addStamp`. The canvas uses a transparent background so
 *  the stamp doesn't paint white pixels around its content; only
 *  the border + text + semi-transparent fill are visible. */
export function renderStampToPng(
  stampId: StampId,
): { pngBytes: Uint8Array; width: number; height: number } {
  const canvas = document.createElement("canvas");
  canvas.width = STAMP_CANVAS_W;
  canvas.height = STAMP_CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    // Defensive fallback: no canvas (jsdom without a 2D backend,
    // older builds). Return a 1x1 transparent PNG so the engine
    // payload is still well-formed; the dialog surfaces a friendly
    // error if this happens in production.
    return {
      pngBytes: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]),
      width: 1,
      height: 1,
    };
  }
  drawStamp(ctx, stampId, STAMP_CANVAS_W, STAMP_CANVAS_H);
  // canvas.toBlob is async; we use a sync PNG encode via toDataURL
  // + base64 decode so the dialog can hand the bytes to the engine
  // without a follow-up promise. The PNG encoder is built into the
  // canvas API; this path works in jsdom (with the polyfilled 2D
  // backend) and in Electron's renderer.
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { pngBytes: bytes, width: STAMP_CANVAS_W, height: STAMP_CANVAS_H };
}

/** Draw the stamp to the supplied 2D context. Exported separately
 *  so the stamp picker can preview the stamp in a normal <canvas>
 *  without re-running the PNG-encode path. */
export function drawStamp(
  ctx: CanvasRenderingContext2D,
  stampId: StampId,
  width: number,
  height: number,
): void {
  const style = STAMP_STYLES[stampId];
  ctx.clearRect(0, 0, width, height);
  // Outer border (rounded rect).
  const pad = 16;
  ctx.lineWidth = 6;
  ctx.strokeStyle = style.border;
  ctx.fillStyle = style.fill;
  // Rounded rectangles require a manual corner trace; we use a
  // simple rect for visual consistency with the rubber-stamp idiom
  // and skip the rounded-corner work — the engine embeds the raster
  // at the user's chosen rect, so a plain rectangle is fine.
  ctx.beginPath();
  ctx.rect(pad, pad, width - pad * 2, height - pad * 2);
  ctx.fill();
  ctx.stroke();
  // Inner border (offset by half the line width for a "double-rule"
  // stamp look).
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(pad + 10, pad + 10, width - pad * 2 - 20, height - pad * 2 - 20);
  ctx.stroke();
  // Text.
  ctx.fillStyle = style.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Font size scales with canvas height; ~30% of the smaller
  // dimension keeps the label readable at small placements.
  const fontSize = Math.round(Math.min(width, height) * 0.3);
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillText(style.label, width / 2, height / 2);
  // Subline: "stamped <id>" beneath the main label. Smaller font.
  ctx.font = `500 ${Math.round(fontSize * 0.28)}px Inter, system-ui, sans-serif`;
  ctx.fillText("STAMP", width / 2, height / 2 + fontSize * 0.75);
}