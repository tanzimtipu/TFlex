// Phase 100 — corner-radius foundation.
//
// CSS source of truth: src/renderer/styles.css, the --radius-1..--radius-3
// density ladder (lines 141-143) and the named hierarchy radii
// --radius-window/-panel/-group/-control/-pill (lines 184-188). The
// --tf-radius-* family is re-pointed at these canonical tokens as aliases.
// Mirrored by test/unit/renderer/foundationMirrors.test.ts.

/** Small-radius density ladder in px. Mirrors --radius-1..--radius-3. */
export const RADII = {
  1: 3,
  2: 5,
  3: 8,
} as const;

/** Named hierarchy radii in px.
 *  Mirrors --radius-window/-panel/-group/-control/-pill. */
export const RADIUS = {
  window: 8,
  panel: 16,
  group: 12,
  control: 10,
  pill: 9999,
} as const;

export type RadiusStep = keyof typeof RADII;
export type RadiusName = keyof typeof RADIUS;
