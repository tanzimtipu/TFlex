// Phase 90 (TFL-509) chunk A — Bates list/update/delete + explicit x/y placement.
//
// Proves: explicit x/y stamps the label's top-left at that page point (text
// matrix geometry + extraction); x=0,y=0 corner is on-page; a non-finite or
// out-of-bounds coordinate refuses with a typed engine-error and leaves the
// bytes byte-for-byte unchanged; getBates groups a run's pages/labels and
// separates two runs; updateBates changes position AND padding in exactly ONE
// undo entry and survives serialize+reopen; deleteBates removes exactly that
// run while a second survives; an unknown id mutates nothing; a legacy marker
// (no `settings`) lists and is deletable but update refuses.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { embedEditFont } from '../../../src/main/services/fonts';
import type { BatesSettings } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p90bates-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PAGE_WORDS = ['PAGE-ONE', 'PAGE-TWO', 'PAGE-THREE'];
const PW = 612;
const PH = 792;

async function createFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < PAGE_WORDS.length; i++) {
    const page = doc.addPage([PW, PH]);
    page.drawText(PAGE_WORDS[i], { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, 'p90-fixture.pdf');
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

/** Decode a page's (possibly multi-stream, possibly compressed) content. */
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

async function parse(bytesIn: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const u8 = bytesIn instanceof Uint8Array ? bytesIn : new Uint8Array(bytesIn);
  return PDFDocument.load(u8);
}

async function texts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

async function bytes(engine: EngineService, docId: string): Promise<Uint8Array> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  return r.ok ? new Uint8Array(r.value) : new Uint8Array();
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

/** The first `Tm` after the Bates marker (label top-left in bottom-left space). */
function batesTm(content: string): { x: number; y: number } | null {
  const idx = content.indexOf('%TFLEX-BATES');
  if (idx === -1) return null;
  const m = content.slice(idx).match(/1 0 0 1 (-?[0-9.]+) (-?[0-9.]+) Tm/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

function helveticaMetrics(size: number): Promise<{ w: (t: string) => number; h: number }> {
  return (async () => {
    const probe = await PDFDocument.create();
    const font = await embedEditFont(probe, 'Helvetica', false, false);
    return { w: (t: string) => font.widthOfTextAtSize(t, size), h: font.heightAtSize(size) };
  })();
}

describe('Phase 90: Bates explicit placement', () => {
  it('explicit x/y places the label top-left at that page point and extracts it', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r = await engine.addBates('doc-1', settingsFor([1], { prefix: 'P-', x: 150, y: 200 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.labels).toEqual(['P-000001']);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('P-000001');

    const parsed = await parse(await bytes(engine, 'doc-1'));
    const content = decodePage(parsed, 0);
    const tm = batesTm(content);
    expect(tm).not.toBeNull();

    const m = await helveticaMetrics(10);
    const w = m.w('P-000001');
    expect(tm!.x).toBeCloseTo(150, 3);
    expect(tm!.x + w).toBeLessThanOrEqual(PW + 0.01);
    // The same y-flip the slot branch uses: baseline = ph - top - h*0.8.
    expect(tm!.y).toBeCloseTo(PH - 200 - m.h * 0.8, 3);

    const payload = markerPayload(content);
    expect(payload?.id).toMatch(/^bates-/);
    const settings = payload?.settings as Record<string, unknown>;
    expect(settings.x).toBe(150);
    expect(settings.y).toBe(200);
  });

  it('x=0,y=0 stamps the top-left corner and stays on-page', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates('doc-1', settingsFor([1], { prefix: 'C', x: 0, y: 0 }));
    expect(r.ok).toBe(true);

    const parsed = await parse(await bytes(engine, 'doc-1'));
    const tm = batesTm(decodePage(parsed, 0));
    expect(tm).not.toBeNull();
    expect(tm!.x).toBeGreaterThanOrEqual(0);
    expect(tm!.x).toBeLessThanOrEqual(PW);
    expect(tm!.y).toBeGreaterThanOrEqual(0);
    expect(tm!.y).toBeLessThanOrEqual(PH);

    const m = await helveticaMetrics(10);
    expect(tm!.y).toBeCloseTo(PH - m.h * 0.8, 3);
  });

  it('a non-finite or out-of-bounds coordinate refuses and leaves bytes unchanged', async () => {
    const cases: { name: string; s: BatesSettings }[] = [
      { name: 'negative-x', s: settingsFor([1], { x: -1 }) },
      { name: 'over-max-y', s: settingsFor([1], { y: 14401 }) },
      { name: 'huge-x', s: settingsFor([1], { x: 1e9 }) },
      { name: 'nan-x', s: settingsFor([1], { x: NaN }) },
      { name: 'infinity-y', s: settingsFor([1], { y: Infinity }) },
    ];
    for (const c of cases) {
      const engine = new EngineService();
      await engine.loadDocument('doc-1', await createFixture());
      const before = await bytes(engine, 'doc-1');

      const r = await engine.addBates('doc-1', c.s);
      expect(r.ok, c.name).toBe(false);
      if (!r.ok) expect(r.error.code, c.name).toBe('engine-error');

      expect(await bytes(engine, 'doc-1'), c.name).toEqual(before);
      const undo = await engine.undo('doc-1');
      expect(undo.ok, c.name).toBe(false);
    }
  });
});

describe('Phase 90: getBates / updateBates / deleteBates', () => {
  it('getBates returns one run pages/labels and separates two runs', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1, 3], { prefix: 'A-', padding: 4 }));
    await engine.addBates('doc-1', settingsFor([2], { prefix: 'B-' }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);
    const a = listed.value.find((b) => b.prefix === 'A-');
    const b = listed.value.find((x) => x.prefix === 'B-');
    expect(a?.pages).toEqual([1, 3]);
    expect(a?.labels).toEqual(['A-0001', 'A-0002']);
    expect(a?.padding).toBe(4);
    expect(b?.pages).toEqual([2]);
    expect(b?.labels).toEqual(['B-000001']);
  });

  it('updateBates changes position AND padding in exactly ONE undo entry', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1, 2], { prefix: 'U-', padding: 6 }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id = listed.value[0].id;

    const before = await texts(engine, 'doc-1');
    expect(before[0]).toContain('U-000001');

    const upd = await engine.updateBates(
      'doc-1',
      id,
      settingsFor([1, 2], { prefix: 'U-', padding: 3, startNumber: 9, x: 30, y: 40 }),
    );
    expect(upd.ok).toBe(true);
    if (!upd.ok) return;
    expect(upd.value.labels).toEqual(['U-009', 'U-010']);

    const after = await texts(engine, 'doc-1');
    expect(after[0]).toContain('U-009');
    expect(after[0]).not.toContain('U-000001');
    expect(after[1]).toContain('U-010');

    const parsed = await parse(await bytes(engine, 'doc-1'));
    const content = decodePage(parsed, 0);
    expect(batesTm(content)!.x).toBeCloseTo(30, 3);
    const settings = markerPayload(content)?.settings as Record<string, unknown>;
    expect(settings.x).toBe(30);
    expect(settings.padding).toBe(3);

    // Exactly ONE undo entry: it returns to the added run, not past it.
    const undo1 = await engine.undo('doc-1');
    expect(undo1.ok).toBe(true);
    const restored = await texts(engine, 'doc-1');
    expect(restored[0]).toContain('U-000001');
    expect(restored[0]).not.toContain('U-009');

    const undo2 = await engine.undo('doc-1');
    expect(undo2.ok).toBe(true);
    expect((await texts(engine, 'doc-1'))[0]).not.toContain('U-');
  });

  it('updateBates survives serializeDoc + reopen with the new position and padding', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1], { prefix: 'R-', padding: 6 }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    await engine.updateBates(
      'doc-1',
      listed.value[0].id,
      settingsFor([1], { prefix: 'R-', padding: 2, x: 400, y: 500 }),
    );

    const serialized = await engine.getDocumentBytes('doc-1');
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const reopenPath = join(dir, 'reopen.pdf');
    await writeFile(reopenPath, Buffer.from(new Uint8Array(serialized.value)));

    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', reopenPath);
    expect((await texts(engine2, 'doc-2'))[0]).toContain('R-01');

    const reopened = await engine2.getBates('doc-2');
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toHaveLength(1);
    expect(reopened.value[0].x).toBe(400);
    expect(reopened.value[0].y).toBe(500);
    expect(reopened.value[0].padding).toBe(2);
    expect(reopened.value[0].labels).toEqual(['R-01']);
  });

  it('deleteBates removes exactly that run while a second survives', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1, 3], { prefix: 'D1-' }));
    await engine.addBates('doc-1', settingsFor([2], { prefix: 'D2-' }));

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const id1 = listed.value.find((b) => b.prefix === 'D1-')!.id;

    const del = await engine.deleteBates('doc-1', id1);
    expect(del.ok).toBe(true);

    const after = await engine.getBates('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toHaveLength(1);
    expect(after.value[0].prefix).toBe('D2-');

    const t = await texts(engine, 'doc-1');
    expect(t[0]).not.toContain('D1-');
    expect(t[2]).not.toContain('D1-');
    expect(t[1]).toContain('D2-000001');
  });

  it('an unknown id refuses and mutates nothing', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1], { prefix: 'K-' }));
    // Normalize the scan-visible page entries up front (a one-time, idempotent
    // effect of any marker scan) so the byte comparison below measures the
    // refusal itself, not that normalization.
    await engine.getBates('doc-1');
    const before = await bytes(engine, 'doc-1');

    const del = await engine.deleteBates('doc-1', 'bates-nope');
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error.code).toBe('engine-error');

    const upd = await engine.updateBates('doc-1', 'bates-nope', settingsFor([1], { prefix: 'Z-' }));
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error.code).toBe('engine-error');

    expect(await bytes(engine, 'doc-1')).toEqual(before);

    // The run survives and no undo entry was pushed by either refusal.
    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value).toHaveLength(1);
      expect(listed.value[0].prefix).toBe('K-');
    }
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    expect((await engine.getBates('doc-1'))).toEqual({ ok: true, value: [] });
  });
});

