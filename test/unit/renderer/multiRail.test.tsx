// @vitest-environment jsdom
//
// Phase 32 (chunk 2b) — the shared Multi Mode thumbnail rail.
//
// The rail renders one labelled section per loaded document (pane A's
// first, then pane B's), marks the focused pane's section active, sizes
// the thumbnails from the rail's width and the document count, and routes
// a thumbnail click to that section's pane and page. These tests drive
// the real component (and, for the width, a real ThumbnailRail) through
// the section render seam.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { MultiRail, type MultiRailSection } from "../../../src/renderer/components/MultiRail";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

// jsdom ships neither observer; the rail (and each section's real
// ThumbnailRail) constructs both on mount.
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

const SECTIONS: MultiRailSection[] = [
  { pane: "A", tabId: "a", title: "Alpha.pdf", pageCount: 3 },
  { pane: "B", tabId: "b", title: "Beta.pdf", pageCount: 5 },
];

function mount(element: ReactElement): { host: HTMLElement; rerender: (el: ReactElement) => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    rerender: (el: ReactElement): void => {
      act((): void => {
        root.render(el);
      });
    },
  };
}

const noop = (): void => undefined;

function sectionElements(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-rail-section]"));
}

describe("MultiRail - one labelled section per loaded document", () => {
  it("renders pane A's document first, then pane B's, with header + badge + count", () => {
    const { host } = mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    const sections = sectionElements(host);
    expect(sections).toHaveLength(2);
    expect(sections[0]?.getAttribute("data-rail-section-doc")).toBe("a");
    expect(sections[0]?.getAttribute("data-rail-section-pane")).toBe("A");
    expect(sections[1]?.getAttribute("data-rail-section-doc")).toBe("b");
    expect(sections[1]?.getAttribute("data-rail-section-pane")).toBe("B");

    const headerA = sections[0]?.querySelector("[data-rail-section-header]");
    expect(headerA?.textContent).toContain("A");
    expect(headerA?.textContent).toContain("Alpha.pdf");
    expect(headerA?.textContent).toContain("3 pages");
    const headerB = sections[1]?.querySelector("[data-rail-section-header]");
    expect(headerB?.textContent).toContain("B");
    expect(headerB?.textContent).toContain("Beta.pdf");
    expect(headerB?.textContent).toContain("5 pages");

    // One body (and therefore one scroll container) per section.
    expect(host.querySelectorAll("[data-rail-section-body]")).toHaveLength(2);
    expect(host.querySelectorAll("[data-body-stub]")).toHaveLength(2);
  });

  it("renders a single section when only one document is loaded, none when empty", () => {
    const { host } = mount(
      <MultiRail
        sections={[SECTIONS[0] as MultiRailSection]}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    expect(sectionElements(host)).toHaveLength(1);

    const empty = mount(
      <MultiRail
        sections={[]}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    expect(empty.host.querySelector("[data-multi-rail]")).toBeNull();
  });
});

describe("MultiRail - the active section marker follows the focus", () => {
  it("marks only the focused pane's section active, and follows a focus change", () => {
    const { host, rerender } = mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    const marks = (): (string | null)[] =>
      sectionElements(host).map((el) => el.getAttribute("data-rail-section-active"));
    expect(marks()).toEqual(["true", "false"]);

    rerender(
      <MultiRail
        sections={SECTIONS}
        activePane="B"
        onFocusPane={noop}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    expect(marks()).toEqual(["false", "true"]);
  });

  it("focuses a pane from its section header", () => {
    const focus = vi.fn();
    const { host } = mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={focus}
        onJump={noop}
        renderSection={(): ReactElement => <div data-body-stub />}
      />,
    );
    const headerB = sectionElements(host)[1]?.querySelector<HTMLButtonElement>(
      "[data-rail-section-header]",
    );
    act((): void => {
      headerB?.click();
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith("B");
  });
});

describe("MultiRail - a thumbnail click routes to the right pane and page", () => {
  it("focuses the clicked section's pane and jumps it to the clicked page", () => {
    const focus = vi.fn();
    const jump = vi.fn();
    const { host } = mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={focus}
        onJump={jump}
        renderSection={({ pane, onJump }): ReactElement => (
          <button
            type="button"
            data-thumb-stub={pane}
            onClick={(): void => onJump(4)}
          >{`thumb ${pane}`}</button>
        )}
      />,
    );
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-thumb-stub="B"]')?.click();
    });
    // The pane focus is reported first, then the pane-scoped page jump.
    expect(focus).toHaveBeenCalledWith("B");
    expect(jump).toHaveBeenCalledWith("B", 4);
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(jump.mock.invocationCallOrder[0] as number);
  });
});

