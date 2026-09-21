// @vitest-environment jsdom
//
// Phase 32 — Multi Mode: the pane/mode state model.
//
// The reducer is the single owner of the phase's structural invariants, so
// these tests pin all of them without a DOM:
//
//   1. Enabling seeds pane A from the tab that was active and leaves pane B
//      empty; disabling clears both panes and touches no tab.
//   2. The same document can never occupy both panes: the conflicting assign
//      is REFUSED (state unchanged) and `paneAssignError` hands the caller
//      the message it must show.
//   3. There is no third pane: the state has exactly two pane slots and an
//      unknown pane id is refused rather than coerced.
//   4. A closed tab never leaves a stale pane (`reconcile`), and the mode
//      falls back to the single-pane state when every tab is gone.
//
// Every no-op case must return the SAME object (identity), so React can
// skip the re-render — that is what keeps a focus change or a refused
// assign from churning the two DocumentViews.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import {
  initialMultiModeState,
  isPaneFilled,
  multiModeReducer,
  otherPane,
  paneAssignError,
  paneAssignPathError,
  paneTabId,
  type MultiModeAction,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";

function run(
  state: MultiModeState,
  ...actions: MultiModeAction[]
): MultiModeState {
  return actions.reduce(multiModeReducer, state);
}

/** A mode that is on with "a" in pane A and an empty pane B. */
const ENABLED: MultiModeState = run(initialMultiModeState, {
  type: "enable",
  activeTabId: "a",
});

describe("multiModeReducer — enable / disable", () => {
  it("starts off with no panes and pane A focused", () => {
    expect(initialMultiModeState).toEqual({
      enabled: false,
      paneA: null,
      paneB: null,
      focused: "A",
    });
  });

  it("enabling seeds pane A from the active tab and leaves pane B empty", () => {
    const next = run(initialMultiModeState, { type: "enable", activeTabId: "a" });
    expect(next).toEqual({ enabled: true, paneA: "a", paneB: null, focused: "A" });
  });

  it("cannot enable without an active tab (no silent half-on state)", () => {
    const next = multiModeReducer(initialMultiModeState, {
      type: "enable",
      activeTabId: null,
    });
    expect(next).toBe(initialMultiModeState);
  });

  it("re-enabling re-seeds pane A and empties pane B", () => {
    const withB = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    const next = multiModeReducer(withB, { type: "enable", activeTabId: "c" });
    expect(next).toEqual({ enabled: true, paneA: "c", paneB: null, focused: "A" });
  });

  it("enabling with the already-seeded tab is a no-op", () => {
    const next = multiModeReducer(ENABLED, { type: "enable", activeTabId: "a" });
    expect(next).toBe(ENABLED);
  });

  it("disabling clears both panes without touching any tab", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    const next = multiModeReducer(withBoth, { type: "disable" });
    expect(next).toEqual(initialMultiModeState);
    // The tab ids are gone from the state but were never "closed" here:
    // this reducer owns no tab data at all.
    expect(Object.keys(next)).not.toContain("tabs");
  });

  it("disabling an already-off mode is a no-op", () => {
    expect(multiModeReducer(initialMultiModeState, { type: "disable" })).toBe(
      initialMultiModeState,
    );
  });
});

