// Phase 66 — the in-canvas read-only Book View mode.
//
// For ANY open document the canvas's top-left "Book View" control swaps the
// pane's DocumentView for this surface. It renders the document's current page
// read-only through the EXISTING `PageView`, scaled to the measured stage.
// Chunk 1 was the mode shell; chunk 2 (this file now) adds the single/double
// layout toggle, the two-page spread with a centre crease and the transform-only
// CSS 3D page-turn flip. Annotation wiring stays out (chunk 3).
//
// Book View replaces the whole DocumentView, so the PAGES rail, the Action
// Dock and the annotation flyout are absent by construction; App additionally
// collapses the Inspector and the rail track while the mode is on.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Columns2, Square, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PageView } from './PageView';
import { useInstantMotion } from '../hooks/useAnimations';
import { AnnotationToolbar } from '../annotations/AnnotationToolbar';
import {
  annotationToolReducer,
  initialAnnotationToolState,
} from '../annotations/model';
import type {
  Annotation,
  AnnotationPatch,
  AnnotationToolState,
} from '../annotations/model';
import type { AppTheme, ReadingDefaults } from '../../shared/types';

export interface BookViewProps {
  /** The open document's PDF.js proxy (the converted comic/book is an
   *  ordinary open PDF — pages are reused, never re-rasterized). */
  doc: PDFDocumentProxy;
  /** The document's page count (engine-ordered, the user-visible total). */
  pageCount: number;
  /** The document's display title. */
  title: string;
  /** The stored comic reading layout; seeds the initial single/double state
   *  once (REQUIREMENTS.md feature D). The header toggle then owns it. */
  defaultLayout: ReadingDefaults['comics']['layout'];
  /** TFL-1116 R25 — the reading location to open at (1-based). The host passes
   *  the tab's stored `persisted.currentPage`. Absent / non-finite opens at
   *  page 1 (the pre-change behaviour). */
  initialPage?: number;
  /** Leave Book View. TFL-1116 R25 — carries the 1-based page the reader
   *  reached (the visible spread's first page) so the host can persist it and
   *  the DocumentView re-mounts at that location; `undefined` for an empty
   *  document. */
  onClose: (finalPage?: number) => void;
  /** TFL-1116 R25 (DEF-627) — report the reading location reached in Book View
   *  on EVERY exit route, not just the header Close button. The host persists
   *  the reached page when Book View unmounts for any reason (a tab switch
   *  included), so leaving by activating another tab no longer loses the
   *  location. `undefined` for an empty document. Absent keeps the pre-change
   *  behaviour (only `onClose` reports). */
  onLocationChange?: (finalPage?: number) => void;
  /** Phase 66 (chunk 3) — the document's committed annotations (all pages).
   *  BookView filters them per visible page and hands each `PageView` only
   *  its own slice. */
  annotations: Annotation[];
  /** Annotation ids whose overlay text must be drawn live (DEF-166). */
  liveAnnTextIds?: ReadonlySet<string>;
  /** Commit a newly placed annotation through the app-level engine handler. */
  onCreateAnnotation: (a: Annotation) => void;
  /** Edit / delete a committed annotation through the app-level handlers. */
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** The custom annotation colour palette + its writer (same source as the
   *  DocumentView flyout). */
  annotationPalette?: {
    light?: Array<{ id: string; hex: string }>;
    dark?: Array<{ id: string; hex: string }>;
  } | null;
  onAnnotationPaletteChange?: (next: {
    light?: Array<{ id: string; hex: string }>;
    dark?: Array<{ id: string; hex: string }>;
  }) => void;
  /** The active app theme; drives the toolbar's preset bucket. */
  themeName?: AppTheme;
  /** Persisted MRU annotation tool order + its writer. */
  annotationRecentTools?: string[];
  onAnnotationRecentToolsChange?: (ids: string[]) => void;
}

/** JPEG-like default at 1x for a US Letter page, replaced by the first
 *  `PageView` size report. Mirrors `ComicPage`'s placeholder dims. */
const INITIAL_PAGE_DIMS = { width: 612, height: 792 };

