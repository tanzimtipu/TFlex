// @vitest-environment jsdom
//
// TFL-1116 R04 - navigation synchronization.
//
// One document-scoped navigation model: a COMMITTED page jump (the
// ViewStrip input, the Next/Previous verbs, an external request, an
// outline/annotation jump or the initial-page restore) must reveal the
// viewed page's thumbnail, while an ordinary main-view scroll must NOT
// recentre the rail (the Bug 3 gate). The persisted reading page must be
// the SETTLED canvas page, never a mid-flight optimistic value.
//
// Part 1 pins the rail gate directly: a `revealSeq` bump recentres the
// scroller; a scroll-driven `currentPage` change does not.
// Part 2 mounts the real DocumentView, issues an external committed jump
// through `jumpRequest`, and asserts the persisted page equals the page
// the canvas actually settles on.

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import { slotOffsetTop, CONTENT_PADDING_PX, FIT_MARGIN_PX } from "../../../src/renderer/components/pageGeometry";

// ---------------------------------------------------------------------------
// shared fake scroll surface
// ---------------------------------------------------------------------------
const scrollState = new WeakMap<Element, number>();
const scrollWrites: number[] = [];
const smoothTargets = new WeakMap<Element, number>();

function installScrollFakes(): void {
  const p = window.HTMLElement.prototype as unknown as {
    scrollTop?: number;
    clientHeight?: number;
    clientWidth?: number;
    scrollHeight?: number;
    scrollTo?: (o: { top: number; behavior?: ScrollBehavior }) => void;
  };
  Object.defineProperty(p, "scrollTop", {
    configurable: true,
    get(this: Element): number {
      return scrollState.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      const next = Math.max(0, v);
      const changed = (scrollState.get(this) ?? 0) !== next;
      scrollState.set(this, next);
      scrollWrites.push(next);
      if (changed) this.dispatchEvent(new Event("scroll", { bubbles: true }));
    },
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
  Object.defineProperty(p, "scrollHeight", {
    configurable: true,
    get(): number {
      return 100000;
    },
  });
  if (typeof p.scrollTo !== "function") {
    p.scrollTo = function (this: Element, o: { top: number; behavior?: ScrollBehavior }): void {
      if ((o.behavior ?? "instant") === "smooth") {
        smoothTargets.set(this, Math.max(0, o.top));
      } else {
        smoothTargets.delete(this);
        (this as unknown as { scrollTop: number }).scrollTop = Math.max(0, o.top);
      }
    };
  }
}

function advanceSmooth(el: Element, dt: number): void {
  const target = smoothTargets.get(el);
  if (target === undefined) return;
  const cur = scrollState.get(el) ?? 0;
  const next = cur < target ? Math.min(target, cur + dt) : Math.max(target, cur - dt);
  (el as unknown as { scrollTop: number }).scrollTop = next;
  if (next === target) smoothTargets.delete(el);
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(_n: number): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
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

const FRAME_MS = 25;
async function flushRaf(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

// ---------------------------------------------------------------------------
// Part 1 - the rail reveal gate
// ---------------------------------------------------------------------------
interface RailHarness {
  host: HTMLElement;
  scroller: HTMLElement;
  render: (currentPage: number, revealSeq: number) => void;
  unmount: () => void;
}

function mountRail(startPage: number): RailHarness {
  installScrollFakes();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const pageCount = 12;
  const engineState = makeEngineState(pageCount);
  const visibleToSource = new Map<number, number>();
  engineState.pageOrder.forEach((_src, i) => visibleToSource.set(i + 1, i + 1));
  const render = (currentPage: number, revealSeq: number): void => {
    act((): void => {
      root.render(
        <ThumbnailRail
          doc={makeDocStub(pageCount)}
          pageCount={pageCount}
          currentPage={currentPage}
          revealSeq={revealSeq}
          aspectRatio={792 / 612}
          rotations={engineState.rotations}
          visibleToSource={visibleToSource}
          proxyVisibleOrder={false}
          canUndo={false}
          onJump={(): void => undefined}
        />,
      );
    });
  };
  render(startPage, 0);
  const scroller = host.querySelector<HTMLElement>(".thumb-scroller-inner");
  if (scroller === null) throw new Error("thumb scroller not mounted");
  return {
    host,
    scroller,
    render,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("TFL-1116 R04 - rail reveal gate", () => {
  it("a committed external jump (revealSeq bump) recentres the viewed thumb", () => {
    const h = mountRail(1);
    try {
      h.scroller.scrollTop = 500;
      scrollWrites.length = 0;
      // An external committed jump: currentPage moves AND the host bumps
      // revealSeq (DocumentView.jumpToPage). The rail must scroll the viewed
      // page into view.
      h.render(6, 1);
      expect(scrollWrites.length).toBeGreaterThan(0);
      expect(scrollState.get(h.scroller)).not.toBe(500);
    } finally {
      h.unmount();
    }
  });

  it("an ordinary main-view scroll (currentPage change, same revealSeq) does NOT recentre", () => {
    const h = mountRail(1);
    try {
      h.scroller.scrollTop = 500;
      scrollWrites.length = 0;
      // The main view scrolled; DocumentView pushed a new currentPage via the
      // scroll heuristic but did NOT commit a jump, so revealSeq is unchanged.
      h.render(2, 0);
      expect(scrollWrites.length).toBe(0);
      expect(scrollState.get(h.scroller)).toBe(500);
    } finally {
      h.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Part 2 - the persisted page equals the settled canvas page
// ---------------------------------------------------------------------------
const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

const FIT_SCALE = (1200 - FIT_MARGIN_PX * 2) / 612;
function pageTop(page: number): number {
  return slotOffsetTop(page, 792, FIT_SCALE) - CONTENT_PADDING_PX;
}

describe("TFL-1116 R04 - persisted page equals the settled page", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an external committed jump publishes the landed page as the stored reading page", async () => {
    installScrollFakes();
    scrollWrites.length = 0;
    const pageCount = 60;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const engineState = makeEngineState(pageCount);
    const persBox: { v: PersistedViewer | null } = { v: null };
    const nodes = { doc: makeDocStub(pageCount) };
    const render = (jumpRequest: { page: number; seq: number } | null): void => {
      act((): void => {
        root.render(
          <DocumentView
            doc={nodes.doc}
            pageCount={pageCount}
            outline={null}
            initial={INITIAL_VIEWER}
            jumpRequest={jumpRequest}
            onPersist={(v): void => {
              persBox.v = v;
            }}
            onDiagnostics={(_d: DocDiagnostics): void => undefined}
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
    try {
      render(null);
      // Let the stub's getPage(1) resolve and commit the first fit.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const scroller = host.querySelector<HTMLElement>(".document-scroller");
      if (scroller === null) throw new Error("document scroller not mounted");

      // A committed external jump (ViewStrip input / Next / external request).
      render({ page: 10, seq: 1 });
      expect(persBox.v?.currentPage).toBe(10);

      // Drive the smooth scroll to its landing.
      for (let i = 0; i < 40; i += 1) {
        advanceSmooth(scroller, 900);
        await flushRaf();
      }
      expect(scrollState.get(scroller)).toBeCloseTo(pageTop(10), 0);
      // The published reading page is the page the canvas actually settled on.
      expect(persBox.v?.currentPage).toBe(10);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});