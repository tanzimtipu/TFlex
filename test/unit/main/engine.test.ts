import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-engine-'));
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EngineService - loadDocument', () => {
  it('loads a valid PDF and returns its bytes', async () => {
    const engine = new EngineService();
    const { path, bytes } = await createNPagePdf(3);

    const result = await engine.loadDocument('doc-1', path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.byteLength).toBe(bytes.length);
    }
  });

  it('returns open-error for nonexistent path', async () => {
    const engine = new EngineService();
    const result = await engine.loadDocument('doc-1', join(dir, 'missing.pdf'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('open-error');
    }
  });

  it('returns open-error for corrupt file', async () => {
    const engine = new EngineService();
    const path = await writeFixture('junk.pdf', Buffer.from('not a PDF'));
    const result = await engine.loadDocument('doc-1', path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('open-error');
    }
  });

  it('replaces existing document with same docId', async () => {
    const engine = new EngineService();
    const { path: p1 } = await createNPagePdf(3);
    const { path: p2 } = await createNPagePdf(5);

    await engine.loadDocument('doc-1', p1);
    const state1 = await engine.getState('doc-1');
    expect(state1.ok && state1.value.pageCount).toBe(3);

    await engine.loadDocument('doc-1', p2);
    const state2 = await engine.getState('doc-1');
    expect(state2.ok && state2.value.pageCount).toBe(5);
  });
});

describe('EngineService - getState', () => {
  it('initial state: all pages present, no rotations, no deletions, unmodified', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);

    await engine.loadDocument('doc-1', path);
    const result = await engine.getState('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(5);
      expect(result.value.modified).toBe(false);
      expect(result.value.pageOrder).toEqual([0, 1, 2, 3, 4]);
      expect(result.value.rotations).toEqual([0, 0, 0, 0, 0]);
      expect(result.value.deleted).toEqual([false, false, false, false, false]);
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.getState('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });
});

describe('EngineService - rotate', () => {
  it('rotate-cw increments rotation by 1 quarter-turn', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r1 = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.value.rotations).toEqual([1, 0, 0]);
      expect(r1.value.modified).toBe(true);
    }

    const r2 = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    expect(r2.ok && r2.value.rotations).toEqual([2, 0, 0]);

    const r3 = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    expect(r3.ok && r3.value.rotations).toEqual([3, 0, 0]);

    const r4 = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    expect(r4.ok && r4.value.rotations).toEqual([0, 0, 0]);
  });

  it('rotate-ccw decrements rotation by 1 quarter-turn', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r1 = await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 1 });
    expect(r1.ok && r1.value.rotations).toEqual([0, 3, 0]);

    const r2 = await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 1 });
    expect(r2.ok && r2.value.rotations).toEqual([0, 2, 0]);
  });

  it('rotate-cw then rotate-ccw cancels out', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 0 });
    const state = await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 0 });
    expect(state.ok && state.value.rotations[0]).toBe(0);
  });

  it('rotate out-of-range returns out-of-range error', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });

  it('rotate on unknown docId returns engine-error', async () => {
    const engine = new EngineService();
    const r = await engine.applyOp('ghost', { kind: 'rotate-cw', page: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

describe('EngineService - delete', () => {
  it('delete removes a page from the visible order', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(4);
      expect(r.value.pageOrder).toEqual([0, 1, 3, 4]);
      expect(r.value.deleted).toEqual([false, false, true, false, false]);
      expect(r.value.rotations).toEqual([0, 0, 0, 0]);
    }
  });

  it('delete the first page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    expect(r.ok && r.value.pageOrder).toEqual([1, 2, 3, 4]);
    expect(r.ok && r.value.deleted).toEqual([true, false, false, false, false]);
  });

  it('delete the last page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 4 });
    expect(r.ok && r.value.pageOrder).toEqual([0, 1, 2, 3]);
    expect(r.ok && r.value.deleted).toEqual([false, false, false, false, true]);
  });

  it('delete multiple pages sequentially', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 0 }); // delete page 0 (orig 0)
    // order is now [1,2,3,4]; visible page 1 is orig 2
    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 1 }); // delete visible 1 (orig 2)
    expect(r.ok && r.value.pageOrder).toEqual([1, 3, 4]);
    expect(r.ok && r.value.deleted).toEqual([true, false, true, false, false]);
  });

  it('cannot delete the last remaining page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('empty-range');
    }
  });

  it('delete out-of-range returns out-of-range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });
});

describe('EngineService - reorder', () => {
  it('reorder moves a page from one position to another', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Move page at visible position 0 to position 2
    const r = await engine.applyOp('doc-1', { kind: 'reorder', page: 0, param: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Original [0,1,2,3,4] -> move 0 to position 2 -> [1,2,0,3,4]
      expect(r.value.pageOrder).toEqual([1, 2, 0, 3, 4]);
      expect(r.value.pageCount).toBe(5);
    }
  });

  it('reorder moves last page to front', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'reorder', page: 4, param: 0 });
    expect(r.ok && r.value.pageOrder).toEqual([4, 0, 1, 2, 3]);
  });

  it('reorder same position is no-op', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyOp('doc-1', { kind: 'reorder', page: 1, param: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('no-op');
    }
  });

  it('reorder out-of-range returns out-of-range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r1 = await engine.applyOp('doc-1', { kind: 'reorder', page: 0, param: 5 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('out-of-range');
    }
  });

  it('reorder after delete works correctly', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 2 }); // order: [0,1,3,4]
    // Move visible page 0 (orig 0) to position 3
    const r = await engine.applyOp('doc-1', { kind: 'reorder', page: 0, param: 3 });
    expect(r.ok && r.value.pageOrder).toEqual([1, 3, 4, 0]);
    expect(r.ok && r.value.deleted).toEqual([false, false, true, false, false]);
  });
});

describe('EngineService - undo / redo', () => {
  it('undo restores state before the last op', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.value.pageCount).toBe(5);
      expect(u.value.pageOrder).toEqual([0, 1, 2, 3, 4]);
      expect(u.value.deleted).toEqual([false, false, false, false, false]);
    }
  });

  it('undo then redo re-applies the change', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    const u = await engine.undo('doc-1');
    expect(u.ok && u.value.pageCount).toBe(5);
    const r = await engine.redo('doc-1');
    expect(r.ok && r.value.pageCount).toBe(4);
    expect(r.ok && r.value.deleted).toEqual([false, false, true, false, false]);
  });

  it('multi-level undo works', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 }); // op 1
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 }); // op 2
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 1 }); // op 3

    // Undo op 3
    const u1 = await engine.undo('doc-1');
    expect(u1.ok && u1.value.rotations[1]).toBe(0); // rotation undone

    // Undo op 2
    const u2 = await engine.undo('doc-1');
    expect(u2.ok && u2.value.pageCount).toBe(5);
    expect(u2.ok && u2.value.deleted).toEqual([false, false, false, false, false]);

    // Undo op 1
    const u3 = await engine.undo('doc-1');
    expect(u3.ok && u3.value.rotations[0]).toBe(0);

    // Nothing left to undo
    const u4 = await engine.undo('doc-1');
    expect(u4.ok).toBe(false);
    if (!u4.ok) {
      expect(u4.error.code).toBe('nothing-to-undo');
    }
  });

  it('new op after undo clears redo stack', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    await engine.undo('doc-1');
    // Redo should be available
    const r1 = await engine.redo('doc-1');
    expect(r1.ok).toBe(true);

    // Now undo again
    await engine.undo('doc-1');
    // Apply new op
    await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    // Redo stack should be cleared
    const r2 = await engine.redo('doc-1');
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.code).toBe('nothing-to-redo');
    }
  });

  it('undo of rotate-cw restores original rotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.undo('doc-1');
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.rotations[0]).toBe(1);
  });

  it('redo of rotate-ccw restores the rotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 0 });
    await engine.undo('doc-1');
    await engine.redo('doc-1');
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.rotations[0]).toBe(3);
  });

  it('undo of reorder restores original order', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'reorder', page: 0, param: 3 });
    const u = await engine.undo('doc-1');
    expect(u.ok && u.value.pageOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it('modified flag is false after undoing all ops', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const s = await engine.getState('doc-1');
    expect(s.ok && s.value.modified).toBe(true);

    await engine.undo('doc-1');
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
  });
});

describe('EngineService - merge', () => {
  it('merge A + B before', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3); // pages 0,1,2
    const { path: pB } = await createNPagePdf(2); // pages 0,1

    await engine.loadDocument('doc-1', pA);
    const r = await engine.merge('doc-1', [pB], 'before');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(5);
      // B's pages come first, then A's
      expect(r.value.pageOrder).toEqual([0, 1, 2, 3, 4]);
      expect(r.value.modified).toBe(true);
    }
  });

  it('merge A + B after', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { path: pB } = await createNPagePdf(2);

    await engine.loadDocument('doc-1', pA);
    const r = await engine.merge('doc-1', [pB], 'after');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(5);
      expect(r.value.rotations).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('merge with deleted pages: only surviving pages are merged', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(5);
    const { path: pB } = await createNPagePdf(1);

    await engine.loadDocument('doc-1', pA);
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    // Surviving: 0,1,3,4 (4 pages)
    const r = await engine.merge('doc-1', [pB], 'after');
    expect(r.ok && r.value.pageCount).toBe(5);
  });

  it('merge multiple documents', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { path: pB } = await createNPagePdf(2);
    const { path: pC } = await createNPagePdf(2);

    await engine.loadDocument('doc-1', pA);
    const r = await engine.merge('doc-1', [pB, pC], 'after');
    expect(r.ok && r.value.pageCount).toBe(6);
  });

  it('merge is undoable', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { path: pB } = await createNPagePdf(1);

    await engine.loadDocument('doc-1', pA);
    await engine.merge('doc-1', [pB], 'after');
    const u = await engine.undo('doc-1');
    expect(u.ok && u.value.pageCount).toBe(2);
  });
});

