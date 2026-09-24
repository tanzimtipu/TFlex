// Phase 36 (chunk 3a) — the Action Dock's pure model.
//
// Pins, the four-state resolver, the responsive overflow plan and the idle
// decision, all without a DOM.

import { describe, expect, it } from "vitest";
import {
  DOCK_AVAILABILITY_REASON,
  DOCK_IDLE_MS,
  DOCK_ICON_ONLY_WIDTH,
  DOCK_COMPACT_WIDTH,
  DOCK_MAX_PINS,
  addDockPin,
  canPinMore,
  dedupePinsAgainst,
  dockPrimaryState,
  isDockCompact,
  isDockIconOnly,
  orderEntriesByUsage,
  planDockOverflow,
  removeDockPin,
  sanitizeDockPins,
  selectionChipLabel,
  shouldDockIdle,
} from "../../../src/renderer/state/dockModel";
import { TOOL_REGISTRY, toolById, toolsForStage, type ToolEntry } from "../../../src/renderer/state/toolsRegistry";

const entry = (id: string): ToolEntry => {
  const found = toolById(id);
  if (found === undefined) throw new Error(`no registry entry ${id}`);
  return found;
};

describe("Phase 36 — sanitizeDockPins", () => {
  it("drops unknown ids (the renderer owns the registry)", () => {
    expect(sanitizeDockPins(["merge", "not-a-tool", "rotate"])).toEqual(["merge", "rotate"]);
  });

  it("de-dupes and caps at four", () => {
    expect(sanitizeDockPins(["merge", "merge", "rotate", "split", "delete", "extract"])).toEqual([
      "merge",
      "rotate",
      "split",
      "delete",
    ]);
    expect(DOCK_MAX_PINS).toBe(4);
  });

  it("reads a non-array (or non-string members) as no pins", () => {
    expect(sanitizeDockPins(undefined)).toEqual([]);
    expect(sanitizeDockPins("merge")).toEqual([]);
    expect(sanitizeDockPins([1, null, {}])).toEqual([]);
  });
});

describe("Phase 36 — pin mutation", () => {
  it("adds a known id, refuses an unknown one and never duplicates", () => {
    expect(addDockPin([], "merge")).toEqual(["merge"]);
    expect(addDockPin(["merge"], "merge")).toEqual(["merge"]);
    expect(addDockPin(["merge"], "nope")).toEqual(["merge"]);
  });

  it("keeps the cap rather than silently evicting a pin", () => {
    const full = ["merge", "rotate", "split", "delete"];
    expect(canPinMore(full)).toBe(false);
    expect(addDockPin(full, "extract")).toEqual(full);
  });

  it("removes a pin and no-ops on a missing id", () => {
    expect(removeDockPin(["merge", "rotate"], "merge")).toEqual(["rotate"]);
    expect(removeDockPin(["merge"], "rotate")).toEqual(["merge"]);
  });
});

describe("Phase 36 — dockPrimaryState / selectionChipLabel", () => {
  it("shows the selection override only in PAGES with at least one page", () => {
    expect(dockPrimaryState({ activeStage: "pages", selectionCount: 0 })).toBe("stage");
    expect(dockPrimaryState({ activeStage: "pages", selectionCount: 1 })).toBe("selection");
    expect(dockPrimaryState({ activeStage: "pages", selectionCount: 3 })).toBe("selection");
    expect(dockPrimaryState({ activeStage: "edit", selectionCount: 3 })).toBe("stage");
    expect(dockPrimaryState({ activeStage: "review", selectionCount: 3 })).toBe("stage");
    expect(dockPrimaryState({ activeStage: "deliver", selectionCount: 3 })).toBe("stage");
  });

  it("labels the chip with a natural plural", () => {
    expect(selectionChipLabel(1)).toBe("1 page");
    expect(selectionChipLabel(2)).toBe("2 pages");
  });
});

