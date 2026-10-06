// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk H) — resizable panels + width/collapse persistence
// and the document-viewport geometry (success criterion 9).
//
// The left navigator and the right inspector are resizable, persist their
// widths through the landed AppSettings fields (`panelLeftWidthPx` /
// `panelRightWidthPx` / `inspectorCollapsed`), and keep the document viewport
// the Focus Dock centers on correct at default, resized and collapsed widths.
// No command, handler, shortcut, selector, document operation or undo/redo
// behaviour is touched.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MIN_DOCUMENT_WIDTH_PX,
  PANEL_LEFT_WIDTH,
  PANEL_RIGHT_WIDTH,
  PANEL_RESIZE_STEP_PX,
  PanelResizeHandle,
  RAIL_COLLAPSED_PX,
  clampPanelWidth,
  documentViewportWidth,
  fitPanelWidths,
  panelWidthAfterKey,
  resolvePanelComposition,
  resolvePanelWidth,
  syncPanelWidth,
} from "../../../src/renderer/components/panels/PanelResizeHandle";
import { INSPECTOR_COLLAPSED_W_PX } from "../../../src/renderer/components/multiPaneLayout";
import { DOCK_DEFAULT_RESERVE, DOCK_MIN_BAND, dockBand, shouldLiftDock } from "../../../src/renderer/state/dockFit";

const APP_SOURCE = readFileSync(resolve("src/renderer/App.tsx"), "utf8");
const VIEWPORT = 1440;

function mount(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
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

describe("phase112 panelLayout — the width contract", () => {
  it("documents the left band 220..320 default 240 and right 260..380 default 280", () => {
    expect(PANEL_LEFT_WIDTH).toEqual({ min: 220, max: 320, default: 240 });
    expect(PANEL_RIGHT_WIDTH).toEqual({ min: 260, max: 380, default: 280 });
  });

  it("resolves the persisted values and the 240 / 280 defaults when unset", () => {
    expect(resolvePanelWidth("left", 300)).toBe(300);
    expect(resolvePanelWidth("right", 320)).toBe(320);
    expect(resolvePanelWidth("left", undefined)).toBe(240);
    expect(resolvePanelWidth("right", undefined)).toBe(280);
    expect(resolvePanelWidth("left", Number.NaN)).toBe(240);
  });

  it("clamps to the band at both ends", () => {
    expect(clampPanelWidth("left", 100)).toBe(220);
    expect(clampPanelWidth("left", 9999)).toBe(320);
    expect(clampPanelWidth("right", 0)).toBe(260);
    expect(clampPanelWidth("right", 9999)).toBe(380);
    expect(clampPanelWidth("left", 240.4)).toBe(240);
  });

  it("applies a settings echo preserve-if-valid", () => {
    expect(syncPanelWidth("left", 300, 240)).toBe(300);
    expect(syncPanelWidth("left", undefined, 240)).toBe(240);
    expect(syncPanelWidth("right", Number.NaN, 280)).toBe(280);
  });

  it("maps the arrow keys to a clamped step per side", () => {
    expect(panelWidthAfterKey("left", 240, "ArrowRight")).toBe(240 + PANEL_RESIZE_STEP_PX);
    expect(panelWidthAfterKey("left", 240, "ArrowLeft")).toBe(240 - PANEL_RESIZE_STEP_PX);
    expect(panelWidthAfterKey("right", 280, "ArrowRight")).toBe(280 - PANEL_RESIZE_STEP_PX);
    expect(panelWidthAfterKey("right", 280, "ArrowLeft")).toBe(280 + PANEL_RESIZE_STEP_PX);
    expect(panelWidthAfterKey("left", 240, "Home")).toBe(220);
    expect(panelWidthAfterKey("left", 240, "End")).toBe(320);
    expect(panelWidthAfterKey("left", 240, "a")).toBeNull();
  });
});

describe("phase112 panelLayout — the resize handle", () => {
  it("renders an accessible vertical separator with the value bounds", () => {
    const { host, unmount } = mount(
      createElement(PanelResizeHandle, {
        side: "left",
        width: 240,
        onResize: (): void => undefined,
        onCommit: (): void => undefined,
      }),
    );
    const handle = host.querySelector<HTMLElement>("[data-panel-resize='left']");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("role")).toBe("separator");
    expect(handle?.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle?.getAttribute("aria-valuenow")).toBe("240");
    expect(handle?.getAttribute("aria-valuemin")).toBe("220");
    expect(handle?.getAttribute("aria-valuemax")).toBe("320");
    expect(handle?.getAttribute("tabindex")).toBe("0");
    unmount();
  });

  it("is keyboard-operable and persists each step (ArrowLeft / ArrowRight / Home / End)", () => {
    const resized: number[] = [];
    const committed: number[] = [];
    const { host, unmount } = mount(
      createElement(PanelResizeHandle, {
        side: "left",
        width: 240,
        onResize: (w: number): void => {
          resized.push(w);
        },
        onCommit: (w: number): void => {
          committed.push(w);
        },
      }),
    );
    const handle = host.querySelector<HTMLElement>("[data-panel-resize='left']");
    expect(handle).not.toBeNull();
    const key = (k: string): void => {
      act((): void => {
        handle?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      });
    };
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowLeft");
    key("Home");
    key("End");
    expect(resized).toEqual([256, 256, 224, 220, 320]);
    expect(committed).toEqual([256, 256, 224, 220, 320]);
    unmount();
  });
});

