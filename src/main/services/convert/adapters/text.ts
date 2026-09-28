import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import iconv from 'iconv-lite';
import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';

/**
 * Phase 53 — the `.txt` adapter.
 *
 * Encoding sniff (BOM, then UTF-8 validation, then CP1252 fallback), streamed
 * line-by-line so a 64 MB file is not held as bytes and text at once, wrapped
 * into a PDF by pdf-lib's own API (embedFont / drawText / addPage) at the
 * configured page size, margins and point size.
 */

type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

const PAGE_POINTS: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const MM_TO_PT = 72 / 25.4;

/** Code points == U+00FF are WinAnsi-encodable directly; these extra glyphs
 *  are the non-Latin-1 characters the StandardFont WinAnsiEncoding carries
 *  (curly quotes, dashes, bullet, ellipsis, ...). Anything else becomes '?'
 *  so `drawText` never throws on an unencodable character. */
const WINANSI_EXTRAS = new Set<number>([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e,
  0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a,
  0x20ac, 0x2122, 0xfb01, 0xfb02,
]);

function toWinAnsiSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= 0xff || WINANSI_EXTRAS.has(code) ? ch : '?';
  }
  return out;
}

/** The family requested by Settings mapped onto a StandardFont. The bundled
 *  TTFs (Liberation/DejaVu) and `Inter` are not embedded in this first slice,
 *  so they fall back to Helvetica (see the chunk-A report). */
function standardFontFor(family: string): StandardFonts {
  if (family === 'Times') return StandardFonts.TimesRoman;
  if (family === 'Courier') return StandardFonts.Courier;
  return StandardFonts.Helvetica;
}

function bomEncoding(head: Buffer): TextEncoding | null {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return 'utf-8';
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  return null;
}

/** True when the whole file is valid UTF-8 (streamed; a lone invalid byte
 *  aborts the decode and yields false). */
async function isValidUtf8File(path: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = createReadStream(path, { highWaterMark: CONVERT_LIMITS.textChunkBytes });
  try {
    for await (const chunk of stream) {
      decoder.decode(chunk as Buffer, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

async function resolveEncoding(path: string, head: Buffer): Promise<TextEncoding> {
  const bom = bomEncoding(head);
  if (bom !== null) return bom;
  return (await isValidUtf8File(path)) ? 'utf-8' : 'windows-1252';
}

function stripTrailingCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Stream the file through the decoder, splitting on '\n'. Only the decoded
 *  text (not the raw bytes) is retained. */
async function readLines(
  path: string,
  encoding: TextEncoding,
  signal?: AbortSignal,
): Promise<string[]> {
  const source = createReadStream(path, { highWaterMark: CONVERT_LIMITS.textChunkBytes });
  const decoder = iconv.decodeStream(encoding, { stripBOM: true });
  source.pipe(decoder);
  const lines: string[] = [];
  let carry = '';
  try {
    for await (const chunk of decoder) {
      if (signal?.aborted) {
        source.destroy();
        throw new ConvertCancelledError();
      }
      carry += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let index = carry.indexOf('\n');
      while (index >= 0) {
        lines.push(stripTrailingCr(carry.slice(0, index)));
        carry = carry.slice(index + 1);
        index = carry.indexOf('\n');
      }
    }
  } finally {
    if (!source.destroyed) source.destroy();
  }
  if (carry.length > 0) lines.push(stripTrailingCr(carry));
  return lines;
}

/** Decode the whole file to a string using this adapter's encoding sniff
 *  (BOM, UTF-8, CP1252) and streamed reader. Exported so the Markdown and HTML
 *  adapters REUSE one decoder rather than writing a second one. */
export async function readDecodedText(
  path: string,
  head: Buffer,
  signal?: AbortSignal,
): Promise<string> {
  const encoding = await resolveEncoding(path, head);
  const lines = await readLines(path, encoding, signal);
  return lines.join('\n');
}

/** Hard-break a single word wider than the text column. */
function splitLongWord(
  word: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    if (font.widthOfTextAtSize(rest, fontSize) <= maxWidth) {
      out.push(rest);
      break;
    }
    let cut = rest.length - 1;
    while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), fontSize) > maxWidth) {
      cut -= 1;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return out;
}

/** Word-wrap one source line to the text column width. */
function wrapTextLine(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const safe = toWinAnsiSafe(text).replace(/\t/g, '    ');
  if (safe.length === 0) return [''];
  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    const parts = splitLongWord(word, font, fontSize, maxWidth);
    for (let i = 0; i < parts.length - 1; i += 1) lines.push(parts[i]);
    current = parts[parts.length - 1] ?? '';
  }
  lines.push(current);
  return lines;
}

async function renderTextPdf(
  lines: string[],
  options: ResolvedConvertOptions,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const [pageWidth, pageHeight] = PAGE_POINTS[options.pageSize];
  const margin = options.marginMm * MM_TO_PT;
  const fontSize = options.textFontSizePt;
  const lineHeight = fontSize * 1.4;
  const maxWidth = pageWidth - margin * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(standardFontFor(options.textFontFamily));
  let page = doc.addPage([pageWidth, pageHeight]);
  let pageCount = 1;
  let y = pageHeight - margin - fontSize;

  for (const rawLine of lines) {
    if (signal?.aborted) throw new ConvertCancelledError();
    for (const wrapped of wrapTextLine(rawLine, font, fontSize, maxWidth)) {
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        pageCount += 1;
        y = pageHeight - margin - fontSize;
      }
      if (wrapped.length > 0) {
        page.drawText(wrapped, { x: margin, y, size: fontSize, font });
      }
      y -= lineHeight;
    }
  }

  const bytes = await doc.save();
  return { bytes, pageCount };
}

