import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { EngineService } from '../../../src/main/services/engine';
import type { CreateAnnotationPayload } from '../../../src/shared/types';

// DEF-165: Square/Circle (rect/ellipse) shapes must NOT bake the renderer's
// 10%-alpha overlay fill as a solid /IC. /IC is a plain RGB array with no
// alpha channel, so any value there paints an opaque block that hides page
// text on reopen in Acrobat/pdf.js/TFlex. The fix omits /IC and emits a /AP
// appearance stream that fills the shape translucently via `ca`.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def165-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function createOnePagePdfWithText(text: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(text, { x: 72, y: 700, size: 14, font });
  const bytes = await doc.save();
  return writeFixture('src.pdf', bytes);
}

function makePayload(overrides: Partial<CreateAnnotationPayload>): CreateAnnotationPayload {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'text-box',
    page: 1,
    rects: [{ x: 100, y: 500, width: 200, height: 50 }],
    color: 'blue',
    ...overrides,
  };
}

function hexOperand(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase();
}

/** Decode a stream object's content bytes to latin1 text, inflating if the
 *  stream is Flate-encoded (pdf-lib may compress on save). Mirrors the helper
 *  in def130_131_124.test.ts. */
function decodeStreamText(doc: PDFDocument, streamObj: unknown): string {
  let obj = streamObj;
  if (obj instanceof PDFRef) {
    obj = doc.context.lookup(obj);
  }
  if (!(obj instanceof PDFStream)) return '';
  const raw = (obj as PDFRawStream).contents as unknown as Uint8Array;
  if (!raw || typeof raw.length !== 'number') return '';
  try {
    const dec = inflateSync(raw);
    return new TextDecoder('latin1').decode(dec);
  } catch {
    try {
      return new TextDecoder('latin1').decode(raw);
    } catch {
      return '';
    }
  }
}

/** Decode page-0's /Contents (single ref or array) to latin1 text so the
 *  underlying page text can be searched — proves the shape did not replace
 *  the page content stream. */
async function decodedPage0Content(path: string): Promise<string> {
  const fileBytes = await readFile(path);
  const doc = await PDFDocument.load(fileBytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return '';
  const lookup = (ref: unknown): string => {
    const obj = doc.context.lookup(ref as any);
    if (!obj) return '';
    if (obj instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < obj.size(); i++) out += lookup(obj.get(i));
      return out;
    }
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents as unknown as Uint8Array;
      if (!raw || typeof raw.length !== 'number') return '';
      try {
        const dec = inflateSync(raw);
        return new TextDecoder('latin1').decode(dec);
      } catch {
        try {
          return new TextDecoder('latin1').decode(raw);
        } catch {
          return '';
        }
      }
    }
    return '';
  };
  return lookup(contents);
}

/** Walk the saved file's /Annots on page 0 and return a map of
 *  /Subtype-name -> annotation dict. */
async function readPage0Annots(savePath: string): Promise<Map<string, PDFDict>> {
  const buf = await readFile(savePath);
  const reparsed = await PDFDocument.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const page = reparsed.getPage(0);
  const leaf = (page as any).node as PDFDict;
  const annotsRef = leaf.get(PDFName.of('Annots'));
  let annots: unknown = annotsRef;
  if (annotsRef instanceof PDFRef) {
    annots = reparsed.context.lookup(annotsRef);
  }
  const map = new Map<string, PDFDict>();
  if (annots instanceof PDFArray) {
    for (let j = 0; j < annots.size(); j++) {
      const ref = annots.get(j);
      let obj: unknown = ref;
      if (ref instanceof PDFRef) {
        obj = reparsed.context.lookup(ref);
      }
      if (obj instanceof PDFDict) {
        const st = obj.get(PDFName.of('Subtype'));
        if (st instanceof PDFName) {
          map.set(st.asString().slice(1), obj);
        }
      }
    }
  }
  return map;
}

