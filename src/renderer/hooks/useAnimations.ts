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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type TargetAndTransition } from "motion/react";
import { applyTheme, type Theme } from "../state/theme";
import {
  getAnimationsEnabled,
  resolveMotionMode,
  subscribeAnimationsEnabled,
  type MotionMode,
} from "./motionPolicy";
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

/* ----------------------------------------------------------------------- */
/* Reduced motion — live OS setting (DEF-198)                              */
/* ----------------------------------------------------------------------- */

/** DEF-198 — motion/react's `useReducedMotion` snapshots
 *  prefers-reduced-motion into React state ONCE at first use; its
 *  module-level matchMedia listener only updates an internal ref, so a
 *  mid-session OS flip left every hook pinned to the boot-time value.
 *  This module keeps ONE shared
 *  `matchMedia("(prefers-reduced-motion: reduce)")` subscription for
 *  the whole app: the initial value is read live (boot-time reduced
 *  motion still works), and every `change` event flips the React
 *  state of each hook subscribed through `useLiveReducedMotion()`, so
 *  JS-driven springs collapse to instant state changes when the OS
 *  setting flips mid-session. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface ReducedMotionSource {
  /** The window.matchMedia function this source was created from; a
   *  different function (a test re-stub) forces a fresh subscription. */
  matchMediaFn: typeof window.matchMedia;
  mql: MediaQueryList;
  /** One setter per mounted hook; the shared listener flips them all. */
  subscribers: Set<(matches: boolean) => void>;
}

let reducedMotionSource: ReducedMotionSource | null = null;

function getReducedMotionSource(): ReducedMotionSource | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  const matchMediaFn = window.matchMedia;
  if (!reducedMotionSource || reducedMotionSource.matchMediaFn !== matchMediaFn) {
    const mql = matchMediaFn(REDUCED_MOTION_QUERY);
    const subscribers = new Set<(matches: boolean) => void>();
    mql.addEventListener("change", (e: MediaQueryListEvent): void => {
      for (const notify of subscribers) notify(e.matches);
    });
    reducedMotionSource = { matchMediaFn, mql, subscribers };
  }
  return reducedMotionSource;
}

/** Live prefers-reduced-motion value: boot-time state from the real
 *  MediaQueryList, flipped on every OS `change` event (DEF-198). */
export function useLiveReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    const source = getReducedMotionSource();
    return source ? source.mql.matches : false;
  });
  useEffect(() => {
    const source = getReducedMotionSource();
    if (!source) return undefined;
    const notify = (matches: boolean): void => setReduced(matches);
    source.subscribers.add(notify);
    // Re-sync in case the OS setting changed while no hook was mounted.
    setReduced(source.mql.matches);
    return (): void => {
      source.subscribers.delete(notify);
    };
  }, []);
  return reduced;
}

/* ----------------------------------------------------------------------- */
/* Phase 23 — effective motion (setting x OS preference)                   */
/* ----------------------------------------------------------------------- */

/** Live binding over the module-level Animations setting store. The App
 *  writes `setAnimationsEnabledPreference(...)` whenever the persisted
 *  value (or its default) changes; every mounted motion hook re-reads it
 *  through this hook, so a toggle takes effect immediately with no
 *  remount. Mirrors the `useLiveReducedMotion` subscription shape. */
export function useAnimationsEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getAnimationsEnabled());
  useEffect(() => {
    // Re-sync in case the setting changed while no hook was mounted
    // (the App writes the store before any surface mounts).
    setEnabled(getAnimationsEnabled());
    return subscribeAnimationsEnabled(setEnabled);
  }, []);
  return enabled;
}

/** The effective-motion policy as a hook (Phase 23): combines the
 *  persisted setting with the OS preference. Pure resolver lives in
 *  motionPolicy.ts and is unit-tested across the full matrix.
 *  `reducedMotion` may be passed by a caller that already read
 *  `useLiveReducedMotion()` (avoids a second subscription in the
 *  wrapper components). */
export function useEffectiveMotion(reducedMotion?: boolean): MotionMode {
  const reduced = useLiveReducedMotion();
  const enabled = useAnimationsEnabled();
  return resolveMotionMode({
    animationsEnabled: enabled,
    prefersReduced: reducedMotion ?? reduced,
  });
}

/** Convenience boolean for the motion layer: true when every animation
 *  must collapse to its instant end state. */
export function useInstantMotion(reducedMotion?: boolean): boolean {
  return useEffectiveMotion(reducedMotion) === "instant";
}

