// @vitest-environment jsdom
//
// Phase 30 chunk 2 follow-up — proves the print dialog's "include
// annotations" toggle actually reaches the pdf.js raster, and pins the
// module's other documented contracts (bounded scale, abort, progress).
//
// Harness mirrors `ocrRasterize.test.ts`: a fake `pdfjs-dist` module
// whose page proxies record every `render({...})` options object, plus a
// jsdom canvas patch (jsdom has no canvas backend).
import { describe, expect, it, vi } from "vitest";

// Records every `page.render({...})` options object so the tests can
// assert the `annotationMode` mapping and the scale pdf.js is handed.
const renderOptions: {
  annotationMode?: number;
  viewport: { scale: number; width: number; height: number };
}[] = [];
// Per-page cleanup calls (best-effort teardown must still happen).
const pageCleanups: number[] = [];
// Ordered progress log so we can assert one call per page, ascending.
const progressLog: number[] = [];

// Page geometry in PDF user-space points, 1-based. Page 1 is a normal
// US-Letter sheet; page 2 is deliberately huge so the max-pixel budget
// forces a downscale.
const pageSizes: { width: number; height: number }[] = [
  { width: 612, height: 792 },
  { width: 2000, height: 3000 },
  { width: 612, height: 792 },
];

const fakeDoc = {
  numPages: 3,
  async getPage(n: number) {
    const size = pageSizes[n - 1] ?? { width: 612, height: 792 };
    return {
      pageNumber: n,
      // Scale-aware, mirroring a real page proxy so the module's dpi/72
      // canvas math (and the bounded-scale clamp) is observable.
      getViewport: (args: { scale: number }) => ({
        scale: args.scale,
        width: size.width * args.scale,
        height: size.height * args.scale,
      }),
      render: (args: {
        annotationMode?: number;
        viewport: { scale: number; width: number; height: number };
      }): { promise: Promise<void> } => {
        renderOptions.push(args);
        return { promise: Promise.resolve() };
      },
      cleanup: (): void => {
        pageCleanups.push(n);
      },
    };
  },
};

// The factory must not read module-scope state at creation time — only
// lazily inside nested functions — because `vi.mock` is hoisted.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
}));

// jsdom's HTMLCanvasElement has no 2D backend and its toDataURL is a
// no-op. Patch both so the rasterize path runs end-to-end with a tiny
// PNG data URL.
if (typeof HTMLCanvasElement !== "undefined") {
  const fakeCtx = {
    fillStyle: "",
    fillRect: (): void => {
      /* opaque white page fill; geometry not asserted here */
    },
  };
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
  }).getContext = function getContext(_type: string): unknown {
    return fakeCtx;
  };
  (HTMLCanvasElement.prototype as unknown as {
    toDataURL: (type: string) => string;
  }).toDataURL = function toDataURL(_type: string): string {
    return "data:image/png;base64,iVBORw0KGgo=";
  };
}

import { AnnotationMode } from "pdfjs-dist";
import {
  boundedPrintScale,
  MAX_PRINT_PIXELS,
  PRINT_DPI,
  rasterizePagesForPrint,
} from "../../../src/renderer/pdf/printRaster";

/** Cast the structural fake to the pdf.js shape the module consumes. */
function asDoc(): Parameters<typeof rasterizePagesForPrint>[0]["doc"] {
  return fakeDoc as unknown as Parameters<typeof rasterizePagesForPrint>[0]["doc"];
}

