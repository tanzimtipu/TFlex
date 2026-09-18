// DEF-130 / DEF-131 / DEF-124 — backend root-cause fixes + round-trip
// guards for the three engine-side defects qa confirmed against the
// installed v1.7.8 binary.
//
//   DEF-130 (B9, HIGH)  — after undo of a page insert, re-inserting
//                          blew "getDocumentBytes failed: degreeAngle
//                          must be of type number, but was actually of
//                          type NaN". Root cause: insertBlankPage /
//                          insertFromPdf snapshotted doc.order /
//                          doc.rotations via snapshotDoc (no pdfBytes),
//                          so undo reverted the arrays but NOT the
//                          pdfDoc. A re-insert then added a page at a
//                          higher origIdx than the rotations array had
//                          a slot for, so serializeDoc read
//                          `doc.rotations[origIdx]` === undefined and
//                          passed undefined*90 -> NaN to degrees(),
//                          which threw. Fix: capture the pre-insert
//                          pdfDoc bytes via snapshotDocWithPdf so undo
//                          reverts the pdfDoc too; add a finite-guard
//                          at the serialization site so a future
//                          array-length mismatch can never reproduce
//                          the throw.
//
//   DEF-131 (B11, HIGH) — crop "per page" cropped every page, not just
//                          the selected one. Root cause: pdf-lib's
//                          `copyPages` walks
//                          `PDFPageLeaf.InheritableEntries`
//                          (`Resources`, `MediaBox`, `CropBox`,
//                          `Rotate`) and pulls any value the cloned leaf
//                          was inheriting from its source /Pages
//                          parent DOWN onto the cloned leaf so it
//                          survives the copy (the dest /Pages root
//                          does not carry it). For /CropBox and
//                          /TrimBox that propagates a source-level
//                          (often global) box onto every dest leaf
//                          whose source leaf did not have its own. A
//                          per-page crop on page 1 of a doc whose
//                          /Pages root carried a /CropBox then
//                          rendered every page at the inherited crop.
//                          Fix: after each copyPages, strip /CropBox
//                          and /TrimBox from the cloned leaf when the
//                          source leaf did not carry one on its own
//                          node (the dest /Pages root never carries
//                          them, so the cloned leaf is the only place
//                          the inherited value lives in the output —
//                          deleting it leaves the leaf with no box,
//                          matching the source leaf's effective
//                          state).
//
//   DEF-124 / DEF-221  — edit-text leaves no trace of the old run. The
//                          mask covers the OLD run's bbox plus a small
//                          symmetric PAD on all four sides and nothing
//                          more (DEF-221 tightened this: an earlier
//                          DEF-124 widening by the new font's
//                          ascent/descent over-erased and ate the line
//                          above). Mask-and-redraw stays the v1
//                          approach (DEF-116 REJECTED); the new text is
//                          still drawn at the moved `rect`.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-def130-131-124-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function makeNPagePdf(n: number, textPrefix = 'Page'): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${textPrefix} ${i}`, { x: 72, y: 700, size: 14, font });
  }
  const bytes = await doc.save();
  const path = await writeFixture(`def-${n}.pdf`, bytes);
  return { path, bytes: new Uint8Array(bytes) };
}

/** Build a PDF whose /Pages root carries an inherited /CropBox. */
async function makeNPagePdfWithInheritedCrop(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    doc.addPage([612, 792]);
  }
  // Put a /CropBox on the /Pages root so all pages inherit it. The /Pages
  // root is a PDFDict (either directly on the catalog or via a PDFRef), so
  // resolve it with the proper pdf-lib types rather than a loose cast —
  // `context.lookup(ref)` returns PDFObject | undefined and PDFDict.set
  // takes (PDFName, PDFObject), so the shapes line up without `any`.
  const pagesRoot = doc.catalog.get(PDFName.of('Pages'));
  let pagesDict: PDFDict | undefined;
  if (pagesRoot instanceof PDFDict) {
    pagesDict = pagesRoot;
  } else if (pagesRoot instanceof PDFRef) {
    const looked = doc.context.lookup(pagesRoot);
    if (looked instanceof PDFDict) pagesDict = looked;
  }
  if (pagesDict) {
    pagesDict.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 612, 792]));
  }
  return new Uint8Array(await doc.save());
}

/** Build a one-page PDF whose single page already contains the given
 *  text drawn at (72, 700) so edit tests have something to mask. */
