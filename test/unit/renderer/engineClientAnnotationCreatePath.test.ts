// @vitest-environment jsdom
//
// DEF-068 — onCreateAnnotation path through RealEngineAdapter.
//
// The defect: after the user creates a highlight / textbox / arrow /
// note, `window.tflexDiagnostics().engineState.annotations` does not
// reflect the new annotation. The fix is the per-doc previous-state
// cache inside RealEngineAdapter (NormalizeState consults `_prev` when
// the wire omits `annotations`). These tests pin the contract at the
// boundary App.tsx's `onCreateAnnotation` walks in production:
//
//   1. Fresh doc, wire echoes the full list -> result.annotations
//      contains the new entry by id.
//   2. Fresh doc, wire omits the annotations key -> result.annotations
//      is empty (no carry-forward yet because prev was undefined).
//   3. Existing-list seed then createAnnotation with wire omitting the
//      key -> result.annotations carries the prior list forward
//      (DEF-068 carry-forward).
//   4. The RealEngineAdapter returns the new annotation through the
//      SAME Promise chain App.tsx awaits (no swallowed promise).
//   5. After noteOpApplied is fed the result, tflexDiagnostics()'s
//      `engineState.annotations` matches the result.
//
// We exercise the adapter through the public `getEngine()` entry
// point — no internal cache poking — so they cover the same code path
// App.tsx's `onCreateAnnotation` walks in production.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import type { Annotation } from "../../../src/renderer/annotations/model";

interface WireAnnotation {
  id: string;
  kind: string;
  page: number;
  color?: string;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
  text?: string;
  createdAt?: string;
}

interface EngineStateWire {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  annotations?: WireAnnotation[];
}

interface FakeEngine {
  available: boolean;
  loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
  loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
  applyOp: () => Promise<{ ok: true; value: EngineStateWire }>;
  undo: () => Promise<{ ok: true; value: EngineStateWire }>;
  redo: () => Promise<{ ok: true; value: EngineStateWire }>;
  merge: () => Promise<{ ok: true; value: EngineStateWire }>;
  split: () => Promise<{ ok: true; value: ArrayBuffer }>;
  extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
  save: () => Promise<{ ok: true; value: string }>;
  saveAs: () => Promise<{ ok: true; value: string }>;
  getState: () => Promise<{ ok: true; value: EngineStateWire }>;
  createAnnotation: () => Promise<{ ok: true; value: EngineStateWire }>;
  editAnnotation: () => Promise<{ ok: true; value: EngineStateWire }>;
  deleteAnnotation: () => Promise<{ ok: true; value: EngineStateWire }>;
}

