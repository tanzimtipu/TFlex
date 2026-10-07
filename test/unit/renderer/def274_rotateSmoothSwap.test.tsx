// @vitest-environment jsdom
//
// DEF-274 — rotating a page must never blank its thumbnail, and the page
// must turn immediately.
//
// The rotate path calls `refreshDocProxyFor`, which swaps in a fresh
// pdf.js proxy; that re-runs the rail's Thumb render effect. The old code
// assigned `canvas.width = geom.bufferWidth` at the TOP of the effect —
// assigning width resets a canvas's backing store to transparent even when
// the value is unchanged — and pdf.js then repainted asynchronously, so the
// painted thumbnail was cleared to opaque white for 0.1 s to >3 s.
//
// The fix (both halves, this file pins them):
//   1. Thumb: the new frame renders into an OFFSCREEN scratch canvas; the
//      visible canvas is resized and blitted in ONE task, only after the
//      frame is complete. While the render is pending the visible canvas's
//      backing store is untouched (same width/height, no blit).
//   2. PageView: on a rotation change the existing bitmap is transformed
//      onto the NEW slot box immediately (`rotate(delta)` + a centring
//      translate), and the transform is dropped in the SAME task as the
//      blit that swaps in the fresh frame.
//   3. Thumb: the bitmap is rendered un-rotated (`rotation: 0`) because the
//      wrap owns the turn via `.thumb-rot-N`; pdf.js applying /Rotate too
//      double-rotated it and mismatched the portrait buffer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import { PageView } from "../../../src/renderer/components/PageView";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";
import type { EngineState } from "../../../src/renderer/engine/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

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

/** Every canvas that is NOT in the document — the per-run scratch. */
function offscreenCanvasArg(call: { args: unknown[] }): HTMLCanvasElement | null {
  const first = call.args[0];
  if (first instanceof HTMLCanvasElement && !document.body.contains(first)) {
    return first;
  }
  return null;
}

/** A pdf.js render task whose completion the test controls. */
interface ControlledRender {
  calls: Array<{ viewport: { width: number; height: number } }>;
  resolveAll: () => void;
}

/**
 * Stub doc for the rail. `views` lets a test change a page's raw
 * (un-rotated) CropBox between proxies — the geometry-change shape.
 * `rotationArg` records what the rail asked pdf.js to apply.
 */
