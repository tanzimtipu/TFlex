// TFL-449 adversary diff-pass probes for Phase 86 (FEA-038) search-and-replace.
//
// Scratch suite, NOT part of the shipped test suite. Attacks the content-rewrite
// + save path of engine.replaceText / shared/searchReplace. Run with:
//   node node_modules/vitest/vitest.mjs run --config test-fixtures/adv449/vitest.probe.config.ts
//
// Each `it` asserts the SAFE expected behaviour; a failure is the finding.

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { degrees, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { EngineService } from '../../src/main/services/engine';
import { planReplace } from '../../src/shared/searchReplace';
import type { RedactionAdvanceResolver } from '../../src/shared/redaction';
import type { AnnRect, ReplaceOccurrence } from '../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-adv449-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

function runRect(baselineY: number): AnnRect {
  return { x: 60, y: 792 - (baselineY - 10 + 25), width: 90, height: 25 };
}

const SECRET_OCC: ReplaceOccurrence = { page: 1, rect: runRect(700), find: 'SECRET' };

async function createSimple(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p1.drawText('SIBLING', { x: 72, y: 600, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('OTHERPAGE', { x: 72, y: 700, size: 14, font });
  return writeFixture('simple.pdf', await doc.save());
}

async function createRotated(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.setRotation(degrees(90));
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  p1.drawText('SIBLING', { x: 72, y: 600, size: 14, font });
  return writeFixture('rotated.pdf', await doc.save());
}

/** Page 1 carries a replaceable SECRET; page 2's content stream uses an
 *  unknown filter so decoding it throws. */
async function createMixedUndecodable(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  const stream = doc.context.stream(Buffer.from('BT /F1 12 Tf 1 0 0 1 72 700 Tm (X) Tj ET', 'latin1'), {
    Filter: PDFName.of('BogusFilter'),
  });
  p2.node.set(PDFName.of('Contents'), doc.context.register(stream));
  return writeFixture('mixed.pdf', await doc.save());
}

async function createTwoOnOneLine(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET SIBLING SECRET', { x: 72, y: 700, size: 14, font });
  return writeFixture('twoline.pdf', await doc.save());
}

async function pageTexts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

describe('adv449 engine probes', () => {
  it('A1 duplicate occurrence payload must not double-draw / overcount', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const r = await engine.replaceText('d', {
      occurrences: [SECRET_OCC, SECRET_OCC],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pages = await pageTexts(engine, 'd');
    const count = (pages[0].match(/PUBLIC/g) ?? []).length;
    console.log('[A1] replaced=', r.value.replaced, 'skipped=', r.value.skipped.length, 'PUBLIC-count=', count, 'text=', JSON.stringify(pages[0]));
    // Safe expectation: one physical occurrence -> one PUBLIC, replaced <= 1.
    expect(count).toBe(1);
    expect(r.value.replaced).toBe(1);
  });

  it('A2 overlapping occurrences must not remove a glyph outside the union intent', async () => {
    // "SECRET SIBLING SECRET": two hits. Second hit rect is shifted so it
    // overlaps the first by a fraction and its covered glyphs still spell SECRET.
    const engine = new EngineService();
    await engine.loadDocument('d', await createTwoOnOneLine());
    const r1 = await engine.replaceText('d', {
      occurrences: [{ page: 1, rect: runRect(700), find: 'SECRET' }],
      replacement: 'A',
    });
    console.log('[A2] first=', r1.ok ? JSON.stringify({ replaced: r1.value.replaced, skipped: r1.value.skipped }) : JSON.stringify(r1));
    const pages = await pageTexts(engine, 'd');
    console.log('[A2] after first text=', JSON.stringify(pages[0]));
    // Each replacement must persist; sibling must survive.
    expect(pages[0]).toContain('SIBLING');
  });

  it('A3 no-op replace (mismatched find) must not change the serialized document', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const before = await engine.getDocumentBytes('d');
    const r = await engine.replaceText('d', {
      occurrences: [{ page: 1, rect: runRect(700), find: 'WRONG' }],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.replaced).toBe(0);
    const after = await engine.getDocumentBytes('d');
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      const b = Buffer.from(before.value);
      const a = Buffer.from(after.value);
      console.log('[A3] bytes equal=', b.equals(a), 'len before/after=', b.length, a.length);
      expect(a.equals(b)).toBe(true);
    }
    const state = await engine.getState('d');
    expect(state.ok && state.value.modified).toBe(false);
  });

  it('A4 redo after replace re-applies the replacement', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'PUBLIC' });
    expect((await pageTexts(engine, 'd'))[0]).not.toContain('SECRET');
    const undo = await engine.undo('d');
    expect(undo.ok).toBe(true);
    expect((await pageTexts(engine, 'd'))[0]).toContain('SECRET');
    const redo = await engine.redo('d');
    const pages = await pageTexts(engine, 'd');
    console.log('[A4] redo.ok=', redo.ok, 'text=', JSON.stringify(pages[0]));
    expect(redo.ok).toBe(true);
    expect(pages[0]).not.toContain('SECRET');
    expect(pages[0]).toContain('PUBLIC');
  });

  it('A5 page 1 replaceable + page 2 undecodable: all-or-nothing', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createMixedUndecodable());
    const before = await pageTexts(engine, 'd');
    const r = await engine.replaceText('d', {
      occurrences: [
        SECRET_OCC,
        { page: 2, rect: runRect(700), find: 'X' },
      ],
      replacement: 'PUBLIC',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('replace-unsupported');
    const after = await pageTexts(engine, 'd');
    console.log('[A5] before=', JSON.stringify(before), 'after=', JSON.stringify(after));
    // Page 1 must be untouched (SECRET still extractable).
    expect(after[0]).toContain('SECRET');
    const state = await engine.getState('d');
    expect(state.ok && state.value.modified).toBe(false);
  });

  it('A6 malformed occurrence (missing rect) must be a typed error, never a crash', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    let caught: unknown = null;
    let r: Awaited<ReturnType<typeof engine.replaceText>> | null = null;
    try {
      r = await engine.replaceText('d', {
        occurrences: [{ page: 1, find: 'SECRET' } as unknown as ReplaceOccurrence],
        replacement: 'PUBLIC',
      });
    } catch (e) {
      caught = e;
    }
    console.log('[A6] rejected=', caught instanceof Error ? caught.message : String(caught), 'result=', r ? JSON.stringify(r) : 'null');
    // Safe expectation: a Result, never a thrown rejection.
    expect(caught).toBeNull();
    expect(r).not.toBeNull();
  });

  it('A7 rotated page (90deg) replace must still remove the correct glyphs', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createRotated());
    const r = await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'PUBLIC' });
    const pages = await pageTexts(engine, 'd');
    console.log('[A7] result=', r.ok ? JSON.stringify({ replaced: r.value.replaced, skipped: r.value.skipped }) : JSON.stringify(r), 'text=', JSON.stringify(pages[0]));
    if (r.ok) {
      expect(pages[0]).not.toContain('SECRET');
      expect(pages[0]).toContain('PUBLIC');
      expect(pages[0]).toContain('SIBLING');
    }
  });

  it('A8 substring replace on a real drawn line keeps the untouched words', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    // Replace the whole SECRET run with a longer token; SIBLING must survive.
    const r = await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'VERYLONGTOKEN' });
    const pages = await pageTexts(engine, 'd');
    console.log('[A8] text=', JSON.stringify(pages[0]));
    expect(r.ok).toBe(true);
    expect(pages[0]).toContain('SIBLING');
    expect((await pageTexts(engine, 'd'))[1]).toContain('OTHERPAGE');
  });

  it('A9 replace then Phase-10 editTextRun on the same page, then replace again', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const rep = await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'PUBLIC' });
    expect(rep.ok).toBe(true);
    const edit = await engine.editTextRun('d', {
      page: 1,
      rect: runRect(600),
      newText: 'EDITED',
    });
    console.log('[A9] edit.ok=', edit.ok);
    const pages1 = await pageTexts(engine, 'd');
    console.log('[A9] after edit=', JSON.stringify(pages1[0]));
    // Persist and reopen: does the Phase-10 edit survive a save after replace?
    const saved = await engine.save('d');
    expect(saved.ok).toBe(true);
    const engine2 = new EngineService();
    await engine2.loadDocument('d2', saved.ok ? saved.value : 'x');
    const reopened = await pageTexts(engine2, 'd2');
    console.log('[A9] after save+reopen=', JSON.stringify(reopened[0]));
    // Replace the freshly drawn PUBLIC glyphs.
    const again = await engine.replaceText('d', {
      occurrences: [{ page: 1, rect: runRect(700), find: 'PUBLIC' }],
      replacement: 'FINAL',
    });
    console.log('[A9] again=', again.ok ? JSON.stringify({ replaced: again.value.replaced, skipped: again.value.skipped }) : JSON.stringify(again));
    const pages2 = await pageTexts(engine, 'd');
    console.log('[A9] after again=', JSON.stringify(pages2[0]));
    expect(pages2[0]).toContain('FINAL');
    expect(pages2[0]).not.toContain('PUBLIC');
    // FINDING: the Phase-10 edit committed after the replace is present after
    // save+reopen but OMITTED by in-session exportText (asserted last so every
    // observation above is printed).
    expect(pages1[0]).toContain('EDITED');
  });

  it('A10 control: editTextRun alone is extractable (baseline for A9)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const edit = await engine.editTextRun('d', {
      page: 1,
      rect: runRect(600),
      newText: 'EDITED',
    });
    expect(edit.ok).toBe(true);
    const pages = await pageTexts(engine, 'd');
    console.log('[A10] edit-alone text=', JSON.stringify(pages[0]));
    expect(pages[0]).toContain('EDITED');
  });

  it('A11 mixed-encodable replacement must not silently drop characters', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const r = await engine.replaceText('d', {
      occurrences: [SECRET_OCC],
      replacement: 'A\u4e2dB',
    });
    const pages = await pageTexts(engine, 'd');
    console.log('[A11] result=', r.ok ? JSON.stringify({ replaced: r.value.replaced, skipped: r.value.skipped }) : JSON.stringify(r), 'text=', JSON.stringify(pages[0]));
    // Accepted DEF-506 behaviour: a partially-drawable replacement is refused
    // loudly (typed engine-error naming the undrawable characters) and the page
    // text is left unchanged. (The previous expectation that the CJK char be
    // DRAWN encoded the DEF-506 break itself; corrected per the TFL-452 brief.)
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');
    expect(pages[0]).toContain('SECRET');
    expect(pages[0]).not.toContain('AB');
  });

  it('A13 diagnostic: dump /Contents streams after replace + edit', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'PUBLIC' });
    const bytes1 = await engine.getDocumentBytes('d');
    await engine.editTextRun('d', { page: 1, rect: runRect(600), newText: 'EDITED' });
    const bytes2 = await engine.getDocumentBytes('d');
    const { PDFDocument: P, PDFName: N, PDFRawStream, PDFArray, decodePDFRawStream } = await import('@cantoo/pdf-lib');
    const dump = async (label: string, ab: ArrayBuffer): Promise<void> => {
      const doc = await P.load(ab);
      const node = doc.getPage(0).node;
      const c = node.Contents();
      const arr = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
      const parts: string[] = [];
      for (const ref of arr) {
        const obj = doc.context.lookup(ref as never);
        try {
          const decoded = decodePDFRawStream(PDFRawStream.of((obj as { dict: unknown }).dict as never, (obj as { getContents: () => Uint8Array }).getContents())).decode();
          parts.push(Buffer.from(decoded).toString('latin1'));
        } catch (e) {
          parts.push(`<undecodable ${String(e)}>`);
        }
      }
      console.log(`[A13] ${label}: ${arr.length} streams`);
      parts.forEach((p, i) => console.log(`[A13] ${label} stream ${i}: ${JSON.stringify(p.slice(0, 1400))}`));
    };
    if (bytes1.ok) await dump('after-replace', bytes1.value);
    if (bytes2.ok) await dump('after-edit', bytes2.value);
  });

  it('A12 overlapping occurrences on one line stay within their own glyphs', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createTwoOnOneLine());
    // Two true hits ("SECRET" at 72 and at the far right). Compute both rects.
    const r = await engine.replaceText('d', {
      occurrences: [
        { page: 1, rect: { x: 60, y: 792 - (700 - 10 + 25), width: 60, height: 25 }, find: 'SECRET' },
        { page: 1, rect: { x: 150, y: 792 - (700 - 10 + 25), width: 70, height: 25 }, find: 'SECRET' },
      ],
      replacement: 'Z',
    });
    console.log('[A12] result=', r.ok ? JSON.stringify({ replaced: r.value.replaced, skipped: r.value.skipped }) : JSON.stringify(r));
    const pages = await pageTexts(engine, 'd');
    console.log('[A12] text=', JSON.stringify(pages[0]));
    expect(pages[0]).toContain('SIBLING');
  });

  it('A14 redact-after-replace on the same page stays consistent', async () => {
    const engine = new EngineService();
    await engine.loadDocument('d', await createSimple());
    const rep = await engine.replaceText('d', { occurrences: [SECRET_OCC], replacement: 'PUBLIC' });
    expect(rep.ok).toBe(true);
    const red = await engine.applyRedactions('d', {
      page: 1,
      marks: [{ rect: { x: 60, y: 792 - (600 - 20 + 40), width: 90, height: 40 } }],
    });
    console.log('[A14] redact=', red.ok ? JSON.stringify({ removed: red.value.removedGlyphs, warnings: red.value.warnings }) : JSON.stringify(red));
    const pages = await pageTexts(engine, 'd');
    console.log('[A14] text=', JSON.stringify(pages[0]));
    // Redacting SIBLING must remove it and leave the replaced PUBLIC intact.
    expect(red.ok).toBe(true);
    expect(pages[0]).toContain('PUBLIC');
    expect(pages[0]).not.toContain('SIBLING');
  });
});

