// @vitest-environment jsdom
//
// Phase 32 (chunk 2d) — cross-document page drag and drop in the REAL rail
// and the REAL canvas.
//
// Rail: dragging a thumb across sections resolves a cross-document op; a
// drag within one section keeps the existing reorder math; the section
// highlights; the empty space below the last thumb appends (-1).
//
// Canvas: a page's hover grip starts a document-aware drag and the page
// slots are drop targets with an insertion indicator; a copy (Ctrl / Alt)
// is communicated on the indicator. The grip is a dedicated affordance:
// with no page drag active, the slots never preventDefault, so text
// selection and the annotation overlays are untouched.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, type ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import { MultiRail } from "../../../src/renderer/components/MultiRail";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import { PageDragProvider, usePageDrag } from "../../../src/renderer/state/PageDragContext";
import { buildDragSource, type PageDropOp } from "../../../src/renderer/state/pageDrag";
import type { EngineState } from "../../../src/renderer/engine/types";

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
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

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function engineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

const visibleMap = (n: number): Map<number, number> =>
  new Map(Array.from({ length: n }, (_, i) => [i + 1, i + 1]));

interface DataTransferStub {
  effectAllowed: string;
  dropEffect: string;
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}
function makeDataTransfer(): DataTransferStub {
  return {
    effectAllowed: "",
    dropEffect: "",
    setData: vi.fn(),
    getData: vi.fn(() => ""),
  };
}

/** Dispatch a bubbling drag event carrying the stubs React reads. */
function dragEvent(
  type: string,
  init: {
    dataTransfer?: DataTransferStub;
    clientY?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    relatedTarget?: Node | null;
  } = {},
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: init.dataTransfer ?? makeDataTransfer() });
  Object.defineProperty(ev, "clientY", { value: init.clientY ?? 0 });
  Object.defineProperty(ev, "ctrlKey", { value: init.ctrlKey ?? false });
  Object.defineProperty(ev, "altKey", { value: init.altKey ?? false });
  Object.defineProperty(ev, "relatedTarget", { value: init.relatedTarget ?? null });
  return ev;
}

