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
// (AppHeader's .titlebar-file group), immediately right of the Jovrel
// brand. This bar carries the page/zoom/tools/actions controls only,
// and no duplicate File/Save control exists anywhere in the DOM.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ZoomMode } from '../state/zoom';
import { GlassControlGroup } from './GlassChrome';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';

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
  /** Phase 32 — Multi Mode. When wired, the Tools capsule carries the
   *  toggle: pressed while the two-pane workspace is on, and clicking it
   *  turns the mode on/off. The host (App) owns the mode, so this button
   *  and the All-tools entry always read the same value. */
  multiModeEnabled?: boolean;
  onMultiModeToggle?: () => void;
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
    multiModeEnabled = false,
    onMultiModeToggle,
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
       *  of the Jovrel brand. This bar keeps only the working
       *  document controls (navigation / zoom / tools / actions), and
       *  no duplicate control exists anywhere in the DOM. */}

      {/* GROUP: Navigation — [<] [1/34] [>] */}
      <GlassControlGroup label="Navigation" className="toolbar-group">
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Previous page"
          className="tool-btn"
          disabled={page <= 1}
          onClick={() => onJump(String(page - 1))}
          icon={<Icon name="prevPage" size="xl" aria-hidden />}
        />
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
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Next page"
          className="tool-btn"
          disabled={page >= pageCount}
          onClick={() => onJump(String(page + 1))}
          icon={<Icon name="nextPage" size="xl" aria-hidden />}
        />
      </GlassControlGroup>

      {/* GROUP: Zoom — [- 372% +] + the two fit modes */}
      <GlassControlGroup label="Zoom" className="toolbar-group">
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Zoom out"
          className="tool-btn"
          onClick={onZoomOut}
          icon={<Icon name="zoomOut" size="xl" aria-hidden />}
        />
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Zoom in"
          className="tool-btn"
          onClick={onZoomIn}
          icon={<Icon name="zoomIn" size="xl" aria-hidden />}
        />
        <IconButton
          variant="toolbar"
          kind="toggle"
          density="standard"
          label="Fit width"
          className="tool-btn"
          pressed={zoomMode === 'fit-width'}
          onClick={onFitWidth}
          icon={<Icon name="fitWidth" size="xl" aria-hidden />}
        />
        <IconButton
          variant="toolbar"
          kind="toggle"
          density="standard"
          label="Fit page"
          className="tool-btn"
          pressed={zoomMode === 'fit-page'}
          onClick={onFitPage}
          icon={<Icon name="fitPage" size="xl" aria-hidden />}
        />
      </GlassControlGroup>

      {/* GROUP: Tools — the working icon set in ONE capsule */}
      <GlassControlGroup label="Tools" className="toolbar-group commandbar-group-tools">
        <IconButton
          variant="toolbar"
          kind="toggle"
          density="standard"
          label="Find in document"
          className="tool-btn"
          pressed={searchOpen}
          onClick={onToggleSearch}
          icon={<Icon name="find" size="xl" aria-hidden />}
        />
        {onRotateCounterClockwise !== undefined && (
          <IconButton
            variant="toolbar"
            kind="action"
            density="standard"
            label="Rotate counter-clockwise"
            className="tool-btn"
            onClick={onRotateCounterClockwise}
            data-toolbar-rotate-ccw
            icon={<Icon name="rotateCounterClockwise" size="xl" aria-hidden />}
          />
        )}
        {onRotateClockwise !== undefined && (
          <IconButton
            variant="toolbar"
            kind="action"
            density="standard"
            label="Rotate clockwise"
            className="tool-btn"
            onClick={onRotateClockwise}
            data-toolbar-rotate-cw
            icon={<Icon name="rotate" size="xl" aria-hidden />}
          />
        )}
        <IconButton
          variant="toolbar"
          kind="toggle"
          density="standard"
          label="Pan mode"
          className="tool-btn"
          pressed={handActive}
          onClick={onHandToggle}
          data-hand-toggle
          data-hand-active={handActive ? 'true' : 'false'}
          icon={<Icon name="panMode" size="xl" aria-hidden />}
        />
        {onMultiModeToggle !== undefined && (
          <IconButton
            variant="toolbar"
            kind="toggle"
            density="standard"
            label="Multi Mode: view/edit two documents side by side"
            className="tool-btn"
            pressed={multiModeEnabled}
            onClick={onMultiModeToggle}
            data-toolbar-multi-mode
            data-multi-mode-active={multiModeEnabled ? 'true' : 'false'}
            data-icon="multi-mode"
            icon={<Icon name="multi-mode" size="xl" aria-hidden />}
          />
        )}
        {onEditModeToggle !== undefined && (
          <IconButton
            variant="toolbar"
            kind="toggle"
            density="standard"
            label="Edit content"
            className="tool-btn"
            pressed={editModeOpen}
            onClick={onEditModeToggle}
            data-toolbar-edit-toggle
            data-icon="edit"
            icon={<Icon name="editMode" size="xl" aria-hidden />}
          />
        )}
        {onDeletePage !== undefined && (
          <IconButton
            variant="toolbar"
            intent="destructive"
            kind="action"
            density="standard"
            label="Delete pages"
            className="tool-btn btn-toolbar"
            onClick={onDeletePage}
            disabled={!canDeletePage}
            data-toolbar-delete-pages
            data-icon="delete"
            icon={<Icon name="delete" size="xl" aria-hidden />}
          />
        )}
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Reduce file size"
          className="tool-btn"
          onClick={onOptimize}
          data-toolbar-optimize
          data-icon="optimize"
          icon={<Icon name="optimize" size="xl" aria-hidden />}
        />
        <IconButton
          variant="toolbar"
          kind="action"
          density="standard"
          label="Audit space usage"
          className="tool-btn"
          onClick={onAuditSpace}
          data-toolbar-audit
          data-icon="audit"
          icon={<Icon name="audit" size="xl" aria-hidden />}
        />
        {hasFormFields && (
          <IconButton
            variant="toolbar"
            kind="action"
            density="standard"
            label="Flatten form fields"
            className="tool-btn"
            onClick={onFlattenClick}
            data-icon="flatten"
            icon={<Icon name="engineeringLayers" size="xl" aria-hidden />}
          />
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
          className="btn btn-toolbar tool-btn"
          onClick={onMerge}
          title="Merge with another PDF"
          aria-label="Merge with another PDF"
          data-icon="merge"
        >
          <Icon name="merge" size="xl" aria-hidden />
        </button>
        <button
          type="button"
          className="btn btn-toolbar tool-btn"
          onClick={onSplit}
          title="Extract or split pages"
          aria-label="Extract or split pages"
          data-icon="split"
        >
          <Icon name="split" size="xl" aria-hidden />
        </button>
        <button
          type="button"
          className={signToolActive ? 'btn btn-toolbar btn-toggle tool-btn tool-btn-active' : 'btn btn-toolbar btn-toggle tool-btn'}
          onClick={onSignClick}
          title={signToolActive ? 'Sign tool active — click a page to place the selected signature. Click again to disarm.' : 'Sign: draw, type, or place a saved signature.'}
          aria-pressed={signToolActive}
          aria-label="Sign tool"
          data-icon="sign"
        >
          <Icon name="sign" size="xl" aria-hidden />
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