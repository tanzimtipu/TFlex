// Phase 119 — the ONE shared layout / breakpoint foundation for the Adaptive
// Shell phase.
//
// CSS source of truth: src/renderer/styles.css, the canonical `:root` block
// (the `--tf-*` layout tokens beside --sp-1..--sp-6). Mirroring the spacing
// foundation: the TS module is the typed mirror a feature imports, and every
// value here is duplicated in the token layer for the CSS side to consume.
// test/unit/renderer/foundationMirrors.test.ts pins the pairing.

/**
 * Logical pixels honoring Windows text / display scaling. These are mirrored
 * into styles.css and are deliberately scale-aware: every value below is a
 * logical CSS pixel measured against native DPI, never a physical/screenshot
 * pixel count.
 */
export const LAYOUT = {
  fineTargetPx: 32,
  coarseTargetPx: 44,
  controlRadiusPx: 9,
  surfaceRadiusPx: 14,
  motionMs: 140,
  railMinTabPx: 148,
  railOverflowMinTabs: 3,
  dockOverflowMinItems: 4,
  panelLeftMinPx: 240,
  panelLeftMaxPx: 420,
  panelRightMinPx: 260,
  panelRightMaxPx: 380,
} as const;

// Logical CSS pixels measured against native DPI; these are NOT
// screenshot-pixel constants.
export const BREAKPOINTS = {
  narrow: 900,
  compact: 720,
  tight: 520,
} as const;

// Phase 119 - the workspace shed-chrome ladder thresholds, sourced from the ONE layout foundation (widest first).
export const LAYOUT_LADDER = { inspectorPx: 1200, panelPx: 1000, labelsPx: 880, arrowsPx: 720 } as const;

export type LayoutClass = "wide" | "narrow" | "compact" | "tight";

/**
 * Resolve the layout class for a measured document-viewport width. Thresholds
 * are inclusive: a width exactly on a breakpoint belongs to the narrower class
 * (900 -> "narrow", 720 -> "compact", 520 -> "tight").
 */
export function classifyViewport(width: number): LayoutClass {
  if (width <= BREAKPOINTS.tight) return "tight";
  if (width <= BREAKPOINTS.compact) return "compact";
  if (width <= BREAKPOINTS.narrow) return "narrow";
  return "wide";
}

/** Whether the primary pointing device is coarse (touch / pen). */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}
