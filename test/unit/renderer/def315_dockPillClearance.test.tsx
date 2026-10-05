// @vitest-environment jsdom
//
// DEF-315 — the Action Dock must never cover or overlap either floating pill.
//
// The defect: the cap `max-width: max(220px, calc(100% - 380px))` hardcoded a
// 380px reserve (asymmetric-blind: the zoom pill is 218px wide, the page pill
// 154px) and its 220px FLOOR exceeded the free band below a ~640px host, so the
// dock's centred box reached over the zoom pill's "Zoom out" at a 760px window
// (540px host) and overlapped it by 19px at 900px.
//
// These tests pin the invariant at the five supported HOST widths — 1440, 1100,
// 900, 760, 640 — with the live-measured pill widths (page 154px, zoom 218px,
// each at a 12px inset), plus the two below-floor hosts where the dock yields
// vertically (540px: the DEF-315 repro; 420px: the app's 640px minimum window
// with the 220px rail).
//
// jsdom has no layout engine, so the DOM half mocks the three boxes the
// component measures (the host and the two pills) and reads the dock's own
// published cap. The hit-test assertion is therefore geometric — the dock is
// painted ABOVE the pills (later in DOM order, both z-index 7), so a pill
// control whose centre lies outside the dock's worst-case box is the top
// element at that centre, which is exactly what `elementFromPoint` resolved to
// "not the control" in qa's live probe.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ActionDock, type ActionDockProps } from "../../../src/renderer/components/ActionDock";
import {
  DOCK_DEFAULT_RESERVE,
  DOCK_LIFT_INSET,
  DOCK_MIN_BAND,
  DOCK_PILL_GAP,
  DOCK_PILL_INSET,
  dockBand,
  dockPlanWidth,
  labelledDockNeed,
  labelsFitBand,
  pillBandHeight,
  pillFreeBand,
  pillReserve,
  rectsIntersect,
  shouldLiftDock,
  type PillBox,
  type Rect,
} from "../../../src/renderer/state/dockFit";
import {
  COMPACT_MIN_CANVAS,
  FULL_MIN_CANVAS,
  PAGE_COMPACT_W,
  PAGE_FULL_W,
  ZOOM_COMPACT_W,
  ZOOM_FULL_W,
  controlCentre,
  pageControls,
  pillLayout,
  pillMode,
  zoomControls,
  type PillControl,
} from "../../../src/renderer/state/pillFit";
import { multiPaneGeometry } from "../../../src/renderer/components/multiPaneLayout";
import { dockPrimaryIdsForStage } from "../../../src/renderer/state/toolsRegistry";
import {
  MULTI_DOCK_BAND_BASE_PX,
  multiPillLayerWidthPx,
  multiPillMetrics,
  multiPillTier,
  type MultiPillTier,
} from "../../../src/renderer/components/multiPaneLayout";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** The live measurement (qa's DEF-315 probe: 760px window, 540px host). */
const PAGE_W = 154;
const ZOOM_W = 218;
const PILL_H = 42;
const PILL_BOTTOM = 12;
const HOST_H = 900;
/** A believable dock height (two rows at most in the row mode). */
const DOCK_H = 50;
/** The inner-row control box: .tool-btn is 28x32 inside the pill's 6px padding
 *  and 1px border. */
const BTN_W = 28;
const BTN_INSET = 1 + 6;

const WIDTHS = [1440, 1100, 900, 760, 640];

function boxOf(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: (): Record<string, never> => ({}),
  } as DOMRect;
}

function pill(name: "page" | "zoom", hostWidth: number): PillBox {
  const left =
    name === "page"
      ? DOCK_PILL_INSET
      : hostWidth - DOCK_PILL_INSET - ZOOM_W;
  const width = name === "page" ? PAGE_W : ZOOM_W;
  return {
    left,
    right: left + width,
    top: HOST_H - PILL_BOTTOM - PILL_H,
    bottom: HOST_H - PILL_BOTTOM,
    width,
    height: PILL_H,
  };
}

/** The pill's inner-row control boxes nearest to the dock's centre. */
function controls(hostWidth: number): { name: string; rect: Rect }[] {
  const page = pill("page", hostWidth);
  const zoom = pill("zoom", hostWidth);
  const y0 = page.top + BTN_INSET;
  const y1 = y0 + 32;
  return [
    { name: "page:Next page", rect: { left: page.right - BTN_INSET - BTN_W, right: page.right - BTN_INSET, top: y0, bottom: y1 } },
    { name: "zoom:Zoom out", rect: { left: zoom.left + BTN_INSET, right: zoom.left + BTN_INSET + BTN_W, top: y0, bottom: y1 } },
  ];
}

/** `elementFromPoint` over modelled boxes: layers are ordered TOPMOST first. */
function topmostAt(x: number, y: number, layers: { name: string; rect: Rect }[]): string {
  for (const layer of layers) {
    const r = layer.rect;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return layer.name;
  }
  return "none";
}

// ---------------------------------------------------------------------------
// 1. The pure geometry.
// ---------------------------------------------------------------------------

