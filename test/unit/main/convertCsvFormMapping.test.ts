import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { DocumentConversionService } from '../../../src/main/services/convert';

/**
 * Phase 53 feature G mode 2 - CSV-to-form mapping on an ALREADY-OPEN document.
 * The PDF and its fields are built in-test with pdf-lib (no committed binary),
 * the real EngineService reads/writes the fields, and the saved file is
 * re-parsed with a fresh PDFDocument.load to prove the values landed.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-csvmap-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildFormPdf(names: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  names.forEach((name, index) => {
    const field = form.createTextField(name);
    field.addToPage(page, {
      x: 60,
      y: 700 - index * 40,
      width: 220,
      height: 22,
    });
  });
  const path = join(dir, 'form.pdf');
  await writeFile(path, await doc.save());
  return path;
}

async function writeCsv(content: string): Promise<string> {
  const path = join(dir, 'data.csv');
  await writeFile(path, content, 'utf8');
  return path;
}

async function loadFields(engine: EngineService, docId: string): Promise<Map<string, unknown>> {
  const result = await engine.getFormFields(docId);
  expect(result.ok).toBe(true);
  if (!result.ok) return new Map();
  return new Map(result.value.map((field) => [field.name, field.value]));
}

describe('phase53 csv to document fields', () => {
  it('matches exact and case-insensitive names, and reports the rest', async () => {
    const formPath = await buildFormPdf(['applicant_name', 'Email', 'extra_field']);
    const csvPath = await writeCsv(
      'applicant_name,email,unknown_header\nAda,ada@example.com,zzz\n',
    );

    const engine = new EngineService();
    await engine.loadDocument('doc-map', formPath);
    const service = new DocumentConversionService({ engine });

    const result = await service.csvToDocumentFields('doc-map', csvPath, {
      csvFormMapping: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.matched).toEqual(['applicant_name', 'Email']);
    expect(result.value.unmatchedHeaders).toEqual(['unknown_header']);
    expect(result.value.missingFields).toEqual(['extra_field']);
    expect(result.value.filled).toBe(2);

    // Re-parse the SAVED file with a parser (not our UI) to verify the values.
    const saved = await engine.save('doc-map');
    expect(saved.ok).toBe(true);
    const bytes = await readFile(formPath);
    const reparsed = await PDFDocument.load(bytes);
    const form = reparsed.getForm();
    expect(form.getTextField('applicant_name').getText()).toBe('Ada');
    expect(form.getTextField('Email').getText()).toBe('ada@example.com');
    // pdf-lib reports an untouched text field as undefined, not ''.
    expect(form.getTextField('extra_field').getText()).toBeUndefined();
  });

  it('an unmatched header never creates a stray field', async () => {
    const formPath = await buildFormPdf(['applicant_name', 'Email', 'extra_field']);
    const csvPath = await writeCsv(
      'applicant_name,email,unknown_header\nAda,ada@example.com,zzz\n',
    );

    const engine = new EngineService();
    await engine.loadDocument('doc-stray', formPath);
    const service = new DocumentConversionService({ engine });
    await service.csvToDocumentFields('doc-stray', csvPath);

    const saved = await engine.save('doc-stray');
    expect(saved.ok).toBe(true);
    const bytes = await readFile(formPath);
    const reparsed = await PDFDocument.load(bytes);
    expect(reparsed.getForm().getFields()).toHaveLength(3);
  });

  it('is a deliberate no-op when csvFormMapping is off', async () => {
    const formPath = await buildFormPdf(['applicant_name']);
    const csvPath = await writeCsv('applicant_name\nAda\n');

    const engine = new EngineService();
    await engine.loadDocument('doc-off', formPath);
    const service = new DocumentConversionService({ engine });
    const result = await service.csvToDocumentFields('doc-off', csvPath, {
      csvFormMapping: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filled).toBe(0);
      expect(result.value.matched).toEqual([]);
    }
    const fields = await loadFields(engine, 'doc-off');
    expect(fields.get('applicant_name')).toBe('');
  });

  it('reports all headers unmatched when the document has no fields', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const formPath = join(dir, 'plain.pdf');
    await writeFile(formPath, await doc.save());
    const csvPath = await writeCsv('name,email\nA,b\n');

    const engine = new EngineService();
    await engine.loadDocument('doc-plain', formPath);
    const service = new DocumentConversionService({ engine });
    const result = await service.csvToDocumentFields('doc-plain', csvPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.matched).toEqual([]);
      expect(result.value.unmatchedHeaders).toEqual(['name', 'email']);
      expect(result.value.missingFields).toEqual([]);
      expect(result.value.filled).toBe(0);
    }
  });
});
