import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  accumulateWheel,
  stepTowards,
  zoomReducer,
  type ZoomMode,
  type ZoomState,
} from "../state/zoom";
import {
  buildPageIndex,
  findPageHits,
  nextHitIndex,
  prevHitIndex,
  type PageTextIndex,
  type SearchHit,
} from "../search/searchIndex";
import type { OutlineNode } from "../pdf/pdfjs";
import { PageView } from "./PageView";
import { SearchBar } from "./SearchBar";
import { SideRail } from "./SideRail";
import { Toolbar } from "./Toolbar";
import { AnnotationToolbar } from "../annotations/AnnotationToolbar";
import type { EngineState } from "../engine/types";
import {
  annotationToolReducer,
  initialAnnotationToolState,
  type Annotation,
  type AnnotationPatch,
  type AnnotationToolAction,
} from "../annotations/model";
import {
  CONTENT_PADDING_PX,
  PAGE_GAP_PX,
  pageAtScrollTop,
  pageSlotHeight,
  slotOffsetTop,
  visiblePageRange,
} from "./pageGeometry";
import {
  createIdleCleanupCoordinator,
  type IdleCleanupCoordinator,
} from "../utils/idleCleanup";
import type {
  FormField,
  SavedSignature,
  SignaturePlacement,
} from "../../shared/types";

export interface PersistedViewer {
  zoomMode: ZoomMode;
  manualScale: number;
  currentPage: number;
  searchOpen: boolean;
  query: string;
  activeHitIndex: number;
}

export interface SearchIndexProgress {
  built: number;
  total: number;
}

export interface DocDiagnostics {
  pageCount: number;
  currentPage: number;
  zoom: number;
  mode: ZoomMode;
  searchQuery: string;
  searchHits: number;
  searchIndexProgress: SearchIndexProgress | null;
}

interface DocumentViewProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  outline: OutlineNode[] | null;
  initial: PersistedViewer;
  onPersist: (v: PersistedViewer) => void;
  onDiagnostics: (d: DocDiagnostics) => void;
  onSearchIndexProgress?: (p: SearchIndexProgress | null) => void;
  onToast?: (kind: "error" | "info", text: string) => void;
  /** Live engine state for the active tab. Drives the rail pageCount,
   *  thumbnail rotations, and toolbar modified indicator. */
  engineState: EngineState;
  /** True when the active tab has unsaved engine changes. */
  modified: boolean;
  /** Whether undo is currently possible for the active tab. */
  canUndo: boolean;
  /** False for sample documents (Save is gated to Save-As only). */
  saveInPlaceEnabled: boolean;
  /** Rail engine callbacks. Each is optional so the rail can degrade
   *  gracefully (e.g. tests can omit them to render the rail with no
   *  editing capability). */
  onRotate?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  /** Toolbar action callbacks. */
  onSave?: () => void;
  onSaveAs?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
  /** Phase 3 — annotations. The host (App) holds the canonical list; this
   *  view threads it through to each PageView's overlay and the rail's
   *  annotations panel. */
  annotations?: Annotation[];
  onCreateAnnotation?: (annotation: Annotation) => void;
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  // -- Phase 4: forms --
  formFields?: FormField[];
  onFormValueChange?: (id: string, value: string | string[]) => void;
  onFormListboxToggle?: (id: string, option: string) => void;
  // -- Phase 4: signatures --
  signatures?: SignaturePlacement[];
  savedSignatures?: SavedSignature[];
  armedSignatureId?: string | null;
  /** Place a saved signature on a specific page at the given rect. The
   *  page number is threaded through so the host doesn't have to track
   *  which page the click landed on; SignaturesOverlay already knows
   *  it (it filters placements by `page`) and passes it along. */
  onPlaceSignature?: (signatureId: string, page: number, rect: SignaturePlacement["rect"]) => void;
  onMoveSignature?: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDeleteSignature?: (placementId: string) => void;
}

// Stable empty-array reference: passed to PageView when a page has no search
// hits, so the prop's reference doesn't change between renders (which would
// retrigger PageView's measurement effect and cause a setState loop).
const EMPTY_HITS: SearchHit[] = [];

// Stable no-op for PageView's onPageSize callback. Each PageView currently
// does not surface per-page size to the parent, but the prop is still wired
// through with a stable reference to avoid retriggering the render effect
// on every DocumentView re-render.
const NOOP_PAGE_SIZE = (): void => undefined;

// How many pages to render in the initial synchronous mount on open, so the
// very first paint already shows real bitmaps without waiting for
// IntersectionObserver callbacks. The IO is unreliable in some real-world
// configurations (headless harnesses, certain driver/page-zoom combos); the
// geometry-based mount is the source of truth and the IO is just a progressive
// refinement that can extend the mounted range outward from the viewport.
//
// 3 pages: at fit-width only ~1 page fits the viewport, so 3 covers the
// visible page plus ~1 above for scroll smoothness and keeps the
// always-mounted count for the annotations panel and search overlays
// stable. Each mounted page pins ~3.5MB of GPU/CPU canvas memory at
// cssScale ~1.5x, alpha:false; dropping from 4 -> 3 frees ~3.5MB of
// idle GPU memory on the open canvas (DEF-016 exit target).
const INITIAL_MOUNT_PAGES = 3;

