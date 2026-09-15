// @vitest-environment jsdom
//
// Immediate-apply theme fix — the Preferences theme dropdown used to
// only persist `themeDefault` (next launch); the live theme never
// flipped until a manual header toggle. The fixed contract these
// tests pin:
//
//   1. Changing the dropdown fires `onThemeChange` with the picked
//      value IMMEDIATELY (on the change event — no Save click, the
//      dialog stays open and onClose is never called).
//   2. The picked value is still persisted through `onSetThemeDefault`
//      (next-launch behaviour is unchanged; both callbacks fire).
//   3. 'system' is passed through verbatim — resolving it to a
//      concrete theme is the host's job (resolveThemeDefault), the
//      dialog never substitutes its own value.
//   4. Re-selecting the value the dropdown already shows still fires
//      both callbacks (the host's no-op guards decide whether a
//      persist happens; the dialog must not swallow the event).

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
  onClose: ReturnType<typeof vi.fn>;
}

function mountPrefs(themeDefault: ThemeDefault = "dark"): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetThemeDefault = vi.fn((): void => undefined);
  const onThemeChange = vi.fn((): void => undefined);
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={onClose}
        themeDefault={themeDefault}
        recentsCap={10}
        onSetThemeDefault={onSetThemeDefault}
        onThemeChange={onThemeChange}
        onSetRecentsCap={(): void => undefined}
      />,
    );
  });
  // The theme select lives in the Appearance panel (it moved out of
  // General when that panel got its own content); the sheet opens on
  // General, so activate Appearance first.
  const appearanceBtn = host.querySelector<HTMLButtonElement>(
    '.preferences-sidebar [data-prefs-category="appearance"]',
  );
  expect(appearanceBtn).not.toBeNull();
  act((): void => {
    appearanceBtn?.click();
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

describe("Preferences theme dropdown applies immediately", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("changing the dropdown fires onThemeChange with the picked value", () => {
    const { host, onThemeChange, unmount } = mountPrefs("dark");
    pickThemeOption(host, "frosted");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("frosted");
    unmount();
  });

  it("fires on the change event itself — no Save click, dialog stays open", () => {
    const { host, onThemeChange, onClose, unmount } = mountPrefs("dark");
    pickThemeOption(host, "light");
    // The host flips the theme from onThemeChange; closing the sheet
    // (or requiring a Save) is part of the OLD behaviour this fixes.
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector("[data-prefs-dialog]")).not.toBeNull();
    expect(onThemeChange).toHaveBeenCalledWith("light");
    unmount();
  });

  it("still persists the default via onSetThemeDefault (both callbacks fire)", () => {
    const { host, onSetThemeDefault, onThemeChange, unmount } = mountPrefs("light");
    pickThemeOption(host, "system");
    expect(onSetThemeDefault).toHaveBeenCalledTimes(1);
    expect(onSetThemeDefault).toHaveBeenCalledWith("system");
    // Order: persist the default first, then apply — the persisted
    // object the host writes second already carries the new default.
    expect(
      onSetThemeDefault.mock.invocationCallOrder[0],
    ).toBeLessThan(onThemeChange.mock.invocationCallOrder[0]);
    unmount();
  });

  it("passes 'system' through verbatim (host resolves the concrete theme)", () => {
    const { host, onThemeChange, unmount } = mountPrefs("dark");
    pickThemeOption(host, "system");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("system");
    unmount();
  });

  it("re-selecting the shown value still fires both callbacks", () => {
    const { host, onSetThemeDefault, onThemeChange, unmount } = mountPrefs("frosted");
    pickThemeOption(host, "frosted");
    expect(onSetThemeDefault).toHaveBeenCalledWith("frosted");
    expect(onThemeChange).toHaveBeenCalledWith("frosted");
    unmount();
  });

  it("accepts every option the dropdown offers", () => {
    const values: readonly ThemeDefault[] = ["light", "dark", "frosted", "system"];
    for (const value of values) {
      const { host, onThemeChange, unmount } = mountPrefs(
        value === "light" ? "dark" : "light",
      );
      pickThemeOption(host, value);
      expect(onThemeChange).toHaveBeenCalledWith(value);
      unmount();
    }
  });
});