describe("printRaster — annotations toggle reaches page.render", () => {
  it("maps includeAnnotations=true to AnnotationMode.ENABLE_STORAGE", async () => {
    renderOptions.length = 0;
    await rasterizePagesForPrint({
      doc: asDoc(),
      pages: [1],
      includeAnnotations: true,
    });
    expect(renderOptions.length).toBe(1);
    expect(renderOptions[0].annotationMode).toBe(AnnotationMode.ENABLE_STORAGE);
  });

  it("maps includeAnnotations=false to AnnotationMode.DISABLE", async () => {
    renderOptions.length = 0;
    await rasterizePagesForPrint({
      doc: asDoc(),
      pages: [1],
      includeAnnotations: false,
    });
    expect(renderOptions.length).toBe(1);
    expect(renderOptions[0].annotationMode).toBe(AnnotationMode.DISABLE);
  });
});
describe("printRaster � bounded-scale rule (MAX_PRINT_PIXELS)", () => {
  it("uses PRINT_DPI/72 for a normal page and clamps a huge page", () => {
    // Real constants: PRINT_DPI = 200, MAX_PRINT_PIXELS = 12_000_000.
    expect(PRINT_DPI).toBe(200);
    expect(MAX_PRINT_PIXELS).toBe(12_000_000);

    // US-Letter at the default DPI is ~1700 x 2200 px = ~3.74 MP, well
    // under budget, so no downscale is applied.
    const normal = boundedPrintScale(612, 792, PRINT_DPI);
    expect(normal).toBeCloseTo(PRINT_DPI / 72, 10);

    // 2000 x 3000 pt at 300 DPI would be ~8333 x 12500 px = ~104 MP,
    // over budget: the scale is reduced by sqrt(budget / area).
    const requested = 300 / 72;
    const huge = boundedPrintScale(2000, 3000, 300);
    expect(huge).toBeLessThan(requested);
    const expectedHuge = requested * Math.sqrt(MAX_PRINT_PIXELS / (2000 * requested * (3000 * requested)));
expect(huge).toBeCloseTo(expectedHuge, 10);
    // The clamped raster lands within the documented pixel budget. The
    // bound is exact in real arithmetic; sqrt introduces a float
    // epsilon, so allow a relative 1e-9 slack (observed: 12_000_000.000000002).
    expect((2000 * huge) * (3000 * huge)).toBeLessThanOrEqual(
      MAX_PRINT_PIXELS * (1 + 1e-9),
    );
  });

  it("passes the bounded scale to page.render for a huge page vs a normal one", async () => {
    renderOptions.length = 0;
    pageCleanups.length = 0;
    await rasterizePagesForPrint({
      doc: asDoc(),
      pages: [1, 2],
      includeAnnotations: true,
      dpi: 300,
    });
    expect(renderOptions.length).toBe(2);
    // Page 1 (612x792) is under budget: uninterrupted 300/72 scale.
    expect(renderOptions[0].viewport.scale).toBeCloseTo(300 / 72, 10);
    // Page 2 (2000x3000) is over budget: the render gets the clamped
    // scale from the module's own boundedPrintScale, not the raw 300/72.
    const clamped = boundedPrintScale(2000, 3000, 300);
    expect(renderOptions[1].viewport.scale).toBeCloseTo(clamped, 10);
    expect(renderOptions[1].viewport.scale).toBeLessThan(300 / 72);
expect(
      renderOptions[1].viewport.width * renderOptions[1].viewport.height,
    ).toBeLessThanOrEqual(MAX_PRINT_PIXELS * (1 + 1e-9));
    // Per-page cleanup still runs for both pages.
    expect(pageCleanups).toEqual([1, 2]);
  });
});

describe("printRaster � abort and progress", () => {
  it("rejects an already-aborted signal without producing any image", async () => {
    renderOptions.length = 0;
    progressLog.length = 0;
    const ac = new AbortController();
    ac.abort();
    await expect(
      rasterizePagesForPrint({
        doc: asDoc(),
        pages: [1, 2, 3],
        includeAnnotations: true,
        onProgress: (p) => progressLog.push(p),
        signal: ac.signal,
      }),
    ).rejects.toThrow("aborted");
    // The loop checks `signal.aborted` before the first page, so no
    // render and no progress event ever happens.
    expect(renderOptions.length).toBe(0);
    expect(progressLog).toEqual([]);
  });

  it("fires onProgress once per page, sequentially and ascending", async () => {
    progressLog.length = 0;
    renderOptions.length = 0;
    const images = await rasterizePagesForPrint({
      doc: asDoc(),
      pages: [1, 2, 3],
      includeAnnotations: true,
      onProgress: (p) => progressLog.push(p),
    });
    expect(progressLog).toEqual([1, 2, 3]);
    expect(images.map((i) => i.page)).toEqual([1, 2, 3]);
    expect(renderOptions.length).toBe(3);
  });
});
