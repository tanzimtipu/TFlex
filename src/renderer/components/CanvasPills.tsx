// Phase 36 (chunk 3b) — the floating canvas pills.
//
// The command toolbar ROW is retired from SINGLE mode. Its two view clusters
// move onto the canvas as two floating pills over the workspace chrome:
//
//   bottom-LEFT   the page pill     [ < N / M > ]  (the page number stays an
//                                    INPUT for the jump; logical page labels
//                                    keep their label-aware display)
//   bottom-RIGHT  the zoom pill     zoom out, the percent readout, zoom in,
//                                    fit-width, fit-page, pan mode
//
// Nothing is reimplemented: the pills re-parent the EXISTING handlers and keep
// the EXACT aria-labels the toolbar buttons carried ("Previous page",
// "Current page", "Next page", "Zoom out", "Zoom in", "Fit width",
// "Fit page", "Pan mode"), so the migrated specs keep resolving. They share
// the Action Dock's surface treatment (the same theme + motion tokens) and its
// State-4 idle fade — the dock reports its idle flip upward and the pills fade
// in lockstep, and while a tool is armed the dock never idles so the pills
// stay visible.

import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Hand,
  Minus,
  MoveHorizontal,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { PaneId } from '../state/multiMode';
import type { ZoomMode } from '../state/zoom';

export interface CanvasPillsProps {
  page: number;
  pageCount: number;
  /** Phase 12 — logical page label for the active page (e.g. "iv", "A1").
   *  Display-only; the input still accepts numeric jumps. */
  pageLabel?: string | null;
  zoomPercent: number;
  zoomMode: ZoomMode;
  onJump: (input: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  /** Pan (hand) mode owns the page pointer. The pills are its visible home
   *  now that the toolbar row is gone. */
  handActive?: boolean;
  onHandToggle?: () => void;
  /** Mirrors the Action Dock's State-4 idle. `true` fades both pills with
   *  the dock; `false` restores them. */
  idle?: boolean;
  /** Phase 36 (chunk 7) — the pane these pills belong to in Multi Mode. Each
   *  pane keeps its OWN pills inside its own canvas bounds, stacked at the
   *  pane's OUTER edge so the workspace's bottom-centre band stays clear for
   *  the ONE shared Action Dock. `null`/absent is single mode (unchanged:
   *  page at the canvas's bottom-left, zoom at its bottom-right). */
  pane?: PaneId | null;
}

/** The floating page + zoom pills. Rendered by DocumentView in SINGLE mode
 *  only (Multi Mode gives them their own multi-pane placement in a later
 *  chunk). */
export function CanvasPills(props: CanvasPillsProps): ReactElement {
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
    handActive = false,
    onHandToggle,
    idle = false,
    pane = null,
  } = props;

  const [pageInput, setPageInput] = useState(String(page));
  useEffect((): void => {
    setPageInput(String(page));
  }, [page]);

  const commit = (): void => {
    onJump(pageInput);
  };

  return (
    <div
      className="canvas-pills"
      data-canvas-pills
      data-canvas-pills-idle={idle ? 'true' : 'false'}
      data-pill-pane={pane ?? undefined}
    >
      {/* Page pill — bottom-LEFT. */}
      <div className="canvas-pill canvas-pill-page" role="group" aria-label="Page navigation" data-page-pill>
        <button
          type="button"
          className="tool-btn"
          disabled={page <= 1}
          onClick={(): void => onJump(String(page - 1))}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div className="page-indicator">
          <input
            className="page-input"
            value={pageInput}
            onChange={(e): void => setPageInput(e.target.value)}
            onBlur={commit}
            onKeyDown={(e): void => {
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
          onClick={(): void => onJump(String(page + 1))}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {/* Zoom pill — bottom-RIGHT. */}
      <div className="canvas-pill canvas-pill-zoom" role="group" aria-label="Zoom" data-zoom-pill>
        <button type="button" className="tool-btn" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
          <Minus size={20} aria-hidden />
        </button>
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <button type="button" className="tool-btn" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
          <Plus size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-width' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitWidth}
          aria-pressed={zoomMode === 'fit-width'}
          aria-label="Fit width"
          title="Fit width"
        >
          <MoveHorizontal size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={zoomMode === 'fit-page' ? 'tool-btn tool-btn-active' : 'tool-btn'}
          onClick={onFitPage}
          aria-pressed={zoomMode === 'fit-page'}
          aria-label="Fit page"
          title="Fit page"
        >
          <Expand size={20} aria-hidden />
        </button>
        {onHandToggle !== undefined && (
          <button
            type="button"
            className={handActive ? 'tool-btn tool-btn-active' : 'tool-btn'}
            onClick={onHandToggle}
            aria-pressed={handActive}
            title={
              handActive
                ? 'Pan mode active — drag to scroll. Click again to exit.'
                : 'Pan mode: drag anywhere to scroll the document'
            }
            aria-label="Pan mode"
            data-hand-toggle
            data-hand-active={handActive ? 'true' : 'false'}
          >
            <Hand size={20} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}