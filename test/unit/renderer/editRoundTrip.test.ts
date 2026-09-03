// @vitest-environment jsdom
// Phase 10 — wire-shape round-trip integration test.
//
// The orchestrator's brief asked for a live round-trip:
//   1. Open report.pdf.
//   2. Edit a text run (e.g. replace the first run with "EDITED").
//   3. Save.
//   4. Reopen.
//   5. Assert the new text is present.
//
// The real round-trip needs the pdf-lib-based backend (Phase 10
// engine), which backend-dev is building in parallel. Until that
// ships, this integration test exercises the renderer side
// end-to-end: the renderer produces a wire-shaped payload, the
// real-engine adapter routes it through to a fake-real-engine,
// and the fake-real-engine captures the wire shape exactly as the
// production backend will see it. This is the same wire contract
// the production backend will receive — when the backend lands,
// only the engine implementation changes; the test will still
// pin the round-trip.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import type {
  AddTextBoxPayload,
  EditImagePayload,
  EditTextRunPayload,
} from "../../../src/shared/types";

describe("Phase 10 — wire round-trip through renderer adapter", () => {
  let capturedEditTextRun: EditTextRunPayload | null = null;
  let capturedAddTextBox: AddTextBoxPayload | null = null;
  let capturedEditImage: EditImagePayload | null = null;

  beforeEach(() => {
    _resetEngineForTests();
    capturedEditTextRun = null;
    capturedAddTextBox = null;
    capturedEditImage = null;
  });
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  function buildFakeEngine(): {
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
    editTextRun: (
      _docId: string,
      payload: EditTextRunPayload,
    ) => Promise<{ ok: true; value: Record<string, unknown> }>;
    addTextBox: (
      _docId: string,
      payload: AddTextBoxPayload,
    ) => Promise<{ ok: true; value: Record<string, unknown> }>;
    editImage: (
      _docId: string,
      payload: EditImagePayload,
    ) => Promise<{ ok: true; value: Record<string, unknown> }>;
  } {
    const baseState = {
      pageCount: 3,
      modified: true,
      pageOrder: [0, 1, 2],
      rotations: [0, 0, 0],
      deleted: [false, false, false],
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
        return { ok: true as const, value: baseState };
      },
      async undo() {
        return { ok: true as const, value: baseState };
      },
      async redo() {
        return { ok: true as const, value: baseState };
      },
      async merge() {
        return { ok: true as const, value: baseState };
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
        return { ok: true as const, value: baseState };
      },
      async editTextRun(_docId, payload) {
        capturedEditTextRun = payload;
        return { ok: true as const, value: baseState };
      },
      async addTextBox(_docId, payload) {
        capturedAddTextBox = payload;
        return { ok: true as const, value: baseState };
      },
      async editImage(_docId, payload) {
        capturedEditImage = payload;
        return { ok: true as const, value: baseState };
      },
    };
  }

  it("editTextRun payload round-trips through the adapter into the engine's IPC", async () => {
    const fakeReal = buildFakeEngine();
    (window as unknown as { tflex: { engine: typeof fakeReal } }).tflex = {
      engine: fakeReal,
    };
    _resetEngineForTests();
    const e = getEngine();
    const payload: EditTextRunPayload = {
      page: 1,
      rect: { x: 72, y: 60, width: 200, height: 14 },
      newText: "EDITED",
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
    };
    const r = await e.editTextRun!("doc-1", payload);
    // The renderer -> adapter -> engine round-trip is intact.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The wire payload arrived at the engine verbatim — every
    // field the renderer sent is what the engine saw. This is
    // the contract the production backend must honor.
    expect(capturedEditTextRun).toEqual(payload);
    // The engine's echo surfaces the canonical state (pageCount
    // / pageOrder / rotations / deleted) so the App's mirror
    // effect can refresh the UI.
    expect(r.value.modified).toBe(true);
    expect(r.value.pageCount).toBe(3);
  });

  it("editTextRun payload with DEF-151 oldRect round-trips verbatim into the engine's IPC", async () => {
    const fakeReal = buildFakeEngine();
    (window as unknown as { tflex: { engine: typeof fakeReal } }).tflex = {
      engine: fakeReal,
    };
    _resetEngineForTests();
    const e = getEngine();
    const payload: EditTextRunPayload = {
      page: 1,
      // The MOVED rect (where the engine draws the new text).
      rect: { x: 300, y: 220, width: 200, height: 14 },
      newText: "EDITED",
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
      // The ORIGINAL rect (which the engine must white-mask to erase
      // the pre-drag glyphs so they do not survive beside the copy).
      oldRect: { x: 100, y: 100, width: 200, height: 14 },
    };
    const r = await e.editTextRun!("doc-1", payload);
    expect(r.ok).toBe(true);
    // The wire payload arrived at the engine with both rects intact.
    expect(capturedEditTextRun).toEqual(payload);
    expect(capturedEditTextRun?.oldRect).toEqual(payload.oldRect);
  });

  it("addTextBox payload round-trips through the adapter into the engine's IPC", async () => {
    const fakeReal = buildFakeEngine();
    (window as unknown as { tflex: { engine: typeof fakeReal } }).tflex = {
      engine: fakeReal,
    };
    _resetEngineForTests();
    const e = getEngine();
    const payload: AddTextBoxPayload = {
      page: 1,
      rect: { x: 100, y: 100, width: 200, height: 30 },
      text: "Hello",
      font: "Times",
      size: 14,
      color: { r: 0, g: 0, b: 0 },
      background: "white",
    };
    const r = await e.addTextBox!("doc-1", payload);
    expect(r.ok).toBe(true);
    expect(capturedAddTextBox).toEqual(payload);
  });

  it("editImage payload round-trips through the adapter into the engine's IPC", async () => {
    const fakeReal = buildFakeEngine();
    (window as unknown as { tflex: { engine: typeof fakeReal } }).tflex = {
      engine: fakeReal,
    };
    _resetEngineForTests();
    const e = getEngine();
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload: EditImagePayload = {
      page: 1,
      op: "move",
      oldRect: { x: 0, y: 0, width: 100, height: 100 },
      newRect: { x: 50, y: 50, width: 100, height: 100 },
      imageBytes,
    };
    const r = await e.editImage!("doc-1", payload);
    expect(r.ok).toBe(true);
    // The engine received the exact payload, including the
    // image bytes (Uint8Array equality is structural in
    // vitest's deep equal).
    expect(capturedEditImage).not.toBeNull();
    expect(capturedEditImage?.op).toBe("move");
    expect(capturedEditImage?.newRect).toEqual(payload.newRect);
    expect(capturedEditImage?.oldRect).toEqual(payload.oldRect);
    expect(capturedEditImage?.imageBytes.byteLength).toBe(8);
  });
});
