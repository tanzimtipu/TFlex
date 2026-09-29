import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { isPdfBytes } from '../../../src/main/services/print';
import { ok } from '../../../src/shared/result';
import {
  createTiffAdapter,
  encodeRgbaPng,
} from '../../../src/main/services/convert/adapters/tiff';
import { readSniffHead, createDefaultRegistry } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';
import { DocumentConversionService } from '../../../src/main/services/convert/index';

/**
 * Phase 54 feature B — the multi-page TIFF adapter. Fixtures are synthetic
 * baseline TIFFs built in-test (little-endian, one IFD per frame).
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-tiff-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

interface FrameSpec {
  width: number;
  height: number;
  dpi?: number;
  corrupt?: boolean;
}

/**
 * Build a little-endian baseline TIFF. One 12-entry IFD per frame; a corrupt
 * frame carries ImageWidth 0 (decoable IFD, zero-pixel image).
 */
function buildTiff(frames: FrameSpec[]): Buffer {
  const n = frames.length;
  const entriesPer = 12;
  const block = 2 + entriesPer * 12 + 4;
  const ifdOffset = (i: number): number => 8 + i * block;
  const valuesStart = 8 + n * block;
  const rationalBase = (i: number): number => valuesStart + i * 16;
  let cursor = valuesStart + n * 16;
  const stripOffset = frames.map((f) => {
    const off = cursor;
    cursor += f.corrupt ? 0 : f.width * f.height;
    return off;
  });
  const buf = Buffer.alloc(cursor);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);

  frames.forEach((f, i) => {
    const base = ifdOffset(i);
    buf.writeUInt16LE(entriesPer, base);
    let e = base + 2;
    const entry = (tag: number, type: number, count: number, value: number): void => {
      buf.writeUInt16LE(tag, e);
      buf.writeUInt16LE(type, e + 2);
      buf.writeUInt32LE(count, e + 4);
      buf.writeUInt32LE(value, e + 8);
      e += 12;
    };
    const w = f.corrupt ? 0 : f.width;
    entry(256, 3, 1, w);
    entry(257, 3, 1, f.height);
    entry(258, 3, 1, 8);
    entry(259, 3, 1, 1);
    entry(262, 3, 1, 1);
    entry(273, 4, 1, stripOffset[i]);
    entry(277, 3, 1, 1);
    entry(278, 3, 1, f.height);
    entry(279, 4, 1, w * f.height);
    entry(282, 5, 1, rationalBase(i));
    entry(283, 5, 1, rationalBase(i) + 8);
    entry(296, 3, 1, 2);
    buf.writeUInt32LE(i < n - 1 ? ifdOffset(i + 1) : 0, e);

    const dpi = f.dpi ?? 72;
    buf.writeUInt32LE(Math.round(dpi), rationalBase(i));
    buf.writeUInt32LE(1, rationalBase(i) + 4);
    buf.writeUInt32LE(Math.round(dpi), rationalBase(i) + 8);
    buf.writeUInt32LE(1, rationalBase(i) + 12);
    if (!f.corrupt) {
      buf.fill(0x80, stripOffset[i], stripOffset[i] + w * f.height);
    }
  });
  return buf;
}

async function pageSizes(bytes: Uint8Array): Promise<Array<{ w: number; h: number }>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const size = page.getSize();
    return { w: size.width, h: size.height };
  });
}

async function runTiff(
  adapter: ReturnType<typeof createTiffAdapter>,
  path: string,
  onProgress?: (phase: string, ratio?: number) => void,
) {
  const head = await readSniffHead(path);
  return adapter.convert({
    path,
    options: resolveConvertOptions({}),
    head,
    onProgress,
  });
}

