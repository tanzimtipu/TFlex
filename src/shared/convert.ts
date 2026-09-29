/**
 * Phase 53 — Universal file handling: the conversion program contract.
 *
 * Types only (no logic, no I/O). This is the stable surface every adapter in
 * Phases 53-57 targets: the DocumentConversionService in
 * `src/main/services/convert/` implements it, the registry routes on
 * `ConvertFormatId`, and the renderer consumes `ConvertSourceInfo` /
 * `ConvertProgress` over IPC. `ConvertResult.bytes` never crosses IPC — the
 * bytes enter the EXISTING engine directly (ruling 1: one document model).
 *
 * The format ids are declared now, ahead of their adapters, so Phases 54-57
 * consume a stable union instead of retrofitting it.
 */

/** Every import format the five-phase program covers. Only `'text'` has an
 *  adapter after Phase 53 chunk A; the rest are contract now. */
export type ConvertFormatId =
  | 'text'
  | 'markdown'
  | 'rtf'
  | 'csv'
  | 'html'
  | 'png'
  | 'jpeg'
  | 'tiff'
  | 'svg'
  | 'docx'
  | 'odt'
  /** Phase 55 — legacy binary Word (OLE/CFB), text-only degraded import. */
  | 'doc'
  | 'xlsx'
  /** Phase 55 feature B — legacy binary Excel (BIFF/OLE-CFB). */
  | 'xls'
  | 'ods'
  | 'pptx'
  /** Phase 55 feature C — legacy binary PowerPoint (OLE/CFB), text-only
   *  degraded import sharing the `.doc` CFB walker. */
  | 'ppt'
  | 'epub'
  | 'mobi'
  | 'cbz'
  | 'cbt';

/** How faithful the produced PDF is to the source. Declared by every
 *  conversion (ruling 3) — never implied. */
export type ConvertFidelity = 'native' | 'layout' | 'degraded';

/** A non-fatal conversion problem the UI shows next to the fidelity label. */
export type ConvertWarningCode =
  | 'generic-fallback'
  | 'legacy-format-degraded'
  | 'resource-blocked'
  | 'partial-content'
  | 'row-limit'
  | 'links-not-live'
  | 'rasterized'
  | 'gradient-approx'
  | 'unsupported-compression'
  | 'drm-protected'
  | 'no-text-layer'
  | 'approx-render'
  // Phase 54 — imaging warnings.
  | 'dpi-assumed'
  | 'frame-decode-failed'
  | 'frame-limit'
  /** Phase 54 — SVG constructs outside the native subset were rendered by the
   *  offscreen engine instead of being translated. */
  | 'engine-rendered'
  /** Phase 54 (DEF-382) — the image's resolution metadata produced a page
   *  outside the documented point range, so it was clamped. */
  | 'page-clamped';

export interface ConvertWarning {
  code: ConvertWarningCode;
  /** Human-readable, shown in the conversion card. */
  message: string;
  /** Optional technical detail (blocked URL, format name, ...). */
  detail?: string;
}

/** A fatal conversion failure. Every code has a human message (see
 *  `CONVERT_ERROR_MESSAGES` in `src/main/services/convert/errors.ts`);
 *  conversion never throws across IPC (ruling 4). */
export type ConvertErrorCode =
  | 'unsupported-format'
  | 'empty-file'
  | 'password-required'
  | 'too-large'
  | 'decode-failed'
  | 'corrupt'
  | 'cancelled'
  | 'timeout'
  | 'internal';

/** Result of `sourceInfo` — what the file is and how faithfully it can be
 *  imported, known BEFORE conversion. */
export interface ConvertSourceInfo {
  format: ConvertFormatId;
  /** Human label, e.g. `Text document`. */
  label: string;
  fidelity: ConvertFidelity;
  /** Only when cheaply knowable without a full conversion. */
  pageCount?: number;
}

/** Per-import defaults; every key optional here (the service resolves the
 *  missing ones from `ConvertDefaults` / `DEFAULT_CONVERT_OPTIONS`). Mirrors
 *  the Phase 53 `convertDefaults` Settings shape exactly. */
