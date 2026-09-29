import { describe, expect, it } from 'vitest';
import {
  AUTO_LANDSCAPE_COLUMNS,
  composeSpreadsheetCss,
  planRowBlocks,
  renderWorkbookHtml,
  resolveSheetOrientation,
  SHEET_TABLE_BLOCK_ROWS,
  type SheetGrid,
  type SpreadsheetRenderOptions,
} from '../../../src/main/services/convert/sheet-to-html';

/**
 * Phase 55 feature B — the pure grid -> HTML-table mapper. No SheetJS and no
 * Electron: `SheetGrid` carries display strings only, so every markup rule is
 * asserted directly.
 */

const BASE: SpreadsheetRenderOptions = {
  gridlines: true,
  fitToWidth: true,
  orientation: 'portrait',
  pageSize: 'a4',
  marginMm: 20,
};

function grid(name: string, cells: string[][], merges: SheetGrid['merges'] = []): SheetGrid {
  return { name, cells, merges };
}

describe('phase55 sheet-to-html mapping', () => {
  it('puts the header row in a real thead so it repeats on every page', () => {
    const { html } = renderWorkbookHtml(
      [grid('Data', [['Name', 'Qty'], ['Alice', '2']])],
      BASE,
    );
    expect(html).toContain('<thead><tr>');
    expect(html).toMatch(/<thead><tr><th>Name<\/th><th>Qty<\/th><\/tr><\/thead>/);
    expect(html).toMatch(/<tbody><tr><td>Alice<\/td><td>2<\/td><\/tr><\/tbody>/);
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('names each sheet and starts every sheet after the first on a new page', () => {
    const { html, renderedSheets } = renderWorkbookHtml(
      [
        grid('First', [['a'], ['1']]),
        grid('Second', [['b'], ['2']]),
        grid('Third', [['c'], ['3']]),
      ],
      BASE,
    );
    expect(renderedSheets).toBe(3);
    expect(html).toContain('<h1 class="sheet-name">First</h1>');
    expect(html).toContain('<h1 class="sheet-name">Second</h1>');
    expect(html).toContain('<h1 class="sheet-name">Third</h1>');
    expect(html.match(/<section class="sheet">/g)).toHaveLength(3);
    expect(html).toContain('.sheet + .sheet { page-break-before: always;');
  });

  it('emits percentage column widths in a colgroup', () => {
    const { html } = renderWorkbookHtml(
      [grid('Data', [['Name', 'Qty'], ['Alice', '2000']])],
      BASE,
    );
    expect(html).toContain('<colgroup>');
    expect(html).toMatch(/<col style="width:\d+\.\d{2}%">/);
    const widths = [...html.matchAll(/width:(\d+\.\d{2})%/g)].map((m) =>
      Number(m[1]),
    );
    expect(widths.length).toBe(2);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 0);
  });

  it('renders merges as colspan/rowspan and drops the covered cells', () => {
    const { html } = renderWorkbookHtml(
      [
        grid('Data', [['Merged', '', 'c'], ['x', 'y', 'z']], [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
        ]),
      ],
      BASE,
    );
    expect(html).toContain('<th colspan="2">Merged</th>');
    expect(html).not.toContain('<th>Merged</th><th></th>');

    const tall = renderWorkbookHtml(
      [
        grid('Data', [['A', 'B'], ['', 'C']], [
          { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        ]),
      ],
      BASE,
    );
    expect(tall.html).toContain('<th rowspan="2">A</th>');
    // The covered second-row first cell is not emitted.
    expect(tall.html).toMatch(/<tbody><tr><td>C<\/td><\/tr><\/tbody>/);
  });

  it('renders ragged rows without throwing', () => {
    expect(() =>
      renderWorkbookHtml([grid('Ragged', [['a', 'b', 'c'], ['only-one']])], BASE),
    ).not.toThrow();
    const { html } = renderWorkbookHtml(
      [grid('Ragged', [['a', 'b', 'c'], ['only-one']])],
      BASE,
    );
    expect(html).toMatch(/<tbody><tr><td>only-one<\/td><td><\/td><td><\/td><\/tr><\/tbody>/);
  });

  it('toggles gridlines in the composed CSS', () => {
    const on = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      gridlines: true,
    });
    const off = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      gridlines: false,
    });
    expect(on.html).toContain('border: 0.5pt solid #9aa0a6;');
    expect(off.html).toContain('border: none;');
    expect(off.html).not.toContain('border: 0.5pt solid #9aa0a6;');
  });

  it('toggles fit-to-width table layout', () => {
    const on = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      fitToWidth: true,
    });
    const off = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      fitToWidth: false,
    });
    expect(on.html).toContain('table-layout: fixed; width: 100%;');
    expect(off.html).toContain('table-layout: auto; width: auto;');
  });

  it('honours the orientation setting in the @page rule', () => {
    const portrait = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      orientation: 'portrait',
    });
    const landscape = renderWorkbookHtml([grid('D', [['a'], ['1']])], {
      ...BASE,
      orientation: 'landscape',
    });
    expect(portrait.html).toContain('@page { size: A4;');
    expect(landscape.html).toContain('@page { size: A4 landscape;');
    expect(portrait.html).not.toContain('landscape');
  });

  it('chooses landscape for a wide grid under auto and honours Letter paper', () => {
    const wideRow = new Array(AUTO_LANDSCAPE_COLUMNS + 2)
      .fill(0)
      .map((_, index) => `h${index}`);
    const auto = renderWorkbookHtml(
      [grid('Wide', [wideRow, wideRow])],
      { ...BASE, orientation: 'auto' },
    );
    expect(auto.html).toContain('A4 landscape');
    expect(resolveSheetOrientation('auto', 2)).toBe('portrait');
    expect(
      composeSpreadsheetCss({ ...BASE, pageSize: 'letter' }, 'portrait'),
    ).toContain('size: Letter;');
  });

  it('reports a sheet above the row ceiling with its true count, never silently', () => {
    const cells = [['h'], ['1'], ['2'], ['3']];
    const { html, rowLimitSheets } = renderWorkbookHtml(
      [{ name: 'Big', cells, sourceRowCount: 500, merges: [] }],
      BASE,
      2,
    );
    expect(rowLimitSheets).toEqual([
      { sheet: 'Big', rowCount: 500, renderedRows: 2 },
    ]);
    // Two rendered rows: the header plus one body row.
    expect(html.match(/<tr>/g)).toHaveLength(2);
  });

  it('does not warn when a sheet is under the ceiling', () => {
    const { rowLimitSheets } = renderWorkbookHtml(
      [{ name: 'Small', cells: [['h'], ['1']], sourceRowCount: 2, merges: [] }],
      BASE,
      1000,
    );
    expect(rowLimitSheets).toHaveLength(0);
  });

  it('DEF-389 splits a large body into bounded blocks and never splits a merge', () => {
    expect(planRowBlocks([], 1, 100_001, SHEET_TABLE_BLOCK_ROWS)).toEqual([
      [1, 20_001],
      [20_001, 40_001],
      [40_001, 60_001],
      [60_001, 80_001],
      [80_001, 100_001],
    ]);
    // A merge straddling the first boundary pulls it back to the merge's start.
    const blocks = planRowBlocks(
      [{ s: { r: 19_999, c: 0 }, e: { r: 20_001, c: 1 } }],
      1,
      30_000,
      SHEET_TABLE_BLOCK_ROWS,
    );
    expect(blocks[0]).toEqual([1, 19_999]);
    expect(blocks[1][0]).toBe(19_999);
    for (const [start, end] of blocks) {
      expect(end - start).toBeLessThanOrEqual(SHEET_TABLE_BLOCK_ROWS);
    }
  });
});
