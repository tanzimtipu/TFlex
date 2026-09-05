// Phase 8 — Optimize dialog (file size reduction).
//
// A preset selector (none / compact / max) plus a live
// before/after file-size comparison (the FFT — frequency / size
// comparison the spec calls out). The user's choice of preset
// persists in AppSettings.optimizePreset; the dialog opens with
// that preset selected so the workflow round-trips across launches.
//
// The dialog is purely a UI shell: it asks the engine to optimise
// the active doc, gets back fresh PDF bytes, and hands them to
// the same `openFromBytes` flow that split/extract use. The
// original tab is untouched (the engine's `optimize` is read-only
// — it never touches the undo stack or the modified flag).
//
// "Before" is read from the active tab's on-disk file size when
// available (recent files / open-from-disk) or from
// `activeDocBytes` (the renderer-tracked size for samples and
// split-output tabs). "After" is the size of the returned
// optimised bytes. Both are surfaced in the dialog so the user
// can see the win at a glance before they Save-As the new tab.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import type { OptimizePreset, SpaceAudit } from '../../shared/types';
import { DEFAULT_OPTIMIZE_PRESET, OPTIMIZE_PRESETS } from '../state/preferences';
import { formatBytes } from '../utils/formatBytes';
import { useBackdropClose } from './modalBackdrop';
import { AnimatePresence } from 'motion/react';
import { TfBackdrop, TfDialog } from './motion/TfMotion';

interface OptimizeDialogProps {
  open: boolean;
  /** Currently selected preset (mirrors AppSettings.optimizePreset). */
  initialPreset: OptimizePreset;
  /** Active document's current byte size — used as the "Before"
   *  baseline in the FFT comparison. Zero / negative for unknown. */
  originalBytes: number;
  /** Run the engine.optimize action. Returns the new bytes (or an
   *  error). The dialog does not own the bytes — it hands them to
   *  the parent, which decides whether to open them as a tab. */
  runOptimize: (preset: OptimizePreset) => Promise<{ bytes: ArrayBuffer; size: number } | { error: string }>;
  /** Run the engine.auditSpace action. Read-only. Returns the
   *  audit so the dialog can show a one-line "biggest category" hint
   *  next to the preset selector. Optional — when the backend
   *  doesn't support audit (stub fallback or pre-Phase-8 build) the
   *  dialog degrades to the FFT comparison only. */
  runAuditSpace?: () => Promise<SpaceAudit | { error: string }>;
  /** Called when the user confirms the preset selection and the
   *  optimisation has finished. The parent receives the resulting
   *  bytes to open as a new tab. */
  onConfirm: (preset: OptimizePreset, bytes: ArrayBuffer) => void;
  /** DEF-039 — fires whenever the user picks a different preset in
   *  the radio group. The host persists the choice to AppSettings so
   *  the dialog opens with the same selection on next launch. The
   *  reducer is idempotent, so calling it on every radio toggle (even
   *  when the choice reverts to the existing one) is safe — the
   *  persist path no-ops on equal values. Optional for backward
   *  compatibility with callers that don't yet persist preset choices. */
  onOptimizePresetChange?: (preset: OptimizePreset) => void;
  onClose: () => void;
}

interface PresetOption {
  preset: OptimizePreset;
  label: string;
  description: string;
}

/** Render-side preset metadata. Kept here (not in shared/) because
 *  the labels are UI copy. The engine's optimise pipeline is the
 *  source of truth for the actual compression behaviour. */
const PRESET_OPTIONS: readonly PresetOption[] = [
  {
    preset: 'none',
    label: 'No compression',
    description: 'Linearized output. No metadata strip. Fastest pass; smallest reduction.',
  },
  {
    preset: 'compact',
    label: 'Compact',
    description: 'Compresses object streams. Default for most documents.',
  },
  {
    preset: 'max',
    label: 'Maximum',
    description: 'Compresses object streams and strips document Info (title, author, ...).',
  },
];

