// @vitest-environment jsdom
//
// DEF-311..DEF-314 — the Phase 36 (chunk 3) Action Dock defects:
//
//   DEF-313 the dock renders a CURATED concept set per stage, not every
//           registry entry, and never spans the canvas over the pills.
//   DEF-314 the EDIT dock's `editMode` verb is the toggle that turns Edit
//           mode ON: enabled while OFF, pressed while ON.
//   DEF-312 the Pin/Unpin menu renders against the viewport (portal) and
//           clamps inside it, so a verb can actually be pinned.
//   DEF-311 a disabled verb's tooltip is the availability reason, not the
//           tool's description.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ActionDock, clampDockMenu, type ActionDockProps } from "../../../src/renderer/components/ActionDock";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import {
  DOCK_AVAILABILITY_REASON,
} from "../../../src/renderer/state/dockModel";
import {
  DOCK_STAGE_IDS,
  TOOL_REGISTRY,
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = Noop;
  }
  if (g.ResizeObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = Noop;
  }
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  if (proto.scrollTo === undefined) proto.scrollTo = (): void => undefined;
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

interface Harness {
  host: HTMLElement;
  unmount: () => void;
}

function renderDock(options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: 1400,
    ...options,
  };
  act((): void => {
    root.render(<ActionDock {...props} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const verbIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>("[data-dock-verb]")].map(
    (el) => el.getAttribute("data-dock-verb") ?? "",
  );

describe("DEF-313 — the dock's curated set per stage", () => {
  it("returns exactly the concept verbs, in order, per stage", () => {
    expect(dockToolsForStage("pages").map((e) => e.id)).toEqual([
      "rotate", "extract", "insertPages", "replacePages", "split", "delete",
    ]);
    expect(dockToolsForStage("edit").map((e) => e.id)).toEqual([
      "editMode", "editText", "editImage", "editTextBox", "recognizeText", "cropPages",
    ]);
    expect(dockToolsForStage("review").map((e) => e.id)).toEqual([
      "annotate", "sign", "stamp", "flatten",
    ]);
    expect(dockToolsForStage("deliver").map((e) => e.id)).toEqual([
      "optimize", "audit", "exportPages", "exportText", "exportDocx",
    ]);
    // Every curated id is uniquely owned by its stage list.
    const all = Object.values(DOCK_STAGE_IDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("every dock-stage id resolves to the registered dock surface", () => {
    for (const ids of Object.values(DOCK_STAGE_IDS)) {
      for (const id of ids) {
        const entry = toolById(id);
        expect(entry, id).toBeDefined();
        expect(entry?.surface, id).toBe("dock");
      }
    }
  });

  it("leaves the panel/context verbs and the non-concept commands out of the dock", () => {
    const docked = Object.values(DOCK_STAGE_IDS).flat();
    for (const id of [
      "merge", "renumberPages", "rotateCounterClockwise", "pageThumbnails",
      "outlinePanel", "pageContextMenu", "clearPageSelection", "dragPage",
      "editToolOff", "editDefaultFont", "batchOcr", "ocrSuspects", "forms",
      "watermark", "exportComments", "importComments", "annotationsPanel",
      "createFromImages",
    ]) {
      expect(docked, id).not.toContain(id);
      expect(toolById(id), id).toBeDefined();
    }
  });

  it("marks EVERY registry entry with a surface (flyout for the annotation set)", () => {
    for (const entry of TOOL_REGISTRY) expect(entry.surface, entry.id).toBeDefined();
    const flyout = TOOL_REGISTRY.filter((e) => e.surface === "flyout").map((e) => e.id);
    expect(flyout).toHaveLength(13);
  });
});

describe("DEF-313 — the dock can never span the canvas over the pills", () => {
  it("renders the same curated PAGES set wide and narrow (no 15-verb row)", () => {
    for (const canvasWidth of [900, 1400]) {
      const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth });
      try {
        expect(verbIds(host)).toHaveLength(6);
        expect(verbIds(host)).toEqual([
          "rotate", "extract", "insertPages", "replacePages", "split", "delete",
        ]);
      } finally {
        unmount();
      }
    }
  });

  it("caps the dock width to the MEASURED pill reserve (DEF-315) and lets the verb group wrap", () => {
    const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // DEF-315 supersedes the hardcoded 380px reserve: the cap subtracts the
    // MEASURED pill band published as --dock-reserve (fallback 476px = the live
    // measurement of the widest pill), and `max(0px, ...)` keeps it valid at a
    // host narrower than the reserve.
    expect(css).toMatch(
      /\.action-dock\s*\{[^}]*max-width:\s*max\(0px,\s*calc\(100% - var\(--dock-reserve,\s*476px\)\)\)/s,
    );
    expect(css).not.toMatch(/max\(220px,\s*calc\(100% - 380px\)\)/);
    // The verb group wraps instead of overflowing/clipping its trailing verb.
    expect(css).toMatch(/\.action-dock-group\s*\{[^}]*flex-wrap:\s*wrap/s);
  });
});

describe("DEF-314 — the EDIT dock's editMode verb toggles Edit mode ON", () => {
  function mountEditable(toggles: boolean[]): HTMLElement {
    stubObservers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    function Harness(): ReturnType<typeof createElement> {
      const [open, setOpen] = useState(false);
      return createElement(DocumentView, {
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
        multiModeEnabled: false,
        activeStage: "edit",
        dockPins: [],
        onDockToolAction: vi.fn(() => true),
        isDockToolEnabled: (): boolean => true,
        sharedTools: null,
        editModeOpen: open,
        onEditModeToggle: (): void => {
          toggles.push(!open);
          setOpen((v) => !v);
        },
      });
    }
    act((): void => {
      root.render(createElement(Harness));
    });
    return host;
  }

  it("enables editMode while Edit mode is OFF and reaches the toggle on click", () => {
    const toggles: boolean[] = [];
    const host = mountEditable(toggles);
    try {
      const button = host.querySelector<HTMLButtonElement>('[data-dock-verb="editMode"]');
      expect(button).not.toBeNull();
      expect(button?.hasAttribute("disabled"), "editMode is the ON switch, so it is enabled").toBe(
        false,
      );
      act((): void => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(toggles, "the dock's editMode verb toggled Edit mode ON").toEqual([true]);
      // The re-render reflects ON: pressed state.
      expect(
        host.querySelector('[data-dock-verb="editMode"]')?.getAttribute("aria-pressed"),
      ).toBe("true");
    } finally {
      host.remove();
    }
  });
});

describe("DEF-312 — the Pin/Unpin menu is viewport-positioned and clampable", () => {
  it("portals the menu to the body, clamped inside the window, and pins through the UI", () => {
    const onPinTool = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "deliver", onPinTool });
    try {
      const button = host.querySelector<HTMLElement>('[data-dock-verb="optimize"]');
      expect(button).not.toBeNull();
      const nearRight = window.innerWidth - 2;
      const nearBottom = window.innerHeight - 2;
      act((): void => {
        button?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: nearRight,
            clientY: nearBottom,
          }),
        );
      });
      const menu = document.body.querySelector<HTMLElement>("[data-dock-menu]");
      expect(menu, "the menu is in the DOM").not.toBeNull();
      // It is NOT a descendant of the transformed dock (the DEF-312 cause).
      expect(host.contains(menu as Node)).toBe(false);
      const left = Number.parseFloat((menu as HTMLElement).style.left);
      const top = Number.parseFloat((menu as HTMLElement).style.top);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(window.innerWidth - 168);
      expect(top).toBeLessThanOrEqual(window.innerHeight - 76);
      // Pinning goes through the real menu item.
      act((): void => {
        menu
          ?.querySelector<HTMLElement>('[data-dock-menu-item="pin"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(onPinTool).toHaveBeenCalledWith("optimize");
    } finally {
      unmount();
    }
  });

  it("clamps a pointer far outside the window back inside", () => {
    const vw = 1000;
    const vh = 700;
    const pos = clampDockMenu(2000, 2000, 168, 76, vw, vh);
    expect(pos.left).toBe(vw - 168 - 8);
    expect(pos.top).toBe(vh - 76 - 8);
  });
});

describe("DEF-311 — a disabled verb shows the availability reason", () => {
  it("prefers the registry's availability copy over the description", () => {
    const { host, unmount } = renderDock({
      activeStage: "deliver",
      isToolEnabled: (entry) => entry.id !== "audit",
    });
    try {
      const audit = host.querySelector<HTMLElement>('[data-dock-verb="audit"]');
      expect(audit?.hasAttribute("disabled")).toBe(true);
      expect(audit?.getAttribute("title")).toBe(DOCK_AVAILABILITY_REASON.document);
      expect(audit?.getAttribute("title")).not.toBe(toolById("audit")?.description);
    } finally {
      unmount();
    }
  });

  it("lets the host's live reason win when it supplies one", () => {
    const { host, unmount } = renderDock({
      activeStage: "edit",
      isToolEnabled: (entry) => entry.id !== "editText",
      disabledReasonFor: (entry) =>
        entry.id === "editText" ? "Turn on Edit content first" : undefined,
    });
    try {
      const text = host.querySelector<HTMLElement>('[data-dock-verb="editText"]');
      expect(text?.getAttribute("title")).toBe("Turn on Edit content first");
    } finally {
      unmount();
    }
  });
});

