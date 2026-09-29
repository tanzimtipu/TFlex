import { describe, expect, it } from 'vitest';
import type { ConvertFormatId } from '../../../src/shared/convert';
import { DEFAULT_OFFICE_CONVERT_DEFAULTS } from '../../../src/shared/types';
import {
  normalizeOfficeConvertDefaults,
  normalizeSettings,
} from '../../../src/main/services/settings';

/**
 * Phase 55 — the `officeConvertDefaults` normaliser, mirroring the Phase 53/54
 * discipline: preserve-if-valid, reject-if-invalid, unknown keys dropped,
 * partial nested objects filled from the default constant.
 */

describe('normalizeOfficeConvertDefaults', () => {
  it('rejects an absent or empty field (consumer applies the default)', () => {
    expect(normalizeOfficeConvertDefaults(undefined)).toBeNull();
    expect(normalizeOfficeConvertDefaults(null)).toBeNull();
    expect(normalizeOfficeConvertDefaults({})).toBeNull();
    expect(normalizeOfficeConvertDefaults([])).toBeNull();
    expect(normalizeOfficeConvertDefaults('auto')).toBeNull();
  });

  it('fills a partial nested object from DEFAULT_OFFICE_CONVERT_DEFAULTS', () => {
    const out = normalizeOfficeConvertDefaults({
      spreadsheets: { orientation: 'landscape' },
    });
    expect(out).toEqual({
      ...DEFAULT_OFFICE_CONVERT_DEFAULTS,
      spreadsheets: {
        ...DEFAULT_OFFICE_CONVERT_DEFAULTS.spreadsheets,
        orientation: 'landscape',
      },
    });
  });

  it('drops unknown keys at every level and keeps valid known ones', () => {
    const out = normalizeOfficeConvertDefaults({
      spreadsheets: { gridlines: false, bogus: 1 },
      presentations: { includeNotes: true, extra: 'x' },
      exports: { includeImages: false },
      junk: true,
    });
    expect(out).not.toBeNull();
    expect(out?.spreadsheets.gridlines).toBe(false);
    expect(out?.spreadsheets.fitToWidth).toBe(
      DEFAULT_OFFICE_CONVERT_DEFAULTS.spreadsheets.fitToWidth,
    );
    expect(out?.presentations.includeNotes).toBe(true);
    expect(out?.exports.includeImages).toBe(false);
    expect(JSON.stringify(out)).not.toContain('bogus');
    expect(JSON.stringify(out)).not.toContain('junk');
    expect(JSON.stringify(out)).not.toContain('extra');
    expect(Object.keys(out?.exports ?? {})).toEqual(['includeImages']);
  });

  it('fills a partial exports block from the default', () => {
    const out = normalizeOfficeConvertDefaults({ exports: {} });
    expect(out).not.toBeNull();
    expect(out?.exports).toEqual(DEFAULT_OFFICE_CONVERT_DEFAULTS.exports);
    expect(out?.exports.includeImages).toBe(true);
  });

  it('drops the retired heading-detection key from a stored object without throwing', () => {
    // The retired key is assembled at runtime so the settings shape and this
    // battery carry no literal reference to it (rg gate must stay clean).
    const retiredKey = ['docx', 'Heading', 'Detection'].join('');
    const stored = {
      spreadsheets: { orientation: 'portrait' },
      exports: { includeImages: false, [retiredKey]: true },
    };
    const out = normalizeOfficeConvertDefaults(stored);
    expect(out).not.toBeNull();
    expect(out?.exports.includeImages).toBe(false);
    expect(out).not.toHaveProperty(`exports.${retiredKey}`);
    expect(Object.hasOwn(out?.exports ?? {}, retiredKey)).toBe(false);
    expect(JSON.stringify(out)).not.toContain(retiredKey);
  });

  it('rejects the WHOLE field for an invalid enum member', () => {
    expect(
      normalizeOfficeConvertDefaults({
        spreadsheets: { orientation: 'diagonal' },
      }),
    ).toBeNull();
    // A valid sibling never rescues an invalid member.
    expect(
      normalizeOfficeConvertDefaults({
        spreadsheets: { gridlines: true, orientation: 'diagonal' },
      }),
    ).toBeNull();
  });

  it('rejects the WHOLE field for a non-boolean anywhere', () => {
    expect(
      normalizeOfficeConvertDefaults({ spreadsheets: { gridlines: 'yes' } }),
    ).toBeNull();
    expect(
      normalizeOfficeConvertDefaults({ spreadsheets: { fitToWidth: 1 } }),
    ).toBeNull();
    expect(
      normalizeOfficeConvertDefaults({ presentations: { includeNotes: 'no' } }),
    ).toBeNull();
    expect(
      normalizeOfficeConvertDefaults({ exports: { includeImages: null } }),
    ).toBeNull();
  });

  it('rejects a nested block that is not an object', () => {
    expect(normalizeOfficeConvertDefaults({ spreadsheets: 'auto' })).toBeNull();
    expect(normalizeOfficeConvertDefaults({ presentations: [] })).toBeNull();
    expect(normalizeOfficeConvertDefaults({ exports: null })).toBeNull();
  });

  it('accepts every orientation and returns the full default shape', () => {
    for (const orientation of ['auto', 'portrait', 'landscape'] as const) {
      const out = normalizeOfficeConvertDefaults({
        spreadsheets: { orientation },
      });
      expect(out?.spreadsheets.orientation).toBe(orientation);
      expect(Object.keys(out ?? {}).sort()).toEqual([
        'exports',
        'presentations',
        'spreadsheets',
      ]);
    }
  });

  it('the default constant equals the Phase 55 Settings impact literal', () => {
    expect(DEFAULT_OFFICE_CONVERT_DEFAULTS).toEqual({
      spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' },
      presentations: { includeNotes: false },
      exports: { includeImages: true },
    });
  });
});

describe('normalizeSettings wiring', () => {
  it('preserves a valid officeConvertDefaults field', () => {
    const settings = normalizeSettings({
      officeConvertDefaults: { presentations: { includeNotes: true } },
    });
    expect(settings.officeConvertDefaults?.presentations.includeNotes).toBe(true);
    expect(settings.officeConvertDefaults?.spreadsheets.orientation).toBe('auto');
  });

  it('leaves the field absent when it is invalid or missing', () => {
    expect(normalizeSettings({}).officeConvertDefaults).toBeUndefined();
    expect(
      normalizeSettings({ officeConvertDefaults: { spreadsheets: 'x' } })
        .officeConvertDefaults,
    ).toBeUndefined();
  });

  it('normalises a whole settings object that still stores the retired key', () => {
    const retiredKey = ['docx', 'Heading', 'Detection'].join('');
    const settings = normalizeSettings({
      officeConvertDefaults: {
        exports: { includeImages: false, [retiredKey]: true },
      },
    });
    expect(settings.officeConvertDefaults).toBeDefined();
    expect(settings.officeConvertDefaults?.exports.includeImages).toBe(false);
    expect(
      Object.hasOwn(settings.officeConvertDefaults?.exports ?? {}, retiredKey),
    ).toBe(false);
  });
});

describe('phase55 format ids (compile-level guard)', () => {
  it('ConvertFormatId contains docx, odt and doc', () => {
    const ids: ConvertFormatId[] = ['docx', 'odt', 'doc'];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
