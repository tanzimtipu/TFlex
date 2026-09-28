import { basename, extname } from 'node:path';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError } from '../errors';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import { readDecodedText } from './text';
import {
  parseRtf,
  type RtfAlignment,
  type RtfParseResult,
  type RtfRun,
} from './rtf-parse';

/**
 * Phase 53 feature F - the `.rtf` adapter.
 *
 * `rtf-parse.ts` parses the documented subset into styled text runs; this
 * module maps those runs to pdf-lib's own text API (`embedFont` / `drawText` /
 * `drawLine` for underline and strike) at the configured page size, margins and
 * base point size. No hand-rolled PDF content-stream syntax anywhere.
 *
 * Unsupported control words are never fatal: their count travels in a
 * `partial-content` warning.
 */

const PAGE_POINTS: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const MM_TO_PT = 72 / 25.4;
const TWIPS_TO_PT = 1 / 20;

/** Same WinAnsi safety rule the text adapter uses: anything the StandardFont
 *  cannot encode becomes '?' so `drawText` never throws mid-page. */
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

interface FontFamily {
  normal: StandardFonts;
  bold: StandardFonts;
  italic: StandardFonts;
  boldItalic: StandardFonts;
}

function familyFor(family: string): FontFamily {
  if (family === 'Times') {
    return {
      normal: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    };
  }
  if (family === 'Courier') {
    return {
      normal: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    };
  }
  return {
    normal: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  };
}

interface EmbeddedFonts {
  normal: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

function pickFont(fonts: EmbeddedFonts, run: RtfRun): PDFFont {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.normal;
}

interface Token {
  text: string;
  run: RtfRun;
  size: number;
  font: PDFFont;
  space: boolean;
  width: number;
}

function measure(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(toWinAnsiSafe(text), size);
}

function tokenizeParagraph(
  runs: RtfRun[],
  fonts: EmbeddedFonts,
  baseSize: number,
): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    const size = run.sizePt ?? baseSize;
    const font = pickFont(fonts, run);
    for (const part of run.text.split(/([ \t]+)/)) {
      if (part.length === 0) continue;
      const space = /^[ \t]+$/.test(part);
      tokens.push({ text: part, run, size, font, space, width: measure(part, font, size) });
    }
  }
  return tokens;
}

/** Greedy wrap; a single word wider than the column is split character-wise. */
function wrapTokens(tokens: Token[], availableWidth: number): Token[][] {
  const width = Math.max(1, availableWidth);
  const lines: Token[][] = [];
  let current: Token[] = [];
  let lineWidth = 0;
  const flush = (): void => {
    lines.push(current);
    current = [];
    lineWidth = 0;
  };

  for (const token of tokens) {
    if (token.space) {
      if (current.length === 0) continue;
      current.push(token);
      lineWidth += token.width;
      continue;
    }
    if (current.length > 0 && lineWidth + token.width > width) flush();
    if (token.width > width) {
      let rest = token.text;
      while (rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && measure(rest.slice(0, cut), token.font, token.size) > width) {
          cut -= 1;
        }
        const piece = rest.slice(0, cut);
        if (current.length > 0) flush();
        current.push({ ...token, text: piece, width: measure(piece, token.font, token.size) });
        lineWidth += current[current.length - 1].width;
        flush();
        rest = rest.slice(cut);
      }
      if (rest.length > 0) {
        current.push({ ...token, text: rest, width: measure(rest, token.font, token.size) });
        lineWidth += current[current.length - 1].width;
      }
      continue;
    }
    current.push(token);
    lineWidth += token.width;
  }
  if (current.length > 0 || lines.length === 0) flush();
  return lines;
}

function lineMaxSize(line: Token[], baseSize: number): number {
  let size = baseSize;
  for (const token of line) size = Math.max(size, token.size);
  return size;
}

function drawLine(
  page: PDFPage,
  line: Token[],
  x0: number,
  availableWidth: number,
  alignment: RtfAlignment,
  isLast: boolean,
  colors: Array<[number, number, number]>,
  y: number,
): void {
  const lineWidth = line.reduce((sum, token) => sum + token.width, 0);
  let x = x0;
  let extraPerSpace = 0;
  if (alignment === 'center') {
    x = x0 + (availableWidth - lineWidth) / 2;
  } else if (alignment === 'right') {
    x = x0 + availableWidth - lineWidth;
  } else if (alignment === 'justify' && !isLast && lineWidth < availableWidth) {
    const spaces = line.filter((token) => token.space).length;
    if (spaces > 0) extraPerSpace = (availableWidth - lineWidth) / spaces;
  }

  for (const token of line) {
    const [r, g, b] = colors[token.run.colorIndex] ?? [0, 0, 0];
    const color = rgb(r / 255, g / 255, b / 255);
    const safe = toWinAnsiSafe(token.text);
    page.drawText(safe, { x, y, size: token.size, font: token.font, color });
    const advance = token.width + (token.space ? extraPerSpace : 0);
    const thickness = Math.max(0.5, token.size * 0.05);
    if (token.run.underline) {
      page.drawLine({
        start: { x, y: y - token.size * 0.12 },
        end: { x: x + advance, y: y - token.size * 0.12 },
        thickness,
        color,
      });
    }
    if (token.run.strike) {
      page.drawLine({
        start: { x, y: y + token.size * 0.25 },
        end: { x: x + advance, y: y + token.size * 0.25 },
        thickness,
        color,
      });
    }
    x += advance;
  }
}

