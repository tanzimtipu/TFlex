// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Annotation } from "../../../src/renderer/annotations/model";
import {
  annotationBounds,
  arrowHead,
  arrowHeadBase,
  clientToPagePoint,
  dragMeetsMinimum,
  inkPathD,
  mergeLineRects,
  normalizeDragRect,
  overlayPointToCss,
  overlayRectToCss,
  textItemQuads,
  textUnderQuads,
  type TextItemGeom,
} from "../../../src/renderer/annotations/geometry";

describe("textItemQuads — markup quad math", () => {
  it("returns an empty list when the page has no text items", () => {
    expect(textItemQuads([], { x: 0, y: 0 }, { x: 10, y: 10 })).toEqual([]);
  });

  it("returns an empty list when the drag covers no text", () => {
    const items: TextItemGeom[] = [
      { x: 100, y: 100, width: 50, height: 10, text: "hello" },
    ];
    // Drag far above the line.
    expect(textItemQuads(items, { x: 0, y: 0 }, { x: 50, y: 5 })).toEqual([]);
  });

  it("clips to the start.x on the start line and to end.x on the end line", () => {
    const items: TextItemGeom[] = [
      { x: 100, y: 100, width: 80, height: 10, text: "Hello world" },
    ];
    const quads = textItemQuads(items, { x: 110, y: 105 }, { x: 140, y: 105 });
    expect(quads.length).toBe(1);
    expect(quads[0].x).toBeCloseTo(110, 5);
    expect(quads[0].width).toBeCloseTo(30, 5);
    expect(quads[0].y).toBeCloseTo(100, 5);
    expect(quads[0].height).toBeCloseTo(10, 5);
  });

  it("handles drag from a later point to an earlier one (either direction)", () => {
    const items: TextItemGeom[] = [
      { x: 100, y: 100, width: 80, height: 10, text: "Hello world" },
    ];
    // Drag right-to-left.
    const quads = textItemQuads(items, { x: 140, y: 105 }, { x: 110, y: 105 });
    expect(quads.length).toBe(1);
    expect(quads[0].x).toBeCloseTo(110, 5);
    expect(quads[0].width).toBeCloseTo(30, 5);
  });

  it("selects all items whose vertical band crosses the drag span", () => {
    const items: TextItemGeom[] = [
      { x: 100, y: 100, width: 80, height: 10, text: "line one" },
      { x: 100, y: 120, width: 80, height: 10, text: "line two" },
      { x: 100, y: 140, width: 80, height: 10, text: "line three" },
    ];
    // Drag from line one to line three inclusive.
    const quads = textItemQuads(items, { x: 110, y: 105 }, { x: 110, y: 145 });
    expect(quads.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty list when the drag is a single point on no text", () => {
    const items: TextItemGeom[] = [
      { x: 100, y: 100, width: 80, height: 10, text: "Hello" },
    ];
    const quads = textItemQuads(items, { x: 110, y: 105 }, { x: 110, y: 105 });
    expect(quads).toEqual([]);
  });
});

describe("mergeLineRects — line rect collapsing", () => {
  it("passes through a single rect unchanged", () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    const out = mergeLineRects([r]);
    expect(out).toEqual([r]);
  });

  it("merges horizontally adjacent rects on the same line", () => {
    const out = mergeLineRects([
      { x: 0, y: 100, width: 20, height: 10 },
      { x: 22, y: 100, width: 30, height: 10 },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].x).toBe(0);
    expect(out[0].width).toBe(52);
  });

  it("does not merge rects on different lines", () => {
    const out = mergeLineRects([
      { x: 0, y: 100, width: 20, height: 10 },
      { x: 0, y: 130, width: 20, height: 10 },
    ]);
    expect(out.length).toBe(2);
  });

  it("returns an empty list for an empty input", () => {
    expect(mergeLineRects([])).toEqual([]);
  });
});

