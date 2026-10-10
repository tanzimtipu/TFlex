// @vitest-environment jsdom
// TFL-1652 — the Chrome-style FLOATING-PILL tab strip (pixel spec).
//
// A re-do of the Phase 123 chrome look. jsdom does not apply styles.css, so
// the render seams are asserted through DocumentRail and the sheet text is
// read directly (the same readFileSync pattern as the Phase 68 oracle). The
// style is scoped under `[data-tab-style="chrome"]`; it must never touch the
// 'standard' / 'colorful' looks.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";
import type { TabStyle } from "../../../src/shared/types";

interface TabSpec {
  id: string;
  title: string;
  modified: boolean;
}

function renderHeader(
  tabStyle: TabStyle,
  tabs: TabSpec[] = [],
  activeId: string | null = null,
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <DocumentRail
        activeId={activeId}
        tabs={tabs}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        tabStyle={tabStyle}
      />,
    );
  });
  return container;
}

// vitest runs from the repo root; read the sheet by path (import.meta.url is
// an http URL under the jsdom environment).
const SHEET = readFileSync("src/renderer/styles.css", "utf8");
const CHROME_END = "/* === Phase 123 chrome block end === */";

/** The whole `[data-tab-style="chrome"]` scoped block, up to its end marker. */
function chromeBlock(): string {
  const start = SHEET.indexOf('.tab-area[data-tab-style="chrome"]');
  expect(start, "the chrome block exists").toBeGreaterThan(-1);
  const end = SHEET.indexOf(CHROME_END, start);
  expect(end, "the chrome block has an end marker").toBeGreaterThan(-1);
  return SHEET.slice(start, end);
}

/** Slice a selector's declaration block out of the sheet. */
function blockFor(selector: string): string {
  const at = SHEET.indexOf(selector);
  expect(at, `selector ${selector} exists`).toBeGreaterThan(-1);
  return SHEET.slice(at, SHEET.indexOf("}", at));
}

describe("DocumentRail — TFL-1652 chrome render seam", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders .tab-area[data-tab-style='chrome'] with one .tab[role=tab] per tab", () => {
    const host = renderHeader(
      "chrome",
      [
        { id: "a", title: "Alpha.pdf", modified: false },
        { id: "b", title: "Beta.pdf", modified: true },
      ],
      "a",
    );
    const area = host.querySelector(".tab-area");
    expect(area?.getAttribute("data-tab-style")).toBe("chrome");
    expect(host.querySelectorAll('.tab[role="tab"]')).toHaveLength(2);
  });

  it("renders exactly one active tab ([aria-selected='true'])", () => {
    const host = renderHeader(
      "chrome",
      [
        { id: "a", title: "Alpha.pdf", modified: false },
        { id: "b", title: "Beta.pdf", modified: true },
        { id: "c", title: "Gamma.pdf", modified: false },
      ],
      "b",
    );
    const active = host.querySelectorAll('.tab[aria-selected="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("data-tab-id")).toBe("b");
  });

  it("gives the rail host a data-tab-style hook so it can float the 56px row", () => {
    const host = renderHeader("chrome", [{ id: "a", title: "A.pdf", modified: false }], "a");
    const rail = host.querySelector("[data-document-rail]");
    expect(rail?.getAttribute("data-tab-style")).toBe("chrome");
  });

  it("renders a 16px favicon slot on every pill", () => {
    const host = renderHeader(
      "chrome",
      [
        { id: "a", title: "Alpha.pdf", modified: false },
        { id: "b", title: "Beta.pdf", modified: false },
      ],
      "a",
    );
    for (const tab of host.querySelectorAll("[data-tab-id]")) {
      expect(tab.querySelector(".tab-favicon")).not.toBeNull();
    }
  });

  it("closes a pill on middle-click", () => {
    const closed: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <DocumentRail
          activeId="a"
          tabs={[
            { id: "a", title: "Alpha.pdf", modified: false },
            { id: "b", title: "Beta.pdf", modified: false },
          ]}
          onActivate={(): void => undefined}
          onClose={(id): void => {
            closed.push(id);
          }}
          onNewEmptyTab={(): void => undefined}
          tabStyle="chrome"
        />,
      );
    });
    const tab = container.querySelector<HTMLElement>("[data-tab-id='b']");
    act((): void => {
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 1 }));
    });
    expect(closed).toEqual(["b"]);
  });
});

