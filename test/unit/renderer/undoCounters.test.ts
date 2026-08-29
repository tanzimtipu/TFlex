// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ZERO_COUNTERS,
  countersAfterApply,
  countersAfterRedo,
  countersAfterSave,
  countersAfterUndo,
  flagsFromCounters,
} from "../../../src/renderer/state/undoCounters";

describe("undoCounters — flagsFromCounters", () => {
  it("returns both flags false at zero", () => {
    expect(flagsFromCounters(ZERO_COUNTERS)).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it("returns canUndo=true once undoCount > 0", () => {
    expect(flagsFromCounters({ undoCount: 1, redoCount: 0 })).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });

  it("returns canRedo=true once redoCount > 0", () => {
    expect(flagsFromCounters({ undoCount: 0, redoCount: 1 })).toEqual({
      canUndo: false,
      canRedo: true,
    });
  });

  it("returns both flags true when both stacks are non-empty", () => {
    expect(flagsFromCounters({ undoCount: 2, redoCount: 1 })).toEqual({
      canUndo: true,
      canRedo: true,
    });
  });
});

describe("undoCounters — countersAfterApply", () => {
  it("first apply: undoCount=1, redoCount=0", () => {
    expect(countersAfterApply(ZERO_COUNTERS)).toEqual({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it("stack of two applies: undoCount=2, redoCount=0", () => {
    expect(countersAfterApply(countersAfterApply(ZERO_COUNTERS))).toEqual({
      undoCount: 2,
      redoCount: 0,
    });
  });

  it("new apply after undo clears the redo stack", () => {
    // simulate 2 applies then 1 undo -> undoCount=1, redoCount=1
    const a = countersAfterApply(countersAfterApply(ZERO_COUNTERS));
    const u = countersAfterUndo(a);
    expect(u).toEqual({ undoCount: 1, redoCount: 1 });
    // a fresh apply clears redo and pushes undo
    const a2 = countersAfterApply(u);
    expect(a2).toEqual({ undoCount: 2, redoCount: 0 });
  });
});

describe("undoCounters — countersAfterUndo", () => {
  it("decrements undoCount and increments redoCount", () => {
    const start = { undoCount: 3, redoCount: 0 };
    expect(countersAfterUndo(start)).toEqual({ undoCount: 2, redoCount: 1 });
  });

  it("clamps undoCount at zero (defensive against engine bugs)", () => {
    const start = { undoCount: 0, redoCount: 0 };
    expect(countersAfterUndo(start)).toEqual({ undoCount: 0, redoCount: 1 });
  });

  it("repeating undo shrinks the undo stack step by step", () => {
    let c: { undoCount: number; redoCount: number } = countersAfterApply(
      countersAfterApply(countersAfterApply(ZERO_COUNTERS)),
    );
    expect(c).toEqual({ undoCount: 3, redoCount: 0 });
    c = countersAfterUndo(c);
    expect(c).toEqual({ undoCount: 2, redoCount: 1 });
    c = countersAfterUndo(c);
    expect(c).toEqual({ undoCount: 1, redoCount: 2 });
    c = countersAfterUndo(c);
    expect(c).toEqual({ undoCount: 0, redoCount: 3 });
  });
});

describe("undoCounters — countersAfterRedo", () => {
  it("increments undoCount and decrements redoCount", () => {
    const start = { undoCount: 0, redoCount: 2 };
    expect(countersAfterRedo(start)).toEqual({ undoCount: 1, redoCount: 1 });
  });

  it("clamps redoCount at zero (defensive against engine bugs)", () => {
    const start = { undoCount: 1, redoCount: 0 };
    expect(countersAfterRedo(start)).toEqual({ undoCount: 2, redoCount: 0 });
  });
});

describe("undoCounters — countersAfterSave", () => {
  it("resets both counters to zero regardless of input", () => {
    expect(countersAfterSave({ undoCount: 7, redoCount: 3 })).toEqual({
      undoCount: 0,
      redoCount: 0,
    });
  });
});

describe("undoCounters — realistic sequence (the DEF-010 repro)", () => {
  it("multi-step undo keeps canUndo=true until the stack is drained", () => {
    // The exact adversary scenario: 4 rotate ops, then undo 3 times.
    let c = ZERO_COUNTERS;
    c = countersAfterApply(c); // rotate 1
    c = countersAfterApply(c); // rotate 2
    c = countersAfterApply(c); // rotate 3
    c = countersAfterApply(c); // rotate 4
    expect(flagsFromCounters(c)).toEqual({ canUndo: true, canRedo: false });

    c = countersAfterUndo(c); // first undo
    expect(flagsFromCounters(c)).toEqual({ canUndo: true, canRedo: true });

    c = countersAfterUndo(c); // second undo
    expect(flagsFromCounters(c)).toEqual({ canUndo: true, canRedo: true });

    c = countersAfterUndo(c); // third undo
    expect(flagsFromCounters(c)).toEqual({ canUndo: true, canRedo: true });

    c = countersAfterUndo(c); // fourth undo — stack now empty
    expect(flagsFromCounters(c)).toEqual({ canUndo: false, canRedo: true });
  });

  it("save clears both stacks so a fresh apply starts from canUndo=true only", () => {
    let c = ZERO_COUNTERS;
    c = countersAfterApply(c);
    c = countersAfterApply(c);
    c = countersAfterUndo(c);
    c = countersAfterSave(c);
    expect(flagsFromCounters(c)).toEqual({ canUndo: false, canRedo: false });
    c = countersAfterApply(c);
    expect(flagsFromCounters(c)).toEqual({ canUndo: true, canRedo: false });
  });
});
