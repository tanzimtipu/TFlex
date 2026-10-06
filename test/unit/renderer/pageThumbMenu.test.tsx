// @vitest-environment jsdom
//
// TFL-855 chunk C8 — the thumbnail right-click menu adopted the shared
// `CommandMenu` primitive. This spec pins the migration's contract directly on
// the controller: the six page verbs survive with their `[data-menu-item]`
// hooks and delete's danger styling, the legacy `[data-context-menu]` /
// `[data-page]` root hooks still resolve, the menu opens fixed at the pointer,
// row activation runs the handler and closes, and scroll / Escape / outside
// pointerdown all dismiss without swallowing the gesture.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import {
  usePageThumbMenu,
  type PageMenuHandlers,
} from "../../../src/renderer/components/pageThumbMenu";

let capturedOpen: ((page: number, x: number, y: number) => void) | null = null;

function Harness({ handlers }: { handlers: PageMenuHandlers }): ReactElement {
  const { openMenu, menuNode } = usePageThumbMenu(handlers);
  capturedOpen = openMenu;
  return <div data-host>{menuNode}</div>;
}

function makeHandlers(): PageMenuHandlers {
  return {
    onRotateCw: vi.fn(),
    onRotateCcw: vi.fn(),
    onExtract: vi.fn(),
    onInsertBlank: vi.fn(),
    onReplace: vi.fn(),
    onDeletePage: vi.fn(),
  };
}

function mount(handlers: PageMenuHandlers): {
  host: HTMLElement;
  root: Root;
  cleanup: () => void;
} {
  capturedOpen = null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<Harness handlers={handlers} />);
  });
  return {
    host,
    root,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function openAt(page: number, x = 120, y = 90): void {
  act((): void => {
    capturedOpen?.(page, x, y);
  });
}

const row = (host: HTMLElement, id: string): HTMLButtonElement => {
  const el = host.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`);
  if (el === null) throw new Error(`no menu row ${id}`);
  return el;
};

function firePointer(target: EventTarget, type: string): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  });
}

beforeEach((): void => {
  // jsdom defaults: innerWidth 1024 / innerHeight 768, so 120/90 stays mid-window.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});

afterEach((): void => {
  capturedOpen = null;
});

describe("TFL-998 — thumbnail context menu on CommandMenu", () => {
  it("renders the SIX page verbs with data-menu-item, danger styling and legacy root hooks", () => {
    const handlers = makeHandlers();
    const { host, cleanup } = mount(handlers);
    try {
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      openAt(2);
      const menu = host.querySelector("[data-context-menu]");
      expect(menu).not.toBeNull();
      expect(menu?.getAttribute("data-page")).toBe("2");
      expect(menu?.getAttribute("role")).toBe("menu");
      expect(menu?.getAttribute("aria-label")).toBe("Page 2 actions");
      expect(
        [...host.querySelectorAll("[data-menu-item]")].map((el) => el.textContent),
      ).toEqual([
        "Rotate CW",
        "Rotate CCW",
        "Extract…",
        "Insert blank after",
        "Replace…",
        "Delete…",
      ]);
      const del = row(host, "delete");
      expect(del.classList.contains("context-menu-item")).toBe(true);
      expect(del.classList.contains("context-menu-item-danger")).toBe(true);
      expect(del.classList.contains("command-menu-row-danger")).toBe(true);
      expect(row(host, "rotate-cw").classList.contains("context-menu-item-danger")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("runs the row's handler with the menu's page and closes on activation", () => {
    const handlers = makeHandlers();
    const { host, cleanup } = mount(handlers);
    try {
      openAt(4);
      firePointer(row(host, "rotate-cw"), "click");
      expect(handlers.onRotateCw).toHaveBeenCalledTimes(1);
      expect(handlers.onRotateCw).toHaveBeenCalledWith(4);
      expect(host.querySelector("[data-context-menu]")).toBeNull();

      openAt(4);
      firePointer(row(host, "delete"), "click");
      expect(handlers.onDeletePage).toHaveBeenCalledWith(4);
      expect(host.querySelector("[data-context-menu]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("opens fixed at the clamped pointer coordinates", () => {
    const handlers = makeHandlers();
    const { host, cleanup } = mount(handlers);
    try {
      openAt(3, 120, 90);
      const menu = host.querySelector<HTMLElement>("[data-context-menu]");
      expect(menu?.style.position).toBe("fixed");
      expect(menu?.style.left).toBe("120px");
      expect(menu?.style.top).toBe("90px");
    } finally {
      cleanup();
    }
  });

  it("closes on scroll without swallowing the event", () => {
    const handlers = makeHandlers();
    const onScroll = vi.fn();
    document.addEventListener("scroll", onScroll, true);
    const { host, cleanup } = mount(handlers);
    try {
      openAt(2);
      const scroller = document.createElement("div");
      host.appendChild(scroller);
      act((): void => {
        scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
      });
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      expect(onScroll).toHaveBeenCalled();
    } finally {
      document.removeEventListener("scroll", onScroll, true);
      cleanup();
    }
  });

  it("closes on Escape without swallowing the key event", () => {
    const handlers = makeHandlers();
    const onKeyDown = vi.fn();
    document.addEventListener("keydown", onKeyDown);
    const { host, cleanup } = mount(handlers);
    try {
      openAt(2);
      act((): void => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      expect(onKeyDown).toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onKeyDown);
      cleanup();
    }
  });

  it("closes on an outside pointerdown without swallowing the gesture", () => {
    const handlers = makeHandlers();
    const onPointerDown = vi.fn();
    document.addEventListener("pointerdown", onPointerDown);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const { host, cleanup } = mount(handlers);
    try {
      openAt(2);
      firePointer(outside, "pointerdown");
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      expect(onPointerDown).toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", onPointerDown);
      outside.remove();
      cleanup();
    }
  });
});
