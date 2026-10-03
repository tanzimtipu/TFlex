// Phase 87 (FEA-039) chunk B — engine.removeBlankPages round-trips.
//
// Proves the op removes a caller-supplied page set in ONE all-or-nothing step
// with exactly ONE undo entry, that survivors' text is byte-for-byte unchanged
// through a real serialization + reload, and that every refusal (empty set,
// out-of-range, duplicate, delete-every-page) applies nothing.
//
// NOTE on evidence: `engine.exportText` now honours `doc.order` (DEF-501), so
// it reflects unsaved page removals directly; the earlier memory-vs-disk split
// (ADV-039) no longer decides which pages come back. The removal's persisted,
// byte-level result is still asserted on a document reloaded from the engine's
// own serialized bytes (`getDocumentBytes`, which honours `doc.order` and,
// unlike `save()`, does not clear the undo stack).

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-blankpages-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

/** Four-page fixture: page N carries the token PAGE_TOKEN_N. */
async function createFourPageFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const tokens = ['PAGE_ONE', 'PAGE_TWO', 'PAGE_THREE', 'PAGE_FOUR'];
  for (const token of tokens) {
    const page = doc.addPage([612, 792]);
    page.drawText(token, { x: 72, y: 700, size: 14, font });
  }
  return writeFixture('four-pages.pdf', await doc.save());
}

async function pageTexts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

