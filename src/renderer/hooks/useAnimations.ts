// Cross-theme animation hooks — the React API over the shared motion
// token system (styles/animations.css + motionTokens.ts).
//
// CONTRACT
//   1. Every hook derives ALL of its values from motionTokens (the TS
//      mirror of the CSS tokens) — no magic numbers live here.
//   2. Every hook is THEME-INDEPENDENT: light/dark/frosted receive the
//      identical timing, easing, scale and travel. Themes may only tune
//      visual channels (highlight/shadow strength), which stays in CSS.
//   3. Every hook degrades under prefers-reduced-motion: transform and
//      scale collapse to opacity-only (or nothing for hover/press), with
//      the same state change — accessibility never removes state meaning.
//   4. Variants are shaped for motion/react's variants API
//      (initial/animate/exit with per-variant transitions), so the
//      Animated* wrappers and any motion.* component can consume them
//      directly inside an AnimatePresence boundary.
//   5. Every EXIT variant pins `pointerEvents: "none"` on the first exit
//      frame (DEF-087/088/090 class guard): a closing surface can never
//      swallow a click meant for whatever is beneath it.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useReducedMotion, type TargetAndTransition } from "motion/react";
import { applyTheme, type Theme } from "../state/theme";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  MOTION_SCALE,
  MOTION_THEME_CROSSFADE,
  MOTION_THEME_CROSSFADE_GRACE,
  MOTION_TRANSLATE,
  THEME_TRANSITION_CLASS,
  msToSeconds,
} from "./motionTokens";

/** The variant triple motion/react consumes:
 *  `<motion.div variants={v} initial="initial" animate="animate" exit="exit" />`
 *  (per-variant `transition` fields make AnimatePresence pick the enter
 *  transition for `animate` and the exit transition for `exit`). The
 *  index signature matches motion's `Variants` shape. */
export interface MotionVariantSet {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  [variant: string]: TargetAndTransition;
}

/** Hover/press motion props for motion components (buttons, controls). */
export interface LiftMotionProps {
  whileHover?: TargetAndTransition;
  whileTap?: TargetAndTransition;
  transition?: TargetAndTransition["transition"];
}

/** Opacity-only fallback shared by every hook under reduced motion:
 *  no travel, no scale — just the essential state fade. */
function reducedVariants(): MotionVariantSet {
  return {
    initial: { opacity: MOTION_OPACITY.hidden },
    animate: {
      opacity: MOTION_OPACITY.visible,
      transition: { duration: msToSeconds(MOTION_DURATION.reduced), ease: "linear" },
    },
    exit: {
      opacity: MOTION_OPACITY.hidden,
      transition: { duration: msToSeconds(MOTION_DURATION.reduced), ease: "linear" },
      pointerEvents: "none",
    },
  };
}

/* ----------------------------------------------------------------------- */
/* Dialogs / modals — Bloom In / Bloom Out                                  */
/* ----------------------------------------------------------------------- */

export interface BloomOptions {
  /** Start scale (default --motion-scale-enter 0.95). */
  fromScale?: number;
  /** End scale for the exit (default --motion-scale-exit 0.98). */
  exitScale?: number;
}

/** Dialog bloom: scale 0.95 -> 1 + opacity 0 -> 1 over the STANDARD band
 *  on entry, the reverse (to the exit scale) over the FAST band on exit.
 *  The backdrop should use useBackdropFadeAnimation() so the sheet moves
 *  while the dim stays opacity-only (a moving black sheet reads as
 *  camera wobble). */
