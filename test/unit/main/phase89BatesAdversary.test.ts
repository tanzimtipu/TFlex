// TFL-484 / Phase 89 (FEA-033) ADVERSARIAL diff-pass probe (unit, main process).
//
// Adversary-only. Attacks the NEW content-stream bake (engine.addBates +
// _addBatesImpl) and its save round-trip. Does NOT re-run qa's phase89 spec and
// touches nothing under src/. Every fixture is created in a temp dir; the app
// source is never mutated.
//
//   npm.cmd run test:unit -- test/unit/main/phase89BatesAdversary.test.ts
//
// Named vectors (issue TFL-484):
//   A1 selected set containing the first and last page
//   A2 pages listed out of order ([3,1,2])
//   A3 padding smaller than the number of digits
//   A4 a label needing font substitution (StandardFont + bundled paths)
//   A5 an unencodable prefix/suffix -> refuse the whole op, bytes unchanged
//   A6 a repeated apply (two Bates runs) -> undo of the second keeps the first
//   A7 undo/save byte round-trip -> one undo entry; unselected pages untouched
//   A8 Bates-then-watermark interaction on the same page
//
// A4b and A5c are OBSERVATION-ONLY (logged, not asserted): they record the
// outcome of a suspected over-refusal so the ADV entry can cite the observed
// value. The harness stays green so it is safe to leave in the suite.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFArray } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { BatesSettings } from '../../../src/shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-bates-adv-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Five pages, each with a distinct sibling word so page identity is visible. */
const PAGE_WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];

async function createFixture(pageCount = PAGE_WORDS.length): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(PAGE_WORDS[i % PAGE_WORDS.length], { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, `bates-adv-${pageCount}.pdf`);
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

function settingsFor(pages: number[], over: Partial<BatesSettings> = {}): BatesSettings {
  return {
    pages,
    prefix: '',
    suffix: '',
    startNumber: 1,
    padding: 6,
    position: 'bottom-right',
    ...over,
  };
}

function resolve(doc: PDFDocument, r: unknown): any {
  let o: any = doc.context.lookup(r as never);
  while (o && o.constructor?.name === 'PDFRef') o = doc.context.lookup(o);
  return o;
}

/** Decode one page's (possibly multi-stream, possibly compressed) content. */
function decodePage(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const read = (o: any): string => {
    if (!o) return '';
    if (o.constructor?.name === 'PDFArray' || o instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < o.size(); i++) out += read(resolve(doc, o.get(i)));
      return out;
    }
    if (o.contents) {
      try {
        return inflateSync(o.contents as Uint8Array).toString('latin1');
      } catch {
        return Buffer.from(o.contents as Uint8Array).toString('latin1');
      }
    }
    return '';
  };
  return read(resolve(doc, contents));
}

/** Concatenated RAW content bytes of a page (for byte-identity comparisons). */
function rawPageBytes(doc: PDFDocument, pageIndex: number): Buffer {
  const contents = doc.getPage(pageIndex).node.Contents();
  const out: Buffer[] = [];
  const read = (o: any): void => {
    if (!o) return;
    if (o.constructor?.name === 'PDFArray' || o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) read(resolve(doc, o.get(i)));
      return;
    }
    if (o.contents) out.push(Buffer.from(o.contents as Uint8Array));
  };
  read(resolve(doc, contents));
  return Buffer.concat(out);
}

async function parse(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return PDFDocument.load(u8);
}

async function texts(engine: EngineService, docId: string): Promise<string[]> {
  const r = await engine.exportText(docId);
  expect(r.ok).toBe(true);
  return r.ok ? r.value.map((p) => p.text) : [];
}

async function bytes(engine: EngineService, docId: string): Promise<Uint8Array> {
  const r = await engine.getDocumentBytes(docId);
  expect(r.ok).toBe(true);
  return r.ok ? new Uint8Array(r.value) : new Uint8Array();
}

