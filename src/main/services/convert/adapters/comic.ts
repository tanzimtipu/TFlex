import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { injectSecurityMeta } from '../templates';
import { ConvertZipError, openZip, type ZipLimits } from '../convert-zip';
import { readJpegMeta, readPngMeta } from '../image-meta';
import { wrapOfficeDocument } from './docx';
import {
  DEFAULT_TAR_LIMITS,
  readTar,
  TarReadError,
  type TarLimits,
} from '../tar-read';

/** Re-exported for tests, mirroring the EPUB/DOCX adapters. */
export type { HtmlPrintFn };

/**
 * Phase 56 feature C — the `.cbz` (ZIP) and `.cbt` (TAR) comic adapters.
 *
 * Both containers hold one image per page. The shared composer sorts the image
 * entries in NATURAL order (`p2` before `p10`), inlines each image as a `data:`
 * URI, and prints ONE HTML document with one image per page through the same
 * isolated offscreen engine as `.epub`/`.docx`. A `.cbz` wraps `openZip`; a
 * `.cbt` wraps the pure `readTar` reader. Fidelity is `layout`: images are
 * placed into page boxes by the print engine, not embedded as native PDF pages.
 */

/** Extensions a comic page may use, in the same shape as the ODT image map. */
export const COMIC_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** The extension list the CBZ sniff looks for inside the ZIP head. */
export const COMIC_IMAGE_EXTENSIONS = Object.keys(COMIC_IMAGE_MIME).map(
  (extension) => `.${extension}`,
);

export interface ComicPage {
  name: string;
  dataUri: string;
}

/**
 * A `.cbz` is a ZIP of images. Content decides when the archive is opened by
 * the content pass (a PK head whose local file headers name image extensions);
 * the `.cbz` extension is accepted outright so a misnamed-but-broken archive
 * still reaches this adapter and reports its typed container error. The archive
 * sniffs registered before this one (EPUB/ODF/OOXML) still claim their own
 * containers in the content pass.
 */
export function looksLikeCbz(path: string, head: Buffer): boolean {
  if (path.toLowerCase().endsWith('.cbz')) return true;
  const text = head.toString('latin1');
  if (!text.startsWith('PK\x03\x04')) return false;
  return COMIC_IMAGE_EXTENSIONS.some((extension) => text.includes(extension));
}

/** A `.cbt` is a 512-byte-record TAR carrying the `ustar` magic at offset 257;
 *  the `.cbt` extension is accepted outright so a broken archive still reports
 *  a typed container error. */
export function looksLikeCbt(path: string, head: Buffer): boolean {
  if (path.toLowerCase().endsWith('.cbt')) return true;
  if (head.length < 263) return false;
  const magic = head.toString('latin1', 257, 263);
  return magic.startsWith('ustar');
}

/**
 * Natural order: `p2` precedes `p10` (criterion 4). A single `Intl.Collator`
 * with numeric collation is the one ordering rule both adapters share.
 */
export function naturalCompare(a: string, b: string): number {
  return new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  }).compare(a, b);
}

/** Sort entries by natural name order without mutating the input. */
export function sortComicEntries<T extends { name: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => naturalCompare(a.name, b.name));
}

/** True when the entry's extension is one of the six comic image types. */
export function isComicImageName(name: string): boolean {
  const extension = extname(name).slice(1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMIC_IMAGE_MIME, extension);
}

/** True when `bytes` start with the given ASCII marker. */
function startsWithAscii(bytes: Uint8Array, marker: string): boolean {
  if (bytes.length < marker.length) return false;
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[i] !== marker.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Validate that `bytes` really are the image their extension claims. PNG/JPEG
 * go through the Phase 54 dimension readers (a structurally broken file has no
 * readable dimensions); GIF/WEBP/BMP are checked by their magic bytes. An entry
 * that fails is SKIPPED with a `frame-decode-failed` warning, never fatal.
 */
export function isValidComicImage(name: string, bytes: Uint8Array): boolean {
  const extension = extname(name).slice(1).toLowerCase();
  switch (extension) {
    case 'png':
      return readPngMeta(bytes) !== null;
    case 'jpg':
    case 'jpeg':
      return readJpegMeta(bytes) !== null;
    case 'gif':
      return startsWithAscii(bytes, 'GIF8');
    case 'webp':
      return startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes.subarray(8), 'WEBP');
    case 'bmp':
      return startsWithAscii(bytes, 'BM');
    default:
      return false;
  }
}

