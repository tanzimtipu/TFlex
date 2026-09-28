// Phase 28 (chunk 2) — comment threads: engine op + persistence.
//
// Engine-side only (the comment-box UI is a later chunk). Covers: the first
// addComment creates a thread; later calls append replies oldest-first;
// validation rejects a missing annotation and empty/oversized text with a
// typed engine-error; threads round-trip through save/reopen (catalog
// /TFlexComments); deleting an annotation drops its thread; and a malformed
// stored value is dropped on load without throwing.

import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type {
  CommentThread,
  CreateAnnotationPayload,
  EngineState,
} from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-comments-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createNPagePdf(n: number, name = `test${n}.pdf`): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    doc.addPage([612, 792]).drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

/** A PDF whose catalog carries a `/TFlexComments` entry with a hostile or
 *  malformed raw value, used to prove the load path drops it. */
async function writePdfWithRawComments(name: string, raw: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.catalog.set(PDFName.of('TFlexComments'), PDFHexString.of(raw));
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

function makePayload(overrides?: Partial<CreateAnnotationPayload>): CreateAnnotationPayload {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'text-box',
    page: 1,
    rects: [{ x: 100, y: 500, width: 200, height: 50 }],
    color: 'yellow',
    content: 'Hello',
    ...overrides,
  };
}

function commentsOf(state: EngineState): CommentThread[] {
  return state.comments ?? [];
}

function threadFor(state: EngineState, annotationId: string): CommentThread | undefined {
  return commentsOf(state).find((t) => t.annotationId === annotationId);
}

