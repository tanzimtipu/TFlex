import PptxGenJS from 'pptxgenjs';
import type { Result } from '../../../shared/result';
import { err, ok } from '../../../shared/result';
import {
  EXPORT_FIDELITY_NOTES,
  type ExportBuild,
  type ExportErrorCode,
  type ExportPageImage,
  type ExportPptxPayload,
  type ExportTextPage,
} from '../../../shared/export';
import { noTextMarker } from './tables-from-text';
import { FIDELITY_PROPERTY_MARKER, type ExportTextEngine } from './xlsx-export';

/**
 * Phase 55 feature D — the PDF -> `.pptx` writer.
 *
 * One slide per page, in the document's page order, sized from the page box
 * (the caller's `ExportPageImage.pageWidth/pageHeight`, in PDF points, divided
 * by 72 to inches for `defineLayout`). A PowerPoint presentation carries ONE
 * `<p:sldSz>`, so when a document mixes page sizes the FIRST page's box is the
 * presentation size and the slides that differ are named in the fidelity note
 * — the writer never pretends a multi-size deck keeps every page's ratio.
 *
 * The slide embeds the page image when one was supplied and `includeImages` is
 * on; otherwise it carries the extracted text as a text box. Either way the
 * page's own text goes into the slide NOTES so the words stay selectable. The
 * fidelity note is written to the presentation core properties: the marker
 * `conversion-fidelity` plus the notes go to `pptx.subject` (`dc:subject` in
 * `docProps/core.xml`), readable back from the produced package.
 */

/** LETTER, the fallback when the caller supplies no page box at all. */
const DEFAULT_PAGE_PT = { widthPt: 612, heightPt: 792 };

/** The marker every export writes into its produced-file metadata. */
export const PPTX_FIDELITY_MARKER = FIDELITY_PROPERTY_MARKER;

interface PageBox {
  widthPt: number;
  heightPt: number;
}

function boxOf(entry: ExportPageImage | undefined): PageBox | null {
  if (entry === undefined) return null;
  const widthPt = Number(entry.pageWidth);
  const heightPt = Number(entry.pageHeight);
  if (!Number.isFinite(widthPt) || widthPt <= 0) return null;
  if (!Number.isFinite(heightPt) || heightPt <= 0) return null;
  return { widthPt, heightPt };
}

function sameBox(a: PageBox, b: PageBox): boolean {
  return Math.abs(a.widthPt - b.widthPt) < 0.5 && Math.abs(a.heightPt - b.heightPt) < 0.5;
}

export interface PptxBuildInput {
  pages: ExportTextPage[];
  includeImages: boolean;
  entries: ExportPageImage[];
}

/** Build the presentation bytes from already-extracted pages. */
export async function buildPptx(input: PptxBuildInput): Promise<ExportBuild> {
  const entryByPage = new Map<number, ExportPageImage>();
  for (const entry of input.entries) {
    if (entry && typeof entry.pageNumber === 'number') entryByPage.set(entry.pageNumber, entry);
  }

  // The presentation size is the first page box we can see: the first page's
  // supplied image, else the first supplied image, else LETTER.
  let primary: PageBox = DEFAULT_PAGE_PT;
  for (const page of input.pages) {
    const box = boxOf(entryByPage.get(page.pageIndex));
    if (box !== null) {
      primary = box;
      break;
    }
  }
  if (primary === DEFAULT_PAGE_PT) {
    for (const entry of [...input.entries].sort((a, b) => a.pageNumber - b.pageNumber)) {
      const box = boxOf(entry);
      if (box !== null) {
        primary = box;
        break;
      }
    }
  }

  const primaryWidthIn = primary.widthPt / 72;
  const primaryHeightIn = primary.heightPt / 72;
  const pptx = new PptxGenJS();
  pptx.author = 'TFlex';
  pptx.company = 'TFlex';
  pptx.title = 'TFlex export (pptx)';
  const layoutName = `TFLEX_PAGE_${Math.round(primary.widthPt)}x${Math.round(primary.heightPt)}`;
  pptx.defineLayout({ name: layoutName, width: primaryWidthIn, height: primaryHeightIn });
  pptx.layout = layoutName;

  const pagesWithoutText: number[] = [];
  const textOnlyPages: number[] = [];
  const differingPages: number[] = [];

  for (const page of input.pages) {
    const entry = entryByPage.get(page.pageIndex);
    const box = boxOf(entry);
    if (box !== null && !sameBox(box, primary)) differingPages.push(page.pageIndex);

    const text = page.text.trim();
    if (text.length === 0) pagesWithoutText.push(page.pageIndex);

    const slide = pptx.addSlide();
    const image = input.includeImages ? entry : undefined;
    if (image !== undefined) {
      slide.addImage({
        data: `image/png;base64,${Buffer.from(image.pngBuffer).toString('base64')}`,
        x: 0,
        y: 0,
        w: primaryWidthIn,
        h: primaryHeightIn,
      });
    } else {
      textOnlyPages.push(page.pageIndex);
      slide.addText(text.length > 0 ? page.text : noTextMarker(page.pageIndex), {
        x: 0.4,
        y: 0.4,
        w: Math.max(0.2, primaryWidthIn - 0.8),
        h: Math.max(0.2, primaryHeightIn - 0.8),
        fontSize: 14,
        valign: 'top',
        wrap: true,
      });
    }
    // The page's own text is always recoverable from the notes.
    slide.addNotes(text.length > 0 ? page.text : noTextMarker(page.pageIndex));
  }

  const noteParts = [PPTX_FIDELITY_MARKER, ...EXPORT_FIDELITY_NOTES.pptx];
  noteParts.push(
    `Presentation size: ${Math.round(primary.widthPt)} x ${Math.round(primary.heightPt)} points (${primaryWidthIn.toFixed(4)} x ${primaryHeightIn.toFixed(4)} inches).`,
  );
  if (textOnlyPages.length > 0) {
    noteParts.push(`Text-only slides: ${textOnlyPages.join(', ')}.`);
  }
  if (pagesWithoutText.length > 0) {
    noteParts.push(`Pages with no extractable text: ${pagesWithoutText.join(', ')}.`);
  }
  if (differingPages.length > 0) {
    noteParts.push(
      `Pages whose box differs from the presentation size: ${differingPages.join(', ')}.`,
    );
  }
  pptx.subject = noteParts.join(' | ');

  const written = await pptx.write({ outputType: 'nodebuffer' });
  const bytes = written instanceof Uint8Array ? new Uint8Array(written) : new Uint8Array();
  return {
    format: 'pptx',
    bytes,
    fidelityNotes: EXPORT_FIDELITY_NOTES.pptx,
    pagesWithoutText,
  };
}

/**
 * The `export:pptx` service entry point. Extracts the document's own text
 * through the engine's existing `exportText` (never a second extractor), then
 * builds the deck. Awaited in main; never throws across IPC.
 */
export async function exportPptx(
  engine: ExportTextEngine,
  docId: string,
  payload: ExportPptxPayload = {},
): Promise<Result<ExportBuild, ExportErrorCode>> {
  const extracted = await engine.exportText(docId);
  if (!extracted.ok) {
    return err('engine-error', extracted.error.message);
  }
  const build = await buildPptx({
    pages: extracted.value,
    includeImages: payload.includeImages ?? true,
    entries: payload.entries ?? [],
  });
  return ok(build);
}
