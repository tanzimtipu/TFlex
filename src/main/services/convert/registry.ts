import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import type {
  ConvertFidelity,
  ConvertFormatId,
  ConvertResult,
} from '../../../shared/convert';
import { CONVERT_LIMITS, type ResolvedConvertOptions } from './limits';

/**
 * Phase 53 — the adapter registry (ruling 2).
 *
 * Adding a format is adding an adapter module, never editing the service. A
 * module is imported ONLY when its format is used (`await import()` inside a
 * loader, never at this module's top level), so an unused format costs nothing
 * at cold start. Resolution is content-aware: the extension picks a candidate,
 * the candidate's `sniff` confirms it, and a mismatch falls through to a
 * content pass over every registered adapter.
 */

export interface ConvertAdapterContext {
  path: string;
  options: ResolvedConvertOptions;
  /** First `CONVERT_LIMITS.sniffHeadBytes` bytes of the file. */
  head: Buffer;
  signal?: AbortSignal;
  onProgress?: (phase: string, ratio?: number) => void;
}

export interface ConversionAdapter {
  id: ConvertFormatId;
  label: string;
  extensions: string[];
  capabilities: { canImport: boolean; canExport: boolean };
  /** The fidelity this adapter declares for its output (ruling 3). */
  fidelity: ConvertFidelity;
  /**
   * Phase 53 criterion 9 — resolution precedence. `'specific'` adapters win
   * over `'generic'` ones whether the match came from the extension or the
   * content pass. The text adapter is `'generic'`: a `.txt`-named file whose
   * bytes are Markdown must not be captured by it just because the extension
   * matched. Markdown and HTML are `'specific'`.
   */
  specificity: 'generic' | 'specific';
  /** Byte ceiling for this format; the service returns `too-large` above it. */
  maxBytes?: number;
  /**
   * Phase 54 — true when this adapter's output can be composed with others
   * into ONE document by `toDocumentMany`. Adapters that cannot (the Phase 53
   * text-family adapters) are rejected with `unsupported-format` by the
   * multi-file entry rather than producing a partial document.
   */
  supportsMultiFile?: boolean;
  /** True when the head (and path) look like this format. */
  sniff(path: string, head: Buffer): boolean;
  convert(ctx: ConvertAdapterContext): Promise<ConvertResult>;
}

export type AdapterLoader = () => Promise<ConversionAdapter>;

export interface AdapterRegistration {
  id: ConvertFormatId;
  /** Extensions (lower-case, leading dot) used for O(1) extension routing
   *  without loading the module. Mirrors the adapter's own list. */
  extensions: string[];
  load: AdapterLoader;
}

export interface ResolvedAdapter {
  adapter: ConversionAdapter;
  /** true when the extension candidate was confirmed; false when resolution
   *  came from the content-sniff fall-through pass. */
  byExtension: boolean;
}

export class ConvertRegistry {
  private readonly registrations = new Map<ConvertFormatId, AdapterRegistration>();
  private readonly byExtension = new Map<string, ConvertFormatId>();
  private readonly cache = new Map<ConvertFormatId, ConversionAdapter>();

  register(registration: AdapterRegistration): void {
    this.registrations.set(registration.id, registration);
    for (const ext of registration.extensions) {
      this.byExtension.set(ext.toLowerCase(), registration.id);
    }
  }

