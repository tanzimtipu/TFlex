// @vitest-environment jsdom
//
// DEF-215 — the Phase-17 single-panel PreferencesDialog replaced the
// old category-navigation design (Appearance / General categories and
// their per-category props are gone). These tests pin the CURRENT
// shape of the dialog:
//
//   a. the sheet mounts open with the [data-prefs-dialog] root.
//   b. exactly three sections render, in order: Appearance,
//      Recent files, Storage locations.
//   c. the theme dropdown offers exactly the four ThemeDefault
//      options (Light, Dark, Frosted, System default).
//   d. changing the dropdown fires onSetThemeDefault AND
//      onThemeChange once each with the picked value (immediate
//      apply + persist).
//   e. committing the recents cap (Enter keydown) fires
//      onSetRecentsCap once with the parsed number.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import type { ThemeDefault } from "../../../src/renderer/state/preferences";

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onSetThemeDefault: ReturnType<typeof vi.fn>;
  onThemeChange: ReturnType<typeof vi.fn>;
  onSetRecentsCap: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mountPrefs(
  opts: { themeDefault?: ThemeDefault; recentsCap?: number } = {},
): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetThemeDefault = vi.fn((): void => undefined);
  const onThemeChange = vi.fn((): void => undefined);
  const onSetRecentsCap = vi.fn((): void => undefined);
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={onClose}
        themeDefault={opts.themeDefault ?? "dark"}
        recentsCap={opts.recentsCap ?? 10}
        onSetThemeDefault={onSetThemeDefault}
        onThemeChange={onThemeChange}
        onSetRecentsCap={onSetRecentsCap}
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
    onSetThemeDefault,
    onThemeChange,
    onSetRecentsCap,
    onClose,
  };
}

/** Drive a React controlled <select> the way a user's pick does:
 *  set the value through the NATIVE setter (React's controlled-value
 *  trap otherwise resets the node) and bubble a `change` event. */
function pickThemeOption(host: HTMLElement, value: string): void {
  const select = host.querySelector<HTMLSelectElement>("[data-prefs-theme-default]");
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

/** Drive a React controlled <input> the way a user's typing + Enter
 *  does: set the value through the NATIVE setter, bubble an `input`
 *  event (React's onChange for text inputs), then dispatch the Enter
 *  keydown the component's commit handler listens to. */
function typeAndCommitCap(host: HTMLElement, text: string): void {
  const input = host.querySelector<HTMLInputElement>("[data-prefs-recents-cap]");
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  expect(setValue).toBeTypeOf("function");
  act((): void => {
    setValue?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act((): void => {
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

describe("PreferencesDialog single-panel redesign (DEF-215)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("mounts open and the sheet root carries [data-prefs-dialog]", () => {
    const { host, unmount } = mountPrefs();
    expect(host.querySelector("[data-prefs-dialog]")).not.toBeNull();
    unmount();
  });

  it("renders the three sections in order: Appearance, Recent files, Storage locations", () => {
    const { host, unmount } = mountPrefs();
    const titles = Array.from(
      host.querySelectorAll<HTMLElement>("[data-prefs-dialog] .prefs-section-title"),
    ).map((el): string => el.textContent ?? "");
    expect(titles).toEqual(["Appearance", "Recent files", "Storage locations"]);
    unmount();
  });

  it("the theme dropdown offers exactly the four ThemeDefault options", () => {
    const { host, unmount } = mountPrefs();
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-theme-default]");
    expect(select).not.toBeNull();
    expect(select!.options.length).toBe(4);
    const options = Array.from(select!.options);
    expect(options.map((o): string => o.textContent ?? "")).toEqual([
      "Light",
      "Dark",
      "Frosted",
      "System default",
    ]);
    expect(options.map((o): string => o.value)).toEqual([
      "light",
      "dark",
      "frosted",
      "system",
    ]);
    unmount();
  });

  it("changing the dropdown fires onSetThemeDefault AND onThemeChange once each with the picked value", () => {
    const { host, onSetThemeDefault, onThemeChange, unmount } = mountPrefs({
      themeDefault: "dark",
    });
    pickThemeOption(host, "frosted");
    expect(onSetThemeDefault).toHaveBeenCalledTimes(1);
    expect(onSetThemeDefault).toHaveBeenCalledWith("frosted");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("frosted");
    unmount();
  });

  it("committing the recents cap with Enter fires onSetRecentsCap once with the parsed number", () => {
    const { host, onSetRecentsCap, unmount } = mountPrefs({ recentsCap: 10 });
    typeAndCommitCap(host, "25");
    expect(onSetRecentsCap).toHaveBeenCalledTimes(1);
    expect(onSetRecentsCap).toHaveBeenCalledWith(25);
    unmount();
  });
});