/** Look up the /AP /N appearance stream of an annotation and decode it. */
async function decodeAnnotAP(savePath: string, annot: PDFDict): Promise<string> {
  const buf = await readFile(savePath);
  const doc = await PDFDocument.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const ap = annot.get(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return '';
  const n = ap.get(PDFName.of('N'));
  return decodeStreamText(doc, n);
}

/** Resolve the /AP /N /Resources /ExtGState /G1 ExtGState dict of the
 *  page-0 annotation with the given /Subtype (DEF-165 re-fix: the fill/stroke
 *  alpha must live in an ExtGState resource, NOT as inline `ca`/`CA` content
 *  tokens). Loads its own doc so every ref resolves in one context. */
async function readAnnotAPExtGState(savePath: string, subtype: string): Promise<PDFDict | undefined> {
  const buf = await readFile(savePath);
  const doc = await PDFDocument.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const page = doc.getPage(0);
  const leaf = (page as any).node as PDFDict;
  const annotsRef = leaf.get(PDFName.of('Annots'));
  let annots: unknown = annotsRef;
  if (annotsRef instanceof PDFRef) annots = doc.context.lookup(annotsRef);
  if (!(annots instanceof PDFArray)) return undefined;
  for (let j = 0; j < annots.size(); j++) {
    let obj: unknown = annots.get(j);
    if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
    if (!(obj instanceof PDFDict)) continue;
    const st = obj.get(PDFName.of('Subtype'));
    if (!(st instanceof PDFName) || st.asString().slice(1) !== subtype) continue;
    const ap = obj.get(PDFName.of('AP'));
    if (!(ap instanceof PDFDict)) return undefined;
    const n = ap.get(PDFName.of('N'));
    let nObj: unknown = n;
    if (n instanceof PDFRef) nObj = doc.context.lookup(n);
    // The /AP /N Form XObject is a PDFStream (a dict with content); its
    // /Resources live on the stream's dict.
    const nDict: PDFDict | undefined =
      nObj instanceof PDFStream ? nObj.dict : nObj instanceof PDFDict ? nObj : undefined;
    if (nDict === undefined) return undefined;
    const res = nDict.get(PDFName.of('Resources'));
    let resObj: unknown = res;
    if (res instanceof PDFRef) resObj = doc.context.lookup(res);
    if (!(resObj instanceof PDFDict)) return undefined;
    const ext = resObj.get(PDFName.of('ExtGState'));
    let extObj: unknown = ext;
    if (ext instanceof PDFRef) extObj = doc.context.lookup(ext);
    if (!(extObj instanceof PDFDict)) return undefined;
    const g1 = extObj.get(PDFName.of('G1'));
    let g1Obj: unknown = g1;
    if (g1 instanceof PDFRef) g1Obj = doc.context.lookup(g1);
    return g1Obj instanceof PDFDict ? g1Obj : undefined;
  }
  return undefined;
}

/** Load the saved file with pdfjs-dist (a third-party PDF engine) and return
 *  the parsed page-0 annotations, proving the ExtGState-bearing /AP is
 *  accepted and recognized as a baked appearance (`hasAppearance: true`). */
async function pdfjsPage0Annotations(savePath: string): Promise<{ subtype: string; hasAppearance: boolean }[]> {
  const buf = await readFile(savePath);
  // Hand pdfjs a fresh copy — getDocument transfers (detaches) the buffer.
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const page = await pdf.getPage(1);
  const anns = await page.getAnnotations();
  await pdf.destroy();
  return anns.map((a: any) => ({ subtype: a.subtype as string, hasAppearance: a.hasAppearance as boolean }));
}

describe('DEF-165: rect/ellipse fill must not bake opaque /IC', () => {
  it('rect: /IC absent, /AP fills translucently (ca 0.1), page text intact', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdfWithText('BEHIND_SHAPE_TEXT');
    await engine.loadDocument('doc', srcPath);

    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'rect',
      rects: [{ x: 60, y: 680, width: 200, height: 60 }],
      color: 'blue',
      width: 2,
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'rect.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const annots = await readPage0Annots(savePath);
    const sq = annots.get('Square');
    expect(sq).toBeDefined();
    // Core regression: no opaque interior color array.
    expect(sq!.get(PDFName.of('IC'))).toBeUndefined();
    // Stroke color (/C) still present so the border renders.
    expect(sq!.get(PDFName.of('C'))).toBeInstanceOf(PDFArray);

    const ap = sq!.get(PDFName.of('AP'));
    expect(ap instanceof PDFDict).toBe(true);
    const text = await decodeAnnotAP(savePath, sq!);
    // DEF-165 re-fix: the alpha is invoked via an ExtGState `gs` operator,
    // NOT emitted as an inline `ca`/`CA` content token (those are invalid
    // content-stream operators that third-party viewers ignore, painting the
    // fill at full alpha).
    expect(text).toMatch(/\/G1 gs/);
    expect(text).not.toMatch(/\b0\.1 ca\b/);
    expect(text).not.toMatch(/\b1 CA\b/);
    // Rectangle path operator present.
    expect(text).toMatch(/re$/m);

    // The /AP /N /Resources /ExtGState /G1 dict carries the alpha parameters.
    const gs = await readAnnotAPExtGState(savePath, 'Square');
    expect(gs).toBeInstanceOf(PDFDict);
    const ca = gs!.get(PDFName.of('ca'));
    expect(ca).toBeInstanceOf(PDFNumber);
    expect((ca as PDFNumber).asNumber()).toBeCloseTo(0.1, 5);
    const CA = gs!.get(PDFName.of('CA'));
    expect(CA).toBeInstanceOf(PDFNumber);
    expect((CA as PDFNumber).asNumber()).toBe(1);

    // Third-party PDF engine (pdfjs-dist) loads the file and recognizes the
    // baked appearance — proving the ExtGState-bearing /AP is well-formed
    // and will be honoured (the fill alpha is applied via the resource, not
    // ignored inline tokens).
    const pdfjsAnns = await pdfjsPage0Annotations(savePath);
    const sqPdfjs = pdfjsAnns.find((a) => a.subtype === 'Square');
    expect(sqPdfjs).toBeDefined();
    expect(sqPdfjs!.hasAppearance).toBe(true);

    // Underlying page text is still in the content stream (the shape is an
    // overlay annotation, not a replacement of page content). pdf-lib encodes
    // text as a hex string operand, so search the hex form.
    const pageContent = await decodedPage0Content(savePath);
    expect(pageContent).toContain(hexOperand('BEHIND_SHAPE_TEXT'));
  });

  it('ellipse: /IC absent, /AP fills translucently (ca 0.1), page text intact', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdfWithText('UNDER_ELLIPSE');
    await engine.loadDocument('doc', srcPath);

    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'ellipse',
      rects: [{ x: 80, y: 660, width: 220, height: 80 }],
      color: 'red',
      width: 3,
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'ellipse.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const annots = await readPage0Annots(savePath);
    const circle = annots.get('Circle');
    expect(circle).toBeDefined();
    expect(circle!.get(PDFName.of('IC'))).toBeUndefined();
    expect(circle!.get(PDFName.of('C'))).toBeInstanceOf(PDFArray);

    const ap = circle!.get(PDFName.of('AP'));
    expect(ap instanceof PDFDict).toBe(true);
    const text = await decodeAnnotAP(savePath, circle!);
    // DEF-165 re-fix: alpha via ExtGState `gs`, not inline tokens.
    expect(text).toMatch(/\/G1 gs/);
    expect(text).not.toMatch(/\b0\.1 ca\b/);
    expect(text).not.toMatch(/\b1 CA\b/);
    // Ellipse uses cubic bezier `c` operators, not the `re` rectangle operator.
    expect(text).toMatch(/ c$/m);
    expect(text).not.toMatch(/ re /);

    const gs = await readAnnotAPExtGState(savePath, 'Circle');
    expect(gs).toBeInstanceOf(PDFDict);
    expect((gs!.get(PDFName.of('ca')) as PDFNumber).asNumber()).toBeCloseTo(0.1, 5);
    expect((gs!.get(PDFName.of('CA')) as PDFNumber).asNumber()).toBe(1);

    const pdfjsAnns = await pdfjsPage0Annotations(savePath);
    const circPdfjs = pdfjsAnns.find((a) => a.subtype === 'Circle');
    expect(circPdfjs).toBeDefined();
    expect(circPdfjs!.hasAppearance).toBe(true);

    const pageContent = await decodedPage0Content(savePath);
    expect(pageContent).toContain(hexOperand('UNDER_ELLIPSE'));
  });

  it('rect/ellipse round-trip through the engine: color preserved, no /IC', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdfWithText('page one');
    await engine.loadDocument('doc', srcPath);

    await engine.createAnnotation('doc', makePayload({
      id: 'rc', kind: 'rect', page: 1,
      rects: [{ x: 50, y: 400, width: 200, height: 150 }],
      color: 'blue', width: 3,
    }));
    await engine.createAnnotation('doc', makePayload({
      id: 'el', kind: 'ellipse', page: 1,
      rects: [{ x: 100, y: 300, width: 200, height: 150 }],
      color: 'green',
    }));

    const savePath = join(dir, 'rt.pdf');
    await engine.saveAs('doc', savePath);
    await engine.loadDocument('doc-reloaded', savePath);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = (state.value as any).annotations as any[];
      expect(anns.find((a) => a.kind === 'rect')?.color).toBe('blue');
      expect(anns.find((a) => a.kind === 'ellipse')?.color).toBe('green');
    }

    const annots = await readPage0Annots(savePath);
    expect(annots.get('Square')?.get(PDFName.of('IC'))).toBeUndefined();
    expect(annots.get('Circle')?.get(PDFName.of('IC'))).toBeUndefined();
  });
});
