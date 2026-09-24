// Phase 37 (items 2 + 6) — the Action Dock's ONE responsive controller.
//
// REQUIREMENTS.md rules the dock is ALWAYS ONE ROW and that the workspace
// sheds chrome as the window shrinks, in this exact order:
//
//   (1) collapse the Inspector
//   (2) collapse the thumbnail panel
//   (3) hide the dock verbs' labels
//   (4) shrink the dock and show left/right ARROW controls to scroll the verbs
//
// Growing the window reverses the ladder. The four rungs are derived from ONE
// measured width so they can never disagree or fire out of order: a narrower
// window is always a strict subset of the rungs the wider window had.
//
// WHY THE WIDTH IS THE VIEWPORT, NOT THE POST-COLLAPSE CANVAS. Rungs 1 and 2
// themselves WIDEN the canvas (the Inspector's inset goes to 0, the rail shrinks
// to its strip). A ladder keyed on that moving canvas would oscillate: at 1100px
// it collapses the Inspector, the canvas grows past the rung, it expands again,
// the canvas shrinks, and so on. The controller therefore keys on the measured
// WORKSPACE width — the window content box the app actually has before any of
// the ladder's own outputs apply. That value only the user's window can change,
// so the ladder is stable by construction.
//
// The breakpoints are calibrated for the supported 640..1920 dialog range:
// at 1920 nothing is shed; at 640 all four rungs are engaged and the dock is a
// scrolling, icon-only single row with arrows.

/** The four ladder thresholds, widest first. A width STRICTLY below a
 *  threshold engages that rung and every rung after it. */
export const DOCK_LADDER_BREAKPOINTS = {
  /** Below this the Inspector collapses (rung 1). */
  inspector: 1200,
  /** Below this the thumbnail panel collapses (rung 2). */
  panel: 1000,
  /** Below this the dock's verb labels are hidden (rung 3). */
  labels: 880,
  /** Below this the dock shrinks and shows its scroll arrows (rung 4). */
  arrows: 720,
} as const;

/** The rungs in the spec's shrink order, with the width each engages at. */
export const DOCK_LADDER_ORDER: ReadonlyArray<{
  rung: keyof typeof DOCK_LADDER_BREAKPOINTS;
  below: number;
}> = [
  { rung: 'inspector', below: DOCK_LADDER_BREAKPOINTS.inspector },
  { rung: 'panel', below: DOCK_LADDER_BREAKPOINTS.panel },
  { rung: 'labels', below: DOCK_LADDER_BREAKPOINTS.labels },
  { rung: 'arrows', below: DOCK_LADDER_BREAKPOINTS.arrows },
];

/** The workspace's shed-chrome state at a measured width. */
export interface DockLadder {
  /** Rung 1 — the Inspector's responsive collapse signal. */
  inspectorCollapsed: boolean;
  /** Rung 2 — the thumbnail panel's responsive collapse signal. */
  panelCollapsed: boolean;
  /** Rung 3 — render the dock's verbs icon-only. */
  iconOnly: boolean;
  /** Rung 4 — shrink the dock and show the left/right scroll arrows. */
  arrows: boolean;
}

/**
 * Resolve the ladder at `width`. Monotonic by construction: each rung's
 * threshold is strictly narrower than the previous, so `resolveDockLadder(w)`
 * for a shrinking `w` only ever turns rungs ON, and growing only turns them
 * OFF (the spec's "reverse when growing").
 */
export function resolveDockLadder(width: number): DockLadder {
  return {
    inspectorCollapsed: width < DOCK_LADDER_BREAKPOINTS.inspector,
    panelCollapsed: width < DOCK_LADDER_BREAKPOINTS.panel,
    iconOnly: width < DOCK_LADDER_BREAKPOINTS.labels,
    arrows: width < DOCK_LADDER_BREAKPOINTS.arrows,
  };
}

/** True when `ladder` is the widest possible state (nothing shed). */
export function isDockLadderIdle(ladder: DockLadder): boolean {
  return (
    !ladder.inspectorCollapsed &&
    !ladder.panelCollapsed &&
    !ladder.iconOnly &&
    !ladder.arrows
  );
}

/**
 * Phase 37 (item 3) — the Inspector's EFFECTIVE collapse state: the user's own
 * preference OR the ladder's rung 1. This is the ONE precedence rule, the same
 * `userCollapsed || rung` pattern the thumbnail panel uses. The ladder never
 * writes the persisted preference, and a manual expand while the ladder is
 * engaged changes nothing visible until the window grows past the rung — the
 * two signals can never fight because the effective value is a pure OR.
 */
export function inspectorCollapsedFor(
  userCollapsed: boolean,
  ladder: DockLadder,
): boolean {
  return userCollapsed || ladder.inspectorCollapsed;
}

/**
 * DEF-335 — the user preference the surface's collapse control records on a
 * click, given the EFFECTIVE state the control currently renders.
 *
 * The control's label follows the effective state (`userCollapsed || rung`).
 * When the ladder is forcing the collapse, the control reads "Expand", so the
 * click must record the EXPAND intent (`false`) - never toggle the raw user
 * preference, which is `false` already and would latch it to `true`, leaving
 * the surface collapsed after the window grows past the rung. At a
 * ladder-idle width the effective value equals the preference, so this is a
 * plain both-ways toggle.
 */
export function collapsePreferenceAfterToggle(effectiveCollapsed: boolean): boolean {
  return !effectiveCollapsed;
}
