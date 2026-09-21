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

import { useCallback, useRef } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { Columns2, FileText, FolderOpen, GripVertical, X } from "lucide-react";
import { paneTabId, type MultiModeState, type PaneId } from "../state/multiMode";
import { SHARED_RAIL_WIDTH_PX } from "./MultiRail";

/** A tab that can fill a pane: a real document with a name and page count. */
export interface StageTab {
  id: string;
  title: string;
  pageCount: number;
}

/** The smallest comfortable pane width the divider can produce. */
export const MIN_PANE_WIDTH_PX = 320;

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
  /** Builds the `DocumentView` element for a tab id (App owns the props). */
  renderDocument: (tabId: string) => ReactNode;
  /** Phase 32 (chunk 2b) — the ONE shared rail holding a section per
   *  loaded document. Rendered only in Multi Mode; `null` (or omitted)
   *  keeps single mode exactly as it was, and also keeps the two-pane
   *  layout rail-less when nothing is loaded. */
  sharedRail?: ReactNode | null;
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
    sharedRail = null,
  } = props;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const multiOn = multiMode.enabled;
  // The shared rail reserves a real column on the left of the stage: the
  // panes and the divider measure the split against the space that is
  // actually left, so the divider still tracks the pointer 1:1.
  const railOn = multiOn && sharedRail !== null;
  const railWidth = railOn ? SHARED_RAIL_WIDTH_PX : 0;
  const stageStyle = {
    // Kept for the existing e2e/unit contract (`--tf-split` is the
    // divider's position as a percentage of the stage).
    "--tf-split": `${(splitFraction * 100).toFixed(3)}%`,
    // The panes' geometry needs the fraction as a NUMBER so CSS can
    // multiply it by a length-percentage (calc cannot multiply by a
    // percentage value).
    "--tf-split-frac": String(splitFraction),
    // The shared rail's column width: the SAME constant MultiRail measures
    // its thumbnails against and the drag math below subtracts, so the
    // three can never drift. Absent when there is no rail (the CSS base
    // value of 0px applies).
    ...(railOn ? { "--tf-shared-rail-w": `${SHARED_RAIL_WIDTH_PX}px` } : {}),
  } as CSSProperties;

  /** Clamp a pointer x to a fraction that keeps both panes usable. */
  const fractionFor = useCallback(
    (clientX: number): number => {
      const el = stageRef.current;
      if (el === null) return 0.5;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0.5;
      // The shared rail is not part of the split: measure the drag across
      // the pane region only, so the divider stays under the pointer.
      const usable = rect.width - railWidth;
      if (usable <= 0) return 0.5;
      const min = MIN_PANE_WIDTH_PX / usable;
      // Below two minimum panes the split is meaningless: park it centred.
      if (min >= 0.5) return 0.5;
      const raw = (clientX - rect.left - railWidth) / usable;
      return Math.min(1 - min, Math.max(min, raw));
    },
    [railWidth],
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
      // Phase 32 (chunk 2b) — the stage reserves the shared rail's column
      // (CSS reads this attribute to offset pane A and the divider).
      data-shared-rail={railOn ? "true" : undefined}
      style={stageStyle}
    >
      {showWelcome ? (
        <div className="tab-pane" key={welcomeKey}>
          {welcome}
        </div>
      ) : (
        <>
          {railOn ? sharedRail : null}
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
                {renderDocument(tab.id)}
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
        </>
      )}
    </div>
  );
}
