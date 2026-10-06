// Phase 53 (feature I) — the conversion surfaces.
//
// `ConversionNotice` is the rounded, animated card shown above the canvas
// after a non-PDF file is imported: the source format label, the fidelity in
// plain words, and EVERY warning (message + optional detail) always visible —
// never behind a hover. Phase 67 (feature A) gives it the Phase 59 protection
// behaviour: it auto-collapses after a short reading pause into a floating "i"
// (info) icon and can be re-expanded / collapsed by the user, the dwell
// resetting on every expand. `ConversionProgress` is the app-level affordance
// shown while a conversion runs, with a cancel control.
//
// Mirrors ProtectionNotice: a flow element in the pane's document column,
// role="note", data-* hooks for tests/e2e, Lucide icons only, no emoji. Motion
// comes from the shared tokens (see the .conversion-* rules in styles.css).

import type { ReactElement } from 'react';
import { ChevronUp, FileText, Info } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import { BrandLoader } from './BrandLoader';
import { useNoticeCollapse } from '../hooks/useNoticeCollapse';
import {
  fidelityDescription,
  fidelityLabel,
  type ConvertNoticeState,
  type ConvertProgressState,
} from '../state/convert';

export interface ConversionNoticeProps {
  notice: ConvertNoticeState;
  /** Retained for the existing call site. Phase 67 (feature A) repurposed the
   *  card's control from "dismiss for the session" to a collapse: the notice
   *  now stays available through the collapsed "i", so this callback is no
   *  longer invoked. */
  onDismiss?: () => void;
}

export function ConversionNotice(props: ConversionNoticeProps): ReactElement {
  const { notice } = props;
  const { warnings } = notice;
  const { phase, collapse, expand } = useNoticeCollapse();

  // Phase 78 (DEF-465) — `entering` is the icon-first frame: it renders the
  // collapsed "i" exactly like `collapsed`, then the hook commits `expanded`.
  if (phase === 'collapsed' || phase === 'entering') {
    return (
      <div
        className="conversion-notice-region"
        data-conversion-notice-state={phase}
      >
        <IconButton
          label="Show conversion notice"
          intent="secondary"
          kind="disclosure"
          density="compact"
          className="conversion-notice-collapsed-toggle"
          onClick={expand}
          data-conversion-icon
          icon={<Icon icon={Info} size="sm" />}
        />
      </div>
    );
  }

  return (
    <div
      className={
        phase === 'closing'
          ? 'conversion-notice conversion-notice--leaving'
          : 'conversion-notice'
      }
      role="note"
      aria-label="Imported document"
      data-conversion-notice
      data-conversion-notice-state={phase}
      data-conversion-fidelity={notice.fidelity}
      data-conversion-degraded={notice.fidelity === 'degraded' ? '' : undefined}
      data-conversion-warning-count={warnings.length}
    >
      <Icon icon={FileText} size="md" className="conversion-notice-icon" />
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
      <IconButton
        label="Collapse conversion notice"
        intent="tertiary"
        kind="disclosure"
        density="compact"
        className="conversion-notice-collapse"
        onClick={collapse}
        data-conversion-collapse
        icon={<Icon icon={ChevronUp} size="xs" />}
      />
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
      <BrandLoader className="conversion-progress-icon" />
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
      <Button
        intent="secondary"
        kind="action"
        density="compact"
        className="conversion-progress-cancel"
        onClick={(): void => onCancel(progress.docId)}
        data-conversion-cancel
      >
        Cancel
      </Button>
    </div>
  );
}
