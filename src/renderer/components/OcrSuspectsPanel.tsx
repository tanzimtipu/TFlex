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
// TFL-1116 C12 (R18/R19) — review polish + bounded rendering:
//   - R18: the header names the suspect COUNT and the page grouping; rows keep
//     stable word / confidence columns; the row the user navigated to stays
//     visibly SELECTED; and navigation hands the engine's REAL word rect (page
//     points) to the host AND exposes it on the row, so the highlight consumes
//     the actual bounds instead of guessing a target. Correction / accept / skip
//     are NOT offered — the engine has no such operation — so the surface is
//     labelled navigation-only honestly.
//   - R19: a noisy scan produced 3708 suspects, all mounted (the accessibility
//     tree exposed thousands of children). Above
//     `OCR_SUSPECT_WINDOW_THRESHOLD` the panel renders a BOUNDED window of the
//     flattened page/row stream with stable keys and listbox semantics, so only
//     the visible slice mounts. The measured 3708 / 10000 profiles live in
//     `test/unit/renderer/tfl1116_ocrPerf.test.ts`.
//
// Each entry shows the word, its page, and a colour-coded confidence bar
// against the 60% engine threshold (SUSPECT_CONFIDENCE_THRESHOLD). Clicking an
// entry navigates to the suspect's page and highlights the selected row. The
// panel never edits text (correction is out of contract).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import type { OcrSuspect } from '../../shared/types';
import { SUSPECT_CONFIDENCE_THRESHOLD } from '../../shared/types';
import { TfBarTop } from './motion/TfMotion';
import {
  FALLBACK_VIEWPORT_H,
  OCR_SUSPECT_ROW_H,
  OCR_SUSPECT_WINDOW_THRESHOLD,
  computeWindowRange,
  flattenSuspectItems,
  formatSuspectBounds,
  groupByPage,
  suspectAtIndex,
  suspectOptionId,
  type GroupedPage,
} from './ocrSuspectsModel';

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

export type OcrSuspectsLayout = NonNullable<OcrSuspectsPanelProps['layout']>;

