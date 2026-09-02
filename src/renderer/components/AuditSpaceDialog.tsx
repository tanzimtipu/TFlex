// Phase 8 — Audit Space dialog.
//
// A read-only dialog that shows the current document's per-element
// size breakdown: images, fonts, content streams, metadata, and
// other. Each category has a horizontal bar (proportional to its
// share of totalBytes) and a percentage label — the spec calls
// for a "pie or bar breakdown, percentages", and the bar layout
// reads cleanly in both light and dark themes while still showing
// proportions at a glance.
//
// The dialog fetches the audit when opened and on every retry
// (the retry button is shown when the engine returns an error).
// It does not modify the document — audit is purely informational.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { SpaceAudit } from '../../shared/types';
import { formatBytes } from '../utils/formatBytes';
import { useBackdropClose } from './modalBackdrop';

interface AuditSpaceDialogProps {
  open: boolean;
  /** Run the engine.auditSpace action. Returns the audit on success
   *  or an error message. The dialog handles its own loading and
   *  retry state. */
  runAuditSpace: () => Promise<SpaceAudit | { error: string }>;
  onClose: () => void;
}

interface CategoryRow {
  key: keyof SpaceAudit['breakdown'];
  label: string;
  hint: string;
}

const CATEGORIES: readonly CategoryRow[] = [
  { key: 'images', label: 'Images', hint: 'Embedded image streams (XObject /Image).' },
  { key: 'fonts', label: 'Fonts', hint: 'Embedded font data and font descriptors.' },
  { key: 'contentStreams', label: 'Content streams', hint: 'Page content streams (drawing operators).' },
  { key: 'metadata', label: 'Metadata', hint: 'Info dictionary and XMP metadata streams.' },
  { key: 'other', label: 'Other', hint: 'Catalog, page tree, cross-ref, and everything else.' },
];

const ACCENT_BY_KEY: Record<keyof SpaceAudit['breakdown'], string> = {
  images: 'var(--accent)',
  fonts: 'var(--accent-hover)',
  contentStreams: 'var(--fg-strong)',
  metadata: 'var(--fg-muted)',
  other: 'var(--fg-faint)',
};

export function AuditSpaceDialog(props: AuditSpaceDialogProps): ReactElement | null {
  const { open, runAuditSpace, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<SpaceAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await runAuditSpace();
      if ('error' in res) {
        setError(res.error);
        setAudit(null);
      } else {
        setAudit(res);
        setError(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setAudit(null);
    } finally {
      setLoading(false);
    }
  };

  // Reset on open + auto-fetch.
  useEffect(() => {
    if (!open) return;
    setAudit(null);
    setError(null);
    void refresh();
    // We intentionally do NOT depend on refresh (it's defined inline
    // above and changes every render — depending on it would loop the
    // effect on every render). The linter warning is a false positive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc closes; focus first interactive control on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button, [tabindex]',
    );
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the retry button / body must not dismiss).
  const backdrop = useBackdropClose(onClose);

  if (!open) return null;

  const total = audit?.totalBytes ?? 0;
  const rows = audit === null
    ? CATEGORIES.map((c) => ({
        ...c,
        bytes: 0,
        percent: 0,
      }))
    : CATEGORIES.map((c) => ({
        ...c,
        bytes: audit.breakdown[c.key],
        percent: total > 0 ? (audit.breakdown[c.key] / total) * 100 : 0,
      }));

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className="modal-dialog dialog audit-dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-dialog-title"
      >
        <div className="modal-header">
          <h2 id="audit-dialog-title" className="modal-title">
            Audit space usage
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Breakdown of the active document by element type. Read-only.
          </p>

          <section className="audit-summary" aria-label="Total size">
            <span className="audit-summary-label">Total</span>
            <span className="audit-summary-value" data-audit-total>
              {audit !== null ? formatBytes(total) : loading ? 'Counting…' : '—'}
            </span>
          </section>

          <div className="audit-bars" role="list">
            {rows.map((row) => (
              <div
                className="audit-bar"
                role="listitem"
                key={row.key}
                data-audit-category={row.key}
              >
                <div className="audit-bar-header">
                  <span className="audit-bar-label">{row.label}</span>
                  <span className="audit-bar-values">
                    <span className="audit-bar-bytes">{formatBytes(row.bytes)}</span>
                    <span className="audit-bar-percent" data-audit-percent={row.key}>
                      {audit !== null ? `${row.percent.toFixed(1)}%` : '—'}
                    </span>
                  </span>
                </div>
                <div className="audit-bar-track" aria-hidden>
                  <div
                    className="audit-bar-fill"
                    style={{
                      width: `${audit === null ? 0 : Math.min(100, Math.max(0, row.percent))}%`,
                      background: ACCENT_BY_KEY[row.key],
                    }}
                  />
                </div>
                <p className="audit-bar-hint">{row.hint}</p>
              </div>
            ))}
          </div>

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>Audit failed: {error}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(): void => {
              void refresh();
            }}
            disabled={loading}
            data-audit-refresh
          >
            <RefreshCw size={13} aria-hidden />
            <span style={{ marginLeft: 6 }}>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
