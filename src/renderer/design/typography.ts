// Phase 100 / Phase 110 - typography foundation.
//
// CSS source of truth: src/renderer/styles.css. Phase 110 introduces the
// "Quiet Precision" semantic type scale in :root as the eight --type-* role
// tokens (family / size / line-height / weight), repoints every legacy
// --fs-* / --tf-label-* / --dlg-* / --dock-* token at a role, and sets
// --font-sans / --font-ui to the Segoe UI Variable stack. These ARE mirrors of
// the CSS tokens; test/unit/renderer/foundationMirrors.test.ts and
// test/unit/renderer/phase110_typographyScale.test.ts parse styles.css and fail
// if either side drifts. Font-stack values are the CSS declaration strings, so
// they can be consumed directly in inline styles; size/line/weight values are
// numbers (px) so a feature can compute with them.

/** Font stacks. Mirrors --font-sans / --font-mono / --font-ui. */
export const FONT_FAMILIES = {
  /** --font-sans is declared as var(--type-family); mirrored verbatim so an
   *  inline `fontFamily` resolves against the live custom property. */
  sans: "var(--type-family)",
  mono: 'ui-monospace, "Cascadia Code", "Consolas", "SF Mono", Menlo, monospace',
  /** --font-ui is declared as var(--type-family); mirrored verbatim. */
  ui: "var(--type-family)",
} as const;

/** The legacy body type scale in px. Mirrors the --fs-* ladder, which now
 *  aliases the semantic roles: xs/sm=12, md=13, lg=16, xl=18, 2xl=32. */
export const FONT_SIZES = {
  xs: 12,
  sm: 12,
  md: 13,
  lg: 16,
  xl: 18,
  "2xl": 32,
} as const;

/**
 * The eight Quiet Precision semantic roles in px. Mirrors the --type-* tokens
 * (Visual overhaul/Design System/typography.tokens.json). The home role also
 * carries a constrained variant at the narrow breakpoint
 * (--type-home-size-constrained 28 / --type-home-line-constrained 34).
 */
export const TYPE_ROLES = {
  home: { size: 32, lineHeight: 38, weight: 500 },
  title: { size: 18, lineHeight: 25, weight: 500 },
  panel: { size: 16, lineHeight: 22, weight: 500 },
  body: { size: 14, lineHeight: 22, weight: 400 },
  row: { size: 13, lineHeight: 20, weight: 500 },
  label: { size: 12, lineHeight: 17, weight: 500 },
  helper: { size: 12, lineHeight: 18, weight: 400 },
  compact: { size: 11, lineHeight: 16, weight: 500 },
} as const;

export type FontFamily = keyof typeof FONT_FAMILIES;
export type FontSize = keyof typeof FONT_SIZES;
export type TypeRole = keyof typeof TYPE_ROLES;
