import { describe, expect, it } from 'vitest';
import { read as readWorkbook, utils } from 'xlsx';
import { err, ok } from '../../../src/shared/result';
import {
  EXPORT_FIDELITY_NOTES,
  exportFidelityNotes,
  resolveExportFormat,
  type ExportTextPage,
} from '../../../src/shared/export';
import {
  FULL_TEXT_SHEET,
  PAGE_IMAGES_SHEET,
  buildXlsx,
  exportXlsx,
  type ExportTextEngine,
} from '../../../src/main/services/export/xlsx-export';

/**
 * Phase 55 feature D — the .xlsx writer. The produced bytes are opened with
 * the independent SheetJS reader, never with our own code.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const PAGES: ExportTextPage[] = [
  { pageIndex: 1, text: 'Name     Amount\nWidgets  12.00' },
  { pageIndex: 2, text: 'Second page body text' },
];

function open(bytes: Uint8Array): ReturnType<typeof readWorkbook> {
  return readWorkbook(Buffer.from(bytes), { type: 'buffer' });
}

describe('phase55 xlsx export writer', () => {
  it('writes one sheet per page plus the full-text sheet', () => {
    const build = buildXlsx({ pages: PAGES, includeImages: false, images: [] });
    expect(build.format).toBe('xlsx');
    const wb = open(build.bytes);
    expect(wb.SheetNames).toEqual(['Page 1', 'Page 2', FULL_TEXT_SHEET]);
  });

  it('places the detected cells of a known page', () => {
    const build = buildXlsx({ pages: PAGES, includeImages: false, images: [] });
    const wb = open(build.bytes);
    const ws = wb.Sheets['Page 1'];
    expect(utils.encode_cell({ r: 0, c: 0 })).toBe('A1');
    expect(ws['A1'].v).toBe('Name');
    expect(ws['B1'].v).toBe('Amount');
    expect(ws['A2'].v).toBe('Widgets');
    expect(ws['B2'].v).toBe('12.00');
  });

  it('carries the whole document text in the full-text sheet', () => {
    const build = buildXlsx({ pages: PAGES, includeImages: false, images: [] });
    const wb = open(build.bytes);
    const ws = wb.Sheets[FULL_TEXT_SHEET];
    expect(ws['A1'].v).toBe('Name     Amount');
    expect(ws['A2'].v).toBe('Widgets  12.00');
    expect(ws['A3'].v).toBe('Second page body text');
  });

  it('appends the images sheet only when images are enabled and supplied', () => {
    const images = [
      { pageNumber: 1, pngBuffer: PNG, width: 612, height: 792, pageWidth: 612, pageHeight: 792 },
    ];
    const on = buildXlsx({ pages: PAGES, includeImages: true, images });
    expect(open(on.bytes).SheetNames).toContain(PAGE_IMAGES_SHEET);
    const ws = open(on.bytes).Sheets[PAGE_IMAGES_SHEET];
    expect(ws['A1'].v).toBe('Page');
    expect(ws['A2'].v).toBe(1);
    expect(String(ws['F2'].v)).toContain('data:image/png;base64,');

    const off = buildXlsx({ pages: PAGES, includeImages: false, images });
    expect(open(off.bytes).SheetNames).not.toContain(PAGE_IMAGES_SHEET);
  });

  it('writes the fidelity note into the workbook core properties (read back)', () => {
    const build = buildXlsx({ pages: PAGES, includeImages: false, images: [] });
    const wb = open(build.bytes);
    expect(wb.Props?.Subject).toBe('conversion-fidelity');
    expect(wb.Props?.Comments).toContain('conversion-fidelity');
    expect(wb.Props?.Comments).toContain('DETECTED from the text layout');
    expect(build.fidelityNotes).toEqual(EXPORT_FIDELITY_NOTES.xlsx);
  });

  it('produces a valid workbook for a text-less document and names the pages', () => {
    const build = buildXlsx({
      pages: [{ pageIndex: 1, text: '' }],
      includeImages: false,
      images: [],
    });
    expect(build.pagesWithoutText).toEqual([1]);
    expect(build.bytes.byteLength).toBeGreaterThan(0);
    const wb = open(build.bytes);
    expect(wb.SheetNames).toEqual(['Page 1', FULL_TEXT_SHEET]);
    expect(String(wb.Sheets['Page 1']['A1'].v)).toContain('no extractable text');
    expect(wb.Props?.Comments).toContain('Pages with no extractable text: 1');
  });

  it('exportXlsx extracts through the engine and never throws', async () => {
    const engine: ExportTextEngine = { exportText: async () => ok(PAGES) };
    const built = await exportXlsx(engine, 'doc-1');
    expect(built.ok).toBe(true);
    if (built.ok) expect(open(built.value.bytes).SheetNames[0]).toBe('Page 1');
  });

  it('exportXlsx maps an engine failure to engine-error', async () => {
    const engine: ExportTextEngine = {
      exportText: async () => err('engine-error', 'unknown document: nope'),
    };
    const built = await exportXlsx(engine, 'nope');
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe('engine-error');
  });

  it('an unknown format resolves unsupported-format from the shared guard', () => {
    expect(resolveExportFormat('xlsx')).toBe('xlsx');
    expect(resolveExportFormat('pdf')).toBeNull();
    const notes = exportFidelityNotes('pdf');
    expect(notes.ok).toBe(false);
    if (!notes.ok) expect(notes.error.code).toBe('unsupported-format');
  });

  it('declares honest, non-empty fidelity notes for all four formats', () => {
    for (const format of ['txt', 'docx', 'xlsx', 'pptx'] as const) {
      expect(EXPORT_FIDELITY_NOTES[format].length).toBeGreaterThan(0);
      for (const note of EXPORT_FIDELITY_NOTES[format]) expect(note.length).toBeGreaterThan(20);
    }
  });
});
