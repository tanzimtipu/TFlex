// AnimatedPanel — the cross-theme animation system's sidebar/panel wrapper.
//
// Slide In / Slide Out (sidebar band, 280ms enter / 200ms exit) with two
// travel modes:
//   - "overlay": a drawer above the content, travelling its full width
//     (translateX -100% / +100% by side).
//   - "docked": a rail that shares the layout with the page view,
//     travelling only --motion-translate-panel (24px) so the document
//     view slides alongside without a full-width sweep (the docked rails
//     in this app reserve their space — Magnetic Dock behaviour).
//
// Theme-independent: transform/opacity only; surface colours stay in the
// theme. The exit pins pointer-events: none on the first frame so a
// closing panel never eats the click underneath it.

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSlideAnimation } from "../hooks/useAnimations";

export interface AnimatedPanelProps {
  open: boolean;
  /** Which edge the panel lives on — decides the slide direction. */
  side: "left" | "right";
  mode?: "overlay" | "docked";
  className?: string;
  /** Stable hook for e2e/qa selectors. */
  testId?: string;
  children: ReactNode;
}

export function AnimatedPanel(props: AnimatedPanelProps): ReactElement {
  const { open, side, mode = "docked", className, testId, children } = props;
  const slide = useSlideAnimation({ side, mode });
  const Tag = mode === "overlay" ? motion.div : motion.aside;

  return (
    <AnimatePresence>
      {open && (
        <Tag
          className={className}
          data-animated-panel={testId ?? true}
          data-panel-side={side}
          variants={slide}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {children}
        </Tag>
      )}
    </AnimatePresence>
  );
}