/** Phase 66 (chunk 2) — the visual gap the centre crease occupies, subtracted
 *  from the stage width when sizing each half of a double spread. */
const SPREAD_CREASE_PX = 12;

/** The fallback that clears the transient turn. It mirrors the layout
 *  motion token (`--motion-duration-layout`, 350ms) plus a small margin: in a
 *  real browser `animationend` commits first; in jsdom, where no animation
 *  runs, this timer guarantees the turn still commits and unmounts. */
const TURN_FALLBACK_MS = 400;

/** Phase 77 (chunk B) — the fallback that clears the one-shot Book View
 *  ENTRY marker. Mirrors `TURN_FALLBACK_MS`: in a browser `animationend`
 *  clears it first; in jsdom, where no animation runs, this timer prevents a
 *  stale marker from hanging forever. */
const ENTER_FALLBACK_MS = 400;

/** Phase 77 (chunk B) — the fallback that clears the one-shot single/double
 *  RELAYOUT marker. Same timer-vs-event contract as `TURN_FALLBACK_MS`. */
const RELAYOUT_FALLBACK_MS = 400;

/** Phase 93 (TFL-515) — the in-flight page-turn. It is applied to the
 *  already-mounted OUTGOING page figure (never a freshly mounted duplicate):
 *  the figure rotates in place, its own painted `PageView` canvas is the front
 *  face, and a single hidden back face carries the incoming page. The base
 *  spread stays on the outgoing index until `animationend` commits `target`
 *  exactly once. */
interface BookTurn {
  dir: 'next' | 'prev';
  /** Restarts the CSS animation when a queued step chains into a new turn
   *  without unmounting the figure (parity alternates the keyframe name). */
  key: number;
  /** 1-based page number carried by the front (outgoing) face. */
  front: number;
  /** 1-based page number carried by the back (incoming) face. */
  back: number;
  /** Zero-based index the base spread commits to when the turn settles. */
  target: number;
}

// DEF-395 — module-scope no-op callbacks and empty arrays keep every prop
// handed to `PageView` identity-stable, so its render effect (which depends on
// `onPageSize`) cannot re-run itself into the render -> effect -> setState
// loop (React #185). `ComicPage` (ReadingView.tsx) is the pattern.
const EMPTY_HITS: never[] = [];
const EMPTY_ANNOTATIONS: never[] = [];
const noopActiveHitTop = (): void => undefined;

// DEF-448 — the annotation UI roots whose clicks must never turn the book page.
// The colour popover is portaled to document.body (AnnColorBox.tsx), so it sits
// outside `.annotation-layer`; the content action bar is likewise its own root.
// Any target inside one of these is annotation UI, not a page click.
const ANNOTATION_UI_ROOTS = '.annotation-layer, [data-content-action-bar], [data-color-popover]';
const isAnnotationUi = (target: Element | null): boolean =>
  target?.closest?.(ANNOTATION_UI_ROOTS) != null;

/** TFL-1116 R25 — map a 1-based reading page to BookView's zero-based spread
 *  index for the layout. Single: `page - 1`. Double: the spread's first index,
 *  which is even because the comic pairing is (1,2), (3,4), ... (the same
 *  window `stepForward` / `finishTurn` commit to), clamped to the last spread's
 *  index. A missing / non-finite page opens at index 0 (page 1). */
function seedPageIndex(
  initialPage: number | undefined,
  layout: ReadingDefaults['comics']['layout'],
  total: number,
): number {
  if (initialPage === undefined || !Number.isFinite(initialPage)) return 0;
  const step = layout === 'double' ? 2 : 1;
  const maxIndex = Math.max(total - step, 0);
  const page = Math.min(Math.max(Math.floor(initialPage), 1), Math.max(total, 1));
  const base = page - 1;
  const index = step === 2 ? base - (base % 2) : base;
  return Math.min(Math.max(index, 0), maxIndex);
}

/** One book page, rendered read-only with the EXISTING `PageView` and scaled
 *  to CONTAIN within the measured stage (fit both axes — a book page must
 *  never overflow the canvas). Split into its own component so the stable
 *  `handlePageSize` lives with the page, exactly like `ComicPage`. */
