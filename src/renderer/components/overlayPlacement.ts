// TFL-1116 (R03 chunk C3) — ONE shared collision-aware placement rule for
// overlays anchored to a trigger (the application menu and its submenus).
//
// The application menu used to open as an absolutely-positioned popover inside
// `.app-menu` with no viewport bound, so a long row (label + `.kbd`
// accelerator) pushed it past the window edge and exposed a horizontal
// scrollbar. This module mirrors the pure-clamp philosophy of
// `controlPlacement.ts`: pick the preferred side of the anchor, flip when the
// preferred side has no room, bound the box with the 8px viewport gutter on
// BOTH axes, and never produce a negative coordinate — an oversized box pins
// to the leading gutter rather than escaping. Pure math, so it is unit-testable
// and identical for the root menu and every submenu.

export interface OverlayAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface OverlayViewport {
  width: number;
  height: number;
}

export interface OverlayPlacement {
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
  placement: "below" | "above";
  align: "start" | "end";
}

export interface PlaceOverlayInput {
  anchor: OverlayAnchor;
  size: OverlaySize;
  viewport: OverlayViewport;
  prefer?: "below" | "above";
  align?: "start" | "end";
  gap?: number;
  minHeight?: number;
  maxHeightCap?: number;
}

/** The viewport gutter the overlay keeps on every side (CSS px). */
export const OVERLAY_VIEWPORT_GAP = 8;

/**
 * Place an overlay near an anchor and bound it to the viewport.
 *
 * Rules:
 * - `gap` (default 8) is the viewport gutter.
 * - Prefer `below` (`anchor.bottom + gap`) unless it does not fit and `above`
 *   does, then flip; `prefer: "above"` is the mirror.
 * - `start` aligns the left edge to `anchor.left`; `end` aligns the right edge
 *   to `anchor.right`; the box is then shifted so it stays inside
 *   `[gap, viewport.width - gap]`.
 * - `maxWidth = max(gap, viewport.width - 2 * gap)`.
 * - `maxHeight = clamp(available on the chosen side, minHeight, maxHeightCap)`.
 * - A box taller or wider than the viewport pins to the leading gap, so the
 *   returned coordinates are never negative.
 */
export function placeOverlay(input: PlaceOverlayInput): OverlayPlacement {
  const {
    anchor,
    size,
    viewport,
    prefer = "below",
    align = "start",
    gap = OVERLAY_VIEWPORT_GAP,
    minHeight = 0,
    maxHeightCap = Number.POSITIVE_INFINITY,
  } = input;

  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - size.height;
  const maxTop = Math.max(gap, viewport.height - gap - size.height);
  const maxLeft = Math.max(gap, viewport.width - gap - size.width);

  const fitsBelow = belowTop <= maxTop;
  const fitsAbove = aboveTop >= gap;

  let placement: "below" | "above";
  if (prefer === "below") {
    placement = fitsBelow || !fitsAbove ? "below" : "above";
  } else {
    placement = fitsAbove || !fitsBelow ? "above" : "below";
  }

  const rawTop = placement === "below" ? belowTop : aboveTop;
  const top = Math.max(gap, Math.min(rawTop, maxTop));

  const rawLeft = align === "end" ? anchor.right - size.width : anchor.left;
  const left = Math.max(gap, Math.min(rawLeft, maxLeft));

  // Space available on the chosen side, measured from the gutter to the
  // anchor edge minus the gutter the box itself sits behind.
  const sideSpace =
    placement === "below"
      ? viewport.height - anchor.bottom - 2 * gap
      : anchor.top - 2 * gap;
  const maxHeight = Math.max(minHeight, Math.min(maxHeightCap, sideSpace));
  const maxWidth = Math.max(gap, viewport.width - 2 * gap);

  return { left, top, maxHeight, maxWidth, placement, align };
}