// Phase 1216 chunk C6 — shared Activity capability + progress-truthfulness
// contract. Pins the exact four kinds and their declared cancel/actions, and
// the determinate-only-when-total>0 clamping rule of `toTruthfulProgress`.

import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_OPERATION_CAPABILITIES,
  capabilityFor,
  toTruthfulProgress,
} from '../../../src/shared/activity';

describe('activity capability contract', () => {
  it('declares exactly the four kinds with their exact capabilities', () => {
    expect(Object.keys(ACTIVITY_OPERATION_CAPABILITIES).sort()).toEqual([
      'convert',
      'ocr',
      'search-index',
      'update',
    ]);

    expect(ACTIVITY_OPERATION_CAPABILITIES.ocr).toEqual({
      kind: 'ocr',
      cancelable: true,
      completionActions: ['view-details'],
    });
    expect(ACTIVITY_OPERATION_CAPABILITIES.convert).toEqual({
      kind: 'convert',
      cancelable: true,
      completionActions: ['open-result', 'view-details'],
    });
    expect(ACTIVITY_OPERATION_CAPABILITIES['search-index']).toEqual({
      kind: 'search-index',
      cancelable: false,
      completionActions: [],
    });
    expect(ACTIVITY_OPERATION_CAPABILITIES.update).toEqual({
      kind: 'update',
      cancelable: false,
      completionActions: [],
    });

    expect(capabilityFor('ocr').cancelable).toBe(true);
    expect(capabilityFor('search-index').cancelable).toBe(false);
  });
});

describe('toTruthfulProgress', () => {
  it('returns determinate progress when total is a real total', () => {
    expect(toTruthfulProgress({ done: 4, total: 12, unit: 'pages' })).toEqual({
      kind: 'determinate',
      done: 4,
      total: 12,
      unit: 'pages',
    });
  });

  it('falls back to indeterminate Working with no inputs', () => {
    expect(toTruthfulProgress({})).toEqual({
      kind: 'indeterminate',
      phaseText: 'Working',
    });
  });

  it('is indeterminate when total is zero', () => {
    expect(toTruthfulProgress({ total: 0 })).toEqual({
      kind: 'indeterminate',
      phaseText: 'Working',
    });
  });

  it('clamps done into [0, total]', () => {
    expect(toTruthfulProgress({ done: 99, total: 10, unit: 'pages' })).toEqual({
      kind: 'determinate',
      done: 10,
      total: 10,
      unit: 'pages',
    });
  });

  it('uses the provided phase text when indeterminate', () => {
    expect(toTruthfulProgress({ phaseText: 'Importing' })).toEqual({
      kind: 'indeterminate',
      phaseText: 'Importing',
    });
  });
});
