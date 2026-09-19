// Phase C — the shared motion preset system.
//
// THEME-INDEPENDENT by design (same rule as the CSS --tf-motion-*
// tokens): these presets carry transform/opacity ONLY, never layout
// properties (width/height/margin/padding/top/left would repaint and
// jank the scroll-critical surfaces they animate). The three themes
// supply colors/surfaces/reflection; springs are identical in all of
// them.
//
// Spring calibration vs the CSS bands (--tf-motion-panel 280ms,
// --tf-motion-emphasized 240ms, --tf-motion-normal 180ms).
// A mass-1 motion spring settles to ~1% in t = -ln(0.01*sqrt(1-z^2))
// / (z*sqrt(k)); with z = damping/(2*sqrt(k)) ~= 0.79-0.83 every
// preset below lands in its band with NO visible bounce (the old
// ease-out curves never overshot, and these springs keep the same
// character while gaining interruptibility):
//
//   panel  ~270-280ms   stiffness 420  damping 34   (z ~= 0.83)
//   dialog ~240ms       stiffness 560  damping 38   (z ~= 0.80)
//   menu/popover/bar/toast ~180ms       stiffness 1000 damping 50 (z ~= 0.79)
//   toast-success       stiffness 420  damping 24   (z ~= 0.59,
//     the ONLY spring with a small overshoot — it reproduces the CSS
//     toast-success-in 1.04 pop over the emphasized band).
//
// Phase 20 — MORPHING SURFACES (the "one element" rule) are the one
// exception to the spring catalog: a morph is a FLIP transform measured
// from the live trigger/surface rects (morphFromTrigger below), not a
// fixed travel, and it runs as a token TWEEN on the fast band — a spring
// overshoot at the trigger seam would read as a bounce, exactly what the
// operator rule forbids. `tfMorph` is the preset factory the surfaces
// consume; see components/motion/TfMotion.tsx (TfMorph) and
// useMorphPreset.ts (the measurement hook).
//
// Every preset mirrors the exact keyframe travel/distances from
// styles.css (panel x:24->0->18, panel-left x:-18->0->-12,
// dialog y:10/scale 0.97 -> y:5/scale 0.985, menu scale 0.96/y-4,
// popover scale 0.97/y-3, toast y:8, bar y:-2) so the visual
// character survives the CSS -> motion migration.
//
// Pointer-events guard (DEF-087/088/090 class): every EXIT preset
// snaps `pointer-events: none` on the FIRST exit frame, so a closing
// surface can never swallow a click meant for whatever is beneath it.
// Motion treats non-animatable values as instant sets, so this is
// immediate, not spring-eased.
//
// DEF-197 — the canonical token layer is wired: every scale and every
// travel distance that has a token reads it from motionTokens.ts (the
// TS mirror of styles/animations.css). Scales map by role: 0.97 ->
// MOTION_SCALE.press (Soft Compression band), 0.95/0.96 ->
// MOTION_SCALE.enter (Bloom/Pop In), 0.985/0.98/0.96-exit ->
// MOTION_SCALE.exit. Travel distances 24px/4px/2px read
// MOTION_TRANSLATE.panel/small/micro. The few odd settle distances the
// catalog has no token for (10/5/8/6/3px dialog & toast & popover
// travel, the 18/12px panel settle-back) stay as literals on purpose:
// they mirror the legacy CSS keyframe travel exactly and inventing a
// token per pixel would be worse than the literal.

import type { TargetAndTransition, Transition } from "motion/react";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  MOTION_SCALE,
  MOTION_TRANSLATE,
  msToSeconds,
} from "../../hooks/motionTokens";

export const springPanel: Transition = { type: "spring", stiffness: 420, damping: 34 };
export const springDialog: Transition = { type: "spring", stiffness: 560, damping: 38 };
export const springQuick: Transition = { type: "spring", stiffness: 1000, damping: 50 };
/** Toast-success pop: the only spring tuned to overshoot (scale
 *  0.95 -> ~1.03 -> 1), reproducing the CSS toast-success-in pop. */
export const springToastSuccess: Transition = { type: "spring", stiffness: 420, damping: 24 };

/** Right-side overlay panels (Tools palette): x 24 -> 0 -> 18. */
export const tfPanel: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, x: MOTION_TRANSLATE.panel },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 18, pointerEvents: "none" },
  transition: springPanel,
};

/** Left-side rail panels (thumbnail rail): x -18 -> 0 -> -12. */
export const tfPanelLeft: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, x: -18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12, pointerEvents: "none" },
  transition: springPanel,
};

