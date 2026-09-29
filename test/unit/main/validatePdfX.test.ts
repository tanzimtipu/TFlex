import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, cmyk } from '@cantoo/pdf-lib';
import { DocumentValidationService } from '../../../src/main/services/validation';
import type { ValidationReport } from '../../../src/shared/validation';
import { buildFixture, PDFX1A_XMP } from './validationFixtures';

/**
 * Phase 54 feature E — the PDF/X rule set over pdf-lib-built fixtures.
 * Device-RGB detection is a documented heuristic operator scan; the report
 * discloses it and never claims certification.
 */

const service = new DocumentValidationService();

const advBytes = (name: string): Promise<Uint8Array> =>
  readFile(resolve('test-fixtures/adv-p54', name)).then((b) => new Uint8Array(b));

async function report(
  bytes: Uint8Array,
  target: 'pdfx-1a' | 'pdfx-3' | 'pdfx-4',
): Promise<ValidationReport> {
  const result = await service.validateBytes(bytes, target);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function rule(report: ValidationReport, name: string) {
  return report.violations.filter((v) => v.rule === name);
}

/** A one-page document whose content stream uses only CMYK operators. */
async function cmykFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: cmyk(0, 0, 0, 1) });
  const icc = doc.context.stream(new Uint8Array([0, 0, 0, 2, 0x49, 0x43, 0x43]), { N: 3 });
  const intent = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFX' });
  intent.set(PDFName.of('DestOutputProfile'), doc.context.register(icc));
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([intent]));
  return doc.save();
}

describe('phase54 pdf/x: output intent', () => {
  it('X-1a with an OutputIntent and CMYK operators passes those checks', async () => {
    const out = await report(await cmykFixture(), 'pdfx-1a');
    expect(rule(out, 'pdfx.output-intent')).toHaveLength(0);
    expect(rule(out, 'pdfx.device-rgb')).toHaveLength(0);
    expect(out.conforms).toBe(true);
  });

  it('the same document without the OutputIntent reports the output-intent rule', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([200, 200]).drawRectangle({
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      color: cmyk(0, 0, 0, 1),
    });
    const out = await report(await doc.save(), 'pdfx-1a');
    expect(rule(out, 'pdfx.output-intent')).toHaveLength(1);
    expect(out.conforms).toBe(false);
  });

  it('reads the declared PDF/X version from the XMP', async () => {
    const out = await report(
      await buildFixture({ xmp: PDFX1A_XMP, outputIntent: true }),
      'pdfx-1a',
    );
    expect(out.declared).toBe('PDF/X-1:2001');
  });
});

describe('phase54 pdf/x: device RGB relaxation', () => {
  it('is a violation for X-1a (naming pages) and not for X-3/X-4', async () => {
    const bytes = await buildFixture({ outputIntent: true, deviceRgb: true });
    const oneA = await report(bytes, 'pdfx-1a');
    const three = await report(bytes, 'pdfx-3');
    const four = await report(bytes, 'pdfx-4');
    expect(rule(oneA, 'pdfx.device-rgb')).toHaveLength(1);
    expect(rule(oneA, 'pdfx.device-rgb')[0].detail).toContain('page');
    expect(rule(oneA, 'pdfx.device-rgb')[0].detail).toContain('heuristic');
    expect(rule(three, 'pdfx.device-rgb')).toHaveLength(0);
    expect(rule(four, 'pdfx.device-rgb')).toHaveLength(0);
  });

  it('does not flag a CMYK-only document as device RGB', async () => {
    const out = await report(await cmykFixture(), 'pdfx-1a');
    expect(rule(out, 'pdfx.device-rgb')).toHaveLength(0);
  });
});

describe('phase54 pdf/x: transparency relaxation', () => {
  it('is a violation for X-1a and not for X-4', async () => {
    const bytes = await buildFixture({ outputIntent: true, transparency: true });
    const oneA = await report(bytes, 'pdfx-1a');
    const four = await report(bytes, 'pdfx-4');
    expect(rule(oneA, 'pdfx.transparency')).toHaveLength(1);
    expect(rule(four, 'pdfx.transparency')).toHaveLength(0);
  });
});