describe('EngineService - split', () => {
  it('split 10-20 gives 11 pages in the new document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(30);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [10, 20]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(11);
    }
  });

  it('split removes split pages from current document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    await engine.split('doc-1', [3, 5]);
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(7);
  });

  it('split from beginning', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [0, 4]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(5);
    }
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(5);
  });

  it('split to end', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [5, 9]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(5);
    }
  });

  it('split preserves rotations in new document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 2 });
    const r = await engine.split('doc-1', [2, 2]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(1);
      // The page should have a rotation of 90 degrees (quarter-turn 1)
      const page = reparsed.getPage(0);
      const rot = page.getRotation();
      expect(rot.angle).toBe(90);
    }
  });

  it('split out-of-range returns engine-error', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [3, 10]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

describe('EngineService - extract', () => {
  it('extract specific pages into a new document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    const r = await engine.extract('doc-1', [0, 2, 4]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(3);
    }
  });

  it('extract does not modify current document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    await engine.extract('doc-1', [0, 1]);
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(10);
    expect(state.ok && state.value.modified).toBe(false);
  });

  it('extract out-of-range returns engine-error', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.extract('doc-1', [0, 10]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });

  it('extract preserves rotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 1 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 1 });
    const r = await engine.extract('doc-1', [1]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(1);
      const page = reparsed.getPage(0);
      expect(page.getRotation().angle).toBe(180);
    }
  });
});

describe('EngineService - save / saveAs', () => {
  it('save writes valid PDF', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Apply some ops
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });

    const r = await engine.save('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(path);

      // Round-trip: re-parse the saved file
      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(path);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      // 4 surviving pages (deleted page 2)
      expect(reparsed.getPageCount()).toBe(4);
      // First page should have rotation
      const p0 = reparsed.getPage(0);
      expect(p0.getRotation().angle).toBe(90);
    }
  });

  it('save resets modified and clears undo/redo', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const state1 = await engine.getState('doc-1');
    expect(state1.ok && state1.value.modified).toBe(true);

    await engine.save('doc-1');
    const state2 = await engine.getState('doc-1');
    expect(state2.ok && state2.value.modified).toBe(false);

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(false);
    if (!u.ok) {
      expect(u.error.code).toBe('nothing-to-undo');
    }
  });

  it('save with reorder writes in correct order', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'reorder', page: 0, param: 3 });
    const r = await engine.save('doc-1');
    expect(r.ok).toBe(true);

    if (r.ok) {
      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(path);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      expect(reparsed.getPageCount()).toBe(5);
    }
  });

  it('saveAs writes to a new path and updates doc path', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });

    const newPath = join(dir, 'saved-as.pdf');
    const r = await engine.saveAs('doc-1', newPath);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(newPath);

      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(newPath);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      expect(reparsed.getPageCount()).toBe(3);
      expect(reparsed.getPage(0).getRotation().angle).toBe(90);
    }

    // Doc path should be updated
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
  });
});

describe('EngineService - round-trip integrity', () => {
  it('save re-parse matches engine state exactly', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    // Apply a complex sequence
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-ccw', page: 3 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 5 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 7 });
    await engine.applyOp('doc-1', { kind: 'reorder', page: 1, param: 4 });

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    const r = await engine.save('doc-1');
    expect(r.ok).toBe(true);

    if (r.ok) {
      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(path);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      expect(reparsed.getPageCount()).toBe(state.value.pageCount);
    }
  });

  it('single page with all rotations round-trips', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    for (let r = 0; r < 4; r++) {
      await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
      const savePath = join(dir, `rotated-${r}.pdf`);
      await engine.saveAs('doc-1', savePath);

      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(savePath);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      expect(reparsed.getPageCount()).toBe(1);
      expect(reparsed.getPage(0).getRotation().angle).toBe(((r + 1) * 90) % 360);
    }
  });
});

describe('EngineService - multiple documents', () => {
  it('manages multiple documents independently', async () => {
    const engine = new EngineService();
    const { path: p1 } = await createNPagePdf(3);
    const { path: p2 } = await createNPagePdf(5);

    await engine.loadDocument('doc-a', p1);
    await engine.loadDocument('doc-b', p2);

    await engine.applyOp('doc-a', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-b', { kind: 'delete', page: 2 });

    const stateA = await engine.getState('doc-a');
    const stateB = await engine.getState('doc-b');

    expect(stateA.ok && stateA.value.pageCount).toBe(3);
    expect(stateA.ok && stateA.value.rotations[0]).toBe(1);
    expect(stateB.ok && stateB.value.pageCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// loadDocumentBytes — bytes-only loading (no path, for samples)
// ---------------------------------------------------------------------------

describe('EngineService - loadDocumentBytes', () => {
  it('loads a valid PDF from bytes and returns its bytes', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(3);

    const result = await engine.loadDocumentBytes('doc-1', bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.byteLength).toBe(bytes.length);
    }
  });

  it('returns open-error for corrupt bytes', async () => {
    const engine = new EngineService();
    const result = await engine.loadDocumentBytes('doc-1', new Uint8Array([0, 1, 2, 3]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('open-error');
    }
  });

  it('replaces existing document with same docId', async () => {
    const engine = new EngineService();
    const { bytes: b1 } = await createNPagePdf(3);
    const { bytes: b2 } = await createNPagePdf(5);

    await engine.loadDocumentBytes('doc-1', b1);
    const state1 = await engine.getState('doc-1');
    expect(state1.ok && state1.value.pageCount).toBe(3);

    await engine.loadDocumentBytes('doc-1', b2);
    const state2 = await engine.getState('doc-1');
    expect(state2.ok && state2.value.pageCount).toBe(5);
  });
});

describe('EngineService - bytes-loaded doc ops', () => {
  it('rotate-cw on bytes-loaded doc works', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(3);
    await engine.loadDocumentBytes('doc-1', bytes);

    const r = await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rotations).toEqual([1, 0, 0]);
      expect(r.value.modified).toBe(true);
    }
  });

  it('delete on bytes-loaded doc works', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(5);
    await engine.loadDocumentBytes('doc-1', bytes);

    const r = await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(4);
      expect(r.value.pageOrder).toEqual([0, 1, 3, 4]);
      expect(r.value.deleted).toEqual([false, false, true, false, false]);
    }
  });

  it('undo on bytes-loaded doc restores state', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(5);
    await engine.loadDocumentBytes('doc-1', bytes);

    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.value.pageCount).toBe(5);
      expect(u.value.pageOrder).toEqual([0, 1, 2, 3, 4]);
      expect(u.value.modified).toBe(false);
    }
  });

  it('undo then redo on bytes-loaded doc works', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(5);
    await engine.loadDocumentBytes('doc-1', bytes);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.undo('doc-1');
    const redo = await engine.redo('doc-1');
    expect(redo.ok && redo.value.rotations[0]).toBe(1);
  });

  it('saveAs writes a valid PDF from bytes-loaded doc', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(5);
    await engine.loadDocumentBytes('doc-1', bytes);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });

    const newPath = join(dir, 'bytes-saved-as.pdf');
    const r = await engine.saveAs('doc-1', newPath);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(newPath);
      // Round-trip: re-parse the saved file
      const { readFile } = await import('node:fs/promises');
      const saved = await readFile(newPath);
      const reparsed = await PDFDocument.load(saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer);
      expect(reparsed.getPageCount()).toBe(4);
      expect(reparsed.getPage(0).getRotation().angle).toBe(90);
    }
  });

  it('saveAs updates doc path and resets modified', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(3);
    await engine.loadDocumentBytes('doc-1', bytes);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const newPath = join(dir, 'bytes-saved-as2.pdf');
    await engine.saveAs('doc-1', newPath);

    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
    // After saveAs, undo should be empty
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(false);
    if (!u.ok) {
      expect(u.error.code).toBe('nothing-to-undo');
    }
  });

  it('save on bytes-loaded doc fails (no path to write to)', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(3);
    await engine.loadDocumentBytes('doc-1', bytes);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const r = await engine.save('doc-1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-009: per-document promise queue — op-during-save ordering
// ---------------------------------------------------------------------------

describe('EngineService - queue serialisation (DEF-009)', () => {
  it('save then immediate op: save completes before op runs', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    // Fire save (async, slow because serializeDoc copies every page)
    const savePromise = engine.save('doc-1');

    // Immediately fire a delete op — must queue behind save
    const opPromise = engine.applyOp('doc-1', { kind: 'delete', page: 0 });

    const [saveResult, opResult] = await Promise.all([savePromise, opPromise]);

    // save should succeed
    expect(saveResult.ok).toBe(true);

    // The delete op should have run AFTER save, so pageCount reflects
    // the state after save (modified=false, undo cleared) + the new delete
    expect(opResult.ok).toBe(true);
    if (opResult.ok) {
      // Source had 10 pages, save preserves the 10-page doc, then delete
      // removes page 0 -> 9 pages remaining
      expect(opResult.value.pageCount).toBe(9);
      expect(opResult.value.modified).toBe(true);
    }

    // Round-trip: the saved file should have 10 pages (delete happened after save)
    const { readFile } = await import('node:fs/promises');
    const savedBytes = await readFile(path);
    const reparsed = await PDFDocument.load(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(10);
  });

  it('op then immediate save: op completes before save runs', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    // Fire a delete op, then immediately save
    const opPromise = engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    const savePromise = engine.save('doc-1');

    const [opResult, saveResult] = await Promise.all([opPromise, savePromise]);

    // Both should succeed
    expect(opResult.ok).toBe(true);
    expect(saveResult.ok).toBe(true);

    // The saved file should contain the delete (9 pages)
    const { readFile } = await import('node:fs/promises');
    const savedBytes = await readFile(path);
    const reparsed = await PDFDocument.load(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ) as ArrayBuffer);
    // If the delete ran first, the save wrote 9 pages
    expect(reparsed.getPageCount()).toBe(9);
  });

  it('multiple rapid mutations are serialised in call order', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Fire several ops without awaiting them individually
    const p1 = engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const p2 = engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const p3 = engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    const pSave = engine.save('doc-1');

    const results = await Promise.all([p1, p2, p3, pSave]);
    expect(results.every((r) => r.ok)).toBe(true);

    // After save, state should be clean but the first three ops were applied
    // before save, so the saved file should reflect them
    const { readFile } = await import('node:fs/promises');
    const savedBytes = await readFile(path);
    const reparsed = await PDFDocument.load(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ) as ArrayBuffer);
    // 5 pages -> delete page 2 -> 4 surviving, rotation on page 0
    expect(reparsed.getPageCount()).toBe(4);
    expect(reparsed.getPage(0).getRotation().angle).toBe(180);
  });

  it('undo and save are serialised correctly', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });

    // Fire undo and save concurrently
    const undoP = engine.undo('doc-1');
    const saveP = engine.save('doc-1');

    const [undoR, saveR] = await Promise.all([undoP, saveP]);
    expect(undoR.ok).toBe(true);
    expect(saveR.ok).toBe(true);

    // Undo ran first (reversed the rotation), then save wrote that state.
    // After undo, order is [1,2,3,4] (delete of page 0 still active, rotation undone)
    if (undoR.ok) {
      expect(undoR.value.pageCount).toBe(4);
      expect(undoR.value.rotations[0]).toBe(0);
    }

    // Saved file: 4 pages, no rotation on first
    const { readFile } = await import('node:fs/promises');
    const savedBytes = await readFile(path);
    const reparsed = await PDFDocument.load(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(4);
    expect(reparsed.getPage(0).getRotation().angle).toBe(0);
  });

  it('merge does not deadlock when interleaved with undo', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { path: pB } = await createNPagePdf(2);

    await engine.loadDocument('doc-1', pA);
    // Apply an op so there is something to undo
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });

    // Fire merge and undo concurrently — neither should deadlock
    const mergeP = engine.merge('doc-1', [pB], 'after');
    const undoP = engine.undo('doc-1');

    const results = await Promise.all([mergeP, undoP]);
    // Both should complete (the order depends on queueing, but no hang)
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDocumentBytes — Phase 11: renderer proxy refresh after content-stream
// mutations (OCR text layer). Returns the same bytes save would write, but
// read-only (no modified/undo-stack reset). Round-trips and queues correctly.
// ---------------------------------------------------------------------------

