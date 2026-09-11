// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  TitleBar,
  flattenMenuGroups,
  type MenuGroup,
} from "../../../src/renderer/components/TitleBar";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";

/** Mock the IPC bridge the TitleBar calls into. The real bridge
 *  fires an electron IPC channel; in jsdom we just record the call
 *  so the tests can assert the right method was invoked. */
interface TflexStub {
  minimizeWindow: ReturnType<typeof vi.fn>;
  maximizeWindow: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
  menu: { onAction: ReturnType<typeof vi.fn> };
}
function setTflex(stub: TflexStub): void {
  (window as unknown as { tflex: TflexStub }).tflex = stub;
}

export function clearTflex(): void {
  (window as unknown as { tflex?: unknown }).tflex = undefined;
}

/** Phase C — motion exit surfaces (menus, dialogs, toasts) keep their
 *  DOM node for a frame after `open` flips false (AnimatePresence
 *  exit). Unit tests run with `MotionGlobalConfig.skipAnimations`
 *  (test/setup), so the exit completes on the next rAF tick; this
 *  settles that tick deterministically before an absence assertion. */
export async function settleMotion(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function noopContext(): MenuActionContext {
  return {
    open: (): void => undefined,
    merge: (): void => undefined,
    save: (): void => undefined,
    saveAs: (): void => undefined,
    closeTab: (): void => undefined,
    undo: (): void => undefined,
    redo: (): void => undefined,
    toggleTheme: (): void => undefined,
    showToolsPalette: (): void => undefined,
    about: (): void => undefined,
    preferences: (): void => undefined,
    optimize: (): void => undefined,
    auditSpace: (): void => undefined,
    createFromImages: (): void => undefined,
    exportPages: (): void => undefined,
    exportText: (): void => undefined,
    exportDocx: (): void => undefined,
    insertPages: (): void => undefined,
    recognizeText: (): void => undefined,
    checkForUpdate: (): void => undefined,
  };
}

interface RenderArgs {
  menuGroups?: MenuGroup[];
  menuContext?: MenuActionContext;
  maximized?: boolean;
}
function renderTitleBar(args: RenderArgs = {}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <TitleBar
        menuGroups={args.menuGroups}
        menuContext={args.menuContext ?? noopContext()}
        maximized={args.maximized ?? false}
      />,
    );
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

describe("TitleBar — window controls wire to tflex.* IPC", () => {
  it("renders three controls at the trailing edge (min / max / close)", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const { container, cleanup } = renderTitleBar();
    const min = container.querySelector("[data-window-minimize]");
    const max = container.querySelector("[data-window-maximize]");
    const close = container.querySelector("[data-window-close]");
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();
    expect(close).not.toBeNull();
    cleanup();
    clearTflex();
  });

  it("clicking minimize fires tflex.minimizeWindow exactly once", () => {
    const stub: TflexStub = {
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    };
    setTflex(stub);
    const { container, cleanup } = renderTitleBar();
    const btn = container.querySelector<HTMLButtonElement>("[data-window-minimize]");
    expect(btn).not.toBeNull();
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    expect(stub.minimizeWindow).toHaveBeenCalledTimes(1);
    cleanup();
    clearTflex();
  });

  it("clicking maximize fires tflex.maximizeWindow", () => {
    const stub: TflexStub = {
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    };
    setTflex(stub);
    const { container, cleanup } = renderTitleBar();
    const btn = container.querySelector<HTMLButtonElement>("[data-window-maximize]");
    expect(btn).not.toBeNull();
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    expect(stub.maximizeWindow).toHaveBeenCalledTimes(1);
    cleanup();
    clearTflex();
  });

  it("clicking close fires tflex.closeWindow", () => {
    const stub: TflexStub = {
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    };
    setTflex(stub);
    const { container, cleanup } = renderTitleBar();
    const btn = container.querySelector<HTMLButtonElement>("[data-window-close]");
    expect(btn).not.toBeNull();
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    expect(stub.closeWindow).toHaveBeenCalledTimes(1);
    cleanup();
    clearTflex();
  });

  it("renders the maximize icon when restored, the restore icon when maximized", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    // Restored state — label says "Maximize window"
    {
      const { container, cleanup } = renderTitleBar({ maximized: false });
      const btn = container.querySelector<HTMLButtonElement>("[data-window-maximize]");
      expect(btn?.getAttribute("aria-label")).toBe("Maximize window");
      cleanup();
    }
    // Maximized state — label flips to "Restore window"
    {
      const { container, cleanup } = renderTitleBar({ maximized: true });
      const btn = container.querySelector<HTMLButtonElement>("[data-window-maximize]");
      expect(btn?.getAttribute("aria-label")).toBe("Restore window");
      cleanup();
    }
    clearTflex();
  });

  it("uses the standard caption glyphs — distinct restore, never the minimize icon (B10 + Phase 13)", () => {
    // B10 + Phase 13 — the caption glyphs follow the Windows/VS Code
    // convention: minimize = `Minus` (horizontal line), maximize =
    // `Square`, restore = the overlapping-squares `Copy` icon. The
    // restore glyph must never equal the minimize glyph.
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    // Maximized: restore icon is Copy; minimize is Minus.
    {
      const { container, cleanup } = renderTitleBar({ maximized: true });
      const maxBtn = container.querySelector<HTMLElement>("[data-window-maximize]");
      const minBtn = container.querySelector<HTMLElement>("[data-window-minimize]");
      expect(maxBtn?.querySelector("svg.lucide-copy")).not.toBeNull();
      expect(maxBtn?.querySelector("svg.lucide-square")).toBeNull();
      expect(maxBtn?.querySelector("svg.lucide-minimize-2")).toBeNull();
      // The minimize button still shows its own Minus glyph, so
      // the two controls are visually unambiguous.
      expect(minBtn?.querySelector("svg.lucide-minus")).not.toBeNull();
      cleanup();
    }
    // Restored: the maximize button shows Square.
    {
      const { container, cleanup } = renderTitleBar({ maximized: false });
      const maxBtn = container.querySelector<HTMLElement>("[data-window-maximize]");
      expect(maxBtn?.querySelector("svg.lucide-square")).not.toBeNull();
      expect(maxBtn?.querySelector("svg.lucide-copy")).toBeNull();
      cleanup();
    }
    clearTflex();
  });
});

