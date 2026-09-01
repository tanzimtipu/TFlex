import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { measureHitRects, type HitRect } from '../pdf/highlight';
import type { SearchHit } from '../search/searchIndex';
import { AnnotationOverlay, type TextItemGeom } from '../annotations/AnnotationOverlay';
import { StampAnnotations, type PlacedStamp } from '../annotations/StampAnnotations';
import { FormsOverlay } from '../forms/FormsOverlay';
import { SignaturesOverlay } from '../signatures/SignaturesOverlay';
import { EditOverlay } from '../edit/EditOverlay';
import { StampOverlay } from '../annotations/StampOverlay';
import type {
  FormField,
  SavedSignature,
  SignaturePlacement,
} from '../../shared/types';
import type {
  Annotation,
  AnnotationPatch,
  AnnotationToolState,
} from '../annotations/model';

interface PageViewProps {
  doc: PDFDocumentProxy;
  pageNumber: number; // 1-based
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
  /** B10 / DEF-101 — successfully placed stamps for this page
   *  (rect + raster as recorded by the host on `addStamp` success).
   *  Rendered as `.stamp-annotation` DOM surfaces so a placed stamp
   *  is visible/verifiable in addition to the baked page bitmap. */
  stampAnnotations?: PlacedStamp[];
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
    }) => void;
    onCommitTextBox: (args: {
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import('../edit/model').EditTextStyle;
      background: "white" | "none";
    }) => void;
    onCommitImageEdit: (args: {
      op: "move" | "resize" | "replace" | "crop";
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      bytes: Uint8Array;
      format: "png" | "jpeg";
      id: string;
    }) => void;
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
    pageNumber,
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
    onCreateAnnotation,
    onFinishedOneShot,
    onEditAnnotation,
    onDeleteAnnotation,
    stampAnnotations = [],
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
  const textItemsRef = useRef<TextItemGeom[]>([]);

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
      const page = await doc.getPage(pageNumber);
      pdfPage = page;
      if (disposed) {
        endRender();
        return;
      }
      const pdfPageHeight = page.view[3] - page.view[1];
      onPageSize(pageNumber, page.view[2] - page.view[0], pdfPageHeight);
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
      const viewport = page.getViewport({ scale: cssScale, rotation: rotDeg });
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
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      // Request a non-alpha 2D context. The default '2d' context allocates
      // 4 bytes per pixel (RGBA); { alpha: false } allocates 3 bytes per
      // pixel (RGB), saving another 25% on canvas memory with zero visible
      // difference for PDF rendering (the page is opaque).
      const ctx = canvas.getContext("2d", { alpha: false });
      if (ctx === null) {
        endRender();
        return;
      }
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
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Track the active render task so a stale cssScale (or other dep change)
      // can cancel it BEFORE a new render begins on the same canvas. pdf.js
      // refuses two concurrent renders against the same canvas, which used
      // to surface as a hard "Cannot use the same canvas during multiple
      // render() operations" error during fast zoom in / out.
      const task = page.render({
        canvasContext: ctx,
        viewport: page.getViewport({ scale: cssScale, rotation: rotDeg }),
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
      const textContent = await page.getTextContent();
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
      setRenderedScale(cssScale);
      endRender();
    };
    void run();
    return () => {
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
      // Explicitly release the canvas backing ImageBitmap. When PageView
      // unmounts (the common path: the geometry mount drops the page from
      // the mounted set on scroll), the canvas DOM node is removed by
      // React, but the browser only releases the ImageBitmap once the
      // canvas element is garbage-collected. Setting width/height to 0
      // forces an immediate release — important for idle memory on a
      // 500+ page document where dozens of canvas elements can be in
      // flight between unmount and the next GC cycle.
      const canvas = canvasRef.current;
      if (canvas !== null && (canvas.width !== 0 || canvas.height !== 0)) {
        canvas.width = 0;
        canvas.height = 0;
      }
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
  }, [shouldRender, cssScale, doc, pageNumber, onPageSize, onRenderStart, onRenderEnd, rotation]);

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
      onActiveHitTop(pageNumber, rects[0].top);
    }
  }, [ready, activeHit, pageNumber, onActiveHitTop]);

  const getTextItems = useCallback((): TextItemGeom[] => textItemsRef.current, []);

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
        registerPage?.(pageNumber, el);
      }}
      className={rotClass === undefined ? "pdf-page" : `pdf-page ${rotClass}`}
      data-page={pageNumber}
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
        page={pageNumber}
        widthPt={widthPt}
        heightPt={heightPt}
        cssScale={cssScale}
        annotations={annotations}
        tool={annotationTool}
        flashId={flashId}
        getTextItems={getTextItems}
        onCreate={onCreateAnnotation}
        onFinishedOneShot={onFinishedOneShot}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
      />
      {/* B10 / DEF-101 — placed-stamp DOM surfaces. Painted above
       * the textLayer, pointer-transparent; the engine bakes the
       * pixels, this mirrors them as a verifiable node. */}
      <StampAnnotations cssScale={cssScale} items={stampAnnotations} />
      <FormsOverlay
        page={pageNumber}
        cssScale={cssScale}
        fields={formFields ?? EMPTY_FIELDS}
        onValueChange={(id, v): void => onFormValueChange?.(id, v)}
        onToggleListbox={(id, opt): void => onFormListboxToggle?.(id, opt)}
      />
      <SignaturesOverlay
        page={pageNumber}
        pageWidthPt={widthPt}
        pageHeightPt={heightPt}
        cssScale={cssScale}
        placements={signatures ?? EMPTY_PLACEMENTS}
        signatures={savedSignatures ?? EMPTY_SAVED}
        armedSignatureId={armedSignatureId ?? null}
        onPlace={(id, r): void => onPlaceSignature?.(id, pageNumber, r)}
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
        page={pageNumber}
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
          page={pageNumber}
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
        />
      )}
      {!ready && <div className="page-placeholder" aria-hidden />}
    </div>
  );
}

const EMPTY_FIELDS: FormField[] = [];
const EMPTY_PLACEMENTS: SignaturePlacement[] = [];
const EMPTY_SAVED: Record<string, SavedSignature> = {};
