import type { ResultError } from '../../shared/result';
import type { PdfOpenError } from '../../shared/types';

/**
 * Phase 51-I — render an unknown thrown/inspected value as a READABLE
 * one-line message. The OS-open failure dialog used to interpolate a
 * `ResultError` object directly, which printed `[object Object]` and told
 * the user nothing. Every open-path failure now goes through here.
 *
 * Rules (never returns `[object Object]`):
 *   - Error            -> "<name>: <message>", or just "<name>" when the
 *                         message is empty (a bare Error is still readable).
 *   - string           -> the string (or "(empty message)" when blank).
 *   - number/boolean   -> its string form.
 *   - object           -> `message` (prefixed with `code` when present);
 *                         else `code`; else `name`; else a JSON summary;
 *                         else a plain description.
 *   - null/undefined   -> a plain description.
 */
export function formatErrorMessage(value: unknown): string {
  if (value === null) return 'unknown error (null)';
  if (value === undefined) return 'unknown error (undefined)';
  if (value instanceof Error) {
    const name = value.name.length > 0 ? value.name : 'Error';
    const message = typeof value.message === 'string' ? value.message.trim() : '';
    return message.length > 0 ? `${name}: ${message}` : name;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : '(empty message)';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = typeof record.message === 'string' ? record.message.trim() : undefined;
    const name = typeof record.name === 'string' ? record.name : undefined;
    if (message !== undefined && message.length > 0) {
      return code !== undefined && code.length > 0 ? `${code}: ${message}` : message;
    }
    if (code !== undefined && code.length > 0) return code;
    if (name !== undefined && name.length > 0) return name;
    try {
      const json = JSON.stringify(value);
      return json === undefined || json === '{}'
        ? 'unrecognised error object'
        : json;
    } catch {
      return 'unrecognised error object (not serialisable)';
    }
  }
  return String(value);
}

/**
 * Phase 51-I — a distinct, actionable sentence per PDF-open failure code.
 * `sniff`/`loadPdfFile` classifies the failure; this maps the classification
 * to text a user can act on instead of the raw code or `[object Object]`.
 */
const PDF_OPEN_MESSAGES: Record<PdfOpenError, string> = {
  'not-pdf': 'This file is not a PDF. Jovrel can only open PDF files.',
  corrupt: 'This PDF is damaged or truncated and cannot be read.',
  encrypted: 'This PDF is encrypted (password-protected). Jovrel cannot open encrypted PDFs.',
  io: 'The file could not be read. It may have been moved, renamed, or deleted.',
};

/**
 * Describe a `PdfOpenError` `ResultError` for display. The known codes get
 * their specific sentence; an unknown code (defensive) falls back to the
 * generic readable formatter.
 */
export function describePdfOpenError(error: ResultError<PdfOpenError>): string {
  const specific = PDF_OPEN_MESSAGES[error.code];
  if (specific !== undefined) return specific;
  return formatErrorMessage(error);
}
