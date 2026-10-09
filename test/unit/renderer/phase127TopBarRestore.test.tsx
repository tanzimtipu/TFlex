// @vitest-environment jsdom
//
// Phase 127 (TFL-1482 chunk A) — the v1.50.0 top-bar chrome restore.
//
// Pins:
//   - the leading `File` trigger ([data-menu-button]) opens ONE popover that
//     lists every menu group (FILE / EDIT / VIEW / TOOLS / HELP) with the rows
//     the app menu used to hold reintroduced in the shared menu model;
//   - the retired Phase-105 application-menu trigger ([data-app-menu]) is gone;
//   - the restored `.header-actions` cluster renders update indicator, command
//     tool-search, Find, Multi Mode, Print, settings gear and the theme pill,
//     and each control fires its handler (Multi Mode flips
//     data-multi-mode-active);
//   - the `.theme-toggle` pill shows the current theme label and selecting an
//     option calls onThemeChange with that value.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { TitleBar, type MenuGroup } from "../../../src/renderer/components/TitleBar";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";

function noop(): void {
  return undefined;
}

function noopContext(): MenuActionContext {
  return {
    open: noop,
    merge: noop,
    save: noop,
    saveAs: noop,
    closeTab: noop,
    undo: noop,
    redo: noop,
    toggleTheme: noop,
    showToolsPalette: noop,
    about: noop,
    preferences: noop,
    optimize: noop,
    auditSpace: noop,
    createFromImages: noop,
    exportPages: noop,
    exportText: noop,
    exportDocx: noop,
    insertPages: noop,
    recognizeText: noop,
    checkForUpdate: noop,
  };
}

/** The full v1.50.0 menu shape: every group in ONE popover. The View group
 *  carries the Theme row plus the relocated Multi Mode / Find commands so the
 *  shared menu model is exercised with the rows the retired app menu held. */
const FULL_MENU: MenuGroup[] = [
  {
    id: "file",
    label: "File",
    entries: [{ id: "open", label: "Open...", accelerator: "Ctrl+O", action: "open" }],
  },
  {
    id: "edit",
    label: "Edit",
    entries: [{ id: "prefs", label: "Preferences...", accelerator: "Ctrl+,", action: "preferences" }],
  },
  {
    id: "view",
    label: "View",
    entries: [
      { id: "theme", label: "Toggle Theme", accelerator: "Ctrl+Shift+T", action: "toggleTheme" },
      { id: "multi-mode", label: "Multi Mode", icon: "multi-mode", onSelect: noop },
      { id: "find", label: "Find in document", icon: "find", onSelect: noop },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    entries: [{ id: "ocr", label: "Recognize Text...", action: "recognizeText" }],
  },
  {
    id: "help",
    label: "Help",
    entries: [{ id: "about", label: "About Jovrel", action: "about" }],
  },
];

interface Harness {
  container: HTMLElement;
  cleanup: () => void;
}

function mount(ui: ReactElement): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(ui);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function click(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 40));
  });
}

function headerHandlers() {
  return {
    onOpenToolSearch: vi.fn<() => void>(),
    onOpenFind: vi.fn<() => void>(),
    onMultiModeToggle: vi.fn<() => void>(),
    onPrint: vi.fn<() => void>(),
    onOpenPreferences: vi.fn<() => void>(),
    onThemeChange: vi.fn<(next: string) => void>(),
  };
}

function renderHeader(
  overrides: Partial<Parameters<typeof AppHeader>[0]> = {},
): Harness {
  return mount(
    <AppHeader
      activeId="tab-1"
      onOpenFile={noop}
      onSave={noop}
      onSaveAs={noop}
      onOpenPreferences={noop}
      onThemeChange={noop}
      {...overrides}
    />,
  );
}

