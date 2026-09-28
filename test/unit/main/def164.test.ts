import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRef } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { parseAnnotationsFromDoc } from '../../../src/main/services/annotations';
import type { CreateAnnotationPayload } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// DEF-164: annotation /Rect (and /QuadPoints, /Callout, /L, /InkList) must be
// written in PDF bottom-left user space so third-party viewers (Acrobat,
// pdf.js, Chrome) place annotations where TFlex shows them. The engine model
// is top-left origin; the serialize path must flip top-left -> bottom-left,
// and the read path must flip back. This test creates each kind at a known
// top-left rect, saves, re-parses the RAW /Rect (and the kind's secondary
// geometry) with pdf-lib to assert the bottom-left values, then re-loads
// through TFlex's read path to assert the top-left rect round-trips exactly.
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def164-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function onePagePdfPath(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  const bytes = await doc.save();
  const p = join(dir, 'def164-src.pdf');
  await writeFile(p, Buffer.from(bytes));
  return p;
}

function rawAnnotDict(doc: PDFDocument, pageIdx = 0): any {
  const pageLeaf = (doc.getPage(pageIdx) as any).node;
  const annotsRef = pageLeaf.get(PDFName.of('Annots'));
  if (annotsRef === undefined) return undefined;
  let annotsArray: any = annotsRef;
  if (annotsRef instanceof PDFRef) {
    annotsArray = doc.context.lookup(annotsRef);
  }
  if (!(annotsArray instanceof PDFArray) || annotsArray.size() === 0) return undefined;
  const annotRef = annotsArray.get(0);
  const annot = annotRef instanceof PDFRef ? doc.context.lookup(annotRef) : annotRef;
  return (annot as any)?.dict ?? (annot as any);
}

function numArray(dict: any, key: string): number[] {
  const arr = dict.get(PDFName.of(key));
  if (!(arr instanceof PDFArray)) return [];
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const el = arr.get(i);
    if (el instanceof PDFArray) {
      // Nested array (e.g. /InkList is [stroke[]]); flatten one level.
      for (let j = 0; j < el.size(); j++) {
        out.push((el.get(j) as any).asNumber());
      }
    } else {
      out.push((el as any).asNumber());
    }
  }
  return out;
}

interface Case {
  name: string;
  payload: CreateAnnotationPayload;
  // Original top-left rect the engine should store and round-trip.
  topLeft: { x: number; y: number; width: number; height: number };
  // Optional raw-PDF secondary geometry assertions.
  rawAssert?: (dict: any) => void;
}

const cases: Case[] = [
  {
    name: 'text-box',
    payload: {
      id: 'tb', kind: 'text-box', page: 1,
      rects: [{ x: 72, y: 72, width: 200, height: 50 }],
      color: 'yellow', content: 'box',
    },
    topLeft: { x: 72, y: 72, width: 200, height: 50 },
  },
  {
    name: 'rect',
    payload: {
      id: 'rc', kind: 'rect', page: 1,
      rects: [{ x: 100, y: 100, width: 150, height: 120 }],
      color: 'red', width: 2,
    },
    topLeft: { x: 100, y: 100, width: 150, height: 120 },
  },
  {
    name: 'ellipse',
    payload: {
      id: 'el', kind: 'ellipse', page: 1,
      rects: [{ x: 120, y: 300, width: 180, height: 100 }],
      color: 'blue', width: 3,
    },
    topLeft: { x: 120, y: 300, width: 180, height: 100 },
  },
  {
    name: 'note',
    payload: {
      id: 'nt', kind: 'note', page: 1,
      at: { x: 300, y: 200 },
      color: 'orange', content: 'note',
    },
    // note's icon rect is 24x24 at the `at` anchor.
    topLeft: { x: 300, y: 200, width: 24, height: 24 },
  },
  {
    name: 'callout',
    payload: {
      id: 'co', kind: 'callout' as any, page: 1,
      rect: { x: 200, y: 400, width: 150, height: 50 },
      at: { x: 80, y: 600 },
      color: 'red', content: 'see this',
    },
    topLeft: { x: 200, y: 400, width: 150, height: 50 },
    rawAssert: (dict) => {
      // /Callout = [cx, cy_pdf, cx, cy_pdf, at.x, at.y_pdf] bottom-left.
      const c = numArray(dict, 'Callout');
      expect(c.length).toBeGreaterThanOrEqual(6);
      expect(c[0]).toBeCloseTo(275);            // box center x
      expect(c[1]).toBeCloseTo(PAGE_H - 425);   // box center y in PDF space
      expect(c[4]).toBeCloseTo(80);             // at.x
      expect(c[5]).toBeCloseTo(PAGE_H - 600);   // at.y in PDF space
    },
  },
  {
    name: 'ink',
    payload: {
      id: 'ik', kind: 'ink', page: 1,
      rects: [{ x: 50, y: 50, width: 200, height: 100 }],
      points: [{ x: 20, y: 20 }, { x: 100, y: 80 }],
      color: 'green', width: 2,
    },
    topLeft: { x: 50, y: 50, width: 200, height: 100 },
    rawAssert: (dict) => {
      const ink = numArray(dict, 'InkList');
      // two points, y flipped to PDF space.
      expect(ink[0]).toBeCloseTo(20);
      expect(ink[1]).toBeCloseTo(PAGE_H - 20);
      expect(ink[2]).toBeCloseTo(100);
      expect(ink[3]).toBeCloseTo(PAGE_H - 80);
    },
  },
  {
    name: 'arrow',
    payload: {
      id: 'ar', kind: 'arrow', page: 1,
      from: { x: 60, y: 500 }, to: { x: 260, y: 300 },
      lineEnds: ['OpenArrow', 'None'],
      color: 'purple', width: 2,
    },
    topLeft: { x: 60, y: 300, width: 200, height: 200 },
    rawAssert: (dict) => {
      const l = numArray(dict, 'L');
      expect(l.length).toBe(4);
      expect(l[0]).toBeCloseTo(60);
      expect(l[1]).toBeCloseTo(PAGE_H - 500);
      expect(l[2]).toBeCloseTo(260);
      expect(l[3]).toBeCloseTo(PAGE_H - 300);
    },
  },
  {
    name: 'highlight',
    payload: {
      id: 'hl', kind: 'highlight', page: 1,
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'yellow',
    },
    topLeft: { x: 100, y: 500, width: 200, height: 15 },
    rawAssert: (dict) => {
      const q = numArray(dict, 'QuadPoints');
      // [ul.x ul.y ur.x ur.y ll.x ll.y lr.x lr.y] bottom-left.
      expect(q[1]).toBeCloseTo(PAGE_H - 500); // upper y
      expect(q[3]).toBeCloseTo(PAGE_H - 500);
      expect(q[5]).toBeCloseTo(PAGE_H - 515); // lower y
      expect(q[7]).toBeCloseTo(PAGE_H - 515);
    },
  },
  {
    name: 'underline',
    payload: {
      id: 'ul', kind: 'underline', page: 1,
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'green',
    },
    topLeft: { x: 100, y: 500, width: 200, height: 5 },
  },
  {
    name: 'squiggly',
    payload: {
      id: 'sq', kind: 'squiggly', page: 1,
      rects: [{ x: 100, y: 500, width: 200, height: 5 }],
      color: 'magenta',
    },
    topLeft: { x: 100, y: 500, width: 200, height: 5 },
  },
  {
    name: 'strikeout',
    payload: {
      id: 'st', kind: 'strikeout', page: 1,
      rects: [{ x: 100, y: 500, width: 200, height: 15 }],
      color: 'red',
    },
    topLeft: { x: 100, y: 500, width: 200, height: 15 },
  },
];

