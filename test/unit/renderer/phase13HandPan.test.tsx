// @vitest-environment jsdom
//
// Phase 13 — Hand (pan) mode in the real DocumentView:
//   - The toolbar's Hand button arms pan mode: the scroller gets the
//     hand class + data-hand flag and the annotation tool state drops
//     to select (two pointer-active surfaces must never be hot at
//     once; the button-level inertness now rides on the App-level
//     UnifiedToolbar ribbon, wired in the next chunk).
//   - Escape exits pan mode before anything else.
//   - A pan press on a PAGE surface starts the drag (dragging flag)
//     and a press on an INTERACTIVE control is left alone — the click
//     still fires (cross-bubbling contract, AGENTS.md).
//   - The external-tool disarm cascade: arming Edit mode drops pan.
import { describe, expect, it, vi } from "vitest";
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

async function mountView(overrides: Record<string, unknown> = {}): Promise<{
  host: HTMLElement;
  unmount: () => void;
}> {
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
        {...overrides}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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

function scroller(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>(".document-scroller");
  if (el === null) throw new Error("scroller not found");
  return el;
}

/** Dispatch a pointer-sequence on the element. jsdom has no real
 *  pointer events; a MouseEvent with the pointer type name carries
 *  the coordinates and button React's handlers read. */
function pointer(el: Element, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  el.dispatchEvent(e);
}

describe("Phase 13 — Hand (pan) mode", () => {
  it("arming Hand sets the pressed state and the scroller affordance", async () => {
    const { host, unmount } = await mountView();
    try {
      const hand = host.querySelector<HTMLButtonElement>("[data-hand-toggle]");
      expect(hand).not.toBeNull();
      act((): void => {
        hand?.click();
      });
      const after = host.querySelector<HTMLButtonElement>("[data-hand-toggle]");
      expect(after?.getAttribute("aria-pressed")).toBe("true");
      expect(after?.classList.contains("btn-toggle")).toBe(true);
      const sc = scroller(host);
      expect(sc.classList.contains("document-scroller-hand")).toBe(true);
      expect(sc.getAttribute("data-hand")).toBe("true");
      // The annotation tool state drop on the hand rising edge is
      // pinned in bug4_escapeAndDisarm.test.ts (reducer level); the
      // button-level inertness moves with the ribbon's Annotate
      // wiring.
      // Phase 113 — the Hand control is the shared IconButton, whose required
      // `label` writes BOTH aria-label and title (the guidance collapse is the
      // chunk-B foundation contract). The accessible name stays "Pan mode".
      expect(after?.getAttribute("aria-label")).toBe("Pan mode");
      expect(after?.getAttribute("title")).toBe("Pan mode");
    } finally {
      unmount();
    }
  });

  it("Escape exits pan mode first (before the annotation tool / search layers)", async () => {
    const { host, unmount } = await mountView();
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-hand-toggle]")?.click();
      });
      expect(scroller(host).classList.contains("document-scroller-hand")).toBe(true);
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(scroller(host).classList.contains("document-scroller-hand")).toBe(false);
      expect(host.querySelector<HTMLButtonElement>("[data-hand-toggle]")?.getAttribute("aria-pressed")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("a press on a page surface starts the drag; a press on a control bails and its click still fires", async () => {
    const { host, unmount } = await mountView();
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-hand-toggle]")?.click();
      });
      const sc = scroller(host);
      // Page press -> drag starts (dragging flag set on the scroller).
      const pageSlot = sc.querySelector<HTMLElement>(".page-slot");
      expect(pageSlot).not.toBeNull();
      if (pageSlot === null) return;
      act((): void => {
        pointer(pageSlot, "pointerdown", 200, 150);
      });
      expect(sc.getAttribute("data-hand-dragging")).toBe("true");
      act((): void => {
        pointer(pageSlot, "pointermove", 240, 190);
        pointer(pageSlot, "pointerup", 240, 190);
      });
      expect(sc.hasAttribute("data-hand-dragging")).toBe(false);

      // Interactive press -> bail BEFORE preventDefault; the native
      // click still lands on the control.
      const ctrl = document.createElement("button");
      ctrl.type = "button";
      let clicked = false;
      ctrl.addEventListener("click", (): void => {
        clicked = true;
      });
      sc.appendChild(ctrl);
      let downDefaulted = true;
      act((): void => {
        const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
        ctrl.dispatchEvent(down);
        downDefaulted = down.defaultPrevented;
        ctrl.click();
      });
      expect(downDefaulted).toBe(false); // press was NOT swallowed
      expect(clicked).toBe(true);
      expect(sc.hasAttribute("data-hand-dragging")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("opening Edit mode while pan is armed drops pan (external tool wins)", async () => {
    const onEditModeToggle = vi.fn();
    const { host, unmount } = await mountView({ editModeOpen: true, onEditModeToggle });
    try {
      // Pan rises while Edit is already open -> the cascade closes Edit.
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-hand-toggle]")?.click();
      });
      expect(onEditModeToggle).toHaveBeenCalledTimes(1);
      // Hand stays armed until the host re-renders with editModeOpen=false;
      // the rising-edge ref prevents repeat calls.
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-hand-toggle]")?.click();
      });
      expect(onEditModeToggle).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});