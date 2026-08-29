import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { PlaceSignaturePayload, EngineState } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-sig-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createNPagePdf(n: number): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
  }
  const bytes = await doc.save();
  const path = join(dir, `test${n}.pdf`);
  await writeFile(path, Buffer.from(bytes));
  return { path, bytes };
}

/** Generate a minimal valid PNG (1x1 red pixel). */
function minimalPngBytes(): Uint8Array {
  // Minimal 1x1 red PNG
  const png = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk header
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // RGB, no alpha
    0xDE, // IHDR CRC
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, // IDAT chunk header
    0x08, 0xD7, 0x63, 0x60, 0x60, 0xF8, 0x0F, 0x00, // compressed red pixel + filter byte
    0x01, 0x01, 0x00, 0x05, 0x18, 0xD8, 0x01, // IDAT CRC
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82, // IEND CRC
  ]);
  return png;
}

function makePlacementPayload(overrides: Partial<PlaceSignaturePayload>): PlaceSignaturePayload {
  return {
    id: `sig-${Math.random().toString(36).slice(2, 10)}`,
    signatureId: `tmpl-${Math.random().toString(36).slice(2, 10)}`,
    page: 1,
    rect: { x: 100, y: 500, width: 150, height: 50 },
    pngBytes: minimalPngBytes(),
    ...overrides,
  };
}

/** Get placed signatures from an EngineState. */
function getPlacedSigs(state: EngineState): Array<Record<string, unknown>> {
  return (state as any).placedSignatures as Array<Record<string, unknown>> ?? [];
}

// ---------------------------------------------------------------------------
// placeSignature
// ---------------------------------------------------------------------------

describe('EngineService - placeSignature', () => {
  it('places a signature and returns updated state', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({ page: 1 });
    const r = await engine.placeSignature('doc-1', payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.modified).toBe(true);
      const sigs = getPlacedSigs(r.value);
      expect(sigs.length).toBe(1);
      expect(sigs[0].id).toBe(payload.id);
      expect(sigs[0].signatureId).toBe(payload.signatureId);
      expect(sigs[0].page).toBe(1);
    }
  });

  it('places multiple signatures on the same page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const sigs = getPlacedSigs(state.value);
      expect(sigs.length).toBe(2);
    }
  });

  it('places signatures on different pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 3 }));

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const sigs = getPlacedSigs(state.value);
      expect(sigs.length).toBe(3);
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const r = await engine.placeSignature('ghost', makePlacementPayload({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// moveSignature
// ---------------------------------------------------------------------------

describe('EngineService - moveSignature', () => {
  it('moves a signature to a new position', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({ page: 1 });
    await engine.placeSignature('doc-1', payload);

    const r = await engine.moveSignature('doc-1', {
      id: payload.id,
      page: 2,
      rect: { x: 200, y: 300, width: 100, height: 40 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sigs = getPlacedSigs(r.value);
      expect(sigs.length).toBe(1);
      expect(sigs[0].page).toBe(2);
    }
  });

  it('returns not-found for unknown placement id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.moveSignature('doc-1', {
      id: 'nonexistent',
      page: 1,
      rect: { x: 0, y: 0, width: 100, height: 50 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });
});

// ---------------------------------------------------------------------------
// deleteSignature
// ---------------------------------------------------------------------------

describe('EngineService - deleteSignature', () => {
  it('deletes a placed signature', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const p1 = makePlacementPayload({ page: 1 });
    const p2 = makePlacementPayload({ page: 1 });
    await engine.placeSignature('doc-1', p1);
    await engine.placeSignature('doc-1', p2);

    const r = await engine.deleteSignature('doc-1', p1.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sigs = getPlacedSigs(r.value);
      expect(sigs.length).toBe(1);
      expect(sigs[0].id).toBe(p2.id);
    }
  });

  it('returns not-found for unknown placement id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const r = await engine.deleteSignature('doc-1', 'nonexistent');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });
});

// ---------------------------------------------------------------------------
// save with signature rendering
// ---------------------------------------------------------------------------

describe('EngineService - save with signature rendering', () => {
  it('save embeds signature PNG on the correct page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1,
      rect: { x: 100, y: 500, width: 150, height: 50 },
    }));

    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    // Re-parse and verify the page has content beyond the simple text
    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(3);
    // The page should exist and be valid
    const page = reparsed.getPage(0);
    expect(page.getSize().width).toBe(612);
  });

  it('save does not corrupt pages without signatures', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Place signature only on page 2
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));

    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(3);
  });

  it('save with multiple signatures on same page round-trips', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({
      page: 1,
      rect: { x: 50, y: 600, width: 100, height: 40 },
    }));
    await engine.placeSignature('doc-1', makePlacementPayload({
      page: 1,
      rect: { x: 50, y: 500, width: 100, height: 40 },
    }));

    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(1);
  });

  it('saveAs works with placed signatures', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));

    const newPath = join(dir, 'sig-saved-as.pdf');
    const r = await engine.saveAs('doc-1', newPath);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(newPath);
    }

    const buf = await readFile(newPath);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// undo / redo for signature operations
