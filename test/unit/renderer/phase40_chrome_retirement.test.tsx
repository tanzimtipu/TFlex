// @vitest-environment jsdom
//
// Phase 40 (items 9 + 10).
//
// Item 9 (criterion 10) — the page rotate/delete control that appeared under
// the thumbnail when a page was selected is RETIRED in BOTH single and multi
// mode (DOM assertion). The capabilities keep their OTHER homes: the Action
// Dock's PAGES verbs (rotate / delete) and the page right-click menu.
//
// Item 10 (criterion 11) — the Outline's EXPANDED state is flush with the
// panel bottom. The flush is driven by the section's own `data-outline-open`
// state attribute (not a `:has()` dependency), and the section stays the
// panel body's last in-flow flex child with a definite height.

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
// Item 10 — the Outline's expanded state is flush with the panel bottom
// ---------------------------------------------------------------------------

describe("Phase 40 item 10 — the Outline is flush when expanded", () => {
  it("exposes the expanded state on the section (open by default, toggles)", () => {
    const { host, unmount } = renderPanel({ pageCount: 4, outline: OUTLINE });
    try {
      const section = host.querySelector("[data-context-panel-outline]");
      expect(section).not.toBeNull();
      expect(section?.getAttribute("data-outline-open")).toBe("true");
      const toggle = host.querySelector<HTMLButtonElement>("[data-outline-toggle]");
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      clickOn(toggle as HTMLButtonElement);
      expect(section?.getAttribute("data-outline-open")).toBe("false");
      clickOn(toggle as HTMLButtonElement);
      expect(section?.getAttribute("data-outline-open")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("the expanded flush rule keys on data-outline-open and pins a definite height", () => {
    const open = ruleBody(".context-panel-outline[data-outline-open='true']");
    expect(open, "the expanded section has a definite height rule").toMatch(/height:\s*40%/);
    expect(open, "the section cannot shrink off the panel bottom").toMatch(/flex:\s*0 0 40%/);
    // The flush no longer rides on a `:has()` query.
    expect(STYLES).not.toContain(":has(.context-panel-outline-body)");
    // The body is the bounded, definite-height box that fills to the section
    // bottom (the panel body's last in-flow child).
    const body = ruleBody(".context-panel-outline-body");
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });
});


