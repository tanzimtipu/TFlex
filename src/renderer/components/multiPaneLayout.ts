// Phase 34 (chunk 3) — the Multi Mode PANE geometry, extracted so the
// runtime divider maths (`MultiPane.fractionFor`), the stylesheet's calc
// expressions and the unit tests all read ONE source of truth. Pure and
// DOM-free, like `thumbGeometry.ts`.
//
// DEF-286 — the All Tools panel's reserved width (`--tf-tools-inset`) is
// split EQUALLY between the two panes: each pane gives up half the inset,
// at every split fraction, instead of a pro-rata share that starved the
// narrower pane.
//
// DEF-287 — the panes' minimum budget is explicit here. Each pane keeps a
// page area of at least `MIN_PAGE_WIDTH_PX`; the thumbnail strip column may
// shrink from its rest width down to its own floor
// (`THUMB_MIN_WIDTH + THUMB_RAIL_INSET_PX`). When the requested inset would
// push a pane below that budget the inset is CAPPED, which means the
// floating All Tools panel overlaps the right pane rather than the page
// area collapsing to zero.

import { THUMB_MIN_WIDTH, THUMB_RAIL_INSET_PX } from "./thumbGeometry";
import { PILL_INSET, ZOOM_FULL_W } from "../state/pillFit";

/** The divider's rendered width; mirrors `--tf-divider-w` in styles.css. */
export const PANE_DIVIDER_W_PX = 8;

/** The thumbnail strip column at rest — Phase 37 (item 18): narrowed from the
 *  single-mode rail's 220px to 150px, because the headerless Multi Mode strips
 *  only hold two-document 89px thumbnails and carried too much empty space.
 *  Still wider than the `STRIP_MIN_PX` floor, so the strip only starts
 *  yielding once the pane is genuinely narrow. Also `STRIP_WIDTH_PX` in
 *  PaneThumbStrip and `--tf-strip-w` in CSS. */
export const STRIP_REST_PX = 150;

/** The strip column's floor: a minimum-hit-target thumbnail
 *  (`THUMB_MIN_WIDTH`) plus the scroller's horizontal chrome
 *  (`THUMB_RAIL_INSET_PX`). The strip may shrink to here and no further. */
export const STRIP_MIN_PX = THUMB_MIN_WIDTH + THUMB_RAIL_INSET_PX;

/** The smallest page area a pane keeps. 44px is the project's declared
 *  pointer-target floor (see thumbGeometry) and is the exact fit at the
 *  640x520 minimum window with the 344px list-mode panel open:
 *  2 * (100 + 44) + 8 = 296 = 640 - 344. */
export const MIN_PAGE_WIDTH_PX = 44;

/** The smallest usable pane: its strip floor plus its page minimum. */
export const MIN_PANE_PANE_PX = STRIP_MIN_PX + MIN_PAGE_WIDTH_PX;

/** Both panes plus the divider — the stage width the panes need at least. */
export const MIN_PANES_BUDGET_PX = 2 * MIN_PANE_PANE_PX + PANE_DIVIDER_W_PX;

/** The smallest comfortable pane width the divider drag may produce. It is
 *  deliberately stricter than the DEF-287 budget floor (`MIN_PANE_PANE_PX`):
 *  the split keeps the panes pleasant to read, not merely non-empty. */
export const MIN_PANE_WIDTH_PX = 320;

/** The Inspector's declared width; mirrors the `--tools-panel-w` value in
 *  styles.css (`.app-main[data-tools-open="true"]`). Phase 36 (chunk 5) —
 *  the Inspector replaces the retired All-tools palette's list/grid modes
 *  (344/380) with ONE width in the 240-280px band. The re-clamp uses the
 *  TARGET, not the animated computed value, so the settled geometry is what
 *  decides. */
export const INSPECTOR_W_PX = 264;

/** Phase 37 (item 3) — the Inspector's COLLAPSED width: a narrow strip that
 *  keeps the expand control reachable (mirrors the Stage Rail's 44px track).
 *  The canvas reclaims everything else; the strip never overlaps it because
 *  the same value drives `--tf-tools-inset` while collapsed. */
export const INSPECTOR_COLLAPSED_W_PX = 44;

