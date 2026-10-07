// @vitest-environment jsdom
//
// Phase 40 (items 9 + 10).
//
// Item 9 (criterion 10) — the page rotate/delete control that appeared under
// the thumbnail when a page was selected is RETIRED in BOTH single and multi
// mode (DOM assertion). The capabilities keep their OTHER homes: the Action
// Dock's PAGES verbs (rotate / delete) and the page right-click menu.
//
// Item 10 (re-baselined by Phase 111 chunk A) — the Outline is a full-height
// navigator VIEW (Pages / Outline) filling the panel body, not a collapsible
// section. The old `data-outline-open` disclosure and its toggle are retired.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ContextPanel,
  buildPageMenuItems,
} from "../../../src/renderer/components/ContextPanel";
import { DOCK_STAGE_IDS } from "../../../src/renderer/state/toolsRegistry";
import type { RailTab } from "../../../src/renderer/components/SideRail";
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

const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [2], children: [] },
  { title: "Chapter 2", dest: [4], children: [] },
];

interface PanelOptions {
  pageCount?: number;
  outline?: OutlineNode[] | null;
  pageSelection?: readonly number[] | null;
  onPageSelectionChange?: ((pages: number[]) => void) | null;
  railTab?: RailTab;
  onRailTabChange?: (tab: RailTab) => void;
}

function renderPanel(options: PanelOptions = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const pageCount = options.pageCount ?? 3;
  act((): void => {
    root.render(
      <ContextPanel
        doc={makeDocStub(pageCount)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(pageCount)}
        proxyVisibleOrder={false}
        canUndo={false}
        onOp={(): void => undefined}
        onDelete={(): void => undefined}
        onReorder={(): void => undefined}
        onUndo={(): void => undefined}
        onJump={(): void => undefined}
        outline={options.outline === undefined ? null : options.outline}
        pageSelection={options.pageSelection ?? null}
        onPageSelectionChange={options.onPageSelectionChange ?? null}
        railTab={options.railTab}
        onRailTabChange={options.onRailTabChange}
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

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const SIDE_RAIL_SRC = readFileSync(
  resolve(__dirname, "../../../src/renderer/components/SideRail.tsx"),
  "utf8",
);

function ruleBody(selector: string): string {
  const m = new RegExp(
    `(?:^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(STYLES);
  return m?.[1] ?? "";
}

beforeEach((): void => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      void this;
      return {
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        clearRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    },
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Item 9 — the under-thumbnail action bar is retired; its capability homes stay
// ---------------------------------------------------------------------------

describe("Phase 40 item 9 — the under-thumbnail rotate/delete bar is retired", () => {
  it("single mode: selecting a page renders NO action bar under the thumbnails", () => {
    const { host, unmount } = renderPanel({ pageCount: 4 });
    try {
      // A Ctrl-click selects (a plain click only jumps).
      const t = host.querySelector<HTMLElement>('.thumb-item[data-page="2"]');
      expect(t).not.toBeNull();
      act((): void => {
        t?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
        );
      });
      expect(host.querySelector("[data-rail-action-bar]")).toBeNull();
      expect(host.querySelector(".rail-actions-bar")).toBeNull();
      // The per-page verbs of that bar are gone too.
      expect(host.querySelector('[aria-label="Rotate counter-clockwise"]')).toBeNull();
      expect(host.querySelector('[aria-label="Delete this page"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("multi mode: exactly one selected page renders NO action bar either", () => {
    const { host, unmount } = renderPanel({
      pageCount: 4,
      pageSelection: [2],
      onPageSelectionChange: (): void => undefined,
    });
    try {
      expect(host.querySelector("[data-rail-action-bar]")).toBeNull();
      expect(host.querySelector(".rail-actions-bar")).toBeNull();
      // The selection itself is still live (the multi-select model is intact).
      expect(host.querySelector('.thumb-item[data-page="2"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps rotate + delete reachable from the dock and the right-click menu", () => {
    // Home 1 — the Action Dock's PAGES verb set.
    expect(DOCK_STAGE_IDS.pages).toContain("rotate");
    expect(DOCK_STAGE_IDS.pages).toContain("delete");
    // Home 2 — the page right-click menu items.
    const ids = buildPageMenuItems(2, {
      onRotateCw: (): void => undefined,
      onRotateCcw: (): void => undefined,
      onExtract: (): void => undefined,
      onInsertBlank: (): void => undefined,
      onReplace: (): void => undefined,
      onDeletePage: (): void => undefined,
    }).map((i) => i.id);
    expect(ids).toContain("rotate-cw");
    expect(ids).toContain("rotate-ccw");
    expect(ids).toContain("delete");
  });

  it("the bar's markup and styles are gone; the shared Undo control survives", () => {
    expect(SIDE_RAIL_SRC).not.toContain("data-rail-action-bar");
    expect(SIDE_RAIL_SRC).not.toContain("ThumbActions");
    for (const dead of [
      ".rail-actions-bar",
      ".rail-actions-label",
      ".rail-actions-btns",
      ".rail-action-danger",
      ".rail-action-close",
    ]) {
      expect(ruleBody(dead), `${dead} is retired`).toBe("");
    }
    // The Undo row and its shared button class stay (they are a different
    // control and still render).
    expect(ruleBody(".rail-actions")).toMatch(/display:\s*flex/);
    expect(ruleBody(".rail-action-btn")).toMatch(/cursor:\s*pointer/);
  });
});

// ---------------------------------------------------------------------------
// Item 10 (re-baselined by Phase 111 chunk A) — the Outline is a full-height
// navigator VIEW (Pages / Outline), not a collapsible section. The old
// `data-outline-open` disclosure is retired; the view fills the panel body and
// the bounded body frames the re-parented tree.
// ---------------------------------------------------------------------------

describe("Phase 111 (chunk A) — the Outline view is a full-height navigator view", () => {
  it("mounts the Outline view from railTab and mounts only that view", () => {
    const onRailTabChange = vi.fn();
    const pages = renderPanel({ pageCount: 4, outline: OUTLINE, onRailTabChange });
    try {
      expect(pages.host.querySelector("[data-context-panel-outline]")).toBeNull();
      expect(pages.host.querySelectorAll(".thumb-item").length).toBe(4);
      // The panel's own Outline tab reports the host-owned view.
      clickOn(pages.host.querySelector('[data-context-panel-view-tab="outline"]') as Element);
      expect(onRailTabChange).toHaveBeenLastCalledWith("outline");
      expect(pages.host.querySelector("[data-outline-toggle]")).toBeNull();
    } finally {
      pages.unmount();
    }
    const outline = renderPanel({ pageCount: 4, outline: OUTLINE, railTab: "outline" });
    try {
      expect(outline.host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      expect(outline.host.querySelector("[data-context-panel-outline-body]")).not.toBeNull();
      expect(outline.host.querySelectorAll(".thumb-item").length).toBe(0);
    } finally {
      outline.unmount();
    }
  });

  it("the full-height view rule fills the panel body and bounds the tree", () => {
    const view = ruleBody(".context-panel-view-body");
    expect(view).toMatch(/flex:\s*1 1 auto/);
    expect(view).toMatch(/min-height:\s*0/);
    // The flush no longer rides on a `:has()` query.
    expect(STYLES).not.toContain(":has(.context-panel-outline-body)");
    // The body is the bounded box that frames the re-parented tree.
    const body = ruleBody(".context-panel-outline-body");
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/overflow:\s*hidden/);
    // The old disclosure state attribute and its rule are retired.
    expect(STYLES).not.toContain("data-outline-open");
    expect(STYLES).not.toContain(".context-panel-section-toggle");
  });
});


