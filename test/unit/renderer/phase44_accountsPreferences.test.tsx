// @vitest-environment jsdom
//
// Phase 44 (operator amendment) — the Accounts (beta) Preferences row is GONE.
//
// Accounts are simply ON now: there is no Preferences switch. The internal
// `accountsEnabled` setting still exists (default true, explicit false
// preserved) as an escape hatch, so the renderer fallback still mirrors the
// main-process default. This suite pins BOTH facts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";

afterEach((): void => {
  document.body.innerHTML = "";
});

function mountPrefs(): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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
        animationsEnabled
        onSetAnimationsEnabled={vi.fn()}
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

describe("PreferencesDialog — no Accounts (beta) row", () => {
  it("renders no accounts switch and no beta label", () => {
    const { host, unmount } = mountPrefs();
    expect(host.querySelector("[data-prefs-accounts]")).toBeNull();
    expect(host.textContent).not.toContain("Accounts (beta)");
    expect(host.textContent).not.toContain("Accounts");
    unmount();
  });

  it("still renders the appearance and recent-files sections", () => {
    const { host, unmount } = mountPrefs();
    expect(host.querySelector("[data-prefs-animations]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-recents-cap]")).not.toBeNull();
    unmount();
  });
});

describe("renderer fallback defaults parity", () => {
  it("DEFAULT_SETTINGS.accountsEnabled mirrors the main-process default (true)", () => {
    expect(DEFAULT_SETTINGS.accountsEnabled).toBe(true);
  });
});
