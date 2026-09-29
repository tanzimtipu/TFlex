import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { ConvertFailure } from '../../../src/main/services/convert/errors';
import {
  createOdsAdapter,
  createXlsAdapter,
  createXlsxAdapter,
  looksLikeOds,
  looksLikeXls,
  looksLikeXlsx,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/xlsx';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';
import { SHEET_TABLE_BLOCK_ROWS } from '../../../src/main/services/convert/sheet-to-html';

/**
 * Phase 55 feature B — the SheetJS spreadsheet adapter, driven by REAL
 * workbooks written in-test with SheetJS itself (xlsx/biff8/ods). The print
 * engine is injected, so no Electron is needed.
 */

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
  session: {
    fromPartition: vi.fn(() => ({
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    })),
    defaultSession: {},
  },
  BrowserWindow: class {},
}));

const WIDE_COLUMNS = 40;

/** The 3-sheet workbook: a formula with a cached value, a formatted date, a
 *  merged range and a 40-column wide row on sheet `Data`. */
function buildWorkbook(bookType: 'xlsx' | 'xls' | 'ods'): Buffer {
  const workbook = XLSX.utils.book_new();
  const headers = Array.from({ length: WIDE_COLUMNS }, (_, index) => `h${index}`);
  const zeros = new Array(WIDE_COLUMNS).fill(0);
  const labels = new Array(WIDE_COLUMNS).fill(0).map((_, index) => `r${index}`);
  const sheet = XLSX.utils.aoa_to_sheet([headers, zeros, labels]);
  sheet['C2'] = { t: 'n', v: 3, f: 'A1+B1' };
  sheet['D2'] = { t: 'n', v: 45306.458333333336, z: 'mm/dd/yy' };
  sheet['!merges'] = [{ s: { r: 1, c: 4 }, e: { r: 2, c: 5 } }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['p', 'q'], [1, 2]]),
    'More',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['z'], [9]]),
    'Third',
  );
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType }));
}

let bigRows: Buffer | null = null;
/** A single-sheet 20,000-row workbook for the ceiling and budget cases. */
function buildBigWorkbook(): Buffer {
  if (bigRows !== null) return bigRows;
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 20_000; i += 1) rows.push([i, `cell ${i}`, i * 1.5]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Big');
  bigRows = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return bigRows;
}

function buildEmptyWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Blank');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

let overRows: Buffer | null = null;
/** DEF-389 — a single-sheet "Big" workbook with 100,001 rows (a header row plus
 *  100,000 body rows), one row above `CONVERT_LIMITS.sheetRows` (100,000).
 *  Single column to keep the in-test build cheap. */
function buildOverCeilingWorkbook(): Buffer {
  if (overRows !== null) return overRows;
  const rows: Array<Array<string | number>> = [['n']];
  for (let i = 1; i <= 100_000; i += 1) rows.push([i]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Big');
  overRows = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return overRows;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-xlsx-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, bytes: Uint8Array | string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

interface PrintSpy {
  fn: HtmlPrintFn;
  htmls: string[];
  options: Array<Record<string, unknown>>;
  calls: number;
}

function fakePrint(): PrintSpy {
  const spy: PrintSpy = {
    htmls: [],
    options: [],
    calls: 0,
    fn: async (html, options) => {
      spy.calls += 1;
      spy.htmls.push(html);
      spy.options.push(options as unknown as Record<string, unknown>);
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: 3,
        blockedUrls: [],
      });
    },
  };
  return spy;
}

async function convert(
  path: string,
  print: PrintSpy,
  adapter = createXlsxAdapter(print.fn),
  options = resolveConvertOptions(),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options, head });
}

async function failureOf(run: () => Promise<ConvertResult>): Promise<ConvertFailure> {
  try {
    await run();
  } catch (thrown) {
    if (thrown instanceof ConvertFailure) return thrown;
    throw thrown;
  }
  throw new Error('expected a ConvertFailure');
}