  /** Import (and cache) one adapter module on demand. */
  async load(id: ConvertFormatId): Promise<ConversionAdapter | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const registration = this.registrations.get(id);
    if (!registration) return null;
    const adapter = await registration.load();
    this.cache.set(id, adapter);
    return adapter;
  }

  /** Load every registered adapter; used only by the content-sniff pass. */
  async all(): Promise<ConversionAdapter[]> {
    const out: ConversionAdapter[] = [];
    for (const id of this.registrations.keys()) {
      const adapter = await this.load(id);
      if (adapter !== null) out.push(adapter);
    }
    return out;
  }

  ids(): ConvertFormatId[] {
    return [...this.registrations.keys()];
  }

  /** Phase 53 feature I - the registrations as `{ id, extensions }`, used by the
   *  Open dialog to derive its advertised extension set from the one source of
   *  truth instead of a second hardcoded list. No adapter module is loaded. */
  listRegistrations(): Array<{ id: ConvertFormatId; extensions: string[] }> {
    return [...this.registrations.values()].map((registration) => ({
      id: registration.id,
      extensions: [...registration.extensions],
    }));
  }

  /** Resolution precedence (Phase 53 criterion 9), exactly:
   *    1. the extension candidate when its `sniff` passes and it is `specific`;
   *    2. otherwise a content pass over every `specific` adapter;
   *    3. otherwise the extension candidate when it is `generic`;
   *    4. otherwise a content pass over every `generic` adapter;
   *    5. otherwise null (the caller reports `unsupported-format`).
   *  A `.txt`-named Markdown file therefore routes to Markdown (step 2), not
   *  to the generic text adapter whose extension matched (step 3). */
  async resolve(path: string, head: Buffer): Promise<ResolvedAdapter | null> {
    const ext = extname(path).toLowerCase();
    const candidateId = this.byExtension.get(ext);
    const candidate =
      candidateId === undefined ? null : await this.load(candidateId);
    const candidatePasses = candidate !== null && candidate.sniff(path, head);

    if (candidatePasses && candidate.specificity === 'specific') {
      return { adapter: candidate, byExtension: true };
    }

    const all = await this.all();
    for (const adapter of all) {
      if (adapter.specificity === 'specific' && adapter.sniff(path, head)) {
        return { adapter, byExtension: false };
      }
    }

    if (candidatePasses && candidate.specificity === 'generic') {
      return { adapter: candidate, byExtension: true };
    }

    for (const adapter of all) {
      if (adapter.specificity === 'generic' && adapter.sniff(path, head)) {
        return { adapter, byExtension: false };
      }
    }

    return null;
  }
}

/** Read only the first `CONVERT_LIMITS.sniffHeadBytes` bytes for sniffing. */
export async function readSniffHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(CONVERT_LIMITS.sniffHeadBytes);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The shipped registry: `.txt`, `.md`/`.markdown` and
 *  `.html`/`.htm`/`.xhtml` after chunk B. Later chunks register their loaders
 *  here without touching the service. */
