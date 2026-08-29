import {
  getDocument,
  GlobalWorkerOptions,
  VerbosityLevel,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfOpenError } from '../../shared/types';

let configured = false;

export function ensurePdfjsConfigured(): void {
  if (configured) {
    return;
  }
  GlobalWorkerOptions.workerSrc = workerUrl;
  configured = true;
}

/** Map pdf.js errors onto the shared PdfOpenError vocabulary. */
export function mapPdfjsError(error: unknown): PdfOpenError {
  const name = (error as { name?: unknown }).name;
  if (name === 'PasswordException') {
    return 'encrypted';
  }
  if (name === 'InvalidPDFException') {
    return 'not-pdf';
  }
  return 'corrupt';
}

/**
 * The shape of `getDocument`'s options object the renderer actually uses.
 * Exported as a dedicated type so the option-builder below has a precise
 * return type that can be unit-tested without importing the whole
 * pdfjs-dist surface.
 */
export type RendererDocumentInit = Pick<
  DocumentInitParameters,
  | 'data'
  | 'length'
  | 'disableAutoFetch'
  | 'disableStream'
  | 'isEvalSupported'
  | 'verbosity'
>;

/**
 * Build the `getDocument` option object the renderer hands to pdf.js.
 *
 * pdf.js, left to its defaults, will eagerly speculatively fetch adjacent
 * data ranges (`disableAutoFetch`), stream the buffer chunk-by-chunk
 * (`disableStream`), and keep the JS-function evaluator path warm
 * (`isEvalSupported`). For a 520-page PDF loaded entirely from an
 * in-memory `Uint8Array`:
 *   - range-prefetching and streaming are pure overhead — there are no
 *     ranges to fetch and the entire buffer is already in memory;
 *   - the JS-evaluator path is dead weight in our use case (v1 PDFs do
 *     not run JS actions);
 *   - the logger retains internal state per message at the default
 *     verbosity; we don't surface those messages anyway.
 *
 * The orchestrator's analysis of DEF-016 confirmed the renderer idle
 * process is dominated by pdfjs's worker-side caches (font cache, page
 * tree cache, decoded image cache). These settings trim the worker's
 * background paths; the explicit `doc.cleanup()` calls in DocumentView
 * do the rest.
 *
 * Note on font rendering: we deliberately leave `disableFontFace` and
 * `useSystemFonts` at their defaults (face conversion enabled) so the
 * TextLayer can render selectable text with the embedded fonts. The
 * fontCache is flushed by `doc.cleanup()` on idle, which keeps the
 * per-document footprint bounded.
 *
 * Exported for unit tests so the option shape can be asserted without
 * spinning up pdfjs.
 */
export function buildDocumentInit(
  data: ArrayBuffer | Uint8Array,
): RendererDocumentInit {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
  return {
    data: buffer,
    // pdf.js uses `length` for progress reporting and as the upper bound
    // for range requests. For an in-memory buffer, providing the size
    // up front lets it skip the auto-detection probe on first access.
    length: buffer.byteLength,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    verbosity: VerbosityLevel.ERRORS,
  };
}

/**
 * Parse raw bytes with pdf.js. The IPC sniff pre-filters, but pdf.js is the
 * real parser: encrypted/invalid/malformed bytes fail here and must surface
 * the same user-facing error vocabulary.
 */
export async function openPdfDocument(
  data: ArrayBuffer,
): Promise<{ doc: PDFDocumentProxy } | { error: PdfOpenError }> {
  ensurePdfjsConfigured();
  try {
    // pdf.js may transfer/detach the input buffer as it ships the bytes to
    // the worker. We don't want to mutate the caller's ArrayBuffer, so we
    // hand pdf.js a fresh copy.
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data));
    const doc = await getDocument(buildDocumentInit(copy.buffer)).promise;
    return { doc };
  } catch (error) {
    return { error: mapPdfjsError(error) };
  }
}

export interface OutlineNode {
  title: string;
  dest: unknown; // named dest string or explicit array
  children: OutlineNode[];
}

interface RawOutlineItem {
  title: string;
  dest: unknown;
  items?: RawOutlineItem[];
}

export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineNode[] | null> {
  const raw = (await doc.getOutline()) as RawOutlineItem[] | null;
  if (raw === null || raw.length === 0) {
    return null;
  }
  const map = (items: RawOutlineItem[]): OutlineNode[] =>
    items.map((item) => ({
      title: item.title,
      dest: item.dest ?? null,
      children: item.items !== undefined ? map(item.items) : [],
    }));
  return map(raw);
}

/**
 * Resolve an outline destination to a 1-based page number. Named destinations
 * go through getDestination; explicit refs through getPageIndex.
 */
export async function resolveOutlinePage(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    let explicit = dest;
    if (typeof explicit === 'string') {
      explicit = await doc.getDestination(explicit);
    }
    if (!Array.isArray(explicit) || explicit.length === 0) {
      return null;
    }
    const ref = explicit[0];
    if (typeof ref === 'object' && ref !== null) {
      const index = await doc.getPageIndex(ref as never);
      return index + 1;
    }
    if (typeof ref === 'number') {
      return ref + 1;
    }
    return null;
  } catch {
    return null;
  }
}