/** Base64-embed one valid image as a `data:` URI (the CSP allows `data:` only). */
export function comicImageDataUri(name: string, bytes: Uint8Array): string {
  const extension = extname(name).slice(1).toLowerCase();
  const mime = COMIC_IMAGE_MIME[extension] ?? 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** One image per page: every page after the first starts a new printed page. */
export const COMIC_PRINT_CSS = `
.comic-page { text-align: center; }
.comic-page + .comic-page { page-break-before: always; break-before: page; }
.comic-page img { max-width: 100%; max-height: 100vh; }
`;

/** Compose the print body: one `.comic-page` div per image, in page order. */
export function composeComicBody(pages: readonly ComicPage[]): string {
  const parts = pages.map(
    (page) => `<div class="comic-page"><img src="${page.dataUri}" alt=""></div>`,
  );
  return `<style>${COMIC_PRINT_CSS}</style>\n${parts.join('\n')}`;
}

/** Warn about every non-image entry that was left out (criterion: skipped
 *  without failing the conversion). */
function skippedEntriesWarning(skipped: readonly string[]): ConvertWarning {
  const shown = skipped.slice(0, 5).join(', ');
  const suffix = skipped.length > 5 ? ', ...' : '';
  return {
    code: 'partial-content',
    message: `Skipped ${skipped.length} non-image ${
      skipped.length === 1 ? 'entry' : 'entries'
    } in the comic archive: ${shown}${suffix}.`,
    detail: skipped.join(', '),
  };
}

export interface ComicComposeInput {
  entries: readonly { name: string; bytes: Uint8Array }[];
  options: ResolvedConvertOptions;
  sourceFormat: 'cbz' | 'cbt';
  title: string;
}

/**
 * The one composer both comic adapters share: natural-order the entries, keep
 * the images (skipping and warning about everything else), inline them as
 * `data:` URIs, print once and return the `ConvertResult`. A corrupt image is
 * skipped with `frame-decode-failed`; the remaining pages still convert.
 */
export async function composeComicPdf(
  input: ComicComposeInput,
  print: HtmlPrintFn,
): Promise<ConvertResult> {
  const pages: ComicPage[] = [];
  const warnings: ConvertWarning[] = [];
  const skipped: string[] = [];

  for (const entry of sortComicEntries(input.entries)) {
    if (!isComicImageName(entry.name)) {
      skipped.push(entry.name);
      continue;
    }
    if (entry.bytes.length === 0 || !isValidComicImage(entry.name, entry.bytes)) {
      warnings.push({
        code: 'frame-decode-failed',
        message: `The comic image "${entry.name}" could not be read and was skipped.`,
        detail: entry.name,
      });
      continue;
    }
    pages.push({ name: entry.name, dataUri: comicImageDataUri(entry.name, entry.bytes) });
  }

  if (skipped.length > 0) warnings.push(skippedEntriesWarning(skipped));
  if (pages.length === 0) {
    throw new ConvertFailure(
      'corrupt',
      'The comic archive contains no readable image entries.',
    );
  }

  const html = injectSecurityMeta(wrapOfficeDocument(composeComicBody(pages)));
  const printed = await print(html, {
    pageSize: input.options.pageSize,
    marginMm: input.options.marginMm,
    printBackground: input.options.htmlPrintBackgrounds,
  });
  if (!printed.ok) {
    throw new ConvertFailure(printed.error.code, printed.error.message);
  }

  warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));
  return {
    bytes: printed.value.bytes,
    pageCount: printed.value.pageCount,
    sourceFormat: input.sourceFormat,
    fidelity: 'layout',
    warnings,
    title: input.title,
  };
}

/**
 * Build the `.cbz` adapter. `print` and the ZIP ceilings are injectable so the
 * engine unit-tests with no Electron and no huge fixture.
 */
export function createCbzAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.cbzBytes,
  zipLimits?: ZipLimits,
): ConversionAdapter {
  return {
    id: 'cbz',
    label: 'Comic book archive (ZIP)',
    extensions: ['.cbz'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(path, head) {
      return looksLikeCbz(path, head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      let archive: ReturnType<typeof openZip>;
      try {
        archive = openZip(new Uint8Array(bytes), zipLimits);
      } catch (thrown) {
        if (thrown instanceof ConvertZipError) {
          throw new ConvertFailure(thrown.code, thrown.message);
        }
        throw thrown;
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.4);
      const entries = archive.names().map((name) => ({
        name,
        bytes: archive.readBytes(name) ?? new Uint8Array(0),
      }));
      return composeComicPdf(
        {
          entries,
          options,
          sourceFormat: 'cbz',
          title: basename(path, extname(path)),
        },
        print,
      );
    },
  };
}

/**
 * Build the `.cbt` adapter. `print` and the TAR ceilings are injectable the
 * same way as the CBZ adapter.
 */
export function createCbtAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.cbtBytes,
  tarLimits?: TarLimits,
): ConversionAdapter {
  return {
    id: 'cbt',
    label: 'Comic book archive (TAR)',
    extensions: ['.cbt'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(path, head) {
      return looksLikeCbt(path, head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      let entries: ReturnType<typeof readTar>;
      try {
        entries = readTar(new Uint8Array(bytes), tarLimits ?? DEFAULT_TAR_LIMITS);
      } catch (thrown) {
        if (thrown instanceof TarReadError) {
          throw new ConvertFailure(thrown.code, thrown.message);
        }
        throw thrown;
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.4);
      return composeComicPdf(
        {
          entries,
          options,
          sourceFormat: 'cbt',
          title: basename(path, extname(path)),
        },
        print,
      );
    },
  };
}

/** The shipped adapters; the registry loads these. */
export const cbzAdapter: ConversionAdapter = createCbzAdapter();
export const cbtAdapter: ConversionAdapter = createCbtAdapter();
