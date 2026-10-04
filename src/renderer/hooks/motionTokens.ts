// Cross-theme animation system — the TS mirror of the CSS motion tokens.
//
// styles/animations.css is the single source of truth for every motion
// value in the app (durations, easings, scales, travel distances). CSS
// custom properties cannot be read by motion/react's JS-driven springs
// and tweens, so this module mirrors the SAME values for the animation
// hooks. The pairing is enforced by test/unit/renderer/animationsTokens.test.ts,
// which parses animations.css and asserts every constant below matches —
// neither side may drift.

/** Motion durations in milliseconds. Mirrors --motion-duration-*. */
export const MOTION_DURATION = {
  micro: 150,
  fast: 200,
  /** Phase 20 — morphing surfaces: the surface's CONTENT fade, timed to
   *  the first ~40% of the fast band (the box itself morphs over `fast`).
   *  Existing tokens cannot express a sub-band fraction, so this is its
   *  own token rather than a literal. */
  content: 80,
  standard: 250,
  panel: 140,
  layout: 350,
  /** Ambient sweeps: the frosted-glass reflection band (--motion-duration-sheen
   *  / -sheen-slow) and the loading-placeholder shimmer (--motion-duration-shimmer).
   *  Decorative CSS-only loops; mirrored here so the CSS↔TS contract stays one
   *  source. */
  sheen: 7000,
  sheenSlow: 9000,
  shimmer: 1400,
  /** Tooltip hover dwell (--motion-duration-dwell): the delay before the
   *  tooltip entrance runs. */
  dwell: 300,
  /** The canonical no-motion duration (prefers-reduced-motion). */
  reduced: 0,
} as const;

/** Motion/react tween `duration` fields are SECONDS while the CSS tokens
 *  (and every spec number in the motion catalog) are MILLISECONDS.
 *  Convert once, here, so no hook ever passes a raw token count as a
 *  duration (200ms would become a 200-SECOND tween — the exact bug this
 *  helper exists to prevent). */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}

/** Theme crossfade duration in ms. Mirrors --motion-theme-crossfade. */
export const MOTION_THEME_CROSSFADE = 400;

/** Small grace period AFTER the crossfade before the transitioning class
 *  is removed, so the last interpolation frames never snap mid-flight. */
export const MOTION_THEME_CROSSFADE_GRACE = 50;

/** Motion easings as cubic-bezier arrays for motion/react.
 *  Mirrors --motion-ease-*. */
export const MOTION_EASE = {
  standard: [0.4, 0, 0.2, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
  layout: [0.4, 0, 0.2, 1],
  /** DEF-240 — the docked panel/page slide settle curve (Phase 14.2),
   *  registered as a canonical token so the legacy --panel-slide-ease
   *  alias and this mirror stay one source. */
  panel: [0.16, 1, 0.3, 1],
} as const;

/** Motion scales. Mirrors --motion-scale-*. */
export const MOTION_SCALE = {
  press: 0.97,
  enter: 0.95,
  exit: 0.98,
} as const;

/** Travel distances in px. Mirrors --motion-translate-*. */
export const MOTION_TRANSLATE = {
  micro: 2,
  small: 4,
  panel: 24,
} as const;

/** Opacity poles. Mirrors --motion-opacity-*. */
export const MOTION_OPACITY = {
  hidden: 0,
  visible: 1,
  /** Phase 20 — morphing surfaces start just short of opaque: the box is
   *  already a solid, recognisable surface (so the "one element growing"
   *  read survives) instead of a second window fading in from nothing. */
  surface: 0.85,
} as const;

/** Class the theme-crossfade machinery puts on <html> for the duration
 *  of a theme switch. The CSS side (animations.css) keys the color
 *  interpolation on this class and excludes the PDF surfaces. */
export const THEME_TRANSITION_CLASS = "tf-theme-transitioning";