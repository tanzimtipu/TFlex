// Phase C — motion surface wrappers.
//
// Thin wrappers around motion.* primitives that own three things:
//   1. The theme-independent spring presets from tfPresets.ts (with
//      per-call overrides merged on top — entering surfaces never
//      re-declare travel, exiting surfaces can pin pointer-events).
//   2. useLiveReducedMotion() (DEF-198): when the OS asks for reduced
//      motion — at boot or flipped mid-session — the wrapper renders
//      the SAME surface with opacity-only variants and zero travel —
//      no transform ever animates.
//   3. The shared DOM tag per surface family (aside for panels,
//      div for dialogs/menus/popovers/bars) so the existing CSS
//      selectors and e2e data-* attributes keep matching.
//
// These wrappers never read theme values — the themes keep supplying
// only colors/surfaces/reflection, so light/dark/frosted share
// identical spring behavior.
//
// AnimatePresence is intentionally NOT imported here: every surface
// needs its own presence boundary at the mount site (a dialog wraps
// its backdrop+sheet, a bar wraps its one conditional child, etc.).
// The dialog pattern (backdrop + sheet as ONE animated child) keeps
// the backdrop's grid-centering layout: the sheet stays INSIDE the
// backdrop DOM node.

import {
  motion,
  useAnimationControls,
  useIsPresent,
  type HTMLMotionProps,
  type TargetAndTransition,
  type Transition,
  type VariantLabels,
} from "motion/react";
import { useLayoutEffect } from "react";
import { useLiveReducedMotion } from "../../hooks/useAnimations";
import { MOTION_DURATION, msToSeconds } from "../../hooks/motionTokens";
import type { ReactElement } from "react";
import {
  tfBackdrop,
  tfBar,
  tfBarTop,
  tfDialog,
  tfMenu,
  tfPanel,
  tfPanelLeft,
  tfPopover,
  tfToast,
  tfToastSuccess,
  type TfMorphPreset,
} from "./tfPresets";

type TfInitial = TargetAndTransition | VariantLabels | boolean | undefined;
type TfExit = TargetAndTransition | VariantLabels | undefined;

interface TfPresetRef {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

export interface TfSurfaceProps extends HTMLMotionProps<"div"> {
  /** Inherited from the surface's own motion config (rare). */
  initial?: TfInitial;
  animate?: TargetAndTransition | VariantLabels | undefined;
  exit?: TfExit;
  transition?: Transition;
}

/** Merge a caller override into a preset for a single variant slot.
 *  `false` (motion's "start already at animate") passes through. */
function mergeVariant(
  preset: TargetAndTransition,
  override: TfInitial,
): TargetAndTransition | VariantLabels | boolean {
  if (override === undefined) return { ...preset };
  if (typeof override === "boolean") return override;
  return { ...preset, ...(override as TargetAndTransition) };
}

function mergeExit(
  preset: TargetAndTransition,
  exit: TfExit,
): TargetAndTransition | VariantLabels {
  if (exit === undefined) return { ...preset };
  return { ...preset, ...(exit as TargetAndTransition) };
}

function useTfPreset(
  preset: TfPresetRef,
  props: Pick<TfSurfaceProps, "initial" | "animate" | "exit" | "transition">,
  reduced: boolean,
): {
  initial: TargetAndTransition | VariantLabels | boolean;
  animate: TargetAndTransition | VariantLabels;
  exit?: TargetAndTransition | VariantLabels;
  transition: Transition;
} {
  if (reduced) {
    // Reduced motion: opacity-only, no travel/scale, no layout impact.
    // DEF-240 — the duration resolves from the canonical reduced token
    // (0ms) rather than a bare literal. `ease: "linear"` stays a literal
    // on purpose: it is NOT a motion value — the catalog deliberately has
    // no linear easing — it is the neutral placeholder motion/react
    // requires for an instant (0-duration) tween, where the curve has no
    // effect on the painted frames.
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: {
        type: "tween",
        duration: msToSeconds(MOTION_DURATION.reduced),
        ease: "linear",
      },
    };
  }
  return {
    initial: mergeVariant(preset.initial, props.initial),
    // The animate override MERGES onto the preset target (e.g. the
    // color popover passes `{ x: drag.x, y: drag.y }` to fold its drag
    // offset into the spring WITHOUT dropping the preset's
    // opacity/scale. Replacing the target would leave opacity/scale at
    // their `initial` values forever.
    animate: {
      ...preset.animate,
      ...(typeof props.animate === "object" && props.animate !== null
        ? (props.animate as TargetAndTransition)
        : {}),
    },
    exit: mergeExit(preset.exit, props.exit),
    transition: props.transition ?? preset.transition,
  };
}