export function createDefaultRegistry(): ConvertRegistry {
  const registry = new ConvertRegistry();
  registry.register({
    id: 'text',
    extensions: ['.txt'],
    load: () => import('./adapters/text').then((m) => m.textAdapter),
  });
  registry.register({
    id: 'markdown',
    extensions: ['.md', '.markdown'],
    load: () => import('./adapters/markdown').then((m) => m.markdownAdapter),
  });
  registry.register({
    id: 'html',
    extensions: ['.html', '.htm', '.xhtml'],
    load: () => import('./adapters/html').then((m) => m.htmlAdapter),
  });
  registry.register({
    id: 'csv',
    extensions: ['.csv'],
    load: () => import('./adapters/csv').then((m) => m.csvAdapter),
  });
  registry.register({
    id: 'rtf',
    extensions: ['.rtf'],
    load: () => import('./adapters/rtf').then((m) => m.rtfAdapter),
  });
  // Phase 54 feature A - raster images (PNG + JPEG share one module).
  registry.register({
    id: 'png',
    extensions: ['.png'],
    load: () => import('./adapters/images').then((m) => m.pngAdapter),
  });
  registry.register({
    id: 'jpeg',
    extensions: ['.jpg', '.jpeg'],
    load: () => import('./adapters/images').then((m) => m.jpegAdapter),
  });
  // Phase 54 feature B - multi-page TIFF.
  registry.register({
    id: 'tiff',
    extensions: ['.tiff', '.tif'],
    load: () => import('./adapters/tiff').then((m) => m.tiffAdapter),
  });
  // Phase 54 feature C - SVG (native vector with an engine-rendered fallback).
  registry.register({
    id: 'svg',
    extensions: ['.svg'],
    load: () => import('./adapters/svg').then((m) => m.svgAdapter),
  });
  // Phase 55 feature B - spreadsheets. One SheetJS module serves all three
  // containers; each format id is registered with its own extensions and its
  // own content sniff (an `.xlsx` and an `.ods` are both ZIPs; `.xls` is CFB).
  // Registered BEFORE the ODF text adapter: an `.ods` and an `.odt` are both
  // ODF ZIPs, and the content pass must reach the spreadsheet sniff first so a
  // misnamed `.ods` is not captured by the ODT adapter.
  registry.register({
    id: 'xlsx',
    extensions: ['.xlsx'],
    load: () => import('./adapters/xlsx').then((m) => m.xlsxAdapter),
  });
  registry.register({
    id: 'xls',
    extensions: ['.xls'],
    load: () => import('./adapters/xlsx').then((m) => m.xlsAdapter),
  });
  registry.register({
    id: 'ods',
    extensions: ['.ods'],
    load: () => import('./adapters/xlsx').then((m) => m.odsAdapter),
  });
  // Phase 55 feature C - presentations. Registered BEFORE the OOXML Word
 // adapter: a `.pptx` and a `.docx` are both ZIPs carrying `[Content_Types].xml`,
 // so the content pass must reach the PPTX presentation marker first. Legacy
 // binary `.ppt` shares the extracted CFB walker with the `.doc` adapter.
  registry.register({
    id: 'pptx',
    extensions: ['.pptx'],
    load: () => import('./adapters/pptx').then((m) => m.pptxAdapter),
  });
  registry.register({
    id: 'ppt',
    extensions: ['.ppt'],
    load: () => import('./adapters/pptx').then((m) => m.pptAdapter),
  });
  // Phase 55 feature A - Word and OpenDocument text import (mammoth / ODF XML
  // into the shared HTML intermediate). Legacy binary `.doc` is a separate
  // CFB-backed text-only degraded adapter.
  registry.register({
    id: 'docx',
    extensions: ['.docx'],
    load: () => import('./adapters/docx').then((m) => m.docxAdapter),
  });
  registry.register({
    id: 'odt',
    extensions: ['.odt'],
    load: () => import('./adapters/odt').then((m) => m.odtAdapter),
  });
  registry.register({
    id: 'doc',
    extensions: ['.doc'],
    load: () => import('./adapters/legacy-doc').then((m) => m.legacyDocAdapter),
  });
  // Phase 56 feature A - EPUB (a ZIP container whose `mimetype` entry names
  // the package type). Registered by content as well as extension, so a
  // misnamed `.epub` still routes here through the content pass.
  registry.register({
    id: 'epub',
    extensions: ['.epub'],
    load: () => import('./adapters/epub').then((m) => m.epubAdapter),
  });
  // Phase 56 feature B - Mobipocket (`.mobi`/`.azw`) and KF8 (`.azw3`). All
  // three extensions map to the one `mobi` format id; the sniff is the PalmDB
  // `BOOK`/`MOBI` header (or the extension). Registered after EPUB so a
  // misnamed office/EPUB ZIP is still claimed by its own content sniff first.
  registry.register({
    id: 'mobi',
    extensions: ['.mobi', '.azw', '.azw3'],
    load: () => import('./adapters/mobi').then((m) => m.mobiAdapter),
  });
  // Phase 56 feature C - comic archives. A `.cbz` is a ZIP of images and a
  // `.cbt` a TAR of images. Registered AFTER the EPUB/ODF/OOXML adapters so a
  // misnamed office/EPUB ZIP is still claimed by its own content sniff first.
  registry.register({
    id: 'cbz',
    extensions: ['.cbz'],
    load: () => import('./adapters/comic').then((m) => m.cbzAdapter),
  });
  registry.register({
    id: 'cbt',
    extensions: ['.cbt'],
    load: () => import('./adapters/comic').then((m) => m.cbtAdapter),
  });
  return registry;
}
