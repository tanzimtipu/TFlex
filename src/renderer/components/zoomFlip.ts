// DEF-296 — the page-zoom FLIP helper.
//
// A zoom step re-lays-out the page slot instantly (the wrapper keeps its NEW
// width/height — animating those would thrash layout). To make the change
// VISIBLE, the wrapper plays a one-shot transform-only scale from the
// previous step's ratio back to 1: the page is laid out at the new size but
// painted at the old size for one frame, then eases to full size. Transform
// and opacity only, no layout transition, PDF content scaled (never
// recoloured).
//
// The rotation turn (DEF-274) lives on the INNER `.pdf-page-canvas`, so the
// two transforms are on different elements and compose as parent x child —
// a rotate during a zoom flip simply rides inside the scaled wrapper.

/** Class PageView toggles for the one-shot zoom animation. The matching
 *  `tf-page-zoom-flip` keyframe lives in styles.css and is collapsed by the
 *  global reduced-motion / `data-animations="off"` catch-alls. */
export const ZOOM_FLIP_CLASS = "pdf-page-zoom-flip";

/** The custom property the keyframe reads as its `from` scale. */
export const ZOOM_FLIP_FROM_VAR = "--tf-zoom-flip-from";

/** The keyframe name, mirrored from styles.css so `animationend` can be
 *  filtered to THIS animation (the wrapper hosts no other). */
export const ZOOM_FLIP_ANIMATION = "tf-page-zoom-flip";

/** The FLIP start scale for a zoom from `prevScale` to `nextScale`, or null
 *  when there is nothing to animate (no change, or a non-positive /
 *  non-finite scale). `prev / next` is < 1 for zoom-in (the page starts
 *  smaller than its new box and grows) and > 1 for zoom-out (it starts
 *  larger and shrinks). */
export function zoomFlipFromScale(prevScale: number, nextScale: number): number | null {
  if (
    !Number.isFinite(prevScale) ||
    !Number.isFinite(nextScale) ||
    prevScale <= 0 ||
    nextScale <= 0
  ) {
    return null;
  }
  const ratio = prevScale / nextScale;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) {
    return null;
  }
  return ratio;
}
