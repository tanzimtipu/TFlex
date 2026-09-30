import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { carryAcroFormInto, fillFormNatively } from '../../../src/main/services/form-fill';
import { getFormFields } from '../../../src/main/services/forms';
import { embedEditFont } from '../../../src/main/services/fonts';

/**
 * Phase 59 adversary fixes (ADV-121/124/125/126/127 -> DEF-421/424/425/426/427).
 * All fixtures are built in-test with pdf-lib - no committed binaries.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-adv59-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePdf(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

interface TextSpec {
  name: string;
  value: string;
  rect: { x: number; y: number; width: number; height: number };
}

/** One page holding the given text fields at explicit boxes. */
async function buildTextForm(fields: TextSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Annots'), doc.context.obj([]));
  const form = doc.getForm();
  for (const spec of fields) {
    const field = form.createTextField(spec.name);
    field.setText(spec.value);
    field.addToPage(page, spec.rect);
  }
  return doc.save();
}

/** Decode a PDFString / PDFHexString value. */
function decodeString(value: unknown): string | undefined {
  if (value instanceof PDFString) return value.decodeText();
  return undefined;
}

/** A three-widget button group with distinct on-states, /V = Off. */
async function buildGroupFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Annots'), doc.context.obj([]));
  const form = doc.getForm();
  const group = form.createCheckBox('group');
  group.addToPage(page, { x: 72, y: 600, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 570, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 540, width: 16, height: 16 });
  const widgets = group.acroField.getWidgets();
  const onStates = ['No', 'Yes', 'Maybe'];
  for (let i = 0; i < widgets.length; i++) {
    const widget = widgets[i];
    const ap = widget.dict.get(PDFName.of('AP')) as PDFDict;
    const normal = ap.get(PDFName.of('N')) as PDFDict;
    const onKey = (widget as unknown as { getOnValue: () => PDFName }).getOnValue();
    const stream = normal.get(onKey);
    normal.delete(onKey);
    normal.set(PDFName.of(onStates[i]), stream as never);
    widget.setAppearanceState(PDFName.of('Off'));
  }
  (group.acroField as unknown as { dict: PDFDict }).dict.set(PDFName.of('V'), PDFName.of('Off'));
  return doc.save({ updateFieldAppearances: false });
}

/**
 * ADV-124 fixture: a real field `legit` plus an orphan page widget
 * (`/FT /Tx /T (ghost)`) that is NOT referenced from the AcroForm /Fields
 * tree, placed on page 2 of a two-page document.
 */
async function buildOrphanFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([612, 792]);
  page1.node.set(PDFName.of('Annots'), doc.context.obj([]));
  const page2 = doc.addPage([612, 792]);
  page2.node.set(PDFName.of('Annots'), doc.context.obj([]));
  const form = doc.getForm();
  const legit = form.createTextField('legit');
  legit.setText('real');
  legit.addToPage(page1, { x: 72, y: 700, width: 150, height: 20 });

  const apRef = doc.context.register(
    doc.context.stream('q Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 20] }),
  );
  const orphan = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Tx',
    T: PDFString.of('ghost'),
    Rect: [72, 600, 92, 620],
    P: page2.ref,
    V: PDFString.of('ghost value'),
    AP: { N: apRef },
  }) as PDFDict;
  (page2.node.get(PDFName.of('Annots')) as PDFArray).push(doc.context.register(orphan));
  return doc.save();
}

/** ADV-125 fixture: catalog /AcroForm with an /XFA stream and empty /Fields. */
async function buildXfaOnlyFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const ctx = doc.context;
  const xfa = ctx.register(
    ctx.stream('<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>', {}),
  );
  const acro = ctx.obj({ Fields: ctx.obj([]), XFA: xfa }) as PDFDict;
  doc.catalog.set(PDFName.of('AcroForm'), acro);
  return doc.save();
}

/**
 * DEF-423 fixture: a real text field `body` plus a `/FT /Sig` field
 * `approval` in the SAME AcroForm /Fields tree, both with real widget rects.
 */
