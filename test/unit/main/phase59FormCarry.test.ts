import { describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
} from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { carryAcroForm } from '../../../src/main/services/form-fill';
import { optimizePdf } from '../../../src/main/services/optimize';

/**
 * Phase 59 item 4 (part 1 of 3) â€” the save path must CARRY the source AcroForm
 * (fields AND widgets) instead of recreating fields.
 *
 * Fixture (built in-test with pdf-lib, no committed binaries):
 *   - page 1: text field `customer.name` with an explicit box, /DA and /V;
 *   - page 2: a THREE-widget button group `options.group` (one field, three
 *     widget kids, each with its own on-state /S1..S3, its own /Rect and its
 *     own /AP /N appearance stream);
 *   - page 3: text field `notes`.
 * The AcroForm carries /DR /Font (Helvetica) and /NeedAppearances true.
 */

const GROUP_NAME = 'options.group';

type WidgetEntry = [PDFRef | undefined, PDFDict];

function widgetsOn(doc: PDFDocument, pageIndex: number): WidgetEntry[] {
  const entries: WidgetEntry[] = [];
  const pageNode = doc.getPage(pageIndex).node;
  const annots = doc.context.lookupMaybe(pageNode.get(PDFName.of('Annots')), PDFArray);
  if (annots === undefined) return entries;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = doc.context.lookupMaybe(raw as any, PDFDict);
    if (dict === undefined) continue;
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
    entries.push([raw instanceof PDFRef ? raw : undefined, dict]);
  }
  return entries;
}

/** Decode a PDFString / PDFHexString value, or undefined for anything else. */
function decodeString(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

function acroFormDict(doc: PDFDocument): PDFDict {
  const dict = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  if (dict === undefined) throw new Error('no AcroForm');
  return dict;
}

/** Field dicts of the AcroForm /Fields tree, keyed by /T. */
function fieldDictsByName(doc: PDFDocument): Map<string, PDFDict> {
  const result = new Map<string, PDFDict>();
  const roots = doc.context.lookupMaybe(acroFormDict(doc).get(PDFName.of('Fields')), PDFArray);
  if (roots === undefined) return result;
  for (let i = 0; i < roots.size(); i++) {
    const dict = doc.context.lookupMaybe(roots.get(i), PDFDict);
    if (dict === undefined) continue;
    const name = dict.get(PDFName.of('T'));
    if (name instanceof PDFString) result.set(name.decodeText(), dict);
  }
  return result;
}

async function buildFormFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.node.set(PDFName.of('Annots'), doc.context.obj([]));
  }
  const form = doc.getForm();

  // --- page 1: a plain text field with an explicit /DA and value -----------
  const nameField = form.createTextField('customer.name');
  nameField.setText('Ada Lovelace');
  nameField.addToPage(doc.getPage(0), { x: 72, y: 640, width: 240, height: 24 });
  (nameField.acroField as unknown as { dict: PDFDict }).dict.set(
    PDFName.of('DA'),
    PDFString.of('/Helv 12 Tf 0 g'),
  );

  // --- page 2: a three-widget button group with distinct on-states ---------
  const groupDict = doc.context.obj({
    FT: 'Btn',
    T: PDFString.of(GROUP_NAME),
    Ff: PDFNumber.of(32768), // radio: one field, N widgets, distinct on-states
  }) as PDFDict;
  const groupRef = doc.context.register(groupDict);
  const kids: PDFRef[] = [];
  const page2Annots = doc.getPage(1).node.get(PDFName.of('Annots')) as PDFArray;
  for (let i = 0; i < 3; i++) {
    const onState = `S${i + 1}`;
    const appearanceRef = doc.context.register(
      doc.context.stream('q 0 0 10 10 re f Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 10, 10],
      }),
    );
    const widget = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      F: 4,
      Rect: [72, 700 - i * 40, 92, 720 - i * 40],
      P: doc.getPage(1).ref,
      Parent: groupRef,
      AS: PDFName.of('Off'),
      MK: { BC: [0, 0, 0], BG: [1, 1, 1] },
      AP: { N: doc.context.obj({ [onState]: appearanceRef }) },
    }) as PDFDict;
    const widgetRef = doc.context.register(widget);
    kids.push(widgetRef);
    page2Annots.push(widgetRef);
  }
  groupDict.set(PDFName.of('Kids'), doc.context.obj(kids));
  groupDict.set(PDFName.of('V'), PDFName.of('Off'));
  form.acroForm.addField(groupRef);

  // --- page 3: a second text field ----------------------------------------
  const notesField = form.createTextField('notes');
  notesField.setText('page three');
  notesField.addToPage(doc.getPage(2), { x: 100, y: 500, width: 200, height: 20 });

  // --- AcroForm-level resources and the appearance flag -------------------
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  form.acroForm.dict.set(
    PDFName.of('DR'),
    doc.context.obj({ Font: doc.context.obj({ Helv: helvetica.ref }) }),
  );
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(true));

  return doc.save();
}

