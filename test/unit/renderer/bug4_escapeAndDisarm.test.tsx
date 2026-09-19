// @vitest-environment jsdom
//
// Bug 4 + Bug 1 — keyboard / cross-tool disarm of the annotation tool:
//   - Bug 4: Escape disarms ANY armed annotation creation tool (the
//     previous handler only closed the search bar, so an armed
//     sticky-note / ink / shape tool stayed hot after Escape).
//   - Bug 1: when an external tool surface activates (Edit-content
//     mode opens, the Sign tool is armed, the Stamp tool is armed),
//     the annotation creation tool disarms — two pointer-active
//     layers must never be hot at once.
//
// ARCHITECTURE NOTE (unified-toolbar chunk): the annotation tool
// buttons moved out of DocumentView into the App-level UnifiedToolbar
// ribbon. The ribbon's Annotate wiring lands in the next chunk, so no
// UI inside DocumentView can ARM a tool today. The disarm CONTRACT
// (armed tool + Escape / external-surface entry -> select) is pinned
// here at the reducer level, using the exact action every DocumentView
// disarm effect dispatches: `{ type: "set-tool", tool: "select" }`
// (the Escape keydown effect, the editModeOpen rising-edge effect, the
// anyExternalToolActive rising-edge effect, and the handActive
// rising-edge effect — see DocumentView.tsx). The DOM-driven variants
// (click the button -> arm, Escape -> aria-pressed flips) return with
// the ribbon wiring.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import {
  annotationToolReducer,
  initialAnnotationToolState,
  type AnnotationTool,
  type AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the search bar is a TfBar inside an AnimatePresence, so its
 *  close now plays a token-driven exit before the node leaves the DOM.
 *  The Escape contract is unchanged (the bar closes immediately); only
 *  the DOM removal completes after the exit animation. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
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

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

/** Arm `tool` from the plain state — the same `set-tool` action the
 *  (future) ribbon buttons will dispatch. */
function arm(tool: AnnotationTool): AnnotationToolState {
  return annotationToolReducer(initialAnnotationToolState, { type: "set-tool", tool });
}

describe("Bug 4 — Escape disarms any armed annotation tool", () => {
  it("the Escape disarm payload returns an armed tool to select", () => {
    // The exact dispatch DocumentView's Escape keydown effect performs
    // when a tool is armed (and hand mode is not active). Pinned at
    // the reducer level until the ribbon's Annotate wiring makes the
    // DOM-driven variant runnable again.
    const armedNote = arm("note");
    expect(armedNote.tool).toBe("note");
    const after = annotationToolReducer(armedNote, { type: "set-tool", tool: "select" });
    expect(after.tool).toBe("select");
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
      // Phase 20 — the close is animated (TfBar exit), so the node
      // leaves the DOM once the exit completes. The Escape still closes
      // the search bar on the same keydown.
      await settleMotion();
      expect(host.querySelector(".search-bar")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Bug 1 — opening an external tool surface disarms the annotation tool", () => {
  it("the Edit-content-mode disarm payload returns an armed tool to select", () => {
    // The exact dispatch DocumentView performs on the rising edge of
    // `editModeOpen` (and the `anyExternalToolActive` edge that covers
    // Sign / Stamp). Pinned at the reducer level until the ribbon's
    // Annotate wiring makes the DOM-driven variant runnable again.
    const armedInk = arm("ink");
    expect(armedInk.tool).toBe("ink");
    const after = annotationToolReducer(armedInk, { type: "set-tool", tool: "select" });
    expect(after.tool).toBe("select");
  });

  it("the armed-Stamp disarm payload returns an armed tool to select", () => {
    const armedHighlight = arm("highlight");
    expect(armedHighlight.tool).toBe("highlight");
    const after = annotationToolReducer(armedHighlight, { type: "set-tool", tool: "select" });
    expect(after.tool).toBe("select");
  });
});