describe('DEF-164: annotation /Rect written in PDF bottom-left space (interop)', () => {
  for (const c of cases) {
    it(`${c.name}: raw /Rect is bottom-left and TFlex read path round-trips top-left`, async () => {
      const engine = new EngineService();
      const path = await onePagePdfPath();
      await engine.loadDocument('doc-1', path);

      const created = await engine.createAnnotation('doc-1', c.payload);
      expect(created.ok).toBe(true);

      const savePath = join(dir, `def164-${c.name}.pdf`);
      const sr = await engine.saveAs('doc-1', savePath);
      expect(sr.ok).toBe(true);

      // 1) Re-parse the RAW PDF with pdf-lib and assert /Rect is bottom-left.
      const buf = await readFile(savePath);
      const rawDoc = await PDFDocument.load(buf.buffer.slice(
        buf.byteOffset, buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer);
      const dict = rawAnnotDict(rawDoc);
      expect(dict).toBeDefined();
      const rect = numArray(dict, 'Rect');
      expect(rect.length).toBe(4);
      const t = c.topLeft;
      expect(rect[0]).toBeCloseTo(t.x, 3);
      expect(rect[1]).toBeCloseTo(PAGE_H - t.y - t.height, 3); // lly
      expect(rect[2]).toBeCloseTo(t.x + t.width, 3);
      expect(rect[3]).toBeCloseTo(PAGE_H - t.y, 3);             // ury

      // Optional secondary-geometry raw assertions.
      c.rawAssert?.(dict);

      // 2) TFlex's read path (parseAnnotationsFromDoc) must return the
      //    ORIGINAL top-left rect.
      const reparsed = parseAnnotationsFromDoc(rawDoc);
      expect(reparsed.length).toBe(1);
      expect(reparsed[0].length).toBe(1);
      const m = reparsed[0][0];
      expect(m.rects[0].x).toBeCloseTo(t.x, 3);
      expect(m.rects[0].y).toBeCloseTo(t.y, 3);
      expect(m.rects[0].width).toBeCloseTo(t.width, 3);
      expect(m.rects[0].height).toBeCloseTo(t.height, 3);
    });
  }

  it('callout anchor `at` round-trips to the original top-left point', async () => {
    const engine = new EngineService();
    const path = await onePagePdfPath();
    await engine.loadDocument('doc-1', path);
    await engine.createAnnotation('doc-1', {
      id: 'co', kind: 'callout' as any, page: 1,
      rect: { x: 200, y: 400, width: 150, height: 50 },
      at: { x: 80, y: 600 },
      color: 'red', content: 'see this',
    });
    const savePath = join(dir, 'def164-callout-at.pdf');
    await engine.saveAs('doc-1', savePath);

    const buf = await readFile(savePath);
    const rawDoc = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset, buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    const reparsed = parseAnnotationsFromDoc(rawDoc);
    const m = reparsed[0][0] as any;
    expect(m.at).toBeDefined();
    expect(m.at.x).toBeCloseTo(80, 3);
    expect(m.at.y).toBeCloseTo(600, 3);
  });
});