// How many pages of buffer to keep mounted on each side of the viewport, on
// top of the IO rootMargin. The buffer covers the case where the user scrolls
// fast enough that IO callbacks have not yet caught up with the geometry.
//
// 1 page: same per-page bitmap cost as above. The geometry mount
// re-renders a page bitmap on demand when it scrolls into range, so a
// 1-page buffer trades a brief blank-slot flash on extreme fast
// scrolls for ~10 MB less idle GPU memory (was 2, dropped to 1 for
// DEF-016).
const PAGE_BUFFER_PAGES = 1;

// How long the document must be idle (no scroll, no IO change, no
// mounted-set change, no annotation op, no search op) before we ask
// pdf.js to flush its per-document worker-side caches via
// `doc.cleanup()`. The cleanup drops the font cache, the global image
// cache, and the page-tree / page-index lookup tables — the dominant
// idle-time memory contributors for long PDFs (DEF-016). 3 seconds is
// long enough that scroll-jitter and the qa 10-second idle window
// both see the cleaned state, short enough that the renderer settles
// quickly after the user stops interacting.
const DOC_IDLE_CLEANUP_MS = 3000;

// How many pages around the viewport we keep mounted. IntersectionObserver
// does the actual gating; this margin only sizes the buffer so fast scrolls
// don't reveal blank slots. The IO rootMargin is hard-coded in the IO
// useEffect below (800px top/bottom) — tight enough to keep the IO's
// effective intersection window within ~1 page above and below the
// viewport at fit-width, so the observer's internal entry table stays
// bounded instead of tracking hundreds of slot elements on long.pdf.

// How many pages to index before yielding back to the event loop. Keeps the
// UI thread responsive while building the search index on a 500+ page doc.
const SEARCH_CHUNK_PAGES = 8;

/**
 * The full document workspace: side rail (thumbnails / outline), toolbar,
 * search bar, and the virtualized continuous scroller. All per-document
 * view state (zoom, page, search) lives here and is persisted upwards.
 */
