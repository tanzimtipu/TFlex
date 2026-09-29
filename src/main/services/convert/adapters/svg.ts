import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { stampBrandMetadata } from '../../engine';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { composeSvgPrintHtml, injectSecurityMeta } from '../templates';
import { detectRemoteResources, mergeResourceUrls } from '../remote-resources';
import { computeImagePlacement } from './images';
import { pageClampWarning, type ImageMeta } from '../image-meta';
import { parseSvg, resolveSvgSize, type SvgNode, type SvgViewBox } from '../svg/svg-parse';
import {
  applyPaintOps,
  generatePaintOps,
  multiplyMatrix,
  rotationMatrix,
  translationMatrix,
  type Matrix,
} from '../svg/svg-paint';

/**
 * Phase 54 feature C — the `.svg` adapter.
 *
 * The static vector subset is translated into native PDF drawing operations
 * (fidelity `native`). Any construct outside that subset (filters, masks,
 * clip paths, foreignObject, embedded images, SMIL/animation, text, or a
 * second-level `use`) is handed to the Phase 53 offscreen print engine rather
 * than approximated, and the whole page reports fidelity `layout`. A gradient
 * is approximated as its dominant solid colour and still translates natively.
 *
 * Sizing reuses the Phase 54 image rules one-for-one: the SVG's intrinsic size
 * in points feeds `computeImagePlacement`, so `imagePageSizeMode`,
 * `imageFixedPageSize`, `imageFit` and `imageRotationDeg` behave identically to
 * a PNG.
 */

const SVG_EXTENSIONS = ['.svg'];

/** A 72-DPI `ImageMeta` whose pixels ARE points, to reuse the image sizing. */
function pointsMeta(widthPt: number, heightPt: number): ImageMeta {
  return {
    widthPx: widthPt,
    heightPx: heightPt,
    dpiX: 72,
    dpiY: 72,
    dpiSource: 'none',
  };
}

/**
 * The map from SVG user coordinates (y-down) to PDF page coordinates (y-up):
 * the viewBox scaled and centred inside the placed content rectangle (default
 * `preserveAspectRatio` = xMidYMid meet), then the configured rotation applied
 * about that rectangle's centre.
 */
export function computeSvgRootMatrix(
  viewBox: SvgViewBox | null,
  intrinsicWidthPt: number,
  intrinsicHeightPt: number,
  options: ResolvedConvertOptions,
): Matrix {
  const placement = computeImagePlacement(
    pointsMeta(intrinsicWidthPt, intrinsicHeightPt),
    options,
  );
  const rotated = placement.rotation === 90 || placement.rotation === 270;
  const contentW = placement.width;
  const contentH = placement.height;
  const footprintW = rotated ? contentH : contentW;
  const footprintH = rotated ? contentW : contentH;
  const ox = (placement.pageWidth - footprintW) / 2;
  const oy = (placement.pageHeight - footprintH) / 2;

  const vb = viewBox ?? {
    minX: 0,
    minY: 0,
    width: intrinsicWidthPt,
    height: intrinsicHeightPt,
  };
  const scale = Math.min(contentW / vb.width, contentH / vb.height);
  const scaledW = vb.width * scale;
  const scaledH = vb.height * scale;
  const left = ox + (contentW - scaledW) / 2;
  const top = oy + (contentH + scaledH) / 2;
  const base: Matrix = [
    scale,
    0,
    0,
    -scale,
    left - scale * vb.minX,
    top + scale * vb.minY,
  ];
  if (placement.rotation === 0) return base;
  const cx = ox + footprintW / 2;
  const cy = oy + footprintH / 2;
  const aboutCentre = multiplyMatrix(
    multiplyMatrix(translationMatrix(cx, cy), rotationMatrix(-placement.rotation)),
    translationMatrix(-cx, -cy),
  );
  return multiplyMatrix(aboutCentre, base);
}

