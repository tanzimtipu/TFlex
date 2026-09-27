// Phase 48 (item 3) — ONE shared placement rule for every floating
// control bar that anchors to page content (annotation action bar,
// stamp bar, textbox / image placement toolbars, the text-run bar and
// the signature action bar).
//
// The operator reported a selected rectangle's Delete icon rendering
// OUTSIDE the visible page when the shape sat at the page's bottom
// edge: the old call sites only clamped the LEFT edge (the
// `Math.max(0, Math.min(...))` pattern), so a bar placed "4px under"
// an annotation flush with the page bottom landed entirely past the
// page — and off the scroller's visible area.
//
// The rule here is strictly CLAMPING (never hiding): the control is
// first placed on its preferred side of the anchor, flipped to the
// other side when the preferred side has no room, and finally clamped
// into the page viewport on BOTH axes. Pure math so it is unit-testable
// and identical at every call site.

export interface ControlPosition {
  left: number;
  top: number;
}

export interface ControlSize {
  width: number;
  height: number;
}

export interface ControlViewport {
  width: number;
  height: number;
}

/** The anchor box (CSS px) a control floats beside — the annotation /
 *  stamp / signature bounds, or a text run's rect. */
export interface ControlAnchorBox {
  left: number;
  top: number;
  bottom: number;
}

/** Assumed bar height (CSS px) for the clamp — the shared
 *  `.content-action-bar` chrome is ~32px tall (4px padding + a 21px
 *  button row + border). Over-estimating only pulls the bar a hair
 *  further inside the page; it never lets it leave. */
export const CONTROL_BAR_HEIGHT = 32;

/** Gap between a control and the page view's edges. */
export const CONTROL_EDGE_GAP = 4;

/** Clamp a control's top-left so its full box stays inside the
 *  viewport. When the control is larger than the viewport on an axis
 *  it is pinned to the leading edge (it can never be pushed fully
 *  outside). This is the single clamp both axes of every bar use. */
export function clampControlPosition(
  pos: ControlPosition,
  size: ControlSize,
  viewport: ControlViewport,
  gap: number = CONTROL_EDGE_GAP,
): ControlPosition {
  const maxLeft = Math.max(gap, viewport.width - size.width - gap);
  const maxTop = Math.max(gap, viewport.height - size.height - gap);
  return {
    left: Math.max(gap, Math.min(pos.left, maxLeft)),
    top: Math.max(gap, Math.min(pos.top, maxTop)),
  };
}

/** Place a control beside an anchor: preferred side first, flip to the
 *  other side when the preferred one would not fit, then hard-clamp.
 *  `offset` carries a live drag translation (signature bar) and is
 *  applied before the clamp so a drag can never park the bar outside
 *  the page either. */
export function placeControlNearAnchor(args: {
  anchor: ControlAnchorBox;
  size: ControlSize;
  viewport: ControlViewport;
  preferBelow?: boolean;
  gap?: number;
  offset?: ControlPosition;
}): ControlPosition {
  const { anchor, size, viewport, preferBelow = true, gap = CONTROL_EDGE_GAP } = args;
  const offset = args.offset ?? { left: 0, top: 0 };
  const maxTop = Math.max(gap, viewport.height - size.height - gap);
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - size.height - gap;
  let top: number;
  if (preferBelow) {
    top = belowTop > maxTop && aboveTop >= gap ? aboveTop : belowTop;
  } else {
    top = aboveTop < gap && belowTop <= maxTop ? belowTop : aboveTop;
  }
  return clampControlPosition(
    { left: anchor.left + offset.left, top: top + offset.top },
    size,
    viewport,
    gap,
  );
}
