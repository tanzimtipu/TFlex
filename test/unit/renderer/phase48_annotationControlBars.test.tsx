// @vitest-environment jsdom
//
// Phase 48 (item 3 + item 4) - annotation control placement + the
// comment box on selection only.
//
// Item 3: a selected rectangle at the page's bottom edge used to render
// its action bar (the Delete control) BELOW the page, outside the
// visible view. Every floating control bar now clamps into the page
// viewport through one shared helper (`controlPlacement`).
//
// Item 4: placing a TEXT / COMMENT annotation used to auto-open the
// comment box (because the placement auto-selects it). It must behave
// like a rectangle: create, keep the normal action bar, and open the
// comment box only when the user later selects it.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  AnnotationOverlay,
  type AnnotationOverlayProps,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  CONTROL_BAR_HEIGHT,
  CONTROL_EDGE_GAP,
  clampControlPosition,
  placeControlNearAnchor,
} from "../../../src/renderer/components/controlPlacement";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_W = 612;
const PAGE_H = 792;
const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

// ---------------------------------------------------------------------------
// Part A - the shared clamp rule (pure geometry)

describe("Phase 48 item 3 - clampControlPosition keeps a control inside the view", () => {
  const size = { width: 240, height: CONTROL_BAR_HEIGHT };

  it("leaves an in-view control untouched", () => {
    const p = clampControlPosition({ left: 100, top: 200 }, size, { width: PAGE_W, height: PAGE_H });
    expect(p).toEqual({ left: 100, top: 200 });
  });

  it("pulls a bottom-edge control up so its full box stays on the page", () => {
    // A bar whose preferred top is 800 on a 792 page (the operator's
    // rectangle: annotation flush with the bottom edge).
    const p = clampControlPosition({ left: 100, top: 800 }, size, { width: PAGE_W, height: PAGE_H });
    expect(p.top).toBe(PAGE_H - CONTROL_BAR_HEIGHT - CONTROL_EDGE_GAP);
    expect(p.top + size.height).toBeLessThanOrEqual(PAGE_H - CONTROL_EDGE_GAP);
  });

  it("clamps the right edge to the page's right gutter", () => {
    const p = clampControlPosition({ left: 900, top: 100 }, size, { width: PAGE_W, height: PAGE_H });
    expect(p.left).toBe(PAGE_W - size.width - CONTROL_EDGE_GAP);
  });

  it("pins to the leading edge when the control is wider than the view", () => {
    const p = clampControlPosition({ left: 50, top: 50 }, size, { width: 100, height: PAGE_H });
    expect(p.left).toBe(CONTROL_EDGE_GAP);
  });

  it("is identical at every zoom level (the page view scales linearly)", () => {
    for (const scale of [1, 1.5]) {
      const p = clampControlPosition(
        { left: 500 * scale, top: (PAGE_H + 20) * scale },
        size,
        { width: PAGE_W * scale, height: PAGE_H * scale },
      );
      expect(p.left).toBe(PAGE_W * scale - size.width - CONTROL_EDGE_GAP);
      expect(p.top).toBe(PAGE_H * scale - size.height - CONTROL_EDGE_GAP);
    }
  });
});

describe("Phase 48 item 3 - placeControlNearAnchor flips instead of leaving the page", () => {
  const size = { width: 240, height: CONTROL_BAR_HEIGHT };

  it("places below a mid-page anchor (unchanged home)", () => {
    const p = placeControlNearAnchor({
      anchor: { left: 100, top: 100, bottom: 180 },
      size,
      viewport: { width: PAGE_W, height: PAGE_H },
    });
    expect(p.top).toBe(180 + CONTROL_EDGE_GAP);
    expect(p.left).toBe(100);
  });

  it("flips above a bottom-edge anchor and stays fully inside", () => {
    // Rectangle flush with the bottom: top 752, bottom 792.
    const p = placeControlNearAnchor({
      anchor: { left: 100, top: 752, bottom: PAGE_H },
      size,
      viewport: { width: PAGE_W, height: PAGE_H },
    });
    expect(p.top).toBe(752 - size.height - CONTROL_EDGE_GAP);
    expect(p.top + size.height).toBeLessThanOrEqual(PAGE_H - CONTROL_EDGE_GAP);
    expect(p.top).toBeGreaterThanOrEqual(CONTROL_EDGE_GAP);
  });

  it("keeps below when there is no room above either (never leaves the page)", () => {
    const p = placeControlNearAnchor({
      anchor: { left: 100, top: 0, bottom: PAGE_H },
      size,
      viewport: { width: PAGE_W, height: PAGE_H },
    });
    expect(p.top).toBe(PAGE_H - size.height - CONTROL_EDGE_GAP);
  });

  it("flips below a top-edge anchor even when asked to prefer above", () => {
    const p = placeControlNearAnchor({
      anchor: { left: 100, top: 0, bottom: 40 },
      size,
      viewport: { width: PAGE_W, height: PAGE_H },
      preferBelow: false,
    });
    expect(p.top).toBe(40 + CONTROL_EDGE_GAP);
  });
});

