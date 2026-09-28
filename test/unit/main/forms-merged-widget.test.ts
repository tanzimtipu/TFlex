import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getFormFields } from '../../../src/main/services/forms';

// ---------------------------------------------------------------------------
// Synthetic fixtures for the three AcroForm field/widget shapes:
//   - merged:  the field dict IS the widget (no /Kids, /P on the field dict)
//   - kids:    the field has /Kids whose widgets carry /P
//   - parent:  the widget sits in a page's /Annots and carries /Parent
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-merged-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pageHeight(doc: PDFDocument, oneBased: number): number {
  return doc.getPage(oneBased - 1).getHeight();
}

/** Build a merged (field-IS-widget) text field: copy the widget's annot keys
 *  onto the field dict, drop /Kids, and repoint the page /Annots at the field
 *  ref so the page owns the merged annotation. */
function makeMergedField(
  doc: PDFDocument,
  pageIndex: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const page = doc.getPage(pageIndex);
  const form = doc.getForm();
  const f = form.createTextField(name);
  f.setText('merged');
  f.addToPage(page, { x, y, width: w, height: h });

  const widget = f.acroField.getWidgets()[0];
  const keys = ['Rect', 'P', 'Subtype', 'Type', 'F', 'MK', 'DA', 'AP', 'Ff', 'T', 'TU', 'FT', 'V'];
  for (const k of keys) {
    const v = widget.dict.get(PDFName.of(k));
    if (v !== undefined) (f.acroField as unknown as { dict: { set: (n: PDFName, v: unknown) => void } }).dict.set(PDFName.of(k), v);
  }
  (f.acroField as unknown as { dict: { delete: (n: PDFName) => void } }).dict.delete(PDFName.of('Kids'));

  const annots = page.node.get(PDFName.of('Annots')) as PDFArray | undefined;
  if (annots && typeof annots.size === 'function') {
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (doc.context.lookup(ref as never) === widget.dict) {
        annots.set(i, f.ref);
      }
    }
  }
}

/** Build a /Parent-style field: a widget in the page /Annots with /Parent
 *  pointing at the field, and no /P on either the field or the widget. */
function makeParentStyleField(
  doc: PDFDocument,
  pageIndex: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const page = doc.getPage(pageIndex);
  const form = doc.getForm();
  const f = form.createTextField(name);
  f.setText('parent');
  f.addToPage(page, { x, y, width: w, height: h });
  // Strip /P from the kid widget so only the /Parent backlink can locate it.
  const widget = f.acroField.getWidgets()[0];
  (widget.dict as unknown as { delete: (n: PDFName) => void }).delete(PDFName.of('P'));
}

async function buildFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i++) doc.addPage([612, 792]);
  for (const p of doc.getPages()) {
    p.node.set(PDFName.of('Annots'), doc.context.obj([]));
  }

  // merged: field IS the widget, /P -> page 4 (0-based 3)
  makeMergedField(doc, 3, 'merged_field', 100, 400, 200, 24);

  // kids: normal pdf-lib field, widget /P -> page 2 (0-based 1)
  const form = doc.getForm();
  const kf = form.createTextField('kids_field');
  kf.setText('kids');
  kf.addToPage(doc.getPage(1), { x: 50, y: 600, width: 150, height: 18 });

  // parent-style: widget /Parent -> field, on page 5 (0-based 4)
  makeParentStyleField(doc, 4, 'parent_field', 70, 500, 120, 16);

  const bytes = await doc.save();
  const path = join(dir, 'merged-shapes.pdf');
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function loadSaved(path: string): Promise<PDFDocument> {
  const buf = await readFile(path);
  return PDFDocument.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('getFormFields - merged / kids / parent widget shapes', () => {
  it('assigns each field to its widget /P page (none on page 1)', async () => {
    const path = await buildFixture();
    const doc = await loadSaved(path);
    const fields = getFormFields(doc);

    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get('merged_field')?.page).toBe(4);
    expect(byName.get('kids_field')?.page).toBe(2);
    expect(byName.get('parent_field')?.page).toBe(5);

    const page1 = fields.filter((f) => f.page === 1);
    expect(page1.length).toBe(0);
  });

  it('merged field round-trips with no /Kids and a single self-widget', async () => {
    const path = await buildFixture();
    const doc = await loadSaved(path);
    const form = doc.getForm();
    const merged = form.getFields().find((f) => f.getName() === 'merged_field');
    expect(merged).toBeDefined();
    // Merged shape: no /Kids, getWidgets() returns the field dict itself.
    expect((merged!.acroField as unknown as { dict: { get: (n: PDFName) => unknown } }).dict.get(PDFName.of('Kids'))).toBeUndefined();
    expect(merged!.acroField.getWidgets().length).toBe(1);
    expect(getFormFields(doc).length).toBe(3);
  });

  it('flips widget /Rect from bottom-left to the top-left FormFieldRect', async () => {
    const path = await buildFixture();
    const doc = await loadSaved(path);
    const fields = getFormFields(doc);
    const byName = new Map(fields.map((f) => [f.name, f]));

    const form = doc.getForm();
    for (const name of ['merged_field', 'kids_field', 'parent_field']) {
      const raw = form.getFields().find((f) => f.getName() === name)!;
      const w = raw.acroField.getWidgets()[0].getRectangle();
      const pageH = pageHeight(doc, byName.get(name)!.page);
      const rect = byName.get(name)!.rect;
      expect(rect.x).toBeCloseTo(w.x, 3);
      expect(rect.width).toBeCloseTo(w.width, 3);
      expect(rect.height).toBeCloseTo(w.height, 3);
      // top-left y is the flip of the widget's bottom-left y.
      expect(rect.y).toBeCloseTo(pageH - w.y - w.height, 3);
      // sanity: page height is 792 for every page in this fixture.
      expect(pageH).toBe(792);
    }

    // Concrete numeric check for the kids field: pdf-lib insets the requested
    // y=600 by the 0.5pt border, so the raw /Rect bottom is 599.5 and the
    // top-left origin y must be 792 - 599.5 - height (a genuine flip, not the
    // raw bottom-left value passed through unchanged).
    const kidsRaw = form.getFields().find((f) => f.getName() === 'kids_field')!
      .acroField.getWidgets()[0].getRectangle();
    expect(kidsRaw.y).toBeCloseTo(599.5, 3);
    const kidsRect = byName.get('kids_field')!.rect;
    expect(kidsRect.y).toBeCloseTo(792 - kidsRaw.y - kidsRaw.height, 3);
    expect(Math.abs(kidsRect.y - kidsRaw.y)).toBeGreaterThan(1);
  });

  it('existing form.pdf fixture still reports its true pages with flipped rects', async () => {
    const { copyFile } = await import('node:fs/promises');
    const dest = join(dir, 'form.pdf');
    await copyFile(join(process.cwd(), 'test-fixtures', 'form.pdf'), dest);
    const doc = await loadSaved(dest);
    const fields = getFormFields(doc);
    expect(fields.length).toBe(8);
    for (const f of fields) {
      expect(f.page).toBeGreaterThanOrEqual(1);
      expect(f.rect.width).toBeGreaterThan(0);
      expect(f.rect.height).toBeGreaterThan(0);
    }
  });
});
