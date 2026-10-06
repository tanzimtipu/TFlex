// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk C2) — the PAGES Context Pair.
//
// The Pages workspace's LEFT navigator (ContextPanel) and RIGHT page
// inspector (Inspector) migrated onto the shared panel primitives
// (PanelShell / ScopedHeader / PanelSection / PropertyRow / ActionList /
// PanelEmptyState) WITHOUT changing a command, handler, shortcut, selector,
// document operation or undo/redo behaviour.
//
// These tests pin the two contracts the brief names:
//   LEFT  — the Pages body presents its sections through PanelSection and the
//           no-bookmarks state through PanelEmptyState, and preserves every
//           existing hook (Combine, the page menu verbs incl. Insert blank,
//           and the multi-select count/range).
//   RIGHT — the page inspector renders the REAL page meta from props, reads
//           "Not available" for unknown (never "0", never a guessed A4),
//           shows "Mixed" for a multi-select, collapses the Document details,
//           and names the selection scope in the header.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ContextPanel,
  pageRangeText,
} from "../../../src/renderer/components/ContextPanel";
import {
  Inspector,
  inspectorScopeLabel,
  resolveInspectorPageSize,
  rotationDegreesText,
} from "../../../src/renderer/components/Inspector";
import type { InspectorProps } from "../../../src/renderer/components/Inspector";
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

