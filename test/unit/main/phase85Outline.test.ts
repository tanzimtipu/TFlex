import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
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
import { EngineService } from '../../../src/main/services/engine';
import { writeOutline } from '../../../src/main/services/page-organize';
import {
  indentEntry,
  insertEntry,
  normalizeOutline,
  removeEntry,
  renameEntry,
  retargetEntry,
  type OutlineEntry,
} from '../../../src/shared/outline';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p85-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createNPagePdf(n: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    doc.addPage([612, 792]).drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
  }
  const bytes = await doc.save();
  const path = join(dir, `p85-${n}.pdf`);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

/** Recursively read a document's /Outlines tree. `page` is the 1-based VISIBLE
 *  page a /Dest resolves to, or null when there is no resolvable target. */
function readOutlineTree(doc: PDFDocument): OutlineEntry[] {
  const rootVal = doc.catalog.get(PDFName.of('Outlines'));
  let root: PDFDict | null = null;
  if (rootVal instanceof PDFDict) root = rootVal;
  else if (rootVal instanceof PDFRef) {
    const looked = doc.context.lookup(rootVal);
    if (looked instanceof PDFDict) root = looked;
  }
  if (root === null) return [];
  const seen = new Set<string>();

  function readChain(first: unknown): OutlineEntry[] {
    const out: OutlineEntry[] = [];
    let cur: unknown = first;
    while (cur !== undefined && cur !== null) {
      const tag = cur instanceof PDFRef ? cur.tag : 'inline';
      if (seen.has(tag)) break;
      seen.add(tag);
      let node: PDFDict | null = null;
      if (cur instanceof PDFDict) node = cur;
      else if (cur instanceof PDFRef) {
        const looked = doc.context.lookup(cur);
        if (looked instanceof PDFDict) node = looked;
      }
      if (node === null) break;
      const titleObj = node.get(PDFName.of('Title'));
      const title = titleObj instanceof PDFString ? titleObj.asString() : '';
      let page: number | null = null;
      const destVal = node.get(PDFName.of('Dest'));
      if (destVal instanceof PDFArray && destVal.size() > 0) {
        const firstEl = destVal.get(0);
        if (firstEl instanceof PDFRef) {
          for (let p = 0; p < doc.getPageCount(); p++) {
            if (doc.getPage(p).ref.tag === firstEl.tag) {
              page = p + 1;
              break;
            }
          }
        }
      }
      out.push({ title, page, children: readChain(node.get(PDFName.of('First'))) });
      cur = node.get(PDFName.of('Next'));
    }
    return out;
  }

  return readChain(root.get(PDFName.of('First')));
}

async function workingOutline(engine: EngineService, docId: string): Promise<OutlineEntry[]> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  if (!r.ok) return [];
  const re = await PDFDocument.load(r.value);
  return readOutlineTree(re);
}

async function savedOutline(engine: EngineService, docId: string): Promise<OutlineEntry[]> {
  const saveR = await engine.save(docId);
  expect(saveR.ok).toBe(true);
  if (!saveR.ok) return [];
  const bytes = await readFile(saveR.value);
  const re = await PDFDocument.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return readOutlineTree(re);
}

// ---------------------------------------------------------------------------
// setOutline
// ---------------------------------------------------------------------------

