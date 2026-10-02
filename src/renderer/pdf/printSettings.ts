// Phase 30 — print dialog state -> PrintSettings mapping (pure).
//
// The dialog owns a flat state object; this module maps it onto the
// shared `PrintSettings` contract exactly once, so the mapping is unit
// tested without rendering a component.
//
// Division of labour (verified against the main-process print service):
//   - The RENDERER resolves page selection (range/scope), odd/even and
//     reverse into the ordered image list, and sends ONE image per PDF
//     page. It never composes N-up sheets itself.
//   - The MAIN process chunks the images into sheets of `pagesPerSheet`
//     and applies `pageOrder`, `scaling`/`scalePercent` and `landscape`.
//   - `pageRanges` is therefore intentionally left unset: the selected
//     pages already travel as the image list, and setting Electron
//     page ranges on top would re-index the composed document.

import type {
  BookletSubset,
  PrintDuplex,
  PrintLayoutMode,
  PrintPageOrder,
  PrintScaling,
  PrintSettings,
} from '../../shared/types';
import {
  posterTileGrid,
  type PosterTile,
} from '../../shared/printImposition';
import type { PrintOddEven } from './printSelection';

export type PrintOrientation = 'auto' | 'portrait' | 'landscape';

/** The dialog's fully-resolved control state. */
export interface PrintDialogState {
  deviceName: string | null;
  copies: number;
  collate: boolean;
  scaling: PrintScaling;
  scalePercent: number;
  orientation: PrintOrientation;
  /** Resolved from the first preview page's aspect when orientation is
   *  'auto' (true when the page is wider than tall). Kept explicit so
   *  the auto rule is testable and the backend gets a concrete value. */
  autoLandscape: boolean;
  duplex: PrintDuplex;
  color: boolean;
  pagesPerSheet: number;
  pageOrder: PrintPageOrder;
  oddEven: PrintOddEven;
  reverse: boolean;
  printAnnotations: boolean;
  // Phase 83 - imposition layout controls. `single` keeps the historical
  // N-up/page-order path; `booklet`/`poster` carry their own options.
  layoutMode: PrintLayoutMode;
  bookletGutterPt: number;
  bookletCreepPt: number;
  bookletSubset: BookletSubset;
  posterRows: number;
  posterCols: number;
  posterOverlapPt: number;
  posterScalePercent: number;
  posterCutMarks: boolean;
}

export const PRINT_MIN_COPIES = 1;
export const PRINT_MAX_COPIES = 99;
export const PRINT_MIN_SCALE_PERCENT = 1;
export const PRINT_MAX_SCALE_PERCENT = 500;
export const PRINT_ALLOWED_NUP = [1, 2, 4, 6, 9, 16] as const;

// Phase 83 - the shared option bounds the main-process validator enforces
// (see `validatePrintPayload`), so the dialog clamps/validates to the SAME
// bands rather than inventing its own.
export const PRINT_MIN_BOOKLET_GUTTER_PT = 0;
export const PRINT_MAX_BOOKLET_GUTTER_PT = 72;
export const PRINT_MIN_BOOKLET_CREEP_PT = 0;
export const PRINT_MAX_BOOKLET_CREEP_PT = 36;
export const PRINT_MIN_POSTER_GRID = 1;
export const PRINT_MAX_POSTER_GRID = 10;
export const PRINT_MIN_POSTER_OVERLAP_PT = 0;
export const PRINT_MAX_POSTER_OVERLAP_PT = 72;
export const PRINT_MIN_POSTER_SCALE_PERCENT = 10;
export const PRINT_MAX_POSTER_SCALE_PERCENT = 500;

/** Clamp a copies count to the dialog's 1..99 band. */
export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return PRINT_MIN_COPIES;
  return Math.min(PRINT_MAX_COPIES, Math.max(PRINT_MIN_COPIES, Math.trunc(value)));
}

/** Clamp a custom scale percent to the dialog's 1..500 band. */
export function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(PRINT_MAX_SCALE_PERCENT, Math.max(PRINT_MIN_SCALE_PERCENT, Math.trunc(value)));
}