describe("phase112 panelLayout — composition + collapse", () => {
  const base = {
    viewportWidth: VIEWPORT,
    railWidthPx: 240,
    railCollapsed: false,
    toolsWidthPx: 280,
    toolsCollapsed: false,
    inspectorOpen: true,
  } as const;

  it("uses the persisted widths at the default viewport", () => {
    const c = resolvePanelComposition(base);
    expect(c.railPx).toBe(240);
    expect(c.toolsPx).toBe(280);
    expect(c.toolsInsetPx).toBe(280);
  });

  it("still collapses to the rail / inspector strip widths", () => {
    const c = resolvePanelComposition({ ...base, railCollapsed: true, toolsCollapsed: true });
    expect(c.railPx).toBe(RAIL_COLLAPSED_PX);
    expect(c.toolsPx).toBe(INSPECTOR_COLLAPSED_W_PX);
    expect(c.toolsInsetPx).toBe(INSPECTOR_COLLAPSED_W_PX);
  });

  it("reports no inset while the inspector is closed", () => {
    const c = resolvePanelComposition({ ...base, inspectorOpen: false });
    expect(c.toolsInsetPx).toBe(0);
  });

  it("clamps so a usable document area remains at a narrow viewport", () => {
    const fitted = fitPanelWidths({ ...base, viewportWidth: 900 });
    const usable = 900 - 72 - MIN_DOCUMENT_WIDTH_PX;
    expect(fitted.railPx + fitted.toolsPx).toBeLessThanOrEqual(usable);
    expect(fitted.toolsPx).toBeGreaterThanOrEqual(PANEL_RIGHT_WIDTH.min);
    expect(fitted.railPx).toBeGreaterThanOrEqual(PANEL_LEFT_WIDTH.min);
  });
});

describe("phase112 panelLayout — the document viewport the dock centers on", () => {
  it("subtracts the Stage Rail, the rail column and the inspector inset", () => {
    const c = resolvePanelComposition({
      viewportWidth: VIEWPORT,
      railWidthPx: 240,
      railCollapsed: false,
      toolsWidthPx: 280,
      toolsCollapsed: false,
      inspectorOpen: true,
    });
    const host = documentViewportWidth({
      viewportWidth: VIEWPORT,
      railPx: c.railPx,
      toolsInsetPx: c.toolsInsetPx,
    });
    expect(host).toBe(VIEWPORT - 72 - 240 - 280);
  });

  it("keeps the dock band correct at default, resized and collapsed widths", () => {
    const hostAt = (railPx: number, toolsInsetPx: number): number =>
      documentViewportWidth({ viewportWidth: VIEWPORT, railPx, toolsInsetPx });
    const defaultHost = hostAt(240, 280);
    const resizedHost = hostAt(320, 380);
    const collapsedHost = hostAt(RAIL_COLLAPSED_PX, INSPECTOR_COLLAPSED_W_PX);
    expect(defaultHost).toBe(848);
    expect(resizedHost).toBe(668);
    expect(collapsedHost).toBe(1276);
    for (const host of [defaultHost, resizedHost, collapsedHost]) {
      const band = dockBand(host, DOCK_DEFAULT_RESERVE);
      expect(band).toBeGreaterThanOrEqual(DOCK_MIN_BAND);
      expect(shouldLiftDock(band)).toBe(false);
    }
  });
});

describe("phase112 panelLayout — App wiring", () => {
  it("drives --tf-rail-w / --tools-panel-w / --tf-tools-inset from state", () => {
    expect(APP_SOURCE).toContain('"--tf-rail-w": `${railWidthPx}px`');
    expect(APP_SOURCE).toContain('"--tf-tools-inset": `${toolsInsetPx}px`');
    expect(APP_SOURCE).toContain('"--tools-panel-w": `${toolsWidthPx}px`');
  });

  it("persists the widths and the inspector collapse through trackAndSave", () => {
    expect(APP_SOURCE).toContain("panelLeftWidthPx: clamped");
    expect(APP_SOURCE).toContain("panelRightWidthPx: clamped");
    expect(APP_SOURCE).toContain("inspectorCollapsed: next");
    expect(APP_SOURCE).toContain('syncPanelWidth("left", s.panelLeftWidthPx, prev)');
    expect(APP_SOURCE).toContain('syncPanelWidth("right", s.panelRightWidthPx, prev)');
  });

  it("feeds the panes the SAME resolved inset as the CSS", () => {
    expect(APP_SOURCE).toContain("toolsInsetTarget={toolsInsetPx}");
    expect(APP_SOURCE).toContain("paneInsetTarget={toolsInsetPx}");
  });

  it("wires the handles with a keyboard path and an inspectorOpen gate", () => {
    expect(APP_SOURCE).toContain("<PanelResizeHandle");
    expect(APP_SOURCE).toContain('side="left"');
    expect(APP_SOURCE).toContain('side="right"');
  });
});
