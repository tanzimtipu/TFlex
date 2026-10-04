import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import {
  WATERMARK_POSITIONS,
  WATERMARK_TYPES,
  normalizeWatermarkSettings,
} from '../../../src/main/services/settings';
import type { WatermarkPosition, WatermarkSettings } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-watermark-'));
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
  const path = await writeFixture(`watermark${n}.pdf`, bytes);
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

/** Decode the (possibly compressed, possibly multi-stream) content stream
 *  of a page to a raw text string. */
function decodeContent(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const resolve = (r: any): any => {
    let o = doc.context.lookup(r);
    while (o && o.constructor?.name === 'PDFRef') o = doc.context.lookup(o);
    return o;
  };
  const read = (o: any): string => {
    if (!o) return '';
    if (o.constructor?.name === 'PDFArray') {
      let out = '';
      for (let i = 0; i < o.size(); i++) out += read(resolve(o.get(i)));
      return out;
    }
    if (o.contents) {
      try {
        return inflateSync(o.contents as Uint8Array).toString('latin1');
      } catch {
        return Buffer.from(o.contents as Uint8Array).toString('latin1');
      }
    }
    return '';
  };
  return read(resolve(contents));
}

/** Recover the drawn text from a decoded content stream. pdf-lib emits
 *  text as hex strings (`<434F...> Tj`), so decode both hex and literal
 *  `(text) Tj` forms. */
