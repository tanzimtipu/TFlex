import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  read as readWorkbook,
  utils,
  SSF,
  type CellObject,
  type Range,
  type WorkSheet,
} from 'xlsx';
import type { ConvertFormatId, ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { injectSecurityMeta } from '../templates';
import { ConvertZipError, inspectZip, type ZipLimits } from '../convert-zip';
import {
  renderWorkbookHtml,
  type SheetGrid,
  type SheetMerge,
} from '../sheet-to-html';

/** Re-exported for tests. */
export type { HtmlPrintFn };

/**
 * Phase 55 feature B — the spreadsheet adapter serving `.xlsx`, `.xls` and
 * `.ods` through ONE SheetJS path (`read()` handles all three containers:
 * OOXML ZIP, ODF ZIP and BIFF/CFB). It decodes each worksheet into display
 * strings ONLY — a formula cell contributes its CACHED VALUE (`cell.v` / the
 * pre-formatted `cell.w`), never its formula text (`cell.f`) — then the pure
 * `sheet-to-html.ts` mapper builds the multi-page table document and the
 * existing offscreen print engine renders it. Fidelity is `layout`: a
 * spreadsheet's print layout is inherently a re-layout, not a byte copy.
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** An OLE/CFB container is a `.xls` (BIFF). */
export function isCfbHead(head: Buffer): boolean {
  if (head.length < CFB_SIGNATURE.length) return false;
  return CFB_SIGNATURE.every((byte, index) => head[index] === byte);
}

function isZipHead(head: Buffer): boolean {
  return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
}

/** An `.xlsx` is a ZIP whose OOXML spreadsheet part names appear in the local
 *  file headers (`xl/...`). The content-type marker is accepted too for a
 *  package that stores `[Content_Types].xml` uncompressed. */
export function looksLikeXlsx(head: Buffer): boolean {
  if (!isZipHead(head)) return false;
  const text = head.toString('latin1');
  return text.includes('xl/') || text.includes('spreadsheetml');
}

/** An `.ods` is a ZIP whose ODF package names the spreadsheet type. A plain
 *  `content.xml`+`styles.xml` fallback must NOT claim the text type. */
export function looksLikeOds(head: Buffer): boolean {
  if (!isZipHead(head)) return false;
  const text = head.toString('latin1');
  if (text.includes('application/vnd.oasis.opendocument.spreadsheet')) return true;
  return (
    text.includes('content.xml') &&
    text.includes('styles.xml') &&
    !text.includes('application/vnd.oasis.opendocument.text')
  );
}

/** A `.xls` is an OLE/CFB container holding a `Workbook` (BIFF8) or `Book`
 *  (BIFF5) stream; the directory name is UTF-16LE. */
export function looksLikeXls(path: string, head: Buffer): boolean {
  if (!isCfbHead(head)) return false;
  if (extname(path).toLowerCase() === '.xls') return true;
  const utf16 = head.toString('utf16le');
  return utf16.includes('Workbook') || utf16.includes('Book');
}

/**
 * The display text of one cell: the pre-formatted `cell.w` when the file
 * carries a format (dates and numbers arrive already formatted), otherwise the
 * cached value formatted through `SSF` with the cell's own number format.
 * `cell.f` (the formula string) is deliberately never read.
 */
export function cellValueText(cell: CellObject | undefined): string {
  if (cell === undefined) return '';
  if (typeof cell.w === 'string' && cell.w.length > 0) return cell.w;
  if (cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n' || cell.t === 'd') {
    const format = typeof cell.z === 'string' && cell.z.length > 0 ? cell.z : 'General';
    try {
      return String(SSF.format(format, cell.v));
    } catch {
      return String(cell.v);
    }
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v);
}

/**
 * Decode one worksheet into a `SheetGrid`. At most `maxRows` rows are
 * materialised (the true source row count is carried in `sourceRowCount`, so
 * the ceiling is still reported), which keeps a very large sheet from being
 * buffered twice. Cells are display strings only.
 */
export function worksheetToGrid(
  name: string,
  ws: WorkSheet,
  maxRows = Number.POSITIVE_INFINITY,
): SheetGrid {
  const ref = typeof ws['!ref'] === 'string' ? ws['!ref'] : undefined;
  let range: Range;
  try {
    range = utils.decode_range(ref ?? 'A1');
  } catch {
    range = utils.decode_range('A1');
  }
  const merges: SheetMerge[] = [];
  for (const merge of ws['!merges'] ?? []) {
    merges.push({
      s: { r: merge.s.r, c: merge.s.c },
      e: { r: merge.e.r, c: merge.e.c },
    });
    range.s.r = Math.min(range.s.r, merge.s.r);
    range.s.c = Math.min(range.s.c, merge.s.c);
    range.e.r = Math.max(range.e.r, merge.e.r);
    range.e.c = Math.max(range.e.c, merge.e.c);
  }

  const trueRowCount = range.e.r - range.s.r + 1;
  const renderedRowCount = Math.min(trueRowCount, maxRows);
  const cells: string[][] = [];
  for (let r = range.s.r; r < range.s.r + renderedRowCount; r += 1) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = utils.encode_cell({ r, c });
      row.push(cellValueText(ws[address] as CellObject | undefined));
    }
    cells.push(row);
  }

  if (ref === undefined && cells.every((row) => row.every((cell) => cell.length === 0))) {
    return { name, cells: [], merges, sourceRowCount: 0 };
  }
  return { name, cells, merges, sourceRowCount: trueRowCount };
}