describe("Phase 127 — the File trigger opens ONE full menu", () => {
  it("lists the FILE / EDIT / VIEW / TOOLS / HELP groups", () => {
    const h = mount(<TitleBar menuGroups={FULL_MENU} menuContext={noopContext()} />);
    try {
      const button = h.container.querySelector<HTMLButtonElement>("[data-menu-button]");
      expect(button).not.toBeNull();
      if (button === null) return;
      expect(h.container.querySelector("[data-menu-popover]")).toBeNull();
      click(button);
      const popover = h.container.querySelector("[data-menu-popover]");
      expect(popover).not.toBeNull();
      const headings = Array.from(
        popover?.querySelectorAll(".titlebar-menu-heading") ?? [],
      ).map((el) => el.textContent);
      expect(headings).toEqual(["File", "Edit", "View", "Tools", "Help"]);
    } finally {
      h.cleanup();
    }
  });

  it("carries the toggleTheme, multi-mode and find rows", () => {
    const h = mount(<TitleBar menuGroups={FULL_MENU} menuContext={noopContext()} />);
    try {
      const button = h.container.querySelector<HTMLButtonElement>("[data-menu-button]");
      if (button !== null) click(button);
      const actions = Array.from(
        h.container.querySelectorAll("[data-menu-action]"),
      ).map((el) => el.getAttribute("data-menu-action"));
      expect(actions).toContain("toggleTheme");
      expect(actions).toContain("multi-mode");
      expect(actions).toContain("find");
    } finally {
      h.cleanup();
    }
  });

  it("does not render the retired application-menu trigger", () => {
    const h = renderHeader();
    try {
      expect(h.container.querySelector("[data-app-menu]")).toBeNull();
      expect(h.container.querySelector("[data-app-menu-popover]")).toBeNull();
      expect(h.container.querySelector(".app-menu")).toBeNull();
    } finally {
      h.cleanup();
    }
  });
});

describe("Phase 127 — the restored header utility cluster", () => {
  it("renders and fires each control's handler", () => {
    const fns = headerHandlers();
    const h = renderHeader({
      onOpenToolSearch: fns.onOpenToolSearch,
      onOpenFind: fns.onOpenFind,
      findEnabled: true,
      onMultiModeToggle: fns.onMultiModeToggle,
      onPrint: fns.onPrint,
      printEnabled: true,
      onOpenPreferences: fns.onOpenPreferences,
    });
    try {
      const toolSearch = h.container.querySelector<HTMLButtonElement>("[data-header-tool-search]");
      const find = h.container.querySelector<HTMLButtonElement>("[data-header-find]");
      const multi = h.container.querySelector<HTMLButtonElement>("[data-header-multi-mode]");
      const print = h.container.querySelector<HTMLButtonElement>("[data-print]");
      const gear = h.container.querySelector<HTMLButtonElement>("[data-open-preferences]");
      for (const el of [toolSearch, find, multi, print, gear]) expect(el).not.toBeNull();
      if (toolSearch !== null) click(toolSearch);
      if (find !== null) click(find);
      if (multi !== null) click(multi);
      if (print !== null) click(print);
      if (gear !== null) click(gear);
      expect(fns.onOpenToolSearch).toHaveBeenCalledTimes(1);
      expect(fns.onOpenFind).toHaveBeenCalledTimes(1);
      expect(fns.onMultiModeToggle).toHaveBeenCalledTimes(1);
      expect(fns.onPrint).toHaveBeenCalledTimes(1);
      expect(fns.onOpenPreferences).toHaveBeenCalledTimes(1);
    } finally {
      h.cleanup();
    }
  });

  it("flips data-multi-mode-active when Multi Mode toggles", () => {
    function Host(): ReactElement {
      const [on, setOn] = useState(false);
      return (
        <AppHeader
          activeId="tab-1"
          onOpenPreferences={noop}
          onThemeChange={noop}
          multiModeEnabled={on}
          onMultiModeToggle={(): void => setOn((v) => !v)}
        />
      );
    }
    const h = mount(<Host />);
    try {
      const multi = (): HTMLButtonElement | null =>
        h.container.querySelector<HTMLButtonElement>("[data-header-multi-mode]");
      expect(multi()?.getAttribute("data-multi-mode-active")).toBe("false");
      const el = multi();
      if (el !== null) click(el);
      expect(multi()?.getAttribute("data-multi-mode-active")).toBe("true");
      expect(multi()?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      h.cleanup();
    }
  });
});

describe("Phase 127 — the theme dropdown", () => {
  it("shows the current theme label and commits a selected option", async () => {
    const onThemeChange = vi.fn();
    const h = renderHeader({ themeDefault: "dark", onThemeChange });
    try {
      const pill = h.container.querySelector<HTMLButtonElement>("[data-theme-toggle]");
      expect(pill).not.toBeNull();
      expect(pill?.getAttribute("aria-label")).toBe("Change theme");
      expect(pill?.textContent).toContain("Dark");
      if (pill !== null) click(pill);
      const option = h.container.querySelector<HTMLButtonElement>(
        "[data-theme-option='light']",
      );
      expect(option).not.toBeNull();
      if (option !== null) click(option);
      expect(onThemeChange).toHaveBeenCalledWith("light");
      await settle();
      expect(h.container.querySelector(".theme-toggle-popover")).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("falls back to Frosted Glass when no preference is set", () => {
    const h = renderHeader();
    try {
      const pill = h.container.querySelector("[data-theme-toggle]");
      expect(pill?.textContent).toContain("Frosted Glass");
    } finally {
      h.cleanup();
    }
  });
});
