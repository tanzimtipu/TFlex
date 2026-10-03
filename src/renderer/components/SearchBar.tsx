import { ArrowDown, ArrowUp, Replace, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { useEffect, useRef } from 'react';
import { useIsPresent } from 'motion/react';
import { TfBar } from './motion/TfMotion';

interface SearchBarProps {
  query: string;
  onQuery: (q: string) => void;
  resultCount: number;
  activeIndex: number;
  searching: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Phase 86 (FEA-038) — the replace row is open. */
  replaceMode: boolean;
  /** Phase 86 — the current replacement text. */
  replacement: string;
  /** Phase 86 — the readable result of the last replace ("N replaced, M
   *  skipped" plus the first skip reason when any). */
  replaceReport: string;
  /** Phase 86 — toggle the replace row without touching the query. */
  onToggleReplace: () => void;
  /** Phase 86 — the replacement input changed. */
  onReplacement: (s: string) => void;
  /** Phase 86 — replace the ACTIVE occurrence. */
  onReplaceOne: () => void;
  /** Phase 86 — replace ALL occurrences in one call. */
  onReplaceAll: () => void;
}

export function SearchBar(props: SearchBarProps) {
  const {
    query,
    onQuery,
    resultCount,
    activeIndex,
    searching,
    onNext,
    onPrev,
    onClose,
    replaceMode,
    replacement,
    replaceReport,
    onToggleReplace,
    onReplacement,
    onReplaceOne,
    onReplaceAll,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Phase 20 / DEF-238 — while the bar EXITS it is inert, so the input
  // cannot keep DOM focus and Tab / assistive tech cannot reach the
  // pointer-disabled ghost window (ADV-054: 21 exit frames with
  // `inert:[false]`, focus stayed in the input).
  const isPresent = useIsPresent();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  let status = 'Type to search';
  if (trimmed.length > 0) {
    status = searching
      ? 'Searching...'
      : resultCount === 0
        ? 'No results'
        : `${activeIndex + 1} of ${resultCount}`;
  }

  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleReplaceKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onReplaceOne();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const canReplace = resultCount > 0;

  return (
    // Phase 20 — the search bar is a conditional chrome row of the same
    // floating-bar family as the edit toolbar (TfBar): token-driven
    // enter/exit (y -2 rise / reverse) with the exit frame pinning
    // pointer-events: none. Mounted inside an AnimatePresence in
    // DocumentView so the close actually animates.
    <TfBar
      className="search-bar"
      inert={!isPresent}
      // Phase 86 — the replace row and report wrap onto their own full-width
      // lines; the bar grows to fit them only while the replace row is open.
      style={replaceMode ? { height: 'auto', flexWrap: 'wrap' } : undefined}
    >
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Find in document"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={handleKey}
        aria-label="Search query"
      />
      <span className="search-status">{status}</span>
      <button
        type="button"
        className="btn btn-toolbar btn-toggle tool-btn"
        data-search-replace-toggle
        onClick={onToggleReplace}
        aria-pressed={replaceMode}
        aria-label="Toggle replace"
        title="Toggle replace"
      >
        <Icon icon={Replace} size="sm" />
      </button>
      <button
        type="button"
        className="btn btn-toolbar tool-btn"
        onClick={onPrev}
        disabled={resultCount === 0}
        title="Previous hit (Shift+Enter)"
        aria-label="Previous hit"
      >
        <Icon icon={ArrowUp} size="sm" />
      </button>
      <button
        type="button"
        className="btn btn-toolbar tool-btn"
        onClick={onNext}
        disabled={resultCount === 0}
        title="Next hit (Enter)"
        aria-label="Next hit"
      >
        <Icon icon={ArrowDown} size="sm" />
      </button>
      <button type="button" className="btn btn-toolbar tool-btn" onClick={onClose} aria-label="Close search" title="Close search (Esc)">
        <Icon icon={X} size="sm" />
      </button>
      {replaceMode && (
        <div
          className="search-replace-row"
          style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <input
            className="search-input"
            data-search-replace-input
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => onReplacement(e.target.value)}
            onKeyDown={handleReplaceKey}
            aria-label="Replacement text"
          />
          <button
            type="button"
            className="btn btn-toolbar tool-btn search-replace-btn"
            data-search-replace-one
            onClick={onReplaceOne}
            disabled={!canReplace}
            title="Replace the active match"
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-toolbar tool-btn search-replace-btn"
            data-search-replace-all
            onClick={onReplaceAll}
            disabled={!canReplace}
            title="Replace all matches"
          >
            Replace all
          </button>
        </div>
      )}
      {replaceMode && (
        <div
          className="search-status"
          data-search-replace-report
          role="status"
          style={{ flexBasis: '100%', textAlign: 'left', minWidth: 0 }}
        >
          {replaceReport}
        </div>
      )}
    </TfBar>
  );
}
