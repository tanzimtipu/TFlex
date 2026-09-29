// Phase 54 (features D + E) — the validation surface's pure helpers.
//
// This module owns the report's user-facing wording, the target catalogue
// (exactly the six real targets plus the `none` opt-out) and the save-result
// bridge. The report states what a file DECLARES and what was CHECKED against a
// target; it makes no conformance claim and no string here names one.

import type { AppSettings, PdfValidationDefaults } from '../../shared/types';
import { DEFAULT_PDF_VALIDATION_DEFAULTS } from '../../shared/types';
import type {
  ValidationErrorCode,
  ValidationReport,
  ValidationTag,
  ValidationTarget,
  ValidationViolation,
} from '../../shared/validation';

/** The six profiles the chooser offers (the `none` opt-out is not a target). */
export const VALIDATION_TARGETS: readonly ValidationTarget[] = [
  'pdfa-1b',
  'pdfa-2b',
  'pdfa-3b',
  'pdfx-1a',
  'pdfx-3',
  'pdfx-4',
];

/** Every selectable value, including `none`, with its user-facing label. */
export const VALIDATION_TARGET_LABELS: Record<ValidationTag, string> = {
  none: 'No validation',
  'pdfa-1b': 'PDF/A-1b',
  'pdfa-2b': 'PDF/A-2b',
  'pdfa-3b': 'PDF/A-3b',
  'pdfx-1a': 'PDF/X-1a',
  'pdfx-3': 'PDF/X-3',
  'pdfx-4': 'PDF/X-4',
};

export function validationTargetLabel(target: ValidationTag): string {
  return VALIDATION_TARGET_LABELS[target];
}

/** The reason the Run control is disabled while the chooser sits on `none`. */
export const VALIDATION_NO_TARGET_REASON = 'Choose a target to validate against';

/** How the report is presented: an inline run, a refused save, or a warned save. */
export type ValidationNoticeVariant = 'report' | 'blocked' | 'warned';

/** One tab's validation card: the report plus why it is being shown. */
export interface ValidationNoticeState {
  report: ValidationReport;
  variant: ValidationNoticeVariant;
}

export function validationDeclaredText(declared: string | null): string {
  return declared === null || declared.trim() === '' ? 'none declared' : declared;
}

export const VALIDATION_CONFORMS_TEXT = 'Conforms to the checked target';
export const VALIDATION_DOES_NOT_CONFORM_TEXT = 'Does not conform to the checked target';
export const VALIDATION_ERRORS_HEADING = 'Errors';
export const VALIDATION_WARNINGS_HEADING = 'Could not be determined';
export const VALIDATION_WARNING_PREFIX = 'Could not be determined';
export const VALIDATION_NO_CLAIM_NOTE =
  'This reports what the file declares and what was checked against the selected target.';
export const VALIDATION_BLOCKED_TITLE = 'Save blocked';
export const VALIDATION_BLOCKED_TEXT = 'No file was written.';
export const VALIDATION_WARNED_TITLE = 'Saved';
export const VALIDATION_WARNED_TEXT = 'The file was written. Review the findings below.';

/** Readable text for a validation that could not be attempted at all. */
export function validationErrorText(code: ValidationErrorCode): string {
  switch (code) {
    case 'unknown-target':
      return VALIDATION_NO_TARGET_REASON;
    case 'unreadable-document':
      return 'The document could not be read.';
    case 'internal':
      return 'Validation could not be completed.';
  }
}

export interface GroupedViolations {
  errors: ValidationViolation[];
  warnings: ValidationViolation[];
}

/** Split findings by severity, preserving order inside each group. */
export function groupViolations(
  violations: readonly ValidationViolation[],
): GroupedViolations {
  const errors: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];
  for (const violation of violations) {
    (violation.severity === 'error' ? errors : warnings).push(violation);
  }
  return { errors, warnings };
}

function isViolation(value: unknown): value is ValidationViolation {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rule === 'string' &&
    typeof v.detail === 'string' &&
    (v.severity === 'error' || v.severity === 'warning')
  );
}

/** Structural check for a report arriving over IPC (a hostile/absent field reads as absent). */
export function isValidationReport(value: unknown): value is ValidationReport {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.target === 'string' &&
    VALIDATION_TARGETS.includes(v.target as ValidationTarget) &&
    (v.standard === 'pdfa' || v.standard === 'pdfx') &&
    (v.declared === null || typeof v.declared === 'string') &&
    typeof v.conforms === 'boolean' &&
    Array.isArray(v.violations) &&
    v.violations.every(isViolation)
  );
}

/**
 * The report a save carried, if any. A BLOCKED save is `{ ok: false, error,
 * validation }`; a WARNED save is `{ ok: true, value, validation }`. Either way
 * the field is read structurally so the renderer never has to widen the shared
 * `Result` shape, and the default `target: 'none'` path (no field) reads null.
 */
export function validationFromSaveResult(result: unknown): ValidationReport | null {
  if (result === null || typeof result !== 'object') return null;
  const value = (result as { validation?: unknown }).validation;
  return isValidationReport(value) ? value : null;
}

/** The effective remembered defaults, falling back to the shipped `none`. */
export function effectiveValidationDefaults(
  settings: AppSettings | null | undefined,
): PdfValidationDefaults {
  return settings?.pdfValidationDefaults ?? DEFAULT_PDF_VALIDATION_DEFAULTS;
}

/**
 * Merge a remembered choice into the settings object immutably. Returns the
 * SAME reference when nothing changes, so the host's `trackAndSave` write is a
 * no-op for an unchanged selection.
 */
export function withValidationDefaults(
  settings: AppSettings,
  defaults: PdfValidationDefaults,
): AppSettings {
  const current = settings.pdfValidationDefaults;
  if (
    current !== undefined &&
    current.target === defaults.target &&
    current.onViolation === defaults.onViolation
  ) {
    return settings;
  }
  return {
    ...settings,
    pdfValidationDefaults: { target: defaults.target, onViolation: defaults.onViolation },
  };
}

/** The blocked-save toast: names the target and states plainly no file was written. */
export function blockedSaveMessage(report: ValidationReport): string {
  return `Save blocked by ${validationTargetLabel(report.target)}: ${VALIDATION_BLOCKED_TEXT}`;
}
