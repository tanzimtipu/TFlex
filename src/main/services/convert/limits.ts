import type { ConvertOptions } from '../../../shared/convert';
import type {
  ImageImportDefaults,
  OfficeConvertDefaults,
} from '../../../shared/types';
import { ConvertFailure } from './errors';

/**
 * Phase 53 — every conversion ceiling lives here (ruling 7: streaming over
 * buffering; a format that must buffer gets a typed `too-large`, never an
 * OOM). Phase 54-57 add their own keys (decoded frames, rows per sheet, ...).
 */
export const CONVERT_LIMITS = {
  /** Bytes read for content sniffing before resolution. */
  sniffHeadBytes: 4096,
  /** Largest `.txt` input a non-streaming fallback path may buffer. */
  textBytes: 64 * 1024 * 1024,
  /** Chunk size for the streamed text reader. */
  textChunkBytes: 64 * 1024,
  /** Phase 54 — PNG/JPEG byte ceiling (raster embed buffers the file). */
  imageBytes: 128 * 1024 * 1024,
  /** Phase 54 — TIFF byte ceiling. `utif` requires the whole file in memory,
   *  so this is a hard ceiling rather than a streaming one. */
  tiffBytes: 512 * 1024 * 1024,
  /** Phase 54 (DEF-385) — hard ceiling on one TIFF frame's declared pixels.
   *  `UTIF.decodeImage`/`toRGBA8` allocate `width*height*4` bytes BEFORE the
   *  adapter's own guard can run, so a frame above this is rejected up front
   *  (64 MP -> a 256 MiB RGBA buffer at most). */
  tiffFramePixels: 64 * 1024 * 1024,
  /** Phase 54 (DEF-380) — hard ceiling on the pre-validated IFD chain length.
   *  `utif` walks the chain with `while(true)`; the adapter's own preflight
   *  refuses a chain above this before `UTIF.decode` is ever called. */
  tiffIfdChain: 10_000,
  /** Phase 54 — soft ceiling on TIFF frames. A stack above this still
   *  converts; the adapter warns loudly (never a silent truncation). */
  tiffFrames: 1000,
  /** Phase 54 — SVG byte ceiling. The XML is decoded to a string and parsed
   *  in memory, so an oversized document gets a typed `too-large`. */
  svgBytes: 64 * 1024 * 1024,
  /** Phase 55 — `.docx` byte ceiling. The ZIP container and the embedded
   *  images are buffered before `mammoth` runs. */
  docxBytes: 256 * 1024 * 1024,
  /** Phase 55 — `.odt` byte ceiling. `content.xml` and the picture payloads
   *  are buffered/decompressed in memory. */
  odtBytes: 128 * 1024 * 1024,
  /** Phase 55 — legacy binary `.doc` byte ceiling. The CFB walker reads the
   *  whole container; the text recovery itself is bounded separately. */
  docBytes: 128 * 1024 * 1024,
  /** Phase 55 feature B — spreadsheet (`.xlsx`/`.xls`/`.ods`) byte ceiling.
   *  SheetJS decodes the whole workbook into in-memory records before the grid
   *  is built, so the file is buffered. */
  spreadsheetBytes: 256 * 1024 * 1024,
  /** Phase 55 feature B — the documented per-sheet row ceiling. A sheet above
   *  this is rendered up to the ceiling AND reported with a `row-limit`
   *  warning naming the sheet and its true count; rows are never dropped
   *  silently. A 20,000-row workbook is far below it. */
  sheetRows: 100_000,
  /** Phase 55 (DEF-392) — hard ceiling on one sheet's DECLARED cell extent
   *  (declared rows x declared columns, from the file's `dimension` ref folded
   *  with every `mergeCell` ref), preflighted BEFORE any cell is materialised;
   *  above it the sheet is REFUSED with a typed `too-large`. */
  sheetCells: 1_000_000,
  /** Phase 55 (DEF-392) — hard ceiling on a sheet's DECLARED column extent AND
   *  its declared total cell extent (declared rows x declared columns, from the
   *  file's `dimension` ref folded with every `mergeCell` ref). A sheet above
   *  either is REFUSED with a typed `too-large` before any cell is materialised.
   *  A sheet within both keeps today's behaviour: rows capped at `sheetRows`
   *  with the `row-limit` warning (DEF-389). */
  sheetColumns: 1_024,
  /** Phase 55 feature C — `.pptx` byte ceiling. The ZIP container and its
   *  media are buffered/decompressed in memory before the slide XML maps. */
  pptxBytes: 256 * 1024 * 1024,
  /** Phase 55 feature C — legacy binary `.ppt` byte ceiling. The CFB walker
   *  reads the whole container; text recovery is bounded separately. */
  pptBytes: 128 * 1024 * 1024,
  /** Phase 56 feature A — `.epub` byte ceiling. The ZIP container and its
   *  base64-inlined images are buffered in memory before printing. */
  epubBytes: 128 * 1024 * 1024,
  /** Phase 56 feature C — `.cbz` comic byte ceiling. The ZIP container and its
   *  base64-inlined page images are buffered in memory before printing. */
  cbzBytes: 128 * 1024 * 1024,
  /** Phase 56 feature C — `.cbt` comic byte ceiling. The whole TAR is read in
   *  memory; the record count and per-record/total payload ceilings live in
   *  `tar-read.ts` (`TarLimits`), mirroring the ZIP guard in `convert-zip.ts`. */
  cbtBytes: 128 * 1024 * 1024,
  /** Phase 56 feature B — legacy Mobipocket (`.mobi`/`.azw`/`.azw3`) byte
   *  ceiling. The PalmDB records are buffered and the PalmDOC text records are
   *  decompressed in memory before printing; the decompressed text is bounded
   *  separately at 32 MB (`mobi-parse.ts`), like the `.odt` text ceiling. */
  mobiBytes: 128 * 1024 * 1024,
  /** Phase 56 (DEF-396/397) — hard ceiling on the number of image references a
   *  single chapter/composition may inline. The amplifier is references x image
   *  bytes: a small image referenced thousands of times multiplies the output,
   *  so a per-image cap is not a guard. Above this the inlining step is refused
   *  with a typed `too-large` BEFORE any `data:` URI is built. */
  inlinedImageRefs: 5_000,
  /** Phase 56 (DEF-396/397) — hard ceiling on the projected total `data:` URI
   *  bytes one chapter/composition may inline (`encodedLength x
   *  referenceCount`, summed per referenced image), preflighted BEFORE any URI
   *  is built. 64 MiB keeps the same order as the EPUB/MOBI byte ceilings. */
  inlinedImageBytes: 64 * 1024 * 1024,
} as const;