function mount(element: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
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

const drag = (el: Element | null, ev: Event): void => {
  act((): void => {
    el?.dispatchEvent(ev);
  });
};
const thumb = (host: HTMLElement, page: number): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.thumb[data-page="${page}"]`);

// ---------------------------------------------------------------------------
// The rail: one section's ThumbnailRail, document-aware.
// ---------------------------------------------------------------------------

function RailHarness(props: {
  tabId: string;
  pageCount: number;
  onDrop: (op: PageDropOp) => void;
}): ReactElement {
  const d = usePageDrag();
  return (
    <div>
      <button
        type="button"
        data-begin-from-b
        onClick={(): void => d.begin(buildDragSource("b", 2, null))}
      >
        begin b
      </button>
      <ThumbnailRail
        doc={makeDocStub(props.pageCount)}
        pageCount={props.pageCount}
        currentPage={1}
        aspectRatio={792 / 612}
        rotations={engineState(props.pageCount).rotations}
        visibleToSource={visibleMap(props.pageCount)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={(): void => undefined}
        crossDoc={{ tabId: props.tabId, onDrop: props.onDrop }}
      />
    </div>
  );
}

describe("the rail's cross-document drag", () => {
  it("moves a page from another section onto the hovered thumb slot", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness tabId="a" pageCount={5} onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const target = thumb(host, 3);
      drag(target, dragEvent("dragover", {}));
      // The landing slot carries the existing affordance.
      expect(target?.className).toContain("thumb-drop-target");
      drag(target, dragEvent("drop", {}));
      expect(onDrop).toHaveBeenCalledWith({
        fromTabId: "b",
        pages: [2],
        toTabId: "a",
        atIndex: 3,
        mode: "move",
        sameDoc: false,
      });
    } finally {
      unmount();
    }
  });

  it("keeps the existing intra-document reorder math for a same-section drag", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness tabId="a" pageCount={5} onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      drag(thumb(host, 1), dragEvent("dragstart", {}));
      drag(thumb(host, 3), dragEvent("dragover", {}));
      drag(thumb(host, 3), dragEvent("drop", {}));
      // Page 1 dropped on page 3 -> insert before 3 -> slot 2 (today's math).
      expect(onDrop).toHaveBeenCalledWith({
        fromTabId: "a",
        pages: [1],
        toTabId: "a",
        atIndex: 2,
        mode: "move",
        sameDoc: true,
      });
    } finally {
      unmount();
    }
  });

  it("appends (-1) when dropped on the empty rail space below the thumbs", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness tabId="a" pageCount={5} onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const inner = host.querySelector<HTMLElement>(".thumb-scroller-inner");
      drag(inner, dragEvent("dragover", {}));
      drag(inner, dragEvent("drop", {}));
      expect(onDrop).toHaveBeenCalledWith({
        fromTabId: "b",
        pages: [2],
        toTabId: "a",
        atIndex: -1,
        mode: "move",
        sameDoc: false,
      });
    } finally {
      unmount();
    }
  });

  it("marks a copy on the landing thumb when Ctrl is held", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness tabId="a" pageCount={5} onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const target = thumb(host, 4);
      drag(target, dragEvent("dragover", { ctrlKey: true }));
      expect(target?.className).toContain("thumb-drop-copy");
      drag(target, dragEvent("drop", { ctrlKey: true }));
      expect(onDrop).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "copy", atIndex: 4 }),
      );
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// MultiRail: the landing section highlights for a cross-document drag.
// ---------------------------------------------------------------------------

function RailSectionHarness(): ReactElement {
  const d = usePageDrag();
  return (
    <div>
      <button
        type="button"
        data-begin-from-a
        onClick={(): void => d.begin(buildDragSource("a", 1, null))}
      >
        begin a
      </button>
      <button
        type="button"
        data-hover-b
        onClick={(): void => d.hover({ tabId: "b", atIndex: 2 })}
      >
        hover b
      </button>
      <MultiRail
        sections={[
          { pane: "A", tabId: "a", title: "a.pdf", pageCount: 3 },
          { pane: "B", tabId: "b", title: "b.pdf", pageCount: 4 },
        ]}
        activePane="A"
        onFocusPane={(): void => undefined}
        onJump={(): void => undefined}
        renderSection={({ tabId }): ReactElement => <div data-body={tabId} />}
      />
    </div>
  );
}

describe("the shared rail highlights the landing section", () => {
  it("marks only the other section as a cross-document drop target", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailSectionHarness />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
        host.querySelector<HTMLButtonElement>("[data-hover-b]")?.click();
      });
      const sectionA = host.querySelector('[data-rail-section-doc="a"]');
      const sectionB = host.querySelector('[data-rail-section-doc="b"]');
      expect(sectionA?.getAttribute("data-rail-section-drop-target")).toBeNull();
      expect(sectionB?.getAttribute("data-rail-section-drop-target")).toBe("true");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// The canvas: a hover grip is the drag source, the page slots are targets.
// ---------------------------------------------------------------------------

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

function CanvasHarness(props: { onDrop: (op: PageDropOp) => void }): ReactElement {
  const d = usePageDrag();
  return (
    <div>
      <button
        type="button"
        data-begin-from-a
        onClick={(): void => d.begin(buildDragSource("a", 2, null))}
      >
        begin a
      </button>
      <DocumentView
        doc={makeDocStub(4)}
        pageCount={4}
        outline={null}
        initial={INITIAL_VIEWER}
        onPersist={(): void => undefined}
        onDiagnostics={(_d: DocDiagnostics): void => undefined}
        engineState={engineState(4)}
        modified={false}
        canUndo={false}
        saveInPlaceEnabled={false}
        annotations={[]}
        formFields={[]}
        signatures={[]}
        savedSignatures={[]}
        stampAnnotations={[]}
        pageDrag={{ tabId: "b", onDrop: props.onDrop }}
      />
    </div>
  );
}

const slot = (host: HTMLElement, page: number): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.page-slot[data-page="${page}"]`);

