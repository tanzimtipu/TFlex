// TFL-885 (chunk C2b) — Tooltip primitive.
//
// A shared React tooltip so described controls stop depending on the native
// `title` attribute. It renders a REAL element with role="tooltip" and an id,
// and points the wrapped control's aria-describedby at it, so assistive tech
// gets the description (a ::after pseudo cannot be referenced).
//
// It is supplementary only — never the sole carrier of essential instructions.
// It shows on hover AND focus, hides on blur / mouseleave / Escape, never
// takes focus or intercepts IME composition, and its chip is pointer-events:
// none so it can never obscure or block the control it describes. Reduced
// motion / Animations off swap the entrance to the existing opacity-only
// tooltip-enter-reduced keyframe (no travel).

import { cloneElement, useId, useState } from "react";
import type { ReactElement } from "react";
import { useInstantMotion } from "../hooks/useAnimations";

export interface TooltipProps {
  label: string;
  /** Optional second line (keyboard shortcut hint). */
  shortcut?: string;
  /** A single focusable control. */
  children: ReactElement;
  side?: "top" | "bottom";
  testId?: string;
}

export function Tooltip(props: TooltipProps): ReactElement {
  const { label, shortcut, children, side = "top", testId } = props;
  const tipId = useId();
  const instant = useInstantMotion();
  const [shown, setShown] = useState(false);

  const childProps = children.props as { "aria-describedby"?: string };
  const describedBy = [childProps["aria-describedby"], tipId]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  const control = cloneElement(
    children as ReactElement<{ "aria-describedby"?: string }>,
    { "aria-describedby": describedBy },
  );

  const hide = (): void => setShown(false);

  const classes = [
    "tooltip-element",
    `tooltip-element--${side}`,
    "tooltip-element--visible",
    instant ? "tooltip-element--instant" : "",
  ]
    .filter((part): part is string => part !== "")
    .join(" ");

  return (
    <span
      className="tooltip-control"
      data-testid={testId}
      onMouseEnter={(): void => setShown(true)}
      onMouseLeave={hide}
      onFocusCapture={(): void => setShown(true)}
      onBlurCapture={hide}
      onKeyDown={(e): void => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) hide();
      }}
    >
      {control}
      {shown ? (
        <span
          role="tooltip"
          id={tipId}
          className={classes}
          data-side={side}
          data-motion={instant ? "reduced" : "full"}
        >
          {label}
          {shortcut !== undefined && shortcut !== "" ? (
            <span className="tooltip-element-shortcut">{shortcut}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}