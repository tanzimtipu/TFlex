import { describe, expect, it } from 'vitest';
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  PDFTextField,
} from '@cantoo/pdf-lib';
import {
  fillFormField,
  getFormFields,
} from '../../../src/main/services/forms';
import { fillFormNatively } from '../../../src/main/services/form-fill';
import { embedEditFont } from '../../../src/main/services/fonts';

// ---------------------------------------------------------------------------
// Phase 59 item 4 (part 2 of 3) — native fill + listing.
//
// Synthetic in-test fixture (pdf-lib, no committed binaries):
//   - text_field : a text field;
//   - single_cb  : a genuine single-widget check box;
//   - group      : a THREE-widget button field whose widgets carry the
//                  distinct on-states /No, /Yes, /Maybe (the operator's
//                  956.pdf shape: multi-widget button groups with no Radio
//                  bit, which pdf-lib models as a PDFCheckBox);
//   - ro_field   : a ReadOnly text field;
//   - sig_field  : a field whose /FT is /Sig (pdf-lib has no createSignature).
// ---------------------------------------------------------------------------

const GROUP_ON_STATES = ['No', 'Yes', 'Maybe'];

/** Rename each widget's /AP /N on-state key and set /AS, so the single
 *  PDFCheckBox group carries three distinct options. */
function renameGroupOnStates(group: PDFCheckBox, names: string[]): void {
  const widgets = group.acroField.getWidgets();
  for (let i = 0; i < widgets.length; i++) {
    const widget = widgets[i];
    const ap = widget.dict.get(PDFName.of('AP')) as PDFDict;
    const normal = ap.get(PDFName.of('N')) as PDFDict;
    const onKey = widget.getOnValue() ?? PDFName.of('Yes');
    const stream = normal.get(onKey);
    normal.delete(onKey);
    normal.set(PDFName.of(names[i]), stream as never);
    widget.setAppearanceState(PDFName.of(names[i]));
  }
}

async function buildFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();

  const text = form.createTextField('text_field');
  text.setText('');
  text.addToPage(page, { x: 72, y: 700, width: 200, height: 20 });

  const single = form.createCheckBox('single_cb');
  single.addToPage(page, { x: 72, y: 660, width: 16, height: 16 });

  const group = form.createCheckBox('group');
  group.addToPage(page, { x: 72, y: 600, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 570, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 540, width: 16, height: 16 });
  renameGroupOnStates(group, GROUP_ON_STATES);

  const ro = form.createTextField('ro_field');
  ro.addToPage(page, { x: 72, y: 500, width: 200, height: 20 });
  ro.enableReadOnly();

  const sig = form.createTextField('sig_field');
  sig.addToPage(page, { x: 72, y: 470, width: 200, height: 20 });
  (sig.acroField as unknown as { dict: PDFDict }).dict.set(PDFName.of('FT'), PDFName.of('Sig'));

  return doc.save({ updateFieldAppearances: false });
}

function statusOf(
  reports: ReturnType<typeof fillFormNatively>,
  name: string,
): { status: string; detail?: string } | undefined {
  return reports.find((r) => r.name === name);
}

/** Read a text widget's normal appearance /BaseFont (via /Resources /Font). */
/** The font resource NAMES used by a text widget's normal appearance stream
 *  (its /AP /N /Resources /Font dictionary keys). After a native fill that
 *  regenerates the appearance with the embedded Unicode font, one of these
 *  names contains 'DejaVu'. */
function appearanceFontKeys(doc: PDFDocument, field: PDFTextField): string[] {
  const widget = field.acroField.getWidgets()[0];
  const raw = widget.getNormalAppearance();
  const looked = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  const stream = looked as PDFStream;
  const res = doc.context.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict);
  const fonts = res === undefined
    ? undefined
    : doc.context.lookupMaybe(res.get(PDFName.of('Font')), PDFDict);
  if (fonts === undefined) return [];
  return fonts.keys().map((k) => k.toString());
}

