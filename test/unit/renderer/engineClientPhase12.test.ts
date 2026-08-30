// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import type { EngineError } from "../../../src/shared/types";

/**
 * Phase 12 — engineClient adapter tests for the new Phase 12
 * methods.
 *
 * The renderer adapter should:
 *   - Forward replacePages / renumberPages / cropPages / addStamp
 *     / exportFdf / importFdf calls verbatim to the underlying
 *     real engine when present.
 *   - Degrade with a friendly `engine-error` when the underlying
 *     engine doesn't expose the methods (pre-Phase-12 backend).
 */

interface FakeEngine {
  replacePages?: (
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: EngineError }>;
  renumberPages?: (
    docId: string,
    labels: unknown[],
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: EngineError }>;
  cropPages?: (
    docId: string,
    entries: unknown[],
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: EngineError }>;
  addStamp?: (
    docId: string,
    payload: unknown,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: EngineError }>;
  exportFdf?: (
    docId: string,
  ) => Promise<{ ok: true; value: ArrayBuffer } | { ok: false; error: EngineError }>;
  importFdf?: (
    docId: string,
    fdfBytes: Uint8Array,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: EngineError }>;
}

function withEngine(engine: FakeEngine): void {
  (window as unknown as { tflex: { engine: FakeEngine } }).tflex = {
    engine,
  };
  _resetEngineForTests();
}

afterEach(() => {
  delete (window as unknown as { tflex?: unknown }).tflex;
  _resetEngineForTests();
});

describe("engineClient — Phase 12 adapter methods", () => {
  describe("when the underlying engine exposes Phase 12", () => {
    let captured: {
      replacePages: unknown[];
      renumberPages: unknown[];
      cropPages: unknown[];
      addStamp: unknown[];
      exportFdf: unknown[];
      importFdf: unknown[];
    };
    let engine: FakeEngine;

    beforeEach(() => {
      captured = {
        replacePages: [],
        renumberPages: [],
        cropPages: [],
        addStamp: [],
        exportFdf: [],
        importFdf: [],
      };
      engine = {
        replacePages: vi.fn(async (_docId, bytes, range) => {
          captured.replacePages.push({ bytes, range });
          return { ok: true as const, value: { pageCount: 3 } };
        }) as unknown as FakeEngine["replacePages"],
        renumberPages: vi.fn(async (_docId, labels) => {
          captured.renumberPages.push(labels);
          return { ok: true as const, value: { pageLabels: labels } };
        }) as unknown as FakeEngine["renumberPages"],
        cropPages: vi.fn(async (_docId, entries) => {
          captured.cropPages.push(entries);
          return { ok: true as const, value: { pageCount: 3 } };
        }) as unknown as FakeEngine["cropPages"],
        addStamp: vi.fn(async (_docId, payload) => {
          captured.addStamp.push(payload);
          return { ok: true as const, value: { pageCount: 3 } };
        }) as unknown as FakeEngine["addStamp"],
        exportFdf: vi.fn(async () => {
          captured.exportFdf.push("exportFdf");
          return { ok: true as const, value: new ArrayBuffer(0) };
        }) as unknown as FakeEngine["exportFdf"],
        importFdf: vi.fn(async (_docId, fdfBytes) => {
          captured.importFdf.push(fdfBytes);
          return { ok: true as const, value: { pageCount: 3 } };
        }) as unknown as FakeEngine["importFdf"],
      };
      withEngine(engine);
    });

    it("replacePages forwards the docId, bytes, and range", async () => {
      const e = getEngine();
      const bytes = new Uint8Array([1, 2, 3]);
      const r = await e.replacePages?.("doc-1", bytes, [1, 3]);
      expect(r?.ok).toBe(true);
      expect(captured.replacePages).toEqual([{ bytes, range: [1, 3] }]);
    });

    it("renumberPages forwards labels verbatim", async () => {
      const e = getEngine();
      const labels = [{ page: 1, label: "i" }];
      const r = await e.renumberPages?.("doc-1", labels);
      expect(r?.ok).toBe(true);
      expect(captured.renumberPages).toEqual([labels]);
    });

    it("cropPages forwards entries verbatim", async () => {
      const e = getEngine();
      const entries = [{ page: 1, box: { x: 0, y: 0, width: 100, height: 100 } }];
      const r = await e.cropPages?.("doc-1", entries);
      expect(r?.ok).toBe(true);
      expect(captured.cropPages).toEqual([entries]);
    });

    it("addStamp forwards the payload verbatim", async () => {
      const e = getEngine();
      const png = new Uint8Array([0x89, 0x50]);
      const r = await e.addStamp?.("doc-1", {
        page: 1,
        rect: { x: 0, y: 0, width: 100, height: 50 },
        stampId: "APPROVED",
        name: "APPROVED",
        pngBytes: png,
      });
      expect(r?.ok).toBe(true);
      expect(captured.addStamp.length).toBe(1);
      expect((captured.addStamp[0] as { stampId: string }).stampId).toBe("APPROVED");
    });

    it("exportFdf returns an ArrayBuffer", async () => {
      const e = getEngine();
      const r = await e.exportFdf?.("doc-1");
      expect(r?.ok).toBe(true);
      expect(r?.ok && r.value).toBeInstanceOf(ArrayBuffer);
    });

    it("importFdf forwards the bytes", async () => {
      const e = getEngine();
      const fdf = new Uint8Array([0x25, 0x25, 0x46, 0x44, 0x46]);
      const r = await e.importFdf?.("doc-1", fdf);
      expect(r?.ok).toBe(true);
      expect(captured.importFdf).toEqual([fdf]);
    });
  });

  describe("when the underlying engine predates Phase 12", () => {
    beforeEach(() => {
      withEngine({}); // no Phase 12 methods
    });

    it("replacePages degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.replacePages?.("doc-1", new Uint8Array([1]), [0, 0]);
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });

    it("renumberPages degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.renumberPages?.("doc-1", []);
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });

    it("cropPages degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.cropPages?.("doc-1", []);
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });

    it("addStamp degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.addStamp?.("doc-1", {
        page: 1,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        stampId: "APPROVED",
        name: "APPROVED",
        pngBytes: new Uint8Array([1]),
      });
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });

    it("exportFdf degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.exportFdf?.("doc-1");
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });

    it("importFdf degrades with engine-error", async () => {
      const e = getEngine();
      const r = await e.importFdf?.("doc-1", new Uint8Array([1]));
      expect(r?.ok).toBe(false);
      if (r?.ok) return;
      expect(r!.error.code).toBe("engine-error");
    });
  });
});