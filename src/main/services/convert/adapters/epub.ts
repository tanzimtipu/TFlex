import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { injectSecurityMeta } from '../templates';
import { htmlHasVisibleContent } from '../visible-content';
import { ConvertZipError, openZip, type ZipLimits } from '../convert-zip';
import {
  detectRemoteResources,
  mergeResourceUrls,
} from '../remote-resources';
import {
  chapterFragment,
  inlineEpubImages,
  parseEpub,
  type EpubDocument,
} from '../epub-parse';
import { wrapOfficeDocument } from './docx';

/** Re-exported for tests, mirroring the DOCX/ODT adapters. */
export type { HtmlPrintFn };

/**
 * Phase 56 feature A — the `.epub` (2 and 3) adapter.
 *
 * An EPUB is a ZIP container; `epub-parse.ts` reads the OPF spine, the raw
 * chapter XHTML and the base64-embedded images. The adapter composes ONE
 * HTML document — the cover image as the first page, then each spine chapter
 * in order separated by a page break — and prints it through the same
 * isolated offscreen engine as `.docx`/`.odt`. Fidelity is `layout`.
 */

/** An EPUB is a ZIP whose first, uncompressed `mimetype` entry names the
 *  package type; the marker appears within the sniff head. */
export function looksLikeEpub(head: Buffer): boolean {
  const text = head.toString('latin1');
  if (!text.startsWith('PK\x03\x04')) return false;
  return text.includes('application/epub+zip');
}

/** Cover and chapter page breaks. Appended to the shared office stylesheet so
 *  the cover is its own page and every later chapter starts on a new one. */
export const EPUB_PRINT_CSS = `
.epub-cover { text-align: center; page-break-after: always; break-after: page; }
.epub-cover img { max-width: 100%; max-height: 90vh; }
.epub-chapter + .epub-chapter { page-break-before: always; break-before: page; }
`;

/** Compose the print body: cover first, then chapters in spine order. */
export function composeEpubBody(document: EpubDocument): string {
  const parts: string[] = [];
  if (document.coverHref !== undefined) {
    const cover = document.images.get(document.coverHref);
    if (cover !== undefined) {
      parts.push(`<div class="epub-cover"><img src="${cover}" alt=""></div>`);
    }
  }
  for (const chapter of document.spine) {
    const fragment = inlineEpubImages(
      chapterFragment(chapter.xhtml),
      chapter.href,
      document.images,
    );
    parts.push(`<section class="epub-chapter">${fragment}</section>`);
  }
  return `<style>${EPUB_PRINT_CSS}</style>\n${parts.join('\n')}`;
}

/**
 * Build the `.epub` adapter. `print` and the ZIP ceilings are injectable so
 * the engine unit-tests with no Electron.
 */
export function createEpubAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.epubBytes,
  zipLimits?: ZipLimits,
): ConversionAdapter {
  return {
    id: 'epub',
    label: 'EPUB e-book',
    extensions: ['.epub'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(_path: string, head: Buffer): boolean {
      return looksLikeEpub(head);
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
      const document = parseEpub(archive);

      const html = injectSecurityMeta(wrapOfficeDocument(composeEpubBody(document)));
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [];
      warnings.push(
        ...blockedResourceWarnings(
          mergeResourceUrls(printed.value.blockedUrls, detectRemoteResources(html)),
        ),
      );
      if (!htmlHasVisibleContent(html)) {
        warnings.push({
          code: 'partial-content',
          message:
            'The e-book had no visible content, so no text or images appear on the page.',
        });
      }
      if (document.degraded) {
        warnings.push({
          code: 'legacy-format-degraded',
          message:
            'One or more spine items are not reflowable XHTML and were left out of the printed document.',
        });
      }

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'epub',
        fidelity: 'layout',
        warnings,
        title: document.title.length > 0 ? document.title : basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const epubAdapter: ConversionAdapter = createEpubAdapter();
