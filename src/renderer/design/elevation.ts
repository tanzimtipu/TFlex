// Phase 100 — elevation / shadow foundation.
//
// CSS source of truth: src/renderer/styles.css, the --elevation-1..4 ladder
// (lines 527-530) and its named --shadow-* roles (lines 532-536). Values are
// the light :root defaults; dark and frosted override the same tokens per
// theme. Mirrored by test/unit/renderer/foundationMirrors.test.ts.

/** The four-step depth ladder. Mirrors --elevation-1..4 (:root values). */
export const ELEVATION = {
  1: "0 4px 18px rgba(15, 23, 42, 0.14)",
  2: "0 2px 8px rgba(15, 23, 42, 0.10), 0 8px 24px rgba(15, 23, 42, 0.12)",
  3: "0 4px 16px rgba(15, 23, 42, 0.14), 0 12px 40px rgba(15, 23, 42, 0.18)",
  4: "0 4px 12px rgba(15, 23, 42, 0.14), 0 2px 4px rgba(15, 23, 42, 0.08)",
} as const;

/** Named-surface roles -> ladder token.
 *  Mirrors --shadow-page/menu/dialog/popover/toast. */
export const SHADOW_ROLE = {
  page: "var(--elevation-1)",
  menu: "var(--elevation-2)",
  dialog: "var(--elevation-3)",
  popover: "var(--elevation-2)",
  toast: "var(--elevation-4)",
} as const;

export type ElevationStep = keyof typeof ELEVATION;
export type ShadowRole = keyof typeof SHADOW_ROLE;
