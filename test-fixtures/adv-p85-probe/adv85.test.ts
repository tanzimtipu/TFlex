// TFL-420 adversarial probe suite (adversary, diff-pass, Phase 85).
// Throwaway probes. Never imported by the product. Run with the scratch config.
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { EngineService } from '../../src/main/services/engine';
import { writeOutline } from '../../src/main/services/page-organize';
import {
  countOutline,
  indentEntry,
  insertEntry,
  outdentEntry,
  removeEntry,
  type OutlineEntry,
} from '../../src/shared/outline';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'adv-p85-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function log(tag: string, obj: unknown): void {
  console.log(`ADV85 ${tag} ${JSON.stringify(obj)}`);
}

async function createNPagePdf(n: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([612, 792]);
  const bytes = await doc.save();
  const p = join(dir, `plain-${n}.pdf`);
  await writeFile(p, Buffer.from(bytes));
  return p;
}

function lookupDict(doc: PDFDocument, v: unknown): PDFDict | null {
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFRef) {
    const l = doc.context.lookup(v);
    if (l instanceof PDFDict) return l;
  }
  return null;
}

function outlineRoot(doc: PDFDocument): PDFDict | null {
  return lookupDict(doc, doc.catalog.get(PDFName.of('Outlines')));
}

function nodeTitle(doc: PDFDocument, n: PDFDict): string {
  const t = n.get(PDFName.of('Title'));
  return t instanceof PDFString ? t.asString() : '';
}

function chain(doc: PDFDocument, first: unknown): PDFDict[] {
  const out: PDFDict[] = [];
  const seen = new Set<string>();
  let cur: unknown = first;
  while (cur !== null && cur !== undefined) {
    const tag = cur instanceof PDFRef ? cur.tag : 'inline';
    if (seen.has(tag)) break;
    seen.add(tag);
    const n = lookupDict(doc, cur);
    if (n === null) break;
    out.push(n);
    cur = n.get(PDFName.of('Next'));
  }
  return out;
}

function destPage(doc: PDFDocument, n: PDFDict): number | null {
  const d = n.get(PDFName.of('Dest'));
  if (!(d instanceof PDFArray) || d.size() === 0) return null;
  const first = d.get(0);
  if (!(first instanceof PDFRef)) return null;
  for (let i = 0; i < doc.getPageCount(); i++) {
    if (doc.getPage(i).ref.tag === first.tag) return i + 1;
  }
  return null;
}

