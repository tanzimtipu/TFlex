import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import {
  ANN_COLORS,
  colorToRgb,
  isValidColorValue,
  nearestAnnColor,
  parseAnnotationsFromDoc,
} from '../../../src/main/services/annotations';
import {
  ANN_COLOR_RGB,
  ANNOTATION_COLOR_NAMES,
} from '../../../src/shared/annotationColors';
import type { AnnColor, CreateAnnotationPayload, EngineState } from '../../../src/shared/types';

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

// ---------------------------------------------------------------------------
// Phase 12: callout annotation (FreeText with /Intent /FreeTextCallout + /Callout)
// ---------------------------------------------------------------------------

describe('Phase 12: callout annotation', () => {
  it('creates a callout and round-trips through save/load', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-co', path);

    const r = await engine.createAnnotation('doc-co', makePayload({
      kind: 'callout' as any,
      rects: [{ x: 100, y: 500, width: 200, height: 60 }],
      points: [
        { x: 50, y: 700 },
        { x: 80, y: 620 },
        { x: 100, y: 560 },
      ],
      color: 'red',
      content: 'See this',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const anns = getAnns(r.value);
    expect(anns.some((a: any) => a.kind === 'callout')).toBe(true);

    // Save and reload — the callout kind must survive.
    const savePath = join(dir, 'callout-rt.pdf');
    const sr = await engine.saveAs('doc-co', savePath);
    expect(sr.ok).toBe(true);
    await engine.loadDocument('doc-co-reloaded', savePath);
    const state = await engine.getState('doc-co-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const reloaded = getAnns(state.value);
      expect(reloaded.length).toBeGreaterThanOrEqual(1);
      expect(reloaded.some((a: any) => a.kind === 'callout')).toBe(true);
    }
  });

  it('serializes /Intent /FreeTextCallout and a /Callout array', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-co2', path);

    await engine.createAnnotation('doc-co2', makePayload({
      kind: 'callout' as any,
      rects: [{ x: 100, y: 500, width: 200, height: 60 }],
      points: [
        { x: 50, y: 700 },
        { x: 80, y: 620 },
        { x: 100, y: 560 },
      ],
      color: 'red',
      content: 'Note text',
    }));

    const savePath = join(dir, 'callout-dict.pdf');
    const sr = await engine.saveAs('doc-co2', savePath);
    expect(sr.ok).toBe(true);
    if (!sr.ok) return;
    const saved = await readFile(savePath);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const pageLeaf = (re.getPage(0) as any).node;
    const annotsRef = pageLeaf.get(PDFName.of('Annots'));
    expect(annotsRef).toBeDefined();
    let annotsArray: any = annotsRef;
    if (annotsRef && annotsRef.objectNumber !== undefined) {
      annotsArray = re.context.lookup(annotsRef);
    }
    expect(annotsArray).toBeDefined();
    expect(annotsArray.size()).toBeGreaterThanOrEqual(1);
    const annotRef = annotsArray.get(0);
    const annot = re.context.lookup(annotRef) as any;
    const dict = annot?.dict ?? annot;
    const intent = dict.get ? dict.get(PDFName.of('Intent')) : undefined;
    const callout = dict.get ? dict.get(PDFName.of('Callout')) : undefined;
    expect(intent).toBeDefined();
    expect(intent.toString()).toBe('/FreeTextCallout');
    expect(callout).toBeDefined();
  });

  // DEF-157: the callout's `at` anchor (the point the arrow points at) was
  // dropped by normalizeAnnotationPayload — AnnModel had no `at` field, so
  // the renderer's annotationFromWire backfilled `at` from the box top-left,
  // giving a zero-length arrow line. The engine must now preserve `at`
  // through create -> save -> reparse.
  it('preserves the callout anchor `at` through create -> save -> reparse (DEF-157)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-co3', path);

    // The shape the renderer sends: `rect` (the text box) + `at` (the arrow
    // tip), no explicit `points` leader. The anchor is well outside the box
    // and distinct from the box top-left.
    const box = { x: 200, y: 200, width: 150, height: 50 };
    const anchor = { x: 50, y: 400 };
    const r = await engine.createAnnotation('doc-co3', makePayload({
      kind: 'callout' as any,
      rect: box,
      at: anchor,
      color: 'red',
      content: 'See this',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const anns = getAnns(r.value);
    const created = anns.find((a: any) => a.kind === 'callout') as any;
    expect(created).toBeDefined();
    // The anchor is preserved on the created model (not dropped).
    expect(created.at).toBeDefined();
    expect(created.at.x).toBeCloseTo(anchor.x);
    expect(created.at.y).toBeCloseTo(anchor.y);

    // Save and reload — the anchor must survive the round-trip.
    const savePath = join(dir, 'callout-anchor-rt.pdf');
    const sr = await engine.saveAs('doc-co3', savePath);
    expect(sr.ok).toBe(true);
    if (!sr.ok) return;

    // The serialized PDF still carries /Intent /FreeTextCallout + /Callout.
    const saved = await readFile(savePath);
    const re = await PDFDocument.load(saved.buffer.slice(
      saved.byteOffset, saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer);
    const pageLeaf = (re.getPage(0) as any).node;
    const annotsRef = pageLeaf.get(PDFName.of('Annots'));
    expect(annotsRef).toBeDefined();
    let annotsArray: any = annotsRef;
    if (annotsRef && annotsRef.objectNumber !== undefined) {
      annotsArray = re.context.lookup(annotsRef);
    }
    const annotRef = annotsArray.get(0);
    const annot = re.context.lookup(annotRef) as any;
    const dict = annot?.dict ?? annot;
    const intent = dict.get ? dict.get(PDFName.of('Intent')) : undefined;
    const callout = dict.get ? dict.get(PDFName.of('Callout')) : undefined;
    expect(intent).toBeDefined();
    expect(intent.toString()).toBe('/FreeTextCallout');
    expect(callout).toBeDefined();

    // Reparse: the reloaded callout's `at` equals the sent anchor, not the box
    // top-left (the old DEF-157 backfill), and the leader-line endpoints are
    // distinct (non-zero arrow length).
    await engine.loadDocument('doc-co3-reloaded', savePath);
    const state = await engine.getState('doc-co3-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value);
    const co = reloaded.find((a: any) => a.kind === 'callout') as any;
    expect(co).toBeDefined();
    expect(co.at).toBeDefined();
    expect(co.at.x).toBeCloseTo(anchor.x);
    expect(co.at.y).toBeCloseTo(anchor.y);
    // The anchor is NOT the box top-left (the regression value).
    expect(co.at.x).not.toBeCloseTo(box.x);
    expect(co.at.y).not.toBeCloseTo(box.y);
    // The synthesized leader line has distinct start/end (non-zero length).
    expect(co.points).toBeDefined();
    expect(co.points.length).toBeGreaterThanOrEqual(2);
    const p0 = co.points[0];
    const pEnd = co.points[co.points.length - 1];
    expect(Math.hypot(pEnd.x - p0.x, pEnd.y - p0.y)).toBeGreaterThan(0);
    // The leader tip matches the anchor.
    expect(pEnd.x).toBeCloseTo(anchor.x);
    expect(pEnd.y).toBeCloseTo(anchor.y);
  });
});

// ---------------------------------------------------------------------------
// B3: custom hex color survives create -> save -> reparse
//
// The renderer's ColorPalette can emit a free-form hex string (e.g. #00ff00)
// instead of a named preset. The engine must preserve that hex verbatim
// through createAnnotation, PDF serialization, and parse-on-load — it must
// NOT snap an unknown hex to the nearest named preset (which previously
// collapsed #00ff00 to "yellow" at create time).
// ---------------------------------------------------------------------------

describe('B3: custom hex color round-trip', () => {
  it('createAnnotation preserves a custom hex color verbatim', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'text-box',
      color: '#00ff00',
      content: 'custom green',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ann = getAnns(r.value).find((a: any) => a.kind === 'text-box');
      expect(ann).toBeDefined();
      expect(ann?.color).toBe('#00ff00');
    }
  });

  it('a custom hex survives save/reload (not collapsed to a named preset)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 150, height: 100 }],
      color: '#00ff00',
    }));

    const savePath = join(dir, 'b3-hex.pdf');
    const sr = await engine.saveAs('doc-1', savePath);
    expect(sr.ok).toBe(true);
    await engine.loadDocument('doc-1-reloaded', savePath);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].color).toBe('#00ff00');
    }
  });

  it('a hex whose RGB matches a named preset still round-trips as the hex', async () => {
    // #00ff00 -> RGB [0,1,0], which is exactly the 'green' preset's RGB.
    // Without the /TFlexColor sidecar, parse-on-load would snap [0,1,0] back
    // to 'green' (and the renderer would then render 'green' as #22c55e, not
    // #00ff00). The sidecar must keep the original hex.
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: '#00ff00',
    }));

    const savePath = join(dir, 'b3-collision.pdf');
    await engine.saveAs('doc-1', savePath);
    await engine.loadDocument('doc-1-reloaded', savePath);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].color).toBe('#00ff00');
      expect(anns[0].color).not.toBe('green');
    }
  });

  it('a 3-digit hex (#0f0) round-trips verbatim', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'rect',
      rects: [{ x: 10, y: 10, width: 80, height: 80 }],
      color: '#0f0',
    }));

    const savePath = join(dir, 'b3-short.pdf');
    await engine.saveAs('doc-1', savePath);
    await engine.loadDocument('doc-1-reloaded', savePath);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].color).toBe('#0f0');
    }
  });

  it('editAnnotation accepts a custom hex color', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      id: 'b3-edit',
      kind: 'text-box',
      color: 'yellow',
    }));

    const edited = await engine.editAnnotation('doc-1', 'b3-edit', { color: '#ff00aa' });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const ann = getAnns(edited.value).find((a: any) => a.id === 'b3-edit');
      expect(ann?.color).toBe('#ff00aa');
    }
  });

  it('an invalid color is rejected, not silently normalized to yellow (ADV-027/DEF-206)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.createAnnotation('doc-1', makePayload({
      kind: 'text-box',
      color: 'not-a-real-color',
    }));
    // ADV-027/DEF-206: invalid colors must surface as an engine-error result,
    // not silently default to yellow.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/Invalid annotation color/i);
    }
  });

  it('a named preset still round-trips by name (no regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', makePayload({
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 150, height: 100 }],
      color: 'red',
    }));

    const savePath = join(dir, 'b3-named.pdf');
    await engine.saveAs('doc-1', savePath);
    await engine.loadDocument('doc-1-reloaded', savePath);

    const state = await engine.getState('doc-1-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].color).toBe('red');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-160/161/162: a moved annotation re-created via onCreate carries a stale
// `rects` array (left over from the IPC round-trip backfill) at the OLD
// position alongside the fresh `rect`/`at`. normalizeAnnotationPayload must
// treat the primary geometry key as authoritative and regenerate rects[0]
// from it, so the move survives create -> save -> reparse (no silent revert,
// no torn callout arrow, no lost note).
// ---------------------------------------------------------------------------

describe('DEF-160/161/162: moved annotation survives re-create with stale rects', () => {
  // The shape confirmPendingAnn sends: a spread of the renderer annotation,
  // carrying BOTH the moved primary key AND the stale rects[0] from the
  // prior IPC backfill. rectNew != rects[0].
  function movedPayload(overrides: Partial<CreateAnnotationPayload>): CreateAnnotationPayload {
    const staleRects = [{ x: 122.4, y: 118.8, width: 200, height: 50 }];
    return makePayload({
      rects: staleRects,
      ...overrides,
    });
  }

  it('text-box: fresh `rect` wins over stale `rects[0]` (DEF-160)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-tb', path);

    const staleRect = { x: 122.4, y: 118.8, width: 200, height: 50 };
    const movedRect = { x: 629.2, y: 414.4, width: 200, height: 50 };
    const r = await engine.createAnnotation('doc-tb', movedPayload({
      kind: 'text-box',
      rect: movedRect,
      rects: [staleRect], // stale backfill at OLD position
      color: 'yellow',
      content: 'moved box',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'text-box') as any;
    expect(created).toBeDefined();
    // Engine state reflects the NEW rect, not the stale rects[0].
    expect(created.rects[0].x).toBeCloseTo(movedRect.x);
    expect(created.rects[0].y).toBeCloseTo(movedRect.y);
    expect(created.rects[0].width).toBeCloseTo(movedRect.width);
    expect(created.rects[0].height).toBeCloseTo(movedRect.height);
    // And it is NOT the stale position.
    expect(created.rects[0].x).not.toBeCloseTo(staleRect.x);

    // Save + reparse: the NEW position survives.
    const savePath = join(dir, 'def160-textbox.pdf');
    const sr = await engine.saveAs('doc-tb', savePath);
    expect(sr.ok).toBe(true);
    await engine.loadDocument('doc-tb-reloaded', savePath);
    const state = await engine.getState('doc-tb-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value).find((a: any) => a.kind === 'text-box') as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.rects[0].x).toBeCloseTo(movedRect.x);
    expect(reloaded.rects[0].y).toBeCloseTo(movedRect.y);
  });

  it('rect: fresh `rect` wins over stale `rects[0]` (DEF-160)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-rect', path);

    const staleRect = { x: 50, y: 400, width: 150, height: 100 };
    const movedRect = { x: 300, y: 200, width: 150, height: 100 };
    const r = await engine.createAnnotation('doc-rect', movedPayload({
      kind: 'rect',
      rect: movedRect,
      rects: [staleRect],
      color: 'red',
      width: 2,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'rect') as any;
    expect(created).toBeDefined();
    expect(created.rects[0].x).toBeCloseTo(movedRect.x);
    expect(created.rects[0].y).toBeCloseTo(movedRect.y);
    expect(created.rects[0].x).not.toBeCloseTo(staleRect.x);

    const savePath = join(dir, 'def160-rect.pdf');
    await engine.saveAs('doc-rect', savePath);
    await engine.loadDocument('doc-rect-reloaded', savePath);
    const state = await engine.getState('doc-rect-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value).find((a: any) => a.kind === 'rect') as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.rects[0].x).toBeCloseTo(movedRect.x);
    expect(reloaded.rects[0].y).toBeCloseTo(movedRect.y);
  });

  it('ellipse: fresh `rect` wins over stale `rects[0]` (DEF-160)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ell', path);

    const staleRect = { x: 60, y: 600, width: 120, height: 80 };
    const movedRect = { x: 400, y: 300, width: 120, height: 80 };
    const r = await engine.createAnnotation('doc-ell', movedPayload({
      kind: 'ellipse',
      rect: movedRect,
      rects: [staleRect],
      color: 'blue',
      width: 2,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'ellipse') as any;
    expect(created).toBeDefined();
    expect(created.rects[0].x).toBeCloseTo(movedRect.x);
    expect(created.rects[0].y).toBeCloseTo(movedRect.y);
    expect(created.rects[0].x).not.toBeCloseTo(staleRect.x);

    const savePath = join(dir, 'def160-ellipse.pdf');
    await engine.saveAs('doc-ell', savePath);
    await engine.loadDocument('doc-ell-reloaded', savePath);
    const state = await engine.getState('doc-ell-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value).find((a: any) => a.kind === 'ellipse') as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.rects[0].x).toBeCloseTo(movedRect.x);
    expect(reloaded.rects[0].y).toBeCloseTo(movedRect.y);
  });

  it('callout: moved `rect` + moved `at` stay consistent (no torn arrow) (DEF-161)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-co', path);

    // Original geometry (what the stale backfill holds).
    const staleBox = { x: 200, y: 200, width: 150, height: 50 };
    const staleAnchor = { x: 50, y: 400 };
    // Moved geometry: both box and anchor shift by the same delta.
    const movedBox = { x: 400, y: 300, width: 150, height: 50 };
    const movedAnchor = { x: 250, y: 500 };

    const r = await engine.createAnnotation('doc-co', movedPayload({
      kind: 'callout' as any,
      rect: movedBox,
      at: movedAnchor,
      // Stale backfill at the OLD position — the regression source.
      rects: [staleBox],
      color: 'red',
      content: 'See this (moved)',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'callout') as any;
    expect(created).toBeDefined();
    // Box uses the NEW rect, not the stale rects[0].
    expect(created.rects[0].x).toBeCloseTo(movedBox.x);
    expect(created.rects[0].y).toBeCloseTo(movedBox.y);
    expect(created.rects[0].x).not.toBeCloseTo(staleBox.x);
    // Anchor uses the NEW `at`, not the stale box corner.
    expect(created.at).toBeDefined();
    expect(created.at.x).toBeCloseTo(movedAnchor.x);
    expect(created.at.y).toBeCloseTo(movedAnchor.y);
    expect(created.at.x).not.toBeCloseTo(staleAnchor.x);
    // The leader line is synthesized during serialization (from box center +
    // `at`), so it is not present on the freshly-created model — it appears
    // after save/reparse. The box+anchor consistency is what matters here.

    // Save + reparse: box AND anchor survive at the moved positions.
    const savePath = join(dir, 'def161-callout.pdf');
    const sr = await engine.saveAs('doc-co', savePath);
    expect(sr.ok).toBe(true);
    await engine.loadDocument('doc-co-reloaded', savePath);
    const state = await engine.getState('doc-co-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value).find((a: any) => a.kind === 'callout') as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.rects[0].x).toBeCloseTo(movedBox.x);
    expect(reloaded.rects[0].y).toBeCloseTo(movedBox.y);
    expect(reloaded.at).toBeDefined();
    expect(reloaded.at.x).toBeCloseTo(movedAnchor.x);
    expect(reloaded.at.y).toBeCloseTo(movedAnchor.y);
    // No torn arrow after reparse: leader line non-zero, tip == movedAnchor.
    expect(reloaded.points).toBeDefined();
    expect(reloaded.points.length).toBeGreaterThanOrEqual(2);
    const rp0 = reloaded.points[0];
    const rpEnd = reloaded.points[reloaded.points.length - 1];
    expect(Math.hypot(rpEnd.x - rp0.x, rpEnd.y - rp0.y)).toBeGreaterThan(0);
    expect(rpEnd.x).toBeCloseTo(movedAnchor.x);
    expect(rpEnd.y).toBeCloseTo(movedAnchor.y);
  });

  it('note: moved `at` wins over stale `rects[0]` (not lost on save) (DEF-162)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-note', path);

    // Original icon position (stale backfill).
    const staleAt = { x: 100, y: 700 };
    const staleRect = { x: 100, y: 700, width: 24, height: 24 };
    // Moved icon anchor.
    const movedAt = { x: 500, y: 300 };

    const r = await engine.createAnnotation('doc-note', movedPayload({
      kind: 'note',
      at: movedAt,
      // Stale backfill at the OLD position.
      rects: [staleRect],
      color: 'yellow',
      content: 'Moved note',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'note') as any;
    expect(created).toBeDefined();
    // The icon rect is regenerated from the moved `at`, not the stale rects[0].
    expect(created.rects[0].x).toBeCloseTo(movedAt.x);
    expect(created.rects[0].y).toBeCloseTo(movedAt.y);
    expect(created.rects[0].x).not.toBeCloseTo(staleAt.x);
    // `at` itself is preserved on the model.
    expect(created.at).toBeDefined();
    expect(created.at.x).toBeCloseTo(movedAt.x);
    expect(created.at.y).toBeCloseTo(movedAt.y);

    // Save + reparse: the moved position survives (move is NOT lost).
    const savePath = join(dir, 'def162-note.pdf');
    const sr = await engine.saveAs('doc-note', savePath);
    expect(sr.ok).toBe(true);
    await engine.loadDocument('doc-note-reloaded', savePath);
    const state = await engine.getState('doc-note-reloaded');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const reloaded = getAnns(state.value).find((a: any) => a.kind === 'note') as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.rects[0].x).toBeCloseTo(movedAt.x);
    expect(reloaded.rects[0].y).toBeCloseTo(movedAt.y);
    expect(reloaded.rects[0].x).not.toBeCloseTo(staleAt.x);
  });

  it('multi-rect highlight (no `rect`) still uses `rects` verbatim (no regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-hl', path);

    const multiRects = [
      { x: 50, y: 700, width: 100, height: 14 },
      { x: 200, y: 700, width: 80, height: 14 },
    ];
    const r = await engine.createAnnotation('doc-hl', makePayload({
      kind: 'highlight',
      rects: multiRects,
      color: 'yellow',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = getAnns(r.value).find((a: any) => a.kind === 'highlight') as any;
    expect(created).toBeDefined();
    expect(created.rects.length).toBe(2);
    expect(created.rects[0].x).toBeCloseTo(multiRects[0].x);
    expect(created.rects[1].x).toBeCloseTo(multiRects[1].x);
  });
});

// ---------------------------------------------------------------------------
// DEF-174: a saved highlight bakes a translucent native appearance (/CA 0.35)
// so a reopened highlight renders ~0.35 translucent — matching the in-session
// fill-opacity 0.35 the overlay uses per DEF-173. Without /CA, pdf.js
// synthesizes a FULL-opacity Multiply-blend appearance (fillAlpha defaults to
// 1; pdf.worker.mjs HighlightAnnotation: `fillAlpha = dict.get("CA")`) — an
// opaque orange block hiding the text. Underline/strikeout/squiggly are
// intentional solid strokes and must NOT receive the /CA translucency. The
// existing /QuadPoints, /Rect, /C, /TFlexColor geometry is unchanged.
//
// Approach chosen: /CA (the standard PDF annotation opacity field pdf.js
// reads) over an /AP appearance stream — simpler, spec-compliant, and the
// pdf.js source confirms it honours /CA for Highlight.
// ---------------------------------------------------------------------------

describe('DEF-174: highlight bakes /CA 0.35, other markup stays solid', () => {
  /** Re-parse the saved file and return the first annotation dict on page 0. */
  async function reparseFirstAnnot(filePath: string): Promise<any> {
    const buf = await readFile(filePath);
    const doc = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset, buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    const page = doc.getPage(0);
    const pageLeaf = (page as any).node;
    const annotsRef = pageLeaf.get(PDFName.of('Annots'));
    expect(annotsRef).toBeDefined();
    let annotsArray: any = annotsRef;
    if (annotsRef && annotsRef.objectNumber !== undefined) {
      annotsArray = doc.context.lookup(annotsRef);
    }
    expect(annotsArray).toBeDefined();
    expect(annotsArray.size()).toBeGreaterThanOrEqual(1);
    const annotRef = annotsArray.get(0);
    const annot = doc.context.lookup(annotRef) as any;
    return annot?.dict ?? annot;
  }

  it('highlight bakes /CA 0.35 (translucent, not opaque)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-hl-op', path);

    // NOTE: no `opacity` in the payload — the renderer applies 0.35 via
    // overlay CSS (DEF-173), not via the payload. The bake must add /CA 0.35
    // regardless.
    const r = await engine.createAnnotation('doc-hl-op', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 20 }],
      color: 'yellow',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-highlight.pdf');
    const sr = await engine.saveAs('doc-hl-op', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    const ca = dict.get ? dict.get(PDFName.of('CA')) : undefined;
    expect(ca).toBeDefined();
    // The acceptance value: ~0.35 translucent (matches in-session fill-opacity).
    expect((ca as any).asNumber()).toBeCloseTo(0.35, 5);
  });

  it('highlight /CA overrides a stale parsed opacity (re-bakes as 0.35)', async () => {
    // A highlight reparsed from an old file may carry a /CA (e.g. 0.6) which
    // parse stores as `ann.opacity`. On re-save the bake must re-assert 0.35
    // so the file matches the overlay's 0.35 — not the stale parsed value.
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-hl-stale', path);

    const r = await engine.createAnnotation('doc-hl-stale', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 20 }],
      color: 'yellow',
      opacity: 0.6, // stale / parsed value
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-highlight-stale.pdf');
    const sr = await engine.saveAs('doc-hl-stale', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    const ca = dict.get ? dict.get(PDFName.of('CA')) : undefined;
    expect(ca).toBeDefined();
    expect((ca as any).asNumber()).toBeCloseTo(0.35, 5);
    expect((ca as any).asNumber()).not.toBeCloseTo(0.6, 5);
  });

  it('underline does NOT bake /CA (solid stroke)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ul-solid', path);

    const r = await engine.createAnnotation('doc-ul-solid', makePayload({
      kind: 'underline',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'green',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-underline.pdf');
    const sr = await engine.saveAs('doc-ul-solid', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    const ca = dict.get ? dict.get(PDFName.of('CA')) : undefined;
    expect(ca).toBeUndefined();
  });

  it('strikeout does NOT bake /CA (solid stroke)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-so-solid', path);

    const r = await engine.createAnnotation('doc-so-solid', makePayload({
      kind: 'strikeout',
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'red',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-strikeout.pdf');
    const sr = await engine.saveAs('doc-so-solid', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    const ca = dict.get ? dict.get(PDFName.of('CA')) : undefined;
    expect(ca).toBeUndefined();
  });

  it('squiggly does NOT bake /CA (solid stroke)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-sq-solid', path);

    const r = await engine.createAnnotation('doc-sq-solid', makePayload({
      kind: 'squiggly',
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'magenta',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-squiggly.pdf');
    const sr = await engine.saveAs('doc-sq-solid', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    const ca = dict.get ? dict.get(PDFName.of('CA')) : undefined;
    expect(ca).toBeUndefined();
  });

  it('highlight keeps /QuadPoints, /Rect, /C, /TFlexColor geometry', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-hl-geo', path);

    const r = await engine.createAnnotation('doc-hl-geo', makePayload({
      kind: 'highlight',
      rects: [{ x: 100, y: 500, width: 200, height: 20 }],
      color: 'yellow',
      content: 'hi geo',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-highlight-geo.pdf');
    const sr = await engine.saveAs('doc-hl-geo', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    // Geometry/identity fields unchanged by the DEF-174 fix.
    expect(dict.get(PDFName.of('QuadPoints'))).toBeDefined();
    expect(dict.get(PDFName.of('Rect'))).toBeDefined();
    expect(dict.get(PDFName.of('C'))).toBeDefined();
    expect(dict.get(PDFName.of('TFlexColor'))).toBeDefined();
    // And the new translucency is present.
    expect(dict.get(PDFName.of('CA'))).toBeDefined();
  });

  it('multi-rect highlight bakes a single /CA 0.35 across all quads', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-hl-multi', path);

    const r = await engine.createAnnotation('doc-hl-multi', makePayload({
      kind: 'highlight',
      rects: [
        { x: 50, y: 700, width: 100, height: 14 },
        { x: 200, y: 700, width: 80, height: 14 },
      ],
      color: 'orange',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'def174-highlight-multi.pdf');
    const sr = await engine.saveAs('doc-hl-multi', savePath);
    expect(sr.ok).toBe(true);

    const dict = await reparseFirstAnnot(savePath);
    // QuadPoints carry all quads; exactly one /CA 0.35 applies to the whole.
    const quads = dict.get(PDFName.of('QuadPoints'));
    expect(quads).toBeDefined();
    expect((quads as any).size()).toBeGreaterThanOrEqual(16); // 2 quads * 8
    const ca = dict.get(PDFName.of('CA'));
    expect(ca).toBeDefined();
    expect((ca as any).asNumber()).toBeCloseTo(0.35, 5);
  });
});

// ---------------------------------------------------------------------------
// ADV-024/025/026/027 — annotation input validation (DEF-203..206)
// ---------------------------------------------------------------------------

describe('createAnnotation input validation (ADV-024..027)', () => {
  it('ADV-024/DEF-203: null rects does not throw a TypeError, returns engine-error', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v24', path);

    // `rects: null as any` previously passed `!== undefined` and crashed on
    // `.length`. It must now surface as a typed engine-error result.
    const r = await engine.createAnnotation('doc-v24', makePayload({
      kind: 'highlight',
      rects: null as any,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });

  it('ADV-024/DEF-203: non-array rects (e.g. an object) is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v24b', path);

    const r = await engine.createAnnotation('doc-v24b', makePayload({
      kind: 'highlight',
      rects: { x: 1, y: 2, width: 3, height: 4 } as any,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('ADV-025/DEF-204: empty rects array with no other geometry is rejected (no zero-size at 0,0)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v25', path);

    const r = await engine.createAnnotation('doc-v25', makePayload({
      kind: 'highlight',
      rects: [],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/at least one rect/i);
    }
  });

  it('ADV-025/DEF-204: missing all geometry is rejected (no zero-size fallback)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v25b', path);

    const r = await engine.createAnnotation('doc-v25b', makePayload({
      kind: 'highlight',
      rects: undefined,
      rect: undefined,
      at: undefined,
      from: undefined,
      to: undefined,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/at least one rect/i);
    }
  });

  it('ADV-026/DEF-205: NaN rect coordinate is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v26a', path);

    const r = await engine.createAnnotation('doc-v26a', makePayload({
      kind: 'rect',
      rects: [{ x: Number.NaN, y: 100, width: 50, height: 50 }],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/finite non-negative/i);
    }
  });

  it('ADV-026/DEF-205: Infinity rect dimension is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v26b', path);

    const r = await engine.createAnnotation('doc-v26b', makePayload({
      kind: 'rect',
      rects: [{ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 50 }],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/finite non-negative/i);
    }
  });

  it('ADV-026/DEF-205: negative rect coordinate is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v26c', path);

    const r = await engine.createAnnotation('doc-v26c', makePayload({
      kind: 'rect',
      rects: [{ x: -10, y: 100, width: 50, height: 50 }],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/finite non-negative/i);
    }
  });

  it('ADV-026/DEF-205: zero-size rect (width 0) is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v26d', path);

    const r = await engine.createAnnotation('doc-v26d', makePayload({
      kind: 'rect',
      rects: [{ x: 100, y: 100, width: 0, height: 50 }],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/positive width and height/i);
    }
  });

  it('ADV-026/DEF-205: NaN point in arrow endpoints is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v26e', path);

    const r = await engine.createAnnotation('doc-v26e', makePayload({
      kind: 'arrow',
      from: { x: Number.NaN, y: 100 },
      to: { x: 200, y: 200 },
      color: 'red',
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/finite non-negative/i);
    }
  });

  it('ADV-027/DEF-206: undefined color is rejected, not defaulted to yellow', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v27a', path);

    const r = await engine.createAnnotation('doc-v27a', makePayload({
      kind: 'text-box',
      color: undefined as any,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/Invalid annotation color/i);
    }
  });

  it('ADV-027/DEF-206: empty-string color is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v27b', path);

    const r = await engine.createAnnotation('doc-v27b', makePayload({
      kind: 'text-box',
      color: '',
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/Invalid annotation color/i);
    }
  });

  it('ADV-027/DEF-206: a malformed hex is rejected (not silently snapped)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-v27c', path);

    const r = await engine.createAnnotation('doc-v27c', makePayload({
      kind: 'text-box',
      color: '#gggggg',
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/Invalid annotation color/i);
    }
  });

  // Regression guards: valid inputs still create successfully.
  it('valid named color + valid rects still creates (no regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-vok', path);

    const r = await engine.createAnnotation('doc-vok', makePayload({
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 150, height: 100 }],
      color: 'red',
    }));
    expect(r.ok).toBe(true);
  });

  it('valid custom hex color still creates (no regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-vok2', path);

    const r = await engine.createAnnotation('doc-vok2', makePayload({
      kind: 'text-box',
      color: '#1a2b3c',
    }));
    expect(r.ok).toBe(true);
  });

  it('note kind with only `at` still creates a 24x24 rect (no regression)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-vok3', path);

    const r = await engine.createAnnotation('doc-vok3', makePayload({
      kind: 'note',
      at: { x: 100, y: 100 },
      color: 'yellow',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ann = getAnns(r.value).find((a: any) => a.kind === 'note') as any;
      expect(ann.rects[0].width).toBe(24);
      expect(ann.rects[0].height).toBe(24);
    }
  });
});

// ---------------------------------------------------------------------------
// Pen tool (freehand ink): the renderer commits an ink payload with ONLY
// `points` + `width` (no rect/rects/at/from/to) — see AnnotationOverlay's
// ink commit. The engine must derive the /Rect bbox from the stroke extent.
// ---------------------------------------------------------------------------

describe('Pen tool: points-only ink payload (renderer wire shape)', () => {
  const inkPoints = [
    { x: 100, y: 100 },
    { x: 150, y: 140 },
    { x: 200, y: 90 },
    { x: 260, y: 130 },
  ];

  function inkPayload(overrides?: Partial<CreateAnnotationPayload>): CreateAnnotationPayload {
    return {
      id: `ann-ink-${Math.random().toString(36).slice(2, 10)}`,
      kind: 'ink',
      page: 1,
      color: 'red',
      points: inkPoints,
      width: 2,
      ...overrides,
    };
  }

  it('creates a points-only ink annotation (no rect/rects in payload)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ink-a', path);

    const r = await engine.createAnnotation('doc-ink-a', inkPayload());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ann = getAnns(r.value).find((a: any) => a.kind === 'ink') as any;
      expect(ann).toBeDefined();
      // bbox derived from the stroke extent: x 100..260, y 90..140
      expect(ann.rects[0]).toEqual({ x: 100, y: 90, width: 160, height: 50 });
      expect(ann.points.length).toBe(4);
      expect(ann.width).toBe(2);
    }
  });

  it('points-only ink survives save-load round-trip (InkList reparses)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ink-b', path);

    const r = await engine.createAnnotation('doc-ink-b', inkPayload());
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'rt-ink.pdf');
    const s = await engine.saveAs('doc-ink-b', savePath);
    expect(s.ok).toBe(true);
    await engine.loadDocument('doc-ink-b-reloaded', savePath);

    const state = await engine.getState('doc-ink-b-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns.length).toBe(1);
      expect(anns[0].kind).toBe('ink');
      const ann = anns[0] as any;
      expect(ann.points.length).toBe(4);
      expect(ann.width).toBe(2);
      // bbox from the parsed /Rect (stroke extent, flipped back to top-left)
      expect(ann.rects[0]).toEqual({ x: 100, y: 90, width: 160, height: 50 });
    }
  });

  it("kind:'pen' is not in the AnnKind contract — rejected at create, not at save", async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ink-c', path);

    const r = await engine.createAnnotation('doc-ink-c', inkPayload({ kind: 'pen' as any }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/unknown annotation kind: pen/i);
    }
  });

  it('ink with a single point is rejected (renderer MIN_INK_POINTS = 2)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ink-d', path);

    const r = await engine.createAnnotation('doc-ink-d', inkPayload({ points: [{ x: 10, y: 10 }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/at least two points/i);
    }
  });

  it('ink with a NaN point is rejected', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-ink-e', path);

    const r = await engine.createAnnotation('doc-ink-e', inkPayload({
      points: [{ x: 10, y: 10 }, { x: Number.NaN, y: 20 }],
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/finite non-negative/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — annotation text style fields (textbox/callout/note)
// ---------------------------------------------------------------------------

/** Decode a stream object's content bytes to latin1 text, inflating if the
 *  stream is Flate-encoded (pdf-lib may compress on save). */
function decodeStreamText(doc: PDFDocument, streamObj: unknown): string {
  let obj = streamObj;
  if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
  if (!(obj instanceof PDFStream)) return '';
  const raw = (obj as PDFRawStream).contents as unknown as Uint8Array;
  if (!raw || typeof raw.length !== 'number') return '';
  try {
    return new TextDecoder('latin1').decode(inflateSync(raw));
  } catch {
    try {
      return new TextDecoder('latin1').decode(raw);
    } catch {
      return '';
    }
  }
}

interface FreeTextAppearance {
  apText: string;
  baseFonts: string[];
  da?: string;
  contents?: string;
}

/** Read page-0's FreeText annotation appearance + font resources + /Contents
 *  from a saved file. Returns undefined when no FreeText annotation exists. */
async function readFreeTextAppearance(savePath: string): Promise<FreeTextAppearance | undefined> {
  const buf = await readFile(savePath);
  const doc = await PDFDocument.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const page = doc.getPage(0);
  const leaf = (page as any).node as PDFDict;
  const annotsRef = leaf.get(PDFName.of('Annots'));
  let annots: unknown = annotsRef;
  if (annotsRef instanceof PDFRef) annots = doc.context.lookup(annotsRef);
  if (!(annots instanceof PDFArray)) return undefined;
  for (let j = 0; j < annots.size(); j++) {
    let obj: unknown = annots.get(j);
    if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
    if (!(obj instanceof PDFDict)) continue;
    const st = obj.get(PDFName.of('Subtype'));
    if (!(st instanceof PDFName) || st.asString().slice(1) !== 'FreeText') continue;

    let apText = '';
    const baseFonts: string[] = [];
    const ap = obj.get(PDFName.of('AP'));
    if (ap instanceof PDFDict) {
      const n = ap.get(PDFName.of('N'));
      apText = decodeStreamText(doc, n);
      let nObj: unknown = n;
      if (n instanceof PDFRef) nObj = doc.context.lookup(n);
      const nDict = nObj instanceof PDFStream ? nObj.dict : nObj instanceof PDFDict ? nObj : undefined;
      if (nDict !== undefined) {
        const res = nDict.get(PDFName.of('Resources'));
        let resObj: unknown = res;
        if (res instanceof PDFRef) resObj = doc.context.lookup(res);
        if (resObj instanceof PDFDict) {
          const font = resObj.get(PDFName.of('Font'));
          let fontObj: unknown = font;
          if (font instanceof PDFRef) fontObj = doc.context.lookup(font);
          if (fontObj instanceof PDFDict) {
            for (const [, v] of fontObj.entries()) {
              let vo: unknown = v;
              if (vo instanceof PDFRef) vo = doc.context.lookup(vo);
              if (vo instanceof PDFDict) {
                const bf = vo.get(PDFName.of('BaseFont'));
                if (bf instanceof PDFName) baseFonts.push(bf.asString().replace(/^\//, ''));
              }
            }
          }
        }
      }
    }
    const daRaw = obj.get(PDFName.of('DA'));
    const da = daRaw && typeof (daRaw as any).decodeText === 'function'
      ? (daRaw as any).decodeText()
      : undefined;
    const conRaw = obj.get(PDFName.of('Contents'));
    const contents = conRaw && typeof (conRaw as any).decodeText === 'function'
      ? (conRaw as any).decodeText()
      : undefined;
    return { apText, baseFonts, da, contents };
  }
  return undefined;
}

function styledPayload(
  overrides?: Partial<CreateAnnotationPayload>,
): CreateAnnotationPayload {
  return makePayload({
    kind: 'text-box',
    rects: [{ x: 80, y: 600, width: 240, height: 80 }],
    content: 'Styled text',
    ...overrides,
  });
}

describe('Phase 24 — annotation text style fields', () => {
  it('(a) createAnnotation preserves validated style fields on the model', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24a', path);

    const r = await engine.createAnnotation('doc-p24a', styledPayload({
      style: {
        bold: true,
        align: 'center',
        lineHeight: 1.8,
        highlight: { r: 1, g: 0, b: 0 },
      },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ann = getAnns(r.value).find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toEqual({
        bold: true,
        align: 'center',
        lineHeight: 1.8,
        highlight: { r: 1, g: 0, b: 0 },
      });
    }
  });

  it('(b) editAnnotation merges a partial style patch onto the stored style', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24b', path);

    const created = await engine.createAnnotation('doc-p24b', styledPayload({
      id: 'style-merge-1',
      style: { bold: true, align: 'left', lineHeight: 2 },
    }));
    expect(created.ok).toBe(true);

    const edited = await engine.editAnnotation('doc-p24b', 'style-merge-1', {
      style: { align: 'right', underline: true },
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const ann = getAnns(edited.value).find((a: any) => a.id === 'style-merge-1');
      expect(ann?.style).toEqual({
        bold: true,
        align: 'right',
        lineHeight: 2,
        underline: true,
      });
    }
  });

  it('(c) a malformed style is rejected with a typed engine-error (create + edit)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24c', path);

    const badCreate = await engine.createAnnotation('doc-p24c', styledPayload({
      style: { lineHeight: 99 } as any,
    }));
    expect(badCreate.ok).toBe(false);
    if (!badCreate.ok) {
      expect(badCreate.error.code).toBe('engine-error');
      expect(badCreate.error.message).toMatch(/lineHeight/i);
    }

    await engine.createAnnotation('doc-p24c', styledPayload({ id: 'style-bad-edit' }));
    const badEdit = await engine.editAnnotation('doc-p24c', 'style-bad-edit', {
      style: { align: 'diagonal' } as any,
    });
    expect(badEdit.ok).toBe(false);
    if (!badEdit.ok) {
      expect(badEdit.error.code).toBe('engine-error');
      expect(badEdit.error.message).toMatch(/align/i);
    }
  });

  it('(d) an absent style keeps the legacy Helvetica 12 appearance', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24d', path);

    const r = await engine.createAnnotation('doc-p24d', styledPayload({
      rects: [{ x: 80, y: 600, width: 240, height: 60 }],
      content: 'Legacy box',
    }));
    expect(r.ok).toBe(true);
    const ann = r.ok ? getAnns(r.value).find((a: any) => a.kind === 'text-box') : undefined;
    expect(ann?.style).toBeUndefined();

    const savePath = join(dir, 'p24-legacy.pdf');
    const save = await engine.saveAs('doc-p24d', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    expect(info!.apText).toMatch(/\/Helv 12 Tf/);
    expect(info!.baseFonts).toContain('Helvetica');
    // No sentinel on a legacy annotation's /Contents.
    expect(info!.contents ?? '').not.toMatch(/^TFLEX-STYLE /);
  });

  it('(e) style survives save + reparse via the /Contents sentinel', async () => {
    const style = {
      bold: true,
      italic: true,
      underline: true,
      align: 'center',
      lineHeight: 1.9,
      baselineShift: 4,
      list: 'bullet',
      indent: 12,
      highlight: { r: 0, g: 1, b: 0 },
    } as const;
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24e', path);
    const created = await engine.createAnnotation('doc-p24e', styledPayload({
      id: 'style-roundtrip-1',
      content: 'Round trip text',
      style,
    }));
    expect(created.ok).toBe(true);

    const savePath = join(dir, 'p24-roundtrip.pdf');
    const save = await engine.saveAs('doc-p24e', savePath);
    expect(save.ok).toBe(true);

    // The sentinel is written as the FIRST line of /Contents.
    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    const firstLine = (info!.contents ?? '').split('\n')[0];
    expect(firstLine).toMatch(/^TFLEX-STYLE /);

    // Reopen: the engine restores the style and strips the sentinel.
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-p24e-reopen', savePath);
    const st = await engine2.getState('doc-p24e-reopen');
    expect(st.ok).toBe(true);
    if (st.ok) {
      const ann = (st.value as any).annotations.find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toEqual(style);
      expect(ann?.content).toBe('Round trip text');
    }
  });

  it('(f) the /AP stream uses the stored bold+italic font variant and size', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24f', path);

    const r = await engine.createAnnotation('doc-p24f', styledPayload({
      rects: [{ x: 80, y: 600, width: 240, height: 80 }],
      content: 'Bold italic',
      style: { bold: true, italic: true },
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'p24-variant.pdf');
    const save = await engine.saveAs('doc-p24f', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    // Bold+italic resolves the StandardFont variant, embedded at /Helv.
    expect(info!.baseFonts).toContain('Helvetica-BoldOblique');
    // Font size operator reflects the fitted size (12pt in a tall box).
    expect(info!.apText).toMatch(/\/Helv 12 Tf/);
    expect(info!.apText).toMatch(/Tj/);
  });

  // Phase 24 follow-up — the font-family picker + size stepper were dead
  // controls until `font`/`size` joined the annotation text-style contract.
  it('(g) font + size persist in the sentinel, reparse, and drive the /AP variant', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24g', path);

    const created = await engine.createAnnotation('doc-p24g', styledPayload({
      id: 'style-font-size-1',
      rects: [{ x: 80, y: 600, width: 240, height: 80 }],
      content: 'Times eighteen',
      style: { font: 'Times', size: 18, bold: true, italic: true },
    }));
    expect(created.ok).toBe(true);
    if (created.ok) {
      const ann = getAnns(created.value).find((a: any) => a.id === 'style-font-size-1');
      expect(ann?.style).toEqual({ font: 'Times', size: 18, bold: true, italic: true });
    }

    const savePath = join(dir, 'p24-font-size.pdf');
    const save = await engine.saveAs('doc-p24g', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();

    // The /Contents sentinel JSON carries BOTH new fields.
    const firstLine = (info!.contents ?? '').split('\n')[0];
    expect(firstLine).toMatch(/^TFLEX-STYLE /);
    const decoded = JSON.parse(
      Buffer.from(firstLine.slice('TFLEX-STYLE '.length), 'base64url').toString('utf8'),
    );
    expect(decoded).toMatchObject({ font: 'Times', size: 18 });

    // The /AP stream embeds the Times bold+italic StandardFont and starts the
    // auto-fit from the stored 18pt (one short line in a tall box -> no shrink).
    expect(info!.baseFonts).toContain('Times-BoldItalic');
    expect(info!.apText).toMatch(/\/Helv 18 Tf/);
    expect(info!.apText).toMatch(/Tj/);

    // Reopen restores both fields through the sentinel.
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-p24g-reopen', savePath);
    const st = await engine2.getState('doc-p24g-reopen');
    expect(st.ok).toBe(true);
    if (st.ok) {
      // Parse-on-load assigns fresh uuids, so locate the annotation by kind.
      const ann = (st.value as any).annotations.find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toMatchObject({ font: 'Times', size: 18 });
      expect(ann?.content).toBe('Times eighteen');
    }
  });

  it('(h) an unsupported font or out-of-range size rejects create + edit', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24h', path);

    const badFont = await engine.createAnnotation('doc-p24h', styledPayload({
      style: { font: 'Comic Sans' } as any,
    }));
    expect(badFont.ok).toBe(false);
    if (!badFont.ok) {
      expect(badFont.error.code).toBe('engine-error');
      expect(badFont.error.message).toMatch(/font/i);
    }

    const badSize = await engine.createAnnotation('doc-p24h', styledPayload({
      style: { size: 5000 },
    }));
    expect(badSize.ok).toBe(false);
    if (!badSize.ok) {
      expect(badSize.error.code).toBe('engine-error');
      expect(badSize.error.message).toMatch(/size/i);
    }

    await engine.createAnnotation('doc-p24h', styledPayload({ id: 'style-bad-font-edit' }));
    const badEdit = await engine.editAnnotation('doc-p24h', 'style-bad-font-edit', {
      style: { size: -1 } as any,
    });
    expect(badEdit.ok).toBe(false);
    if (!badEdit.ok) {
      expect(badEdit.error.code).toBe('engine-error');
      expect(badEdit.error.message).toMatch(/size/i);
    }
  });

  it('(i) editAnnotation merges a font + size patch onto the stored style', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24i', path);

    const created = await engine.createAnnotation('doc-p24i', styledPayload({
      id: 'style-font-merge-1',
      style: { font: 'Courier', size: 9, bold: true },
    }));
    expect(created.ok).toBe(true);

    const edited = await engine.editAnnotation('doc-p24i', 'style-font-merge-1', {
      style: { size: 14 },
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const ann = getAnns(edited.value).find((a: any) => a.id === 'style-font-merge-1');
      expect(ann?.style).toEqual({ font: 'Courier', size: 14, bold: true });
    }
  });

  // A highlight band is a filled rectangle op (`<r> <g> <b> rg` -> `re` -> `f`)
  // drawn BEFORE the glyphs; the black text op is `0 0 0 rg` followed by `Tm`.
  const RED_BAND = /1 0 0 rg\n[^\n]+ re\nf/;

  it('(j) highlight: null is accepted and removes the stored band (others preserved)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24j', path);

    const created = await engine.createAnnotation('doc-p24j', styledPayload({
      id: 'style-clear-hl-1',
      content: 'Clear the band',
      style: { bold: true, highlight: { r: 1, g: 0, b: 0 } },
    }));
    expect(created.ok).toBe(true);

    const beforePath = join(dir, 'p24-clear-hl-before.pdf');
    expect((await engine.saveAs('doc-p24j', beforePath)).ok).toBe(true);
    const before = await readFreeTextAppearance(beforePath);
    expect(before).toBeDefined();
    expect(before!.apText).toMatch(RED_BAND);

    // The panel's "None" / clear-highlight button sends `highlight: null`.
    const edited = await engine.editAnnotation('doc-p24j', 'style-clear-hl-1', {
      style: { highlight: null },
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const ann = getAnns(edited.value).find((a: any) => a.id === 'style-clear-hl-1');
      // Only the band is cleared (stored as an explicit null removal); the
      // sibling bold field survives the merge.
      expect(ann?.style).toEqual({ bold: true, highlight: null });
    }

    const afterPath = join(dir, 'p24-clear-hl-after.pdf');
    expect((await engine.saveAs('doc-p24j', afterPath)).ok).toBe(true);
    const after = await readFreeTextAppearance(afterPath);
    expect(after).toBeDefined();
    expect(after!.apText).not.toMatch(RED_BAND);
    expect(after!.apText).toMatch(/Tj/);

    // The null removal survives save + reopen via the /Contents sentinel.
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-p24j-reopen', afterPath);
    const st = await engine2.getState('doc-p24j-reopen');
    expect(st.ok).toBe(true);
    if (st.ok) {
      const ann = (st.value as any).annotations.find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toEqual({ bold: true, highlight: null });
    }
  });

  it('(k) a colour highlight still draws the band on the /AP stream', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24k', path);

    const created = await engine.createAnnotation('doc-p24k', styledPayload({
      id: 'style-color-hl-1',
      content: 'Banded text',
      style: { highlight: { r: 1, g: 0, b: 0 } },
    }));
    expect(created.ok).toBe(true);

    const savePath = join(dir, 'p24-color-hl.pdf');
    expect((await engine.saveAs('doc-p24k', savePath)).ok).toBe(true);
    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    expect(info!.apText).toMatch(RED_BAND);
  });

  it('(l) DEF-255: clearing a highlight survives save after a REOPEN (no duplicate)', async () => {
    // The bug only reproduced when the file being saved ALREADY carried TFlex
    // annotations: `copyPages` carried the previous /Annots onto the output
    // page and `serializeAnnotation` appended a second dictionary, so the
    // stale copy's red /AP band and sentinel came back on reopen.
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p24l', path);

    const created = await engine.createAnnotation('doc-p24l', styledPayload({
      id: 'style-reopen-hl-1',
      content: 'Reopen then clear',
      style: { font: 'Times', size: 18, bold: true, highlight: { r: 1, g: 0, b: 0 } },
    }));
    expect(created.ok).toBe(true);

    // Cycle 1: save the banded annotation, then "close and reopen" it.
    const firstPath = join(dir, 'p24-reopen-1.pdf');
    expect((await engine.saveAs('doc-p24l', firstPath)).ok).toBe(true);

    const engine2 = new EngineService();
    expect((await engine2.loadDocument('doc-p24l-reopen', firstPath)).ok).toBe(true);
    const reopenedState = await engine2.getState('doc-p24l-reopen');
    expect(reopenedState.ok).toBe(true);
    if (!reopenedState.ok) return;
    const reopened = getAnns(reopenedState.value).find((a: any) => a.kind === 'text-box');
    expect(reopened).toBeDefined();
    expect((reopened as any).style.highlight).toEqual({ r: 1, g: 0, b: 0 });

    // Clear the highlight on the REOPENED annotation (parsed id, not the
    // create-time id) and assert the stored model carries a strict null.
    const edited = await engine2.editAnnotation('doc-p24l-reopen', (reopened as any).id, {
      style: { highlight: null },
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      const ann = getAnns(edited.value).find((a: any) => a.kind === 'text-box') as any;
      expect(ann).toBeDefined();
      expect('highlight' in ann.style).toBe(true);
      expect(ann.style.highlight).toBeNull();
    }

    // Cycle 2: save the cleared annotation and reopen it again.
    const secondPath = join(dir, 'p24-reopen-2.pdf');
    expect((await engine2.saveAs('doc-p24l-reopen', secondPath)).ok).toBe(true);

    const engine3 = new EngineService();
    expect((await engine3.loadDocument('doc-p24l-reopen-2', secondPath)).ok).toBe(true);
    const finalState = await engine3.getState('doc-p24l-reopen-2');
    expect(finalState.ok).toBe(true);
    if (finalState.ok) {
      const boxes = getAnns(finalState.value).filter((a: any) => a.kind === 'text-box');
      // Exactly ONE text box: the fix makes serialize replace, not append.
      expect(boxes.length).toBe(1);
      expect((boxes[0] as any).style.highlight).toBeNull();
    }

    // The saved appearance stream no longer paints the red band.
    const finalAp = await readFreeTextAppearance(secondPath);
    expect(finalAp).toBeDefined();
    expect(finalAp!.apText).not.toMatch(RED_BAND);
  });
});

// ---------------------------------------------------------------------------
// Phase 27 — character spacing on annotation text objects. The FreeText /AP
// stream is built by the SAME shared renderer as the text-box bake, so a
// non-zero `charSpacing` inherits automatically as a `Tc` operator; the value
// also round-trips through the `TFLEX-STYLE` /Contents sentinel.
// ---------------------------------------------------------------------------

describe('Phase 27 — annotation character spacing', () => {
  it('an annotation style with charSpacing bakes Tc into the /AP stream and survives reparse', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p27a', path);

    const created = await engine.createAnnotation('doc-p27a', styledPayload({
      id: 'style-charspacing-1',
      content: 'Spaced out',
      style: { charSpacing: 5 },
    }));
    expect(created.ok).toBe(true);
    if (created.ok) {
      const ann = getAnns(created.value).find((a: any) => a.id === 'style-charspacing-1');
      expect(ann?.style).toEqual({ charSpacing: 5 });
    }

    const savePath = join(dir, 'p27-ann-spacing.pdf');
    const save = await engine.saveAs('doc-p27a', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    // The shared renderer emitted Tc inside the /AP text object.
    expect(info!.apText).toMatch(/(?:^|\s)5 Tc(?:\s|$)/);
    expect(info!.apText).toMatch(/BT/);
    expect(info!.apText).toMatch(/Tj/);

    // The sentinel carries the field.
    const firstLine = (info!.contents ?? '').split('\n')[0];
    expect(firstLine).toMatch(/^TFLEX-STYLE /);
    const decoded = JSON.parse(
      Buffer.from(firstLine.slice('TFLEX-STYLE '.length), 'base64url').toString('utf8'),
    );
    expect(decoded).toMatchObject({ charSpacing: 5 });

    // Reopen restores it.
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-p27a-reopen', savePath);
    const st = await engine2.getState('doc-p27a-reopen');
    expect(st.ok).toBe(true);
    if (st.ok) {
      const ann = (st.value as any).annotations.find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toMatchObject({ charSpacing: 5 });
    }
  });

  it('a default annotation appearance emits no Tc', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p27b', path);
    await engine.createAnnotation('doc-p27b', styledPayload({
      id: 'style-charspacing-default',
      content: 'Plain text',
      style: { bold: true },
    }));
    const savePath = join(dir, 'p27-ann-default.pdf');
    await engine.saveAs('doc-p27b', savePath);
    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    expect(info!.apText).not.toMatch(/(?:^|\s)[\d.-]+ Tc(?:\s|$)/);
  });

  it('rejects an out-of-range annotation charSpacing with a typed engine-error', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p27c', path);
    const bad = await engine.createAnnotation('doc-p27c', styledPayload({
      style: { charSpacing: 21 } as any,
    }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toContain('charSpacing must be a finite number in -5..20');
  });
});
// ---------------------------------------------------------------------------
// Phase 27 — a bundled font family round-trips for a FreeText annotation and
// drives its baked /AP appearance (resource name + BaseFont).
// ---------------------------------------------------------------------------

describe('Phase 27 - annotation bundled font families', () => {
  it('round-trips a bundled family through the sentinel and the /AP', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p27ann', path);

    const created = await engine.createAnnotation('doc-p27ann', styledPayload({
      id: 'p27-font-ann',
      content: 'Bundled serif',
      style: { font: 'DejaVu Serif', size: 14 },
    }));
    expect(created.ok).toBe(true);
    if (created.ok) {
      const ann = getAnns(created.value).find((a: any) => a.id === 'p27-font-ann');
      expect(ann?.style).toEqual({ font: 'DejaVu Serif', size: 14 });
    }

    const savePath = join(dir, 'p27-ann-font.pdf');
    const save = await engine.saveAs('doc-p27ann', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();

    // The /Contents sentinel JSON carries the bundled family verbatim.
    const firstLine = (info!.contents ?? '').split('\n')[0];
    expect(firstLine).toMatch(/^TFLEX-STYLE /);
    const decoded = JSON.parse(
      Buffer.from(firstLine.slice('TFLEX-STYLE '.length), 'base64url').toString('utf8'),
    );
    expect(decoded).toMatchObject({ font: 'DejaVu Serif', size: 14 });

    // The /AP declares the embedded font (resource key = the font's own name)
    // and names the same resource in its `Tf` operator; the /DA agrees.
    expect(info!.baseFonts).toContain('TFlexDejaVuSerif');
    expect(info!.apText).toMatch(/(^|\n)\/DejaVuSerif 14 Tf/);
    expect(info!.apText).not.toContain('//DejaVuSerif');
    expect(info!.da).toBe('/DejaVuSerif 12 Tf 0 0 0 rg');

    // Reopen restores the family through the sentinel.
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-p27ann-2', savePath);
    const st = await engine2.getState('doc-p27ann-2');
    expect(st.ok).toBe(true);
    if (st.ok) {
      const ann = (st.value as any).annotations.find((a: any) => a.kind === 'text-box');
      expect(ann?.style).toMatchObject({ font: 'DejaVu Serif', size: 14 });
    }
  });

  it('a standard family keeps the legacy /Helv appearance resource', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-p27std', path);
    const created = await engine.createAnnotation('doc-p27std', styledPayload({
      content: 'Standard family',
      style: { font: 'Courier' },
    }));
    expect(created.ok).toBe(true);

    const savePath = join(dir, 'p27-ann-std.pdf');
    const save = await engine.saveAs('doc-p27std', savePath);
    expect(save.ok).toBe(true);

    const info = await readFreeTextAppearance(savePath);
    expect(info).toBeDefined();
    expect(info!.baseFonts).toContain('Courier');
    expect(info!.apText).toMatch(/(^|\n)\/Helv 12 Tf/);
    expect(info!.apText).not.toContain('//Helv');
    expect(info!.da).toBe('/Helv 12 Tf 0 0 0 rg');
  });
});

// ---------------------------------------------------------------------------
// Phase 28 (criterion 4) — stable annotation ids persisted in /NM
// ---------------------------------------------------------------------------

/** Register one raw annotation dict on page 0, optionally carrying /NM. */
function addRawAnnot(doc: PDFDocument, nm: unknown): void {
  const entries: Record<string, unknown> = {
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: [72, 72, 272, 122],
    Contents: PDFString.of('raw'),
  };
  if (nm !== undefined) entries.NM = nm;
  const ref = doc.context.register(doc.context.obj(entries as any));
  (doc.getPage(0).node as any).addAnnot(ref);
}

/** First raw annotation dict on page 0 of a parsed PDF. */
function firstRawAnnot(doc: PDFDocument): any {
  const leaf: any = (doc.getPage(0) as any).node;
  const ref = leaf.get(PDFName.of('Annots'));
  const arr = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
  const aRef = (arr as PDFArray).get(0);
  return aRef instanceof PDFRef ? doc.context.lookup(aRef) : aRef;
}

describe('Phase 28 (criterion 4) — annotation id persists in /NM', () => {
  it('(a) create -> save -> reparse returns the SAME annotation id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-nm-a', path);
    const created = await engine.createAnnotation('doc-nm-a', makePayload({ id: 'stable-id-abc' }));
    expect(created.ok).toBe(true);

    const savePath = join(dir, 'nm-a.pdf');
    expect((await engine.saveAs('doc-nm-a', savePath)).ok).toBe(true);

    const buf = await readFile(savePath);
    const rawDoc = await PDFDocument.load(buf);
    const nm = firstRawAnnot(rawDoc).get(PDFName.of('NM'));
    expect(nm).toBeInstanceOf(PDFString);
    expect((nm as PDFString).decodeText()).toBe('stable-id-abc');

    const reparsed = parseAnnotationsFromDoc(rawDoc);
    expect(reparsed[0]).toHaveLength(1);
    expect(reparsed[0][0].id).toBe('stable-id-abc');
  });

  it('(c) a legacy annotation with no /NM loads with a fresh id and does not throw', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    addRawAnnot(doc, undefined);
    const path = await writeFixture('nm-legacy.pdf', await doc.save());

    const rawDoc = await PDFDocument.load(await readFile(path));
    const reparsed = parseAnnotationsFromDoc(rawDoc);
    expect(reparsed[0]).toHaveLength(1);
    const id = reparsed[0][0].id;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const engine = new EngineService();
    const load = await engine.loadDocument('doc-nm-c', path);
    expect(load.ok).toBe(true);
    const state = await engine.getState('doc-nm-c');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      expect(anns).toHaveLength(1);
      // A fresh random id is assigned (no /NM to read); each load gets its own.
      expect(typeof anns[0].id).toBe('string');
      expect((anns[0].id as string).length).toBeGreaterThan(0);
      expect(anns[0].id).not.toBe(id);
    }
  });

  it('(d) hostile /NM (non-string / empty / oversized) falls back to a fresh id without throwing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    addRawAnnot(doc, PDFName.of('NotAString'));
    addRawAnnot(doc, PDFString.of(''));
    addRawAnnot(doc, PDFString.of('z'.repeat(1000)));
    const path = await writeFixture('nm-hostile.pdf', await doc.save());

    const rawDoc = await PDFDocument.load(await readFile(path));
    const reparsed = parseAnnotationsFromDoc(rawDoc);
    expect(reparsed[0]).toHaveLength(3);
    const ids = reparsed[0].map((a) => a.id);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(256);
    }
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain('');

    const engine = new EngineService();
    expect((await engine.loadDocument('doc-nm-d', path)).ok).toBe(true);
  });

  it('(d2) a valid hex-string /NM is honoured', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    addRawAnnot(doc, PDFHexString.fromText('hex-id-42'));
    const rawDoc = await PDFDocument.load(await doc.save());
    const reparsed = parseAnnotationsFromDoc(rawDoc);
    expect(reparsed[0][0].id).toBe('hex-id-42');
  });
});

