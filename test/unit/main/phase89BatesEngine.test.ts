// Phase 89 (FEA-033) chunk B — engine.addBates round-trips.
//
// Proves the op bakes each label onto exactly its selected page (text
// extraction and the distinct `%TFLEX-BATES ` marker agree), leaves unselected
// pages unchanged, is ONE undo entry, survives serializeDoc + reopen, sequences
// labels with padding in list order, and refuses empty / out-of-range /
// duplicate / bad-padding / unencodable payloads leaving the bytes unchanged.

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
  dir = await mkdtemp(join(tmpdir(), 'tflex-bates-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PAGE_WORDS = ['PAGE-ONE', 'PAGE-TWO', 'PAGE-THREE'];

async function createFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < PAGE_WORDS.length; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(PAGE_WORDS[i], { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, 'bates-fixture.pdf');
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

/** Decode a page's (possibly multi-stream, possibly compressed) content. */
function decodePage(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const resolve = (r: unknown): any => {
    let o: any = doc.context.lookup(r as never);
    while (o && o.constructor?.name === 'PDFRef') o = doc.context.lookup(o);
    return o;
  };
  const read = (o: any): string => {
    if (!o) return '';
    if (o.constructor?.name === 'PDFArray' || o instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < o.size(); i++) out += read(resolve(o.get(i)));
      return out;
    }
    if (o.contents) {
      try { return inflateSync(o.contents as Uint8Array).toString('latin1'); }
      catch { return Buffer.from(o.contents as Uint8Array).toString('latin1'); }
    }
    return '';
  };
  return read(resolve(contents));
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

describe('Phase 89: engine.addBates', () => {
  it('stamps only the selected pages, one label each, with a Bates marker', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r = await engine.addBates('doc-1', settingsFor([1, 3], { prefix: 'BATES-', startNumber: 5, padding: 4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stamped).toEqual([1, 3]);
    expect(r.value.labels).toEqual(['BATES-0005', 'BATES-0006']);
    expect(r.value.state.modified).toBe(true);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('BATES-0005');
    expect(t[1]).not.toContain('BATES-');
    expect(t[2]).toContain('BATES-0006');
    // Sibling fixture text is untouched on every page.
    expect(t[0]).toContain('PAGE-ONE');
    expect(t[1]).toContain('PAGE-TWO');
    expect(t[2]).toContain('PAGE-THREE');

    const parsed = await parse(await bytes(engine, 'doc-1'));
    expect(decodePage(parsed, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 1)).not.toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 2)).toContain('%TFLEX-BATES');
  });

  it('leaves unselected pages byte-identical in extraction before vs after', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await texts(engine, 'doc-1');

    await engine.addBates('doc-1', settingsFor([2], { prefix: 'X', suffix: 'Y' }));
    const after = await texts(engine, 'doc-1');

    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).toContain('X000001Y');
    expect(after[1]).toContain('PAGE-TWO');
  });

  it('labels sequence with padding in selection order, not ascending order', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const r = await engine.addBates(
      'doc-1',
      settingsFor([3, 1], { prefix: '', suffix: '', startNumber: 10, padding: 3 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.labels).toEqual(['010', '011']);
    const t = await texts(engine, 'doc-1');
    expect(t[2]).toContain('010');
    expect(t[0]).toContain('011');
  });

  it('survives serializeDoc + reopen', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    await engine.addBates('doc-1', settingsFor([1, 2], { prefix: 'R-', padding: 6 }));

    const serialized = await engine.getDocumentBytes('doc-1');
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const reopenPath = join(dir, 'reopen.pdf');
    await writeFile(reopenPath, Buffer.from(new Uint8Array(serialized.value)));

    const engine2 = new EngineService();
    await engine2.loadDocument('doc-2', reopenPath);
    const t = await texts(engine2, 'doc-2');
    expect(t[0]).toContain('R-000001');
    expect(t[1]).toContain('R-000002');
    expect(t[2]).not.toContain('R-');

    const parsed = await parse(await bytes(engine2, 'doc-2'));
    expect(decodePage(parsed, 0)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 1)).toContain('%TFLEX-BATES');
    expect(decodePage(parsed, 2)).not.toContain('%TFLEX-BATES');
  });

  it('is exactly ONE undo entry that restores the pre-stamp state', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());
    const before = await texts(engine, 'doc-1');

    const r = await engine.addBates('doc-1', settingsFor([1, 2, 3], { prefix: 'U' }));
    expect(r.ok).toBe(true);
    expect((await texts(engine, 'doc-1'))[0]).toContain('U000001');

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const restored = await texts(engine, 'doc-1');
    expect(restored).toEqual(before);

    const undoAgain = await engine.undo('doc-1');
    expect(undoAgain.ok).toBe(false);
    if (!undoAgain.ok) expect(undoAgain.error.code).toBe('nothing-to-undo');
  });

  it('DEF-513: a bundled font accepts a prefix its embedded glyphs cover (U+03A9)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r = await engine.addBates(
      'doc-1',
      settingsFor([1], { font: 'DejaVu Serif', prefix: '\u03a9' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stamped).toEqual([1]);
    expect(r.value.labels).toEqual(['\u03a9000001']);
    expect(r.value.labels.some((l) => l.includes('\u03a9'))).toBe(true);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('\u03a9000001');

    // Exactly ONE undo entry backs the accepted op.
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);
    const undoAgain = await engine.undo('doc-1');
    expect(undoAgain.ok).toBe(false);
    if (!undoAgain.ok) expect(undoAgain.error.code).toBe('nothing-to-undo');
  });

  it('DEF-513: a bundled font accepts a prefix its embedded glyphs cover (U+0101)', async () => {
    const engine = new EngineService();
    await engine.loadDocument('doc-1', await createFixture());

    const r = await engine.addBates(
      'doc-1',
      settingsFor([1], { font: 'DejaVu Serif', prefix: '\u0101' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.labels).toEqual(['\u0101000001']);

    const t = await texts(engine, 'doc-1');
    expect(t[0]).toContain('\u0101000001');
  });

  it('refuses empty / out-of-range / duplicate / bad padding / unencodable, bytes unchanged', async () => {
    const cases: { name: string; s: unknown; code: string }[] = [
      { name: 'empty', s: settingsFor([]), code: 'empty-range' },
      { name: 'too-high', s: settingsFor([4]), code: 'out-of-range' },
      { name: 'zero', s: settingsFor([0]), code: 'out-of-range' },
      { name: 'fraction', s: settingsFor([1.5]), code: 'out-of-range' },
      { name: 'duplicate', s: settingsFor([2, 2]), code: 'out-of-range' },
      { name: 'bad-padding', s: settingsFor([1], { padding: 2.5 }), code: 'engine-error' },
      { name: 'unencodable', s: settingsFor([1], { prefix: '\u6587' }), code: 'engine-error' },
    ];
    for (const c of cases) {
      const engine = new EngineService();
      await engine.loadDocument('doc-1', await createFixture());
      const before = await bytes(engine, 'doc-1');

      const r = await engine.addBates('doc-1', c.s as BatesSettings);
      expect(r.ok, c.name).toBe(false);
      if (!r.ok) expect(r.error.code, c.name).toBe(c.code);

      const after = await bytes(engine, 'doc-1');
      expect(after, c.name).toEqual(before);
      const undo = await engine.undo('doc-1');
      expect(undo.ok, c.name).toBe(false);
      if (!undo.ok) expect(undo.error.code).toBe('nothing-to-undo');
    }
  });
});

