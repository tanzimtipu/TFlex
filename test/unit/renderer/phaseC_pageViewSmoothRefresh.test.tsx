// @vitest-environment jsdom
//
// Phase C smooth commit — the page canvas must NEVER blank to
// white/black while a frame is re-rendered.
//
// Engine edits commit through a full pdf.js proxy rebuild
// (`refreshDocProxyFor` swaps `session.doc`), which re-runs the
// PageView render effect on every mounted page. The old code cleared
// the canvas at the top of the run and pdf.js painted into it
// asynchronously, so after every edit Confirm ("Add box" -> Confirm
// specifically) the page flashed white/black for the ~2-3 render
// frames — the reported flicker/flash regression.
//
// The fix: PageView now keeps the LAST PAINTED FRAME on the visible
// canvas while the new frame renders into a scratch canvas, then
// blits the finished frame in one drawImage. The refresh is atomic
// and invisible. This test pins that contract:
//   1. A fresh mount paints white (B15) and blits the first frame.
//   2. The pdf.js render target is a SCRATCH canvas, never the
//      visible one.
//   3. A same-size doc swap (the edit-commit shape) leaves the
//      visible canvas untouched (no resize, no fresh white fill) and
//      delivers exactly one atomic blit — the page never blanks.
//   4. A scale change resizes the canvas and STRETCHES the previous
//      frame into it (no blank between zoom steps) before the sharp
//      frame blits.
import { describe, expect, it, vi, afterEach, beforeEach, type Mock } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PageView } from "../../../src/renderer/components/PageView";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeCtx {
  fillStyle: string;
  boundCanvas: HTMLCanvasElement;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

const ctxByCanvas = new Map<HTMLCanvasElement, FakeCtx>();

function fakeFor(canvas: HTMLCanvasElement | null): FakeCtx | undefined {
  return canvas === null ? undefined : ctxByCanvas.get(canvas);
}

/** All canvases that are NOT in the document — the scratch canvas the
 *  pdf.js frame was rendered into, and the snapshot/stretch canvases. */
function offscreenCanvasArg(call: { args: unknown[] }): HTMLCanvasElement | null {
  const first = call.args[0];
  if (first instanceof HTMLCanvasElement && !document.body.contains(first)) {
    return first;
  }
  return null;
}

interface StubViewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
}

interface StubPage {
  view: [number, number, number, number];
  getViewport: (args: { scale: number; rotation?: number }) => StubViewport;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
}

