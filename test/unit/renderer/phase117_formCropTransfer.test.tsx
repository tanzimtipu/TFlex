// @vitest-environment jsdom
//
// Phase 117 (chunk E) — crop-region selection chrome on the shared
// grammar, plus the no-fork guard for form widgets and page transfer.
//
//   (a) The crop box renders the ONE shared selection chrome: a
//       `[data-selection-boundary]` violet boundary and four corner
//       targets that keep `data-crop-handle` AND carry the shared
//       `.selection-handle` class (8 px visual + 32/44 px hit target).
//       A resize pointerdown still drives the unchanged resize maths.
//   (b) A form widget stays a GUIDED-FILL surface: FormsOverlay renders
//       `[data-form-field]` and NEVER a `[data-selection-boundary]`.
//   (c) The page-drag affordance stays distinct from object drag: the
//       canvas page grip renders no `[data-selection-boundary]`.
//
// jsdom lacks ResizeObserver / IntersectionObserver; both the crop
// editor and DocumentView install them. Stub both up front.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CropPagesDialog } from "../../../src/renderer/components/CropPagesDialog";
import { FormsOverlay } from "../../../src/renderer/forms/FormsOverlay";
import { DocumentView, type DocDiagnostics, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import { PageDragProvider } from "../../../src/renderer/state/PageDragContext";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FormField } from "../../../src/shared/types";

if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}
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

interface MountHandle {
  host: HTMLElement;
  cleanup: () => void;
}

function mount(element: ReactElement): MountHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(element);
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

const DEFAULT_PAGE_SIZES: Record<number, { widthPt: number; heightPt: number }> = {
  1: { widthPt: 612, heightPt: 792 },
  2: { widthPt: 612, heightPt: 792 },
  3: { widthPt: 612, heightPt: 792 },
};

const CORNERS = ["nw", "ne", "sw", "se"] as const;

describe("phase117 (chunk E) — crop chrome on the shared selection grammar", () => {
  it("renders the shared boundary and four shared-grammar corner handles", () => {
    const onConfirm = vi.fn();
    const { host, cleanup } = mount(
      <CropPagesDialog
        open={true}
        totalPages={3}
        pageSizes={DEFAULT_PAGE_SIZES}
        onConfirm={onConfirm}
        onClose={(): void => undefined}
      />,
    );
    try {
      const editor = host.querySelector<HTMLElement>("[data-crop-editor]");
      expect(editor).not.toBeNull();
      if (editor === null) return;
      // The 1 px violet boundary is the shared `.selection-chrome.is-selected`
      // root carrying `data-selection-boundary`.
      const boundary = editor.querySelector<HTMLElement>(
        ".selection-chrome.is-selected[data-selection-boundary]",
      );
      expect(boundary).not.toBeNull();
      // The move mask survives untouched (move + label, data-crop-handle).
      expect(editor.querySelector('[data-crop-handle="move"]')).not.toBeNull();
      // Every corner keeps its data-crop-handle AND the shared handle class
      // (8 px visual + the 32/44 px `.selection-handle::before` hit target).
      for (const corner of CORNERS) {
        const handle = editor.querySelector<HTMLElement>(`[data-crop-handle="${corner}"]`);
        expect(handle, corner).not.toBeNull();
        if (handle === null) continue;
        expect(handle.classList.contains("selection-handle"), corner).toBe(true);
        expect(handle.classList.contains(`selection-handle-${corner}`), corner).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("a corner resize pointerdown still drives the unchanged resize maths", () => {
    const { host, cleanup } = mount(
      <CropPagesDialog
        open={true}
        totalPages={3}
        pageSizes={DEFAULT_PAGE_SIZES}
        onConfirm={(): void => undefined}
        onClose={(): void => undefined}
      />,
    );
    try {
      const mask = host.querySelector<HTMLElement>('[data-crop-handle="move"]');
      const se = host.querySelector<HTMLElement>('[data-crop-handle="se"]');
      expect(mask).not.toBeNull();
      expect(se).not.toBeNull();
      if (mask === null || se === null) return;
      const widthBefore = mask.style.width;
      const heightBefore = mask.style.height;
      act((): void => {
        se.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 400,
            clientY: 600,
          }),
        );
      });
      act((): void => {
        window.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: 450, clientY: 650 }),
        );
      });
      act((): void => {
        window.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, clientX: 450, clientY: 650 }),
        );
      });
      // The SE handle grew the box (resize path ran on the shared target).
      expect(mask.style.width).not.toBe(widthBefore);
      expect(mask.style.height).not.toBe(heightBefore);
    } finally {
      cleanup();
    }
  });
});

describe("phase117 (chunk E) — form widgets stay a guided-fill surface (no fork)", () => {
  function textField(id: string): FormField {
    return {
      id,
      name: id,
      page: 1,
      kind: "text",
      rect: { x: 0, y: 0, width: 100, height: 20 },
      value: "",
    };
  }

  it("renders [data-form-field] and never a selection boundary", () => {
    const { host, cleanup } = mount(
      <FormsOverlay
        page={1}
        cssScale={1}
        fields={[textField("f-name"), textField("f-email")]}
        onValueChange={(): void => undefined}
        onToggleListbox={(): void => undefined}
      />,
    );
    try {
      expect(host.querySelector("[data-form-field]")).not.toBeNull();
      // A form widget is never an object selection: no shared violet
      // boundary, no object handles bleed onto the field chrome.
      expect(host.querySelector("[data-selection-boundary]")).toBeNull();
      expect(host.querySelector(".selection-chrome")).toBeNull();
      expect(host.querySelector(".selection-handle")).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Page transfer stays distinct from object drag.
// ---------------------------------------------------------------------------

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

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

describe("phase117 (chunk E) — page transfer never borrows object-selection chrome", () => {
  it("renders the page-drag grip with no [data-selection-boundary]", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act((): void => {
      root.render(
        <PageDragProvider>
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
            pageDrag={{ tabId: "b", onDrop: (): void => undefined }}
          />
        </PageDragProvider>,
      );
    });
    try {
      const grip = host.querySelector<HTMLElement>('[data-page-drag-handle="1"]');
      expect(grip).not.toBeNull();
      expect(grip?.tagName).toBe("BUTTON");
      // Page transfer is its own affordance: it never paints the shared
      // object-selection boundary / handles.
      expect(host.querySelector("[data-selection-boundary]")).toBeNull();
      expect(host.querySelector(".selection-chrome")).toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
