// TFL-1116 (R03 chunk C3) — the React binding for `placeOverlay`.
//
// The pure rule lives in `overlayPlacement.ts`; this sibling owns the DOM
// measurement: it reads the opener/overlay rects, applies the shared rule, and
// recomputes on `resize` and capture-phase `scroll` (so a menu that is already
// open re-flips when the window or a scroll container moves under it). The
// result is `null` until both elements are measurable, so callers can keep
// rendering the unpositioned surface for one layout pass and never flash a
// wrong coordinate: the measurement runs in a LAYOUT effect, before paint.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  OVERLAY_VIEWPORT_GAP,
  placeOverlay,
  type OverlayAnchor,
  type OverlayPlacement,
} from "./overlayPlacement";

export interface OverlayPlacementOptions {
  prefer?: "below" | "above";
  align?: "start" | "end";
  gap?: number;
  minHeight?: number;
  maxHeightCap?: number;
  /** Re-measure whenever this flips to `true` (the surface opened). The last
   *  placement is kept while `false` so an exiting surface does not jump. */
  open?: boolean;
}

/** The anchor box a placement is measured against. */
function anchorOf(el: HTMLElement): OverlayAnchor {
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function samePlacement(a: OverlayPlacement | null, b: OverlayPlacement): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.maxHeight === b.maxHeight &&
    a.maxWidth === b.maxWidth &&
    a.placement === b.placement &&
    a.align === b.align
  );
}

/**
 * Measure `openerRef` and `overlayRef` and return the collision-aware
 * placement; recompute on resize and capture-phase scroll. The opener ref may
 * be `undefined` (no measurement is attempted) so a caller can gate the hook
 * on a boolean without breaking the rules of hooks.
 */
export function useOverlayPlacement(
  openerRef: RefObject<HTMLElement | null> | undefined,
  overlayRef: RefObject<HTMLElement | null>,
  options: OverlayPlacementOptions = {},
): OverlayPlacement | null {
  const [placement, setPlacement] = useState<OverlayPlacement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const measure = useCallback((): void => {
    const opener = openerRef?.current ?? null;
    const overlay = overlayRef.current;
    if (opener === null || overlay === null) return;
    const next = placeOverlay({
      anchor: anchorOf(opener),
      // DEF-618 — measure the LAYOUT box, not `getBoundingClientRect`: the
      // surface enters with a `scale(0.95)` (TfMenu), so the client rect is 5%
      // smaller than the settled box while the enter animation runs. That made
      // the horizontal clamp under-shift and overflow the right gutter. The
      // offset* properties are unaffected by transforms.
      size: {
        width: overlay.offsetWidth,
        height: overlay.offsetHeight,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ...optionsRef.current,
    });
    setPlacement((prev): OverlayPlacement | null => (samePlacement(prev, next) ? prev : next));
  }, [openerRef, overlayRef]);

  useLayoutEffect((): (() => void) | undefined => {
    if (openerRef === undefined || options.open === false) return undefined;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return (): void => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, openerRef, options.open]);

  return placement;
}

/**
 * Place a nested submenu beside the row that opened it. The row is treated as
 * a zero-height anchor at the row's top whose leading edge is the row's RIGHT
 * edge plus the gutter: `start` alignment then opens the submenu to the right,
 * and the shared horizontal clamp shifts it back to the left when there is no
 * room on the right (the "flip"). The vertical flip and height bound come from
 * the same rule, so the submenu never leaves the viewport.
 */
export function useSubmenuPlacement(
  anchorRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  options: OverlayPlacementOptions = {},
): OverlayPlacement | null {
  const [placement, setPlacement] = useState<OverlayPlacement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const measure = useCallback((): void => {
    const row = anchorRef.current;
    const overlay = overlayRef.current;
    if (row === null || overlay === null) return;
    const rect = row.getBoundingClientRect();
    // DEF-618 — layout box (transform-independent), matching the root path.
    const size = {
      width: overlay.offsetWidth,
      height: overlay.offsetHeight,
    };
    const gap = optionsRef.current.gap ?? OVERLAY_VIEWPORT_GAP;
    const next = placeOverlay({
      anchor: {
        left: rect.right + gap,
        top: rect.top,
        right: rect.right + gap + size.width,
        bottom: rect.top,
        width: size.width,
        height: 0,
      },
      size,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ...optionsRef.current,
    });
    setPlacement((prev): OverlayPlacement | null => (samePlacement(prev, next) ? prev : next));
  }, [anchorRef, overlayRef]);

  useLayoutEffect((): (() => void) | undefined => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return (): void => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  return placement;
}