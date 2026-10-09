// @vitest-environment jsdom
//
// Phase 111 (chunk D2b) — the navigator's accessibility / scaling polish.
//
// Pins two shipped rules from the design decisions:
//   (a) the Pages selection summary announces its COUNT through a
//       visually-hidden role=status / aria-live=polite region (and never on
//       scroll — the region only exists while a real selection does);
//   (b) the navigator's primary controls keep a 44px coarse-pointer target and
//       the fixed navigator heights became `min-height`, so text can grow at
//       200% UI scaling instead of clipping.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

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

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function mountContextPanel(props: Partial<Parameters<typeof ContextPanel>[0]> = {}): {
  host: HTMLElement;
  rerender: (next: Partial<Parameters<typeof ContextPanel>[0]>) => void;
  unmount: () => void;
} {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const draw = (next: Partial<Parameters<typeof ContextPanel>[0]>): void => {
    const pageCount = next.engineState?.pageCount ?? 3;
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
          {...next}
        />,
      );
    });
  };

  draw(props);
  return {
    host,
    rerender: (next): void => draw(next),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractBlockAt(src: string, startIdx: number): string | null {
  const braceOpen = src.indexOf("{", startIdx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return null;
}

/** Every top-level block whose at-rule text starts with `marker`. */
function mediaBlocks(src: string, marker: string): string[] {
  const stripped = stripCssComments(src);
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(marker, from);
    if (idx === -1) break;
    const body = extractBlockAt(stripped, idx);
    if (body !== null) blocks.push(body);
    from = idx + marker.length;
  }
  return blocks;
}

function findRuleBody(src: string, selector: string): string | null {
  let from = 0;
  for (;;) {
    const idx = src.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") return extractBlockAt(src, idx);
    from = idx + selector.length;
  }
}

/** The declaration map for a rule body, so `min-height` never reads as `height`. */
function declarationsOf(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of body.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (prop) map.set(prop, value);
  }
  return map;
}

beforeEach((): void => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((): CanvasRenderingContext2D => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D),
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("Phase 111 D2b — selection-count live announcement", () => {
  it("announces the count through a visually-hidden polite status region", () => {
    const { host, rerender, unmount } = mountContextPanel({ pageSelection: [1, 2] });
    try {
      const live = host.querySelector("[data-context-panel-selection-live]");
      expect(live).not.toBeNull();
      expect(live?.getAttribute("role")).toBe("status");
      expect(live?.getAttribute("aria-live")).toBe("polite");
      expect(live?.classList.contains("visually-hidden")).toBe(true);
      expect(live?.textContent).toBe("2 selected");

      rerender({ pageSelection: [1, 2, 3] });
      expect(host.querySelector("[data-context-panel-selection-live]")?.textContent).toBe(
        "3 selected",
      );
    } finally {
      unmount();
    }
  });

  it("keeps the visible count unchanged beside the live region", () => {
    const { host, unmount } = mountContextPanel({ pageSelection: [1, 2] });
    try {
      expect(host.querySelector("[data-context-panel-selection-count]")?.textContent).toContain(
        "2 selected",
      );
    } finally {
      unmount();
    }
  });

  it("carries no live region when nothing is selected (never announces scroll)", () => {
    const { host, unmount } = mountContextPanel({ pageSelection: [] });
    try {
      expect(host.querySelector("[data-context-panel-selection]")).toBeNull();
      expect(host.querySelector("[data-context-panel-selection-live]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("announces in the split Pages section too", () => {
    const { host, unmount } = mountContextPanel({
      pageSelection: [1, 2],
      outline: [],
      navigatorLayout: "split",
      navigatorSplitRatio: 0.6,
    });
    try {
      const pages = host.querySelector('[data-context-panel-view="pages"]');
      const live = pages?.querySelector("[data-context-panel-selection-live]");
      expect(live).not.toBeNull();
      expect(live?.getAttribute("role")).toBe("status");
      expect(live?.textContent).toBe("2 selected");
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 D2b — navigator coarse targets and 200% scaling", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("gives the header tool icons a 44px min-height on coarse pointers", () => {
    const coarse = mediaBlocks(src, "@media (pointer: coarse)").join("\n");
    const body = findRuleBody(coarse, ".context-panel-layout");
    expect(body).not.toBeNull();
    expect(declarationsOf(body ?? "").get("min-height")).toBe("44px");
  });

  it(".context-panel-view-tabs grows via min-height, not a fixed height", () => {
    const body = findRuleBody(stripCssComments(src), ".context-panel-view-tabs");
    expect(body).not.toBeNull();
    const decls = declarationsOf(body ?? "");
    expect(decls.get("min-height")).toBe("40px");
    expect(decls.has("height")).toBe(false);
  });

  it(".context-panel-split-title grows via min-height, not a fixed height", () => {
    const body = findRuleBody(stripCssComments(src), ".context-panel-split-title");
    expect(body).not.toBeNull();
    const decls = declarationsOf(body ?? "");
    expect(decls.get("min-height")).toBe("28px");
    expect(decls.has("height")).toBe(false);
  });

  it("keeps the reduced-motion guards for the outline body and the split divider", () => {
    const guards = mediaBlocks(src, "@media (prefers-reduced-motion").join("\n");
    expect(guards).toContain(".context-panel-outline-body");
    expect(guards).toContain(".context-panel-split-divider");
  });
});
