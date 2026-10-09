// Phase 36 (chunk 1b) — the stage model.
//
// The reducer is the single owner of the phase's stage invariants, so these
// tests pin all of them without a DOM:
//
//   1. SINGLE mode tracks a stage PER TAB, so switching one tab's stage never
//      propagates to another tab.
//   2. MULTI mode tracks a stage PER PANE: writing pane A can never move
//      pane B or any tab's stage.
//   3. An unknown stage value and an unknown pane id are both REFUSED (state
//      unchanged) rather than coerced; `stageForScope` falls back to the
//      default stage for an unknown scope so a surface can never render
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
  stageForScope,
  stageReducer,
  stageShortcutLabel,
  stageEffectsNeedApply,
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

describe("stage model — single mode (per tab)", () => {
  it("starts every tab on the default stage", () => {
    expect(initialStageState.perTab).toEqual({});
    expect(initialStageState.panes).toEqual({ A: "pages", B: "pages" });
    expect(stageForScope(initialStageState, "tab-1", null)).toBe("pages");
    expect(stageForScope(initialStageState, "tab-2", null)).toBe("pages");
  });

  it("sets one tab's stage without touching either pane or another tab", () => {
    const next = run(initialStageState, { type: "set", tabId: "tab-1", stage: "deliver" });
    expect(stageForScope(next, "tab-1", null)).toBe("deliver");
    expect(stageForScope(next, "tab-2", null)).toBe("pages");
    expect(next.panes).toEqual({ A: "pages", B: "pages" });
  });

  it("resets one tab back to the default", () => {
    const next = run(
      initialStageState,
      { type: "set", tabId: "tab-1", stage: "review" },
      { type: "reset", tabId: "tab-1" },
    );
    expect(stageForScope(next, "tab-1", null)).toBe("pages");
  });
});

describe("stage model — per-tab isolation", () => {
  it("holds two tabs on different stages simultaneously", () => {
    const next = run(
      initialStageState,
      { type: "set", tabId: "tab-a", stage: "edit" },
      { type: "set", tabId: "tab-b", stage: "deliver" },
    );
    expect(stageForScope(next, "tab-a", null)).toBe("edit");
    expect(stageForScope(next, "tab-b", null)).toBe("deliver");
  });

  it("does not change tab B's stage when tab A changes", () => {
    const before = run(initialStageState, { type: "set", tabId: "tab-b", stage: "review" });
    const after = run(before, { type: "set", tabId: "tab-a", stage: "deliver" });
    expect(stageForScope(after, "tab-b", null)).toBe("review");
    expect(stageForScope(after, "tab-a", null)).toBe("deliver");
  });

  it("resetting tab A restores the default for that tab only", () => {
    const before = run(
      initialStageState,
      { type: "set", tabId: "tab-a", stage: "deliver" },
      { type: "set", tabId: "tab-b", stage: "edit" },
    );
    const after = run(before, { type: "reset", tabId: "tab-a" });
    expect(stageForScope(after, "tab-a", null)).toBe("pages");
    expect(stageForScope(after, "tab-b", null)).toBe("edit");
    expect("tab-a" in after.perTab).toBe(false);
  });

  it("closing (resetting) a tab does not affect other tabs' stages", () => {
    const before = run(
      initialStageState,
      { type: "set", tabId: "tab-a", stage: "edit" },
      { type: "set", tabId: "tab-b", stage: "review" },
      { type: "set", tabId: "tab-c", stage: "deliver" },
    );
    const after = run(before, { type: "reset", tabId: "tab-b" });
    expect(stageForScope(after, "tab-a", null)).toBe("edit");
    expect(stageForScope(after, "tab-b", null)).toBe("pages");
    expect(stageForScope(after, "tab-c", null)).toBe("deliver");
  });

  it("does not mutate the input state object", () => {
    const before = initialStageState;
    run(before, { type: "set", tabId: "tab-1", stage: "deliver" });
    expect(before.perTab).toEqual({});
  });
});

describe("stage model — per-pane storage (Multi Mode)", () => {
  it("writes one pane without moving the other pane or any tab", () => {
    const next = run(initialStageState, { type: "set", pane: "A", stage: "review" });
    expect(next.panes.A).toBe("review");
    expect(next.panes.B).toBe("pages");
    expect(next.perTab).toEqual({});
  });

  it("keeps the two panes independent", () => {
    const next = run(
      initialStageState,
      { type: "set", pane: "A", stage: "edit" },
      { type: "set", pane: "B", stage: "deliver" },
    );
    expect(stageForScope(next, null, "A")).toBe("edit");
    expect(stageForScope(next, null, "B")).toBe("deliver");
    expect(stageForScope(next, null, null)).toBe("pages");
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
    expect(before.perTab).toEqual({});
  });
});

