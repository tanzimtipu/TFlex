// @vitest-environment jsdom
//
// Phase 104 (TFL-884) — DEF-573 renderer coverage.
//
// The Action Dock's inline `max-width` cap overrides the reserved-row CSS rule
// (`calc(100% - 24px)`). When the page/zoom pills are unmeasured (`pill ===
// null`) the dock is NOT lifted and has no measured free band, so the old
// `freeBand ?? band` fell to `dockBand(520, DOCK_DEFAULT_RESERVE)` = 0 and the
// dock collapsed to an 18px sliver. The cap must consult `reservedRow` and
// return the reserved band independent of the pills.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  DOCK_RESERVED_ROW_WIDTH,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import {
  DOCK_LIFT_INSET,
  dockCap,
} from "../../../src/renderer/state/dockFit";

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
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function dockRoot(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-action-dock]");
}

describe("DEF-573 — dockCap consults the reserved row", () => {
  it("returns the reserved band (never 0) at a 520px host with no pills", () => {
    const width = 520;
    // The collapsed case the old `freeBand ?? band` fell into: an empty band.
    const band = 0;
    const cap = dockCap({
      width,
      lifted: false,
      reservedRow: width < DOCK_RESERVED_ROW_WIDTH,
      freeBandWidth: null,
      band,
    });
    expect(cap).toBe(width - 2 * DOCK_LIFT_INSET);
    expect(cap).toBeGreaterThan(0);
  });

  it("renders a non-zero inline max-width on an unmeasured 520px dock", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 520 });
    try {
      const root = dockRoot(host);
      expect(root?.getAttribute("data-dock-reserved")).toBe("true");
      expect(root?.style.maxWidth).toBe(`${520 - 2 * DOCK_LIFT_INSET}px`);
      expect(root?.style.maxWidth).not.toBe("0px");
    } finally {
      unmount();
    }
  });

  it("leaves the measured free-band path unchanged at a wide host", () => {
    const wide = dockCap({
      width: 1400,
      lifted: false,
      reservedRow: false,
      freeBandWidth: 300,
      band: 924,
    });
    expect(wide).toBe(300);
    const unmeasured = dockCap({
      width: 1400,
      lifted: false,
      reservedRow: false,
      freeBandWidth: null,
      band: 924,
    });
    expect(unmeasured).toBe(924);
  });
});