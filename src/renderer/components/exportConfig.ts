// Phase 112 (TFL-854, chunk C5) — the Deliver export-configuration model.
//
// The RIGHT Deliver inspector surfaces the export being prepared: a supported
// format, an applicable preset/options, a page scope validated by the REAL
// parser, an output name and the existing Export action. This module owns the
// pure model the surface reads, so the contract (which options apply to which
// format, how a scope becomes a range, how a range is validated, which gate
// disables a format and what the honest fidelity warning says) is unit-testable
// without a DOM.
//
// It REUSES the shipped models and never forks them:
//   - the office format union + fidelity notes from `shared/export.ts`;
//   - the image format union + defaults from `state/preferences.ts`;
//   - the one page-range parser from `engine/types.ts`;
//   - the live office bridge gate from `state/dockModel.ts`.

import { EXPORT_FORMATS, EXPORT_FIDELITY_NOTES, type ExportFormat } from '../../shared/export';
import {
  DEFAULT_EXPORT_IMAGE_FORMAT,
  EXPORT_IMAGE_FORMATS,
} from '../state/preferences';
import type { ExportImageFormat } from '../../shared/types';
import { defaultPageRange, parsePageRange } from '../engine/types';
import { DOCK_AVAILABILITY_REASON, officeExportGate } from '../state/dockModel';

/** Every format the Deliver export surface can prepare. */
export type ExportConfigFormat = ExportImageFormat | ExportFormat;

export interface ExportFormatOption {
  id: ExportConfigFormat;
  /** The user-facing label (the raw id is shown separately as the fact). */
  label: string;
  group: 'image' | 'office';
  /** The format needs the optional `window.tflex.export` bridge. */
  needsOfficeBridge: boolean;
  /** A resolution applies (rasterised page images). */
  usesDpi: boolean;
  /** A page range applies. */
  usesRange: boolean;
}

const IMAGE_LABELS: Record<ExportImageFormat, string> = {
  png: 'Images · PNG (lossless)',
  jpeg: 'Images · JPEG (smaller, lossy)',
  tiff: 'Images · TIFF (print-grade raster)',
};

const OFFICE_LABELS: Record<ExportFormat, string> = {
  txt: 'Text (.txt)',
  docx: 'Word (.docx)',
  xlsx: 'Excel (.xlsx)',
  pptx: 'PowerPoint (.pptx)',
};

/** Image formats first (the shipped default group), then the office writers. */
export const EXPORT_CONFIG_FORMATS: readonly ExportFormatOption[] = [
  ...EXPORT_IMAGE_FORMATS.map(
    (id): ExportFormatOption => ({
      id,
      label: IMAGE_LABELS[id],
      group: 'image',
      needsOfficeBridge: false,
      usesDpi: true,
      usesRange: true,
    }),
  ),
  ...EXPORT_FORMATS.map(
    (id): ExportFormatOption => ({
      id,
      label: OFFICE_LABELS[id],
      group: 'office',
      needsOfficeBridge: id === 'xlsx' || id === 'pptx',
      // The image DPI governs the raster pages an office writer embeds; it is
      // inapplicable to the text-only writers. Non-image formats hide it.
      usesDpi: false,
      usesRange: id === 'xlsx' || id === 'pptx',
    }),
  ),
];

/** Resolve a format to its option, or null for an unknown value. */
export function exportFormatOption(format: unknown): ExportFormatOption | null {
  if (typeof format !== 'string') return null;
  return EXPORT_CONFIG_FORMATS.find((o) => o.id === format) ?? null;
}

/** The default format the surface opens on (the persisted image default). */
export const DEFAULT_EXPORT_CONFIG_FORMAT: ExportConfigFormat =
  DEFAULT_EXPORT_IMAGE_FORMAT;

/** The page-scope choices the design spec names explicitly. */
export type ExportPageScope = 'all' | 'current' | 'custom';

/** The scope's display label. */
export function exportScopeLabel(scope: ExportPageScope): string {
  switch (scope) {
    case 'all':
      return 'All pages';
    case 'current':
      return 'Current page';
    case 'custom':
      return 'Custom range';
  }
}

/** The effective range TEXT for a scope. All -> the full span; Current -> the
 *  one page; Custom -> the user's own expression (parsed below). */
export function exportRangeText(
  scope: ExportPageScope,
  custom: string,
  totalPages: number,
  currentPage: number,
): string {
  if (scope === 'all') return defaultPageRange(totalPages);
  if (scope === 'current') {
    return totalPages <= 0 ? '' : String(Math.min(Math.max(1, currentPage), totalPages));
  }
  return custom;
}

export interface ExportRangeValidation {
  valid: boolean;
  /** The parsed, sorted, deduped 1-based pages; null when invalid. */
  parsed: number[] | null;
  /** A short, field-close error when invalid; null when valid. */
  error: string | null;
}

/** Validate a range expression through the REAL parser. The surface shows the
 *  error next to the field; the host never receives an invalid range. */