function applyPreset(
  Tag: typeof motion.div,
  preset: TfPresetRef,
  props: TfSurfaceProps,
  reduced: boolean,
  isPresent: boolean,
): ReactElement {
  const mp = useTfPreset(preset, props, reduced);
  return (
    <Tag
      {...props}
      // Phase 20 / DEF-235..238 — an EXITING surface must leave the focus
      // order and the keyboard path: every Tf* surface carries `inert`
      // while its presence context reports "out", so a held key-repeat
      // cannot re-fire a stale commit closure (the inline editor's Apply
      // and the signature Confirm both duplicated this way) and Tab /
      // assistive tech cannot reach the pointer-disabled ghost window.
      // This mirrors the annotation toolboxes' explicit
      // `inert={!isPresent}` (AnnotationOverlay) at the shared wrapper
      // level, so every TfBar / TfPopover / TfMenu / TfBarTop exit is
      // covered. A surface rendered outside an AnimatePresence has no
      // presence context, and useIsPresent() reports present — never
      // inert. Call sites may still pass their own `inert`; the wrapper
      // value is authoritative.
      inert={!isPresent}
      initial={mp.initial}
      animate={mp.animate}
      exit={mp.exit}
      transition={mp.transition}
    />
  );
}

/** Right-side overlay panels (Tools palette): 24px travel, 280ms. */
export function TfPanel(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.aside, tfPanel, props, reduced, isPresent);
}

/** Left-side rail panel (thumbnail rail): -18px travel, 280ms. */
export function TfPanelLeft(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.aside, tfPanelLeft, props, reduced, isPresent);
}

/** Modal/sheet BACKDROP layer: opacity-only dim, 180ms. The sheet is
 *  rendered as this element's child so its grid centering survives. */
export function TfBackdrop(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfBackdrop, props, reduced, isPresent);
}

/** Modal dialog box (`.modal-dialog`): 10px rise + 0.97 swell, 240ms. */
export function TfDialog(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfDialog, props, reduced, isPresent);
}

/** Sheet dialog box (`.sheet`): identical travel to TfDialog — sheets
 *  share the dialog-enter keyframe. Kept as a separate family so a
 *  future sheet-only tuning never touches modals. */
export function TfSheet(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfDialog, props, reduced, isPresent);
}

/** Downward-opening menu popover: scale 0.96 + y -4, 180ms. */
export function TfMenu(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfMenu, props, reduced, isPresent);
}

/** Anchored popover (annotation color palette): scale 0.97 + y -3,
 *  180ms. Drag offsets are folded into x/y via `animate`. */
export function TfPopover(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfPopover, props, reduced, isPresent);
}

/** Toast chip: y 8 rise, 180ms; success gets the overshoot spring. */
export function TfToast(
  props: TfSurfaceProps & { toastKind?: string },
): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  const { toastKind, ...rest } = props;
  const isSuccess = toastKind === "success";
  const preset: TfPresetRef = isSuccess ? tfToastSuccess : tfToast;
  return applyPreset(motion.div, preset, rest, reduced, isPresent);
}

/** Floating contextual bar (edit toolbar / content action bar /
 *  image placement toolbar): y -2 rise, 180ms. */
export function TfBar(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.div, tfBar, props, reduced, isPresent);
}

/** Top-of-workspace flow bar (OCR suspects): y -6 drop, 180ms. */
export function TfBarTop(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const isPresent = useIsPresent();
  return applyPreset(motion.aside, tfBarTop, props, reduced, isPresent);
}

/* ---------------------------------------------------------------------------
 * Phase 20 — morphing surfaces (the "one element" rule)
 * ------------------------------------------------------------------------- */

export interface TfMorphProps extends TfSurfaceProps {
  /** The measured FLIP preset from useMorphPreset (null until measured).
   *  Kept after close so the exit morph still has a target. */
  morph: TfMorphPreset | null;
}

