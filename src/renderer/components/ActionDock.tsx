// Phase 36 (chunk 3a) â€” the Action Dock.
//
// ONE component, floating at the bottom-centre of the canvas, with exactly the
// four legal states from REQUIREMENTS.md (Phase 36). It is ADDITIVE in this
// chunk: the command toolbar, the rail, the palette and the flyout all stay,
// and nothing here retires or reimplements an action. Every verb the dock
// renders comes from `toolsForStage(activeStage)` and every command it runs is
// the host's EXISTING handler (the host supplies `onRunTool` / the bulk ops).
//
//   State 1  stage verbs       â€” the active stage's registry entries, first
//                                button accent-soft, unavailable verbs
//                                DISABLED (never hidden) with a tooltip reason.
//   State 2  selection override â€” >=1 pages selected in PAGES: the `[N pages]`
//                                chip plus Rotate / Extract / Delete / Clear
//                                (section 3A ruling 9: Merge is NOT a dock verb
//                                - it lives on the PAGES panel header only).
//                                Clear returns to State 1.
//   State 3  pinned tools      â€” dockPins after a trailing divider; a pin that
//                                duplicates the current set is dropped and the
//                                divider collapses. Right-click pins/unpins.
//   State 4  idle              â€” a modifier on any state: fade to 40% after 3s
//                                without activity, never while armed/dragging.
//
// Cross-bubbling rules (AGENTS.md) are honoured: the only preventDefault is on
// the dock item's own `contextmenu` (a targeted suppression, like the
// ContextPanel's thumb menu); no catch-all pointerdown/click handler exists and
// no event is stopped from reaching its own target.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { isCoarsePointer } from '../design/layout';
import type { QuietIconId } from '../icons/quietPrecision';
import { Button, IconButton } from './Button';
import type { ButtonIntent } from './Button';
// TFL-1004 (TFL-855 chunk C9) — the Add-a-tool picker and the More overflow
// menu adopt the shared `CommandMenu` primitive (mirroring C5/C7/C8). It owns
// dismissal, focus capture/return and the row keyboard model; the dock keeps
// only the DATA and the placement math, and the legacy `data-dock-*` hooks
// survive through `popoverDataAttrs` / `rowDataAttrs`.
import { CommandMenu } from './CommandMenu';
import type { CommandMenuGroup, CommandMenuItem } from './CommandMenu';
import {
  DOCK_AVAILABILITY_REASON,
  DOCK_BULK_IDS,
  DOCK_CLEAR_ID,
  DOCK_IDLE_MS,
  defaultDockEnabled,
  dedupePinsAgainst,
  dockPinAffordance,
  dockPrimaryState,
  isDockCompact,
  isDockIconOnly,
  planDockOverflow,
  sanitizeDockPins,
  sanitizeDockUnpinned,
  selectionChipLabel,
} from '../state/dockModel';
import { resolveDockLadder, type DockLadder } from '../state/dockResponsive';
import { useRowOverflow } from '../hooks/useRowOverflow';
import { useInstantMotion } from '../hooks/useAnimations';
import { MOTION_DURATION } from '../hooks/motionTokens';
import {
  DOCK_PILL_GAP,
  dockBand,
  dockCap,
  dockPlanWidth,
  dockReserveFor,
  iconOnlyDockNeed,
  labelledDockNeed,
  labelsFitBand,
  pillBandHeight,
  pillBasisFromWidths,
  pillFreeBand,
  pillReserve,
  shouldLiftDock,
  type PillBox,
} from '../state/dockFit';
import { toolById, dockToolsForStage, dockPrimaryIdsForStage, DOCK_SHORT_LABELS, dockEligible, dockEligibleIdsForStage, isPinVisibleInStage, type ToolEntry } from '../state/toolsRegistry';
import {
  PAGE_COMPACT_W,
  PAGE_FULL_W,
  PILL_HEIGHT,
  PILL_RAISE,
  ZOOM_COMPACT_W,
  ZOOM_FULL_W,
  pillMode,
} from '../state/pillFit';
import type { Stage } from '../state/stages';

/** The State 2 bulk verbs, reusing the EXISTING multi-page engine/dialog
 *  paths. The host owns them; the dock only passes the selected page array.
 *  Section 3A ruling 9: no Merge — `＋ Combine…` is the PAGES panel header's. */
export interface DockBulkActions {
  onRotate: (pages: readonly number[]) => void;
  onExtract: (pages: readonly number[]) => void;
  onDelete: (pages: readonly number[]) => void;
}

export interface ActionDockProps {
  /** The stage in force for this pane (App's stage model). */
  activeStage: Stage;
  /** The visible 1-based pages selected in the PAGES panel, ascending. */
  pageSelection: readonly number[];
  /** State 2's Clear â€” empties the selection and returns to State 1. */
  onClearPageSelection: () => void;
  /** State 2's bulk verbs (existing engine / dialog paths). */
  bulk: DockBulkActions;
  /** Registry tool ids pinned to the dock, in order (already validated by the
   *  host on read; the dock re-sanitizes defensively). */
  dockPins: readonly string[];
  /** Phase 37 (item 21) — registry tool ids the user UNPINNED from their
   *  stage's default set (the inverse of a pin). Validated against the
   *  registry here; unknown ids are dropped. */
  dockUnpinned?: readonly string[];
  onPinTool: (id: string) => void;
  onUnpinTool: (id: string) => void;
  /** Run a registry tool id. The host maps ids to its existing handlers. */
  onRunTool: (id: string) => void;
  /** Live availability gate. The registry's `availability` is the declared
   *  precondition; the hosting surface owns the live gate against its props. */
  isToolEnabled?: (entry: ToolEntry) => boolean;
  /** The tooltip reason a verb is disabled; defaults to the registry
   *  availability copy. */
  disabledReasonFor?: (entry: ToolEntry) => string | undefined;
  /** Idle suppression: a tool is armed (sign / stamp / edit / flyout). */
  toolArmed?: boolean;
  /** Idle suppression: a page drag is in progress. */
  dragInProgress?: boolean;
  /** The canvas width for the responsive rules. When omitted the dock measures
   *  its own container and re-renders on resize. TFL-1116 (R15) — the host
   *  passes the CANVAS VIEWPORT width (the `.document-scroller`), never the
   *  fitted paper width. */
  canvasWidth?: number;
  /** TFL-1116 (R15) — the canvas has NO floating pills to clear (the app's
   *  single-mode canvas: phase 109 retired the page/zoom pills). With this set
   *  the dock sizes against the CANVAS VIEWPORT width instead of subtracting a
   *  phantom 476px pill reserve, and the labelled row routes to the arrows lane
   *  only when it genuinely cannot fit. Omitted (standalone mounts, Multi Mode
   *  panes) keeps the legacy pill-clearance behaviour. */
  pillsRetired?: boolean;
  /** Phase 37 (items 2 + 6) — the ONE responsive ladder resolved by the host
   *  from the measured workspace width. When omitted the dock derives the same
   *  ladder from its own measured width (standalone / test mounts). */
  ladder?: DockLadder;
  /** Per-tool run counts â€” the compact overflow ranks by usage. */
  toolUsage?: Readonly<Record<string, number>> | undefined;
  /** Verb ids whose tool is currently ON (e.g. `editMode` while Edit mode is
   *  active). They render with `aria-pressed` and the pressed treatment so a
   *  toggle verb shows its state instead of looking like a plain command. */
  activeToolIds?: readonly string[];
  /** State 4 reporter: fires whenever the idle modifier flips, so sibling
   *  workspace chrome (the floating page / zoom pills) fades in lockstep with
   *  the dock instead of on its own timer. */
  onIdleChange?: (idle: boolean) => void;
  /** Phase 39 (DEF-348b/c) — reporter for the dock's measured vertical yield in
   *  px (the pill band's height + clearance when the dock parks above the pills,
   *  else 0). The Multi Mode host reserves a bottom band of `base + lift` so no
   *  panel, pill or page-action control can ever intersect the dock. */
  onLiftChange?: (liftPx: number) => void;
  /** Phase 39 (D3) — the pill source for the reserve/lift basis, as a selector
   *  resolved against the document. Single mode omits it: the dock's host IS
   *  the canvas and the pills are its siblings. Multi Mode passes the FOCUSED
   *  pane's selector, because the shared dock lives in `.multi-dock-layer` while
   *  the pane's pills are OUTBOARD — the basis is then rebuilt from the pills'
   *  measured widths at the single-mode insets, so both modes reserve the SAME
   *  band at the same host width (Phase 39 D3). */
  pillSelector?: string;
  /** Phase 104 (chunk 1) — the dock's labelled Tools button opens the existing
   *  command palette. The host supplies the SAME `openCommandPalette` the Ctrl+K
   *  chord and the header's Tools row use, so the dock never re-implements the
   *  palette. The button is presentational; with no handler it is inert and
   *  disabled so a test / preview mount never offers a dead control. */
  onOpenTools?: () => void;
}
/** One rendered verb, unified across States 1 and 2. */
interface DockVerb {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  reason: string;
  run: () => void;
}