/** Phase 83 - clamp the booklet binding gap to 0..72 pt (default 0). */
export function clampBookletGutterPt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PRINT_MAX_BOOKLET_GUTTER_PT, Math.max(PRINT_MIN_BOOKLET_GUTTER_PT, value));
}

/** Phase 83 - clamp the booklet creep to 0..36 pt (default 0). */
export function clampBookletCreepPt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PRINT_MAX_BOOKLET_CREEP_PT, Math.max(PRINT_MIN_BOOKLET_CREEP_PT, value));
}

/** Phase 83 - clamp a poster grid axis to an integer 1..10 (default 2). */
export function clampPosterGrid(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(PRINT_MAX_POSTER_GRID, Math.max(PRINT_MIN_POSTER_GRID, Math.trunc(value)));
}

/** Phase 83 - clamp the poster tile overlap to 0..72 pt (default 0). */
export function clampPosterOverlapPt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PRINT_MAX_POSTER_OVERLAP_PT, Math.max(PRINT_MIN_POSTER_OVERLAP_PT, value));
}

/** Phase 83 - clamp the poster scale percent to an integer 10..500 (default 100). */
export function clampPosterScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(
    PRINT_MAX_POSTER_SCALE_PERCENT,
    Math.max(PRINT_MIN_POSTER_SCALE_PERCENT, Math.trunc(value)),
  );
}

/**
 * Phase 83 / DEF-483 - the ONE shared poster-tile derivation.
 *
 * The poster's tiled area represents the ORIGINAL page magnified `scale`
 * times (1 = 100%). `posterTileGrid` lays out the normalized grid rects on a
 * unit page; a tile's region of the ORIGINAL page is that grid rect divided
 * by `scale`. So at `scale = 5` a 2x2 grid samples 0.1 x 0.1 of the page per
 * tile, and the two columns cover 1/5 of the page width - a magnified crop
 * that the composed sheets (fixed paper) then blow back up to a tile each.
 *
 * Both `posterTiles` (preview) and `cropPosterTiles` (print) call this, so the
 * preview and the printed tiles cannot disagree. At `scale = 1` the rects are
 * exactly the pre-DEF-483 grid rects. A non-positive/non-finite `scale`
 * degrades to 1 so a caller can never divide by zero.
 */
export function posterTileRects(
  scale: number,
  rows: number,
  cols: number,
  overlapFraction: number,
): PosterTile[] {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return posterTileGrid(1, 1, rows, cols, overlapFraction).tiles.map((tile) => ({
    row: tile.row,
    col: tile.col,
    sourceX: tile.sourceX / s,
    sourceY: tile.sourceY / s,
    sourceW: tile.sourceW / s,
    sourceH: tile.sourceH / s,
  }));
}

/** The pixel sample rect and draw target for one poster tile crop. */
export interface PosterTileCanvasBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

/**
 * Phase 83 / DEF-483 - turn a normalized ORIGINAL-page tile rect into the
 * pixel box the crop draws with. `sx/sy/sw/sh` sample the region on the
 * raster (which shrinks as `scale` grows); `dw/dh` is the tile's un-magnified
 * cell (`sourceRect * scale`) enlarged by `scale` again, so the magnified
 * content is rasterised at print resolution rather than at the small sampled
 * region's pixel count. At `scale = 1` the sample and target coincide, so the
 * crop is unchanged from before DEF-483.
 */
export function posterTileCanvasBox(
  tile: PosterTile,
  pageWidthPx: number,
  pageHeightPx: number,
  scale: number,
): PosterTileCanvasBox {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const sx = Math.max(0, Math.round(tile.sourceX * pageWidthPx));
  const sy = Math.max(0, Math.round(tile.sourceY * pageHeightPx));
  const sw = Math.max(1, Math.round(tile.sourceW * pageWidthPx));
  const sh = Math.max(1, Math.round(tile.sourceH * pageHeightPx));
  const cellW = Math.max(1, Math.round(tile.sourceW * s * pageWidthPx));
  const cellH = Math.max(1, Math.round(tile.sourceH * s * pageHeightPx));
  const dw = Math.max(1, Math.round(cellW * s));
  const dh = Math.max(1, Math.round(cellH * s));
  return { sx, sy, sw, sh, dw, dh };
}

