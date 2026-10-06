// @vitest-environment jsdom
//
// Phase 36 (chunk 3a) — the Action Dock's four states.
//
// The dock is ADDITIVE in this chunk (the toolbar, rail, palette and flyout all
// stay), so these tests pin its contract: contents straight from the registry,
// the selection override + its bulk callbacks, the pin rules (order, dedupe,
// cap, right-click), the idle rule (never while armed/dragging, restored by
// hover/keyboard) and the responsive label-drop / `...` overflow.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ActionDock, type ActionDockProps, type DockBulkActions } from "../../../src/renderer/components/ActionDock";
import { DOCK_IDLE_MS, DOCK_MAX_PINS, canPinMore } from "../../../src/renderer/state/dockModel";
import { dockPrimaryIdsForStage } from "../../../src/renderer/state/toolsRegistry";

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

const verbs = (host: HTMLElement, group?: "primary" | "pins"): HTMLElement[] => {
  const scope =
    group === undefined
      ? host
      : host.querySelector<HTMLElement>(`[data-dock-group="${group}"]`) ?? host;
  return [...scope.querySelectorAll<HTMLElement>("[data-dock-verb]")];
};

const verbIds = (host: HTMLElement, group?: "primary" | "pins"): string[] =>
  verbs(host, group).map((el) => el.getAttribute("data-dock-verb") ?? "");

