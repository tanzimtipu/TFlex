// Phase 36 (chunk 3b) — the annotations flyout.
//
// The REVIEW dock's `annotate` primary opens ONE expandable surface that hosts
// the EXISTING AnnotationToolbar (re-parented, selectors and aria kept intact).
// It is the single canonical home for the annotation tools: the registry
// entries carry `surface: 'flyout'`, so the dock does NOT render a second copy
// — one surface, one home.
//
// Phase 37 (item 3) — the flyout is the secondary surface for the annotation
// tools and renders as ONE ROW with NO header: the title/close row is gone.
// Esc and a re-click of the dock's Annotate verb dismiss it. As the window
// shrinks it follows the dock's ladder (chunk 3) exactly: the shared DockLadder
// hides labels first and then shows left/right arrows to scroll the single row
// — it never wraps and never stacks.
//
// Placement: it floats above the dock at the bottom-centre of the canvas, so
// it never covers or blocks the dock. It closes when the stage leaves REVIEW.
// Arming a tool KEEPS it open. There is no catch-all pointer/click handler
// (cross-bubbling rules), so a page placement click is never swallowed.

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DockLadder } from '../state/dockResponsive';
import { resolveSecondaryRowLadder } from '../state/secondaryRow';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  MOTION_SCALE,
  MOTION_TRANSLATE,
  msToSeconds,
} from '../hooks/motionTokens';
import { useRowOverflow } from '../hooks/useRowOverflow';

/** How far one arrow click scrolls the single tool row (mirrors the dock's
 *  step so the two single rows feel identical). */
const FLYOUT_SCROLL_STEP = 160;

export interface AnnotationFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** The re-parented AnnotationToolbar. */
  children: ReactNode;
  /** Phase 37 (item 3) — the ONE responsive ladder the host resolved. */
  ladder?: DockLadder;
}

export function AnnotationFlyout(props: AnnotationFlyoutProps): ReactElement {
  const { open, onClose, children, ladder } = props;
  const { iconOnly, arrows: arrowsLane } = resolveSecondaryRowLadder(ladder);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // DEF-337 — the arrows render only when the row genuinely overflows, so a
  // body that already fits never offers a dead control.
  const arrows = useRowOverflow(scrollRef, arrowsLane);

  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Phase 37 (item 3) — scroll the single row by one step (arrows rung). */
  const scrollRow = (direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const delta = direction * FLYOUT_SCROLL_STEP;
    if (typeof el.scrollBy === 'function') {
      el.scrollBy({ left: delta, behavior: 'smooth' });
    } else {
      el.scrollLeft += delta;
    }
  };

  return (
    <div className="annotation-flyout-anchor">
      <AnimatePresence>
        {open && (
          <motion.div
            className="annotation-flyout"
            role="dialog"
            aria-label="Annotations"
            data-annotation-flyout
            data-flyout-icon-only={iconOnly ? 'true' : 'false'}
            data-flyout-arrows={arrows ? 'true' : 'false'}
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
            {/* Phase 37 (item 3) — ONE row, no header. The arrows appear only at
                the ladder's last rung; the body scrolls so the row never wraps. */}
            <div className="annotation-flyout-row" data-annotation-flyout-row>
              {arrows && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon annotation-flyout-arrow"
                  data-flyout-arrow="left"
                  aria-label="Scroll annotation tools left"
                  title="Scroll left"
                  onClick={(): void => scrollRow(-1)}
                >
                  <Icon icon={ChevronsLeft} size="sm" />
                </button>
              )}
              <div
                className="annotation-flyout-body"
                ref={scrollRef}
                data-annotation-flyout-scroll
              >
                {children}
              </div>
              {arrows && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon annotation-flyout-arrow"
                  data-flyout-arrow="right"
                  aria-label="Scroll annotation tools right"
                  title="Scroll right"
                  onClick={(): void => scrollRow(1)}
                >
                  <Icon icon={ChevronsRight} size="sm" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
