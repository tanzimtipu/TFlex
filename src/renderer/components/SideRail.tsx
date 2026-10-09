import { AlertCircle, Eye, MoreHorizontal, Plus, SquareChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon';
import { CommandMenu } from './CommandMenu';
import type { CommandMenuGroup, CommandMenuItem } from './CommandMenu';
import { clampMenuPosition } from './pageThumbMenu';
import { motion } from 'motion/react';
import type { ReactElement } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveOutlinePage, isInvalidPageRequest, type OutlineNode } from '../pdf/pdfjs';
import {
  cloneEntries,
  commitOutlineEdit,
  editAdd,
  editDelete,
  editIndent,
  editOutdent,
  editRename,
  editRetarget,
  entryAt,
  isFirstChild,
  isRootRow,
  type OutlineEditOutcome,
  type OutlineEntry,
  type OutlinePath,
  type SetOutlineFn,
} from '../state/outlineEditor';
import { useLiftAnimation } from '../hooks/useAnimations';
import { computeThumbGeometry, THUMB_WIDTH } from './thumbGeometry';
import { deferWork } from '../state/renderSuspend';
import type { EngineState } from '../engine/types';
import { usePageDragOptional } from '../state/PageDragContext';
import {
  buildDragSource,
  dropEffectFor,
  dropModeFromEvent,
  railInsertIndex,
  resolveDrop,
  type PageDropOp,
} from '../state/pageDrag';
import {
  applyPageSelectGesture,
  pageSelectGestureFor,
  samePageSelection,
  type PageSelectGesture,
  type PageSelectionState,
} from '../state/pageSelection';

/** The rail's three view tabs. Phase 59 — exported so the host can type its
 *  own `railTab` state and thread it in. */
export type RailTab = 'thumbs' | 'outline' | 'annotations';


// ---------------------------------------------------------------------------
// Thumbnails

// THUMB_WIDTH (126, today's single-mode thumbnail width) now lives in
// `thumbGeometry.ts` beside `computeThumbWidth`, the Phase-32 dynamic
// sizing rule: the two must share one definition so the multi-section
// rail's smaller width and the single-mode width can never drift.

// Geometry math for the thumbnail rail. Each thumbnail's bounding box height
// = (THUMB_WIDTH * aspectRatio, the wrap height) + the thumb's padding
// (6px top + 6px bottom) + 1px border top + 1px border bottom + the
// `thumb-label` text line (~18px) + the inter-thumb margin-bottom (6px).
// The thumb-scroller adds 8px of padding via var(--sp-2). This must match
// the actual DOM layout exactly so the per-page slot-top math
// (thumbSlotTops / visibleThumbRangeFromTops) matches reality.
const THUMB_PADDING_PX = 6;
const THUMB_BORDER_PX = 1;
const THUMB_LABEL_PX = 18;
const THUMB_MARGIN_BOTTOM_PX = 6;
// TFL-1465 — in card mode the footer row (checkbox + label + current eye + More)
// is now an ABSOLUTE overlay pinned to the page preview's bottom edge, so it no
// longer consumes any flow height. The card-mode slot math therefore adds 0 px
// below the preview (vs the plain 18px label line for the label-only rail/pane
// thumbs). This keeps the navigator's virtualization walk aligned with the new
// HUG card height: wrap + 6px padding*2 + 1px border*2 + 0 + 6px margin.
const THUMB_CARD_FOOTER_PX = 0;
const THUMB_OUTER_PADDING = 8;
// Initial thumbs on open dropped from 6 -> 3: each thumb keeps a backing
// ImageBitmap (~190KB at dpr 1.5), so 3 fewer mounted thumbs at startup
// is ~570KB less idle memory. Combined with the page-mount reductions
// in DocumentView this brings long.pdf idle closer to the budget
// (DEF-016).
const INITIAL_THUMBS = 3;
// Thumb buffer dropped from 4 -> 1: same per-thumb bitmap cost; the
// geometry-based mount already keeps a tight visible range, so the
// extra buffer mostly pinned memory without meaningfully improving
// scroll. Saves ~1MB idle GPU memory on long.pdf (DEF-016).
const THUMB_BUFFER = 1;

/** DEF-148 — the CSS wrap height for a single thumb. A page whose
 *  size is known (`pageSize`, un-rotated pt) gets the height its OWN
 *  aspect ratio implies — the canvas is rendered by
 *  `computeThumbGeometry` at exactly `floor(thumbWidth * h / w)`, so
 *  the wrap must match that (floor, not round, so a full-page canvas
 *  is never clipped into a crop-square wrap). Pages with no reported
 *  size yet fall back to the `defaultAspect` (the largest known page
 *  or the doc's page-1 default). Phase 32: `thumbWidth` is the rail's
 *  computed width (126 in single mode, smaller for a multi-document
 *  shared rail) — it defaults to THUMB_WIDTH so every existing caller
 *  keeps today's geometry exactly. */
function thumbWrapHeightFor(
  pageSize: { w: number; h: number } | null,
  defaultAspect: number,
  thumbWidth: number = THUMB_WIDTH,
): number {
  if (pageSize !== null && pageSize.w > 0) {
    return Math.floor((thumbWidth * pageSize.h) / pageSize.w);
  }
  return Math.round(thumbWidth * defaultAspect);
}

/** Each thumb's bounding box height = wrap-height + padding-top +
 *  padding-bottom + border-top + border-bottom + label + margin-bottom.
 *  The next thumb's top is exactly one slot below the previous top. */
function thumbSlotHeightFor(
  pageSize: { w: number; h: number } | null,
  defaultAspect: number,
  thumbWidth: number = THUMB_WIDTH,
  labelHeight: number = THUMB_LABEL_PX,
): number {
  const wrapHeight = thumbWrapHeightFor(pageSize, defaultAspect, thumbWidth);
  return (
    wrapHeight +
    THUMB_PADDING_PX * 2 +
    THUMB_BORDER_PX * 2 +
    labelHeight +
    THUMB_MARGIN_BOTTOM_PX
  );
}

/** Per-page slot tops (DEF-148): `tops[p]` (1-based, `tops[0]`
 *  unused) is the scroll offset of the p-th thumb INCLUDING the
 *  scroller's 8px padding; `tops[p + 1] - tops[p]` is that page's
 *  slot height. Each page contributes its OWN wrap height, so a
 *  mixed-size document (page 1 cropped square, rest full page) lays
 *  out correctly instead of collapsing every slot to page 1's size. */
function thumbSlotTops(
  pageCount: number,
  sizeForPage: (p: number) => { w: number; h: number } | null,
  defaultAspect: number,
  thumbWidth: number = THUMB_WIDTH,
  columns = 1,
  labelHeight: number = THUMB_LABEL_PX,
): number[] {
  // Phase 111 (chunk B) — `columns` lets the PAGES navigator lay its cards out
  // two-up at panel widths >= 360px. Each grid row's height is its tallest
  // card; pages sharing a row share a top (their slot height reads 0), so the
  // existing visible-range walk keeps working. `columns = 1` reproduces the
  // pre-chunk-B single-column tops byte-for-byte.
  const cols = Math.max(1, Math.floor(columns));
  const pageTop: number[] = new Array(pageCount + 2).fill(THUMB_OUTER_PADDING);
  let rowTop = THUMB_OUTER_PADDING;
  for (let start = 1; start <= pageCount; start += cols) {
    const rowEnd = Math.min(start + cols - 1, pageCount);
    let rowHeight = 0;
    for (let p = start; p <= rowEnd; p += 1) {
      pageTop[p] = rowTop;
      rowHeight = Math.max(rowHeight, thumbSlotHeightFor(sizeForPage(p), defaultAspect, thumbWidth, labelHeight));
    }
    rowTop += rowHeight;
  }
  const tops: number[] = [0, THUMB_OUTER_PADDING];
  for (let p = 2; p <= pageCount; p += 1) {
    tops.push(pageTop[p]);
  }
  tops.push(rowTop);
  return tops;
}

/** Visible page range given the per-page slot tops. Lives beside the
 *  old uniform-slot formula but walks the per-page prefix sums so a
 *  mixed-size doc mounts the exact pages in view (DEF-148). */
function visibleThumbRangeFromTops(
  tops: number[],
  scrollTop: number,
  viewportHeight: number,
  buffer = THUMB_BUFFER,
): { start: number; end: number } {
  // tops = [0, pad, page1Top, page2Top, ..., pageNTop, afterLast]
  // (length N + 2), so the page count is one less than the length
  // minus the leading [0, pad] pair.
  const pageCount = tops.length - 2;
  if (pageCount <= 0) return { start: 1, end: 1 };
  const top0 = scrollTop - THUMB_OUTER_PADDING;
  const bottom0 = scrollTop + viewportHeight - THUMB_OUTER_PADDING;
  let first = 0;
  let last = 0;
  for (let p = 1; p <= pageCount; p += 1) {
    const top = tops[p];
    if (top === undefined) break;
    const bottom = tops[p + 1] ?? top;
    if (bottom <= top0) continue;
    if (top > bottom0) break;
    if (first === 0) first = p;
    last = p;
  }
  if (first === 0) {
    // Scrolled past the last page (or an empty viewport): pin the
    // range to the final page so the mount always renders something.
    first = pageCount;
    last = pageCount;
  }
  return {
    start: Math.max(1, first - buffer),
    end: Math.min(pageCount, last + buffer),
  };
}

