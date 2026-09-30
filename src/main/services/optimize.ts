import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { OptimizePreset, SpaceAudit } from '../../shared/types';
import { carryAcroForm } from './form-fill';

/**
 * Optimize a PDFDocument into a new byte buffer according to a preset.
 *
 * The strategy is:
 *  - Copy all pages into a fresh PDFDocument (drops unreferenced objects and
 *    re-compresses content streams).
 *  - Control `useObjectStreams` so that `none` produces linearized (flat) output
 *    while `compact` and `max` produce compressed object-stream output.
 *  - `max` additionally strips the document Info dictionary.
 *
 * This is deliberately simple — pdf-lib does not expose image downsampling or
 * font re-subsetting APIs, but the copy-pages + re-save pipeline alone yields
 * measurable size reductions by dropping unreferenced objects.
 */
export async function optimizePdf(
  pdfDoc: PDFDocument,
  preset: OptimizePreset,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();

  // Copy all pages from the source into the output document.
  const pageIndices = pdfDoc.getPageIndices();
  const copied = await out.copyPages(pdfDoc, pageIndices);
  for (const page of copied) {
    out.addPage(page);
  }

  // Migrate the AcroForm if present. Phase 59 item 4 — carry the source form
  // graph instead of recreating fields: recreating reset every widget's box,
  // collapsed multi-widget button groups to one widget and repainted widgets
  // with pdf-lib's default appearance. All pages survive an optimize, so the
  // page map is the identity map.
  const pageMap = new Map<number, number>();
  for (let i = 0; i < pageIndices.length; i++) pageMap.set(pageIndices[i], i);
  try {
    carryAcroForm(pdfDoc, out, pageMap);
  } catch {
    // No form or a malformed form — proceed without one.
  }

  // Copy document-level metadata (title, author, subject) unless max preset
  // strips it.
  if (preset !== 'max') {
    try {
      const title = pdfDoc.getTitle();
      const author = pdfDoc.getAuthor();
      const subject = pdfDoc.getSubject();
      const keywords = pdfDoc.getKeywords();
      if (title) out.setTitle(title);
      if (author) out.setAuthor(author);
      if (subject) out.setSubject(subject);
      if (keywords) out.setKeywords(typeof keywords === 'string' ? [keywords] : keywords);
    } catch {
      // Metadata copy is best-effort.
    }
  }

  const useObjectStreams = preset !== 'none';

  return out.save({ useObjectStreams });
}

/**
 * Walk every indirect object in the PDFDocument and build a size breakdown
 * by element type.
 *
 * Categories:
 *  - images:       streams with /Subtype /Image (includes XObject images)
 *  - fonts:        dictionaries with /Type /Font, or streams containing
 *                  font data (/Subtype /Type1, /Subtype /TrueType, etc.)
 *  - contentStreams: page /Contents streams (identified by /Length + content)
 *  - metadata:     /Info dictionary, /Metadata streams, /ID array
 *  - other:        everything else
 */
export function auditSpace(pdfDoc: PDFDocument): SpaceAudit {
  const breakdown: SpaceAudit['breakdown'] = {
    images: 0,
    fonts: 0,
    contentStreams: 0,
    metadata: 0,
    other: 0,
  };

  let totalBytes = 0;

  try {
    const ctx = (pdfDoc as any).context;
    if (!ctx || typeof ctx.enumerateIndirectObjects !== 'function') {
      return { totalBytes: 0, breakdown };
    }

    const objects: Array<[any, any]> = ctx.enumerateIndirectObjects();

    for (const [, obj] of objects) {
      const size = typeof obj.sizeInBytes === 'function' ? obj.sizeInBytes() : 0;
      totalBytes += size;

      // Check if it's a stream (has a dict)
      const dict = obj?.dict;
      const isStream = dict !== undefined && typeof dict.get === 'function';

      if (isStream) {
        const subtypeName = tryGetName(dict, 'Subtype');
        if (subtypeName === 'Image') {
          breakdown.images += size;
          continue;
        }
        if (subtypeName === 'Type1' || subtypeName === 'TrueType' || subtypeName === 'Type0' ||
            subtypeName === 'CIDFontType0' || subtypeName === 'CIDFontType2') {
          breakdown.fonts += size;
          continue;
        }
        const typeName = tryGetName(dict, 'Type');
        if (typeName === 'Font' || typeName === 'FontDescriptor') {
          breakdown.fonts += size;
          continue;
        }
        if (typeName === 'Metadata') {
          breakdown.metadata += size;
          continue;
        }
        // Content streams: /Type is not set, but they have /Length
        if (typeName === undefined && dict.has(PDFName.of('Length'))) {
          breakdown.contentStreams += size;
          continue;
        }
        breakdown.other += size;
      } else if (dict === undefined && typeof obj.get === 'function') {
        // It's a dictionary (not a stream)
        const typeName = tryGetName(obj, 'Type');
        if (typeName === 'Font' || typeName === 'FontDescriptor') {
          breakdown.fonts += size;
          continue;
        }
        if (typeName === 'Catalog') {
          // The catalog itself is "other" but its metadata children
          // (like /Metadata) are caught above as streams.
          breakdown.other += size;
          continue;
        }
        // Check if this is the /Info dictionary — it has no /Type but has
        // typical Info keys.
        if (typeName === undefined) {
          if (obj.has(PDFName.of('Title')) || obj.has(PDFName.of('Author')) ||
              obj.has(PDFName.of('Producer')) || obj.has(PDFName.of('Creator'))) {
            breakdown.metadata += size;
            continue;
          }
        }
        breakdown.other += size;
      } else {
        breakdown.other += size;
      }
    }
  } catch {
    // If enumeration fails, return a zero breakdown.
  }

  return { totalBytes, breakdown };
}

/**
 * Try to get a /Name value from a PDFDict and return it as a string.
 */
function tryGetName(dict: any, key: string): string | undefined {
  try {
    const val = dict.get(PDFName.of(key));
    if (val && val instanceof PDFName) {
      return (val as any).decodeText?.() ?? String(val);
    }
  } catch {
    // Ignore.
  }
  return undefined;
}