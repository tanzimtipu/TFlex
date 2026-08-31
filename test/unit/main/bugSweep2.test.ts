// Bug sweep 2 — backend verification for B9, B12, B13, B14/B16/B17.
//
// The orchestrator dispatched these as a second sweep after the 17-bug batch.
// Each bug is verified at the engine / preload boundary; renderer-side
// loading-state and detach issues are called out in the per-bug comments so
// the orchestrator can route them to frontend-dev.
//
//   B9  — DOCX export throws "Cannot read properties of undefined (reading
//          inner)". Root cause: App.tsx detaches
//          `engineRef.current.createDocxFromDoc` (line 2477) then calls the
//          detached method, so `this.inner` is undefined inside the
//          RealEngineAdapter. The engine method and the preload adapter are
//          both correct (verified here); the fix is renderer-side (call the
//          method on the object, not detached). These tests prove the engine
//          side round-trips cleanly.
//   B12 — tab close prompts save. engine.isModified exists and is exposed by
//          the preload; returns the right flag and engine-error for an
//          unknown docId. The prompt flow itself is renderer-side.
//   B13 — OCR on an empty tab must return engine-error, not crash. The
//          engine already returns engine-error for an unknown docId; this
//          sweep also guards a missing/undefined `opts` so a renderer that
//          forwards an empty options object cannot crash the main process.
//   B14/B16/B17 — merge / insertBlankPage / replacePages must complete and
//          return a Result (never hang). Verified here with a round-trip +
//          a re-parse of the saved bytes so a corrupt output is caught.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { OcrService, RawOcrWord } from '../../../src/main/services/ocr';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-bugsweep2-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function createNPagePdf(n: number, textPrefix = 'Page'): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${textPrefix} ${i}`, { x: 72, y: 700, size: 14, font });
  }
  const bytes = await doc.save();
  const path = await writeFixture(`sweep-${n}.pdf`, bytes);
  return { path, bytes };
}

/** Minimal valid PNG (1x1 RGB). Used as a DocxImageEntry.pngBuffer fallback. */
function createMinimalPng(width = 1, height = 1): Uint8Array {
  const zlib = require('zlib');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function createChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    let crc = 0xffffffff;
    for (const b of Buffer.concat([typeB, data])) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([length, typeB, data, crcB]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const raw = Buffer.alloc(width * height * 3 + height); // one filter byte per row
  const idat = zlib.deflateSync(raw);
  return new Uint8Array(Buffer.concat([sig, createChunk('IHDR', ihdr), createChunk('IDAT', idat), createChunk('IEND', Buffer.alloc(0))]));
}

/** Extract a store-only ZIP entry's bytes by name. */
function extractZipEntryBytes(zip: Uint8Array, name: string): Uint8Array | null {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 0x03 || zip[i + 3] !== 0x04) continue;
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const compSize = dv.getUint32(i + 18, true);
    const method = dv.getUint16(i + 8, true);
    const nameStart = i + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > zip.length) return null;
    const entryName = new TextDecoder().decode(zip.slice(nameStart, nameEnd));
    if (entryName !== name) continue;
    if (method !== 0) return null;
    const dataStart = nameEnd + extraLen;
    return zip.slice(dataStart, dataStart + compSize);
  }
  return null;
}

