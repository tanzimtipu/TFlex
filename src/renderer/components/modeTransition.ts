// Phase 45 (item 3 / feature D) — the MULTI MODE activation animation.
//
// Entering and leaving Multi Mode must ANIMATE through the centralised motion
// system. The full design is in styles.css (`tf-mode-split` keyframe + the
// `[data-mode-anim]` rules); this module owns the PURE geometry maths and the
// DOM applier, so the rule is unit-testable without a browser.
//
// WHY A FLIP AND NOT A GEOMETRY TRANSITION:
//   The panes are the SAME mounted elements across a toggle (MultiPane keys
//   them by tab id), and a mode toggle must not remount a DocumentView or
//   re-raster a canvas. The pane geometry therefore changes in ONE frame (the
//   widths/offsets are calculated instantly, exactly as they are during a
//   divider drag, so the drag stays 1:1), and each pane then plays a
//   TRANSFORM-ONLY FLIP from its previous rect to identity — the same
//   technique as the Phase-43 page-layout FLIP (`zoomFlip.ts`). Transform and
//   opacity only: the PDF bitmap is moved, never recoloured, cross-faded or
//   re-rastered, and the panes never reflow per animation frame.

import type { PaneId } from "../state/multiMode";

/** A viewport rect (or any rect-shaped record) a FLIP is measured from. */
export interface ModeFlipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The pure FLIP offset for one pane, in px. `first` is the pane's rect in
 *  the PREVIOUS mode (null when the pane was not on screen before — a pane
 *  that APPEARS slides in from its outer edge). `pane` only chooses the
 *  appearance direction: A enters from the left, B from the right.
 *
 *  The offset preserves the pane's CENTRE, not its left edge: the document
 *  inside a pane is centred, so keeping the centre fixed is what makes the
 *  active document appear to stay put while the split opens around it. The
 *  returned delta is applied to the pane as a starting `translate` and
 *  animates to 0. */
export function modeFlipDelta(
  first: ModeFlipRect | null,
  last: ModeFlipRect,
  pane: PaneId,
): { dx: number; dy: number } | null {
  if (first === null) {
    // Newly on screen: slide in from the pane's outer edge (a full pane
    // width of travel; B comes from the right, A from the left).
    const dx = (pane === "A" ? -1 : 1) * last.width;
    if (!Number.isFinite(dx) || last.width <= 0) return null;
    return { dx, dy: 0 };
  }
  const dx =
    first.left + first.width / 2 - (last.left + last.width / 2);
  const dy =
    first.top + first.height / 2 - (last.top + last.height / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  // Nothing to animate: the pane already sits where it should (equal rects).
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return { dx, dy };
}

/** The custom property the `tf-mode-split` keyframe reads as its start
 *  translate, in px. Mirrored from styles.css. */
export const MODE_FLIP_DX_VAR = "--tf-mode-dx";
export const MODE_FLIP_DY_VAR = "--tf-mode-dy";

/** The stage attribute that arms the mode animation for one token band. */
export const MODE_ANIM_ATTR = "data-mode-anim";

/** Write the FLIP start offset onto a pane and arm the animation. The stage
 *  carries `data-mode-anim`, which the stylesheet turns into the token-driven
 *  `tf-mode-split` animation on every pane. Returns false when there is
 *  nothing to animate. */
export function applyModeFlip(el: HTMLElement, dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  el.style.setProperty(MODE_FLIP_DX_VAR, `${Number(dx.toFixed(3))}px`);
  el.style.setProperty(MODE_FLIP_DY_VAR, `${Number(dy.toFixed(3))}px`);
  return true;
}

/** Remove a pane's FLIP start offset (called when the band ends or before a
 *  new mode toggle re-measures). */
export function clearModeFlip(el: HTMLElement): void {
  el.style.removeProperty(MODE_FLIP_DX_VAR);
  el.style.removeProperty(MODE_FLIP_DY_VAR);
}
