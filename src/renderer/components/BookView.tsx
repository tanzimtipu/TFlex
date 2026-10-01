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
import { BookOpen, ChevronLeft, ChevronRight, Columns2, Square, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PageView } from './PageView';
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
  /** Leave Book View and restore the prior rail / Inspector / dock state. */
  onClose: () => void;
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
const SPREAD_CREASE_PX = 24;

/** The fallback that clears the transient turn class. It mirrors the layout
 *  motion token (`--motion-duration-layout`, 350ms) plus a small margin: in a
 *  real browser `animationend` clears it first; in jsdom, where no animation
 *  runs, this timer prevents a stale class from hanging forever. */
const TURN_FALLBACK_MS = 400;

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
    onClose,
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
  const [pageIndex, setPageIndex] = useState(0);
  const maxIndex = Math.max(total - step, 0);
  const current = total === 0 ? 0 : Math.min(Math.max(pageIndex, 0), maxIndex);

  // The transient page-turn. `dir` picks the keyframe; `key` restarts it on a
  // rapid repeat. Cleared on `animationend` and by a fallback timer (jsdom
  // never fires animation events, so the timer guarantees the class clears).
  const [turn, setTurn] = useState<{ dir: 'next' | 'prev'; key: number } | null>(null);
  const turnKeyRef = useRef(0);
  // DEF-446 — a placement gesture commits one-shot and flips the tool back to
  // `select` before the browser synthesizes its `click`. That re-render makes
  // the annotation layer `pointer-events: none`, so the click retargets to the
  // page and would turn it. We remember the pointerdown's layer membership in
  // the capture phase (before the click) and consume it in the click handler.
  const annLayerPressRef = useRef(false);
  const beginTurn = useCallback((dir: 'next' | 'prev'): void => {
    turnKeyRef.current += 1;
    setTurn({ dir, key: turnKeyRef.current });
  }, []);
  const endTurn = useCallback((): void => {
    setTurn(null);
  }, []);

  const stepForward = useCallback((): void => {
    setPageIndex((i) => Math.min(Math.max(total - step, 0), i + step));
    beginTurn('next');
  }, [total, step, beginTurn]);
  const stepBack = useCallback((): void => {
    setPageIndex((i) => Math.max(0, i - step));
    beginTurn('prev');
  }, [step, beginTurn]);
  const chooseLayout = useCallback((next: ReadingDefaults['comics']['layout']): void => {
    setLayout(next);
    setTurn(null);
  }, []);

  useEffect(() => {
    if (turn === null) return;
    const timer = window.setTimeout(endTurn, TURN_FALLBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, [turn, endTurn]);

  const noPrev = total === 0 || current <= 0;
  const noNext = total === 0 || current >= maxIndex;

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

  // The turning figure carries the one-shot flip class: in a double spread the
  // right page turns on next and the left page on back (a real book leaf);
  // single mode turns its one page. Descendant `animationend` events (from
  // PageView internals) are filtered out by the target check below.
  const figureClass = (side: 'single' | 'left' | 'right'): string => {
    if (turn === null) return 'book-view-page';
    const turningSide: 'single' | 'left' | 'right' =
      layout === 'double' ? (turn.dir === 'next' ? 'right' : 'left') : 'single';
    if (side !== turningSide) return 'book-view-page';
    return `book-view-page ${
      turn.dir === 'next' ? 'book-view-turn-next' : 'book-view-turn-prev'
    }`;
  };
  const onTurnEnd = (event: { target: EventTarget | null; currentTarget: EventTarget | null }): void => {
    if (event.target === event.currentTarget) endTurn();
  };

  return (
    <div
      className="book-view"
      role="region"
      aria-label="Book view"
      data-book-view
      data-book-title={title}
    >
      <header className="book-view-header">
        <span className="book-view-title" data-book-title-label>
          <BookOpen size={16} aria-hidden />
          {title}
        </span>
        <div className="book-view-progress" data-book-progress>
          {total === 0 ? 'No pages' : `Page ${current + 1} of ${total}`}
        </div>
        <div
          className="book-view-layout-toggle"
          role="group"
          aria-label="Book layout"
        >
          <button
            type="button"
            className="book-view-layout-button"
            onClick={(): void => chooseLayout('single')}
            aria-label="Book single page"
            aria-pressed={layout === 'single'}
            data-book-single
          >
            <Square size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="book-view-layout-button"
            onClick={(): void => chooseLayout('double')}
            aria-label="Book double page"
            aria-pressed={layout === 'double'}
            data-book-double
          >
            <Columns2 size={16} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="book-view-close"
          onClick={onClose}
          aria-label="Close book view"
          data-book-close
        >
          <X size={16} aria-hidden />
        </button>
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
      >
        {total === 0 ? (
          <figure className="book-view-page" data-book-page-side="single">
            <div className="book-view-empty" data-book-empty>
              This document has no pages.
            </div>
          </figure>
        ) : layout === 'double' ? (
          <div className="book-view-spread" data-book-spread>
            <figure
              className={figureClass('left')}
              data-book-page={current + 1}
              data-book-page-side="left"
              onPointerDownCapture={(e): void => {
                annLayerPressRef.current =
                  isAnnotationUi(e.target as Element | null);
              }}
              onClick={(e): void => {
                if (
                  annLayerPressRef.current ||
                  isAnnotationUi(e.target as Element | null)
                ) {
                  annLayerPressRef.current = false;
                  return;
                }
                if (!noPrev) stepBack();
              }}
              onAnimationEnd={onTurnEnd}
            >
              <BookPage
                doc={doc}
                index={current}
                stageWidth={pageWidth}
                stageHeight={stage.height}
                annotations={annotationsByPage.get(current + 1) ?? EMPTY_ANNOTATIONS}
                annotationTool={annTool}
                liveAnnTextIds={liveAnnTextIds}
                onCreateAnnotation={onCreateAnnotation}
                onFinishedOneShot={onFinishedOneShot}
                onEditAnnotation={onEditAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
              />
            </figure>
            <span data-book-crease className="book-view-crease" aria-hidden />
            {current + 1 < total && (
              <figure
                className={figureClass('right')}
                data-book-page={current + 2}
                data-book-page-side="right"
                onPointerDownCapture={(e): void => {
                  annLayerPressRef.current =
                    isAnnotationUi(e.target as Element | null);
                }}
                onClick={(e): void => {
                  if (
                    annLayerPressRef.current ||
                    isAnnotationUi(e.target as Element | null)
                  ) {
                    annLayerPressRef.current = false;
                    return;
                  }
                  if (!noNext) stepForward();
                }}
                onAnimationEnd={onTurnEnd}
              >
                <BookPage
                  doc={doc}
                  index={current + 1}
                  stageWidth={pageWidth}
                  stageHeight={stage.height}
                  annotations={annotationsByPage.get(current + 2) ?? EMPTY_ANNOTATIONS}
                  annotationTool={annTool}
                  liveAnnTextIds={liveAnnTextIds}
                  onCreateAnnotation={onCreateAnnotation}
                  onFinishedOneShot={onFinishedOneShot}
                  onEditAnnotation={onEditAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                />
              </figure>
            )}
          </div>
        ) : (
          <figure
            className={figureClass('single')}
            data-book-page={current + 1}
            data-book-page-side="single"
            onPointerDownCapture={(e): void => {
              annLayerPressRef.current =
                isAnnotationUi(e.target as Element | null);
            }}
            onClick={(e): void => {
              if (
                annLayerPressRef.current ||
                isAnnotationUi(e.target as Element | null)
              ) {
                annLayerPressRef.current = false;
                return;
              }
              if (!noNext) stepForward();
            }}
            onAnimationEnd={onTurnEnd}
          >
            <BookPage
              doc={doc}
              index={current}
              stageWidth={stage.width}
              stageHeight={stage.height}
              annotations={annotationsByPage.get(current + 1) ?? EMPTY_ANNOTATIONS}
              annotationTool={annTool}
              liveAnnTextIds={liveAnnTextIds}
              onCreateAnnotation={onCreateAnnotation}
              onFinishedOneShot={onFinishedOneShot}
              onEditAnnotation={onEditAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
            />
          </figure>
        )}
      </div>

      <nav className="book-view-nav" aria-label="Book navigation">
        <button
          type="button"
          className="book-nav-button"
          onClick={stepBack}
          disabled={noPrev}
          aria-label="Previous page"
          data-book-prev
        >
          <ChevronLeft size={16} aria-hidden />
          Previous
        </button>
        <button
          type="button"
          className="book-nav-button"
          onClick={stepForward}
          disabled={noNext}
          aria-label="Next page"
          data-book-next
        >
          Next
          <ChevronRight size={16} aria-hidden />
        </button>
      </nav>
    </div>
  );
}