/** Modal/sheet dialog box: y 10 + scale 0.97 -> 1, exit y 5 + scale
 *  0.985 (dialog-enter / dialog-exit keyframes). */
export const tfDialog: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: 10, scale: MOTION_SCALE.press },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 5, scale: MOTION_SCALE.exit, pointerEvents: "none" },
  transition: springDialog,
};

/** Modal/sheet backdrop: opacity-only (modal-in / sheet-fade), at the
 *  fast 180ms band — a moving black sheet reads as camera wobble. */
export const tfBackdrop: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, pointerEvents: "none" },
  transition: springQuick,
};

/** Downward-opening menus / flyouts: scale 0.95 + y -4 -> 0. */
export const tfMenu: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, scale: MOTION_SCALE.enter, y: -MOTION_TRANSLATE.small },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: MOTION_SCALE.exit, y: -MOTION_TRANSLATE.small, pointerEvents: "none" },
  transition: springQuick,
};

/** Upward-opening menus: scale 0.95 + y 4 -> 0 (menu-enter-up). */
export const tfMenuUp: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, scale: MOTION_SCALE.enter, y: MOTION_TRANSLATE.small },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: MOTION_SCALE.exit, y: MOTION_TRANSLATE.small, pointerEvents: "none" },
  transition: springQuick,
};

/** Small anchored popovers (annotation color palette): scale 0.97 +
 *  y -3 -> 0 (popover-enter). */
export const tfPopover: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, scale: MOTION_SCALE.press, y: -3 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: MOTION_SCALE.press, y: -3, pointerEvents: "none" },
  transition: springQuick,
};

/** Toasts: y 8 -> 0 (toast-in), exit slides back down 6px. */
export const tfToast: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6, pointerEvents: "none" },
  transition: springQuick,
};

/** Success toast: the emphasized-band rise + the small 1.04 swell
 *  (toast-success-in), rendered as the only overshooting spring. */
export const tfToastSuccess: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: 8, scale: MOTION_SCALE.enter },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: MOTION_SCALE.exit, pointerEvents: "none" },
  transition: springToastSuccess,
};

/** Floating contextual bars (edit toolbar, content action bar,
 *  image placement toolbar, OCR suspects bar): y -2 -> 0
 *  (edit-bar-in / ocr-bar-in travel), exit reverses the rise. */
export const tfBar: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: -MOTION_TRANSLATE.micro },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -MOTION_TRANSLATE.micro, pointerEvents: "none" },
  transition: springQuick,
};

/** OCR suspects bar tops the workspace as a flow element; its
 *  entrance drops from above (translateY -6 -> 0, ocr-bar-in). */
export const tfBarTop: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6, pointerEvents: "none" },
  transition: springQuick,
};
/* ---------------------------------------------------------------------------
 * Phase 20 — MORPHING SURFACES (the "one element" rule)
 *
 * A dropdown/menu/popover must read as its TRIGGER BOX growing into the
 * expanded box, not as a second window appearing next to it. The surface
 * keeps its final layout (the placement/clamping maths is untouched); the
 * morph is a FLIP transform that puts it exactly on the trigger's box for
 * the first frame:
 *
 *   scaleX/scaleY  map the surface's size onto the trigger's size,
 *   x/y            move the anchored corner onto the trigger's matching
 *                  corner, so the first frame IS the trigger's box,
 *   transform-origin sits on that anchored corner, which is the seam the
 *                  surface shares with the trigger (the surface's top edge
 *                  is flush with the trigger's bottom edge for a downward
 *                  surface), so the box grows away from the seam.
 *
 * `morphFromTrigger` is pure maths (unit-tested, no DOM): the wrapper
 * measures two rects and hands them over.
 * ------------------------------------------------------------------------- */

/** Viewport-space rect — the subset of DOMRect the FLIP maths needs, so
 *  the helper stays pure and testable without a DOM. */
export interface MorphRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The corner of the SURFACE that the morph is anchored on — its seam with
 *  the trigger, and the corner the initial transform pins onto the
 *  trigger's same-named corner:
 *   - "top-left" / "top-right": the surface opens DOWNWARD; its top edge
 *     is flush with the trigger's bottom edge in the final layout.
 *   - "bottom-left" / "bottom-right": the surface opens UPWARD; its bottom
 *     edge is flush with the trigger's top edge.
 *  The string doubles as the CSS transform-origin value. */
export type MorphAnchorCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface MorphTransform {
  /** The FLIP start state: the surface box shrunk onto the trigger box. */
  initial: TargetAndTransition;
  /** The reverse morph (exit): the same transform, faded out, with
   *  `pointer-events: none` pinned on its first frame (DEF-087/088/090). */
  exit: TargetAndTransition;
  /** CSS transform-origin for the surface — the anchored corner. */
  transformOrigin: string;
}

