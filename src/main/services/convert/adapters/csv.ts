import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { readDecodedText } from './text';
import {
  buildCsvTable,
  looksLikeCsvContent,
  parseCsvRecords,
  sniffDelimiter,
} from './csv-parse';

/** Re-exported for tests. */
export type { HtmlPrintFn };

/** Phase 53 feature G mode 2 - the header + first data row of a CSV, read
 *  through the same RFC 4180 parser table mode uses. Only three records are
 *  ever reached, so a huge CSV is not parsed twice. */
export interface CsvMappingGrid {
  header: string[] | null;
  firstRow: string[] | null;
  hasMoreDataRows: boolean;
}

export async function readCsvMappingGrid(
  path: string,
  head: Buffer,
  delimiterOption: 'auto' | ',' | ';' | '\t',
): Promise<CsvMappingGrid> {
  const source = await readDecodedText(path, head);
  const delimiter =
    delimiterOption === 'auto' ? sniffDelimiter(source) : delimiterOption;
  const rows: string[][] = [];
  const stats = parseCsvRecords(
    source,
    delimiter,
    (cells) => {
      rows.push(cells);
    },
    2,
  );
  return {
    header: rows[0] ?? null,
    firstRow: rows[1] ?? null,
    hasMoreDataRows: stats.hitRowLimit,
  };
}

/**
 * Phase 53 feature G mode 1 - the `.csv` adapter (table mode).
 *
 * RFC 4180 parse (`csv-parse.ts`) into an HTML table with a real `<thead>`, then
 * the SAME chunk-B offscreen print engine the HTML/Markdown adapters use. No
 * second print path is built here.
 *
 * Declared `specific`: a `.csv` extension match must win step 1 of the registry
 * precedence rule. The content pass requires three consecutive records with the
 * same non-zero delimiter count so an ordinary `.txt` paragraph cannot be
 * captured by an incidental comma.
 *
 * In form-data mode the renderer calls `csvToDocumentFields` instead of this
 * adapter; a document that is already open keeps its fields.
 */

/** Hard row ceiling. Reached only by pathological input; hitting it warns. */
export const CSV_MAX_ROWS = 200_000;

export function createCsvAdapter(print: HtmlPrintFn = printHtmlToPdf): ConversionAdapter {
  return {
    id: 'csv',
    label: 'CSV spreadsheet',
    extensions: ['.csv'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.textBytes,

    sniff(path: string, head: Buffer): boolean {
      if (extname(path).toLowerCase() === '.csv') return true;
      return looksLikeCsvContent(head.toString('utf8'));
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, head, signal, onProgress } = ctx;
      onProgress?.('decoding', 0.1);
      const source = await readDecodedText(path, head, signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      const delimiter =
        options.csvDelimiter === 'auto'
          ? sniffDelimiter(source)
          : options.csvDelimiter;

      onProgress?.('parsing', 0.35);
      const table = buildCsvTable(source, {
        delimiter,
        maxRows: CSV_MAX_ROWS,
      });
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.6);
      const printed = await print(table.html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      const warnings: ConvertWarning[] = [];
      if (table.hitRowLimit) {
        warnings.push({
          code: 'row-limit',
          message: `Only the first ${CSV_MAX_ROWS} rows were imported.`,
          detail: 'The row limit was reached; remaining rows were not read.',
        });
      }
      if (table.raggedRows > 0) {
        warnings.push({
          code: 'partial-content',
          message: `${table.raggedRows} row(s) had fewer cells than the header and were padded.`,
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'csv',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const csvAdapter: ConversionAdapter = createCsvAdapter();
