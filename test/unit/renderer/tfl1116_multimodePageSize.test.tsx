// @vitest-environment jsdom
//
// TFL-1116 (DEF-622) - Multi Mode must resolve EACH pane's OWN page size.
//
// Multi Mode reuses the SAME `.tab-pane` (keyed by tab id, no remount) and
// only flips `multiPane`, so entering Multi Mode / binding a document to a
// pane leaves `pageSizes` (and its identity) untouched. The page-size report
// effect originally keyed only on `[pageSizes]`, so the host's pane-keyed
// `livePageSizes` maps never received a report and the shared Inspector's Size
// row read "Not available" for a normally-opened document (DEF-622).
//
// These specs mount the REAL DocumentView and drive the REAL report effect:
//   1. a pane-scope change (`multiPane` null -> "A" -> "B") re-fires the
//      report with NO `pageSizes` change, so the host map receives this view's
//      OWN measured geometry under each pane key;
//   2. two views bound to A and B resolve their own distinct fixture geometry
//      (A 612x792, B 595x842) through the host's Inspector lookup.
//
// The single-pane DEF-620 behaviour is pinned separately in
// `tfl1116_pageSizeScope.test.ts`; this file only adds the re-report contract.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import { livePageSizeScopeKey } from "../../../src/renderer/state/pageSizeScope";
import { resolveInspectorPageSize } from "../../../src/renderer/components/Inspector";
import type { EngineState } from "../../../src/renderer/engine/types";

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

// jsdom has no layout: give the scroller a viewport so page 1 mounts and the
// PageView reports its measured size, exactly as a real window would.
function installScrollFakes(): void {
  const p = window.HTMLElement.prototype as unknown as {
    clientHeight?: number;
    clientWidth?: number;
    scrollTo?: (o: { top: number; behavior?: ScrollBehavior }) => void;
  };
  Object.defineProperty(p, "clientHeight", { configurable: true, get: (): number => 800 });
  Object.defineProperty(p, "clientWidth", { configurable: true, get: (): number => 1200 });
  if (typeof p.scrollTo !== "function") {
    p.scrollTo = function (this: Element, o: { top: number; behavior?: ScrollBehavior }): void {
      void this;
      void o;
    };
  }
}

function makeDocStub(w: number, h: number, numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, w, h],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: w,
          height: h,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
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

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

// A controllable animation-frame queue. The report effect coalesces to one
// report per frame, so the test drives the frame explicitly.
const rafQueue: Array<(t: number) => void> = [];
let rafSeq = 0;

function flushRaf(): void {
  for (let i = 0; i < 4 && rafQueue.length > 0; i += 1) {
    const cbs = rafQueue.splice(0);
    for (const cb of cbs) cb(0);
  }
}

async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await act(async (): Promise<void> => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushRaf();
    });
  }
}

type SizeMap = ReadonlyMap<number, { w: number; h: number }>;
type SizeMaps = Record<string, SizeMap>;

beforeEach((): void => {
  rafQueue.length = 0;
  rafSeq = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void): number => {
    rafSeq += 1;
    rafQueue.push(cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    void id;
  });
});

afterEach((): void => {
  vi.unstubAllGlobals();
});

interface Harness {
  rerender: (pane: "A" | "B" | null) => Promise<void>;
  unmount: () => void;
}

// Mount the REAL DocumentView and wire `onPageSizesReport` exactly as App does:
// key the shared host map by `livePageSizeScopeKey(pane, tabId)`.
async function mountView(args: {
  doc: PDFDocumentProxy;
  pageCount: number;
  pane: "A" | "B" | null;
  tabId: string;
  maps: SizeMaps;
}): Promise<Harness> {
  installScrollFakes();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let pane = args.pane;
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(DocumentView, {
          doc: args.doc,
          pageCount: args.pageCount,
          outline: null,
          initial: INITIAL_VIEWER,
          onPersist: (): void => undefined,
          onDiagnostics: (): void => undefined,
          engineState: makeEngineState(args.pageCount),
          canUndo: false,
          saveInPlaceEnabled: false,
          annotations: [],
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          multiPane: pane,
          onPageSizesReport: (sizes: SizeMap): void => {
            args.maps[livePageSizeScopeKey(pane, args.tabId)] = sizes;
          },
        }),
      );
    });
  };
  render();
  await settle();
  return {
    rerender: async (next: "A" | "B" | null): Promise<void> => {
      pane = next;
      render();
      await settle();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("TFL-1116 (DEF-622) — a pane-scope change re-publishes this view's measured map", () => {
  it("re-fires the report on entering Multi Mode and on pane reassignment, without a pageSizes change", async () => {
    const maps: SizeMaps = {};
    const view = await mountView({
      doc: makeDocStub(612, 792, 3),
      pageCount: 3,
      pane: null,
      tabId: "tab-a",
      maps,
    });
    // Single mode: the report lands under the ACTIVE TAB key (DEF-620).
    expect(maps["tab-a"]).toBeDefined();
    expect(resolveInspectorPageSize(1, maps["tab-a"], {})).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
    // No pane key exists yet: the Inspector reads "Not available" in Multi Mode.
    expect(maps["A"]).toBeUndefined();
    expect(maps["B"]).toBeUndefined();

    // Enter Multi Mode as pane A. `pageSizes` is unchanged and keeps its
    // identity; only `multiPane` flips, so the re-report can only come from the
    // new scope dependency.
    await view.rerender("A");
    expect(resolveInspectorPageSize(1, maps["A"], {})).toEqual({
      widthPt: 612,
      heightPt: 792,
    });

    // Re-bind the same document to pane B: the map follows the pane.
    await view.rerender("B");
    expect(resolveInspectorPageSize(1, maps["B"], {})).toEqual({
      widthPt: 612,
      heightPt: 792,
    });

    // Leave Multi Mode: back to the tab-keyed scope, still resolvable.
    await view.rerender(null);
    expect(resolveInspectorPageSize(1, maps["tab-a"], {})).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
    view.unmount();
  });

  it("resolves each pane's OWN geometry (A 612x792, B 595x842) through the host map", async () => {
    const maps: SizeMaps = {};
    const alpha = await mountView({
      doc: makeDocStub(612, 792, 3),
      pageCount: 3,
      pane: "A",
      tabId: "tab-alpha",
      maps,
    });
    const beta = await mountView({
      doc: makeDocStub(595, 842, 5),
      pageCount: 5,
      pane: "B",
      tabId: "tab-beta",
      maps,
    });
    // Focus pane A: the Inspector reads the map for "A".
    expect(resolveInspectorPageSize(1, maps[livePageSizeScopeKey("A", "tab-alpha")], {})).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
    // Focus pane B: the Inspector reads the map for "B".
    expect(resolveInspectorPageSize(1, maps[livePageSizeScopeKey("B", "tab-beta")], {})).toEqual({
      widthPt: 595,
      heightPt: 842,
    });
    alpha.unmount();
    beta.unmount();
  });
});
