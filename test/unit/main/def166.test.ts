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
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
} from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { EngineService } from '../../../src/main/services/engine';
import type { CreateAnnotationPayload } from '../../../src/shared/types';

// DEF-166: textbox/callout FreeText annotations were saved with /Contents +
// /DA but NO /AP, so pdf.js generated its own appearance from /Contents + /DA
// AND TFlex's overlay drew the text again -> doubled glyphs on reopen. The
// fix bakes a real /AP /N appearance stream (wrapped text via a StandardFont at
// the /DA size/color, same auto-fit the renderer uses) so there is exactly one
// authoritative copy. With /AP present, pdf.js uses it instead of generating
// one, and the renderer overlay (already suppressed on reopen via
// `liveAnnTextIds`) adds no second. Notes (/Text) already have no generated
// appearance and are left untouched.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def166-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function createOnePagePdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('PAGE_TEXT_BEHIND', { x: 72, y: 700, size: 14, font });
  const bytes = await doc.save();
  return writeFixture('src.pdf', bytes);
}

function makePayload(overrides: Partial<CreateAnnotationPayload>): CreateAnnotationPayload {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'text-box',
    page: 1,
    rects: [{ x: 100, y: 500, width: 200, height: 60 }],
    color: 'blue',
    content: 'Hello world',
    ...overrides,
  };
}

/** Decode a stream object's content bytes to latin1 text, inflating if the
 *  stream is Flate-encoded (pdf-lib may compress on save). */
function decodeStreamText(doc: PDFDocument, streamObj: unknown): string {
  let obj = streamObj;
  if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
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

interface AnnotAPInfo {
  subtype: string;
  hasAP: boolean;
  /** Decoded /AP /N stream content. */
  apText: string;
  /** The /AP /N /Resources /Font dict (if present). */
  hasFontResource: boolean;
  /** The /DA appearance string (decoded). */
  da: string | undefined;
}

/** Find the page-0 annotation of `subtype` in the saved file and return its
 *  /AP /N stream + resource shape. Every ref resolves in one doc context. */
async function readAnnotAP(savePath: string, subtype: string): Promise<AnnotAPInfo | undefined> {
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
    const hasAP = ap instanceof PDFDict;
    let apText = '';
    let hasFontResource = false;
    if (hasAP) {
      const n = (ap as PDFDict).get(PDFName.of('N'));
      apText = decodeStreamText(doc, n);
      // Inspect the stream's /Resources /Font.
      let nObj: unknown = n;
      if (n instanceof PDFRef) nObj = doc.context.lookup(n);
      const nDict: PDFDict | undefined =
        nObj instanceof PDFStream ? nObj.dict : nObj instanceof PDFDict ? nObj : undefined;
      if (nDict !== undefined) {
        const res = nDict.get(PDFName.of('Resources'));
        let resObj: unknown = res;
        if (res instanceof PDFRef) resObj = doc.context.lookup(res);
        if (resObj instanceof PDFDict) {
          const font = resObj.get(PDFName.of('Font'));
          let fontObj: unknown = font;
          if (font instanceof PDFRef) fontObj = doc.context.lookup(font);
          hasFontResource = fontObj instanceof PDFDict;
        }
      }
    }
    const daRaw = obj.get(PDFName.of('DA'));
    let da: string | undefined;
    // pdf-lib represents /DA as a PDFString; decode via its decodeText().
    if (daRaw && typeof (daRaw as any).decodeText === 'function') {
      da = (daRaw as any).decodeText();
    }
    return { subtype, hasAP, apText, hasFontResource, da };
  }
  return undefined;
}

/** Load the saved file with pdfjs-dist (a third-party PDF engine) and return
 *  the parsed page-0 annotations with their `hasAppearance` flag — the flag
 *  pdf.js uses to decide whether to render a baked /AP (true) instead of
 *  generating its own FreeText appearance from /Contents + /DA (false). */
