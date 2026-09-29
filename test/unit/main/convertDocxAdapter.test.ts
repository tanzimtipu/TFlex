import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { ConvertFailure } from '../../../src/main/services/convert/errors';
import {
  createDocxAdapter,
  looksLikeDocx,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/docx';
import {
  createLegacyDocAdapter,
  looksLikeLegacyDoc,
  recoverDocText,
  cleanWordText,
  type CompoundFileLike,
} from '../../../src/main/services/convert/adapters/legacy-doc';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 55 feature A — the DOCX adapter (real OOXML generated with `docx`) and
 * the legacy `.doc` CFB text recovery (a hand-built minimal container). The
 * print engine is injected, so no Electron is needed.
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

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);

/** A real OOXML package: two heading levels, bold/italic runs, a bulleted
 *  list, a 2x2 table and an embedded PNG. */
async function buildDocxBytes(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Top Heading')],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun('Sub Heading')],
          }),
          new Paragraph({
            children: [
              new TextRun('plain '),
              new TextRun({ text: 'bold', bold: true }),
              new TextRun(' and '),
              new TextRun({ text: 'italic', italics: true }),
            ],
          }),
          new Paragraph({ text: 'first bullet', bullet: { level: 0 } }),
          new Paragraph({ text: 'second bullet', bullet: { level: 0 } }),
          new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: new Uint8Array(PNG_BYTES),
                transformation: { width: 32, height: 32 },
              }),
            ],
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('r1c1')] }),
                  new TableCell({ children: [new Paragraph('r1c2')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('r2c1')] }),
                  new TableCell({ children: [new Paragraph('r2c2')] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Build a minimal OLE/CFB container holding one WordDocument stream whose FIB
 *  uses the simple fcMin/fcMac text range. The stream is padded to one sector
 *  multiple above the mini-stream cutoff so it is read through the FAT. */
function buildLegacyDoc(text: string): Buffer {
  const SECTOR = 512;
  const textBytes = Buffer.from(text, 'latin1');
  const streamLen = 4096;
  const streamData = Buffer.alloc(streamLen);
  streamData.writeUInt16LE(0xa5ec, 0); // wIdent
  streamData.writeUInt16LE(0x00c1, 2); // nFib
  streamData.writeUInt16LE(0x0000, 0x0a); // flags: simple, 8-bit
  streamData.writeUInt32LE(32, 0x18); // fcMin
  streamData.writeUInt32LE(32 + textBytes.length, 0x1c); // fcMac
  textBytes.copy(streamData, 32);
  const streamSectors = streamLen / SECTOR;

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(9, 0x1e); // sector shift -> 512
  header.writeUInt16LE(6, 0x20); // mini sector shift -> 64
  header.writeUInt32LE(1, 0x2c); // FAT sectors
  header.writeUInt32LE(1, 0x30); // first directory sector
  header.writeUInt32LE(4096, 0x38); // mini-stream cutoff
  header.writeUInt32LE(0xfffffffe, 0x3c); // first mini FAT (none)
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(0xfffffffe, 0x44); // first DIFAT (none)
  header.writeUInt32LE(0, 0x48);
  header.writeUInt32LE(0, 0x4c); // DIFAT[0] -> sector 0
  for (let i = 1; i < 109; i += 1) header.writeUInt32LE(0xffffffff, 0x4c + i * 4);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0); // sector 0 is the FAT
  fat.writeUInt32LE(0xfffffffe, 4); // sector 1 (directory) ends the chain
  for (let i = 0; i < streamSectors; i += 1) {
    const next = i === streamSectors - 1 ? 0xfffffffe : 2 + i + 1;
    fat.writeUInt32LE(next, (2 + i) * 4);
  }

  const dir = Buffer.alloc(SECTOR);
  const writeEntry = (
    offset: number,
    name: string,
    type: number,
    start: number,
    size: number,
  ): void => {
    Buffer.from(name, 'utf16le').copy(dir, offset);
    dir.writeUInt16LE((name.length + 1) * 2, offset + 64);
    dir[offset + 66] = type;
    dir.writeUInt32LE(start, offset + 116);
    dir.writeUInt32LE(size, offset + 120);
  };
  writeEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  writeEntry(128, 'WordDocument', 2, 2, streamLen);

  return Buffer.concat([header, fat, dir, streamData]);
}

let dirPath: string;

beforeEach(async () => {
  dirPath = await mkdtemp(join(tmpdir(), 'tflex-docx-'));
});

afterEach(async () => {
  await rm(dirPath, { recursive: true, force: true });
});

async function mkFile(name: string, bytes: Uint8Array | string): Promise<string> {
  const path = join(dirPath, name);
  await writeFile(path, bytes);
  return path;
}

interface PrintSpy {
  fn: HtmlPrintFn;
  htmls: string[];
  calls: number;
}

function fakePrint(blockedUrls: string[] = []): PrintSpy {
  const htmls: string[] = [];
  const spy: PrintSpy = { htmls, calls: 0, fn: async (html) => {
    spy.calls += 1;
    htmls.push(html);
    return ok({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      pageCount: 1,
      blockedUrls,
    });
  } };
  return spy;
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

let docxBytesPromise: Promise<Buffer> | null = null;
function docxBytes(): Promise<Buffer> {
  docxBytesPromise ??= buildDocxBytes();
  return docxBytesPromise;
}

async function convertDocx(
  path: string,
  print: PrintSpy,
  adapter = createDocxAdapter(print.fn),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options: resolveConvertOptions(), head });
}

