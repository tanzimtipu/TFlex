import { describe, expect, it } from 'vitest';
import {
  detectRowsFromText,
  noTextMarker,
  pageSheetName,
  splitTextLine,
} from '../../../src/main/services/export/tables-from-text';

/**
 * Phase 55 feature D — the pure spacing detector behind the .xlsx export.
 * No ZIP, no SheetJS, no engine: the whole rule is unit-testable here.
 */
describe('phase55 export table detector', () => {
  it('splits a line on runs of two-or-more spaces', () => {
    expect(splitTextLine('Name     Amount')).toEqual(['Name', 'Amount']);
    expect(splitTextLine('a  b   c')).toEqual(['a', 'b', 'c']);
  });

  it('splits a line on a tab (and runs of tabs)', () => {
    expect(splitTextLine('col1\tcol2\tcol3')).toEqual(['col1', 'col2', 'col3']);
    expect(splitTextLine('a\t\tb')).toEqual(['a', 'b']);
  });

  it('preserves a single space inside a cell', () => {
    expect(splitTextLine('hello world  x')).toEqual(['hello world', 'x']);
    expect(detectRowsFromText('New York  123')).toEqual([['New York', '123']]);
  });

  it('pads ragged rows to a stable column count', () => {
    const rows = detectRowsFromText('a  b  c\nd\ne  f');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(3);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['d', '', '']);
    expect(rows[2]).toEqual(['e', 'f', '']);
  });

  it('returns no rows for an empty or whitespace-only page', () => {
    expect(detectRowsFromText('')).toEqual([]);
    expect(detectRowsFromText('   \n\t\n  ')).toEqual([]);
  });

  it('keeps a page with one long single-spaced line as one column', () => {
    const rows = detectRowsFromText(
      'This is a single long line with many normal spaces and no table structure',
    );
    expect(rows).toEqual([
      ['This is a single long line with many normal spaces and no table structure'],
    ]);
  });

  it('ignores blank lines but keeps the table rows around them', () => {
    expect(detectRowsFromText('a  b\n\n\nc  d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('names page sheets and the no-text marker deterministically', () => {
    expect(pageSheetName(1)).toBe('Page 1');
    expect(pageSheetName(12)).toBe('Page 12');
    expect(noTextMarker(3)).toContain('page 3');
    expect(noTextMarker(3)).toContain('no extractable text');
  });
});
