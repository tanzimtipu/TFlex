// @vitest-environment jsdom
// Phase 13 — tflexDiagnostics() engine-cache write-through.
//
// The renderer's `tflexDiagnostics()` hook (App.tsx) reads the active
// tab's `engineState` and `modified` flag from `engine.peekLastState()`
// first, with the React `engineUi` mirror as the fallback. The
// `RealEngineAdapter` maintains a per-doc `previousStates` cache that
// `getEngine()` now re-publishes onto `window.tflex.engine` — every
// state-returning op (`applyOp` / `undo` / `redo` / `getState` /
// annotation ops / signature ops / etc.) flows through the adapter
// and updates the cache synchronously, regardless of whether the
// caller reached the adapter via `engineRef.current.*` (the
// renderer's UI handlers) or via `window.tflex.engine.*` (the
// preload passthrough that the e2e harnesses drive).
//
// These tests pin that contract at three levels:
//
//   1. `RealEngineAdapter.peekLastState` exposes the per-doc cache.
//   2. `getEngine()` re-publishes the wrapped adapter as
//      `window.tflex.engine` so direct e2e calls update the cache.
//   3. A direct `window.tflex.engine.applyOp(...)` call lands in the
//      cache synchronously, so the next `peekLastState(docId)` reads
//      the post-op state (this is the "writes through" path the QA
//      retest relies on).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";

interface FakeEngineState {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  annotations?: unknown[];
  formFields?: unknown[];
  signatures?: unknown[];
}

function makeState(overrides: Partial<FakeEngineState> = {}): FakeEngineState {
  return {
    pageCount: 3,
    modified: false,
    pageOrder: [0, 1, 2],
    rotations: [0, 0, 0],
    deleted: [false, false, false],
    annotations: [],
    ...overrides,
  };
}

