import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import type { ConvertOptions, ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { createRtfAdapter } from '../../../src/main/services/convert/adapters/rtf';
import { parseRtf } from '../../../src/main/services/convert/adapters/rtf-parse';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 53 feature F - the RTF parser subset and its pdf-lib mapping. Fixtures
 * are RTF strings built in-test; no committed binaries. The adapter builds the
 * PDF with pdf-lib directly, so no Electron and no print fake are needed.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-rtf-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function rtfFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, 'utf8');
  return path;
}

async function convert(
  path: string,
  options: Partial<ConvertOptions> = {},
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return createRtfAdapter().convert({
    path,
    options: resolveConvertOptions(options),
    head,
  });
}

describe('phase53 rtf parser', () => {
  it('nests and restores group state', () => {
    const parsed = parseRtf('{\\rtf1\\ansi\\b bold {\\i both} bold again\\par}');
    expect(parsed.paragraphs).toHaveLength(1);
    const runs = parsed.paragraphs[0].runs;
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({ text: 'bold ', bold: true, italic: false });
    expect(runs[1]).toMatchObject({ text: 'both', bold: true, italic: true });
    expect(runs[2]).toMatchObject({ text: ' bold again', bold: true, italic: false });
  });

  it('maps \\fs28 to a 14 pt run', () => {
    const parsed = parseRtf('{\\rtf1\\ansi\\fs28 big\\par}');
    expect(parsed.paragraphs[0].runs[0].sizePt).toBe(14);
  });

  it('resolves a \\colortbl index selected by \\cf', () => {
    const parsed = parseRtf('{\\rtf1\\ansi{\\colortbl;\\red255\\green0\\blue0;}\\cf1 red\\par}');
    expect(parsed.colors[1]).toEqual([255, 0, 0]);
    expect(parsed.paragraphs[0].runs[0].colorIndex).toBe(1);
    expect(parsed.paragraphs[0].runs[0].text).toBe('red');
  });

  it('splits paragraphs on \\par', () => {
    const parsed = parseRtf('{\\rtf1\\ansi one\\par two\\par}');
    expect(parsed.paragraphs).toHaveLength(2);
    expect(parsed.paragraphs[0].runs[0].text).toBe('one');
    expect(parsed.paragraphs[1].runs[0].text).toBe('two');
  });

  it('marks the paragraph after \\page with a page break', () => {
    const parsed = parseRtf('{\\rtf1\\ansi first\\page second\\par}');
    expect(parsed.paragraphs).toHaveLength(2);
    expect(parsed.paragraphs[0].pageBreakBefore).toBe(false);
    expect(parsed.paragraphs[1].pageBreakBefore).toBe(true);
  });

  it('decodes hex and unicode escapes', () => {
    const parsed = parseRtf("{\\rtf1\\ansi\\'93hi\\'94\\u8217\\par}");
    const text = parsed.paragraphs[0].runs.map((run) => run.text).join('');
    expect(text).toContain('\u201C');
    expect(text).toContain('\u201D');
    expect(text).toContain('\u2019');
  });

  it('keeps the literal escapes \\\\ \\{ \\}', () => {
    const parsed = parseRtf('{\\rtf1\\ansi a\\\\b\\{c\\}d\\par}');
    expect(parsed.paragraphs[0].runs[0].text).toBe('a\\b{c}d');
  });

  it('counts unsupported control words instead of dropping them silently', () => {
    const parsed = parseRtf('{\\rtf1\\ansi normal \\v hidden\\v0 visible\\par}');
    expect(parsed.ignoredControlWords).toBe(2);
  });
});

describe('phase53 rtf empty-visible-content warning (DEF-376)', () => {
  it('converts a whitespace-only source and warns partial-content once', async () => {
    const path = await rtfFile('blank.rtf', '{\\rtf1   \n\n}\n');
    const result = await convert(path);
    expect(isPdfBytes(result.bytes)).toBe(true);
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(1);
    expect(partial[0]?.message).toContain('no visible text');
    expect(partial[0]?.detail).toMatch(/\d+ character\(s\), \d+ paragraph\(s\)/);
  });

  it('does not warn for a contentful source', async () => {
    const path = await rtfFile('words.rtf', '{\\rtf1\\ansi hello world\\par}');
    const result = await convert(path);
    expect(result.warnings.some((warning) => warning.code === 'partial-content')).toBe(false);
  });

  it('warns BOTH when empty text coexists with ignored control words', async () => {
    const path = await rtfFile('empty-ignored.rtf', '{\\rtf1\\ansi\\v   \n\n}');
    const result = await convert(path);
    const partial = result.warnings.filter((warning) => warning.code === 'partial-content');
    expect(partial).toHaveLength(2);
    expect(partial.some((warning) => warning.message.includes('unsupported RTF control word'))).toBe(
      true,
    );
    expect(partial.some((warning) => warning.message.includes('no visible text'))).toBe(true);
  });

  it('leaves the existing ignored-control-word code and text unchanged', async () => {
    const path = await rtfFile('unsupported2.rtf', '{\\rtf1\\ansi normal \\v hidden\\v0 visible\\par}');
    const result = await convert(path);
    const ignored = result.warnings.find((warning) =>
      warning.message.includes('unsupported RTF control word'),
    );
    expect(ignored?.code).toBe('partial-content');
    expect(ignored?.message).toBe('2 unsupported RTF control word(s) were ignored.');
  });
});

describe('phase53 rtf adapter', () => {
  it('produces PDF bytes and grows the page count with \\page', async () => {
    const path = await rtfFile(
      'pages.rtf',
      '{\\rtf1\\ansi page one\\page page two\\page page three\\par}',
    );
    const result = await convert(path);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.pageCount).toBe(3);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('warns partial-content with the ignored control-word count', async () => {
    const path = await rtfFile(
      'unsupported.rtf',
      '{\\rtf1\\ansi normal \\v hidden\\v0 visible\\par}',
    );
    const result = await convert(path);
    const partial = result.warnings.find((warning) => warning.code === 'partial-content');
    expect(partial).toBeDefined();
    expect(partial?.message).toContain('2');
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('honours the configured page size', async () => {
    const path = await rtfFile('one.rtf', '{\\rtf1\\ansi hello\\par}');
    const result = await convert(path, { pageSize: 'a4' });
    const doc = await PDFDocument.load(result.bytes);
    const { width } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
  });
});
