// TFL-885 (chunk C2b) — PropertyPopover primitive.
//
// An anchored NONMODAL popover that adjusts ONE property. Built on the shared
// TfPopover motion wrapper. It paints no backdrop and carries no aria-modal, so
// the canvas action beneath it stays live: an outside pointerdown dismisses
// without swallowing the underlying gesture, and Escape dismisses. Focus is
// not trapped; the element that held focus before opening is restored on close
// where it still exists.

import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { TfPopover } from "./motion/TfMotion";

export interface PropertyPopoverProps {
  open: boolean;
  label: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional fixed width in CSS px; otherwise the width is content-driven. */
  width?: number;
  testId?: string;
  className?: string;
}

export function PropertyPopover(props: PropertyPopoverProps): ReactElement {
  const { open, label, onClose, children, footer, width, testId, className } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    if (active instanceof HTMLElement) returnFocusRef.current = active;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (ref.current?.contains(target)) return;
      onCloseRef.current?.();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.isComposing) onCloseRef.current?.();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      const target = returnFocusRef.current;
      if (target !== null && document.contains(target)) target.focus();
    };
  }, [open]);

  const classes = ["property-popover", className]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  const style = width === undefined ? undefined : { width: `${width}px` };

  return (
    <AnimatePresence>
      {open ? (
        <TfPopover
          ref={ref}
          className={classes}
          role="dialog"
          aria-label={label}
          data-property-popover="true"
          data-testid={testId}
          style={style}
        >
          <div className="property-popover-title">{label}</div>
          <div className="property-popover-body">{children}</div>
          {footer !== undefined && footer !== null ? (
            <div className="property-popover-footer">{footer}</div>
          ) : null}
        </TfPopover>
      ) : null}
    </AnimatePresence>
  );
}