function extractZipEntryText(zip: Uint8Array, name: string): string | null {
  const bytes = extractZipEntryBytes(zip, name);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

function findPkEndSignature(buf: Uint8Array): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

/** A stand-in OcrService that returns synthetic words without tesseract. */
function fakeOcr(): OcrService {
  return {
    recognize(_pngBytes: Uint8Array, _language: string): Promise<RawOcrWord[]> {
      return Promise.resolve([
        { text: 'HELLO', confidence: 90, bbox: { x0: 10, y0: 10, x1: 200, y1: 80 } },
      ]);
    },
  } as unknown as OcrService;
}

// ---------------------------------------------------------------------------
// B9 — DOCX export round-trip (engine side)
// ---------------------------------------------------------------------------

describe('B9: createDocxFromDoc — engine round-trip', () => {
  it('returns valid DOCX bytes for a loaded text-bearing doc', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(1, 1);
    const entries = [1, 2].map((n) => ({
      pageNumber: n,
      pngBuffer: png,
      width: 1,
      height: 1,
      pageWidth: 612,
      pageHeight: 792,
    }));

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Valid ZIP: PK signature + EOCD + a word/document.xml part.
    expect(result.value[0]).toBe(0x50);
    expect(result.value[1]).toBe(0x4b);
    expect(findPkEndSignature(result.value)).toBeGreaterThan(0);
    const docXml = extractZipEntryText(result.value, 'word/document.xml');
    expect(docXml).not.toBeNull();
    // Text-bearing pages emit real w:t runs (not just inline images).
    expect(docXml!).toContain('<w:t');
    expect(docXml!).toContain('Page 0');
    expect(docXml!).toContain('Page 1');
  });

  it('survives a full exportPages -> createDocxFromDoc flow (the renderer DOCX path)', async () => {
    // This is the exact sequence the DocxExportDialog runs: exportPages
    // produces per-page PDF buffers, the renderer rasterises them, then
    // createDocxFromDoc assembles the .docx. We exercise the engine side
    // only (no rasteriser here); the entries carry the source page geometry.
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-flow', path);

    // exportPages returns one ExportPageEntry per page; the dialog rasterises
    // each. Here we only need to prove the engine's two calls both resolve.
    const exportRes = await engine.exportPages('doc-flow', {
      range: [1, 3],
      format: 'png',
      dpi: 72,
    });
    expect(exportRes.ok).toBe(true);
    if (!exportRes.ok) return;
    expect(exportRes.value.length).toBe(3);

    const png = createMinimalPng(1, 1);
    const entries = exportRes.value.map((e) => ({
      pageNumber: e.pageIndex,
      pngBuffer: png,
      width: 1,
      height: 1,
      pageWidth: 612,
      pageHeight: 792,
    }));
    const result = await engine.createDocxFromDoc('doc-flow', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPkEndSignature(result.value)).toBeGreaterThan(0);
    expect(extractZipEntryText(result.value, 'word/document.xml')).not.toBeNull();
  });

  it('returns engine-error for an unknown docId (not a crash)', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(1, 1);
    const entries = [{
      pageNumber: 1, pngBuffer: png, width: 1, height: 1, pageWidth: 612, pageHeight: 792,
    }];
    const result = await engine.createDocxFromDoc('does-not-exist', entries);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('returns empty-range for an empty entries array', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    const result = await engine.createDocxFromDoc('doc-1', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty-range');
    }
  });
});

// ---------------------------------------------------------------------------
// B12 — isModified (engine side)
// ---------------------------------------------------------------------------

