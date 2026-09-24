// @vitest-environment jsdom
//
// Phase 36 (chunk 5) — the ALL-TOOLS PANEL and its BADGE are RETIRED as UI.
//
// Two halves:
//   1. DOM: a mounted single-mode DocumentView renders NO badge
//      (`[data-tools-badge]` / `.tools-badge-tracker` / `[data-tools-toggle]`)
//      and NO palette (`[data-tools-palette]`).
//   2. ROUTES + SOURCE: the File > Tools route (`showToolsPalette`) still
//      dispatches but now opens the Command Palette; the legacy Ctrl+Shift+P
//      chord opens the palette; the registry's `toolsPalette` entry points at
//      `openCommandPalette`; the registry data survives; and App no longer
//      renders the palette/badge or writes `toolsPaletteLayout`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import { dispatchMenuAction } from "../../../src/renderer/state/menuActions";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";
import { paletteChordFor } from "../../../src/renderer/state/commandPalette";
import {
  PALETTE_GROUPS,
  PALETTE_TOOL_IDS,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";

const APP_SRC = readFileSync(
  resolve(__dirname, "../../../src/renderer/App.tsx"),
  "utf8",
);

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

async function mountView(): Promise<HTMLElement> {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return host;
}

describe("Phase 36 chunk 5 — the All-tools badge and palette are gone from the DOM", () => {
  it("a mounted DocumentView renders no badge and no palette", async () => {
    const host = await mountView();
    try {
      expect(host.querySelector("[data-tools-badge]")).toBeNull();
      expect(host.querySelector(".tools-badge-tracker")).toBeNull();
      expect(host.querySelector("[data-tools-toggle]")).toBeNull();
      expect(host.querySelector("[data-tools-palette]")).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("App no longer renders the palette or the badge", () => {
    expect(APP_SRC).not.toContain("<ToolsPalette");
    expect(APP_SRC).not.toContain("<ToolsBadge");
    expect(APP_SRC).not.toContain("data-tools-mode");
    expect(APP_SRC).not.toContain("setToolsPaletteOpen");
    expect(APP_SRC).toContain("<Inspector");
  });
});

describe("Phase 36 chunk 5 — the retired panel's routes still resolve", () => {
  it("the File > Tools menu action dispatches to the host's showToolsPalette", () => {
    const showToolsPalette = vi.fn();
    const ctx = new Proxy({}, {
      get: (_t, prop): (() => void) =>
        prop === "showToolsPalette" ? showToolsPalette : (): void => undefined,
    }) as unknown as MenuActionContext;
    expect(dispatchMenuAction("showToolsPalette", ctx)).toBe(true);
    expect(showToolsPalette).toHaveBeenCalledTimes(1);
  });

  it("App re-points showToolsPalette at the Command Palette", () => {
    const handler = APP_SRC.slice(
      APP_SRC.indexOf("showToolsPalette: ()"),
      APP_SRC.indexOf("showToolsPalette: ()") + 600,
    );
    expect(handler).toContain("setCommandPaletteOpen(true)");
    // The renderer's menu label matches the new route.
    expect(APP_SRC).toContain('label: "Command Palette..."');
  });

  it("the legacy Ctrl+Shift+P chord opens the palette (not a panel)", () => {
    expect(
      paletteChordFor({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: "P" }),
    ).toBe("legacy-open");
    // Ctrl+P stays untouched (Print).
    expect(
      paletteChordFor({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "p" }),
    ).toBeNull();
  });

  it("the registry's toolsPalette entry opens the palette", () => {
    const entry = toolById("toolsPalette");
    expect(entry?.action).toBe("openCommandPalette");
    expect(entry?.label).toBe("Browse all tools");
    expect(entry?.shortcut).toBe("Ctrl+Shift+P");
  });

  it("keeps the palette grouping data (the registry is the single inventory)", () => {
    expect(PALETTE_GROUPS).toHaveLength(4);
    expect(PALETTE_TOOL_IDS).toHaveLength(26);
  });

  it("toolsPaletteLayout has no writer anywhere in the renderer", () => {
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const prefs = readFileSync(
      resolve(__dirname, "../../../src/renderer/state/preferences.ts"),
      "utf8",
    );
    expect(stripComments(APP_SRC)).not.toContain("settings.toolsPaletteLayout");
    expect(stripComments(prefs)).not.toContain("set-tools-palette-layout");
    expect(stripComments(prefs)).not.toMatch(/state\.toolsPaletteLayout/);
  });
});
