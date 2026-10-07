// TFL-1116 (R03 chunk C3) — pure unit coverage for the shared collision-aware
// overlay placement. No DOM: `placeOverlay` is pure math, so every edge case is
// pinned to an exact numeric output.

import { describe, expect, it } from "vitest";
import {
  OVERLAY_VIEWPORT_GAP,
  placeOverlay,
  type OverlayAnchor,
} from "../../../src/renderer/components/overlayPlacement";

function anchor(left: number, top: number, right: number, bottom: number): OverlayAnchor {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

describe("TFL-1116 — placeOverlay", () => {
  it("(a) places below when it fits, clamped to the gutter", () => {
    const placement = placeOverlay({
      anchor: anchor(100, 100, 200, 130),
      size: { width: 232, height: 300 },
      viewport: { width: 1000, height: 800 },
    });
    expect(placement).toEqual({
      left: 100,
      top: 138,
      maxHeight: 654,
      maxWidth: 984,
      placement: "below",
      align: "start",
    });
  });

  it("(b) flips above near the bottom edge", () => {
    const placement = placeOverlay({
      anchor: anchor(100, 350, 200, 380),
      size: { width: 232, height: 300 },
      viewport: { width: 1000, height: 400 },
    });
    expect(placement.placement).toBe("above");
    expect(placement.top).toBe(42);
    expect(placement.maxHeight).toBe(334);
  });

  it("(c) start aligns the left edge; end aligns the right edge", () => {
    const start = placeOverlay({
      anchor: anchor(300, 100, 400, 130),
      size: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
      align: "start",
    });
    expect(start.left).toBe(300);
    expect(start.align).toBe("start");

    const end = placeOverlay({
      anchor: anchor(300, 100, 400, 130),
      size: { width: 200, height: 200 },
      viewport: { width: 1000, height: 800 },
      align: "end",
    });
    expect(end.left).toBe(200);
    expect(end.align).toBe("end");
  });

  it("(d) shifts an end-aligned box left so it stays inside the right gutter", () => {
    const placement = placeOverlay({
      anchor: anchor(900, 100, 1000, 130),
      size: { width: 232, height: 200 },
      viewport: { width: 1000, height: 800 },
      align: "end",
    });
    expect(placement.left).toBe(760);
    expect(placement.left + 232).toBe(1000 - OVERLAY_VIEWPORT_GAP);

    const startShift = placeOverlay({
      anchor: anchor(900, 100, 1000, 130),
      size: { width: 232, height: 200 },
      viewport: { width: 1000, height: 800 },
      align: "start",
    });
    expect(startShift.left).toBe(760);
  });

  it("(e) bounds maxWidth and maxHeight to the viewport with the gutter", () => {
    const placement = placeOverlay({
      anchor: anchor(100, 200, 200, 240),
      size: { width: 900, height: 900 },
      viewport: { width: 600, height: 500 },
    });
    expect(placement.maxWidth).toBe(600 - 2 * OVERLAY_VIEWPORT_GAP);
    expect(placement.maxHeight).toBe(244);
    expect(placement.left).toBe(OVERLAY_VIEWPORT_GAP);
    expect(placement.top).toBe(OVERLAY_VIEWPORT_GAP);
  });

  it("(f) pins an oversized box to the leading gap and never returns negatives", () => {
    const placement = placeOverlay({
      anchor: anchor(150, 10, 260, 40),
      size: { width: 400, height: 300 },
      viewport: { width: 200, height: 120 },
    });
    expect(placement.left).toBe(OVERLAY_VIEWPORT_GAP);
    expect(placement.top).toBe(OVERLAY_VIEWPORT_GAP);
    expect(placement.maxWidth).toBe(184);
    expect(placement.maxHeight).toBe(64);
    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(0);
    expect(placement.maxWidth).toBeGreaterThanOrEqual(0);
  });

  it("clamps maxHeight between minHeight and maxHeightCap", () => {
    const capped = placeOverlay({
      anchor: anchor(100, 100, 200, 130),
      size: { width: 232, height: 300 },
      viewport: { width: 1000, height: 800 },
      minHeight: 160,
      maxHeightCap: 560,
    });
    expect(capped.maxHeight).toBe(560);

    const floored = placeOverlay({
      anchor: anchor(100, 60, 200, 190),
      size: { width: 232, height: 50 },
      viewport: { width: 1000, height: 200 },
      minHeight: 40,
      maxHeightCap: 560,
    });
    expect(floored.maxHeight).toBe(40);
  });

  it("honours prefer: above when both sides fit", () => {
    const placement = placeOverlay({
      anchor: anchor(100, 300, 200, 330),
      size: { width: 232, height: 100 },
      viewport: { width: 1000, height: 800 },
      prefer: "above",
    });
    expect(placement.placement).toBe("above");
    expect(placement.top).toBe(192);
  });

  it("keeps the preferred side when neither side fits", () => {
    const placement = placeOverlay({
      anchor: anchor(100, 60, 200, 140),
      size: { width: 232, height: 400 },
      viewport: { width: 1000, height: 200 },
      prefer: "above",
    });
    expect(placement.placement).toBe("above");
    expect(placement.top).toBe(OVERLAY_VIEWPORT_GAP);
  });
});