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

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { resolveTabMouseDown, type TabInput } from "../state/tabMouseDown";
import { useTabVariants } from "../hooks/useAnimations";

/**
 * DEF-413 — did the gesture drag-select text inside this tab's title?
 * A NON-collapsed selection whose start or end falls inside the title
 * means the user was selecting the title text, not clicking the tab, so
 * the activation must be suppressed. A collapsed (or absent) selection
 * means an ordinary click.
 *
 * Kept module-local and dependency-free so the component's mouseup check
 * stays a pure predicate.
 */
function selectionIncludesTitle(
  selection: Selection | null,
  titleEl: Element,
): boolean {
  if (selection === null || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    if (
      titleEl.contains(range.startContainer) ||
      titleEl.contains(range.endContainer)
    ) {
      return true;
    }
  }
  return false;
}

export interface AnimatedTabProps {
  id: string;
  title: string;
  active: boolean;
  modified: boolean;
  /** Phase 45 (item 2) — the tab's palette slot from its position in the
   *  strip (`tabColourSlot(index)`). Paints the per-tab colour identity via
   *  `data-tab-colour`; optional so a bare harness mount defaults to slot 0
   *  rather than an undefined colour. */
  colourSlot?: number;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function AnimatedTab(props: AnimatedTabProps): ReactElement {
  const { id, title, active, modified, colourSlot = 0, onActivate, onClose } = props;
  const variants = useTabVariants();
  const input: TabInput = { id, title, modified };

  // DEF-413 — the one-shot cleanup for a deferred title activation. When
  // a mousedown lands inside a NON-active tab's title we do not activate
  // immediately: we wait for mouseup so a drag-select over the title is
  // not mistaken for a click (Phase 58 feature B). The ref holds the
  // function that removes the window listeners so the listener is always
  // torn down on release, on pointercancel, or on unmount.
  const pendingActivationRef = useRef<(() => void) | null>(null);

  const clearPendingActivation = useCallback((): void => {
    if (pendingActivationRef.current !== null) {
      pendingActivationRef.current();
      pendingActivationRef.current = null;
    }
  }, []);

  // Unmount safety net: a tab can dissolve while a deferred activation is
  // still armed, so drop the window listeners with the component.
  useEffect(() => clearPendingActivation, [clearPendingActivation]);

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
        const titleEl =
          e.target instanceof Element ? e.target.closest(".tab-title") : null;
        // DEF-034 — a hit OUTSIDE the title (padding, gap, colour chip,
        // flare) still activates on mousedown. Only a title hit defers.
        if (titleEl === null) {
          onActivate(action.id);
          return;
        }
        // DEF-413 — defer the title activation to mouseup. If the release
        // still shows a collapsed selection with no non-collapsed range
        // inside this title, it was a click: activate once. Otherwise the
        // user was selecting text and nothing happens.
        clearPendingActivation(); // drop a stale listener from a prior press
        const onMouseUp = (): void => {
          clearPendingActivation();
          const selection =
            typeof window.getSelection === "function"
              ? window.getSelection()
              : null;
          const collapsed = selection === null || selection.isCollapsed;
          if (collapsed && !selectionIncludesTitle(selection, titleEl)) {
            onActivate(action.id);
          }
        };
        const onPointerCancel = (): void => clearPendingActivation();
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("pointercancel", onPointerCancel);
        pendingActivationRef.current = (): void => {
          window.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("pointercancel", onPointerCancel);
        };
      } else {
        onClose(action.id);
      }
    },
    [id, active, onActivate, onClose, clearPendingActivation], // `input` derives from these props
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
        data-tab-colour={colourSlot}
        // Phase 58 (chunk 5) — the tab is NOT HTML5-draggable. Reorder runs
        // on pointer events (AppHeader), so an HTML5 drag must never start:
        // it would hijack the native text selection the title now supports.
        draggable={false}
        onMouseDown={onTabMouseDown}
      >
        {/* DEF-409 — the colourful style's decorative bottom-right flare.
         *  Out of flow and unfocusable in every style; only the colorful
         *  CSS override paints it. Purely visual, so it stays aria-hidden. */}
        <span className="tab-flare" aria-hidden />
        {/* Phase 45 (item 2) — the per-tab colour identity. A small filled
         *  chip at the tab's leading edge, painted from the slot token. It
         *  is the ONE colour-carrying element, so the tab's TEXT colour (and
         *  therefore every contrast floor) is untouched by the colour rule —
         *  the ACTIVE state still reads from the raised surface + accent
         *  underline + strong text, never from the chip. */}
        <span className="tab-colour-chip" aria-hidden />
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