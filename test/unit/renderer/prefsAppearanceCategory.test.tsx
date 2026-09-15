// @vitest-environment jsdom
//
// Appearance panel contract:
//
//   1. Clicking the Appearance category swaps the panel to the three
//      sections (Theme, Tools Palette, Side Panel); the General
//      sections are gone.
//   2. The theme select (moved out of the General panel when
//      Appearance got its own content) renders in the Appearance
//      panel with the four theme-default options; changing it fires
//      onSetThemeDefault and onThemeChange.
//   3. The tools-palette-layout select is parent-controlled when the
//      host provides a value and calls onSetToolsPaletteLayout on
//      change; unwired it stays interactive on draft state.
//   4. The "collapse page panel on startup" checkbox calls
//      onSetPagesPanelCollapsed with the new value; unwired it
//      toggles draft state.
//   5. Categories with no panel yet (documents, ...) still render
//      the quiet placeholder.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import type { ThemeDefault } from "../../../src/renderer/state/preferences";

interface MountOpts {
  toolsPaletteLayout?: "list" | "grid";
  onSetToolsPaletteLayout?: (v: "list" | "grid") => void;
  pagesPanelCollapsed?: boolean;
  onSetPagesPanelCollapsed?: (v: boolean) => void;
  onSetThemeDefault?: (v: ThemeDefault) => void;
  onThemeChange?: (v: ThemeDefault) => void;
}

function mountPrefs(opts: MountOpts = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={(): void => undefined}
        themeDefault="dark"
        recentsCap={10}
        onSetThemeDefault={opts.onSetThemeDefault ?? ((): void => undefined)}
        onThemeChange={opts.onThemeChange ?? ((): void => undefined)}
        onSetRecentsCap={(): void => undefined}
        toolsPaletteLayout={opts.toolsPaletteLayout}
        onSetToolsPaletteLayout={opts.onSetToolsPaletteLayout}
        pagesPanelCollapsed={opts.pagesPanelCollapsed}
        onSetPagesPanelCollapsed={opts.onSetPagesPanelCollapsed}
      />,
    );
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

function clickCategory(host: HTMLElement, id: string): void {
  const btn = host.querySelector<HTMLButtonElement>(
    `.preferences-sidebar [data-prefs-category="${id}"]`,
  );
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.click();
  });
}

function activateAppearance(host: HTMLElement): void {
  clickCategory(host, "appearance");
}

/** Drive a React controlled <select> the way a user's pick does:
 *  set the value through the NATIVE setter (React's controlled-value
 *  trap otherwise resets the node) and bubble a `change` event. */
function pickOption(host: HTMLElement, selector: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(selector);
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

function panelTitles(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll(".preferences-panel .preference-section h3"),
  ).map((h) => h.textContent?.trim());
}

