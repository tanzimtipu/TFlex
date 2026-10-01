import { utils, write } from 'xlsx';
import type { EngineError } from '../../../shared/types';
import type { Result } from '../../../shared/result';
import { err, ok } from '../../../shared/result';
import {
  EXPORT_FIDELITY_NOTES,
  type ExportBuild,
  type ExportErrorCode,
  type ExportPageImage,
  type ExportTextPage,
  type ExportXlsxPayload,
} from '../../../shared/export';
import {
  detectRowsFromText,
  noTextMarker,
  pageSheetName,
} from './tables-from-text';

/**
 * Phase 55 feature D — the PDF -> `.xlsx` writer.
 *
 * One worksheet per page (`Page 1`, `Page 2`, ...) built from the document's
 * OWN extracted text through the pure spacing detector, plus a final
 * `Full text` sheet carrying every line of the document. The page grid is a
 * best-effort reconstruction, never a claim to the original table structure —
 * see `EXPORT_FIDELITY_NOTES.xlsx`.
 *
 * Images: SheetJS Community Edition has no API to anchor a picture to a cell,
 * so when `includeImages` is on and the caller supplied page images we append
 * a `Page images` worksheet that stores the page number, the image's pixel and
 * point dimensions, and the PNG as a base64 data URI in a cell. That is a real
 * limitation and the fidelity note says so; a page with no text still produces
 * a valid workbook.
 *
 * Core properties: SheetJS writes `wb.Props` into `docProps/core.xml` and
 * `docProps/app.xml`. The fidelity note is stored in `Props.Comments` (the
 * OOXML `dc:description`) and the marker `conversion-fidelity` in
 * `Props.Subject` (`dc:subject`), both readable back with `XLSX.read`.
 */

/** The marker every export writes into its produced-file metadata. */
export const FIDELITY_PROPERTY_MARKER = 'conversion-fidelity';

/** The whole-document text sheet name. */
export const FULL_TEXT_SHEET = 'Full text';

/** The optional page-images sheet name. */
export const PAGE_IMAGES_SHEET = 'Page images';

/** A cell cannot hold an arbitrary-length string; keep the data URI inside the
 *  spreadsheet cell ceiling and degrade to a truthful marker beyond it. */
const MAX_DATA_URI_CHARS = 30_000;

/** DEF-394 — the OOXML worksheet cell limit SheetJS enforces on write
 *  (`Text length must not exceed 32767 characters`). A longer string is
 *  truncated in-cell with a truthful marker instead of throwing across IPC. */
const MAX_CELL_CHARS = 32_767;

/** The marker appended to a truncated cell so the degradation is visible. */
export const CELL_TRUNCATION_MARKER =
  '... (truncated: exceeds the 32767-character spreadsheet cell limit)';

/** Truncate a string cell to the spreadsheet ceiling, keeping the marker. */
function clampCell(value: string): string {
  if (value.length <= MAX_CELL_CHARS) return value;
  return value.slice(0, MAX_CELL_CHARS - CELL_TRUNCATION_MARKER.length) + CELL_TRUNCATION_MARKER;
}

/** Apply the cell clamp to every string cell of a row-array. */
function clampCells(rows: Array<Array<string | number>>): Array<Array<string | number>> {
  return rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' ? clampCell(cell) : cell)),
  );
}

/** The minimal engine surface the writer needs: the existing text extractor.
 *  Typed as an interface so the writer is unit-testable with no EngineService. */
export interface ExportTextEngine {
  exportText(docId: string): Promise<Result<ExportTextPage[], EngineError>>;
}

export interface XlsxBuildInput {
  pages: ExportTextPage[];
  includeImages: boolean;
  images: ExportPageImage[];
}

function dataUri(png: Uint8Array): string {
  const base64 = Buffer.from(png).toString('base64');
  const uri = `data:image/png;base64,${base64}`;
  return uri.length > MAX_DATA_URI_CHARS
    ? '(image omitted: too large to store in a spreadsheet cell)'
    : uri;
}

/** Build the workbook bytes from already-extracted pages. Pure and testable. */
export function buildXlsx(input: XlsxBuildInput): ExportBuild {
  const pagesWithoutText: number[] = [];
  const workbook = utils.book_new();

  for (const page of input.pages) {
    const rows = detectRowsFromText(page.text);
    if (rows.length === 0) {
      pagesWithoutText.push(page.pageIndex);
      utils.book_append_sheet(
        workbook,
        utils.aoa_to_sheet(clampCells([[noTextMarker(page.pageIndex)]])),
        pageSheetName(page.pageIndex),
      );
      continue;
    }
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet(clampCells(rows)),
      pageSheetName(page.pageIndex),
    );
  }

  const fullTextRows: string[][] = [];
  for (const page of input.pages) {
    for (const line of page.text.split(/\r?\n/)) fullTextRows.push([line]);
  }
  if (fullTextRows.length === 0) fullTextRows.push([noTextMarker(0)]);
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet(clampCells(fullTextRows)),
    FULL_TEXT_SHEET,
  );

  const images = input.includeImages
    ? input.images.filter((entry) => entry && typeof entry.pageNumber === 'number')
    : [];
  if (images.length > 0) {
    const rows: (string | number)[][] = [
      ['Page', 'Width (px)', 'Height (px)', 'Page width (pt)', 'Page height (pt)', 'Image (PNG data URI)'],
    ];
    for (const entry of [...images].sort((a, b) => a.pageNumber - b.pageNumber)) {
      rows.push([
        entry.pageNumber,
        entry.width,
        entry.height,
        entry.pageWidth,
        entry.pageHeight,
        dataUri(entry.pngBuffer),
      ]);
    }
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), PAGE_IMAGES_SHEET);
  }

  const noteParts = [FIDELITY_PROPERTY_MARKER, ...EXPORT_FIDELITY_NOTES.xlsx];
  if (pagesWithoutText.length > 0) {
    noteParts.push(`Pages with no extractable text: ${pagesWithoutText.join(', ')}.`);
  }
  workbook.Props = {
    Title: 'Jovrel export (xlsx)',
    Subject: FIDELITY_PROPERTY_MARKER,
    Author: 'Jovrel',
    Company: 'Jovrel',
    Comments: noteParts.join(' | '),
  };

  const bytes = new Uint8Array(write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return {
    format: 'xlsx',
    bytes,
    fidelityNotes: EXPORT_FIDELITY_NOTES.xlsx,
    pagesWithoutText,
  };
}

/**
 * The `export:xlsx` service entry point. Extracts the document's own text
 * through the engine's existing `exportText` (never a second extractor), then
 * builds the workbook. Awaited in main; never throws across IPC.
 */
export async function exportXlsx(
  engine: ExportTextEngine,
  docId: string,
  payload: ExportXlsxPayload = {},
): Promise<Result<ExportBuild, ExportErrorCode>> {
  const extracted = await engine.exportText(docId);
  if (!extracted.ok) {
    return err('engine-error', extracted.error.message);
  }
  try {
    return ok(
      buildXlsx({
        pages: extracted.value,
        includeImages: payload.includeImages ?? true,
        images: payload.images ?? [],
      }),
    );
  } catch (thrown) {
    // DEF-394: a synchronous SheetJS throw must never escape as a rejected IPC
    // promise; it is reported as a typed engine-error instead.
    return err(
      'engine-error',
      `The workbook could not be written: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`,
    );
  }
}
