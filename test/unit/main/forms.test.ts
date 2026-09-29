import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-forms-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function copyFixtureToTemp(name: string): Promise<string> {
  const { copyFile } = await import('node:fs/promises');
  const fixturePath = join(process.cwd(), 'test-fixtures', name);
  const destPath = join(dir, name);
  await copyFile(fixturePath, destPath);
  return destPath;
}

/** Decode page-0 /Contents from serialized bytes to latin1 text (inflating
 *  per-stream when Flate-encoded). Mirrors the helper used by def165 so a
 *  content-stream baseline can be compared before flatten and after undo. */
async function decodedPage0ContentFromBytes(bytes: ArrayBuffer): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return '';
  const walk = (node: unknown): string => {
    const obj = doc.context.lookup(node as never);
    if (obj instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < obj.size(); i++) out += walk(obj.get(i));
      return out;
    }
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents as unknown as Uint8Array;
      if (!raw || typeof raw.length !== 'number') return '';
      try {
        return new TextDecoder('latin1').decode(inflateSync(raw));
      } catch {
        return new TextDecoder('latin1').decode(raw);
      }
    }
    return '';
  };
  return walk(contents);
}

// ---------------------------------------------------------------------------
// getFormFields - reading form fields from form.pdf
// ---------------------------------------------------------------------------

describe('EngineService - getFormFields', () => {
  it('reads 8 fields from form.pdf', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(8);
    }
  });

  it('returns all field kinds present in form.pdf', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const kinds = result.value.map((f) => f.kind);
      expect(kinds).toContain('text');
      expect(kinds).toContain('checkbox');
      expect(kinds).toContain('radio');
      expect(kinds).toContain('dropdown');
      expect(kinds).toContain('listbox');
    }
  });

  it('reads field names correctly', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.map((f) => f.name).sort();
      expect(names).toEqual([
        'applicant_address',
        'applicant_name',
        'application_date',
        'department',
        'experience_level',
        'newsletter_optin',
        'skills',
        'terms_agreed',
      ]);
    }
  });

  it('reads initial values correctly', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byName = new Map(result.value.map((f) => [f.name, f]));
      expect(byName.get('applicant_name')?.value).toBe('John Doe');
      expect(byName.get('application_date')?.value).toBe('');
      expect(byName.get('terms_agreed')?.value).toBe('true');
      expect(byName.get('newsletter_optin')?.value).toBe('false');
      expect(byName.get('experience_level')?.value).toBe('Mid');
      expect(byName.get('department')?.value).toBe('Engineering');
      expect(Array.isArray(byName.get('skills')?.value)).toBe(true);
    }
  });

  it('reads options for radio/dropdown/list fields', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const byName = new Map(result.value.map((f) => [f.name, f]));
      const expLevel = byName.get('experience_level');
      expect(expLevel?.options?.map((o) => o.value).sort()).toEqual(['Junior', 'Mid', 'Senior']);

      const dept = byName.get('department');
      expect(dept?.options?.map((o) => o.value).sort()).toEqual(['Engineering', 'Marketing', 'Sales', 'Support']);

      const skills = byName.get('skills');
      expect(skills?.options?.map((o) => o.value).sort()).toEqual(['JavaScript', 'Node.js', 'PDF Spec', 'React', 'TypeScript']);
    }
  });

  it('returns 1-based page numbers', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const field of result.value) {
        expect(field.page).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('returns non-zero rects for each field type (DEF-021)', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const result = await engine.getFormFields('doc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Group by kind
      const byKind = new Map<string, typeof result.value>();
      for (const f of result.value) {
        const list = byKind.get(f.kind) ?? [];
        list.push(f);
        byKind.set(f.kind, list);
      }

      const expectedKinds = ['text', 'checkbox', 'radio', 'dropdown', 'listbox'];
      for (const kind of expectedKinds) {
        const fields = byKind.get(kind);
        expect(fields).toBeDefined();
        expect(fields!.length).toBeGreaterThan(0);

        // At least one field of this kind must have a non-zero rect
        const nonZero = fields!.filter(
          (f) => f.rect.width > 0 && f.rect.height > 0,
        );
        expect(
          nonZero.length,
          `expected at least one ${kind} field with non-zero rect, got ${fields!.length} field(s) all (0,0,0,0)`,
        ).toBeGreaterThan(0);
      }

      // Additionally, every field should have a non-zero rect
      const allZero = result.value.filter(
        (f) => f.rect.width === 0 && f.rect.height === 0,
      );
      expect(
        allZero.length,
        `expected 0 zero-rect fields, got ${allZero.length}: ${allZero.map((f) => f.name).join(', ')}`,
      ).toBe(0);
    }
  });

  it('returns engine-error for unknown docId', async () => {
    const engine = new EngineService();
    const result = await engine.getFormFields('ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('engine-error');
    }
  });
});