/** Opacity-only fallback shared by every hook under reduced motion AND
 *  every hook on the Phase-23 instant path (the Animations setting off):
 *  no travel, no scale — the zero-duration tween lands on the exact end
 *  state the animated path reaches. */
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
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
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
  }, [instant, options.fromScale, options.exitScale]);
}

/** Modal backdrop fade: opacity-only (Backdrop Fade In / Fade Out) at the
 *  fast band. Deliberately does NOT move — the dim layer never travels. */
export function useBackdropFadeAnimation(): MotionVariantSet {
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
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
  }, [instant]);
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
  const instant = useInstantMotion();
  const { side, mode = "docked" } = options;
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
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
  }, [instant, side, mode]);
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
  const instant = useInstantMotion();
  const { from = "above", scale = true } = options;
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
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
  }, [instant, from, scale]);
}

/* ----------------------------------------------------------------------- */
/* TFL-1589 — Page-selection surfaces (selection card / dock chip)          */
/* ----------------------------------------------------------------------- */

/** TFL-1589 — the selection surfaces' scale-fade. Same shape as
 *  `usePopAnimation({ scale: true })` (scale --motion-scale-enter 0.95 -> 1
 *  with opacity) but with NO vertical travel — the card and the dock chip
 *  must never nudge their scroll rows — and the spec's MICRO exit band
 *  (150ms) instead of the pop's fast one. Enter rides the FAST band. */
export function useSelectionPopAnimation(): MotionVariantSet {
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
    return {
      initial: { opacity: MOTION_OPACITY.hidden, scale: MOTION_SCALE.enter },
      animate: {
        opacity: MOTION_OPACITY.visible,
        scale: 1,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        scale: MOTION_SCALE.exit,
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [instant]);
}

/** TFL-1589 — the selection VALUE crossfade: the "N selected" count, the
 *  range text and the dock chip's count. Opacity-only FAST in / MICRO out,
 *  so a value change dissolves the old value while the new one materialises
 *  without the surface ever moving. */
export function useContentCrossfadeAnimation(): MotionVariantSet {
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
    return {
      initial: { opacity: MOTION_OPACITY.hidden },
      animate: {
        opacity: MOTION_OPACITY.visible,
        transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.exit },
      },
    };
  }, [instant]);
}

/* ----------------------------------------------------------------------- */
/* Command palette — Scale Fade (the Phase-36 browse-everything surface)     */
/* ----------------------------------------------------------------------- */

/** Phase 36 (chunk 4) — the Command Palette's reveal: scale
 *  --motion-scale-enter (0.95) -> 1 with opacity over the PANEL band
 *  (140ms, the shortest existing duration token — the spec's "~140ms
 *  scale/opacity"), the reverse to --motion-scale-exit on the way out.
 *  Transform + opacity only, so the palette composites: no layout is
 *  touched while it opens over the canvas.
 *
 *  Reduced motion / Animations off collapse it to the shared opacity-only
 *  zero-duration band (the same fallback every other surface uses), so the
 *  palette still mounts and closes without a transform ever animating. */
export function useCommandPaletteAnimation(): MotionVariantSet {
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
    return {
      initial: { opacity: MOTION_OPACITY.hidden, scale: MOTION_SCALE.enter },
      animate: {
        opacity: MOTION_OPACITY.visible,
        scale: 1,
        transition: { duration: msToSeconds(MOTION_DURATION.panel), ease: MOTION_EASE.enter },
      },
      exit: {
        opacity: MOTION_OPACITY.hidden,
        scale: MOTION_SCALE.exit,
        transition: { duration: msToSeconds(MOTION_DURATION.panel), ease: MOTION_EASE.exit },
        pointerEvents: "none",
      },
    };
  }, [instant]);
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
  const instant = useInstantMotion();
  const { distance = "micro" } = options;
  return useMemo<{ hover: LiftMotionProps }>(() => {
    if (instant) return { hover: {} };
    const px = distance === "small" ? MOTION_TRANSLATE.small : MOTION_TRANSLATE.micro;
    return {
      hover: {
        whileHover: { y: -px },
        whileTap: { scale: MOTION_SCALE.press },
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.standard },
      },
    };
  }, [instant, distance]);
}

/* ----------------------------------------------------------------------- */
/* Press scale — Soft Compression / Spring Return                           */

/** Press feedback for buttons and icon controls: scale to
 *  --motion-scale-press on tap, back to 1 on release, both inside the
 *  micro band (the smallest token duration; the spec's 80-100ms press
 *  maps onto it since no token exists below 150ms). */
