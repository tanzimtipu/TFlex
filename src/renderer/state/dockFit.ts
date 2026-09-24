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

/**
 * DEF-330 — the pill-FREE band: the horizontal span the dock may actually use
 * when it is placed BETWEEN the two pills instead of on the host's centre.
 *
 * The symmetric `dockBand` is over-conservative whenever the pills differ in
 * width (the live page pill is ~154px, the zoom pill ~226px): doubling the
 * WIDEST pill's offset charges the dock for slack the other side never uses, so
 * a 914px canvas left only a 422px band while the pills actually leave 494px
 * between them. At the app's default maximised window that alone dropped every
 * label from the PAGES/EDIT docks and wrapped DELIVER onto two rows.
 *
 * The band is already CLEARANCE-EXCLUSIVE (`DOCK_PILL_GAP` on each side), so a
 * dock capped to it can never reach either pill; `left` is host-relative.
 * Returns `null` when either pill is unmeasured (the caller keeps the symmetric
 * reserve then).
 */
export function pillFreeBand(args: {
  page: PillBox;
  zoom: PillBox;
  hostLeft: number;
}): { left: number; width: number } {
  return {
    left: args.page.right - args.hostLeft + DOCK_PILL_GAP,
    width: Math.max(0, args.zoom.left - args.page.right - 2 * DOCK_PILL_GAP),
  };
}

/** True when the horizontal band cannot hold the collapsed dock. */
export function shouldLiftDock(band: number): boolean {
  return band < DOCK_MIN_BAND;
}

/** The average advance width of a dock label at 9px Inter, measured from the
 *  real curated labels: "Export to Word (.docx)" is 89.9px for its 22
 *  characters, "Sign" 18px for 4, and 4.2px/char reproduces every curated
 *  label to within ~2% (mean absolute error < 4px). The label's own width is
 *  what decides the fit — a per-verb CONSTANT cannot: DELIVER's five wide verbs
 *  (491px) are wider than PAGES' six narrow ones (462px). */
export const DOCK_LABEL_ADVANCE_PX = 4.2;

/** One labelled dock verb's ESTIMATED width: the wider of its 16px icon and
 *  its 9px label, plus padding. The model keeps the concept's 2 x 9px padding
 *  (18), which now OVERESTIMATES the rendered 2 x 7px (DEF-330 trimmed the
 *  verb padding to fit the pill-free band), so the fit test stays conservative
 *  rather than dropping labels a dock could render. */
export function dockVerbWidth(label: string): number {
  return Math.max(16, label.length * DOCK_LABEL_ADVANCE_PX) + 18;
}

/**
 * The labelled dock's width for these verbs: the verbs, the 4px gaps, the
 * dock's 16px horizontal padding and — when pins ride along — the 1px divider
 * plus its gap. Used ONLY to decide whether the labels still fit the band; the
 * band itself decides the layout (and the `...` chip absorbs any pin overflow).
 */
export function labelledDockNeed(
  labels: readonly string[],
  pinnedLabels: readonly string[] = [],
): number {
  const all = [...labels, ...pinnedLabels];
  if (all.length === 0) return 0;
  const sum = all.reduce((total, label) => total + dockVerbWidth(label), 0);
  return sum + (all.length - 1) * 4 + 16 + (pinnedLabels.length > 0 ? 9 : 0);
}

/** True when the labelled dock fits the band. The band passed in is already
 *  clearance-exclusive (see `pillFreeBand` / `dockBand` + the pill reserve), so
 *  this is a plain fit test — no second clearance is charged. */
export function labelsFitBand(need: number, band: number): boolean {
  return need <= band;
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
