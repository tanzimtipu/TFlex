import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { ConvertFailure } from '../../../src/main/services/convert/errors';
import {
  comicImageDataUri,
  createCbzAdapter,
  createCbtAdapter,
  looksLikeCbt,
  looksLikeCbz,
  naturalCompare,
  sortComicEntries,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/comic';
import {
  readTar,
  TarReadError,
} from '../../../src/main/services/convert/tar-read';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 56 feature C — the `.cbz`/`.cbt` comic adapters, driven by REAL
 * containers built in-test (fflate for ZIP, a hand-rolled ustar writer for
 * TAR). The print engine is injected, so no Electron is needed.
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

/** A complete 1x1 PNG (the shared Phase 54/55 fixture). */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);

/** Distinct bytes per page so each `data:` URI is unique and order is provable. */
function pageBytes(name: string): Uint8Array {
  const tag = Number(name.replace(/[^0-9]/g, '')) & 0xff;
  return new Uint8Array(Buffer.concat([PNG, Buffer.from([tag])]));
}

/** The 12 page names, deliberately in a scrambled (non-natural) order. */
const PAGE_NAMES = [
  'p3.png',
  'p1.png',
  'p12.png',
  'p10.png',
  'p2.png',
  'p11.png',
  'p4.png',
  'p9.png',
  'p5.png',
  'p8.png',
  'p6.png',
  'p7.png',
];

/** Natural order of PAGE_NAMES. */
const NATURAL_ORDER = [
  'p1.png',
  'p2.png',
  'p3.png',
  'p4.png',
  'p5.png',
  'p6.png',
  'p7.png',
  'p8.png',
  'p9.png',
  'p10.png',
  'p11.png',
  'p12.png',
];

function buildCbz(names: readonly string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const name of names) files[name] = pageBytes(name);
  return zipSync(files);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function writeAscii(buf: Uint8Array, at: number, text: string, length: number): void {
  for (let i = 0; i < length; i += 1) {
    buf[at + i] = i < text.length ? text.charCodeAt(i) : 0;
  }
}

function writeOctal(buf: Uint8Array, at: number, value: number, length: number): void {
  writeAscii(buf, at, value.toString(8).padStart(length - 1, '0'), length - 1);
  buf[at + length - 1] = 0;
}

/** One ustar header: octal size, `ustar` magic, a valid checksum. */
function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  writeAscii(header, 0, name, 100);
  writeOctal(header, 100, 0o644, 8);
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);
  writeOctal(header, 124, size, 12);
  writeOctal(header, 136, 0, 12);
  header[156] = 0x30; // regular file
  writeAscii(header, 257, 'ustar\0', 6);
  writeAscii(header, 263, '00', 2);
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  writeAscii(header, 148, sum.toString(8).padStart(6, '0'), 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function buildTar(names: readonly string[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const name of names) {
    const bytes = pageBytes(name);
    blocks.push(tarHeader(name, bytes.length));
    const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    padded.set(bytes, 0);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(512), new Uint8Array(512));
  return concatBytes(blocks);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-comic-'));
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
  calls: number;
}

/** The injected engine: it counts `.comic-page` divs as the page count, so a
 *  test can assert the produced page count without a real Chromium print. */
function fakePrint(): PrintSpy {
  const spy: PrintSpy = {
    htmls: [],
    calls: 0,
    fn: async (html) => {
      spy.calls += 1;
      spy.htmls.push(html);
      const pageCount = (html.match(/class="comic-page"/g) ?? []).length;
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount,
        blockedUrls: [],
      });
    },
  };
  return spy;
}

async function convertCbz(
  path: string,
  print: PrintSpy,
  adapter = createCbzAdapter(print.fn),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options: resolveConvertOptions(), head });
}

async function convertCbt(
  path: string,
  print: PrintSpy,
  adapter = createCbtAdapter(print.fn),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options: resolveConvertOptions(), head });
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

describe('phase56 comic natural order', () => {
  it('orders p2 before p10 with numeric collation', () => {
    expect(naturalCompare('p2.png', 'p10.png')).toBeLessThan(0);
    expect(naturalCompare('p10.png', 'p9.png')).toBeGreaterThan(0);
  });

  it('sorts the scrambled page set into p1..p12 without mutating the input', () => {
    const input = [...PAGE_NAMES];
    const sorted = sortComicEntries(input.map((name) => ({ name })));
    expect(sorted.map((entry) => entry.name)).toEqual(NATURAL_ORDER);
    expect(input).toEqual(PAGE_NAMES);
  });
});

