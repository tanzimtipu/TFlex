// @vitest-environment jsdom
// Phase 123 (chunk B) — the Chrome tab style. jsdom does not apply
// styles.css, so the render seams are asserted through DocumentRail and the
// sheet text is read directly (the same readFileSync pattern as the Phase 68
// oracle). The style is scoped under `[data-tab-style="chrome"]`; it must
// never touch the 'standard' / 'colorful' looks.
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

describe("DocumentRail — Phase 123 chrome render seam", () => {
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
});

describe("Phase 123 — chrome tab stylesheet", () => {
  it("carries an inactive-only hover rule selectored on :not(.tab-active)", () => {
    const block = blockFor(
      '.tab-area[data-tab-style="chrome"] .tab:not(.tab-active):hover::before {',
    );
    expect(block).toContain("background: color-mix(");
    expect(block).toContain("var(--bg-raised)");
  });

  it("reveals the close control on the active tab and on inactive hover", () => {
    expect(SHEET).toContain(
      '.tab-area[data-tab-style="chrome"] .tab-active .tab-close,',
    );
    expect(SHEET).toContain(
      '.tab-area[data-tab-style="chrome"] .tab:not(.tab-active):hover .tab-close {',
    );
    const rest = blockFor('.tab-area[data-tab-style="chrome"] .tab-close {');
    expect(rest).toContain("opacity: 0");
  });

  it("never lightens the active tab on hover", () => {
    const block = chromeBlock();
    expect(block).not.toContain(".tab-active:hover");
    // It neutralises the shared `.tab:hover` brightness filter instead.
    expect(block).toContain("filter: none");
  });

  it("connects the active tab: raised surface, square foot, no underline", () => {
    const surface = blockFor(
      '.tab-area[data-tab-style="chrome"] .tab-active::before {',
    );
    expect(surface).toContain("background: var(--bg-raised)");
    expect(surface).toContain("border-bottom-left-radius: 0");
    expect(surface).toContain("border-bottom-right-radius: 0");
    const underline = blockFor(
      '.tab-area[data-tab-style="chrome"] .tab-active::after {',
    );
    expect(underline).toContain("content: none");
  });
});
