// TFL-521 (QA) — independent probe for Phase 90 chunk A.
//
// Written by qa, not the developer. Two focused checks the developer's own
// specs do not isolate:
//   1. Explicit-placement geometry for a corner (x=0,y=0) and a gutter
//      coordinate (x inside the 10% margin the Phase 89 slot maths would
//      clamp to), plus the out-of-bounds refusal leaving bytes untouched.
//   2. Read-op purity (the developer flagged it): a read-only `getBates` /
//      `getWatermarks` must NOT alter the serialized bytes, must NOT set
//      `modified`, and must NOT push an undo entry.

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { embedEditFont } from '../../../src/main/services/fonts';
import type { BatesSettings, WatermarkSettings } from '../../../src/shared/types';

let dir: string;
const PW = 612;
const PH = 792;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p90qa-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([PW, PH]);
    page.drawText(`PAGE-${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, 'p90qa.pdf');
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

function settingsFor(pages: number[], over: Partial<BatesSettings> = {}): BatesSettings {
  return { pages, prefix: 'Q-', suffix: '', startNumber: 1, padding: 6, position: 'bottom-right', ...over };
}

function wm(over: Partial<WatermarkSettings> = {}): WatermarkSettings {
  return { type: 'text', text: 'DRAFT', size: 24, position: 'center', ...over };
}

async function bytes(engine: EngineService, docId: string): Promise<Uint8Array> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  return r.ok ? new Uint8Array(r.value) : new Uint8Array();
}

function sha(u8: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(u8)).digest('hex');
}

async function parse(bytesIn: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const u8 = bytesIn instanceof Uint8Array ? bytesIn : new Uint8Array(bytesIn);
  return PDFDocument.load(u8);
}

function decodePage(doc: PDFDocument, pageIndex: number): string {
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

function batesTm(content: string): { x: number; y: number } | null {
  const idx = content.indexOf('%TFLEX-BATES');
  if (idx === -1) return null;
  const m = content.slice(idx).match(/1 0 0 1 (-?[0-9.]+) (-?[0-9.]+) Tm/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

async function helveticaMetrics(size: number): Promise<{ w: (t: string) => number; h: number }> {
  const probe = await PDFDocument.create();
  const font = await embedEditFont(probe, 'Helvetica', false, false);
  return { w: (t: string) => font.widthOfTextAtSize(t, size), h: font.heightAtSize(size) };
}

describe('TFL-521 QA probe: explicit placement geometry', () => {
  it('x=0,y=0 lands the label top-left at the page corner', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates('doc-1', settingsFor([1], { x: 0, y: 0 }));
    expect(r.ok).toBe(true);

    const tm = batesTm(decodePage(await parse(await bytes(engine, 'doc-1')), 0));
    expect(tm).not.toBeNull();
    const m = await helveticaMetrics(10);
    expect(tm!.x).toBeCloseTo(0, 3);
    // top-left origin: y-explicit 0 => baseline = ph - h*0.8
    expect(tm!.y).toBeCloseTo(PH - m.h * 0.8, 3);
  });

  it('a gutter x inside the 10% margin is honoured, not clamped to the slot', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    // 20pt is well inside the 10% horizontal margin (61.2pt) a Phase 89 slot
    // would clamp to; explicit placement must keep it.
    const r = await engine.addBates('doc-1', settingsFor([1], { x: 20, y: 400 }));
    expect(r.ok).toBe(true);

    const tm = batesTm(decodePage(await parse(await bytes(engine, 'doc-1')), 0));
    expect(tm).not.toBeNull();
    const m = await helveticaMetrics(10);
    expect(tm!.x).toBeCloseTo(20, 3);
    expect(tm!.y).toBeCloseTo(PH - 400 - m.h * 0.8, 3);
  });

  it('an out-of-bounds coordinate refuses and leaves bytes + undo untouched', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await bytes(engine, 'doc-1');
    const r = await engine.addBates('doc-1', settingsFor([1], { x: -5, y: 14401 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
    expect(sha(await bytes(engine, 'doc-1'))).toBe(sha(before));
    const modified = await engine.isModified('doc-1');
    expect(modified.ok && modified.value).toBe(false);
    expect((await engine.undo('doc-1')).ok).toBe(false);
  });
});

describe('TFL-521 QA probe: read-op purity', () => {
  it('getBates on an unmodified doc does not change bytes, modified or undo', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await bytes(engine, 'doc-1');

    const r = await engine.getBates('doc-1');
    expect(r.ok).toBe(true);

    const after = await bytes(engine, 'doc-1');
    // A second scan must be idempotent: this isolates normalization as the
    // cause (the first scan rewrites page Contents; later scans are no-ops).
    await engine.getBates('doc-1');
    const after2 = await bytes(engine, 'doc-1');
    const modified = await engine.isModified('doc-1');
    const undo = await engine.undo('doc-1');
    // Emit the hash pair so the report can cite exact evidence.
    console.log(`[qa] getBates purity before=${sha(before)} after=${sha(after)} after2=${sha(after2)} modified=${modified.ok && modified.value} undoOk=${undo.ok}`);
    expect(sha(after2)).toBe(sha(after));
    expect(sha(after)).toBe(sha(before));
    expect(modified.ok && modified.value).toBe(false);
    expect(undo.ok).toBe(false);
  });

  it('getWatermarks on an unmodified doc does not change bytes, modified or undo', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await bytes(engine, 'doc-1');

    const r = await engine.getWatermarks('doc-1');
    expect(r.ok).toBe(true);

    const after = await bytes(engine, 'doc-1');
    const modified = await engine.isModified('doc-1');
    const undo = await engine.undo('doc-1');
    console.log(`[qa] getWatermarks purity before=${sha(before)} after=${sha(after)} modified=${modified.ok && modified.value} undoOk=${undo.ok}`);
    expect(sha(after)).toBe(sha(before));
    expect(modified.ok && modified.value).toBe(false);
    expect(undo.ok).toBe(false);
  });

  it('getBates after an applied run does not change bytes, modified or undo', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const added = await engine.addBates('doc-1', settingsFor([1, 2], { x: 30, y: 40 }));
    expect(added.ok).toBe(true);
    const before = await bytes(engine, 'doc-1');

    const r = await engine.getBates('doc-1');
    expect(r.ok).toBe(true);

    const after = await bytes(engine, 'doc-1');
    console.log(`[qa] getBates-after-add purity before=${sha(before)} after=${sha(after)}`);
    expect(sha(after)).toBe(sha(before));
  });

  it('a watermark add + getWatermarks scan does not change bytes beyond the add', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const added = await engine.addWatermark('doc-1', wm({ x: 100, y: 100 }));
    expect(added.ok).toBe(true);
    const before = await bytes(engine, 'doc-1');

    const r = await engine.getWatermarks('doc-1');
    expect(r.ok).toBe(true);
    const after = await bytes(engine, 'doc-1');
    console.log(`[qa] getWatermarks-after-add purity before=${sha(before)} after=${sha(after)}`);
    expect(sha(after)).toBe(sha(before));
  });
});
