import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { isPdfBytes } from '../../../src/main/services/print';
import { ok } from '../../../src/shared/result';
import type { ConvertOptions } from '../../../src/shared/convert';
import {
  jpegAdapter,
  pngAdapter,
  computeImagePlacement,
} from '../../../src/main/services/convert/adapters/images';
import { readSniffHead, createDefaultRegistry } from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';
import { readPngMeta } from '../../../src/main/services/convert/image-meta';
import { DocumentConversionService } from '../../../src/main/services/convert/index';

/**
 * Phase 54 feature A — the PNG/JPEG adapters: DPI-aware sizing (criterion 1),
 * fit modes, rotation, magic-byte routing and multi-file composition.
 * Fixtures are synthetic and built in-test.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-img-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, content: Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBytes, data), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** A valid 8-bit RGBA PNG; optional pHYs density in dots-per-inch. */
function makePng(width: number, height: number, dpi?: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(Buffer.alloc(stride, 0x80), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [chunk('IHDR', ihdr)];
  if (dpi !== undefined) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(Math.round(dpi / 0.0254), 0);
    phys.writeUInt32BE(Math.round(dpi / 0.0254), 4);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...parts,
  ]);
}

function sof0(width: number, height: number): Buffer {
  const seg = Buffer.alloc(19);
  seg[0] = 0xff;
  seg[1] = 0xc0;
  seg.writeUInt16BE(17, 2);
  seg[4] = 8;
  seg.writeUInt16BE(height, 5);
  seg.writeUInt16BE(width, 7);
  seg[9] = 3;
  seg[10] = 1;
  seg[11] = 0x11;
  seg[13] = 2;
  seg[14] = 0x11;
  seg[16] = 3;
  seg[17] = 0x11;
  return seg;
}

function jfifApp0(dpi: number, units = 1): Buffer {
  const seg = Buffer.alloc(18);
  seg[0] = 0xff;
  seg[1] = 0xe0;
  seg.writeUInt16BE(16, 2);
  seg.write('JFIF\0', 4, 'ascii');
  seg[9] = 1;
  seg[10] = 1;
  seg[11] = units;
  seg.writeUInt16BE(dpi, 12);
  seg.writeUInt16BE(dpi, 14);
  return seg;
}

/** A cold EXIF block (II) carrying X/YResolution + inch unit. */
function exifApp1(dpi: number): Buffer {
  const tiff = Buffer.alloc(66);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const ifd = 8;
  tiff.writeUInt16LE(3, ifd);
  let e = ifd + 2;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    tiff.writeUInt16LE(tag, e);
    tiff.writeUInt16LE(type, e + 2);
    tiff.writeUInt32LE(count, e + 4);
    tiff.writeUInt32LE(value, e + 8);
    e += 12;
  };
  entry(282, 5, 1, 50);
  entry(283, 5, 1, 58);
  entry(296, 3, 1, 2);
  tiff.writeUInt32LE(0, e);
  tiff.writeUInt32LE(dpi, 50);
  tiff.writeUInt32LE(1, 54);
  tiff.writeUInt32LE(dpi, 58);
  tiff.writeUInt32LE(1, 62);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(2 + payload.length, 2);
  payload.copy(seg, 4);
  return seg;
}

function makeJpeg(
  width: number,
  height: number,
  opts: { jfifDpi?: number; jfifUnits?: number; exifDpi?: number } = {},
): Buffer {
  const parts = [Buffer.from([0xff, 0xd8]), sof0(width, height)];
  if (opts.exifDpi !== undefined) parts.push(exifApp1(opts.exifDpi));
  if (opts.jfifDpi !== undefined) {
    parts.push(jfifApp0(opts.jfifDpi, opts.jfifUnits ?? 1));
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

async function runAdapter(
  adapter: typeof pngAdapter,
  path: string,
  options: ConvertOptions,
) {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options: resolveConvertOptions(options), head });
}

async function pageSizes(bytes: Uint8Array): Promise<Array<{ w: number; h: number }>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const size = page.getSize();
    return { w: size.width, h: size.height };
  });
}

