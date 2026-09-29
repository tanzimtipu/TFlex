import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS, assertInlinedImageBudget } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { injectSecurityMeta } from '../templates';
import { htmlHasVisibleContent } from '../visible-content';
import { sanitizeEpubFragment } from '../epub-parse';
import {
  COMIC_IMAGE_MIME,
  comicImageDataUri,
  isValidComicImage,
} from './comic';
import { wrapOfficeDocument } from './docx';
import { parseMobi, type MobiDocument } from '../mobi-parse';

/** Re-exported for tests, mirroring the EPUB/comic adapters. */
export type { HtmlPrintFn };

/**
 * Phase 56 feature B — the legacy Mobipocket (`.mobi`/`.azw`) and KF8
 * (`.azw3`) adapter.
 *
 * `mobi-parse.ts` reads the PalmDB, refuses a DRM-protected file before any
 * decompression, decompresses the PalmDOC/LZ77 text records and resolves the
 * `recindex` images. The adapter inlines the images as `data:` URIs (the CSP
 * allows `data:` only), sanitizes the recovered markup through the shared EPUB
 * whitelist scrubber and prints ONE HTML document through the same isolated
 * offscreen engine as `.epub`/`.docx`. Fidelity is ALWAYS `degraded`: this is a
 * reflow of extracted text, never a positioned layout.
 */

const MOBI_EXTENSIONS = ['.mobi', '.azw', '.azw3'];

/** True when the head is a PalmDB whose type/creator are `BOOK`/`MOBI`. */
function isPalmDbMobiHeader(head: Buffer): boolean {
  if (head.length < 68) return false;
  return (
    head.toString('latin1', 60, 64) === 'BOOK' &&
    head.toString('latin1', 64, 68) === 'MOBI'
  );
}

/** A Mobipocket head is the PalmDB `BOOK`/`MOBI` marker; the three extensions
 *  are accepted outright so a misnamed-but-broken file still reaches this
 *  adapter and reports its typed container error. */
export function looksLikeMobi(path: string, head: Buffer): boolean {
  if (MOBI_EXTENSIONS.includes(extname(path).toLowerCase())) return true;
  return isPalmDbMobiHeader(head);
}

function startsWithAscii(bytes: Uint8Array, marker: string): boolean {
  if (bytes.length < marker.length) return false;
  for (let i = 0; i < marker.length; i += 1) {
    if (bytes[i] !== marker.charCodeAt(i)) return false;
  }
  return true;
}

/** Map an image record's magic bytes to its extension (chunk 2a's types). */
function detectImageExtension(bytes: Uint8Array): string | null {
  if (startsWithAscii(bytes, '\x89PNG\r\n\x1a\n')) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (startsWithAscii(bytes, 'GIF8')) return 'gif';
  if (startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes.subarray(8), 'WEBP')) {
    return 'webp';
  }
  if (startsWithAscii(bytes, 'BM')) return 'bmp';
  return null;
}

/** Validate a raw image record with the comic adapter's magic-byte check and
 *  build its `data:` URI, or null when it is not a supported image. */
function mobiImageDataUri(bytes: Uint8Array): string | null {
  const extension = detectImageExtension(bytes);
  if (extension === null) return null;
  const name = `image.${extension}`;
  if (!isValidComicImage(name, bytes)) return null;
  return comicImageDataUri(name, bytes);
}

const RECINDEX_IMG_RE =
  /<img\b[^>]*?\brecindex\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>/gi;

const MARKUP_RE =
  /<(?:p|div|h[1-6]|br|img|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|section|em|strong|b|i|span|figure|figcaption|sup|sub)\b/i;

/** The encoded `data:` URI length a record would produce, computed
 *  arithmetically so the budget can be checked without building the string. */
function mobiImageDataUriLength(bytes: Uint8Array, extension: string): number {
  const mime = COMIC_IMAGE_MIME[extension] ?? 'application/octet-stream';
  return `data:${mime};base64,`.length + Math.ceil(bytes.length / 3) * 4;
}

/** How many times the markup references each recindex, before any URI is built. */
function countMobiImageRefs(markup: string): Map<number, number> {
  const counts = new Map<number, number>();
  RECINDEX_IMG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECINDEX_IMG_RE.exec(markup)) !== null) {
    const recindex = Number(match[1] ?? match[2] ?? match[3]);
    if (!Number.isFinite(recindex)) continue;
    counts.set(recindex, (counts.get(recindex) ?? 0) + 1);
  }
  return counts;
}

/** The budget rows for the images the markup will actually inline: an image the
 *  map lacks, or one that is not a supported image, is dropped with a warning
 *  and contributes nothing to the projected total. */