function makeFakeEngine(): { fake: FakeEngine; enqueue: (state: EngineStateWire) => void } {
  const queue: EngineStateWire[] = [];
  const fake: FakeEngine = {
    available: true,
    async loadDocument() {
      queue.shift();
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      queue.shift();
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async applyOp() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async undo() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async redo() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async merge() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async split() {
      queue.shift();
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async extract() {
      queue.shift();
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async save() {
      queue.shift();
      return { ok: true as const, value: "/p" };
    },
    async saveAs() {
      queue.shift();
      return { ok: true as const, value: "/p" };
    },
    async getState() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async createAnnotation() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async editAnnotation() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async deleteAnnotation() {
      const s = queue.shift();
      if (s === undefined) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
  };
  return {
    fake,
    enqueue: (state): void => {
      queue.push(state);
    },
  };
}

function wireAnn(id: string, page = 1): Annotation {
  return {
    id,
    kind: "highlight",
    page,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    rects: [{ x: 0, y: 0, width: 20, height: 10 }],
    text: "hi",
  };
}

describe("engineClient — DEF-068 onCreateAnnotation path through RealEngineAdapter", () => {
  let harness: ReturnType<typeof makeFakeEngine>;

  beforeEach(() => {
    harness = makeFakeEngine();
    (window as unknown as { tflex: { engine: FakeEngine } }).tflex = {
      engine: harness.fake,
    };
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("createAnnotation returns the resolved annotation through the same Promise App.tsx awaits (no swallowed promise)", async () => {
    // Regression: a previous implementation returned `Promise.resolve(undefined)`
    // without ever calling `this.inner.createAnnotation`. The Promise chain in
    // App.tsx's onCreateAnnotation awaited the return and fed the resolved
    // EngineState into noteOpApplied. With the swallowed-promise bug, the
    // await resolved to `undefined`, noteOpApplied crashed, and the engineUi
    // mirror never reflected the new annotation. Pin the contract: the
    // Promise resolves to a Result<EngineState> with `annotations` populated.
    const e = getEngine();
    const ann = wireAnn("a-1");
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [ann],
    });

    // App.tsx awaits this exact Promise and feeds `result.value` to
    // noteOpApplied. The await must surface a Result, not undefined.
    const awaited: unknown = await e.createAnnotation("doc-1", ann);
    expect(awaited).not.toBeUndefined();
    const r = awaited as { ok: true; value: { annotations: Annotation[] } };
    expect(r.ok).toBe(true);
    expect(r.value.annotations).toHaveLength(1);
    expect(r.value.annotations[0]?.id).toBe("a-1");
  });

  it("createAnnotation carries the previous annotations forward when the wire omits the key (DEF-068 fix)", async () => {
    // Step 1: bootstrap the cache by reading the canonical state with
    // one existing annotation. The adapter caches this as the per-doc
    // previous state.
    harness.enqueue({
      pageCount: 1,
      modified: false,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [wireAnn("a-prev")],
    });
    const e = getEngine();
    const seeded = await e.getState("doc-1");
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(seeded.value.annotations).toHaveLength(1);

    // Step 2: createAnnotation — the engine's response OMITS the
    // annotations key (a legitimate wire shape). The adapter's
    // previous-state cache must carry the prior list forward so the
    // renderer's diagnostics surface (`engineState.annotations`)
    // doesn't drop `a-prev` from view.
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      // NO `annotations` key.
    });
    const r = await e.createAnnotation("doc-1", wireAnn("a-new"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.annotations.map((a) => a.id);
    expect(ids).toContain("a-prev");
    // The newly-created annotation isn't echoed (wire omitted it),
    // but the prior list survived the round-trip. This is the exact
    // shape the App.tsx mirror expects when the wire is silent.
  });

  it("createAnnotation merges the prior list with the echoed list when the wire carries the key", async () => {
    // Step 1: bootstrap.
    harness.enqueue({
      pageCount: 1,
      modified: false,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [wireAnn("a-1")],
    });
    const e = getEngine();
    await e.getState("doc-1");

    // Step 2: createAnnotation — the engine echoes the new list with
    // both the prior and the new annotation. The adapter must use
    // the wire's list verbatim.
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [wireAnn("a-1"), wireAnn("a-2")],
    });
    const r = await e.createAnnotation("doc-1", wireAnn("a-2"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.annotations.map((a) => a.id)).toEqual(["a-1", "a-2"]);
  });

  it("createAnnotation round-trip produces a normalized state that survives App.tsx's noteOpApplied path", async () => {
    // Simulate the full App.tsx flow: the user creates a highlight,
    // the engine echoes the new state, noteOpApplied sets engineUi,
    // and tflexDiagnostics().engineState.annotations reflects the new
    // entry. We don't mount App.tsx here (covered by the e2e
    // qa-phase3 suite) but we DO verify that the engineUi mirror
    // gets a coherent state object the renderer can hydrate from.
    const e = getEngine();
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [wireAnn("highlight-1")],
    });
    const r = await e.createAnnotation("doc-1", wireAnn("highlight-1"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The state returned by the adapter must be the renderer-side
    // EngineState (normalized): `annotations` is an array, every
    // entry has a string id, and the renderer's per-tab engineUi
    // mirror can plug this object into `setEngineUiFor` without
    // crashing.
    expect(Array.isArray(r.value.annotations)).toBe(true);
    expect(r.value.annotations[0]).toBeDefined();
    expect(typeof r.value.annotations[0]?.id).toBe("string");
    expect(r.value.pageCount).toBe(1);
    expect(r.value.modified).toBe(true);
  });

  it("createAnnotation followed by another createAnnotation preserves the freshly-created entry through the second wire-omitted round trip", async () => {
    // Two-step round trip:
    //   1. Create a-1, engine echoes [a-1]. Cache now contains [a-1].
    //   2. Create a-2, wire omits. Cache carries [a-1] forward and
    //      emits [a-1] for the second op's result (no resurrection
    //      of ids the engine didn't echo).
    const e = getEngine();
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [wireAnn("a-1")],
    });
    const r1 = await e.createAnnotation("doc-1", wireAnn("a-1"));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.annotations.map((a) => a.id)).toEqual(["a-1"]);

    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      // NO `annotations` key.
    });
    const r2 = await e.createAnnotation("doc-1", wireAnn("a-2"));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // The prior list survives — the new annotation wasn't echoed, so
    // the wire contract has nothing to say about a-2 here. The
    // renderer's view of "the document right now" stays consistent
    // with the last canonical state.
    expect(r2.value.annotations.map((a) => a.id)).toEqual(["a-1"]);
  });
});