import { OFFICE_PRINT_CSS } from './adapters/docx';

/**
 * Phase 55 feature B — the pure grid -> HTML-table mapper for spreadsheets.
 *
 * No SheetJS and no I/O live here: the `.xlsx`/`.xls`/`.ods` adapter decodes a
 * worksheet into `SheetGrid` (display strings only, formula CACHED VALUES) and
 * this module owns the markup. Keeping the mapping pure makes every rule
 * (header repetition, merges, percentage columns, the row ceiling) unit-testable
 * with no Electron and no workbook fixture.
 *
 * Reuses the chunk-A office print shell (`OFFICE_PRINT_CSS`) and adds the
 * spreadsheet rules on top. Header repetition on every printed page is the CSV
 * adapter's technique: a real `<thead>` plus
 * `thead { display: table-header-group; }`.
 */

/** One merged region, already decoded to zero-based grid coordinates. */
export interface SheetMerge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** A decoded worksheet: display strings only (never a formula string), the
 *  merge regions, and the sheet name. Row 0 is the header row. */
export interface SheetGrid {
  name: string;
  /** cells[row][column]; rectangular, ragged source rows padded with ''. */
  cells: string[][];
  merges: SheetMerge[];
  /** The sheet's TRUE source row count. Defaults to `cells.length`; a caller
   *  that already capped `cells` sets this so the ceiling is still reported. */
  sourceRowCount?: number;
}

export interface SpreadsheetRenderOptions {
  gridlines: boolean;
  fitToWidth: boolean;
  orientation: 'auto' | 'portrait' | 'landscape';
  pageSize: 'a4' | 'letter';
  marginMm: number;
}

export interface SheetRowLimit {
  sheet: string;
  /** The sheet's true row count (rows that exist in the source). */
  rowCount: number;
  /** Rows actually rendered after the ceiling. */
  renderedRows: number;
}

export interface WorkbookRender {
  html: string;
  /** Sheets that exceeded the row ceiling, with their true counts. */
  rowLimitSheets: SheetRowLimit[];
  /** Sheets that contributed at least one cell. */
  renderedSheets: number;
  /** Widest sheet, in columns (drives the `auto` orientation choice). */
  maxColumns: number;
}

/** Above this many columns an `auto` orientation chooses landscape. */
export const AUTO_LANDSCAPE_COLUMNS = 8;

/**
 * DEF-389 — the largest number of body rows one `<table>` may carry.
 *
 * Chromium's `printToPDF` fails a single table above roughly 25,000 rows (a
 * 20,000-row table prints; a 25,000-row table errors with "Printing failed"),
 * so a sheet rendered as one giant table above the ceiling could never print.
 * A sheet is therefore emitted as consecutive `<table>` blocks of at most this
 * many body rows, each repeating the header row in its own `<thead>`. 20,000 is
 * the exact size criterion 5 already verifies, so that fixture is unchanged.
 */
export const SHEET_TABLE_BLOCK_ROWS = 20_000;

/** The longest cell text that still influences a column's width share. */
const COLUMN_WIDTH_CAP = 40;

/**
 * Resolve the print orientation. `portrait` and `landscape` are literal;
 * `auto` picks landscape for a wide grid (more than `AUTO_LANDSCAPE_COLUMNS`
 * columns) and portrait otherwise. Deterministic, so it is observable.
 */
export function resolveSheetOrientation(
  orientation: SpreadsheetRenderOptions['orientation'],
  maxColumns: number,
): 'portrait' | 'landscape' {
  if (orientation === 'portrait' || orientation === 'landscape') {
    return orientation;
  }
  return maxColumns > AUTO_LANDSCAPE_COLUMNS ? 'landscape' : 'portrait';
}

function escapeCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/** Compose the spreadsheet stylesheet from the three Settings toggles. */
export function composeSpreadsheetCss(
  options: SpreadsheetRenderOptions,
  orientation: 'portrait' | 'landscape',
): string {
  const paper = options.pageSize === 'letter' ? 'Letter' : 'A4';
  const pageCss = `@page { size: ${paper}${
    orientation === 'landscape' ? ' landscape' : ''
  }; margin: ${options.marginMm}mm; }`;
  const borders = options.gridlines
    ? 'border: 0.5pt solid #9aa0a6;'
    : 'border: none;';
  const layout = options.fitToWidth
    ? 'table-layout: fixed; width: 100%;'
    : 'table-layout: auto; width: auto;';
  return `
${pageCss}
table { border-collapse: collapse; ${layout} font-family: Arial, Helvetica, sans-serif; font-size: 8pt; margin: 0 0 6pt; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td { ${borders} padding: 2pt 4pt; text-align: left; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
th { background: #f1f3f4; font-weight: bold; }
.sheet-name { font-size: 13pt; font-weight: bold; margin: 0 0 4pt; }
.sheet + .sheet { page-break-before: always; break-before: page; }
`.trim();
}

interface MergeIndex {
  /** Top-left cell key -> span attributes. */
  origin: Map<string, { rowspan: number; colspan: number }>;
  /** Every non-origin cell inside a merge region. */
  covered: Set<string>;
}

function key(row: number, column: number): string {
  return `${row},${column}`;
}

/** Clamp the merge regions to the rendered rectangle and index their spans. */
function indexMerges(
  merges: SheetMerge[],
  rowCount: number,
  columnCount: number,
): MergeIndex {
  const origin = new Map<string, { rowspan: number; colspan: number }>();
  const covered = new Set<string>();
  for (const merge of merges) {
    const r1 = Math.max(0, merge.s.r);
    const c1 = Math.max(0, merge.s.c);
    const r2 = Math.min(rowCount - 1, merge.e.r);
    const c2 = Math.min(columnCount - 1, merge.e.c);
    if (r2 < r1 || c2 < c1) continue;
    origin.set(key(r1, c1), { rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        if (r === r1 && c === c1) continue;
        covered.add(key(r, c));
      }
    }
  }
  return { origin, covered };
}

function cellMarkup(
  tag: 'th' | 'td',
  text: string,
  row: number,
  column: number,
  merges: MergeIndex,
): string {
  const span = merges.origin.get(key(row, column));
  const attributes: string[] = [];
  if (span !== undefined && span.colspan > 1) attributes.push(`colspan="${span.colspan}"`);
  if (span !== undefined && span.rowspan > 1) attributes.push(`rowspan="${span.rowspan}"`);
  const attr = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
  return `<${tag}${attr}>${escapeCell(text)}</${tag}>`;
}

/**
 * Percentage `<colgroup>` mirroring the CSV adapter: each column's weight is
 * the longest cell text (capped) with a floor of 4, normalised to 100%.
 */
function buildColgroup(cells: string[][], columnCount: number): string {
  if (columnCount === 0) return '';
  const widths: number[] = [];
  for (const row of cells) {
    for (let c = 0; c < columnCount; c += 1) {
      const length = Math.min((row[c] ?? '').length, COLUMN_WIDTH_CAP);
      widths[c] = Math.max(widths[c] ?? 0, length);
    }
  }
  const weights = widths.map((width) => Math.max(4, width));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cols = weights
    .map((weight) => `<col style="width:${((weight / total) * 100).toFixed(2)}%">`)
    .join('');
  return `<colgroup>${cols}</colgroup>`;
}

/**
 * Partition body rows [startRow, endRow) into consecutive blocks of at most
 * `blockRows`. A boundary is pulled back to a merge region's first row when the
 * merge would otherwise straddle it, so a merge's origin and every covered cell
 * always land in the same `<table>` (DEF-389).
 */
export function planRowBlocks(
  merges: SheetMerge[],
  startRow: number,
  endRow: number,
  blockRows: number,
): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let start = startRow;
  while (start < endRow) {
    const boundary = Math.min(start + blockRows, endRow);
    let end = boundary;
    if (boundary < endRow) {
      for (const merge of merges) {
        if (merge.s.r < boundary && merge.e.r >= boundary) {
          end = Math.min(end, Math.max(start + 1, merge.s.r));
        }
      }
    }
    blocks.push([start, end]);
    start = end;
  }
  return blocks;
}

