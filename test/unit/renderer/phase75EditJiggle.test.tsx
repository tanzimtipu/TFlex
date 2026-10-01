// @vitest-environment jsdom
//
// Phase 75 (item A) — the EDIT-mode per-icon jiggle.
//
// While EDIT mode is armed, every curated tool GLYPH carries `.anim-jiggle`
// with a deterministic NEGATIVE animation-delay (desynchronised per id). The
// pen and plus controls never jiggle, entering/leaving EDIT is not itself a
// shake, and exiting removes every `.anim-jiggle`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import { Welcome } from "../../../src/renderer/components/Welcome";
import type { SampleDocument } from "../../../src/shared/types";

const SAMPLES_RESOLVER = (): Promise<SampleDocument[]> => Promise.resolve([]);

function bulk(): DockBulkActions {
  return { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
}

function renderDock(options: Partial<ActionDockProps> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
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
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function renderWelcome(options: {
  homeTools?: readonly string[];
  homeCandidates?: readonly string[];
} = {}): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        onCreateFromImages={(): void => undefined}
        homeTools={options.homeTools ?? ["merge", "sign"]}
        homeCandidates={options.homeCandidates ?? ["merge", "sign", "flatten"]}
        onRunHomeTool={vi.fn()}
        onSetHomeTools={vi.fn()}
        samplesResolver={SAMPLES_RESOLVER}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

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

describe("Phase 75 (item A) — EDIT-mode icon jiggle", () => {
  it("jiggles every dock curated glyph with a desynchronised phase", () => {
    const { host, unmount } = renderDock();
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      const icons = [...host.querySelectorAll<HTMLElement>("[data-dock-verb] .action-dock-icon")];
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.classList.contains("anim-jiggle")).toBe(true);
      }
      const delays = icons.map((icon) => icon.style.animationDelay);
      expect(delays.every((d) => d.startsWith("-") && d.endsWith("ms"))).toBe(true);
      expect(new Set(delays).size).toBeGreaterThan(1);
    } finally {
      unmount();
    }
  });

  it("never jiggles the dock pen or plus", () => {
    const { host, unmount } = renderDock();
    try {
      clickOn(host.querySelector("[data-dock-edit-toggle]") as Element);
      expect(host.querySelector("[data-dock-edit-toggle]")?.classList.contains("anim-jiggle")).toBe(false);
      expect(host.querySelector("[data-dock-plus]")?.classList.contains("anim-jiggle")).toBe(false);
      expect(host.querySelector("[data-dock-edit-toggle] .anim-jiggle")).toBeNull();
      expect(host.querySelector("[data-dock-plus] .anim-jiggle")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("jiggles the home fixed and removable tiles but not the pen or plus", () => {
    const { host, unmount } = renderWelcome();
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      const tiles = [...host.querySelectorAll<HTMLElement>("[data-home-tool]")];
      expect(tiles.length).toBeGreaterThan(1);
      for (const tile of tiles) {
        const icon = tile.querySelector(".home-tool-icon");
        expect(icon?.classList.contains("anim-jiggle")).toBe(true);
      }
      expect(host.querySelector("[data-home-edit-toggle]")?.classList.contains("anim-jiggle")).toBe(false);
      expect(host.querySelector("[data-home-plus]")?.classList.contains("anim-jiggle")).toBe(false);
      expect(host.querySelector("[data-home-edit-toggle] .anim-jiggle")).toBeNull();
      expect(host.querySelector("[data-home-plus] .anim-jiggle")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("removes every jiggle on exit", () => {
    const dock = renderDock();
    const home = renderWelcome();
    try {
      clickOn(dock.host.querySelector("[data-dock-edit-toggle]") as Element);
      clickOn(home.host.querySelector("[data-home-edit-toggle]") as Element);
      expect(dock.host.querySelectorAll(".anim-jiggle").length).toBeGreaterThan(0);
      expect(home.host.querySelectorAll(".anim-jiggle").length).toBeGreaterThan(0);
      pressEscape();
      expect(dock.host.querySelectorAll(".anim-jiggle").length).toBe(0);
      expect(home.host.querySelectorAll(".anim-jiggle").length).toBe(0);
    } finally {
      dock.unmount();
      home.unmount();
    }
  });
});
