import { describe, expect, it } from 'vitest';
import {
  PRINT_PRESETS_CAP,
  PRINT_PRESET_NAME_MAX,
  normalizePrintPresets,
  normalizeSettings,
} from '../../../src/main/services/settings';

describe('Phase 81: normalizePrintPresets', () => {
  it('rejects non-arrays with null', () => {
    expect(normalizePrintPresets('x')).toBeNull();
    expect(normalizePrintPresets(7)).toBeNull();
    expect(normalizePrintPresets(null)).toBeNull();
    expect(normalizePrintPresets(undefined)).toBeNull();
    expect(normalizePrintPresets({})).toBeNull();
  });

  it('keeps a valid entry with a trimmed name and only its known keys', () => {
    const result = normalizePrintPresets([
      { name: '  Duplex Grey ', settings: { duplex: 'longEdge', color: false, scaling: 'fit' } },
    ]);
    expect(result).toEqual([
      { name: 'Duplex Grey', settings: { duplex: 'longEdge', color: false, scaling: 'fit' } },
    ]);
  });

  it('drops invalid values per key but keeps valid siblings', () => {
    const result = normalizePrintPresets([
      { name: 'p', settings: { copies: 500, color: 'yes', scaling: 'bogus', duplex: 'longEdge' } },
    ]);
    expect(result).toEqual([{ name: 'p', settings: { duplex: 'longEdge' } }]);
  });

  it('drops unknown keys including deviceName, pageRanges and paperSource', () => {
    const result = normalizePrintPresets([
      {
        name: 'p',
        settings: {
          deviceName: 'HP',
          pageRanges: [{ from: 0, to: 1 }],
          paperSource: 'tray1',
          copies: 2,
        },
      },
    ]);
    expect(result).toEqual([{ name: 'p', settings: { copies: 2 } }]);
  });

  it('skips entries with a blank, over-long or absent name', () => {
    const long = 'n'.repeat(PRINT_PRESET_NAME_MAX + 1);
    const result = normalizePrintPresets([
      { name: '   ', settings: { copies: 1 } },
      { name: long, settings: { copies: 1 } },
      { settings: { copies: 1 } },
      { name: 7, settings: { copies: 1 } },
      { name: 'ok', settings: { copies: 1 } },
    ]);
    expect(result).toEqual([{ name: 'ok', settings: { copies: 1 } }]);
  });

  it('skips entries whose settings is not a plain object', () => {
    const result = normalizePrintPresets([
      { name: 'a', settings: 'nope' },
      { name: 'b', settings: [1, 2] },
      { name: 'c', settings: null },
      { name: 'd', settings: { copies: 1 } },
    ]);
    expect(result).toEqual([{ name: 'd', settings: { copies: 1 } }]);
  });

  it('upserts same-name entries, later replacing earlier at the first position', () => {
    const result = normalizePrintPresets([
      { name: 'p', settings: { copies: 1 } },
      { name: 'q', settings: { copies: 2 } },
      { name: 'p', settings: { copies: 9 } },
    ]);
    expect(result).toEqual([
      { name: 'p', settings: { copies: 9 } },
      { name: 'q', settings: { copies: 2 } },
    ]);
  });

  it('caps the result at PRINT_PRESETS_CAP after upsert', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `p${i}`,
      settings: { copies: 1 },
    }));
    const result = normalizePrintPresets(many);
    expect(result).toHaveLength(PRINT_PRESETS_CAP);
    expect(result?.[0]).toEqual({ name: 'p0', settings: { copies: 1 } });
    expect(result?.[PRINT_PRESETS_CAP - 1]).toEqual({
      name: `p${PRINT_PRESETS_CAP - 1}`,
      settings: { copies: 1 },
    });
  });

  it('returns an empty array for an empty array input', () => {
    expect(normalizePrintPresets([])).toEqual([]);
  });
});

describe('Phase 83: normalizePrintPresets imposition keys', () => {
  it('round-trips every valid booklet/poster key', () => {
    const settings = {
      layoutMode: 'booklet' as const,
      bookletGutterPt: 12,
      bookletCreepPt: 4,
      bookletSubset: 'front' as const,
      posterRows: 3,
      posterCols: 5,
      posterOverlapPt: 6,
      posterScalePercent: 150,
      posterCutMarks: true,
    };
    expect(normalizePrintPresets([{ name: 'imposed', settings }])).toEqual([
      { name: 'imposed', settings },
    ]);
  });

  it('keeps each key at its inclusive boundary', () => {
    const settings = {
      layoutMode: 'poster' as const,
      bookletGutterPt: 72,
      bookletCreepPt: 36,
      bookletSubset: 'back' as const,
      posterRows: 10,
      posterCols: 1,
      posterOverlapPt: 72,
      posterScalePercent: 500,
      posterCutMarks: false,
    };
    expect(normalizePrintPresets([{ name: 'p', settings }])).toEqual([
      { name: 'p', settings },
    ]);
    const minimum = {
      layoutMode: 'single' as const,
      bookletGutterPt: 0,
      bookletCreepPt: 0,
      bookletSubset: 'both' as const,
      posterRows: 1,
      posterCols: 10,
      posterOverlapPt: 0,
      posterScalePercent: 10,
      posterCutMarks: true,
    };
    expect(normalizePrintPresets([{ name: 'p', settings: minimum }])).toEqual([
      { name: 'p', settings: minimum },
    ]);
  });

  it('drops each invalid key but keeps the valid siblings', () => {
    const result = normalizePrintPresets([
      {
        name: 'p',
        settings: {
          layoutMode: 'tri-fold',
          bookletGutterPt: 100,
          bookletCreepPt: -1,
          bookletSubset: 'middle',
          posterRows: 0,
          posterCols: 11,
          posterOverlapPt: 73,
          posterScalePercent: 9,
          posterCutMarks: 'yes',
          copies: 2,
        },
      },
    ]);
    expect(result).toEqual([{ name: 'p', settings: { copies: 2 } }]);
  });

  it('drops non-integer poster rows/cols and non-numeric values', () => {
    const result = normalizePrintPresets([
      {
        name: 'p',
        settings: {
          posterRows: 2.5,
          posterCols: '4',
          bookletGutterPt: '10',
          posterScalePercent: Number.NaN,
          bookletSubset: 7,
          layoutMode: null,
        },
      },
    ]);
    expect(result).toEqual([{ name: 'p', settings: {} }]);
  });
});

describe('Phase 81: normalizeSettings printPresets', () => {
  it('round-trips a valid list', () => {
    const stored = [
      { name: 'Duplex Grey', settings: { duplex: 'longEdge' as const, color: false } },
      { name: 'N-up', settings: { pagesPerSheet: 4, pageOrder: 'horizontal' as const } },
    ];
    const result = normalizeSettings({ printPresets: stored });
    expect(result.printPresets).toEqual(stored);
  });

  it('leaves the field absent when the stored value is invalid', () => {
    const result = normalizeSettings({ printPresets: 'nope' });
    expect(result.printPresets).toBeUndefined();
    expect('printPresets' in result).toBe(false);
  });
});