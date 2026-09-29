import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
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
import { ConvertZipError, openZip, type ZipLimits } from '../convert-zip';
import { CompoundFile, isCfb } from '../convert-cfb';
import { wrapOfficeDocument } from './docx';
import {
  extractNotesText,
  parsePresentationXml,
  parseRelationships,
  relsPathFor,
  renderPptxDeckHtml,
  resolvePackageTarget,
  resolveSlideTargets,
  PptxParseError,
  type PptxSlideInput,
} from '../pptx-to-html';

/** Re-exported for tests, mirroring the other office adapters. */
export type { HtmlPrintFn };

/**
 * Phase 55 feature C — the PPTX adapter (plus the legacy binary `.ppt` path).
 *
 * A `.pptx` is a ZIP: its container is read through `convert-zip.ts`, so the
 * zip-bomb ceilings apply before anything expands. Slide ORDER is resolved from
 * `<p:sldIdLst>` through `ppt/_rels/presentation.xml.rels` — never from the
 * `slideN.xml` file names — and `pptx-to-html.ts` maps each slide to one
 * fixed-size page. Fidelity is `layout`; animations and transitions are not
 * rendered (a warning always says so).
 *
 * A legacy `.ppt` is an OLE/CFB container. It shares the CFB walker extracted
 * to `convert-cfb.ts` (the same one the `.doc` adapter uses) to find the
 * `PowerPoint Document` stream and recover text best-effort; the result is
 * `degraded` and the warning names exactly what was lost.
 */

/** An OOXML presentation package names the presentation part in its content
 *  types; the package part path is the fallback marker. A `.docx`/`.xlsx` is
 *  also a ZIP and is deliberately NOT claimed. */
export function looksLikePptx(head: Buffer): boolean {
  if (head.length < 2 || head[0] !== 0x50 || head[1] !== 0x4b) return false;
  const text = head.toString('latin1');
  return text.includes('ppt/presentation.xml') || text.includes('presentationml.presentation');
}

/** A `.ppt` is an OLE/CFB container holding a `PowerPoint Document` stream
 *  (the directory name is UTF-16LE). */
export function looksLikePpt(path: string, head: Buffer): boolean {
  if (!isCfb(head)) return false;
  if (extname(path).toLowerCase() === '.ppt') return true;
  return head.includes(Buffer.from('PowerPoint Document', 'utf16le'));
}

/** Network-free image embedding: the CSP allows `data:` only. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

function mediaDataUri(name: string, bytes: Uint8Array): string {
  const ext = extname(name).slice(1).toLowerCase();
  const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** The `<p:rPr>` size unit (hundredths of a point) is handled in the mapper;
 *  these are the PowerPoint record types that carry slide text. */
const RT_TEXT_CHARS_ATOM = 0x0fa0;
const RT_TEXT_BYTES_ATOM = 0x0fa8;
const RECORD_CONTAINER_VER = 0x0f;
const MAX_RECOVERED_CHARS = 32 * 1024 * 1024;

export interface PptRecovery {
  text: string;
  /** Number of text atoms recovered. */
  atoms: number;
}

function decodePptBytes(raw: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(raw);
  } catch {
    return Buffer.from(raw).toString('latin1');
  }
}

/**
 * Best-effort text recovery from the `PowerPoint Document` stream. The stream
 * is a flat list of records whose children follow their container inline, so a
 * sequential walk with the 8-byte record header finds every `TextCharsAtom`
 * (UTF-16LE) and `TextBytesAtom` (Windows-1252). Returns null when the stream
 * carries no text atom at all.
 */
export function recoverPptText(data: Uint8Array): PptRecovery | null {
  const parts: string[] = [];
  let atoms = 0;
  let chars = 0;
  let offset = 0;
  while (offset + 8 <= data.length) {
    const recVer = data[offset] & 0x0f;
    const recType = data[offset + 2] | (data[offset + 3] << 8);
    const recLen =
      (data[offset + 4] |
        (data[offset + 5] << 8) |
        (data[offset + 6] << 16) |
        (data[offset + 7] << 24)) >>>
      0;
    offset += 8;
    const isTextAtom = recType === RT_TEXT_CHARS_ATOM || recType === RT_TEXT_BYTES_ATOM;
    if (recVer === RECORD_CONTAINER_VER) continue;
    if (recLen > data.length - offset) {
      if (isTextAtom) {
        const raw = data.subarray(offset);
        const text =
          recType === RT_TEXT_CHARS_ATOM
            ? Buffer.from(raw).toString('utf16le')
            : decodePptBytes(raw);
        parts.push(text);
        atoms += 1;
      }
      break;
    }
    if (isTextAtom) {
      const raw = data.subarray(offset, offset + recLen);
      const text =
        recType === RT_TEXT_CHARS_ATOM
          ? Buffer.from(raw).toString('utf16le')
          : decodePptBytes(raw);
      chars += text.length;
      if (chars > MAX_RECOVERED_CHARS) break;
      parts.push(text);
      atoms += 1;
    }
    offset += recLen;
  }
  if (atoms === 0) return null;
  return { text: parts.join('\n'), atoms };
}

/** Normalise PowerPoint's in-text control characters into plain text. */
export function cleanPptText(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x0d || code === 0x0b || code === 0x0c || code === 0x0a) {
      out += '\n';
      continue;
    }
    if (code === 0x09) {
      out += '\t';
      continue;
    }
    if (code === 0xa0) {
      out += ' ';
      continue;
    }
    if (code < 0x20) continue;
    out += character;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Emitted on EVERY `.pptx` import (requirement 8). */
export const ANIMATION_WARNING: ConvertWarning = {
  code: 'approx-render',
  message:
    'Slide animations and transitions are not rendered; each slide is imported as a static page.',
  detail: 'Animations and transitions are presentational and are not reproduced.',
};

