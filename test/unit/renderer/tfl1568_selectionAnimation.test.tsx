// @vitest-environment jsdom
//
// TFL-1589 — the PAGES selection summary's animated transitions.
//
// The summary card appears / dismisses through an AnimatePresence + motion.div
// boundary (scale-fade) and its count / range values crossfade on change. These
// tests pin: the motion wrapper, the exit hold before unmount, the value
// re-key (crossfade, not a hard cut) and the reduced-motion collapse.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    g.IntersectionObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (g.ResizeObserver === undefined) {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
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
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
}

function installReducedMotionStub(matches: boolean): void {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (query: string): FakeMql => {
    mql.media = query;
    return mql;
  };
}

const originalMatchMedia = window.matchMedia;

interface Rendered {
  host: HTMLElement;
  rerender: (selection: readonly number[]) => void;
  unmount: () => void;
}

function renderPanel(pageSelection: readonly number[]): Rendered {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const draw = (selection: readonly number[]): void => {
    act((): void => {
      root.render(
        <ContextPanel
          stage="pages"
          doc={makeDocStub(6)}
          currentPage={1}
          defaultWidthPt={612}
          defaultHeightPt={792}
          engineState={makeEngineState(6)}
          canUndo={false}
          onJump={(): void => undefined}
          outline={null}
          pageSelection={selection}
          onPageSelectionChange={null}
        />,
      );
    });
  };
  draw(pageSelection);
  return {
    host,
    rerender: (selection): void => draw(selection),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function flushFrame(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach((): void => {
  installReducedMotionStub(false);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((): CanvasRenderingContext2D =>
      ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D),
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "matchMedia");
  } else {
    window.matchMedia = originalMatchMedia;
  }
  vi.restoreAllMocks();
});

describe("TFL-1589 — selection summary animation", () => {
  it("mounts the card inside a motion.div when one or more pages are selected", () => {
    const { host, unmount } = renderPanel([2, 3]);
    try {
      const card = host.querySelector("[data-context-panel-selection]");
      expect(card).not.toBeNull();
      const motionEl = host.querySelector<HTMLElement>("[data-context-panel-selection-motion]");
      expect(motionEl).not.toBeNull();
      expect(motionEl?.tagName).toBe("DIV");
      expect(motionEl?.contains(card)).toBe(true);
      // motion/react owns the wrapper's inline style (opacity/transform).
      expect(motionEl?.hasAttribute("style")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("renders no motion wrapper when nothing is selected", () => {
    const { host, unmount } = renderPanel([]);
    try {
      expect(host.querySelector("[data-context-panel-selection]")).toBeNull();
      expect(host.querySelector("[data-context-panel-selection-motion]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("holds the card through its exit, then unmounts when the selection clears", async () => {
    const { host, rerender, unmount } = renderPanel([2, 3]);
    try {
      expect(host.querySelector("[data-context-panel-selection]")).not.toBeNull();
      rerender([]);
      // AnimatePresence keeps the dismissing card mounted for its exit.
      expect(host.querySelector("[data-context-panel-selection]")).not.toBeNull();
      await flushFrame();
      expect(host.querySelector("[data-context-panel-selection]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("re-keys the count value so a change crossfades instead of cutting", async () => {
    const { host, rerender, unmount } = renderPanel([2, 3]);
    try {
      const first = host.querySelector("[data-context-panel-selection-count-value]");
      expect(first?.textContent).toBe("2 selected");
      rerender([2, 3, 4]);
      await flushFrame();
      const next = host.querySelector("[data-context-panel-selection-count-value]");
      expect(next?.textContent).toBe("3 selected");
      expect(host.querySelector("[data-context-panel-selection-count]")?.textContent).toContain(
        "3 selected",
      );
      expect(host.querySelector("[data-context-panel-selection-range-value]")?.textContent).toBe(
        "Pages 2-4",
      );
    } finally {
      unmount();
    }
  });

  it("collapses to instant under reduced motion (no scale transform on the wrapper)", () => {
    installReducedMotionStub(true);
    const { host, unmount } = renderPanel([2, 3]);
    try {
      const motionEl = host.querySelector<HTMLElement>("[data-context-panel-selection-motion]");
      expect(motionEl).not.toBeNull();
      // Reduced motion drops the scale transform entirely (opacity-only).
      expect(motionEl?.style.transform).toBe("");
    } finally {
      unmount();
    }
  });
});
