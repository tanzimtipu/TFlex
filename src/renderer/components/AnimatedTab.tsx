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
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { resolveTabMouseDown, type TabInput } from "../state/tabMouseDown";
import { useTabVariants } from "../hooks/useAnimations";

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
  /** Phase 59 (item 10) — how far (px, >= 0) this tab is pulled LEFT over the
   *  previous one when the strip's overflow plan stacks the tabs. 0 / omitted
   *  means "not overlapped" (the first tab, and every strip that still fits).
   *  The value is declared as the `--tf-tab-overlap` custom property on the
   *  `<li>` wrapper — the element that is a REAL sibling inside `.tab-list` —
   *  and consumed by the wrapped `.tab`'s inter-tab margin rule, so the
   *  negative margin lands on the box the user sees. (DEF-420: the value used
   *  to be written on `.tab-list` and consumed by `.tab + .tab`, a selector the
   *  wrapped tabs never matched.) */
  overlapPx?: number;
  /** Phase 60 — this tab is the one currently under the pointer. It is lifted
   *  above the row and follows the pointer via `dragOffset`. */
  dragging?: boolean;
  /** Phase 60 — the live pointer travel (px) from the grab point. Applied as
   *  a transform on the tab box so the dragged tab follows the pointer. */
  dragOffset?: { x: number; y: number } | null;
  /** DEF-432 — while the tear-out is armed the dragged tab floats OUT of the
   *  `.tab-list` scroller: it is positioned absolutely against `.tab-area`
   *  (the non-scrolling clip owner) at the area-relative `left`/`top`, so the
   *  scroller keeps its `overflow-x: auto` and scroll position. `reserve*`
   *  pins the wrapping `<li>` to its original size so the non-dragged tabs
   *  cannot shift when the tab leaves the scroller's flow. */
  floating?: boolean;
  floatRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
    reserveWidth: number;
    reserveHeight: number;
  } | null;
  /** Phase 60 — how far (px) this NON-dragged tab shifts to open a gap for
   *  the dragged tab at the computed insertion slot. 0 means no reflow. The
   *  shift rides the `.tab` transition (shared motion tokens, so reduced
   *  motion / Animations OFF collapse it). */
  reflowPx?: number;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function AnimatedTab(props: AnimatedTabProps): ReactElement {
  const {
    id,
    title,
    active,
    modified,
    colourSlot = 0,
    overlapPx = 0,
    dragging = false,
    dragOffset = null,
    floating = false,
    floatRect = null,
    reflowPx = 0,
    onActivate,
    onClose,
  } = props;
  const variants = useTabVariants();
  const input: TabInput = { id, title, modified };

  // Phase 60 — direct manipulation. The dragged tab tracks the pointer with a
  // translate and NO transition (it must not lag the cursor); every non-
  // dragged tab shifts by its planned reflow offset, transitioned by the
  // `.tab` rule.
  const dragStyle: CSSProperties | undefined =
    dragging && dragOffset !== null
      ? { transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)` }
      : reflowPx !== 0
        ? { transform: `translateX(${reflowPx}px)` }
        : undefined;

  // The overlap is declared on the <li> (the real `.tab-list` sibling) as the
  // `--tf-tab-overlap` custom property; the wrapped `.tab` consumes it in the
  // `.tab-list > li:not(:first-child) > .tab` margin rule. Only a positive
  // overlap writes it, so the first tab and a non-overflowing strip keep the
  // default 0px margin. */
  const overlapStyle: CSSProperties | undefined =
    overlapPx > 0 ? ({ "--tf-tab-overlap": `${-overlapPx}px` } as CSSProperties) : undefined;

  // DEF-432 — when torn out, pin the tab absolutely against `.tab-area` (the
  // containing block; `.tab-list` is left `position: static` for exactly this)
  // at its captured grab geometry. `.tab-area` is not a scroll container, so
  // releasing its clip is harmless, while the `.tab-list` scroller stays
  // intact. The live `dragOffset` transform still rides on top, so the tab
  // tracks the pointer with no jump at the moment the float begins.
  const floatStyle: CSSProperties | undefined =
    floating && floatRect !== null
      ? {
          position: "absolute",
          left: floatRect.left,
          top: floatRect.top,
          width: floatRect.width,
          height: floatRect.height,
          margin: 0,
          zIndex: 60,
        }
      : undefined;
  // Keep the dragged `<li>` occupying its original slot now that its `.tab`
  // left the flow, so the non-dragged tabs cannot shift.
  const reserveStyle: CSSProperties | undefined =
    floating && floatRect !== null
      ? { width: floatRect.reserveWidth, height: floatRect.reserveHeight, flex: "0 0 auto" }
      : undefined;

  // Per-tab mousedown resolver: same classifier the strip-level handler
  // used, fed this tab only. A mousedown landing outside any .tab never
  // reaches here; a non-left button returns null (no accidental
  // activation from context-menu presses).
  //
  // Phase 59 (item 1) — activation is IMMEDIATE on mousedown from ANY
  // point on the tab (padding, gap, colour chip, the title), exactly as
  // before DEF-413. The title is no longer selectable, so there is no
  // drag-select to disambiguate and no deferred mouseup path.
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
    [active, onActivate, onClose], // `input` derives from these props
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
      data-tab-dragging={dragging ? "true" : undefined}
      style={{ ...overlapStyle, ...reserveStyle }}
    >
      <div
        className={active ? "tab tab-active" : "tab"}
        role="tab"
        aria-selected={active}
        data-tab-id={id}
        data-tab-colour={colourSlot}
        // Phase 58 (chunk 5) — the tab is NOT HTML5-draggable. Reorder runs
        // on pointer events (AppHeader). Phase 59 (item 1) keeps the drag
        // gesture on pointer events so a tab can be dragged from ANY area,
        // title included; an HTML5 drag would hijack that gesture.
        draggable={false}
        // Phase 60 — the live drag state, exposed for the gesture's tests and
        // styling. The dragged tab carries its pointer delta; a reflowing tab
        // carries the offset it is opening.
        data-tab-dragging={dragging ? "true" : undefined}
        data-tab-drag-x={dragging && dragOffset !== null ? String(Math.round(dragOffset.x)) : undefined}
        data-tab-drag-y={dragging && dragOffset !== null ? String(Math.round(dragOffset.y)) : undefined}
        data-tab-reflow={!dragging && reflowPx !== 0 ? String(Math.round(reflowPx)) : undefined}
        style={{ ...dragStyle, ...floatStyle }}
        onMouseDown={onTabMouseDown}
      >
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