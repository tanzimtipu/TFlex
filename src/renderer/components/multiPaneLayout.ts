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
import {
  COMPACT_MIN_CANVAS,
  FULL_MIN_CANVAS,
  PAGE_COMPACT_W,
  PAGE_FULL_W,
  PILL_INSET,
  PILL_ROW_GAP,
  ZOOM_COMPACT_W,
  ZOOM_FULL_W,
} from "../state/pillFit";

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

/** Phase 40 (item 1) — the height of the per-pane bottom band Multi Mode
 *  reserves for that pane's floating pills once they can no longer fit
 *  HORIZONTALLY inside the pane's page column. The pills are never stacked any
 *  more, so the band is ONE pill row (42px) plus the 12px bottom inset plus a
 *  2px clearance: the strip (and its page-action bar) stops above the band and
 *  the pill's top edge can never round into the strip's bottom edge. The strip
 *  stops above this band, so a pill can never overlap the strip or its bar. */
export const MULTI_PILL_BAND_PX = 56;

/** Phase 40 (item 1) — the page-column width at which the pane's two pills fit
 *  HORIZONTALLY at their FULL width (page at the left, zoom at the right):
 *  the pair needs `FULL_MIN_CANVAS` (404px) plus a 4px guard for the live
 *  sub-pixel pill widths (measured 154.4px + 218px). Below this the pane
 *  reserves a one-row band and the pills layer spans the whole pane instead.
 *  Mirrored by the `multi-pills` container query's 407px threshold. */
export const MULTI_PILL_FULL_MIN_LAYER_PX = FULL_MIN_CANVAS + 4;

/** The layer width at/above which the pair fits side by side with the COMPACT
 *  pills (the zoom percent readout and the "/ N" yield): `COMPACT_MIN_CANVAS`
 *  (308px) plus the same 4px live-width guard. Mirrored by the `multi-pills`
 *  container query's 311px threshold. */
export const MULTI_PILL_COMPACT_MIN_LAYER_PX = COMPACT_MIN_CANVAS + 4;

/** Phase 40 (item 1) — the MICRO tier: the two pills at the pane's own sides
 *  when even the compact pair is too wide for the pane. The controls stay
 *  icon-only at the project's dense 24px button size and the pill chrome
 *  tightens; every control stays present and hit-testable. The numbers are the
 *  ONE source of truth the `multi-pills` micro container query mirrors
 *  (page 82 = 8 chrome + 24 + 2 + 22 + 2 + 24; zoom 136 = 8 chrome + 5*24 +
 *  4*2). */
export const MULTI_PILL_MICRO_INSET_PX = 6;
export const MULTI_PILL_MICRO_PAGE_W_PX = 82;
export const MULTI_PILL_MICRO_ZOOM_W_PX = 136;
export const MULTI_PILL_MICRO_HEIGHT_PX = 36;

/** The narrowest layer the micro pair fits in: both insets, both pills and the
 *  row gap between them (238px). At the 640px minimum window a pane is 262px,
 *  so the micro pair always fits with room to spare. */
export const MULTI_PILL_MICRO_MIN_LAYER_PX =
  2 * MULTI_PILL_MICRO_INSET_PX +
  MULTI_PILL_MICRO_PAGE_W_PX +
  PILL_ROW_GAP +
  MULTI_PILL_MICRO_ZOOM_W_PX;

/** The page-column width at/above which the pane keeps the pills inside its
 *  page column (no band): the full horizontal pair's fit width. */
export const MULTI_PILL_FIT_PAGE_PX = MULTI_PILL_FULL_MIN_LAYER_PX;

/** The bottom band a pane reserves for its pills: 0 when the FULL pair fits
 *  horizontally inside the page column, `MULTI_PILL_BAND_PX` otherwise (the
 *  layer then spans the whole pane). `MultiPane` writes this as
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

/** The width the pane's pills LAYER spans: the whole pane when a band is
 *  reserved (the layer is offset outwards by `multiPillSpanPx`), otherwise the
 *  page column alone. The `multi-pills` container query keys on exactly this
 *  width, so the tier and the geometry can never disagree. */
export function multiPillLayerWidthPx(paneWidth: number): number {
  const W = Number.isFinite(paneWidth) ? Math.max(0, paneWidth) : 0;
  if (W <= 0) return 0;
  return multiPillBandPx(W) > 0 ? W : stripAndPageWidths(W).page;
}

/** Phase 40 (item 1) — the three horizontal-fit tiers of a pane's pills. */
export type MultiPillTier = "full" | "compact" | "micro";

/** Resolve the tier for the pills LAYER's width (`multiPillLayerWidthPx`). */
export function multiPillTier(layerWidth: number): MultiPillTier {
  const W = Number.isFinite(layerWidth) ? Math.max(0, layerWidth) : 0;
  if (W >= MULTI_PILL_FULL_MIN_LAYER_PX) return "full";
  if (W >= MULTI_PILL_COMPACT_MIN_LAYER_PX) return "compact";
  return "micro";
}

/** One tier's rendered pill metrics: the outer inset, the pill height and the
 *  two pill widths. The CSS mirrors these exactly (the `multi-pills` container
 *  tiers in styles.css). */
export interface MultiPillMetrics {
  inset: number;
  height: number;
  pageW: number;
  zoomW: number;
}

/** The metrics a tier renders. Full/compact reuse the shared `pillFit`
 *  constants; micro is the Multi-Mode-only dense tier above. */
export function multiPillMetrics(tier: MultiPillTier): MultiPillMetrics {
  if (tier === "full") {
    return { inset: PILL_INSET, height: 42, pageW: PAGE_FULL_W, zoomW: ZOOM_FULL_W };
  }
  if (tier === "compact") {
    return { inset: PILL_INSET, height: 42, pageW: PAGE_COMPACT_W, zoomW: ZOOM_COMPACT_W };
  }
  return {
    inset: MULTI_PILL_MICRO_INSET_PX,
    height: MULTI_PILL_MICRO_HEIGHT_PX,
    pageW: MULTI_PILL_MICRO_PAGE_W_PX,
    zoomW: MULTI_PILL_MICRO_ZOOM_W_PX,
  };
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