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