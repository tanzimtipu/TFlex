// Phase 106 (chunk B) — the Home (Orbit Desk) decorative-motion decision.
//
// The decorative violet/amber orbit layer must only drift when ALL of the
// following allow it, in this order of precedence (Home design spec):
//
//   1. the OS `prefers-reduced-motion` preference — ALWAYS wins;
//   2. the persisted `AppSettings.animationsEnabled` switch (Animations OFF);
//   3. the persisted `AppSettings.homeMotionPaused` Home pause (a separate
//      user preference, distinct from the app-wide Animations setting);
//   4. document visibility (`document.hidden` — Home scrolled away/tab
//      backgrounded);
//   5. window state: minimised (the main-process `window:minimizedChanged`
//      signal) or blurred (the window lost OS focus).
//
// A user pause (Animations OFF) is a PREFERENCE and is never overridden by a
// later visibility/focus resume; the visibility/minimise/blur conditions are
// transient suspensions that lift on their own. This module is deliberately
// React-free and side-effect free so the full truth table is unit-testable
// without a DOM or a browser.

/** The inputs to the decorative-motion decision. Every field is the raw
 *  observed state; the resolver applies the spec precedence. */
export interface OrbitMotionInput {
  /** The persisted Animations setting (`AppSettings.animationsEnabled`). */
  animationsEnabled: boolean;
  /** The persisted Home-only decorative-motion pause (`AppSettings.homeMotionPaused`). */
  homeMotionPaused: boolean;
  /** The live OS `prefers-reduced-motion` preference. */
  prefersReduced: boolean;
  /** `document.hidden` — true when the document is not visible. */
  documentHidden: boolean;
  /** The main-process minimise signal (`window:minimizedChanged`). */
  windowMinimized: boolean;
  /** True while the window has lost OS focus (a transient suspension). */
  windowBlurred: boolean;
}

/** Pure decision: may the decorative orbit drift right now? Returns false the
 *  moment any suspension condition holds; true only when every gate opens. */
export function shouldAnimateOrbit(input: OrbitMotionInput): boolean {
  if (input.prefersReduced === true) return false;
  if (input.animationsEnabled === false) return false;
  if (input.homeMotionPaused === true) return false;
  if (input.documentHidden === true) return false;
  if (input.windowMinimized === true) return false;
  if (input.windowBlurred === true) return false;
  return true;
}
