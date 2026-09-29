import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../src/shared/result';
import type { ValidationReport } from '../../../src/shared/validation';
import { runExportGuard, type AssessFn } from '../../../src/main/services/validation';

/**
 * Phase 54 features D + E — the export guard. With the default target `'none'`
 * the guard is a no-op; only a named profile engages it, and `onViolation`
 * decides whether a violating document is written or refused.
 */

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

const CONFORMING: ValidationReport = {
  target: 'pdfa-1b',
  standard: 'pdfa',
  declared: 'PDF/A-1b',
  conforms: true,
  violations: [],
};

const VIOLATING: ValidationReport = {
  target: 'pdfa-1b',
  standard: 'pdfa',
  declared: 'PDF/A-1b',
  conforms: false,
  violations: [
    { rule: 'pdfa.font-embedding', detail: '2 of 2 fonts are not embedded.', severity: 'error' },
  ],
};

function assessReturning(report: ValidationReport): AssessFn {
  return vi.fn(async () => ok(report));
}

describe('phase54 export guard: target none', () => {
  it('is a no-op: no assessment and the bytes written are identical', async () => {
    const assess = assessReturning(VIOLATING);
    let written: Uint8Array | null = null;
    const result = await runExportGuard('none', 'block', BYTES, async (bytes) => {
      written = bytes;
    }, assess);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('none');
      expect(result.value.report).toBeNull();
    }
    expect(assess).not.toHaveBeenCalled();
    expect(written).toBe(BYTES);
    expect(Array.from(written as unknown as Uint8Array)).toEqual(Array.from(BYTES));
  });
});

describe('phase54 export guard: block', () => {
  it('refuses to write a violating document and returns the report', async () => {
    const assess = assessReturning(VIOLATING);
    const write = vi.fn(async () => undefined);
    const result = await runExportGuard('pdfa-1b', 'block', BYTES, write, assess);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('blocked');
      if (result.value.action === 'blocked') {
        expect(result.value.report).toBe(VIOLATING);
      }
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('writes a conforming document and returns the report', async () => {
    const assess = assessReturning(CONFORMING);
    const write = vi.fn(async () => undefined);
    const result = await runExportGuard('pdfa-1b', 'block', BYTES, write, assess);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('written');
      if (result.value.action === 'written') expect(result.value.report).toBe(CONFORMING);
    }
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('phase54 export guard: warn', () => {
  it('writes a violating document and returns the report', async () => {
    const assess = assessReturning(VIOLATING);
    const write = vi.fn(async () => undefined);
    const result = await runExportGuard('pdfa-1b', 'warn', BYTES, write, assess);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('written');
      if (result.value.action === 'written') expect(result.value.report).toBe(VIOLATING);
    }
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('phase54 export guard: assessment failure', () => {
  it('returns err and does not write when validation could not be attempted', async () => {
    const assess: AssessFn = vi.fn(async () => err('unreadable-document', 'unreadable'));
    const write = vi.fn(async () => undefined);
    const result = await runExportGuard('pdfa-1b', 'warn', BYTES, write, assess);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unreadable-document');
    expect(write).not.toHaveBeenCalled();
  });
});
