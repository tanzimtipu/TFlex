// ADV-039 (DEF-009 regression) — deletes fired concurrently with save are
// still lost. The per-doc queue serializes ops, but save's
// serializeDoc/writeFile window lets concurrent deletes mutate the live
// doc while save writes the pre-mutation snapshot; save then clears
// undoStack + modified, permanently losing the queued deletes.
//
// Invariant: no user op is ever silently dropped — after save+deletes,
// disk should reflect the ops OR the doc must stay modified with undo
// available. Never "disk 68, memory 65, modified false, undo empty".

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineService } from '../../../src/main/services/engine';

async function makePdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, 792]);
  }
  const bytes = await doc.save();
  const path = join(tmpdir(), `adv039-${Date.now()}-${Math.random()}.pdf`);
  await fs.writeFile(path, Buffer.from(bytes));
  return path;
}

async function reparsePageCount(path: string): Promise<number> {
  const buf = await fs.readFile(path);
  const d = await PDFDocument.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  return d.getPageCount();
}

describe('ADV-039: concurrent save + deletes are not lost', () => {
  it('merge -> save() unawaited + 3 deletes -> settle -> disk and memory agree', async () => {
    const engine = new EngineService();
    const path = await makePdf(65);
    const otherPath = await makePdf(3);

    // Load the 65-page doc.
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Merge the 3-page doc AFTER (68 pages total).
    const m = await engine.merge('doc', [otherPath], 'after');
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.value.pageCount).toBe(68);
    }

    // Fire save() without awaiting, then 3 deletes concurrently.
    const savePromise = engine.save('doc');
    const delPromises: Promise<unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      delPromises.push(engine.applyOp('doc', { kind: 'delete', page: 67 - i }));
    }
    await savePromise;
    await Promise.all(delPromises);

    // Settle: let the queue drain.
    await engine.getState('doc');

    const state = await engine.getState('doc');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const memCount = state.value.pageCount;
      const diskCount = await reparsePageCount(path);
      const modified = state.value.modified;

      console.log(`ADV-039: disk=${diskCount} memory=${memCount} modified=${modified}`);

      // The invariant: disk and memory agree (both 68 with deletes pending,
      // or both 65) OR memory is modified with undo. Never "disk 68,
      // memory 65, modified false, undo empty".
      if (diskCount !== memCount) {
        // Disk and memory disagree — memory MUST be modified=true so the
        // user can save again to persist the deletes.
        expect(modified).toBe(true);
      }
      // If memory is 65 (deletes applied), modified must be true OR disk
      // must also be 65. Never "modified false" with deletes applied but
      // disk stale.
      if (memCount === 65 && diskCount === 68) {
        expect(modified).toBe(true);
      }
    }
  });

  it('save() unawaited + deletes -> after settle, disk reflects deletes or memory stays modified', async () => {
    const engine = new EngineService();
    const path = await makePdf(10);

    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Fire save() without awaiting, then 3 deletes concurrently.
    const savePromise = engine.save('doc');
    const del1 = engine.applyOp('doc', { kind: 'delete', page: 9 });
    const del2 = engine.applyOp('doc', { kind: 'delete', page: 8 });
    const del3 = engine.applyOp('doc', { kind: 'delete', page: 7 });
    await savePromise;
    await Promise.all([del1, del2, del3]);

    // Settle.
    await engine.getState('doc');

    const state = await engine.getState('doc');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const memCount = state.value.pageCount;
      const diskCount = await reparsePageCount(path);
      console.log(`ADV-039-b: disk=${diskCount} memory=${memCount} modified=${state.value.modified}`);

      // Invariant: either disk reflects the deletes (7) or memory stays
      // modified so the user can re-save. Never "disk 10, memory 7,
      // modified false".
      if (diskCount !== memCount) {
        expect(state.value.modified).toBe(true);
      }
    }
  });
});
