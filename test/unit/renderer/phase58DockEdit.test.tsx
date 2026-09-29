// @vitest-environment jsdom
//
// Phase 58 (chunk 3) — the Action Dock's EDIT mode.
//
// The pen arms it, every verb grows a minus affordance, a plus control at the
// row's end opens the registry-derived picker, and Escape exits. The minus is a
// span (never a nested button) that stops its OWN event so the verb's run does
// not fire.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import { DOCK_MAX_PINS } from "../../../src/renderer/state/dockModel";
import { dockPickerIdsForStage } from "../../../src/renderer/state/toolsRegistry";

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
  rerender: (next: Partial<ActionDockProps>) => void;
  unmount: () => void;
}

function renderDock(options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: ActionDockProps = {
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
  const draw = (): void => {
    act((): void => {
      root.render(<ActionDock {...current} />);
    });
  };
  draw();
  return {
    host,
    rerender: (next): void => {
      current = { ...current, ...next };
      draw();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const dockRoot = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>("[data-action-dock]");
  if (el === null) throw new Error("no dock root");
  return el;
};

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act((): void => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

describe("Phase 58 — ActionDock edit mode", () => {
  it("renders the pen toggle", () => {
    const { host, unmount } = renderDock();
    try {
      expect(host.querySelector("[data-dock-edit-toggle]")).not.toBeNull();
      expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("clicking the pen arms edit mode, the vibrate entry class and a minus per verb", () => {
    const { host, unmount } = renderDock();
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("true");
      expect(dockRoot(host).classList.contains("anim-vibrate")).toBe(true);
      const verbs = [...host.querySelectorAll("[data-dock-verb]")];
      expect(verbs.length).toBeGreaterThan(0);
      for (const verb of verbs) {
        expect(verb.querySelector("[data-dock-minus]")).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it("clicking a minus unpins that id and does NOT run the tool", () => {
    const onUnpinTool = vi.fn();
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({ onUnpinTool, onRunTool });
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      const minus = host.querySelector('[data-dock-minus="rotate"]');
      expect(minus).not.toBeNull();
      clickOn(minus as Element);
      expect(onUnpinTool).toHaveBeenCalledWith("rotate");
      expect(onRunTool).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("the plus opens the picker; picking an id pins it and the plus stays", () => {
    const onPinTool = vi.fn();
    const { host, unmount } = renderDock({ onPinTool });
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      const plus = host.querySelector("[data-dock-plus]");
      expect(plus).not.toBeNull();
      clickOn(plus as Element);
      const item = host.querySelector("[data-dock-picker-item]");
      expect(item).not.toBeNull();
      const id = item?.getAttribute("data-dock-picker-item") ?? "";
      clickOn(item as Element);
      expect(onPinTool).toHaveBeenCalledWith(id);
      expect(host.querySelector("[data-dock-plus]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("Escape exits edit mode", () => {
    const { host, unmount } = renderDock();
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("true");
      pressEscape();
      expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("false");
      expect(dockRoot(host).classList.contains("anim-vibrate")).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe("Phase 58 — the picker set and the raised cap", () => {
  it("dockPickerIdsForStage('review') includes a global dock id and excludes panel/flyout ids", () => {
    const ids = dockPickerIdsForStage("review");
    // A GLOBAL dock tool (Undo) can live in any dock.
    expect(ids).toContain("undo");
    // A stage-relevant REVIEW verb is included.
    expect(ids).toContain("annotate");
    // Panel / flyout surfaces are NOT dock tools.
    expect(ids).not.toContain("annotationsPanel");
    expect(ids).not.toContain("annHighlight");
    // A GLOBAL panel tool (Zoom in) is not a dock tool either.
    expect(ids).not.toContain("zoomIn");
  });

  it("raises the dock pin cap to the main-process cap", () => {
    expect(DOCK_MAX_PINS).toBe(200);
  });
});