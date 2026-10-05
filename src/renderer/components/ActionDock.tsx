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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { QuietIconId } from '../icons/quietPrecision';
import {
  DOCK_AVAILABILITY_REASON,
  DOCK_BULK_IDS,
  DOCK_CLEAR_ID,
  DOCK_IDLE_MS,
  canPinMore,
  defaultDockEnabled,
  dedupePinsAgainst,
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
  DOCK_DEFAULT_RESERVE,
  DOCK_LIFT_INSET,
  DOCK_PILL_GAP,
  dockBand,
  dockPlanWidth,
  labelledDockNeed,
  labelsFitBand,
  pillBandHeight,
  pillBasisFromWidths,
  pillFreeBand,
  pillReserve,
  shouldLiftDock,
  type PillBox,
} from '../state/dockFit';
import { toolById, dockToolsForStage, dockPickerIdsForStage, isPinVisibleInStage, type ToolEntry } from '../state/toolsRegistry';
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
   *  its own container and re-renders on resize. */
  canvasWidth?: number;
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

/** Phase 37 (item 6) — how far one arrow click scrolls the dock's verb strip. */
export const DOCK_SCROLL_STEP = 160;

/** Phase 59 (item 3) — the pen's inline slot: the 22px control plus the dock's
 *  4px row gap. The pen is the dock's own trailing row item now, so every fit
 *  budget must charge it: the labelled row routes into the arrows lane rather
 *  than growing toward a pill, and the dock can still never reach either pill
 *  (the measured reserve cap owns that). */
