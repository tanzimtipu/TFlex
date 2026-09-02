// Phase 11 — OCR suspects panel.
//
// Lists the low-confidence words the engine returned from the most
// recent `ocrRecognize` run on the active document. Rendered as a
// TOP BAR over the workspace (B4): the previous right-side rail
// overlay sat at z-index 29, just below the Tools palette (30) in
// the same right-rail position, so an open palette covered the
// suspect entries and the panel was unusable. As a full-width bar
// at the top of the workspace (z-index 40, above the palette) the
// panel is never covered; the suspect list scrolls horizontally.
//
// Each entry shows:
//   - the word text (with the confidence percentage next to it)
//   - the page number the word lives on
//   - a confidence bar (visual; colour-coded against the 60% threshold
//     the engine uses internally — see SUSPECT_CONFIDENCE_THRESHOLD in
//     `src/main/services/ocr.ts`).
//
// Clicking an entry navigates to the suspect's page and pulses a
// short-lived highlight overlay so the user can spot the word on
// the page. The panel never edits the suspect text — that's the
// documented Phase 11 limitation (correction is not in contract).

import type { ReactElement } from 'react';
import { ScanText, X } from 'lucide-react';
import type { OcrSuspect } from '../../shared/types';
import { SUSPECT_CONFIDENCE_THRESHOLD } from '../../shared/types';

export interface OcrSuspectsPanelProps {
  /** Low-confidence words from the most recent OCR run on the
   *  active doc. Empty array when no OCR has run yet OR when the
   *  active doc's OCR run produced no low-confidence words. */
  suspects: readonly OcrSuspect[];
  /** True when the active doc has had at least one OCR run (so the
   *  panel can render the "no suspects" empty state vs the "run
   *  OCR first" empty state). */
  hasRun: boolean;
  /** Navigate to the suspect's page + emit a short-lived highlight
   *  pulse so the user can spot the word on the page. Called when
   *  the user clicks an entry. */
  onNavigate: (suspect: OcrSuspect) => void;
  /** Close the panel (the host owns open/close state). */
  onClose: () => void;
}

export function OcrSuspectsPanel(props: OcrSuspectsPanelProps): ReactElement {
  const { suspects, hasRun, onNavigate, onClose } = props;
  // Group suspects by page so the list reads top-to-bottom through
  // the document. Stable order (insertion order on the engine's
  // output) within each page.
  const grouped = groupByPage(suspects);
  const totalPages = grouped.length;
  return (
    <aside
      className="ocr-suspects-panel"
      role="complementary"
      aria-label="OCR suspects"
      data-ocr-suspects-panel
    >
      <header className="ocr-suspects-header">
        <span className="ocr-suspects-title">
          <ScanText size={13} aria-hidden />
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
          <X size={13} aria-hidden />
        </button>
      </header>
      <div className="ocr-suspects-body">
        {hasRun && suspects.length === 0 && (
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
      </div>
    </aside>
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