// Phase 84 (True redaction) chunk B — engine op round-trips.
//
// Proves `engine.applyRedactions` removes the marked glyphs from the page
// content stream (not merely covers them): after the op AND after a
// save/reload, `exportText` (which reads the saved content stream via
// extractTextFromRawPdf) no longer returns the redacted term while sibling
// text on the same page and text on other pages survive. Also proves undo
// restores the term, an unresolvable font refuses with a typed error and no
// mutation, and a mark over no removable text returns a readable warning.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { AnnRect } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-redact-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

/** Two-page fixture: page 1 carries SECRET and SIBLING on separate lines;
 *  page 2 carries OTHERPAGE. Text is drawn with an explicit Helvetica font so
 *  pdf-lib records the /Font resource the advance resolver reads. */
async function createRedactionFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p1.drawText('SIBLING', { x: 72, y: 600, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('OTHERPAGE', { x: 72, y: 700, size: 14, font });
  return writeFixture('redaction.pdf', await doc.save());
}

/** A page whose content stream references a font resource that is NOT in the
 *  page /Resources — the advance resolver cannot measure it, so the op must
 *  refuse loudly. */
async function createUnresolvableFontFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const content = 'BT /Ghost 14 Tf 1 0 0 1 72 700 Tm <534543524554> Tj ET';
  const stream = doc.context.flateStream(content);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  return writeFixture('unsupported.pdf', await doc.save());
}

/** Top-left page-point mark covering the SECRET run: baseline 700, ink band
 *  ~696.5..711.9, x 72..128.8, so [690,715] x [60,150] covers it. */
const SECRET_MARK: AnnRect = { x: 60, y: 77, width: 90, height: 25 };

/** A mark in blank space, covering no glyph. */
const EMPTY_MARK: AnnRect = { x: 300, y: 300, width: 60, height: 20 };

async function pageTexts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

describe('Phase 84: applyRedactions', () => {
  it('removes the marked term, keeps sibling text and other pages', async () => {
    const engine = new EngineService();
    const path = await createRedactionFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyRedactions('doc-1', {
      page: 1,
      marks: [{ rect: SECRET_MARK }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.removedGlyphs).toBe(6);
      expect(r.value.warnings).toEqual([]);
      expect(r.value.state.modified).toBe(true);
    }

    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
  });

  it('the removal survives a save + reload round-trip', async () => {
    const engine = new EngineService();
    const path = await createRedactionFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyRedactions('doc-1', {
      page: 1,
      marks: [{ rect: SECRET_MARK }],
    });
    expect(r.ok).toBe(true);

    const saved = await engine.save('doc-1');
    expect(saved.ok).toBe(true);

    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', saved.ok ? saved.value : path);
    const pages = await pageTexts(engine2, 'doc-2');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
  });

  it('undo restores the pre-redaction text', async () => {
    const engine = new EngineService();
    const path = await createRedactionFixture();
    await engine.loadDocument('doc-1', path);

    await engine.applyRedactions('doc-1', { page: 1, marks: [{ rect: SECRET_MARK }] });
    expect((await pageTexts(engine, 'doc-1'))[0].includes('SECRET')).toBe(false);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(true);
    expect(pages[0].includes('SIBLING')).toBe(true);
  });

  it('refuses with redaction-unsupported when a marked run cannot be measured', async () => {
    const engine = new EngineService();
    const path = await createUnresolvableFontFixture();
    await engine.loadDocument('doc-1', path);

    const before = await pageTexts(engine, 'doc-1');
    const r = await engine.applyRedactions('doc-1', {
      page: 1,
      marks: [{ rect: SECRET_MARK }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('redaction-unsupported');
    }

    // No mutation: the text is unchanged and the document is not marked dirty.
    const after = await pageTexts(engine, 'doc-1');
    expect(after).toEqual(before);
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
  });

  it('reports a warning for a mark that covers no removable text', async () => {
    const engine = new EngineService();
    const path = await createRedactionFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyRedactions('doc-1', {
      page: 1,
      marks: [{ rect: EMPTY_MARK }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.removedGlyphs).toBe(0);
      expect(r.value.warnings.length).toBe(1);
      expect(r.value.warnings[0]).toContain('mark 1');
    }
    // The rest of the page is untouched.
    expect((await pageTexts(engine, 'doc-1'))[0].includes('SECRET')).toBe(true);
  });

  it('draws the mark rectangle in the requested colour', async () => {
    const engine = new EngineService();
    const path = await createRedactionFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.applyRedactions('doc-1', {
      page: 1,
      marks: [{ rect: SECRET_MARK }],
      color: '#ff0000',
    });
    expect(r.ok).toBe(true);

    const bytes = await engine.getDocumentBytes('doc-1');
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;
    const out = join(dir, 'coloured.pdf');
    await writeFile(out, Buffer.from(new Uint8Array(bytes.value)));
    const content = await decodedPage0Content(out);
    expect(content.includes('1 0 0 rg')).toBe(true);
  });
});

/** Decode page 0's /Contents stream(s) to latin1 text. */
async function decodedPage0Content(path: string): Promise<string> {
  const bytes = await readFile(path);
  const doc = await PDFDocument.load(bytes);
  const node = doc.getPage(0).node;
  const contents = node.Contents();
  if (!contents) return '';
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  const ctx = doc.context;
  let out = '';
  for (const entry of entries) {
    const stream = ctx.lookup(entry as never) as unknown as {
      contents?: Uint8Array;
      getContents?: () => Uint8Array;
    };
    const raw = stream.getContents ? stream.getContents() : stream.contents;
    if (!raw) continue;
    try {
      out += new TextDecoder('latin1').decode(inflateSync(raw));
    } catch {
      out += new TextDecoder('latin1').decode(raw);
    }
  }
  return out;
}