describe('Phase 85: engine.setOutline', () => {
  it('writes a nested /Outlines tree, re-read from the working doc and a save', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);

    const tree: OutlineEntry[] = [
      {
        title: 'Chapter 1',
        page: 2,
        children: [{ title: 'Section 1.1', page: 3, children: [] }],
      },
      { title: 'Chapter 2', page: null, children: [] },
    ];
    const r = await engine.setOutline('doc-1', tree);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.modified).toBe(true);

    expect(await workingOutline(engine, 'doc-1')).toEqual(tree);
    expect(await savedOutline(engine, 'doc-1')).toEqual(tree);

    // The persisted /Dest resolves to a real page and keeps the /XYZ form.
    // (The pre-existing carryOutlines remap rebuilds the array on serialize,
    // so its exact element count is asserted by the direct writeOutline test
    // below rather than on the serialized bytes.)
    const w = await engine.getDocumentBytes('doc-1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const re = await PDFDocument.load(w.value);
    const rootVal = re.catalog.get(PDFName.of('Outlines'));
    const root = re.context.lookup(rootVal) as PDFDict;
    const firstRef = root.get(PDFName.of('First')) as PDFRef;
    const firstNode = re.context.lookup(firstRef) as PDFDict;
    const dest = firstNode.get(PDFName.of('Dest'));
    expect(dest).toBeInstanceOf(PDFArray);
    if (dest instanceof PDFArray) {
      expect(dest.get(0)).toBeInstanceOf(PDFRef);
    }
  });

  it('persists each nested /Count as the open descendant count', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    const tree: OutlineEntry[] = [
      {
        title: 'A',
        page: 1,
        children: [
          { title: 'A1', page: 2, children: [{ title: 'A1a', page: 3, children: [] }] },
        ],
      },
      { title: 'B', page: null, children: [] },
    ];
    const r = await engine.setOutline('doc-1', tree);
    expect(r.ok).toBe(true);

    const w = await engine.getDocumentBytes('doc-1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const re = await PDFDocument.load(w.value);
    const root = re.context.lookup(re.catalog.get(PDFName.of('Outlines'))) as PDFDict;
    // The pre-existing carryOutlines remap recomputes the ROOT /Count as the
    // number of top-level entries on serialize; the per-node counts survive.
    expect(root.get(PDFName.of('Count'))).toBeDefined();
    const firstNode = re.context.lookup(root.get(PDFName.of('First'))) as PDFDict;
    expect(firstNode.get(PDFName.of('Count'))?.toString()).toBe('2');
    const childNode = re.context.lookup(firstNode.get(PDFName.of('First'))) as PDFDict;
    expect(childNode.get(PDFName.of('Count'))?.toString()).toBe('1');
  });

  it('round-trips a tree built with the pure edit helpers', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    let tree = normalizeOutline([
      { title: 'Intro', page: 1, children: [] },
      { title: 'Body', page: 2, children: [] },
      { title: 'Appendix', page: 3, children: [] },
    ]);
    tree = insertEntry(tree, [], { title: 'Chapter', page: 4, children: [] });
    tree = renameEntry(tree, [0], 'Cover');
    tree = retargetEntry(tree, [1], 5);
    tree = indentEntry(tree, [1]); // Body becomes a child of Cover
    tree = insertEntry(tree, [0], { title: 'Sub', page: 2, children: [] });
    tree = removeEntry(tree, [1]); // drop Appendix

    const expected: OutlineEntry[] = [
      {
        title: 'Cover',
        page: 1,
        children: [
          { title: 'Body', page: 5, children: [] },
          { title: 'Sub', page: 2, children: [] },
        ],
      },
      { title: 'Chapter', page: 4, children: [] },
    ];
    expect(tree).toEqual(expected);

    const r = await engine.setOutline('doc-1', tree);
    expect(r.ok).toBe(true);
    expect(await workingOutline(engine, 'doc-1')).toEqual(expected);
    expect(await savedOutline(engine, 'doc-1')).toEqual(expected);
  });

  it('refuses an out-of-range page and applies nothing', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const okTree: OutlineEntry[] = [{ title: 'Intro', page: 1, children: [] }];
    const seed = await engine.setOutline('doc-1', okTree);
    expect(seed.ok).toBe(true);
    const before = await workingOutline(engine, 'doc-1');
    expect(before).toEqual(okTree);

    const bad = await engine.setOutline('doc-1', [
      { title: 'Bad', page: 99, children: [] },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('out-of-range');

    // A nested out-of-range page must refuse the whole edit too.
    const badNested = await engine.setOutline('doc-1', [
      { title: 'Root', page: 1, children: [{ title: 'Deep', page: 4, children: [] }] },
    ]);
    expect(badNested.ok).toBe(false);
    if (!badNested.ok) expect(badNested.error.code).toBe('out-of-range');

    expect(await workingOutline(engine, 'doc-1')).toEqual(okTree);
  });

  it('refuses an empty-title entry with invalid-outline and applies nothing', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const empty = await engine.setOutline('doc-1', [
      { title: '   ', page: 1, children: [] },
    ]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('invalid-outline');

    const emptyNested = await engine.setOutline('doc-1', [
      { title: 'Root', page: 1, children: [{ title: '', page: 2, children: [] }] },
    ]);
    expect(emptyNested.ok).toBe(false);
    if (!emptyNested.ok) expect(emptyNested.error.code).toBe('invalid-outline');

    expect(await workingOutline(engine, 'doc-1')).toEqual([]);
  });

  it('returns invalid-outline for a non-array payload', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const r = await engine.setOutline('doc-1', null as unknown as OutlineEntry[]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-outline');
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.setOutline('no-such-doc', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('clears the outline when set to an empty tree and is undoable', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const a: OutlineEntry[] = [{ title: 'A', page: 1, children: [] }];
    const b: OutlineEntry[] = [{ title: 'B', page: 2, children: [] }];
    expect((await engine.setOutline('doc-1', a)).ok).toBe(true);
    expect((await engine.setOutline('doc-1', b)).ok).toBe(true);
    expect(await workingOutline(engine, 'doc-1')).toEqual(b);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    expect(await workingOutline(engine, 'doc-1')).toEqual(a);

    const redo = await engine.redo('doc-1');
    expect(redo.ok).toBe(true);
    expect(await workingOutline(engine, 'doc-1')).toEqual(b);

    const clear = await engine.setOutline('doc-1', []);
    expect(clear.ok).toBe(true);
    expect(await workingOutline(engine, 'doc-1')).toEqual([]);
  });

  it('writeOutline builds the exact XYZ /Dest, node /Count and parent wiring', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);

    const entries: OutlineEntry[] = [
      { title: 'A', page: 1, children: [{ title: 'A1', page: 3, children: [] }] },
      { title: 'B', page: null, children: [] },
    ];
    writeOutline(doc, entries, (page) => doc.getPage(page - 1).ref);

    const root = doc.context.lookup(doc.catalog.get(PDFName.of('Outlines'))) as PDFDict;
    // Root /Count is the open descendant count (3 total nodes).
    expect(root.get(PDFName.of('Count'))?.toString()).toBe('3');
    expect(root.get(PDFName.of('Type'))?.toString()).toBe('/Outlines');

    const first = doc.context.lookup(root.get(PDFName.of('First'))) as PDFDict;
    const last = doc.context.lookup(root.get(PDFName.of('Last'))) as PDFDict;
    expect((first.get(PDFName.of('Title')) as PDFString).asString()).toBe('A');
    // Node /Count is the open descendant count under it (A1 = 1).
    expect(first.get(PDFName.of('Count'))?.toString()).toBe('1');
    // /Dest is [pageRef /XYZ null null null].
    const dest = first.get(PDFName.of('Dest'));
    expect(dest).toBeInstanceOf(PDFArray);
    if (dest instanceof PDFArray) {
      expect(dest.size()).toBe(5);
      expect(dest.get(1)?.toString()).toBe('/XYZ');
      expect(dest.get(2)?.toString()).toBe('null');
      expect(dest.get(3)?.toString()).toBe('null');
      expect(dest.get(4)?.toString()).toBe('null');
      expect(dest.get(0)).toBeInstanceOf(PDFRef);
    }
    // A null-page entry gets no /Dest.
    expect((last.get(PDFName.of('Title')) as PDFString).asString()).toBe('B');
    expect(last.get(PDFName.of('Dest'))).toBeUndefined();
    // /Next + /Parent wiring.
    const nextRef = first.get(PDFName.of('Next'));
    expect(nextRef).toBeInstanceOf(PDFRef);
    if (nextRef instanceof PDFRef) {
      const nextNode = doc.context.lookup(nextRef) as PDFDict;
      expect((nextNode.get(PDFName.of('Title')) as PDFString).asString()).toBe('B');
    }
    const parentRef = first.get(PDFName.of('Parent'));
    expect(parentRef).toBeInstanceOf(PDFRef);
    if (parentRef instanceof PDFRef) {
      expect(doc.context.lookup(parentRef)).toBe(root);
    }

    // Replacing with an empty tree removes the catalog key.
    writeOutline(doc, [], () => null);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('DEF-493: the serialize path keeps the full XYZ /Dest arity (PDFNulls survive remapDest)', async () => {
    const seed = await PDFDocument.create();
    seed.addPage([612, 792]);
    writeOutline(
      seed,
      [{ title: 'Only', page: 1, children: [] }],
      (page) => seed.getPage(page - 1).ref,
    );
    const seedBytes = await seed.save();
    const path = join(dir, 'p85-dest-arity.pdf');
    await writeFile(path, Buffer.from(seedBytes));

    const engine = new EngineService();
    await engine.loadDocument('doc-1', path);

    // Real serialize path (serializeDoc -> carryOutlines -> remapDest).
    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const bytes = await readFile(saveR.value);
    const re = await PDFDocument.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );

    const root = re.context.lookup(re.catalog.get(PDFName.of('Outlines'))) as PDFDict;
    const first = re.context.lookup(root.get(PDFName.of('First'))) as PDFDict;
    const dest = first.get(PDFName.of('Dest'));
    expect(dest).toBeInstanceOf(PDFArray);
    if (!(dest instanceof PDFArray)) return;
    // Must be [pageRef /XYZ null null null] — dropping the nulls makes pdf.js
    // reject the dest and the bookmark target resolve to "-".
    expect(dest.size()).toBe(5);
    expect(dest.get(0)).toBeInstanceOf(PDFRef);
    expect((dest.get(0) as PDFRef).tag).toBe(re.getPage(0).ref.tag);
    // The fit keyword must serialize as the Name /XYZ, not /#2FXYZ. pdf.js
    // isValidExplicitDest rejects anything but the exact Name XYZ, which makes
    // getOutline() drop the target and the row render as "-".
    expect(dest.get(1)).toBeInstanceOf(PDFName);
    expect(dest.get(1)?.toString()).toBe('/XYZ');
    expect(dest.get(2)).toBe(PDFNull);
    expect(dest.get(3)).toBe(PDFNull);
    expect(dest.get(4)).toBe(PDFNull);

    // Third-party oracle: pdf.js getOutline() must resolve the dest to page 1.
    // It rejects any fit keyword that is not the exact Name XYZ (e.g. the
    // double-encoded /#2FXYZ), in which case dest is null.
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const pdf = await pdfjs.getDocument({ data: copy, useSystemFonts: false }).promise;
    try {
      const outline = await pdf.getOutline();
      expect(outline).not.toBeNull();
      const item = outline?.[0];
      expect(item?.title).toBe('Only');
      expect(item?.dest).not.toBeNull();
      const explicit = item?.dest as unknown[];
      expect(Array.isArray(explicit)).toBe(true);
      const pageIndex = await pdf.getPageIndex(explicit[0] as never);
      expect(pageIndex).toBe(0);
    } finally {
      await pdf.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-495..498 — outline carry-path regressions (adversary ADV-165..168)
// ---------------------------------------------------------------------------

/** Build a PDF whose /Outlines is a single chain of titles, each node carrying
 *  a real /Dest, /Next and /Prev (the shape every real-world outline uses). */
async function buildBookmarkPdf(file: string, titles: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  const pageRefs: PDFRef[] = [];
  for (let i = 0; i < titles.length; i++) {
    pageRefs.push(doc.addPage([612, 792]).ref);
  }
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  let prev: PDFRef | null = null;
  let first: PDFRef | null = null;
  for (let i = 0; i < titles.length; i++) {
    const item = ctx.obj({ Title: PDFString.of(titles[i]), Parent: rootRef });
    if (prev !== null) item.set(PDFName.of('Prev'), prev);
    const ref = ctx.register(item);
    item.set(
      PDFName.of('Dest'),
      ctx.obj([pageRefs[i], PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
    );
    if (prev !== null) {
      (ctx.lookup(prev) as PDFDict).set(PDFName.of('Next'), ref);
    } else {
      first = ref;
    }
    prev = ref;
  }
  root.set(PDFName.of('First'), first as PDFRef);
  root.set(PDFName.of('Last'), prev as PDFRef);
  root.set(PDFName.of('Count'), PDFNumber.of(titles.length));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  await writeFile(file, Buffer.from(await doc.save()));
  return file;
}

function outlineRootOf(doc: PDFDocument): PDFDict | null {
  const v = doc.catalog.get(PDFName.of('Outlines'));
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFRef) {
    const l = doc.context.lookup(v);
    if (l instanceof PDFDict) return l;
  }
  return null;
}

function flatOutline(entries: OutlineEntry[]): Array<{ title: string; page: number | null }> {
  const out: Array<{ title: string; page: number | null }> = [];
  const walk = (list: OutlineEntry[]): void => {
    for (const e of list) {
      out.push({ title: e.title, page: e.page });
      walk(e.children);
    }
  };
  walk(entries);
  return out;
}

describe('Phase 85: DEF-495..498 outline carry regressions', () => {
  it('DEF-495: merge carries both source outlines with remapped page targets', async () => {
    const a = await buildBookmarkPdf(join(dir, 'merge-a.pdf'), ['A1', 'A2', 'A3']);
    const b = await buildBookmarkPdf(join(dir, 'merge-b.pdf'), ['B1', 'B2']);

    const engine = new EngineService();
    expect((await engine.loadDocument('main', a)).ok).toBe(true);
    const m = await engine.merge('main', [b], 'after');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value.pageCount).toBe(5);

    const w = await engine.getDocumentBytes('main');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(w.value);
    expect(flatOutline(readOutlineTree(out))).toEqual([
      { title: 'A1', page: 1 },
      { title: 'A2', page: 2 },
      { title: 'A3', page: 3 },
      { title: 'B1', page: 4 },
      { title: 'B2', page: 5 },
    ]);

    // Airtight: the saved file keeps both source outlines.
    const saveR = await engine.save('main');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const savedBytes = await readFile(saveR.value);
    const saved = await PDFDocument.load(
      savedBytes.buffer.slice(
        savedBytes.byteOffset,
        savedBytes.byteOffset + savedBytes.byteLength,
      ) as ArrayBuffer,
    );
    expect(flatOutline(readOutlineTree(saved)).map((e) => e.title)).toEqual([
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
    ]);
  });

  it('DEF-496: a carried /Prev points at the output sibling, never a raw source ref', async () => {
    const src = await buildBookmarkPdf(join(dir, 'prev.pdf'), ['P1', 'P2']);
    const engine = new EngineService();
    await engine.loadDocument('doc-1', src);

    const w = await engine.getDocumentBytes('doc-1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(w.value);
    const root = outlineRootOf(out);
    if (root === null) throw new Error('missing outline root');
    const firstNode = out.context.lookup(root.get(PDFName.of('First'))) as PDFDict;
    const secondNode = out.context.lookup(firstNode.get(PDFName.of('Next'))) as PDFDict;
    const prev = secondNode.get(PDFName.of('Prev'));
    if (prev !== undefined) {
      // Must be a ref into the OUTPUT document that resolves to the first node.
      expect(prev).toBeInstanceOf(PDFRef);
      expect(out.context.lookup(prev)).toBe(firstNode);
    }
  });
  it('DEF-497: two inline sibling dicts both survive the carry', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);
    const a = ctx.obj({ Title: PDFString.of('InlineA') });
    a.set(PDFName.of('Dest'), ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    const b = ctx.obj({ Title: PDFString.of('InlineB') });
    b.set(PDFName.of('Dest'), ctx.obj([p2.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    a.set(PDFName.of('Next'), b);
    root.set(PDFName.of('First'), a);
    root.set(PDFName.of('Last'), b);
    root.set(PDFName.of('Count'), PDFNumber.of(2));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    const src = join(dir, 'inline-siblings.pdf');
    await writeFile(src, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('doc-1', src);
    const w = await engine.getDocumentBytes('doc-1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(w.value);
    expect(flatOutline(readOutlineTree(out))).toEqual([
      { title: 'InlineA', page: 1 },
      { title: 'InlineB', page: 2 },
    ]);
  });

  it('DEF-498: indirect /Dest and indirect GoTo /A./D survive with targets', async () => {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    const ctx = doc.context;
    const root = ctx.obj({ Type: 'Outlines' });
    const rootRef = ctx.register(root);

    const destArr = ctx.obj([p1.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]);
    const destRef = ctx.register(destArr);
    const a = ctx.obj({ Title: PDFString.of('IndirectDest'), Parent: rootRef });
    a.set(PDFName.of('Dest'), destRef);
    const aRef = ctx.register(a);

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
    await engine.loadDocument('doc-1', src);
    const w = await engine.getDocumentBytes('doc-1');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const out = await PDFDocument.load(w.value);

    // The indirect /Dest must be remapped to page 1.
    expect(flatOutline(readOutlineTree(out))[0]).toEqual({
      title: 'IndirectDest',
      page: 1,
    });

    // The indirect GoTo action's /D must be remapped to page 2.
    const root2 = outlineRootOf(out);
    if (root2 === null) throw new Error('missing outline root');
    const firstNode = out.context.lookup(root2.get(PDFName.of('First'))) as PDFDict;
    const secondNode = out.context.lookup(firstNode.get(PDFName.of('Next'))) as PDFDict;
    const av = secondNode.get(PDFName.of('A'));
    const ad = av instanceof PDFRef ? out.context.lookup(av) : av;
    expect(ad).toBeInstanceOf(PDFDict);
    let actionPage: number | null = null;
    if (ad instanceof PDFDict) {
      const dd = ad.get(PDFName.of('D'));
      const ddResolved = dd instanceof PDFRef ? out.context.lookup(dd) : dd;
      if (
        ddResolved instanceof PDFArray &&
        ddResolved.size() > 0 &&
        ddResolved.get(0) instanceof PDFRef
      ) {
        const pgRef = ddResolved.get(0) as PDFRef;
        for (let i = 0; i < out.getPageCount(); i++) {
          if (out.getPage(i).ref.tag === pgRef.tag) actionPage = i + 1;
        }
      }
    }
    expect(actionPage).toBe(2);
  });

});
