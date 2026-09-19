import { ChevronDown, ChevronUp, X } from 'lucide-react';
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
}

export function SearchBar(props: SearchBarProps) {
  const { query, onQuery, resultCount, activeIndex, searching, onNext, onPrev, onClose } =
    props;
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

  return (
    // Phase 20 — the search bar is a conditional chrome row of the same
    // floating-bar family as the edit toolbar (TfBar): token-driven
    // enter/exit (y -2 rise / reverse) with the exit frame pinning
    // pointer-events: none. Mounted inside an AnimatePresence in
    // DocumentView so the close actually animates.
    <TfBar className="search-bar" inert={!isPresent}>
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
        className="tool-btn"
        onClick={onPrev}
        disabled={resultCount === 0}
        title="Previous hit (Shift+Enter)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="tool-btn"
        onClick={onNext}
        disabled={resultCount === 0}
        title="Next hit (Enter)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button type="button" className="tool-btn" onClick={onClose} title="Close search (Esc)">
        <X size={16} aria-hidden />
      </button>
    </TfBar>
  );
}
