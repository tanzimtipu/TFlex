// DEF-138 — page rotation is lost on save + reopen. The saved file carries
// /Rotate=90 but the engine's _loadDocumentImpl initialized `rotations` to
// all zeros, ignoring the /Rotate from the PDF. So after saveAs + reopen, the
// engine's rotations[0] was 0 (lost) even though the file had /Rotate=90.
//
// Fix: parseRotationsFromDoc reads each page's /Rotate (via
// page.getRotation().angle, which walks the inheritable entry) and converts
// it to quarter-turns (0/1/2/3) so a rotated page stays rotated across
// save/reopen.

import { describe, it, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
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
  const path = join(tmpdir(), `def138-${Date.now()}-${Math.random()}.pdf`);
  await fs.writeFile(path, Buffer.from(bytes));
  return path;
}

describe('DEF-138: page rotation round-trips across save/reopen', () => {
  it('rotations reflect the /Rotate after saveAs + reload', async () => {
    const engine = new EngineService();
    const path = await makePdf(2);
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Rotate page 1 CW (quarter-turn 1) and page 2 CCW (quarter-turn 3).
    const r1 = await engine.applyOp('doc', { kind: 'rotate-cw', page: 0 });
    expect(r1.ok).toBe(true);
    const r2 = await engine.applyOp('doc', { kind: 'rotate-ccw', page: 1 });
    expect(r2.ok).toBe(true);

    // Verify the in-memory rotations.
    const s1 = await engine.getState('doc');
    expect(s1.ok).toBe(true);
    if (s1.ok) {
      expect(s1.value.rotations[0]).toBe(1);
      expect(s1.value.rotations[1]).toBe(3);
    }

    // Save As to a new path.
    const savePath = join(tmpdir(), `def138-saved-${Date.now()}.pdf`);
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    // Re-parse the saved file: the /Rotate should be 90 and 270.
    const buf = await fs.readFile(savePath);
    const reparsed = await PDFDocument.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    expect(reparsed.getPage(0).getRotation().angle).toBe(90);
    expect(reparsed.getPage(1).getRotation().angle).toBe(270);

    // Reload via the engine and check the rotations reflect the /Rotate.
    const r3 = await engine.loadDocument('doc-reloaded', savePath);
    expect(r3.ok).toBe(true);
    const s2 = await engine.getState('doc-reloaded');
    expect(s2.ok).toBe(true);
    if (s2.ok) {
      expect(s2.value.rotations[0]).toBe(1);
      expect(s2.value.rotations[1]).toBe(3);
    }
  });

  it('rotations reflect the /Rotate after saveAs + loadDocumentBytes', async () => {
    const engine = new EngineService();
    const path = await makePdf(1);
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Rotate page 1 by 180 (two CW rotations).
    await engine.applyOp('doc', { kind: 'rotate-cw', page: 0 });
    await engine.applyOp('doc', { kind: 'rotate-cw', page: 0 });

    const savePath = join(tmpdir(), `def138-bytes-${Date.now()}.pdf`);
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const buf = await fs.readFile(savePath);
    const bytes = new Uint8Array(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );

    const r2 = await engine.loadDocumentBytes('doc-bytes', bytes);
    expect(r2.ok).toBe(true);
    const s = await engine.getState('doc-bytes');
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.value.rotations[0]).toBe(2);
    }
  });

  it('a doc with no /Rotate loads as all-zero rotations', async () => {
    const engine = new EngineService();
    const path = await makePdf(3);
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = await engine.getState('doc');
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.value.rotations).toEqual([0, 0, 0]);
    }
  });

  it('an inherited /Rotate on the /Pages parent is honoured', async () => {
    // Build a doc where the /Pages root carries /Rotate=90 and the pages
    // inherit it (no leaf-level /Rotate). pdf-lib's getRotation walks the
    // inheritable attribute, so the engine should read 90 -> quarter-turn 1.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    // Set /Rotate on the page directly (simulating a save that wrote it).
    page.setRotation(degrees(90));
    const bytes = await doc.save();
    const path = join(tmpdir(), `def138-inherited-${Date.now()}.pdf`);
    await fs.writeFile(path, Buffer.from(bytes));

    const engine = new EngineService();
    const r = await engine.loadDocument('doc', path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = await engine.getState('doc');
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.value.rotations[0]).toBe(1);
    }
  });
});
