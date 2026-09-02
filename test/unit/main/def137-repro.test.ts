import { describe, it, expect } from 'vitest';
import { EngineService } from '../../../src/main/services/engine';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makePdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`page ${i + 1}`, { x: 72, y: 700, size: 12 });
  }
  const bytes = await doc.save();
  const path = join(tmpdir(), `def-probe-${Date.now()}-${Math.random()}.pdf`);
  await fs.writeFile(path, Buffer.from(bytes));
  return path;
}

const SAMPLE = join(process.cwd(), 'assets', 'samples', 'report.pdf');

describe('DEF-137 repro: load report.pdf, ink + rect + note, saveAs, reload', () => {
  it('saved file has /Annots and annotations list restores (report.pdf sample)', async () => {
    const engine = new EngineService();
    const r = await engine.loadDocument('doc', SAMPLE);
    if (!r.ok) {
      console.log('DEF-137 loadDocument error:', JSON.stringify(r.error));
    }
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // create ink + rect + note on page 1
    const ink = await engine.createAnnotation('doc', {
      id: 'a1', kind: 'ink', page: 1,
      color: 'purple', width: 2,
      rects: [{ x: 10, y: 10, width: 200, height: 100 }],
      points: [{ x: 20, y: 20 }, { x: 100, y: 80 }],
    } as any);
    expect(ink.ok).toBe(true);

    const rect = await engine.createAnnotation('doc', {
      id: 'a2', kind: 'rect', page: 1, color: 'blue', width: 3,
      rects: [{ x: 50, y: 400, width: 200, height: 150 }],
    } as any);
    expect(rect.ok).toBe(true);

    const note = await engine.createAnnotation('doc', {
      id: 'a3', kind: 'note', page: 1, color: 'orange', content: 'DEFECT NOTE 137',
      at: { x: 100, y: 100 },
    } as any);
    expect(note.ok).toBe(true);

    // saveAs
    const savePath = join(tmpdir(), `def137-${Date.now()}.pdf`);
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    // re-read the file: assert 3+ /Annots present
    const buf = await fs.readFile(savePath);
    const reparsed = await PDFDocument.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    let total = 0;
    const perPage: number[] = [];
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const page = reparsed.getPage(i);
      const leaf = (page as any).node;
      const annots = leaf.get(PDFName.of('Annots'));
      const cnt = annots instanceof PDFArray ? annots.size() : 0;
      perPage.push(cnt);
      total += cnt;
    }
    console.log('DEF-137 report.pdf: total /Annots across pages after saveAs:', total, 'perPage:', perPage.slice(0, 5));
    expect(total).toBeGreaterThanOrEqual(3);

    // reload via the engine and check annotations list restores
    await engine.loadDocument('doc-reloaded', savePath);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = (state.value as any).annotations as any[];
      console.log('DEF-137 report.pdf: restored annotations count after reload:', anns.length);
      expect(anns.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('saved file has /Annots and annotations list restores', async () => {
    const engine = new EngineService();
    const path = await makePdf(1);
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);

    // create ink + rect + note
    const ink = await engine.createAnnotation('doc', {
      id: 'a1', kind: 'ink', page: 1,
      color: 'purple', width: 2,
      rects: [{ x: 10, y: 10, width: 200, height: 100 }],
      points: [{ x: 20, y: 20 }, { x: 100, y: 80 }],
    } as any);
    expect(ink.ok).toBe(true);

    const rect = await engine.createAnnotation('doc', {
      id: 'a2', kind: 'rect', page: 1, color: 'blue', width: 3,
      rects: [{ x: 50, y: 400, width: 200, height: 150 }],
    } as any);
    expect(rect.ok).toBe(true);

    const note = await engine.createAnnotation('doc', {
      id: 'a3', kind: 'note', page: 1, color: 'orange', content: 'a note',
      at: { x: 100, y: 100 },
    } as any);
    expect(note.ok).toBe(true);

    // saveAs
    const savePath = join(tmpdir(), `def137-${Date.now()}.pdf`);
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    // re-read the file: assert 3+ /Annots present
    const buf = await fs.readFile(savePath);
    const reparsed = await PDFDocument.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    let total = 0;
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const page = reparsed.getPage(i);
      const leaf = (page as any).node;
      const annots = leaf.get(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        total += annots.size();
      }
    }
    console.log('DEF-137: total /Annots across pages after saveAs:', total);
    expect(total).toBeGreaterThanOrEqual(3);

    // reload via the engine and check annotations list restores
    await engine.loadDocument('doc-reloaded', savePath);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = (state.value as any).annotations as any[];
      console.log('DEF-137: restored annotations count after reload:', anns.length);
      expect(anns.length).toBeGreaterThanOrEqual(3);
    }
  });
});
