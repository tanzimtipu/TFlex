// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import type { MenuGroup } from "../../../src/renderer/components/TitleBar";

/**
 * Phase 30 — the title-bar Print affordance. Pins the placement
 * (immediately LEFT of the preferences gear, inside the trailing control
 * cluster) and that clicking it fires the `onPrint` prop (the same dialog
 * entry point as File > Print and Ctrl+P).
 *
 * DEF-271 — the button must mirror the Save As control's active-document
 * gate: disabled while the welcome screen (no active tab) is showing, and
 * enabled once a document is active.
 */
interface HeaderOptions {
  activeId?: string | null;
  onPrint?: () => void;
}

const APP_MENU_GROUPS: MenuGroup[] = [
  { id: "view", label: "View", entries: [{ id: "theme", label: "Toggle Theme", action: "toggleTheme" }] },
];

function renderHeader(opts: HeaderOptions = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={opts.activeId ?? null}
        appMenuGroups={APP_MENU_GROUPS}
        onPrint={opts.onPrint ?? ((): void => undefined)}
      />,
    );
  });
  return container;
}

describe("AppHeader — Print button (Phase 30)", () => {
  it("renders the Print button immediately left of the application menu", () => {
    const root = renderHeader();
    const actions = root.querySelector(".header-actions");
    expect(actions).not.toBeNull();
    const print = actions?.querySelector("[data-print]");
    const appMenu = actions?.querySelector("[data-app-menu]");
    expect(print).not.toBeNull();
    expect(appMenu).not.toBeNull();
    const children = Array.from(actions?.children ?? []);
    const appMenuWrap = actions?.querySelector(".app-menu");
    expect(children.indexOf(print as Element) + 1).toBe(children.indexOf(appMenuWrap as Element));
  });

  it("fires onPrint when clicked with an active document", () => {
    const onPrint = vi.fn();
    const root = renderHeader({ activeId: "tab-1", onPrint });
    const print = root.querySelector<HTMLButtonElement>("[data-print]");
    expect(print).not.toBeNull();
    expect(print?.disabled).toBe(false);
    act((): void => {
      print?.click();
    });
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("is disabled with no active document and does not fire onPrint (DEF-271)", () => {
    const onPrint = vi.fn();
    const root = renderHeader({ activeId: null, onPrint });
    const print = root.querySelector<HTMLButtonElement>("[data-print]");
    expect(print).not.toBeNull();
    expect(print?.disabled).toBe(true);
    act((): void => {
      print?.click();
    });
    expect(onPrint).not.toHaveBeenCalled();
  });

  it("exposes the shared header a11y contract", () => {
    const root = renderHeader();
    const print = root.querySelector<HTMLButtonElement>("[data-print]");
    expect(print?.getAttribute("aria-label")).toBe("Print");
    expect(print?.getAttribute("title")).toBe("Print (Ctrl+P)");
    expect(print?.getAttribute("aria-haspopup")).toBe("dialog");
  });
});