async function serializeViaEngine(bytes: Uint8Array, docId = 'phase59-doc'): Promise<Uint8Array> {
  const engine = new EngineService();
  const loaded = await engine.loadDocumentBytes(docId, bytes);
  expect(loaded.ok).toBe(true);
  const out = await engine.getDocumentBytes(docId);
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(`getDocumentBytes failed: ${out.error.message}`);
  return new Uint8Array(out.value);
}

async function loadOut(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}
/** All widget dicts reachable from an AcroForm /Fields tree (deduplicated). */
function formWidgetDicts(doc: PDFDocument): PDFDict[] {
  const found: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') found.push(node);
    const kids = doc.context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
    if (kids === undefined) return;
    for (let i = 0; i < kids.size(); i++) {
      const kid = doc.context.lookupMaybe(kids.get(i), PDFDict);
      if (kid !== undefined) visit(kid);
    }
  };
  const roots = doc.context.lookupMaybe(acroFormDict(doc).get(PDFName.of('Fields')), PDFArray);
  if (roots === undefined) return found;
  for (let i = 0; i < roots.size(); i++) {
    const root = doc.context.lookupMaybe(roots.get(i), PDFDict);
    if (root !== undefined) visit(root);
  }
  return found;
}

function rectOf(doc: PDFDocument, widget: PDFDict): number[] {
  const rect = doc.context.lookupMaybe(widget.get(PDFName.of('Rect')), PDFArray);
  if (rect === undefined) throw new Error('widget has no /Rect');
  const values: number[] = [];
  for (let i = 0; i < rect.size(); i++) values.push((rect.get(i) as PDFNumber).asNumber());
  return values;
}

/**
 * The button group's widgets as (rect, on-state names, /AS) signatures, read
 * through pdf-lib's own field API. pdf-lib adds an `Off` state to each widget's
 * /AP /N when it regenerates appearances, so callers filter it out when they
 * mean "the on-states".
 */
function groupWidgetSignatures(
  doc: PDFDocument,
): Array<{ rect: number[]; states: string[]; as: string | undefined }> {
  const field = doc.getForm().getFields().find((f) => f.getName() === GROUP_NAME);
  if (field === undefined) throw new Error('group field missing');
  return field.acroField.getWidgets().map((widget) => ({
    rect: rectOf(doc, widget.dict),
    states: onStatesOf(doc, widget.dict).sort(),
    as: widget.dict.get(PDFName.of('AS'))?.toString(),
  }));
}

