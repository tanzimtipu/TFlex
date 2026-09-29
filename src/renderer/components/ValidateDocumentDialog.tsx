// Phase 54 (features D + E) — the "Validate document" dialog.
//
// The chooser lists exactly the six real profiles plus an explicit "No
// validation" opt-out. Running validates the ACTIVE document against the
// chosen target and renders the report inline; the host also surfaces the
// report as the per-tab card above the canvas. A "Remember this choice" control
// persists target + warn/block through the host's shared settings path.
//
// The dialog owns no engine/PDF state: it calls the host's `runValidation`,
// which talks to `window.tflex.validation`. Wording is imported from
// `state/validation` so the card and the dialog can never disagree, and none of
// it makes a conformance claim.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { ShieldCheck, X } from 'lucide-react';
import type { PdfValidationDefaults } from '../../shared/types';
import type {
  ValidationReport,
  ValidationTag,
  ValidationTarget,
} from '../../shared/validation';
import {
  VALIDATION_NO_TARGET_REASON,
  VALIDATION_TARGET_LABELS,
  VALIDATION_TARGETS,
  validationTargetLabel,
} from '../state/validation';
import { ValidationNotice } from './ValidationNotice';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';

export type ValidationOnViolation = 'warn' | 'block';

export interface ValidateDocumentDialogProps {
  open: boolean;
  /** The persisted default target (settings.pdfValidationDefaults.target). */
  initialTarget: ValidationTag;
  initialOnViolation: ValidationOnViolation;
  /** Validate the active document. Only ever called with a real target. */
  runValidation: (
    target: ValidationTarget,
  ) => Promise<{ report: ValidationReport } | { error: string }>;
  /** Persist the remembered choice through the host's settings path. */
  onRememberDefaults: (defaults: PdfValidationDefaults) => void;
  onClose: () => void;
}

/** Every choice the chooser renders, in order: the six targets then the opt-out. */
const CHOICES: readonly ValidationTag[] = [...VALIDATION_TARGETS, 'none'];

export function ValidateDocumentDialog(
  props: ValidateDocumentDialogProps,
): ReactElement | null {
  const {
    open,
    initialTarget,
    initialOnViolation,
    runValidation,
    onRememberDefaults,
    onClose,
  } = props;
  const [target, setTarget] = useState<ValidationTag>(initialTarget);
  const [onViolation, setOnViolation] = useState<ValidationOnViolation>(initialOnViolation);
  const [remember, setRemember] = useState<boolean>(initialTarget !== 'none');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Re-seed from the persisted defaults each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTarget(initialTarget);
    setOnViolation(initialOnViolation);
    setRemember(initialTarget !== 'none');
    setRunning(false);
    setReport(null);
    setError(null);
  }, [open, initialTarget, initialOnViolation]);

  // Esc closes (blocked while a validation is in flight); focus the first control.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const backdrop = useBackdropClose(onClose, running);

  const persist = (nextTarget: ValidationTag, nextViolation: ValidationOnViolation): void => {
    onRememberDefaults({ target: nextTarget, onViolation: nextViolation });
  };

  const chooseTarget = (next: ValidationTag): void => {
    setTarget(next);
    setReport(null);
    setError(null);
    if (remember) persist(next, onViolation);
  };

  const chooseOnViolation = (next: ValidationOnViolation): void => {
    setOnViolation(next);
    if (remember) persist(target, next);
  };

  const toggleRemember = (next: boolean): void => {
    setRemember(next);
    if (next) persist(target, onViolation);
  };

  const runDisabled = target === 'none' || running;

  const onRun = async (): Promise<void> => {
    // "No validation" is not a validation: it never calls the bridge.
    if (target === 'none' || running) return;
    if (remember) persist(target, onViolation);
    setRunning(true);
    setError(null);
    setReport(null);
    const result = await runValidation(target);
    setRunning(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setReport(result.report);
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
          <TfDialog
            className="modal-dialog dialog modal-dialog-tool validate-document-dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="validate-document-title"
            data-validate-document-dialog
          >
            <div className="modal-header">
              <h2 id="validate-document-title" className="modal-title">
                Validate document
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={onClose}
                disabled={running}
                aria-label="Close dialog"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-help">
                Check the active document against a profile. The report states what the file
                declares, what was checked and every finding for that profile.
              </p>
              <fieldset className="modal-position validate-document-targets">
                <legend>Check against</legend>
                {CHOICES.map((choice) => (
                  <label key={choice}>
                    <input
                      type="radio"
                      name="validation-target"
                      checked={target === choice}
                      onChange={(): void => chooseTarget(choice)}
                      disabled={running}
                      data-validation-target={choice}
                    />
                    <span>{VALIDATION_TARGET_LABELS[choice]}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="modal-position validate-document-onviolation">
                <legend>When a save does not conform</legend>
                <label>
                  <input
                    type="radio"
                    name="validation-on-violation"
                    checked={onViolation === 'warn'}
                    onChange={(): void => chooseOnViolation('warn')}
                    disabled={running}
                    data-validation-on-violation="warn"
                  />
                  <span>Warn — save anyway and show the findings</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="validation-on-violation"
                    checked={onViolation === 'block'}
                    onChange={(): void => chooseOnViolation('block')}
                    disabled={running}
                    data-validation-on-violation="block"
                  />
                  <span>Block — refuse the save and show the findings</span>
                </label>
              </fieldset>
              <label className="modal-field validate-document-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e): void => toggleRemember(e.target.checked)}
                  disabled={running}
                  data-validation-remember
                />
                <span>Remember this choice</span>
              </label>
              <p className="modal-hint" data-validation-effective>
                {target === 'none'
                  ? 'No validation: saving is unchanged.'
                  : `Saving checks ${validationTargetLabel(target)} and ${
                      onViolation === 'block' ? 'refuses' : 'warns'
                    } on a finding.`}
              </p>

              {error !== null && (
                <div className="modal-status optimize-error" role="alert" data-validation-error>
                  <span>{error}</span>
                </div>
              )}
              {report !== null && (
                <div className="validate-document-report" data-validation-inline-report>
                  <ValidationNotice notice={{ report, variant: 'report' }} />
                </div>
              )}
              {report === null && error === null && !running && target !== 'none' && (
                <p className="modal-hint validate-document-idle" data-validation-idle>
                  <ShieldCheck size={14} aria-hidden /> Run the check to see the report here.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={running}
                data-validation-close
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={runDisabled}
                onClick={(): void => {
                  void onRun();
                }}
                title={target === 'none' ? VALIDATION_NO_TARGET_REASON : undefined}
                data-validation-run
              >
                {running ? 'Validating…' : 'Validate'}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