describe('phase54 tiff adapter', () => {
  it('decodes a 3-frame stack into a 3-page PDF in frame order', async () => {
    const path = await mkFile(
      'stack.tiff',
      buildTiff([
        { width: 300, height: 150, dpi: 72 },
        { width: 100, height: 200, dpi: 100 },
        { width: 50, height: 50, dpi: 50 },
      ]),
    );
    const out = await runTiff(createTiffAdapter(), path);
    expect(out.sourceFormat).toBe('tiff');
    expect(out.pageCount).toBe(3);
    expect(isPdfBytes(out.bytes)).toBe(true);
    const sizes = await pageSizes(out.bytes);
    expect(sizes[0].w).toBeCloseTo(300, 1);
    expect(sizes[0].h).toBeCloseTo(150, 1);
    expect(sizes[1].w).toBeCloseTo((100 / 100) * 72, 1);
    expect(sizes[1].h).toBeCloseTo((200 / 100) * 72, 1);
    expect(sizes[2].w).toBeCloseTo((50 / 50) * 72, 1);
    expect(out.warnings).toHaveLength(0);
  });

  it('placeholder page + warning for a corrupt frame, others still render', async () => {
    const path = await mkFile(
      'corrupt.tiff',
      buildTiff([
        { width: 300, height: 150, dpi: 72 },
        { width: 100, height: 200, dpi: 100, corrupt: true },
        { width: 50, height: 50, dpi: 50 },
      ]),
    );
    const out = await runTiff(createTiffAdapter(), path);
    expect(out.pageCount).toBe(3);
    expect(out.fidelity).toBe('degraded');
    const warning = out.warnings.find((w) => w.code === 'frame-decode-failed');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Frame 2');
    const sizes = await pageSizes(out.bytes);
    expect(sizes[0].w).toBeCloseTo(300, 1);
    expect(sizes[1].w).toBeCloseTo(595.28, 1); // A4 placeholder
    expect(sizes[2].w).toBeCloseTo(72, 1);
  });

  it('warns (rather than truncates) above the frame ceiling', async () => {
    const path = await mkFile(
      'ceiling.tiff',
      buildTiff([
        { width: 10, height: 10, dpi: 72 },
        { width: 10, height: 10, dpi: 72 },
        { width: 10, height: 10, dpi: 72 },
      ]),
    );
    const out = await runTiff(createTiffAdapter({ framesLimit: 2 }), path);
    expect(out.pageCount).toBe(3);
    const warning = out.warnings.find((w) => w.code === 'frame-limit');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('3 frames');
  });

  it('emits a decoding progress step per frame', async () => {
    const path = await mkFile(
      'progress.tiff',
      buildTiff([
        { width: 10, height: 10, dpi: 72 },
        { width: 10, height: 10, dpi: 72 },
        { width: 10, height: 10, dpi: 72 },
      ]),
    );
    const seen: Array<[string, number | undefined]> = [];
    await runTiff(createTiffAdapter(), path, (phase, ratio) => seen.push([phase, ratio]));
    const decoding = seen.filter(([phase]) => phase === 'decoding');
    expect(decoding.map(([, ratio]) => ratio)).toEqual([
      1 / 3,
      2 / 3,
      1,
    ]);
    expect(seen.some(([phase]) => phase === 'done')).toBe(true);
  });

  it('warns the 96 DPI assumption when a frame has no resolution tags', async () => {
    const bytes = buildTiff([{ width: 192, height: 96, dpi: 72 }]);
    // Zero the XResolution denominator in the first rational (offset 8 + 150 + 4).
    const rationalBase = 8 + 150;
    bytes.writeUInt32LE(0, rationalBase + 4);
    bytes.writeUInt32LE(0, rationalBase + 12);
    const path = await mkFile('nors.tiff', bytes);
    const out = await runTiff(createTiffAdapter(), path);
    const warning = out.warnings.find((w) => w.code === 'dpi-assumed');
    expect(warning).toBeDefined();
    const sizes = await pageSizes(out.bytes);
    expect(sizes[0].w).toBeCloseTo((192 / 96) * 72, 1);
  });
});

