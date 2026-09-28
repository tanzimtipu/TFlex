// Phase 53 (feature I) — the conversion surfaces.
//
// `ConversionNotice` is the dismissible card shown above the canvas after a
// non-PDF file is imported: the source format label, the fidelity in plain
// words, and EVERY warning (message + optional detail) always visible — never
// behind a hover. `ConversionProgress` is the app-level affordance shown while
// a conversion runs, with a cancel control.
//
// Mirrors ProtectionNotice: a flow element in the pane's document column,
// role="note", data-* hooks for tests/e2e, Lucide icons only, no emoji. Motion
// comes from the shared tokens (see the .conversion-* rules in styles.css).

import type { ReactElement } from 'react';
import { FileText, Loader, X } from 'lucide-react';
import {
  fidelityDescription,
  fidelityLabel,
  type ConvertNoticeState,
  type ConvertProgressState,
} from '../state/convert';

export interface ConversionNoticeProps {
  notice: ConvertNoticeState;
  /** Dismiss for the session; the tab stays open. */
  onDismiss?: () => void;
}

export function ConversionNotice(props: ConversionNoticeProps): ReactElement {
  const { notice, onDismiss } = props;
  const { warnings } = notice;
  return (
    <div
      className="conversion-notice"
      role="note"
      aria-label="Imported document"
      data-conversion-notice
      data-conversion-fidelity={notice.fidelity}
      data-conversion-degraded={notice.fidelity === 'degraded' ? '' : undefined}
      data-conversion-warning-count={warnings.length}
    >
      <FileText size={18} aria-hidden className="conversion-notice-icon" />
      <div className="conversion-notice-body">
        <p className="conversion-notice-title">
          Imported
          <span className="conversion-notice-source" data-conversion-source>
            {notice.sourceLabel}
          </span>
          <span
            className={`conversion-notice-fidelity conversion-notice-fidelity--${notice.fidelity}`}
            data-conversion-fidelity-label
          >
            {fidelityLabel(notice.fidelity)}
          </span>
        </p>
        <p className="conversion-notice-fidelity-note" data-conversion-fidelity-note>
          {fidelityDescription(notice.fidelity)}
        </p>
        {warnings.length > 0 && (
          <ul className="conversion-notice-warnings" data-conversion-warnings>
            {warnings.map((warning, index) => (
              <li
                className="conversion-notice-warning"
                key={`${warning.code}-${index}`}
                data-conversion-warning={warning.code}
              >
                <span className="conversion-notice-warning-message">
                  {warning.message}
                </span>
                {warning.detail !== undefined && warning.detail !== '' && (
                  <span
                    className="conversion-notice-warning-detail"
                    data-conversion-warning-detail
                  >
                    {warning.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          className="conversion-notice-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss conversion notice"
          data-conversion-dismiss
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export interface ConversionProgressProps {
  progress: ConvertProgressState;
  /** Cancel the in-flight conversion. Receives the docId (the job id). */
  onCancel: (docId: string) => void;
}

export function ConversionProgress(props: ConversionProgressProps): ReactElement {
  const { progress, onCancel } = props;
  const hasRatio = typeof progress.ratio === 'number';
  const percent = hasRatio ? Math.max(0, Math.min(100, Math.round(progress.ratio! * 100))) : null;
  return (
    <div
      className="conversion-progress"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-conversion-progress
      data-conversion-job={progress.docId}
    >
      <Loader size={16} aria-hidden className="conversion-progress-icon" />
      <div className="conversion-progress-body">
        <p className="conversion-progress-phase" data-conversion-phase>
          Importing — {progress.phase}
        </p>
        <div
          className="conversion-progress-track"
          data-conversion-ratio={hasRatio ? String(progress.ratio) : undefined}
        >
          <div
            className={
              hasRatio
                ? 'conversion-progress-bar'
                : 'conversion-progress-bar conversion-progress-bar--indeterminate'
            }
            style={hasRatio ? { width: `${percent}%` } : undefined}
          />
        </div>
      </div>
      <button
        type="button"
        className="conversion-progress-cancel"
        onClick={(): void => onCancel(progress.docId)}
        data-conversion-cancel
      >
        Cancel
      </button>
    </div>
  );
}
