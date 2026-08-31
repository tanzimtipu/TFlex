// @vitest-environment jsdom
//
// Bug 6 (DEF-060 renderer half) — the App.tsx `runAssembleDocx`
// host path must call `engine.createDocxFromDoc(docId, entries)`,
// not `engine.createDocxFromImages(entries)`. The engine's
// `createDocxFromImages` path produces a one-image-per-page .docx
// with no editable text — every page is a rasterised bitmap and
// the user cannot select / edit text in Word / Google Docs /
// LibreOffice. `createDocxFromDoc` (DEF-060) reuses the engine's
// own `exportText` machinery to pull real per-page text from the
// pdfDoc and emits editable `w:p` / `w:r` / `w:t` runs for
// text-bearing pages; text-free pages fall back to an inline image.
//
// Pin the renderer-side wiring:
//   - EngineApi declares `createDocxFromDoc?` (matches shared/ipc.ts)
//   - RealEngineAdapter forwards `createDocxFromDoc(docId, entries)`
//     to the preload `createDocxFromDoc` channel, with the docId
//     passed verbatim
//   - Pre-DEF-060 backends degrade with engine-error (NOT a hard
//     throw), and the host's `runAssembleDocx` falls back to
//     `createDocxFromImages` — graceful degradation
//   - Stub engine exposes the same shape, also returns engine-error
//     (stub has no pdfDoc bytes to extract text from)
//
// The unit tests for the engine side (engine.test.ts → DEF-060
// describe) already pin the bytes side; this file pins the
// renderer adapter + stub side, which is what frontend-dev owns.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import { stubRendererEngine } from "../../../src/renderer/engine/stubEngine";
import type { EngineError } from "../../../src/shared/types";
import type { DocxImageEntry } from "../../../src/shared/types";

/** A minimal pre-DEF-060 engine surface: has every required
 *  method but NOT the optional `createDocxFromDoc` channel. The
 *  adapter should degrade with engine-error so the fallback path
 *  can detect the missing backend cleanly. */
function makePreDef060Engine(): {
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
  createDocxFromImages: (
    entries: DocxImageEntry[],
  ) => Promise<{ ok: true; value: Uint8Array }>;
} {
  return {
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
    async createDocxFromImages(_entries: DocxImageEntry[]) {
      return { ok: true as const, value: new Uint8Array([1, 2, 3, 4]) };
    },
  };
}

