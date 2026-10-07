// @vitest-environment jsdom
//
// Crop does NOT re-scale the viewer's global zoom state.
//
// Repro (qa): after cropping page 1 of a multi-page doc, the fit-to-page
// zoom recalculated from the cropped (smaller) page-1 size — `firstPageSize`
// is re-fetched from the fresh proxy after `refreshDocProxyFor` swaps the
// doc — so every OTHER uncropped page rendered at a bigger absolute
// pixel size: a visible zoom jump after every crop (and the reverse jump
// on crop undo).
//
// The fix splits the fit reference from the live layout size:
//   - `firstPageSize` stays LIVE (slots / rail / wrappers track the new
//     bytes), while
//   - `fitAnchor` (what fit-width / fit-page scale against) only moves on
//     first resolution, an explicit user fit action, or a refresh whose
//     page-1 size is NOT an inset of the anchor (genuine identity change —
//     delete / reorder / insert / new file).
//
// A crop shrink keeps the anchor, so the fit scale — and therefore the
// rendered size of every uncropped page — is unchanged by the refresh.
//
// This harness mounts the REAL DocumentView (jsdom + fake scrollable),
// then swaps the `doc` prop for a cropped variant the same way
// `refreshDocProxyFor` does, and asserts the zoom diagnostics / toolbar
// percent / persisted mode before and after the swap.

import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  DocumentView,
  type PersistedViewer,
  type DocDiagnostics,
} from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import { FIT_MARGIN_PX } from "../../../src/renderer/components/pageGeometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// fake scrollable — the DocumentView scroller relies on scrollTop /
// clientWidth / clientHeight / scrollTo; jsdom provides none of these.
// ---------------------------------------------------------------------------
const scrollState = new WeakMap<Element, { top: number }>();

function installScrollFakes(): void {
  const p = window.HTMLElement.prototype as unknown as {
    scrollTop?: number;
    scrollLeft?: number;
    clientHeight?: number;
    clientWidth?: number;
    scrollTo?: (o: { top: number; behavior?: ScrollBehavior }) => void;
  };
  Object.defineProperty(p, "scrollTop", {
    configurable: true,
    get(this: Element): number {
      return scrollState.get(this)?.top ?? 0;
    },
    set(this: Element, v: number) {
      const st = scrollState.get(this) ?? { top: 0 };
      const next = Math.max(0, v);
      if (Math.abs(next - st.top) < 0.001) return;
      st.top = next;
      scrollState.set(this, st);
      this.dispatchEvent(new Event("scroll"));
    },
  });
  Object.defineProperty(p, "scrollLeft", {
    configurable: true,
    get(): number {
      return 0;
    },
    set(): void {},
  });
  Object.defineProperty(p, "clientHeight", {
    configurable: true,
    get(): number {
      return 800;
    },
  });
  Object.defineProperty(p, "clientWidth", {
    configurable: true,
    get(): number {
      return 1200;
    },
  });
  if (typeof p.scrollTo !== "function") {
    p.scrollTo = function (this: Element, o: { top: number; behavior?: ScrollBehavior }): void {
      const behavior = o.behavior ?? "instant";
      if (behavior === "smooth") {
        return; // park the animation; these tests never animate
      }
      (this as unknown as { scrollTop: number }).scrollTop = Math.max(0, o.top);
    };
  }
}

/** Settle one microtask flush so the `[doc]` effect's getPage(1) promise
 *  resolves and setFirstPageSize / setFitAnchor commit. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// doc stub — per-page dims so the "cropped" variant has a smaller page 1
// while every other page keeps the full size (the multi-page repro).
// ---------------------------------------------------------------------------
type Dims = { w: number; h: number };
const FULL_PAGE: Dims = { w: 612, h: 792 };
const CROPPED_PAGE_1: Dims = { w: 400, h: 500 };
const INSET_PAGE_1: Dims = { w: 300, h: 396 }; // a second, deeper crop
const GROWN_PAGE_1: Dims = { w: 800, h: 1000 }; // identity change (insert / open)

function makeDocStub(
  numPages: number,
  pageDims: (n: number) => Dims = () => FULL_PAGE,
): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      const { w, h } = pageDims(n);
      return {
        view: [0, 0, w, h],
        getViewport: (_args: { scale: number; rotation?: number }): { width: number; height: number } =>
          ({ width: w, height: h }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function croppedDoc(numPages = 5): PDFDocumentProxy {
  return makeDocStub(numPages, (n) => (n === 1 ? CROPPED_PAGE_1 : FULL_PAGE));
}

function docWithFirstPage(dims: Dims, numPages = 5): PDFDocumentProxy {
  return makeDocStub(numPages, (n) => (n === 1 ? dims : FULL_PAGE));
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

const BASE_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

/** The fake viewport is 1200px wide / 800px tall; the fit scale is computed
 *  against the viewport minus the Phase-107 logical fit margin on each side
 *  (FIT_MARGIN_PX = 28 -> 1144 x 744). CONTENT_PADDING_PX stays 0. */
