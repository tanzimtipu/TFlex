// @vitest-environment jsdom
// Phase 62 — colorful tab restyle: 26px height, one uniform corner radius on
// all four corners, no DEF-409 flare, and the active tab merged into the
// canvas (square bottom corners, no ink underline, strip extended onto the
// canvas top). jsdom does not apply styles.css, so the render seams and the
// sheet text are asserted directly (the same readFileSync pattern as the
// Phase 58 oracle).
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

const TABS: TabSpec[] = [
  { id: "a", title: "Alpha.pdf", modified: false },
  { id: "b", title: "Beta.pdf", modified: true },
];

describe("AppHeader — Phase 62 colorful render seams", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("colorful renders two .tab nodes with the active one carrying .tab-active", () => {
    const host = renderHeader("colorful", TABS, "a");
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
    const active = host.querySelector<HTMLElement>(".tab-active");
    expect(active?.getAttribute("data-tab-id")).toBe("a");
    expect(host.querySelector(".tab-area")?.getAttribute("data-tab-style")).toBe("colorful");
  });

  it("standard still renders (data-tab-style='standard')", () => {
    const host = renderHeader("standard", TABS, "a");
    expect(host.querySelector(".tab-area")?.getAttribute("data-tab-style")).toBe("standard");
  });
});

describe("Phase 62 — colorful tab stylesheet", () => {
  it("the colorful .tab is 26px high", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab {');
    expect(block).toContain("height: 26px");
  });

  it("the standard .tab keeps its 34px height (Phase 58 criterion 1)", () => {
    const block = blockFor("\n.tab {");
    expect(block).toContain("height: 34px");
  });

  it("the colorful .tab::before has one uniform non-zero radius on all four corners", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab::before {');
    expect(block).toContain("border-radius: var(--radius-2)");
    expect(block).not.toContain("border-radius: 0");
    expect(SHEET).toContain("--radius-2: 5px");
  });

  it("no colorful rule paints a .tab-flare radial gradient", () => {
    expect(SHEET).not.toContain(".tab .tab-flare");
    expect(SHEET).not.toContain("ellipse 6px 10px");
  });

  it("the active tab's bottom corners are square while the top stay rounded", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-active::before {');
    expect(block).toContain("border-bottom-left-radius: 0");
    expect(block).toContain("border-bottom-right-radius: 0");
  });

  it("the shared ::after underline is removed within the colorful scope", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-active::after {');
    expect(block).toContain("content: none");
  });

  it("TFL-524 — the strip hangs from the top: every tab shares one top edge and only the active fills to the foot", () => {
    // The Phase 62 strip extension is retired; the colorful strip fills the
    // header content box. TFL-524 (DEF-534) repointed the row alignment from
    // vertical centring to a shared TOP edge, and the active tab now fills the
    // full strip height instead of the fixed 30px foot-pinned box.
    const stripBlock = blockFor('.tab-area[data-tab-style="colorful"] {');
    expect(stripBlock).toContain("align-self: stretch");
    expect(stripBlock).toContain("height: 100%");
    expect(stripBlock).toContain("margin-bottom: 0");
    expect(stripBlock).not.toContain("calc(100% + 1px)");
    expect(stripBlock).not.toContain("margin-bottom: -1px");
    const listBlock = blockFor('.tab-area[data-tab-style="colorful"] .tab-list {');
    expect(listBlock).toContain("align-items: flex-start");
    expect(listBlock).not.toContain("align-items: center");
    // TFL-213 (DEF-440) moved the row alignment off the inner `.tab-active`
    // block — where `align-self` is inert — onto the wrapping `<li>`, the flex
    // item `.tab-list` actually lays out. TFL-524 repoints that flex item from
    // `flex-end` (foot-pinned 30px) to `stretch` (full strip height).
    const activeItemBlock = blockFor(
      '.tab-area[data-tab-style="colorful"] .tab-list > li[data-tab-active="true"] {',
    );
    expect(activeItemBlock).toContain("align-self: stretch");
    expect(activeItemBlock).not.toContain("align-self: flex-end");
    const activeBlock = blockFor('.tab-area[data-tab-style="colorful"] .tab-active {');
    expect(activeBlock).toContain("height: 100%");
    expect(activeBlock).not.toContain("height: 30px");
  });
});
