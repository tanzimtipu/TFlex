import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { MovePagesBetweenDocsPayload } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// DEF-292 — a cross-document page move is ONE joint undoable action.
//
// The move pushes a paired entry onto EACH document's undo stack (same
// jointId, each referencing the other's pre-move snapshot). Undoing or
// redoing from EITHER document must revert/re-apply BOTH, and the paired
// state is returned so the renderer can refresh both panes at once.
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def292-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makePdf(sizes: Array<[number, number]>, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  sizes.forEach((s, i) => {
    const page = doc.addPage(s);
    page.drawText(`${label}${i}`, { x: 72, y: 50, size: 12 });
  });
  return doc.save();
}

function sizedPages(count: number, base: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) out.push([base + i, base + i]);
  return out;
}

async function sizesOf(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const s = p.getSize();
    return [s.width, s.height] as [number, number];
  });
}

async function docSizes(engine: EngineService, docId: string): Promise<Array<[number, number]>> {
  const r = await engine.getDocumentBytes(docId);
  if (!r.ok) throw new Error(`getDocumentBytes failed: ${r.error.code}`);
  return sizesOf(new Uint8Array(r.value));
}

async function setup(engine: EngineService, srcPages = 3, dstPages = 2): Promise<void> {
  const src = await engine.loadDocumentBytes('src', await makePdf(sizedPages(srcPages, 300), 'S'));
  const dst = await engine.loadDocumentBytes('dst', await makePdf(sizedPages(dstPages, 600), 'D'));
  expect(src.ok).toBe(true);
  expect(dst.ok).toBe(true);
}

function payload(overrides: Partial<MovePagesBetweenDocsPayload> = {}): MovePagesBetweenDocsPayload {
  return { fromDocId: 'src', pages: [0], toDocId: 'dst', atIndex: 0, mode: 'move', ...overrides };
}

async function counts(engine: EngineService, ...ids: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const id of ids) {
    const s = await engine.getState(id);
    if (!s.ok) throw new Error(`getState(${id}) failed: ${s.error.code}`);
    out.push(s.value.pageCount);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Joint undo works from either pane
// ---------------------------------------------------------------------------

describe('DEF-292 - joint undo of a cross-document move', () => {
  it('undo from the TARGET restores both documents and the page index in the source', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    const moved = await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 1 }));
    expect(moved.ok).toBe(true);
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 3]);

    // Pane B (target) focused.
    const undo = await engine.undo('dst');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.pageCount).toBe(2);
    expect(undo.value.pageOrder).toEqual([0, 1]);
    expect(undo.value.modified).toBe(false);

    // The paired state carries the SOURCE, already reverted.
    expect(undo.value.pairedState?.docId).toBe('src');
    expect(undo.value.pairedState?.state.pageCount).toBe(3);
    expect(undo.value.pairedState?.state.pageOrder).toEqual([0, 1, 2]);

    // Page counts conserved (554-style total never drops): 3 + 2.
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 2]);
    // The moved page (301x301) is back at its original index 1 in the source.
    expect(await docSizes(engine, 'src')).toEqual([[300, 300], [301, 301], [302, 302]]);
    expect(await docSizes(engine, 'dst')).toEqual([[600, 600], [601, 601]]);
  });

  it('undo from the SOURCE restores both documents too', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    const moved = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0 }));
    expect(moved.ok).toBe(true);
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 3]);

    const undo = await engine.undo('src');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.pageCount).toBe(3);
    expect(undo.value.pageOrder).toEqual([0, 1, 2]);
    expect(undo.value.pairedState?.docId).toBe('dst');
    expect(undo.value.pairedState?.state.pageCount).toBe(2);
    expect(undo.value.pairedState?.state.pageOrder).toEqual([0, 1]);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 2]);
  });

  it('redo from either side re-applies the move on BOTH documents', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 0 }));
    const undo = await engine.undo('dst');
    expect(undo.ok).toBe(true);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 2]);

    const redoFromSrc = await engine.redo('src');
    expect(redoFromSrc.ok).toBe(true);
    if (!redoFromSrc.ok) return;
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 3]);
    expect(redoFromSrc.value.pairedState?.docId).toBe('dst');
    expect(redoFromSrc.value.pairedState?.state.pageCount).toBe(3);
    expect(await docSizes(engine, 'src')).toEqual([[300, 300], [302, 302]]);
    expect(await docSizes(engine, 'dst')).toEqual([[301, 301], [600, 600], [601, 601]]);

    // Undo again from the other pane, then redo from the target.
    expect((await engine.undo('src')).ok).toBe(true);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 2]);
    const redoFromDst = await engine.redo('dst');
    expect(redoFromDst.ok).toBe(true);
    if (!redoFromDst.ok) return;
    expect(redoFromDst.value.pairedState?.docId).toBe('src');
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Sequences keep both stacks in sync; the page total is conserved
// ---------------------------------------------------------------------------

