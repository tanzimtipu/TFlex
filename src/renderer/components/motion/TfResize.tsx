// Phase 20 — the layout-aware size animation primitive.
//
// A context window whose content swaps to a different size (the Sign
// tool's three tabs are the canonical case) must GROW/SHRINK over the
// standard token instead of jumping. The animated channel is the box's
// REAL height/width, not a transform: a `scaleY` would squash the text
// and the controls inside (the smear the morphing-surface note warns
// about), while a real size tween keeps every glyph at its true metrics
// and clips the overflow while the frame is mid-flight.
//
// Shape:
//   <motion.div class="tf-resize" data-tf-resize="height">   <- animated frame
//     <div class="tf-resize-inner">                          <- measured content
//       {children}
//     </div>
//   </motion.div>
//
// The measured inner is the only element in flow. A child that is exiting
// (an AnimatePresence pane the caller has popped to `position: absolute`
// for the cross-fade) contributes nothing to the measurement, so the
// target is always the INCOMING content's size. The measurement is re-read
// on every ResizeObserver tick, so a content change inside the same pane
// (a longer saved-signature list) animates too.
//
// Reduced motion (DEF-198): the SAME structure with a zero-duration tween —
// the size change is instant, never animated, and no element moves.
//
// Tokens only: the size tween reads --motion-duration-standard on the
// layout ease, the pane cross-fade reads --motion-duration-fast.

import {
  motion,
  useAnimationControls,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLiveReducedMotion, useInstantMotion } from "../../hooks/useAnimations";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  msToSeconds,
} from "../../hooks/motionTokens";

export type ResizeAxes = "height" | "width" | "both";

/** A measured box in CSS pixels. */
export interface ResizeBox {
  width: number;
  height: number;
}

/** The axes a resize target carries, in a stable order. */
export function resizeAxes(axes: ResizeAxes): Array<"width" | "height"> {
  if (axes === "both") return ["width", "height"];
  return [axes];
}

/**
 * The motion `animate` target for a measured box, or `null` when the box is
 * unmeasurable (a detached element / a layout-less environment reports a
 * zero box; animating to 0 would collapse the frame). Same guard class as
 * MORPH_MIN_SCALE in tfPresets.ts.
 */
export function resizeTargetFor(
  box: ResizeBox,
  axes: ResizeAxes,
): TargetAndTransition | null {
  const target: { width?: number; height?: number } = {};
  for (const axis of resizeAxes(axes)) {
    const value = box[axis];
    if (!Number.isFinite(value) || value <= 0) return null;
    target[axis] = value;
  }
  return target;
}

/** Sub-pixel tolerance for "the measured size did not change", so a
 *  ResizeObserver tick that repeats the same box never re-triggers a tween. */
export function resizeSizesEqual(a: ResizeBox, b: ResizeBox, axes: ResizeAxes): boolean {
  return resizeAxes(axes).every((axis) => Math.abs(a[axis] - b[axis]) < 0.5);
}

/** The size tween: the standard band on the layout ease. */
export const tfResizeTransition: Transition = {
  duration: msToSeconds(MOTION_DURATION.standard),
  ease: MOTION_EASE.layout,
};

/** Reduced motion: the same tween with the reduced (zero) duration. */
export const tfResizeReducedTransition: Transition = {
  type: "tween",
  duration: msToSeconds(MOTION_DURATION.reduced),
  ease: "linear",
};

export function resizeTransitionFor(reduced: boolean): Transition {
  return reduced ? tfResizeReducedTransition : tfResizeTransition;
}

/** What the frame must do with a freshly measured target. */
export type ResizeAction =
  | { kind: "set"; target: TargetAndTransition }
  | { kind: "start"; target: TargetAndTransition; transition: Transition };

/**
 * The pure decision behind the frame's imperative size drive.
 *
 * `applied` is the signature of the target already on screen (null = the
 * frame has never been sized) and `signature` the freshly measured one:
 *   - nothing measured yet / unchanged -> no action,
 *   - the FIRST measurement -> `set` (the frame's first paint is already at
 *     its natural size; the containing surface owns the entrance),
 *   - every later change -> `start`, a tween from the value on screen.
 *
 * The first/later split is the whole point: driving the size with the
 * declarative `animate` prop makes motion treat a target that appears
 * after mount as an instant set, so the FIRST tab switch jumped while
 * every later one animated. Reduced motion keeps the split (structure
 * unchanged) but every action is a `set`.
 */
export function resizeActionFor(
  applied: string | null,
  target: TargetAndTransition | null,
  signature: string | null,
  reduced: boolean,
): ResizeAction | null {
  if (target === null || signature === null) return null;
  if (signature === applied) return null;
  if (applied === null || reduced) return { kind: "set", target };
  return { kind: "start", target, transition: resizeTransitionFor(false) };
}

