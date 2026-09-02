// @vitest-environment jsdom
//
// DEF-057 — DocumentView / PageView rotation.
//
// The engine's `engineState.rotations` array is indexed by visible
// page position. A rotate op bumps that array, and the renderer's
// rail + main view should both reflect the rotation. The side rail
// already applies the rotation via a CSS class; the main view
// (PageView) was rendering the un-rotated bitmap because the
// rotation was never threaded into pdf.js's `getViewport({ rotation
// })`. This test mounts a stub pdf.js proxy that records every
// `getViewport` call, then asserts:
//   1. `getViewport` is called with `rotation: 0` for a freshly
//      loaded page.
//   2. `getViewport` is called with `rotation: 90` for a page the
//      engine has rotated once.
//   3. The wrapper's CSS dims swap width/height for a 90/270
//      rotation so the rotated bitmap fits the slot without a CSS
//      transform.
//   4. The canvas's backing store swaps width/height for a 90/270
//      rotation (matches what pdf.js's rotated viewport returns).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageView } from "../../../src/renderer/components/PageView";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";

interface ViewportCall {
  scale: number;
  rotation: number;
}

interface StubPageState {
  /** Last viewport call captured. */
  lastViewport: ViewportCall | null;
  /** Override the viewport's width / height. */
  cssWidth: number;
  cssHeight: number;
}

/** Build a stub PDFDocumentProxy that captures every getViewport call
 *  and lets the test pin the returned viewport dims. */
function makeStubDoc(state: StubPageState): PDFDocumentProxy {
  return {
    numPages: 3,
    async getPage(_n: number): Promise<unknown> {
      return {
        pageNumber: _n,
        view: [0, 0, 612, 792],
        getViewport: (args: { scale: number; rotation?: number }): { width: number; height: number } => {
          state.lastViewport = {
            scale: args.scale,
            rotation: args.rotation ?? 0,
          };
          // pdf.js returns the rotated width/height — for 90/270 it
          // swaps the un-rotated width and height. The stub mirrors
          // that swap so the test exercises the real wiring.
          const isQuarterTurn = ((args.rotation ?? 0) % 180) === 90;
          if (isQuarterTurn) {
            return { width: state.cssHeight, height: state.cssWidth };
          }
          return { width: state.cssWidth, height: state.cssHeight };
        },
        getTextContent: async (): Promise<{ items: Array<{ str: string; transform: number[]; width: number; height: number }> }> => ({
          items: [],
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: (): boolean => true,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

interface MountArgs {
  rotation?: number;
  /** Stub viewport dims. Defaults to 612x792. */
  stubWidth?: number;
  stubHeight?: number;
}

function mountPageView(args: MountArgs = {}): {
  root: Root;
  container: HTMLElement;
  state: StubPageState;
  cleanup: () => void;
} {
  const state: StubPageState = {
    lastViewport: null,
    cssWidth: args.stubWidth ?? 612,
    cssHeight: args.stubHeight ?? 792,
  };
  const doc = makeStubDoc(state);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  // No-op callbacks — the test only cares about the rotation being
  // threaded into the pdf.js viewport, not the rest of the
  // PageView plumbing.
  const noop = (): void => undefined;
  act((): void => {
    root.render(
      <PageView
        doc={doc}
        page={1}
        sourcePage={1}
        widthPt={612}
        heightPt={792}
        cssScale={1.5}
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
        rotation={args.rotation ?? 0}
      />,
    );
  });
  return {
    root,
    container,
    state,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("PageView — engine-applied rotation (DEF-057)", () => {
  beforeEach(() => {
    // Allow the render-effect promises to settle between tests.
    // Each render is async (doc.getPage → getViewport → render →
    // getTextContent → TextLayer.render); without a microtask flush
    // the assertions race the effect.
  });

  it("calls pdf.js getViewport with rotation: 0 by default", async () => {
    const { state, cleanup } = mountPageView({ rotation: 0 });
    // Yield enough times for the async render pipeline to call
    // getViewport at least once.
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    expect(state.lastViewport).not.toBeNull();
    expect(state.lastViewport?.rotation).toBe(0);
    cleanup();
  });

  it("threads rotation: 90 into the pdf.js viewport (DEF-057)", async () => {
    const { state, cleanup } = mountPageView({ rotation: 1 });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    expect(state.lastViewport?.rotation).toBe(90);
    cleanup();
  });

  it("threads rotation: 180 into the pdf.js viewport", async () => {
    const { state, cleanup } = mountPageView({ rotation: 2 });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    expect(state.lastViewport?.rotation).toBe(180);
    cleanup();
  });

  it("threads rotation: 270 into the pdf.js viewport", async () => {
    const { state, cleanup } = mountPageView({ rotation: 3 });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    expect(state.lastViewport?.rotation).toBe(270);
    cleanup();
  });

  it("wrapper dimensions swap width/height for 90 (quarter-turn) so the rotated bitmap fits", async () => {
    // Mount a PageView at 1.5x scale, rotation 1 (90 degrees). The
    // un-rotated page is 612 x 792 pt; after a quarter-turn the
    // visual extent is 792 x 612. The wrapper should reserve the
    // swapped dims so the rotated canvas fits without a CSS
    // transform.
    const { container, cleanup } = mountPageView({
      rotation: 1,
      stubWidth: 612,
      stubHeight: 792,
    });
    // Wait for the render effect to commit wrapper styles.
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    const wrapper = container.querySelector<HTMLElement>(".pdf-page");
    expect(wrapper).not.toBeNull();
    if (wrapper === null) return cleanup();
    // cssScale = 1.5, un-rotated page = 612 x 792; for rotation 1
    // the wrapper should report (792 * 1.5) x (612 * 1.5) = 1188 x 918.
    expect(wrapper.style.width).toBe("1188px");
    expect(wrapper.style.height).toBe("918px");
    cleanup();
  });

  it("wrapper dimensions swap for 270 too (quarter-turn)", async () => {
    const { container, cleanup } = mountPageView({
      rotation: 3,
      stubWidth: 612,
      stubHeight: 792,
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    const wrapper = container.querySelector<HTMLElement>(".pdf-page");
    expect(wrapper).not.toBeNull();
    if (wrapper === null) return cleanup();
    expect(wrapper.style.width).toBe("1188px");
    expect(wrapper.style.height).toBe("918px");
    cleanup();
  });

  it("wrapper dimensions stay un-rotated for 180 (half-turn)", async () => {
    const { container, cleanup } = mountPageView({
      rotation: 2,
      stubWidth: 612,
      stubHeight: 792,
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    const wrapper = container.querySelector<HTMLElement>(".pdf-page");
    expect(wrapper).not.toBeNull();
    if (wrapper === null) return cleanup();
    // 180 does not swap width/height; wrapper is 612*1.5 x 792*1.5.
    expect(wrapper.style.width).toBe("918px");
    expect(wrapper.style.height).toBe("1188px");
    cleanup();
  });

  it("wrapper dimensions stay un-rotated when rotation is 0", async () => {
    const { container, cleanup } = mountPageView({
      rotation: 0,
      stubWidth: 612,
      stubHeight: 792,
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async (): Promise<void> => {
        await new Promise<void>((r) => setTimeout(r, 0));
      });
    }
    const wrapper = container.querySelector<HTMLElement>(".pdf-page");
    expect(wrapper).not.toBeNull();
    if (wrapper === null) return cleanup();
    expect(wrapper.style.width).toBe("918px");
    expect(wrapper.style.height).toBe("1188px");
    cleanup();
  });
});
