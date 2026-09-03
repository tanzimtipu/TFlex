// @vitest-environment jsdom
//
// DEF-148 — a per-page crop of page 1 collapses EVERY thumbnail into
// the crop square.
//
// Root cause: SideRail derived a single `aspect` from DocumentView's
// LIVE `firstPageSize` (post-crop = the 200x200 square, aspect 1.0)
// and applied it to every Thumb's wrap (`SideRail.tsx` old line 92 /
// old line 671), so the full-page canvas (126x163) was clipped by the
// square `.thumb-canvas-wrap` on pages 2..N.
//
// The fix: each Thumb gets its OWN page's geometry — the per-VISIBLE-
// page `pageSizes` map the main view's PageView mounts report
// (DEF-141's per-page fix applied to the rail). A thumb whose page
// has a reported size wraps at floor(126 * h / w); pages without one
// fall back to the LARGEST known page (never page 1's post-crop
// size).
//
// Behavior pinned here (DOM assert, not marker-only):
//   1. When page 1 = 200x200 and pages 2-4 = 612x792, page 1's wrap
//      is 126x126 and pages 2/3/4 are 126x163 EVEN THOUGH
//      `defaultWidthPt/HeightPt` (the LIVE firstPageSize) are the
//      crop square — the exact installed-v1.7.17 geometry qa measured.
//   2. Uncropped uniform docs keep the old wrap geometry (regression
//      guard: no rail behavior change on a normal PDF).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SideRail } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

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

function makeStubDoc(): PDFDocumentProxy {
  return {
    numPages: 4,
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

const ZERO_ROTATIONS: EngineState["rotations"] = new Array(4).fill(0) as EngineState["rotations"];

function mountRail(args: {
  defaultWidthPt: number;
  defaultHeightPt: number;
  pageSizes?: Map<number, { w: number; h: number }> | null;
}): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const order = [0, 1, 2, 3];
  const engineState: EngineState = {
    pageCount: 4,
    pageOrder: order,
    rotations: ZERO_ROTATIONS,
    deleted: order.map(() => false),
    modified: false,
    annotations: [],
  };
  act((): void => {
    root.render(
      <SideRail
        doc={makeStubDoc()}
        pageCount={4}
        outline={null}
        currentPage={1}
        defaultWidthPt={args.defaultWidthPt}
        defaultHeightPt={args.defaultHeightPt}
        pageSizes={args.pageSizes ?? null}
        engineState={engineState}
        canUndo={false}
        onJump={(): void => undefined}
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

function wrapSize(host: HTMLElement, page: number): { w: number; h: number } {
  const wrap = host.querySelector<HTMLElement>(
    `.thumb-item[data-page="${page}"] .thumb-canvas-wrap`,
  );
  if (wrap === null) throw new Error(`wrap for page ${page} not found`);
  // jsdom has no layout engine — read the inline style (the exact
  // geometry the rail renders in the browser).
  return {
    w: Number.parseFloat(wrap.style.width),
    h: Number.parseFloat(wrap.style.height),
  };
}

describe("DEF-148 — per-page thumbnail geometry (crop page 1 must not collapse pages 2..N)", () => {
  it("per-page sizes win: page 1 is the crop square, pages 2-4 stay full-page even when firstPageSize is the square", () => {
    const pageSizes = new Map<number, { w: number; h: number }>([
      [1, { w: 200, h: 200 }],
      [2, { w: 612, h: 792 }],
      [3, { w: 612, h: 792 }],
      [4, { w: 612, h: 792 }],
    ]);
    const { host, unmount } = mountRail({
      // The LIVE firstPageSize after the crop is the 200x200 square —
      // the exact DEF-148 root input that previously collapsed every
      // wrap to 126x126.
      defaultWidthPt: 200,
      defaultHeightPt: 200,
      pageSizes,
    });
    try {
      // Page 1 is genuinely cropped -> square wrap.
      expect(wrapSize(host, 1)).toEqual({ w: 126, h: 126 });
      // Pages 2-4 are un-cropped full pages -> 126x163 (aspect 0.773).
      expect(wrapSize(host, 2)).toEqual({ w: 126, h: 163 });
      expect(wrapSize(host, 3)).toEqual({ w: 126, h: 163 });
      expect(wrapSize(host, 4)).toEqual({ w: 126, h: 163 });
    } finally {
      unmount();
    }
  });

  it("a uniform doc keeps the plain page-1-derived wrap heights (regression guard)", () => {
    const { host, unmount } = mountRail({
      defaultWidthPt: 612,
      defaultHeightPt: 792,
      pageSizes: new Map([
        [1, { w: 612, h: 792 }],
        [2, { w: 612, h: 792 }],
        [3, { w: 612, h: 792 }],
        [4, { w: 612, h: 792 }],
      ]),
    });
    try {
      for (const page of [1, 2, 3, 4]) {
        expect(wrapSize(host, page)).toEqual({ w: 126, h: 163 });
      }
    } finally {
      unmount();
    }
  });

  it("pages with no per-page entry fall back to the LARGEST known page, not page 1's crop", () => {
    // The map already holds every page that was mounted this session
    // (pages 2+ were mounted at open, before the crop) — page 2's
    // entry is only transiently missing before its re-render. The
    // fallback is the largest KNOWN page (612x792), never page 1's
    // crop square, so a not-yet-re-reported page is never clipped
    // into the crop box in the meantime.
    const pageSizes = new Map<number, { w: number; h: number }>([
      [1, { w: 200, h: 200 }],
      [4, { w: 612, h: 792 }],
    ]);
    const { host, unmount } = mountRail({
      defaultWidthPt: 200,
      defaultHeightPt: 200,
      pageSizes,
    });
    try {
      expect(wrapSize(host, 1)).toEqual({ w: 126, h: 126 });
      // Pages 2-3 have no entry yet -> fallback to the largest known
      // page (612x792) -> full-page wraps, no clipping.
      expect(wrapSize(host, 2)).toEqual({ w: 126, h: 163 });
      expect(wrapSize(host, 3)).toEqual({ w: 126, h: 163 });
      expect(wrapSize(host, 4)).toEqual({ w: 126, h: 163 });
    } finally {
      unmount();
    }
  });
});