// ---------------------------------------------------------------------------
// fillFormField
// ---------------------------------------------------------------------------

describe('EngineService - fillFormField', () => {
  it('fills a text field and marks modified', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Get fields to find the text field id
    const fieldsResult = await engine.getFormFields('doc-1');
    const textField = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'application_date')
      : undefined;
    expect(textField).toBeDefined();

    const r = await engine.fillFormField('doc-1', { id: textField!.id, value: '2026-08-28' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.modified).toBe(true);
    }

    // Re-read fields to confirm value changed
    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'application_date');
      expect(updated?.value).toBe('2026-08-28');
    }
  });

  it('fills a checkbox (check)', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fieldsResult = await engine.getFormFields('doc-1');
    const cb = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'newsletter_optin')
      : undefined;
    expect(cb).toBeDefined();
    expect(cb?.value).toBe('false');

    const r = await engine.fillFormField('doc-1', { id: cb!.id, value: 'true' });
    expect(r.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'newsletter_optin');
      expect(updated?.value).toBe('true');
    }
  });

  it('fills a checkbox (uncheck)', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fieldsResult = await engine.getFormFields('doc-1');
    const cb = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'terms_agreed')
      : undefined;
    expect(cb).toBeDefined();
    expect(cb?.value).toBe('true');

    const r = await engine.fillFormField('doc-1', { id: cb!.id, value: 'false' });
    expect(r.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'terms_agreed');
      expect(updated?.value).toBe('false');
    }
  });

  it('fills a radio group', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fieldsResult = await engine.getFormFields('doc-1');
    const radio = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'experience_level')
      : undefined;
    expect(radio).toBeDefined();
    expect(radio?.value).toBe('Mid');

    const r = await engine.fillFormField('doc-1', { id: radio!.id, value: 'Senior' });
    expect(r.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'experience_level');
      expect(updated?.value).toBe('Senior');
    }
  });

  it('fills a dropdown', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fieldsResult = await engine.getFormFields('doc-1');
    const dropdown = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'department')
      : undefined;
    expect(dropdown).toBeDefined();
    expect(dropdown?.value).toBe('Engineering');

    const r = await engine.fillFormField('doc-1', { id: dropdown!.id, value: 'Marketing' });
    expect(r.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'department');
      expect(updated?.value).toBe('Marketing');
    }
  });

  it('fills an option list (single select)', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fieldsResult = await engine.getFormFields('doc-1');
    const listbox = fieldsResult.ok
      ? fieldsResult.value.find((f) => f.name === 'skills')
      : undefined;
    expect(listbox).toBeDefined();

    const r = await engine.fillFormField('doc-1', { id: listbox!.id, value: 'TypeScript' });
    expect(r.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'skills');
      expect(updated?.value).toEqual(['TypeScript']);
    }
  });
});

// ---------------------------------------------------------------------------
// fillFormField then save and re-parse
// ---------------------------------------------------------------------------

