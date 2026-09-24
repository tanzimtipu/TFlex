// DEF-315 — the Action Dock's pill-clearance geometry (pure, DOM-free).
//
// The dock floats at the bottom-centre of the canvas host; the page pill and
// the zoom pill float in the host's bottom corners. The dock must never cover
// or overlap EITHER pill at every host width. DEF-313's fix hardcoded a 380px
// reserve with a 220px floor — and 380 is asymmetric-blind (the zoom pill is
// 218px wide, the page pill 154px) while the 220px floor exceeded the free
// band below a ~640px host, so the dock reached under the zoom pill.
//
// The geometry here is exact, and only the MEASURED pill boxes feed it:
//
//   * the dock is centred on the host, so what it has is a symmetric HALF;
//   * the binding side is whichever pill's INNER edge is nearer the centre;
//   * reserve = 2 * (that pill's inner edge - the host's near edge) + 2 * GAP;
//   * the cap (`100% - reserve`) is then symmetric AND clears BOTH pills.
//
// Measured live (qa's DEF-315 probe, 760px window, 540px host): page pill
// 154px at a 12px inset, zoom pill 218px at a 12px inset. The binding side is
// the zoom pill: reserve = 2 * (12 + 218) + 2 * 8 = 476px.
//
// Below `DOCK_MIN_BAND` the pills leave too little room for the collapsed dock
// (one icon verb + the `...` chip), so the dock parks ABOVE the pill row in
// its measured band instead of squeezing under a pill.

/** The pills' own inset from the host edges (`.canvas-pill` left/right: 12px). */
export const DOCK_PILL_INSET = 12;

/** The minimum clearance between the dock box and a pill box. */
export const DOCK_PILL_GAP = 8;

/** The reserve used before/without a measurement — the live measurement of
 *  the widest pill above: 2 * (12 + 218) + 2 * 8. */
export const DOCK_DEFAULT_RESERVE = 476;

/** Below this free band the dock yields vertically (above the pill row). One
 *  icon verb (38px) + the `...` chip (38px) + their gap + the dock's padding. */
export const DOCK_MIN_BAND = 96;

/** The dock's own inset from the host edges when it is parked above the pills. */
export const DOCK_LIFT_INSET = 12;

/** A measured box, viewport coordinates (as `getBoundingClientRect` returns). */
export interface PillBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The symmetric reserve the dock must leave for the pill band, from the pills'
 * MEASURED inner-edge offsets. Either pill may be unmeasured (`null`); with
 * neither measured the live-measured default is used, so the cap stays
 * conservative rather than collapsing to nothing.
 */
export function pillReserve(args: {
  page: PillBox | null;
  zoom: PillBox | null;
  hostLeft: number;
  hostRight: number;
}): number {
  const needs: number[] = [];
  if (args.page !== null) needs.push(args.page.right - args.hostLeft);
  if (args.zoom !== null) needs.push(args.hostRight - args.zoom.left);
  if (needs.length === 0) return DOCK_DEFAULT_RESERVE;
  return 2 * Math.max(...needs) + 2 * DOCK_PILL_GAP;
}

/**
 * DEF-322 — the pills' measured VERTICAL band (topmost pill top to lowest pill
 * bottom). A single-row pair reports one pill's height; a STACKED pair (below
 * the compact fit, when the zoom pill is raised above the page pill) reports
 * the whole stack. The dock parks above this band, so a raised pill can never
 * be covered by the lifted dock — the generalization of "the dock sits above
 * the pill row" once the row can become a column.
 */
export function pillBandHeight(page: PillBox | null, zoom: PillBox | null): number {
  const tops: number[] = [];
  const bottoms: number[] = [];
  if (page !== null) {
    tops.push(page.top);
    bottoms.push(page.bottom);
  }
  if (zoom !== null) {
    tops.push(zoom.top);
    bottoms.push(zoom.bottom);
  }
  if (tops.length === 0) return 0;
  return Math.max(...bottoms) - Math.min(...tops);
}

/** The widest band a host-centred dock of `hostWidth` may occupy. Never
 *  negative: at hosts narrower than the reserve the band is empty and the
 *  dock yields vertically instead. */
export function dockBand(hostWidth: number, reserve: number): number {
  return Math.max(0, hostWidth - reserve);
}

/** True when the horizontal band cannot hold the collapsed dock. */
export function shouldLiftDock(band: number): boolean {
  return band < DOCK_MIN_BAND;
}

/**
 * The labelled dock's natural width for `verbCount` verbs plus `pinnedCount`
 * pins (CSS-derived: a labelled verb is max(16px icon, 9px label) + 18px
 * padding, clamped to the widest curated label set at ~64px; gap 4px; dock
 * padding 16px; the pin divider 1px + its gap). Used ONLY to decide whether
 * the labels still fit the measured band — a pinned, labelled dock at 900px
 * host is what makes "icon-only earlier" fire.
 */
export function labelledDockNeed(verbCount: number, pinnedCount: number): number {
  const units = verbCount + pinnedCount;
  if (units <= 0) return 0;
  return units * 64 + (units - 1) * 4 + 16 + (pinnedCount > 0 ? 9 : 0);
}

/** True when the labelled dock fits the band with the pill clearance to spare. */
export function labelsFitBand(need: number, band: number): boolean {
  return need + DOCK_PILL_GAP <= band;
}

/**
 * The width the responsive plan (icon-only / `...` overflow) keys on. Once the
 * pills are measured the plan yields to the BAND, so the `...` chip absorbs
 * the overflow inside it instead of the dock growing toward a pill; an
 * unmeasured dock keeps the host-width plan (the cap still holds), and a
 * lifted dock may use the host, since the pills are no longer beside it.
 */
export function dockPlanWidth(args: {
  hostWidth: number;
  band: number;
  lifted: boolean;
  measured: boolean;
}): number {
  if (!args.measured) return args.hostWidth;
  return args.lifted ? args.hostWidth : args.band;
}

/** True when two boxes overlap on both axes. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