async function createSinglePagePdfWithText(text: string): Promise<{ path: string; bytes: Uint8Array }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 72, y: 700, size: 14, font });
  const bytes = await doc.save();
  const path = await writeFixture('edit-target.pdf', bytes);
  return { path, bytes: new Uint8Array(bytes) };
}

/** Decode page-0's /Contents (single ref or array) and return the
 *  concatenated latin1 content-stream text. Mirrors the helper in
 *  engine.test.ts so the same Tj/TJ text search works. */
async function decodedPage0Content(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const fileBytes = await readFile(path);
  const doc = await PDFDocument.load(fileBytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return '';
  const lookup = (ref: unknown): string => {
    const obj = doc.context.lookup(ref as any);
    if (!obj) return '';
    if (obj.constructor && obj.constructor.name === 'PDFArray') {
      const arr = obj as unknown as { size(): number; get(i: number): unknown };
      let out = '';
      for (let i = 0; i < arr.size(); i++) out += lookup(arr.get(i));
      return out;
    }
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents as unknown as Uint8Array;
      if (!raw || typeof raw.length !== 'number') return '';
      try {
        const dec = inflateSync(raw);
        return new TextDecoder('latin1').decode(dec);
      } catch {
        try { return new TextDecoder('latin1').decode(raw); } catch { return ''; }
      }
    }
    return '';
  };
  return lookup(contents);
}

function hexOperand(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase();
}

async function page0ContentHasText(path: string, text: string): Promise<boolean> {
  const content = await decodedPage0Content(path);
  return content.includes(hexOperand(text)) || content.includes(text);
}

/** Extract the white-fill rectangle pdf-lib's `drawRectangle` emits.
 *  pdf-lib does NOT use the `re` operator — it emits a path
 *  `q / 1 1 1 rg / ... / 1 0 0 1 <x> <y> cm / ... / 0 0 m / 0 <h> l /
 *  <w> <h> l / <w> 0 l / h / f / Q`. This helper finds the first
 *  `1 1 1 rg` (white fill) block, reads the `cm` translate, and
 *  recovers the rectangle's (x, y, width, height) in PDF bottom-left
 *  coords from the path operands. Returns null if no white-fill
 *  rectangle is found. */
function extractWhiteRect(content: string): { x: number; y: number; width: number; height: number } | null {
  const whiteIdx = content.indexOf('1 1 1 rg');
  if (whiteIdx < 0) return null;
  const after = content.slice(whiteIdx);
  // The `cm` translate right after the white fill sets the rect's
  // bottom-left corner. pdf-lib emits "1 0 0 1 <x> <y> cm".
  const cmMatch = after.match(/1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) cm/);
  if (!cmMatch) return null;
  const x = parseFloat(cmMatch[1]);
  const y = parseFloat(cmMatch[2]);
  // The path is "0 0 m / 0 <h> l / <w> <h> l / <w> 0 l / h / f".
  // Pull the first two `l` operands to recover h and w.
  const lMatches = [...after.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) l/g)];
  if (lMatches.length < 2) return null;
  const h = parseFloat(lMatches[0][2]);
  const w = parseFloat(lMatches[1][1]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x, y, width: w, height: h };
}

// ---------------------------------------------------------------------------
// DEF-130 — insert blank, undo, re-insert, getDocumentBytes
// ---------------------------------------------------------------------------

