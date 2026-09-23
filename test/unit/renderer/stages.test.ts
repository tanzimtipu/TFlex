// Phase 36 (chunk 1b) — the stage model.
//
// The reducer is the single owner of the phase's stage invariants, so these
// tests pin all of them without a DOM:
//
//   1. SINGLE mode has exactly one active stage.
//   2. MULTI mode tracks a stage PER PANE: writing pane A can never move
//      pane B or the single-mode stage.
//   3. An unknown stage value and an unknown pane id are both REFUSED (state
//      unchanged) rather than coerced; `stageForPane` falls back to the
//      single-mode stage for an unknown scope so a surface can never render
//      nothing.
//   4. `Ctrl+1..4` maps to STAGE_ORDER and only the exact chord fires.
//   5. Every no-op returns the SAME object (identity) so React can skip the
//      re-render.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE,
  STAGE_LABELS,
  STAGE_ORDER,
  initialStageState,
  isPaneId,
  isStage,
  stageForCtrlDigit,
  stageForDigit,
  stageForPane,
  stageReducer,
  stageShortcutLabel,
  type Stage,
  type StageAction,
  type StageState,
} from "../../../src/renderer/state/stages";

function run(state: StageState, ...actions: StageAction[]): StageState {
  return actions.reduce<StageState>((acc, action) => stageReducer(acc, action), state);
}

describe("stage model — the four stages", () => {
  it("orders the stages pages, edit, review, deliver", () => {
    expect(STAGE_ORDER).toEqual(["pages", "edit", "review", "deliver"]);
    expect(DEFAULT_STAGE).toBe("pages");
  });

  it("labels every stage", () => {
    expect(STAGE_LABELS).toEqual({
      pages: "Pages",
      edit: "Edit",
      review: "Review",
      deliver: "Deliver",
    });
  });

  it("recognises exactly the four stage values", () => {
    for (const stage of STAGE_ORDER) expect(isStage(stage)).toBe(true);
    expect(isStage("global")).toBe(false);
    expect(isStage("")).toBe(false);
    expect(isStage(undefined)).toBe(false);
    expect(isStage(4)).toBe(false);
  });

  it("recognises exactly the two pane ids", () => {
    expect(isPaneId("A")).toBe(true);
    expect(isPaneId("B")).toBe(true);
    expect(isPaneId("C")).toBe(false);
    expect(isPaneId(null)).toBe(false);
  });

  it("labels the Ctrl shortcut for each stage", () => {
    expect(STAGE_ORDER.map(stageShortcutLabel)).toEqual([
      "Ctrl+1",
      "Ctrl+2",
      "Ctrl+3",
      "Ctrl+4",
    ]);
  });
});

