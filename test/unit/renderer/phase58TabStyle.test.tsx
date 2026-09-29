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
//   d. AnimatedTab renders the decorative `.tab-flare` (DEF-409) for the
//      colourful bottom-right silhouette, with its contract unchanged.
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

describe("AnimatedTab — Phase 58 colorful bottom-right flare (DEF-409)", () => {
  const TABS: TabSpec[] = [
    { id: "a", title: "Alpha.pdf", modified: false },
    { id: "b", title: "Beta.pdf", modified: true },
  ];

  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("every colorful tab exposes exactly one decorative .tab-flare node", () => {
    const host = renderHeader("colorful", TABS);
    const tabs = [...host.querySelectorAll<HTMLElement>("[data-tab-id]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.querySelectorAll(".tab-flare")).toHaveLength(1);
    }
  });

  it("the flare is decoration only: aria-hidden, no role, no tabindex", () => {
    const host = renderHeader("colorful", TABS);
    const flare = host.querySelector<HTMLElement>(".tab-flare");
    expect(flare).not.toBeNull();
    expect(flare?.getAttribute("aria-hidden")).toBe("true");
    expect(flare?.getAttribute("role")).toBeNull();
    expect(flare?.hasAttribute("tabindex")).toBe(false);
  });

  it("adding the flare leaves the tab contract intact (id, colour, close, dot)", () => {
    const host = renderHeader("colorful", TABS, "a");
    const tab = host.querySelector<HTMLElement>("[data-tab-id='a']");
    expect(tab?.getAttribute("role")).toBe("tab");
    expect(tab?.getAttribute("data-tab-colour")).toBe("0");
    expect(tab?.classList.contains("tab-active")).toBe(true);
    expect(tab?.querySelector(".tab-title")).not.toBeNull();
    expect(tab?.querySelector(".tab-modified-dot")).not.toBeNull();
    expect(tab?.querySelector(".tab-close")).not.toBeNull();
  });

  it("the flare element is present under standard too (paint is colorful-only)", () => {
    const host = renderHeader("standard", TABS);
    const flare = host.querySelector<HTMLElement>(".tab-flare");
    expect(flare).not.toBeNull();
    expect(flare?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the stylesheet carries the OUTWARD flare and dropped the INWARD radius", () => {
    // vitest runs from the repo root; read the sheet by path (import.meta.url
    // is an http URL under the jsdom environment).
    const sheet = readFileSync("src/renderer/styles.css", "utf8");
    // DEF-409 regression guard: the colorful body fill must no longer round
    // its bottom-right INWARD.
    expect(sheet).not.toContain("border-bottom-right-radius: var(--radius-3)");
    // ...and the colorful flare override must exist with the outward geometry.
    expect(sheet).toContain('.tab-area[data-tab-style="colorful"] .tab .tab-flare');
    expect(sheet).toContain("radial-gradient");
    expect(sheet).toContain("right: -6px");
  });
});