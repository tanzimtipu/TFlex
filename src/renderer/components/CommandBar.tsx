// Phase 14.1 — Liquid Glass CORRECTION: the PRIMARY COMMAND BAR.
//
// The reference's second top surface: a full-width glass band of
// control GROUPS in glass capsules, not a field of loose buttons:
//
//   [ < 1/34 > ]  [ - 372% + ]  [ tools... ]  [ Merge Split Sign ]
//
// The Tools palette toggle no longer lives in this bar: it is the
// floating badge on the page view's right edge (DocumentView's
// .tools-badge-tracker, data-tools-badge). The bar only carries the working
// tool controls.
//
// Each cluster is a GlassControlGroup capsule (role="group" +
// aria-label). The component is a RESTRUCTURING of the Phase-13 icon
// toolbar: every existing control keeps its exact promised behavior,
// its data-* attribute and its aria-label/title a11y contract — only
// the grouping and the surface change. The legacy `.toolbar` /
// `.toolbar-group` / `.tool-btn` classes stay on the DOM so every
// toolbar CSS contract and e2e selector keeps resolving.
//
// Phase 22 — the File (Open) and Save groups LEFT this bar: the
// operator relocated Open / Save / Save As into the caption strip
// (AppHeader's .titlebar-file group), immediately right of the TFlex
// brand. This bar carries the page/zoom/tools/actions controls only,
// and no duplicate File/Save control exists anywhere in the DOM.

import {
  ChevronLeft,
  ChevronRight,
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
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ZoomMode } from '../state/zoom';
import { GlassControlGroup } from './GlassChrome';

