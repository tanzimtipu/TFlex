import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { OcrService, RawOcrWord } from '../../../src/main/services/ocr';
import { IPC } from '../../../src/shared/ipc';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-ocr-cancel-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A blank multi-page document (no text layer before OCR). */
async function multiPageDoc(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** Page images whose first byte encodes the 1-based page number, so the fake
 *  recogniser can tell pages apart. dpi 72 keeps bboxes inside the page. */
function pageImages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    page: i + 1,
    pngBytes: new Uint8Array([i + 1, 1, 2, 3]),
    dpi: 72,
    widthPx: 612,
    heightPx: 792,
  }));
}

function wordsFor(pngBytes: Uint8Array): RawOcrWord[] {
  const page = pngBytes[0];
  return [
    { text: `WORD${page}`, confidence: 90, bbox: { x0: 10, y0: 10, x1: 200, y1: 80 } },
  ];
}

/** A recogniser that returns immediately for every page. */
function fixedOcr(): OcrService {
  return {
    async recognize(pngBytes: Uint8Array): Promise<RawOcrWord[]> {
      return wordsFor(pngBytes);
    },
  } as unknown as OcrService;
}

/** A recogniser whose Nth call blocks on a gate the test releases, so a
 *  cancel can be issued deterministically while the engine sits in the
 *  tesseract await. Calls before/after the gated one return immediately. */
function gatedOcr(gateCall: number): {
  ocr: OcrService;
  entered: Promise<void>;
  release: () => void;
} {
  let calls = 0;
  let enteredResolve!: () => void;
  const entered = new Promise<void>((r) => {
    enteredResolve = r;
  });
  let releaseResolve!: () => void;
  const gate = new Promise<void>((r) => {
    releaseResolve = r;
  });
  const ocr = {
    async recognize(pngBytes: Uint8Array): Promise<RawOcrWord[]> {
      calls += 1;
      if (calls === gateCall) {
        enteredResolve();
        await gate;
      }
      return wordsFor(pngBytes);
    },
  } as unknown as OcrService;
  return { ocr, entered, release: () => releaseResolve() };
}

/** Decode every `<hex> Tj` operand from a saved PDF's Flate streams. A
 *  cancelled run must leave zero of these (the pre-run document has none). */
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
    } catch {
      pos = e + 9;
      continue;
    }
    const re = /<([0-9A-Fa-f]*)>\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(dec)) !== null) {
      const hex = m[1];
      if (hex.length === 0) continue;
      words.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
    pos = e + 9;
  }
  return words;
}

const OPTS = { language: 'eng', downsample: 72 };

describe('Phase 51 — EngineService.ocrCancel (abortable OCR)', () => {
  it('cancel mid-run restores the pre-run snapshot and returns cancelled', async () => {
    // Gate the SECOND page's recognition: page 1 completes and draws its
    // text layer, then the run blocks on page 2. Cancelling here proves the
    // partial text layer from page 1 is rolled back, not left behind.
    const { ocr, entered, release } = gatedOcr(2);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', await multiPageDoc(2));

    const run = engine.ocrRecognize('d', { ...OPTS, pageImages: pageImages(2) });
    await entered;

    const first = await engine.ocrCancel('d');
    expect(first).toMatchObject({ ok: true, value: { cancelled: true } });
    // A second cancel while the run is still in flight is idempotent.
    const second = await engine.ocrCancel('d');
    expect(second).toMatchObject({ ok: true, value: { cancelled: true } });

    release();
    const res = await run;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('cancelled');

    // No partial text: the saved output has zero Tj words (page 1's was
    // reverted by the snapshot restore).
    const out = join(dir, 'cancel-out.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    expect(decodeTjWords(new Uint8Array(await readFile(out)))).toEqual([]);

    // No modified flag, and no OCR run recorded for suspects.
    const state = await engine.getState('d');
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value.modified).toBe(false);
    const suspects = await engine.ocrSuspects('d');
    expect(suspects.ok).toBe(false);
  });

  it('cancel before start is a no-op and the run still succeeds', async () => {
    const engine = new EngineService(fixedOcr());
    await engine.loadDocumentBytes('d', await multiPageDoc(1));

    const cancel = await engine.ocrCancel('d');
    expect(cancel).toMatchObject({ ok: true, value: { cancelled: false } });

    const res = await engine.ocrRecognize('d', { ...OPTS, pageImages: pageImages(1) });
    expect(res.ok).toBe(true);
  });

  it('cancel after finish is a no-op and leaves the finished run intact', async () => {
    const engine = new EngineService(fixedOcr());
    await engine.loadDocumentBytes('d', await multiPageDoc(1));

    const res = await engine.ocrRecognize('d', { ...OPTS, pageImages: pageImages(1) });
    expect(res.ok).toBe(true);

    const cancel = await engine.ocrCancel('d');
    expect(cancel).toMatchObject({ ok: true, value: { cancelled: false } });

    // The completed run is untouched.
    const state = await engine.getState('d');
    expect(state.ok).toBe(true);
    if (state.ok) expect(state.value.modified).toBe(true);
  });

  it('a fresh run after a cancelled run succeeds normally', async () => {
    // Gate only the FIRST call, so run 1 is cancelled mid-flight and run 2
    // (which also proves the stale cancel does not bleed through) completes.
    const { ocr, entered, release } = gatedOcr(1);
    const engine = new EngineService(ocr);
    await engine.loadDocumentBytes('d', await multiPageDoc(1));

    const run1 = engine.ocrRecognize('d', { ...OPTS, pageImages: pageImages(1) });
    await entered;
    await engine.ocrCancel('d');
    release();
    const res1 = await run1;
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error.code).toBe('cancelled');

    const res2 = await engine.ocrRecognize('d', { ...OPTS, pageImages: pageImages(1) });
    expect(res2.ok).toBe(true);

    const out = join(dir, 'after-cancel.pdf');
    expect(await engine.saveAs('d', out)).toMatchObject({ ok: true });
    expect(decodeTjWords(new Uint8Array(await readFile(out)))).toContain('WORD1');
  });
});

describe('Phase 51 — ocrCancel channel wiring', () => {
  it('shared IPC declares the engine:ocrCancel channel and optional contract method', () => {
    expect(IPC.engineOcrCancel).toBe('engine:ocrCancel');
    const src = readFileSync(join(process.cwd(), 'src/shared/ipc.ts'), 'utf8');
    expect(src).toMatch(/ocrCancel\?\s*\(/);
    expect(src).toMatch(/OcrCancelResult/);
  });

  it('preload exposes ocrCancel on the engine bridge', () => {
    const src = readFileSync(join(process.cwd(), 'src/preload/preload.ts'), 'utf8');
    expect(src).toMatch(/ocrCancel\([\s\S]*?IPC\.engineOcrCancel/);
  });

  it('main registers the ipcMain handler and routes to engine.ocrCancel', () => {
    const src = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
    expect(src).toMatch(/ipcMain\.handle\(IPC\.engineOcrCancel[\s\S]*?engine\.ocrCancel/);
  });
});

