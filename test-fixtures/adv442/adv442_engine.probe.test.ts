// ADV TFL-442 probe — Phase 87 engine.removeBlankPages batch-delete bookkeeping.
//
// Attacks 1-4 (survivors/refusals/undo/save round-trip) and attack 2
// (annotation / text box / placed signature bookkeeping) against the shipped
// EngineService. Run with:
//   npx vitest run --config test-fixtures/adv442/vitest.probe.config.ts
//
// The probe prints its observations; assertions that encode the SPEC contract
// are marked. Anything the probe prints as a divergence is a candidate finding.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../src/main/services/engine';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adv442-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, n: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) {
    doc.addPage([612, 792]).drawText(`TOKEN_${i + 1}`, { x: 72, y: 700, size: 14, font });
  }
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

async function texts(engine: EngineService, id: string): Promise<string[]> {
  const r = await engine.exportText(id);
  return r.ok ? r.value.map((p) => p.text) : [];
}

async function bytes(engine: EngineService, id: string): Promise<string> {
  const r = await engine.getDocumentBytes(id);
  return r.ok ? Buffer.from(new Uint8Array(r.value)).toString('base64') : 'ERR';
}

/** Serialize the engine's CURRENT visible order, reload into a fresh engine,
 *  and read the text. `exportText` reads the loaded pdfDoc and does NOT honour
 *  unsaved deletions (documented in phase87BlankPagesEngine.test.ts). */
async function reloadTexts(engine: EngineService, id: string, tag: string): Promise<string[]> {
  const r = await engine.getDocumentBytes(id);
  if (!r.ok) return [];
  const p = join(dir, `reload-${tag}.pdf`);
  await writeFile(p, Buffer.from(new Uint8Array(r.value)));
  const e2 = new EngineService();
  await e2.loadDocument(`reload-${tag}`, p);
  return texts(e2, `reload-${tag}`);
}

function anns(state: any): Array<Record<string, unknown>> {
  return (state.annotations as Array<Record<string, unknown>>) ?? [];
}

const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xD7, 0x63, 0x60, 0x60, 0xF8, 0x0F, 0x00,
  0x01, 0x01, 0x00, 0x05, 0x18, 0xD8, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xAE, 0x42, 0x60, 0x82,
]);

describe('ADV TFL-442 — attack 1: first / last / adjacent page removal', () => {
  it('first page: survivors and order are correct', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f1.pdf', 4));
    const before = await reloadTexts(engine, 'd', 'f1-before');
    const r = await engine.removeBlankPages('d', { pages: [1] });
    expect(r.ok).toBe(true);
    const after = await reloadTexts(engine, 'd', 'f1-after');
    console.log('attack1 first  ->', JSON.stringify(after));
    expect(after).toEqual([before[1], before[2], before[3]]);
    expect((await engine.getState('d')).ok && (await engine.getState('d'))!.value.pageCount).toBe(3);
  });

  it('last page: survivors and order are correct', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f2.pdf', 4));
    const before = await reloadTexts(engine, 'd', 'f2-before');
    const r = await engine.removeBlankPages('d', { pages: [4] });
    expect(r.ok).toBe(true);
    const after = await reloadTexts(engine, 'd', 'f2-after');
    console.log('attack1 last   ->', JSON.stringify(after));
    expect(after).toEqual([before[0], before[1], before[2]]);
  });

  it('two adjacent pages: survivors and order are correct', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f3.pdf', 5));
    const before = await reloadTexts(engine, 'd', 'f3-before');
    const r = await engine.removeBlankPages('d', { pages: [2, 3] });
    expect(r.ok).toBe(true);
    const after = await reloadTexts(engine, 'd', 'f3-after');
    console.log('attack1 adj    ->', JSON.stringify(after));
    expect(after).toEqual([before[0], before[3], before[4]]);
  });
});

describe('ADV TFL-442 — attack 3: refusals leave bytes unchanged', () => {
  it('duplicate / out-of-range / delete-all refuse and do not touch bytes', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f4.pdf', 4));
    const b0 = await bytes(engine, 'd');
    for (const pages of [[2, 2], [0], [5], [1, 2, 3, 4], []]) {
      const r = await engine.removeBlankPages('d', { pages });
      console.log('attack3 refusal', JSON.stringify(pages), '->', r.ok ? 'OK(!)' : r.error.code);
      expect(r.ok).toBe(false);
    }
    expect(await bytes(engine, 'd')).toBe(b0);
    const st = await engine.getState('d');
    expect(st.ok && st.value.pageCount).toBe(4);
  });
});