describe("Phase 48 item 3 - the clamp rule holds for every offender's bar size", () => {
  // One entry per control bar that anchors to page content. The
  // bottom-edge case is the operator's report; the right-edge case is
  // the signature bar's horizontal offender.
  const cases: Array<{ name: string; width: number }> = [
    { name: "annotation action bar (240)", width: 240 },
    { name: "stamp action bar (240)", width: 240 },
    { name: "textbox toolbar (200)", width: 200 },
    { name: "image placement toolbar (220)", width: 220 },
    { name: "text-run bar (240)", width: 240 },
    { name: "signature action bar (260)", width: 260 },
  ];
  for (const c of cases) {
    it(`${c.name}: bottom-edge annotation stays inside the page`, () => {
      const size = { width: c.width, height: CONTROL_BAR_HEIGHT };
      const p = placeControlNearAnchor({
        anchor: { left: 100, top: 712, bottom: PAGE_H },
        size,
        viewport: { width: PAGE_W, height: PAGE_H },
      });
      expect(p.top).toBeGreaterThanOrEqual(CONTROL_EDGE_GAP);
      expect(p.top + size.height).toBeLessThanOrEqual(PAGE_H - CONTROL_EDGE_GAP);
    });
  }

  it("signature bar: right-edge placement is pulled inside the page", () => {
    const size = { width: 260, height: CONTROL_BAR_HEIGHT };
    const p = clampControlPosition(
      { left: 548, top: 100 },
      size,
      { width: PAGE_W, height: PAGE_H },
    );
    expect(p.left).toBe(PAGE_W - size.width - CONTROL_EDGE_GAP);
    expect(p.left + size.width).toBeLessThanOrEqual(PAGE_W - CONTROL_EDGE_GAP);
  });
});

// ---------------------------------------------------------------------------
// Part B / C - rendered overlay: bar clamp + comment box on selection only

function noop(): void {
  /* pointer-capture stub */
}