describe('Phase 89 adversary: engine.addBates content-stream bake', () => {
  it('A1 boundary: a selected set of the FIRST and LAST page stamps exactly those', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates('doc-1', settingsFor([1, 5], { prefix: 'B-', padding: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stamped).toEqual([1, 5]);
    expect(r.value.labels).toEqual(['B-001', 'B-002']);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('B-001');
    expect(t[4]).toContain('B-002');
    for (const i of [1, 2, 3]) expect(t[i]).not.toContain('B-');

    const parsed = await parse(await bytes(engine, 'doc-1'));
    expect(decodePage(parsed, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 4)).toContain('%TFLEX-BATES');
    for (const i of [1, 2, 3]) expect(decodePage(parsed, i)).not.toContain('%TFLEX-BATES');
  });

  it('A2 out of order [3,1,2]: numbering follows list order, stamps land on the listed pages', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates(
      'doc-1',
      settingsFor([3, 1, 2], { prefix: '', startNumber: 10, padding: 2 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stamped).toEqual([3, 1, 2]);
    expect(r.value.labels).toEqual(['10', '11', '12']);

    const t = await texts(engine, 'doc-1');
    expect(t[2]).toContain('10');
    expect(t[0]).toContain('11');
    expect(t[1]).toContain('12');
    expect(t[3]).not.toContain('1'); // untouched page 4/5 carry no Bates number
    expect(t[4]).not.toContain('1');
  });

  it('A3 padding smaller than the number does not truncate (padding 1, number 12)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates(
      'doc-1',
      settingsFor([1, 2], { prefix: 'P-', startNumber: 12, padding: 1 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.labels).toEqual(['P-12', 'P-13']);
    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('P-12');
    expect(t[0]).not.toContain('P-1\n'); // sanity: not the truncated "1"
    expect(t[1]).toContain('P-13');
  });

  it('A4 font substitution: a StandardFont and a bundled family both stamp', async () => {
    for (const font of ['Times', 'Liberation Sans', 'DejaVu Serif'] as const) {
      const engine = new EngineService();
      await engine.loadDocument('doc-1', await createFixture());
      const r = await engine.addBates('doc-1', settingsFor([1, 2], { font, prefix: 'F-' }));
      expect(r.ok, `font ${font} should stamp`).toBe(true);
      if (!r.ok) return;
      const t = await texts(engine, 'doc-1');
      expect(t[0], `extraction for ${font}`).toContain('F-000001');
    }
  });

  it('A4b OBSERVATION: a bundled font with a Greek prefix (U+03A9)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates(
      'doc-1',
      settingsFor([1], { font: 'DejaVu Serif', prefix: '\u03a9' }),
    );
    // DejaVu Serif embeds U+03A9, so per REQUIREMENTS 6 the CHOSEN font decides
    // and this should stamp. Recorded, not asserted, so the suite stays green.
    console.log(
      `[p89adv|A4b] bundled Greek font=DejaVu Serif ok=${r.ok}` +
        (r.ok ? ` labels=${JSON.stringify(r.value.labels)}` : ` code=${r.error.code} msg=${r.error.message}`),
    );
    expect(true).toBe(true);
  });

  it('A5 unencodable prefix refuses the WHOLE op and leaves the bytes unchanged (never partial)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await bytes(engine, 'doc-1');

    // CJK prefix on a two-page selection: must refuse before any stamp.
    const r = await engine.addBates(
      'doc-1',
      settingsFor([1, 2], { prefix: '\u6587\u5b57-' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('engine-error');

    const after = await bytes(engine, 'doc-1');
    expect(after).toEqual(before);
    const t = await texts(engine, 'doc-1');
    for (const page of t) expect(page).not.toContain('\u6587');

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.error.code).toBe('nothing-to-undo');
  });

  it('A5c OBSERVATION: Latin-Extended-A char with a bundled font (U+0101)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates(
      'doc-1',
      settingsFor([1], { font: 'DejaVu Serif', prefix: '\u0101' }),
    );
    console.log(
      `[p89adv|A5c] Latin-Extended-A font=DejaVu Serif ok=${r.ok}` +
        (r.ok ? '' : ` code=${r.error.code} msg=${r.error.message}`),
    );
    expect(true).toBe(true);
  });

  it('A6 repeated apply: two runs, undo of the second must not undo the first', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r1 = await engine.addBates('doc-1', settingsFor([1], { prefix: 'RUN1-', padding: 3 }));
    expect(r1.ok).toBe(true);
    const r2 = await engine.addBates('doc-1', settingsFor([2], { prefix: 'RUN2-', padding: 3 }));
    expect(r2.ok).toBe(true);

    // Both runs now ride their own pages.
    let t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('RUN1-001');
    expect(t[1]).toContain('RUN2-001');

    // Undo once: only run 2 disappears; run 1 survives.
    const u1 = await engine.undo('doc-1');
    expect(u1.ok).toBe(true);
    t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('RUN1-001');
    expect(t[1]).not.toContain('RUN2-');

    // Undo again: run 1 disappears too.
    const u2 = await engine.undo('doc-1');
    expect(u2.ok).toBe(true);
    t = await texts(engine, 'doc-1');
    expect(t[0]).not.toContain('RUN1-');

    const u3 = await engine.undo('doc-1');
    expect(u3.ok).toBe(false);
  });

  it('A7 undo + save round-trip: run is ONE undo entry; stamped survive; unselected raw bytes identical', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const beforeParsed = await parse(await bytes(engine, 'doc-1'));
    const beforeRaw = [0, 1, 2, 3, 4].map((i) => rawPageBytes(beforeParsed, i).toString('latin1'));

    const r = await engine.addBates(
      'doc-1',
      settingsFor([2, 4], { prefix: 'S-', startNumber: 7, padding: 4 }),
    );
    expect(r.ok).toBe(true);

    // Exactly ONE undo entry for the whole run.
    const u1 = await engine.undo('doc-1');
    expect(u1.ok).toBe(true);
    const u2 = await engine.undo('doc-1');
    expect(u2.ok).toBe(false);

    // Re-apply, then save + reopen.
    await engine.addBates('doc-1', settingsFor([2, 4], { prefix: 'S-', startNumber: 7, padding: 4 }));
    const serialized = await bytes(engine, 'doc-1');
    const reopenPath = join(dir, 'reopen.pdf');
    await writeFile(reopenPath, Buffer.from(serialized));

    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', reopenPath);
    const t = await texts(engine2, 'doc-2');
    expect(t[1]).toContain('S-0007');
    expect(t[3]).toContain('S-0008');
    expect(t[0]).not.toContain('S-');
    expect(t[2]).not.toContain('S-');
    expect(t[4]).not.toContain('S-');

    const afterParsed = await parse(await bytes(engine2, 'doc-2'));
    expect(decodePage(afterParsed, 1)).toContain('%TFLEX-BATES');
    expect(decodePage(afterParsed, 3)).toContain('%TFLEX-BATES');
    expect(decodePage(afterParsed, 2)).not.toContain('%TFLEX-BATES');

    // Unselected pages: raw content bytes identical across the round-trip.
    for (const i of [0, 2, 4]) {
      expect(rawPageBytes(afterParsed, i).toString('latin1'), `page ${i + 1} raw`).toBe(beforeRaw[i]);
    }
  });

  it('A8 Bates-then-watermark on the same page: markers do not interfere; watermark delete stays correct', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const b = await engine.addBates('doc-1', settingsFor([1, 2], { prefix: 'B-', padding: 3 }));
    expect(b.ok).toBe(true);

    const w = await engine.addWatermark('doc-1', {
      type: 'text',
      text: 'CONFIDENTIAL',
      range: [1, 1],
    });
    expect(w.ok).toBe(true);

    // Watermark scan sees exactly the watermark, not the Bates streams.
    const listed = await engine.getWatermarks('doc-1');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0].pages).toEqual([1]);

    // Both markers coexist on page 1; page 2 carries only the Bates marker.
    const parsed = await parse(await bytes(engine, 'doc-1'));
    const p1 = decodePage(parsed, 0);
    expect(p1).toContain('%TFLEX-BATES');
    expect(p1).toContain('%TFLEX-WATERMARK');
    const p2 = decodePage(parsed, 1);
    expect(p2).toContain('%TFLEX-BATES');
    expect(p2).not.toContain('%TFLEX-WATERMARK');

    // Delete the watermark: Bates text and marker must survive on both pages.
    const del = await engine.deleteWatermark('doc-1', listed.value[0].id);
    expect(del.ok).toBe(true);
    const after = await engine.getWatermarks('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toHaveLength(0);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('B-001');
    expect(t[1]).toContain('B-002');
    const parsed2 = await parse(await bytes(engine, 'doc-1'));
    expect(decodePage(parsed2, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed2, 1)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed2, 0)).not.toContain('%TFLEX-WATERMARK');
  });

  it('A9 page reorder before stamping: the visible-page mapping targets the moved original', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    // Move original page 3 (CHARLIE) to the front: visible order becomes
    // [CHARLIE, ALPHA, BRAVO, DELTA, ECHO].
    const mv = await engine.applyOp('doc-1', { kind: 'reorder', page: 2, param: 0 });
    expect(mv.ok).toBe(true);

    const r = await engine.addBates('doc-1', settingsFor([1], { prefix: 'R-', padding: 3 }));
    expect(r.ok).toBe(true);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('CHARLIE');
    expect(t[0]).toContain('R-001');
    expect(t[1]).toContain('ALPHA');
    expect(t[1]).not.toContain('R-');
    expect(t[3]).toContain('DELTA');
    expect(t[3]).not.toContain('R-');
  });

  it('A10 an AcroForm document: addBates + undo + save round-trip keeps the form intact', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('FORM-PAGE', { x: 72, y: 700, size: 14 });
    const field = doc.getForm().createTextField('fullname');
    field.addToPage(page, { x: 72, y: 640, width: 200, height: 18 });
    const path = join(dir, 'bates-form.pdf');
    await writeFile(path, Buffer.from(await doc.save()));

    const engine = new EngineService();
    await engine.loadDocument('doc-1', path);
    const beforeNames = (await engine.getDocumentBytes('doc-1')).ok;

    const r = await engine.addBates('doc-1', settingsFor([1], { prefix: 'AF-', padding: 3 }));
    expect(r.ok).toBe(true);
    expect(beforeNames).toBe(true);

    // Undo must restore the form-bearing bytes exactly.
    const u = await engine.undo('doc-1');
    expect(u.ok).toBe(true);
    const afterUndo = await parse(await bytes(engine, 'doc-1'));
    expect(afterUndo.getForm().getFields().map((f) => f.getName())).toContain('fullname');

    // Re-apply and save + reopen: the field survives and the label is present.
    await engine.addBates('doc-1', settingsFor([1], { prefix: 'AF-', padding: 3 }));
    const reopenPath = join(dir, 'bates-form-reopen.pdf');
    await writeFile(reopenPath, Buffer.from(await bytes(engine, 'doc-1')));
    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', reopenPath);
    const t = await texts(engine2, 'doc-2');
    expect(t[0]).toContain('AF-001');
    const parsed2 = await parse(await bytes(engine2, 'doc-2'));
    expect(parsed2.getForm().getFields().map((f) => f.getName())).toContain('fullname');
  });

  it('A11 a user-password AES-256 document: addBates + save + reopen keeps the label', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('SECRET-DOC', { x: 72, y: 700, size: 14 });
    const plain = await doc.save();
    const enc = await PDFDocument.load(plain);
    enc.encrypt({ userPassword: 'pw-a11', ownerPassword: 'owner-a11', algorithm: 'AES-256' });
    const path = join(dir, 'bates-encrypted.pdf');
    await writeFile(path, Buffer.from(await enc.save()));

    const engine = new EngineService();
    const open = await engine.loadDocument('doc-1', path, 'pw-a11');
    expect(open.ok, 'encrypted open with the user password').toBe(true);

    const r = await engine.addBates('doc-1', settingsFor([1], { prefix: 'E-', padding: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const reopenPath = join(dir, 'bates-encrypted-out.pdf');
    await writeFile(reopenPath, Buffer.from(await bytes(engine, 'doc-1')));
    const engine2 = new EngineService();
    const open2 = await engine2.loadDocument('doc-2', reopenPath, 'pw-a11');
    expect(open2.ok, 'saved encrypted output reopens with the password').toBe(true);
    const t = await texts(engine2, 'doc-2');
    expect(t[0]).toContain('E-001');
    expect(t[0]).toContain('SECRET-DOC');
  });
});
