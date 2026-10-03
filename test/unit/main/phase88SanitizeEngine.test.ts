// Phase 88 (FEA-037) chunk B — engine.sanitizeDoc round-trips.
//
// Proves the op strips the selected classes from the working document in ONE
// step with exactly ONE undo entry, that the serialized bytes (serializeDoc)
// and a fresh reopen both lack the carriers, that a partial selection removes
// only the selected class, and that an all-false selection is refused with the
// typed no-op while leaving the bytes unchanged.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import {
  collectJavaScript,
} from '../../../src/main/services/validation/pdfa';
import type { SanitizeOptions } from '../../../src/shared/sanitize';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-sanitize-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ALL: SanitizeOptions = {
  javascript: true,
  launchActions: true,
  embeddedFiles: true,
  metadata: true,
};
const NONE: SanitizeOptions = {
  javascript: false,
  launchActions: false,
  embeddedFiles: false,
  metadata: false,
};

/** One page with real text plus every active-content class in the catalog. */
async function createActiveFixture(name: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('HELLO ACTIVE WORLD', { x: 72, y: 700, size: 14, font });
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] }, EmbeddedFiles: { Names: [] } }),
  );
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', FS: {} }));
  doc.catalog.set(PDFName.of('Metadata'), doc.context.obj({ Type: 'Metadata', Subtype: 'XML' }));
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

async function parse(bytes: ArrayBuffer): Promise<PDFDocument> {
  return PDFDocument.load(new Uint8Array(bytes));
}

describe('Phase 88: engine.sanitizeDoc', () => {
  it('strips every class, persists without them, and ONE undo restores them', async () => {
    const engine = new EngineService();
    const path = await createActiveFixture('active.pdf');
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(collectJavaScript(await parse(before.value))).toBe(true);

    const r = await engine.sanitizeDoc('doc-1', { options: ALL });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.report.selected).toEqual([
      'javascript',
      'launchActions',
      'embeddedFiles',
      'metadata',
    ]);
    expect(r.value.report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
    expect(r.value.report.removedByClass.launchActions).toBeGreaterThanOrEqual(1);
    expect(r.value.report.removedByClass.embeddedFiles).toBeGreaterThanOrEqual(1);
    expect(r.value.report.removedByClass.metadata).toBe(1);
    expect(r.value.state.pageCount).toBe(1);

    // serializeDoc output lacks the carriers the serializer persists.
    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const parsed = await parse(after.value);
    expect(collectJavaScript(parsed)).toBe(false);
    expect(parsed.catalog.has(PDFName.of('Metadata'))).toBe(false);

    // Reopen the serialized bytes in a fresh engine: still clean.
    const reopenPath = join(dir, 'reopen.pdf');
    await writeFile(reopenPath, Buffer.from(new Uint8Array(after.value)));
    const reopenEngine = new EngineService();
    const load = await reopenEngine.loadDocument('doc-2', reopenPath);
    expect(load.ok).toBe(true);
    const reopenBytes = await reopenEngine.getDocumentBytes('doc-2');
    expect(reopenBytes.ok).toBe(true);
    if (!reopenBytes.ok) return;
    const reopenParsed = await parse(reopenBytes.value);
    expect(collectJavaScript(reopenParsed)).toBe(false);
    expect(reopenParsed.catalog.has(PDFName.of('Metadata'))).toBe(false);

    // Exactly ONE undo entry restores the carriers the serializer persists.
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const restoredBytes = await engine.getDocumentBytes('doc-1');
    expect(restoredBytes.ok).toBe(true);
    if (!restoredBytes.ok) return;
    const restored = await parse(restoredBytes.value);
    expect(collectJavaScript(restored)).toBe(true);
    expect(restored.catalog.has(PDFName.of('Metadata'))).toBe(true);
  });

  it('rejects an all-false selection with no-op and leaves the bytes unchanged', async () => {
    const engine = new EngineService();
    const path = await createActiveFixture('noop.pdf');
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const r = await engine.sanitizeDoc('doc-1', { options: NONE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no-op');

    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(new Uint8Array(after.value)).toEqual(new Uint8Array(before.value));

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.error.code).toBe('nothing-to-undo');
  });

  it('a partial selection removes only the selected class', async () => {
    const engine = new EngineService();
    const path = await createActiveFixture('partial.pdf');
    await engine.loadDocument('doc-1', path);

    const r = await engine.sanitizeDoc('doc-1', { options: { ...NONE, metadata: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.report.selected).toEqual(['metadata']);
    expect(r.value.report.removedByClass).toEqual({
      javascript: 0,
      launchActions: 0,
      embeddedFiles: 0,
      metadata: 1,
    });

    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const parsed = await parse(after.value);
    expect(parsed.catalog.has(PDFName.of('Metadata'))).toBe(false);
    expect(collectJavaScript(parsed)).toBe(true);
    expect(parsed.catalog.has(PDFName.of('Names'))).toBe(true);
  });

  it('returns engine-error for an unknown document', async () => {
    const engine = new EngineService();
    const r = await engine.sanitizeDoc('nope', { options: ALL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
  });

  it('a sanitize that removes nothing stays unmodified and adds no undo entry (DEF-511)', async () => {
    const engine = new EngineService();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('Metadata'), doc.context.obj({ Type: 'Metadata' }));
    const path = join(dir, 'quiet.pdf');
    await writeFile(path, Buffer.from(await doc.save()));
    await engine.loadDocument('doc-1', path);

    // javascript selected, but the document carries no JavaScript carrier.
    const r = await engine.sanitizeDoc('doc-1', { options: { ...NONE, javascript: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.report.removedByClass).toEqual({
      javascript: 0,
      launchActions: 0,
      embeddedFiles: 0,
      metadata: 0,
    });
    expect(r.value.state.modified).toBe(false);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.error.code).toBe('nothing-to-undo');
  });

  it('a second no-removal sanitize adds no undo entry: the next undo is nothing-to-undo (DEF-511)', async () => {
    const engine = new EngineService();
    const path = await createActiveFixture('twice.pdf');
    await engine.loadDocument('doc-1', path);

    // First javascript-only sanitize removes the JS tree -> exactly ONE undo entry.
    const first = await engine.sanitizeDoc('doc-1', { options: { ...NONE, javascript: true } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.report.removedByClass.javascript).toBeGreaterThanOrEqual(1);

    // Second identical sanitize removes NOTHING.
    const second = await engine.sanitizeDoc('doc-1', { options: { ...NONE, javascript: true } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.report.removedByClass).toEqual({
      javascript: 0,
      launchActions: 0,
      embeddedFiles: 0,
      metadata: 0,
    });
    expect(second.value.warnings).toEqual([]);

    // No extra undo entry: undo #1 pops the real op, undo #2 finds nothing.
    const u1 = await engine.undo('doc-1');
    expect(u1.ok).toBe(true);
    const u2 = await engine.undo('doc-1');
    expect(u2.ok).toBe(false);
    if (!u2.ok) expect(u2.error.code).toBe('nothing-to-undo');
  });
});