// ---------------------------------------------------------------------------
// DEF-260 — one canonical annotation colour list (shared by engine + renderer)
//
// The renderer palette and the engine's named set had drifted: pink/teal/gray
// existed only in the renderer, so picking them on an engine-backed path was a
// silent no-op. The canonical list now lives in src/shared/annotationColors.ts
// and both sides consume it. These tests pin its membership and prove the
// three previously-dropped colours are accepted on create AND edit and survive
// a save/reopen, while unknown names still fail loud.
// ---------------------------------------------------------------------------

describe('DEF-260 canonical annotation colours', () => {
  it('the canonical list has exactly 12 members with the expected names', () => {
    expect(ANNOTATION_COLOR_NAMES).toHaveLength(12);
    expect(new Set(ANNOTATION_COLOR_NAMES).size).toBe(12);
    expect([...ANNOTATION_COLOR_NAMES].sort()).toEqual(
      [
        'blue', 'cyan', 'gray', 'green', 'magenta', 'orange',
        'pink', 'purple', 'red', 'teal', 'white', 'yellow',
      ],
    );
  });

  it('the engine accepted set equals the canonical set (drift guard)', () => {
    // The engine exposes its accepted names; it must be byte-for-byte the
    // canonical list, and every canonical name must pass isValidColorValue.
    expect([...ANN_COLORS]).toEqual([...ANNOTATION_COLOR_NAMES]);
    for (const name of ANNOTATION_COLOR_NAMES) {
      expect(isValidColorValue(name)).toBe(true);
    }
    // The shared RGB record covers exactly the canonical names.
    expect(Object.keys(ANN_COLOR_RGB).sort()).toEqual([...ANNOTATION_COLOR_NAMES].sort());
    expect(Object.keys(ANN_COLOR_RGB)).toHaveLength(12);
  });

  it('pink / teal / gray carry the renderer palette RGB values', () => {
    expect(ANN_COLOR_RGB.pink[0]).toBeCloseTo(236 / 255, 10);
    expect(ANN_COLOR_RGB.pink[1]).toBeCloseTo(72 / 255, 10);
    expect(ANN_COLOR_RGB.pink[2]).toBeCloseTo(153 / 255, 10);
    expect(ANN_COLOR_RGB.teal[0]).toBeCloseTo(20 / 255, 10);
    expect(ANN_COLOR_RGB.teal[1]).toBeCloseTo(184 / 255, 10);
    expect(ANN_COLOR_RGB.teal[2]).toBeCloseTo(166 / 255, 10);
    expect(ANN_COLOR_RGB.gray[0]).toBeCloseTo(100 / 255, 10);
    expect(ANN_COLOR_RGB.gray[1]).toBeCloseTo(116 / 255, 10);
    expect(ANN_COLOR_RGB.gray[2]).toBeCloseTo(139 / 255, 10);
  });

  it('nearestAnnColor resolves each canonical RGB back to its name', () => {
    for (const name of ANNOTATION_COLOR_NAMES) {
      const [r, g, b] = ANN_COLOR_RGB[name];
      expect(nearestAnnColor(r, g, b)).toBe(name);
      expect(colorToRgb(name)).toEqual(ANN_COLOR_RGB[name]);
    }
  });

  it('create accepts pink / teal / gray (previously silently rejected)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-260-create', path);

    for (const name of ['pink', 'teal', 'gray'] as const) {
      const r = await engine.createAnnotation('doc-260-create', makePayload({
        id: `def260-${name}`,
        kind: 'rect',
        rects: [{ x: 50, y: 400, width: 120, height: 80 }],
        color: name,
      }));
      expect(r.ok, `create with ${name}`).toBe(true);
      if (r.ok) {
        const ann = getAnns(r.value).find((a: any) => a.id === `def260-${name}`);
        expect(ann?.color).toBe(name);
      }
    }
  });

  it('edit changes the engine colour to pink / teal / gray (not silently kept)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-260-edit', path);

    await engine.createAnnotation('doc-260-edit', makePayload({
      id: 'def260-edit',
      kind: 'rect',
      rects: [{ x: 50, y: 400, width: 120, height: 80 }],
      color: 'blue',
    }));

    for (const name of ['pink', 'teal', 'gray'] as const) {
      const edited = await engine.editAnnotation('doc-260-edit', 'def260-edit', { color: name });
      expect(edited.ok, `edit to ${name}`).toBe(true);
      if (edited.ok) {
        const ann = getAnns(edited.value).find((a: any) => a.id === 'def260-edit');
        expect(ann?.color).toBe(name);
      }
    }
  });

  it('pink / teal / gray survive save + reopen by name', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-260-save', path);

    for (const name of ['pink', 'teal', 'gray'] as const) {
      const r = await engine.createAnnotation('doc-260-save', makePayload({
        id: `def260-save-${name}`,
        kind: 'rect',
        rects: [{ x: 40, y: 300, width: 100, height: 60 }],
        color: name,
      }));
      expect(r.ok).toBe(true);
    }

    const savePath = join(dir, 'def260-colors.pdf');
    const saved = await engine.saveAs('doc-260-save', savePath);
    expect(saved.ok).toBe(true);
    await engine.loadDocument('doc-260-save-reloaded', savePath);

    const state = await engine.getState('doc-260-save-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = getAnns(state.value);
      for (const name of ['pink', 'teal', 'gray'] as const) {
        const ann = anns.find((a: any) => a.id === `def260-save-${name}`);
        expect(ann, `reopened ${name}`).toBeDefined();
        expect(ann?.color).toBe(name);
      }
    }
  });

  it('an unknown colour name still fails loud on create', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-260-unknown', path);

    const r = await engine.createAnnotation('doc-260-unknown', makePayload({
      kind: 'text-box',
      color: 'chartreuse' as AnnColor,
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toMatch(/Invalid annotation color/i);
    }
    expect(isValidColorValue('chartreuse')).toBe(false);
  });
});