describe("textUnderQuads — preview label text", () => {
  it("returns empty string when no items are covered", () => {
    const items: TextItemGeom[] = [
      { x: 0, y: 0, width: 20, height: 10, text: "A" },
    ];
    expect(textUnderQuads(items, [{ x: 100, y: 100, width: 50, height: 10 }])).toBe("");
  });

  it("joins overlapping items with a space", () => {
    const items: TextItemGeom[] = [
      { x: 0, y: 0, width: 20, height: 10, text: "Hello" },
      { x: 22, y: 0, width: 20, height: 10, text: "World" },
    ];
    const text = textUnderQuads(items, [
      { x: 0, y: 0, width: 60, height: 10 },
    ]);
    expect(text.toLowerCase()).toBe("hello world");
  });

  it("collapses whitespace-only items", () => {
    const items: TextItemGeom[] = [
      { x: 0, y: 0, width: 20, height: 10, text: "   " },
      { x: 22, y: 0, width: 20, height: 10, text: "Word" },
    ];
    const text = textUnderQuads(items, [
      { x: 0, y: 0, width: 60, height: 10 },
    ]);
    expect(text).toBe("Word");
  });
});

describe("normalizeDragRect / dragMeetsMinimum", () => {
  it("normalizeDragRect is direction-agnostic", () => {
    const a = normalizeDragRect({ x: 100, y: 50 }, { x: 30, y: 200 });
    expect(a).toEqual({ x: 30, y: 50, width: 70, height: 150 });
  });

  it("dragMeetsMinimum rejects tiny accidental drags", () => {
    expect(dragMeetsMinimum({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(dragMeetsMinimum({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(true);
    expect(dragMeetsMinimum({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(true);
  });
});

describe("overlay positioning — page points to CSS px", () => {
  it("overlayRectToCss scales every dimension by cssScale", () => {
    expect(
      overlayRectToCss({ x: 10, y: 20, width: 30, height: 40 }, 2),
    ).toEqual({ left: 20, top: 40, width: 60, height: 80 });
  });

  it("overlayRectToCss at scale 1 is the identity", () => {
    expect(overlayRectToCss({ x: 10, y: 20, width: 30, height: 40 }, 1)).toEqual({
      left: 10,
      top: 20,
      width: 30,
      height: 40,
    });
  });

  it("overlayPointToCss scales both axes", () => {
    expect(overlayPointToCss({ x: 5, y: 7 }, 1.5)).toEqual({ left: 7.5, top: 10.5 });
  });

  it("clientToPagePoint reverses the scale and subtracts the wrapper offset", () => {
    const p = clientToPagePoint(60, 80, { left: 10, top: 20 }, 2);
    expect(p).toEqual({ x: 25, y: 30 });
  });

  it("clientToPagePoint is the round-trip of overlayPointToCss", () => {
    const rect = { left: 12, top: 14 };
    const scale = 1.5;
    const pagePoint = { x: 30, y: 40 };
    const css = overlayPointToCss(pagePoint, scale);
    const back = clientToPagePoint(
      rect.left + css.left,
      rect.top + css.top,
      rect,
      scale,
    );
    expect(back.x).toBeCloseTo(pagePoint.x, 6);
    expect(back.y).toBeCloseTo(pagePoint.y, 6);
  });
});

describe("SVG / bounds helpers", () => {
  it("inkPathD emits a moveto + lineto sequence", () => {
    const d = inkPathD([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 10 },
    ]);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("L 10 5");
    expect(d).toContain("L 20 10");
  });

  it("inkPathD emits a zero-length segment for single-point strokes", () => {
    const d = inkPathD([{ x: 5, y: 5 }]);
    expect(d).toContain("M 5 5");
    // single-point strokes add a tiny line so round linecaps render a dot.
    expect(d).toMatch(/L 5\.01 5/);
  });

  it("inkPathD returns empty string for empty input", () => {
    expect(inkPathD([])).toBe("");
  });

  it("arrowHead returns the tip itself for degenerate (zero-length) arrows", () => {
    const [w1, w2] = arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 10);
    expect(w1).toEqual({ x: 5, y: 5 });
    expect(w2).toEqual({ x: 5, y: 5 });
  });

  it("arrowHead wings are symmetric about the shaft axis", () => {
    const [w1, w2] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    // Both wings should be 10pt from the tip.
    const d1 = Math.hypot(w1.x - 100, w1.y - 0);
    const d2 = Math.hypot(w2.x - 100, w2.y - 0);
    expect(d1).toBeCloseTo(10, 5);
    expect(d2).toBeCloseTo(10, 5);
    // And mirrored across the shaft (y of 0).
    expect(w1.y).toBeCloseTo(-w2.y, 5);
  });

  it("Phase 28 — arrowHeadBase is the midpoint of the two wings (the head's base centre)", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const [w1, w2] = arrowHead(from, to, 10);
    const base = arrowHeadBase(from, to, 10);
    expect(base.x).toBeCloseTo((w1.x + w2.x) / 2, 10);
    expect(base.y).toBeCloseTo((w1.y + w2.y) / 2, 10);
    // On the shaft axis for a horizontal arrow, backed off from the tip
    // by the head's axial length (size * cos 28deg).
    expect(base.y).toBeCloseTo(0, 10);
    expect(to.x - base.x).toBeCloseTo(10 * Math.cos((28 * Math.PI) / 180), 10);
    expect(base.x).toBeLessThan(to.x);
  });

  it("Phase 28 — arrowHeadBase tracks the shaft direction (diagonal arrow)", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 30, y: 40 };
    const base = arrowHeadBase(from, to, 9);
    // 5pt back along the unit vector (3/5, 4/5).
    const back = 9 * Math.cos((28 * Math.PI) / 180);
    expect(base.x).toBeCloseTo(30 - (3 / 5) * back, 10);
    expect(base.y).toBeCloseTo(40 - (4 / 5) * back, 10);
  });

  it("Phase 28 — arrowHeadBase returns the tip for degenerate (zero-length) arrows", () => {
    expect(arrowHeadBase({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual({ x: 5, y: 5 });
  });

  it("annotationBounds returns a zero-size rect for empty markup lists", () => {
    const a = {
      id: "x",
      kind: "highlight" as const,
      page: 1,
      color: "yellow" as const,
      createdAt: "2024-01-01",
      rects: [],
      text: "",
    };
    expect(annotationBounds(a)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("annotationBounds for ink pads by half the stroke width", () => {
    const a = {
      id: "x",
      kind: "ink" as const,
      page: 1,
      color: "blue" as const,
      createdAt: "2024-01-01",
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 20 },
      ],
      width: 4,
    };
    const b = annotationBounds(a);
    // x range: 30-10=20, plus width 4 -> 24; pad 2 on each side: 20+4=24
    expect(b.x).toBeCloseTo(8, 5);
    expect(b.y).toBeCloseTo(8, 5);
    expect(b.width).toBeCloseTo(24, 5);
    // y range: 20-10=10, plus width 4 -> 14
    expect(b.height).toBeCloseTo(14, 5);
  });

  it("annotationBounds for note returns the icon's 18x18 footprint", () => {
    const a = {
      id: "x",
      kind: "note" as const,
      page: 1,
      color: "yellow" as const,
      createdAt: "2024-01-01",
      at: { x: 12, y: 24 },
      text: "hello",
    };
    expect(annotationBounds(a)).toEqual({
      x: 12,
      y: 24,
      width: 18,
      height: 18,
    });
  });

  it("annotationBounds for arrow with from/to uses the endpoints (DEF-017)", () => {
    const a = {
      id: "x",
      kind: "arrow" as const,
      page: 1,
      color: "yellow" as const,
      createdAt: "2024-01-01",
      from: { x: 10, y: 20 },
      to: { x: 50, y: 80 },
    };
    expect(annotationBounds(a)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("annotationBounds for arrow falls back to points[0]/points[1] when from/to are missing (DEF-017)", () => {
    // Wire-shape arrows (returned by the engine) carry the two endpoints in
    // points[0]/points[1] instead of from/to. annotationBounds must still
    // compute the correct bbox so the flash highlight and panel-jump
    // targeting keep working after a save-as / reopen / undo.
    const a = {
      id: "x",
      kind: "arrow" as const,
      page: 1,
      color: "yellow" as const,
      createdAt: "2024-01-01",
      // The renderer's ArrowAnnotation has no `points` field, but the
      // wire-shape arrows from the engine do. Cast through unknown so the
      // test exercises the wire-shape fallback path.
      points: [
        { x: 5, y: 10 },
        { x: 25, y: 30 },
      ],
    } as unknown as Annotation;
    expect(annotationBounds(a)).toEqual({
      x: 5,
      y: 10,
      width: 20,
      height: 20,
    });
  });

  it("annotationBounds for arrow returns a zero-size rect when no geometry is present", () => {
    // Defense in depth: a malformed arrow with no from/to and no points
    // must not throw — it returns the zero-size rect, and the renderer's
    // per-annotation error boundary renders a tiny visible marker.
    const a: Annotation = {
      id: "x",
      kind: "arrow",
      page: 1,
      color: "yellow",
      createdAt: "2024-01-01",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
    };
    expect(annotationBounds(a)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
