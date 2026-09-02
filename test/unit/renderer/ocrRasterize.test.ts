// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Mock the `pdfjs-dist` module so the OCR rasterizer can be exercised
// in jsdom without a real worker / canvas backend. The fake doc tracks
// every `destroy()` call so we can assert the rasterizer doesn't tear
// down the session document — the regression the DEF-050 fix targets.
const destroyCalls: number[] = [];
const pageCleanups: number[] = [];
// DEF-112 — records every `render({...})` options object so the tests can
// assert the OCR raster requests form-appearance rendering via the
// pdf.js 4.x `annotationMode` option.
const renderOptions: unknown[] = [];
// DEF-112 — records every `doc.annotationStorage.setValue(key, entry)`
// call so the tests can assert the renderer's form values are seeded
// with the per-kind shapes pdf.js 4.10.38 expects.
const storageSeeds: { id: string; entry: unknown }[] = [];
// DEF-112 — ordered log of `seed:<id>` vs `render` events so the tests
// can assert seeding happens BEFORE the page render.
const orderLog: string[] = [];
// DEF-112 — every `ctx.fillRect` call the rasterizer makes, so the tests
// can assert the widget border-erase pass (the fix that lets tesseract's
// full-page layout read "John Doe" from the bitmap) fires with the right
// geometry and only for fields on the page being rasterised.
const fillRects: { x: number; y: number; w: number; h: number }[] = [];

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
  annotationStorage: { setValue: (id: string, entry: unknown) => void };
  getFieldObjects: () => Promise<
    Record<string, { id: string; exportValues?: unknown }[]> | null
  >;
}

// DEF-112 — the field-object map the fake `getFieldObjects` returns.
// Tests that seed storage replace this with their fixture.
let fieldObjectsMap: Record<string, { id: string; exportValues?: unknown }[]> | null = null;

const fakeDoc: FakeDocProxy = {
  numPages: 6,
  async getPage(n: number): Promise<FakePageProxy> {
    return {
      pageNumber: n,
      getViewport: (args: { scale: number }): { width: number; height: number } => ({
        // Scale-aware so the rasterizer's dpi/72 canvas math (including
        // the DEF-112 border-erase page-height derivation) mirrors a real
        // page proxy instead of always reporting unscaled dimensions.
        width: 612 * args.scale,
        height: 792 * args.scale,
      }),
      render: (args): { promise: Promise<void> } => {
        renderOptions.push(args);
        orderLog.push("render");
        return { promise: Promise.resolve() };
      },
      cleanup: (): void => {
        pageCleanups.push(n);
      },
    };
  },
  annotationStorage: {
    setValue(id: string, entry: unknown): void {
      storageSeeds.push({ id, entry });
      orderLog.push(`seed:${id}`);
    },
  },
  async getFieldObjects() {
    return fieldObjectsMap;
  },
  async destroy(): Promise<void> {
    destroyCalls.push(Date.now());
  },
};

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
}));