export interface ThumbnailRailProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  /** The fallback page aspect (h/w) for pages without a reported
   *  per-page size (fresh open / tests). DEF-148: the per-page
   *  `pageSizes` map, when present, wins for every page that has
   *  one. */
  aspectRatio: number;
  /** DEF-148 — per-VISIBLE-page sizes (un-rotated pt). Every thumb
   *  wrap is sized from ITS OWN page's aspect ratio; the fallback is
   *  the LARGEST known page (never page 1's post-crop size), so a
   *  per-page crop of page 1 leaves pages 2..N at full-page
   *  thumbnails. */
  pageSizes?: Map<number, { w: number; h: number }> | null;
  rotations: EngineState['rotations'];
  /** Maps 1-based visible index -> 1-based source page in the underlying
   *  PDF.js document. Identity map for the stub; the real engine may
   *  reorder. */
  visibleToSource: Map<number, number>;
  /** DEF-139 — the pdf.js proxy is in VISIBLE file order after a
   *  `getDocumentBytes` refresh; when true the thumb bitmap comes from
   *  `doc.getPage(page)` (the visible slot) instead of the
   *  pageOrder-derived `visibleToSource` map (pdf-lib indices). */
  proxyVisibleOrder: boolean;
  /** Phase 12 — logical page labels per visible 1-based page. Null when
   //  no labels have been set (the common case); passed through to
   //  each Thumb so the rail can show the user's custom label instead
   //  of the raw page number. */
  pageLabelMap?: Map<number, string> | null;
  canUndo: boolean;
  /* Phase 40 (item 9) — the per-page rotate/delete UI that consumed these
   * was retired (its homes are the Action Dock's page verbs and the page
   * right-click menu). The props stay on the rail's contract so every
   * caller/test keeps passing them unchanged; the rail itself no longer
   * wires them to any control. */
  onOp?: (op: { kind: 'rotate'; page: number; dir: 'cw' | 'ccw' }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  onJump: (page: number) => void;
  /** Phase 32 — the computed thumbnail width for THIS rail instance.
   *  Defaults to THUMB_WIDTH (126) so the single-mode rail is byte-for-
   *  byte today's rail; the Multi Mode shared rail passes
   *  `computeThumbWidth(...)`, a smaller value with two documents loaded.
   *  Only the width changes: the Thumb render/cleanup/virtualization
   *  rules are the same code path either way. */
  thumbWidth?: number;
  /** Phase 32 (chunk 2d) — the document-aware drag wiring. Present only in
   *  the Multi Mode shared rail (one instance per section); absent in single
   *  mode, where the rail keeps its pre-Phase-32 local drag state and its
   *  existing intra-document reorder semantics byte-for-byte. */
  crossDoc?: {
    /** This section's document (the tab id). */
    tabId: string;
    /** Apply a resolved drop; App owns the engine + refresh sequence. */
    onDrop: (op: PageDropOp) => void;
  } | null;
  /** Phase 36 (chunk 2) — the PAGES ContextPanel's inline hover verbs.
   *  Present ONLY on the ContextPanel's rail instance; every other caller
   *  (SideRail, PaneThumbStrip) passes nothing, so their DOM, geometry and
   *  drag behaviour are unchanged. Each verb is handed this thumb's VISIBLE
   *  1-based page and runs the caller's EXISTING per-page handler. */
  thumbVerbs?: ThumbVerbs | null;
  /** Phase 36 (chunk 2) — a right-click on a thumbnail (the ContextPanel's
   *  menu). Receives the VISIBLE 1-based page plus the pointer's viewport
   *  coordinates; absent everywhere else, so the native menu is untouched. */
  onThumbContextMenu?: ThumbContextMenuHandler | null;
  /** Phase 36 (chunk 3a) — the ContextPanel's multi-select SET (visible
   *  1-based pages, ascending). Present ONLY on the panel's rail instance;
   *  SideRail and PaneThumbStrip pass nothing and keep their single-selection
   *  behaviour byte-for-byte. When the callback is present the rail is
   *  CONTROLLED: it reads the set and reports every gesture's new set to the
   *  host (DocumentView), which is what the ActionDock consumes. */
  pageSelection?: readonly number[] | null;
  onPageSelectionChange?: ((pages: number[]) => void) | null;
  /** TFL-1116 R04 — a document-scoped COMMITTED-navigation counter. The
   *  host (DocumentView) bumps it every time a page jump is committed by
   *  any surface outside this rail (the ViewStrip page input, the
   *  Next/Previous verbs, an external jump request, an outline or
   *  annotation jump, the initial-page restore). When it changes the rail
   *  scrolls `currentPage`'s thumb into view, exactly like a rail click
   *  does — while an ordinary scroll-driven `currentPage` change leaves
   *  the counter untouched, preserving the Bug 3 gate. Defaults to 0 so
   *  every direct consumer/test that omits it keeps the pre-R04 behaviour
   *  byte-for-byte. */
  revealSeq?: number;
}

/** Phase 36 (chunk 2) — ContextPanel's per-thumbnail verbs. */
export interface ThumbVerbs {
  onRotateCw: (page: number) => void;
  onExtract: (page: number) => void;
  onDelete: (page: number) => void;
}

/** Phase 36 (chunk 2) — `(visiblePage, clientX, clientY)`. */
export type ThumbContextMenuHandler = (page: number, x: number, y: number) => void;

/** Phase 32 — exported so the Multi Mode shared rail can render one
 *  instance per loaded document (each with its own scroll container and
 *  its own visible+buffered window). */