const DOCK_EDIT_SLOT = 26;

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
    ladder: ladderProp,
    toolUsage,
    activeToolIds,
    onIdleChange,
    onLiftChange,
    pillSelector,
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
  /** Phase 58 — the dock's EDIT mode: the pen arms it, every verb grows a
   *  minus affordance, and a plus control at the row's end opens the picker. */
  const [editMode, setEditMode] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
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
  const reserve = pill?.reserve ?? DOCK_DEFAULT_RESERVE;
  const band = dockBand(width, reserve);
  const lifted = pill !== null && shouldLiftDock(band);
  // Phase 39 (DEF-348b/c) — publish the vertical yield so the Multi Mode host
  // can reserve a band that contains the dock at its lifted position too.
  const liftPx = lifted ? (pill?.pillHeight ?? 0) + DOCK_PILL_GAP : 0;
  useEffect((): void => {
    onLiftChange?.(liftPx);
  }, [liftPx, onLiftChange]);
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
  const dockCap = lifted ? Math.max(0, width - 2 * DOCK_LIFT_INSET) : freeBand?.width ?? band;
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

  const stageVerbs = useMemo<DockVerb[]>(
    () =>
      stageEntries.map((entry) => {
        const enabled = isToolEnabled === undefined ? defaultDockEnabled(entry, pageSelection.length) : isToolEnabled(entry);
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
      }),
    [stageEntries, isToolEnabled, disabledReasonFor, onRunTool, pageSelection.length],
  );

  const selectionVerbs = useMemo<DockVerb[]>(
    () => buildSelectionVerbs(pageSelection, bulk, onClearPageSelection),
    [pageSelection, bulk, onClearPageSelection],
  );

  const primaryVerbs = primaryState === 'selection' ? selectionVerbs : stageVerbs;
  const primaryIds = useMemo(() => primaryVerbs.map((v) => v.id), [primaryVerbs]);

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
    () => dedupePinsAgainst(pinnedEntries, primaryIds),
    [pinnedEntries, primaryIds],
  );
  const pinnedVerbs = useMemo<DockVerb[]>(
    () =>
      dedupedPins.map((entry) => {
        const enabled = isToolEnabled === undefined ? defaultDockEnabled(entry, pageSelection.length) : isToolEnabled(entry);
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
      }),
    [dedupedPins, isToolEnabled, disabledReasonFor, onRunTool, pageSelection.length],
  );

  // Phase 58 — the EDIT-mode picker: the stage + global dock tools, minus the
  // ids already rendered (primary + pins). Registry-derived, so no unknown ids.
  const pickerEntries = useMemo<ToolEntry[]>(() => {
    const rendered = new Set<string>([...primaryIds, ...pinnedVerbs.map((v) => v.id)]);
    return dockPickerIdsForStage(activeStage).flatMap((id) => {
      if (rendered.has(id)) return [];
      const entry = toolById(id);
      return entry === undefined ? [] : [entry];
    });
  }, [activeStage, primaryIds, pinnedVerbs]);

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
      primaryVerbs.map((v) => v.label),
      pinnedVerbs.map((v) => v.label),
    ) + DOCK_EDIT_SLOT;
  const iconOnly = ladder.iconOnly;
  const measuredLabelOverflow =
    !ladder.iconOnly &&
    (isDockIconOnly(width) || (pill !== null && !labelsFitBand(need, labelBand)));
  // The lane decision (plan + hints): the ladder's last rung OR a labelled row
  // that cannot fit its band. Rendering of the arrows is separately gated on a
  // real overflow measurement (DEF-337).
  const arrowsLane = ladder.arrows || measuredLabelOverflow;
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
    `${iconOnly}:${Math.round(need)}`,
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
   *  carries `.anim-verb-in` — never a flash of an un-animated verb. */
  const addTool = useCallback(
    (id: string): void => {
      setEnteringIds((prev) => new Set(prev).add(id));
      onPinTool(id);
    },
    [onPinTool],
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
      : clampDockMenu(menu.x, menu.y, MENU_W, MENU_H, window.innerWidth, window.innerHeight);
  const menuPinned = menu !== null && pins.includes(menu.id);

  const renderVerb = (
    verb: DockVerb,
    opts: { primary: boolean; pin: boolean; index: number; out?: boolean },
  ): ReactElement => {
    const pressed = activeSet.has(verb.id);
    const group: 'primary' | 'pins' = opts.pin ? 'pins' : 'primary';
    // Phase 59 (item 3) — the add / remove bloom rides these two utilities. An
    // EXITING verb (a ghost held for its collapse) is inert: `pointer-events`
    // comes from `.anim-verb-out`, it is out of the tab order and it renders no
    // minus badge, so a click can never land on it and it can never run.
    const classes = ['btn', 'btn-ghost', 'btn-toggle', 'action-dock-verb'];
    if (opts.primary) classes.push('action-dock-verb-primary');
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
        <button
          type="button"
          className={classes.join(' ')}
          data-dock-verb={verb.id}
          data-dock-pin={opts.pin ? verb.id : undefined}
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
        >
          <span
            className={jiggle ? 'action-dock-icon anim-jiggle' : 'action-dock-icon'}
            style={jiggle ? { animationDelay: `-${jiggleDelayMs(verb.id)}ms` } : undefined}
            aria-hidden
          >
            <Icon name={verb.id as QuietIconId} size="lg" />
          </span>
          {!iconOnly && <span className="action-dock-label">{verb.label}</span>}
        </button>
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
            className="action-dock-minus"
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
        renderVerb(ghost.verb, { primary: false, pin: group === 'pins', index: -1, out: true }),
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
      data-dock-state={primaryState}
      data-dock-edit={editMode ? 'true' : 'false'}
      data-dock-idle={idle ? 'true' : 'false'}
      data-dock-icon-only={iconOnly ? 'true' : 'false'}
      data-dock-compact={compact ? 'true' : 'false'}
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
          maxWidth: `${dockCap}px`,
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
      {/* Phase 37 (item 21) — the Ctrl+K hint, a small themed line above the
          dock. It is absolutely positioned so it never joins the dock's single
          verb row, and it is hidden only at the ladder's smallest rung (the
          arrows, innerWidth < 720) with the rest of the shed chrome. The hint
          sits ABOVE the row, so it never competes for the row's width: it is
          keyed on the LADDER's width rung, not the measured overflow LANE. The
          eight labelled PAGES verbs make the lane turn on at 1440; keying on
          the lane hid the hint at the default window, which the operator asked
          to keep visible (item 21). */}
      {!ladder.arrows && (
        <span className="action-dock-hint" data-dock-hint>
          Search all tools: <kbd className="action-dock-kbd">Ctrl+K</kbd>
        </span>
      )}
      {/* Phase 37 (item 6) — the ladder's last rung: left/right arrows scroll
          the single verb row instead of wrapping or hiding verbs in a menu. */}
      {arrows && (
        <button
          type="button"
          className="btn btn-ghost btn-icon action-dock-arrow"
          data-dock-arrow="left"
          aria-label="Scroll dock tools left"
          title="Scroll left"
          onClick={(): void => scrollVerbs(-1)}
        >
          <Icon name="dockScrollLeft" size="lg" aria-hidden />
        </button>
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
        {overflowVerbs.length > 0 && (
          <div className="action-dock-overflow">
            <button
              type="button"
              className="btn btn-ghost action-dock-verb action-dock-more"
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
            </button>
            {overflowOpen && (
              <div className="action-dock-menu action-dock-menu-overflow anim-menu-pop" role="menu" data-dock-overflow-menu>
                {overflowVerbs.map((verb) => {
                  return (
                    <button
                      key={verb.id}
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost action-dock-menu-item"
                      data-dock-overflow-item={verb.id}
                      disabled={!verb.enabled}
                      title={verb.reason}
                      onClick={(): void => {
                        setOverflowOpen(false);
                        verb.run();
                      }}
                    >
                      <Icon name={verb.id as QuietIconId} size="lg" aria-hidden />
                      <span>{verb.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
          <div className="action-dock-add">
            <button
              type="button"
              className="btn btn-ghost btn-icon action-dock-plus"
              data-dock-plus
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              aria-label="Add a tool to the dock"
              title="Add a tool to the dock"
              onClick={(): void => {
                setMenu(null);
                setOverflowOpen(false);
                setPlusOpen((v) => !v);
              }}
            >
              <Icon icon={Plus} size="lg" aria-hidden />
            </button>
            {plusOpen && (
              <div
                className="action-dock-menu action-dock-menu-picker anim-menu-pop"
                role="menu"
                aria-label="Add a tool to the dock"
                data-dock-picker
              >
                {pickerEntries.map((entry) => {
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost action-dock-menu-item"
                      data-dock-picker-item={entry.id}
                      onClick={(): void => {
                        setPlusOpen(false);
                        addTool(entry.id);
                      }}
                    >
                      <Icon name={entry.id as QuietIconId} size="lg" aria-hidden />
                      <span>{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {arrows && (
        <button
          type="button"
          className="btn btn-ghost btn-icon action-dock-arrow"
          data-dock-arrow="right"
          aria-label="Scroll dock tools right"
          title="Scroll right"
          onClick={(): void => scrollVerbs(1)}
        >
          <Icon name="dockScrollRight" size="lg" aria-hidden />
        </button>
      )}
      {/* Phase 58 — the EDIT-mode pen. Phase 59 (item 3): it is now the dock's
          own TRAILING ROW ITEM (a flex child of `[data-action-dock]`, after the
          right arrow when the lane is on), never absolutely positioned — so its
          box is always fully inside the dock's bounds at every responsive rung
          and the verbs can never run under it. It is a 22px icon control; the
          fit budgets charge `DOCK_EDIT_SLOT` for it. Clicking toggles EDIT
          mode; Escape exits. */}
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-toggle action-dock-edit"
        data-dock-edit-toggle
        aria-pressed={editMode}
        aria-label="Edit dock tools"
        title="Edit dock tools"
        onClick={(): void => {
          setEditMode((v) => !v);
          setPlusOpen(false);
        }}
      >
        <Icon name="dockEditPencil" size="lg" aria-hidden />
      </button>
      {/* DEF-312 — the Pin/Unpin menu is portaled to `document.body`. The dock
          carries `transform: translateX(-50%)`, and a transformed ancestor is
          the containing block for `position: fixed` descendants, so the menu
          (fixed, clamped against the VIEWPORT) rendered ~700px below the
          window while it lived inside the dock. On the body it is positioned
          against the viewport, exactly like the thumbnail context menu. */}
      {menu !== null &&
        menuPos !== null &&
        createPortal(
          <div
            ref={menuRef}
            className="action-dock-menu anim-menu-pop"
            role="menu"
            aria-label={`${menu.id} options`}
            data-dock-menu
            style={{ left: menuPos.left, top: menuPos.top }}
          >
            <button
              type="button"
              role="menuitem"
              className="btn btn-ghost action-dock-menu-item"
              data-dock-menu-item="pin"
              disabled={menuPinned || !canPinMore(pins)}
              title={!menuPinned && !canPinMore(pins) ? 'Dock is full' : undefined}
              onClick={(): void => {
                setMenu(null);
                addTool(menu.id);
              }}
            >
              <span>Pin to dock</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn btn-ghost action-dock-menu-item"
              data-dock-menu-item="unpin"
              /* Phase 37 (item 21) — ANY rendered verb can be unpinned now: a
                 default stage verb is recorded in `dockUnpinned`, an explicit
                 pin is dropped from `dockPins`. The host owns which list.
                 Phase 59 (item 3) — it routes through `unpinFromMenu`, so the
                 verb collapses out in its own slot like a minus click. */
              onClick={(): void => {
                setMenu(null);
                unpinFromMenu(menu.id);
              }}
            >
              <span>Unpin from dock</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
