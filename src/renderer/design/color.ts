// Phase 100 — colour foundation.
//
// CSS source of truth: src/renderer/styles.css, the semantic colour roles
// declared in all three theme scopes (:root, :root[data-theme="dark"],
// :root[data-theme="frosted"]). This module maps ROLE NAMES to their CSS
// custom-property NAMES only — never to values — so no hex is duplicated here.
// Three-scope parity is pinned by
// test/unit/renderer/foundationMirrors.test.ts.

/** Semantic / accent colour roles -> CSS custom-property names. */
export const COLOR_ROLES = {
  primary: "--sem-primary",
  neutral: "--sem-neutral",
  affirmative: "--sem-affirmative",
  attention: "--sem-attention",

  accent: "--accent",
  accentHover: "--accent-hover",
  accentPressed: "--accent-pressed",
  accentSoft: "--accent-soft",
  accentSelected: "--accent-selected",
  accentPressedSoft: "--accent-pressed-soft",
  accentHoverBg: "--accent-hover-bg",

  info: "--info",
  infoSoft: "--info-soft",
  success: "--success",
  successSoft: "--success-soft",
  warning: "--warning",
  warningSoft: "--warning-soft",
  error: "--error",
  errorSoft: "--error-soft",
} as const;

export type ColorRole = keyof typeof COLOR_ROLES;

/** The `var(--...)` expression for a role, for inline styles. */
export function colorVar(role: ColorRole): string {
  return `var(${COLOR_ROLES[role]})`;
}
