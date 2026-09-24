// @vitest-environment jsdom
//
// Phase 36 (chunk 3b) — the command toolbar ROW is RETIRED in SINGLE mode.
//
// This is the "nothing becomes unreachable" proof. Two halves:
//
//   1. DOM: a mounted single-mode DocumentView renders NO `.toolbar` row and
//      DOES render the floating pills; the dock's Annotate primary opens the
//      ONE annotations flyout (carrying the re-parented AnnotationToolbar);
//      CANVAS RECLAIM: the scroller still owns the `.workspace-main` 1fr row,
//      so the collapsed toolbar row's height returns to the canvas.
//   2. REGISTRY: a table of every control the retired row hosted, each mapped
//      to the dock stage / palette entry that now reaches it — asserted
//      against `dockToolsForStage` and `PALETTE_TOOL_IDS`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import { SharedToolController } from "../../../src/renderer/components/multiToolController";
import type { EngineState } from "../../../src/renderer/engine/types";
import {
  PALETTE_TOOL_IDS,
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";
import type { Stage } from "../../../src/renderer/state/stages";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

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
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
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

interface MountOptions {
  activeStage?: Stage;
  multiModeEnabled?: boolean;
  /** Supplying the shared controller puts the view in Multi Mode (the pane
   *  suppresses its own rows). */
  multiMode?: boolean;
}

async function mountView(options: MountOptions = {}): Promise<HTMLElement> {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const controller = new SharedToolController();
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
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        multiModeEnabled: options.multiModeEnabled ?? false,
        activeStage: options.activeStage,
        dockPins: [],
        onDockToolAction: vi.fn(() => true),
        isDockToolEnabled: (): boolean => true,
        sharedTools:
          options.multiMode === true ? { pane: "A", controller } : null,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return host;
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 36 (chunk 3b) — the toolbar row is retired in SINGLE mode", () => {
  it("renders NO command toolbar row and NO duplicate annotation row", async () => {
    const host = await mountView({ activeStage: "review" });
    try {
      expect(host.querySelector(".toolbar")).toBeNull();
      // The only annotation surface is the (closed) flyout — none is mounted yet.
      expect(host.querySelector("[data-annotation-toolbar]")).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("renders the floating pills instead of the row's view clusters", async () => {
    const host = await mountView({ activeStage: "pages" });
    try {
      expect(host.querySelector("[data-canvas-pills]")).not.toBeNull();
      expect(host.querySelector('[aria-label="Previous page"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Current page"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Fit page"]')).not.toBeNull();
      expect(host.querySelector("[data-hand-toggle]")).not.toBeNull();
    } finally {
      host.remove();
    }
  });

  it("reclaims the row height: the scroller still owns the 1fr grid row", async () => {
    const host = await mountView({ activeStage: "pages" });
    try {
      const main = host.querySelector(".workspace-main");
      expect(main).not.toBeNull();
      // The retired row leaves no in-flow chrome before the scroller, so the
      // grid's auto rows collapse and the 1fr row (row 5) keeps the space.
      expect(main?.querySelector(".document-scroller")).not.toBeNull();
      const src = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src).toMatch(/\.workspace-main\s*\{[^}]*grid-template-rows:\s*auto auto auto auto 1fr/s);
      expect(src).toMatch(/\.document-scroller\s*\{[^}]*grid-row:\s*5/s);
    } finally {
      host.remove();
    }
  });

  it("opens the ONE annotations flyout from the REVIEW dock's Annotate primary", async () => {
    const host = await mountView({ activeStage: "review" });
    try {
      const annotate = host.querySelector('[data-dock-verb="annotate"]');
      expect(annotate).not.toBeNull();
      expect(host.querySelector("[data-annotation-flyout]")).toBeNull();
      clickOn(annotate as Element);
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(1);
      expect(host.querySelectorAll("[data-annotation-toolbar]")).toHaveLength(1);
    } finally {
      host.remove();
    }
  });
});

describe("Phase 36 (chunk 3b) — Multi Mode keeps its shared row and shows no pills", () => {
  it("suppresses the pills, the dock and the flyout in a Multi Mode pane", async () => {
    const host = await mountView({ activeStage: "review", multiMode: true, multiModeEnabled: true });
    try {
      expect(host.querySelector("[data-canvas-pills]")).toBeNull();
      expect(host.querySelector("[data-action-dock]")).toBeNull();
      expect(host.querySelector("[data-annotation-flyout]")).toBeNull();
    } finally {
      host.remove();
    }
  });
});

describe("Phase 36 (chunk 3b) — every retired row control has a reachable new home", () => {
  /** control -> the dock stage whose CURATED verb set now reaches it
   *  (DEF-313: the dock is a concept-sized set, not every registry entry). */
  const DOCK_HOME: ReadonlyArray<[string, Stage]> = [
    ["rotate", "pages"],
    ["delete", "pages"],
    ["split", "pages"],
    ["insertPages", "pages"],
    ["replacePages", "pages"],
    ["editMode", "edit"],
    ["editText", "edit"],
    ["recognizeText", "edit"],
    ["sign", "review"],
    ["flatten", "review"],
    ["annotate", "review"],
    ["stamp", "review"],
    ["optimize", "deliver"],
    ["audit", "deliver"],
    ["exportPages", "deliver"],
  ];

  it.each(DOCK_HOME)("%s is a %s dock verb", (id, stage) => {
    expect(dockToolsForStage(stage).map((e) => e.id)).toContain(id);
  });

  it("controls that left the dock keep a registered, reachable home", () => {
    // Merge moved to the PAGES panel header + the palette; rotate-CCW and
    // renumber stay in the PAGES panel's per-page menu; create-from-images
    // stays in the palette + the welcome screen. Nothing is removed.
    expect(toolById("merge")?.surface).toBe("palette");
    expect(PALETTE_TOOL_IDS).toContain("merge");
    expect(toolById("rotateCounterClockwise")?.surface).toBe("panel");
    expect(toolById("renumberPages")?.surface).toBe("panel");
    expect(toolById("createFromImages")?.surface).toBe("palette");
    expect(PALETTE_TOOL_IDS).toContain("createFromImages");
  });

  it("pan mode, find and multi-mode keep a registered reachable home", () => {
    // Find is the Ctrl+F search overlay + the registry entry the command
    // palette (Ctrl+K) reads; the All-tools palette never listed it.
    expect(toolById("find")?.shortcut).toBe("Ctrl+F");
    // Pan mode's visible home is the pills' Hand control (asserted in the
    // DOM test above); it is also registered + reachable from Ctrl+K.
    expect(toolById("panMode")).toBeDefined();
    // Multi Mode keeps its All-tools palette row until the title-bar chunk.
    expect(PALETTE_TOOL_IDS).toContain("multi-mode");
  });

  it("the annotation tools' canonical home is the flyout (surface) and they are registered", () => {
    const ann = [
      "annSelect", "annHighlight", "annUnderline", "annStrikeout", "annInk",
      "annTextbox", "annRect", "annEllipse", "annArrow", "annCallout",
      "annNote", "annColor", "annPenWidth",
    ];
    for (const id of ann) {
      expect(toolById(id)?.surface, id).toBe("flyout");
      // They still exist (reachable via the Annotate flyout) — nothing removed.
      expect(toolById(id)).toBeDefined();
    }
  });

  it("has NO unreachable control: every dock-stage tool resolves to a registered entry", () => {
    for (const stage of ["pages", "edit", "review", "deliver"] as const) {
      for (const entry of dockToolsForStage(stage)) {
        expect(toolById(entry.id), entry.id).toBeDefined();
      }
    }
  });
});