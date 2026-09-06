// Bug 6 — renderer-side stamp mutation helpers.
//
// The engine bakes stamps into the page bitmap (addStamp) and has no
// stamp registry / move / delete op, so the only renderer-reachable
// lever for changing a placed stamp is the Phase 10 `editImage`
// contract: "mask oldRect with white, then draw imageBytes at
// newRect". All three stamp mutations reduce to that:
//
//   move/resize   mask the old rect, draw the SAME stamp PNG at the
//                 new rect.
//   delete        mask the old rect with a solid white raster (the
//                 documented Phase-10 visual-redact behavior — the
//                 original stamp pixels are covered, exactly like
//                 editTextRun / the pre-registry text-box move).
//   retype        mask the old rect, draw the freshly-rasterised PNG
//                 for the new stamp id at the same rect.
//
// The white mask is a 1x1 solid-white PNG: the engine stretches it
// to the rect, producing a perfectly flat white cover with no
// scaling artifacts.

import type { StampId } from "../../shared/types";
import { renderStampToPng } from "./stampRender";

/** 1x1 solid-white PNG (IHDR 1x1, 8-bit RGB color type 2, no
 *  interlace; valid zlib IDAT + CRC). Stretching it over a stamp
 *  rect yields a flat white rectangle — the mask the editImage
 *  contract applies. Generated once; kept byte-identical so jsdom
 *  unit tests and the packaged renderer share the same payload. */
export const WHITE_1X1_PNG_BYTES: Uint8Array = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84,
  120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 13, 239, 70, 184, 0,
  0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/** The canonical raster for a stamp id — reused by the retype op so
 *  the new stamp's pixels match what the picker previews. */
export function rasterizeStamp(stampId: StampId): {
  pngBytes: Uint8Array;
  width: number;
  height: number;
} {
  return renderStampToPng(stampId);
}

export type { StampId };