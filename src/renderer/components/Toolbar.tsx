import {
  ChevronLeft,
  ChevronRight,
  Expand,
  FileSignature,
  GitMerge,
  Layers,
  Minus,
  MoveHorizontal,
  PanelRightOpen,
  Plus,
  Save,
  Scissors,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ZoomMode } from '../state/zoom';

interface ToolbarProps {
  page: number;
  pageCount: number;
  zoomPercent: number;
  zoomMode: ZoomMode;
  /** Whether the active tab has unsaved engine changes (Save is enabled). */
  modified: boolean;
  /** Whether Save (in-place) is allowed: false for read-only sources
   *  (samples). Save-As is still available. */
  saveInPlaceEnabled: boolean;
  onJump: (input: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onMerge: () => void;
  onSplit: () => void;
  /** Phase 4 — Sign tool button. When true, the toolbar button shows
   *  the "active" treatment; clicking it again disarms. The host owns
   *  the armed state. */
  signToolActive: boolean;
  onSignClick: () => void;
  /** Phase 4 — has-form-fields indicator. When true, a small "Form" pill
   *  appears next to the page indicator; clicking it (or the Flatten
   *  action) opens the flatten flow. */
  hasFormFields: boolean;
  onFlattenClick: () => void;
  /** Phase 6 — Tools palette toggle. The toolbar sits left of the rail
   *  panel; clicking the button opens / closes the right-side palette.
   *  Mirrors the Ctrl+Shift+P accelerator the menu wires up. */
  toolsPaletteOpen: boolean;
  onToolsPaletteToggle: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const {
    page,
    pageCount,
    zoomPercent,
    zoomMode,
    modified,
    saveInPlaceEnabled,
    onJump,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    searchOpen,
    onToggleSearch,
    onSave,
    onSaveAs,
    onMerge,
    onSplit,
    signToolActive,
    onSignClick,
    hasFormFields,
    onFlattenClick,
    toolsPaletteOpen,
    onToolsPaletteToggle,
  } = props;

  const [pageInput, setPageInput] = useState(String(page));
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const commit = (): void => {
    onJump(pageInput);
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          title="Find in document (Ctrl+F)"
        >
          <Search size={15} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className="tool-btn"
          disabled={page <= 1}
          onClick={() => onJump(String(page - 1))}
          title="Previous page"
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        <div className="page-indicator">
          <input
            className="page-input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit();
              }
            }}
            aria-label="Current page"
          />
          <span className="page-total">/ {pageCount}</span>
        </div>
        <button
          type="button"
          className="tool-btn"
          disabled={page >= pageCount}
          onClick={() => onJump(String(page + 1))}
          title="Next page"
        >
          <ChevronRight size={15} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={modified ? 'tool-btn tool-btn-modified' : 'tool-btn'}
          onClick={onSave}
          disabled={!modified || !saveInPlaceEnabled}
          title={
            saveInPlaceEnabled
              ? 'Save (Ctrl+S)'
              : 'This document is read-only; use Save As instead'
          }
          aria-label="Save"
        >
          <Save size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSaveAs}
          disabled={!modified}
          title={modified ? 'Save a copy' : 'Nothing to save'}
          aria-label="Save As"
        >
          <span style={{ fontSize: 11, fontWeight: 600, padding: '0 1px' }}>Save&hellip;</span>
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="tool-btn" onClick={onZoomOut} title="Zoom out">
          <Minus size={15} aria-hidden />
        </button>
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <button type="button" className="tool-btn" onClick={onZoomIn} title="Zoom in">
          <Plus size={15} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={zoomMode === 'fit-width' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitWidth}
          aria-pressed={zoomMode === 'fit-width'}
          title="Fit width"
        >
          <MoveHorizontal size={15} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-page' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitPage}
          aria-pressed={zoomMode === 'fit-page'}
          title="Fit page"
        >
          <Expand size={15} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className="tool-btn"
          onClick={onMerge}
          title="Merge with another PDF"
          aria-label="Merge with another PDF"
        >
          <GitMerge size={15} aria-hidden />
          <span className="tool-btn-label">Merge</span>
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSplit}
          title="Extract or split pages"
          aria-label="Extract or split pages"
        >
          <Scissors size={15} aria-hidden />
          <span className="tool-btn-label">Split</span>
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type={signToolActive ? 'button' : 'button'}
          className={signToolActive ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onSignClick}
          title={signToolActive ? 'Sign tool active — click a page to place the selected signature. Click again to disarm.' : 'Sign: draw, type, or place a saved signature.'}
          aria-pressed={signToolActive}
          aria-label="Sign tool"
        >
          <FileSignature size={15} aria-hidden />
          <span className="tool-btn-label">Sign</span>
        </button>
        {hasFormFields && (
          <button
            type="button"
            className="tool-btn tool-btn-form"
            onClick={onFlattenClick}
            title="Flatten form fields: bake filled values into the page content"
            aria-label="Flatten form fields"
          >
            <Layers size={15} aria-hidden />
            <span className="tool-btn-label">Flatten</span>
          </button>
        )}
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={toolsPaletteOpen ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onToolsPaletteToggle}
          aria-pressed={toolsPaletteOpen}
          title="Show tools palette (Ctrl+Shift+P)"
          aria-label="Tools palette"
          data-tools-toggle
        >
          <PanelRightOpen size={15} aria-hidden />
          <span className="tool-btn-label">Tools</span>
        </button>
      </div>
    </div>
  );
}