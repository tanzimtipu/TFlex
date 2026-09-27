// Phase 49 - the JOVREL wordmark.
//
// The brand sheet uses a bold sans for "Jovrel". The app already ships Inter,
// so the wordmark is styled text in the app's own font rather than an image -
// it inherits `currentColor`, which is how it follows the theme's foreground
// token (the brand's light-bg and dark-bg variants collapse into that one
// rule). Callers set the colour context: `.brand` in the title bar already
// carries `--fg-strong`, and `.about-name` / `.accounts-brand-name` override
// it per surface.

import type { ReactElement } from "react";

export interface BrandWordmarkProps {
  /** Extra class names for the wordmark span. */
  className?: string;
}

export function BrandWordmark({ className }: BrandWordmarkProps): ReactElement {
  const classes = className !== undefined ? `brand-wordmark ${className}` : "brand-wordmark";
  return <span className={classes}>Jovrel</span>;
}