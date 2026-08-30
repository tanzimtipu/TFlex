// @vitest-environment jsdom
//
// DEF-058 — SideRail current page highlight stuck on page 1.
//
// The rail's per-thumb `isCurrent` highlight was comparing
// `sourcePage === currentPage`. `sourcePage` is the underlying
// pdf.js page (after reorder, e.g. visible slot 4 might map to
// source page 2), while `currentPage` is the 1-based visible page
// index the user is on. The two are only equal at the very start
// of a doc, so any jump or reorder left the highlight stranded on
// page 1. The fix compares on the visible scale (the loop index
// `page` vs `currentPage`).
//
// These tests mount the ThumbnailRail with a stub pdf.js proxy
// (the real one needs a worker and a canvas backend) and assert
// that:
//   1. The highlight follows `currentPage` as it changes.
//   2. The highlight still uses the visible index after a
//      reorder (so a re-arranged doc still gets the right slot
//      painted).
//   3. Only the matching thumb gets the `.thumb-current` class.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SideRail } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

// jsdom doesn't ship IntersectionObserver or ResizeObserver. The
// ThumbnailRail uses both inside mount effects; without a stub the
// first render throws "IntersectionObserver is not defined". The
// stub is a no-op observer — the rail's `computeGeometryMount`
// still runs through its own bookkeeping so the highlight under
// test works without any real intersection events.
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

// ---------------------------------------------------------------------------
// Minimal pdf.js proxy stub.
//
// The ThumbnailRail calls `doc.getPage(n)` and then `pdfPage.view`,
// `pdfPage.getViewport`, and `pdfPage.render`. None of those need to
// actually paint anything for the highlight logic under test — only
// `currentPage` and the per-thumb props matter. The stub resolves
// immediately with a no-op render so the effect doesn't throw.

