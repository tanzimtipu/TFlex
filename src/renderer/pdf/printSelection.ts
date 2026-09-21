// Phase 30 — print page selection / ordering (pure).
//
// The print dialog resolves the user's page choice to a final, ordered,
// 1-based page list BEFORE any rasterisation happens. Keeping this pure
// and outside the component means the whole matrix (range syntax, scope,
// odd/even, reverse, validation) is unit-testable without a DOM or a
// pdf.js document.
//
// Order of operations, and why:
//   1. scope  -> the candidate page set (all / current / custom range)
//   2. odd/even -> filter the candidate set
//   3. reverse -> reverse the FILTERED set
// Reversing after filtering matches every mainstream print dialog: "even
// pages only, reverse order" prints ..., 6, 4, 2 — not 2, 4, 6.

export type PrintScope = 'all' | 'current' | 'custom';
export type PrintOddEven = 'all' | 'odd' | 'even';

export interface PageListOk {
  ok: true;
  pages: number[];
}

export interface PageListError {
  ok: false;
  error: string;
}

export type PageListResult = PageListOk | PageListError;

/**
 * DEF-273 — a run of digits long enough to overflow the IEEE-754 integer
 * range parses to Infinity (or a non-safe integer). Such a token is not a
 * real page number: report it as malformed rather than echoing an overflow
 * value back into "Page Infinity is out of range".
 */
function parseSafePageNumber(digits: string): number | null {
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : null;
}

const MALFORMED_ENTRY_ERROR =
  'That entry is not a valid page or range. Use numbers and ranges like 1-5, 8.';

/**
 * Parse an industry-standard page-range string ("1-5, 8, 11-13") into a
 * sorted, de-duplicated list of 1-based page numbers bounded by
 * `totalPages`. Malformed, reversed, out-of-range and empty entries are
 * rejected with a human-readable message (never a silent skip).
 */
export function parsePageRanges(input: string, totalPages: number): PageListResult {
  const source = input.trim();
  if (source === '') {
    return { ok: false, error: 'Enter a page range, for example 1-5, 8, 11-13.' };
  }
  const tokens = source.split(',');
  const pages = new Set<number>();
  for (const raw of tokens) {
    const token = raw.trim();
    if (token === '') {
      return { ok: false, error: 'Empty entry in the page range.' };
    }
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (match !== null) {
      const from = parseSafePageNumber(match[1]);
      const to = parseSafePageNumber(match[2]);
      if (from === null || to === null) {
        return { ok: false, error: MALFORMED_ENTRY_ERROR };
      }
      if (from > to) {
        return { ok: false, error: `Range "${token}" is reversed (start after end).` };
      }
      if (from < 1) {
        return { ok: false, error: `Page ${from} is out of range (1-${totalPages}).` };
      }
      if (to > totalPages) {
        return { ok: false, error: `Page ${to} is out of range (1-${totalPages}).` };
      }
      for (let p = from; p <= to; p += 1) pages.add(p);
      continue;
    }
    if (/^\d+$/.test(token)) {
      const n = parseSafePageNumber(token);
      if (n === null) {
        return { ok: false, error: MALFORMED_ENTRY_ERROR };
      }
      if (n < 1 || n > totalPages) {
        return { ok: false, error: `Page ${n} is out of range (1-${totalPages}).` };
      }
      pages.add(n);
      continue;
    }
    return {
      ok: false,
      error: `"${token}" is not a valid page or range. Use numbers and ranges like 1-5, 8.`,
    };
  }
  const list = Array.from(pages).sort((a, b) => a - b);
  if (list.length === 0) {
    return { ok: false, error: 'Enter a page range, for example 1-5, 8, 11-13.' };
  }
  return { ok: true, pages: list };
}

/**
 * Apply the odd/even filter, then reverse the surviving list when asked.
 * Returns a fresh array.
 */
export function applyOddEvenAndReverse(
  pages: readonly number[],
  oddEven: PrintOddEven,
  reverse: boolean,
): number[] {
  let out = pages.filter((p) => {
    if (oddEven === 'odd') return p % 2 === 1;
    if (oddEven === 'even') return p % 2 === 0;
    return true;
  });
  if (reverse) out = out.slice().reverse();
  return out;
}

/**
 * Resolve the dialog's scope choice to the final ordered 1-based page
 * list the rasteriser will render. Validation is surfaced (not thrown) so
 * the dialog can render the message inline.
 */
export function resolveSelectedPages(args: {
  scope: PrintScope;
  totalPages: number;
  currentPage: number;
  customInput: string;
  oddEven: PrintOddEven;
  reverse: boolean;
}): PageListResult {
  const { scope, totalPages, currentPage, customInput, oddEven, reverse } = args;
  if (totalPages <= 0) {
    return { ok: false, error: 'This document has no pages.' };
  }
  let base: number[];
  if (scope === 'all') {
    base = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (scope === 'current') {
    if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > totalPages) {
      return { ok: false, error: 'Current page is out of range.' };
    }
    base = [currentPage];
  } else {
    const parsed = parsePageRanges(customInput, totalPages);
    if (!parsed.ok) return parsed;
    base = parsed.pages;
  }
  const ordered = applyOddEvenAndReverse(base, oddEven, reverse);
  if (ordered.length === 0) {
    return {
      ok: false,
      error:
        oddEven === 'even'
          ? 'No even pages in the selected range.'
          : oddEven === 'odd'
            ? 'No odd pages in the selected range.'
            : 'No pages selected.',
    };
  }
  return { ok: true, pages: ordered };
}