// Phase 105 (chunk C) — the document rail.
//
// The tab strip used to live inside AppHeader's single caption row. Phase 105
// splits the chrome into ONE 48px title row (TitleBar + AppHeader) and a
// SEPARATE 40px document rail rendered below it. This component owns the rail:
// the tab strip (`.tab-area`/`.tab-list`), the AnimatedTab rows, the "+" new
// tab affordance, the pointer reorder / tear-out gesture and the uniform
// overflow plan.
//
// Behaviour is intentionally IDENTICAL to the pre-Phase-105 AppHeader strip:
// the same selectors (`[data-tab-id]`, `[data-new-tab]`, `data-tab-style`,
// `data-tab-tearout`), the same handlers (`onActivate` / `onClose` /
// `onMoveTab` / `onDetachTab` / `onNewEmptyTab`), the same Multi Mode disabled
// reason and the same DEF-411 / DEF-412 / DEF-432 rules. Only the surface's
// home changed. The pure helpers and constants are exported from here and
// re-exported by AppHeader so existing importers keep resolving.
//
// Rules preserved from AppHeader: hooks stay above any early return, no
// emojis, and the `-webkit-app-region` contract (the rail and its tabs are
// no-drag; styles.css scopes the rule).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { AnimatePresence } from "motion/react";
import { Icon } from "../icons/Icon";
import type { TabStyle } from "../../shared/types";
import type { TabInput } from "../state/tabMouseDown";
import { AnimatedTab } from "./AnimatedTab";
import { Button, IconButton } from "./Button";
import { TfMorph } from "./motion/TfMotion";
import { useMorphPreset } from "./motion/useMorphPreset";
// Phase 119 (chunk C) — the shared Adaptive Shell layout foundation. The rail
// resolves its layout class from the SAME strip measurement it already takes
// (no second observer, no useDocumentViewport); at "tight" the optional "+"
// utility collapses so the freed width keeps more document filenames visible.
import { LAYOUT, classifyViewport, type LayoutClass } from "../design/layout";

/** The tab projection the rail renders. `colorId` is the Phase 105 (chunk B)
 *  stable per-session identity; optional so legacy / harness callers that pass
 *  only id/title/modified still type-check. `filePath` (Phase 105 chunk D) is
 *  the switcher's duplicate-name context — it is NEVER painted across the rail,
 *  only used to disambiguate duplicate basenames inside the All-tabs popover. */
export type DocumentRailTab = TabInput & { colorId?: string; filePath?: string };

/** DEF-288 — the reason shown on the disabled "+" while Multi Mode is on. */
export const NEW_TAB_MULTI_MODE_REASON = "Turn off Multi Mode to create a new document";

/** TFL-1141 (TFL-1116 C7, R07) — the document rail is a DOCUMENT surface.
 *  With ZERO document sessions there is nothing to switch between, so the 40px
 *  rail row must not be mounted at all: Home gets no reserved blank tab strip.
 *  One session or more shows it. App folds the Multi Mode composite workspace
 *  into `stripTabs`, so `tabCount` already counts that composite tab — the rail
 *  therefore stays present while Multi Mode is on. Pure and exported so App
 *  keys the mount off ONE source and the unit test can pin the truth table. */
export function isDocumentRailVisible(tabCount: number): boolean {
  return tabCount > 0;
}

/* -------------------------------------------------------------------------
 * Phase 105 (chunk D) — the RESPONSIVE rail capacity planner.
 *
 * The retired uniform-shrink regime squeezed every tab toward 0 so the strip
 * always held every session. The rail now HIDES the sessions that do not fit
 * (they stay open and reachable through the All-tabs switcher) and never
 * renders a tab narrower than `RAIL_TAB_MIN_WIDTH` (136px) — no slivers.
 *
 * The controls (`[data-new-tab]` and `[data-all-tabs]`) are reserved FIRST, so
 * the visible tabs are planned against what is left. The plan is applied to
 * the DOM through `--tf-tab-width` on `.tab-list` (consumed by `.tab`), which
 * the CSS `transition` animates with the shared motion tokens.
 *
 * `planTabOverflow` / `TAB_OVERFLOW_METRICS` / `tabFitAvailableWidth` are kept
 * exported for the Phase 59/72 contract tests and legacy importers; they are no
 * longer used by the rendered rail.
 * ------------------------------------------------------------------------- */

/** The tab-to-tab gap (px) that the base CSS draws between two tabs. It is
 *  the SAME value `.tab`'s `margin-right` falls back to. */
export const TAB_GAP = 2;
/** Phase 72 (item 8) — the colorful per-tab shrink floor (retained contract
 *  reference; the rendered rail no longer shrinks below `RAIL_TAB_MIN_WIDTH`). */
export const MIN_TAB_WIDTH = 56;
/** Phase 72 (item 8) — the hard per-tab floor (retained contract reference). */
export const HARD_MIN_TAB_WIDTH = 24;

/** Phase 105 (chunk D) — the rail tab width band. The ideal (resting) tab is
 *  200px, it may grow to 220px when the strip is roomy, and it is NEVER
 *  rendered below 148px (Phase 119 chunk C widened the floor to the shared
 *  `LAYOUT.railMinTabPx`; tabs past the capacity are hidden, not squeezed). */
export const RAIL_TAB_IDEAL_WIDTH = 200;
export const RAIL_TAB_MAX_WIDTH = 220;
export const RAIL_TAB_MIN_WIDTH = LAYOUT.railMinTabPx;

/** Phase 105 (chunk D) — the responsive plan: the width every VISIBLE tab
 *  takes and how many tabs fit before the rest are hidden. */
