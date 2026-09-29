import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { degrees, PDFDocument } from '@cantoo/pdf-lib';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { stampBrandMetadata } from '../../engine';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  clampPagePoints,
  dpiAssumptionWarning,
  hasJpegSignature,
  hasPngSignature,
  pageClampWarning,
  readJpegMeta,
  readPngMeta,
  resolveDpi,
  type ImageMeta,
  type PageClamp,
} from '../image-meta';

/**
 * Phase 54 feature A — the PNG and JPEG adapters.
 *
 * Both share one sizing/placement implementation (`computeImagePlacement`); an
 * embedded raster is a faithful reproduction, so the declared fidelity is
 * `'native'`. Magic bytes decide the format, never the extension alone.
 */

/** A4 page in PDF points (mirrors the value pdf-lib uses elsewhere). */
const A4: readonly [number, number] = [595.28, 841.89];
/** US Letter page in PDF points. */
const LETTER: readonly [number, number] = [612, 792];

interface ImagePlacement {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Set when the computed physical size was outside the documented page
   *  range and had to be clamped (DEF-382); the caller warns with it. */
  clamp?: PageClamp;
}

/**
 * Phase 54 sizing rule (criterion 1): an `'image'` page is the image's
 * PHYSICAL size, `points = pixels / dpi * 72`, per axis. A `'fixed'` page uses
 * the configured size and places the image per `fit`. Rotation is applied to
 * the placed image; for image-sized pages a 90/270 rotation also swaps the page
 * dimensions so the result is never letterboxed.
 *
 * DEF-382: the physical size is clamped into the documented 3-14,400 pt range
 * (PDF 32000-1 Annex C.2) BEFORE any page box is derived, so a hostile DPI
 * claim can never produce an absurd page. Normal inputs are untouched; a clamp
 * is reported through `clamp` for the caller to warn about.
 */
export function computeImagePlacement(
  meta: ImageMeta,
  options: ResolvedConvertOptions,
): ImagePlacement {
  const dpi = resolveDpi(meta);
  const computedW = (meta.widthPx / dpi.dpiX) * 72;
  const computedH = (meta.heightPx / dpi.dpiY) * 72;
  const physicalW = clampPagePoints(computedW);
  const physicalH = clampPagePoints(computedH);
  const clamp: PageClamp | undefined =
    physicalW !== computedW || physicalH !== computedH
      ? {
          computedWidthPt: computedW,
          computedHeightPt: computedH,
          appliedWidthPt: physicalW,
          appliedHeightPt: physicalH,
        }
      : undefined;
  const rotation = options.imageRotationDeg;
  const rotated = rotation === 90 || rotation === 270;

  let pageWidth: number;
  let pageHeight: number;
  let drawWidth: number;
  let drawHeight: number;

  if (options.imagePageSizeMode === 'image') {
    pageWidth = rotated ? physicalH : physicalW;
    pageHeight = rotated ? physicalW : physicalH;
    drawWidth = physicalW;
    drawHeight = physicalH;
  } else {
    const [fixedW, fixedH] =
      options.imageFixedPageSize === 'letter' ? LETTER : A4;
    pageWidth = fixedW;
    pageHeight = fixedH;
    const footW = rotated ? physicalH : physicalW;
    const footH = rotated ? physicalW : physicalH;
    let scale = 1;
    if (options.imageFit === 'contain') {
      scale = Math.min(fixedW / footW, fixedH / footH);
    } else if (options.imageFit === 'cover') {
      scale = Math.max(fixedW / footW, fixedH / footH);
    }
    // 'actual' leaves scale at 1 (native size at its DPI); overflow is clipped
    // by the page media box, exactly as a fixed-size frame would be.
    drawWidth = physicalW * scale;
    drawHeight = physicalH * scale;
  }

  const footprintW = rotated ? drawHeight : drawWidth;
  const footprintH = rotated ? drawWidth : drawHeight;
  const baseX = (pageWidth - footprintW) / 2;
  const baseY = (pageHeight - footprintH) / 2;

  let x = baseX;
  let y = baseY;
  if (rotation === 90) x = baseX + drawHeight;
  else if (rotation === 180) {
    x = baseX + drawWidth;
    y = baseY + drawHeight;
  } else if (rotation === 270) y = baseY + drawWidth;

  return { pageWidth, pageHeight, x, y, width: drawWidth, height: drawHeight, rotation, clamp };
}

async function convertImageFile(
  ctx: ConvertAdapterContext,
  kind: 'png' | 'jpeg',
): Promise<ConvertResult> {
  const { path, options, signal, onProgress } = ctx;
  const info = await stat(path);
  if (info.size > CONVERT_LIMITS.imageBytes) {
    throw new ConvertFailure('too-large');
  }
  const bytes = await readFile(path);
  if (signal?.aborted) throw new ConvertCancelledError();

  const meta = kind === 'png' ? readPngMeta(bytes) : readJpegMeta(bytes);
  if (meta === null) {
    throw new ConvertFailure('corrupt', 'The image header could not be read.');
  }
  onProgress?.('decoding', 0.2);

  const doc = await PDFDocument.create();
  const image =
    kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const placement = computeImagePlacement(meta, options);
  const page = doc.addPage([placement.pageWidth, placement.pageHeight]);
  page.drawImage(image, {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotate: degrees(placement.rotation),
  });
  onProgress?.('laying-out', 0.7);

  // Phase 49 — every produced PDF carries the Jovrel Producer/Creator.
  stampBrandMetadata(doc);
  const out = await doc.save();

  const warnings: ConvertWarning[] = [];
  if (placement.clamp !== undefined) {
    warnings.push(pageClampWarning(placement.clamp, basename(path)));
  }
  if (resolveDpi(meta).assumed) {
    warnings.push(dpiAssumptionWarning(basename(path)));
  }
  onProgress?.('done', 1);
  return {
    bytes: out,
    pageCount: 1,
    sourceFormat: kind,
    fidelity: 'native',
    warnings,
    title: basename(path, extname(path)),
  };
}

export const pngAdapter: ConversionAdapter = {
  id: 'png',
  label: 'PNG image',
  extensions: ['.png'],
  capabilities: { canImport: true, canExport: false },
  fidelity: 'native',
  specificity: 'specific',
  maxBytes: CONVERT_LIMITS.imageBytes,
  supportsMultiFile: true,
  sniff(_path: string, head: Buffer): boolean {
    return hasPngSignature(head);
  },
  convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
    return convertImageFile(ctx, 'png');
  },
};

export const jpegAdapter: ConversionAdapter = {
  id: 'jpeg',
  label: 'JPEG image',
  extensions: ['.jpg', '.jpeg'],
  capabilities: { canImport: true, canExport: false },
  fidelity: 'native',
  specificity: 'specific',
  maxBytes: CONVERT_LIMITS.imageBytes,
  supportsMultiFile: true,
  sniff(_path: string, head: Buffer): boolean {
    return hasJpegSignature(head);
  },
  convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
    return convertImageFile(ctx, 'jpeg');
  },
};
