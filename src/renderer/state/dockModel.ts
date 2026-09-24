// Phase 36 (chunk 3a) — the Action Dock's pure model.
//
// The dock is ONE component with exactly FOUR legal states (REQUIREMENTS.md
// Phase 36). Everything that can be decided without a DOM lives here so the
// states, the pin rules and the responsive plan are unit-testable:
//
//   State 1  stage verbs      — `toolsForStage(activeStage)` in registry order.
//   State 2  selection override — >=1 pages selected in the PAGES stage.
//   State 3  pinned tools     — dockPins appended after a divider, deduped
//                               against whatever the current state renders.
//   State 4  idle             — a modifier, never a state of its own: fade to
//                               ~40% after 3s without activity, NEVER while a
//                               tool is armed or a drag is in progress.
//
// State 3 is ADDITIVE (the spec: "a pinned tool already present in the current
// stage set is not duplicated" implies pins ride along with States 1/2), so
// `dockPrimaryState` resolves 1-vs-2 and the component appends the pins.

import type { Stage } from './stages';
import { toolById, type ToolAvailability, type ToolEntry } from './toolsRegistry';

/** The dock's idle delay (the spec's 3s). */
export const DOCK_IDLE_MS = 3000;

/** The dock's idled opacity (the spec's ~40%). */
export const DOCK_IDLE_OPACITY = 0.4;

/** At or below this canvas width the dock drops its labels (icon-only). */
export const DOCK_ICON_ONLY_WIDTH = 900;

/** At or below this canvas width the dock collapses LRU unpinned verbs. */
export const DOCK_COMPACT_WIDTH = 640;

/** The dock's pin cap (matches the settings validator's `dockPins` cap). */
export const DOCK_MAX_PINS = 4;

/** The State 2 bulk verbs, in order, as registry ids (so pin dedupe and the
 *  registry's own icons/labels are reused — the dock invents no list). */
export const DOCK_BULK_IDS = ['rotate', 'extract', 'merge', 'delete'] as const;

/** State 2's Clear control id (the registry's own selection-clearing entry). */
export const DOCK_CLEAR_ID = 'clearPageSelection';

/** Estimated icon-only verb width (16px icon + 4px/9px padding + the gap):
 *  only the compact overflow plan needs it, and tests pin the plan by
 *  passing a canvas width. */
export const DOCK_ICON_VERB_W = 38;

/** True when the dock renders icon-only at `width`. */
export function isDockIconOnly(width: number): boolean {
  return width < DOCK_ICON_ONLY_WIDTH;
}

/** True when the dock collapses its least-used unpinned verbs at `width`. */
export function isDockCompact(width: number): boolean {
  return width < DOCK_COMPACT_WIDTH;
}

/** The tooltip reason a verb is disabled, per the registry's declared
 *  precondition. The hosting surface owns the live gate; this is the copy the
 *  user sees when the gate is closed. */
export const DOCK_AVAILABILITY_REASON: Record<ToolAvailability, string> = {
  always: 'Not available right now',
  document: 'Open a document first',
  recents: 'No recent files yet',
  'form-fields': 'This document has no form fields',
  'ocr-run': 'Run Recognize text first',
  'multi-doc': 'Open a second document first',
  tab: 'Open a tab first',
  'colour-tool': 'Arm a colour-capable annotation tool first',
  'ink-tool': 'Arm the Pen tool first',
  'update-pending': 'No update is pending',
  selection: 'Select at least one page first',
};

/**
 * The dock's OWN half of the availability gate, used when the host supplies no
 * `isToolEnabled`. The dock can only judge the preconditions it has the state
 * for — `selection` (it owns the page set) — so everything else defaults to
 * enabled and the host's gate is authoritative for the rest.
 */
export function defaultDockEnabled(entry: ToolEntry, selectionCount: number): boolean {
  if (entry.availability === 'selection') return selectionCount > 0;
  return true;
}

/** The two primary shapes the dock can be in (State 3 rides along). */
export type DockPrimaryState = 'stage' | 'selection';

/**
 * Resolve the dock's primary state. The selection override applies ONLY in the
 * PAGES stage — a page selection made there stays in force while the user
 * reads it, and any other stage keeps its own verb set.
 */
