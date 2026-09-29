import { err, type Result } from '../../../shared/result';
import type { ConvertErrorCode } from '../../../shared/convert';

/**
 * Phase 53 — the typed conversion error layer (ruling 4).
 *
 * Every fatal conversion failure is a `ConvertErrorCode` with a non-empty,
 * human-readable message. `convertToPdf` (and `toDocument`) never throw
 * across IPC: adapter throws are caught at the service boundary and mapped
 * to `internal` via `mapAdapterThrow`.
 */
export const CONVERT_ERROR_MESSAGES: Record<ConvertErrorCode, string> = {
  'unsupported-format': 'This file type is not supported for import.',
  'empty-file': 'The file is empty (zero bytes).',
  'password-required': 'This file is protected; a password is required.',
  'too-large': 'The file is larger than the import size limit.',
  'decode-failed': 'The file could not be decoded with a supported text encoding.',
  corrupt: 'The file appears to be corrupt and could not be read.',
  'drm-protected':
    'This e-book is DRM-protected; TFlex never decrypts protected e-books.',
  cancelled: 'The import was cancelled.',
  timeout: 'The conversion took too long and was stopped.',
  internal: 'The import failed unexpectedly.',
};

/** Build a typed failure with the code's human message (optionally
 *  overridden by a more specific one). */
export function convertError(
  code: ConvertErrorCode,
  message?: string,
): Result<never, ConvertErrorCode> {
  return err(code, message ?? CONVERT_ERROR_MESSAGES[code]);
}

/** Thrown by an adapter (or the service) when a conversion is cancelled. The
 *  service maps it to `err('cancelled')` rather than a generic failure. */
export class ConvertCancelledError extends Error {
  constructor(message = CONVERT_ERROR_MESSAGES.cancelled) {
    super(message);
    this.name = 'ConvertCancelledError';
  }
}

/** Thrown by an adapter to report a specific typed failure (an adapter
 *  `convert` cannot return a `Result` — the service does). */
export class ConvertFailure extends Error {
  readonly code: ConvertErrorCode;

  constructor(code: ConvertErrorCode, message?: string) {
    super(message ?? CONVERT_ERROR_MESSAGES[code]);
    this.name = 'ConvertFailure';
    this.code = code;
  }
}

/** Convert any thrown value into a typed failure. Adapter failures and
 *  cancellations keep their own code; everything else is `internal` (never
 *  rethrown to IPC). */
export function mapAdapterThrow(
  thrown: unknown,
): Result<never, ConvertErrorCode> {
  if (thrown instanceof ConvertCancelledError) {
    return convertError('cancelled', thrown.message);
  }
  if (thrown instanceof ConvertFailure) {
    return convertError(thrown.code, thrown.message);
  }
  const message =
    thrown instanceof Error && thrown.message.length > 0
      ? `${CONVERT_ERROR_MESSAGES.internal} ${thrown.message}`
      : CONVERT_ERROR_MESSAGES.internal;
  return convertError('internal', message);
}
