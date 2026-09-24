// Phase 36 (chunk 3a) — the thumbnail multi-select model.
//
// Pure, no DOM: the gesture reducer is the contract the rail's Thumb click
// feeds and the ActionDock's State 2 reads.

import { describe, expect, it } from "vitest";
import {
  EMPTY_PAGE_SELECTION,
  applyPageSelectGesture,
  clearPageSelection,
  normalizePageSelection,
  pageSelectGestureFor,
  prunePageSelection,
  samePageSelection,
  type PageSelectionState,
} from "../../../src/renderer/state/pageSelection";

const state = (pages: number[], anchor: number | null): PageSelectionState => ({
  pages,
  anchor,
});

describe("Phase 36 — pageSelectGestureFor", () => {
  it("maps Ctrl/Cmd to toggle, Shift to extend and a bare click to replace", () => {
    expect(pageSelectGestureFor({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe("toggle");
    expect(pageSelectGestureFor({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe("toggle");
    expect(pageSelectGestureFor({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe("extend");
    expect(pageSelectGestureFor({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe(
      "replace",
    );
  });

  it("prefers toggle over extend when both modifiers are held", () => {
    expect(pageSelectGestureFor({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe("toggle");
  });
});

describe("Phase 36 — normalizePageSelection", () => {
  it("sorts, de-dupes and clamps to the live page count", () => {
    expect(normalizePageSelection([3, 1, 2, 2, 9, 0, -1], 4)).toEqual([1, 2, 3]);
  });

  it("drops non-integers", () => {
    expect(normalizePageSelection([1.5, 2, Number.NaN], 3)).toEqual([2]);
  });
});

describe("Phase 36 — samePageSelection", () => {
  it("compares by value and order", () => {
    expect(samePageSelection([1, 2], [1, 2])).toBe(true);
    expect(samePageSelection([1, 2], [2, 1])).toBe(false);
    expect(samePageSelection([1], [1, 2])).toBe(false);
  });
});

describe("Phase 36 — applyPageSelectGesture", () => {
  it("replace selects exactly the clicked page and moves the anchor", () => {
    expect(applyPageSelectGesture(EMPTY_PAGE_SELECTION, 3, "replace", 5)).toEqual(
      state([3], 3),
    );
    expect(applyPageSelectGesture(state([1, 2], 1), 4, "replace", 5)).toEqual(state([4], 4));
  });

  it("replace is identity when it would not change anything", () => {
    const current = state([3], 3);
    expect(applyPageSelectGesture(current, 3, "replace", 5)).toBe(current);
  });

  it("toggle adds a page and keeps the rest", () => {
    expect(applyPageSelectGesture(state([1], 1), 3, "toggle", 5)).toEqual(state([1, 3], 3));
  });

  it("toggle removes a page already in the set", () => {
    expect(applyPageSelectGesture(state([1, 3], 1), 3, "toggle", 5)).toEqual(state([1], 3));
  });

  it("extend selects the inclusive range from the anchor", () => {
    expect(applyPageSelectGesture(state([2], 2), 5, "extend", 6)).toEqual(
      state([2, 3, 4, 5], 2),
    );
    expect(applyPageSelectGesture(state([5], 5), 2, "extend", 6)).toEqual(
      state([2, 3, 4, 5], 5),
    );
  });

  it("extend with no anchor behaves like replace", () => {
    expect(applyPageSelectGesture(EMPTY_PAGE_SELECTION, 4, "extend", 6)).toEqual(state([4], 4));
  });

  it("extend keeps the anchor and is identity when the range is unchanged", () => {
    const current = state([2, 3], 2);
    expect(applyPageSelectGesture(current, 3, "extend", 6)).toBe(current);
  });

  it("refuses an out-of-range page by identity", () => {
    const current = state([1], 1);
    expect(applyPageSelectGesture(current, 0, "toggle", 3)).toBe(current);
    expect(applyPageSelectGesture(current, 4, "toggle", 3)).toBe(current);
    expect(applyPageSelectGesture(current, 4, "replace", 3)).toBe(current);
  });
});

describe("Phase 36 — clearPageSelection / prunePageSelection", () => {
  it("clear empties the set and is identity when already empty", () => {
    expect(clearPageSelection(state([1, 2], 1))).toEqual(EMPTY_PAGE_SELECTION);
    expect(clearPageSelection(EMPTY_PAGE_SELECTION)).toBe(EMPTY_PAGE_SELECTION);
  });

  it("prune drops pages past a shrunken page count", () => {
    expect(prunePageSelection(state([1, 3, 5], 5), 3)).toEqual(state([1, 3], null));
  });

  it("prune is identity when nothing changed", () => {
    const current = state([1, 2], 1);
    expect(prunePageSelection(current, 4)).toBe(current);
  });
});
