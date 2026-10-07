// @vitest-environment jsdom
//
// TFL-1130 (TFL-1116 DEF-620) - the per-tab page-size scope key.
//
// The host's `livePageSizes` map was keyed by pane ("single" when no pane), so
// every mounted tab in single mode published under the SAME key: the last tab
// to report overwrote the map and a re-activated tab never re-reported its own
// size (DEF-620). These specs pin the scope rule (pane in Multi Mode, ACTIVE
// TAB id in single mode) and the host lookup formula against the real
// `resolveInspectorPageSize`, so a tab away/back round trip resolves the ACTIVE
// tab's own geometry.

import { describe, expect, it } from "vitest";
import { livePageSizeScopeKey } from "../../../src/renderer/state/pageSizeScope";
import { resolveInspectorPageSize } from "../../../src/renderer/components/Inspector";

type SizeMap = ReadonlyMap<number, { w: number; h: number }>;
type SizeMaps = Record<string, SizeMap>;

/** App's report wiring: DocumentView publishes under `livePageSizeScopeKey(pane, tabId)`. */
function report(
  maps: SizeMaps,
  pane: string | null,
  tabId: string | null,
  sizes: SizeMap,
): SizeMaps {
  return { ...maps, [livePageSizeScopeKey(pane, tabId)]: sizes };
}

/** App's Inspector lookup: read the map for `livePageSizeScopeKey(stagePane, activeId)`. */
function activeSize(
  maps: SizeMaps,
  pane: string | null,
  activeTabId: string | null,
  page: number,
): { widthPt: number; heightPt: number } | null {
  return resolveInspectorPageSize(page, maps[livePageSizeScopeKey(pane, activeTabId)], {});
}

describe("TFL-1130 — the page-size scope key", () => {
  it("keys Multi Mode by the PANE, preserving the two-pane maps", () => {
    expect(livePageSizeScopeKey("A", "tab-a")).toBe("A");
    expect(livePageSizeScopeKey("B", "tab-b")).toBe("B");
  });

  it("keys single mode by the ACTIVE TAB id, never a shared 'single'", () => {
    expect(livePageSizeScopeKey(null, "tab-a")).toBe("tab-a");
    expect(livePageSizeScopeKey(null, "tab-b")).toBe("tab-b");
    expect(livePageSizeScopeKey(null, "tab-a")).not.toBe(livePageSizeScopeKey(null, "tab-b"));
  });

  it("falls back to the legacy sentinel only when there is neither pane nor tab", () => {
    expect(livePageSizeScopeKey(null, null)).toBe("single");
  });
});

describe("TFL-1130 — a tab away/back round trip resolves the ACTIVE tab's geometry", () => {
  it("keeps each tab's own map: the last tab to report no longer overwrites the previous tab", () => {
    const a: SizeMap = new Map([[1, { w: 612, h: 792 }]]);
    const b: SizeMap = new Map([[1, { w: 595, h: 842 }]]);
    let maps: SizeMaps = {};
    maps = report(maps, null, "tab-a", a);
    maps = report(maps, null, "tab-b", b);
    // Active tab is A again; A's own map wins, not B's later write.
    expect(activeSize(maps, null, "tab-a", 1)).toEqual({ widthPt: 612, heightPt: 792 });
    expect(activeSize(maps, null, "tab-b", 1)).toEqual({ widthPt: 595, heightPt: 842 });
  });

  it("resolves a page absent from the other tab's map (the 520-page 'Not available' case)", () => {
    const big: SizeMap = new Map([[260, { w: 612, h: 792 }]]);
    const small: SizeMap = new Map([[1, { w: 612, h: 792 }]]);
    let maps: SizeMaps = {};
    maps = report(maps, null, "big", big);
    maps = report(maps, null, "small", small);
    // Returning to the big tab at page 260 still reads the big tab's map,
    // not the small tab's (which has no page 260).
    expect(activeSize(maps, null, "big", 260)).toEqual({ widthPt: 612, heightPt: 792 });
    expect(activeSize(maps, null, "small", 260)).toBeNull();
  });

  it("keeps the two panes independent in Multi Mode", () => {
    const a: SizeMap = new Map([[1, { w: 612, h: 792 }]]);
    const b: SizeMap = new Map([[1, { w: 595, h: 842 }]]);
    let maps: SizeMaps = {};
    maps = report(maps, "A", "tab-a", a);
    maps = report(maps, "B", "tab-b", b);
    expect(activeSize(maps, "A", "tab-a", 1)).toEqual({ widthPt: 612, heightPt: 792 });
    expect(activeSize(maps, "B", "tab-b", 1)).toEqual({ widthPt: 595, heightPt: 842 });
  });
});
