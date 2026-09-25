// Geometry math for the thumbnail rail. Pure, no React, so it can be unit
// tested without a renderer or pdf.js mock.
//
// A thumbnail must fit a CSS box of `thumbWidth` px wide by `thumbHeight` px
// tall, while remaining crisp on hi-dpi displays. The pdf.js render contract:
//   viewport = page.getViewport({ scale }) -> width/height in CSS px
//   backing buffer = viewport.width/height * dpr (sharp on retina)
//   canvas.style.width/height = viewport.width/height (CSS px)
//
// `scale` is "CSS px per PDF pt" (1pt = 1/72in). To make a page that is
// `pageWidthPt` points wide render at `thumbWidth` CSS px wide, the scale is
// `thumbWidth / pageWidthPt`. The previous implementation inverted the
// relationship, producing viewports ~3000x3700 px for an 8.5x11" page whose
// canvas was clipped to nothing by the 126x163 px wrap.

/** Single-mode thumbnail width: today's fixed rail value. The single-mode
 *  rail has rendered every thumbnail at exactly this width since Phase 3,
 *  so `computeThumbWidth(w, 1)` must return it unchanged. */
export const THUMB_WIDTH = 126;

/** The smallest width the rail will ever use (Multi Mode with several
 *  documents loaded). 84 CSS px is the declared minimum hit target: with a
 *  US-Letter aspect it is an 84x109 px surface, comfortably above the 44px
 *  pointer-target floor, and the thumb's own button still spans the full
 *  rail width. */
export const THUMB_MIN_WIDTH = 84;

/** Horizontal chrome the thumb scroller reserves around a thumbnail
 *  (`var(--sp-2)` padding on both sides, mirroring THUMB_OUTER_PADDING in
 *  SideRail). Subtracted from the rail's width when the available width
 *  caps the thumbnail size. */
export const THUMB_RAIL_INSET_PX = 16;

/** Horizontal chrome a single thumb SLOT adds inside the scroller's content
 *  box: the thumb button's own `padding: 6px` on both sides plus its 1px
 *  border on both sides (14px), plus the vertical scrollbar the scroller
 *  reserves (`scrollbar-width: thin`, ~12px on Chromium). DEF-347 - the
 *  preview wrap is the thumb's child, so the wrap must fit the thumb's
 *  CONTENT box, not the scroller's; without this the fixed 126px single-doc
 *  width spilled ~9px past a narrow Multi Mode strip. */
export const THUMB_SLOT_CHROME_PX = 26;

/** The total horizontal inset the preview wrap must clear on the rail's
 *  width: the scroller chrome plus the thumb slot's own chrome. A single
 *  document fits `THUMB_WIDTH` only when the rail is at least
 *  `THUMB_WIDTH + THUMB_FIT_INSET_PX` wide (168px); the single-mode rail
 *  (184px) clears it, the Multi Mode strips (150px) cap to the real box. */
export const THUMB_FIT_INSET_PX = THUMB_RAIL_INSET_PX + THUMB_SLOT_CHROME_PX;

/**
 * Phase 32 — the thumbnail width for a rail that may hold SEVERAL
 * documents' sections. Pure and DOM-free so the sizing rule is unit
 * tested without a renderer.
 *
 * Rules:
 *   1. One document -> `THUMB_WIDTH` (the single-mode value) when the rail
 *      is wide enough for it, otherwise the rail's own box caps it. DEF-347:
 *      the previous rule returned 126 for EVERY width, so a 150px Multi Mode
 *      strip rendered a 126px preview inside a ~123px page row and the
 *      preview spilled past the row. The rail's width now caps even the
 *      single-document case (rule 3 owns the cap); the single-mode rail is
 *      184px, wide enough that its value is unchanged.
 *   2. N documents share the rail's area, so each section gets ~1/sqrt(N)
 *      of the linear budget (area preserved): two sections get
 *      `floor(126 / 1.414) = 89` px, three get 72 -> clamped to the
 *      minimum. The sections stack, so this is what keeps a comparable
 *      number of pages visible per section.
 *   3. The rail's own width caps the result (a narrow rail never
 *      overflows), and `THUMB_MIN_WIDTH` floors it (a degenerate or
 *      absurdly narrow rail never produces a zero/negative size — the
 *      minimum hit target wins over the cap).
 */
export function computeThumbWidth(railWidthPx: number, documentCount: number): number {
  const count =
    Number.isFinite(documentCount) && documentCount > 1 ? Math.floor(documentCount) : 1;
  const scaled = count <= 1 ? THUMB_WIDTH : Math.floor(THUMB_WIDTH / Math.sqrt(count));
  const usable = Math.floor(railWidthPx) - THUMB_FIT_INSET_PX;
  const capped = usable > 0 ? Math.min(scaled, usable) : THUMB_MIN_WIDTH;
  return Math.max(THUMB_MIN_WIDTH, Math.min(THUMB_WIDTH, capped));
}

export interface ThumbGeometry {
  /** CSS px width of the canvas (and the wrap). */
  cssWidth: number;
  /** CSS px height of the canvas. */
  cssHeight: number;
  /** Backing-buffer width (cssWidth * dpr, floored). */
  bufferWidth: number;
  /** Backing-buffer height. */
  bufferHeight: number;
  /** Scale passed to page.getViewport for the CSS-sized viewport. */
  cssScale: number;
  /** Scale passed to page.render (sharp on hi-dpi). */
  renderScale: number;
}

export interface ThumbGeometryInput {
  /** Page view x-extent in PDF points, e.g. pdfPage.view[2]-pdfPage.view[0]. */
  pageWidthPt: number;
  /** Page view y-extent in PDF points. */
  pageHeightPt: number;
  /** Target CSS width of the thumbnail (e.g. THUMB_WIDTH = 126). */
  thumbWidth: number;
  /** Current device-pixel ratio (1 on standard, 2 on retina, etc). */
  dpr: number;
}

/**
 * Compute the canvas/backing-buffer sizes and pdf.js scales for a thumbnail.
 * Returns a zero-everything geometry for degenerate (zero-width) pages so the
 * caller can still mount the canvas without special-casing.
 */
export function computeThumbGeometry(input: ThumbGeometryInput): ThumbGeometry {
  const { pageWidthPt, pageHeightPt, thumbWidth, dpr } = input;
  if (pageWidthPt <= 0 || thumbWidth <= 0) {
    return { cssWidth: 0, cssHeight: 0, bufferWidth: 0, bufferHeight: 0, cssScale: 0, renderScale: 0 };
  }
  const safeDpr = dpr > 0 ? dpr : 1;
  const cssScale = thumbWidth / pageWidthPt;
  const renderScale = cssScale * safeDpr;
  const cssWidth = Math.floor(pageWidthPt * cssScale);
  const cssHeight = Math.floor(pageHeightPt * cssScale);
  const bufferWidth = Math.floor(pageWidthPt * renderScale);
  const bufferHeight = Math.floor(pageHeightPt * renderScale);
  return { cssWidth, cssHeight, bufferWidth, bufferHeight, cssScale, renderScale };
}