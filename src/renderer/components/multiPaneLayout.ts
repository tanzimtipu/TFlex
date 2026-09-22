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

/** The divider's rendered width; mirrors `--tf-divider-w` in styles.css. */
export const PANE_DIVIDER_W_PX = 8;

/** The thumbnail strip column at rest — the single-mode rail's rest width
 *  (also `STRIP_WIDTH_PX` in PaneThumbStrip and `--tf-strip-w` in CSS). */
export const STRIP_REST_PX = 220;

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

/** The All Tools panel's declared width per layout mode; mirrors the
 *  `--tools-panel-w` values in styles.css
 *  (`.app-main[data-tools-open="true"]`). The re-clamp uses the TARGET, not
 *  the animated computed value, so the settled geometry is what decides. */
export const TOOLS_PANEL_W_LIST_PX = 344;
export const TOOLS_PANEL_W_GRID_PX = 380;

/** The largest inset the panes may consume at `stageWidth` before their
 *  minimum page area would be violated. `MultiPane` measures the stage and
 *  writes this as `--tf-multi-inset-cap`; with the panel closed (or the
 *  window wide) the cap is inactive and the geometry is the pre-DEF-287
 *  one, so the panel slide keeps riding the registered token. */
export function insetCapFor(stageWidth: number): number {
  if (!Number.isFinite(stageWidth)) return 0;
  return Math.max(0, stageWidth - MIN_PANES_BUDGET_PX);
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