/**
 * Map the dialog state onto the shared `PrintSettings` contract. Only the
 * fields the backend understands are emitted; `paperSource` is omitted
 * because Electron has no tray option (the UI does not offer one).
 */
export function buildPrintSettings(state: PrintDialogState): PrintSettings {
  const base: PrintSettings = {
    deviceName: state.deviceName ?? undefined,
    copies: clampCopies(state.copies),
    collate: state.copies > 1 ? state.collate : false,
    scaling: state.scaling,
    landscape:
      state.orientation === 'landscape' ||
      (state.orientation === 'auto' && state.autoLandscape),
    duplex: state.duplex,
    color: state.color,
    pagesPerSheet: state.pagesPerSheet,
    pageOrder: state.pageOrder,
    oddEven: state.oddEven,
    reverse: state.reverse,
    printAnnotations: state.printAnnotations,
  };
  // The 'single' (and omitted) path stays byte-identical to pre-Phase-83:
  // no layout key is emitted, so the main compose keeps today's behaviour.
  if (state.layoutMode === 'single') {
    if (state.scaling === 'custom') {
      base.scalePercent = clampScalePercent(state.scalePercent);
    }
    return base;
  }
  const settings: PrintSettings = { ...base };
  // Phase 83 - booklet is a 2-up, landscape imposition; poster is one
  // tile per sheet. Both force `pagesPerSheet` so the main compose chunks
  // the renderer's slot-ordered images correctly.
  if (state.layoutMode === 'booklet') {
    settings.pagesPerSheet = 2;
    settings.landscape = true;
  } else {
    settings.pagesPerSheet = 1;
  }
  // DEF-485 - the page-order control is disabled under Booklet/Poster, so a
  // stale order carried by the dialog state must not leak into the preset or
  // the compose. Booklet/Poster are slot-ordered by construction and the main
  // compose forces horizontal too; emitting it here keeps the renderer half
  // consistent with the disabled control.
  if (state.layoutMode === 'booklet' || state.layoutMode === 'poster') {
    settings.pageOrder = 'horizontal';
  }
  settings.layoutMode = state.layoutMode;
  settings.bookletGutterPt = clampBookletGutterPt(state.bookletGutterPt);
  settings.bookletCreepPt = clampBookletCreepPt(state.bookletCreepPt);
  settings.bookletSubset = state.bookletSubset;
  settings.posterRows = clampPosterGrid(state.posterRows);
  settings.posterCols = clampPosterGrid(state.posterCols);
  settings.posterOverlapPt = clampPosterOverlapPt(state.posterOverlapPt);
  settings.posterScalePercent = clampPosterScalePercent(state.posterScalePercent);
  settings.posterCutMarks = state.posterCutMarks;
  if (state.scaling === 'custom') {
    settings.scalePercent = clampScalePercent(state.scalePercent);
  }
  return settings;
}

/**
 * Phase 37 item 17 - the default `PrintSettings` the print entry points hand
 * the standalone print window. There is no persisted print-settings store
 * (print options are per-print), so this mirrors the control defaults the
 * removed in-app dialog used: fit scaling, simplex, colour, 1-up, all pages,
 * annotations on, no device (the window preselects the system default).
 * Identical to `buildPrintSettings` on the default dialog state.
 */
export function defaultPrintSettings(): PrintSettings {
  return {
    copies: 1,
    collate: false,
    scaling: 'fit',
    landscape: false,
    duplex: 'simplex',
    color: true,
    pagesPerSheet: 1,
    pageOrder: 'horizontal',
    oddEven: 'all',
    reverse: false,
    printAnnotations: true,
  };
}