export function useBloomAnimation(options: BloomOptions = {}): MotionVariantSet {
  const reduced = useReducedMotion() === true;
  return useMemo<MotionVariantSet>(() => {
    if (reduced) return reducedVariants();
    const fromScale = options.fromScale ?? MOTION_SCALE.enter;
    const exitScale = options.exitScale ?? MOTION_SCALE.exit;
    return {
      initial: { opacity: MOTION_OPACITY.hidden, scale: fromScale },
      animate: {
        opacity: MOTION_OPACITY.visible,
        scale: 1,
        transition: { duration: msToSeconds(MOTION_DURATION.standard), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        scale: exitScale,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [reduced, options.fromScale, options.exitScale]);
}

/** Modal backdrop fade: opacity-only (Backdrop Fade In / Fade Out) at the
 *  fast band. Deliberately does NOT move — the dim layer never travels. */
export function useBackdropFadeAnimation(): MotionVariantSet {
  const reduced = useReducedMotion() === true;
  return useMemo<MotionVariantSet>(() => {
    if (reduced) return reducedVariants();
    return {
      initial: { opacity: MOTION_OPACITY.hidden },
      animate: {
        opacity: MOTION_OPACITY.visible,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [reduced]);
}

/* ----------------------------------------------------------------------- */
/* Sidebars / panels — Slide In / Slide Out                                 */

export type SlideSide = "left" | "right";
export type SlideMode = "overlay" | "docked";

export interface SlideOptions {
  /** Which edge the panel lives on: a LEFT panel slides in from the
   *  left (negative x), a RIGHT panel from the right (positive x). */
  side: SlideSide;
  /** overlay = drawer travelling its full width (x: -100% -> 0);
   *  docked = rail that shares the layout, travelling only the
   *  --motion-translate-panel distance so the page view never jumps. */
  mode?: SlideMode;
}

/** Panel slide: 280ms ease-out entry over the full overlay travel (or the
 *  docked 24px nudge), 200ms ease-out-exit on close. */
export function useSlideAnimation(options: SlideOptions): MotionVariantSet {
  const reduced = useReducedMotion() === true;
  const { side, mode = "docked" } = options;
  return useMemo<MotionVariantSet>(() => {
    if (reduced) return reducedVariants();
    const sign = side === "left" ? -1 : 1;
    // Overlay drawers travel their full width (x: -100% / +100% by side);
    // docked rails travel only the --motion-translate-panel distance.
    const travel: number | string =
      mode === "overlay" ? (sign < 0 ? "-100%" : "100%") : MOTION_TRANSLATE.panel * sign;
    return {
      initial: { opacity: MOTION_OPACITY.hidden, x: travel },
      animate: {
        opacity: MOTION_OPACITY.visible,
        x: 0,
        transition: { duration: msToSeconds(MOTION_DURATION.panel), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        x: travel,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [reduced, side, mode]);
}

/* ----------------------------------------------------------------------- */
/* Popovers / menus / dropdowns — Pop In / Pop Out / Drop Reveal            */

export interface PopOptions {
  /** "above" drops the surface DOWN onto its anchor (dropdown/menu under
   *  a trigger, y from -4px); "below" rises (bottom-anchored palette). */
  from?: "above" | "below";
  /** Include the scale component (Pop In) or travel only (Drop Reveal). */
  scale?: boolean;
}

/** Popover/dropdown reveal: scale (optional) + a --motion-translate-small
 *  drop + opacity over the FAST band. Exit reverses with the exit ease. */
export function usePopAnimation(options: PopOptions = {}): MotionVariantSet {
  const reduced = useReducedMotion() === true;
  const { from = "above", scale = true } = options;
  return useMemo<MotionVariantSet>(() => {
    if (reduced) return reducedVariants();
    const dir = from === "above" ? -1 : 1;
    const enterScale = scale ? MOTION_SCALE.enter : undefined;
    const exitScale = scale ? MOTION_SCALE.exit : undefined;
    return {
      initial: {
        opacity: MOTION_OPACITY.hidden,
        y: dir * MOTION_TRANSLATE.small,
        ...(enterScale !== undefined ? { scale: enterScale } : {}),
      },
      animate: {
        opacity: MOTION_OPACITY.visible,
        y: 0,
        scale: 1,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        y: dir * MOTION_TRANSLATE.micro,
        ...(exitScale !== undefined ? { scale: exitScale } : {}),
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [reduced, from, scale]);
}

/* ----------------------------------------------------------------------- */
/* Hover lift — Luminous Hover / Thumbnail Lift                             */

export interface LiftOptions {
  /** "micro" = 2px (buttons, icons); "small" = 4px (thumbnails). */
  distance?: "micro" | "small";
}

/** Hover lift props for a motion component. Pure movement + elevation:
 *  the highlight/colour wash stays in CSS (a theme visual channel).
 *  Disabled under reduced motion — the colour wash already communicates
 *  hover, movement does not need to. */
export function useLiftAnimation(
  options: LiftOptions = {},
): { hover: LiftMotionProps } {
  const reduced = useReducedMotion() === true;
  const { distance = "micro" } = options;
  return useMemo<{ hover: LiftMotionProps }>(() => {
    if (reduced) return { hover: {} };
    const px = distance === "small" ? MOTION_TRANSLATE.small : MOTION_TRANSLATE.micro;
    return {
      hover: {
        whileHover: { y: -px },
        whileTap: { scale: MOTION_SCALE.press },
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.standard },
      },
    };
  }, [reduced, distance]);
}

/* ----------------------------------------------------------------------- */
/* Press scale — Soft Compression / Spring Return                           */

/** Press feedback for buttons and icon controls: scale to
 *  --motion-scale-press on tap, back to 1 on release, both inside the
 *  micro band (the smallest token duration; the spec's 80-100ms press
 *  maps onto it since no token exists below 150ms). */
export function useScaleAnimation(): { press: LiftMotionProps } {
  const reduced = useReducedMotion() === true;
  return useMemo<{ press: LiftMotionProps }>(() => {
    if (reduced) return { press: {} };
    return {
      press: {
        whileTap: { scale: MOTION_SCALE.press },
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.standard },
      },
    };
  }, [reduced]);
}

/* ----------------------------------------------------------------------- */
/* Tabs — Tab Materialize / Tab Dissolve                                    */

/** Document-tab variants: opacity-only on both ends (Tab Materialize in
 *  over the FAST band, Tab Dissolve out over the MICRO band) so a tab
 *  opening or closing can never move the strip. Tab Switch stays with
 *  the CSS crossfade on .tab (background/colour tokens); the active-tab
 *  indicator glide stays with its CSS keyframe. */
export function useTabVariants(): MotionVariantSet {
  const reduced = useReducedMotion() === true;
  return useMemo<MotionVariantSet>(() => {
    if (reduced) return reducedVariants();
    return {
      initial: { opacity: MOTION_OPACITY.hidden },
      animate: {
        opacity: MOTION_OPACITY.visible,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [reduced]);
}

/* ----------------------------------------------------------------------- */
/* Theme transition — Theme Crossfade                                       */

/** Pure decision helper (unit-testable): should this theme application
 *  run the 400ms crossfade? The very first apply (boot) has no previous
 *  painted theme to crossfade FROM, and reduced motion collapses the
 *  crossfade to an instant flip. */
export function shouldAnimateThemeTransition(args: {
  firstApply: boolean;
  reducedMotion: boolean;
}): boolean {
  return !args.firstApply && !args.reducedMotion;
}

/** Which mechanism a non-boot theme apply should use (DEF-195).
 *  Pure decision helper (unit-testable):
 *  - "instant": boot apply or reduced motion — flip with no animation.
 *  - "view-transition": document.startViewTransition exists (Electron
 *    Chromium) — the browser snapshots old paint, applies the theme in
 *    ONE synchronous recalc and crossfades the two snapshots on the
 *    compositor. No per-element transition list is touched, so the
 *    crossfade holds 60fps even on huge documents.
 *  - "class-crossfade": fallback — the .tf-theme-transitioning class on
 *    <html> transitions six colour properties per element (see
 *    styles/animations.css). */
export type ThemeTransitionStrategy = "instant" | "view-transition" | "class-crossfade";

export function themeTransitionStrategy(args: {
  hasViewTransitionApi: boolean;
  firstApply: boolean;
  reducedMotion: boolean;
}): ThemeTransitionStrategy {
  if (!shouldAnimateThemeTransition(args)) return "instant";
  return args.hasViewTransitionApi ? "view-transition" : "class-crossfade";
}

/** Minimal structural type for the View Transitions API entry point. */
type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => unknown;
};

export interface ThemeTransitionApi {
  /** Apply a theme, crossfading app colours over --motion-theme-crossfade
   *  (400ms) unless this is the boot apply or the OS asks for reduced
   *  motion. The PDF page surfaces are excluded on the CSS side, so the
   *  document never tints or fades. */
  setTheme: (next: Theme) => void;
}

/** Theme-crossfade controller. The class goes on <html> in the SAME
 *  style recalc as the data-theme flip (no flash frame), and comes off
 *  after the crossfade + grace period so per-element hover/press
 *  transitions take over again. Re-triggering mid-crossfade restarts the
 *  timer instead of stacking classes. */
export function useThemeTransition(): ThemeTransitionApi {
  const reduced = useReducedMotion() === true;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const firstApplyRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const setTheme = useCallback((next: Theme): void => {
    const firstApply = firstApplyRef.current;
    firstApplyRef.current = false;
    const doc = document as ViewTransitionDocument;
    const strategy = themeTransitionStrategy({
      hasViewTransitionApi: typeof doc.startViewTransition === "function",
      firstApply,
      reducedMotion: reducedRef.current,
    });
    if (strategy === "instant") {
      applyTheme(next);
      return;
    }
    if (strategy === "view-transition") {
      // DEF-195 primary path: compositor snapshot crossfade. The theme
      // flip runs inside the API's update callback (one synchronous
      // style recalc between the two snapshots — no flash frame), and
      // no transitioning class is ever applied, so no per-element
      // transition list and no cleanup timer exist on this path.
      doc.startViewTransition(() => {
        applyTheme(next);
      });
      return;
    }
    // Fallback path: class-based per-element colour crossfade.
    const root = document.documentElement;
    root.classList.add(THEME_TRANSITION_CLASS);
    applyTheme(next);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(
      () => {
        root.classList.remove(THEME_TRANSITION_CLASS);
        timerRef.current = null;
      },
      MOTION_THEME_CROSSFADE + MOTION_THEME_CROSSFADE_GRACE,
    );
  }, []);

  // Unmount hygiene: kill the pending timer and drop the class so a torn
  //-down app never leaves a half-transitioned document behind.
  useEffect(() => {
    return (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
    };
  }, []);

  return useMemo(() => ({ setTheme }), [setTheme]);
}