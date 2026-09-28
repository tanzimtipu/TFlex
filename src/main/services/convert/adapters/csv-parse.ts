/**
 * Phase 53 feature G mode 1 - the pure RFC 4180 reader.
 *
 * No I/O and no PDF knowledge: it turns a decoded CSV string into records and,
 * on top of that, into a single HTML table string. The adapter owns decoding
 * and printing; this module owns the grammar so every RFC edge case is unit-
 * testable without Electron.
 *
 * Streaming shape: `parseCsvRecords` calls back per record and never retains
 * the row list, so `buildCsvTable` accumulates only the growing HTML body
 * string and a small per-column width array - never an array of arrays.
 */

export const CSV_DELIMITER_CANDIDATES = [',', ';', '\t'] as const;

/** Physical lines examined when choosing a delimiter for `'auto'`. */
const SNIFF_LINES = 10;

export interface CsvParseStats {
  /** Records emitted (including the header record). */
  rowCount: number;
  /** Widest record, in cells (header included). */
  columnCount: number;
  /** True when `maxRows` was reached and the rest of the input was not read. */
  hitRowLimit: boolean;
}

/** Strip a leading UTF-8 BOM (U+FEFF) if present. */
export function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Choose a delimiter by counting candidate characters OUTSIDE quoted fields in
 * the first `SNIFF_LINES` physical lines. Ties keep the earlier candidate, so
 * the preference order is `,` then `;` then tab. All-zero counts fall back to
 * a comma.
 */
export function sniffDelimiter(
  text: string,
  candidates: readonly string[] = CSV_DELIMITER_CANDIDATES,
): string {
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate, 0);

  let inQuotes = false;
  let lines = 0;
  const src = stripBom(text);
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === '\n' || ch === '\r') {
      lines += 1;
      if (lines >= SNIFF_LINES) break;
      continue;
    }
    const current = counts.get(ch);
    if (current !== undefined) counts.set(ch, current + 1);
  }

  let best = candidates[0] ?? ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return bestCount > 0 ? best : ',';
}

/** Count delimiter occurrences outside quoted fields in one physical line. */
function countDelimiters(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count += 1;
  }
  return count;
}

/**
 * Conservative content sniff for a mislabelled CSV. Requires at least three
 * non-empty lines that all carry the SAME positive delimiter count - prose with
 * an incidental comma on one line does not qualify. Deliberately strict: a
 * false positive would steal a `.txt` file from the generic text adapter.
 */
export function looksLikeCsvContent(head: string): boolean {
  const lines = stripBom(head)
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 6);
  if (lines.length < 3) return false;
  const delimiter = sniffDelimiter(lines.join('\n'));
  const first = countDelimiters(lines[0], delimiter);
  if (first < 1) return false;
  return lines.every((line) => countDelimiters(line, delimiter) === first);
}

/**
 * Parse `text` as RFC 4180 and emit every record through `onRow(cells, index)`.
 * Handles quoted fields, `""` escaped quotes, embedded newlines/delimiters and
 * a leading BOM. Blank lines are skipped. When `maxRows` records have been
 * emitted the reader stops and reports `hitRowLimit` (never silent truncation).
 */
export function parseCsvRecords(
  text: string,
  delimiter: string,
  onRow: (cells: string[], rowIndex: number) => void,
  maxRows = Number.POSITIVE_INFINITY,
): CsvParseStats {
  const src = stripBom(text);
  const stats: CsvParseStats = { rowCount: 0, columnCount: 0, hitRowLimit: false };
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endRecord = (): boolean => {
    cells.push(cell);
    cell = '';
    if (cells.length === 1 && cells[0] === '') {
      cells = [];
      return true;
    }
    if (stats.rowCount >= maxRows) {
      stats.hitRowLimit = true;
      cells = [];
      return false;
    }
    stats.columnCount = Math.max(stats.columnCount, cells.length);
    onRow(cells, stats.rowCount);
    stats.rowCount += 1;
    cells = [];
    return true;
  };

  let i = 0;
  const length = src.length;
  while (i < length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      if (!endRecord()) break;
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (!endRecord()) break;
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (i >= length && (cell.length > 0 || cells.length > 0)) {
    endRecord();
  }
  return stats;
}

/** Escape a cell for HTML, turning embedded newlines into visible breaks. */
export function escapeCsvCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * `thead { display: table-header-group; }` makes Chromium repeat the header row
 * on every printed page; `table-layout: fixed` plus the generated `<colgroup>`
 * scales columns to the page width.
 */
export const CSV_TABLE_CSS = `
html, body { margin: 0; padding: 0; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td { border: 0.5pt solid #9aa0a6; padding: 2pt 4pt; text-align: left; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
th { background: #f1f3f4; font-weight: bold; }
`.trim();

export interface CsvTableOptions {
  delimiter: string;
  /** Maximum data records read; the rest are reported via `hitRowLimit`. */
  maxRows?: number;
  /** Longest cell length that still influences a column's width share. */
  widthCap?: number;
}

export interface CsvTableBuild {
  html: string;
  /** Widest record, header included. */
  columnCount: number;
  /** Data records (header excluded). */
  rowCount: number;
  /** Data records shorter than the header. */
  raggedRows: number;
  hitRowLimit: boolean;
}

/**
 * Build the paginated table HTML for a CSV source. Header repetition on every
 * printed page comes from the `<thead>` element plus
 * `thead { display: table-header-group; }`.
 */
export function buildCsvTable(source: string, options: CsvTableOptions): CsvTableBuild {
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const widthCap = options.widthCap ?? 40;
  const widths: number[] = [];
  const bodyParts: string[] = [];
  let header: string[] | null = null;
  let rowCount = 0;
  let raggedRows = 0;

  const track = (cells: string[]): void => {
    for (let c = 0; c < cells.length; c += 1) {
      const len = Math.min(cells[c].length, widthCap);
      widths[c] = Math.max(widths[c] ?? 0, len);
    }
  };

  const stats = parseCsvRecords(
    source,
    options.delimiter,
    (cells, index) => {
      track(cells);
      if (index === 0) {
        header = cells;
        return;
      }
      rowCount += 1;
      if (header !== null && cells.length < header.length) raggedRows += 1;
      const tds = cells.map((cell) => `<td>${escapeCsvCell(cell)}</td>`).join('');
      bodyParts.push(`<tr>${tds}</tr>`);
    },
    maxRows,
  );

  // TypeScript's control-flow analysis does not track a `let` assigned inside
  // the parse callback, so widen it explicitly before reading it out here.
  const headerRow: string[] | null = header as string[] | null;
  const columnCount = Math.max(widths.length, headerRow === null ? 0 : headerRow.length);
  const weights: number[] = [];
  for (let c = 0; c < columnCount; c += 1) weights.push(Math.max(4, widths[c] ?? 4));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const colgroup =
    columnCount > 0
      ? `<colgroup>${weights
          .map((weight) => `<col style="width:${((weight / total) * 100).toFixed(2)}%">`)
          .join('')}</colgroup>`
      : '';

  const headerCells = headerRow ?? [];
  const headerHtml =
    headerCells.length > 0
      ? `<thead><tr>${headerCells.map((cell) => `<th>${escapeCsvCell(cell)}</th>`).join('')}</tr></thead>`
      : '';

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>${CSV_TABLE_CSS}</style></head>` +
    `<body><table>${colgroup}${headerHtml}<tbody>${bodyParts.join('')}</tbody></table></body></html>`;

  return {
    html,
    columnCount,
    rowCount,
    raggedRows,
    hitRowLimit: stats.hitRowLimit,
  };
}
