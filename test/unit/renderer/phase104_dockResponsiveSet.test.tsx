// @vitest-environment jsdom
//
// Phase 104 (chunk 2) — the dock's responsive primary / More set.
//
//   (a) `dockPrimaryIdsForStage(stage)` returns exactly the five curated ids;
//   (b) every id in `DOCK_STAGE_IDS[stage]` is either a primary tile or appears
//       in the anchored More menu (`[data-dock-overflow-item]`);
//   (c) `[data-dock-overflow]` and `[data-dock-tools]` render UNCONDITIONALLY,
//       even when nothing overflows;
//   (d) opening More and pressing Escape closes it and returns focus to the More
//       button;
//   (e) a displaced verb (pages `split`) runs from its More row via `onRunTool`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import {
  DOCK_STAGE_IDS,
  dockPrimaryIdsForStage,
} from "../../../src/renderer/state/toolsRegistry";
import { resolveInspectorSurface } from "../../../src/renderer/state/dockResponsive";
import type { Stage } from "../../../src/renderer/state/stages";

const STAGES: readonly Stage[] = ["pages", "edit", "review", "deliver"];

const EXPECTED_PRIMARY: Readonly<Record<Stage, readonly string[]>> = {
  pages: ["rotate", "extract", "insertPages", "merge", "cropPages"],
  edit: ["editToolOff", "editText", "editImage", "editTextBox", "recognizeText"],
  review: ["annotate", "sign", "stamp", "forms", "bates"],
  deliver: ["optimize", "exportPages", "exportText", "exportDocx", "encrypt"],
};

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

function primaryIds(host: HTMLElement): string[] {
  const group = host.querySelector('[data-dock-group="primary"]') ?? host;
  return [...group.querySelectorAll<HTMLElement>("[data-dock-verb]")].map(
    (el) => el.getAttribute("data-dock-verb") ?? "",
  );
}

function overflowItemIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>("[data-dock-overflow-item]")].map(
    (el) => el.getAttribute("data-dock-overflow-item") ?? "",
  );
}

describe("Phase 104 (chunk 2) — the dock primary curation", () => {
  it("(a) dockPrimaryIdsForStage returns exactly the five curated ids per stage", () => {
    for (const stage of STAGES) {
      expect(dockPrimaryIdsForStage(stage), stage).toEqual(EXPECTED_PRIMARY[stage]);
      // Every primary id is also part of the stage's FULL membership.
      for (const id of dockPrimaryIdsForStage(stage)) {
        expect(DOCK_STAGE_IDS[stage], `${stage}:${id}`).toContain(id);
      }
    }
  });

  it("(b) every stage id is a primary tile or a More menu row", () => {
    for (const stage of STAGES) {
      const { host, unmount } = renderDock({ activeStage: stage, canvasWidth: 1400 });
      try {
        const primaries = new Set(primaryIds(host));
        clickOn(host.querySelector("[data-dock-overflow]") as Element);
        const menu = new Set(overflowItemIds(host));
        for (const id of DOCK_STAGE_IDS[stage]) {
          const reachable = primaries.has(id) || menu.has(id);
          expect(reachable, `${stage}:${id}`).toBe(true);
        }
      } finally {
        unmount();
      }
    }
  });

  it("(c) renders More and Tools unconditionally, even with no overflow", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 1400 });
    try {
      expect(host.querySelector("[data-dock-overflow]")).not.toBeNull();
      expect(host.querySelector("[data-dock-tools]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 104 (chunk 2) — the anchored More popover", () => {
  it("(d) opens, focuses the first row, and Escape closes and restores focus", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 1400 });
    try {
      const more = host.querySelector<HTMLElement>("[data-dock-overflow]");
      expect(more).not.toBeNull();
      expect(more?.getAttribute("aria-expanded")).toBe("false");
      clickOn(more as Element);
      expect(more?.getAttribute("aria-expanded")).toBe("true");
      const first = host.querySelector<HTMLElement>("[data-dock-overflow-item]");
      expect(first).not.toBeNull();
      expect(document.activeElement).toBe(first);
      act((): void => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      // TFL-1004 (chunk C9) — the More surface is the shared `CommandMenu`,
      // whose `TfMenu` owns an exit motion, so the node lingers while it
      // animates out. The logical closed state is the trigger's `aria-expanded`.
      expect(more?.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(more);
    } finally {
      unmount();
    }
  });

  it("(e) runs a displaced verb (pages split) from its More row", () => {
    const onRunTool = vi.fn();
    const { host, unmount } = renderDock({
      activeStage: "pages",
      canvasWidth: 1400,
      onRunTool,
    });
    try {
      clickOn(host.querySelector("[data-dock-overflow]") as Element);
      const split = host.querySelector<HTMLElement>('[data-dock-overflow-item="split"]');
      expect(split).not.toBeNull();
      clickOn(split as Element);
      expect(onRunTool).toHaveBeenCalledWith("split");
    } finally {
      unmount();
    }
  });
});

// TFL-1117 (R01) — the compact Inspector's surface resolver. Below the ladder
// threshold the persisted preference cannot expand the docked panel, so an
// explicit open intent becomes the overlay `drawer`; with no intent it stays
// the ladder-forced collapsed strip. At/above the threshold the existing
// expanded/collapsed preference semantics are unchanged.
describe("TFL-1117 (R01) — resolveInspectorSurface", () => {
  it("compact widths use the drawer only while the open intent is set", () => {
    expect(resolveInspectorSurface(960, false, false)).toBe("collapsed");
    expect(resolveInspectorSurface(960, false, true)).toBe("drawer");
    expect(resolveInspectorSurface(960, true, true)).toBe("drawer");
    expect(resolveInspectorSurface(1199, false, true)).toBe("drawer");
  });

  it("wide widths keep the persisted expanded/collapsed preference", () => {
    expect(resolveInspectorSurface(1200, false, false)).toBe("expanded");
    expect(resolveInspectorSurface(1200, true, false)).toBe("collapsed");
    expect(resolveInspectorSurface(1600, false, false)).toBe("expanded");
    // The drawer intent is irrelevant once the docked column fits again.
    expect(resolveInspectorSurface(1200, false, true)).toBe("expanded");
    expect(resolveInspectorSurface(1200, true, true)).toBe("collapsed");
  });
});
