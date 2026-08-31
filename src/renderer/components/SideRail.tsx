import { Images, List, MessageSquare, Undo2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOutlinePage, type OutlineNode } from '../pdf/pdfjs';
import { computeThumbGeometry } from './thumbGeometry';
import type { EngineState } from '../engine/types';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import { AnnotationsPanel } from '../annotations/AnnotationsPanel';

interface SideRailProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  outline: OutlineNode[] | null;
  currentPage: number;
  defaultWidthPt: number;
  defaultHeightPt: number;
  /** Live engine state for this tab (pageCount after ops, rotations,
   *  deleted). Owned by App. The rail uses this to skip deleted pages
   *  and rotate the rendered thumbnail to match the engine. */
  engineState: EngineState;
  /** Whether undo is currently available for the active tab. The rail
   *  keeps this in its own UI state (the engine's IPC `EngineState` does
   *  not expose it directly). */
  canUndo: boolean;
  /** Operations on the active document, dispatched through the engine.
   *  Errors are surfaced through `onError` as a friendly toast. */
  onOp?: (op: { kind: 'rotate'; page: number; dir: 'cw' | 'ccw' }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  onError?: (message: string) => void;
  onJump: (page: number) => void;
  /** Annotations for the active tab (Phase 3). Wired to the annotations
   *  panel tab on the rail. */
  annotations?: Annotation[];
  /** Edit / delete handlers for annotations; the rail panel passes the id
   *  and patch through to the host (App / DocumentView) which dispatches
   *  through the engine. */
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** When the panel wants to flash an annotation, the host receives the
   *  id; passing it back through `flashAnnotationId` makes the overlay
   *  draw the highlight. */
  onJumpToAnnotation?: (page: number, id: string) => void;
}

type RailTab = 'thumbs' | 'outline' | 'annotations';

/**
 * Left rail with an icon tab strip. Thumbnails always exist; the bookmarks
 * tab appears only when the document has an outline; the annotations tab
 * is always present (Phase 3).
 */
