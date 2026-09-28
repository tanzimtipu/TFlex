// Phase 11 / Phase 51 (item 10) — OCR suspects panel.
//
// Lists the low-confidence words the engine returned from the most recent
// `ocrRecognize` run on the active document, grouped by page.
//
// Phase 51 (item 10) — the operator's screenshot showed the old top-bar layout
// as "scattered, overlapping"; the suspects UI now lives in the workspace
// Inspector (the right panel) as a proper vertical section, in the Inspector's
// own section chrome. The `layout` prop keeps ONE component with two shapes:
//   - 'inspector' (the product home): a section body, page-grouped rows aligned
//     word-left / confidence-right, no overlap.
//   - 'bar' (legacy/testing): the pre-Phase-51 horizontal top bar, retained so
//     the bar's own history and tests keep a working harness.
//
// Each entry shows the word, its page, and a colour-coded confidence bar
// against the 60% engine threshold (SUSPECT_CONFIDENCE_THRESHOLD). Clicking an
// entry navigates to the suspect's page and pulses a short highlight. The panel
// never edits text (correction is out of contract for Phase 11).

import type { ReactElement } from 'react';
import { ScanText, X } from 'lucide-react';
import type { OcrSuspect } from '../../shared/types';
import { SUSPECT_CONFIDENCE_THRESHOLD } from '../../shared/types';
import { TfBarTop } from './motion/TfMotion';

export interface OcrSuspectsPanelProps {
  /** Low-confidence words from the most recent OCR run on the active doc. */
  suspects: readonly OcrSuspect[];
  /** True when the active doc has had at least one OCR run. */
  hasRun: boolean;
  /** Navigate to the suspect's page + pulse a highlight. */
  onNavigate: (suspect: OcrSuspect) => void;
  /** Close / hide the panel (the host owns open/close state). */
  onClose: () => void;
  /** Phase 51 (item 10) — 'inspector' renders the vertical Inspector section
   *  (the product home); 'bar' renders the legacy horizontal top bar. Defaults
   *  to 'bar' so pre-Phase-51 mounts/tests keep their contract. */
  layout?: 'bar' | 'inspector';
}

export function OcrSuspectsPanel(props: OcrSuspectsPanelProps): ReactElement {
  const { suspects, hasRun, onNavigate, onClose, layout = 'bar' } = props;
  const grouped = groupByPage(suspects);
  const totalPages = grouped.length;

  const header = (
    <header className="ocr-suspects-header">
      <span className="ocr-suspects-title">
        <ScanText size={16} aria-hidden />
        OCR suspects
      </span>
      <div className="ocr-suspects-summary" aria-live="polite">
        {hasRun ? (
          <>
            <span>
              {suspects.length} low-confidence{' '}
              {suspects.length === 1 ? 'word' : 'words'}
            </span>
            {totalPages > 1 && (
              <span className="ocr-suspects-pages">across {totalPages} pages</span>
            )}
          </>
        ) : (
          <span>Run OCR on this document to populate suspects.</span>
        )}
      </div>
      <button
        type="button"
        className="ocr-suspects-close"
        onClick={onClose}
        aria-label="Close OCR suspects panel"
        title="Close"
      >
        <X size={16} aria-hidden />
      </button>
    </header>
  );

  const list = (
    <SuspectGroups
      grouped={grouped}
      hasRun={hasRun}
      onNavigate={onNavigate}
    />
  );

  if (layout === 'inspector') {
    return (
      <section
        className="inspector-section ocr-suspects-panel ocr-suspects-panel-inline"
        data-inspector-section="ocr-suspects"
        data-ocr-suspects-panel
        role="region"
        aria-label="OCR suspects"
      >
        {header}
        <div className="inspector-section-body ocr-suspects-body ocr-suspects-body-inline">
          {list}
        </div>
      </section>
    );
  }

  return (
    <TfBarTop
      className="ocr-suspects-panel"
      role="complementary"
      aria-label="OCR suspects"
      data-ocr-suspects-panel
    >
      {header}
      <div className="ocr-suspects-body">{list}</div>
    </TfBarTop>
  );
}

/** The grouped list body. Shared by both layouts so the word rows, page
 *  headers and data attributes are identical wherever it renders. */
function SuspectGroups(props: {
  grouped: readonly GroupedPage[];
  hasRun: boolean;
  onNavigate: (suspect: OcrSuspect) => void;
}): ReactElement {
  const { grouped, hasRun, onNavigate } = props;
  return (
    <>
      {hasRun && grouped.length === 0 && (
        <div className="ocr-suspects-empty" data-ocr-suspects-empty>
          <span>No low-confidence words — recognition looks clean.</span>
        </div>
      )}
      {!hasRun && (
        <div className="ocr-suspects-empty">
          <span>No OCR has been run on this document yet.</span>
        </div>
      )}
      {grouped.map((page) => (
        <section
          key={page.page}
          className="ocr-suspects-page"
          data-ocr-suspects-page={page.page}
        >
          <header className="ocr-suspects-page-header">
            <span className="ocr-suspects-page-label">Page {page.page}</span>
            <span className="ocr-suspects-page-count">
              {page.entries.length} {page.entries.length === 1 ? 'word' : 'words'}
            </span>
          </header>
          <ul className="ocr-suspects-list">
            {page.entries.map((entry, idx) => (
              <li
                key={`${entry.page}-${idx}-${entry.rect.x}-${entry.rect.y}`}
                className="ocr-suspects-entry"
              >
                <button
                  type="button"
                  className="ocr-suspects-entry-btn"
                  onClick={(): void => onNavigate(entry)}
                  title={`Navigate to page ${entry.page}`}
                  data-ocr-suspect-word={entry.word}
                >
                  <span className="ocr-suspects-word">{entry.word}</span>
                  <span className="ocr-suspects-confidence">
                    <span
                      className={
                        entry.confidence < SUSPECT_CONFIDENCE_THRESHOLD
                          ? 'ocr-suspects-confidence-bar ocr-suspects-confidence-low'
                          : 'ocr-suspects-confidence-bar'
                      }
                      aria-hidden
                    >
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(100, entry.confidence))}%`,
                        }}
                      />
                    </span>
                    <span className="ocr-suspects-confidence-label">
                      {entry.confidence.toFixed(0)}%
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

interface GroupedPage {
  page: number;
  entries: OcrSuspect[];
}

function groupByPage(suspects: readonly OcrSuspect[]): GroupedPage[] {
  const map = new Map<number, OcrSuspect[]>();
  for (const s of suspects) {
    const list = map.get(s.page);
    if (list === undefined) {
      map.set(s.page, [s]);
    } else {
      list.push(s);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, entries]) => ({ page, entries }));
}