/** Smallest scale a morph may start from. A zero-size trigger would
 *  otherwise ask for scale 0 (an invisible box) and a clamped rect can
 *  never produce a negative or NaN scale.
 *
 *  DEF-240 — this is a NUMERIC EPSILON, not a motion value: it is the
 *  floor that keeps the FLIP maths invertible (and `Math.max` of the
 *  ratio), not a duration/easing/scale/travel from the motion catalog.
 *  It stays a local literal on purpose; registering it as a token would
 *  invent a motion concept the catalog does not have. */
const MORPH_MIN_SCALE = 0.01;

const MORPH_CORNER_CSS: Record<MorphAnchorCorner, string> = {
  "top-left": "top left",
  "top-right": "top right",
  "bottom-left": "bottom left",
  "bottom-right": "bottom right",
};

/** Trigger span / surface span, guarded against unmeasurable inputs. */
function morphScale(triggerSpan: number, surfaceSpan: number): number {
  if (!Number.isFinite(triggerSpan) || !Number.isFinite(surfaceSpan) || surfaceSpan <= 0) {
    return 1;
  }
  if (triggerSpan <= 0) return MORPH_MIN_SCALE;
  return Math.max(triggerSpan / surfaceSpan, MORPH_MIN_SCALE);
}

/**
 * Phase 20 — the pure FLIP maths for a morphing surface.
 *
 * `triggerRect` and `surfaceRect` are viewport rects (getBoundingClientRect
 * output). `surfaceRect` is the surface's FINAL rect, so the returned
 * `initial` transform is the first frame and identity is the last one.
 */
export function morphFromTrigger(
  triggerRect: MorphRect,
  surfaceRect: MorphRect,
  anchorCorner: MorphAnchorCorner,
): MorphTransform {
  const opensDown = anchorCorner.startsWith("top");
  const pinnedRight = anchorCorner.endsWith("right");
  // The anchored point: the surface corner that must land on the trigger's
  // SAME-NAMED corner, so the first frame is exactly the trigger's box.
  // (The anchored corner is also the seam the surface shares with the
  // trigger in its final flush layout, which is where the scale pivots.)
  const surfaceX = pinnedRight ? surfaceRect.right : surfaceRect.left;
  const surfaceY = opensDown ? surfaceRect.top : surfaceRect.bottom;
  const triggerX = pinnedRight ? triggerRect.right : triggerRect.left;
  const triggerY = opensDown ? triggerRect.top : triggerRect.bottom;
  const dx = triggerX - surfaceX;
  const dy = triggerY - surfaceY;
  const initial: TargetAndTransition = {
    x: Number.isFinite(dx) ? dx : 0,
    y: Number.isFinite(dy) ? dy : 0,
    scaleX: morphScale(triggerRect.width, surfaceRect.width),
    scaleY: morphScale(triggerRect.height, surfaceRect.height),
    opacity: MOTION_OPACITY.surface,
  };
  return {
    initial,
    exit: { ...initial, opacity: MOTION_OPACITY.hidden, pointerEvents: "none" },
    transformOrigin: MORPH_CORNER_CSS[anchorCorner],
  };
}

/** Enter tween: the fast band on the enter ease. A morph is ONE
 *  coordinated move, so it must not overshoot at the trigger seam. */
export const morphTransitionEnter: Transition = {
  duration: msToSeconds(MOTION_DURATION.fast),
  ease: MOTION_EASE.enter,
};

/** Exit tween: the same band on the exit ease (reverse morph). */
export const morphTransitionExit: Transition = {
  duration: msToSeconds(MOTION_DURATION.fast),
  ease: MOTION_EASE.exit,
};

export interface TfMorphPreset {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transformOrigin: string;
  transition: Transition;
}

/** Build the morph preset for one trigger/surface pair (measured live —
 *  the rects change with the window size, so this is a factory, not a
 *  constant like the rest of the catalog). */
export function tfMorph(
  triggerRect: MorphRect,
  surfaceRect: MorphRect,
  anchorCorner: MorphAnchorCorner,
): TfMorphPreset {
  const morph = morphFromTrigger(triggerRect, surfaceRect, anchorCorner);
  return {
    initial: morph.initial,
    animate: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: MOTION_OPACITY.visible,
      transition: morphTransitionEnter,
    },
    exit: { ...morph.exit, transition: morphTransitionExit },
    transformOrigin: morph.transformOrigin,
    transition: morphTransitionEnter,
  };
}
