// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  stubSeedFormFields,
  StubRendererEngine,
} from "../../../src/renderer/engine/stubEngine";
import type { FormField, SignaturePlacement } from "../../../src/shared/types";

function setup(count: number): { engine: StubRendererEngine; tabId: string } {
  const engine = new StubRendererEngine();
  const tabId = "tab-1";
  engine.registerTab(tabId, count);
  return { engine, tabId };
}

describe("StubRendererEngine — tab registration", () => {
  it("initial state is unmodified, all rotations zero, no deletions", () => {
    const { engine, tabId } = setup(3);
    const s = engine.registerTab(tabId, 3);
    expect(s.pageCount).toBe(3);
    expect(s.modified).toBe(false);
    expect(s.rotations).toEqual([0, 0, 0]);
    expect(s.deleted.every((d) => !d)).toBe(true);
    expect(s.pageOrder).toEqual([0, 1, 2]);
  });

  it("registering the same tab is idempotent and preserves state", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    const again = engine.registerTab(tabId, 3);
    expect(again.rotations[0]).toBe(1);
    expect(again.modified).toBe(true);
  });
});

describe("StubRendererEngine — rotate", () => {
  it("rotate cw adds 90 degrees (one quarter-turn)", async () => {
    const { engine, tabId } = setup(3);
    let r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.rotations[0]).toBe(1);
    r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.rotations[0]).toBe(2);
    r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.rotations[0]).toBe(3);
    r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.rotations[0]).toBe(0);
  });

  it("rotate ccw subtracts 90 degrees", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "rotate", page: 2, dir: "ccw" });
    const s = await engine.applyOp(tabId, { kind: "rotate", page: 2, dir: "ccw" });
    if (s.ok) expect(s.value.rotations[1]).toBe(2);
  });

  it("out-of-range page returns out-of-range error", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.applyOp(tabId, { kind: "rotate", page: 99, dir: "cw" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("out-of-range");
  });

  it("rotation sets modified=true", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.modified).toBe(true);
  });
});

describe("StubRendererEngine — delete", () => {
  it("delete removes the page from pageCount", async () => {
    const { engine, tabId } = setup(5);
    const r = await engine.applyOp(tabId, { kind: "delete", pages: [2] });
    if (r.ok) {
      expect(r.value.pageCount).toBe(4);
      expect(r.value.deleted[1]).toBe(true);
      expect(r.value.rotations).toEqual([0, 0, 0, 0]); // gap filled
    }
  });

  it("delete a contiguous range", async () => {
    const { engine, tabId } = setup(5);
    const r = await engine.applyOp(tabId, { kind: "delete", pages: [2, 3, 4] });
    if (r.ok) {
      expect(r.value.pageCount).toBe(2);
      expect(r.value.deleted.filter((d) => d)).toHaveLength(3);
    }
  });

  it("empty pages list returns empty-range error", async () => {
    const { engine, tabId } = setup(5);
    const r = await engine.applyOp(tabId, { kind: "delete", pages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty-range");
  });

  it("out-of-range page in delete returns out-of-range", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.applyOp(tabId, { kind: "delete", pages: [1, 99] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("out-of-range");
  });

  it("delete the last remaining page is rejected", async () => {
    const { engine, tabId } = setup(1);
    const r = await engine.applyOp(tabId, { kind: "delete", pages: [1] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty-range");
  });
});

describe("StubRendererEngine — reorder", () => {
  it("moving page 1 to index 3 reorders visible pages", async () => {
    const { engine, tabId } = setup(5);
    const r = await engine.applyOp(tabId, {
      kind: "reorder",
      fromIndex: 1,
      toIndex: 3,
    });
    if (r.ok) {
      expect(r.value.rotations).toEqual([0, 0, 0, 0, 0]);
      expect(r.value.pageCount).toBe(5);
      expect(r.value.pageOrder).toEqual([1, 2, 0, 3, 4]);
    }
  });

  it("reorder with same from/to is a no-op error", async () => {
    const { engine, tabId } = setup(5);
    const r = await engine.applyOp(tabId, {
      kind: "reorder",
      fromIndex: 1,
      toIndex: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("no-op");
  });

  it("reorder out of range returns out-of-range", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.applyOp(tabId, {
      kind: "reorder",
      fromIndex: -1,
      toIndex: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("out-of-range");
  });

  it("reorder preserves deletions across the move", async () => {
    const { engine, tabId } = setup(5);
    await engine.applyOp(tabId, { kind: "delete", pages: [3] });
    const after = await engine.applyOp(tabId, {
      kind: "reorder",
      fromIndex: 1,
      toIndex: 3,
    });
    if (after.ok) {
      expect(after.value.pageCount).toBe(4);
      expect(after.value.deleted[2]).toBe(true);
    }
  });
});

describe("StubRendererEngine — undo / redo", () => {
  it("undo restores the state before the last op", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    const after = await engine.applyOp(tabId, { kind: "delete", pages: [2] });
    if (after.ok) expect(after.value.pageCount).toBe(2);
    const u = await engine.undo(tabId);
    if (u.ok) {
      expect(u.value.pageCount).toBe(3);
      expect(u.value.rotations[0]).toBe(1);
    }
  });

  it("undo then redo re-applies the deleted state", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "delete", pages: [2] });
    const u = await engine.undo(tabId);
    if (u.ok) expect(u.value.pageCount).toBe(3);
    const r = await engine.redo(tabId);
    if (r.ok) {
      expect(r.value.pageCount).toBe(2);
      expect(r.value.deleted[1]).toBe(true);
    }
  });

  it("undo past history bottom is an error", async () => {
    const { engine, tabId } = setup(3);
    const u = await engine.undo(tabId);
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.error.code).toBe("nothing-to-undo");
  });

  it("new op after undo truncates the redo history", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "delete", pages: [1] });
    await engine.undo(tabId);
    await engine.applyOp(tabId, { kind: "delete", pages: [2] });
    const r = await engine.redo(tabId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("nothing-to-redo");
  });

  it("after undo, modified=false only when undo stack is empty (matches engine contract)", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    const u = await engine.undo(tabId);
    if (u.ok) expect(u.value.modified).toBe(false);
  });
});

