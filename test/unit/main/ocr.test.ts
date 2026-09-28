import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import {
  OcrService,
  selectLowConfidence,
  type RawOcrWord,
  SUSPECT_CONFIDENCE_THRESHOLD,
} from '../../../src/main/services/ocr';

/** Resolve the bundled tessdata dir by walking up from this test file until
 *  `assets/tessdata/eng.traineddata.gz` is found. Robust against test-file
 *  relocation. */
function resolveTessdata(): string {
  let dir = fileURLToPath(new URL('./', import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'assets', 'tessdata', 'eng.traineddata.gz');
    if (existsSync(candidate)) return join(dir, 'assets', 'tessdata');
    dir = join(dir, '..');
  }
  throw new Error('Could not locate assets/tessdata/eng.traineddata.gz from ' + fileURLToPath(import.meta.url));
}

const TESSDATA = resolveTessdata();

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-ocr-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Render a known phrase to a PNG with the bundled node canvas. This is the
 *  synthetic "scanned page" we feed tesseract. */
function makeTextPng(text: string, width = 900, height = 240): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = '84px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 30, height / 2);
  return new Uint8Array(canvas.toBuffer('image/png'));
}

/** Build a single-page "scanned" PDF whose page IS the given image (embedded
 *  full-bleed) so it has no extractable text layer before OCR. Page size in
 *  points equals the image size in pixels at 72 DPI. */
async function makeScannedPdf(png: Uint8Array): Promise<Uint8Array> {
  const img = await loadImage(png);
  const w = img.width;
  const h = img.height;
  const doc = await PDFDocument.create();
  const page = doc.addPage([w, h]);
  const embedded = await doc.embedPng(png);
  page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  return doc.save();
}

describe('selectLowConfidence (pure suspect filter)', () => {
  it('keeps words below the threshold and drops the rest', () => {
    const words = [
      { text: 'a', confidence: 30 },
      { text: 'b', confidence: 59 },
      { text: 'c', confidence: 60 },
      { text: 'd', confidence: 95 },
    ];
    const low = selectLowConfidence(words);
    expect(low.map((w) => w.text)).toEqual(['a', 'b']);
  });

  it('uses the default threshold of 60', () => {
    expect(SUSPECT_CONFIDENCE_THRESHOLD).toBe(60);
    expect(selectLowConfidence([{ confidence: 60 }]).length).toBe(0);
    expect(selectLowConfidence([{ confidence: 59.9 }]).length).toBe(1);
  });

  it('honours a custom threshold', () => {
    const words = [{ confidence: 70 }, { confidence: 90 }];
    expect(selectLowConfidence(words, 80).length).toBe(1);
  });

  it('ignores non-numeric confidence', () => {
    const words = [
      { text: 'x', confidence: 10 },
      { text: 'y', confidence: undefined as unknown as number },
    ];
    expect(selectLowConfidence(words).map((w) => w.text)).toEqual(['x']);
  });
});