function makeDoc(renderSpy: Mock): PDFDocumentProxy {
  let pageProxy: StubPage | null = null;
  pageProxy = {
    view: [0, 0, 612, 792],
    getViewport: (args: { scale: number; rotation?: number }): StubViewport => ({
      width: 612 * args.scale,
      height: 792 * args.scale,
      // pdf.js TextLayer reads these off the viewport it is handed.
      scale: args.scale,
      rotation: args.rotation ?? 0,
      rawDims: { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 },
    }),
    render: (args: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }): { promise: Promise<void>; cancel: () => void } => {
      renderSpy(args);
      let resolve: () => void = (): void => undefined;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      queueMicrotask((): void => {
        resolve();
      });
      return {
        promise,
        cancel: (): void => undefined,
      };
    },
    getTextContent: async (): Promise<{ items: Array<{ str: string }> }> => ({ items: [] }),
  };
  return {
    numPages: 1,
    getPage: async (): Promise<PDFPageProxy> => (pageProxy as unknown as PDFPageProxy),
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

interface MountResult {
  host: HTMLElement;
  render: (props: Partial<Parameters<typeof PageView>[0]>) => void;
  unmount: () => void;
}

function mountPageView(props: Partial<Parameters<typeof PageView>[0]> = {}): MountResult {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
  const base = {
    doc: props.doc ?? makeDoc(vi.fn()),
    page: 1,
    sourcePage: 1,
    widthPt: 612,
    heightPt: 792,
    cssScale: 1,
    shouldRender: true,
    hits: [],
    activeHit: null,
    registerPage: noop,
    onPageSize: noop,
    onActiveHitTop: noop,
    annotations: [],
    annotationTool: initialAnnotationToolState,
    flashId: null,
    onCreateAnnotation: noop,
    onRenderStart: noop,
    onRenderEnd: noop,
  } as unknown as Parameters<typeof PageView>[0];
  const render = (next: Partial<Parameters<typeof PageView>[0]> = {}): void => {
    act((): void => {
      root.render(
        <PageView
          {...base}
          {...props}
          {...next}
        />,
      );
    });
  };
  render();
  return {
    host,
    render,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function flushRenders(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async (): Promise<void> => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  ctxByCanvas.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let existing = ctxByCanvas.get(this);
      if (existing === undefined) {
        existing = {
          fillStyle: "",
          boundCanvas: this,
          fillRect: vi.fn(),
          drawImage: vi.fn(),
        };
        ctxByCanvas.set(this, existing);
      }
      return existing as unknown as CanvasRenderingContext2D;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Phase C — PageView refresh never blanks the canvas", () => {
  it("fresh mount: paints white (B15) then blits the frame; pdf.js rendered into a scratch canvas, not the visible one", async () => {
    const renderSpy = vi.fn();
    const { host, unmount } = mountPageView({ doc: makeDoc(renderSpy) });
    try {
      await flushRenders();
      const domCanvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(domCanvas).not.toBeNull();
      if (domCanvas === null) return;
      expect(domCanvas.width).toBe(612);
      expect(domCanvas.height).toBe(792);
      const visible = fakeFor(domCanvas);
      expect(visible, "visible canvas has a context").toBeDefined();
      // B15 — the fresh mount fills the visible canvas with white (the
      // code sets "#ffffff" immediately before the fillRect call).
      expect(visible?.fillRect.mock.calls.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(visible?.fillStyle).toBe("#ffffff");
      // The first frame arrives as an atomic blit from an offscreen canvas.
      const blits = visible?.drawImage.mock.calls.filter((c: unknown[]) => offscreenCanvasArg({ args: c }) !== null) ?? [];
      expect(blits.length).toBeGreaterThanOrEqual(1);
      // pdf.js rendered into the scratch canvas — the visible canvas was
      // never handed to pdf.js (this is what makes the swap atomic).
      expect(renderSpy).toHaveBeenCalled();
      const renderArgs = renderSpy.mock.calls[0]?.[0] as { canvasContext: FakeCtx };
      expect(renderArgs).toBeDefined();
      const renderCtx = renderArgs.canvasContext as unknown as FakeCtx;
      expect(renderCtx.boundCanvas).not.toBe(domCanvas);
      expect(renderCtx.boundCanvas.width).toBe(612);
    } finally {
      unmount();
    }
  });

  it("same-size doc swap (the edit-commit shape): the visible canvas is never resized or re-filled and delivers exactly one atomic blit", async () => {
    const renderSpy = vi.fn();
    const { host, render, unmount } = mountPageView({ doc: makeDoc(renderSpy) });
    try {
      await flushRenders();
      const domCanvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(domCanvas).not.toBeNull();
      if (domCanvas === null) return;
      const visible = fakeFor(domCanvas);
      expect(visible).toBeDefined();
      const fillsAfterFirst = visible?.fillRect.mock.calls.length ?? 0;
      const blitsAfterFirst = visible?.drawImage.mock.calls.length ?? 0;
      const rendersAfterFirst = renderSpy.mock.calls.length;
      // The engine commit swaps in a NEW proxy (fresh doc identity) at the
      // same scale — every mounted PageView re-runs its render effect.
      render({ doc: makeDoc(renderSpy) });
      await flushRenders();
      // The visible canvas kept its previous frame throughout: same size,
      // no second white fill, exactly one new blit at the end.
      expect(domCanvas.width).toBe(612);
      expect(domCanvas.height).toBe(792);
      expect(visible?.fillRect.mock.calls.length).toBe(fillsAfterFirst);
      expect(visible?.drawImage.mock.calls.length).toBe(blitsAfterFirst + 1);
      // And the new proxy really did render (the refresh did its job).
      expect(renderSpy).toHaveBeenCalledTimes(rendersAfterFirst + 1);
    } finally {
      unmount();
    }
  });

  it("scale change: the previous frame is stretched into the resized canvas (no blank between zoom steps) before the sharp frame blits", async () => {
    const renderSpy = vi.fn();
    const { host, render, unmount } = mountPageView({ doc: makeDoc(renderSpy) });
    try {
      await flushRenders();
      const domCanvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(domCanvas).not.toBeNull();
      if (domCanvas === null) return;
      const visible = fakeFor(domCanvas);
      expect(visible).toBeDefined();
      const fillsAfterFirst = visible?.fillRect.mock.calls.length ?? 0;
      // Zoom 1x -> 2x: the wrapper/canvas target 1224 x 1584.
      render({ cssScale: 2 });
      await flushRenders();
      expect(domCanvas.width).toBe(1224);
      expect(domCanvas.height).toBe(1584);
      // The previous 612x792 frame was stretched into the resized canvas
      // (a 9-arg drawImage from the 612x792 snapshot) — no white fill was
      // needed and none was issued for the visible canvas.
      const stretch = visible?.drawImage.mock.calls.find(
        (c: unknown[]) => c.length === 9 && c[0] instanceof HTMLCanvasElement && (c[0] as HTMLCanvasElement).width === 612,
      );
      expect(stretch, "previous frame stretched into the resized canvas").toBeDefined();
      expect(visible?.fillRect.mock.calls.length).toBe(fillsAfterFirst);
      // The sharp frame then blits atomically.
      const sharpBlit = visible?.drawImage.mock.calls.find(
        (c: unknown[]) => {
          const src = offscreenCanvasArg({ args: c });
          return src !== null && src.width === 1224;
        },
      );
      expect(sharpBlit, "sharp 2x frame blitted atomically").toBeDefined();
    } finally {
      unmount();
    }
  });

  it("shouldRender=false releases the backing store and shows the placeholder (DEF-016 memory contract)", async () => {
    const { host, render, unmount } = mountPageView({ doc: makeDoc(vi.fn()) });
    try {
      await flushRenders();
      const domCanvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(domCanvas).not.toBeNull();
      if (domCanvas === null) return;
      expect(domCanvas.width).toBe(612);
      // The slot stops rendering (page scrolled out of the buffer): the
      // bitmap is dropped immediately (this is the DEF-016 memory
      // release path) and the slot shows the placeholder again.
      render({ shouldRender: false });
      await flushRenders();
      expect(domCanvas.width).toBe(0);
      expect(domCanvas.height).toBe(0);
      expect(host.querySelector(".page-placeholder")).not.toBeNull();
      // Turning the slot back on re-renders (fresh white fill + blit).
      render({ shouldRender: true });
      await flushRenders();
      expect(domCanvas.width).toBe(612);
      expect(fakeFor(domCanvas)?.drawImage.mock.calls.length ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      unmount();
    }
  });
});