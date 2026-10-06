// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave E2: menus and context menus.
//
// Pins the wave-E2 call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the canonical
// class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the shipped
// classes / ARIA the primitive emits; no behaviour (label, handler, data-* hook,
// role, aria state, disabled predicate) is re-derived here.
//
// DELIBERATE EXCEPTION — the top-bar account avatar (`[data-account-avatar]` in
// AccountMenu.tsx) is a `motion.button` whose press feedback is the
// framer-motion `useScaleAnimation` gesture, pinned by
// phase44_avatarIdentity.test.ts (source + stylesheet scan). It keeps its native
// markup and is asserted here as the documented wave-E2 surface exception.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import {
  usePageThumbMenu,
  type PageMenuHandlers,
} from "../../../src/renderer/components/pageThumbMenu";
import { AccountMenu } from "../../../src/renderer/components/AccountMenu";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import type { AccountUser } from "../../../src/shared/accounts";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function cls(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

function click(target: Element | null): void {
  if (target === null) throw new Error("expected clickable element");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  // The annotation menu portals to document.body; clear any leftovers.
  document.body.innerHTML = "";
});

function makePageHandlers(): PageMenuHandlers {
  return {
    onRotateCw: NOOP,
    onRotateCcw: NOOP,
    onExtract: NOOP,
    onInsertBlank: NOOP,
    onReplace: NOOP,
    onDeletePage: NOOP,
  };
}

let capturedOpen: ((page: number, x: number, y: number) => void) | null = null;

function Harness({ handlers }: { handlers: PageMenuHandlers }): ReactElement {
  const { openMenu, menuNode } = usePageThumbMenu(handlers);
  capturedOpen = openMenu;
  return <div data-host>{menuNode}</div>;
}

function renderPageMenu(): HTMLElement {
  capturedOpen = null;
  const host = mount(<Harness handlers={makePageHandlers()} />);
  act((): void => {
    capturedOpen?.(3, 120, 90);
  });
  return host;
}

describe("Phase 113 — CommandMenu / context-menu rows", () => {
  it("renders the page context rows as canonical secondary compact actions", () => {
    const host = renderPageMenu();
    const rotate = host.querySelector('[data-menu-item="rotate-cw"]');
    expect(rotate).not.toBeNull();
    expect(cls(rotate)).toContain("btn");
    expect(cls(rotate)).toContain("btn-secondary");
    expect(cls(rotate)).toContain("btn-compact");
    expect(cls(rotate)).toContain("titlebar-menu-row");
    expect(cls(rotate)).toContain("context-menu-item");
    expect(rotate?.getAttribute("role")).toBe("menuitem");
  });

  it("renders Delete on the destructive intent while keeping its legacy hooks", () => {
    const host = renderPageMenu();
    const del = host.querySelector('[data-menu-item="delete"]');
    expect(cls(del)).toContain("btn");
    expect(cls(del)).toContain("btn-danger");
    expect(cls(del)).toContain("btn-compact");
    expect(cls(del)).toContain("command-menu-row-danger");
    expect(cls(del)).toContain("context-menu-item-danger");
    expect(del?.getAttribute("data-menu-variant")).toBe("danger");
  });
});

function renderAccount(signedIn: boolean): HTMLElement {
  const user: AccountUser = {
    id: "u1",
    email: "ada@example.com",
    emailVerified: true,
    name: "Ada Lovelace",
  };
  return mount(
    <AccountMenu
      signedIn={signedIn}
      user={signedIn ? user : null}
      onOpenSignIn={NOOP}
      onSignedOut={NOOP}
      onProfileUpdated={NOOP}
    />,
  );
}

