import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';
import { ok } from '../../../src/shared/result';
import type { OfficeConvertDefaults } from '../../../src/shared/types';
import { DEFAULT_OFFICE_CONVERT_DEFAULTS } from '../../../src/shared/types';
import { DocumentConversionService, type ConvertEnginePort } from '../../../src/main/services/convert';
import { ConvertRegistry } from '../../../src/main/services/convert/registry';
import {
  createXlsxAdapter,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/xlsx';
import { createPptxAdapter } from '../../../src/main/services/convert/adapters/pptx';

/**
 * DEF-388 — the stored `officeConvertDefaults` must reach the import adapter
 * with NO options from the caller.
 *
 * This test drives the REAL `DocumentConversionService` end to end: the
 * registry loads real adapters (only the print engine is faked), the service
 * reads the settings through its `getOfficeConvertDefaults` port exactly as
 * `src/main/index.ts` wires it, and `toDocument` is called with NO options.
 * That is the path qa proved dead: an options object injected straight into an
 * adapter does NOT exercise it.
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

const WIDE_COLUMNS = 10;

/** A 10-column, 2-row workbook; wide enough that `auto` chooses landscape. */
function buildWideWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  const headers = Array.from({ length: WIDE_COLUMNS }, (_, i) => `h${i}`);
  const values = Array.from({ length: WIDE_COLUMNS }, (_, i) => `${i}`);
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, values]),
    'Data',
  );
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/ppt/presentation.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>';

const ROOT_RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>';

const S = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function slideXml(body: string): string {
  return (
    `<?xml version="1.0"?><p:sld xmlns:p="${S}" ` +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
  );
}

/** One slide "SLIDE ONE" whose notes read "SPEAKER NOTES MARKER". */
function buildPptx(): Buffer {
  const presentation =
    `<?xml version="1.0"?><p:presentation xmlns:p="${S}" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
    '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/></p:presentation>';
  const presentationRels =
    '<?xml version="1.0"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>';
  const slide =
    slideXml('<p:sp><p:txBody><a:p><a:r><a:rPr lang="en-US" sz="1800"/>' +
      '<a:t>SLIDE ONE</a:t></a:r></a:p></p:txBody></p:sp>');
  const slideRels =
    '<?xml version="1.0"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>';
  const notes =
    slideXml('<p:sp><p:txBody><a:p><a:r><a:rPr lang="en-US" sz="1200"/>' +
      '<a:t>SPEAKER NOTES MARKER</a:t></a:r></a:p></p:txBody></p:sp>');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'ppt/presentation.xml': strToU8(presentation),
      'ppt/_rels/presentation.xml.rels': strToU8(presentationRels),
      'ppt/slides/slide1.xml': strToU8(slide),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(slideRels),
      'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
    }),
  );
}

interface CapturedPrint {
  fn: HtmlPrintFn;
  htmls: string[];
}

function fakePrint(): CapturedPrint {
  const captured: CapturedPrint = {
    htmls: [],
    fn: async (html): Promise<Awaited<ReturnType<HtmlPrintFn>>> => {
      captured.htmls.push(html);
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: 1,
        blockedUrls: [],
      });
    },
  };
  return captured;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-office-settings-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

/**
 * Run the REAL service over a file, with the stored office settings supplied
 * through the same port `src/main/index.ts` uses and NO per-call options.
 */
async function convertThroughService(
  path: string,
  office: OfficeConvertDefaults,
  callerOptions?: Parameters<DocumentConversionService['toDocument']>[2],
): Promise<string[]> {
  const print = fakePrint();
  const registry = new ConvertRegistry();
  registry.register({
    id: 'xlsx',
    extensions: ['.xlsx'],
    load: async () => createXlsxAdapter(print.fn),
  });
  registry.register({
    id: 'pptx',
    extensions: ['.pptx'],
    load: async () => createPptxAdapter(print.fn),
  });
  const engine: ConvertEnginePort = {
    loadDocumentBytes: async () => ok(new ArrayBuffer(0)),
  };
  const service = new DocumentConversionService({
    engine,
    registry,
    getOfficeConvertDefaults: () => office,
  });
  const result = await service.toDocument(
    `doc-${Math.random().toString(36).slice(2)}`,
    path,
    callerOptions,
  );
  if (!result.ok) {
    throw new Error(`conversion failed: ${result.error.code} ${result.error.message}`);
  }
  return print.htmls;
}

const OFFICE_ON: OfficeConvertDefaults = {
  spreadsheets: { gridlines: false, fitToWidth: false, orientation: 'portrait' },
  presentations: { includeNotes: true },
  exports: { includeImages: true },
};

describe('DEF-388 — officeConvertDefaults reach the import with no caller options', () => {
  it('defaults from DEFAULT_OFFICE_CONVERT_DEFAULTS when the stored field is absent', async () => {
    const path = await mkFile('wide.xlsx', buildWideWorkbook());
    const html = (
      await convertThroughService(path, DEFAULT_OFFICE_CONVERT_DEFAULTS)
    )[0] ?? '';
    // gridlines true, fit-to-width true, auto on a 10-column grid = landscape.
    expect(html).toContain('border: 0.5pt solid #9aa0a6;');
    expect(html).toContain('table-layout: fixed; width: 100%;');
    expect(html).toContain('@page { size: A4 landscape;');
  });

  it('applies spreadsheets.gridlines/fitToWidth/orientation from the stored settings', async () => {
    const path = await mkFile('wide.xlsx', buildWideWorkbook());
    const html = (await convertThroughService(path, OFFICE_ON))[0] ?? '';
    expect(html).toContain('border: none;');
    expect(html).not.toContain('border: 0.5pt solid #9aa0a6;');
    expect(html).toContain('table-layout: auto; width: auto;');
    expect(html).toContain('@page { size: A4;');
    expect(html).not.toContain('landscape');
  });

  it('applies a stored landscape orientation', async () => {
    const path = await mkFile('wide.xlsx', buildWideWorkbook());
    const office: OfficeConvertDefaults = {
      ...DEFAULT_OFFICE_CONVERT_DEFAULTS,
      spreadsheets: { ...DEFAULT_OFFICE_CONVERT_DEFAULTS.spreadsheets, orientation: 'landscape' },
    };
    const html = (await convertThroughService(path, office))[0] ?? '';
    expect(html).toContain('@page { size: A4 landscape;');
  });

  it('lets an explicit caller option win over the stored setting', async () => {
    const path = await mkFile('wide.xlsx', buildWideWorkbook());
    const html = (
      await convertThroughService(path, OFFICE_ON, { spreadsheetGridlines: true })
    )[0] ?? '';
    expect(html).toContain('border: 0.5pt solid #9aa0a6;');
  });

  it('applies presentations.includeNotes from the stored settings', async () => {
    const path = await mkFile('deck.pptx', buildPptx());
    const on = (await convertThroughService(path, OFFICE_ON))[0] ?? '';
    expect(on).toContain('SPEAKER NOTES MARKER');
    const off = (
      await convertThroughService(path, DEFAULT_OFFICE_CONVERT_DEFAULTS)
    )[0] ?? '';
    expect(off).not.toContain('SPEAKER NOTES MARKER');
  });
});

