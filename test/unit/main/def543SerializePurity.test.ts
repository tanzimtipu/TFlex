// DEF-543 — read-op purity must not depend on the wall clock.
//
// `getWatermarks` / `getBates` list markers by reading page content streams,
// and the renderer refreshes its proxy through `getDocumentBytes`. A pure read
// must leave the serialized bytes BIT-IDENTICAL. pdf-lib's `PDFDocument.create()`
// stamps /ModDate (and /CreationDate) with the current second, so before the
// fix two serializations that straddled a one-second boundary differed, making
// the QA probe order-dependent. This test pins the fix without sleeping: it
// advances the fake clock between the two serializations and requires the bytes
// to stay equal, and it re-parses the output to prove it is still a valid PDF.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def543-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`PAGE-${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  const path = join(dir, 'def543.pdf');
  await writeFile(path, Buffer.from(await doc.save()));
  return path;
}

describe('DEF-543 — serialization is a pure function of the document, not the clock', () => {
  it('two getDocumentBytes calls a second apart are byte-identical', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const engine = new EngineService();
    await engine.loadDocument('doc-1', await fixture());

    const first = await engine.getDocumentBytes('doc-1');
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);

    // Cross a second boundary: without the fix pdf-lib would re-stamp /ModDate
    // here and the two outputs would differ by the timestamp bytes alone.
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));

    const second = await engine.getDocumentBytes('doc-1');
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);

    expect(Buffer.from(new Uint8Array(second.value))).toEqual(
      Buffer.from(new Uint8Array(first.value)),
    );

    // The deterministic output is still a parseable PDF with the source pages.
    const parsed = await PDFDocument.load(new Uint8Array(second.value), {
      updateMetadata: false,
    });
    expect(parsed.getPageCount()).toBe(3);
    // The output carries the document's own timestamps, not the fake clock.
    expect(parsed.getModificationDate()?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('getWatermarks then getDocumentBytes leaves the bytes unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'));

    const engine = new EngineService();
    await engine.loadDocument('doc-1', await fixture());

    const before = await engine.getDocumentBytes('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.error.message);

    const listed = await engine.getWatermarks('doc-1');
    expect(listed.ok).toBe(true);

    vi.setSystemTime(new Date('2026-02-02T00:00:09.000Z'));

    const after = await engine.getDocumentBytes('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.error.message);

    expect(Buffer.from(new Uint8Array(after.value))).toEqual(
      Buffer.from(new Uint8Array(before.value)),
    );
  });
});