/**
 * Phase 56 (DEF-396/397) — preflight the projected inlined-image total for one
 * chapter/composition BEFORE any `data:` URI is built. `entries` is one row per
 * distinct referenced image: its encoded URI length and how many times the
 * markup references it. The amplifier is references x bytes, so a per-image cap
 * is not a guard. Above either ceiling the whole inlining step is refused with a
 * typed `too-large` naming the label, the reference count, the projected MB and
 * the ceiling. Returns the totals so callers/tests can record them.
 */
export function assertInlinedImageBudget(
  label: string,
  entries: Iterable<{ encodedLength: number; refCount: number }>,
): { refs: number; bytes: number } {
  let refs = 0;
  let bytes = 0;
  for (const entry of entries) {
    refs += entry.refCount;
    bytes += entry.encodedLength * entry.refCount;
  }
  if (
    refs > CONVERT_LIMITS.inlinedImageRefs ||
    bytes > CONVERT_LIMITS.inlinedImageBytes
  ) {
    const ceilingMb = Math.round(CONVERT_LIMITS.inlinedImageBytes / (1024 * 1024));
    const projectedMb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    throw new ConvertFailure(
      'too-large',
      `The ${label} would inline ${refs} image reference(s), about ${projectedMb} MB of data URIs, above the ${CONVERT_LIMITS.inlinedImageRefs}-reference / ${ceilingMb} MB inlining ceiling; the document was not converted.`,
    );
  }
  return { refs, bytes };
}

