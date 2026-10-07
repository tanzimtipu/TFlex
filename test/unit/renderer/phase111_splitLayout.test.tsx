// @vitest-environment jsdom
//
// Phase 111 (chunk D1) — the persisted Split Navigator layout.
//
// The navigator can stack Pages above Outline with a resizable separator and
// independent scroll regions, or fall back to the full-height tabbed view when
// the panel is too short. These tests pin:
//   (a) the pure helpers (resolveNavigatorLayout / clampSplitRatio /
//       splitRatioAfterKey),
//   (b) the split render mounts BOTH views plus the role=separator divider,
//   (c) the stacked default mounts exactly ONE view (chunk A regression guard),
//   (d) the panel More menu toggles the layout.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ContextPanel,
  NAVIGATOR_MIN_SECTION_PX,
  clampSplitRatio,
  resolveNavigatorLayout,
  splitRatioAfterKey,
} from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

const MIDDOT = "\u00B7";

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

const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [2], children: [] },
  { title: "Chapter 2", dest: [4], children: [] },
];

interface PanelOptions {
  pageCount?: number;
  outline?: OutlineNode[] | null;
  navigatorLayout?: "stacked" | "split";
  navigatorSplitRatio?: number;
  onNavigatorLayoutChange?: (layout: "stacked" | "split") => void;
  onNavigatorSplitRatioChange?: (ratio: number) => void;
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
          navigatorSplitRatio={current.navigatorSplitRatio}
          onNavigatorLayoutChange={current.onNavigatorLayoutChange}
          onNavigatorSplitRatioChange={current.onNavigatorSplitRatioChange}
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

describe("Phase 111 chunk D1 — Split Navigator pure helpers", () => {
  it("resolves the effective layout from the measured body height", () => {
    expect(NAVIGATOR_MIN_SECTION_PX).toBe(180);
    expect(resolveNavigatorLayout("stacked", 1000)).toBe("stacked");
    expect(resolveNavigatorLayout("split", 500)).toBe("split");
    expect(resolveNavigatorLayout("split", 300)).toBe("stacked");
    // The threshold is 2 * 180 + 12 (divider).
    expect(resolveNavigatorLayout("split", 372)).toBe("split");
    expect(resolveNavigatorLayout("split", 371)).toBe("stacked");
  });

  it("clamps the split ratio to 0.1-0.9 and defaults non-finite to 0.6", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.05)).toBe(0.1);
    expect(clampSplitRatio(0.95)).toBe(0.9);
    expect(clampSplitRatio(Number.NaN)).toBe(0.6);
  });

  it("maps the separator keys to a clamped ratio, null for anything else", () => {
    expect(splitRatioAfterKey(0.6, "ArrowUp")).toBe(0.65);
    expect(splitRatioAfterKey(0.6, "ArrowDown")).toBe(0.55);
    expect(splitRatioAfterKey(0.6, "Home")).toBe(0.1);
    expect(splitRatioAfterKey(0.6, "End")).toBe(0.9);
    expect(splitRatioAfterKey(0.6, "Enter")).toBeNull();
    expect(splitRatioAfterKey(0.9, "ArrowUp")).toBe(0.9);
  });
});