describe("TitleBar — drag region + interactive children", () => {
  it("the outer .titlebar carries the drag region", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const { container, cleanup } = renderTitleBar();
    const bar = container.querySelector<HTMLElement>("[data-titlebar]");
    expect(bar).not.toBeNull();
    if (bar === null) return;
    // The contract: drag on the bar, no-drag on every interactive
    // child. The rules live in styles.css; we assert the structural
    // class names exist so a stylesheet refactor that drops the
    // class names is caught at the DOM level.
    expect(bar.classList.contains("titlebar")).toBe(true);
    cleanup();
    clearTflex();
  });

  it("every window control carries the no-drag rule via .titlebar > *", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const { container, cleanup } = renderTitleBar();
    const bar = container.querySelector<HTMLElement>("[data-titlebar]");
    expect(bar).not.toBeNull();
    if (bar === null) return;
    // The selectors below are CSS-scoped descendants of the titlebar
    // (universal selector matches any direct / nested child). The
    // .titlebar > * rule cascades to them — pinning the structural
    // shape so the stylesheet refactor test fails if anyone drops
    // the data-attrs.
    const min = container.querySelector<HTMLElement>("[data-window-minimize]");
    const max = container.querySelector<HTMLElement>("[data-window-maximize]");
    const close = container.querySelector<HTMLElement>("[data-window-close]");
    expect(min?.closest("[data-titlebar]")).toBe(bar);
    expect(max?.closest("[data-titlebar]")).toBe(bar);
    expect(close?.closest("[data-titlebar]")).toBe(bar);
    cleanup();
    clearTflex();
  });
});

