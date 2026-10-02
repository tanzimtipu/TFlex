import { describe, it, expect } from 'vitest';
import {
  bookletPageCount,
  bookletSideOffset,
  posterTileGrid,
  saddleStitchSequence,
} from '../../../src/shared/printImposition';
import type { BookletSubset } from '../../../src/shared/types';

/**
 * Phase 83 - the shared booklet/poster imposition math. Covers the padded page
 * count, the exact saddle-stitch sequences (including blank nulls) for N = 1..8
 * and each subset, the gutter/creep margin shape, and the poster tile geometry.
 */
const SUBSETS: BookletSubset[] = ['both', 'front', 'back'];

describe('Phase 83: bookletPageCount', () => {
  it('pads up to the next multiple of 4', () => {
    expect(bookletPageCount(0)).toBe(0);
    expect(bookletPageCount(1)).toBe(4);
    expect(bookletPageCount(2)).toBe(4);
    expect(bookletPageCount(3)).toBe(4);
    expect(bookletPageCount(4)).toBe(4);
    expect(bookletPageCount(5)).toBe(8);
    expect(bookletPageCount(8)).toBe(8);
  });

  it('returns 0 for non-positive and non-finite input', () => {
    expect(bookletPageCount(-1)).toBe(0);
    expect(bookletPageCount(Number.NaN)).toBe(0);
  });
});

describe('Phase 83: saddleStitchSequence both sides', () => {
  it('emits the exact padded sequence for pageCount 1..8', () => {
    const expected: Record<number, (number | null)[]> = {
      1: [null, 1, null, null],
      2: [null, 1, 2, null],
      3: [null, 1, 2, 3],
      4: [4, 1, 2, 3],
      5: [null, 1, 2, null, null, 3, 4, 5],
      6: [null, 1, 2, null, 6, 3, 4, 5],
      7: [null, 1, 2, 7, 6, 3, 4, 5],
      8: [8, 1, 2, 7, 6, 3, 4, 5],
    };
    for (let n = 1; n <= 8; n += 1) {
      expect(saddleStitchSequence(n, 'both')).toEqual(expected[n]);
    }
  });

  it('matches the sanity case for pageCount 8', () => {
    expect(saddleStitchSequence(8, 'both')).toEqual([8, 1, 2, 7, 6, 3, 4, 5]);
  });

  it('returns an empty sequence for a non-positive page count', () => {
    for (const subset of SUBSETS) expect(saddleStitchSequence(0, subset)).toEqual([]);
  });
});

describe('Phase 83: saddleStitchSequence subsets', () => {
  it('front emits only the front sides', () => {
    expect(saddleStitchSequence(8, 'front')).toEqual([8, 1, 6, 3]);
    expect(saddleStitchSequence(5, 'front')).toEqual([null, 1, null, 3]);
    expect(saddleStitchSequence(1, 'front')).toEqual([null, 1]);
  });

  it('back emits only the back sides', () => {
    expect(saddleStitchSequence(8, 'back')).toEqual([2, 7, 4, 5]);
    expect(saddleStitchSequence(5, 'back')).toEqual([2, null, 4, 5]);
    expect(saddleStitchSequence(1, 'back')).toEqual([null, null]);
  });

  it('front then back per sheet concatenates to the full both sequence', () => {
    for (let n = 1; n <= 8; n += 1) {
      const both = saddleStitchSequence(n, 'both');
      const split: (number | null)[] = [];
      const front = saddleStitchSequence(n, 'front');
      const back = saddleStitchSequence(n, 'back');
      for (let i = 0; i < front.length; i += 2) {
        split.push(front[i], front[i + 1], back[i], back[i + 1]);
      }
      expect(split).toEqual(both);
    }
  });
});

