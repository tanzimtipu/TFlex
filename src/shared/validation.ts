import type { EngineError } from './types';
import type { Result } from './result';

/**
 * Phase 54 features D + E — PDF/A and PDF/X validation.
 *
 * This is a DOCUMENTED, BOUNDED RULE SET, not a colour-managed preflight and
 * not a certification. The report says what the file's own XMP DECLARES plus
 * every violation this rule set found; it never claims the document is
 * certified, never converts colour spaces and never injects conformance
 * metadata. A check that could not be performed is reported as a `warning`
 * ("could not be determined"), never silently treated as a pass.
 */

/** A profile that can be validated. `none` means "do not validate" and is the
 *  shipped default; when the target is `none` the export guard is a no-op. */
export type ValidationTarget =
  | 'pdfa-1b'
  | 'pdfa-2b'
  | 'pdfa-3b'
  | 'pdfx-1a'
  | 'pdfx-3'
  | 'pdfx-4';

/** A validation target including the opt-out. */
export type ValidationTag = 'none' | ValidationTarget;

/** A single finding. `rule` is a stable identifier (e.g. `pdfa.font-embedding`);
 *  `detail` is always non-empty and explains what was checked. A `warning`
 *  means the check ran but could not be fully determined, or is a documented
 *  heuristic — it is disclosed, never hidden. */
export interface ValidationViolation {
  rule: string;
  detail: string;
  severity: 'error' | 'warning';
}

/** The result of validating a document against a target. `declared` is what
 *  the file's own XMP says (its self-declaration), or null when the file
 *  declares nothing. `conforms` is true only when this bounded rule set found
 *  no violations — it is NOT a certification claim. */
export interface ValidationReport {
  target: ValidationTarget;
  /** 'pdfa' | 'pdfx' — which family the target belongs to. */
  standard: 'pdfa' | 'pdfx';
  /** The level/identification read from the document's XMP, e.g. 'PDF/A-1b'
   *  or 'PDF/X-1:2001'; null when the file carries no such declaration. */
  declared: string | null;
  conforms: boolean;
  violations: ValidationViolation[];
}

/** Why a validation could not be attempted at all. A validation that RAN and
 *  found violations still resolves `ok` with the report — the two are never
 *  conflated. */
export type ValidationErrorCode =
  | 'unknown-target'
  | 'unreadable-document'
  | 'internal';

/** The outcome of the export guard. `none` means the guard did not engage
 *  (target was `none`) — the caller writes exactly as before. `written` means
 *  the file was written (with the report when validation ran). `blocked` means
 *  the guard refused to write and returns the report instead. */
export interface ExportGuardOutcome {
  action: 'none' | 'written' | 'blocked';
  report: ValidationReport | null;
}

/** The guarded save result: the normal `Result<string, EngineError>` plus the
 *  validation report when the guard ran. The `validation` field is absent for
 *  the default `target: 'none'` path, so existing callers are unchanged. */
export type EngineSaveResult = Result<string, EngineError> & {
  validation?: ValidationReport;
};