export function validateExportRange(
  text: string,
  totalPages: number,
): ExportRangeValidation {
  if (totalPages <= 0) {
    return { valid: false, parsed: null, error: 'Open a document first.' };
  }
  const parsed = parsePageRange(text, totalPages);
  if (parsed === null || parsed.length === 0) {
    return {
      valid: false,
      parsed: null,
      error: `Enter a page range between 1 and ${totalPages} (e.g. 1-3 or 2,4).`,
    };
  }
  return { valid: true, parsed, error: null };
}

export interface ExportGate {
  enabled: boolean;
  reason: string | undefined;
}

/** The live gate for a format. The office writers (`xlsx` / `pptx`) reuse the
 *  shipped `officeExportGate` so the disabled reason is the ONE string the dock,
 *  palette and registry already read; every other format only needs a document. */
export function exportConfigGate(
  format: ExportConfigFormat,
  args: { hasDocument: boolean; bridgePresent: boolean },
): ExportGate {
  const option = exportFormatOption(format);
  if (option !== null && option.needsOfficeBridge) {
    return officeExportGate(args);
  }
  if (!args.hasDocument) {
    return { enabled: false, reason: DOCK_AVAILABILITY_REASON.document };
  }
  return { enabled: true, reason: undefined };
}

/** The mandatory fidelity statements for an office format, or null for an image
 *  format (images have no conversion limits to warn about). */
export function exportFidelityNotes(
  format: ExportConfigFormat,
): readonly string[] | null {
  const option = exportFormatOption(format);
  if (option === null || option.group !== 'office') return null;
  return EXPORT_FIDELITY_NOTES[format as ExportFormat];
}

/** The primary action's label: the design spec's "Export images" or the actual
 *  selected format. Never a generic "Export". */
export function exportPrimaryLabel(format: ExportConfigFormat): string {
  const option = exportFormatOption(format);
  if (option === null) return 'Export';
  if (option.group === 'image') return 'Export images';
  return `Export ${OFFICE_LABELS[option.id as ExportFormat]}`;
}

/** The prepared output name for a format, derived from the real source name (no
 *  fabricated destination). The existing dialogs own the actual save flow. */
export function exportDefaultName(sourceName: string, format: ExportConfigFormat): string {
  const base = sourceName.replace(/\.[^./\\]+$/, '') || 'document';
  return `${base}.${format}`;
}

// ---------------------------------------------------------------------------
// Phase 112 (C5 follow-up, TFL-985) - carrying the prepared request into the
// EXISTING export dialog.

/** The dialog initial props the Inspector's prepared request seeds. The
 *  format, the parser-validated range as TEXT the dialog re-parses, the DPI and
 *  the prepared output name. The seed is a convenience: the dialog still owns
 *  its own parsing, validation, save, progress and errors. */
export interface ExportDialogSeed {
  format: ExportConfigFormat;
  /** The request's validated pages rendered as a dialog range expression. */
  initialRange: string;
  /** The request's resolution; null for formats that carry no DPI. */
  initialDpi: number | null;
  /** The prepared output name the dialog derives its filename from. */
  initialOutputName: string;
}

/** Render sorted 1-based pages as a compact range expression ("1-3,5,7-9").
 *  The dialog re-parses this through the shipped parser, so an unknown or
 *  out-of-bounds expression still fails the dialog's OWN validation - the seed
 *  never bypasses a check. An empty list renders as an empty string. */
export function exportRangeExpression(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) return '';
  const parts: string[] = [];
  let start = first;
  let prev = first;
  for (let i = 1; i < sorted.length; i += 1) {
    const page = sorted[i] as number;
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = page;
    prev = page;
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(',');
}

/** The filename stem of a prepared output name (its final extension stripped),
 *  so each dialog's own filename helper appends the extension for the format
 *  the user ACTUALLY exports. */
export function exportOutputNameStem(outputName: string): string {
  return outputName.replace(/\.[^./\\]+$/, '') || outputName;
}

/** TFL-1000 (Phase 112, DEF-602) — split a sorted, deduped 1-based page list
 *  into its contiguous `[start,end]` runs. The engine payload's `range` is ONE
 *  continuous inclusive span (`src/shared/types.ts`), so a dialog that wants to
 *  export a non-contiguous selection exactly calls the engine once per run
 *  rather than collapsing the selection to `[first,last]` and silently
 *  exporting the unrequested pages in between. */
export function contiguousPageRuns(
  pages: readonly number[],
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const page of pages) {
    const last = runs[runs.length - 1];
    if (last !== undefined && page === last[1] + 1) {
      last[1] = page;
      continue;
    }
    runs.push([page, page]);
  }
  return runs;
}

/** Build the export dialog's initial props from the Inspector's prepared
 *  request. The request is carried verbatim; the dialog still owns parsing and
 *  validation, so the seed never becomes a bypass. */
export function exportDialogSeed(request: {
  format: ExportConfigFormat;
  range: readonly number[];
  dpi: number;
  outputName: string;
}): ExportDialogSeed {
  return {
    format: request.format,
    initialRange: exportRangeExpression(request.range),
    initialDpi: request.dpi,
    initialOutputName: request.outputName,
  };
}