describe("TitleBar — menu popover", () => {
  it("hides the menu button entirely when no groups are passed", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const { container, cleanup } = renderTitleBar();
    expect(container.querySelector("[data-menu-button]")).toBeNull();
    cleanup();
    clearTflex();
  });

  it("renders the menu button when at least one group is passed", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const groups: MenuGroup[] = [
      {
        id: "file",
        label: "File",
        entries: [{ id: "open", label: "Open...", action: "open" }],
      },
    ];
    const { container, cleanup } = renderTitleBar({ menuGroups: groups });
    expect(container.querySelector("[data-menu-button]")).not.toBeNull();
    cleanup();
    clearTflex();
  });

  it("opens the popover when the menu button is clicked, lists entries", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const ctx = noopContext();
    const groups: MenuGroup[] = [
      {
        id: "file",
        label: "File",
        entries: [
          { id: "open", label: "Open...", accelerator: "Ctrl+O", action: "open" },
          { id: "save", label: "Save", accelerator: "Ctrl+S", action: "save" },
        ],
      },
    ];
    const { container, cleanup } = renderTitleBar({ menuGroups: groups, menuContext: ctx });
    const btn = container.querySelector<HTMLButtonElement>("[data-menu-button]");
    expect(btn).not.toBeNull();
    if (btn === null) return;
    // Closed state — no popover yet.
    expect(container.querySelector("[data-menu-popover]")).toBeNull();
    act((): void => {
      btn.click();
    });
    // Open state — popover present, both rows rendered.
    const popover = container.querySelector("[data-menu-popover]");
    expect(popover).not.toBeNull();
    const rows = container.querySelectorAll<HTMLElement>("[data-menu-action]");
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute("data-menu-action")).toBe("open");
    expect(rows[1]?.getAttribute("data-menu-action")).toBe("save");
    cleanup();
    clearTflex();
  });

  it("clicking a popover row dispatches through menuContext + closes the popover", async () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const ctx = noopContext();
    const aboutSpy = vi.spyOn(ctx, "about");
    const groups: MenuGroup[] = [
      {
        id: "help",
        label: "Help",
        entries: [{ id: "about", label: "About", action: "about" }],
      },
    ];
    const { container, cleanup } = renderTitleBar({ menuGroups: groups, menuContext: ctx });
    const btn = container.querySelector<HTMLButtonElement>("[data-menu-button]");
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    const row = container.querySelector<HTMLButtonElement>("[data-menu-action='about']");
    expect(row).not.toBeNull();
    if (row !== null) {
      act((): void => {
        row.click();
      });
    }
    expect(aboutSpy).toHaveBeenCalledTimes(1);
    // Popover closes after dispatch (single-click is the affordance).
    // Phase C — the animated popover lingers one exit frame.
    await settleMotion();
    expect(container.querySelector("[data-menu-popover]")).toBeNull();
    cleanup();
    clearTflex();
  });

  it("non-interactive entries (no `action`) render as separators, not buttons", () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const ctx = noopContext();
    const groups: MenuGroup[] = [
      {
        id: "file",
        label: "File",
        entries: [
          { id: "open", label: "Open...", action: "open" },
          { id: "sep", label: "" }, // No action -> separator
          { id: "save", label: "Save", action: "save" },
        ],
      },
    ];
    const { container, cleanup } = renderTitleBar({ menuGroups: groups, menuContext: ctx });
    const btn = container.querySelector<HTMLButtonElement>("[data-menu-button]");
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    const rows = container.querySelectorAll<HTMLElement>("[data-menu-action]");
    expect(rows.length).toBe(2); // separator does not get a row
    cleanup();
    clearTflex();
  });
});

describe("TitleBar — Escape closes the popover", () => {
  it("Escape keypress while popover is open sets it closed", async () => {
    setTflex({
      minimizeWindow: vi.fn(),
      maximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
      menu: { onAction: vi.fn() },
    });
    const { container, cleanup } = renderTitleBar({
      menuGroups: [
        { id: "file", label: "File", entries: [{ id: "open", label: "Open", action: "open" }] },
      ],
      menuContext: noopContext(),
    });
    const btn = container.querySelector<HTMLButtonElement>("[data-menu-button]");
    if (btn !== null) {
      act((): void => {
        btn.click();
      });
    }
    expect(container.querySelector("[data-menu-popover]")).not.toBeNull();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // Phase C — the animated popover lingers one exit frame.
    await settleMotion();
    expect(container.querySelector("[data-menu-popover]")).toBeNull();
    cleanup();
    clearTflex();
  });
});

// ---------------------------------------------------------------------------
// Pure helper — flattenMenuGroups. Extracted so tests can pin the layout
// shape without rendering.
// ---------------------------------------------------------------------------
describe("flattenMenuGroups — layout contract", () => {
  it("emits a heading row for every group, in order", () => {
    const groups: MenuGroup[] = [
      { id: "file", label: "File", entries: [] },
      { id: "edit", label: "Edit", entries: [] },
    ];
    const flat = flattenMenuGroups(groups);
    expect(flat.filter((x) => x.kind === "heading").length).toBe(2);
    expect(flat[0]?.kind).toBe("heading");
    expect(flat[1]?.kind).toBe("heading");
  });

  it("entries with action emit rows; entries without emit separators", () => {
    const groups: MenuGroup[] = [
      {
        id: "file",
        label: "File",
        entries: [
          { id: "open", label: "Open", action: "open" },
          { id: "sep1", label: "" },
          { id: "save", label: "Save", action: "save" },
        ],
      },
    ];
    const flat = flattenMenuGroups(groups);
    const rows = flat.filter((x) => x.kind === "row");
    const seps = flat.filter((x) => x.kind === "sep");
    expect(rows.length).toBe(2);
    expect(seps.length).toBe(1);
  });

  it("empty group list flattens to an empty row list", () => {
    const flat = flattenMenuGroups([]);
    expect(flat).toEqual([]);
  });
});