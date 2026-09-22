// @vitest-environment jsdom
//
// Phase 33 (chunk 3) — the per-pane thumbnail strip.
//
// In Multi Mode each pane owns its OWN strip at its inner edge. The strip
// must keep the shared rail's guarantees while becoming a full rail:
//
//   - DEF-291: it is HEADERLESS — the pane header above already names the
//     document, so a second name row here duplicated it and pushed the
//     thumbnails down. The strip carries its identity on its own
//     attributes / aria-label instead;
//   - its thumbnails come from its own document and a click navigates its
//     own pane (onJump) AND focuses that pane (onFocusPane);
//   - its thumb width is the dynamically computed `computeThumbWidth` for
//     the loaded-document count, and never drops below the minimum hit
//     target on a narrow strip;
//   - it carries the chunk-2d cross-document drag identity (its own tabId).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PaneThumbStrip } from "../../../src/renderer/components/PaneThumbStrip";
import { computeThumbWidth } from "../../../src/renderer/components/thumbGeometry";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { PageDropOp } from "../../../src/renderer/state/pageDrag";

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
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
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
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
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

interface StripOptions {
  documentCount?: number;
  pageCount?: number;
  tabId?: string;
  title?: string;
  pane?: "A" | "B";
  onJump?: (page: number) => void;
  onFocusPane?: () => void;
  onDrop?: (op: PageDropOp) => void;
}

function renderStrip(options: StripOptions = {}): HTMLElement {
  stubObservers();
  const pageCount = options.pageCount ?? 3;
  return mount(
    <PaneThumbStrip
      pane={options.pane ?? "A"}
      tabId={options.tabId ?? "doc-a"}
      title={options.title ?? "Alpha.pdf"}
      doc={makeDocStub(pageCount)}
      pageCount={pageCount}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      pageSizes={null}
      engineState={makeEngineState(pageCount)}
      proxyVisibleOrder={false}
      canUndo={false}
      onJump={options.onJump ?? ((): void => undefined)}
      onFocusPane={options.onFocusPane ?? ((): void => undefined)}
      documentCount={options.documentCount ?? 2}
      crossDoc={{ tabId: options.tabId ?? "doc-a", onDrop: options.onDrop ?? ((): void => undefined) }}
    />,
  );
}

const thumbWidths = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>(".thumb-canvas-wrap")].map((el) => el.style.width);

describe("PaneThumbStrip — identity and navigation", () => {
  it("DEF-291: renders NO strip header; identity rides the strip itself", () => {
    const host = renderStrip({ title: "Alpha.pdf", pageCount: 5, pane: "A" });
    const strip = host.querySelector("[data-pane-strip]");
    expect(strip?.getAttribute("data-pane-strip-pane")).toBe("A");
    expect(strip?.getAttribute("data-pane-strip-doc")).toBe("doc-a");
    // The duplicate header row is gone.
    expect(host.querySelector("[data-pane-strip-header]")).toBeNull();
    // The strip still knows which pane/document it belongs to.
    expect(strip?.getAttribute("aria-label")).toContain("Alpha.pdf");
    expect(strip?.getAttribute("aria-label")).toContain("A");
    // The body is the strip's FIRST (and only) child — no header row above
    // it, so its top edge is flush with the strip (and the pane header).
    const body = host.querySelector("[data-pane-strip-body]");
    expect(body).not.toBeNull();
    expect(strip?.firstElementChild).toBe(body);
  });

  it("renders its own document's thumbnails and jumps its own pane on a click", () => {
    const onJump = vi.fn();
    const host = renderStrip({ pageCount: 3, onJump });
    // The strip renders one thumb per page of ITS document.
    const pages = [...host.querySelectorAll<HTMLElement>(".thumb-item")].map((el) =>
      el.getAttribute("data-page"),
    );
    expect(pages).toEqual(["1", "2", "3"]);
    // The strip highlights ITS document's current page (1) only.
    expect(host.querySelector('.thumb-item[data-page="1"]')?.className).toContain("thumb-current");
    expect(host.querySelector('.thumb-item[data-page="3"]')?.className).not.toContain(
      "thumb-current",
    );
    act((): void => {
      host.querySelector<HTMLButtonElement>('.thumb-item[data-page="3"]')?.click();
    });
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it("focuses its own pane on a thumb click (the header click target is gone)", () => {
    const onFocusPane = vi.fn();
    const host = renderStrip({ onFocusPane });
    act((): void => {
      host.querySelector<HTMLButtonElement>('.thumb-item[data-page="2"]')?.click();
    });
    expect(onFocusPane).toHaveBeenCalledTimes(1);
  });
});

describe("PaneThumbStrip — the dynamically computed thumb width", () => {
  it("uses computeThumbWidth for the loaded-document count (two documents)", () => {
    const host = renderStrip({ documentCount: 2 });
    const expected = computeThumbWidth(220, 2);
    expect(expected).toBe(89);
    expect(new Set(thumbWidths(host))).toEqual(new Set([`${expected}px`]));
  });

  it("keeps the single-mode width when one document is loaded", () => {
    const host = renderStrip({ documentCount: 1 });
    expect(new Set(thumbWidths(host))).toEqual(new Set([`${computeThumbWidth(220, 1)}px`]));
  });

  it("never drops below the minimum hit target on a narrow strip", () => {
    const spy = vi
      .spyOn(Element.prototype, "clientWidth", "get")
      .mockReturnValue(40);
    try {
      const host = renderStrip({ documentCount: 2 });
      // computeThumbWidth clamps a 40px strip up to the 84px floor.
      const expected = computeThumbWidth(40, 2);
      expect(expected).toBe(84);
      expect(new Set(thumbWidths(host))).toEqual(new Set([`${expected}px`]));
    } finally {
      spy.mockRestore();
    }
  });
});