export function SideRail(props: SideRailProps) {
  const {
    doc,
    outline,
    currentPage,
    defaultWidthPt,
    defaultHeightPt,
    engineState,
    canUndo,
    onOp,
    onDelete,
    onReorder,
    onUndo,
    onError,
    onJump,
    annotations = [],
    onEditAnnotation,
    onDeleteAnnotation,
    onJumpToAnnotation,
  } = props;
  const [tab, setTab] = useState<RailTab>('thumbs');

  useEffect(() => {
    if (outline === null && tab === 'outline') {
      setTab('thumbs');
    }
  }, [outline, tab]);

  const aspect = defaultHeightPt / defaultWidthPt;

  // Map visible 1-based position -> source 1-based page (the engine's
  // pageOrder tells us which underlying page is at each visible slot).
  // Before any op, pageOrder is [0..N-1] so this is the identity. After
  // a reorder it changes: e.g. [1, 0, 2, ...] means visible position 1
  // now shows source page 2, position 2 shows page 1, position 3 shows
  // page 3.
  const visibleToSource = useMemo(() => {
    const m = new Map<number, number>();
    const order = engineState.pageOrder;
    for (let i = 0; i < order.length; i += 1) {
      m.set(i + 1, order[i] + 1);
    }
    return m;
  }, [engineState.pageOrder]);

  const jumpToAnnotation = (page: number, id: string): void => {
    onJump(page);
    onJumpToAnnotation?.(page, id);
  };

  return (
    <aside className="side-rail">
      <div className="rail-tabs">
        <button
          type="button"
          className={tab === 'thumbs' ? 'rail-tab rail-tab-active' : 'rail-tab'}
          onClick={() => setTab('thumbs')}
          title="Page thumbnails"
        >
          <Images size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={tab === 'annotations' ? 'rail-tab rail-tab-active' : 'rail-tab'}
          onClick={() => setTab('annotations')}
          title="Annotations"
          data-rail-tab="annotations"
        >
          <MessageSquare size={16} aria-hidden />
        </button>
        {outline !== null && (
          <button
            type="button"
            className={tab === 'outline' ? 'rail-tab rail-tab-active' : 'rail-tab'}
            onClick={() => setTab('outline')}
            title="Bookmarks"
          >
            <List size={16} aria-hidden />
          </button>
        )}
      </div>
      <div className="rail-content">
        {tab === 'thumbs' ? (
          <ThumbnailRail
            doc={doc}
            pageCount={engineState.pageCount}
            currentPage={currentPage}
            aspectRatio={aspect}
            rotations={engineState.rotations}
            visibleToSource={visibleToSource}
            canUndo={canUndo}
            onOp={onOp}
            onDelete={onDelete}
            onReorder={onReorder}
            onUndo={onUndo}
            onJump={onJump}
          />
        ) : tab === 'annotations' ? (
          <AnnotationsPanel
            annotations={annotations}
            onJumpTo={jumpToAnnotation}
            onEdit={(id, patch): void => onEditAnnotation?.(id, patch)}
            onDelete={(id): void => onDeleteAnnotation?.(id)}
          />
        ) : (
          <OutlinePanel doc={doc} outline={outline ?? []} onJump={onJump} onError={onError} />
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Thumbnails

const THUMB_WIDTH = 126;

// Geometry math for the thumbnail rail. Each thumbnail's bounding box height
// = (THUMB_WIDTH * aspectRatio, the wrap height) + the thumb's padding
// (6px top + 6px bottom) + 1px border top + 1px border bottom + the
// `thumb-label` text line (~18px) + the inter-thumb margin-bottom (6px).
// The thumb-scroller adds 8px of padding via var(--sp-2). This must match
// the actual DOM layout exactly so the visibleThumbRange() math matches
// reality.
const THUMB_PADDING_PX = 6;
const THUMB_BORDER_PX = 1;
const THUMB_LABEL_PX = 18;
const THUMB_MARGIN_BOTTOM_PX = 6;
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

function thumbSlotHeight(aspectRatio: number): number {
  // Each thumb's bounding box height = wrap-height (rounded for CSS) +
  // padding-top + padding-bottom + border-top + border-bottom + label +
  // margin-bottom. The next thumb's top is exactly one slot below the
  // previous thumb's top.
  const wrapHeight = Math.round(THUMB_WIDTH * aspectRatio);
  return (
    wrapHeight +
    THUMB_PADDING_PX * 2 +
    THUMB_BORDER_PX * 2 +
    THUMB_LABEL_PX +
    THUMB_MARGIN_BOTTOM_PX
  );
}

function visibleThumbRange(
  scrollTop: number,
  viewportHeight: number,
  aspectRatio: number,
  pageCount: number,
  buffer = THUMB_BUFFER,
): { start: number; end: number } {
  if (pageCount <= 0) return { start: 1, end: 1 };
  const slot = thumbSlotHeight(aspectRatio);
  if (slot <= 0) return { start: 1, end: 1 };
  const adjusted = scrollTop - THUMB_OUTER_PADDING;
  const first = adjusted <= 0 ? 0 : Math.floor(adjusted / slot);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / slot));
  const last = first + visibleCount;
  const start = Math.max(0, first - buffer);
  const end = Math.min(pageCount - 1, last + buffer);
  return { start: start + 1, end: end + 1 };
}

interface ThumbnailRailProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  aspectRatio: number;
  rotations: EngineState['rotations'];
  /** Maps 1-based visible index -> 1-based source page in the underlying
   *  PDF.js document. Identity map for the stub; the real engine may
   *  reorder. */
  visibleToSource: Map<number, number>;
  canUndo: boolean;
  onOp?: (op: { kind: 'rotate'; page: number; dir: 'cw' | 'ccw' }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  onJump: (page: number) => void;
}

function ThumbnailRail({
  doc,
  pageCount,
  currentPage,
  aspectRatio,
  rotations,
  visibleToSource,
  canUndo,
  onOp,
  onDelete,
  onReorder,
  onUndo,
  onJump,
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
  // Per-thumb drag state. We use HTML5 drag-and-drop: dragging a thumb
  // paints it as the drag source, dropping it on another thumb inserts it
  // before that target. The reorder index is the visible 1-based index,
  // which is what the engine consumes.
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const computeGeometryMountRef = useRef<() => void>(() => undefined);
  computeGeometryMountRef.current = (): void => {
    const scroller = scrollerRef.current;
    const range = visibleThumbRange(
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
      aspectRatio,
      pageCount,
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
    const ro = new ResizeObserver(() => {
      computeGeometryMountRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      return next;
    });
    computeGeometryMountRef.current();
  }, [pageCount, currentPage, aspectRatio]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || pageCount <= 0) return;
    // Bug 3 — only recentre the thumb rail when the jump was
    // triggered by THIS rail (a thumb click), not when
    // `currentPage` is just reflecting the user's main-view
    // scroll position. Without this gate every scroll through
    // the main document re-pinned `scroller.scrollTop`,
    // snapping the rail back to the active page on every tick.
    // The ref is set by the rail's `Thumb.onClick` handler below
    // and cleared at the start of this effect so a single click
    // only recentres once.
    if (railJumpTargetRef.current !== currentPage) return;
    railJumpTargetRef.current = null;
    const slot = thumbSlotHeight(aspectRatio);
    if (slot <= 0) return;
    const targetTop = (currentPage - 1) * slot + THUMB_OUTER_PADDING;
    const desiredTop = targetTop - scroller.clientHeight / 2 + slot / 2;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.max(0, Math.min(desiredTop, maxTop));
    if (Math.abs(scroller.scrollTop - nextTop) > 1) {
      scroller.scrollTop = nextTop;
    }
  }, [currentPage, pageCount, aspectRatio]);

  // Drop selection when the selected page goes away (delete, etc.).
  useEffect(() => {
    if (selected !== null && selected > pageCount) {
      setSelected(null);
    }
  }, [selected, pageCount]);

const onDragStart = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    setDragFromIndex(page);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(page));
  };
  const onDragOver = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    if (dragFromIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== page) setDropTarget(page);
  };
  const onDragLeave = (): void => {
    setDropTarget(null);
  };
  const onDrop = (page: number) => (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault();
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
    setDragFromIndex(null);
    setDropTarget(null);
  };

  return (
    <div className="thumb-scroller">
      {pageCount > 0 && (
        <div className="rail-actions">
          <button
            type="button"
            className="rail-action-btn"
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            title={canUndo ? 'Undo last change' : 'Nothing to undo'}
            aria-label="Undo last change"
          >
            <Undo2 size={13} aria-hidden />
            <span>Undo last change</span>
          </button>
        </div>
      )}
      <div
        ref={scrollerRef}
        className="thumb-scroller-inner"
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          const sourcePage = visibleToSource.get(page) ?? page;
          const rot = rotations[page - 1] ?? 0;
          const isSel = selected === page;
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
              aspectRatio={aspectRatio}
              shouldRender={visibleThumbs.has(page)}
              isCurrent={page === currentPage}
              isSelected={isSel}
              isDragging={dragFromIndex === page}
              isDropTarget={dropTarget === page && dragFromIndex !== null && dragFromIndex !== page}
              rotation={rot}
              label={page}
              onJump={onJump}
              onSelect={setSelected}
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
            />
          );
        })}
        {pageCount === 0 && (
          <div className="thumb-empty">
            <span>All pages removed.</span>
          </div>
        )}
      </div>
      {selected !== null && selected <= pageCount && (
        <ThumbActions
          page={selected}
          canRotate={onOp !== undefined}
          canDelete={onDelete !== undefined && pageCount > 1}
          onRotateCw={(): void => onOp?.({ kind: 'rotate', page: selected, dir: 'cw' })}
          onRotateCcw={(): void => onOp?.({ kind: 'rotate', page: selected, dir: 'ccw' })}
          onDelete={(): void => {
            if (onDelete === undefined) return;
            onDelete([selected]);
            setSelected(null);
          }}
          onClearSelection={(): void => setSelected(null)}
        />
      )}
    </div>
  );
}

