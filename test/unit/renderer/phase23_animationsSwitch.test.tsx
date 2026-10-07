// @vitest-environment jsdom
//
// Phase 23 — the Animations off switch.
//
//   a. the effective-motion resolver matrix: setting x OS preference
//      (OS reduced wins even when the setting is ON; setting OFF + OS
//      normal is instant).
//   b. the motion hooks take the instant branch from the SETTING (not
//      just the OS preference).
//   c. the Preferences control reflects the stored value, fires the
//      callback on toggle and carries the explanatory hint.
//   d. the reducer action materialises / preserves the field.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  getAnimationsEnabled,
  resolveMotionMode,
  setAnimationsEnabledPreference,
} from "../../../src/renderer/hooks/motionPolicy";
import { useBloomAnimation } from "../../../src/renderer/hooks/useAnimations";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import { preferencesReducer } from "../../../src/renderer/state/preferences";
import type { AppSettings } from "../../../src/shared/types";

afterEach((): void => {
  setAnimationsEnabledPreference(true);
  document.body.innerHTML = "";
});

describe("resolveMotionMode (Phase 23 matrix)", () => {
  it("setting ON + OS normal -> animated", () => {
    expect(resolveMotionMode({ animationsEnabled: true, prefersReduced: false })).toBe("animated");
  });

  it("setting ON + OS reduced -> instant (the OS preference wins)", () => {
    expect(resolveMotionMode({ animationsEnabled: true, prefersReduced: true })).toBe("instant");
  });

  it("setting OFF + OS normal -> instant", () => {
    expect(resolveMotionMode({ animationsEnabled: false, prefersReduced: false })).toBe("instant");
  });

  it("setting OFF + OS reduced -> instant", () => {
    expect(resolveMotionMode({ animationsEnabled: false, prefersReduced: true })).toBe("instant");
  });
});

describe("motion hooks honour the Animations setting", () => {
  it("collapses to the opacity-only zero-duration branch when the setting is OFF", () => {
    setAnimationsEnabledPreference(false);
    const box: { variants: ReturnType<typeof useBloomAnimation> | null } = { variants: null };
    function Probe(): null {
      box.variants = useBloomAnimation();
      return null;
    }
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act((): void => {
      root.render(<Probe />);
    });
    expect(getAnimationsEnabled()).toBe(false);
    expect(box.variants?.initial).toEqual({ opacity: 0 });
    expect(box.variants?.animate.transition).toEqual({ duration: 0, ease: "linear" });
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

function mountPrefs(
  animationsEnabled: boolean,
): { host: HTMLElement; onSetAnimationsEnabled: ReturnType<typeof vi.fn>; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetAnimationsEnabled = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={vi.fn()}
        themeDefault="dark"
        recentsCap={10}
        onSetThemeDefault={vi.fn()}
        onThemeChange={vi.fn()}
        onSetRecentsCap={vi.fn()}
        animationsEnabled={animationsEnabled}
        onSetAnimationsEnabled={onSetAnimationsEnabled}
      />,
    );
  });
  return {
    host,
    onSetAnimationsEnabled,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("PreferencesDialog Animations control", () => {
  it("renders the stored value and the explanatory hint", () => {
    const off = mountPrefs(false);
    const box = off.host.querySelector<HTMLInputElement>("[data-prefs-animations]");
    expect(box).not.toBeNull();
    expect(box?.checked).toBe(false);
    expect(off.host.textContent).toContain("menus, panels, dialogs and page changes appear without transition animations");
    off.unmount();

    const on = mountPrefs(true);
    const boxOn = on.host.querySelector<HTMLInputElement>("[data-prefs-animations]");
    expect(boxOn?.checked).toBe(true);
    on.unmount();
  });

  it("fires onSetAnimationsEnabled with the toggled value", () => {
    const { host, onSetAnimationsEnabled, unmount } = mountPrefs(true);
    const box = host.querySelector<HTMLInputElement>("[data-prefs-animations]");
    expect(box).not.toBeNull();
    act((): void => {
      box?.click();
    });
    expect(onSetAnimationsEnabled).toHaveBeenCalledTimes(1);
    expect(onSetAnimationsEnabled).toHaveBeenCalledWith(false);
    unmount();
  });
});

describe("preferencesReducer set-animations-enabled", () => {
  const base: AppSettings = {
    theme: "dark",
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
  };

  it("materialises the field on the first OFF write", () => {
    const next = preferencesReducer({ ...base }, { type: "set-animations-enabled", value: false });
    expect(next.animationsEnabled).toBe(false);
    expect(next).not.toBe(base);
  });

  it("no-ops when the value already matches (undefined counts as ON)", () => {
    const state: AppSettings = { ...base };
    expect(preferencesReducer(state, { type: "set-animations-enabled", value: true })).toBe(state);
    const off: AppSettings = { ...base, animationsEnabled: false };
    expect(preferencesReducer(off, { type: "set-animations-enabled", value: false })).toBe(off);
  });

  it("turns back on", () => {
    const next = preferencesReducer(
      { ...base, animationsEnabled: false },
      { type: "set-animations-enabled", value: true },
    );
    expect(next.animationsEnabled).toBe(true);
  });
});