/** Look up the friendly label / description for a preset, falling
 *  back to a generic label if a future preset is added on the
 *  backend without a matching UI entry. */
function describePreset(p: OptimizePreset): PresetOption {
  return PRESET_OPTIONS.find((opt) => opt.preset === p) ?? {
    preset: p,
    label: p,
    description: '',
  };
}

export function OptimizeDialog(props: OptimizeDialogProps): ReactElement | null {
  const { open, initialPreset, originalBytes, runOptimize, runAuditSpace, onConfirm, onOptimizePresetChange, onClose } = props;
  const [preset, setPreset] = useState<OptimizePreset>(initialPreset);
  const [running, setRunning] = useState(false);
  const [optimizedSize, setOptimizedSize] = useState<number | null>(null);
  const [audit, setAudit] = useState<SpaceAudit | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset state every time the dialog re-opens. The optimised-size
  // result must NOT survive across opens — the active doc may have
  // changed in the meantime.
  useEffect(() => {
    if (!open) return;
    setPreset(initialPreset);
    setRunning(false);
    setOptimizedSize(null);
    setAudit(null);
    setAuditError(null);
    setEngineError(null);
  }, [open, initialPreset]);

  // Esc closes; focus the first interactive control on open.
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
      'input, button, [tabindex]',
    );
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Best-effort audit fetch on open so the "biggest category" hint
  // appears before the user even picks a preset. Errors are
  // surfaced silently into a one-line hint (the audit is purely
  // informational).
  useEffect(() => {
    if (!open || runAuditSpace === undefined) return;
    let cancelled = false;
    void runAuditSpace().then((res) => {
      if (cancelled) return;
      if ('error' in res) {
        setAuditError(res.error);
        setAudit(null);
        return;
      }
      setAudit(res);
      setAuditError(null);
    }).catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [open, runAuditSpace]);

  const reduction = useMemo<{
    delta: number;
    percent: number | null;
  }>(() => {
    if (originalBytes <= 0 || optimizedSize === null) {
      return { delta: 0, percent: null };
    }
    const delta = originalBytes - optimizedSize;
    const percent = (delta / originalBytes) * 100;
    return { delta, percent };
  }, [originalBytes, optimizedSize]);

  const biggestCategory = useMemo<{ name: string; bytes: number; percent: number } | null>(() => {
    if (audit === null) return null;
    const cats: Array<{ name: string; bytes: number }> = [
      { name: 'Images', bytes: audit.breakdown.images },
      { name: 'Fonts', bytes: audit.breakdown.fonts },
      { name: 'Content streams', bytes: audit.breakdown.contentStreams },
      { name: 'Metadata', bytes: audit.breakdown.metadata },
      { name: 'Other', bytes: audit.breakdown.other },
    ];
    let top = cats[0];
    for (const c of cats) if (top === undefined || c.bytes > top.bytes) top = c;
    if (top === undefined || audit.totalBytes <= 0) return null;
    return { name: top.name, bytes: top.bytes, percent: (top.bytes / audit.totalBytes) * 100 };
  }, [audit]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the preset picker / inputs must not
  // dismiss).
  const backdrop = useBackdropClose(onClose);

  

  const onConfirmClick = async (): Promise<void> => {
    setRunning(true);
    setEngineError(null);
    try {
      const result = await runOptimize(preset);
      if ('error' in result) {
        setEngineError(result.error);
        setRunning(false);
        return;
      }
      setOptimizedSize(result.size);
      setRunning(false);
      onConfirm(preset, result.bytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEngineError(msg);
      setRunning(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
      <TfDialog
        className="modal-dialog dialog optimize-dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="optimize-dialog-title"
      >
        <div className="modal-header">
          <h2 id="optimize-dialog-title" className="modal-title">
            Reduce file size
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Re-serialises the document with a chosen compression preset and opens the
            result as a new tab so you can inspect it before saving. The original tab is
            not modified.
          </p>

          <fieldset
            className="modal-position optimize-preset"
            role="radiogroup"
            aria-label="Optimization preset"
          >
            <legend>Optimization preset</legend>
            {PRESET_OPTIONS.map((opt) => (
              <label key={opt.preset} className="optimize-preset-option">
                <input
                  type="radio"
                  name="optimize-preset"
                  value={opt.preset}
                  checked={preset === opt.preset}
                  onChange={(): void => {
                    setPreset(opt.preset);
                    // DEF-039 — surface the new choice to the host so
                    // the host can persist it through the preferences
                    // reducer. We fire on every radio toggle (not
                    // just on confirm) so the choice survives even if
                    // the user dismisses the dialog without clicking
                    // "Reduce and open as new tab". The reducer's
                    // equality guard short-circuits no-op writes, so
                    // toggling back to the existing preset is a
                    // constant-time operation.
                    onOptimizePresetChange?.(opt.preset);
                  }}
                  data-optimize-preset={opt.preset}
                  aria-label={describePreset(opt.preset).label}
                />
                <span className="optimize-preset-text">
                  <span className="optimize-preset-label">{opt.label}</span>
                  <span className="optimize-preset-desc">{opt.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {audit !== null && (
            <div className="optimize-audit-hint" aria-live="polite">
              {biggestCategory !== null && (
                <span>
                  Largest category: <strong>{biggestCategory.name}</strong>{' '}
                  ({formatBytes(biggestCategory.bytes)}, {biggestCategory.percent.toFixed(1)}%
                  of {formatBytes(audit.totalBytes)})
                </span>
              )}
            </div>
          )}
          {audit === null && auditError !== null && (
            <div className="optimize-audit-hint" aria-live="polite">
              <span className="hint">Audit unavailable: {auditError}</span>
            </div>
          )}

          <section className="optimize-fft" aria-label="File size comparison">
            <header className="optimize-fft-header">
              <span className="optimize-fft-title">File size comparison</span>
            </header>
            <div className="optimize-fft-rows">
              <div className="optimize-fft-row" data-fft="before">
                <span className="optimize-fft-label">Before</span>
                <span className="optimize-fft-value" data-optimize-fft-before>
                  {originalBytes > 0 ? formatBytes(originalBytes) : '—'}
                </span>
              </div>
              <div className="optimize-fft-row" data-fft="after">
                <span className="optimize-fft-label">After ({describePreset(preset).label})</span>
                <span className="optimize-fft-value" data-optimize-fft-after>
                  {optimizedSize === null ? '—' : formatBytes(optimizedSize)}
                </span>
              </div>
              <div className="optimize-fft-row" data-fft="delta">
                <span className="optimize-fft-label">Reduction</span>
                <span
                  className={
                    reduction.percent === null
                      ? 'optimize-fft-value optimize-fft-muted'
                      : reduction.delta > 0
                        ? 'optimize-fft-value optimize-fft-positive'
                        : reduction.delta < 0
                          ? 'optimize-fft-value optimize-fft-negative'
                          : 'optimize-fft-value optimize-fft-muted'
                  }
                  data-optimize-fft-delta
                >
                  {reduction.percent === null
                    ? 'Run to see reduction'
                    : `${formatBytes(Math.abs(reduction.delta))} (${reduction.percent.toFixed(1)}%)`}
                </span>
              </div>
            </div>
          </section>

          {engineError !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>Engine error: {engineError}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(): void => {
              void onConfirmClick();
            }}
            disabled={running}
            data-optimize-confirm
          >
            {running ? 'Reducing…' : 'Reduce and open as new tab'}
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}

/** Re-export the default preset so other UI surfaces (e.g. the
 *  Preferences sheet's future Optimize section) can pull it from
 *  the same module. */
export { DEFAULT_OPTIMIZE_PRESET, OPTIMIZE_PRESETS };
