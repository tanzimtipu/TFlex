import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERT_DEFAULTS } from '../../../src/shared/convert';
import { normalizeConvertDefaults } from '../../../src/main/services/settings';

/**
 * Phase 53 — `convertDefaults` normaliser (mirrors the Phase 52
 * `normalizeEncryptDefaults` tests): preserve-if-valid, reject-if-invalid,
 * unknown keys dropped, partial objects filled from the default.
 */

describe('normalizeConvertDefaults', () => {
  it('rejects an absent or empty field (consumer applies the default)', () => {
    expect(normalizeConvertDefaults(undefined)).toBeNull();
    expect(normalizeConvertDefaults(null)).toBeNull();
    expect(normalizeConvertDefaults({})).toBeNull();
    expect(normalizeConvertDefaults([])).toBeNull();
    expect(normalizeConvertDefaults('a4')).toBeNull();
  });

  it('drops unknown keys and keeps valid known ones', () => {
    const out = normalizeConvertDefaults({ pageSize: 'letter', bogus: 42 });
    expect(out).not.toBeNull();
    expect(out?.pageSize).toBe('letter');
    expect(Object.keys(out ?? {})).not.toContain('bogus');
    expect(out?.marginMm).toBe(DEFAULT_CONVERT_DEFAULTS.marginMm);
  });

  it('fills a partial object from DEFAULT_CONVERT_DEFAULTS', () => {
    const out = normalizeConvertDefaults({ marginMm: 30 });
    expect(out).toEqual({ ...DEFAULT_CONVERT_DEFAULTS, marginMm: 30 });
  });

  it('rejects marginMm outside 5..50 (both bounds)', () => {
    expect(normalizeConvertDefaults({ marginMm: 4 })).toBeNull();
    expect(normalizeConvertDefaults({ marginMm: 51 })).toBeNull();
    expect(normalizeConvertDefaults({ marginMm: 5 })?.marginMm).toBe(5);
    expect(normalizeConvertDefaults({ marginMm: 50 })?.marginMm).toBe(50);
    expect(normalizeConvertDefaults({ marginMm: Number.NaN })).toBeNull();
    expect(normalizeConvertDefaults({ marginMm: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects textFontSizePt outside 6..48 (both bounds)', () => {
    expect(normalizeConvertDefaults({ textFontSizePt: 5 })).toBeNull();
    expect(normalizeConvertDefaults({ textFontSizePt: 49 })).toBeNull();
    expect(normalizeConvertDefaults({ textFontSizePt: 6 })?.textFontSizePt).toBe(6);
    expect(normalizeConvertDefaults({ textFontSizePt: 48 })?.textFontSizePt).toBe(48);
  });

  it('rejects a bad pageSize, csvDelimiter or textFontFamily', () => {
    expect(normalizeConvertDefaults({ pageSize: 'a5' })).toBeNull();
    expect(normalizeConvertDefaults({ csvDelimiter: '|' })).toBeNull();
    expect(normalizeConvertDefaults({ textFontFamily: 'Comic Sans' })).toBeNull();
    expect(normalizeConvertDefaults({ pageSize: 'letter' })?.pageSize).toBe('letter');
    expect(normalizeConvertDefaults({ csvDelimiter: ';' })?.csvDelimiter).toBe(';');
    expect(normalizeConvertDefaults({ textFontFamily: 'Helvetica' })?.textFontFamily)
      .toBe('Helvetica');
  });

  it('rejects non-boolean flags and accepts real booleans', () => {
    expect(normalizeConvertDefaults({ csvFormMapping: 1 })).toBeNull();
    expect(normalizeConvertDefaults({ htmlPrintBackgrounds: 'yes' })).toBeNull();
    expect(normalizeConvertDefaults({ csvFormMapping: false })?.csvFormMapping).toBe(false);
  });
});
