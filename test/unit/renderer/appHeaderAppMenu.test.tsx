// @vitest-environment jsdom
//
// TFL-993 (TFL-855 chunk C7) — the application menu migrated onto the shared
// CommandMenu primitive. This spec pins the migration's behavioural contract:
// every Edit / View / Tools / Help command AND the relocated Multi Mode / Find
// rows survive with their order, actions, disabled reasons and the legacy
// `.app-menu-popover` / `[data-app-menu-popover]` selector hooks, while the
// shared dismiss/focus ownership (Escape, outside-click, Tab,
// focus-return-to-trigger) works through the AppHeader trigger.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppHeader,
  FIND_DISABLED_REASON,
  FIND_IN_DOCUMENT_ACCESSIBLE_NAME,
  MULTI_MODE_ACCESSIBLE_NAME,
} from "../../../src/renderer/components/AppHeader";
import type { MenuGroup } from "../../../src/renderer/components/TitleBar";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";

/** Edit / View / Tools / Help, matching the host's non-File groups. The
 *  relocated Multi Mode + Find rows splice into the `view` group. */
const GROUPS: MenuGroup[] = [
  {
    id: "edit",
    label: "Edit",
    entries: [
      { id: "prefs", label: "Preferences...", accelerator: "Ctrl+,", action: "preferences" },
    ],
  },
  {
    id: "view",
    label: "View",
    entries: [{ id: "theme", label: "Toggle Theme", action: "toggleTheme" }],
  },
  {
    id: "tools",
    label: "Tools",
    entries: [{ id: "optimize", label: "Optimize", action: "optimize" }],
  },
  {
    id: "help",
    label: "Help",
    entries: [{ id: "about", label: "About", action: "about" }],
  },
];

function context(): MenuActionContext {
  return {
    open: vi.fn(),
    merge: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    closeTab: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleTheme: vi.fn(),
    showToolsPalette: vi.fn(),
    about: vi.fn(),
    preferences: vi.fn(),
    optimize: vi.fn(),
    auditSpace: vi.fn(),
    createFromImages: vi.fn(),
    exportPages: vi.fn(),
    exportText: vi.fn(),
    exportDocx: vi.fn(),
    insertPages: vi.fn(),
    recognizeText: vi.fn(),
    checkForUpdate: vi.fn(),
  };
}

interface Harness {
  container: HTMLElement;
  trigger: HTMLButtonElement;
  cleanup: () => void;
}

function renderHeader(opts: {
  ctx?: MenuActionContext;
  findEnabled?: boolean;
  onMultiModeToggle?: () => void;
  onOpenFind?: () => void;
}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={null}
        appMenuGroups={GROUPS}
        menuContext={opts.ctx ?? context()}
        onMultiModeToggle={opts.onMultiModeToggle}
        onOpenFind={opts.onOpenFind}
        findEnabled={opts.findEnabled}
      />,
    );
  });
  return {
    container,
    trigger: container.querySelector<HTMLButtonElement>("[data-app-menu]") as HTMLButtonElement,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function open(h: Harness): void {
  act((): void => {
    h.trigger.click();
  });
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function row(h: Harness, action: string): HTMLButtonElement {
  const el = h.container.querySelector<HTMLButtonElement>(`[data-menu-action="${action}"]`);
  if (el === null) throw new Error(`menu row ${action} missing`);
  return el;
}

describe("TFL-993 - application menu on CommandMenu", () => {
  it("renders every command row with data-menu-action in host order", () => {
    const h = renderHeader({ onMultiModeToggle: vi.fn(), onOpenFind: vi.fn(), findEnabled: true });
    try {
      open(h);
      const actions = [...h.container.querySelectorAll<HTMLButtonElement>("[data-menu-action]")].map(
        (r) => r.getAttribute("data-menu-action"),
      );
      expect(actions).toEqual(["preferences", "toggleTheme", "multiMode", "find", "optimize", "about"]);
      expect(row(h, "multiMode").textContent).toContain(MULTI_MODE_ACCESSIBLE_NAME);
      expect(row(h, "find").textContent).toContain(FIND_IN_DOCUMENT_ACCESSIBLE_NAME);
    } finally {
      h.cleanup();
    }
  });

  it("activating a row dispatches the same menu action and closes", async () => {
    const ctx = context();
    const h = renderHeader({ ctx });
    try {
      open(h);
      act((): void => {
        row(h, "toggleTheme").click();
      });
      expect(ctx.toggleTheme).toHaveBeenCalledTimes(1);
      expect(ctx.preferences).not.toHaveBeenCalled();
      await settle();
      expect(h.container.querySelector("[data-app-menu-popover]")).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("keeps the relocated Multi Mode and Find handlers wired", () => {
    const onMultiModeToggle = vi.fn();
    const onOpenFind = vi.fn();
    const h = renderHeader({ onMultiModeToggle, onOpenFind, findEnabled: true });
    try {
      open(h);
      act((): void => {
        row(h, "multiMode").click();
      });
      expect(onMultiModeToggle).toHaveBeenCalledTimes(1);
      open(h);
      act((): void => {
        row(h, "find").click();
      });
      expect(onOpenFind).toHaveBeenCalledTimes(1);
    } finally {
      h.cleanup();
    }
  });

  it("gives the disabled Find row its accessible reason", () => {
    const h = renderHeader({ onOpenFind: vi.fn(), findEnabled: false });
    try {
      open(h);
      const find = row(h, "find");
      expect(find.hasAttribute("disabled")).toBe(true);
      expect(find.getAttribute("title")).toBe(FIND_DISABLED_REASON);
      const descId = find.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      expect(h.container.querySelector(`#${descId as string}`)?.textContent).toBe(
        FIND_DISABLED_REASON,
      );
    } finally {
      h.cleanup();
    }
  });

  it("keeps the legacy app-menu-popover selector hooks", () => {
    const h = renderHeader({ onOpenFind: vi.fn(), findEnabled: true });
    try {
      open(h);
      const menu = h.container.querySelector("[data-app-menu-popover]");
      expect(menu).not.toBeNull();
      expect(menu?.classList.contains("app-menu-popover")).toBe(true);
      expect(menu?.classList.contains("command-menu")).toBe(true);
      expect(menu?.getAttribute("role")).toBe("menu");
    } finally {
      h.cleanup();
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const h = renderHeader({});
    try {
      open(h);
      expect(h.container.querySelector("[data-app-menu-popover]")).not.toBeNull();
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(document.activeElement).toBe(h.trigger);
      await settle();
      expect(h.container.querySelector("[data-app-menu-popover]")).toBeNull();
      expect(h.trigger.getAttribute("aria-expanded")).toBe("false");
    } finally {
      h.cleanup();
    }
  });

  it("closes on Tab and returns focus to the trigger", async () => {
    const h = renderHeader({});
    try {
      open(h);
      const first = row(h, "preferences");
      act((): void => {
        first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(h.trigger);
      await settle();
      expect(h.container.querySelector("[data-app-menu-popover]")).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("closes on an outside pointerdown without swallowing the gesture", async () => {
    const h = renderHeader({});
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const onDocPointerDown = vi.fn();
    document.addEventListener("pointerdown", onDocPointerDown);
    try {
      open(h);
      expect(h.container.querySelector("[data-app-menu-popover]")).not.toBeNull();
      act((): void => {
        outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      });
      await settle();
      expect(h.container.querySelector("[data-app-menu-popover]")).toBeNull();
      expect(onDocPointerDown).toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", onDocPointerDown);
      outside.remove();
      h.cleanup();
    }
  });
});