function BookPage(props: {
  doc: PDFDocumentProxy;
  index: number;
  stageWidth: number;
  stageHeight: number;
  annotations: Annotation[];
  annotationTool: AnnotationToolState;
  liveAnnTextIds?: ReadonlySet<string>;
  onCreateAnnotation: (annotation: Annotation) => void;
  onFinishedOneShot: () => void;
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
}): ReactElement {
  const {
    doc,
    index,
    stageWidth,
    stageHeight,
    annotations,
    annotationTool,
    liveAnnTextIds,
    onCreateAnnotation,
    onFinishedOneShot,
    onEditAnnotation,
    onDeleteAnnotation,
  } = props;
  const [dims, setDims] = useState(INITIAL_PAGE_DIMS);
  // DEF-395 — identity-stable (no deps; only touches the stable setter) and
  // bails out when the reported size is unchanged, so a re-run of PageView's
  // effect cannot churn state.
  const handlePageSize = useCallback(
    (_page: number, widthPt: number, heightPt: number): void => {
      setDims((prev) =>
        prev.width === widthPt && prev.height === heightPt
          ? prev
          : { width: widthPt, height: heightPt },
      );
    },
    [],
  );
  const fitScale = Math.min(
    stageWidth / Math.max(dims.width, 1),
    stageHeight / Math.max(dims.height, 1),
  );
  const cssScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  return (
    <PageView
      doc={doc}
      page={index + 1}
      sourcePage={index + 1}
      widthPt={dims.width}
      heightPt={dims.height}
      cssScale={cssScale}
      shouldRender
      hits={EMPTY_HITS}
      activeHit={null}
      onPageSize={handlePageSize}
      onActiveHitTop={noopActiveHitTop}
      annotations={annotations}
      annotationTool={annotationTool}
      liveAnnTextIds={liveAnnTextIds}
      flashId={null}
      onCreateAnnotation={onCreateAnnotation}
      onFinishedOneShot={onFinishedOneShot}
      onEditAnnotation={onEditAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      rotation={0}
    />
  );
}

export function BookView(props: BookViewProps): ReactElement {
  const {
    doc,
    pageCount,
    title,
    defaultLayout,
    initialPage,
    onClose,
    onLocationChange,
    annotations,
    liveAnnTextIds,
    onCreateAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    annotationPalette,
    onAnnotationPaletteChange,
    themeName,
    annotationRecentTools,
    onAnnotationRecentToolsChange,
  } = props;
  const total = Math.max(pageCount, 0);

  // Phase 66 (chunk 3) — the armed annotation tool. Mirrors DocumentView's
  // reducer; the toolbar row below is its only writer in Book View.
  const [annTool, dispatchAnnTool] = useReducer(
    annotationToolReducer,
    initialAnnotationToolState,
  );
  // After a one-shot tool commits, return to plain select (DocumentView's
  // `onAnnFinishedOneShot` pattern).
  const onFinishedOneShot = useCallback((): void => {
    dispatchAnnTool({ type: 'set-tool', tool: 'select' });
  }, []);

  // Group annotations by visible page so each `PageView` sees only its own.
  // `Annotation.page` and `BookPage`'s `index + 1` are the same 1-based space.
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

  // Phase 66 (chunk 2) — the spread layout, seeded ONCE from the stored comic
  // reading layout (REQUIREMENTS.md feature D). The header toggle is the only
  // writer after mount.
  const [layout, setLayout] = useState<ReadingDefaults['comics']['layout']>(defaultLayout);
  const step = layout === 'double' ? 2 : 1;

  // Zero-based page index, mirroring the comic view's window semantics
  // (ReadingView.tsx:236-254 forward/back, 293-300 the [i, i + step) window).
  // TFL-1116 R25 — seeded ONCE from the reading location the host passed, so
  // Book View opens where the reader was instead of always at page 1.
  const [pageIndex, setPageIndex] = useState(() =>
    seedPageIndex(initialPage, defaultLayout, total),
  );
  const maxIndex = Math.max(total - step, 0);
  const current = total === 0 ? 0 : Math.min(Math.max(pageIndex, 0), maxIndex);

  // Phase 93 (TFL-515) — effective-motion gate. Under reduced motion / the
  // Animations setting OFF the turn mounts NO leaf and commits synchronously.
  const instant = useInstantMotion();

  // A ref mirror of the committed index so click handlers never read a stale
  // closure while a turn is in flight (the rendered index is unchanged then).
  const currentRef = useRef(current);
  currentRef.current = current;

  // The in-flight turn. It is applied to the already-mounted outgoing figure,
  // so the front face is the painted canvas, not a fresh white `PageView`. The
  // base spread keeps its outgoing index until `finishTurn` commits `target`.
  const [turn, setTurn] = useState<BookTurn | null>(null);
  const turnRef = useRef<BookTurn | null>(null);
  const turnKeyRef = useRef(0);
  // Rapid input coalesces to AT MOST ONE queued step: a second click during a
  // turn replaces this (never mounts a second leaf) and runs once the current
  // turn commits.
  const pendingRef = useRef<'next' | 'prev' | null>(null);
  // Phase 77 (chunk B) — the one-shot Book View entrance, live from mount until
  // its `animationend` or the fallback timer. Seeded `true` so the first paint
  // already carries `[data-book-enter="true"]`.
  const [entering, setEntering] = useState(true);
  // Phase 77 (chunk B) — the one-shot single<->double relayout, started by
  // `chooseLayout` and cleared on the stage's `animationend` / fallback timer.
  const [relayout, setRelayout] = useState(false);
  // DEF-446 — a placement gesture commits one-shot and flips the tool back to
  // `select` before the browser synthesizes its `click`. That re-render makes
  // the annotation layer `pointer-events: none`, so the click retargets to the
  // page and would turn it. We remember the pointerdown's layer membership in
  // the capture phase (before the click) and consume it in the click handler.
  const annLayerPressRef = useRef(false);

  // Start a turn from `from` (the still-committed outgoing index). The front
  // face is the outgoing figure's page; the back face is the one revealed by
  // the swing (next: front + 1, prev: front - 1).
  const beginTurn = useCallback(
    (dir: 'next' | 'prev', from: number): void => {
      if (total === 0) return;
      const delta = dir === 'next' ? step : -step;
      const target = Math.min(Math.max(from + delta, 0), maxIndex);
      if (target === from) return;
      const front =
        dir === 'next' ? (layout === 'double' ? from + 2 : from + 1) : from + 1;
      const back = dir === 'next' ? front + 1 : from;
      turnKeyRef.current += 1;
      const next: BookTurn = { dir, key: turnKeyRef.current, front, back, target };
      turnRef.current = next;
      setTurn(next);
    },
    [total, step, maxIndex, layout],
  );

  // Commit the destination EXACTLY ONCE, drop the leaf, then run the single
  // coalesced queued step (if any) from the just-committed index.
  const finishTurn = useCallback((): void => {
    const active = turnRef.current;
    if (active === null) return;
    turnRef.current = null;
    setTurn(null);
    currentRef.current = active.target;
    setPageIndex(active.target);
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued !== null) beginTurn(queued, active.target);
  }, [beginTurn]);

  const stepForward = useCallback((): void => {
    if (total === 0) return;
    if (turnRef.current !== null) {
      pendingRef.current = 'next';
      return;
    }
    if (instant) {
      const target = Math.min(Math.max(currentRef.current + step, 0), maxIndex);
      if (target === currentRef.current) return;
      currentRef.current = target;
      setPageIndex(target);
      return;
    }
    beginTurn('next', currentRef.current);
  }, [total, step, maxIndex, instant, beginTurn]);

  const stepBack = useCallback((): void => {
    if (total === 0) return;
    if (turnRef.current !== null) {
      pendingRef.current = 'prev';
      return;
    }
    if (instant) {
      const target = Math.max(currentRef.current - step, 0);
      if (target === currentRef.current) return;
      currentRef.current = target;
      setPageIndex(target);
      return;
    }
    beginTurn('prev', currentRef.current);
  }, [total, step, instant, beginTurn]);

  const chooseLayout = useCallback((next: ReadingDefaults['comics']['layout']): void => {
    setLayout(next);
    turnRef.current = null;
    pendingRef.current = null;
    setTurn(null);
    setRelayout(true);
  }, []);

  useEffect(() => {
    if (turn === null) return;
    const timer = window.setTimeout(finishTurn, TURN_FALLBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, [turn, finishTurn]);

  // Phase 77 (chunk B) — the entry marker is transient: the root's own
  // `animationend` clears it first, this timer guarantees it in jsdom (which
  // never fires animation events).
  useEffect(() => {
    const timer = window.setTimeout((): void => setEntering(false), ENTER_FALLBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, []);

  // Phase 77 (chunk B) — clear the relayout marker the same way; only armed
  // while a relayout is actually in flight.
  useEffect(() => {
    if (!relayout) return;
    const timer = window.setTimeout((): void => setRelayout(false), RELAYOUT_FALLBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, [relayout]);

  const noPrev = total === 0 || current <= 0;
  const noNext = total === 0 || current >= maxIndex;

  // Phase 93 (TFL-515) — the indicator leads the turn so it reads where the
  // reader is heading while the spread itself stays on the outgoing page until
  // the turn settles.
  const displayIndex = turn === null ? current : turn.target;

  // TFL-1116 R25 — report the reading location back through `onClose`. The
  // visible spread's first page is `displayIndex + 1` (the same value the
  // progress label shows), so the host persists exactly what the reader sees.
  const handleClose = useCallback((): void => {
    onClose(total === 0 ? undefined : displayIndex + 1);
  }, [onClose, total, displayIndex]);

  // DEF-627 (R25) — publish the reading location on ANY exit route. The header
  // Close button calls `onClose` (persist + close); every OTHER exit — most
  // importantly switching to another tab while Book View is "open" — does not
  // run `onClose`, so the host never learned the reached page. The page is
  // reported whenever the committed spread changes AND once more on unmount, so
  // the persisted viewer always tracks what the reader saw. Both reads go
  // through refs: the latest page is never stale and the mount-scoped effect
  // never re-runs mid-session. Absent prop keeps the pre-change behaviour.
  const latestPageRef = useRef<number | undefined>(undefined);
  latestPageRef.current = total === 0 ? undefined : displayIndex + 1;
  const onLocationChangeRef = useRef(onLocationChange);
  onLocationChangeRef.current = onLocationChange;
  useEffect((): void => {
    onLocationChangeRef.current?.(latestPageRef.current);
  }, [displayIndex, total]);
  useEffect((): (() => void) => {
    return (): void => {
      onLocationChangeRef.current?.(latestPageRef.current);
    };
  }, []);

  // Measure the stage so fit scaling can size the page. The observer is
  // optional (jsdom has none) and only affects presentation. The same
  // unchanged-measurement bail-out as `ComicBody` (DEF-395) prevents churn.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setStageSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, []);

  // DEF-395 — ONE stable stage object per size, so `BookPage`'s scalar props
  // do not churn on every BookView render. The page index is the only other
  // input.
  const stage = useMemo(
    () => ({ width: stageSize.width, height: stageSize.height }),
    [stageSize.width, stageSize.height],
  );

  // Each half of a double spread gets the stage width minus the crease; the
  // single page gets the whole stage. Height is always the full stage.
  const pageWidth =
    layout === 'double' ? Math.max((stage.width - SPREAD_CREASE_PX) / 2, 0) : stage.width;

  // The turning figure's own `animationend` commits the turn. Descendant
  // events (from PageView internals) are filtered out by the target check.
  const onTurnEnd = (event: { target: EventTarget | null; currentTarget: EventTarget | null }): void => {
    if (event.target === event.currentTarget) finishTurn();
  };

  // Phase 77 (chunk B) — self-target guards identical to `onTurnEnd`: only the
  // element that owns the animation clears its marker, never a bubbling
  // descendant (the turn leaf, PageView internals).
  const onEnterEnd = (event: { target: EventTarget | null; currentTarget: EventTarget | null }): void => {
    if (event.target === event.currentTarget) setEntering(false);
  };
  const onRelayoutEnd = (event: { target: EventTarget | null; currentTarget: EventTarget | null }): void => {
    if (event.target === event.currentTarget) setRelayout(false);
  };

  // Phase 93 (TFL-515) — one page face. The front face is ALWAYS mounted, so
  // the outgoing `PageView` canvas is never remounted mid-turn (its painted
  // frame is the visible turning face). The back face mounts only while
  // turning and is hidden behind `backface-visibility` until the swing passes
  // the spine, so it is painted before it is revealed. Both faces use the
  // neutral tool while turning so DEF-467's inert-leaf contract holds.
  const pageFace = (index: number, tool: AnnotationToolState): ReactElement => (
    <BookPage
      doc={doc}
      index={index}
      stageWidth={pageWidth}
      stageHeight={stage.height}
      annotations={annotationsByPage.get(index + 1) ?? EMPTY_ANNOTATIONS}
      annotationTool={tool}
      liveAnnTextIds={liveAnnTextIds}
      onCreateAnnotation={onCreateAnnotation}
      onFinishedOneShot={onFinishedOneShot}
      onEditAnnotation={onEditAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
    />
  );

  // One book page figure. While a turn is in flight the figure hinged at the
  // spine IS the leaf: it keeps its already-painted front face and carries a
  // single incoming back face. `data-book-page` stays on the OUTGOING page
  // until `finishTurn` commits; the back face is the only new mount.
  const renderPageFigure = (
    side: 'left' | 'right' | 'single',
    index: number,
    action: 'next' | 'prev',
  ): ReactElement => {
    const activeTurn = turn;
    const turning =
      activeTurn !== null &&
      (side === 'single' ||
        (activeTurn.dir === 'next' && side === 'right') ||
        (activeTurn.dir === 'prev' && side === 'left'));
    const turnDir = turning && activeTurn !== null ? activeTurn.dir : undefined;
    const turnFront = turning && activeTurn !== null ? activeTurn.front : undefined;
    const turnBack = turning && activeTurn !== null ? activeTurn.back : undefined;
    return (
      <figure
        className={
          'book-view-page' +
          (turning ? ` book-view-page-turning book-view-page-turn-${turnDir}` : '')
        }
        data-book-page={index + 1}
        data-book-page-side={side}
        data-book-turn={turning ? 'true' : undefined}
        data-book-turn-dir={turnDir}
        data-book-turn-cycle={
          turning && activeTurn !== null ? (activeTurn.key % 2 === 0 ? 'a' : 'b') : undefined
        }
        onPointerDownCapture={(e): void => {
          annLayerPressRef.current = isAnnotationUi(e.target as Element | null);
        }}
        onClick={(e): void => {
          if (
            annLayerPressRef.current ||
            isAnnotationUi(e.target as Element | null)
          ) {
            annLayerPressRef.current = false;
            return;
          }
          if (action === 'next') {
            if (!noNext) stepForward();
          } else if (!noPrev) {
            stepBack();
          }
        }}
        onAnimationEnd={turning ? onTurnEnd : undefined}
      >
        <div
          className="book-view-face"
          data-book-turn-front={turning ? turnFront : undefined}
        >
          {pageFace(index, turning ? initialAnnotationToolState : annTool)}
        </div>
        {turning && turnBack !== undefined && (
          <div
            className="book-view-face book-view-face-back"
            data-book-turn-back={turnBack}
          >
            {pageFace(turnBack - 1, initialAnnotationToolState)}
          </div>
        )}
      </figure>
    );
  };

  return (
    <div
      className="book-view"
      role="region"
      aria-label="Book view"
      data-book-view
      data-book-title={title}
      data-book-enter={entering ? 'true' : undefined}
      onAnimationEnd={onEnterEnd}
    >
      <header className="book-view-header">
        <span className="book-view-title" data-book-title-label>
          <Icon name="openReadingView" size="sm" />
          {title}
        </span>
        <div className="book-view-progress" data-book-progress>
          {total === 0
            ? 'No pages'
            : layout === 'double'
              ? Math.min(displayIndex + 2, total) === displayIndex + 1
                ? `Page ${displayIndex + 1} of ${total}`
                : `Page ${displayIndex + 1}-${Math.min(displayIndex + 2, total)} of ${total}`
              : `Page ${displayIndex + 1} of ${total}`}
        </div>
        <div
          className="book-view-layout-toggle"
          role="group"
          aria-label="Book layout"
        >
          <IconButton
            label="Book single page"
            intent="secondary"
            kind="exclusive-selection"
            density="compact"
            className="book-view-layout-button"
            onClick={(): void => chooseLayout('single')}
            pressed={layout === 'single'}
            data-book-single
            icon={<Icon icon={Square} size="sm" />}
          />
          <IconButton
            label="Book double page"
            intent="secondary"
            kind="exclusive-selection"
            density="compact"
            className="book-view-layout-button"
            onClick={(): void => chooseLayout('double')}
            pressed={layout === 'double'}
            data-book-double
            icon={<Icon icon={Columns2} size="sm" />}
          />
        </div>
        <IconButton
          label="Close book view"
          intent="secondary"
          kind="action"
          density="compact"
          className="book-view-close"
          onClick={handleClose}
          data-book-close
          icon={<Icon icon={X} size="sm" />}
        />
      </header>

      {/* Phase 66 (chunk 3) — the EXISTING annotation toolbar, re-parented as
          Book View's ONE tool surface (the Action Dock and flyout are absent
          here). It arms the same reducer + engine handlers DocumentView uses. */}
      <div className="book-view-tools" data-book-tools>
        <AnnotationToolbar
          state={annTool}
          onAction={dispatchAnnTool}
          theme={themeName === 'light' ? 'light' : 'dark'}
          palette={
            annotationPalette === undefined || annotationPalette === null
              ? undefined
              : {
                  light: annotationPalette.light ?? [],
                  dark: annotationPalette.dark ?? [],
                }
          }
          onPaletteChange={
            onAnnotationPaletteChange === undefined
              ? undefined
              : (next): void => onAnnotationPaletteChange(next)
          }
          annotationRecentTools={annotationRecentTools}
          onAnnotationRecentToolsChange={onAnnotationRecentToolsChange}
        />
      </div>

      <div
        ref={stageRef}
        className="book-view-stage"
        data-book-stage
        data-book-layout={layout}
        data-book-turning={turn === null ? undefined : 'true'}
        data-book-relayout={relayout ? 'true' : undefined}
        onAnimationEnd={onRelayoutEnd}
      >
        {total === 0 ? (
          <figure className="book-view-page" data-book-page-side="single">
            <div className="book-view-empty" data-book-empty>
              This document has no pages.
            </div>
          </figure>
        ) : layout === 'double' ? (
          <div className="book-view-spread" data-book-spread>
            {renderPageFigure('left', current, 'prev')}
            <span data-book-crease className="book-view-crease" aria-hidden />
            {current + 1 < total && renderPageFigure('right', current + 1, 'next')}
          </div>
        ) : (
          renderPageFigure('single', current, 'next')
        )}
      </div>

      <nav className="book-view-nav" aria-label="Book navigation">
        <Button
          intent="secondary"
          kind="action"
          density="prominent"
          className="book-nav-button"
          onClick={stepBack}
          disabled={noPrev}
          aria-label="Previous page"
          data-book-prev
          icon={<Icon name="prevPage" size="sm" />}
        >
          Previous
        </Button>
        <Button
          intent="secondary"
          kind="action"
          density="prominent"
          className="book-nav-button"
          onClick={stepForward}
          disabled={noNext}
          aria-label="Next page"
          data-book-next
        >
          Next
          <Icon name="nextPage" size="sm" />
        </Button>
      </nav>
    </div>
  );
}
