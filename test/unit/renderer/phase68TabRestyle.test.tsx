// @vitest-environment jsdom
// Phase 68 — colorful tab calm-down: the tab body becomes a soft flat theme
// surface tint (no gradient), labels move to --fg-strong, the colour chip stays
// a full-strength accent mark, and every colorful tab gets one uniform 180px
// width. jsdom does not apply styles.css, so the render seams and the sheet
// text are asserted directly (the same readFileSync pattern as the Phase 62
// oracle).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
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
      <AppHeader
        activeId={activeId}
        tabs={tabs}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        theme="frosted"
        onThemeChange={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        onOpenPreferences={(): void => undefined}
        tabStyle={tabStyle}
      />,
    );
  });
  return container;
}

// vitest runs from the repo root; read the sheet by path (import.meta.url is
// an http URL under the jsdom environment).
const SHEET = readFileSync("src/renderer/styles.css", "utf8");

/** Slice a selector's declaration block out of the sheet. */
function blockFor(selector: string): string {
  const at = SHEET.indexOf(selector);
  expect(at, `selector ${selector} exists`).toBeGreaterThan(-1);
  return SHEET.slice(at, SHEET.indexOf("}", at));
}

describe("AppHeader — Phase 68 colorful render seam", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("colorful still renders tabs with the colorful tab-style marker", () => {
    const host = renderHeader(
      "colorful",
      [
        { id: "a", title: "Alpha.pdf", modified: false },
        { id: "b", title: "Beta.pdf", modified: true },
      ],
      "a",
    );
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
    expect(host.querySelector(".tab-area")?.getAttribute("data-tab-style")).toBe("colorful");
  });
});

describe("Phase 68 — colorful tab stylesheet", () => {
  it("Phase 72 — the colorful .tab::before is a flat 22% tint with the 1px border and no gradient", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab::before {');
    expect(block).toContain("color-mix(");
    expect(block).toContain("22%");
    expect(block).toContain("var(--bg-elevated)");
    expect(block).not.toContain("linear-gradient");
    expect(block).toContain(
      "border: 1px solid color-mix(in srgb, var(--tf-tab-accent, var(--sem-neutral)) 30%, var(--border-subtle))",
    );
  });

  it("Phase 72 — the active .tab::before is a flat 41% tint and keeps the square bottom corners", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-active::before {');
    expect(block).toContain("41%");
    expect(block).toContain("var(--bg-elevated)");
    expect(block).not.toContain("linear-gradient");
    expect(block).toContain("border-bottom-left-radius: 0");
    expect(block).toContain("border-bottom-right-radius: 0");
  });

  it("the colorful .tab has a uniform 180px width", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab {');
    expect(block).toContain("width: var(--tf-tab-width, 180px)");
  });

  it("the colorful .tab and .tab-active labels use --fg-strong", () => {
    expect(blockFor('.tab-area[data-tab-style="colorful"] .tab {')).toContain(
      "color: var(--fg-strong)",
    );
    expect(blockFor('.tab-area[data-tab-style="colorful"] .tab-active {')).toContain(
      "color: var(--fg-strong)",
    );
  });

  it("Phase 72 — the .tab-colour-chip identity mark is removed from the sheet", () => {
    expect(SHEET).not.toContain(".tab-colour-chip {");
  });

  it("Phase 72 — the colorful close control is pinned right and the title ellipsizes", () => {
    const closeBlock = blockFor('.tab-area[data-tab-style="colorful"] .tab-close {');
    expect(closeBlock).toContain("margin-left: auto");
    const titleBlock = blockFor('.tab-area[data-tab-style="colorful"] .tab-title {');
    expect(titleBlock).toContain("max-width: none");
    expect(titleBlock).toContain("min-width: 0");
  });

  it("DEF-441 — the colorful modified dot uses the full accent fill and an --fg-strong ring", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-modified-dot {');
    expect(block).toContain("background: var(--tf-tab-accent, var(--sem-neutral))");
    expect(block).not.toContain("var(--tf-tab-ink)");
    expect(block).toContain(
      "box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--fg-strong) 55%, transparent)",
    );
  });

  it("DEF-441 — the colorful close hover paints an --fg-strong wash", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-close:hover {');
    expect(block).toContain("background: color-mix(in srgb, var(--fg-strong) 16%, transparent)");
    expect(block).not.toContain("var(--tf-tab-ink)");
  });
});
