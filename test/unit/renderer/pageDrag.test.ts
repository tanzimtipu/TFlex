// @vitest-environment node
//
// Phase 32 (chunk 2d) — the pure page-drag mapping.
//
// The drag payload -> operation mapping both paths share: the source
// (tab + 1-based pages), the target (tab + 1-based insertion slot, -1 =
// append), move vs copy, the multi-page selection case, and the guards.
// No React, no engine.

import { describe, expect, it } from "vitest";
import {
  buildDragSource,
  canvasDropIsAfter,
  canvasInsertIndex,
  dropEffectFor,
  dropModeFromEvent,
  insertedStartPage,
  railInsertIndex,
  resolveDrop,
  type PageDragSource,
  type PageDropTarget,
} from "../../../src/renderer/state/pageDrag";

const source = (tabId: string, pages: number[], anchorPage = pages[0]): PageDragSource => ({
  tabId,
  pages,
  anchorPage,
});
const target = (tabId: string, atIndex: number): PageDropTarget => ({ tabId, atIndex });

describe("buildDragSource — single page vs the whole selection", () => {
  it("drags just the grabbed page when it is not in the selection", () => {
    expect(buildDragSource("a", 5, [2, 3])).toEqual({ tabId: "a", pages: [5], anchorPage: 5 });
  });

  it("drags the whole selection, in document order, when it includes the grabbed page", () => {
    expect(buildDragSource("a", 3, [5, 2, 3])).toEqual({
      tabId: "a",
      pages: [2, 3, 5],
      anchorPage: 3,
    });
  });

  it("drags just the grabbed page when there is no selection", () => {
    expect(buildDragSource("a", 7, null)).toEqual({ tabId: "a", pages: [7], anchorPage: 7 });
  });
});

describe("insertion slots", () => {
  it("a rail drop lands BEFORE the target thumb", () => {
    expect(railInsertIndex(4)).toBe(4);
  });

  it("a canvas drop before a page uses that page's slot", () => {
    expect(canvasInsertIndex(4, 10, false)).toBe(4);
  });

  it("a canvas drop after a middle page uses the next slot", () => {
    expect(canvasInsertIndex(4, 10, true)).toBe(5);
  });

  it("a canvas drop after the LAST page uses the -1 append sentinel", () => {
    expect(canvasInsertIndex(10, 10, true)).toBe(-1);
  });

  it("reads the pointer's half of the slot", () => {
    expect(canvasDropIsAfter(110, 100, 100)).toBe(false);
    expect(canvasDropIsAfter(160, 100, 100)).toBe(true);
    expect(canvasDropIsAfter(120, 100, 100)).toBe(false);
  });
});

describe("move vs copy modifiers", () => {
  it("defaults to move", () => {
    expect(dropModeFromEvent({ ctrlKey: false, altKey: false })).toBe("move");
  });
  it("Ctrl makes it a copy", () => {
    expect(dropModeFromEvent({ ctrlKey: true, altKey: false })).toBe("copy");
  });
  it("Alt makes it a copy", () => {
    expect(dropModeFromEvent({ ctrlKey: false, altKey: true })).toBe("copy");
  });
  it("communicates the mode through the dropEffect", () => {
    expect(dropEffectFor("move")).toBe("move");
    expect(dropEffectFor("copy")).toBe("copy");
  });
});

describe("resolveDrop — cross-document move / copy", () => {
  it("moves a single page into the other document at the 1-based slot", () => {
    expect(resolveDrop(source("a", [2]), target("b", 4), "move", 10)).toEqual({
      fromTabId: "a",
      pages: [2],
      toTabId: "b",
      atIndex: 4,
      mode: "move",
      sameDoc: false,
    });
  });

  it("keeps the whole multi-page selection, in order, for a copy", () => {
    expect(resolveDrop(source("a", [2, 3, 5], 3), target("b", 1), "copy", 10)).toEqual({
      fromTabId: "a",
      pages: [2, 3, 5],
      toTabId: "b",
      atIndex: 1,
      mode: "copy",
      sameDoc: false,
    });
  });

  it("passes the -1 append sentinel straight through", () => {
    expect(resolveDrop(source("a", [1]), target("b", -1), "move", 4)?.atIndex).toBe(-1);
  });
});

describe("resolveDrop — intra-document reorder is unchanged", () => {
  it("inserts before a lower target, shifting for the removed page", () => {
    // Dragging page 1 onto page 3 (insert before 3): 1 < 3 -> slot 2.
    const op = resolveDrop(source("a", [1]), target("a", 3), "move", 5);
    expect(op?.sameDoc).toBe(true);
    expect(op?.atIndex).toBe(2);
    expect(op?.pages).toEqual([1]);
  });

  it("inserts at the target slot when dragging upward", () => {
    // Dragging page 4 onto page 2 (insert before 2): 4 > 2 -> slot 2.
    expect(resolveDrop(source("a", [4]), target("a", 2), "move", 5)?.atIndex).toBe(2);
  });

  it("is a no-op dropping a page on itself", () => {
    expect(resolveDrop(source("a", [3]), target("a", 3), "move", 5)).toBeNull();
  });

  it("is a no-op dropping a page on the slot just after itself", () => {
    expect(resolveDrop(source("a", [3]), target("a", 4), "move", 5)).toBeNull();
  });

  it("never routes a same-document drop to the cross-document op", () => {
    const op = resolveDrop(source("a", [1]), target("a", 4), "move", 5);
    expect(op?.sameDoc).toBe(true);
    expect(op?.fromTabId).toBe(op?.toTabId);
  });

  it("rejects a multi-page selection for a same-document drop (reorder is one page)", () => {
    expect(resolveDrop(source("a", [1, 2], 1), target("a", 4), "move", 5)).toBeNull();
  });
});

describe("resolveDrop — guards", () => {
  it("is null with no source", () => {
    expect(resolveDrop(null, target("b", 1), "move", 3)).toBeNull();
  });
  it("is null with no target", () => {
    expect(resolveDrop(source("a", [1]), null, "move", 3)).toBeNull();
  });
  it("is null with an empty page list", () => {
    expect(resolveDrop(source("a", []), target("b", 1), "move", 3)).toBeNull();
  });
  it("is null for a non-append slot below 1 in the other document", () => {
    expect(resolveDrop(source("a", [1]), target("b", 0), "move", 3)).toBeNull();
  });
});

describe("insertedStartPage — where the target pane reveals the drop", () => {
  it("uses the insertion slot for a mid-document drop", () => {
    expect(
      insertedStartPage(
        { fromTabId: "a", pages: [2], toTabId: "b", atIndex: 4, mode: "move", sameDoc: false },
        9,
      ),
    ).toBe(4);
  });
  it("derives the start for an append of a multi-page selection", () => {
    expect(
      insertedStartPage(
        { fromTabId: "a", pages: [2, 3, 5], toTabId: "b", atIndex: -1, mode: "copy", sameDoc: false },
        8,
      ),
    ).toBe(6);
  });
});
