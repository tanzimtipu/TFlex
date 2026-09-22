// DEF-292 — pure planning logic for the other pane's joint-undo/redo refresh.
//
// App wiring can't be mounted in a unit test, so the decision — which tab
// to update, with which state and which counters — lives in
// `planJointPaneRefresh` and is pinned here. The App-side apply call and
// the adapter's cache work are covered by the sibling DEF-292 tests.
import { describe, expect, it } from "vitest";
import { planJointPaneRefresh } from "../../../src/renderer/state/jointUndo";
import type { EngineState } from "../../../src/renderer/engine/types";

function state(pageCount: number): EngineState {
  return {
    pageCount,
    modified: true,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    annotations: [],
  };
}

const noTab = (): string | null => null;

describe("planJointPaneRefresh", () => {
  it("returns null when there is no paired echo (single-document undo)", () => {
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      undefined,
      () => "tab-b",
      () => undefined,
    );
    expect(plan).toBeNull();
  });

  it("returns null when the paired document has no live tab", () => {
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      { docId: "doc-b", state: state(5) },
      noTab,
      () => undefined,
    );
    expect(plan).toBeNull();
  });

  it("returns null when the paired doc resolves to the active tab (defensive)", () => {
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      { docId: "doc-a", state: state(5) },
      () => "tab-a",
      () => undefined,
    );
    expect(plan).toBeNull();
  });

  it("undo: pops the other doc's undo stack and pushes redo", () => {
    const paired = state(6);
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      { docId: "doc-b", state: paired },
      () => "tab-b",
      () => ({ undoCount: 3, redoCount: 1 }),
    );
    expect(plan).not.toBeNull();
    expect(plan?.tabId).toBe("tab-b");
    expect(plan?.state).toBe(paired);
    expect(plan?.counters).toEqual({ undoCount: 2, redoCount: 2 });
    expect(plan?.canUndo).toBe(true);
    expect(plan?.canRedo).toBe(true);
  });

  it("redo: pushes the other doc's undo stack and pops redo", () => {
    const plan = planJointPaneRefresh(
      "redo",
      "tab-a",
      { docId: "doc-b", state: state(4) },
      () => "tab-b",
      () => ({ undoCount: 2, redoCount: 1 }),
    );
    expect(plan?.counters).toEqual({ undoCount: 3, redoCount: 0 });
    expect(plan?.canUndo).toBe(true);
    expect(plan?.canRedo).toBe(false);
  });

  it("undo at the other doc's last entry clamps undoCount at zero", () => {
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      { docId: "doc-b", state: state(2) },
      () => "tab-b",
      () => ({ undoCount: 1, redoCount: 4 }),
    );
    expect(plan?.counters).toEqual({ undoCount: 0, redoCount: 5 });
    expect(plan?.canUndo).toBe(false);
    expect(plan?.canRedo).toBe(true);
  });

  it("treats missing other-tab counters as the zero baseline", () => {
    const plan = planJointPaneRefresh(
      "undo",
      "tab-a",
      { docId: "doc-b", state: state(2) },
      () => "tab-b",
      () => undefined,
    );
    expect(plan?.counters).toEqual({ undoCount: 0, redoCount: 1 });
    expect(plan?.canUndo).toBe(false);
    expect(plan?.canRedo).toBe(true);
  });
});