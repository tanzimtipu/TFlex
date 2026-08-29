// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import type { Annotation } from "../../../src/renderer/annotations/model";

const NOW = "2026-01-01T00:00:00.000Z";

function makeAnnotation(): Annotation {
  return {
    id: "ann-1",
    kind: "highlight",
    page: 1,
    color: "yellow",
    createdAt: NOW,
    rects: [{ x: 0, y: 0, width: 20, height: 10 }],
    text: "Hello",
  };
}

function makeTextBox(): Annotation {
  return {
    id: "ann-tb",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: NOW,
    rect: { x: 10, y: 20, width: 100, height: 30 },
    text: "Note",
  };
}

function makeFakeRealEngine(captured: {
  create?: unknown[];
  edit?: unknown[];
  delete?: unknown[];
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
  createAnnotation: (
    docId: string,
    a: Annotation,
  ) => Promise<{ ok: true; value: Record<string, unknown> }>;
  editAnnotation: (
    docId: string,
    id: string,
    patch: unknown,
  ) => Promise<{ ok: true; value: Record<string, unknown> }>;
  deleteAnnotation: (
    docId: string,
    id: string,
  ) => Promise<{ ok: true; value: Record<string, unknown> }>;
} {
  const empty = {
    pageCount: 0,
    modified: false,
    pageOrder: [],
    rotations: [],
    deleted: [],
    annotations: [],
  };
  return {
    available: true,
    async loadDocument() {
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async loadDocumentBytes() {
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async applyOp() {
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
    async split() {
      return { ok: true, value: new ArrayBuffer(0) };
    },
    async extract() {
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
    async createAnnotation(_docId, a) {
      captured.create?.push(a);
      return { ok: true, value: empty };
    },
    async editAnnotation(_docId, id, patch) {
      captured.edit?.push({ id, patch });
      return { ok: true, value: empty };
    },
    async deleteAnnotation(_docId, id) {
      captured.delete?.push(id);
      return { ok: true, value: empty };
    },
  };
}

describe("engineClient — annotation methods forward through to the real engine", () => {
  let captured: {
    create: unknown[];
    edit: { id: string; patch: unknown }[];
    delete: string[];
  };

  beforeEach(() => {
    captured = { create: [], edit: [], delete: [] };
    const fake = makeFakeRealEngine(captured);
    (window as unknown as { tflex: { engine: typeof fake } }).tflex = {
      engine: fake,
    };
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("createAnnotation forwards the annotation to the engine unchanged", async () => {
    const e = getEngine();
    expect(e.available).toBe(true);
    const a = makeAnnotation();
    await e.createAnnotation("doc-1", a);
    expect(captured.create.length).toBe(1);
    expect(captured.create[0]).toEqual(a);
  });

  it("createAnnotation rewrites the renderer's textbox kind to the wire's text-box kind (DEF-015)", async () => {
    const e = getEngine();
    expect(e.available).toBe(true);
    const tb = makeTextBox();
    await e.createAnnotation("doc-1", tb);
    expect(captured.create.length).toBe(1);
    // The forwarded object is a wire-shape annotation with kind "text-box";
    // we read its fields through a plain record so we don't have to satisfy
    // the renderer's discriminated Annotation union (which has no
    // "text-box" member).
    const forwarded = captured.create[0] as Record<string, unknown>;
    const tbFields = tb as unknown as Record<string, unknown>;
    expect(forwarded["kind"]).toBe("text-box");
    expect(forwarded["id"]).toBe(tbFields["id"]);
    expect(forwarded["rect"]).toEqual(tbFields["rect"]);
    expect(forwarded["text"]).toBe(tbFields["text"]);
  });

  it("createAnnotation returns the engine's annotations normalized to the renderer's kind tag", async () => {
    // Build a fake engine that returns an annotation with the wire-shape
    // "text-box" kind. The renderer adapter must translate it back to
    // "textbox" so the AnnotationKind union matches and the overlay can
    // find the matching switch case.
    const wireState = {
      pageCount: 1,
      modified: true,
      pageOrder: [0],
      rotations: [0],
      deleted: [false],
      annotations: [
        {
          id: "ann-tb",
          kind: "text-box",
          page: 1,
          rects: [{ x: 10, y: 20, width: 100, height: 30 }],
          color: "blue",
          text: "Note",
        },
      ],
    };
    const fake = {
      available: true,
      async loadDocument() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async loadDocumentBytes() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async applyOp() {
        return { ok: true as const, value: wireState };
      },
      async undo() {
        return { ok: true as const, value: wireState };
      },
      async redo() {
        return { ok: true as const, value: wireState };
      },
      async merge() {
        return { ok: true as const, value: wireState };
      },
      async split() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async extract() {
        return { ok: true as const, value: new ArrayBuffer(0) };
      },
      async save() {
        return { ok: true as const, value: "/p" };
      },
      async saveAs() {
        return { ok: true as const, value: "/p" };
      },
      async getState() {
        return { ok: true as const, value: wireState };
      },
      async createAnnotation() {
        return { ok: true as const, value: wireState };
      },
      async editAnnotation() {
        return { ok: true as const, value: wireState };
      },
      async deleteAnnotation() {
        return { ok: true as const, value: wireState };
      },
    };
    (window as unknown as { tflex: { engine: typeof fake } }).tflex = {
      engine: fake,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", makeTextBox());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ann = r.value.annotations[0];
      expect(ann).toBeDefined();
      expect(ann?.kind).toBe("textbox");
    }
  });

  it("editAnnotation forwards id and patch", async () => {
    const e = getEngine();
    await e.editAnnotation("doc-1", "ann-1", { color: "red", text: "x" });
    expect(captured.edit).toEqual([
      { id: "ann-1", patch: { color: "red", text: "x" } },
    ]);
  });

  it("deleteAnnotation forwards the id", async () => {
    const e = getEngine();
    await e.deleteAnnotation("doc-1", "ann-1");
    expect(captured.delete).toEqual(["ann-1"]);
  });
});

describe("engineClient — annotation methods degrade without a backend update", () => {
  beforeEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("returns engine-error when the engine lacks createAnnotation", async () => {
    // No window.tflex.engine -> the stub (which does support annotations).
    // To exercise the "missing methods" path, expose an engine object that
    // omits the annotation methods.
    (window as unknown as {
      tflex: { engine: Record<string, unknown> };
    }).tflex = {
      engine: {
        available: true,
        async loadDocument() {
          return { ok: true, value: new ArrayBuffer(0) };
        },
        async loadDocumentBytes() {
          return { ok: true, value: new ArrayBuffer(0) };
        },
        async applyOp() {
          return { ok: true, value: empty() };
        },
        async undo() {
          return { ok: true, value: empty() };
        },
        async redo() {
          return { ok: true, value: empty() };
        },
        async merge() {
          return { ok: true, value: empty() };
        },
        async split() {
          return { ok: true, value: new ArrayBuffer(0) };
        },
        async extract() {
          return { ok: true, value: new ArrayBuffer(0) };
        },
        async save() {
          return { ok: true, value: "/path" };
        },
        async saveAs() {
          return { ok: true, value: "/path" };
        },
        async getState() {
          return { ok: true, value: empty() };
        },
        // No createAnnotation / editAnnotation / deleteAnnotation here.
      },
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createAnnotation("doc-1", makeAnnotation());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("engine-error");
    }
  });
});

function empty(): Record<string, unknown> {
  return {
    pageCount: 0,
    modified: false,
    pageOrder: [],
    rotations: [],
    deleted: [],
    annotations: [],
  };
}