async function buildSignatureFieldFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Annots'), doc.context.obj([]));
  const form = doc.getForm();
  const body = form.createTextField('body');
  body.setText('hello');
  body.addToPage(page, { x: 72, y: 700, width: 200, height: 20 });

  const acro = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  if (acro === undefined) throw new Error('fixture has no AcroForm');
  const fields = doc.context.lookupMaybe(acro.get(PDFName.of('Fields')), PDFArray);
  if (fields === undefined) throw new Error('fixture has no /Fields');
  const sig = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('approval'),
    Rect: [72, 600, 272, 620],
    P: page.ref,
  }) as PDFDict;
  fields.push(doc.context.register(sig));
  return doc.save({ updateFieldAppearances: false });
}

/** ADV-127 fixture: fields on pages 2 and 3 (0-based 1 and 2). */
async function buildPaginatedFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    doc.addPage([612, 792]).node.set(PDFName.of('Annots'), doc.context.obj([]));
  }
  const form = doc.getForm();
  const f2 = form.createTextField('page2_field');
  f2.setText('two');
  f2.addToPage(doc.getPage(1), { x: 59.5, y: 699.5, width: 301, height: 21 });
  const f3 = form.createTextField('page3_field');
  f3.setText('three');
  f3.addToPage(doc.getPage(2), { x: 59.5, y: 650, width: 301, height: 21 });
  return doc.save();
}

/** All widget dicts reachable from an AcroForm /Fields tree. */
function formWidgetDicts(doc: PDFDocument): PDFDict[] {
  const found: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const walk = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') found.push(node);
    const kids = doc.context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
    if (kids === undefined) return;
    for (let i = 0; i < kids.size(); i++) {
      const kid = doc.context.lookupMaybe(kids.get(i), PDFDict);
      if (kid !== undefined) walk(kid);
    }
  };
  const acro = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  const roots = acro === undefined
    ? undefined
    : doc.context.lookupMaybe(acro.get(PDFName.of('Fields')), PDFArray);
  if (roots === undefined) return found;
  for (let i = 0; i < roots.size(); i++) {
    const root = doc.context.lookupMaybe(roots.get(i), PDFDict);
    if (root !== undefined) walk(root);
  }
  return found;
}

function rectOf(doc: PDFDocument, widget: PDFDict): number[] {
  const rect = doc.context.lookupMaybe(widget.get(PDFName.of('Rect')), PDFArray);
  if (rect === undefined) throw new Error('widget has no /Rect');
  const out: number[] = [];
  for (let i = 0; i < rect.size(); i++) out.push((rect.get(i) as PDFNumber).asNumber());
  return out;
}

async function loadSavedPdf(engine: EngineService, docId: string): Promise<PDFDocument> {
  const out = await engine.getDocumentBytes(docId);
  if (!out.ok) throw new Error(`getDocumentBytes failed: ${out.error.message}`);
  return PDFDocument.load(new Uint8Array(out.value), { updateMetadata: false });
}

