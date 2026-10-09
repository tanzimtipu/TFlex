// @vitest-environment jsdom
//
// TFL-1585 — the Pages-panel page preview card (card mode):
//   1. the border/frame rotates WITH the page, so a rotated page never spills
//      outside its border or outside the card;
//   2. the three per-page controls render transparent and horizontally
//      centered inside the preview bounds.
//
// The rotation transform lives on `.thumb-canvas-wrap`, which ALSO owns the
// 1px border. In card mode a `.thumb-frame` sizes the layout box to the ROTATED
// footprint (width/height swap at 90/270) so the fit-content card hugs the page.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRule(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") {
      let depth = 0;
      let end = cursor;
      for (; end < stripped.length; end += 1) {
        if (stripped[end] === "{") depth += 1;
        else if (stripped[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      return stripped.slice(cursor + 1, end);
    }
    from = idx + selector.length;
  }
}

// Inject ONLY the rules this test cares about from the real stylesheet, so
// jsdom's getComputedStyle can resolve them (jsdom does not load styles.css).
function injectThumbRules(): void {
  const selectors = [
    ".thumb-canvas-wrap",
    ".thumb-frame",
    ".thumb-rot-90 .thumb-canvas-wrap",
    ".thumb-rot-180 .thumb-canvas-wrap",
    ".thumb-rot-270 .thumb-canvas-wrap",
    ".thumb-overlay",
  ];
  const css = selectors
    .map((sel) => {
      const body = extractRule(STYLES, sel);
      if (body === null) return "";
      // jsdom cannot resolve CSS custom properties; substitute a literal so the
      // shorthand declarations it needs to compute (border) still parse.
      return `${sel} {${body.replace(/var\([^)]*\)/g, "#000")}}`;
    })
    .join("\n");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

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

function makeEngineState(rotations: number[]): EngineState {
  return {
    pageCount: rotations.length,
    pageOrder: Array.from({ length: rotations.length }, (_, i) => i),
    rotations: [...rotations] as EngineState["rotations"],
    deleted: rotations.map(() => false),
    modified: false,
    annotations: [],
  };
}

interface Rendered {
  host: HTMLElement;
  unmount: () => void;
}

function renderPanel(rotations: number[]): Rendered {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <ContextPanel
        stage="pages"
        doc={makeDocStub(rotations.length)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(rotations)}
        canUndo={false}
        onJump={(): void => undefined}
        outline={null}
        pageSelection={null}
        onPageSelectionChange={null}
      />,
    );
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

function cardFor(host: HTMLElement, page: number): HTMLElement {
  const el = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
  if (el === null) throw new Error(`no thumb for page ${page}`);
  return el;
}

beforeEach((): void => {
  injectThumbRules();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((): CanvasRenderingContext2D =>
      ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D),
  );
});

afterEach((): void => {
  document.querySelectorAll("head style").forEach((s) => s.remove());
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("TFL-1585 — the preview border rotates with the page", () => {
  it("the rotation class and transform live on .thumb-canvas-wrap (the border owner)", () => {
    const { host, unmount } = renderPanel([0, 1, 2, 3]);
    try {
      const expected: Array<[number, string]> = [
        [1, "none"],
        [2, "rotate(90deg)"],
        [3, "rotate(180deg)"],
        [4, "rotate(270deg)"],
      ];
      for (const [page, kind] of expected) {
        const card = cardFor(host, page);
        const wrap = card.querySelector<HTMLElement>(".thumb-canvas-wrap");
        expect(wrap).not.toBeNull();
        const rot = getComputedStyle(wrap as HTMLElement).transform;
        if (kind === "none") {
          expect(card.classList.contains("thumb-rot-90")).toBe(false);
          expect(rot === "none" || rot === "").toBe(true);
        } else {
          expect(rot).toBe(kind);
        }
      }
      // rotation 1 (90deg) carries the exact class and rule.
      expect(cardFor(host, 2).classList.contains("thumb-rot-90")).toBe(true);
      expect(cardFor(host, 3).classList.contains("thumb-rot-180")).toBe(true);
      expect(cardFor(host, 4).classList.contains("thumb-rot-270")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("keeps the 1px border on the SAME element that is rotated", () => {
    const { host, unmount } = renderPanel([0, 1, 2, 3]);
    try {
      for (const page of [1, 2, 3, 4]) {
        const wrap = cardFor(host, page).querySelector<HTMLElement>(".thumb-canvas-wrap");
        const cs = getComputedStyle(wrap as HTMLElement);
        expect(cs.borderTopWidth).toBe("1px");
        expect(cs.borderTopStyle).toBe("solid");
      }
    } finally {
      unmount();
    }
  });

  it("sizes the card-mode .thumb-frame to the ROTATED footprint, wrap stays un-rotated", () => {
    const { host, unmount } = renderPanel([0, 1, 2, 3]);
    try {
      for (const [page, quarter] of [
        [1, false],
        [2, true],
        [3, false],
        [4, true],
      ] as Array<[number, boolean]>) {
        const card = cardFor(host, page);
        const wrap = card.querySelector<HTMLElement>(".thumb-canvas-wrap");
        const frame = card.querySelector<HTMLElement>(".thumb-frame");
        expect(frame).not.toBeNull();
        const wrapW = Number.parseFloat((wrap as HTMLElement).style.width);
        const wrapH = Number.parseFloat((wrap as HTMLElement).style.height);
        const frameW = Number.parseFloat((frame as HTMLElement).style.width);
        const frameH = Number.parseFloat((frame as HTMLElement).style.height);
        expect(frameW).toBe(quarter ? wrapH : wrapW);
        expect(frameH).toBe(quarter ? wrapW : wrapH);
      }
    } finally {
      unmount();
    }
  });
});

describe("TFL-1585 — transparent, centered overlay controls", () => {
  it("the overlay has no opaque background, no backdrop blur and no border", () => {
    const { host, unmount } = renderPanel([0]);
    try {
      const overlay = cardFor(host, 1).querySelector<HTMLElement>(".thumb-overlay");
      expect(overlay).not.toBeNull();
      const cs = getComputedStyle(overlay as HTMLElement);
      expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(cs.backdropFilter === "none" || cs.backdropFilter === "").toBe(true);
      expect(cs.borderTopStyle).toBe("none");
    } finally {
      unmount();
    }
  });

  it("the CSS centers the row and gives the label a contrast shadow", () => {
    const overlay = extractRule(STYLES, ".thumb-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay ?? "").toMatch(/background:\s*transparent/);
    expect(overlay ?? "").toMatch(/backdrop-filter:\s*none/);
    expect(overlay ?? "").toMatch(/border:\s*none/);
    expect(overlay ?? "").toMatch(/left:\s*50%/);
    expect(overlay ?? "").toMatch(/translateX\(-50%\)/);
    expect(overlay ?? "").toMatch(/justify-content:\s*center/);
    expect(overlay ?? "").not.toMatch(/left:\s*6px/);

    const label = extractRule(STYLES, ".thumb-overlay .thumb-label");
    expect(label).not.toBeNull();
    expect(label ?? "").toMatch(/--fg-strong/);
    expect(label ?? "").toMatch(/text-shadow/);
  });
});
