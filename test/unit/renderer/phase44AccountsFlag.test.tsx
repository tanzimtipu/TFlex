// @vitest-environment jsdom
//
// Phase 44 (item 1) — the feature flag. With `accountsEnabled` off, nothing
// account-related is reachable: the header renders no account control. With
// it on, the control appears and opens the surface. The App-level gate (the
// flag is re-read from settings on every render) is pinned by source scan.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppHeader,
  ACCOUNT_SIGNED_OUT_ACCESSIBLE_NAME,
  accountSignedInAccessibleName,
} from "../../../src/renderer/components/AppHeader";

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
});

function renderHeader(options: { onOpenAccounts?: () => void; signedIn?: boolean; email?: string | null } = {}): {
  container: HTMLElement;
  onOpenAccounts: ReturnType<typeof vi.fn>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenAccounts = vi.fn();
  act(() => {
    root.render(
      <AppHeader
        activeId={null}
        tabs={[]}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        theme="frosted"
        onThemeChange={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        onOpenPreferences={(): void => undefined}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        onOpenAccounts={options.onOpenAccounts === undefined ? undefined : onOpenAccounts}
        accountsSignedIn={options.signedIn ?? false}
        accountsEmail={options.email ?? null}
      />,
    );
  });
  mounted.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return { container, onOpenAccounts };
}

describe("Phase 44 item 1 — the accounts flag gates the top-bar control", () => {
  it("renders NO account control when the flag is off (prop not wired)", () => {
    const h = renderHeader();
    expect(h.container.querySelector("[data-header-accounts]")).toBeNull();
    expect(h.container.querySelector(".header-accounts")).toBeNull();
  });

  it("renders the control when the flag is on, and it opens the surface", () => {
    const h = renderHeader({ onOpenAccounts: (): void => undefined });
    const button = h.container.querySelector<HTMLButtonElement>("[data-header-accounts]");
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(h.onOpenAccounts).toHaveBeenCalledTimes(1);
  });

  it("labels the control by signed-in state (distinct accessible names)", () => {
    const out = renderHeader({ onOpenAccounts: (): void => undefined });
    expect(out.container.querySelector("[data-header-accounts]")?.getAttribute("aria-label")).toBe(
      ACCOUNT_SIGNED_OUT_ACCESSIBLE_NAME,
    );

    const inSession = renderHeader({
      onOpenAccounts: (): void => undefined,
      signedIn: true,
      email: "ada@example.com",
    });
    const button = inSession.container.querySelector("[data-header-accounts='signed-in']");
    expect(button?.getAttribute("aria-label")).toBe(accountSignedInAccessibleName("ada@example.com"));
    expect(button?.getAttribute("aria-label")).toContain("ada@example.com");
    expect(button?.getAttribute("aria-label")).not.toBe(ACCOUNT_SIGNED_OUT_ACCESSIBLE_NAME);
  });

  it("App gates BOTH the control and the dialog on settings.accountsEnabled (source scan)", () => {
    const app = readFileSync(resolve(process.cwd(), "src/renderer/App.tsx"), "utf8");
    expect(app).toContain("settings.accountsEnabled === true ? (): void => setAccountsOpen(true) : undefined");
    expect(app).toContain("open={settings.accountsEnabled === true && accountsOpen}");
  });

  it("no account entry exists in the command registry, so there is no palette row", () => {
    const registry = readFileSync(resolve(process.cwd(), "src/renderer/state/toolsRegistry.ts"), "utf8");
    expect(registry.toLowerCase()).not.toContain("account");
  });

  it("the icon guard sweep covers the new header + dialog glyphs (all unique)", () => {
    const header = readFileSync(resolve(process.cwd(), "src/renderer/components/AppHeader.tsx"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/renderer/components/AccountsDialog.tsx"), "utf8");
    const registry = readFileSync(resolve(process.cwd(), "src/renderer/state/toolsRegistry.ts"), "utf8");
    const NEW_GLYPHS = ["UserRound", "UserPlus", "LogOut", "RefreshCcw", "ArrowLeft"];
    expect(header).toContain("UserRound");
    expect(dialog).toContain("UserPlus");
    expect(dialog).toContain("LogOut");
    expect(dialog).toContain("RefreshCcw");
    // None of the new glyphs leaks into the registry (a different action).
    for (const glyph of NEW_GLYPHS) {
      expect(registry, glyph).not.toMatch(new RegExp(`${glyph}(?![A-Za-z])`));
    }
  });
});
