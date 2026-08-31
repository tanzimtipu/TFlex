// @vitest-environment jsdom
//
// Integration test for the annotation-create path through the
// engine adapter. Specifically:
//   - createAnnotation succeeds
//   - the result is normalized via normalizeState with the
//     previous state from the per-doc cache (DEF-068)
//   - the new annotation appears in the result.annotations array
//
// This pins the contract that App.tsx's noteOpApplied / setEngineUi
// state expects: the engine state's annotations list contains the
// just-created entry, so tflexDiagnostics().engineState.annotations
// has a non-zero length after the user creates their first
// highlight.

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

function makeFakeEngine(): {
  fake: FakeEngine;
  enqueue: (state: EngineStateWire) => void;
} {
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
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async undo() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async redo() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async merge() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
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
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async createAnnotation() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async editAnnotation() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
    async deleteAnnotation() {
      const s = queue.shift();
      if (!s) throw new Error("queue empty");
      return { ok: true as const, value: s };
    },
  };
  return {
    fake,
    enqueue: (state) => queue.push(state),
  };
}

describe("engineClient createAnnotation — DEF-068 integration smoke", () => {
  let harness: ReturnType<typeof makeFakeEngine>;
  beforeEach(() => {
    harness = makeFakeEngine();
    (window as unknown as { tflex: { engine: typeof harness.fake } }).tflex = {
      engine: harness.fake,
    };
    _resetEngineForTests();
  });
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("createAnnotation returns the new annotation in result.annotations", async () => {
    const e = getEngine();
    const ann: Annotation = {
      id: "first",
      kind: "highlight",
      page: 1,
      color: "yellow",
      createdAt: "2026-01-01T00:00:00.000Z",
      rects: [{ x: 0, y: 0, width: 200, height: 20 }],
      text: "hello",
    };
    harness.enqueue({
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [ann],
    });
    const r = await e.createAnnotation("doc-1", ann);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.annotations.length).toBe(1);
    expect(r.value.annotations[0]?.id).toBe("first");
    expect(r.value.annotations[0]?.kind).toBe("highlight");
  });
});