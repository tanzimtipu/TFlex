import type { ConvertWarning } from '../../../shared/convert';

/**
 * Phase 54 — pure image metadata readers (PNG/JPEG/TIFF) plus the shared DPI
 * assumption rule.
 *
 * Nothing here throws on malformed input: each reader returns what it could
 * read (or `null` when the bytes are not that format) and lets the caller
 * decide. No I/O, no Electron, no pdf-lib.
 */

/** The Phase 54 documented fallback when no resolution metadata exists. */
export const ASSUMED_DPI = 96;

export type ImageDpiSource =
  | 'png-phys'
  | 'jpeg-jfif'
  | 'jpeg-exif'
  | 'tiff'
  | 'none';

export interface ImageMeta {
  widthPx: number;
  heightPx: number;
  /** Absent when the file carries no physical resolution information. */
  dpiX?: number;
  dpiY?: number;
  dpiSource: ImageDpiSource;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** JPEG starts with the SOI marker FF D8 (optionally followed by FF). */
export function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) >>> 0) +
    (bytes[at + 1] << 16) +
    (bytes[at + 2] << 8) +
    bytes[at + 3]
  );
}

function readU16BE(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[at + i]);
  return out;
}

/** PNG: pixel size from IHDR, physical size from the pHYs chunk. */
export function readPngMeta(bytes: Uint8Array): ImageMeta | null {
  if (!hasPngSignature(bytes)) return null;
  let offset = 8;
  let widthPx = 0;
  let heightPx = 0;
  let dpiX: number | undefined;
  let dpiY: number | undefined;
  let dpiSource: ImageDpiSource = 'none';
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      if (dataStart + 8 > bytes.length) break;
      widthPx = readU32(bytes, dataStart);
      heightPx = readU32(bytes, dataStart + 4);
    } else if (type === 'pHYs') {
      if (dataStart + 9 > bytes.length) break;
      const ppuX = readU32(bytes, dataStart);
      const ppuY = readU32(bytes, dataStart + 4);
      const unit = bytes[dataStart + 8];
      // Unit 0 is "unknown" (aspect ratio only) - deliberately NOT a DPI.
      if (unit === 1 && ppuX > 0 && ppuY > 0) {
        dpiX = ppuX * 0.0254;
        dpiY = ppuY * 0.0254;
        dpiSource = 'png-phys';
      }
    }
    if (type === 'IEND') break;
    offset = dataStart + length + 4;
  }
  if (widthPx === 0 || heightPx === 0) return null;
  return { widthPx, heightPx, dpiX, dpiY, dpiSource };
}

/** JPEG: pixel size from SOFn, density from JFIF APP0 or EXIF APP1. */
export function readJpegMeta(bytes: Uint8Array): ImageMeta | null {
  if (!hasJpegSignature(bytes)) return null;
  let pos = 2;
  let widthPx = 0;
  let heightPx = 0;
  let dpiX: number | undefined;
  let dpiY: number | undefined;
  let dpiSource: ImageDpiSource = 'none';
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = bytes[pos + 1];
    pos += 2;
    // Standalone markers carry no length payload.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const segLen = readU16BE(bytes, pos);
    const segStart = pos + 2;
    const segEnd = segStart + segLen - 2;
    if (marker === 0xe0 && segStart + 14 <= bytes.length) {
      if (ascii(bytes, segStart, 5) === 'JFIF\0') {
        const units = bytes[segStart + 7];
        const x = readU16BE(bytes, segStart + 8);
        const y = readU16BE(bytes, segStart + 10);
        if (x > 0 && y > 0) {
          if (units === 1) {
            dpiX = x;
            dpiY = y;
            dpiSource = 'jpeg-jfif';
          } else if (units === 2) {
            dpiX = x * 2.54;
            dpiY = y * 2.54;
            dpiSource = 'jpeg-jfif';
          }
        }
      }
    } else if (marker === 0xe1 && segStart + 6 <= bytes.length) {
      if (ascii(bytes, segStart, 6) === 'Exif\0\0') {
        const exif = readExifResolution(bytes, segStart + 6);
        if (exif !== null) {
          dpiX = exif.dpiX;
          dpiY = exif.dpiY;
          dpiSource = 'jpeg-exif';
        }
      }
    } else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      segStart + 5 <= bytes.length
    ) {
      heightPx = readU16BE(bytes, segStart + 1);
      widthPx = readU16BE(bytes, segStart + 3);
    } else if (marker === 0xda) {
      break;
    }
    if (segEnd <= pos) break;
    pos = segEnd;
  }
  if (widthPx === 0 || heightPx === 0) return null;
  return { widthPx, heightPx, dpiX, dpiY, dpiSource };
}

/**
 * Read XResolution (282), YResolution (283) and ResolutionUnit (296) from the
 * IFD0 of an embedded EXIF TIFF block. `base` points at the TIFF header
 * ("II*\0" / "MM\0*"). Returns null when the header or tags are unreadable.
 */