function onStatesOf(doc: PDFDocument, widget: PDFDict): string[] {
  const ap = doc.context.lookupMaybe(widget.get(PDFName.of('AP')), PDFDict);
  const n = ap === undefined ? undefined : doc.context.lookupMaybe(ap.get(PDFName.of('N')), PDFDict);
  if (n === undefined) return [];
  return n.entries().map(([key]) => key.toString().replace(/^\//, ''));
}

function assertEveryWidgetPointsAtItsOwnOutputPage(doc: PDFDocument): void {
  for (let i = 0; i < doc.getPageCount(); i++) {
    const widgets = widgetsOn(doc, i);
    expect(widgets.length).toBeGreaterThan(0);
    for (const [, dict] of widgets) {
      const p = dict.get(PDFName.of('P'));
      expect(p).toBeInstanceOf(PDFRef);
      expect(doc.context.lookup(p as PDFRef)).toBe(doc.getPage(i).node);
      expect((p as PDFRef).tag).toBe(doc.getPage(i).ref.tag);
    }
  }
}

describe('Phase 59 item 4 - AcroForm carry', () => {
  it('engine save carries the whole form: counts, /P, group widgets, /DA, /DR', async () => {
    const bytes = await buildFormFixture();
    const srcDoc = await loadOut(bytes);
    const outDoc = await loadOut(await serializeViaEngine(bytes));

    // (a) field count unchanged
    expect(srcDoc.getForm().getFields().length).toBe(3);
    expect(outDoc.getForm().getFields().length).toBe(3);

    // (b) widget count unchanged, per page (1 text + 3 group + 1 text)
    const srcPerPage = [0, 1, 2].map((i) => widgetsOn(srcDoc, i).length);
    const outPerPage = [0, 1, 2].map((i) => widgetsOn(outDoc, i).length);
    expect(srcPerPage).toEqual([1, 3, 1]);
    expect(outPerPage).toEqual([1, 3, 1]);

    // (c) every widget /P resolves to its own output page, via the canonical ref
    assertEveryWidgetPointsAtItsOwnOutputPage(outDoc);

    // no widget wears pdf-lib default box (0,0,200,50) any more
    for (const widget of formWidgetDicts(outDoc)) {
      expect(rectOf(outDoc, widget)).not.toEqual([0, 0, 200, 50]);
    }

    // (d) the button group still has all three widgets with their on-states
    const group = outDoc.getForm().getFields().find((f) => f.getName() === GROUP_NAME);
    expect(group).toBeDefined();
    const groupDict = (group!.acroField as unknown as { dict: PDFDict }).dict;
    const kids = outDoc.context.lookupMaybe(groupDict.get(PDFName.of('Kids')), PDFArray);
    expect(kids?.size()).toBe(3);

    // the field tree's kids ARE the page's own widgets (one object, not a copy)
    const pageWidgetRefs = widgetsOn(outDoc, 1).map(([ref]) => ref?.tag);
    expect(pageWidgetRefs.length).toBe(3);
    for (let i = 0; i < kids!.size(); i++) {
      expect((kids!.get(i) as PDFRef).tag).toBe(pageWidgetRefs[i]);
    }

    // widget geometry, on-state names and /AS are byte-for-byte the source's
    const srcGroup = groupWidgetSignatures(srcDoc);
    const outGroup = groupWidgetSignatures(outDoc);
    expect(srcGroup.length).toBe(3);
    expect(outGroup).toEqual(srcGroup);
    expect(outGroup.map((w) => w.states.filter((s) => s !== 'Off'))).toEqual([
      ['S1'],
      ['S2'],
      ['S3'],
    ]);
    expect(outGroup.map((w) => w.rect)).toEqual([
      [72, 700, 92, 720],
      [72, 660, 92, 680],
      [72, 620, 92, 640],
    ]);
    expect(groupDict.get(PDFName.of('V'))?.toString()).toBe('/Off');

    // (e) the AcroForm /DR /Font still carries the source's Helvetica font,
    // so the carried resource dictionary survives the save. Phase 59 item 4
    // (part 2) intentionally REGENERATES each text field's appearance with
    // the bundled Unicode font on save, so the field's own /DA now names
    // DejaVu rather than the source's Helvetica -- that is the native-fill
    // mechanism, not a carry regression: the field dict, its /V and the
    // AcroForm /DR are all still the carried objects.
    const nameDict = (outDoc.getForm().getField('customer.name').acroField as unknown as {
      dict: PDFDict;
    }).dict;
    const da = nameDict.get(PDFName.of('DA'));
    expect(decodeString(da)).toBeDefined();
    expect(decodeString(da)).toContain('DejaVu');
    const dr = outDoc.context.lookupMaybe(acroFormDict(outDoc).get(PDFName.of('DR')), PDFDict)!;
    const fonts = outDoc.context.lookupMaybe(dr.get(PDFName.of('Font')), PDFDict)!;
    const helv = outDoc.context.lookupMaybe(fonts.get(PDFName.of('Helv')), PDFDict)!;
    expect(helv.get(PDFName.of('Subtype'))?.toString()).toBe('/Type1');
    expect(helv.get(PDFName.of('BaseFont'))?.toString()).toBe('/Helvetica');

    // /NeedAppearances is left exactly as the source had it (true here)
    expect(acroFormDict(outDoc).get(PDFName.of('NeedAppearances'))?.toString()).toBe('true');

    // the carried /V value is the source's (structure carry, not a fill)
    expect(decodeString(nameDict.get(PDFName.of('V')))).toBe('Ada Lovelace');
  });

  it('carryAcroForm reports source and carried counts and remaps /P (identity page map)', async () => {
    const bytes = await buildFormFixture();
    const src = await loadOut(bytes);
    const out = await PDFDocument.create();
    const pageMap = new Map<number, number>();
    for (let i = 0; i < src.getPageCount(); i++) {
      const [page] = await out.copyPages(src, [i]);
      out.addPage(page);
      pageMap.set(i, i);
    }

const summary = carryAcroForm(src, out, pageMap);
    expect(summary).toEqual({
      fieldCount: 3,
      widgetCount: 5,
      sourceFieldCount: 3,
      sourceWidgetCount: 5,
    });

    const round = await loadOut(await out.save());
    expect(round.getForm().getFields().length).toBe(3);
    assertEveryWidgetPointsAtItsOwnOutputPage(round);
    expect([0, 1, 2].map((i) => widgetsOn(round, i).length)).toEqual([1, 3, 1]);

    // /NeedAppearances is never forced: an absent flag stays absent
    const srcNoFlag = await loadOut(bytes);
    acroFormDict(srcNoFlag).delete(PDFName.of('NeedAppearances'));
    const outNoFlag = await PDFDocument.create();
    const noFlagMap = new Map<number, number>();
    for (let i = 0; i < srcNoFlag.getPageCount(); i++) {
      const [page] = await outNoFlag.copyPages(srcNoFlag, [i]);
      outNoFlag.addPage(page);
      noFlagMap.set(i, i);
    }
    carryAcroForm(srcNoFlag, outNoFlag, noFlagMap);
    expect(acroFormDict(outNoFlag).get(PDFName.of('NeedAppearances'))).toBeUndefined();
  });

  it('carryAcroForm remaps /P through a reordered page map and drops deleted-page refs', async () => {
    const bytes = await buildFormFixture();
    const src = await loadOut(bytes);
    const out = await PDFDocument.create();
    // Copy source page 2 first, then source page 0; source page 1 is dropped.
    const pageMap = new Map<number, number>();
    for (const [srcIdx, outIdx] of [[2, 0], [0, 1]] as const) {
      const [page] = await out.copyPages(src, [srcIdx]);
      out.addPage(page);
      pageMap.set(srcIdx, outIdx);
    }

    const summary = carryAcroForm(src, out, pageMap);
    expect(summary.fieldCount).toBe(3);
    expect(summary.widgetCount).toBe(5);

    // `customer.name` lives on source page 0 -> output page 1.
    const nameWidget = out.getForm().getField('customer.name').acroField.getWidgets()[0].dict;
    expect((nameWidget.get(PDFName.of('P')) as PDFRef).tag).toBe(out.getPage(1).ref.tag);
    expect(out.context.lookup(nameWidget.get(PDFName.of('P')) as PDFRef)).toBe(out.getPage(1).node);

    // `notes` lives on source page 2 -> output page 0.
    const notesWidget = out.getForm().getField('notes').acroField.getWidgets()[0].dict;
    expect((notesWidget.get(PDFName.of('P')) as PDFRef).tag).toBe(out.getPage(0).ref.tag);
    expect(out.context.lookup(notesWidget.get(PDFName.of('P')) as PDFRef)).toBe(out.getPage(0).node);

    // the group's widgets were on the dropped page 1: carried, but /P dropped
    const groupDict = fieldDictsByName(out).get(GROUP_NAME)!;
    const kids = out.context.lookupMaybe(groupDict.get(PDFName.of('Kids')), PDFArray)!;
    expect(kids.size()).toBe(3);
    for (let i = 0; i < kids.size(); i++) {
      const widget = out.context.lookupMaybe(kids.get(i), PDFDict)!;
      expect(widget.get(PDFName.of('P'))).toBeUndefined();
    }

    // the output still saves and reloads with the fields intact
    const round = await loadOut(await out.save());
    expect(round.getForm().getFields().length).toBe(3);
  });

  it('optimizePdf carries the form instead of recreating it', async () => {
    const src = await loadOut(await buildFormFixture());
    const outDoc = await loadOut(await optimizePdf(src, 'compact'));

    expect(outDoc.getForm().getFields().length).toBe(3);
    expect([0, 1, 2].map((i) => widgetsOn(outDoc, i).length)).toEqual([1, 3, 1]);
    assertEveryWidgetPointsAtItsOwnOutputPage(outDoc);

    const group = outDoc.getForm().getFields().find((f) => f.getName() === GROUP_NAME)!;
    const groupDict = (group.acroField as unknown as { dict: PDFDict }).dict;
    const kids = outDoc.context.lookupMaybe(groupDict.get(PDFName.of('Kids')), PDFArray)!;
    expect(kids.size()).toBe(3);
    expect(groupWidgetSignatures(outDoc)).toEqual(groupWidgetSignatures(src));
  });
});
