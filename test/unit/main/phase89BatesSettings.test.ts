// Phase 89 (FEA-033) chunk A — AppSettings.batesDefaults normalisation.
//
// The field is preserve-if-valid per key: a valid value survives as-is; an
// invalid key falls back to its default; an absent field stays undefined so the
// consumer falls back to DEFAULT_BATES_DEFAULTS. A present non-object resolves
// to the full default object.

import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../../src/main/services/settings';
import { DEFAULT_BATES_DEFAULTS, validateBatesSettings } from '../../../src/shared/bates';

describe('Phase 89: normalizeSettings batesDefaults', () => {
  it('leaves the field absent when not stored', () => {
    expect(normalizeSettings({}).batesDefaults).toBeUndefined();
  });

  it('preserves a full valid value', () => {
    expect(normalizeSettings({
      batesDefaults: {
        prefix: 'EX-',
        suffix: '-END',
        startNumber: 42,
        padding: 4,
        position: 'top-right',
      },
    }).batesDefaults).toEqual({
      prefix: 'EX-',
      suffix: '-END',
      startNumber: 42,
      padding: 4,
      position: 'top-right',
    });
  });

  it('falls back per invalid key without touching the valid ones', () => {
    expect(normalizeSettings({
      batesDefaults: {
        prefix: 7,
        suffix: '-ok',
        startNumber: -3,
        padding: 2.5,
        position: 'middle',
      },
    }).batesDefaults).toEqual({
      ...DEFAULT_BATES_DEFAULTS,
      suffix: '-ok',
    });
  });

  it('resolves a present non-object to the full default object', () => {
    expect(normalizeSettings({ batesDefaults: 'nope' }).batesDefaults)
      .toEqual(DEFAULT_BATES_DEFAULTS);
    expect(normalizeSettings({ batesDefaults: null }).batesDefaults)
      .toEqual(DEFAULT_BATES_DEFAULTS);
  });

  it('round-trips: the normalised defaults validate as an engine payload', () => {
    const defaults = normalizeSettings({}).batesDefaults ?? DEFAULT_BATES_DEFAULTS;
    const payload = validateBatesSettings({ ...defaults, pages: [1] });
    expect(payload).not.toBeNull();
    expect(payload?.pages).toEqual([1]);
  });
});