describe('phase55 docx adapter', () => {
  it('declares layout fidelity and specific resolution', () => {
    const adapter = createDocxAdapter();
    expect(adapter.fidelity).toBe('layout');
    expect(adapter.specificity).toBe('specific');
    expect(adapter.maxBytes).toBeGreaterThan(0);
  });

  it('maps headings, styled runs, lists, tables and images to HTML', async () => {
    const path = await mkFile('sample.docx', await docxBytes());
    const print = fakePrint();
    const result = await convertDocx(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.fidelity).toBe('layout');
    expect(result.sourceFormat).toBe('docx');
    expect(print.calls).toBe(1);
    const html = print.htmls[0] ?? '';
    expect(html).toContain('<h1');
    expect(html).toContain('Top Heading');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toMatch(/<ul[ >]/);
    expect(html).toContain('<li>');
    expect(html).toContain('<table>');
    expect(html).toContain('r1c1');
    expect(html).toContain('r2c2');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Content-Security-Policy');
  });

  it('returns a typed corrupt failure for a malformed archive', async () => {
    const path = await mkFile('broken.docx', Buffer.from('PK\x03\x04not a real zip'));
    const failure = await failureOf(() => convertDocx(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('returns a typed too-large failure above the byte ceiling', async () => {
    const path = await mkFile('big.docx', await docxBytes());
    const failure = await failureOf(() =>
      convertDocx(path, fakePrint(), createDocxAdapter(fakePrint().fn, 8)),
    );
    expect(failure.code).toBe('too-large');
  });

  it('returns a typed too-large failure for a zip bomb before mammoth runs', async () => {
    const bomb = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': new Uint8Array(200_000),
    });
    const path = await mkFile('bomb.docx', bomb);
    const adapter = createDocxAdapter(fakePrint().fn, undefined, {
      maxEntries: 8,
      maxTotalUncompressedBytes: 1024,
      maxEntryUncompressedBytes: 1024,
    });
    const failure = await failureOf(() => convertDocx(path, fakePrint(), adapter));
    expect(failure.code).toBe('too-large');
  });

  it('sniffs the OOXML marker, not just the ZIP signature', async () => {
    const head = Buffer.from((await docxBytes()).subarray(0, 4096));
    expect(looksLikeDocx(head)).toBe(true);
    expect(looksLikeDocx(Buffer.from(buildLegacyDoc('x').subarray(0, 4096)))).toBe(false);
    expect(looksLikeDocx(Buffer.from('plain text, no zip'))).toBe(false);
  });
});

describe('phase55 legacy .doc recovery', () => {
  it('declares degraded fidelity and specific resolution', () => {
    const adapter = createLegacyDocAdapter();
    expect(adapter.fidelity).toBe('degraded');
    expect(adapter.specificity).toBe('specific');
    expect(adapter.id).toBe('doc');
  });

  it('recovers the simple fcMin/fcMac text and names what was lost', async () => {
    const text = 'Hello legacy document\rSecond line of text';
    const path = await mkFile('legacy.doc', buildLegacyDoc(text));
    const print = fakePrint();
    const result = await convertDocx(path, print, createLegacyDocAdapter(print.fn));
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.fidelity).toBe('degraded');
    expect(result.sourceFormat).toBe('doc');
    const warning = result.warnings.find((w) => w.code === 'legacy-format-degraded');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Headings, lists, tables, images');
    expect(warning?.detail).toContain('simple fcMin/fcMac');
    expect(print.htmls[0]).toContain('Hello legacy document');
    expect(print.htmls[0]).toContain('Second line of text');
  });

  it('reads the FIB through the recovery function directly', () => {
    const stream = Buffer.alloc(64);
    stream.writeUInt16LE(0xa5ec, 0);
    stream.writeUInt16LE(0x00c1, 2);
    stream.writeUInt32LE(32, 0x18);
    stream.writeUInt32LE(34, 0x1c);
    Buffer.from('Hi', 'latin1').copy(stream, 32);
    const fake: CompoundFileLike = {
      read: (name) => (name === 'WordDocument' ? new Uint8Array(stream) : null),
    };
    const recovered = recoverDocText(fake);
    expect(recovered?.method).toBe('simple');
    expect(recovered?.text).toContain('Hi');
  });

  it('normalises Word control characters', () => {
    expect(cleanWordText('a\rb\x07c\x01d')).toBe('a\nb\tcd');
  });

  it('returns a typed error rather than an empty document when no text survives', async () => {
    const path = await mkFile('empty.doc', buildLegacyDoc(''));
    const print = fakePrint();
    const failure = await failureOf(() =>
      convertDocx(path, print, createLegacyDocAdapter(print.fn)),
    );
    expect(failure.code).toBe('decode-failed');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);
  });

  it('sniffs a CFB by signature, content and extension', () => {
    const head = Buffer.from(buildLegacyDoc('x').subarray(0, 4096));
    expect(looksLikeLegacyDoc('legacy.doc', head)).toBe(true);
    expect(looksLikeLegacyDoc('mislabelled.bin', head)).toBe(true);
    expect(looksLikeLegacyDoc('legacy.doc', Buffer.from('not a cfb container'))).toBe(
      false,
    );
  });
});