export const textAdapter: ConversionAdapter = {
  id: 'text',
  label: 'Text document',
  extensions: ['.txt'],
  capabilities: { canImport: true, canExport: false },
  fidelity: 'native',
  // Generic: a `.txt` extension match must never capture a Markdown/HTML file
  // whose content a more specific adapter recognises (Phase 53 criterion 9).
  specificity: 'generic',
  maxBytes: CONVERT_LIMITS.textBytes,

  sniff(path: string, head: Buffer): boolean {
    // Honest and simple: a `.txt` file whose head has no NUL byte is text; a
    // NUL means the bytes are some binary format the content pass should route.
    // A UTF-16 BOM is the exception — UTF-16 text is full of NUL bytes and is
    // still `.txt`.
    if (extname(path).toLowerCase() !== '.txt') return false;
    const bom = bomEncoding(head);
    if (bom === 'utf-16le' || bom === 'utf-16be') return true;
    return !head.includes(0);
  },

  async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
    const { path, options, head, signal, onProgress } = ctx;
    const info = await stat(path);
    if (info.size > CONVERT_LIMITS.textBytes) {
      throw new ConvertFailure('too-large');
    }
    const encoding = await resolveEncoding(path, head);
    onProgress?.('decoding', 0.1);
    const lines = await readLines(path, encoding, signal);
    if (signal?.aborted) throw new ConvertCancelledError();
onProgress?.('laying-out', 0.5);
    const { bytes, pageCount } = await renderTextPdf(lines, options, signal);
    onProgress?.('done', 1);

    // A whitespace-only (or otherwise visually content-free) text source is NOT
    // an error - refusing it would be hostile, and a genuinely zero-byte file is
    // already `empty-file`. But it must not be silent: the user is told the page
    // they got has no visible content, with the source size/lines as detail.
    const warnings: ConvertWarning[] = [];
    if (!lines.some((line) => line.trim().length > 0)) {
      warnings.push({
        code: 'partial-content',
        message:
          'The source document had no visible content, so no text appears on the page.',
        detail: `${info.size} byte(s), ${lines.length} line(s)`,
      });
    }

    return {
      bytes,
      pageCount,
      sourceFormat: 'text',
      fidelity: 'native',
      warnings,
      title: basename(path, extname(path)),
    };
  },
};