export interface ConvertOptions {
  pageSize?: 'a4' | 'letter';
  marginMm?: number;
  textFontFamily?: string;
  textFontSizePt?: number;
  csvDelimiter?: 'auto' | ',' | ';' | '\t';
  csvFormMapping?: boolean;
  htmlPrintBackgrounds?: boolean;
  // Phase 54 — the image import block. Mirrors the `imageImportDefaults`
  // Settings shape one-for-one; the renderer maps a stored setting onto these
  // per-call options. Every key optional here (resolved from
  // `DEFAULT_CONVERT_OPTIONS` by the service).
  imagePageSizeMode?: 'image' | 'fixed';
  imageFixedPageSize?: 'a4' | 'letter';
  imageFit?: 'contain' | 'cover' | 'actual';
  imageRotationDeg?: 0 | 90 | 180 | 270;
  // Phase 55 feature B — the spreadsheet import block. Mirrors the
  // `officeConvertDefaults.spreadsheets` Settings shape one-for-one; the
  // renderer maps a stored setting onto these per-call options. Every key
  // optional here (resolved from `DEFAULT_CONVERT_OPTIONS` by the service).
  spreadsheetGridlines?: boolean;
  spreadsheetFitToWidth?: boolean;
  spreadsheetOrientation?: 'auto' | 'portrait' | 'landscape';
  // Phase 55 feature C — the presentation import block. Mirrors the
  // `officeConvertDefaults.presentations` Settings shape; the renderer maps the
  // stored setting onto this per-call option. Optional here (resolved from
  // `DEFAULT_CONVERT_OPTIONS` by the service).
  presentationIncludeNotes?: boolean;
}

/** What an adapter returns. `bytes` go straight to the engine, never back
 *  over IPC as a `ConvertOpenResult`. */
export interface ConvertResult {
  bytes: Uint8Array;
  pageCount: number;
  sourceFormat: ConvertFormatId;
  fidelity: ConvertFidelity;
  warnings: ConvertWarning[];
  title: string;
}

/** What the renderer receives after a successful import: the engine already
 *  holds the bytes, so only the doc handle + metadata come back. */
export interface ConvertOpenResult {
  docId: string;
  pageCount: number;
  sourceFormat: ConvertFormatId;
  fidelity: ConvertFidelity;
  warnings: ConvertWarning[];
  title: string;
}

/** Phase 54 — result of `toDocumentMany`: N source files converted into ONE
 *  engine document, in the given order. A dedicated shape (rather than
 *  `ConvertOpenResult`) because a mixed selection has no single
 *  `sourceFormat`; the per-file formats are reported in order. */
export interface ConvertManyResult {
  docId: string;
  pageCount: number;
  /** Each contributing file's format, in page order (one entry per path). */
  sourceFormats: ConvertFormatId[];
  /** The weakest fidelity across the parts. */
  fidelity: ConvertFidelity;
  warnings: ConvertWarning[];
  title: string;
}

/** Phase 53 feature G mode 2 - the outcome of mapping CSV headers onto an
 *  already-open document's AcroForm fields. `matched` and `filled` describe what
 *  happened; `unmatchedHeaders` (a header with no field) and `missingFields` (a
 *  field with no column) are informational, never errors. */
export interface CsvFieldMappingResult {
  /** Field names that a CSV header matched (exact first, then case-insensitive). */
  matched: string[];
  /** Headers with no matching field. */
  unmatchedHeaders: string[];
  /** Fields with no matching column. */
  missingFields: string[];
  /** Number of fields whose value was written. */
  filled: number;
  warnings: ConvertWarning[];
}

/** Progress pushed over the `convert:progress` channel while an import runs. */
export interface ConvertProgress {
  jobId: string;
  phase: string;
  /** 0..1 when the phase can estimate its extent. */
  ratio?: number;
}

/** The Phase 53 `convertDefaults` Settings payload — every key required. */
export interface ConvertDefaults {
  pageSize: 'a4' | 'letter';
  marginMm: number;
  textFontFamily: string;
  textFontSizePt: number;
  csvDelimiter: 'auto' | ',' | ';' | '\t';
  csvFormMapping: boolean;
  htmlPrintBackgrounds: boolean;
}

/** The documented import defaults a missing `convertDefaults` resolves to. */
export const DEFAULT_CONVERT_DEFAULTS: ConvertDefaults = {
  pageSize: 'a4',
  marginMm: 20,
  textFontFamily: 'Inter',
  textFontSizePt: 11,
  csvDelimiter: 'auto',
  csvFormMapping: true,
  htmlPrintBackgrounds: true,
};
