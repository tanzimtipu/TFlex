// @vitest-environment jsdom
//
// Phase 28 (chunk 3) - renderer wiring for the comment op.
//
// Pins three contracts of `RealEngineAdapter.addComment`:
//   1. it forwards (docId, annotationId, text, author) to the preload
//      engine exactly as the shared IPC contract declares;
//   2. the echoed state goes through `normalizeAndCache`, so the
//      renderer mirror (and `peekLastState`) sees the refreshed
//      `comments` array - that is what flips the annotation's comment
//      badge on and re-renders the comment box's list;
//   3. a state echo that OMITS `comments` carries the previous threads
//      forward (an unrelated round-trip must not blank the badges);
//   4. a preload without `addComment` degrades with a typed
//      engine-error instead of crashing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetEngineForTests, getEngine } from "../../../src/renderer/engine/engineClient";

interface Wire {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  comments?: unknown;
}

function wire(comments?: unknown): Wire {
  return {
    pageCount: 1,
    modified: true,
    pageOrder: [0],
    rotations: [0],
    deleted: [false],
    ...(comments === undefined ? {} : { comments }),
  };
}

function makeFake(withCommentOp = true): {
  engine: Record<string, unknown>;
  addComment: ReturnType<typeof vi.fn>;
  queue: Wire[];
} {
  const queue: Wire[] = [];
  const next = (): Wire => {
    const s = queue.shift();
    if (s === undefined) throw new Error("no queued response");
    return s;
  };
  const addComment = vi.fn(async () => ({ ok: true as const, value: next() }));
  const engine: Record<string, unknown> = {
    available: true,
    loadDocument: async (): Promise<unknown> => ({ ok: true, value: new ArrayBuffer(0) }),
    loadDocumentBytes: async (): Promise<unknown> => ({ ok: true, value: new ArrayBuffer(0) }),
    applyOp: async (): Promise<unknown> => ({ ok: true, value: next() }),
    undo: async (): Promise<unknown> => ({ ok: true, value: next() }),
    redo: async (): Promise<unknown> => ({ ok: true, value: next() }),
    merge: async (): Promise<unknown> => ({ ok: true, value: next() }),
    split: async (): Promise<unknown> => ({ ok: true, value: new ArrayBuffer(0) }),
    extract: async (): Promise<unknown> => ({ ok: true, value: new ArrayBuffer(0) }),
    save: async (): Promise<unknown> => ({ ok: true, value: "/p" }),
    saveAs: async (): Promise<unknown> => ({ ok: true, value: "/p" }),
    getState: async (): Promise<unknown> => ({ ok: true, value: next() }),
    createAnnotation: async (): Promise<unknown> => ({ ok: true, value: next() }),
    editAnnotation: async (): Promise<unknown> => ({ ok: true, value: next() }),
    deleteAnnotation: async (): Promise<unknown> => ({ ok: true, value: next() }),
  };
  if (withCommentOp) engine.addComment = addComment;
  return { engine, addComment, queue };
}

function install(fake: { engine: Record<string, unknown> }): void {
  (window as unknown as { tflex: unknown }).tflex = { engine: fake.engine };
  _resetEngineForTests();
}

describe("Phase 28 - engineClient.addComment routing", () => {
  beforeEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("forwards the four args and refreshes the cached comments mirror", async () => {
    const fake = makeFake();
    install(fake);
    const e = getEngine();
    fake.queue.push(
      wire([{ annotationId: "ann-1", entries: [{ id: "cmt-1", author: "You", text: "hi", createdAt: 1 }] }]),
    );
    const r = await e.addComment("doc-1", "ann-1", "hi", "Dana");
    expect(r.ok).toBe(true);
    expect(fake.addComment).toHaveBeenCalledWith("doc-1", "ann-1", "hi", "Dana");
    if (!r.ok) return;
    expect(r.value.comments).toHaveLength(1);
    expect(r.value.comments?.[0]?.annotationId).toBe("ann-1");
    // The mirror the diagnostics surface reads is refreshed too.
    expect(e.peekLastState?.("doc-1")?.comments).toHaveLength(1);
  });

  it("carries the previous threads forward when the echo omits `comments`", async () => {
    const fake = makeFake();
    install(fake);
    const e = getEngine();
    fake.queue.push(
      wire([{ annotationId: "ann-1", entries: [{ id: "cmt-1", author: "You", text: "hi", createdAt: 1 }] }]),
    );
    await e.addComment("doc-1", "ann-1", "hi");
    // An unrelated op whose echo has no `comments` key.
    fake.queue.push(wire());
    const r = await e.addComment("doc-1", "ann-1", "again");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comments).toHaveLength(1);
    expect(r.value.comments?.[0]?.entries[0]?.text).toBe("hi");
  });

  it("respects an explicit empty comments array (engine cleared the threads)", async () => {
    const fake = makeFake();
    install(fake);
    const e = getEngine();
    fake.queue.push(
      wire([{ annotationId: "ann-1", entries: [{ id: "cmt-1", author: "You", text: "hi", createdAt: 1 }] }]),
    );
    await e.addComment("doc-1", "ann-1", "hi");
    fake.queue.push(wire([]));
    const r = await e.addComment("doc-1", "ann-1", "hi");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comments).toEqual([]);
  });

  it("degrades with a typed engine-error when the preload lacks addComment", async () => {
    const fake = makeFake(false);
    install(fake);
    const e = getEngine();
    const r = await e.addComment("doc-1", "ann-1", "hi");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
    expect(r.error.message).toMatch(/comments require/);
  });
});