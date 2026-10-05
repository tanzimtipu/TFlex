// Phase 56 (features A / C / D) — the ONE shared Reading-view shell.
//
// Feature D is a structural rule: EPUB (reflowable text) and comics (fixed
// page raster) share ONE surface — this component — for navigation, progress
// and theme; only the body differs. The shell owns:
//
//   - the full-height panel (AnimatedPanel, overlay, motion tokens only),
//   - the header (title, close, mode controls),
//   - the shared prev/next + progress affordances and keyboard paging,
//   - the reading surface (theme applies HERE ONLY — never to PDF content).
//
// EPUB mode calls the OPTIONAL `window.tflex.convert.readingDocument(path)`
// (typed `Result<EpubReadingDocument, ConvertErrorCode>`), renders the
// ALREADY-SANITIZED chapter fragments in spine order, and degrades readably
// when the member is absent or the call fails — the `drm-protected` refusal
// surfaces through `toastForConvertError`. The fragments are re-sanitized in
// the renderer as defence in depth (a compromised producer cannot inject a
// script into the DOM through us).
//
// Comic mode reuses the existing PDF page rendering supplied by the host as
// `renderComicPage` (the converted comic is an ordinary open PDF — we never
// rasterize the archive ourselves). This file owns paging, layout, fit, RTL
// order and keyboard/click turns for both modes.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { AnimatedPanel } from './AnimatedPanel';
import { BrandLoader } from './BrandLoader';
import { PageView } from './PageView';
import { initialAnnotationToolState } from '../annotations/model';
import { toastForConvertError } from '../state/convert';
import type { EpubReadingDocument } from '../../shared/convert';
import type { ReadingDefaults } from '../../shared/types';

/** The reading surface's three themes. Applies to the reading surface only. */
export type ReadingTheme = ReadingDefaults['epub']['theme'];

export interface ReadingViewProps {
  /** The panel is mounted only while a reading session is active. */
  open: boolean;
  mode: 'epub' | 'comic';
  /** The document's display title. */
  title: string;
  /** The source file path for the EPUB `readingDocument` call. */
  sourcePath: string;
  /** The stored `readingDefaults` the session STARTS from (changeable in session). */
  defaults: ReadingDefaults;
  /** A user-readable notice (bridge absent, typed error). Wired to a toast. */
  onNotice: (kind: 'info' | 'error', text: string) => void;
  onClose: () => void;
  /** Comic mode: total pages of the open document. */
  comicPageCount?: number;
  /** Comic mode: the open comic's PDF.js document (the converted comic is an
   *  ordinary open PDF — we reuse the existing page rendering, never a
   *  re-rasterized archive). */
  comicDoc?: PDFDocumentProxy | null;
  /** Comic mode: a host-supplied page renderer. When absent the shared
   *  `PageView` is used with `comicDoc`. */
  renderComicPage?: (pageIndex: number, viewport: ComicViewport) => ReactNode;
}

/** The measured comic stage, handed to the page renderer for fit scaling. */
export interface ComicViewport {
  width: number;
  height: number;
  fit: ReadingDefaults['comics']['fit'];
}

/** A short, readable name for a path (the toast names the file). */
function displayNameFor(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Tags that can execute or load active content; dropped entirely. */
const BLOCKED_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'audio',
  'video',
  'source',
  'track',
  'svg',
  'math',
  'template',
  'noscript',
]);

const JAVASCRIPT_URI = /^\s*(?:javascript|vbscript|data:text\/html)/i;

/**
 * Defence in depth: the main-process scrubber already whitelisted the chapter
 * fragment, but this view must never trust its producer. Parse the fragment,
 * drop every executable/loading element, strip every `on*` handler and any
 * `javascript:` / `vbscript:` URL, then hand the result to the DOM. Inlined
 * `data:` images survive.
 */
