import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Expand,
  FileSignature,
  GitMerge,
  Hand,
  Layers,
  Minus,
  Minimize2,
  MoveHorizontal,
  Pencil,
  PieChart,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ZoomMode } from '../state/zoom';

interface ToolbarProps {
  page: number;
  pageCount: number;
  /** Phase 12 — logical page label for the active page (e.g. "iv", "A1").
   *  When set, the toolbar shows the label in the page indicator instead
   *  of the raw page number. The page-input still accepts numeric jumps;
   *  the label is purely a display affordance. */
  pageLabel?: string | null;
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
   *  Mirrors the Ctrl+Shift+P accelerator the menu wires up. Phase 13 —
   *  rendered as the icon-only "More" (ellipsis) affordance at the
   *  trailing edge of the toolbar. */
  toolsPaletteOpen: boolean;
  onToolsPaletteToggle: () => void;
  /** Phase 8 — Optimize / Audit Space. Both are disabled when no
   *  document is open. */
  onOptimize: () => void;
  onAuditSpace: () => void;
  /** DEF-041 — Rotate-current-page. Exposed in the toolbar so the
   *  user can rotate the visible page without selecting a thumbnail
   *  in the SideRail first. Calls `engine.applyOp({kind:'rotate',
   *  page, dir:'cw'})`. Disabled when no document is open. */
  onRotateClockwise?: () => void;
  /** Phase 13 — Rotate-current-page counter-clockwise. Same contract
   *  as `onRotateClockwise` with the engine op dir flipped to "ccw".
   *  Optional so older harnesses that omit it keep rendering. */
  onRotateCounterClockwise?: () => void;
  /** Phase 13 — Hand (pan) mode. When true the document scroller
   *  enters grab-and-drag panning: pointer drags scroll the viewport,
   *  the pages ignore editing gestures, and the cursor is a grab
   *  hand. The host (DocumentView) owns the armed state. Optional so
   *  standalone harnesses can omit it; the button then renders
   *  disarmed. */
  handActive?: boolean;
  onHandToggle?: () => void;
  /** Phase 10 — Edit-content mode. When true, the Edit toolbar
   *  appears below the page toolbar and the per-page EditOverlay
   *  is pointer-active. Clicking the button toggles. The host
   *  owns the open/closed state. */
  editModeOpen?: boolean;
  onEditModeToggle?: () => void;
  /** B8 — Delete pages. Opens a dialog (current / custom range)
   *  that the host wires to `engine.applyOp({kind:"delete"})`.
   *  Disabled when there's only one page left. */
  onDeletePage?: () => void;
  canDeletePage?: boolean;
}

