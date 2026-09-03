// @vitest-environment jsdom
// DEF-144 — a thin drawn signature rendered as a thick black filled
// blob in the ghost / placed view because the SVG stroke width was
// DIVIDED by the scale factor (`DRAW_PEN_WIDTH / min(sx, sy)`) instead
// of multiplied. For the 360x120 draw canvas scaled into a 64x22
// placement that produced ~13.5-unit strokes in a 64-unit box. The fix
// makes the stroke scale WITH the points (`scaledStrokeWidth`), which
// the SVG raster (ghost + placed) and the PNG bake both use.
import { describe, expect, it } from "vitest";
import {
  DRAW_PEN_WIDTH,
  scaledStrokeWidth,
} from "../../../src/renderer/signatures/canvas";

describe("DEF-144 — drawn-signature stroke width scales with the points", () => {
  it("multiplies the pen width by the smaller axis scale (thin stroke stays thin)", () => {
    // 360x120 draw canvas -> 64x22 placement (the DEF-144 repro sizes).
    const w = scaledStrokeWidth(360, 120, 64, 22);
    expect(w).toBeCloseTo(DRAW_PEN_WIDTH * (64 / 360), 3);
    // A thin stroke, NOT the buggy divide-by-scale thick blob.
    expect(w).toBeLessThan(DRAW_PEN_WIDTH);
    expect(w).toBeLessThan(1);
  });

  it("preserves the pen width when the target matches the source size", () => {
    expect(scaledStrokeWidth(360, 120, 360, 120)).toBe(DRAW_PEN_WIDTH);
  });

  it("thickens proportionally for an enlarged target", () => {
    const w = scaledStrokeWidth(360, 120, 720, 240);
    expect(w).toBeCloseTo(DRAW_PEN_WIDTH * 2, 3);
  });

  it("stays strictly proportional even for extreme downscale (no floor)", () => {
    const w = scaledStrokeWidth(360, 120, 60, 20);
    expect(w).toBeCloseTo(DRAW_PEN_WIDTH * (60 / 360), 3);
  });

  it("falls back to the pen width for degenerate source sizes", () => {
    expect(scaledStrokeWidth(0, 120, 64, 22)).toBe(DRAW_PEN_WIDTH);
    expect(scaledStrokeWidth(360, 0, 64, 22)).toBe(DRAW_PEN_WIDTH);
  });
});
