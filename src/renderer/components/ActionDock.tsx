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
//                                chip plus Rotate / Extract / Merge / Delete /
//                                Clear. Clear returns to State 1.
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
import { Ellipsis } from 'lucide-react';
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
  selectionChipLabel,
} from '../state/dockModel';
import {
  DOCK_DEFAULT_RESERVE,
  DOCK_LIFT_INSET,
  DOCK_PILL_GAP,
  dockBand,
  dockPlanWidth,
  labelledDockNeed,
  labelsFitBand,
  pillBandHeight,
  pillReserve,
  shouldLiftDock,
  type PillBox,
} from '../state/dockFit';
import { toolById, dockToolsForStage, type ToolEntry } from '../state/toolsRegistry';
import type { Stage } from '../state/stages';

/** The State 2 bulk verbs, reusing the EXISTING multi-page engine/dialog
 *  paths. The host owns them; the dock only passes the selected page array. */
export interface DockBulkActions {
  onRotate: (pages: readonly number[]) => void;
  onExtract: (pages: readonly number[]) => void;
  onMerge: (pages: readonly number[]) => void;
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
    merge: (): void => bulk.onMerge(pages),
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
    onPinTool,
    onUnpinTool,
    onRunTool,
    isToolEnabled,
    disabledReasonFor,
    toolArmed = false,
    dragInProgress = false,
    canvasWidth,
    toolUsage,
    activeToolIds,
    onIdleChange,
  } = props;

  const rootRef = useRef<HTMLElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1200 : window.innerWidth,
  );
  const [hovered, setHovered] = useState(false);
  const [idle, setIdle] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [menu, setMenu] = useState<PinMenuState | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  /** DEF-315 — the MEASURED pill band: the reserve the dock must leave clear
   *  (from the pills' own inner edges) and their height for the vertical yield.
   *  `null` until measured; the cap then falls back to the live measurement. */
  const [pill, setPill] = useState<{ reserve: number; pillHeight: number } | null>(null);
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
      const page = box(host.querySelector('[data-page-pill]'));
      const zoom = box(host.querySelector('[data-zoom-pill]'));
      if (page === null && zoom === null) return;
      const reserve = pillReserve({
        page,
        zoom,
        hostLeft: hostRect.left,
        hostRight: hostRect.right,
      });
      const bandHeight = pillBandHeight(page, zoom);
      const key = `${reserve}:${Math.round(bandHeight)}`;
      if (key === pillKeyRef.current) return;
      pillKeyRef.current = key;
      setPill({ reserve, pillHeight: bandHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const pageEl = host.querySelector('[data-page-pill]');
    const zoomEl = host.querySelector('[data-zoom-pill]');
    if (pageEl !== null) ro.observe(pageEl);
    if (zoomEl !== null) ro.observe(zoomEl);
    return (): void => ro.disconnect();
  }, []);

  const width = canvasWidth ?? measuredWidth;
  const compact = isDockCompact(width);
  const hostIconOnly = isDockIconOnly(width);
  // DEF-315 — the band the dock may occupy and whether the pills leave room
  // for it at all. `reserve` is the measured pill band, consumed by the CSS
  // cap (`max-width: 100% - var(--dock-reserve)`) and the inline cap here.
  const reserve = pill?.reserve ?? DOCK_DEFAULT_RESERVE;
  const band = dockBand(width, reserve);
  const lifted = pill !== null && shouldLiftDock(band);
  const planWidth = dockPlanWidth({ hostWidth: width, band, lifted, measured: pill !== null });
  const dockCap = lifted ? Math.max(0, width - 2 * DOCK_LIFT_INSET) : band;
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
  const stageEntries = useMemo(() => dockToolsForStage(activeStage), [activeStage]);
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
  const pinnedEntries = useMemo(
    () => pins.flatMap((id) => (toolById(id) === undefined ? [] : [toolById(id) as ToolEntry])),
    [pins],
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

  // ---- responsive overflow ---------------------------------------------
  // DEF-315 — plan on the BAND once the pills are measured, so the `...` chip
  // absorbs the overflow inside it rather than the dock growing toward a pill.
  const plan = useMemo(
    () =>
      planDockOverflow({
        primary: primaryVerbs,
        pinnedCount: pinnedVerbs.length,
        usage: toolUsage,
        width: planWidth,
      }),
    [primaryVerbs, pinnedVerbs.length, toolUsage, planWidth],
  );
  // DEF-315 — the labels yield EARLIER than the 900px host break when the
  // labelled dock (with its pins) cannot fit the measured band.
  const iconOnly =
    hostIconOnly ||
    (pill !== null &&
      !labelsFitBand(
        labelledDockNeed(primaryVerbs.length, pinnedVerbs.length),
        band,
      ));
  const visibleIds = useMemo(() => new Set(plan.visible.map((e) => e.id)), [plan]);
  const inlineVerbs = useMemo(
    () => primaryVerbs.filter((v) => visibleIds.has(v.id)),
    [primaryVerbs, visibleIds],
  );
  const overflowVerbs = useMemo(
    () => primaryVerbs.filter((v) => !visibleIds.has(v.id)),
    [primaryVerbs, visibleIds],
  );

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

  const openMenu = (id: string, x: number, y: number): void => {
    setOverflowOpen(false);
    setMenu({ id, x, y });
  };

  const menuPos =
    menu === null
      ? null
      : clampDockMenu(menu.x, menu.y, MENU_W, MENU_H, window.innerWidth, window.innerHeight);
  const menuPinned = menu !== null && pins.includes(menu.id);

  const renderVerb = (verb: DockVerb, opts: { primary: boolean; pin: boolean }): ReactElement => {
    const Icon = verb.icon;
    const pressed = activeSet.has(verb.id);
    return (
      <button
        key={opts.pin ? `pin:${verb.id}` : verb.id}
        type="button"
        className={
          opts.primary
            ? 'action-dock-verb action-dock-verb-primary'
            : 'action-dock-verb'
        }
        data-dock-verb={verb.id}
        data-dock-pin={opts.pin ? verb.id : undefined}
        aria-label={verb.label}
        aria-pressed={pressed ? true : undefined}
        disabled={!verb.enabled}
        title={verb.reason}
        onClick={(): void => verb.run()}
        onContextMenu={(e): void => {
          e.preventDefault();
          openMenu(verb.id, e.clientX, e.clientY);
        }}
      >
        <span className="action-dock-icon" aria-hidden>
          <Icon size={16} />
        </span>
        {!iconOnly && <span className="action-dock-label">{verb.label}</span>}
      </button>
    );
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
      data-dock-idle={idle ? 'true' : 'false'}
      data-dock-icon-only={iconOnly ? 'true' : 'false'}
      data-dock-compact={compact ? 'true' : 'false'}
      data-dock-band={Math.round(band)}
      data-dock-lift={lifted ? 'true' : 'false'}
      /* DEF-315 — the measured pill geometry, published where the stylesheet
       * consumes it. `--dock-reserve` is the pill band the cap subtracts;
       * `--dock-lift` parks the dock above the pill row when the band cannot
       * hold it (0px otherwise, so the transform is a no-op). */
      style={
        {
          maxWidth: `${dockCap}px`,
          '--dock-reserve': `${reserve}px`,
          '--dock-lift': `${lifted ? (pill?.pillHeight ?? 0) + DOCK_PILL_GAP : 0}px`,
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
      {primaryState === 'selection' && (
        <span className="action-dock-chip" data-dock-chip>
          {selectionChipLabel(pageSelection.length)}
        </span>
      )}
      <div className="action-dock-group" key={primaryState} data-dock-group="primary">
        {inlineVerbs.map((verb, index) => renderVerb(verb, { primary: index === 0, pin: false }))}
      </div>
      {overflowVerbs.length > 0 && (
        <div className="action-dock-overflow">
          <button
            type="button"
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
              <Ellipsis size={16} />
            </span>
            {!iconOnly && <span className="action-dock-label">More</span>}
          </button>
          {overflowOpen && (
            <div className="action-dock-menu action-dock-menu-overflow" role="menu" data-dock-overflow-menu>
              {overflowVerbs.map((verb) => {
                const Icon = verb.icon;
                return (
                  <button
                    key={verb.id}
                    type="button"
                    role="menuitem"
                    className="action-dock-menu-item"
                    data-dock-overflow-item={verb.id}
                    disabled={!verb.enabled}
                    title={verb.reason}
                    onClick={(): void => {
                      setOverflowOpen(false);
                      verb.run();
                    }}
                  >
                    <Icon size={14} aria-hidden />
                    <span>{verb.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {pinnedVerbs.length > 0 && (
        <>
          <span className="action-dock-divider" role="separator" data-dock-divider />
          <div className="action-dock-group" data-dock-group="pins">
            {pinnedVerbs.map((verb) => renderVerb(verb, { primary: false, pin: true }))}
          </div>
        </>
      )}
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
            className="action-dock-menu"
            role="menu"
            aria-label={`${menu.id} options`}
            data-dock-menu
            style={{ left: menuPos.left, top: menuPos.top }}
          >
            <button
              type="button"
              role="menuitem"
              className="action-dock-menu-item"
              data-dock-menu-item="pin"
              disabled={menuPinned || !canPinMore(pins)}
              title={!menuPinned && !canPinMore(pins) ? 'Dock is full (max 4 pins)' : undefined}
              onClick={(): void => {
                setMenu(null);
                onPinTool(menu.id);
              }}
            >
              <span>Pin to dock</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="action-dock-menu-item"
              data-dock-menu-item="unpin"
              disabled={!menuPinned}
              onClick={(): void => {
                setMenu(null);
                onUnpinTool(menu.id);
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