async function pdfjsPage0Annotations(savePath: string): Promise<{ subtype: string; hasAppearance: boolean }[]> {
  const buf = await readFile(savePath);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const page = await pdf.getPage(1);
  const anns = await page.getAnnotations();
  await pdf.destroy();
  return anns.map((a: any) => ({ subtype: a.subtype as string, hasAppearance: a.hasAppearance as boolean }));
}

describe('DEF-166: textbox/callout bake a real /AP (no doubled text on reopen)', () => {
  it('text-box: /AP /N present, draws the text once via a StandardFont + /DA color', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdf();
    await engine.loadDocument('doc', srcPath);

    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'text-box',
      rects: [{ x: 80, y: 600, width: 240, height: 60 }],
      content: 'Baked free text',
      color: 'blue',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'textbox.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const info = await readAnnotAP(savePath, 'FreeText');
    expect(info).toBeDefined();
    expect(info!.hasAP).toBe(true);
    // The appearance stream contains a text block (BT ... Tj ... ET).
    expect(info!.apText).toMatch(/BT/);
    expect(info!.apText).toMatch(/Tj/);
    expect(info!.apText).toMatch(/ET/);
    // The font is the StandardFont, set via the /Helv Tf operator.
    expect(info!.apText).toMatch(/\/Helv [\d.]+ Tf/);
    // The baked text glyph is present (hex-encoded by pdf-lib's encodeText).
    // 'Baked' -> 42 61 6B 65 64 ; search the hex form in the stream.
    const bakedHex = Buffer.from('Baked', 'latin1').toString('hex').toUpperCase();
    expect(info!.apText.toUpperCase()).toContain(bakedHex);
    // /DA still carries the size/color the renderer would have used.
    expect(info!.da).toMatch(/\/Helv 12 Tf 0 0 0 rg/);
    // The /AP /N /Resources /Font dict is present (the StandardFont).
    expect(info!.hasFontResource).toBe(true);

    // Third-party PDF engine: pdf.js sees the baked appearance and will use
    // it (hasAppearance true) instead of generating its own from /DA — so the
    // text is rendered exactly once.
    const pdfjsAnns = await pdfjsPage0Annotations(savePath);
    const ft = pdfjsAnns.find((a) => a.subtype === 'FreeText');
    expect(ft).toBeDefined();
    expect(ft!.hasAppearance).toBe(true);
  });

  it('callout: /AP /N present drawing the text, /Callout leader geometry still serialized', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdf();
    await engine.loadDocument('doc', srcPath);

    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'callout' as any,
      rects: [{ x: 100, y: 500, width: 200, height: 60 }],
      points: [
        { x: 50, y: 700 },
        { x: 80, y: 620 },
        { x: 100, y: 560 },
      ],
      color: 'red',
      content: 'See this',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'callout.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const info = await readAnnotAP(savePath, 'FreeText');
    expect(info).toBeDefined();
    expect(info!.hasAP).toBe(true);
    expect(info!.apText).toMatch(/BT/);
    expect(info!.apText).toMatch(/Tj/);
    expect(info!.apText).toMatch(/ET/);
    expect(info!.apText).toMatch(/\/Helv [\d.]+ Tf/);
    // The callout text color is the annotation color (red = 1 0 0), carried
    // into the baked appearance (the /DA is `/Helv 12 Tf 1 0 0 rg`).
    expect(info!.apText).toMatch(/1 0 0 rg/);
    expect(info!.hasFontResource).toBe(true);

    // The /Callout leader geometry still survives on the annotation dict
    // (the renderer overlay draws the leader arrow from it).
    const buf = await readFile(savePath);
    const doc = await PDFDocument.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const leaf = (doc.getPage(0) as any).node as PDFDict;
    const annotsRef = leaf.get(PDFName.of('Annots'));
    let annots: unknown = annotsRef;
    if (annotsRef instanceof PDFRef) annots = doc.context.lookup(annotsRef);
    let calloutFound = false;
    if (annots instanceof PDFArray) {
      for (let j = 0; j < annots.size(); j++) {
        let obj: unknown = annots.get(j);
        if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
        if (obj instanceof PDFDict) {
          const callout = obj.get(PDFName.of('Callout'));
          if (callout !== undefined) { calloutFound = true; break; }
        }
      }
    }
    expect(calloutFound).toBe(true);

    const pdfjsAnns = await pdfjsPage0Annotations(savePath);
    const ft = pdfjsAnns.find((a) => a.subtype === 'FreeText');
    expect(ft).toBeDefined();
    expect(ft!.hasAppearance).toBe(true);
  });

  it('text-box auto-fit shrinks long text to fit the box height (4pt floor)', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdf();
    await engine.loadDocument('doc', srcPath);

    // A short, narrow box with a long string forces the auto-fit to shrink
    // the font so every wrapped line fits the content height.
    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'text-box',
      rects: [{ x: 80, y: 600, width: 120, height: 30 }],
      content: 'AAAAAAAAAA BBBBBB CCCCCC DDDDDD EEEEEE',
      color: 'blue',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'shrink.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    const info = await readAnnotAP(savePath, 'FreeText');
    expect(info).toBeDefined();
    expect(info!.hasAP).toBe(true);
    // The fitted font size must be below the 12pt default (text was wrapped to
    // multiple lines that would not fit 30pt at 12pt*1.35) but at/above the
    // 4pt floor.
    const m = info!.apText.match(/\/Helv ([\d.]+) Tf/);
    expect(m).not.toBeNull();
    const size = parseFloat(m![1]);
    expect(size).toBeGreaterThanOrEqual(4);
    expect(size).toBeLessThan(12);
  });

  it('note (/Text) is left untouched — no /AP baked (already has no generated appearance)', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdf();
    await engine.loadDocument('doc', srcPath);

    const r = await engine.createAnnotation('doc', makePayload({
      kind: 'note',
      at: { x: 100, y: 100 },
      content: 'a sticky note',
      color: 'yellow',
    }));
    expect(r.ok).toBe(true);

    const savePath = join(dir, 'note.pdf');
    const save = await engine.saveAs('doc', savePath);
    expect(save.ok).toBe(true);

    // A /Text note must NOT get a baked /AP (the requirement leaves notes
    // alone — they already render exactly once via the standard note icon).
    const buf = await readFile(savePath);
    const doc = await PDFDocument.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const leaf = (doc.getPage(0) as any).node as PDFDict;
    const annotsRef = leaf.get(PDFName.of('Annots'));
    let annots: unknown = annotsRef;
    if (annotsRef instanceof PDFRef) annots = doc.context.lookup(annotsRef);
    expect(annots instanceof PDFArray).toBe(true);
    let noteHasAP = false;
    if (annots instanceof PDFArray) {
      for (let j = 0; j < annots.size(); j++) {
        let obj: unknown = annots.get(j);
        if (obj instanceof PDFRef) obj = doc.context.lookup(obj);
        if (obj instanceof PDFDict) {
          const st = obj.get(PDFName.of('Subtype'));
          if (st instanceof PDFName && st.asString().slice(1) === 'Text') {
            noteHasAP = obj.get(PDFName.of('AP')) !== undefined;
          }
        }
      }
    }
    expect(noteHasAP).toBe(false);
  });

  it('text-box survives save/load round-trip with content preserved', async () => {
    const engine = new EngineService();
    const srcPath = await createOnePagePdf();
    await engine.loadDocument('doc', srcPath);

    await engine.createAnnotation('doc', makePayload({
      id: 'tb1',
      kind: 'text-box',
      rects: [{ x: 80, y: 600, width: 240, height: 60 }],
      content: 'round trip text',
      color: 'green',
    }));

    const savePath = join(dir, 'rt.pdf');
    await engine.saveAs('doc', savePath);
    await engine.loadDocument('doc-reloaded', savePath);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = (state.value as any).annotations as any[];
      const tb = anns.find((a) => a.kind === 'text-box');
      expect(tb).toBeDefined();
      expect(tb.content).toBe('round trip text');
      expect(tb.color).toBe('green');
    }
  });
});