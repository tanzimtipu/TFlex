// @vitest-environment jsdom
//
// Phase 105+ (TFL-854, chunk C1) — the shared panel primitives contract.
//
// Pins the exported primitive vocabulary (PanelShell / ScopedHeader /
// PanelSection / PropertyRow / ActionList / PanelEmptyState), the scoped
// `.tf-panel` token mapping in styles.css, and the one integration fact this
// chunk promises: BOTH existing panel shells (ContextPanel, Inspector) render
// their header through ScopedHeader at the preferred 52px height.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FileText } from "lucide-react";
import {
  ActionList,
  PanelEmptyState,
  PanelSection,
  PanelShell,
  PropertyRow,
  ScopedHeader,
} from "../../../src/renderer/components/panels/PanelPrimitives";
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

describe("panelPrimitives — the shared vocabulary", () => {
  it("PanelShell renders an opaque, named region with the class passthrough", () => {
    const { host, unmount } = mount(
      createElement(PanelShell, { label: "Test panel", className: "my-panel" }, "body"),
    );
    const shell = host.querySelector<HTMLElement>(".tf-panel-shell");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("role")).toBe("region");
    expect(shell?.getAttribute("aria-label")).toBe("Test panel");
    expect(shell?.classList.contains("tf-panel")).toBe(true);
    expect(shell?.classList.contains("my-panel")).toBe(true);
    expect(shell?.textContent).toBe("body");
    unmount();
  });

  it("ScopedHeader renders the title class and the preferred 52px hook", () => {
    const { host, unmount } = mount(
      createElement(ScopedHeader, {
        title: "Page setup",
        preferredHeight: true,
        actions: createElement("button", { type: "button" }, "Go"),
      }),
    );
    const header = host.querySelector<HTMLElement>(".tf-panel-header");
    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-tf-panel-header")).toBe("preferred");
    expect(header?.classList.contains("tf-panel-header-preferred")).toBe(true);
    expect(host.querySelector(".tf-panel-header-title")?.textContent).toBe("Page setup");
    expect(host.querySelector(".tf-panel-header-actions button")?.textContent).toBe("Go");
    expect(header?.classList.contains("glass-sidebar-header")).toBe(true);
    unmount();
  });

  it("ScopedHeader defaults to the legacy height hook when not preferred", () => {
    const { host, unmount } = mount(createElement(ScopedHeader, { title: "x" }));
    expect(host.querySelector(".tf-panel-header")?.getAttribute("data-tf-panel-header")).toBe(
      "default",
    );
    unmount();
  });

  it("ScopedHeader renders the optional leadingActions cluster BEFORE the title", () => {
    const { host, unmount } = mount(
      createElement(ScopedHeader, {
        title: "Inspector \u00b7 Page 1",
        leadingActions: createElement("button", { type: "button" }, "Lead"),
        actions: createElement("button", { type: "button" }, "Trail"),
      }),
    );
    const header = host.querySelector<HTMLElement>(".tf-panel-header");
    const leading = header?.querySelector(".tf-panel-header-leading-actions");
    expect(leading?.querySelector("button")?.textContent).toBe("Lead");
    const order = Array.from(header?.children ?? []).map((el) => el.className);
    expect(order[0]).toContain("tf-panel-header-leading-actions");
    expect(order[1]).toContain("tf-panel-header-title");
    expect(order[2]).toContain("tf-panel-header-actions");
    unmount();
  });

  it("ScopedHeader omits the leading cluster when the prop is not passed", () => {
    const { host, unmount } = mount(createElement(ScopedHeader, { title: "x" }));
    expect(host.querySelector(".tf-panel-header-leading-actions")).toBeNull();
    unmount();
  });

  it("PanelSection renders a heading and body slot", () => {
    const { host, unmount } = mount(
      createElement(PanelSection, { title: "Document" }, createElement("p", null, "inner")),
    );
    const section = host.querySelector<HTMLElement>(".tf-panel-section");
    expect(section).not.toBeNull();
    expect(section?.getAttribute("role")).toBeNull();
    const heading = host.querySelector(".tf-panel-section-title");
    expect(heading?.getAttribute("role")).toBe("heading");
    expect(heading?.getAttribute("aria-level")).toBe("2");
    expect(heading?.textContent).toBe("Document");
    expect(host.querySelector(".tf-panel-section-body p")?.textContent).toBe("inner");
    unmount();
  });

  it("PropertyRow renders the secondary label and value slot", () => {
    const { host, unmount } = mount(
      createElement(PropertyRow, { label: "Page size", value: "612 x 792 pt" }),
    );
    expect(host.querySelector(".tf-panel-row-label")?.textContent).toBe("Page size");
    expect(host.querySelector(".tf-panel-row-value")?.textContent).toBe("612 x 792 pt");
    unmount();
  });

  it("ActionList renders one labelled action per entry", () => {
    const { host, unmount } = mount(
      createElement(ActionList, {
        actions: [
          { id: "rotate", label: "Rotate" },
          { id: "delete", label: "Delete", onClick: (): void => undefined },
        ],
      }),
    );
    const items = host.querySelectorAll<HTMLButtonElement>("[data-tf-panel-action]");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Rotate");
    expect(items[0].disabled).toBe(true);
    expect(items[1].disabled).toBe(false);
    unmount();
  });

  it("PanelEmptyState renders the headline, help and icon mark", () => {
    const { host, unmount } = mount(
      createElement(PanelEmptyState, {
        icon: FileText,
        headline: "No selection",
        help: "Pick something to inspect",
      }),
    );
    expect(host.querySelector(".tf-panel-empty-headline")?.textContent).toBe("No selection");
    expect(host.querySelector(".tf-panel-empty-help")?.textContent).toBe("Pick something to inspect");
    expect(host.querySelector(".tf-panel-empty-mark")).not.toBeNull();
    unmount();
  });
});

