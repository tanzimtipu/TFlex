// @vitest-environment node
//
// Phase 32 (chunk 2d) — the apply + refresh sequence.
//
// A resolved drop funnels through applyPageDrop: a same-document drop uses
// the EXISTING reorder path and never calls the engine; a cross-document
// drop is ONE engine call, BOTH echoed states recorded, BOTH pdf.js proxies
// refreshed through the existing hook, and the target pane revealed. A
// failure toasts the typed error and changes nothing.

import { describe, expect, it, vi } from "vitest";
import { applyPageDrop, type PageDropDeps } from "../../../src/renderer/state/pageDragApply";
import type { PageDropOp } from "../../../src/renderer/state/pageDrag";
import type { EngineState } from "../../../src/renderer/engine/types";

function state(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: true,
    annotations: [],
  };
}

const crossOp = (over: Partial<PageDropOp> = {}): PageDropOp => ({
  fromTabId: "a",
  pages: [2],
  toTabId: "b",
  atIndex: 4,
  mode: "move",
  sameDoc: false,
  ...over,
});

function deps(over: Partial<PageDropDeps> = {}): PageDropDeps & {
  engine: { movePagesBetweenDocs: ReturnType<typeof vi.fn> };
} {
  return {
    engine: {
      movePagesBetweenDocs: vi.fn(async () => ({
        ok: true as const,
        value: { from: state(4), to: state(9) },
      })),
    },
    docIdFor: (tabId) => `doc-${tabId}`,
    onReorder: vi.fn(),
    onStates: vi.fn(),
    refresh: vi.fn(),
    reveal: vi.fn(),
    toast: vi.fn(),
    ...over,
  } as PageDropDeps & { engine: { movePagesBetweenDocs: ReturnType<typeof vi.fn> } };
}

describe("applyPageDrop — same document", () => {
  it("uses the existing reorder path and never calls the engine", async () => {
    const d = deps();
    await applyPageDrop(crossOp({ sameDoc: true, toTabId: "a", atIndex: 2 }), d);
    expect(d.onReorder).toHaveBeenCalledWith("a", 2, 2);
    expect(d.engine.movePagesBetweenDocs).not.toHaveBeenCalled();
    expect(d.refresh).not.toHaveBeenCalled();
    expect(d.reveal).not.toHaveBeenCalled();
  });
});

describe("applyPageDrop — cross document", () => {
  it("calls the engine once with the 1-based payload and refreshes BOTH proxies", async () => {
    const d = deps();
    await applyPageDrop(crossOp(), d);
    expect(d.engine.movePagesBetweenDocs).toHaveBeenCalledTimes(1);
    expect(d.engine.movePagesBetweenDocs).toHaveBeenCalledWith("doc-a", [2], "doc-b", 4, "move");
    expect(d.refresh).toHaveBeenCalledTimes(2);
    expect(d.refresh).toHaveBeenCalledWith("a");
    expect(d.refresh).toHaveBeenCalledWith("b");
  });

  it("records both states for a move and reveals the inserted page in the target", async () => {
    const d = deps();
    await applyPageDrop(crossOp({ atIndex: 4 }), d);
    expect(d.onStates).toHaveBeenCalledWith("a", "b", state(4), state(9), "move");
    expect(d.reveal).toHaveBeenCalledWith("b", 4);
  });

  it("derives the reveal position for an append", async () => {
    const d = deps({
      engine: {
        movePagesBetweenDocs: vi.fn(async () => ({
          ok: true as const,
          value: { from: state(4), to: state(9) },
        })),
      },
    });
    await applyPageDrop(crossOp({ atIndex: -1, pages: [2, 3] }), d);
    // 9 pages after insert, two appended -> first lands at 8.
    expect(d.reveal).toHaveBeenCalledWith("b", 8);
  });

  it("surfaces a typed failure and changes nothing", async () => {
    const d = deps({
      engine: {
        movePagesBetweenDocs: vi.fn(async () => ({
          ok: false as const,
          error: { code: "same-document" as const, message: "same document" },
        })),
      },
    });
    await applyPageDrop(crossOp(), d);
    expect(d.toast).toHaveBeenCalledWith({ code: "same-document", message: "same document" });
    expect(d.onStates).not.toHaveBeenCalled();
    expect(d.refresh).not.toHaveBeenCalled();
    expect(d.reveal).not.toHaveBeenCalled();
  });

  it("surfaces the typed error when a same-document pair reaches the cross path", async () => {
    // A same-document attempt through the NEW path (sameDoc false but equal
    // ids) must reach the engine and surface its typed error, never a
    // silent no-op.
    const d = deps({
      engine: {
        movePagesBetweenDocs: vi.fn(async () => ({
          ok: false as const,
          error: { code: "same-document" as const, message: "same document" },
        })),
      },
    });
    await applyPageDrop(crossOp({ toTabId: "a" }), d);
    expect(d.engine.movePagesBetweenDocs).toHaveBeenCalledTimes(1);
    expect(d.toast).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when a tab has gone", async () => {
    const d = deps({ docIdFor: () => null });
    await applyPageDrop(crossOp(), d);
    expect(d.engine.movePagesBetweenDocs).not.toHaveBeenCalled();
  });
});
