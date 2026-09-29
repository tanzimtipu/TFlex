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
  odfToHtml,
  parseOfficeStyles,
  OdfParseError,
  type OdfImageMap,
  type OdfStyleTable,
} from '../odf-to-html';
import { OFFICE_PRINT_CSS, wrapOfficeDocument } from './docx';

/** Re-exported for tests, mirroring the DOCX adapter. */
export type { HtmlPrintFn };

/**
 * Phase 55 feature A — the `.odt` adapter.
 *
 * An ODT is a ZIP container; `convert-zip.ts` opens it within its ceilings,
 * `content.xml` is mapped to the shared HTML intermediate by `odf-to-html.ts`
 * (with formatting resolved from `styles.xml`), and the result prints through
 * the same isolated engine as `.docx`. Fidelity is `layout`.
 */

/** An ODT is a ZIP whose `mimetype` part (stored first, uncompressed) names the
 *  text document type. A `.docx`-named ODT is routed here by content. */
export function looksLikeOdt(head: Buffer): boolean {
  const text = head.toString('latin1');
  if (!text.startsWith('PK\x03\x04')) return false;
  if (text.includes('application/vnd.oasis.opendocument.text')) return true;
  // Fallback marker for a container whose mimetype entry sits past the head:
  // the ODF part names are unique to an ODF package.
  return text.includes('content.xml') && text.includes('styles.xml');
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

/** Base64-embed every `Pictures/*` entry, keyed by its in-package href. No
 *  network: the CSP allows `data:` images only. */
export function collectOdtImages(
  archive: { names(): string[]; readBytes(name: string): Uint8Array | null },
): OdfImageMap {
  const images: OdfImageMap = new Map();
  for (const name of archive.names()) {
    if (!name.startsWith('Pictures/')) continue;
    const bytes = archive.readBytes(name);
    if (bytes === null || bytes.length === 0) continue;
    const ext = extname(name).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
    images.set(name, `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  return images;
}

/**
 * Build the `.odt` adapter. `print` and the ZIP ceilings are injectable so the
 * engine and the bomb ceiling unit-test with no Electron and no huge fixture.
 */
export function createOdtAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.odtBytes,
  zipLimits?: ZipLimits,
): ConversionAdapter {
  return {
    id: 'odt',
    label: 'OpenDocument text',
    extensions: ['.odt'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(_path: string, head: Buffer): boolean {
      return looksLikeOdt(head);
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

      const contentXml = archive.readText('content.xml');
      if (contentXml === null) {
        throw new ConvertFailure(
          'corrupt',
          'The OpenDocument package has no content.xml part.',
        );
      }
      const stylesXml = archive.readText('styles.xml');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.4);
      let styles: OdfStyleTable;
      let body: string;
      try {
        styles =
          stylesXml === null
            ? { textStyles: new Map(), orderedLists: new Set() }
            : parseOfficeStyles(stylesXml);
        body = odfToHtml(contentXml, styles, collectOdtImages(archive));
      } catch (thrown) {
        if (thrown instanceof OdfParseError) {
          throw new ConvertFailure(
            'corrupt',
            `The OpenDocument content could not be parsed: ${thrown.message}`,
          );
        }
        throw thrown;
      }

      const html = injectSecurityMeta(wrapOfficeDocument(body));
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [];
      if (contentXml.includes('<text:a')) {
        warnings.push({
          code: 'links-not-live',
          message:
            'Links are printed as text and are not clickable in this version.',
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
        sourceFormat: 'odt',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const odtAdapter: ConversionAdapter = createOdtAdapter();

/** Re-exported for tests; the stylesheet is shared with the DOCX adapter. */
export { OFFICE_PRINT_CSS };
