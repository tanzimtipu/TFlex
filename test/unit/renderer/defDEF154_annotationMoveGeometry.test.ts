// @vitest-environment node
//
// DEF-154 — pure geometry for the committed-annotation selection
// model: moveAnnotation / resizeAnnotation / sameAnnotationGeometry.
// All helpers are DOM-free and operate in page points (top-left
// origin), matching the annotation model.

import { describe, expect, it } from "vitest";
import {
  moveAnnotation,
  moveCalloutAnchor,
  resizeAnnotation,
  sameAnnotationGeometry,
} from "../../../src/renderer/annotations/geometry";
import type { Annotation } from "../../../src/renderer/annotations/model";

const RECT: Annotation = {
  id: "r1", kind: "rect", page: 1, color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const INK: Annotation = {
  id: "i1", kind: "ink", page: 1, color: "red",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 15 }],
  width: 3,
};

const ARROW: Annotation = {
  id: "a1", kind: "arrow", page: 1, color: "green",
  createdAt: "2026-01-01T00:00:00.000Z",
  from: { x: 50, y: 50 },
  to: { x: 200, y: 120 },
};

const NOTE: Annotation = {
  id: "n1", kind: "note", page: 1, color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 60, y: 300 },
  text: "hi",
};

const CALLOUT: Annotation = {
  id: "c1", kind: "callout", page: 1, color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 300, y: 200, width: 120, height: 50 },
  at: { x: 100, y: 100 },
  text: "call",
};

describe("moveAnnotation — every kind shifts as one unit", () => {
  it("shifts a rect-carrying annotation by the page-point delta", () => {
    const moved = moveAnnotation(RECT, 40, 20) as typeof RECT;
    expect(moved.rect).toEqual({ x: 140, y: 120, width: 150, height: 80 });
    expect(moved.id).toBe("r1");
  });

  it("shifts every ink point", () => {
    const moved = moveAnnotation(INK, 5, -5) as typeof INK;
    expect(moved.points).toEqual([
      { x: 15, y: 5 },
      { x: 25, y: 15 },
      { x: 35, y: 10 },
    ]);
  });

  it("shifts both arrow endpoints", () => {
    const moved = moveAnnotation(ARROW, 10, 10) as typeof ARROW;
    expect(moved.from).toEqual({ x: 60, y: 60 });
    expect(moved.to).toEqual({ x: 210, y: 130 });
  });

  it("shifts the note anchor", () => {
    const moved = moveAnnotation(NOTE, -10, 20) as typeof NOTE;
    expect(moved.at).toEqual({ x: 50, y: 320 });
  });

  it("shifts the callout box but keeps the anchor FIXED (DEF-161: the box and arrow move independently)", () => {
    const moved = moveAnnotation(CALLOUT, 10, 0) as typeof CALLOUT;
    expect(moved.rect).toEqual({ x: 310, y: 200, width: 120, height: 50 });
    expect(moved.at).toEqual({ x: 100, y: 100 });
  });
});

describe("moveCalloutAnchor — DEF-161 anchor-only drag", () => {
  it("shifts ONLY the callout's arrow anchor; the box rect stays put", () => {
    const moved = moveCalloutAnchor(CALLOUT, 15, -20) as typeof CALLOUT;
    expect(moved.at).toEqual({ x: 115, y: 80 });
    expect(moved.rect).toEqual({ x: 300, y: 200, width: 120, height: 50 });
  });

  it("is a no-op for non-callout annotations", () => {
    expect(moveCalloutAnchor(RECT, 5, 5)).toBe(RECT);
    expect(moveCalloutAnchor(ARROW, 5, 5)).toBe(ARROW);
  });

  it("keeps the annotation's identity fields intact (same id/page/color/text)", () => {
    const moved = moveCalloutAnchor(CALLOUT, 1, 2) as typeof CALLOUT;
    expect(moved.id).toBe("c1");
    expect(moved.page).toBe(1);
    expect(moved.kind).toBe("callout");
    expect(moved.color).toBe("blue");
    expect(moved.text).toBe("call");
  });
});

