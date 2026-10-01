// @vitest-environment jsdom
// Phase 58 (chunk 2) — the colourful-vs-standard tab style preference.
//
// Pins the seams the renderer owns for the feature:
//   a. AppHeader renders `data-tab-style` on `.tab-area` from the prop,
//      defaulting to 'colorful' when it is omitted.
//   b. PreferencesDialog renders the Tab style row ONLY when an
//      `onSetTabStyle` handler is supplied, and calls it with the pick.
//   c. preferencesReducer's `set-tab-style` writes a valid value and
//      drops an invalid one; DEFAULT_TAB_STYLE is 'colorful'.
//   d. Phase 62 retired the DEF-409 decorative `.tab-flare`; AnimatedTab no
//      longer renders it and the colorful silhouette is a rounded chip.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import {
  DEFAULT_TAB_STYLE,
  preferencesReducer,
} from "../../../src/renderer/state/preferences";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import type { TabStyle } from "../../../src/shared/types";

interface TabSpec {
  id: string;
  title: string;
  modified: boolean;
}

function renderHeader(
  tabStyle?: TabStyle,
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

describe("AppHeader — Phase 58 tab style attribute", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("sets data-tab-style='colorful' when tabStyle is 'colorful'", () => {
    const host = renderHeader("colorful");
    const area = host.querySelector<HTMLElement>(".tab-area");
    expect(area?.getAttribute("data-tab-style")).toBe("colorful");
  });

  it("sets data-tab-style='standard' when tabStyle is 'standard'", () => {
    const host = renderHeader("standard");
    const area = host.querySelector<HTMLElement>(".tab-area");
    expect(area?.getAttribute("data-tab-style")).toBe("standard");
  });

  it("defaults to 'colorful' when the prop is omitted", () => {
    const host = renderHeader();
    const area = host.querySelector<HTMLElement>(".tab-area");
    expect(area?.getAttribute("data-tab-style")).toBe("colorful");
  });
});

interface PrefsMount {
  host: HTMLElement;
  onSetTabStyle: ReturnType<typeof vi.fn>;
}

function mountPrefs(opts: { withHandler: boolean; tabStyle?: TabStyle }): PrefsMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetTabStyle = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={(): void => undefined}
        themeDefault="dark"
        recentsCap={10}
        onSetThemeDefault={(): void => undefined}
        onThemeChange={(): void => undefined}
        onSetRecentsCap={(): void => undefined}
        animationsEnabled
        onSetAnimationsEnabled={(): void => undefined}
        tabStyle={opts.tabStyle}
        onSetTabStyle={opts.withHandler ? onSetTabStyle : undefined}
      />,
    );
  });
  return { host, onSetTabStyle };
}

function pickTabStyle(host: HTMLElement, value: string): void {
  const select = host.querySelector<HTMLSelectElement>("[data-prefs-tab-style]");
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  expect(setValue).toBeTypeOf("function");
  act((): void => {
    setValue?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("PreferencesDialog — Phase 58 Tab style row", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders the Tab style select (value 'colorful') when a handler is supplied", () => {
    const { host } = mountPrefs({ withHandler: true, tabStyle: "colorful" });
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-tab-style]");
    expect(select).not.toBeNull();
    expect(select?.value).toBe("colorful");
  });

  it("calls onSetTabStyle with 'standard' when the user picks Standard", () => {
    const { host, onSetTabStyle } = mountPrefs({ withHandler: true, tabStyle: "colorful" });
    pickTabStyle(host, "standard");
    expect(onSetTabStyle).toHaveBeenCalledWith("standard");
  });

  it("omits the Tab style row when onSetTabStyle is absent", () => {
    const { host } = mountPrefs({ withHandler: false });
    expect(host.querySelector("[data-prefs-tab-style]")).toBeNull();
  });
});

describe("preferencesReducer — Phase 58 set-tab-style", () => {
  it("DEFAULT_TAB_STYLE is 'colorful'", () => {
    expect(DEFAULT_TAB_STYLE).toBe("colorful");
  });

  it("sets tabStyle to the requested value", () => {
    const next = preferencesReducer(DEFAULT_SETTINGS, {
      type: "set-tab-style",
      value: "standard",
    });
    expect(next.tabStyle).toBe("standard");
  });

  it("drops an invalid value (identity no-op)", () => {
    const state = { ...DEFAULT_SETTINGS, tabStyle: "colorful" as TabStyle };
    const next = preferencesReducer(state, {
      type: "set-tab-style",
      value: "bogus" as TabStyle,
    });
    expect(next).toBe(state);
  });
});

