import { describe, expect, it } from 'vitest';
import {
  PDFCheckBox,
  PDFDocument,
  PDFName,
  PDFNumber,
} from '@cantoo/pdf-lib';
import { getFormFields, setButtonGroupValue, widgetOnValue } from '../../../src/main/services/forms';
import { fillFormNatively } from '../../../src/main/services/form-fill';
import { embedEditFont } from '../../../src/main/services/fonts';

// ---------------------------------------------------------------------------
// Phase 74 DEF-471 — the save-time pass (`fillFormNatively` with no `values`)
// must NOT report an untouched, empty multi-widget option group as
// `option-unknown` / `option not found: Off`. The group has no value to set,
// so the truthful outcome is a no-op `filled`.
//
// Fixture mirrors `test-fixtures/phase65/make-fixture.cjs:137-151`: a
// `createRadioGroup` whose Radio flag is cleared, so pdf-lib models it as a
// multi-widget `PDFCheckBox`.
// ---------------------------------------------------------------------------

function addGroup(
  form: ReturnType<PDFDocument['getForm']>,
  page: ReturnType<PDFDocument['addPage']>,
  name: string,
  options: string[],
): PDFCheckBox {
  const group = form.createRadioGroup(name);
  for (const option of options) {
    group.addOptionToPage(option, page, { x: 72, y: 700, width: 16, height: 16 });
  }
  group.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(0));
  return group as unknown as PDFCheckBox;
}

async function buildFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  addGroup(form, page, 'groupEmpty', ['A0', 'A1']);
  addGroup(form, page, 'groupSelected', ['B0', 'B1']);
  return doc.save({ updateFieldAppearances: false });
}

function report(reports: ReturnType<typeof fillFormNatively>, name: string) {
  return reports.filter((r) => r.name === name);
}

describe('Phase 74 DEF-471 - untouched empty option groups report filled', () => {
  it('reports every empty multi-widget group as filled (no option-unknown)', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    const reports = fillFormNatively(doc, font);

    for (const name of ['groupEmpty', 'groupSelected']) {
      const rows = report(reports, name);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('filled');
    }
    expect(reports.some((r) => r.status === 'option-unknown')).toBe(false);
    expect(reports.some((r) => (r.detail ?? '').includes('option not found: Off'))).toBe(false);
  });

  it('re-applies a selected on-state and round-trips /V and /AS', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);
    const field = doc.getForm().getField('groupSelected') as PDFCheckBox;
    const onValues = field.acroField.getWidgets().map((w) => widgetOnValue(w));
    const target = onValues[1];
    expect(target).not.toBe('');
    expect(setButtonGroupValue(field, target)).toBe(true);

    const reports = fillFormNatively(doc, font);
    const rows = report(reports, 'groupSelected');
    expect(rows[0].status).toBe('filled');
    expect(field.acroField.dict.get(PDFName.of('V'))?.toString()).toBe(`/${target}`);
    expect(field.acroField.getWidgets().map((w) => w.getAppearanceState()?.toString()))
      .toEqual(['/Off', `/${target}`]);

    const saved = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    const relisted = getFormFields(saved);
    expect(relisted.find((f) => f.name === 'groupSelected')?.value).toBe(target);
  });

  it('still reports option-unknown for a supplied value matching no on-state', async () => {
    const doc = await PDFDocument.load(await buildFixture());
    const font = await embedEditFont(doc, 'DejaVu Serif', false, false);

    const reports = fillFormNatively(doc, font, new Map<string, string | string[]>([['groupEmpty', 'Nope']]));
    const rows = report(reports, 'groupEmpty');
    expect(rows[0].status).toBe('option-unknown');
    expect(rows[0].detail).toBe('option not found: Nope');
  });
});
