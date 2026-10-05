// @vitest-environment jsdom
//
// TFL-850 / Phase 104 dock diff-pass — adversarial probe (adversary-owned).
//
// This file is NOT part of the product test suite (it lives under test-fixtures
// and runs only through the companion vitest.probe.config.ts). It reproduces the
// attacks in the Phase 104 diff-pass brief:
//
//   1. selection-state reachability: a stage verb that is a curated primary in
//      STAGE state (e.g. pages `delete`) must not ALSO appear as a More row while
//      its selection-state tile is on screen.
//   2. exhaustive stage-state reachability: every DOCK_STAGE_IDS id is a tile or
//      a More row in each stage.
//   3. a pinned GLOBAL dock id (undo) renders once, as a pin.
//   4. a user-unpinned tool is absent from the dock (reachable only via palette).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../src/renderer/components/ActionDock";
import {
  DOCK_STAGE_IDS,
  dockPrimaryIdsForStage,
} from "../../src/renderer/state/toolsRegistry";
import type { Stage } from "../../src/renderer/state/stages";

const STAGES: readonly Stage[] = ["pages", "edit", "review", "deliver"];

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

function tileIds(host: HTMLElement): string[] {
  const group = host.querySelector('[data-dock-group="primary"]');
  if (group === null) return [];
  return [...group.querySelectorAll<HTMLElement>("[data-dock-verb]")].map(
    (el) => el.getAttribute("data-dock-verb") ?? "",
  );
}

function pinIds(host: HTMLElement): string[] {
  const group = host.querySelector('[data-dock-group="pins"]');
  if (group === null) return [];
  return [...group.querySelectorAll<HTMLElement>("[data-dock-verb]")].map(
    (el) => el.getAttribute("data-dock-verb") ?? "",
  );
}

function menuIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>("[data-dock-overflow-item]")].map(
    (el) => el.getAttribute("data-dock-overflow-item") ?? "",
  );
}

describe("TFL-850 ADV probe — selection-state duplication", () => {
  it("delete must not appear in BOTH the selection primary tiles and the More menu", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      pageSelection: [1, 2],
      canvasWidth: 1400,
    });
    try {
      const tiles = tileIds(host);
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const menu = menuIds(host);
      // eslint-disable-next-line no-console
      console.log("[ADV probe] selection tiles:", JSON.stringify(tiles));
      // eslint-disable-next-line no-console
      console.log("[ADV probe] selection More rows:", JSON.stringify(menu));
      const overlap = tiles.filter((id) => menu.includes(id));
      expect(overlap, `duplicated tile+menu ids: ${JSON.stringify(overlap)}`).toEqual([]);
    } finally {
      unmount();
    }
  });
});

describe("TFL-850 ADV probe — exhaustive stage-state reachability", () => {
  it("every DOCK_STAGE_IDS id is a primary tile or a More row, with no duplicates", () => {
    for (const stage of STAGES) {
      const { host, unmount } = renderDock({ activeStage: stage, canvasWidth: 1400 });
      try {
        const tiles = tileIds(host);
        clickOn(host.querySelector("[data-dock-overflow]") as Element);
        const menu = menuIds(host);
        const union = new Set([...tiles, ...menu]);
        const missing = DOCK_STAGE_IDS[stage].filter((id) => !union.has(id));
        const overlap = tiles.filter((id) => menu.includes(id));
        // eslint-disable-next-line no-console
        console.log(
          `[ADV probe] ${stage}: tiles=${tiles.length} menu=${menu.length} missing=${JSON.stringify(missing)} overlap=${JSON.stringify(overlap)}`,
        );
        expect(missing, `${stage} missing`).toEqual([]);
        expect(overlap, `${stage} overlap`).toEqual([]);
        // The curated primaries are a subset of the stage set.
        for (const id of dockPrimaryIdsForStage(stage)) {
          expect(DOCK_STAGE_IDS[stage]).toContain(id);
        }
      } finally {
        unmount();
      }
    }
  });

  it("a pinned GLOBAL id (undo) renders once as a pin", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockPins: ["undo"] });
    try {
      const pins = pinIds(host);
      const tiles = tileIds(host);
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const menu = menuIds(host);
      // eslint-disable-next-line no-console
      console.log(
        `[ADV probe] undo pins=${JSON.stringify(pins)} tile=${tiles.includes("undo")} menu=${menu.includes("undo")}`,
      );
      expect(pins).toContain("undo");
      expect(tiles).not.toContain("undo");
      expect(menu).not.toContain("undo");
    } finally {
      unmount();
    }
  });

  it("a user-unpinned primary is absent from the dock (reachable only via palette)", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      dockUnpinned: ["merge"],
    });
    try {
      const tiles = tileIds(host);
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const menu = menuIds(host);
      // eslint-disable-next-line no-console
      console.log(
        `[ADV probe] unpinned merge tile=${tiles.includes("merge")} menu=${menu.includes("merge")}`,
      );
      expect(tiles).not.toContain("merge");
      expect(menu).not.toContain("merge");
    } finally {
      unmount();
    }
  });
});
