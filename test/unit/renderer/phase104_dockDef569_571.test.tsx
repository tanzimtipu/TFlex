// @vitest-environment jsdom
//
// Phase 104 adversary-fix batch (TFL-851) — renderer unit coverage for:
//
//   DEF-569 — in State 2 (`data-dock-state="selection"`) a dock id renders
//             EXACTLY once: `delete` is only the selection tile (running the
//             bulk handler) and the stage primaries it displaces stay reachable
//             as More rows. No tile id may also be a More row.
//   DEF-571 — at the icon-only rung (720-880px) the row exceeds its band while
//             NEITHER the arrows rung NOR the labelled fit test is engaged, so
//             `data-dock-arrows-lane` must engage for the overflowing icon-only
//             row (and the reserved row / a lifted dock stay exempt).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import { iconOnlyDockNeed } from "../../../src/renderer/state/dockFit";
import { DOCK_STAGE_IDS } from "../../../src/renderer/state/toolsRegistry";

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

function menuIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>("[data-dock-overflow-item]")].map(
    (el) => el.getAttribute("data-dock-overflow-item") ?? "",
  );
}

function lane(host: HTMLElement): string | null {
  return (
    host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows-lane") ?? null
  );
}

describe("TFL-851 DEF-569 — State 2 renders every dock id exactly once", () => {
  it("delete is ONLY the selection tile; the displaced stage primaries are More rows", () => {
    const b = bulk();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      pageSelection: [1, 2],
      canvasWidth: 1400,
      bulk: b,
    });
    try {
      const tiles = tileIds(host);
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const menu = menuIds(host);
      const overlap = tiles.filter((id) => menu.includes(id));
      expect(overlap, `duplicated tile+menu ids: ${JSON.stringify(overlap)}`).toEqual([]);
      // Delete is a tile, never a More row.
      expect(tiles).toContain("delete");
      expect(menu).not.toContain("delete");
      // The stage primaries displaced by the selection set stay reachable.
      for (const id of ["insertPages", "merge", "cropPages"]) {
        expect(menu, id).toContain(id);
      }
      // Every PAGES stage id is a tile or a More row in State 2.
      const union = new Set([...tiles, ...menu]);
      const missing = DOCK_STAGE_IDS.pages.filter((id) => !union.has(id));
      expect(missing).toEqual([]);
      // The delete tile runs the bulk handler, not the Delete Pages dialog.
      clickOn(host.querySelector('[data-dock-verb="delete"]') as Element);
      expect(b.onDelete).toHaveBeenCalledWith([1, 2]);
    } finally {
      unmount();
    }
  });
});

describe("TFL-851 DEF-571 — the icon-only row enters the arrows lane when it overflows", () => {
  it("engages the lane at the 720-880 icon rung where the labelled fit cannot see it", () => {
    for (const width of [740, 780, 820, 860]) {
      const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: width });
      try {
        expect(lane(host), `w=${width}`).toBe("true");
      } finally {
        unmount();
      }
    }
  });

  it("stays out of the lane at a wide host and at the reserved row", () => {
    const wide = renderDock({ activeStage: "pages", canvasWidth: 1400 });
    try {
      expect(lane(wide.host)).toBe("false");
    } finally {
      wide.unmount();
    }
    const reserved = renderDock({
      activeStage: "pages",
      canvasWidth: 100,
      ladder: { inspectorCollapsed: true, panelCollapsed: true, iconOnly: true, arrows: false },
    });
    try {
      expect(lane(reserved.host)).toBe("false");
    } finally {
      reserved.unmount();
    }
  });

  it("charges every control in the icon-only need (tiles + More + Tools)", () => {
    // A row that fits below its own floor is impossible; the tile floor is 58px.
    expect(iconOnlyDockNeed(7)).toBeGreaterThan(iconOnlyDockNeed(6));
    expect(iconOnlyDockNeed(0)).toBe(0);
  });
});
