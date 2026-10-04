// Phase 100 — typography foundation.
//
// CSS source of truth: src/renderer/styles.css, the :root type scale
// (--font-sans / --font-mono / --font-ui at lines 18-25 and the --fs-* ladder
// at lines 31-39). These ARE mirrors of the CSS tokens;
// test/unit/renderer/foundationMirrors.test.ts parses styles.css and fails if
// either side drifts. Values are the CSS declaration strings, so they can be
// consumed directly in inline styles.

/** Font stacks. Mirrors --font-sans / --font-mono / --font-ui. */
export const FONT_FAMILIES = {
  sans: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", "Consolas", "SF Mono", Menlo, monospace',
  /** --font-ui is declared as var(--font-sans); mirrored verbatim so an inline
   *  `fontFamily` resolves against the live custom property. */
  ui: "var(--font-sans)",
} as const;

/** The body type scale in px. Mirrors --fs-xs..--fs-2xl. */
export const FONT_SIZES = {
  xs: 12,
  sm: 12,
  md: 13,
  lg: 15,
  xl: 18,
  "2xl": 24,
} as const;

export type FontFamily = keyof typeof FONT_FAMILIES;
export type FontSize = keyof typeof FONT_SIZES;
