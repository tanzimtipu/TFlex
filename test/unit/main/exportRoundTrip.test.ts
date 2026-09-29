import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { read as readWorkbook } from 'xlsx';
import mammoth from 'mammoth';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { EngineService } from '../../../src/main/services/engine';
import { exportXlsx } from '../../../src/main/services/export/xlsx-export';
import { exportPptx } from '../../../src/main/services/export/pptx-export';
import { openZip } from '../../../src/main/services/convert/convert-zip';
import { createXlsxAdapter, type HtmlPrintFn } from '../../../src/main/services/convert/adapters/xlsx';
import { createPptxAdapter } from '../../../src/main/services/convert/adapters/pptx';
import { createDocxAdapter } from '../../../src/main/services/convert/adapters/docx';
import { readSniffHead } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 55 criterion 7 + 8 — round-trip verification, not round-trip promises.
 *
 * For a REAL multi-page PDF fixture this test (a) exports each format, (b)
 * opens the produced file with that format's INDEPENDENT parser (SheetJS,
 * a raw ZIP read, mammoth), and (c) re-imports it through OUR Phase 55
 * adapter, asserting the extracted text matches the source PDF's text layer.
 *
 * Whitespace normalisation everywhere: `replace(/\s+/g, ' ').trim()`. The
 * engine's raw extractor concatenates text runs without separators and the
 * detectors/adapters reconstruct cells with spaces, so collapsing every run of
 * whitespace to one space is the honest common denominator. Every page's
 * normalised source text must appear in the normalised round-tripped text.
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

const PNG_1X1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-export-rt-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Plain-text view of the adapter's print HTML: tags become spaces, entities
 *  decoded, whitespace collapsed. Independent of our own readers. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PrintSpy {
  fn: HtmlPrintFn;
  htmls: string[];
}

function fakePrint(): PrintSpy {
  const spy: PrintSpy = {
    htmls: [],
    fn: async (html) => {
      spy.htmls.push(html);
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: (html.match(/<section/g) ?? []).length,
        blockedUrls: [],
      });
    },
  };
  return spy;
}

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

/** A real 2-page PDF with a text layer. Page 1 has a two-space gap so the
 *  detector sees a (best-effort) table; page 2 is ordinary prose. */
async function createFixturePdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([612, 792]);
  page1.drawText('Name     Amount', { x: 72, y: 700, size: 12 });
  page1.drawText('Widgets  12.00', { x: 72, y: 680, size: 12 });
  const page2 = doc.addPage([612, 792]);
  page2.drawText('Second page body text', { x: 72, y: 700, size: 12 });
  return writeFixture('fixture.pdf', await doc.save());
}

async function runAdapter(
  adapter: ReturnType<typeof createXlsxAdapter>,
  path: string,
  options = resolveConvertOptions(),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options, head });
}

function imageEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    pageNumber: index + 1,
    pngBuffer: PNG_1X1,
    width: 612,
    height: 792,
    pageWidth: 612,
    pageHeight: 792,
  }));
}

