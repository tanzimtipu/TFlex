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
 *  stamp / signature bounds, or a text run's rect. `right` is optional:
 *  a bare anchor may omit it, while an OBSTACLE box (a chrome rect the
 *  control must never cover) carries it so the overlap test has a width. */
export interface ControlAnchorBox {
  left: number;
  top: number;
  bottom: number;
  right?: number;
}

/** A full CSS-px rectangle (position + size) for the overlap test. */
export interface ControlBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Assumed bar height (CSS px) for the clamp — the shared
 *  `.content-action-bar` chrome is ~32px tall (4px padding + a 21px
 *  button row + border). Over-estimating only pulls the bar a hair
 *  further inside the page; it never lets it leave. */
export const CONTROL_BAR_HEIGHT = 32;

/** Gap between a control and the page view's edges. */
export const CONTROL_EDGE_GAP = 4;

/** Phase 117 — the smallest anchor (CSS px, either axis) a floating
 *  context control will serve. Below this the selected object is a dot,
 *  so the control would be the only usable hit surface; the Inspector
 *  owns the object's properties / actions instead. */
export const CONTROL_MIN_ANCHOR_SIZE = 8;

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

/** The two sides (below / above) a control may take, in the historical
 *  prefer-below -> flip-above order. The primary is the side the legacy
 *  rule would use; the alternate is the other one, kept so an obstacle
 *  pass can compare them. Pure math. */
function candidateTops(args: {
  anchor: ControlAnchorBox;
  size: ControlSize;
  viewport: ControlViewport;
  preferBelow?: boolean;
  gap?: number;
}): { primary: number; alternate: number } {
  const { anchor, size, viewport, preferBelow = true, gap = CONTROL_EDGE_GAP } = args;
  const maxTop = Math.max(gap, viewport.height - size.height - gap);
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - size.height - gap;
  if (preferBelow) {
    const flipped = belowTop > maxTop && aboveTop >= gap;
    return { primary: flipped ? aboveTop : belowTop, alternate: flipped ? belowTop : aboveTop };
  }
  const flipped = aboveTop < gap && belowTop <= maxTop;
  return { primary: flipped ? belowTop : aboveTop, alternate: flipped ? aboveTop : belowTop };
}

/** The overlap area (CSS px^2) between a placed control box and every
 *  obstacle rect. Zero means the control is fully clear. */
function overlapArea(box: ControlBox, obstacles: readonly ControlAnchorBox[]): number {
  let total = 0;
  for (const o of obstacles) {
    const right = o.right ?? o.left;
    const ix = Math.max(0, Math.min(box.left + box.width, right) - Math.max(box.left, o.left));
    const iy = Math.max(0, Math.min(box.top + box.height, o.bottom) - Math.max(box.top, o.top));
    total += ix * iy;
  }
  return total;
}

function placedBox(pos: ControlPosition, size: ControlSize): ControlBox {
  return { left: pos.left, top: pos.top, width: size.width, height: size.height };
}

/** Place a control beside an anchor: preferred side first, flip to the
 *  other side when the preferred one would not fit, then hard-clamp.
 *  `offset` carries a live drag translation (signature bar) and is
 *  applied before the clamp so a drag can never park the bar outside
 *  the page either.
 *
 *  Phase 117 — `obstacles` are the app-chrome rects (rail / inspector /
 *  dock / viewing footer) in the SAME coordinate space as `viewport`. A
 *  placed control never intersects one: the preferred side is used when
 *  it is clear, the other side when it is clear, and when neither side
 *  is clear the side with the LEAST overlap wins (still clamped into the
 *  viewport). The order of the two candidates is unchanged, so an empty
 *  obstacle list is byte-identical to the historic behaviour. */
export function placeControlNearAnchor(args: {
  anchor: ControlAnchorBox;
  size: ControlSize;
  viewport: ControlViewport;
  preferBelow?: boolean;
  gap?: number;
  offset?: ControlPosition;
  obstacles?: readonly ControlAnchorBox[];
}): ControlPosition {
  const { anchor, size, viewport, gap = CONTROL_EDGE_GAP } = args;
  const offset = args.offset ?? { left: 0, top: 0 };
  const obstacles = args.obstacles ?? [];
  const { primary, alternate } = candidateTops(args);
  const left = anchor.left + offset.left;
  const primaryPos = clampControlPosition({ left, top: primary + offset.top }, size, viewport, gap);
  if (obstacles.length === 0) return primaryPos;
  const primaryOverlap = overlapArea(placedBox(primaryPos, size), obstacles);
  if (primaryOverlap === 0) return primaryPos;
  const alternatePos = clampControlPosition(
    { left, top: alternate + offset.top },
    size,
    viewport,
    gap,
  );
  const alternateOverlap = overlapArea(placedBox(alternatePos, size), obstacles);
  if (alternateOverlap === 0) return alternatePos;
  return primaryOverlap <= alternateOverlap ? primaryPos : alternatePos;
}

/** Phase 117 — can a floating context control exist for this anchor?
 *  False when the anchor is smaller than `minSize` on either axis
 *  (a dot), or when NEITHER side produces a placement that both stays
 *  inside the viewport and clears every obstacle. Surfaces then fall
 *  back to the Inspector instead of rendering an overlapping bar. Pure
 *  math, exported for the sibling specs. */
export function contextControlFits(
  anchor: ControlAnchorBox,
  size: ControlSize,
  viewport: ControlViewport,
  obstacles: readonly ControlAnchorBox[] = [],
  minSize: number = CONTROL_MIN_ANCHOR_SIZE,
): boolean {
  const width = anchor.right !== undefined ? anchor.right - anchor.left : Infinity;
  const height = anchor.bottom - anchor.top;
  if (width < minSize || height < minSize) return false;
  const { primary, alternate } = candidateTops({ anchor, size, viewport });
  const gap = CONTROL_EDGE_GAP;
  const fits = (top: number): boolean => {
    const pos = clampControlPosition({ left: anchor.left, top }, size, viewport, gap);
    const inside =
      pos.left >= gap - 0.001 &&
      pos.top >= gap - 0.001 &&
      pos.left + size.width <= viewport.width - gap + 0.001 &&
      pos.top + size.height <= viewport.height - gap + 0.001;
    return inside && overlapArea(placedBox(pos, size), obstacles) === 0;
  };
  return fits(primary) || fits(alternate);
}

/** Phase 117 — the EXISTING mounted app-chrome roots whose rects a
 *  floating control must never cover: the thumbnail side rail, the
 *  Inspector, the action dock and the View Strip (viewing footer).
 *  Read from the live DOM (no second layout system); a rect is returned
 *  in the coordinate space of `origin` (the surface's own offset
 *  parent), so window-space and page-view controls share one helper. */
const CHROME_OBSTACLE_SELECTORS: readonly string[] = [
  ".thumb-scroller",
  "[data-inspector]",
  ".action-dock",
  ".view-strip",
];

export function chromeObstaclesIn(origin: Element | null): ControlAnchorBox[] {
  if (typeof document === "undefined") return [];
  const originRect = origin?.getBoundingClientRect();
  const ox = originRect?.left ?? 0;
  const oy = originRect?.top ?? 0;
  const result: ControlAnchorBox[] = [];
  for (const selector of CHROME_OBSTACLE_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      result.push({ left: r.left - ox, top: r.top - oy, bottom: r.bottom - oy, right: r.right - ox });
    }
  }
  return result;
}