describe('phase56 cbz adapter', () => {
  it('converts a 12-image CBZ to 12 pages in natural order (p10 after p9)', async () => {
    const path = await mkFile('book.cbz', buildCbz(PAGE_NAMES));
    const print = fakePrint();
    const result = await convertCbz(path, print);

    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('cbz');
    expect(result.fidelity).toBe('layout');
    expect(result.pageCount).toBe(12);
    expect(result.title).toBe('book');
    expect(print.calls).toBe(1);

    const html = print.htmls[0] ?? '';
    expect(html).toContain('Content-Security-Policy');
    const indexOf = (name: string): number =>
      html.indexOf(comicImageDataUri(name, pageBytes(name)));
    expect(indexOf('p1.png')).toBeLessThan(indexOf('p2.png'));
    expect(indexOf('p9.png')).toBeLessThan(indexOf('p10.png'));
    expect(indexOf('p10.png')).toBeLessThan(indexOf('p11.png'));
    expect(indexOf('p11.png')).toBeLessThan(indexOf('p12.png'));
    expect(result.warnings).toEqual([]);
  });

  it('skips non-image entries with a partial-content warning and keeps the image count', async () => {
    const bytes = zipSync({
      'p1.png': pageBytes('p1.png'),
      'p2.png': pageBytes('p2.png'),
      'p3.png': pageBytes('p3.png'),
      'ComicInfo.xml': strToU8('<ComicInfo><Title>t</Title></ComicInfo>'),
      'Thumbs.db': strToU8('junk'),
    });
    const path = await mkFile('meta.cbz', bytes);
    const result = await convertCbz(path, fakePrint());

    expect(result.pageCount).toBe(3);
    const partial = result.warnings.filter((w) => w.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toContain('ComicInfo.xml');
    expect(partial[0]?.message).toContain('Thumbs.db');
    expect(partial[0]?.detail).toContain('Thumbs.db');
    expect(result.warnings.some((w) => w.code === 'frame-decode-failed')).toBe(false);
  });

  it('skips one corrupt image, converts the rest and warns (criterion 6)', async () => {
    const files: Record<string, Uint8Array> = {};
    for (const name of PAGE_NAMES) {
      files[name] = name === 'p7.png' ? strToU8('this is not an image') : pageBytes(name);
    }
    const path = await mkFile('damaged.cbz', zipSync(files));
    const result = await convertCbz(path, fakePrint());

    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.pageCount).toBe(11);
    const damaged = result.warnings.filter((w) => w.code === 'frame-decode-failed');
    expect(damaged).toHaveLength(1);
    expect(damaged[0]?.message).toContain('p7.png');
    expect(damaged[0]?.detail).toBe('p7.png');
  });
});

describe('phase56 cbt adapter', () => {
  it('reads a TAR of 12 images into 12 pages in natural order', async () => {
    const path = await mkFile('book.cbt', buildTar(PAGE_NAMES));
    const print = fakePrint();
    const result = await convertCbt(path, print);

    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('cbt');
    expect(result.fidelity).toBe('layout');
    expect(result.pageCount).toBe(12);
    expect(result.title).toBe('book');
    expect(print.calls).toBe(1);

    const html = print.htmls[0] ?? '';
    const indexOf = (name: string): number =>
      html.indexOf(comicImageDataUri(name, pageBytes(name)));
    expect(indexOf('p9.png')).toBeLessThan(indexOf('p10.png'));
    expect(indexOf('p1.png')).toBeLessThan(indexOf('p2.png'));
  });

  it('parses the built TAR into its 12 regular-file entries', () => {
    const entries = readTar(buildTar(PAGE_NAMES));
    expect(entries.map((entry) => entry.name).sort()).toEqual([...PAGE_NAMES].sort());
    expect(entries).toHaveLength(12);
  });

  it('returns a typed corrupt failure for a truncated TAR and never prints (criterion 7)', async () => {
    const tar = buildTar(PAGE_NAMES);
    const truncated = tar.subarray(0, tar.length - 1800);
    const path = await mkFile('cut.cbt', truncated);
    const print = fakePrint();

    const failure = await failureOf(() => convertCbt(path, print));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);

    let thrown: unknown;
    try {
      readTar(truncated);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TarReadError);
    expect((thrown as TarReadError).code).toBe('corrupt');
  });
});

describe('phase56 comic sniff and resolution', () => {
  it('recognises a CBZ ZIP head and a CBT ustar head', () => {
    expect(looksLikeCbz('book.cbz', Buffer.from(buildCbz(PAGE_NAMES).subarray(0, 4096)))).toBe(true);
    expect(looksLikeCbz('book', Buffer.from(strToU8('plain text')))).toBe(false);

    const tarHead = Buffer.from(buildTar(['p1.png']).subarray(0, 4096));
    expect(looksLikeCbt('book', tarHead)).toBe(true);
    expect(looksLikeCbt('book', Buffer.from(strToU8('not a tar')))).toBe(false);
  });

  it('resolves cbz/cbt to the comic adapters and leaves office/epub alone', async () => {
    const registry = createDefaultRegistry();

    const cbzPath = await mkFile('comic.cbz', buildCbz(PAGE_NAMES));
    expect((await registry.resolve(cbzPath, await readSniffHead(cbzPath)))?.adapter.id).toBe('cbz');

    const cbtPath = await mkFile('comic.cbt', buildTar(PAGE_NAMES));
    expect((await registry.resolve(cbtPath, await readSniffHead(cbtPath)))?.adapter.id).toBe('cbt');

    const epubPath = await mkFile(
      'book.epub',
      zipSync({
        mimetype: [strToU8('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': strToU8('<container/>'),
      }),
    );
    expect((await registry.resolve(epubPath, await readSniffHead(epubPath)))?.adapter.id).toBe('epub');

    const docxPath = await mkFile(
      'doc.docx',
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8('<w:document/>'),
      }),
    );
    expect((await registry.resolve(docxPath, await readSniffHead(docxPath)))?.adapter.id).toBe('docx');

    const xlsxPath = await mkFile(
      'sheet.xlsx',
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'xl/workbook.xml': strToU8('<workbook/>'),
      }),
    );
    expect((await registry.resolve(xlsxPath, await readSniffHead(xlsxPath)))?.adapter.id).toBe('xlsx');
  });
});