describe('phase54 hostile image geometry (adversary adv-p54, DEF-382)', () => {
  const advPath = (name: string): string => resolve('test-fixtures/adv-p54', name);

  async function placementOf(name: string) {
    const meta = readPngMeta(new Uint8Array(await readFile(advPath(name))));
    expect(meta).not.toBeNull();
    return computeImagePlacement(meta as NonNullable<typeof meta>, resolveConvertOptions({}));
  }

  it('clamps a 1-DPI 1,417,322 pt page to the 14,400 pt ceiling and reports the computed value', async () => {
    const placement = await placementOf('png-20000-1dpi.png');
    expect(placement.pageWidth).toBe(14400);
    expect(placement.pageHeight).toBe(14400);
    expect(placement.clamp).toBeDefined();
    expect(placement.clamp?.computedWidthPt).toBeCloseTo(1417322.835, 1);
  });

  it('clamps a 109,092,169-DPI near-zero page to the 3 pt floor and reports the computed value', async () => {
    const placement = await placementOf('png-phys-max.png');
    expect(placement.pageWidth).toBe(3);
    expect(placement.pageHeight).toBe(3);
    expect(placement.clamp?.computedWidthPt).toBeGreaterThan(0);
    expect(placement.clamp?.computedWidthPt).toBeLessThan(0.001);
  });

  it('surfaces the clamp as a page-clamped warning naming computed and clamped values', async () => {
    const out = await runAdapter(pngAdapter, advPath('png-phys-max.png'), {});
    const warning = out.warnings.find((w) => w.code === 'page-clamped');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('6.600e-5');
    expect(warning?.message).toContain('clamped to 3 x 3 pt');
    expect(warning?.detail).toBe('png-phys-max.png');
    const sizes = await pageSizes(out.bytes);
    expect(sizes[0].w).toBe(3);
    expect(sizes[0].h).toBe(3);
  });

  it('clamps a 100,000-DPI 1x1 page to the floor', async () => {
    const placement = await placementOf('png-1x1-100000dpi.png');
    expect(placement.pageWidth).toBe(3);
    expect(placement.clamp?.computedWidthPt).toBeCloseTo(0.00072, 5);
  });
});

describe('phase54 verified normal-image sizing is unchanged (DEF-382)', () => {
  it('720x360 px at 72 DPI stays 719.91 x 359.96 pt with no clamp and no warning', async () => {
    const path = await mkFile('verified.png', makePng(720, 360, 72));
    const meta = readPngMeta(new Uint8Array(await readFile(path)));
    const placement = computeImagePlacement(
      meta as NonNullable<typeof meta>,
      resolveConvertOptions({}),
    );
    expect(placement.pageWidth).toBeCloseTo(719.91, 2);
    expect(placement.pageHeight).toBeCloseTo(359.96, 2);
    expect(placement.clamp).toBeUndefined();

    const out = await runAdapter(pngAdapter, path, {});
    expect(out.warnings).toHaveLength(0);
    const sizes = await pageSizes(out.bytes);
    expect(sizes[0].w).toBeCloseTo(719.91, 2);
    expect(sizes[0].h).toBeCloseTo(359.96, 2);
  });
});

describe('phase54 image-meta', () => {
  it('reads PNG pixels and pHYs density', () => {
    const meta = readPngMeta(makePng(300, 150, 300));
    expect(meta?.widthPx).toBe(300);
    expect(meta?.heightPx).toBe(150);
    expect(meta?.dpiSource).toBe('png-phys');
    expect(meta?.dpiX).toBeCloseTo(300, 1);
  });
});

