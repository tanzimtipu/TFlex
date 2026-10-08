// @vitest-environment jsdom
//
// Phase 114 (TFL-1253, chunk D) — the Documents and Storage categories
// migrated onto the Settings Studio primitives.
//
// Pins the migrated shape without weakening the shipped behaviour:
//   - Documents keeps `data-prefs-default-pdf-section`, the honest
//     default-PDF-app button (`data-prefs-default-pdf`) and the conditional
//     `role="status"` outcome line (`data-prefs-default-pdf-status`); the
//     button still calls `app:openDefaultAppsSettings`.
//   - Storage stays a three-location browser (`.prefs-path`), each button still
//     calling `app.openPath` with its own `userData` / `settings` / `signatures`
//     path; no metrics or cleanup.
//   - Both panels stay inside their `[data-prefs-panel="documents"]` /
//     `[data-prefs-panel="storage"]` containers.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";

const STORAGE_PATHS = {
  userData: "C:/Jovrel/userData",
  settings: "C:/Jovrel/settings.json",
  signatures: "C:/Jovrel/signatures",
  cache: "C:/Jovrel/cache",
};

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  openPath: ReturnType<typeof vi.fn>;
  openDefaultAppsSettings: ReturnType<typeof vi.fn>;
}

function mount(): Mount {
  const openPath = vi.fn(async (): Promise<void> => undefined);
  const openDefaultAppsSettings = vi.fn(async () => ({ ok: true }));
  const getInfo = vi.fn(async () => ({ storagePaths: STORAGE_PATHS }));
  (window as unknown as { tflex?: unknown }).tflex = {
    app: { getInfo, openPath, openDefaultAppsSettings },
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={vi.fn((): void => undefined)}
        themeDefault="dark"
        recentsCap={10}
        onSetThemeDefault={vi.fn((): void => undefined)}
        onThemeChange={vi.fn((): void => undefined)}
        onSetRecentsCap={vi.fn((): void => undefined)}
        animationsEnabled
        onSetAnimationsEnabled={vi.fn((): void => undefined)}
        convertDefaults={DEFAULT_CONVERT_DEFAULTS}
        onSetConvertDefaults={vi.fn((): void => undefined)}
        tabStyle="colorful"
        onSetTabStyle={vi.fn((): void => undefined)}
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
    openPath,
    openDefaultAppsSettings,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

afterEach((): void => {
  delete (window as unknown as { tflex?: unknown }).tflex;
  document.body.innerHTML = "";
});

describe("Settings Studio — Documents and Storage migration (chunk D)", () => {
  it("Documents: the section hook and the default-PDF-app button keep their panel", async () => {
    const { host, unmount, openDefaultAppsSettings } = mount();
    const panel = host.querySelector('[data-prefs-panel="documents"]');
    const section = panel?.querySelector("[data-prefs-default-pdf-section]");
    expect(section).not.toBeNull();
    const button = section?.querySelector<HTMLButtonElement>("[data-prefs-default-pdf]");
    expect(button?.textContent).toContain("Make Jovrel the default PDF app");

    await click(button!);
    expect(openDefaultAppsSettings).toHaveBeenCalledTimes(1);
    const status = section?.querySelector<HTMLElement>("[data-prefs-default-pdf-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe("Windows' Default-apps settings are open. Choose Jovrel there.");
    unmount();
  });

  it("Documents: the status line is absent until the action is taken", () => {
    const { host, unmount } = mount();
    expect(host.querySelector("[data-prefs-default-pdf-status]")).toBeNull();
    unmount();
  });

  it("Storage: exactly three location buttons inside the storage panel", async () => {
    const { host, unmount } = mount();
    await flush();
    const panel = host.querySelector('[data-prefs-panel="storage"]');
    expect(panel).not.toBeNull();
    const buttons = Array.from(panel!.querySelectorAll<HTMLButtonElement>(".prefs-path"));
    expect(buttons.length).toBe(3);
    const labels = buttons.map(
      (b): string => b.querySelector(".prefs-path-label")?.textContent ?? "",
    );
    expect(labels).toEqual(["User data", "Settings file", "Saved signatures"]);
    expect(buttons.map((b): string => b.title)).toEqual([
      STORAGE_PATHS.userData,
      STORAGE_PATHS.settings,
      STORAGE_PATHS.signatures,
    ]);
    unmount();
  });

  it("Storage: each location button opens its own path through the bridge", async () => {
    const { host, unmount, openPath } = mount();
    await flush();
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-prefs-panel="storage"] .prefs-path'),
    );
    expect(buttons.length).toBe(3);

    await click(buttons[0]!);
    expect(openPath).toHaveBeenLastCalledWith(STORAGE_PATHS.userData);
    await click(buttons[1]!);
    expect(openPath).toHaveBeenLastCalledWith(STORAGE_PATHS.settings);
    await click(buttons[2]!);
    expect(openPath).toHaveBeenLastCalledWith(STORAGE_PATHS.signatures);
    expect(openPath).toHaveBeenCalledTimes(3);
    unmount();
  });
});
