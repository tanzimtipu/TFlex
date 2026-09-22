// Phase 33 (chunk 3) — the per-pane thumbnail strip for Multi Mode.
//
// Supersedes Phase 32's ONE shared rail with a labelled section per
// document. In Multi Mode each pane owns its OWN strip, rendered at that
// pane's INNER edge by DocumentView (`railSide`): pane A's strip sits
// immediately to the RIGHT of pane A's pages, pane B's immediately to the
// LEFT of pane B's pages, so the two strips meet in the MIDDLE of the
// workspace, flanking the divider:
//
//     [A pages | A thumbs || B thumbs | B pages]
//
// The strip is the shared rail's section, promoted to a full rail: its own
// scroll container, its own header (pane badge + document name + page
// count), its own dynamically computed thumb width and the chunk-2d
// document-aware drag wiring. Only the width differs from the single-mode
// rail — the Thumb render/cleanup/virtualization rules are the same code
// path (ThumbnailRail), so a large document never rasterizes every
// thumbnail at once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ThumbnailRail } from "./SideRail";
import { computeThumbWidth } from "./thumbGeometry";
import { buildPageLabelMap } from "./pageGeometry";
import type { EngineState } from "../engine/types";
import type { PaneId } from "../state/multiMode";
import type { PageDropOp } from "../state/pageDrag";
import { usePageDragOptional } from "../state/PageDragContext";

/** The strip's own width at rest — the same 220px column the single-mode
 *  rail occupies (--tf-rail-w). It is the measurement fallback and the
 *  value used in jsdom, where clientWidth is always 0. */
export const STRIP_WIDTH_PX = 220;

export interface PaneThumbStripProps {
  /** Which pane this strip belongs to (A or B); drives the badge. */
  pane: PaneId;
  /** This pane's document (the tab id) — the strip's drag source identity. */
  tabId: string;
  /** The document name shown in the strip header. */
  title: string;
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  defaultWidthPt: number;
  defaultHeightPt: number;
  pageSizes?: Map<number, { w: number; h: number }> | null;
  engineState: EngineState;
  proxyVisibleOrder: boolean;
  canUndo: boolean;
  onOp?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
/** A thumbnail click: focus THIS pane, then navigate it to `page`. The
   *  focus move keeps the app's active-tab routing in step even when the
   *  click is synthetic (the pane's own pointerdown capture handles the
   *  real gesture). */
  onJump: (page: number) => void;
  /** Focus this strip's pane (the header is a click target too). */
  onFocusPane: () => void;
  /** How many documents are loaded across the strips (1 or 2). The strips
   *  sit side by side in the middle, so each keeps the Phase-32
   *  area-preserving thumb width for that count. */
  documentCount: number;
  /** Phase 32 (chunk 2d) — document-aware drag wiring; makes this strip a
   *  cross-document drag source/target. */
  crossDoc: { tabId: string; onDrop: (op: PageDropOp) => void };
}
export function PaneThumbStrip(props: PaneThumbStripProps): ReactElement {
  const {
    pane,
    tabId,
    title,
    doc,
    pageCount,
    currentPage,
    defaultWidthPt,
    defaultHeightPt,
    pageSizes = null,
    engineState,
    proxyVisibleOrder,
    canUndo,
    onOp,
    onDelete,
    onReorder,
    onUndo,
    onJump,
    onFocusPane,
    documentCount,
    crossDoc,
} = props;

  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(STRIP_WIDTH_PX);

  // A thumbnail click focuses this strip's pane first (the same
  // pane-follows-the-click behaviour the phase-32 rail had), then lands
  // the page in this pane's own document.
  const jumpAndFocus = useCallback(
    (page: number): void => {
      onFocusPane();
      onJump(page);
    },
    [onFocusPane, onJump],
  );

  // The strip's own width, re-measured on resize (the divider drag narrows
  // a pane, so its strip must re-derive its thumb width live). jsdom (and a
  // not-yet-laid-out strip) reports 0: keep the 220px fallback rather than
  // collapsing every thumb to the minimum.
  useEffect(() => {
    const el = stripRef.current;
    if (el === null) return;
    const read = (): void => {
      const width = el.clientWidth;
      if (width > 0) setStripWidth((prev) => (prev === width ? prev : width));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const thumbWidth = computeThumbWidth(stripWidth, documentCount);

  // The same visible -> source mapping and label map the single-mode rail
  // consumes, so a reordered / labelled document renders identically here.
  const visibleToSource = useMemo(() => {
    const m = new Map<number, number>();
    const order = engineState.pageOrder;
    for (let i = 0; i < order.length; i += 1) {
      m.set(i + 1, order[i] + 1);
    }
    return m;
  }, [engineState.pageOrder]);
  const pageLabelMap = useMemo(
    () => buildPageLabelMap(engineState.pageLabels),
    [engineState.pageLabels],
  );

  // Phase 32 (chunk 2d) — the landing strip highlights while a
  // cross-document drag hovers it (the per-thumb slot affordance rides on
  // top of it). Read-only here; the ThumbnailRail below owns the drag state.
  const drag = usePageDragOptional();
  const dropTarget =
    drag !== null &&
    drag.target !== null &&
    drag.source !== null &&
    drag.source.tabId !== drag.target.tabId
      ? drag.target.tabId
      : null;

  return (
    <div
      className="pane-thumb-strip"
      data-pane-strip
      data-pane-strip-pane={pane}
      data-pane-strip-doc={tabId}
      data-pane-strip-drop-target={dropTarget === tabId ? "true" : undefined}
      ref={stripRef}
    >
      <button
        type="button"
        className="pane-thumb-strip-header"
        data-pane-strip-header
        onClick={onFocusPane}
        aria-label={`Focus pane ${pane}: ${title}`}
        title={`Show ${title} in pane ${pane}`}
      >
        <span className="multi-pane-badge pane-thumb-strip-badge" aria-hidden>
          {pane}
        </span>
        <span className="pane-thumb-strip-title" title={title}>
          {title}
        </span>
        <span className="pane-thumb-strip-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>
      </button>
      <div className="pane-thumb-strip-body" data-pane-strip-body>
        <ThumbnailRail
          doc={doc}
          pageCount={pageCount}
          currentPage={currentPage}
          aspectRatio={defaultHeightPt / defaultWidthPt}
          pageSizes={pageSizes}
          rotations={engineState.rotations}
          visibleToSource={visibleToSource}
          proxyVisibleOrder={proxyVisibleOrder}
          pageLabelMap={pageLabelMap}
          canUndo={canUndo}
          onOp={onOp}
          onDelete={onDelete}
          onReorder={onReorder}
          onUndo={onUndo}
          onJump={jumpAndFocus}
          thumbWidth={thumbWidth}
          crossDoc={crossDoc}
        />
      </div>
    </div>
  );
}
