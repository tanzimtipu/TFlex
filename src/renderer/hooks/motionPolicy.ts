// Phase 23 — effective-motion policy.
//
// The single decision point for "does motion run at all?". Two inputs:
//   - the persisted Animations setting (Preferences > Appearance),
//   - the OS `prefers-reduced-motion` preference.
//
// Contract (REQUIREMENTS Phase 23):
//   - `prefers-reduced-motion: reduce` ALWAYS wins.
//   - the setting OFF forces the instant path regardless of the OS.
//   - animations run only when the setting is ON AND the OS does not
//     ask for reduced motion.
//
// This module is deliberately React-free and side-effect free at import
// time, so the pure resolver is unit-testable without a DOM. The tiny
// module-level store mirrors the single shared matchMedia subscription
// `useLiveReducedMotion()` keeps in useAnimations.ts: the App writes the
// setting once, every mounted motion hook reads it through the React
// binding without prop-drilling through the whole tree.

/** 'animated' = full motion; 'instant' = every surface jumps to its end
 *  state (geometry unchanged, only the motion removed). */
export type MotionMode = 'animated' | 'instant';

export interface MotionPolicyInput {
  /** The persisted Animations setting (`AppSettings.animationsEnabled`). */
  animationsEnabled: boolean;
  /** The live OS preference. */
  prefersReduced: boolean;
}

/** Pure policy: instant when the setting is OFF or the OS asks for
 *  reduced motion; animated only when both allow it. */
export function resolveMotionMode(input: MotionPolicyInput): MotionMode {
  if (input.animationsEnabled === false || input.prefersReduced === true) {
    return 'instant';
  }
  return 'animated';
}

/* ----------------------------------------------------------------------- */
/* App-wide setting store (module-level, mirrors the reduced-motion source) */
/* ----------------------------------------------------------------------- */

/** Default ON — a fresh profile animates. AppSettings.animationsEnabled
 *  is `false` only when the user turned it off (a real boolean is
 *  preserved by the main-process validation; anything else falls back
 *  to the default), so `!== false` is the read rule. */
let animationsEnabled = true;
const subscribers = new Set<(enabled: boolean) => void>();

export function getAnimationsEnabled(): boolean {
  return animationsEnabled;
}

/** The App applies the setting here (and to the CSS root hook) whenever
 *  the stored value changes. Same-value writes are no-ops so a re-render
 *  never churns subscribers. */
export function setAnimationsEnabledPreference(next: boolean): void {
  const resolved = next !== false;
  if (resolved === animationsEnabled) return;
  animationsEnabled = resolved;
  for (const notify of subscribers) notify(resolved);
}

/** Subscribe to setting flips (the React binding below). Returns the
 *  unsubscribe, symmetric with the matchMedia source. */
export function subscribeAnimationsEnabled(
  notify: (enabled: boolean) => void,
): () => void {
  subscribers.add(notify);
  return (): void => {
    subscribers.delete(notify);
  };
}