describe('phase54 raster adapter sizing (criterion 1)', () => {
  it('sizes an image-sized page as pixels / dpi * 72, per image', async () => {
    const at72 = await mkFile('a72.png', makePng(300, 150, 72));
    const at300 = await mkFile('a300.png', makePng(300, 150, 300));

    const out72 = await runAdapter(pngAdapter, at72, {});
    const out300 = await runAdapter(pngAdapter, at300, {});

    expect(isPdfBytes(out72.bytes)).toBe(true);
    expect(out72.pageCount).toBe(1);
    const size72 = (await pageSizes(out72.bytes))[0];
    const size300 = (await pageSizes(out300.bytes))[0];
    expect(size72.w).toBeCloseTo((300 / 72) * 72, 1);
    expect(size72.h).toBeCloseTo((150 / 72) * 72, 1);
    expect(size300.w).toBeCloseTo((300 / 300) * 72, 1);
    expect(size300.h).toBeCloseTo((150 / 300) * 72, 1);
    expect(size72.w).not.toBeCloseTo(size300.w, 1);
  });

  it('assumes 96 DPI and warns when no density metadata exists', async () => {
    const path = await mkFile('nodpi.png', makePng(192, 96));
    const out = await runAdapter(pngAdapter, path, {});
    const size = (await pageSizes(out.bytes))[0];
    expect(size.w).toBeCloseTo((192 / 96) * 72, 1);
    const warning = out.warnings.find((w) => w.code === 'dpi-assumed');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('96 DPI was assumed');
  });

  it('reads JPEG JFIF density and EXIF resolution', async () => {
    const jfif = await mkFile('jfif.jpg', makeJpeg(100, 200, { jfifDpi: 100 }));
    const outJfif = await runAdapter(jpegAdapter, jfif, {});
    const sizeJfif = (await pageSizes(outJfif.bytes))[0];
    expect(sizeJfif.w).toBeCloseTo((100 / 100) * 72, 1);
    expect(sizeJfif.h).toBeCloseTo((200 / 100) * 72, 1);
    expect(outJfif.warnings).toHaveLength(0);

    const exif = await mkFile('exif.jpg', makeJpeg(100, 200, { exifDpi: 200 }));
    const outExif = await runAdapter(jpegAdapter, exif, {});
    const sizeExif = (await pageSizes(outExif.bytes))[0];
    expect(sizeExif.w).toBeCloseTo((100 / 200) * 72, 1);
  });
});

describe('phase54 fixed page fit modes', () => {
  const fixed = {
    imagePageSizeMode: 'fixed',
    imageFixedPageSize: 'a4',
    imageFit: 'contain',
  } as const;

  it('contain letterboxes while preserving aspect', () => {
    const placement = computeImagePlacement(
      { widthPx: 300, heightPx: 300, dpiX: 72, dpiY: 72, dpiSource: 'png-phys' },
      resolveConvertOptions({ ...fixed }),
    );
    expect(placement.pageWidth).toBeCloseTo(595.28, 1);
    expect(placement.pageHeight).toBeCloseTo(841.89, 1);
    // Square source: drawn square, letterboxed vertically.
    expect(placement.width).toBeCloseTo(placement.height, 5);
    expect(placement.width).toBeLessThan(placement.pageHeight);
  });

  it('cover fills the page and crops (preserves aspect)', () => {
    const placement = computeImagePlacement(
      { widthPx: 300, heightPx: 300, dpiX: 72, dpiY: 72, dpiSource: 'png-phys' },
      resolveConvertOptions({ ...fixed, imageFit: 'cover' }),
    );
    expect(placement.width).toBeCloseTo(placement.height, 5);
    expect(placement.width).toBeGreaterThanOrEqual(placement.pageWidth);
    expect(placement.height).toBeGreaterThanOrEqual(placement.pageHeight);
  });

  it('actual places at native size without scaling', () => {
    const placement = computeImagePlacement(
      { widthPx: 72, heightPx: 36, dpiX: 72, dpiY: 72, dpiSource: 'png-phys' },
      resolveConvertOptions({ ...fixed, imageFit: 'actual' }),
    );
    expect(placement.width).toBeCloseTo(72, 5);
    expect(placement.height).toBeCloseTo(36, 5);
  });
});

