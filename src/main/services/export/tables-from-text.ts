/**
 * Phase 55 feature D — the pure spacing detector behind the `.xlsx` export.
 *
 * Documented heuristic (the one the user-facing fidelity note quotes): a text
 * line is split into cells on runs of two-or-more spaces OR on a tab. A single
 * space is preserved inside a cell, so multi-word cell contents survive. The
 * detector never invents a grid the text does not imply: a page with one long
 * single-spaced line stays a single column.
 *
 * Rows are padded to the widest row so the page's grid has a stable column
 * count (spreadsheet rows of different lengths are ragged otherwise). Blank
 * lines are dropped. The function is pure and fully unit-testable: no ZIP, no
 * SheetJS, no engine.
 */

/** A run of tabs OR two-or-more spaces starts a new cell. */
const CELL_SEPARATOR = /\t+| {2,}/;

/**
 * Split one text line into trimmed cell strings. A line with no separator
 * yields a single cell; a single space stays inside a cell.
 */
export function splitTextLine(line: string): string[] {
  return line.split(CELL_SEPARATOR).map((cell) => cell.trim());
}

/**
 * Turn a page's extracted text into a rectangular grid of cell strings.
 * Returns `[]` for a page with no non-blank text (the caller emits an honest
 * "no extractable text" marker instead of a bogus grid).
 */
export function detectRowsFromText(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    rows.push(splitTextLine(line));
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return [];
  return rows.map((row) => {
    const padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** The worksheet name for a page group: page 1 -> `Page 1`. */
export function pageSheetName(pageIndex: number): string {
  return `Page ${pageIndex}`;
}

/** The honest cell text for a page whose text layer was empty. */
export function noTextMarker(pageIndex: number): string {
  return `(page ${pageIndex} carried no extractable text)`;
}
