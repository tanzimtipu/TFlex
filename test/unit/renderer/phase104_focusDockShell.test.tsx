// @vitest-environment jsdom
//
// Phase 104 (chunk 1) — the Focus Dock shell.
//
//   (a) the labelled Tools button (`[data-dock-tools]`) renders and opens the
//       existing command palette through `onOpenTools`;
//   (b) the retired detached `[data-dock-hint]` is gone;
//   (c) the More overflow menu carries `[data-dock-menu-item="customize"]`,
//       which toggles the EXISTING dock EDIT mode (minus badges appear);
//   (d) a persistent active verb (`aria-pressed`) carries the selected tile
//       class while an export verb carries no permanent selected styling.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import type { DockLadder } from "../../../src/renderer/state/dockResponsive";

/** Compact, icon-only, no arrows: keeps the `...` overflow lane on so the More
 *  menu (which hosts Customize dock) renders, exactly as the dock does before
 *  chunk 2's stable More + Tools arrangement. */
const MORE_LADDER: DockLadder = {
  inspectorCollapsed: true,
  panelCollapsed: true,
  iconOnly: true,
  arrows: false,
};

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

const SELECTED = "action-dock-verb-selected";

describe("Phase 104 (chunk 1) — the Tools utility button", () => {
  it("renders a labelled Tools button and calls onOpenTools on click", () => {
    const onOpenTools = vi.fn();
    const { host, unmount } = renderDock({ canvasWidth: 1400, onOpenTools });
    try {
      const tools = host.querySelector<HTMLElement>("[data-dock-tools]");
      expect(tools).not.toBeNull();
      expect(tools?.textContent?.replace(/\s+/g, " ").trim()).toBe("All commands");
      clickOn(tools as Element);
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("replaces the retired detached hint", () => {
    const { host, unmount } = renderDock({ canvasWidth: 1400 });
    try {
      expect(host.querySelector("[data-dock-hint]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 104 (chunk 1) — Customize dock lives in More", () => {
  it("the More overflow menu carries a Customize dock item that toggles EDIT mode", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 100,
      ladder: MORE_LADDER,
    });
    try {
      // No minus badges before arming.
      expect(host.querySelector("[data-dock-minus]")).toBeNull();
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const customize = host.querySelector('[data-dock-menu-item="customize"]');
      expect(customize).not.toBeNull();
      clickOn(customize as Element);
      const dock = host.querySelector("[data-action-dock]");
      expect(dock?.getAttribute("data-dock-edit")).toBe("true");
      expect(host.querySelector("[data-dock-minus]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 104 (chunk 1) — selected tile discipline", () => {
  it("gives a persistent active verb the selected tile class", () => {
    const { host, unmount } = renderDock({
      activeStage: "edit",
      canvasWidth: 1400,
      activeToolIds: ["editToolOff"],
    });
    try {
      const active = host.querySelector<HTMLElement>('[data-dock-verb="editToolOff"]');
      expect(active?.classList.contains(SELECTED)).toBe(true);
      expect(active?.getAttribute("aria-pressed")).toBe("true");
      const idle = host.querySelector<HTMLElement>('[data-dock-verb="editText"]');
      expect(idle?.classList.contains(SELECTED)).toBe(false);
    } finally {
      unmount();
    }
  });

  it("never gives an export verb permanent selected styling", () => {
    const { host, unmount } = renderDock({
      activeStage: "deliver",
      canvasWidth: 1400,
      // Even if the host names an export verb active, it stays momentary.
      activeToolIds: ["exportDocx"],
    });
    try {
      const exportDocx = host.querySelector<HTMLElement>('[data-dock-verb="exportDocx"]');
      expect(exportDocx).not.toBeNull();
      expect(exportDocx?.classList.contains(SELECTED)).toBe(false);
      expect(exportDocx?.getAttribute("aria-pressed")).toBeNull();
    } finally {
      unmount();
    }
  });
});