interface PinMenuState {
  id: string;
  x: number;
  y: number;
}

const MENU_W = 168;
const MENU_H = 76;

/** Phase 104 (chunk 2) — the anchored More popover's estimated width, used to
 *  clamp its horizontal position inside the viewport before it is measured. */
const MENU_OVERFLOW_W = 200;

/** TFL-1004 (chunk C9) — the 6px gap the dock's upward menus keep from the
 *  trigger (`bottom: calc(100% + 6px)` in the retired bespoke CSS). The
 *  CommandMenu render is placed with an explicit fixed `top`, so the gap is
 *  applied here instead. */
const MENU_OVERFLOW_GAP = 6;

/** Phase 104 (chunk 2) — the dock's own minimum band height (mirrors
 *  `--dock-min-height`), the floor used when the real box is unmeasured. */
const DOCK_MIN_HEIGHT = 68;

/** Phase 104 (chunk 2) — the bottom inset and safe clearance the canvas
 *  scroller reserves BELOW the last page so it can scroll fully above the
 *  floating dock (item 4: band + `--dock-bottom-inset` + clearance). */
const DOCK_BOTTOM_INSET = 16;
const DOCK_SCROLL_CLEARANCE = 12;

/** Phase 104 (chunk 2) — below this host width the five primary tiles plus
 *  More + Tools cannot share a band with the page / zoom pills, so the dock
 *  takes its OWN reserved layout row (the pills are never hidden). */
export const DOCK_RESERVED_ROW_WIDTH = 560;

/** Phase 37 (item 6) — how far one arrow click scrolls the dock's verb strip. */
export const DOCK_SCROLL_STEP = 160;

/** Phase 59 (item 3) — the pen's inline slot: the 22px control plus the dock's
 *  4px row gap. The pen is the dock's own trailing row item now, so every fit
 *  budget must charge it: the labelled row routes into the arrows lane rather
 *  than growing toward a pill, and the dock can still never reach either pill
 *  (the measured reserve cap owns that). */
const DOCK_EDIT_SLOT = 26;

/** Phase 104 (chunk 1) — verbs that are MOMENTARY by nature: exports, OCR runs
 *  and dialog launchers. They get hover / pressed feedback only and must never
 *  acquire a permanent selected tile, even if the host's `activeToolIds` were to
 *  name one. Persistent editing tools keep their soft-violet selected tile. */
const MOMENTARY_VERB_IDS: ReadonlySet<string> = new Set([
  'exportPages',
  'exportText',
  'exportDocx',
  'exportXlsx',
  'exportPptx',
  'recognizeText',
  'batchOcr',
]);

/** Phase 59 (item 3) — one verb held on screen for its EXIT animation after the
 *  host has already removed it (`index` is its position in the rendered group at
 *  the moment the minus was clicked, so the ghost collapses in its own slot
 *  instead of jumping to the row's end). */
interface ExitingVerb {
  verb: DockVerb;
  group: 'primary' | 'pins';
  index: number;
}

/** Phase 59 (item 3) — how long a bloom / collapse runs, from the TS mirror of
 *  `--motion-duration-fast` (the duration the `.anim-verb-*` utilities use).
 *  `useInstantMotion` collapses the ghost's whole lifetime to a single tick, so
 *  reduced motion / Animations OFF never animate and nothing lingers. */
const DOCK_VERB_MOTION_MS = MOTION_DURATION.fast;

/** Phase 75 (item A) — the EDIT-mode jiggle's period. Mirrors the
 *  `--motion-duration-layout` (350ms) token the `.anim-jiggle` utility uses. */
export const JIGGLE_PERIOD_MS = 350;

/** A deterministic, stable per-icon phase for the jiggle. A small string hash of
 *  the tool id (not the render index, so it does not shift when icons are added
 *  or removed) maps to a NEGATIVE animation-delay inside one jiggle period, so
 *  no two glyphs share a phase and the phase is identical across renders. */
export function jiggleDelayMs(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % JIGGLE_PERIOD_MS;
}

/** Clamp a pointer-anchored menu into the viewport (8px gutter). Mirrors the
 *  ContextPanel's clamp so both popovers behave identically. */
export function clampDockMenu(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(margin, x), Math.max(margin, vw - w - margin)),
    top: Math.min(Math.max(margin, y), Math.max(margin, vh - h - margin)),
  };
}

/** Phase 104 (TFL-848 / DEF-567) — focus the first ENABLED `menuitem` inside
 *  the More popover. A disabled leading row (EDIT's `batchOcr`) is skipped so
 *  roving focus genuinely starts inside the menu; when NO row is enabled the
 *  fallback (the More button) takes focus instead, and a null / empty menu is
 *  a no-op. Never throws. Returns true when a menu row took focus. */
export function focusFirstEnabledMenuItem(
  menu: HTMLElement | null | undefined,
  fallback?: HTMLElement | null,
): boolean {
  const first =
    menu?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])') ?? null;
  if (first === null) {
    fallback?.focus();
    return false;
  }
  first.focus();
  return true;
}

/** The State 2 verbs: the registry's own entries (icons/labels reused) plus
 *  Clear, wired to the host's bulk callbacks. */
export function buildSelectionVerbs(
  pages: readonly number[],
  bulk: DockBulkActions,
  onClearPageSelection: () => void,
): DockVerb[] {
  const runs: Record<string, () => void> = {
    rotate: (): void => bulk.onRotate(pages),
    extract: (): void => bulk.onExtract(pages),
    delete: (): void => bulk.onDelete(pages),
    [DOCK_CLEAR_ID]: onClearPageSelection,
  };
  const verbs: DockVerb[] = [];
  for (const id of [...DOCK_BULK_IDS, DOCK_CLEAR_ID]) {
    const entry = toolById(id);
    if (entry === undefined) continue;
    verbs.push({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      icon: entry.icon,
      enabled: true,
      reason: entry.description,
      run: runs[id] ?? ((): void => undefined),
    });
  }
  return verbs;
}

