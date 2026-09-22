// @vitest-environment jsdom
// DEF-292 — renderer adapter half of the joint cross-document undo/redo.
//
// The engine records ONE joint entry on BOTH documents when pages move
// between the two Multi Mode panes, so undoing from either reverts both
// and the result echoes the OTHER document's state as `pairedState`. The
// adapter must:
//   - normalize + cache BOTH documents from the single round-trip,
//   - return the ACTIVE document's normalized state as before,
//   - re-attach the paired state NORMALIZED (never the raw wire blob),
//   - let a failed joint undo's typed engine-error pass through untouched.
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";

interface WireState {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  annotations?: unknown[];
  placedSignatures?: { id: string }[];
  pairedState?: { docId: string; state: WireState };
}

function wireState(overrides: Partial<WireState> = {}): WireState {
  return {
    pageCount: 3,
    modified: true,
    pageOrder: [0, 1, 2],
    rotations: [0, 0, 0],
    deleted: [false, false, false],
    ...overrides,
  };
}

type UndoRedoResult =
  | { ok: true; value: WireState }
  | { ok: false; error: { code: string; message: string } };

/** Minimal TFlexApiEngine stand-in; only undo/redo are meaningful. */
function makeFakeRealEngine(opts: {
  undo?: UndoRedoResult;
  redo?: UndoRedoResult;
}) {
  const empty = wireState({ modified: false });
  return {
    available: true,
    async loadDocument() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async applyOp() {
      return { ok: true as const, value: empty };
    },
    async undo() {
      return opts.undo ?? { ok: true as const, value: empty };
    },
    async redo() {
      return opts.redo ?? { ok: true as const, value: empty };
    },
    async merge() {
      return { ok: true as const, value: empty };
    },
    async split() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async extract() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async save() {
      return { ok: true as const, value: "/path" };
    },
    async saveAs() {
      return { ok: true as const, value: "/path" };
    },
    async getState() {
      return { ok: true as const, value: empty };
    },
  };
}

function install(engine: ReturnType<typeof makeFakeRealEngine>): void {
  (window as unknown as { tflex: { engine: typeof engine } }).tflex = { engine };
  _resetEngineForTests();
}

afterEach(() => {
  delete (window as unknown as { tflex?: unknown }).tflex;
  _resetEngineForTests();
});

describe("DEF-292 — engineClient.undo joint cross-document result", () => {
  it("normalizes and caches BOTH documents from one round-trip", async () => {
    install(
      makeFakeRealEngine({
        undo: {
          ok: true,
          value: wireState({
            pageCount: 2,
            pairedState: {
              docId: "doc-b",
              // Wire-only `placedSignatures` and no `annotations` key:
              // both must be normalized for the OTHER document too.
              state: wireState({
                pageCount: 7,
                placedSignatures: [{ id: "sig-9" }],
              }),
            },
          }),
        },
      }),
    );
    const e = getEngine();
    const r = await e.undo("doc-a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Active document cached.
    expect(e.peekLastState?.("doc-a")?.pageCount).toBe(2);
    // Paired document cached, in renderer shape.
    const cachedB = e.peekLastState?.("doc-b");
    expect(cachedB?.pageCount).toBe(7);
    expect(cachedB?.signatures).toEqual([{ id: "sig-9" }]);
    expect(
      (cachedB as unknown as { placedSignatures?: unknown })?.placedSignatures,
    ).toBeUndefined();
    expect(cachedB?.annotations).toEqual([]);

    // The returned active state carries the SAME normalized paired object
    // (identity) so the App can mirror it without a second getState.
    expect(r.value.pairedState?.docId).toBe("doc-b");
    expect(r.value.pairedState?.state).toBe(cachedB);
    // The raw wire blob never leaks through the active state.
    expect(
      (r.value as unknown as { placedSignatures?: unknown }).placedSignatures,
    ).toBeUndefined();
  });

  it("returns the active document's normalized state and drops no annotations", async () => {
    install(
      makeFakeRealEngine({
        undo: {
          ok: true,
          value: wireState({
            annotations: [{ kind: "text-box", id: "a1" }],
          }),
        },
      }),
    );
    const r = await getEngine().undo("doc-a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Wire "text-box" translated to the renderer's "textbox" tag.
    expect(r.value.annotations).toEqual([{ kind: "textbox", id: "a1" }]);
    // No paired echo on a single-document undo — nothing extra attached.
    expect(r.value.pairedState).toBeUndefined();
  });

  it("leaves a single-document undo untouched (no paired cache, no paired state)", async () => {
    install(makeFakeRealEngine({ undo: { ok: true, value: wireState() } }));
    const e = getEngine();
    const r = await e.undo("doc-a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pairedState).toBeUndefined();
    expect(e.peekLastState?.("doc-a")).toBe(r.value);
    expect(e.peekLastState?.("doc-b")).toBeUndefined();
  });
});

describe("DEF-292 — engineClient.redo joint cross-document result", () => {
  it("normalizes and caches BOTH documents (symmetric to undo)", async () => {
    install(
      makeFakeRealEngine({
        redo: {
          ok: true,
          value: wireState({
            pageCount: 4,
            pairedState: {
              docId: "doc-b",
              state: wireState({ pageCount: 8, placedSignatures: [{ id: "s1" }] }),
            },
          }),
        },
      }),
    );
    const e = getEngine();
    const r = await e.redo("doc-a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pageCount).toBe(4);
    expect(r.value.pairedState?.docId).toBe("doc-b");
    expect(r.value.pairedState?.state).toBe(e.peekLastState?.("doc-b"));
    expect(e.peekLastState?.("doc-b")?.pageCount).toBe(8);
  });
});

describe("DEF-292 — engineClient joint undo/redo error pass-through", () => {
  it("passes a failed joint undo through unchanged and touches no cache", async () => {
    const failure = {
      ok: false as const,
      error: {
        code: "engine-error",
        message:
          "cannot undo cross-document move: document doc-b is no longer open",
      },
    };
    install(makeFakeRealEngine({ undo: failure }));
    const e = getEngine();
    const r = await e.undo("doc-a");
    expect(r).toEqual(failure);
    expect(e.peekLastState?.("doc-a")).toBeUndefined();
    expect(e.peekLastState?.("doc-b")).toBeUndefined();
  });

  it("passes a diverged joint redo through with its message intact", async () => {
    const failure = {
      ok: false as const,
      error: {
        code: "engine-error",
        message: "cannot undo cross-document move: the other document has diverged",
      },
    };
    install(makeFakeRealEngine({ redo: failure }));
    const r = await getEngine().redo("doc-a");
    expect(r).toEqual(failure);
  });
});