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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Canonical category (default "secondary"). */
  variant?: ButtonVariant;
  /** Size modifier; "sm" rides `--btn-h-sm` (default "md"). */
  size?: ButtonSize;
  /** Leading glyph. Decorative; the text children are the label. */
  icon?: ReactNode;
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** REQUIRED accessible name — sets both `aria-label` and `title` so the
   *  icon-only tooltip contract cannot be forgotten. */
  label: string;
  /** Canonical category (default "ghost"). */
  variant?: IconButtonVariant;
  /** Size modifier; "sm" rides `--btn-h-sm` (default "md"). */
  size?: ButtonSize;
  /** Toggle category state; renders `aria-pressed` when provided. */
  pressed?: boolean;
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

function joinClasses(parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      icon,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={joinClasses([
          "btn",
          VARIANT_CLASS[variant],
          size === "sm" && "btn-sm",
          className,
        ])}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      size = "md",
      pressed,
      icon,
      className,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={joinClasses([
          "btn",
          ICON_VARIANT_CLASS[variant],
          variant !== "toolbar" && "btn-icon",
          size === "sm" && "btn-sm",
          className,
        ])}
        {...rest}
        aria-label={label}
        title={label}
        aria-pressed={pressed}
      >
        {icon}
      </button>
    );
  },
);
