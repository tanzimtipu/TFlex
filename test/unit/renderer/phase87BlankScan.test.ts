// @vitest-environment jsdom
// Phase 87 (FEA-039) — renderer blank-page scan helper + engine client wiring.
//
// The scan is exercised with an INJECTED rasterizer (no pdf.js worker starts);
// the adapter is exercised against a minimal fake inner engine, mirroring
// test/unit/renderer/engineClientMovePagesBetweenDocs.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import {
  formatScanReport,
  scanBlankDocument,
  type BlankPagePixels,
} from "../../../src/renderer/pdf/blankScan";
import {
  _resetEngineForTests,
  getEngine,
} from "../../../src/renderer/engine/engineClient";
import { stubRendererEngine } from "../../../src/renderer/engine/stubEngine";

/** A doc stub with only the member `scanBlankDocument` reads. */
function fakeDoc(numPages: number): { numPages: number } {
  return { numPages };
}

function solid(page: number, value: number, size = 4): BlankPagePixels {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  return { page, width: size, height: size, pixels };
}

describe("scanBlankDocument", () => {
  it("measures an all-white page as zero coverage", async () => {
    const out = await scanBlankDocument({
      doc: fakeDoc(1) as never,
      dpi: 72,
      threshold: 0.005,
      rasterize: async ({ page }) => solid(page, 255),
    });
    expect(out).toEqual([{ page: 1, coverage: 0 }]);
  });

  it("measures an all-black page as full coverage", async () => {
    const out = await scanBlankDocument({
      doc: fakeDoc(1) as never,
      dpi: 72,
      threshold: 0.005,
      rasterize: async ({ page }) => solid(page, 0),
    });
    expect(out).toHaveLength(1);
    expect(out[0].page).toBe(1);
    expect(out[0].coverage).toBeCloseTo(1, 5);
  });

  it("records a failed page with null coverage and keeps the rest", async () => {
    const seen: number[] = [];
    const out = await scanBlankDocument({
      doc: fakeDoc(3) as never,
      dpi: 72,
      threshold: 0.005,
      onProgress: (page) => seen.push(page),
      rasterize: async ({ page }) => {
        if (page === 2) throw new Error("boom");
        return solid(page, 255);
      },
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(out).toEqual([
      { page: 1, coverage: 0 },
      { page: 2, coverage: null, reason: "boom" },
      { page: 3, coverage: 0 },
    ]);
  });
});

describe("formatScanReport", () => {
  it("summarises removed/skipped/unclassified and lists unclassified pages", () => {
    const report = formatScanReport([1, 2], [], [{ page: 3, reason: "boom" }]);
    expect(report).toContain("Removed 2");
    expect(report).toContain("Page 3: boom");
  });

  it("returns a non-empty line when nothing is unclassified", () => {
    const report = formatScanReport([1], [], []);
    expect(report.length).toBeGreaterThan(0);
    expect(report).toContain("Removed 1 page");
  });
});

interface WireState {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
}

function wireState(overrides: Partial<WireState> = {}): WireState {
  return {
    pageCount: 3,
    modified: true,
    pageOrder: [0, 1, 2],
    rotations: [0, 0, 0],
    deleted: [false, false, false],
    ...overrides,
  };
}

function install(engine: Record<string, unknown>): void {
  (window as unknown as { tflex: { engine: Record<string, unknown> } }).tflex = {
    engine,
  };
  _resetEngineForTests();
}

describe("engineClient.removeBlankPages", () => {
  afterEach(() => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    _resetEngineForTests();
  });

  it("degrades with an engine-error mentioning Phase 87 when unsupported", async () => {
    install({ available: true });
    const r = await getEngine().removeBlankPages?.("doc", { pages: [1] });
    expect(r?.ok).toBe(false);
    if (r === undefined || r.ok) return;
    expect(r.error.code).toBe("engine-error");
    expect(r.error.message).toContain("Phase 87");
  });

  it("normalizes and caches the returned state", async () => {
    install({
      available: true,
      async removeBlankPages() {
        return {
          ok: true as const,
          value: { state: wireState(), removed: [1], skipped: [] },
        };
      },
    });
    const e = getEngine();
    const r = await e.removeBlankPages?.("doc", { pages: [1] });
    expect(r?.ok).toBe(true);
    if (r === undefined || !r.ok) return;
    expect(r.value.removed).toEqual([1]);
    expect(r.value.state.pageCount).toBe(3);
    const cached = e.peekLastState?.("doc");
    expect(cached).toBe(r.value.state);
    expect((cached as { annotations?: unknown }).annotations).toEqual([]);
  });
});

describe("stubEngine.removeBlankPages", () => {
  it("refuses an empty page list", async () => {
    const state = stubRendererEngine.registerTab("s1", 3);
    expect(state.pageCount).toBe(3);
    const r = await stubRendererEngine.removeBlankPages("s1", { pages: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("empty-range");
  });
});