/** The exact capabilities the legacy `.ppt` path cannot recover. */
export const LEGACY_PPT_LOSSES =
  'Layout, shapes, images, notes, transitions and animations';

/** Build the `.pptx` adapter. `print`, `maxBytes` and the ZIP ceilings are
 *  injectable so the engine and the bomb guard unit-test with no Electron. */
export function createPptxAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.pptxBytes,
  zipLimits?: ZipLimits,
): ConversionAdapter {
  return {
    id: 'pptx',
    label: 'PowerPoint presentation',
    extensions: ['.pptx'],
    capabilities: { canImport: true, canExport: false },
    // One fixed page per slide at the deck's own size, a re-layout, not native.
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes,

    sniff(_path: string, head: Buffer): boolean {
      // Content decides: a `.pptx`-named DOCX must not be claimed here.
      return looksLikePptx(head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      if (bytes.length === 0) throw new ConvertFailure('empty-file');

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

      onProgress?.('parsing', 0.35);
      const presentationXml = archive.readText('ppt/presentation.xml');
      if (presentationXml === null) {
        throw new ConvertFailure(
          'corrupt',
          'The PowerPoint package has no ppt/presentation.xml part.',
        );
      }
      let presentation: ReturnType<typeof parsePresentationXml>;
      try {
        presentation = parsePresentationXml(presentationXml);
      } catch (thrown) {
        if (thrown instanceof PptxParseError) {
          throw new ConvertFailure(
            'corrupt',
            `The presentation could not be read: ${thrown.message}`,
          );
        }
        throw thrown;
      }

      const presentationRels = parseRelationships(
        archive.readText('ppt/_rels/presentation.xml.rels') ?? '',
      );
      const slidePaths = resolveSlideTargets(presentation.slideRelIds, presentationRels);
      if (slidePaths.length === 0) {
        throw new ConvertFailure('corrupt', 'The presentation contains no slides.');
      }

      const media = new Map<string, string>();
      for (const name of archive.names()) {
        if (!name.startsWith('ppt/media/')) continue;
        const mediaBytes = archive.readBytes(name);
        if (mediaBytes === null || mediaBytes.length === 0) continue;
        media.set(name, mediaDataUri(name, mediaBytes));
      }

      const includeNotes = options.presentationIncludeNotes === true;
      const slides: PptxSlideInput[] = slidePaths.map((slidePath, index) => {
        const relationships = parseRelationships(
          archive.readText(relsPathFor(slidePath)) ?? '',
        );
        let notesText: string | null = null;
        if (includeNotes) {
          const notesRel = relationships.find((rel) => rel.type.endsWith('/notesSlide'));
          if (notesRel !== undefined) {
            const notesPath = resolvePackageTarget(dirname(slidePath), notesRel.target);
            const notesXml = archive.readText(notesPath);
            notesText = notesXml === null ? null : extractNotesText(notesXml);
          }
        }
        return {
          number: index + 1,
          xml: archive.readText(slidePath),
          relationships,
          baseDir: dirname(slidePath),
          notesText,
        };
      });
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.6);
      const rendered = renderPptxDeckHtml({
        widthEmu: presentation.widthEmu,
        heightEmu: presentation.heightEmu,
        slides,
        media,
        includeNotes,
      });
      const html = injectSecurityMeta(rendered.html);
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
        // The composed `@page` rule carries the presentation's own size.
        preferCSSPageSize: true,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      // The animation/transition warning is unconditional on every PPTX import.
      const warnings: ConvertWarning[] = [ANIMATION_WARNING, ...rendered.warnings];
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'pptx',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** Build the legacy `.ppt` adapter. Shares the CFB walker and degrades to text. */
export function createPptAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.pptBytes,
): ConversionAdapter {
  return {
    id: 'ppt',
    label: 'Legacy PowerPoint presentation (.ppt)',
    extensions: ['.ppt'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'degraded',
    specificity: 'specific',
    maxBytes,

    sniff(path: string, head: Buffer): boolean {
      return looksLikePpt(path, head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      if (bytes.length === 0) throw new ConvertFailure('empty-file');

      let doc: CompoundFile;
      try {
        doc = new CompoundFile(new Uint8Array(bytes));
      } catch (thrown) {
        throw new ConvertFailure(
          'corrupt',
          `The legacy PowerPoint container could not be read: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        );
      }

      const stream = doc.read('PowerPoint Document');
      if (stream === null || stream.length === 0) {
        throw new ConvertFailure(
          'decode-failed',
          'No readable text could be recovered from this legacy PowerPoint file: the PowerPoint Document stream is missing.',
        );
      }
      const recovered = recoverPptText(stream);
      const text = recovered === null ? '' : cleanPptText(recovered.text);
      if (text.length === 0) {
        throw new ConvertFailure(
          'decode-failed',
          'The legacy PowerPoint presentation contained no recoverable text.',
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.5);
      const html = injectSecurityMeta(
        wrapOfficeDocument(`<pre>${escapeText(text)}</pre>`),
      );
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [
        {
          code: 'legacy-format-degraded',
          message: `This legacy .ppt file was imported as extracted text only. ${LEGACY_PPT_LOSSES} could not be recovered.`,
          detail: `Recovered ${text.length} character(s) from ${
            recovered?.atoms ?? 0
          } text atom(s) in the PowerPoint Document stream.`,
        },
        ...blockedResourceWarnings(printed.value.blockedUrls),
      ];

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'ppt',
        fidelity: 'degraded',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapters; the registry loads these two. */
export const pptxAdapter: ConversionAdapter = createPptxAdapter();
export const pptAdapter: ConversionAdapter = createPptAdapter();