describe("Phase 111 chunk D1 — the Split Navigator render", () => {
  it("mounts BOTH views plus a horizontal role=separator divider when split", () => {
    const { host, unmount } = renderPanel({
      pageCount: 3,
      outline: OUTLINE,
      navigatorLayout: "split",
      navigatorSplitRatio: 0.6,
    });
    try {
      const pages = host.querySelector('[data-context-panel-view="pages"]');
      const outline = host.querySelector('[data-context-panel-view="outline"]');
      expect(pages).not.toBeNull();
      expect(outline).not.toBeNull();
      // Independent bounded scroll regions.
      expect(pages?.querySelector("[data-context-panel-thumbs]")).not.toBeNull();
      expect(outline?.querySelector("[data-context-panel-outline-body]")).not.toBeNull();

      const divider = host.querySelector("[data-context-panel-split-divider]");
      expect(divider).not.toBeNull();
      expect(divider?.getAttribute("role")).toBe("separator");
      expect(divider?.getAttribute("aria-orientation")).toBe("horizontal");
      expect(divider?.getAttribute("aria-valuenow")).toBe("60");
      expect(divider?.getAttribute("aria-valuemin")).toBe("10");
      expect(divider?.getAttribute("aria-valuemax")).toBe("90");
      expect(divider?.getAttribute("aria-label")).toBe("Resize navigator sections");

      // The compact count titles carry the real counts in tabular figures.
      expect(host.querySelector('[data-context-panel-split-title="pages"]')?.textContent).toBe(
        `Pages ${MIDDOT} 3`,
      );
      expect(host.querySelector('[data-context-panel-split-title="outline"]')?.textContent).toBe(
        `Outline ${MIDDOT} 2`,
      );
    } finally {
      unmount();
    }
  });

  it("commits a keyboard ratio step through onNavigatorSplitRatioChange", () => {
    const onNavigatorSplitRatioChange = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 3,
      outline: OUTLINE,
      navigatorLayout: "split",
      navigatorSplitRatio: 0.6,
      onNavigatorSplitRatioChange,
    });
    try {
      const divider = host.querySelector("[data-context-panel-split-divider]") as HTMLElement;
      act((): void => {
        divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
      });
      expect(onNavigatorSplitRatioChange).toHaveBeenLastCalledWith(0.65);
      act((): void => {
        divider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
      });
      expect(onNavigatorSplitRatioChange).toHaveBeenLastCalledWith(0.1);
    } finally {
      unmount();
    }
  });

  it("falls back to exactly ONE view body when stacked (chunk A guard)", () => {
    const { host, unmount } = renderPanel({
      pageCount: 3,
      outline: OUTLINE,
      navigatorLayout: "stacked",
    });
    try {
      expect(host.querySelectorAll("[data-context-panel-view]").length).toBe(1);
      expect(host.querySelector('[data-context-panel-view="pages"]')).not.toBeNull();
      expect(host.querySelector("[data-context-panel-split-divider]")).toBeNull();
      expect(host.querySelector("[data-context-panel-view-tabs]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("falls back to stacked when the panel is too short even if split is persisted", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 300,
    });
    const { host, unmount } = renderPanel({
      pageCount: 3,
      outline: OUTLINE,
      navigatorLayout: "split",
    });
    try {
      expect(host.querySelectorAll("[data-context-panel-view]").length).toBe(1);
      expect(host.querySelector("[data-context-panel-split-divider]")).toBeNull();
      expect(host.querySelector("[data-context-panel-view-tabs]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk D1 — the layout menu", () => {
  it("opens the More menu and selects the split layout while stacked", () => {
    const onNavigatorLayoutChange = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onNavigatorLayoutChange });
    try {
      const more = host.querySelector<HTMLButtonElement>("[data-context-panel-more]");
      expect(more).not.toBeNull();
      clickOn(more as HTMLElement);
      const row = host.querySelector("[data-context-panel-layout-split]");
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("Use split layout");
      clickOn(row as HTMLElement);
      expect(onNavigatorLayoutChange).toHaveBeenLastCalledWith("split");
    } finally {
      unmount();
    }
  });

  it("offers the stacked layout once split is active", () => {
    const onNavigatorLayoutChange = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 3,
      navigatorLayout: "split",
      onNavigatorLayoutChange,
    });
    try {
      clickOn(host.querySelector("[data-context-panel-more]") as HTMLElement);
      const row = host.querySelector("[data-context-panel-layout-split]");
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("Use stacked layout");
      clickOn(row as HTMLElement);
      expect(onNavigatorLayoutChange).toHaveBeenLastCalledWith("stacked");
    } finally {
      unmount();
    }
  });
});