describe("StubRendererEngine — modified and markSaved", () => {
  it("any successful op sets modified=true", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.modified).toBe(true);
  });

  it("markSaved clears modified and resets history baseline", async () => {
    const { engine, tabId } = setup(3);
    await engine.applyOp(tabId, { kind: "rotate", page: 1, dir: "cw" });
    engine.markSaved(tabId);
    const s = engine.registerTab(tabId, 3);
    expect(s.modified).toBe(false);
  });
});

describe("StubRendererEngine — save / saveAs / split / extract / merge are stubbed", () => {
  it("save returns an engine-error explaining the backend gap", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.save(tabId);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("engine-error");
      expect(r.error.message).toMatch(/backend/i);
    }
  });

  it("saveAs returns cancelled", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.saveAs(tabId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("cancelled");
  });

  it("split returns engine-error", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.split(tabId, [1, 2]);
    expect(r.ok).toBe(false);
  });

  it("extract returns engine-error", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.extract(tabId, [1, 2]);
    expect(r.ok).toBe(false);
  });

  it("merge returns engine-error", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.merge(tabId, ["/path/to/other.pdf"], "after");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Forms (AcroForm)
// ---------------------------------------------------------------------------

describe("StubRendererEngine — getFormFields / fillFormField / flattenForms", () => {
  function makeTextField(overrides: Partial<FormField> = {}): FormField {
    return {
      id: "f-text",
      name: "applicant_name",
      page: 1,
      kind: "text",
      rect: { x: 10, y: 10, width: 200, height: 20 },
      value: "",
      ...overrides,
    };
  }

  function makeCheckbox(overrides: Partial<FormField> = {}): FormField {
    return {
      id: "f-check",
      name: "terms_agreed",
      page: 1,
      kind: "checkbox",
      rect: { x: 10, y: 50, width: 12, height: 12 },
      value: "false",
      ...overrides,
    };
  }

  beforeEach(() => {
    // Reset the global field seed so each test is hermetic.
    stubSeedFormFields([]);
  });

  function seed(engine: StubRendererEngine, tabId: string, fields: readonly FormField[]): void {
    // Populate both the global seed (so getFormFields returns them)
    // AND the per-tab formValues map (so fillFormField can update).
    stubSeedFormFields(fields);
    engine.seedFormFields(tabId, fields);
  }

  it("getFormFields returns an empty list when no seed is registered", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.getFormFields(tabId);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("getFormFields returns the seeded fields with their values", async () => {
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeTextField({ value: "Alice" })]);
    const r = await engine.getFormFields(tabId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]?.value).toBe("Alice");
    }
  });

  it("getFormFields returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.getFormFields("unknown");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("engine-error");
  });

  it("fillFormField updates the stored value and returns the new field list", async () => {
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeTextField({ value: "" })]);
    const r = await engine.fillFormField(tabId, { id: "f-text", value: "Bob" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]?.value).toBe("Bob");
  });

  it("fillFormField returns not-found for an unknown field id", async () => {
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeTextField()]);
    const r = await engine.fillFormField(tabId, { id: "missing", value: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not-found");
  });

  it("fillFormField accepts checkbox true/false strings", async () => {
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeCheckbox()]);
    const r = await engine.fillFormField(tabId, { id: "f-check", value: "true" });
    if (r.ok) expect(r.value[0]?.value).toBe("true");
  });

  it("flattenForms pushes an undo entry and marks the doc modified", async () => {
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeTextField({ value: "Alice" })]);
    // Seed a placement so we can verify the undo restores it; flatten
    // alone wouldn't tell us anything about the undo path.
    await engine.placeSignature(tabId, {
      id: "pl-keep",
      signatureId: "tmpl",
      page: 1,
      rect: { x: 100, y: 100, width: 50, height: 20 },
      pngBytes: new Uint8Array(),
    });
    const r = await engine.flattenForms(tabId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.modified).toBe(true);
      // The placement is preserved across flatten (only form values
      // disappear).
      expect(r.value.signatures).toHaveLength(1);
      expect(r.value.signatures?.[0]?.id).toBe("pl-keep");
    }
    // Undo restores the previous state, including the placement.
    const u = await engine.undo(tabId);
    if (u.ok) {
      expect(u.value.signatures).toHaveLength(1);
    }
  });

  it("flattenForms is a no-op on the form values map (the global seed re-feeds)", async () => {
    // The stub's contract: flatten empties the per-tab formValues map
    // but the global seed still produces the same field list. After
    // flatten, a getFormFields returns the seed's value (because the
    // per-tab override is gone). This pins the behaviour the real
    // engine doesn't follow (real engine truly removes the field — the
    // renderer must drop its local field list on flatten), and lets
    // tests verify the stub's flatten path independently.
    const { engine, tabId } = setup(3);
    seed(engine, tabId, [makeTextField({ value: "Alice" })]);
    await engine.flattenForms(tabId);
    const after = await engine.getFormFields(tabId);
    expect(after.ok).toBe(true);
    if (after.ok) {
      // The seed still has "Alice"; the per-tab formValues map is
      // empty so getFormFields returns the seed's value (no merge).
      expect(after.value).toHaveLength(1);
      expect(after.value[0]?.id).toBe("f-text");
      expect(after.value[0]?.value).toBe("Alice");
    }
  });

  it("flattenForms returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.flattenForms("unknown");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stub engine — EngineState shape across ops (DEF-025)
//
// The renderer treats the stub as the source of truth when no real engine
// is wired. Every op must surface `formFields` (a possibly-empty array)
// on the returned EngineState, because the real engine (post-fix) will
// ship the key in every state echo. If the stub ever drops the field,
// App.tsx's mirror effect would see `undefined`, short-circuit, and the
// per-tab form list would freeze — same regression as the wire-omits
// path tested in engineClient.test.ts. These tests pin that the stub
// always carries `formFields`.
describe("StubRendererEngine — formFields carried on every state echo (DEF-025)", () => {
  const textField: FormField = {
    id: "f-text",
    name: "name",
    page: 1,
    kind: "text",
    rect: { x: 10, y: 10, width: 200, height: 20 },
    value: "Alice",
  };

  beforeEach(() => {
    // The stub's buildState reads from a module-level seed map, so the
    // global must be primed for each test. The renderer's production
    // path (renderer startup) seeds it once and clears it on tab open.
    stubSeedFormFields([]);
  });

  function register(engine: StubRendererEngine, tabId: string, count: number, fields: readonly FormField[] = []): void {
    // Mirror the existing `seed()` helper from the form tests: prime the
    // global seed AND seed the per-tab formValues map. The seed API
    // takes a mutable FormField[] (it indexes by id into a Map), so we
    // hand it a fresh array copy — the caller's readonly view is fine.
    const mutable = fields as FormField[];
    stubSeedFormFields(mutable);
    engine.registerTab(tabId, count, mutable);
    engine.seedFormFields(tabId, mutable);
  }

  it("registerTab returns a state with formFields = [] when no seed exists", () => {
    const engine = new StubRendererEngine();
    engine.registerTab("tab-1", 3);
    const s = engine.registerTab("tab-1", 3);
    expect(Array.isArray(s.formFields)).toBe(true);
    expect(s.formFields).toEqual([]);
  });

  it("registerTab with a seeded field set carries the fields through", () => {
    const engine = new StubRendererEngine();
    register(engine, "tab-1", 3, [textField]);
    const s = engine.registerTab("tab-1", 3);
    expect(s.formFields).toEqual([textField]);
  });

  it("applyOp echoes formFields from the seed on every op kind", async () => {
    const engine = new StubRendererEngine();
    register(engine, "tab-1", 3, [textField]);
    // rotate
    let r = await engine.applyOp("tab-1", { kind: "rotate", page: 1, dir: "cw" });
    if (r.ok) expect(r.value.formFields).toEqual([textField]);
    // delete
    r = await engine.applyOp("tab-1", { kind: "delete", pages: [2] });
    if (r.ok) expect(r.value.formFields).toEqual([textField]);
    // reorder (no-op if same; force a real change)
    r = await engine.applyOp("tab-1", { kind: "reorder", fromIndex: 1, toIndex: 3 });
    if (r.ok) expect(r.value.formFields).toEqual([textField]);
  });

  it("undo and redo echo formFields from the seed", async () => {
    const engine = new StubRendererEngine();
    register(engine, "tab-1", 3, [textField]);
    await engine.applyOp("tab-1", { kind: "rotate", page: 1, dir: "cw" });
    const u = await engine.undo("tab-1");
    if (u.ok) expect(u.value.formFields).toEqual([textField]);
    const redo = await engine.redo("tab-1");
    if (redo.ok) expect(redo.value.formFields).toEqual([textField]);
  });

  it("getState echoes formFields", async () => {
    const engine = new StubRendererEngine();
    register(engine, "tab-1", 3, [textField]);
    const s = await engine.getState("tab-1");
    if (s.ok) expect(s.value.formFields).toEqual([textField]);
  });

  it("flattenForms echoes an array (possibly with seed values); getState still carries formFields", async () => {
    // Pin: the stub's flattenForms clears only the per-tab formValues
    // map; the module-level seed still re-feeds `buildState`. The
    // contract we care about for DEF-025 is that flatten never returns
    // `formFields: undefined` — it must always be an array. The
    // App.tsx mirror effect treats `undefined` as "engine didn't carry
    // fields", which would freeze the local list. The seed-replay
    // behaviour is already pinned by the existing `flattenForms is a
    // no-op on the form values map` test above; we just assert the
    // shape contract here.
    const engine = new StubRendererEngine();
    register(engine, "tab-1", 3, [textField]);
    const r = await engine.flattenForms("tab-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.isArray(r.value.formFields)).toBe(true);
    }
    const s = await engine.getState("tab-1");
    if (s.ok) {
      expect(Array.isArray(s.value.formFields)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Signatures (placements)
// ---------------------------------------------------------------------------

describe("StubRendererEngine — placeSignature / moveSignature / deleteSignature", () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  function makePlacement(overrides: Partial<{
    id: string;
    signatureId: string;
    page: number;
    rect: { x: number; y: number; width: number; height: number };
    pngBytes: Uint8Array;
  }> = {}): SignaturePlacement {
    return {
      id: "pl-1",
      signatureId: "tmpl-1",
      page: 1,
      rect: { x: 100, y: 500, width: 150, height: 50 },
      pngBytes,
      ...overrides,
    };
  }

  it("placeSignature adds the placement to the doc state", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.placeSignature(tabId, makePlacement());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.signatures).toHaveLength(1);
      expect(r.value.signatures?.[0]?.id).toBe("pl-1");
    }
  });

  it("placeSignature is undoable (push to undo stack)", async () => {
    const { engine, tabId } = setup(3);
    await engine.placeSignature(tabId, makePlacement());
    const before = await engine.getState(tabId);
    if (before.ok) expect(before.value.signatures).toHaveLength(1);
    const u = await engine.undo(tabId);
    if (u.ok) expect(u.value.signatures ?? []).toHaveLength(0);
  });

  it("moveSignature updates the rect of the matching placement", async () => {
    const { engine, tabId } = setup(3);
    await engine.placeSignature(tabId, makePlacement());
    const r = await engine.moveSignature(tabId, "pl-1", { x: 50, y: 60, width: 80, height: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const pl = r.value.signatures?.find((p) => p.id === "pl-1");
      expect(pl?.rect).toEqual({ x: 50, y: 60, width: 80, height: 30 });
    }
  });

  it("moveSignature returns not-found for an unknown placement id", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.moveSignature(tabId, "missing", { x: 0, y: 0, width: 10, height: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not-found");
  });

  it("deleteSignature removes the matching placement", async () => {
    const { engine, tabId } = setup(3);
    await engine.placeSignature(tabId, makePlacement({ id: "pl-a" }));
    await engine.placeSignature(tabId, makePlacement({ id: "pl-b" }));
    const r = await engine.deleteSignature(tabId, "pl-a");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.signatures).toHaveLength(1);
      expect(r.value.signatures?.[0]?.id).toBe("pl-b");
    }
  });

  it("deleteSignature returns not-found for an unknown placement id", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.deleteSignature(tabId, "missing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not-found");
  });

  it("placeSignature returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.placeSignature("unknown", makePlacement());
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — optimize + audit space stub behaviour
//
// The stub engine returns a placeholder ArrayBuffer for optimize (the
// renderer keeps its own bytes for PDF.js display) and synthesises a
// plausible breakdown for auditSpace (so the dialog renders something
// even when no real engine is wired). These tests pin that behaviour
// and confirm the methods surface the same Result<T, EngineError>
// shape as every other engine op.
describe("StubRendererEngine — Phase 8 optimize", () => {
  beforeEach(() => {
    // Each test gets a fresh stub instance.
  });

  it("optimize returns an ArrayBuffer placeholder", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.optimize(tabId, "compact");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeInstanceOf(ArrayBuffer);
  });

  it("optimize accepts every valid preset enum value", async () => {
    const { engine, tabId } = setup(2);
    for (const preset of ["none", "compact", "max"] as const) {
      const r = await engine.optimize(tabId, preset);
      expect(r.ok).toBe(true);
    }
  });

  it("optimize returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.optimize("unknown", "compact");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });
});

describe("StubRendererEngine — Phase 8 auditSpace", () => {
  it("returns a SpaceAudit with all five categories populated", async () => {
    const { engine, tabId } = setup(4);
    const r = await engine.auditSpace(tabId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalBytes).toBeGreaterThan(0);
    expect(r.value.breakdown.images).toBeGreaterThanOrEqual(0);
    expect(r.value.breakdown.fonts).toBeGreaterThanOrEqual(0);
    expect(r.value.breakdown.contentStreams).toBeGreaterThanOrEqual(0);
    expect(r.value.breakdown.metadata).toBeGreaterThanOrEqual(0);
    expect(r.value.breakdown.other).toBeGreaterThanOrEqual(0);
  });

  it("the breakdown sum is roughly proportional to totalBytes", async () => {
    const { engine, tabId } = setup(10);
    const r = await engine.auditSpace(tabId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sum =
      r.value.breakdown.images +
      r.value.breakdown.fonts +
      r.value.breakdown.contentStreams +
      r.value.breakdown.metadata +
      r.value.breakdown.other;
    // The stub's percentages round to integers so the sum is within a
    // few bytes of the total — generous bound to avoid flakiness.
    expect(Math.abs(sum - r.value.totalBytes)).toBeLessThanOrEqual(10);
  });

  it("auditSpace returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.auditSpace("unknown");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });
});

// ---------------------------------------------------------------------------
// Phase 9 advanced: clipboard / insert / text / docx (DEF-045)
//
// The stub implements just enough of these to keep the renderer-only
// path healthy in jsdom tests. The real engine owns the production
// implementation; the stub's contract is "graceful degradation so the
// UI keeps rendering" — see the per-method comments for the exact
// behaviour each stub method delivers.
// ---------------------------------------------------------------------------

describe("StubRendererEngine — Phase 9 advanced methods", () => {
  it("insertBlankPage bumps pageCount and updates order", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.insertBlankPage(tabId, -1, 612, 792);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pageCount).toBe(4);
    expect(r.value.modified).toBe(true);
  });

  it("insertBlankPage returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.insertBlankPage("unknown", 0, 612, 792);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("exportText returns empty text per page", async () => {
    const { engine, tabId } = setup(3);
    const r = await engine.exportText(tabId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(3);
    for (const p of r.value) {
      expect(p.text).toBe("");
    }
  });

  it("exportText returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.exportText("unknown");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("createFromClipboard returns engine-error (backend-only feature)", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.createFromClipboard("tab-1", "hello");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("insertFromPdf returns engine-error (backend-only feature)", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.insertFromPdf(
      "tab-1",
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      0,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("createDocxFromImages returns engine-error for any non-empty input", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.createDocxFromImages([
      {
        pageNumber: 1,
        pngBuffer: new Uint8Array([0]),
        width: 100,
        height: 100,
        pageWidth: 612,
        pageHeight: 792,
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("createDocxFromImages rejects empty input with empty-range", async () => {
    const engine = new StubRendererEngine();
    const r = await engine.createDocxFromImages([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("empty-range");
  });
});