function makeFakeRealEngine(): {
  available: boolean;
  loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
  loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
  applyOp: (
    _docId: string,
    _op: unknown,
  ) => Promise<{ ok: true; value: FakeEngineState }>;
  undo: (_docId: string) => Promise<{ ok: true; value: FakeEngineState }>;
  redo: (_docId: string) => Promise<{ ok: true; value: FakeEngineState }>;
  merge: (_docId: string) => Promise<{ ok: true; value: FakeEngineState }>;
  split: () => Promise<{ ok: true; value: ArrayBuffer }>;
  extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
  save: () => Promise<{ ok: true; value: string }>;
  saveAs: () => Promise<{ ok: true; value: string }>;
  getState: (_docId: string) => Promise<{ ok: true; value: FakeEngineState }>;
  getFormFields: () => Promise<{ ok: true; value: unknown[] }>;
  fillFormField: () => Promise<{ ok: true; value: unknown[] }>;
  flattenForms: (_docId: string) => Promise<{ ok: true; value: FakeEngineState }>;
  placeSignature: (
    _docId: string,
  ) => Promise<{ ok: true; value: FakeEngineState }>;
  moveSignature: (
    _docId: string,
  ) => Promise<{ ok: true; value: FakeEngineState }>;
  deleteSignature: (
    _docId: string,
  ) => Promise<{ ok: true; value: FakeEngineState }>;
} {
  // Closure-mutable store so successive calls can observe prior
  // mutations — mirrors the real engine's per-doc state.
  const store: Record<string, FakeEngineState> = {};
  const echoFor = (docId: string): FakeEngineState =>
    store[docId] ?? makeState();

  return {
    available: true,
    async loadDocument() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async applyOp(_docId, op) {
      // Simulate "rotate page 1 cw" setting rotations[0]=1 and
      // modified=true; other ops just flip modified=true. The wire
      // shape uses `rotate-cw` / `rotate-ccw` kinds (the
      // RealEngineAdapter's toOpEntry translates the renderer's
      // `rotate` into one of those), and 0-based page indexes.
      const next = { ...echoFor(_docId), modified: true };
      if (
        op !== null &&
        typeof op === "object" &&
        (op as { kind?: string }).kind === "rotate-cw"
      ) {
        const rotateOp = op as { kind: "rotate-cw"; page: number };
        const rotations = next.rotations.slice();
        rotations[rotateOp.page] =
          ((rotations[rotateOp.page] ?? 0) + 1) % 4;
        next.rotations = rotations;
      }
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async undo(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async redo(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async merge(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
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
    async getState(_docId) {
      return { ok: true as const, value: echoFor(_docId) };
    },
    async getFormFields() {
      return { ok: true as const, value: [] };
    },
    async fillFormField() {
      return { ok: true as const, value: [] };
    },
    async flattenForms(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async placeSignature(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async moveSignature(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
    async deleteSignature(_docId) {
      const next = { ...echoFor(_docId), modified: true };
      store[_docId] = next;
      return { ok: true as const, value: next };
    },
  };
}

describe("engineClient — peekLastState (Phase 13 diagnostics cache)", () => {
  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("peekLastState returns undefined before any op populates the cache", () => {
    const realEngine = makeFakeRealEngine();
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    expect(e.peekLastState).toBeDefined();
    expect(e.peekLastState!("doc-1")).toBeUndefined();
  });

  it("peekLastState returns the post-op state synchronously after a state-returning call", async () => {
    const realEngine = makeFakeRealEngine();
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    const cached = e.peekLastState!("doc-1");
    expect(cached).toBeDefined();
    expect(cached?.modified).toBe(true);
    expect(cached?.rotations[0]).toBe(1);
  });

  it("getEngine() rewrites window.tflex.engine so direct calls flow through the adapter (writes-through)", async () => {
    // Set up the preload passthrough BEFORE getEngine().
    const realEngine = makeFakeRealEngine();
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
    // First getEngine() call wraps + re-publishes.
    const e = getEngine();
    expect(e.available).toBe(true);
    // After getEngine(), window.tflex.engine is the wrapped adapter —
    // NOT the original preload passthrough.
    const w = window as unknown as { tflex: { engine: unknown } };
    expect(w.tflex.engine).toBe(e);
    // A direct call through window.tflex.engine therefore updates the
    // adapter's previousStates cache.
    await (
      w.tflex.engine as {
        applyOp: (
          docId: string,
          op: unknown,
        ) => Promise<{ ok: true; value: FakeEngineState }>;
      }
    ).applyOp("doc-direct", { kind: "rotate", page: 2, dir: "cw" });
    const cached = e.peekLastState!("doc-direct");
    expect(cached).toBeDefined();
    expect(cached?.rotations[1]).toBe(1);
    expect(cached?.modified).toBe(true);
  });

  it("does not rewrite window.tflex.engine when no real engine is exposed (stub path)", () => {
    // No window.tflex.engine — getEngine() returns the stub.
    const e = getEngine();
    expect(e.available).toBe(false);
    // The stub path must not crash trying to write to a missing window.tflex.
    // Confirm the stub itself implements peekLastState for parity with the
    // real adapter (the App.tsx diagnostics code calls it unconditionally).
    expect(typeof e.peekLastState).toBe("function");
  });
});

describe("engineClient — getState echoes back into peekLastState (the getState-poll path)", () => {
  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("a direct getState call populates the cache for subsequent peekLastState reads", async () => {
    const realEngine = makeFakeRealEngine();
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    // Initial: undefined.
    expect(e.peekLastState!("doc-1")).toBeUndefined();
    // Direct getState via window.tflex.engine.
    await (
      window as unknown as {
        tflex: {
          engine: {
            getState: (
              docId: string,
            ) => Promise<{ ok: true; value: FakeEngineState }>;
          };
        };
      }
    ).tflex.engine.getState("doc-1");
    // Now cached.
    const cached = e.peekLastState!("doc-1");
    expect(cached).toBeDefined();
    expect(cached?.pageCount).toBe(3);
  });
});