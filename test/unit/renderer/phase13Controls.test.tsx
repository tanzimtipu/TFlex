// @vitest-environment jsdom
// Phase 13 — borderless window polish: control contract tests.
//
// Phase 13 turns the app chrome icon-only and adds three new
// controls. This suite pins the promises each control makes:
//
//   1. AppHeader Settings gear — renders [data-open-preferences],
//      announces itself ("Open preferences"), and opens the
//      Preferences sheet by firing the host callback on click.
//   2. Toolbar — every action is ICON-ONLY: no .tool-btn-label
//      spans anywhere, and every button carries BOTH aria-label and
//      title (the shared a11y contract for icon-only chrome, so the
//      no-op sweep can always name a control).
//   3. Toolbar Rotate CCW — renders only when wired and fires the
//      counter-clockwise callback (mirrors the cw button).
//   4. Toolbar Hand (pan) toggle — reflects handActive through
//      aria-pressed / data-hand-active and fires onHandToggle.
//
// (The Phase 10 EditToolbar this suite also covered was RETIRED in
//  Phase 41 item 2 — its controls live in the EDIT dock / panel now.)

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import type { MenuGroup } from "../../../src/renderer/components/TitleBar";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";
import { Toolbar } from "../../../src/renderer/components/Toolbar";
import type { ZoomMode } from "../../../src/renderer/state/zoom";

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function unmount(host: HTMLElement): void {
  host.remove();
}

const NOOP = (): void => undefined;

function noopContext(): MenuActionContext {
  return {
    open: NOOP,
    merge: NOOP,
    save: NOOP,
    saveAs: NOOP,
    closeTab: NOOP,
    undo: NOOP,
    redo: NOOP,
    toggleTheme: NOOP,
    showToolsPalette: NOOP,
    about: NOOP,
    preferences: NOOP,
    optimize: NOOP,
    auditSpace: NOOP,
    createFromImages: NOOP,
    exportPages: NOOP,
    exportText: NOOP,
    exportDocx: NOOP,
    insertPages: NOOP,
    recognizeText: NOOP,
    checkForUpdate: NOOP,
  };
}

// Phase 105 (chunk C) — the Settings command moved from the title-row gear into
// the application menu. The Edit group carries the same `preferences` row.
const APP_MENU_GROUPS: MenuGroup[] = [
  {
    id: "edit",
    label: "Edit",
    entries: [{ id: "prefs", label: "Preferences...", accelerator: "Ctrl+,", action: "preferences" }],
  },
];

function mountHeader(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}): HTMLElement {
  return mount(
    <AppHeader
      activeId={null}
      appMenuGroups={APP_MENU_GROUPS}
      menuContext={noopContext()}
      {...overrides}
    />,
  );
}

describe("Phase 13 — AppHeader application menu carries the Settings command", () => {
  it("renders the application-menu trigger with an accessible name", () => {
    const host = mountHeader();
    const trigger = host.querySelector<HTMLButtonElement>("[data-app-menu]");
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")).toBe("Application menu");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    unmount(host);
  });

  it("choosing Preferences in the menu fires menuContext.preferences", () => {
    const ctx = noopContext();
    const preferences = vi.spyOn(ctx, "preferences");
    const host = mountHeader({ menuContext: ctx });
    const trigger = host.querySelector<HTMLButtonElement>("[data-app-menu]");
    expect(trigger).not.toBeNull();
    act((): void => {
      trigger?.click();
    });
    const row = host.querySelector<HTMLButtonElement>("[data-menu-action='preferences']");
    expect(row).not.toBeNull();
    act((): void => {
      row?.click();
    });
    expect(preferences).toHaveBeenCalledTimes(1);
    unmount(host);
  });
});

function mountToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}): HTMLElement {
  return mount(
    <Toolbar
      page={1}
      pageCount={12}
      zoomPercent={120}
      zoomMode={"fit-width" as ZoomMode}
      onJump={NOOP}
      onZoomIn={NOOP}
      onZoomOut={NOOP}
      onFitWidth={NOOP}
      onFitPage={NOOP}
      searchOpen={false}
      onToggleSearch={NOOP}
      onMerge={NOOP}
      onSplit={NOOP}
      signToolActive={false}
      onSignClick={NOOP}
      hasFormFields={false}
      onFlattenClick={NOOP}
      onOptimize={NOOP}
      onAuditSpace={NOOP}
      handActive={false}
      {...overrides}
    />,
  );
}