describe('Phase 59 item 4 - native form fill', () => {
  it('fills a group option other than the first, at the dict level', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    const groupField = doc.getForm().getField('group') as PDFCheckBox;
    fillFormNatively(doc, font, new Map<string, string | string[]>([['group', 'Maybe']]));

    expect(groupField.acroField.dict.get(PDFName.of('V'))?.toString()).toBe('/Maybe');
    const asStates = groupField.acroField.getWidgets().map((w) => w.getAppearanceState()?.toString());
    expect(asStates).toEqual(['/Off', '/Off', '/Maybe']);

    // A genuine non-first option survives a real save round-trip.
    const saved = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    const relisted = getFormFields(saved);
    expect(relisted.find((f) => f.name === 'group')?.value).toBe('Maybe');
  });

  it('selects a non-first group option through fillFormField too', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const listed = getFormFields(doc);
    const group = listed.find((f) => f.name === 'group');
    expect(group).toBeDefined();

    fillFormField(doc, group!.id, 'Maybe');
    const out = getFormFields(doc).find((f) => f.name === 'group');
    expect(out?.value).toBe('Maybe');
    const asStates = (doc.getForm().getField('group') as PDFCheckBox).acroField
      .getWidgets()
      .map((w) => w.getAppearanceState()?.toString());
    expect(asStates).toEqual(['/Off', '/Off', '/Maybe']);
  });

  it('regenerates a text appearance that references the embedded font', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    fillFormNatively(doc, font, new Map<string, string | string[]>([['text_field', 'Hello']]));

    const textField = doc.getForm().getField('text_field') as PDFTextField;
    expect(textField.getText()).toBe('Hello');
    const fontKeys = appearanceFontKeys(doc, textField);
    expect(fontKeys.length).toBeGreaterThan(0);
    expect(fontKeys.some((k) => k.includes('DejaVu'))).toBe(true);
    // The embedded font is actually written into the document too.
    const savedText = Buffer.from(await doc.save({ updateFieldAppearances: false })).toString('latin1');
    expect(savedText).toContain('DejaVu');
  });

  it('reports read-only and signature fields with the right status', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    const reports = fillFormNatively(doc, font);
    expect(statusOf(reports, 'ro_field')?.status).toBe('skipped-readonly');
    expect(statusOf(reports, 'sig_field')?.status).toBe('skipped-signature');
    expect(statusOf(reports, 'text_field')?.status).toBe('filled');
  });

  it('round-trips a non-Latin text value through /V (or reports font-unavailable)', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    const cyrillic = '\u041f\u0440\u0438\u0432\u0435\u0442';
    const reports = fillFormNatively(
      doc,
      font,
      new Map<string, string | string[]>([['text_field', cyrillic]]),
    );
    const row = statusOf(reports, 'text_field');
    const value = (doc.getForm().getField('text_field') as PDFTextField).getText();
    if (row?.status === 'font-unavailable') {
      expect(value).not.toBe(cyrillic);
    } else {
      expect(row?.status).toBe('filled');
      const saved = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
      expect((saved.getForm().getField('text_field') as PDFTextField).getText()).toBe(cyrillic);
    }

    // A glyph DejaVu lacks is reported font-unavailable and NOT written.
    const cjk = '\u4f60\u597d';
    const doc2 = await PDFDocument.load(await buildFixture());
    const font2 = await embedEditFont(doc2, 'DejaVu Serif', false, false);
    const reports2 = fillFormNatively(
      doc2,
      font2,
      new Map<string, string | string[]>([['text_field', cjk]]),
    );
    const row2 = statusOf(reports2, 'text_field');
    if (row2?.status === 'font-unavailable') {
      expect((doc2.getForm().getField('text_field') as PDFTextField).getText()).not.toBe(cjk);
    }
  });

  it('lists one editor per widget with the right rect and selection', async () => {
    const doc = await PDFDocument.load(await buildFixture());

    const before = getFormFields(doc).find((f) => f.name === 'group');
    expect(before?.kind).toBe('radio');
    expect(before?.widgets?.length).toBe(3);
    expect(before?.widgets?.map((w) => w.value)).toEqual(GROUP_ON_STATES);
    expect(before?.widgets?.map((w) => w.selected)).toEqual([false, false, false]);
    for (const widget of before!.widgets!) {
      expect(widget.rect.width).toBeGreaterThan(0);
      expect(widget.rect.height).toBeGreaterThan(0);
    }
    // Rects are in descending page order (600 > 570 > 540 in top-left space).
    expect(before!.widgets![0].rect.y).toBeLessThan(before!.widgets![1].rect.y);
    expect(before!.widgets![1].rect.y).toBeLessThan(before!.widgets![2].rect.y);

    // A genuine single check box keeps its boolean value and has no widgets.
    const single = getFormFields(doc).find((f) => f.name === 'single_cb');
    expect(single?.kind).toBe('checkbox');
    expect(single?.value).toBe('false');
    expect(single?.widgets).toBeUndefined();

    // Read-only is surfaced on the listing.
    expect(getFormFields(doc).find((f) => f.name === 'ro_field')?.readOnly).toBe(true);

    // After selecting the third option only that widget is flagged.
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);
    fillFormNatively(doc, font, new Map<string, string | string[]>([['group', 'Maybe']]));
    const after = getFormFields(doc).find((f) => f.name === 'group');
    expect(after?.widgets?.map((w) => w.selected)).toEqual([false, false, true]);
  });
});
