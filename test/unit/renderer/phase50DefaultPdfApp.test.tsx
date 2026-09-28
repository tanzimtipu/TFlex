// @vitest-environment jsdom
//
// Phase 50 (feature B) - the "Make Jovrel the default PDF app" affordance in
// Preferences. It opens Windows' Default-apps settings through
// `app:openDefaultAppsSettings`; it must state WHY (an installer cannot set the
// default silently) and must NEVER claim the app changed the default itself.
// The three bridge outcomes (ok / failed / rejected) and a missing bridge all
// surface honestly, and the affordance never throws.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";

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

function setApp(app: Record<string, unknown> | undefined): void {
  (window as unknown as { tflex?: unknown }).tflex =
    app === undefined ? undefined : { app };
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

describe("Phase 50 - the default PDF app affordance", () => {
  it("renders the action and explains WHY, without claiming the app changed the default", () => {
    const { host, unmount } = mountPrefs();
    const button = host.querySelector<HTMLElement>("[data-prefs-default-pdf]");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Make Jovrel the default PDF app");
    const copy = host.textContent ?? "";
    expect(copy).toContain("Windows does not let an installer change the default PDF handler silently");
    expect(copy).toContain("Jovrel icon and type name");
    expect(copy).not.toContain("Jovrel is now the default");
    expect(copy).not.toContain("changed the default for you");
    unmount();
  });

  it("calls openDefaultAppsSettings once and reports the settings opened (not a default change)", async () => {
    const openDefaultAppsSettings = vi.fn(async () => ({ ok: true }));
    setApp({ getInfo: vi.fn(async () => ({ storagePaths: {} })), openDefaultAppsSettings });
    const { host, unmount } = mountPrefs();
    await click(host.querySelector<HTMLElement>("[data-prefs-default-pdf]")!);

    expect(openDefaultAppsSettings).toHaveBeenCalledTimes(1);
    const status = host.querySelector<HTMLElement>("[data-prefs-default-pdf-status]");
    expect(status?.textContent).toContain("Choose Jovrel there");
    expect(status?.textContent?.toLowerCase()).not.toContain("default is now");
    unmount();
  });

  it("a failed OS call surfaces an honest, non-blocking message", async () => {
    const openDefaultAppsSettings = vi.fn(async () => ({ ok: false, reason: "failed" }));
    setApp({ openDefaultAppsSettings });
    const { host, unmount } = mountPrefs();
    await click(host.querySelector<HTMLElement>("[data-prefs-default-pdf]")!);

    const status = host.querySelector<HTMLElement>("[data-prefs-default-pdf-status]");
    expect(status?.textContent).toContain("could not be opened");
    expect(status?.textContent).not.toContain("Choose Jovrel there");
    // Still usable: the button is present for a retry.
    expect(host.querySelector("[data-prefs-default-pdf]")).not.toBeNull();
    unmount();
  });

  it("a rejected call does not throw and reports the same honest failure", async () => {
    const openDefaultAppsSettings = vi.fn(async () => {
      throw new Error("openExternal rejected");
    });
    setApp({ openDefaultAppsSettings });
    const { host, unmount } = mountPrefs();
    await click(host.querySelector<HTMLElement>("[data-prefs-default-pdf]")!);

    expect(host.querySelector<HTMLElement>("[data-prefs-default-pdf-status]")?.textContent).toContain(
      "could not be opened",
    );
    unmount();
  });

  it("a build without the bridge says so instead of throwing", async () => {
    setApp({ getInfo: vi.fn(async () => ({ storagePaths: {} })) });
    const { host, unmount } = mountPrefs();
    await click(host.querySelector<HTMLElement>("[data-prefs-default-pdf]")!);
    expect(host.querySelector<HTMLElement>("[data-prefs-default-pdf-status]")?.textContent).toContain(
      "cannot open Windows' Default-apps settings",
    );
    unmount();
  });
});
