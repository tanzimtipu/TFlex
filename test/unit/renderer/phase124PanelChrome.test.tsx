// @vitest-environment jsdom
//
// Phase 124 (chunk A) — the panel header chrome.
//
// The PAGES ContextPanel header retired its labelled "More" menu and now
// surfaces the three tools as direct IconButtons; both panel collapse controls
// were unified on one directional chevron. These tests pin:
//   (a) no `[data-context-panel-more]` / `[data-context-panel-more-menu]`, and
//       the three direct buttons render + fire their handlers;
//   (b) the ContextPanel collapse chevron flips (expanded left, collapsed right)
//       while `data-rail-collapse` / `data-collapse-direction` are unchanged;
//   (c) the Inspector collapse chevron flips (expanded right, collapsed left)
//       while `data-inspector-collapse` is unchanged.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
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

interface PanelOptions {
  pageCount?: number;
  outline?: OutlineNode[] | null;
  navigatorLayout?: "stacked" | "split";
  collapsed?: boolean;
  onNavigatorLayoutChange?: (layout: "stacked" | "split") => void;
  onMerge?: () => void;
  onRemoveBlankPages?: () => void;
  onToggleCollapsed?: () => void;
}

function renderPanel(options: PanelOptions = {}): {
  host: HTMLElement;
  rerender: (next: PanelOptions) => void;
  unmount: () => void;
} {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const draw = (current: PanelOptions): void => {
    const pageCount = current.pageCount ?? 3;
    act((): void => {
      root.render(
        <ContextPanel
          stage="pages"
          doc={makeDocStub(pageCount)}
          currentPage={1}
          defaultWidthPt={612}
          defaultHeightPt={792}
          engineState={makeEngineState(pageCount)}
          canUndo={false}
          onJump={(): void => undefined}
          outline={current.outline === undefined ? null : current.outline}
          navigatorLayout={current.navigatorLayout}
          collapsed={current.collapsed}
          onNavigatorLayoutChange={current.onNavigatorLayoutChange}
          onMerge={current.onMerge}
          onRemoveBlankPages={current.onRemoveBlankPages}
          onToggleCollapsed={current.onToggleCollapsed}
        />,
      );
    });
  };

  draw(options);
  return {
    host,
    rerender: (next: PanelOptions): void => draw(next),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  // jsdom reports clientHeight 0, which would always fall back to stacked.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((): CanvasRenderingContext2D => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D),
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("Phase 124 — the PAGES header tool buttons", () => {
  it("retires the More menu and renders three enabled direct buttons", () => {
    const p = renderPanel({
      onNavigatorLayoutChange: vi.fn(),
      onMerge: vi.fn(),
      onRemoveBlankPages: vi.fn(),
    });
    try {
      expect(p.host.querySelector("[data-context-panel-more]")).toBeNull();
      expect(p.host.querySelector("[data-context-panel-more-menu]")).toBeNull();
      for (const hook of [
        "[data-context-panel-layout-split]",
        "[data-context-panel-combine]",
        "[data-blank-scan-open]",
      ]) {
        const btn = p.host.querySelector<HTMLButtonElement>(hook);
        expect(btn, hook).not.toBeNull();
        expect(btn?.disabled, hook).toBe(false);
      }
    } finally {
      p.unmount();
    }
  });

  it("toggles the navigator layout to the opposite value", () => {
    const onNavigatorLayoutChange = vi.fn();
    const p = renderPanel({ onNavigatorLayoutChange });
    try {
      const toggle = p.host.querySelector("[data-context-panel-layout-split]");
      expect(toggle?.getAttribute("aria-label")).toBe("Use split layout");
      clickOn(toggle as Element);
      expect(onNavigatorLayoutChange).toHaveBeenLastCalledWith("split");

      p.rerender({ navigatorLayout: "split", onNavigatorLayoutChange });
      const stacked = p.host.querySelector("[data-context-panel-layout-split]");
      expect(stacked?.getAttribute("aria-label")).toBe("Use stacked layout");
      clickOn(stacked as Element);
      expect(onNavigatorLayoutChange).toHaveBeenLastCalledWith("stacked");
    } finally {
      p.unmount();
    }
  });

  it("fires onMerge and onRemoveBlankPages from their direct buttons", () => {
    const onMerge = vi.fn();
    const onRemoveBlankPages = vi.fn();
    const p = renderPanel({ onMerge, onRemoveBlankPages });
    try {
      clickOn(p.host.querySelector("[data-context-panel-combine]") as Element);
      expect(onMerge).toHaveBeenCalledTimes(1);
      clickOn(p.host.querySelector("[data-blank-scan-open]") as Element);
      expect(onRemoveBlankPages).toHaveBeenCalledTimes(1);
    } finally {
      p.unmount();
    }
  });

  it("omits Combine and Remove blank pages when the handlers are absent", () => {
    const p = renderPanel({});
    try {
      expect(p.host.querySelector("[data-context-panel-combine]")).toBeNull();
      expect(p.host.querySelector("[data-blank-scan-open]")).toBeNull();
    } finally {
      p.unmount();
    }
  });
});

describe("Phase 124 — unified panel collapse chevrons", () => {
  it("the ContextPanel chevron flips while the data hooks are unchanged", () => {
    const p = renderPanel({ collapsed: false, onToggleCollapsed: vi.fn() });
    try {
      const btn = (): HTMLElement | null => p.host.querySelector("[data-rail-collapse]");
      expect(btn()?.getAttribute("data-rail-collapse")).not.toBeNull();
      expect(btn()?.getAttribute("data-collapse-direction")).toBe("collapse");
      expect(btn()?.querySelector("svg.lucide-chevron-left")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-right")).toBeNull();

      p.rerender({ collapsed: true, onToggleCollapsed: vi.fn() });
      expect(btn()?.getAttribute("data-rail-collapse")).not.toBeNull();
      expect(btn()?.getAttribute("data-collapse-direction")).toBe("expand");
      expect(btn()?.querySelector("svg.lucide-chevron-right")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-left")).toBeNull();
    } finally {
      p.unmount();
    }
  });

  it("the Inspector chevron flips while data-inspector-collapse is unchanged", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const draw = (collapsed: boolean): void => {
      act((): void => {
        root.render(
          <Inspector
            stage="pages"
            selection={{ kind: "none" }}
            collapsed={collapsed}
            onToggleCollapsed={(): void => undefined}
          />,
        );
      });
    };
    try {
      draw(false);
      const btn = (): HTMLElement | null => host.querySelector("[data-inspector-collapse]");
      expect(btn()?.getAttribute("data-inspector-collapse")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-right")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-left")).toBeNull();

      draw(true);
      expect(btn()?.getAttribute("data-inspector-collapse")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-left")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-chevron-right")).toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
