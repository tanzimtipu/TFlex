// Phase 91 — the shared button system's two class-composers.
//
// `Button` and `IconButton` are thin, stateless wrappers: they compose the
// canonical `.btn` classes (docs/BUTTON-SYSTEM.md) and forward every native
// prop, every `data-*` attribute and the `ref` unchanged, so existing e2e
// hooks, `onClick`/`disabled`/`type` semantics and host refs survive verbatim.
// They own no behaviour, no state and no styling of their own.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type IconButtonVariant =
  | "ghost"
  | "secondary"
  | "danger"
  | "toolbar"
  | "toggle";
export type ButtonSize = "md" | "sm";

// Phase 113 (Quiet Actions) — three explicit axes layered additively over the
// Phase 91 `variant`/`size` surface. `intent` names task emphasis, `kind` names
// the control's semantic role and `density` names its target size. Each axis
// resolves to a canonical `.btn` class (docs/BUTTON-SYSTEM.md) so a call site can
// speak the new vocabulary while existing `variant`/`size` call sites keep
// working unchanged.
export type ButtonIntent = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonKind =
  | "action"
  | "toggle"
  | "exclusive-selection"
  | "disclosure";
export type ButtonDensity = "compact" | "standard" | "prominent" | "coarse";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Canonical category (default "secondary"). Superseded by `intent`. */
  variant?: ButtonVariant;
  /** Phase 113 task emphasis (default from `variant`). Wins over `variant`. */
  intent?: ButtonIntent;
  /** Phase 113 semantic role (default "action"). */
  kind?: ButtonKind;
  /** Phase 113 target size (default "standard"). */
  density?: ButtonDensity;
  /** Size modifier; "sm" rides `--btn-h-sm` (default "md"). */
  size?: ButtonSize;
  /** Leading glyph. Decorative; the text children are the label. */
  icon?: ReactNode;
  /** Busy state: sets `aria-busy`, adds `btn-busy`, swaps the visible label. */
  busy?: boolean;
  /** Label shown while busy; defaults to `children` when omitted. */
  busyLabel?: ReactNode;
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** REQUIRED accessible name — sets both `aria-label` and `title` so the
   *  icon-only tooltip contract cannot be forgotten. */
  label: string;
  /** Canonical category (default "ghost"). Superseded by `intent`. */
  variant?: IconButtonVariant;
  /** Phase 113 task emphasis (default from `variant`). Wins over `variant`. */
  intent?: ButtonIntent;
  /** Phase 113 semantic role (default "action"). */
  kind?: ButtonKind;
  /** Phase 113 target size (default "standard"). */
  density?: ButtonDensity;
  /** Size modifier; "sm" rides `--btn-h-sm` (default "md"). */
  size?: ButtonSize;
  /** Toggle category state; renders `aria-pressed` when provided. */
  pressed?: boolean;
  /** Disclosure state; renders `aria-expanded` when provided. */
  expanded?: boolean;
  /** Busy state: sets `aria-busy`, adds `btn-busy`, swaps the visible label. */
  busy?: boolean;
  /** Label shown while busy; defaults to the `icon` when omitted. */
  busyLabel?: ReactNode;
  /** The glyph. Decorative; `label` carries the accessible name. */
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const ICON_VARIANT_CLASS: Record<IconButtonVariant, string> = {
  ghost: "btn-ghost",
  secondary: "btn-secondary",
  danger: "btn-danger",
  toolbar: "btn-toolbar",
  toggle: "btn-toggle",
};

// Phase 113 — axis -> canonical class. `tertiary` normalizes onto the Phase 91
// `btn-ghost` class and `destructive` onto `btn-danger`, so `variant="ghost"`
// and `intent="tertiary"` (and `variant="danger"` / `intent="destructive"`)
// produce byte-identical output.
const INTENT_CLASS: Record<ButtonIntent, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tertiary: "btn-ghost",
  destructive: "btn-danger",
};

const KIND_CLASS: Record<ButtonKind, string | null> = {
  action: null,
  toggle: "btn-toggle",
  "exclusive-selection": "btn-segmented-item",
  disclosure: "btn-disclosure",
};

const DENSITY_CLASS: Record<ButtonDensity, string | null> = {
  compact: "btn-compact",
  standard: null,
  prominent: "btn-prominent",
  coarse: "btn-coarse",
};

function joinClasses(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/** Busy-state label wrapper. The resting label stays in the DOM (visually
 *  hidden by `.btn-busy .btn-label-resting`) as the width anchor while
 *  `.btn-label-busy` overlays the swapped label, so the control cannot jump
 *  width between the resting and busy states. When not busy the children are
 *  rendered exactly as before, so existing call sites are untouched. */
function renderBusyLabel(
  busy: boolean,
  resting: ReactNode,
  busyLabel: ReactNode,
): ReactNode {
  if (!busy) return resting;
  return (
    <span className="btn-label">
      <span className="btn-label-resting">{resting}</span>
      <span className="btn-label-busy">{busyLabel ?? resting}</span>
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      intent,
      kind = "action",
      density = "standard",
      size = "md",
      icon,
      busy = false,
      busyLabel,
      className,
      children,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) {
    const categoryClass = intent ? INTENT_CLASS[intent] : VARIANT_CLASS[variant];
    return (
      <button
        ref={ref}
        type={type}
        className={joinClasses([
          "btn",
          categoryClass,
          KIND_CLASS[kind],
          DENSITY_CLASS[density],
          size === "sm" && "btn-sm",
          busy && "btn-busy",
          className,
        ])}
        {...rest}
        onClick={busy ? undefined : onClick}
        {...(busy ? { "aria-busy": "true" } : {})}
      >
        {icon}
        {renderBusyLabel(busy, children, busyLabel)}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      intent,
      kind = "action",
      density = "standard",
      size = "md",
      pressed,
      expanded,
      busy = false,
      busyLabel,
      icon,
      className,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) {
    const categoryClass = intent
      ? INTENT_CLASS[intent]
      : ICON_VARIANT_CLASS[variant];
    return (
      <button
        ref={ref}
        type={type}
        className={joinClasses([
          "btn",
          categoryClass,
          variant !== "toolbar" && "btn-icon",
          KIND_CLASS[kind],
          DENSITY_CLASS[density],
          size === "sm" && "btn-sm",
          busy && "btn-busy",
          className,
        ])}
        {...rest}
        onClick={busy ? undefined : onClick}
        {...(busy ? { "aria-busy": "true" } : {})}
        aria-label={label}
        title={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
      >
        {renderBusyLabel(busy, icon, busyLabel)}
      </button>
    );
  },
);
