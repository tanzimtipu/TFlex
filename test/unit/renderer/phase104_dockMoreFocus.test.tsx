// @vitest-environment jsdom
//
// Phase 104 (TFL-848) — the More (overflow) menu regressions:
//   (a) DEF-567 — opening More focuses the first NON-disabled `menuitem`.
//       EDIT's leading More rows (`batchOcr` / `ocrSuspects`) are disabled, so
//       the old effect parked focus on a disabled button and roving never
//       reached the menu.
//   (b) DEF-567 — when NO row is enabled the open effect must not throw and
//       leaves focus on the More button (direct helper coverage, since the
//       always-present Customize row means the rendered menu always has one
//       enabled row).
//   (c) DEF-568 — the `[data-dock-overflow-item="delete"]` row matches the
//       danger rule's selector while other rows do not.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  focusFirstEnabledMenuItem,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";

const DANGER_SELECTOR =
  '.action-dock-menu-item[data-dock-overflow-item="delete"]:not(:disabled)';

function bulk(): DockBulkActions {
  return { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
}

interface Harness {
  host: HTMLElement;
  unmount: () => void;
}

function renderDock(options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: bulk(),
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: 1400,
    ...options,
  };
  act((): void => {
    root.render(<ActionDock {...props} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function overflowRows(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("[data-dock-overflow-item]")];
}

describe("Phase 104 (TFL-848) DEF-567 — More roving focus skips disabled rows", () => {
  it("(a) opening More focuses the first NON-disabled menuitem", () => {
    const { host, unmount } = renderDock({
      activeStage: "edit",
      canvasWidth: 1400,
      // Disable only EDIT's first More row; `ocrSuspects` stays enabled.
      isToolEnabled: (entry) => entry.id !== "batchOcr",
    });
    try {
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const rows = overflowRows(host);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.disabled).toBe(true);
      const firstEnabled = rows.find((row) => !row.disabled);
      expect(firstEnabled).not.toBeUndefined();
      expect(document.activeElement).toBe(firstEnabled);
    } finally {
      unmount();
    }
  });

  it("(b) no enabled row: does not throw and keeps focus on the More button", () => {
    const menu = document.createElement("div");
    const disabledA = document.createElement("button");
    disabledA.setAttribute("role", "menuitem");
    disabledA.disabled = true;
    const disabledB = document.createElement("button");
    disabledB.setAttribute("role", "menuitem");
    disabledB.disabled = true;
    const fallback = document.createElement("button");
    menu.append(disabledA, disabledB, fallback);
    document.body.append(menu, fallback);
    try {
      expect(() => focusFirstEnabledMenuItem(menu, fallback)).not.toThrow();
      expect(focusFirstEnabledMenuItem(menu, fallback)).toBe(false);
      expect(document.activeElement).toBe(fallback);
      // A null / empty menu is a no-op, never a throw.
      expect(focusFirstEnabledMenuItem(null, fallback)).toBe(false);
    } finally {
      menu.remove();
      fallback.remove();
    }
  });
});

describe("Phase 104 (TFL-848) DEF-568 — the More delete row carries the danger rule", () => {
  it("(c) only the delete row matches the danger selector", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 1400,
      isToolEnabled: () => true,
    });
    try {
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const del = host.querySelector<HTMLButtonElement>('[data-dock-overflow-item="delete"]');
      expect(del).not.toBeNull();
      expect(del?.disabled).toBe(false);
      expect(del?.matches(DANGER_SELECTOR)).toBe(true);
      const other = host.querySelector<HTMLElement>('[data-dock-overflow-item="split"]');
      expect(other).not.toBeNull();
      expect(other?.matches(DANGER_SELECTOR)).toBe(false);
    } finally {
      unmount();
    }
  });
});

// TFL-1004 (TFL-855 chunk C9) — the More overflow menu is now the shared
// `CommandMenu`. The legacy `data-dock-overflow-menu` root + per-row
// `data-dock-overflow-item` / `data-dock-menu-item` hooks must survive, every
// verb must render, and the Customize toggle must expose `aria-checked`.
describe("TFL-1004 — the More menu renders through the shared CommandMenu", () => {
  it("keeps the root/row hooks and toggles Customize with aria-checked", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 1400,
      isToolEnabled: () => true,
    });
    try {
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const menu = host.querySelector("[data-dock-overflow-menu]");
      expect(menu).not.toBeNull();
      expect(menu?.classList.contains("command-menu")).toBe(true);
      expect(menu?.getAttribute("role")).toBe("menu");
      const rows = overflowRows(host);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.classList.contains("action-dock-menu-item")).toBe(true);
        expect(row.getAttribute("role")).toBe("menuitem");
      }
      const customize = host.querySelector<HTMLButtonElement>(
        '[data-dock-menu-item="customize"]',
      );
      expect(customize).not.toBeNull();
      expect(customize?.getAttribute("role")).toBe("menuitemcheckbox");
      expect(customize?.getAttribute("aria-checked")).toBe("false");
      clickOn(customize as Element);
      // Selecting Customize closes the menu and arms EDIT mode.
      expect(host.querySelector("[data-action-dock]")?.getAttribute("data-dock-edit")).toBe("true");
      expect(host.querySelector("[data-dock-overflow]")?.getAttribute("aria-expanded")).toBe("false");
      // Re-open: the toggle now reports the checked state.
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      expect(
        host.querySelector('[data-dock-menu-item="customize"]')?.getAttribute("aria-checked"),
      ).toBe("true");
    } finally {
      unmount();
    }
  });

  it("closes the menu and runs the verb when a row is selected", () => {
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 1400,
      isToolEnabled: () => true,
      onRunTool,
    });
    try {
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const row = host.querySelector<HTMLButtonElement>("[data-dock-overflow-item]");
      expect(row).not.toBeNull();
      const id = row?.getAttribute("data-dock-overflow-item") ?? "";
      clickOn(row as Element);
      expect(onRunTool).toHaveBeenCalledWith(id);
      expect(host.querySelector("[data-dock-overflow]")?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      unmount();
    }
  });
});