/** A menu/popover that MORPHS out of its trigger: the surface is laid out
 *  at its final rect and the enter runs as a FLIP from the trigger's rect
 *  (tfMorph), driven imperatively through animation controls because the
 *  surface's rect only exists after it has been placed. The exit is the
 *  reverse morph with `pointer-events: none` on its first frame.
 *
 *  The enter is applied in a LAYOUT effect, so the element is never painted
 *  at its final rect before the first morph frame: the call site's
 *  measurement hook re-renders synchronously (before paint) with the
 *  preset, and motion applies the FLIP transform on the same frame.
 *
 *  `data-tf-morph` drives the CSS content fade (animations.css): "in"
 *  while present, "out" once AnimatePresence starts the exit, so the
 *  surface's children fade in over the first ~40% of the morph and reverse
 *  on close. Reduced motion collapses to opacity-only, no transform.
 *
 *  useIsPresent (NOT usePresence): AnimatePresence only unmounts an exiting
 *  child once EVERY id registered with its presence context is complete.
 *  usePresence would register a second id for this wrapper that nothing
 *  ever completes, so the surface would linger in the DOM forever; the
 *  motion child below owns the exit completion. */
export function TfMorph(props: TfMorphProps): ReactElement {
  const reduced = useLiveReducedMotion();
  const controls = useAnimationControls();
  const isPresent = useIsPresent();
  const { morph, style, ...rest } = props;
  // DEF-237 — a RE-OPEN during the exit: cancel the in-flight exit morph
  // FIRST. This effect is declared before the morph effect below and runs
  // child-first, so by the time the call site's measurement hook runs the
  // exit is stopped: the measurement reads a clean layout rect AND the
  // enter's first painted frame is the trigger box (an exit still ticking
  // would push one exit/enter frame into the paint and the sampled
  // first `in` frame would already be ~18-96px along, ADV-053).
  useLayoutEffect(() => {
    if (reduced) return;
    if (!isPresent) return;
    controls.stop();
  }, [controls, isPresent, reduced]);
  useLayoutEffect(() => {
    if (reduced || morph === null) return;
    // Apply the FLIP start state in THIS commit (so the first painted
    // frame is the trigger box), then start the tween on the NEXT frame.
    // A mid-exit re-open leaves motion's frame loop already running: a
    // tween started inside this commit would be ticked before the next
    // paint, so the first painted frame after the re-open would already
    // be one tween step (~25% of the travel) past the trigger box
    // (ADV-053 measured 17-96px). One deferred frame makes the first
    // painted frame the trigger box on every open, mid-exit or not.
    controls.set(morph.initial);
    const frame = requestAnimationFrame(() => {
      void controls.start(morph.animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [controls, reduced, morph]);
  const phase = isPresent ? "in" : "out";
  // DEF-239 — the exit's discrete `pointerEvents: none` (morph.exit, and
  // the reduced branch's exit) is applied by motion one frame AFTER the
  // exit starts, leaving a ~16ms hit-testable frame at the head of every
  // close (ADV-055: 13 out-frames measured `auto`). React commits the
  // inline style below synchronously in the SAME commit that flips
  // `data-tf-morph` to "out", so the FIRST exit frame already reports
  // pointer-events: none — the DEF-087/088/090 guard. On re-open the
  // property is cleared again (a mid-exit re-open must stay clickable).
  const pointerEvents: "none" | undefined = isPresent ? undefined : "none";
  // DEF-235..238 — the exiting morph surface is inert for its whole exit
  // window, exactly like the TfBar family: the theme / titlebar / annotation
  // menus are keyboard-bearing, so a held key must not reach a stale row
  // and focus must leave the ghost.
  if (reduced) {
    // Reduced motion: the surface still appears/disappears (structure
    // unchanged) but never travels or scales.
    return (
      <motion.div
        {...rest}
        data-tf-morph={phase}
        inert={!isPresent}
        style={{ ...style, pointerEvents }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: "none" }}
        transition={{ duration: msToSeconds(MOTION_DURATION.reduced), ease: "linear" }}
      />
    );
  }
  return (
    <motion.div
      {...rest}
      data-tf-morph={phase}
      inert={!isPresent}
      style={{
        ...style,
        pointerEvents,
        ...(morph === null ? {} : { transformOrigin: morph.transformOrigin }),
      }}
      animate={controls}
      exit={morph === null ? undefined : morph.exit}
    />
  );
}