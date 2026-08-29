// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { computeThumbGeometry } from "../../../src/renderer/components/thumbGeometry";

describe("computeThumbGeometry", () => {
  it("scales a US Letter page (612x792 pt) to a 126px-wide thumbnail at dpr=1", () => {
    const g = computeThumbGeometry({
      pageWidthPt: 612,
      pageHeightPt: 792,
      thumbWidth: 126,
      dpr: 1,
    });
    // cssScale = 126 / 612 ≈ 0.20588...
    expect(g.cssScale).toBeCloseTo(126 / 612, 5);
    expect(g.renderScale).toBeCloseTo(g.cssScale, 5);
    expect(g.cssWidth).toBe(126);
    expect(g.cssHeight).toBe(Math.floor(792 * (126 / 612)));
    expect(g.bufferWidth).toBe(126);
    expect(g.bufferHeight).toBe(Math.floor(792 * (126 / 612)));
  });

  it("produces a 2x backing buffer at dpr=2 for retina sharpness", () => {
    const g = computeThumbGeometry({
      pageWidthPt: 612,
      pageHeightPt: 792,
      thumbWidth: 126,
      dpr: 2,
    });
    expect(g.renderScale).toBeCloseTo(2 * g.cssScale, 5);
    // CSS size stays at thumbWidth, the buffer is exactly 2x.
    expect(g.cssWidth).toBe(126);
    expect(g.bufferWidth).toBe(252);
    expect(g.cssHeight).toBe(Math.floor(792 * g.cssScale));
    expect(g.bufferHeight).toBe(2 * g.cssHeight);
  });

  it("returns a zero-everything geometry for a degenerate (zero-width) page", () => {
    const g = computeThumbGeometry({
      pageWidthPt: 0,
      pageHeightPt: 0,
      thumbWidth: 126,
      dpr: 1,
    });
    expect(g.cssScale).toBe(0);
    expect(g.renderScale).toBe(0);
    expect(g.cssWidth).toBe(0);
    expect(g.cssHeight).toBe(0);
    expect(g.bufferWidth).toBe(0);
    expect(g.bufferHeight).toBe(0);
  });

  it("treats an invalid dpr (<=0) as 1 instead of NaN", () => {
    const g = computeThumbGeometry({
      pageWidthPt: 612,
      pageHeightPt: 792,
      thumbWidth: 126,
      dpr: 0,
    });
    expect(Number.isFinite(g.renderScale)).toBe(true);
    expect(g.bufferWidth).toBe(g.cssWidth);
  });

  it("matches the regression: previous code inverted scale and produced ~3000x3700 px", () => {
    // The old formula was: scale = pageWidthPt / thumbWidth, then
    //   viewport = getViewport({ scale: scale * dpr })
    // For 612pt page width and thumbWidth=126 that gives scale=4.857, so the
    // CSS canvas would be 612 * 4.857 * dpr ≈ 2972 px wide and then clipped
    // by the 126 px wrap. The new formula must NOT reproduce that.
    const g = computeThumbGeometry({
      pageWidthPt: 612,
      pageHeightPt: 792,
      thumbWidth: 126,
      dpr: 1,
    });
    expect(g.cssWidth).toBeLessThanOrEqual(126);
    expect(g.cssHeight).toBeLessThanOrEqual(170);
  });
});