describe('phase54 rotation', () => {
  it('rotates image-sized page dimensions for 90/270', () => {
    const meta = { widthPx: 300, heightPx: 150, dpiX: 72, dpiY: 72, dpiSource: 'png-phys' } as const;
    const r90 = computeImagePlacement(meta, resolveConvertOptions({ imageRotationDeg: 90 }));
    const r270 = computeImagePlacement(meta, resolveConvertOptions({ imageRotationDeg: 270 }));
    const r0 = computeImagePlacement(meta, resolveConvertOptions({ imageRotationDeg: 0 }));
    expect(r0.pageWidth).toBeCloseTo(300, 1);
    expect(r0.pageHeight).toBeCloseTo(150, 1);
    expect(r90.pageWidth).toBeCloseTo(150, 1);
    expect(r90.pageHeight).toBeCloseTo(300, 1);
    expect(r270.pageWidth).toBeCloseTo(150, 1);
    expect(r270.pageHeight).toBeCloseTo(300, 1);
    expect(r90.rotation).toBe(90);
  });

  it('draws a 90-degree rotated image on a real PDF (no letterbox)', async () => {
    const path = await mkFile('rot.png', makePng(300, 150, 72));
    const out = await runAdapter(pngAdapter, path, { imageRotationDeg: 90 });
    const size = (await pageSizes(out.bytes))[0];
    expect(size.w).toBeCloseTo(150, 1);
    expect(size.h).toBeCloseTo(300, 1);
  });
});

describe('phase54 magic-byte routing', () => {
  it('a .png-named JPEG routes to the JPEG adapter', async () => {
    const path = await mkFile('mislabelled.png', makeJpeg(10, 10, { jfifDpi: 72 }));
    const head = await readSniffHead(path);
    expect(pngAdapter.sniff(path, head)).toBe(false);
    expect(jpegAdapter.sniff(path, head)).toBe(true);
    const resolved = await createDefaultRegistry().resolve(path, head);
    expect(resolved?.adapter.id).toBe('jpeg');
  });

  it('a .jpg-named PNG routes to the PNG adapter', async () => {
    const path = await mkFile('mislabelled.jpg', makePng(10, 10, 72));
    const head = await readSniffHead(path);
    const resolved = await createDefaultRegistry().resolve(path, head);
    expect(resolved?.adapter.id).toBe('png');
  });
});

describe('phase54 toDocumentMany', () => {
  interface Loaded {
    docId: string;
    bytes: Uint8Array;
  }

  function makeService(loaded: Loaded[]) {
    return new DocumentConversionService({
      engine: {
        loadDocumentBytes: async (docId, bytes) => {
          loaded.push({ docId, bytes: new Uint8Array(bytes) });
          return ok(new ArrayBuffer(0));
        },
      },
      registry: createDefaultRegistry(),
    });
  }

  it('composes mixed PNG+JPEG into one document in order', async () => {
    const png = await mkFile('one.png', makePng(300, 150, 72));
    const jpg = await mkFile('two.jpg', makeJpeg(100, 200, { jfifDpi: 100 }));
    const loaded: Loaded[] = [];
    const service = makeService(loaded);

    const result = await service.toDocumentMany('doc-1', [png, jpg]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pageCount).toBe(2);
    expect(result.value.sourceFormats).toEqual(['png', 'jpeg']);
    expect(isPdfBytes(loaded[0].bytes)).toBe(true);
    const sizes = await pageSizes(loaded[0].bytes);
    expect(sizes[0].w).toBeCloseTo(300, 1);
    expect(sizes[1].w).toBeCloseTo(72, 1);
    expect(sizes[1].h).toBeCloseTo(144, 1);
  });

  it('rejects a .csv in the list, naming it, with no document registered', async () => {
    const png = await mkFile('ok.png', makePng(10, 10, 72));
    const csv = await mkFile('bad.csv', Buffer.from('a,b\n1,2\n', 'utf8'));
    const loaded: Loaded[] = [];
    const service = makeService(loaded);

    const result = await service.toDocumentMany('doc-2', [png, csv]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unsupported-format');
    expect(result.error.message).toContain('bad.csv');
    expect(loaded).toHaveLength(0);
  });
});
