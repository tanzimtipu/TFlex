import { describe, it, expect } from 'vitest';
import { formatErrorMessage, describePdfOpenError } from '../../../src/main/services/error-text';
import { sniff } from '../../../src/main/services/pdf-file';
import { EngineService } from '../../../src/main/services/engine';

// Phase 51-I — the OS-open failure dialog interpolated the `ResultError`
// object directly (`${check.error}`), printing `[object Object]`. These tests
// pin the readable formatter, the per-code user sentence, and the open-path
// classification so the defect cannot come back.

describe('formatErrorMessage — never [object Object]', () => {
  it('Error with a message -> name and message', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('Error: boom');
  });

  it('Error with no message -> just the name', () => {
    const e = new Error();
    expect(formatErrorMessage(e)).toBe('Error');
  });

  it('Error subclass without a custom name is still readable', () => {
    class EncryptedPDFError extends Error {}
    expect(formatErrorMessage(new EncryptedPDFError('is encrypted'))).toBe(
      'Error: is encrypted',
    );
  });

  it('Error with an explicit name keeps it', () => {
    const e = new Error('is encrypted');
    e.name = 'EncryptedPDFError';
    expect(formatErrorMessage(e)).toBe('EncryptedPDFError: is encrypted');
  });

  it('string -> itself', () => {
    expect(formatErrorMessage('file is encrypted')).toBe('file is encrypted');
  });

  it('blank string -> a plain description', () => {
    expect(formatErrorMessage('   ')).toBe('(empty message)');
  });

  it('plain object with message and code -> "code: message"', () => {
    expect(
      formatErrorMessage({ code: 'encrypted', message: 'file is encrypted' }),
    ).toBe('encrypted: file is encrypted');
  });

  it('plain object with message only -> message', () => {
    expect(formatErrorMessage({ message: 'damaged' })).toBe('damaged');
  });

  it('plain object with code only -> code', () => {
    expect(formatErrorMessage({ code: 'corrupt' })).toBe('corrupt');
  });

  it('plain object with no useful fields -> JSON summary', () => {
    expect(formatErrorMessage({ a: 1 })).toBe('{"a":1}');
  });

  it('empty plain object -> a plain description', () => {
    expect(formatErrorMessage({})).toBe('unrecognised error object');
  });

  it('null and undefined -> a plain description', () => {
    expect(formatErrorMessage(null)).toBe('unknown error (null)');
    expect(formatErrorMessage(undefined)).toBe('unknown error (undefined)');
  });

  it('number and boolean -> their string form', () => {
    expect(formatErrorMessage(42)).toBe('42');
    expect(formatErrorMessage(false)).toBe('false');
  });

  it('none of the inputs ever formats to [object Object]', () => {
    const inputs: unknown[] = [
      new Error('x'),
      new Error(),
      'text',
      '',
      { code: 'encrypted', message: 'file is encrypted' },
      { a: 1 },
      {},
      null,
      undefined,
      0,
      true,
    ];
    for (const input of inputs) {
      expect(formatErrorMessage(input)).not.toContain('[object Object]');
    }
  });
});

describe('describePdfOpenError — a distinct sentence per failure case', () => {
  it('every PdfOpenError code maps to a specific, readable sentence', () => {
    const cases = [
      ['not-pdf', /not a PDF/i],
      ['corrupt', /damaged or truncated/i],
      ['encrypted', /encrypted/i],
      ['io', /could not be read/i],
    ] as const;
    for (const [code, pattern] of cases) {
      const text = describePdfOpenError({ code, message: 'raw detail' });
      expect(text).toMatch(pattern);
      expect(text).not.toContain('[object Object]');
      expect(text).not.toContain('raw detail');
    }
  });
});

describe('open-path classification of an encrypted PDF (synthetic bytes)', () => {
  const encryptedBytes = Buffer.from(
    '%PDF-1.5\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\nstartxref\n0\n%%EOF\n',
    'latin1',
  );

  it('Phase 52: sniff passes an /Encrypt file through (password handling is downstream)', () => {
    const result = sniff(encryptedBytes, 'synthetic-encrypted.pdf');
    expect(result.ok).toBe(true);
  });

  it('the encrypted code still renders a readable dialog sentence', () => {
    const text = describePdfOpenError({ code: 'encrypted', message: 'raw detail' });
    expect(text).toContain('encrypted');
    expect(text).not.toContain('[object Object]');
  });

  it('sniff still distinguishes not-pdf and corrupt', () => {
    const notPdf = sniff(Buffer.from('plain text'), 'x.pdf');
    expect(notPdf.ok).toBe(false);
    if (!notPdf.ok) expect(notPdf.error.code).toBe('not-pdf');
    const corrupt = sniff(Buffer.from('%PDF-1.5 with no trailer'), 'x.pdf');
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('corrupt');
    const empty = sniff(Buffer.alloc(0), 'x.pdf');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('corrupt');
  });

  it('engine load failure keeps the underlying reason (fail loud, not [object Object])', async () => {
    const engine = new EngineService();
    const result = await engine.loadDocumentBytes(
      'doc-1',
      Buffer.from('%PDF-1.5\nnot a real document'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('open-error');
      expect(result.error.message).toContain('could not parse PDF bytes (');
      expect(result.error.message).not.toContain('[object Object]');
    }
  });
});