export interface CommandBarProps {
  page: number;
  pageCount: number;
  /** Phase 12 — logical page label for the active page (e.g. "iv", "A1").
   *  When set, the toolbar shows the label in the page indicator instead
   *  of the raw page number. The page-input still accepts numeric jumps;
   *  the label is purely a display affordance. */
  pageLabel?: string | null;
  zoomPercent: number;
  zoomMode: ZoomMode;
  onJump: (input: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
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
  /** Phase 19 — the annotation tool GROUP, rendered as the bar's LAST
   *  capsule (after Document actions). The host passes the
   *  AnnotationToolbar group element; the CommandBar only places it,
   *  so the annotation UI keeps owning its own state/props. Optional
   *  so standalone harnesses that predate the move keep rendering. */
  annotationTools?: ReactNode;
}

/** The grouped command bar. Every control is icon-only (the Open
 *  button is the ONE labelled control — the accent primary), and every
 *  button keeps aria-label + title so the no-op sweep can name it.
 *
 *  Phase 14.2 FIX 6 — the icon ladder is 20px minimum across the
 *  chrome: command-bar glyphs render at 22px (the Open button's
 *  inline icon at 20px to sit with its 13px label), up from the
 *  16px the Phase-13 toolbar shipped. Hit targets are unchanged:
 *  the 28px button inside the 36px capsule keeps its ~40px
 *  effective hit row. The Tools palette toggle no longer ships here
 *  (it was FIX 7's "All tools" LayoutGrid glyph): it lives on the
 *  page view's right edge as the floating .tools-badge-tracker. */
export function CommandBar(props: CommandBarProps) {
  const {
    page,
    pageCount,
    pageLabel = null,
    zoomPercent,
    zoomMode,
    onJump,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    searchOpen,
    onToggleSearch,
    onMerge,
    onSplit,
    signToolActive,
    onSignClick,
    hasFormFields,
    onFlattenClick,
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
    annotationTools,
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
      {/* Phase 22 — the File (Open) and Save groups are GONE: the
       *  operator relocated Open / Save / Save As into the caption
       *  strip (AppHeader's .titlebar-file group), immediately right
       *  of the TFlex brand. This bar keeps only the working
       *  document controls (navigation / zoom / tools / actions), and
       *  no duplicate control exists anywhere in the DOM. */}

      {/* GROUP: Navigation — [<] [1/34] [>] */}
      <GlassControlGroup label="Navigation" className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          disabled={page <= 1}
          onClick={() => onJump(String(page - 1))}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={22} aria-hidden />
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
          <ChevronRight size={22} aria-hidden />
        </button>
      </GlassControlGroup>

      {/* GROUP: Zoom — [- 372% +] + the two fit modes */}
      <GlassControlGroup label="Zoom" className="toolbar-group">
        <button type="button" className="tool-btn" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
          <Minus size={22} aria-hidden />
        </button>
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <button type="button" className="tool-btn" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
          <Plus size={22} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-width' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitWidth}
          aria-pressed={zoomMode === 'fit-width'}
          aria-label="Fit width"
          title="Fit width"
        >
          <MoveHorizontal size={22} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-page' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitPage}
          aria-pressed={zoomMode === 'fit-page'}
          aria-label="Fit page"
          title="Fit page"
        >
          <Expand size={22} aria-hidden />
        </button>
      </GlassControlGroup>

      {/* GROUP: Tools — the working icon set in ONE capsule */}
      <GlassControlGroup label="Tools" className="toolbar-group commandbar-group-tools">
        <button
          type="button"
          className="tool-btn"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          aria-label="Find in document"
          title="Find in document (Ctrl+F)"
        >
          <Search size={22} aria-hidden />
        </button>
        {onRotateCounterClockwise !== undefined && (
          <button
            type="button"
            className="tool-btn"
            onClick={onRotateCounterClockwise}
            title="Rotate counter-clockwise"
            aria-label="Rotate counter-clockwise"
            data-toolbar-rotate-ccw
          >
            <RotateCcw size={22} aria-hidden />
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
            <RotateCw size={22} aria-hidden />
          </button>
        )}
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
          <Hand size={22} aria-hidden />
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
            <Pencil size={22} aria-hidden />
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
            <Trash2 size={22} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="tool-btn tool-btn-optimize"
          onClick={onOptimize}
          title="Reduce file size: re-serialise the document with a compression preset"
          aria-label="Reduce file size"
          data-toolbar-optimize
          data-icon="optimize"
        >
          <Minimize2 size={22} aria-hidden />
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
          <PieChart size={22} aria-hidden />
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
            <Layers size={22} aria-hidden />
          </button>
        )}
      </GlassControlGroup>

{/* GROUP: Actions — [Merge] [Split] [Sign] [More]; the trailing
        * capsule pins to the edge via .toolbar > .toolbar-group:last-child.
         * The Tools palette toggle no longer lives in this bar: it is the
         * floating badge on the page view's right edge (DocumentView's
         * .tools-badge-tracker, data-tools-badge). */}
      <GlassControlGroup label="Document actions" className="toolbar-group commandbar-group-actions">
        <button
          type="button"
          className="tool-btn"
          onClick={onMerge}
          title="Merge with another PDF"
          aria-label="Merge with another PDF"
          data-icon="merge"
        >
          <GitMerge size={22} aria-hidden />
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onSplit}
          title="Extract or split pages"
          aria-label="Extract or split pages"
          data-icon="split"
        >
          <Scissors size={22} aria-hidden />
        </button>
        <button
          type="button"
          className={signToolActive ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onSignClick}
          title={signToolActive ? 'Sign tool active — click a page to place the selected signature. Click again to disarm.' : 'Sign: draw, type, or place a saved signature.'}
          aria-pressed={signToolActive}
          aria-label="Sign tool"
          data-icon="sign"
        >
          <FileSignature size={22} aria-hidden />
        </button>
      </GlassControlGroup>

      {/* GROUP: Annotate — Phase 19. The annotation tools render as the
       * bar's LAST capsule (the group element is supplied by the host).
       * Keeping it last preserves the trailing-capsule edge pin
       * (.toolbar > .toolbar-group:last-child). */}
      {annotationTools}
    </div>
  );
}