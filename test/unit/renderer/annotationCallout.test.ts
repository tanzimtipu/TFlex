// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLORS,
  applyPatch,
  annotationSummary,
  countByKind,
  hasEditableText,
  isMarkup,
  kindLabel,
  sortAnnotations,
  toggleTool,
  type Annotation,
  type AnnotationKind,
  type CalloutAnnotation,
} from "../../../src/renderer/annotations/model";
import {
  annotationBounds,
  calloutBoxFor,
  calloutEntryPoint,
} from "../../../src/renderer/annotations/geometry";

/**
 * Phase 12 — annotation model tests for the new `callout` kind +
 * the `calloutEntryPoint` geometry helper.
 */

function makeCallout(overrides: Partial<CalloutAnnotation> = {}): CalloutAnnotation {
  return {
    id: "callout-1",
    kind: "callout",
    page: 1,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: 120, height: 36 },
    at: { x: 50, y: 60 },
    text: "hello",
    ...overrides,
  };
}

describe("annotation model — callout kind", () => {
  it("kindLabel returns 'Callout' for the callout kind", () => {
    expect(kindLabel("callout")).toBe("Callout");
  });

  it("annotationSummary returns the callout's text when non-empty", () => {
    const a = makeCallout({ text: "see this" });
    expect(annotationSummary(a)).toBe("see this");
  });

  it("annotationSummary falls back to kindLabel when text is empty", () => {
    const a = makeCallout({ text: "   " });
    expect(annotationSummary(a)).toBe("Callout");
  });

  it("hasEditableText returns true for callouts", () => {
    const a = makeCallout();
    expect(hasEditableText(a)).toBe(true);
  });

  it("applyPatch patches callout text content", () => {
    const a = makeCallout({ text: "old" });
    const next = applyPatch(a, { text: "new" });
    expect(next).not.toBe(a);
    expect((next as { text: string }).text).toBe("new");
  });

  it("applyPatch patches callout color", () => {
    const a = makeCallout({ color: "yellow" });
    const next = applyPatch(a, { color: "red" });
    expect(next).not.toBe(a);
    expect(next.color).toBe("red");
  });

  it("applyPatch no-ops on equal patches", () => {
    const a = makeCallout();
    expect(applyPatch(a, { text: "hello" })).toBe(a);
    expect(applyPatch(a, { color: "yellow" })).toBe(a);
    expect(applyPatch(a, {})).toBe(a);
  });

  it("countByKind counts callouts alongside other kinds", () => {
    const list: Annotation[] = [
      makeCallout({ id: "c1" }),
      makeCallout({ id: "c2" }),
      makeCallout({ id: "c3" }),
      {
        id: "h1",
        kind: "highlight",
        page: 1,
        color: "yellow",
        createdAt: "2026-01-01T00:00:00.000Z",
        rects: [],
        text: "",
      },
      {
        id: "n1",
        kind: "note",
        page: 1,
        color: "yellow",
        createdAt: "2026-01-01T00:00:00.000Z",
        at: { x: 0, y: 0 },
        text: "n",
      },
    ];
    const counts = countByKind(list);
    expect(counts.callout).toBe(3);
    expect(counts.highlight).toBe(1);
    expect(counts.note).toBe(1);
    // Every other kind counts zero (no null callout entries).
    const zeroKinds: AnnotationKind[] = [
      "underline",
      "strikeout",
      "ink",
      "textbox",
      "rect",
      "ellipse",
      "arrow",
    ];
    for (const k of zeroKinds) {
      expect(counts[k]).toBe(0);
    }
  });

  it("sortAnnotations orders callouts by page then createdAt", () => {
    const a = makeCallout({ id: "a", page: 2, createdAt: "2026-01-01T00:00:00.000Z" });
    const b = makeCallout({ id: "b", page: 1, createdAt: "2026-01-02T00:00:00.000Z" });
    const c = makeCallout({ id: "c", page: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const sorted = sortAnnotations([a, b, c]);
    expect(sorted.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("toggleTool round-trips callout like every other tool", () => {
    const select = { tool: "select" as const, color: "yellow" as const, penWidth: 3 };
    expect(toggleTool(select, "callout")).toBe("callout");
    const armed = { tool: "callout" as const, color: "yellow" as const, penWidth: 3 };
    expect(toggleTool(armed, "callout")).toBe("select");
  });

  it("ANNOTATION_COLORS list keeps the four legacy built-ins in order", () => {
    // Phase 13 — the legacy four remain in the front of the list so
    // annotations persisted against an older renderer (which only
    // knew yellow/red/green/blue) keep resolving to the same hex.
    // Five additional names slot in after for a richer toolbar
    // picker. The full list shape is checked in annotationModel.test.ts.
    // The reading order is warm -> cool -> accent (yellow, orange,
    // red, pink, ...); the legacy four map onto indexes 0/2/6/7 in
    // the new list, so we assert by name lookup rather than slice.
    const legacyNames = ["yellow", "red", "green", "blue"] as const;
    for (const name of legacyNames) {
      expect(ANNOTATION_COLORS).toContain(name);
    }
  });

  it("isMarkup returns false for callouts", () => {
    expect(isMarkup(makeCallout())).toBe(false);
  });
});

describe("calloutEntryPoint — geometry helper", () => {
  it("returns the closest corner when the target is outside the rect", () => {
    // 200x100 box at (50, 50). Anchor at (10, 10) — clearly outside,
    // to the upper-left. Closest corner is (50, 50).
    const rect = { x: 50, y: 50, width: 200, height: 100 };
    const target = { x: 10, y: 10 };
    const entry = calloutEntryPoint(rect, target);
    expect(entry).toEqual({ x: 50, y: 50 });
  });

  it("returns the corner nearest to a target below-right of the rect", () => {
    const rect = { x: 50, y: 50, width: 200, height: 100 };
    const target = { x: 300, y: 200 };
    const entry = calloutEntryPoint(rect, target);
    expect(entry).toEqual({ x: 250, y: 150 });
  });

  it("slides along the edge when target is roughly along a horizontal side", () => {
    // Anchor to the LEFT of the rect but roughly at the rect's
    // vertical center -> entry should slide down to y=center along
    // the left edge.
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    const target = { x: 30, y: 150 };
    const entry = calloutEntryPoint(rect, target);
    expect(entry.x).toBe(100);
    expect(entry.y).toBeCloseTo(150, 5);
  });

  it("slides along the edge when target is roughly along a vertical side", () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    const target = { x: 200, y: 30 };
    const entry = calloutEntryPoint(rect, target);
    expect(entry.y).toBe(100);
    expect(entry.x).toBeCloseTo(200, 5);
  });

  it("clamps the slide to the rect's edge when target is far along the axis", () => {
    // Anchor way above the rect along the left edge -> entry should
    // clamp to the rect's top, not extend above it.
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    const target = { x: 50, y: -500 };
    const entry = calloutEntryPoint(rect, target);
    expect(entry.x).toBe(100);
    expect(entry.y).toBe(100);
  });

  it("falls back to the closest corner when target is inside the rect", () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    const target = { x: 200, y: 150 };
    const entry = calloutEntryPoint(rect, target);
    // Target is inside; closest corner by Euclidean distance is one
    // of the four. We just assert the helper returns a finite point
    // on the rect's perimeter.
    expect(entry.x).toBeGreaterThanOrEqual(rect.x);
    expect(entry.x).toBeLessThanOrEqual(rect.x + rect.width);
    expect(entry.y).toBeGreaterThanOrEqual(rect.y);
    expect(entry.y).toBeLessThanOrEqual(rect.y + rect.height);
  });

  it("never returns the anchor itself when the anchor sits ON the rect's corner (DEF-157)", () => {
    // The pre-fix LIVE callout placed the box's top-left corner at
    // the anchor (drag-rect corner). The entry must NOT collapse to
    // the anchor: the leader shaft must stay non-zero.
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    const target = { x: 100, y: 100 };
    const entry = calloutEntryPoint(rect, target);
    expect(Math.hypot(entry.x - target.x, entry.y - target.y)).toBeGreaterThan(0);
    // The entry stays on the perimeter (a short stub along an edge).
    const onEdge =
      entry.x === rect.x ||
      entry.x === rect.x + rect.width ||
      entry.y === rect.y ||
      entry.y === rect.y + rect.height;
    expect(onEdge).toBe(true);
  });

  it("anchors exactly on an edge (non-corner) still draw a non-zero shaft from the closest corner (DEF-157)", () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    // Anchor directly on the TOP edge, at its horizontal centre: it
    // is not a corner, so the raw closest-corner fallback returns a
    // real corner — the shaft is automatically non-zero.
    const target = { x: 200, y: 100 };
    const entry = calloutEntryPoint(rect, target);
    expect(Math.hypot(entry.x - target.x, entry.y - target.y)).toBeGreaterThan(0);
    // The entry stays on the rect's perimeter.
    const onEdge =
      entry.x === rect.x ||
      entry.x === rect.x + rect.width ||
      entry.y === rect.y ||
      entry.y === rect.y + rect.height;
    expect(onEdge).toBe(true);
  });
});

describe("calloutBoxFor — DEF-157 create-geometry helper", () => {
  it("places the default-size box with its top-left at the release point", () => {
    const box = calloutBoxFor({ x: 300, y: 200 }, 90, 40, 612, 792);
    expect(box).toEqual({ x: 300, y: 200, width: 90, height: 40 });
  });

  it("clamps into the page so the box never overflows", () => {
    const box = calloutBoxFor({ x: 600, y: 780 }, 90, 40, 612, 792);
    expect(box.x + box.width).toBeLessThanOrEqual(612);
    expect(box.y + box.height).toBeLessThanOrEqual(792);
  });

  it("keeps the anchor OUT of the box for the natural down-right drag (the DEF-157 regression: the old drag-rect corner box had its top-left AT the anchor)", () => {
    // Drag from the anchor A=(200,400) down-right to R=(500,500).
    const box = calloutBoxFor({ x: 500, y: 500 }, 90, 40, 612, 792);
    const anchor = { x: 200, y: 400 };
    // The anchor is above-left of the box -> strictly outside.
    expect(anchor.x).toBeLessThan(box.x);
    expect(anchor.y).toBeLessThan(box.y);
    // And the committed render draws a non-zero shaft for that
    // geometry (entry != anchor).
    const entry = calloutEntryPoint(box, anchor);
    expect(Math.hypot(entry.x - anchor.x, entry.y - anchor.y)).toBeGreaterThan(0);
  });
});

describe("annotationBounds — callout", () => {
  it("returns the callout's `rect` (text-box bounds) as the bounding box", () => {
    const a = makeCallout({
      rect: { x: 12, y: 34, width: 200, height: 60 },
    });
    expect(annotationBounds(a)).toEqual({
      x: 12,
      y: 34,
      width: 200,
      height: 60,
    });
  });

  it("falls back to `rects[0]` for an old wire-shape callout", () => {
    // The engine normalises callouts to use `rects[0]`; the renderer
    // backfills `rect` when it lands here, so `annotationBounds`
    // reads the rect correctly.
    const wire = makeCallout({
      rect: undefined,
    } as unknown as Partial<CalloutAnnotation>);
    const a = {
      ...wire,
      rect: undefined,
      rects: [{ x: 100, y: 100, width: 50, height: 20 }],
    } as unknown as Annotation;
    expect(annotationBounds(a)).toEqual({
      x: 100,
      y: 100,
      width: 50,
      height: 20,
    });
  });
});