interface ThumbProps {
  doc: PDFDocumentProxy;
  page: number;
  aspectRatio: number;
  shouldRender: boolean;
  isCurrent: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  /** Quarter-turn rotation, 0-3 (the engine's rotation unit). */
  rotation: number;
  label: number;
  onJump: (page: number) => void;
  onSelect: (page: number) => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  registerThumb: (page: number, el: HTMLElement | null) => void;
  /** Bug 3 — handler invoked when the user clicks the thumb to
   *  jump, before the page jumps. The parent (ThumbnailRail)
   *  uses this to flag "the recentre effect should fire for
   *  this jump" via its railJumpTargetRef. We can't pass the
   *  ref directly because ThumbnailRail owns it. */
  onJumpFromRail: (label: number) => void;
}

function Thumb({
  doc,
  page,
  aspectRatio,
  shouldRender,
  isCurrent,
  isSelected,
  isDragging,
  isDropTarget,
  rotation,
  label,
  onJump,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  registerThumb,
  onJumpFromRail,
}: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const width = THUMB_WIDTH;
  const height = Math.round(width * aspectRatio);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (disposed) {
        return;
      }
      const geom = computeThumbGeometry({
        pageWidthPt: pdfPage.view[2] - pdfPage.view[0],
        pageHeightPt: pdfPage.view[3] - pdfPage.view[1],
        thumbWidth: width,
        dpr: window.devicePixelRatio || 1,
      });
      const renderViewport = pdfPage.getViewport({ scale: geom.renderScale });
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      canvas.width = geom.bufferWidth;
      canvas.height = geom.bufferHeight;
      canvas.style.width = `${geom.cssWidth}px`;
      canvas.style.height = `${geom.cssHeight}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        return;
      }
      const task = pdfPage.render({ canvasContext: ctx, viewport: renderViewport });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string }).name !== 'RenderingCancelledException') {
          // unexpected render failure: leave the shimmer placeholder
        }
        return;
      }
      if (!disposed) {
        setRendered(true);
      }
    })();
    return () => {
      disposed = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore: cancel can throw if the task already finished
      }
      // Release the thumb bitmap eagerly. When this slot unmounts (the
      // geometry mount drops the page from visibleThumbs) or when the
      // page/doc/source changes (rotation, reorder, etc.), the canvas
      // DOM stays for a tick before React removes it; without an explicit
      // width/height reset the ImageBitmap (~190KB at dpr 1.5) lingers
      // until the next GC cycle. Idle memory on long.pdf accumulates
      // quickly when many thumbs are in flight.
      const canvas = canvasRef.current;
      if (canvas !== null && (canvas.width !== 0 || canvas.height !== 0)) {
        canvas.width = 0;
        canvas.height = 0;
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
    isCurrent ? 'thumb-current' : '',
    isSelected ? 'thumb-selected' : '',
    isDragging ? 'thumb-dragging' : '',
    isDropTarget ? 'thumb-drop-target' : '',
    rotDeg !== 0 ? `thumb-rot-${rotDeg}` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  return (
    <button
      type="button"
      ref={(el) => registerThumb(label, el)}
      className={classes}
      onClick={(e): void => {
        // Shift-click toggles selection; plain click jumps. Cmd/Ctrl-click
        // also selects.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect(label);
        } else {
          // Bug 3 — flag this jump as "I came from the rail" so
          // the recentre effect pins the selected thumb into
          // view. Without this hint the recentre only fires for
          // the first thumb click; subsequent clicks update
          // `currentPage` but the effect skips because the ref
          // is stale.
          onJumpFromRail(label);
          onJump(label);
        }
      }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-page={label}
      data-source-page={page}
      title={`Page ${label}`}
    >
      <span className="thumb-canvas-wrap" style={{ width, height }}>
        <canvas ref={canvasRef} className="thumb-canvas" />
        {!rendered && <span className="thumb-placeholder" aria-hidden />}
      </span>
      <span className="thumb-label">{label}</span>
    </button>
  );
}

interface ThumbActionsProps {
  page: number;
  canRotate: boolean;
  canDelete: boolean;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

function ThumbActions(props: ThumbActionsProps): ReactElement {
  const { page, canRotate, canDelete, onRotateCw, onRotateCcw, onDelete, onClearSelection } =
    props;
  return (
    <div
      className="rail-actions rail-actions-bar"
      role="toolbar"
      aria-label={`Actions for page ${page}`}
      data-rail-action-bar={page}
      data-page={page}
    >
      <span className="rail-actions-label">Page {page}</span>
      <div className="rail-actions-btns">
        <button
          type="button"
          className="rail-action-btn"
          onClick={onRotateCcw}
          disabled={!canRotate}
          title="Rotate counter-clockwise"
          aria-label="Rotate counter-clockwise"
        >
          <RotateCcw size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="rail-action-btn"
          onClick={onRotateCw}
          disabled={!canRotate}
          title="Rotate clockwise"
          aria-label="Rotate clockwise"
        >
          <RotateCw size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="rail-action-btn rail-action-danger"
          onClick={onDelete}
          disabled={!canDelete}
          title="Delete this page"
          aria-label="Delete this page"
        >
          <Trash2 size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="rail-action-btn rail-action-close"
          onClick={onClearSelection}
          title="Clear selection"
          aria-label="Clear selection"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline

interface OutlinePanelProps {
  doc: PDFDocumentProxy;
  outline: OutlineNode[];
  onJump: (page: number) => void;
  onError?: (message: string) => void;
}

function OutlinePanel({ doc, outline, onJump, onError }: OutlinePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
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

  const renderNodes = (nodes: OutlineNode[], path: string, depth: number): React.ReactNode => (
    <ul className="outline-list">
      {nodes.map((node, i) => {
        const key = `${path}/${i}`;
        const isCollapsed = collapsed.has(key);
        return (
          <li key={key}>
            <div className="outline-row" style={{ paddingLeft: 8 + depth * 14 }}>
              {node.children.length > 0 ? (
                <button
                  type="button"
                  className="outline-toggle"
                  onClick={() => toggle(key)}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  <span className={isCollapsed ? 'chevron chevron-closed' : 'chevron'}>
                    {'▸'}
                  </span>
                </button>
              ) : (
                <span className="outline-toggle outline-toggle-empty" aria-hidden />
              )}
              <button type="button" className="outline-link" onClick={() => go(node)}>
                {node.title}
              </button>
            </div>
            {!isCollapsed && node.children.length > 0 && renderNodes(node.children, key, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return <div className="outline-panel">{renderNodes(outline, '', 0)}</div>;
}