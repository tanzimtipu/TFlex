// Phase 14.1 — Liquid Glass CORRECTION: the shared sidebar material.
//
// ONE component system for BOTH floating panels, so the left Pages
// rail and the right Tools panel can never drift apart again:
//
//   GlassSidebar        — the panel shell (flex column). Structure only:
//                         light/dark keep their docked solid panels, the
//                         frosted theme turns .side-rail / .tools-palette
//                         into floating glass cards in styles.css.
//   GlassSidebarHeader  — the shared 44px header row: title left, toggle
//                         right ("Pages" + view tabs; "Tools" + layout
//                         toggle + close).
//   GlassSidebarBody    — the scrollable content region.
//
// Callers keep their legacy surface classes (.side-rail, .rail-tabs,
// .tools-palette-header, ...) via the className pass-through so every
// existing CSS/e2e contract keeps resolving; the glass classes are ADDITIVE.

import type { ReactElement, ReactNode } from "react";

export interface GlassSidebarProps {
  /** The panel's title ("Pages" / "Tools"). Renders in the shared
   *  header row unless the caller renders its own header. */
  title?: string;
  /** Extra classes on the panel root (legacy surface classes). */
  className?: string;
  children?: ReactNode;
}

export function GlassSidebar(props: GlassSidebarProps): ReactElement {
  const { title, className, children } = props;
  return (
    <div className={`glass-sidebar${className ? ` ${className}` : ""}`}>
      {title !== undefined && <GlassSidebarHeader title={title} />}
      {children}
    </div>
  );
}

export interface GlassSidebarHeaderProps {
  /** The header title, rendered at the leading edge. */
  title: string;
  /** The trailing action cluster (view toggle, layout toggle, close).
   *  Rendered inside .glass-sidebar-actions so the no-drag/hit-target
   *  contracts of the inner controls stay theirs. */
  actions?: ReactNode;
  /** Legacy header class (e.g. "rail-header" / "tools-palette-header")
   *  so existing CSS/e2e selectors keep resolving. */
  className?: string;
}

export function GlassSidebarHeader(props: GlassSidebarHeaderProps): ReactElement {
  const { title, actions, className } = props;
  return (
    <header className={`glass-sidebar-header${className ? ` ${className}` : ""}`}>
      <span className="glass-sidebar-title">{title}</span>
      {actions !== undefined && (
        <div className="glass-sidebar-actions">{actions}</div>
      )}
    </header>
  );
}

export interface GlassSidebarBodyProps {
  /** Legacy body class (e.g. "rail-content" / "tools-palette-body"). */
  className?: string;
  children?: ReactNode;
}

export function GlassSidebarBody(props: GlassSidebarBodyProps): ReactElement {
  const { className, children } = props;
  return (
    <div className={`glass-sidebar-body${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}