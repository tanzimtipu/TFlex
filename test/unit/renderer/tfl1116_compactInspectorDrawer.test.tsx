// @vitest-environment jsdom
//
// TFL-1117 (R01) — the compact Inspector drawer.
//
// Below the dock ladder's Inspector threshold the panel cannot reserve a grid
// column, so activating "Expand inspector" must OPEN the Inspector as an
// overlay drawer over the canvas. These specs pin the pure surface resolver,
// the drawer root hook, the close control, Escape dismissal and focus return
// to the Expand opener.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Inspector, type InspectorProps } from "../../../src/renderer/components/Inspector";
import { resolveInspectorSurface } from "../../../src/renderer/state/dockResponsive";

interface Harness {
  host: HTMLElement;
  rerender: (next: InspectorProps) => void;
  unmount: () => void;
}

function renderInspector(initial: InspectorProps): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(<Inspector {...initial} />);
  });
  return {
    host,
    rerender: (next: InspectorProps): void => {
      act((): void => {
        root.render(<Inspector {...next} />);
      });
    },
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("TFL-1117 (R01) — resolveInspectorSurface", () => {
  it("compact widths use the drawer only while the open intent is set", () => {
    expect(resolveInspectorSurface(960, false, false)).toBe("collapsed");
    expect(resolveInspectorSurface(960, false, true)).toBe("drawer");
    expect(resolveInspectorSurface(960, true, true)).toBe("drawer");
  });

  it("wide widths keep the persisted expanded/collapsed preference", () => {
    expect(resolveInspectorSurface(1200, false, false)).toBe("expanded");
    expect(resolveInspectorSurface(1200, true, false)).toBe("collapsed");
    expect(resolveInspectorSurface(1200, false, true)).toBe("expanded");
  });
});

describe("TFL-1117 (R01) — the compact Inspector drawer surface", () => {
  it("renders the overlay root hook while the drawer is open", () => {
    const view = renderInspector({ stage: "pages", drawer: true, onClose: vi.fn() });
    try {
      const root = view.host.querySelector("[data-inspector]");
      expect(root).not.toBeNull();
      expect(root?.classList.contains("inspector-drawer")).toBe(true);
      expect(root?.getAttribute("data-inspector-drawer")).toBe("true");
      expect(view.host.querySelector("[data-inspector-close]")).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("closes on the close control and on Escape", () => {
    const onClose = vi.fn();
    const view = renderInspector({ stage: "pages", drawer: true, onClose });
    try {
      act((): void => {
        (view.host.querySelector("[data-inspector-close]") as HTMLElement).click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  it("does not bind Escape when the panel is not a drawer", () => {
    const onClose = vi.fn();
    const view = renderInspector({ stage: "pages", onClose });
    try {
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(view.host.querySelector("[data-inspector-drawer]")?.getAttribute("data-inspector-drawer")).toBe("false");
    } finally {
      view.unmount();
    }
  });

  it("returns focus to the Expand opener once the drawer closes", () => {
    const onToggleCollapsed = vi.fn();
    const view = renderInspector({
      stage: "pages",
      drawer: true,
      onClose: vi.fn(),
      onToggleCollapsed,
    });
    try {
      view.rerender({
        stage: "pages",
        collapsed: true,
        drawer: false,
        onClose: undefined,
        onToggleCollapsed,
      });
      const opener = view.host.querySelector<HTMLElement>("[data-inspector-collapse]");
      expect(opener).not.toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      view.unmount();
    }
  });
});