async function loadBytes(doc: PDFDocument): Promise<PDFDocument> {
  const b = await doc.save();
  return PDFDocument.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

// Build an outline node that has a /Prev link (the shape every real-world
// outline uses). Returns the file path.
async function buildPrevOutlinePdf(file: string, pages = 2): Promise<string> {
  const doc = await PDFDocument.create();
  const ps = [];
  for (let i = 0; i < pages; i++) ps.push(doc.addPage([612, 792]));
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  let prev: PDFRef | null = null;
  let first: PDFRef | null = null;
  for (let i = 0; i < pages; i++) {
    const item = ctx.obj({ Title: PDFString.of(`BM${i + 1}`), Parent: rootRef });
    if (prev) item.set(PDFName.of('Prev'), prev);
    const ref = ctx.register(item);
    item.set(
      PDFName.of('Dest'),
      ctx.obj([ps[i].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
    );
    if (prev) {
      const pd = ctx.lookup(prev) as PDFDict;
      pd.set(PDFName.of('Next'), ref);
    } else {
      first = ref;
    }
    prev = ref;
  }
  root.set(PDFName.of('First'), first);
  root.set(PDFName.of('Last'), prev);
  root.set(PDFName.of('Count'), PDFNumber.of(pages));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  await writeFile(file, Buffer.from(await doc.save()));
  return file;
}

describe('ADV85 case 4/7: pre-existing outline structural links', () => {
  it('case4/7a: a /Prev link on siblings must not be copied as a source-doc ref', async () => {
    const src = join(dir, 'prev-outline.pdf');
    await buildPrevOutlinePdf(src, 2);

    const engine = new EngineService();
    const lr = await engine.loadDocument('d1', src);
    expect(lr.ok).toBe(true);

    let saved: PDFDocument | null = null;
    let threw: string | null = null;
    try {
      const w = await engine.getDocumentBytes('d1');
      expect(w.ok).toBe(true);
      if (!w.ok) return;
      const buf = Buffer.from(w.value);
      await writeFile(join(dir, 'prev-outline-out.pdf'), buf);
      saved = await PDFDocument.load(buf);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    log('case4-7a', { threw, saved: saved !== null });

    if (saved === null) return;
    const root = outlineRoot(saved);
    const nodes = root ? chain(saved, root.get(PDFName.of('First'))) : [];
    const details = nodes.map((n) => {
      const prev = n.get(PDFName.of('Prev'));
      let prevResolves = 'none';
      if (prev !== undefined) {
        if (!(prev instanceof PDFRef)) prevResolves = `nonref:${String(prev)}`;
        else {
          const looked = saved!.context.lookup(prev);
          prevResolves = looked instanceof PDFDict ? `dict:${nodeTitle(saved!, looked)}` : `other:${String(looked)}`;
        }
      }
      return { title: nodeTitle(saved!, n), page: destPage(saved!, n), prev: prev ? String(prev) : 'none', prevResolves };
    });
    log('case4-7a-nodes', details);
    expect(nodes.map((n) => nodeTitle(saved!, n))).toEqual(['BM1', 'BM2']);
    for (const d of details) {
      if (d.title === 'BM1') continue;
      // BM2's /Prev must either be absent or point at the BM1 node.
      expect(d.prevResolves, `BM2 /Prev must be valid or absent, got ${d.prev} -> ${d.prevResolves}`).toBe('dict:BM1');
    }
  });

  it('case4/7b: an inline-dict sibling chain must not lose later siblings', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    // Two INLINE (direct) sibling dicts. Legal-ish PDF, no indirect refs.
    const a = ctx.obj({ Title: PDFString.of('InlineA') });
    a.set(PDFName.of('Dest'), ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    const b = ctx.obj({ Title: PDFString.of('InlineB') });
    b.set(PDFName.of('Dest'), ctx.obj([p2.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    a.set(PDFName.of('Next'), b);
    root.set(PDFName.of('First'), a);
    root.set(PDFName.of('Last'), b);
    root.set(PDFName.of('Count'), PDFNumber.of(2));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'inline-outline.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    const lr = await engine.loadDocument('d1', src);
    expect(lr.ok).toBe(true);
    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const r = outlineRoot(out);
    const titles = r ? chain(out, r.get(PDFName.of('First'))).map((n) => nodeTitle(out, n)) : [];
    log('case4-7b-titles', titles);
    expect(titles).toEqual(['InlineA', 'InlineB']);
  });

  it('case4/7c: a cyclic /First (tree cycle) must not hang or crash the save', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    const a = ctx.obj({ Title: PDFString.of('A'), Parent: rootRef });
    const aRef = ctx.register(a);
    const b = ctx.obj({ Title: PDFString.of('B'), Parent: aRef });
    const bRef = ctx.register(b);
    a.set(PDFName.of('First'), bRef);
    b.set(PDFName.of('First'), aRef); // cycle through First
    root.set(PDFName.of('First'), aRef);
    root.set(PDFName.of('Count'), PDFNumber.of(1));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'first-cycle.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    const t0 = Date.now();
    let threw: string | null = null;
    try {
      const w = await engine.getDocumentBytes('d1');
      if (!w.ok) threw = `err:${w.error.code}`;
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    log('case4-7c', { ms: Date.now() - t0, threw });
    expect(Date.now() - t0).toBeLessThan(20000);
  });

  it('case4/7d: a /Dest naming a destination or with odd arity must not corrupt the output', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    let prev: PDFRef | null = null;
    let first: PDFRef | null = null;
    const specs: Array<Record<string, unknown>> = [
      { t: 'NamedName', d: PDFName.of('MyDest') },
      { t: 'NamedStr', d: PDFString.of('MyDest') },
      { t: 'Arity1', d: null },
      { t: 'NullDest', d: PDFNull },
    ];
    for (const s of specs) {
      const item = ctx.obj({ Title: PDFString.of(s.t as string), Parent: rootRef });
      if (s.t === 'Arity1') item.set(PDFName.of('Dest'), ctx.obj([p1.ref]));
      else item.set(PDFName.of('Dest'), s.d as never);
      const ref = ctx.register(item);
      if (prev) (ctx.lookup(prev) as PDFDict).set(PDFName.of('Next'), ref);
      else first = ref;
      prev = ref;
    }
    root.set(PDFName.of('First'), first);
    root.set(PDFName.of('Last'), prev);
    root.set(PDFName.of('Count'), PDFNumber.of(specs.length));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'odd-dest.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    let threw: string | null = null;
    let titles: string[] = [];
    try {
      const w = await engine.getDocumentBytes('d1');
      expect(w.ok).toBe(true);
      if (!w.ok) return;
      const out = await PDFDocument.load(Buffer.from(w.value));
      const r = outlineRoot(out);
      titles = r ? chain(out, r.get(PDFName.of('First'))).map((n) => nodeTitle(out, n)) : [];
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    log('case4-7d', { threw, titles });
    expect(threw, 'malformed pre-existing /Dest must not throw on save').toBeNull();
    expect(titles.length, 'every node survives the odd /Dest values').toBe(4);
  });

  it('case4/7e: cyclic /Next, missing /Parent and a non-dict /First must not hang or crash', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    const a = ctx.obj({ Title: PDFString.of('A') }); // missing /Parent on purpose
    const aRef = ctx.register(a);
    const b = ctx.obj({ Title: PDFString.of('B'), Parent: rootRef });
    const bRef = ctx.register(b);
    a.set(PDFName.of('Dest'), ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    b.set(PDFName.of('Dest'), ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    a.set(PDFName.of('Next'), bRef);
    b.set(PDFName.of('Next'), aRef); // cyclic /Next
    root.set(PDFName.of('First'), aRef);
    root.set(PDFName.of('Last'), bRef);
    root.set(PDFName.of('Count'), PDFNumber.of(2));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'next-cycle.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    const t0 = Date.now();
    let threw: string | null = null;
    try {
      const w = await engine.getDocumentBytes('d1');
      if (!w.ok) threw = `err:${w.error.code}`;
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    log('case4-7e-cycle', { ms: Date.now() - t0, threw });
    expect(Date.now() - t0).toBeLessThan(20000);

    // A non-dict /First must be tolerated too.
    const doc2 = await PDFDocument.create();
    doc2.addPage([612, 792]);
    const c2 = doc2.context;
    const r2 = c2.obj({ Type: 'Outlines' });
    const r2ref = c2.register(r2);
    r2.set(PDFName.of('First'), PDFNumber.of(42));
    doc2.catalog.set(PDFName.of('Outlines'), r2ref);
    const src2 = join(dir, 'first-nondict.pdf');
    await writeFile(src2, Buffer.from(await doc2.save()));
    const e2 = new EngineService();
    await e2.loadDocument('d2', src2);
    let threw2: string | null = null;
    try {
      const w2 = await e2.getDocumentBytes('d2');
      if (!w2.ok) threw2 = `err:${w2.error.code}`;
    } catch (e) {
      threw2 = e instanceof Error ? e.message : String(e);
    }
    log('case4-7e-nondict', { threw2 });
    expect(threw2).toBeNull();
  });

  it('case4/7g: an indirect /Dest (ref to the dest array) and an indirect GoTo /A must keep their targets', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    // Node A: /Dest is an indirect ref to the dest array (legal and produced by
    // some generators).
    const destArr = ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]);
    const destRef = ctx.register(destArr);
    const a = ctx.obj({ Title: PDFString.of('IndirectDest'), Parent: rootRef });
    a.set(PDFName.of('Dest'), destRef);
    const aRef = ctx.register(a);
    // Node B: /A is an indirect GoTo action whose /D is an indirect dest array.
    const dArr = ctx.obj([p2.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]);
    const dRef = ctx.register(dArr);
    const action = ctx.obj({ S: PDFName.of('GoTo'), D: dRef });
    const actionRef = ctx.register(action);
    const b = ctx.obj({ Title: PDFString.of('IndirectAction'), Parent: rootRef });
    b.set(PDFName.of('A'), actionRef);
    const bRef = ctx.register(b);
    a.set(PDFName.of('Next'), bRef);
    root.set(PDFName.of('First'), aRef);
    root.set(PDFName.of('Last'), bRef);
    root.set(PDFName.of('Count'), PDFNumber.of(2));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'indirect-dest.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const r = outlineRoot(out);
    const nodes = r ? chain(out, r.get(PDFName.of('First'))) : [];
    const shape = nodes.map((n) => {
      const d = n.get(PDFName.of('Dest'));
      let page = null as number | null;
      if (d instanceof PDFArray && d.size() > 0 && d.get(0) instanceof PDFRef) {
        for (let i = 0; i < out.getPageCount(); i++) {
          if (out.getPage(i).ref.tag === (d.get(0) as PDFRef).tag) page = i + 1;
        }
      }
      const av = n.get(PDFName.of('A'));
      const ad = lookupDict(out, av);
      const ddRaw = ad?.get(PDFName.of('D'));
      const dd = ddRaw instanceof PDFRef ? out.context.lookup(ddRaw) : ddRaw;
      let actionPage = null as number | null;
      if (dd instanceof PDFArray && dd.size() > 0 && dd.get(0) instanceof PDFRef) {
        for (let i = 0; i < out.getPageCount(); i++) {
          if (out.getPage(i).ref.tag === (dd.get(0) as PDFRef).tag) actionPage = i + 1;
        }
      }
      return { title: nodeTitle(out, n), page, actionPage };
    });
    log('case4-7g', shape);
    // Both targets should resolve (indirect arrays are legal).
    expect(shape.find((s) => s.title === 'IndirectDest')?.page).toBe(1);
    expect(shape.find((s) => s.title === 'IndirectAction')?.actionPage).toBe(2);
  });

  it('case4/7f: a malformed pre-existing outline + setOutline([]) drops it without residue', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    const a = ctx.obj({ Title: PDFString.of('A'), Parent: rootRef });
    const aRef = ctx.register(a);
    a.set(PDFName.of('Next'), aRef); // self cycle
    root.set(PDFName.of('First'), aRef);
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'self-cycle.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    const clr = await engine.setOutline('d1', []);
    expect(clr.ok).toBe(true);
    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(outlineRoot(await PDFDocument.load(Buffer.from(w.value)))).toBeNull();
  });
});

describe('ADV85 case 6: merge / reorder', () => {
  it('case6a: merging a doc with an outline must carry the outline', async () => {
    const a = join(dir, 'a.pdf');
    await buildPrevOutlinePdf(a, 3); // BM1..BM3 on pages 1..3
    const b = join(dir, 'b.pdf');
    await buildPrevOutlinePdf(b, 2); // BM1..BM2 on pages 1..2

    const engine = new EngineService();
    await engine.loadDocument('main', a);
    const m = await engine.merge('main', [b], 'after');
    log('case6a-merge', m.ok ? { pageCount: m.value.pageCount } : { err: m.error });
    expect(m.ok).toBe(true);

    const w = await engine.getDocumentBytes('main');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const r = outlineRoot(out);
    const titles = r ? chain(out, r.get(PDFName.of('First'))).map((n) => n) : [];
    const shape = titles.map((n) => ({ title: nodeTitle(out, n), page: destPage(out, n) }));
    log('case6a-outline', shape);
    // The merged doc has 5 pages; we expect all 5 source bookmarks to survive.
    expect(shape.length, 'merged outline must carry both source outlines').toBe(5);

    // Airtight: write to disk with engine.save and re-read.
    const sp = await engine.save('main');
    expect(sp.ok).toBe(true);
    if (!sp.ok) return;
    const savedBytes = await readFile(sp.value);
    const saved = await PDFDocument.load(savedBytes);
    const sr = outlineRoot(saved);
    const savedShape = sr
      ? chain(saved, sr.get(PDFName.of('First'))).map((n) => ({ title: nodeTitle(saved, n), page: destPage(saved, n) }))
      : [];
    log('case6a-saved-outline', savedShape);
    expect(savedShape.length, 'saved merged file must keep the source bookmarks').toBe(5);
  });

  it('case6b: reorder keeps outline targets pointing at the moved page', async () => {
    const p = join(dir, 'reorder.pdf');
    await buildPrevOutlinePdf(p, 3); // BM1->p1, BM2->p2, BM3->p3
    const engine = new EngineService();
    await engine.loadDocument('d1', p);
    const r = await engine.applyOp('d1', { kind: 'reorder', page: 0, param: 2 } as never);
    expect(r.ok).toBe(true);
    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const root = outlineRoot(out);
    const shape = root
      ? chain(out, root.get(PDFName.of('First'))).map((n) => ({ title: nodeTitle(out, n), page: destPage(out, n) }))
      : [];
    log('case6b-outline', shape);
    // Original page 1 moved to visible position 3.
    expect(shape.find((s) => s.title === 'BM1')?.page).toBe(3);
    expect(shape.find((s) => s.title === 'BM2')?.page).toBe(1);
    expect(shape.find((s) => s.title === 'BM3')?.page).toBe(2);
  });
});

describe('ADV85 case 2: deleted page target', () => {
  it('case2a: edit-save after deleting the targeted page refuses all-or-nothing', async () => {
    const p = await createNPagePdf(5);
    const engine = new EngineService();
    await engine.loadDocument('d1', p);
    const seed = await engine.setOutline('d1', [{ title: 'A', page: 5, children: [] }]);
    expect(seed.ok).toBe(true);
    // Delete visible page 5.
    const del = await engine.applyOp('d1', { kind: 'delete', page: 4 } as never);
    expect(del.ok).toBe(true);

    const before = await engine.getDocumentBytes('d1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeBytes = Buffer.from(before.value);

    const bad = await engine.setOutline('d1', [
      { title: 'ok', page: 1, children: [] },
      { title: 'bad', page: 5, children: [] },
    ]);
    log('case2a', bad.ok ? { ok: true } : { code: bad.error.code, msg: bad.error.message });
    expect(bad.ok).toBe(false);

    const after = await engine.getDocumentBytes('d1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(Buffer.compare(Buffer.from(after.value), beforeBytes)).toBe(0);

    // A valid target on a surviving page still applies.
    const good = await engine.setOutline('d1', [{ title: 'B', page: 4, children: [] }]);
    expect(good.ok).toBe(true);
  });
});

describe('ADV85 case 1: first bookmark / emptied tree', () => {
  it('case1a: outline-less doc -> first bookmark -> save/reload; empty -> no stray key', async () => {
    const p = await createNPagePdf(4);
    const engine = new EngineService();
    await engine.loadDocument('d1', p);

    const w0 = await engine.getDocumentBytes('d1');
    expect(w0.ok).toBe(true);
    if (!w0.ok) return;
    expect(outlineRoot(await PDFDocument.load(Buffer.from(w0.value)))).toBeNull();

    const first: OutlineEntry[] = [{ title: 'First', page: 2, children: [] }];
    expect((await engine.setOutline('d1', first)).ok).toBe(true);
    const w1 = await engine.getDocumentBytes('d1');
    if (!w1.ok) return;
    const d1 = await PDFDocument.load(Buffer.from(w1.value));
    const root = outlineRoot(d1);
    const nodes = root ? chain(d1, root.get(PDFName.of('First'))) : [];
    expect(nodes.map((n) => ({ t: nodeTitle(d1, n), p: destPage(d1, n) }))).toEqual([{ t: 'First', p: 2 }]);

    // The saved bytes must be readable by pdf.js as well.
    const pdf = await pdfjs.getDocument({ data: w1.value, useSystemFonts: false }).promise;
    try {
      const ol = await pdf.getOutline();
      expect(ol?.[0]?.title).toBe('First');
    } finally {
      await pdf.destroy();
    }

    // Empty it.
    expect((await engine.setOutline('d1', [])).ok).toBe(true);
    const w2 = await engine.getDocumentBytes('d1');
    if (!w2.ok) return;
    expect(outlineRoot(await PDFDocument.load(Buffer.from(w2.value)))).toBeNull();

    // save() to the real path and re-open the bytes.
    const sp = await engine.save('d1');
    expect(sp.ok).toBe(true);
    if (!sp.ok) return;
    const savedBytes = await readFile(sp.value);
    expect(outlineRoot(await PDFDocument.load(savedBytes))).toBeNull();
  });
});

describe('ADV85 case 5: undo byte round-trip', () => {
  it('case5a: edit -> undo restores the pre-edit bytes', async () => {
    const p = await createNPagePdf(4);
    const engine = new EngineService();
    await engine.loadDocument('d1', p);
    const A: OutlineEntry[] = [
      { title: 'A', page: 1, children: [{ title: 'A1', page: 2, children: [] }] },
    ];
    const B: OutlineEntry[] = [{ title: 'B', page: 3, children: [] }];
    expect((await engine.setOutline('d1', A)).ok).toBe(true);
    const wA = await engine.getDocumentBytes('d1');
    if (!wA.ok) return;
    const bytesA = Buffer.from(wA.value);

    expect((await engine.setOutline('d1', B)).ok).toBe(true);
    const u = await engine.undo('d1');
    expect(u.ok).toBe(true);
    const wU = await engine.getDocumentBytes('d1');
    if (!wU.ok) return;
    const bytesU = Buffer.from(wU.value);
    const same = Buffer.compare(bytesU, bytesA) === 0;
    log('case5a', { sameLen: bytesU.length === bytesA.length, sameBytes: same });
    expect(same, 'undo must restore the pre-edit serialized bytes').toBe(true);

    const rd = await engine.redo('d1');
    expect(rd.ok).toBe(true);
    const wR = await engine.getDocumentBytes('d1');
    if (!wR.ok) return;
    const dR = await PDFDocument.load(Buffer.from(wR.value));
    const rootR = outlineRoot(dR);
    const titlesR = rootR ? chain(dR, rootR.get(PDFName.of('First'))).map((n) => nodeTitle(dR, n)) : [];
    expect(titlesR).toEqual(['B']);
  });
});

describe('ADV85 case 7b: replacePages cross-doc ref collision', () => {
  it('case7b: replacePages across two docs with colliding ref numbers keeps each outline in its own doc', async () => {
    const a = join(dir, 'rpa.pdf');
    await buildPrevOutlinePdf(a, 3); // BM1->1 BM2->2 BM3->3
    const b = join(dir, 'rpb.pdf');
    await buildPrevOutlinePdf(b, 2); // BM1->1 BM2->2

    const engine = new EngineService();
    await engine.loadDocument('d1', a);
    const otherBytes = new Uint8Array(await readFile(b));
    const r = await engine.replacePages('d1', otherBytes, [0, 0]);
    log('case7b-replace', r.ok ? { pageCount: r.value.pageCount } : { err: r.error });
    expect(r.ok).toBe(true);

    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const root = outlineRoot(out);
    const shape = root
      ? chain(out, root.get(PDFName.of('First'))).map((n) => ({ title: nodeTitle(out, n), page: destPage(out, n) }))
      : [];
    log('case7b-outline', shape);
    // 4 pages: [other p1, other p2, current p2, current p3].
    // Current BM2/BM3 must land on new visible 3/4, not on the inserted pages.
    const pages = shape.map((s) => s.page).filter((p) => p !== null).sort();
    expect(pages).toEqual([1, 2, 3, 4]);
  });
});
describe('ADV85 case 3: indent/outdent tree invariants', () => {
  function verifyPairs(root: OutlineEntry[]): void {
    const walk = (list: OutlineEntry[]): number => {
      let n = 0;
      for (const e of list) {
        expect(Array.isArray(e.children)).toBe(true);
        n += 1 + walk(e.children);
      }
      return n;
    };
    expect(walk(root)).toBe(countOutline(root));
  }

  function titlesFlat(root: OutlineEntry[]): string[] {
    const out: string[] = [];
    const walk = (l: OutlineEntry[]) => { for (const e of l) { out.push(e.title); walk(e.children); } };
    walk(root);
    return out.sort();
  }

  it('case3a: indent/outdent at every path preserves the node multiset, no cycles', () => {
    const base: OutlineEntry[] = [
      { title: 'A', page: 1, children: [
        { title: 'A1', page: 2, children: [{ title: 'A1a', page: 3, children: [] }] },
        { title: 'A2', page: 4, children: [] },
      ] },
      { title: 'B', page: null, children: [] },
      { title: 'C', page: 5, children: [] },
    ];
    const paths: number[][] = [[0], [1], [2], [0, 0], [0, 1], [0, 0, 0], []];
    const expected = titlesFlat(base);
    for (const pth of paths) {
      const ind = indentEntry(base, pth);
      const outd = outdentEntry(base, pth);
      verifyPairs(ind);
      verifyPairs(outd);
      expect(titlesFlat(ind), `indent ${JSON.stringify(pth)} multiset`).toEqual(expected);
      expect(titlesFlat(outd), `outdent ${JSON.stringify(pth)} multiset`).toEqual(expected);
    }
    // Root indent is a no-op; root outdent is a no-op.
    expect(indentEntry(base, [0])).toEqual(base);
    expect(outdentEntry(base, [0])).toEqual(base);
  });

  it('case3b: engine round-trip keeps /Count correct after indent/outdent', async () => {
    const p = await createNPagePdf(4);
    const engine = new EngineService();
    await engine.loadDocument('d1', p);
    let tree: OutlineEntry[] = [
      { title: 'A', page: 1, children: [] },
      { title: 'B', page: 2, children: [] },
      { title: 'C', page: 3, children: [] },
    ];
    tree = indentEntry(tree, [2]); // C under B
    const r = await engine.setOutline('d1', tree);
    expect(r.ok).toBe(true);
    const w = await engine.getDocumentBytes('d1');
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const root = outlineRoot(out);
    if (root === null) throw new Error('no outline');
    const rootCount = root.get(PDFName.of('Count'));
    const nodes = chain(out, root.get(PDFName.of('First')));
    const shape = nodes.map((n) => ({ t: nodeTitle(out, n), c: n.get(PDFName.of('Count'))?.toString(), p: destPage(out, n) }));
    log('case3b', { rootCount: rootCount?.toString(), shape });
    expect(nodes.length).toBe(2);
    const bNode = nodes.find((n) => nodeTitle(out, n) === 'B');
    expect(bNode?.get(PDFName.of('Count'))?.toString()).toBe('1');
  });
});

describe('ADV85 case 7: cross-document ref aliasing via clonePrimitive', () => {
  it('case7a: a custom /SE ref on an outline node must not leak the source ref', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const ctx = doc.context;
    // A fake structure element in the SOURCE doc, registered at a low object
    // number so it is likely to collide with a real object in the output doc.
    const se = ctx.obj({ Type: 'StructElem', S: PDFName.of('P') });
    const seRef = ctx.register(se);
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    const item = ctx.obj({ Title: PDFString.of('Tagged'), Parent: rootRef });
    item.set(PDFName.of('Dest'), ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    item.set(PDFName.of('SE'), seRef);
    const itemRef = ctx.register(item);
    root.set(PDFName.of('First'), itemRef);
    root.set(PDFName.of('Last'), itemRef);
    root.set(PDFName.of('Count'), PDFNumber.of(1));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'se-outline.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('d1', src);
    const w = await engine.getDocumentBytes('d1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(Buffer.from(w.value));
    const r = outlineRoot(out);
    const n = r ? chain(out, r.get(PDFName.of('First')))[0] : null;
    const seVal = n?.get(PDFName.of('SE'));
    let resolvesTo = 'none';
    if (seVal instanceof PDFRef) {
      const looked = out.context.lookup(seVal);
      const ld = lookupDict(out, seVal);
      resolvesTo = ld ? `dict:${JSON.stringify(ld.toString?.() ?? '')}` : `other:${String(looked)}`;
    } else if (seVal !== undefined) {
      resolvesTo = `nonref:${String(seVal)}`;
    }
    log('case7a', { seVal: seVal ? String(seVal) : 'none', resolvesTo });
    // The /SE must not survive as a raw source ref into the output.
    if (seVal instanceof PDFRef) {
      const ld = lookupDict(out, seVal);
      expect(ld, '/SE must not alias an unrelated output object').toBeNull();
    }
  });
});
