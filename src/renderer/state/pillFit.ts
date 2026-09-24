// DEF-322 — the floating canvas pills' yield geometry (pure, DOM-free).
//
// The page pill floats at the canvas's bottom-left and the zoom pill at its
// bottom-right. Both are anchored inside `.canvas-overlay` (the VISIBLE canvas,
// DEF-319). As the canvas narrows the two full pills collide: the pair needs
// `PILL_INSET + PAGE_FULL_W + PILL_ROW_GAP + ZOOM_FULL_W + PILL_INSET` = 404px.
//
// The yield ladder, mirrored by the container queries in styles.css:
//
//   full     canvas >= 404px   both pills at their full width, one row;
//   compact  canvas >= 308px   the zoom pill drops its percent readout
//                              (icon-only) and the page pill drops "/ N" and
//                              the logical label, narrowing its input — the
//                              compact pair is `308px` wide;
//   stacked  otherwise         the zoom pill is RAISED one pill + gap above
//                              the page pill, so the two never intersect even
//                              when neither a full nor a compact row fits.
//
// These constants are the ONE source of truth the DWIM unit tests and the CSS
// assertions share; the stylesheet's container-query thresholds must equal
// `FULL_MIN_CANVAS` and `COMPACT_MIN_CANVAS`.

import { DOCK_PILL_GAP, type PillBox, type Rect } from './dockFit';

/** The pills' own inset from the canvas edges (`.canvas-pill` left/right). */
export const PILL_INSET = 12;

/** A pill's height (the live measurement). */
export const PILL_HEIGHT = 42;

/** The vertical gap between the raised zoom pill and the page pill beneath it. */
export const PILL_STACK_GAP = 6;

/** The gap reserved between the two pills in one row (and the dock's reserve). */
export const PILL_ROW_GAP = DOCK_PILL_GAP;

/** The full pill widths (live-measured: page 154px, zoom 218px). */
export const PAGE_FULL_W = 154;
export const ZOOM_FULL_W = 218;

/** The compact pill widths: the zoom pill drops its 44px readout (218 -> 170);
 *  the page pill drops "/ N" + the label and narrows its input 42 -> 20
 *  (154 -> 106). */
export const ZOOM_COMPACT_W = 170;
export const PAGE_COMPACT_W = 106;

/** The canvas width at/above which the full pair fits in one row. */
export const FULL_MIN_CANVAS =
  PILL_INSET + PAGE_FULL_W + PILL_ROW_GAP + ZOOM_FULL_W + PILL_INSET;

/** The canvas width at/above which the compact pair fits in one row. */
export const COMPACT_MIN_CANVAS =
  PILL_INSET + PAGE_COMPACT_W + PILL_ROW_GAP + ZOOM_COMPACT_W + PILL_INSET;

/** How far the zoom pill is raised in the stacked mode (its own height + gap). */
export const PILL_RAISE = PILL_HEIGHT + PILL_STACK_GAP;

export type PillMode = 'full' | 'compact' | 'stacked';

/** Resolve the yield mode for a canvas width. */
export function pillMode(canvasWidth: number): PillMode {
  if (canvasWidth >= FULL_MIN_CANVAS) return 'full';
  if (canvasWidth >= COMPACT_MIN_CANVAS) return 'compact';
  return 'stacked';
}

export interface PillLayout {
  mode: PillMode;
  page: PillBox;
  zoom: PillBox;
}

function box(left: number, top: number, width: number): PillBox {
  return {
    left,
    top,
    right: left + width,
    bottom: top + PILL_HEIGHT,
    width,
    height: PILL_HEIGHT,
  };
}

/** The two pills' boxes for a canvas of `canvasWidth` x `hostHeight`, in
 *  canvas-local coordinates. In `stacked` the zoom pill sits one raise above
 *  the page pill. */
export function pillLayout(canvasWidth: number, hostHeight: number): PillLayout {
  const mode = pillMode(canvasWidth);
  const pageW = mode === 'full' ? PAGE_FULL_W : PAGE_COMPACT_W;
  const zoomW = mode === 'full' ? ZOOM_FULL_W : ZOOM_COMPACT_W;
  const page = box(PILL_INSET, hostHeight - PILL_INSET - PILL_HEIGHT, pageW);
  const raise = mode === 'stacked' ? PILL_RAISE : 0;
  const zoom = box(
    canvasWidth - PILL_INSET - zoomW,
    hostHeight - PILL_INSET - raise - PILL_HEIGHT,
    zoomW,
  );
  return { mode, page, zoom };
}

/** One interactive control inside a pill. */
export interface PillControl {
  name: string;
  rect: Rect;
}

/** The inner row geometry shared by both pills: 6px padding + 1px border, 28px
 *  buttons, 4px gaps. */
const PAD = 1 + 6;
const BTN = 28;
const GAP = 4;

function centre(rect: Rect): { x: number; y: number } {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

/** Every interactive control in the page pill: Previous, the jump input, Next.
 *  The button row is centred vertically; the input is 28px tall inside the
 *  32px hit row. */
export function pageControls(page: PillBox, mode: PillMode): PillControl[] {
  const y = page.top + PAD + 2;
  const prev = { name: 'Previous page', rect: { left: page.left + PAD, right: page.left + PAD + BTN, top: y, bottom: y + BTN } };
  const next = { name: 'Next page', rect: { left: page.right - PAD - BTN, right: page.right - PAD, top: y, bottom: y + BTN } };
  const inputW = mode === 'full' ? 42 : 20;
  const inputLeft = prev.rect.right + GAP + 4;
  const input = { name: 'Current page', rect: { left: inputLeft, right: inputLeft + inputW, top: y, bottom: y + BTN } };
  return [prev, input, next];
}

/** Every interactive control in the zoom pill, left to right. The percent
 *  readout is display-only (dropped in compact). */
export function zoomControls(zoom: PillBox, mode: PillMode): PillControl[] {
  const y = zoom.top + PAD + 2;
  const names =
    mode === 'full'
      ? ['Zoom out', null, 'Zoom in', 'Fit width', 'Fit page', 'Pan mode']
      : ['Zoom out', 'Zoom in', 'Fit width', 'Fit page', 'Pan mode'];
  const out: PillControl[] = [];
  let x = zoom.left + PAD;
  for (const name of names) {
    const w = name === null ? 44 : BTN;
    if (name !== null) out.push({ name, rect: { left: x, right: x + w, top: y, bottom: y + BTN } });
    x += w + GAP;
  }
  return out;
}

/** The centre of a control, for a geometric hit-test. */
export function controlCentre(control: PillControl): { x: number; y: number } {
  return centre(control.rect);
}