function renderSheet(
  sheet: SheetGrid,
  maxRows: number,
): { html: string; rowLimit: SheetRowLimit | null; columnCount: number } {
  const totalRows = sheet.cells.length;
  if (totalRows === 0) {
    return { html: '', rowLimit: null, columnCount: 0 };
  }
  const trueRowCount = sheet.sourceRowCount ?? totalRows;
  const columnCount = sheet.cells.reduce(
    (widest, row) => Math.max(widest, row.length),
    0,
  );
  const renderedRows = Math.min(totalRows, maxRows);
  const merges = indexMerges(sheet.merges, renderedRows, columnCount);
  const colgroup = buildColgroup(sheet.cells.slice(0, renderedRows), columnCount);

  const header = sheet.cells[0] ?? [];
  const headerCells: string[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (merges.covered.has(key(0, c))) continue;
    headerCells.push(cellMarkup('th', header[c] ?? '', 0, c, merges));
  }
  const head = `<thead><tr>${headerCells.join('')}</tr></thead>`;

  // One table per block; each repeats the header so a printed page always
  // carries column names. A header-only sheet keeps its (empty) body table.
  const blocks = planRowBlocks(sheet.merges, 1, renderedRows, SHEET_TABLE_BLOCK_ROWS);
  if (blocks.length === 0) blocks.push([1, 1]);
  const tables: string[] = [];
  for (const [blockStart, blockEnd] of blocks) {
    const bodyRows: string[] = [];
    for (let r = blockStart; r < blockEnd; r += 1) {
      const row = sheet.cells[r] ?? [];
      const tds: string[] = [];
      for (let c = 0; c < columnCount; c += 1) {
        if (merges.covered.has(key(r, c))) continue;
        tds.push(cellMarkup('td', row[c] ?? '', r, c, merges));
      }
      bodyRows.push(`<tr>${tds.join('')}</tr>`);
    }
    tables.push(`<table>${colgroup}${head}<tbody>${bodyRows.join('')}</tbody></table>`);
  }

  const html =
    `<section class="sheet"><h1 class="sheet-name">${escapeCell(sheet.name)}</h1>` +
    tables.join('') +
    `</section>`;
  const rowLimit =
    trueRowCount > renderedRows
      ? { sheet: sheet.name, rowCount: trueRowCount, renderedRows }
      : null;
  return { html, rowLimit, columnCount };
}

/**
 * Render every non-empty sheet into ONE HTML document: one page group per
 * sheet (`.sheet + .sheet` breaks the page), the header row repeated on every
 * printed page by the `<thead>` technique, percentage column widths, merged
 * spans, and the three Settings toggles applied. A sheet above `maxRows` is
 * rendered up to the ceiling and reported in `rowLimitSheets` — never dropped
 * silently. A sheet whose body exceeds `SHEET_TABLE_BLOCK_ROWS` is emitted as
 * several consecutive tables (DEF-389), so the print engine is never handed a
 * single table taller than it can print.
 */
export function renderWorkbookHtml(
  sheets: SheetGrid[],
  options: SpreadsheetRenderOptions,
  maxRows = Number.POSITIVE_INFINITY,
): WorkbookRender {
  const sections: string[] = [];
  const rowLimitSheets: SheetRowLimit[] = [];
  let maxColumns = 0;

  for (const sheet of sheets) {
    const rendered = renderSheet(sheet, maxRows);
    if (rendered.html.length === 0) continue;
    sections.push(rendered.html);
    maxColumns = Math.max(maxColumns, rendered.columnCount);
    if (rendered.rowLimit !== null) rowLimitSheets.push(rendered.rowLimit);
  }

  const orientation = resolveSheetOrientation(options.orientation, maxColumns);
  const css = `${OFFICE_PRINT_CSS}\n${composeSpreadsheetCss(options, orientation)}`;
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${css}</style></head><body>${sections.join('')}</body></html>`;

  return {
    html,
    rowLimitSheets,
    renderedSheets: sections.length,
    maxColumns,
  };
}