function makeThumbDoc(
  render: ControlledRender,
  views: Array<[number, number, number, number]> = [[0, 0, 612, 792]],
  viewportRotations: number[] = [],
): PDFDocumentProxy {
  const pending: Array<() => void> = [];
  render.resolveAll = (): void => {
    const resolvers = pending.splice(0, pending.length);
    for (const resolve of resolvers) resolve();
  };
  return {
    numPages: views.length,
    async getPage(n: number): Promise<unknown> {
      const view = views[Math.min(n - 1, views.length - 1)] ?? [0, 0, 612, 792];
      return {
        pageNumber: n,
        view,
        getViewport: (args: { scale: number; rotation?: number }): {
          width: number;
          height: number;
          scale: number;
          rotation: number;
          rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
        } => {
          viewportRotations.push(args.rotation ?? -1);
          const isQuarter = ((args.rotation ?? 0) % 180) === 90;
          const w = view[2] - view[0];
          const h = view[3] - view[1];
          return {
            width: (isQuarter ? h : w) * args.scale,
            height: (isQuarter ? w : h) * args.scale,
            scale: args.scale,
            rotation: args.rotation ?? 0,
            rawDims: { pageWidth: w, pageHeight: h, pageX: 0, pageY: 0 },
          };
        },
        render: (args: { viewport: { width: number; height: number } }): {
          promise: Promise<void>;
          cancel: () => void;
        } => {
          render.calls.push({ viewport: args.viewport });
          let resolve: () => void = (): void => undefined;
          const promise = new Promise<void>((r) => {
            resolve = r;
          });
          pending.push(resolve);
          return { promise, cancel: (): void => undefined };
        },
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

const ZERO_ROTATIONS: EngineState["rotations"] = [0, 0, 0, 0, 0] as EngineState["rotations"];

function engineState(pageCount: number, rotations: EngineState["rotations"]): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations,
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

function mountRail(
  doc: PDFDocumentProxy,
  rotations: EngineState["rotations"] = ZERO_ROTATIONS,
  pageCount = 3,
): { host: HTMLElement; rerender: (next: PDFDocumentProxy, nextRot?: EngineState["rotations"]) => void; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const draw = (nextDoc: PDFDocumentProxy, nextRot: EngineState["rotations"]): void => {
    const es = engineState(pageCount, nextRot);
    const visibleToSource = new Map<number, number>();
    es.pageOrder.forEach((src, i) => visibleToSource.set(i + 1, src + 1));
    act((): void => {
      root.render(
        <ThumbnailRail
          doc={nextDoc}
          pageCount={pageCount}
          currentPage={1}
          aspectRatio={792 / 612}
          rotations={es.rotations}
          visibleToSource={visibleToSource}
          proxyVisibleOrder={false}
          canUndo={false}
          onJump={(): void => undefined}
        />,
      );
    });
  };
  draw(doc, rotations);
  return {
    host,
    rerender: (nextDoc: PDFDocumentProxy, nextRot: EngineState["rotations"] = ZERO_ROTATIONS): void =>
      draw(nextDoc, nextRot),
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

function thumbCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.querySelector<HTMLCanvasElement>('.thumb-item[data-page="1"] canvas.thumb-canvas');
  expect(canvas).not.toBeNull();
  return canvas as HTMLCanvasElement;
}

beforeEach(() => {
  ctxByCanvas.clear();
  // jsdom reports clientHeight 0 for every element, which makes the rail's
  // geometry-based visible range empty and leaves every thumb unmounted.
  // A fixed viewport height makes the range cover the first few slots so
  // the Thumb render effect actually runs.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
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
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("DEF-274 � thumbnail never blanks while the fresh frame is pending", () => {
  it("renders the thumb bitmap un-rotated (rotation: 0) so the wrap owns the turn", async () => {
    const render: ControlledRender = { calls: [], resolveAll: (): void => undefined };
    const rotations: number[] = [];
    const { unmount } = mountRail(makeThumbDoc(render, [[0, 0, 612, 792]], rotations));
    try {
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      expect(rotations.length).toBeGreaterThan(0);
      expect(rotations.every((r) => r === 0)).toBe(true);
    } finally {
      unmount();
    }
  });

  it("a rotate-driven proxy swap leaves the visible canvas size and bitmap untouched until the frame is ready", async () => {
    const render: ControlledRender = { calls: [], resolveAll: (): void => undefined };
    const { host, rerender, unmount } = mountRail(makeThumbDoc(render));
    try {
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      const canvas = thumbCanvas(host);
      const ctx = fakeFor(canvas);
      expect(ctx).toBeDefined();
      const w = canvas.width;
      const h = canvas.height;
      expect(w).toBeGreaterThan(0);
      const blitsAfterFirst = ctx?.drawImage.mock.calls.length ?? 0;
      // The rotate op: engine rotation flips AND the proxy is rebuilt
      // (fresh doc identity) � the shape that used to clear the canvas.
      rerender(makeThumbDoc(render), [1, 0, 0, 0] as EngineState["rotations"]);
      await flushRenders();
      // The new render is still pending: the backing store is NOT resized
      // and the previous frame is NOT cleared.
      expect(canvas.width).toBe(w);
      expect(canvas.height).toBe(h);
      expect(ctx?.drawImage.mock.calls.length ?? 0).toBe(blitsAfterFirst);
      // The frame lands: exactly one atomic blit from an offscreen canvas.
      render.resolveAll();
      await flushRenders();
      expect(ctx?.drawImage.mock.calls.length ?? 0).toBe(blitsAfterFirst + 1);
      const blit = (ctx?.drawImage.mock.calls ?? []).find(
        (c: unknown[]) => offscreenCanvasArg({ args: c }) !== null,
      );
      expect(blit, "blit came from the offscreen scratch canvas").toBeDefined();
      expect(canvas.width).toBe(w);
      expect(canvas.height).toBe(h);
    } finally {
      unmount();
    }
  });

  it("a geometry change resizes the visible canvas only at the blit, never before", async () => {
    const render: ControlledRender = { calls: [], resolveAll: (): void => undefined };
    const { host, rerender, unmount } = mountRail(makeThumbDoc(render));
    try {
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      const canvas = thumbCanvas(host);
      const ctx = fakeFor(canvas);
      const w = canvas.width;
      const h = canvas.height;
      const blitsAfterFirst = ctx?.drawImage.mock.calls.length ?? 0;
      // A page whose raw CropBox is now landscape (the geometry-change
      // shape: a rotated/cropped page re-measures differently).
      rerender(makeThumbDoc(render, [[0, 0, 792, 612]]));
      await flushRenders();
      expect(canvas.width).toBe(w);
      expect(canvas.height).toBe(h);
      expect(ctx?.drawImage.mock.calls.length ?? 0).toBe(blitsAfterFirst);
      render.resolveAll();
      await flushRenders();
      // The new geometry lands only at the blit: the width happens to be
      // the same (both pages fit THUMB_WIDTH) while the height re-measures
      // to the landscape page's aspect.
      expect(canvas.height).not.toBe(h);
      expect(canvas.height).toBeLessThan(h);
      expect(ctx?.drawImage.mock.calls.length ?? 0).toBe(blitsAfterFirst + 1);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// PageView — the page turns immediately, then swaps in the crisp frame.

interface PageRenderStub {
  resolveAll: () => void;
}

function makePageDoc(render: PageRenderStub, pageW = 612, pageH = 792): PDFDocumentProxy {
  const pending: Array<() => void> = [];
  render.resolveAll = (): void => {
    const resolvers = pending.splice(0, pending.length);
    for (const resolve of resolvers) resolve();
  };
  return {
    numPages: 1,
    async getPage(): Promise<PDFPageProxy> {
      return {
        pageNumber: 1,
        view: [0, 0, pageW, pageH],
        getViewport: (args: { scale: number; rotation?: number }): {
          width: number;
          height: number;
          scale: number;
          rotation: number;
          rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
        } => {
          const isQuarter = ((args.rotation ?? 0) % 180) === 90;
          return {
            width: (isQuarter ? pageH : pageW) * args.scale,
            height: (isQuarter ? pageW : pageH) * args.scale,
            scale: args.scale,
            rotation: args.rotation ?? 0,
            rawDims: { pageWidth: pageW, pageHeight: pageH, pageX: 0, pageY: 0 },
          };
        },
        render: (): { promise: Promise<void>; cancel: () => void } => {
          let resolve: () => void = (): void => undefined;
          const promise = new Promise<void>((r) => {
            resolve = r;
          });
          pending.push(resolve);
          return { promise, cancel: (): void => undefined };
        },
        getTextContent: async (): Promise<{ items: Array<{ str: string }> }> => ({ items: [] }),
      } as unknown as PDFPageProxy;
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

interface PageMount {
  host: HTMLElement;
  rerender: (rotation: number) => void;
  unmount: () => void;
}

function mountPageView(doc: PDFDocumentProxy, rotation: number): PageMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
  const draw = (nextRotation: number): void => {
    act((): void => {
      root.render(
        <PageView
          doc={doc}
          page={1}
          sourcePage={1}
          widthPt={612}
          heightPt={792}
          cssScale={1}
          shouldRender={true}
          hits={[]}
          activeHit={null}
          registerPage={noop}
          onPageSize={noop}
          onActiveHitTop={noop}
          annotations={[]}
          annotationTool={initialAnnotationToolState}
          flashId={null}
          onCreateAnnotation={noop}
          onFinishedOneShot={noop}
          onRenderStart={noop}
          onRenderEnd={noop}
          rotation={nextRotation}
        />,
      );
    });
  };
  draw(rotation);
  return {
    host,
    rerender: draw,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("DEF-274 — the page turns immediately on rotate", () => {
  it("transforms the existing bitmap onto the new slot box, then drops the transform in the same task as the blit", async () => {
    const render: PageRenderStub = { resolveAll: (): void => undefined };
    const doc = makePageDoc(render);
    const { host, rerender, unmount } = mountPageView(doc, 0);
    try {
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      const canvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(canvas).not.toBeNull();
      if (canvas === null) return;
      expect(canvas.width).toBe(612);
      expect(canvas.height).toBe(792);
      expect(canvas.style.transform).toBe("");
      // Rotate 0 -> 90: the wrapper (and the fresh viewport) become
      // 792x612, but the frame on screen is still the 612x792 one.
      rerender(1);
      await flushRenders();
      expect(canvas.width).toBe(612);
      expect(canvas.height).toBe(792);
      // Turned immediately: 90deg about the centre, translated to the new
      // box's centre — no unrotated, no double-rotated frame.
      expect(canvas.style.transform).toContain("rotate(90deg)");
      expect(canvas.style.transform).toContain("translate(90px, -90px)");
      // The fresh frame lands: resize + blit + transform removal.
      render.resolveAll();
      await flushRenders();
      expect(canvas.width).toBe(792);
      expect(canvas.height).toBe(612);
      expect(canvas.style.transform).toBe("");
      const ctx = fakeFor(canvas);
      const blit = (ctx?.drawImage.mock.calls ?? []).find(
        (c: unknown[]) => offscreenCanvasArg({ args: c }) !== null,
      );
      expect(blit, "the fresh rotated frame blitted from the scratch canvas").toBeDefined();
    } finally {
      unmount();
    }
  });

  it("reduced motion: skips the turn transform and relies on the offscreen swap", async () => {
    const originalMatchMedia = window.matchMedia;
    // The OS asks for reduced motion: the page must not move, but it must
    // still never blank (the atomic swap is the fallback).
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as unknown as typeof window.matchMedia;
    const render: PageRenderStub = { resolveAll: (): void => undefined };
    const doc = makePageDoc(render);
    const { host, rerender, unmount } = mountPageView(doc, 0);
    try {
      await flushRenders();
      render.resolveAll();
      await flushRenders();
      const canvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(canvas).not.toBeNull();
      if (canvas === null) return;
      rerender(1);
      await flushRenders();
      // Reduced motion: the page must not move at all — no turn transform.
      expect(canvas.style.transform).toBe("");
      render.resolveAll();
      await flushRenders();
      expect(canvas.width).toBe(792);
      expect(canvas.height).toBe(612);
      expect(canvas.style.transform).toBe("");
    } finally {
      unmount();
      (window as { matchMedia?: typeof window.matchMedia }).matchMedia = originalMatchMedia;
    }
  });
});

