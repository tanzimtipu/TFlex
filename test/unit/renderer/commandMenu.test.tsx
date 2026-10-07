// @vitest-environment jsdom
//
// TFL-901 (TFL-855 chunk C2c) — CommandMenu primitive DOM contract.
//
// Mounted with the raw react-dom/client + act pattern the sibling renderer
// tests use (dialogShell.test.tsx:15-50, floatingSurfaces.test.tsx).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import {
  CommandMenu,
  flattenCommandGroups,
  type CommandMenuGroup,
  type CommandMenuItem,
} from "../../../src/renderer/components/CommandMenu";

function mount(node: ReactElement): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Controllable prefers-reduced-motion stub (same shape as
 *  floatingSurfaces.test.tsx). */
interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
}

function installReducedMotionStub(matches: boolean): void {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (
    query: string,
  ): FakeMql => {
    mql.media = query;
    return mql;
  };
}

const originalMatchMedia = window.matchMedia;

function keydown(target: EventTarget, key: string): void {
  act((): void => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function rowByAction(container: HTMLElement, action: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-menu-action="${action}"]`);
}

function firePointer(target: EventTarget, type: string): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  });
}

/** A representative menu: heading + actions, a separator, a disabled row with
 *  a reason, a checked toggle, and a row with a nested submenu. */
function sampleGroups(): CommandMenuGroup[] {
  return [
    {
      id: "file",
      label: "File",
      entries: [
        { id: "open", label: "Open", accelerator: "Ctrl+O", action: "file.open" },
        { id: "rule", label: "" },
        {
          id: "save",
          label: "Save",
          accelerator: "Ctrl+S",
          action: "file.save",
          disabled: true,
          disabledReason: "No document open",
        },
        { id: "merge", label: "Merge", action: "file.merge" },
      ],
    },
    {
      id: "view",
      label: "View",
      entries: [
        { id: "theme", label: "Dark", checked: true, action: "view.theme" },
        {
          id: "more",
          label: "More tools",
          submenu: [{ id: "ocr", label: "OCR", action: "tools.ocr" }],
        },
      ],
    },
  ];
}

beforeEach((): void => {
  installReducedMotionStub(false);
});

afterEach((): void => {
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "matchMedia");
  } else {
    window.matchMedia = originalMatchMedia;
  }
});

describe("TFL-901 — CommandMenu structure", () => {
  it("renders the shipped menu DOM: role=menu, headings, separators, action rows", () => {
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );

    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.classList.contains("titlebar-menu-popover")).toBe(true);
    expect(menu?.classList.contains("command-menu")).toBe(true);
    expect(menu?.getAttribute("data-menu-popover")).toBe("true");
    expect(menu?.getAttribute("aria-label")).toBe("Application menu");

    const headings = container.querySelectorAll(".titlebar-menu-heading");
    expect(headings).toHaveLength(2);
    expect(headings[0].getAttribute("role")).toBe("presentation");
    expect(headings[0].textContent).toBe("File");

    const sep = container.querySelector(".titlebar-menu-sep");
    expect(sep?.getAttribute("role")).toBe("separator");
    expect(sep?.getAttribute("aria-hidden")).toBe("true");

    const open = rowByAction(container, "file.open");
    expect(open?.getAttribute("role")).toBe("menuitem");
    expect(open?.textContent).toContain("Open");
    expect(open?.querySelector(".kbd.titlebar-menu-row-kbd")?.textContent).toBe("Ctrl+O");
    cleanup();
  });

  it("emits data-testid and forwards extra class names", () => {
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={vi.fn()}
        testId="app-menu"
        className="extra-class"
      />,
    );
    const menu = container.querySelector(".command-menu");
    expect(menu?.getAttribute("data-testid")).toBe("app-menu");
    expect(menu?.classList.contains("extra-class")).toBe(true);
    cleanup();
  });

  it("spreads popoverDataAttrs onto the root surface for legacy selector hooks", () => {
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={vi.fn()}
        className="app-menu-popover"
        popoverDataAttrs={{ "data-app-menu-popover": "true" }}
      />,
    );
    const menu = container.querySelector(".command-menu");
    expect(menu?.getAttribute("data-app-menu-popover")).toBe("true");
    expect(menu?.classList.contains("app-menu-popover")).toBe(true);
    cleanup();
  });
});

describe("TFL-901 — CommandMenu keyboard model", () => {
  it("ArrowDown/ArrowUp skip disabled rows; a disabled row cannot be activated", () => {
    const onSelect = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    const merge = rowByAction(container, "file.merge") as HTMLButtonElement;
    const save = rowByAction(container, "file.save") as HTMLButtonElement;

    open.focus();
    keydown(open, "ArrowDown");
    expect(document.activeElement).toBe(merge);
    keydown(merge, "ArrowUp");
    expect(document.activeElement).toBe(open);

    expect(save.disabled).toBe(true);
    save.click();
    expect(onSelect).not.toHaveBeenCalled();
    cleanup();
  });

  it("Home/End jump to the first and last enabled rows", () => {
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    const merge = rowByAction(container, "file.merge") as HTMLButtonElement;
    const more = rowByAction(container, "more") as HTMLButtonElement;

    merge.focus();
    keydown(merge, "Home");
    expect(document.activeElement).toBe(open);
    keydown(open, "End");
    expect(document.activeElement).toBe(more);
    cleanup();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    open.focus();
    keydown(open, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("closes on Tab so focus can leave the menu", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    open.focus();
    keydown(open, "Tab");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("activates a row on Enter and then closes the menu", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={onClose}
        onSelect={onSelect}
      />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    open.focus();
    keydown(open, "Enter");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("falls back to item.onSelect when no menu-level onSelect is given", () => {
    const itemHandler = vi.fn();
    const groups: CommandMenuGroup[] = [
      { id: "g", label: "Group", entries: [{ id: "do", label: "Do", onSelect: itemHandler }] },
    ];
    const { container, cleanup } = mount(
      <CommandMenu open groups={groups} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const row = rowByAction(container, "do") as HTMLButtonElement;
    firePointer(row, "click");
    expect(itemHandler).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("fires onSelect once for two synchronous clicks on the same row (DEF-610)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={onClose}
        onSelect={onSelect}
      />,
    );
    const open = rowByAction(container, "file.open") as HTMLButtonElement;
    // Two activations in the SAME tick, before any close re-render can unmount
    // the surface: the re-entry guard must dispatch the command exactly once.
    firePointer(open, "click");
    firePointer(open, "click");
    expect(onSelect).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders a checked row as menuitemcheckbox with aria-checked=true", () => {
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const theme = rowByAction(container, "view.theme") as HTMLButtonElement;
    expect(theme.getAttribute("role")).toBe("menuitemcheckbox");
    expect(theme.getAttribute("aria-checked")).toBe("true");
    cleanup();
  });

  it("exposes disabledReason as title and an accessible description", () => {
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const save = rowByAction(container, "file.save") as HTMLButtonElement;
    expect(save.getAttribute("title")).toBe("No document open");
    const descId = save.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const desc = container.querySelector(`#${descId as string}`);
    expect(desc?.textContent).toBe("No document open");
    cleanup();
  });

  it("opens a nested role=menu on ArrowRight and closes on Escape with focus back on the parent", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    const more = rowByAction(container, "more") as HTMLButtonElement;
    more.focus();
    keydown(more, "ArrowRight");

    const submenu = container.querySelector("[data-menu-submenu]");
    expect(submenu).not.toBeNull();
    expect(submenu?.getAttribute("role")).toBe("menu");
    const ocr = rowByAction(container, "tools.ocr") as HTMLButtonElement;
    expect(document.activeElement).toBe(ocr);

    keydown(ocr, "Escape");
    expect(container.querySelector("[data-menu-submenu]")).toBeNull();
    expect(document.activeElement).toBe(more);
    // A submenu Escape closes only the submenu, never the root menu.
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("closes a submenu on ArrowLeft with focus back on the parent", () => {
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const more = rowByAction(container, "more") as HTMLButtonElement;
    more.focus();
    keydown(more, "ArrowRight");
    const ocr = rowByAction(container, "tools.ocr") as HTMLButtonElement;
    expect(document.activeElement).toBe(ocr);

    keydown(ocr, "ArrowLeft");
    expect(container.querySelector("[data-menu-submenu]")).toBeNull();
    expect(document.activeElement).toBe(more);
    cleanup();
  });
});

