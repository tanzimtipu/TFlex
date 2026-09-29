import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { ok } from '../../../src/shared/result';
import type { ImageImportDefaults } from '../../../src/shared/types';
import { DEFAULT_IMAGE_IMPORT_DEFAULTS } from '../../../src/shared/types';
import {
  DocumentConversionService,
  type ConvertEnginePort,
} from '../../../src/main/services/convert';
import { createDefaultRegistry } from '../../../src/main/services/convert/registry';

/**
 * The DEF-388 defect class, one phase earlier: the stored
 * `imageImportDefaults` must reach the image adapter with NO options from the
 * caller.
 *
 * This test drives the REAL `DocumentConversionService` end to end: the REAL
 * `createDefaultRegistry` loads the REAL PNG adapter, the service reads the
 * settings through its `getImageImportDefaults` port exactly as
 * `src/main/index.ts` wires it, and `toDocument` is called with NO options.
 * Only the engine port is a stub (it captures the bytes the adapter produced),
 * mirroring the DEF-388 proof, where only the print function was faked.
 */

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
  session: {
    fromPartition: vi.fn(() => ({
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    })),
    defaultSession: {},
  },
  BrowserWindow: class {},
}));

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

/** A valid 8-bit RGBA PNG with a pHYs density in dots-per-inch. A 300x150 px
 *  image at 72 DPI is a 300x150 pt physical page in `'image'` mode. */
function makePng(width: number, height: number, dpi: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(Buffer.alloc(stride, 0x80), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 0);
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 4);
  phys[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('pHYs', phys),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-image-settings-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkPng(name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, makePng(300, 150, 72));
  return path;
}

/** Run the REAL service over a PNG, with the stored image settings supplied
 *  through the same port `src/main/index.ts` uses and NO per-call options. */
async function convertThroughService(
  path: string,
  image: ImageImportDefaults,
  callerOptions?: Parameters<DocumentConversionService['toDocument']>[2],
): Promise<Uint8Array> {
  let produced: Uint8Array | undefined;
  const engine: ConvertEnginePort = {
    loadDocumentBytes: async (_docId, bytes) => {
      produced = bytes;
      return ok(new ArrayBuffer(0));
    },
  };
  const service = new DocumentConversionService({
    engine,
    registry: createDefaultRegistry(),
    getImageImportDefaults: () => image,
  });
  const result = await service.toDocument(
    `doc-${Math.random().toString(36).slice(2)}`,
    path,
    callerOptions,
  );
  if (!result.ok) {
    throw new Error(`conversion failed: ${result.error.code} ${result.error.message}`);
  }
  if (produced === undefined) throw new Error('the adapter produced no bytes');
  return produced;
}

async function pageBox(bytes: Uint8Array): Promise<{ w: number; h: number }> {
  const doc = await PDFDocument.load(bytes);
  const size = doc.getPages()[0].getSize();
  return { w: size.width, h: size.height };
}

/** The drawn-image footprint, read from the last `a 0 0 d 0 0 cm` matrix the
 *  adapter's `drawImage` emits (translation/rotate are separate ops). The page
 *  box stays the fixed page in `'fixed'` mode; `fit` changes THIS rectangle. */
async function drawnFootprint(bytes: Uint8Array): Promise<{ w: number; h: number }> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const contents = page.node.Contents();
  let text = '';
  const append = (stream: unknown): void => {
    if (stream instanceof PDFRawStream) {
      text += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    }
  };
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i += 1) {
      append(doc.context.lookup(contents.get(i)));
    }
  } else {
    append(contents);
  }
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?) 0 0 (\d+(?:\.\d+)?) 0 0 cm/g)];
  // The adapter emits translate/rotate as separate ops; the identity
  // `1 0 0 1 0 0 cm` is not a scale, so the drawn-image scale is the last
  // matrix that is not that identity.
  const scales = matches.filter(
    (m) => !(Number(m[1]) === 1 && Number(m[2]) === 1),
  );
  const last = scales[scales.length - 1];
  if (last === undefined) throw new Error('no image placement matrix found');
  return { w: Number(last[1]), h: Number(last[2]) };
}

