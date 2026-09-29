import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { DocumentValidationService } from '../../../src/main/services/validation';
import type { ValidationReport } from '../../../src/shared/validation';
import { buildFixture, conformingPdfA, PDFA1B_XMP } from './validationFixtures';

/**
 * Phase 54 feature D — the PDF/A rule set over pdf-lib-built fixtures. The
 * "conforming" fixture is conforming with respect to the documented rule set
 * only; the report says "declared X, 0 violations" and nothing more.
 */

const service = new DocumentValidationService();

const advBytes = (name: string): Promise<Uint8Array> =>
  readFile(resolve('test-fixtures/adv-p54', name)).then((b) => new Uint8Array(b));

async function report(bytes: Uint8Array, target: 'pdfa-1b' | 'pdfa-2b' | 'pdfa-3b'): Promise<ValidationReport> {
  const result = await service.validateBytes(bytes, target);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function rule(report: ValidationReport, name: string) {
  return report.violations.filter((v) => v.rule === name);
}

describe('phase54 pdf/a: conforming fixture', () => {
  it('reports the declared level and zero errors', async () => {
    const out = await report(await conformingPdfA(), 'pdfa-1b');
    expect(out.declared).toBe('PDF/A-1b');
    expect(out.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
    expect(out.conforms).toBe(true);
  });
});

describe('phase54 pdf/a: one violating fixture per check', () => {
  it('reports a missing OutputIntent', async () => {
    const out = await report(await buildFixture({ xmp: PDFA1B_XMP }), 'pdfa-1b');
    expect(rule(out, 'pdfa.output-intent')).toHaveLength(1);
    expect(rule(out, 'pdfa.output-intent')[0].severity).toBe('error');
    expect(out.conforms).toBe(false);
  });

  it('reports an OutputIntent with no embedded ICC profile', async () => {
    const out = await report(await buildFixture({ outputIntentNoProfile: true }), 'pdfa-1b');
    expect(rule(out, 'pdfa.output-intent')).toHaveLength(1);
  });

  it('reports a non-embedded font', async () => {
    const out = await report(
      await buildFixture({ outputIntent: true, addFont: true, fontEmbedded: false }),
      'pdfa-1b',
    );
    expect(rule(out, 'pdfa.font-embedding')).toHaveLength(1);
    expect(rule(out, 'pdfa.font-embedding')[0].severity).toBe('error');
  });

  it('does not flag an embedded font', async () => {
    const out = await report(
      await buildFixture({ outputIntent: true, addFont: true, fontEmbedded: true }),
      'pdfa-1b',
    );
    expect(rule(out, 'pdfa.font-embedding')).toHaveLength(0);
  });

  it('reports encryption', async () => {
    const out = await report(
      await buildFixture({ outputIntent: true, addFont: true, fontEmbedded: true, encrypt: true }),
      'pdfa-1b',
    );
    expect(rule(out, 'pdfa.encryption')).toHaveLength(1);
    expect(out.conforms).toBe(false);
  });

  it('reports JavaScript', async () => {
    const out = await report(
      await buildFixture({ outputIntent: true, addFont: true, fontEmbedded: true, javascript: true }),
      'pdfa-1b',
    );
    expect(rule(out, 'pdfa.javascript')).toHaveLength(1);
  });

  it('reports an embedded file spec as external content for 1b', async () => {
    const out = await report(
      await buildFixture({ outputIntent: true, addFont: true, fontEmbedded: true, embeddedFile: true }),
      'pdfa-1b',
    );
    expect(rule(out, 'pdfa.external-content')).toHaveLength(1);
  });
});

describe('phase54 pdf/a: hostile specimens (adversary adv-p54, DEF-383/DEF-386)', () => {
  it('DEF-383: a wrong-typed /OutputIntents yields "could not be determined", never an internal error', async () => {
    for (const name of [
      'val-oi-number.pdf',
      'val-oi-nested.pdf',
      'val-oi-array-of-numbers.pdf',
      'val-oi-null.pdf',
    ]) {
      const result = await service.validateBytes(await advBytes(name), 'pdfa-1b');
      expect(result.ok, `${name} must produce a report`).toBe(true);
      if (!result.ok) continue;
      const violations = result.value.violations.filter((v) => v.rule === 'pdfa.output-intent');
      expect(violations, `${name} output-intent rule`).toHaveLength(1);
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].detail).toContain('could not be determined');
      expect(result.value.conforms).toBe(false);
    }
  });

  it('DEF-386: an impossible declared level is reported and never conforms', async () => {
    const bogus = await report(await advBytes('val-pdfa-conforming-bogusid.pdf'), 'pdfa-1b');
    expect(bogus.declared).toBe('PDF/A-9z');
    expect(bogus.conforms).toBe(false);
    const declared = bogus.violations.filter((v) => v.rule === 'pdfa.declared-level');
    expect(declared).toHaveLength(1);
    expect(declared[0].severity).toBe('warning');
    expect(declared[0].detail).toContain('PDF/A-9z');
    expect(declared[0].detail).toContain('not a recognised');

    const unknownConf = await report(await advBytes('val-pdfa-unknown-conf.pdf'), 'pdfa-1b');
    expect(unknownConf.declared).toBe('PDF/A-1x');
    expect(unknownConf.violations.some((v) => v.rule === 'pdfa.declared-level')).toBe(true);
  });

  it('DEF-383: a wrong-typed /Font or /ExtGState resource is undetermined, not a thrown error', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([200, 200]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: 42, ExtGState: 'nope' }));
    const result = await service.validateBytes(await doc.save(), 'pdfa-1b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fontWarning = result.value.violations.filter((v) => v.rule === 'pdfa.font-embedding');
    expect(fontWarning).toHaveLength(1);
    expect(fontWarning[0].severity).toBe('warning');
    expect(fontWarning[0].detail).toContain('could not be determined');
    expect(result.value.violations.some((v) => v.rule === 'pdfa.transparency')).toBe(true);
  });

  it('DEF-386: a valid declared level is unchanged (no declared-level warning)', async () => {
    const out = await report(await conformingPdfA(), 'pdfa-1b');
    expect(out.declared).toBe('PDF/A-1b');
    expect(out.violations.some((v) => v.rule === 'pdfa.declared-level')).toBe(false);
    expect(out.conforms).toBe(true);
  });
});

describe('phase54 pdf/a: documented relaxations', () => {
  it('PDF/A-3 with an embedded file does NOT report external content', async () => {
    const bytes = await buildFixture({
      outputIntent: true,
      addFont: true,
      fontEmbedded: true,
      embeddedFile: true,
    });
    const oneB = await report(bytes, 'pdfa-1b');
    const threeB = await report(bytes, 'pdfa-3b');
    expect(rule(oneB, 'pdfa.external-content')).toHaveLength(1);
    expect(rule(threeB, 'pdfa.external-content')).toHaveLength(0);
  });

  it('transparency is a violation for 1b and permitted for 2b/3b', async () => {
    const bytes = await buildFixture({
      outputIntent: true,
      addFont: true,
      fontEmbedded: true,
      transparency: true,
    });
    const oneB = await report(bytes, 'pdfa-1b');
    const twoB = await report(bytes, 'pdfa-2b');
    const threeB = await report(bytes, 'pdfa-3b');
    expect(rule(oneB, 'pdfa.transparency')).toHaveLength(1);
    expect(rule(twoB, 'pdfa.transparency')).toHaveLength(0);
    expect(rule(threeB, 'pdfa.transparency')).toHaveLength(0);
    expect(twoB.conforms).toBe(true);
  });
});