describe('EngineService.addComment — thread creation and replies', () => {
  it('(a) the first call creates a thread with one entry (default author "You")', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-a' }));

    const r = await engine.addComment('doc-1', 'ann-a', 'First comment');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const thread = threadFor(r.value, 'ann-a');
    expect(thread).toBeDefined();
    expect(thread!.entries).toHaveLength(1);
    expect(thread!.entries[0].text).toBe('First comment');
    expect(thread!.entries[0].author).toBe('You');
    expect(thread!.entries[0].id).toMatch(/^cmt-/);
    expect(typeof thread!.entries[0].createdAt).toBe('number');
    // No thread exists for an annotation with no comments.
    expect(commentsOf(r.value)).toHaveLength(1);
  });

  it('(a2) a blank/absent author falls back to "You"; an explicit author is kept', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-author' }));

    const blank = await engine.addComment('doc-1', 'ann-author', 'no author', '   ');
    expect(blank.ok).toBe(true);
    const named = await engine.addComment('doc-1', 'ann-author', 'named', 'Alice');
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    const entries = threadFor(named.value, 'ann-author')!.entries;
    expect(entries[0].author).toBe('You');
    expect(entries[1].author).toBe('Alice');
  });

  it('(b) a second call appends a reply; order is preserved oldest-first', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-b' }));

    await engine.addComment('doc-1', 'ann-b', 'original');
    const r2 = await engine.addComment('doc-1', 'ann-b', 'reply one', 'Bob');
    const r3 = await engine.addComment('doc-1', 'ann-b', 'reply two');
    expect(r2.ok && r3.ok).toBe(true);
    if (!r3.ok) return;
    const thread = threadFor(r3.value, 'ann-b')!;
    expect(thread.entries.map((e) => e.text)).toEqual(['original', 'reply one', 'reply two']);
    expect(thread.entries.map((e) => e.author)).toEqual(['You', 'Bob', 'You']);
    // One thread only — a reply never spawns a second thread.
    expect(commentsOf(r3.value)).toHaveLength(1);
  });

  it('marks the document modified and supports undo of the appended entry', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-undo' }));
    await engine.save('doc-1');

    const r = await engine.addComment('doc-1', 'ann-undo', 'undo me');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.modified).toBe(true);

    const undone = await engine.undo('doc-1');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(threadFor(undone.value, 'ann-undo')).toBeUndefined();
  });

  it('rejects an unknown docId with a typed engine-error', async () => {
    const engine = new EngineService();
    const r = await engine.addComment('ghost', 'ann-x', 'hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});

describe('EngineService.addComment — validation', () => {
  it('(c) an unknown annotationId rejects with a typed engine-error', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addComment('doc-1', 'no-such-annotation', 'orphan');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(String(r.error.message)).toContain('no-such-annotation');
    }
    // The failed call must not create a thread.
    const state = await engine.getState('doc-1');
    if (state.ok) expect(commentsOf(state.value)).toHaveLength(0);
  });

  it('(c2) an annotation id that was just deleted rejects too', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-gone' }));
    await engine.deleteAnnotation('doc-1', 'ann-gone');

    const r = await engine.addComment('doc-1', 'ann-gone', 'too late');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('(d) empty / whitespace-only / non-string text rejects', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-text' }));

    for (const bad of ['', '   ', '\n\t ', 42 as unknown as string]) {
      const r = await engine.addComment('doc-1', 'ann-text', bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('engine-error');
    }
    const state = await engine.getState('doc-1');
    if (state.ok) expect(commentsOf(state.value)).toHaveLength(0);
  });

  it('(d2) text over 4000 chars rejects; exactly 4000 is accepted and trimmed', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-len' }));

    const tooLong = await engine.addComment('doc-1', 'ann-len', 'x'.repeat(4001));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe('engine-error');

    const atCap = await engine.addComment('doc-1', 'ann-len', `  ${'y'.repeat(4000)}  `);
    expect(atCap.ok).toBe(true);
    if (!atCap.ok) return;
    const entry = threadFor(atCap.value, 'ann-len')!.entries[0];
    expect(entry.text).toHaveLength(4000);
    expect(entry.text.startsWith('y')).toBe(true);
  });
});

describe('EngineService.addComment — persistence round-trip', () => {
  it('(e) threads round-trip through saveAs + reopen with ids/authors/text/timestamps', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-p1', page: 1 }));
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-p2', page: 2, kind: 'rect' }));

    await engine.addComment('doc-1', 'ann-p1', 'comment on p1');
    await engine.addComment('doc-1', 'ann-p1', 'reply on p1', 'Alice');
    await engine.addComment('doc-1', 'ann-p2', 'comment on p2', 'Bob');

    const before = await engine.getState('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeP1 = threadFor(before.value, 'ann-p1')!;

    const savePath = join(dir, 'saved.pdf');
    const saved = await engine.saveAs('doc-1', savePath);
    expect(saved.ok).toBe(true);

    const reopened = new EngineService();
    const load = await reopened.loadDocument('doc-2', savePath);
    expect(load.ok).toBe(true);
    const after = await reopened.getState('doc-2');
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    expect(commentsOf(after.value)).toHaveLength(2);
    const p1 = threadFor(after.value, 'ann-p1')!;
    const p2 = threadFor(after.value, 'ann-p2')!;
    expect(p1.entries.map((e) => e.text)).toEqual(['comment on p1', 'reply on p1']);
    expect(p1.entries.map((e) => e.author)).toEqual(['You', 'Alice']);
    expect(p2.entries.map((e) => e.text)).toEqual(['comment on p2']);
    expect(p2.entries.map((e) => e.author)).toEqual(['Bob']);
    // ids and timestamps survive exactly.
    expect(p1.entries.map((e) => e.id)).toEqual(beforeP1.entries.map((e) => e.id));
    expect(p1.entries.map((e) => e.createdAt)).toEqual(beforeP1.entries.map((e) => e.createdAt));
    // The annotations themselves still round-trip alongside their threads.
    expect((after.value as { annotations?: unknown[] }).annotations).toHaveLength(2);
  });

  it('(e2) the saved file carries /TFlexComments as a hex JSON payload', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-raw' }));
    await engine.addComment('doc-1', 'ann-raw', 'catalog payload');
    const savePath = join(dir, 'raw.pdf');
    expect((await engine.saveAs('doc-1', savePath)).ok).toBe(true);

    const buf = await readFile(savePath);
    const reparsed = await PDFDocument.load(buf);
    const entry = reparsed.catalog.get(PDFName.of('TFlexComments'));
    expect(entry).toBeInstanceOf(PDFHexString);
    const parsed = JSON.parse((entry as PDFHexString).asString()) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].annotationId).toBe('ann-raw');
    const entries = parsed[0].entries as Array<Record<string, unknown>>;
    expect(entries[0].text).toBe('catalog payload');
    expect(entries[0].author).toBe('You');
  });
});

