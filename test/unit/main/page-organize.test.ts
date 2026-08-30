import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-pg-'));
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
  const path = await writeFixture(`test${n}.pdf`, bytes);
  return { path, bytes };
}

/** Add a single-level document outline (bookmarks) to a PDFDocument in memory.
 *  Each entry points to the 0-based page `pageIdx` with `title`. pdf-lib has no
 *  outline API, so the /Outlines tree is built with low-level context.obj. */
function addOutline(
  doc: PDFDocument,
  entries: Array<{ title: string; pageIdx: number }>,
): void {
  if (entries.length === 0) return;
  const ctx = doc.context;
  let firstRef: PDFRef | null = null;
  let prevRef: PDFRef | null = null;
  let lastRef: PDFRef | null = null;
  for (const { title, pageIdx } of entries) {
    const pageRef = doc.getPage(pageIdx).ref;
    const item = ctx.obj({
      Title: PDFString.of(title),
      Dest: ctx.obj([pageRef, PDFName.of('Fit')]),
    }) as PDFDict;
    const itemRef = ctx.register(item);
    if (prevRef !== null) {
      const prev = ctx.lookup(prevRef);
      if (prev instanceof PDFDict) prev.set(PDFName.of('Next'), itemRef);
    } else {
      firstRef = itemRef;
    }
    item.set(PDFName.of('Prev'), itemRef); // placeholder; fixed below
    prevRef = itemRef;
    lastRef = itemRef;
  }
  const root = ctx.obj({
    Type: PDFName.of('Outlines'),
    First: firstRef as unknown as PDFRef,
    Last: lastRef as unknown as PDFRef,
    Count: PDFNumber.of(entries.length),
  }) as PDFDict;
  const rootRef = ctx.register(root);
  // Wire each item's /Parent to the root.
  let cur: PDFRef | null = firstRef;
  while (cur !== null) {
    const node = ctx.lookup(cur);
    if (!(node instanceof PDFDict)) break;
    node.set(PDFName.of('Parent'), rootRef);
    const next = node.get(PDFName.of('Next'));
    cur = next instanceof PDFRef ? next : null;
  }
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

/** Read a reloaded document's outline as a flat list of {title, destPageIdx}.
 *  Walks First/Next (single level). destPageIdx is the 0-based page the dest
 *  ref resolves to, or -1 if the dest is absent/unresolvable. */
function readOutline(doc: PDFDocument): Array<{ title: string; destPageIdx: number }> {
  const out: Array<{ title: string; destPageIdx: number }> = [];
  const rootVal = doc.catalog.get(PDFName.of('Outlines'));
  if (rootVal === undefined) return out;
  let rootDict: PDFDict | null = null;
  if (rootVal instanceof PDFDict) rootDict = rootVal;
  else if (rootVal instanceof PDFRef) {
    const looked = doc.context.lookup(rootVal);
    if (looked instanceof PDFDict) rootDict = looked;
  }
  if (rootDict === null) return out;
  let curRef: PDFObject | undefined = rootDict.get(PDFName.of('First'));
  const seen = new Set<string>();
  while (curRef !== undefined) {
    const tag = curRef instanceof PDFRef ? curRef.tag : 'inline';
    if (seen.has(tag)) break;
    seen.add(tag);
    let node: PDFDict | null = null;
    if (curRef instanceof PDFDict) node = curRef;
    else if (curRef instanceof PDFRef) {
      const looked = doc.context.lookup(curRef);
      if (looked instanceof PDFDict) node = looked;
    }
    if (node === null) break;
    const titleObj = node.get(PDFName.of('Title'));
    const title = titleObj instanceof PDFString ? titleObj.asString() : '';
    const destVal = node.get(PDFName.of('Dest'));
    let destPageIdx = -1;
    const arr = destVal as { size(): number; get(i: number): unknown } | undefined;
    if (arr && typeof arr.size === 'function' && arr.size() > 0) {
      const pageRef = arr.get(0);
      if (pageRef instanceof PDFRef) {
        for (let p = 0; p < doc.getPageCount(); p++) {
          if (doc.getPage(p).ref.tag === pageRef.tag) {
            destPageIdx = p;
            break;
          }
        }
      }
    }
    out.push({ title, destPageIdx });
    const next = node.get(PDFName.of('Next'));
    curRef = next instanceof PDFRef ? next : undefined;
  }
  return out;
}

// ---------------------------------------------------------------------------
// replacePages
// ---------------------------------------------------------------------------

describe('Phase 12: replacePages', () => {
  it('replaces a single page with another PDF and updates the page count', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);
    const { bytes: other } = await createNPagePdf(2);

    const r = await engine.replacePages('doc-1', other, [1, 1]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 4 pages, replace [1,1] (1 page) with 2 -> 5 pages.
      expect(r.value.pageCount).toBe(5);
      expect(r.value.modified).toBe(true);
    }
  });

  it('replaces a multi-page range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(6);
    await engine.loadDocument('doc-1', path);
    const { bytes: other } = await createNPagePdf(3);

    const r = await engine.replacePages('doc-1', other, [1, 3]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 6 pages, replace [1,3] (3 pages) with 3 -> 6 pages.
      expect(r.value.pageCount).toBe(6);
    }
  });

  it('preserves the before and after pages (round-trip via save)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);
    const { bytes: other } = await createNPagePdf(2);

    const r = await engine.replacePages('doc-1', other, [1, 2]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    // 5 pages, replace [1,2] (2) with 2 -> 5 pages.
    expect(re.getPageCount()).toBe(5);
  });

  it('is undoable (reverts to the original page set)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);
    const { bytes: other } = await createNPagePdf(2);

    await engine.replacePages('doc-1', other, [1, 1]);
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.value.pageCount).toBe(4);
    }
  });

  it('returns out-of-range for a bad targetRange', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    const { bytes: other } = await createNPagePdf(2);

    const r1 = await engine.replacePages('doc-1', other, [3, 5]);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('out-of-range');

    const r2 = await engine.replacePages('doc-1', other, [-1, 1]);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('out-of-range');
  });

  it('returns engine-error for a corrupt other PDF', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.replacePages('doc-1', new Uint8Array([0, 1, 2, 3]), [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('returns empty-range for a 0-page other PDF', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    const { readFile } = await import('node:fs/promises');
    const { join: j } = await import('node:path');
    const fixturePath = j(process.cwd(), 'test-fixtures', 'encrypted-looking.pdf');
    const emptyBytes = await readFile(fixturePath);

    const r = await engine.replacePages('doc-1', new Uint8Array(emptyBytes), [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty-range');
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const { bytes: other } = await createNPagePdf(2);
    const r = await engine.replacePages('no-such-doc', other, [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('preserves link annotations on surviving pages via the page copy', async () => {
    const engine = new EngineService();
    // Build a 3-page doc with a /Link annot on page 0 (a surviving page).
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage([612, 792]);
      p.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
    }
    const link = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: doc.context.obj([0, 0, 100, 100]),
    });
    doc.getPage(0).node.addAnnot(doc.context.register(link));
    const bytes = await doc.save();
    const path = await writeFixture('link.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    // Replace pages [1,1] — page 0 (with the link) survives.
    const { bytes: other } = await createNPagePdf(2);
    const r = await engine.replacePages('doc-1', other, [1, 1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    // Page 0 is the surviving before-page; its /Annots should still contain
    // a /Link. Links ride the page copy (copyPages preserves /Annots incl
    // /Link), consistent with the engine's existing annotation handling.
    const annots = re.getPage(0).node.Annots();
    expect(annots).toBeDefined();
    let hasLink = false;
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const a = re.context.lookup(annots.get(i)) as any;
        const dict = a?.dict ?? a;
        const sub = dict.get ? dict.get(PDFName.of('Subtype')) : undefined;
        if (sub && sub.toString() === '/Link') hasLink = true;
      }
    }
    expect(hasLink).toBe(true);
  });

  it('carries the document outline (bookmarks) via page-ref remap', async () => {
    const engine = new EngineService();
    // Build a 4-page doc with a bookmark to page index 3 ("Page 3").
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) {
      const p = doc.addPage([612, 792]);
      p.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
    }
    addOutline(doc, [{ title: 'Goto Page 3', pageIdx: 3 }]);
    const bytes = await doc.save();
    const path = await writeFixture('outline.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    // Replace visible pages [0, 0] (the first page) with a 2-page other doc.
    // The bookmark to original page 3 survives and is remapped to visible
    // index 3 ([other0, other1, orig1, orig2, orig3] -> orig3 at index 4...
    // wait: before=[], after=[orig1,orig2,orig3]; result = [other0, other1,
    // orig1, orig2, orig3]; orig3 is at visible index 4).
    const { bytes: other } = await createNPagePdf(2);
    const r = await engine.replacePages('doc-1', other, [0, 0]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pageCount).toBe(5);

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);

    const outline = readOutline(re);
    expect(outline.length).toBeGreaterThanOrEqual(1);
    const bm = outline.find((o) => o.title === 'Goto Page 3');
    expect(bm).toBeDefined();
    if (bm) {
      // The dest must resolve to a real page (not -1), proving the remap
      // carried the bookmark onto a surviving page.
      expect(bm.destPageIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it('carries the other PDF outline onto the inserted pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Build a 2-page other doc with a bookmark to its page 0.
    const other = await PDFDocument.create();
    for (let i = 0; i < 2; i++) {
      const p = other.addPage([612, 792]);
      p.drawText(`Other ${i}`, { x: 72, y: 700, size: 14 });
    }
    addOutline(other, [{ title: 'Other Page 0', pageIdx: 0 }]);
    const otherBytes = await other.save();

    // Replace [1,1] (visible page 1) with the 2-page other doc.
    // Inserted pages land at visible indices [1, 2] (before=[page0], after=[page2]).
    const r = await engine.replacePages('doc-1', otherBytes, [1, 1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pageCount).toBe(4);

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);

    const outline = readOutline(re);
    const bm = outline.find((o) => o.title === 'Other Page 0');
    expect(bm).toBeDefined();
    if (bm) {
      // The other doc's first page was inserted at visible index 1.
      expect(bm.destPageIdx).toBe(1);
    }
  });

  it('drops a bookmark whose target page was replaced (dest left bare)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage([612, 792]);
      p.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
    }
    addOutline(doc, [{ title: 'Goto Page 1', pageIdx: 1 }]);
    const bytes = await doc.save();
    const path = await writeFixture('outline-drop.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    const { bytes: other } = await createNPagePdf(2);
    // Replace [1,1] — the page the bookmark pointed at is dropped.
    const r = await engine.replacePages('doc-1', other, [1, 1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const outline = readOutline(re);
    const bm = outline.find((o) => o.title === 'Goto Page 1');
    expect(bm).toBeDefined();
    if (bm) {
      // The dest could not be remapped (target page dropped) -> -1.
      expect(bm.destPageIdx).toBe(-1);
    }
  });
});

// ---------------------------------------------------------------------------
// renumberPages
// ---------------------------------------------------------------------------

describe('Phase 12: renumberPages', () => {
  it('sets page labels exposed via state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.renumberPages('doc-1', [
      { page: 1, label: 'Cover' },
      { page: 2, label: 'Intro' },
      { page: 3, label: 'Body' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageLabels).toEqual([
        { page: 1, label: 'Cover' },
        { page: 2, label: 'Intro' },
        { page: 3, label: 'Body' },
      ]);
      expect(r.value.modified).toBe(true);
    }
  });

  it('writes /PageLabels into the saved document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    await engine.renumberPages('doc-1', [
      { page: 1, label: 'Cover' },
      { page: 2, label: 'Appendix' },
    ]);

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const labels = re.catalog.get(PDFName.of('PageLabels'));
    expect(labels).toBeDefined();
  });

  it('replaces labels set by a previous call', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    await engine.renumberPages('doc-1', [{ page: 1, label: 'Old' }]);
    const r = await engine.renumberPages('doc-1', [{ page: 2, label: 'New' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageLabels).toEqual([{ page: 2, label: 'New' }]);
    }
  });

  it('is undoable', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.renumberPages('doc-1', [{ page: 1, label: 'X' }]);
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.value.pageLabels).toBeUndefined();
    }
  });

  it('returns out-of-range for a bad page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    const r = await engine.renumberPages('doc-1', [{ page: 9, label: 'x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('returns engine-error for a non-string label', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    const r = await engine.renumberPages('doc-1', [{ page: 1, label: 123 as unknown as string }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.renumberPages('no-such-doc', [{ page: 1, label: 'x' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

// ---------------------------------------------------------------------------
// cropPages
// ---------------------------------------------------------------------------

describe('Phase 12: cropPages', () => {
  it('sets CropBox AND TrimBox on the target page (top-left origin)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Top-left box: x=72, y=72, w=200, h=300 on a 792-tall page.
    // Bottom-left: llx=72, lly=792-72-300=420.
    const r = await engine.cropPages('doc-1', [
      { page: 2, box: { x: 72, y: 72, width: 200, height: 300 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const page = re.getPage(1); // visible page 2 -> 0-based index 1
    const crop = page.node.CropBox();
    const trim = page.node.TrimBox();
    expect(crop).toBeDefined();
    expect(trim).toBeDefined();
    const c = crop!.asArray().map((x: any) => x.asNumber());
    expect(c[0]).toBe(72);
    expect(c[1]).toBe(420); // 792 - 72 - 300
    expect(c[2]).toBe(72 + 200);
    expect(c[3]).toBe(420 + 300);
    const t = trim!.asArray().map((x: any) => x.asNumber());
    expect(t).toEqual(c);
  });

  it('is undoable (boxes revert via the pdf snapshot)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.cropPages('doc-1', [
      { page: 1, box: { x: 50, y: 50, width: 100, height: 100 } },
    ]);
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (!u.ok) return;

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    if (!saveR.ok) return;
    const saved = await readFile(saveR.value);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const page = re.getPage(0);
    // After undo, the crop should be gone (no CropBox on the page).
    expect(page.node.CropBox()).toBeUndefined();
  });

  it('returns out-of-range for a bad page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    const r = await engine.cropPages('doc-1', [
      { page: 9, box: { x: 0, y: 0, width: 10, height: 10 } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('returns engine-error for an invalid box', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    const r = await engine.cropPages('doc-1', [
      { page: 1, box: { x: 0, y: 0, width: -10, height: 10 } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('returns empty-range for no entries', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    const r = await engine.cropPages('doc-1', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty-range');
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.cropPages('no-such-doc', [
      { page: 1, box: { x: 0, y: 0, width: 10, height: 10 } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});