export function ActionDock(props: ActionDockProps): ReactElement {
  const {
    activeStage,
    pageSelection,
    onClearPageSelection,
    bulk,
    dockPins,
    dockUnpinned,
    onPinTool,
    onUnpinTool,
    onRunTool,
    isToolEnabled,
    disabledReasonFor,
    toolArmed = false,
    dragInProgress = false,
    canvasWidth,
    pillsRetired = false,
    ladder: ladderProp,
    toolUsage,
    activeToolIds,
    onIdleChange,
    onLiftChange,
    pillSelector,
    onOpenTools,
  } = props;

  const rootRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1200 : window.innerWidth,
  );
  const [hovered, setHovered] = useState(false);
  const [idle, setIdle] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [menu, setMenu] = useState<PinMenuState | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  /** TFL-1004 (chunk C9) — the anchored More popover's computed fixed
   *  viewport-relative position (pre-clamped by the layout effect) and the
   *  dock's measured layout band (px) republished to the canvas for scroll
   *  clearance. `null` until the CommandMenu has rendered and been measured. */
  const [overflowPos, setOverflowPos] = useState<{ left: number; top: number } | null>(null);
  const [dockBandPx, setDockBandPx] = useState(0);
  /** Phase 58 — the dock's EDIT mode: the pen arms it, every verb grows a
   *  minus affordance, and a plus control at the row's end opens the picker. */
  const [editMode, setEditMode] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  /** TFL-1004 (chunk C9) — the Add-a-tool picker's computed fixed position,
   *  mirroring `overflowPos`. */
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
  /** DEF-608 — the Pin/Unpin `CommandMenu`'s MEASURED rendered height. The
   *  clamp used the estimate `MENU_H` (76px, the retired bespoke row), but the
   *  migrated menu renders taller (a group heading), so at the window floor its
   *  last row clipped ~15px below the viewport. Measured in a layout effect and
   *  re-clamped; `null` while unmeasured falls back to `MENU_H`. */
  const [menuMeasuredH, setMenuMeasuredH] = useState<number | null>(null);
  /** DEF-315 — the MEASURED pill band: the reserve the dock must leave clear
   *  (from the pills' own inner edges) and their height for the vertical yield.
   *  DEF-330 — plus the pill-FREE band the dock actually occupies when it is
   *  parked between the pills. `null` until measured; the cap then falls back to
   *  the live reserve measurement. */
  const [pill, setPill] = useState<{
    reserve: number;
    pillHeight: number;
    free: { left: number; width: number } | null;
  } | null>(null);
  const pillKeyRef = useRef('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
  const overflowHostRef = useRef<HTMLDivElement | null>(null);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const hoveredRef = useRef(false);
  hoveredRef.current = hovered;

  // ---- responsive width -------------------------------------------------
  useEffect((): (() => void) | undefined => {
    if (canvasWidth !== undefined) return undefined;
    const host = rootRef.current?.parentElement ?? null;
    if (host === null) return undefined;
    const measure = (): void => setMeasuredWidth(host.clientWidth || window.innerWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return (): void => ro.disconnect();
  }, [canvasWidth]);

  // ---- DEF-315: the measured pill reserve --------------------------------
  // The two pills are the dock's siblings inside the canvas host. Their boxes
  // are measured (they are NOT fixed: the zoom readout gains a digit and the
  // page-label hint appears/disappears) and the reserve is derived from them,
  // so the cap is the real pill band instead of a hardcoded 380px.
  useEffect((): (() => void) | undefined => {
    const host = rootRef.current?.parentElement ?? null;
    if (host === null) return undefined;
    // Phase 39 (D3) — the PILL SOURCE. Single mode: the dock's host (the pills
    // are its siblings at the host's 12px insets). Multi Mode: the FOCUSED
    // pane, whose pills are OUTBOARD (pane-sized, at the pane's outer edge), so
    // their positions must not feed the workspace-centred dock's reserve; only
    // their widths/band do, rebuilt at the single-mode insets below.
    const outboard = pillSelector !== undefined;
    const source =
      pillSelector === undefined ? host : (document.querySelector(pillSelector) ?? host);
    const box = (el: Element | null): PillBox | null => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const measure = (): void => {
      const hostRect = host.getBoundingClientRect();
      if (!(hostRect.width > 0)) return;
      const page = box(source.querySelector('[data-page-pill]'));
      const zoom = box(source.querySelector('[data-zoom-pill]'));
      if (page === null && zoom === null) return;
      // Single mode measures the pills' real inner-edge offsets; Multi Mode
      // rebuilds the same basis from the SINGLE-mode pill ladder at this host
      // width (D3), so both modes reserve the identical band at the same host
      // width. Phase 40 (item 1) — the focused pane's pills compact to the
      // PANE (page left / zoom right, the dense micro tier at a narrow pane),
      // while single mode compacts to the whole CANVAS; consuming the pane's
      // measured widths made the two modes' lane/lift decisions diverge at the
      // same window width, so the multi basis is the ladder's widths and height
      // instead of the pane's own.
      const singleLadderPill = (w: number): PillBox => ({
        left: 0,
        right: w,
        top: 0,
        bottom: PILL_HEIGHT,
        width: w,
        height: PILL_HEIGHT,
      });
      const singleMode = pillMode(hostRect.width);
      const basis = outboard
        ? pillBasisFromWidths({
            page: singleLadderPill(singleMode === 'full' ? PAGE_FULL_W : PAGE_COMPACT_W),
            zoom: singleLadderPill(singleMode === 'full' ? ZOOM_FULL_W : ZOOM_COMPACT_W),
            hostWidth: hostRect.width,
            // The lift basis is SINGLE mode's: the stacked rung is decided by
            // the host width (`pillMode`), never by the focused pane's own
            // arrangement — so the lift magnitude matches single mode.
            stackedRaisePx: singleMode === 'stacked' ? PILL_RAISE : 0,
          })
        : {
            reserve: pillReserve({
              page,
              zoom,
              hostLeft: hostRect.left,
              hostRight: hostRect.right,
            }),
            pillHeight: pillBandHeight(page, zoom),
            // DEF-330 — the pill-FREE band needs BOTH boxes: with only one pill
            // there is no "between" to place the dock in, so the symmetric
            // reserve stays.
            free:
              page !== null && zoom !== null
                ? pillFreeBand({ page, zoom, hostLeft: hostRect.left })
                : null,
          };
      const { reserve, pillHeight: bandHeight, free } = basis;
      const key = `${reserve}:${Math.round(bandHeight)}:${
        free === null ? 'x' : `${Math.round(free.left)}:${Math.round(free.width)}`
      }`;
      if (key === pillKeyRef.current) return;
      pillKeyRef.current = key;
      setPill({ reserve, pillHeight: bandHeight, free });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const pageEl = source.querySelector('[data-page-pill]');
    const zoomEl = source.querySelector('[data-zoom-pill]');
    if (pageEl !== null) ro.observe(pageEl);
    if (zoomEl !== null) ro.observe(zoomEl);
    return (): void => ro.disconnect();
  }, [pillSelector]);

  const width = canvasWidth ?? measuredWidth;
  const compact = isDockCompact(width);
  // Phase 104 (chunk 2) — the RESERVED-ROW rung. Below this host width the five
  // primary tiles plus More + Tools cannot share a band with the pills, so the
  // dock takes its OWN reserved layout row instead of colliding with them; the
  // page / zoom pills are never hidden.
  const reservedRow = width < DOCK_RESERVED_ROW_WIDTH;
  // Phase 37 (items 2 + 6) — the responsive ladder. The host resolves it once
  // from the measured workspace width and threads it to every dock; a
  // standalone dock (test / preview mount) derives the same ladder from its own
  // measured width, so the rungs are always the ONE implementation.
  const ladder = useMemo(
    () => ladderProp ?? resolveDockLadder(width),
    [ladderProp, width],
  );
  // DEF-315 — the band the dock may occupy and whether the pills leave room
  // for it at all. `reserve` is the measured pill band, consumed by the CSS
  // cap (`max-width: 100% - var(--dock-reserve)`) and the inline cap here.
  // TFL-1116 (R15) — `dockReserveFor` returns the MEASURED reserve, the
  // conservative default while pills may still appear, and 0 when the canvas
  // has no pills at all (the app's `pillsRetired` single-mode canvas), so the
  // dock sizes against the CANVAS VIEWPORT instead of a phantom 476px band.
  const reserve = dockReserveFor({
    measured: pill?.reserve ?? null,
    pillsPresent: !pillsRetired,
  });
  const band = dockBand(width, reserve);
  const lifted = pill !== null && shouldLiftDock(band);
  // Phase 39 (DEF-348b/c) — publish the vertical yield so the Multi Mode host
  // can reserve a band that contains the dock at its lifted position too.
  const liftPx = lifted ? (pill?.pillHeight ?? 0) + DOCK_PILL_GAP : 0;
  useEffect((): void => {
    onLiftChange?.(liftPx);
  }, [liftPx, onLiftChange]);
  // Phase 104 (chunk 2) — measure the dock's own box and republish the bottom
  // scroll clearance (measured band + `--dock-bottom-inset` + a safe gap) to the
  // document root, so the canvas scroller can scroll the LAST page fully above
  // the floating dock. The value is a custom property, so opening the More menu
  // never reflows or resizes the dock.
  useEffect((): (() => void) | undefined => {
    const el = rootRef.current;
    if (el === null) return undefined;
    const measure = (): void => setDockBandPx(Math.round(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return (): void => ro.disconnect();
  }, []);
  const reservedBottom =
    (lifted ? liftPx : 0) +
    Math.max(dockBandPx, DOCK_MIN_HEIGHT) +
    DOCK_BOTTOM_INSET +
    DOCK_SCROLL_CLEARANCE;
  useEffect((): (() => void) => {
    if (typeof document === 'undefined') return (): void => undefined;
    const rootEl = document.documentElement;
    rootEl.style.setProperty('--dock-band-reserved', `${reservedBottom}px`);
    return (): void => {
      rootEl.style.removeProperty('--dock-band-reserved');
    };
  }, [reservedBottom]);
  // DEF-330 — the pill-FREE band. The symmetric `band` doubles the WIDEST
  // pill's offset, so it charged the dock for slack the narrower side never
  // uses; between the pills there is `free.width` to work with and the dock
  // parks at the band's own centre (`--dock-shift`), clear of both pills by
  // construction. Unmeasured, or lifted above the pill row, the dock goes back
  // to the host-centre geometry.
  const freeBand = pill?.free ?? null;
  const planWidth = dockPlanWidth({ hostWidth: width, band, lifted, measured: pill !== null });
  // DEF-330 — the dock is placed IN the pill-free band when one was measured
  // and it is not lifted: `left`/`right` are the band's own insets (host
  // relative) so the dock's shrink-to-fit width is the BAND, not the host's
  // right half under `left: 50%` (which capped DELIVER at 457px while the band
  // allowed 493.75px and wrapped it onto a second row). The reported band is
  // then the band the dock is placed against; unmeasured or lifted it stays the
  // symmetric band (the geometry is unchanged - the narrow-width behaviour).
  const bandPlaced = !lifted && freeBand !== null;
  const placementBand = bandPlaced && freeBand !== null ? freeBand.width : band;
  const bandRight =
    bandPlaced && freeBand !== null
      ? Math.max(0, width - freeBand.left - freeBand.width)
      : 0;
  // DEF-573 — the cap must consult `reservedRow`: an unmeasured reserved dock
  // (`pill === null`, no free band) would otherwise collapse to 0 at a 520px
  // host. `dockCap` is pure and unit-tested in `dockFit.ts`.
  const dockCapPx = dockCap({
    width,
    lifted,
    reservedRow,
    freeBandWidth: freeBand?.width ?? null,
    band,
  });
  const dockShift =
    lifted || freeBand === null ? 0 : freeBand.left + freeBand.width / 2 - width / 2;
  const activeSet = useMemo(() => new Set(activeToolIds ?? []), [activeToolIds]);

  /** A verb's tooltip. An ENABLED verb explains what it does; a DISABLED one
   *  explains WHY (DEF-311): the host's live reason wins, then the registry's
   *  declared availability copy ("Run Recognize text first"), and only when
   *  neither exists does the description fall back in. */
  const reasonFor = useCallback(
    (entry: ToolEntry, enabled: boolean): string => {
      if (enabled) return entry.description;
      return (
        disabledReasonFor?.(entry) ??
        DOCK_AVAILABILITY_REASON[entry.availability] ??
        entry.description
      );
    },
    [disabledReasonFor],
  );

  // ---- State 1 / State 2 ------------------------------------------------
  // Phase 37 (item 21) — the stage's FULL relevant set by default, MINUS the
  // tools the user unpinned (unknown ids dropped, capped, deduped). Pinned
  // tools are appended in State 3 (deduped against whatever is here).
  const unpinned = useMemo(() => sanitizeDockUnpinned(dockUnpinned), [dockUnpinned]);
  const stageEntries = useMemo(
    () => dockToolsForStage(activeStage).filter((entry) => !unpinned.includes(entry.id)),
    [activeStage, unpinned],
  );
  const primaryState = dockPrimaryState({
    activeStage,
    selectionCount: pageSelection.length,
  });

  // Phase 104 (chunk 2) — the stage's verbs split into the CURATED PRIMARY
  // tiles (the ~5 headlining verbs, in `DOCK_PRIMARY_IDS` order) and the
  // remaining MORE verbs (every other `DOCK_STAGE_IDS` id). Both sets are minus
  // the user's un-pins; `DOCK_STAGE_IDS` stays the stage's full membership.
  const primaryStageIds = useMemo(() => dockPrimaryIdsForStage(activeStage), [activeStage]);
  const toVerb = useCallback(
    (entry: ToolEntry): DockVerb => {
      const enabled =
        isToolEnabled === undefined
          ? defaultDockEnabled(entry, pageSelection.length)
          : isToolEnabled(entry);
      const reason = reasonFor(entry, enabled);
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        icon: entry.icon,
        enabled,
        reason,
        run: (): void => onRunTool(entry.id),
      };
    },
    [isToolEnabled, reasonFor, onRunTool, pageSelection.length],
  );
  const stagePrimaryVerbs = useMemo<DockVerb[]>(
    () =>
      primaryStageIds.flatMap((id) => {
        const entry = stageEntries.find((e) => e.id === id);
        return entry === undefined ? [] : [toVerb(entry)];
      }),
    [primaryStageIds, stageEntries, toVerb],
  );
  /** Every id the active stage's dock already renders (primary tiles OR the
   *  More menu). Pins and the edit picker dedupe against this UNION so a tool
   *  that moved from a tile into More never renders twice. */
  const stageDockIds = useMemo(() => stageEntries.map((entry) => entry.id), [stageEntries]);

  const selectionVerbs = useMemo<DockVerb[]>(
    () => buildSelectionVerbs(pageSelection, bulk, onClearPageSelection),
    [pageSelection, bulk, onClearPageSelection],
  );

  const primaryVerbs = primaryState === 'selection' ? selectionVerbs : stagePrimaryVerbs;
  const primaryIds = useMemo(() => primaryVerbs.map((v) => v.id), [primaryVerbs]);
  // DEF-569 — the More set is every stage entry the CURRENT primary set does
  // NOT already render as a tile. In State 2 the primaries are the SELECTION
  // verbs, so `primaryIds` (never the stage's curated set) is the exclusion
  // basis: `delete` stays a selection tile only, while the stage primaries it
  // displaces (`insertPages` / `merge` / `cropPages`) remain reachable in More.
  // A dock id therefore renders exactly once in every state.
  const moreVerbs = useMemo<DockVerb[]>(
    () => stageEntries.filter((entry) => !primaryIds.includes(entry.id)).map(toVerb),
    [stageEntries, primaryIds, toVerb],
  );

  // ---- State 3: pins ----------------------------------------------------
  const pins = useMemo(() => sanitizeDockPins(dockPins), [dockPins]);
  // Phase 42 (item 2) — a pinned STAGE tool surfaces only in its own stage's
  // dock (one home per tool); a GLOBAL tool (no stage dock) still pins into
  // any stage. A pin of the active stage's own default is deduped just below.
  const pinnedEntries = useMemo(
    () =>
      pins.flatMap((id) => {
        const entry = toolById(id);
        if (entry === undefined) return [];
        return isPinVisibleInStage(entry, activeStage) ? [entry] : [];
      }),
    [pins, activeStage],
  );
  const dedupedPins = useMemo(
    () => dedupePinsAgainst(pinnedEntries, [...stageDockIds, ...primaryIds]),
    [pinnedEntries, stageDockIds, primaryIds],
  );
  const pinnedVerbs = useMemo<DockVerb[]>(
    () => dedupedPins.map(toVerb),
    [dedupedPins, toVerb],
  );

  // Phase 58 — the EDIT-mode picker: the stage + global dock tools, minus the
  // ids already rendered (primary tiles, More verbs and pins). TFL-1116 C10
  // (R14) — the rows are the `dockEligible` set, so the SAME capability
  // predicate gates the chooser, the pin affordance and pin execution: an
  // unsupported command is never offered as an addable tool.
  const pickerEntries = useMemo<ToolEntry[]>(() => {
    const rendered = new Set<string>([
      ...stageDockIds,
      ...primaryIds,
      ...pinnedVerbs.map((v) => v.id),
    ]);
    return dockEligibleIdsForStage(activeStage).flatMap((id) => {
      if (rendered.has(id)) return [];
      const entry = toolById(id);
      return entry === undefined ? [] : [entry];
    });
  }, [activeStage, stageDockIds, primaryIds, pinnedVerbs]);

  // ---- responsive overflow ---------------------------------------------
  // DEF-315 — plan on the BAND once the pills are measured, so the `...` chip
  // absorbs the overflow inside it rather than the dock growing toward a pill.
  //
  // DEF-334 — `resolveDockLadder`'s 880 rung is the AUTHORITY for hiding the
  // dock's labels. The measured fit (canvas host < 900, or the labelled dock
  // wider than the pill-free band) may only route the row into the ARROWS lane
  // where it scrolls, never silently drop labels above 880. Phase 37 grew the
  // PAGES default set to eight verbs, so the labelled row genuinely cannot fit
  // the default band; the no-wrap guarantee is kept by preferring the arrows
  // lane over hiding labels (the re-opened DEF-330).
  const labelBand = lifted ? band : freeBand?.width ?? band;
  // Phase 59 (item 3) — the labelled row's width ALSO carries the pen's own
  // inline slot (`DOCK_EDIT_SLOT`): the pen is a real row item, so a labelled
  // dock that only fits without it would otherwise grow under a pill. The
  // measured-band path below then routes the row into the arrows lane instead.
  const need =
    labelledDockNeed(
      primaryVerbs.map((v) => DOCK_SHORT_LABELS[v.id] ?? v.label),
      pinnedVerbs.map((v) => v.label),
    ) + DOCK_EDIT_SLOT;
  const iconOnly = ladder.iconOnly;
  // TFL-1116 (R15) — with the canvas's pills RETIRED the labelled row runs
  // through the ARROWS lane only when it genuinely cannot fit the canvas
  // viewport band. The legacy `isDockIconOnly(width)` term must NOT apply then:
  // the app measures the CANVAS viewport (e.g. 798 at a 962 window), which is
  // below 900 while the WINDOW ladder rung keeps the labels, so the old
  // unconditional term forced a scrolling lane on a dock that comfortably fits.
  // The ladder stays the label authority; the fit test is the lane authority.
  const measuredLabelOverflow =
    !iconOnly &&
    (pillsRetired
      ? !labelsFitBand(need, labelBand)
      : isDockIconOnly(width) || (pill !== null && !labelsFitBand(need, labelBand)));
  // DEF-571 — the icon-only row carries the same 58px Focus Dock tiles as the
  // labelled row, so at the icon rung it can exceed the pill-free band while
  // NEITHER the arrows rung NOR the labelled fit test is engaged (the 720-880
  // band). Charge every control the row renders (primary tiles, pins, the
  // selection chip, the edit add and the stable More + Tools utilities) and
  // route the row into the arrows lane when that exceeds the band, so the
  // leading tile can never sit over the page pill. A LIFTED dock parks above
  // the pills and the reserved-row rung owns its own layout, so neither needs
  // this lane.
  const iconControlCount =
    primaryVerbs.length +
    pinnedVerbs.length +
    2 +
    (primaryState === 'selection' ? 1 : 0) +
    (editMode ? 1 : 0);
  const iconNeed = iconOnlyDockNeed(iconControlCount);
  const measuredIconOverflow =
    iconOnly && !lifted && !reservedRow && !labelsFitBand(iconNeed, labelBand);
  // The lane decision (plan + hints): the ladder's last rung OR a row (labelled
  // or icon-only) that cannot fit its band. Rendering of the arrows is
  // separately gated on a real overflow measurement (DEF-337).
  const arrowsLane = ladder.arrows || measuredLabelOverflow || measuredIconOverflow;
  // Phase 37 (item 6) — once the ladder reaches its LAST rung (or the labelled
  // row must scroll) the `...` chip is replaced by the left/right ARROWS: every
  // verb stays in the single row and the row scrolls, so nothing is ever hidden
  // behind a menu at the smallest width and the dock still never stacks.
  const plan = useMemo(
    () =>
      arrowsLane
        ? { visible: [...primaryVerbs], overflow: [] }
        : planDockOverflow({
            primary: primaryVerbs,
            pinnedCount: pinnedVerbs.length,
            usage: toolUsage,
            width: planWidth,
          }),
    [arrowsLane, primaryVerbs, pinnedVerbs.length, toolUsage, planWidth],
  );
  // DEF-337 — the arrows exist only when the scroll container genuinely
  // overflows; a row that already fits offers no dead control.
  const rowOverflow = useRowOverflow(
    scrollRef,
    arrowsLane,
    `${iconOnly}:${iconControlCount}:${Math.round(need)}`,
  );
  const arrows = arrowsLane && rowOverflow;
  const visibleIds = useMemo(() => new Set(plan.visible.map((e) => e.id)), [plan]);
  const inlineVerbs = useMemo(
    () => primaryVerbs.filter((v) => visibleIds.has(v.id)),
    [primaryVerbs, visibleIds],
  );
  const overflowVerbs = useMemo(
    () => primaryVerbs.filter((v) => !visibleIds.has(v.id)),
    [primaryVerbs, visibleIds],
  );
  // Phase 104 (chunk 2) — the anchored More popover's rows: (a) any responsive-
  // overflow PRIMARIES first, then (b) every displaced MORE verb, deduped so an
  // id can never appear twice. `moreVerbs` is empty only when a stage has no
  // secondary verbs, which no stage does.
  const menuVerbs = useMemo<DockVerb[]>(() => {
    const seen = new Set<string>();
    const out: DockVerb[] = [];
    for (const verb of [...overflowVerbs, ...moreVerbs]) {
      if (seen.has(verb.id)) continue;
      seen.add(verb.id);
      out.push(verb);
    }
    return out;
  }, [overflowVerbs, moreVerbs]);

  // ---- Phase 59 (item 3): adding / removing a tool animates ---------------
  // Adding a tool (the plus picker or the pin menu) blooms the new verb in and
  // grows its row slot from zero; removing one (a minus, or the menu's Unpin)
  // keeps the verb on screen in its own slot behind a `.anim-verb-out` ghost
  // until the collapse finishes, then drops it. The host's callbacks are NEVER
  // delayed — `onPinTool` / `onUnpinTool` fire on the click and the ghost is the
  // dock's own copy of the verb. Under reduced motion / Animations OFF
  // (`useInstantMotion`) the ghost is skipped outright, so the change is one
  // instant state change with nothing lingering.
  const instant = useInstantMotion();
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [exiting, setExiting] = useState<readonly ExitingVerb[]>([]);

  useEffect((): (() => void) | undefined => {
    if (enteringIds.size === 0) return undefined;
    const timer = window.setTimeout(
      (): void => setEnteringIds(new Set<string>()),
      instant ? 0 : DOCK_VERB_MOTION_MS,
    );
    return (): void => window.clearTimeout(timer);
  }, [enteringIds, instant]);

  useEffect((): (() => void) | undefined => {
    if (exiting.length === 0) return undefined;
    const timer = window.setTimeout(
      (): void => setExiting([]),
      instant ? 0 : DOCK_VERB_MOTION_MS,
    );
    return (): void => window.clearTimeout(timer);
  }, [exiting, instant]);

  /** Pin a tool and bloom its verb in. The id is recorded BEFORE the host's
   *  `dockPins` update lands, so the new verb's very first paint already
   *  carries `.anim-verb-in` — never a flash of an un-animated verb.
   *  TFL-1116 C10 (R14) — the SAME `dockEligible` predicate gate as the chooser
   *  and the pin affordance: an id the dock cannot host is never pinned, so
   *  execution can never diverge from what the affordance offered. */
  const addTool = useCallback(
    (id: string): void => {
      const entry = toolById(id);
      if (entry === undefined || !dockEligible(entry)) return;
      setEnteringIds((prev) => new Set(prev).add(id));
      onPinTool(id);
    },
    [onPinTool],
  );

  // TFL-1004 (chunk C9) — the Add-a-tool picker as `CommandMenuItem`s. The
  // legacy `[data-dock-picker]` root hook and `[data-dock-picker-item]` per-row
  // hook survive through the primitive's additive props; the row keeps the
  // `.action-dock-menu-item` class. Selecting an item closes the picker and
  // pins the tool (the host blooms it in through `addTool`).
  const pickerGroups = useMemo<CommandMenuGroup[]>(
    () => [
      {
        id: 'dock-picker',
        label: 'Add a tool',
        entries: pickerEntries.map(
          (entry): CommandMenuItem => ({
            id: entry.id,
            label: entry.label,
            icon: entry.id as QuietIconId,
            intent: 'secondary',
            density: 'compact',
            rowClassName: 'action-dock-menu-item',
            rowDataAttrs: { 'data-dock-picker-item': entry.id },
            onSelect: (): void => {
              setPlusOpen(false);
              addTool(entry.id);
            },
          }),
        ),
      },
    ],
    [pickerEntries, addTool],
  );

  // TFL-1004 (chunk C9) — the More overflow rows as `CommandMenuItem`s: every
  // displaced verb with its registry icon/label/enabled/reason, then the
  // always-present Customize dock toggle. The primitive's `disabled` /
  // `disabledReason` expose the unavailable rows identically, and `checked`
  // renders the Customize row as a `menuitemcheckbox` with `aria-checked`.
  const overflowGroups = useMemo<CommandMenuGroup[]>(
    () => [
      {
        id: 'dock-more',
        label: 'More actions',
        entries: [
          ...menuVerbs.map(
            (verb): CommandMenuItem => ({
              id: verb.id,
              label: verb.label,
              icon: verb.id as QuietIconId,
              intent: verb.id === 'delete' ? 'destructive' : 'secondary',
              density: 'compact',
              disabled: !verb.enabled,
              disabledReason: verb.reason,
              rowClassName: 'action-dock-menu-item',
              rowDataAttrs: { 'data-dock-overflow-item': verb.id },
              onSelect: (): void => {
                setOverflowOpen(false);
                verb.run();
              },
            }),
          ),
          {
            id: 'customize',
            label: 'Customize dock',
            icon: 'dockEditPencil' as QuietIconId,
            checked: editMode,
            intent: 'tertiary',
            density: 'compact',
            rowClassName: 'action-dock-menu-item',
            rowDataAttrs: { 'data-dock-menu-item': 'customize' },
            onSelect: (): void => {
              setOverflowOpen(false);
              setPlusOpen(false);
              setEditMode((v) => !v);
            },
          },
        ],
      },
    ],
    [menuVerbs, editMode],
  );

  /** Unpin a tool and collapse its verb out. `onUnpinTool` fires immediately;
   *  the ghost only HOLDS THE SLOT while the verb collapses. */
  const removeTool = useCallback(
    (verb: DockVerb, group: 'primary' | 'pins', index: number): void => {
      if (!instant) {
        setExiting((prev) =>
          prev.some((e) => e.verb.id === verb.id) ? prev : [...prev, { verb, group, index }],
        );
      }
      onUnpinTool(verb.id);
    },
    [instant, onUnpinTool],
  );

  /** TFL-1116 C10 (R14) — the explicit Done action for customization (EDIT)
   *  mode. It leaves customization in one click and closes the dedicated
   *  chooser, instead of relying on Escape or re-toggling Customize dock. */
  const exitCustomize = useCallback((): void => {
    setEditMode(false);
    setPlusOpen(false);
  }, []);

  // An EXITING verb is rendered ONCE — as its ghost. Its live entry is filtered
  // out for the whole collapse, so the ghost can never be a duplicate key and
  // the row loses exactly one slot.
  const exitingIds = useMemo(() => new Set(exiting.map((e) => e.verb.id)), [exiting]);
  const inlineRender = useMemo(
    () => inlineVerbs.filter((v) => !exitingIds.has(v.id)),
    [inlineVerbs, exitingIds],
  );
  const pinnedRender = useMemo(
    () => pinnedVerbs.filter((v) => !exitingIds.has(v.id)),
    [pinnedVerbs, exitingIds],
  );
  /** How many pin ghosts still hold a slot (the pins section must stay mounted
   *  for them even when the LAST pin has already left the live list). */
  const pinGhostCount = useMemo(
    () => exiting.filter((e) => e.group === 'pins').length,
    [exiting],
  );

  /** Phase 59 (item 3) — the context menu's Unpin routes through the same
   *  `removeTool` as the minus badge, so a right-click removal collapses out in
   *  its own slot too. The verb is looked up in the rendered groups (the ghost
   *  needs its slot); an id that is not rendered right now still unpins, just
   *  without the collapse. */
  const unpinFromMenu = (id: string): void => {
    const primaryIndex = inlineVerbs.findIndex((v) => v.id === id);
    const primaryVerb = inlineVerbs[primaryIndex];
    if (primaryIndex >= 0 && primaryVerb !== undefined) {
      removeTool(primaryVerb, 'primary', primaryIndex);
      return;
    }
    const pinIndex = pinnedVerbs.findIndex((v) => v.id === id);
    const pinnedVerb = pinnedVerbs[pinIndex];
    if (pinIndex >= 0 && pinnedVerb !== undefined) {
      removeTool(pinnedVerb, 'pins', pinIndex);
      return;
    }
    onUnpinTool(id);
  };

  // ---- State 4: idle ----------------------------------------------------
  const bump = useCallback((): void => {
    setIdle(false);
    setActivityTick((t) => t + 1);
  }, []);

  // A drag in progress suppresses idle. The host's prop covers the shared
  // cross-document drag context; the window listeners cover every other HTML5
  // drag (the rail's intra-document reorder, the canvas grip) without new
  // plumbing, so "never idle while a drag is in progress" holds for all of them.
  const [windowDragging, setWindowDragging] = useState(false);
  useEffect((): (() => void) => {
    const onStart = (): void => setWindowDragging(true);
    const onEnd = (): void => setWindowDragging(false);
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return (): void => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, []);
  const dragging = dragInProgress || windowDragging;

  useEffect((): (() => void) | undefined => {
    if (toolArmed || dragging) {
      setIdle(false);
      return undefined;
    }
    const timer = window.setTimeout((): void => {
      if (!hoveredRef.current) setIdle(true);
    }, DOCK_IDLE_MS);
    return (): void => window.clearTimeout(timer);
  }, [toolArmed, dragging, activityTick, hovered]);

  // State 4 is SHARED workspace chrome state: the floating pills fade with the
  // dock, so the idle flip is reported upward as well as painted here.
  useEffect((): void => {
    onIdleChange?.(idle);
  }, [idle, onIdleChange]);

  useEffect((): (() => void) => {
    const host = rootRef.current?.parentElement ?? null;
    const onMove = (): void => bump();
    const onKey = (): void => bump();
    host?.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('keydown', onKey);
    return (): void => {
      host?.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [bump]);

  // ---- pin menu ---------------------------------------------------------
  useEffect((): (() => void) | undefined => {
    if (menu === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target) === true) return;
      setMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menu]);

  // Phase 58 — Escape exits EDIT mode (and closes the picker). A targeted
  // document keydown while edit mode is on; it never swallows events otherwise.
  useEffect((): (() => void) | undefined => {
    if (!editMode) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setEditMode(false);
        setPlusOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [editMode]);

  // ---- TFL-1004 (chunk C9): CommandMenu placement for the dock menus ------
  // NOTE the containing block: the dock carries a transform, so a
  // `position: fixed` descendant is contained by the DOCK's own box, not the
  // viewport. `CommandMenu`'s `position` prop sets an explicit fixed
  // `left`/`top`, overriding the inherited `.titlebar-menu-popover` anchor
  // (`top: 100%`) that would otherwise leave the surface hanging below the
  // dock. Each effect measures the rendered menu and converts the clamped
  // viewport rect into dock-relative coordinates, opening upward with the
  // retired CSS's 6px gap. Both run in a layout effect, so the first painted
  // frame is already placed (no placement flash).
  useLayoutEffect((): void => {
    if (!overflowOpen) return;
    const btn = overflowBtnRef.current;
    const dock = rootRef.current;
    const panel = dock?.querySelector<HTMLElement>('[data-dock-overflow-menu]') ?? null;
    if (btn === null || dock === null || panel === null) return;
    const box = btn.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    const panelW = panel.offsetWidth > 0 ? panel.offsetWidth : MENU_OVERFLOW_W;
    const panelH = panel.offsetHeight;
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const desired = box.left + box.width / 2 - panelW / 2;
    const left = Math.min(Math.max(8, desired), Math.max(8, vw - panelW - 8));
    const top = Math.max(8, box.top - panelH - MENU_OVERFLOW_GAP);
    setOverflowPos({
      left: Math.round(left - dockBox.left),
      top: Math.round(top - dockBox.top),
    });
  }, [overflowOpen]);

  useLayoutEffect((): void => {
    if (!plusOpen) return;
    const btn = plusBtnRef.current;
    const dock = rootRef.current;
    const panel = dock?.querySelector<HTMLElement>('[data-dock-picker]') ?? null;
    if (btn === null || dock === null || panel === null) return;
    const box = btn.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    const panelW = panel.offsetWidth > 0 ? panel.offsetWidth : MENU_OVERFLOW_W;
    const panelH = panel.offsetHeight;
    const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const desired = box.right - panelW;
    const left = Math.min(Math.max(8, desired), Math.max(8, vw - panelW - 8));
    const top = Math.max(8, box.top - panelH - MENU_OVERFLOW_GAP);
    setPickerPos({
      left: Math.round(left - dockBox.left),
      top: Math.round(top - dockBox.top),
    });
  }, [plusOpen]);

  // DEF-608 — measure the rendered Pin/Unpin `CommandMenu` and re-clamp with its
  // REAL height (mirroring the overflow/picker layout effects above). Reads the
  // portaled `[data-dock-menu]` root via `menuRef`; the first paint uses the
  // `MENU_H` fallback, then this effect lifts the clamp once measured. Cleared
  // when the menu closes so a later menu is never clamped with a stale height.
  useLayoutEffect((): void => {
    if (menu === null) {
      setMenuMeasuredH((prev) => (prev === null ? prev : null));
      return;
    }
    const el = menuRef.current;
    if (el === null) return;
    const measured = el.offsetHeight;
    if (measured > 0) {
      setMenuMeasuredH((prev) => (prev === measured ? prev : measured));
    }
  }, [menu, menuMeasuredH]);

  const openMenu = (id: string, x: number, y: number): void => {
    setOverflowOpen(false);
    setMenu({ id, x, y });
  };

  /** Phase 37 (item 6) — scroll the single-row verb strip by one step. Called
   *  by the ladder's left/right arrows only; guarded so a mount without the
   *  scroll container (or a test environment without `scrollBy`) is a no-op. */
  const scrollVerbs = useCallback((direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const delta = direction * DOCK_SCROLL_STEP;
    if (typeof el.scrollBy === 'function') {
      el.scrollBy({ left: delta, behavior: 'smooth' });
    } else {
      el.scrollLeft += delta;
    }
  }, []);

  const menuPos =
    menu === null
      ? null
      : clampDockMenu(menu.x, menu.y, MENU_W, menuMeasuredH ?? MENU_H, window.innerWidth, window.innerHeight);
  const menuPinned = menu !== null && pins.includes(menu.id);

  // TFL-1012 (TFL-855 chunk C10) — the Pin/Unpin menu as a `CommandMenu` group.
  // The primitive owns dismissal, focus and motion (its `TfMenu` motion
  // replaces the retired `anim-menu-pop`); the dock keeps the `menu`/`menuPos`
  // state, the `onContextMenu` opener and the clamp, and the legacy
  // `data-dock-menu-item` / `.action-dock-menu-item` row hooks survive through
  // `rowDataAttrs` / `rowClassName`. The group heading names the verb under the
  // pointer (mirroring the thumbnail menu's `Page N` heading), falling back to
  // the id when the registry has no label.
  const pinMenuGroups = useMemo<CommandMenuGroup[]>(() => {
    if (menu === null) return [];
    const entry = toolById(menu.id);
    // TFL-1116 C10 (R14) — the pin AFFORDANCE consults the ONE `dockEligible`
    // predicate (through `dockPinAffordance`), so it can never offer a pin that
    // the execution path (`addTool` -> `addDockPin`) would refuse.
    const affordance =
      entry === undefined
        ? { allowed: false, reason: undefined }
        : dockPinAffordance({ entry, alreadyPinned: menuPinned, pins });
    return [
      {
        id: 'dock-pin',
        label: entry?.label ?? menu.id,
        entries: [
          {
            id: 'pin',
            label: 'Pin to dock',
            intent: 'secondary',
            density: 'compact',
            disabled: !affordance.allowed,
            disabledReason: affordance.reason,
            rowClassName: 'action-dock-menu-item',
            rowDataAttrs: { 'data-dock-menu-item': 'pin' },
            onSelect: (): void => {
              setMenu(null);
              addTool(menu.id);
            },
          },
          {
            id: 'unpin',
            label: 'Unpin from dock',
            intent: 'secondary',
            density: 'compact',
            // Phase 37 (item 21) — ANY rendered verb can be unpinned now:
            // a default stage verb is recorded in `dockUnpinned`, an
            // explicit pin is dropped from `dockPins`. The host owns which
            // list. Phase 59 (item 3) — it routes through `unpinFromMenu`,
            // so the verb collapses out in its own slot like a minus click.
            rowClassName: 'action-dock-menu-item',
            rowDataAttrs: { 'data-dock-menu-item': 'unpin' },
            onSelect: (): void => {
              setMenu(null);
              unpinFromMenu(menu.id);
            },
          },
        ],
      },
    ];
  }, [menu, menuPinned, pins, addTool, unpinFromMenu]);

  /** Phase 113 (Quiet Actions) — the dock tile's intent by verb id. Everything
   *  not listed is `secondary` (the supporting-tool default). */
  const VERB_INTENT: Record<string, ButtonIntent> = {
    rotate: 'primary',
    annotate: 'primary',
    optimize: 'primary',
    delete: 'destructive',
    clearPageSelection: 'tertiary',
  };

  const renderVerb = (
    verb: DockVerb,
    opts: { primary: boolean; pin: boolean; index: number; out?: boolean; short?: boolean },
  ): ReactElement => {
    const pressed = activeSet.has(verb.id) && !MOMENTARY_VERB_IDS.has(verb.id);
    const group: 'primary' | 'pins' = opts.pin ? 'pins' : 'primary';
    // Phase 113 (Quiet Actions) — the dock tile's task emphasis. The stage's
    // headlining verbs are `primary`; Delete is the one `destructive`; Clear is
    // `tertiary`; every other verb is `secondary`.
    const verbIntent: ButtonIntent = VERB_INTENT[verb.id] ?? 'secondary';
    // Phase 104 (chunk 2) — the primary TILE label is the short form; the full
    // registry label stays the accessible name (`aria-label`) and the tooltip
    // (`title`). Pins and non-primary ids keep their full label.
    const tileLabel =
      opts.short === true ? DOCK_SHORT_LABELS[verb.id] ?? verb.label : verb.label;
    // Phase 59 (item 3) — the add / remove bloom rides these two utilities. An
    // EXITING verb (a ghost held for its collapse) is inert: `pointer-events`
    // comes from `.anim-verb-out`, it is out of the tab order and it renders no
    // minus badge, so a click can never land on it and it can never run.
    const classes = ['action-dock-verb'];
    if (opts.primary) classes.push('action-dock-verb-primary');
    // Phase 104 (chunk 1) — the selected-tile hook. Only a persistent tool that
    // is genuinely ON takes it; the momentary guard above keeps exports / OCR /
    // dialogs on momentary feedback only.
    if (pressed) classes.push('action-dock-verb-selected');
    if (opts.out === true) classes.push('anim-verb-out');
    else if (enteringIds.has(verb.id)) classes.push('anim-verb-in');
    // Phase 75 (item A) — only a live curated glyph jiggles; an exiting ghost
    // and the pen / plus controls never do.
    const jiggle = editMode && opts.out !== true;
    return (
      <div
        key={opts.pin ? `pin:${verb.id}` : verb.id}
        className="action-dock-verb-slot"
        data-dock-slot={opts.pin ? `pin:${verb.id}` : verb.id}
      >
        <Button
          type="button"
          intent={verbIntent}
          kind="toggle"
          density="prominent"
          className={classes.join(' ')}
          data-dock-verb={verb.id}
          data-dock-pin={opts.pin ? verb.id : undefined}
          /* TFL-1116 C10 (R14) — a persisted pin whose tool is temporarily
             unavailable is EXPLAINED (disabled with its refusal `title`) rather
             than hidden or reset. This hook marks just that case. */
          data-dock-pin-ineligible={opts.pin && !verb.enabled ? verb.id : undefined}
          data-dock-exiting={opts.out === true ? verb.id : undefined}
          aria-label={verb.label}
          aria-pressed={pressed ? true : undefined}
          aria-disabled={opts.out === true ? true : undefined}
          disabled={opts.out === true ? false : !verb.enabled}
          tabIndex={opts.out === true ? -1 : undefined}
          title={verb.reason}
          onClick={(): void => verb.run()}
          onContextMenu={(e): void => {
            e.preventDefault();
            openMenu(verb.id, e.clientX, e.clientY);
          }}
          icon={
            <span
              className={jiggle ? 'action-dock-icon anim-jiggle' : 'action-dock-icon'}
              style={jiggle ? { animationDelay: `-${jiggleDelayMs(verb.id)}ms` } : undefined}
              aria-hidden
            >
              <Icon name={verb.id as QuietIconId} size="lg" />
            </span>
          }
        >
          {!iconOnly && <span className="action-dock-label">{tileLabel}</span>}
        </Button>
        {/* TFL-660 — EDIT mode: the minus affordance. It is a SIBLING of the
            verb button (never nested, so it is structurally outside a disabled
            control and stays clickable while its verb is greyed), a SPAN with a
            button role (never a nested <button>, invalid HTML), and it stops
            propagation on ITS OWN event only so the verb's own onClick does not
            run the tool. The cross-bubbling rules (AGENTS.md) are honoured: no
            document-level catch-all, no disarm here. The exiting ghost
            (`opts.out === true`) renders no minus. */}
        {editMode && opts.out !== true && (
          <span
            className="btn btn-ghost btn-compact action-dock-minus"
            role="button"
            tabIndex={0}
            aria-label={`Remove ${verb.label} from dock`}
            data-dock-minus={verb.id}
            onClick={(e): void => {
              e.stopPropagation();
              e.preventDefault();
              removeTool(verb, group, opts.index);
            }}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                removeTool(verb, group, opts.index);
              }
            }}
          >
            <Icon name="dockRemove" size="lg" aria-hidden />
          </span>
        )}
      </div>
    );
  };

  /** Phase 59 (item 3) — one group's verbs, with every EXITING verb spliced back
   *  into its OWN slot so the collapse happens in place and the row never jumps.
   *  `ghosts[gi].index` is the slot the verb held when the minus was clicked; the
   *  live list has already lost it, so the ghost inserts before the verb now
   *  sitting at that index (offset by the ghosts already re-inserted). */
  const renderVerbs = (verbs: readonly DockVerb[], group: 'primary' | 'pins'): ReactElement[] => {
    const ghosts = exiting.filter((e) => e.group === group).sort((a, b) => a.index - b.index);
    const out: ReactElement[] = [];
    let gi = 0;
    const pushGhost = (): void => {
      const ghost = ghosts[gi];
      if (ghost === undefined) return;
      out.push(
        renderVerb(ghost.verb, {
          primary: false,
          pin: group === 'pins',
          index: -1,
          out: true,
          short: group === 'primary',
        }),
      );
      gi += 1;
    };
    verbs.forEach((verb, index): void => {
      while (gi < ghosts.length && (ghosts[gi]?.index ?? 0) <= index + gi) pushGhost();
      out.push(
        renderVerb(verb, {
          primary: index === 0 && group === 'primary',
          pin: group === 'pins',
          index,
          short: group === 'primary',
        }),
      );
    });
    while (gi < ghosts.length) pushGhost();
    return out;
  };

  return (
    <div
      ref={(el): void => {
        rootRef.current = el;
      }}
      className="action-dock"
      role="toolbar"
      aria-label="Action dock"
      aria-orientation="horizontal"
      data-action-dock
      data-dock-coarse={isCoarsePointer() ? 'true' : undefined}
      data-dock-state={primaryState}
      data-dock-edit={editMode ? 'true' : 'false'}
      data-dock-idle={idle ? 'true' : 'false'}
      data-dock-icon-only={iconOnly ? 'true' : 'false'}
      data-dock-compact={compact ? 'true' : 'false'}
      /* Phase 104 (chunk 2) — the reserved-row rung: at very narrow hosts the
       * dock takes its own layout band instead of colliding with the pills. */
      data-dock-reserved={reservedRow ? 'true' : undefined}
      data-dock-arrows={arrows ? 'true' : 'false'}
      /* DEF-337 — the ladder's arrows LANE, independent of whether the gated
       * arrows currently render. The stylesheet keys the scroll container's
       * real box off THIS, so its geometry never depends on the hook's verdict
       * (the feedback loop that settled on dead arrows). */
      data-dock-arrows-lane={arrowsLane ? 'true' : 'false'}
      data-dock-band={Math.round(placementBand)}
      data-dock-free-band={freeBand === null ? undefined : Math.round(freeBand.width)}
      data-dock-band-placed={bandPlaced ? 'true' : undefined}
      data-dock-shift={Math.round(dockShift)}
      data-dock-lift={lifted ? 'true' : 'false'}
      /* DEF-315 — the measured pill geometry, published where the stylesheet
       * consumes it. `--dock-reserve` is the pill band the cap subtracts;
       * `--dock-lift` parks the dock above the pill row when the band cannot
       * hold it (0px otherwise, so the transform is a no-op). DEF-330 —
       * `--dock-shift` moves the dock from the host centre to the centre of the
       * pill-free band (0px when unmeasured or lifted, so the geometry is
       * unchanged then). */
      style={
        {
          maxWidth: `${dockCapPx}px`,
          '--dock-reserve': `${reserve}px`,
          '--dock-lift': `${lifted ? (pill?.pillHeight ?? 0) + DOCK_PILL_GAP : 0}px`,
          '--dock-shift': `${dockShift}px`,
          /* DEF-330 — the pill-free band's own insets (host relative), used by
           * the band-placed rule to position the dock inside the band while
           * `margin-inline: auto` keeps it centred. */
          '--dock-band-left': `${freeBand === null ? width / 2 : freeBand.left}px`,
          '--dock-band-right': `${bandRight}px`,
        } as CSSProperties
      }
      onPointerOver={(): void => {
        setHovered(true);
        bump();
      }}
      onPointerOut={(e): void => {
        const related = e.relatedTarget;
        if (related instanceof Node && e.currentTarget.contains(related)) return;
        setHovered(false);
      }}
    >
      {/* Phase 104 (chunk 1) — the detached Ctrl+K hint is RETIRED. The
          command palette is now reachable from the labelled Tools utility
          button at the dock's trailing end (below), alongside More. The old
          `.action-dock-hint` / `.action-dock-kbd` chrome is gone. */}
      {/* Phase 37 (item 6) — the ladder's last rung: left/right arrows scroll
          the single verb row instead of wrapping or hiding verbs in a menu. */}
      {arrows && (
        <IconButton
          variant="ghost"
          kind="action"
          density="standard"
          label="Scroll dock tools left"
          className="action-dock-arrow"
          data-dock-arrow="left"
          onClick={(): void => scrollVerbs(-1)}
          icon={<Icon name="dockScrollLeft" size="lg" aria-hidden />}
        />
      )}
      <div className="action-dock-scroll" ref={scrollRef} data-dock-scroll>
        {primaryState === 'selection' && (
          <span className="action-dock-chip" data-dock-chip>
            {selectionChipLabel(pageSelection.length)}
          </span>
        )}
        <div className="action-dock-group" key={primaryState} data-dock-group="primary">
          {renderVerbs(inlineRender, 'primary')}
        </div>
        {/* Phase 59 (item 3) — the pins section also stays mounted while a
            ghost is collapsing, so removing the LAST pin still animates out
            before the empty/edit state settles. */}
        {(pinnedRender.length > 0 || pinGhostCount > 0) && (
          <>
            <span className="action-dock-divider" role="separator" data-dock-divider />
            <div className="action-dock-group" data-dock-group="pins">
              {renderVerbs(pinnedRender, 'pins')}
            </div>
          </>
        )}
        {/* Phase 58 — EDIT mode: the add control stays at the row's RIGHT END
            after every add. It opens the registry-derived picker; picking an id
            pins it (the host's `onPinTool`, through `addTool` so the new verb
            BLOOMS in) and closes the picker. */}
        {editMode && (
          <div
            className="action-dock-add"
            onKeyDownCapture={(event): void => {
              // Preserve the shipped Escape behavior: while the picker is open
              // Escape exits EDIT mode. `CommandMenu` stops the Escape at its
              // row list, so the dock's document-level handler no longer sees
              // it; this capture handler keeps the behavior intact.
              if (event.key !== 'Escape') return;
              setEditMode(false);
              setPlusOpen(false);
            }}
          >
            <IconButton
              ref={plusBtnRef}
              variant="ghost"
              kind="disclosure"
              density="standard"
              label="Add a tool to the dock"
              expanded={plusOpen}
              className="action-dock-plus"
              data-dock-plus
              aria-haspopup="menu"
              onClick={(): void => {
                setMenu(null);
                setOverflowOpen(false);
                setPlusOpen((v) => !v);
              }}
              icon={<Icon icon={Plus} size="lg" aria-hidden />}
            />
            {/* TFL-1004 (chunk C9) — the picker is the shared `CommandMenu`.
                `data-dock-picker` stays on the root and each row keeps
                `data-dock-picker-item` + `.action-dock-menu-item`; the trigger
                above is unchanged. */}
            <CommandMenu
              open={plusOpen}
              groups={pickerGroups}
              ariaLabel="Add a tool to the dock"
              onClose={(): void => setPlusOpen(false)}
              openerRef={plusBtnRef}
              position={pickerPos ?? undefined}
              popoverDataAttrs={{ 'data-dock-picker': 'true' }}
            />
          </div>
        )}
      </div>
      {arrows && (
        <IconButton
          variant="ghost"
          kind="action"
          density="standard"
          label="Scroll dock tools right"
          className="action-dock-arrow"
          data-dock-arrow="right"
          onClick={(): void => scrollVerbs(1)}
          icon={<Icon name="dockScrollRight" size="lg" aria-hidden />}
        />
      )}
      {/* Phase 104 (chunk 2) — the anchored More popover is a STABLE utility
          control: it renders UNCONDITIONALLY, OUTSIDE the scroll strip, and its
          menu holds (a) any responsive-overflow primaries, (b) every displaced
          MORE verb with its registry icon/label/enabled/reason, and (c) the
          Customize dock item. It opens UPWARD and clamps into the viewport, so
          it never reflows the document or moves the dock. */}
      <div className="action-dock-overflow" ref={overflowHostRef} data-dock-overflow-host>
        <Button
          ref={overflowBtnRef}
          intent="tertiary"
          kind="disclosure"
          density="standard"
          className="action-dock-verb action-dock-more"
          data-dock-overflow
          aria-label="More actions"
          aria-expanded={overflowOpen}
          aria-haspopup="menu"
          title="More actions"
          onClick={(): void => {
            setMenu(null);
            setOverflowOpen((v) => !v);
          }}
        >
          <span className="action-dock-icon" aria-hidden>
            <Icon name="dockOverflow" size="lg" />
          </span>
          {!iconOnly && <span className="action-dock-label">More</span>}
        </Button>
        {/* TFL-1004 (chunk C9) — the More rows are the shared `CommandMenu`.
            `data-dock-overflow-menu` stays on the root; each verb row keeps
            `data-dock-overflow-item` + `.action-dock-menu-item` and the
            Customize toggle keeps `data-dock-menu-item="customize"` (rendered
            as `aria-checked`). The trigger above is unchanged. */}
        <CommandMenu
          open={overflowOpen}
          groups={overflowGroups}
          ariaLabel="More actions"
          onClose={(): void => setOverflowOpen(false)}
          openerRef={overflowBtnRef}
          position={overflowPos ?? undefined}
          popoverDataAttrs={{ 'data-dock-overflow-menu': 'true' }}
        />
      </div>
      {/* TFL-1116 C10 (R13) — the dock's TRAILING UTILITY. The ambiguous
          "Tools" label is replaced by "All commands", which honestly names the
          global Command Palette it opens (the SAME `openCommandPalette` the
          Ctrl+K chord and the header's palette entry run). The canvas-level
          entry is still needed for discoverability, so it is RELABELLED rather
          than removed; the `data-dock-tools` hook is unchanged. Docking
          customization lives in the More menu (Customize dock) and never
          routes here. */}
      <Button
        intent="tertiary"
        kind="disclosure"
        density="standard"
        className="action-dock-verb action-dock-tools"
        data-dock-tools
        aria-label="All commands"
        title="All commands"
        disabled={onOpenTools === undefined}
        onClick={(): void => {
          setMenu(null);
          setOverflowOpen(false);
          onOpenTools?.();
        }}
      >
        <span className="action-dock-icon" aria-hidden>
          <Icon name="toolsPalette" size="lg" />
        </span>
        {!iconOnly && <span className="action-dock-tools-label">All commands</span>}
      </Button>
      {/* TFL-1116 C10 (R14) — the explicit Done action for customization (EDIT)
          mode. Visible only while customizing, it leaves the mode and closes the
          dedicated chooser in one click. */}
      {editMode && (
        <Button
          type="button"
          intent="primary"
          kind="action"
          density="standard"
          className="action-dock-done"
          data-dock-done
          aria-label="Done customizing the dock"
          title="Done customizing the dock"
          onClick={exitCustomize}
        >
          Done
        </Button>
      )}
      {/* DEF-312 — the Pin/Unpin menu is portaled to `document.body`. The dock
          carries `transform: translateX(-50%)`, and a transformed ancestor is
          the containing block for `position: fixed` descendants, so the menu
          (fixed, clamped against the VIEWPORT) rendered ~700px below the
          window while it lived inside the dock. On the body it is positioned
          against the viewport, exactly like the thumbnail context menu.
          TFL-1012 (TFL-855 chunk C10) — the surface is now the shared
          `CommandMenu` (mirroring C5/C7/C8/C9): it owns dismissal, focus
          capture/return and the row keyboard model, and its `TfMenu` motion
          replaces the retired `anim-menu-pop`. The dock keeps the `menu` /
          `menuPos` state, the `onContextMenu` opener and the clamp; the legacy
          `data-dock-menu` root hook and the `data-dock-menu-item` /
          `.action-dock-menu-item` row hooks survive through the primitive's
          additive `popoverDataAttrs` / `rowDataAttrs` / `rowClassName` props. */}
      {menu !== null &&
        menuPos !== null &&
        createPortal(
          <CommandMenu
            open
            groups={pinMenuGroups}
            ariaLabel={`${menu.id} options`}
            onClose={(): void => setMenu(null)}
            position={{ left: menuPos.left, top: menuPos.top }}
            popoverRef={menuRef}
            popoverDataAttrs={{ 'data-dock-menu': 'true' }}
          />,
          document.body,
        )}
    </div>
  );
}
