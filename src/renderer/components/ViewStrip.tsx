// Phase 109 (chunk A) — the unified View Strip footer.
//
// The single home for the viewing controls. It replaces the floating
// CanvasPills in SINGLE mode and the top-right PageLayoutControl / Book View
// entry, gathering them into ONE dedicated 44-48px band below the document
// viewport:
//
//   page navigation (left) -> flexible space -> zoom / fit / pan / layout /
//                              Book View (right)
//
// No semantics change: every handler, aria-label and data-* hook is the SAME
// one the retired surfaces carried, so the migrated specs keep resolving. The
// component owns no view state; it consumes DocumentView's existing view model
// unchanged (zoom reducer, jumpToPage, zoomTo, setMode, pageLayout, handActive,
// pageLabels).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { PAGE_LAYOUT_MODES, type PageLayoutMode } from "./pageLayoutMode";
import type { ZoomMode } from "../state/zoom";

export interface ViewStripProps {
  /** 1-based current page (the physical index). */
  page: number;
  pageCount: number;
  /** Phase 12 — logical page label for the active page (e.g. "iv", "A1"). */
  pageLabel?: string | null;
  /** Phase 40 (item 9) — the layout-aware readout string (a grid row's page
   *  RANGE, "3-4"); absent in a single-column layout. */
  pageReadout?: string | null;
  zoomPercent: number;
  zoomMode: ZoomMode;
  onJump: (input: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  handActive?: boolean;
  onHandToggle?: () => void;
  onOpenBookView?: () => void;
  pageLayout: PageLayoutMode;
  onChangePageLayout: (mode: PageLayoutMode) => void;
  idle?: boolean;
  inMultiPane?: boolean;
}

/** The per-option layout chrome: registry glyph + accessible name. */
const LAYOUT_META: Record<
  PageLayoutMode,
  { label: string; icon: "layoutOnePage" | "layoutTwoPage" | "layoutFourPage" }
> = {
  one: { label: "One page", icon: "layoutOnePage" },
  two: { label: "Two pages side by side", icon: "layoutTwoPage" },
  four: { label: "Four pages in two rows", icon: "layoutFourPage" },
};

/** The unified View Strip footer. */
export function ViewStrip(props: ViewStripProps): ReactElement {
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
    onOpenBookView,
    pageLayout,
    onChangePageLayout,
    idle = false,
    inMultiPane = false,
  } = props;

  // Phase 40 (item 9) — the displayed readout is the layout-aware string when
  // one is supplied (a grid row's page range), else the bare page. Focusing
  // swaps to the numeric page so editing and typing a jump stay a plain integer.
  const readout = pageReadout !== null ? pageReadout : String(page);
  const [pageInput, setPageInput] = useState(readout);
  useEffect((): void => {
    setPageInput(readout);
    // `page` is also a dep: a jump moves the current page but the row's range
    // readout may not change, so the typed value would linger without this.
  }, [readout, page]);

  // DEF-351 — replace-on-type. In TWO/FOUR the resting value is the row RANGE
  // ("3-4"); focusing swaps it to the numeric page (`3`) and must SELECT it, or
  // the first keystroke APPENDS ("3" + "6" -> "63"). The swap commits one
  // render later, so the selection is applied in a layout effect keyed on the
  // value; a mouse click re-selects too, because the browser's own caret
  // placement runs after the focus event.
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

