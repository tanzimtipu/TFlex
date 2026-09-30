// Phase 69 (feature B) - the JOVREL "Halo" loading ring.
//
// An inline-SVG spinning ring using the SAME arc + leading-dot geometry as
// BrandMark, but WITHOUT the near-black tile so it reads on any surface
// (toolbar pill, dialog body, print-window banner, light/frosted/ dark).
// The arc carries the brand gradient; the dot colour is theme-aware through
// the `--brand-loader-dot` token (white on dark, `#7C3AED` on light and
// frosted), so one component follows every theme.
//
// Rotation is owned by the caller's class (`.update-indicator-spin`,
// `.update-prompt-spinner`, `.conversion-progress-icon`) so the Phase 15
// motion tokens and their shared `@keyframes` are reused - there is no
// bespoke timing here. As with BrandMark, every instance mints its own
// sanitized `useId()` gradient id so mounted loaders never fight over one
// global SVG `id`.

import { useId, type ReactElement } from "react";

export interface BrandLoaderProps {
  /** Rendered square size in px. */
  size?: number;
  /** Extra class names for the `<svg>` element (carries the spin animation). */
  className?: string;
}

export function BrandLoader({ size = 16, className }: BrandLoaderProps): ReactElement {
  const raw = useId();
  const gradientId = `jovrel-loader-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const classes = className !== undefined ? `brand-loader ${className}` : "brand-loader";
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={classes}
      aria-hidden
      data-brand-loader
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(251, 191, 36)" />
          <stop offset="0.5" stopColor="rgb(236, 72, 153)" />
          <stop offset="1" stopColor="rgb(139, 92, 246)" />
        </linearGradient>
      </defs>
      <path
        d="M 324.8 167.7 A 120.0 120.0 0 1 1 215.0 153.2"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={27}
        strokeLinecap="round"
      />
      <circle cx="272.7" cy="147.2" r="20.4" fill="var(--brand-loader-dot, #7C3AED)" />
    </svg>
  );
}