/** Human labels for each orientation value, shared by the dialog. */
export const ORIENTATION_LABELS: Record<PrintOrientation, string> = {
  auto: 'Auto',
  portrait: 'Portrait',
  landscape: 'Landscape',
};

/**
 * Phase 35 - the control values a print surface seeds from a `PrintSettings`
 * payload (the standalone print window receives one through its
 * `PrintWindowContext`). Pure so the mapping is unit-tested without a render.
 *
 * `scope` / `customInput` are NOT recoverable: the in-app dialog resolves the
 * page choice to an ordered image list before it builds settings and
 * deliberately leaves `pageRanges` unset (see the module header), so the
 * seeded surface starts at "All pages". Orientation is likewise lossy:
 * `landscape` travels as a concrete boolean, so a `false` seeds 'auto' (which
 * reproduces the same concrete landscape for the same document) rather than
 * guessing 'portrait'.
 */
export interface PrintSeedState {
  deviceName: string | null;
  copies: number;
  collate: boolean;
  scaling: PrintScaling;
  scalePercent: number;
  orientation: PrintOrientation;
  duplex: PrintDuplex;
  color: boolean;
  pagesPerSheet: number;
  pageOrder: PrintPageOrder;
  oddEven: PrintOddEven;
  reverse: boolean;
  printAnnotations: boolean;
  // Phase 83
  layoutMode: PrintLayoutMode;
  bookletGutterPt: number;
  bookletCreepPt: number;
  bookletSubset: BookletSubset;
  posterRows: number;
  posterCols: number;
  posterOverlapPt: number;
  posterScalePercent: number;
  posterCutMarks: boolean;
}

export function seedPrintDialogState(settings: PrintSettings): PrintSeedState {
  const layoutMode = settings.layoutMode ?? 'single';
  // DEF-485 - Booklet/Poster disable the page-order control, so a preset
  // carrying a stale order must re-seed as horizontal rather than restoring a
  // value the user could never have set. The single path keeps the stored
  // order unchanged.
  const imposedOrder = layoutMode === 'booklet' || layoutMode === 'poster';
  return {
    deviceName: typeof settings.deviceName === 'string' ? settings.deviceName : null,
    copies: clampCopies(settings.copies ?? PRINT_MIN_COPIES),
    collate: settings.collate ?? false,
    scaling: settings.scaling ?? 'fit',
    scalePercent: clampScalePercent(settings.scalePercent ?? 100),
    orientation: settings.landscape === true ? 'landscape' : 'auto',
    duplex: settings.duplex ?? 'simplex',
    color: settings.color ?? true,
    pagesPerSheet: settings.pagesPerSheet ?? 1,
    pageOrder: imposedOrder ? 'horizontal' : (settings.pageOrder ?? 'horizontal'),
    oddEven: settings.oddEven ?? 'all',
    reverse: settings.reverse ?? false,
    printAnnotations: settings.printAnnotations ?? true,
    layoutMode,
    bookletGutterPt: clampBookletGutterPt(settings.bookletGutterPt ?? 0),
    bookletCreepPt: clampBookletCreepPt(settings.bookletCreepPt ?? 0),
    bookletSubset: settings.bookletSubset ?? 'both',
    posterRows: clampPosterGrid(settings.posterRows ?? 2),
    posterCols: clampPosterGrid(settings.posterCols ?? 2),
    posterOverlapPt: clampPosterOverlapPt(settings.posterOverlapPt ?? 0),
    posterScalePercent: clampPosterScalePercent(settings.posterScalePercent ?? 100),
    posterCutMarks: settings.posterCutMarks ?? false,
  };
}

/** True when a `{ok:false}` reason denotes a user cancellation rather than
 *  a real failure, so the dialog stays quiet instead of showing an error
 *  banner (the virtual-PDF path opens the OS dialog, whose Cancel returns
 *  a "canceled" reason). */
export function isCancelReason(reason: string): boolean {
  return /cancel/i.test(reason);
}