  // Phase 109 (chunk B2) — the single-mode OVERFLOW routing. At the narrowest
  // supported width the footer can no longer hold the page-layout group and the
  // Book View entry inline, so CSS hides them and reveals this More surface.
  // The menu reuses the Action Dock's overflow primitive (`.action-dock-menu` /
  // `.action-dock-menu-item` / `anim-menu-pop`): `aria-haspopup` + `aria-expanded`
  // on the trigger, Escape / outside-pointerdown close with focus returned to
  // the trigger, roving focus inside, and the SAME `data-page-layout-option` /
  // `data-book-view-open` hooks on the moved controls so every consumer keeps
  // resolving. Only single mode declares this surface; a Multi Mode pane has no
  // layout / Book View chrome to route.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreHostRef = useRef<HTMLDivElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const closeMore = useCallback((returnFocus: boolean): void => {
    setMoreOpen(false);
    if (returnFocus) moreBtnRef.current?.focus();
  }, []);

  useEffect((): (() => void) | undefined => {
    if (!moreOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMore(true);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && moreHostRef.current?.contains(target) === true) return;
      setMoreOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return (): void => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreOpen, closeMore]);

  // Roving focus starts on the first enabled row when the menu opens.
  useEffect((): void => {
    if (!moreOpen) return;
    moreMenuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
  }, [moreOpen]);

  const onMoreMenuKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    const items = [
      ...(moreMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].filter((el): boolean => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const active = moreMenuRef.current?.ownerDocument.activeElement;
    const index = items.findIndex((el): boolean => el === active);
    let next = index;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      className="view-strip"
      role="group"
      aria-label="Viewing controls"
      data-view-strip
      data-view-strip-idle={idle ? "true" : "false"}
    >
      <div className="view-strip-page" role="group" aria-label="Page navigation">
        <button
          type="button"
          className="btn btn-toolbar tool-btn"
          disabled={page <= 1}
          onClick={(): void => onJump(String(page - 1))}
          aria-label="Previous page"
          title="Previous page"
        >
          <Icon name="prevPage" size="sm" aria-hidden />
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
              // Synchronous select for the no-swap case (already numeric); the
              // layout effect re-selects if the swap re-renders.
              e.currentTarget.select();
            }}
            onClick={(e): void => {
              e.currentTarget.select();
            }}
            onBlur={commit}
            onKeyDown={(e): void => {
              if (e.key === "Enter") {
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
          className="btn btn-toolbar tool-btn"
          disabled={page >= pageCount}
          onClick={(): void => onJump(String(page + 1))}
          aria-label="Next page"
          title="Next page"
        >
          <Icon name="nextPage" size="sm" aria-hidden />
        </button>
      </div>

      <div className="view-strip-space" />

      <div className="view-strip-view" role="group" aria-label="View and zoom">
        <button
          type="button"
          className="btn btn-toolbar tool-btn"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Icon name="zoomOut" size="sm" aria-hidden />
        </button>
        <span className="zoom-percent" title="Current zoom">
          {zoomPercent}%
        </span>
        <button
          type="button"
          className="btn btn-toolbar tool-btn"
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Icon name="zoomIn" size="sm" aria-hidden />
        </button>
        <button
          type="button"
          className={
            zoomMode === "fit-width"
              ? "btn btn-toolbar btn-toggle tool-btn tool-btn-active"
              : "btn btn-toolbar btn-toggle tool-btn"
          }
          onClick={onFitWidth}
          aria-pressed={zoomMode === "fit-width"}
          aria-label="Fit width"
          title="Fit width"
        >
          <Icon name="fitWidth" size="sm" aria-hidden />
        </button>
        <button
          type="button"
          className={
            zoomMode === "fit-page"
              ? "btn btn-toolbar btn-toggle tool-btn tool-btn-active"
              : "btn btn-toolbar btn-toggle tool-btn"
          }
          onClick={onFitPage}
          aria-pressed={zoomMode === "fit-page"}
          aria-label="Fit page"
          title="Fit page"
        >
          <Icon name="fitPage" size="sm" aria-hidden />
        </button>
        {onHandToggle !== undefined && (
          <button
            type="button"
            className={
              handActive
                ? "btn btn-toolbar btn-toggle tool-btn tool-btn-active"
                : "btn btn-toolbar btn-toggle tool-btn"
            }
            onClick={onHandToggle}
            aria-pressed={handActive}
            title={
              handActive
                ? "Pan mode active — drag to scroll. Click again to exit."
                : "Pan mode: drag anywhere to scroll the document"
            }
            aria-label="Pan mode"
            data-hand-toggle
            data-hand-active={handActive ? "true" : "false"}
          >
            <Icon name="panMode" size="sm" aria-hidden />
          </button>
        )}
        {!inMultiPane && (
          <div className="view-strip-layout" role="group" aria-label="Page layout">
            {PAGE_LAYOUT_MODES.map((mode) => {
              const meta = LAYOUT_META[mode];
              const active = mode === pageLayout;
              return (
                <button
                  key={mode}
                  type="button"
                  className={
                    active
                      ? "btn btn-toolbar btn-toggle tool-btn tool-btn-active"
                      : "btn btn-toolbar btn-toggle tool-btn"
                  }
                  data-page-layout-option={mode}
                  aria-pressed={active}
                  aria-label={meta.label}
                  title={meta.label}
                  onClick={(): void => onChangePageLayout(mode)}
                >
                  <Icon name={meta.icon} size="sm" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
        {onOpenBookView !== undefined && !inMultiPane && (
          <button
            type="button"
            className="btn tool-btn view-strip-book"
            data-book-view-open
            aria-label="Book View"
            onClick={onOpenBookView}
          >
            <Icon name="openReadingView" size="sm" aria-hidden />
            <span className="view-strip-book-label">Book View</span>
          </button>
        )}
        {!inMultiPane && (
          <div className="view-strip-more" ref={moreHostRef} data-view-strip-more>
            <button
              ref={moreBtnRef}
              type="button"
              className="btn btn-toolbar tool-btn view-strip-more-btn"
              data-view-strip-more-toggle
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More viewing controls"
              title="More viewing controls"
              onClick={(): void => setMoreOpen((v) => !v)}
            >
              <Icon name="dockOverflow" size="sm" aria-hidden />
            </button>
            {moreOpen && (
              <div
                ref={moreMenuRef}
                className="action-dock-menu view-strip-more-menu anim-menu-pop"
                role="menu"
                aria-label="More viewing controls"
                data-view-strip-more-menu
                onKeyDown={onMoreMenuKeyDown}
              >
                {PAGE_LAYOUT_MODES.map((mode) => {
                  const meta = LAYOUT_META[mode];
                  const active = mode === pageLayout;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost action-dock-menu-item"
                      data-page-layout-option={mode}
                      aria-pressed={active}
                      aria-label={meta.label}
                      title={meta.label}
                      onClick={(): void => {
                        setMoreOpen(false);
                        onChangePageLayout(mode);
                      }}
                    >
                      <Icon name={meta.icon} size="sm" aria-hidden />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
                {onOpenBookView !== undefined && (
                  <button
                    type="button"
                    role="menuitem"
                    className="btn btn-ghost action-dock-menu-item"
                    data-book-view-open
                    aria-label="Book View"
                    onClick={(): void => {
                      setMoreOpen(false);
                      onOpenBookView?.();
                    }}
                  >
                    <Icon name="openReadingView" size="sm" aria-hidden />
                    <span>Book View</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
