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
};

/** Fill a caller-supplied partial `ConvertOptions` from the defaults. */
export function resolveConvertOptions(
  raw?: ConvertOptions,
): ResolvedConvertOptions {
  return { ...DEFAULT_CONVERT_OPTIONS, ...(raw ?? {}) };
}
