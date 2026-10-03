// TFL-632 / Phase 90 (TFL-509) ADVERSARIAL diff-pass probe (unit, main process).
//
// Adversary-only. Attacks the NEW Bates list/update/delete ops and the marker
// `settings` round-trip on the high-risk save path, mirroring the Phase 89
// adversary probe's shape and log cadence. It does NOT re-run qa's Phase 90
// spec and touches nothing under src/. Every fixture is created in a temp dir;
// the app source is never mutated.
//
//   npm.cmd run test:unit -- test/unit/main/phase90BatesAdversary.test.ts
//
// Named vectors (issue TFL-632, REQUIREMENTS.md Phase 90 section E):
//   E1 edit a run after a reorder
//   E2 delete one of two runs sharing a prefix
//   E3 update a run to a coordinate at each page edge (+ out-of-bounds refusal)
//   E4 a marker written by Phase 89 (no `settings`) listed + refused-on-edit +
//      deletable (plus a malformed-settings marker treated the same way)
//   E5 Bates-then-watermark-then-updateWatermark interference
//   E6 two runs on overlapping pages
//   E7 the undo/save byte round-trip after update and after delete
//   E8 an out-of-bounds UPDATE refuses before removing the existing run
//   E9 a repeated update/delete storm stays stable (no marker duplication)
//
// E4b and E5b are OBSERVATION-ONLY (logged, not asserted) so the suite stays
// green while the ADV entry can cite the observed values.

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
const PAGE_WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p90adv-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createFixture(pageCount = PAGE_WORDS.length): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([PW, PH]);
    page.drawText(PAGE_WORDS[i % PAGE_WORDS.length], { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, `p90adv-${pageCount}.pdf`);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

/** A fixture that carries hand-written legacy / malformed Bates markers. */
async function createLegacyFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const pages = [0, 1, 2].map((i) => {
    const page = doc.addPage([PW, PH]);
    page.drawText(PAGE_WORDS[i], { x: 72, y: 700, size: 14 });
    return page;
  });
  const addMarker = (pageIndex: number, payload: Record<string, unknown>): void => {
    const marker =
      '%TFLEX-BATES ' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const stream = doc.context.stream(new TextEncoder().encode(marker));
    const ref = doc.context.register(stream);
    pages[pageIndex].node.addContentStream(ref);
  };
  // A genuine Phase 89 marker: no `settings` key at all.
  addMarker(0, { id: 'bates-legacy1', page: 1, label: 'LEG-000001' });
  // A corrupted Phase 90-shaped marker whose `settings` fails validation; the
  // reader must treat it exactly like a legacy marker (list, refuse edit, delete).
  addMarker(1, { id: 'bates-legacybad', page: 2, label: 'BAD-000002', settings: { pages: 'nope' } });
  const path = join(dir, 'legacy.pdf');
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

function settingsFor(pages: number[], over: Partial<BatesSettings> = {}): BatesSettings {
  return {
    pages,
    prefix: '',
    suffix: '',
    startNumber: 1,
    padding: 6,
    position: 'bottom-right',
    ...over,
  };
}

function wm(over: Partial<WatermarkSettings> = {}): WatermarkSettings {
  return { type: 'text', text: 'DRAFT', size: 24, position: 'center', ...over };
}

function sha(u8: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(u8)).digest('hex');
}

async function parse(bytesIn: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const u8 = bytesIn instanceof Uint8Array ? bytesIn : new Uint8Array(bytesIn);
  return PDFDocument.load(u8);
}

/** Decode one page's (possibly multi-stream, possibly compressed) content. */
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

function countMarker(content: string): number {
  return content.split('%TFLEX-BATES').length - 1;
}

