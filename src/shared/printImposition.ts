import type { BookletSubset } from './types';

/**
 * Phase 83 — the SINGLE source of truth for booklet and poster imposition math.
 *
 * Pure: no DOM, no `fs`, no Electron imports. Both the renderer preview and
 * the main compose consume this module, so preview and print can never
 * disagree (same single-source-of-truth rule as `src/shared/printLayout.ts`).
 *
 * `bookletPageCount(pageCount)`
 *   The page count padded up to the next multiple of 4 so every saddle-stitch
 *   sheet carries four pages; 0 for a non-positive (or non-finite) input.
 *
 * `saddleStitchSequence(pageCount, subset)`
 *   Flat ordered list of 1-based page numbers (or `null` for a blank) emitted
 *   for the chosen `subset`. P = bookletPageCount(pageCount), S = P / 4 sheets.
 *   Sheet i (0-based): front side = [P-2i, 2i+1], back side = [2i+2, P-2i-1].
 *   Any value > pageCount is a blank (`null`). `both` emits front then back per
 *   sheet; `front`/`back` emit only that side. pageCount 8, `both`:
 *   [8,1,2,7,6,3,4,5].
 *
 * `bookletSideOffset(sheetIndex, sheetCount, gutterPt, creepPt)`
 *   Inward margin (points) for the left and right page cell of one sheet side.
 *   The gutter is split evenly onto the two inner edges, and creep shifts each
 *   cell inward toward the spine, growing toward the middle sheets:
 *     d     = min(sheetIndex, sheetCount - 1 - sheetIndex)
 *     maxD  = max(1, floor((sheetCount - 1) / 2))
 *     creep = creepPt * (d / maxD)
 *     margin = gutterPt / 2 + creep
 *   `leftPt === rightPt === margin`; the creep term is 0 when creepPt is 0 and
 *   the whole margin is 0 when both inputs are 0. Symmetric across sheet i and
 *   sheet sheetCount-1-i; monotonic from the outer sheets toward the middle.
 *
 * `posterTileGrid(pageWidth, pageHeight, rows, cols, overlap)`
 *   One page tiled across a rows x cols grid. With rows/cols clamped to >= 1:
 *     tileW = (pageWidth  + overlap * (cols - 1)) / cols
 *     tileH = (pageHeight + overlap * (rows - 1)) / rows
 *     stepX = tileW - overlap;  stepY = tileH - overlap
 *   Tiles are row-major: the tile at (row, col) has source
 *     { sourceX: col*stepX, sourceY: row*stepY, sourceW: tileW, sourceH: tileH }.
 *   `sheets = rows * cols`; all units match the inputs.
 */

/** Pages padded up to the next multiple of 4; 0 for a non-positive count. */
export function bookletPageCount(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  return Math.ceil(pageCount / 4) * 4;
}

/** One source rectangle of a poster tile, in the same units as the page. */
export interface PosterTile {
  row: number;
  col: number;
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
}

/** The flat saddle-stitch side sequence: 1-based pages, `null` = blank slot. */
export function saddleStitchSequence(
  pageCount: number,
  subset: BookletSubset,
): (number | null)[] {
  const P = bookletPageCount(pageCount);
  if (P === 0) return [];
  const sheets = P / 4;
  const blank = (value: number): number | null =>
    value > pageCount ? null : value;
  const out: (number | null)[] = [];
  for (let i = 0; i < sheets; i += 1) {
    if (subset === 'both' || subset === 'front') {
      out.push(blank(P - 2 * i), blank(2 * i + 1));
    }
    if (subset === 'both' || subset === 'back') {
      out.push(blank(2 * i + 2), blank(P - 2 * i - 1));
    }
  }
  return out;
}

/** Inward margin (points) for the left/right page cell of a sheet side. */
export function bookletSideOffset(
  sheetIndex: number,
  sheetCount: number,
  gutterPt: number,
  creepPt: number,
): { leftPt: number; rightPt: number } {
  const count = Math.max(1, sheetCount);
  const idx = Math.max(0, Math.min(sheetIndex, count - 1));
  const distance = Math.min(idx, count - 1 - idx);
  const maxDistance = Math.max(1, Math.floor((count - 1) / 2));
  const margin = gutterPt / 2 + creepPt * (distance / maxDistance);
  return { leftPt: margin, rightPt: margin };
}

/** Row-major poster tile grid plus the total sheet count. */
export function posterTileGrid(
  pageWidth: number,
  pageHeight: number,
  rows: number,
  cols: number,
  overlap: number,
): { tiles: PosterTile[]; sheets: number } {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));
  const tileW = (pageWidth + overlap * (c - 1)) / c;
  const tileH = (pageHeight + overlap * (r - 1)) / r;
  const stepX = tileW - overlap;
  const stepY = tileH - overlap;
  const tiles: PosterTile[] = [];
  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) {
      tiles.push({
        row,
        col,
        sourceX: col * stepX,
        sourceY: row * stepY,
        sourceW: tileW,
        sourceH: tileH,
      });
    }
  }
  return { tiles, sheets: r * c };
}
