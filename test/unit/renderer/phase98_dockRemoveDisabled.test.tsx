// @vitest-environment jsdom
//
// TFL-660 (TFL-520 chunk A) — a DISABLED (greyed) dock verb is removable in
// EDIT mode.
//
// The minus is now a structural SIBLING of the verb button (both inside the
// `.action-dock-verb-slot`), so a `disabled` verb can never absorb the minus's
// click. jsdom does not emulate Chromium's disabled-descendant click
// suppression, so this suite asserts the STRUCTURE (the minus is outside the
// disabled control) and the wiring (the click unpins, never runs).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";

function bulk(overrides: Partial<DockBulkActions> = {}): DockBulkActions {
  return {
    onRotate: vi.fn(),
    onExtract: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
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

const clickOn = (target: Element): void => {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

describe("TFL-660 — a disabled dock verb is removable in edit mode", () => {
  it("renders the minus as a sibling of the disabled verb and unpins on click", () => {
    const onUnpinTool = vi.fn();
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      dockPins: ["undo"],
      isToolEnabled: (e) => e.id !== "undo",
      onUnpinTool,
      onRunTool,
    });
    try {
      // Arm EDIT mode so the minus renders.
      const pen = host.querySelector("[data-dock-edit-toggle]");
      expect(pen).not.toBeNull();
      clickOn(pen as Element);

      const verb = host.querySelector<HTMLElement>('[data-dock-verb="undo"]');
      expect(verb).not.toBeNull();
      expect(verb?.hasAttribute("disabled")).toBe(true);

      const minus = document.querySelector<HTMLElement>('[data-dock-minus="undo"]');
      expect(minus).not.toBeNull();
      // Structural oracle: the minus is OUTSIDE the disabled control and shares
      // its parent (the slot), so it stays clickable while the verb is greyed.
      expect(minus?.closest("button[disabled]")).toBeNull();
      expect(minus?.parentElement).toBe(verb?.parentElement);

      clickOn(minus as Element);
      expect(onUnpinTool).toHaveBeenCalledWith("undo");
      expect(onRunTool).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
