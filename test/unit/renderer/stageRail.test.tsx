// @vitest-environment jsdom
//
// Phase 36 (chunk 1b) — the Stage Rail.
//
// The rail is the workspace's stage switcher. These tests pin its contract:
//
//   1. FOUR stage buttons, in STAGE_ORDER, each naming the stage it
//      activates (`data-stage`, the aria-label) and carrying `aria-pressed`
//      only while it is the active stage.
//   2. The active stage is marked by the accent-soft class (the 2px accent
//      indicator is that class's ::before in CSS) and mirrored on the rail
//      root's `data-active-stage`.
//   3. The settings gear is pinned in the rail's foot and opens the same
//      Preferences sheet the title-bar gear opens.
//   4. Below the 1100px breakpoint the rail is icon-only
//      (`stage-rail-compact`).
//   5. `Ctrl+1..4` switch stage; the exact chord only, and never while a
//      text control has focus.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  STAGE_RAIL_COMPACT_WIDTH,
  StageRail,
  isStageRailCompact,
  isStageRailEditableTarget,
} from "../../../src/renderer/components/StageRail";
import type { Stage } from "../../../src/renderer/state/stages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  host: HTMLElement;
  onStageChange: ReturnType<typeof vi.fn>;
  onOpenPreferences: ReturnType<typeof vi.fn>;
  rerender: (next: { activeStage: Stage; windowWidth?: number }) => void;
  unmount: () => void;
}

function mount(args: {
  activeStage?: Stage;
  windowWidth?: number;
}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onStageChange = vi.fn();
  const onOpenPreferences = vi.fn();
  const props = {
    activeStage: args.activeStage ?? ("pages" as Stage),
    onStageChange,
    onOpenPreferences,
    ...(args.windowWidth === undefined ? {} : { windowWidth: args.windowWidth }),
  };
  act((): void => {
    root.render(<StageRail {...props} />);
  });
  return {
    host,
    onStageChange,
    onOpenPreferences,
    rerender: (next): void => {
      act((): void => {
        root.render(
          <StageRail
            activeStage={next.activeStage}
            onStageChange={onStageChange}
            onOpenPreferences={onOpenPreferences}
            {...(next.windowWidth === undefined ? {} : { windowWidth: next.windowWidth })}
          />,
        );
      });
    },
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const stageButtons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>("[data-stage]"),
];

describe("StageRail — the four stages", () => {
  it("renders four stage buttons in rail order, each naming its stage", () => {
    const h = mount({});
    const buttons = stageButtons(h.host);
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.getAttribute("data-stage"))).toEqual([
      "pages",
      "edit",
      "review",
      "deliver",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Pages stage",
      "Edit stage",
      "Review stage",
      "Deliver stage",
    ]);
    expect(buttons.map((b) => b.getAttribute("title"))).toEqual([
      "Pages (Ctrl+1)",
      "Edit (Ctrl+2)",
      "Review (Ctrl+3)",
      "Deliver (Ctrl+4)",
    ]);
    expect(h.host.querySelector("nav")?.getAttribute("aria-label")).toBe("Work stages");
    h.unmount();
  });

  it("marks only the active stage with the accent-soft class and aria-pressed", () => {
    const h = mount({ activeStage: "review" });
    for (const b of stageButtons(h.host)) {
      const active = b.getAttribute("data-stage") === "review";
      expect(b.classList.contains("stage-rail-btn-active"), b.dataset.stage).toBe(active);
      expect(b.getAttribute("aria-pressed"), b.dataset.stage).toBe(active ? "true" : "false");
    }
    expect(h.host.querySelector("[data-stage-rail]")?.getAttribute("data-active-stage")).toBe(
      "review",
    );
    h.unmount();
  });

  it("moves the active marker when the host changes the stage", () => {
    const h = mount({ activeStage: "pages" });
    h.rerender({ activeStage: "deliver" });
    expect(
      h.host.querySelector('[data-stage="deliver"]')?.classList.contains("stage-rail-btn-active"),
    ).toBe(true);
    expect(
      h.host.querySelector('[data-stage="pages"]')?.classList.contains("stage-rail-btn-active"),
    ).toBe(false);
    h.unmount();
  });

  it("switches stage on click", () => {
    const h = mount({});
    act((): void => {
      stageButtons(h.host)[1]?.click();
    });
    expect(h.onStageChange).toHaveBeenCalledWith("edit");
    h.unmount();
  });
});

