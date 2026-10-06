// @vitest-environment jsdom
//
// Phase 44 (operator amendment) — the account section is gated by the internal
// `accountsEnabled` escape hatch. The App builds the whole `<AccountMenu>` and
// passes it to AppHeader as a slot; with the hatch off the slot is null and no
// account surface is rendered. Accounts are ON by default.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader } from "../../../src/renderer/components/AppHeader";

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
});

function renderHeader(accountSlot?: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <AppHeader
        activeId={null}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        accountSlot={accountSlot}
      />,
    );
  });
  mounted.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

describe("Phase 44 — the accounts escape hatch gates the top-bar section", () => {
  it("renders NO account section when no slot is passed (hatch off)", () => {
    const container = renderHeader();
    expect(container.querySelector("[data-header-accounts]")).toBeNull();
    expect(container.querySelector(".account-menu-wrap")).toBeNull();
  });

  it("renders the account slot when the hatch is on", () => {
    const container = renderHeader(<span data-test-account-slot />);
    expect(container.querySelector("[data-test-account-slot]")).not.toBeNull();
  });

  it("App builds the AccountMenu only while settings.accountsEnabled is true (source scan)", () => {
    const app = readFileSync(resolve(process.cwd(), "src/renderer/App.tsx"), "utf8");
    expect(app).toContain("accountSlot={settings.accountsEnabled === true ? (");
    expect(app).toContain("<AccountMenu");
    expect(app).toContain("open={settings.accountsEnabled === true && accountsOpen}");
  });

  it("no account entry exists in the command registry, so there is no palette row", () => {
    const registry = readFileSync(resolve(process.cwd(), "src/renderer/state/toolsRegistry.ts"), "utf8");
    expect(registry.toLowerCase()).not.toContain("account");
  });

  it("the icon guard sweep covers the account glyphs (all unique / allow-listed)", () => {
    const header = readFileSync(resolve(process.cwd(), "src/renderer/components/AppHeader.tsx"), "utf8");
    const menu = readFileSync(resolve(process.cwd(), "src/renderer/components/AccountMenu.tsx"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/renderer/components/AccountsDialog.tsx"), "utf8");
    const registry = readFileSync(resolve(process.cwd(), "src/renderer/state/toolsRegistry.ts"), "utf8");
    // The old header glyph is gone; the menu owns the account glyphs.
    expect(header).not.toContain("UserRound");
    for (const glyph of ["UserRound", "UserCog", "LogOut", "RefreshCcw"]) {
      expect(menu, glyph).toContain(glyph);
      expect(registry, glyph).not.toMatch(new RegExp(`${glyph}(?![A-Za-z])`));
    }
    // The signed-in dialog still owns its own sign-out/sync glyphs.
    expect(dialog).toContain("LogOut");
    expect(dialog).toContain("RefreshCcw");
  });
});