function makeStubDoc(): PDFDocumentProxy {
  return {
    numPages: 10,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
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

const ZERO_ROTATIONS: EngineState["rotations"] = new Array(10).fill(0) as EngineState["rotations"];

interface MountArgs {
  pageCount: number;
  currentPage: number;
  pageOrder?: number[];
}

function mountRail(args: MountArgs): { host: HTMLElement; rerender: (next: MountArgs) => void; unmount: () => void } {
  const order = args.pageOrder ?? Array.from({ length: args.pageCount }, (_, i) => i);
  const visibleToSource = new Map<number, number>();
  for (let i = 0; i < order.length; i += 1) {
    visibleToSource.set(i + 1, order[i] + 1);
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const render = (current: MountArgs): void => {
    const o = current.pageOrder ?? Array.from({ length: current.pageCount }, (_, i) => i);
    const m = new Map<number, number>();
    for (let i = 0; i < o.length; i += 1) {
      m.set(i + 1, o[i] + 1);
    }
    const engineState: EngineState = {
      pageCount: current.pageCount,
      pageOrder: o,
      rotations: ZERO_ROTATIONS,
      deleted: o.map(() => false),
      modified: false,
      annotations: [],
    };
    act((): void => {
      root.render(
        <SideRail
          doc={makeStubDoc()}
          pageCount={current.pageCount}
          outline={null}
          currentPage={current.currentPage}
          defaultWidthPt={612}
          defaultHeightPt={792}
          engineState={engineState}
          canUndo={false}
          onJump={(): void => undefined}
        />,
      );
    });
  };

  render(args);

  return {
    host,
    rerender: (next: MountArgs): void => render(next),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function currentThumbLabels(host: HTMLElement): number[] {
  return Array.from(host.querySelectorAll(".thumb.thumb-current")).map((el) =>
    Number((el as HTMLElement).dataset.page),
  );
}

describe("ThumbnailRail — current page highlight (DEF-058)", () => {
  it("highlights the visible page equal to currentPage on first mount", () => {
    const { host, unmount } = mountRail({ pageCount: 5, currentPage: 1 });
    try {
      expect(currentThumbLabels(host)).toEqual([1]);
    } finally {
      unmount();
    }
  });

  it("moves the highlight to currentPage=10 on jump (the DEF-058 repro)", () => {
    // The exact reproduction: a 10-page doc with currentPage=10 must
    // paint only the page-10 thumb as the current one. The previous
    // bug kept the highlight on page 1.
    const { host, unmount } = mountRail({ pageCount: 10, currentPage: 10 });
    try {
      expect(currentThumbLabels(host)).toEqual([10]);
    } finally {
      unmount();
    }
  });

  it("moves the highlight when currentPage changes (re-render)", () => {
    // The defect lives in the comparison; the same instance must
    // re-paint when the prop changes. The rail is a sibling of the
    // scroller, so the scroller's jump updates currentPage and the
    // rail should follow. This test pins that transition.
    const { host, rerender, unmount } = mountRail({ pageCount: 10, currentPage: 1 });
    try {
      expect(currentThumbLabels(host)).toEqual([1]);
      rerender({ pageCount: 10, currentPage: 5 });
      expect(currentThumbLabels(host)).toEqual([5]);
      rerender({ pageCount: 10, currentPage: 9 });
      expect(currentThumbLabels(host)).toEqual([9]);
      rerender({ pageCount: 10, currentPage: 1 });
      expect(currentThumbLabels(host)).toEqual([1]);
    } finally {
      unmount();
    }
  });

  it("highlights by visible index, not source page, after a reorder", () => {
    // After a reorder the engine state pageOrder can shuffle
    // (e.g. swap pages 1 and 2: visible [1,2,3] -> sources [2,1,3]).
    // currentPage is the VISIBLE page the user is on (e.g. 2).
    // The previous `sourcePage === currentPage` would compare
    // 1 === 2 -> false, so the highlight would never land. The
    // fix compares the visible slot against currentPage directly:
    // visible slot 2 (which renders source 1) gets the highlight.
    const { host, unmount } = mountRail({
      pageCount: 3,
      currentPage: 2,
      pageOrder: [1, 0, 2], // visible slot 1 -> source 2, slot 2 -> source 1, slot 3 -> source 3
    });
    try {
      const current = currentThumbLabels(host);
      expect(current).toEqual([2]);
      // The matching thumb must also carry the underlying source-page
      // data attribute so the e2e harness can verify both the visible
      // position and the underlying pdf.js page.
      const el = host.querySelector('.thumb[data-page="2"]');
      expect(el).not.toBeNull();
      expect((el as HTMLElement).dataset.sourcePage).toBe("1");
    } finally {
      unmount();
    }
  });

  it("never paints more than one thumb as current", () => {
    // Defensive: a regression that paints the highlight on every
    // thumb would still pass an `includes(currentPage)` check. The
    // rule is exactly one matching thumb at a time.
    for (let p = 1; p <= 5; p += 1) {
      const { host, unmount } = mountRail({ pageCount: 5, currentPage: p });
      try {
        expect(currentThumbLabels(host).length).toBe(1);
      } finally {
        unmount();
      }
    }
  });

  it("keeps the highlight on the jumped-to page even when currentPage is updated mid-scroll (DEF-058)", () => {
    // DEF-058 regression: the rail must paint the currentPage it's
    // told to paint, full stop. The mid-scroll race lives in
    // DocumentView's jump-lock logic; the rail's job is to
    // faithfully reflect whatever `currentPage` is passed in. If
    // the host is racing, the rail must keep showing the page the
    // host is showing, even if it briefly disagrees with the
    // scroller's geometry.
    //
    // The reproduction: a 10-page doc, currentPage starts at 1. We
    // jump to 5, then update currentPage to 2 (simulating the
    // scroll-driven heuristic firing during a smooth scroll) — the
    // rail must follow the host, not the scroller geometry.
    const { host, rerender, unmount } = mountRail({ pageCount: 10, currentPage: 1 });
    try {
      rerender({ pageCount: 10, currentPage: 5 });
      expect(currentThumbLabels(host)).toEqual([5]);
      // Mid-scroll heuristic update: the rail should follow.
      rerender({ pageCount: 10, currentPage: 2 });
      expect(currentThumbLabels(host)).toEqual([2]);
      // Settled at the destination.
      rerender({ pageCount: 10, currentPage: 5 });
      expect(currentThumbLabels(host)).toEqual([5]);
    } finally {
      unmount();
    }
  });
});
