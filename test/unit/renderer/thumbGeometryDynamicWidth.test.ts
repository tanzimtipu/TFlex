// Phase 32 (chunk 2b) — the pure dynamic thumbnail-width rule.
//
// The Multi Mode shared rail holds one section per loaded document, so
// the rail's thumbnails must shrink as documents are added while the
// single-mode rail keeps today's exact width. This is pure math, tested
// without a renderer.

import { describe, expect, it } from "vitest";
import {
  computeThumbWidth,
  THUMB_FIT_INSET_PX,
  THUMB_MIN_WIDTH,
  THUMB_WIDTH,
} from "../../../src/renderer/components/thumbGeometry";

/** The shared rail's own width (SHARED_RAIL_WIDTH_PX). */
const RAIL_W = 220;

describe("computeThumbWidth - single mode is today's value", () => {
  it("returns THUMB_WIDTH (126) for one document on a wide enough rail", () => {
    expect(computeThumbWidth(RAIL_W, 1)).toBe(THUMB_WIDTH);
    expect(computeThumbWidth(RAIL_W, 1)).toBe(126);
    // DEF-347 - the single-mode rail is 184px, well past the fit line.
    expect(computeThumbWidth(184, 1)).toBe(THUMB_WIDTH);
  });

  it("caps a single document to the real content box on a narrow rail (DEF-347)", () => {
    // A 150px Multi Mode strip: the preview must sit inside its page row.
    expect(computeThumbWidth(150, 1)).toBe(150 - THUMB_FIT_INSET_PX);
    expect(computeThumbWidth(150, 1)).toBeLessThan(THUMB_WIDTH);
    expect(computeThumbWidth(150, 1) + THUMB_FIT_INSET_PX).toBeLessThanOrEqual(150);
    // A degenerate width floors at the minimum hit target (never zero).
    expect(computeThumbWidth(0, 1)).toBe(THUMB_MIN_WIDTH);
  });

  it("treats a missing/absurd document count as one document", () => {
    expect(computeThumbWidth(RAIL_W, 0)).toBe(126);
    expect(computeThumbWidth(RAIL_W, -3)).toBe(126);
    expect(computeThumbWidth(RAIL_W, Number.NaN)).toBe(126);
    expect(computeThumbWidth(RAIL_W, 0.4)).toBe(126);
  });
});

describe("computeThumbWidth - two documents are smaller but comfortable", () => {
  it("returns the smaller two-document width (89) at the rail's real width", () => {
    const two = computeThumbWidth(RAIL_W, 2);
    expect(two).toBe(89);
    expect(two).toBeLessThan(THUMB_WIDTH);
    // A comfortable hit target, above the declared minimum.
    expect(two).toBeGreaterThanOrEqual(THUMB_MIN_WIDTH);
  });

  it("never grows back to the single-mode width as documents are added", () => {
    const widths = [1, 2, 3, 4, 6].map((n) => computeThumbWidth(RAIL_W, n));
    expect(widths[0]).toBe(126);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    }
  });
});

describe("computeThumbWidth - the minimum hit target is respected", () => {
  it("floors at THUMB_MIN_WIDTH when the per-document share would be smaller", () => {
    expect(THUMB_MIN_WIDTH).toBe(84);
    expect(computeThumbWidth(RAIL_W, 3)).toBe(84);
    expect(computeThumbWidth(RAIL_W, 12)).toBe(84);
  });

  it("floors at the minimum even when the rail is narrower than the minimum", () => {
    expect(computeThumbWidth(60, 2)).toBe(THUMB_MIN_WIDTH);
  });
});

describe("computeThumbWidth - a degenerate rail width is never zero/negative", () => {
  it("stays positive for zero, negative, NaN and fractional widths", () => {
    for (const width of [0, -5, -1000, Number.NaN, 0.5, 1]) {
      const value = computeThumbWidth(width, 2);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeGreaterThanOrEqual(THUMB_MIN_WIDTH);
      expect(value).toBeLessThanOrEqual(THUMB_WIDTH);
    }
  });

  it("uses the rail width as a cap when the rail is only just wide enough", () => {
    // DEF-347 - the cap now charges the full fit inset (scroller chrome +
    // the thumb slot's own padding/border/scrollbar), so a 100px rail
    // cannot hold the 89px two-document thumb: it floors at the minimum.
    expect(computeThumbWidth(100, 2)).toBe(84);
    expect(computeThumbWidth(200, 2)).toBe(89);
  });
});