const verb = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-dock-verb="${id}"]`);
  if (el === null) throw new Error(`no verb ${id}`);
  return el;
};

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function contextMenuOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 36 — ActionDock State 1: stage verbs", () => {
  it("renders the CURATED registry entry set for the active stage", () => {
    const { host, unmount } = renderDock({ activeStage: "pages" });
    try {
      expect(host.querySelector("[data-dock-state]")?.getAttribute("data-dock-state")).toBe("stage");
      // Phase 104 (chunk 2) — the visible tiles are the curated primaries; the
      // remaining stage verbs live in the stable More menu.
      expect(verbIds(host, "primary")).toEqual([...dockPrimaryIdsForStage("pages")]);
    } finally {
      unmount();
    }
  });

  it("swaps the whole set when the stage changes", () => {
    const { host, rerender, unmount } = renderDock({ activeStage: "deliver" });
    try {
      expect(verbIds(host, "primary")).toEqual([...dockPrimaryIdsForStage("deliver")]);
      rerender({ activeStage: "review" });
      expect(verbIds(host, "primary")).toEqual([...dockPrimaryIdsForStage("review")]);
    } finally {
      unmount();
    }
  });

  it("does NOT render the flyout-hosted annotation verbs (one home, no duplicate set)", () => {
    const { host, unmount } = renderDock({ activeStage: "review" });
    try {
      // The one Annotate primary references the whole annotation set...
      expect(verbIds(host, "primary")[0]).toBe("annotate");
      // ...and the dock renders NO second copy of the individual tools.
      const FLYOUT_IDS = [
        "annSelect", "annHighlight", "annUnderline", "annStrikeout", "annInk",
        "annTextbox", "annRect", "annEllipse", "annArrow", "annCallout",
        "annNote", "annColor", "annPenWidth",
      ];
      for (const id of FLYOUT_IDS) {
        expect(verbIds(host, "primary"), id).not.toContain(id);
      }
    } finally {
      unmount();
    }
  });

  it("gives the FIRST button the stage-primary treatment (lead-command class, not a selected look)", () => {
    const { host, unmount } = renderDock({ activeStage: "deliver" });
    try {
      const first = verbs(host, "primary")[0];
      expect(first.className).toContain("action-dock-verb-primary");
      expect(verbs(host, "primary")[1].className).not.toContain("action-dock-verb-primary");
    } finally {
      unmount();
    }
  });

  it("DISABLES an unavailable verb (never hides it) and shows the availability reason", () => {
    // DEF-311 — a disabled verb's tooltip is the registry's declared
    // availability copy, never the tool's description.
    const { host, unmount } = renderDock({
      activeStage: "deliver",
      isToolEnabled: (entry) => entry.id !== "audit",
    });
    try {
      // Phase 104 (chunk 2) — `audit` is a displaced DELIVER verb, so it lives
      // in the stable More menu; it is still present and still disabled.
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const audit = host.querySelector<HTMLElement>('[data-dock-overflow-item="audit"]');
      expect(audit).not.toBeNull();
      expect(audit?.hasAttribute("disabled")).toBe(true);
      // `audit` declares availability 'document'.
      expect(audit?.getAttribute("title")).toBe("Open a document first");
    } finally {
      unmount();
    }
  });

  it("runs the host's existing handler for a verb click", () => {
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "deliver", onRunTool });
    try {
      clickOn(verb(host, "optimize"));
      expect(onRunTool).toHaveBeenCalledWith("optimize");
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 — ActionDock State 2: selection override", () => {
  it("renders the chip plus Rotate / Extract / Delete / Clear (no Merge — ruling 9)", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", pageSelection: [2, 4] });
    try {
      expect(host.querySelector("[data-dock-state]")?.getAttribute("data-dock-state")).toBe(
        "selection",
      );
      expect(host.querySelector("[data-dock-chip]")?.textContent).toBe("2 pages");
      expect(verbIds(host, "primary")).toEqual([
        "rotate",
        "extract",
        "delete",
        "clearPageSelection",
      ]);
    } finally {
      unmount();
    }
  });

  it("calls the bulk callbacks with the selected page array", () => {
    const b = bulk();
    const { host, unmount } = renderDock({ activeStage: "pages", pageSelection: [1, 3], bulk: b });
    try {
      clickOn(verb(host, "rotate"));
      clickOn(verb(host, "extract"));
      clickOn(verb(host, "delete"));
      expect(b.onRotate).toHaveBeenCalledWith([1, 3]);
      expect(b.onExtract).toHaveBeenCalledWith([1, 3]);
      expect(b.onDelete).toHaveBeenCalledWith([1, 3]);
    } finally {
      unmount();
    }
  });

  it("State 2 is EXACTLY [chip] | Rotate · Extract · Delete · Clear (no merge verb)", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", pageSelection: [1] });
    try {
      expect(verbIds(host, "primary")).toEqual([
        "rotate",
        "extract",
        "delete",
        "clearPageSelection",
      ]);
      // Section 3A ruling 9 — Merge is not a dock verb in any state.
      expect(host.querySelector('[data-dock-verb="merge"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("Clear empties the selection and returns to State 1", () => {
    const onClearPageSelection = vi.fn();
    const { host, rerender, unmount } = renderDock({
      activeStage: "pages",
      pageSelection: [1],
      onClearPageSelection,
    });
    try {
      clickOn(verb(host, "clearPageSelection"));
      expect(onClearPageSelection).toHaveBeenCalledTimes(1);
      rerender({ pageSelection: [] });
      expect(host.querySelector("[data-dock-state]")?.getAttribute("data-dock-state")).toBe("stage");
      expect(host.querySelector("[data-dock-chip]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("does NOT override the stage verbs outside PAGES", () => {
    const { host, unmount } = renderDock({ activeStage: "review", pageSelection: [2] });
    try {
      expect(host.querySelector("[data-dock-state]")?.getAttribute("data-dock-state")).toBe("stage");
      expect(host.querySelector("[data-dock-chip]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 — ActionDock State 3: pins", () => {
  it("renders pins after a divider, in order", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockPins: ["undo", "redo"] });
    try {
      expect(host.querySelector("[data-dock-divider]")).not.toBeNull();
      expect(verbIds(host, "pins")).toEqual(["undo", "redo"]);
    } finally {
      unmount();
    }
  });

  it("does not duplicate a pin already in the current stage set (divider collapses)", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockPins: ["rotate"] });
    try {
      expect(host.querySelector("[data-dock-divider]")).toBeNull();
      expect(host.querySelector("[data-dock-pin]")).toBeNull();
      // `rotate` still renders exactly once, as a stage verb.
      expect(verbs(host).filter((v) => v.getAttribute("data-dock-verb") === "rotate")).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it("drops unknown pin ids (the Phase-58 cap is effectively unlimited)", () => {
    const { host, unmount } = renderDock({
      activeStage: "deliver",
      dockPins: ["undo", "not-a-tool", "redo", "openReadingView", "openComicView"],
    });
    try {
      expect(verbIds(host, "pins")).toEqual(["undo", "redo", "openReadingView", "openComicView"]);
    } finally {
      unmount();
    }
  });

  it("right-click offers Pin and Unpin, and each calls the host", () => {
    const onPinTool = vi.fn();
    const onUnpinTool = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "pages", onPinTool, onUnpinTool });
    try {
      contextMenuOn(verb(host, "merge"));
      const pin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="pin"]');
      const unpin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="unpin"]');
      expect(pin).not.toBeNull();
      expect(unpin).not.toBeNull();
      expect(pin?.hasAttribute("disabled")).toBe(false);
      // Phase 37 item 21 — a default stage verb can be unpinned (the host
      // records it in `dockUnpinned`), so Unpin is enabled for any verb.
      expect(unpin?.hasAttribute("disabled")).toBe(false);
      clickOn(pin as Element);
      expect(onPinTool).toHaveBeenCalledWith("merge");
    } finally {
      unmount();
    }
  });

  it("right-clicking a pinned verb offers Unpin and calls the host", () => {
    const onUnpinTool = vi.fn();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      dockPins: ["undo"],
      onUnpinTool,
    });
    try {
      contextMenuOn(verb(host, "undo"));
      const unpin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="unpin"]');
      expect(unpin?.hasAttribute("disabled")).toBe(false);
      clickOn(unpin as Element);
      expect(onUnpinTool).toHaveBeenCalledWith("undo");
    } finally {
      unmount();
    }
  });

  it("keeps Pin enabled below the effectively-unlimited Phase-58 cap", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      dockPins: ["undo", "redo", "openReadingView", "openComicView"],
    });
    try {
      contextMenuOn(verb(host, "merge"));
      const pin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="pin"]');
      // The cap is 200 (and only 109 registry ids exist), so four pins is far
      // below it: the Pin item stays enabled and carries no refusal title.
      expect(pin?.hasAttribute("disabled")).toBe(false);
      expect(pin?.getAttribute("title")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("TFL-1012 (TFL-855 chunk C10) — the Pin/Unpin menu is the shared CommandMenu", () => {
  it("portals the shared surface to the body with both data-dock-menu-item rows", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockPins: ["undo"] });
    try {
      contextMenuOn(verb(host, "undo"));
      const menu = document.body.querySelector<HTMLElement>("[data-dock-menu]");
      expect(menu, "the shared surface resolves via data-dock-menu").not.toBeNull();
      // The dock carries a transform, so the surface must live on the body
      // (DEF-312); it must not be a descendant of the transformed dock.
      expect(host.contains(menu as Node)).toBe(false);
      expect(menu?.querySelector('[data-dock-menu-item="pin"]'), "pin row").not.toBeNull();
      expect(menu?.querySelector('[data-dock-menu-item="unpin"]'), "unpin row").not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("disables Pin on a verb that is already pinned, keeping Unpin live", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockPins: ["undo"] });
    try {
      contextMenuOn(verb(host, "undo"));
      const pin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="pin"]');
      const unpin = document.body.querySelector<HTMLButtonElement>('[data-dock-menu-item="unpin"]');
      expect(pin?.disabled).toBe(true);
      expect(unpin?.disabled).toBe(false);
    } finally {
      unmount();
    }
  });

  it("surfaces 'Dock is full' only when the cap is reached", () => {
    // A real render can never exceed the registry size (the ~109 pinnable ids
    // are sanitized, deduped and capped at 200), so the full state is
    // unreachable through `dockPins`. Assert the predicate the menu's
    // `disabledReason` ("Dock is full") is keyed on, at the boundary.
    expect(canPinMore(new Array(DOCK_MAX_PINS - 1).fill("undo"))).toBe(true);
    expect(canPinMore(new Array(DOCK_MAX_PINS).fill("undo"))).toBe(false);
  });

  // DEF-608 — the clamp used the stale `MENU_H = 76` estimate while the migrated
  // `CommandMenu` renders taller (a group heading), so at the window floor its
  // bottom row clipped ~15px below the viewport. The fix measures the rendered
  // `[data-dock-menu]` height and re-clamps with it.
  it("clamps against the MEASURED rendered menu height so nothing clips at the viewport floor", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    // jsdom reports 0 for offsetHeight; give the rendered menu its real 114px
    // (two rows + group heading) while every other box stays unmeasured.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.hasAttribute("data-dock-menu") ? 114 : 0;
      },
    });
    try {
      const { host, unmount } = renderDock({ activeStage: "pages" });
      try {
        const nearBottom = window.innerHeight - 2;
        act((): void => {
          verb(host, "merge").dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 24,
              clientY: nearBottom,
            }),
          );
        });
        const menu = document.body.querySelector<HTMLElement>("[data-dock-menu]");
        expect(menu).not.toBeNull();
        if (menu === null) return;
        const top = Number.parseFloat(menu.style.top);
        // 8px gutter: the whole 114px surface sits at or above vh - 114 - 8, so
        // the last row is fully inside the viewport.
        expect(top).toBeLessThanOrEqual(window.innerHeight - 114 - 8 + 0.5);
        // The retired 76px constant would have allowed ~38px lower and clipped.
        expect(top).toBeLessThan(window.innerHeight - 76 - 8);
      } finally {
        unmount();
      }
    } finally {
      if (originalOffsetHeight !== undefined) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    }
  });
});

describe("Phase 36 — ActionDock State 4: idle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const idleOf = (host: HTMLElement): string =>
    host.querySelector("[data-action-dock]")?.getAttribute("data-dock-idle") ?? "";

  it("fades after 3s without activity", () => {
    const { host, unmount } = renderDock();
    try {
      expect(idleOf(host)).toBe("false");
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS - 1);
      });
      expect(idleOf(host)).toBe("false");
      act((): void => {
        vi.advanceTimersByTime(1);
      });
      expect(idleOf(host)).toBe("true");
    } finally {
      unmount();
    }
  });

  it("NEVER idles while a tool is armed", () => {
    const { host, unmount } = renderDock({ toolArmed: true });
    try {
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS * 4);
      });
      expect(idleOf(host)).toBe("false");
    } finally {
      unmount();
    }
  });

  it("NEVER idles while a drag is in progress", () => {
    const { host, unmount } = renderDock({ dragInProgress: true });
    try {
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS * 4);
      });
      expect(idleOf(host)).toBe("false");
    } finally {
      unmount();
    }
  });

  it("is restored by hover and by a keyboard event", () => {
    const { host, unmount } = renderDock();
    try {
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS);
      });
      expect(idleOf(host)).toBe("true");
      act((): void => {
        host
          .querySelector("[data-action-dock]")
          ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      });
      expect(idleOf(host)).toBe("false");

      // While the pointer stays over the dock it must never idle again.
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS * 2);
      });
      expect(idleOf(host)).toBe("false");

      // Leave the dock, idle again, then a keyboard event restores it.
      act((): void => {
        host
          .querySelector("[data-action-dock]")
          ?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      });
      act((): void => {
        vi.advanceTimersByTime(DOCK_IDLE_MS);
      });
      expect(idleOf(host)).toBe("true");
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      });
      expect(idleOf(host)).toBe("false");
    } finally {
      unmount();
    }
  });
});

describe("Phase 36/37 — ActionDock responsive rules", () => {
  it("drops the labels below 900px", () => {
    const wide = renderDock({ canvasWidth: 1200 });
    const narrow = renderDock({ canvasWidth: 800 });
    try {
      expect(wide.host.querySelector(".action-dock-label")).not.toBeNull();
      expect(wide.host.querySelector("[data-action-dock]")?.getAttribute("data-dock-icon-only")).toBe(
        "false",
      );
      expect(narrow.host.querySelector(".action-dock-label")).toBeNull();
      expect(
        narrow.host.querySelector("[data-action-dock]")?.getAttribute("data-dock-icon-only"),
      ).toBe("true");
    } finally {
      wide.unmount();
      narrow.unmount();
    }
  });

  it("collapses the least-used unpinned verbs into a `...` chip when compact WITHOUT arrows", () => {
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 100,
      // Phase 37 (item 6) — an explicit ladder with the arrows rung OFF keeps
      // the retained `...` overflow lane testable; at the ladder's last rung
      // the arrows replace it (see the next test).
      ladder: { inspectorCollapsed: true, panelCollapsed: true, iconOnly: true, arrows: false },
      dockPins: ["undo"],
      toolUsage: { rotate: 9, extract: 8 },
      onRunTool,
    });
    try {
      expect(host.querySelector("[data-action-dock]")?.getAttribute("data-dock-compact")).toBe("true");
      expect(host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows")).toBe("false");
      const more = host.querySelector<HTMLElement>("[data-dock-overflow]");
      expect(more).not.toBeNull();
      // The pinned verb stays regardless of the overflow.
      expect(verbIds(host, "pins")).toEqual(["undo"]);
      // Only the highest-usage verb stays inline (capacity 2 - 1 pinned).
      expect(verbIds(host, "primary")).toEqual(["rotate"]);
      clickOn(more as Element);
      const items = [...host.querySelectorAll<HTMLElement>("[data-dock-overflow-item]")];
      expect(items.length).toBeGreaterThan(0);
      clickOn(items[0]);
      expect(onRunTool).toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("Phase 37 item 6 — at the arrows rung every verb stays in one scrolling row", () => {
    const scrollBy = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 640 });
    try {
      expect(host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows")).toBe("true");
      // Phase 104 (chunk 2) — the arrows scroll the PRIMARY strip; the stable
      // More control (outside the strip) hosts the displaced stage verbs.
      expect(host.querySelector("[data-dock-overflow]")).not.toBeNull();
      expect(verbIds(host, "primary")).toEqual([...dockPrimaryIdsForStage("pages")]);
      const left = host.querySelector<HTMLElement>('[data-dock-arrow="left"]');
      const right = host.querySelector<HTMLElement>('[data-dock-arrow="right"]');
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      const scroller = host.querySelector<HTMLElement>("[data-dock-scroll]");
      expect(scroller).not.toBeNull();
      scroller!.scrollBy = scrollBy;
      clickOn(right as Element);
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 160 }));
      clickOn(left as Element);
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -160 }));
    } finally {
      unmount();
    }
  });

  it("Phase 104 item 5 — the labelled Tools button replaces the detached Ctrl+K hint", () => {
    const onOpenTools = vi.fn();
    const { host, unmount } = renderDock({ canvasWidth: 1400, onOpenTools });
    try {
      expect(host.querySelector("[data-dock-hint]")).toBeNull();
      const tools = host.querySelector<HTMLElement>("[data-dock-tools]");
      expect(tools).not.toBeNull();
      expect(tools?.textContent?.replace(/\s+/g, " ").trim()).toBe("Tools");
      clickOn(tools as Element);
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});