export interface RailCapacityPlan {
  /** The width every visible tab takes. */
  width: number;
  /** How many leading tabs are rendered; the rest are hidden (still open). */
  visibleCount: number;
}

/**
 * Phase 105 (chunk D) — plan the responsive rail capacity.
 *
 * `reserveWidths` (the New-tab AND All-tabs controls plus their gaps) is
 * subtracted FIRST, so the controls are never clipped. With what remains:
 *  - if every tab fits at the ideal width, all are visible at the ideal;
 *  - otherwise the width is the largest value in [min, ideal] that fits all;
 *  - if not even `minWidth` lets all tabs fit, `visibleCount` is how many fit
 *    at exactly `minWidth` (every rendered tab therefore stays >= 136px).
 */
export function planRailCapacity(args: {
  count: number;
  availableWidth: number;
  idealWidth?: number;
  minWidth?: number;
  reserveWidths?: number;
  gap?: number;
}): RailCapacityPlan {
  const count = Math.max(0, Math.floor(args.count));
  const ideal = args.idealWidth ?? RAIL_TAB_IDEAL_WIDTH;
  const min = args.minWidth ?? RAIL_TAB_MIN_WIDTH;
  const gap = args.gap ?? TAB_GAP;
  const reserve = Math.max(0, args.reserveWidths ?? 0);
  const usable = args.availableWidth - reserve;

  if (count <= 0) return { width: ideal, visibleCount: 0 };
  if (!(usable > 0)) return { width: min, visibleCount: 0 };

  const atMin = Math.floor((usable + gap) / (min + gap));
  if (atMin >= count) {
    const fit = (usable - (count - 1) * gap) / count;
    const width = clampTab(Math.min(ideal, fit), min, ideal);
    return { width, visibleCount: count };
  }
  return { width: min, visibleCount: clampTab(atMin, 0, count) };
}

export interface TabOverflowPlan {
  /** The width every tab takes in the overflow regime. */
  width: number;
  /** How far each tab over the first is pulled left. Always 0 — the Phase 59
   *  stack/overlap regime is retired (kept for the frozen contract shape). */
  overlap: number;
}