describe("AnimatedTab — Phase 62 retired the DEF-409 flare", () => {
  const TABS: TabSpec[] = [
    { id: "a", title: "Alpha.pdf", modified: false },
    { id: "b", title: "Beta.pdf", modified: true },
  ];

  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("no colorful tab renders a .tab-flare node any more", () => {
    const host = renderHeader("colorful", TABS);
    const tabs = [...host.querySelectorAll<HTMLElement>("[data-tab-id]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.querySelectorAll(".tab-flare")).toHaveLength(0);
    }
  });

  it("no standard tab renders a .tab-flare node either", () => {
    const host = renderHeader("standard", TABS);
    expect(host.querySelector(".tab-flare")).toBeNull();
  });

  it("retiring the flare leaves the tab contract intact (id, colour, close, dot)", () => {
    const host = renderHeader("colorful", TABS, "a");
    const tab = host.querySelector<HTMLElement>("[data-tab-id='a']");
    expect(tab?.getAttribute("role")).toBe("tab");
    expect(tab?.getAttribute("data-tab-colour")).toBe("0");
    expect(tab?.classList.contains("tab-active")).toBe(true);
    expect(tab?.querySelector(".tab-title")).not.toBeNull();
    expect(tab?.querySelector(".tab-modified-dot")).not.toBeNull();
    expect(tab?.querySelector(".tab-close")).not.toBeNull();
  });

  it("the stylesheet carries no colorful .tab-flare paint", () => {
    // vitest runs from the repo root; read the sheet by path (import.meta.url
    // is an http URL under the jsdom environment).
    const sheet = readFileSync("src/renderer/styles.css", "utf8");
    expect(sheet).not.toContain('.tab-area[data-tab-style="colorful"] .tab .tab-flare');
  });
});

// ---------------------------------------------------------------------------
// Phase 72 (item 3) — the ONLY tab dot is the dirty dot. The always-on
// `.tab-colour-chip` is gone; `.tab-modified-dot` is painted iff `modified`
// is true, so an unmodified tab's dot is not visible. jsdom does not run the
// real cascade for us, so the visibility oracle injects the sheet's own
// `.tab-modified-dot-hidden` rule and reads `getComputedStyle` (this repo has
// no jest-dom, so `not.toBeVisible()` is expressed through this helper).
// ---------------------------------------------------------------------------
function isVisible(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.opacity !== "0" && s.display !== "none";
}

describe("Phase 72 — the only tab dot is the dirty dot", () => {
  const TABS: TabSpec[] = [
    { id: "clean", title: "clean.pdf", modified: false },
    { id: "dirty", title: "dirty.pdf", modified: true },
  ];

  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("an unmodified tab's .tab-modified-dot is hidden; a modified tab's is visible", () => {
    const host = renderHeader("colorful", TABS, "clean");
    const clean = host.querySelector<HTMLElement>("[data-tab-id='clean'] .tab-modified-dot");
    const dirty = host.querySelector<HTMLElement>("[data-tab-id='dirty'] .tab-modified-dot");
    expect(clean, "unmodified tab still renders the dot slot").not.toBeNull();
    expect(dirty, "modified tab renders the dot").not.toBeNull();
    expect(clean?.classList.contains("tab-modified-dot-hidden")).toBe(true);
    expect(dirty?.classList.contains("tab-modified-dot-hidden")).toBe(false);

    const sheet = readFileSync("src/renderer/styles.css", "utf8");
    const at = sheet.indexOf(".tab-modified-dot-hidden {");
    expect(at, "the hidden rule exists in the sheet").toBeGreaterThan(-1);
    const style = document.createElement("style");
    style.textContent = sheet.slice(at, sheet.indexOf("}", at) + 1);
    document.head.appendChild(style);
    try {
      expect(isVisible(clean as HTMLElement), "unmodified dot hidden").toBe(false);
      expect(isVisible(dirty as HTMLElement), "modified dot visible").toBe(true);
    } finally {
      style.remove();
    }
  });

  it("no colorful tab renders an identity chip any more", () => {
    const host = renderHeader("colorful", TABS, "clean");
    expect(host.querySelector(".tab-colour-chip")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 59 (item 1) — the tab title is NOT selectable and the whole tab drags.
// jsdom's getComputedStyle returns nothing useful for `user-select`, so the
// contract is pinned directly against the stylesheet declaration block (the
// same readFileSync approach as the DEF-409 guard above). This supersedes the
// Phase 58 selectable-title CSS.
// ---------------------------------------------------------------------------
describe("Phase 59 item 1 — .tab-title is not selectable", () => {
  const sheet = readFileSync("src/renderer/styles.css", "utf8");

  /** Slice a selector's declaration block out of the sheet. */
  function blockFor(selector: string): string {
    const at = sheet.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    return sheet.slice(at, sheet.indexOf("}", at));
  }

  it("declares user-select: none (and the -webkit fallback), not text", () => {
    const block = blockFor(".tab-title {");
    expect(block).toContain("user-select: none");
    expect(block).toContain("-webkit-user-select: none");
    expect(block).not.toContain("user-select: text");
  });

  it("declares cursor: default (no text cursor on the title)", () => {
    const block = blockFor(".tab-title {");
    expect(block).toContain("cursor: default");
    expect(block).not.toContain("cursor: text");
  });

  it("the reorder grab hint paints the title with the grab cursor, not text", () => {
    const block = blockFor('.tab-list[data-reorder="true"] .tab .tab-title {');
    expect(block).toContain("cursor: grab");
    expect(block).not.toContain("cursor: text");
  });
});