describe('Phase 59 adversary fixes', () => {
  it('ADV-121: merge carries both AcroForms with real rects and renames colliding fields', async () => {
    const mainBytes = await buildTextForm([
      { name: 'applicant_name', value: 'Main', rect: { x: 72, y: 700, width: 201, height: 21 } },
      { name: 'shared', value: 'S', rect: { x: 72, y: 660, width: 151, height: 71 } },
    ]);
    const otherBytes = await buildTextForm([
      { name: 'applicant_name', value: 'Other', rect: { x: 72, y: 700, width: 401, height: 21 } },
      { name: 'skills', value: 'X', rect: { x: 72, y: 600, width: 151, height: 71 } },
    ]);
    const mainPath = await writePdf('main.pdf', mainBytes);
    const otherPath = await writePdf('other.pdf', otherBytes);

    const engine = new EngineService();
    expect((await engine.loadDocument('doc', mainPath)).ok).toBe(true);
    expect((await engine.merge('doc', [otherPath], 'after')).ok).toBe(true);

    const listed = await engine.getFormFields('doc');
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.length).toBe(4);

    const byName = new Map(listed.value.map((f) => [f.name, f]));
    // Both sides survive; the incoming collision is renamed deterministically.
    expect(byName.get('applicant_name')?.value).toBe('Main');
    expect(byName.get('applicant_name-merged-1')?.value).toBe('Other');
    expect(byName.get('shared')?.value).toBe('S');
    expect(byName.get('skills')?.value).toBe('X');

    // Every field keeps its REAL widget box: measure each SOURCE field and
    // compare the merged output to it (no pdf-lib default 200x50 reset).
    const mainSrc = await PDFDocument.load(mainBytes);
    const otherSrc = await PDFDocument.load(otherBytes);
    const srcSize = (doc: PDFDocument, name: string): number[] => {
      const f = getFormFields(doc).find((x) => x.name === name);
      if (f === undefined) throw new Error(`missing source field ${name}`);
      return [f.rect.width, f.rect.height];
    };
    const mergedSize = (name: string): number[] => {
      const f = byName.get(name);
      return [f?.rect.width ?? -1, f?.rect.height ?? -1];
    };
    expect(mergedSize('applicant_name')).toEqual(srcSize(mainSrc, 'applicant_name'));
    expect(mergedSize('applicant_name-merged-1')).toEqual(srcSize(otherSrc, 'applicant_name'));
    expect(mergedSize('shared')).toEqual(srcSize(mainSrc, 'shared'));
    expect(mergedSize('skills')).toEqual(srcSize(otherSrc, 'skills'));
    // None wears pdf-lib's default box (a reset would collapse them all).
    for (const f of listed.value) {
      expect([f.rect.width, f.rect.height]).not.toEqual([200, 50]);
    }

    // The saved artifact keeps them too (real widget geometry on disk).
    const round = await loadSavedPdf(engine, 'doc');
    const roundByName = new Map(getFormFields(round).map((f) => [f.name, f]));
    expect([roundByName.get('applicant_name-merged-1')?.rect.width,
      roundByName.get('applicant_name-merged-1')?.rect.height])
      .toEqual(srcSize(otherSrc, 'applicant_name'));
    expect([roundByName.get('applicant_name')?.rect.width,
      roundByName.get('applicant_name')?.rect.height]).toEqual(srcSize(mainSrc, 'applicant_name'));
    for (const widget of formWidgetDicts(round)) {
      expect(rectOf(round, widget)).not.toEqual([0, 0, 200, 50]);
    }
  });

  it('ADV-121: carryAcroFormInto merges /Fields, keeps widget counts and reports collisions', async () => {
    const a = await PDFDocument.load(await buildTextForm([
      { name: 'dup', value: 'a', rect: { x: 72, y: 700, width: 200, height: 21 } },
      { name: 'only_a', value: 'a2', rect: { x: 72, y: 660, width: 120, height: 21 } },
    ]));
    const b = await PDFDocument.load(await buildTextForm([
      { name: 'dup', value: 'b', rect: { x: 72, y: 700, width: 330, height: 40 } },
    ]));
    const out = await PDFDocument.create();

    const mapA = new Map<number, number>();
    for (let i = 0; i < a.getPageCount(); i++) {
      const [page] = await out.copyPages(a, [i]);
      out.addPage(page);
      mapA.set(i, i);
    }
    const sumA = carryAcroFormInto(a, out, mapA);
    const mapB = new Map<number, number>();
    for (let i = 0; i < b.getPageCount(); i++) {
      const [page] = await out.copyPages(b, [i]);
      out.addPage(page);
      mapB.set(i, a.getPageCount() + i);
    }
    const sumB = carryAcroFormInto(b, out, mapB);

    expect(sumA.collisions).toEqual([]);
    expect(sumB.collisions).toEqual(['dup']);
    expect(sumA.fieldCount).toBe(2);
    expect(sumA.sourceFieldCount).toBe(2);
    // the second carry appends, so the merged form now holds all three
    expect(sumB.fieldCount).toBe(3);
    expect(sumB.sourceFieldCount).toBe(1);
    expect(out.getForm().getFields().length).toBe(3);
    // widget count is the two sources' sum
    expect(formWidgetDicts(out).length).toBe(
      formWidgetDicts(a).length + formWidgetDicts(b).length,
    );
    // the renamed field keeps its own real box (measured from the source b)
    const renamed = out.getForm().getFields().find((f) => f.getName() === 'dup-merged-1');
    expect(renamed).toBeDefined();
    const bRect = rectOf(b, b.getForm().getField('dup').acroField.getWidgets()[0].dict);
    expect(rectOf(out, renamed!.acroField.getWidgets()[0].dict)).toEqual(bRect);
    expect(bRect).not.toEqual([0, 0, 200, 50]);
  });

  it('ADV-124: an orphan keeps its orphan- id, is read-only and is never filled', async () => {
    const path = await writePdf('orphan.pdf', await buildOrphanFixture());
    const engine = new EngineService();
    expect((await engine.loadDocument('doc', path)).ok).toBe(true);

    // Delete page 1: the orphan on original page 2 is now visible page 1.
    expect((await engine.applyOp('doc', { kind: 'delete', page: 0 })).ok).toBe(true);
    const listed = await engine.getFormFields('doc');
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error.message);
    const orphan = listed.value.find((f) => f.name === 'ghost');
    expect(orphan).toBeDefined();
    // The orphan identity survives the page remap: prefix kept, not form-N-.
    expect(orphan!.id.startsWith('orphan-')).toBe(true);
    expect(orphan!.id.startsWith('form-')).toBe(false);
    expect(orphan!.readOnly).toBe(true);

    const before = await engine.getState('doc');
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.error.message);

    const fill = await engine.fillFormField('doc', { id: orphan!.id, value: 'typed' });
    expect(fill.ok).toBe(true);
    if (!fill.ok) throw new Error(fill.error.message);
    expect(fill.value.formFillReport?.find((r) => r.name === 'ghost')?.status).toBe('orphan-unfilled');
    // Nothing was written: the document's modified flag did not change.
    expect(fill.value.modified).toBe(before.value.modified);

    // The orphan widget's own value is untouched on disk. After deleting
    // page 1 only the orphan's page survives (now visible page 1, index 0).
    const round = await loadSavedPdf(engine, 'doc');
    const pageAnnots = round.getPage(0).node.get(PDFName.of('Annots')) as PDFArray;
    let orphanValue: string | undefined;
    for (let i = 0; i < pageAnnots.size(); i++) {
      const dict = round.context.lookupMaybe(pageAnnots.get(i), PDFDict);
      if (dict !== undefined && decodeString(dict.get(PDFName.of('T'))) === 'ghost') {
        orphanValue = decodeString(dict.get(PDFName.of('V')));
      }
    }
    expect(orphanValue).toBe('ghost value');
  });

  it('ADV-125: an XFA-only document loads with preserveXFA and reports the xfa status', async () => {
    const bytes = await buildXfaOnlyFixture();
    const direct = await PDFDocument.load(bytes, { preserveXFA: true });
    expect(direct.getForm().hasXFA()).toBe(true);
    const font = await embedEditFont(direct, 'DejaVu Serif', false, false);
    const reports = fillFormNatively(direct, font, new Map([['anything', 'x']]));
    expect(reports.length).toBe(1);
    expect(reports[0].status).toBe('xfa');
    expect(reports[0].page).toBeNull();

    // The engine's own load path keeps /XFA, so a fill surfaces the row.
    const engine = new EngineService();
    expect((await engine.loadDocument('doc', await writePdf('xfa.pdf', bytes))).ok).toBe(true);
    const fields = await engine.getFormFields('doc');
    expect(fields.ok).toBe(true);
    if (!fields.ok) throw new Error(fields.error.message);
    expect(fields.value.length).toBe(0);
    const fill = await engine.fillFormField('doc', { id: 'form-0-whatever', value: 'x' });
    expect(fill.ok).toBe(true);
    if (!fill.ok) throw new Error(fill.error.message);
    expect(fill.value.formFillReport?.[0]?.status).toBe('xfa');
  });

  it('ADV-126: an unrecognized group option is not reported filled', async () => {
    const doc = await PDFDocument.load(await buildGroupFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);
    const reports = fillFormNatively(doc, font, new Map([['group', 'express']]));
    const row = reports.find((r) => r.name === 'group');
    expect(row?.status).not.toBe('filled');
    expect(row?.status).toBe('option-unknown');
    // /V is unchanged - nothing was written.
    const group = doc.getForm().getField('group');
    expect(group.acroField.dict.get(PDFName.of('V'))?.toString()).toBe('/Off');

    // A real option still fills.
    const ok = fillFormNatively(doc, font, new Map([['group', 'Maybe']]));
    expect(ok.find((r) => r.name === 'group')?.status).toBe('filled');
    expect(doc.getForm().getField('group').acroField.dict.get(PDFName.of('V'))?.toString())
      .toBe('/Maybe');
  });

  it('ADV-127: the fill report page is remapped after a delete and a reorder', async () => {
    const engine = new EngineService();
    expect((await engine.loadDocument('doc', await writePdf('paginated.pdf', await buildPaginatedFixture()))).ok)
      .toBe(true);

    // Delete page 1: original pages 2 and 3 become visible 1 and 2.
    expect((await engine.applyOp('doc', { kind: 'delete', page: 0 })).ok).toBe(true);
    const listed = await engine.getFormFields('doc');
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.find((f) => f.name === 'page3_field')?.page).toBe(2);

    const fill = await engine.fillFormField('doc', {
      id: listed.value.find((f) => f.name === 'page3_field')!.id,
      value: 'filled',
    });
    expect(fill.ok).toBe(true);
    if (!fill.ok) throw new Error(fill.error.message);
    const report = fill.value.formFillReport;
    expect(report?.find((r) => r.name === 'page3_field')?.page).toBe(2);
    expect(report?.find((r) => r.name === 'page2_field')?.page).toBe(1);

    // Reorder visible [orig2, orig1]: page2_field moves to visible page 2.
    expect((await engine.applyOp('doc', { kind: 'reorder', page: 1, param: 0 })).ok).toBe(true);
    const reordered = await engine.getFormFields('doc');
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) throw new Error(reordered.error.message);
    const fill2 = await engine.fillFormField('doc', {
      id: reordered.value.find((f) => f.name === 'page2_field')!.id,
      value: 'again',
    });
    expect(fill2.ok).toBe(true);
    if (!fill2.ok) throw new Error(fill2.error.message);
    expect(fill2.value.formFillReport?.find((r) => r.name === 'page2_field')?.page).toBe(2);
  });

  it('DEF-423: a /Sig field lists as kind "signature" while a neighbouring text field is unchanged', async () => {
    const engine = new EngineService();
    expect((await engine.loadDocument('doc', await writePdf('signed.pdf', await buildSignatureFieldFixture()))).ok)
      .toBe(true);

    const listed = await engine.getFormFields('doc');
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error.message);
    const byName = new Map(listed.value.map((f) => [f.name, f]));
    const sig = byName.get('approval');
    // The field is still LISTED (the user sees it and its reason) ...
    expect(sig).toBeDefined();
    // ... but classified as a non-fillable signature kind, not text. The
    // renderer treats kinds outside its allow-list as non-fillable, so the
    // kind is deliberately outside the shared FormFieldKind union (the
    // renderer's own tests cast it the same way).
    expect(sig!.kind as string).toBe('signature');
    expect((sig as { fillable?: boolean }).fillable).toBe(false);
    // The neighbouring text field keeps its classification.
    expect(byName.get('body')?.kind).toBe('text');
    expect(byName.get('body')?.value).toBe('hello');

    // The fill report still labels the signature field skipped-signature.
    const fill = await engine.fillFormField('doc', { id: sig!.id, value: 'typed' });
    expect(fill.ok).toBe(true);
    if (!fill.ok) throw new Error(fill.error.message);
    const sigRow = fill.value.formFillReport?.find((r) => r.name === 'approval');
    expect(sigRow?.status).toBe('skipped-signature');
    expect(sigRow?.kind).toBe('signature');

    // The classification survives a save round-trip; the signature field was
    // not rewritten as a text field.
    const round = await loadSavedPdf(engine, 'doc');
    const roundSig = getFormFields(round).find((f) => f.name === 'approval');
    expect(roundSig?.kind as string).toBe('signature');
    expect((roundSig as { fillable?: boolean }).fillable).toBe(false);
  });
});
