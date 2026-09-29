import type { ConvertOptions } from '../../../shared/convert';

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
} as const;

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
};

/** Fill a caller-supplied partial `ConvertOptions` from the defaults. */
export function resolveConvertOptions(
  raw?: ConvertOptions,
): ResolvedConvertOptions {
  return { ...DEFAULT_CONVERT_OPTIONS, ...(raw ?? {}) };
}