describe("TFL-1652 — chrome floating-pill stylesheet", () => {
  it("exposes the active pill fill as the --tab-active-pill-bg token", () => {
    expect(SHEET).toMatch(/--tab-active-pill-bg:\s*#1a4974/i);
  });

  it("floats a 42px pill with a 12px radius on all four corners", () => {
    const block = blockFor('.tab-area[data-tab-style="chrome"] .tab {');
    expect(block).toMatch(/height:\s*42px/);
    // The 12px radius rides the `--radius-group` token (which resolves to 12px).
    expect(block).toContain("border-radius: var(--radius-group)");
    expect(SHEET).toMatch(/--radius-group:\s*12px/);
    // A rounded rectangle, never a trapezoid / merged tab.
    expect(block).not.toContain("border-top-left-radius");
    expect(block).not.toContain("border-bottom-left-radius: 0");
    expect(block).not.toContain("border-bottom-right-radius: 0");
  });

  it("gives the pill slot the 120px floor / 360px ceiling flex band", () => {
    const block = blockFor(
      '.tab-area[data-tab-style="chrome"] .tab-list > li[data-animated-tab] {',
    );
    expect(block).toMatch(/flex:\s*1 1 0/);
    expect(block).toMatch(/min-width:\s*120px/);
    expect(block).toMatch(/max-width:\s*360px/);
  });

  it("centres the pill inside a 56px row (7px above + 42px + 7px below)", () => {
    const block = blockFor('.document-rail[data-tab-style="chrome"] {');
    expect(block).toMatch(/height:\s*56px/);
    expect(block).toContain("var(--tab-strip-bg)");
    expect(SHEET).toMatch(/--tab-strip-bg:\s*#1f2020/i);
  });

  it("paints the three states: transparent inactive, #3C3C3C hover, steel-blue active", () => {
    const palette = blockFor('.tab-area[data-tab-style="chrome"] {');
    expect(palette).toMatch(/--tab-pill-hover-bg:\s*#3c3c3c/i);
    expect(palette).toMatch(/--tab-pill-inactive-ink:\s*#b9bbbe/i);
    expect(palette).toMatch(/--tab-pill-active-ink:\s*#ffffff/i);
    const rest = blockFor('.tab-area[data-tab-style="chrome"] .tab {');
    expect(rest).toMatch(/background:\s*transparent/);
    const hover = blockFor('.tab-area[data-tab-style="chrome"] .tab:not(.tab-active):hover {');
    expect(hover).toContain("var(--tab-pill-hover-bg)");
    const active = blockFor('.tab-area[data-tab-style="chrome"] .tab.tab-active,');
    expect(active).toContain("var(--tab-active-pill-bg)");
  });

  it("keeps the close control persistently visible on every pill", () => {
    const close = blockFor('.tab-area[data-tab-style="chrome"] .tab-close {');
    expect(close).toMatch(/opacity:\s*1/);
    expect(close).toMatch(/width:\s*16px/);
    expect(close).toMatch(/height:\s*16px/);
    // No inactive opacity:0 rule may survive in the block.
    const block = chromeBlock();
    expect(block).not.toContain(".tab-close {\n  margin-left: auto;\n  opacity: 0");
  });

  it("draws a #494A4A full-height separator between adjacent pills", () => {
    const palette = blockFor('.tab-area[data-tab-style="chrome"] {');
    expect(palette).toMatch(/--tab-pill-separator:\s*#494a4a/i);
    const sep = blockFor(
      '.tab-area[data-tab-style="chrome"] .tab-list > li[data-animated-tab] + li[data-animated-tab]::before {',
    );
    expect(sep).toContain("var(--tab-pill-separator)");
    expect(sep).toMatch(/top:\s*0/);
    expect(sep).toMatch(/bottom:\s*0/);
  });

  it("never touches the 'standard' / 'colorful' looks", () => {
    const block = chromeBlock();
    expect(block).not.toContain('data-tab-style="colorful"');
    expect(block).not.toContain('data-tab-style="standard"');
  });
});