/** Strip an XML prologue so the fallback HTML wrapper is not confused by it. */
function stripXmlPrologue(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[^>]*\?>/i, '')
    .replace(/^\s*<!doctype[^>]*>/i, '')
    .trimStart();
}

function engineRenderedWarning(constructs: string[]): ConvertWarning {
  const names = constructs.join(', ');
  return {
    code: 'engine-rendered',
    message: `The SVG uses ${names}, which are not translated natively; the page was rendered with the offscreen engine.`,
    detail: names,
  };
}

/** Shape elements that paint geometry in the native subset (DEF-384). */
const SHAPE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
]);

function hasShapeElement(node: SvgNode | null): boolean {
  if (node === null) return false;
  if (SHAPE_TAGS.has(node.tag)) return true;
  return node.children.some((child) => hasShapeElement(child));
}

/** DEF-384 — malformed/truncated markup that was parsed partially. */
function parseDiagnosticsWarning(diagnostics: string[], detail: string): ConvertWarning {
  return {
    code: 'partial-content',
    message:
      `The SVG markup is malformed or truncated; ${diagnostics.length} construct(s) could not be parsed: ` +
      `${diagnostics.slice(0, 5).join(' ')}`,
    detail,
  };
}

/** DEF-384 — shapes whose numeric geometry was dropped. */
function droppedGeometryWarning(count: number, detail: string): ConvertWarning {
  return {
    code: 'partial-content',
    message: `The SVG has ${count} shape(s) whose numeric geometry is invalid (non-finite or non-positive) and was dropped.`,
    detail,
  };
}

/** DEF-384 — every shape was dropped, so the page is rendered by the engine. */
function geometryFallbackWarning(count: number, detail: string): ConvertWarning {
  return {
    code: 'engine-rendered',
    message: `The SVG has ${count} shape(s), but none of their numeric geometry could be translated; the page was rendered with the offscreen engine instead of a blank page.`,
    detail,
  };
}