/** The largest inset the panes may consume at `stageWidth` before their
 *  minimum page area would be violated. `MultiPane` measures the stage and
 *  writes this as `--tf-multi-inset-cap`; with the panel closed (or the
 *  window wide) the cap is inactive and the geometry is the pre-DEF-287
 *  one, so the panel slide keeps riding the registered token. */
export function insetCapFor(stageWidth: number): number {
  if (!Number.isFinite(stageWidth)) return 0;
  return Math.max(0, stageWidth - MIN_PANES_BUDGET_PX);
}

/** Phase 39 (DEF-348b/c) — the base height of the bottom band Multi Mode
 *  reserves for the shared Action Dock. The dock's box is `bottom: 12px` and
 *  up to 59.5px tall (a labelled verb row), so the panes (and their strips,
 *  pills and page-action bars) stopping at `base + lift` above the stage's
 *  bottom edge can never intersect the dock, lifted or not. */
export const MULTI_DOCK_BAND_BASE_PX = 84;

/** The band the panes reserve for the shared dock at a measured vertical
 *  yield (`liftPx` is the dock's own pill-band lift, 0 when not lifted). The
 *  lift is added so a lifted dock stays inside the reserved band too. */
export function multiDockBandPx(liftPx: number): number {
  const lift = Number.isFinite(liftPx) && liftPx > 0 ? liftPx : 0;
  return MULTI_DOCK_BAND_BASE_PX + lift;
}

/**
 * Phase 39 (DEF-348b/c) — true when a pane that stops `bandPx` above the
 * stage bottom cannot intersect a dock whose box is `dockHeightPx` tall,
 * anchored `bottomInsetPx` above the stage bottom and lifted `liftPx`. This is
 * the structural zero-intersection rule the CSS mirrors: the pane's bottom
 * edge is `stageBottom - bandPx`; the dock's top edge is
 * `stageBottom - bottomInsetPx - dockHeightPx - liftPx`.
 */
export function bandClearsDock(args: {
  bandPx: number;
  dockHeightPx: number;
  bottomInsetPx: number;
  liftPx: number;
}): boolean {
  const { bandPx, dockHeightPx, bottomInsetPx, liftPx } = args;
  return bandPx >= bottomInsetPx + dockHeightPx + liftPx;
}

/** Phase 39 (DEF-349) — the height of the per-pane bottom band Multi Mode
 *  reserves for that pane's own floating pills once they no longer fit inside
 *  the pane's page column. Two stacked pill rows (42px each) plus the 6px gap
 *  and the 12px bottom inset — the same stacked geometry the single-mode
 *  ladder uses (see `pillFit.ts`). The strip stops above this band, so a pill
 *  can never overlap the strip or its page-action bar. */
export const MULTI_PILL_BAND_PX = 102;

/** The page-column width at which the pane's full pills still fit: they stack
 *  at the pane's outer edge, so the wider zoom pill plus its inset is the
 *  binding constraint (`PILL_INSET + ZOOM_FULL_W` = 230px). At or above this
 *  width the pane needs no reserved band and keeps the Phase 36/37/38
 *  placement exactly. */
export const MULTI_PILL_FIT_PAGE_PX = PILL_INSET + ZOOM_FULL_W;

/** The bottom band a pane reserves for its pills: 0 when both pills fit the
 *  page column, `MULTI_PILL_BAND_PX` otherwise. `MultiPane` writes this as
 *  `--tf-multi-pill-band` on the pane; the CSS mirrors it as the workspace's
 *  bottom padding and the pills layer's downward offset. */
export function multiPillBandPx(paneWidth: number): number {
  const W = Number.isFinite(paneWidth) ? Math.max(0, paneWidth) : 0;
  if (W <= 0) return 0;
  return stripAndPageWidths(W).page >= MULTI_PILL_FIT_PAGE_PX ? 0 : MULTI_PILL_BAND_PX;
}

/** The horizontal span the pills layer extends past the page column into the
 *  strip column when a band is reserved: exactly the strip's width, so the
 *  layer reaches the pane's outer edge. 0 when no band is reserved (the wide
 *  Phase 36/37/38 placement is untouched). */
export function multiPillSpanPx(paneWidth: number): number {
  const W = Number.isFinite(paneWidth) ? Math.max(0, paneWidth) : 0;
  if (W <= 0 || multiPillBandPx(W) === 0) return 0;
  return stripAndPageWidths(W).strip;
}