/** The first `Tm` after the Bates marker (label baseline, bottom-left space). */
function batesTm(content: string): { x: number; y: number } | null {
  const idx = content.indexOf('%TFLEX-BATES');
  if (idx === -1) return null;
  const m = content.slice(idx).match(/1 0 0 1 (-?[0-9.]+) (-?[0-9.]+) Tm/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** The Bates marker payload on a page's content, or null. */
function markerPayload(content: string): Record<string, unknown> | null {
  const idx = content.indexOf('%TFLEX-BATES ');
  if (idx === -1) return null;
  const rest = content.slice(idx + '%TFLEX-BATES '.length);
  const line = rest.split('\n')[0];
  try {
    return JSON.parse(Buffer.from(line, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function bytes(engine: EngineService, docId: string): Promise<Uint8Array> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  return r.ok ? new Uint8Array(r.value) : new Uint8Array();
}

async function texts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

async function helveticaMetrics(size: number): Promise<{ w: (t: string) => number; h: number }> {
  const probe = await PDFDocument.create();
  const font = await embedEditFont(probe, 'Helvetica', false, false);
  return { w: (t: string): number => font.widthOfTextAtSize(t, size), h: font.heightAtSize(size) };
}

describe('Phase 90 adversary: Bates list / update / delete + settings round-trip', () => {
  it('E1 edit a run after a page reorder: the run follows the reorder, then moves cleanly', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    // Stamp visible pages [2,4] (BRAVO, DELTA) with labels A1-001 / A1-002.
    const add = await engine.addBates('doc-1', settingsFor([2, 4], { prefix: 'A1-', padding: 3 }));
    expect(add.ok).toBe(true);

    // Move visible page 5 (ECHO) to the front: order becomes
    // [ECHO, ALPHA, BRAVO, CHARLIE, DELTA]; the run now rides visible 3 and 5.
    const mv = await engine.applyOp('doc-1', { kind: 'reorder', page: 4, param: 0 });
    expect(mv.ok).toBe(true);

    const listed0 = await engine.getBates('doc-1');
    expect(listed0.ok).toBe(true);
    if (!listed0.ok) return;
    expect(listed0.value).toHaveLength(1);
    const run = listed0.value[0];
    expect(run.pages).toEqual([3, 5]);
    expect(run.labels).toEqual(['A1-001', 'A1-002']);

    // Edit the run onto visible pages [1,2] (ECHO, ALPHA).
    const upd = await engine.updateBates(
      'doc-1',
      run.id,
      settingsFor([1, 2], { prefix: 'A1-', padding: 3, startNumber: 1 }),
    );
    expect(upd.ok).toBe(true);
    if (!upd.ok) return;
    expect(upd.value.stamped).toEqual([1, 2]);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('A1-001'); // ECHO
    expect(t[1]).toContain('A1-002'); // ALPHA
    expect(t[2]).not.toContain('A1-'); // BRAVO - old marker removed
    expect(t[4]).not.toContain('A1-'); // DELTA - old marker removed

    const parsed = await parse(await bytes(engine, 'doc-1'));
    expect(decodePage(parsed, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 1)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 2)).not.toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 4)).not.toContain('%TFLEX-BATES');
    // Exactly ONE marker per selected page (no leftover duplicate stream).
    expect(countMarker(decodePage(parsed, 0))).toBe(1);
    expect(countMarker(decodePage(parsed, 1))).toBe(1);

    // ONE undo returns to the post-reorder, pre-edit state.
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const afterUndo = await texts(engine, 'doc-1');
    expect(afterUndo[0]).not.toContain('A1-'); // ECHO was unstamped before edit
    expect(afterUndo[2]).toContain('A1-001'); // BRAVO
    expect(afterUndo[4]).toContain('A1-002'); // DELTA
  });

  it('E2 delete one of two runs sharing a prefix: only the addressed run is removed', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r1 = await engine.addBates('doc-1', settingsFor([1, 2], { prefix: 'S-', padding: 3 }));
    const r2 = await engine.addBates('doc-1', settingsFor([4, 5], { prefix: 'S-', padding: 3 }));
    expect(r1.ok && r2.ok).toBe(true);

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);
    expect(listed.value.every((b) => b.prefix === 'S-')).toBe(true);
    const first = listed.value.find((b) => b.pages[0] === 1);
    const second = listed.value.find((b) => b.pages[0] === 4);
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    const del = await engine.deleteBates('doc-1', first.id);
    expect(del.ok).toBe(true);

    const after = await engine.getBates('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toHaveLength(1);
    expect(after.value[0].id).toBe(second.id);
    expect(after.value[0].pages).toEqual([4, 5]);
    expect(after.value[0].labels).toEqual(['S-001', 'S-002']);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).not.toContain('S-');
    expect(t[1]).not.toContain('S-');
    expect(t[3]).toContain('S-001');
    expect(t[4]).toContain('S-002');
  });

  it('E3 update to each page edge (clamped) and refuse an out-of-bounds update without touching the run', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1], { prefix: 'E-', padding: 3 }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id = listed.value[0].id;

    const m = await helveticaMetrics(10);
    const label = 'E-001';
    const w = m.w(label);
    const h = m.h;
    const yTop = h * 0.2; // y = PH clamps top to ph-h => baseline = ph-(ph-h)-h*0.8
    const edges: { name: string; x: number; y: number; ex: number; ey: number }[] = [
      { name: 'top-left', x: 0, y: 0, ex: 0, ey: PH - h * 0.8 },
      { name: 'top-right', x: PW, y: 0, ex: PW - w, ey: PH - h * 0.8 },
      { name: 'bottom-left', x: 0, y: PH, ex: 0, ey: yTop },
      { name: 'bottom-right', x: PW, y: PH, ex: PW - w, ey: yTop },
      { name: 'max-coord', x: 14400, y: 14400, ex: PW - w, ey: yTop },
    ];
    for (const e of edges) {
      const upd = await engine.updateBates(
        'doc-1',
        id,
        settingsFor([1], { prefix: 'E-', padding: 3, startNumber: 1, x: e.x, y: e.y }),
      );
      expect(upd.ok, e.name).toBe(true);
      const parsed = await parse(await bytes(engine, 'doc-1'));
      const tm = batesTm(decodePage(parsed, 0));
      expect(tm, e.name).not.toBeNull();
      expect(tm!.x, `${e.name} x`).toBeCloseTo(e.ex, 3);
      expect(tm!.y, `${e.name} y`).toBeCloseTo(e.ey, 3);
      expect(tm!.x).toBeGreaterThanOrEqual(-0.001);
      expect(tm!.y).toBeGreaterThanOrEqual(-0.001);
      console.log(
        `[p90adv|E3] edge=${e.name} payload=(${e.x},${e.y}) tm=(${tm!.x.toFixed(2)},${tm!.y.toFixed(2)})`,
      );
    }

    // An out-of-bounds update refuses and must NOT partially remove the run.
    const beforeBytes = await bytes(engine, 'doc-1');
    const bad = await engine.updateBates(
      'doc-1',
      id,
      settingsFor([1], { prefix: 'E-', padding: 3, x: -5, y: 10 }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('engine-error');
    expect(sha(await bytes(engine, 'doc-1'))).toBe(sha(beforeBytes));

    const survived = await engine.getBates('doc-1');
    expect(survived.ok).toBe(true);
    if (survived.ok) {
      expect(survived.value).toHaveLength(1);
      expect(survived.value[0].labels).toEqual([label]);
    }
  });

  it('E4 a Phase 89 marker with no settings (and a malformed-settings marker) lists, refuses edit and deletes', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createLegacyFixture());

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);

    const legacy = listed.value.find((b) => b.id === 'bates-legacy1');
    const malformed = listed.value.find((b) => b.id === 'bates-legacybad');
    expect(legacy && malformed).toBeTruthy();
    if (!legacy || !malformed) return;

    // Both list with the shipped defaults and the marker's own label.
    for (const info of [legacy, malformed]) {
      expect(info.prefix).toBe('');
      expect(info.suffix).toBe('');
      expect(info.startNumber).toBe(1);
      expect(info.padding).toBe(6);
      expect(info.size).toBe(10);
      expect(info.x).toBeUndefined();
      expect(info.y).toBeUndefined();
    }
    expect(legacy.pages).toEqual([1]);
    expect(legacy.labels).toEqual(['LEG-000001']);
    expect(malformed.pages).toEqual([2]);
    expect(malformed.labels).toEqual(['BAD-000002']);

    // A malformed `settings` must be treated exactly like a legacy marker.
    console.log(
      `[p90adv|E4b] malformed-settings marker listed id=${malformed.id} pages=${JSON.stringify(malformed.labels)}`,
    );

    const before = await bytes(engine, 'doc-1');
    for (const id of ['bates-legacy1', 'bates-legacybad']) {
      const upd = await engine.updateBates('doc-1', id, settingsFor([1], { prefix: 'N-' }));
      expect(upd.ok).toBe(false);
      if (!upd.ok) {
        expect(upd.error.code).toBe('engine-error');
        expect(upd.error.message).toContain('older version');
      }
    }
    expect(sha(await bytes(engine, 'doc-1'))).toBe(sha(before));

    // Deletable, one at a time, leaving the other behind.
    const del1 = await engine.deleteBates('doc-1', 'bates-legacy1');
    expect(del1.ok).toBe(true);
    const mid = await engine.getBates('doc-1');
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.value).toHaveLength(1);
      expect(mid.value[0].id).toBe('bates-legacybad');
    }
    const del2 = await engine.deleteBates('doc-1', 'bates-legacybad');
    expect(del2.ok).toBe(true);
    const after = await engine.getBates('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toEqual([]);
    const t = await texts(engine, 'doc-1');
    for (const page of t) {
      expect(page).not.toContain('LEG-000001');
      expect(page).not.toContain('BAD-000002');
    }
  });

  it('E5 Bates-then-watermark-then-updateWatermark: neither run is disturbed by the other', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const b = await engine.addBates('doc-1', settingsFor([1, 2], { prefix: 'B-', padding: 3 }));
    expect(b.ok).toBe(true);
    const wadd = await engine.addWatermark('doc-1', wm({ range: [1, 2] }));
    expect(wadd.ok).toBe(true);

    const wlist = await engine.getWatermarks('doc-1');
    expect(wlist.ok).toBe(true);
    if (!wlist.ok) return;
    expect(wlist.value).toHaveLength(1);
    const wmId = wlist.value[0].id;

    // Update the watermark (remove + re-bake, one undo entry).
    const upd = await engine.updateWatermark('doc-1', wmId, wm({ text: 'REVISED', range: [1, 2] }));
    expect(upd.ok).toBe(true);
    const rewm = await engine.getWatermarks('doc-1');
    expect(rewm.ok).toBe(true);
    if (rewm.ok) {
      expect(rewm.value).toHaveLength(1);
      expect(rewm.value[0].text).toBe('REVISED');
      expect(rewm.value[0].pages).toEqual([1, 2]);
    }

    // The Bates run is untouched by the watermark update.
    let bates = await engine.getBates('doc-1');
    expect(bates.ok).toBe(true);
    if (bates.ok) {
      expect(bates.value).toHaveLength(1);
      expect(bates.value[0].labels).toEqual(['B-001', 'B-002']);
    }
    let t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('B-001');
    expect(t[1]).toContain('B-002');
    expect(t[0]).toContain('REVISED');

    // ONE undo reverts the watermark text while the Bates run survives.
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const afterUndo = await engine.getWatermarks('doc-1');
    expect(afterUndo.ok).toBe(true);
    if (afterUndo.ok) expect(afterUndo.value[0].text).toBe('DRAFT');
    bates = await engine.getBates('doc-1');
    if (bates.ok) expect(bates.value).toHaveLength(1);
    t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('B-001');

    // Delete the watermark: the Bates run must survive.
    const redo = await engine.redo('doc-1');
    expect(redo.ok).toBe(true);
    const wlist2 = await engine.getWatermarks('doc-1');
    if (!wlist2.ok) return;
    const delWm = await engine.deleteWatermark('doc-1', wlist2.value[0].id);
    expect(delWm.ok).toBe(true);
    const wAfter = await engine.getWatermarks('doc-1');
    if (wAfter.ok) expect(wAfter.value).toEqual([]);
    const t2 = await texts(engine, 'doc-1');
    expect(t2[0]).toContain('B-001');
    expect(t2[0]).not.toContain('REVISED');
    const markers = await parse(await bytes(engine, 'doc-1'));
    expect(decodePage(markers, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(markers, 0)).not.toContain('%TFLEX-WATERMARK');
  });

  it('E6 two runs on overlapping pages: each keeps its own streams through delete and update', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    await engine.addBates('doc-1', settingsFor([1, 2, 3], { prefix: 'O1-', padding: 3 }));
    await engine.addBates('doc-1', settingsFor([2, 3, 4], { prefix: 'O2-', padding: 3 }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);
    const o1 = listed.value.find((b) => b.prefix === 'O1-');
    const o2 = listed.value.find((b) => b.prefix === 'O2-');
    expect(o1 && o2).toBeTruthy();
    if (!o1 || !o2) return;

    // Pages 2 and 3 carry BOTH runs' markers (two streams, interleaved).
    const parsed = await parse(await bytes(engine, 'doc-1'));
    expect(countMarker(decodePage(parsed, 1))).toBe(2);
    expect(countMarker(decodePage(parsed, 2))).toBe(2);
    expect(countMarker(decodePage(parsed, 0))).toBe(1);
    expect(countMarker(decodePage(parsed, 3))).toBe(1);
    const t0 = await texts(engine, 'doc-1');
    expect(t0[1]).toContain('O1-002');
    expect(t0[1]).toContain('O2-001');

    // Delete run 1: only its streams leave pages 2 and 3.
    const del = await engine.deleteBates('doc-1', o1.id);
    expect(del.ok).toBe(true);
    const after = await engine.getBates('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value).toHaveLength(1);
      expect(after.value[0].id).toBe(o2.id);
    }
    const t1 = await texts(engine, 'doc-1');
    expect(t1[0]).not.toContain('O1-');
    expect(t1[0]).not.toContain('O2-');
    expect(t1[1]).toContain('O2-001');
    expect(t1[1]).not.toContain('O1-');
    expect(t1[2]).toContain('O2-002');
    expect(t1[2]).not.toContain('O1-');
    const parsed2 = await parse(await bytes(engine, 'doc-1'));
    expect(countMarker(decodePage(parsed2, 1))).toBe(1);
    expect(countMarker(decodePage(parsed2, 2))).toBe(1);
    expect(decodePage(parsed2, 0)).not.toContain('%TFLEX-BATES');

    // Update run 2 onto page 5: the removed run 1 cannot reappear.
    const upd = await engine.updateBates(
      'doc-1',
      o2.id,
      settingsFor([5], { prefix: 'O2-', padding: 3, startNumber: 1 }),
    );
    expect(upd.ok).toBe(true);
    if (!upd.ok) return;
    expect(upd.value.stamped).toEqual([5]);
    const t2 = await texts(engine, 'doc-1');
    expect(t2[4]).toContain('O2-001');
    expect(t2[1]).not.toContain('O2-');
    expect(t2[2]).not.toContain('O2-');
  });

  it('E7 undo/save byte round-trip after update and after delete; one undo entry each', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    await engine.addBates('doc-1', settingsFor([1, 3], { prefix: 'B-', padding: 6 }));
    const shaAdded = sha(await bytes(engine, 'doc-1'));
    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id = listed.value[0].id;

    // ---- update ----
    const upd = await engine.updateBates(
      'doc-1',
      id,
      settingsFor([1, 3], { prefix: 'B-', padding: 2, startNumber: 7, x: 30, y: 40 }),
    );
    expect(upd.ok).toBe(true);
    const shaUpdated = sha(await bytes(engine, 'doc-1'));
    expect(shaUpdated).not.toBe(shaAdded);

    const parsedU = await parse(await bytes(engine, 'doc-1'));
    const payloadU = markerPayload(decodePage(parsedU, 0));
    expect((payloadU?.settings as Record<string, unknown>).padding).toBe(2);
    expect((payloadU?.settings as Record<string, unknown>).x).toBe(30);

    const undoU = await engine.undo('doc-1');
    expect(undoU.ok).toBe(true);
    expect(sha(await bytes(engine, 'doc-1'))).toBe(shaAdded);
    const backList = await engine.getBates('doc-1');
    if (backList.ok) expect(backList.value[0].padding).toBe(6);

    const redoU = await engine.redo('doc-1');
    expect(redoU.ok).toBe(true);
    expect(sha(await bytes(engine, 'doc-1'))).toBe(shaUpdated);

    // Save + reopen the updated run.
    const reopenPath = join(dir, 'p90adv-updated.pdf');
    await writeFile(reopenPath, Buffer.from(await bytes(engine, 'doc-1')));
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', reopenPath);
    const t2 = await texts(engine2, 'doc-2');
    expect(t2[0]).toContain('B-07');
    expect(t2[2]).toContain('B-08');
    const reList = await engine2.getBates('doc-2');
    expect(reList.ok).toBe(true);
    if (reList.ok) {
      expect(reList.value).toHaveLength(1);
      expect(reList.value[0].padding).toBe(2);
      expect(reList.value[0].x).toBe(30);
      expect(reList.value[0].y).toBe(40);
      expect(reList.value[0].labels).toEqual(['B-07', 'B-08']);
    }

    // ---- delete ----
    const del = await engine.deleteBates('doc-1', id);
    expect(del.ok).toBe(true);
    const shaDeleted = sha(await bytes(engine, 'doc-1'));
    const undoD = await engine.undo('doc-1');
    expect(undoD.ok).toBe(true);
    expect(sha(await bytes(engine, 'doc-1'))).toBe(shaUpdated);
    const redoD = await engine.redo('doc-1');
    expect(redoD.ok).toBe(true);
    expect(sha(await bytes(engine, 'doc-1'))).toBe(shaDeleted);

    const reopenDel = join(dir, 'p90adv-deleted.pdf');
    await writeFile(reopenDel, Buffer.from(await bytes(engine, 'doc-1')));
    const engine3 = new EngineService();
    await engine3.loadDocument('doc-3', reopenDel);
    const t3 = await texts(engine3, 'doc-3');
    for (const page of t3) expect(page).not.toContain('B-');
    const delList = await engine3.getBates('doc-3');
    expect(delList.ok).toBe(true);
    if (delList.ok) expect(delList.value).toEqual([]);
  });

  it('E8 a non-finite UPDATE refuses before removing the existing run (fail-loud, no partial edit)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([2], { prefix: 'F-', padding: 3 }));
    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id = listed.value[0].id;
    const before = await bytes(engine, 'doc-1');

    for (const bad of [NaN, Infinity, -1, 14401]) {
      const upd = await engine.updateBates(
        'doc-1',
        id,
        settingsFor([2], { prefix: 'F-', padding: 3, x: bad }),
      );
      expect(upd.ok, `x=${String(bad)} must refuse`).toBe(false);
      expect(sha(await bytes(engine, 'doc-1')), `bytes intact for x=${String(bad)}`).toBe(sha(before));
      const still = await engine.getBates('doc-1');
      expect(still.ok).toBe(true);
      if (still.ok) {
        expect(still.value, `run survives x=${String(bad)}`).toHaveLength(1);
        expect(still.value[0].labels).toEqual(['F-001']);
      }
      console.log(`[p90adv|E8] x=${String(bad)} refused, run intact`);
    }
  });

  it('E9 a repeated update/delete storm stays stable: one marker per page, no resurrection', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1, 2, 3], { prefix: 'T-', padding: 3 }));
    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id = listed.value[0].id;

    for (let i = 0; i < 6; i++) {
      const upd = await engine.updateBates(
        'doc-1',
        id,
        settingsFor(i % 2 === 0 ? [1, 2, 3] : [3, 2, 1], { prefix: 'T-', padding: 3, startNumber: i + 1 }),
      );
      expect(upd.ok).toBe(true);
    }
    let parsed = await parse(await bytes(engine, 'doc-1'));
    for (let p = 0; p < 3; p++) {
      expect(countMarker(decodePage(parsed, p)), `page ${p + 1} marker count after storm`).toBe(1);
    }
    const stormList = await engine.getBates('doc-1');
    expect(stormList.ok).toBe(true);
    if (stormList.ok) expect(stormList.value).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      await engine.addBates('doc-1', settingsFor([4], { prefix: `X${i}-`, padding: 3 }));
    }
    const many = await engine.getBates('doc-1');
    expect(many.ok).toBe(true);
    if (!many.ok) return;
    for (const info of many.value) {
      const del = await engine.deleteBates('doc-1', info.id);
      expect(del.ok).toBe(true);
    }
    parsed = await parse(await bytes(engine, 'doc-1'));
    for (let p = 0; p < 5; p++) {
      expect(countMarker(decodePage(parsed, p)), `page ${p + 1} after delete storm`).toBe(0);
    }
    const empty = await engine.getBates('doc-1');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toEqual([]);
  });
});
