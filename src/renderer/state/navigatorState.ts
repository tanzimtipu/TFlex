// Phase 111 (chunk D2a) — per-document navigator state.
//
// The active navigation view (Pages / Outline / Annotations) is remembered
// SEPARATELY per document, keyed by the stable engine doc id. These are PURE
// helpers so the state transition is pinned with no DOM: the caller owns the
// `Record<docId, RailTab>` map and threads it through `restoreRailTab` /
// `recordRailTab`. The map is session-scoped and never persisted to settings.
//
// `restoreRailTab(map, docId)` returns the stored tab for `docId`, else the
// `'thumbs'` default. A null / unknown id also falls back to `'thumbs'`.
// `recordRailTab(map, docId, tab)` returns a NEW map with `docId` set to
// `tab`; a null `docId` returns the SAME map unchanged (nothing to key on).

import type { RailTab } from '../components/SideRail';

/** The rail view a document opens with when it has no stored tab. */
export const DEFAULT_RAIL_TAB: RailTab = 'thumbs';

export function restoreRailTab(
  map: Record<string, RailTab>,
  docId: string | null,
): RailTab {
  if (docId === null) return DEFAULT_RAIL_TAB;
  return map[docId] ?? DEFAULT_RAIL_TAB;
}

export function recordRailTab(
  map: Record<string, RailTab>,
  docId: string | null,
  tab: RailTab,
): Record<string, RailTab> {
  if (docId === null) return map;
  return { ...map, [docId]: tab };
}
