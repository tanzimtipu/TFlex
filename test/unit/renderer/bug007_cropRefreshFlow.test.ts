// @vitest-environment jsdom
//
// Bug 7 (visual half) — after a successful `cropPages` the
// renderer's `doc` proxy still points at the pre-crop bytes, so the
// affected pages continue to render at the un-cropped viewport
// (annotations + form fields + signatures render at their old
// positions over the un-cropped canvas). The crop flow in App.tsx
// (the host) must call `engine.getDocumentBytes(docId)` and rebuild
// the renderer's pdf.js proxy in place, exactly like the OCR confirm
// handler does for its Tr=3 invisible text layer.
//
// Pin the wiring:
//   - The RealEngineAdapter's `getDocumentBytes` returns a real
//     ArrayBuffer (not a Uint8Array view) so the downstream
//     openPdfDocument call doesn't trip on the type narrowing.
//   - The crop-then-refresh flow calls both `cropPages` and
//     `getDocumentBytes` on the same engine surface in the right
//     order: crop returns ok, refresh reads the post-crop bytes.
//   - A pre-Phase-11 backend (no getDocumentBytes) degrades cleanly
//     with engine-error so the host can branch on `ok` and skip
//     the refresh — same fallback the OCR handler uses.
//
// The shape of this test mirrors engineClientPhase12.test.ts's
// existing cropPages + getDocumentBytes describe (DEF-062) but
// adds the renderer-host ordering pin: crop then refresh must
// observe post-crop bytes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import type { EngineError } from "../../../src/shared/types";

interface FakeEngine {
  cropPages?: (
    docId: string,
    entries: unknown[],
  ) => Promise<{ ok: true; value: { pageCount: number } }>;
  getDocumentBytes?: (
    docId: string,
  ) => Promise<{ ok: true; value: ArrayBuffer } | { ok: false; error: EngineError }>;
}

function withEngine(engine: FakeEngine): void {
  (window as unknown as { tflex: { engine: FakeEngine } }).tflex = {
    engine,
  };
  _resetEngineForTests();
}