describe("TFL-901 — CommandMenu dismissal and helpers", () => {
  it("an outside pointerdown dismisses without swallowing the underlying gesture", () => {
    const onClose = vi.fn();
    const onDocumentPointerDown = vi.fn();
    document.addEventListener("pointerdown", onDocumentPointerDown);
    const { cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    firePointer(outside, "pointerdown");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDocumentPointerDown).toHaveBeenCalled();
    outside.remove();
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    cleanup();
  });

  it("does not dismiss a pointerdown inside the openerRef (DEF-601)", () => {
    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.appendChild(opener);
    const openerRef = { current: opener };
    const onClose = vi.fn();
    const { cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={onClose}
        openerRef={openerRef}
      />,
    );
    firePointer(opener, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    // A pointerdown outside BOTH the surface and the opener still dismisses.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    firePointer(outside, "pointerdown");
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
    opener.remove();
    cleanup();
  });

  it("Escape with focus off the row list closes and returns focus to the opener (DEF-602)", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open menu";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { root, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    // The primitive seeded focus on the first row; move it off the list, as a
    // click on the heading or padding does.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    keydown(document.body, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async (): Promise<void> => {
      root.render(
        <CommandMenu
          open={false}
          groups={sampleGroups()}
          ariaLabel="Application menu"
          onClose={onClose}
        />,
      );
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
    cleanup();
  });

  it("returns focus to the opener on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open menu";
    document.body.appendChild(opener);
    opener.focus();

    const { root, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    await act(async (): Promise<void> => {
      root.render(
        <CommandMenu open={false} groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
      );
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
    cleanup();
  });

  it("returns focus to the declared openerRef on Tab close even when it was not focused", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open menu";
    document.body.appendChild(opener);
    const openerRef = { current: opener };
    const onClose = vi.fn();
    const { container, root, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={onClose}
        openerRef={openerRef}
      />,
    );
    const row = rowByAction(container, "file.open") as HTMLButtonElement;
    keydown(row, "Tab");
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async (): Promise<void> => {
      root.render(
        <CommandMenu
          open={false}
          groups={sampleGroups()}
          ariaLabel="Application menu"
          onClose={onClose}
          openerRef={openerRef}
        />,
      );
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
    cleanup();
  });

  it("flattenCommandGroups marks heading, separator and row lines", () => {
    const flat = flattenCommandGroups(sampleGroups());
    expect(flat.filter((row) => row.kind === "heading")).toHaveLength(2);
    expect(flat.filter((row) => row.kind === "sep")).toHaveLength(1);
    const rowIds = flat
      .filter((row): row is { kind: "row"; key: string; item: CommandMenuItem } => row.kind === "row")
      .map((row) => row.item.id);
    expect(rowIds).toEqual(["open", "save", "merge", "theme", "more"]);
  });
});

// TFL-855 chunk C8 — the additive capabilities the thumbnail context menu
// needs: a per-row variant + legacy row hooks, a fixed pointer anchor, and
// scroll dismissal. All default off so C5/C7 adopters are unchanged.
describe("TFL-998 — CommandMenu additive capabilities", () => {
  it("applies a row variant, rowClassName and rowDataAttrs without touching the base row contract", () => {
    const groups: CommandMenuGroup[] = [
      {
        id: "page",
        label: "Page 2",
        entries: [
          { id: "rotate-cw", label: "Rotate CW", action: "rotate-cw" },
          {
            id: "delete",
            label: "Delete…",
            action: "delete",
            variant: "danger",
            rowClassName: "context-menu-item context-menu-item-danger",
            rowDataAttrs: { "data-menu-item": "delete" },
          },
        ],
      },
    ];
    const { container, cleanup } = mount(
      <CommandMenu open groups={groups} ariaLabel="Page 2 actions" onClose={vi.fn()} />,
    );
    const del = container.querySelector<HTMLButtonElement>('[data-menu-item="delete"]');
    expect(del).not.toBeNull();
    expect(del?.classList.contains("btn")).toBe(true);
    expect(del?.classList.contains("btn-ghost")).toBe(true);
    expect(del?.classList.contains("titlebar-menu-row")).toBe(true);
    expect(del?.classList.contains("command-menu-row-danger")).toBe(true);
    expect(del?.classList.contains("context-menu-item")).toBe(true);
    expect(del?.classList.contains("context-menu-item-danger")).toBe(true);
    expect(del?.getAttribute("data-menu-variant")).toBe("danger");
    // A plain row keeps the base class set only, with no variant hook.
    const rotate = container.querySelector<HTMLButtonElement>('[data-menu-action="rotate-cw"]');
    expect(rotate?.getAttribute("data-menu-variant")).toBeNull();
    expect(rotate?.classList.contains("command-menu-row-danger")).toBe(false);
    cleanup();
  });

  it("honours an explicit fixed position and leaves the default flow placement alone", () => {
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={vi.fn()}
        position={{ left: 120, top: 90 }}
      />,
    );
    const menu = container.querySelector<HTMLElement>(".command-menu");
    expect(menu?.style.position).toBe("fixed");
    expect(menu?.style.left).toBe("120px");
    expect(menu?.style.top).toBe("90px");
    cleanup();

    const flow = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={vi.fn()} />,
    );
    const flowMenu = flow.container.querySelector<HTMLElement>(".command-menu");
    expect(flowMenu?.style.position).toBe("");
    flow.cleanup();
  });

  // TFL-1012 (TFL-855 chunk C10) — the portaled ActionDock Pin/Unpin menu keeps
  // its own outside-dismiss, so it observes the rendered root through this
  // additive ref. Default-none; the primitive's own dismissal is unchanged.
  it("surfaces the rendered root through popoverRef for adopter outside-dismiss wiring", () => {
    const popoverRef: { current: HTMLDivElement | null } = { current: null };
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={vi.fn()}
        popoverRef={popoverRef}
      />,
    );
    const menu = container.querySelector<HTMLElement>(".command-menu");
    expect(menu).not.toBeNull();
    expect(popoverRef.current).toBe(menu);
    cleanup();
  });

  it("dismisses on a capture-phase scroll without swallowing the scroll event", () => {
    const onClose = vi.fn();
    const onScroll = vi.fn();
    document.addEventListener("scroll", onScroll, true);
    const { container, cleanup } = mount(
      <CommandMenu
        open
        groups={sampleGroups()}
        ariaLabel="Application menu"
        onClose={onClose}
        dismissOnScroll
      />,
    );
    const scroller = document.createElement("div");
    container.appendChild(scroller);
    act((): void => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The listener never swallowed the gesture: other capture listeners ran.
    expect(onScroll).toHaveBeenCalled();
    document.removeEventListener("scroll", onScroll, true);
    cleanup();
  });

  it("does not listen for scroll unless dismissOnScroll is enabled", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <CommandMenu open groups={sampleGroups()} ariaLabel="Application menu" onClose={onClose} />,
    );
    const scroller = document.createElement("div");
    container.appendChild(scroller);
    act((): void => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });
});

