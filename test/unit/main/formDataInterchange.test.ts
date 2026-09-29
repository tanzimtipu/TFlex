import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import type { FormDataImportReport } from '../../../src/shared/types';

/**
 * Phase 57 feature B — FDF/XFDF form-DATA export/import on an already-open
 * document. The PDF form is built in-test with pdf-lib (no committed binary),
 * the real EngineService reads/writes the fields, and the saved file is
 * re-parsed with a fresh PDFDocument.load to prove the values landed.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-formdata-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildFormPdf(file: string, names: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  names.forEach((name, index) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 60, y: 700 - index * 40, width: 220, height: 22 });
  });
  const path = join(dir, file);
  await writeFile(path, await doc.save());
  return path;
}

async function fillNamed(
  engine: EngineService,
  docId: string,
  values: Record<string, string>,
): Promise<void> {
  const listed = await engine.getFormFields(docId);
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  for (const field of listed.value) {
    const value = values[field.name];
    if (value === undefined) continue;
    const result = await engine.fillFormField(docId, { id: field.id, value });
    expect(result.ok).toBe(true);
  }
}

async function readValues(engine: EngineService, docId: string): Promise<Map<string, string>> {
  const listed = await engine.getFormFields(docId);
  expect(listed.ok).toBe(true);
  if (!listed.ok) return new Map();
  return new Map(
    listed.value.map((field) => [
      field.name,
      Array.isArray(field.value) ? field.value.join(',') : field.value,
    ]),
  );
}

async function importBytes(
  engine: EngineService,
  docId: string,
  format: 'fdf' | 'xfdf',
  bytes: ArrayBuffer,
): Promise<FormDataImportReport> {
  const result = await engine.importFormData(docId, format, new Uint8Array(bytes));
  expect(result.ok).toBe(true);
  if (!result.ok) return { matched: [], unmatched: [], empty: [] };
  return result.value;
}

async function savedTextValues(path: string, names: string[]): Promise<(string | undefined)[]> {
  const bytes = await readFile(path);
  const reparsed = await PDFDocument.load(bytes);
  const form = reparsed.getForm();
  return names.map((name) => form.getTextField(name).getText());
}

async function isModified(engine: EngineService, docId: string): Promise<boolean> {
  const result = await engine.isModified(docId);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : true;
}

function xfdf(fields: { name: string; value: string }[]): ArrayBuffer {
  const body = fields
    .map((f) => `<field name="${f.name}"><value>${f.value}</value></field>`)
    .join('');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<xfdf xmlns="http://ns.adobe.com/xfdf/">' +
    `<fields>${body}</fields>` +
    '</xfdf>';
  return new TextEncoder().encode(xml).buffer;
}

describe('phase57 form data interchange', () => {
  const names = ['full_name', 'Email', 'notes'];

  async function roundTrip(format: 'fdf' | 'xfdf'): Promise<void> {
    const filled = { full_name: 'Ada Lovelace', Email: 'ada@example.com', notes: 'line one' };
    const aPath = await buildFormPdf(`${format}-a.pdf`, names);
    const bPath = await buildFormPdf(`${format}-b.pdf`, names);

    const engine = new EngineService();
    await engine.loadDocument('doc-a', aPath);
    await fillNamed(engine, 'doc-a', filled);

    const exported = await engine.exportFormData('doc-a', format);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    await engine.loadDocument('doc-b', bPath);
    const report = await importBytes(engine, 'doc-b', format, exported.value);
    expect(report).toEqual({ matched: names, unmatched: [], empty: [] });

    const values = await readValues(engine, 'doc-b');
    expect(values.get('full_name')).toBe('Ada Lovelace');
    expect(values.get('Email')).toBe('ada@example.com');
    expect(values.get('notes')).toBe('line one');

    const saved = await engine.save('doc-b');
    expect(saved.ok).toBe(true);
    expect(await savedTextValues(bPath, names)).toEqual([
      'Ada Lovelace',
      'ada@example.com',
      'line one',
    ]);
  }

  it('XFDF round trip fills a blank copy and survives save', async () => {
    await roundTrip('xfdf');
  });

  it('FDF round trip fills a blank copy and survives save', async () => {
    await roundTrip('fdf');
  });

  it('an unmatched name is reported and never creates a stray field', async () => {
    const path = await buildFormPdf('unmatched.pdf', ['full_name', 'Email']);
    const engine = new EngineService();
    await engine.loadDocument('doc-u', path);

    const report = await importBytes(
      engine,
      'doc-u',
      'xfdf',
      xfdf([
        { name: 'full_name', value: 'Ada' },
        { name: 'ghost_field', value: 'nope' },
      ]),
    );
    expect(report.matched).toEqual(['full_name']);
    expect(report.unmatched).toEqual(['ghost_field']);
    expect(report.empty).toEqual(['Email']);

    const saved = await engine.save('doc-u');
    expect(saved.ok).toBe(true);
    const reparsed = await PDFDocument.load(await readFile(path));
    expect(reparsed.getForm().getFields().map((f) => f.getName())).toEqual(['full_name', 'Email']);
    expect(reparsed.getForm().getTextField('full_name').getText()).toBe('Ada');
  });

  it('reports document fields that received no value as empty', async () => {
    const path = await buildFormPdf('empty.pdf', names);
    const engine = new EngineService();
    await engine.loadDocument('doc-e', path);

    const report = await importBytes(
      engine,
      'doc-e',
      'xfdf',
      xfdf([{ name: 'full_name', value: 'Ada' }]),
    );
    expect(report.matched).toEqual(['full_name']);
    expect(report.unmatched).toEqual([]);
    expect(report.empty).toEqual(['Email', 'notes']);
  });

  it('a zero-entry import changes nothing and pushes no undo', async () => {
    const path = await buildFormPdf('zero.pdf', names);
    const engine = new EngineService();
    await engine.loadDocument('doc-z', path);
    expect(await isModified(engine, 'doc-z')).toBe(false);

    const report = await importBytes(engine, 'doc-z', 'xfdf', xfdf([]));
    expect(report).toEqual({ matched: [], unmatched: [], empty: [] });
    expect(await isModified(engine, 'doc-z')).toBe(false);

    const undo = await engine.undo('doc-z');
    expect(undo.ok).toBe(false);
  });
});


