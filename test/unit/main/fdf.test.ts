import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { exportFdf, parseFdf } from '../../../src/main/services/fdf';
import type { AnnModel } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-fdf-'));
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
  const path = await writeFixture(`fdf${n}.pdf`, bytes);
  return { path, bytes };
}

describe('Phase 12: FDF export/import (pure helpers)', () => {
  it('exportFdf produces an %FDF-1.2 buffer', () => {
    const anns: AnnModel[][] = [[
      {
        id: 'a1', kind: 'text-box', page: 1,
        rects: [{ x: 10, y: 20, width: 100, height: 30 }],
        color: 'red', content: 'Hello',
      },
    ]];
    const bytes = exportFdf(anns, [0]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%FDF-1.2')).toBe(true);
    expect(text).toContain('/Annots');
    expect(text).toContain('/FreeText');
    expect(text).toContain('(Hello)');
  });

  it('parseFdf round-trips a text-box annotation', () => {
    const anns: AnnModel[][] = [[
      {
        id: 'a1', kind: 'text-box', page: 1,
        rects: [{ x: 10, y: 20, width: 100, height: 30 }],
        color: 'red', content: 'Round-trip',
      },
    ]];
    const bytes = exportFdf(anns, [0]);
    const parsed = parseFdf(bytes);
    expect(parsed.length).toBe(1);
    expect(parsed[0].kind).toBe('text-box');
    expect(parsed[0].page).toBe(1);
    expect(parsed[0].content).toBe('Round-trip');
    expect(parsed[0].color).toBe('red');
    expect(parsed[0].rects[0].x).toBe(10);
    expect(parsed[0].rects[0].width).toBe(100);
  });

  it('parseFdf maps a callout (FreeText + /Intent /FreeTextCallout)', () => {
    const anns: AnnModel[][] = [[
      {
        id: 'c1', kind: 'callout', page: 1,
        rects: [{ x: 100, y: 500, width: 200, height: 60 }],
        points: [
          { x: 50, y: 700 },
          { x: 80, y: 620 },
          { x: 100, y: 560 },
        ],
        color: 'red', content: 'callout text',
      },
    ]];
    const bytes = exportFdf(anns, [0]);
    const parsed = parseFdf(bytes);
    expect(parsed.length).toBe(1);
    expect(parsed[0].kind).toBe('callout');
    expect(parsed[0].points).toBeDefined();
    expect(parsed[0].points!.length).toBe(3);
  });

  it('parseFdf returns [] for an empty /Annots', () => {
    const bytes = exportFdf([], [0, 1]);
    expect(parseFdf(bytes).length).toBe(0);
  });

  it('parseFdf maps /Page to the visible page', () => {
    const anns: AnnModel[][] = [[], [
      {
        id: 'a2', kind: 'rect', page: 2,
        rects: [{ x: 0, y: 0, width: 50, height: 50 }],
        color: 'blue', content: 'p2',
      },
    ]];
    const bytes = exportFdf(anns, [0, 1]);
    const parsed = parseFdf(bytes);
    expect(parsed.length).toBe(1);
    expect(parsed[0].page).toBe(2);
  });
});

describe('Phase 12: engine exportFdf / importFdf', () => {
  it('exportFdf returns FDF bytes for the loaded doc', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.createAnnotation('doc-1', {
      id: 'ann-1', kind: 'text-box', page: 1,
      rects: [{ x: 10, y: 20, width: 100, height: 30 }],
      color: 'red', content: 'Comment one',
    });

    const r = await engine.exportFdf('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = new TextDecoder('latin1').decode(new Uint8Array(r.value));
      expect(text.startsWith('%FDF-1.2')).toBe(true);
      expect(text).toContain('(Comment one)');
    }
  });

  it('importFdf merges annotations into a fresh doc', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('src', path);

    await engine.createAnnotation('src', {
      id: 'ann-1', kind: 'text-box', page: 1,
      rects: [{ x: 10, y: 20, width: 100, height: 30 }],
      color: 'red', content: 'Imported comment',
    });
    await engine.createAnnotation('src', {
      id: 'ann-2', kind: 'rect', page: 2,
      rects: [{ x: 5, y: 5, width: 80, height: 80 }],
      color: 'blue', content: 'box on p2',
    });

    const exp = await engine.exportFdf('src');
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;

    // Load a fresh doc and import the FDF.
    const { path: path2 } = await createNPagePdf(2);
    await engine.loadDocument('dst', path2);
    const before = await engine.getState('dst');
    expect(before.ok && (before.value as any).annotations.length).toBe(0);

    const imp = await engine.importFdf('dst', new Uint8Array(exp.value));
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;

    const after = await engine.getState('dst');
    expect(after.ok).toBe(true);
    if (after.ok) {
      const anns = (after.value as any).annotations as AnnModel[];
      expect(anns.length).toBe(2);
      expect(anns.some((a) => a.content === 'Imported comment')).toBe(true);
      expect(anns.some((a) => a.content === 'box on p2')).toBe(true);
    }
  });

  it('importFdf is undoable', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('src', path);
    await engine.createAnnotation('src', {
      id: 'a1', kind: 'text-box', page: 1,
      rects: [{ x: 0, y: 0, width: 10, height: 10 }],
      color: 'red', content: 'x',
    });
    const exp = await engine.exportFdf('src');
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;

    const { path: p2 } = await createNPagePdf(1);
    await engine.loadDocument('dst', p2);
    await engine.importFdf('dst', new Uint8Array(exp.value));
    const u = await engine.undo('dst');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const anns = (u.value as any).annotations as AnnModel[];
      expect(anns.length).toBe(0);
    }
  });

  it('exportFdf returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.exportFdf('no-such-doc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('importFdf returns engine-error for an unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.importFdf('no-such-doc', new Uint8Array(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('importFdf returns engine-error for corrupt FDF bytes', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('dst', path);
    const r = await engine.importFdf('dst', new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });
});
