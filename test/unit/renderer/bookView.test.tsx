// @vitest-environment jsdom
//
// Phase 66 (chunk 1) — the Book View mode shell.
//
// The shell is a read-only surface: it renders the current page through the
// existing PageView and must contain NO editing chrome (no Action Dock, no
// annotation toolbar). The entry control lives on the host DocumentView surface
// and toggles the host verb when wired; with the prop absent the canvas is
// unchanged.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookView } from "../../../src/renderer/components/BookView";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";

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

async function mount(node: ReturnType<typeof createElement>): Promise<{
  host: HTMLElement;
  cleanup: () => void;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("BookView — the read-only mode shell (Phase 66 chunk 1)", () => {
  it("renders the read-only page surface and NO editing chrome", async () => {
    stubObservers();
    const view = await mount(
      createElement(BookView, {
        doc: makeDocStub(3),
        pageCount: 3,
        title: "Novel.pdf",
        defaultLayout: "single",
        annotations: [],
        onCreateAnnotation: (): void => undefined,
        onClose: (): void => undefined,
      }),
    );
    try {
      expect(view.host.querySelector("[data-book-view]")).not.toBeNull();
      expect(view.host.querySelector("[data-book-stage]")).not.toBeNull();
      // The page surface: one page slot marked "single" (no spread yet).
      expect(view.host.querySelector("[data-book-page]")).not.toBeNull();
      expect(view.host.querySelector('[data-book-page-side="single"]')).not.toBeNull();
      // Read-only: no Action Dock. Phase 66 (chunk 3) mounts the EXISTING
      // annotation toolbar as Book View's one marking surface.
      expect(view.host.querySelector("[data-action-dock]")).toBeNull();
      expect(view.host.querySelector("[data-annotation-toolbar]")).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("exits through the Close book view control", async () => {
    stubObservers();
    const onClose = vi.fn();
    const view = await mount(
      createElement(BookView, {
        doc: makeDocStub(3),
        pageCount: 3,
        title: "Novel.pdf",
        defaultLayout: "single",
        annotations: [],
        onCreateAnnotation: (): void => undefined,
        onClose,
      }),
    );
    try {
      const close = view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Close book view"]',
      );
      expect(close).not.toBeNull();
      act((): void => {
        close?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });

  it("steps to the next page in place", async () => {
    stubObservers();
    const view = await mount(
      createElement(BookView, {
        doc: makeDocStub(3),
        pageCount: 3,
        title: "Novel.pdf",
        defaultLayout: "single",
        annotations: [],
        onCreateAnnotation: (): void => undefined,
        onClose: (): void => undefined,
      }),
    );
    try {
      expect(view.host.querySelector("[data-book-page]")?.getAttribute("data-book-page")).toBe("1");
      act((): void => {
        view.host.querySelector<HTMLButtonElement>("[data-book-next]")?.click();
      });
      expect(view.host.querySelector("[data-book-page]")?.getAttribute("data-book-page")).toBe("2");
    } finally {
      view.cleanup();
    }
  });
});

describe("DocumentView — the Book View entry (Phase 66 chunk 1)", () => {
  async function mountDocument(onOpenBookView?: () => void): Promise<{
    host: HTMLElement;
    cleanup: () => void;
  }> {
    stubObservers();
    return mount(
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
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        onOpenBookView,
      }),
    );
  }

  it("mounts the top-left entry only when the host wires the verb", async () => {
    const wired = await mountDocument((): void => undefined);
    try {
      const entry = wired.host.querySelector('[aria-label="Book View"]');
      expect(entry).not.toBeNull();
      expect(entry?.getAttribute("data-book-view-open")).not.toBeNull();
    } finally {
      wired.cleanup();
    }

    const bare = await mountDocument(undefined);
    try {
      expect(bare.host.querySelector('[aria-label="Book View"]')).toBeNull();
    } finally {
      bare.cleanup();
    }
  });

  it("fires the host verb when the entry is clicked", async () => {
    const onOpenBookView = vi.fn();
    const view = await mountDocument(onOpenBookView);
    try {
      act((): void => {
        view.host
          .querySelector<HTMLButtonElement>('[aria-label="Book View"]')
          ?.click();
      });
      expect(onOpenBookView).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });
});