describe('EngineService.ocrRecognize — validation (no tesseract)', () => {
  async function onePageDoc(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
  }

  it('refuses when no OCR service is wired', async () => {
    const engine = new EngineService(); // ocr = null
    const bytes = await onePageDoc();
    const loaded = await engine.loadDocumentBytes('d', bytes);
    expect(loaded.ok).toBe(true);
    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: new Uint8Array([1]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('engine-error');
  });

  it('rejects an unsupported language before running tesseract', async () => {
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    const bytes = await onePageDoc();
    await engine.loadDocumentBytes('d', bytes);
    const res = await engine.ocrRecognize('d', {
      language: 'klingon',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: new Uint8Array([1]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('engine-error');
  });

  it('rejects downsample outside 72..600', async () => {
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    const bytes = await onePageDoc();
    await engine.loadDocumentBytes('d', bytes);
    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 700,
      pageImages: [{ page: 1, pngBytes: new Uint8Array([1]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('engine-error');
  });

  it('rejects empty pageImages with empty-range', async () => {
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    const bytes = await onePageDoc();
    await engine.loadDocumentBytes('d', bytes);
    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 300,
      pageImages: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('empty-range');
  });

  it('accumulates an out-of-range page as a failure (DEF-051)', async () => {
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    const bytes = await onePageDoc();
    await engine.loadDocumentBytes('d', bytes);
    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 9, pngBytes: new Uint8Array([1]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    // A single failing page is now the "all pages failed" path: the engine
    // returns one final Result (never a hanging/aborted run) and lists the
    // failure in the message. See DEF-051.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('engine-error');
      expect(res.error.message).toContain('page 9');
    }
  });

  it('ocrSuspects errors when no OCR has been run', async () => {
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    const bytes = await onePageDoc();
    await engine.loadDocumentBytes('d', bytes);
    const res = await engine.ocrSuspects('d');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('engine-error');
  });
});

describe('EngineService.ocrRecognize — per-page failure accumulation (DEF-051)', () => {
  /** A stand-in for OcrService that returns synthetic words for "good" pages
   *  and throws for pages listed in `failPages`. Lets us exercise the
   *  accumulate-failures path deterministically without tesseract. */
  function fakeOcr(failPages: Set<number>): OcrService {
    return {
      recognize(pngBytes: Uint8Array, _language: string): Promise<RawOcrWord[]> {
        // The page number is encoded into the first byte of the test pngBytes
        // (see makePageImage below) so the fake can decide per page.
        const page = pngBytes[0];
        if (failPages.has(page)) {
          return Promise.reject(new Error(`tesseract-boom page ${page}`));
        }
        return Promise.resolve([
          {
            text: 'HELLO',
            confidence: 90,
            bbox: { x0: 10, y0: 10, x1: 200, y1: 80 },
          },
        ]);
      },
    } as unknown as OcrService;
  }

  /** Build a multi-page blank PDF and matching page-images. The first byte of
   *  each image's pngBytes encodes the 1-based page number the fake reads. */
  async function multiPageSetup(numPages: number): Promise<{
    pdfBytes: Uint8Array;
    pageImages: { page: number; pngBytes: Uint8Array; dpi: number; widthPx: number; heightPx: number }[];
  }> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < numPages; i++) doc.addPage([612, 792]);
    const pdfBytes = await doc.save();
    const pageImages = [];
    for (let p = 1; p <= numPages; p++) {
      pageImages.push({
        page: p,
        pngBytes: new Uint8Array([p, 1, 2, 3]), // [0] = page number for the fake
        dpi: 72,
        widthPx: 612,
        heightPx: 792,
      });
    }
    return { pdfBytes, pageImages };
  }

  it('continues past a failing page and reports partial success with ocrFailures', async () => {
    const ocr = fakeOcr(new Set([2])); // page 2 blows up
    const engine = new EngineService(ocr);
    const { pdfBytes, pageImages } = await multiPageSetup(3);
    await engine.loadDocumentBytes('d', pdfBytes);

    const progress: number[] = [];
    const res = await engine.ocrRecognize(
      'd',
      { language: 'eng', downsample: 72, pageImages },
      (p) => { progress.push(p.page); },
    );

    // Partial success: the run completes with a final Result (no abort), the
    // two good pages got their text layer, page 2 is listed as a failure.
    expect(res.ok).toBe(true);
    if (res.ok) {
      const failures = (res.value as unknown as { ocrFailures?: { page: number; message: string }[] }).ocrFailures;
      expect(Array.isArray(failures)).toBe(true);
      expect(failures!.length).toBe(1);
      expect(failures![0].page).toBe(2);
      expect(failures![0].message).toContain('tesseract-boom page 2');
    }

    // The good pages' text layer survives a save + round-trip: two pages each
    // wrote one <HELLO> Tj word; page 2 wrote none.
    const out = join(dir, 'partial-out.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    const words = decodeTjWords(new Uint8Array(await (await import('node:fs/promises')).readFile(out)));
    expect(words.filter((w) => w === 'HELLO').length).toBe(2);

    // Progress fired for the good pages (recognizing + writing); page 2 fired
    // only 'recognizing' (it threw before 'writing'). The exact ordering is
    // not asserted, only that all three pages started recognizing.
    expect(progress).toContain(1);
    expect(progress).toContain(2);
    expect(progress).toContain(3);

    // ocrSuspects reflects only the good pages' words (no throw page).
    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(true);
    if (suspects.ok) {
      for (const s of suspects.value) expect(s.page).not.toBe(2);
    }
  });

  it('returns one final err listing every page when ALL pages fail', async () => {
    const ocr = fakeOcr(new Set([1, 2])); // every page blows up
    const engine = new EngineService(ocr);
    const { pdfBytes, pageImages } = await multiPageSetup(2);
    await engine.loadDocumentBytes('d', pdfBytes);

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('engine-error');
      expect(res.error.message).toContain('page 1');
      expect(res.error.message).toContain('page 2');
      expect(res.error.message).toContain('all 2 page(s)');
    }

    // No text layer was written: the saved PDF has zero Tj words, and the doc
    // was rolled back so no OCR run is recorded (ocrSuspects still errors).
    const out = join(dir, 'allfail-out.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    expect(decodeTjWords(new Uint8Array(await (await import('node:fs/promises')).readFile(out)))).toEqual([]);

    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(false);
    if (!suspects.ok) expect(suspects.error.code).toBe('engine-error');
  });

  it('a fully successful run attaches no ocrFailures (backward-compatible)', async () => {
    const ocr = fakeOcr(new Set()); // no failures
    const engine = new EngineService(ocr);
    const { pdfBytes, pageImages } = await multiPageSetup(2);
    await engine.loadDocumentBytes('d', pdfBytes);

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const failures = (res.value as unknown as { ocrFailures?: unknown }).ocrFailures;
      expect(failures).toBeUndefined();
    }
  });
});

describe('EngineService.ocrRecognize — integration (tesseract, offline)', () => {
  // Tesseract worker init + recognition can take a few seconds on a cold
  // worker; allow generous headroom.
  const SLOW = 90000;

  /** Round-trip a doc through the engine: OCR + saveAs to a temp file, then
   *  decode the invisible `<hex> Tj` words from the saved bytes. This verifies
   *  the searchable text layer is written and survives serialize/copyPages
   *  (the engine's Phase-9 `exportText` extractor does not handle image-bearing
   *  pages, so we verify at the byte level instead). */
  async function ocrAndSaveWords(
    engine: EngineService,
    docId: string,
    png: Uint8Array,
  ): Promise<string[]> {
    const { width, height } = await pngDims(png);
    const res = await engine.ocrRecognize(docId, {
      language: 'eng',
      downsample: 72,
      pageImages: [{ page: 1, pngBytes: png, dpi: 72, widthPx: width, heightPx: height }],
    });
    if (!res.ok) throw new Error('ocrRecognize failed: ' + res.error.message);
    const out = join(dir, `${docId}-out.pdf`);
    const saved = await engine.saveAs(docId, out);
    if (!saved.ok) throw new Error('saveAs failed: ' + saved.error.message);
    const fileBytes = new Uint8Array(await (await import('node:fs/promises')).readFile(out));
    return decodeTjWords(fileBytes);
  }

  it('builds a searchable invisible text layer on a scanned page', async () => {
    const png = makeTextPng('TFLEX OCR WORKS');
    const pdfBytes = await makeScannedPdf(png);

    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);

    // Before OCR: the scanned page has no text layer (no Tj words).
    expect(decodeTjWords(pdfBytes)).toEqual([]);

    expect(await engine.loadDocumentBytes('d', pdfBytes)).toMatchObject({ ok: true });

    const progress: string[] = [];
    const dims = await pngDims(png);
    const res = await engine.ocrRecognize(
      'd',
      {
        language: 'eng',
        downsample: 72,
        pageImages: [{ page: 1, pngBytes: png, dpi: 72, widthPx: dims.width, heightPx: dims.height }],
      },
      (p) => { progress.push(p.phase); },
    );
    expect(res.ok).toBe(true);
    // Progress fired for both phases on the single page.
    expect(progress).toContain('recognizing');
    expect(progress).toContain('writing');

    // After OCR + save: the saved file contains a searchable text layer with
    // the recognized words (tesseract may misread a glyph, so accept any of
    // the expected candidates case-insensitively).
    const out = join(dir, 'd-out.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    const words = decodeTjWords(new Uint8Array(await (await import('node:fs/promises')).readFile(out)));
    expect(words.length).toBeGreaterThan(0);
    const lower = words.map((w) => w.toLowerCase());
    expect(lower).toEqual(
      expect.arrayContaining([expect.stringMatching(/^(tflex|telex|ocr|works)$/)]),
    );

    await ocr.terminate();
  }, SLOW);

  it('reports structurally valid suspects from a real tesseract run and survives undo', async () => {
    // Environment-independent by design: tesseract's confidence for a given
    // rasterisation depends on the runner's system font, so this integration
    // test asserts only STRUCTURAL properties of the suspects result (shape,
    // the below-threshold invariant, undo). The mapping contract itself — a
    // below-threshold word becomes a suspect, an above-threshold one does not —
    // is proven deterministically by the controlled-recogniser tests below,
    // which do not touch tesseract or any font.
    const png = makeTextPng('TFLEX OCR WORKS');
    const pdfBytes = await makeScannedPdf(png);
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', pdfBytes);

    const { width, height } = await pngDims(png);
    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: [{ page: 1, pngBytes: png, dpi: 72, widthPx: width, heightPx: height }],
    });
    expect(res.ok).toBe(true);

    // ocrSuspects returns only words below the threshold (0..59). The COUNT is
    // not asserted here (font-dependent); every returned suspect must be
    // well-formed and below the threshold.
    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(true);
    if (suspects.ok) {
      expect(Array.isArray(suspects.value)).toBe(true);
      for (const s of suspects.value) {
        expect(s.confidence).toBeLessThan(SUSPECT_CONFIDENCE_THRESHOLD);
        expect(s.page).toBe(1);
        expect(s.rect.width).toBeGreaterThan(0);
        expect(s.rect.height).toBeGreaterThan(0);
        expect(s.word.length).toBeGreaterThan(0);
      }
    }

    // Undo reverts the OCR text layer: the saved file has no Tj words.
    const undo = await engine.undo('d');
    expect(undo.ok).toBe(true);
    const out = join(dir, 'd-undo.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    const afterUndo = decodeTjWords(new Uint8Array(await (await import('node:fs/promises')).readFile(out)));
    expect(afterUndo).toEqual([]);

    await ocr.terminate();
  }, SLOW);

  it('batch OCR across two docs is sequential and each gets its own text layer', async () => {
    const pngA = makeTextPng('BATCH OCR ONE');
    const pngB = makeTextPng('BATCH OCR TWO');
    const bytesA = await makeScannedPdf(pngA);
    const bytesB = await makeScannedPdf(pngB);
    const ocr = new OcrService(TESSDATA);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('a', bytesA);
    await engine.loadDocumentBytes('b', bytesB);
    // Fire both concurrently; the per-docId queues serialize them.
    const [wordsA, wordsB] = await Promise.all([
      ocrAndSaveWords(engine, 'a', pngA),
      ocrAndSaveWords(engine, 'b', pngB),
    ]);
    expect(wordsA.length).toBeGreaterThan(0);
    expect(wordsB.length).toBeGreaterThan(0);
    const la = wordsA.map((w) => w.toLowerCase());
    const lb = wordsB.map((w) => w.toLowerCase());
    expect(la.some((w) => /batch|ocr|one/.test(w))).toBe(true);
    expect(lb.some((w) => /batch|ocr|two/.test(w))).toBe(true);
    await ocr.terminate();
  }, SLOW);
});

describe('EngineService.ocrSuspects — controlled recognition (deterministic)', () => {
  // The suspects mapping is engine logic (selectLowConfidence over the words
  // stored by ocrRecognize), not tesseract logic. Driving it from a fixed
  // tesseract-shaped word list makes the below/above-threshold contract
  // deterministic on every machine: no system font, no rasteriser, no
  // tesseract confidence variance. This is the test that fails if the
  // suspects path ever stops reporting below-threshold words.
  /** A stand-in OcrService that always returns the given word list. */
  function fixedOcr(words: RawOcrWord[]): OcrService {
    return {
      recognize(): Promise<RawOcrWord[]> {
        return Promise.resolve(words);
      },
    } as unknown as OcrService;
  }

  async function onePageDoc(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
  }

  // dpi 72 keeps the pixel bboxes inside the 612x792 page; the fake recogniser
  // ignores the bytes, so any non-empty buffer is a valid "page image".
  const pageImage = {
    page: 1,
    pngBytes: new Uint8Array([1, 2, 3, 4]),
    dpi: 72,
    widthPx: 612,
    heightPx: 792,
  };

  it('reports below-threshold words as suspects and drops the rest', async () => {
    const ocr = fixedOcr([
      { text: 'TELEX', confidence: 42, bbox: { x0: 10, y0: 10, x1: 210, y1: 90 } },
      { text: 'CLEAR', confidence: 59, bbox: { x0: 220, y0: 10, x1: 420, y1: 90 } },
      { text: 'EXACT', confidence: 60, bbox: { x0: 10, y0: 110, x1: 210, y1: 190 } },
      { text: 'SHARP', confidence: 95, bbox: { x0: 220, y0: 110, x1: 420, y1: 190 } },
    ]);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', await onePageDoc());

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: [pageImage],
    });
    expect(res.ok).toBe(true);

    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(true);
    if (suspects.ok) {
      // Non-vacuous: the two words below 60 ARE reported, in order...
      expect(suspects.value.length).toBe(2);
      expect(suspects.value.map((s) => s.word)).toEqual(['TELEX', 'CLEAR']);
      // ...and the boundary word (confidence exactly 60) plus the confident
      // word are NOT.
      expect(suspects.value.map((s) => s.word)).not.toContain('EXACT');
      expect(suspects.value.map((s) => s.word)).not.toContain('SHARP');
      for (const s of suspects.value) {
        expect(s.confidence).toBeLessThan(SUSPECT_CONFIDENCE_THRESHOLD);
        expect(s.page).toBe(1);
        expect(s.rect.width).toBeGreaterThan(0);
        expect(s.rect.height).toBeGreaterThan(0);
        expect(s.word.length).toBeGreaterThan(0);
      }
    }

    // The invisible text layer is written for every recognised word regardless
    // of confidence, so both the suspect and the confident words are present.
    const out = join(dir, 'mixed-out.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    const words = decodeTjWords(new Uint8Array(await readFile(out)));
    expect(words).toContain('TELEX');
    expect(words).toContain('SHARP');
  });

  it('still reports every word as a suspect when all confidences are low', async () => {
    const ocr = fixedOcr([
      { text: 'FUZZY', confidence: 0, bbox: { x0: 10, y0: 10, x1: 210, y1: 90 } },
      { text: 'BLUR', confidence: 30, bbox: { x0: 220, y0: 10, x1: 420, y1: 90 } },
    ]);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', await onePageDoc());

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: [pageImage],
    });
    expect(res.ok).toBe(true);

    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(true);
    if (suspects.ok) expect(suspects.value.map((s) => s.word)).toEqual(['FUZZY', 'BLUR']);
  });

  it('returns no suspects for confident words and undo removes the text layer', async () => {
    const ocr = fixedOcr([
      { text: 'CRISP', confidence: 99, bbox: { x0: 10, y0: 10, x1: 210, y1: 90 } },
    ]);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', await onePageDoc());

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: [pageImage],
    });
    expect(res.ok).toBe(true);

    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(true);
    if (suspects.ok) expect(suspects.value).toEqual([]);

    // Undo reverts the OCR run: the saved output has no Tj words. (saveAs
    // clears the undo stack, so undo must run before the save.)
    expect((await engine.undo('d')).ok).toBe(true);
    const outUndo = join(dir, 'crisp-undo.pdf');
    expect(await engine.saveAs('d', outUndo)).toMatchObject({ ok: true });
    expect(decodeTjWords(new Uint8Array(await readFile(outUndo)))).toEqual([]);
  });
});

