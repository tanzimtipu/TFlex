import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import mammoth from 'mammoth';
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
import { ConvertZipError, inspectZip, type ZipLimits } from '../convert-zip';

/** Re-exported for the ODT adapter and tests. */
export type { HtmlPrintFn };

/**
 * Phase 55 feature A — the `.docx` adapter (and the print shell the `.odt`
 * adapter shares).
 *
 * `mammoth` converts the OOXML package to semantic HTML (headings, styled
 * runs, lists, tables and `data:` images — the CSP permits `data:`, so images
 * need no network). That HTML is wrapped in the print shell and rendered
 * through the isolated offscreen engine. Fidelity is `layout`: this is a
 * reflow, not a byte-faithful reproduction.
 */

/** The office print stylesheet. Shared by both office adapters so one styling
 *  path serves DOCX and ODT. H1-H6 are pairwise different sizes and every
 *  construct the phase promises has a rule. No `@page` rule: Settings win. */
export const OFFICE_PRINT_CSS = `
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 24pt; margin: 0.6em 0 0.4em; }
h2 { font-size: 20pt; margin: 0.6em 0 0.4em; }
h3 { font-size: 17pt; margin: 0.6em 0 0.4em; }
h4 { font-size: 15pt; margin: 0.6em 0 0.4em; }
h5 { font-size: 13pt; margin: 0.6em 0 0.4em; }
h6 { font-size: 12pt; margin: 0.6em 0 0.4em; }
strong { font-weight: 700; }
em { font-style: italic; }
p { margin: 0.4em 0; }
ul { margin: 0.4em 0; padding-left: 1.4em; list-style: disc; }
ul ul { list-style: circle; }
ol { margin: 0.4em 0; padding-left: 1.6em; list-style: decimal; }
li { margin: 0.15em 0; }
table { border-collapse: collapse; margin: 0.5em 0; max-width: 100%; }
th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
img { max-width: 100%; }
.odf-tab { white-space: pre; }
`;

/** Wrap an HTML body fragment in the print shell. The adapter injects the CSP
 *  meta via `injectSecurityMeta` before printing (idempotent, belt-and-braces
 *  with the engine's own injection). */
export function wrapOfficeDocument(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${OFFICE_PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** A DOCX is a ZIP whose package carries the OOXML part table or the main
 *  document part. `PK\x03\x04` alone is ambiguous (an ODT is also a ZIP), so
 *  the OOXML marker is required and the ODT adapter claims its own. */
export function looksLikeDocx(head: Buffer): boolean {
  const text = head.toString('latin1');
  if (!text.startsWith('PK\x03\x04')) return false;
  return text.includes('[Content_Types].xml') || text.includes('word/document.xml');
}

/** At most this many mammoth messages are quoted in a single warning. */
const MAMMOTH_MESSAGE_CAP = 5;

/**
 * Build the `.docx` adapter. `print` is injected exactly as the Markdown
 * adapter injects it (no Electron in unit tests); `maxBytes` is overridable so
 * the size-ceiling path is testable without a 256 MiB fixture.
 */
export function createDocxAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.docxBytes,
  zipLimits?: ZipLimits,
): ConversionAdapter {
  return {
    id: 'docx',
    label: 'Word document',
    extensions: ['.docx'],
    capabilities: { canImport: true, canExport: false },
    // A reflow, not a byte-faithful reproduction.
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(_path: string, head: Buffer): boolean {
      // Content decides, not the name: a `.docx`-named ODT must fall through
      // to the ODT adapter's own sniff.
      return looksLikeDocx(head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      // Reject a zip bomb before mammoth's own unbounded unzip touches it.
      try {
        inspectZip(new Uint8Array(bytes), zipLimits);
      } catch (thrown) {
        if (thrown instanceof ConvertZipError) {
          throw new ConvertFailure(thrown.code, thrown.message);
        }
        throw thrown;
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      let converted: { value: string; messages: Array<{ type: string; message: string }> };
      try {
        converted = await mammoth.convertToHtml({ buffer: bytes });
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        throw new ConvertFailure(
          'corrupt',
          `The Word document could not be read: ${detail}`,
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.5);
      const html = injectSecurityMeta(wrapOfficeDocument(converted.value));
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [];
      const messages = converted.messages ?? [];
      if (messages.length > 0) {
        warnings.push({
          code: 'generic-fallback',
          message: `Some Word constructs were approximated: ${messages
            .slice(0, MAMMOTH_MESSAGE_CAP)
            .map((entry) => entry.message)
            .join('; ')}`,
          detail: `${messages.length} document message(s)`,
        });
      }
      if (!htmlHasVisibleContent(html)) {
        warnings.push({
          code: 'partial-content',
          message:
            'The source document had no visible content, so no text appears on the page.',
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'docx',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const docxAdapter: ConversionAdapter = createDocxAdapter();
