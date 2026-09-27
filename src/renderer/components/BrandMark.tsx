// Phase 49 - the JOVREL brand mark.
//
// The product is JOVREL (the project stays TFlex). This component is the
// INLINE React SVG of the shipped asset `assets/brand/jovrel-mark.svg`: a
// blue squircle tile (gradient #60A5FA -> #1E3A8A) carrying a white
// triple-stroke "J". It is INLINE on purpose - a file reference would be
// lost from the packaged app.
//
// UNIQUE GRADIENT ID: an SVG `id` is global to the document, and two mounted
// marks sharing `id="tile"` would fight over the same gradient (and, once the
// first unmounts, the survivor would lose its fill). Every instance therefore
// mints its own id with React's `useId()` (sanitized to alphanumerics so the
// value is safe in a `url(#...)` reference) - no shared `<defs>`, no global
// registry, and any number of marks can mount in any order.

import { useId, type ReactElement } from "react";

export interface BrandMarkProps {
  /** Rendered square size in px. The 1024x1024 viewBox scales losslessly,
   *  so the mark stays crisp at the small title-bar sizes (18px) and up. */
  size?: number;
  /** Extra class names for the `<svg>` element. */
  className?: string;
  /** Accessible label. When omitted the mark is decorative (`aria-hidden`),
   *  which is the right call whenever a BrandWordmark sits beside it. */
  title?: string;
}

export function BrandMark({ size = 18, className, title }: BrandMarkProps): ReactElement {
  const raw = useId();
  const gradientId = `jovrel-tile-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const labelled = title !== undefined;
  return (
    <svg
      viewBox="0 0 1024 1024"
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
          <stop offset="0" stopColor="#60A5FA" />
          <stop offset="1" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="230" fill={`url(#${gradientId})`} />
      <g fill="none" stroke="#FFFFFF" strokeWidth={20} strokeLinecap="round">
        <path d="M 556 240 L 556 578 A 105 105 0 0 1 403 605" />
        <path d="M 609 240 L 609 578 A 158 158 0 0 1 398 630" />
        <path d="M 662 240 L 662 578 A 211 211 0 0 1 393 655" />
      </g>
    </svg>
  );
}