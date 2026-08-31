// @vitest-environment jsdom
// DEF-078 — `getEngine()` re-publish resilience.
//
// The renderer's `useRef<EngineApi>(getEngine())` call (App.tsx) runs
// during the very first render of the App tree. Phase 13 wired
// `getEngine()` to also do `window.tflex.engine = <adapter>` so direct
// callers (e2e harnesses doing `window.tflex.engine.applyOp(...)`)
// flow through the adapter and update the per-doc `previousStates`
// cache. With Electron's contextBridge isolation enabled
// (`contextIsolation: true` — see main/electron-config.ts), the
// exposed `window.tflex` is a Proxy that throws TypeError on any
// property assignment in strict mode (ES modules). The throw
// propagated up through `useRef(getEngine())` on the very first
// render, which React's concurrent renderer caught, retried, and
// eventually surfaced as React error #520 (max-update-depth
// exceeded). The e2e surface (`def_077_ota_ux.spec.cjs`,
// `full_sweep_retest.spec.cjs`) saw the error on every boot.
//
// The fix: `getEngine()` wraps the re-publish assignment in a
// try/catch so a frozen contextBridge degrades to the preload
// passthrough. The adapter is still cached in the module-scope
// `cached` variable so React handlers (`engineRef.current.*`) keep
// using the wrapped adapter and keep updating the previousStates
// cache. Direct e2e calls via `window.tflex.engine.*` continue to
// hit the preload passthrough; their results are returned via the
// IPC promise and `tflexDiagnostics()` reflects them through the
// next React re-render (or via a follow-up `getState()` call the
// test awaits). The renderer no longer crashes on boot.
//
// These tests pin the new contract at three layers:
//
//   1. Frozen `window.tflex.engine` — the assignment throws
//      `TypeError`. `getEngine()` must NOT propagate the throw, must
//      return a usable `EngineApi`, and must NOT mutate the frozen
//      property (so the original preload passthrough survives for
//      direct callers).
//   2. `useRef<EngineApi>(getEngine())` — the canonical boot site in
//      App.tsx — must not throw when the contextBridge is frozen.
//      This is the React #520 trigger.
//   3. After a failed re-publish, the adapter's `previousStates`
//      cache is still usable for callers that reach the adapter via
//      `engineRef.current` (the React handler path). The Phase 13
//      diagnostic peekLastState contract survives for the renderer-
//      side path; only the e2e-harness direct-call path is degraded,
//      and that path is documented in the fix comment.

import { afterEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";

interface FrozenWindow {
  tflex: Record<string | symbol, unknown>;
}

/** Create a `window.tflex` whose property writes throw TypeError —
 *  the exact behaviour contextBridge.exposeInMainWorld produces under
 *  contextIsolation: true + ES-module strict mode. The symbol-keyed
 *  `__throwOnSet` lets a test bypass the throw to verify the
 *  passthrough-survives invariant. */
function makeFrozenTflex(preloadEngine: unknown): FrozenWindow {
  const target: Record<string | symbol, unknown> = { engine: preloadEngine };
  const proxy = new Proxy(target, {
    set(_t, prop, value) {
      if (prop === "engine") {
        throw new TypeError(
          "Cannot assign to read only property 'engine' of object '#<Object>'",
        );
      }
      target[prop] = value;
      return true;
    },
    get(t, prop) {
      return t[prop];
    },
  });
  return proxy as unknown as FrozenWindow;
}

function makeFakeEngine(): {
  available: boolean;
  applyOp: (docId: string) => Promise<{ ok: true; value: unknown }>;
  getState: (docId: string) => Promise<{ ok: true; value: unknown }>;
  undo: (docId: string) => Promise<{ ok: true; value: unknown }>;
  loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
  loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
} {
  return {
    available: true,
    async applyOp() {
      return { ok: true as const, value: { modified: true } };
    },
    async getState() {
      return { ok: true as const, value: { modified: false } };
    },
    async undo() {
      return { ok: true as const, value: { modified: false } };
    },
    async loadDocument() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
  };
}

describe("engineClient — DEF-078 frozen contextBridge resilience", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("getEngine() does not throw when window.tflex.engine is a frozen-writable property (Electron contextBridge)", () => {
    // Set up the boot scenario: preload exposes the engine, but
    // contextBridge-frozen `window.tflex` rejects any assignment.
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    // Before the fix: this threw TypeError; useRef(getEngine())
    // propagated it up; React reported #520 on every boot.
    expect(() => getEngine()).not.toThrow();
  });

  it("getEngine() returns the wrapped adapter even when the re-publish fails", () => {
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    const e = getEngine();
    // The returned adapter is the wrapped one (real engine path),
    // not the stub. React handlers reach it via engineRef.current.
    expect(e.available).toBe(true);
    expect(typeof e.applyOp).toBe("function");
    expect(typeof e.peekLastState).toBe("function");
  });

  it("getEngine() leaves the preload passthrough untouched when re-publish is rejected", () => {
    // Critical invariant: when the frozen contextBridge rejects the
    // assignment, the preload's engine object must still be the
    // `window.tflex.engine` value. Direct e2e callers
    // (`window.tflex.engine.applyOp(...)`) must continue to hit the
    // preload passthrough so the IPC promise resolves; the adapter
    // re-publish is best-effort.
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    getEngine();
    const after = (
      window as unknown as { tflex: { engine: unknown } }
    ).tflex.engine;
    expect(after).toBe(preloadEngine);
  });

  it("getEngine() is idempotent — repeated calls return the same adapter even when re-publish fails", () => {
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    const first = getEngine();
    const second = getEngine();
    const third = getEngine();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("the canonical useRef(getEngine()) boot pattern does not throw on a frozen contextBridge", () => {
    // Mirrors App.tsx line ~395: `const engineRef = useRef<EngineApi>(getEngine());`
    // — runs on the very first render. Must NOT throw (pre-fix it threw
    // TypeError and React's error handler tripped #520 on every boot).
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    let captured: unknown = undefined;
    expect(() => {
      // Simulate useRef's initial-value semantics: the argument is
      // evaluated once on the first render and discarded thereafter.
      // We don't need useRef here — what matters is that the inner
      // expression doesn't throw.
      const initialValue: { applyOp?: unknown } = (() => getEngine())();
      captured = initialValue;
    }).not.toThrow();
    expect(captured).toBeDefined();
    expect(typeof (captured as { applyOp?: unknown }).applyOp).toBe("function");
  });

  it("peekLastState cache stays usable through the adapter even when re-publish failed", async () => {
    // Pre-Phase-13 the renderer's `engineUi` mirror was the only
    // route for `tflexDiagnostics().engineState`. Post-Phase-13 the
    // adapter's `previousStates` cache is also consulted. After the
    // DEF-078 fix the e2e-direct-call route can no longer populate
    // that cache (because the re-publish was rejected), but the
    // renderer's React handlers — which reach the adapter via
    // `engineRef.current` — must still populate it. This test pins
    // the renderer's own path is unaffected by the Electron rejection.
    const preloadEngine = makeFakeEngine();
    (window as unknown as { tflex: FrozenWindow }).tflex = makeFrozenTflex(
      preloadEngine,
    );
    _resetEngineForTests();

    const e = getEngine();
    expect(e.peekLastState!("doc-1")).toBeUndefined();
    // Renderer-side path: through the adapter reference.
    await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    // The peekLastState cache is populated via the adapter, regardless
    // of whether window.tflex.engine was successfully re-published.
    expect(e.peekLastState!("doc-1")).toBeDefined();
  });
});