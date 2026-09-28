import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { ConvertOptions, ConvertResult } from '../../../src/shared/convert';
import { DocumentConversionService } from '../../../src/main/services/convert';
import { EngineService } from '../../../src/main/services/engine';
import { textAdapter } from '../../../src/main/services/convert/adapters/text';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 53 chunk A — the `.txt` adapter. Fixtures are synthetic bytes built
 * in-test (UTF-8, UTF-8 BOM, UTF-16LE BOM, CP1252 with 0x93/0x94 curly
 * quotes); no committed binary fixtures.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-text-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: Buffer | string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

async function convert(
  path: string,
  options: Partial<ConvertOptions> = {},
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return textAdapter.convert({
    path,
    options: resolveConvertOptions(options),
    head,
  });
}

/** Concatenate the page content streams of a saved PDF. pdf-lib has no
 *  text-extraction API, so this reads the literal text operators back out
 *  (content streams are FlateDecode-compressed by pdf-lib's save()). */
async function extractContentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (contents === undefined) continue;
    const asArray = (contents as { asArray?: () => unknown[] }).asArray;
    const nodes: unknown[] =
      typeof asArray === 'function'
        ? asArray.call(contents)
        : Array.isArray(contents)
          ? contents
          : [contents];
    for (const node of nodes) {
      const stream = doc.context.lookup(node as never) as unknown as
        | { getContents?: () => Uint8Array }
        | undefined;
      const raw = stream?.getContents?.();
      if (raw === undefined) continue;
      let decoded: Buffer;
      try {
        decoded = inflateSync(Buffer.from(raw));
      } catch {
        decoded = Buffer.from(raw);
      }
      // pdf-lib emits text as `<hex> Tj` for WinAnsi runs; decode the hex
      // operands back to bytes so the literal text is searchable.
      const content = decoded.toString('latin1');
      out += `${content.replace(/<([0-9A-Fa-f\s]+)>/g, (_all, hex: string) =>
        Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1'))}\n`;
    }
  }
  return out;
}

describe('phase53 text adapter decoding', () => {
  it('decodes UTF-8 and keeps the first and last line', async () => {
    const path = await mkFile('utf8.txt', 'first line\nlast line');
    const result = await convert(path);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(result.pageCount);
    const text = await extractContentText(result.bytes);
    expect(text).toContain('first line');
    expect(text).toContain('last line');
  });

  it('strips a UTF-8 BOM', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('first line\nlast line', 'utf8'),
    ]);
    const path = await mkFile('utf8bom.txt', bytes);
    const result = await convert(path);
    const text = await extractContentText(result.bytes);
    expect(text).toContain('first line');
    expect(text).not.toContain('?first line');
  });

  it('decodes UTF-16LE with a BOM', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('first line\nlast line', 'utf16le'),
    ]);
    const path = await mkFile('utf16.txt', bytes);
    const result = await convert(path);
    const text = await extractContentText(result.bytes);
    expect(text).toContain('first line');
    expect(text).toContain('last line');
  });

  it('falls back to CP1252 and decodes 0x93/0x94 curly quotes', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x93]),
      Buffer.from('quoted', 'latin1'),
      Buffer.from([0x94]),
      Buffer.from('\nlast line', 'latin1'),
    ]);
    const path = await mkFile('cp1252.txt', bytes);
    const result = await convert(path);
    const text = await extractContentText(result.bytes);
    expect(text).toContain('quoted');
    expect(text).toContain('last line');
    // This is the real assertion the chunk-A test was missing. pdf-lib encodes
    // WinAnsi text into `<hex> Tj`, and `extractContentText` decodes that hex
    // operand as latin1. U+201C/U+201D (what CP1252 0x93/0x94 mean) are
    // encoded back to WinAnsi bytes 0x93/0x94, which surface as U+0093/U+0094
    // once the operand is read as latin1. Those exact bytes are therefore the
    // proof the decoder produced the curly quotes: a failed decode would have
    // yielded '?' (0x3F), and any other character would occupy a different
    // WinAnsi slot. Asserting U+201C directly would fail for an extraction
    // reason, not a decoding one, so we assert what the pipeline really yields.
    expect(text).toContain('\u0093');
    expect(text).toContain('\u0094');
    expect(text).not.toContain('?quoted');
  });
});

describe('phase53 text adapter layout', () => {
  it('a smaller page with larger text produces more pages', async () => {
    const body = Array.from(
      { length: 400 },
      (_, i) => `line ${i} ${'x'.repeat(60)}`,
    ).join('\n');
    const path = await mkFile('long.txt', body);

    const roomy = await convert(path, {
      pageSize: 'a4',
      marginMm: 10,
      textFontSizePt: 8,
    });
    const cramped = await convert(path, {
      marginMm: 40,
      textFontSizePt: 28,
    });

    expect(cramped.pageCount).toBeGreaterThan(roomy.pageCount);
    const doc = await PDFDocument.load(cramped.bytes);
    expect(doc.getPageCount()).toBe(cramped.pageCount);
  });

  it('honours the configured page size and font size on the first page', async () => {
    const path = await mkFile('one.txt', 'hello');
    const result = await convert(path, { textFontSizePt: 20, marginMm: 25 });
    const doc = await PDFDocument.load(result.bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(result.pageCount).toBe(1);
  });
});

describe('phase53 text adapter warnings (fail loud)', () => {
  it('a whitespace-only source converts and returns one partial-content warning', async () => {
    const path = await mkFile('blank.txt', '   \n\n\t\n');
    const result = await convert(path);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(result.pageCount);
    expect(result.pageCount).toBeGreaterThan(0);
    const partial = result.warnings.filter((w) => w.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toMatch(/no visible content/i);
    expect(partial[0]?.detail).toMatch(/\d+/);
  });

  it('a normal text source returns no partial-content warning', async () => {
    const path = await mkFile('normal.txt', 'first line\nsecond line');
    const result = await convert(path);
    expect(result.warnings.filter((w) => w.code === 'partial-content')).toHaveLength(0);
  });

  it('a genuine zero-byte source is still err(empty-file), not a warning', async () => {
    const path = await mkFile('zero.txt', Buffer.alloc(0));
    const service = new DocumentConversionService({ engine: new EngineService() });
    const result = await service.toDocument('doc-zero', path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty-file');
  });
});

describe('phase53 engine handoff', () => {
  it('registers the converted document in the existing engine', async () => {
    const path = await mkFile('engine.txt', 'first line\nlast line');
    const engine = new EngineService();
    const service = new DocumentConversionService({ engine });
    const result = await service.toDocument('doc-engine', path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceFormat).toBe('text');
    expect(result.value.pageCount).toBeGreaterThan(0);
    const state = await engine.getState('doc-engine');
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value.pageCount).toBe(result.value.pageCount);
  });

  it('converts a UTF-16LE BOM .txt through the service (sniff accepts the BOM)', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('first line\nlast line', 'utf16le'),
    ]);
    const path = await mkFile('utf16-service.txt', bytes);
    const service = new DocumentConversionService({ engine: new EngineService() });
    const result = await service.toDocument('doc-utf16', path);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pageCount).toBeGreaterThan(0);
  });
});
