// @vitest-environment jsdom
//
// Phase 40 (item 7) — the single-view page-layout CONTROL.
//
// Criterion 9: exactly three options (one / two / four), the active one is
// visibly marked, one page is the default, and the icon reflects the current
// layout. This suite renders the control (three option buttons with distinct
// accessible names, aria-pressed on the active one) and pins the DocumentView
// wiring: the mode is per-tab LOCAL state, single-view only, and never part of
// the persisted viewer contract.
//
// Without the change these fail: PageLayoutControl does not exist.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { PageLayoutControl } from "../../../src/renderer/components/PageLayoutControl";
import { DEFAULT_PAGE_LAYOUT, type PageLayoutMode } from "../../../src/renderer/components/pageLayoutMode";

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

/** A controlled harness mirroring DocumentView's local state. */
function Harness(props: { onChange?: (m: PageLayoutMode) => void; initial?: PageLayoutMode }): ReactElement {
  const [mode, setMode] = useState<PageLayoutMode>(props.initial ?? DEFAULT_PAGE_LAYOUT);
  return (
    <PageLayoutControl
      value={mode}
      onChange={(m): void => {
        props.onChange?.(m);
        setMode(m);
      }}
    />
  );
}

function render(el: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  mounted.push(host);
  const root = createRoot(host);
  act(() => {
    root.render(el);
  });
  return host;
}

describe("Phase 40 (item 7) — the control exposes three named options", () => {
  it("renders exactly three options, one active, default ONE", () => {
    const host = render(<Harness />);
    const options = host.querySelectorAll("[data-page-layout-option]");
    expect(options).toHaveLength(3);
    expect(Array.from(options).map((o) => o.getAttribute("data-page-layout-option"))).toEqual([
      "one",
      "two",
      "four",
    ]);
    expect(host.querySelector("[data-page-layout-control]")).not.toBeNull();

    const labels = Array.from(options).map((o) => o.getAttribute("aria-label"));
    expect(labels).toEqual(["One page", "Two pages side by side", "Four pages in two rows"]);
    // Every option name is distinct and descriptive.
    expect(new Set(labels).size).toBe(3);

    // ONE is the default: active + aria-pressed, the others not.
    const active = host.querySelector('[data-page-layout-active="one"]');
    expect(active).not.toBeNull();
    const pressed = Array.from(options).map((o) => o.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["true", "false", "false"]);
  });

  it("clicking an option selects it and moves the active mark", () => {
    const onChange = vi.fn();
    const host = render(<Harness onChange={onChange} />);

    act(() => {
      (host.querySelector('[data-page-layout-option="two"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledWith("two");
    expect(host.querySelectorAll('[data-page-layout-active="two"]')).toHaveLength(1);
    expect(
      (host.querySelector('[data-page-layout-option="two"]') as HTMLElement).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (host.querySelector('[data-page-layout-option="one"]') as HTMLElement).getAttribute("aria-pressed"),
    ).toBe("false");

    act(() => {
      (host.querySelector('[data-page-layout-option="four"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenLastCalledWith("four");
    expect(host.querySelector('[data-page-layout-active="four"]')).not.toBeNull();
  });

  it("each option carries an icon (no emoji, a real svg)", () => {
    const host = render(<Harness />);
    for (const mode of ["one", "two", "four"]) {
      const button = host.querySelector(`[data-page-layout-option="${mode}"]`) as HTMLElement;
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("Phase 40 (item 7) — DocumentView wires the mode per tab, session-scoped", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("holds the mode in local state, defaulting to ONE", () => {
    expect(source).toMatch(/useState<PageLayoutMode>\(DEFAULT_PAGE_LAYOUT\)/);
  });

  it("never persists the layout (not in PersistedViewer, not in onPersist)", () => {
    const persisted = source.slice(
      source.indexOf("export interface PersistedViewer"),
      source.indexOf("export interface SearchIndexProgress"),
    );
    expect(persisted).not.toMatch(/pageLayout|layoutMode/);
    const persistCall = source.slice(source.indexOf("onPersist({"), source.indexOf("}, [zoom, currentPage, searchOpen"));
    expect(persistCall).not.toMatch(/pageLayout/);
  });

  it("is single-view only: the layout group lives in the footer, absent in a pane", () => {
    // Phase 109 (chunk A) — the top-right control moved to the unified View
    // Strip footer; the group is single-view only (`!inMultiPane`).
    const viewStrip = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/ViewStrip.tsx"),
      "utf8",
    );
    expect(viewStrip).toMatch(/\{!inMultiPane && \(/);
    expect(viewStrip).toMatch(/aria-label="Page layout"/);
    expect(viewStrip).toMatch(/data-page-layout-option=\{mode\}/);
    // A pane collapses its layout to ONE so Multi Mode's layout is untouched.
    expect(source).toMatch(/singleView \? pageLayout : DEFAULT_PAGE_LAYOUT/);
  });

  it("selecting a mode establishes its promised fit (item 9)", () => {
    // The handler switches the zoom to the mode's fit; TWO / FOUR use fit-page
    // so the pages they promise actually fill the viewport.
    expect(source).toMatch(/setMode\(pageLayoutFitMode\(mode\)\)/);
    expect(source).toMatch(/import \{[\s\S]*?pageLayoutFitMode,[\s\S]*?\} from "\.\/pageLayoutMode"/);
  });

  it("flows the page list into a grid and drives the fit from the mode", () => {
    expect(source).toMatch(/<div className="document-content" data-page-layout=\{layoutMode\}>/);
    expect(source).toMatch(/layoutFitViewport\(layoutMode, zoom\.mode, viewportBox\)/);
    expect(source).toMatch(/layoutFitAnchor\(layoutMode, zoom\.mode, fitAnchor\)/);
    // The ONE path keeps the DEF-338 gate's exact call, now scaled by the fit margin.
    expect(source).toMatch(/computeEffectiveScale\(viewportBox, fitAnchor, zoom, FIT_MARGIN_PX\)/);
  });
});
