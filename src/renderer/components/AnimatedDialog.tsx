// AnimatedDialog — the cross-theme animation system's dialog wrapper.
//
// A modal = ONE animated child (backdrop + dialog box together) inside an
// AnimatePresence boundary, so the backdrop's centering layout survives
// and the pair enters/exits as a unit:
//   - backdrop: Backdrop Fade In / Fade Out (opacity-only)
//   - dialog:   Bloom In / Bloom Out (scale --motion-scale-enter -> 1)
//
// Theme-independent by construction: the variants come from
// useBloomAnimation/useBackdropFadeAnimation and carry transform/opacity
// only — colours, shadows and surface opacity are the theme's business.
//
// Cross-bubbling guard (DEF-087/088/090 class): the exit variant pins
// pointer-events: none on the first exit frame, and the backdrop close
// uses the shared useBackdropClose mousedown+click pair so a text
// selection drag that ends over the backdrop cannot close the dialog.

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useBackdropClose } from "./modalBackdrop";
import { useBackdropFadeAnimation, useBloomAnimation } from "../hooks/useAnimations";

export interface AnimatedDialogProps {
  /** Mount/unmount switch — AnimatePresence plays the bloom in/out. */
  open: boolean;
  /** Backdrop click-to-close. Omit for dialogs that must be answered. */
  onClose?: () => void;
  /** Class for the dialog box itself (e.g. "sheet sheet-about"). */
  className?: string;
  /** Class for the backdrop layer (default "sheet-backdrop"). */
  backdropClassName?: string;
  /** While true the backdrop ignores clicks (async work, OS pickers). */
  blockBackdropClose?: boolean;
  /** a11y wiring for the dialog box. */
  labelledBy?: string;
  ariaLabel?: string;
  /** Stable hook for e2e selectors. */
  testId?: string;
  children: ReactNode;
}

export function AnimatedDialog(props: AnimatedDialogProps): ReactElement {
  const {
    open,
    onClose,
    className,
    backdropClassName = "sheet-backdrop",
    blockBackdropClose = false,
    labelledBy,
    ariaLabel,
    testId,
    children,
  } = props;
  const bloom = useBloomAnimation();
  const backdropFade = useBackdropFadeAnimation();
  // `onClose === undefined` disables backdrop close exactly like the
  // `blocked` gate: the backdrop swallows no clicks, it just has no
  // close handler wired.
  const backdropHandlers = useBackdropClose(onClose ?? (() => undefined), blockBackdropClose || onClose === undefined);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={backdropClassName}
          role="presentation"
          variants={backdropFade}
          initial="initial"
          animate="animate"
          exit="exit"
          onMouseDown={onClose === undefined ? undefined : backdropHandlers.onMouseDown}
          onClick={backdropHandlers.onClick}
        >
          <motion.div
            className={className}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={ariaLabel}
            data-animated-dialog={testId ?? true}
            variants={bloom}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}