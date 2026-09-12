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
  standard: 250,
  panel: 280,
  layout: 350,
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
} as const;

/** Class the theme-crossfade machinery puts on <html> for the duration
 *  of a theme switch. The CSS side (animations.css) keys the color
 *  interpolation on this class and excludes the PDF surfaces. */
export const THEME_TRANSITION_CLASS = "tf-theme-transitioning";