describe('adv449 pure planReplace probes', () => {
  const fixed: RedactionAdvanceResolver = (_f, _s, t) => new Array(t.length).fill(500);
  const rect = (x: number, y: number, w: number, h: number): AnnRect => ({ x, y, width: w, height: h });

  it('B1 a match spanning multiple show strings of one TJ array', () => {
    const content = 'BT /F1 12 Tf 10 20 Td [(HEL) -20 (LO)] TJ ET';
    const plan = planReplace(content, [{ page: 1, rect: rect(8, 15, 40, 18), find: 'HELLO' }], 'X', fixed);
    console.log('[B1] removed=', plan.removedGlyphs, 'skipped=', JSON.stringify(plan.skipped));
    // A word rendered as one TJ array is a single visible run; a user expects
    // it replaced. Safe expectation: it is at least not silently dropped.
    expect(plan.skipped.length).toBe(0);
  });

  it('B2 match split by a Tf font switch', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (HEL) Tj /F2 12 Tf (LO) Tj ET';
    const plan = planReplace(content, [{ page: 1, rect: rect(8, 15, 40, 18), find: 'HELLO' }], 'X', fixed);
    console.log('[B2] removed=', plan.removedGlyphs, 'skipped=', JSON.stringify(plan.skipped));
    expect(plan.skipped.length).toBe(0);
  });

  it('B3 match inside a q/Q/cm scaled transform stays bounded', () => {
    // 0.5 scale about origin; HELLO at size 12, advance 0.5em = 6pt.
    // glyph i spans x = (10+6i)..(10+6i+6) in text space -> 0.5x in user
    // space = 5+3i..8+3i; baseline y 20 -> 10; ink band 10..15.1.
    // "ELL" = glyphs 1..3 -> x 8..17, y 10..15.1.
    const content = 'q 0.5 0 0 0.5 0 0 cm BT /F1 12 Tf 10 20 Td (HELLO) Tj ET Q';
    const plan = planReplace(content, [{ page: 1, rect: rect(8.2, 10.2, 8.6, 4.6), find: 'ELL' }], 'X', fixed);
    console.log('[B3] removed=', plan.removedGlyphs, 'skipped=', JSON.stringify(plan.skipped), 'content=', JSON.stringify(plan.content));
    expect(plan.removedGlyphs).toBe(3);
  });

  it('B4 find containing a space (word spacing) still matches', () => {
    // HELLO WORLD at size 12, advance 6pt per glyph: "LO WO" starts after
    // "HEL" (3 glyphs = x 10..28) and spans 5 glyphs to x 58.
    const content = 'BT /F1 12 Tf 10 20 Td (HELLO WORLD) Tj ET';
    const plan = planReplace(content, [{ page: 1, rect: rect(28.6, 15, 29.3, 18), find: 'LO WO' }], 'X', fixed);
    console.log('[B4] removed=', plan.removedGlyphs, 'skipped=', JSON.stringify(plan.skipped));
    expect(plan.skipped.length).toBe(0);
    expect(plan.removedGlyphs).toBe(5);
  });
});
