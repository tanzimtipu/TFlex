// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import { stubRendererEngine } from "../../../src/renderer/engine/stubEngine";

describe("engineClient.getEngine", () => {
  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("returns the stub when no window.tflex.engine is exposed", () => {
    const e = getEngine();
    expect(e.available).toBe(false);
    expect(e).toBe(stubRendererEngine);
  });

  it("caches the resolved engine across calls", () => {
    const e1 = getEngine();
    const e2 = getEngine();
    expect(e1).toBe(e2);
  });

  it("returns the real engine when window.tflex.engine is exposed", () => {
    const realEngine = makeFakeRealEngine();
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    expect(e.available).toBe(true);
  });
});

describe("engineClient — real engine adapter translates indexes", () => {
  let captured: {
    split: [number, number] | null;
    extract: number[] | null;
    apply: unknown[];
  };
  let realEngine: ReturnType<typeof makeFakeRealEngine>;

  beforeEach(() => {
    captured = { split: null, extract: null, apply: [] };
    realEngine = makeFakeRealEngine(captured);
    (window as unknown as { tflex: { engine: typeof realEngine } }).tflex = {
      engine: realEngine,
    };
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("translates split range from 1-based (renderer) to 0-based (engine)", async () => {
    const e = getEngine();
    expect(e.available).toBe(true);
    await e.split("doc-1", [10, 20] as [number, number]);
    expect(captured.split).toEqual([9, 19]);
  });

  it("translates a 1-page split edge case", async () => {
    const e = getEngine();
    await e.split("doc-1", [5, 5] as [number, number]);
    expect(captured.split).toEqual([4, 4]);
  });

  it("translates extract pages from 1-based (renderer) to 0-based (engine)", async () => {
    const e = getEngine();
    await e.extract("doc-1", [1, 3]);
    expect(captured.extract).toEqual([0, 2]);
  });

  it("extract('1') of a document yields the FIRST page (engine index 0)", async () => {
    // DEF-167 — extract("1") of a 3-page doc used to land on page 2
    // (the 1-based dialog number was passed untranslated to the
    // 0-based engine). Pin that the first dialog page maps to index 0.
    const e = getEngine();
    await e.extract("doc-1", [1]);
    expect(captured.extract).toEqual([0]);
  });

  it("extract's final page does NOT exceed the 0-based bound", async () => {
    // DEF-167 — "3" of a 3-page doc used to error out of bounds
    // because 3 equaled the 0-based upper bound. "3" must map to 2.
    const e = getEngine();
    await e.extract("doc-1", [3]);
    expect(captured.extract).toEqual([2]);
  });

  it("translates reorder fromIndex / toIndex from 1-based to 0-based", async () => {
    const e = getEngine();
    await e.applyOp("doc-1", { kind: "reorder", fromIndex: 1, toIndex: 5 });
    expect(captured.apply[captured.apply.length - 1]).toEqual({
      kind: "reorder",
      page: 0,
      param: 4,
    });
  });

  it("translates rotate page from 1-based to 0-based", async () => {
    const e = getEngine();
    await e.applyOp("doc-1", { kind: "rotate", page: 3, dir: "cw" });
    expect(captured.apply[captured.apply.length - 1]).toEqual({
      kind: "rotate-cw",
      page: 2,
    });
  });

  it("translates delete page from 1-based to 0-based", async () => {
    const e = getEngine();
    await e.applyOp("doc-1", { kind: "delete", pages: [7] });
    expect(captured.apply[captured.apply.length - 1]).toEqual({
      kind: "delete",
      page: 6,
    });
  });
});

function makeFakeRealEngine(captured?: {
  split: [number, number] | null;
  extract: number[] | null;
  apply: unknown[];
}): {
  available: boolean;
  loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
  loadDocumentBytes: (
    _docId: string,
    bytes: ArrayBuffer | Uint8Array,
  ) => Promise<{ ok: true; value: ArrayBuffer }>;
  applyOp: (docId: string, op: unknown) => Promise<{
    ok: true;
    value: {
      pageCount: number;
      modified: boolean;
      pageOrder: number[];
      rotations: number[];
      deleted: boolean[];
    };
  }>;
  undo: () => Promise<{
    ok: true;
    value: {
      pageCount: number;
      modified: boolean;
      pageOrder: number[];
      rotations: number[];
      deleted: boolean[];
    };
  }>;
  redo: () => Promise<{
    ok: true;
    value: {
      pageCount: number;
      modified: boolean;
      pageOrder: number[];
      rotations: number[];
      deleted: boolean[];
    };
  }>;
  merge: () => Promise<{
    ok: true;
    value: {
      pageCount: number;
      modified: boolean;
      pageOrder: number[];
      rotations: number[];
      deleted: boolean[];
    };
  }>;
  split: (
    docId: string,
    range: [number, number],
  ) => Promise<{ ok: true; value: ArrayBuffer }>;
  extract: (
    docId: string,
    pages: number[],
  ) => Promise<{ ok: true; value: ArrayBuffer }>;
  save: () => Promise<{ ok: true; value: string }>;
  saveAs: () => Promise<{ ok: true; value: string }>;
  getState: () => Promise<{
    ok: true;
    value: {
      pageCount: number;
      modified: boolean;
      pageOrder: number[];
      rotations: number[];
      deleted: boolean[];
    };
  }>;
} {
  const empty = {
    pageCount: 0,
    modified: false,
    pageOrder: [],
    rotations: [],
    deleted: [],
  };
  return {
    available: true,
    async loadDocument() {
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes(_docId, bytes) {
      // Echo the bytes back (cloned) — confirms we routed through
      // loadDocumentBytes and not loadDocument.
      const src =
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const out = new Uint8Array(src.byteLength);
      out.set(src);
      return { ok: true, value: out.buffer };
    },
    async applyOp(_docId, op) {
      captured?.apply.push(op);
      return { ok: true, value: empty };
    },
    async undo() {
      return { ok: true, value: empty };
    },
    async redo() {
      return { ok: true, value: empty };
    },
    async merge() {
      return { ok: true, value: empty };
    },
    async split(_docId, range) {
      if (captured !== undefined) captured.split = range;
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async extract(_docId, pages) {
      if (captured !== undefined) captured.extract = pages;
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async save() {
      return { ok: true, value: "/path" };
    },
    async saveAs() {
      return { ok: true, value: "/path" };
    },
    async getState() {
      return { ok: true, value: empty };
    },
  };
}

// ---------------------------------------------------------------------------
// Wire-shape translation tests (DEF-017)
//
// The renderer-side Annotation model carries per-kind geometry under the
// renderer's own field names (`from`/`to` for arrows, `rect` for shapes,
// `at` for notes). The engine normalizes every annotation into the AnnModel
// canonical shape (`rects[]` and `points[]`). When the engine returns the
// updated state to the renderer, every annotation must be translated back to
// the renderer's shape — otherwise the renderer's render code reads
// `undefined.x` and the entire React tree dies (the original DEF-017 root
// cause). These tests pin the translation: an arrow returned from the
// engine without `from`/`to` MUST surface `from`/`to` populated from
// `points[0]`/`points[1]`; same for shapes (`rect` <- `rects[0]`) and notes
// (`at` <- `rects[0]`).
describe("engineClient — annotation wire-shape translation (DEF-017)", () => {
  const wireStateWith = (
    annotations: Record<string, unknown>[],
  ): {
    pageCount: number;
    modified: boolean;
    pageOrder: number[];
    rotations: number[];
    deleted: boolean[];
    annotations: Record<string, unknown>[];
  } => ({
    pageCount: 1,
    modified: true,
    pageOrder: [0],
    rotations: [0],
    deleted: [false],
    annotations,
  });

  function makeRealEngine(state: ReturnType<typeof wireStateWith>): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    undo: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    redo: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    merge: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    createAnnotation: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    editAnnotation: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
    deleteAnnotation: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWith> }>;
  } {
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: state };
      },
      async undo() {
        return { ok: true as const, value: state };
      },
      async redo() {
        return { ok: true as const, value: state };
      },
      async merge() {
        return { ok: true as const, value: state };
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
        return { ok: true as const, value: state };
      },
      async createAnnotation() {
        return { ok: true as const, value: state };
      },
      async editAnnotation() {
        return { ok: true as const, value: state };
      },
      async deleteAnnotation() {
        return { ok: true as const, value: state };
      },
    };
  }

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("backfills arrow from/to from points[0]/points[1]", async () => {
    const wire = wireStateWith([
      {
        id: "a1",
        kind: "arrow",
        page: 1,
        color: "red",
        // Wire shape: arrow has no from/to, only points.
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        rects: [{ x: 10, y: 20, width: 20, height: 20 }],
      },
    ]);
    (window as unknown as { tflex: { engine: ReturnType<typeof makeRealEngine> } }).tflex = {
      engine: makeRealEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", {
      id: "a1",
      kind: "arrow",
      page: 1,
      color: "red",
      createdAt: "2026-01-01T00:00:00.000Z",
      from: { x: 10, y: 20 },
      to: { x: 30, y: 40 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ann = r.value.annotations[0] as { from?: { x: number; y: number }; to?: { x: number; y: number } };
    expect(ann.from).toEqual({ x: 10, y: 20 });
    expect(ann.to).toEqual({ x: 30, y: 40 });
  });

  it("backfills rect/ellipse rect from rects[0]", async () => {
    const wire = wireStateWith([
      {
        id: "s1",
        kind: "rect",
        page: 1,
        color: "blue",
        rects: [{ x: 0, y: 0, width: 50, height: 60 }],
      },
      {
        id: "s2",
        kind: "ellipse",
        page: 1,
        color: "green",
        rects: [{ x: 5, y: 5, width: 20, height: 20 }],
      },
    ]);
    (window as unknown as { tflex: { engine: ReturnType<typeof makeRealEngine> } }).tflex = {
      engine: makeRealEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", {
      id: "s1",
      kind: "rect",
      page: 1,
      color: "blue",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: { x: 0, y: 0, width: 50, height: 60 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const anns = r.value.annotations as Array<{ rect?: { x: number; y: number; width: number; height: number } }>;
    expect(anns[0]?.rect).toEqual({ x: 0, y: 0, width: 50, height: 60 });
    expect(anns[1]?.rect).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it("backfills textbox rect from rects[0]", async () => {
    const wire = wireStateWith([
      {
        id: "tb1",
        kind: "text-box",
        page: 1,
        color: "yellow",
        text: "hello",
        rects: [{ x: 10, y: 20, width: 100, height: 30 }],
      },
    ]);
    (window as unknown as { tflex: { engine: ReturnType<typeof makeRealEngine> } }).tflex = {
      engine: makeRealEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", {
      id: "tb1",
      // The renderer sends `textbox`; the adapter translates to `text-box`
      // on the wire, the engine echoes `text-box`, and annotationFromWire
      // translates it back to `textbox`. We send `text-box` here because
      // the fake engine's createAnnotation type signature is the wire
      // shape (CreateAnnotationPayload) — the renderer's translation is
      // exactly what we are testing here.
      kind: "text-box",
      page: 1,
      color: "yellow",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: { x: 10, y: 20, width: 100, height: 30 },
      text: "hello",
    } as unknown as Parameters<typeof e.createAnnotation>[1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ann = r.value.annotations[0] as { rect?: { x: number; y: number; width: number; height: number }; kind: string };
    expect(ann.kind).toBe("textbox");
    expect(ann.rect).toEqual({ x: 10, y: 20, width: 100, height: 30 });
  });

  it("backfills note at from rects[0]", async () => {
    const wire = wireStateWith([
      {
        id: "n1",
        kind: "note",
        page: 1,
        color: "yellow",
        text: "memo",
        rects: [{ x: 7, y: 11, width: 24, height: 24 }],
      },
    ]);
    (window as unknown as { tflex: { engine: ReturnType<typeof makeRealEngine> } }).tflex = {
      engine: makeRealEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", {
      id: "n1",
      kind: "note",
      page: 1,
      color: "yellow",
      createdAt: "2026-01-01T00:00:00.000Z",
      at: { x: 7, y: 11 },
      text: "memo",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ann = r.value.annotations[0] as { at?: { x: number; y: number } };
    expect(ann.at).toEqual({ x: 7, y: 11 });
  });

  it("does not throw when an arrow annotation has neither from/to nor points", async () => {
    // A truly broken annotation (no geometry at all). The adapter should
    // not crash; it should return the annotation unchanged so the renderer's
    // existing fallback to `null` (via the per-annotation error boundary)
    // can handle the visual case.
    const wire = wireStateWith([
      {
        id: "broken",
        kind: "arrow",
        page: 1,
        color: "red",
      },
    ]);
    (window as unknown as { tflex: { engine: ReturnType<typeof makeRealEngine> } }).tflex = {
      engine: makeRealEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", {
      id: "broken",
      kind: "arrow",
      page: 1,
      color: "red",
      createdAt: "2026-01-01T00:00:00.000Z",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.annotations.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Wire-shape field-name translation: signature placements (DEF-022)
//
// The engine's `buildState` writes signature placements under the field name
// `placedSignatures`. The renderer's mirror (App.tsx's openTabs-sync effect,
// DocumentView's signatures prop, the stub engine) reads `signatures`. If
// normalizeState does not bridge the names, every placement IPC round-trip
// appears as `signatures === undefined` to the renderer, the fallback
// (`result.value.signatures ?? existing.placements`) never kicks in (because
// the value is `undefined` only when the engine returned the field under a
// different name, NOT when it was missing — the spread `...maybe` carries
// `placedSignatures` through), and the engine-echoed mirror clobbers the
// local placement list to `[]`. This is the same shape of regression that
// dropped annotations under DEF-017. These tests pin the rename.
describe("engineClient — signature placement wire-shape (DEF-022)", () => {
  const wireStateWithPlaced = (
    placed: Array<Record<string, unknown>>,
  ): {
    pageCount: number;
    modified: boolean;
    pageOrder: number[];
    rotations: number[];
    deleted: boolean[];
    placedSignatures: Array<Record<string, unknown>>;
  } => ({
    pageCount: 1,
    modified: true,
    pageOrder: [0],
    rotations: [0],
    deleted: [false],
    placedSignatures: placed,
  });

  function makeRealEngineWithPlaced(state: ReturnType<typeof wireStateWithPlaced>): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    undo: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    redo: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    merge: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    placeSignature: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    moveSignature: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
    deleteSignature: () => Promise<{ ok: true; value: ReturnType<typeof wireStateWithPlaced> }>;
  } {
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: state };
      },
      async undo() {
        return { ok: true as const, value: state };
      },
      async redo() {
        return { ok: true as const, value: state };
      },
      async merge() {
        return { ok: true as const, value: state };
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
        return { ok: true as const, value: state };
      },
      async placeSignature() {
        return { ok: true as const, value: state };
      },
      async moveSignature() {
        return { ok: true as const, value: state };
      },
      async deleteSignature() {
        return { ok: true as const, value: state };
      },
    };
  }

  const samplePlacement = {
    id: "sig-1",
    signatureId: "saved-1",
    page: 1,
    rect: { x: 100, y: 200, width: 150, height: 50 },
  };

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("renames placedSignatures -> signatures on placeSignature round-trip", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.placeSignature!("doc-1", samplePlacement as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The renderer's mirror reads `signatures`. If normalizeState did not
    // bridge the wire field name, this would be `undefined`.
    expect(r.value.signatures).toEqual([samplePlacement]);
  });

  it("renames placedSignatures -> signatures on moveSignature round-trip", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    // DEF-059 — the IPC contract is `moveSignature(docId, payload)`. The
    // adapter accepts a `MoveSignaturePayload` (id, page, rect) and
    // forwards it to the inner engine as a single arg, NOT three
    // positional args. The pre-fix adapter spread them, which the real
    // engine rejected.
    const r = await e.moveSignature!(
      "doc-1",
      {
        id: "sig-1",
        page: 1,
        rect: { x: 110, y: 210, width: 160, height: 55 },
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signatures).toBeDefined();
    expect(r.value.signatures?.length).toBe(1);
  });

  // DEF-059 — pin the adapter's contract: it must call the inner
  // engine's moveSignature with a SINGLE MoveSignaturePayload arg, not
  // three positional args (docId, placementId, rect). The pre-fix
  // adapter spread the args, which the real engine rejected because
  // the IPC contract is `moveSignature(docId, payload)`.
  it("forwards moveSignature as a single payload arg (DEF-059)", async () => {
    interface Call {
      docId: string;
      payload: { id: string; page: number; rect: { x: number; y: number; width: number; height: number } };
    }
    const captured: { calls: Call[] } = { calls: [] };
    const fakeEngine = {
      available: true,
      async loadDocument(): Promise<{ ok: true; value: ArrayBuffer }> {
        return { ok: true, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes(): Promise<{ ok: true; value: ArrayBuffer }> {
        return { ok: true, value: new ArrayBuffer(0) };
      },
      async moveSignature(
        docId: string,
        payload: { id: string; page: number; rect: { x: number; y: number; width: number; height: number } },
      ): Promise<{
        ok: true;
        value: {
          pageCount: number;
          modified: boolean;
          pageOrder: number[];
          rotations: number[];
          deleted: boolean[];
          signatures: Array<{ id: string; signatureId: string; page: number; rect: { x: number; y: number; width: number; height: number } }>;
        };
      }> {
        captured.calls.push({ docId, payload });
        return {
          ok: true,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
            signatures: [{ id: payload.id, signatureId: "saved-1", page: payload.page, rect: payload.rect }],
          },
        };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = { engine: fakeEngine };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.moveSignature!(
      "doc-x",
      {
        id: "pl-7",
        page: 3,
        rect: { x: 10, y: 20, width: 30, height: 40 },
      },
    );
    expect(r.ok).toBe(true);
    expect(captured.calls).toEqual([
      {
        docId: "doc-x",
        payload: { id: "pl-7", page: 3, rect: { x: 10, y: 20, width: 30, height: 40 } },
      },
    ]);
    void r;
  });

  it("renames placedSignatures -> signatures on deleteSignature round-trip", async () => {
    const wire = wireStateWithPlaced([]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.deleteSignature!("doc-1", "sig-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Empty placement list after deletion: the renderer must still see the
    // field as a (now empty) array, not undefined.
    expect(r.value.signatures).toEqual([]);
  });

  it("renames placedSignatures -> signatures on getState round-trip", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getState("doc-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signatures).toEqual([samplePlacement]);
  });

  it("places survive the round-trip intact (placement persists post-IPC)", async () => {
    // Pins the regression: pre-fix, the mirror effect in App.tsx would
    // clobber local placements to `[]` after the engine echoed back
    // `{ placedSignatures: [...] }` because `signatures` was `undefined`.
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.placeSignature!("doc-1", samplePlacement as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Every field must survive the round-trip — id, signatureId, page,
    // every rect component.
    const got = r.value.signatures?.[0];
    expect(got).toBeDefined();
    expect(got?.id).toBe("sig-1");
    expect(got?.signatureId).toBe("saved-1");
    expect(got?.page).toBe(1);
    expect(got?.rect).toEqual({ x: 100, y: 200, width: 150, height: 50 });
  });

  it("prefers signatures over placedSignatures when both are present", async () => {
    // Forward-compat: if the backend ever renames the field, the renderer
    // should follow the renderer's own field name first (the stub engine
    // already uses `signatures`). This guards against an inadvertent
    // regression where both fields leak through.
    const dual = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      signatures: [samplePlacement],
      placedSignatures: [
        { ...samplePlacement, id: "stale", signatureId: "stale" },
      ],
    } as unknown as ReturnType<typeof wireStateWithPlaced>;
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(dual) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getState("doc-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signatures?.[0]?.id).toBe("sig-1");
  });

  // DEF-059 residual — the App.tsx engineUi mirror reads
  // `ui?.state.signatures`; normalizeState must therefore guarantee
  // that the wire field name `placedSignatures` is fully consumed
  // (and STRIPPED) so the renderer-facing EngineState carries only
  // the renderer-side `signatures` key. Without the strip the
  // `...maybe` spread leaks `placedSignatures` through to the
  // renderer's state, which (a) is a wire-shape leak into a
  // typed-to-renderer surface and (b) means any future code that
  // reads `state.signatures` correctly works only by coincidence
  // — the App.tsx mirror happens to also set `signatures` from
  // `incomingSigs`. Pin both: the renderer-side `signatures` is
  // populated, and the wire-side `placedSignatures` is absent.
  it("strips wire-shape placedSignatures from the normalized state (DEF-059 residual)", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.placeSignature!("doc-1", samplePlacement as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // (1) The renderer-facing `signatures` field is populated from
    // the wire's `placedSignatures` array.
    expect(r.value.signatures).toEqual([samplePlacement]);
    // (2) The wire-shape `placedSignatures` key is NOT carried
    // through. The engine's wire field name must not appear on the
    // renderer's typed EngineState — its presence would indicate
    // that the `...maybe` spread leaked the field through.
    expect((r.value as unknown as Record<string, unknown>).placedSignatures).toBeUndefined();
    // (3) The App.tsx mirror's lookup expression works without
    // truthy coercion gymnastics. A naive `ui?.state.signatures`
    // after a successful placement must produce a non-empty array,
    // not an `undefined` (which would skip the mirror's update
    // branch and leave the UI showing zero placements).
    const fromEngine: unknown = r.value.signatures;
    expect(Array.isArray(fromEngine)).toBe(true);
    expect((fromEngine as unknown[]).length).toBe(1);
  });

  // DEF-059 residual — same shape as the placement test above, but
  // pinned against the `moveSignature` round-trip that the previous
  // DEF-059 fix targeted. The IPC payload fix alone is not enough;
  // the state echo on the same path must also carry `signatures`
  // (and not `placedSignatures`) so the App.tsx mirror observes the
  // moved placement in the UI.
  it("moveSignature echo carries signatures (no placedSignatures leak)", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.moveSignature!(
      "doc-1",
      { id: "sig-1", page: 1, rect: { x: 110, y: 210, width: 160, height: 55 } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signatures).toEqual([samplePlacement]);
    expect((r.value as unknown as Record<string, unknown>).placedSignatures).toBeUndefined();
  });

  // DEF-059 residual — `getState` is the third path the App.tsx
  // mirror observes (noteOpApplied routes its result through the
  // same effect). Pin that path too.
  it("getState echo carries signatures (no placedSignatures leak)", async () => {
    const wire = wireStateWithPlaced([samplePlacement]);
    (window as unknown as {
      tflex: { engine: ReturnType<typeof makeRealEngineWithPlaced> };
    }).tflex = { engine: makeRealEngineWithPlaced(wire) };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getState("doc-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signatures).toEqual([samplePlacement]);
    expect((r.value as unknown as Record<string, unknown>).placedSignatures).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fillFormField round-trip (DEF-023)
//
// The wire contract for fillFormField returns FormField[] (not EngineState).
// The App.tsx fix relies on this: after a successful fillFormField, the
// renderer follows up with getState() to read modified=true and the undo
// counter, and routes that EngineState through noteOpApplied so the
// Save-As button enables. These tests pin two structural facts:
//
//   1. The real-engine adapter's fillFormField returns the per-field echo
//      (FormField[]), not the full engine state. Without this, App.tsx
//      cannot rely on the wire shape and the modified-flag fix breaks.
//   2. The returned field list reflects the field echo (current value
//      included). The renderer also calls getState() to read modified,
//      so the field echo and the state echo must agree.
//
// The stub engine's fillFormField already returns FormField[] — see
// stubEngine.test.ts. The integration test that proves App.tsx wires
// noteOpApplied lives in the e2e harness (qa-phase4.spec.cjs: the
// modified=true assertion after the form-fill round-trip).
describe("engineClient — fillFormField wire contract (DEF-023)", () => {
  function makeFormEngine(fields: Array<Record<string, unknown>>): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    undo: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    redo: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    merge: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
        formFields: Array<Record<string, unknown>>;
      };
    }>;
    getFormFields: () => Promise<{
      ok: true;
      value: Array<Record<string, unknown>>;
    }>;
    fillFormField: (
      _docId: string,
      payload: { id: string; value: string | string[] },
    ) => Promise<{
      ok: true;
      value: Array<Record<string, unknown>>;
    }>;
    flattenForms: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    placeSignature: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    moveSignature: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
    deleteSignature: () => Promise<{
      ok: true;
      value: {
        pageCount: number;
        modified: boolean;
        pageOrder: number[];
        rotations: number[];
        deleted: boolean[];
      };
    }>;
  } {
    // Closure-mutable store so a fillFormField call is visible to
    // subsequent getFormFields / getState round-trips. Mirrors the
    // real engine: every successful fillFormField updates the
    // engine's authoritative field list and flips modified=true.
    const store: { fields: Array<Record<string, unknown>>; modified: boolean } = {
      fields: fields.map((f) => ({ ...f })),
      modified: false,
    };
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async undo() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async redo() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async merge() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
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
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            // Engine flips modified=true on every successful
            // fillFormField. App.tsx reads this in the
            // post-fill getState() round-trip that drives
            // noteOpApplied.
            modified: store.modified,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
            formFields: store.fields.map((f) => ({ ...f })),
          },
        };
      },
      async getFormFields() {
        return { ok: true as const, value: store.fields.map((f) => ({ ...f })) };
      },
      async fillFormField(
        _docId: string,
        payload: { id: string; value: string | string[] },
      ) {
        // The real engine returns the per-field echo. The adapter
        // re-fetches getFormFields (per the engineClient comment
        // around the existing fillFormField implementation) and we
        // return the up-to-date field list with the new value
        // applied. The store is mutable so subsequent
        // getFormFields / getState round-trips see the update.
        store.fields = store.fields.map((f) =>
          f.id === payload.id ? { ...f, value: payload.value } : f,
        );
        store.modified = true;
        return { ok: true as const, value: store.fields.map((f) => ({ ...f })) };
      },
      async flattenForms() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async placeSignature() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async moveSignature() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
      async deleteSignature() {
        return {
          ok: true as const,
          value: {
            pageCount: 1,
            modified: true,
            pageOrder: [0],
            rotations: [0],
            deleted: [false],
          },
        };
      },
    };
  }

  const textField = {
    id: "form-0-name",
    name: "applicant_name",
    page: 1,
    kind: "text",
    rect: { x: 10, y: 10, width: 200, height: 20 },
    value: "",
  };
  const checkbox = {
    id: "form-0-terms",
    name: "terms_agreed",
    page: 1,
    kind: "checkbox",
    rect: { x: 10, y: 50, width: 12, height: 12 },
    value: "false",
  };

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("returns FormField[] (not EngineState) from fillFormField — wire contract", async () => {
    (window as unknown as { tflex: { engine: ReturnType<typeof makeFormEngine> } }).tflex = {
      engine: makeFormEngine([textField, checkbox]),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.fillFormField!("doc-1", { id: "form-0-name", value: "Jane" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The wire shape is FormField[], NOT an EngineState. App.tsx's
    // modified-flag fix relies on this — it must follow up with
    // getState() to read EngineState.modified.
    expect(Array.isArray(r.value)).toBe(true);
    expect((r.value as unknown as { modified?: unknown }).modified).toBeUndefined();
  });

  it("fillFormField echo includes the new value (so the local mirror updates)", async () => {
    (window as unknown as { tflex: { engine: ReturnType<typeof makeFormEngine> } }).tflex = {
      engine: makeFormEngine([textField, checkbox]),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.fillFormField!("doc-1", { id: "form-0-name", value: "Jane" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const echo = r.value as Array<{ id: string; value: string }>;
    expect(echo.find((f) => f.id === "form-0-name")?.value).toBe("Jane");
    expect(echo.find((f) => f.id === "form-0-terms")?.value).toBe("false");
  });

  it("getState exposes modified=true after a fillFormField (App.tsx fix hook)", async () => {
    (window as unknown as { tflex: { engine: ReturnType<typeof makeFormEngine> } }).tflex = {
      engine: makeFormEngine([textField, checkbox]),
    };
    _resetEngineForTests();
    const e = getEngine();
    // Drive a fillFormField then a getState — the App.tsx fix does
    // exactly this sequence and pipes the getState result through
    // noteOpApplied so the Save-As button enables (DEF-023).
    await e.fillFormField!("doc-1", { id: "form-0-name", value: "Jane" });
    const s = await e.getState("doc-1");
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.modified).toBe(true);
    // formFields is optional on the shared EngineState shape; the
    // renderer adapter's normalizeState always populates it. Our
    // fake engine populates it directly so the assertion is safe.
    const echoed = s.value.formFields ?? [];
    expect(echoed.length).toBe(2);
    expect(echoed.find((f) => f.id === "form-0-name")?.value).toBe("Jane");
  });

  it("checkbox true/false echoes through fillFormField with the engine's wire shape", async () => {
    (window as unknown as { tflex: { engine: ReturnType<typeof makeFormEngine> } }).tflex = {
      engine: makeFormEngine([textField, checkbox]),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.fillFormField!("doc-1", { id: "form-0-terms", value: "true" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const echo = r.value as Array<{ id: string; value: string }>;
    expect(echo.find((f) => f.id === "form-0-terms")?.value).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// formFields wire-shape: defensive defaults across engine ops (DEF-025)
//
// The engine's `buildState` is being updated to ship `formFields` in every
// EngineState echo so the renderer's mirror effect can resync the per-tab
// form list from the engine without a separate `getFormFields` round-trip.
// While the backend ships that change, every engine op (rotate / delete /
// reorder / fillFormField / placeSignature / etc.) returns an EngineState
// that omits the `formFields` key. The previous version of `normalizeState`
// defaulted to `[]` when the wire omitted the key — that `[]` then flowed
// into App.tsx's `engineUi -> openTabs.forms` mirror effect, which saw
// `fromEngine === []` (defined but empty), ran `replaceFields(tab.forms,
// [])`, and clobbered every field value the user had typed. Same shape of
// regression as DEF-022 for signatures.
//
// The fix: when the wire omits `formFields`, `normalizeState` leaves the
// renderer state's `formFields` field `undefined` so App.tsx's mirror
// effect's `fromEngine === undefined` short-circuit kicks in (no clobber).
// When the wire carries `formFields` (the post-fix backend path), we
// consume it verbatim — that's the authoritative engine state. Empty
// arrays (`formFields: []`) are honored as-is, so a post-flatten /
// form-free document correctly empties the local list once the backend
// starts emitting the key.
//
// These tests pin all three cases plus the regression scenario itself.
describe("engineClient — formFields wire-shape defaults (DEF-025)", () => {
  function makeWireEngine(state: Record<string, unknown>): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    undo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    redo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    merge: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  } {
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: state };
      },
      async undo() {
        return { ok: true as const, value: state };
      },
      async redo() {
        return { ok: true as const, value: state };
      },
      async merge() {
        return { ok: true as const, value: state };
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
        return { ok: true as const, value: state };
      },
    };
  }

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("leaves formFields undefined when the wire omits the key (no clobber path)", async () => {
    // Pre-fix backend shape: formFields key is absent on the wire. The
    // renderer state must surface `formFields: undefined` so App.tsx's
    // mirror effect's `fromEngine === undefined` short-circuit fires.
    const wire = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      // formFields intentionally absent.
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.formFields).toBeUndefined();
  });

  it("consumes formFields when the wire carries an array (post-fix backend path)", async () => {
    const field = {
      id: "form-0-name",
      name: "applicant_name",
      page: 1,
      kind: "text",
      rect: { x: 10, y: 10, width: 200, height: 20 },
      value: "Jane",
    };
    const wire = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      formFields: [field],
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.formFields).toEqual([field]);
  });

  it("consumes an empty formFields array (post-flatten / form-free doc)", async () => {
    // The wire emits formFields: [] as a legitimate "this doc has no
    // AcroForm" signal. The renderer must surface it as [], not leave it
    // undefined, so the App.tsx mirror effect empties the local list.
    const wire = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      formFields: [],
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.formFields).toEqual([]);
  });

  it("applyOp with wire omitting formFields does not clobber App.tsx mirror (regression pin)", async () => {
    // DEF-025 regression: pre-fix, `applyOp({kind:rotate})` returned
    // `formFields: []` (wire omitted, normalizeState defaulted). The
    // App.tsx mirror effect then ran `replaceFields(tab.forms, [])` and
    // wiped every locally-edited value. Pin the post-fix behaviour: the
    // renderer state surfaces `formFields: undefined`, so the mirror's
    // `fromEngine === undefined` short-circuit kicks in.
    const wire = {
      pageCount: 3,
      modified: true,
      pageOrder: [0, 1, 2],
      rotations: [0, 0, 0],
      deleted: [false, false, false],
      // formFields omitted.
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    // Simulate the App.tsx flow: rotate, then rotate again, then getState.
    await e.applyOp("doc-1", { kind: "rotate", page: 1, dir: "cw" });
    await e.applyOp("doc-1", { kind: "rotate", page: 2, dir: "cw" });
    const s = await e.getState("doc-1");
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    // Every echo leaves formFields undefined — none of them clobber.
    expect(s.value.formFields).toBeUndefined();
  });

  it("getState with wire carrying formFields flows them through to renderer state", async () => {
    // Pins the post-fix backend contract: every getState echo carries
    // formFields; the renderer consumes them verbatim.
    const fields = [
      {
        id: "f1",
        name: "first",
        page: 1,
        kind: "text",
        rect: { x: 0, y: 0, width: 100, height: 20 },
        value: "Alpha",
      },
      {
        id: "f2",
        name: "second",
        page: 1,
        kind: "checkbox",
        rect: { x: 0, y: 30, width: 12, height: 12 },
        value: "true",
      },
    ];
    const wire = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      formFields: fields,
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wire),
    };
    _resetEngineForTests();
    const e = getEngine();
    const s = await e.getState("doc-1");
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.formFields).toEqual(fields);
  });

  it("undo and redo follow the same wire-shape rules", async () => {
    // Pin both op paths: undo and redo must default to undefined when the
    // wire omits formFields (defensive) and consume when present.
    const wireWith = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      formFields: [{ id: "x", name: "x", page: 1, kind: "text", rect: { x: 0, y: 0, width: 1, height: 1 }, value: "v" }],
    };
    const wireWithout = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
    };

    // First, engine with formFields — verify undo consumes them.
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wireWith),
    };
    _resetEngineForTests();
    let e = getEngine();
    let r = await e.undo!("doc-1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.formFields?.length).toBe(1);

    // Then engine without formFields — verify undo leaves undefined.
    (window as unknown as { tflex: { engine: ReturnType<typeof makeWireEngine> } }).tflex = {
      engine: makeWireEngine(wireWithout),
    };
    _resetEngineForTests();
    e = getEngine();
    r = await e.redo!("doc-1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.formFields).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — optimize + auditSpace pass-through
//
// The renderer adapter wraps the IPC's engine.optimize / engine.auditSpace
// behind the same EngineApi surface used by every other engine op. The
// real adapter must:
//   - pass the preset through unchanged (the engine validates the enum;
//     the renderer doesn't)
//   - return the result bytes / SpaceAudit verbatim (no shape rewriting)
//   - degrade gracefully with engine-error when the backend doesn't expose
//     the method (pre-Phase-8 fallback path)
describe("engineClient — Phase 8 optimize + auditSpace pass-through", () => {
  function makePhase8Engine(captured: {
    optimizeCalls: Array<{ docId: string; preset: string }>;
    auditCalls: string[];
    bytes?: ArrayBuffer;
    audit?: {
      totalBytes: number;
      breakdown: {
        images: number;
        fonts: number;
        contentStreams: number;
        metadata: number;
        other: number;
      };
    };
  }): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    undo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    redo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    merge: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    optimize: (docId: string, preset: string) => Promise<{ ok: true; value: ArrayBuffer }>;
    auditSpace: (docId: string) => Promise<{ ok: true; value: typeof captured.audit }>;
  } {
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: {} };
      },
      async undo() {
        return { ok: true as const, value: {} };
      },
      async redo() {
        return { ok: true as const, value: {} };
      },
      async merge() {
        return { ok: true as const, value: {} };
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
        return { ok: true as const, value: {} };
      },
      async optimize(docId, preset) {
        captured.optimizeCalls.push({ docId, preset });
        return { ok: true as const, value: captured.bytes ?? new ArrayBuffer(4) };
      },
      async auditSpace(docId) {
        captured.auditCalls.push(docId);
        return {
          ok: true as const,
          value: captured.audit ?? {
            totalBytes: 1000,
            breakdown: {
              images: 500,
              fonts: 200,
              contentStreams: 200,
              metadata: 50,
              other: 50,
            },
          },
        };
      },
    };
  }

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("optimize forwards preset and returns bytes verbatim", async () => {
    const captured = {
      optimizeCalls: [] as Array<{ docId: string; preset: string }>,
      auditCalls: [] as string[],
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase8Engine> } }).tflex = {
      engine: makePhase8Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.optimize!("doc-1", "compact");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.optimizeCalls).toEqual([{ docId: "doc-1", preset: "compact" }]);
    expect(r.value).toBeInstanceOf(ArrayBuffer);
  });

  it("optimize accepts every valid preset enum value", async () => {
    const captured = {
      optimizeCalls: [] as Array<{ docId: string; preset: string }>,
      auditCalls: [] as string[],
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase8Engine> } }).tflex = {
      engine: makePhase8Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    for (const preset of ["none", "compact", "max"] as const) {
      await e.optimize!("doc-1", preset);
    }
    expect(captured.optimizeCalls.map((c) => c.preset)).toEqual(["none", "compact", "max"]);
  });

  it("auditSpace returns the breakdown unchanged", async () => {
    const audit = {
      totalBytes: 10000,
      breakdown: {
        images: 4500,
        fonts: 1200,
        contentStreams: 3000,
        metadata: 500,
        other: 800,
      },
    };
    const captured = {
      optimizeCalls: [] as Array<{ docId: string; preset: string }>,
      auditCalls: [] as string[],
      audit,
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase8Engine> } }).tflex = {
      engine: makePhase8Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.auditSpace!("doc-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(audit);
    expect(captured.auditCalls).toEqual(["doc-1"]);
  });

  it("optimize returns engine-error when the backend predates Phase 8", async () => {
    // A backend with no optimize method — the renderer adapter must
    // surface a friendly engine-error instead of crashing.
    const fakeEngine = {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: {} };
      },
      async undo() {
        return { ok: true as const, value: {} };
      },
      async redo() {
        return { ok: true as const, value: {} };
      },
      async merge() {
        return { ok: true as const, value: {} };
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
        return { ok: true as const, value: {} };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.optimize!("doc-1", "compact");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("auditSpace returns engine-error when the backend predates Phase 8", async () => {
    const fakeEngine = {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: {} };
      },
      async undo() {
        return { ok: true as const, value: {} };
      },
      async redo() {
        return { ok: true as const, value: {} };
      },
      async merge() {
        return { ok: true as const, value: {} };
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
        return { ok: true as const, value: {} };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.auditSpace!("doc-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });
});

// ---------------------------------------------------------------------------
// Phase 10 — edit-content methods.
//
// The renderer adapter must:
//   - pass the payload to engine.editTextRun / addTextBox / editImage
//     verbatim (the engine validates the field values; the renderer
//     doesn't re-shape)
//   - return the engine's EngineState (so the App's noteOpApplied can
//     flip modified + bump the undo counter)
//   - degrade with engine-error when the backend doesn't expose the
//     method (pre-Phase-10 fallback path)
describe("engineClient — Phase 10 edit-content pass-through", () => {
  function makePhase10Engine(captured: {
    editTextRunCalls: Array<{ docId: string; newText: string }>;
    addTextBoxCalls: Array<{ docId: string; text: string; background: string | undefined }>;
    editImageCalls: Array<{ docId: string; op: string; newBytesLen: number }>;
  }): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    undo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    redo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    merge: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    editTextRun: (docId: string, payload: { newText: string }) => Promise<{ ok: true; value: Record<string, unknown> }>;
    addTextBox: (docId: string, payload: { text: string; background?: "white" | "none" }) => Promise<{ ok: true; value: Record<string, unknown> }>;
    editImage: (docId: string, payload: { op: string; imageBytes: Uint8Array }) => Promise<{ ok: true; value: Record<string, unknown> }>;
  } {
    const state = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
    };
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: state };
      },
      async undo() {
        return { ok: true as const, value: state };
      },
      async redo() {
        return { ok: true as const, value: state };
      },
      async merge() {
        return { ok: true as const, value: state };
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
        return { ok: true as const, value: state };
      },
      async editTextRun(docId, payload) {
        captured.editTextRunCalls.push({ docId, newText: payload.newText });
        return { ok: true as const, value: state };
      },
      async addTextBox(docId, payload) {
        captured.addTextBoxCalls.push({
          docId,
          text: payload.text,
          background: payload.background,
        });
        return { ok: true as const, value: state };
      },
      async editImage(docId, payload) {
        captured.editImageCalls.push({
          docId,
          op: payload.op,
          newBytesLen: payload.imageBytes.byteLength,
        });
        return { ok: true as const, value: state };
      },
    };
  }

  beforeEach(() => {
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("editTextRun forwards the payload and returns the engine state", async () => {
    const captured = {
      editTextRunCalls: [] as Array<{ docId: string; newText: string }>,
      addTextBoxCalls: [] as Array<{ docId: string; text: string; background: string | undefined }>,
      editImageCalls: [] as Array<{ docId: string; op: string; newBytesLen: number }>,
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase10Engine> } }).tflex = {
      engine: makePhase10Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.editTextRun!("doc-1", {
      page: 1,
      rect: { x: 50, y: 50, width: 200, height: 12 },
      newText: "Replaced",
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.editTextRunCalls).toEqual([{ docId: "doc-1", newText: "Replaced" }]);
    expect(r.value.modified).toBe(true);
  });

  it("addTextBox forwards the payload and the background field", async () => {
    const captured = {
      editTextRunCalls: [] as Array<{ docId: string; newText: string }>,
      addTextBoxCalls: [] as Array<{ docId: string; text: string; background: string | undefined }>,
      editImageCalls: [] as Array<{ docId: string; op: string; newBytesLen: number }>,
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase10Engine> } }).tflex = {
      engine: makePhase10Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.addTextBox!("doc-1", {
      page: 1,
      rect: { x: 100, y: 100, width: 200, height: 30 },
      text: "Box text",
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
      background: "white",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.addTextBoxCalls).toEqual([
      { docId: "doc-1", text: "Box text", background: "white" },
    ]);
  });

  it("editImage forwards the op and the byte length", async () => {
    const captured = {
      editTextRunCalls: [] as Array<{ docId: string; newText: string }>,
      addTextBoxCalls: [] as Array<{ docId: string; text: string; background: string | undefined }>,
      editImageCalls: [] as Array<{ docId: string; op: string; newBytesLen: number }>,
    };
    (window as unknown as { tflex: { engine: ReturnType<typeof makePhase10Engine> } }).tflex = {
      engine: makePhase10Engine(captured),
    };
    _resetEngineForTests();
    const e = getEngine();
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await e.editImage!("doc-1", {
      page: 1,
      op: "move",
      oldRect: { x: 0, y: 0, width: 100, height: 100 },
      newRect: { x: 50, y: 50, width: 100, height: 100 },
      imageBytes,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.editImageCalls).toEqual([
      { docId: "doc-1", op: "move", newBytesLen: 8 },
    ]);
  });

  it("editTextRun returns engine-error when the backend predates Phase 10", async () => {
    // A pre-Phase-10 backend has none of the three methods. The
    // adapter must surface engine-error instead of crashing.
    const fakeEngine = makeBaseEngine();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.editTextRun!("doc-1", {
      page: 1,
      rect: { x: 0, y: 0, width: 100, height: 12 },
      newText: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("addTextBox returns engine-error when the backend predates Phase 10", async () => {
    const fakeEngine = makeBaseEngine();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.addTextBox!("doc-1", {
      page: 1,
      rect: { x: 0, y: 0, width: 100, height: 30 },
      text: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("editImage returns engine-error when the backend predates Phase 10", async () => {
    const fakeEngine = makeBaseEngine();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.editImage!("doc-1", {
      page: 1,
      op: "replace",
      oldRect: { x: 0, y: 0, width: 100, height: 100 },
      newRect: { x: 0, y: 0, width: 100, height: 100 },
      imageBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });
});

/** A minimal pre-Phase-10 engine surface — has every required
 *  method but none of the optional Phase 10 ones. Used by the
 *  defensive-gating tests. */
function makeBaseEngine(): {
  available: boolean;
  loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
  loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
  applyOp: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  undo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  redo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  merge: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  split: () => Promise<{ ok: true; value: ArrayBuffer }>;
  extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
  save: () => Promise<{ ok: true; value: string }>;
  saveAs: () => Promise<{ ok: true; value: string }>;
  getState: () => Promise<{ ok: true; value: Record<string, unknown> }>;
} {
  return {
    available: true,
    async loadDocument() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      return { ok: true as const, value: new ArrayBuffer(0) };
    },
    async applyOp() {
      return { ok: true as const, value: {} };
    },
    async undo() {
      return { ok: true as const, value: {} };
    },
    async redo() {
      return { ok: true as const, value: {} };
    },
    async merge() {
      return { ok: true as const, value: {} };
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
      return { ok: true as const, value: {} };
    },
  };
}

describe("engineClient — Phase 11 OCR pass-through", () => {
  // Minimal pre-Phase-11 engine surface — has every required
  // method but none of the optional Phase 11 ones. The OCR
  // adapter should degrade to engine-error when the backend
  // predates Phase 11.
  function makeBaseEngineNoOcr(): {
    available: boolean;
    loadDocument: () => Promise<{ ok: true; value: ArrayBuffer }>;
    loadDocumentBytes: () => Promise<{ ok: true; value: ArrayBuffer }>;
    applyOp: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    undo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    redo: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    merge: () => Promise<{ ok: true; value: Record<string, unknown> }>;
    split: () => Promise<{ ok: true; value: ArrayBuffer }>;
    extract: () => Promise<{ ok: true; value: ArrayBuffer }>;
    save: () => Promise<{ ok: true; value: string }>;
    saveAs: () => Promise<{ ok: true; value: string }>;
    getState: () => Promise<{ ok: true; value: Record<string, unknown> }>;
  } {
    return {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: {} };
      },
      async undo() {
        return { ok: true as const, value: {} };
      },
      async redo() {
        return { ok: true as const, value: {} };
      },
      async merge() {
        return { ok: true as const, value: {} };
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
        return { ok: true as const, value: {} };
      },
    };
  }

  beforeEach(() => {
    _resetEngineForTests();
  });
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("ocrRecognize returns engine-error when the backend predates Phase 11", async () => {
    const fakeEngine = makeBaseEngineNoOcr();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.ocrRecognize!("doc-1", {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('engine-error');
  });

  it("ocrSuspects returns engine-error when the backend predates Phase 11", async () => {
    const fakeEngine = makeBaseEngineNoOcr();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.ocrSuspects!("doc-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('engine-error');
  });

  // Phase 51 (item 9) — the real adapter must forward the cancel call,
  // with the doc id, to the preload surface and return its result
  // verbatim (the engine client does not transform cancel results).
  it("ocrCancel forwards the doc id to the backend and returns its result", async () => {
    const calls: string[] = [];
    const fakeEngine = {
      ...makeBaseEngine(),
      ocrCancel: async (docId: string) => {
        calls.push(docId);
        return { ok: true as const, value: { cancelled: docId === 'doc-42' } };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.ocrCancel!("doc-42");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ cancelled: true });
    expect(calls).toEqual(["doc-42"]);
  });

  it("ocrCancel returns engine-error when the backend predates Phase 51", async () => {
    const fakeEngine = makeBaseEngineNoOcr();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.ocrCancel!("doc-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('engine-error');
  });

  it("onOcrProgress returns a no-op unsubscribe when the backend predates Phase 11", () => {
    const fakeEngine = makeBaseEngineNoOcr();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const unsub = e.onOcrProgress?.(() => undefined) ?? ((): void => undefined);
    expect(typeof unsub).toBe('function');
    // Must not throw when invoked.
    expect((): void => unsub()).not.toThrow();
  });

  // DEF-050 — Phase 11 refresh hook. When the backend predates
  // Phase 11 (no `getDocumentBytes` on the preload), the renderer
  // falls back to the existing search-index invalidator. This test
  // pins the adapter's pre-Phase-11 behaviour: the call resolves
  // with engine-error so the host can branch on `ok` cleanly.
  it("getDocumentBytes returns engine-error when the backend predates Phase 11", async () => {
    const fakeEngine = makeBaseEngineNoOcr();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getDocumentBytes!("doc-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('engine-error');
  });

  // DEF-050 — when the backend DOES expose the refresh hook, the
  // adapter should forward the bytes verbatim (normalized via
  // toArrayBuffer). This pins the renderer-side wiring used by
  // the OCR confirm handler to rebuild the pdf.js proxy in place.
  it("getDocumentBytes forwards the engine's bytes when the backend is Phase 11", async () => {
    const captured: { docId: string | null } = { docId: null };
    const expected = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const fakeEngine = {
      ...makeBaseEngineNoOcr(),
      async getDocumentBytes(docId: string): Promise<{
        ok: true;
        value: ArrayBuffer;
      }> {
        captured.docId = docId;
        // Return a Uint8Array view to exercise the toArrayBuffer
        // normalization path inside the adapter.
        const copy = new Uint8Array(expected.byteLength);
        copy.set(expected);
        return { ok: true, value: copy.buffer };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getDocumentBytes!("doc-abc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.docId).toBe('doc-abc');
    // Result must be a real ArrayBuffer (not a Uint8Array view)
    // so downstream code that hands it to pdf.js / openPdfDocument
    // doesn't trip on the type narrowing.
    expect(r.value).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(r.value)).toEqual(expected);
  });

  // DEF-050 — engine error path. If the backend's refresh hook
  // returns an error, the adapter must surface it verbatim so the
  // host can decide whether to toast or fall back.
  it("getDocumentBytes surfaces the engine's error when refresh fails", async () => {
    const fakeEngine = {
      ...makeBaseEngineNoOcr(),
      async getDocumentBytes(_docId: string): Promise<{
        ok: false;
        error: { code: 'engine-error'; message: string };
      }> {
        return { ok: false, error: { code: 'engine-error', message: 'refresh failed' } };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.getDocumentBytes!("doc-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('engine-error');
    expect(r.error.message).toBe('refresh failed');
  });
});