export function DocumentView({
  doc,
  pageCount,
  outline,
  initial,
  onPersist,
  onDiagnostics,
  onSearchIndexProgress,
  onToast,
  engineState,
  modified,
  canUndo,
  saveInPlaceEnabled,
  onRotate,
  onDelete,
  onReorder,
  onUndo,
  onSave,
  onSaveAs,
  onMerge,
  onSplit,
  annotations = [],
  onCreateAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  formFields = [],
  onFormValueChange,
  onFormListboxToggle,
  signatures = [],
  savedSignatures = [],
  armedSignatureId = null,
  onPlaceSignature,
  onMoveSignature,
  onDeleteSignature,
}: DocumentViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slotRefsRef = useRef(new Map<number, HTMLDivElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wheelRemainderRef = useRef(0);
  const scrollRafRef = useRef(0);
  // pdf.js per-page render tasks are owned by PageView, but the
  // DocumentView-level idle-cleanup coordinator needs a single
  // document-wide "is anything in flight" probe. PageView calls the
  // stable onRenderStart / onRenderEnd callbacks below; we keep a
  // counter here so the coordinator can see all in-flight renders in
  // one place.
  const inFlightRendersRef = useRef(0);
  // Stable callbacks for PageView to report render lifecycle. useCallback
  // with empty deps so the render effect's dep array doesn't churn and
  // re-fire the entire getPage → render → TextLayer pipeline on every
  // DocumentView re-render.
  const onPageRenderStart = useCallback((): void => {
    inFlightRendersRef.current += 1;
  }, []);
  const onPageRenderEnd = useCallback((): void => {
    // Never go negative — a cancelled effect that ended without firing
    // its beginRender() (e.g. shouldRender flipped false before any
    // page was actually rendered) should not underflow the counter.
    inFlightRendersRef.current = Math.max(0, inFlightRendersRef.current - 1);
  }, []);
  // Idle-cleanup coordinator. Rebuilt per `doc` identity (so a tab
  // change cancels any pending cleanup against the obsolete document
  // and installs a fresh one for the new one).
  const idleCleanupRef = useRef<IdleCleanupCoordinator | null>(null);

  const [firstPageSize, setFirstPageSize] = useState<{ w: number; h: number } | null>(null);
  // `mountedPages` are the only pages that get a real PageView (canvas +
  // TextLayer + search-hit overlays). Every other page is just a fixed-height
  // slot that reserves scroll space. This is what keeps a 520-page doc from
  // freezing the renderer on open.
  const [mountedPages, setMountedPages] = useState<Set<number>>(new Set());
  const [viewportBox, setViewportBox] = useState({ w: 0, h: 0 });
  const [currentPage, setCurrentPage] = useState(initial.currentPage);

  const [zoom, dispatchZoom] = useReducer(zoomReducer, {
    mode: initial.zoomMode,
    manualScale: initial.manualScale,
  } as ZoomState);

  // Phase 3 — annotation tool state and per-annotation flash highlight.
  // The reducer lives in annotations/model.ts; we just hold its state here
  // and pass it down to the toolbar and the per-page overlay.
  const [annTool, dispatchAnnTool] = useReducer(
    annotationToolReducer,
    initialAnnotationToolState,
  );
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [searchOpen, setSearchOpen] = useState(initial.searchOpen);
  const [query, setQuery] = useState(initial.query);
  const [activeHitIndex, setActiveHitIndex] = useState(initial.activeHitIndex);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchIndexProgress, setSearchIndexProgress] = useState<SearchIndexProgress | null>(null);
  const searchTokenRef = useRef(0);
  const indexesRef = useRef(new Map<number, PageTextIndex>());

  // Keep the latest `onSearchIndexProgress` in a ref so the search effect can
  // call it without making the callback itself a dependency (which would
  // re-fire the effect on every parent re-render that produced a fresh
  // callback identity).
  const onSearchIndexProgressRef = useRef(onSearchIndexProgress);
  onSearchIndexProgressRef.current = onSearchIndexProgress;

  // ---- effective scale ----------------------------------------------------
  const effectiveScale = useMemo(() => {
    if (firstPageSize === null) {
      return 1;
    }
    const availW = Math.max(viewportBox.w - CONTENT_PADDING_PX * 2, 50);
    const availH = Math.max(viewportBox.h - CONTENT_PADDING_PX * 2, 50);
    if (zoom.mode === "fit-width") {
      return availW / firstPageSize.w;
    }
    if (zoom.mode === "fit-page") {
      return Math.min(availW / firstPageSize.w, availH / firstPageSize.h);
    }
    return zoom.manualScale;
  }, [zoom, viewportBox, firstPageSize]);
  const effectiveScaleRef = useRef(effectiveScale);
  effectiveScaleRef.current = effectiveScale;

  // ---- first page dims (placeholder sizing for all pages) -------------------
  //
  // `doc.getPage(1)` materializes page 1's per-page state in the worker
  // (commonObjs, page tree cache entry for index 0). We only need its
  // view[] for layout sizing — release the proxy immediately so the
  // page-1 state doesn't stay resident before the initial mount's
  // PageView re-fetches it (page 1 is in the INITIAL_MOUNT_PAGES range
  // anyway, so the small re-parse cost is irrelevant) (DEF-016).
  useEffect(() => {
    let disposed = false;
    void doc.getPage(1).then((page) => {
      if (disposed) {
        return;
      }
      setFirstPageSize({
        w: page.view[2] - page.view[0],
        h: page.view[3] - page.view[1],
      });
      // Drop page 1's per-page worker state right after we read the
      // dims. The next time page 1 is touched (the initial mount's
      // PageView) pdfjs re-parses from the document stream — a few
      // ms cost in exchange for not pinning page 1's state on the
      // critical-path open.
      try {
        page.cleanup();
      } catch {
        // ignore: cleanup can throw if pdf.js already destroyed the page
      }
    });
    return () => {
      disposed = true;
    };
  }, [doc]);

  // ---- viewport size tracking -------------------------------------------------
  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setViewportBox({ w: el.clientWidth, h: el.clientHeight });
      computeGeometryMountRef.current();
    });
    ro.observe(el);
    setViewportBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- page slot registry + IntersectionObserver ---------------------------
  //
  // Slots are the always-mounted, fixed-height placeholders that reserve
  // scroll space for every page. The IO observes them; pages the IO reports
  // as intersecting are added to a separate "extras" set so the geometry
  // mount can pull them in if they're close enough to the viewport.
  //
  // The geometry-based mount (below) is the SOURCE OF TRUTH for which pages
  // get a real PageView. The IO is treated as a progressive refinement: it
  // can ADD pages to the union when (and only when) the browser actually
  // fires IO callbacks for them. It cannot REMOVE pages — the geometry
  // mount owns removal. This is robust against environments where IO
  // callbacks are dropped or never fire (headless harnesses, certain
  // page-zoom configs): in those cases the geometry mount still works, and
  // the IO simply contributes nothing.
  const ioExtraPagesRef = useRef<Set<number>>(new Set());

  const registerSlot = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el === null) {
      const prev = slotRefsRef.current.get(page);
      // unobserve the DOM element we were tracking for this slot, so the
      // IntersectionObserver's internal map doesn't keep a reference to a
      // node React has already removed. Without this, IO instances leak
      // one slot's HTMLElement per scroll-driven remount cycle (DEF-016
      // — DOM-counted headroom, but a real retention path for any code
      // that walks up from the IO).
      if (prev !== undefined) {
        observerRef.current?.unobserve(prev);
      }
      slotRefsRef.current.delete(page);
      return;
    }
    slotRefsRef.current.set(page, el);
    observerRef.current?.observe(el);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    // IntersectionObserver is used as a PROGRESSIVE ENHANCEMENT on top of
    // the geometry-based mount: pages the IO reports as intersecting are
    // added to the visible set so fast scrolls don't reveal blank slots
    // before the geometry mount catches up. The geometry mount owns
    // removal, so the IO cannot keep dead pages mounted.
    //
    // We keep the rootMargin tight (800px / 0px) so the IO's effective
    // intersection window stays within ~1 page above and below the
    // viewport at fit-width. Anything outside that window has nothing to
    // contribute over the geometry mount.
    //
    // Critically we DO NOT pre-observe every slot at mount: that would
    // add 520 entries to the IO's internal tracking table up front, which
    // on long.pdf kept a non-trivial amount of native memory resident in
    // the renderer for elements the geometry mount never cared about
    // (DEF-016). Slots are observed lazily inside registerSlot, and
    // unobserved again on unmount via registerSlot's null branch.
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting && !ioExtraPagesRef.current.has(page)) {
            ioExtraPagesRef.current.add(page);
            changed = true;
          }
        }
        if (changed) {
          // IO is touching the visible range — push out any pending
          // idle cleanup so it doesn't fire mid-render.
          idleCleanupRef.current?.noteActivity();
          // Re-run the geometry mount so the IO additions become visible
          // through the state — the state IS the union of geometry + IO.
          computeGeometryMountRef.current();
        }
      },
      { root: scroller, rootMargin: "800px 0px", threshold: 0 },
    );
    observerRef.current = io;
    // No pre-observe: registerSlot will observe each slot the first time
    // it mounts. The geometry mount will still pick up the visible
    // range synchronously on the first paint (INITIAL_MOUNT_PAGES), so
    // the user never sees a blank workspace while waiting for the IO.
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, []);

  // ---- geometry-based mount: synchronous on open, recomputed on scroll ----
  //
  // The IO-driven mount above is unreliable in some real-world configurations
  // (headless harnesses, certain window/page-zoom combos); the Intersection
  // callbacks can simply never fire for page slots, leaving nothing mounted.
  // To guarantee a working mount regardless of IO behavior, we compute the
  // visible page range from scrollTop + slot geometry in JS (using
  // `visiblePageRange` from pageGeometry.ts — the same math the scrollbar
  // uses). The mounted set is the geometry range, UNION'd with IO extras
  // that are still close enough to the viewport to be useful. Far-out IO
  // extras are pruned so the mounted set stays bounded.
  const computeGeometryMountRef = useRef<() => void>(() => undefined);
  computeGeometryMountRef.current = (): void => {
    const scroller = scrollerRef.current;
    if (firstPageSize === null) {
      return;
    }
    const range = visiblePageRange(
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
      firstPageSize.h,
      effectiveScaleRef.current,
      pageCount,
      PAGE_BUFFER_PAGES,
    );
    const rangeStart = range.start;
    const rangeEnd = range.end;
    setMountedPages((prev) => {
      // Drop IO extras that have scrolled far from the current viewport so
      // the union can't grow without bound. We keep anything within
      // PRUNE_DISTANCE_PAGES of the geometry range; farther entries are
      // pruned (and their bitmap is dropped via PageView's unmount +
      // shouldRender=false clear). A smaller buffer keeps idle memory
      // lower at the cost of a slightly slower first scroll into a far
      // page — the rail re-renders from scratch on demand.
      const PRUNE_DISTANCE_PAGES = 4;
      const keepLow = rangeStart - PRUNE_DISTANCE_PAGES;
      const keepHigh = rangeEnd + PRUNE_DISTANCE_PAGES;
      for (const page of ioExtraPagesRef.current) {
        if (page < keepLow || page > keepHigh) {
          ioExtraPagesRef.current.delete(page);
        }
      }
      let changed = false;
      const next = new Set<number>();
      for (let p = rangeStart; p <= rangeEnd; p += 1) {
        next.add(p);
      }
      // IO extras within range are included.
      for (const page of ioExtraPagesRef.current) {
        if (page >= rangeStart && page <= rangeEnd) {
          next.add(page);
        }
      }
      if (next.size !== prev.size) {
        changed = true;
      } else {
        for (const p of next) {
          if (!prev.has(p)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  };

  // Initial synchronous mount: as soon as the document opens and the first
  // page's dimensions are known, mount the first INITIAL_MOUNT_PAGES slots so
  // the very first paint already shows real bitmaps. No IO round-trip, no
  // async — by definition available on the first paint.
  useEffect(() => {
    if (firstPageSize === null) {
      return;
    }
    const initialEnd = Math.min(pageCount, INITIAL_MOUNT_PAGES);
    setMountedPages((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (let p = 1; p <= initialEnd; p += 1) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Also seed the IO extras with the initial range so the geometry mount
    // doesn't immediately prune what we just added.
    for (let p = 1; p <= initialEnd; p += 1) {
      ioExtraPagesRef.current.add(p);
    }
    // Run a geometry mount so the state converges with the IO extras.
    computeGeometryMountRef.current();
  }, [firstPageSize, pageCount]);

  // ---- scroll -> current page --------------------------------------------------
  const computeCurrentPage = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || firstPageSize === null) {
      return;
    }
    const page = pageAtScrollTop(
      scroller.scrollTop,
      firstPageSize.h,
      effectiveScaleRef.current,
      pageCount,
    );
    setCurrentPage((prev) => (prev === page ? prev : page));
  }, [firstPageSize, pageCount]);

  const onScroll = useCallback(() => {
    if (scrollRafRef.current !== 0) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      // Touching the document — push out any pending idle cleanup so
      // it doesn't fire mid-render. Resets the 5s window from "now".
      idleCleanupRef.current?.noteActivity();
      computeCurrentPage();
      computeGeometryMountRef.current();
    });
  }, [computeCurrentPage]);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== 0) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    },
    [],
  );

  // ---- jump ----------------------------------------------------------------------
  const jumpToPage = useCallback(
    (page: number, smooth = true) => {
      const scroller = scrollerRef.current;
      if (scroller === null || firstPageSize === null) {
        return;
      }
      const target = slotOffsetTop(page, firstPageSize.h, effectiveScaleRef.current);
      scroller.scrollTo({
        top: Math.max(target - CONTENT_PADDING_PX, 0),
        behavior: smooth ? "smooth" : "instant",
      });
      setCurrentPage(page);
    },
    [firstPageSize],
  );

  // ---- initial page restore -------------------------------------------------------
  useEffect(() => {
    const target = initial.currentPage;
    if (target <= 1) {
      return;
    }
    const timer = window.setTimeout(() => jumpToPage(target, false), 60);
    return () => window.clearTimeout(timer);
  }, [jumpToPage, initial.currentPage]);

  // ---- zoom controls -----------------------------------------------------------------
  const zoomTo = useCallback((direction: 1 | -1) => {
    const next = stepTowards(effectiveScaleRef.current, direction);
    dispatchZoom({ type: "set-manual-scale", scale: next });
  }, []);
  const setMode = useCallback((mode: ZoomMode) => {
    dispatchZoom({ type: "set-mode", mode });
  }, []);

  // ---- ctrl+wheel zoom -----------------------------------------------------------------
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const { remainder, steps } = accumulateWheel(wheelRemainderRef.current, e.deltaY);
      wheelRemainderRef.current = remainder;
      if (steps !== 0) {
        let scale = effectiveScaleRef.current;
        for (let i = 0; i < Math.abs(steps); i += 1) {
          scale = stepTowards(scale, steps > 0 ? 1 : -1);
        }
        dispatchZoom({ type: "set-manual-scale", scale });
      }
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  // ---- search ---------------------------------------------------------------------------
  //
  // Lazy + incremental: the index is built per-page on first use and cached in
  // `indexesRef`. Subsequent searches reuse cached entries. The build loop
  // yields back to the event loop every SEARCH_CHUNK_PAGES pages so the
  // renderer (scrolling, UI interactions) stays responsive on a 500+ page
  // doc. `searchIndexProgress` reports { built, total } so the diagnostics
  // snapshot in tflexDiagnostics can show what's going on.
  useEffect(() => {
    const token = ++searchTokenRef.current;
    const q = query.trim();
    if (q.length === 0) {
      setHits([]);
      setSearching(false);
      setActiveHitIndex(-1);
      setSearchIndexProgress(null);
      onSearchIndexProgressRef.current?.(null);
      return;
    }
    setSearching(true);
    setSearchIndexProgress({ built: 0, total: pageCount });
    onSearchIndexProgressRef.current?.({ built: 0, total: pageCount });
    // Search walks every page, calling doc.getPage() and getTextContent
    // for the un-indexed ones. Treat that as document activity so the
    // idle cleanup doesn't fire mid-index.
    idleCleanupRef.current?.noteActivity();
    let cancelled = false;
    const collected: SearchHit[] = [];
    const run = async (): Promise<void> => {
      let built = 0;
      const total = pageCount;
      for (let page = 1; page <= pageCount; page += 1) {
        let index = indexesRef.current.get(page);
        if (index === undefined) {
          const pdfPage = await doc.getPage(page);
          const textContent = await pdfPage.getTextContent();
          const items = textContent.items.map((item) =>
            "str" in item && typeof item.str === "string" ? item.str : "",
          );
          index = buildPageIndex(items);
          indexesRef.current.set(page, index);
          built += 1;
        }
        collected.push(...findPageHits(index, page, q));
        if (cancelled || token !== searchTokenRef.current) {
          return;
        }
        if (page % SEARCH_CHUNK_PAGES === 0) {
          const snapshot = { built, total };
          setSearchIndexProgress(snapshot);
          onSearchIndexProgressRef.current?.(snapshot);
          // Still mid-walk — push the idle window out so cleanup doesn't
          // fire while the search loop is iterating pages.
          idleCleanupRef.current?.noteActivity();
          await new Promise<void>((r) => setTimeout(r, 0));
          if (cancelled || token !== searchTokenRef.current) {
            return;
          }
        }
      }
      if (!cancelled && token === searchTokenRef.current) {
        setHits(collected);
        setSearching(false);
        setActiveHitIndex(collected.length > 0 ? 0 : -1);
        const snapshot = { built, total };
        setSearchIndexProgress(snapshot);
        onSearchIndexProgressRef.current?.(snapshot);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, doc, pageCount]);

  // Reset the cached search index when the document changes (different `doc`
  // reference). The `doc` identity changes whenever a new PDF is opened.
  useEffect(() => {
    indexesRef.current = new Map();
  }, [doc]);

  // ---- idle document cleanup -----------------------------------------------
  //
  // pdf.js keeps per-document worker-side caches alive for the entire
  // lifetime of the `PDFDocumentProxy`:
  //
  //   - font cache (loaded TrueType / OpenType data, cmaps)
  //   - global image cache (decoded JPEG / JPX / JBig2 bitmaps)
  //   - pageDictCache / pageIndexCache / pageKidsCountCache
  //   - standardFontDataCache / builtInCMapCache / systemFontCache
  //
  // On long.pdf these dominate the renderer idle footprint (DEF-016
  // exit target: <=150 MB idle). `doc.cleanup()` flushes them all in
  // one async call, but only when no render is in flight — pdf.js
  // refuses cleanup during active renders.
  //
  // The coordinator is rebuilt per `doc` identity: a pending cleanup
  // against an obsolete document is cancelled when the user opens a
  // new tab, and a fresh coordinator is installed for the new
  // document.
  useEffect(() => {
    const coord = createIdleCleanupCoordinator(
      () => {
        // pdf.js cleanup is async. Swallow rejection — a failed
        // cleanup is a memory miss, not a correctness issue, and the
        // next idle window will try again.
        return Promise.resolve(doc.cleanup()).catch(() => undefined);
      },
      () => inFlightRendersRef.current > 0,
      { idleMs: DOC_IDLE_CLEANUP_MS },
    );
    idleCleanupRef.current = coord;
    // Reset the in-flight counter on document change so a counter
    // from the previous tab doesn't gate cleanup on the new one.
    inFlightRendersRef.current = 0;
    coord.requestCleanup();
    return () => {
      coord.cancel();
      idleCleanupRef.current = null;
    };
  }, [doc]);

  // ---- Forms / signatures (Phase 4) ----
  // Phase 4: derived per-page groups so each PageView's overlays only see
  // their own fields / placements (avoids re-rendering every page on
  // every fill or move).
  const formFieldsByPage = useMemo(() => {
    const map = new Map<number, FormField[]>();
    for (const f of formFields) {
      const list = map.get(f.page);
      if (list === undefined) {
        map.set(f.page, [f]);
      } else {
        list.push(f);
      }
    }
    return map;
  }, [formFields]);

  const signaturesByPage = useMemo(() => {
    const map = new Map<number, SignaturePlacement[]>();
    for (const p of signatures) {
      const list = map.get(p.page);
      if (list === undefined) {
        map.set(p.page, [p]);
      } else {
        list.push(p);
      }
    }
    return map;
  }, [signatures]);

  // Lookup map: saved signature id -> SavedSignature. The signatures
  // overlay reads from this so the SVG render path can resolve any
  // placement back to its source bytes / points / text.
  const savedSignatureMap = useMemo(() => {
    const map: Record<string, SavedSignature> = {};
    for (const s of savedSignatures) map[s.id] = s;
    return map;
  }, [savedSignatures]);

  const onFormValueChangeStable = useCallback(
    (id: string, value: string | string[]): void => {
      onFormValueChange?.(id, value);
    },
    [onFormValueChange],
  );
  const onFormListboxToggleStable = useCallback(
    (id: string, option: string): void => {
      onFormListboxToggle?.(id, option);
    },
    [onFormListboxToggle],
  );
  const onPlaceSignatureStable = useCallback(
    (signatureId: string, page: number, rect: SignaturePlacement["rect"]): void => {
      onPlaceSignature?.(signatureId, page, rect);
    },
    [onPlaceSignature],
  );
  const onMoveSignatureStable = useCallback(
    (placementId: string, rect: SignaturePlacement["rect"]): void => {
      onMoveSignature?.(placementId, rect);
    },
    [onMoveSignature],
  );
  const onDeleteSignatureStable = useCallback(
    (placementId: string): void => {
      onDeleteSignature?.(placementId);
    },
    [onDeleteSignature],
  );

  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.page);
      if (list === undefined) {
        map.set(hit.page, [hit]);
      } else {
        list.push(hit);
      }
    }
    return map;
  }, [hits]);

  const activeHit =
    activeHitIndex >= 0 && activeHitIndex < hits.length ? hits[activeHitIndex] : null;

  const cycleHits = useCallback(
    (direction: 1 | -1) => {
      setActiveHitIndex((prev) => {
        if (hits.length === 0) {
          return -1;
        }
        const current = prev < 0 ? (direction === 1 ? -1 : 0) : prev;
        return direction === 1
          ? nextHitIndex(current, hits.length)
          : prevHitIndex(current, hits.length);
      });
    },
    [hits.length],
  );

  const onActiveHitTop = useCallback(
    (page: number, cssTop: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null || firstPageSize === null) {
        return;
      }
      const pageTop = slotOffsetTop(page, firstPageSize.h, effectiveScaleRef.current);
      const target = pageTop + cssTop - scroller.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(target, 0), behavior: "smooth" });
    },
    [firstPageSize],
  );

  // ---- annotations (Phase 3) -----------------------------------------------
  // Hand the toolbar's actions straight through the reducer. The toolbar is
  // disabled when there is no document (always-disabled prop is false here
  // because a tab is mounted only when a document is open).
  const onAnnToolAction = useCallback((a: AnnotationToolAction): void => {
    dispatchAnnTool(a);
  }, []);

  // When the rail's annotations panel jumps to an annotation, scroll to its
  // page and pulse a flash highlight on the matching overlay. The flash is
  // purely visual — it does not move focus or selection.
  const flashAnnotation = useCallback((id: string): void => {
    setFlashId(id);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1700);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const onAnnJump = useCallback(
    (page: number, id: string): void => {
      jumpToPage(page, true);
      flashAnnotation(id);
    },
    [jumpToPage, flashAnnotation],
  );

  // Group annotations by page so each PageView only sees its own (avoids
  // re-rendering every page on every annotation create/edit).
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.page);
      if (list === undefined) {
        map.set(a.page, [a]);
      } else {
        list.push(a);
      }
    }
    return map;
  }, [annotations]);

  // After a one-shot tool (textbox, note) commits, return to plain select so
  // the next page click doesn't accidentally open another editor.
  const onAnnFinishedOneShot = useCallback((): void => {
    dispatchAnnTool({ type: "set-tool", tool: "select" });
  }, []);

  // ---- keyboard: Ctrl+F opens search, Escape closes --------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // ---- persistence + diagnostics ------------------------------------------------------------
  useEffect(() => {
    onPersist({
      zoomMode: zoom.mode,
      manualScale: zoom.manualScale,
      currentPage,
      searchOpen,
      query,
      activeHitIndex,
    });
  }, [zoom, currentPage, searchOpen, query, activeHitIndex, onPersist]);

  useEffect(() => {
    onDiagnostics({
      pageCount,
      currentPage,
      zoom: Math.round(effectiveScale * 100) / 100,
      mode: zoom.mode,
      searchQuery: query,
      searchHits: hits.length,
      searchIndexProgress,
    });
  }, [
    pageCount,
    currentPage,
    effectiveScale,
    zoom.mode,
    query,
    hits.length,
    searchIndexProgress,
    onDiagnostics,
  ]);

  const pageJump = useCallback(
    (input: string) => {
      const n = Number.parseInt(input, 10);
      if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
        jumpToPage(n);
      }
    },
    [jumpToPage, pageCount],
  );

  const railError = useCallback(
    (msg: string) => {
      onToast?.("error", msg);
    },
    [onToast],
  );

  // Slot height in CSS px (pageHeight * cssScale + gap). Zero until the first
  // page's dimensions are known; before that, every slot has no height and
  // the scroller's content height equals just the padding, so no overflow
  // happens while we wait.
  const slotHeightPx = firstPageSize === null ? 0 : pageSlotHeight(firstPageSize.h, effectiveScale);
  const pageWidthPx = firstPageSize === null ? 0 : firstPageSize.w * effectiveScale;

  return (
    <div className="workspace">
      <SideRail
        doc={doc}
        pageCount={pageCount}
        outline={outline}
        currentPage={currentPage}
        defaultWidthPt={firstPageSize?.w ?? 612}
        defaultHeightPt={firstPageSize?.h ?? 792}
        engineState={engineState}
        canUndo={canUndo}
        onOp={onRotate}
        onDelete={onDelete}
        onReorder={onReorder}
        onUndo={onUndo}
        onJump={(p): void => jumpToPage(p)}
        onError={railError}
        annotations={annotations}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onJumpToAnnotation={onAnnJump}
      />
      <div className="workspace-main">
        <Toolbar
          page={currentPage}
          pageCount={pageCount}
          zoomPercent={Math.round(effectiveScale * 100)}
          zoomMode={zoom.mode}
          modified={modified}
          saveInPlaceEnabled={saveInPlaceEnabled}
          onJump={pageJump}
          onZoomIn={(): void => zoomTo(1)}
          onZoomOut={(): void => zoomTo(-1)}
          onFitWidth={(): void => setMode("fit-width")}
          onFitPage={(): void => setMode("fit-page")}
          searchOpen={searchOpen}
          onToggleSearch={(): void => setSearchOpen((v) => !v)}
          onSave={(): void => onSave?.()}
          onSaveAs={(): void => onSaveAs?.()}
          onMerge={(): void => onMerge?.()}
          onSplit={(): void => onSplit?.()}
          signToolActive={armedSignatureId !== null}
          onSignClick={(): void => {
            // The toolbar's Sign button toggles the modal at the App
            // level. We don't open the modal here; we just notify App so
            // it can decide to open the manager or clear the armed id.
            // The actual action lives on App (wires the modal open +
            // passes onApply). The toolbar's button click event is
            // synthesised below via window.dispatchEvent so App can
            // catch it cleanly.
            window.dispatchEvent(new CustomEvent("tflex:sign-button"));
          }}
          hasFormFields={formFields.length > 0}
          onFlattenClick={(): void => {
            window.dispatchEvent(new CustomEvent("tflex:flatten-button"));
          }}
        />
        <AnnotationToolbar state={annTool} onAction={onAnnToolAction} />
        {searchOpen && (
          <SearchBar
            query={query}
            onQuery={setQuery}
            resultCount={hits.length}
            activeIndex={activeHitIndex}
            searching={searching}
            onNext={(): void => cycleHits(1)}
            onPrev={(): void => cycleHits(-1)}
            onClose={(): void => setSearchOpen(false)}
          />
        )}
        <div ref={scrollerRef} className="document-scroller" onScroll={onScroll}>
          <div className="document-content">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
              const isMounted = mountedPages.has(page);
              return (
                <div
                  key={page}
                  ref={(el) => registerSlot(page, el)}
                  className="page-slot"
                  data-page={page}
                  style={{
                    height: slotHeightPx > 0 ? `${slotHeightPx - PAGE_GAP_PX}px` : 0,
                    width: pageWidthPx > 0 ? `${pageWidthPx}px` : undefined,
                  }}
                >
                  {isMounted && (
                    <PageView
                      doc={doc}
                      pageNumber={page}
                      widthPt={firstPageSize?.w ?? 612}
                      heightPt={firstPageSize?.h ?? 792}
                      cssScale={effectiveScale}
                      shouldRender={true}
                      hits={hitsByPage.get(page) ?? EMPTY_HITS}
                      activeHit={activeHit?.page === page ? activeHit : null}
                      registerPage={NOOP_REGISTER}
                      onPageSize={NOOP_PAGE_SIZE}
                      onActiveHitTop={onActiveHitTop}
                      annotations={annotationsByPage.get(page) ?? EMPTY_ANNOTATIONS}
                      annotationTool={annTool}
                      flashId={flashId}
                      onCreateAnnotation={(a): void => onCreateAnnotation?.(a)}
                      onFinishedOneShot={onAnnFinishedOneShot}
                      onRenderStart={onPageRenderStart}
                      onRenderEnd={onPageRenderEnd}
                      formFields={formFieldsByPage.get(page) ?? EMPTY_FIELDS}
                      onFormValueChange={onFormValueChangeStable}
                      onFormListboxToggle={onFormListboxToggleStable}
                      signatures={signaturesByPage.get(page) ?? EMPTY_PLACEMENTS}
                      savedSignatures={savedSignatureMap}
                      armedSignatureId={armedSignatureId}
                      onPlaceSignature={onPlaceSignatureStable}
                      onMoveSignature={onMoveSignatureStable}
                      onDeleteSignature={onDeleteSignatureStable}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stable no-op for PageView's `registerPage` prop. With virtualization, slot
// mounting is driven by DocumentView's own IntersectionObserver; PageView no
// longer needs to register itself with the parent.
const NOOP_REGISTER = (): void => undefined;

// Stable empty annotations array — passed to PageView when a page has no
// annotations, so the prop's reference doesn't change between renders.
const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_FIELDS: FormField[] = [];
const EMPTY_PLACEMENTS: SignaturePlacement[] = [];
