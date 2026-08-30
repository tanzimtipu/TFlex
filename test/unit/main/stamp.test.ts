import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-stamp-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function createNPagePdf(n: number): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
  }
  const bytes = await doc.save();
  const path = await writeFixture(`stamp${n}.pdf`, bytes);
  return { path, bytes };
}

/** Build a minimal valid PNG of the given dimensions (solid colour). */
function createMinimalPng(width = 100, height = 80): Uint8Array {
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function createChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    let crc = 0xffffffff;
    const table = crc32Table();
    for (const b of Buffer.concat([typeB, data])) {
      crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc, 0);
    return Buffer.concat([length, typeB, data, crcB]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rawRows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = 200;
      row[1 + x * 3 + 1] = 50;
      row[1 + x * 3 + 2] = 50;
    }
    rawRows.push(row);
  }
  const idat = createChunk('IDAT', zlib.deflateSync(Buffer.concat(rawRows)));
  return new Uint8Array(Buffer.concat([
    sig, createChunk('IHDR', ihdr), idat, createChunk('IEND', Buffer.alloc(0)),
  ]));
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
}

/** Count the image XObject entries on a page (0 when /Resources has no
 *  /XObject, or the XObject dict is empty). */
function xobjectCount(doc: PDFDocument, pageIndex: number): number {
  const res = doc.getPage(pageIndex).node.Resources();
  if (!res) return 0;
  const xobjRef = res.get(PDFName.of('XObject'));
  if (!xobjRef) return 0;
  const xobj = doc.context.lookup(xobjRef) as any;
  if (!xobj || typeof xobj.asMap !== 'function') return 0;
  return xobj.asMap().size;
}

describe('Phase 12: addStamp', () => {
  it('embeds the stamp raster at the rect and survives a save round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-st', path);
    const png = createMinimalPng(120, 60);

    const r = await engine.addStamp('doc-st', {
      page: 1,
      rect: { x: 72, y: 72, width: 120, height: 60 },
      stampId: 'APPROVED',
      name: 'Approved',
      pngBytes: png,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.modified).toBe(true);

    const saveR = await engine.save('doc-st');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const xobjRef = re.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeDefined();
    const xobj = re.context.lookup(xobjRef) as any;
    expect(xobj.asMap().size).toBeGreaterThanOrEqual(1);
  });

  it('each built-in stampId is accepted', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ids', path);
    const png = createMinimalPng(40, 30);
    for (const id of ['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'FINAL'] as const) {
      const r = await engine.addStamp('doc-ids', {
        page: 1,
        rect: { x: 10, y: 10, width: 40, height: 30 },
        stampId: id,
        name: id,
        pngBytes: png,
      });
      expect(r.ok).toBe(true);
      await engine.undo('doc-ids');
    }
  });

  it('is undoable (the embedded image is gone after undo)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-undo', path);
    const png = createMinimalPng(50, 50);

    // Before: no image XObject on the page.
    const beforeSave = await engine.saveAs('doc-undo', join(dir, 'before.pdf'));
    expect(beforeSave.ok).toBe(true);
    if (!beforeSave.ok) return;
    const before = await PDFDocument.load(await readFile(beforeSave.value));
    expect(xobjectCount(before, 0)).toBe(0);

    await engine.addStamp('doc-undo', {
      page: 1,
      rect: { x: 100, y: 100, width: 50, height: 50 },
      stampId: 'DRAFT',
      name: 'Draft',
      pngBytes: png,
    });
    const u = await engine.undo('doc-undo');
    expect(u.ok).toBe(true);
    if (!u.ok) return;

    const afterSave = await engine.saveAs('doc-undo', join(dir, 'after.pdf'));
    expect(afterSave.ok).toBe(true);
    if (!afterSave.ok) return;
    const after = await PDFDocument.load(await readFile(afterSave.value));
    expect(xobjectCount(after, 0)).toBe(0);
  });

  it('rejects an invalid stampId', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-bad', path);
    const r = await engine.addStamp('doc-bad', {
      page: 1,
      rect: { x: 10, y: 10, width: 40, height: 30 },
      stampId: 'REVIEWED' as any,
      name: 'x',
      pngBytes: createMinimalPng(40, 30),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('returns out-of-range for an invalid page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-oob', path);
    const r = await engine.addStamp('doc-oob', {
      page: 9,
      rect: { x: 10, y: 10, width: 40, height: 30 },
      stampId: 'APPROVED',
      name: 'x',
      pngBytes: createMinimalPng(40, 30),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects an empty pngBytes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-empty', path);
    const r = await engine.addStamp('doc-empty', {
      page: 1,
      rect: { x: 10, y: 10, width: 40, height: 30 },
      stampId: 'APPROVED',
      name: 'x',
      pngBytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.addStamp('no-such-doc', {
      page: 1,
      rect: { x: 10, y: 10, width: 40, height: 30 },
      stampId: 'APPROVED',
      name: 'x',
      pngBytes: createMinimalPng(40, 30),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});