function mobiInlineEntries(
  markup: string,
  document: MobiDocument,
): { encodedLength: number; refCount: number }[] {
  const entries: { encodedLength: number; refCount: number }[] = [];
  for (const [recindex, refCount] of countMobiImageRefs(markup)) {
    const raw = document.images.get(recindex);
    if (raw === undefined) continue;
    const extension = detectImageExtension(raw);
    if (extension === null) continue;
    if (!isValidComicImage(`image.${extension}`, raw)) continue;
    entries.push({ encodedLength: mobiImageDataUriLength(raw, extension), refCount });
  }
  return entries;
}

/** Replace every `<img recindex="N">` with its inlined `data:` URI; a missing
 *  or unreadable record is dropped with a `frame-decode-failed` warning. The
 *  projected inlined total (references x image bytes) is preflighted FIRST, so
 *  a small image referenced thousands of times is refused with a typed
 *  `too-large` before any `data:` URI is built (DEF-397). */
export function inlineMobiImages(
  markup: string,
  document: MobiDocument,
  warnings: ConvertWarning[],
): string {
  assertInlinedImageBudget('Mobipocket e-book', mobiInlineEntries(markup, document));
  return markup.replace(RECINDEX_IMG_RE, (_whole, double, single, bare) => {
    const recindex = Number(double ?? single ?? bare);
    const raw = document.images.get(recindex);
    if (raw === undefined) {
      warnings.push({
        code: 'frame-decode-failed',
        message: `Image ${recindex} referenced by the e-book is missing and was skipped.`,
        detail: `recindex=${recindex}`,
      });
      return '';
    }
    const dataUri = mobiImageDataUri(raw);
    if (dataUri === null) {
      warnings.push({
        code: 'frame-decode-failed',
        message: `Image ${recindex} referenced by the e-book could not be read and was skipped.`,
        detail: `recindex=${recindex}`,
      });
      return '';
    }
    return `<img src="${dataUri}" alt="">`;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Compose the print body: sanitized markup when the recovery is HTML-shaped,
 *  otherwise the recovered text preserved verbatim in a `<pre>`. */
export function composeMobiBody(
  document: MobiDocument,
  warnings: ConvertWarning[],
): string {
  if (MARKUP_RE.test(document.markup)) {
    const inlined = inlineMobiImages(document.markup, document, warnings);
    return `<section class="mobi-body">${sanitizeEpubFragment(inlined)}</section>`;
  }
  return `<pre>${escapeHtml(document.markup)}</pre>`;
}

function degradedMessage(document: MobiDocument): string {
  let message =
    'This Mobipocket e-book was imported as reflowed text with its embedded images. ' +
    'CSS fidelity and positioned layout are lost: the original styling, fonts, ' +
    'page geometry and fixed positions cannot be reproduced.';
  if (document.usedKf8) {
    message += ' The text was taken from the KF8 (AZW3) part of the container.';
  }
  for (const note of document.notes) message += ` ${note}`;
  return message;
}

function degradedDetail(document: MobiDocument): string {
  return `Recovered ${document.markup.length} character(s) from the ${
    document.usedKf8 ? 'KF8 (AZW3)' : 'legacy Mobipocket'
  } part.`;
}

/**
 * Build the Mobipocket adapter. `print` and `maxBytes` are injectable for unit
 * tests. Fidelity is ALWAYS `degraded` and the `legacy-format-degraded` warning
 * names exactly what was and was not recovered.
 */
export function createMobiAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.mobiBytes,
): ConversionAdapter {
  return {
    id: 'mobi',
    label: 'Mobipocket e-book',
    extensions: ['.mobi', '.azw', '.azw3'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'degraded',
    specificity: 'specific',
    maxBytes,

    sniff(path: string, head: Buffer): boolean {
      return looksLikeMobi(path, head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      // Throws the typed drm-protected / unsupported-format / corrupt failures
      // BEFORE any print, so a protected e-book is never partially parsed.
      const document = parseMobi(new Uint8Array(bytes), signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      const warnings: ConvertWarning[] = [];
      const body = composeMobiBody(document, warnings);

      onProgress?.('laying-out', 0.5);
      const html = injectSecurityMeta(wrapOfficeDocument(body));
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      warnings.unshift({
        code: 'legacy-format-degraded',
        message: degradedMessage(document),
        detail: degradedDetail(document),
      });
      if (!htmlHasVisibleContent(html)) {
        warnings.push({
          code: 'partial-content',
          message:
            'The e-book had no visible content, so no text or images appear on the page.',
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'mobi',
        fidelity: 'degraded',
        warnings,
        title: document.title.length > 0 ? document.title : basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const mobiAdapter: ConversionAdapter = createMobiAdapter();