describe("resizeAnnotation — rect-carrying kinds + scaled ink/arrow", () => {
  it("resizes a rect to the new bounds", () => {
    const resized = resizeAnnotation(RECT, { x: 90, y: 90, width: 200, height: 100 }, 612, 792) as typeof RECT;
    expect(resized.rect).toEqual({ x: 90, y: 90, width: 200, height: 100 });
  });

  it("keeps the callout anchor fixed while the box resizes", () => {
    const resized = resizeAnnotation(CALLOUT, { x: 300, y: 200, width: 160, height: 70 }, 612, 792) as typeof CALLOUT;
    expect(resized.rect).toEqual({ x: 300, y: 200, width: 160, height: 70 });
    expect(resized.at).toEqual({ x: 100, y: 100 });
  });

  it("scales every ink point proportionally from the old bounds into the new bounds (DEF-154)", () => {
    // INK bounds: minX=10, maxX=30, minY=10, maxY=20 padded by
    // width/2=1.5 each side -> {8.5, 8.5, 23, 13}. New rect keeps the
    // origin but doubles the extent.
    const resized = resizeAnnotation(INK, { x: 8.5, y: 8.5, width: 46, height: 26 }, 612, 792) as typeof INK;
    const expected = {
      x: 8.5 + (10 - 8.5) * 2,
      y: 8.5 + (10 - 8.5) * 2,
    };
    expect(resized.points[0]?.x).toBeCloseTo(expected.x, 5);
    expect(resized.points[0]?.y).toBeCloseTo(expected.y, 5);
    // Point (30, 15) maps to the new right edge.
    expect(resized.points[2]?.x).toBeCloseTo(8.5 + (30 - 8.5) * 2, 5);
    expect(resized.points[2]?.y).toBeCloseTo(8.5 + (15 - 8.5) * 2, 5);
    expect(resized.width).toBe(3);
  });

  it("scales both arrow endpoints proportionally into the new bounds (DEF-154)", () => {
    // ARROW bounds = {50, 50, 150, 70}. Scale into {50, 50, 300, 140}
    // (2x each axis) anchored at the same origin.
    const resized = resizeAnnotation(ARROW, { x: 50, y: 50, width: 300, height: 140 }, 612, 792) as typeof ARROW;
    expect(resized.from).toEqual({ x: 50, y: 50 });
    expect(resized.to).toEqual({ x: 50 + (200 - 50) * 2, y: 50 + (120 - 50) * 2 });
  });

  it("is a no-op for the note (fixed marker icon)", () => {
    expect(resizeAnnotation(NOTE, { x: 0, y: 0, width: 10, height: 10 }, 612, 792)).toBe(NOTE);
  });

  it("clamps inside the page", () => {
    const resized = resizeAnnotation(RECT, { x: -50, y: 7000, width: 800, height: 200 }, 612, 792) as typeof RECT;
    expect(resized.rect.x).toBe(0);
    expect(resized.rect.y).toBe(792);
  });
});

describe("sameAnnotationGeometry — the echo-landed check", () => {
  it("is true when the draft and the engine echo carry identical geometry", () => {
    const moved = moveAnnotation(RECT, 40, 20);
    expect(sameAnnotationGeometry(moved, moveAnnotation(RECT, 40, 20))).toBe(true);
  });

  it("is false when the positions differ", () => {
    const moved = moveAnnotation(RECT, 40, 20);
    expect(sameAnnotationGeometry(moved, RECT)).toBe(false);
  });

  it("is true for ink when every point matches, regardless of color/text", () => {
    const moved = moveAnnotation(INK, 2, 2);
    const echo: Annotation = { ...moved, color: "purple" };
    expect(sameAnnotationGeometry(moved, echo)).toBe(true);
  });

  it("is false for different kinds / different pages", () => {
    expect(sameAnnotationGeometry(RECT, INK)).toBe(false);
    const otherPage = moveAnnotation(RECT, 10, 0);
    expect(sameAnnotationGeometry(RECT, { ...otherPage, page: 2 })).toBe(false);
  });

  it("round-trips through the wire fallbacks (rects[0] shape)", () => {
    // After an IPC round-trip the renderer model is backfilled by
    // annotationFromWire, but the geometry comparator must also
    // tolerate the raw wire shape (rects[0] instead of rect).
    const wire = { ...RECT, rect: undefined, rects: [{ x: 140, y: 120, width: 150, height: 80 }] };
    const moved = moveAnnotation(RECT, 40, 20);
    expect(sameAnnotationGeometry(
      moved,
      wire as unknown as Annotation,
    )).toBe(true);
  });

  it("is true for a callout when the box AND the anchor both match", () => {
    const moved = moveAnnotation(CALLOUT, 10, 0);
    expect(sameAnnotationGeometry(moved, moveAnnotation(CALLOUT, 10, 0))).toBe(true);
  });

  it("is FALSE for a callout whose box matches but whose anchor differs (DEF-161 anchor-only move)", () => {
    // The box drag leaves `at` fixed; an anchor drag changes only
    // `at`. Two annotations with the same rect but different anchors
    // are NOT the same geometry.
    const movedBox = moveAnnotation(CALLOUT, 10, 0) as typeof CALLOUT;
    const movedAnchor = { ...movedBox, at: { x: 110, y: 105 } } as typeof CALLOUT;
    expect(movedBox.rect).toEqual(movedAnchor.rect);
    expect(movedBox.at).not.toEqual(movedAnchor.at);
    expect(sameAnnotationGeometry(movedBox, movedAnchor)).toBe(false);
  });

  it("is true when an anchor-only move echoes back the same `at` (the draft-drop check)", () => {
    const moved = moveCalloutAnchor(CALLOUT, 8, 12);
    expect(sameAnnotationGeometry(moved, moveCalloutAnchor(CALLOUT, 8, 12))).toBe(true);
  });
});