describe('Phase 90: legacy Phase 89 marker', () => {
  async function createLegacyFixture(): Promise<string> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PW, PH]);
    page.drawText('LEGACY-PAGE', { x: 72, y: 700, size: 14 });
    const marker = '%TFLEX-BATES ' + Buffer.from(
      JSON.stringify({ id: 'bates-legacy1', page: 1, label: 'LEG-000001' }),
      'utf8',
    ).toString('base64url');
    const stream = doc.context.stream(new TextEncoder().encode(marker));
    const ref = doc.context.register(stream);
    page.node.addContentStream(ref);
    const path = join(dir, 'legacy.pdf');
    await writeFile(path, Buffer.from(await doc.save()));
    return path;
  }

  it('lists with defaults, refuses update, and is deletable', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createLegacyFixture());

    const listed = await engine.getBates('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    const info = listed.value[0];
    expect(info.id).toBe('bates-legacy1');
    expect(info.pages).toEqual([1]);
    expect(info.labels).toEqual(['LEG-000001']);
    expect(info.prefix).toBe('');
    expect(info.padding).toBe(6);
    expect(info.size).toBe(10);
    expect(info.x).toBeUndefined();
    expect(info.y).toBeUndefined();

    const before = await bytes(engine, 'doc-1');
    const upd = await engine.updateBates('doc-1', 'bates-legacy1', settingsFor([1], { prefix: 'N-' }));
    expect(upd.ok).toBe(false);
    if (!upd.ok) {
      expect(upd.error.code).toBe('engine-error');
      expect(upd.error.message).toContain('older version');
    }
    expect(await bytes(engine, 'doc-1')).toEqual(before);

    const del = await engine.deleteBates('doc-1', 'bates-legacy1');
    expect(del.ok).toBe(true);
    const after = await engine.getBates('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toEqual([]);
  });
});


