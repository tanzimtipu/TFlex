// @vitest-environment jsdom
//
// Phase 114 (TFL-1239, chunk C) — the General category migrated onto the
// Settings Studio primitives.
//
// Pins the migrated shell + General panel: the four category tabs still carry
// their `data-prefs-category` hooks and the four panels their `data-prefs-panel`
// hooks (all mounted, exactly one active), every shipped General control hook
// survives and still fires its handler, each row states its timing explicitly,
// and the navigator's roving arrow keys still move the selection.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";

const CATEGORY_IDS = ["general", "documents", "import", "storage"] as const;

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onSetThemeDefault: ReturnType<typeof vi.fn>;
  onThemeChange: ReturnType<typeof vi.fn>;
  onSetAnimationsEnabled: ReturnType<typeof vi.fn>;
  onSetTabStyle: ReturnType<typeof vi.fn>;
  onSetRecentsCap: ReturnType<typeof vi.fn>;
}

function mount(): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetThemeDefault = vi.fn((): void => undefined);
  const onThemeChange = vi.fn((): void => undefined);
  const onSetAnimationsEnabled = vi.fn((): void => undefined);
  const onSetTabStyle = vi.fn((): void => undefined);
  const onSetRecentsCap = vi.fn((): void => undefined);
  const ui: ReactElement = (
    <PreferencesDialog
      open
      onClose={vi.fn((): void => undefined)}
      themeDefault="dark"
      recentsCap={10}
      onSetThemeDefault={onSetThemeDefault}
      onThemeChange={onThemeChange}
      onSetRecentsCap={onSetRecentsCap}
      animationsEnabled
      onSetAnimationsEnabled={onSetAnimationsEnabled}
      convertDefaults={DEFAULT_CONVERT_DEFAULTS}
      onSetConvertDefaults={vi.fn((): void => undefined)}
      tabStyle="colorful"
      onSetTabStyle={onSetTabStyle}
    />
  );
  act((): void => {
    root.render(ui);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onSetThemeDefault,
    onThemeChange,
    onSetAnimationsEnabled,
    onSetTabStyle,
    onSetRecentsCap,
  };
}

function pickSelect(host: HTMLElement, selector: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(selector);
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function commitNumber(host: HTMLElement, selector: string, text: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act((): void => {
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

describe("Settings Studio — migrated Preferences shell (chunk C)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders the four category tabs with their data-prefs-category hooks", () => {
    const { host, unmount } = mount();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-prefs-category]"));
    expect(tabs.map((t): string => t.getAttribute("data-prefs-category") ?? "")).toEqual([
      ...CATEGORY_IDS,
    ]);
    for (const tab of tabs) expect(tab.getAttribute("role")).toBe("tab");
    // The navigator is the shared Studio one.
    expect(host.querySelector("[data-settings-nav]")).not.toBeNull();
    unmount();
  });

  it("keeps all four panels mounted with exactly one data-active=true", () => {
    const { host, unmount } = mount();
    const panels = Array.from(host.querySelectorAll<HTMLElement>("[data-prefs-panel]"));
    expect(panels.map((p): string => p.getAttribute("data-prefs-panel") ?? "")).toEqual([
      ...CATEGORY_IDS,
    ]);
    const active = panels.filter((p): boolean => p.getAttribute("data-active") === "true");
    expect(active.length).toBe(1);
    expect(active[0]?.getAttribute("data-prefs-panel")).toBe("general");
    unmount();
  });

  it("firing each General hook calls its matching prop handler", () => {
    const m = mount();
    pickSelect(m.host, "[data-prefs-theme-default]", "frosted");
    expect(m.onSetThemeDefault).toHaveBeenCalledWith("frosted");
    expect(m.onThemeChange).toHaveBeenCalledWith("frosted");

    const box = m.host.querySelector<HTMLInputElement>("[data-prefs-animations]");
    expect(box).not.toBeNull();
    act((): void => {
      box?.click();
    });
    expect(m.onSetAnimationsEnabled).toHaveBeenCalledWith(false);

    pickSelect(m.host, "[data-prefs-tab-style]", "standard");
    expect(m.onSetTabStyle).toHaveBeenCalledWith("standard");

    commitNumber(m.host, "[data-prefs-recents-cap]", "25");
    expect(m.onSetRecentsCap).toHaveBeenCalledWith(25);
    m.unmount();
  });

  it("states each row's timing explicitly", () => {
    const { host, unmount } = mount();
    const text = host.textContent ?? "";
    expect(text).toContain("Applies immediately; the app starts in this theme on the next launch.");
    expect(text).toContain(
      "Applies immediately; when off, menus, panels, dialogs and page changes run without transition animations.",
    );
    expect(text).toContain("Applies immediately.");
    expect(text).toContain("Takes effect on next launch.");
    unmount();
  });

  it("ArrowDown on the rail moves the selection to the next category", () => {
    const { host, unmount } = mount();
    const general = host.querySelector<HTMLButtonElement>('[data-prefs-category="general"]');
    expect(general).not.toBeNull();
    act((): void => {
      general?.focus();
      general?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(
      host.querySelector('[data-prefs-category][aria-selected="true"]')?.getAttribute("data-prefs-category"),
    ).toBe("documents");
    expect(
      host.querySelector<HTMLElement>('[data-prefs-panel="documents"]')?.getAttribute("data-active"),
    ).toBe("true");
    unmount();
  });
});