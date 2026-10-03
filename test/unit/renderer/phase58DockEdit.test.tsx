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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import { DOCK_MAX_PINS } from "../../../src/renderer/state/dockModel";
import { dockPickerIdsForStage, dockToolsForStage } from "../../../src/renderer/state/toolsRegistry";

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

  it("clicking the pen arms edit mode, a per-icon jiggle and a minus per verb", () => {
    const { host, unmount } = renderDock();
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("true");
      expect(dockRoot(host).classList.contains("anim-vibrate")).toBe(false);
      const verbs = [...host.querySelectorAll("[data-dock-verb]")];
      expect(verbs.length).toBeGreaterThan(0);
      for (const verb of verbs) {
        expect(verb.querySelector("[data-dock-minus]")).not.toBeNull();
        const icon = verb.querySelector(".action-dock-icon");
        expect(icon).not.toBeNull();
        expect(icon?.classList.contains("anim-jiggle")).toBe(true);
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
      expect(host.querySelector(".action-dock-icon.anim-jiggle")).toBeNull();
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

// ---------------------------------------------------------------------------
// Phase 59 (item 3) — the pen lives INSIDE the dock, and add / remove animates
// ---------------------------------------------------------------------------

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** Every rule body whose selector LIST contains `selector` exactly (comment
 *  free), the same shape the stylesheet-contract suites use. */
function ruleBodies(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) =>
      (m[1] ?? "").split(",").some((s) => s.trim() === selector),
    )
    .map((m) => m[2] ?? "");
}

describe("Phase 59 (item 3) — the pen is contained by the dock", () => {
  it("renders the pen as a real descendant of the dock root", () => {
    const { host, unmount } = renderDock();
    try {
      const dock = dockRoot(host);
      const pen = host.querySelector<HTMLElement>("[data-dock-edit-toggle]");
      if (pen === null) throw new Error("no pen");
      expect(dock.contains(pen)).toBe(true);
      expect(pen.closest("[data-action-dock]")).toBe(dock);
      // A DIRECT child: an in-row flex item, not a floating overlay.
      expect(pen.parentElement).toBe(dock);
    } finally {
      unmount();
    }
  });

  it("carries no rule that offsets the pen outside the dock's box", () => {
    const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Phase 91 (Feature C1) — the pen now carries `btn btn-ghost btn-icon
    // btn-toggle`; its measured geometry lives on the `.btn.action-dock-edit`
    // alias while the scoped legacy rule remains for the un-migrated hook. The
    // containment contract is asserted across both.
    const bodies = [
      ...ruleBodies(css, ".action-dock-edit:not(.btn)"),
      ...ruleBodies(css, ".btn.action-dock-edit"),
    ];
    expect(bodies.length).toBeGreaterThan(0);
    // The base rule makes it a row item that can neither leave nor overrun.
    const base = bodies[0] ?? "";
    expect(base).toMatch(/display:\s*inline-flex/);
    expect(base).toMatch(/flex:\s*0 0 auto/);
    for (const body of bodies) {
      // No absolute positioning and no inset offsets at all — a negative
      // top/right is exactly what parked the pen outside the chrome.
      expect(body).not.toMatch(/position:\s*absolute/);
      expect(body, "the pen must declare no top/left/right/bottom").not.toMatch(
        /(?:^|[\s;{])(?:top|left|right|bottom)\s*:/,
      );
      expect(body, "the pen must not translate out of its box").not.toMatch(
        /(?:^|[\s;{])translate\s*:/,
      );
      expect(body).not.toMatch(/transform\s*:[^;]*translate/);
    }
    // Belt and braces: no `.action-dock-edit` rule anywhere uses a negative
    // inset (the contract is global, not just the first match).
    expect(css).not.toMatch(
      /\.action-dock-edit[^{]*\{[^}]*(?:top|left|right|bottom)\s*:\s*-/,
    );
  });
});

describe("Phase 59 (item 3) — adding / removing a dock tool animates", () => {
  it("blooms a newly added verb in, from its first paint", () => {
    vi.useFakeTimers();
    try {
      const onPinTool = vi.fn();
      const { host, rerender, unmount } = renderDock({ onPinTool });
      try {
        clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
        clickOn(host.querySelector("[data-dock-plus]") as Element);
        const item = host.querySelector<HTMLElement>("[data-dock-picker-item]");
        if (item === null) throw new Error("no picker item");
        const id = item.getAttribute("data-dock-picker-item") ?? "";
        clickOn(item);
        expect(onPinTool).toHaveBeenCalledWith(id);
        // The host's pin lands on the next render. The id was recorded BEFORE
        // that render, so the verb's first paint already carries the entry
        // animation — never an un-animated flash of the new verb.
        rerender({ dockPins: [id] });
        const added = host.querySelector<HTMLElement>(`[data-dock-verb="${id}"]`);
        expect(added).not.toBeNull();
        expect(added?.classList.contains("anim-verb-in")).toBe(true);
        expect(added?.hasAttribute("data-dock-exiting")).toBe(false);
        // The bloom is transient: once its token window passes the class is gone.
        act((): void => {
          vi.advanceTimersByTime(400);
        });
        const settled = host.querySelector<HTMLElement>(`[data-dock-verb="${id}"]`);
        expect(settled).not.toBeNull();
        expect(settled?.classList.contains("anim-verb-in")).toBe(false);
      } finally {
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a removed verb in its own slot behind the out animation, then drops it", () => {
    vi.useFakeTimers();
    try {
      const onUnpinTool = vi.fn();
      const onRunTool = vi.fn();
      const { host, rerender, unmount } = renderDock({
        dockPins: ["zoomIn", "fitWidth"],
        onUnpinTool,
        onRunTool,
      });
      try {
        clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
        const minus = host.querySelector('[data-dock-minus="zoomIn"]');
        if (minus === null) throw new Error("no minus");
        clickOn(minus);
        // The host write is NOT delayed; the ghost only holds the slot.
        expect(onUnpinTool).toHaveBeenCalledWith("zoomIn");
        expect(onRunTool).not.toHaveBeenCalled();
        // The host applies the unpin on its next render.
        rerender({ dockPins: ["fitWidth"] });
        const ghosts = [...host.querySelectorAll<HTMLElement>('[data-dock-exiting="zoomIn"]')];
        expect(ghosts).toHaveLength(1);
        const ghost = ghosts[0];
        expect(ghost?.classList.contains("anim-verb-out")).toBe(true);
        // Exactly ONE element for the id: the live verb is filtered out for the
        // whole collapse, so the ghost can never be a duplicate.
        expect(host.querySelectorAll('[data-dock-verb="zoomIn"]')).toHaveLength(1);
        // It stays in the slot it held (index 0), before the surviving pin.
        const survivor = host.querySelector('[data-dock-verb="fitWidth"]');
        expect(survivor).not.toBeNull();
        expect(
          ((ghost?.compareDocumentPosition(survivor as Node) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        ).toBe(true);
        // The ghost is inert: no minus, out of the tab order, aria-disabled.
        expect(ghost?.querySelector("[data-dock-minus]")).toBeNull();
        expect(ghost?.getAttribute("tabindex")).toBe("-1");
        expect(ghost?.getAttribute("aria-disabled")).toBe("true");
        // After the collapse window it is gone entirely.
        act((): void => {
          vi.advanceTimersByTime(400);
        });
        expect(host.querySelector('[data-dock-exiting="zoomIn"]')).toBeNull();
        expect(host.querySelector('[data-dock-verb="zoomIn"]')).toBeNull();
      } finally {
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("removing the LAST verb still lands in the coherent empty edit state", () => {
    vi.useFakeTimers();
    try {
      const allPrimary = dockToolsForStage("pages").map((t) => t.id);
      const { host, rerender, unmount } = renderDock({
        dockPins: ["zoomIn"],
        dockUnpinned: allPrimary,
      });
      try {
        // The pin is the only verb on screen.
        expect(host.querySelectorAll("[data-dock-verb]")).toHaveLength(1);
        clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
        clickOn(host.querySelector('[data-dock-minus="zoomIn"]') as Element);
        // The pins section stays mounted for the ghost even though the last
        // live pin is already gone.
        rerender({ dockPins: [] });
        expect(host.querySelector('[data-dock-exiting="zoomIn"]')).not.toBeNull();
        act((): void => {
          vi.advanceTimersByTime(400);
        });
        expect(host.querySelectorAll("[data-dock-verb]")).toHaveLength(0);
        // The empty EDIT state is coherent: the dock, the pen and the plus all
        // remain, and edit mode is still armed.
        expect(dockRoot(host).getAttribute("data-dock-edit")).toBe("true");
        expect(host.querySelector("[data-dock-edit-toggle]")).not.toBeNull();
        expect(host.querySelector("[data-dock-plus]")).not.toBeNull();
      } finally {
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});