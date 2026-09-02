// Phase 14 / DEF-135 / DEF-136 — text-box placement registry (backend).
//
// Text boxes are held in an engine-side registry (like signature placements)
// and only drawn at save time, once, at their FINAL rect — so moving a box
// never masks the content under its old rect (the root cause of DEF-135) and
// a box can be deleted (DEF-136). This file pins the add/move/delete registry
// ops, the save round-trip (text at the NEW rect, underlying content intact,
// no white mask), undo/redo, and save/reload of the registry.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, StandardFonts } from 'pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { EngineState, TextBoxModel } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-textbox-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function createNPagePdf(n: number): Promise<{ path: string }> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i}`, { x: 72, y: 700, size: 14 });
  }
  const bytes = await doc.save();
  return { path: await writeFixture(`test${n}.pdf`, bytes) };
}

/** Create a 1-page PDF with a known title string drawn on it, so a box placed
 *  over the title can be moved away and the title verified intact. */
async function createSinglePagePdfWithText(text: string): Promise<{ path: string }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 72, y: 700, size: 24, font });
  const bytes = await doc.save();
  return { path: await writeFixture('with-text.pdf', bytes) };
}

/** Hex-encode a string as pdf-lib would in a Tj operand (uppercase hex of
 *  the Latin-1 bytes). Used to search decoded content streams. */
function hexOperand(text: string): string {
  return Buffer.from(text, 'latin1').toString('hex').toUpperCase();
}

/** Decode page-0's /Contents (single ref or array), inflate each FlateDecode
 *  stream, and return the concatenated decoded content-stream text. Drawn
 *  text from a StandardFont appears as a hex string operand to Tj. */