export function ThumbnailRail({
  doc,
  pageCount,
  currentPage,
  aspectRatio,
  pageSizes = null,
  rotations,
  visibleToSource,
  proxyVisibleOrder,
  pageLabelMap = null,
  canUndo,
  onReorder,
  onUndo,
  onJump,
  thumbWidth = THUMB_WIDTH,
  crossDoc = null,
  thumbVerbs = null,
  onThumbContextMenu = null,
  pageSelection = null,
  onPageSelectionChange = null,
  revealSeq = 0,
}: ThumbnailRailProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const thumbElsRef = useRef(new Map<number, HTMLElement>());
  // Bug 3 — the page the rail itself wants to scroll into view.
  // When the user clicks a thumbnail we set this to the click's
  // visible-index so the recentre effect (above) only fires when
  // the jump originated from a rail click, not when DocumentView
  // pushed a new currentPage as the user scrolled through the
  // main view. Cleared at the start of that effect so a single
  // click only recentres once.
  const railJumpTargetRef = useRef<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const ioExtraThumbsRef = useRef<Set<number>>(new Set());
  const [visibleThumbs, setVisibleThumbs] = useState<Set<number>>(new Set());
  // Phase 111 (chunk B) — the PAGES navigator's optional two-column card grid
  // at content widths >= 360px. Only the ContextPanel's card mode (thumbVerbs
  // present) opts in; every other rail stays single-column byte-for-byte.
  const [twoCol, setTwoCol] = useState(false);
  // Per-thumb drag state. We use HTML5 drag-and-drop: dragging a thumb
  // paints it as the drag source, dropping it on another thumb inserts it
  // before that target. The reorder index is the visible 1-based index,
  // which is what the engine consumes.
  //
  // Phase 32 (chunk 2d): in the Multi Mode shared rail (`crossDoc` present)
  // the SAME model is document-aware — the source/target carry tab ids and
  // live in the shared drag context so a drag can cross sections. Single
  // mode (`crossDoc` absent) keeps these local page-only states untouched.
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Phase 36 (chunk 3a) — multi-select. When `onPageSelectionChange` is wired
  // (the ContextPanel only) the SET is host-owned and the rail is controlled:
  // Ctrl/Cmd toggles a page, Shift extends from the anchor, a plain click
  // navigates AND leaves exactly that page selected, and a click on empty
  // panel space clears. The anchor is a gesture cursor, kept locally because
  // it is not app state. Everything below derives from the same `selectedSet`
  // so the legacy single-selection consumers (the action bar, the drag
  // wiring) keep working unchanged.
  const multiSelect = onPageSelectionChange != null;
  const [anchor, setAnchor] = useState<number | null>(null);
  const selectionPages = multiSelect ? pageSelection ?? [] : null;
  const selectedSet = useMemo(
    () => new Set<number>(selectionPages ?? []),
    [selectionPages],
  );
  const singleSelected = multiSelect
    ? selectionPages !== null && selectionPages.length === 1
      ? selectionPages[0]
      : null
    : selected;
  const applyPageGesture = useCallback(
    (page: number, gesture: PageSelectGesture): void => {
      if (!multiSelect) {
        // Legacy path (SideRail / PaneThumbStrip): the modifier click selects.
        setSelected(page);
        return;
      }
      const current: PageSelectionState = { pages: selectionPages ?? [], anchor };
      const next = applyPageSelectGesture(current, page, gesture, pageCount);
      if (next === current) return;
      if (next.anchor !== current.anchor) setAnchor(next.anchor);
      if (!samePageSelection(next.pages, current.pages)) {
        onPageSelectionChange?.([...next.pages]);
      }
    },
    [multiSelect, selectionPages, anchor, pageCount, onPageSelectionChange],
  );
  const railRootRef = useRef<HTMLDivElement | null>(null);
  const drag = usePageDragOptional();
  const docAware = crossDoc !== null && drag !== null;
  const dragSource = docAware ? drag.source : null;
  const dragTarget = docAware ? drag.target : null;
  // The page painted as the drag source: only when the active drag started
  // in THIS section.
  const draggingPage = !docAware
    ? dragFromIndex
    : dragSource !== null && crossDoc !== null && dragSource.tabId === crossDoc.tabId
      ? dragSource.anchorPage
      : null;
  // The landing slot in THIS section (1-based insert-before index).
  const dropPage = !docAware
    ? dropTarget
    : dragTarget !== null && crossDoc !== null && dragTarget.tabId === crossDoc.tabId
      ? dragTarget.atIndex
      : null;
  const dragActive = docAware ? dragSource !== null : dragFromIndex !== null;

  // DEF-148 — per-VISIBLE-page sizes. `sizeForPage(p)` returns the
  // page's own reported size (`pageSizes`, keyed by visible 1-based
  // index — the same key the main view's onPageSize uses), else null.
  // The doc-wide fallback is the LARGEST known page (never page 1's
  // LIVE size): after a per-page crop of page 1, the map still holds
  // the full 612x792 of pages 2..N, so uncropped pages keep
  // full-page thumbnails instead of collapsing to the crop square.
  const fallbackAspect = useMemo(() => {
    let best: { w: number; h: number } | null = null;
    for (const s of pageSizes?.values() ?? []) {
      if (s === null || s.w <= 0 || s.h <= 0) continue;
      if (best === null || s.w * s.h > best.w * best.h) best = s;
    }
    return best !== null ? best.h / best.w : aspectRatio;
  }, [pageSizes, aspectRatio]);

  const sizeForPage = useCallback(
    (p: number): { w: number; h: number } | null => {
      const s = pageSizes?.get(p);
      if (s !== undefined && s.w > 0 && s.h > 0) return s;
      return null;
    },
    [pageSizes],
  );

  const slotTops = useMemo(
    () =>
      thumbSlotTops(
        pageCount,
        sizeForPage,
        fallbackAspect,
        thumbWidth,
        twoCol ? 2 : 1,
        thumbVerbs !== null ? THUMB_CARD_FOOTER_PX : THUMB_LABEL_PX,
      ),
    [pageCount, sizeForPage, fallbackAspect, thumbWidth, twoCol, thumbVerbs],
  );

  const computeGeometryMountRef = useRef<() => void>(() => undefined);
  computeGeometryMountRef.current = (): void => {
    const scroller = scrollerRef.current;
    const range = visibleThumbRangeFromTops(
      slotTops,
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
    );
    const rangeStart = range.start;
    const rangeEnd = range.end;
    setVisibleThumbs((prev) => {
      // Prune IO extras aggressively: each kept thumb holds a backing
      // ImageBitmap (~190KB at dpr 1.5), so a 520-page doc with a wide
      // buffer can keep dozens of fully-rendered thumbs alive. The
      // rail re-renders from scratch on scroll, so the visible range is
      // the only must-have set; IO extras within a small window cover
      // the IntersectionObserver's lag.
      const PRUNE_DISTANCE = 6;
      const keepLow = rangeStart - PRUNE_DISTANCE;
      const keepHigh = rangeEnd + PRUNE_DISTANCE;
      for (const p of ioExtraThumbsRef.current) {
        if (p < keepLow || p > keepHigh) {
          ioExtraThumbsRef.current.delete(p);
        }
      }
      const next = new Set<number>();
      for (let p = rangeStart; p <= rangeEnd; p += 1) {
        next.add(p);
      }
      for (const p of ioExtraThumbsRef.current) {
        if (p >= rangeStart && p <= rangeEnd) {
          next.add(p);
        }
      }
      if (next.size === prev.size) {
        let same = true;
        for (const p of next) {
          if (!prev.has(p)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting && !ioExtraThumbsRef.current.has(page)) {
            ioExtraThumbsRef.current.add(page);
            changed = true;
          }
        }
        if (changed) {
          computeGeometryMountRef.current();
        }
      },
      { root: scroller, rootMargin: '400px 0px', threshold: 0 },
    );
    observerRef.current = io;
    for (const el of thumbElsRef.current.values()) {
      io.observe(el);
    }
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    // Phase 111 (chunk B) — measure the navigator content width so the card
    // grid can switch to two columns at >= 360px. Only the ContextPanel's
    // card mode (thumbVerbs) opts in.
    const measure = (): void => {
      const next = thumbVerbs !== null && el.clientWidth >= 360;
      setTwoCol((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(() => {
      measure();
      computeGeometryMountRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [thumbVerbs]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) return;
    const onScroll = (): void => {
      computeGeometryMountRef.current();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pageCount <= 0) return;
    const initialEnd = Math.min(pageCount, INITIAL_THUMBS);
    const lo = Math.max(1, currentPage - THUMB_BUFFER);
    const hi = Math.min(pageCount, currentPage + THUMB_BUFFER);
    setVisibleThumbs((prev) => {
      const next = new Set(prev);
      for (let p = 1; p <= initialEnd; p += 1) {
        next.add(p);
        ioExtraThumbsRef.current.add(p);
      }
      for (let p = lo; p <= hi; p += 1) {
        next.add(p);
        ioExtraThumbsRef.current.add(p);
      }
      // TFL-1116 R04 / DEF-619 — bail out when the visible set is byte-identical.
      // This effect's deps include `slotTops`, which changes identity whenever a
      // page reports its size; during a far committed jump the canvas reports
      // many sizes in quick succession, and returning a NEW Set each time forced
      // a rail re-render per report. That render/effect cascade could exceed
      // React's update-depth limit (error #185) and blank the window. Returning
      // `prev` when nothing changed makes the effect idempotent; the seeding and
      // geometry behaviour are unchanged.
      if (next.size === prev.size) {
        let same = true;
        for (const p of next) {
          if (!prev.has(p)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
    computeGeometryMountRef.current();
  }, [pageCount, currentPage, slotTops]);

  // TFL-1116 R04 — the reveal counter's last-seen value. Seeded to -1 so the
  // FIRST effect run always reveals the mounted `currentPage` (a document
  // reopened on its stored reading page shows that thumb immediately); every
  // later run only reveals when the host commits a new jump.
  const lastRevealSeqRef = useRef(-1);
  // TFL-1116 R04 — the page a committed navigation still needs pinned into
  // view. Kept until an ordinary scroll-driven `currentPage` change supersedes
  // it, so a geometry change that lands just AFTER the jump (the panel
  // resizing and flipping the rail to two columns, page sizes reporting) still
  // re-centres instead of leaving the viewed thumb off-screen.
  const pendingRevealPageRef = useRef<number | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || pageCount <= 0) return;
    // TFL-1116 R04 — a COMMITTED navigation signal from the host. This is
    // true only when DocumentView's `jumpToPage` ran (ViewStrip input,
    // Next/Previous, an external/Multi Mode request, an outline/annotation
    // jump, or the initial-page restore) — never for a scroll-driven
    // `currentPage` change.
    const committed = revealSeq !== lastRevealSeqRef.current;
    // Bug 3 — a rail-originated thumb click still pins via this ref, so the
    // two paths share one centre routine. Neither fires for the main view's
    // scroll: the committed counter is unchanged and the ref only matches the
    // click's own page.
    const railClick = railJumpTargetRef.current === currentPage;
    if (committed) {
      lastRevealSeqRef.current = revealSeq;
      pendingRevealPageRef.current = currentPage;
    } else if (railClick) {
      pendingRevealPageRef.current = currentPage;
    } else if (
      pendingRevealPageRef.current !== null &&
      pendingRevealPageRef.current !== currentPage
    ) {
      // The main view scrolled to a different page: the reveal is spent.
      pendingRevealPageRef.current = null;
    }
    if (railClick) railJumpTargetRef.current = null;
    const target = pendingRevealPageRef.current;
    if (target === null) return;
    // Scroll the page's ACTUAL thumbnail element into view. The per-page slot
    // geometry (`slotTops`) is a uniform estimate used for the virtualised
    // window; the rendered card's real pitch can differ (card footer, label,
    // borders), and over hundreds of pages that drift is more than a viewport.
    // Reading the live element's box is layout-truth, so the viewed thumb is
    // centred no matter how large the document is.
    const el = thumbElsRef.current.get(target);
    if (el === undefined) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elOffset = elRect.top - scrollerRect.top + scroller.scrollTop;
    const desiredTop = elOffset - scroller.clientHeight / 2 + elRect.height / 2;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.max(0, Math.min(desiredTop, maxTop));
    if (Math.abs(scroller.scrollTop - nextTop) > 1) {
      scroller.scrollTop = nextTop;
    }
  }, [currentPage, pageCount, revealSeq, twoCol]);

  // Drop selection when the selected page goes away (delete, etc.). In
  // multi-select the HOST prunes the set (DocumentView), so this legacy
  // single-selection guard only runs for the rail / pane-strip instances.
  useEffect(() => {
    if (multiSelect) return;
    if (selected !== null && selected > pageCount) {
      setSelected(null);
    }
  }, [multiSelect, selected, pageCount]);

const onDragStart = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    // Phase 32 (chunk 2d): a drag started here carries this section's
    // document id into the shared context so the other section (and the
    // canvas) can recognise it as a cross-document drag. Single mode keeps
    // the page-only local state and its 'move' effect exactly as today.
    if (docAware && crossDoc !== null && drag !== null) {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', String(page));
      // Phase 36 (chunk 3a) — in multi-select the drag carries the whole SET
      // (the engine's cross-document path already takes a page array); every
      // other instance keeps today's single-page source exactly.
      const dragPages =
        multiSelect && selectionPages !== null && selectionPages.length > 0
          ? [...selectionPages]
          : singleSelected === null
            ? null
            : [singleSelected];
      drag.begin(buildDragSource(crossDoc.tabId, page, dragPages));
      return;
    }
    setDragFromIndex(page);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(page));
  };
  const onDragOver = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    if (docAware && crossDoc !== null && drag !== null) {
      if (drag.source === null) return;
      e.preventDefault();
      const mode = dropModeFromEvent(e);
      e.dataTransfer.dropEffect = dropEffectFor(mode);
      drag.hover({ tabId: crossDoc.tabId, atIndex: railInsertIndex(page), mode });
      return;
    }
    if (dragFromIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== page) setDropTarget(page);
  };
  const onDragLeave = (e: React.DragEvent<HTMLElement>): void => {
    if (docAware && drag !== null) {
      // Only clear when the pointer actually left the section; moving
      // between two thumbs fires leave then enter, and clearing there
      // would flicker the affordance.
      const related = e.relatedTarget as Node | null;
      if (related !== null && railRootRef.current?.contains(related) === true) return;
      drag.hover(null);
      return;
    }
    setDropTarget(null);
  };
  const onDrop = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault();
    if (docAware && crossDoc !== null && drag !== null) {
      const mode = dropModeFromEvent(e);
      const op = resolveDrop(
        drag.source,
        { tabId: crossDoc.tabId, atIndex: railInsertIndex(page) },
        mode,
        pageCount,
      );
      drag.end();
      if (op !== null) crossDoc.onDrop(op);
      return;
    }
    const from = dragFromIndex;
    setDragFromIndex(null);
    setDropTarget(null);
    if (from === null || from === page) return;
    if (pageCount < 2) return;
    if (onReorder === undefined) return;
    const toIndex = from < page ? page - 1 : page;
    if (toIndex === from || toIndex < 1 || toIndex > pageCount) return;
    onReorder(from, toIndex);
  };
  const onDragEnd = (): void => {
    if (docAware && drag !== null) {
      drag.end();
      return;
    }
    setDragFromIndex(null);
    setDropTarget(null);
  };

  // Phase 32 (chunk 2d) — the section's empty space below the last thumb is
  // an APPEND drop target (-1) for a cross-document drag. The per-thumb
  // handlers bubble into these, so they bail when the event originated on a
  // thumb (which already resolved its own slot).
  const onScrollerDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!docAware || crossDoc === null || drag === null) return;
    if (drag.source === null) return;
    if ((e.target as HTMLElement).closest('.thumb') !== null) return;
    e.preventDefault();
    const mode = dropModeFromEvent(e);
    e.dataTransfer.dropEffect = dropEffectFor(mode);
    drag.hover({ tabId: crossDoc.tabId, atIndex: -1, mode });
  };
  const onScrollerDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!docAware || crossDoc === null || drag === null) return;
    if ((e.target as HTMLElement).closest('.thumb') !== null) return;
    e.preventDefault();
    const op = resolveDrop(
      drag.source,
      { tabId: crossDoc.tabId, atIndex: -1 },
      dropModeFromEvent(e),
      pageCount,
    );
    drag.end();
    if (op !== null) crossDoc.onDrop(op);
  };
  const onScrollerDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!docAware || drag === null) return;
    const related = e.relatedTarget as Node | null;
    if (related !== null && railRootRef.current?.contains(related) === true) return;
    drag.hover(null);
  };

  // Phase 36 (chunk 3a) — a click on EMPTY panel space clears the multi-select.
  // Bubble-phase and target-guarded (never a catch-all): a click that landed on
  // a thumbnail (or anything inside one) bails out, and nothing is
  // prevented/stopped, so every other handler still sees the event.
  const onScrollerClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!multiSelect) return;
    if (selectionPages === null || selectionPages.length === 0) return;
    if (e.target instanceof Element && e.target.closest('.thumb') !== null) return;
    setAnchor(null);
    onPageSelectionChange?.([]);
  };

  return (
    <div
      className="thumb-scroller"
      ref={railRootRef}
      onClick={multiSelect ? onScrollerClick : undefined}
      onDragOver={docAware ? onScrollerDragOver : undefined}
      onDrop={docAware ? onScrollerDrop : undefined}
      onDragLeave={docAware ? onScrollerDragLeave : undefined}
    >
      {pageCount > 0 && (
        <div className="rail-actions">
          <button
            type="button"
            className="btn btn-ghost rail-action-btn"
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            title={canUndo ? 'Undo last change' : 'Nothing to undo'}
            aria-label="Undo last change"
          >
            <Icon name="undo" size="xl" />
            <span>Undo last change</span>
          </button>
        </div>
      )}
      <div
        ref={scrollerRef}
        className={
          twoCol
            ? 'thumb-scroller-inner thumb-scroller-inner--two-col tf-panel-scroll'
            : 'thumb-scroller-inner tf-panel-scroll'
        }
        data-thumb-columns={twoCol ? '2' : '1'}
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          // DEF-139 — `sourcePage` is the 1-based pdf.js page to render
          // for this VISIBLE thumb slot. After a `refreshDocProxyFor`
          // rebuild the proxy's file pages are the engine's VISIBLE
          // order, so slot `page` IS file page `page`; the
          // `visibleToSource` map (pdf-lib ORIGINAL indices) only
          // addresses the original open bytes.
          const sourcePage = proxyVisibleOrder ? page : (visibleToSource.get(page) ?? page);
          const rot = rotations[page - 1] ?? 0;
          const isSel = multiSelect ? selectedSet.has(page) : selected === page;
          // `key={page}` keeps the React/DOM order stable (1..N), but the
          // bitmap comes from `sourcePage`, so when the engine reorders
          // the document the rendered thumbnails move in lockstep. The
          // numeric label stays at the visible position so the engine
          // ops (which use the visible index) remain unambiguous.
          //
          // DEF-058 — `currentPage` is the 1-based VISIBLE page index
          // (set by `jumpToPage` / scroll detection in DocumentView).
          // `sourcePage` is the underlying pdf.js page (after reorder
          // the two diverge: e.g. visible position 4 might come from
          // source page 2). Comparing `sourcePage === currentPage`
          // measured them on different scales, so after a jump the
          // active highlight stayed on page 1 (the only place where
          // the visible and source indices happened to agree at doc
          // open). Compare on the visible scale instead: `page`
          // (the loop index) is the 1-based visible slot, and
          // `currentPage` is the visible page the user is on. The
          // visual scroller's jump target uses visible indices, the
          // rail's selected page emits visible indices, and now the
          // rail's `isCurrent` highlight does too.
          return (
            <Thumb
              key={page}
              doc={doc}
              page={sourcePage}
              // DEF-148 — the wrap fallback is the LARGEST known page
              // aspect (never page 1's live post-crop size), so a page
              // whose per-page size has not re-reported since the crop
              // keeps a full-page wrap instead of the crop square.
              aspectRatio={fallbackAspect}
              pageSize={sizeForPage(page)}
              shouldRender={visibleThumbs.has(page)}
              isCurrent={page === currentPage}
              isSelected={isSel}
              isDragging={draggingPage === page}
              isDropTarget={dropPage === page && dragActive && draggingPage !== page}
              isDropAfter={
                dropPage === -1 &&
                dragActive &&
                page === pageCount &&
                draggingPage !== page
              }
              isDropCopy={dragTarget?.mode === 'copy'}
              rotation={rot}
              label={page}
              thumbWidth={thumbWidth}
              pageLabel={pageLabelMap === null ? null : pageLabelMap.get(page) ?? null}
              onJump={onJump}
              onSelect={setSelected}
              onSelectGesture={multiSelect ? applyPageGesture : null}
              onToggleSelected={
                multiSelect ? (p): void => applyPageGesture(p, 'toggle') : null
              }
              onDragStart={onDragStart(page)}
              onDragOver={onDragOver(page)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(page)}
              onDragEnd={onDragEnd}
              registerThumb={(p, el) => {
                if (el === null) {
                  thumbElsRef.current.delete(p);
                  return;
                }
                thumbElsRef.current.set(p, el);
                observerRef.current?.observe(el);
              }}
              onJumpFromRail={(label): void => {
                // Bug 3 — flag the recentre effect so the rail
                // pins the selected thumb into view. Cleared at
                // the top of the effect.
                railJumpTargetRef.current = label;
              }}
              thumbVerbs={thumbVerbs}
              onThumbContextMenu={onThumbContextMenu}
            />
          );
        })}
        {pageCount === 0 && (
          <div className="thumb-empty">
            <span>All pages removed.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Phase 16 — collapsed ruler strip: one numbered button per visible
// page, stacked vertically. Replaces the tab bodies whenever the pages
// panel is collapsed (regardless of the active tab); the current page
// is highlighted and every number is a click-to-jump target. Exported
// so unit tests can exercise the click handler directly. The per-button
// hover lift is the shared LiftMotionProps (micro distance — token
// driven, off under reduced motion); the colour wash stays in CSS.

export function RulerStrip({
  pageCount,
  currentPage,
  onJump,
}: {
  pageCount: number;
  currentPage: number;
  onJump: (page: number) => void;
}): ReactElement {
  const { hover } = useLiftAnimation({ distance: 'micro' });
  return (
    <div className="rail-ruler" data-rail-ruler>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
        <motion.button
          key={page}
          type="button"
          className={
            page === currentPage
              ? 'btn btn-ghost btn-compact rail-ruler-page rail-ruler-current'
              : 'btn btn-ghost btn-compact rail-ruler-page'
          }
          onClick={() => onJump(page)}
          data-ruler-page={page}
          /* AR-01 (TFL-1184) — the compact Navigator's current-page element.
             The thumb card carries `data-thumb-current-marker` (SideRail.tsx
             Thumb); the collapsed ruler is the only navigator surface mounted
             at compact widths, so the same machine-discoverable marker rides
             the current ruler item too. */
          data-thumb-current-marker={page === currentPage ? 'true' : undefined}
          {...hover}
        >
          {page}
        </motion.button>
      ))}
    </div>
  );
}

