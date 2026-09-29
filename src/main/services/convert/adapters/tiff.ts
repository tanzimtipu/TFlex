import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import UTIF from 'utif';
import type {
  ConvertFidelity,
  ConvertResult,
  ConvertWarning,
} from '../../../../shared/convert';
import { stampBrandMetadata } from '../../engine';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  dpiAssumptionWarning,
  pageClampWarning,
  readTiffIfdMeta,
  resolveDpi,
  type ImageMeta,
} from '../image-meta';
import { computeImagePlacement } from './images';

/**
 * Phase 54 feature B — the multi-page TIFF adapter.
 *
 * `utif` requires the whole file in memory, so the byte ceiling is enforced
 * rather than pretending to stream. Frames are decoded one at a time
 * (`UTIF.decodeImage` / `UTIF.toRGBA8`) and each is embedded as a PNG encoded
 * in-process with node:zlib (pdf-lib cannot embed raw RGBA and no new runtime
 * dependency is introduced). A frame that cannot be decoded becomes a labelled
 * placeholder page; the other frames still convert.
 */

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBytes, data), 0);
  return Buffer.concat([length, typeBytes, Buffer.from(data), crc]);
}

/** Encode raw RGBA8 pixels as a PNG (colour type 6, no filter per row). */
export function encodeRgbaPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const src = y * stride;
    const dst = y * (stride + 1);
    raw[dst] = 0;
    raw.set(rgba.subarray(src, src + stride), dst + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

export interface TiffAdapterDeps {
  /** Advisory frame ceiling; defaults to `CONVERT_LIMITS.tiffFrames`. */
  framesLimit?: number;
}

/**
 * DEF-380 — validate the TIFF IFD chain BEFORE handing the bytes to `utif`.
 *
 * `UTIF.decode` walks the next-IFD chain with `while(true)` and pushes each IFD,
 * so a next-IFD pointer that points back at an earlier IFD loops until V8 runs
 * out of memory (a 14-byte cyclic file OOM-killed the main process). A try/catch
 * cannot fire on an infinite loop, so the chain is pre-validated here: a
 * visited-offset set catches a cycle, a hard frame-count ceiling caps the walk,
 * and every offset must lie inside the file. Returns a human reason, or null
 * when the chain is safe for `UTIF.decode`.
 */
export function preflightTiffIfdChain(bytes: Uint8Array, maxIfds: number): string | null {
  if (bytes.length < 8) return 'The TIFF header is truncated.';
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return 'The TIFF byte-order marker is not recognised.';
  const u16 = (at: number): number =>
    little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  const u32 = (at: number): number =>
    little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  if (u16(2) !== 42) return 'The TIFF magic number (42) is missing.';

  let offset = u32(4);
  const visited = new Set<number>();
  let frames = 0;
  while (offset !== 0) {
    if (!Number.isInteger(offset) || offset + 2 > bytes.length) {
      return `An IFD offset (${offset}) lies outside the file.`;
    }
    if (visited.has(offset)) {
      return `The TIFF IFD chain is cyclic: offset ${offset} is visited more than once.`;
    }
    visited.add(offset);
    frames += 1;
    if (frames > maxIfds) {
      return `The TIFF declares more than ${maxIfds} image directories.`;
    }
    const entryCount = u16(offset);
    const nextAt = offset + 2 + entryCount * 12;
    if (nextAt + 4 > bytes.length) {
      return `The IFD at offset ${offset} is truncated (its entries or next-pointer run past the file).`;
    }
    offset = u32(nextAt);
  }
  return null;
}

export function createTiffAdapter(deps: TiffAdapterDeps = {}): ConversionAdapter {
  const framesLimit = deps.framesLimit ?? CONVERT_LIMITS.tiffFrames;
  return {
    id: 'tiff',
    label: 'TIFF image',
    extensions: ['.tiff', '.tif'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'native',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.tiffBytes,
    supportsMultiFile: true,

    sniff(_path: string, head: Buffer): boolean {
      // TIFF: little-endian ("II*\0") or big-endian ("MM\0*") header.
      if (head.length < 4) return false;
      const le = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a;
      const be = head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a;
      return le || be;
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > CONVERT_LIMITS.tiffBytes) {
        throw new ConvertFailure('too-large');
      }
      // utif needs the whole file in memory; the ceiling above bounds that.
      const bytes = await readFile(path);
      if (signal?.aborted) throw new ConvertCancelledError();

      // DEF-380 — never call UTIF.decode on an unsafe IFD chain.
      const chainProblem = preflightTiffIfdChain(bytes, CONVERT_LIMITS.tiffIfdChain);
      if (chainProblem !== null) {
        throw new ConvertFailure('corrupt', `The TIFF could not be parsed. ${chainProblem}`);
      }

      let ifds: Array<Record<string, unknown>>;
      try {
        ifds = UTIF.decode(bytes) as unknown as Array<Record<string, unknown>>;
      } catch {
        throw new ConvertFailure('corrupt', 'The TIFF could not be parsed.');
      }
      if (ifds.length === 0) {
        throw new ConvertFailure('corrupt', 'The TIFF has no image directory.');
      }
      let frames = ifds;
      const first = ifds[0] as { subIFD?: unknown };
      if (
        ifds.length === 1 &&
        Array.isArray(first.subIFD) &&
        first.subIFD.length > 0
      ) {
        frames = first.subIFD as Array<Record<string, unknown>>;
      }
      const frameCount = frames.length;
      if (frameCount === 0) {
        throw new ConvertFailure('corrupt', 'The TIFF has no decodable frame.');
      }

      const warnings: ConvertWarning[] = [];
      if (frameCount > framesLimit) {
        warnings.push({
          code: 'frame-limit',
          message: `The TIFF has ${frameCount} frames, above the advisory ceiling of ${framesLimit}; all frames were converted.`,
          detail: basename(path),
        });
      }

      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      let fidelity: ConvertFidelity = 'native';

      for (let index = 0; index < frameCount; index += 1) {
        if (signal?.aborted) throw new ConvertCancelledError();
        onProgress?.('decoding', (index + 1) / frameCount);
        const frame = frames[index];
        try {
          // DEF-385 — reject by the frame's DECLARED size before utif allocates
          // width*height*4 bytes in toRGBA8 (a 62-byte file once bought ~27 s of
          // blocked main process and a 1.6 GB transient allocation).
          const declared = readTiffIfdMeta(frame);
          if (declared.widthPx * declared.heightPx > CONVERT_LIMITS.tiffFramePixels) {
            throw new Error(
              `the frame declares ${declared.widthPx}x${declared.heightPx} pixels, above the ${CONVERT_LIMITS.tiffFramePixels}-pixel frame ceiling`,
            );
          }
          UTIF.decodeImage(bytes, frame as never, ifds as never);
          const width = (frame.width as number | undefined) ?? 0;
          const height = (frame.height as number | undefined) ?? 0;
          const rgba = UTIF.toRGBA8(frame as never);
          if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
            throw new Error('frame produced no pixels');
          }
          const png = encodeRgbaPng(rgba, width, height);
          const embedded = await doc.embedPng(png);
          const meta: ImageMeta = readTiffIfdMeta(frame);
          if (meta.widthPx === 0) meta.widthPx = width;
          if (meta.heightPx === 0) meta.heightPx = height;
          const placement = computeImagePlacement(meta, options);
          if (placement.clamp !== undefined) {
            warnings.push(
              pageClampWarning(placement.clamp, `${basename(path)} frame ${index + 1}`),
            );
          }
          const page = doc.addPage([placement.pageWidth, placement.pageHeight]);
          page.drawImage(embedded, {
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            rotate: degrees(placement.rotation),
          });
          if (resolveDpi(meta).assumed) {
            warnings.push(
              dpiAssumptionWarning(`${basename(path)} frame ${index + 1}`),
            );
          }
        } catch (frameError) {
          fidelity = 'degraded';
          const detail =
            frameError instanceof Error ? frameError.message : 'unknown error';
          const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
          page.drawText(`Frame ${index + 1} could not be decoded`, {
            x: 48,
            y: A4_HEIGHT - 96,
            size: 18,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          page.drawText(
            'This page is a placeholder. The frame data is unreadable or uses an unsupported encoding.',
            { x: 48, y: A4_HEIGHT - 128, size: 11, font, color: rgb(0.3, 0.3, 0.3) },
          );
          warnings.push({
            code: 'frame-decode-failed',
            message: `Frame ${index + 1} of the TIFF could not be decoded; a placeholder page was inserted.`,
            detail,
          });
        }
      }

      stampBrandMetadata(doc);
      const out = await doc.save();
      onProgress?.('done', 1);
      return {
        bytes: out,
        pageCount: frameCount,
        sourceFormat: 'tiff',
        fidelity,
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const tiffAdapter = createTiffAdapter();
