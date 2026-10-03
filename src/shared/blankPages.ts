// Phase 87 (FEA-039) — pure blank-page classification helpers.
//
// No fs, no Electron, no DOM, no canvas: callers hand in raw RGBA pixels and
// this module only does the arithmetic. The renderer/main split stays free to
// render page bitmaps wherever it is cheapest; the classifier is testable in
// isolation and identical on both sides of the IPC boundary.

import type {
  BlankPageCandidate,
  BlankPageMeasurement,
  BlankPageUnclassified,
} from './types';

/** A pixel counts as ink when its luminance is strictly below this cut. */
export const INK_LUMA_CUT = 200;

/** Fallback ink-coverage fraction (0..1) for a blank page when no setting is
 *  persisted. `coverage <= threshold` means blank. */
export const DEFAULT_BLANK_INK_THRESHOLD = 0.005;

export interface InkCoverageOptions {
  /** Sample every Nth pixel. Defaults to 1; clamped to an integer >= 1. */
  stride?: number;
  /** Luminance cut below which a pixel is ink. Defaults to INK_LUMA_CUT. */
  inkCut?: number;
}

export interface InkCoverage {
  /** inkCount / sampledPixels, in 0..1. */
  coverage: number;
  /** Number of pixel samples actually taken (never 0 for a valid image). */
  sampledPixels: number;
}

/**
 * Compute the fraction of sampled pixels that carry ink. `pixels` is RGBA,
 * row-major, 4 bytes per pixel. Luminance is 0.299*r + 0.587*g + 0.114*b.
 *
 * Fails loud with a RangeError for a non-positive/non-integer width or height,
 * or a buffer too small for the stated dimensions — never a silent 0.
 */
export function computeInkCoverage(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts?: InkCoverageOptions,
): InkCoverage {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`computeInkCoverage: width must be a positive integer (got ${String(width)})`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`computeInkCoverage: height must be a positive integer (got ${String(height)})`);
  }
  const pixelCount = width * height;
  const needed = pixelCount * 4;
  if (pixels.length < needed) {
    throw new RangeError(
      `computeInkCoverage: pixels.length ${pixels.length} is smaller than width*height*4 ${needed}`,
    );
  }

  const requestedStride = opts?.stride ?? 1;
  const stride = Number.isFinite(requestedStride) ? Math.max(1, Math.floor(requestedStride)) : 1;
  const inkCut = opts?.inkCut ?? INK_LUMA_CUT;

  let inkCount = 0;
  let sampledPixels = 0;
  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    const luma = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    if (luma < inkCut) {
      inkCount += 1;
    }
    sampledPixels += 1;
  }
  return { coverage: inkCount / sampledPixels, sampledPixels };
}

/**
 * Split per-page measurements into blank candidates and pages that could not
 * be measured. A non-finite `threshold` falls back to
 * DEFAULT_BLANK_INK_THRESHOLD; a page is a candidate when its measured
 * coverage is at or below the threshold. Unmeasurable pages are never removed.
 */
export function classifyPages(
  measurements: readonly BlankPageMeasurement[],
  threshold: number,
): { candidates: BlankPageCandidate[]; unclassified: BlankPageUnclassified[] } {
  const cut = Number.isFinite(threshold) ? threshold : DEFAULT_BLANK_INK_THRESHOLD;
  const candidates: BlankPageCandidate[] = [];
  const unclassified: BlankPageUnclassified[] = [];
  for (const measurement of measurements) {
    if (measurement.coverage === null) {
      unclassified.push({ page: measurement.page, reason: measurement.reason ?? 'not measurable' });
    } else if (measurement.coverage <= cut) {
      candidates.push({ page: measurement.page, coverage: measurement.coverage });
    }
  }
  return { candidates, unclassified };
}
