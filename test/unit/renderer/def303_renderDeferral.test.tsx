// @vitest-environment jsdom
//
// DEF-303 — the expensive render/raster entry points pause while the window
// is minimised and flush on restore.
//
// `backgroundThrottling: false` was tried and reverted: Chromium still
// suspends a minimised window's frames (~1 rAF frame/s), so the explicit
// main-process minimise signal is what pauses the work and
// `visibilitychange` cannot detect it.
// The two display raster entry points — the page bitmap (PageView) and the
// thumbnail bitmap (SideRail's ThumbView, shared by the single-mode rail
// and Multi Mode's PaneThumbStrip) — wrap their work in `deferWork`, so a
// request that lands while suspended is PARKED (never dropped) and runs
// exactly once when the window is restored. This test drives the state
// machine through the real components and asserts the observable contract:
// no `doc.getPage` while suspended, exactly one raster after resume, and a
// painted canvas (no stale / missing page) once the frame lands.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { SideRail } from "../../../src/renderer/components/SideRail";
import { PageView } from "../../../src/renderer/components/PageView";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";
import {
  isRenderSuspended,
  resetRenderSuspendForTests,
  setRenderSuspended,
} from "../../../src/renderer/state/renderSuspend";
import type { EngineState } from "../../../src/renderer/engine/types";

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

interface RenderStub {
  calls: number;
  resolveAll: () => void;
}

function makeDoc(render: RenderStub, views: Array<[number, number, number, number]> = [[0, 0, 612, 792]]): PDFDocumentProxy {
  const pending: Array<() => void> = [];
  render.resolveAll = (): void => {
    const resolvers = pending.splice(0, pending.length);
    for (const resolve of resolvers) resolve();
  };
  return {
    numPages: views.length,
    async getPage(n: number): Promise<PDFPageProxy> {
      (globalThis as { __getPageCalls?: number }).__getPageCalls =
        ((globalThis as { __getPageCalls?: number }).__getPageCalls ?? 0) + 1;
      const view = views[Math.min(n - 1, views.length - 1)] ?? [0, 0, 612, 792];
      const w = view[2] - view[0];
      const h = view[3] - view[1];
      return {
        pageNumber: n,
        view,
        getViewport: (args: { scale: number; rotation?: number }) => {
          const isQuarter = ((args.rotation ?? 0) % 180) === 90;
          return {
            width: (isQuarter ? h : w) * args.scale,
            height: (isQuarter ? w : h) * args.scale,
            scale: args.scale,
            rotation: args.rotation ?? 0,
            rawDims: { pageWidth: w, pageHeight: h, pageX: 0, pageY: 0 },
          };
        },
        render: (): { promise: Promise<void>; cancel: () => void } => {
          render.calls += 1;
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

function getPageCalls(): number {
  return (globalThis as { __getPageCalls?: number }).__getPageCalls ?? 0;
}

async function flushRenders(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async (): Promise<void> => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface PageMount {
  host: HTMLElement;
  unmount: () => void;
}

function mountPageView(doc: PDFDocumentProxy): PageMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
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
        rotation={0}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function engineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

interface RailMount {
  host: HTMLElement;
  unmount: () => void;
}

function mountRail(doc: PDFDocumentProxy, pageCount = 3): RailMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <SideRail
        doc={doc}
        pageCount={pageCount}
        outline={null}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={engineState(pageCount)}
        canUndo={false}
        onJump={(): void => undefined}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

beforeEach((): void => {
  resetRenderSuspendForTests();
  (globalThis as { __getPageCalls?: number }).__getPageCalls = 0;
  // jsdom reports clientHeight 0, which makes the rail's geometry range
  // empty and leaves every thumb unmounted; a fixed viewport height makes
  // the first slots visible so the Thumb raster effect actually runs.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    },
  );
});

afterEach((): void => {
  resetRenderSuspendForTests();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("DEF-303 — PageView parks the page raster while minimised", () => {
  it("defers the render while suspended and flushes it exactly once on resume", async () => {
    setRenderSuspended(true);
    const render: RenderStub = { calls: 0, resolveAll: (): void => undefined };
    const { host, unmount } = mountPageView(makeDoc(render));
    try {
      await flushRenders();
      expect(isRenderSuspended()).toBe(true);
      // Parked, not dropped: pdf.js is never touched while minimised.
      expect(getPageCalls()).toBe(0);
      expect(render.calls).toBe(0);
      act((): void => {
        setRenderSuspended(false);
      });
      await flushRenders();
      // Flushed exactly once on resume.
      expect(getPageCalls()).toBe(1);
      expect(render.calls).toBe(1);
      render.resolveAll();
      await flushRenders();
      // Visible state after resume is correct: the page bitmap is painted.
      const canvas = host.querySelector<HTMLCanvasElement>(".pdf-page-canvas");
      expect(canvas).not.toBeNull();
      expect(canvas?.width).toBe(612);
      expect(canvas?.height).toBe(792);
      expect(getPageCalls()).toBe(1);
    } finally {
      unmount();
    }
  });

  it("drops a parked render when the slot unmounts while suspended", async () => {
    setRenderSuspended(true);
    const render: RenderStub = { calls: 0, resolveAll: (): void => undefined };
    const { unmount } = mountPageView(makeDoc(render));
    await flushRenders();
    expect(getPageCalls()).toBe(0);
    unmount();
    act((): void => {
      setRenderSuspended(false);
    });
    await flushRenders();
    // The stale request was cancelled with the effect — nothing renders.
    expect(getPageCalls()).toBe(0);
    expect(render.calls).toBe(0);
  });
});

describe("DEF-303 — the thumbnail raster parks while minimised", () => {
  it("defers the thumb render while suspended and paints it on resume", async () => {
    setRenderSuspended(true);
    const render: RenderStub = { calls: 0, resolveAll: (): void => undefined };
    const { host, unmount } = mountRail(makeDoc(render));
    try {
      await flushRenders();
      expect(getPageCalls()).toBe(0);
      expect(render.calls).toBe(0);
      act((): void => {
        setRenderSuspended(false);
      });
      await flushRenders();
      expect(getPageCalls()).toBeGreaterThan(0);
      expect(render.calls).toBeGreaterThan(0);
      render.resolveAll();
      await flushRenders();
      // The restored window shows a painted thumbnail, not a stale shimmer.
      const canvas = host.querySelector<HTMLCanvasElement>("canvas.thumb-canvas");
      expect(canvas).not.toBeNull();
      expect(canvas?.width ?? 0).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  it("drops parked thumb renders when the rail unmounts while suspended", async () => {
    setRenderSuspended(true);
    const render: RenderStub = { calls: 0, resolveAll: (): void => undefined };
    const { unmount } = mountRail(makeDoc(render));
    await flushRenders();
    expect(getPageCalls()).toBe(0);
    unmount();
    act((): void => {
      setRenderSuspended(false);
    });
    await flushRenders();
    expect(getPageCalls()).toBe(0);
    expect(render.calls).toBe(0);
  });
});