interface ThumbProps {
  doc: PDFDocumentProxy;
  page: number;
  /** Fallback page aspect (h/w) used when `pageSize` is null. */
  aspectRatio: number;
  /** DEF-148 — this thumb's OWN page size (un-rotated pt, keyed to
   *  the visible slot). When present the wrap is sized from THIS
   *  page's aspect ratio, so a cropped page gets a crop-sized wrap
   *  while every uncropped page keeps its full-page wrap. */
  pageSize?: { w: number; h: number } | null;
  shouldRender: boolean;
  isCurrent: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  /** Phase 34 (chunk 2) — this is the APPEND landing slot: the drag hovers
   *  the empty space below the last thumb (atIndex -1), so the insertion
   *  line renders after the LAST thumb (the canvas already shows its
   *  after-line for the same case). */
  isDropAfter?: boolean;
  /** Phase 32 (chunk 2d) — the pending drop is a COPY (Ctrl / Alt held).
   *  Purely the affordance; the applied mode comes from the drop event. */
  isDropCopy?: boolean;
  /** Quarter-turn rotation, 0-3 (the engine's rotation unit). */
  rotation: number;
  label: number;
  /** Phase 32 — this rail's computed thumbnail width (126 in single mode,
   *  smaller in the Multi Mode shared rail). The render/cleanup/
   *  virtualization logic below is unchanged: the width is the only input
   *  that differs, and it already participates in the render effect's
   *  deps. */
  thumbWidth?: number;
  /** Phase 12 — logical page label for this visible slot (e.g. "iv").
   *  When set, the thumb label renders the override instead of the raw
   *  page number so the user can see their renumberPages choice without
   *  opening the Renumber dialog. */
  pageLabel?: string | null;
  onJump: (page: number) => void;
  onSelect: (page: number) => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  registerThumb: (page: number, el: HTMLElement | null) => void;
  /** Bug 3 — handler invoked from the rail when the user clicks the thumb to
   *  jump, before the page jumps. The parent (ThumbnailRail)
   *  uses this to flag "the recentre effect should fire for
   *  this jump" via its railJumpTargetRef. We can't pass the
   *  ref directly because ThumbnailRail owns it. */
  onJumpFromRail: (label: number) => void;
  /** Phase 36 (chunk 2) — the ContextPanel's inline verbs (absent elsewhere:
   *  no verbs are rendered and the thumb's DOM is byte-identical to the
   *  pre-chunk-2 rail). */
  thumbVerbs?: ThumbVerbs | null;
  /** Phase 36 (chunk 2) — right-click on this thumb (ContextPanel's menu). */
  onThumbContextMenu?: ThumbContextMenuHandler | null;
  /** Phase 36 (chunk 3a) — when present, every click routes through the
   *  multi-select gesture handler (toggle / extend / replace) instead of the
   *  legacy modifier-select. Absent everywhere but the ContextPanel. */
  onSelectGesture?: ((page: number, gesture: PageSelectGesture) => void) | null;
  /** Phase 111 (chunk B) — the card footer's real checkbox. Present only on
   *  the ContextPanel's rail instance (multi-select): toggles this page's
   *  membership in the host batch set WITHOUT navigating. */
  onToggleSelected?: ((page: number) => void) | null;
}

