// @vitest-environment jsdom
//
// Preferences category navigation + General panel contract:
//
//   1. The sidebar renders the EIGHT category buttons in display
//      order; General is active by default.
//   2. Clicking another category activates it and swaps the panel to
//      the placeholder (no General sections, no theme select).
//   3. The General panel shows the four sections (Startup,
//      Confirmations, Recent files, Default handler) alongside the
//      pre-existing theme + storage controls.
//   4. Each General checkbox calls its callback with the new value.
//   5. While the host is not wired yet (no value/callback props),
//      the toggles stay interactive on in-dialog draft state.
//   6. The default-handler button calls onSetDefaultPdfHandler.
//   7. Reopening the sheet resets navigation to General.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";

interface MountOpts {
  open?: boolean;
  showWelcomeOnStartup?: boolean;
  confirmCloseMultipleTabs?: boolean;
  confirmDeletePages?: boolean;
  onSetShowWelcomeOnStartup?: (v: boolean) => void;
  onSetConfirmCloseMultipleTabs?: (v: boolean) => void;
  onSetConfirmDeletePages?: (v: boolean) => void;
  onSetDefaultPdfHandler?: () => void;
}

function mountPrefs(opts: MountOpts = {}): {
  host: HTMLElement;
  render: (open: boolean) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (open: boolean): void => {
    act((): void => {
      root.render(
        <PreferencesDialog
          open={open}
          onClose={(): void => undefined}
          themeDefault="dark"
          recentsCap={10}
          onSetThemeDefault={(): void => undefined}
          onThemeChange={(): void => undefined}
          onSetRecentsCap={(): void => undefined}
          showWelcomeOnStartup={opts.showWelcomeOnStartup}
          confirmCloseMultipleTabs={opts.confirmCloseMultipleTabs}
          confirmDeletePages={opts.confirmDeletePages}
          onSetShowWelcomeOnStartup={opts.onSetShowWelcomeOnStartup}
          onSetConfirmCloseMultipleTabs={opts.onSetConfirmCloseMultipleTabs}
          onSetConfirmDeletePages={opts.onSetConfirmDeletePages}
          onSetDefaultPdfHandler={opts.onSetDefaultPdfHandler}
        />,
      );
    });
  };
  render(opts.open ?? true);
  return {
    host,
    render,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function sidebarButton(host: HTMLElement, id: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`.preferences-sidebar [data-prefs-category="${id}"]`);
}

describe("Preferences category navigation + General panel", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("shows the eight category buttons in order, General active by default", () => {
    const { host, unmount } = mountPrefs();
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".preferences-sidebar button"),
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      "General",
      "Appearance",
      "Documents",
      "Export",
      "Edit",
      "OCR",
      "Signatures",
      "Storage",
    ]);
    const general = sidebarButton(host, "general");
    expect(general?.classList.contains("active")).toBe(true);
    expect(general?.getAttribute("aria-current")).toBe("true");
    expect(sidebarButton(host, "appearance")?.classList.contains("active")).toBe(false);
    unmount();
  });

  it("shows the General sections (Startup, Confirmations, Recent files, Default handler) plus the pre-existing controls", () => {
    const { host, unmount } = mountPrefs();
    const titles = Array.from(host.querySelectorAll(".preference-section h3")).map(
      (h) => h.textContent?.trim(),
    );
    expect(titles).toContain("Startup");
    expect(titles).toContain("Confirmations");
    expect(titles).toContain("Recent files");
    expect(titles).toContain("Default handler");
    // Pre-existing controls remain in the default view (the e2e
    // contract reads the theme select without any category click).
    expect(host.querySelector("[data-prefs-theme-default]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-recents-cap]")).not.toBeNull();
    expect(host.querySelectorAll(".prefs-path")).toHaveLength(3);
    // New General controls.
    expect(host.querySelector("[data-prefs-show-welcome]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-confirm-close-tabs]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-confirm-delete-pages]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-default-pdf-handler]")).not.toBeNull();
    unmount();
  });

  it("clicking another category activates it and swaps the panel to the placeholder", () => {
    const { host, unmount } = mountPrefs();
    const exportBtn = sidebarButton(host, "export");
    expect(exportBtn).not.toBeNull();
    act((): void => {
      exportBtn?.click();
    });
    expect(exportBtn?.classList.contains("active")).toBe(true);
    expect(sidebarButton(host, "general")?.classList.contains("active")).toBe(false);
    // The General panel is gone; the placeholder is shown.
    expect(host.querySelector(".preference-section")).toBeNull();
    expect(host.querySelector("[data-prefs-theme-default]")).toBeNull();
    expect(host.querySelector(".preferences-panel-empty")).not.toBeNull();
    unmount();
  });

  it("each General checkbox calls its callback with the new value", () => {
    const onSetWelcome = vi.fn((): void => undefined);
    const onSetCloseTabs = vi.fn((): void => undefined);
    const onSetDelete = vi.fn((): void => undefined);
    const { host, unmount } = mountPrefs({
      showWelcomeOnStartup: false,
      confirmCloseMultipleTabs: false,
      confirmDeletePages: false,
      onSetShowWelcomeOnStartup: onSetWelcome,
      onSetConfirmCloseMultipleTabs: onSetCloseTabs,
      onSetConfirmDeletePages: onSetDelete,
    });
    const welcome = host.querySelector<HTMLInputElement>("[data-prefs-show-welcome]");
    const closeTabs = host.querySelector<HTMLInputElement>("[data-prefs-confirm-close-tabs]");
    const del = host.querySelector<HTMLInputElement>("[data-prefs-confirm-delete-pages]");
    expect(welcome).not.toBeNull();
    expect(closeTabs).not.toBeNull();
    expect(del).not.toBeNull();
    act((): void => {
      welcome?.click();
    });
    expect(onSetWelcome).toHaveBeenCalledTimes(1);
    expect(onSetWelcome).toHaveBeenCalledWith(true);
    act((): void => {
      closeTabs?.click();
    });
    expect(onSetCloseTabs).toHaveBeenCalledWith(true);
    act((): void => {
      del?.click();
    });
    expect(onSetDelete).toHaveBeenCalledWith(true);
    unmount();
  });

  it("respects the values the host passes (checked states match)", () => {
    const { host, unmount } = mountPrefs({
      showWelcomeOnStartup: true,
      confirmCloseMultipleTabs: true,
      confirmDeletePages: false,
    });
    const welcome = host.querySelector<HTMLInputElement>("[data-prefs-show-welcome]");
    const closeTabs = host.querySelector<HTMLInputElement>("[data-prefs-confirm-close-tabs]");
    const del = host.querySelector<HTMLInputElement>("[data-prefs-confirm-delete-pages]");
    expect(welcome?.checked).toBe(true);
    expect(closeTabs?.checked).toBe(true);
    expect(del?.checked).toBe(false);
    unmount();
  });

  it("unwired toggles stay interactive on draft state (host not wired yet)", () => {
    const { host, unmount } = mountPrefs(); // no values, no callbacks
    const welcome = host.querySelector<HTMLInputElement>("[data-prefs-show-welcome]");
    expect(welcome).not.toBeNull();
    if (welcome === null) return;
    act((): void => {
      welcome.click();
    });
    expect(welcome.checked).toBe(true);
    act((): void => {
      welcome.click();
    });
    expect(welcome.checked).toBe(false);
    unmount();
  });

  it("the default handler button calls onSetDefaultPdfHandler", () => {
    const onSetDefault = vi.fn((): void => undefined);
    const { host, unmount } = mountPrefs({ onSetDefaultPdfHandler: onSetDefault });
    const btn = host.querySelector<HTMLButtonElement>("[data-prefs-default-pdf-handler]");
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe("Set TFlex as default PDF application");
    act((): void => {
      btn?.click();
    });
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("reopening the sheet resets the active category to General", () => {
    const { host, render, unmount } = mountPrefs();
    const exportBtn = sidebarButton(host, "export");
    act((): void => {
      exportBtn?.click();
    });
    expect(exportBtn?.classList.contains("active")).toBe(true);
    render(false);
    render(true);
    expect(sidebarButton(host, "general")?.classList.contains("active")).toBe(true);
    expect(sidebarButton(host, "export")?.classList.contains("active")).toBe(false);
    expect(host.querySelector("[data-prefs-theme-default]")).not.toBeNull();
    unmount();
  });
});