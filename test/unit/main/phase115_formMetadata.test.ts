import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { getFormFields } from '../../../src/main/services/forms';

// Phase 115 - getFormFields must expose the field's real Required flag
// (/Ff bit 2) and its /TU tooltip, additively, and omit both when absent.

const TOOLTIP = 'Enter your full name';

async function buildDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();

  const marked = form.createTextField('marked');
  marked.addToPage(page, { x: 40, y: 60, width: 120, height: 24 });
  marked.enableRequired();
  marked.acroField.dict.set(PDFName.of('TU'), PDFString.of(TOOLTIP));

  const plain = form.createTextField('plain');
  plain.addToPage(page, { x: 40, y: 120, width: 120, height: 24 });

  return doc;
}

describe('getFormFields - required + tooltip (phase 115)', () => {
  it('reads /Ff bit 2 and /TU, and omits both for a plain field', async () => {
    const doc = await buildDoc();
    const fields = getFormFields(doc);

    const marked = fields.find((f) => f.name === 'marked');
    const plain = fields.find((f) => f.name === 'plain');

    expect(marked).toBeDefined();
    expect(marked?.required).toBe(true);
    expect(marked?.tooltip).toBe(TOOLTIP);

    expect(plain).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(plain, 'required')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(plain, 'tooltip')).toBe(false);
  });

  it('survives a save/reload round-trip', async () => {
    const doc = await buildDoc();
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const fields = getFormFields(reloaded);

    const marked = fields.find((f) => f.name === 'marked');
    const plain = fields.find((f) => f.name === 'plain');

    expect(marked?.required).toBe(true);
    expect(marked?.tooltip).toBe(TOOLTIP);
    expect(Object.prototype.hasOwnProperty.call(plain, 'required')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(plain, 'tooltip')).toBe(false);
  });
});