function clampTab(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Plan the uniform per-tab width for `count` tabs that want `naturalWidth`
 * each inside `availableWidth`.
 *
 *  - Fits: every tab keeps its natural width.
 *  - Overflow: the width shrinks uniformly to the LARGEST value that still
 *    satisfies `count * width + (count - 1) * gap <= availableWidth`. The
 *    `floor` is applied only while it still fits — if even the floor would
 *    overflow, the width drops below it (and below `HARD_MIN_TAB_WIDTH`, down
 *    to 0), so the strip always contains every tab in ONE row. Tabs NEVER
 *    stack and NEVER overlap (Phase 72 item 7 retired the Phase 59 overlap
 *    regime), so `overlap` is always 0.
 */
export function planTabOverflow(args: {
  count: number;
  naturalWidth: number;
  availableWidth: number;
  floor: number;
  gap?: number;
}): TabOverflowPlan {
  const count = Math.max(0, Math.floor(args.count));
  const natural = Math.max(0, args.naturalWidth);
  const floor = clampTab(Math.max(0, args.floor), 0, natural);
  const gap = args.gap ?? TAB_GAP;

  if (count <= 0) return { width: natural, overlap: 0 };

  const required = count * natural + (count - 1) * gap;
  if (required <= args.availableWidth) return { width: natural, overlap: 0 };

  // Shrink uniformly to the fit width; the compactness floor can only lift the
  // width while it still fits. TFL-213 (DEF-441) — the fit invariant wins, so
  // the width may legally fall below `floor` (and below HARD_MIN_TAB_WIDTH):
  // `count * width + (count - 1) * gap <= availableWidth` always holds.
  const fit = Math.max(0, (args.availableWidth - (count - 1) * gap) / count);
  const lower = floor <= fit ? floor : 0;
  return {
    width: clampTab(fit, lower, natural),
    overlap: 0,
  };
}

/**
 * Phase 72 (item 8) / TFL-209 — the width the uniform tab fit may actually
 * use, after the strip's padding, the "+" affordance and the TRAILING gap.
 *
 * `planTabOverflow` reserves `(count - 1) * gap` between the tabs, but the
 * base CSS (`styles.css` `.tab { margin-right: 2px }` and the colorful
 * override) draws `margin-right: TAB_GAP` on EVERY `.tab` — the last one
 * included. Because the "+" `<li>` follows the last tab, the rendered strip is
 * exactly ONE gap wider than the plan, which pushed `scrollWidth` to
 * `clientWidth + TAB_GAP`. Subtracting the trailing gap here makes the plan
 * account for the full rendered width, so `scrollWidth <= clientWidth` holds
 * on the nose (the Phase 72 item 8 invariant).
 */
export function tabFitAvailableWidth(args: {
  clientWidth: number;
  paddingLeft: number;
  paddingRight: number;
  plusWidth: number;
  gap?: number;
}): number {
  const gap = args.gap ?? TAB_GAP;
  return args.clientWidth - args.paddingLeft - args.paddingRight - args.plusWidth - gap;
}

/** Per-style natural width (the tab at rest) and shrink floor. The colorful
 *  set is a single uniform 180px width; Phase 72 (item 8) drops its floor to
 *  `MIN_TAB_WIDTH` so the strip always fits every tab. The standard set sizes
 *  to content, so its natural is the softer ceiling and its floor is smaller. */
export const TAB_OVERFLOW_METRICS: Readonly<Record<TabStyle, { natural: number; floor: number }>> = {
  colorful: { natural: 180, floor: MIN_TAB_WIDTH },
  standard: { natural: 168, floor: 96 },
  /** Phase 123 redo — Chrome tabs match the browser band: a 240px ceiling (a
   *  readable filename) and a 72px crowded-strip floor (Chrome's minimum) so a
   *  short title is never clipped to a sliver while a long one ellipsises; the
   *  planner writes this into `--tf-tab-width`. */
  chrome: { natural: 240, floor: 72 },
};

/** Phase 105 (chunk D) — the parent-folder label for duplicate-name context.
 *  Returns the immediate parent folder only (never the full path); handles
 *  both `/` and `\` separators. Empty when there is no parent. */
export function tabFolderLabel(filePath: string | undefined): string {
  if (filePath === undefined || filePath === "") return "";
  const norm = filePath.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  if (idx <= 0) return "";
  const folder = norm.slice(0, idx);
  const parent = Math.max(folder.lastIndexOf("/"), folder.lastIndexOf("\\"));
  return parent >= 0 ? folder.slice(parent + 1) : folder;
}

/** Phase 105 (chunk D) — one row of the All-tabs switcher. */
export interface RailSwitcherRow {
  id: string;
  /** The complete filename (never truncated). */
  title: string;
  modified: boolean;
  /** The parent-folder context, present ONLY when the basename is duplicated. */
  context: string;
}

/** Phase 105 (chunk D) — build the switcher rows in canonical session order,
 *  attaching the parent-folder context only where two sessions share a
 *  basename. Pure and unit-tested; never emits full paths. */
export function buildSwitcherRows(tabs: readonly DocumentRailTab[]): RailSwitcherRow[] {
  const counts = new Map<string, number>();
  for (const t of tabs) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
  return tabs.map((t) => ({
    id: t.id,
    title: t.title,
    modified: t.modified,
    context: (counts.get(t.title) ?? 0) > 1 ? tabFolderLabel(t.filePath) : "",
  }));
}

/**
 * DEF-411 — decide whether committing a reorder must restore the
 * pre-drag active tab. The DEF-034 activation contract fires on the
 * pointerdown that arms the drag, so a background tab becomes active
 * before the reorder commits. The reducer's `move` preserves `activeId`,
 * but that separate activation path must be undone.
 *
 * Restore only when:
 *   - a tab was active before the drag (startActive !== null);
 *   - the dragged tab was NOT the active one (restoring it would be a
 *     pointless no-op and the reducer already preserves it);
 *   - the gesture actually reordered (target slot differs from the
 *     tab's origin index — a same-slot release is a no-op).
 */
export function shouldRestoreActiveOnReorder(
  startActive: string | null,
  draggingId: string,
  startIndex: number | null,
  targetIndex: number,
): boolean {
  if (startActive === null) return false;
  if (startActive === draggingId) return false;
  if (startIndex !== null && targetIndex === startIndex) return false;
  return true;
}

/**
 * Phase 58 (chunk 6b) — the tear-out decision for a finished tab drag.
 *
 * The gesture is ONE pointer drag. A release INSIDE (or horizontally
 * beyond) the strip is a reorder; a release more than `threshold` pixels
 * BELOW the strip's bottom edge is a tear-out into a new window. A
 * horizontal escape alone stays a reorder — only the vertical escape
 * detaches, so a user dragging a tab to the far left / right never
 * accidentally spawns a window.
 *
 * `hasDetach` gates the whole thing: when the host passed no
 * `onDetachTab`, every release is a reorder (never a silent no-op).
 */
export function tearOutDecision(args: {
  pointer: { x: number; y: number };
  strip: { left: number; right: number; top: number; bottom: number };
  hasDetach: boolean;
  threshold?: number;
}): "detach" | "reorder" {
  if (!args.hasDetach) return "reorder";
  const threshold = args.threshold ?? 24;
  if (args.pointer.y > args.strip.bottom + threshold) return "detach";
  return "reorder";
}

export interface DocumentRailProps {
  activeId: string | null;
  tabs: DocumentRailTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Phase 6 — spawn a brand-new empty tab. */
  onNewEmptyTab: () => void;
  /** DEF-288 — true while Multi Mode is on: the rail shows ONE composite
   *  workspace tab, so the "+" is disabled with a reason. */
  multiModeEnabled?: boolean;
  /** Phase 58 — the tab-strip style preference, rendered as `data-tab-style`. */
  tabStyle?: TabStyle;
  /** Phase 58 (chunk 5) — reorder a tab to a new strip index. Omitted means
   *  reordering is disabled (harnesses / pre-Phase-58 mounts). */
  onMoveTab?: (id: string, toIndex: number) => void;
  /** Phase 58 (chunk 6b) — tear a tab OUT into a new app window. Omitted means
   *  the tear-out gesture is not available; the rail then treats every drag as
   *  a reorder. */
  onDetachTab?: (id: string) => void;
}

export function DocumentRail(props: DocumentRailProps): ReactElement {
  const {
    activeId,
    tabs,
    onActivate,
    onClose,
    onNewEmptyTab,
    multiModeEnabled = false,
    tabStyle = "colorful",
    onMoveTab,
    onDetachTab,
  } = props;

  // Phase 72 (item 8) — the tab strip (.tab-list). The measure effect below
  // reads it to size the uniform fit width; the strip is not a scroll container.
  const tabListRef = useRef<HTMLUListElement | null>(null);

  // Phase 105 (chunk D) — the responsive capacity plan. Measure the strip's
  // content width, reserve the New-tab AND All-tabs controls FIRST, then plan
  // how many tabs fit at >= RAIL_TAB_MIN_WIDTH. The plan rides `--tf-tab-width`
  // on `.tab-list`; the CSS transition (shared motion token) animates it and the
  // reduced-motion / Animations-OFF catch-all collapses it to instant. Nothing
  // is applied while the strip is unmeasured (jsdom / zero width), so a bare
  // harness mount renders every tab at its resting width.
  const [railPlan, setRailPlan] = useState<RailCapacityPlan | null>(null);
  // Phase 119 (chunk C) — the resolved layout class for the rail, read from the
  // SAME `.tab-list` measurement below. "tight" collapses the standalone "+"
  // utility (its width is freed for document filenames) and moves New tab into
  // the All-tabs popover. Unmeasured (jsdom / zero width) stays "wide".
  const [railLayoutClass, setRailLayoutClass] = useState<LayoutClass>("wide");
  const windowStartRef = useRef(0);
  useEffect((): (() => void) | undefined => {
    const list = tabListRef.current;
    if (list === null) return undefined;
    const measure = (): void => {
      const computed = window.getComputedStyle(list);
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const paddingRight = parseFloat(computed.paddingRight) || 0;
      const available = list.clientWidth - paddingLeft - paddingRight;
      // jsdom / a zero-width strip: leave the resting layout alone.
      if (!(available > 0)) {
        setRailPlan(null);
        return;
      }
      // Phase 119 (chunk C) — resolve the layout class from the SAME measured
      // width (no second observer / viewport hook). At "tight" the standalone
      // "+" collapses, so `newTab` reserves no width and the freed space keeps
      // more document tabs (filenames) visible.
      const layoutClass = classifyViewport(available);
      setRailLayoutClass((prev) => (prev === layoutClass ? prev : layoutClass));
      const collapsed = layoutClass === "tight";
      // Phase 105 (chunk D) — reserve BOTH controls (and one gap each) FIRST,
      // so the New-tab and All-tabs controls are never clipped by the plan.
      const newTab = collapsed
        ? 0
        : ((list.querySelector(".tab-list-new") as HTMLElement | null)?.offsetWidth ?? 0);
      const allTabs =
        (list.querySelector(".tab-list-all") as HTMLElement | null)?.offsetWidth ?? 0;
      const next = planRailCapacity({
        count: tabs.length,
        availableWidth: available,
        reserveWidths: newTab + allTabs + 2 * TAB_GAP,
      });
      setRailPlan((prev) =>
        prev !== null && prev.width === next.width && prev.visibleCount === next.visibleCount
          ? prev
          : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver((): void => measure()) : null;
    observer?.observe(list);
    return (): void => {
      observer?.disconnect();
    };
  }, [tabs.length, tabStyle]);

  // Phase 105 (chunk D) — the visible window. Unmeasured (jsdom / harness)
  // renders every tab. When the plan hides sessions, the window SHIFTS so the
  // selected document is always inside it, and never renders fewer than one tab.
  const totalTabs = tabs.length;
  const activeIndex = activeId === null ? -1 : tabs.findIndex((t) => t.id === activeId);
  let visibleCount = totalTabs;
  let windowStart = 0;
  if (railPlan !== null && totalTabs > 0) {
    visibleCount = Math.max(1, Math.min(railPlan.visibleCount, totalTabs));
    if (visibleCount < totalTabs && activeIndex >= visibleCount) {
      windowStart = Math.max(0, Math.min(activeIndex - visibleCount + 1, totalTabs - visibleCount));
    }
  }
  windowStartRef.current = windowStart;

  // Phase 105 (chunk D) — a tab is hidden when it falls outside the visible
  // window. It stays MOUNTED (so reorder / close stay stable and a capacity
  // reflow never plays an exit animation) but is hidden from the rail.
  const isHiddenAt = (index: number): boolean =>
    railPlan !== null &&
    totalTabs > 0 &&
    (index < windowStart || index >= windowStart + visibleCount);

  // Phase 105 (chunk D) — the planned width rides `--tf-tab-width` on
  // `.tab-list` (the `.tab` rule consumes it). Unmeasured leaves the resting
  // fallback width.
  const tabOverflowStyle: CSSProperties | undefined =
    railPlan !== null
      ? ({ "--tf-tab-width": `${railPlan.width}px` } as CSSProperties)
      : undefined;

  // Phase 119 (chunk C) — at a "tight" rail the standalone "+" utility collapses
  // and New tab moves into the All-tabs popover as its FIRST labelled row, so
  // the freed width keeps more document filenames visible. There is never more
  // than one New-tab affordance at a time.
  const railCollapsed = railLayoutClass === "tight";

  // Phase 105 (chunk D) — the All-tabs switcher. An anchored, opaque,
  // collision-aware popover listing EVERY session in canonical order. Mirrors
  // the TitleBar File popover / AppHeader app-menu machinery: `useMorphPreset`
  // + `TfMorph`, outside-click and Escape close (Escape returns focus to the
  // trigger), arrow-key roving across the rows.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Phase 105 (chunk D) — the fixed popover placement. `.tab-area`/`.tab-list`
  // both clip (`overflow: hidden`), so the popover is `position: fixed` (fixed
  // descendants escape an ancestor's overflow clip) and anchored from the
  // trigger rect with a simple collision flip. Measured at open time, before
  // the surface mounts, so `useMorphPreset` reads a settled rect.
  const [switcherPos, setSwitcherPos] = useState<{ top: number; left: number } | null>(null);
  const switcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const switcherPopoverRef = useRef<HTMLDivElement | null>(null);
  const switcherRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const switcherMorph = useMorphPreset({
    open: switcherOpen,
    triggerRef: switcherButtonRef,
    surfaceRef: switcherPopoverRef,
    anchorCorner: "top-left",
  });
  const switcherRows = buildSwitcherRows(tabs);

  useEffect(() => {
    if (!switcherOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (switcherButtonRef.current?.contains(t)) return;
      if (switcherPopoverRef.current?.contains(t)) return;
      setSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setSwitcherOpen(false);
        switcherButtonRef.current?.focus();
      } else if (e.key === "Tab") {
        setSwitcherOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  // Phase 105 (chunk D) — when the switcher opens, move focus to the current
  // session's row (or the first), so arrow roving works immediately.
  useEffect(() => {
    if (!switcherOpen) return;
    const index = switcherRows.findIndex((r) => r.id === activeId);
    switcherRowRefs.current[index >= 0 ? index : 0]?.focus();
    // Re-run only on open/close; the row set is read at open time.
  }, [switcherOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSwitcherToggle = useCallback((): void => {
    if (switcherOpen) {
      setSwitcherOpen(false);
      return;
    }
    const rect = switcherButtonRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      const width = 320;
      const maxHeight = 360;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = rect.bottom + 4;
      const flipUp = below + maxHeight > window.innerHeight && rect.top > maxHeight + 4;
      setSwitcherPos({ top: flipUp ? Math.max(8, rect.top - maxHeight - 4) : below, left });
    }
    setSwitcherOpen(true);
  }, [switcherOpen]);

  const onSwitcherPick = useCallback(
    (id: string): void => {
      onActivate(id);
      setSwitcherOpen(false);
    },
    [onActivate],
  );

  // Phase 119 (chunk C) — the overflow New-tab row. It reuses the existing
  // `onNewEmptyTab` prop (no second creation path) and closes the popover.
  const onSwitcherNewTab = useCallback((): void => {
    onNewEmptyTab();
    setSwitcherOpen(false);
  }, [onNewEmptyTab]);

  const onSwitcherKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = switcherRowRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (els.length === 0) return;
    const focused = els.findIndex((el) => el === document.activeElement);
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const base = focused >= 0 ? focused : -dir;
    const next = ((base + dir) % els.length + els.length) % els.length;
    els[next]?.focus();
  }, []);

  // The "+ tab" button keeps its mousedown stopPropagation so a future
  // strip-level listener can never misread it as an activation hit.
  const onNewTabMouseDown = useCallback((e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
  }, []);

  // ==========================================================================
  // Phase 58 (chunk 5) — pointer-driven tab reorder.
  //
  // The gesture is deliberately NOT HTML5 drag: it would hijack the pointer
  // and could not arm from every point on the tab. Pointer events let us run
  // one gesture:
  //
  //   - `pointerdown` on a tab (target outside `.tab-close`) ARMS a pending
  //     drag from ANY point on the tab — padding, gap, colour chip and the
  //     title all arm it, so a tab can be dragged from any area;
  //   - the FIRST `pointermove` past a 6px threshold (total movement) begins
  //     the reorder;
  //   - while reordering, the target slot is computed from pointer X against
  //     the midpoints of the OTHER tabs; Phase 60 drives the feedback by direct
  //     manipulation: the dragged tab follows the pointer and the other tabs
  //     reflow to open the insertion gap (the static drop marker is retired);
  //   - `pointerup` commits via `onMoveTab`, `pointercancel` discards.
  //
  // No preventDefault / stopPropagation on these handlers (AGENTS.md
  // cross-bubbling rule): the DEF-034 mousedown activation contract and the
  // close button are untouched. The reducer carries activeId through, so a
  // reorder never changes the active document.
  // ==========================================================================
  // DEF-412 — the ARM gate must NOT require more than one tab: a freshly
  // detached window holds exactly one tab, and BOTH the tear-out (origin)
  // and the drag-back (detached) gestures must be armable there. The
  // tab-count guard now lives on the reorder COMMIT (see `finish`), so a
  // single-tab drag can still detach but can never commit a meaningless
  // reorder. `!multiModeEnabled` still disables the gesture entirely on the
  // single composite workspace tab.
  const dragGestureEnabled =
    (onMoveTab !== undefined || onDetachTab !== undefined) &&
    !multiModeEnabled;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ index: number; left: number } | null>(null);
  // Phase 58 (chunk 6b) — true while the drag is past the tear-out
  // threshold (below the strip). Drives the `data-tab-tearout` affordance.
  const [tearOut, setTearOut] = useState(false);
  // Phase 60 — direct manipulation. `dragOffset` is the live pointer travel
  // from the grab point: the dragged tab's `.tab` box is translated by it so
  // the tab follows the pointer. `dragWidth` is the dragged tab's measured
  // width — the size of the gap the OTHER tabs open at the computed slot.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragWidth, setDragWidth] = useState(0);
  // DEF-432 — the dragged tab's geometry captured ONCE at arm time, before any
  // drag transform is applied. While the tear-out arms the tab is floated OUT
  // of the `.tab-list`: AnimatedTab positions it absolutely against `.tab-area`
  // (the non-scrolling clip owner) at these coordinates, so the strip stays
  // `overflow: hidden`. `reserve*` keeps the dragged `<li>`
  // occupying its original slot so the non-dragged tabs cannot shift.
  const [dragRect, setDragRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    reserveWidth: number;
    reserveHeight: number;
  } | null>(null);
  // Gesture source-of-truth refs: the window listeners are subscribed once
  // per gesture window and must read the LATEST values without resubscribing.
  const pendingDragRef = useRef<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  // DEF-411 — the pre-drag active tab + the dragged tab's origin index,
  // captured at ARM time. The DEF-034 mousedown activation fires on the
  // pointerdown that arms the drag, so committing a reorder must restore
  // the tab that was active before the gesture (Phase 58 success
  // criterion 4: after a reorder the active document is unchanged).
  const dragStartActiveRef = useRef<string | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  const onMoveTabRef = useRef(onMoveTab);
  useEffect(() => {
    onMoveTabRef.current = onMoveTab;
  }, [onMoveTab]);
  const onDetachTabRef = useRef(onDetachTab);
  useEffect(() => {
    onDetachTabRef.current = onDetachTab;
  }, [onDetachTab]);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  // Arm the pending drag. Delegated on `.tab-list`, so a hit on any tab's
  // padding / title / gap arms it, while `.tab-close` hits do not.
  const onTabListPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLUListElement>): void => {
      if (!dragGestureEnabled) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target === null) return;
      if (target.closest(".tab-close") !== null) return;
      const tabEl = target.closest<HTMLElement>("[data-tab-id]");
      if (tabEl === null) return;
      const id = tabEl.dataset.tabId;
      if (id === undefined) return;
      // DEF-411 — snapshot the pre-drag active tab and the dragged tab's
      // origin index at the moment the drag is armed, so the commit can
      // restore the active document the DEF-034 mousedown activation
      // overwrote.
      const list = tabListRef.current;
      const siblings = list === null
        ? []
        : Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]")).filter(
            (n) => n.closest("[data-tab-overflow='hidden']") === null,
          );
      dragStartIndexRef.current =
        windowStartRef.current + siblings.findIndex((n) => n.dataset.tabId === id);
      dragStartActiveRef.current = activeId ?? null;
      pendingDragRef.current = { id, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
    },
    [dragGestureEnabled, activeId],
  );

  useEffect(() => {
    if (!dragGestureEnabled) return;

    const clearDrag = (): void => {
      document.body.classList.remove("tab-reordering");
      const el = tabListRef.current;
      if (el !== null) el.removeAttribute("data-tab-drop");
      draggingIdRef.current = null;
      dropIndexRef.current = null;
      setDraggingId(null);
      setDrop(null);
      setTearOut(false);
      setDragOffset(null);
      setDragWidth(0);
      setDragRect(null);
    };

    // Insert position in the list WITHOUT the dragged tab: number of other
    // tabs whose midpoint the pointer has passed. This is exactly the
    // index `moveTab` inserts at after splicing the dragged tab out.
    const computeDrop = (x: number): { index: number; left: number } | null => {
      const el = tabListRef.current;
      if (el === null) return null;
      const dragging = draggingIdRef.current;
      const others = Array.from(el.querySelectorAll<HTMLElement>("[data-tab-id]")).filter(
        (n) => n.dataset.tabId !== dragging && n.closest("[data-tab-overflow='hidden']") === null,
      );
      if (others.length === 0) return null;
      const listRect = el.getBoundingClientRect();
      let index = others.length;
      let boundaryX = others[others.length - 1].getBoundingClientRect().right;
      for (let i = 0; i < others.length; i += 1) {
        const r = others[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          index = i;
          boundaryX = r.left;
          break;
        }
      }
      return { index, left: boundaryX - listRect.left + el.scrollLeft };
    };

    const onMove = (e: PointerEvent): void => {
      const pending = pendingDragRef.current;
      if (pending === null || e.pointerId !== pending.pointerId) return;

      if (draggingIdRef.current === null) {
        // DEF-412 — arm on TOTAL movement, not horizontal only: the actual
        // tear-out gesture is a straight-downward drag (near-zero dx), so a
        // horizontal-only threshold could never arm it.
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) <= 6) return; // not yet a drag
        draggingIdRef.current = pending.id;
        setDraggingId(pending.id);
        // Phase 60 — measure the dragged tab ONCE at arm time. Its width is
        // the gap the other tabs must open at the insertion slot; the tab box
        // itself then follows the pointer (see the offset below).
        const list = tabListRef.current;
        const draggedEl =
          list === null
            ? undefined
            : Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]")).find(
                (n) => n.dataset.tabId === pending.id,
              );
        setDragWidth(draggedEl?.getBoundingClientRect().width ?? 0);
        // DEF-432 — snapshot the dragged tab's natural geometry (relative to
        // the `.tab-area` containing block) plus its `<li>` reserve size before
        // the first drag transform lands, so the tear-out float can be applied
        // without a jump and the origin slot stays occupied.
        const tabBox = draggedEl?.getBoundingClientRect();
        const areaBox = list?.closest(".tab-area")?.getBoundingClientRect();
        const liBox = draggedEl?.parentElement?.getBoundingClientRect();
        setDragRect(
          tabBox === undefined
            ? null
            : {
                left: tabBox.left - (areaBox?.left ?? 0),
                top: tabBox.top - (areaBox?.top ?? 0),
                width: tabBox.width,
                height: tabBox.height,
                reserveWidth: liBox?.width ?? tabBox.width,
                reserveHeight: liBox?.height ?? tabBox.height,
              },
        );
        document.body.classList.add("tab-reordering");
      }

      // Phase 60 — the dragged tab tracks the pointer live. This is the raw
      // pointer delta from the grab point, written as a transform on the tab
      // box so the committed order / slot math below is untouched.
      setDragOffset({ x: e.clientX - pending.startX, y: e.clientY - pending.startY });

      const next = computeDrop(e.clientX);
      // DEF-412 — with a single tab `computeDrop` returns null (there is no
      // other tab to insert beside), but the tear-out affordance and the
      // release decision are independent of the tab count, so the gesture
      // must still track it. Only the insertion gap / reflow is skipped in
      // that case.
      if (next !== null) {
        dropIndexRef.current = next.index;
        setDrop(next);
      }
      // Phase 58 (chunk 6b) — the tear-out affordance. The decision
      // mirrors `tearOutDecision` at release time so the highlight only
      // appears when a release would actually detach.
      const list = tabListRef.current;
      if (list !== null) {
        const r = list.getBoundingClientRect();
        setTearOut(
          tearOutDecision({
            pointer: { x: e.clientX, y: e.clientY },
            strip: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            hasDetach: onDetachTabRef.current !== undefined,
          }) === "detach",
        );
      }
    };

    const finish = (commit: boolean, x: number, y: number): void => {
      pendingDragRef.current = null;
      const dragging = draggingIdRef.current;
      const startActive = dragStartActiveRef.current;
      const startIndex = dragStartIndexRef.current;
      // Clear the DEF-411 snapshot on every pointerup / pointercancel
      // alongside the other gesture state.
      dragStartActiveRef.current = null;
      dragStartIndexRef.current = null;
      if (dragging === null) return;
      // Phase 58 (chunk 6b) — a release past the tear-out threshold below
      // the strip detaches the tab into a new window and SKIPS the reorder
      // commit (and its DEF-411 restore). Everything else keeps the exact
      // Chunk-5 reorder behaviour below.
      const detachHandler = onDetachTabRef.current;
      if (commit && detachHandler !== undefined) {
        const list = tabListRef.current;
        if (list !== null) {
          const r = list.getBoundingClientRect();
          const decision = tearOutDecision({
            pointer: { x, y },
            strip: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            hasDetach: true,
          });
          if (decision === "detach") {
            detachHandler(dragging);
            clearDrag();
            return;
          }
        }
      }
      const target = dropIndexRef.current;
      // Phase 105 (chunk D) — `computeDrop` counts the RENDERED tabs, so map
      // the slice-relative slot back to the full session order before commit.
      const fullTarget = target === null ? null : target + windowStartRef.current;
      const handler = onMoveTabRef.current;
      // DEF-412 — the reorder COMMIT (not the arm) owns the tab-count guard:
      // `onMoveTab` only fires for a real multi-tab reorder to a DIFFERENT
      // slot. With exactly one tab `computeDrop` sees no other tabs and
      // leaves `target` null, so a non-tear-out release is a harmless no-op
      // (never a meaningless `onMoveTab` with a bogus index); a same-slot
      // release was already a reducer identity. A genuine multi-tab move is
      // unaffected, so the Phase 58 reorder behaviour is unchanged.
      if (
        commit &&
        handler !== undefined &&
        tabs.length > 1 &&
        fullTarget !== null &&
        fullTarget !== startIndex
      ) {
        handler(dragging, fullTarget);
        // DEF-411 — the DEF-034 activation fired on the arming
        // pointerdown, so restore the pre-drag active tab after the
        // reorder commits. A plain click / tap never reaches here
        // (dragging stays null), and a dragged active tab needs no
        // restore (the reducer carries activeId through).
        if (shouldRestoreActiveOnReorder(startActive, dragging, startIndex, fullTarget)) {
          onActivateRef.current(startActive as string);
        }
      }
      clearDrag();
    };

    const onUp = (e: PointerEvent): void => finish(true, e.clientX, e.clientY);
    const onCancel = (): void => finish(false, 0, 0);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [dragGestureEnabled, tabs.length]);

  // Phase 60 — the dragged tab's origin index in the CURRENT strip order. The
  // reflow is a pure function of (origin index, computed drop slot, dragged
  // width): every non-dragged tab between the origin and the target slot
  // shifts by the dragged width to close the origin hole / open the target
  // gap, and the drop slot is still the ONE source of truth (`computeDrop`).
  const draggingIndex = draggingId === null ? -1 : tabs.findIndex((t) => t.id === draggingId);
  const reflowFor = (index: number): number => {
    if (draggingId === null || dragWidth <= 0 || drop === null) return 0;
    if (index === draggingIndex) return 0;
    // `drop.index` is slice-relative; map it to the full session order.
    const dropIndex = drop.index + windowStartRef.current;
    // Index in the list WITHOUT the dragged tab (the same frame `drop.index`
    // is computed in, and the frame `moveTab` inserts at).
    const reduced = index < draggingIndex ? index : index - 1;
    if (dropIndex > draggingIndex) {
      return reduced >= draggingIndex && reduced < dropIndex ? -dragWidth : 0;
    }
    if (dropIndex < draggingIndex) {
      return reduced >= dropIndex && reduced < draggingIndex ? dragWidth : 0;
    }
    return 0;
  };

  return (
    <div
      className="document-rail"
      data-document-rail
      data-tab-style={tabStyle}
      data-rail-overflow={railCollapsed ? "true" : undefined}
    >
      <div className="tab-area" role="tablist" aria-label="Open documents" data-tab-style={tabStyle} data-tab-tearout={tearOut ? "true" : undefined}>
        <ul
          className="tab-list"
          ref={tabListRef}
          data-reorder={dragGestureEnabled ? "true" : undefined}
          data-tab-drop={drop !== null ? String(drop.index) : undefined}
          data-tab-tearout={tearOut ? "true" : undefined}
          data-dragging-tab={draggingId ?? undefined}
          onPointerDown={dragGestureEnabled ? onTabListPointerDown : undefined}
          // Phase 58 (chunk 6b) — the tear-out affordance. Token-based
          // inline styling (the chunk's file scope excludes styles.css):
          // a dashed accent outline marks the strip as a "release here to
          // detach" target while the drag is past the threshold.
          style={{
            ...(tabOverflowStyle ?? {}),
            ...(tearOut
              ? {
                  outline: "2px dashed var(--accent)",
                  outlineOffset: "-2px",
                  transition:
                    "outline-color var(--motion-duration-fast, 200ms) var(--motion-ease-standard, ease)",
                }
              : {}),
          }}
        >
          {/* Cross-theme animation system — one presence boundary owns
              every tab: new tabs play Tab Materialize (opacity in),
              closed tabs play Tab Dissolve (opacity out) before the li
              unmounts. `initial={false}` keeps the page-load tabs from
              animating — only tabs opened during the session
              materialize. */}
          <AnimatePresence initial={false}>
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeId;
              const isDragging = tab.id === draggingId;
              return (
                <AnimatedTab
                  key={tab.id}
                  id={tab.id}
                  title={tab.title}
                  active={isActive}
                  modified={tab.modified}
                  // Phase 105 (chunk D) — colour is identity-only now. The
                  // per-session `colorId` from `TabMeta.colorId` is the single
                  // colour source; the retired index-slot `colourSlot` is gone.
                  colorId={tab.colorId}
                  // Phase 60 — direct manipulation: the dragged tab follows
                  // the pointer, every other tab opens the insertion gap.
                  dragging={isDragging}
                  dragOffset={isDragging ? dragOffset : null}
                  // DEF-432 — while torn out the dragged tab floats out of the
                  // `.tab-list` (absolute against `.tab-area`), which clips its
                  // own overflow (`overflow: hidden`) and keeps the strip from
                  // scrolling.
                  floating={isDragging && tearOut}
                  floatRect={isDragging ? dragRect : null}
                  reflowPx={reflowFor(index)}
                  hidden={isHiddenAt(index)}
                  onActivate={onActivate}
                  onClose={onClose}
                />
              );
            })}
          </AnimatePresence>
          {/* Phase 7 — the "+ tab" affordance now sits immediately
              after the rightmost tab.
              DEF-055 — the affordance is gated on `tabs.length >= 1`.
              DEF-288 — while Multi Mode is on the strip shows ONE
              composite workspace tab, so the "+" is disabled and carries
              the reason instead of mutating hidden state.
              Phase 119 (chunk C) — at a "tight" rail the standalone "+"
              collapses (`data-rail-new-collapsed`); New tab moves into the
              All-tabs popover below and this utility reserves no width. */}
          {tabs.length >= 1 && (
            <li
              className="tab-list-new"
              data-rail-new-collapsed={railCollapsed ? "true" : undefined}
              title={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : undefined}
            >
              <IconButton
                label={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : "New empty tab"}
                intent="secondary"
                kind="action"
                density="compact"
                className="tab-new"
                onMouseDown={onNewTabMouseDown}
                onClick={onNewEmptyTab}
                disabled={multiModeEnabled}
                hidden={railCollapsed}
                data-new-tab
                icon={<Icon name="tabNew" size="md" aria-hidden />}
              />
            </li>
          )}
          {/* Phase 105 (chunk D) — the All-tabs switcher. Sits immediately
              after the "+" and lists EVERY session in canonical order. */}
          {tabs.length >= 1 && (
            <li className="tab-list-all">
              <IconButton
                ref={switcherButtonRef}
                label={`All open documents (${tabs.length})`}
                intent="tertiary"
                kind="disclosure"
                density="compact"
                expanded={switcherOpen}
                className={switcherOpen ? "tab-all tab-all-active" : "tab-all"}
                onClick={onSwitcherToggle}
                aria-haspopup="menu"
                data-all-tabs
                icon={<Icon name="headerMenuDisclosure" size="md" aria-hidden />}
              />
              <AnimatePresence>
                {switcherOpen && (
                  <TfMorph
                    morph={switcherMorph}
                    ref={switcherPopoverRef}
                    className="all-tabs-popover"
                    role="menu"
                    aria-label="All open documents"
                    data-all-tabs-popover
                    onKeyDown={onSwitcherKeyDown}
                    style={switcherPos ?? undefined}
                  >
                    <div className="all-tabs-count" role="presentation">
                      {`${tabs.length} ${tabs.length === 1 ? "document" : "documents"}`}
                    </div>
                    <div className="all-tabs-rows">
                      {/* Phase 119 (chunk C) — when the standalone "+" is
                          collapsed the popover leads with a labelled New-tab
                          row, wired to the SAME `onNewEmptyTab` prop. It is
                          never rendered beside a visible "+". */}
                      {railCollapsed && (
                        <Button
                          intent="secondary"
                          kind="action"
                          density="standard"
                          className="all-tabs-row"
                          role="menuitem"
                          data-rail-overflow-new
                          disabled={multiModeEnabled}
                          title={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : undefined}
                          onClick={onSwitcherNewTab}
                        >
                          <span className="all-tabs-name">New tab</span>
                        </Button>
                      )}
                      {switcherRows.map((row, rowIndex) => (
                        <Button
                          key={row.id}
                          ref={(el): void => {
                            switcherRowRefs.current[rowIndex] = el;
                          }}
                          intent="secondary"
                          kind="action"
                          density="standard"
                          className={
                            row.id === activeId
                              ? "all-tabs-row all-tabs-row-current"
                              : "all-tabs-row"
                          }
                          role="menuitem"
                          aria-current={row.id === activeId ? "true" : undefined}
                          aria-label={
                            `${row.title}${row.context !== "" ? `, in ${row.context}` : ""}${row.modified ? ", unsaved changes" : ""}`
                          }
                          title={row.context !== "" ? `${row.title} — ${row.context}` : row.title}
                          data-all-tabs-row={row.id}
                          onClick={(): void => onSwitcherPick(row.id)}
                        >
                          <span className="all-tabs-name">{row.title}</span>
                          {row.context !== "" && (
                            <span className="all-tabs-context">{row.context}</span>
                          )}
                          {row.modified && (
                            <>
                              <span className="all-tabs-dot" aria-hidden />
                              <span className="visually-hidden">Unsaved changes</span>
                            </>
                          )}
                        </Button>
                      ))}
                    </div>
                  </TfMorph>
                )}
              </AnimatePresence>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
