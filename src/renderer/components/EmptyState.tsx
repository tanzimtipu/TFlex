// Phase 96 (chunk D) — the shared designed empty state.
//
// One surface for every place the product can be empty: an optional
// Phase-94 hero mark (rendered through the central `Icon` wrapper), one
// headline line in `--fg-strong` and one optional help line in
// `--fg-muted`, laid out by the `.empty-state` rules in `styles.css`.
// Every extra prop (especially `data-*`) is forwarded to the root
// unchanged, so an adopter keeps its existing hooks.

import type { LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactElement } from "react";
import { Icon } from "../icons/Icon";

export interface EmptyStateProps {
  /** Optional hero mark, rendered through the Phase-94 `Icon` wrapper. */
  icon?: LucideIcon;
  /** The one headline line. */
  headline: string;
  /** Optional supporting line. */
  help?: string;
  /** Extra class names appended to the root's `empty-state`. */
  className?: string;
  /** Every extra prop (especially `data-*`) is forwarded to the root. */
  [dataAttr: `data-${string}`]: unknown;
}

/** A centred empty-state block: optional hero mark, headline, optional help. */
export function EmptyState(props: EmptyStateProps): ReactElement {
  const { icon, headline, help, className, ...rest } = props;
  const rootClass = className === undefined ? "empty-state" : `empty-state ${className}`;
  const forwarded = rest as unknown as HTMLAttributes<HTMLDivElement>;
  return (
    <div className={rootClass} {...forwarded}>
      {icon !== undefined && (
        <Icon icon={icon} size="hero" className="empty-state-mark" aria-hidden />
      )}
      <p className="empty-state-headline">{headline}</p>
      {help !== undefined && <p className="empty-state-help">{help}</p>}
    </div>
  );
}