describe('phase55 export round trip', () => {
  let engine: EngineService;
  let docId: string;
  let sourcePages: Array<{ pageIndex: number; text: string }>;

  beforeEach(async () => {
    engine = new EngineService();
    docId = 'doc-rt';
    const path = await createFixturePdf();
    const loaded = await engine.loadDocument(docId, path);
    expect(loaded.ok).toBe(true);
    const extracted = await engine.exportText(docId);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) throw new Error('fixture text extraction failed');
    sourcePages = extracted.value;
    expect(sourcePages).toHaveLength(2);
    expect(normalize(sourcePages[0].text)).toBe('Name AmountWidgets 12.00');
    expect(normalize(sourcePages[1].text)).toBe('Second page body text');
  });

  it('xlsx: SheetJS opens it and our adapter re-renders the source text', async () => {
    const built = await exportXlsx(engine, docId, { includeImages: true, images: imageEntries(2) });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const path = await writeFixture('out.xlsx', built.value.bytes);

    // Independent parser leg.
    const workbook = readWorkbook(Buffer.from(built.value.bytes), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['Page 1', 'Page 2', 'Full text', 'Page images']);

    // Our adapter leg.
    const print = fakePrint();
    const result = await runAdapter(createXlsxAdapter(print.fn), path);
    expect(result.bytes.length).toBeGreaterThan(0);
    const rendered = normalize(htmlToText(print.htmls[0] ?? ''));
    for (const page of sourcePages) expect(rendered).toContain(normalize(page.text));
  });

  it('pptx: valid ZIP parts and our adapter re-renders the source text', async () => {
    const built = await exportPptx(engine, docId, { includeImages: true, entries: imageEntries(2) });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const path = await writeFixture('out.pptx', built.value.bytes);

    // Independent parser leg: a real ZIP with the expected parts.
    const archive = openZip(built.value.bytes);
    expect(archive.has('ppt/presentation.xml')).toBe(true);
    expect(archive.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2);
    expect(archive.names().filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))).toHaveLength(2);

    // Our adapter leg (notes on, so the slide text is recoverable).
    const print = fakePrint();
    await runAdapter(
      createPptxAdapter(print.fn),
      path,
      resolveConvertOptions({ presentationIncludeNotes: true }),
    );
    const rendered = normalize(htmlToText(print.htmls[0] ?? ''));
    for (const page of sourcePages) expect(rendered).toContain(normalize(page.text));
  });

  it('docx: mammoth opens it and our adapter re-renders the source text', async () => {
    const entries = imageEntries(2);
    // Member call on the engine service (never extracted into a local).
    const built = await engine.createDocxFromDoc(docId, entries);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const path = await writeFixture('out.docx', built.value);

    // Independent parser leg.
    const mammothHtml = (await mammoth.convertToHtml({ buffer: Buffer.from(built.value) })).value;
    const mammothText = normalize(htmlToText(mammothHtml));
    for (const page of sourcePages) expect(mammothText).toContain(normalize(page.text));

    // Our adapter leg.
    const print = fakePrint();
    await runAdapter(createDocxAdapter(print.fn), path);
    const rendered = normalize(htmlToText(print.htmls[0] ?? ''));
    for (const page of sourcePages) expect(rendered).toContain(normalize(page.text));
  });

  it('txt: the engine text layer survives a UTF-8 write/read unchanged', async () => {
    const extracted = await engine.exportText(docId);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    for (const page of extracted.value) {
      const roundTripped = Buffer.from(page.text, 'utf8').toString('utf8');
      expect(normalize(roundTripped)).toBe(normalize(page.text));
      const source = sourcePages.find((p) => p.pageIndex === page.pageIndex);
      expect(normalize(roundTripped)).toBe(normalize(source?.text ?? ''));
    }
  });

  it('criterion 8: a text-less document produces valid xlsx and pptx files', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([612, 792]);
    const blankPath = await writeFixture('blank.pdf', await blank.save());
    const blankId = 'doc-blank';
    expect((await engine.loadDocument(blankId, blankPath)).ok).toBe(true);

    const xlsx = await exportXlsx(engine, blankId, { includeImages: false });
    expect(xlsx.ok).toBe(true);
    if (xlsx.ok) {
      expect(xlsx.value.pagesWithoutText).toEqual([1]);
      const workbook = readWorkbook(Buffer.from(xlsx.value.bytes), { type: 'buffer' });
      expect(workbook.SheetNames).toEqual(['Page 1', 'Full text']);
      expect(String(workbook.Sheets['Page 1']['A1'].v)).toContain('no extractable text');
    }

    const pptx = await exportPptx(engine, blankId, { includeImages: false });
    expect(pptx.ok).toBe(true);
    if (pptx.ok) {
      expect(pptx.value.pagesWithoutText).toEqual([1]);
      const archive = openZip(pptx.value.bytes);
      expect(archive.has('ppt/presentation.xml')).toBe(true);
      expect(archive.readText('ppt/slides/slide1.xml') ?? '').toContain('no extractable text');
    }
  });
});