describe("panelPrimitives — the scoped .tf-panel token mapping", () => {
  const css = readFileSync(resolve("src/renderer/styles.css"), "utf8");
  const scope = css.slice(css.indexOf(".tf-panel {"));

  it("maps the panels.tokens.json geometry under .tf-panel ONLY", () => {
    expect(scope).toContain("--tf-panel-padding: 16px;");
    expect(scope).toContain("--tf-panel-section-gap: 20px;");
    expect(scope).toContain("--tf-panel-header-height-preferred: 52px;");
    expect(scope).toContain("--tf-panel-field-radius: 9px;");
    // Phase 114 (TFL-1139 R26) — the panel title role now resolves the shared
    // Quiet Precision token (16px) instead of the retired literal.
    expect(scope).toContain("--tf-panel-heading-size: var(--type-panel-size);");
    expect(scope).toContain("--tf-panel-heading-weight: 500;");
    expect(scope).toContain("--tf-panel-secondary-label-size: 12px;");
    expect(scope).toContain("--tf-panel-boundary-width: 1px;");
    expect(scope).toContain("--motion-duration-panel");
  });

  it("honours reduced-motion and forced-colors inside the scope", () => {
    expect(scope).toContain("@media (prefers-reduced-motion: reduce)");
    expect(scope).toContain("@media (forced-colors: active)");
  });
});

describe("panelPrimitives — both panel shells adopt the 52px header", () => {
  it("ContextPanel's header carries the preferred hook", () => {
    stubObservers();
    const numPages = 1;
    const doc = {
      numPages,
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
      pageCount: numPages,
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
    const header = host.querySelector(".context-panel-header");
    expect(header?.getAttribute("data-tf-panel-header")).toBe("preferred");
    expect(header?.classList.contains("tf-panel-header-preferred")).toBe(true);
    unmount();
  });

  it("Inspector's header carries the preferred hook", () => {
    const { host, unmount } = mount(createElement(Inspector, { stage: "deliver" }));
    const header = host.querySelector(".inspector-header");
    expect(header?.getAttribute("data-tf-panel-header")).toBe("preferred");
    expect(header?.classList.contains("tf-panel-header-preferred")).toBe(true);
    unmount();
  });
});