// Phase 32 — Multi Mode workspace chrome.
//
// `DocumentStage` is the ONE workspace region: in single mode it renders
// exactly what the app rendered before (the welcome pane, or one
// `.tab-pane` per open tab with the active one visible). In Multi Mode it
// turns the SAME tab-panes into two side-by-side panes — each pane's
// document is a tab id and the tab-pane's `DocumentView` is never
// remounted when the mode or the focus changes (the tab id is the key), so
// toggling the mode cannot blank a canvas or lose a scroll position.
//
// The divider drag writes a single CSS custom property (`--tf-split`) on
// the stage; the panes' widths read it, so resizing re-lays-out without
// re-rendering either DocumentView.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { Columns2, FileText, FolderOpen, GripVertical, X } from "lucide-react";
import { paneTabId, type MultiModeState, type PaneId } from "../state/multiMode";
import {
  MIN_PANE_WIDTH_PX,
  clampSplitFraction,
  effectiveToolsInset,
  insetCapFor,
} from "./multiPaneLayout";

/** A tab that can fill a pane: a real document with a name and page count. */
export interface StageTab {
  id: string;
  title: string;
  pageCount: number;
}

/** The smallest comfortable pane width the divider can produce. Re-exported
 *  from the pure layout module so the single rule has a single home. */
export { MIN_PANE_WIDTH_PX };

export interface DocumentStageProps {
  /** Every tab that owns a live document session. */
  tabs: readonly StageTab[];
  /** The tab strip's active id (single-mode visibility). */
  activeId: string | null;
  /** True when the Welcome screen owns the stage instead of the tabs. */
  showWelcome: boolean;
  /** Key for the welcome pane — mirrors the pre-Phase-32 key contract. */
  welcomeKey: string;
  welcome: ReactNode;
  multiMode: MultiModeState;
  /** Left pane's share of the stage width, 0..1. */
  splitFraction: number;
  onSplitChange: (fraction: number) => void;
  onFocusPane: (pane: PaneId) => void;
  onClearPane: (pane: PaneId) => void;
  onPickPane: (pane: PaneId, tabId: string) => void;
  onOpenIntoPane: (pane: PaneId) => void;
  /** Builds the `DocumentView` element for a tab id (App owns the props).
   *  Phase 33 — the pane the tab currently fills (`null` in single mode) is
   *  handed back too, so App can give each pane its OWN thumbnail strip on
   *  the correct rail side. */
  renderDocument: (tabId: string, pane: PaneId | null) => ReactNode;
  /** Phase 33 (chunk 4) — the workspace's SINGLE toolbar, rendered once in
   *  the stage above both panes while Multi Mode is on. `null`/absent in
   *  single mode (each view keeps its own toolbar, unchanged). */
  sharedToolbar?: ReactNode;
  /** Phase 33 / DEF-284 — the workspace's SINGLE All Tools badge, rendered
   *  once here while Multi Mode is on. The per-pane views suppress their own
   *  copy, so exactly one affordance exists (criterion 4b); single mode keeps
   *  the badge inside its `DocumentView`, unchanged. */
  toolsBadge?: ReactNode;
  /** DEF-287 (residual) — the All Tools panel's requested inset TARGET in px
   *  (0 with the panel closed, 344 list / 380 grid with it open). A change
   *  here is a geometry change: the stored split fraction is re-clamped so
   *  both panes keep their minimum without requiring a drag. */
  toolsInsetTarget?: number;
}