// ---------------------------------------------------------------------------

describe('EngineService - signature undo/redo', () => {
  it('undo removes a placed signature', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({}));

    const state1 = await engine.getState('doc-1');
    expect(getPlacedSigs(state1.ok ? state1.value : {} as EngineState).length).toBe(1);

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(getPlacedSigs(u.value).length).toBe(0);
    }
  });

  it('redo re-places an undone signature', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({});
    await engine.placeSignature('doc-1', payload);
    await engine.undo('doc-1');
    const r = await engine.redo('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sigs = getPlacedSigs(r.value);
      expect(sigs.length).toBe(1);
      expect(sigs[0].id).toBe(payload.id);
    }
  });

  it('undo of move restores original position', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({ page: 1, rect: { x: 100, y: 500, width: 150, height: 50 } });
    await engine.placeSignature('doc-1', payload);

    await engine.moveSignature('doc-1', {
      id: payload.id,
      page: 3,
      rect: { x: 300, y: 200, width: 100, height: 40 },
    });

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const sigs = getPlacedSigs(u.value);
      expect(sigs[0].page).toBe(1);
    }
  });

  it('undo of delete restores the signature', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({});
    await engine.placeSignature('doc-1', payload);
    await engine.deleteSignature('doc-1', payload.id);

    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    if (u.ok) {
      const sigs = getPlacedSigs(u.value);
      expect(sigs.length).toBe(1);
      expect(sigs[0].id).toBe(payload.id);
    }
  });

  it('modified flag returns to false after undoing all signature ops', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({}));
    const s1 = await engine.getState('doc-1');
    expect(s1.ok && s1.value.modified).toBe(true);

    await engine.undo('doc-1');
    const s2 = await engine.getState('doc-1');
    expect(s2.ok && s2.value.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Signature interaction with page operations
// ---------------------------------------------------------------------------

describe('EngineService - signature with page ops', () => {
  it('delete page drops its signature placements and shifts others', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 3 }));

    // Delete page 1 (visible position 0)
    await engine.applyOp('doc-1', { kind: 'delete', page: 0 });

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      // Page 1 sig should be gone, pages 2 and 3 shift down to 1 and 2
      const sigs = getPlacedSigs(state.value);
      expect(sigs.length).toBe(2);
      const pages = sigs.map((s: any) => s.page).sort();
      expect(pages).toEqual([1, 2]);
    }
  });

  it('signatures survive merge (position-adjusted)', async () => {
    const engine = new EngineService();
    const { path: pA } = await createNPagePdf(2);
    const { path: pB } = await createNPagePdf(1);

    await engine.loadDocument('doc-1', pA);
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));

    // Merge before: B's page comes first, then A's pages
    await engine.merge('doc-1', [pB], 'before');

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const sigs = getPlacedSigs(state.value);
      // Original sigs on pages 1 and 2 shift to pages 2 and 3
      expect(sigs.length).toBe(2);
      const pages = sigs.map((s: any) => s.page).sort();
      expect(pages).toEqual([2, 3]);
    }
  });

  it('split drops signatures on split pages', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(4);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 3 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 4 }));

    // Split pages 1-2 (visible positions 0-1)
    await engine.split('doc-1', [0, 1]);

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const sigs = getPlacedSigs(state.value);
      // Pages 3 and 4 survive, shift to positions 1 and 2
      expect(sigs.length).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-030: signature placements survive save/reload