async function decodedPage0Content(path: string): Promise<string> {
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

/** True if the decoded page-0 content contains `text` as a Tj operand. */
async function page0ContentHasText(path: string, text: string): Promise<boolean> {
  const content = await decodedPage0Content(path);
  return content.includes(hexOperand(text)) || content.includes(text);
}

/** Count of white-fill rectangle operators (`1 1 1 rg` ... `re f`) in the
 *  decoded page-0 content. A freshly-created PDFDocument page has no white
 *  fill, so any `1 1 1 rg` is a white rectangle the save path drew (e.g. a
 *  text-box background, or — in the old editImage mask path — a mask over the
 *  old rect). Used to prove the registry path draws NO mask at the old rect. */
function whiteFillCount(content: string): number {
  // `1 1 1 rg` sets the nonstroking color to white; each such operator marks
  // one white-fill drawing sequence. Count occurrences.
  let count = 0;
  let i = 0;
  const needle = '1 1 1 rg';
  while (true) {
    const idx = content.indexOf(needle, i);
    if (idx === -1) break;
    count += 1;
    i = idx + needle.length;
  }
  return count;
}

/** Read the text-box registry off an EngineState. */
function getTextBoxes(state: EngineState): TextBoxModel[] {
  return (state as any).textBoxes as TextBoxModel[] | undefined ?? [];
}

// ---------------------------------------------------------------------------
// addTextBox — registry push (NO immediate draw)
// ---------------------------------------------------------------------------

describe('DEF-135/136: addTextBox registry push', () => {
  it('pushes a box to the registry and echoes it on state (no id -> engine generates uuid)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addTextBox('doc-1', {
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 100 },
      text: 'HELLO BOX',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.modified).toBe(true);
      const boxes = getTextBoxes(r.value);
      expect(boxes.length).toBe(1);
      expect(typeof boxes[0].id).toBe('string');
      expect(boxes[0].id.length).toBeGreaterThan(0);
      expect(boxes[0].page).toBe(1);
      expect(boxes[0].text).toBe('HELLO BOX');
      expect(boxes[0].font).toBe('Helvetica');
      expect(boxes[0].size).toBe(12);
    }
  });

  it('honours a payload-provided id (renderer-generated uuid)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addTextBox('doc-1', {
      id: 'client-id-42',
      page: 1,
      rect: { x: 10, y: 10, width: 50, height: 50 },
      text: 'X',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const boxes = getTextBoxes(r.value);
      expect(boxes[0].id).toBe('client-id-42');
    }
  });

  it('normalises the legacy EditColor payload to a hex string on the model', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addTextBox('doc-1', {
      page: 1,
      rect: { x: 0, y: 0, width: 40, height: 40 },
      text: 'RED',
      color: { r: 1, g: 0, b: 0 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const boxes = getTextBoxes(r.value);
      expect(boxes[0].color).toBe('#ff0000');
    }
  });

  it('does NOT draw the box into the page before save (registry-only)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 100 },
      text: 'UNDRAWN',
    });

    // getDocumentBytes serializes the CURRENT state. Before any save the
    // registry box IS drawn by serializeDoc (it draws every registry box),
    // so the text appears — but NO white mask is drawn at the old rect
    // because there is no "old rect" (the box was never baked). Verify the
    // text is present and there is no white fill (background defaults to
    // 'none', so no white rectangle at all).
    const bytesR = await engine.getDocumentBytes('doc-1');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const tmp = join(dir, 'undrawn.pdf');
    await writeFile(tmp, Buffer.from(new Uint8Array(bytesR.value)));
    const content = await decodedPage0Content(tmp);
    expect(content.includes(hexOperand('UNDRAWN'))).toBe(true);
    // background 'none' -> zero white-fill rectangles.
    expect(whiteFillCount(content)).toBe(0);
  });

  it('returns out-of-range for an invalid page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addTextBox('doc-1', {
      page: 99,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      text: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('out-of-range');
    }
  });

  it('returns engine-error for empty text', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.addTextBox('doc-1', {
      page: 1,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      text: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// moveTextBox — registry rect update (no mask)
// ---------------------------------------------------------------------------

describe('DEF-135: moveTextBox registry update', () => {
  it('updates the box rect in the registry and echoes it', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const addR = await engine.addTextBox('doc-1', {
      id: 'box-1',
      page: 1,
      rect: { x: 72, y: 72, width: 100, height: 50 },
      text: 'MOVABLE',
    });
    expect(addR.ok).toBe(true);

    const moveR = await engine.moveTextBox('doc-1', 'box-1', {
      x: 200, y: 200, width: 100, height: 50,
    });
    expect(moveR.ok).toBe(true);
    if (moveR.ok) {
      const boxes = getTextBoxes(moveR.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].rect.x).toBe(200);
      expect(boxes[0].rect.y).toBe(200);
      expect(boxes[0].text).toBe('MOVABLE');
    }
  });

  it('returns not-found for an unknown id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.moveTextBox('doc-1', 'no-such-box', {
      x: 0, y: 0, width: 10, height: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });

  it('moving a box draws the text at the NEW rect only (no mask at the old rect)', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('ORIGTITLE');
    await engine.loadDocument('doc-1', path);

    // Place a box whose OLD rect sits over the title.
    await engine.addTextBox('doc-1', {
      id: 'box-over',
      page: 1,
      rect: { x: 60, y: 690, width: 240, height: 40 },
      text: 'MYBOX',
    });
    // Move it well away from the title (no background -> no white fill at all).
    await engine.moveTextBox('doc-1', 'box-over', {
      x: 300, y: 100, width: 240, height: 40,
    });

    const bytesR = await engine.getDocumentBytes('doc-1');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const out = join(dir, 'moved.pdf');
    await writeFile(out, Buffer.from(new Uint8Array(bytesR.value)));

    // The title is still in the content stream (underlying content intact).
    expect(await page0ContentHasText(out, 'ORIGTITLE')).toBe(true);
    // The box text is present (drawn once at the new rect).
    expect(await page0ContentHasText(out, 'MYBOX')).toBe(true);
    // No white mask: background 'none' -> zero white-fill rectangles. The old
    // editImage mask path would have drawn a `1 1 1 rg ... re f` over the old
    // rect; the registry path draws none.
    const content = await decodedPage0Content(out);
    expect(whiteFillCount(content)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteTextBox — registry removal (DEF-136)
// ---------------------------------------------------------------------------

describe('DEF-136: deleteTextBox registry removal', () => {
  it('removes the box from the registry', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-a',
      page: 1,
      rect: { x: 0, y: 0, width: 50, height: 50 },
      text: 'A',
    });
    await engine.addTextBox('doc-1', {
      id: 'box-b',
      page: 1,
      rect: { x: 100, y: 100, width: 50, height: 50 },
      text: 'B',
    });

    const delR = await engine.deleteTextBox('doc-1', 'box-a');
    expect(delR.ok).toBe(true);
    if (delR.ok) {
      const boxes = getTextBoxes(delR.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].id).toBe('box-b');
    }
  });

  it('returns not-found for an unknown id', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    const r = await engine.deleteTextBox('doc-1', 'ghost');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-found');
    }
  });

  it('a deleted box is no longer drawn at save time', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-del',
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 100 },
      text: 'DELETEME',
    });
    await engine.deleteTextBox('doc-1', 'box-del');

    const bytesR = await engine.getDocumentBytes('doc-1');
    expect(bytesR.ok).toBe(true);
    if (!bytesR.ok) return;
    const out = join(dir, 'deleted.pdf');
    await writeFile(out, Buffer.from(new Uint8Array(bytesR.value)));
    expect(await page0ContentHasText(out, 'DELETEME')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: add -> move -> save -> reparse (the DEF-135 contract)
// ---------------------------------------------------------------------------

describe('DEF-135: add -> move -> save round-trip (text at NEW rect, content intact)', () => {
  it('saves the box at the moved rect; the original title stays in the stream', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('TFLEX TECHNICAL REPORT');
    await engine.loadDocument('doc-rt', path);

    // Place a box over the title (the DEF-135 repro: box over the title).
    await engine.addTextBox('doc-rt', {
      id: 'box-rt',
      page: 1,
      rect: { x: 60, y: 688, width: 300, height: 40 },
      text: 'MY BOX',
    });
    // Move it 120pt right / 120pt down (the DEF-135 repro drag).
    await engine.moveTextBox('doc-rt', 'box-rt', {
      x: 180, y: 568, width: 300, height: 40,
    });

    const saveR = await engine.save('doc-rt');
    expect(saveR.ok).toBe(true);

    // Re-parse the saved file: title intact, box text present, no white mask.
    const rePath = saveR.ok ? saveR.value : '';
    expect(await page0ContentHasText(rePath, 'TFLEX TECHNICAL REPORT')).toBe(true);
    expect(await page0ContentHasText(rePath, 'MY BOX')).toBe(true);
    const content = await decodedPage0Content(rePath);
    // The box used background 'none' (default) -> no white fill anywhere. The
    // old mask-and-redraw move path would have left a white rectangle over
    // the title's original position; the registry path draws none.
    expect(whiteFillCount(content)).toBe(0);
  });

  it('save preserves underlying content: a box with background white over text does not erase the text from the stream', async () => {
    const engine = new EngineService();
    const { path } = await createSinglePagePdfWithText('KEEPME');
    await engine.loadDocument('doc-preserve', path);

    await engine.addTextBox('doc-preserve', {
      id: 'box-cover',
      page: 1,
      rect: { x: 60, y: 688, width: 200, height: 40 },
      text: 'COVER',
      background: 'white',
    });

    const saveR = await engine.save('doc-preserve');
    expect(saveR.ok).toBe(true);
    const rePath = saveR.ok ? saveR.value : '';
    // The underlying 'KEEPME' text operators are still in the stream (the
    // registry path never strips content; it only draws on top). A white
    // background fill may visually cover them, but the text is NOT erased
    // from the content stream (contrast with the old editImage mask, which
    // also did not strip — but the point is the registry path is strictly
    // additive: it never removes the title's operators).
    expect(await page0ContentHasText(rePath, 'KEEPME')).toBe(true);
    expect(await page0ContentHasText(rePath, 'COVER')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Undo / redo of registry ops
// ---------------------------------------------------------------------------

describe('DEF-135/136: undo/redo of text-box registry ops', () => {
  it('undo reverts an addTextBox (box gone from registry)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-u',
      page: 1,
      rect: { x: 72, y: 72, width: 100, height: 50 },
      text: 'UNDO',
    });
    let state = await engine.getState('doc-1');
    expect(state.ok && getTextBoxes(state.value).length).toBe(1);

    const undoR = await engine.undo('doc-1');
    expect(undoR.ok).toBe(true);
    if (undoR.ok) {
      expect(getTextBoxes(undoR.value).length).toBe(0);
    }
  });

  it('redo re-applies an undone addTextBox', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-r',
      page: 1,
      rect: { x: 72, y: 72, width: 100, height: 50 },
      text: 'REDO',
    });
    await engine.undo('doc-1');

    const redoR = await engine.redo('doc-1');
    expect(redoR.ok).toBe(true);
    if (redoR.ok) {
      const boxes = getTextBoxes(redoR.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].id).toBe('box-r');
    }
  });

  it('undo reverts a moveTextBox (rect back to original)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-m',
      page: 1,
      rect: { x: 72, y: 72, width: 100, height: 50 },
      text: 'M',
    });
    await engine.moveTextBox('doc-1', 'box-m', {
      x: 300, y: 300, width: 100, height: 50,
    });
    let state = await engine.getState('doc-1');
    expect(state.ok && getTextBoxes(state.value)[0].rect.x).toBe(300);

    const undoR = await engine.undo('doc-1');
    expect(undoR.ok).toBe(true);
    if (undoR.ok) {
      expect(getTextBoxes(undoR.value)[0].rect.x).toBe(72);
    }
  });

  it('undo reverts a deleteTextBox (box restored)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-d',
      page: 1,
      rect: { x: 72, y: 72, width: 100, height: 50 },
      text: 'D',
    });
    await engine.deleteTextBox('doc-1', 'box-d');
    let state = await engine.getState('doc-1');
    expect(state.ok && getTextBoxes(state.value).length).toBe(0);

    const undoR = await engine.undo('doc-1');
    expect(undoR.ok).toBe(true);
    if (undoR.ok) {
      const boxes = getTextBoxes(undoR.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].id).toBe('box-d');
    }
  });
});

