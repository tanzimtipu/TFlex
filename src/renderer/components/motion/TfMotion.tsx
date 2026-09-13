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
  type HTMLMotionProps,
  type TargetAndTransition,
  type Transition,
  type VariantLabels,
} from "motion/react";
import { useLiveReducedMotion } from "../../hooks/useAnimations";
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
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { type: "tween", duration: 0, ease: "linear" },
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
): ReactElement {
  const mp = useTfPreset(preset, props, reduced);
  return (
    <Tag
      {...props}
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
  return applyPreset(motion.aside, tfPanel, props, reduced);
}

/** Left-side rail panel (thumbnail rail): -18px travel, 280ms. */
export function TfPanelLeft(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.aside, tfPanelLeft, props, reduced);
}

/** Modal/sheet BACKDROP layer: opacity-only dim, 180ms. The sheet is
 *  rendered as this element's child so its grid centering survives. */
export function TfBackdrop(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfBackdrop, props, reduced);
}

/** Modal dialog box (`.modal-dialog`): 10px rise + 0.97 swell, 240ms. */
export function TfDialog(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfDialog, props, reduced);
}

/** Sheet dialog box (`.sheet`): identical travel to TfDialog — sheets
 *  share the dialog-enter keyframe. Kept as a separate family so a
 *  future sheet-only tuning never touches modals. */
export function TfSheet(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfDialog, props, reduced);
}

/** Downward-opening menu popover: scale 0.96 + y -4, 180ms. */
export function TfMenu(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfMenu, props, reduced);
}

/** Anchored popover (annotation color palette): scale 0.97 + y -3,
 *  180ms. Drag offsets are folded into x/y via `animate`. */
export function TfPopover(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfPopover, props, reduced);
}

/** Toast chip: y 8 rise, 180ms; success gets the overshoot spring. */
export function TfToast(
  props: TfSurfaceProps & { toastKind?: string },
): ReactElement {
  const reduced = useLiveReducedMotion();
  const { toastKind, ...rest } = props;
  const isSuccess = toastKind === "success";
  const preset: TfPresetRef = isSuccess ? tfToastSuccess : tfToast;
  return applyPreset(motion.div, preset, rest, reduced);
}

/** Floating contextual bar (edit toolbar / content action bar /
 *  image placement toolbar): y -2 rise, 180ms. */
export function TfBar(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.div, tfBar, props, reduced);
}

/** Top-of-workspace flow bar (OCR suspects): y -6 drop, 180ms. */
export function TfBarTop(props: TfSurfaceProps): ReactElement {
  const reduced = useLiveReducedMotion();
  return applyPreset(motion.aside, tfBarTop, props, reduced);
}