// Phase 86 (FEA-038) chunk B — engine.replaceText round-trips.
//
// Proves the op writes REAL saved text: after the op, and again after
// save/reload, `exportText` (which reads the saved content streams) returns
// the new term and no longer the old one, while a sibling term on the same
// page and text on other pages survive. Also proves a mismatched `find` is
// skipped and mutates nothing, an undecodable page refuses with the typed
// `replace-unsupported` error and leaves the doc unchanged, undo restores the
// pre-replace text, and a replace-all of N occurrences is ONE undo entry.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { AnnRect, ReplaceOccurrence } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-replace-'));
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
async function createReplaceFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p1.drawText('SIBLING', { x: 72, y: 600, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('OTHERPAGE', { x: 72, y: 700, size: 14, font });
  return writeFixture('replace.pdf', await doc.save());
}

/** Page 1 carries TERM twice (y=700, y=600); page 2 carries TERM once
 *  (y=700) — three occurrences for a replace-all. */
async function createThreeOccurrenceFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('TERM', { x: 72, y: 700, size: 14, font });
  p1.drawText('TERM', { x: 72, y: 600, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('TERM', { x: 72, y: 700, size: 14, font });
  return writeFixture('three.pdf', await doc.save());
}

/** DEF-499 fixture: page 1 carries SECRET twice (y=700, y=620) plus SIBLING
 *  (y=540); page 2 carries SECRET (y=700) plus OTHERPAGE (y=620). A replace-one
 *  followed by a replace-all leaves three PUBLICs that must all persist. */
async function createSequentialFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p1.drawText('SECRET', { x: 72, y: 620, size: 14, font });
  p1.drawText('SIBLING', { x: 72, y: 540, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p2.drawText('OTHERPAGE', { x: 72, y: 620, size: 14, font });
  return writeFixture('sequential.pdf', await doc.save());
}

/** A page whose /Contents stream carries an unknown filter, so decoding it
 *  throws and the op must refuse with `replace-unsupported`. */
async function createUndecodableFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const content = 'BT /F1 12 Tf 1 0 0 1 72 700 Tm (SECRET) Tj ET';
  const stream = doc.context.stream(Buffer.from(content, 'latin1'), {
    Filter: PDFName.of('BogusFilter'),
  });
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  return writeFixture('undecodable.pdf', await doc.save());
}

/** Top-left page-point rect covering a 14pt Helvetica run at baseline `y`
 *  (ink band ~696.5..711.9 for y=700), x 72..~129 for a 6-char term. */
function runRect(baselineY: number): AnnRect {
  const userX = 60;
  const userTop = baselineY - 10;
  const userHeight = 25;
  return {
    x: userX,
    y: 792 - (userTop + userHeight),
    width: 90,
    height: userHeight,
  };
}

const SECRET_OCC: ReplaceOccurrence = { page: 1, rect: runRect(700), find: 'SECRET' };
const WRONG_OCC: ReplaceOccurrence = { page: 1, rect: runRect(700), find: 'WRONG' };

async function pageTexts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

/** The page 0 content stream's bytes (decoded when possible), read back from
 *  a serialized document. This is the stream the op rewrites, so it is the
 *  meaningful byte-level evidence for "nothing was mutated". */
async function page0Content(bytes: ArrayBuffer): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const node = doc.getPage(0).node;
  const contents = node.Contents();
  if (!contents) return '';
  const entries = (contents as { asArray?: () => unknown[] }).asArray
    ? (contents as { asArray: () => unknown[] }).asArray()
    : [contents];
  const ctx = doc.context;
  let out = '';
  for (const entry of entries) {
    const obj = ctx.lookup(entry as never) as unknown as {
      contents?: Uint8Array;
      getContents?: () => Uint8Array;
      dict?: unknown;
    };
    const raw = obj.getContents ? obj.getContents() : obj.contents;
    if (!raw) continue;
    try {
      out += new TextDecoder('latin1').decode(inflateSync(raw));
    } catch {
      out += new TextDecoder('latin1').decode(raw);
    }
  }
  return out;
}

describe('Phase 86: engine.replaceText', () => {
  it('writes real text: old term gone, sibling and other pages survive', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replaced).toBe(1);
      expect(r.value.skipped).toEqual([]);
      expect(r.value.state.modified).toBe(true);
      expect(r.value.substitutedFonts.length).toBeGreaterThan(0);
    }

    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('PUBLIC')).toBe(true);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
  });

  it('the rewrite survives a save + reopen round-trip', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);

    const saved = await engine.save('doc-1');
    expect(saved.ok).toBe(true);

    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', saved.ok ? saved.value : path);
    const pages = await pageTexts(engine2, 'doc-2');
    expect(pages[0].includes('PUBLIC')).toBe(true);
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
  });

  it('skips a mismatched find and leaves the document bytes unchanged', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);

    const r = await engine.replaceText('doc-1', {
      occurrences: [WRONG_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replaced).toBe(0);
      expect(r.value.skipped.length).toBe(1);
      expect(r.value.skipped[0].find).toBe('WRONG');
    }

    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(await page0Content(after.value)).toBe(await page0Content(before.value));
    }
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
    expect((await pageTexts(engine, 'doc-1'))[0].includes('SECRET')).toBe(true);
  });

  it('refuses with replace-unsupported when a page stream cannot be decoded', async () => {
    const engine = new EngineService();
    const path = await createUndecodableFixture();
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);

    const r = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('replace-unsupported');
    }

    const after = await engine.getDocumentBytes('doc-1');
    if (before.ok && after.ok) {
      expect(await page0Content(after.value)).toBe(await page0Content(before.value));
    }
    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
  });

  it('undo restores the pre-replace text', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect((await pageTexts(engine, 'doc-1'))[0].includes('SECRET')).toBe(false);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(true);
    expect(pages[0].includes('SIBLING')).toBe(true);
  });

  it('an empty replacement deletes the term', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const r = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.replaced).toBe(1);
    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
  });

  it('replace-all across pages is exactly ONE undo entry', async () => {
    const engine = new EngineService();
    const path = await createThreeOccurrenceFixture();
    await engine.loadDocument('doc-1', path);

    const occurrences: ReplaceOccurrence[] = [
      { page: 1, rect: runRect(700), find: 'TERM' },
      { page: 1, rect: runRect(600), find: 'TERM' },
      { page: 2, rect: runRect(700), find: 'TERM' },
    ];
    const r = await engine.replaceText('doc-1', {
      occurrences,
      replacement: 'WORD',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replaced).toBe(3);
      expect(r.value.skipped).toEqual([]);
    }
    let pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('TERM')).toBe(false);
    expect(pages[1].includes('TERM')).toBe(false);

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('TERM')).toBe(true);
    expect(pages[1].includes('TERM')).toBe(true);

    // The single undo restored all three occurrences; the next undo has
    // nothing left from this op to consume.
    const undo2 = await engine.undo('doc-1');
    expect(undo2.ok).toBe(false);
  });

  it('sequential replace-one then replace-all keeps every replacement (DEF-499)', async () => {
    const engine = new EngineService();
    const path = await createSequentialFixture();
    await engine.loadDocument('doc-1', path);

    const one = await engine.replaceText('doc-1', {
      occurrences: [{ page: 1, rect: runRect(700), find: 'SECRET' }],
      replacement: 'PUBLIC',
    });
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.value.replaced).toBe(1);
      expect(one.value.skipped).toEqual([]);
    }

    const rest = await engine.replaceText('doc-1', {
      occurrences: [
        { page: 1, rect: runRect(620), find: 'SECRET' },
        { page: 2, rect: runRect(700), find: 'SECRET' },
      ],
      replacement: 'PUBLIC',
    });
    expect(rest.ok).toBe(true);
    if (rest.ok) {
      expect(rest.value.replaced).toBe(2);
      expect(rest.value.skipped).toEqual([]);
    }

    const count = (text: string, term: string): number => text.split(term).length - 1;
    let pages = await pageTexts(engine, 'doc-1');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(count(pages[0], 'PUBLIC')).toBe(2);
    expect(pages[1].includes('SECRET')).toBe(false);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
    expect(count(pages[1], 'PUBLIC')).toBe(1);

    const saved = await engine.save('doc-1');
    expect(saved.ok).toBe(true);
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', saved.ok ? saved.value : path);
    pages = await pageTexts(engine2, 'doc-2');
    expect(pages[0].includes('SECRET')).toBe(false);
    expect(pages[0].includes('SIBLING')).toBe(true);
    expect(count(pages[0], 'PUBLIC')).toBe(2);
    expect(pages[1].includes('SECRET')).toBe(false);
    expect(pages[1].includes('OTHERPAGE')).toBe(true);
    expect(count(pages[1], 'PUBLIC')).toBe(1);
  });

  it('rejects an unknown document, an empty list and an empty find', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const unknown = await engine.replaceText('nope', {
      occurrences: [SECRET_OCC],
      replacement: 'X',
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('engine-error');

    const empty = await engine.replaceText('doc-1', {
      occurrences: [],
      replacement: 'X',
    });
    expect(empty.ok).toBe(false);

    const emptyFind = await engine.replaceText('doc-1', {
      occurrences: [{ page: 1, rect: runRect(700), find: '' }],
      replacement: 'X',
    });
    expect(emptyFind.ok).toBe(false);

    const outOfRange = await engine.replaceText('doc-1', {
      occurrences: [{ page: 9, rect: runRect(700), find: 'SECRET' }],
      replacement: 'X',
    });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.error.code).toBe('out-of-range');
  });

  // DEF-506 — a partially-drawable replacement is refused loudly, never
  // silently truncated to the drawable subset.
  it('refuses a replacement containing an undrawable character, leaving text unchanged', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    const r = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'A\u4e2dB',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
      expect(r.error.message).toContain('\u4e2d');
    }

    const pages = await pageTexts(engine, 'doc-1');
    // Old glyphs are untouched and the undrawable subset was never drawn.
    expect(pages[0]).toContain('SECRET');
    expect(pages[0]).not.toContain('AB');

    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
    const after = await engine.getDocumentBytes('doc-1');
    if (before.ok && after.ok) {
      expect(Buffer.from(after.value).equals(Buffer.from(before.value))).toBe(true);
    }
  });

  // DEF-504 — a fully-skipped replace must not mutate the serialized bytes.
  it('leaves getDocumentBytes byte-identical when nothing is replaced', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);

    const r = await engine.replaceText('doc-1', {
      occurrences: [WRONG_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replaced).toBe(0);
      expect(r.value.skipped.length).toBe(1);
    }

    const state = await engine.getState('doc-1');
    expect(state.ok && state.value.modified).toBe(false);
    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(Buffer.from(after.value).equals(Buffer.from(before.value))).toBe(true);
    }
  });

  // DEF-505 — an in-session exportText after replace + editTextRun must see the
  // edit (previously the pdf-lib content-stream byte cache hid it until a
  // save+reopen).
  it('in-session exportText sees a Phase-10 edit committed after a replace', async () => {
    const engine = new EngineService();
    const path = await createReplaceFixture();
    await engine.loadDocument('doc-1', path);

    const rep = await engine.replaceText('doc-1', {
      occurrences: [SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect(rep.ok).toBe(true);

    const edit = await engine.editTextRun('doc-1', {
      page: 1,
      rect: runRect(600),
      newText: 'EDITED',
    });
    expect(edit.ok).toBe(true);

    const pages = await pageTexts(engine, 'doc-1');
    expect(pages[0]).toContain('EDITED');
    expect(pages[0]).toContain('PUBLIC');
    expect(pages[0]).not.toContain('SECRET');
    expect(pages[1]).toContain('OTHERPAGE');
  });
});