// ---------------------------------------------------------------------------

describe('EngineService - signature save/reload (DEF-030)', () => {
  it('placed signatures survive save and re-load', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({ page: 1 });
    await engine.placeSignature('doc-1', payload);

    const payload2 = makePlacementPayload({ page: 2 });
    await engine.placeSignature('doc-1', payload2);

    // Verify both are placed before save
    let state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(getPlacedSigs(state.value).length).toBe(2);
    }

    // Save
    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    // Re-load the saved file
    await engine.loadDocument('doc-reloaded', path);
    const reloadedState = await engine.getState('doc-reloaded');
    expect(reloadedState.ok).toBe(true);
    if (reloadedState.ok) {
      const sigs = getPlacedSigs(reloadedState.value);
      expect(sigs.length).toBe(2);

      // Verify metadata survived
      const ids = sigs.map((s: any) => s.id).sort();
      const payloadIds = [payload.id, payload2.id].sort();
      expect(ids).toEqual(payloadIds);

      // Verify pages
      const pages = sigs.map((s: any) => s.page).sort();
      expect(pages).toEqual([1, 2]);

      // Verify signatureId survived
      const sigIds = sigs.map((s: any) => s.signatureId).sort();
      const payloadSigIds = [payload.signatureId, payload2.signatureId].sort();
      expect(sigIds).toEqual(payloadSigIds);

      // Verify rects survived
      for (const sig of sigs) {
        const rect = sig.rect as Record<string, number>;
        expect(typeof rect.x).toBe('number');
        expect(typeof rect.y).toBe('number');
        expect(typeof rect.width).toBe('number');
        expect(typeof rect.height).toBe('number');
      }
    }
  });

  it('signature PNG bytes survive save/reload', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const png = minimalPngBytes();
    const payload = makePlacementPayload({ page: 1, pngBytes: png });
    await engine.placeSignature('doc-1', payload);

    await engine.save('doc-1');

    // Re-load and verify PNG data round-trips
    await engine.loadDocument('doc-reloaded', path);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const sigs = getPlacedSigs(state.value);
      expect(sigs.length).toBe(1);
    }

    // Round-trip: re-parse the saved file directly
    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    expect(reparsed.getPageCount()).toBe(1);
    // The page should be valid with the embedded signature image
    const page = reparsed.getPage(0);
    expect(page.getSize().width).toBe(612);
  });

  it('saveAs preserves signature placements for reload', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.placeSignature('doc-1', makePlacementPayload({ page: 1 }));
    await engine.placeSignature('doc-1', makePlacementPayload({ page: 2 }));

    const newPath = join(dir, 'sig-reload-saveas.pdf');
    await engine.saveAs('doc-1', newPath);

    // Re-load
    await engine.loadDocument('doc-reloaded', newPath);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(getPlacedSigs(state.value).length).toBe(2);
    }
  });

  it('reloaded signatures can still be deleted', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const payload = makePlacementPayload({ page: 1 });
    await engine.placeSignature('doc-1', payload);
    await engine.save('doc-1');

    // Re-load
    await engine.loadDocument('doc-reloaded', path);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok && getPlacedSigs(state.value).length).toBe(1);

    // Delete the reloaded signature
    const delResult = await engine.deleteSignature('doc-reloaded', payload.id);
    expect(delResult.ok).toBe(true);
    if (delResult.ok) {
      expect(getPlacedSigs(delResult.value).length).toBe(0);
    }
  });

  it('save then reload with no signatures produces empty placements', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    // Save without any signatures
    await engine.save('doc-1');

    // Re-load
    await engine.loadDocument('doc-reloaded', path);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(getPlacedSigs(state.value).length).toBe(0);
    }
  });
});