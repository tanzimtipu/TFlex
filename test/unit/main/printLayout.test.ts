import { describe, it, expect } from 'vitest';
import { printSheetLayout } from '../../../src/shared/printLayout';
import type { PrintPageOrder } from '../../../src/shared/types';

/**
 * Phase 33 / DEF-280 — the shared N-up sheet layout rule. The full matrix of
 * pages-per-sheet x page-order: grid dims, the slot permutation, and the
 * anchor cases the defect was about (2-up 2x1 vs 1x2, 6-up 3x2 vs 2x3).
 */
const PPSS = [1, 2, 4, 6, 9, 16] as const;
const ORDERS: PrintPageOrder[] = [
  'horizontal',
  'horizontalReversed',
  'vertical',
  'verticalReversed',
];

describe('Phase 33: printSheetLayout grid dimensions', () => {
  it('uses the base grid for horizontal orders and swaps it for vertical', () => {
    const expected: Record<number, { h: [number, number]; v: [number, number] }> = {
      1: { h: [1, 1], v: [1, 1] },
      2: { h: [2, 1], v: [1, 2] },
      4: { h: [2, 2], v: [2, 2] },
      6: { h: [3, 2], v: [2, 3] },
      9: { h: [3, 3], v: [3, 3] },
      16: { h: [4, 4], v: [4, 4] },
    };
    for (const pps of PPSS) {
      const [hc, hr] = expected[pps].h;
      const [vc, vr] = expected[pps].v;
      for (const order of ORDERS) {
        const { cols, rows } = printSheetLayout(pps, order);
        const vertical = order === 'vertical' || order === 'verticalReversed';
        expect([cols, rows]).toEqual(vertical ? [vc, vr] : [hc, hr]);
      }
    }
  });

  it('asserts the 2-up 2x1 vs 1x2 difference explicitly', () => {
    const h = printSheetLayout(2, 'horizontal');
    const v = printSheetLayout(2, 'vertical');
    expect({ cols: h.cols, rows: h.rows }).toEqual({ cols: 2, rows: 1 });
    expect({ cols: v.cols, rows: v.rows }).toEqual({ cols: 1, rows: 2 });
  });

  it('asserts the 6-up 3x2 vs 2x3 difference explicitly', () => {
    const h = printSheetLayout(6, 'horizontal');
    const v = printSheetLayout(6, 'vertical');
    expect({ cols: h.cols, rows: h.rows }).toEqual({ cols: 3, rows: 2 });
    expect({ cols: v.cols, rows: v.rows }).toEqual({ cols: 2, rows: 3 });
  });
});

describe('Phase 33: printSheetLayout slots', () => {
  it('fills horizontal row-major', () => {
    expect(printSheetLayout(4, 'horizontal').slots).toEqual([0, 1, 2, 3]);
    expect(printSheetLayout(6, 'horizontal').slots).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('fills horizontalReversed right-to-left per row', () => {
    expect(printSheetLayout(4, 'horizontalReversed').slots).toEqual([1, 0, 3, 2]);
    expect(printSheetLayout(6, 'horizontalReversed').slots).toEqual([2, 1, 0, 5, 4, 3]);
  });

  it('fills vertical column by column, top to bottom', () => {
    expect(printSheetLayout(4, 'vertical').slots).toEqual([0, 2, 1, 3]);
    // 6-up vertical is the 2x3 grid: col 0 = [0,1,2], col 1 = [3,4,5].
    expect(printSheetLayout(6, 'vertical').slots).toEqual([0, 3, 1, 4, 2, 5]);
  });

  it('fills verticalReversed column by column, bottom to top', () => {
    expect(printSheetLayout(4, 'verticalReversed').slots).toEqual([1, 3, 0, 2]);
    // 6-up verticalReversed 2x3: each column bottom to top.
    expect(printSheetLayout(6, 'verticalReversed').slots).toEqual([2, 5, 1, 4, 0, 3]);
  });

  it('treats an absent page order as horizontal', () => {
    expect(printSheetLayout(4)).toEqual(printSheetLayout(4, 'horizontal'));
  });

  it('is a permutation of 0..pagesPerSheet-1 for every combination', () => {
    for (const pps of PPSS) {
      const sorted = Array.from({ length: pps }, (_v, i) => i);
      for (const order of ORDERS) {
        const { cols, rows, slots } = printSheetLayout(pps, order);
        expect(slots).toHaveLength(cols * rows);
        expect(slots).toHaveLength(pps);
        expect([...slots].sort((a, b) => a - b)).toEqual(sorted);
      }
    }
  });
});