export function useScaleAnimation(): { press: LiftMotionProps } {
  const instant = useInstantMotion();
  return useMemo<{ press: LiftMotionProps }>(() => {
    if (instant) return { press: {} };
    return {
      press: {
        whileTap: { scale: MOTION_SCALE.press },
        transition: { duration: msToSeconds(MOTION_DURATION.micro), ease: MOTION_EASE.standard },
      },
    };
  }, [instant]);
}

/* ----------------------------------------------------------------------- */
/* Tabs — Tab Materialize / Tab Dissolve                                    */

/** Document-tab variants: opacity-only on both ends (Tab Materialize in
 *  over the FAST band, Tab Dissolve out over the MICRO band) so a tab
 *  opening or closing can never move the strip. Tab Switch stays with
 *  the CSS crossfade on .tab (background/colour tokens); the active-tab
 *  indicator glide stays with its CSS keyframe. */
export function useTabVariants(): MotionVariantSet {
  const instant = useInstantMotion();
  return useMemo<MotionVariantSet>(() => {
    if (instant) return reducedVariants();
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
  }, [instant]);
}

/* ----------------------------------------------------------------------- */
/* Theme transition — Theme Crossfade                                       */

/** Pure decision helper (unit-testable): should this theme application
 *  run the 400ms crossfade? The very first apply (boot) has no previous
 *  painted theme to crossfade FROM, reduced motion collapses the
 *  crossfade to an instant flip, and the Phase-23 `instant` flag forces
 *  the same collapse when the Animations setting is OFF. */
export function shouldAnimateThemeTransition(args: {
  firstApply: boolean;
  reducedMotion: boolean;
  /** Phase 23 — the effective-motion policy resolved to the instant path
   *  (setting OFF or OS reduced). */
  instant?: boolean;
}): boolean {
  if (args.instant === true) return false;
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
  /** Phase 23 — see shouldAnimateThemeTransition. */
  instant?: boolean;
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
  const reduced = useLiveReducedMotion();
  const instant = useInstantMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  // Phase 23 — the effective-motion gate (setting OFF included). The
  // crossfade must not run when this is true, exactly like the OS
  // reduced-motion path.
  const instantRef = useRef(instant);
  instantRef.current = instant;
  const firstApplyRef = useRef(true);
  const lastAppliedRef = useRef<Theme | null>(null);
  const activeTransitionRef = useRef<{ finished?: Promise<unknown> } | null>(null);
  const timerRef = useRef<number | null>(null);

  const setTheme = useCallback((next: Theme): void => {
    // DEF-199 — identity dedupe, two guards:
    //   1. lastAppliedRef — the hook's own record of its last apply
    //      (catches the settings.changed echo of our write and a picker
    //      re-selecting the active theme, before any attribute read).
    //   2. the data-theme attribute on <html> — the ground truth of
    //      what the document actually shows. index.html presets
    //      data-theme="frosted" before any React code runs, so a boot
    //      apply that matches the preset is a no-op even on a fresh
    //      hook instance (and the attribute also survives remounts,
    //      where the closure ref would be stale).
    // Re-applying an already-shown theme would start a SECOND View
    // Transition that Chromium skips, rejecting the first transition's
    // .finished promise unhandled (renderer pageerror "Transition was
    // skipped"). The document already carries `next` — nothing to do.
    if (lastAppliedRef.current === next) return;
    if (document.documentElement.getAttribute("data-theme") === next) {
      lastAppliedRef.current = next;
      // The document already carried `next` when this apply landed
      // (boot preset or an earlier apply): the boot slot is spent, so
      // the first REAL flip still earns its crossfade.
      firstApplyRef.current = false;
      return;
    }
    lastAppliedRef.current = next;
    const firstApply = firstApplyRef.current;
    firstApplyRef.current = false;
    const doc = document as ViewTransitionDocument;
    const strategy = themeTransitionStrategy({
      hasViewTransitionApi: typeof doc.startViewTransition === "function",
      firstApply,
      reducedMotion: reducedRef.current,
      instant: instantRef.current,
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
      const transition = doc.startViewTransition(() => {
        applyTheme(next);
      }) as { finished?: Promise<unknown> } | undefined;
      // DEF-199 — hold the transition: if a faster apply starts a NEWER
      // transition, Chromium skips this one and REJECTS its .finished
      // promise. Attach a handled catch so that skip is a graceful
      // takeover (the newer transition owns the document paint) instead
      // of an unhandled renderer pageerror.
      activeTransitionRef.current = transition ?? null;
      if (transition?.finished) {
        void transition.finished.catch((): void => {
          /* Skipped by a newer theme transition — nothing to clean up. */
        });
      }
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