describe('EngineService - fill then save/round-trip', () => {
  it('filled values survive save and re-load', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Fill all kinds
    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;

    const byName = new Map(fields.value.map((f) => [f.name, f]));

    await engine.fillFormField('doc-1', { id: byName.get('applicant_name')!.id, value: 'Jane Smith' });
    await engine.fillFormField('doc-1', { id: byName.get('applicant_address')!.id, value: '123 Main St' });
    await engine.fillFormField('doc-1', { id: byName.get('application_date')!.id, value: '2026-08-28' });
    await engine.fillFormField('doc-1', { id: byName.get('terms_agreed')!.id, value: 'false' });
    await engine.fillFormField('doc-1', { id: byName.get('newsletter_optin')!.id, value: 'true' });
    await engine.fillFormField('doc-1', { id: byName.get('experience_level')!.id, value: 'Junior' });
    await engine.fillFormField('doc-1', { id: byName.get('department')!.id, value: 'Support' });
    await engine.fillFormField('doc-1', { id: byName.get('skills')!.id, value: 'JavaScript' });

    // Save
    const saveResult = await engine.save('doc-1');
    expect(saveResult.ok).toBe(true);

    // Re-load
    await engine.loadDocument('doc-reloaded', path);
    const reloaded = await engine.getFormFields('doc-reloaded');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      const rByName = new Map(reloaded.value.map((f) => [f.name, f]));
      expect(rByName.get('applicant_name')?.value).toBe('Jane Smith');
      expect(rByName.get('applicant_address')?.value).toBe('123 Main St');
      expect(rByName.get('application_date')?.value).toBe('2026-08-28');
      expect(rByName.get('terms_agreed')?.value).toBe('false');
      expect(rByName.get('newsletter_optin')?.value).toBe('true');
      expect(rByName.get('experience_level')?.value).toBe('Junior');
      expect(rByName.get('department')?.value).toBe('Support');
      expect(rByName.get('skills')?.value).toEqual(['JavaScript']);
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-069: the engine's `modified` flag must (a) flip to true after a form
// fill and (b) clear after a successful save / saveAs, observable through
// `getState` (the same channel the renderer's set-modified echo reads from
// after it re-fetches state). The renderer's performSaveAs/onSave handlers
// set engineUi.state.modified=false locally, but they ALSO rely on the
// engine's getState returning modified=false for any subsequent read
// (e.g. a tab switch that re-hydrates engineUi from getState, or a stale
// engineUi ref falling back to getState). This block pins the backend side
// of the contract so the renderer's set-modified echo has a correct source
// to reflect.
// ---------------------------------------------------------------------------

describe('EngineService - modified flag echo (DEF-069)', () => {
  it('fillFormField flips modified to true, observable via getState', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Pre-condition: a freshly loaded doc is unmodified.
    const s0 = await engine.getState('doc-1');
    expect(s0.ok).toBe(true);
    if (s0.ok) expect(s0.value.modified).toBe(false);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;
    const textField = fields.value.find((f) => f.name === 'application_date');
    expect(textField).toBeDefined();

    const r = await engine.fillFormField('doc-1', { id: textField!.id, value: '2026-08-28' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.modified).toBe(true);

    // getState (the channel the renderer re-reads after save) must agree.
    const s1 = await engine.getState('doc-1');
    expect(s1.ok).toBe(true);
    if (s1.ok) expect(s1.value.modified).toBe(true);
  });

  it('save clears modified, observable via getState', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;
    const textField = fields.value.find((f) => f.name === 'application_date');
    await engine.fillFormField('doc-1', { id: textField!.id, value: '2026-08-28' });

    const before = await engine.getState('doc-1');
    expect(before.ok && before.value.modified).toBe(true);

    const saveR = await engine.save('doc-1');
    expect(saveR.ok).toBe(true);

    // After save, getState must report modified=false — the renderer's
    // set-modified echo sources from this on any tab re-hydration.
    const after = await engine.getState('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.modified).toBe(false);
  });

  it('saveAs clears modified and updates doc path, observable via getState (DEF-069)', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;
    const textField = fields.value.find((f) => f.name === 'application_date');
    await engine.fillFormField('doc-1', { id: textField!.id, value: '2026-08-28' });

    const before = await engine.getState('doc-1');
    expect(before.ok && before.value.modified).toBe(true);

    const newPath = join(dir, 'saved-as.pdf');
    const saveR = await engine.saveAs('doc-1', newPath);
    expect(saveR.ok).toBe(true);
    if (saveR.ok) expect(saveR.value).toBe(newPath);

    // The Save-As path must clear modified. The renderer's performSaveAs
    // sets engineUi.state.modified=false locally AND this getState must
    // agree, so a later tab re-activation re-hydrating from getState does
    // not resurrect the dot.
    const after = await engine.getState('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.modified).toBe(false);

    // The undo/redo stacks were cleared by saveAs — a subsequent undo
    // must report nothing-to-undo (not resurrect a pre-save snapshot that
    // would flip modified back to true).
    const undoR = await engine.undo('doc-1');
    expect(undoR.ok).toBe(false);
    if (!undoR.ok) expect(undoR.error.code).toBe('nothing-to-undo');
    const stillClean = await engine.getState('doc-1');
    expect(stillClean.ok && stillClean.value.modified).toBe(false);
  });

  it('a failed saveAs does NOT clear modified (write-error path)', async () => {
    // If the write fails, the doc must remain modified so the user is not
    // silently led to believe their edits are persisted. This is the
    // invariant the renderer's set-modified echo relies on: only a
    // successful save may drive modified to false.
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;
    const textField = fields.value.find((f) => f.name === 'application_date');
    await engine.fillFormField('doc-1', { id: textField!.id, value: '2026-08-28' });

    // Target a path inside a non-existent directory -> ENOENT write failure.
    const badPath = join(dir, 'no-such-dir', 'out.pdf');
    const saveR = await engine.saveAs('doc-1', badPath);
    expect(saveR.ok).toBe(false);
    if (!saveR.ok) expect(saveR.error.code).toBe('write-error');

    const after = await engine.getState('doc-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.modified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flattenForms
// ---------------------------------------------------------------------------

describe('EngineService - flattenForms', () => {
  it('flatten removes AcroForm fields from the PDF', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const r = await engine.flattenForms('doc-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.modified).toBe(true);
    }

    // Save and re-parse to check AcroForm is gone
    await engine.save('doc-1');

    const buf = await readFile(path);
    const reparsed = await PDFDocument.load(buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer);
    // After flatten, the form should have no fields
    const form = reparsed.getForm();
    const fieldCount = form.getFields().length;
    expect(fieldCount).toBe(0);
  });

  it('getFormFields returns empty after flatten', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Flatten
    await engine.flattenForms('doc-1');

    // Re-read fields - should be empty
    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(0);
    }
  });

  it('flatten is idempotent', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const r1 = await engine.flattenForms('doc-1');
    expect(r1.ok).toBe(true);

    // Second flatten should not throw
    const r2 = await engine.flattenForms('doc-1');
    expect(r2.ok).toBe(true);
  });

  it('flatten on a PDF with no forms does not throw', async () => {
    const engine = new EngineService();
    // Create a PDF without forms
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const path = join(dir, 'no-forms.pdf');
    await writeFile(path, Buffer.from(bytes));

    await engine.loadDocument('doc-1', path);
    const r = await engine.flattenForms('doc-1');
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// undo / redo for fillFormField
// ---------------------------------------------------------------------------

describe('EngineService - form fill undo/redo', () => {
  it('undo restores previous field values after a fill', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    const textField = fields.ok
      ? fields.value.find((f) => f.name === 'applicant_name')
      : undefined;
    expect(textField?.value).toBe('John Doe');

    // Fill
    await engine.fillFormField('doc-1', { id: textField!.id, value: 'Changed Name' });

    // Undo
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);

    // Re-read fields
    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'applicant_name');
      expect(updated?.value).toBe('John Doe');
    }
  });

  it('undo then redo re-applies the fill', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    const textField = fields.ok
      ? fields.value.find((f) => f.name === 'applicant_name')
      : undefined;

    await engine.fillFormField('doc-1', { id: textField!.id, value: 'Undone' });
    await engine.undo('doc-1');
    const redo = await engine.redo('doc-1');
    expect(redo.ok).toBe(true);

    const fields2 = await engine.getFormFields('doc-1');
    expect(fields2.ok).toBe(true);
    if (fields2.ok) {
      const updated = fields2.value.find((f) => f.name === 'applicant_name');
      expect(updated?.value).toBe('Undone');
    }
  });

  it('modified flag returns to false after undoing all fills', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    const textField = fields.ok
      ? fields.value.find((f) => f.name === 'applicant_name')
      : undefined;

    await engine.fillFormField('doc-1', { id: textField!.id, value: 'Modified' });
    const s1 = await engine.getState('doc-1');
    expect(s1.ok && s1.value.modified).toBe(true);

    await engine.undo('doc-1');
    const s2 = await engine.getState('doc-1');
    expect(s2.ok && s2.value.modified).toBe(false);
  });

  it('undo of flatten restores form fields (DEF-028)', async () => {
    // DEF-028: flatten+undo must restore form fields. The engine snapshots
    // the full AcroForm structure before flatten and rebuilds it on undo.
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Read initial field values
    const initialFields = await engine.getFormFields('doc-1');
    expect(initialFields.ok).toBe(true);
    expect(initialFields.ok && initialFields.value.length).toBe(8);

    await engine.flattenForms('doc-1');

    // After flatten, fields are gone
    const afterFlatten = await engine.getFormFields('doc-1');
    expect(afterFlatten.ok && afterFlatten.value.length).toBe(0);

    // Undo flatten — should restore form fields
    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);

    // Fields should be restored after undo (DEF-028 fix)
    const afterUndo = await engine.getFormFields('doc-1');
    expect(afterUndo.ok).toBe(true);
    if (afterUndo.ok) {
      expect(afterUndo.value.length).toBe(8);
      // Verify field values were restored
      const byName = new Map(afterUndo.value.map((f) => [f.name, f]));
      expect(byName.get('applicant_name')?.value).toBe('John Doe');
      expect(byName.get('terms_agreed')?.value).toBe('true');
    }
  });

  it('undo of flatten restores every field rect and removes the flattened ink (DEF-403)', async () => {
    // DEF-403: flatten mutates the pdfDoc (bakes widget appearances into page
    // content and drops the AcroForm). The pre-flatten snapshot must carry the
    // serialized bytes so undo reloads the unflattened document — restoring
    // both field geometry and the original page content — and the defensive
    // rebuild path must re-add widgets at their captured rects.
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    // Baseline: field geometry/values and page-0 content before flatten.
    const before = await engine.getFormFields('doc-1');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeFields = before.value;
    expect(beforeFields.length).toBe(8);

    const beforeBytes = await engine.getDocumentBytes('doc-1');
    expect(beforeBytes.ok).toBe(true);
    if (!beforeBytes.ok) return;
    const beforeContent = await decodedPage0ContentFromBytes(beforeBytes.value);

    await engine.flattenForms('doc-1');

    // After flatten the fields are gone and widget ink is baked into content.
    const flat = await engine.getFormFields('doc-1');
    expect(flat.ok && flat.value.length).toBe(0);
    const flatBytes = await engine.getDocumentBytes('doc-1');
    expect(flatBytes.ok).toBe(true);
    if (flatBytes.ok) {
      const flatContent = await decodedPage0ContentFromBytes(flatBytes.value);
      expect(flatContent).not.toBe(beforeContent);
    }

    const undo = await engine.undo('doc-1');
    expect(undo.ok).toBe(true);

    // (a) field count restored, (b) names/values restored, (c) rects match.
    const after = await engine.getFormFields('doc-1');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.length).toBe(beforeFields.length);

    const beforeByName = new Map(beforeFields.map((f) => [f.name, f]));
    for (const f of after.value) {
      const original = beforeByName.get(f.name);
      expect(original).toBeDefined();
      if (!original) continue;
      expect(f.value).toEqual(original.value);
      expect(Math.abs(f.rect.x - original.rect.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(f.rect.y - original.rect.y)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(f.rect.width - original.rect.width)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(f.rect.height - original.rect.height)).toBeLessThanOrEqual(0.01);
    }

    // (d) the flattened ink is gone: page-0 content is back to its baseline.
    const undoBytes = await engine.getDocumentBytes('doc-1');
    expect(undoBytes.ok).toBe(true);
    if (undoBytes.ok) {
      const afterContent = await decodedPage0ContentFromBytes(undoBytes.value);
      expect(afterContent).toBe(beforeContent);
    }
  });
});

// ---------------------------------------------------------------------------
// queue serialisation: form ops with save/undo
// ---------------------------------------------------------------------------

describe('EngineService - form queue serialisation', () => {
  it('fill then immediate save is serialised correctly', async () => {
    const engine = new EngineService();
    const path = await copyFixtureToTemp('form.pdf');
    await engine.loadDocument('doc-1', path);

    const fields = await engine.getFormFields('doc-1');
    const textField = fields.ok
      ? fields.value.find((f) => f.name === 'applicant_name')
      : undefined;
    expect(textField).toBeDefined();

    // Fire fill and save concurrently
    const fillP = engine.fillFormField('doc-1', { id: textField!.id, value: 'Serialised' });
    const saveP = engine.save('doc-1');

    const [fillR, saveR] = await Promise.all([fillP, saveP]);
    expect(fillR.ok).toBe(true);
    expect(saveR.ok).toBe(true);

    // Re-load and check the saved value
    await engine.loadDocument('doc-reloaded', path);
    const reloaded = await engine.getFormFields('doc-reloaded');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      const updated = reloaded.value.find((f) => f.name === 'applicant_name');
      expect(updated?.value).toBe('Serialised');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-029: merge must preserve AcroForm fields from merged documents
// ---------------------------------------------------------------------------

describe('EngineService - merge preserves AcroForm fields (DEF-029)', () => {
  it('merge of form.pdf into a non-form doc preserves the form fields', async () => {
    const engine = new EngineService();

    // Create a simple 2-page PDF without forms
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const nonFormBytes = await doc.save();
    const nonFormPath = join(dir, 'non-form.pdf');
    await writeFile(nonFormPath, Buffer.from(nonFormBytes));

    const formPath = await copyFixtureToTemp('form.pdf');

    // Load non-form doc first, then merge form.pdf after
    await engine.loadDocument('doc-1', nonFormPath);
    const r = await engine.merge('doc-1', [formPath], 'after');
    expect(r.ok).toBe(true);

    // Form fields should be preserved
    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(8);
      // Verify field names match
      const names = fields.value.map((f) => f.name).sort();
      expect(names).toContain('applicant_name');
      expect(names).toContain('terms_agreed');
    }
  });

  it('merge of form.pdf before a non-form doc preserves form fields', async () => {
    const engine = new EngineService();

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const nonFormBytes = await doc.save();
    const nonFormPath = join(dir, 'non-form2.pdf');
    await writeFile(nonFormPath, Buffer.from(nonFormBytes));

    const formPath = await copyFixtureToTemp('form.pdf');

    await engine.loadDocument('doc-1', nonFormPath);
    const r = await engine.merge('doc-1', [formPath], 'before');
    expect(r.ok).toBe(true);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(8);
    }
  });

  it('merge of form.pdf into form.pdf preserves fields from both docs (duplicate names allowed)', async () => {
    // PDF spec requires unique field names within an AcroForm dictionary.
    // When merging the same form.pdf twice, duplicate field names cause
    // pdf-lib to reject the second set. Only the first 8 fields survive.
    const engine = new EngineService();
    const formPath = await copyFixtureToTemp('form.pdf');

    await engine.loadDocument('doc-1', formPath);
    const r = await engine.merge('doc-1', [formPath], 'after');
    expect(r.ok).toBe(true);

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      // 8 fields survive (duplicate names rejected by pdf-lib)
      expect(fields.value.length).toBe(8);
    }
  });

  it('merge preserves form field values', async () => {
    const engine = new EngineService();

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const nonFormBytes = await doc.save();
    const nonFormPath = join(dir, 'non-form3.pdf');
    await writeFile(nonFormPath, Buffer.from(nonFormBytes));

    const formPath = await copyFixtureToTemp('form.pdf');

    await engine.loadDocument('doc-1', nonFormPath);
    await engine.merge('doc-1', [formPath], 'after');

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      const byName = new Map(fields.value.map((f) => [f.name, f]));
      expect(byName.get('applicant_name')?.value).toBe('John Doe');
      expect(byName.get('terms_agreed')?.value).toBe('true');
      expect(byName.get('experience_level')?.value).toBe('Mid');
      expect(byName.get('department')?.value).toBe('Engineering');
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-031: form field page refs must remap after page operations
// ---------------------------------------------------------------------------

/** Helper: create a PDF with form fields on a specific page and ensure
 *  the widget annotations are properly placed in the page /Annots array
 *  so findFieldPage can locate them on reload. */
async function createTwoPageFormWithFieldOnPage2(): Promise<string> {
  const { PDFName } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);

  // Ensure both pages have an /Annots array
  const p1Leaf = (page1 as any).node;
  const p2Leaf = (page2 as any).node;
  p1Leaf.set(PDFName.of('Annots'), doc.context.obj([]));
  p2Leaf.set(PDFName.of('Annots'), doc.context.obj([]));

  const form = doc.getForm();
  const tf = form.createTextField('test_field');
  tf.setText('hello');
  tf.addToPage(page2);

  const bytes = await doc.save();
  const formPath = join(dir, 'two-page-form.pdf');
  await writeFile(formPath, Buffer.from(bytes));
  return formPath;
}

describe('EngineService - form field page refs remap (DEF-031)', () => {
  it('form field page numbers remap when page order changes', async () => {
    const engine = new EngineService();
    const formPath = await createTwoPageFormWithFieldOnPage2();

    await engine.loadDocument('doc-1', formPath);

    // Field is on page 2 of the original PDF (the second page where we
    // added the field via addToPage). findFieldPage now correctly finds it.
    let fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(1);
      const pages = [...new Set(fields.value.map((f) => f.page))];
      expect(pages).toEqual([2]);
    }

    // Delete page 1 (visible index 0): removes the first page (orig 0).
    // The field is on orig page 1, which is now visible page 1.
    await engine.applyOp('doc-1', { kind: 'delete', page: 0 });
    fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(1);
      expect(fields.value[0].page).toBe(1);
    }
  });

  it('form field page numbers remap after reorder', async () => {
    const engine = new EngineService();
    const formPath = await createTwoPageFormWithFieldOnPage2();

    await engine.loadDocument('doc-1', formPath);

    let fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      const pages = [...new Set(fields.value.map((f) => f.page))];
      expect(pages).toEqual([2]);
    }

    // Move page 2 (visible index 1) to position 0: order becomes [1, 0]
    // Field on original page 1 now maps to visible page 1
    await engine.applyOp('doc-1', { kind: 'reorder', page: 1, param: 0 });
    fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      const pages = [...new Set(fields.value.map((f) => f.page))];
      expect(pages).toEqual([1]);
    }
  });

  it('form fields on deleted pages are filtered out', async () => {
    const engine = new EngineService();
    const formPath = await createTwoPageFormWithFieldOnPage2();

    await engine.loadDocument('doc-1', formPath);

    let fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      const pages = [...new Set(fields.value.map((f) => f.page))];
      expect(pages).toEqual([2]);
    }

    // Delete page 2 (visible index 1), the page with the field
    await engine.applyOp('doc-1', { kind: 'delete', page: 1 });
    fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(0);
    }
  });

  it('form field ids are remapped after page operations', async () => {
    const engine = new EngineService();
    const formPath = await createTwoPageFormWithFieldOnPage2();

    await engine.loadDocument('doc-1', formPath);

    let fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    const initialId = fields.ok ? fields.value[0]?.id : '';
    expect(initialId).toContain('form-1-'); // field on page 2 (0-based index 1)

    // Reorder: move page 2 to front, field moves to page 1
    await engine.applyOp('doc-1', { kind: 'reorder', page: 1, param: 0 });
    fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok && fields.value.length > 0) {
      expect(fields.value[0].page).toBe(1);
      expect(fields.value[0].id).toContain('form-0-'); // now on page 1
      expect(fields.value[0].id).not.toBe(initialId);
    }
  });

  it('merge before: form field page refs account for merge offset', async () => {
    // ADV-017 / DEF-031: merge report.pdf (34 pages) 'before' form.pdf (1 page)
    // The form field moves from page 1 to page 35 (the last page).
    const engine = new EngineService();

    // Create a multi-page report (5 pages for test speed)
    const reportDoc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) {
      const pg = reportDoc.addPage([612, 792]);
      pg.drawText(`Report page ${i}`, { x: 72, y: 700, size: 14 });
    }
    const reportBytes = await reportDoc.save();
    const reportPath = join(dir, 'report.pdf');
    await writeFile(reportPath, Buffer.from(reportBytes));

    // Create a form doc with a field on its single page
    const formDoc = await PDFDocument.create();
    const formPage = formDoc.addPage([612, 792]);
    formPage.drawText('Form page', { x: 72, y: 700, size: 14 });
    const form = formDoc.getForm();
    const tf = form.createTextField('form_field');
    tf.setText('form value');
    tf.addToPage(formPage);
    const formBytes = await formDoc.save();
    const formPath = join(dir, 'form-doc.pdf');
    await writeFile(formPath, Buffer.from(formBytes));

    // Load the form doc as the main doc (1 page)
    await engine.loadDocument('doc-1', formPath);
    let fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(1);
      // Field is on the only page: page 1
      expect(fields.value[0].page).toBe(1);
    }

    // Merge report.pdf 'before' the form doc
    const r = await engine.merge('doc-1', [reportPath], 'before');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(6); // 5 report + 1 form
    }

    // Form field should now be on page 6 (the last page, after 5 report pages)
    fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(1);
      expect(fields.value[0].page).toBe(6);
    }
  });

  it('merge after: form field page refs account for merge offset', async () => {
    // Main doc = report (5 pages), merge form.pdf 'after'
    // The form field should be on page 6.
    const engine = new EngineService();

    const reportDoc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) {
      const pg = reportDoc.addPage([612, 792]);
      pg.drawText(`Report page ${i}`, { x: 72, y: 700, size: 14 });
    }
    const reportBytes = await reportDoc.save();
    const reportPath = join(dir, 'report2.pdf');
    await writeFile(reportPath, Buffer.from(reportBytes));

    const formDoc = await PDFDocument.create();
    const formPage = formDoc.addPage([612, 792]);
    formPage.drawText('Form page', { x: 72, y: 700, size: 14 });
    const form = formDoc.getForm();
    const tf = form.createTextField('form_field');
    tf.setText('form value');
    tf.addToPage(formPage);
    const formBytes = await formDoc.save();
    const formPath = join(dir, 'form-doc2.pdf');
    await writeFile(formPath, Buffer.from(formBytes));

    // Load the report as main doc
    await engine.loadDocument('doc-1', reportPath);
    const r = await engine.merge('doc-1', [formPath], 'after');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pageCount).toBe(6);
    }

    const fields = await engine.getFormFields('doc-1');
    expect(fields.ok).toBe(true);
    if (fields.ok) {
      expect(fields.value.length).toBe(1);
      expect(fields.value[0].page).toBe(6);
    }
  });
});