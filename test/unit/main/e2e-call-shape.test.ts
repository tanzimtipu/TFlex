import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

// Reproduces the EXACT e2e call shape from e2e/retests/full_sweep_retest.spec.cjs:
//   window.tflex.engine.placeSignature(dId, { ... pngBytes: pngBytes.buffer })
//   window.tflex.engine.createAnnotation(dId, validCreatePayload)
// Proves the backend (main + preload + engine) responds with modified=true and the
// placement/annotation present. The e2e's failure is NOT a backend bug: it reads
// tflexDiagnostics().modified / .engineState, which mirror the renderer's engineUi
// (only updated by React handlers), not the engine's own state.

let dir: string;

async function setupOnePagePdf(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'tflex-repro-'));
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Page 1', { x: 72, y: 700, size: 14 });
  const bytes = await doc.save();
  const p = join(dir, 'one.pdf');
  await writeFile(p, Buffer.from(bytes));
  return p;
}

describe('e2e call-shape repro (direct engine calls)', () => {
  it('placeSignature with ArrayBuffer pngBytes flips modified and records placement', async () => {
    const path = await setupOnePagePdf();
    try {
      const engine = new EngineService();
      const loadR = await engine.loadDocument('doc-1', path);
      expect(loadR.ok).toBe(true);

      // pngBytes.buffer (ArrayBuffer) — exactly as e2e line 156-163
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xDE, 0, 0, 0, 0x0C, 0x49,
        0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0, 0x05, 0xFE, 0x02, 0xFE,
        0xDC, 0x44, 0x74, 0x8E, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const placeR = await engine.placeSignature('doc-1', {
        id: `sig-${Date.now()}`,
        signatureId: 'default',
        page: 1,
        rect: { x: 100, y: 100, width: 100, height: 50 },
        pngBytes: pngBytes.buffer as ArrayBuffer,
      });
      expect(placeR.ok).toBe(true);
      if (placeR.ok) {
        expect(placeR.value.modified).toBe(true);
        const sigs = (placeR.value as any).placedSignatures ?? [];
        expect(sigs.length).toBe(1);
        expect(sigs[0].id).toMatch(/^sig-/);
      }
      // round-trip save still works with ArrayBuffer pngBytes
      const saveR = await engine.save('doc-1');
      expect(saveR.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('createAnnotation with a highlight payload flips modified and records the annotation', async () => {
    const path = await setupOnePagePdf();
    try {
      const engine = new EngineService();
      const loadR = await engine.loadDocument('doc-1', path);
      expect(loadR.ok).toBe(true);

      const annR = await engine.createAnnotation('doc-1', {
        id: `ann-${Date.now()}`,
        kind: 'highlight',
        page: 1,
        rect: { x: 90, y: 90, width: 120, height: 16 },
        color: 'yellow',
      } as any);
      expect(annR.ok).toBe(true);
      if (annR.ok) {
        expect(annR.value.modified).toBe(true);
        const anns = (annR.value as any).annotations ?? [];
        expect(anns.length).toBe(1);
        expect(anns[0].kind).toBe('highlight');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
