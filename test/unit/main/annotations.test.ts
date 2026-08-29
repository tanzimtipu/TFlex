import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { nearestAnnColor } from '../../../src/main/services/annotations';
import type { CreateAnnotationPayload, EngineState } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-ann-'));
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

/** Get the annotations flat array from an EngineState. */
function getAnns(state: EngineState): Array<Record<string, unknown>> {
  return (state as any).annotations as Array<Record<string, unknown>> ?? [];
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

describe('nearestAnnColor', () => {
  it('maps exact colors correctly', () => {
    expect(nearestAnnColor(1, 1, 0)).toBe('yellow');
    expect(nearestAnnColor(0, 1, 0)).toBe('green');
    expect(nearestAnnColor(0, 0, 1)).toBe('blue');
    expect(nearestAnnColor(1, 0, 0)).toBe('red');
    expect(nearestAnnColor(1, 0.5, 0)).toBe('orange');
    expect(nearestAnnColor(0.5, 0, 0.5)).toBe('purple');
    expect(nearestAnnColor(0, 1, 1)).toBe('cyan');
    expect(nearestAnnColor(1, 0, 1)).toBe('magenta');
    expect(nearestAnnColor(1, 1, 1)).toBe('white');
  });

  it('maps near-yellow to yellow', () => {
    expect(nearestAnnColor(0.95, 0.95, 0.1)).toBe('yellow');
  });

  it('maps near-red to red', () => {
    expect(nearestAnnColor(0.9, 0.1, 0.1)).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// Creating annotations (all nine kinds)
// ---------------------------------------------------------------------------

describe('EngineService - createAnnotation', () => {
  it('creates a text-box annotation and returns engine state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({ kind: 'text-box' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      expect(anns.length).toBeGreaterThanOrEqual(1);
      const ann = anns.find((a: any) => a.kind === 'text-box');
      expect(ann).toBeDefined();
      if (ann) {
        expect(ann.color).toBe('yellow');
        expect(ann.content).toBe('Hello');
      }
    }
  });

  it('creates a rect annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 150, height: 100 }],
      color: 'red',
      width: 2,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const ann = anns.find((a: any) => a.kind === 'rect');
      expect(ann).toBeDefined();
      if (ann) {
        expect(ann.color).toBe('red');
        expect(ann.width).toBe(2);
      }
    }
  });

  it('creates an ellipse annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'ellipse',
      rects: [{ x: 100, y: 300, width: 200, height: 150 }],
      color: 'blue',
      width: 3,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      expect(anns.find((a: any) => a.kind === 'ellipse')).toBeDefined();
    }
  });

  it('creates a note annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'note',
      at: { x: 100, y: 100 },
      color: 'orange',
      content: 'Note text',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const ann = anns.find((a: any) => a.kind === 'note');
      expect(ann).toBeDefined();
      if (ann) {
        expect(ann.content).toBe('Note text');
      }
    }
  });

  it('creates an ink annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'ink',
      rects: [{ x: 0, y: 0, width: 200, height: 100 }],
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 80 },
        { x: 100, y: 30 },
        { x: 180, y: 50 },
      ],
      color: 'green',
      width: 2,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const ann = anns.find((a: any) => a.kind === 'ink');
      expect(ann).toBeDefined();
      if (ann) {
        expect((ann as any).points.length).toBe(4);
        expect((ann as any).width).toBe(2);
      }
    }
  });

  it('creates an arrow annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'arrow',
      from: { x: 50, y: 500 },
      to: { x: 150, y: 400 },
      lineEnds: ['OpenArrow', 'None'],
      color: 'purple',
      width: 2,
      content: 'Arrow label',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const ann = anns.find((a: any) => a.kind === 'arrow');
      expect(ann).toBeDefined();
      if (ann) {
        expect((ann as any).points.length).toBe(2);
        expect((ann as any).lineEnds).toEqual(['OpenArrow', 'None']);
        expect((ann as any).content).toBe('Arrow label');
      }
    }
  });

  it('creates a highlight annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 20 }],
      color: 'yellow',
      opacity: 0.5,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const ann = anns.find((a: any) => a.kind === 'highlight');
      expect(ann).toBeDefined();
      if (ann) {
        expect(ann.opacity).toBe(0.5);
      }
    }
  });

  it('creates an underline annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'underline',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'green',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      expect(anns.find((a: any) => a.kind === 'underline')).toBeDefined();
    }
  });

  it('creates a squiggly annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'squiggly',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'magenta',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      expect(anns.find((a: any) => a.kind === 'squiggly')).toBeDefined();
    }
  });

  it('creates a strikeout annotation (DEF-014 regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'strikeout',
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'red',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const found = anns.find((a: any) => a.kind === 'strikeout');
      expect(found).toBeDefined();
      if (found) {
        // DEF-014: strikeout must stay strikeout, not become underline
        expect(found.kind).toBe('strikeout');
        expect(found.color).toBe('red');
      }
    }
  });

  it('marks document as modified after creating annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const state1 = await engine.getState('doc-1');
    expect(state1.ok && state1.value.modified).toBe(false);

    await engine.createAnnotation('doc-1', makePayload());
    const state2 = await engine.getState('doc-1');
    expect(state2.ok && state2.value.modified).toBe(true);
  });

  it('returns out-of-range for invalid page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({ page: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });
});