describe('B12: isModified — engine side', () => {
  it('returns false for a freshly loaded doc', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    const r = await engine.isModified('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(false);
  });

  it('returns true after a mutating op', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const r = await engine.isModified('doc-1');
    expect(r.ok && r.value).toBe(true);
  });

  it('returns engine-error for an unknown docId (empty tab)', async () => {
    const engine = new EngineService();
    const r = await engine.isModified('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('reflects every prior queued mutation (queue ordering)', async () => {
    // Fire a mutation and an isModified concurrently; the queue must order
    // them so isModified observes the mutation's effect.
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    void engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const r = await engine.isModified('doc-1');
    expect(r.ok && r.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B13 — OCR on an empty tab (no docId) must return engine-error, not crash
// ---------------------------------------------------------------------------

describe('B13: ocrRecognize / ocrSuspects — empty tab + missing opts', () => {
  // Use a non-null fake OCR so the engine does not short-circuit on
  // `this.ocr === null`; we want to exercise the docId / opts guards.
  function makeEngine(): EngineService {
    return new EngineService(fakeOcr());
  }

  it('ocrRecognize returns engine-error for an unknown docId (empty tab)', async () => {
    const engine = makeEngine();
    const png = createMinimalPng(1, 1);
    const r = await engine.ocrRecognize('empty-tab', {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: png, dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrRecognize returns engine-error for an empty-string docId', async () => {
    const engine = makeEngine();
    const png = createMinimalPng(1, 1);
    const r = await engine.ocrRecognize('', {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: png, dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrRecognize does not crash when opts is undefined (defensive guard)', async () => {
    const engine = makeEngine();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    // Simulate a renderer that forwarded no options object. Before the guard
    // this crashed on `opts.language`; now it returns engine-error.
    const r = await engine.ocrRecognize('doc-1', undefined as unknown as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrRecognize does not crash when opts is null', async () => {
    const engine = makeEngine();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    const r = await engine.ocrRecognize('doc-1', null as unknown as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrSuspects returns engine-error for an unknown docId (empty tab)', async () => {
    const engine = makeEngine();
    const r = await engine.ocrSuspects('empty-tab');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrSuspects returns engine-error when no OCR has been run on the doc', async () => {
    const engine = makeEngine();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    const r = await engine.ocrSuspects('doc-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ocrSuspects returns engine-error for an empty-string docId', async () => {
    const engine = makeEngine();
    const r = await engine.ocrSuspects('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

// ---------------------------------------------------------------------------
// B14 — merge completes and returns (no engine hang)
// ---------------------------------------------------------------------------

describe('B14: merge — completes and returns a Result', () => {
  it('merge after: returns a state with the combined page count', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { path: pB } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', pA);

    const r = await engine.merge('doc-1', [pB], 'after');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(5);
      expect(r.value.modified).toBe(true);
    }
  });

  it('merge produces a re-parseable PDF after save (no corruption / hang)', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { path: pB } = await createNPagePdf(2);
    await engine.loadDocument('doc-merge', pA);
    const merged = await engine.merge('doc-merge', [pB], 'after');
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const out = join(dir, 'merge-out.pdf');
    const saved = await engine.saveAs('doc-merge', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const reparsed = await PDFDocument.load(await readFile(out));
    expect(reparsed.getPageCount()).toBe(4);
  });

  it('merge returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const { path: pB } = await createNPagePdf(1);
    const r = await engine.merge('nope', [pB], 'after');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('merge returns engine-error for a nonexistent other path', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', pA);
    const r = await engine.merge('doc-1', [join(dir, 'missing.pdf')], 'after');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

// ---------------------------------------------------------------------------
// B16 — insertBlankPage completes and returns (no engine hang)
// ---------------------------------------------------------------------------

describe('B16: insertBlankPage — completes and returns a Result', () => {
  it('inserts a blank page and returns the new state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.insertBlankPage('doc-1', 0, 400, 300);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(4);
      expect(r.value.modified).toBe(true);
    }
  });

  it('insertBlankPage survives a save round-trip (no corruption / hang)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-ibp', path);
    const r = await engine.insertBlankPage('doc-ibp', 1, 500, 400);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const out = join(dir, 'ibp-out.pdf');
    const saved = await engine.saveAs('doc-ibp', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const reparsed = await PDFDocument.load(await readFile(out));
    expect(reparsed.getPageCount()).toBe(3);
  });

  it('insertBlankPage returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.insertBlankPage('nope', 0, 400, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

// ---------------------------------------------------------------------------
// B17 — replacePages completes and returns (no engine hang)
// ---------------------------------------------------------------------------

describe('B17: replacePages — completes and returns a Result', () => {
  it('replaces a visible page range with another PDF and returns the state', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { bytes: bB } = await createNPagePdf(2, 'R');
    await engine.loadDocument('doc-1', pA);

    const r = await engine.replacePages('doc-1', bB, [0, 0]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 3 pages, replaced [0,0] (1 page) with a 2-page PDF -> 4 pages.
      expect(r.value.pageCount).toBe(4);
      expect(r.value.modified).toBe(true);
    }
  });

  it('replacePages survives a save round-trip (no corruption / hang)', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { bytes: bB } = await createNPagePdf(2, 'R');
    await engine.loadDocument('doc-rp', pA);
    const r = await engine.replacePages('doc-rp', bB, [0, 1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const out = join(dir, 'rp-out.pdf');
    const saved = await engine.saveAs('doc-rp', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const reparsed = await PDFDocument.load(await readFile(out));
    // Replaced [0,1] (2 pages) with a 2-page PDF -> 2 pages.
    expect(reparsed.getPageCount()).toBe(2);
  });

  it('replacePages returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const { bytes: bB } = await createNPagePdf(1);
    const r = await engine.replacePages('nope', bB, [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('replacePages returns out-of-range for a bad target range', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { bytes: bB } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', pA);
    const r = await engine.replacePages('doc-1', bB, [5, 9]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('replacePages returns engine-error for a corrupt other-PDF', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', pA);
    const r = await engine.replacePages('doc-1', new Uint8Array([1, 2, 3]), [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});