describe('Phase 83: bookletSideOffset', () => {
  it('is zero when both gutter and creep are zero', () => {
    expect(bookletSideOffset(0, 4, 0, 0)).toEqual({ leftPt: 0, rightPt: 0 });
    expect(bookletSideOffset(2, 4, 0, 0)).toEqual({ leftPt: 0, rightPt: 0 });
  });

  it('splits the gutter evenly onto both inner edges', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(bookletSideOffset(i, 4, 10, 0)).toEqual({ leftPt: 5, rightPt: 5 });
    }
  });

  it('keeps the creep term zero when creepPt is zero', () => {
    expect(bookletSideOffset(1, 5, 4, 0)).toEqual({ leftPt: 2, rightPt: 2 });
  });

  it('grows the creep monotonically toward the middle sheets', () => {
    const offsets = [0, 1, 2, 3, 4].map((i) => bookletSideOffset(i, 5, 0, 6).leftPt);
    expect(offsets).toEqual([0, 3, 6, 3, 0]);
  });

  it('is symmetric across sheet i and sheetCount-1-i and left equals right', () => {
    const count = 6;
    const values = Array.from({ length: count }, (_v, i) =>
      bookletSideOffset(i, count, 4, 9),
    );
    for (let i = 0; i < count; i += 1) {
      expect(values[i].leftPt).toBe(values[i].rightPt);
      expect(values[i]).toEqual(values[count - 1 - i]);
    }
    expect(values.map((v) => v.leftPt)).toEqual([2, 6.5, 11, 11, 6.5, 2]);
  });

  it('handles a single sheet and an even sheet count', () => {
    expect(bookletSideOffset(0, 1, 10, 6)).toEqual({ leftPt: 5, rightPt: 5 });
    const even = [0, 1, 2, 3].map((i) => bookletSideOffset(i, 4, 0, 8).leftPt);
    expect(even).toEqual([0, 8, 8, 0]);
  });
});

describe('Phase 83: posterTileGrid', () => {
  it('tiles 2x2 with no overlap into a non-overlapping grid', () => {
    const { tiles, sheets } = posterTileGrid(100, 200, 2, 2, 0);
    expect(sheets).toBe(4);
    expect(tiles).toEqual([
      { row: 0, col: 0, sourceX: 0, sourceY: 0, sourceW: 50, sourceH: 100 },
      { row: 0, col: 1, sourceX: 50, sourceY: 0, sourceW: 50, sourceH: 100 },
      { row: 1, col: 0, sourceX: 0, sourceY: 100, sourceW: 50, sourceH: 100 },
      { row: 1, col: 1, sourceX: 50, sourceY: 100, sourceW: 50, sourceH: 100 },
    ]);
  });

  it('steps by tileW - overlap and tileH - overlap when overlapping', () => {
    const { tiles, sheets } = posterTileGrid(100, 200, 2, 2, 20);
    expect(sheets).toBe(4);
    const tileW = (100 + 20 * 1) / 2;
    const tileH = (200 + 20 * 1) / 2;
    expect(tiles[0]).toEqual({
      row: 0, col: 0, sourceX: 0, sourceY: 0, sourceW: tileW, sourceH: tileH,
    });
    expect(tiles[1].sourceX).toBe(tileW - 20);
    expect(tiles[2].sourceY).toBe(tileH - 20);
    for (const tile of tiles) {
      expect(tile.sourceW).toBe(tileW);
      expect(tile.sourceH).toBe(tileH);
    }
  });

  it('handles a 1x1 grid', () => {
    const { tiles, sheets } = posterTileGrid(100, 200, 1, 1, 10);
    expect(sheets).toBe(1);
    expect(tiles).toEqual([
      { row: 0, col: 0, sourceX: 0, sourceY: 0, sourceW: 100, sourceH: 200 },
    ]);
  });

  it('handles 1x4 and 4x1 grids', () => {
    const wide = posterTileGrid(100, 200, 1, 4, 0);
    expect(wide.sheets).toBe(4);
    expect(wide.tiles.map((t) => t.sourceX)).toEqual([0, 25, 50, 75]);
    expect(wide.tiles.every((t) => t.row === 0 && t.sourceW === 25 && t.sourceH === 200)).toBe(true);

    const tall = posterTileGrid(100, 200, 4, 1, 0);
    expect(tall.sheets).toBe(4);
    expect(tall.tiles.map((t) => t.sourceY)).toEqual([0, 50, 100, 150]);
    expect(tall.tiles.every((t) => t.col === 0 && t.sourceW === 100 && t.sourceH === 50)).toBe(true);
  });

  it('clamps rows and cols to at least 1', () => {
    const { tiles, sheets } = posterTileGrid(100, 200, 0, 0, 0);
    expect(sheets).toBe(1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual({
      row: 0, col: 0, sourceX: 0, sourceY: 0, sourceW: 100, sourceH: 200,
    });
  });
});
