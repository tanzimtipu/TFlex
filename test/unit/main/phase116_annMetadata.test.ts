import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import {
  parseAnnotationsFromDoc,
  serializeAnnotations,
} from '../../../src/main/services/annotations';
import type { AnnModel } from '../../../src/shared/types';

// Phase 116 - the annotation dict's real /T (author) and /M (modified date)
// must be read verbatim and re-serialized additively, present only when the
// document carries a non-empty value; absent stays absent (never '').

const AUTHOR = 'Ada Example';
const MODIFIED = 'D:20260101120000Z';

function hasOwn(obj: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

async function buildSourceBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const withMeta = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [72, 700, 172, 720],
    C: [1, 1, 0],
    Contents: PDFString.of('has metadata'),
    T: PDFString.of(AUTHOR),
    M: PDFString.of(MODIFIED),
  });
  const plain = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [72, 640, 172, 660],
    C: [1, 1, 0],
    Contents: PDFString.of('plain'),
  });
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([doc.context.register(withMeta), doc.context.register(plain)]),
  );
  return doc.save();
}

function byContent(anns: AnnModel[], content: string): AnnModel | undefined {
  return anns.find((a) => a.content === content);
}

describe('annotation /T + /M metadata (phase 116)', () => {
  it('parses the real author + modified date, and omits both when absent', async () => {
    const doc = await PDFDocument.load(await buildSourceBytes());
    const anns = parseAnnotationsFromDoc(doc)[0];

    const withMeta = byContent(anns, 'has metadata');
    const plain = byContent(anns, 'plain');

    expect(withMeta).toBeDefined();
    expect(withMeta?.author).toBe(AUTHOR);
    expect(withMeta?.modifiedAt).toBe(MODIFIED);

    expect(plain).toBeDefined();
    expect(hasOwn(plain, 'author')).toBe(false);
    expect(hasOwn(plain, 'modifiedAt')).toBe(false);
  });

  it('survives serialize -> save -> reload -> reparse', async () => {
    const source = await PDFDocument.load(await buildSourceBytes());
    const parsed = parseAnnotationsFromDoc(source);

    const out = await PDFDocument.create();
    out.addPage([612, 792]);
    await serializeAnnotations(out, parsed, [0]);
    const saved = await out.save();

    const reloaded = await PDFDocument.load(saved);
    const anns = parseAnnotationsFromDoc(reloaded)[0];

    const withMeta = byContent(anns, 'has metadata');
    const plain = byContent(anns, 'plain');

    expect(withMeta?.author).toBe(AUTHOR);
    expect(withMeta?.modifiedAt).toBe(MODIFIED);
    expect(plain).toBeDefined();
    expect(hasOwn(plain, 'author')).toBe(false);
    expect(hasOwn(plain, 'modifiedAt')).toBe(false);
  });
});