export function Toolbar(props: ToolbarProps) {
  const {
    page,
    pageCount,
    pageLabel = null,
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
    onOptimize,
    onAuditSpace,
    onRotateClockwise,
    onRotateCounterClockwise,
    handActive = false,
    onHandToggle,
    editModeOpen = false,
    onEditModeToggle,
    onDeletePage,
    canDeletePage = true,
  } = props;

  const [pageInput, setPageInput] = useState(String(page));
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const commit = (): void => {
    onJump(pageInput);
  };

  // Phase 13 — every control is ICON-ONLY: the promised action lives in
  // the accessible name (aria-label) and the tooltip (title). The
  // no-op sweep contract is pinned by the unit test that walks every
  // button and asserts both attributes exist.
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          aria-label="Find in document"
          title="Find in document (Ctrl+F)"
        >
          <Search size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className="tool-btn"
          disabled={page <= 1}
          onClick={() => onJump(String(page - 1))}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={16} aria-hidden />
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
            title={pageLabel !== null ? `Page ${page} (label: ${pageLabel})` : undefined}
          />
          <span className="page-total">/ {pageCount}</span>
          {pageLabel !== null && (
            <span
              className="page-label-hint"
              data-page-label={pageLabel}
              title={`Logical page label for page ${page}`}
            >
              {pageLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          className="tool-btn"
          disabled={page >= pageCount}
          onClick={() => onJump(String(page + 1))}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={
            !modified
              ? 'tool-btn tool-btn-save-clean'
              : saveInPlaceEnabled
                ? 'tool-btn tool-btn-modified'
                : 'tool-btn tool-btn-modified tool-btn-save-readonly'
          }
          onClick={onSave}
          disabled={!modified || !saveInPlaceEnabled}
          title={
            !modified
              ? 'Saved — no changes to save'
              : saveInPlaceEnabled
                ? 'Unsaved changes — Save now (Ctrl+S)'
                : 'Read-only document — use Save As to save a copy'
          }
          aria-label="Save"
        >
          <Save size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSaveAs}
          disabled={!modified}
          title={modified ? 'Save a copy (Ctrl+Shift+S)' : 'Nothing to save'}
          aria-label="Save a copy"
          data-toolbar-save-as
        >
          <SaveAll size={16} aria-hidden />
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="tool-btn" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
          <Minus size={16} aria-hidden />
        </button>
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <button type="button" className="tool-btn" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
          <Plus size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={zoomMode === 'fit-width' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitWidth}
          aria-pressed={zoomMode === 'fit-width'}
          aria-label="Fit width"
          title="Fit width"
        >
          <MoveHorizontal size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-page' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitPage}
          aria-pressed={zoomMode === 'fit-page'}
          aria-label="Fit page"
          title="Fit page"
        >
          <Expand size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        {onRotateCounterClockwise !== undefined && (
          <button
            type="button"
            className="tool-btn"
            onClick={onRotateCounterClockwise}
            title="Rotate counter-clockwise"
            aria-label="Rotate counter-clockwise"
            data-toolbar-rotate-ccw
          >
            <RotateCcw size={16} aria-hidden />
          </button>
        )}
        {onRotateClockwise !== undefined && (
          <button
            type="button"
            className="tool-btn"
            // Phase 8 — disabled while no document is open (the host
            // passes `undefined` in that case so the button doesn't
            // render at all; this guard keeps the optional prop safe
            // in tests too).
            onClick={onRotateClockwise}
            title="Rotate clockwise"
            aria-label="Rotate clockwise"
            data-toolbar-rotate-cw
          >
            <RotateCw size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="tool-btn"
          onClick={onMerge}
          title="Merge with another PDF"
          aria-label="Merge with another PDF"
          data-icon="merge"
        >
          <GitMerge size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSplit}
          title="Extract or split pages"
          aria-label="Extract or split pages"
          data-icon="split"
        >
          <Scissors size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={signToolActive ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onSignClick}
          title={signToolActive ? 'Sign tool active — click a page to place the selected signature. Click again to disarm.' : 'Sign: draw, type, or place a saved signature.'}
          aria-pressed={signToolActive}
          aria-label="Sign tool"
          data-icon="sign"
        >
          <FileSignature size={16} aria-hidden />
        </button>
        {hasFormFields && (
          <button
            type="button"
            className="tool-btn tool-btn-form"
            onClick={onFlattenClick}
            title="Flatten form fields: bake filled values into the page content"
            aria-label="Flatten form fields"
            data-icon="flatten"
          >
            <Layers size={16} aria-hidden />
          </button>
        )}
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className="tool-btn tool-btn-optimize"
          onClick={onOptimize}
          title="Reduce file size: re-serialise the document with a compression preset"
          aria-label="Reduce file size"
          data-toolbar-optimize
          data-icon="optimize"
        >
          <Minimize2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="tool-btn tool-btn-audit"
          onClick={onAuditSpace}
          title="Audit space usage: see a per-element breakdown of the file size"
          aria-label="Audit space usage"
          data-toolbar-audit
          data-icon="audit"
        >
          <PieChart size={16} aria-hidden />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={handActive ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onHandToggle}
          aria-pressed={handActive}
          title={handActive ? 'Pan mode active — drag to scroll. Click again to exit.' : 'Pan mode: drag anywhere to scroll the document'}
          aria-label="Pan mode"
          data-hand-toggle
          data-hand-active={handActive ? 'true' : 'false'}
        >
          <Hand size={16} aria-hidden />
        </button>
        {onEditModeToggle !== undefined && (
          <button
            type="button"
            className={editModeOpen ? 'tool-btn tool-btn-active' : 'tool-btn'}
            onClick={onEditModeToggle}
            aria-pressed={editModeOpen}
            title="Edit content: replace text, add text boxes, edit images"
            aria-label="Edit content"
            data-toolbar-edit-toggle
            data-icon="edit"
          >
            <Pencil size={16} aria-hidden />
          </button>
        )}
        {onDeletePage !== undefined && (
          <button
            type="button"
            className="tool-btn"
            onClick={onDeletePage}
            disabled={!canDeletePage}
            title={canDeletePage ? 'Delete current page or a custom range' : 'Documents must keep at least one page'}
            aria-label="Delete pages"
            data-toolbar-delete-pages
            data-icon="delete"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        )}
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={toolsPaletteOpen ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onToolsPaletteToggle}
          aria-pressed={toolsPaletteOpen}
          title="More tools (Ctrl+Shift+P)"
          aria-label="More tools"
          data-tools-toggle
        >
          {/* Phase 13 — the Tools palette toggle renders as the "More"
              (ellipsis) affordance: the palette IS the overflow surface,
              so the icon says "everything else lives here". The stable
              data-tools-toggle attribute keeps every e2e selector
              resolving. The PanelRightOpen glyph survives as the
              palette-open state indicator in the ToolsPalette header. */}
          <Ellipsis size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}