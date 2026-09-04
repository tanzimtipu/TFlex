// Pure annotation geometry. Everything here operates in PAGE POINTS with a
// TOP-LEFT origin (scale 1), matching the annotation model. The overlay and
// the markup tool call these directly; they are deliberately DOM-free so the
// unit tests can exercise them without a browser.

import type {
  Annotation,
  PagePoint,
  PageRect,
} from "./model";

// ---------------------------------------------------------------------------
// Text item geometry (one entry per pdf.js text item)

export interface TextItemGeom {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/** Two items are on the same line when their vertical centers are within
 *  this fraction of the taller item's height. pdf.js splits lines into
 *  runs whose exact y offsets can differ by a fraction of a point. */
const LINE_TOLERANCE_RATIO = 0.6;

/** Rects on the same line whose horizontal gap is at most this many points
 *  are merged into a single quad, so a multi-word selection serializes as
 *  one rect per line instead of one rect per text run. */
const MERGE_GAP_PT = 2;

function orderedEndpoints(
  from: PagePoint,
  to: PagePoint,
): { start: PagePoint; end: PagePoint } {
  // Reading order: top-to-bottom, then left-to-right on the same line.
  // A line's height is unknown here, so use a coarse vertical epsilon to
  // decide "same line" for endpoint ordering; dragging slightly upward
  // within a line must not flip the direction.
  const EPS = 4;
  if (from.y < to.y - EPS) return { start: from, end: to };
  if (to.y < from.y - EPS) return { start: to, end: from };
  return from.x <= to.x ? { start: from, end: to } : { start: to, end: from };
}

/**
 * Compute markup quads (one rect per covered line) for a click-drag text
 * selection over a page's text items.
 *
 * `from` / `to` are the drag endpoints in page points (either direction).
 * An item is covered when its vertical band lies between the endpoints'
 * lines; items on the first line are clipped at `start.x`, items on the
 * last line at `end.x`. Returns [] when the drag covers no text.
 */
export function textItemQuads(
  items: readonly TextItemGeom[],
  from: PagePoint,
  to: PagePoint,
): PageRect[] {
  const { start, end } = orderedEndpoints(from, to);
  const covered: PageRect[] = [];
  for (const item of items) {
    if (item.width <= 0 || item.height <= 0) continue;
    const centerY = item.y + item.height / 2;
    // The item's line must start at or below the start point's line and
    // end at or above the end point's line. We compare against the item
    // centers so a pointer landing anywhere within a line's band selects it.
    if (centerY < start.y && item.y + item.height <= start.y) continue;
    if (centerY > end.y && item.y >= end.y) continue;
    // Above/below the whole selection band?
    if (item.y > end.y) continue;
    if (item.y + item.height < start.y) continue;

    const onStartLine = item.y < start.y + item.height && start.y <= item.y + item.height;
    const onEndLine = item.y <= end.y && end.y < item.y + item.height;

    let left = item.x;
    let right = item.x + item.width;
    if (onStartLine && onEndLine) {
      if (right < Math.min(start.x, end.x)) continue;
      if (left > Math.max(start.x, end.x)) continue;
      left = Math.max(left, Math.min(start.x, end.x));
      right = Math.min(right, Math.max(start.x, end.x));
    } else if (onStartLine) {
      if (right < start.x) continue;
      left = Math.max(left, start.x);
    } else if (onEndLine) {
      if (left > end.x) continue;
      right = Math.min(right, end.x);
    }
    if (right - left <= 0.5) continue;
    covered.push({ x: left, y: item.y, width: right - left, height: item.height });
  }
  return mergeLineRects(covered);
}

/**
 * Merge rects that share a line and touch (or nearly touch) horizontally
 * into single line rects. Input order does not matter.
 */
export function mergeLineRects(rects: readonly PageRect[]): PageRect[] {
  if (rects.length <= 1) return [...rects];
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: PageRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.y - r.y) <= Math.max(last.height, r.height) * LINE_TOLERANCE_RATIO &&
      r.x - (last.x + last.width) <= MERGE_GAP_PT
    ) {
      const right = Math.max(last.x + last.width, r.x + r.width);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.height, r.y + r.height);
      last.x = Math.min(last.x, r.x);
      last.y = top;
      last.width = right - last.x;
      last.height = bottom - top;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** The text covered by a set of quads, for the panel preview label. Joins
 *  the intersecting portion of each item with a space between lines. */
