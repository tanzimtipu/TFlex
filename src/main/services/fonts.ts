import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { EditFont } from '../../shared/types';
import { isBundledEditFont, type BundledEditFont } from './text-style';

/**
 * Phase 27 — the bundled, offline, licence-clean font families.
 *
 * Every family ships four variant files under `assets/fonts/` (regular, bold,
 * italic, bold-italic) so a (family, bold, italic) style triple always maps to
 * a real file — there is no silent variant fallback. A file that cannot be
 * read fails loud with a `FontEmbedError` naming the family and variant, which
 * the engine maps to a typed `engine-error`.
 *
 * Licences (copied next to the fonts):
 *   - Liberation Sans        SIL Open Font License 1.1 -> LICENSE-Liberation.txt
 *   - DejaVu Serif/Sans Mono DejaVu (Bitstream Vera-derived) -> LICENSE-DejaVu.txt
 */

interface FontVariantFiles {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

/** Bundled family id -> the four variant file names in `assets/fonts/`. */
export const BUNDLED_FONT_FILES: Record<BundledEditFont, FontVariantFiles> = {
  'Liberation Sans': {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
    boldItalic: 'LiberationSans-BoldItalic.ttf',
  },
  'DejaVu Serif': {
    regular: 'DejaVuSerif.ttf',
    bold: 'DejaVuSerif-Bold.ttf',
    italic: 'DejaVuSerif-Italic.ttf',
    boldItalic: 'DejaVuSerif-BoldItalic.ttf',
  },
  'DejaVu Sans Mono': {
    regular: 'DejaVuSansMono.ttf',
    bold: 'DejaVuSansMono-Bold.ttf',
    italic: 'DejaVuSansMono-Oblique.ttf',
    boldItalic: 'DejaVuSansMono-BoldOblique.ttf',
  },
};

/** The directory the bundled TTFs are read from. `index.ts` points this at
 *  `app.getAppPath()/assets/fonts`; the default covers vitest runs (cwd is the
 *  repo root) and any caller that never sets it. */
let bundledFontDir = join(process.cwd(), 'assets', 'fonts');

export function setBundledFontDir(dir: string): void {
  bundledFontDir = dir;
}

export function getBundledFontDir(): string {
  return bundledFontDir;
}

/** Thrown when a bundled font cannot be read or embedded. The message names
 *  the family (and variant) so the engine's typed error is actionable. */
export class FontEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontEmbedError';
  }
}

/** The variant file for a (family, bold, italic) triple. */
export function variantFileFor(family: BundledEditFont, bold: boolean, italic: boolean): string {
  const files = BUNDLED_FONT_FILES[family];
  if (bold && italic) return files.boldItalic;
  if (bold) return files.bold;
  if (italic) return files.italic;
  return files.regular;
}

/** Human-readable variant label for error messages. */
function variantLabel(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'bold italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/** A deterministic /BaseFont name (pdf-lib otherwise appends a random suffix
 *  per embed, which makes saved bytes non-reproducible). */
function customNameFor(family: BundledEditFont, bold: boolean, italic: boolean): string {
  const suffix = bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '';
  return `TFlex${family.replace(/[^A-Za-z0-9]/g, '')}${suffix}`;
}

/**
 * Phase 52 — @pdf-lib/fontkit compatibility shim for @cantoo/pdf-lib.
 *
 * The fork's `CustomFontSubsetEmbedder.serializeFont` prefers a SYNC
 * `subset.encode()` when present and only falls back to the Node-style
 * `subset.encodeStream()`. `@pdf-lib/fontkit` v1 (the installed embedding
 * engine) exposes `encode(stream)` — a different Node-stream signature — so
 * the fork calls it with no argument and it throws
 * (`Cannot read properties of undefined (reading 'pos')`). Wrapping the
 * fontkit result hides `encode` on the subset, which makes the fork take its
 * documented `encodeStream()` path and embed the subset correctly. No new
 * dependency is added and unencrypted font behaviour is unchanged.
 */
