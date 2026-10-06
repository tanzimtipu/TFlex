// @vitest-environment jsdom
//
// TFL-975 (TFL-855 chunk C5) — the File menu migrated onto the shared
// CommandMenu primitive. This spec pins the migration's behavioural contract:
// every File command and accelerator is preserved and the shared
// dismiss/focus ownership (Escape, outside-click, focus-return-to-opener)
// still works through the TitleBar trigger.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TitleBar, type MenuGroup } from "../../../src/renderer/components/TitleBar";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";

interface TflexStub {
  minimizeWindow: ReturnType<typeof vi.fn>;
  maximizeWindow: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
  menu: { onAction: ReturnType<typeof vi.fn> };
}

function setTflex(): void {
  (window as unknown as { tflex: TflexStub }).tflex = {
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    menu: { onAction: vi.fn() },
  };
}

/** The File group exactly as App.tsx:9439-9504 defines it (commands +
 *  accelerator strings verbatim). */
const FILE_GROUPS: MenuGroup[] = [
  {
    id: "file",
    label: "File",
    entries: [
      { id: "open", label: "Open...", accelerator: "Ctrl+O", action: "open" },
      { id: "merge", label: "Merge...", accelerator: "Ctrl+Shift+O", action: "merge" },
      { id: "save", label: "Save", accelerator: "Ctrl+S", action: "save" },
      { id: "saveAs", label: "Save As...", accelerator: "Ctrl+Shift+S", action: "saveAs" },
      { id: "closeTab", label: "Close Tab", accelerator: "Ctrl+W", action: "closeTab" },
    ],
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

function mount(ctx: MenuActionContext): {
  container: HTMLElement;
  cleanup: () => void;
} {
  setTflex();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(<TitleBar menuGroups={FILE_GROUPS} menuContext={ctx} />);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
      (window as unknown as { tflex?: unknown }).tflex = undefined;
    },
  };
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function trigger(container: HTMLElement): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>("[data-menu-button]") as HTMLButtonElement;
}

describe("TFL-975 — File menu on CommandMenu", () => {
  it("renders every File row with its accelerator and data-menu-action", () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    try {
      act((): void => {
        trigger(container).click();
      });
      const menu = container.querySelector(".titlebar-menu-popover.command-menu");
      expect(menu).not.toBeNull();
      expect(menu?.getAttribute("data-menu-popover")).toBe("true");
      expect(menu?.getAttribute("role")).toBe("menu");

      const rows = [...container.querySelectorAll<HTMLButtonElement>("[data-menu-action]")];
      expect(rows.map((r) => r.getAttribute("data-menu-action"))).toEqual([
        "open",
        "merge",
        "save",
        "saveAs",
        "closeTab",
      ]);
      expect(rows.map((r) => r.querySelector(".kbd")?.textContent)).toEqual([
        "Ctrl+O",
        "Ctrl+Shift+O",
        "Ctrl+S",
        "Ctrl+Shift+S",
        "Ctrl+W",
      ]);
    } finally {
      cleanup();
    }
  });

  it("clicking a File row dispatches the same action and closes the menu", async () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    try {
      act((): void => {
        trigger(container).click();
      });
      act((): void => {
        container.querySelector<HTMLButtonElement>("[data-menu-action='save']")?.click();
      });
      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(ctx.open).not.toHaveBeenCalled();
      await settle();
      expect(container.querySelector("[data-menu-popover]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Escape closes the menu and returns focus to the trigger", async () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    try {
      const btn = trigger(container);
      btn.focus();
      act((): void => {
        btn.click();
      });
      expect(container.querySelector("[data-menu-popover]")).not.toBeNull();
      const list = container.querySelector<HTMLElement>(".command-menu-list");
      act((): void => {
        list?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      await settle();
      expect(container.querySelector("[data-menu-popover]")).toBeNull();
      expect(document.activeElement).toBe(btn);
    } finally {
      cleanup();
    }
  });

  it("an outside pointerdown closes the menu", async () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    try {
      act((): void => {
        trigger(container).click();
      });
      expect(container.querySelector("[data-menu-popover]")).not.toBeNull();
      act((): void => {
        outside.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
        );
      });
      await settle();
      expect(container.querySelector("[data-menu-popover]")).toBeNull();
    } finally {
      outside.remove();
      cleanup();
    }
  });

  it("a second click on the open trigger closes the menu (DEF-601)", async () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    try {
      const btn = trigger(container);
      act((): void => {
        btn.click();
      });
      expect(container.querySelector("[data-menu-popover]")).not.toBeNull();

      // A real click fires pointerdown then click on the trigger. The
      // pointerdown must NOT be treated as an outside dismiss, otherwise the
      // following click's toggle (false -> true) would leave the menu open.
      act((): void => {
        btn.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
        );
      });
      expect(container.querySelector("[data-menu-popover]")).not.toBeNull();

      act((): void => {
        btn.click();
      });
      await settle();
      expect(container.querySelector("[data-menu-popover]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Escape with focus off the row list closes and returns focus to the trigger (DEF-602)", async () => {
    const ctx = context();
    const { container, cleanup } = mount(ctx);
    try {
      const btn = trigger(container);
      btn.focus();
      act((): void => {
        btn.click();
      });
      expect(container.querySelector("[data-menu-popover]")).not.toBeNull();

      // Clicking the heading or padding moves focus off the row list (to body),
      // so the list's React keydown never sees the Escape.
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      act((): void => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      await settle();
      expect(container.querySelector("[data-menu-popover]")).toBeNull();
      expect(document.activeElement).toBe(btn);
    } finally {
      cleanup();
    }
  });
});