/* ---------------------------------------------------------------------------
 * The pane cross-fade that runs INSIDE the resizing frame (Phase 20
 * criterion 3, window-to-window swap). Two overlapping opacity ramps on the
 * fast band: the outgoing pane fades out over the same window the incoming
 * one fades in, so there is never a frame where both are absent — the swap
 * is a cross-fade, not an unmount-then-mount.
 * ------------------------------------------------------------------------- */

export interface TfPaneSwapPreset {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
}

/** Opacity-only variants for a swapping pane; `reduced` collapses the ramps
 *  to the reduced (zero) duration with the structure unchanged. */
export function paneSwapFor(reduced: boolean): TfPaneSwapPreset {
  const duration = msToSeconds(reduced ? MOTION_DURATION.reduced : MOTION_DURATION.fast);
  return {
    initial: { opacity: MOTION_OPACITY.hidden },
    animate: {
      opacity: MOTION_OPACITY.visible,
      transition: { duration, ease: MOTION_EASE.enter },
    },
    exit: {
      opacity: MOTION_OPACITY.hidden,
      transition: { duration, ease: MOTION_EASE.exit },
    },
  };
}

export interface TfResizeProps {
  children: ReactNode;
  /** Class for the animated frame element. */
  className?: string;
  /** Class for the measured content wrapper. */
  innerClassName?: string;
  /** Which axes animate. Defaults to "height" (the common case: a fixed
   *  width with content-driven height). */
  axes?: ResizeAxes;
  "data-testid"?: string;
}

/**
 * Animate a frame to the measured size of its content.
 *
 * The size is driven IMPERATIVELY (useAnimationControls, the same shape
 * TfMorph uses): the first measurement is a `set` (the frame's first paint
 * is already at its natural size — the containing surface owns the
 * entrance), and every later measurement is a `start` that tweens from the
 * value on screen.
 *
 * Why not the declarative `animate` prop: the first target only exists
 * after the first measurement, i.e. after mount, and motion applies a
 * post-mount first target as an instant set — the very first tab switch
 * would jump while every later one animated. `set`-then-`start` gives every
 * change the same tween, including the first.
 */
export function TfResize(props: TfResizeProps): ReactElement {
  const { children, className, innerClassName, axes = "height" } = props;
  const reduced = useLiveReducedMotion();
  // Phase 23 — the frame size change is instant when the Animations
  // setting is OFF, exactly as it already is under OS reduced motion.
  const instant = useInstantMotion(reduced);
  const controls = useAnimationControls();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<ResizeBox | null>(null);
  /** The target already on screen, as a value signature (null = never set). */
  const appliedRef = useRef<string | null>(null);

  const read = useCallback((): void => {
    const el = innerRef.current;
    if (el === null) return;
    // offsetWidth/offsetHeight (NOT getBoundingClientRect): the measured
    // content sits inside surfaces that enter with a scale (the dialog
    // blooms from 0.97), and a rect would report the TRANSFORMED size — the
    // frame would then be pinned to 97% of its content for the rest of the
    // session. The layout box is the size the frame must actually take.
    const next: ResizeBox = { width: el.offsetWidth, height: el.offsetHeight };
    setBox((prev) =>
      prev !== null && resizeSizesEqual(prev, next, axes) ? prev : next,
    );
  }, [axes]);

  // Re-read on every commit: a swap that changes which pane is in flow is
  // already a re-render of this frame, so the new target is picked up in the
  // same commit rather than a frame later.
  useLayoutEffect((): void => {
    read();
  });

  // ResizeObserver covers size changes that do NOT re-render this frame
  // (a child's own state change, a late font/bitmap load).
  useLayoutEffect((): void | (() => void) => {
    const el = innerRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((): void => {
      read();
    });
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [read]);

  const target = box === null ? null : resizeTargetFor(box, axes);
  const signature =
    target === null ? null : `${target.width ?? ""}x${target.height ?? ""}`;

  useLayoutEffect((): void => {
    const action = resizeActionFor(appliedRef.current, target, signature, instant);
    if (action === null) return;
    appliedRef.current = signature;
    if (action.kind === "set") {
      controls.set(action.target);
      return;
    }
    void controls.start({ ...action.target, transition: action.transition });
  }, [controls, instant, signature, target]);

  return (
    <motion.div
      className={className}
      data-tf-resize={axes}
      data-testid={props["data-testid"]}
      initial={false}
      animate={controls}
      style={{ overflow: "hidden" }}
    >
      <div ref={innerRef} className={innerClassName} data-tf-resize-inner>
        {children}
      </div>
    </motion.div>
  );
}
