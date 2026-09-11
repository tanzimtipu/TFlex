// @vitest-environment jsdom
//
// Bug 4 + Bug 1 — keyboard / cross-tool disarm in the real DocumentView:
//   - Bug 4: Escape disarms ANY armed annotation creation tool (the
//     previous handler only closed the search bar, so an armed
//     sticky-note / ink / shape tool stayed hot after Escape).
//   - Bug 1: when an external tool surface activates (Edit-content
//     mode opens, the Sign tool is armed, the Stamp tool is armed),
//     the annotation creation tool disarms — two pointer-active
//     layers must never be hot at once.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

interface Harness {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  unmount: () => void;
}

async function mountView(): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      <DocumentView
        doc={makeDocStub(3)}
        pageCount={3}
        outline={null}
        initial={INITIAL_VIEWER}
        onPersist={(): void => undefined}
        onDiagnostics={(_d: DocDiagnostics): void => undefined}
        engineState={makeEngineState(3)}
        modified={false}
        canUndo={false}
        saveInPlaceEnabled={false}
        annotations={[]}
        formFields={[]}
        signatures={[]}
        savedSignatures={[]}
        stampAnnotations={[]}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    root,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function noteToolButton(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(
    ".ann-toolbar button[data-tool='note']",
  );
  if (btn === null) throw new Error("note tool button not found");
  return btn;
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("Bug 4 — Escape disarms any armed annotation tool", () => {
  it("arming the sticky-note tool then pressing Escape returns to select", async () => {
    const { host, unmount } = await mountView();
    try {
      const note = noteToolButton(host);
      act((): void => {
        note.click();
      });
      expect(note.getAttribute("aria-pressed")).toBe("true");
      pressEscape();
      const after = noteToolButton(host);
      expect(after.getAttribute("aria-pressed")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("Escape closes the search bar when no tool is armed", async () => {
    const { host, unmount } = await mountView();
    try {
      // Ctrl+F opens the search bar.
      act((): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
        );
      });
      expect(host.querySelector(".search-bar")).not.toBeNull();
      pressEscape();
      expect(host.querySelector(".search-bar")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Bug 1 — opening an external tool surface disarms the annotation tool", () => {
  it("flipping Edit-content mode ON disarms an armed annotation tool", async () => {
    const { host, root, unmount } = await mountView();
    try {
      const note = noteToolButton(host);
      act((): void => {
        note.click();
      });
      expect(note.getAttribute("aria-pressed")).toBe("true");
      // Open Edit content mode (rising edge of the external-tool flag).
      await act(async (): Promise<void> => {
        root.render(
          <DocumentView
            doc={makeDocStub(3)}
            pageCount={3}
            outline={null}
            initial={INITIAL_VIEWER}
            onPersist={(): void => undefined}
            onDiagnostics={(_d: DocDiagnostics): void => undefined}
            engineState={makeEngineState(3)}
            modified={false}
            canUndo={false}
            saveInPlaceEnabled={false}
            annotations={[]}
            formFields={[]}
            signatures={[]}
            savedSignatures={[]}
            stampAnnotations={[]}
            editModeOpen
          />,
        );
        await Promise.resolve();
      });
      const after = noteToolButton(host);
      expect(after.getAttribute("aria-pressed")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("arming the Stamp tool (armedStamp rising) disarms an armed annotation tool", async () => {
    const { host, root, unmount } = await mountView();
    try {
      const note = noteToolButton(host);
      act((): void => {
        note.click();
      });
      expect(note.getAttribute("aria-pressed")).toBe("true");
      const smallPng = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      await act(async (): Promise<void> => {
        root.render(
          <DocumentView
            doc={makeDocStub(3)}
            pageCount={3}
            outline={null}
            initial={INITIAL_VIEWER}
            onPersist={(): void => undefined}
            onDiagnostics={(_d: DocDiagnostics): void => undefined}
            engineState={makeEngineState(3)}
            modified={false}
            canUndo={false}
            saveInPlaceEnabled={false}
            annotations={[]}
            formFields={[]}
            signatures={[]}
            savedSignatures={[]}
            stampAnnotations={[]}
            armedStamp={{ stampId: "APPROVED", pngBytes: smallPng, pngWidth: 1, pngHeight: 1 }}
          />,
        );
        await Promise.resolve();
      });
      const after = noteToolButton(host);
      expect(after.getAttribute("aria-pressed")).toBe("false");
    } finally {
      unmount();
    }
  });
});