// Phase 36 (chunk 3b) — the annotations flyout.
//
// The REVIEW dock's `annotate` primary opens ONE expandable surface that hosts
// the EXISTING AnnotationToolbar (re-parented, selectors and aria kept intact).
// It is the single canonical home for the annotation tools: the registry
// entries carry `surface: 'flyout'`, so the dock does NOT render a second copy
// — one surface, one home.
//
// Placement: it floats above the dock at the bottom-centre of the canvas, so
// it never covers or blocks the dock. Esc closes it, the Annotate primary
// toggles it, and it closes when the stage leaves REVIEW. Arming a tool KEEPS
// it open — mirroring what the app does today, where the annotation toolbar is
// always visible. There is no catch-all pointer/click handler (cross-bubbling
// rules), so a page placement click is never swallowed by the flyout.

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  MOTION_SCALE,
  MOTION_TRANSLATE,
  msToSeconds,
} from '../hooks/motionTokens';

export interface AnnotationFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** The re-parented AnnotationToolbar. */
  children: ReactNode;
}

export function AnnotationFlyout(props: AnnotationFlyoutProps): ReactElement {
  const { open, onClose, children } = props;

  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className="annotation-flyout-anchor">
      <AnimatePresence>
        {open && (
          <motion.div
            className="annotation-flyout"
            role="dialog"
            aria-label="Annotations"
            data-annotation-flyout
            initial={{
              opacity: MOTION_OPACITY.hidden,
              scale: MOTION_SCALE.enter,
              y: MOTION_TRANSLATE.small,
            }}
            animate={{ opacity: MOTION_OPACITY.visible, scale: 1, y: 0 }}
            exit={{ opacity: MOTION_OPACITY.hidden, scale: MOTION_SCALE.exit }}
            transition={{
              duration: msToSeconds(MOTION_DURATION.fast),
              ease: [...MOTION_EASE.enter],
            }}
          >
            <div className="annotation-flyout-header">
              <span className="annotation-flyout-title">Annotations</span>
              <button
                type="button"
                className="annotation-flyout-close"
                onClick={onClose}
                aria-label="Close annotations"
                title="Close annotations"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="annotation-flyout-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}