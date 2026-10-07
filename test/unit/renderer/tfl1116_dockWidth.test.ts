// @vitest-environment jsdom
//
// TFL-1157 (TFL-1116 C9b / R15) — the Action Dock sizes against the CANVAS
// VIEWPORT width, not the fitted-paper width and not a phantom pill reserve.
//
// At 962x620 the single-mode canvas measures ~788px of usable width (the
// `.document-scroller` client width). Phase 109 retired the floating page/zoom
// pills, so the canvas measures NO pill — yet the dock still subtracted the
// conservative 476px pill reserve, capping it to ~322px (roughly the fitted
// paper width) and forcing its labelled row into the scrolling arrows lane even
// though the window (962) is well above the label rung (880). R15: the dock
// must size against the CANVAS VIEWPORT, independently of paper zoom/width, and
// only scroll when the row genuinely cannot fit.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  DOCK_RESERVED_ROW_WIDTH,
  type ActionDockProps,
} from "../../../src/renderer/components/ActionDock";
import { DOCK_DEFAULT_RESERVE, dockReserveFor } from "../../../src/renderer/state/dockFit";
import { resolveDockLadder } from "../../../src/renderer/state/dockResponsive";
import { dockPrimaryIdsForStage } from "../../../src/renderer/state/toolsRegistry";

/** The live single-mode canvas viewport at a 962x620 window (see the e2e probe:
 *  `.document-scroller` clientWidth = 788). The fitted paper is ~394px. */
const CANVAS_VIEWPORT = 962;
const FITTED_PAPER = 394;
const IDEAL_LADDER = resolveDockLadder(1440);

function renderDock(options: Partial<ActionDockProps> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "relative";
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: CANVAS_VIEWPORT,
    ...options,
  };
  act((): void => {
    root.render(createElement(ActionDock, props));
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const dockOf = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>("[data-action-dock]");

describe("R15 — dockReserveFor clears only pills that exist", () => {
  it("returns the measured reserve when pills were measured", () => {
    expect(dockReserveFor({ measured: 300, pillsPresent: false })).toBe(300);
    expect(dockReserveFor({ measured: 476, pillsPresent: true })).toBe(476);
  });

  it("keeps the conservative default only while pills may appear", () => {
    expect(dockReserveFor({ measured: null, pillsPresent: true })).toBe(DOCK_DEFAULT_RESERVE);
  });

  it("reserves nothing once the canvas's pills are retired", () => {
    expect(dockReserveFor({ measured: null, pillsPresent: false })).toBe(0);
  });
});

describe("R15 — a 962px canvas viewport sizes the dock against the VIEWPORT", () => {
  it("caps on the canvas viewport, not the fitted-paper width (and never the 476 reserve)", () => {
    const { host, unmount } = renderDock({ canvasWidth: CANVAS_VIEWPORT, pillsRetired: true });
    try {
      const dock = dockOf(host);
      expect(dock).not.toBeNull();
      expect(Number.parseFloat(dock!.style.maxWidth)).toBe(CANVAS_VIEWPORT);
      expect(dock!.getAttribute("data-dock-band")).toBe(String(CANVAS_VIEWPORT));
      // NOT the phantom pill band (962 - 476 = 486) and NOT the fitted paper.
      expect(Number.parseFloat(dock!.style.maxWidth)).not.toBe(CANVAS_VIEWPORT - DOCK_DEFAULT_RESERVE);
      expect(Number.parseFloat(dock!.style.maxWidth)).toBeGreaterThan(FITTED_PAPER);
    } finally {
      unmount();
    }
  });

  it("keeps every core stage tool labelled with no horizontal scroll lane when the plan fits", () => {
    const { host, unmount } = renderDock({ canvasWidth: CANVAS_VIEWPORT, pillsRetired: true });
    try {
      const dock = dockOf(host);
      expect(dock!.getAttribute("data-dock-icon-only")).toBe("false");
      expect(dock!.getAttribute("data-dock-arrows-lane")).toBe("false");
      expect(dock!.getAttribute("data-dock-arrows")).toBe("false");
      expect(host.querySelectorAll("[data-dock-arrow]")).toHaveLength(0);
      expect(
        host.querySelectorAll('[data-dock-group="primary"] .action-dock-label'),
      ).toHaveLength(dockPrimaryIdsForStage("pages").length);
    } finally {
      unmount();
    }
  });

  it("renders the core stage tools first, then the stable More utility", () => {
    const { host, unmount } = renderDock({ canvasWidth: CANVAS_VIEWPORT, pillsRetired: true });
    try {
      const dock = dockOf(host)!;
      const order = Array.from(
        dock.querySelectorAll('[data-dock-group="primary"], [data-dock-overflow], [data-dock-tools]'),
      ).map((el) =>
        el.hasAttribute("data-dock-group")
          ? "primary"
          : el.hasAttribute("data-dock-overflow")
            ? "more"
            : "tools",
      );
      expect(order[0]).toBe("primary");
      expect(order.indexOf("more")).toBeGreaterThan(order.indexOf("primary"));
      expect(order.indexOf("tools")).toBeGreaterThan(order.indexOf("more"));
    } finally {
      unmount();
    }
  });

  it("still scrolls the row (core tools + More kept) when the band genuinely cannot fit", () => {
    // An idle WINDOW ladder keeps the labels, but the canvas band (300) is
    // narrower than the labelled row, so the lane is the correct route.
    const narrow = renderDock({
      activeStage: "pages",
      canvasWidth: 300,
      pillsRetired: true,
      ladder: IDEAL_LADDER,
    });
    try {
      const dock = dockOf(narrow.host)!;
      expect(300).toBeLessThan(DOCK_RESERVED_ROW_WIDTH);
      expect(dock.getAttribute("data-dock-icon-only")).toBe("false");
      expect(dock.getAttribute("data-dock-arrows-lane")).toBe("true");
      // Core tools render ahead of the stable More utility at every band.
      expect(narrow.host.querySelector('[data-dock-group="primary"]')).not.toBeNull();
      expect(narrow.host.querySelector("[data-dock-overflow]")).not.toBeNull();
    } finally {
      narrow.unmount();
    }
  });

  it("keeps the pill-clearance fallback for hosts that still measure pills", () => {
    // No `pillsRetired`: the legacy fallback is unchanged, and the CSS still
    // carries the 476px default the inline cap overrides.
    const legacy = renderDock({ canvasWidth: 900 });
    try {
      const dock = dockOf(legacy.host)!;
      expect(Number.parseFloat(dock.style.maxWidth)).toBe(900 - DOCK_DEFAULT_RESERVE);
    } finally {
      legacy.unmount();
    }
    const css = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).toMatch(
      /\.action-dock\s*\{[^}]*max-width:\s*max\(0px,\s*calc\(100% - var\(--dock-reserve,\s*476px\)\)\)/s,
    );
  });
});