// jsdom's HTMLCanvasElement.getContext returns null (no canvas
// backend), and its toBlob is a no-op. Patch both so the rasterizer's
// rasterize path runs end-to-end with a tiny PNG blob.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (typeof HTMLCanvasElement !== "undefined") {
  const fakeCtx = {
    fillStyle: "",
    fillRect: (x: number, y: number, w: number, h: number): void => {
      fillRects.push({ x, y, w, h });
    },
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

import { AnnotationMode } from "pdfjs-dist";
import {
  eraseFormFieldBorders,
  fieldDeviceRect,
  rasterizePagesForOcr,
  type OcrRasterizeFormField,
} from "../../../src/renderer/pdf/ocrRasterize";

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

describe("ocrRasterize — DEF-112 form values baked into the raster", () => {
  it("renders with annotationMode ENABLE_STORAGE so pdf.js draws widget appearances", async () => {
    renderOptions.length = 0;
    orderLog.length = 0;
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [2],
      dpi: 150,
    });
    // One render call for the rasterised page. pdf.js 4.x removed
    // `renderInteractiveForms` from `RenderParameters`; the 4.10.38
    // equivalent that regenerates widget appearances from the doc's
    // AnnotationStorage is `AnnotationMode.ENABLE_STORAGE`. Without
    // it pdf.js draws each widget's blank default appearance and the
    // OCR text layer misses values like "John Doe" typed into a form
    // field.
    expect(renderOptions.length).toBe(1);
    expect(renderOptions[0]).toMatchObject({
      annotationMode: AnnotationMode.ENABLE_STORAGE,
    });
  });

  it("seeds annotationStorage from renderer form values BEFORE the page render", async () => {
    renderOptions.length = 0;
    storageSeeds.length = 0;
    orderLog.length = 0;
    // The widget annotations the doc's /AcroForm actually carries.
    // The text/checkbox entries have no `exportValues`; the radio
    // group has one widget per option.
    fieldObjectsMap = {
      textFullName: [{ id: "10R" }],
      checkSigned: [{ id: "12R" }],
      radioChoice: [
        { id: "14R", exportValues: "A" },
        { id: "15R", exportValues: "B" },
      ],
    };
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [3],
      dpi: 150,
      formFields: [
        // In-session typed value — NOT pre-existing in the PDF widget
        // state — must be the value that reaches the renderer's
        // storage so tesseract sees "John Doe".
        { name: "textFullName", kind: "text", value: "John Doe" },
        { name: "checkSigned", kind: "checkbox", value: "true" },
        // Radio group: the group selection "B" must become per-widget
        // booleans (only the widget whose exportValue matches is on).
        { name: "radioChoice", kind: "radio", value: "B" },
      ],
    });
    // Per-kind value shapes are the ones the pdf.js 4.10.38 worker
    // reads: text -> string, checkbox -> boolean, radio -> boolean
    // matched against each widget's export value.
    expect(storageSeeds).toEqual([
      { id: "10R", entry: { value: "John Doe" } },
      { id: "12R", entry: { value: true } },
      { id: "14R", entry: { value: false } },
      { id: "15R", entry: { value: true } },
    ]);
    // Every seed must happen before the single render call — pdf.js
    // serialises AnnotationStorage at render time, so seeding after
    // would have no effect on the appearance.
    const renderIdx = orderLog.indexOf("render");
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    const seedEvents = orderLog.filter((e) => e.startsWith("seed:"));
    expect(seedEvents.length).toBe(4);
    for (const seed of seedEvents) {
      expect(orderLog.indexOf(seed)).toBeLessThan(renderIdx);
    }
  });

  it("seeds a dropdown's selected option value as a string", async () => {
    storageSeeds.length = 0;
    orderLog.length = 0;
    fieldObjectsMap = {
      salutation: [{ id: "20R" }],
    };
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [1],
      dpi: 150,
      formFields: [{ name: "salutation", kind: "dropdown", value: "Mr" }],
    });
    expect(storageSeeds).toEqual([{ id: "20R", entry: { value: "Mr" } }]);
  });

  it("skips seeding when a renderer field name has no widget annotation", async () => {
    storageSeeds.length = 0;
    fieldObjectsMap = {
      realField: [{ id: "30R" }],
    };
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [1],
      dpi: 150,
      // "ghost" does not exist in the doc's /AcroForm — the seed loop
      // must skip it (no crash, no stray storage entry).
      formFields: [{ name: "ghost", kind: "text", value: "x" }],
    });
    expect(storageSeeds).toEqual([]);
  });

  it("seeds nothing and still renders when getFieldObjects returns null", async () => {
    renderOptions.length = 0;
    storageSeeds.length = 0;
    fieldObjectsMap = null;
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [1],
      dpi: 150,
      formFields: [{ name: "textFullName", kind: "text", value: "John Doe" }],
    });
    // A PDF with no AcroForm (or one pdf.js can't enumerate) must not
    // fail the OCR run — the pages rasterise, just without seeded
    // field values.
    expect(storageSeeds).toEqual([]);
    expect(renderOptions.length).toBe(1);
  });
});