function drawnText(content: string): string {
  let out = '';
  let m: RegExpExecArray | null;
  const hexRe = /<([0-9A-Fa-f]+)>\s*Tj/g;
  while ((m = hexRe.exec(content)) !== null) {
    const hex = m[1];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  const litRe = /\((?:[^()\\]|\\.)*\)\s*Tj/g;
  while ((m = litRe.exec(content)) !== null) {
    out += m[1].replace(/\\([()\\])/g, '$1');
  }
  return out;
}

/** Extract the `1 0 0 1 x y Tm` translation pairs (text placement) from a
 *  decoded content stream. */
function tmTranslates(content: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  return out;
}

/** Extract the `w 0 0 h 0 0 cm` image-scale matrices plus the watermark's
 *  `1 0 0 1 x y cm` translation (pdf-lib's drawImage emits a translation
 *  matrix, then a scale matrix, then `Do`). Returns the first scale
 *  matrix that is not the identity and the first translation. */
function imagePlacement(content: string): { w: number; h: number; x: number; y: number } | null {
  let w = 0;
  let h = 0;
  let m: RegExpExecArray | null;
  const scaleRe = /([-.\d]+) 0 0 ([-.\d]+) 0 0 cm/g;
  while ((m = scaleRe.exec(content)) !== null) {
    const sw = parseFloat(m[1]);
    const sh = parseFloat(m[2]);
    if (sw !== 1 || sh !== 1) {
      w = sw;
      h = sh;
      break;
    }
  }
  const transRe = /1 0 0 1 ([-.\d]+) ([-.\d]+) cm/g;
  const t = transRe.exec(content);
  if (w === 0 || h === 0 || !t) return null;
  return { w, h, x: parseFloat(t[1]), y: parseFloat(t[2]) };
}

/** The fill-opacity (ca) value pdf-lib writes into the page's ExtGState
 *  when a watermark is drawn with an opacity; null when absent. */
function gstateFillOpacity(doc: PDFDocument, pageIndex: number): number | null {
  const res = doc.getPage(pageIndex).node.Resources();
  if (!res) return null;
  const gsRef = res.get(PDFName.of('ExtGState'));
  if (!gsRef) return null;
  const gsMap = doc.context.lookup(gsRef) as any;
  if (!gsMap || typeof gsMap.keys !== 'function') return null;
  const names = Array.from(gsMap.keys().values() as Iterable<any>);
  for (const nameObj of names) {
    const obj = doc.context.lookup(gsMap.get(nameObj)) as any;
    const ca = obj?.get?.(PDFName.of('ca'))?.asNumber?.();
    if (typeof ca === 'number') return ca;
  }
  return null;
}

describe('Phase 18: addWatermark (engine)', () => {
  it('applies a text watermark to all pages and survives a save round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-wm-all', path);

    const r = await engine.addWatermark('doc-wm-all', {
      type: 'text',
      text: 'CONFIDENTIAL',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.modified).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-wm-all');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    for (let i = 0; i < 2; i++) {
      const content = decodeContent(re, i);
      expect(drawnText(content)).toContain('CONFIDENTIAL');
      // Default opacity 0.5 must be written into the page's ExtGState.
      expect(gstateFillOpacity(re, i)).toBeCloseTo(0.5, 5);
    }
  });

  it('explicit x/y places the watermark at the requested top-left corner', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-xy', path);
    const x = 100;
    const y = 200;
    const r = await engine.addWatermark('doc-wm-xy', {
      type: 'text',
      text: 'CONFIDENTIAL',
      size: 48,
      x,
      y,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-wm-xy');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const content = decodeContent(re, 0);
    const tms = tmTranslates(content);
    expect(tms.length).toBeGreaterThanOrEqual(1);
    // The watermark is appended AFTER the fixture's own text, so it is the
    // last Tm in the stream. The engine draws the text box centered on
    // (x + w/2, y + h/2); the emitted Tm x is exactly `x` (the box's left
    // edge) and the baseline y is pageHeight - y - 0.8 * line-height
    // (bottom-left space).
    const probe = await PDFDocument.create();
    const font = await probe.embedFont(StandardFonts.Helvetica);
    const h = font.heightAtSize(48);
    const [tx, ty] = tms[tms.length - 1];
    expect(tx).toBeCloseTo(x, 1);
    expect(ty).toBeCloseTo(792 - y - h * 0.8, 1);
  });

  it('predefined positions place the watermark in the correct grid slot', async () => {
    // Measure the actual glyph box the engine uses (Helvetica, size 48).
    const probe = await PDFDocument.create();
    const probeFont = await probe.embedFont(StandardFonts.Helvetica);
    const w = probeFont.widthOfTextAtSize('WM', 48);
    const h = probeFont.heightAtSize(48);
    const pw = 612;
    const ph = 792;

    const slot: [string, WatermarkPosition][] = [
      ['top-left', 'top-left'],
      ['center', 'center'],
      ['bottom-right', 'bottom-right'],
    ];
    const tmsBySlot = new Map<string, [number, number]>();
    for (const [label, position] of slot) {
      const engine = new EngineService();
      const { path } = await createNPagePdf(1);
      await engine.loadDocument(`doc-wm-${label}`, path);
      const r = await engine.addWatermark(`doc-wm-${label}`, {
        type: 'text',
        text: 'WM',
        size: 48,
        position,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const saveR = await engine.save(`doc-wm-${label}`);
      expect(saveR.ok).toBe(true);
      if (!saveR.ok) return;
      const saved = await readFile(saveR.value);
      const re = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset, saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      const tms = tmTranslates(decodeContent(re, 0));
      expect(tms.length).toBeGreaterThanOrEqual(1);
      // The watermark is the last Tm (appended after the fixture text).
      tmsBySlot.set(label, tms[tms.length - 1]);
    }
    const top = tmsBySlot.get('top-left')!;
    const mid = tmsBySlot.get('center')!;
    const bot = tmsBySlot.get('bottom-right')!;
    // Expected Tm (bottom-left space): box TOP-LEFT per slot, converted
    // with the engine's 0.8 baseline factor.
    const expectTL = (position: string): [number, number] => {
      const mx = pw * 0.1;
      const my = ph * 0.1;
      const col = position.endsWith('left') ? 0 : position.endsWith('right') ? 1 : 0.5;
      const row = position.startsWith('top') ? 0 : position.startsWith('bottom') ? 1 : 0.5;
      const cx = col === 0 ? mx + w / 2 : col === 1 ? pw - mx - w / 2 : pw / 2;
      const cy = row === 0 ? my + h / 2 : row === 1 ? ph - my - h / 2 : ph / 2;
      return [cx - w / 2, ph - (cy - h / 2) - h * 0.8];
    };
    for (const [label, position] of slot) {
      const [tx, ty] = tmsBySlot.get(label)!;
      const [ex, ey] = expectTL(position);
      expect(tx).toBeCloseTo(ex, 0);
      expect(ty).toBeCloseTo(ey, 0);
    }
    // Ordering sanity: top slot above center above bottom slot; left slot
    // left of center left of right slot.
    expect(top[1]).toBeGreaterThan(mid[1]);
    expect(mid[1]).toBeGreaterThan(bot[1]);
    expect(top[0]).toBeLessThan(mid[0]);
    expect(mid[0]).toBeLessThan(bot[0]);
  });

  it('every predefined position is accepted', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-positions', path);
    for (const position of WATERMARK_POSITIONS) {
      const r = await engine.addWatermark('doc-wm-positions', {
        type: 'text',
        text: 'WM',
        position,
      });
      expect(r.ok, `position ${position} should be accepted`).toBe(true);
      await engine.undo('doc-wm-positions');
    }
  });

  it('image watermark embeds the exact raster and draws it at the size', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-img', path);
    const pngW = 120;
    const pngH = 60;
    const r = await engine.addWatermark('doc-wm-img', {
      type: 'image',
      imageBytes: createMinimalPng(pngW, pngH),
      size: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-wm-img');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const page = re.getPage(0);
    const res = page.node.Resources();
    expect(res).toBeDefined();
    const xobjRef = res!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeDefined();
    const xobj = re.context.lookup(xobjRef) as any;
    // Find the /Image entry and check its pixel dimensions match the input.
    let imageDict: any = null;
    let imageResourceName: string | null = null;
    for (const [name, ref] of Array.from(xobj.asMap().entries() as Iterable<[string, any]>)) {
      const obj = re.context.lookup(ref) as any;
      const dict = obj?.dict ?? obj;
      const sub = dict.get ? dict.get(PDFName.of('Subtype')) : undefined;
      if (sub && sub.toString() === '/Image') {
        imageDict = dict;
        imageResourceName = name;
        break;
      }
    }
    expect(imageDict).not.toBeNull();
    expect(imageResourceName).not.toBeNull();
    expect(imageDict.get(PDFName.of('Width')).asNumber()).toBe(pngW);
    expect(imageDict.get(PDFName.of('Height')).asNumber()).toBe(pngH);

    // The content stream must draw the image (translation cm + scale cm + Do)
    // at the requested height (size) with width scaled to the aspect ratio,
    // centered on the page (the default slot).
    const content = decodeContent(re, 0);
    const placement = imagePlacement(content);
    expect(placement).not.toBeNull();
    expect(placement!.h).toBeCloseTo(60, 1);
    expect(placement!.w).toBeCloseTo(60 * (pngW / pngH), 1);
    expect(placement!.x).toBeCloseTo(306 - 60 * (pngW / pngH) / 2, 1);
    expect(placement!.y).toBeCloseTo(792 - 396 - 30, 1);
    expect(content).toMatch(new RegExp(imageResourceName as string + '\\s+Do'));
  });

  it('image watermark without size defaults to 33% of the shorter page side', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-imgsize', path);
    const pngW = 120;
    const pngH = 60;
    const r = await engine.addWatermark('doc-wm-imgsize', {
      type: 'image',
      imageBytes: createMinimalPng(pngW, pngH),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saveR = await engine.save('doc-wm-imgsize');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const placement = imagePlacement(decodeContent(re, 0));
    expect(placement).not.toBeNull();
    const expectedH = Math.min(612, 792) * 0.33;
    expect(placement!.h).toBeCloseTo(expectedH, 0);
    expect(placement!.w).toBeCloseTo(expectedH * (pngW / pngH), 0);
  });

  it('page range applies the watermark only to the selected pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-wm-range', path);
    const r = await engine.addWatermark('doc-wm-range', {
      type: 'text',
      text: 'PAGE2ONLY',
      range: [2, 2],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saveR = await engine.save('doc-wm-range');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    expect(drawnText(decodeContent(re, 0))).not.toContain('PAGE2ONLY');
    expect(drawnText(decodeContent(re, 1))).toContain('PAGE2ONLY');
    expect(drawnText(decodeContent(re, 2))).not.toContain('PAGE2ONLY');
  });

  it('tile repeats the watermark across the page in a staggered grid', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-tile', path);
    const r = await engine.addWatermark('doc-wm-tile', {
      type: 'text',
      text: 'TILE',
      size: 48,
      tile: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saveR = await engine.save('doc-wm-tile');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const text = drawnText(decodeContent(re, 0));
    const count = text.split('TILE').length - 1;
    // A 612x792 page tiled at 48pt must hold well over a dozen copies.
    expect(count).toBeGreaterThan(10);
  });

  it('is undoable (the baked watermark is gone after undo)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-undo', path);

    const beforeSave = await engine.saveAs('doc-wm-undo', join(dir, 'before.pdf'));
    expect(beforeSave.ok).toBe(true);
    if (!beforeSave.ok) return;
    const before = await PDFDocument.load(await readFile(beforeSave.value));
    expect(drawnText(decodeContent(before, 0))).not.toContain('CONFIDENTIAL');

    await engine.addWatermark('doc-wm-undo', {
      type: 'text',
      text: 'CONFIDENTIAL',
    });
    const u = await engine.undo('doc-wm-undo');
    expect(u.ok).toBe(true);
    if (!u.ok) return;

    const afterSave = await engine.saveAs('doc-wm-undo', join(dir, 'after.pdf'));
    expect(afterSave.ok).toBe(true);
    if (!afterSave.ok) return;
    const after = await PDFDocument.load(await readFile(afterSave.value));
    expect(drawnText(decodeContent(after, 0))).not.toContain('CONFIDENTIAL');
  });

  it('rejects an unknown watermark type', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-badtype', path);
    const r = await engine.addWatermark('doc-wm-badtype', {
      type: 'shape' as WatermarkSettings['type'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('rejects a text watermark without text', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-notext', path);
    const r = await engine.addWatermark('doc-wm-notext', { type: 'text' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('rejects an image watermark with empty bytes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-emptyimg', path);
    const r = await engine.addWatermark('doc-wm-emptyimg', {
      type: 'image',
      imageBytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('rejects an out-of-range page range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-wm-oob', path);
    const r = await engine.addWatermark('doc-wm-oob', {
      type: 'text',
      text: 'X',
      range: [1, 9],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects image bytes that are neither PNG nor JPEG and leaves the doc intact', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-badimg', path);
    const r = await engine.addWatermark('doc-wm-badimg', {
      type: 'image',
      imageBytes: new TextEncoder().encode('not an image'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
    const bytesR = await engine.getDocumentBytes('doc-wm-badimg');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const re = await PDFDocument.load(bytesR.value);
    expect(xobjectCount(re, 0)).toBe(0);
  });

  it('rejects a payload with present-but-invalid optional fields (no silent fallback)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-drop', path);
    const r = await engine.addWatermark('doc-wm-drop', {
      type: 'text',
      text: 'WM',
      font: 'Arial' as WatermarkSettings['font'],
      position: 'middle' as WatermarkSettings['position'],
      x: 100, // y absent -> reject (never fall back to the grid slot)
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');

    // Nothing was stamped and the document is not dirty.
    const g = await engine.getWatermarks('doc-wm-drop');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([]);
    const m = await engine.isModified('doc-wm-drop');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toBe(false);
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.addWatermark('no-such-doc', {
      type: 'text',
      text: 'X',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

describe('Phase 18: normalizeWatermarkSettings', () => {
  it('preserves a fully valid settings object', () => {
    const raw = {
      type: 'text',
      text: 'CONFIDENTIAL',
      font: 'Times',
      bold: true,
      italic: false,
      size: 36,
      color: { r: 0.2, g: 0.4, b: 0.6 },
      opacity: 0.3,
      position: 'top-center',
      x: 10,
      y: 20,
      tile: false,
      range: [2, 5],
    };
    const out = normalizeWatermarkSettings(raw);
    expect(out).not.toBeNull();
    expect(out?.type).toBe('text');
    expect(out?.text).toBe('CONFIDENTIAL');
    expect(out?.font).toBe('Times');
    expect(out?.bold).toBe(true);
    expect(out?.italic).toBe(false);
    expect(out?.size).toBe(36);
    expect(out?.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(out?.opacity).toBe(0.3);
    expect(out?.position).toBe('top-center');
    expect(out?.x).toBe(10);
    expect(out?.y).toBe(20);
    expect(out?.tile).toBe(false);
    expect(out?.range).toEqual([2, 5]);
  });

  it('preserves an image watermark with Uint8Array and ArrayBuffer bytes', () => {
    const png = createMinimalPng(10, 10);
    const fromU8 = normalizeWatermarkSettings({ type: 'image', imageBytes: png });
    expect(fromU8).not.toBeNull();
    expect(fromU8?.type).toBe('image');
    expect(fromU8?.imageBytes instanceof Uint8Array).toBe(true);
    const fromAb = normalizeWatermarkSettings({
      type: 'image',
      imageBytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    });
    expect(fromAb).not.toBeNull();
    expect(fromAb?.imageBytes instanceof Uint8Array).toBe(true);
    const fromAbBytes = fromAb!.imageBytes!;
    const fromAbLen = fromAbBytes instanceof Uint8Array
      ? fromAbBytes.length
      : new Uint8Array(fromAbBytes as ArrayBuffer).length;
    expect(fromAbLen).toBe(png.length);
  });

  it('returns null for invalid core fields', () => {
    expect(normalizeWatermarkSettings(null)).toBeNull();
    expect(normalizeWatermarkSettings('text')).toBeNull();
    expect(normalizeWatermarkSettings({})).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'shape' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: '' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'image' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'image', imageBytes: new Uint8Array(0) })).toBeNull();
  });

  it('accepts exactly the documented types and positions', () => {
    expect(WATERMARK_TYPES).toEqual(['text', 'image']);
    expect(WATERMARK_POSITIONS).toHaveLength(9);
    for (const p of WATERMARK_POSITIONS) {
      const out = normalizeWatermarkSettings({ type: 'text', text: 'x', position: p });
      expect(out?.position, `position ${p} should be preserved`).toBe(p);
    }
  });

  it('clamps opacity into 0..1 (documented, unchanged behaviour)', () => {
    const high = normalizeWatermarkSettings({ type: 'text', text: 'x', opacity: 2 });
    expect(high).not.toBeNull();
    expect(high?.opacity).toBe(1);
    const low = normalizeWatermarkSettings({ type: 'text', text: 'x', opacity: -1 });
    expect(low).not.toBeNull();
    expect(low?.opacity).toBe(0);
  });

  it('rejects a present-but-invalid range instead of dropping it (DEF-218)', () => {
    const badRanges: unknown[] = [
      [0, 0], [3, 2], [1.5, 3], ['1', 2], [1, 2, 3], [Number.NaN, 2], [-5, -1],
    ];
    for (const range of badRanges) {
      expect(
        normalizeWatermarkSettings({ type: 'text', text: 'x', range }),
        `range ${JSON.stringify(range)} should reject`,
      ).toBeNull();
    }
  });

  it('rejects a present-but-invalid size (DEF-217 lower/upper bound)', () => {
    for (const size of [0, -5, Number.NaN, 2001, Number.POSITIVE_INFINITY]) {
      expect(
        normalizeWatermarkSettings({ type: 'text', text: 'x', size }),
        `size ${String(size)} should reject`,
      ).toBeNull();
    }
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', size: 1 })?.size).toBe(1);
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', size: 2000 })?.size).toBe(2000);
  });

  it('rejects x/y when only one is present or either is non-finite', () => {
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', x: 100 })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', y: 100 })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', x: 100, y: Number.NaN })).toBeNull();
    // Both present and finite (any sign) is valid.
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', x: -10, y: 20 })).toMatchObject({
      x: -10,
      y: 20,
    });
  });

  it('rejects present-but-invalid color, font, position and booleans', () => {
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', color: { r: 2, g: 0, b: 0 } })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', color: null })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', font: 'Arial' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', position: 'nowhere' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', underline: 'yes' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', tile: 1 })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', bold: 'yes' })).toBeNull();
    expect(normalizeWatermarkSettings({ type: 'text', text: 'x', italic: 0 })).toBeNull();
  });

  it('preserves a valid underline boolean', () => {
    const kept = normalizeWatermarkSettings({
      type: 'text',
      text: 'x',
      underline: true,
    });
    expect(kept).not.toBeNull();
    expect(kept?.underline).toBe(true);
  });
});

/** Count the entries in a page's Contents array (0 when the page has no
 *  content stream at all). */
function contentsLength(doc: PDFDocument, pageIndex: number): number {
  const c = doc.getPage(pageIndex).node.normalizedEntries().Contents;
  if (!c) return 0;
  return c instanceof PDFArray ? c.size() : 1;
}

describe('Phase 18 / DEF-216: watermark identity (getWatermarks/deleteWatermark)', () => {
  it('underline renders a filled rule after the text ops, text still drawn', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-underline', path);
    const r = await engine.addWatermark('doc-wm-underline', {
      type: 'text',
      text: 'UNDERLINE',
      size: 48,
      underline: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bytesR = await engine.getDocumentBytes('doc-wm-underline');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const re = await PDFDocument.load(bytesR.value);
    const content = decodeContent(re, 0);
    // The rule is a `... re` rectangle + `f` fill emitted AFTER the text.
    const textIdx = content.indexOf('Tj');
    expect(textIdx).toBeGreaterThanOrEqual(0);
    const reIdx = content.search(/ re\n/);
    expect(reIdx).toBeGreaterThan(textIdx);
    const fIdx = content.indexOf('\nf\n', reIdx);
    expect(fIdx).toBeGreaterThan(reIdx);
    // The watermark text itself is still drawn.
    expect(drawnText(content)).toContain('UNDERLINE');
  });

  it('getWatermarks reports one record for a text watermark on pages 1-2', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-wm-list', path);
    const r = await engine.addWatermark('doc-wm-list', {
      type: 'text',
      text: 'LISTME',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = await engine.getWatermarks('doc-wm-list');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([{ id: 'wm-1', type: 'text', text: 'LISTME', pages: [1, 2] }]);
  });

  it('a second addWatermark is assigned the next id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-two', path);
    const r1 = await engine.addWatermark('doc-wm-two', {
      type: 'text',
      text: 'FIRST',
    });
    const r2 = await engine.addWatermark('doc-wm-two', {
      type: 'text',
      text: 'SECOND',
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const g = await engine.getWatermarks('doc-wm-two');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value.map((w) => w.id)).toEqual(['wm-1', 'wm-2']);
    expect(g.value.map((w) => w.text)).toEqual(['FIRST', 'SECOND']);
  });

  it('deleteWatermark removes the stream and the Contents array is back to pre-apply size', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-wm-del', path);
    // Establish the baseline AFTER a first apply/delete round trip: the
    // engine's watermark ops normalise each page's Contents (this pdf-lib
    // build's autoNormalizeCTM wraps it with the context's shared q/Q streams),
    // so the pre-apply measurement is taken in the same normalized state the
    // document is in after apply/delete. DEF-515: a read-only scan no longer
    // normalises, so the warm-up must go through an apply op instead.
    const warm = await engine.addWatermark('doc-wm-del', { type: 'text', text: 'WARMUP' });
    expect(warm.ok).toBe(true);
    if (!warm.ok) return;
    const warmDelete = await engine.deleteWatermark('doc-wm-del', 'wm-1');
    expect(warmDelete.ok).toBe(true);
    if (!warmDelete.ok) return;

    const preR = await engine.getDocumentBytes('doc-wm-del');
    expect(preR.ok).toBe(true);
    if (!preR.ok) return;
    const pre = await PDFDocument.load(preR.value);
    const preLen = contentsLength(pre, 0);
    expect(contentsLength(pre, 1)).toBe(preLen);

    const r = await engine.addWatermark('doc-wm-del', {
      type: 'text',
      text: 'DELME',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const midR = await engine.getDocumentBytes('doc-wm-del');
    expect(midR.ok).toBe(true);
    if (!midR.ok) return;
    const mid = await PDFDocument.load(midR.value);
    expect(contentsLength(mid, 0)).toBe(preLen + 1);

    const d = await engine.deleteWatermark('doc-wm-del', 'wm-1');
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    const g = await engine.getWatermarks('doc-wm-del');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([]);

    const postR = await engine.getDocumentBytes('doc-wm-del');
    expect(postR.ok).toBe(true);
    if (!postR.ok) return;
    const post = await PDFDocument.load(postR.value);
    expect(contentsLength(post, 0)).toBe(preLen);
    expect(contentsLength(post, 1)).toBe(preLen);
  });

  it('the marker survives save + reopen: a fresh engine still finds and deletes it', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-persist', path);
    const r = await engine.addWatermark('doc-wm-persist', {
      type: 'text',
      text: 'PERSIST',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const savedPath = join(dir, 'wm-persist.pdf');
    const s = await engine.saveAs('doc-wm-persist', savedPath);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const fileBytes = await readFile(savedPath);
    const onDisk = await PDFDocument.load(fileBytes.buffer.slice(
      fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength,
    ) as ArrayBuffer);
    // The uncompressed marker line is present in the SAVED file itself.
    expect(decodeContent(onDisk, 0)).toContain('%TFLEX-WATERMARK');

    // Reopen the saved bytes in a FRESH engine service.
    const engine2 = new EngineService();
    const freshBytes = new Uint8Array(fileBytes.buffer.slice(
      fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength,
    ));
    const loadR = await engine2.loadDocumentBytes('doc-wm-persist2', freshBytes);
    expect(loadR.ok).toBe(true);
    if (!loadR.ok) return;
    const g2 = await engine2.getWatermarks('doc-wm-persist2');
    expect(g2.ok).toBe(true);
    if (!g2.ok) return;
    expect(g2.value).toEqual([{ id: 'wm-1', type: 'text', text: 'PERSIST', pages: [1] }]);

    const del2 = await engine2.deleteWatermark('doc-wm-persist2', 'wm-1');
    expect(del2.ok).toBe(true);
    if (!del2.ok) return;
    const bytes2 = await engine2.getDocumentBytes('doc-wm-persist2');
    expect(bytes2.ok).toBe(true);
    if (!bytes2.ok) return;
    const re2 = await PDFDocument.load(bytes2.value);
    const content2 = decodeContent(re2, 0);
    expect(content2).not.toContain('%TFLEX-WATERMARK');
    expect(drawnText(content2)).not.toContain('PERSIST');
  });

  it('deleteWatermark rejects an unknown id with engine-error (no silent success)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-unknown', path);
    const a = await engine.addWatermark('doc-wm-unknown', {
      type: 'text',
      text: 'X',
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    const r = await engine.deleteWatermark('doc-wm-unknown', 'wm-99');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');

    const rEmpty = await engine.deleteWatermark('doc-wm-unknown', '');
    expect(rEmpty.ok).toBe(false);
    if (!rEmpty.ok) expect(rEmpty.error.code).toBe('engine-error');

    // The document is untouched: wm-1 is still listed.
    const g = await engine.getWatermarks('doc-wm-unknown');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value.map((w) => w.id)).toEqual(['wm-1']);
  });
});

describe('Phase 18 / DEF-217+DEF-220: watermark bounds', () => {
  it('rejects a tiny tiled size and leaves the document untouched (DEF-217)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-tiny', path);

    // Baseline in the same normalized state the watermark ops leave behind
    // (the read-only marker scan normalizes each page's Contents).
    const norm = await engine.getWatermarks('doc-wm-tiny');
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;
    expect(norm.value).toEqual([]);
    const preR = await engine.getDocumentBytes('doc-wm-tiny');
    expect(preR.ok).toBe(true);
    if (!preR.ok) return;
    const pre = await PDFDocument.load(preR.value);
    const preLen = contentsLength(pre, 0);

    const r = await engine.addWatermark('doc-wm-tiny', {
      type: 'text',
      text: 'X',
      size: 0.25,
      tile: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      // `size: 0.25` is below MIN_WATERMARK_SIZE, so this is rejected at
      // validation (the placement cap is exercised separately below).
      expect(r.error.message).toMatch(/settings are invalid|more than 5000 copies/);
    }

    const g = await engine.getWatermarks('doc-wm-tiny');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([]);

    const postR = await engine.getDocumentBytes('doc-wm-tiny');
    expect(postR.ok).toBe(true);
    if (!postR.ok) return;
    const post = await PDFDocument.load(postR.value);
    expect(contentsLength(post, 0)).toBe(preLen);
    expect(drawnText(decodeContent(post, 0))).not.toContain('X');

    const m = await engine.isModified('doc-wm-tiny');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toBe(false);
  });

  it('rejects a valid-but-tiny tiled size once it exceeds the placement cap (DEF-220)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-tile-cap', path);
    const r = await engine.addWatermark('doc-wm-tile-cap', {
      type: 'text',
      text: 'X',
      size: 1,
      tile: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toBe(
        'addWatermark: tiling at this size would place more than 5000 copies on page 1 (increase the size or turn tiling off)',
      );
    }
    // A rejected call mutates nothing.
    const g = await engine.getWatermarks('doc-wm-tile-cap');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([]);
    const m = await engine.isModified('doc-wm-tile-cap');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toBe(false);
  });

  it('still applies a legitimate tiled watermark (size 24)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-legit-tile', path);
    const r = await engine.addWatermark('doc-wm-legit-tile', {
      type: 'text',
      text: 'TILED',
      size: 24,
      tile: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saveR = await engine.save('doc-wm-legit-tile');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const count = drawnText(decodeContent(re, 0)).split('TILED').length - 1;
    expect(count).toBeGreaterThan(10);
  });

  it('rejects the 11th watermark and keeps the first 10 listed (DEF-220)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-wm-cap', path);
    for (let i = 1; i <= 10; i++) {
      const r = await engine.addWatermark('doc-wm-cap', {
        type: 'text',
        text: `WM${i}`,
        size: 24,
      });
      expect(r.ok, `watermark ${i} should be accepted`).toBe(true);
    }

    const eleventh = await engine.addWatermark('doc-wm-cap', {
      type: 'text',
      text: 'WM11',
      size: 24,
    });
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.error.code).toBe('engine-error');
      expect(eleventh.error.message).toBe(
        'addWatermark: this document already has 10 watermarks (maximum)',
      );
    }

    const g = await engine.getWatermarks('doc-wm-cap');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toHaveLength(10);
    expect(g.value.map((w) => w.id)).toEqual([
      'wm-1', 'wm-2', 'wm-3', 'wm-4', 'wm-5',
      'wm-6', 'wm-7', 'wm-8', 'wm-9', 'wm-10',
    ]);
  });

  it('rejects an inverted range [3,2] and stamps no page (DEF-218 pin)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-wm-badrange', path);
    const norm = await engine.getWatermarks('doc-wm-badrange');
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;

    const preR = await engine.getDocumentBytes('doc-wm-badrange');
    expect(preR.ok).toBe(true);
    if (!preR.ok) return;
    const pre = await PDFDocument.load(preR.value);
    const preLens = [0, 1, 2].map((i) => contentsLength(pre, i));

    const r = await engine.addWatermark('doc-wm-badrange', {
      type: 'text',
      text: 'RG',
      range: [3, 2],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');

    const postR = await engine.getDocumentBytes('doc-wm-badrange');
    expect(postR.ok).toBe(true);
    if (!postR.ok) return;
    const post = await PDFDocument.load(postR.value);
    for (let i = 0; i < 3; i++) {
      expect(drawnText(decodeContent(post, i))).not.toContain('RG');
      expect(contentsLength(post, i)).toBe(preLens[i]);
    }
    const g = await engine.getWatermarks('doc-wm-badrange');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toEqual([]);
  });
});