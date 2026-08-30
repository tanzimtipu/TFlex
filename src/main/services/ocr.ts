/**
 * Phase 11 — OCR engine service.
 *
 * Wraps tesseract.js (WASM, runs in a Node worker_thread) so the heavy
 * recognition work stays off the Electron main thread. Language traineddata
 * is loaded from a LOCAL directory (`assets/tessdata/`, wired by the caller)
 * so the product is fully offline — no CDN fetch, ever.
 *
 * The service owns a single reusable tesseract worker. `recognize` lazily
 * creates it on first use and re-initialises it when the requested language
 * changes. `terminate` disposes it (call on app quit / when idle for long).
 *
 * What this service does NOT do: rasterise PDF pages. pdf-lib has no
 * rasteriser and running pdf.js in the main process crashed the native
 * canvas backend during feasibility testing (heap corruption). The renderer
 * rasterises pages with its existing PDF.js DOM-canvas path and sends the
 * PNG bytes in. See the Phase 11 report.
 */
import { createWorker } from 'tesseract.js';

/** Minimal shape of a tesseract word we consume. Defined locally so the
 *  engine does not couple to tesseract.js's full type surface. */
export interface RawOcrWord {
  text: string;
  confidence: number; // 0..100
  bbox: { x0: number; y0: number; x1: number; y1: number }; // image pixels, top-left origin
}

/** Words below this tesseract confidence (0..100) are reported as suspects
 *  by `engine.ocrSuspects`. 60 is the conventional tesseract "low" cut. */
export const SUSPECT_CONFIDENCE_THRESHOLD = 60;

interface MinimalTesseractWorker {
  reinitialize(langs: string | string[]): Promise<unknown>;
  recognize(
    image: Uint8Array | ArrayBuffer,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{
    data: {
      text: string;
      confidence: number;
      blocks?: Array<{
        paragraphs?: Array<{
          lines?: Array<{
            words?: Array<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }>;
    };
  }>;
  terminate(): Promise<unknown>;
}

export class OcrService {
  private worker: MinimalTesseractWorker | null = null;
  private currentLang: string | null = null;
  private initPromise: Promise<MinimalTesseractWorker> | null = null;

  constructor(private readonly tessdataDir: string) {}

  /**
   * Run tesseract on a PNG/JPEG image buffer and return the recognised
   * words with their pixel-space bounding boxes and confidences.
   * The worker is created (or re-initialised for a new language) lazily.
   */
  async recognize(pngBytes: Uint8Array, language: string): Promise<RawOcrWord[]> {
    const worker = await this.getWorker(language);
    const result = await worker.recognize(pngBytes, {}, { text: true, blocks: true });
    return extractWords(result.data);
  }

  /** Dispose the worker. Safe to call multiple times. */
  async terminate(): Promise<void> {
    if (this.worker !== null) {
      try {
        await this.worker.terminate();
      } catch {
        // Best-effort teardown.
      }
      this.worker = null;
      this.currentLang = null;
      this.initPromise = null;
    }
  }

  private getWorker(language: string): Promise<MinimalTesseractWorker> {
    if (this.worker !== null && this.currentLang === language) {
      return Promise.resolve(this.worker);
    }
    // Already-initialising or first creation: chain on the in-flight init.
    if (this.initPromise !== null) {
      return this.initPromise.then((w) => {
        if (this.currentLang === language) return w;
        return this.reinitializeFor(w, language);
      });
    }
    this.initPromise = this.createWorkerFor(language);
    return this.initPromise;
  }

  private async createWorkerFor(language: string): Promise<MinimalTesseractWorker> {
    const worker = (await createWorker(language, 1, {
      langPath: this.tessdataDir,
      cacheMethod: 'none',
      gzip: true,
      logger: () => {
        // Suppress tesseract progress noise.
      },
    })) as unknown as MinimalTesseractWorker;
    this.worker = worker;
    this.currentLang = language;
    this.initPromise = null;
    return worker;
  }

  private async reinitializeFor(
    worker: MinimalTesseractWorker,
    language: string,
  ): Promise<MinimalTesseractWorker> {
    try {
      await worker.reinitialize(language);
      this.currentLang = language;
      return worker;
    } catch {
      // If reinit fails, fall back to a fresh worker.
      await this.terminate();
      return this.createWorkerFor(language);
    }
  }
}

/** Walk the tesseract blocks -> paragraphs -> lines -> words tree and
 *  flatten to a word list. Empty/whitespace words are dropped. */
function extractWords(data: {
  text: string;
  confidence: number;
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: RawOcrWord[] }> }> }>;
}): RawOcrWord[] {
  const words: RawOcrWord[] = [];
  const blocks = data.blocks;
  if (blocks) {
    for (const block of blocks) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const word of line.words ?? []) {
            const text = (word.text ?? '').trim();
            if (text.length === 0) continue;
            words.push({
              text,
              confidence: typeof word.confidence === 'number' ? word.confidence : 0,
              bbox: word.bbox,
            });
          }
        }
      }
    }
  }
  return words;
}

/** Pure helper: keep only the words whose confidence is below `threshold`.
 *  Exported so the suspect-filtering semantics are unit-testable without
 *  running tesseract (the engine calls this in `ocrSuspects`). */
export function selectLowConfidence<T extends { confidence: number }>(
  words: readonly T[],
  threshold: number = SUSPECT_CONFIDENCE_THRESHOLD,
): T[] {
  const out: T[] = [];
  for (const w of words) {
    if (typeof w.confidence === 'number' && w.confidence < threshold) {
      out.push(w);
    }
  }
  return out;
}
