// Phase 69 (feature B) - the JOVREL "Halo" brand mark.
//
// The product is JOVREL (the project stays TFlex). This component is the
// INLINE React SVG of the shipped asset `assets/brand/jovrel-mark.svg`: the
// Halo identity - a near-black squircle tile carrying an amber -> pink ->
// violet gradient ring with a leading white dot. It is INLINE on purpose - a
// file reference would be lost from the packaged app.
//
// UNIQUE GRADIENT ID: an SVG `id` is global to the document, and two mounted
// marks sharing `id="tile"` would fight over the same gradient (and, once the
// first unmounts, the survivor would lose its stroke). Every instance
// therefore mints its own id with React's `useId()` (sanitized to
// alphanumerics so the value is safe in a `url(#...)` reference) - no shared
// `<defs>`, no global registry, and any number of marks can mount in any order.

import { useId, type ReactElement } from "react";

export interface BrandMarkProps {
  /** Rendered square size in px. The 512x512 viewBox scales losslessly, so
   *  the mark stays crisp at the small title-bar sizes (18px) and up. */
  size?: number;
  /** Extra class names for the `<svg>` element. */
  className?: string;
  /** Accessible label. When omitted the mark is decorative (`aria-hidden`),
   *  which is the right call whenever a BrandWordmark sits beside it. */
  title?: string;
}

export function BrandMark({ size = 18, className, title }: BrandMarkProps): ReactElement {
  const raw = useId();
  const gradientId = `jovrel-halo-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const labelled = title !== undefined;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      data-brand-mark
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(251, 191, 36)" />
          <stop offset="0.5" stopColor="rgb(236, 72, 153)" />
          <stop offset="1" stopColor="rgb(139, 92, 246)" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="115" fill="rgb(15, 10, 20)" />
      <path
        d="M 324.8 167.7 A 120.0 120.0 0 1 1 215.0 153.2"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={27}
        strokeLinecap="round"
      />
      <circle cx="272.7" cy="147.2" r="20.4" fill="#fff" />
    </svg>
  );
}
