// Phase 87 / C2 (FEA-039) — Remove blank pages dialog.
//
// Pure UI shell: it owns no engine state. The host (App) owns the scan
// lifecycle, the measurements and the removal call; this dialog renders the
// scan controls, the candidate list and the report, and reports the user's
// choices through its callbacks. Nothing here talks to the engine.

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { classifyPages } from "../../shared/blankPages";
import type { BlankPageMeasurement } from "../../shared/types";
import { DialogShell, type DialogAction } from "./DialogShell";

export interface BlankPagesDialogProps {
  open: boolean;
  totalPages: number;
  threshold: number;
  running: boolean;
  /** Last scanned 1-based page; 0 when idle. */
  progress: number;
  /** null before the first scan. */
  measurements: BlankPageMeasurement[] | null;
  /** Set by App after a removal run or an engine error; rendered verbatim. */
  report?: string | null;
  onThresholdChange: (value: number) => void;
  onRun: () => void;
  onConfirm: (pages: number[]) => void;
  onClose: () => void;
}

export function BlankPagesDialog(
  props: BlankPagesDialogProps,
): ReactElement | null {
  const {
    open,
    totalPages,
    threshold,
    running,
    progress,
    measurements,
    report = null,
    onThresholdChange,
    onRun,
    onConfirm,
    onClose,
  } = props;

  const { candidates, unclassified } = useMemo(
    () => classifyPages(measurements ?? [], threshold),
    [measurements, threshold],
  );

  // The checked set defaults to EVERY candidate and resets whenever a fresh
  // measurements array arrives (a new scan). A threshold tweak re-classifies
  // but never discards the user's picks, so the deps stay measurements-only.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => {
    const defaultPages = classifyPages(measurements ?? [], threshold).candidates.map(
      (c) => c.page,
    );
    setChecked(new Set(defaultPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements]);

  // The user's picks are filtered against the CURRENT candidate set. Tightening
  // the threshold can drop a previously-checked page from the candidates;
  // effectiveChecked guarantees the confirm control can never act on a page
  // that is no longer eligible (DEF-502).
  const effectiveChecked = useMemo(
    () =>
      new Set(
        [...checked].filter((page) =>
          candidates.some((candidate) => candidate.page === page),
        ),
      ),
    [checked, candidates],
  );

  // The threshold field keeps a raw string while the user types, so intermediate
  // values such as "0." survive a keystroke. Parsing and clamping to [0, 1]
  // happens on blur / Enter only.
  const [thresholdInput, setThresholdInput] = useState<string>(String(threshold));
  useEffect(() => {
    setThresholdInput(String(threshold));
  }, [threshold]);

  const commitThreshold = (): void => {
    const parsed = Number(thresholdInput);
    const clamped = Number.isFinite(parsed)
      ? Math.min(1, Math.max(0, parsed))
      : threshold;
    onThresholdChange(clamped);
    setThresholdInput(String(clamped));
  };

  const toggle = (page: number): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const onConfirmClick = (): void => {
    onConfirm([...effectiveChecked].sort((a, b) => a - b));
  };

  const showReport = measurements !== null || report !== null;
  const reportText =
    report !== null
      ? report
      : candidates.length === 0 && unclassified.length === 0
        ? "No blank pages found."
        : `${candidates.length} candidate pages, ${unclassified.length} unclassified`;

  const actions: DialogAction[] = [
    {
      key: "close",
      label: "Close",
      variant: "secondary",
      onClick: onClose,
    },
    Object.assign(
      {
        key: "remove",
        label: `Remove ${effectiveChecked.size} selected`,
        variant: "danger" as const,
        onClick: onConfirmClick,
        disabled: running || effectiveChecked.size === 0,
        default: true,
      },
      { "data-blank-scan-confirm": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Remove blank pages"
      titleId="blank-pages-dialog-title"
      onClose={onClose}
      actions={actions}
      data-blank-pages-dialog
    >
              <p className="modal-help">
                Scan every page for a near-empty ink coverage, review the
                candidates, then remove the ones you select. Removals are
                undoable.
              </p>

              <label className="modal-field">
                <span>Ink threshold</span>
                <input
                  type="number"
                  className="modal-input"
                  min={0}
                  max={1}
                  step={0.001}
                  value={thresholdInput}
                  data-blank-scan-threshold
                  disabled={running}
                  onChange={(e): void => setThresholdInput(e.target.value)}
                  onBlur={commitThreshold}
                  onKeyDown={(e): void => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitThreshold();
                    }
                  }}
                />
                <span className="modal-hint">
                  Pages at or below this ink fraction are treated as blank.
                </span>
              </label>

              <div className="context-panel-actions-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-blank-scan-run
                  onClick={onRun}
                  disabled={running || totalPages === 0}
                >
                  Scan for blank pages
                </button>
                {running && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-blank-scan-cancel
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {running && (
                <div className="modal-status" data-blank-scan-progress>
                  Scanning page {progress} of {totalPages}
                </div>
              )}

              {candidates.length > 0 && (
                <ul className="blank-scan-candidates">
                  {candidates.map((candidate) => (
                    <li key={candidate.page} data-blank-candidate={candidate.page}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked.has(candidate.page)}
                          onChange={(): void => toggle(candidate.page)}
                        />
                        <span>
                          Page {candidate.page} - {(candidate.coverage * 100).toFixed(2)}% ink
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {showReport && (
                <div className="modal-status" data-blank-scan-report>
                  {reportText}
                  {report === null &&
                    unclassified.map((entry) => (
                      <div key={entry.page}>
                        Page {entry.page}: {entry.reason}
                      </div>
                    ))}
                </div>
              )}
    </DialogShell>
  );
}
