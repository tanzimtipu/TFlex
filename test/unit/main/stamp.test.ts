import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
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

  // DEF-085 (Bug 8): the engine must embed the EXACT PNG bytes the renderer
  // sends — the image XObject's /Width and /Height must match the input
  // PNG's pixel dimensions, proving the bytes round-trip into the saved
  // file as a real image (not a blank or zero-byte placeholder). If the
  // renderer sends an empty canvas (all-transparent or zero-byte PNG),
  // the engine embeds THAT — the "stamp placed but not visible" bug is
  // the renderer producing blank bytes, not the engine dropping them.
  it('embedded image dimensions match the input PNG (Bug 8 engine-side)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-st8', path);
    const pngW = 120;
    const pngH = 60;
    const png = createMinimalPng(pngW, pngH);

    const r = await engine.addStamp('doc-st8', {
      page: 1,
      rect: { x: 72, y: 72, width: pngW, height: pngH },
      stampId: 'APPROVED',
      name: 'Approved',
      pngBytes: png,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Inspect the in-memory pdfDoc via getDocumentBytes so we don't save
    // (save would wipe the undo stack and isn't needed to verify the embed).
    const bytesR = await engine.getDocumentBytes('doc-st8');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const re = await PDFDocument.load(bytesR.value);
    const page = re.getPage(0);
    const res = page.node.Resources();
    expect(res).toBeDefined();
    const xobjRef = res!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeDefined();
    const xobj = re.context.lookup(xobjRef) as any;
    expect(xobj.asMap().size).toBeGreaterThanOrEqual(1);
    // Walk the XObject dict and find the image entry (/Subtype /Image).
    let imageEntry: any = null;
    const map = xobj.asMap();
    for (const [name, ref] of Array.from(map.entries() as Iterable<[string, any]>)) {
      const obj = re.context.lookup(ref) as any;
      const dict = obj?.dict ?? obj;
      const sub = dict.get ? dict.get(PDFName.of('Subtype')) : undefined;
      if (sub && sub.toString() === '/Image') {
        imageEntry = { name, ref, dict, obj };
        break;
      }
    }
    expect(imageEntry).not.toBeNull();
    // /Width and /Height must match the input PNG's pixel dimensions.
    const w = imageEntry.dict.get(PDFName.of('Width')).asNumber();
    const h = imageEntry.dict.get(PDFName.of('Height')).asNumber();
    expect(w).toBe(pngW);
    expect(h).toBe(pngH);
    // /Subtype must be /Image and /ColorSpace must be present (RGB for the
    // solid-colour PNG createMinimalPng produces — IHDR bit depth 8, colour
    // type 2).
    const subtype = imageEntry.dict.get(PDFName.of('Subtype')).toString();
    expect(subtype).toBe('/Image');
    const filter = imageEntry.dict.get(PDFName.of('Filter'));
    // PNG embeds use /FlateDecode (pdf-lib embedPng re-encodes as FlateDecode).
    expect(filter).toBeDefined();
    // The image stream bytes must be non-empty (the raw image data).
    const streamObj = imageEntry.obj;
    expect(streamObj?.contents).toBeDefined();
    expect(streamObj.contents.length).toBeGreaterThan(0);

    // The page's content stream must reference the image via a Do operator
    // (i.e. the image is actually drawn, not just embedded). Decode the
    // content stream and look for the XObject's resource name in a Do op.
    const { inflateSync } = require('node:zlib') as typeof import('node:zlib');
    const contents = page.node.Contents();
    expect(contents).toBeDefined();
    let contentText = '';
    const lookupContent = (ref: any): string => {
      const obj = re.context.lookup(ref) as any;
      if (!obj) return '';
      if (obj.constructor && obj.constructor.name === 'PDFArray') {
        let out = '';
        for (let i = 0; i < obj.size(); i++) out += lookupContent(obj.get(i));
        return out;
      }
      if (obj?.contents && typeof obj.contents.length === 'number') {
        try {
          const dec = inflateSync(obj.contents as Uint8Array);
          return new TextDecoder('latin1').decode(dec);
        } catch {
          return new TextDecoder('latin1').decode(obj.contents as Uint8Array);
        }
      }
      return '';
    };
    contentText = lookupContent(contents);
    // pdf-lib names embedded images with /Image-<n> (or /Im<n>); the
    // content stream must run a `Do` operator referencing that name. A
    // drawn image's content-stream slice looks like `... /Image-X Do`.
    // Assert at least one Do op runs, and the image's resource name (from
    // the XObject dict) appears in the content stream before a Do.
    expect(contentText).toMatch(/Do/);
    // Find the image's resource name in the XObject dict and assert the
    // content stream references that exact name.
    const xobjMap = xobj.asMap();
    let imageResourceName: string | null = null;
    for (const [name, ref] of Array.from(xobjMap.entries() as Iterable<[string, any]>)) {
      const obj2 = re.context.lookup(ref) as any;
      const dict2 = obj2?.dict ?? obj2;
      const sub2 = dict2.get ? dict2.get(PDFName.of('Subtype')) : undefined;
      if (sub2 && sub2.toString() === '/Image') {
        imageResourceName = name;
        break;
      }
    }
    expect(imageResourceName).not.toBeNull();
    // The name in the content stream is the PDFName without the leading '/'
    // (e.g. "Image-123"); the Do op references it as "/Image-123 Do".
    expect(contentText).toContain(imageResourceName as string);
    // And the Do operator must follow the name reference.
    expect(contentText).toMatch(new RegExp(imageResourceName as string + '\\s+Do'));
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
