// @vitest-environment jsdom
//
// TFL-1155 (TFL-1116 C9 / R11) — the shared panel shell.
//
// R11: panel scroll ownership was inconsistent (the Navigator body ran to the
// column bottom, the Inspector body had different bounds, native arrowed
// scrollbars looked dated). The correction is ONE shell used by every panel:
// a FIXED header, a `min-height: 0` scroll BODY and an optional FIXED footer,
// with every body stopping at the shared workspace baseline above the canvas
// footer. This spec pins the shell structure, the baseline token wiring and
// that both docked panels (Inspector, Navigator) adopt the shared body.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PanelShell, ScopedHeader } from "../../../src/renderer/components/panels/PanelPrimitives";
import { Inspector } from "../../../src/renderer/components/Inspector";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

function mount(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
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

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    g.IntersectionObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (g.ResizeObserver === undefined) {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

const CSS = readFileSync(resolve("src/renderer/styles.css"), "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function block(css: string, selector: RegExp): string {
  const start = css.search(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("panelShell — the shared structure", () => {
  it("renders an optional fixed footer only when one is provided", () => {
    const withFooter = mount(
      createElement(
        PanelShell,
        { label: "T", footer: createElement("span", null, "F") },
        createElement("div", { className: "tf-panel-body" }, "B"),
      ),
    );
    expect(withFooter.host.querySelector(".tf-panel-shell")).not.toBeNull();
    expect(withFooter.host.querySelector(".tf-panel-footer")?.textContent).toBe("F");
    withFooter.unmount();

    const withoutFooter = mount(
      createElement(PanelShell, { label: "T" }, createElement("div", { className: "tf-panel-body" })),
    );
    expect(withoutFooter.host.querySelector(".tf-panel-footer")).toBeNull();
    withoutFooter.unmount();
  });

  it("a fixed header, a min-height:0 body and a fixed footer are the shell geometry", () => {
    const shell = block(CSS_NO_COMMENTS, /(?:^|\n)\.tf-panel-shell\s*\{/);
    expect(shell).toMatch(/display:\s*flex/);
    expect(shell).toMatch(/flex-direction:\s*column/);
    const body = block(CSS_NO_COMMENTS, /\.tf-panel-body\s*\{/);
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overflow-x:\s*hidden/);
    const fixed = block(CSS_NO_COMMENTS, /\.tf-panel-shell > \.tf-panel-header\s*,/);
    expect(fixed).toMatch(/flex:\s*0 0 auto/);
  });

  it("the body bottom is the shared workspace baseline token", () => {
    const body = block(CSS_NO_COMMENTS, /\.tf-panel-body\s*\{/);
    expect(body).toMatch(/margin-bottom:\s*var\(--tf-workspace-baseline/);
    const appMain = block(CSS_NO_COMMENTS, /\.app-main\s*\{/);
    expect(appMain).toMatch(/--tf-workspace-baseline:\s*48px/);
    const main = block(CSS_NO_COMMENTS, /\.workspace-main\s*\{/);
    expect(main).toMatch(/--view-strip-h:\s*var\(--tf-workspace-baseline/);
  });
});

describe("panelShell — both docked panels adopt the shared body", () => {
  it("Inspector body is the shared scroll body", () => {
    const { host, unmount } = mount(createElement(Inspector, { stage: "deliver" }));
    const body = host.querySelector(".inspector-body");
    expect(body).not.toBeNull();
    expect(body?.classList.contains("tf-panel-body")).toBe(true);
    expect(body?.classList.contains("tf-panel-scroll")).toBe(true);
    unmount();
  });

  it("Navigator body is the shared scroll body", () => {
    stubObservers();
    const doc = {
      numPages: 1,
      getPage: (): Promise<unknown> =>
        Promise.resolve({
          pageNumber: 1,
          view: [0, 0, 612, 792],
          getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
          render: (): { promise: Promise<void>; cancel: () => void } => ({
            promise: Promise.resolve(),
            cancel: (): void => undefined,
          }),
          cleanup: async (): Promise<void> => undefined,
        }),
      destroy: async (): Promise<void> => undefined,
    } as unknown as PDFDocumentProxy;
    const engineState: EngineState = {
      pageCount: 1,
      pageOrder: [0],
      rotations: [0] as EngineState["rotations"],
      deleted: [false],
      modified: false,
      annotations: [],
    };
    const { host, unmount } = mount(
      createElement(ContextPanel, {
        doc,
        currentPage: 1,
        defaultWidthPt: 612,
        defaultHeightPt: 792,
        engineState,
        canUndo: false,
        onJump: (): void => undefined,
        outline: null,
      }),
    );
    const body = host.querySelector(".context-panel-body");
    expect(body).not.toBeNull();
    expect(body?.classList.contains("tf-panel-body")).toBe(true);
    expect(body?.classList.contains("tf-panel-scroll")).toBe(true);
    unmount();
  });

  it("ScopedHeader stays the fixed header slot inside the shell", () => {
    const { host, unmount } = mount(
      createElement(
        PanelShell,
        { label: "T" },
        createElement(ScopedHeader, { title: "Page setup", preferredHeight: true }),
        createElement("div", { className: "tf-panel-body" }),
      ),
    );
    const header = host.querySelector(".tf-panel-shell > .glass-sidebar-header");
    expect(header).not.toBeNull();
    expect(header?.classList.contains("tf-panel-header")).toBe(true);
    unmount();
  });
});
