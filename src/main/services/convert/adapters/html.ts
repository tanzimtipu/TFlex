import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import { injectSecurityMeta } from '../templates';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import {
  detectRemoteResources,
  mergeResourceUrls,
} from '../remote-resources';
import { htmlHasVisibleContent } from '../visible-content';
import { readDecodedText } from './text';

/** Re-exported for tests and future adapters. */
export type { HtmlPrintFn };

/**
 * Phase 53 feature H — the `.html`/`.htm`/`.xhtml` adapter.
 *
 * Decodes with the text adapter's single decoder, injects the CSP meta
 * (`injectSecurityMeta`, exactly once), then prints through the isolated
 * offscreen engine. Each blocked subresource becomes a `resource-blocked`
 * warning. Declared `specific` so an HTML file named `.txt` still routes here.
 */

const HTML_EXTENSIONS = ['.html', '.htm', '.xhtml'];

export function createHtmlAdapter(print: HtmlPrintFn = printHtmlToPdf): ConversionAdapter {
  return {
    id: 'html',
    label: 'HTML document',
    extensions: [...HTML_EXTENSIONS],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.textBytes,

    sniff(path: string, head: Buffer): boolean {
      if (HTML_EXTENSIONS.includes(extname(path).toLowerCase())) return true;
      const text = head.toString('utf8').toLowerCase();
      return text.includes('<!doctype html') || text.includes('<html');
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, head, signal, onProgress } = ctx;
      onProgress?.('decoding', 0.1);
      const source = await readDecodedText(path, head, signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      // Source-level detection does not depend on winning the CSP-vs-session
      // race: the CSP can block a request inside Blink before it reaches the
      // session's onBeforeRequest, leaving `blockedUrls` empty. The session
      // handler stays the hard guarantee; this scan is the warning source.
      const detected = detectRemoteResources(source);

      onProgress?.('laying-out', 0.4);
      const printed = await print(injectSecurityMeta(source), {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = blockedResourceWarnings(
        mergeResourceUrls(printed.value.blockedUrls, detected),
      );
      // A source with no visible text and no image is not an error, but it must
      // not be silent (DEF-376): the same `partial-content` warning the text
      // adapter emits, using the same rule as the Markdown adapter. An
      // image-only page renders content and is not warned, and this is
      // independent of the remote-resource detection above.
      if (!htmlHasVisibleContent(source)) {
        warnings.push({
          code: 'partial-content',
          message:
            'The source document had no visible content, so no text or images appear on the page.',
          detail: `${source.length} character(s)`,
        });
      }

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'html',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const htmlAdapter: ConversionAdapter = createHtmlAdapter();