describe("the canvas page drag and drop", () => {
  it("renders a dedicated hover grip outside the page and its overlays", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={vi.fn()} />
      </PageDragProvider>,
    );
    try {
      const grip = host.querySelector<HTMLElement>('[data-page-drag-handle="1"]');
      expect(grip).not.toBeNull();
      expect(grip?.getAttribute("draggable")).toBe("true");
      // A dedicated affordance, not the page/text layer: it cannot collide
      // with text selection or the annotation overlays.
      expect(grip?.closest(".pdf-page")).toBeNull();
      expect(grip?.closest(".textLayer")).toBeNull();
      expect(grip?.tagName).toBe("BUTTON");
    } finally {
      unmount();
    }
  });

  it("drops a page from the other document at the nearest insertion slot", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      // clientY -1 vs a zero-height jsdom slot -> the pointer is in the TOP
      // half, so the insertion is BEFORE page 2.
      const s2 = slot(host, 2);
      drag(s2, dragEvent("dragover", { clientY: -1 }));
      const indicator = host.querySelector('[data-drop-indicator="before"]');
      expect(indicator?.getAttribute("data-drop-page")).toBe("2");
      // The landing pane highlights too.
      expect(
        host.querySelector(".document-scroller")?.getAttribute("data-page-drop-pane"),
      ).toBe("true");
      drag(s2, dragEvent("drop", { clientY: -1 }));
      expect(onDrop).toHaveBeenCalledWith({
        fromTabId: "a",
        pages: [2],
        toTabId: "b",
        atIndex: 2,
        mode: "move",
        sameDoc: false,
      });
    } finally {
      unmount();
    }
  });

  it("appends after the last page with the -1 sentinel", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      const last = slot(host, 4);
      drag(last, dragEvent("dragover", { clientY: 5 }));
      const indicator = host.querySelector('[data-drop-indicator="after"]');
      expect(indicator?.getAttribute("data-drop-page")).toBe("4");
      drag(last, dragEvent("drop", { clientY: 5 }));
      expect(onDrop).toHaveBeenCalledWith(
        expect.objectContaining({ toTabId: "b", atIndex: -1 }),
      );
    } finally {
      unmount();
    }
  });

  it("shows a copy hint on the indicator when Ctrl is held", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={vi.fn()} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      drag(slot(host, 3), dragEvent("dragover", { clientY: -1, ctrlKey: true }));
      const indicator = host.querySelector('[data-drop-indicator="before"]');
      expect(indicator?.getAttribute("data-drop-copy")).toBe("true");
      expect(indicator?.querySelector(".page-drop-copy-hint")?.textContent).toBe("Copy");
    } finally {
      unmount();
    }
  });

  it("starts an intra-document reorder from the grip, with today's math", () => {
    const onDrop = vi.fn();
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={onDrop} />
      </PageDragProvider>,
    );
    try {
      drag(host.querySelector('[data-page-drag-handle="1"]'), dragEvent("dragstart", {}));
      drag(slot(host, 3), dragEvent("drop", { clientY: -1 }));
      // Page 1 before page 3 -> slot 2 (same-document reorder path).
      expect(onDrop).toHaveBeenCalledWith({
        fromTabId: "b",
        pages: [1],
        toTabId: "b",
        atIndex: 2,
        mode: "move",
        sameDoc: true,
      });
    } finally {
      unmount();
    }
  });

  it("ignores page drags when no page drag is active (text selection untouched)", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness onDrop={vi.fn()} />
      </PageDragProvider>,
    );
    try {
      // A dragstart on the page / text layer is a text-selection drag: it
      // must NOT begin a page drag, so the slots stay inert.
      drag(host.querySelector(".textLayer"), dragEvent("dragstart", {}));
      const s3 = slot(host, 3);
      const over = dragEvent("dragover", { clientY: -1 });
      drag(s3, over);
      expect(over.defaultPrevented).toBe(false);
      expect(host.querySelector("[data-drop-indicator]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

