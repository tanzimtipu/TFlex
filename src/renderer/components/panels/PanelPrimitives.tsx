// Phase 105+ (TFL-854, chunk C1) — the shared panel primitives.
//
// THE one vocabulary the workspace panels build from: an opaque panel
// surface, a scoped header with the preferred 52px height, a titled section
// with the 20px rhythm, a label/value property row, a list of labelled
// actions and a designed empty state. Every class is prefixed `tf-panel-`
// and every state rides a `data-*` hook, so a consumer can target structure
// without reaching into a panel's private selectors.
//
// The primitives are geometry-only: surfaces, spacing, type scale and the
// 140ms state motion come from the scoped `.tf-panel` token block in
// `styles.css`; no colour, shadow or workspace identity lives here. The
// legacy `glass-sidebar-*` classes are emitted alongside so existing CSS and
// e2e selectors keep resolving while a panel migrates.

import type { LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { Button } from "../Button";
import type { ButtonIntent, ButtonKind, ButtonDensity } from "../Button";

/** Join truthy class names into one string (the Button.tsx composer shape). */
function compose(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part !== "").join(" ");
}

/** Every extra `data-*` prop is forwarded to the primitive root unchanged. */
type DataAttrs = { [dataAttr: `data-${string}`]: unknown };

export interface PanelShellProps extends DataAttrs {
  /** The region's accessible name. */
  label: string;
  /** Legacy surface class (e.g. "context-panel" / "inspector"). */
  className?: string;
  /** Landmark role; the shared default is a named region. */
  role?: string;
  /** TFL-1155 (TFL-1116 C9 / R11) — an optional FIXED footer below the scroll
   *  body. Omitted renders no footer element at all, so a panel keeps exactly
   *  the header + body structure it has today. */
  footer?: ReactNode;
  children?: ReactNode;
}

/** The opaque panel surface every workspace panel mounts as its root. The shell
 *  is the ONE panel column (R11): a fixed header, a `min-height: 0` scroll body
 *  and an optional fixed footer all come from the shared `.tf-panel-shell`
 *  geometry in `styles.css`; the shell only composes the footer slot. */
