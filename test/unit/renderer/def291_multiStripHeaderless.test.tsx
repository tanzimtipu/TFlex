// @vitest-environment jsdom
//
// DEF-291 — Multi Mode duplicated the file name per pane: the pane header
// (`[data-pane-header]`) AND the thumbnail strip's own header
// (`[data-pane-strip-header]`) both showed it, with a 30px strip header row
// pushing the thumbnails down so the strip was not flush with the page-view
// header. The operator asked to remove the strip's header in Multi Mode and
// make the thumbnail panel flush with the page-view header.
//
// Single mode keeps its rail header (`.rail-header`): the single rail has no
// pane header above it, so its own title row is the only naming surface.
//
// jsdom has no layout, so the FLUSH geometry is pinned structurally: the
// strip renders NO header row, its body is the strip's FIRST child, and the
// strip's grid declares a SINGLE row (the old `auto 1fr` header row would
// create the dead band again). The real pixel relationship is qa's e2e.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, type ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PaneThumbStrip } from "../../../src/renderer/components/PaneThumbStrip";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const STRIP_SOURCE = resolve(__dirname, "../../../src/renderer/components/PaneThumbStrip.tsx");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class NoopIO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIO;
  }
  if (g.ResizeObserver === undefined) {
    class NoopRO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopRO;
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

function renderStrip(): HTMLElement {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <PaneThumbStrip
        pane="B"
        tabId="doc-b"
        title="Beta.pdf"
        doc={makeDocStub(3)}
        pageCount={3}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={(): void => undefined}
        onFocusPane={(): void => undefined}
        documentCount={2}
        crossDoc={{ tabId: "doc-b", onDrop: (): void => undefined }}
      />,
    );
  });
  return host;
}

const NOOP = (): void => undefined;
const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
];

describe("DEF-291 — the Multi Mode strip is headerless", () => {
  const source = readFileSync(STRIP_SOURCE, "utf8");

  it("renders no [data-pane-strip-header] and the body is the strip's first child", () => {
    const host = renderStrip();
    try {
      const strip = host.querySelector("[data-pane-strip]");
      expect(strip).not.toBeNull();
      expect(host.querySelector("[data-pane-strip-header]")).toBeNull();
      const body = host.querySelector("[data-pane-strip-body]");
      expect(body).not.toBeNull();
      expect(strip?.firstElementChild).toBe(body);
    } finally {
      host.remove();
    }
  });

  it("the strip source still carries no header markup (revert fails)", () => {
    expect(source).not.toMatch(/data-pane-strip-header/);
    expect(source).not.toMatch(/pane-thumb-strip-header/);
  });

  it("the strip grid has ONE row (the old auto header row is gone)", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const body = findRuleBody(css, ".pane-thumb-strip {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/grid-template-rows:\s*1fr\s*;/);
    expect(body ?? "").not.toMatch(/grid-template-rows:\s*auto\s+1fr/);
    // No CSS rule defines the removed header class any more.
    expect(css).not.toMatch(/\.pane-thumb-strip-header\s*\{/);
  });

  it("the pane header is rendered BEFORE the pane document (flush top abutment)", () => {
    const stage = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/MultiPane.tsx"),
      "utf8",
    );
    const headerIdx = stage.indexOf("<MultiPaneHeader");
    const docIdx = stage.indexOf("{renderDocument(tab.id, pane)}");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(headerIdx);
  });
});

describe("DEF-291 — single mode keeps its rail header", () => {
  it("the stage in single mode still renders the rail node it is given", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <DocumentStage
          tabs={TABS}
          activeId="a"
          showWelcome={false}
          welcomeKey="welcome"
          welcome={null}
          multiMode={{ enabled: false, paneA: null, paneB: null, focused: "A" }}
          splitFraction={0.5}
          onSplitChange={NOOP}
          onFocusPane={NOOP}
          onClearPane={NOOP}
          onPickPane={NOOP}
          onOpenIntoPane={NOOP}
          renderDocument={(): ReactElement => (
            <div className="workspace">
              <div className="side-rail">
                <header className="glass-sidebar-header rail-header" data-testid="rail-header" />
              </div>
            </div>
          )}
        />,
      );
    });
    try {
      expect(host.querySelector(".rail-header")).not.toBeNull();
      expect(host.querySelector("[data-multi-mode]")?.getAttribute("data-multi-mode")).toBe("false");
    } finally {
      act((): void => root.unmount());
      host.remove();
    }
  });
});