describe("stage model — Ctrl+1..4", () => {
  it("maps each digit to its stage", () => {
    expect(stageForDigit("1")).toBe("pages");
    expect(stageForDigit("2")).toBe("edit");
    expect(stageForDigit("3")).toBe("review");
    expect(stageForDigit("4")).toBe("deliver");
  });

  it("returns null outside the mapping", () => {
    expect(stageForDigit("0")).toBeNull();
    expect(stageForDigit("5")).toBeNull();
    expect(stageForDigit("")).toBeNull();
    expect(stageForDigit("11")).toBeNull();
    expect(stageForDigit("a")).toBeNull();
  });

  it("fires only on the exact Ctrl+digit chord", () => {
    const chord = { key: "3", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(stageForCtrlDigit(chord)).toBe("review");
    expect(stageForCtrlDigit({ ...chord, shiftKey: true })).toBeNull();
    expect(stageForCtrlDigit({ ...chord, altKey: true })).toBeNull();
    expect(stageForCtrlDigit({ ...chord, metaKey: true })).toBeNull();
    expect(stageForCtrlDigit({ ...chord, ctrlKey: false })).toBeNull();
    expect(stageForCtrlDigit({ ...chord, key: "p" })).toBeNull();
    // The pre-existing document shortcuts are never claimed by the mapping.
    expect(stageForCtrlDigit({ ...chord, key: "s" })).toBeNull();
    expect(stageForCtrlDigit({ ...chord, key: "f" })).toBeNull();
  });
});

describe("stage model — single mode", () => {
  it("starts on the default stage", () => {
    expect(initialStageState.single).toBe("pages");
    expect(initialStageState.panes).toEqual({ A: "pages", B: "pages" });
  });

  it("sets the single stage without touching either pane", () => {
    const next = run(initialStageState, { type: "set", pane: null, stage: "deliver" });
    expect(next.single).toBe("deliver");
    expect(next.panes).toEqual({ A: "pages", B: "pages" });
  });

  it("resets the single stage back to the default", () => {
    const next = run(
      initialStageState,
      { type: "set", pane: null, stage: "review" },
      { type: "reset", pane: null },
    );
    expect(next.single).toBe("pages");
  });
});

describe("stage model — per-pane storage (Multi Mode)", () => {
  it("writes one pane without moving the other pane or single mode", () => {
    const next = run(initialStageState, { type: "set", pane: "A", stage: "review" });
    expect(next.panes.A).toBe("review");
    expect(next.panes.B).toBe("pages");
    expect(next.single).toBe("pages");
  });

  it("keeps the two panes independent", () => {
    const next = run(
      initialStageState,
      { type: "set", pane: "A", stage: "edit" },
      { type: "set", pane: "B", stage: "deliver" },
    );
    expect(stageForPane(next, "A")).toBe("edit");
    expect(stageForPane(next, "B")).toBe("deliver");
    expect(stageForPane(next, null)).toBe("pages");
  });

  it("resets a pane back to the default", () => {
    const next = run(
      initialStageState,
      { type: 'set', pane: 'B', stage: 'deliver' },
      { type: 'reset', pane: 'B' },
    );
    expect(next.panes.B).toBe('pages');
    expect(next.panes.A).toBe('pages');
  });

  it("does not mutate the input state object", () => {
    const before = initialStageState;
    run(before, { type: "set", pane: "A", stage: "deliver" });
    expect(before.panes.A).toBe("pages");
    expect(before.single).toBe("pages");
  });
});

describe("stage model — fallbacks and refusals", () => {
  it("reads the single stage for a null scope", () => {
    const state: StageState = { single: "review", panes: { A: "edit", B: "deliver" } };
    expect(stageForPane(state, null)).toBe("review");
  });

  it("falls back to the single stage for an unknown pane id", () => {
    const state: StageState = { single: "review", panes: { A: "edit", B: "deliver" } };
    expect(stageForPane(state, "C" as unknown as "A")).toBe("review");
  });

  it("falls back to the single stage when a pane slot is missing", () => {
    const state: StageState = { single: "edit", panes: {} as Record<"A" | "B", Stage> };
    expect(stageForPane(state, "A")).toBe("edit");
  });

  it("refuses an unknown stage value", () => {
    const next = stageReducer(initialStageState, {
      type: "set",
      pane: null,
      stage: "global" as unknown as Stage,
    });
    expect(next).toBe(initialStageState);
  });

  it("refuses an unknown pane id", () => {
    const next = stageReducer(initialStageState, {
      type: "set",
      pane: "C" as unknown as "A",
      stage: "review",
    });
    expect(next).toBe(initialStageState);
  });

  it("returns the same object for every no-op (React re-render guard)", () => {
    const state = run(initialStageState, { type: "set", pane: "A", stage: "review" });
    expect(stageReducer(state, { type: "set", pane: "A", stage: "review" })).toBe(state);
    expect(stageReducer(state, { type: "set", pane: null, stage: "pages" })).toBe(state);
    expect(stageReducer(state, { type: "set", pane: "B", stage: "pages" })).toBe(state);
    expect(stageReducer(state, { type: "reset", pane: "B" })).toBe(state);
    expect(stageReducer(state, { type: "reset", pane: null })).toBe(state);
    expect(stageReducer(initialStageState, { type: 'reset', pane: 'A' })).toBe(initialStageState);
  });
});
