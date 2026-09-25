// DEF-348a — the shared Action Dock is WORKSPACE-level in Multi Mode: it must
// stay present and functional whenever a document exists, whichever pane is
// focused. `resolveDockPane` is the pure rule the App wiring consumes; when the
// focused pane is EMPTY it returns the pane that owns a document.

import { describe, expect, it } from "vitest";
import { resolveDockPane } from "../../../src/renderer/state/multiChrome";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const state = (
  paneA: string | null,
  paneB: string | null,
  focused: "A" | "B",
): MultiModeState => ({ enabled: true, paneA, paneB, focused });

describe("resolveDockPane (DEF-348a)", () => {
  it("keeps the focused pane when it owns a document", () => {
    expect(resolveDockPane(state("t1", null, "A"), "A")).toBe("A");
    expect(resolveDockPane(state("t1", "t2", "B"), "B")).toBe("B");
  });

  it("falls back to the document pane when the EMPTY pane is focused", () => {
    // The reproduction: one document in A, focus moves to empty B.
    expect(resolveDockPane(state("t1", null, "B"), "B")).toBe("A");
    // Mirror: one document in B, focus on empty A.
    expect(resolveDockPane(state(null, "t1", "A"), "A")).toBe("B");
  });

  it("returns the focused pane when neither pane owns a document", () => {
    // Nothing to show: the dock renders nothing, which is correct.
    expect(resolveDockPane(state(null, null, "B"), "B")).toBe("B");
    expect(resolveDockPane(state(null, null, "A"), "A")).toBe("A");
  });

  it("returns the focused pane when BOTH panes own a document", () => {
    expect(resolveDockPane(state("t1", "t2", "A"), "A")).toBe("A");
    expect(resolveDockPane(state("t1", "t2", "B"), "B")).toBe("B");
  });
});