describe("Phase 113 — AccountMenu call sites", () => {
  it("renders the signed-out entry as a canonical secondary action", () => {
    const host = renderAccount(false);
    const entry = host.querySelector('[data-header-accounts="signed-out"]');
    expect(cls(entry)).toContain("btn");
    expect(cls(entry)).toContain("btn-secondary");
    expect(cls(entry)).toContain("header-accounts");
    expect(cls(entry)).toContain("account-signin");
    expect(entry?.getAttribute("aria-label")).toBe("Sign in or create an account");
  });

  it("keeps the avatar native with its disclosure state (documented exception)", () => {
    const host = renderAccount(true);
    const avatar = host.querySelector("[data-account-avatar]");
    expect(avatar).not.toBeNull();
    expect(cls(avatar)).toContain("account-avatar");
    expect(cls(avatar)).not.toContain("btn");
    expect(avatar?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the three panel actions as canonical secondary menu rows", () => {
    const host = renderAccount(true);
    click(host.querySelector("[data-account-avatar]"));
    for (const sel of [
      "[data-account-update-profile]",
      "[data-account-sync-now]",
      "[data-account-signout]",
    ]) {
      const row = host.querySelector(sel);
      expect(cls(row), sel).toContain("btn");
      expect(cls(row), sel).toContain("btn-secondary");
      expect(cls(row), sel).toContain("account-panel-action");
      expect(row?.getAttribute("role"), sel).toBe("menuitem");
    }
  });
});

function renderAnnotationToolbar(): HTMLElement {
  return mount(
    <AnnotationToolbar
      state={{ tool: "ink", color: "yellow", penWidth: 3 }}
      onAction={NOOP}
      annotationRecentTools={[]}
      onAnnotationRecentToolsChange={NOOP}
      editModeOpen={false}
    />,
  );
}

function openAnnotationMenu(host: HTMLElement): HTMLElement {
  click(host.querySelector("[data-ann-dropdown-toggle]"));
  const menu = document.body.querySelector<HTMLElement>("[data-ann-dropdown-menu]");
  if (menu === null) throw new Error("annotation menu did not open");
  return menu;
}

describe("Phase 113 — AnnotationToolbar menu call sites", () => {
  it("renders the tool menu rows as canonical exclusive-selection compact actions", () => {
    const host = renderAnnotationToolbar();
    const menu = openAnnotationMenu(host);
    const row = menu.querySelector('[data-tool="highlight"]');
    expect(row).not.toBeNull();
    expect(cls(row)).toContain("btn");
    expect(cls(row)).toContain("btn-secondary");
    expect(cls(row)).toContain("btn-segmented-item");
    expect(cls(row)).toContain("btn-compact");
    expect(cls(row)).toContain("ann-tool-menu-row");
    expect(row?.getAttribute("role")).toBe("menuitemradio");
  });

  it("renders the Pen width toggle as a canonical secondary compact icon toggle", () => {
    const host = renderAnnotationToolbar();
    const menu = openAnnotationMenu(host);
    const pen = menu.querySelector('[data-pen-width="3"]');
    expect(pen).not.toBeNull();
    expect(cls(pen)).toContain("btn");
    expect(cls(pen)).toContain("btn-secondary");
    expect(cls(pen)).toContain("btn-icon");
    expect(cls(pen)).toContain("btn-toggle");
    expect(cls(pen)).toContain("btn-compact");
    expect(cls(pen)).toContain("ann-pen-swatch");
    expect(pen?.getAttribute("aria-pressed")).toBe("true");
  });
});

function bulk(): DockBulkActions {
  return { onRotate: NOOP, onExtract: NOOP, onDelete: NOOP };
}

function renderDock(options: Partial<ActionDockProps> = {}): HTMLElement {
  return mount(
    <ActionDock
      activeStage="pages"
      pageSelection={[]}
      onClearPageSelection={NOOP}
      bulk={bulk()}
      dockPins={[]}
      onPinTool={NOOP}
      onUnpinTool={NOOP}
      onRunTool={NOOP}
      canvasWidth={1400}
      {...options}
    />,
  );
}

describe("Phase 113 — ActionDock menu-row call sites", () => {
  it("renders an overflow row as a canonical secondary compact menu item", () => {
    const host = renderDock();
    click(host.querySelector("[data-dock-overflow]"));
    const row = host.querySelector("[data-dock-overflow-item]");
    expect(row).not.toBeNull();
    expect(cls(row)).toContain("btn");
    expect(cls(row)).toContain("btn-secondary");
    expect(cls(row)).toContain("btn-compact");
    expect(cls(row)).toContain("action-dock-menu-item");
  });

  it("renders the delete overflow row on the destructive intent", () => {
    const host = renderDock();
    click(host.querySelector("[data-dock-overflow]"));
    const del = host.querySelector('[data-dock-overflow-item="delete"]');
    expect(del).not.toBeNull();
    expect(cls(del)).toContain("btn-danger");
    expect(cls(del)).toContain("action-dock-menu-item");
  });
});