describe("Phase 13 — Toolbar is icon-only", () => {
  it("renders no text labels — zero .tool-btn-label / .tool-btn-with-label nodes", () => {
    const host = mountToolbar({ onRotateClockwise: NOOP, onRotateCounterClockwise: NOOP, onDeletePage: NOOP });
    expect(host.querySelectorAll(".tool-btn-label").length).toBe(0);
    expect(host.querySelectorAll(".tool-btn-with-label").length).toBe(0);
    // Sanity: the toolbar still renders its buttons.
    expect(host.querySelectorAll("button.tool-btn").length).toBeGreaterThan(8);
    unmount(host);
  });

  it("every rendered toolbar button carries aria-label AND title (icon-only a11y contract)", () => {
    const host = mountToolbar({ onRotateClockwise: NOOP, onRotateCounterClockwise: NOOP, onDeletePage: NOOP });
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button.tool-btn"));
    expect(buttons.length).toBeGreaterThan(8);
    for (const btn of buttons) {
      // The page-input sits beside the buttons; only <button> nodes
      // are part of this contract.
      expect(btn.getAttribute("aria-label"), `aria-label on ${btn.outerHTML.slice(0, 80)}`).toBeTruthy();
      expect(btn.getAttribute("title")).toBeTruthy();
      // The accessible name must also be visible to pointer users
      // via the tooltip — title never contradicts aria-label.
      expect(btn.getAttribute("aria-label")).not.toBe("");
    }
    unmount(host);
  });

  it("the Tools palette toggle has moved off the toolbar to the page-view badge", () => {
    // The floating badge (data-tools-badge, also keeping the stable
    // data-tools-toggle e2e hook) now lives in DocumentView on the
    // page view's right edge — the command bar no longer hosts it.
    const host = mountToolbar();
    expect(host.querySelector("[data-tools-toggle]")).toBeNull();
    expect(host.querySelector("[data-tools-badge]")).toBeNull();
    unmount(host);
  });

  it("Rotate CCW renders only when wired and fires the counter-clockwise callback", () => {
    const onRotateCounterClockwise = vi.fn();
    // Not wired: no button (same opt-in contract as Rotate CW).
    {
      const host = mountToolbar({});
      expect(host.querySelector("[data-toolbar-rotate-ccw]")).toBeNull();
      unmount(host);
    }
    // Wired: clicking fires the handler.
    {
      const host = mountToolbar({ onRotateCounterClockwise });
      const ccw = host.querySelector<HTMLButtonElement>("[data-toolbar-rotate-ccw]");
      expect(ccw).not.toBeNull();
      expect(ccw?.getAttribute("aria-label")).toBe("Rotate counter-clockwise");
      act((): void => {
        ccw?.click();
      });
      expect(onRotateCounterClockwise).toHaveBeenCalledTimes(1);
      unmount(host);
    }
  });

  it("the Hand (pan) toggle reflects armed state and fires onHandToggle", () => {
    const onHandToggle = vi.fn();
    const host = mountToolbar({ handActive: false, onHandToggle });
    const hand = host.querySelector<HTMLButtonElement>("[data-hand-toggle]");
    expect(hand).not.toBeNull();
    expect(hand?.getAttribute("aria-pressed")).toBe("false");
    expect(hand?.getAttribute("data-hand-active")).toBe("false");
    act((): void => {
      hand?.click();
    });
    expect(onHandToggle).toHaveBeenCalledTimes(1);
    unmount(host);

    // Armed render: pressed=true + active treatment.
    const armed = mountToolbar({ handActive: true, onHandToggle: vi.fn() });
    const handArmed = armed.querySelector<HTMLButtonElement>("[data-hand-toggle]");
    expect(handArmed?.getAttribute("aria-pressed")).toBe("true");
    expect(handArmed?.getAttribute("data-hand-active")).toBe("true");
    expect(handArmed?.classList.contains("btn-toggle")).toBe(true);
    unmount(armed);
  });

  it("Save As left the toolbar (Phase 22: the title bar owns the file actions)", () => {
    // Phase 22 relocated Open / Save / Save As into the caption strip
    // (AppHeader's .titlebar-file group). The CommandBar must not render
    // the Save-As hook any more — the relocated contract lives in
    // phase22_titlebarFileGroup.test.tsx.
    const host = mountToolbar();
    expect(host.querySelector("[data-toolbar-save-as]")).toBeNull();
    expect(host.querySelector("[data-toolbar-open]")).toBeNull();
    expect(host.querySelector("[data-toolbar-save]")).toBeNull();
    unmount(host);
  });
});