export function createSvgAdapter(print: HtmlPrintFn = printHtmlToPdf): ConversionAdapter {
  return {
    id: 'svg',
    label: 'SVG image',
    extensions: [...SVG_EXTENSIONS],
    capabilities: { canImport: true, canExport: false },
    // The adapter declares the weaker of its two paths; a per-result `native`
    // is returned when nothing had to fall back.
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.svgBytes,
    supportsMultiFile: true,

    sniff(path: string, head: Buffer): boolean {
      const text = head.toString('utf8').toLowerCase();
      if (text.includes('<svg')) return true;
      // A `.svg` extension alone is not enough: a raster mislabelled `.svg`
      // must fall through to its magic-byte adapter. An XML-prologued file is
      // accepted, a PNG/JPEG/ZIP is not.
      if (extname(path).toLowerCase() === '.svg') {
        return text.replace(/^\uFEFF/, '').trimStart().startsWith('<?xml');
      }
      return false;
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > CONVERT_LIMITS.svgBytes) throw new ConvertFailure('too-large');
      const bytes = await readFile(path);
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.('decoding', 0.2);

      const source = bytes.toString('utf8');
      const parsed = parseSvg(source);
      const size = resolveSvgSize(parsed);
      if (parsed.root === null || size === null) {
        throw new ConvertFailure(
          'decode-failed',
          'The SVG declares neither a width/height nor a viewBox, so its page size is unknown.',
        );
      }
      const paint = generatePaintOps(parsed);
      const fileLabel = basename(path, extname(path));
      // DEF-387 — source-level remote-resource detection, the same module and
      // local/data: exclusion rule the HTML adapter uses. The offscreen session
      // hook cannot be relied on (CSP can block a request before it fires).
      const detectedRemote = detectRemoteResources(source);
      // DEF-384 — a file that clearly had shapes but translated NONE of them
      // must not become a silent blank `native` page; take the engine fallback.
      const allGeometryDropped =
        paint.ops.length === 0 &&
        paint.droppedGeometry > 0 &&
        hasShapeElement(parsed.root);

      if (paint.untranslated.length > 0 || allGeometryDropped) {
        onProgress?.('laying-out', 0.5);
        // Phase 54 item 0 — in `image` mode (the default) the fallback page is
        // the SVG's own intrinsic page size, not the Settings A4/Letter paper.
        // Chromium's `printToPDF` pageSize option only names A4/Letter, so the
        // size travels as a `@page { size: <w>pt <h>pt; margin: 0 }` rule with
        // `preferCSSPageSize: true`, exactly as print.ts:291 does. In `fixed`
        // mode the setting wins: the Settings paper size stays.
        const fixedMode = options.imagePageSizeMode === 'fixed';
        const html = fixedMode
          ? injectSecurityMeta(stripXmlPrologue(source))
          : injectSecurityMeta(
              composeSvgPrintHtml(
                stripXmlPrologue(source),
                size.widthPt,
                size.heightPt,
              ),
            );
        const printed = await print(html, {
          pageSize: fixedMode
            ? options.imageFixedPageSize
            : options.pageSize,
          marginMm: fixedMode ? options.marginMm : 0,
          printBackground: options.htmlPrintBackgrounds,
          preferCSSPageSize: !fixedMode,
        });
        if (!printed.ok) {
          throw new ConvertFailure(printed.error.code, printed.error.message);
        }
        const warnings: ConvertWarning[] = [
          allGeometryDropped
            ? geometryFallbackWarning(paint.droppedGeometry, fileLabel)
            : engineRenderedWarning(paint.untranslated),
        ];
        if (allGeometryDropped) {
          warnings.push(droppedGeometryWarning(paint.droppedGeometry, fileLabel));
        }
        if (paint.diagnostics.length > 0) {
          warnings.push(parseDiagnosticsWarning(paint.diagnostics, fileLabel));
        }
        warnings.push(
          ...blockedResourceWarnings(
            mergeResourceUrls(printed.value.blockedUrls, detectedRemote),
          ),
        );
        onProgress?.('done', 1);
        return {
          bytes: printed.value.bytes,
          pageCount: printed.value.pageCount,
          sourceFormat: 'svg',
          fidelity: 'layout',
          warnings,
          title: fileLabel,
        };
      }

      onProgress?.('laying-out', 0.6);
      const doc = await PDFDocument.create();
      const placement = computeImagePlacement(
        pointsMeta(size.widthPt, size.heightPt),
        options,
      );
      const page: PDFPage = doc.addPage([placement.pageWidth, placement.pageHeight]);
      const rootMatrix = computeSvgRootMatrix(
        parsed.viewBox,
        size.widthPt,
        size.heightPt,
        options,
      );
      applyPaintOps(page, paint.ops, rootMatrix);
      stampBrandMetadata(doc);
      const warnings: ConvertWarning[] = [];
      if (placement.clamp !== undefined) {
        warnings.push(pageClampWarning(placement.clamp, fileLabel));
      }
      if (paint.diagnostics.length > 0) {
        warnings.push(parseDiagnosticsWarning(paint.diagnostics, fileLabel));
      }
      if (paint.droppedGeometry > 0) {
        warnings.push(droppedGeometryWarning(paint.droppedGeometry, fileLabel));
      }
      warnings.push(...blockedResourceWarnings(detectedRemote));
      if (paint.gradientCount > 0) {
        warnings.push({
          code: 'gradient-approx',
          message: `The SVG uses ${paint.gradientCount} gradient(s); each was approximated with its dominant solid colour.`,
          detail: fileLabel,
        });
      }
      const out = await doc.save();
      onProgress?.('done', 1);
      return {
        bytes: out,
        pageCount: 1,
        sourceFormat: 'svg',
        fidelity: 'native',
        warnings,
        title: fileLabel,
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const svgAdapter: ConversionAdapter = createSvgAdapter();