// ---------------------------------------------------------------------------
// Editing annotations
// ---------------------------------------------------------------------------

describe('EngineService - editAnnotation', () => {
  it('edits color of an annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const created = await engine.createAnnotation('doc-1', makePayload({ id: 'test-id-1', color: 'yellow' }));
    expect(created.ok).toBe(true);

    const edited = await engine.editAnnotation('doc-1', 'test-id-1', { color: 'red' });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const anns = getAnns(edited.value);
      const ann = anns.find((a: any) => a.id === 'test-id-1');
      expect(ann).toBeDefined();
      if (ann) {
        expect(ann.color).toBe('red');
      }
    }
  });

  it('edits content of a text-box', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'test-id-2', content: 'Original' }));

    const edited = await engine.editAnnotation('doc-1', 'test-id-2', { content: 'Changed' });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const anns = getAnns(edited.value);
      const ann = anns.find((a: any) => a.id === 'test-id-2');
      if (ann) {
        expect(ann.content).toBe('Changed');
      }
    }
  });

  it('edit with text field applies to text-box', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'test-id-3', content: 'old' }));

    const edited = await engine.editAnnotation('doc-1', 'test-id-3', { text: 'new label' });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const anns = getAnns(edited.value);
      const ann = anns.find((a: any) => a.id === 'test-id-3');
      if (ann) {
        expect(ann.content).toBe('new label');
        expect(ann.text).toBe('new label');
      }
    }
  });

  it('returns not-found for unknown annotation id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.editAnnotation('doc-1', 'nonexistent-id', { color: 'red' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.editAnnotation('ghost', 'any-id', { color: 'red' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// Deleting annotations
// ---------------------------------------------------------------------------

describe('EngineService - deleteAnnotation', () => {
  it('deletes an annotation and removes it from state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'del-test-1', page: 1 }));

    const state1 = await engine.getState('doc-1');
    const anns1 = getAnns(state1.ok ? state1.value : {} as EngineState);
    expect(anns1.filter((a: any) => a.id === 'del-test-1').length).toBe(1);

    const del = await engine.deleteAnnotation('doc-1', 'del-test-1');
    expect(del.ok).toBe(true);

    const state2 = await engine.getState('doc-1');
    const anns2 = getAnns(state2.ok ? state2.value : {} as EngineState);
    expect(anns2.filter((a: any) => a.id === 'del-test-1').length).toBe(0);
  });

  it('returns not-found for unknown annotation id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.deleteAnnotation('doc-1', 'nonexistent');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });

  it('marks document as modified', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'del-mod-1' }));

    await engine.save('doc-1');
    const s0 = await engine.getState('doc-1');
    expect(s0.ok && s0.value.modified).toBe(false);

    await engine.deleteAnnotation('doc-1', 'del-mod-1');
    const s1 = await engine.getState('doc-1');
    expect(s1.ok && s1.value.modified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Undo / redo of annotation operations
// ---------------------------------------------------------------------------

describe('EngineService - annotation undo/redo', () => {
  it('undo restores a deleted annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'undo-del-1', content: 'Keep me' }));

    await engine.deleteAnnotation('doc-1', 'undo-del-1');
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const anns = getAnns(u.value);
      const found = anns.filter((a: any) => a.id === 'undo-del-1');
      expect(found.length).toBe(1);
      expect(found[0].content).toBe('Keep me');
    }
  });

  it('undo reverts an edit', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'undo-edit-1', color: 'yellow', content: 'original' }));

    await engine.editAnnotation('doc-1', 'undo-edit-1', { color: 'red', content: 'changed' });
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const anns = getAnns(u.value);
      const found = anns.find((a: any) => a.id === 'undo-edit-1');
      if (found) {
        expect(found.color).toBe('yellow');
        expect(found.content).toBe('original');
      }
    }
  });

  it('undo removes a created annotation', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'undo-create-1' }));
    const state1 = await engine.getState('doc-1');
    const anns1 = getAnns(state1.ok ? state1.value : {} as EngineState);
    expect(anns1.filter((a: any) => a.id === 'undo-create-1').length).toBe(1);

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const anns2 = getAnns(u.value);
      expect(anns2.filter((a: any) => a.id === 'undo-create-1').length).toBe(0);
    }
  });

  it('redo re-applies undone annotation create', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'redo-create-1', content: 're-created' }));
    await engine.undo('doc-1');
    const r = await engine.redo('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const anns = getAnns(r.value);
      const found = anns.find((a: any) => a.id === 'redo-create-1');
      if (found) {
        expect(found.content).toBe('re-created');
      }
    }
  });

  it('annotation undo mixes with page ops undo correctly', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });
    await engine.createAnnotation('doc-1', makePayload({ page: 1 }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, color: 'blue' }));

    const u3 = await engine.undo('doc-1');
    expect(u3.ok).toBe(true);
    const u2 = await engine.undo('doc-1');
    expect(u2.ok).toBe(true);
    const u1 = await engine.undo('doc-1');
    expect(u1.ok && u1.value.rotations[0]).toBe(0);

    const u0 = await engine.undo('doc-1');
    expect(u0.ok).toBe(false);
    if (!u0.ok) {
      expect(u0.error.code).toBe('nothing-to-undo');
    }
  });

  it('modified flag returns to false after undoing all annotation ops', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload());
    const s1 = await engine.getState('doc-1');
    expect(s1.ok && s1.value.modified).toBe(true);

    await engine.undo('doc-1');
    const s2 = await engine.getState('doc-1');
    expect(s2.ok && s2.value.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Annotation-page interaction: delete page drops its annotations
// ---------------------------------------------------------------------------

describe('EngineService - delete page drops annotations', () => {
  it('deleting a page drops its annotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'p1', page: 1, kind: 'text-box' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 'p2', page: 2, kind: 'rect', color: 'blue' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 'p3', page: 3, kind: 'ellipse', color: 'green' }));

    await engine.applyOp('doc-1', { kind: 'delete', page: 1 });

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.pageCount).toBe(2);
      const anns = getAnns(state.value);
      expect(anns.filter((a: any) => a.id === 'p1').length).toBe(1);
      expect(anns.filter((a: any) => a.id === 'p2').length).toBe(0);
      expect(anns.filter((a: any) => a.id === 'p3').length).toBe(1);
    }
  });

  it('undo of delete page restores annotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 'p2-ann', page: 2, content: 'Page 2 annotation' }));
    await engine.applyOp('doc-1', { kind: 'delete', page: 1 });

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const anns = getAnns(u.value);
      const found = anns.find((a: any) => a.id === 'p2-ann');
      expect(found).toBeDefined();
      if (found) {
        expect(found.content).toBe('Page 2 annotation');
      }
      expect(u.value.pageCount).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Save / saveAs with annotations — round-trip
// ---------------------------------------------------------------------------

describe('EngineService - save with annotations round-trip', () => {
  async function loadAndCountAnnots(filePath: string): Promise<number> {
    const buf = await readFile(filePath);
    const doc = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    let total = 0;
    for (let i = 0; i < doc.getPageCount(); i++) {
      const page = doc.getPage(i);
      const pageLeaf = (page as any).node;
      const annots = pageLeaf.get(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        total += annots.size();
      }
    }
    return total;
  }

  it('save writes /Annots arrays on pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ id: 's1', page: 1, kind: 'text-box' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 's2', page: 2, kind: 'rect', color: 'blue' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 's3', page: 2, kind: 'ellipse', color: 'green' }));
    await engine.createAnnotation('doc-1', makePayload({ id: 's4', page: 3, kind: 'highlight', color: 'yellow' }));

    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    const total = await loadAndCountAnnots(path);
    expect(total).toBe(4);
  });

  it('save with annotation + delete + rotate writes correct output', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'text-box' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'rect', color: 'blue' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 3, kind: 'highlight' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 4, kind: 'note' }));

    await engine.applyOp('doc-1', { kind: 'delete', page: 1 });
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });

    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset, buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(3);

    let total = 0;
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const page = reparsed.getPage(i);
      const pageLeaf = (page as any).node;
      const annots = pageLeaf.get(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        total += annots.size();
      }
    }
    expect(total).toBe(3);
    expect(reparsed.getPage(0).getRotation().angle).toBe(90);
  });

  it('saveAs works with annotations', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ page: 1 }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, color: 'blue' }));

    const newPath = join(dir, 'ann-saved-as.pdf');
    const r = await engine.saveAs('doc-1', newPath);
    expect(r.ok).toBe(true);

    const total = await loadAndCountAnnots(newPath);
    expect(total).toBe(2);
  });

  it('save clears modified flag', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload());
    const stateMod = await engine.getState('doc-1');
    expect(stateMod.ok && stateMod.value.modified).toBe(true);

    await engine.save('doc-1');
    const stateClean = await engine.getState('doc-1');
    expect(stateClean.ok && stateClean.value.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Save with ink — check AP stream is present
// ---------------------------------------------------------------------------

describe('EngineService - ink AP stream on save', () => {
  it('ink annotation produces an /AP dict with an /N stream', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'ink',
      page: 1,
      rects: [{ x: 10, y: 10, width: 200, height: 100 }],
      points: [
        { x: 20, y: 20 },
        { x: 100, y: 80 },
        { x: 180, y: 40 },
      ],
      color: 'red',
      width: 2,
    }));

    await engine.save('doc-1');

    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset, buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    const page = reparsed.getPage(0);
    const pageLeaf = (page as any).node;
    const annots = pageLeaf.get(PDFName.of('Annots'));
    expect(annots instanceof PDFArray).toBe(true);
    expect((annots as PDFArray).size()).toBe(1);

    const annotRef = (annots as PDFArray).get(0);
    const annotDict = reparsed.context.lookup(annotRef) as any;
    const ap = annotDict.get(PDFName.of('AP'));
    expect(ap).toBeDefined();
    const apDict = ap as any;
    const n = apDict.get(PDFName.of('N'));
    expect(n).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Parse-on-load round-trip: create -> save -> load -> annotations back
// ---------------------------------------------------------------------------

describe('EngineService - parse-on-load round-trip', () => {
  async function saveAndReloadAs(docId: string, engine: EngineService): Promise<void> {
    const savePath = join(dir, `rt-${docId}.pdf`);
    const r = await engine.saveAs(docId, savePath);
    expect(r.ok).toBe(true);
    await engine.loadDocument(docId + '-reloaded', savePath);
  }

  it('text-box survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'text-box',
      content: 'Round-trip text',
      color: 'red',
      opacity: 0.8,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('text-box');
      expect(anns[0].content).toBe('Round-trip text');
      expect(anns[0].color).toBe('red');
    }
  });

  it('rect survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 200, height: 150 }],
      color: 'blue',
      width: 3,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('rect');
      expect(anns[0].color).toBe('blue');
    }
  });

  it('ellipse survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'ellipse',
      rects: [{ x: 100, y: 300, width: 300, height: 200 }],
      color: 'green',
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('ellipse');
      expect(anns[0].color).toBe('green');
    }
  });

  it('note survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'note',
      at: { x: 100, y: 100 },
      color: 'orange',
      content: 'Note content',
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('note');
      expect(anns[0].content).toBe('Note content');
    }
  });

  it('ink survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'ink',
      rects: [{ x: 10, y: 10, width: 200, height: 100 }],
      points: [
        { x: 20, y: 20 },
        { x: 100, y: 80 },
      ],
      color: 'purple',
      width: 2,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('ink');
      expect(anns[0].color).toBe('purple');
    }
  });

  it('arrow survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'arrow',
      from: { x: 50, y: 400 },
      to: { x: 250, y: 200 },
      lineEnds: ['OpenArrow', 'None'],
      color: 'magenta',
      width: 2,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('arrow');
      expect((anns[0] as any).points).toBeDefined();
      expect((anns[0] as any).points.length).toBe(2);
    }
  });

  it('highlight survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'yellow',
      opacity: 0.6,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('highlight');
    }
  });

  it('underline survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'underline',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'cyan',
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('underline');
    }
  });

  it('squiggly survives save-load round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'squiggly',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'red',
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('squiggly');
    }
  });

  it('strikeout survives save-load round-trip (DEF-014 regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'strikeout',
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'red',
      opacity: 0.8,
    }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      // DEF-014: must be strikeout, not underline
      expect(anns[0].kind).toBe('strikeout');
      expect(anns[0].color).toBe('red');
      expect(anns[0].opacity).toBe(0.8);
    }
  });

  it('multiple annotations of different kinds survive round-trip', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'text-box', content: 'text1', color: 'yellow' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'rect', color: 'blue' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'highlight', color: 'green' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'underline', color: 'red' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'strikeout', color: 'orange' }));

    await saveAndReloadAs('doc-1', engine);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(5);
      const kinds = anns.map((a: any) => a.kind).sort();
      expect(kinds).toEqual(['highlight', 'rect', 'strikeout', 'text-box', 'underline']);
    }
  });
});

