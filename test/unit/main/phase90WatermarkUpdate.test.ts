// Phase 90 (TFL-509) chunk A — engine.updateWatermark.
//
// Proves: updateWatermark removes the run's old streams and re-bakes at the
// new settings in exactly ONE undo entry; getWatermarks reflects the updated
// record (same id, new text/placement); the old streams are gone (one marker
// per page, not two).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { WatermarkSettings } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p90wm-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`PAGE-${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, 'wm-fixture.pdf');
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

function wm(over: Partial<WatermarkSettings> = {}): WatermarkSettings {
  return { type: 'text', text: 'DRAFT', size: 24, position: 'center', ...over };
}

/** Decode a page's (possibly multi-stream, possibly compressed) content. */
function decodeContent(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const resolve = (r: unknown): any => {
    let o: any = doc.context.lookup(r as never);
    while (o && o.constructor?.name === 'PDFRef') o = doc.context.lookup(o);
    return o;
  };
  const read = (o: any): string => {
    if (!o) return '';
    if (o.constructor?.name === 'PDFArray' || o instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < o.size(); i++) out += read(resolve(o.get(i)));
      return out;
    }
    if (o.contents) {
      try { return inflateSync(o.contents as Uint8Array).toString('latin1'); }
      catch { return Buffer.from(o.contents as Uint8Array).toString('latin1'); }
    }
    return '';
  };
  return read(resolve(contents));
}

/** Recover the drawn text (hex and literal `Tj` forms) from content. */
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
  return out;
}

/** The `1 0 0 1 x y Tm` translations in a decoded content stream. */
function tmTranslates(content: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push([parseFloat(m[1]), parseFloat(m[2])]);
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

async function parse(bytesIn: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const u8 = bytesIn instanceof Uint8Array ? bytesIn : new Uint8Array(bytesIn);
  return PDFDocument.load(u8);
}

async function bytes(engine: EngineService, docId: string): Promise<Uint8Array> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  return r.ok ? new Uint8Array(r.value) : new Uint8Array();
}

describe('Phase 90: updateWatermark', () => {
  it('re-bakes at the new settings, reflects the new record, and is ONE undo entry', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const add = await engine.addWatermark('doc-1', wm({ x: 100, y: 100 }));
    expect(add.ok).toBe(true);

    const before = await engine.getWatermarks('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value).toHaveLength(1);
    const id = before.value[0].id;
    expect(before.value[0].text).toBe('DRAFT');
    expect(before.value[0].pages).toEqual([1, 2, 3]);

    let parsed = await parse(await bytes(engine, 'doc-1'));
    let content0 = decodeContent(parsed, 0);
    expect(drawnText(content0)).toContain('DRAFT');
    expect(tmTranslates(content0).some(([x]) => Math.abs(x - 100) < 0.01)).toBe(true);

    const upd = await engine.updateWatermark(
      'doc-1',
      id,
      wm({ text: 'FINAL', size: 30, x: 300, y: 200 }),
    );
    expect(upd.ok).toBe(true);

    const after = await engine.getWatermarks('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toHaveLength(1);
    expect(after.value[0].id).toBe(id);
    expect(after.value[0].text).toBe('FINAL');
    expect(after.value[0].pages).toEqual([1, 2, 3]);

    parsed = await parse(await bytes(engine, 'doc-1'));
    content0 = decodeContent(parsed, 0);
    expect(drawnText(content0)).toContain('FINAL');
    expect(drawnText(content0)).not.toContain('DRAFT');
    expect(tmTranslates(content0).some(([x]) => Math.abs(x - 300) < 0.01)).toBe(true);
    // Old streams are GONE: exactly one watermark marker per page.
    expect(countOccurrences(content0, '%TFLEX-WATERMARK')).toBe(1);
    expect(countOccurrences(decodeContent(parsed, 1), '%TFLEX-WATERMARK')).toBe(1);

    // Exactly ONE undo entry backs the update.
    const undo1 = await engine.undo('doc-1');
    expect(undo1.ok).toBe(true);
    const restored = await engine.getWatermarks('doc-1');
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value).toHaveLength(1);
    expect(restored.value[0].text).toBe('DRAFT');
    const restoredContent = decodeContent(await parse(await bytes(engine, 'doc-1')), 0);
    expect(drawnText(restoredContent)).toContain('DRAFT');
    expect(drawnText(restoredContent)).not.toContain('FINAL');

    // A second undo removes the watermark entirely (undo of the add).
    const undo2 = await engine.undo('doc-1');
    expect(undo2.ok).toBe(true);
    const empty = await engine.getWatermarks('doc-1');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toEqual([]);
  });

  it('an unknown id refuses and mutates nothing', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addWatermark('doc-1', wm());
    const before = await bytes(engine, 'doc-1');

    const upd = await engine.updateWatermark('doc-1', 'wm-nope', wm({ text: 'X' }));
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error.code).toBe('engine-error');
    expect(await bytes(engine, 'doc-1')).toEqual(before);
  });

  it('an invalid payload refuses and mutates nothing', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addWatermark('doc-1', wm());
    const before = await bytes(engine, 'doc-1');

    const upd = await engine.updateWatermark('doc-1', 'wm-1', wm({ text: '' }));
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error.code).toBe('engine-error');
    expect(await bytes(engine, 'doc-1')).toEqual(before);
  });
});

