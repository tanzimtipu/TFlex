// Phase 87 (FEA-039) chunk A — pure blank-page classification.
//
// Pins `computeInkCoverage` and `classifyPages` in isolation: all-white -> 0,
// all-black -> 1, a 1%-ink image -> ~0.01, stride sampling staying close to
// full sampling, and a fail-loud RangeError for a bad image instead of a
// silent 0. `classifyPages` pins at-or-below-threshold candidacy, null
// measurements becoming unclassified with their reason, and a non-finite
// threshold falling back to the shipped default.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLANK_INK_THRESHOLD,
  computeInkCoverage,
  classifyPages,
} from '../../../src/shared/blankPages';
import type { BlankPageMeasurement } from '../../../src/shared/types';

/** Solid RGBA image of the given dimensions. */
function solid(width: number, height: number, value: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(value);
}

/** 100x120 image where every third row (row 0, 3, 6, ...) is black — a mixed
 *  image whose 1/3 ink fraction is stable under 4-pixel stride sampling
 *  because the 100px width is divisible by the stride. */
function bandedBlackRows(): Uint8ClampedArray {
  const width = 100;
  const height = 120;
  const pixels = solid(width, height, 255);
  for (let row = 0; row < height; row += 1) {
    if (row % 3 !== 0) continue;
    for (let col = 0; col < width; col += 1) {
      const offset = (row * width + col) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
  }
  return pixels;
}

describe('phase87: computeInkCoverage', () => {
  it('reports 0 for an all-white image', () => {
    const result = computeInkCoverage(solid(20, 10, 255), 20, 10);
    expect(result.coverage).toBe(0);
    expect(result.sampledPixels).toBe(200);
  });

  it('reports 1 for an all-black image', () => {
    const result = computeInkCoverage(solid(20, 10, 0), 20, 10);
    expect(result.coverage).toBe(1);
    expect(result.sampledPixels).toBe(200);
  });

  it('reports ~0.01 for a 100x100 image that is 1% black', () => {
    const pixels = solid(100, 100, 255);
    for (let i = 0; i < 100; i += 1) {
      const offset = i * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
    const result = computeInkCoverage(pixels, 100, 100);
    expect(result.coverage).toBeCloseTo(0.01, 6);
    expect(result.sampledPixels).toBe(10000);
  });

  it('stride 4 stays within 0.02 of stride 1 on a mixed image', () => {
    const pixels = bandedBlackRows();
    const full = computeInkCoverage(pixels, 100, 120);
    const strided = computeInkCoverage(pixels, 100, 120, { stride: 4 });
    expect(full.coverage).toBeCloseTo(1 / 3, 6);
    expect(Math.abs(strided.coverage - full.coverage)).toBeLessThan(0.02);
    expect(strided.sampledPixels).toBe(3000);
  });

  it('treats a non-finite/zero stride as full sampling', () => {
    const pixels = bandedBlackRows();
    const base = computeInkCoverage(pixels, 100, 120);
    expect(computeInkCoverage(pixels, 100, 120, { stride: 0 }).sampledPixels).toBe(base.sampledPixels);
    expect(computeInkCoverage(pixels, 100, 120, { stride: Number.NaN }).sampledPixels).toBe(base.sampledPixels);
  });

  it('honours a custom inkCut', () => {
    // Mid-grey (luma ~127.5). Default cut 200 counts it as ink; inkCut 100
    // does not.
    const pixels = solid(10, 10, 128);
    expect(computeInkCoverage(pixels, 10, 10).coverage).toBe(1);
    expect(computeInkCoverage(pixels, 10, 10, { inkCut: 100 }).coverage).toBe(0);
  });

  it('throws RangeError for a too-small buffer or bad dimensions', () => {
    expect(() => computeInkCoverage(new Uint8ClampedArray(50), 10, 10)).toThrow(RangeError);
    expect(() => computeInkCoverage(solid(10, 10, 255), 0, 10)).toThrow(RangeError);
    expect(() => computeInkCoverage(solid(10, 10, 255), 10, -3)).toThrow(RangeError);
    expect(() => computeInkCoverage(solid(10, 10, 255), 2.5, 10)).toThrow(RangeError);
  });
});

describe('phase87: classifyPages', () => {
  it('treats coverage exactly equal to the threshold as a candidate', () => {
    const measurements: BlankPageMeasurement[] = [{ page: 1, coverage: 0.01 }];
    const { candidates, unclassified } = classifyPages(measurements, 0.01);
    expect(candidates).toEqual([{ page: 1, coverage: 0.01 }]);
    expect(unclassified).toEqual([]);
  });

  it('excludes coverage above the threshold and collects none as unclassified', () => {
    const measurements: BlankPageMeasurement[] = [{ page: 2, coverage: 0.02 }];
    const { candidates, unclassified } = classifyPages(measurements, 0.01);
    expect(candidates).toEqual([]);
    expect(unclassified).toEqual([]);
  });

  it('reports a null measurement as unclassified with its supplied reason', () => {
    const measurements: BlankPageMeasurement[] = [
      { page: 3, coverage: null, reason: 'decode failed' },
      { page: 4, coverage: null },
    ];
    const { candidates, unclassified } = classifyPages(measurements, 0.01);
    expect(candidates).toEqual([]);
    expect(unclassified).toEqual([
      { page: 3, reason: 'decode failed' },
      { page: 4, reason: 'not measurable' },
    ]);
  });

  it('falls back to the default threshold when the threshold is non-finite', () => {
    const atDefault: BlankPageMeasurement[] = [
      { page: 1, coverage: DEFAULT_BLANK_INK_THRESHOLD },
      { page: 2, coverage: DEFAULT_BLANK_INK_THRESHOLD + 0.001 },
    ];
    const { candidates, unclassified } = classifyPages(atDefault, Number.NaN);
    expect(candidates).toEqual([{ page: 1, coverage: DEFAULT_BLANK_INK_THRESHOLD }]);
    expect(unclassified).toEqual([]);
  });
});