/** Render the parsed RTF to a fresh PDF. Exported for the unit tests. */
export async function renderRtfPdf(
  parsed: RtfParseResult,
  options: ResolvedConvertOptions,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const [pageWidth, pageHeight] = PAGE_POINTS[options.pageSize];
  const margin = options.marginMm * MM_TO_PT;
  const baseSize = options.textFontSizePt;
  const contentWidth = pageWidth - margin * 2;

  const doc = await PDFDocument.create();
  const family = familyFor(options.textFontFamily);
  const fonts: EmbeddedFonts = {
    normal: await doc.embedFont(family.normal),
    bold: await doc.embedFont(family.bold),
    italic: await doc.embedFont(family.italic),
    boldItalic: await doc.embedFont(family.boldItalic),
  };

  let page = doc.addPage([pageWidth, pageHeight]);
  let pageCount = 1;
  let y = pageHeight - margin;
  let pageHasContent = false;

  const newPage = (): void => {
    page = doc.addPage([pageWidth, pageHeight]);
    pageCount += 1;
    y = pageHeight - margin;
    pageHasContent = false;
  };

  for (const paragraph of parsed.paragraphs) {
    if (signal?.aborted) throw new ConvertCancelledError();
    if (paragraph.pageBreakBefore && pageHasContent) newPage();

    const indentLeft = paragraph.indentLeftTwips * TWIPS_TO_PT;
    const indentRight = paragraph.indentRightTwips * TWIPS_TO_PT;
    const indentFirst = paragraph.indentFirstTwips * TWIPS_TO_PT;
    const tokens = tokenizeParagraph(paragraph.runs, fonts, baseSize);
    if (tokens.length === 0) continue;

    const firstLineWidth = Math.max(1, contentWidth - indentLeft - indentRight - indentFirst);
    const lines = wrapTokens(tokens, firstLineWidth);

    lines.forEach((line, index) => {
      const size = lineMaxSize(line, baseSize);
      const lineHeight = size * 1.4;
      if (y - lineHeight < margin) newPage();
      const firstLine = index === 0;
      const lineIndent = firstLine ? indentFirst : 0;
      const startX = margin + indentLeft + lineIndent;
      const lineWidth = Math.max(1, contentWidth - indentLeft - indentRight - lineIndent);
      drawLine(
        page,
        line,
        startX,
        lineWidth,
        paragraph.alignment,
        index === lines.length - 1,
        parsed.colors,
        y - size,
      );
      y -= lineHeight;
      pageHasContent = true;
    });
  }

  const bytes = await doc.save();
  return { bytes, pageCount };
}

export function createRtfAdapter(): ConversionAdapter {
  return {
    id: 'rtf',
    label: 'Rich Text document',
    extensions: ['.rtf'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'layout',
    specificity: 'specific',
    maxBytes: CONVERT_LIMITS.textBytes,

    sniff(path: string, head: Buffer): boolean {
      if (extname(path).toLowerCase() === '.rtf') return true;
      return head.toString('latin1').includes('{\\rtf');
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, head, signal, onProgress } = ctx;
      onProgress?.('decoding', 0.1);
      const source = await readDecodedText(path, head, signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('parsing', 0.35);
      const parsed = parseRtf(source);
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.6);
      const { bytes, pageCount } = await renderRtfPdf(parsed, options, signal);
      if (signal?.aborted) throw new ConvertCancelledError();

      const warnings: ConvertWarning[] = [];
      if (parsed.ignoredControlWords > 0) {
        warnings.push({
          code: 'partial-content',
          message: `${parsed.ignoredControlWords} unsupported RTF control word(s) were ignored.`,
        });
      }
      // A source whose parsed runs hold no visible text is not an error, but it
      // must not be silent (DEF-376). Kept separate from the ignored-control-word
      // warning above: a document can have both, and neither replaces the other.
      const hasVisibleText = parsed.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.trim().length > 0),
      );
      if (!hasVisibleText) {
        warnings.push({
          code: 'partial-content',
          message:
            'The source document had no visible text, so no text appears on the page.',
          detail: `${source.length} character(s), ${parsed.paragraphs.length} paragraph(s)`,
        });
      }

      onProgress?.('done', 1);
      return {
        bytes,
        pageCount,
        sourceFormat: 'rtf',
        fidelity: 'layout',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const rtfAdapter: ConversionAdapter = createRtfAdapter();
