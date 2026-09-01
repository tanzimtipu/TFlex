// @vitest-environment jsdom
//
// Regression guard for DEF-098 — the SideRail thumbnail click
// handler must call `onJump(visiblePage)`, not `onJump(sourcePage)`.
//
// The previous shape passed `label` directly into `onJump`, which
// happened to be correct (label is the visible 1-based index) but
// was implicit. A future refactor that pulled `page` (the source
// page, post-reorder) into the closure — or that aliased
// `label = page` somewhere — would silently pass the wrong value
// and the rail would jump to the wrong slot.
//
// We pin the contract by mounting the rail in isolation with a
// stub `onJump`, asserting the click handler passes the visible
// index, and additionally reading the SideRail source to confirm
// the click handler binds `label` to a local `visiblePage` so
// the assertion is loud at the call site.
//
// Coverage:
//   1. Click on thumb 3 in a 5-page doc calls onJump(3).
//   2. After a reorder, clicking visible slot 3 still calls
//      onJump(3) — never onJump(1) (which would be the source
//      page for that slot).
//   3. The SideRail source explicitly binds `visiblePage = label`
//      inside the click handler — not `visiblePage = page` (which
//      would be the source page).

import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as fs from "node:fs";
import * as path from "node:path";
import { SideRail } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

function makeDocStub(): PDFDocumentProxy {
  return {
    numPages: 5,
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
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

interface MountArgs {
  pageCount: number;
  currentPage: number;
  pageOrder?: number[];
  onJump?: (page: number) => void;
}

function mountRail(args: MountArgs): {
  host: HTMLElement;
  onJump: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const order = args.pageOrder ?? Array.from({ length: args.pageCount }, (_, i) => i);
  const engineState: EngineState = {
    pageCount: args.pageCount,
    pageOrder: order,
    rotations: order.map(() => 0) as EngineState["rotations"],
    deleted: order.map(() => false),
    modified: false,
    annotations: [],
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onJump = vi.fn(args.onJump ?? ((): void => undefined));
  act((): void => {
    root.render(
      <SideRail
        doc={makeDocStub()}
        pageCount={args.pageCount}
        outline={null}
        currentPage={args.currentPage}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={engineState}
        canUndo={false}
        onJump={onJump}
      />,
    );
  });
  return {
    host,
    onJump,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const sideRailPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "SideRail.tsx",
);
const sideRailSource = fs.readFileSync(sideRailPath, "utf8");

describe("DEF-098 — thumbnail click uses the visible page number", () => {
  it("clicking thumb 3 in a 5-page doc calls onJump(3)", () => {
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      if (thumb === null) throw new Error("thumb 3 not found");
      act((): void => {
        thumb.click();
      });
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(3);
    } finally {
      unmount();
    }
  });

  it("after a reorder, visible slot 3 still calls onJump(3) — not the source page", () => {
    // 5-page doc reordered so visible 3 -> source 1. The previous
    // bug passed the source page; this test pins the visible-
    // index path even when the source mapping disagrees.
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
      pageOrder: [2, 1, 0, 3, 4],
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      if (thumb === null) throw new Error("thumb 3 not found");
      act((): void => {
        thumb.click();
      });
      expect(onJump).toHaveBeenCalledWith(3);
      // And never the source page (1) for that slot.
      expect(onJump).not.toHaveBeenCalledWith(1);
    } finally {
      unmount();
    }
  });

  it("the SideRail source binds `visiblePage = label` inside the click handler", () => {
    // Structural guard: the click handler must explicitly bind
    // `label` (the visible 1-based index from the rail's loop)
    // to a local named `visiblePage` and pass `visiblePage` to
    // `onJump`. A refactor that passes `page` (the source page)
    // or drops the local binding trips this assertion.
    const handlerMatch = sideRailSource.match(
      /onClick=\{[\s\S]*?onJump\(visiblePage\)[\s\S]*?\}\s*\}/,
    );
    expect(handlerMatch).not.toBeNull();
    // Belt-and-braces: assert the explicit `const visiblePage = label;`
    // binding is in the click handler, so a future refactor can't
    // accidentally pass `page` to onJump.
    expect(sideRailSource).toMatch(/const\s+visiblePage\s*=\s*label\s*;/);
  });

  it("every thumbnail is reachable via the `.thumb-item` selector QA's e2e uses, and clicking it jumps", () => {
    // The e2e harness targets thumbnails with `.thumb-item`
    // (e.g. `.thumb-item` nth(1) = visible page 2). The class is an
    // ALIAS on the same interactive button that calls onJump — not a
    // separate marker surface. We assert the alias exists on the
    // clickable button and that clicking that exact element fires
    // the jump with the visible page number.
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const item = host.querySelector<HTMLElement>(".thumb-item");
      if (item === null) throw new Error(".thumb-item not found");
      // The alias sits on the same <button> that carries the page
      // data and the click handler.
      expect(item.tagName).toBe("BUTTON");
      expect(item.getAttribute("data-page")).toBe("1");
      act((): void => {
        item.click();
      });
      expect(onJump).toHaveBeenCalledWith(1);
    } finally {
      unmount();
    }
  });

  it("`.thumb-item` nth(1) is visible page 2 and clicking it calls onJump(2)", () => {
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const items = host.querySelectorAll<HTMLElement>(".thumb-item");
      expect(items.length).toBe(5);
      const second = items[1];
      if (second === undefined) throw new Error("second thumb missing");
      expect(second.getAttribute("data-page")).toBe("2");
      act((): void => {
        second.click();
      });
      expect(onJump).toHaveBeenCalledWith(2);
    } finally {
      unmount();
    }
  });

  it("the SideRail source does NOT bind `visiblePage = page` (which would be the source page)", () => {
    // The Thumb component receives `page` (source) and `label`
    // (visible) as separate props. The click handler must bind
    // visiblePage to `label`, never to `page`. A regression that
    // aliases them — `const visiblePage = page;` — would re-
    // introduce the bug exactly. We pin the negative here.
    expect(sideRailSource).not.toMatch(/const\s+visiblePage\s*=\s*page\s*;/);
  });
});