interface Harness {
  host: HTMLElement;
  onCreate: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function mountOverlay(args: {
  annotations: Annotation[];
  tool: AnnotationToolState;
}): Harness {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = noop;
  Element.prototype.releasePointerCapture = noop;
  const root = createRoot(host);
  const onCreate = vi.fn();
  const props: AnnotationOverlayProps = {
    page: 1,
    widthPt: PAGE_W,
    heightPt: PAGE_H,
    cssScale: 1,
    annotations: args.annotations,
    tool: args.tool,
    flashId: null,
    getTextItems: (): never[] => [],
    onCreate,
    onAddComment: (): void => undefined,
    onTextFocusRequest: (): void => undefined,
    onDisarmTool: (): void => undefined,
    onFinishedOneShot: (): void => undefined,
  };
  act((): void => {
    root.render(<AnnotationOverlay {...props} />);
  });
  return {
    host,
    onCreate,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pointer(el: Element, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

function clickEl(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const RECT_BOTTOM: Annotation = {
  id: "rect-b",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 752, width: 100, height: 40 },
};

describe("Phase 48 item 3 - rendered action bar stays inside the page", () => {
  it("a rectangle flush with the page bottom renders its bar inside the page", () => {
    const h = mountOverlay({ annotations: [RECT_BOTTOM], tool: SELECT_TOOL });
    try {
      clickEl(h.host.querySelector(".ann-shape[data-annotation-id='rect-b']"));
      const bar = h.host.querySelector<HTMLElement>("[data-content-action-bar='ann-rect']");
      expect(bar, "action bar mounted on selection").not.toBeNull();
      if (bar === null) return;
      const top = Number.parseFloat(bar.style.top);
      const left = Number.parseFloat(bar.style.left);
      // The pre-fix bar sat at 796 (page bottom + 4) - fully outside.
      expect(top).toBe(752 - CONTROL_BAR_HEIGHT - CONTROL_EDGE_GAP);
      expect(top).toBeGreaterThanOrEqual(CONTROL_EDGE_GAP);
      expect(top + CONTROL_BAR_HEIGHT).toBeLessThanOrEqual(PAGE_H - CONTROL_EDGE_GAP);
      expect(left).toBeGreaterThanOrEqual(CONTROL_EDGE_GAP);
      expect(left + 240).toBeLessThanOrEqual(PAGE_W - CONTROL_EDGE_GAP);
      // The Delete control (the reported offender) is inside the page.
      expect(h.host.querySelector("[data-content-action='ann-rect-delete']")).not.toBeNull();
    } finally {
      h.cleanup();
    }
  });
});

describe("Phase 48 item 4 - comment box opens on SELECTION, not on creation", () => {
  it("placing a TEXT annotation keeps the action bar and does not open the box", () => {
    const h = mountOverlay({ annotations: [], tool: { ...SELECT_TOOL, tool: "textbox" } });
    try {
      pointer(h.host.querySelector("[data-annotation-layer='1']") as Element, "pointerdown", 100, 100);
      expect(h.onCreate).toHaveBeenCalledTimes(1);
      expect(h.onCreate.mock.calls[0]?.[0]?.kind).toBe("textbox");
      expect(h.host.querySelector("[data-content-action-bar='ann-textbox']"), "normal bar").not.toBeNull();
      expect(h.host.querySelector("[data-ann-comment-box]"), "no auto comment box").toBeNull();
      // A later click on the placed annotation opens the box.
      clickEl(h.host.querySelector(".ann-textbox[data-annotation-id]"));
      expect(h.host.querySelector("[data-ann-comment-box]"), "box on later select").not.toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("placing a COMMENT (note) annotation keeps the action bar and does not open the box", () => {
    const h = mountOverlay({ annotations: [], tool: { ...SELECT_TOOL, tool: "note" } });
    try {
      pointer(h.host.querySelector("[data-annotation-layer='1']") as Element, "pointerdown", 100, 100);
      expect(h.onCreate).toHaveBeenCalledTimes(1);
      expect(h.onCreate.mock.calls[0]?.[0]?.kind).toBe("note");
      expect(h.host.querySelector("[data-content-action-bar='ann-note']"), "normal bar").not.toBeNull();
      expect(h.host.querySelector("[data-ann-comment-box]"), "no auto comment box").toBeNull();
      clickEl(h.host.querySelector(".ann-note[data-annotation-id]"));
      expect(h.host.querySelector("[data-ann-comment-box]"), "box on later select").not.toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("a rectangle is unchanged: creation never opens the box, selection does", () => {
    const h = mountOverlay({ annotations: [RECT_BOTTOM], tool: { ...SELECT_TOOL, tool: "rect" } });
    try {
      // Creation drag: no selection, no bar, no comment box (as before).
      const layer = h.host.querySelector("[data-annotation-layer='1']") as Element;
      pointer(layer, "pointerdown", 300, 300);
      pointer(layer, "pointermove", 420, 380);
      pointer(layer, "pointerup", 420, 380);
      expect(h.onCreate).toHaveBeenCalledTimes(1);
      expect(h.host.querySelector("[data-content-action-bar]")).toBeNull();
      expect(h.host.querySelector("[data-ann-comment-box]")).toBeNull();
      // Selecting an existing rectangle opens BOTH the bar and the box.
      clickEl(h.host.querySelector(".ann-shape[data-annotation-id='rect-b']"));
      expect(h.host.querySelector("[data-content-action-bar='ann-rect']")).not.toBeNull();
      expect(h.host.querySelector("[data-ann-comment-box]")).not.toBeNull();
    } finally {
      h.cleanup();
    }
  });
});

