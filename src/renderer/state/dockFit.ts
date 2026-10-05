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
 * DEF-573 — the dock's inline `max-width` cap, in px.
 *
 * A LIFTED dock and the RESERVED-ROW rung both take the whole host less the
 * lift inset (12px each side); the reserved case is exactly the CSS
 * `.action-dock[data-dock-reserved='true']` rule's `calc(100% - 24px)`, so the
 * inline cap no longer contradicts it. The reserved branch is checked BEFORE
 * the measured free band because the rung must hold independent of the pills:
 * when they are unmeasured (`pill === null`) `freeBand` is null and the old
 * `freeBand ?? band` fell back to the symmetric band, which `dockBand(520, 476)`
 * collapses to 0. Only outside those two cases does the measured free band (when
 * present) then the symmetric band apply — the unchanged DEF-330 geometry.
 */
export function dockCap(args: {
  width: number;
  lifted: boolean;
  reservedRow: boolean;
  freeBandWidth: number | null;
  band: number;
}): number {
  if (args.lifted || args.reservedRow) {
    return Math.max(0, args.width - 2 * DOCK_LIFT_INSET);
  }
  return args.freeBandWidth ?? args.band;
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

/**
 * Phase 39 (D3) — the dock's pill basis rebuilt from the pills' measured
 * WIDTHS/HEIGHTS at the single-mode insets.
 *
 * In Multi Mode the FOCUSED pane's pills are OUTBOARD: they park at the pane's
 * outer edge (A left, B right), so their measured POSITIONS relative to the
 * workspace-centred dock are meaningless — feeding those boxes to
 * `pillReserve` charged the dock for most of the workspace width, so the
 * shared dock's reserve (and therefore its measured-overflow lane and its
 * vertical lift) differed from single mode's at the same window width. Their
 * WIDTHS are identical to single mode's (the same CanvasPills component, the
 * same zoom readout), so rebuilding the boxes at `DOCK_PILL_INSET` gives the
 * dock EXACTLY the reserve, free band and pill band height single mode measures
 * at the same host width — the shared basis that keeps the lane and lift
 * decisions identical between the modes.
 *
 * `page`/`zoom` are the focused pane's measured boxes (null when absent); only
 * their widths and their vertical band are consumed, never their horizontal
 * offsets. The vertical band is mode-independent (both panes bottom-anchor
 * their pills), so `pillBandHeight` reads the real stacked/full yield directly.
 */
export function pillBasisFromWidths(args: {
  page: PillBox | null;
  zoom: PillBox | null;
  hostWidth: number;
  /** The SINGLE-mode stacked yield's raise, in px (0 when the pills share one
   *  row). `ActionDock` supplies `pillFit.PILL_RAISE` when the host width is
   *  below the stacked rung, so the vertical band this returns is the one
   *  single mode would report at the same host width — NOT the focused pane's
   *  own stacked arrangement, which is outboard and mode-specific. */
  stackedRaisePx?: number;
}): { reserve: number; pillHeight: number; free: { left: number; width: number } | null } {
  const needs: number[] = [];
  if (args.page !== null) needs.push(DOCK_PILL_INSET + args.page.width);
  if (args.zoom !== null) needs.push(DOCK_PILL_INSET + args.zoom.width);
  const reserve =
    needs.length === 0 ? DOCK_DEFAULT_RESERVE : 2 * Math.max(...needs) + 2 * DOCK_PILL_GAP;
  const free =
    args.page !== null && args.zoom !== null
      ? {
          left: DOCK_PILL_INSET + args.page.width + DOCK_PILL_GAP,
          width: Math.max(
            0,
            args.hostWidth -
              2 * DOCK_PILL_INSET -
              args.page.width -
              args.zoom.width -
              2 * DOCK_PILL_GAP,
          ),
        }
      : null;
  const rowHeight = Math.max(args.page?.height ?? 0, args.zoom?.height ?? 0);
  const raise = args.stackedRaisePx !== undefined && args.stackedRaisePx > 0 ? args.stackedRaisePx : 0;
  return { reserve, pillHeight: rowHeight + raise, free };
}

/** True when the horizontal band cannot hold the collapsed dock. */
export function shouldLiftDock(band: number): boolean {
  return band < DOCK_MIN_BAND;
}

/** The average advance width of a dock label at 12px Inter (Phase 38 feature B
 *  raised the label from 9px to the 12px floor), measured from the real curated
 *  labels: the old 4.2px/char at 9px scales to 5.6px/char at 12px ("Export to
 *  Word (.docx)" is ~119.8px for its 22 characters). The label's own width is
 *  what decides the fit — a per-verb CONSTANT cannot. */
export const DOCK_LABEL_ADVANCE_PX = 5.6;

/** One labelled dock verb's ESTIMATED width: the wider of its 20px icon
 *  (Phase 38 feature B, was 16px) and its 12px label, plus 2 x 9px padding
 *  (18). The padding slightly OVERESTIMATES the rendered 2 x 8px (16), so the
 *  fit test stays conservative rather than dropping labels a dock could
 *  render. */
export function dockVerbWidth(label: string): number {
  return Math.max(20, label.length * DOCK_LABEL_ADVANCE_PX) + 18;
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

/** Phase 104 (chunk 1) — the Focus Dock tool tile's min width, mirrored from
 *  the scoped `--dock-tool-tile-min-width` token. The tile is 58px in EVERY
 *  rung, the icon-only rung included: dropping the label narrows the GLYPH
 *  column, never the tile, so an icon-only row is not narrower per control. */
export const DOCK_TOOL_TILE_MIN_W = 58;

/** The row gap between dock controls (mirrors the dock's 4px gap). */
const DOCK_ROW_GAP = 4;

/**
 * DEF-571 — the estimated width of the ICON-ONLY dock row for `controlCount`
 * controls (primary tiles + pins + the selection chip + the edit add + the
 * stable More and Tools utilities). Each control is at least
 * `DOCK_TOOL_TILE_MIN_W` wide, separated by the row gap, plus the dock's 16px
 * padding. The labelled fit test cannot see this row (its labels are gone), so
 * the lane decision needs this basis to route an overflowing icon-only row into
 * the arrows lane before its leading tile can sit over the page pill.
 */
export function iconOnlyDockNeed(controlCount: number): number {
  if (controlCount <= 0) return 0;
  return controlCount * DOCK_TOOL_TILE_MIN_W + (controlCount - 1) * DOCK_ROW_GAP + 16;
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

/**
 * DEF-341 — the leading verb's left offset inside a scroll box of `box` for a
 * row needing `need`.
 *
 * A centred row that OVERFLOWS spills half the excess to the LEFT of its box.
 * In the dock that put the leading verb of every stage outside the dock's
 * bounding box — REVIEW's `annotate` laid out at x=340 while the dock box began
 * at x=422, so its centre hit-tested `.page-indicator` and Playwright's click
 * timed out on the pill that covered it. The arrows lane therefore START-aligns
 * an overflowing row (offset 0, so the leading verb is fully inside the box and
 * reachable at `scrollLeft = 0`) and centres only a row that fits. The old
 * `(need - box) / 2` value is what the containment test rules out.
 */
export function dockRowLeadingOffset(need: number, box: number): number {
  if (need <= box) return Math.max(0, (box - need) / 2);
  return 0;
}

/**
 * DEF-341 — true when the row overflows its scroll box and must therefore run
 * through the arrows lane (start-aligned) rather than sit centred in the dock.
 * The dock's lane decision is `ladder.arrows || this`; the containment contract
 * is that the lane is on whenever the row does not fit the box.
 */
export function dockRowNeedsLane(need: number, box: number): boolean {
  return need > box;
}
