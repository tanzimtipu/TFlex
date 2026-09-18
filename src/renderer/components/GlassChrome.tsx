// Phase 14.1 — Liquid Glass CORRECTION: shared chrome material
// primitives.
//
// Three pieces the corrected Liquid Glass reference needs, so the top
// bars and the sidebars stop being hand-rolled per surface:
//
//   GlassChromeBar    — a standardized top bar (title bar, command
//                       bar). The height comes from the chrome tokens
//                       (--chrome-titlebar-h 44px / --chrome-commandbar-h
//                       52px / --chrome-contextbar-h 40px); the bar is a
//                       flex row with consistent vertical centering.
//   GlassControlGroup — the command bar's capsule: related controls in
//                       ONE translucent group ("[< 1/34 >]", "[- 372% +]")
//                       instead of a field of loose heavy buttons.
//
// The components are intentionally presentational: they own the DOM
// shape + a11y (role="group" + aria-label so the no-op sweep can name
// every cluster), never behavior. Every interactive child keeps its
// own aria-label / title contract.

import type { CSSProperties, ElementType, HTMLAttributes, ReactElement, ReactNode } from "react";

/** The THREE standardized top-bar heights (Phase 14.1: "NO arbitrary
 *  heights"). Mirrors the CSS chrome tokens in styles.css — keep the
 *  two in sync. Exported so tests (and future bars) can pin the
 *  contract without parsing CSS. */
export const GLASS_CHROME_HEIGHTS = {
  titleBar: 44,
  commandBar: 52,
  contextBar: 40,
} as const;

export type GlassChromeVariant = keyof typeof GLASS_CHROME_HEIGHTS;

const VARIANT_HEIGHT_VAR: Record<GlassChromeVariant, string> = {
  titleBar: "--chrome-titlebar-h",
  commandBar: "--chrome-commandbar-h",
  contextBar: "--chrome-contextbar-h",
};

/** Variant -> kebab-case CSS class suffix (glass-chrome-title etc.).
 *  The CSS block keys off these exact names. */
const VARIANT_CLASS: Record<GlassChromeVariant, string> = {
  titleBar: "title",
  commandBar: "command",
  contextBar: "context",
};

export interface GlassChromeBarProps extends HTMLAttributes<HTMLElement> {
  /** Which standardized bar this is — picks the height token. */
  variant: GlassChromeVariant;
  /** Extra classes (the surfaces keep their legacy classes, e.g.
   *  `.titlebar`, so the existing CSS/e2e contracts keep resolving). */
  className?: string;
  children?: ReactNode;
  /** Rendered element type. Defaults to div; the TitleBar passes its
   *  own shape through className + data attributes instead. */
  as?: ElementType;
  style?: CSSProperties;
}

/** A standardized glass chrome bar. The variant ONLY carries the
 *  height token + the glass-chrome class — surfaces keep painting
 *  their own theme material (light/dark are solid, frosted is glass).
 *  Every other prop (data-* hooks, ids, event handlers) forwards to
 *  the rendered element so legacy contracts (`.titlebar`'s
 *  data-titlebar, drag handlers) keep working. */
export function GlassChromeBar(props: GlassChromeBarProps): ReactElement {
  const { variant, className, children, as, style, ...rest } = props;
  const Tag = (as ?? "div") as ElementType;
  const heightVar = VARIANT_HEIGHT_VAR[variant];
  return (
    <Tag
      {...rest}
      className={`glass-chrome glass-chrome-${VARIANT_CLASS[variant]}${className ? ` ${className}` : ""}`}
      style={{ height: `var(${heightVar})`, ...style }}
    >
      {children}
    </Tag>
  );
}

export interface GlassControlGroupProps
  extends HTMLAttributes<HTMLDivElement> {
  /** The group's accessible name — role="group" + aria-label so the
   *  control cluster is announced and the no-op sweep can name it. */
  label: string;
  /** Extra classes (the command bar keeps `.toolbar-group` on every
   *  capsule so the toolbar overflow contract keeps applying). */
  className?: string;
  children?: ReactNode;
}

/** The command bar's glass capsule. Renders a non-interactive group
 *  wrapper; the interactive children carry their own semantics. Every
 *  other prop (data-* hooks, ids, handlers) forwards to the wrapper so
 *  a capsule can carry its own stable e2e contract (Phase 19's
 *  `data-annotation-toolbar`). */
export function GlassControlGroup(props: GlassControlGroupProps): ReactElement {
  const { label, className, children, ...rest } = props;
  return (
    <div
      {...rest}
      role="group"
      aria-label={label}
      className={`glass-control-group${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}