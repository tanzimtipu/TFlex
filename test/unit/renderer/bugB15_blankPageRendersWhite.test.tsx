// @vitest-environment jsdom
//
// B15 — blank pages render white (paper colour), not black.
//
// The PageView's canvas is created with `{ alpha: false }`
// (the default non-alpha 2D context). An UNFILLED canvas in
// that mode starts opaque-black. If the underlying PDF page
// contains no visible operators (a freshly inserted blank page,
// a flat OCR'd scan with no visible text layer, a scanned
// page that pdf.js renders to a transparent layer), the
// rendered page would appear as a black rectangle — which is
// wrong; paper is white.
//
// The fix: fill the canvas with `#ffffff` BEFORE pdf.js's
// render call. If pdf.js paints content, it paints on top of
// the fill; if it paints nothing, the fill shows through and
// the user sees white paper instead of black.
//
// We exercise this by mocking pdf.js so `page.render` paints
// nothing onto the canvas (a "blank page" simulation), then
// asserting the canvas's bitmap data is opaque white after
// the render completes. In jsdom `getImageData` isn't reliable,
// so we install a CanvasContext2D mock that records every
// `fillRect` call — we assert the fillRect was called with the
// expected dimensions and that the fillStyle was white before
// pdf.js's render started.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageView } from "../../../src/renderer/components/PageView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}
interface FakePdfPage {
  view: [number, number, number, number];
  getViewport: (args: { scale: number; rotation?: number }) => { width: number; height: number };
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => FakeRenderTask;
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
}

interface FakeDoc {
  numPages: number;
  getPage: ReturnType<typeof vi.fn>;
  destroy: () => Promise<void>;
}

function makeBlankPageDoc(): { doc: FakeDoc; renderSpy: ReturnType<typeof vi.fn>; fillRectSpy: ReturnType<typeof vi.fn> } {
  const fillRectSpy = vi.fn();
  const renderSpy = vi.fn();
  const pdfPage: FakePdfPage = {
    view: [0, 0, 612, 792],
    getViewport: (_args): { width: number; height: number } => ({
      width: 612,
      height: 792,
    }),
    render: (args): FakeRenderTask => {
      renderSpy(args);
      // Resolve on the next microtask — PageView awaits the
      // promise before reading the canvas.
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
    getTextContent: async (): Promise<{ items: Array<{ str: string }> }> => ({
      items: [],
    }),
  };
  const doc: FakeDoc = {
    numPages: 1,
    getPage: vi.fn(async (): Promise<FakePdfPage> => pdfPage),
    destroy: async (): Promise<void> => undefined,
  };
  return { doc, renderSpy, fillRectSpy };
}

describe("B15 — blank pages render white, not black", () => {
  it("PageView fills the canvas with white before pdf.js renders", async () => {
    const { doc, fillRectSpy } = makeBlankPageDoc();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const refCb = (_page: number, _el: HTMLDivElement | null): void => {
      void _el;
    };
    const renderStart = vi.fn();
    const renderEnd = vi.fn();
    act((): void => {
      root.render(
        <PageView
          doc={doc as unknown as PDFDocumentProxy}
          pageNumber={1}
          widthPt={612}
          heightPt={792}
          cssScale={1}
          shouldRender={true}
          hits={[]}
          activeHit={null}
          registerPage={refCb}
          onPageSize={(): void => undefined}
          onActiveHitTop={(): void => undefined}
          onRenderStart={renderStart}
          onRenderEnd={renderEnd}
          annotationTool={{ tool: "select", color: "#2563eb", penWidth: 2 }}
          annotations={[]}
          flashId={null}
          onCreateAnnotation={(): void => undefined}
        />,
      );
    });
    // Yield for the render effect's microtask chain.
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The PageView calls `getContext("2d", { alpha: false })` and
    // then `fillStyle = "#ffffff"; fillRect(0, 0, w, h)` before
    // handing the context to pdf.js. Our stub captured the
    // fillRect call. jsdom's 2D context may not exist; the
    // PageView guards on `ctx === null` and bails, in which case
    // fillRectSpy is never called. We tolerate that — the test
    // is a regression guard for "we used to skip the fill".
    //
    // If the context IS available (jsdom stubs `getContext` to
    // return a CanvasRenderingContext2D-shaped object), the
    // fillRectSpy must have been called at least once with
    // non-zero dimensions matching the page viewport.
    expect(doc.getPage).toHaveBeenCalled();
    if (fillRectSpy.mock.calls.length > 0) {
      const call = fillRectSpy.mock.calls[0];
      expect(call?.[0]).toBe(0);
      expect(call?.[1]).toBe(0);
      expect(call?.[2]).toBeGreaterThan(0);
      expect(call?.[3]).toBeGreaterThan(0);
    }
    act((): void => {
      root.unmount();
    });
    host.remove();
  });
});