function readExifResolution(
  bytes: Uint8Array,
  base: number,
): { dpiX: number; dpiY: number } | null {
  if (base + 8 > bytes.length) return null;
  const order = ascii(bytes, base, 2);
  const little = order === 'II';
  const u16 = (at: number): number =>
    little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  const u32 = (at: number): number =>
    little
      ? (bytes[at] |
          (bytes[at + 1] << 8) |
          (bytes[at + 2] << 16) |
          (bytes[at + 3] << 24)) >>>
        0
      : (((bytes[at] << 24) |
          (bytes[at + 1] << 16) |
          (bytes[at + 2] << 8) |
          bytes[at + 3]) >>>
        0);
  if (u16(base + 2) !== 42) return null;
  const ifdOffset = u32(base + 4);
  const ifd = base + ifdOffset;
  if (ifd + 2 > bytes.length) return null;
  const count = u16(ifd);
  let x: number | undefined;
  let y: number | undefined;
  let unit: number | undefined;
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const num = u32(entry + 4);
    const inline = entry + 8;
    const valueAt = (): number => {
      const size = type === 5 ? 8 : type === 3 ? 2 : 4;
      if (size * num <= 4) return inline;
      return base + u32(inline);
    };
    if (tag === 282 || tag === 283) {
      const at = valueAt();
      if (type === 5) {
        const numerator = u32(at);
        const denominator = u32(at + 4);
        if (denominator > 0) {
          const v = numerator / denominator;
          if (tag === 282) x = v;
          else y = v;
        }
      }
    } else if (tag === 296 && type === 3) {
      unit = u16(valueAt());
    }
  }
  if (x === undefined || y === undefined || x <= 0 || y <= 0) return null;
  // Unit 2 = inch (default when absent); unit 3 = centimetre.
  const factor = unit === 3 ? 2.54 : 1;
  return { dpiX: x * factor, dpiY: y * factor };
}

function firstNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0])
  ) {
    return value[0];
  }
  return undefined;
}

/**
 * TIFF: read width/height and the resolution tags off a `utif` IFD object.
 * `utif` keys tags as `t256` / `t257` (dimensions) and `t282` / `t283` /
 * `t296` (resolution + unit); rationals arrive as plain numbers.
 */
export function readTiffIfdMeta(ifd: Record<string, unknown>): ImageMeta {
  const widthPx = firstNumber(ifd.t256) ?? 0;
  const heightPx = firstNumber(ifd.t257) ?? 0;
  const x = firstNumber(ifd.t282);
  const y = firstNumber(ifd.t283);
  const unit = firstNumber(ifd.t296);
  if (x !== undefined && y !== undefined && x > 0 && y > 0) {
    const factor = unit === 3 ? 2.54 : 1;
    return {
      widthPx,
      heightPx,
      dpiX: x * factor,
      dpiY: y * factor,
      dpiSource: 'tiff',
    };
  }
  return { widthPx, heightPx, dpiSource: 'none' };
}

/** Resolve the DPI actually used for sizing, flagging the 96 DPI assumption. */
export function resolveDpi(meta: ImageMeta): {
  dpiX: number;
  dpiY: number;
  assumed: boolean;
} {
  const okX = meta.dpiX !== undefined && meta.dpiX > 0;
  const okY = meta.dpiY !== undefined && meta.dpiY > 0;
  return {
    dpiX: okX ? (meta.dpiX as number) : ASSUMED_DPI,
    dpiY: okY ? (meta.dpiY as number) : ASSUMED_DPI,
    assumed: !(okX && okY),
  };
}

/** The exact Phase 54 warning emitted whenever the 96 DPI fallback is used. */
export function dpiAssumptionWarning(detail: string): ConvertWarning {
  return {
    code: 'dpi-assumed',
    message: `No resolution metadata was found; ${ASSUMED_DPI} DPI was assumed for page sizing.`,
    detail,
  };
}

/**
 * Phase 54 (DEF-382) — the documented page-size range. PDF 32000-1 Annex C.2
 * sets the PDF implementation limits at a 3-unit minimum and a 14,400-unit
 * maximum in each direction; a page derived from image metadata is clamped
 * into that range rather than emitting an unusable box (a 1-DPI claim once
 * produced a 1,417,322 pt page, a 100,000,000-DPI claim a 0.000066 pt page).
 */
export const MIN_PAGE_POINTS = 3;
export const MAX_PAGE_POINTS = 14400;

/** Clamp one derived page dimension into the documented point range. */
export function clampPagePoints(value: number): number {
  if (!Number.isFinite(value) || value < MIN_PAGE_POINTS) return MIN_PAGE_POINTS;
  if (value > MAX_PAGE_POINTS) return MAX_PAGE_POINTS;
  return value;
}

/** The warnable shape of a clamp: computed (pre-clamp) and applied values. */
export interface PageClamp {
  computedWidthPt: number;
  computedHeightPt: number;
  appliedWidthPt: number;
  appliedHeightPt: number;
}

function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  // A near-zero degenerate size (a 100,000,000-DPI claim) must not format as
  // "0"; keep its magnitude visible to the user.
  if (Math.abs(value) < 0.001) return value.toExponential(3);
  return String(Number(value.toFixed(3)));
}

/** Warn, naming the clamp with both the computed and the clamped values. */
export function pageClampWarning(clamp: PageClamp, detail: string): ConvertWarning {
  return {
    code: 'page-clamped',
    message:
      `The image's resolution metadata produces a ${formatPoints(clamp.computedWidthPt)} x ` +
      `${formatPoints(clamp.computedHeightPt)} pt page, outside the supported ` +
      `${MIN_PAGE_POINTS}-${MAX_PAGE_POINTS} pt range; the page was clamped to ` +
      `${formatPoints(clamp.appliedWidthPt)} x ${formatPoints(clamp.appliedHeightPt)} pt.`,
    detail,
  };
}