describe("StageRail — the gear and the compact collapse", () => {
  it("pins the settings gear in the rail's foot and opens preferences", () => {
    const h = mount({});
    const gear = h.host.querySelector<HTMLButtonElement>("[data-stage-rail-gear]");
    expect(gear).not.toBeNull();
    expect(gear?.getAttribute("aria-label")).toBe("Open preferences");
    expect(gear?.closest(".stage-rail-foot")).not.toBeNull();
    act((): void => {
      gear?.click();
    });
    expect(h.onOpenPreferences).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("collapses to icon-only below 1100px and stays labelled at 1100px", () => {
    expect(isStageRailCompact(STAGE_RAIL_COMPACT_WIDTH - 1)).toBe(true);
    expect(isStageRailCompact(STAGE_RAIL_COMPACT_WIDTH)).toBe(false);

    const narrow = mount({ windowWidth: STAGE_RAIL_COMPACT_WIDTH - 120 });
    const narrowRoot = narrow.host.querySelector("[data-stage-rail]");
    expect(narrowRoot?.classList.contains("stage-rail-compact")).toBe(true);
    expect(narrowRoot?.getAttribute("data-stage-rail-compact")).toBe("true");
    narrow.unmount();

    const wide = mount({ windowWidth: STAGE_RAIL_COMPACT_WIDTH });
    const wideRoot = wide.host.querySelector("[data-stage-rail]");
    expect(wideRoot?.classList.contains("stage-rail-compact")).toBe(false);
    expect(wideRoot?.getAttribute("data-stage-rail-compact")).toBe("false");
    // The stage label is always in the DOM for a11y/QA; the compact class
    // is what hides it visually.
    expect(wide.host.querySelectorAll(".stage-rail-label")).toHaveLength(5);
    wide.unmount();
  });
});

describe("StageRail — Ctrl+1..4", () => {
  it("switches stage on the exact Ctrl+digit chord", () => {
    const h = mount({});
    for (const [key, stage] of [["1", "pages"], ["2", "edit"], ["3", "review"], ["4", "deliver"]] as const) {
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));
      });
      expect(h.onStageChange).toHaveBeenLastCalledWith(stage);
    }
    expect(h.onStageChange).toHaveBeenCalledTimes(4);
    h.unmount();
  });

  it("ignores the chord with any extra modifier and without Ctrl", () => {
    const h = mount({});
    for (const init of [
      { key: "2", ctrlKey: true, shiftKey: true },
      { key: "2", ctrlKey: true, altKey: true },
      { key: "2", ctrlKey: true, metaKey: true },
      { key: "2", ctrlKey: false },
      { key: "s", ctrlKey: true },
      { key: "5", ctrlKey: true },
    ]) {
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
      });
    }
    expect(h.onStageChange).not.toHaveBeenCalled();
    h.unmount();
  });

  it("leaves a focused text control its own keys", () => {
    const h = mount({});
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isStageRailEditableTarget(input)).toBe(true);
    act((): void => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "3", ctrlKey: true, bubbles: true }));
    });
    expect(h.onStageChange).not.toHaveBeenCalled();
    input.remove();
    h.unmount();
  });

  it("stops listening once unmounted", () => {
    const h = mount({});
    h.unmount();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "4", ctrlKey: true, bubbles: true }));
    });
    expect(h.onStageChange).not.toHaveBeenCalled();
  });
});
