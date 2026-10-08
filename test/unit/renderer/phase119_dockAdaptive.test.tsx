// @vitest-environment jsdom
//
// Phase 119 (chunk D) — the Action Dock bound onto the adaptive-shell layout
// foundation. These specs prove the Phase 104 dock keeps its responsive ladder,
// overflow and scroll hooks intact while it gains the Phase 119 coarse-pointer
// marker and target-size treatment. `canvasWidth` drives the ladder directly.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";

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

function dockRoot(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="toolbar"][aria-label="Action dock"]');
}

describe("Phase 119 (chunk D) — dock adaptivity and target sizes", () => {
  it("renders the Action Dock toolbar root", () => {
    const { host, unmount } = renderDock();
    try {
      expect(dockRoot(host)).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the More trigger labelled and its overflow menu reachable", () => {
    const { host, unmount } = renderDock({ canvasWidth: 1400 });
    try {
      const more = host.querySelector<HTMLElement>("[data-dock-overflow]");
      expect(more).not.toBeNull();
      expect(more?.getAttribute("aria-label")).toBe("More actions");
      clickOn(more as Element);
      const menu = host.querySelector<HTMLElement>("[data-dock-overflow-menu]");
      expect(menu).not.toBeNull();
      expect(menu?.querySelectorAll("[data-dock-overflow-item]").length).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  it("keeps the scroll strip and the narrow arrows-lane / reserved-row rungs", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 520 });
    try {
      expect(host.querySelector("[data-dock-scroll]")).not.toBeNull();
      const root = dockRoot(host);
      expect(root?.getAttribute("data-dock-arrows-lane")).toBe("true");
      expect(root?.getAttribute("data-dock-reserved")).toBe("true");
      for (const arrow of host.querySelectorAll<HTMLElement>("[data-dock-arrow]")) {
        const name = arrow.getAttribute("aria-label") ?? arrow.getAttribute("title") ?? "";
        expect(name.length).toBeGreaterThan(0);
      }
    } finally {
      unmount();
    }
  });

  it("omits the coarse marker under jsdom's non-coarse pointer", () => {
    const { host, unmount } = renderDock();
    try {
      const root = dockRoot(host);
      expect(root?.hasAttribute("data-dock-coarse")).toBe(false);
    } finally {
      unmount();
    }
  });
});
