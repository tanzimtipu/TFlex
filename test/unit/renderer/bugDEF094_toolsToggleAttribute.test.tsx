// @vitest-environment jsdom
//
// Regression guard for DEF-094 — the Tools palette toggle must expose
// a stable attribute that e2e harnesses can target without scraping
// labels. The original fix put `data-tools-toggle` on the command-bar
// button; when the toggle moved OFF the bar it became the floating
// badge on the page view's right edge (DocumentView's .tools-badge).
// The badge keeps `data-tools-toggle` alongside the new
// `data-tools-badge` hook so every e2e spec that opens the Tools
// palette via `[data-tools-toggle]` (Merge / Export / OCR / Optimize
// dialogs) keeps resolving on the moved control.
//
// These tests mount the real DocumentView (the component that renders
// the badge) with the same stub doc/engine state the hand-pan suite
// uses, and assert the badge is a button carrying BOTH stable
// attributes in both palette states, that clicking it fires the host
// callback, and that an unwired toggle renders no ghost control.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
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

describe("DEF-094 — the Tools palette toggle keeps a stable e2e attribute (now the page-view badge)", () => {
  it("renders the badge as a button carrying BOTH data-tools-badge and data-tools-toggle", async () => {
    const { host, unmount } = await mountView({
      toolsPaletteOpen: false,
      onToolsPaletteToggle: (): void => undefined,
    });
    try {
      // The new hook the badge is known under...
      const badge = host.querySelector<HTMLElement>("[data-tools-badge]");
      expect(badge).not.toBeNull();
      expect(badge?.tagName.toLowerCase()).toBe("button");
      // ...AND the long-standing e2e hook that hundreds of specs
      // target: same element, so [data-tools-toggle] keeps resolving.
      const legacy = host.querySelectorAll("[data-tools-toggle]");
      expect(legacy.length).toBe(1);
      expect(legacy[0] === badge).toBe(true);
      // Accessible name + tooltip survive the move (the no-op sweep
      // can still name the control).
      expect(badge?.getAttribute("aria-label")).toBe("Open tools palette");
      expect(badge?.getAttribute("title")).toContain("Ctrl+Shift+P");
      // And the click handler is wired — clicking it doesn't throw.
      expect((): void => badge?.click()).not.toThrow();
    } finally {
      unmount();
    }
  });

  it("the badge keeps both attributes in both closed and open states", async () => {
    for (const open of [false, true]) {
      const { host, unmount } = await mountView({
        toolsPaletteOpen: open,
        onToolsPaletteToggle: (): void => undefined,
      });
      try {
        const badge = host.querySelector<HTMLElement>("[data-tools-badge]");
        expect(badge, `badge missing for open=${open}`).not.toBeNull();
        expect(badge?.hasAttribute("data-tools-toggle")).toBe(true);
        expect(badge?.getAttribute("aria-pressed")).toBe(open ? "true" : "false");
      } finally {
        unmount();
      }
    }
  });

  it("clicking the badge fires the host toggle callback", async () => {
    const onToggle = vi.fn();
    const { host, unmount } = await mountView({
      toolsPaletteOpen: false,
      onToolsPaletteToggle: onToggle,
    });
    try {
      const badge = host.querySelector<HTMLElement>("[data-tools-badge]");
      act((): void => {
        badge?.click();
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("the badge glyph flips with the palette state (ChevronLeft closed, ChevronRight open)", async () => {
    const { host, unmount } = await mountView({
      toolsPaletteOpen: false,
      onToolsPaletteToggle: (): void => undefined,
    });
    try {
      const closedIcon = host.querySelector<SVGSVGElement>("[data-tools-badge] svg");
      expect(closedIcon?.getAttribute("class")).toContain("lucide-chevron-left");
    } finally {
      unmount();
    }

    const opened = await mountView({
      toolsPaletteOpen: true,
      onToolsPaletteToggle: (): void => undefined,
    });
    try {
      const openIcon = opened.host.querySelector<SVGSVGElement>("[data-tools-badge] svg");
      expect(openIcon?.getAttribute("class")).toContain("lucide-chevron-right");
    } finally {
      opened.unmount();
    }
  });

  it("renders no badge (and no ghost control) when the host does not wire a toggle", async () => {
    const { host, unmount } = await mountView({ toolsPaletteOpen: false });
    try {
      expect(host.querySelector("[data-tools-badge]")).toBeNull();
    } finally {
      unmount();
    }
  });
});