function makeEngineState(
  pageCount: number,
  overrides: Partial<EngineState> = {},
): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
    ...overrides,
  };
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function mountContextPanel(props: Partial<Parameters<typeof ContextPanel>[0]> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const pageCount = props.engineState?.pageCount ?? 3;
  act((): void => {
    root.render(
      <ContextPanel
        doc={makeDocStub(pageCount)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(pageCount)}
        canUndo={false}
        onJump={(): void => undefined}
        outline={null}
        {...props}
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

function mountInspector(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<Inspector {...props} />);
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

const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [2], children: [] },
  { title: "Chapter 2", dest: [4], children: [] },
];

const ctxByCanvas = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();

beforeEach((): void => {
  ctxByCanvas.clear();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let existing = ctxByCanvas.get(this);
      if (existing === undefined) {
        existing = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        ctxByCanvas.set(this, existing);
      }
      return existing;
    },
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("Phase 112 C2 — pageRangeText", () => {
  it("labels a contiguous run as a range", () => {
    expect(pageRangeText([2, 3, 4])).toBe("Pages 2-4");
  });
  it("lists a sparse selection", () => {
    expect(pageRangeText([1, 3, 5])).toBe("Pages 1, 3, 5");
  });
  it("labels a single page and an empty set", () => {
    expect(pageRangeText([7])).toBe("Page 7");
    expect(pageRangeText([])).toBe("No pages");
  });
});

describe("Phase 112 C2 — the LEFT Pages navigator", () => {
  it("presents the multi-select summary through a PanelSection", () => {
    const { host, unmount } = mountContextPanel({ pageSelection: [2, 3, 4] });
    try {
      const section = host.querySelector<HTMLElement>("[data-context-panel-selection]");
      expect(section).not.toBeNull();
      expect(section?.classList.contains("tf-panel-section")).toBe(true);
      expect(
        section?.querySelector("[data-context-panel-selection-count]")?.textContent,
      ).toContain("3 selected");
      expect(
        section?.querySelector("[data-context-panel-selection-range]")?.textContent,
      ).toContain("Pages 2-4");
    } finally {
      unmount();
    }
  });

  it("omits the summary for zero or one selected page", () => {
    const none = mountContextPanel({ pageSelection: [] });
    try {
      expect(none.host.querySelector("[data-context-panel-selection]")).toBeNull();
    } finally {
      none.unmount();
    }
    const one = mountContextPanel({ pageSelection: [3] });
    try {
      expect(one.host.querySelector("[data-context-panel-selection]")).toBeNull();
    } finally {
      one.unmount();
    }
  });

  it("presents the no-bookmarks state through PanelEmptyState", () => {
    const { host, unmount } = mountContextPanel({ outline: [] });
    try {
      // The section still renders (a real, empty outline), and its body is the
      // shared designed empty state — never a fabricated Add action.
      expect(host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      const empty = host.querySelector<HTMLElement>("[data-context-panel-outline-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("No bookmarks");
      expect(host.querySelector("[data-outline-add]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the Outline toggle and the real tree when bookmarks exist", () => {
    const { host, unmount } = mountContextPanel({ outline: OUTLINE });
    try {
      expect(host.querySelector("[data-outline-toggle]")).not.toBeNull();
      expect(host.querySelector("[data-context-panel-outline-empty]")).toBeNull();
      expect(host.querySelectorAll(".outline-link").length).toBe(2);
    } finally {
      unmount();
    }
  });

  it("preserves the Combine header entry and its onMerge handler", () => {
    const onMerge = vi.fn();
    const { host, unmount } = mountContextPanel({ onMerge });
    try {
      const combine = host.querySelector<HTMLButtonElement>("[data-context-panel-combine]");
      expect(combine).not.toBeNull();
      expect(combine?.textContent).toContain("Combine");
      clickOn(combine as HTMLButtonElement);
      expect(onMerge).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("preserves the page menu verbs and wires Insert blank to onInsertBlank", () => {
    const onInsertBlank = vi.fn();
    const { host, unmount } = mountContextPanel({ onInsertBlank });
    try {
      const thumb = host.querySelector<HTMLElement>('.thumb-item[data-page="2"]');
      expect(thumb).not.toBeNull();
      act((): void => {
        thumb?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }),
        );
      });
      expect(
        [...host.querySelectorAll("[data-menu-item]")].map((el) => el.getAttribute("data-menu-item")),
      ).toEqual(["rotate-cw", "rotate-ccw", "extract", "insert-blank", "replace", "delete"]);
      const insert = host.querySelector<HTMLButtonElement>('[data-menu-item="insert-blank"]');
      clickOn(insert as HTMLButtonElement);
      expect(onInsertBlank).toHaveBeenCalledTimes(1);
      expect(onInsertBlank).toHaveBeenCalledWith(2);
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C2 — inspectorScopeLabel", () => {
  it("names the multi-select scope", () => {
    expect(inspectorScopeLabel({ kind: "page", page: 1 }, [1, 2, 3])).toBe("3 pages selected");
  });
  it("keeps the single-page label for a one-page or absent selection", () => {
    expect(inspectorScopeLabel({ kind: "page", page: 2 }, [2])).toBe("Page 2");
    expect(inspectorScopeLabel({ kind: "page", page: 2 }, null)).toBe("Page 2");
    expect(inspectorScopeLabel({ kind: "page", page: 2 }, undefined)).toBe("Page 2");
  });
});

describe("Phase 112 C2 follow-up — resolveInspectorPageSize", () => {
  it("prefers the live measured size over the seeded Crop map", () => {
    const live = new Map<number, { w: number; h: number }>([[2, { w: 612, h: 792 }]]);
    expect(resolveInspectorPageSize(2, live, { 2: { widthPt: 595, heightPt: 842 } })).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
  });
  it("falls back to the seeded sizes when the page is not measured live", () => {
    const live = new Map<number, { w: number; h: number }>([[1, { w: 612, h: 792 }]]);
    expect(resolveInspectorPageSize(3, live, { 3: { widthPt: 595, heightPt: 842 } })).toEqual({
      widthPt: 595,
      heightPt: 842,
    });
  });
  it("returns null when neither source knows the page — never 0, never a guessed A4", () => {
    expect(resolveInspectorPageSize(5, new Map(), {})).toBeNull();
    expect(resolveInspectorPageSize(5, undefined, {})).toBeNull();
    expect(resolveInspectorPageSize(5, null, { 4: { widthPt: 612, heightPt: 792 } })).toBeNull();
  });
});

describe("Phase 112 C2 — the RIGHT page inspector", () => {
  it("renders the REAL Size / Rotation / Label from props", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 2 },
      pageCount: 9,
      pageSize: { widthPt: 612, heightPt: 792 },
      pageRotation: 1,
      pageLabel: "ii",
    });
    try {
      expect(host.querySelector('[data-inspector-row="size"]')?.textContent).toContain(
        "612 x 792 pt",
      );
      expect(host.querySelector('[data-inspector-value="rotation"]')?.textContent).toBe(
        rotationDegreesText(1),
      );
      expect(host.querySelector('[data-inspector-value="label"]')?.textContent).toBe("ii");
    } finally {
      unmount();
    }
  });

  it("reads Not available for unknown meta — never 0 and never a guessed A4", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      pageCount: 4,
      pageSize: null,
      pageLabel: null,
    });
    try {
      const size = host.querySelector('[data-inspector-row="size"]')?.textContent ?? "";
      expect(size).toContain("Not available");
      expect(size).not.toContain("0");
      expect(size.toUpperCase()).not.toContain("A4");
      expect(host.querySelector('[data-inspector-value="label"]')?.textContent).toBe(
        "Not available",
      );
    } finally {
      unmount();
    }
  });

  it("shows Mixed for differing values and names the scope in the header", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      pageCount: 9,
      pageSelection: [1, 2, 3],
      pageSize: null,
      pageRotation: null,
      pageLabel: null,
      pageSizeMixed: true,
      pageRotationMixed: true,
      pageLabelMixed: true,
    });
    try {
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe(
        "Inspector \u00b7 3 pages selected",
      );
      expect(host.querySelector('[data-inspector-row="size"]')?.textContent).toContain("Mixed");
      expect(host.querySelector('[data-inspector-value="rotation"]')?.textContent).toBe("Mixed");
      expect(host.querySelector('[data-inspector-value="label"]')?.textContent).toBe("Mixed");
    } finally {
      unmount();
    }
  });

  it("names a single-page scope in the header", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 2 },
      pageCount: 9,
      pageSelection: [2],
    });
    try {
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe("Inspector \u00b7 Page 2");
    } finally {
      unmount();
    }
  });

  it("collapses the Document details disclosure while keeping its facts", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      pageCount: 9,
      fileSize: 2048,
      documentTitle: "Report.pdf",
    });
    try {
      const details = host.querySelector<HTMLDetailsElement>("[data-inspector-document-details]");
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
      expect(details?.querySelector('[data-inspector-row="page-count"]')?.textContent).toContain("9");
      expect(details?.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe(
        "2.0 KB",
      );
      expect(details?.querySelector('[data-inspector-row="title"]')?.textContent).toContain(
        "Report.pdf",
      );
    } finally {
      unmount();
    }
  });

  it("renders the page rows through the shared PropertyRow primitive", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      pageCount: 4,
    });
    try {
      const size = host.querySelector<HTMLElement>('[data-inspector-row="size"]');
      expect(size?.classList.contains("tf-panel-row")).toBe(true);
      expect(size?.classList.contains("inspector-row")).toBe(true);
      expect(size?.querySelector(".tf-panel-row-label")?.textContent).toBe("Size");
    } finally {
      unmount();
    }
  });
});