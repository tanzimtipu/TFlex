// @vitest-environment jsdom
//
// TFL-1116 C13 (R23) — the OUTLINE target page badges are legible.
//
// The badges were `--fg-faint` at `--fs-xs`, which read as disabled/placeholder
// ink and were barely visible against the panel. R23 makes them readable
// SECONDARY text, keeps the fixed right-aligned 32px target column, and must
// not disturb the title's two-line wrap/ellipsis or the tree's keyboard model.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ok } from "../../../src/shared/result";
import type { OutlineEntry } from "../../../src/renderer/state/outlineEditor";
import { OutlinePanel } from "../../../src/renderer/components/SideRail";
import type { OutlineEditorConfig } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");

/** The single `.outline-page` declaration block, comments stripped so the
 *  assertions read only the real declarations. */
const OUTLINE_PAGE_BLOCK = ((): string => {
  const match = /\.outline-page\s*\{([^}]*)\}/.exec(STYLES);
  if (match === null) throw new Error("no .outline-page rule found");
  return match[1].replace(/\/\*[\s\S]*?\*\//g, " ");
})();

function makeEngineState(pageCount = 10): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: true,
    annotations: [],
  };
}

function makeDocStub(): PDFDocumentProxy {
  return {
    numPages: 10,
    async getPage(n: number): Promise<unknown> {
      return { pageNumber: n };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

// Long titles so the wrap path is exercised (the R23 finding fixture).
const LONG_SEED: OutlineEntry[] = [
  { title: "Chapter 1: The Art of Orchestration", page: 2, children: [] },
  { title: "Chapter 2: The Art of Orchestration", page: 4, children: [{ title: "Section", page: 6, children: [] }] },
  { title: "Appendix: no destination", page: null, children: [] },
];

function renderLong(): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const config: OutlineEditorConfig = {
    docId: "doc-1",
    entries: LONG_SEED,
    visiblePageCount: 10,
    commit: vi.fn(async () => ok(makeEngineState())),
  };
  act((): void => {
    root.render(
      <OutlinePanel doc={makeDocStub()} outline={[]} onJump={(): void => undefined} editor={config} />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

afterEach((): void => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TFL-1116 C13 (R23) — outline target badge legibility", () => {
  it("uses readable secondary ink, not the faint disabled tier", () => {
    expect(OUTLINE_PAGE_BLOCK).toMatch(/color:\s*var\(--fg-muted\)/);
    expect(OUTLINE_PAGE_BLOCK).not.toMatch(/--fg-faint/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(OUTLINE_PAGE_BLOCK).not.toMatch(/--fs-xs/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/font-weight:\s*500/);
  });

  it("keeps the fixed right-aligned target column aligned", () => {
    expect(OUTLINE_PAGE_BLOCK).toMatch(/flex:\s*0 0 32px/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/width:\s*32px/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/text-align:\s*right/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/align-self:\s*center/);
    expect(OUTLINE_PAGE_BLOCK).toMatch(/tabular-nums/);
  });

  it("renders a readable badge per row, still labelled for assistive tech", () => {
    const h = renderLong();
    try {
      const badges = [...h.host.querySelectorAll<HTMLElement>("[data-outline-page]")];
      expect(badges.map((b) => b.textContent)).toEqual(["2", "4", "6", "\u2013"]);
      for (const b of badges) {
        expect(b.classList.contains("outline-page")).toBe(true);
        expect(b.getAttribute("title")).toBeTruthy();
        expect(b.getAttribute("aria-label")).toBeTruthy();
      }
      expect(h.host.querySelector("[data-outline-page]")?.getAttribute("title")).toBe("Page 2");
    } finally {
      h.unmount();
    }
  });

  it("preserves the two-line wrap/ellipsis behaviour of the title control", () => {
    expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*-webkit-line-clamp:\s*2/);
    expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*min-width:\s*0/);
    expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*white-space:\s*normal/);
    expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*overflow:\s*hidden/);
    const h = renderLong();
    try {
      const title = h.host.querySelector<HTMLElement>(".outline-link");
      expect(title?.textContent).toBe("Chapter 1: The Art of Orchestration");
      expect(title?.getAttribute("title")).toBe("Chapter 1: The Art of Orchestration");
    } finally {
      h.unmount();
    }
  });

  it("preserves the tree keyboard model (roles, levels, focusable controls)", () => {
    const h = renderLong();
    try {
      expect(h.host.querySelector('[role="tree"]')).not.toBeNull();
      const items = [...h.host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
      expect(items).toHaveLength(4);
      for (const item of items) {
        expect(item.getAttribute("aria-level")).not.toBeNull();
        expect(item.querySelector("button.outline-link")).not.toBeNull();
      }
      // Parent rows keep their disclosure control.
      const parent = items.find((i) => i.textContent?.includes("Chapter 2"));
      expect(parent?.querySelector("button.outline-toggle")?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      h.unmount();
    }
  });
});