describe("ocrRasterize — DEF-112 widget border erase (tesseract readability)", () => {
  /** Fake 2D context that records fillRect calls. */
  function mockCtx(): {
    ctx: {
      fillStyle: string | CanvasGradient | CanvasPattern;
      fillRect: (x: number, y: number, w: number, h: number) => void;
    };
    calls: { x: number; y: number; w: number; h: number }[];
  } {
    const calls: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      fillStyle: "" as string | CanvasGradient | CanvasPattern,
      fillRect: (x: number, y: number, w: number, h: number): void => {
        calls.push({ x, y, w, h });
      },
    };
    return { ctx, calls };
  }

  /** Does any recorded fillRect cover the given cell (2x2 device px)? */
  function covers(
    calls: { x: number; y: number; w: number; h: number }[],
    cx: number,
    cy: number,
  ): boolean {
    return calls.some(
      (c) => cx >= c.x && cx < c.x + c.w && cy >= c.y && cy < c.y + c.h,
    );
  }

  /** The full white page fill that precedes any erase (0,0,W,H). */
  function pageFills(
    calls: { x: number; y: number; w: number; h: number }[],
  ): { x: number; y: number; w: number; h: number }[] {
    return calls.filter((c) => c.x === 0 && c.y === 0);
  }

  it("maps a bottom-origin field rect onto the canvas's top-left device space", () => {
    // Live-verified fixture: applicant_name on form.pdf reports
    // rect {x:149.5, y:694.5, w:201, h:21} on an 800pt page; the drawn
    // widget border lands at canvas rows 352..440 at 300 DPI.
    const d = fieldDeviceRect(
      { x: 149.5, y: 694.5, width: 201, height: 21 },
      800,
      300 / 72,
      2500,
      3333,
    );
    expect(d).not.toBeNull();
    expect(d).toEqual({ x0: 622, y0: 352, x1: 1461, y1: 440 });
  });

  it("erases only the perimeter bands of fields on the requested page", () => {
    const { ctx, calls } = mockCtx();
    const fields: OcrRasterizeFormField[] = [
      {
        name: "applicant_name",
        kind: "text",
        value: "John Doe",
        page: 1,
        rect: { x: 149.5, y: 694.5, width: 201, height: 21 },
      },
      {
        name: "other_page_field",
        kind: "text",
        value: "x",
        page: 2,
        rect: { x: 0, y: 0, width: 100, height: 20 },
      },
    ];
    eraseFormFieldBorders(ctx, 1, fields, 800, 300 / 72, 2500, 3333);
    // The band is max(2, ceil(4.167 * 1.5)) = 7 device px.
    expect(ctx.fillStyle).toBe("#ffffff");
    // Top band covers y 352..359; bottom band covers y 433..440.
    expect(covers(calls, 630, 356)).toBe(true);
    expect(covers(calls, 630, 436)).toBe(true);
    // Left band covers x 622..629; right band covers x 1454..1461.
    expect(covers(calls, 625, 400)).toBe(true);
    expect(covers(calls, 1458, 400)).toBe(true);
    // The interior (text area) must NOT be erased.
    expect(covers(calls, 900, 400)).toBe(false);
    // A field on another page must NOT be erased on this page.
    const otherPageCovers = calls.some(
      (c) => c.x < 500 && c.y < 500 && (c.w > 0 || c.h > 0),
    );
    expect(otherPageCovers).toBe(false);
  });

  it("skips fields without a page/rect", () => {
    const { ctx, calls } = mockCtx();
    eraseFormFieldBorders(
      ctx,
      1,
      [
        { name: "noRect", kind: "text", value: "x" },
        { name: "otherPage", kind: "text", value: "x", page: 2 },
      ],
      800,
      300 / 72,
      2500,
      3333,
    );
    expect(calls.length).toBe(0);
  });

  it("does not erase anything when no form fields were supplied", () => {
    const { ctx, calls } = mockCtx();
    eraseFormFieldBorders(ctx, 1, undefined, 800, 300 / 72, 2500, 3333);
    expect(calls.length).toBe(0);
  });

  it("runs the border erase during rasterization, after the white page fill", async () => {
    fillRects.length = 0;
    renderOptions.length = 0;
    const fields: OcrRasterizeFormField[] = [
      {
        name: "applicant_name",
        kind: "text",
        value: "John Doe",
        page: 1,
        rect: { x: 149.5, y: 694.5, width: 201, height: 21 },
      },
    ];
    await rasterizePagesForOcr({
      doc: fakeDoc as unknown as Parameters<typeof rasterizePagesForOcr>[0]["doc"],
      pages: [1],
      dpi: 150,
      formFields: fields,
    });
    // The fake page is 612x792; at 150 DPI scale = 150/72 = 2.0833,
    // band = max(2, ceil(2.0833 * 1.5)) = 4 device px.
    const pageFillsList = pageFills(fillRects);
    // One opaque full-page white fill up front...
    expect(pageFillsList.length).toBe(1);
    const eraseCalls = fillRects.slice(1);
    expect(eraseCalls.length).toBe(4);
    const ys = eraseCalls.map((c) => c.y).sort((a, b) => a - b);
    const xs = eraseCalls.map((c) => c.x).sort((a, b) => a - b);
    // Top + bottom bands at y 159..163 and 200..204 (flipped from the
    // bottom-origin rect.y=694.5 on the ~792pt page).
    expect(ys[0]).toBe(159);
    expect(ys[ys.length - 1]).toBe(200);
    // Left + right bands at x 311..315 and 727..731.
    expect(xs[0]).toBe(311);
    expect(xs[xs.length - 1]).toBe(727);
  });
});