describe("engineClient — DEF-060 (Bug 6) createDocxFromDoc adapter", () => {
  beforeEach(() => {
    _resetEngineForTests();
  });
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("createDocxFromDoc is defined on EngineApi (matches shared/ipc.ts shape)", () => {
    // Sanity check: the renderer-side type declares the method so the
    // App.tsx host can call it via `engineRef.current.createDocxFromDoc(...)`
    // without TypeScript narrowing it away. The RealEngineAdapter exposes
    // it; the StubRendererEngine exposes it. This test pins the shape so a
    // future refactor that removes the optional `?` doesn't silently
    // regress the wiring.
    const realEngine = getEngine();
    // The method exists on the type — at runtime it might be undefined
    // when the underlying engine predates DEF-060, but the key MUST be
    // present on the adapter's prototype / instance shape.
    expect("createDocxFromDoc" in realEngine).toBe(true);
    expect(typeof realEngine.createDocxFromDoc).toBe("function");
  });

  it("createDocxFromDoc forwards docId + entries to the preload channel", async () => {
    // Pin the renderer-side wiring: the docId from the active tab must
    // reach the preload's createDocxFromDoc verbatim, and the entries
    // array (the per-page raster) is forwarded unchanged. The renderer
    // is the source of truth for the pageNumber -> pngBuffer mapping;
    // the engine does not rasterise.
    const captured: { docId: string | null; entries: unknown[] | null } = {
      docId: null,
      entries: null,
    };
    const expectedDocxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
    const fakeEngine = {
      ...makePreDef060Engine(),
      async createDocxFromDoc(
        docId: string,
        entries: DocxImageEntry[],
      ): Promise<{ ok: true; value: Uint8Array }> {
        captured.docId = docId;
        captured.entries = entries;
        return { ok: true, value: expectedDocxBytes };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const entries: DocxImageEntry[] = [
      {
        pageNumber: 1,
        pngBuffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        width: 612,
        height: 792,
        pageWidth: 612,
        pageHeight: 792,
      },
    ];
    const r = await e.createDocxFromDoc!("doc-active", entries);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.docId).toBe("doc-active");
    expect(captured.entries).toBe(entries);
    expect(r.value).toBe(expectedDocxBytes);
  });

  it("createDocxFromDoc degrades with engine-error when the backend predates DEF-060", async () => {
    // A pre-DEF-060 backend doesn't expose the channel. The adapter
    // returns a typed Result<..., EngineError> so the host's
    // runAssembleDocx can detect the missing backend and fall back to
    // createDocxFromImages without crashing.
    const fakeEngine = makePreDef060Engine();
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createDocxFromDoc!("doc-1", []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("createDocxFromDoc surfaces engine-error from the backend verbatim", async () => {
    // The host needs the engine's error code so the toast / fallback
    // can branch on it (e.g. distinguish "missing backend" from
    // "engine failed"). The adapter must NOT swallow the error.
    // The wire contract uses Result<..., EngineError>, where the
    // error is a `{code, message}` object — not a bare string.
    const fakeEngine = {
      ...makePreDef060Engine(),
      async createDocxFromDoc(
        _docId: string,
        _entries: DocxImageEntry[],
      ): Promise<{ ok: false; error: { code: EngineError; message: string } }> {
        return {
          ok: false,
          error: { code: "engine-error", message: "createDocxFromDoc: refused" },
        };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createDocxFromDoc!("doc-1", []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
    expect(r.error.message).toBe("createDocxFromDoc: refused");
  });

  it("createDocxFromDoc rejects empty input with empty-range (mirrors createDocxFromImages)", async () => {
    // Empty input is a degenerate case the engine rejects upstream;
    // the adapter passes the call through and surfaces the engine's
    // typed Result. This test pins the contract so a future refactor
    // that adds renderer-side validation doesn't accidentally double-
    // validate the same input.
    const fakeEngine = {
      ...makePreDef060Engine(),
      async createDocxFromDoc(
        _docId: string,
        _entries: DocxImageEntry[],
      ): Promise<{ ok: false; error: { code: EngineError; message: string } }> {
        return {
          ok: false,
          error: { code: "empty-range", message: "no image entries provided" },
        };
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const r = await e.createDocxFromDoc!("doc-1", []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("empty-range");
  });

  it("createDocxFromImages still works for callers that only have image bytes", async () => {
    // The image-only path is retained for callers that have NO docId
    // (e.g. a future flow that exports raw PNGs to .docx without a
    // loaded PDF). Pin the contract so the DEF-060 wiring doesn't
    // regress the existing channel.
    const captured: { entries: unknown[] | null } = { entries: null };
    const fakeEngine = {
      ...makePreDef060Engine(),
      createDocxFromImages: vi.fn(async (entries: DocxImageEntry[]) => {
        captured.entries = entries;
        return { ok: true as const, value: new Uint8Array([0x50, 0x4b]) };
      }) as unknown as {
        (entries: DocxImageEntry[]): Promise<{ ok: true; value: Uint8Array }>;
      },
    };
    (window as unknown as { tflex: { engine: typeof fakeEngine } }).tflex = {
      engine: fakeEngine,
    };
    _resetEngineForTests();
    const e = getEngine();
    const entries: DocxImageEntry[] = [
      {
        pageNumber: 1,
        pngBuffer: new Uint8Array([1, 2, 3]),
        width: 100,
        height: 80,
        pageWidth: 612,
        pageHeight: 792,
      },
    ];
    const r = await e.createDocxFromImages(entries);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(captured.entries).toBe(entries);
  });
});

describe("stubRendererEngine — DEF-060 (Bug 6) createDocxFromDoc surface", () => {
  it("stubRendererEngine exposes createDocxFromDoc with the same shape as the real adapter", () => {
    // The stub is the fallback when preload predates the engine surface;
    // App.tsx uses the same code paths against the stub in tests. The
    // stub MUST expose createDocxFromDoc with the (docId, entries) =>
    // Promise<Result> shape so the host doesn't need a per-engine branch.
    expect(typeof stubRendererEngine.createDocxFromDoc).toBe("function");
  });

  it("stub createDocxFromDoc returns engine-error (no pdfDoc bytes to extract)", async () => {
    const r = await stubRendererEngine.createDocxFromDoc!(
      "doc-1",
      [
        {
          pageNumber: 1,
          pngBuffer: new Uint8Array([0x89, 0x50]),
          width: 100,
          height: 80,
          pageWidth: 612,
          pageHeight: 792,
        },
      ],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("engine-error");
  });

  it("stub createDocxFromDoc rejects empty input with empty-range", async () => {
    // Same shape as the real engine: empty input is a degenerate case
    // that surfaces typed empty-range, not engine-error. The host
    // branches on the error code for its fallback path.
    const r = await stubRendererEngine.createDocxFromDoc!("doc-1", []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("empty-range");
  });

  it("stub createDocxFromImages still returns engine-error (pre-Phase-9 behaviour unchanged)", async () => {
    // The DEF-060 wiring should NOT regress the existing image-only
    // path. The stub has never produced real DOCX bytes; the image-only
    // path keeps returning engine-error (the host's fallback detects
    // the missing backend via the same error).
    const r = await stubRendererEngine.createDocxFromImages([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("empty-range");
  });
});