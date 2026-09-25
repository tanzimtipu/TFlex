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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { PaneId } from '../state/multiMode';
import type { ZoomMode } from '../state/zoom';

export interface CanvasPillsProps {
  page: number;
  pageCount: number;
  /** Phase 12 — logical page label for the active page (e.g. "iv", "A1").
   *  Display-only; the input still accepts numeric jumps. */
  pageLabel?: string | null;
  /** Phase 40 (item 9) — the page readout string. Absent in a single-column
   *  layout (the input shows `page` exactly as before). In a multi-column grid
   *  DocumentView passes the row's page RANGE ("3-4") so the readout names the
   *  page the user navigated to instead of only the row's first page. Focusing
   *  the input swaps it back to the numeric page for editing; the shared
   *  `pageJump` parses the leading integer, so committing a range is harmless. */
  pageReadout?: string | null;
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
    pageReadout = null,
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

  // Phase 40 (item 9) — the displayed readout is the layout-aware string when
  // one is supplied (a grid row's page range), else the bare page (today's
  // single-column behaviour). Focusing swaps to the numeric page so editing
  // and typing a jump stay a plain integer.
  const readout = pageReadout !== null ? pageReadout : String(page);
  const [pageInput, setPageInput] = useState(readout);
  useEffect((): void => {
    setPageInput(readout);
    // `page` is also a dep: a jump to page 4 in a 2-column layout moves the
    // current page but the row's readout stays "3-4", so the string alone
    // would not re-fire and the typed "4" would linger. Re-applying on the
    // page change restores the honest range the moment the jump lands.
  }, [readout, page]);

  // DEF-351 — replace-on-type. In TWO/FOUR the resting value is the row RANGE
  // ("3-4"); focusing swaps it to the numeric page (`3`) and must SELECT it, or
  // the first keystroke APPENDS ("3" + "6" -> "63" -> a silently refused jump).
  // The swap commits one render later, so the selection is applied in a layout
  // effect keyed on the value; a mouse click re-selects too, because the
  // browser's own caret placement runs after the focus event.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectOnCommitRef = useRef(false);
  useLayoutEffect((): void => {
    if (!selectOnCommitRef.current) return;
    selectOnCommitRef.current = false;
    inputRef.current?.select();
  }, [pageInput]);

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
            ref={inputRef}
            className="page-input"
            value={pageInput}
            onChange={(e): void => setPageInput(e.target.value)}
            onFocus={(e): void => {
              selectOnCommitRef.current = true;
              setPageInput(String(page));
              // Synchronous select for the no-swap case (ONE mode / already
              // numeric); the layout effect re-selects if the swap re-renders.
              e.currentTarget.select();
            }}
            onClick={(e): void => {
              e.currentTarget.select();
            }}
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