describe('EngineService.ocrRecognize — save-after-OCR round-trip (DEF-052)', () => {
  // DEF-052 repro: "Save As fails to produce a file after OCR". This test
  // loads the REAL scanned.pdf (6 pages, FlateDecode image content streams),
  // runs a deterministic fake OCR over every page (isolates the SAVE path
  // from tesseract — the save path is identical regardless of the recogniser),
  // then exercises both `saveAs` and in-place `save`, and asserts the saved
  // file is valid: non-empty, re-parseable to the same page count, with
  // BALANCED q/Q graphics-state scoping across every content stream and
  // valid `Tj` operators (the searchable invisible text layer), surviving a
  // double round-trip (load -> save -> load). The q/Q balance is checked
  // GLOBALLY because pdf-lib's `copyPages`/`addPage` emit standalone `q`/`Q`
  // wrapper streams that balance per-page across the page's /Contents array,
  // so per-stream counting is a false premise.

  /** Fake OCR keyed off pngBytes[0] (the 1-based page number). Returns three
   *  synthetic Latin-1 words per page so the engine draws real `Tj`
   *  operators through the exact save path tesseract would use. */
  function fakeOcr(): OcrService {
    return {
      recognize(pngBytes: Uint8Array): Promise<RawOcrWord[]> {
        const page = pngBytes[0];
        const baseY = 100 + page * 5;
        return Promise.resolve([
          { text: 'HELLO', confidence: 90, bbox: { x0: 10, y0: baseY, x1: 200, y1: baseY + 70 } },
          { text: 'WORLD', confidence: 88, bbox: { x0: 210, y0: baseY, x1: 400, y1: baseY + 70 } },
          { text: 'PAGE', confidence: 75, bbox: { x0: 410, y0: baseY, x1: 560, y1: baseY + 70 } },
        ]);
      },
    } as unknown as OcrService;
  }

  /** Page images for every page; pngBytes[0] encodes the 1-based page number
   *  the fake reads. dpi 72 keeps the bbox map inside the page. */
  function allPageImages(pageCount: number) {
    return Array.from({ length: pageCount }, (_, i) => ({
      page: i + 1,
      pngBytes: new Uint8Array([i + 1, 1, 2, 3]),
      dpi: 72,
      widthPx: 612,
      heightPx: 792,
    }));
  }

  it('saveAs after OCR produces a valid file with balanced q/Q and Tj (real scanned.pdf, all pages)', async () => {
    const src = join(process.cwd(), 'test-fixtures', 'scanned.pdf');
    expect(existsSync(src)).toBe(true);
    const engine = new EngineService(fakeOcr());

    expect(await engine.loadDocument('d', src)).toMatchObject({ ok: true });
    const state = await engine.getState('d');
    if (!state.ok) throw new Error('getState failed: ' + state.error.message);
    const pageCount = state.value.pageCount;
    expect(pageCount).toBe(6);

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: allPageImages(pageCount),
    });
    expect(res.ok).toBe(true);

    const out = join(dir, 'def052-saveas.pdf');
    const saved = await engine.saveAs('d', out);
    expect(saved.ok).toBe(true);

    // The defect claimed no file is created. Assert it is, and non-empty.
    expect(existsSync(out)).toBe(true);
    const fileBytes = new Uint8Array(await readFile(out));
    expect(fileBytes.length).toBeGreaterThan(0);

    // Re-parse the saved bytes — a corrupt content stream would throw here.
    const reparsed = await PDFDocument.load(fileBytes);
    expect(reparsed.getPageCount()).toBe(pageCount);

    // q/Q balance (global) + valid Tj operators present.
    const { qCount, QCount, tjCount } = countQQandTj(fileBytes);
    expect(tjCount).toBe(pageCount * 3); // three words per page
    expect(qCount).toBe(QCount); // graphics-state scoping is balanced

    // Double round-trip: load -> save -> load. Corruption would surface here.
    const rt2 = await PDFDocument.load(fileBytes);
    const rt2Bytes = await rt2.save();
    const rt3 = await PDFDocument.load(rt2Bytes);
    expect(rt3.getPageCount()).toBe(pageCount);
  }, 60000);

  it('in-place save after OCR produces a valid file (real scanned.pdf, all pages)', async () => {
    // Copy the fixture into temp so in-place save can overwrite it.
    const src = join(process.cwd(), 'test-fixtures', 'scanned.pdf');
    const copy = join(dir, 'def052-save-inplace.pdf');
    await writeFile(copy, await readFile(src));

    const engine = new EngineService(fakeOcr());
    expect(await engine.loadDocument('d', copy)).toMatchObject({ ok: true });
    const state = await engine.getState('d');
    if (!state.ok) throw new Error('getState failed: ' + state.error.message);
    const pageCount = state.value.pageCount;

    const res = await engine.ocrRecognize('d', {
      language: 'eng',
      downsample: 72,
      pageImages: allPageImages(pageCount),
    });
    expect(res.ok).toBe(true);

    const saved = await engine.save('d');
    expect(saved.ok).toBe(true);
    expect(existsSync(copy)).toBe(true);

    const fileBytes = new Uint8Array(await readFile(copy));
    expect(fileBytes.length).toBeGreaterThan(0);
    const reparsed = await PDFDocument.load(fileBytes);
    expect(reparsed.getPageCount()).toBe(pageCount);
    const { qCount, QCount, tjCount } = countQQandTj(fileBytes);
    expect(tjCount).toBe(pageCount * 3);
    expect(qCount).toBe(QCount);
  }, 60000);
});

