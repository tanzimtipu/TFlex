import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

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
    <div className="search-bar">
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
    </div>
  );
}