// ---------------------------------------------------------------------------
// Split/extract preserve annotations
// ---------------------------------------------------------------------------

describe('EngineService - split preserves annotations', () => {
  it('split output contains annotations for split pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'text-box', content: 'keep' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'rect', color: 'blue' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 3, kind: 'highlight' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 4, kind: 'note', content: 'also' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 5, kind: 'underline' }));

    const r = await engine.split('doc-1', [0, 1]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(2);

      let total = 0;
      for (let i = 0; i < reparsed.getPageCount(); i++) {
        const page = reparsed.getPage(i);
        const pageLeaf = (page as any).node;
        const annots = pageLeaf.get(PDFName.of('Annots'));
        if (annots instanceof PDFArray) {
          total += annots.size();
        }
      }
      expect(total).toBe(2);
    }

    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.pageCount).toBe(3);
  });
});

describe('EngineService - extract preserves annotations', () => {
  it('extract output contains annotations for extracted pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(5);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'text-box', content: 'extract-me' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 3, kind: 'highlight' }));

    const r = await engine.extract('doc-1', [0, 2]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reparsed = await PDFDocument.load(r.value);
      expect(reparsed.getPageCount()).toBe(2);

      let total = 0;
      for (let i = 0; i < reparsed.getPageCount(); i++) {
        const page = reparsed.getPage(i);
        const pageLeaf = (page as any).node;
        const annots = pageLeaf.get(PDFName.of('Annots'));
        if (annots instanceof PDFArray) {
          total += annots.size();
        }
      }
      expect(total).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Merge discards other-doc annotations, keeps target-doc annotations
// ---------------------------------------------------------------------------

describe('EngineService - merge annotations', () => {
  it('merge preserves target-doc annotations and others get empty arrays', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { path: pB } = await createNPagePdf(1);

    await engine.loadDocument('doc-1', pA);
    await engine.createAnnotation('doc-1', makePayload({ id: 'target-ann', page: 1, content: 'target-ann' }));

    await engine.merge('doc-1', [pB], 'after');

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.pageCount).toBe(3);
      const anns = getAnns(state.value);
      expect(anns.filter((a: any) => a.id === 'target-ann').length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// loadDocumentBytes — parse-on-load works for bytes-loaded docs
// ---------------------------------------------------------------------------

describe('EngineService - annotations with loadDocumentBytes', () => {
  it('parse-on-load works for bytes-loaded document', async () => {
    const engine = new EngineService();
    const { bytes: origBytes } = await createNPagePdf(2);

    const tempPath = join(dir, 'bytes-src.pdf');
    await writeFile(tempPath, Buffer.from(origBytes));
    await engine.loadDocument('doc-1', tempPath);

    await engine.createAnnotation('doc-1', makePayload({ page: 1, kind: 'text-box', content: 'bytes-ann' }));
    await engine.createAnnotation('doc-1', makePayload({ page: 2, kind: 'rect', color: 'blue' }));

    const savePath = join(dir, 'bytes-saved.pdf');
    await engine.saveAs('doc-1', savePath);

    const savedBuf = await readFile(savePath);
    const result = await engine.loadDocumentBytes('doc-2', new Uint8Array(savedBuf));
    expect(result.ok).toBe(true);

    const state = await engine.getState('doc-2');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(2);
      const kinds = anns.map((a: any) => a.kind).sort();
      expect(kinds).toEqual(['rect', 'text-box']);
    }
  });

  it('annotation ops work on bytes-loaded doc', async () => {
    const engine = new EngineService();
    const { bytes } = await createNPagePdf(3);
    await engine.loadDocumentBytes('doc-1', bytes);

    const created = await engine.createAnnotation('doc-1', makePayload({ id: 'bytes-ann-1', kind: 'text-box' }));
    expect(created.ok).toBe(true);

    const state = await engine.getState('doc-1');
    const anns = getAnns(state.ok ? state.value : {} as EngineState);
    expect(anns.filter((a: any) => a.id === 'bytes-ann-1').length).toBe(1);

    await engine.editAnnotation('doc-1', 'bytes-ann-1', { color: 'red' });
    const state2 = await engine.getState('doc-1');
    const anns2 = getAnns(state2.ok ? state2.value : {} as EngineState);
    const edited = anns2.find((a: any) => a.id === 'bytes-ann-1');
    if (edited) {
      expect(edited.color).toBe('red');
    }

    await engine.deleteAnnotation('doc-1', 'bytes-ann-1');
    const state3 = await engine.getState('doc-1');
    const anns3 = getAnns(state3.ok ? state3.value : {} as EngineState);
    expect(anns3.filter((a: any) => a.id === 'bytes-ann-1').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Queue serialization: annotation ops serialised correctly
// ---------------------------------------------------------------------------

describe('EngineService - annotation queue serialisation', () => {
  it('annotation create and save are serialised', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const annP = engine.createAnnotation('doc-1', makePayload({ kind: 'text-box', content: 'queued' }));
    const saveP = engine.save('doc-1');

    const [annR, saveR] = await Promise.all([annP, saveP]);
    expect(annR.ok).toBe(true);
    expect(saveR.ok).toBe(true);

    const buf = await readFile(path);
    const doc = await PDFDocument.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    let t = 0;
    for (let i = 0; i < doc.getPageCount(); i++) {
      const pageLeaf = (doc.getPage(i) as any).node;
      const annots = pageLeaf.get(PDFName.of('Annots'));
      if (annots instanceof PDFArray) t += annots.size();
    }
    expect(t).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe('EngineService - annotation error codes', () => {
  it('invalid page on create yields out-of-range', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({ page: 5 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });

  it('unknown annotation id on edit yields not-found', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.editAnnotation('doc-1', 'bad-id', { color: 'red' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('unknown annotation id on delete yields not-found', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.deleteAnnotation('doc-1', 'bad-id');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  it('unknown docId yields engine-error', async () => {
    const engine = new EngineService();
    const r = await engine.createAnnotation('ghost', makePayload());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});