function Thumb({
  doc,
  page,
  aspectRatio,
  pageSize = null,
  shouldRender,
  isCurrent,
  isSelected,
  isDragging,
  isDropTarget,
  isDropAfter = false,
  isDropCopy = false,
  rotation,
  label,
  thumbWidth = THUMB_WIDTH,
  pageLabel = null,
  onJump,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  registerThumb,
  onJumpFromRail,
  thumbVerbs = null,
  onThumbContextMenu = null,
  onSelectGesture = null,
  onToggleSelected = null,
}: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Phase 36 (chunk 2) — true when the gesture that started a drag landed on
  // a hover verb or inside the verb cluster. A verb is a real control inside
  // the (draggable) thumb button, so without this the browser would start a
  // page drag from the verb: `onDragStart` bails rather than reordering the
  // document. Set on the thumb's own pointerdown; reset on drag end. It is
  // inert while `thumbVerbs` is absent (the ContextPanel is its only user). */
  const pointerDownOnVerbRef = useRef(false);
  // DEF-222 — tracks whether this Thumb is still mounted. The render
  // effect's cleanup must release the bitmap on true unmount, but must
  // NOT blank a still-mounted canvas when it merely re-runs on a
  // same-slot dependency change (doc proxy swap, page/width change).
  const mountedRef = useRef(true);
  const [rendered, setRendered] = useState(false);
  // Phase 111 (chunk B) — the card footer's per-page More popover. Only the
  // ContextPanel wires `thumbVerbs`, so the plain rail / pane strips keep
  // today's DOM without this surface.
  const [moreAnchor, setMoreAnchor] = useState<{ x: number; y: number } | null>(null);
  const width = thumbWidth;
  // DEF-148 — the wrap height comes from THIS page's own aspect
  // ratio when known (floor, matching the rendered canvas's cssHeight
  // exactly) and only falls back to the uniform page-1-derived ratio
  // for pages with no reported size. This is what keeps uncropped
  // pages full-size in the rail after page 1 is cropped.
  const height = thumbWrapHeightFor(pageSize, aspectRatio, thumbWidth);

  // DEF-222 — declared BEFORE the render effect so that on a true
  // unmount its cleanup runs first and flips `mountedRef` to false,
  // letting the render effect's cleanup release the bitmap. On a
  // re-run of the render effect (deps change, component stays
  // mounted) this cleanup never fires, so the last painted frame
  // stays visible until the new render blits over it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;
    const renderThumb = async (): Promise<void> => {
      let pdfPage: PDFPageProxy;
      try {
        pdfPage = await doc.getPage(page);
      } catch (error) {
        // DEF-121 — stale page index during a post-op proxy refresh:
        // the engine's pageOrder can reference a source page the
        // not-yet-refreshed `doc` proxy does not have ("Invalid page
        // request.", e.g. a mid-document insert asks for page 35 of a
        // still-34-page doc). The doc identity swaps immediately after
        // and re-runs this effect, so drop the attempt and keep the
        // shimmer placeholder; any other failure keeps surfacing.
        if (isInvalidPageRequest(error)) {
          return;
        }
        throw error;
      }
      if (disposed) {
        return;
      }
      const geom = computeThumbGeometry({
        pageWidthPt: pdfPage.view[2] - pdfPage.view[0],
        pageHeightPt: pdfPage.view[3] - pdfPage.view[1],
        thumbWidth: width,
        dpr: window.devicePixelRatio || 1,
      });
      // DEF-274 — the bitmap is deliberately UN-rotated (`rotation: 0`):
      // the geometry above is computed from `pdfPage.view`, the page's
      // raw (un-rotated) CropBox, and the wrap owns the turn via the
      // `.thumb-rot-N` CSS class ("rotate the canvas wrap, leaving the
      // page label upright"). Letting pdf.js apply the engine's /Rotate
      // as well double-rotated the bitmap AND made the rotated viewport
      // (landscape) mismatch the portrait buffer this geometry sizes —
      // the rotated thumb rendered clipped. One rotation, one owner.
      const renderViewport = pdfPage.getViewport({ scale: geom.renderScale, rotation: 0 });
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      if (geom.bufferWidth <= 0 || geom.bufferHeight <= 0) {
        // Degenerate page (zero-width CropBox): there is nothing to
        // paint. Keep the paper-white wrap, release the backing store and
        // drop the shimmer — the same visible result as before, without
        // handing pdf.js a zero-scale viewport.
        canvas.width = 0;
        canvas.height = 0;
        canvas.style.width = '0px';
        canvas.style.height = '0px';
        if (!disposed) {
          setRendered(true);
        }
        return;
      }
      // DEF-274 — render the new frame into an OFFSCREEN scratch canvas
      // and only touch the visible one once it is fully painted. The
      // rotate path swaps in a fresh doc proxy (`refreshDocProxyFor`),
      // which re-runs this effect; assigning `canvas.width` (even to the
      // value it already has) RESETS the backing store to transparent, so
      // the old code blanked the painted thumbnail the instant the
      // refresh landed and the user saw opaque white until pdf.js
      // repainted asynchronously — measured at 0.1 s to >3 s (DEF-274,
      // the rotate-path sibling of DEF-222). The scratch is per-run, so
      // concurrent runs never share a canvas (pdf.js rejects that).
      const scratch = document.createElement('canvas');
      scratch.width = geom.bufferWidth;
      scratch.height = geom.bufferHeight;
      const scratchCtx = scratch.getContext('2d');
      if (scratchCtx === null) {
        return;
      }
      const task = pdfPage.render({ canvasContext: scratchCtx, viewport: renderViewport });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string }).name !== 'RenderingCancelledException') {
          // unexpected render failure: leave the shimmer placeholder
        }
        return;
      }
      if (disposed) {
        return;
      }
      // Atomic swap: resize the visible canvas and blit the finished
      // frame in the SAME task, so the browser never paints a cleared
      // canvas between the two statements. The previous frame stays on
      // screen continuously until this point.
      canvas.width = geom.bufferWidth;
      canvas.height = geom.bufferHeight;
      canvas.style.width = `${geom.cssWidth}px`;
      canvas.style.height = `${geom.cssHeight}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        return;
      }
      ctx.drawImage(scratch, 0, 0);
      setRendered(true);
    };
    // DEF-303 — the thumbnail raster is parked while the window is
    // minimised and flushed on restore; the cleanup below cancels a parked
    // run so a stale thumb render never fires after a dep change / unmount.
    const cancelDeferred = deferWork((): void => {
      void renderThumb();
    });
    return () => {
      cancelDeferred();
      disposed = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore: cancel can throw if the task already finished
      }
      // Release the thumb bitmap ONLY on true unmount. A same-slot
      // re-run (doc proxy swap after an edit commit, page/width
      // change) keeps the previous frame on screen until the new
      // render blits over it — zeroing here made every rendered
      // thumbnail flash white for a few ms per commit (DEF-222).
      // Offscreen slots still release eagerly via the
      // shouldRender=false effect below, and a width change
      // reallocates the backing store on the next render, so idle
      // memory on long.pdf does not accumulate.
      if (!mountedRef.current) {
        const canvas = canvasRef.current;
        if (canvas !== null && (canvas.width !== 0 || canvas.height !== 0)) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
  }, [shouldRender, doc, page, width]);

  // Drop the thumbnail bitmap immediately when the rail takes the slot out
  // of the visible+buffered range. Without this, every offscreen thumb keeps
  // its full-resolution backing store (~190KB each at dpr 1.5 — and the rail
  // buffer is dozens of slots) attached to a canvas that's still in the DOM
  // until unmount. Setting width/height to 0 releases the underlying
  // ImageBitmap; the next shouldRender=true mount re-renders from scratch.
  useEffect(() => {
    if (shouldRender) return;
    const canvas = canvasRef.current;
    if (canvas !== null) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setRendered(false);
  }, [shouldRender]);

  const rotDeg = (rotation * 90) as 0 | 90 | 180 | 270;
  const classes = [
    'thumb',
    // TFL-1465 — card mode HUGS the preview: the card shrinks to the preview's
    // width so the border/inset gap is the same 7px on all four sides. The
    // label-only rail/pane thumbs keep their full-width box.
    thumbVerbs !== null ? 'thumb-card' : '',
    // DEF-098 — `.thumb-item` is the stable selector qa's e2e
    // harness uses to target a thumbnail (`.thumb-item` nth(1) is
    // page 2). This is the SAME interactive button — an alias
    // class, not a separate surface — so the e2e locator resolves
    // to a real click target that calls `onJump(visiblePage)` on
    // click.
    'thumb-item',
    isCurrent ? 'thumb-current' : '',
    isSelected ? 'thumb-selected' : '',
    isDragging ? 'thumb-dragging' : '',
    isDropTarget ? 'thumb-drop-target' : '',
    isDropTarget && isDropCopy ? 'thumb-drop-copy' : '',
    rotDeg !== 0 ? `thumb-rot-${rotDeg}` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  // Phase 111 (chunk B) — card mode is the ContextPanel's navigator: the
  // footer (checkbox + label + More) replaces the retired over-preview verbs.
  // The plain rail / pane strips keep today's label-only DOM.
  const cardMode = thumbVerbs !== null;
  const morePos =
    moreAnchor === null
      ? null
      : clampMenuPosition(moreAnchor.x, moreAnchor.y, 184, 170, window.innerWidth, window.innerHeight);
  const moreGroups = useMemo<CommandMenuGroup[]>(() => {
    if (thumbVerbs === null) return [];
    const rows: CommandMenuItem[] = [
      {
        id: 'rotate-cw',
        label: 'Rotate CW',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-menu-item': 'rotate-cw' },
        onSelect: (): void => thumbVerbs.onRotateCw(label),
      },
      {
        id: 'extract',
        label: 'Extract this page',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-menu-item': 'extract' },
        onSelect: (): void => thumbVerbs.onExtract(label),
      },
      { id: 'card-more-sep', label: '' },
      {
        id: 'delete',
        label: 'Delete this page',
        intent: 'destructive',
        variant: 'danger',
        density: 'compact',
        rowClassName: 'context-menu-item context-menu-item-danger',
        rowDataAttrs: { 'data-menu-item': 'delete' },
        onSelect: (): void => thumbVerbs.onDelete(label),
      },
    ];
    return [{ id: 'page-card', label: `Page ${label}`, entries: rows }];
  }, [thumbVerbs, label]);

  // TFL-1585 — the preview canvas + its border. The wrap is the element that
  // OWNS the border (`styles.css` `.thumb-canvas-wrap`) and the element the
  // rotation transform turns (`.thumb-rot-N .thumb-canvas-wrap`), so the frame
  // turns WITH the page. In CARD mode a sizing frame wraps it: the frame's
  // layout box is the ROTATED footprint (width/height swap at 90/270), so the
  // fit-content card hugs the rotated page and nothing spills outside the
  // frame. Label-only mode keeps the exact previous DOM (canvas wrap directly
  // inside the preview button).
  const canvasWrap = (
    <span className="thumb-canvas-wrap" style={{ width, height }}>
      <canvas ref={canvasRef} className="thumb-canvas" />
      {!rendered && <span className="thumb-placeholder" aria-hidden />}
    </span>
  );
  const quarterTurn = rotDeg === 90 || rotDeg === 270;
  const frameWidth = quarterTurn ? height : width;
  const frameHeight = quarterTurn ? width : height;

  return (
    <div
      ref={(el) => registerThumb(label, el)}
      className={classes}
      onClick={(e): void => {
        // Phase 36 (chunk 3a) — the ContextPanel's multi-select. A plain click
        // keeps today's NAVIGATE behaviour and additionally leaves exactly this
        // page selected; Ctrl/Cmd toggles; Shift extends from the anchor. The
        // modifier gestures never navigate (today's rail behaviour).
        if (onSelectGesture !== null) {
          const gesture = pageSelectGestureFor(e);
          if (gesture === 'replace') {
            onJumpFromRail(label);
            onJump(label);
          }
          onSelectGesture(label, gesture);
          return;
        }
        // Shift-click toggles selection; plain click jumps. Cmd/Ctrl-click
        // also selects.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect(label);
          return;
        }
        // DEF-098 — the click handler must pass the VISIBLE 1-based
        // page number (`label`, which is the loop index in the rail's
        // `Array.from({length: pageCount}, (_, i) => i + 1)`) to
        // `onJump` — NOT the source page (`page`, which the engine
        // may have remapped via a reorder). The previous defect
        // passed the source page and the rail jumped to the wrong
        // page after a reorder (and on a clean doc with no reorder
        // the two indices happen to agree, so the bug only surfaced
        // once a rotation/reorder/insert changed `pageOrder`).
        //
        // We bind `visiblePage` here as an explicit local so the
        // assertion is unambiguous at the call site: a future
        // refactor that swaps `label` for `page` (or some derived
        // sourcePage expression) trips the regression guard and the
        // unit test in `bugB7_thumbnailJumpToClickedPage.test.tsx`.
        const visiblePage = label;
        // Bug 3 — flag this jump as "I came from the rail" so
        // the recentre effect pins the selected thumb into
        // view. Without this hint the recentre only fires for
        // the first thumb click; subsequent clicks update
        // `currentPage` but the effect skips because the ref
        // is stale.
        onJumpFromRail(visiblePage);
        onJump(visiblePage);
      }}
      draggable
      // Phase 111 (chunk B) — the footer controls (checkbox, More) are
      // CONTROLS inside this draggable card, not drag handles: remember that
      // the press landed on one so `onDragStart` can refuse (the drag belongs
      // to the page). Inert without the card footer.
      onPointerDown={(e): void => {
        // `Element`, not `HTMLElement`: the target of a press on a control's
        // lucide glyph is the nested SVGElement, which is not an HTMLElement.
        pointerDownOnVerbRef.current =
          cardMode &&
          e.target instanceof Element &&
          e.target.closest('.thumb-more, .thumb-checkbox') !== null;
      }}
      onDragStart={(e): void => {
        if (pointerDownOnVerbRef.current) {
          e.preventDefault();
          return;
        }
        onDragStart(e);
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={(): void => {
        pointerDownOnVerbRef.current = false;
        onDragEnd();
      }}
      // Phase 36 (chunk 2) — the ContextPanel's right-click menu. Only wired
      // when the panel asks for it, so the rail's native menu is unchanged.
      // This is the thumb's own contextmenu (not a document-level
      // catch-all): it suppresses the native menu for THIS target only and
      // never touches the bubbling of other events.
      onContextMenu={
        onThumbContextMenu === null
          ? undefined
          : (e): void => {
              e.preventDefault();
              onThumbContextMenu(label, e.clientX, e.clientY);
            }
      }
      data-thumb-item
      data-page={label}
      data-source-page={page}
      title={pageLabel !== null ? `Page ${label} (label: ${pageLabel})` : `Page ${label}`}
    >
      {/* Phase 34 (chunk 1) — the rail's insertion LINE: the landing slot is
          the insert-BEFORE target, so the line renders in the gap above it
          (the first slot anchors flush to the scroller top). The existing
          drop-target outline stays as the secondary cue. */}
      {isDropTarget && (
        <span
          className={
            label === 1 ? "thumb-drop-line thumb-drop-line-first" : "thumb-drop-line"
          }
          data-thumb-drop-line
          aria-hidden="true"
        />
      )}
      {/* Phase 34 (chunk 2) — the APPEND slot's line, after the last thumb. */}
      {isDropAfter && (
        <span
          className="thumb-drop-line thumb-drop-line-after"
          data-thumb-drop-line
          aria-hidden="true"
        />
      )}
      {/* Phase 111 (chunk B) — the current page's violet 2px leading marker.
          Paired with the footer's "Viewing" label so current is never inferred
          from the batch selection. */}
      {isCurrent && (
        <span className="thumb-current-marker" data-thumb-current-marker aria-hidden="true" />
      )}
      {/* The preview is the card's ONE real navigation control: a real button
          (mouse + keyboard), never wrapping the footer controls. */}
      <button
        type="button"
        className="thumb-page"
        aria-label={`Page ${label}`}
        title={pageLabel !== null ? `Page ${label} (label: ${pageLabel})` : `Page ${label}`}
      >
        {cardMode ? (
          <span className="thumb-frame" style={{ width: frameWidth, height: frameHeight }}>
            {canvasWrap}
          </span>
        ) : (
          canvasWrap
        )}
      </button>
      {cardMode ? (
        /* TFL-1465 — the footer row is now an overlay bar pinned to the page
           preview's bottom edge (checkbox left, label, current eye indicator,
           More right). It is a SIBLING of the `.thumb-page` button, not a child,
           so the preview stays the card's one real navigation control. */
        <div className="thumb-overlay" data-thumb-overlay>
          <input
            type="checkbox"
            className="thumb-checkbox"
            checked={isSelected}
            onChange={(): void => onToggleSelected?.(label)}
            onClick={(e): void => e.stopPropagation()}
            aria-label={`Select page ${label}`}
            data-thumb-checkbox
          />
          <span className="thumb-label">
            {pageLabel !== null ? pageLabel : label}
          </span>
          {isCurrent && (
            <span
              className="thumb-viewing"
              data-thumb-viewing
              aria-label="Currently viewing"
              title="Currently viewing"
            >
              <Icon icon={Eye} size="sm" aria-hidden />
            </span>
          )}
          <button
            type="button"
            className="thumb-more"
            aria-label={`Page ${label} actions`}
            aria-haspopup="menu"
            aria-expanded={moreAnchor !== null}
            data-thumb-more
            onClick={(e): void => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setMoreAnchor({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <Icon icon={MoreHorizontal} size="sm" aria-hidden />
          </button>
        </div>
      ) : (
        <span className="thumb-label">
          {pageLabel !== null ? pageLabel : label}
        </span>
      )}
      {moreAnchor !== null && moreGroups.length > 0 && (
        <div className="thumb-more-menu" onClick={(e): void => e.stopPropagation()}>
          <CommandMenu
            open
            groups={moreGroups}
            ariaLabel={`Page ${label} actions`}
            onClose={(): void => setMoreAnchor(null)}
            position={morePos ?? undefined}
            dismissOnScroll
            popoverDataAttrs={{ 'data-page-menu': 'card' }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline

/** Phase 85 — the host-supplied outline editor configuration. App publishes
 *  one per pane through `OutlineEditorContext`; ContextPanel also forwards it
 *  explicitly to the re-parented panel. */
export interface OutlineEditorConfig {
  docId: string;
  entries: OutlineEntry[] | null;
  visiblePageCount: number;
  commit: SetOutlineFn;
}

/** Phase 85 — the outline editor config, published by App around a pane's
 *  DocumentView. A panel outside the provider (and every pre-Phase-85 mount)
 *  sees null and stays view-only. */
export const OutlineEditorContext = createContext<OutlineEditorConfig | null>(null);

interface OutlinePanelProps {
  doc: PDFDocumentProxy;
  outline: OutlineNode[];
  onJump: (page: number) => void;
  onError?: (message: string) => void;
  /** Phase 85 — edit configuration. Absent falls back to the context (App),
   *  then to view-only. */
  editor?: OutlineEditorConfig | null;
}

function samePath(a: OutlinePath | null, b: OutlinePath | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// TFL-1080 (DEF-616) — the navigator's 240px floor with a thin (~11px)
// scrollbar leaves ~229px of row width. The fixed columns (18px disclosure +
// 32px destination + the 44px COARSE More target) are 94px, the three 2px
// flex gaps 6px, the row's trailing pad 8px, and the title control cannot
// shrink below its 12px padding + 2px border (14px). That leaves ~107px for
// the indent; capping at 8 + 6*16 = 104px keeps a depth-10 row's More inside
// the panel (measured earlier at cap 8 + 7*16 = 120px: scrollWidth 244 >
// clientWidth 229, More right edge past the panel). Deeper rows share level
// 6's indent rather than pushing the row into horizontal overflow.
const OUTLINE_INDENT_BASE = 8;
const OUTLINE_INDENT_STEP = 16;
const OUTLINE_INDENT_MAX_DEPTH = 6;

function outlineIndent(depth: number): number {
  return OUTLINE_INDENT_BASE + Math.min(depth, OUTLINE_INDENT_MAX_DEPTH) * OUTLINE_INDENT_STEP;
}

/** Phase 36 (chunk 2) — exported so the PAGES ContextPanel can re-parent the
 *  same tree (REQUIREMENTS: surfaces are re-parented, never rewritten).
 *  Phase 85 adds an editable mode gated on the OutlineEditorContext (or the
 *  explicit `editor` prop): rows select, the selected row exposes the verbs,
 *  and every edit is committed through `engine.setOutline`. Without an editor
 *  the render is byte-identical to the original view-only tree. */
export function OutlinePanel({ doc, outline, onJump, onError, editor = null }: OutlinePanelProps) {
  const contextEditor = useContext(OutlineEditorContext);
  const config = editor ?? contextEditor;
  const editable = config !== null;
  const docId = config?.docId ?? null;
  const seedEntries = config?.entries ?? null;
  const visiblePageCount = config?.visiblePageCount ?? 0;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [model, setModel] = useState<OutlineEntry[]>(() => cloneEntries(config?.entries ?? []));
  const [selected, setSelected] = useState<OutlinePath | null>(null);
  const [editingPath, setEditingPath] = useState<OutlinePath | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Phase 111 (chunk C) — the per-row More popover. Only one row's menu is open
  // at a time; `retargetPath` is the row whose destination <select> is revealed
  // (opened from the More menu, anchored at the same point).
  const [rowMenuPath, setRowMenuPath] = useState<OutlinePath | null>(null);
  const [rowMenuPos, setRowMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [retargetPath, setRetargetPath] = useState<OutlinePath | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const skipBlurCommitRef = useRef(false);
  // Phase 111 (chunk D2a) — per-document navigator state for the outline view.
  // `collapsedByDocRef` keeps each document's expansion set so collapsing a row
  // under one document never leaks into another; `docIdRef` names the set the
  // panel is currently showing. `outlineScrollRef` is the editable panel's own
  // scroll container; `pendingOutlineScrollRef` carries its anchor across a
  // model swap (re-seed or a committed edit) so the list never jumps to the top.
  const collapsedByDocRef = useRef<Map<string, Set<string>>>(new Map());
  const docIdRef = useRef<string | null>(docId);
  const outlineScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingOutlineScrollRef = useRef<number | null>(null);
  // Phase 111 (TFL-1078 / ADV-240) — the row More button that opened the
  // current menu/popover. Escape and outside-pointer dismissal hand focus back
  // to it, mirroring CommandMenu's focus-return. `retargetPopoverRef` bounds the
  // outside-pointer test for the destination chooser.
  const rowMenuOpenerRef = useRef<HTMLElement | null>(null);
  const retargetPopoverRef = useRef<HTMLDivElement | null>(null);

  // Swap the model while carrying the scroller's anchor across the commit, so
  // a rename / re-seed leaves the reader where they were instead of at the top.
  const commitModel = useCallback((entries: OutlineEntry[]): void => {
    const scroller = outlineScrollRef.current;
    if (scroller !== null) pendingOutlineScrollRef.current = scroller.scrollTop;
    setModel(entries);
  }, []);

  // Re-seed whenever the host publishes a freshly read tree (open, save +
  // reload, undo / redo) or the pane switches documents. The panel's own
  // successful edit does not change the host seed, so it is preserved. The
  // OUTGOING document's expansion set is saved and the INCOMING one restored;
  // the scroll anchor is carried over the model swap.
  useEffect((): void => {
    if (!editable) return;
    const prevDocId = docIdRef.current;
    if (prevDocId !== null && prevDocId !== docId) {
      collapsedByDocRef.current.set(prevDocId, collapsed);
    }
    commitModel(cloneEntries(seedEntries ?? []));
    setSelected(null);
    setEditingPath(null);
    setError(null);
    setCollapsed(docId === null ? new Set() : collapsedByDocRef.current.get(docId) ?? new Set());
    docIdRef.current = docId;
  }, [docId, seedEntries, editable]);

  // Restore the captured anchor after the model swap commits, before paint.
  useLayoutEffect((): void => {
    const pending = pendingOutlineScrollRef.current;
    if (pending === null) return;
    pendingOutlineScrollRef.current = null;
    const scroller = outlineScrollRef.current;
    if (scroller !== null) scroller.scrollTop = pending;
  }, [model]);

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (docId !== null) collapsedByDocRef.current.set(docId, next);
      return next;
    });
  };

  const go = (node: OutlineNode): void => {
    void resolveOutlinePage(doc, node.dest).then((page) => {
      if (page !== null) {
        onJump(page);
      } else {
        onError?.('Bookmark has no page target');
      }
    });
  };

  const goEntry = (entry: OutlineEntry): void => {
    if (entry.page !== null) {
      onJump(entry.page);
    } else {
      onError?.('Bookmark has no page target');
    }
  };

  const selectRow = useCallback((path: OutlinePath): void => {
    setSelected(path);
    setError(null);
  }, []);

  const runEdit = useCallback(
    async (outcome: OutlineEditOutcome): Promise<void> => {
      if (config === null) return;
      if (outcome.kind === 'invalid') {
        setError(outcome.error);
        onError?.(outcome.error);
        return;
      }
      const result = await commitOutlineEdit({
        docId: config.docId,
        current: modelRef.current,
        outcome,
        setOutline: config.commit,
      });
      commitModel(result.entries);
      setEditingPath(null);
      if (result.error === null) {
        setSelected(outcome.selection);
        setError(null);
      } else {
        setError(result.error);
        onError?.(result.error);
      }
    },
    [config, onError],
  );

  const startRename = useCallback((path: OutlinePath): void => {
    const node = entryAt(modelRef.current, path);
    if (node === null) return;
    skipBlurCommitRef.current = false;
    setSelected(path);
    setEditingPath(path);
    setDraftTitle(node.title);
    setError(null);
  }, []);

  const commitRename = useCallback(
    (path: OutlinePath): void => {
      if (skipBlurCommitRef.current) {
        skipBlurCommitRef.current = false;
        return;
      }
      setEditingPath(null);
      void runEdit(editRename(modelRef.current, path, draftTitle));
    },
    [draftTitle, runEdit],
  );

  const renderNodes = (nodes: OutlineNode[], path: string, depth: number): React.ReactNode => (
    <ul className="outline-list" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Document outline' : undefined}>
      {nodes.map((node, i) => {
        const key = `${path}/${i}`;
        const isCollapsed = collapsed.has(key);
        const hasChildren = node.children.length > 0;
        return (
          <li
            key={key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
          >
            <div className="outline-row" style={{ paddingLeft: outlineIndent(depth) }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon outline-toggle"
                  onClick={() => toggle(key)}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  <span className={isCollapsed ? 'chevron chevron-closed' : 'chevron'}>
                    <Icon icon={SquareChevronRight} size="sm" />
                  </span>
                </button>
              ) : (
                <span className="outline-toggle outline-toggle-empty" aria-hidden />
              )}
              <button type="button" className="btn btn-ghost btn-sm outline-link" onClick={() => go(node)}>
                {node.title}
              </button>
            </div>
            {!isCollapsed && hasChildren && renderNodes(node.children, key, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  // Phase 111 (chunk C) — the per-row More popover replaces the retired
  // horizontal renderVerbs strip: one always-visible 32px More per row opens a
  // CommandMenu (Rename / Set destination... / Add bookmark / Indent / Outdent /
  // separator / Delete bookmark). Restrictions come from the real helpers.
  const openRowMenu = (path: OutlinePath, el: HTMLElement): void => {
    rowMenuOpenerRef.current = el;
    const rect = el.getBoundingClientRect();
    setRowMenuPos(
      clampMenuPosition(rect.left, rect.bottom + 4, 220, 300, window.innerWidth, window.innerHeight),
    );
    setRetargetPath(null);
    setRowMenuPath(path);
  };

  const closeRowMenu = (): void => setRowMenuPath(null);

  // Phase 111 (TFL-1078 / ADV-240) — the retarget popover dismisses on Escape
  // and on an outside pointerdown, returning focus to the row's More button the
  // same way CommandMenu returns focus to its opener. `dismissRetarget` is
  // idempotent, so the popover's own key handler and the window fallback can
  // both fire without harm.
  // TFL-1080 (DEF-617): a pointerdown's DEFAULT action moves focus to the
  // pressed target (typically `document.body`) AFTER this listener returns, so
  // the synchronous `opener.focus()` in `dismissRetarget` was immediately
  // overwritten and focus landed on BODY. Cancelling the outside pointerdown
  // suppresses that focus move, exactly like Escape leaves focus alone.
  const dismissRetarget = useCallback((): void => {
    setRetargetPath(null);
    const opener = rowMenuOpenerRef.current;
    if (opener !== null && document.contains(opener)) opener.focus();
  }, []);

  useEffect((): (() => void) | undefined => {
    if (retargetPath === null) return undefined;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node) {
        if (retargetPopoverRef.current?.contains(target) === true) return;
        if (rowMenuOpenerRef.current?.contains(target) === true) return;
      }
      event.preventDefault();
      dismissRetarget();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      dismissRetarget();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [retargetPath, dismissRetarget]);

  const rowMenuGroups = (path: OutlinePath): CommandMenuGroup[] => {
    const firstChild = isFirstChild(path);
    const atRoot = isRootRow(path);
    const gone = entryAt(modelRef.current, path) === null;
    const rows: CommandMenuItem[] = [
      {
        id: 'rename',
        label: 'Rename',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-outline-rename': 'true' },
        onSelect: (): void => startRename(path),
      },
      {
        id: 'retarget',
        label: 'Set destination...',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-outline-retarget-open': 'true' },
        onSelect: (): void => setRetargetPath(path),
      },
      {
        id: 'add',
        label: 'Add bookmark',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-outline-add': 'true' },
        onSelect: (): void => {
          void runEdit(editAdd(modelRef.current, path));
        },
      },
      {
        id: 'indent',
        label: 'Indent',
        intent: 'secondary',
        density: 'compact',
        disabled: firstChild,
        disabledReason: firstChild ? 'The first bookmark cannot be indented' : undefined,
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-outline-indent': 'true' },
        onSelect: (): void => {
          void runEdit(editIndent(modelRef.current, path));
        },
      },
      {
        id: 'outdent',
        label: 'Outdent',
        intent: 'secondary',
        density: 'compact',
        disabled: atRoot,
        disabledReason: atRoot ? 'Already at the top level' : undefined,
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-outline-outdent': 'true' },
        onSelect: (): void => {
          void runEdit(editOutdent(modelRef.current, path));
        },
      },
      { id: 'row-sep', label: '' },
      {
        id: 'delete',
        label: 'Delete bookmark',
        intent: 'destructive',
        variant: 'danger',
        density: 'compact',
        disabled: gone,
        rowClassName: 'context-menu-item context-menu-item-danger',
        rowDataAttrs: { 'data-outline-delete': 'true' },
        onSelect: (): void => {
          void runEdit(editDelete(modelRef.current, path));
        },
      },
    ];
    return [{ id: 'bookmark-actions', label: 'Bookmark actions', entries: rows }];
  };

  const renderEntries = (nodes: OutlineEntry[], parentPath: OutlinePath, depth: number): React.ReactNode => (
    <ul className="outline-list" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Document outline' : undefined}>
      {nodes.map((entry, i) => {
        const path = [...parentPath, i];
        const key = path.join('/');
        const isCollapsed = collapsed.has(key);
        const rowSelected = samePath(selected, path);
        const isEditing = samePath(editingPath, path);
        return (
          <li
            key={key}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={rowSelected}
            aria-expanded={entry.children.length > 0 ? !isCollapsed : undefined}
          >
            <div
              className={rowSelected ? 'outline-row outline-row-selected' : 'outline-row'}
              style={{ paddingLeft: outlineIndent(depth) }}
              data-outline-row
              data-outline-path={key}
              data-outline-selected={rowSelected ? 'true' : 'false'}
              onClick={(): void => selectRow(path)}
            >
              {entry.children.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon outline-toggle"
                  onClick={(e): void => {
                    e.stopPropagation();
                    toggle(key);
                  }}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  <span className={isCollapsed ? 'chevron chevron-closed' : 'chevron'}>
                    <Icon icon={SquareChevronRight} size="sm" />
                  </span>
                </button>
              ) : (
                <span className="outline-toggle outline-toggle-empty" aria-hidden />
              )}
              {isEditing ? (
                <input
                  className="outline-rename-input"
                  data-outline-rename-input
                  value={draftTitle}
                  autoFocus
                  onClick={(e): void => e.stopPropagation()}
                  onChange={(e): void => setDraftTitle(e.target.value)}
                  onKeyDown={(e): void => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      skipBlurCommitRef.current = true;
                      setEditingPath(null);
                    }
                  }}
                  onBlur={(): void => commitRename(path)}
                />
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm outline-link"
                  title={entry.title}
                  onClick={(): void => goEntry(entry)}
                >
                  {entry.title}
                </button>
              )}
              <span
                className="outline-page"
                data-outline-page
                title={entry.page === null ? 'No page target' : `Page ${entry.page}`}
                aria-label={entry.page === null ? 'No page target' : `Page ${entry.page}`}
              >
                {entry.page === null ? '\u2013' : entry.page}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-icon outline-more"
                data-outline-more
                aria-label="Bookmark actions"
                aria-haspopup="menu"
                aria-expanded={rowMenuPath !== null && samePath(rowMenuPath, path)}
                title="Bookmark actions"
                onClick={(e): void => {
                  e.stopPropagation();
                  openRowMenu(path, e.currentTarget);
                }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>
            </div>
            {!isCollapsed && entry.children.length > 0 && renderEntries(entry.children, path, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  if (!editable) {
    return <div className="outline-panel tf-panel-scroll">{renderNodes(outline, '', 0)}</div>;
  }

  const retargetEntry = retargetPath === null ? null : entryAt(modelRef.current, retargetPath);
  const retargetPages: number[] = [];
  for (let p = 1; p <= visiblePageCount; p += 1) retargetPages.push(p);

  return (
    <div className="outline-panel tf-panel-scroll" data-outline-editable ref={outlineScrollRef}>
      {error !== null && (
        <div className="outline-error" data-outline-error role="alert">
          <Icon icon={AlertCircle} size="xs" />
          <span>{error}</span>
        </div>
      )}
      <div className="outline-head">
        <button
          type="button"
          className="btn btn-ghost btn-icon outline-head-add"
          data-outline-add
          title="Add bookmark"
          aria-label="Add bookmark"
          onClick={(): void => {
            void runEdit(editAdd(modelRef.current, null));
          }}
        >
          <Icon icon={Plus} size="sm" />
        </button>
      </div>
      {model.length === 0 ? (
        <div className="outline-empty">No bookmarks</div>
      ) : (
        renderEntries(model, [], 0)
      )}
      {/* TFL-1083 (DEF-615) — the row More CommandMenu and the retarget
       *  popover are portalled to `document.body`. The Outline view's body
       *  (`.context-panel-outline-body`) rides a `fill-mode: both` materialize
       *  animation, which Chromium keeps as a STACKING CONTEXT even after it
       *  settles (opacity-only is not enough — the animation, not the
       *  transform, is the trigger). A `position: fixed` surface inside that
       *  animated ancestor therefore paints and hit-tests UNDER
       *  `.document-content` wherever it extends past the navigator, leaving
       *  its rows unclickable. Portalling the two fixed surfaces out to
       *  `document.body` takes them out of that ancestor chain, so their
       *  `position: fixed` viewport coordinates are authoritative with
       *  animations ON and OFF. The CSS keyframe is untouched. */}
      {rowMenuPath !== null && rowMenuPos !== null &&
        createPortal(
          <div className="outline-more-menu" onClick={(e): void => e.stopPropagation()}>
            <CommandMenu
              open
              groups={rowMenuGroups(rowMenuPath)}
              ariaLabel="Bookmark actions"
              onClose={closeRowMenu}
              position={rowMenuPos}
              popoverDataAttrs={{ 'data-outline-menu': 'true' }}
            />
          </div>,
          document.body,
        )}
      {retargetPath !== null && rowMenuPos !== null &&
        createPortal(
          <div
            ref={retargetPopoverRef}
            className="outline-retarget-popover"
            data-outline-retarget-popover
            style={{ position: 'fixed', left: rowMenuPos.left, top: rowMenuPos.top }}
            onKeyDown={(e): void => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              dismissRetarget();
            }}
          >
            <select
              className="outline-retarget"
              data-outline-retarget
              aria-label="Bookmark page target"
              autoFocus
              value={retargetEntry?.page == null ? '' : String(retargetEntry.page)}
              onClick={(e): void => e.stopPropagation()}
              onChange={(e): void => {
                const next = e.target.value;
                const target = retargetPath;
                dismissRetarget();
                if (target !== null) {
                  void runEdit(editRetarget(modelRef.current, target, next, visiblePageCount));
                }
              }}
            >
              <option value="">No page</option>
              {retargetPages.map((p) => (
                <option key={p} value={String(p)}>{`Page ${p}`}</option>
              ))}
            </select>
          </div>,
          document.body,
        )}
    </div>
  );
}