describe('DEF-292 - sequences conserve every page and keep both stacks in sync', () => {
  it('two moves and two undos conserve the total at every step', async () => {
    const engine = new EngineService();
    await setup(engine, 4, 2);

    const total = async (): Promise<number> =>
      (await counts(engine, 'src', 'dst')).reduce((a, b) => a + b, 0);
    expect(await total()).toBe(6);

    const m1 = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0 }));
    expect(m1.ok).toBe(true);
    expect(await total()).toBe(6);

    const m2 = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0 }));
    expect(m2.ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 4]);

    const u1 = await engine.undo('dst');
    expect(u1.ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 3]);

    const u2 = await engine.undo('src');
    expect(u2.ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([4, 2]);

    // Redo both, from alternating panes.
    expect((await engine.redo('src')).ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 3]);
    expect((await engine.redo('dst')).ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 4]);

    // Both redo stacks are now empty; the joint entries are back on the
    // undo stacks so the sequence can be undone again from either side.
    const nothing = await engine.redo('src');
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) expect(nothing.error.code).toBe('nothing-to-redo');
    expect((await engine.undo('src')).ok).toBe(true);
    expect(await total()).toBe(6);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 3]);
  });
});

// ---------------------------------------------------------------------------
// Divergence: fail loud, never lose a page
// ---------------------------------------------------------------------------

describe('DEF-292 - divergence fails loud without losing a page', () => {
  it('a joint undo after the other document is closed returns a typed error and does not mutate', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 0 }));
    expect(await counts(engine, 'src', 'dst')).toEqual([2, 3]);

    // Simulate the target document being closed (removed from the engine).
    ((engine as unknown) as { docs: Map<string, unknown> }).docs.delete('dst');

    const before = await counts(engine, 'src');
    const undo = await engine.undo('src');
    expect(undo.ok).toBe(false);
    if (!undo.ok) {
      expect(undo.error.code).toBe('engine-error');
      expect(undo.error.message).toContain('no longer open');
    }
    // The source is untouched: its page count has not silently grown/shrank.
    expect(await counts(engine, 'src')).toEqual(before);
  });

  it('a joint undo when the other document diverged fails loud and keeps the total', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0 }));

    // A new op on the target makes the pair no longer the top entry there.
    const op = await engine.applyOp('dst', { kind: 'delete', page: 0 });
    expect(op.ok).toBe(true);

    const before = await counts(engine, 'src', 'dst');
    const undo = await engine.undo('src');
    expect(undo.ok).toBe(false);
    if (!undo.ok) {
      expect(undo.error.code).toBe('engine-error');
      expect(undo.error.message).toContain('diverged');
    }
    // Nothing changed anywhere; the moved page is still present in the target.
    expect(await counts(engine, 'src', 'dst')).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Single-document undo/redo is unchanged (no paired state, same semantics)
// ---------------------------------------------------------------------------

describe('DEF-292 - single-document undo/redo is unchanged', () => {
  it('applyOp/undo/redo on one document behave as before and carry no pairedState', async () => {
    const engine = new EngineService();
    const bytes = await makePdf(sizedPages(3, 300), 'S');
    const loaded = await engine.loadDocumentBytes('one', bytes);
    expect(loaded.ok).toBe(true);

    const applied = await engine.applyOp('one', { kind: 'delete', page: 0 });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.pageCount).toBe(2);
    expect(applied.value.pairedState).toBeUndefined();

    const undone = await engine.undo('one');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.pageCount).toBe(3);
    expect(undone.value.pageOrder).toEqual([0, 1, 2]);
    expect(undone.value.modified).toBe(false);
    expect(undone.value.pairedState).toBeUndefined();

    const redone = await engine.redo('one');
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(redone.value.pageCount).toBe(2);
    expect(redone.value.modified).toBe(true);
    expect(redone.value.pairedState).toBeUndefined();
  });

  it('a copy does not create a joint entry: undoing it only reverts the target', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    const copied = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0, mode: 'copy' }));
    expect(copied.ok).toBe(true);
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 3]);

    const undo = await engine.undo('dst');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.pageCount).toBe(2);
    expect(undo.value.pairedState).toBeUndefined();
    expect(await counts(engine, 'src', 'dst')).toEqual([3, 2]);

    // The source never had an undo entry for the copy.
    const srcUndo = await engine.undo('src');
    expect(srcUndo.ok).toBe(false);
    if (!srcUndo.ok) expect(srcUndo.error.code).toBe('nothing-to-undo');
  });
});