export function sanitizeReadingFragment(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (BLOCKED_TAGS.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && JAVASCRIPT_URI.test(attr.value)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(parsed.body);
  return parsed.body.innerHTML;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function ReadingView(props: ReadingViewProps): ReactElement {
  const {
    open,
    mode,
    title,
    sourcePath,
    defaults,
    onNotice,
    onClose,
    comicPageCount = 0,
    comicDoc = null,
    renderComicPage,
  } = props;

  // ---- EPUB payload -----------------------------------------------------
  const [doc, setDoc] = useState<EpubReadingDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);

  // ---- Session controls (seeded from the stored defaults) --------------
  const [fontSizePt, setFontSizePt] = useState(defaults.epub.fontSizePt);
  const [lineHeight, setLineHeight] = useState(defaults.epub.lineHeight);
  const [theme, setTheme] = useState<ReadingTheme>(defaults.epub.theme);
  const [pageWidth, setPageWidth] = useState(64);
  const [layout, setLayout] = useState<ReadingDefaults['comics']['layout']>(defaults.comics.layout);
  const [fit, setFit] = useState<ReadingDefaults['comics']['fit']>(defaults.comics.fit);
  const [rightToLeft, setRightToLeft] = useState(defaults.comics.rightToLeft);
  const [pageIndex, setPageIndex] = useState(0);

  // Re-seed the session whenever a new reading session opens.
  useEffect(() => {
    if (!open) return;
    setChapterIndex(0);
    setPageIndex(0);
    setFontSizePt(defaults.epub.fontSizePt);
    setLineHeight(defaults.epub.lineHeight);
    setTheme(defaults.epub.theme);
    setLayout(defaults.comics.layout);
    setFit(defaults.comics.fit);
    setRightToLeft(defaults.comics.rightToLeft);
  }, [open, mode, defaults]);

  // Load the EPUB reading payload. Async, cancellable, never blocks the shell.
  useEffect(() => {
    if (!open || mode !== 'epub') return;
    const convert = window.tflex?.convert;
    if (convert === undefined || typeof convert.readingDocument !== 'function') {
      const message = 'This build cannot open the reading view.';
      setLoadError(message);
      onNotice('error', message);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDoc(null);
    setLoadError(null);
    void (async (): Promise<void> => {
      try {
        // Member call: a detached local loses `this` (DEF-106 / DEF-374).
        const result = await convert.readingDocument!(sourcePath);
        if (cancelled) return;
        if (!result.ok) {
          const message = toastForConvertError(result.error.code, displayNameFor(sourcePath));
          setLoadError(message);
          onNotice('error', message);
        } else {
          setDoc(result.value);
        }
      } catch {
        if (cancelled) return;
        const message = `The e-book could not be opened ("${displayNameFor(sourcePath)}").`;
        setLoadError(message);
        onNotice('error', message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [open, mode, sourcePath, onNotice]);

  const chapterCount = doc?.chapters.length ?? 0;
  const comicStep = layout === 'double' ? 2 : 1;
  const total = mode === 'epub' ? chapterCount : Math.max(0, comicPageCount);
  const current = mode === 'epub' ? chapterIndex : pageIndex;

  const stepForward = useCallback((): void => {
    if (mode === 'epub') {
      setChapterIndex((i) => Math.min(Math.max(chapterCount - 1, 0), i + 1));
      return;
    }
    setPageIndex((i) => Math.min(Math.max(comicPageCount - comicStep, 0), i + comicStep));
  }, [mode, chapterCount, comicPageCount, comicStep]);

  const stepBack = useCallback((): void => {
    if (mode === 'epub') {
      setChapterIndex((i) => Math.max(0, i - 1));
      return;
    }
    setPageIndex((i) => Math.max(0, i - comicStep));
  }, [mode, comicStep]);

  // Keyboard paging for both modes. Page steps are direction-neutral (the RTL
  // toggle reorders the spread; it does not rewrite the arrow keys), and the
  // handler yields to any focused form control so a range/select keeps its
  // native keys.
  const stepForwardRef = useRef(stepForward);
  const stepBackRef = useRef(stepBack);
  stepForwardRef.current = stepForward;
  stepBackRef.current = stepBack;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowRight' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        stepForwardRef.current();
      } else if (event.key === 'ArrowLeft' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        stepBackRef.current();
      } else if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const comicPages = useMemo((): number[] => {
    if (mode !== 'comic') return [];
    const out: number[] = [];
    for (let i = pageIndex; i < Math.min(pageIndex + comicStep, comicPageCount); i += 1) {
      out.push(i);
    }
    return rightToLeft ? out.reverse() : out;
  }, [mode, pageIndex, comicStep, comicPageCount, rightToLeft]);

  const comicRenderPage = useMemo(
    (): ((pageIndex: number, viewport: ComicViewport) => ReactNode) | undefined => {
      if (renderComicPage !== undefined) return renderComicPage;
      if (comicDoc !== null) {
        return (pageIndex: number, viewport: ComicViewport): ReactNode => (
          <ComicPage doc={comicDoc} index={pageIndex} viewport={viewport} />
        );
      }
      return undefined;
    },
    [renderComicPage, comicDoc],
  );

  const shown = Math.min(current + 1, Math.max(total, 1));
  const progressLabel =
    mode === 'epub' ? `Chapter ${shown} of ${total}` : `Page ${shown} of ${total}`;

  const noPrev = current <= 0;
  const noNext = current >= Math.max(total - 1, 0);

  return (
    <AnimatedPanel open={open} side="right" mode="overlay" className="reading-view" testId="reading-view">
      <div
        className={`reading-surface reading-surface--${theme}`}
        role="region"
        aria-label="Reading view"
        data-reading-view
        data-reading-mode={mode}
        data-reading-theme={theme}
      >
        <header className="reading-view-header">
          <span className="reading-view-title" data-reading-title>
            <Icon name="openReadingView" size="sm" />
            {title}
          </span>
          <div
            className="reading-progress"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={1}
            aria-valuemax={Math.max(total, 1)}
            aria-valuenow={shown}
            data-reading-progress
          >
            {progressLabel}
          </div>
          <button
            type="button"
            className="reading-view-close"
            onClick={onClose}
            aria-label="Close reading view"
            data-reading-close
          >
            <Icon icon={X} size="sm" />
          </button>
        </header>

        {mode === 'epub' ? (
          <EpubBody
            loading={loading}
            loadError={loadError}
            doc={doc}
            chapterIndex={chapterIndex}
            fontSizePt={fontSizePt}
            onFontSize={setFontSizePt}
            lineHeight={lineHeight}
            onLineHeight={setLineHeight}
            theme={theme}
            onTheme={setTheme}
            pageWidth={pageWidth}
            onPageWidth={(v: number): void => setPageWidth(clampInt(v, 28, 90))}
          />
        ) : (
          <ComicBody
            total={comicPageCount}
            pages={comicPages}
            layout={layout}
            onLayout={setLayout}
            fit={fit}
            onFit={setFit}
            rightToLeft={rightToLeft}
            onRightToLeft={() => setRightToLeft((v) => !v)}
            renderPage={comicRenderPage}
          />
        )}

        <nav className="reading-view-nav" aria-label="Reading navigation">
          <button
            type="button"
            className="reading-nav-button"
            onClick={stepBack}
            disabled={noPrev}
            aria-label="Previous page"
            data-reading-prev
          >
            <Icon name="prevPage" size="sm" />
            Previous
          </button>
          <button
            type="button"
            className="reading-nav-button"
            onClick={stepForward}
            disabled={noNext}
            aria-label="Next page"
            data-reading-next
          >
            Next
            <Icon name="nextPage" size="sm" />
          </button>
        </nav>
      </div>
    </AnimatedPanel>
  );
}

interface EpubBodyProps {
  loading: boolean;
  loadError: string | null;
  doc: EpubReadingDocument | null;
  chapterIndex: number;
  fontSizePt: number;
  onFontSize: (value: number) => void;
  lineHeight: number;
  onLineHeight: (value: number) => void;
  theme: ReadingTheme;
  onTheme: (value: ReadingTheme) => void;
  pageWidth: number;
  onPageWidth: (value: number) => void;
}

function EpubBody(props: EpubBodyProps): ReactElement {
  const {
    loading,
    loadError,
    doc,
    chapterIndex,
    fontSizePt,
    onFontSize,
    lineHeight,
    onLineHeight,
    theme,
    onTheme,
    pageWidth,
    onPageWidth,
  } = props;
  const sectionRefs = useRef<Map<number, HTMLElement>>(new Map());
  const chapters = doc?.chapters ?? [];

  // Keep the current chapter in view when prev/next moves the index.
  useEffect(() => {
    const el = sectionRefs.current.get(chapterIndex);
    el?.scrollIntoView?.({ block: 'start' });
  }, [chapterIndex, chapters.length]);

  if (loading) {
    return (
      <div className="reading-body reading-body--empty" data-reading-loading>
        <BrandLoader />
        Loading chapters…
      </div>
    );
  }
  if (loadError !== null) {
    return (
      <div className="reading-body reading-body--empty" role="alert" data-reading-error>
        {loadError}
      </div>
    );
  }
  if (doc === null) {
    return <div className="reading-body reading-body--empty" data-reading-empty />;
  }

  return (
    <div className="reading-body">
      <div className="reading-controls" role="group" aria-label="Reading settings">
        <label className="reading-control">
          Font size
          <input
            type="range"
            min={10}
            max={32}
            step={1}
            value={fontSizePt}
            onChange={(e): void => onFontSize(Number(e.target.value))}
            aria-label="Reading font size"
            data-reading-font-size
          />
          <span className="reading-control-value">{fontSizePt} pt</span>
        </label>
        <label className="reading-control">
          Line height
          <input
            type="range"
            min={1}
            max={2.5}
            step={0.05}
            value={lineHeight}
            onChange={(e): void => onLineHeight(Number(e.target.value))}
            aria-label="Reading line height"
            data-reading-line-height
          />
          <span className="reading-control-value">{lineHeight.toFixed(2)}</span>
        </label>
        <label className="reading-control">
          Width
          <input
            type="range"
            min={28}
            max={90}
            step={1}
            value={pageWidth}
            onChange={(e): void => onPageWidth(Number(e.target.value))}
            aria-label="Reading width"
            data-reading-width
          />
          <span className="reading-control-value">{pageWidth} ch</span>
        </label>
        <label className="reading-control">
          Theme
          <select
            value={theme}
            onChange={(e): void => onTheme(e.target.value as ReadingTheme)}
            aria-label="Reading theme"
            data-reading-theme-select
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="sepia">Sepia</option>
          </select>
        </label>
      </div>

      <div className="reading-chapters">
        {chapters.map((chapter, index) => (
          <section
            key={chapter.id}
            ref={(el): void => {
              if (el === null) sectionRefs.current.delete(index);
              else sectionRefs.current.set(index, el);
            }}
            className="reading-chapter"
            data-reading-chapter={chapter.href}
            data-current-chapter={index === chapterIndex ? 'true' : undefined}
          >
            <h2 className="reading-chapter-title">{chapter.title}</h2>
            <div
              className="reading-chapter-content"
              data-reading-content
              style={{
                fontSize: `${fontSizePt}pt`,
                lineHeight,
                maxWidth: `${pageWidth}ch`,
              }}
              // The fragment is whitelist-sanitized by main AND re-sanitized
              // here (defence in depth); it is never script-bearing.
              dangerouslySetInnerHTML={{ __html: sanitizeReadingFragment(chapter.xhtml) }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

interface ComicBodyProps {
  total: number;
  pages: number[];
  layout: ReadingDefaults['comics']['layout'];
  onLayout: (value: ReadingDefaults['comics']['layout']) => void;
  fit: ReadingDefaults['comics']['fit'];
  onFit: (value: ReadingDefaults['comics']['fit']) => void;
  rightToLeft: boolean;
  onRightToLeft: () => void;
  renderPage: ((pageIndex: number, viewport: ComicViewport) => ReactNode) | undefined;
}

function ComicBody(props: ComicBodyProps): ReactElement {
  const {
    total,
    pages,
    layout,
    onLayout,
    fit,
    onFit,
    rightToLeft,
    onRightToLeft,
    renderPage,
  } = props;

  // Measure the stage so fit-width / fit-height can scale each PDF page. The
  // observer is optional (jsdom has none) and only affects presentation.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      // DEF-395 — bail out when the measurement is unchanged. The observer
      // can fire repeatedly with the same rect; storing a fresh object each
      // time re-rendered the body (and every ComicPage) for no reason.
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
  }, [layout]);

  // DEF-395 — ONE stable viewport object per (size, fit). The old inline
  // literal was recreated for every page on every render, churning the
  // `ComicPage` prop identity for no benefit.
  const viewport = useMemo(
    (): ComicViewport => ({ width: stageSize.width, height: stageSize.height, fit }),
    [stageSize.width, stageSize.height, fit],
  );

  return (
    <div className="reading-body reading-body--comic">
      <div className="reading-controls" role="group" aria-label="Comic settings">
        <button
          type="button"
          className="reading-toggle"
          aria-label="Comic single page"
          aria-pressed={layout === 'single'}
          onClick={(): void => onLayout('single')}
          data-comic-single
        >
          Single
        </button>
        <button
          type="button"
          className="reading-toggle"
          aria-label="Comic double page"
          aria-pressed={layout === 'double'}
          onClick={(): void => onLayout('double')}
          data-comic-double
        >
          Double
        </button>
        <button
          type="button"
          className="reading-toggle"
          aria-label="Comic fit width"
          aria-pressed={fit === 'width'}
          onClick={(): void => onFit('width')}
          data-comic-fit-width
        >
          Fit width
        </button>
        <button
          type="button"
          className="reading-toggle"
          aria-label="Comic fit height"
          aria-pressed={fit === 'height'}
          onClick={(): void => onFit('height')}
          data-comic-fit-height
        >
          Fit height
        </button>
        <button
          type="button"
          className="reading-toggle"
          aria-label="Comic right to left"
          aria-pressed={rightToLeft}
          onClick={onRightToLeft}
          data-comic-rtl
        >
          Right to left
        </button>
      </div>

      <div
        ref={stageRef}
        className={`reading-comic-stage reading-comic-stage--fit-${fit}`}
        data-comic-stage
        data-comic-layout={layout}
      >
        {total === 0 && (
          <div className="reading-body--empty" data-comic-empty>
            This document has no pages.
          </div>
        )}
        {pages.map((pageNumber) => (
          <figure
            key={pageNumber}
            className="reading-comic-page"
            data-comic-page={pageNumber}
          >
            {renderPage === undefined ? (
              <div className="reading-body--empty">Page {pageNumber + 1}</div>
            ) : (
              renderPage(pageNumber, viewport)
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}

const EMPTY_HITS: never[] = [];
const EMPTY_ANNOTATIONS: never[] = [];

// DEF-395 — stable no-op callbacks. `ComicPage` used to hand `PageView`
// fresh inline closures every render; identity churn re-ran PageView's
// render effect (its deps include `onPageSize` — PageView.tsx:825) and
// closed an endless render -> effect -> setState loop (React #185).
// Module-scope constants make every "do nothing" callback identity-stable.
const noopActiveHitTop = (): void => undefined;
const noopAnnotation = (): void => undefined;

/** One comic page, rendered with the EXISTING `PageView` (the converted comic
 *  is an ordinary open PDF). Scales to the measured stage for fit width/height;
 *  the reading surface never animates the page content itself. */
function ComicPage(props: {
  doc: PDFDocumentProxy;
  index: number;
  viewport: ComicViewport;
}): ReactElement {
  const { doc, index, viewport } = props;
  const [dims, setDims] = useState({ width: 612, height: 792 });
  // DEF-395 — the root cause. This callback is passed to `PageView`, whose
  // render effect depends on it (PageView.tsx:825). The old inline arrow was
  // re-created on EVERY ComicPage render; each effect run called it back and
  // `setDims({...})` always stored a NEW object, even when the width/height
  // were identical — so the render -> effect -> setState cycle never
  // settled (React #185, "Maximum update depth exceeded"). Two guards fix
  // it: the callback is now identity-stable (`useCallback` with no deps —
  // it only touches the stable setter), and the update bails out when the
  // reported size is unchanged, so a re-run of the effect cannot churn state.
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
  const fitScale =
    viewport.fit === 'width'
      ? viewport.width / Math.max(dims.width, 1)
      : viewport.height / Math.max(dims.height, 1);
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
      annotations={EMPTY_ANNOTATIONS}
      annotationTool={initialAnnotationToolState}
      flashId={null}
      onCreateAnnotation={noopAnnotation}
      rotation={0}
    />
  );
}
