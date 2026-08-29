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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