describe('phase54 tiff sniff', () => {
  it('recognises II and MM TIFF headers only', () => {
    const adapter = createTiffAdapter();
    expect(adapter.sniff('a.tif', Buffer.from([0x49, 0x49, 0x2a, 0x00]))).toBe(true);
    expect(adapter.sniff('a.tif', Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))).toBe(true);
    expect(adapter.sniff('a.tif', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('phase54 tiff hostile specimens (adversary adv-p54, DEF-380/DEF-385)', () => {
  const advPath = (name: string): string => resolve('test-fixtures/adv-p54', name);

  it('DEF-380: a cyclic IFD chain fails fast with a typed corrupt error (never OOMs)', async () => {
    const path = advPath('tiff-cyclic-ifd.tiff');
    const started = Date.now();
    let thrown: unknown = null;
    try {
      await runTiff(createTiffAdapter(), path);
    } catch (error) {
      thrown = error;
    }
    const elapsed = Date.now() - started;
    expect(thrown).not.toBeNull();
    expect((thrown as { code?: string }).code).toBe('corrupt');
    expect((thrown as Error).message).toContain('cyclic');
    // The unfixed adapter looped until V8 exhausted ~4 GB; a bounded outcome
    // must return in well under the OOM time.
    expect(elapsed).toBeLessThan(5000);
    console.log('[DEF-380] cyclic IFD typed error in', elapsed, 'ms');
  }, 30000);

  it('DEF-385: an absurd declared frame size degrades fast instead of blocking ~27 s', async () => {
    const path = advPath('tiff-absurd-dims.tiff');
    const started = Date.now();
    const out = await runTiff(createTiffAdapter(), path);
    const elapsed = Date.now() - started;
    expect(out.pageCount).toBe(1);
    expect(out.fidelity).toBe('degraded');
    const warning = out.warnings.find((w) => w.code === 'frame-decode-failed');
    expect(warning).toBeDefined();
    expect(warning?.detail).toContain('20000x20000');
    // Baseline on this machine: 25,876 ms of blocked main process.
    expect(elapsed).toBeLessThan(5000);
    console.log('[DEF-385] absurd-dims frame rejected in', elapsed, 'ms');
  }, 30000);
});

describe('phase54 tiff encodeRgbaPng', () => {
  it('round-trips through pdf-lib embedPng', async () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(0x40);
    const png = encodeRgbaPng(rgba, 4, 4);
    const doc = await PDFDocument.create();
    const embedded = await doc.embedPng(png);
    expect(embedded.width).toBe(4);
    expect(embedded.height).toBe(4);
  });
});

describe('phase54 toDocumentMany over images', () => {
  it('composes a PNG and a JPEG into one document; a CSV is rejected', async () => {
    const png = await mkFile('p.png', Buffer.from(encodeRgbaPng(new Uint8Array(4), 1, 1)));
    const jpgLike = await mkFile(
      'j.jpg',
      Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0, 4, 0, 4, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]),
    );
    const csv = await mkFile('c.csv', Buffer.from('a,b\n1,2\n'));
    const loaded: Uint8Array[] = [];
    const service = new DocumentConversionService({
      engine: {
        loadDocumentBytes: async (_docId, bytes) => {
          loaded.push(new Uint8Array(bytes));
          return ok(new ArrayBuffer(0));
        },
      },
      registry: createDefaultRegistry(),
    });

    const okResult = await service.toDocumentMany('d1', [png, jpgLike]);
    expect(okResult.ok).toBe(true);
    if (!okResult.ok) return;
    expect(okResult.value.pageCount).toBe(2);
    expect(okResult.value.sourceFormats).toEqual(['png', 'jpeg']);
    expect(loaded).toHaveLength(1);

    const bad = await service.toDocumentMany('d2', [png, csv]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe('unsupported-format');
    expect(bad.error.message).toContain('c.csv');
    expect(loaded).toHaveLength(1);
  });
});
