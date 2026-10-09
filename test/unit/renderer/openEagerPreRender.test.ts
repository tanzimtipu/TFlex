// @vitest-environment jsdom
//
// Phase 128 (TFL-1571) chunk B — eager first-page pre-render on open.
//
// When `openPdfDocument` resolves during `openFromBytes`, the renderer must
// start a fire-and-forget background render of page 1 at scale 1, turn the
// offscreen canvas into an `ImageBitmap`, and store it in the page bitmap
// cache under the NEW tab id (so `DocumentView`/`PageView` hit the cache and
// blit the first page instantly). The eager render must:
//   1. call `doc.getPage(1)` and cache the resulting bitmap;
//   2. never block the open flow (fire-and-forget `void` IIFE);
//   3. swallow any error from the eager path (a cache miss only means the
//      normal render runs, exactly as before this optimization).
//
// This renders the REAL App (DocumentView is the only structural stub) and
// drives the Open toolbar control, mirroring the DEF-299 render-the-App
// pattern. pdfjs, the bitmap cache and the canvas/image primitives are all
// mocked so the assertions observe the eager pre-render directly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const harness = vi.hoisted(() => {
  const state: {
    getPage: ReturnType<typeof vi.fn<(n: number) => unknown>>;
    render: ReturnType<typeof vi.fn<(args: unknown) => void>>;
  } = { getPage: vi.fn(), render: vi.fn() };
  return { state };
});

const cache = vi.hoisted(() => ({
  setCachedBitmap: vi.fn(),
  pruneTabCache: vi.fn(),
  getCachedBitmap: vi.fn(() => null),
  clearTabCache: vi.fn(),
  invalidateProxyCache: vi.fn(),
  PAGE_BITMAP_CACHE_LIMIT: 24,
}));

vi.mock("../../../src/renderer/components/DocumentView", () => ({
  DocumentView: (): unknown => null,
}));
vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: async (): Promise<unknown[]> => [],
}));
vi.mock("../../../src/renderer/pdf/pageBitmapCache", () => cache);
vi.mock("../../../src/renderer/pdf/pdfjs", () => ({
  openPdfDocument: async (): Promise<unknown> => ({
    doc: {
      numPages: 3,
      getPage: (n: number): unknown => harness.state.getPage(n),
      destroy: async (): Promise<unknown> => undefined,
    },
  }),
  readOutline: async (): Promise<null> => null,
}));

import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";

interface FakePage {
  getViewport: (args: { scale: number }) => { width: number; height: number };
  render: (args: unknown) => { promise: Promise<void> };
}

function makePage(): FakePage {
  return {
    getViewport: (): { width: number; height: number } => ({
      width: 612,
      height: 792,
    }),
    render: (args: unknown): { promise: Promise<void> } => {
      harness.state.render(args);
      return { promise: Promise.resolve() };
    },
  };
}

function installStubs(): void {
  const tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFileDialog: async (): Promise<string> => "C:/fixtures/report.pdf",
    loadPdf: async (): Promise<unknown> => ({
      ok: true,
      value: new Uint8Array([1, 2, 3]),
    }),
    listPrinters: async (): Promise<unknown[]> => [],
    closeWindow: (): void => undefined,
    minimizeWindow: (): void => undefined,
    maximizeWindow: (): void => undefined,
    confirmClose: async (): Promise<void> => undefined,
    settings: { changed: (): (() => void) => (): void => undefined },
    menu: {
      onAction: (): (() => void) => (): void => undefined,
      setEnabled: (): void => undefined,
    },
  };
  (window as unknown as { tflex: unknown }).tflex = tflex;
}

function installDomShims(): void {
  if (typeof window.matchMedia !== "function") {
    (window as unknown as { matchMedia: unknown }).matchMedia = (
      query: string,
    ): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
        dispatchEvent: (): boolean => false,
      }) as unknown as MediaQueryList;
  }
  if (
    typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !==
    "function"
  ) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
  }
}

async function flushAsync(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

describe("Phase 128 chunk B — eager first-page pre-render on open", () => {
  let container: HTMLElement;
  let root: Root;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalCreateImageBitmap: unknown;
  let ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn> };
  let createImageBitmapMock: ReturnType<typeof vi.fn>;

  async function openDocument(): Promise<void> {
    const open = container.querySelector<HTMLElement>("[data-toolbar-open]");
    expect(open).not.toBeNull();
    await act(async (): Promise<void> => {
      open?.click();
      await flushAsync();
    });
    await flushAsync();
  }

  beforeEach((): void => {
    vi.clearAllMocks();
    harness.state.getPage.mockReset();
    harness.state.render.mockReset();
    installDomShims();
    installStubs();

    ctx = { fillStyle: "", fillRect: vi.fn() };
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext =
      function getContext(): unknown {
        return ctx;
      };

    originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown })
      .createImageBitmap;
    createImageBitmapMock = vi.fn(async (): Promise<{ close: () => void }> => ({
      close: (): void => undefined,
    }));
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap =
      createImageBitmapMock;

    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap =
      originalCreateImageBitmap;
  });

  it("renders page 1 eagerly and caches the bitmap under the new tab id", async () => {
    harness.state.getPage.mockResolvedValue(makePage());
    act((): void => {
      root.render(createElement(App));
    });
    await flushAsync();
    await openDocument();

    expect(harness.state.getPage).toHaveBeenCalledWith(1);
    expect(harness.state.render).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);

    expect(cache.setCachedBitmap).toHaveBeenCalledTimes(1);
    const call = cache.setCachedBitmap.mock.calls[0] as unknown[];
    expect(typeof call[0]).toBe("string");
    expect((call[0] as string).length).toBeGreaterThan(0);
    expect(call.slice(1, 4)).toEqual([1, 1, 0]);
    const bitmap = call[4];
    expect(bitmap).toBe(
      (await createImageBitmapMock.mock.results[0]?.value) as unknown,
    );
    expect(cache.pruneTabCache).toHaveBeenCalledWith(call[0]);
  });

  it("does not block the open flow while the eager render is pending", async () => {
    harness.state.getPage.mockReturnValue(new Promise(() => undefined));
    act((): void => {
      root.render(createElement(App));
    });
    await flushAsync();
    await openDocument();

    // The tab is live even though the eager pre-render never resolved.
    expect(container.querySelector("[data-new-tab]")).not.toBeNull();
    expect(cache.setCachedBitmap).not.toHaveBeenCalled();
  });

  it("swallows errors from the eager render", async () => {
    harness.state.getPage.mockRejectedValue(new Error("eager boom"));
    act((): void => {
      root.render(createElement(App));
    });
    await flushAsync();
    await openDocument();

    expect(cache.setCachedBitmap).not.toHaveBeenCalled();
    // The open itself survived the swallowed failure.
    expect(container.querySelector("[data-new-tab]")).not.toBeNull();
  });
});
