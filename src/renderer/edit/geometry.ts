// Phase 10 — pure geometry helpers for the image edit overlay.
//
// All functions work in page points (top-left origin, scale 1) and
// are DOM-free so the unit tests can exercise the math without a
// browser. The components call these during pointermove (live
// preview) and pointerup (final commit) — both paths use the same
// math so the on-screen preview is always what the engine will see.
//
// Conventions:
//   * All rects are { x, y, width, height }, x and y at the top-left
//     of the placement.
//   * The "handle" set is the standard 8-handle set (n, s, e, w, nw,
//     ne, sw, se) but Phase 10 only ships the four corners. The
//     side handles (n, s, e, w) are deliberately omitted so the
//     overlay stays simple and matches what a user can comfortably
//     target with a mouse on a 612pt-wide page.

import { clamp } from "./model";

export type ImageResizeHandle = "nw" | "ne" | "sw" | "se";

export type ImageRect = { x: number; y: number; width: number; height: number };

/** Compute the new image rect after a drag from `startRect` by
 *  `delta` (page points, top-left delta) with the given handle.
 *  The corner handles anchor on the opposite corner: dragging the
 *  NW handle moves the rect's right and bottom edges; the
 *  top-left is anchored to the original position. The result is
 *  always a non-negative-width/height rect; we never produce a
 *  negative-size rect (it would invert the Do operator's cm). */
export function resizeImageRect(
  startRect: ImageRect,
  handle: ImageResizeHandle,
  delta: { x: number; y: number },
  pageWidthPt: number,
  pageHeightPt: number,
): ImageRect {
  // Start with the start rect — we'll mutate selectively per handle.
  let x = startRect.x;
  let y = startRect.y;
  let right = startRect.x + startRect.width;
  let bottom = startRect.y + startRect.height;
  const minSize = 4; // pt; the engine draws nothing smaller than this

  switch (handle) {
    case "nw":
      x = startRect.x + delta.x;
      y = startRect.y + delta.y;
      break;
    case "ne":
      right = startRect.x + startRect.width + delta.x;
      y = startRect.y + delta.y;
      break;
    case "sw":
      x = startRect.x + delta.x;
      bottom = startRect.y + startRect.height + delta.y;
      break;
    case "se":
      right = startRect.x + startRect.width + delta.x;
      bottom = startRect.y + startRect.height + delta.y;
      break;
  }

  // Enforce min size: when the drag would invert a side, anchor to
  // the original edge instead. This keeps the rect's edges visible
  // even when the user drags the handle across the page.
  if (right - x < minSize) {
    if (handle === "nw" || handle === "sw") {
      x = right - minSize;
    } else {
      right = x + minSize;
    }
  }
  if (bottom - y < minSize) {
    if (handle === "nw" || handle === "ne") {
      y = bottom - minSize;
    } else {
      bottom = y + minSize;
    }
  }

  // Clamp inside the page so the rect never escapes.
  x = clamp(x, 0, pageWidthPt);
  y = clamp(y, 0, pageHeightPt);
  right = clamp(right, 0, pageWidthPt);
  bottom = clamp(bottom, 0, pageHeightPt);
  // Re-enforce min size after the clamp (which may have shrunken one
  // side to the page edge).
  if (right - x < minSize) right = clamp(x + minSize, 0, pageWidthPt);
  if (bottom - y < minSize) bottom = clamp(y + minSize, 0, pageHeightPt);

  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Move a rect by a delta. The resulting rect is clamped to the
 *  page so a fast drag can't push it offscreen. The rect's
 *  bottom-right edge rides along with the top-left, so the size
 *  is preserved across the move. */
export function moveImageRect(
  startRect: ImageRect,
  delta: { x: number; y: number },
  pageWidthPt: number,
  pageHeightPt: number,
): ImageRect {
  const x = clamp(startRect.x + delta.x, 0, Math.max(0, pageWidthPt - startRect.width));
  const y = clamp(startRect.y + delta.y, 0, Math.max(0, pageHeightPt - startRect.height));
  return { x, y, width: startRect.width, height: startRect.height };
}

/** Compute the cropped image rect — i.e. the rect produced by a
 *  crop drag (rect-within-rect). The cropper renders a translucent
 *  marquee inside the image's bounding rect; on commit, the inner
 *  rect becomes the new image rect, in absolute page coordinates.
 *
 *  `inside` is in the image's local coordinate system (top-left
 *  origin, 0..1) — the function maps it back to page points. */
export function cropImageRect(
  imageRect: ImageRect,
  inside: { x: number; y: number; width: number; height: number },
  minSize: number = 8,
): ImageRect {
  // Clamp the inside rect to [0, 1] and enforce a min size in
  // local space so a tiny crop is still a meaningful one.
  const x = clamp(inside.x, 0, 1);
  const y = clamp(inside.y, 0, 1);
  const w = clamp(inside.width, minSize / Math.max(1, imageRect.width), 1 - x);
  const h = clamp(inside.height, minSize / Math.max(1, imageRect.height), 1 - y);
  return {
    x: imageRect.x + x * imageRect.width,
    y: imageRect.y + y * imageRect.height,
    width: w * imageRect.width,
    height: h * imageRect.height,
  };
}

/** Convert a page-space rect into the image's local coordinate
 *  system (0..1, top-left origin). Used by the cropper to render
 *  the marquee inside the image's bounding rect. */
export function pageRectToImageLocal(
  imageRect: ImageRect,
  crop: ImageRect,
): { x: number; y: number; width: number; height: number } {
  const wSafe = imageRect.width === 0 ? 1 : imageRect.width;
  const hSafe = imageRect.height === 0 ? 1 : imageRect.height;
  return {
    x: (crop.x - imageRect.x) / wSafe,
    y: (crop.y - imageRect.y) / hSafe,
    width: crop.width / wSafe,
    height: crop.height / hSafe,
  };
}

/** True when two rects are visually equal (within a half-point
 *  tolerance). Used by the overlay to decide whether a drag
 *  actually changed the rect and therefore should be committed. */
export function rectsClose(
  a: ImageRect,
  b: ImageRect,
  tolerance: number = 0.5,
): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/** Return the area of a rect. Used by the resize commit to reject
 *  degenerate drags (zero-area). */
export function rectArea(r: ImageRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/** True when `inner` is fully inside `outer`. Used by the cropper
 *  to check the user hasn't dragged the crop rect outside the
 *  image's bounds. */
export function rectContainsRect(outer: ImageRect, inner: ImageRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
