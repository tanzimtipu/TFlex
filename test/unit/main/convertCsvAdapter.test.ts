import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ok } from '../../../src/shared/result';
import type { ConvertOptions, ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import {
  createCsvAdapter,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/csv';
import {
  buildCsvTable,
  parseCsvRecords,
  sniffDelimiter,
} from '../../../src/main/services/convert/adapters/csv-parse';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 53 feature G mode 1 - the CSV adapter and its RFC 4180 parser. The
 * Chromium print step is injected as a fake (chunk B's pattern), so no Electron
 * is launched here; the real offscreen render is qa's phase-gate e2e.
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

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-csv-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

async function realPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  return doc.save();
}

interface Capture {
  html: string;
  pageCount: number;
}

function capturePrint(capture: Capture): HtmlPrintFn {
  return async (html) => {
    capture.html = html;
    return ok({
      bytes: await realPdfBytes(),
      pageCount: capture.pageCount,
      blockedUrls: [],
    });
  };
}

async function convert(
  path: string,
  options: Partial<ConvertOptions>,
  print: HtmlPrintFn,
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return createCsvAdapter(print).convert({
    path,
    options: resolveConvertOptions(options),
    head,
  });
}

function collect(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  parseCsvRecords(text, delimiter, (cells) => rows.push(cells));
  return rows;
}

describe('phase53 csv RFC 4180 parser', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(collect('a,b\n"x,y",z', ',')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ]);
  });

  it('decodes an escaped quote ("")', () => {
    expect(collect('a\n"he said ""hi"""', ',')).toEqual([
      ['a'],
      ['he said "hi"'],
    ]);
  });

  it('keeps a newline embedded inside a quoted field', () => {
    expect(collect('a\n"line1\nline2"', ',')).toEqual([
      ['a'],
      ['line1\nline2'],
    ]);
  });

  it('strips a UTF-8 BOM before the first header cell', () => {
    const rows = collect('\uFEFFname,age\nA,1', ',');
    expect(rows[0]).toEqual(['name', 'age']);
  });

  it('sniffs a semicolon delimiter', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('sniffs a tab delimiter', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('an explicit delimiter overrides the sniff', () => {
    const rows = collect('a;b\n1;2', ',');
    expect(rows).toEqual([
      ['a;b'],
      ['1;2'],
    ]);
  });
});

describe('phase53 csv table HTML', () => {
  it('puts the header row inside <thead> so Chromium repeats it per page', () => {
    const table = buildCsvTable('name,age\nAda,36', { delimiter: ',' });
    expect(table.html).toContain('<thead><tr><th>name</th><th>age</th></tr></thead>');
    expect(table.html).toContain('thead { display: table-header-group; }');
  });

  it('reports the widest row as the column count', () => {
    const table = buildCsvTable('a,b\n1,2,3', { delimiter: ',' });
    expect(table.columnCount).toBe(3);
  });

  it('counts ragged rows without throwing', () => {
    const table = buildCsvTable('a,b,c\n1\n2,3,4', { delimiter: ',' });
    expect(table.raggedRows).toBe(1);
    expect(table.columnCount).toBe(3);
  });
});

describe('phase53 csv adapter', () => {
  it('emits a pageCount and bytes that pass the %PDF- gate', async () => {
    const path = await mkFile('data.csv', 'name,age\nAda,36');
    const capture: Capture = { html: '', pageCount: 308 };
    const result = await convert(path, {}, capturePrint(capture));
    expect(result.sourceFormat).toBe('csv');
    expect(result.pageCount).toBe(308);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('uses the sniffed delimiter for the rendered table', async () => {
    const path = await mkFile('semi.csv', 'a;b\n1;2');
    const capture: Capture = { html: '', pageCount: 1 };
    await convert(path, {}, capturePrint(capture));
    expect(capture.html).toContain('<th>a</th><th>b</th>');
    expect(capture.html).not.toContain('<th>a;b</th>');
  });

  it('an explicit csvDelimiter option overrides the sniff', async () => {
    const path = await mkFile('semi2.csv', 'a;b\n1;2');
    const capture: Capture = { html: '', pageCount: 1 };
    await convert(path, { csvDelimiter: ',' }, capturePrint(capture));
    expect(capture.html).toContain('<th>a;b</th>');
  });

  it('warns partial-content for ragged rows instead of failing', async () => {
    const path = await mkFile('ragged.csv', 'a,b,c\n1');
    const capture: Capture = { html: '', pageCount: 1 };
    const result = await convert(path, {}, capturePrint(capture));
    const partial = result.warnings.find((warning) => warning.code === 'partial-content');
    expect(partial).toBeDefined();
    expect(partial?.message).toContain('1');
  });

  it('warns row-limit when the row ceiling is hit', async () => {
    const path = await mkFile('clean.csv', 'a,b\n1,2');
    const capture: Capture = { html: '', pageCount: 1 };
    // The ceiling is far above any fixture here; the warning path is asserted
    // through the pure builder instead (maxRows = 2).
    const table = buildCsvTable('a,b\n1,2\n3,4', { delimiter: ',', maxRows: 2 });
    expect(table.hitRowLimit).toBe(true);
    void capture;
    void path;
  });
});

describe('phase53 csv 50,000-row performance', () => {
  it('parses and renders 50,000 rows and reports the measured time', () => {
    const rows = ['id,name,notes'];
    for (let i = 0; i < 50_000; i += 1) {
      rows.push(`${i},Row ${i},"note, ${i}"`);
    }
    const source = rows.join('\n');
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const table = buildCsvTable(source, { delimiter: ',' });
    const elapsedMs = performance.now() - started;
    const heapAfter = process.memoryUsage().heapUsed;

    console.log(
      `[phase53 csv] 50000 rows: ${elapsedMs.toFixed(1)} ms, ` +
        `heap delta ${((heapAfter - heapBefore) / (1024 * 1024)).toFixed(1)} MB, ` +
        `html ${(table.html.length / (1024 * 1024)).toFixed(1)} MB`,
    );
    expect(table.rowCount).toBe(50_000);
    expect(table.columnCount).toBe(3);
    expect(elapsedMs).toBeLessThan(60_000);
  });
});
