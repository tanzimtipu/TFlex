// Phase 87 (FEA-039) chunk A — blankPageInkThreshold settings normalization.
//
// The field is preserve-if-valid only: a finite number in 0..1 survives as-is;
// anything else (out of range, NaN, a string) and an absent field all leave it
// undefined so the consumer falls back to DEFAULT_BLANK_INK_THRESHOLD.

import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../../src/main/services/settings';

describe('Phase 87: normalizeSettings blankPageInkThreshold', () => {
  it('preserves 0, 0.25 and 1 as-is', () => {
    expect(normalizeSettings({ blankPageInkThreshold: 0 }).blankPageInkThreshold).toBe(0);
    expect(normalizeSettings({ blankPageInkThreshold: 0.25 }).blankPageInkThreshold).toBe(0.25);
    expect(normalizeSettings({ blankPageInkThreshold: 1 }).blankPageInkThreshold).toBe(1);
  });

  it('rejects invalid values and leaves the field absent', () => {
    const invalid: unknown[] = [-0.1, 1.1, Number.NaN, '0.5'];
    for (const value of invalid) {
      expect(normalizeSettings({ blankPageInkThreshold: value }).blankPageInkThreshold).toBeUndefined();
    }
    expect(normalizeSettings({}).blankPageInkThreshold).toBeUndefined();
  });
});
