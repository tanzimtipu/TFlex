import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInstantMotion } from '../hooks/useAnimations';
import { measureHitRects, type HitRect } from '../pdf/highlight';
import { isInvalidPageRequest } from '../pdf/pdfjs';
import { deferWork } from '../state/renderSuspend';
import type { SearchHit } from '../search/searchIndex';
import { AnnotationOverlay, type TextItemGeom } from '../annotations/AnnotationOverlay';
import { StampAnnotations, type PlacedStamp } from '../annotations/StampAnnotations';
import { FormsOverlay } from '../forms/FormsOverlay';
import { SignaturesOverlay } from '../signatures/SignaturesOverlay';
import { EditOverlay } from '../edit/EditOverlay';
import { StampOverlay } from '../annotations/StampOverlay';
import type {
  CommentThread,
  FormField,
  SavedSignature,
  SignaturePlacement,
} from '../../shared/types';
import type {
  Annotation,
  AnnotationPatch,
  AnnotationToolState,
} from '../annotations/model';
import type {
  AnnotationColors,
  AnnotationTheme,
} from '../state/colorPalette';

interface PageViewProps {
  doc: PDFDocumentProxy;
  /** 1-based VISIBLE page index (the engine-ordered position the
   *  user sees). Used for every overlay (annotations / forms /
   *  signatures / stamps / edit), the slot registration, and the
   *  data-page marker. DEF-133 — overlays must create content on
   *  the VISIBLE page; the engine interprets every `page` field
   *  against its current pageOrder, while the pdf.js proxy is
   *  still keyed by SOURCE order. */
  page: number;
  /** 1-based SOURCE page index into the pdf.js proxy. After a
   *  delete / reorder / insert the visible and source indices
   *  diverge (`visibleToSourcePage` in DocumentView computes
   *  this). Only `doc.getPage(sourcePage)` uses this — everything
   *  the user can create on the page uses `page`. */
  sourcePage: number;
  widthPt: number; // fallback dims at scale 1 (placeholder sizing)
heightPt: number;
  cssScale: number;
  shouldRender: boolean;
  hits: SearchHit[];
  activeHit: SearchHit | null;
  registerPage?: (page: number, el: HTMLDivElement | null) => void;
  onPageSize: (page: number, widthPt: number, heightPt: number) => void;
  onActiveHitTop: (page: number, cssTop: number) => void;
  /** Quarter-turn rotation (0..3) the engine has applied to this page
   *  via the user's rotate ops. Threaded into `page.getViewport` so the
   *  bitmap is rendered at the rotated orientation. Without this the
   *  rotate op updated `engineState.rotations` but the rendered canvas
   *  kept the un-rotated bitmap (the side rail's CSS class flipped,
   *  the main view did not). The wrapper's CSS dimensions are derived
   *  from the rotated viewport, so 90/270 swaps width/height — DEF-057. */
  rotation?: number;
  /** Annotations for this page (filtered from the engine state). */
  annotations: Annotation[];
  /** DEF-166 — annotation ids whose overlay text must be drawn LIVE
   *  (created / edited since the current page-canvas bytes were
   *  loaded). Threaded to the AnnotationOverlay so a parsed-from-file
   *  textbox/callout (whose baked FreeText appearance pdf.js already
   *  paints into the page canvas) does not draw a duplicated overlay
   *  text on reopen. Absent -> the overlay draws every annotation's
   *  text exactly as before. */
  liveAnnTextIds?: ReadonlySet<string>;
  /** Active annotation tool + color/width settings. */
  annotationTool: AnnotationToolState;
  /** When the panel asks to flash an annotation, the overlay receives its id. */
  flashId: string | null;
  /** Called when a drag / click / note commits a new annotation. */
  onCreateAnnotation: (annotation: Annotation) => void;
  /** One-shot tools (textbox, note) call this after committing so the host
   *  can return to plain viewer mode. */
  onFinishedOneShot?: () => void;
  /** DEF-096 — edit / delete a committed annotation from the page
   *  (clicking a sticky-note icon opens its editor). Threaded to
   *  the AnnotationOverlay; the host applies the patch / delete
   *  through the engine. */
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** Bug 1 — disarm the annotation CREATION tool when an edit
   *  toolbox opens. Threaded to the AnnotationOverlay; the host
   *  (DocumentView) resets its annotation-tool reducer to "select". */
  onDisarmAnnTool?: () => void;
  /** Phase 21 (annotations) — reports the overlay's selected committed
   *  annotation (or null) upward so the host's text-properties panel can
   *  reflect a selected annotation text object's actual colour. DEF-254 —
   *  the report carries THIS page's visible index so the host can tell a
   *  genuine deselect (this page reporting null for the page that HOLDS the
   *  selection) from a neighbouring page mounting and reporting null. */
  onSelectAnnotation?: (ann: Annotation | null, page: number) => void;
  /** Phase 26 — the overlay placed or clicked a text element; the host
   *  focuses the panel's Text field (the single text-editing surface). */
  onTextFocusRequest?: (id: string) => void;
  /** Phase 28 — the selection bar's colour box reuses the annotation
   *  toolbar's picker: same preset bucket, same saved custom presets. */
  annotationPaletteTheme?: AnnotationTheme;
  annotationPalette?: AnnotationColors;
  onAnnotationPaletteChange?: (next: AnnotationColors) => void;
  /** Phase 28 — the document's comment threads. Threaded straight to the
   *  AnnotationOverlay, which draws the small comment badge on every
   *  annotated element that has a thread and feeds the selected
   *  annotation's entries to the comment box. Empty / absent means no
   *  badges anywhere. */
  comments?: readonly CommentThread[];
  /** Phase 28 — append a comment / reply to an annotation's thread.
   *  Threaded to the AnnotationOverlay's comment box; the host's engine
   *  call echoes the refreshed `comments`, which flips the badge on. */
  onAddComment?: (annotationId: string, text: string) => void;
  /** B10 / DEF-101 — successfully placed stamps for this page
   *  (rect + raster as recorded by the host on `addStamp` success).
   *  Rendered as `.stamp-annotation` DOM surfaces so a placed stamp
   *  is visible/verifiable in addition to the baked page bitmap. */
  stampAnnotations?: PlacedStamp[];
  /** Bug 6 — stamp editing handlers. The placed stamps are
   *  selectable / movable / deletable like every annotation: the
   *  surface interacts locally (draft rect during the drag) and the
   *  bar's Confirm / Delete / Edit route here for the engine work. */
  onMoveStamp?: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onDeleteStamp?: (id: string) => void;
  onRetypeStamp?: (id: string, stampId: import('../../shared/types').StampId) => void;
  /** Called when this PageView starts a render task (getPage → render →
   *  getTextContent → TextLayer). The host uses this as part of the
   *  document-wide "anything in flight?" probe that gates pdf.js's
   *  doc.cleanup() — the cleanup must not fire mid-render or pdf.js
   *  refuses it (DEF-016). */
  onRenderStart?: () => void;
  /** Called when this PageView's render task ends (success, cancellation,
   *  or unmount). Always called exactly once per onRenderStart. */
  onRenderEnd?: () => void;
  // -- Phase 4: forms --
  formFields?: FormField[];
  onFormValueChange?: (id: string, value: string | string[]) => void;
  onFormListboxToggle?: (id: string, option: string) => void;
  // -- Phase 4: signatures --
  signatures?: SignaturePlacement[];
  savedSignatures?: Record<string, SavedSignature>;
  armedSignatureId?: string | null;
  onPlaceSignature?: (signatureId: string, page: number, rect: SignaturePlacement["rect"]) => void;
  onMoveSignature?: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDeleteSignature?: (placementId: string) => void;
  /** B1 — exit Sign mode entirely. Wired to the pending action
   *  bar's Cancel button; the page-level wrapper forwards the
   *  call to the SignaturesOverlay. */
  onCancelSignatureArm?: () => void;
  // -- Phase 12 / B10: stamp --
  /** When non-null, the page shows a ghost preview of the
   *  armed stamp following the cursor; clicking embeds the
   *  stamp at the click point. */
  armedStamp?: {
    stampId: import('../../shared/types').StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
  } | null;
  onPlaceStamp?: (args: {
    stampId: import('../../shared/types').StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
    page: number;
    atPt: { x: number; y: number };
  }) => void;
  // -- Phase 10: Edit-content overlay --
  /** Edit mode is open. The EditOverlay is mounted only when this
   *  is true; with it false the layer is invisible and pointer-
   *  transparent so text selection / signing keep working. */
  editModeOpen?: boolean;
  /** Per-tab Edit state. The overlay reads the active tool +
   *  placement list from here. */
  edit?: {
    state: import('../edit/model').EditState;
    onAction: (action: import('../edit/model').EditAction) => void;
    defaultFont: import('../../shared/types').EditFont;
    onDefaultFontChange?: (font: import('../../shared/types').EditFont) => void;
    pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
    onCommitTextEdit: (args: {
      rect: { x: number; y: number; width: number; height: number };
      newText: string;
      style: import('../edit/model').EditTextStyle;
      oldRect?: { x: number; y: number; width: number; height: number };
      /** DEF-232 — the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitTextBox: (args: {
      id?: string;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import('../edit/model').EditTextStyle;
      background: "white" | "none";
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitImageEdit: (args: {
      op: "move" | "resize" | "replace" | "crop";
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      bytes: Uint8Array;
      format: "png" | "jpeg";
      id: string;
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-127 — commit a committed text box's drag (move/resize):
     *  the host re-bakes the box at `newRect` through the engine's
     *  existing editImage contract. */
    onCommitTextBoxMove: (args: {
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import('../edit/model').EditTextStyle;
      background: "white" | "none";
      id: string;
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-135/136 — delete a committed text box through the engine's
     *  registry. Threaded to the EditOverlay's box placement toolbar. */
    onDeleteTextBox?: (id: string) => void;
    /** Phase 21 — the panel-driven style for the inline editor's live
     *  preview AND its creation / run-edit payload (the floating editor
     *  no longer owns style controls). */
    textStyle: import('../edit/model').EditTextStyle;
    /** Phase 26 — apply a patch to a SPECIFIC committed box (the panel
     *  Text field's session commit). */
    onTextPatch?: (id: string, patch: import('../../shared/types').TextBoxStylePatch) => void;
    /** Phase 26 — the Edit overlay reports its selected text target up
     *  (box or run) so the panel's Text field can edit it. */
    onTextTargetChange?: (target: import('./DocumentView').EditTextTarget | null) => void;
    /** Phase 26 — the panel's live text for the selected run's on-page
     *  preview. */
    textLive?: string | null;
    /** Phase 26 — flips when the panel's edit session commits; the
     *  overlay then commits the run it owns (rect + mask cover). */
    textCommitToken?: number;
  } | null;
}

interface Measured {
  hit: SearchHit;
  rects: HitRect[];
}

/** Convert pdf.js TextItem into top-left-origin page points, the format the
 *  annotation overlay (and markup quad math) consume. We work directly in
 *  unscaled PDF units; the overlay multiplies by cssScale when it places
 *  rects onto the page, so the math stays zoom-consistent for free. */
function textItemsToGeom(
  items: ReadonlyArray<{ str?: string; transform?: number[]; width?: number; height?: number }>,
  pageHeightPt: number,
): TextItemGeom[] {
  const out: TextItemGeom[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (!Array.isArray(item.transform)) continue;
    const t = item.transform;
    if (t.length < 6) continue;
    const e = t[4] ?? 0;
    const f = t[5] ?? 0;
    const w = typeof item.width === 'number' ? item.width : 0;
    const h = typeof item.height === 'number' ? item.height : 0;
    if (w <= 0 || h <= 0) continue;
    out.push({
      x: e,
      // PDF is bottom-left origin; overlay is top-left origin. Flip y.
      y: pageHeightPt - f - h,
      width: w,
      height: h,
      text: item.str,
    });
  }
  return out;
}

/** Release pdf.js's parsed per-page resources (operator lists, decoded
 *  streams, font references) when a PageView unmounts. Without this every
 *  page ever rendered stays in the document's per-page cache for the
 *  lifetime of the tab, and the Tab process grows by ~10 MB per scroll
 *  cycle on long.pdf (DEF-016). `page.cleanup()` throws if a render is
 *  in flight; callers must cancel pending renders first. */
function releasePdfPage(page: unknown): void {
  if (page === null || typeof page !== 'object') return;
  const cleanup = (page as { cleanup?: unknown }).cleanup;
  if (typeof cleanup !== 'function') return;
  try {
    (cleanup as () => boolean).call(page);
  } catch {
    // See the call sites: cleanup throws if a render is in flight. The
    // caller has already cancelled any pending render tasks, so any
    // remaining throw is "page was being torn down by pdf.js itself"
    // and is safe to swallow.
  }
}

/**
 * One page: canvas bitmap, pdf.js TextLayer for selection and hit
 * measurement, and a non-interactive highlight overlay. Render tasks are
 * cancelled whenever scale/visibility changes; when the virtualization says
 * the page is far offscreen, the bitmap is dropped back to a placeholder.
 */
export function PageView(props: PageViewProps) {
  const {
    doc,
    page,
    sourcePage,
    widthPt,
heightPt,
    cssScale,
    shouldRender,
    hits,
    activeHit,
    registerPage,
    onPageSize,
    onActiveHitTop,
    annotations,
    annotationTool,
    flashId,
    liveAnnTextIds,
    onCreateAnnotation,
    onFinishedOneShot,
    onEditAnnotation,
    onDeleteAnnotation,
    onDisarmAnnTool,
    onSelectAnnotation,
    onTextFocusRequest,
    annotationPaletteTheme,
    annotationPalette,
    onAnnotationPaletteChange,
    comments,
    onAddComment,
    stampAnnotations = [],
    onMoveStamp,
    onDeleteStamp,
    onRetypeStamp,
    onRenderStart,
    onRenderEnd,
    formFields,
    onFormValueChange,
    onFormListboxToggle,
    signatures,
    savedSignatures,
    armedSignatureId,
    onPlaceSignature,
    onMoveSignature,
    onDeleteSignature,
    onCancelSignatureArm,
    armedStamp = null,
    onPlaceStamp,
    editModeOpen = false,
    edit = null,
    rotation = 0,
  } = props;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textHostRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<TextLayer | null>(null);
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [measured, setMeasured] = useState<Measured[]>([]);
  // DEF-190 — true while a placed stamp on THIS page shows selection
  // chrome (action bar or stamp-type editor). Mirrored into
  // `data-stamp-editor-open` on the .pdf-page wrapper; the stylesheet
  // lifts the page above its sibling pages so editor chrome anchored
  // under a bottom-edge stamp paints — and hit-tests — above the NEXT
  // page instead of being covered by it.
  const [stampChromeOpen, setStampChromeOpen] = useState(false);
  const onStampChromeChange = useCallback((open: boolean): void => {
    setStampChromeOpen(open);
  }, []);
  const textItemsRef = useRef<TextItemGeom[]>([]);
  // True while the visible canvas holds a frame THIS component actually
  // painted. A freshly created canvas starts at the spec default
  // 300x150 with no pixels, so `canvas.width > 0` is NOT a "has a
  // previous frame" signal — only a completed blit counts. Drives the
  // double-buffer (keep/stretch the previous frame vs. B15 white fill).
  const paintedFrameRef = useRef(false);
  // DEF-274 — the quarter-turn the frame currently ON the visible canvas
  // was painted at. When the `rotation` prop moves away from this, the
  // page turns immediately (a transform on the existing bitmap, below)
  // and the fresh render swaps in when it is ready. Kept in a ref so the
  // turn does not itself trigger a re-render; mirrored into the effect.
  const paintedRotationRef = useRef(rotation);
  // Phase 23 policy (OS reduced motion / the Animations setting): when
  // motion must be instant, skip the turn transform and rely on the
  // atomic offscreen swap alone. Read through a ref so the render effect
  // does not re-run every time the preference is read.
  const instantMotion = useInstantMotion();
  const instantMotionRef = useRef(instantMotion);
  instantMotionRef.current = instantMotion;

  // DEF-302 — the zoom FLIP is driven by DocumentView, and it animates the
  // PAPER-OWNING page unit (the `.page-slot`), not this content wrapper: the
  // slot paints the sheet's paper background and contains this wrapper, so one
  // transform moves the sheet outline and the content together. The slot owns
  // the class/vars cleanup (DocumentView's `onAnimationEnd`), so there is
  // nothing to do here.


  const ready = renderedScale !== null;

  // Render / cancel pipeline. Stale tasks are cancelled on every dep change
  // and on unmount; dropping visibility disposes the bitmap entirely.
  useEffect(() => {
    // Hold the resolved pdf.js page so we can ask it to release its parsed
    // resources when this PageView unmounts or is told to stop rendering.
    // pdf.js keeps per-page state in the worker (operator lists, decoded
    // streams, font caches) keyed by page index; without an explicit
    // `page.cleanup()` call that state stays resident for the lifetime of
    // the document and grows linearly with the number of pages ever
    // rendered. On long.pdf (520 pages), this is the single biggest
    // contributor to the Tab process's working-set growth between scroll
    // cycles (DEF-016).
    let pdfPage: { cleanup?: () => boolean; destroy?: () => void } | null = null;
    if (!shouldRender) {
      setRenderedScale(null);
      // Drop the page bitmap the moment the slot is told to stop rendering.
      // React keeps this canvas mounted until the slot unmounts, so without
      // an explicit clear the backing store (canvas.width × canvas.height ×
      // 4 bytes — typically ~5MB per page at fit-width on a hi-DPI display)
      // sits in GPU/CPU memory for every offscreen page in the buffer.
      // Setting width/height to 0 is the standard way to release the
      // ImageBitmap that backs the canvas. A subsequent shouldRender=true
      // re-renders the bitmap at the current scale.
      const canvas = canvasRef.current;
      if (canvas !== null) {
        canvas.width = 0;
        canvas.height = 0;
      }
      paintedFrameRef.current = false;
      // Drop the text-layer DOM, the text-items snapshot, and the pdf.js
      // TextLayer instance so none of them hang around for unmounted
      // slots. The next render rebuilds all three from scratch. The
      // `measured` search-hit state is cleared automatically by the
      // useLayoutEffect below (ready flips to false).
      const textHost = textHostRef.current;
      if (textHost !== null) {
        textHost.replaceChildren();
      }
      textItemsRef.current = [];
      // TextLayer keeps a reference to its viewport and the TextContent
      // source; releasing the instance lets pdf.js free its internal
      // structures once the DOM is gone.
      textLayerRef.current = null;
      // Release the page's parsed resources in pdf.js. cleanup() drops
      // the page's operator list / font refs from the worker cache so the
      // next time we scroll past this page, pdf.js re-parses from the
      // document stream. Cheap enough (microseconds) that we can do it
      // eagerly on every unmount / shouldRender=false transition.
      releasePdfPage(pdfPage);
      pdfPage = null;
      return;
    }
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;
    let textLayerTask: { cancel: () => void } | null = null;
    // Document-wide render counter — bumped for the lifetime of this
    // PageView's render pipeline (getPage → render → getTextContent →
    // TextLayer). The DocumentView's idle cleanup coordinator reads
    // the counter to refuse `doc.cleanup()` while any page is mid-
    // render (pdf.js would refuse the cleanup anyway). onRenderEnd is
    // wired into every exit path: success, cancellation, unmount, and
    // the shouldRender=false early-return.
    let renderActive = false;
    const beginRender = (): void => {
      if (renderActive) return;
      renderActive = true;
      onRenderStart?.();
    };
    const endRender = (): void => {
      if (!renderActive) return;
      renderActive = false;
      onRenderEnd?.();
    };
    const run = async (): Promise<void> => {
      beginRender();
      let pageProxy: PDFPageProxy;
      try {
        pageProxy = await doc.getPage(sourcePage);
      } catch (error) {
        // DEF-121 — stale page index during a post-op proxy refresh.
        // The engine commits its new pageOrder (page count) before the
        // renderer's pdf.js `doc` proxy is rebuilt, so a mount for a
        // source page the still-old proxy does not have rejects with
        // pdf.js's "Invalid page request." (inserting a blank
        // mid-document: 34-page doc, new pageOrder references source
        // page 35 while doc.numPages is still 34). The refresh swaps
        // the doc identity immediately after and re-runs this effect
        // with the full page count, so the correct response is to drop
        // the stale attempt rather than surface an unhandled
        // rejection. Any other getPage failure keeps failing loudly.
        if (isInvalidPageRequest(error)) {
          endRender();
          return;
        }
        throw error;
      }
      pdfPage = pageProxy;
      if (disposed) {
        endRender();
        return;
      }
      const pdfPageHeight = pageProxy.view[3] - pageProxy.view[1];
      onPageSize(page, pageProxy.view[2] - pageProxy.view[0], pdfPageHeight);
      if (disposed) {
        endRender();
        return;
      }
      // DEF-057 — thread the engine-applied quarter-turn rotation into
      // pdf.js's viewport so the bitmap is rendered at the rotated
      // orientation. The rotation is a 0..3 multiple of 90 degrees (the
      // engine's unit). pdf.js's `getViewport({ rotation })` rotates the
      // output content and, for 90/270, swaps the viewport's
      // width/height to match the post-rotation page extent. The
      // canvas + wrapper dims below use the rotated viewport's width /
      // height so the bitmap is laid out at its real visual size.
      const rotDeg = (rotation * 90) as 0 | 90 | 180 | 270;
      const viewport = pageProxy.getViewport({ scale: cssScale, rotation: rotDeg });
      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      const textHost = textHostRef.current;
      if (canvas === null || wrapper === null || textHost === null) {
        endRender();
        return;
      }
      // Render the bitmap at the CSS scale (1 device pixel per CSS pixel).
      // We deliberately do NOT multiply by devicePixelRatio. The previous
      // `cssScale * dpr` rendered at ~2.25x the pixel count on a 1.5-DPR
      // display — each page's bitmap held ~15 MB of GPU memory at fit-width
      // (1140 × 1475 CSS px → 1710 × 2212 backing store), so 6 mounted pages
      // pinned ~90 MB of GPU/CPU memory. At 1.0 DPR the same buffer is 6.7 MB
      // — a 56% per-page reduction, ~50 MB at idle.
      //
      // Visual quality is preserved because the PDF renderer is anti-aliased
      // vector output at the requested scale, not a low-res bitmap being
      // upsampled. The "retina" sharpening this loses would only matter if
      // we were rendering at a low CSS scale and relying on DPR upsampling,
      // which we are not (cssScale = fit-width is already >1.5x).
      //
      // Flicker fix — the commit refresh must never blank the page. Engine
      // edits commit through a full pdf.js proxy rebuild
      // (`refreshDocProxyFor` swaps `session.doc`), which re-runs this
      // effect on EVERY mounted page. The old code cleared the canvas at
      // the top of the run and pdf.js painted into it asynchronously, so
      // after every edit Confirm the page flashed white/black for the
      // render duration (the reported "Add box -> Confirm" regression).
      // The visible canvas now KEEPS its last painted frame:
      //   - same-size re-render (doc swap at the same scale/rotation):
      //     the canvas is left untouched — the previous frame stays on
      //     screen while the new one renders off-screen;
      //   - size change (zoom, rotation quarter-turn): resize the canvas
      //     and STRETCH the previous frame into it, so the page is never
      //     blank between zoom steps either;
      //   - fresh mount (no previous frame): the B15 white fill below.
      // The new frame renders into a SCRATCH canvas and is blitted onto
      // the visible canvas in one drawImage only when it is fully painted
      // (see the swap after the render), so the refresh is atomic and
      // invisible.
      const renderW = Math.floor(viewport.width);
      const renderH = Math.floor(viewport.height);
      const prevW = canvas.width;
      const prevH = canvas.height;
      const hasPreviousFrame = paintedFrameRef.current;
      // DEF-274 — the page TURNS IMMEDIATELY. A rotate op moves the
      // `rotation` prop (and swaps this page's wrapper dims) at the React
      // commit, but the fresh pdf.js frame only arrives ~150 ms later, so
      // without this the user watched the pre-rotate frame sit there
      // upright before snapping. When the painted frame's rotation no
      // longer matches the prop, keep the last painted bitmap AND its CSS
      // size untouched and transform it onto the NEW slot box: rotate by
      // the quarter-turn delta about the canvas centre, translated so the
      // rotated bitmap is centred in the new wrapper. The blit below
      // resizes the canvas and drops this transform in the same task, so
      // the approximation is never seen as a double-rotated frame.
      const turnQuarters = (((rotation - paintedRotationRef.current) % 4) + 4) % 4;
      const turning =
        turnQuarters !== 0 &&
        !instantMotionRef.current &&
        hasPreviousFrame &&
        prevW > 0 &&
        prevH > 0;
      if (turning) {
        canvas.style.transformOrigin = "50% 50%";
        canvas.style.transform =
          `translate(${(renderW - prevW) / 2}px, ${(renderH - prevH) / 2}px) ` +
          `rotate(${turnQuarters * 90}deg)`;
      } else if (canvas.style.transform !== "") {
        // No turn in flight (a zoom refresh, a fresh mount, or a turn
        // that already landed): make sure no stale approximation is left.
        canvas.style.transform = "";
        canvas.style.transformOrigin = "";
      }
      if (!turning && (!hasPreviousFrame || prevW !== renderW || prevH !== renderH)) {
        let previousFrame: HTMLCanvasElement | null = null;
        if (hasPreviousFrame && prevW > 0 && prevH > 0) {
          // Snapshot the current frame before the resize wipes it, so it
          // can be stretched into the resized canvas below.
          previousFrame = document.createElement("canvas");
          previousFrame.width = prevW;
          previousFrame.height = prevH;
          previousFrame.getContext("2d")?.drawImage(canvas, 0, 0);
        }
        canvas.width = renderW;
        canvas.height = renderH;
        canvas.style.width = `${renderW}px`;
        canvas.style.height = `${renderH}px`;
        // Request a non-alpha 2D context. The default '2d' context
        // allocates 4 bytes per pixel (RGBA); { alpha: false } allocates
        // 3 bytes per pixel (RGB), saving another 25% on canvas memory
        // with zero visible difference for PDF rendering (the page is
        // opaque).
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx === null) {
          endRender();
          return;
        }
        if (previousFrame !== null) {
          // Stretch the previous frame to the new size — the page stays
          // visible (blurry for a frame) instead of blanking while the
          // sharp new frame renders.
          ctx.drawImage(
            previousFrame,
            0, 0, prevW, prevH,
            0, 0, renderW, renderH,
          );
        } else {
          // B15 — fill the canvas with opaque paper-white BEFORE the
          // pdf.js render starts. The canvas is created with
          // `{ alpha: false }` (above) so an UNFILLED canvas starts
          // opaque-black; if the underlying PDF page is blank (no
          // operators, or only an invisible text layer — common after
          // the engine's `insertBlankPage` or a flat /OCR layer)
          // pdf.js paints nothing onto the canvas and the page would
          // render as a black rectangle. Painting a white background
          // first gives every blank / empty page the same
          // paper-colour identity regardless of theme; the user's
          // document content still paints on top in the usual way
          // (pdf.js's operator list writes opaque pixels over the
          // fill). This is the renderer-side fix for the "blank page
          // shows as black in dark mode" report.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, renderW, renderH);
        }
      }
      // Render the new frame into a SCRATCH canvas (never the visible
      // one), then blit it over the still-painted previous frame once
      // pdf.js has finished. This is what makes the commit refresh
      // atomic: the visible canvas never shows a half-painted or blank
      // frame. The same B15 white fill applies to the scratch so blank
      // pages blit as white paper (and the visible canvas keeps its
      // previous white fill while the blank page renders). The scratch
      // lives only for this run and is released after the blit — a
      // transient ~page-sized bitmap, same peak as the old direct paint.
      const scratch = document.createElement("canvas");
      scratch.width = renderW;
      scratch.height = renderH;
      const scratchCtx = scratch.getContext("2d", { alpha: false });
      if (scratchCtx === null) {
        endRender();
        return;
      }
      scratchCtx.fillStyle = "#ffffff";
      scratchCtx.fillRect(0, 0, renderW, renderH);
      // Track the active render task so a stale cssScale (or other dep
      // change) can cancel it BEFORE a new render begins. pdf.js refuses
      // two concurrent renders against the same canvas, which used to
      // surface as a hard "Cannot use the same canvas during multiple
      // render() operations" error during fast zoom in / out (the
      // scratch canvas is per-run, so the runs never share a canvas).
      const task = pageProxy.render({
        canvasContext: scratchCtx,
        viewport: pageProxy.getViewport({ scale: cssScale, rotation: rotDeg }),
      });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string }).name !== "RenderingCancelledException") {
          endRender();
          throw error;
        }
        endRender();
        return;
      }
      if (disposed) {
        endRender();
        return;
      }
      wrapper.style.setProperty("--scale-factor", String(cssScale));
      textHost.replaceChildren();
      // Resolve textContent up front rather than handing the TextLayer a
      // ReadableStream. The stream variant yields chunks asynchronously and
      // doesn't always include `styles` with the first batch of items, which
      // makes TextLayer.#appendText throw on an undefined style entry and
      // leave the textHost empty (no text-selection, no search highlights).
      const textContent = await pageProxy.getTextContent();
      if (disposed) {
        endRender();
        return;
      }
      // Snapshot the text-item geometry in page points so the annotation
      // overlay can compute markup quads without a re-fetch.
      textItemsRef.current = textItemsToGeom(
        textContent.items as ReadonlyArray<{ str?: string; transform?: number[]; width?: number; height?: number }>,
        pdfPageHeight,
      );
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textHost,
        viewport,
      });
      textLayerTask = textLayer;
      await textLayer.render();
      if (disposed) {
        endRender();
        return;
      }
      textLayerRef.current = textLayer;
      // The new frame is fully painted; swap it onto the visible canvas
      // in one drawImage so the refresh lands atomically. The previous
      // frame stayed on screen until this instant (rendered above), so
      // the engine commit / zoom refresh is never visible as a blank or
      // half-painted page.
      if (turning) {
        // DEF-274 — the turn kept the old backing store and CSS size, so
        // resize the visible canvas HERE, immediately before the blit.
        // Both statements run in one task: no paint can land between the
        // resize (which clears the bitmap) and the drawImage.
        canvas.width = renderW;
        canvas.height = renderH;
        canvas.style.width = `${renderW}px`;
        canvas.style.height = `${renderH}px`;
      }
      if (canvas.width === renderW && canvas.height === renderH) {
        const visibleCtx = canvas.getContext("2d", { alpha: false });
        if (visibleCtx !== null) {
          visibleCtx.drawImage(scratch, 0, 0);
          // The visible canvas now holds a real painted frame.
          paintedFrameRef.current = true;
          paintedRotationRef.current = rotation;
        }
      }
      if (turning) {
        // Drop the turn approximation in the SAME task as the blit, so
        // the crisp, correctly-laid-out frame replaces it in one visual
        // frame — never a flash of a double-rotated page.
        canvas.style.transform = "";
        canvas.style.transformOrigin = "";
      }
      setRenderedScale(cssScale);
      endRender();
    };
    // DEF-303 — while the window is minimised the page raster is parked
    // (not dropped): `deferWork` runs it now when active and flushes it on
    // restore. The effect's cleanup cancels a parked run so a stale render
    // never fires after a dep change / unmount.
    const cancelDeferred = deferWork(() => {
      void run();
    });
    return () => {
      cancelDeferred();
      disposed = true;
      endRender();
      // Cancel any in-flight tasks; pdf.js will throw RenderingCancelledException
      // which we already swallow above.
      try {
        renderTask?.cancel();
      } catch {
        // ignore: cancel can throw if the task already finished
      }
      try {
        textLayerTask?.cancel();
      } catch {
        // ignore
      }
      // NOTE: the canvas backing store is deliberately NOT released
      // here. This cleanup runs on EVERY dep change (scale / rotation /
      // doc swap), and zeroing the bitmap at the top of a refresh was
      // what blanked the page to white/black for the render duration
      // after every engine commit — the "flash on Add box -> Confirm"
      // regression. The visible frame is kept (and refreshed by the
      // double-buffer in `run`); the backing store is released by the
      // shouldRender=false branch above when the slot stops rendering,
      // and on real unmount the detached canvas is garbage-collected
      // (React nulls this component's refs before effect cleanups run,
      // so an unmount-time wipe could never reach the element anyway —
      // the shouldRender=false path is the memory contract, DEF-016).
      // Drop the text-layer DOM and the text-items snapshot so they
      // don't dangle until GC catches up. The next render rebuilds them.
      const textHost = textHostRef.current;
      if (textHost !== null) {
        textHost.replaceChildren();
      }
      textItemsRef.current = [];
      textLayerRef.current = null;
      // Release pdf.js's parsed per-page state on unmount. Same rationale
      // as in the shouldRender=false branch above: page.cleanup() drops
      // operator lists, font references and decoded streams from the
      // worker. Without this, every page ever rendered stays in the
      // document's per-page cache for the lifetime of the tab, and the
      // Tab process grows by ~10 MB per scroll cycle on long.pdf.
      releasePdfPage(pdfPage);
      pdfPage = null;
    };
  }, [shouldRender, cssScale, doc, sourcePage, onPageSize, onRenderStart, onRenderEnd, rotation]);

  useLayoutEffect(() => {
    if (!ready || hits.length === 0) {
      setMeasured([]);
      return;
    }
    const wrapper = wrapperRef.current;
    const textLayer = textLayerRef.current;
    if (wrapper === null || textLayer === null) {
      return;
    }
    setMeasured(
      hits.map((hit) => ({
        hit,
        rects: measureHitRects(wrapper, textLayer.textDivs as HTMLElement[], hit),
      })),
    );
  }, [ready, renderedScale, hits, activeHit]);

  // Report where the active hit sits so the scroller can center it.
  useEffect(() => {
    if (!ready || activeHit === null) {
      return;
    }
    const wrapper = wrapperRef.current;
    const textLayer = textLayerRef.current;
    if (wrapper === null || textLayer === null) {
      return;
    }
    const rects = measureHitRects(wrapper, textLayer.textDivs as HTMLElement[], activeHit);
    if (rects.length > 0) {
      onActiveHitTop(page, rects[0].top);
    }
  }, [ready, activeHit, page, onActiveHitTop]);

  const getTextItems = useCallback((): TextItemGeom[] => textItemsRef.current, []);

  // DEF-254 — tag the overlay's selection report with this page's visible
  // index. Stable identity (only `page` / the host callback can change) so
  // the overlay's reporting effect does not re-fire on unrelated renders.
  const reportAnnSelection = useCallback(
    (ann: Annotation | null): void => {
      onSelectAnnotation?.(ann, page);
    },
    [onSelectAnnotation, page],
  );

  // Wrapper dims follow the rotated viewport: at 90/270 the visible
  // width and height swap. We compute the post-rotation width / height
  // from the un-rotated page dims + rotation (0,1,2,3) so the slot
  // reserves the correct scroll space, the bitmap fits without a
  // CSS transform, and downstream overlays (annotation / form / signature /
  // edit) lay out over the rotated page the user actually sees
  // (DEF-057). Without this, the wrapper stays the un-rotated size and
  // the rotated canvas overflows the slot for 90/270.
  const rotForLayout = ((rotation % 4) + 4) % 4;
  const isQuarterTurn = rotForLayout === 1 || rotForLayout === 3;
  const wrapperW = isQuarterTurn ? heightPt * cssScale : widthPt * cssScale;
  const wrapperH = isQuarterTurn ? widthPt * cssScale : heightPt * cssScale;
  const rotClass =
    rotForLayout === 0
      ? undefined
      : `pdf-page-rot-${(rotForLayout * 90) as 90 | 180 | 270}`;

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        registerPage?.(page, el);
      }}
      className={rotClass === undefined ? "pdf-page" : `pdf-page ${rotClass}`}
      data-page={page}
      data-stamp-editor-open={stampChromeOpen ? "true" : "false"}
      style={{ width: `${wrapperW}px`, height: `${wrapperH}px` }}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div ref={textHostRef} className="textLayer" />
      <div className="highlight-layer" aria-hidden>
        {measured.map((m) =>
          m.rects.map((rect, i) => (
            <div
              key={`${m.hit.page}:${m.hit.start.item}:${i}`}
              className={m.hit === activeHit ? 'search-hit search-hit-active' : 'search-hit'}
              style={{
                left: rect.left,
                top: rect.top,
                width: Math.max(rect.width, 2),
                height: rect.height,
              }}
            />
          )),
        )}
      </div>
      <AnnotationOverlay
        page={page}
        widthPt={widthPt}
        heightPt={heightPt}
        cssScale={cssScale}
        annotations={annotations}
        tool={annotationTool}
        flashId={flashId}
        liveAnnTextIds={liveAnnTextIds}
        getTextItems={getTextItems}
        onCreate={onCreateAnnotation}
        onFinishedOneShot={onFinishedOneShot}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onDisarmTool={onDisarmAnnTool}
        onSelectAnnotation={reportAnnSelection}
        onTextFocusRequest={onTextFocusRequest}
        paletteTheme={annotationPaletteTheme}
        annotationPalette={annotationPalette}
        onAnnotationPaletteChange={onAnnotationPaletteChange}
        comments={comments}
        onAddComment={onAddComment}
      />
      {/* B10 / DEF-101 + Bug 6 — placed-stamp DOM surfaces. Painted above
       * the textLayer; selectable / movable / deletable like every
       * annotation (the confirm bar routes through the host's stamp
       * handlers, which re-bake via the engine's editImage lever). */}
      <StampAnnotations
        cssScale={cssScale}
        items={stampAnnotations}
        pageWidthPt={widthPt}
        pageHeightPt={heightPt}
        onMove={onMoveStamp === undefined ? undefined : (stamp, rect): void => onMoveStamp(stamp.id, rect)}
        onDelete={onDeleteStamp === undefined ? undefined : (stamp): void => onDeleteStamp(stamp.id)}
        onRetype={onRetypeStamp === undefined ? undefined : (stamp, id): void => onRetypeStamp(stamp.id, id)}
        onSelectionChange={onStampChromeChange}
      />
      <FormsOverlay
        page={page}
        cssScale={cssScale}
        fields={formFields ?? EMPTY_FIELDS}
        onValueChange={(id, v): void => onFormValueChange?.(id, v)}
        onToggleListbox={(id, opt): void => onFormListboxToggle?.(id, opt)}
      />
      <SignaturesOverlay
        page={page}
        pageWidthPt={widthPt}
        pageHeightPt={heightPt}
        cssScale={cssScale}
        placements={signatures ?? EMPTY_PLACEMENTS}
        signatures={savedSignatures ?? EMPTY_SAVED}
        armedSignatureId={armedSignatureId ?? null}
        onPlace={(id, r): void => onPlaceSignature?.(id, page, r)}
        onMove={(id, r): void => onMoveSignature?.(id, r)}
        onDelete={(id): void => onDeleteSignature?.(id)}
        // B1 — exit Sign mode. The overlay's pending action bar
        // Cancel button calls through this; the host's
        // `armedSignatureId` setter clears the crosshair / ghost.
        onCancelArm={onCancelSignatureArm}
      />
      {/* B10 — stamp ghost + click-to-embed. Renders nothing when
          no stamp is armed; otherwise follows the cursor and
          embeds the stamp on the next pointerdown. */}
      <StampOverlay
        page={page}
        pageWidthPt={widthPt}
        pageHeightPt={heightPt}
        cssScale={cssScale}
        armed={armedStamp}
        onPlace={(args): void => {
          if (onPlaceStamp !== undefined) {
            void onPlaceStamp({
              stampId: args.stampId,
              pngBytes: args.pngBytes,
              pngWidth: args.pngWidth,
              pngHeight: args.pngHeight,
              page: args.page,
              atPt: args.atPt,
            });
          }
        }}
      />
      {editModeOpen && edit !== null && (
        <EditOverlay
          page={page}
          pageWidthPt={widthPt}
          pageHeightPt={heightPt}
          cssScale={cssScale}
          tool={edit.state.tool}
          getTextItems={getTextItems}
          edit={edit.state}
          dispatch={edit.onAction}
          pickImage={edit.pickImage}
          defaultFont={edit.defaultFont}
          onCommitTextEdit={edit.onCommitTextEdit}
          onCommitTextBox={edit.onCommitTextBox}
          onCommitImageEdit={edit.onCommitImageEdit}
          onCommitTextBoxMove={edit.onCommitTextBoxMove}
          onDeleteTextBox={edit.onDeleteTextBox}
          textStyle={edit.textStyle}
          onTextTargetChange={edit.onTextTargetChange}
          textLive={edit.textLive ?? null}
          textCommitToken={edit.textCommitToken ?? 0}
        />
      )}
      {!ready && <div className="page-placeholder" aria-hidden />}
    </div>
  );
}

const EMPTY_FIELDS: FormField[] = [];
const EMPTY_PLACEMENTS: SignaturePlacement[] = [];
const EMPTY_SAVED: Record<string, SavedSignature> = {};