describe('imageImportDefaults reach the image import with no caller options', () => {
  it('defaults to DEFAULT_IMAGE_IMPORT_DEFAULTS: image mode boxes the page to the physical size', async () => {
    const path = await mkPng('physical.png');
    const bytes = await convertThroughService(path, DEFAULT_IMAGE_IMPORT_DEFAULTS);
    const box = await pageBox(bytes);
    // 300x150 px at 72 DPI = 300x150 pt.
    expect(box.w).toBeCloseTo(300, 1);
    expect(box.h).toBeCloseTo(150, 1);
  });

  it('pageSizeMode changes the outcome: fixed mode boxes the page to A4', async () => {
    const path = await mkPng('fixed.png');
    const intro = await convertThroughService(path, {
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      pageSizeMode: 'image',
    });
    const fixed = await convertThroughService(path, {
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      pageSizeMode: 'fixed',
    });
    const introBox = await pageBox(intro);
    const fixedBox = await pageBox(fixed);
    expect(introBox.w).toBeCloseTo(300, 1);
    expect(introBox.h).toBeCloseTo(150, 1);
    expect(fixedBox.w).toBeCloseTo(595.28, 1);
    expect(fixedBox.h).toBeCloseTo(841.89, 1);
    expect(introBox.w).not.toBeCloseTo(fixedBox.w, 0);
  });

  it('fit changes the outcome: contain, cover and actual draw different footprints', async () => {
    const path = await mkPng('fit.png');
    const base: ImageImportDefaults = {
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      pageSizeMode: 'fixed',
    };
    const contain = await convertThroughService(path, { ...base, fit: 'contain' });
    const cover = await convertThroughService(path, { ...base, fit: 'cover' });
    const actual = await convertThroughService(path, { ...base, fit: 'actual' });

    const containFoot = await drawnFootprint(contain);
    const coverFoot = await drawnFootprint(cover);
    const actualFoot = await drawnFootprint(actual);
    // contain: min(595.28/300, 841.89/150) = 1.9843 -> 595.28 x 297.64.
    expect(containFoot.w).toBeCloseTo(595.28, 1);
    expect(containFoot.h).toBeCloseTo(297.64, 1);
    // cover: max(595.28/300, 841.89/150) = 5.6126 -> 1683.8 x 841.89.
    expect(coverFoot.w).toBeCloseTo(1683.8, 0);
    expect(coverFoot.h).toBeCloseTo(841.89, 1);
    // actual: native 300 x 150 at its DPI, no scaling.
    expect(actualFoot.w).toBeCloseTo(300, 1);
    expect(actualFoot.h).toBeCloseTo(150, 1);
    expect(containFoot.w).not.toBeCloseTo(coverFoot.w, 0);
    expect(actualFoot.w).not.toBeCloseTo(containFoot.w, 0);
  });

  it('rotationDeg changes the outcome: 90 transposes the image-mode page box', async () => {
    const path = await mkPng('rotated.png');
    const zero = await convertThroughService(path, {
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      rotationDeg: 0,
    });
    const ninety = await convertThroughService(path, {
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      rotationDeg: 90,
    });
    const zeroBox = await pageBox(zero);
    const ninetyBox = await pageBox(ninety);
    expect(zeroBox.w).toBeCloseTo(300, 1);
    expect(zeroBox.h).toBeCloseTo(150, 1);
    expect(ninetyBox.w).toBeCloseTo(150, 1);
    expect(ninetyBox.h).toBeCloseTo(300, 1);
    expect(ninetyBox.w).not.toBeCloseTo(zeroBox.w, 1);
  });

  it('lets an explicit caller option win over the stored setting', async () => {
    const path = await mkPng('precedence.png');
    const bytes = await convertThroughService(
      path,
      { ...DEFAULT_IMAGE_IMPORT_DEFAULTS, rotationDeg: 90 },
      { imageRotationDeg: 0 },
    );
    const box = await pageBox(bytes);
    expect(box.w).toBeCloseTo(300, 1);
    expect(box.h).toBeCloseTo(150, 1);
  });
});
