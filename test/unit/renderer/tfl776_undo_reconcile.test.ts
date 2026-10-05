// TFL-776.6 (DEF-564) — the renderer-only `committedTextRuns` registry must be
// reconciled with engine undo/redo, so an undone run delete stops suppressing
// the restored run while a redone delete suppresses again, and MOVED-run
// phantom suppression / DEF-149 latest-text preference survive unrelated
// history changes. Pure reducer + selector guard (no DOM).
import { describe, expect, it } from "vitest";
import {
  committedTextRunAt,
  editReducer,
  initialEditState,
  isMaskedRunRect,
  type CommittedTextRun,
  type EditState,
} from "../../../src/renderer/edit/model";

const RECT = { x: 100, y: 100, width: 200, height: 20 };

function push(state: EditState, run: CommittedTextRun): EditState {
  return editReducer(state, { type: "push-text-run-commit", run });
}

function reconcile(state: EditState, undoCount: number, phase: "op" | "undo" | "redo"): EditState {
  return editReducer(state, { type: "reconcile-text-run-history", undoCount, phase });
}

describe("TFL-776.6 — committedTextRuns reconciled with engine history", () => {
  it("an undone delete commit stops suppressing; redo suppresses again", () => {
    // Delete: engine op applies (undoCount 0 -> 1). The commit is dispatched
    // before the counter mirrors, so it lands pending; the op reconcile stamps
    // it at depth 1 (mirrors App.tsx noteOpApplied).
    let state = push(initialEditState, { page: 1, rect: { ...RECT }, text: "", maskedRect: { ...RECT } });
    state = reconcile(state, 1, "op");
    expect(state.committedTextRuns?.[0]?.undoDepth).toBe(1);
    expect(isMaskedRunRect(state.committedTextRuns, 1, RECT), "delete suppresses while live").toBe(true);

    // Ctrl+Z: engine reverts depth 1 (undoCount 1 -> 0). The restored run must
    // be live again — the phantom must no longer be filtered.
    const undone = reconcile(state, 0, "undo");
    expect(undone.committedTextRuns?.[0]?.reverted).toBe(true);
    expect(undone.historyEpoch, "undo bumps the history epoch so the overlay drops its stale run selection").toBe(1);
    expect(isMaskedRunRect(undone.committedTextRuns, 1, RECT), "restored run is live").toBe(false);
    expect(committedTextRunAt(undone.committedTextRuns, 1, { x: 150, y: 110 }), "no stale text").toBeNull();

    // Ctrl+Y: engine re-applies depth 1 (undoCount 0 -> 1). The vacated rect is
    // inert again.
    const redone = reconcile(undone, 1, "redo");
    expect(redone.committedTextRuns?.[0]?.reverted).toBe(false);
    expect(isMaskedRunRect(redone.committedTextRuns, 1, RECT), "redone delete suppresses").toBe(true);
  });

  it("undoing a later op leaves an earlier MOVED-run mask intact and restores it on redo", () => {
    // Move A (depth 1, masks A's original rect), then delete B (depth 2).
    let state = push(initialEditState, { page: 1, rect: { x: 300, y: 100, width: 200, height: 20 }, text: "A", maskedRect: { ...RECT } });
    state = reconcile(state, 1, "op");
    state = push(state, { page: 1, rect: { x: 400, y: 300, width: 200, height: 20 }, text: "", maskedRect: { x: 400, y: 300, width: 200, height: 20 } });
    state = reconcile(state, 2, "op");

    const undone = reconcile(state, 1, "undo");
    expect(isMaskedRunRect(undone.committedTextRuns, 1, RECT), "A's masked original survives B's undo").toBe(true);
    expect(isMaskedRunRect(undone.committedTextRuns, 1, { x: 400, y: 300, width: 200, height: 20 }), "B's delete is reverted").toBe(false);

    const redone = reconcile(undone, 2, "redo");
    expect(isMaskedRunRect(redone.committedTextRuns, 1, { x: 400, y: 300, width: 200, height: 20 }), "B re-suppressed").toBe(true);
    expect(isMaskedRunRect(redone.committedTextRuns, 1, RECT), "A still suppressed").toBe(true);
  });

  it("a diverging new op drops the discarded redo branch's reverted commit", () => {
    // Edit depth 1, undo it (reverted), then a new op at depth 1 overwrites the
    // redo entry. The reverted commit must be pruned, not resurrected.
    let state = push(initialEditState, { page: 1, rect: { ...RECT }, text: "edited" });
    state = reconcile(state, 1, "op");
    state = reconcile(state, 0, "undo");
    expect(state.committedTextRuns?.length).toBe(1);
    state = reconcile(state, 1, "op");
    expect(state.committedTextRuns?.length, "discarded redo commit pruned").toBe(0);
    expect(committedTextRunAt(state.committedTextRuns, 1, { x: 150, y: 110 })).toBeNull();
  });

  it("DEF-149 preference uses the newest live commit and ignores a reverted one", () => {
    let state = push(initialEditState, { page: 1, rect: { ...RECT }, text: "old" });
    state = reconcile(state, 1, "op");
    state = push(state, { page: 1, rect: { ...RECT }, text: "newest" });
    state = reconcile(state, 2, "op");
    expect(committedTextRunAt(state.committedTextRuns, 1, { x: 150, y: 110 })).toBe("newest");

    // Undo the newest edit: it must fall back to the earlier live commit.
    state = reconcile(state, 1, "undo");
    expect(committedTextRunAt(state.committedTextRuns, 1, { x: 150, y: 110 })).toBe("old");
  });
});