// TFL-885 (chunk C2b) — ContextToolbox primitive.
//
// ONE coherent NONMODAL floating surface over a canvas selection: a single
// action row (children) plus optionally ONE expanded property/comment region
// (expanded). It is built on the shared TfBar motion wrapper and the shared
// placeControlNearAnchor / clampControlPosition maths, so it neither invents
// a second placement engine nor reimplements motion.
//
// NONMODAL contract: no focus trap, no backdrop, no aria-modal. A pointerdown
// inside the surface stops propagation so the canvas beneath keeps its
// selection (the host's deselect gesture never sees the press). Escape calls
// the host's onClose; focus is never moved by the surface, so there is nothing
// to return on close.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { TfBar } from "./motion/TfMotion";
import {
  chromeObstaclesIn,
  contextControlFits,
  placeControlNearAnchor,
  type ControlAnchorBox,
  type ControlPosition,
  type ControlSize,
  type ControlViewport,
} from "./controlPlacement";

export interface ContextToolboxProps {
  open: boolean;
  /** The selection rect the surface floats beside, in the coordinate space
   *  named by `coordinateSpace` (window viewport by default, page-view when
   *  that option is set). */
  anchor: ControlAnchorBox;
  onClose?: () => void;
  ariaLabel: string;
  /** The single action row. */
  children: ReactNode;
  /** An optional single expanded property/comment region below the row. */
  expanded?: ReactNode;
  testId?: string;
  className?: string;
  /** Optional placement-size override. Defaults to the mounted element's
   *  offset box (existing behaviour). Page-anchored call sites pass their
   *  historical fixed size so their placement stays byte-identical. */
  size?: ControlSize;
  /** Optional coordinate space. "window" (default) keeps the anchor and
   *  the clamp in the window viewport and positions with `fixed` — today's
   *  behaviour, unchanged. "page-view" treats the anchor and the optional
   *  `viewport` box as page-relative and positions with `absolute`, so a
   *  page-anchored toolbar lands exactly where the legacy page-relative
   *  bars did. */
  coordinateSpace?: "window" | "page-view";
  /** The clamp box used when `coordinateSpace` is "page-view". Ignored in
   *  window space, which always reads the live window viewport. */
  viewport?: ControlViewport;
  /** Optional data-* hooks forwarded verbatim to the root element so call
   *  sites keep their stable selectors. Core hooks (data-context-toolbox,
   *  data-placement) always win. */
  dataAttributes?: Record<string, string | undefined>;
  /** Phase 117 — app-chrome rects (rail / inspector / dock / viewing
   *  footer) in the SAME coordinate space as `anchor` / `viewport`. A
   *  placement never covers one; when no side is clear the surface does
   *  not render at all (the Inspector owns the selection). When omitted,
   *  the existing mounted chrome elements are read live. */
  obstacles?: readonly ControlAnchorBox[];
}

/** Place the measured surface beside the anchor, flipping and clamping into
 *  the chosen viewport through the shared helper. */
function place(
  anchor: ControlAnchorBox,
  el: HTMLElement | null,
  size: ControlSize | undefined,
  viewport: ControlViewport | undefined,
  obstacles: readonly ControlAnchorBox[],
): ControlPosition {
  return placeControlNearAnchor({
    anchor,
    size: size ?? { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 },
    viewport: viewport ?? { width: window.innerWidth, height: window.innerHeight },
    obstacles,
  });
}

export function ContextToolbox(props: ContextToolboxProps): ReactElement | null {
  const {
    open,
    anchor,
    onClose,
    ariaLabel,
    children,
    expanded,
    testId,
    className,
    size,
    viewport,
    coordinateSpace = "window",
    dataAttributes,
    obstacles,
  } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ControlPosition | null>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const pageView = coordinateSpace === "page-view";
    const clampViewport = pageView
      ? viewport ?? { width: window.innerWidth, height: window.innerHeight }
      : { width: window.innerWidth, height: window.innerHeight };
    const reposition = (): void => {
      const chrome = obstacles ?? chromeObstaclesIn(pageView ? ref.current?.offsetParent ?? null : null);
      setPosition(place(anchor, ref.current, size, pageView ? viewport : undefined, chrome));
      setFits(
        contextControlFits(
          anchor,
          size ?? { width: ref.current?.offsetWidth ?? 0, height: ref.current?.offsetHeight ?? 0 },
          clampViewport,
          chrome,
        ),
      );
    };
    reposition();
    window.addEventListener("resize", reposition);
    return (): void => window.removeEventListener("resize", reposition);
    // Anchor geometry and the coordinate-space inputs are read field-by-field
    // so a fresh object with the same values does not re-run placement. The
    // obstacle list is intentionally read live, not tracked as a dependency.
  }, [
    open,
    coordinateSpace,
    anchor.left,
    anchor.top,
    anchor.bottom,
    anchor.right,
    size?.width,
    size?.height,
    viewport?.width,
    viewport?.height,
  ]);

  useEffect(() => {
    if (!open || onClose === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.isComposing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Phase 117 — a control that cannot fit clear of the app chrome does
  // not render a floating surface; the Inspector owns the selection.
  if (!fits) return null;

  const above = position !== null && position.top < anchor.top;
  const classes = [
    "context-toolbox",
    above ? "context-toolbox--above" : "context-toolbox--below",
    coordinateSpace === "page-view" ? "context-toolbox--page-view" : undefined,
    className,
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");

  return (
    <TfBar
      ref={ref}
      {...(dataAttributes ?? {})}
      className={classes}
      role="toolbar"
      aria-label={ariaLabel}
      data-context-toolbox="true"
      data-testid={testId}
      data-placement={above ? "above" : "below"}
      style={position === null ? { visibility: "hidden" } : { left: position.left, top: position.top }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <div className="context-toolbox-actions">{children}</div>
      {expanded !== undefined && expanded !== null ? (
        <div className="context-toolbox-expanded">{expanded}</div>
      ) : null}
    </TfBar>
  );
}