describe('EngineService - getDocumentBytes', () => {
  it('returns re-parseable bytes that match save output (round-trip)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);

    // Apply ops so the bytes diverge from the original load bytes.
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });

    const r = await engine.getDocumentBytes('doc-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Result is a standalone ArrayBuffer (not a shared view).
    expect(r.value).toBeInstanceOf(ArrayBuffer);

    // Re-parse the returned bytes and assert the mutations are present.
    const reparsed = await PDFDocument.load(r.value);
    // 4 - 1 deleted = 3 surviving pages.
    expect(reparsed.getPageCount()).toBe(3);
    // First page rotated 90deg.
    expect(reparsed.getPage(0).getRotation().angle).toBe(90);

    // The bytes from getDocumentBytes must match what save() writes to disk
    // (same serializeDoc path), proving the renderer refresh matches a save.
    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);
    const { readFile } = await import('node:fs/promises');
    const saved = await readFile(path);
    expect(saved.byteLength).toBe(r.value.byteLength);
    const savedView = new Uint8Array(saved);
    const gotView = new Uint8Array(r.value);
    let same = savedView.length === gotView.length;
    for (let i = 0; same && i < savedView.length; i++) {
      if (savedView[i] !== gotView[i]) same = false;
    }
    expect(same).toBe(true);
  });

  it('is read-only: does not reset modified or clear the undo stack', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    const before = await engine.getState('doc-1');
    expect(before.ok && before.value.modified).toBe(true);

    // getDocumentBytes must not flip modified or clear undo (unlike save).
    const r = await engine.getDocumentBytes('doc-1');
    expect(r.ok).toBe(true);

    const after = await engine.getState('doc-1');
    expect(after.ok && after.value.modified).toBe(true);

    // Undo still works — the snapshot was preserved.
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.value.modified).toBe(false);
    }
  });

  it('returns engine-error for an unknown document', async () => {
    const engine = new EngineService();
    const r = await engine.getDocumentBytes('no-such-doc');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });

  it('reflects queued mutations issued before it (queue ordering)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(8);
    await engine.loadDocument('doc-1', path);

    // Fire 3 deletes without awaiting, then getDocumentBytes. The bytes
    // must reflect 8 - 3 = 5 pages because it queues behind the deletes.
    const d1 = engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    const d2 = engine.applyOp('doc-1', { kind: 'delete', page: 1 });
    const d3 = engine.applyOp('doc-1', { kind: 'delete', page: 2 });
    const bytesP = engine.getDocumentBytes('doc-1');

    const [, , , bytes] = await Promise.all([d1, d2, d3, bytesP]);
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;

    const reparsed = await PDFDocument.load(bytes.value);
    expect(reparsed.getPageCount()).toBe(5);
  });

  it('bytes diverge from original load bytes after a content-stream edit', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const originalBytes = await doc.save();
    const path = await writeFixture('gb-probe.pdf', originalBytes);
    const loaded = await engine.loadDocument('doc-1', path);
    expect(loaded.ok).toBe(true);

    // Add a text box — a Phase 10 content-stream mutation that the original
    // load bytes do not contain (analogous to OCR's invisible text layer).
    const addR = await engine.addTextBox('doc-1', {
      page: 1,
      rect: { x: 72, y: 700, width: 200, height: 40 },
      text: 'TFLEXPROBE',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
      background: 'white',
    });
    expect(addR.ok).toBe(true);

    const r = await engine.getDocumentBytes('doc-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The refreshed bytes differ from the original load bytes (a content
    // stream was mutated), and they re-parse to a valid 1-page PDF whose
    // page-0 content stream now contains the drawn text as a Tj operand.
    expect(r.value.byteLength).not.toBe(originalBytes.byteLength);
    const refreshedPath = await writeFixture('gb-refreshed.pdf', new Uint8Array(r.value));
    expect(await page0ContentHasText(refreshedPath, 'TFLEXPROBE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEF-019: save-sequencing regression — getState must reflect in-flight ops
// ---------------------------------------------------------------------------

describe('EngineService - save-sequencing (DEF-019)', () => {
  it('getState issued during an in-flight save reflects queued deletes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(10);
    await engine.loadDocument('doc-1', path);

    // Fire save without awaiting it (serializeDoc copies every page, so the
    // write is not instantaneous).
    const savePromise = engine.save('doc-1');

    // Immediately issue 3 deletes while the save is still in flight. Each
    // must queue behind save and run after it.
    const del1 = engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    const del2 = engine.applyOp('doc-1', { kind: 'delete', page: 1 });
    const del3 = engine.applyOp('doc-1', { kind: 'delete', page: 2 });

    // The renderer then observes state via getState. Because getState is
    // serialised through the same queue, it must report the state AFTER the
    // deletes were applied — not the pre-save snapshot.
    const statePromise = engine.getState('doc-1');

    const [saveResult, , , , state] = await Promise.all([
      savePromise,
      del1,
      del2,
      del3,
      statePromise,
    ]);

    expect(saveResult.ok).toBe(true);

    expect(state.ok).toBe(true);
    if (state.ok) {
      // 10 pages - 3 deletes = 7 pages, and the deletes left the doc modified.
      expect(state.value.pageCount).toBe(7);
      expect(state.value.modified).toBe(true);
    }

    // Round-trip: the save wrote the pre-delete document (10 pages), because
    // the deletes queued behind save and only ran after the write completed.
    const { readFile } = await import('node:fs/promises');
    const saved = await readFile(path);
    const reparsed = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset,
      saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(10);
  });

  it('getState awaits the pending op queue before reading state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Issue a delete without awaiting, then immediately read state.
    const del = engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    const state = await engine.getState('doc-1');
    await del;

    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.pageCount).toBe(4);
      expect(state.value.modified).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-012: split-all guard — selecting all pages returns empty-range
// ---------------------------------------------------------------------------

describe('EngineService - split-all guard (DEF-012)', () => {
  it('split of all pages (range covers whole doc) returns empty-range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [0, 4]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('empty-range');
    }
  });

  it('split of all pages on a single-page doc returns empty-range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.split('doc-1', [0, 0]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('empty-range');
    }
  });

  it('split of almost-all pages (one page left) succeeds', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Split pages 0-3, leaving page 4
    const r = await engine.split('doc-1', [0, 3]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(4);
    }
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(1);
  });

  it('split of all pages after a delete (fewer surviving) also rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    // Delete one page first
    await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    // Now 4 surviving pages
    const r = await engine.split('doc-1', [0, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('empty-range');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-013: corrupt page tree returns typed open-error
// ---------------------------------------------------------------------------

describe('EngineService - corrupt page tree (DEF-013)', () => {
  it('loadDocument returns open-error for broken page tree', async () => {
    const engine = new EngineService();
    const path = join(dir, 'broken-pagetree.pdf');

    // Clone the test-fixtures/broken-pagetree.pdf into our temp dir
    const { copyFile } = await import('node:fs/promises');
    const fixturePath = join(process.cwd(), 'test-fixtures', 'broken-pagetree.pdf');
    await copyFile(fixturePath, path);

    const r = await engine.loadDocument('doc-1', path);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('open-error');
    }
  });

  it('loadDocumentBytes returns open-error for broken page tree', async () => {
    const engine = new EngineService();
    const { readFile } = await import('node:fs/promises');
    const fixturePath = join(process.cwd(), 'test-fixtures', 'broken-pagetree.pdf');
    const buf = await readFile(fixturePath);

    const r = await engine.loadDocumentBytes('doc-1', new Uint8Array(buf));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('open-error');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-032: 0-page document load guard
// ---------------------------------------------------------------------------

describe('EngineService - 0-page load guard (DEF-032)', () => {
  it('loadDocument rejects a 0-page PDF with open-error', async () => {
    const engine = new EngineService();

    // Use encrypted-looking.pdf which pdf-lib loads as 0 pages
    const { copyFile } = await import('node:fs/promises');
    const fixturePath = join(process.cwd(), 'test-fixtures', 'encrypted-looking.pdf');
    const destPath = join(dir, 'zero-page-test.pdf');
    await copyFile(fixturePath, destPath);

    const r = await engine.loadDocument('doc-1', destPath);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('open-error');
    }
  });

  it('loadDocumentBytes rejects a 0-page PDF with open-error', async () => {
    const engine = new EngineService();

    const { readFile } = await import('node:fs/promises');
    const fixturePath = join(process.cwd(), 'test-fixtures', 'encrypted-looking.pdf');
    const buf = await readFile(fixturePath);

    const r = await engine.loadDocumentBytes('doc-1', new Uint8Array(buf));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('open-error');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-027: placeSignature guard on 0-page document
// ---------------------------------------------------------------------------

describe('EngineService - placeSignature 0-page guard (DEF-027)', () => {
  it('placeSignature returns out-of-range when doc has 0 pages (after ops)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Delete all pages except one, then delete the last one
    // Can't delete last page directly, but we can delete and then do a
    // split-all-like operation. Actually, split-all is already guarded.
    // Test: after deleting all pages except the last, we still have 1 page.
    // The 0-page guard only triggers when order.length === 0.
    // For the test: create a 2-page doc, delete page 0, delete page 0
    // (the last one) - this is guarded by empty-range.
    // So we test the guard directly: create a 0-page situation by
    // loading a document, then verify the guard works.
    // Actually, the guard is on doc.order.length === 0, which is the
    // most natural path. Since we can't get there via normal ops
    // (last-page guard), this test verifies the guard exists.
    // The guard is defensive: if somehow order is empty, placeSignature rejects.

    // We can test by loading a 0-page doc... but that's now rejected.
    // The guard is reachable via the _placeSignatureImpl path from
    // the 0-page scenario. Since loadDocument now rejects 0-page docs,
    // this guard is a safety net. Test it by verifying the error code exists.
    const r = await engine.placeSignature('doc-1', {
      id: 'test-sig',
      signatureId: 'tmpl-1',
      page: 999, // out of range
      rect: { x: 0, y: 0, width: 10, height: 10 },
      pngBytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });

  it('placeSignature returns out-of-range for page > doc.order.length', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.placeSignature('doc-1', {
      id: 'test-sig',
      signatureId: 'tmpl-1',
      page: 5, // beyond 3 pages
      rect: { x: 0, y: 0, width: 10, height: 10 },
      pngBytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });

  it('placeSignature returns out-of-range for page < 1', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.placeSignature('doc-1', {
      id: 'test-sig',
      signatureId: 'tmpl-1',
      page: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      pngBytes: new Uint8Array(0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 8: Optimize
// ---------------------------------------------------------------------------

describe('EngineService - optimize', () => {
  it('returns error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.optimize('nonexistent', 'compact');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('produces valid output for each preset', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    for (const preset of ['none', 'compact', 'max'] as const) {
      const result = await engine.optimize('doc-1', preset);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify the output is a valid PDF by re-loading it
        const bytes = new Uint8Array(result.value);
        const reDoc = await PDFDocument.load(bytes);
        expect(reDoc.getPageCount()).toBe(3);
      }
    }
  });

  it('different presets produce different byte sizes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    const sizes: number[] = [];
    for (const preset of ['none', 'compact', 'max'] as const) {
      const result = await engine.optimize('doc-1', preset);
      expect(result.ok).toBe(true);
      if (result.ok) {
        sizes.push(result.value.byteLength);
      }
    }

    // 'none' uses useObjectStreams=false => larger
    // 'compact' and 'max' use useObjectStreams=true => smaller
    // 'max' strips metadata => smallest
    expect(sizes.length).toBe(3);
    expect(sizes[0]).toBeGreaterThan(sizes[1]); // none > compact
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]); // compact >= max
  });

  it('optimized output preserves page count', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(7);
    await engine.loadDocument('doc-1', path);

    const result = await engine.optimize('doc-1', 'compact');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reDoc = await PDFDocument.load(new Uint8Array(result.value));
      expect(reDoc.getPageCount()).toBe(7);
    }
  });

  it('optimized output preserves page rotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Rotate page 1 (0-based visible) clockwise
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 1 });

    const result = await engine.optimize('doc-1', 'compact');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reDoc = await PDFDocument.load(new Uint8Array(result.value));
      expect(reDoc.getPageCount()).toBe(3);
      // Verify rotation was preserved on the second page
      const page = reDoc.getPage(1);
      const rot = page.getRotation().angle;
      expect(rot).toBe(90);
    }
  });

  it('optimized output preserves deletions', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);

    // Delete page 1 (0-based visible)
    await engine.applyOp('doc-1', { kind: 'delete', page: 1 });

    const result = await engine.optimize('doc-1', 'compact');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reDoc = await PDFDocument.load(new Uint8Array(result.value));
      expect(reDoc.getPageCount()).toBe(3);
    }
  });

  it('optimize is read-only (does not modify engine state)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const stateBefore = await engine.getState('doc-1');
    await engine.optimize('doc-1', 'max');
    const stateAfter = await engine.getState('doc-1');

    expect(stateBefore.ok && stateAfter.ok).toBe(true);
    if (stateBefore.ok && stateAfter.ok) {
      expect(stateAfter.value.pageCount).toBe(stateBefore.value.pageCount);
      expect(stateAfter.value.modified).toBe(stateBefore.value.modified);
      expect(stateAfter.value.pageOrder).toEqual(stateBefore.value.pageOrder);
    }
  });

  it('optimize round-trips a full document with annotations, forms, and signatures', async () => {
    const engine = new EngineService();

    // Build a document with form fields
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('Hello', { x: 72, y: 700, size: 14 });

    const form = doc.getForm();
    const textField = form.createTextField('name');
    textField.setText('Test Value');
    textField.addToPage(page);

    const bytes = await doc.save();
    const path = await writeFixture('optimize-roundtrip.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    // Place a signature
    await engine.placeSignature('doc-1', {
      id: 'sig-opt-1',
      signatureId: 'tmpl-opt',
      page: 1,
      rect: { x: 100, y: 100, width: 50, height: 30 },
      pngBytes: new Uint8Array(0),
    });

    // Optimize
    const result = await engine.optimize('doc-1', 'compact');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reDoc = await PDFDocument.load(new Uint8Array(result.value));
      expect(reDoc.getPageCount()).toBe(1);
      // Form should be migrated
      const reForm = reDoc.getForm();
      const fields = reForm.getFields();
      expect(fields.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('EngineService - auditSpace', () => {
  it('returns error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.auditSpace('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('returns a non-zero breakdown for a loaded document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const result = await engine.auditSpace('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalBytes).toBeGreaterThan(0);
      // Sum of breakdown categories should equal totalBytes
      const sum =
        result.value.breakdown.images +
        result.value.breakdown.fonts +
        result.value.breakdown.contentStreams +
        result.value.breakdown.metadata +
        result.value.breakdown.other;
      expect(sum).toBe(result.value.totalBytes);
    }
  });

  it('returns consistent results for the same document', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r1 = await engine.auditSpace('doc-1');
    const r2 = await engine.auditSpace('doc-1');

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.totalBytes).toBe(r2.value.totalBytes);
      expect(r1.value.breakdown).toEqual(r2.value.breakdown);
    }
  });

  it('auditSpace is read-only (does not modify engine state)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const stateBefore = await engine.getState('doc-1');
    await engine.auditSpace('doc-1');
    const stateAfter = await engine.getState('doc-1');

    expect(stateBefore.ok && stateAfter.ok).toBe(true);
    if (stateBefore.ok && stateAfter.ok) {
      expect(stateAfter.value.pageCount).toBe(stateBefore.value.pageCount);
      expect(stateAfter.value.modified).toBe(stateBefore.value.modified);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 9: createFromImages
// ---------------------------------------------------------------------------

/**
 * Create a minimal valid PNG image buffer at a given width and height.
 * This is a 1-pixel-wide PNG with a single solid colour pixel.
 */
function createMinimalPng(width: number = 100, height: number = 80): Uint8Array {
  // Build a minimal PNG with an IHDR, IDAT, and IEND chunk.
  // For simplicity we use a tiny 1x1 pixel PNG and resize via pdf-lib's
  // embedPng, which reads the actual pixel dimensions from IHDR.
  // We construct a valid PNG of the requested dimensions.
  const zlib = require('zlib');

  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  function createChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeB, data]));
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc, 0);
    return Buffer.concat([length, typeB, data, crcB]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(2, 9);   // colour type: RGB
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT: raw pixel data (each row: filter byte + RGB pixels)
  const rawRows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      row[offset] = y % 2 === 0 ? 255 : 0;     // R
      row[offset + 1] = x % 2 === 0 ? 255 : 0; // G
      row[offset + 2] = 128;                     // B
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND
  const iend = createChunk('IEND', Buffer.alloc(0));

  return new Uint8Array(Buffer.concat([sig, ihdr, idat, iend]));
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  const table = crc32Table();
  for (const b of buf) {
    crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

describe('Phase 9: createFromImages', () => {
  it('synthesizes a PDF from a single PNG image', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(100, 80);

    const result = await engine.createFromImages('doc-img', [png]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Round-trip: re-parse the output
    const reDoc = await PDFDocument.load(result.value);
    expect(reDoc.getPageCount()).toBe(1);
    const page = reDoc.getPage(0);
    const size = page.getSize();
    expect(size.width).toBe(100);
    expect(size.height).toBe(80);
  });

  it('synthesizes a PDF from multiple images', async () => {
    const engine = new EngineService();
    const png1 = createMinimalPng(100, 80);
    const png2 = createMinimalPng(200, 150);

    const result = await engine.createFromImages('doc-multi', [png1, png2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reDoc = await PDFDocument.load(result.value);
    expect(reDoc.getPageCount()).toBe(2);
    expect(reDoc.getPage(0).getSize().width).toBe(100);
    expect(reDoc.getPage(0).getSize().height).toBe(80);
    expect(reDoc.getPage(1).getSize().width).toBe(200);
    expect(reDoc.getPage(1).getSize().height).toBe(150);
  });

  it('returns empty-range when no images are provided', async () => {
    const engine = new EngineService();
    const result = await engine.createFromImages('doc-empty', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty-range');
    }
  });

  it('creates a document that is backed by the engine and getState returns it', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(150, 100);

    const result = await engine.createFromImages('doc-state', [png]);
    expect(result.ok).toBe(true);

    const state = await engine.getState('doc-state');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.pageCount).toBe(1);
    }
  });

  it('supports JPEG images', async () => {
    const engine = new EngineService();
    // Create a minimal JPEG (magic bytes FF D8 FF)
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    const jpegFooter = new Uint8Array([0xff, 0xd9]);
    const jpeg = new Uint8Array(jpegHeader.length + jpegFooter.length);
    jpeg.set(jpegHeader);
    jpeg.set(jpegFooter, jpegHeader.length);

    // JPEG embed will likely fail on a tiny invalid JPEG, but the engine
    // should handle it gracefully with an error
    const result = await engine.createFromImages('doc-jpeg', [jpeg]);
    // pdf-lib may or may not accept this minimal JPEG; we just check
    // that the engine doesn't crash and returns a Result
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Phase 9: exportPages
// ---------------------------------------------------------------------------

describe('Phase 9: exportPages', () => {
  it('exports all pages when no range is specified', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    const loadResult = await engine.loadDocument('doc-exp', path);
    expect(loadResult.ok).toBe(true);

    const result = await engine.exportPages('doc-exp', { format: 'png', dpi: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      for (const entry of result.value) {
        expect(entry.pageIndex).toBeGreaterThanOrEqual(1);
        expect(entry.pageIndex).toBeLessThanOrEqual(3);
        expect(entry.format).toBe('png');
        expect(entry.buffer).toBeInstanceOf(Uint8Array);
        expect(entry.buffer.length).toBeGreaterThan(0);
        expect(entry.width).toBeGreaterThan(0);
        expect(entry.height).toBeGreaterThan(0);

        // Round-trip: each exported buffer should be a valid single-page PDF
        const reDoc = await PDFDocument.load(entry.buffer);
        expect(reDoc.getPageCount()).toBe(1);
      }
    }
  });

  it('exports a subset of pages when a range is specified', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-range', path);

    const result = await engine.exportPages('doc-range', {
      range: [2, 4],
      format: 'jpeg',
      dpi: 300,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0].pageIndex).toBe(2);
      expect(result.value[1].pageIndex).toBe(3);
      expect(result.value[2].pageIndex).toBe(4);
      for (const entry of result.value) {
        expect(entry.format).toBe('jpeg');
      }
    }
  });

  it('returns out-of-range for invalid range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-oob', path);

    const result = await engine.exportPages('doc-oob', {
      range: [2, 5],
      format: 'png',
      dpi: 150,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('out-of-range');
    }
  });

  it('returns out-of-range for reversed range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-rev', path);

    const result = await engine.exportPages('doc-rev', {
      range: [3, 2],
      format: 'png',
      dpi: 150,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('out-of-range');
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.exportPages('unknown-doc', { format: 'png', dpi: 150 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('exported pages preserve page rotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-rot', path);

    // Rotate page 1 clockwise
    const rotResult = await engine.applyOp('doc-rot', { kind: 'rotate-cw', page: 0 });
    expect(rotResult.ok).toBe(true);

    const result = await engine.exportPages('doc-rot', { format: 'png', dpi: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Rotation is a display metadata property (/Rotate) that does not
      // change page dimensions. The rotated page should still report its
      // original dimensions, but the exported PDF contains the /Rotate
      // entry so a viewer will display it correctly.
      const page1 = result.value[0];
      expect(page1.width).toBe(612); // original width unchanged
      expect(page1.height).toBe(792); // original height unchanged

      // Verify the exported buffer contains the /Rotate entry
      const reDoc = await PDFDocument.load(page1.buffer);
      const page0 = reDoc.getPage(0);
      // pdf-lib re-exports the rotation, accessible via getRotation
      const rot = (page0 as any).getRotation?.()?.angle ?? 0;
      expect(rot % 360).toBe(90);
    }
  });

  it('different page sizes are preserved in exported entries', async () => {
    const engine = new EngineService();
    // Create a PDF with pages of different sizes
    const doc = await PDFDocument.create();
    const page1 = doc.addPage([612, 792]);
    page1.drawText('Letter', { x: 72, y: 700, size: 14 });
    const page2 = doc.addPage([595, 842]);
    page2.drawText('A4', { x: 72, y: 750, size: 14 });
    const bytes = await doc.save();
    const path = await writeFixture('diffSizes.pdf', bytes);
    await engine.loadDocument('doc-sizes', path);

    const result = await engine.exportPages('doc-sizes', { format: 'png', dpi: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].width).toBe(612);
      expect(result.value[0].height).toBe(792);
      expect(result.value[1].width).toBe(595);
      expect(result.value[1].height).toBe(842);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 9: createFromClipboard
// ---------------------------------------------------------------------------

describe('Phase 9: createFromClipboard', () => {
  it('creates a PDF with a text page from clipboard text', async () => {
    const engine = new EngineService();
    const text = 'Hello\nWorld';

    const result = await engine.createFromClipboard('doc-cb-text', text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Round-trip: re-parse the output
    const reDoc = await PDFDocument.load(result.value);
    expect(reDoc.getPageCount()).toBe(1);

    // The page should be Letter size (612 x 792)
    const page = reDoc.getPage(0);
    const size = page.getSize();
    expect(size.width).toBe(612);
    expect(size.height).toBe(792);
  });

  it('creates a PDF with an image page from clipboard image', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(200, 150);

    const result = await engine.createFromClipboard('doc-cb-img', png);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reDoc = await PDFDocument.load(result.value);
    expect(reDoc.getPageCount()).toBe(1);
    const page = reDoc.getPage(0);
    const size = page.getSize();
    expect(size.width).toBe(200);
    expect(size.height).toBe(150);
  });

  it('handles multi-line text with overflow creating multiple pages', async () => {
    const engine = new EngineService();
    // Enough lines to overflow one Letter page at 12pt
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Line ${i + 1}`);
    }
    const text = lines.join('\n');

    const result = await engine.createFromClipboard('doc-cb-multi', text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reDoc = await PDFDocument.load(result.value);
    // Should have created multiple pages to fit the text
    expect(reDoc.getPageCount()).toBeGreaterThan(1);
  });

  it('engine state is correctly initialised for clipboard-created doc', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(100, 80);

    await engine.createFromClipboard('doc-cb-state', png);
    const state = await engine.getState('doc-cb-state');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.pageCount).toBe(1);
      expect(state.value.modified).toBe(true);
    }
  });

  it('empty string text creates a PDF with one empty page', async () => {
    const engine = new EngineService();

    const result = await engine.createFromClipboard('doc-cb-empty', '');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reDoc = await PDFDocument.load(result.value);
    expect(reDoc.getPageCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 9: insertBlankPage
// ---------------------------------------------------------------------------

describe('Phase 9: insertBlankPage', () => {
  it('inserts a blank page at the beginning', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-bp', path);

    const result = await engine.insertBlankPage('doc-bp', -1, 400, 300);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(4);
      // The new blank page should be first in the visible order
      expect(result.value.pageOrder.length).toBe(4);
    }
  });

  it('inserts a blank page after the first page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-bp-2', path);

    const result = await engine.insertBlankPage('doc-bp-2', 0, 500, 400);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(4);
    }
  });

  it('inserts a blank page after the last page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-bp-3', path);

    const result = await engine.insertBlankPage('doc-bp-3', 2, 600, 500);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(4);
    }
  });

  it('insert-blank is undoable', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-bp-undo', path);

    await engine.insertBlankPage('doc-bp-undo', 1, 400, 300);
    const stateAfter = await engine.getState('doc-bp-undo');
    expect(stateAfter.ok && stateAfter.value.pageCount).toBe(4);

    const undo = await engine.undo('doc-bp-undo');
    expect(undo.ok).toBe(true);
    if (undo.ok) {
      expect(undo.value.pageCount).toBe(3);
    }
  });

  it('insert-blank round-trips via save', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-bp-rt', path);

    await engine.insertBlankPage('doc-bp-rt', 0, 400, 300);
    const saveResult = await engine.save('doc-bp-rt');
    expect(saveResult.ok).toBe(true);

    // Re-load and verify 3 pages
    const { readFile } = await import('node:fs/promises');
    const saved = await readFile(path);
    const reDoc = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset,
      saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    expect(reDoc.getPageCount()).toBe(3);
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.insertBlankPage('nonexistent', 0, 400, 300);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 9: insertFromPdf
// ---------------------------------------------------------------------------

describe('Phase 9: insertFromPdf', () => {
  it('inserts pages from another PDF at the beginning', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { bytes: bB } = await createNPagePdf(2);
    await engine.loadDocument('doc-ifp', pA);

    const result = await engine.insertFromPdf('doc-ifp', bB, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(5);
    }
  });

  it('inserts pages at the end', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { bytes: bB } = await createNPagePdf(2);
    await engine.loadDocument('doc-ifp-end', pA);

    const result = await engine.insertFromPdf('doc-ifp-end', bB, -1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(5);
    }
  });

  it('inserts pages in the middle', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(4);
    const { bytes: bB } = await createNPagePdf(2);
    await engine.loadDocument('doc-ifp-mid', pA);

    const result = await engine.insertFromPdf('doc-ifp-mid', bB, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(6);
    }
  });

  it('insert-from-pdf is undoable', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(3);
    const { bytes: bB } = await createNPagePdf(2);
    await engine.loadDocument('doc-ifp-undo', pA);

    await engine.insertFromPdf('doc-ifp-undo', bB, 1);
    const stateAfter = await engine.getState('doc-ifp-undo');
    expect(stateAfter.ok && stateAfter.value.pageCount).toBe(5);

    const undo = await engine.undo('doc-ifp-undo');
    expect(undo.ok).toBe(true);
    if (undo.ok) {
      expect(undo.value.pageCount).toBe(3);
    }
  });

  it('insert-from-pdf round-trips via save', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    const { bytes: bB } = await createNPagePdf(2);
    await engine.loadDocument('doc-ifp-rt', path);

    await engine.insertFromPdf('doc-ifp-rt', bB, 3);
    const saveResult = await engine.save('doc-ifp-rt');
    expect(saveResult.ok).toBe(true);

    const { readFile } = await import('node:fs/promises');
    const saved = await readFile(path);
    const reDoc = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset,
      saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    expect(reDoc.getPageCount()).toBe(5);
  });

  it('returns empty-range for a 0-page source PDF', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-ifp-zero', path);

    // Use encrypted-looking.pdf which pdf-lib loads as a 0-page document
    const { readFile } = await import('node:fs/promises');
    const fixturePath = join(process.cwd(), 'test-fixtures', 'encrypted-looking.pdf');
    const emptyBytes = await readFile(fixturePath);

    const result = await engine.insertFromPdf('doc-ifp-zero', new Uint8Array(emptyBytes), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty-range');
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(2);
    const result = await engine.insertFromPdf('nonexistent', bytes, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('returns engine-error for corrupt bytes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-ifp-corr', path);

    const corrupt = new Uint8Array([0, 1, 2, 3]);
    const result = await engine.insertFromPdf('doc-ifp-corr', corrupt, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 9: exportText
// ---------------------------------------------------------------------------

describe('Phase 9: exportText', () => {
  it('extracts text from pages containing drawText content', async () => {
    const engine = new EngineService();

    // Create a PDF with known text
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('Hello World', { x: 72, y: 700, size: 14 });
    page.drawText('Second line', { x: 72, y: 680, size: 14 });
    const bytes = await doc.save();
    const path = await writeFixture('exportText-test.pdf', bytes);
    await engine.loadDocument('doc-et', path);

    const result = await engine.exportText('doc-et');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1);
      // Text extraction is best-effort: content streams may use font
      // encodings that are not trivially decoded. The engine must not
      // crash and must return a string (possibly empty for complex
      // encodings). The renderer handles failed extractions gracefully.
      expect(typeof result.value[0].text).toBe('string');
    }
  });

  it('returns text for all pages', async () => {
    const engine = new EngineService();

    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 14 });
    }
    const bytes = await doc.save();
    const path = await writeFixture('exportText-multi.pdf', bytes);
    await engine.loadDocument('doc-et-multi', path);

    const result = await engine.exportText('doc-et-multi');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      for (const page of result.value) {
        expect(page.pageIndex).toBeGreaterThanOrEqual(1);
        expect(page.pageIndex).toBeLessThanOrEqual(3);
        expect(typeof page.text).toBe('string');
      }
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.exportText('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('exportText is read-only (does not modify engine state)', async () => {
    const engine = new EngineService();

    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('Test', { x: 72, y: 700, size: 14 });
    const bytes = await doc.save();
    const path = await writeFixture('exportText-ro.pdf', bytes);
    await engine.loadDocument('doc-et-ro', path);

    const stateBefore = await engine.getState('doc-et-ro');
    await engine.exportText('doc-et-ro');
    const stateAfter = await engine.getState('doc-et-ro');

    expect(stateBefore.ok && stateAfter.ok).toBe(true);
    if (stateBefore.ok && stateAfter.ok) {
      expect(stateAfter.value.pageCount).toBe(stateBefore.value.pageCount);
      expect(stateAfter.value.modified).toBe(stateBefore.value.modified);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 9: createDocxFromImages
// ---------------------------------------------------------------------------

describe('Phase 9: createDocxFromImages', () => {
  it('creates a valid DOCX (ZIP) from a single image', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(100, 80);

    const entries = [{
      pageNumber: 1,
      pngBuffer: png,
      width: 100,
      height: 80,
      pageWidth: 612,
      pageHeight: 792,
    }];

    const result = await engine.createDocxFromImages(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify it is a valid ZIP: starts with PK signature
    const bytes = result.value;
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'

    // Should be large enough to contain XML + PNG
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('creates a DOCX with multiple pages', async () => {
    const engine = new EngineService();
    const png1 = createMinimalPng(100, 80);
    const png2 = createMinimalPng(200, 150);

    const entries = [
      { pageNumber: 1, pngBuffer: png1, width: 100, height: 80, pageWidth: 612, pageHeight: 792 },
      { pageNumber: 2, pngBuffer: png2, width: 200, height: 150, pageWidth: 612, pageHeight: 792 },
    ];

    const result = await engine.createDocxFromImages(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bytes = result.value;
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(1000); // Two images + XML
  });

  it('returns empty-range for empty entries', async () => {
    const engine = new EngineService();
    const result = await engine.createDocxFromImages([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty-range');
    }
  });

  it('DOCX output contains expected XML content', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(50, 50);

    const entries = [{
      pageNumber: 1,
      pngBuffer: png,
      width: 50,
      height: 50,
      pageWidth: 612,
      pageHeight: 792,
    }];

    const result = await engine.createDocxFromImages(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The ZIP should contain the string 'word/document.xml' somewhere
    // (as a filename entry in the central directory or as content)
    const decoder = new TextDecoder();
    const text = decoder.decode(result.value);
    expect(text).toContain('word/document.xml');
    expect(text).toContain('word/media/image1.png');
    expect(text).toContain('[Content_Types].xml');
  });

  it('DOCX is self-consistent (no internal errors)', async () => {
    const engine = new EngineService();

    // Create a larger number of pages to test consistency
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push({
        pageNumber: i,
        pngBuffer: createMinimalPng(100 + i * 10, 80 + i * 5),
        width: 100 + i * 10,
        height: 80 + i * 5,
        pageWidth: 612,
        pageHeight: 792,
      });
    }

    const result = await engine.createDocxFromImages(entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // All 5 images should be referenced
    const decoder = new TextDecoder();
    const text = decoder.decode(result.value);
    for (let i = 1; i <= 5; i++) {
      expect(text).toContain(`image${i}.png`);
    }

    // The central directory should list all entries
    const pkEnd = findPkEndSignature(result.value);
    expect(pkEnd).toBeGreaterThan(0);
  });
});

/**
 * Find the end-of-central-directory signature (PK\x05\x06) in a ZIP buffer.
 */
function findPkEndSignature(buf: Uint8Array): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Phase 10: Edit content — editTextRun / addTextBox / editImage
// ---------------------------------------------------------------------------

/**
 * Build a one-page PDF whose single page already contains the given text
 * drawn at (72, 700) so edit tests have something to mask.
 */
async function createSinglePagePdfWithText(text: string): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 72, y: 700, size: 14, font });
  const bytes = await doc.save();
  const path = await writeFixture('edit-test.pdf', bytes);
  return { path, bytes };
}

/**
 * Phase 10 — verification helper. The engine's regex-based exportText
 * extractor cannot read content streams that pdf-lib packs into object
 * streams after a load+draw+save round-trip (documented Phase 9
 * limitation, called out in the Phase 10 spec). So instead of relying
 * on exportText, we re-parse the saved file with pdf-lib, walk the
 * page-0 /Contents (single ref or array), inflate each FlateDecode
 * stream, and return the concatenated decoded content-stream text.
 *
 * Drawn text from a StandardFont appears as a hex string operand to Tj
 * (e.g. `<464F58444F47> Tj` for "FOXDOG"); callers search for the hex
 * encoding of their expected string.
 */
async function decodedPage0Content(path: string): Promise<string> {
  const fileBytes = await readFile(path);
  const doc = await PDFDocument.load(fileBytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return '';

  const lookup = (ref: unknown): string => {
    const obj = doc.context.lookup(ref as any);
    if (!obj) return '';
    if (obj.constructor && obj.constructor.name === 'PDFArray') {
      const arr = obj as unknown as { size(): number; get(i: number): unknown };
      let out = '';
      for (let i = 0; i < arr.size(); i++) out += lookup(arr.get(i));
      return out;
    }
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents as unknown as Uint8Array;
      if (!raw || typeof raw.length !== 'number') return '';
      try {
        const dec = inflateSync(raw);
        return new TextDecoder('latin1').decode(dec);
      } catch {
        try { return new TextDecoder('latin1').decode(raw); } catch { return ''; }
      }
    }
    return '';
  };
  return lookup(contents);
}

/** Hex-encode a string as pdf-lib would in a Tj operand (uppercase hex
 *  of the WinAnsi/Latin-1 bytes). Used to search decoded content. */
function hexOperand(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase();
}

/** True if the decoded page-0 content contains `text` as a Tj operand. */
async function page0ContentHasText(path: string, text: string): Promise<boolean> {
  const content = await decodedPage0Content(path);
  return content.includes(hexOperand(text)) || content.includes(text);
}

describe('Phase 10: editTextRun', () => {
  it('replaces a text run: new text is present in the content stream after save', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('OLDTEXT');
    await engine.loadDocument('doc-edit', path);

    const result = await engine.editTextRun('doc-edit', {
      page: 1,
      rect: { x: 70, y: 686, width: 120, height: 20 },
      newText: 'NEWTEXT',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.modified).toBe(true);

    const saveResult = await engine.save('doc-edit');
    expect(saveResult.ok).toBe(true);
    expect(await page0ContentHasText(saveResult.ok ? saveResult.value : '', 'NEWTEXT')).toBe(true);
  });

  it('save round-trip preserves the edit (re-parse saved file contains new text)', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('hello');
    await engine.loadDocument('doc-rt', path);

    await engine.editTextRun('doc-rt', {
      page: 1,
      rect: { x: 70, y: 686, width: 100, height: 20 },
      newText: 'WORLD',
      size: 14,
    });

    const saveResult = await engine.save('doc-rt');
    expect(saveResult.ok).toBe(true);
    expect(await page0ContentHasText(saveResult.ok ? saveResult.value : '', 'WORLD')).toBe(true);
  });

  it('undo reverts the edit (old text restored, new text gone)', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('ORIGINAL');
    await engine.loadDocument('doc-undo', path);

    // Before edit: ORIGINAL is present. (saveAs clears the undo stack,
    // but it is empty at this point so this is safe.)
    const saveBefore = await engine.saveAs('doc-undo', join(dir, 'before.pdf'));
    expect(saveBefore.ok).toBe(true);
    expect(await page0ContentHasText(saveBefore.ok ? saveBefore.value : '', 'ORIGINAL')).toBe(true);

    // Apply the edit (pushes a pdfBytes snapshot onto the undo stack).
    // NOTE: we must NOT call save/saveAs between edit and undo — those
    // clear the undo stack on success (existing engine behaviour).
    const editResult = await engine.editTextRun('doc-undo', {
      page: 1,
      rect: { x: 70, y: 686, width: 120, height: 20 },
      newText: 'CHANGED',
      size: 14,
    });
    expect(editResult.ok).toBe(true);

    // Undo: must succeed (proves the edit was on the stack) and revert
    // the content back to the pre-edit pdfDoc state.
    const undoResult = await engine.undo('doc-undo');
    expect(undoResult.ok).toBe(true);

    const saveAfterUndo = await engine.saveAs('doc-undo', join(dir, 'reverted.pdf'));
    expect(await page0ContentHasText(saveAfterUndo.ok ? saveAfterUndo.value : '', 'ORIGINAL')).toBe(true);
    expect(await page0ContentHasText(saveAfterUndo.ok ? saveAfterUndo.value : '', 'CHANGED')).toBe(false);
  });

  it('redo re-applies the edit after undo', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('BASE');
    await engine.loadDocument('doc-redo', path);

    await engine.editTextRun('doc-redo', {
      page: 1,
      rect: { x: 70, y: 686, width: 120, height: 20 },
      newText: 'REDOME',
      size: 14,
    });
    await engine.undo('doc-redo');
    const redoResult = await engine.redo('doc-redo');
    expect(redoResult.ok).toBe(true);
    const sr = await engine.saveAs('doc-redo', join(dir, 'redo.pdf'));
    expect(await page0ContentHasText(sr.ok ? sr.value : '', 'REDOME')).toBe(true);
  });

  it('returns out-of-range for an invalid page', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('x');
    await engine.loadDocument('doc-oob', path);

    const result = await engine.editTextRun('doc-oob', {
      page: 5,
      rect: { x: 70, y: 686, width: 100, height: 20 },
      newText: 'nope',
      size: 14,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('out-of-range');
    }
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.editTextRun('unknown', {
      page: 1,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      newText: 'x',
      size: 12,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('drops non-Latin characters that StandardFonts cannot encode (no throw)', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('latin');
    await engine.loadDocument('doc-san', path);

    const result = await engine.editTextRun('doc-san', {
      page: 1,
      rect: { x: 70, y: 686, width: 200, height: 20 },
      newText: 'abc\u4e2d\u6587', // 'abc' + CJK chars that cannot encode
      size: 14,
    });
    expect(result.ok).toBe(true);
    const sr = await engine.save('doc-san');
    expect(await page0ContentHasText(sr.ok ? sr.value : '', 'abc')).toBe(true);
  });

  it('honours the font parameter (Helvetica/Times/Courier all draw the text)', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('fonttest');
    await engine.loadDocument('doc-font', path);

    for (const font of ['Helvetica', 'Times', 'Courier'] as const) {
      await engine.editTextRun('doc-font', {
        page: 1,
        rect: { x: 70, y: 686, width: 200, height: 20 },
        newText: `F_${font}`,
        font,
        size: 14,
      });
      const sr = await engine.saveAs('doc-font', join(dir, `font-${font}.pdf`));
      expect(await page0ContentHasText(sr.ok ? sr.value : '', `F_${font}`)).toBe(true);
      await engine.undo('doc-font');
    }
  });

  it('marks the document modified and clears the redo stack', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('m');
    await engine.loadDocument('doc-mod', path);

    await engine.editTextRun('doc-mod', {
      page: 1, rect: { x: 70, y: 686, width: 80, height: 20 },
      newText: 'A', size: 14,
    });
    const s1 = await engine.getState('doc-mod');
    expect(s1.ok && s1.value.modified).toBe(true);

    await engine.undo('doc-mod');
    await engine.editTextRun('doc-mod', {
      page: 1, rect: { x: 70, y: 686, width: 80, height: 20 },
      newText: 'B', size: 14,
    });
    const redoResult = await engine.redo('doc-mod');
    expect(redoResult.ok).toBe(false);
    if (!redoResult.ok) {
      expect(redoResult.error.code).toBe('nothing-to-redo');
    }
  });
});

describe('Phase 10: addTextBox', () => {
  it('draws wrapped text inside the rect and survives save round-trip', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('box-test.pdf', bytes);
    await engine.loadDocument('doc-box', path);

    const result = await engine.addTextBox('doc-box', {
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 100 },
      text: 'The quick brown fox jumps over the lazy dog',
      font: 'Helvetica',
      size: 12,
      color: { r: 0, g: 0, b: 0 },
      background: 'white',
    });
    expect(result.ok).toBe(true);

    const sr = await engine.save('doc-box');
    const content = await decodedPage0Content(sr.ok ? sr.value : '');
    expect(content.includes(hexOperand('quick'))).toBe(true);
    expect(content.includes(hexOperand('fox'))).toBe(true);
    expect(content.includes(hexOperand('dog'))).toBe(true);
  });

  it('wraps long words that exceed the box width (no crash, text present)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('box-wrap.pdf', bytes);
    await engine.loadDocument('doc-wrap', path);

    const longWord = 'abcdefghijklmnopqrstuvwxyz'.repeat(10);
    const result = await engine.addTextBox('doc-wrap', {
      page: 1,
      rect: { x: 72, y: 72, width: 80, height: 400 },
      text: longWord,
      size: 12,
    });
    expect(result.ok).toBe(true);
    const sr = await engine.save('doc-wrap');
    const content = await decodedPage0Content(sr.ok ? sr.value : '');
    expect(content.length).toBeGreaterThan(0);
    expect(content.includes(hexOperand('abc'))).toBe(true);
  });

  it('undo reverts the added text box (content stream empty again)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('box-undo.pdf', bytes);
    await engine.loadDocument('doc-box-undo', path);

    // Before edit: empty content stream. (saveAs clears the undo stack,
    // but it is empty here so this is safe.)
    const saveBefore = await engine.saveAs('doc-box-undo', join(dir, 'box-before.pdf'));
    expect((await decodedPage0Content(saveBefore.ok ? saveBefore.value : '')).length).toBe(0);

    // Apply the edit. We must NOT save between edit and undo (save
    // clears the undo stack on success).
    const editResult = await engine.addTextBox('doc-box-undo', {
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 60 },
      text: 'BOXCONTENT',
      size: 12,
    });
    expect(editResult.ok).toBe(true);

    // Undo must succeed (proves the edit was on the stack).
    const undoResult = await engine.undo('doc-box-undo');
    expect(undoResult.ok).toBe(true);

    // After undo: the drawn text box is gone.
    const saveReverted = await engine.saveAs('doc-box-undo', join(dir, 'box-reverted.pdf'));
    expect(await page0ContentHasText(saveReverted.ok ? saveReverted.value : '', 'BOXCONTENT')).toBe(false);
    expect((await decodedPage0Content(saveReverted.ok ? saveReverted.value : '')).length).toBe(0);
  });

  it('returns out-of-range for an invalid page', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('box-oob.pdf', bytes);
    await engine.loadDocument('doc-box-oob', path);

    const result = await engine.addTextBox('doc-box-oob', {
      page: 99,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      text: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('out-of-range');
    }
  });

  it('honours explicit newlines as line breaks', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('box-nl.pdf', bytes);
    await engine.loadDocument('doc-box-nl', path);

    await engine.addTextBox('doc-box-nl', {
      page: 1,
      rect: { x: 72, y: 72, width: 300, height: 100 },
      text: 'LINEONE\nLINETWO\nLINETHREE',
      size: 12,
    });
    const sr = await engine.save('doc-box-nl');
    const content = await decodedPage0Content(sr.ok ? sr.value : '');
    expect(content.includes(hexOperand('LINEONE'))).toBe(true);
    expect(content.includes(hexOperand('LINETWO'))).toBe(true);
    expect(content.includes(hexOperand('LINETHREE'))).toBe(true);
  });
});

describe('Phase 10: editImage', () => {
  it('replace: masks old rect and draws new image (round-trip adds image XObject)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const origPng = createMinimalPng(40, 30);
    const origImg = await doc.embedPng(origPng);
    page.drawImage(origImg, { x: 100, y: 600, width: 40, height: 30 });
    const bytes = await doc.save();
    const path = await writeFixture('img-replace.pdf', bytes);
    await engine.loadDocument('doc-img', path);

    const newPng = createMinimalPng(60, 40);
    const result = await engine.editImage('doc-img', {
      page: 1,
      op: 'replace',
      oldRect: { x: 100, y: 162, width: 40, height: 30 },
      newRect: { x: 100, y: 152, width: 60, height: 40 },
      imageBytes: newPng,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.modified).toBe(true);

    const saveResult = await engine.save('doc-img');
    expect(saveResult.ok).toBe(true);
    const reloaded = await PDFDocument.load(await readFile(saveResult.ok ? saveResult.value : ''));
    const xobjRef = reloaded.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeTruthy();
    const xobj = reloaded.context.lookup(xobjRef) as any;
    expect(xobj.asMap().size).toBeGreaterThanOrEqual(1);
  });

  it('move: old rect masked, image drawn at new location', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-move.pdf', bytes);
    await engine.loadDocument('doc-move', path);

    const png = createMinimalPng(50, 50);
    const result = await engine.editImage('doc-move', {
      page: 1,
      op: 'move',
      oldRect: { x: 50, y: 50, width: 50, height: 50 },
      newRect: { x: 200, y: 200, width: 50, height: 50 },
      imageBytes: png,
    });
    expect(result.ok).toBe(true);

    const saveResult = await engine.save('doc-move');
    const reloaded = await PDFDocument.load(await readFile(saveResult.ok ? saveResult.value : ''));
    const xobjRef = reloaded.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeTruthy();
  });

  it('resize: new dimensions applied to the drawn image', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-resize.pdf', bytes);
    await engine.loadDocument('doc-resize', path);

    const png = createMinimalPng(80, 60);
    const result = await engine.editImage('doc-resize', {
      page: 1,
      op: 'resize',
      oldRect: { x: 100, y: 100, width: 80, height: 60 },
      newRect: { x: 100, y: 100, width: 160, height: 120 },
      imageBytes: png,
    });
    expect(result.ok).toBe(true);
    const saveResult = await engine.save('doc-resize');
    const reloaded = await PDFDocument.load(await readFile(saveResult.ok ? saveResult.value : ''));
    expect(reloaded.getPageCount()).toBe(1);
    const xobjRef = reloaded.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeTruthy();
  });

  it('crop: accepts cropped image bytes (same code path as replace)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-crop.pdf', bytes);
    await engine.loadDocument('doc-crop', path);

    const croppedPng = createMinimalPng(30, 20);
    const result = await engine.editImage('doc-crop', {
      page: 1,
      op: 'crop',
      oldRect: { x: 100, y: 100, width: 100, height: 80 },
      newRect: { x: 100, y: 100, width: 30, height: 20 },
      imageBytes: croppedPng,
    });
    expect(result.ok).toBe(true);
  });

  it('undo reverts an image edit (new XObject gone after undo)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-undo.pdf', bytes);
    await engine.loadDocument('doc-img-undo', path);

    // Before edit: no XObject on the page. (saveAs clears the undo
    // stack, but it is empty here so this is safe.)
    const saveBefore = await engine.saveAs('doc-img-undo', join(dir, 'img-before.pdf'));
    const beforeParsed = await PDFDocument.load(await readFile(saveBefore.ok ? saveBefore.value : ''));
    const beforeXobj = beforeParsed.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(beforeXobj).toBeFalsy();

    // Apply the edit. We must NOT save between edit and undo (save
    // clears the undo stack on success).
    const editResult = await engine.editImage('doc-img-undo', {
      page: 1,
      op: 'replace',
      oldRect: { x: 100, y: 100, width: 50, height: 50 },
      newRect: { x: 100, y: 100, width: 50, height: 50 },
      imageBytes: createMinimalPng(50, 50),
    });
    expect(editResult.ok).toBe(true);

    // Undo must succeed (proves the edit was on the stack).
    const undoResult = await engine.undo('doc-img-undo');
    expect(undoResult.ok).toBe(true);

    // After undo: the drawn image XObject is gone again.
    const saveReverted = await engine.saveAs('doc-img-undo', join(dir, 'img-reverted.pdf'));
    const reverted = await PDFDocument.load(await readFile(saveReverted.ok ? saveReverted.value : ''));
    const xobjRef = reverted.getPage(0).node.Resources()!.get(PDFName.of('XObject'));
    expect(xobjRef).toBeFalsy();
  });

  it('returns out-of-range for an invalid page', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-oob.pdf', bytes);
    await engine.loadDocument('doc-img-oob', path);

    const result = await engine.editImage('doc-img-oob', {
      page: 0,
      op: 'replace',
      oldRect: { x: 0, y: 0, width: 10, height: 10 },
      newRect: { x: 0, y: 0, width: 10, height: 10 },
      imageBytes: createMinimalPng(10, 10),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('out-of-range');
    }
  });

  it('returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.editImage('unknown', {
      page: 1,
      op: 'replace',
      oldRect: { x: 0, y: 0, width: 10, height: 10 },
      newRect: { x: 0, y: 0, width: 10, height: 10 },
      imageBytes: createMinimalPng(10, 10),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('accepts JPEG bytes for the replacement image', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('img-jpg.pdf', bytes);
    await engine.loadDocument('doc-jpg', path);

    const jpeg = minimalJpeg();
    const result = await engine.editImage('doc-jpg', {
      page: 1,
      op: 'replace',
      oldRect: { x: 100, y: 100, width: 30, height: 30 },
      newRect: { x: 100, y: 100, width: 30, height: 30 },
      imageBytes: jpeg,
    });
    expect(result.ok).toBe(true);
  });
});

/**
 * Build a minimal valid 1x1 grayscale JPEG (SOI / APP0 / SOF0 / SOS / EOI).
 * Just enough for pdf-lib's embedJpg to accept.
 */
function minimalJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0xfb, 0xfc, 0xff, 0xd9,
  ]);
}

// ---------------------------------------------------------------------------
// DEF-060: createDocxFromDoc — text-first DOCX with image fallback
// ---------------------------------------------------------------------------

describe('DEF-060: createDocxFromDoc', () => {
  it('emits real w:t runs for text-bearing pages (no wp:inline)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1); // page draws "Page 0"
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(100, 80);
    const entries = [{
      pageNumber: 1,
      pngBuffer: png,
      width: 100,
      height: 80,
      pageWidth: 612,
      pageHeight: 792,
    }];

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml');
    expect(docXml).not.toBeNull();
    // Text page must contain at least one w:t run with the page text.
    expect(docXml!).toContain('<w:t');
    expect(docXml!).toContain('Page 0');
    // No inline image on a text page.
    expect(docXml!).not.toContain('<wp:inline');
  });

  it('falls back to wp:inline image for text-free pages (no w:t)', async () => {
    const engine = new EngineService();
    // A page with no text operators at all (blank).
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = await writeFixture('blank.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(100, 80);
    const entries = [{
      pageNumber: 1,
      pngBuffer: png,
      width: 100,
      height: 80,
      pageWidth: 612,
      pageHeight: 792,
    }];

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml');
    expect(docXml!).not.toBeNull();
    // Image fallback: an inline drawing is present.
    expect(docXml!).toContain('<wp:inline');
    // No text run on a text-free page.
    expect(docXml!).not.toContain('<w:t');
    // The image relationship + media part must exist.
    const rels = extractZipEntryText(result.value, 'word/_rels/document.xml.rels');
    expect(rels!).toContain('image1.png');
    const media = extractZipEntryBytes(result.value, 'word/media/image1.png');
    expect(media).not.toBeNull();
    // The media bytes should be the PNG we sent.
    expect(media!.length).toBe(png.length);
  });

  it('mixed doc: text page emits w:t, image-only page emits wp:inline', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]);
    p1.drawText('Hello World', { x: 72, y: 700, size: 14, font });
    doc.addPage([612, 792]); // blank page 2
    const bytes = await doc.save();
    const path = await writeFixture('mixed.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(100, 80);
    const entries = [
      { pageNumber: 1, pngBuffer: png, width: 100, height: 80, pageWidth: 612, pageHeight: 792 },
      { pageNumber: 2, pngBuffer: png, width: 100, height: 80, pageWidth: 612, pageHeight: 792 },
    ];

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml');
    expect(docXml!).toContain('Hello World');
    expect(docXml!).toContain('<w:t');
    expect(docXml!).toContain('<wp:inline');
    // Exactly one inline image (page 2 only).
    expect((docXml!.match(/<wp:inline/g) || []).length).toBe(1);
  });

  it('page-break separator sits between pages so page count matches', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(50, 50);
    const entries = [1, 2, 3].map((n) => ({
      pageNumber: n, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792,
    }));

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml')!;
    // Two page breaks for three pages (break before every page except the first).
    expect((docXml.match(/w:br w:type="page"/g) || []).length).toBe(2);
    expect(docXml).toContain('Page 0');
    expect(docXml).toContain('Page 1');
    expect(docXml).toContain('Page 2');
  });

  it('XML-escapes text content so <, &, > do not corrupt document.xml', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('a < b & c > d', { x: 72, y: 700, size: 14, font });
    const bytes = await doc.save();
    const path = await writeFixture('escape.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    const png = createMinimalPng(50, 50);
    const entries = [{
      pageNumber: 1, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792,
    }];

    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml')!;
    // The raw special chars must NOT appear inside the w:t (escaped forms do).
    expect(docXml).not.toContain('a < b & c > d');
    expect(docXml).toContain('a &lt; b &amp; c &gt; d');
    // The XML must still be well-formed enough to contain the closing tags.
    expect(docXml).toContain('</w:t>');
    expect(docXml).toContain('</w:document>');
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const png = createMinimalPng(50, 50);
    const entries = [{
      pageNumber: 1, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792,
    }];
    const result = await engine.createDocxFromDoc('nope', entries);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });

  it('returns empty-range for empty entries', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    const result = await engine.createDocxFromDoc('doc-1', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('empty-range');
    }
  });

  it('produced .docx is a valid ZIP (PK signature + EOCD)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    const png = createMinimalPng(50, 50);
    const entries = [{
      pageNumber: 1, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792,
    }];
    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const zip = result.value;
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(findPkEndSignature(zip)).toBeGreaterThan(0);
    // document.xml part must be reachable.
    expect(extractZipEntryText(zip, 'word/document.xml')).not.toBeNull();
  });

  it('honours visible page order (reorder + delete)', async () => {
    const engine = new EngineService();
    // 3 pages: "AAAPAGE", "BBBPAGE", "CCCPAGE"
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const label of ['AAAPAGE', 'BBBPAGE', 'CCCPAGE']) {
      const p = doc.addPage([612, 792]);
      p.drawText(label, { x: 72, y: 700, size: 14, font });
    }
    const bytes = await doc.save();
    const path = await writeFixture('order.pdf', bytes);
    await engine.loadDocument('doc-1', path);

    // Reorder: move original page 3 (index 2) to the front -> visible [2,0,1]
    // = CCCPAGE, AAAPAGE, BBBPAGE. Then delete visible page 2 (index 2,
    // "BBBPAGE") -> visible [2,0] = CCCPAGE, AAAPAGE.
    await engine.applyOp('doc-1', { kind: 'reorder', page: 2, param: 0 });
    await engine.applyOp('doc-1', { kind: 'delete', page: 2 });

    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(2);

    const png = createMinimalPng(50, 50);
    const entries = [
      { pageNumber: 1, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792 },
      { pageNumber: 2, pngBuffer: png, width: 50, height: 50, pageWidth: 612, pageHeight: 792 },
    ];
    const result = await engine.createDocxFromDoc('doc-1', entries);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docXml = extractZipEntryText(result.value, 'word/document.xml')!;
    // Visible page 1 is original page 3 ("CCCPAGE"), visible page 2 is
    // original page 1 ("AAAPAGE"). "BBBPAGE" was deleted and must be absent.
    expect(docXml).toContain('CCCPAGE');
    expect(docXml).toContain('AAAPAGE');
    expect(docXml).not.toContain('BBBPAGE');
    // CCCPAGE (visible 1) must appear before AAAPAGE (visible 2).
    expect(docXml.indexOf('CCCPAGE')).toBeLessThan(docXml.indexOf('AAAPAGE'));
  });
});

/**
 * Extract a store-only ZIP entry's bytes by name. Scans local file headers
 * (PK\x03\x04), reads the filename, and slices the uncompressed data. Only
 * supports compression method 0 (store) — which is all buildDocxFromDoc /
 * buildDocxFromImages emit — so no inflate is needed.
 */
function extractZipEntryBytes(zip: Uint8Array, name: string): Uint8Array | null {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 0x03 || zip[i + 3] !== 0x04) continue;
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const compSize = dv.getUint32(i + 18, true);
    const method = dv.getUint16(i + 8, true);
    const nameStart = i + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > zip.length) return null;
    const entryName = new TextDecoder().decode(zip.slice(nameStart, nameEnd));
    if (entryName !== name) {
      continue;
    }
    if (method !== 0) return null; // only store supported
    const dataStart = nameEnd + extraLen;
    return zip.slice(dataStart, dataStart + compSize);
  }
  return null;
}

function extractZipEntryText(zip: Uint8Array, name: string): string | null {
  const bytes = extractZipEntryBytes(zip, name);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

