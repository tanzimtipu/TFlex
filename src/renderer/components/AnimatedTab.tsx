// AnimatedTab — the cross-theme animation system's document tab.
//
// One animated tab strip entry: Tab Materialize (opacity 0 -> 1, 200ms)
// on open and Tab Dissolve (opacity -> 0, 150ms) on close. The tab strip
// itself never moves — opacity-only variants mean a tab opening or
// closing can never jank the tab row, and the active-tab crossfade stays
// with the existing CSS transition on .tab (background/colour).
//
// Interaction contract preserved from AppHeader (DEF-034):
//   - activation resolves on MOUSEDOWN via the shared resolveTabMouseDown,
//     so padding/gap/title hits activate and the close button closes;
//   - the close button stops mousedown propagation so the tab-level
//     handler never double-fires an activate;
//   - the exit variant pins pointer-events: none on the first frame so a
//     dissolving tab cannot swallow clicks on the tabs beneath it.

import { useCallback, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { resolveTabMouseDown, type TabInput } from "../state/tabMouseDown";
import { useTabVariants } from "../hooks/useAnimations";

export interface AnimatedTabProps {
  id: string;
  title: string;
  active: boolean;
  modified: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function AnimatedTab(props: AnimatedTabProps): ReactElement {
  const { id, title, active, modified, onActivate, onClose } = props;
  const variants = useTabVariants();
  const input: TabInput = { id, title, modified };

  // Per-tab mousedown resolver: same classifier the strip-level handler
  // used, fed this tab only. A mousedown landing outside any .tab never
  // reaches here; a non-left button returns null (no accidental
  // activation from context-menu presses).
  const onTabMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      const action = resolveTabMouseDown({ target: e.target, button: e.button }, [input]);
      if (action === null) return;
      if (action.kind === "activate") {
        // The strip-level handler compared the resolved id against the
        // APP's active id; per-tab, the resolved id is always this tab,
        // so the equivalent guard is this tab's own `active` flag.
        if (active) return; // already active — no-op
        onActivate(action.id);
      } else {
        onClose(action.id);
      }
    },
    [id, active, onActivate, onClose], // `input` derives from these props
  );

  // The close button stops mousedown bubbling: the resolver above must
  // see the close-button hit and the tab-level handler must not ALSO
  // fire an activate (same stopPropagation level as AppHeader used).
  const onCloseMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
    },
    [],
  );

  return (
    <motion.li
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      data-animated-tab={id}
    >
      <div
        className={active ? "tab tab-active" : "tab"}
        role="tab"
        aria-selected={active}
        data-tab-id={id}
        onMouseDown={onTabMouseDown}
      >
        <span className="tab-title" title={title}>
          <span
            className={
              modified
                ? "tab-modified-dot"
                : "tab-modified-dot tab-modified-dot-hidden"
            }
            aria-hidden
          />
          {title}
        </span>
        <button
          type="button"
          className="tab-close"
          onMouseDown={onCloseMouseDown}
          onClick={(e): void => {
            e.stopPropagation();
            onClose(id);
          }}
          aria-label={`Close ${title}`}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </motion.li>
  );
}

/** Exported so the host (AppHeader) wraps the strip in ONE presence
 *  boundary: <AnimatePresence initial={false}>{tabs.map(AnimatedTab)}</AnimatePresence>.
 *  `initial={false}` keeps page-load tabs from materializing — only NEW
 *  tabs play Tab Materialize. */
export const AnimatedTabPresence = AnimatePresence;