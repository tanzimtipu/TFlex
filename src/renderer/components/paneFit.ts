// DEF-338 — fit-scale resolution for a document view that lives in a
// Multi Mode pane.
//
// The operator's "violent glitch" when a document opens into pane B was a
// layout/scale race: the freshly opened tab is rendered while it is still
// UNASSIGNED to a pane (hidden, but absolutely positioned at the full stage
// width), so DocumentView's scroller reported the full stage width on its
// first layout pass. `effectiveScale = width / fitAnchor.w` then produced the
// 204% readout (1214 / 595) and a full-pane grey placeholder slab before the
// ResizeObserver converged the pane to 413px (69%).
//
// The invariant these helpers encode: a pane view must NEVER commit a first
// fit while it has no pane-constrained box. `paneFitDeferred` holds the
// content back until the pane's own scroller box is the one being measured;
// `computeEffectiveScale` is the single fit formula DocumentView uses.
//
// Pure, so the invariant is unit-testable without a DOM.

import type { ZoomMode, ZoomState } from "../state/zoom";

export interface FitBoxSize {
  w: number;
  h: number;
  /**
   * DEF-343 — the pane's effective Inspector inset (`--tf-tools-inset`) at the
   * sample, when measured. Optional so every pre-DEF-343 caller/test keeps its
   * box-only behaviour; a missing inset compares as 0.
   */
  inset?: number;
}

/**
 * True when a Multi Mode view must NOT fit yet.
 *
 * - single mode is never deferred (byte-identical behaviour);
 * - manual zoom needs neither a viewport nor a fit anchor;
 * - an unassigned pane tab (hidden, full-stage width) is always deferred, so
 *   the stage-width first pass can never leak into a pane's scale;
 * - an assigned pane whose first fit anchor has not resolved yet is deferred
 *   until it has one, so the first painted page is the converged fit;
 * - DEF-338 (residual) — an assigned pane whose own scroller box is still
 *   MOVING is deferred until it stops (`boxSettled`), so a fit measured while
 *   the pane is still shrinking can never be committed. Defaults to settled so
 *   every existing caller/test keeps its pre-gate behaviour.
 */
export function paneFitDeferred(
  multiMode: boolean,
  pane: string | null,
  zoomMode: ZoomMode,
  fitAnchor: FitBoxSize | null,
  boxSettled = true,
): boolean {
  if (!multiMode) return false;
  if (zoomMode === "manual") return false;
  if (pane === null) return true;
  if (fitAnchor === null) return true;
  return !boxSettled;
}

/**
 * DEF-343 — true when the pane's requested Inspector inset has reached its
 * FINAL target, i.e. the `--tf-tools-inset` transition (the panel slide) is no
 * longer pending. `null` means "no target known" and is treated as settled, so
 * single mode / a host that does not supply the target keeps the pre-DEF-343
 * behaviour. A registered `<length>` transition has a finite duration (~200ms),
 * so a half-pixel tolerance is enough to call the endpoint.
 *
 * This is the signal the DEF-338 settle gate lacked: opening a document into a
 * pane briefly leaves the tab an empty placeholder (`--tf-tools-inset` 0), the
 * gate saw three identical wide box samples and released, and only THEN did the
 * Inspector re-open and narrow the pane by the inset. Comparing the live inset
 * to the target keeps the gate closed until the slide has actually finished.
 */
export function paneInsetSettled(current: number, target: number | null): boolean {
  if (target === null) return true;
  return Math.abs(current - target) <= 0.5;
}

/**
 * DEF-338 (residual) — true when a pane's scroller box has genuinely stopped
 * moving: three consecutive identical samples of a real box (two identical
 * animation-frame gaps).
 *
 * Opening a document into a Multi Mode pane makes the new tab a brief empty
 * placeholder, which collapses the Inspector's inset to 0 and re-opens it. The
 * registered `--tf-tools-inset` transition then shrinks BOTH panes (and this
 * pane's scroller) over the panel-slide duration (~200ms), so a fit measured on
 * the first pass is wider than the settled fit — the payslip read 88%/78%/69%
 * as it stepped down. Requiring two identical gaps means the box must have
 * stopped, not merely paused for one frame; a single dropped frame cannot
 * release the fit early.
 *
 * DEF-343 — the stability signature ALSO carries the measured inset, and (when
 * an `insetTarget` is supplied) the window cannot settle until that inset has
 * reached the target. Without this the three identical samples could all be
 * taken while the panel slide was still pending, and the ~34% oversized first
 * paint returned on a repeated open/clear/open of the same pane.
 */
export function paneBoxSettled(
  prev2: FitBoxSize | null,
  prev1: FitBoxSize | null,
  next: FitBoxSize,
  insetTarget: number | null = null,
): boolean {
  if (next.w <= 0 || next.h <= 0) return false;
  if (!paneInsetSettled(next.inset ?? 0, insetTarget)) return false;
  if (prev2 === null || prev1 === null) return false;
  return (
    prev2.w === prev1.w &&
    prev1.w === next.w &&
    prev2.h === prev1.h &&
    prev1.h === next.h &&
    (prev2.inset ?? 0) === (prev1.inset ?? 0) &&
    (prev1.inset ?? 0) === (next.inset ?? 0)
  );
}

/**
 * The fit scale for the given (pane-constrained) viewport box. Mirrors the
 * DocumentView memo exactly; `padding` is CONTENT_PADDING_PX.
 */
export function computeEffectiveScale(
  viewportBox: FitBoxSize,
  fitAnchor: FitBoxSize | null,
  zoom: ZoomState,
  padding = 0,
): number {
  if (fitAnchor === null) {
    return 1;
  }
  const availW = Math.max(viewportBox.w - padding * 2, 50);
  const availH = Math.max(viewportBox.h - padding * 2, 50);
  if (zoom.mode === "fit-width") {
    return availW / fitAnchor.w;
  }
  if (zoom.mode === "fit-page") {
    return Math.min(availW / fitAnchor.w, availH / fitAnchor.h);
  }
  return zoom.manualScale;
}
