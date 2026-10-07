// DEF-296 + DEF-302 — the page-zoom FLIP helper.
//
// A zoom step re-lays-out the page slot instantly (the wrapper takes its NEW
// width/height — animating width/height would thrash layout). The old DEF-296
// version painted the page at the previous SCALE inside the already-resized
// box, scaling about `50% 50%`: the box jumped to the new size in the same
// frame, so the page rubber-banded inside it and — on a 25% step — started
// ~198px away from the position the new layout had already put it in.
//
// DEF-302 replaces that with a real FLIP about the element's TOP-LEFT:
//
//   First   — measure the page UNIT's viewport rect BEFORE the zoom.
//   Last    — let the layout change (the unit is now its NEW size).
//   Invert  — for a size + position change about `transform-origin: 0 0`:
//
//               sx = first.width  / last.width
//               sy = first.height / last.height
//               dx = first.left   - last.left
//               dy = first.top    - last.top
//               transform = translate(dx, dy) scale(sx, sy)
//
//             (origin 0 0, so the local point p maps to d + s*p: the new box's
//             top-left lands exactly on the old box's top-left and its size
//             becomes the old size.)
//   Play    — animate that transform to identity over the motion token. The
//             page content therefore tracks the layout change for the whole
//             250ms instead of rubber-banding inside a box that already moved.
//
// DEF-302 was REOPENED: the FLIP above animated only `.pdf-page`, while the
// sheet's PAPER is also painted by the `.page-slot`'s own background
// (styles.css, DEF-099). The slot reflows to its final box instantly, so the
// paper-white outline teleported to the new size in the first painted frame
// and the content then animated into it — the operator's "jumps first, then
// the animation follows". The unit this module animates is therefore the
// PAPER-OWNING element, `ZOOM_FLIP_UNIT_SELECTOR` (`.page-slot`), which
// contains `.pdf-page` as its child: one transform moves the sheet outline
// AND the content, so no painted frame can show the paper at the new size
// before the animation. The invert maths is unchanged — the slot's layout box
// coincides with the page wrapper's, so `first`/`last` are the same rects.
//
// `applyZoomFlip` measures `last` itself on the live element (after cancelling
// any in-flight animation), so the applier stays a pure DOM operation while
// the arithmetic lives in `zoomFlipInvert` / `zoomFlipTransform` — pure and
// unit-tested.
//
// The rotation turn (DEF-274) lives on the INNER `.pdf-page-canvas`, so the
// two transforms are on different elements and compose as parent x child — a
// rotate during a zoom flip simply rides inside the scaled wrapper.

/** The viewport rect (or any rect-shaped record) a FLIP is measured from. */
export interface ZoomFlipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A page unit paired with its page number, for `runZoomFlip`. `el` is the
 *  PAPER-OWNING page unit (`ZOOM_FLIP_UNIT_SELECTOR`), never the content-only
 *  `.pdf-page` wrapper — see the module header (DEF-302). */
export interface ZoomFlipPageEl {
  page: number;
  el: HTMLElement;
}

