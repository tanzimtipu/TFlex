import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_IMPORT_DEFAULTS,
  DEFAULT_PDF_VALIDATION_DEFAULTS,
} from '../../../src/shared/types';
import {
  normalizeImageImportDefaults,
  normalizePdfValidationDefaults,
} from '../../../src/main/services/settings';

/**
 * Phase 54 — the two new settings normalisers, mirroring the Phase 53
 * `normalizeConvertDefaults` discipline: preserve-if-valid, reject-if-invalid,
 * unknown keys dropped, partial objects filled from the default constant.
 */

describe('normalizeImageImportDefaults', () => {
  it('rejects an absent or empty field (consumer applies the default)', () => {
    expect(normalizeImageImportDefaults(undefined)).toBeNull();
    expect(normalizeImageImportDefaults(null)).toBeNull();
    expect(normalizeImageImportDefaults({})).toBeNull();
    expect(normalizeImageImportDefaults([])).toBeNull();
    expect(normalizeImageImportDefaults('image')).toBeNull();
  });

  it('drops unknown keys and keeps valid known ones', () => {
    const out = normalizeImageImportDefaults({
      pageSizeMode: 'fixed',
      bogus: 42,
    });
    expect(out).not.toBeNull();
    expect(out?.pageSizeMode).toBe('fixed');
    expect(Object.keys(out ?? {})).not.toContain('bogus');
    expect(out?.fit).toBe(DEFAULT_IMAGE_IMPORT_DEFAULTS.fit);
  });

  it('fills a partial object from DEFAULT_IMAGE_IMPORT_DEFAULTS', () => {
    const out = normalizeImageImportDefaults({ rotationDeg: 90 });
    expect(out).toEqual({
      ...DEFAULT_IMAGE_IMPORT_DEFAULTS,
      rotationDeg: 90,
    });
  });

  it('rejects an out-of-domain value by rejecting the WHOLE field', () => {
    expect(normalizeImageImportDefaults({ rotationDeg: 45 })).toBeNull();
    expect(normalizeImageImportDefaults({ pageSizeMode: 'weird' })).toBeNull();
    expect(normalizeImageImportDefaults({ fixedPageSize: 'a5' })).toBeNull();
    expect(normalizeImageImportDefaults({ fit: 'stretch' })).toBeNull();
    // A valid sibling never rescues an invalid key.
    expect(
      normalizeImageImportDefaults({ pageSizeMode: 'fixed', fit: 'stretch' }),
    ).toBeNull();
  });

  it('accepts every documented domain value', () => {
    for (const pageSizeMode of ['image', 'fixed'] as const) {
      expect(normalizeImageImportDefaults({ pageSizeMode })?.pageSizeMode).toBe(
        pageSizeMode,
      );
    }
    for (const fixedPageSize of ['a4', 'letter'] as const) {
      expect(
        normalizeImageImportDefaults({ fixedPageSize })?.fixedPageSize,
      ).toBe(fixedPageSize);
    }
    for (const fit of ['contain', 'cover', 'actual'] as const) {
      expect(normalizeImageImportDefaults({ fit })?.fit).toBe(fit);
    }
    for (const rotationDeg of [0, 90, 180, 270] as const) {
      expect(normalizeImageImportDefaults({ rotationDeg })?.rotationDeg).toBe(
        rotationDeg,
      );
    }
    expect(normalizeImageImportDefaults({ rotationDeg: '90' })).toBeNull();
  });

  it('the default constant equals the Phase 54 Settings impact literal', () => {
    expect(DEFAULT_IMAGE_IMPORT_DEFAULTS).toEqual({
      pageSizeMode: 'image',
      fixedPageSize: 'a4',
      fit: 'contain',
      rotationDeg: 0,
    });
  });
});

describe('normalizePdfValidationDefaults', () => {
  it('rejects an absent or empty field (consumer applies the default)', () => {
    expect(normalizePdfValidationDefaults(undefined)).toBeNull();
    expect(normalizePdfValidationDefaults(null)).toBeNull();
    expect(normalizePdfValidationDefaults({})).toBeNull();
    expect(normalizePdfValidationDefaults([])).toBeNull();
    expect(normalizePdfValidationDefaults('pdfa-1b')).toBeNull();
  });

  it('drops unknown keys and keeps valid known ones', () => {
    const out = normalizePdfValidationDefaults({
      target: 'pdfa-2b',
      bogus: true,
    });
    expect(out).not.toBeNull();
    expect(out?.target).toBe('pdfa-2b');
    expect(Object.keys(out ?? {})).not.toContain('bogus');
    expect(out?.onViolation).toBe(DEFAULT_PDF_VALIDATION_DEFAULTS.onViolation);
  });

  it('fills a partial object from DEFAULT_PDF_VALIDATION_DEFAULTS', () => {
    const out = normalizePdfValidationDefaults({ onViolation: 'block' });
    expect(out).toEqual({
      ...DEFAULT_PDF_VALIDATION_DEFAULTS,
      onViolation: 'block',
    });
  });

  it('rejects an out-of-domain value by rejecting the WHOLE field', () => {
    expect(normalizePdfValidationDefaults({ target: 'pdfa-9z' })).toBeNull();
    expect(normalizePdfValidationDefaults({ onViolation: 'explode' })).toBeNull();
    expect(
      normalizePdfValidationDefaults({ target: 'pdfx-1a', onViolation: 'explode' }),
    ).toBeNull();
  });

  it('accepts every documented target', () => {
    const targets = [
      'none',
      'pdfa-1b',
      'pdfa-2b',
      'pdfa-3b',
      'pdfx-1a',
      'pdfx-3',
      'pdfx-4',
    ] as const;
    for (const target of targets) {
      expect(normalizePdfValidationDefaults({ target })?.target).toBe(target);
    }
    expect(normalizePdfValidationDefaults({ onViolation: 'warn' })?.onViolation)
      .toBe('warn');
  });

  it('the default constant equals the Phase 54 Settings impact literal', () => {
    expect(DEFAULT_PDF_VALIDATION_DEFAULTS).toEqual({
      target: 'none',
      onViolation: 'warn',
    });
  });
});
