// Phase 88 / C (FEA-037) — the "Sanitize document" dialog.
//
// The dialog lets the user choose which classes of active content to strip
// (JavaScript, launch/open actions, embedded files, metadata), runs the
// engine's `sanitizeDoc` through the host callback and renders the honest
// per-class report plus any warning the sanitizer produced. It owns no engine
// state: the host runs the op, refreshes the document proxy and persists the
// selection through the existing settings path.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { Shield, X } from 'lucide-react';
import {
  SANITIZE_CLASSES,
  type SanitizeClass,
  type SanitizeOptions,
  type SanitizeReport,
} from '../../shared/sanitize';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';

/** The successful run result the host returns (report + readable warnings). */
export interface SanitizeRunOutcome {
  report: SanitizeReport;
  warnings: string[];
}

export interface SanitizeDialogProps {
  open: boolean;
  /** The persisted selection (settings.sanitizeOptions), normalized by the host. */
  initialOptions: SanitizeOptions;
  /** Run sanitize on the active document with the given selection. */
  runSanitize: (
    options: SanitizeOptions,
  ) => Promise<SanitizeRunOutcome | { error: string }>;
  /** Persist a toggle through the host's settings path. */
  onOptionsChange: (options: SanitizeOptions) => void;
  onClose: () => void;
}

/** Human label per class; the checkbox order follows SANITIZE_CLASSES. */
const CLASS_LABELS: Readonly<Record<SanitizeClass, string>> = {
  javascript: 'JavaScript',
  launchActions: 'Launch and open actions',
  embeddedFiles: 'Embedded files',
  metadata: 'Metadata',
};

export function SanitizeDialog(
  props: SanitizeDialogProps,
): ReactElement | null {
  const { open, initialOptions, runSanitize, onOptionsChange, onClose } = props;
  const [options, setOptions] = useState<SanitizeOptions>(initialOptions);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SanitizeReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Re-seed from the persisted selection each time the dialog opens (or the
  // host's normalized selection changes) so a stale run never leaks in.
  useEffect(() => {
    if (!open) return;
    setOptions(initialOptions);
    setRunning(false);
    setReport(null);
    setWarnings([]);
    setError(null);
    setHasRun(false);
  }, [open, initialOptions]);

  // Esc closes; the first control takes focus on open.
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

  const selected = SANITIZE_CLASSES.filter((cls) => options[cls]);
  const runDisabled = running || selected.length === 0;

  const toggle = (cls: SanitizeClass, next: boolean): void => {
    const updated: SanitizeOptions = { ...options, [cls]: next };
    setOptions(updated);
    setReport(null);
    setWarnings([]);
    setError(null);
    setHasRun(false);
    onOptionsChange(updated);
  };

  const onRun = async (): Promise<void> => {
    if (running || selected.length === 0) return;
    setRunning(true);
    setError(null);
    setReport(null);
    setWarnings([]);
    const result = await runSanitize(options);
    setRunning(false);
    setHasRun(true);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setReport(result.report);
    setWarnings(result.warnings);
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
          <TfDialog
            className="modal-dialog dialog modal-dialog-tool sanitize-dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sanitize-dialog-title"
            data-sanitize-dialog
          >
            <div className="modal-header">
              <h2 id="sanitize-dialog-title" className="modal-title">
                Sanitize document
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
                Choose the classes of active content to strip from the active
                document. Every removal is listed per class, and every object the
                sanitizer could not process is reported below.
              </p>
              <fieldset className="modal-position sanitize-classes">
                <legend>Strip from the document</legend>
                {SANITIZE_CLASSES.map((cls) => (
                  <label key={cls}>
                    <input
                      type="checkbox"
                      checked={options[cls]}
                      onChange={(e): void => toggle(cls, e.target.checked)}
                      disabled={running}
                      data-sanitize-class={cls}
                    />
                    <span>{CLASS_LABELS[cls]}</span>
                  </label>
                ))}
              </fieldset>

              {error !== null && (
                <div className="modal-status optimize-error" role="alert" data-sanitize-error>
                  <span>{error}</span>
                </div>
              )}

              {report !== null && (
                <div className="sanitize-report" data-sanitize-report>
                  {SANITIZE_CLASSES.map((cls) => (
                    <div key={cls} className="sanitize-report-class">
                      <span className="sanitize-report-label">{CLASS_LABELS[cls]}</span>
                      <span className="sanitize-report-count">
                        {report.removedByClass[cls]} removed
                      </span>
                    </div>
                  ))}
                  {report.findings.map((finding, index) => (
                    <div
                      key={`${finding.class}:${index}`}
                      className="sanitize-report-finding"
                    >
                      {finding.where} — {finding.detail}
                    </div>
                  ))}
                </div>
              )}

              {warnings.map((warning, index) => (
                <div
                  key={`${index}:${warning}`}
                  className="modal-status sanitize-warning"
                  role="status"
                  data-sanitize-warning
                >
                  <span>{warning}</span>
                </div>
              ))}

              {!hasRun && report === null && error === null && !running && (
                <p className="modal-hint sanitize-idle" data-sanitize-idle>
                  <Shield size={14} aria-hidden /> Run sanitize to see the per-class
                  report here.
                </p>
              )}

            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={running}
                data-sanitize-close
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
                data-sanitize-run
              >
                {running ? 'Sanitizing…' : 'Sanitize'}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