describe("MultiRail - dynamic thumbnail width reaches the section bodies", () => {
  it("gives a two-document rail the smaller width and a one-document rail today's", () => {
    const two: number[] = [];
    mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={({ thumbWidth }): ReactElement => {
          two.push(thumbWidth);
          return <div data-body-stub />;
        }}
      />,
    );
    expect(two).toEqual([89, 89]);

    const one: number[] = [];
    mount(
      <MultiRail
        sections={[SECTIONS[0] as MultiRailSection]}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={({ thumbWidth }): ReactElement => {
          one.push(thumbWidth);
          return <div data-body-stub />;
        }}
      />,
    );
    expect(one).toEqual([126]);
  });

  it("sizes a real ThumbnailRail's wraps: 89px with two sections, 126px with one", () => {
    const renderRail = (thumbWidth: number): ReactElement => (
      <ThumbnailRail
        doc={makeStubDoc()}
        pageCount={3}
        currentPage={1}
        aspectRatio={792 / 612}
        rotations={[0, 0, 0] as EngineState["rotations"]}
        visibleToSource={new Map([
          [1, 1],
          [2, 2],
          [3, 3],
        ])}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={noop}
        thumbWidth={thumbWidth}
      />
    );
    const wrapWidth = (host: HTMLElement): string | undefined =>
      host.querySelector<HTMLElement>('.thumb-item[data-page="1"] .thumb-canvas-wrap')?.style
        .width;

    const two = mount(
      <MultiRail
        sections={SECTIONS}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={({ thumbWidth }): ReactElement => renderRail(thumbWidth)}
      />,
    );
    expect(wrapWidth(two.host)).toBe("89px");

    const one = mount(
      <MultiRail
        sections={[SECTIONS[0] as MultiRailSection]}
        activePane="A"
        onFocusPane={noop}
        onJump={noop}
        renderSection={({ thumbWidth }): ReactElement => renderRail(thumbWidth)}
      />,
    );
    expect(wrapWidth(one.host)).toBe("126px");
  });
});

describe("MultiRail - each section keeps its own visible+buffered window", () => {
  it("rasterizes only the visible thumbs of each 34-page section, not all of them", async () => {
    // jsdom reports clientHeight 0 for everything, which makes the rail's
    // geometry range degenerate; a fixed viewport height gives each section
    // a real window (the same trick the DEF-274 rail test uses).
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 800,
    });
    try {
      const longDoc = (): MultiRailSection[] => [
        { pane: "A", tabId: "a", title: "A.pdf", pageCount: 34 },
        { pane: "B", tabId: "b", title: "B.pdf", pageCount: 34 },
      ];
      const renderLong = (thumbWidth: number, doc: PDFDocumentProxy): ReactElement => (
        <ThumbnailRail
          doc={doc}
          pageCount={34}
          currentPage={1}
          aspectRatio={792 / 612}
          rotations={Array.from({ length: 34 }, () => 0) as EngineState["rotations"]}
          visibleToSource={new Map(Array.from({ length: 34 }, (_, i) => [i + 1, i + 1]))}
          proxyVisibleOrder={false}
          canUndo={false}
          onJump={noop}
          thumbWidth={thumbWidth}
        />
      );

      // One section: the per-section window size.
      const singleCalls: number[] = [];
      mount(
        <MultiRail
          sections={[longDoc()[0] as MultiRailSection]}
          activePane="A"
          onFocusPane={noop}
          onJump={noop}
          renderSection={({ thumbWidth }): ReactElement =>
            renderLong(thumbWidth, makeStubDoc((n) => singleCalls.push(n)))
          }
        />,
      );
      await flush();
      const perSection = singleCalls.length;
      // One 126px section shows the pages in view plus the rail's own
      // 1-slot buffer: a handful, never the whole 34-page document.
      expect(perSection).toBeGreaterThan(0);
      expect(perSection).toBeLessThan(10);

      // Two sections: two INDEPENDENT windows, still a small fraction of
      // the 68 pages. The smaller multi-section width fits a couple more
      // thumbs per section (the point of the dynamic sizing).
      const bothCalls: number[] = [];
      mount(
        <MultiRail
          sections={longDoc()}
          activePane="A"
          onFocusPane={noop}
          onJump={noop}
          renderSection={({ thumbWidth }): ReactElement =>
            renderLong(thumbWidth, makeStubDoc((n) => bothCalls.push(n)))
          }
        />,
      );
      await flush();
      const perSectionMulti = new Set(bothCalls).size;
      expect(perSectionMulti).toBeGreaterThanOrEqual(perSection);
      expect(perSectionMulti).toBeLessThan(10);
      // Each page was resolved once per section: two windows, not one
      // shared one and not every page of both documents.
      expect(bothCalls.length).toBe(perSectionMulti * 2);
      expect(bothCalls.length).toBeLessThan(20);
    } finally {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });
});

/** Minimal pdf.js proxy stub (same seam the SideRail tests use). */
function makeStubDoc(pageOf?: (n: number) => void): PDFDocumentProxy {
  return {
    numPages: 34,
    async getPage(n: number): Promise<unknown> {
      // Every RENDERED thumb resolves its page through here, so the call
      // count IS the number of rastering thumbnails (the rail's
      // visible+buffered window).
      pageOf?.(n);
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

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async (): Promise<void> => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}