describe('phase54 pdf/x: hostile specimens (adversary adv-p54, DEF-381/DEF-386)', () => {
  it('DEF-381: a 200 MiB decoded content stream is bounded and reported, never an OOM', async () => {
    const started = Date.now();
    const out = await report(await advBytes('val-bigcontent.pdf'), 'pdfx-1a');
    const elapsed = Date.now() - started;
    const warning = out.violations.filter((v) => v.rule === 'pdfx.device-rgb');
    expect(warning).toHaveLength(1);
    expect(warning[0].severity).toBe('warning');
    expect(warning[0].detail).toContain('could not be determined');
    expect(warning[0].detail).toContain('32 MiB per-page scan cap');
    // Before the fix this document OOM-killed the main process at ~2.6 s.
    expect(elapsed).toBeLessThan(30000);
    // A check that could not be performed must not be a silent pass.
    expect(out.conforms).toBe(false);
    console.log('[DEF-381] val-bigcontent.pdf (200 MiB decoded) bounded in', elapsed, 'ms');
  }, 60000);

  it('DEF-381: the 25/50/100 MiB sweep is bounded', async () => {
    for (const [mb, name] of [
      [25, 'val-bigcontent-25mb.pdf'],
      [50, 'val-bigcontent-50mb.pdf'],
      [100, 'val-bigcontent-100mb.pdf'],
    ] as const) {
      const started = Date.now();
      const out = await report(await advBytes(name), 'pdfx-1a');
      const elapsed = Date.now() - started;
      const rgb = out.violations.filter((v) => v.rule === 'pdfx.device-rgb');
      if (mb <= 25) {
        // Below the documented 32 MiB per-page cap the scan completes: this
        // fixture uses only `k` operators, so the determined result is "none".
        expect(rgb).toHaveLength(0);
      } else {
        expect(rgb).toHaveLength(1);
        expect(rgb[0].detail).toContain('could not be determined');
      }
      expect(elapsed).toBeLessThan(30000);
      console.log(`[DEF-381] val-bigcontent-${mb}mb pdfx-1a bounded in`, elapsed, 'ms');
    }
  }, 120000);

  it('DEF-386: an impossible PDF/X identification is reported and never conforms', async () => {
    const out = await report(await advBytes('val-pdfx-part9.pdf'), 'pdfx-1a');
    expect(out.declared).toBe('PDF/X-99:2099');
    expect(out.conforms).toBe(false);
    const declared = out.violations.filter((v) => v.rule === 'pdfx.declared-level');
    expect(declared).toHaveLength(1);
    expect(declared[0].severity).toBe('warning');
    expect(declared[0].detail).toContain('PDF/X-99:2099');
  });

  it('DEF-386: a valid declared PDF/X version is unchanged', async () => {
    const out = await report(await buildFixture({ xmp: PDFX1A_XMP, outputIntent: true }), 'pdfx-1a');
    expect(out.declared).toBe('PDF/X-1:2001');
    expect(out.violations.some((v) => v.rule === 'pdfx.declared-level')).toBe(false);
  });
});

describe('phase54 pdf/x: report framing', () => {
  it('every rule detail is non-empty and no wording claims certification', async () => {
    const bytes = await buildFixture({
      outputIntent: true,
      deviceRgb: true,
      transparency: true,
      addFont: true,
      fontEmbedded: false,
    });
    const out = await report(bytes, 'pdfx-1a');
    expect(out.violations.length).toBeGreaterThan(0);
    for (const violation of out.violations) {
      expect(violation.rule.length).toBeGreaterThan(0);
      expect(violation.detail.trim().length).toBeGreaterThan(0);
    }
    const text = JSON.stringify(out).toLowerCase();
    expect(text).not.toContain('certified');
    expect(text).not.toContain('certification');
    expect(out).toHaveProperty('declared');
    expect(out).toHaveProperty('violations');
    expect(out).toHaveProperty('conforms');
  });
});
