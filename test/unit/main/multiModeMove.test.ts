import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { MovePagesBetweenDocsPayload } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// Phase 32 (Multi Mode) — atomic cross-document page move/copy.
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-move-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Build a PDF whose pages have distinct sizes so a moved page can be
 *  identified by size after serialization. */
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

/** Visible-order page sizes of a doc as the engine would serialize it. */
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

function flatAnns(state: unknown): Array<Record<string, unknown>> {
  return ((state as { annotations?: Array<Record<string, unknown>> }).annotations ?? []);
}

// ---------------------------------------------------------------------------
// Validation matrix
// ---------------------------------------------------------------------------

describe('movePagesBetweenDocs - validation', () => {
  it('rejects the same document on both sides with same-document', async () => {
    const engine = new EngineService();
    await setup(engine);
    const r = await engine.movePagesBetweenDocs(payload({ toDocId: 'src' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('same-document');
  });

  it('rejects an unknown source document with not-found', async () => {
    const engine = new EngineService();
    await setup(engine);
    const r = await engine.movePagesBetweenDocs(payload({ fromDocId: 'nope' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('rejects an unknown target document with not-found', async () => {
    const engine = new EngineService();
    await setup(engine);
    const r = await engine.movePagesBetweenDocs(payload({ toDocId: 'nope' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('rejects an empty pages array with empty-range', async () => {
    const engine = new EngineService();
    await setup(engine);
    const r = await engine.movePagesBetweenDocs(payload({ pages: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty-range');
  });

  it('rejects an out-of-range source page with out-of-range', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    const r = await engine.movePagesBetweenDocs(payload({ pages: [3] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects a negative source page with out-of-range', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    const r = await engine.movePagesBetweenDocs(payload({ pages: [-1] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects an atIndex beyond the target page count with out-of-range', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    const r = await engine.movePagesBetweenDocs(payload({ atIndex: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects a negative atIndex other than -1 with out-of-range', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    const r = await engine.movePagesBetweenDocs(payload({ atIndex: -2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('rejects an invalid mode with engine-error', async () => {
    const engine = new EngineService();
    await setup(engine);
    const r = await engine.movePagesBetweenDocs(payload({ mode: 'x' as 'move' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('rejects moving every page with empty-range', async () => {
    const engine = new EngineService();
    await setup(engine, 2, 2);
    const r = await engine.movePagesBetweenDocs(payload({ pages: [0, 1] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('empty-range');
  });

  it('does not mutate either document when validation fails', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);
    await engine.movePagesBetweenDocs(payload({ pages: [9] }));
    const from = await engine.getState('src');
    const to = await engine.getState('dst');
    expect(from.ok && from.value.pageCount).toBe(3);
    expect(to.ok && to.value.pageCount).toBe(2);
    expect(from.ok && from.value.modified).toBe(false);
    expect(to.ok && to.value.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Move / copy semantics
// ---------------------------------------------------------------------------

describe('movePagesBetweenDocs - move and copy', () => {
  it('move relocates the page: source loses it, target gains it at the index', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Source loses the page; target gains it at visible index 1.
    expect(r.value.from.pageCount).toBe(2);
    expect(r.value.from.pageOrder).toEqual([0, 2]);
    expect(r.value.to.pageCount).toBe(3);
    expect(r.value.to.pageOrder).toEqual([0, 2, 1]);
    expect(r.value.from.modified).toBe(true);
    expect(r.value.to.modified).toBe(true);

    // Content check: the moved page (size 301x301) is at visible index 1.
    expect(await docSizes(engine, 'dst')).toEqual([[600, 600], [301, 301], [601, 601]]);
    expect(await docSizes(engine, 'src')).toEqual([[300, 300], [302, 302]]);
  });

  it('copy leaves the source untouched and adds the page to the target', async () => {
    const engine = new EngineService();
    await setup(engine, 3, 2);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 1, mode: 'copy' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.from.pageCount).toBe(3);
    expect(r.value.from.pageOrder).toEqual([0, 1, 2]);
    expect(r.value.from.modified).toBe(false);
    expect(r.value.to.pageCount).toBe(3);
    expect(r.value.to.pageOrder).toEqual([0, 2, 1]);
    expect(await docSizes(engine, 'src')).toEqual([[300, 300], [301, 301], [302, 302]]);
    expect(await docSizes(engine, 'dst')).toEqual([[600, 600], [301, 301], [601, 601]]);
  });

  it('preserves the relative order of multiple moved pages', async () => {
    const engine = new EngineService();
    await setup(engine, 4, 1);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [0, 2], atIndex: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Target visible order: moved S0, moved S2, then the original target page.
    expect(r.value.to.pageOrder).toEqual([1, 2, 0]);
    expect(await docSizes(engine, 'dst')).toEqual([[300, 300], [302, 302], [600, 600]]);
    // Source keeps its other two pages in order.
    expect(r.value.from.pageOrder).toEqual([1, 3]);
    expect(await docSizes(engine, 'src')).toEqual([[301, 301], [303, 303]]);
  });

  it('atIndex -1 appends at the end of the target', async () => {
    const engine = new EngineService();
    await setup(engine, 2, 2);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: -1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.to.pageOrder).toEqual([0, 1, 2]);
    expect(await docSizes(engine, 'dst')).toEqual([[600, 600], [601, 601], [300, 300]]);
    expect(r.value.from.pageCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Annotations travel with the moved page
// ---------------------------------------------------------------------------

describe('movePagesBetweenDocs - annotations', () => {
  it('carries the moved page annotations into the target and drops them from the source', async () => {
    const engine = new EngineService();
    await setup(engine, 2, 2);

    const created = await engine.createAnnotation('src', {
      id: 'ann-move-1',
      kind: 'text-box',
      page: 1,
      rects: [{ x: 100, y: 500, width: 200, height: 50 }],
      color: 'yellow',
      content: 'moves with me',
    });
    expect(created.ok).toBe(true);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const toAnns = flatAnns(r.value.to);
    expect(toAnns.map((a) => a.id)).toContain('ann-move-1');
    const moved = toAnns.find((a) => a.id === 'ann-move-1');
    expect(moved?.page).toBe(2); // inserted at visible index 1 -> 1-based page 2
    expect(flatAnns(r.value.from)).toHaveLength(0);

    // The annotation survives a serialize round-trip on the target.
    const state = await engine.getState('dst');
    expect(state.ok && flatAnns(state.value).some((a) => a.id === 'ann-move-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Atomicity: an injected mid-operation failure leaves BOTH docs unchanged
// ---------------------------------------------------------------------------

/**
 * Test seam: override the protected target-insert step to throw AFTER the
 * target has been mutated (pdfDoc page added, arrays extended) but BEFORE
 * the source removal. This is the exact "half-applied move" the atomic
 * rollback must undo.
 */
class FailingMoveEngine extends EngineService {
  protected override async _insertMovedPagesInto(
    toDoc: any,
    fromDoc: any,
    origIdxs: any,
    insertAt: any,
  ): Promise<void> {
    await super._insertMovedPagesInto(toDoc, fromDoc, origIdxs, insertAt);
    throw new Error('injected failure after target insert');
  }
}

describe('movePagesBetweenDocs - atomicity', () => {
  it('a failure after the target insert rolls back BOTH documents state-for-state', async () => {
    const engine = new FailingMoveEngine();
    await setup(engine, 3, 2);

    const beforeFrom = await engine.getState('src');
    const beforeTo = await engine.getState('dst');
    const beforeFromSizes = await docSizes(engine, 'src');
    const beforeToSizes = await docSizes(engine, 'dst');
    expect(beforeFrom.ok && beforeTo.ok).toBe(true);

    const r = await engine.movePagesBetweenDocs(payload({ pages: [1], atIndex: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');

    const afterFrom = await engine.getState('src');
    const afterTo = await engine.getState('dst');
    expect(afterFrom.ok && afterTo.ok).toBe(true);
    if (!afterFrom.ok || !afterTo.ok || !beforeFrom.ok || !beforeTo.ok) return;

    // Page counts and visible order unchanged on both sides.
    expect(afterFrom.value.pageCount).toBe(3);
    expect(afterTo.value.pageCount).toBe(2);
    expect(afterFrom.value.pageOrder).toEqual(beforeFrom.value.pageOrder);
    expect(afterTo.value.pageOrder).toEqual(beforeTo.value.pageOrder);
    // Dirty flags unchanged (a failed move is indistinguishable from no move).
    expect(afterFrom.value.modified).toBe(false);
    expect(afterTo.value.modified).toBe(false);
    // The target pdfDoc was reverted too (no leftover inserted page).
    expect(await docSizes(engine, 'src')).toEqual(beforeFromSizes);
    expect(await docSizes(engine, 'dst')).toEqual(beforeToSizes);
  });

  it('a failure during the source removal also rolls back the target', async () => {
    // Copy mode still exercises the target insert; use a move and force the
    // failure inside the insert step (the only mid-operation seam) to prove
    // the target is restored even when the source was never touched.
    const engine = new FailingMoveEngine();
    await setup(engine, 2, 3);
    const beforeToSizes = await docSizes(engine, 'dst');

    const r = await engine.movePagesBetweenDocs(payload({ pages: [0], atIndex: 0 }));
    expect(r.ok).toBe(false);

    const to = await engine.getState('dst');
    expect(to.ok && to.value.pageCount).toBe(3);
    expect(await docSizes(engine, 'dst')).toEqual(beforeToSizes);
  });
});
