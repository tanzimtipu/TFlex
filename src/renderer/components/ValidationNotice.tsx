// Phase 54 (features D + E) — the validation report card.
//
// A truthful, dismissible card shown above the canvas after a validation run,
// a blocked save or a warned save. It states what the file's own metadata
// DECLARES, what was CHECKED, whether this bounded rule set found conformance,
// and every finding with its rule name and detail. Errors and "could not be
// determined" warnings are different classes AND different copy, never colour
// alone. It makes no conformance claim anywhere.
//
// Mirrors ConversionNotice/ProtectionNotice: a FLOW element in the pane's
// document column, role="note", data-* hooks for tests/e2e, Lucide icons only,
// no emoji, and motion from the shared tokens (see the .validation-* CSS).

import type { ReactElement } from 'react';
import { FileCheck2, X } from 'lucide-react';
import {
  VALIDATION_BLOCKED_TEXT,
  VALIDATION_BLOCKED_TITLE,
  VALIDATION_CONFORMS_TEXT,
  VALIDATION_DOES_NOT_CONFORM_TEXT,
  VALIDATION_ERRORS_HEADING,
  VALIDATION_NO_CLAIM_NOTE,
  VALIDATION_WARNED_TEXT,
  VALIDATION_WARNED_TITLE,
  VALIDATION_WARNINGS_HEADING,
  VALIDATION_WARNING_PREFIX,
  groupViolations,
  validationDeclaredText,
  validationTargetLabel,
  type ValidationNoticeState,
} from '../state/validation';

export interface ValidationNoticeProps {
  notice: ValidationNoticeState;
  /** Dismiss for the tab; the tab and the document stay open. */
  onDismiss?: () => void;
}

export function ValidationNotice(props: ValidationNoticeProps): ReactElement {
  const { notice, onDismiss } = props;
  const { report, variant } = notice;
  const { errors, warnings } = groupViolations(report.violations);
  const blocked = variant === 'blocked';
  const warned = variant === 'warned';
  const title = blocked
    ? VALIDATION_BLOCKED_TITLE
    : warned
      ? VALIDATION_WARNED_TITLE
      : 'Validation report';

  return (
    <div
      className="validation-notice"
      role="note"
      aria-label={blocked ? 'Save blocked by validation' : 'Validation report'}
      data-validation-notice
      data-validation-variant={variant}
      data-validation-target={report.target}
      data-validation-conforms={report.conforms ? 'true' : 'false'}
      data-validation-violation-count={report.violations.length}
    >
      <FileCheck2 size={18} aria-hidden className="validation-notice-icon" />
      <div className="validation-notice-body">
        <p className="validation-notice-title" data-validation-title>
          {title}
        </p>
        {blocked && (
          <p className="validation-notice-blocked" data-validation-blocked>
            {VALIDATION_BLOCKED_TEXT}
          </p>
        )}
        {warned && (
          <p className="validation-notice-warned" data-validation-warned>
            {VALIDATION_WARNED_TEXT}
          </p>
        )}
        <p className="validation-notice-line" data-validation-declared>
          <span className="validation-notice-key">Declared:</span>{' '}
          <span data-validation-declared-value>
            {validationDeclaredText(report.declared)}
          </span>
        </p>
        <p className="validation-notice-line" data-validation-checked-against>
          <span className="validation-notice-key">Checked against:</span>{' '}
          <span data-validation-target-label>{validationTargetLabel(report.target)}</span>
        </p>
        <p
          className={
            report.conforms
              ? 'validation-notice-banner validation-notice-banner--conforms'
              : 'validation-notice-banner validation-notice-banner--deviates'
          }
          data-validation-conforms-banner
        >
          {report.conforms ? VALIDATION_CONFORMS_TEXT : VALIDATION_DOES_NOT_CONFORM_TEXT}
        </p>
        {errors.length > 0 && (
          <div className="validation-notice-group" data-validation-group="errors">
            <p className="validation-notice-group-heading" data-validation-group-heading>
              {VALIDATION_ERRORS_HEADING}
            </p>
            <ul className="validation-notice-list" data-validation-list="errors">
              {errors.map((violation, index) => (
                <li
                  key={`${violation.rule}-${index}`}
                  className="validation-notice-violation validation-notice-violation--error"
                  data-validation-violation
                  data-validation-rule={violation.rule}
                  data-validation-severity="error"
                >
                  <span className="validation-notice-rule" data-validation-rule-name>
                    {violation.rule}
                  </span>
                  <span className="validation-notice-detail" data-validation-detail>
                    {violation.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="validation-notice-group" data-validation-group="warnings">
            <p className="validation-notice-group-heading" data-validation-group-heading>
              {VALIDATION_WARNINGS_HEADING}
            </p>
            <ul className="validation-notice-list" data-validation-list="warnings">
              {warnings.map((violation, index) => (
                <li
                  key={`${violation.rule}-${index}`}
                  className="validation-notice-violation validation-notice-violation--warning"
                  data-validation-violation
                  data-validation-rule={violation.rule}
                  data-validation-severity="warning"
                >
                  <span className="validation-notice-severity" data-validation-severity-label>
                    {VALIDATION_WARNING_PREFIX}:
                  </span>
                  <span className="validation-notice-rule" data-validation-rule-name>
                    {violation.rule}
                  </span>
                  <span className="validation-notice-detail" data-validation-detail>
                    {violation.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="validation-notice-note" data-validation-note>
          {VALIDATION_NO_CLAIM_NOTE}
        </p>
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          className="validation-notice-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss validation report"
          data-validation-dismiss
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