export function PanelShell(props: PanelShellProps): ReactElement {
  const { label, className, role = "region", footer, children, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLDivElement>;
  return (
    <div
      className={compose("tf-panel", "tf-panel-shell", className)}
      role={role}
      aria-label={label}
      {...forwarded}
    >
      {children}
      {footer !== undefined && <footer className="tf-panel-footer">{footer}</footer>}
    </div>
  );
}

export interface ScopedHeaderProps extends DataAttrs {
  /** Sentence-case title; an empty/omitted title renders the action slot alone. */
  title?: string;
  /** TFL-1557 — an optional leading control cluster rendered BEFORE the title.
   *  Lets a panel place its collapse/expand affordance on the left edge while
   *  the trailing `actions` cluster stays on the right. Omitted renders the
   *  header exactly as before. */
  leadingActions?: ReactNode;
  /** The trailing action cluster. */
  actions?: ReactNode;
  /** Legacy header class (e.g. "context-panel-header" / "inspector-header"). */
  className?: string;
  /** Applies the preferred 52px header height (the panel token default). */
  preferredHeight?: boolean;
}

/** The scoped 52px panel header: title left, actions right. */
export function ScopedHeader(props: ScopedHeaderProps): ReactElement {
  const { title, leadingActions, actions, className, preferredHeight = false, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLElement>;
  return (
    <header
      className={compose(
        "glass-sidebar-header",
        "tf-panel-header",
        preferredHeight ? "tf-panel-header-preferred" : undefined,
        className,
      )}
      data-tf-panel-header={preferredHeight ? "preferred" : "default"}
      {...forwarded}
    >
      {leadingActions !== undefined && (
        <div className="glass-sidebar-leading-actions tf-panel-header-leading-actions">
          {leadingActions}
        </div>
      )}
      {title !== undefined && title !== "" && (
        <span className="glass-sidebar-title tf-panel-header-title">{title}</span>
      )}
      {actions !== undefined && (
        <div className="glass-sidebar-actions tf-panel-header-actions">{actions}</div>
      )}
    </header>
  );
}

export interface PanelSectionProps extends DataAttrs {
  /** The section heading, rendered inside the scoped heading slot. */
  title?: string;
  /** Legacy section class (e.g. "inspector-section"). */
  className?: string;
  /** Legacy heading class (e.g. "inspector-section-title"). */
  titleClassName?: string;
  /** Legacy body class (e.g. "inspector-section-body"). */
  bodyClassName?: string;
  /** Heading level; panels use 2. */
  level?: 2 | 3;
  children?: ReactNode;
}

/** A titled panel section: heading, then its body. */
export function PanelSection(props: PanelSectionProps): ReactElement {
  const { title, className, titleClassName, bodyClassName, level = 2, children, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLElement>;
  return (
    <section className={compose("tf-panel-section", className)} {...forwarded}>
      {title !== undefined && title !== "" && (
        <div
          className={compose("tf-panel-section-title", titleClassName)}
          role="heading"
          aria-level={level}
        >
          {title}
        </div>
      )}
      <div className={compose("tf-panel-section-body", bodyClassName)}>{children}</div>
    </section>
  );
}

export interface PropertyRowProps extends DataAttrs {
  /** The secondary label text. */
  label: string;
  /** The value slot; `children` is used when `value` is omitted. */
  value?: ReactNode;
  /** Legacy row class (e.g. "inspector-row"). */
  className?: string;
  /** Legacy label class (e.g. "inspector-row-label"). */
  labelClassName?: string;
  /** Legacy value class (e.g. "inspector-row-value"). */
  valueClassName?: string;
  children?: ReactNode;
}

/** A label-left / value-right property row (32-36px). */
export function PropertyRow(props: PropertyRowProps): ReactElement {
  const { label, value, className, labelClassName, valueClassName, children, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLDivElement>;
  return (
    <div className={compose("tf-panel-row", className)} {...forwarded}>
      <span className={compose("tf-panel-row-label", labelClassName)}>{label}</span>
      <span className={compose("tf-panel-row-value", valueClassName)}>{value ?? children}</span>
    </div>
  );
}

export interface PanelAction {
  /** Stable id, emitted as `data-tf-panel-action`. */
  id: string;
  /** Visible label and tooltip. */
  label: string;
  /** Handler; omitted renders the action disabled (never a silent no-op). */
  onClick?: () => void;
  /** Optional leading glyph, rendered through the shared Icon wrapper. */
  icon?: ReactNode;
  /** Explicit disabled flag; defaults to `onClick === undefined`. */
  disabled?: boolean;
  /** Phase 112 (C5) — extra legacy `data-*` hooks to keep on the button while a
   *  migrated surface still owes them (e.g. `data-context-panel-action`). */
  dataAttrs?: Record<`data-${string}`, string>;
  /** Phase 113 — Quiet Actions task emphasis; defaults to `secondary`. */
  intent?: ButtonIntent;
  /** Phase 113 — Quiet Actions semantic role; defaults to `action`. */
  kind?: ButtonKind;
  /** Phase 113 — Quiet Actions target size; defaults to `standard`. */
  density?: ButtonDensity;
}

export interface ActionListProps extends DataAttrs {
  actions: readonly PanelAction[];
  /** Legacy list class (e.g. "inspector-quick-actions"). */
  className?: string;
}

/** A vertical list of labelled actions. */
export function ActionList(props: ActionListProps): ReactElement {
  const { actions, className, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLDivElement>;
  return (
    <div className={compose("tf-panel-action-list", className)} {...forwarded}>
      {actions.map((action) => (
        <Button
          key={action.id}
          intent={action.intent ?? "secondary"}
          kind={action.kind ?? "action"}
          density={action.density ?? "standard"}
          className="tf-panel-action"
          data-tf-panel-action={action.id}
          onClick={action.onClick}
          disabled={action.disabled ?? action.onClick === undefined}
          title={action.label}
          {...action.dataAttrs}
        >
          {action.icon}
          <span>{action.label}</span>
        </Button>
      ))}
    </div>
  );
}

export interface PanelEmptyStateProps extends DataAttrs {
  /** Optional hero mark, rendered through the shared Icon wrapper. */
  icon?: LucideIcon;
  /** The one headline line. */
  headline: string;
  /** Optional supporting line. */
  help?: string;
  /** Legacy empty-state class. */
  className?: string;
}

/** A designed panel empty state: optional mark, headline, optional help. */
export function PanelEmptyState(props: PanelEmptyStateProps): ReactElement {
  const { icon, headline, help, className, ...rest } = props;
  const forwarded = rest as unknown as HTMLAttributes<HTMLDivElement>;
  return (
    <div className={compose("tf-panel-empty", className)} {...forwarded}>
      {icon !== undefined && (
        <Icon icon={icon} size="hero" className="tf-panel-empty-mark" aria-hidden />
      )}
      <p className="tf-panel-empty-headline">{headline}</p>
      {help !== undefined && <p className="tf-panel-empty-help">{help}</p>}
    </div>
  );
}