function hideSubsetEncode(subset: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(subset, {
    get(target, prop) {
      if (prop === 'encode') return undefined;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** fontkit with the subset-encode shim applied, for `registerFontkit`. */
const compatibleFontkit = {
  create(buffer: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(buffer, postscriptName) as unknown as
      | (Record<string, unknown> & { createSubset?: () => Record<string, unknown> })
      | null;
    if (!font || typeof font.createSubset !== 'function') return font;
    return new Proxy(font, {
      get(target, prop) {
        if (prop === 'createSubset') {
          const createSubset = target.createSubset?.bind(target);
          return () => hideSubsetEncode(createSubset!());
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
};


/** Map an EditFont allowlist value to the matching pdf-lib StandardFonts
 *  enum entry. All three use WinAnsiEncoding so Latin text round-trips. */
function standardFontFor(font: EditFont): StandardFonts {
  switch (font) {
    case 'Times': return StandardFonts.TimesRoman;
    case 'Courier': return StandardFonts.Courier;
    case 'Helvetica':
    default:
      return StandardFonts.Helvetica;
  }
}

/**
 * Phase 18 — map a (family, bold, italic) style triple to the matching
 * pdf-lib StandardFonts entry for watermark text. All nine combinations
 * exist among the bundled standard fonts (WinAnsiEncoding, so Latin text
 * round-trips like the Phase 10 edit tools).
 */
export function selectStandardFont(
  family: EditFont,
  bold: boolean,
  italic: boolean,
): StandardFonts {
  if (!bold && !italic) return standardFontFor(family);
  if (family === 'Times') {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === 'Courier') {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** Per-document embedded-font cache, keyed `family|b|i`. Keyed on the
 *  PDFDocument so a save reuses one embedded font across every text path
 *  (text-box bake, editTextRun, annotation /AP) and the entry is released
 *  with the document. */
const fontCache = new WeakMap<PDFDocument, Map<string, PDFFont>>();

function cacheFor(doc: PDFDocument): Map<string, PDFFont> {
  let cache = fontCache.get(doc);
  if (cache === undefined) {
    cache = new Map<string, PDFFont>();
    fontCache.set(doc, cache);
  }
  return cache;
}

/**
 * Phase 27 — the ONE embedding path for EditFont text. A standard family maps
 * to its base-14 StandardFonts entry; a bundled family is read from
 * `assets/fonts/` and embedded as a subset. The result is cached per
 * (document, family, bold, italic) so repeated draws share a single font dict.
 *
 * Fails loud (never a silent substitution): a bundled family whose variant
 * file is missing/unreadable or whose bytes cannot be embedded throws
 * `FontEmbedError` naming the family and variant.
 */
export async function embedEditFont(
  doc: PDFDocument,
  family: EditFont,
  bold: boolean,
  italic: boolean,
): Promise<PDFFont> {
  const key = `${family}|${bold ? 'b' : ''}${italic ? 'i' : ''}`;
  const cache = cacheFor(doc);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let font: PDFFont;
  if (isBundledEditFont(family)) {
    const file = variantFileFor(family, bold, italic);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(bundledFontDir, file));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new FontEmbedError(
        `font ${JSON.stringify(family)} (${variantLabel(bold, italic)}): cannot read bundled font file ${file} (${why})`,
      );
    }
    doc.registerFontkit(
      compatibleFontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0],
    );
    try {
      font = await doc.embedFont(bytes, {
        subset: true,
        customName: customNameFor(family, bold, italic),
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new FontEmbedError(
        `font ${JSON.stringify(family)} (${variantLabel(bold, italic)}): embedding ${file} failed (${why})`,
      );
    }
  } else {
    font = await doc.embedFont(selectStandardFont(family, bold, italic));
  }

  cache.set(key, font);
  return font;
}