/** The per-pane header: document name, page count, and the clear control. */
export function MultiPaneHeader(props: {
  pane: PaneId;
  title: string;
  pageCount: number;
  onClear: () => void;
}): ReactElement {
  const { pane, title, pageCount, onClear } = props;
  return (
    <div className="multi-pane-header" data-pane-header data-pane={pane}>
      <span className="multi-pane-badge" aria-hidden>
        {pane}
      </span>
      <span className="multi-pane-title" title={title}>
        {title}
      </span>
      <span className="multi-pane-count">
        {pageCount} {pageCount === 1 ? "page" : "pages"}
      </span>
      <button
        type="button"
        className="multi-pane-clear"
        data-pane-clear
        onClick={onClear}
        aria-label={`Clear pane ${pane}`}
        title={`Clear pane ${pane} and choose another document`}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** The empty pane body: pick an open document, or open a PDF into the pane. */
export function MultiPaneEmpty(props: {
  pane: PaneId;
  options: readonly StageTab[];
  onPick: (pane: PaneId, tabId: string) => void;
  onOpen: (pane: PaneId) => void;
}): ReactElement {
  const { pane, options, onPick, onOpen } = props;
  return (
    <div className="multi-pane-empty">
      <div className="multi-pane-empty-inner">
        <Columns2 size={28} aria-hidden className="multi-pane-empty-icon" />
        <p className="multi-pane-empty-title">Pane {pane} is empty</p>
        <p className="multi-pane-empty-hint">
          Pick one of the open documents, or open a PDF into this pane.
        </p>
        {options.length > 0 && (
          <ul className="multi-pane-pick-list">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="multi-pane-pick"
                  data-pane-pick={option.id}
                  onClick={(): void => onPick(pane, option.id)}
                  aria-label={`Show ${option.title} in pane ${pane}`}
                  title={`Show ${option.title} in pane ${pane}`}
                >
                  <FileText size={16} aria-hidden />
                  <span className="multi-pane-pick-title">{option.title}</span>
                  <span className="multi-pane-pick-count">
                    {option.pageCount} {option.pageCount === 1 ? "page" : "pages"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="multi-pane-open"
          data-pane-open
          onClick={(): void => onOpen(pane)}
          aria-label={`Open a PDF into pane ${pane}`}
          title={`Open a PDF into pane ${pane}`}
        >
          <FolderOpen size={16} aria-hidden />
          <span>Open a PDF</span>
        </button>
      </div>
    </div>
  );
}

/** The draggable split handle between the two panes. */
export function MultiDivider(props: {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactElement {
  const { onPointerDown, onPointerMove, onPointerUp } = props;
  return (
    <div
      className="multi-divider"
      data-multi-divider
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      title="Drag to resize the panes"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="multi-divider-grip" aria-hidden>
        <GripVertical size={14} />
      </span>
    </div>
  );
}

/**
 * The workspace region. Single mode is the pre-Phase-32 render exactly:
 * the welcome pane, or one `.tab-pane` per open tab with only the active
 * tab visible. Multi Mode reuses those same tab-panes as panes A and B
 * (visibility flips, no remount) and adds the divider plus the empty-pane
 * body for a pane with no document.
 */
export function DocumentStage(props: DocumentStageProps): ReactElement {
  const {
    tabs,
    activeId,
    showWelcome,
    welcomeKey,
    welcome,
    multiMode,
    splitFraction,
    onSplitChange,
    onFocusPane,
    onClearPane,
    onPickPane,
    onOpenIntoPane,
    renderDocument,
    sharedToolbar,
    toolsBadge,
    toolsInsetTarget,
  } = props;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // Phase 33 (chunk 4) — the shared toolbar row's measured height. The panes
  // start below it; measuring (rather than assuming) keeps the geometry right
  // when the bar wraps at a narrow window.
  const toolbarRowRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  // DEF-287 — the stage's measured inline width. The panes' minimum budget
  // (strip floor + page minimum, both panes + the divider) caps the All
  // Tools inset so the page areas can never collapse; the cap is derived
  // from this measurement and written inline as `--tf-multi-inset-cap`.
  const [stageWidth, setStageWidth] = useState(0);

  const multiOn = multiMode.enabled;
  const stageStyle = {
    // Kept for the existing e2e/unit contract (`--tf-split` is the
    // divider's position as a percentage of the stage).
    "--tf-split": `${(splitFraction * 100).toFixed(3)}%`,
    // The panes' geometry needs the fraction as a NUMBER so CSS can
    // multiply it by a length-percentage (calc cannot multiply by a
    // percentage value).
    "--tf-split-frac": String(splitFraction),
    // Phase 33 (chunk 4) — the panes' top offset under the shared toolbar.
    "--tf-multi-toolbar-h": multiOn ? `${toolbarHeight}px` : "0px",
    // DEF-287 — the largest inset the two panes may consume at this width.
    // Omitted until measured (jsdom reports 0): the stylesheet's fallback
    // then leaves the inset uncapped, exactly the pre-change geometry.
    "--tf-multi-inset-cap":
      multiOn && stageWidth > 0 ? `${insetCapFor(stageWidth)}px` : undefined,
  } as CSSProperties;

  // DEF-287 — measure the stage's own width (layout effect: the cap is
  // applied before the first paint, so a minimum-window open never shows a
  // collapsed page area for even one frame). jsdom has no layout
  // (clientWidth 0) and may not implement ResizeObserver — both fall back
  // to the uncapped inset, which is what the unit harness pins.
  useLayoutEffect((): (() => void) | undefined => {
    const el = stageRef.current;
    if (el === null) {
      setStageWidth(0);
      return undefined;
    }
    const update = (): void => {
      const width = el.clientWidth;
      setStageWidth((prev) => (prev === width ? prev : width));
    };
    update();
    const RO = (globalThis as { ResizeObserver?: new (cb: () => void) => ResizeObserver })
      .ResizeObserver;
    if (RO === undefined) return undefined;
    const observer = new RO(update);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [multiOn]);

  // Measure the shared toolbar row so the panes (headers and strips
  // included) start below it. The measured height is written to
  // `--tf-multi-toolbar-h`, which BOTH the panes' `top` and the divider's
  // `top` read — so no part of the workspace can drift out from under the
  // bar (DEF-282). Measuring (rather than hardcoding) keeps the geometry
  // right when the bar wraps at a narrow window. Layout effect: the offset
  // is applied before the first paint, so the bar never overlays the headers
  // for even one frame. jsdom has no layout (offsetHeight 0) and may not
  // implement ResizeObserver — both fall back cleanly to the 0 offset the
  // pre-chunk-4 stage had.
  useLayoutEffect((): (() => void) | undefined => {
    const el = toolbarRowRef.current;
    if (el === null) {
      setToolbarHeight(0);
      return undefined;
    }
    const update = (): void => setToolbarHeight(el.offsetHeight);
    update();
    const RO = (globalThis as { ResizeObserver?: new (cb: () => void) => ResizeObserver })
      .ResizeObserver;
    if (RO === undefined) return undefined;
    const observer = new RO(update);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [multiOn, sharedToolbar]);

  // DEF-287 (residual) — a STORED split fraction must keep both panes at
  // their minimum at every supported width with the panel open, without
  // requiring a drag. Whenever the available geometry changes while Multi
  // Mode is on — the stage resizes, or the All Tools panel opens/closes (its
  // `--tf-tools-inset` TARGET changes) — re-clamp the stored fraction with
  // the SAME pure rule the drag uses. The drag path stays untouched: while a
  // pointer drag is in flight this effect is inert (`draggingRef`), and a
  // fraction already inside the bounds is written back unchanged, so a normal
  // layout never churns. When even 0.5 cannot satisfy the minimum (a window
  // below the supported minimum) the rule pins to 0.5 and the DEF-287 inset
  // cap keeps the page areas usable; the clamp is idempotent, so no
  // oscillation.
  useLayoutEffect((): void => {
    if (!multiOn || draggingRef.current) return;
    if (stageWidth <= 0) return;
    const clamped = clampSplitFraction(stageWidth, toolsInsetTarget ?? 0, splitFraction);
    if (clamped !== splitFraction) onSplitChange(clamped);
  }, [multiOn, stageWidth, toolsInsetTarget, splitFraction, onSplitChange]);

  /** Clamp a pointer x to a fraction that keeps both panes usable. */
  const fractionFor = useCallback(
    (clientX: number): number => {
      const el = stageRef.current;
      if (el === null) return 0.5;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0.5;
      // Phase 34 (chunk 3) — DEF-286/287: the divider's CENTRE sits at
      // `100% * frac - inset / 2` (both panes give up half the inset, so the
      // handle no longer drifts off the pointer). The inset used here is the
      // SAME capped one the stylesheet consumes, derived from the stage
      // width, so the drag stays 1:1 with the panel open at any width.
      // An unset/0px token (or a jsdom computed style that cannot resolve
      // it) leaves the pre-change geometry untouched.
      const insetRaw = getComputedStyle(el).getPropertyValue("--tf-tools-inset").trim();
      const requested = Number.parseFloat(insetRaw);
      const requestedInset = Number.isFinite(requested) ? requested : 0;
      const inset = effectiveToolsInset(rect.width, requestedInset);
      // Pane A's left edge is 0 and its width is `W * f - inset/2 - divider/2`,
      // so the handle must keep that width at or above MIN_PANE_WIDTH_PX.
      // The shared `clampSplitFraction` owns that rule — the drag only adds
      // the pointer->fraction projection on top of it.
      const raw = (clientX - rect.left + inset / 2) / rect.width;
      return clampSplitFraction(rect.width, requestedInset, raw);
    },
    [],
  );

  const onDividerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      draggingRef.current = true;
      // jsdom (unit tests) does not implement pointer capture — the same
      // optional-call idiom the annotation overlays use.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      onSplitChange(fractionFor(e.clientX));
    },
    [fractionFor, onSplitChange],
  );
  const onDividerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) return;
      onSplitChange(fractionFor(e.clientX));
    },
    [fractionFor, onSplitChange],
  );
  const onDividerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false;
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture?.(e.pointerId) === true) {
      el.releasePointerCapture?.(e.pointerId);
    }
  }, []);

  // A pane can only be filled by a tab that has a live document and is not
  // already in the other pane.
  const pickOptions = tabs.filter(
    (tab) => tab.id !== multiMode.paneA && tab.id !== multiMode.paneB,
  );

  const emptyPanes: PaneId[] = multiOn
    ? (["A", "B"] as const).filter((pane) => paneTabId(multiMode, pane) === null)
    : [];

  return (
    <div
      className="tab-stage"
      ref={stageRef}
      data-multi-mode={multiOn ? "true" : "false"}
      data-multi-panes={multiOn ? String(2 - emptyPanes.length) : undefined}
      style={stageStyle}
    >
      {showWelcome ? (
        <div className="tab-pane" key={welcomeKey}>
          {welcome}
        </div>
      ) : (
        <>
          {multiOn && sharedToolbar !== undefined && sharedToolbar !== null ? (
            <div className="multi-toolbar-row" data-shared-toolbar ref={toolbarRowRef}>
              {sharedToolbar}
            </div>
          ) : null}
          {tabs.map((tab) => {
            const pane: PaneId | null = !multiOn
              ? null
              : multiMode.paneA === tab.id
                ? "A"
                : multiMode.paneB === tab.id
                  ? "B"
                  : null;
            const visible = multiOn ? pane !== null : tab.id === activeId;
            const focused = pane !== null && multiMode.focused === pane;
            return (
              <div
                key={tab.id}
                className="tab-pane"
                data-pane={pane ?? undefined}
                data-pane-focused={pane === null ? undefined : focused ? "true" : "false"}
                style={{ visibility: visible ? "visible" : "hidden" }}
                aria-hidden={!visible}
                // Clicking anywhere in the pane (page, header, scrollbar
                // region) focuses it. Capture phase so a child that stops
                // bubbling cannot steal the focus move, and no
                // preventDefault/stopPropagation — this handler must never
                // swallow the gesture (cross-bubbling rule).
                onPointerDownCapture={
                  pane !== null && !focused ? (): void => onFocusPane(pane) : undefined
                }
              >
                {pane !== null ? (
                  <MultiPaneHeader
                    pane={pane}
                    title={tab.title}
                    pageCount={tab.pageCount}
                    onClear={(): void => onClearPane(pane)}
                  />
                ) : null}
                {renderDocument(tab.id, pane)}
              </div>
            );
          })}
          {emptyPanes.map((pane) => (
            <div
              key={`empty-${pane}`}
              className="tab-pane"
              data-pane={pane}
              data-pane-empty
              data-pane-focused={multiMode.focused === pane ? "true" : "false"}
              style={{ visibility: "visible" }}
              onPointerDownCapture={
                multiMode.focused === pane ? undefined : (): void => onFocusPane(pane)
              }
            >
              <MultiPaneEmpty
                pane={pane}
                options={pickOptions}
                onPick={onPickPane}
                onOpen={onOpenIntoPane}
              />
            </div>
          ))}
          {multiOn ? (
            <MultiDivider
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
            />
          ) : null}
          {/* Phase 33 / DEF-284 — ONE All Tools badge for the whole
              workspace. It is `position: fixed` (window right edge), so it
              keeps a stable position as focus moves between panes; rendering
              it here (not per pane) is what makes Multi Mode satisfy
              criterion 4b. */}
          {multiOn && toolsBadge !== undefined && toolsBadge !== null ? toolsBadge : null}
        </>
      )}
    </div>
  );
}