/** `ConvertOptions` with every key resolved — what adapters receive. */
export type ResolvedConvertOptions = Required<ConvertOptions>;
/** The documented defaults a missing option resolves to; mirrors
 *  `DEFAULT_CONVERT_DEFAULTS` and is the one source adapters read. */
export const DEFAULT_CONVERT_OPTIONS: ResolvedConvertOptions = {
  pageSize: 'a4',
  marginMm: 20,
  textFontFamily: 'Inter',
  textFontSizePt: 11,
  csvDelimiter: 'auto',
  csvFormMapping: true,
  htmlPrintBackgrounds: true,
  imagePageSizeMode: 'image',
  imageFixedPageSize: 'a4',
  imageFit: 'contain',
  imageRotationDeg: 0,
  // Phase 55 feature B — the spreadsheet import block. Mirrors the
  // `officeConvertDefaults.spreadsheets` Settings shape one-for-one; each key
  // changes the composed HTML/print options observably.
  spreadsheetGridlines: true,
  spreadsheetFitToWidth: true,
  spreadsheetOrientation: 'auto',
  // Phase 55 feature C — the presentation import block. Mirrors the
  // `officeConvertDefaults.presentations` Settings shape; the renderer maps a
  // stored setting onto this per-call option.
  presentationIncludeNotes: false,
};

/** Map the stored `officeConvertDefaults` Settings shape onto the per-call
 *  `ConvertOptions` keys the adapters already read. `exports.includeImages` is
 *  NOT mapped here: it belongs to the export writers, which resolve it in
 *  `src/main/index.ts`. This is the one place an import turns a stored office
 *  setting into an option; without it a stored setting is never applied (DEF-388). */
export function officeConvertOptions(
  defaults: OfficeConvertDefaults,
): ConvertOptions {
  return {
    spreadsheetGridlines: defaults.spreadsheets.gridlines,
    spreadsheetFitToWidth: defaults.spreadsheets.fitToWidth,
    spreadsheetOrientation: defaults.spreadsheets.orientation,
    presentationIncludeNotes: defaults.presentations.includeNotes,
  };
}

/** Map the stored `imageImportDefaults` Settings shape onto the per-call
 *  `ConvertOptions` keys the image/TIFF/SVG adapters already read. This is the
 *  one place an import turns a stored image setting into an option; without it
 *  a stored setting is never applied (the same defect class as DEF-388). */
export function imageImportOptions(
  defaults: ImageImportDefaults,
): ConvertOptions {
  return {
    imagePageSizeMode: defaults.pageSizeMode,
    imageFixedPageSize: defaults.fixedPageSize,
    imageFit: defaults.fit,
    imageRotationDeg: defaults.rotationDeg,
  };
}

/**
 * Fill a caller-supplied partial `ConvertOptions` from the defaults, then from
 * the stored office and image Settings when the service has them. Precedence is
 * `DEFAULT_CONVERT_OPTIONS` < stored settings < an explicit caller option, so an
 * explicit per-call option always wins (DEF-388).
 */
export function resolveConvertOptions(
  raw?: ConvertOptions,
  officeDefaults?: OfficeConvertDefaults,
  imageDefaults?: ImageImportDefaults,
): ResolvedConvertOptions {
  return {
    ...DEFAULT_CONVERT_OPTIONS,
    ...(officeDefaults === undefined
      ? {}
      : officeConvertOptions(officeDefaults)),
    ...(imageDefaults === undefined ? {} : imageImportOptions(imageDefaults)),
    ...(raw ?? {}),
  };
}