/** The inverse transform that maps the `last` box back onto the `first` box. */
export interface ZoomFlipInvert {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

/** Everything captured synchronously before a zoom step is dispatched. */
export interface ZoomFlipPending {
  /** Per mounted page: its wrapper rect BEFORE the zoom. */
  firstRects: Map<number, ZoomFlipRect>;
  /** The page whose top edge sits at the viewport top (scroll anchor). */
  anchorPage: number | null;
  /** That page's top offset below the scroller's top edge BEFORE the zoom. */
  anchorOffsetBefore: number;
  /**
   * TFL-1146 (AR-01) — the normalized in-page fraction (0..1) of the anchor
   * page that sat at the viewport top BEFORE the layout change. The restore
   * lands the SAME in-page point at the same viewport offset after the reflow,
   * so a resize / fit recompute that changes the anchor page's height (mixed
   * page sizes / rotation) does not drift. Defaults to 0 (the top edge), which
   * is the pre-TFL-1146 behaviour.
   */
  anchorFraction?: number;
  /**
   * TFL-1146 (AR-01) — the anchor page's height BEFORE the layout change. The
   * fraction restore needs it to compute how far the in-page point moved when
   * the page re-scaled. Defaults to the live (post-change) height, which makes
   * the fraction correction a no-op for same-height reflows.
   */
  anchorHeightBefore?: number;
  /**
   * TFL-1146 — the layout/document generation this capture belonged to. A
   * restore whose generation no longer matches the current one (a document
   * swap or a newer layout change landed first) is discarded. Undefined keeps
   * the pre-TFL-1146 semantics (never stale).
   */
  generation?: number;
  /**
   * TFL-1146 — whether to play the page FLIP. Resize / dock-drag / explicit
   * fit captures are anchor-only (`false`): the scroll anchor is still restored
   * but pages do not animate on every drag frame. Defaults to true (a zoom does
   * animate), so pre-existing captures are unchanged.
   */
  animate?: boolean;
}

/** Class the applier toggles for the one-shot zoom animation. The matching
 *  `tf-page-zoom-flip` keyframe lives in styles.css and is collapsed by the
 *  global reduced-motion / `data-animations="off"` catch-alls. */
export const ZOOM_FLIP_CLASS = "pdf-page-zoom-flip";

/** Phase 43 (item 1) — the class for a PAGE-LAYOUT FLIP. It reuses the same
 *  `tf-page-zoom-flip` keyframe and start vars as the zoom FLIP, but the CSS
 *  rule drives it with the LAYOUT motion token (`--motion-duration-layout` /
 *  `--motion-ease-layout`, 350ms) instead of the zoom's standard token. The
 *  page pixels are moved, never recoloured or cross-faded. */
export const LAYOUT_FLIP_CLASS = "pdf-page-layout-flip";

/** Which token band a FLIP plays on: the zoom step or the layout switch. */
export type FlipKind = "zoom" | "layout";

/** The element the FLIP must animate: the PAPER-OWNING page unit. It paints
 *  the sheet's paper background (styles.css `.page-slot`, DEF-099) AND
 *  contains the page content (`.pdf-page` + canvas/text/overlays) as a child,
 *  so one transform moves the sheet outline and the content together in the
 *  same frame. Animating only the content wrapper lets the paper teleport to
 *  the new size before the animation (reopened DEF-302). */
export const ZOOM_FLIP_UNIT_SELECTOR = ".page-slot";

/** The custom property the keyframe reads as its `from` SCALE. Kept a plain
 *  number (the e2e contract asserts `Number(from) > 0`). */
export const ZOOM_FLIP_FROM_VAR = "--tf-zoom-flip-from";

/** The custom properties holding the FLIP start translate, in px. */
export const ZOOM_FLIP_DX_VAR = "--tf-zoom-flip-dx";
export const ZOOM_FLIP_DY_VAR = "--tf-zoom-flip-dy";

/** The keyframe name, mirrored from styles.css so `animationend` can be
 *  filtered to THIS animation (the wrapper hosts no other). */
export const ZOOM_FLIP_ANIMATION = "tf-page-zoom-flip";

const SCALE_EPS = 1e-4;
const POS_EPS = 0.01;

function finiteRect(r: ZoomFlipRect): boolean {
  return (
    Number.isFinite(r.left) &&
    Number.isFinite(r.top) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

/** The inverse of `first` relative to `last`, or null when there is nothing
 *  to animate (equal rects, or a non-positive / non-finite measurement).
 *  Shrink steps (zoom in) give sx / sy < 1; grow steps (zoom out) give > 1;
 *  a pure move gives dx / dy != 0 with sx = sy = 1. */
export function zoomFlipInvert(first: ZoomFlipRect, last: ZoomFlipRect): ZoomFlipInvert | null {
  if (!finiteRect(first) || !finiteRect(last)) {
    return null;
  }
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  if (sx <= 0 || sy <= 0) {
    return null;
  }
  if (
    Math.abs(sx - 1) < SCALE_EPS &&
    Math.abs(sy - 1) < SCALE_EPS &&
    Math.abs(dx) < POS_EPS &&
    Math.abs(dy) < POS_EPS
  ) {
    return null;
  }
  return { dx, dy, sx, sy };
}

/** CSS `transform` value for an inverse, trimmed of float noise. */
export function zoomFlipTransform(inv: ZoomFlipInvert): string {
  const f = (n: number): string => String(Number(n.toFixed(4)));
  return `translate(${f(inv.dx)}px, ${f(inv.dy)}px) scale(${f(inv.sx)}, ${f(inv.sy)})`;
}

/** Scroll-anchor rule: pick the topmost page whose top is at or above the
 *  viewport's top edge — the page the user has most recently scrolled past,
 *  i.e. the one occupying the top edge of the viewport. If every page starts
 *  below the top edge (scrolled to the very top), the first page is the
 *  anchor. The returned page's top must stay put across the zoom. */
export function zoomAnchorPage(
  pages: readonly ZoomFlipPageEl[],
  viewportTop: number,
): ZoomFlipPageEl | null {
  let best: ZoomFlipPageEl | null = null;
  let bestTop = Number.NEGATIVE_INFINITY;
  let fallback: ZoomFlipPageEl | null = null;
  let fallbackTop = Number.POSITIVE_INFINITY;
  for (const p of pages) {
    const top = p.el.getBoundingClientRect().top;
    if (!Number.isFinite(top)) continue;
    if (top < fallbackTop) {
      fallback = p;
      fallbackTop = top;
    }
    if (top <= viewportTop && top > bestTop) {
      best = p;
      bestTop = top;
    }
  }
  return best ?? fallback;
}

/** How much to move `scrollTop` so the anchor page's top returns to the
 *  offset it had before the zoom: `after - before` (moving scrollTop down by
 *  that many px moves the page back up to `before`). Non-finite -> 0. */
export function scrollAnchorDelta(beforeOffset: number, afterOffset: number): number {
  const d = afterOffset - beforeOffset;
  return Number.isFinite(d) ? d : 0;
}

/** TFL-1146 (AR-01) — the normalized in-page fraction the viewport top cuts
 *  the anchor page at: `topOffset` is the anchor page's top edge relative to
 *  the scroller's top edge (negative when scrolled into the page). The result
 *  is clamped to 0..1; an anchor page fully below the viewport top (scrolled to
 *  the very start) reads as fraction 0. Non-finite / zero height -> 0. */
export function normalizedAnchorFraction(topOffset: number, height: number): number {
  if (!Number.isFinite(topOffset) || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  const f = -topOffset / height;
  return Math.min(1, Math.max(0, f));
}

/** TFL-1146 (AR-01) — the anchor page's NEW top offset (relative to the
 *  scroller's top edge) that keeps the recorded in-page fraction at the same
 *  viewport position after the page's height changes from `heightBefore` to
 *  `heightAfter`. When the page grows, the recorded point moves down within the
 *  page by `fraction * (heightAfter - heightBefore)`, so the top edge must sit
 *  that much higher. A non-finite input falls back to `topOffsetBefore`. */
export function anchorOffsetAfter(
  topOffsetBefore: number,
  fraction: number,
  heightBefore: number,
  heightAfter: number,
): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const shift = f * (heightAfter - heightBefore);
  const next = topOffsetBefore - shift;
  return Number.isFinite(next) ? next : topOffsetBefore;
}

/** TFL-1146 — true when a captured pending belongs to an OLDER layout /
 *  document generation than `generation`, so its scroll restore must be
 *  discarded instead of applied against the current layout. A pending without
 *  a generation is never stale (pre-TFL-1146 shape). */
export function zoomFlipIsStale(pending: ZoomFlipPending, generation: number): boolean {
  return pending.generation !== undefined && pending.generation !== generation;
}

function clearZoomFlipVars(el: HTMLElement): void {
  el.style.removeProperty(ZOOM_FLIP_FROM_VAR);
  el.style.removeProperty(ZOOM_FLIP_DX_VAR);
  el.style.removeProperty(ZOOM_FLIP_DY_VAR);
}

/** Stop and erase any FLIP (zoom or layout) currently applied to `el`. */
export function clearZoomFlip(el: HTMLElement): void {
  el.classList.remove(ZOOM_FLIP_CLASS);
  el.classList.remove(LAYOUT_FLIP_CLASS);
  clearZoomFlipVars(el);
}

/** Apply the inverse as a one-shot animation on `el`. Reads the element's
 *  CURRENT (post-layout) rect as `last`, cancels any in-flight FLIP, writes
 *  the start transform vars, forces one reflow, then adds the class so a
 *  second zoom step restarts instead of being swallowed. Returns false when
 *  there is nothing to animate. */
export function applyZoomFlip(
  el: HTMLElement,
  first: ZoomFlipRect,
  kind: FlipKind = "zoom",
): boolean {
  clearZoomFlip(el);
  const r = el.getBoundingClientRect();
  const inv = zoomFlipInvert(first, {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  });
  if (inv === null) {
    return false;
  }
  el.style.setProperty(ZOOM_FLIP_FROM_VAR, String(inv.sx));
  el.style.setProperty(ZOOM_FLIP_DX_VAR, `${Number(inv.dx.toFixed(4))}px`);
  el.style.setProperty(ZOOM_FLIP_DY_VAR, `${Number(inv.dy.toFixed(4))}px`);
  void el.offsetWidth;
  el.classList.add(kind === "layout" ? LAYOUT_FLIP_CLASS : ZOOM_FLIP_CLASS);
  return true;
}

/** True when `e` is the END of the unit's OWN zoom FLIP — same animation name
 *  AND fired by the unit itself. The unit hosts nested pages/overlays whose
 *  animations bubble `animationend` up to it, so the target check keeps a
 *  descendant's animation from clearing the FLIP early. */
export function isZoomFlipEnd(
  e: { animationName: string; target: EventTarget | null },
  unit: HTMLElement,
): boolean {
  return e.animationName === ZOOM_FLIP_ANIMATION && e.target === unit;
}

/** Apply the whole zoom FLIP: first restore the scroll anchor (so the
 *  viewport does not jump), then animate every mounted page UNIT
 *  (`ZOOM_FLIP_UNIT_SELECTOR`, the paper + content element) from its
 *  pre-zoom rect to identity. Under instant motion (reduced motion /
 *  Animations off) the scroll anchor is still preserved but no page animates.
 *  TFL-1146 (AR-01): the anchor restore generalizes the top-edge rule to the
 *  recorded in-page fraction, so a scale OR page-height change keeps the same
 *  point of the anchor page under the viewport top; a pending whose recorded
 *  `generation` is older than the current one is discarded entirely. A pending
 *  captured with `animate: false` (resize / dock / explicit fit) restores the
 *  anchor but plays no page animation. Returns the number of units animated. */
export function runZoomFlip(
  scroller: { scrollTop: number; getBoundingClientRect: () => ZoomFlipRect },
  pages: readonly ZoomFlipPageEl[],
  pending: ZoomFlipPending,
  instant: boolean,
  kind: FlipKind = "zoom",
  generation?: number,
): number {
  if (generation !== undefined && zoomFlipIsStale(pending, generation)) {
    return 0;
  }
  const scrollerTop = scroller.getBoundingClientRect().top;
  if (pending.anchorPage !== null) {
    const anchor = pages.find((p) => p.page === pending.anchorPage) ?? null;
    if (anchor !== null) {
      const rect = anchor.el.getBoundingClientRect();
      const after = rect.top - scrollerTop;
      const target = anchorOffsetAfter(
        pending.anchorOffsetBefore,
        pending.anchorFraction ?? 0,
        pending.anchorHeightBefore ?? rect.height,
        rect.height,
      );
      const delta = scrollAnchorDelta(target, after);
      if (delta !== 0) {
        scroller.scrollTop += delta;
      }
    }
  }
  const animatePages = pending.animate !== false;
  let animated = 0;
  for (const p of pages) {
    const first = pending.firstRects.get(p.page);
    if (first === undefined) {
      continue;
    }
    if (instant || !animatePages) {
      clearZoomFlip(p.el);
      continue;
    }
    if (applyZoomFlip(p.el, first, kind)) {
      animated += 1;
    }
  }
  return animated;
}