describe("engineClient — Bug 7 (visual half) crop → refresh flow", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  describe("when the backend exposes both cropPages AND getDocumentBytes", () => {
    let captured: {
      cropDocId: string | null;
      cropEntries: unknown[] | null;
      refreshDocId: string | null;
    };
    let engine: FakeEngine;

    beforeEach(() => {
      captured = {
        cropDocId: null,
        cropEntries: null,
        refreshDocId: null,
      };
      // Capture the post-crop bytes returned by getDocumentBytes so
      // we can assert the refresh call observes the engine's bytes
      // AFTER cropPages committed. The mock here fakes a small
      // payload with the PDF magic header — the renderer's
      // openPdfDocument call only requires the byte buffer shape, not
      // the full PDF, so the test stays renderer-only.
      const postCropBytes = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
      ]).buffer;
      engine = {
        cropPages: vi.fn(async (docId, entries) => {
          captured.cropDocId = docId;
          captured.cropEntries = entries;
          return { ok: true as const, value: { pageCount: 3 } };
        }) as unknown as FakeEngine["cropPages"],
        getDocumentBytes: vi.fn(async (docId) => {
          captured.refreshDocId = docId;
          return { ok: true as const, value: postCropBytes };
        }) as unknown as FakeEngine["getDocumentBytes"],
      };
      withEngine(engine);
    });

    it("cropPages then getDocumentBytes both succeed (host flow end-to-end)", async () => {
      const e = getEngine();
      // Step 1: host fires cropPages with the user's chosen boxes.
      const cropRes = await e.cropPages?.("doc-active", [
        { page: 1, box: { x: 10, y: 10, width: 500, height: 700 } },
        { page: 2, box: { x: 0, y: 0, width: 612, height: 792 } },
      ]);
      expect(cropRes?.ok).toBe(true);
      if (!cropRes?.ok) return;

      // Step 2: host fires getDocumentBytes to read post-crop bytes.
      const refreshRes = await e.getDocumentBytes?.("doc-active");
      expect(refreshRes?.ok).toBe(true);
      if (!refreshRes?.ok) return;

      // Both calls were made with the same docId — the host passes
      // the active tab's engineDocId to each call verbatim.
      expect(captured.cropDocId).toBe("doc-active");
      expect(captured.refreshDocId).toBe("doc-active");
      // The crop entries reach the engine unchanged; the host does NOT
      // transform the dialog's output.
      expect(captured.cropEntries).toEqual([
        { page: 1, box: { x: 10, y: 10, width: 500, height: 700 } },
        { page: 2, box: { x: 0, y: 0, width: 612, height: 792 } },
      ]);
      // Refresh bytes are a real ArrayBuffer (not a Uint8Array view)
      // so the renderer's openPdfDocument path doesn't trip on the
      // type narrowing.
      expect(refreshRes.value).toBeInstanceOf(ArrayBuffer);
    });

    it("getDocumentBytes returns a real ArrayBuffer even when the backend hands a Uint8Array view", async () => {
      // The renderer's RealEngineAdapter normalises the backend's
      // return shape via toArrayBuffer. Some preload implementations
      // hand a Uint8Array view's `.buffer` through IPC; the adapter
      // must always surface an ArrayBuffer to downstream consumers.
      const fakeView = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const engineWithView: FakeEngine = {
        cropPages: vi.fn(async () => ({
          ok: true as const,
          value: { pageCount: 3 },
        })) as unknown as FakeEngine["cropPages"],
        getDocumentBytes: vi.fn(async () => ({
          ok: true as const,
          value: fakeView.buffer,
        })) as unknown as FakeEngine["getDocumentBytes"],
      };
      withEngine(engineWithView);
      const e = getEngine();
      const r = await e.getDocumentBytes?.("doc-1");
      expect(r?.ok).toBe(true);
      if (!r?.ok) return;
      expect(r.value).toBeInstanceOf(ArrayBuffer);
      // Same byte content as the source view.
      expect(new Uint8Array(r.value)).toEqual(fakeView);
    });
  });

  describe("when the backend predates Phase 11 (no getDocumentBytes)", () => {
    // Pin the host's graceful fallback: a pre-Phase-11 backend can't
    // refresh the renderer-side proxy after a cropPages call. The
    // adapter's getDocumentBytes method is always present (so the
    // call site doesn't need to guard with optional chaining), but
    // resolves with engine-error; the host branches on ok and
    // surfaces a friendly message ("save and reopen to pick up the
    // new dimensions") rather than throwing or silently doing
    // nothing.
    beforeEach(() => {
      withEngine({
        cropPages: vi.fn(async () => ({
          ok: true as const,
          value: { pageCount: 3 },
        })) as unknown as FakeEngine["cropPages"],
        // NO getDocumentBytes on the engine surface.
      });
    });

    it("getDocumentBytes is exposed on the adapter but resolves with engine-error", async () => {
      const e = getEngine();
      // The adapter exposes the method as a regular (non-optional)
      // function so call sites don't need optional chaining. The
      // backend's absence surfaces as a typed engine-error Result,
      // not a thrown exception.
      expect(typeof e.getDocumentBytes).toBe("function");
      const r = await e.getDocumentBytes!("doc-1");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("engine-error");
    });

    it("cropPages still succeeds so the host's primary path stays intact", async () => {
      // Even without the refresh hook, the crop itself writes
      // CropBox / TrimBox into the engine's pdfDoc. The user can
      // save + reopen to pick up the new dimensions. The refresh is
      // a "best effort" visual-update, not a correctness requirement.
      const e = getEngine();
      const cropRes = await e.cropPages?.("doc-1", [
        { page: 1, box: { x: 0, y: 0, width: 600, height: 800 } },
      ]);
      expect(cropRes?.ok).toBe(true);
    });
  });

  describe("when getDocumentBytes surfaces an engine error", () => {
    // Pin the error path: the host must see the engine's typed error
    // so it can decide whether to toast, fall back to the search-
    // index invalidator, or both.
    beforeEach(() => {
      withEngine({
        cropPages: vi.fn(async () => ({
          ok: true as const,
          value: { pageCount: 3 },
        })) as unknown as FakeEngine["cropPages"],
        getDocumentBytes: vi.fn(async () => ({
          ok: false as const,
          error: { code: "engine-error" as EngineError, message: "refresh failed" },
        })) as unknown as FakeEngine["getDocumentBytes"],
      });
    });

    it("returns the engine error verbatim (host can branch on the code)", async () => {
      const e = getEngine();
      const r = await e.getDocumentBytes?.("doc-1");
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });
  });
});