import { basename, extname } from 'node:path';
import type {
  ConvertResult,
  ConvertWarning,
} from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import { markdownToHtml } from '../markdown-to-html';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { htmlHasVisibleContent } from '../visible-content';
import { readDecodedText } from './text';

/** Re-exported for tests and future adapters. */
export type { HtmlPrintFn };

/**
 * Phase 53 feature E — the `.md`/`.markdown` adapter.
 *
 * Decodes with the text adapter's single decoder, renders through `marked`
 * (`markdown-to-html.ts`), then prints through the isolated offscreen engine.
 * Declared `specific`: a `.txt`-named Markdown file must beat the generic text
 * adapter on content (criterion 9), and a `.md` extension always wins step 1.
 */

/** A real inline link (not an image `![alt](src)`). */
const MARKDOWN_LINK_PATTERN = /(?<!!)\[[^\]]+\]\([^)]+\)/;

/** Content markers. Two distinct kinds in the sniff head mean Markdown. */
const MARKDOWN_MARKERS: RegExp[] = [
  /^#{1,6} /m,
  /^```/m,
  /^\s*[-*+] /m,
  /^\s*\d+\. /m,
  /\[[^\]]+\]\([^)]+\)/,
  /^\s*> /m,
  /^\s*\|.*\|/m,
];

/** True when at least two distinct Markdown constructs appear in the head. */
export function looksLikeMarkdown(head: Buffer): boolean {
  const text = head.toString('utf8');
  return MARKDOWN_MARKERS.filter((marker) => marker.test(text)).length >= 2;
}

/** True when the source has at least one inline link. */
export function hasMarkdownLink(source: string): boolean {
  return MARKDOWN_LINK_PATTERN.test(source);
}

export function createMarkdownAdapter(print: HtmlPrintFn = printHtmlToPdf): ConversionAdapter {
  return {
    id: 'markdown',
    label: 'Markdown document',
    extensions: ['.md', '.markdown'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.textBytes,

    sniff(path: string, head: Buffer): boolean {
      const ext = extname(path).toLowerCase();
      if (ext === '.md' || ext === '.markdown') return true;
      return looksLikeMarkdown(head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, head, signal, onProgress } = ctx;
      onProgress?.('decoding', 0.1);
      const source = await readDecodedText(path, head, signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.4);
      const html = markdownToHtml(source);
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [];
      if (hasMarkdownLink(source)) {
        warnings.push({
          code: 'links-not-live',
          message:
            'Links are printed as text and are not clickable in this version.',
        });
      }
      // A source that renders no text and no image is not an error, but it must
      // not be silent: the same `partial-content` warning the text adapter emits
      // (DEF-376). An image-only document renders content and is not warned.
      if (!htmlHasVisibleContent(html)) {
        warnings.push({
          code: 'partial-content',
          message:
            'The source document had no visible content, so no text appears on the page.',
          detail: `${source.length} character(s), ${source.split('\n').length} line(s)`,
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'markdown',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const markdownAdapter: ConversionAdapter = createMarkdownAdapter();