describe("DEF-315 — the measured pill reserve", () => {
  it("derives the reserve from the WIDEST pill's measured inner edge", () => {
    // page: 12 + 154 = 166 -> 2*166 + 16 = 348; zoom: 12 + 218 = 230 -> 476.
    expect(
      pillReserve({ page: pill("page", 540), zoom: pill("zoom", 540), hostLeft: 0, hostRight: 540 }),
    ).toBe(2 * (DOCK_PILL_INSET + ZOOM_W) + 2 * DOCK_PILL_GAP);
    expect(
      pillReserve({ page: pill("page", 540), zoom: pill("zoom", 540), hostLeft: 0, hostRight: 540 }),
    ).toBe(DOCK_DEFAULT_RESERVE);
  });

  it("falls back to the live-measured default when no pill could be measured", () => {
    expect(pillReserve({ page: null, zoom: null, hostLeft: 0, hostRight: 900 })).toBe(
      DOCK_DEFAULT_RESERVE,
    );
  });

  it("never lets the band go negative and yields vertically below the floor", () => {
    expect(dockBand(1440, DOCK_DEFAULT_RESERVE)).toBe(964);
    expect(dockBand(540, DOCK_DEFAULT_RESERVE)).toBe(64);
    expect(dockBand(420, DOCK_DEFAULT_RESERVE)).toBe(0);
    expect(shouldLiftDock(dockBand(540, DOCK_DEFAULT_RESERVE))).toBe(true);
    expect(shouldLiftDock(dockBand(640, DOCK_DEFAULT_RESERVE))).toBe(false);
    expect(shouldLiftDock(dockBand(572, DOCK_DEFAULT_RESERVE))).toBe(false);
    expect(shouldLiftDock(dockBand(571, DOCK_DEFAULT_RESERVE))).toBe(true);
    expect(DOCK_MIN_BAND).toBe(96);
  });

  it("keys the plan on the band when measured, the host when it is not", () => {
    expect(dockPlanWidth({ hostWidth: 900, band: 424, lifted: false, measured: true })).toBe(424);
    expect(dockPlanWidth({ hostWidth: 540, band: 64, lifted: true, measured: true })).toBe(540);
    expect(dockPlanWidth({ hostWidth: 540, band: 64, lifted: false, measured: false })).toBe(540);
  });

  it("drops the labels only when the labelled dock (with its pins) cannot fit", () => {
    // DEF-330 — the need is the LABELS' own width: DELIVER's five wide verbs
    // need more room than PAGES' six narrow ones, which a per-verb constant can
    // never express.
    const pages = [
      "Rotate pages",
      "Extract pages",
      "Insert pages",
      "Replace pages",
      "Split pages",
      "Delete pages",
    ];
    const deliver = [
      "Reduce file size",
      "Audit space usage",
      "Export pages as images",
      "Export text",
      "Export to Word (.docx)",
    ];
    const pins = ["Zoom in", "Zoom out", "Fit width", "Fit page"];
    expect(labelledDockNeed(deliver)).toBeGreaterThan(labelledDockNeed(pages));
    // Phase 38 (feature B) — the 12px label floor + 20px glyph raise the need
    // from the 9px model's 450.6 / 491.6.
    expect(labelledDockNeed(pages)).toBeCloseTo(552.8, 1);
    expect(labelledDockNeed(deliver)).toBeCloseTo(614.8, 1);
    // Six labelled PAGES verbs fit a generous band...
    expect(labelsFitBand(labelledDockNeed(pages), 964)).toBe(true);
    // ...with four pins the labelled dock needs ~829px, so a 524px band yields
    // while a 900px band still fits.
    expect(labelledDockNeed(pages, pins)).toBeCloseTo(829.0, 1);
    expect(labelsFitBand(labelledDockNeed(pages, pins), 524)).toBe(false);
    expect(labelsFitBand(labelledDockNeed(pages, pins), 900)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The invariant at the five host widths: the dock's published cap never
//    reaches either pill and every pill control is the top element at its own
//    centre.
// ---------------------------------------------------------------------------

interface Harness {
  host: HTMLElement;
  dock: HTMLElement;
  unmount: () => void;
}

/** Phase 37 (item 6) — the compact `...` lane is still exercised here with the
 *  arrows rung explicitly OFF: these tests model a wide VIEWPORT (ladder rungs
 *  1-3 only) whose measured canvas band is narrow, which is exactly when the
 *  `...` lane (not the arrows) applies. */
const NO_ARROWS = {
  inspectorCollapsed: false,
  panelCollapsed: false,
  iconOnly: false,
  arrows: false,
} as const;

function mountDock(hostWidth: number, options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  host.style.position = "relative";
  document.body.appendChild(host);
  const page = document.createElement("div");
  page.setAttribute("data-page-pill", "");
  const zoom = document.createElement("div");
  zoom.setAttribute("data-zoom-pill", "");
  host.append(page, zoom);
  const pageBox = pill("page", hostWidth);
  const zoomBox = pill("zoom", hostWidth);
  host.getBoundingClientRect = (): DOMRect => boxOf(0, 0, hostWidth, HOST_H);
  page.getBoundingClientRect = (): DOMRect =>
    boxOf(pageBox.left, pageBox.top, pageBox.right, pageBox.bottom);
  zoom.getBoundingClientRect = (): DOMRect =>
    boxOf(zoomBox.left, zoomBox.top, zoomBox.right, zoomBox.bottom);

  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const root = createRoot(mount);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: hostWidth,
    ...options,
  };
  act((): void => {
    root.render(createPortal(<ActionDock {...props} />, host));
  });
  const dock = host.querySelector<HTMLElement>("[data-action-dock]");
  if (dock === null) throw new Error("the dock did not mount");
  return {
    host,
    dock,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
      mount.remove();
    },
  };
}

/** The dock's worst-case box. DEF-330 — between the pills the dock occupies the
 *  pill-FREE band (centred in it, `--dock-shift`); lifted, and before a
 *  measurement, it keeps the host-centre geometry. */
function dockBox(
  hostWidth: number,
  cap: number,
  lifted: boolean,
  free: { left: number; width: number } | null = null,
): Rect {
  const centre =
    !lifted && free !== null ? free.left + free.width / 2 : hostWidth / 2;
  const bottom = HOST_H - PILL_BOTTOM - (lifted ? PILL_H + DOCK_PILL_GAP : 0);
  return { left: centre - cap / 2, right: centre + cap / 2, top: bottom - DOCK_H, bottom };
}

/** The pill-free band for this harness's live-measured pill widths. */
function freeBandOf(hostWidth: number): { left: number; width: number } {
  return pillFreeBand({
    page: pill("page", hostWidth),
    zoom: pill("zoom", hostWidth),
    hostLeft: 0,
  });
}

describe("DEF-315 — the dock clears the pills at every supported host width", () => {
  for (const hostWidth of [...WIDTHS, 540, 420]) {
    it(`keeps the pill band clear at a ${hostWidth}px host`, () => {
      const { host, dock, unmount } = mountDock(hostWidth);
      try {
        const band = dockBand(hostWidth, DOCK_DEFAULT_RESERVE);
        const lifted = shouldLiftDock(band);
        const free = freeBandOf(hostWidth);
        expect(dock.style.getPropertyValue("--dock-reserve")).toBe(`${DOCK_DEFAULT_RESERVE}px`);
        // DEF-330 — the published band is the band the dock is PLACED against:
        // the pill-free band between the pills, or the symmetric band while the
        // dock is lifted above them.
        expect(dock.getAttribute("data-dock-band")).toBe(
          String(lifted ? band : Math.round(free.width)),
        );
        expect(dock.getAttribute("data-dock-band-placed")).toBe(lifted ? null : "true");
        expect(dock.getAttribute("data-dock-lift")).toBe(lifted ? "true" : "false");
        // DEF-330 — between the pills the cap is the pill-free band; lifted it
        // is the host minus the 12px gutters (unchanged from DEF-315).
        const cap = Number.parseFloat(dock.style.maxWidth);
        expect(cap).toBe(lifted ? hostWidth - 24 : free.width);
        expect(dock.getAttribute("data-dock-free-band")).toBe(String(Math.round(free.width)));
        expect(dock.style.getPropertyValue("--dock-shift")).toBe(
          `${lifted ? 0 : free.left + free.width / 2 - hostWidth / 2}px`,
        );

        const dockRect = dockBox(hostWidth, cap, lifted, free);
        const pageRect = pill("page", hostWidth);
        const zoomRect = pill("zoom", hostWidth);
        if (!lifted) {
          // The invariant: the cap keeps a GAP from both pills.
          expect(pageRect.right + DOCK_PILL_GAP).toBeLessThanOrEqual(dockRect.left);
          expect(dockRect.right + DOCK_PILL_GAP).toBeLessThanOrEqual(zoomRect.left);
          expect(rectsIntersect(dockRect, pageRect)).toBe(false);
          expect(rectsIntersect(dockRect, zoomRect)).toBe(false);
        } else {
          // The yield: the dock's box sits ABOVE the pill row.
          expect(dockRect.bottom + DOCK_PILL_GAP).toBeLessThanOrEqual(pageRect.top);
          expect(dockRect.bottom + DOCK_PILL_GAP).toBeLessThanOrEqual(zoomRect.top);
        }

        // Hit-testability: the dock paints above the pills (it is the LATER
        // sibling inside the host), so the topmost box at each inner pill
        // control's centre must be that control, never the dock.
        expect(host.firstElementChild).not.toBe(dock);
        const layers = [
          { name: "dock", rect: dockRect },
          ...controls(hostWidth),
        ];
        for (const control of controls(hostWidth)) {
          const x = (control.rect.left + control.rect.right) / 2;
          const y = (control.rect.top + control.rect.bottom) / 2;
          expect(topmostAt(x, y, layers), `${control.name} at ${hostWidth}px`).toBe(control.name);
        }
      } finally {
        unmount();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The yield: icon-only earlier, the `...` chip absorbs the overflow, the
//    pinned verbs stay.
// ---------------------------------------------------------------------------

describe("DEF-315 — the dock yields before it reaches a pill", () => {
  it("keeps the labels on the measured band above the 880 rung, routing to arrows", () => {
    const wide = mountDock(1440, { dockPins: ["undo", "redo", "openReadingView", "openComicView"] });
    const tight = mountDock(1000, { dockPins: ["undo", "redo", "openReadingView", "openComicView"] });
    const plain = mountDock(1000);
    try {
      expect(wide.dock.getAttribute("data-dock-icon-only")).toBe("false");
      expect(wide.dock.querySelector(".action-dock-label")).not.toBeNull();
      // DEF-330 — the band is the pill-FREE one: 1000px host leaves 588px, and
      // a labelled dock with four pins needs ~682px.
      expect(tight.dock.getAttribute("data-dock-band")).toBe("588");
      expect(tight.dock.getAttribute("data-dock-free-band")).toBe("588");
      // DEF-334 — 1000 is above the 880 rung, so the labels STAY and the row
      // scrolls with the arrows instead of yielding the labels.
      expect(tight.dock.getAttribute("data-dock-icon-only")).toBe("false");
      expect(tight.dock.querySelector(".action-dock-label")).not.toBeNull();
      // Phase 104 (chunk 2) — the stable More control always renders, outside
      // the strip; the labels are still never dropped above the 880 rung.
      expect(tight.dock.querySelector("[data-dock-overflow]")).not.toBeNull();
      // Without pins the six PAGES labels (~451px) still fit the 588px band.
      expect(plain.dock.getAttribute("data-dock-icon-only")).toBe("false");
    } finally {
      wide.unmount();
      tight.unmount();
      plain.unmount();
    }
  });

  it("keeps every verb reachable in the arrows lane when the band cannot fit the pins", () => {
    const { dock, unmount } = mountDock(640, { dockPins: ["undo"], toolUsage: { rotate: 9, extract: 8 }, ladder: NO_ARROWS });
    try {
      // DEF-334 — a labelled row that cannot fit prefers the arrows lane over
      // dropping labels: nothing hides behind a `...` menu, the pins stay.
      expect(dock.getAttribute("data-dock-icon-only")).toBe("false");
      expect(dock.getAttribute("data-dock-arrows")).toBe("true");
      // Phase 104 (chunk 2) — the primary strip scrolls; More is stable.
      expect(dock.querySelector("[data-dock-overflow]")).not.toBeNull();
      expect(
        dock.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]'),
      ).toHaveLength(dockPrimaryIdsForStage("pages").length);
      expect([...dock.querySelectorAll("[data-dock-pin]")].map((el) => el.getAttribute("data-dock-pin"))).toEqual([
        "undo",
      ]);
    } finally {
      unmount();
    }
  });

  it("lets a lifted dock use the host width (the pills are no longer beside it)", () => {
    const { dock, unmount } = mountDock(540, { ladder: NO_ARROWS });
    try {
      expect(dock.getAttribute("data-dock-lift")).toBe("true");
      expect(dock.style.getPropertyValue("--dock-lift")).toBe(`${PILL_H + DOCK_PILL_GAP}px`);
      expect(Number.parseFloat(dock.style.maxWidth)).toBe(516);
      // Phase 104 (chunk 2) — the primary strip is the curated set; More is
      // stable and outside the scroll strip.
      expect(
        dock.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]'),
      ).toHaveLength(dockPrimaryIdsForStage("pages").length);
      expect(dock.querySelector("[data-dock-overflow]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the pinned verbs reachable at the app's minimum-width host", () => {
    const { dock, unmount } = mountDock(420, { dockPins: ["undo"], ladder: NO_ARROWS });
    try {
      expect(dock.getAttribute("data-dock-lift")).toBe("true");
      expect(Number.parseFloat(dock.style.maxWidth)).toBe(396);
      expect([...dock.querySelectorAll("[data-dock-pin]")]).toHaveLength(1);
      // Phase 104 (chunk 2) — the curated primary set, with the displaced PAGES
      // verbs in the stable More menu.
      expect(
        dock.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]'),
      ).toHaveLength(dockPrimaryIdsForStage("pages").length);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The stylesheet consumes the measured reserve.
// ---------------------------------------------------------------------------

describe("DEF-315 — the stylesheet consumes the measured reserve", () => {
  const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("caps the dock with --dock-reserve and keeps the calc non-negative", () => {
    expect(css).toMatch(
      /\.action-dock\s*\{[^}]*max-width:\s*max\(0px,\s*calc\(100% - var\(--dock-reserve,\s*476px\)\)\)/s,
    );
    // The old hardcoded 380px reserve / 220px floor is gone (DEF-315).
    expect(css).not.toMatch(/max\(220px,\s*calc\(100% - 380px\)\)/);
  });

  it("lifts the dock with the published --dock-lift transform (no layout change)", () => {
    // DEF-330 — the same transform also carries the pill-free band shift
    // (`--dock-shift`, 0px until the pills are measured / while lifted).
    expect(css).toMatch(
      /\.action-dock\s*\{[^}]*transform:\s*translate\(calc\(-50% \+ var\(--dock-shift,\s*0px\)\),\s*calc\(-1 \* var\(--dock-lift,\s*0px\)\)\)/s,
    );
    expect(css).toMatch(/\.action-dock\[data-dock-lift='true'\]\s*\{[^}]*max-width:\s*max\(0px,\s*calc\(100% - 24px\)\)/s);
  });
});

// ---------------------------------------------------------------------------
// 5. DEF-319 — the SAME invariant with the INSPECTOR OPEN.
//
// The chunk-6 Inspector is a 264px right panel that overlays the page column's
// right edge. The pills were anchored to the whole page column, so the zoom
// pill's controls landed UNDER the Inspector (elementFromPoint resolved to
// `DIV.glass-sidebar-body inspector-body`) and no zoom/fit/pan control could be
// clicked in the default state.
//
// The fix anchors the floating chrome to the VISIBLE canvas: the pills, the
// flyout and the dock now live in `.canvas-overlay`, a layer inset on the right
// by the Inspector's width (--tf-tools-inset). The dock's own measurement host
// is that layer, so its cap and its pill reserve both resolve against the
// canvas — never against the canvas plus the Inspector.
//
// These tests model the canvas bounds and assert the same two invariants at the
// five supported HOST widths (the DEF-315 set): every pill control's centre lies
// inside the canvas (so the Inspector, which starts at the canvas edge, can
// never cover it), and the dock's worst-case box still clears both pills.
// ---------------------------------------------------------------------------

/** The Inspector's single width (the app's --tools-panel-w). */
const INSPECTOR_W = 264;

/** The VISIBLE canvas width: the DEF-315 host (the page column) less the
 *  Inspector's inset. The five supported HOST widths are the same ones the
 *  DEF-315 suite uses (1440/1100/900/760/640), so the Inspector's presence is
 *  the ONLY new variable here. */
function canvasWidthOf(hostWidth: number): number {
  return Math.max(0, hostWidth - INSPECTOR_W);
}

/** A pill anchored to the CANVAS bounds (page left, zoom right). */
function canvasPill(name: "page" | "zoom", canvasWidth: number): PillBox {
  const left = name === "page" ? DOCK_PILL_INSET : canvasWidth - DOCK_PILL_INSET - ZOOM_W;
  const width = name === "page" ? PAGE_W : ZOOM_W;
  return {
    left,
    right: left + width,
    top: HOST_H - PILL_BOTTOM - PILL_H,
    bottom: HOST_H - PILL_BOTTOM,
    width,
    height: PILL_H,
  };
}

/** The pill's inner-row control boxes (page/zoom) on the canvas. */
function canvasControls(canvasWidth: number): { name: string; rect: Rect }[] {
  const page = canvasPill("page", canvasWidth);
  const zoom = canvasPill("zoom", canvasWidth);
  const y0 = page.top + BTN_INSET;
  const y1 = y0 + 32;
  return [
    { name: "page:Next page", rect: { left: page.right - BTN_INSET - BTN_W, right: page.right - BTN_INSET, top: y0, bottom: y1 } },
    { name: "zoom:Zoom out", rect: { left: zoom.left + BTN_INSET, right: zoom.left + BTN_INSET + BTN_W, top: y0, bottom: y1 } },
  ];
}

/** The Inspector's box: it starts at the canvas edge and covers the rest. */
function inspectorBox(hostWidth: number): Rect {
  const canvas = canvasWidthOf(hostWidth);
  return { left: canvas, right: canvas + INSPECTOR_W, top: 0, bottom: HOST_H };
}

/** The dock's worst-case box centred on the CANVAS (the .canvas-overlay). */
function canvasDockBox(canvasWidth: number, cap: number, lifted: boolean): Rect {
  const centre = canvasWidth / 2;
  const bottom = HOST_H - PILL_BOTTOM - (lifted ? PILL_H + DOCK_PILL_GAP : 0);
  return { left: centre - cap / 2, right: centre + cap / 2, top: bottom - DOCK_H, bottom };
}

describe("DEF-319 — every pill control is hit-testable with the Inspector open", () => {
  for (const hostWidth of WIDTHS) {
    it(`clears the Inspector and the dock at a ${hostWidth}px host`, () => {
      const canvas = canvasWidthOf(hostWidth);
      const page = canvasPill("page", canvas);
      const zoom = canvasPill("zoom", canvas);
      const inspector = inspectorBox(hostWidth);
      const band = dockBand(canvas, DOCK_DEFAULT_RESERVE);
      const lifted = shouldLiftDock(band);
      const cap = lifted ? Math.max(0, canvas - 2 * DOCK_LIFT_INSET) : band;
      const dock = canvasDockBox(canvas, cap, lifted);

      // 1. The Inspector starts AT the canvas edge — it can never reach a pill
      //    that is anchored inside the canvas.
      expect(inspector.left, `the Inspector starts at the canvas edge at a ${hostWidth}px host`).toBe(canvas);
      expect(page.right, "the page pill is inside the canvas").toBeLessThanOrEqual(canvas);
      expect(zoom.right, "the zoom pill is inside the canvas").toBeLessThanOrEqual(canvas);
      expect(rectsIntersect(inspector, page), "the Inspector never covers the page pill").toBe(false);
      expect(rectsIntersect(inspector, zoom), "the Inspector never covers the zoom pill").toBe(false);

      // 2. The dock (now centred on the canvas) still clears both pills.
      if (!lifted) {
        expect(page.right + DOCK_PILL_GAP, `page pill clear at ${hostWidth}px`).toBeLessThanOrEqual(dock.left);
        expect(dock.right + DOCK_PILL_GAP, `zoom pill clear at ${hostWidth}px`).toBeLessThanOrEqual(zoom.left);
        expect(rectsIntersect(dock, page)).toBe(false);
        expect(rectsIntersect(dock, zoom)).toBe(false);
      } else {
        expect(dock.bottom + DOCK_PILL_GAP).toBeLessThanOrEqual(page.top);
        expect(dock.bottom + DOCK_PILL_GAP).toBeLessThanOrEqual(zoom.top);
      }

      // 3. Hit-testability: the Inspector paints ABOVE everything, so the
      //    topmost box at each inner control's centre must be that control.
      const layers = [
        { name: "inspector", rect: inspector },
        { name: "dock", rect: dock },
        ...canvasControls(canvas),
      ];
      for (const control of canvasControls(canvas)) {
        const x = (control.rect.left + control.rect.right) / 2;
        const y = (control.rect.top + control.rect.bottom) / 2;
        expect(topmostAt(x, y, layers), `${control.name} at a ${hostWidth}px host`).toBe(
          control.name,
        );
      }
    });
  }

  it("yields the dock vertically once the canvas is too narrow for the band", () => {
    // 760/640 hosts leave no free band beside the Inspector.
    expect(shouldLiftDock(dockBand(canvasWidthOf(760), DOCK_DEFAULT_RESERVE))).toBe(true);
    expect(shouldLiftDock(dockBand(canvasWidthOf(640), DOCK_DEFAULT_RESERVE))).toBe(true);
    // ...while 1440/1100/900 still fit a centred dock beside the pills.
    expect(shouldLiftDock(dockBand(canvasWidthOf(1440), DOCK_DEFAULT_RESERVE))).toBe(false);
    expect(shouldLiftDock(dockBand(canvasWidthOf(1100), DOCK_DEFAULT_RESERVE))).toBe(false);
    expect(shouldLiftDock(dockBand(canvasWidthOf(900), DOCK_DEFAULT_RESERVE))).toBe(false);
  });
});

describe("DEF-319 — the canvas-bound layer contract in the stylesheet", () => {
  const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const docView = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("insets .canvas-overlay by the Inspector width and keeps it pointer-inert", () => {
    expect(css).toMatch(
      /\.canvas-overlay\s*\{[^}]*right:\s*var\(--tf-tools-inset,\s*0px\)/s,
    );
    expect(css).toMatch(/\.canvas-overlay\s*\{[^}]*pointer-events:\s*none/s);
    // No stacking context: the dock's overflow menu keeps its lane.
    expect(css).not.toMatch(/\.canvas-overlay\s*\{[^}]*z-index/s);
  });

  it("opts the dock back into pointer events inside the inert layer", () => {
    expect(css).toMatch(/\.action-dock\s*\{[^}]*pointer-events:\s*auto/s);
  });

  it("mounts the pills, the flyout and the dock inside the layer", () => {
    expect(docView).toContain('className="canvas-overlay"');
    const layerStart = docView.indexOf('className="canvas-overlay"');
    const pillsAt = docView.indexOf("<CanvasPills", layerStart);
    const dockAt = docView.indexOf("<ActionDock", layerStart);
    expect(pillsAt, "the pills follow the layer open tag").toBeGreaterThan(layerStart);
    expect(dockAt, "the dock follows the layer open tag").toBeGreaterThan(layerStart);
    expect(docView.indexOf("<AnnotationFlyout", layerStart)).toBeGreaterThan(layerStart);
  });
});

// ---------------------------------------------------------------------------
// 6. DEF-322 — the two SINGLE-MODE pills YIELD as the canvas narrows.
//
// Single mode's visible canvas is the window less BOTH side panels: the 72px
// stage rail + the 220px ContextPanel on the left, and the 264px Inspector on
// the right (qa's live probe: 276..636 at a 900px window = 372px wide). The
// yield ladder (pillFit.ts / the stylesheet container queries) is:
//
//   full     canvas >= 404px   both pills full width, one row;
//   compact  canvas >= 308px   icon-only zoom + a compact page readout;
//   stacked  otherwise         the zoom pill RAISED above the page pill.
//
// The invariant at 1440/1100/900/760/640: the two pills never intersect, the
// dock reaches neither, and every control's centre is clear of the dock and
// the other pill.
// ---------------------------------------------------------------------------

// DEF-581 - the rail is a 72px track in the delivered Phase 108 layout; derive
// it from the stylesheet token (like def320_stageRailTrack / phase37Chunk5) so
// the clearance model tracks the real canvas instead of a stale 44px constant.
const STAGE_RAIL_W = Number.parseFloat(
  (/--tf-stage-rail-w:\s*(\d+)px/.exec(readFileSync(STYLES_PATH, "utf8")) ?? [])[1] ?? "NaN",
);
const CONTEXT_PANEL_W = 220;
const SIDE_CHROME_W = STAGE_RAIL_W + CONTEXT_PANEL_W;
const BOTTOM_INSET = 12;

function visibleCanvasOf(windowWidth: number): number {
  return Math.max(0, windowWidth - SIDE_CHROME_W - INSPECTOR_W);
}

function pointIn(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The dock's worst-case box centred on the canvas, parked by the MEASURED
 *  pill BAND (DEF-322 — a stacked pair lifts the dock one band high). */
function singleModeDock(canvas: number, page: PillBox, zoom: PillBox): Rect {
  const reserve = pillReserve({ page, zoom, hostLeft: 0, hostRight: canvas });
  const band = dockBand(canvas, reserve);
  const lifted = shouldLiftDock(band);
  const lift = lifted ? pillBandHeight(page, zoom) + DOCK_PILL_GAP : 0;
  const cap = lifted ? Math.max(0, canvas - 2 * DOCK_LIFT_INSET) : band;
  const bottom = HOST_H - BOTTOM_INSET - lift;
  return {
    left: canvas / 2 - cap / 2,
    right: canvas / 2 + cap / 2,
    top: bottom - DOCK_H,
    bottom,
  };
}

function assertControlsClearAt(
  controls: PillControl[],
  blockers: { name: string; rect: Rect }[],
  where: string,
): void {
  for (const control of controls) {
    const p = controlCentre(control);
    for (const blocker of blockers) {
      expect(
        pointIn(blocker.rect, p.x, p.y),
        `${control.name} at ${where} is clear of ${blocker.name}`,
      ).toBe(false);
    }
  }
}

describe("DEF-322 — the two pills yield, never colliding, at every supported width", () => {
  const CASES: { window: number; mode: "full" | "compact" | "stacked" }[] = [
    { window: 1440, mode: "full" },
    { window: 1100, mode: "full" },
    { window: 900, mode: "compact" },
    { window: 760, mode: "stacked" },
    { window: 640, mode: "stacked" },
  ];

  for (const { window: w, mode } of CASES) {
    it(`yields to ${mode} and keeps every control hit-testable at a ${w}px window`, () => {
      const canvas = visibleCanvasOf(w);
      const layout = pillLayout(canvas, HOST_H);
      expect(layout.mode, `the plan at ${w}px`).toBe(mode);
      const dock = singleModeDock(canvas, layout.page, layout.zoom);

      // The two pills NEVER intersect.
      expect(rectsIntersect(layout.page, layout.zoom), `pill-pill at ${w}px`).toBe(false);
      // The dock reaches neither pill.
      expect(rectsIntersect(dock, layout.page), `dock-page at ${w}px`).toBe(false);
      expect(rectsIntersect(dock, layout.zoom), `dock-zoom at ${w}px`).toBe(false);
      // Every control's centre is clear of the dock and the other pill.
      assertControlsClearAt(
        pageControls(layout.page, layout.mode),
        [{ name: "the dock", rect: dock }, { name: "the zoom pill", rect: layout.zoom }],
        `a ${w}px window`,
      );
      assertControlsClearAt(
        zoomControls(layout.zoom, layout.mode),
        [{ name: "the dock", rect: dock }, { name: "the page pill", rect: layout.page }],
        `a ${w}px window`,
      );
    });
  }

  it("keys the yield on the measured pair widths, not on a hardcoded window", () => {
    expect(FULL_MIN_CANVAS).toBe(404);
    expect(COMPACT_MIN_CANVAS).toBe(308);
    expect(PAGE_FULL_W + ZOOM_FULL_W + 2 * DOCK_PILL_INSET + DOCK_PILL_GAP).toBe(FULL_MIN_CANVAS);
    expect(PAGE_COMPACT_W + ZOOM_COMPACT_W + 2 * DOCK_PILL_INSET + DOCK_PILL_GAP).toBe(COMPACT_MIN_CANVAS);
    expect(PAGE_COMPACT_W).toBe(106);
    expect(ZOOM_COMPACT_W).toBe(170);
    expect(pillMode(404)).toBe("full");
    expect(pillMode(403)).toBe("compact");
    expect(pillMode(308)).toBe("compact");
    expect(pillMode(307)).toBe("stacked");
    // The visible canvas at the five supported windows (qa's probe), with the
    // delivered 72px Phase 108 rail in the side-chrome model.
    expect(visibleCanvasOf(1440)).toBe(884);
    expect(visibleCanvasOf(1100)).toBe(544);
    expect(visibleCanvasOf(900)).toBe(344);
    expect(visibleCanvasOf(760)).toBe(204);
    expect(visibleCanvasOf(640)).toBe(84);
  });

  it("raises the zoom pill clear of the page pill when stacked", () => {
    const layout = pillLayout(112, HOST_H);
    expect(layout.mode).toBe("stacked");
    expect(layout.zoom.bottom).toBeLessThanOrEqual(layout.page.top - 6);
    expect(rectsIntersect(layout.page, layout.zoom)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. DEF-323 — in Multi Mode each PANE's pills sit at that pane's OUTER edge,
//    outboard of the shared dock's centred band and inside that pane's own
//    bounds. The pane's `.canvas-overlay` must NOT re-apply the Inspector
//    inset (the pane geometry already consumed it, DEF-286/287).
// ---------------------------------------------------------------------------

/** The Multi Mode panes' pills (Phase 40, item 1): the two pills sit
 *  HORIZONTALLY — page at the pills layer's left, zoom at its right — one row
 *  at the pane's bottom inset. The layer spans the pane's page column when the
 *  full pair fits there, and the whole pane inside the reserved one-row band
 *  otherwise (the strip stops above the band). The panes themselves stop
 *  `MULTI_DOCK_BAND_BASE_PX` above the stage bottom, so the pills can never
 *  reach the shared dock whatever their x range. */
interface MultiPanePills {
  page: PillBox;
  zoom: PillBox;
  rect: Rect;
  tier: MultiPillTier;
}

function multiPills(appWidth: number): {
  paneA: MultiPanePills;
  paneB: MultiPanePills;
  dock: Rect;
} {
  const stageLeft = STAGE_RAIL_W;
  const stage = appWidth - STAGE_RAIL_W;
  const geo = multiPaneGeometry(stage, INSPECTOR_W, 0.5);
  const aLeft = stageLeft + geo.paneA.left;
  const aRight = stageLeft + geo.paneA.right;
  const bLeft = stageLeft + geo.paneB.left;
  const bRight = stageLeft + geo.paneB.right;
  // The panes own the stage minus the shared dock's reserved bottom band.
  const paneBottom = HOST_H - MULTI_DOCK_BAND_BASE_PX;
  const build = (left: number, right: number, paneWidth: number): MultiPanePills => {
    const layer = multiPillLayerWidthPx(paneWidth);
    const tier = multiPillTier(layer);
    const m = multiPillMetrics(tier);
    // The layer is right-aligned to the pane's right edge for pane B (its page
    // column is the right track) and left-aligned for pane A.
    const layerLeft = left === bLeft ? right - layer : left;
    const bottom = paneBottom - PILL_BOTTOM;
    const box = (boxLeft: number, width: number): PillBox => ({
      left: boxLeft,
      right: boxLeft + width,
      top: bottom - m.height,
      bottom,
      width,
      height: m.height,
    });
    return {
      page: box(layerLeft + m.inset, m.pageW),
      zoom: box(layerLeft + layer - m.inset - m.zoomW, m.zoomW),
      rect: { left, right, top: 0, bottom: paneBottom },
      tier,
    };
  };
  const paneA = build(aLeft, aRight, geo.paneA.width);
  const paneB = build(bLeft, bRight, geo.paneB.width);
  // The shared dock: centred on `.multi-dock-layer` (the stage less the
  // Inspector inset). It has no pill siblings, so it never lifts and its cap
  // is its band.
  const layerLeft = stageLeft;
  const layerWidth = stage - geo.inset;
  const band = Math.max(0, layerWidth - DOCK_DEFAULT_RESERVE);
  const dock: Rect = {
    left: layerLeft + layerWidth / 2 - band / 2,
    right: layerLeft + layerWidth / 2 + band / 2,
    top: HOST_H - 12 - DOCK_H,
    bottom: HOST_H - 12,
  };
  return { paneA, paneB, dock };
}

describe("DEF-323 — each pane's pills clear the dock and the other pane in Multi Mode", () => {
  for (const w of [1440, 1100, 900]) {
    it(`keeps both panes' pills clear at a ${w}px window`, () => {
      const { paneA, paneB, dock } = multiPills(w);

      expect(rectsIntersect(paneA.page, paneA.zoom), `pane A pair at ${w}`).toBe(false);
      expect(rectsIntersect(paneB.page, paneB.zoom), `pane B pair at ${w}`).toBe(false);

      const checkPane = (name: "A" | "B", pane: MultiPanePills, other: MultiPanePills): void => {
        const otherName = name === "A" ? "B" : "A";
        for (const pill of [pane.page, pane.zoom]) {
          expect(rectsIntersect(pill, dock), `pane ${name} pill vs dock at ${w}`).toBe(false);
          expect(rectsIntersect(pill, other.rect), `pane ${name} pill vs pane ${otherName} at ${w}`).toBe(false);
          expect(pill.left, `pane ${name} pill inside its pane at ${w}`).toBeGreaterThanOrEqual(pane.rect.left);
          expect(pill.right, `pane ${name} pill inside its pane at ${w}`).toBeLessThanOrEqual(pane.rect.right);
        }
        // The inner-row control geometry is the single-mode ladder's (28px
        // buttons); the micro tier's dense 24px chrome is covered by the
        // Phase 40 spec, so the control-level check runs for full/compact.
        if (pane.tier !== "micro") {
          const mode = pane.tier === "full" ? "full" : "compact";
          assertControlsClearAt(
            [...pageControls(pane.page, mode), ...zoomControls(pane.zoom, mode)],
            [{ name: "the dock", rect: dock }, { name: `pane ${otherName}`, rect: other.rect }],
            `pane ${name} at a ${w}px window`,
          );
        }
      };
      checkPane("A", paneA, paneB);
      checkPane("B", paneB, paneA);
    });
  }

  it("proves the double-inset regression is what pushed pane B under the dock", () => {
    // Without the DEF-323 fix, pane B's overlay re-applies the 264px Inspector
    // inset: its right edge moves left by 264 and the right-anchored pills
    // land in the divider, under the dock.
    const { paneB, dock } = multiPills(1440);
    const buggyRight = paneB.rect.right - INSPECTOR_W - BOTTOM_INSET;
    const buggyZoom: Rect = { left: buggyRight - ZOOM_FULL_W, right: buggyRight, top: 0, bottom: HOST_H };
    expect(rectsIntersect(buggyZoom, dock), "the DEF-323 geometry reproduces").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. The stylesheet + the dock carry the yield ladder and the multi fix.
// ---------------------------------------------------------------------------

describe("DEF-322/323 — the stylesheet and the dock carry the fix", () => {
  const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const actionDock = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/ActionDock.tsx"),
    "utf8",
  );

  it("makes the SINGLE-mode canvas overlay the query container", () => {
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode='false'\]\s+\.canvas-overlay\s*\{[^}]*container-type:\s*size/s,
    );
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode='false'\]\s+\.canvas-overlay\s*\{[^}]*container-name:\s*canvas-pills/s,
    );
  });

  it("compacts at the full-pair threshold and stacks below the compact threshold", () => {
    expect(css).toMatch(new RegExp(`@container canvas-pills \\(max-width: ${FULL_MIN_CANVAS - 1}px\\)`));
    expect(css).toMatch(new RegExp(`@container canvas-pills \\(max-width: ${COMPACT_MIN_CANVAS - 1}px\\)`));
    expect(css).toMatch(
      /@container canvas-pills \(max-width: 403px\)[\s\S]*?\.zoom-percent[\s\S]*?display:\s*none/,
    );
    expect(css).toMatch(
      /@container canvas-pills \(max-width: 403px\)[\s\S]*?\.page-input\s*\{[^}]*width:\s*20px/s,
    );
    expect(css).toMatch(
      /@container canvas-pills \(max-width: 307px\)[\s\S]*?\.canvas-pill-zoom\s*\{[^}]*bottom:\s*60px/s,
    );
  });

  it("resets the Inspector inset on the multi-mode pane overlay (DEF-323)", () => {
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode='true'\]\s+\.canvas-overlay\s*\{[^}]*right:\s*0/s,
    );
  });

  it("lifts the dock by the measured pill BAND, so a raised pill is never covered", () => {
    expect(actionDock).toMatch(/pillBandHeight/);
  });
});