describe("Preferences Appearance panel", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("clicking Appearance swaps the panel to Theme / Tools Palette / Side Panel", () => {
    const { host, unmount } = mountPrefs();
    // General is the default view: the Appearance controls are not
    // rendered until the category is activated.
    expect(panelTitles(host)).not.toContain("Theme");
    expect(host.querySelector("[data-prefs-tools-palette-layout]")).toBeNull();
    expect(host.querySelector("[data-prefs-pages-panel-collapsed]")).toBeNull();
    activateAppearance(host);
    expect(panelTitles(host)).toEqual(["Theme", "Tools Palette", "Side Panel"]);
    // The General sections are gone from the panel.
    expect(panelTitles(host)).not.toContain("Startup");
    unmount();
  });

  it("the theme select renders in the Appearance panel with the four theme-default options", () => {
    const { host, unmount } = mountPrefs();
    // It is NOT in the General default view (moved to Appearance).
    expect(host.querySelector("[data-prefs-theme-default]")).toBeNull();
    activateAppearance(host);
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-theme-default]");
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((o) => o.value)).toEqual([
      "light",
      "dark",
      "frosted",
      "system",
    ]);
    expect(Array.from(select!.options).map((o) => o.textContent)).toEqual([
      "Light",
      "Dark",
      "Frosted",
      "System default",
    ]);
    unmount();
  });

  it("changing the theme select fires onSetThemeDefault then onThemeChange", () => {
    const onSetThemeDefault = vi.fn((): void => undefined);
    const onThemeChange = vi.fn((): void => undefined);
    const { host, unmount } = mountPrefs({ onSetThemeDefault, onThemeChange });
    activateAppearance(host);
    pickOption(host, "[data-prefs-theme-default]", "light");
    expect(onSetThemeDefault).toHaveBeenCalledWith("light");
    expect(onThemeChange).toHaveBeenCalledWith("light");
    expect(
      onSetThemeDefault.mock.invocationCallOrder[0],
    ).toBeLessThan(onThemeChange.mock.invocationCallOrder[0]);
    unmount();
  });

  it("the tools layout select is parent-controlled when the host provides a value", () => {
    const { host, unmount } = mountPrefs({ toolsPaletteLayout: "grid" });
    activateAppearance(host);
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-tools-palette-layout]");
    expect(select?.value).toBe("grid");
    unmount();
  });

  it("changing the tools layout select calls onSetToolsPaletteLayout", () => {
    const onSetLayout = vi.fn((): void => undefined);
    const { host, unmount } = mountPrefs({
      toolsPaletteLayout: "list",
      onSetToolsPaletteLayout: onSetLayout,
    });
    activateAppearance(host);
    pickOption(host, "[data-prefs-tools-palette-layout]", "grid");
    expect(onSetLayout).toHaveBeenCalledTimes(1);
    expect(onSetLayout).toHaveBeenCalledWith("grid");
    unmount();
  });

  it("unwired tools layout select stays interactive on draft state", () => {
    const { host, unmount } = mountPrefs();
    activateAppearance(host);
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-tools-palette-layout]");
    expect(select?.value).toBe("list");
    pickOption(host, "[data-prefs-tools-palette-layout]", "grid");
    expect(
      host.querySelector<HTMLSelectElement>("[data-prefs-tools-palette-layout]")?.value,
    ).toBe("grid");
    unmount();
  });

  it("the pages-panel checkbox calls onSetPagesPanelCollapsed with the new value", () => {
    const onSetCollapsed = vi.fn((): void => undefined);
    const { host, unmount } = mountPrefs({ onSetPagesPanelCollapsed: onSetCollapsed });
    activateAppearance(host);
    const box = host.querySelector<HTMLInputElement>("[data-prefs-pages-panel-collapsed]");
    expect(box).not.toBeNull();
    expect(box?.checked).toBe(false);
    act((): void => {
      box?.click();
    });
    expect(onSetCollapsed).toHaveBeenCalledTimes(1);
    expect(onSetCollapsed).toHaveBeenCalledWith(true);
    unmount();
  });

  it("respects the pagesPanelCollapsed value the host passes", () => {
    const { host, unmount } = mountPrefs({ pagesPanelCollapsed: true });
    activateAppearance(host);
    const box = host.querySelector<HTMLInputElement>("[data-prefs-pages-panel-collapsed]");
    expect(box?.checked).toBe(true);
    unmount();
  });

  it("unwired pages-panel checkbox toggles draft state", () => {
    const { host, unmount } = mountPrefs();
    activateAppearance(host);
    const box = host.querySelector<HTMLInputElement>("[data-prefs-pages-panel-collapsed]");
    expect(box).not.toBeNull();
    act((): void => {
      box?.click();
    });
    expect(box?.checked).toBe(true);
    act((): void => {
      box?.click();
    });
    expect(box?.checked).toBe(false);
    unmount();
  });

  it("categories without a panel still render the placeholder", () => {
    const { host, unmount } = mountPrefs();
    clickCategory(host, "documents");
    expect(host.querySelector(".preferences-panel-empty")).not.toBeNull();
    expect(host.querySelectorAll(".preference-section")).toHaveLength(0);
    unmount();
  });
});