/** Measure a PNG's pixel dimensions with the bundled node canvas. */
async function pngDims(png: Uint8Array): Promise<{ width: number; height: number }> {
  const img = await loadImage(png);
  return { width: img.width, height: img.height };
}

/** Decompress every Flate stream in a PDF and count the graphics-state `q`/
 *  `Q` operators and the text-showing `Tj` operators across the whole file.
 *  Used by the DEF-052 round-trip test to assert q/Q scoping is balanced
 *  (no leaked `q`/`Q`) and that the invisible text layer produced valid `Tj`
 *  operators. The q/Q balance is checked GLOBALLY: pdf-lib's `copyPages` and
 *  `addPage` emit standalone `q`/`Q` wrapper content streams (one pair per
 *  page) that balance per-page across the page's /Contents array, so a
 *  per-stream count would falsely flag those wrappers as imbalanced. */
function countQQandTj(bytes: Uint8Array): { qCount: number; QCount: number; tjCount: number } {
  const r = Buffer.from(bytes).toString('latin1');
  let qCount = 0;
  let QCount = 0;
  let tjCount = 0;
  let pos = 0;
  while (true) {
    const s = r.indexOf('stream\n', pos);
    if (s < 0) break;
    const e = r.indexOf('endstream', s);
    if (e < 0) break;
    let dec: string;
    try {
      dec = inflateSync(Buffer.from(r.slice(s + 7, e), 'latin1')).toString('latin1');
    } catch { pos = e + 9; continue; }
    qCount += (dec.match(/\bq\b/g) || []).length;
    QCount += (dec.match(/\bQ\b/g) || []).length;
    tjCount += (dec.match(/Tj/g) || []).length;
    pos = e + 9;
  }
  return { qCount, QCount, tjCount };
}

/** Decompress every Flate stream in a PDF and decode every `<hex> Tj` operand
 *  to a string. Used to verify an invisible text layer was written and
 *  survives save. */
function decodeTjWords(bytes: Uint8Array): string[] {
  const r = Buffer.from(bytes).toString('latin1');
  const words: string[] = [];
  let pos = 0;
  while (true) {
    const s = r.indexOf('stream\n', pos);
    if (s < 0) break;
    const e = r.indexOf('endstream', s);
    if (e < 0) break;
    let dec: string;
    try {
      dec = inflateSync(Buffer.from(r.slice(s + 7, e), 'latin1')).toString('latin1');
    } catch { pos = e + 9; continue; }
    const re = /<([0-9A-Fa-f]*)>\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dec)) !== null) {
      const hex = m[1];
      if (hex.length === 0) continue;
      const bb = Buffer.from(hex, 'hex');
      words.push(bb.toString('latin1'));
    }
    pos = e + 9;
  }
  return words;
}