export function dockPrimaryState(args: {
  activeStage: Stage;
  selectionCount: number;
}): DockPrimaryState {
  return args.activeStage === 'pages' && args.selectionCount > 0 ? 'selection' : 'stage';
}

/** The `[N pages]` chip's text. */
export function selectionChipLabel(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

/**
 * Validate the persisted `dockPins` against the registry: unknown ids are
 * dropped (the renderer owns the registry; main has none), duplicates collapse,
 * and the list is capped at `DOCK_MAX_PINS`. A non-array reads as no pins.
 */
export function sanitizeDockPins(raw: unknown, max: number = DOCK_MAX_PINS): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (toolById(value) === undefined) continue;
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Append a pin: unknown ids are refused, an existing pin is a no-op (identity),
 * and a full dock keeps its current pins rather than silently evicting one.
 */
export function addDockPin(pins: readonly string[], id: string): string[] {
  if (toolById(id) === undefined) return [...pins];
  if (pins.includes(id)) return [...pins];
  if (pins.length >= DOCK_MAX_PINS) return [...pins];
  return [...pins, id];
}

/** Remove a pin; a missing id is a no-op. */
export function removeDockPin(pins: readonly string[], id: string): string[] {
  if (!pins.includes(id)) return [...pins];
  return pins.filter((p) => p !== id);
}

/** True when the dock has room for one more pin. */
export function canPinMore(pins: readonly string[]): boolean {
  return pins.length < DOCK_MAX_PINS;
}

/**
 * Drop pins that duplicate the CURRENT state's own verbs. When every pin is a
 * duplicate the returned list is empty and the component collapses the divider
 * (the spec's rule).
 */
export function dedupePinsAgainst(
  pins: readonly ToolEntry[],
  primaryIds: readonly string[],
): ToolEntry[] {
  return pins.filter((entry) => !primaryIds.includes(entry.id));
}

/**
 * Order items for the compact overflow: highest usage first (the
 * "least-recently-used" verbs fall off the tail), ties keeping the incoming
 * (registry) order. Missing/zero counts read as 0. Generic over `{ id }` so the
 * component's own verb view-model can be ranked without a registry entry.
 */
export function orderEntriesByUsage<T extends { id: string }>(
  entries: readonly T[],
  usage: Readonly<Record<string, number>> | undefined,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, count: usage?.[entry.id] ?? 0 }))
    .sort((a, b) => (b.count - a.count) || (a.index - b.index))
    .map((row) => row.entry);
}

export interface DockOverflowPlan<T> {
  /** The verbs rendered inline. */
  visible: T[];
  /** The verbs collapsed into the trailing `...` chip (empty when none). */
  overflow: T[];
}

/**
 * The responsive overflow plan. Above the compact breakpoint every verb is
 * visible. Below it the dock keeps its PINNED verbs unconditionally (they are
 * not part of `primary` here) and keeps the highest-usage unpinned verbs that
 * fit the estimated capacity; the rest overflow into the `...` chip.
 */
export function planDockOverflow<T extends { id: string }>(args: {
  primary: readonly T[];
  pinnedCount: number;
  usage?: Readonly<Record<string, number>> | undefined;
  width: number;
}): DockOverflowPlan<T> {
  const { primary, pinnedCount, usage, width } = args;
  if (!isDockCompact(width)) {
    return { visible: [...primary], overflow: [] };
  }
  const capacity = Math.max(1, Math.floor((width - 16) / DOCK_ICON_VERB_W));
  const room = Math.max(0, capacity - pinnedCount);
  const ranked = orderEntriesByUsage(primary, usage);
  return {
    visible: ranked.slice(0, room),
    overflow: ranked.slice(room),
  };
}

/**
 * The idle decision. The dock may idle only when NOTHING is armed, NO drag is
 * in progress, the pointer is not hovering it, and `DOCK_IDLE_MS` has passed
 * since the last activity.
 */
export function shouldDockIdle(args: {
  lastActivityAt: number;
  now: number;
  armed: boolean;
  dragging: boolean;
  hovered: boolean;
}): boolean {
  if (args.armed || args.dragging || args.hovered) return false;
  return args.now - args.lastActivityAt >= DOCK_IDLE_MS;
}