export function textUnderQuads(
  items: readonly TextItemGeom[],
  quads: readonly PageRect[],
): string {
  const parts: string[] = [];
  for (const q of quads) {
    const lineParts: string[] = [];
    for (const item of items) {
      if (item.text.length === 0) continue;
      const overlapX = Math.min(item.x + item.width, q.x + q.width) - Math.max(item.x, q.x);
      const overlapY = Math.min(item.y + item.height, q.y + q.height) - Math.max(item.y, q.y);
      if (overlapX > 0 && overlapY > 0) {
        const t = item.text.trim();
        if (t.length > 0) lineParts.push(t);
      }
    }
    if (lineParts.length > 0) parts.push(lineParts.join(" "));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Drag geometry (shapes, pen)

/** Normalize a drag from-to pair into a bounding rect (either direction). */
export function normalizeDragRect(from: PagePoint, to: PagePoint): PageRect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Drags smaller than this (in page points) are treated as accidental. */
export const MIN_DRAG_PT = 3;

export function dragMeetsMinimum(from: PagePoint, to: PagePoint): boolean {
  return (
    Math.abs(to.x - from.x) >= MIN_DRAG_PT ||
    Math.abs(to.y - from.y) >= MIN_DRAG_PT
  );
}

// ---------------------------------------------------------------------------
// Overlay positioning: page points -> CSS px at the current scale

export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function overlayRectToCss(r: PageRect, scale: number): CssBox {
  return {
    left: r.x * scale,
    top: r.y * scale,
    width: r.width * scale,
    height: r.height * scale,
  };
}

export function overlayPointToCss(
  p: PagePoint,
  scale: number,
): { left: number; top: number } {
  return { left: p.x * scale, top: p.y * scale };
}

/** Convert a client (viewport) point into page points relative to the page
 *  wrapper element. Pure given the wrapper's client rect. */
export function clientToPagePoint(
  clientX: number,
  clientY: number,
  wrapperRect: { left: number; top: number },
  scale: number,
): PagePoint {
  return {
    x: (clientX - wrapperRect.left) / scale,
    y: (clientY - wrapperRect.top) / scale,
  };
}

// ---------------------------------------------------------------------------
// SVG helpers

/** Build an SVG path `d` for a freehand stroke. Single-point strokes get a
 *  tiny zero-length segment so round linecaps render a dot. */
export function inkPathD(points: readonly PagePoint[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${round2(first.x)} ${round2(first.y)}`;
  for (const p of rest) {
    d += ` L ${round2(p.x)} ${round2(p.y)}`;
  }
  if (points.length === 1) {
    d += ` L ${round2(first.x + 0.01)} ${round2(first.y)}`;
  }
  return d;
}

/** The two wing endpoints of an arrowhead at `to`, pointing away from
 *  `from`. `size` is the wing length in page points. Degenerate
 *  (zero-length) arrows return the tip itself twice. */
export function arrowHead(
  from: PagePoint,
  to: PagePoint,
  size: number,
): [PagePoint, PagePoint] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0.0001) {
    return [
      { x: to.x, y: to.y },
      { x: to.x, y: to.y },
    ];
  }
  const ux = dx / len;
  const uy = dy / len;
  // Wing angle: 28 degrees off the shaft.
  const angle = (28 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotate the unit vector pointing back along the shaft by +/- angle.
  const bx = -ux;
  const by = -uy;
  const w1 = { x: bx * cos - by * sin, y: bx * sin + by * cos };
  const w2 = { x: bx * cos + by * sin, y: -bx * sin + by * cos };
  return [
    { x: to.x + w1.x * size, y: to.y + w1.y * size },
    { x: to.x + w2.x * size, y: to.y + w2.y * size },
  ];
}

// ---------------------------------------------------------------------------
// Bounds (for flash highlight + panel scroll targeting)

/** Bounding box of an annotation in page points. */
export function annotationBounds(a: Annotation): PageRect {
  switch (a.kind) {
    case "highlight":
    case "underline":
    case "strikeout": {
      if (a.rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const r of a.rects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case "ink": {
      if (a.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of a.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pad = a.width / 2;
      return {
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + a.width,
        height: maxY - minY + a.width,
      };
    }
    case "textbox":
    case "rect":
    case "ellipse":
    case "callout":
      return (a.rect ?? (a as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0]) ?? { x: 0, y: 0, width: 0, height: 0 };
    case "arrow": {
      // Wire-shape arrows carry the endpoints in `points[0]`/`points[1]`.
      // Use them when `from`/`to` are missing so the bounds box is correct
      // after an IPC round-trip.
      const arr = a as typeof a & { points?: PagePoint[] | undefined };
      const from = a.from ?? arr.points?.[0];
      const to = a.to ?? arr.points?.[1];
      if (from === undefined || to === undefined) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      return normalizeDragRect(from, to);
    }
    case "note":
      // The note icon occupies a fixed 18x18 box with its top-left at the
      // anchor point.
      return { x: a.at.x, y: a.at.y, width: 18, height: 18 };
  }
}

/** Phase 12 — return the page-point on the rect's perimeter that is
 *  closest to `target` (typically the callout's anchor point). The
 *  arrow draws from this entry point to the anchor so the line is
 *  visually anchored to the box edge rather than crossing the box.
 *  When `target` lies inside the rect (anchor dropped on the box),
 *  the closest corner is returned (deterministic).
 *
 *  DEF-157 — when the anchor lies EXACTLY on the rect's perimeter
 *  (the pre-fix create path placed the box's top-left corner ON the
 *  anchor for the natural down-right drag), the raw closest-point
 *  computation returns the anchor itself and the leader line
 *  collapses to zero length. The final step slides the entry a few
 *  points along the perimeter in that case, so the shaft always has
 *  a visible (non-zero) length. */
export function calloutEntryPoint(rect: PageRect, target: PagePoint): PagePoint {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const corners: PagePoint[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  // Pick the corner closest to `target`. When the target is INSIDE
  // the rect the closest corner is still well-defined (4 finite
  // candidates), so the helper is total even for unusual anchor
  // placements.
  let best = corners[0];
  if (best === undefined) {
    return { x: cx, y: cy };
  }
  let bestD = Math.hypot(target.x - best.x, target.y - best.y);
  for (let i = 1; i < corners.length; i += 1) {
    const c = corners[i];
    if (c === undefined) continue;
    const d = Math.hypot(target.x - c.x, target.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // Nudge the entry point along the rect's edge so the line
  // approaches the anchor head-on rather than from the corner.
  // Skip if the target is inside the rect (corner-only mode).
  let entry: PagePoint;
  if (target.x < left || target.x > right || target.y < top || target.y > bottom) {
    // Choose which edge to slide along: pick the edge that's
    // closer to the target's perpendicular axis. For a target
    // above/below the rect, slide along the TOP/BOTTOM edge; for
    // a target to the left/right, slide along the LEFT/RIGHT edge.
    // This matches the "head-on arrow" visual: the entry point is
    // on the edge the anchor is most directly opposite.
    const distAbove = target.y < top ? top - target.y : Infinity;
    const distBelow = target.y > bottom ? target.y - bottom : Infinity;
    const distLeftOf = target.x < left ? left - target.x : Infinity;
    const distRightOf = target.x > right ? target.x - right : Infinity;
    const minSideDist = Math.min(
      distAbove,
      distBelow,
      distLeftOf,
      distRightOf,
    );
    if (minSideDist === distAbove) {
      // Slide along the TOP edge; clamp the x coordinate into the
      // rect's horizontal extent.
      const clampedX = Math.max(left, Math.min(right, target.x));
      entry = { x: clampedX, y: top };
    } else if (minSideDist === distBelow) {
      const clampedX = Math.max(left, Math.min(right, target.x));
      entry = { x: clampedX, y: bottom };
    } else if (minSideDist === distLeftOf) {
      const clampedY = Math.max(top, Math.min(bottom, target.y));
      entry = { x: left, y: clampedY };
    } else {
      // distRightOf
      const clampedY = Math.max(top, Math.min(bottom, target.y));
      entry = { x: right, y: clampedY };
    }
  } else {
    entry = best;
  }
  // DEF-157 — an anchor that lies exactly ON the perimeter makes the
  // raw entry coincide with it. Slide the entry a fixed distance
  // along the edge (toward the rect's centre) so the line is always
  // a visible, non-zero stub.
  const EPS = 0.01;
  if (Math.abs(entry.x - target.x) <= EPS && Math.abs(entry.y - target.y) <= EPS) {
    const NUDGE_PT = 6;
    const onTopEdge = Math.abs(entry.y - top) <= EPS;
    const onBottomEdge = Math.abs(entry.y - bottom) <= EPS;
    const onLeftEdge = Math.abs(entry.x - left) <= EPS;
    const onRightEdge = Math.abs(entry.x - right) <= EPS;
    const canSlideX = (onTopEdge || onBottomEdge) && rect.width >= NUDGE_PT * 2;
    const canSlideY = (onLeftEdge || onRightEdge) && rect.height >= NUDGE_PT * 2;
    if (canSlideX) {
      const dir = entry.x <= cx ? 1 : -1;
      entry = { x: Math.max(left, Math.min(right, entry.x + dir * NUDGE_PT)), y: entry.y };
    } else if (canSlideY) {
      const dir = entry.y <= cy ? 1 : -1;
      entry = { x: entry.x, y: Math.max(top, Math.min(bottom, entry.y + dir * NUDGE_PT)) };
    } else {
      // Tiny / degenerate box: shift diagonally toward the nearest
      // interior point so the stub is still visible.
      const insetX = Math.min(NUDGE_PT, Math.max(0, rect.width) / 2);
      const insetY = Math.min(NUDGE_PT, Math.max(0, rect.height) / 2);
      entry = {
        x: entry.x + (entry.x <= cx ? insetX : -insetX),
        y: entry.y + (entry.y <= cy ? insetY : -insetY),
      };
    }
  }
  return entry;
}

/** DEF-157 — the callout text-box rect for a create drag. The box is
 *  a default-sized box whose TOP-LEFT is the drag RELEASE point
 *  (`to`), clamped inside the page. Placing the box at the release
 *  point (not at the drag-rect corner) keeps the anchor (the drag
 *  START point) OUTSIDE the box for the natural drag directions, so
 *  `calloutEntryPoint` never collapses and the leader line is always
 *  a visible non-zero shaft. */
export function calloutBoxFor(
  to: PagePoint,
  minWidthPt: number,
  minHeightPt: number,
  pageWidthPt: number,
  pageHeightPt: number,
): PageRect {
  const box: PageRect = {
    x: to.x,
    y: to.y,
    width: minWidthPt,
    height: minHeightPt,
  };
  if (box.x < 0) box.x = 0;
  if (box.y < 0) box.y = 0;
  if (box.x + box.width > pageWidthPt) {
    box.width = Math.max(0, pageWidthPt - box.x);
  }
  if (box.y + box.height > pageHeightPt) {
    box.height = Math.max(0, pageHeightPt - box.y);
  }
  return box;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Unified selection geometry (DEF-154) — move / resize COMMITTED
// annotations from the page canvas. All helpers are pure so the unit
// tests can exercise them without a browser.

/** Shift a committed annotation by a page-point delta. Every geometry
 *  field moves as one unit (ink point maps, arrow endpoints, note
 *  anchors, box rects). The callout is the one exception (DEF-161):
 *  a box drag shifts ONLY `rect` — the arrow anchor stays fixed so
 *  the box and the arrow can be repositioned independently (use
 *  `moveCalloutAnchor` for the anchor-only drag). Wire-form
 *  fallbacks (`points`/`rects`) are respected exactly like the render
 *  path, so a round-tripped annotation moves correctly. */
export function moveAnnotation(a: Annotation, dxPt: number, dyPt: number): Annotation {
  const shift = (p: PagePoint): PagePoint => ({ x: p.x + dxPt, y: p.y + dyPt });
  switch (a.kind) {
    case "ink":
      return { ...a, points: a.points.map(shift) };
    case "arrow": {
      const arrow = a as typeof a & { points?: PagePoint[] | undefined };
      const from = a.from ?? arrow.points?.[0];
      const to = a.to ?? arrow.points?.[1];
      if (from === undefined || to === undefined) return a;
      return { ...a, from: shift(from), to: shift(to) };
    }
    case "note":
      return { ...a, at: shift(a.at) };
    case "textbox":
    case "rect":
    case "ellipse":
    case "callout": {
      const r =
        a.rect ?? (a as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0];
      if (r === undefined) return a;
      const shifted = { ...r, x: r.x + dxPt, y: r.y + dyPt };
      // DEF-161 — the callout's box and arrow move INDEPENDENTLY: a
      // BOX drag shifts only `rect`, the arrow anchor `at` stays
      // fixed (the arrow keeps pointing at its subject). The
      // opposite — moving only the anchor — is `moveCalloutAnchor`.
      return { ...a, rect: shifted };
    }
    default:
      return a;
  }
}

/** DEF-161 — move ONLY the callout's arrow anchor (`at`) by a
 *  page-point delta. The text-box `rect` stays fixed, so the box
 *  text stays put while the leader line re-aims at a new subject.
 *  Returns the annotation unchanged for non-callouts or when the
 *  anchor is missing (wire-shape fallback). */
export function moveCalloutAnchor(a: Annotation, dxPt: number, dyPt: number): Annotation {
  if (a.kind !== "callout") return a;
  const anchor = a.at;
  if (anchor === undefined) return a;
  return { ...a, at: { x: anchor.x + dxPt, y: anchor.y + dyPt } };
}

/** Resize a committed rect-carrying annotation (textbox, rect,
 *  ellipse, callout) to `newRect`. The callout's ARROW ANCHOR stays
 *  fixed — resizing the box does not drag the subject it points at.
 *  DEF-154 — ink and arrow are also resizable: their geometry
 *  (points / endpoints) is SCALED proportionally from the original
 *  bounds into `newRect` (a resize on a shape scales its geometry
 *  points). Notes return the annotation unchanged (the icon is a
 *  fixed 18pt surface; resizing it has no meaning). */
export function resizeAnnotation(
  a: Annotation,
  newRect: PageRect,
  pageWidthPt: number,
  pageHeightPt: number,
): Annotation {
  // Ink and arrow carry their shape in points rather than a rect.
  // Scale every point from the original bounds into `newRect`.
  if (a.kind === "ink" || a.kind === "arrow") {
    return scaleAnnotationPoints(a, newRect);
  }
  if (a.kind !== "textbox" && a.kind !== "rect" && a.kind !== "ellipse" && a.kind !== "callout") {
    return a;
  }
  const clamped: PageRect = {
    x: Math.max(0, Math.min(newRect.x, pageWidthPt)),
    y: Math.max(0, Math.min(newRect.y, pageHeightPt)),
    width: newRect.width,
    height: newRect.height,
  };
  return { ...a, rect: clamped };
}

/** Scale an ink stroke or arrow into `newRect`: every point is
 *  mapped proportionally from the annotation's current bounds into
 *  the new bounds (so dragging a corner handle stretches the whole
 *  shape, not just its bounding box). A zero-extent axis scales
 *  as 1:1 along that axis (a perfectly vertical/horizontal arrow
 *  keeps its degenerate axis's coordinate). */
function scaleAnnotationPoints(a: Annotation, newRect: PageRect): Annotation {
  const old = annotationBounds(a);
  const sx = old.width <= 0 ? 1 : newRect.width / old.width;
  const sy = old.height <= 0 ? 1 : newRect.height / old.height;
  const map = (p: PagePoint): PagePoint => ({
    x: newRect.x + (p.x - old.x) * sx,
    y: newRect.y + (p.y - old.y) * sy,
  });
  if (a.kind === "ink") {
    return { ...a, points: a.points.map(map) };
  }
  if (a.kind === "arrow") {
    // `from`/`to` may be absent only for a wire shape that survived
    // an IPC round-trip without the renderer blob; the backfilled
    // `points` array is then the source of truth.
    const arrow = a as typeof a & { points?: PagePoint[] | undefined };
    const from = a.from ?? arrow.points?.[0];
    const to = a.to ?? arrow.points?.[1];
    if (from === undefined || to === undefined) return a;
    return { ...a, from: map(from), to: map(to) };
  }
  return a;
}

/** Are two annotations' GEOMETRY fields equal (position + shape) — the
 *  echo-landed check the overlay uses to drop its local move-draft
 *  once the engine's create-echo carries the moved annotation. Ignores
 *  text / color / timestamps (a re-created annotation keeps the same
 *  id + createdAt, and its text may have been edited in the same
 *  commit). */
export function sameAnnotationGeometry(a: Annotation, b: Annotation): boolean {
  if (a.kind !== b.kind || a.page !== b.page) return false;
  const eqPt = (p: PagePoint, q: PagePoint): boolean => p.x === q.x && p.y === q.y;
  switch (a.kind) {
    case "ink": {
      if (b.kind !== "ink" || a.points.length !== b.points.length) return false;
      for (let i = 0; i < a.points.length; i += 1) {
        const p = a.points[i];
        const q = b.points[i];
        if (p === undefined || q === undefined || !eqPt(p, q)) return false;
      }
      return true;
    }
    case "arrow": {
      if (b.kind !== "arrow") return false;
      const ab = a as typeof a & { points?: PagePoint[] | undefined };
      const bb = b as typeof b & { points?: PagePoint[] | undefined };
      const af = a.from ?? ab.points?.[0];
      const at = a.to ?? ab.points?.[1];
      const bf = b.from ?? bb.points?.[0];
      const bt = b.to ?? bb.points?.[1];
      if (af === undefined || at === undefined || bf === undefined || bt === undefined) return false;
      return eqPt(af, bf) && eqPt(at, bt);
    }
    case "note": {
      if (b.kind !== "note") return false;
      return eqPt(a.at, b.at);
    }
    case "textbox":
    case "rect":
    case "ellipse":
    case "callout": {
      if (a.kind !== b.kind) return false;
      const ar = a.rect ?? (a as unknown as { rects?: PageRect[] }).rects?.[0];
      const br = b.rect ?? (b as unknown as { rects?: PageRect[] }).rects?.[0];
      if (ar === undefined || br === undefined) return false;
      const rectEqual =
        ar.x === br.x &&
        ar.y === br.y &&
        ar.width === br.width &&
        ar.height === br.height;
      if (!rectEqual) return false;
      // DEF-161 — the callout's arrow anchor is part of its geometry
      // (the box and arrow move independently), so an anchor-only
      // move must NOT be treated as "already echoed" while the engine
      // still carries the old `at`.
      if (a.kind === "callout") {
        const bCallout = b as typeof a & { at?: PagePoint };
        const aAt = a.at;
        const bAt = bCallout.at;
        if (aAt === undefined || bAt === undefined) return false;
        return eqPt(aAt, bAt);
      }
      return true;
    }
    default:
      return false;
  }
}
