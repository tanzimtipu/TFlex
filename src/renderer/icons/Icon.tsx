// Phase 94 — THE central icon wrapper. Phase 103 extends it with the Quiet
// Precision semantic registry (`name=`) alongside the legacy direct-Lucide path.
//
// One source, one visual language, one place that decides how a glyph is drawn.
// Every UI icon in every named surface renders through `Icon`; a component must
// never hand-declare an inline SVG tool glyph or pass a raw pixel `size` to a
// Lucide component. `phase94_noAdHocIcons.test.ts` enforces both rules by source
// scan.
//
// What the wrapper owns (and nothing else may set):
//   - the size, from the `ICON_SIZES` token scale (never a raw pixel number);
//   - the stroke width, from `QUIET_ICON_STROKE` (mirrored as `--tf-icon-stroke`),
//     with `variant="bold"` the one permitted exception (a mark inside a filled
//     checkbox / selected swatch), and `QUIET_ICON_STROKE_SMALL` at the 16px `sm`
//     token;
//   - `strokeLinecap`/`strokeLinejoin="round"` and `color="currentColor"`, so
//     an icon inherits the control's semantic token and never carries a literal
//     stroke/fill colour of its own;
//   - `focusable="false"` and `aria-hidden` (default true), so a decorative
//     glyph stays out of the accessibility tree and the control keeps its own
//     label/`aria-label`/`title`.

import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import {
  QUIET_ICONS,
  QUIET_ICON_STROKE,
  QUIET_ICON_STROKE_SMALL,
  QUIET_ICON_VIEWBOX,
  type QuietIconId,
} from "./quietPrecision";

/**
 * The one size scale (px). `md`/`lg`/`xl` are the >= 18px chrome floor
 * (pinned by `test/unit/renderer/def339_iconFloor.test.ts`); `xs`/`sm` are only
 * for non-chrome marks such as the on-page comment badge. `xxl` is the 24px
 * Quiet Precision optical size; `hero` is the empty-state / brand-sized glyph.
 */
export const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 22,
  xxl: 24,
  hero: 32,
} as const;

/** A token name from {@link ICON_SIZES}. */
export type IconSize = keyof typeof ICON_SIZES;

/** The default stroke width for every tool icon. Mirrors `--tf-icon-stroke`. */
export const ICON_STROKE = QUIET_ICON_STROKE;

/** The ONLY permitted stroke exception: a mark inside a filled checkbox or a
 *  selected swatch, where the normalized weight would read too thin. */
export const ICON_STROKE_BOLD = 3;

export { QUIET_ICON_STROKE, QUIET_ICON_STROKE_SMALL };

export type IconVariant = "default" | "bold";

export interface IconProps {
  /** The legacy direct Lucide glyph. Exactly one of `icon` / `name` is given. */
  icon?: LucideIcon;
  /** The Quiet Precision registry glyph. Exactly one of `icon` / `name` is given. */
  name?: QuietIconId;
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

/** The normalized stroke for a token + variant. */
function strokeFor(size: IconSize, variant: IconVariant): number {
  if (variant === "bold") return ICON_STROKE_BOLD;
  if (size === "sm") return QUIET_ICON_STROKE_SMALL;
  return QUIET_ICON_STROKE;
}

/** Render one glyph through the shared token/stroke/accessibility layer.
 *  Renders exactly one SVG root: either the registry's inline `<svg>` (for
 *  authored Quiet Precision shapes) or one Lucide component. */
export function Icon(props: IconProps): ReactElement {
  const { icon: Glyph, name, size = "md", variant = "default", className, title } = props;
  const ariaHidden = props["aria-hidden"] ?? true;
  const strokeWidth = strokeFor(size, variant);
  const px = ICON_SIZES[size];
  const children: ReactNode = title === undefined ? null : <title>{title}</title>;

  if (name !== undefined) {
    const glyph = QUIET_ICONS[name];
    if (glyph.kind === "lucide") {
      const NamedGlyph = glyph.icon;
      return (
        <NamedGlyph
          size={px}
          color="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          aria-hidden={ariaHidden}
          className={className}
        >
          {children}
        </NamedGlyph>
      );
    }
    return (
      <svg
        viewBox={`0 0 ${QUIET_ICON_VIEWBOX} ${QUIET_ICON_VIEWBOX}`}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={px}
        height={px}
        strokeWidth={strokeWidth}
        focusable="false"
        aria-hidden={ariaHidden}
        className={className}
      >
        {children}
        {glyph.shapes}
      </svg>
    );
  }

  if (Glyph === undefined) {
    throw new Error("Icon: provide either the `icon` or the `name` prop");
  }

  return (
    <Glyph
      size={px}
      color="currentColor"
      strokeWidth={strokeWidth}
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
