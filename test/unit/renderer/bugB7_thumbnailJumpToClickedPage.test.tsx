// @vitest-environment jsdom
//
// B7 — thumbnail click must jump to the clicked visible page,
// not always to page 1.
//
// History: a defect had the rail pass the SOURCE page (after
// reorder) instead of the VISIBLE page to `onJump`, so clicking
// any thumbnail in a reordered doc jumped to source page 1
// instead of the clicked visible slot. The fix maps on the
// visible scale and threads the visible index through to the
// host's `jumpToPage(p)` (which then sets `currentPage` and
// scrolls the scroller to the slot's offset).
//
// We exercise the rail in isolation with a stub `onJump` and
// assert that:
//   1. Clicking a thumb passes the VISIBLE 1-based index to
//      `onJump`, not the source page.
//   2. With a reordered doc, the visible index and source
//      index disagree — `onJump` still receives the visible
//      index (which is what `jumpToPage` consumes for
//      `slotOffsetTop`).
//   3. Shift / Cmd / Ctrl-click does NOT call `onJump`
//      (it's a select gesture, not a navigate).
//   4. `data-page` on the thumb button reflects the visible
//      index, while `data-source-page` reflects the
//      underlying pdf.js page — two separate signals so
//      tests / e2e harnesses can target either scale.
//
// We also assert the structural contract on DocumentView:
// the rail's `onJump` is wired straight through to
// `jumpToPage(p)` so the visible index reaches the scroller
// unchanged (no remapping that could clip to page 1).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SideRail } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";
import * as fs from "node:fs";
import * as path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
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

const documentViewPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "DocumentView.tsx",
);
const documentViewSource = fs.readFileSync(documentViewPath, "utf8");

describe("B7 — thumbnail click jumps to the clicked VISIBLE page", () => {
  it("clicking thumb 3 in a 5-page doc calls onJump(3)", () => {
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      expect(thumb).not.toBeNull();
      if (thumb === null) return;
      act((): void => {
        thumb.click();
      });
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(3);
    } finally {
      unmount();
    }
  });

  it("clicking the last thumb (5) calls onJump(5), never onJump(1)", () => {
    // The original bug — every thumb click ended up at page 1
    // because `onJump` was wired to the source page. After a
    // reorder the source page 1 might NOT be visible at all,
    // so clicking thumb 5 (visible) used to call onJump(1).
    // We verify the click threads the visible index through.
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='5']");
      expect(thumb).not.toBeNull();
      if (thumb === null) return;
      act((): void => {
        thumb.click();
      });
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(5);
      expect(onJump).not.toHaveBeenCalledWith(1);
    } finally {
      unmount();
    }
  });

  it("after a reorder, visible and source indices disagree but onJump receives the VISIBLE index", () => {
    // 5-page doc, reordered so visible position 3 = source 4
    // (swap positions 1 and 3: [2, 1, 0, 3, 4] in 0-based = visible
    // 1 -> source 3, visible 2 -> source 2, visible 3 -> source 1,
    // visible 4 -> source 4, visible 5 -> source 5). After this
    // mapping, clicking visible slot 3 should NOT call onJump(1)
    // (which is the source index for that slot). The fix threads
    // the visible index through; the bug passed the source index.
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
      pageOrder: [2, 1, 0, 3, 4],
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      expect(thumb).not.toBeNull();
      if (thumb === null) return;
      act((): void => {
        thumb.click();
      });
      expect(onJump).toHaveBeenCalledWith(3);
      // Source index for visible slot 3 is pageOrder[2]+1 = 1.
      // The thumb's data-source-page attribute is the
      // underlying pdf.js page — different from the visible
      // index. Both signals live on the same button so e2e
      // harnesses can pick whichever they need.
      expect(thumb.getAttribute("data-source-page")).toBe("1");
      expect(thumb.getAttribute("data-page")).toBe("3");
    } finally {
      unmount();
    }
  });

  it("shift-click does NOT call onJump (multi-select path)", () => {
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      if (thumb === null) return;
      act((): void => {
        const evt = new MouseEvent("click", {
          bubbles: true,
          shiftKey: true,
        });
        thumb.dispatchEvent(evt);
      });
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("Cmd/Ctrl-click does NOT call onJump (multi-select path)", () => {
    const { host, onJump, unmount } = mountRail({
      pageCount: 5,
      currentPage: 1,
    });
    try {
      const thumb = host.querySelector<HTMLElement>("[data-page='3']");
      if (thumb === null) return;
      act((): void => {
        thumb.dispatchEvent(
          new MouseEvent("click", { bubbles: true, metaKey: true }),
        );
        thumb.dispatchEvent(
          new MouseEvent("click", { bubbles: true, ctrlKey: true }),
        );
      });
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("DocumentView wires SideRail onJump straight to jumpToPage(p) — no remap that could clip to page 1", () => {
    // The rail's `onJump` callback is wired through
    // `<SideRail onJump={(p): void => jumpToPage(p)} />` —
    // `p` is the visible 1-based index the rail passes and
    // `jumpToPage` consumes it directly. A future refactor
    // that remaps `p` (e.g. through `visibleToSourcePage`)
    // would re-introduce the bug because `jumpToPage` expects
    // the visible index for `slotOffsetTop`. Pin the contract.
    const rail = documentViewSource.match(
      /onJump=\{[^}]*\}/,
    );
    expect(rail).not.toBeNull();
    if (rail === null) return;
    expect(rail[0]).toMatch(/jumpToPage\(p\)/);
    expect(rail[0]).not.toMatch(/visibleToSourcePage/);
    expect(rail[0]).not.toMatch(/engineState\.pageOrder/);
  });
});