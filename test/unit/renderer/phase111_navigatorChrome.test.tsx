// @vitest-environment jsdom
//
// Phase 111 (chunk A) — the PAGES ContextPanel's navigator chrome.
//
// The panel no longer stacks a collapsible Outline section under the thumbnails.
// It is ONE full-height navigator with two views (Pages / Outline) chosen by a
// real 40px tablist under the header. These tests pin:
//   (a) the tablist's real document counts (Pages . N / Outline . N),
//   (b) the default view is Pages (only the Pages view is mounted),
//   (c) railTab="outline" mounts the Outline view and drops the thumbnails,
//   (d) the tabs report the chosen tab through onRailTabChange,
//   (e) the retired disclosure hook [data-outline-toggle] is gone,
//   (f) an empty outline reads as the designed "No bookmarks" state with a
//       real "Outline . 0" count.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { RailTab } from "../../../src/renderer/components/SideRail";
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

/** Two real nodes -> "Outline . 2". */
const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [2], children: [] },
  { title: "Chapter 2", dest: [4], children: [] },
];

interface PanelOptions {
  pageCount?: number;
  outline?: OutlineNode[] | null;
  railTab?: RailTab;
  onRailTabChange?: (tab: RailTab) => void;
}

function renderPanel(
  options: PanelOptions = {},
): { host: HTMLElement; rerender: (next: PanelOptions) => void; unmount: () => void } {
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
          railTab={current.railTab}
          onRailTabChange={current.onRailTabChange}
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

function viewTab(host: HTMLElement, dataTab: "pages" | "outline"): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(
    `[data-context-panel-view-tab="${dataTab}"]`,
  );
  if (el === null) throw new Error(`no ${dataTab} view tab`);
  return el;
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  // jsdom reports clientHeight 0, which collapses the rail's visible range and
  // leaves every thumb unmounted; a fixed height mounts the first slots.
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

describe("Phase 111 chunk A — the navigator view selector", () => {
  it("renders a 40px tablist with the real Pages / Outline counts", () => {
    const { host, unmount } = renderPanel({ pageCount: 3, outline: OUTLINE });
    try {
      const tablist = host.querySelector("[data-context-panel-view-tabs]");
      expect(tablist).not.toBeNull();
      expect(tablist?.getAttribute("role")).toBe("tablist");
      expect(tablist?.getAttribute("aria-label")).toBe("Navigator view");
      expect(tablist?.classList.contains("context-panel-view-tabs")).toBe(true);
      const tabs = [...host.querySelectorAll("[data-context-panel-view-tab]")];
      expect(tabs.map((t) => t.getAttribute("data-context-panel-view-tab"))).toEqual([
        "pages",
        "outline",
      ]);
      expect(tabs.map((t) => t.getAttribute("role"))).toEqual(["tab", "tab"]);
      expect(tabs.map((t) => t.textContent)).toEqual([
        `Pages ${MIDDOT} 3`,
        `Outline ${MIDDOT} 2`,
      ]);
      // aria-controls points at the two view bodies the tabs own.
      expect(viewTab(host, "pages").getAttribute("aria-controls")).toBe("context-panel-view-pages");
      expect(viewTab(host, "outline").getAttribute("aria-controls")).toBe("context-panel-view-outline");
    } finally {
      unmount();
    }
  });

  it("counts EVERY outline node, children included", () => {
    const nested: OutlineNode[] = [
      { title: "A", dest: [1], children: [{ title: "A.1", dest: [2], children: [] }] },
    ];
    const { host, unmount } = renderPanel({ pageCount: 3, outline: nested });
    try {
      expect(viewTab(host, "outline").textContent).toBe(`Outline ${MIDDOT} 2`);
    } finally {
      unmount();
    }
  });

  it("defaults to the Pages view (no Outline view mounted)", () => {
    const { host, unmount } = renderPanel({ pageCount: 3, outline: OUTLINE });
    try {
      expect(host.querySelector('[data-context-panel-view="pages"]')).not.toBeNull();
      expect(host.querySelector("[data-context-panel-thumbs]")).not.toBeNull();
      expect(host.querySelectorAll(".thumb-item").length).toBe(3);
      expect(host.querySelector('[data-context-panel-view="outline"]')).toBeNull();
      expect(viewTab(host, "pages").getAttribute("aria-selected")).toBe("true");
      expect(viewTab(host, "outline").getAttribute("aria-selected")).toBe("false");
      expect(viewTab(host, "pages").getAttribute("tabindex")).toBe("0");
      expect(viewTab(host, "outline").getAttribute("tabindex")).toBe("-1");
    } finally {
      unmount();
    }
  });

  it('railTab="outline" mounts the full-height Outline view and drops the thumbnails', () => {
    const { host, unmount } = renderPanel({ pageCount: 3, outline: OUTLINE, railTab: "outline" });
    try {
      const outlineView = host.querySelector('[data-context-panel-view="outline"]');
      expect(outlineView).not.toBeNull();
      expect(outlineView?.classList.contains("context-panel-outline")).toBe(true);
      expect(host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      expect(host.querySelector("[data-context-panel-outline-body]")).not.toBeNull();
      expect(host.querySelector(".outline-panel")).not.toBeNull();
      expect(host.querySelector('[data-context-panel-view="pages"]')).toBeNull();
      expect(host.querySelector("[data-context-panel-thumbs]")).toBeNull();
      expect(host.querySelectorAll(".thumb-item").length).toBe(0);
      expect(viewTab(host, "outline").getAttribute("aria-selected")).toBe("true");
      expect(viewTab(host, "outline").getAttribute("tabindex")).toBe("0");
    } finally {
      unmount();
    }
  });

  it("clicking a tab reports the chosen tab to the host", () => {
    const onRailTabChange = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, outline: OUTLINE, onRailTabChange });
    try {
      clickOn(viewTab(host, "outline"));
      expect(onRailTabChange).toHaveBeenLastCalledWith("outline");
      clickOn(viewTab(host, "pages"));
      expect(onRailTabChange).toHaveBeenLastCalledWith("thumbs");
      expect(onRailTabChange).toHaveBeenCalledTimes(2);
      // The retired disclosure hook is gone.
      expect(host.querySelector("[data-outline-toggle]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("Left/Right on the tablist moves AND selects the other tab", () => {
    const onRailTabChange = vi.fn();
    const first = renderPanel({ pageCount: 3, outline: OUTLINE, onRailTabChange });
    try {
      act((): void => {
        first.host
          .querySelector("[data-context-panel-view-tabs]")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      });
      expect(onRailTabChange).toHaveBeenLastCalledWith("outline");
      expect(document.activeElement).toBe(viewTab(first.host, "outline"));
    } finally {
      first.unmount();
    }

    const second = renderPanel({ pageCount: 3, outline: OUTLINE, railTab: "outline", onRailTabChange });
    try {
      act((): void => {
        second.host
          .querySelector("[data-context-panel-view-tabs]")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
      });
      expect(onRailTabChange).toHaveBeenLastCalledWith("thumbs");
    } finally {
      second.unmount();
    }
  });

  it('renders the designed "No bookmarks" state in the Outline view with a real count', () => {
    const { host, unmount } = renderPanel({ pageCount: 3, outline: [], railTab: "outline" });
    try {
      expect(viewTab(host, "outline").textContent).toBe(`Outline ${MIDDOT} 0`);
      const empty = host.querySelector("[data-context-panel-outline-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("No bookmarks");
      expect(host.querySelector(".outline-panel")).toBeNull();
      expect(host.querySelector("[data-outline-toggle]")).toBeNull();
    } finally {
      unmount();
    }
  });
});