describe('phase55 xlsx adapter', () => {
  it('declares layout fidelity, specific resolution and one adapter per id', () => {
    const xlsx = createXlsxAdapter();
    const xls = createXlsAdapter();
    const ods = createOdsAdapter();
    for (const adapter of [xlsx, xls, ods]) {
      expect(adapter.fidelity).toBe('layout');
      expect(adapter.specificity).toBe('specific');
      expect(adapter.maxBytes).toBeGreaterThan(0);
    }
    expect([xlsx.id, xls.id, ods.id]).toEqual(['xlsx', 'xls', 'ods']);
    expect([xlsx.extensions, xls.extensions, ods.extensions]).toEqual([
      ['.xlsx'],
      ['.xls'],
      ['.ods'],
    ]);
  });

  it('renders every sheet as its own page group with the sheet name', async () => {
    const path = await mkFile('sample.xlsx', buildWorkbook('xlsx'));
    const print = fakePrint();
    const result = await convert(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('xlsx');
    expect(result.fidelity).toBe('layout');
    expect(print.calls).toBe(1);
    const html = print.htmls[0] ?? '';
    expect(html.match(/<section class="sheet">/g)).toHaveLength(3);
    expect(html).toContain('<h1 class="sheet-name">Data</h1>');
    expect(html).toContain('<h1 class="sheet-name">More</h1>');
    expect(html).toContain('<h1 class="sheet-name">Third</h1>');
    expect(html).toContain('.sheet + .sheet { page-break-before: always;');
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('Content-Security-Policy');
  });

  it('renders the formula CACHED VALUE and never the formula string', async () => {
    const path = await mkFile('formula.xlsx', buildWorkbook('xlsx'));
    const print = fakePrint();
    await convert(path, print);
    const html = print.htmls[0] ?? '';
    expect(html).toContain('<td>3</td>');
    expect(html).not.toContain('A1+B1');
  });

  it('renders a date cell per its own number format, not as a serial number', async () => {
    const path = await mkFile('date.xlsx', buildWorkbook('xlsx'));
    const print = fakePrint();
    await convert(path, print);
    const html = print.htmls[0] ?? '';
    expect(html).toContain('01/15/24');
    expect(html).not.toContain('45306');
  });

  it('emits merged spans and a 40-column percentage colgroup', async () => {
    const path = await mkFile('wide.xlsx', buildWorkbook('xlsx'));
    const print = fakePrint();
    await convert(path, print);
    const html = print.htmls[0] ?? '';
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    const firstSection = html.slice(
      html.indexOf('<section class="sheet">'),
      html.indexOf('</section>'),
    );
    expect(firstSection.match(/<col style="width:/g)).toHaveLength(WIDE_COLUMNS);
  });

  it('makes gridlines, fit-to-width and orientation each observable', async () => {
    const path = await mkFile('settings.xlsx', buildWorkbook('xlsx'));

    const gridOff = fakePrint();
    await convert(
      path,
      gridOff,
      createXlsxAdapter(gridOff.fn),
      resolveConvertOptions({ spreadsheetGridlines: false }),
    );
    expect(gridOff.htmls[0]).toContain('border: none;');
    const gridOn = fakePrint();
    await convert(
      path,
      gridOn,
      createXlsxAdapter(gridOn.fn),
      resolveConvertOptions({ spreadsheetGridlines: true }),
    );
    expect(gridOn.htmls[0]).toContain('border: 0.5pt solid #9aa0a6;');

    const fitOff = fakePrint();
    await convert(
      path,
      fitOff,
      createXlsxAdapter(fitOff.fn),
      resolveConvertOptions({ spreadsheetFitToWidth: false }),
    );
    expect(fitOff.htmls[0]).toContain('table-layout: auto; width: auto;');
    const fitOn = fakePrint();
    await convert(
      path,
      fitOn,
      createXlsxAdapter(fitOn.fn),
      resolveConvertOptions({ spreadsheetFitToWidth: true }),
    );
    expect(fitOn.htmls[0]).toContain('table-layout: fixed; width: 100%;');

    const landscape = fakePrint();
    await convert(
      path,
      landscape,
      createXlsxAdapter(landscape.fn),
      resolveConvertOptions({ spreadsheetOrientation: 'landscape' }),
    );
    expect(landscape.htmls[0]).toContain('@page { size: A4 landscape;');
    expect(landscape.options[0]?.preferCSSPageSize).toBe(true);
    const portrait = fakePrint();
    await convert(
      path,
      portrait,
      createXlsxAdapter(portrait.fn),
      resolveConvertOptions({ spreadsheetOrientation: 'portrait' }),
    );
    expect(portrait.htmls[0]).toContain('@page { size: A4;');
    expect(portrait.htmls[0]).not.toContain('landscape');
  });
});

describe('phase55 xls and ods through the same path', () => {
  it('imports a real BIFF8 .xls workbook', async () => {
    const path = await mkFile('sample.xls', buildWorkbook('xls'));
    const print = fakePrint();
    const result = await convert(path, print, createXlsAdapter(print.fn));
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('xls');
    expect(print.calls).toBe(1);
    expect(print.htmls[0]).toContain('<h1 class="sheet-name">Data</h1>');
    expect(print.htmls[0]).toContain('<td>3</td>');
  });

  it('imports a real .ods package verified as a ZIP', async () => {
    const bytes = buildWorkbook('ods');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const path = await mkFile('sample.ods', bytes);
    const print = fakePrint();
    const result = await convert(path, print, createOdsAdapter(print.fn));
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('ods');
    expect(print.calls).toBe(1);
    expect(print.htmls[0]?.match(/<section class="sheet">/g)).toHaveLength(3);
    expect(print.htmls[0]).toContain('<h1 class="sheet-name">Data</h1>');
  });
});

describe('phase55 spreadsheet row ceiling and budget', () => {
  it('warns with the sheet name and the true count above the ceiling', async () => {
    const path = await mkFile('big.xlsx', buildBigWorkbook());
    const print = fakePrint();
    const result = await convert(
      path,
      print,
      createXlsxAdapter(print.fn, undefined, undefined, 10),
    );
    const warning = result.warnings.find((entry) => entry.code === 'row-limit');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Big');
    expect(warning?.message).toContain('20000');
    expect(warning?.message).toContain('first 10');
    // The ceiling never drops rows silently: the warning names them.
    expect(warning?.detail?.length).toBeGreaterThan(0);
  });

  it('completes a 20,000-row workbook within the recorded budget', async () => {
    const path = await mkFile('twenty-k.xlsx', buildBigWorkbook());
    const print = fakePrint();
    const started = Date.now();
    const result = await convert(path, print);
    const elapsedMs = Date.now() - started;
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(print.calls).toBe(1);
    expect(print.htmls[0]?.match(/<tr>/g)?.length).toBe(20_000);
    // Guardrail, not a benchmark: the parse-and-compose half is on the order of
    // a second here; a regression to minutes would fail.
    expect(elapsedMs).toBeLessThan(30_000);
    // eslint-disable-next-line no-console
    process.stdout.write(`[phase55] 20000-row parse+compose wall clock: ${elapsedMs} ms\n`);
  });
});

describe('phase55 spreadsheet failure paths', () => {
  it('returns a typed corrupt failure for a non-container file', async () => {
    const path = await mkFile('broken.xlsx', 'this is not a workbook at all');
    const failure = await failureOf(() => convert(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('returns a typed corrupt failure for a truncated workbook', async () => {
    const path = await mkFile('truncated.xlsx', buildWorkbook('xlsx').subarray(0, 400));
    const failure = await failureOf(() => convert(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
  });

  it('returns a readable typed error for an empty workbook, never an empty document', async () => {
    const path = await mkFile('empty.xlsx', buildEmptyWorkbook());
    const print = fakePrint();
    const failure = await failureOf(() => convert(path, print));
    expect(failure.code).toBe('decode-failed');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);
  });

  it('routes a zip-bombed .ods through the shared ZIP ceiling', async () => {
    const bomb = zipSync({
      'content.xml': new Uint8Array(200_000),
      style: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
    });
    const path = await mkFile('bomb.ods', bomb);
    const adapter = createOdsAdapter(fakePrint().fn, undefined, {
      maxEntries: 8,
      maxTotalUncompressedBytes: 1024,
      maxEntryUncompressedBytes: 1024,
    });
    const failure = await failureOf(() => convert(path, fakePrint(), adapter));
    expect(failure.code).toBe('too-large');
  });
});

describe('phase55 spreadsheet sniff discrimination', () => {
  it('distinguishes xlsx, ods and xls by content, not just the ZIP signature', () => {
    const xlsxHead = Buffer.from(buildWorkbook('xlsx').subarray(0, 4096));
    const odsHead = Buffer.from(buildWorkbook('ods').subarray(0, 4096));
    const xlsHead = Buffer.from(buildWorkbook('xls').subarray(0, 4096));

    expect(looksLikeXlsx(xlsxHead)).toBe(true);
    expect(looksLikeXlsx(odsHead)).toBe(false);
    expect(looksLikeOds(odsHead)).toBe(true);
    expect(looksLikeOds(xlsxHead)).toBe(false);

    // .xls is OLE/CFB: the D0 CF 11 E0 A1 B1 1A E1 signature plus a Workbook
    // stream, and it is NOT a ZIP.
    expect(xlsHead.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    expect(looksLikeXls('legacy.xls', xlsHead)).toBe(true);
    expect(looksLikeXls('mislabelled.bin', xlsHead)).toBe(true);
    expect(looksLikeXls('legacy.xls', xlsxHead)).toBe(false);
    expect(looksLikeXlsx(xlsHead)).toBe(false);
  });

  it('resolves all three extensions and content-sniffs a misnamed .ods', async () => {
    const registry = createDefaultRegistry();
    const xlsxPath = await mkFile('r.xlsx', buildWorkbook('xlsx'));
    const xlsPath = await mkFile('r.xls', buildWorkbook('xls'));
    const odsPath = await mkFile('r.ods', buildWorkbook('ods'));
    expect((await registry.resolve(xlsxPath, await readSniffHead(xlsxPath)))?.adapter.id).toBe('xlsx');
    expect((await registry.resolve(xlsPath, await readSniffHead(xlsPath)))?.adapter.id).toBe('xls');
    expect((await registry.resolve(odsPath, await readSniffHead(odsPath)))?.adapter.id).toBe('ods');

    const misnamed = await mkFile('misnamed.xlsx', buildWorkbook('ods'));
    const resolved = await registry.resolve(misnamed, await readSniffHead(misnamed));
    expect(resolved?.adapter.id).toBe('ods');
    expect(resolved?.byExtension).toBe(false);
  });
});

/** The measured boundary: a 20,000-row table prints; a 25,000-row table fails
 *  with Chromium's "Printing failed". The emulated print below rejects any
 *  single table above 24,000 rows, standing in for that Chromium limit. */
const EMULATED_CHROMIUM_MAX_TABLE_ROWS = 24_000;

/** `<tr>` count of each `<table>` in the composed document. */
function tableRowCounts(html: string): number[] {
  return [...html.matchAll(/<table>[\s\S]*?<\/table>/g)].map(
    (match) => (match[0].match(/<tr>/g) ?? []).length,
  );
}

/**
 * A print engine that fails exactly the way Chromium's `printToPDF` does when a
 * single table is too tall. It is the DEF-389 guard: before the fix the whole
 * 100,000-row sheet was ONE table and this rejected it; after the fix the sheet
 * is emitted as <= `SHEET_TABLE_BLOCK_ROWS`-row tables and it prints.
 */
function emulatedChromiumPrint(): PrintSpy {
  const spy = fakePrint();
  spy.fn = async (html, options) => {
    spy.calls += 1;
    spy.htmls.push(html);
    spy.options.push(options as unknown as Record<string, unknown>);
    const over = tableRowCounts(html).some(
      (rows) => rows > EMULATED_CHROMIUM_MAX_TABLE_ROWS,
    );
    if (over) throw new Error('Failed to generate PDF: Printing failed');
    return ok({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      pageCount: 3,
      blockedUrls: [],
    });
  };
  return spy;
}

describe('DEF-389 — an above-ceiling sheet is capped before composing, then printed in bounded tables', () => {
  it('prints a 100,001-row sheet (default ceiling) as bounded tables with the row-limit warning', async () => {
    const path = await mkFile('over.xlsx', buildOverCeilingWorkbook());
    const print = emulatedChromiumPrint();
    const started = Date.now();
    const result = await convert(path, print);
    const elapsedMs = Date.now() - started;

    // The whole conversion succeeds; it is not a print failure.
    expect(isPdfBytes(result.bytes)).toBe(true);

    const warning = result.warnings.find((entry) => entry.code === 'row-limit');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Big');
    expect(warning?.message).toContain('100001');
    expect(warning?.message).toContain('first 100000');

    // 100,000 rows are rendered (the ceiling), split into 5 bounded tables.
    const counts = tableRowCounts(print.htmls[0] ?? '');
    expect(counts).toHaveLength(5);
    expect(Math.max(...counts)).toBeLessThanOrEqual(SHEET_TABLE_BLOCK_ROWS + 1);
    // Every rendered row is present: 5 table headers + 99,999 body rows (the
    // 100,000-row ceiling counts the header row, exactly as worksheetToGrid caps).
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(100_004);

    // eslint-disable-next-line no-console
    process.stdout.write(
      `[DEF-389] 100001-row parse+compose wall clock: ${elapsedMs} ms; tables=${counts.join(',')}\n`,
    );
  });

  it('keeps the 20,000-row sheet as ONE table with all rows and no warning', async () => {
    const path = await mkFile('twenty-k.xlsx', buildBigWorkbook());
    const print = emulatedChromiumPrint();
    const result = await convert(path, print);
    expect(result.warnings.some((entry) => entry.code === 'row-limit')).toBe(false);
    const counts = tableRowCounts(print.htmls[0] ?? '');
    expect(counts).toEqual([20_000]);
  });
});


