// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { seededEngineUiState } from "../../../src/renderer/App";
import type { EngineState } from "../../../src/renderer/engine/types";

function makeHydrated(): EngineState {
  return {
    pageCount: 2,
    modified: false,
    pageOrder: [0, 1],
    rotations: [90, 0],
    deleted: [false, false],
    annotations: [
      {
        id: "ann-1",
        kind: "ink",
        page: 1,
        color: "red",
        createdAt: "2026-01-01T00:00:00.000Z",
        width: 2,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
    formFields: [],
    signatures: [],
    textBoxes: [],
  };
}

describe("DEF-137 renderer half — seededEngineUiState hydrates the tab from the engine's post-load state", () => {
  it("returns the hydrated engine state verbatim with zero undo/redo counters", () => {
    const hydrated = makeHydrated();
    const ui = seededEngineUiState(hydrated, 2);
    expect(ui.state).toBe(hydrated);
    expect(ui.state.annotations).toHaveLength(1);
    expect(ui.state.rotations).toEqual([90, 0]);
    expect(ui.state.pageCount).toBe(2);
    expect(ui.counters).toEqual({ undoCount: 0, redoCount: 0 });
    expect(ui.canUndo).toBe(false);
    expect(ui.canRedo).toBe(false);
  });

  it("falls back to the empty initial state when getState fails (null)", () => {
    const ui = seededEngineUiState(null, 3);
    expect(ui.state.pageCount).toBe(3);
    expect(ui.state.annotations).toEqual([]);
    expect(ui.state.rotations).toEqual([0, 0, 0]);
    expect(ui.state.pageOrder).toEqual([0, 1, 2]);
    expect(ui.counters).toEqual({ undoCount: 0, redoCount: 0 });
    expect(ui.canUndo).toBe(false);
    expect(ui.canRedo).toBe(false);
  });

  it("does not flip modified: the open-time engine state is authoritative", () => {
    const hydrated = { ...makeHydrated(), modified: false };
    const ui = seededEngineUiState(hydrated, 2);
    expect(ui.state.modified).toBe(false);
  });
});