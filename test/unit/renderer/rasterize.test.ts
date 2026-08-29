// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  computeRasterSize,
  pickCanvasMime,
} from "../../../src/renderer/pdf/rasterize";

/**
 * Phase 9 — PDF page rasterization helper tests.
 *
 * The rasterize.ts module owns the per-page rasterization step
 * (computeRasterSize + pickCanvasMime). pdf.js itself isn't loaded
 * here — jsdom doesn't ship a worker and the file/canvas APIs it
 * provides are too limited for an end-to-end render. We test the
 * pure helpers instead; the pdf.js wiring is covered by the e2e
 * harness.
 */

describe("computeRasterSize — DPI math", () => {
  it("scales the canvas by DPI/72 for a US-Letter page", () => {
    // 612 x 792 PDF points is US-Letter.
    const size = computeRasterSize(612, 792, 150);
    expect(size.width).toBe(1275);
    expect(size.height).toBe(1650);
  });

  it("scales to 600 DPI for print-quality", () => {
    const size = computeRasterSize(612, 792, 600);
    expect(size.width).toBe(5100);
    expect(size.height).toBe(6600);
  });

  it("returns 1x1 minimum for zero-sized pages", () => {
    // A page with zero width / height shouldn't produce a 0x0
    // canvas — pdf.js refuses to render into one.
    const size = computeRasterSize(0, 0, 150);
    expect(size.width).toBe(1);
    expect(size.height).toBe(1);
  });

  it("rounds fractional sizes to integers", () => {
    // 612 / 72 * 1.5 = 12.75 -> 13
    const size = computeRasterSize(612, 792, 108);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});

describe("pickCanvasMime — format to MIME mapping", () => {
  it("returns image/png for png", () => {
    expect(pickCanvasMime("png")).toBe("image/png");
  });
  it("returns image/jpeg for jpeg", () => {
    expect(pickCanvasMime("jpeg")).toBe("image/jpeg");
  });
});
