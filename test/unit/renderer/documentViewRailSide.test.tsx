// @vitest-environment jsdom
//
// Phase 33 (chunk 3) — DocumentView's rail side.
//
// The rail is no longer suppressed in Multi Mode: each pane shows its OWN
// strip at its INNER edge. The placement is a DOM-ORDER contract (not just
// a class), so the geometry is asserted structurally:
//
//   - railSide "left" (the single-mode default): the rail node comes BEFORE
//     the page area — the existing rail position, untouched.
//   - railSide "right" (Multi Mode's pane A): the strip comes AFTER the page
//     area, inside the same pane, so pane A's strip ends up immediately to
//     the right of A's pages — next to pane B's strip (pane B's own view is
//     "left"), with the divider between them.
//
// It also proves a thumbnail click in the strip navigates THIS view (its
// own pane) and moves its own current-page highlight.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";

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
  // jsdom has no layout and no scroller: a rail jump still updates the
  // current-page state (the behaviour under test) and the scroll call is a
  // no-op here.
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  if (proto.scrollTo === undefined) {
    proto.scrollTo = (): void => undefined;
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

async function mountView(props: {
  railSide?: "left" | "right";
  multiRail?: {
    pane: "A" | "B";
    tabId: string;
    title: string;
    documentCount: number;
    onFocusPane: () => void;
    onDrop: () => void;
  } | null;
}): Promise<HTMLElement> {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      createElement(DocumentView, {
        doc: makeDocStub(3),
        pageCount: 3,
        outline: null,
        initial: {
          zoomMode: "fit-width",
          manualScale: 1,
          currentPage: 1,
          searchOpen: false,
          query: "",
          activeHitIndex: -1,
        },
        onPersist: (): void => undefined,
        onDiagnostics: (): void => undefined,
        engineState: makeEngineState(3),
        canUndo: false,
        saveInPlaceEnabled: false,
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        railSide: props.railSide ?? "left",
        multiRail: props.multiRail ?? null,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return host;
}

const RAIL = '[data-pane-strip], .side-rail';
const PAGE_AREA = ".workspace-main";

describe("DocumentView — the rail side (Phase 33)", () => {
  it("keeps the single-mode rail on the LEFT, before the page area", async () => {
    const host = await mountView({});
    const workspace = host.querySelector(".workspace");
    expect(workspace?.getAttribute("data-rail-side")).toBe("left");
    // No strip in single mode: the unchanged SideRail occupies the slot.
    expect(host.querySelector("[data-pane-strip]")).toBeNull();
    const rail = host.querySelector(".side-rail");
    const main = host.querySelector(PAGE_AREA);
    expect(rail).not.toBeNull();
    expect(rail?.compareDocumentPosition(main as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("puts Multi Mode's pane-A strip AFTER the page area, inside the pane", async () => {
    const host = await mountView({
      railSide: "right",
      multiRail: {
        pane: "A",
        tabId: "doc-a",
        title: "Alpha.pdf",
        documentCount: 2,
        onFocusPane: (): void => undefined,
        onDrop: (): void => undefined,
      },
    });
    const workspace = host.querySelector(".workspace");
    expect(workspace?.getAttribute("data-rail-side")).toBe("right");
    const rail = host.querySelector(RAIL);
    const main = host.querySelector(PAGE_AREA);
    expect(rail).not.toBeNull();
    // The strip FOLLOWS the page area: A's pages, then A's strip.
    expect(main?.compareDocumentPosition(rail as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Both live in the same workspace (the pane) and the strip is the last
    // child, so nothing can sit between A's pages and A's strip.
    expect(rail?.parentElement).toBe(workspace);
    expect(workspace?.lastElementChild).toBe(rail);
  });

  it("renders pane B's strip as a stripe of its own document, navigable in place", async () => {
    const host = await mountView({
      railSide: "left",
      multiRail: {
        pane: "B",
        tabId: "doc-b",
        title: "Beta.pdf",
        documentCount: 2,
        onFocusPane: (): void => undefined,
        onDrop: (): void => undefined,
      },
    });
    // pane B: the strip comes FIRST, then the page area.
    const rail = host.querySelector(RAIL);
    const main = host.querySelector(PAGE_AREA);
    expect(rail?.compareDocumentPosition(main as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(rail?.getAttribute("data-pane-strip-doc")).toBe("doc-b");
    expect(rail?.querySelector("[data-pane-strip-header]")?.textContent).toContain("Beta.pdf");
    // A click on this strip's page-2 thumb navigates THIS view: its own
    // current-page highlight moves (the pane keeps its own scroll state).
    act((): void => {
      rail?.querySelector<HTMLButtonElement>('.thumb-item[data-page="2"]')?.click();
    });
    expect(rail?.querySelector('.thumb-item[data-page="2"]')?.className).toContain(
      "thumb-current",
    );
    expect(rail?.querySelector('.thumb-item[data-page="1"]')?.className).not.toContain(
      "thumb-current",
    );
  });
});