import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getFormFields } from '../../../src/main/services/forms';

// DEF-445 — push buttons (/FT /Btn with the Pushbutton bit; pdf-lib
// PDFButton) must surface as a non-breaking optional `pushButton` flag while
// keeping their existing 'text' classification.

describe('getFormFields — push button flag (DEF-445)', () => {
  it('reports pushButton: true for a PDFButton and keeps kind text', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const button = doc.getForm().createButton('btn');
    button.addToPage('Go', page, { x: 40, y: 60, width: 90, height: 24 });

    const fields = getFormFields(doc);

    expect(fields).toHaveLength(1);
    expect(fields[0].pushButton).toBe(true);
    expect(fields[0].kind).toBe('text');
  });

  it('omits pushButton for a text field', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const text = doc.getForm().createTextField('t');
    text.addToPage(page, { x: 40, y: 60, width: 90, height: 24 });

    const fields = getFormFields(doc);

    expect(fields).toHaveLength(1);
    expect(fields[0].pushButton).toBeUndefined();
  });
});