export function OcrSuspectsPanel(props: OcrSuspectsPanelProps): ReactElement {
  const { suspects, hasRun, onNavigate, onClose, layout = 'bar' } = props;
  const grouped = useMemo(() => groupByPage(suspects), [suspects]);
  const totalPages = grouped.length;
  const flatSuspects = useMemo(
    () => grouped.flatMap((page) => page.entries),
    [grouped],
  );
  const indexOf = useMemo(() => {
    const map = new Map<OcrSuspect, number>();
    flatSuspects.forEach((entry, index) => map.set(entry, index));
    return map;
  }, [flatSuspects]);

  // R18 — the navigated-to row stays visibly selected. Selection is keyed by
  // the flat suspect index, which is stable for a given suspect list.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    setSelectedIndex((prev) =>
      prev !== null && prev >= flatSuspects.length ? null : prev,
    );
  }, [flatSuspects.length]);

  const onSelect = (suspect: OcrSuspect, index: number): void => {
    setSelectedIndex(index);
    onNavigate(suspect);
  };

  const bounded = suspects.length > OCR_SUSPECT_WINDOW_THRESHOLD;

  const header = (
    <header className="ocr-suspects-header">
      <span className="ocr-suspects-title">
        <Icon name="recognizeText" size="sm" />
        OCR suspects
      </span>
      <div className="ocr-suspects-summary" aria-live="polite">
        {hasRun ? (
          <>
            <span
              className="ocr-suspects-count"
              data-ocr-suspect-count={suspects.length}
            >
              <strong className="ocr-suspects-count-value">{suspects.length}</strong>{' '}
              low-confidence {suspects.length === 1 ? 'word' : 'words'}
            </span>
            {totalPages > 1 && (
              <span className="ocr-suspects-pages">
                across {totalPages} pages
              </span>
            )}
          </>
        ) : (
          <span>Run OCR on this document to populate suspects.</span>
        )}
      </div>
      <IconButton
        label="Close OCR suspects panel"
        intent="tertiary"
        kind="action"
        density="standard"
        className="ocr-suspects-close"
        onClick={onClose}
        icon={<Icon icon={X} size="sm" />}
      />
    </header>
  );

  const hasEntries = hasRun && suspects.length > 0;
  const list = bounded ? (
    <VirtualSuspectList
      grouped={grouped}
      flatCount={flatSuspects.length}
      indexOf={indexOf}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
    />
  ) : (
    <SuspectGroups
      grouped={grouped}
      hasRun={hasRun}
      indexOf={indexOf}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
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
          {hasEntries && (
            <>
              <div
                className="ocr-suspects-columns"
                data-ocr-suspects-columns
                aria-hidden
              >
                <span className="ocr-suspects-col-word">Word</span>
                <span className="ocr-suspects-col-confidence">Confidence</span>
              </div>
              <p className="ocr-suspects-note" data-ocr-suspects-navigation-only>
                Navigation only. The OCR engine does not support correcting
                words here.
              </p>
            </>
          )}
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

/** The grouped list body for small lists. Every page renders its own section
 *  with a header and a `<ul>` of rows — the exact DOM the Phase 11 / Phase 51
 *  tests pin. */
function SuspectGroups(props: {
  grouped: readonly GroupedPage[];
  hasRun: boolean;
  indexOf: ReadonlyMap<OcrSuspect, number>;
  selectedIndex: number | null;
  onSelect: (suspect: OcrSuspect, index: number) => void;
}): ReactElement {
  const { grouped, hasRun, indexOf, selectedIndex, onSelect } = props;
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
          <PageHeading page={page.page} count={page.entries.length} />
          <ul className="ocr-suspects-list">
            {page.entries.map((entry) => {
              const index = indexOf.get(entry) ?? -1;
              const selected = index >= 0 && index === selectedIndex;
              return (
                <li
                  key={`r:${entry.page}:${index}`}
                  className={
                    selected
                      ? 'ocr-suspects-entry ocr-suspects-entry-selected'
                      : 'ocr-suspects-entry'
                  }
                  data-ocr-suspect-selected={selected ? 'true' : undefined}
                >
                  <SuspectButton
                    suspect={entry}
                    selected={selected}
                    onSelect={(): void => onSelect(entry, index)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** R19 — the bounded window. The page/row stream is flattened, only the
 *  `[start, end)` slice mounts between two spacers, and the listbox owns
 *  keyboard navigation (Up/Down) over the WHOLE list, not just the window. */
function VirtualSuspectList(props: {
  grouped: readonly GroupedPage[];
  flatCount: number;
  indexOf: ReadonlyMap<OcrSuspect, number>;
  selectedIndex: number | null;
  onSelect: (suspect: OcrSuspect, index: number) => void;
}): ReactElement {
  const { grouped, flatCount, indexOf, selectedIndex, onSelect } = props;
  const items = useMemo(() => flattenSuspectItems(grouped), [grouped]);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT_H);

  useEffect(() => {
    const el = windowRef.current;
    if (el === null) return undefined;
    const measure = (): void => {
      setViewportH(el.clientHeight > 0 ? el.clientHeight : FALLBACK_VIEWPORT_H);
    };
    measure();
    window.addEventListener('resize', measure);
    return (): void => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Keep the selected row inside the window when selection moves by keyboard.
  useEffect(() => {
    const el = windowRef.current;
    if (el === null || selectedIndex === null) return;
    const suspect = suspectAtIndex(grouped, selectedIndex);
    if (suspect === null) return;
    const itemIndex = items.findIndex(
      (item) => item.kind === 'row' && item.suspect === suspect,
    );
    if (itemIndex < 0) return;
    const top = itemIndex * OCR_SUSPECT_ROW_H;
    const bottom = top + OCR_SUSPECT_ROW_H;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }, [selectedIndex, items, grouped]);

  const { start, end } = computeWindowRange(scrollTop, viewportH, items.length);
  const visible = items.slice(start, end);
  const topPad = start * OCR_SUSPECT_ROW_H;
  const bottomPad = Math.max(0, (items.length - end) * OCR_SUSPECT_ROW_H);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (flatCount === 0) return;
    event.preventDefault();
    const dir = event.key === 'ArrowDown' ? 1 : -1;
    const base =
      selectedIndex === null ? (dir === 1 ? -1 : flatCount) : selectedIndex;
    const next = Math.max(0, Math.min(flatCount - 1, base + dir));
    const suspect = suspectAtIndex(grouped, next);
    if (suspect !== null) onSelect(suspect, next);
  };

  const label = `OCR suspects: ${flatCount} low-confidence ${
    flatCount === 1 ? 'word' : 'words'
  } across ${grouped.length} ${grouped.length === 1 ? 'page' : 'pages'}`;

  return (
    <div
      ref={windowRef}
      className="ocr-suspects-window"
      role="listbox"
      aria-label={label}
      aria-activedescendant={
        selectedIndex !== null && selectedIndex >= 0
          ? suspectOptionId(selectedIndex)
          : undefined
      }
      tabIndex={0}
      data-ocr-suspects-window
      onScroll={(event): void => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      {topPad > 0 && (
        <div
          className="ocr-suspects-window-spacer"
          style={{ height: topPad }}
          aria-hidden
        />
      )}
      {visible.map((item) => {
        if (item.kind === 'page') {
          return (
            <div
              key={item.key}
              className="ocr-suspects-page ocr-suspects-page-virtual"
              data-ocr-suspects-page={item.page}
              role="presentation"
            >
              <PageHeading page={item.page} count={item.pageCount} />
            </div>
          );
        }
        const suspect = item.suspect;
        if (suspect === null) return null;
        const index = indexOf.get(suspect) ?? -1;
        const selected = index >= 0 && index === selectedIndex;
        return (
          <div
            key={item.key}
            id={index >= 0 ? suspectOptionId(index) : undefined}
            className={
              selected
                ? 'ocr-suspects-virtual-row ocr-suspects-entry-selected'
                : 'ocr-suspects-virtual-row'
            }
            role="option"
            aria-selected={selected}
            aria-setsize={flatCount}
            aria-posinset={index + 1}
            data-ocr-suspect-selected={selected ? 'true' : undefined}
          >
            <SuspectButton
              suspect={suspect}
              selected={selected}
              focusable={false}
              onSelect={(): void => {
                if (index >= 0) onSelect(suspect, index);
              }}
            />
          </div>
        );
      })}
      {bottomPad > 0 && (
        <div
          className="ocr-suspects-window-spacer"
          style={{ height: bottomPad }}
          aria-hidden
        />
      )}
      {flatCount === 0 && (
        <div className="ocr-suspects-empty" data-ocr-suspects-empty>
          <span>No low-confidence words — recognition looks clean.</span>
        </div>
      )}
    </div>
  );
}

function PageHeading({ page, count }: { page: number; count: number }): ReactElement {
  return (
    <header className="ocr-suspects-page-header">
      <span className="ocr-suspects-page-label">Page {page}</span>
      <span className="ocr-suspects-page-count">
        {count} {count === 1 ? 'word' : 'words'}
      </span>
    </header>
  );
}

/** One suspect row's button. Shared by both layouts so the word / confidence
 *  columns, the confidence bar and every `data-ocr-suspect-*` hook are
 *  identical wherever a row renders. */
function SuspectButton(props: {
  suspect: OcrSuspect;
  selected: boolean;
  onSelect: () => void;
  focusable?: boolean;
}): ReactElement {
  const { suspect, selected, onSelect, focusable = true } = props;
  const low = suspect.confidence < SUSPECT_CONFIDENCE_THRESHOLD;
  const bounds = formatSuspectBounds(suspect);
  return (
    <Button
      intent="tertiary"
      kind="action"
      density="compact"
      className="ocr-suspects-entry-btn"
      onClick={onSelect}
      tabIndex={focusable ? 0 : -1}
      title={`Navigate to page ${suspect.page} — word bounds ${bounds} pt`}
      aria-current={selected ? 'true' : undefined}
      data-ocr-suspect-word={suspect.word}
      data-ocr-suspect-page={suspect.page}
      data-ocr-suspect-bounds={bounds}
      data-ocr-suspect-confidence={suspect.confidence.toFixed(0)}
    >
      <span className="ocr-suspects-word">{suspect.word}</span>
      <span className="ocr-suspects-confidence">
        <span
          className={
            low
              ? 'ocr-suspects-confidence-bar ocr-suspects-confidence-low'
              : 'ocr-suspects-confidence-bar'
          }
          aria-hidden
        >
          <span
            style={{
              width: `${Math.max(0, Math.min(100, suspect.confidence))}%`,
            }}
          />
        </span>
        <span className="ocr-suspects-confidence-label">
          {suspect.confidence.toFixed(0)}%
        </span>
      </span>
    </Button>
  );
}