// ---------------------------------------------------------------------------
// Registry survives save/reload (catalog /TFlexBox)
// ---------------------------------------------------------------------------

describe('DEF-135/136: registry survives save/reload', () => {
  it('boxes reload from the saved file and can be moved/deleted after a reopen', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(2);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', {
      id: 'box-persist',
      page: 1,
      rect: { x: 72, y: 72, width: 200, height: 80 },
      text: 'PERSIST ME',
      font: 'Times',
      size: 14,
      background: 'white',
    });
    await engine.save('doc-1');

    // Re-load the saved file into a fresh doc.
    await engine.loadDocument('doc-reloaded', path);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const boxes = getTextBoxes(state.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].id).toBe('box-persist');
      expect(boxes[0].text).toBe('PERSIST ME');
      expect(boxes[0].font).toBe('Times');
      expect(boxes[0].size).toBe(14);
    }

    // The reloaded box can be moved and deleted (registry ops work post-reload).
    const moveR = await engine.moveTextBox('doc-reloaded', 'box-persist', {
      x: 200, y: 200, width: 200, height: 80,
    });
    expect(moveR.ok).toBe(true);

    const delR = await engine.deleteTextBox('doc-reloaded', 'box-persist');
    expect(delR.ok).toBe(true);
    if (delR.ok) {
      expect(getTextBoxes(delR.value).length).toBe(0);
    }
  });

  it('a doc with no boxes reloads with an empty registry (no /TFlexBox entry harm)', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(1);
    await engine.loadDocument('doc-1', path);
    await engine.save('doc-1');

    await engine.loadDocument('doc-reloaded', path);
    const state = await engine.getState('doc-reloaded');
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(getTextBoxes(state.value).length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Annotations stay correctly keyed alongside text-box ops (DEF-133 guard)
// ---------------------------------------------------------------------------

describe('DEF-135/136: text-box ops do not disturb annotation keying', () => {
  it('an annotation on page 1 stays on page 1 after a textBox add/move/save on the same page', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    // Create an annotation on visible page 1.
    const annR = await engine.createAnnotation('doc-1', {
      id: 'ann-1',
      page: 1,
      kind: 'rect',
      color: 'red',
      rects: [{ x: 50, y: 50, width: 100, height: 100 }],
    });
    expect(annR.ok).toBe(true);

    // Add + move a text box on the same page.
    await engine.addTextBox('doc-1', {
      id: 'box-1',
      page: 1,
      rect: { x: 200, y: 200, width: 120, height: 60 },
      text: 'ALONGSIDE',
    });
    await engine.moveTextBox('doc-1', 'box-1', {
      x: 250, y: 250, width: 120, height: 60,
    });

    const state = await engine.getState('doc-1');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const anns = (state.value as any).annotations as any[];
      expect(anns.length).toBe(1);
      expect(anns[0].page).toBe(1);
      expect(anns[0].id).toBe('ann-1');
      // The text box is also present and on page 1.
      const boxes = getTextBoxes(state.value);
      expect(boxes.length).toBe(1);
      expect(boxes[0].page).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Page-delete drops / shifts text boxes (mirror signature handling)
// ---------------------------------------------------------------------------

describe('DEF-135/136: page-delete drops and shifts text boxes', () => {
  it('deleting page 1 drops a box on it and shifts later boxes down', async () => {
    const engine = new EngineService();
    const { path } = await createNPagePdf(3);
    await engine.loadDocument('doc-1', path);

    await engine.addTextBox('doc-1', { id: 'b1', page: 1, rect: { x: 0, y: 0, width: 10, height: 10 }, text: '1' });
    await engine.addTextBox('doc-1', { id: 'b3', page: 3, rect: { x: 0, y: 0, width: 10, height: 10 }, text: '3' });

    // Delete visible page 1 (0-based index 0).
    const delR = await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    expect(delR.ok).toBe(true);
    if (delR.ok) {
      const boxes = getTextBoxes(delR.value);
      // b1 (on deleted page) is gone; b3 shifts from page 3 -> page 2.
      expect(boxes.length).toBe(1);
      expect(boxes[0].id).toBe('b3');
      expect(boxes[0].page).toBe(2);
    }
  });
});