export interface SheetAdapterConfig {
  id: ConvertFormatId;
  label: string;
  extensions: string[];
  sniff: (path: string, head: Buffer) => boolean;
  print?: HtmlPrintFn;
  maxBytes?: number;
  zipLimits?: ZipLimits;
  maxRows?: number;
}

/**
 * Build one spreadsheet adapter for a specific format id. The three shipped
 * adapters (`xlsx`, `xls`, `ods`) share this single implementation — one
 * SheetJS path, three registrations — differing only in id, label, extension
 * set and sniff. `print`, `maxBytes`, the ZIP ceilings and the row ceiling are
 * injectable so the engine and the bomb guard unit-test with no Electron.
 */
export function createSheetAdapter(config: SheetAdapterConfig): ConversionAdapter {
  const print = config.print ?? printHtmlToPdf;
  const maxBytes = config.maxBytes ?? CONVERT_LIMITS.spreadsheetBytes;
  const maxRows = config.maxRows ?? CONVERT_LIMITS.sheetRows;

  return {
    id: config.id,
    label: config.label,
    extensions: [...config.extensions],
    capabilities: { canImport: true, canExport: false },
    // A reflow of the grid, not a byte-faithful reproduction.
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff: config.sniff,

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      if (bytes.length === 0) throw new ConvertFailure('empty-file');
      const head = bytes.subarray(0, 8);

      if (isZipHead(head)) {
        // An `.ods`/`.xlsx` is a ZIP: apply the shared zip-bomb ceiling before
        // SheetJS expands it.
        try {
          inspectZip(new Uint8Array(bytes), config.zipLimits);
        } catch (thrown) {
          if (thrown instanceof ConvertZipError) {
            throw new ConvertFailure(thrown.code, thrown.message);
          }
          throw thrown;
        }
      } else if (!isCfbHead(head)) {
        throw new ConvertFailure(
          'corrupt',
          'The file is not a readable spreadsheet container (no XLSX/ODS ZIP or XLS OLE header).',
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('parsing', 0.35);
      let workbook: ReturnType<typeof readWorkbook>;
      try {
        workbook = readWorkbook(bytes, {
          type: 'buffer',
          // Keep the file's own number/date formats and pre-formatted text.
          cellText: true,
          cellNF: true,
          cellDates: false,
        });
      } catch (thrown) {
        throw new ConvertFailure(
          'corrupt',
          `The spreadsheet could not be read: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        );
      }

      const sheetNames = workbook.SheetNames ?? [];
      if (sheetNames.length === 0) {
        throw new ConvertFailure('decode-failed', 'The workbook contains no sheets.');
      }
      const grids: SheetGrid[] = [];
      for (const name of sheetNames) {
        const worksheet = workbook.Sheets[name];
        if (worksheet === undefined) continue;
        const grid = worksheetToGrid(name, worksheet, maxRows);
        if (grid.cells.length === 0) continue;
        grids.push(grid);
      }
      if (grids.length === 0) {
        throw new ConvertFailure(
          'decode-failed',
          'The workbook contains no cell data, so there is nothing to render.',
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.6);
      const rendered = renderWorkbookHtml(grids, {
        gridlines: options.spreadsheetGridlines,
        fitToWidth: options.spreadsheetFitToWidth,
        orientation: options.spreadsheetOrientation,
        pageSize: options.pageSize,
        marginMm: options.marginMm,
      });
      const html = injectSecurityMeta(rendered.html);
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
        // The composed `@page` rule carries the chosen orientation.
        preferCSSPageSize: true,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [];
      for (const limit of rendered.rowLimitSheets) {
        warnings.push({
          code: 'row-limit',
          message: `Sheet "${limit.sheet}" has ${limit.rowCount} rows; only the first ${limit.renderedRows} were imported.`,
          detail:
            'The row ceiling was reached for this sheet; remaining rows were not rendered.',
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: config.id,
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** `.xlsx` — OOXML spreadsheet (ZIP). */
export function createXlsxAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.spreadsheetBytes,
  zipLimits?: ZipLimits,
  maxRows: number = CONVERT_LIMITS.sheetRows,
): ConversionAdapter {
  return createSheetAdapter({
    id: 'xlsx',
    label: 'Excel workbook',
    extensions: ['.xlsx'],
    sniff: (_path, head) => looksLikeXlsx(head),
    print,
    maxBytes,
    zipLimits,
    maxRows,
  });
}

/** `.xls` — legacy BIFF (OLE/CFB). */
export function createXlsAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.spreadsheetBytes,
  maxRows: number = CONVERT_LIMITS.sheetRows,
): ConversionAdapter {
  return createSheetAdapter({
    id: 'xls',
    label: 'Excel workbook (legacy .xls)',
    extensions: ['.xls'],
    sniff: (path, head) => looksLikeXls(path, head),
    print,
    maxBytes,
    maxRows,
  });
}

/** `.ods` — OpenDocument spreadsheet (ZIP). */
export function createOdsAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.spreadsheetBytes,
  zipLimits?: ZipLimits,
  maxRows: number = CONVERT_LIMITS.sheetRows,
): ConversionAdapter {
  return createSheetAdapter({
    id: 'ods',
    label: 'OpenDocument spreadsheet',
    extensions: ['.ods'],
    sniff: (_path, head) => looksLikeOds(head),
    print,
    maxBytes,
    zipLimits,
    maxRows,
  });
}

/** The shipped adapters; the registry loads these three. */
export const xlsxAdapter: ConversionAdapter = createXlsxAdapter();
export const xlsAdapter: ConversionAdapter = createXlsAdapter();
export const odsAdapter: ConversionAdapter = createOdsAdapter();