describe("multiModeReducer — assign / clear", () => {
  it("assigns a second document to pane B and replaces it on a later assign", () => {
    const withB = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    expect(withB.paneB).toBe("b");
    const replaced = multiModeReducer(withB, {
      type: "assign",
      pane: "B",
      tabId: "c",
    });
    expect(replaced.paneB).toBe("c");
    expect(replaced.paneA).toBe("a");
  });

  it("REFUSES the other pane's document and reports why", () => {
    const withB = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    // B holds "b"; assigning "b" to A must not duplicate it.
    expect(paneAssignError(withB, "A", "b")).toBe(
      "That document is already shown in the other pane.",
    );
    const refused = multiModeReducer(withB, {
      type: "assign",
      pane: "A",
      tabId: "b",
    });
    expect(refused).toBe(withB);
    expect(refused.paneA).toBe("a");
    expect(refused.paneB).toBe("b");
  });

  it("allows the same tab back into its own pane as a no-op", () => {
    const again = multiModeReducer(ENABLED, {
      type: "assign",
      pane: "A",
      tabId: "a",
    });
    expect(again).toBe(ENABLED);
  });

  it("refuses an assign while the mode is off", () => {
    expect(paneAssignError(initialMultiModeState, "A", "a")).toBe(
      "Turn on Multi Mode before assigning a document to a pane.",
    );
    const next = multiModeReducer(initialMultiModeState, {
      type: "assign",
      pane: "A",
      tabId: "a",
    });
    expect(next).toBe(initialMultiModeState);
  });

  it("has exactly two pane slots — there is no third pane", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    expect(Object.keys(withBoth).sort()).toEqual([
      "enabled",
      "focused",
      "paneA",
      "paneB",
    ]);
    // An id outside the two known slots is refused, not coerced.
    const third = multiModeReducer(withBoth, {
      type: "assign",
      pane: "C" as PaneId,
      tabId: "c",
    });
    expect(third).toBe(withBoth);
  });

  it("clears one pane and leaves the other alone", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    const cleared = multiModeReducer(withBoth, { type: "clear", pane: "B" });
    expect(cleared.paneB).toBeNull();
    expect(cleared.paneA).toBe("a");
    expect(cleared.enabled).toBe(true);
  });

  it("clearing an empty pane is a no-op", () => {
    expect(multiModeReducer(ENABLED, { type: "clear", pane: "B" })).toBe(ENABLED);
  });

  it("reports pane fill state through the helpers", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    expect(paneTabId(withBoth, "A")).toBe("a");
    expect(paneTabId(withBoth, "B")).toBe("b");
    expect(isPaneFilled(withBoth, "A")).toBe(true);
    expect(isPaneFilled(ENABLED, "B")).toBe(false);
    expect(otherPane("A")).toBe("B");
    expect(otherPane("B")).toBe("A");
  });
});

describe("paneAssignPathError — the same FILE never fills both panes (DEF-278)", () => {
  const paths: Record<string, string> = { a: "report.pdf", b: "long.pdf", b2: "report.pdf" };
  const filePathFor = (id: string): string | null => paths[id] ?? null;
  const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });

  it("refuses an incoming file whose PATH is the other pane's document", () => {
    // Target pane A; the other pane (B) holds "b" -> long.pdf.
    expect(paneAssignPathError(withBoth, "A", "long.pdf", filePathFor)).toBe(
      "That file is already shown in the other pane.",
    );
  });

  it("allows a different path", () => {
    expect(paneAssignPathError(withBoth, "A", "report.pdf", filePathFor)).toBeNull();
  });

  it("allows when the other pane is empty", () => {
    // Target pane A; the other pane (B) is empty.
    expect(paneAssignPathError(ENABLED, "A", "report.pdf", filePathFor)).toBeNull();
  });

  it("allows an empty or unknown incoming path", () => {
    expect(paneAssignPathError(withBoth, "A", "", filePathFor)).toBeNull();
    expect(paneAssignPathError(withBoth, "A", null, filePathFor)).toBeNull();
  });

  it("allows while the mode is off", () => {
    expect(
      paneAssignPathError(initialMultiModeState, "A", "report.pdf", filePathFor),
    ).toBeNull();
  });
});

describe("multiModeReducer — focus", () => {
  it("moves focus to the other pane and keeps exactly one focused pane", () => {
    const focused = multiModeReducer(ENABLED, { type: "focus", pane: "B" });
    expect(focused.focused).toBe("B");
    expect(focused.paneA).toBe("a");
  });

  it("focusing the already-focused pane is a no-op", () => {
    expect(multiModeReducer(ENABLED, { type: "focus", pane: "A" })).toBe(ENABLED);
  });

  it("refuses an unknown pane id", () => {
    const next = multiModeReducer(ENABLED, { type: "focus", pane: "C" as PaneId });
    expect(next).toBe(ENABLED);
  });
});

describe("multiModeReducer — reconcile", () => {
  it("clears a pane whose tab was closed", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    const after = multiModeReducer(withBoth, {
      type: "reconcile",
      tabIds: ["b", "c"],
    });
    expect(after.paneA).toBeNull();
    expect(after.paneB).toBe("b");
    expect(after.enabled).toBe(true);
  });

  it("keeps the state object when every pane is still live", () => {
    const withBoth = run(ENABLED, { type: "assign", pane: "B", tabId: "b" });
    expect(
      multiModeReducer(withBoth, { type: "reconcile", tabIds: ["a", "b"] }),
    ).toBe(withBoth);
  });

  it("falls back to the single-pane state when no tabs remain", () => {
    const after = multiModeReducer(ENABLED, { type: "reconcile", tabIds: [] });
    expect(after).toEqual(initialMultiModeState);
  });

  it("is inert while the mode is off", () => {
    expect(
      multiModeReducer(initialMultiModeState, { type: "reconcile", tabIds: ["a"] }),
    ).toBe(initialMultiModeState);
  });
});