/** The inset the panes actually consume: the requested All Tools inset,
 *  clamped to the cap so both panes keep their minimum page area. */
export function effectiveToolsInset(stageWidth: number, requestedInset: number): number {
  const requested = Number.isFinite(requestedInset) ? Math.max(0, requestedInset) : 0;
  return Math.min(requested, insetCapFor(stageWidth));
}

/** Clamp a split fraction so BOTH panes keep `MIN_PANE_WIDTH_PX`. This is the
 *  ONE rule: the divider drag, the geometry-change re-clamp and the unit tests
 *  all read it. The divider half-width is left out of the clamp, exactly as
 *  the pre-change `MIN / usable` clamp did, so the drag semantics are
 *  unchanged.
 *
 *  When even 0.5 cannot satisfy the minimum (a window narrower than two
 *  minimum panes) the split is meaningless: it pins to 0.5. The function is
 *  idempotent (`clamp(clamp(f)) === clamp(f)`), so a re-clamp can never
 *  oscillate, and the DEF-287 inset cap keeps the page areas usable there. */
export function clampSplitFraction(
  stageWidth: number,
  requestedInset: number,
  fraction: number,
): number {
  const W = Number.isFinite(stageWidth) ? stageWidth : 0;
  if (W <= 0) return 0.5;
  const f = Number.isFinite(fraction) ? fraction : 0.5;
  const inset = effectiveToolsInset(W, requestedInset);
  const min = (MIN_PANE_WIDTH_PX + inset / 2) / W;
  if (min >= 0.5) return 0.5;
  return Math.min(1 - min, Math.max(min, f));
}

/** Resolve a pane's strip/page split the way the CSS grid does:
 *  `minmax(STRIP_MIN, STRIP_REST)` next to `minmax(MIN_PAGE, 1fr)`. The
 *  non-flexible strip track is maximised first (up to its rest width) and
 *  the page track takes the remainder, floored at its minimum. */
export function stripAndPageWidths(paneWidth: number): { strip: number; page: number } {
  const free = paneWidth - (STRIP_MIN_PX + MIN_PAGE_WIDTH_PX);
  const strip = Math.min(STRIP_REST_PX, STRIP_MIN_PX + Math.max(0, free));
  const page = Math.max(MIN_PAGE_WIDTH_PX, paneWidth - strip);
  return { strip, page };
}

export interface PaneRect {
  /** The pane's width, px. */
  width: number;
  /** The pane's left edge relative to the stage's left edge, px. */
  left: number;
  /** The pane's right edge relative to the stage's left edge, px. */
  right: number;
  /** The thumbnail strip column's width, px. */
  strip: number;
  /** The page area's width, px. */
  page: number;
}

export interface MultiPaneGeometry {
  /** The effective (capped) All Tools inset, px. */
  inset: number;
  paneA: PaneRect;
  paneB: PaneRect;
  /** The divider's left edge relative to the stage's left edge, px. */
  dividerLeft: number;
}

/**
 * The full pane geometry mirroring the stylesheet:
 *   pane A: left 0, width  = W * f - inset/2 - divider/2
 *   divider: left         = W * f - inset/2 - divider/2
 *   pane B: right = inset, right edge = W - inset,
 *           width = W * (1 - f) - inset/2 - divider/2
 * With `inset` 0 this is exactly the pre-Phase-34 geometry.
 */
export function multiPaneGeometry(
  stageWidth: number,
  requestedInset: number,
  fraction: number,
): MultiPaneGeometry {
  const W = Number.isFinite(stageWidth) ? Math.max(0, stageWidth) : 0;
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.5;
  const inset = effectiveToolsInset(W, requestedInset);
  const half = PANE_DIVIDER_W_PX / 2;
  const paneAWidth = W * f - inset / 2 - half;
  const dividerLeft = paneAWidth;
  const paneBRight = W - inset;
  const paneBWidth = W * (1 - f) - inset / 2 - half;
  const a = stripAndPageWidths(paneAWidth);
  const b = stripAndPageWidths(paneBWidth);
  return {
    inset,
    dividerLeft,
    paneA: { width: paneAWidth, left: 0, right: paneAWidth, strip: a.strip, page: a.page },
    paneB: {
      width: paneBWidth,
      left: paneBRight - paneBWidth,
      right: paneBRight,
      strip: b.strip,
      page: b.page,
    },
  };
}