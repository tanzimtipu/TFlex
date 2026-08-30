// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Mock the `pdfjs-dist` module so the OCR rasterizer can be exercised
// in jsdom without a real worker / canvas backend. The fake doc tracks
// every `destroy()` call so we can assert the rasterizer doesn't tear
// down the session document — the regression the DEF-050 fix targets.
const destroyCalls: number[] = [];
const pageCleanups: number[] = [];

interface FakePageProxy {
  pageNumber: number;
  getViewport: (args: { scale: number }) => { width: number; height: number };
  render: (args: unknown) => { promise: Promise<void> };
  cleanup: () => void;
}

interface FakeDocProxy {
  numPages: number;
  getPage: (n: number) => Promise<FakePageProxy>;
  destroy: () => Promise<void>;
}

const fakeDoc: FakeDocProxy = {
  numPages: 6,
  async getPage(n: number): Promise<FakePageProxy> {
    return {
      pageNumber: n,
      getViewport: (_args): { width: number; height: number } => ({
        width: 612,
        height: 792,
      }),
      render: (_args): { promise: Promise<void> } => ({
        promise: Promise.resolve(),
      }),
      cleanup: (): void => {
        pageCleanups.push(n);
      },
    };
  },
  async destroy(): Promise<void> {
    destroyCalls.push(Date.now());
  },
};

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
}));

// jsdom's HTMLCanvasElement.getContext returns null (no canvas
// backend), and its toBlob is a no-op. Patch both so the rasterizer's
// rasterize path runs end-to-end with a tiny PNG blob.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (typeof HTMLCanvasElement !== "undefined") {
  const fakeCtx = {
    fillStyle: "",
    fillRect: (): void => undefined,
  };
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
    toBlob: (cb: (b: Blob | null) => void) => void;
  }).getContext = function getContext(_type: string): unknown {
    return fakeCtx;
  };
  (HTMLCanvasElement.prototype as unknown as {
    toBlob: (cb: (b: Blob | null) => void) => void;
  }).toBlob = function toBlob(cb: (b: Blob | null) => void): void {
    cb(new Blob([PNG_BYTES], { type: "image/png" }));
  };
}

import { rasterizePagesForOcr } from "../../../src/renderer/pdf/ocrRasterize";

describe("ocrRasterize — DEF-050 regression guard", () => {
  it("does not destroy the pdf.js document while rasterizing pages", async () => {
    destroyCalls.length = 0;
    pageCleanups.length = 0;
    await rasterizePagesForOcr({
      // Cast to the structural pdf.js shape the rasterizer uses.
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [1, 2, 3, 4, 5, 6],
      dpi: 150,
    });
    expect(destroyCalls.length).toBe(0);
    // Each page should still be cleaned up — that's the per-page
    // resource release that keeps the worker cache bounded. We don't
    // want the regression fix to drop the cleanup hook.
    expect(pageCleanups.length).toBe(6);
  });

  it("does not destroy the doc when an AbortSignal fires mid-run", async () => {
    destroyCalls.length = 0;
    pageCleanups.length = 0;
    const ac = new AbortController();
    ac.abort();
    // Aborting before any page renders: the loop's first check should
    // throw "aborted" without ever calling getPage/destroy.
    await expect(
      rasterizePagesForOcr({
        doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
        pages: [1, 2, 3],
        dpi: 150,
        signal: ac.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(destroyCalls.length).toBe(0);
  });
});