describe('ADV TFL-442 — attack 4: one undo, second undo, save round-trip', () => {
  it('undo restores exactly; second undo is nothing-to-undo; reload keeps removal', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f5.pdf', 5));
    const before = await texts(engine, 'd');
    const r = await engine.removeBlankPages('d', { pages: [2, 4] });
    expect(r.ok).toBe(true);

    const u = await engine.undo('d');
    expect(u.ok).toBe(true);
    const stAfterUndo = await engine.getState('d');
    expect(stAfterUndo.ok && stAfterUndo.value.pageCount).toBe(5);
    expect(await texts(engine, 'd')).toEqual(before);
    const u2 = await engine.undo('d');
    expect(u2.ok).toBe(false);
    if (!u2.ok) console.log('attack4 second undo ->', u2.error.code);

    // redo, then serialize + reload
    const rd = await engine.redo('d');
    expect(rd.ok).toBe(true);
    const stAfterRedo = await engine.getState('d');
    expect(stAfterRedo.ok && stAfterRedo.value.pageCount).toBe(3);
    const serialized = await engine.getDocumentBytes('d');
    expect(serialized.ok).toBe(true);
    const p2 = join(dir, 'reloaded.pdf');
    await writeFile(p2, Buffer.from(new Uint8Array(serialized.ok ? serialized.value : new ArrayBuffer(0))));
    const engine2 = new EngineService();
    await engine2.loadDocument('d2', p2);
    const reloaded = await texts(engine2, 'd2');
    console.log('attack4 reload ->', JSON.stringify(reloaded));
    expect(reloaded).toEqual([before[0], before[2], before[4]]);
  });
});

describe('ADV TFL-442 — attack 2: annotation / text box / signature bookkeeping', () => {
  it('items on a surviving page keep a consistent visible page number', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f6.pdf', 4));

    // One annotation, one text box, one placed signature on visible page 3.
    await engine.createAnnotation('d', {
      id: 'ann-p3', kind: 'rect', page: 3,
      rects: [{ x: 100, y: 500, width: 100, height: 50 }], color: 'yellow',
    } as never);
    await engine.addTextBox('d', {
      id: 'box-p3', page: 3, rect: { x: 72, y: 72, width: 200, height: 100 }, text: 'BOX3',
    } as never);
    await engine.placeSignature('d', {
      id: 'sig-p3', signatureId: 'tmpl', page: 3,
      rect: { x: 100, y: 500, width: 150, height: 50 }, pngBytes: MINIMAL_PNG,
    } as never);

    const pre = await engine.getState('d');
    expect(pre.ok).toBe(true);
    const preState: any = pre.ok ? pre.value : {};
    console.log('attack2 pre  ann.page =', JSON.stringify(anns(preState).map((a) => ({ id: a.id, page: a.page }))));
    console.log('attack2 pre  box.page =', JSON.stringify((preState.textBoxes ?? []).map((b: any) => ({ id: b.id, page: b.page }))));
    console.log('attack2 pre  sig.page =', JSON.stringify((preState.placedSignatures ?? []).map((s: any) => ({ id: s.id, page: s.page }))));

    // Remove visible page 1 -> old visible page 3 becomes visible page 2.
    const r = await engine.removeBlankPages('d', { pages: [1] });
    expect(r.ok).toBe(true);
    const postState: any = r.ok ? r.value.state : {};
    const annPages = anns(postState).map((a) => ({ id: a.id, page: a.page }));
    const boxPages = (postState.textBoxes ?? []).map((b: any) => ({ id: b.id, page: b.page }));
    const sigPages = (postState.placedSignatures ?? []).map((s: any) => ({ id: s.id, page: s.page }));
    console.log('attack2 post ann.page =', JSON.stringify(annPages));
    console.log('attack2 post box.page =', JSON.stringify(boxPages));
    console.log('attack2 post sig.page =', JSON.stringify(sigPages));
    console.log('attack2 post pageCount =', postState.pageCount);

    // The spec: bookkeeping must stay consistent with VISIBLE numbering.
    // Text boxes and signatures shift in applyOpToDoc's delete case; the
    // annotation page field is NOT renumbered by buildState.
    expect(boxPages).toEqual([{ id: 'box-p3', page: 2 }]);
    expect(sigPages).toEqual([{ id: 'sig-p3', page: 2 }]);
    // This is the suspected divergence: annotation still reports page 3.
    expect(annPages).toEqual([{ id: 'ann-p3', page: 2 }]);
  });

  it('annotation on the DELETED page is dropped (clean)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f7.pdf', 4));
    await engine.createAnnotation('d', {
      id: 'ann-p2', kind: 'rect', page: 2,
      rects: [{ x: 100, y: 500, width: 100, height: 50 }], color: 'yellow',
    } as never);
    const r = await engine.removeBlankPages('d', { pages: [2] });
    expect(r.ok).toBe(true);
    const postState: any = r.ok ? r.value.state : {};
    console.log('attack2 dropped ->', JSON.stringify(anns(postState).map((a) => a.id)));
    expect(anns(postState).find((a) => a.id === 'ann-p2')).toBeUndefined();
  });

  it('INHERITANCE: the single applyOp delete shows the same stale annotation page', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await fixture('f8.pdf', 4));
    await engine.createAnnotation('d', {
      id: 'ann-p3', kind: 'rect', page: 3,
      rects: [{ x: 100, y: 500, width: 100, height: 50 }], color: 'yellow',
    } as never);
    // Pre-existing single-page delete (0-based page index 0 = visible page 1).
    const r = await engine.applyOp('d', { kind: 'delete', page: 0 });
    expect(r.ok).toBe(true);
    const postState: any = r.ok ? r.value : {};
    console.log('inheritance applyOp ann.page ->', JSON.stringify(anns(postState).map((a) => ({ id: a.id, page: a.page }))), 'pageCount', postState.pageCount);
  });
});