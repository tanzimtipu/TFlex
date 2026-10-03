// Phase 94 — THE central icon wrapper.
//
// One source (lucide-react), one visual language, one place that decides how a
// glyph is drawn. Every UI icon in every named surface renders through `Icon`;
// a component must never hand-declare an inline SVG tool glyph or pass a raw
// pixel `size` to a Lucide component. `phase94_noAdHocIcons.test.ts` enforces
// both rules by source scan.
//
// What the wrapper owns (and nothing else may set):
//   - the size, from the `ICON_SIZES` token scale (never a raw pixel number);
//   - the stroke width, from `ICON_STROKE` (mirrored as `--tf-icon-stroke`),
//     with `variant="bold"` the one permitted exception (a mark inside a filled
//     checkbox / selected swatch);
//   - `strokeLinecap`/`strokeLinejoin="round"` and `color="currentColor"`, so
//     an icon inherits the control's semantic token and never carries a literal
//     stroke/fill colour of its own;
//   - `focusable="false"` and `aria-hidden` (default true), so a decorative
//     glyph stays out of the accessibility tree and the control keeps its own
//     label/`aria-label`/`title`.

import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

/**
 * The one size scale (px). `md`/`lg`/`xl` are the >= 18px chrome floor
 * (pinned by `test/unit/renderer/def339_iconFloor.test.ts`); `xs`/`sm` are only
 * for non-chrome marks such as the on-page comment badge. `hero` is the
 * empty-state / brand-sized glyph.
 */
export const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 22,
  hero: 32,
} as const;

/** A token name from {@link ICON_SIZES}. */
export type IconSize = keyof typeof ICON_SIZES;

/** The default stroke width for every tool icon. Mirrors `--tf-icon-stroke`. */
export const ICON_STROKE = 2;

/** The ONLY permitted stroke exception: a mark inside a filled checkbox or a
 *  selected swatch, where the normalized weight would read too thin. */
export const ICON_STROKE_BOLD = 3;

export type IconVariant = "default" | "bold";

export interface IconProps {
  /** The Lucide glyph to render. */
  icon: LucideIcon;
  /** Token size from {@link ICON_SIZES}; defaults to `md` (18px). */
  size?: IconSize;
  /** `bold` is the sole stroke-width exception; defaults to `default`. */
  variant?: IconVariant;
  /** Extra class names for the rendered SVG root. */
  className?: string;
  /** Defaults to true (decorative). Pass false when a `title` carries meaning. */
  "aria-hidden"?: boolean;
  /** Optional accessible name rendered as an SVG `<title>`. */
  title?: string;
}

/** Render one Lucide glyph through the shared token/stroke/accessibility layer.
 *  Renders exactly one SVG root (lucide's) — the wrapper adds no element. */
export function Icon(props: IconProps): ReactElement {
  const { icon: Glyph, size = "md", variant = "default", className, title } = props;
  const ariaHidden = props["aria-hidden"] ?? true;
  const children: ReactNode = title === undefined ? null : <title>{title}</title>;
  return (
    <Glyph
      size={ICON_SIZES[size]}
      color="currentColor"
      strokeWidth={variant === "bold" ? ICON_STROKE_BOLD : ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={ariaHidden}
      className={className}
    >
      {children}
    </Glyph>
  );
}