async function pageCount(engine: EngineService, docId: string): Promise<number> {
  const r = await engine.getState(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.pageCount : -1;
}

/** Serialize the doc's current visible order and reload it into `docId` on a
 *  fresh engine — a real write/parse round-trip without clearing undo. */
async function reload(engine: EngineService, docId: string, docIdNew: string): Promise<EngineService> {
  const bytes = await engine.getDocumentBytes(docId);
  expect(bytes.ok).toBe(true);
  const path = await writeFixture(`${docIdNew}.pdf`, new Uint8Array(bytes.ok ? bytes.value : new ArrayBuffer(0)));
  const engine2 = new EngineService();
  await engine2.loadDocument(docIdNew, path);
  return engine2;
}

describe('Phase 87: engine.removeBlankPages', () => {
  it('removes a single page, keeps survivors byte-for-byte, persists, and undoes once', async () => {
    const engine = new EngineService();
    const path = await createFourPageFixture();
    await engine.loadDocument('doc-1', path);
    const original = await pageTexts(engine, 'doc-1');
    expect(original).toHaveLength(4);

    const r = await engine.removeBlankPages('doc-1', { pages: [2] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.removed).toEqual([2]);
      expect(r.value.skipped).toEqual([]);
      expect(r.value.state.pageCount).toBe(3);
    }
    expect(await pageCount(engine, 'doc-1')).toBe(3);

    const engine2 = await reload(engine, 'doc-1', 'doc-2');
    expect(await pageCount(engine2, 'doc-2')).toBe(3);
    const reloaded = await pageTexts(engine2, 'doc-2');
    expect(reloaded).toHaveLength(3);
    expect(reloaded).toEqual([original[0], original[2], original[3]]);
    expect(reloaded).not.toContain(original[1]);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.value.pageCount).toBe(4);
    expect(await pageTexts(engine, 'doc-1')).toEqual(original);
  });

  it('removes two pages in ONE call as exactly ONE undo entry', async () => {
    const engine = new EngineService();
    const path = await createFourPageFixture();
    await engine.loadDocument('doc-1', path);
    const original = await pageTexts(engine, 'doc-1');

    const r = await engine.removeBlankPages('doc-1', { pages: [1, 3] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.removed).toEqual([1, 3]);
      expect(r.value.state.pageCount).toBe(2);
    }
    expect(await pageCount(engine, 'doc-1')).toBe(2);

    const engine2 = await reload(engine, 'doc-1', 'doc-2');
    expect(await pageTexts(engine2, 'doc-2')).toEqual([original[1], original[3]]);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.value.pageCount).toBe(4);
    const undo2 = await engine.undo('doc-1');
    expect(undo2.ok).toBe(false);
    if (!undo2.ok) expect(undo2.error.code).toBe('nothing-to-undo');
  });

  it('refuses empty, out-of-range, duplicate and delete-every-page sets, applying nothing', async () => {
    const engine = new EngineService();
    const path = await createFourPageFixture();
    await engine.loadDocument('doc-1', path);

    const cases: Array<{ pages: number[]; code: string }> = [
      { pages: [], code: 'empty-range' },
      { pages: [0], code: 'out-of-range' },
      { pages: [5], code: 'out-of-range' },
      { pages: [2, 2], code: 'out-of-range' },
      { pages: [1, 2, 3, 4], code: 'empty-range' },
    ];
    for (const testCase of cases) {
      const r = await engine.removeBlankPages('doc-1', { pages: testCase.pages });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(testCase.code);
      expect(await pageCount(engine, 'doc-1')).toBe(4);
    }

    const unknown = await engine.removeBlankPages('nope', { pages: [1] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('engine-error');
  });

  // DEF-501 (found by qa, TFL-441): exportText read the loaded pdfDoc's raw
  // page count, so it still returned a removed page and ignored reorders.
  // It must honour doc.order: after removing visible page 2 from the 4-page
  // fixture, exactly the three survivors come back in visible order.
  it('DEF-501: exportText honours doc.order after a delete', async () => {
    const engine = new EngineService();
    const path = await createFourPageFixture();
    await engine.loadDocument('doc-1', path);
    const original = await pageTexts(engine, 'doc-1');
    expect(original).toHaveLength(4);

    const r = await engine.removeBlankPages('doc-1', { pages: [2] });
    expect(r.ok).toBe(true);

    const r2 = await engine.exportText('doc-1');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).toHaveLength(3);
    expect(r2.value.map((p) => p.pageIndex)).toEqual([1, 2, 3]);
    expect(r2.value.map((p) => p.text)).toEqual([original[0], original[2], original[3]]);
    expect(r2.value.map((p) => p.text)).not.toContain(original[1]);
  });

  // DEF-503 (found by the adversary, ADV-170): annotations are stored keyed by
  // ORIGINAL page index and stamped with their creation-time visible page, so
  // after a delete the flattened model carried a stale page. The invariant:
  // after removing visible page 1, an annotation, text box and placed signature
  // created on visible page 3 all report visible page 2, while pageCount is 3.
  it('DEF-503: after a delete, flattened annotations carry the current visible page', async () => {
    const engine = new EngineService();
    const path = await createFourPageFixture();
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', {
      id: 'ann-def503',
      kind: 'text-box',
      page: 3,
      rects: [{ x: 100, y: 500, width: 200, height: 50 }],
      color: 'yellow',
      content: 'Hello',
    });
    await engine.addTextBox('doc-1', {
      page: 3,
      rect: { x: 72, y: 700, width: 200, height: 40 },
      text: 'BOX',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
      background: 'white',
    });
    await engine.placeSignature('doc-1', {
      id: 'sig-def503',
      signatureId: 'tmpl-def503',
      page: 3,
      rect: { x: 100, y: 100, width: 50, height: 30 },
      pngBytes: new Uint8Array(0),
    });

    const r = await engine.removeBlankPages('doc-1', { pages: [1] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.value.state;
    expect(state.pageCount).toBe(3);
    const boxes = state.textBoxes ?? [];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].page).toBe(2);
    const flatAnns = (state as any).annotations as Array<{ id: string; page: number }>;
    expect(flatAnns.find((a) => a.id === 'ann-def503')?.page).toBe(2);
    const flatSigs = (state as any).placedSignatures as Array<{ id: string; page: number }>;
    expect(flatSigs.find((s) => s.id === 'sig-def503')?.page).toBe(2);

    const gs = await engine.getState('doc-1');
    expect(gs.ok).toBe(true);
    if (!gs.ok) return;
    const gsBoxes = gs.value.textBoxes ?? [];
    expect(gsBoxes).toHaveLength(1);
    expect(gsBoxes[0].page).toBe(2);
    const gsAnns = (gs.value as any).annotations as Array<{ id: string; page: number }>;
    expect(gsAnns.find((a) => a.id === 'ann-def503')?.page).toBe(2);
    const gsSigs = (gs.value as any).placedSignatures as Array<{ id: string; page: number }>;
    expect(gsSigs.find((s) => s.id === 'sig-def503')?.page).toBe(2);
  });
});
