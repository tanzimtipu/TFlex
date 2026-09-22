import type { PrintPageOrder } from './types';

/**
 * Phase 33 / DEF-280 — the SINGLE source of truth for the N-up sheet layout.
 *
 * `pageOrder` changes BOTH the sheet grid dimensions AND the slot assignment,
 * matching Acrobat's Page Order semantics:
 *   - Horizontal flows left-to-right (pages side by side).
 *   - Vertical flows top-to-bottom (pages stacked).
 * The reversed variants reverse the flow within the same grid.
 *
 * `printSheetLayout(pagesPerSheet, pageOrder)` returns:
 *   - `cols` / `rows`: the effective sheet grid for that order. The base
 *     (horizontal) table is 2 -> 2x1, 4 -> 2x2, 6 -> 3x2, 9 -> 3x3,
 *     16 -> 4x4; vertical orders SWAP cols and rows (2 -> 1x2, 6 -> 2x3;
 *     4/9/16 are square so unchanged).
 *   - `slots`: `slots[cellIndex]` is the IMAGE index placed in that grid
 *     CELL, where cells are numbered in DOM order row-major:
 *     `cellIndex = row * cols + col`. So a renderer emits one cell per entry
 *     in order, or places image `slots[cellIndex]` in that cell.
 *
 * Fill rules (general, not tabulated):
 *   - Horizontal:        image k -> row = k / cols,           col = k % cols.
 *   - Horizontal Reversed: image k -> row = k / cols,          col = cols-1 - (k % cols).
 *   - Vertical:          image k -> col = k / rows,            row = k % rows.
 *   - Vertical Reversed: image k -> col = k / rows,            row = rows-1 - (k % rows).
 * (integer division; `cellIndex = row * cols + col`, then `slots[cellIndex] = k`.)
 *
 * Worked 2x2 example (4-up): cols 2, rows 2, so slots has 4 entries.
 *   - horizontal:        [0, 1, 2, 3]  (row-major, left to right)
 *   - horizontalReversed:[1, 0, 3, 2]  (each row right to left)
 *   - vertical:          [0, 2, 1, 3]  (each column top to bottom)
 *   - verticalReversed:  [1, 3, 0, 2]  (each column bottom to top)
 */

export interface PrintSheetLayout {
  cols: number;
  rows: number;
  /** `slots[cellIndex]` = image index occupying that row-major DOM cell. */
  slots: number[];
}

/** Columns/rows per N-up value for the horizontal (left-to-right) orders. */
const BASE_GRID: Record<number, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  9: { cols: 3, rows: 3 },
  16: { cols: 4, rows: 4 },
};

/** True for the orders whose grid is the base table (not swapped). */
function isHorizontalAxis(order: PrintPageOrder): boolean {
  return order === 'horizontal' || order === 'horizontalReversed';
}

/** True for the orders that fill from the far edge of their flow axis. */
function isReversed(order: PrintPageOrder): boolean {
  return order === 'horizontalReversed' || order === 'verticalReversed';
}

/**
 * The N-up sheet layout for a pages-per-sheet value and page order. Pure;
 * `undefined` pageOrder behaves as 'horizontal' (the historical default).
 */
export function printSheetLayout(
  pagesPerSheet: number,
  pageOrder?: PrintPageOrder,
): PrintSheetLayout {
  const order = pageOrder ?? 'horizontal';
  const base = BASE_GRID[pagesPerSheet] ?? BASE_GRID[1];
  const horizontal = isHorizontalAxis(order);
  const cols = horizontal ? base.cols : base.rows;
  const rows = horizontal ? base.rows : base.cols;

  const reversed = isReversed(order);
  const count = cols * rows;
  const slots = new Array<number>(count);
  for (let k = 0; k < count; k += 1) {
    let row: number;
    let col: number;
    if (horizontal) {
      row = Math.floor(k / cols);
      const offset = k % cols;
      col = reversed ? cols - 1 - offset : offset;
    } else {
      col = Math.floor(k / rows);
      const offset = k % rows;
      row = reversed ? rows - 1 - offset : offset;
    }
    slots[row * cols + col] = k;
  }
  return { cols, rows, slots };
}