// Phase 89 (FEA-033) chunk A — pure Bates label / series / defaults / validation.
//
// Pins buildBatesLabel zero-padding, prefix/suffix and the padding-smaller-than-
// number case; formatBatesSeries start offset and selection order;
// normalizeBatesDefaults preserve-if-valid per key; and validateBatesSettings
// accept/reject behaviour.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATES_DEFAULTS,
  MAX_BATES_SIZE,
  MIN_BATES_SIZE,
  buildBatesLabel,
  formatBatesSeries,
  normalizeBatesDefaults,
  validateBatesSettings,
} from '../../../src/shared/bates';
import type { BatesSettings } from '../../../src/shared/types';

function series(pages: number[], startNumber: number, padding: number): string[] {
  const settings: BatesSettings = {
    pages,
    prefix: '',
    suffix: '',
    startNumber,
    padding,
    position: 'bottom-right',
  };
  return formatBatesSeries(settings);
}

describe('phase89: buildBatesLabel', () => {
  it('composes prefix + zero-padded number + suffix', () => {
    expect(buildBatesLabel('ABC-', 7, 6, '-X')).toBe('ABC-000007-X');
    expect(buildBatesLabel('', 1, 6, '')).toBe('000001');
  });

  it('pads to at least the number width when padding is smaller than the number', () => {
    expect(buildBatesLabel('', 12345, 3, '')).toBe('12345');
    expect(buildBatesLabel('P', 1000, 2, 'S')).toBe('P1000S');
  });

  it('supports zero padding and a large padding', () => {
    expect(buildBatesLabel('', 42, 0, '')).toBe('42');
    expect(buildBatesLabel('', 1, 10, '')).toBe('0000000001');
  });
});

describe('phase89: formatBatesSeries', () => {
  it('numbers from startNumber in list order (selection order, not ascending)', () => {
    expect(series([3, 1, 2], 1, 6)).toEqual(['000001', '000002', '000003']);
    expect(series([5, 2], 100, 4)).toEqual(['0100', '0101']);
  });

  it('honours prefix, suffix and padding', () => {
    const settings: BatesSettings = {
      pages: [1, 2],
      prefix: 'EX-',
      suffix: '-END',
      startNumber: 9,
      padding: 3,
      position: 'top-left',
    };
    expect(formatBatesSeries(settings)).toEqual(['EX-009-END', 'EX-010-END']);
  });

  it('returns one label per page and nothing for an empty list', () => {
    expect(series([1, 2, 3], 1, 6)).toHaveLength(3);
    expect(series([], 1, 6)).toEqual([]);
  });
});

describe('phase89: normalizeBatesDefaults', () => {
  it('falls back to the shipped defaults for a non-object raw', () => {
    for (const raw of [undefined, null, 42, 'x', true, []]) {
      expect(normalizeBatesDefaults(raw)).toEqual(DEFAULT_BATES_DEFAULTS);
    }
  });

  it('preserves every valid key', () => {
    expect(normalizeBatesDefaults({
      prefix: 'A-',
      suffix: '-Z',
      startNumber: 12,
      padding: 4,
      position: 'top-center',
    })).toEqual({
      prefix: 'A-',
      suffix: '-Z',
      startNumber: 12,
      padding: 4,
      position: 'top-center',
    });
  });

  it('rejects an invalid key per key without touching the others', () => {
    expect(normalizeBatesDefaults({
      prefix: 7,
      suffix: '-ok',
      startNumber: 0,
      padding: 1.5,
      position: 'middle',
    })).toEqual({
      prefix: '',
      suffix: '-ok',
      startNumber: 1,
      padding: 6,
      position: 'bottom-right',
    });
  });
});

describe('phase89: validateBatesSettings', () => {
  it('normalises a valid payload and fills absent optionals', () => {
    const out = validateBatesSettings({
      pages: [2, 1],
      prefix: 'P',
      suffix: 'S',
      startNumber: 5,
      padding: 4,
      position: 'bottom-left',
    });
    expect(out).not.toBeNull();
    expect(out?.pages).toEqual([2, 1]);
    expect(out?.startNumber).toBe(5);
    expect(out?.padding).toBe(4);
    expect(out?.position).toBe('bottom-left');
  });

  it('accepts a minimal payload and defaults the option fields', () => {
    const out = validateBatesSettings({ pages: [1] });
    expect(out).not.toBeNull();
    expect(out?.prefix).toBe('');
    expect(out?.suffix).toBe('');
    expect(out?.startNumber).toBe(1);
    expect(out?.padding).toBe(DEFAULT_BATES_DEFAULTS.padding);
    expect(out?.position).toBe(DEFAULT_BATES_DEFAULTS.position);
  });

  it('rejects a malformed payload', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      42,
      'x',
      {},
      { pages: 'all' },
      { pages: [0] },
      { pages: [1.5] },
      { pages: [1], startNumber: 0 },
      { pages: [1], padding: 0 },
      { pages: [1], padding: 2.5 },
      { pages: [1], position: 'middle' },
      { pages: [1], font: 'Comic Sans' },
      { pages: [1], size: MIN_BATES_SIZE - 1 },
      { pages: [1], size: MAX_BATES_SIZE + 1 },
      { pages: [1], size: 'big' },
      { pages: [1], color: { r: 2, g: 0, b: 0 } },
      { pages: [1], color: { r: 0, g: 0 } },
      { pages: [1], prefix: 9 },
      { pages: [1], suffix: 9 },
    ];
    for (const raw of invalid) {
      expect(validateBatesSettings(raw)).toBeNull();
    }
  });

  it('accepts a valid font, size and colour', () => {
    const out = validateBatesSettings({
      pages: [1],
      font: 'Times',
      size: MAX_BATES_SIZE,
      color: { r: 0.1, g: 0.2, b: 0.3 },
    });
    expect(out?.font).toBe('Times');
    expect(out?.size).toBe(MAX_BATES_SIZE);
    expect(out?.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });
});
