// @vitest-environment jsdom
// Phase 32 (Multi Mode) — cross-document page move/copy adapter wiring.
//
// The renderer-facing engine API uses 1-BASED page numbers (see
// `extract` / `insertFromPdf`); the IPC payload is 0-based. These tests
// pin the translation, the "append" sentinel (-1 passes through), the
// single-round-trip normalization + caching of BOTH documents' states,
// and the unchanged error pass-through.
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import { stubRendererEngine } from "../../../src/renderer/engine/stubEngine";

interface WireState {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  placedSignatures?: { id: string }[];
}

interface CapturedPayload {
  fromDocId: string;
  pages: number[];
  toDocId: string;
  atIndex: number;
  mode: "move" | "copy";
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

/** Minimal TFlexApiEngine stand-in: only the members the adapter reaches
 *  during these tests are meaningful; the rest are inert. */
function makeFakeRealEngine(opts: {
  captured?: { payload: CapturedPayload | null };
  result?:
    | { ok: true; value: { from: WireState; to: WireState } }
    | { ok: false; error: { code: string; message: string } };
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
      return { ok: true as const, value: empty };
    },
    async redo() {
      return { ok: true as const, value: empty };
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
    async movePagesBetweenDocs(payload: CapturedPayload) {
      if (opts.captured !== undefined) opts.captured.payload = payload;
      return (
        opts.result ?? {
          ok: true as const,
          value: { from: wireState(), to: wireState() },
        }
      );
    },
  };
}

function install(engine: ReturnType<typeof makeFakeRealEngine>): void {
  (window as unknown as { tflex: { engine: typeof engine } }).tflex = {
    engine,
  };
  _resetEngineForTests();
}

describe("engineClient.movePagesBetweenDocs — 1-based -> 0-based translation", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("translates 1-based source pages to 0-based indices", async () => {
    const captured: { payload: CapturedPayload | null } = { payload: null };
    install(makeFakeRealEngine({ captured }));
    await getEngine().movePagesBetweenDocs("from", [1, 3], "to", 2, "move");
    expect(captured.payload?.pages).toEqual([0, 2]);
  });

  it("translates a 1-based insertion index to 0-based", async () => {
    const captured: { payload: CapturedPayload | null } = { payload: null };
    install(makeFakeRealEngine({ captured }));
    await getEngine().movePagesBetweenDocs("from", [1], "to", 4, "copy");
    expect(captured.payload?.atIndex).toBe(3);
  });

  it("passes the -1 append sentinel through unchanged", async () => {
    const captured: { payload: CapturedPayload | null } = { payload: null };
    install(makeFakeRealEngine({ captured }));
    await getEngine().movePagesBetweenDocs("from", [2], "to", -1, "move");
    expect(captured.payload?.atIndex).toBe(-1);
  });

  it("forwards doc ids and mode verbatim", async () => {
    const captured: { payload: CapturedPayload | null } = { payload: null };
    install(makeFakeRealEngine({ captured }));
    await getEngine().movePagesBetweenDocs("doc-a", [1], "doc-b", 1, "copy");
    expect(captured.payload?.fromDocId).toBe("doc-a");
    expect(captured.payload?.toDocId).toBe("doc-b");
    expect(captured.payload?.mode).toBe("copy");
  });
});

describe("engineClient.movePagesBetweenDocs � normalize + cache both states", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("normalizes and caches BOTH documents from one round-trip", async () => {
    install(
      makeFakeRealEngine({
        result: {
          ok: true,
          value: {
            // `from` carries a wire `placedSignatures` (normalized to
            // `signatures`) and omits `annotations` (normalized to []).
            from: wireState({ placedSignatures: [{ id: "s1" }] }),
            to: wireState({ pageCount: 5 }),
          },
        },
      }),
    );
    const e = getEngine();
    const r = await e.movePagesBetweenDocs("from", [1], "to", 1, "move");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Normalization applied to both states.
    expect(r.value.from.annotations).toEqual([]);
    expect(r.value.from.signatures).toEqual([{ id: "s1" }]);
    expect(
      (r.value.from as unknown as { placedSignatures?: unknown }).placedSignatures,
    ).toBeUndefined();
    expect(r.value.to.pageCount).toBe(5);
    // Both caches updated; the cached object is the returned one.
    expect(e.peekLastState?.("from")).toBe(r.value.from);
    expect(e.peekLastState?.("to")).toBe(r.value.to);
  });

  it("does not populate either cache when the op fails", async () => {
    install(
      makeFakeRealEngine({
        result: { ok: false, error: { code: "same-document", message: "same" } },
      }),
    );
    const e = getEngine();
    const r = await e.movePagesBetweenDocs("from", [1], "from", 1, "move");
    expect(r.ok).toBe(false);
    expect(e.peekLastState?.("from")).toBeUndefined();
    expect(e.peekLastState?.("to")).toBeUndefined();
  });
});

describe("engineClient.movePagesBetweenDocs � error pass-through", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("passes the engine error through unchanged", async () => {
    const failure = {
      ok: false as const,
      error: { code: "same-document", message: "source and target match" },
    };
    install(makeFakeRealEngine({ result: failure }));
    const r = await getEngine().movePagesBetweenDocs("x", [1], "x", 1, "copy");
    expect(r).toEqual(failure);
  });
});

describe("stubEngine.movePagesBetweenDocs", () => {
  it("degrades with a typed engine-error", async () => {
    const r = await stubRendererEngine.movePagesBetweenDocs(
      "a",
      [1],
      "b",
      1,
      "move",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
    expect(r.error.message).toContain("backend engine update");
  });
});