describe('EngineService.addComment — delete cascade', () => {
  it('(f) deleting the annotation drops its thread, and the drop persists', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-del' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-keep' }));
    await engine.addComment('doc-1', 'ann-del', 'doomed thread');
    await engine.addComment('doc-1', 'ann-keep', 'survivor');

    const del = await engine.deleteAnnotation('doc-1', 'ann-del');
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    expect(threadFor(del.value, 'ann-del')).toBeUndefined();
    expect(threadFor(del.value, 'ann-keep')).toBeDefined();

    const savePath = join(dir, 'cascade.pdf');
    expect((await engine.saveAs('doc-1', savePath)).ok).toBe(true);
    const reopened = new EngineService();
    expect((await reopened.loadDocument('doc-2', savePath)).ok).toBe(true);
    const after = await reopened.getState('doc-2');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(commentsOf(after.value)).toHaveLength(1);
    expect(threadFor(after.value, 'ann-keep')).toBeDefined();
  });

  it('(f2) undo of the delete restores the dropped thread', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', makePayload({ id: 'ann-undo-del' }));
    await engine.addComment('doc-1', 'ann-undo-del', 'bring me back');
    await engine.deleteAnnotation('doc-1', 'ann-undo-del');

    const undone = await engine.undo('doc-1');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const thread = threadFor(undone.value, 'ann-undo-del');
    expect(thread).toBeDefined();
    expect(thread!.entries.map((e) => e.text)).toEqual(['bring me back']);
  });
});

describe('EngineService.addComment — hostile stored value', () => {
  it('(g) an unparseable /TFlexComments entry is dropped without throwing on load', async () => {
    const path = await writePdfWithRawComments('hostile1.pdf', '{not json at all');
    const engine = new EngineService();
    const load = await engine.loadDocument('doc-1', path);
    expect(load.ok).toBe(true);
    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) expect(commentsOf(state.value)).toHaveLength(0);
  });

  it('(g2) a valid-JSON wrong-shape entry is dropped; a valid thread among junk survives', async () => {
    const raw = JSON.stringify([
      null,
      7,
      'nope',
      { annotationId: 5, entries: 'not-an-array' },
      { annotationId: '', entries: [] },
      { annotationId: 'ann-junk', entries: [{ id: 1, text: 'bad id' }, { text: 'no id' }, {}] },
      {
        annotationId: 'ann-ok',
        entries: [
          { id: 'cmt-ok', author: '', text: 'kept', createdAt: 'not-a-number' },
        ],
      },
    ]);
    const path = await writePdfWithRawComments('hostile2.pdf', raw);
    const engine = new EngineService();
    expect((await engine.loadDocument('doc-1', path)).ok).toBe(true);
    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const threads = commentsOf(state.value);
    expect(threads).toHaveLength(1);
    expect(threads[0].annotationId).toBe('ann-ok');
    expect(threads[0].entries).toHaveLength(1);
    // Malformed optional fields are normalized, not thrown on.
    expect(threads[0].entries[0].author).toBe('You');
    expect(threads[0].entries[0].createdAt).toBe(0);
  });

  it('(g3) a non-string catalog value is ignored without throwing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('TFlexComments'), PDFName.of('NotAString'));
    const path = join(dir, 'hostile3.pdf');
    await writeFile(path, Buffer.from(await doc.save()));

    const engine = new EngineService();
    expect((await engine.loadDocument('doc-1', path)).ok).toBe(true);
    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) expect(commentsOf(state.value)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 28 (criterion 4) — the annotation id survives save/reopen, so the
// comment thread keyed by `annotationId` still matches its annotation.
// ---------------------------------------------------------------------------

describe('Phase 28 (criterion 4) — comment threads match annotations after reopen', () => {
  it('(b) a thread added before save still matches its annotation id after reload', async () => {
    const engine = new EngineService();
    const path = await createNPagePdf(2);
    await engine.loadDocument('doc-c4', path);
    const annId = 'ann-stable-1';
    await engine.createAnnotation('doc-c4', makePayload({ id: annId }));
    await engine.addComment('doc-c4', annId, 'survive the reopen');

    const savePath = join(dir, 'c4.pdf');
    expect((await engine.saveAs('doc-c4', savePath)).ok).toBe(true);

    const reopened = new EngineService();
    expect((await reopened.loadDocument('doc-c4b', savePath)).ok).toBe(true);
    const state = await reopened.getState('doc-c4b');
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    const anns = ((state.value as { annotations?: Array<{ id: string }> }).annotations) ?? [];
    expect(anns).toHaveLength(1);
    const thread = commentsOf(state.value).find((t) => t.annotationId === annId);
    expect(thread).toBeDefined();
    expect(thread!.entries.map((e) => e.text)).toEqual(['survive the reopen']);
    // The thread's annotationId is exactly the reopened annotation's id.
    expect(thread!.annotationId).toBe(anns[0].id);
  });
});


