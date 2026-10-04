// Phase 100 — spacing foundation.
//
// CSS source of truth: src/renderer/styles.css, the canonical 8px grid
// --sp-1..--sp-6 (lines 68-73) and the named --space-* aliases (lines 163-168,
// re-pointed at --sp-*). Mirrored by
// test/unit/renderer/foundationMirrors.test.ts.

/** Canonical 8px grid in px. Mirrors --sp-1..--sp-6. */
export const SPACING = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
} as const;

/** Named rhythm in px. Mirrors the --space-* aliases (which resolve to --sp-*). */
export const SPACE = {
  micro: 4,
  small: 8,
  control: 12,
  standard: 16,
  section: 24,
  major: 32,
} as const;

export type SpacingStep = keyof typeof SPACING;
export type SpaceName = keyof typeof SPACE;