describe("Phase 36 — responsive breakpoints", () => {
  it("drops labels below 900 and overflows below 640", () => {
    expect(isDockIconOnly(DOCK_ICON_ONLY_WIDTH)).toBe(false);
    expect(isDockIconOnly(DOCK_ICON_ONLY_WIDTH - 1)).toBe(true);
    expect(isDockCompact(DOCK_COMPACT_WIDTH)).toBe(false);
    expect(isDockCompact(DOCK_COMPACT_WIDTH - 1)).toBe(true);
  });
});

describe("Phase 36 — dedupePinsAgainst", () => {
  it("drops a pin already rendered by the current state", () => {
    expect(dedupePinsAgainst([entry("rotate"), entry("split")], ["rotate", "delete"])).toEqual([
      entry("split"),
    ]);
  });

  it("returns empty when every pin is a duplicate (the divider collapses)", () => {
    expect(dedupePinsAgainst([entry("rotate")], ["rotate"])).toEqual([]);
  });
});

describe("Phase 36 — orderEntriesByUsage / planDockOverflow", () => {
  const entries = [entry("merge"), entry("split"), entry("rotate"), entry("delete")];

  it("ranks by usage descending, ties keeping registry order", () => {
    expect(orderEntriesByUsage(entries, { delete: 5, split: 2 }).map((e) => e.id)).toEqual([
      "delete",
      "split",
      "merge",
      "rotate",
    ]);
  });

  it("shows every verb above the compact breakpoint", () => {
    const plan = planDockOverflow({ primary: entries, pinnedCount: 0, width: 900 });
    expect(plan.visible.map((e) => e.id)).toEqual(["merge", "split", "rotate", "delete"]);
    expect(plan.overflow).toEqual([]);
  });

  it("collapses the least-used unpinned verbs into the overflow", () => {
    // 500px canvas -> floor((500 - 16) / 38) = 12 capacity, so nothing overflows.
    const wide = planDockOverflow({ primary: entries, pinnedCount: 0, width: 500 });
    expect(wide.overflow).toEqual([]);
    // 100px canvas -> floor((100 - 16) / 38) = 2 capacity.
    const narrow = planDockOverflow({
      primary: entries,
      pinnedCount: 0,
      usage: { merge: 9, split: 8 },
      width: 100,
    });
    expect(narrow.visible.map((e) => e.id)).toEqual(["merge", "split"]);
    expect(narrow.overflow.map((e) => e.id)).toEqual(["rotate", "delete"]);
  });

  it("reserves room for the pinned verbs that stay", () => {
    const plan = planDockOverflow({
      primary: entries,
      pinnedCount: 1,
      usage: { merge: 9, split: 8, rotate: 7 },
      width: 100,
    });
    expect(plan.visible.map((e) => e.id)).toEqual(["merge"]);
    expect(plan.overflow.map((e) => e.id)).toEqual(["split", "rotate", "delete"]);
  });
});

describe("Phase 36 — shouldDockIdle", () => {
  const base = { lastActivityAt: 0, now: DOCK_IDLE_MS, armed: false, dragging: false, hovered: false };

  it("idles at the 3s boundary and not before", () => {
    expect(shouldDockIdle({ ...base, now: DOCK_IDLE_MS - 1 })).toBe(false);
    expect(shouldDockIdle(base)).toBe(true);
  });

  it("never idles while armed, dragging or hovered", () => {
    expect(shouldDockIdle({ ...base, armed: true })).toBe(false);
    expect(shouldDockIdle({ ...base, dragging: true })).toBe(false);
    expect(shouldDockIdle({ ...base, hovered: true })).toBe(false);
  });
});

describe("Phase 36 — availability copy", () => {
  it("has a reason for every registry availability value", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(DOCK_AVAILABILITY_REASON[tool.availability]).toBeTruthy();
    }
  });

  it("the dock's stage contents come from the registry (no local list)", () => {
    for (const stage of ["pages", "edit", "review", "deliver"] as const) {
      expect(toolsForStage(stage).every((t) => t.stage === stage)).toBe(true);
    }
  });
});
