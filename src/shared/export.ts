import type { DocxImageEntry } from './types';
import { err, ok, type Result } from './result';

/**
 * Phase 55 feature D — the PDF -> office export contract.
 *
 * `txt` and `docx` already exist (engine `exportText` and
 * `createDocxFromDoc`); `xlsx` and `pptx` are the two writers this chunk adds.
 * This module owns the format union, the payload/result types and the one
 * mandatory artefact every export carries: `EXPORT_FIDELITY_NOTES`, the blunt,
 * user-facing statement of what the produced file does and does not preserve.
 * The UI must display the note for the chosen format before/after exporting.
 */

/** The four export targets the app offers. */
export type ExportFormat = 'txt' | 'docx' | 'xlsx' | 'pptx';

/** Every format, in UI order. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['txt', 'docx', 'xlsx', 'pptx'];

/**
 * Typed export failure codes. `unsupported-format` is the guard for an
 * unrecognised format name (the channels fix the format, but the shared
 * resolver is still the single authority); `engine-error` is a failed text
 * extraction; `empty-range` mirrors the engine's own code. Exports never throw
 * across IPC.
 */
export type ExportErrorCode = 'unsupported-format' | 'engine-error' | 'empty-range';

/** One page's extracted text, mirroring `TextPage` from `engine.exportText`.
 *  Declared here (structurally identical) so the export service can be unit
 *  tested without importing the engine's full type surface. */
export interface ExportTextPage {
  pageIndex: number; // 1-based
  text: string;
}

/**
 * A caller-supplied rasterised page for the xlsx/pptx writers. Deliberately
 * the same shape as `DocxImageEntry` (1-based `pageNumber`, PNG bytes, pixel
 * and PDF-point dimensions) so the renderer rasterises a page ONCE and every
 * export path consumes it. `pageWidth`/`pageHeight` are the page box in PDF
 * points and are what sizes a PowerPoint slide.
 */
export type ExportPageImage = DocxImageEntry;

/** Payload of `export:xlsx`. `includeImages` defaults from
 *  `officeConvertDefaults.exports.includeImages` when omitted by the caller. */
export interface ExportXlsxPayload {
  includeImages?: boolean;
  images?: ExportPageImage[];
}

/** Payload of `export:pptx`. `entries` is the renderer's per-page PNG list. */
export interface ExportPptxPayload {
  includeImages?: boolean;
  entries?: ExportPageImage[];
}

/** The bytes an export produced plus the evidence the UI needs to be honest. */
export interface ExportBuild {
  format: ExportFormat;
  bytes: Uint8Array;
  /** The format's mandatory fidelity statements (see EXPORT_FIDELITY_NOTES). */
  fidelityNotes: string[];
  /** 1-based page numbers whose text layer was empty. */
  pagesWithoutText: number[];
}

/**
 * The honest, user-facing fidelity statement for every export format. These
 * strings are the mandatory warning the UI displays, so they must not claim
 * more than the writers achieve. Kept as arrays so a dialog can render one
 * bullet per statement.
 */
export const EXPORT_FIDELITY_NOTES: Record<ExportFormat, string[]> = {
  txt: [
    'Text only: the document text layer and its reading order, nothing else.',
    'Page layout, images, colours, tables and annotations are not included.',
  ],
  docx: [
    'Editable text: each page becomes real Word paragraphs you can edit.',
    'Fonts, weights, colours and exact positioning become plain paragraphs, so the page will not look identical.',
    'Pages with no extractable text appear as page images instead of text.',
  ],
  xlsx: [
    'The grid is DETECTED from the text layout by a spacing heuristic (two or more spaces, or a tab, start a new cell).',
    'It is a best-effort reconstruction, not the original table structure, so columns may not match the source table.',
    'Page images are appended as a separate sheet only when images are enabled; the images sheet stores the PNG data in cells because a spreadsheet writer cannot anchor pictures to a cell.',
  ],
  pptx: [
    'One slide per page, sized to the page box; a presentation has a single slide size, so the first page box is used when pages differ.',
    'The slide holds the page image when one was supplied, otherwise the extracted text as text boxes; pages with no extractable text say so.',
    'The page text is stored in the slide notes so it stays selectable even on an image-only slide.',
  ],
};

/** Resolve an untrusted value to a known export format, or null. */
export function resolveExportFormat(value: unknown): ExportFormat | null {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value)
    ? (value as ExportFormat)
    : null;
}

/**
 * The fidelity notes for a format, or a typed `unsupported-format` failure.
 * This is the single guard behind the "unknown format is unsupported-format"
 * contract; the IPC channels fix the format, but the resolver is exported for
 * tests and any future format-dispatching caller.
 */
export function exportFidelityNotes(
  format: unknown,
): Result<string[], ExportErrorCode> {
  const resolved = resolveExportFormat(format);
  if (resolved === null) {
    return err('unsupported-format', `Unsupported export format: ${String(format)}`);
  }
  return ok(EXPORT_FIDELITY_NOTES[resolved]);
}
