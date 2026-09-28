import {
  getDocument,
  GlobalWorkerOptions,
  VerbosityLevel,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfOpenError } from '../../shared/types';
import { passwordKindFromPdfjsError, type PasswordPromptKind } from '../security/passwordPrompt';

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
 * Detect pdf.js's "Invalid page request" rejection — thrown by
 * `doc.getPage(pageNumber)` when the 1-based page number is outside the
 * proxy's current `numPages`.
 *
 * DEF-121 — during a post-op proxy refresh the engine's pageOrder (new
 * page count) is committed BEFORE the renderer's pdf.js `doc` proxy is
 * rebuilt against the post-op bytes. A mid-document insert therefore
 * briefly asks for a source page the still-old proxy does not have
 * (inserting a blank at the front of a 34-page doc: the new pageOrder
 * references source page 35, `doc.numPages` is still 34). That is a
 * stale index, not corruption: `refreshDocProxyFor` swaps the doc
 * identity immediately after and every doc-bound render effect re-runs
 * with the full page count, so render paths tolerate the stale attempt
 * (drop it, keep the placeholder) instead of surfacing an unhandled
 * rejection. Any other getPage failure is not this condition and must
 * keep failing loudly.
 */
export function isInvalidPageRequest(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('invalid page request')
  );
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
  | 'password'
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
  password?: string,
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
    // Phase 52 — an empty string (the no-password case) is falsy and pdf.js
    // ignores it, so a document whose user password is empty still opens
    // WITHOUT a prompt (pdf.js tries the empty password first).
    password: password ?? '',
  };
}

/**
 * Parse raw bytes with pdf.js. The IPC sniff pre-filters, but pdf.js is the
 * real parser: encrypted/invalid/malformed bytes fail here and must surface
 * the same user-facing error vocabulary.
 *
 * Phase 52 — an encrypted document is not an error the caller can only
 * toast. `openPdfDocument` classifies pdf.js's `PasswordException` into the
 * shared prompt vocabulary (`need` / `incorrect`) and returns it in the
 * `password` slot, so the renderer can prompt and retry. A supplied
 * `password` that opens the document resolves normally; a document whose
 * user password is EMPTY opens with NO prompt because pdf.js tries the
 * empty password first.
 *
 * DEF-208 — a PDF whose page tree is broken can still resolve from
 * `getDocument` with ZERO pages (the sniff path in main only checks the
 * `%PDF-` header, so the bytes reach this function). A zero-page document
 * is not openable: every viewer path (thumbnails, page slots, the engine
 * pageOrder) derives from `numPages`, so we reject it here with the
 * shared 'corrupt' code instead of letting an empty shell of a tab
 * through.
 */
export async function openPdfDocument(
  data: ArrayBuffer,
  password?: string,
): Promise<
  | { doc: PDFDocumentProxy }
  | { error: PdfOpenError }
  | { password: PasswordPromptKind }
> {
  ensurePdfjsConfigured();
  try {
    // pdf.js may transfer/detach the input buffer as it ships the bytes to
    // the worker. We don't want to mutate the caller's ArrayBuffer, so we
    // hand pdf.js a fresh copy.
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data));
    const doc = await getDocument(buildDocumentInit(copy.buffer, password)).promise;
    if (doc.numPages === 0) {
      void doc.destroy().catch(() => undefined);
      return { error: 'corrupt' };
    }
    return { doc };
  } catch (error) {
    const passwordKind = passwordKindFromPdfjsError(error);
    if (passwordKind !== null) {
      return { password: passwordKind };
    }
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