describe('DEF-130: insert blank + undo + re-insert (no NaN throw)', () => {
  it('insertBlankPage: insert, undo, re-insert, getDocumentBytes -> valid bytes, no NaN', async () => {
    const engine = new EngineService();
    const { path } = await makeNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Insert 1: blank page after page 1 (afterIndex=1).
    const ins1 = await engine.insertBlankPage('doc-1', 1, 400, 300);
    expect(ins1.ok).toBe(true);
    if (!ins1.ok) return;
    expect(ins1.value.pageCount).toBe(4);

    // Undo: reverts to 3 pages (and the pdfDoc, via the new
    // snapshotDocWithPdf snapshot).
    const undo1 = await engine.undo('doc-1');
    expect(undo1.ok).toBe(true);
    if (!undo1.ok) return;
    expect(undo1.value.pageCount).toBe(3);

    // Re-insert: blank page after page 1 again.
    const ins2 = await engine.insertBlankPage('doc-1', 1, 400, 300);
    expect(ins2.ok).toBe(true);
    if (!ins2.ok) return;
    expect(ins2.value.pageCount).toBe(4);

    // getDocumentBytes — this is the call that previously threw
    // "degreeAngle must be of type number, but was actually of type
    // NaN" out of serializeDoc -> degrees(undefined * 90).
    const bytesRes = await engine.getDocumentBytes('doc-1');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    // Reparse to confirm the bytes are a valid 4-page PDF.
    const reparsed = await PDFDocument.load(bytesRes.value);
    expect(reparsed.getPageCount()).toBe(4);
  });

  it('insertBlankPage: insert, undo, re-insert, then saveAs round-trip is valid', async () => {
    const engine = new EngineService();
    const { path } = await makeNPagePdf(2);
    await engine.loadDocument('doc-rt', path);

    await engine.insertBlankPage('doc-rt', 0, 500, 400);
    await engine.undo('doc-rt');
    await engine.insertBlankPage('doc-rt', 0, 500, 400);

    const out = join(dir, 'rt-out.pdf');
    const saved = await engine.saveAs('doc-rt', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { readFile } = await import('node:fs/promises');
    const reparsed = await PDFDocument.load(await readFile(out));
    expect(reparsed.getPageCount()).toBe(3);
  });

  it('insertFromPdf: insert, undo, re-insert, getDocumentBytes -> valid bytes', async () => {
    const engine = new EngineService();
    const { path } = await makeNPagePdf(3);
    const { bytes: otherBytes } = await makeNPagePdf(2, 'Other');
    await engine.loadDocument('doc-ifp', path);

    const ins1 = await engine.insertFromPdf('doc-ifp', otherBytes, 1);
    expect(ins1.ok).toBe(true);
    if (!ins1.ok) return;
    expect(ins1.value.pageCount).toBe(5);

    const undo1 = await engine.undo('doc-ifp');
    expect(undo1.ok).toBe(true);
    if (!undo1.ok) return;
    expect(undo1.value.pageCount).toBe(3);

    const ins2 = await engine.insertFromPdf('doc-ifp', otherBytes, 1);
    expect(ins2.ok).toBe(true);
    if (!ins2.ok) return;
    expect(ins2.value.pageCount).toBe(5);

    const bytesRes = await engine.getDocumentBytes('doc-ifp');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    expect(reparsed.getPageCount()).toBe(5);
  });

  it('rotations guard: a non-finite rotation slot does not throw (defensive)', async () => {
    // Poke a NaN directly into the rotations array to confirm the
    // serializeDoc guard normalizes it to 0 instead of throwing.
    const engine = new EngineService();
    const { path } = await makeNPagePdf(2);
    await engine.loadDocument('doc-guard', path);
    const doc = (engine as any).docs.get('doc-guard');
    expect(doc).toBeDefined();
    doc.rotations[0] = NaN;
    const bytesRes = await engine.getDocumentBytes('doc-guard');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    expect(reparsed.getPageCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DEF-131 — crop "per page" does not propagate page 1's CropBox
// ---------------------------------------------------------------------------

describe('DEF-131: per-page crop does not propagate the CropBox', () => {
  it('fresh 3-page doc: crop page 1 only -> only page 1 has CropBox, pages 2/3 unchanged', async () => {
    const engine = new EngineService();
    const { bytes } = await makeNPagePdf(3);
    await engine.loadDocumentBytes('doc-1', bytes);

    const cropRes = await engine.cropPages('doc-1', [{
      page: 1,
      box: { x: 61.2, y: 79.2, width: 285.6, height: 429.6 },
    }]);
    expect(cropRes.ok).toBe(true);

    const bytesRes = await engine.getDocumentBytes('doc-1');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    expect(reparsed.getPageCount()).toBe(3);
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const p = reparsed.getPage(i);
      const leafCrop = p.node.get(PDFName.of('CropBox'));
      const leafTrim = p.node.get(PDFName.of('TrimBox'));
      if (i === 0) {
        // Page 1 must have the cropped CropBox AND TrimBox.
        expect(leafCrop, `page 1 should have CropBox`).toBeDefined();
        expect(leafTrim, `page 1 should have TrimBox`).toBeDefined();
        const c = (leafCrop as any).asArray().map((x: any) => x.asNumber());
        // llx=61.2, lly=792-79.2-429.6=283.2, urx=346.8, ury=712.8
        expect(c[0]).toBeCloseTo(61.2, 1);
        expect(c[1]).toBeCloseTo(283.2, 1);
        expect(c[2]).toBeCloseTo(346.8, 1);
        expect(c[3]).toBeCloseTo(712.8, 1);
      } else {
        // Pages 2/3 must have NO leaf CropBox or TrimBox (unchanged).
        expect(leafCrop, `page ${i + 1} should NOT have CropBox`).toBeUndefined();
        expect(leafTrim, `page ${i + 1} should NOT have TrimBox`).toBeUndefined();
      }
    }
  });

  it('inherited-crop 3-page doc: crop page 1 -> pages 2/3 do NOT inherit the cropped box', async () => {
    // Source doc whose /Pages root carries a /CropBox — the exact
    // scenario where pdf-lib's copyPages would otherwise pull the
    // inherited /CropBox down onto every leaf.
    const engine = new EngineService();
    const bytes = await makeNPagePdfWithInheritedCrop(3);
    await engine.loadDocumentBytes('doc-inh', bytes);

    const cropRes = await engine.cropPages('doc-inh', [{
      page: 1,
      box: { x: 61.2, y: 79.2, width: 285.6, height: 429.6 },
    }]);
    expect(cropRes.ok).toBe(true);

    const bytesRes = await engine.getDocumentBytes('doc-inh');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const p = reparsed.getPage(i);
      const cb = p.node.get(PDFName.of('CropBox'));
      if (i === 0) {
        expect(cb, `page 1 must have the cropped CropBox`).toBeDefined();
        const arr = (cb as any).asArray().map((x: any) => x.asNumber());
        expect(arr[0]).toBeCloseTo(61.2, 1);
        expect(arr[1]).toBeCloseTo(283.2, 1);
      } else {
        // The propagation bug: copyPages would pull the source /Pages
        // root's /CropBox down onto leaf 2/3. After the guard, the
        // leaf must NOT carry the cropped value (61.2 / 283.2).
        if (cb) {
          const arr = (cb as any).asArray().map((x: any) => x.asNumber());
          const isCropped =
            Math.abs(arr[0] - 61.2) < 0.1 &&
            Math.abs(arr[1] - 283.2) < 0.1 &&
            Math.abs(arr[2] - 346.8) < 0.1 &&
            Math.abs(arr[3] - 712.8) < 0.1;
          expect(
            isCropped,
            `page ${i + 1} leaf must NOT carry page 1's cropped CropBox (propagation)`,
          ).toBe(false);
        }
      }
    }
  });

  it('crop page 2 of a 3-page doc: only page 2 has CropBox, pages 1/3 unchanged', async () => {
    const engine = new EngineService();
    const { bytes } = await makeNPagePdf(3);
    await engine.loadDocumentBytes('doc-mid', bytes);

    const cropRes = await engine.cropPages('doc-mid', [{
      page: 2,
      box: { x: 72, y: 72, width: 200, height: 300 },
    }]);
    expect(cropRes.ok).toBe(true);

    const bytesRes = await engine.getDocumentBytes('doc-mid');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    for (let i = 0; i < reparsed.getPageCount(); i++) {
      const p = reparsed.getPage(i);
      const leafCrop = p.node.get(PDFName.of('CropBox'));
      if (i === 1) {
        expect(leafCrop, `page 2 should have CropBox`).toBeDefined();
        const c = (leafCrop as any).asArray().map((x: any) => x.asNumber());
        // llx=72, lly=792-72-300=420, urx=272, ury=720
        expect(c[0]).toBe(72);
        expect(c[1]).toBe(420);
        expect(c[2]).toBe(272);
        expect(c[3]).toBe(720);
      } else {
        expect(leafCrop, `page ${i + 1} should NOT have CropBox`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-124 / DEF-221 — edit-text mask is the old run's bbox + symmetric PAD
// ---------------------------------------------------------------------------

describe('DEF-124/DEF-221: editTextRun mask is the old run bbox + symmetric pad', () => {
  it('new text is present and the mask rect == old-run bbox + symmetric PAD only', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('OLDTITLE');
    await engine.loadDocument('doc-edit', path);

    const rect = { x: 70, y: 686, width: 120, height: 20 };
    const result = await engine.editTextRun('doc-edit', {
      page: 1,
      rect,
      newText: 'NEWTITLE',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(result.ok).toBe(true);

    const out = join(dir, 'edit-out.pdf');
    const saved = await engine.saveAs('doc-edit', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    // New text is present in the saved content stream.
    expect(await page0ContentHasText(out, 'NEWTITLE')).toBe(true);

    // Tightened contract (DEF-221): the mask covers the old run's INK
    // box plus a symmetric PAD on all four sides, and NOTHING more — no
    // ascent / descent extension that could reach into a neighbouring
    // text band. The renderer's oldRect is the em box
    // ([baseline - h, baseline], h = font size), whose top sits 0.25 h
    // above the ink top, so the mask is shifted DOWN by 0.25 h. The
    // bbox (payload.rect) is top-left origin; convert to PDF bottom-left
    // for comparison with the mask operands.
    const content = await decodedPage0Content(out);
    const mask = extractWhiteRect(content);
    expect(mask, `a white-fill mask rectangle must be present in the content stream`).toBeDefined();
    if (!mask) return;

    const PAGE_H = 792;
    const PAD = 2;
    const inkShift = rect.height * 0.25;
    const bboxX = rect.x;
    const bboxY = PAGE_H - rect.y - rect.height;
    const bboxW = rect.width;
    const bboxH = rect.height;

    // x/y are the bottom-left corner: PAD to the left and PAD below the
    // INK box (which is bbox shifted down by inkShift in top-left
    // coords, i.e. inkShift lower in PDF coords for the bottom edge).
    expect(mask.x).toBeGreaterThanOrEqual(bboxX - PAD - 0.5);
    expect(mask.x).toBeLessThanOrEqual(bboxX - PAD + 0.5);
    expect(mask.y).toBeGreaterThanOrEqual(bboxY - PAD - inkShift - 0.5);
    expect(mask.y).toBeLessThanOrEqual(bboxY - PAD - inkShift + 0.5);
    // Width/height are bbox + 2*PAD, and the height must NOT exceed
    // oldRect.height + 2*PAD + 0.5 (the DEF-124 ascent/descent widening
    // is gone and the 0.25 h ink shift does NOT change the height).
    expect(mask.width).toBeGreaterThanOrEqual(bboxW + 2 * PAD - 0.5);
    expect(mask.width).toBeLessThanOrEqual(bboxW + 2 * PAD + 0.5);
    expect(mask.height).toBeGreaterThanOrEqual(bboxH + 2 * PAD - 0.5);
    expect(mask.height).toBeLessThanOrEqual(bboxH + 2 * PAD + 0.5);

    // Explicit DEF-221 ink-box geometry in top-left coordinates:
    // maskTop == oldRect.y + 0.25*h - PAD,
    // maskBottom == oldRect.y + 1.25*h + PAD.
    const maskTopLeft = PAGE_H - (mask.y + mask.height);
    const maskBottomLeft = PAGE_H - mask.y;
    expect(maskTopLeft).toBeGreaterThanOrEqual(rect.y + inkShift - PAD - 0.5);
    expect(maskTopLeft).toBeLessThanOrEqual(rect.y + inkShift - PAD + 0.5);
    expect(maskBottomLeft).toBeGreaterThanOrEqual(rect.y + rect.height + inkShift + PAD - 0.5);
    expect(maskBottomLeft).toBeLessThanOrEqual(rect.y + rect.height + inkShift + PAD + 0.5);
  });

  // DEF-221 pin: the mask must not reach into the text band directly
  // above the moved run. Two lines are drawn 20 pt apart; the run's bbox
  // is derived from Helvetica's ascent/descent at size 14 so the test
  // does not hard-code font metrics. After editTextRun({rect, oldRect})
  // the extracted mask's TOP edge must sit at old-run-top + PAD (i.e.
  // below the band above's ink) and must be anchored to oldRect, not to
  // the moved rect.
  it('mask top stays below the text band above the old run (DEF-221 pin)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ABOVE_BASELINE = 720; // PDF bottom-left baseline of the line above
    const RUN_BASELINE = 700; // exactly 20 pt below
    page.drawText('ABOVE', { x: 72, y: ABOVE_BASELINE, size: 14, font });
    page.drawText('RUN', { x: 72, y: RUN_BASELINE, size: 14, font });
    const fixturePath = await writeFixture('two-line.pdf', await doc.save());

    const ascent = font.heightAtSize(14, { descender: false } as { descender?: boolean });
    const fullHeight = font.heightAtSize(14);
    const descent = Math.max(0, fullHeight - ascent);

    const PAGE_H = 792;
    const PAD = 2;
    // The old run's bbox in top-left coords, derived from its baseline.
    const oldRect = {
      x: 72,
      y: PAGE_H - (RUN_BASELINE + ascent),
      width: 120,
      height: ascent + descent,
    };
    // The moved rect is elsewhere; the mask must NOT be anchored here.
    const movedRect = { x: 200, y: 300, width: 120, height: ascent + descent };

    const engine = new EngineService();
    await engine.loadDocument('doc-move', fixturePath);
    const result = await engine.editTextRun('doc-move', {
      page: 1,
      rect: movedRect,
      oldRect,
      newText: 'MOVED',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(result.ok).toBe(true);

    const out = join(dir, 'two-line-out.pdf');
    const saved = await engine.saveAs('doc-move', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const content = await decodedPage0Content(out);
    const mask = extractWhiteRect(content);
    expect(mask, `a white-fill mask rectangle must be present`).toBeDefined();
    if (!mask) return;

    // The mask is anchored to oldRect (x = 72 - PAD), not the moved rect.
    expect(mask.x).toBeCloseTo(oldRect.x - PAD, 0);

    const maskTopPdf = mask.y + mask.height;
    const maskBottomPdf = mask.y;
    // DEF-221 ink-box shift: the mask is anchored to oldRect shifted
    // DOWN by 0.25 * oldRect.height (em-box top -> ink top). In PDF
    // coordinates both edges move down (smaller y) by inkShift:
    //   mask top    == RUN_BASELINE + ascent - inkShift + PAD
    //   mask bottom == RUN_BASELINE - descent - inkShift - PAD
    const inkShift = oldRect.height * 0.25;
    expect(maskTopPdf).toBeGreaterThanOrEqual(RUN_BASELINE + ascent - inkShift + PAD - 0.5);
    expect(maskTopPdf).toBeLessThanOrEqual(RUN_BASELINE + ascent - inkShift + PAD + 0.5);
    expect(maskBottomPdf).toBeGreaterThanOrEqual(RUN_BASELINE - descent - inkShift - PAD - 0.5);
    expect(maskBottomPdf).toBeLessThanOrEqual(RUN_BASELINE - descent - inkShift - PAD + 0.5);
    // The mask must NOT cover the band above: its top edge stays BELOW
    // the band above's descender extent (baseline - descent) by a
    // positive margin, so it cannot reach the neighbour's ink.
    const aboveInkBottom = ABOVE_BASELINE - descent;
    expect(maskTopPdf).toBeLessThanOrEqual(aboveInkBottom - 0.5);
    expect(aboveInkBottom - maskTopPdf).toBeGreaterThan(0.5);
    // In top-left coords the mask top sits at oldRect.y + 0.25*h - PAD.
    const maskTopLeft = PAGE_H - maskTopPdf;
    expect(maskTopLeft).toBeGreaterThanOrEqual(oldRect.y + inkShift - PAD - 0.5);
    expect(maskTopLeft).toBeLessThanOrEqual(oldRect.y + inkShift - PAD + 0.5);
  });

  // DEF-221 ink coverage pin. The renderer rect is the em box, so with
  // oldRect.height = 20 the mask must span [y + 5 - PAD, y + 25 + PAD]
  // in top-left coordinates: a descender row at y + 21 (0.05 h below
  // the rect bottom — the run's own descenders) is covered, while a
  // neighbour's descender at y - 3 (0.15 h above the rect top) is NOT.
  it('mask spans the ink box: own descender row covered, neighbour descender not', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('RECTPIX');
    await engine.loadDocument('doc-ink', path);

    const rect = { x: 80, y: 640, width: 120, height: 20 };
    const result = await engine.editTextRun('doc-ink', {
      page: 1,
      rect,
      newText: 'INKFIX',
      font: 'Helvetica',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(result.ok).toBe(true);

    const out = join(dir, 'ink-coverage-out.pdf');
    const saved = await engine.saveAs('doc-ink', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const content = await decodedPage0Content(out);
    const mask = extractWhiteRect(content);
    expect(mask, `a white-fill mask rectangle must be present`).toBeDefined();
    if (!mask) return;

    const PAGE_H = 792;
    const PAD = 2;
    const maskTopLeft = PAGE_H - (mask.y + mask.height);
    const maskBottomLeft = PAGE_H - mask.y;
    // Height unchanged by the shift: h + 2*PAD.
    expect(mask.height).toBeCloseTo(rect.height + 2 * PAD, 1);
    expect(maskTopLeft).toBeCloseTo(rect.y + 0.25 * rect.height - PAD, 1);
    expect(maskBottomLeft).toBeCloseTo(rect.y + 1.25 * rect.height + PAD, 1);

    const ownDescenderRow = rect.y + 21; // 1 pt below the rect bottom
    const neighbourDescenderRow = rect.y - 3; // 3 pt above the rect top
    expect(ownDescenderRow).toBeGreaterThanOrEqual(maskTopLeft);
    expect(ownDescenderRow).toBeLessThanOrEqual(maskBottomLeft);
    expect(neighbourDescenderRow).toBeLessThan(maskTopLeft);
  });
});

// ---------------------------------------------------------------------------
// DEF-129 — insertBlankPage afterIndex=-2 PREPENDS (new blank is FIRST)
// ---------------------------------------------------------------------------

describe('DEF-129: insertBlankPage afterIndex=-2 prepends (new blank is first)', () => {
  it('afterIndex=-2 on a 3-page doc: new blank is pageOrder[0], pageCount 4, undo restores, getDocumentBytes valid', async () => {
    const engine = new EngineService();
    const { path } = await makeNPagePdf(3);
    await engine.loadDocument('doc-pre', path);

    const before = await engine.getState('doc-pre');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    // Original visible order is [0, 1, 2].
    expect(before.value.pageOrder).toEqual([0, 1, 2]);
    expect(before.value.pageCount).toBe(3);

    // -2 is the PREPEND sentinel: the new blank page becomes the first
    // visible page. The blank is the last page added to the pdfDoc, so
    // its origIdx is 3; splice(0, 0, 3) puts it at pageOrder[0] and the
    // originals follow unchanged ([0, 1, 2] shifted right).
    const res = await engine.insertBlankPage('doc-pre', -2, 400, 300);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.pageCount).toBe(4);
    expect(res.value.pageOrder[0]).toBe(3);
    expect(res.value.pageOrder).toEqual([3, 0, 1, 2]);

    // getDocumentBytes round-trips to a valid 4-page PDF (the prepend
    // survives serialization: serializeDoc copyPages walks doc.order, so
    // the blank page is the first page in the output too).
    const bytesRes = await engine.getDocumentBytes('doc-pre');
    expect(bytesRes.ok).toBe(true);
    if (!bytesRes.ok) return;
    const reparsed = await PDFDocument.load(bytesRes.value);
    expect(reparsed.getPageCount()).toBe(4);

    // Undo reverts to the original 3-page order (the snapshot captured
    // the pre-insert pdfDoc bytes, so the prepended blank page is gone
    // from the pdfDoc too, not just from doc.order).
    const undo = await engine.undo('doc-pre');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.pageCount).toBe(3);
    expect(undo.value.pageOrder).toEqual([0, 1, 2]);

    // A saveAs round-trip after a prepend is a valid PDF too.
    const reInsert = await engine.insertBlankPage('doc-pre', -2, 500, 400);
    expect(reInsert.ok).toBe(true);
    if (!reInsert.ok) return;
    expect(reInsert.value.pageCount).toBe(4);
    const out = join(dir, 'prepend-out.pdf');
    const saved = await engine.saveAs('doc-pre', out);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { readFile } = await import('node:fs/promises');
    const reparsed2 = await PDFDocument.load(await readFile(out));
    expect(reparsed2.getPageCount()).toBe(4);
  });

  it('afterIndex=-2 still rejects -3 (the floor of the prepend sentinel)', async () => {
    // The guard allows [-2, doc.order.length]; anything below -2 is
    // out-of-range. Confirms -2 is a unique prepend marker, not a
    // general "any negative inserts at front" rule.
    const engine = new EngineService();
    const { path } = await makeNPagePdf(2);
    await engine.loadDocument('doc-floor', path);
    const r = await engine.insertBlankPage('doc-floor', -3, 400, 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('out-of-range');
  });
});