const AVAIL_W = 1200 - FIT_MARGIN_PX * 2; // 1144
const AVAIL_H = 800 - FIT_MARGIN_PX * 2; // 744
const fitWidth = (w: number): number => AVAIL_W / w;
const fitPage = (w: number, h: number): number => Math.min(AVAIL_W / w, AVAIL_H / h);
const rounded = (scale: number): number => Math.round(scale * 100) / 100;

interface Harness {
  host: HTMLElement;
  diag: () => DocDiagnostics | null;
  persisted: () => PersistedViewer | null;
  swapDoc: (doc: PDFDocumentProxy) => void;
  zoomPercentText: () => string;
  clickFitWidth: () => void;
  unmount: () => void;
}

async function mountView(
  initial: PersistedViewer = BASE_VIEWER,
  doc: PDFDocumentProxy = makeDocStub(5),
): Promise<Harness> {
  installScrollFakes();
  const pageCount = 5;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const engineState = makeEngineState(pageCount);
  const diagBox: { v: DocDiagnostics | null } = { v: null };
  const persBox: { v: PersistedViewer | null } = { v: null };
  const nodes = { doc, initial };

  const render = (): void => {
    act((): void => {
      root.render(
        <DocumentView
          doc={nodes.doc}
          pageCount={pageCount}
          outline={null}
          initial={nodes.initial}
          onPersist={(v): void => {
            persBox.v = v;
          }}
          onDiagnostics={(d): void => {
            diagBox.v = d;
          }}
          engineState={engineState}
          modified={false}
          canUndo={false}
          saveInPlaceEnabled={false}
          annotations={[]}
          formFields={[]}
          signatures={[]}
          savedSignatures={[]}
          stampAnnotations={[]}
        />,
      );
    });
  };

  render();
  await settle();

  return {
    host,
    diag: (): DocDiagnostics | null => diagBox.v,
    persisted: (): PersistedViewer | null => persBox.v,
    swapDoc: (next: PDFDocumentProxy): void => {
      nodes.doc = next;
      render();
    },
    zoomPercentText: (): string => {
      const el = host.querySelector<HTMLElement>(".zoom-percent");
      return el?.textContent?.trim() ?? "";
    },
    clickFitWidth: (): void => {
      const btn = host.querySelector<HTMLButtonElement>('button[title="Fit width"]');
      if (btn === null) throw new Error("fit-width button not mounted");
      act((): void => {
        btn.click();
      });
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("crop does not re-scale the fit — the zoom-jump regression", () => {
  it("fit-width: zoom mode + scale for uncropped pages unchanged across the proxy refresh", async () => {
    const h = await mountView();
    try {
      const before = h.diag();
      expect(before).not.toBeNull();
      expect(before?.mode).toBe("fit-width");
      expect(before?.zoom).toBeCloseTo(rounded(fitWidth(FULL_PAGE.w)), 2);
      expect(h.zoomPercentText()).toBe(`${Math.round(fitWidth(FULL_PAGE.w) * 100)}%`);

      // Crop page 1 -> proxy refresh swaps the doc; page 1 shrinks to
      // 400x500 while pages 2..5 keep 612x792.
      h.swapDoc(croppedDoc());
      await settle();

      const after = h.diag();
      expect(after).not.toBeNull();
      // THE FIX: the scale must NOT recompute from the cropped page 1.
      expect(after?.mode).toBe("fit-width");
      expect(after?.zoom).toBeCloseTo(before?.zoom ?? -1, 2);
      expect(h.zoomPercentText()).toBe(`${Math.round(fitWidth(FULL_PAGE.w) * 100)}%`);
      expect(h.persisted()?.zoomMode).toBe("fit-width");
      expect(h.persisted()?.manualScale).toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("fit-page: scale unchanged across the crop refresh too", async () => {
    const initial: PersistedViewer = { ...BASE_VIEWER, zoomMode: "fit-page" };
    const h = await mountView(initial);
    try {
      const before = h.diag();
      expect(before?.mode).toBe("fit-page");
      expect(before?.zoom).toBeCloseTo(rounded(fitPage(FULL_PAGE.w, FULL_PAGE.h)), 2);

      h.swapDoc(croppedDoc());
      await settle();

      const after = h.diag();
      expect(after?.mode).toBe("fit-page");
      expect(after?.zoom).toBeCloseTo(before?.zoom ?? -1, 2);
      expect(h.persisted()?.zoomMode).toBe("fit-page");
    } finally {
      h.unmount();
    }
  });

  it("crop undo (restored full-size page 1) shows no jump when the anchor was preserved", async () => {
    const h = await mountView();
    try {
      const before = h.diag()?.zoom ?? -1;

      // Crop page 1 (anchor preserved -> scale stable).
      h.swapDoc(croppedDoc());
      await settle();
      expect(h.diag()?.zoom).toBeCloseTo(before, 2);

      // Undo the crop -> proxy refresh returns the ORIGINAL bytes; the
      // restored page-1 size equals the anchor, so the scale must stay
      // put (no reverse jump).
      h.swapDoc(makeDocStub(5));
      await settle();
      expect(h.diag()?.zoom).toBeCloseTo(before, 2);
      expect(h.diag()?.mode).toBe("fit-width");
    } finally {
      h.unmount();
    }
  });

  it("manual zoom keeps the exact manual scale across a crop refresh", async () => {
    const initial: PersistedViewer = { ...BASE_VIEWER, zoomMode: "manual", manualScale: 1.5 };
    const h = await mountView(initial);
    try {
      expect(h.diag()?.zoom).toBeCloseTo(1.5, 2);

      h.swapDoc(croppedDoc());
      await settle();

      expect(h.diag()?.zoom).toBeCloseTo(1.5, 2);
      expect(h.persisted()?.zoomMode).toBe("manual");
      expect(h.persisted()?.manualScale).toBe(1.5);
    } finally {
      h.unmount();
    }
  });

  it("an explicit fit-width click after the crop re-anchors to the current page-1 size", async () => {
    const h = await mountView();
    try {
      h.swapDoc(croppedDoc());
      await settle();
      // The refresh itself must not re-anchor.
      expect(h.diag()?.zoom).toBeCloseTo(rounded(fitWidth(FULL_PAGE.w)), 2);

      // But an explicit user fit action means "fit now" -> re-anchor to
      // the live (post-crop) page-1 width.
      h.clickFitWidth();
      await settle();
      expect(h.diag()?.zoom).toBeCloseTo(rounded(fitWidth(CROPPED_PAGE_1.w)), 2);
      expect(h.zoomPercentText()).toBe(`${Math.round(fitWidth(CROPPED_PAGE_1.w) * 100)}%`);
    } finally {
      h.unmount();
    }
  });

  it("a refresh that is NOT an inset (page-1 identity change) re-anchors the fit", async () => {
    const h = await mountView();
    try {
      expect(h.diag()?.zoom).toBeCloseTo(rounded(fitWidth(FULL_PAGE.w)), 2);

      // Insert / open a different file whose page 1 is LARGER — a genuine
      // page identity change, not a crop. The fit should re-anchor.
      h.swapDoc(docWithFirstPage(GROWN_PAGE_1));
      await settle();
      expect(h.diag()?.zoom).toBeCloseTo(rounded(fitWidth(GROWN_PAGE_1.w)), 2);
    } finally {
      h.unmount();
    }
  });

  it("a second, deeper crop of page 1 still does not re-anchor the fit", async () => {
    const h = await mountView();
    try {
      h.swapDoc(croppedDoc());
      await settle();
      const afterFirstCrop = h.diag()?.zoom ?? -1;

      // User crops page 1 a second time (300x396). The anchor stays at the
      // pre-crop reference, so the scale remains stable through both
      // refreshes.
      h.swapDoc(docWithFirstPage(INSET_PAGE_1));
      await settle();
      expect(h.diag()?.zoom).toBeCloseTo(afterFirstCrop, 2);
      expect(h.diag()?.zoom).toBeCloseTo(rounded(fitWidth(FULL_PAGE.w)), 2);
    } finally {
      h.unmount();
    }
  });
});