describe("stage model — fallbacks and refusals", () => {
  it("reads the pane's own stage for a pane scope", () => {
    const state: StageState = { perTab: {}, panes: { A: "edit", B: "deliver" } };
    expect(stageForScope(state, "ignored", "A")).toBe("edit");
  });

  it("reads a tab's own stage for a tab scope", () => {
    const state: StageState = { perTab: { "tab-1": "review" }, panes: { A: "edit", B: "deliver" } };
    expect(stageForScope(state, "tab-1", null)).toBe("review");
  });

  it("falls back to the default for an unknown tab id", () => {
    const state: StageState = { perTab: { "tab-1": "review" }, panes: { A: "edit", B: "deliver" } };
    expect(stageForScope(state, "tab-2", null)).toBe("pages");
  });

  it("falls back to the default for an unknown pane id", () => {
    const state: StageState = { perTab: {}, panes: { A: "edit", B: "deliver" } };
    expect(stageForScope(state, null, "C" as unknown as "A")).toBe("pages");
  });

  it("falls back to the default when a pane slot is missing", () => {
    const state: StageState = { perTab: {}, panes: {} as Record<"A" | "B", Stage> };
    expect(stageForScope(state, null, "A")).toBe("pages");
  });

  it("returns the default when there is no scope at all", () => {
    const state: StageState = { perTab: { "tab-1": "review" }, panes: { A: "edit", B: "deliver" } };
    expect(stageForScope(state, null, null)).toBe("pages");
  });

  it("refuses an unknown stage value", () => {
    const next = stageReducer(initialStageState, {
      type: "set",
      tabId: "tab-1",
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
    expect(stageReducer(state, { type: "set", pane: "B", stage: "pages" })).toBe(state);
    expect(stageReducer(state, { type: "reset", pane: "B" })).toBe(state);
    expect(stageReducer(initialStageState, { type: 'reset', pane: 'A' })).toBe(initialStageState);
    const withTab = run(initialStageState, { type: "set", tabId: "tab-1", stage: "edit" });
    expect(stageReducer(withTab, { type: "set", tabId: "tab-1", stage: "edit" })).toBe(withTab);
    expect(stageReducer(withTab, { type: "reset", tabId: "tab-2" })).toBe(withTab);
    expect(stageReducer(withTab, { type: "set", tabId: "tab-1", stage: "edit" })).toBe(withTab);
  });
});

// Phase 38 / DEF-342 — the EDIT stage's side effects must re-apply when the
// stage becomes applicable again, not only on a stage CHANGE. The repro:
// close the only tab while EDIT is active (exit clears edit mode App-side but
// the rail still shows EDIT), then reopen a document; the stage value never
// changed, yet the edit surface has to come back.
describe("stage model — stage effect re-application (DEF-342)", () => {
  it("re-applies on document arrival with an unchanged stage", () => {
    expect(
      stageEffectsNeedApply({
        prevStage: "edit",
        prevDocId: null,
        stage: "edit",
        docId: "tab-1",
      }),
    ).toBe(true);
  });

  it("does not re-apply when a document closes (the close path owns the reset)", () => {
    expect(
      stageEffectsNeedApply({
        prevStage: "edit",
        prevDocId: "tab-1",
        stage: "edit",
        docId: null,
      }),
    ).toBe(false);
  });

  it("re-applies on a tab switch while the stage is unchanged", () => {
    expect(
      stageEffectsNeedApply({
        prevStage: "edit",
        prevDocId: "tab-1",
        stage: "edit",
        docId: "tab-2",
      }),
    ).toBe(true);
  });

  it("does not re-apply when neither the stage nor the document changed", () => {
    expect(
      stageEffectsNeedApply({
        prevStage: "edit",
        prevDocId: "tab-1",
        stage: "edit",
        docId: "tab-1",
      }),
    ).toBe(false);
  });

  it("always re-applies on a genuine stage change, document or not", () => {
    expect(
      stageEffectsNeedApply({
        prevStage: "edit",
        prevDocId: "tab-1",
        stage: "pages",
        docId: "tab-1",
      }),
    ).toBe(true);
    expect(
      stageEffectsNeedApply({
        prevStage: "pages",
        prevDocId: null,
        stage: "edit",
        docId: null,
      }),
    ).toBe(true);
  });
});
