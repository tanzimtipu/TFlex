// Phase 88 (FEA-037) chunk A — pure sanitize class/option/report model.
//
// Pins normalizeSanitizeOptions preserve/fallback per key and the report maths:
// selected in SANITIZE_CLASSES order, removedByClass counting every class with
// all four keys present, and findings copied in order.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SANITIZE_OPTIONS,
  SANITIZE_CLASSES,
  normalizeSanitizeOptions,
  summarizeSanitize,
  type SanitizeFinding,
} from '../../../src/shared/sanitize';

describe('phase88: normalizeSanitizeOptions', () => {
  it('falls back to the all-true default for a non-object raw', () => {
    for (const raw of [undefined, null, 42, 'x', true, []]) {
      expect(normalizeSanitizeOptions(raw)).toEqual(DEFAULT_SANITIZE_OPTIONS);
    }
  });

  it('preserves present boolean keys and falls back for missing ones', () => {
    expect(normalizeSanitizeOptions({ javascript: false, metadata: false })).toEqual({
      javascript: false,
      launchActions: true,
      embeddedFiles: true,
      metadata: false,
    });
  });

  it('rejects a wrong-typed key per key without touching the others', () => {
    expect(
      normalizeSanitizeOptions({
        javascript: 'no',
        launchActions: 1,
        embeddedFiles: null,
        metadata: false,
      }),
    ).toEqual({
      javascript: true,
      launchActions: true,
      embeddedFiles: true,
      metadata: false,
    });
  });

  it('does not mutate the shipped default object', () => {
    normalizeSanitizeOptions({ javascript: false });
    expect(DEFAULT_SANITIZE_OPTIONS.javascript).toBe(true);
    expect(SANITIZE_CLASSES).toEqual([
      'javascript',
      'launchActions',
      'embeddedFiles',
      'metadata',
    ]);
  });
});

describe('phase88: summarizeSanitize', () => {
  it('lists the true keys in SANITIZE_CLASSES order', () => {
    const report = summarizeSanitize([], {
      javascript: true,
      launchActions: false,
      embeddedFiles: true,
      metadata: true,
    });
    expect(report.selected).toEqual(['javascript', 'embeddedFiles', 'metadata']);
  });

  it('counts findings per class and always carries all four keys', () => {
    const findings: SanitizeFinding[] = [
      { class: 'javascript', where: 'catalog /Names /JavaScript', detail: 'removed' },
      { class: 'embeddedFiles', where: 'catalog /Names /EmbeddedFiles', detail: 'removed' },
      { class: 'javascript', where: 'catalog /OpenAction', detail: 'removed' },
    ];
    const report = summarizeSanitize(findings, DEFAULT_SANITIZE_OPTIONS);
    expect(report.removedByClass).toEqual({
      javascript: 2,
      launchActions: 0,
      embeddedFiles: 1,
      metadata: 0,
    });
    expect(Object.keys(report.removedByClass).sort()).toEqual([
      'embeddedFiles',
      'javascript',
      'launchActions',
      'metadata',
    ]);
  });

  it('copies findings in order and reports zero counts when empty', () => {
    const findings: SanitizeFinding[] = [
      { class: 'metadata', where: 'catalog /Metadata', detail: 'removed' },
      { class: 'launchActions', where: 'catalog /OpenAction', detail: 'removed' },
    ];
    const report = summarizeSanitize(findings, DEFAULT_SANITIZE_OPTIONS);
    expect(report.findings).toEqual(findings);
    expect(report.findings).not.toBe(findings);
    expect(summarizeSanitize([], DEFAULT_SANITIZE_OPTIONS).removedByClass).toEqual({
      javascript: 0,
      launchActions: 0,
      embeddedFiles: 0,
      metadata: 0,
    });
  });
});
