// @vitest-environment jsdom
//
// B10 / DEF-101 + Bug 6 — stamp placement must produce a visible
// `.stamp-annotation` surface at the placed rect. The engine's
// `addStamp` bakes the pixels into the page bitmap (no DOM node),
// so the renderer mirrors each successful placement as a positioned
// `.stamp-annotation` div carrying the placed raster. This is what
// makes a placement verifiable in the DOM (and is the surface
// QA's e2e `.stamp-annotation` locator resolves to).
//
// Bug 6 — the surface is now INTERACTIVE like every annotation:
// single click selects (Confirm / Edit / Delete bar + corner resize
// handles), drag parks a pending move (Confirm commits it through
// `onMove`), Delete routes through `onDelete`, Edit opens the
// stamp-type picker (retype routes through `onRetype`).
//
// DEF-176 — corner RESIZE was dead: the handle's pointerdown sets
// pointer capture on the HANDLE, so every follow-up move/up is
// retargeted to the handle and bubbles through the selection FRAME —
// the sibling `.stamp-annotation` surface (which owned the move/up
// handlers) never saw them. The frame now carries the move/up
// handlers, and the resize runs aspect-locked math
// (`resizeStampRect`) so the stamp raster never squashes.
//
// Coverage (behavior):
//   1. No placements -> renders nothing (null).
//   2. One placement -> one `.stamp-annotation` node positioned at
//      rect * cssScale with pointer-events: auto (interactive) and
//      page / id data attributes.
//   3. Multiple placements on different pages -> one node each,
//      each with its own rect.
//   4. Single click selects the stamp: the Confirm / Edit / Delete
//      bar renders (no engine call yet).
//   5. Confirm with a parked pending move calls onMove(stamp, rect).
//   6. Delete calls onDelete(stamp) and clears the bar.
//   7. Edit opens the stamp-type picker; picking a type calls
//      onRetype(stamp, id).
//  8-10. DEF-176 — dragging a corner handle parks an aspect-locked
//      pending RESIZE; Confirm applies it via onMove; all four
//      handles keep the stamp's width/height ratio; a handle press
//      without movement parks nothing.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  StampAnnotations,
  resizeStampRect,
  type PlacedStamp,
} from "../../../src/renderer/annotations/StampAnnotations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makePlaced(overrides: Partial<PlacedStamp>): PlacedStamp {
  return {
    id: "p-1",
    stampId: "APPROVED",
    page: 1,
    rect: { x: 50, y: 60, width: 200, height: 80 },
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
    ...overrides,
  };
}

function mount(
  items: PlacedStamp[],
  handlers?: {
    onMove?: (stamp: PlacedStamp, rect: { x: number; y: number; width: number; height: number }) => void;
    onDelete?: (stamp: PlacedStamp) => void;
    onRetype?: (stamp: PlacedStamp, stampId: PlacedStamp["stampId"]) => void;
  },
): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onMove: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onRetype: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "900px";
  host.style.height = "700px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const onMove = vi.fn(handlers?.onMove ?? ((): void => undefined));
  const onDelete = vi.fn(handlers?.onDelete ?? ((): void => undefined));
  const onRetype = vi.fn(handlers?.onRetype ?? ((): void => undefined));
  const root = createRoot(host);
  act((): void => {
    root.render(
      <StampAnnotations
        cssScale={2}
        items={items}
        pageWidthPt={612}
        pageHeightPt={792}
        onMove={onMove}
        onDelete={onDelete}
        onRetype={onRetype}
      />,
    );
  });
  return {
    host,
    root,
    onMove,
    onDelete,
    onRetype,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function press(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function move(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function up(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function barOf(host: HTMLElement): HTMLElement {
  const bar = host.querySelector<HTMLElement>("[data-content-action-bar='stamp']");
  if (bar === null) throw new Error("stamp action bar not found");
  return bar;
}

function confirmBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>("[data-content-action='stamp-confirm']");
  if (btn === null) throw new Error("stamp confirm not found");
  return btn;
}

function deleteBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>("[data-content-action='stamp-delete']");
  if (btn === null) throw new Error("stamp delete not found");
  return btn;
}

describe("B10 / DEF-101 — placed stamps render as .stamp-annotation surfaces at the placed rect", () => {
  it("renders nothing when no stamp has been placed", () => {
    const { host, cleanup } = mount([]);
    try {
      expect(host.querySelector(".stamp-annotation")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders one .stamp-annotation per placement at rect * cssScale, pointer-active", () => {
    const { host, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      // Geometry: rect (page points) scaled by cssScale (2).
      expect(node.style.left).toBe("100px");
      expect(node.style.top).toBe("120px");
      expect(node.style.width).toBe("400px");
      expect(node.style.height).toBe("160px");
      // Bug 6 — the surface is interactive (selectable / movable),
      // so pointer-events is now auto, not none.
      expect(node.style.pointerEvents).toBe("auto");
      // Identity + page data so tests / panel links can resolve it.
      expect(node.getAttribute("data-stamp-annotation")).toBe("p-1");
      expect(node.getAttribute("data-stamp-id")).toBe("APPROVED");
      expect(node.getAttribute("data-page")).toBe("1");
    } finally {
      cleanup();
    }
  });

  it("keeps placements on different pages distinct with their own rects", () => {
    const { host, cleanup } = mount([
      makePlaced({ id: "p-1", page: 1, rect: { x: 0, y: 0, width: 100, height: 50 } }),
      makePlaced({ id: "p-2", page: 2, rect: { x: 10, y: 20, width: 60, height: 30 } }),
    ]);
    try {
      const nodes = host.querySelectorAll<HTMLElement>(".stamp-annotation");
      expect(nodes.length).toBe(2);
      const a = nodes[0];
      const b = nodes[1];
      if (a === undefined || b === undefined) throw new Error("missing nodes");
      expect(a.getAttribute("data-page")).toBe("1");
      expect(a.style.left).toBe("0px");
      expect(a.style.top).toBe("0px");
      expect(b.getAttribute("data-page")).toBe("2");
      expect(b.style.left).toBe("20px");
      expect(b.style.top).toBe("40px");
    } finally {
      cleanup();
    }
  });
});

describe("Bug 6 — placed stamps are selectable / movable / deletable / retypeable", () => {
  it("single click selects the stamp: Confirm / Edit / Delete bar appears, no engine call yet", () => {
    const { host, onMove, onDelete, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      const bar = barOf(host);
      expect(bar).not.toBeNull();
      expect(
        host.querySelector("[data-content-action='stamp-edit']"),
      ).not.toBeNull();
      expect(onMove).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
      // The selection ring renders.
      expect(host.querySelector("[data-content-selection-frame]")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("dragging the stamp parks a pending move; Confirm commits it via onMove with the shifted rect", () => {
    const { host, onMove, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      // Drag from the stamp's top-left corner by (+40, +20) client px.
      // cssScale 2 -> the rect moves (+20, +10) page points.
      press(node, 105, 125);
      move(node, 145, 145);
      up(node, 145, 145);
      clickEl(confirmBtn(host));
      expect(onMove).toHaveBeenCalledTimes(1);
      const stamp = onMove.mock.calls[0]?.[0] as PlacedStamp;
      const rect = onMove.mock.calls[0]?.[1] as {
        x: number; y: number; width: number; height: number;
      };
      expect(stamp.id).toBe("p-1");
      expect(rect.x).toBe(70);
      expect(rect.y).toBe(70);
      expect(rect.width).toBe(200);
      expect(rect.height).toBe(80);
    } finally {
      cleanup();
    }
  });

  it("Delete routes through onDelete and drops the bar", () => {
    const { host, onDelete, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      clickEl(deleteBtn(host));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]?.[0]?.id).toBe("p-1");
      expect(host.querySelector("[data-content-action-bar='stamp']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Edit opens the stamp-type picker; picking a type routes through onRetype", () => {
    const { host, onRetype, cleanup } = mount([makePlaced({ stampId: "APPROVED" })]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      const edit = host.querySelector<HTMLButtonElement>(
        "[data-content-action='stamp-edit']",
      );
      if (edit === null) throw new Error("stamp edit not found");
      clickEl(edit);
      const picker = host.querySelector<HTMLElement>("[data-stamp-type-editor]");
      expect(picker, "the stamp-type picker opens").not.toBeNull();
      const draft = host.querySelector<HTMLButtonElement>(
        "[data-stamp-type-btn='DRAFT']",
      );
      if (draft === null) throw new Error("DRAFT button not found");
      clickEl(draft);
      expect(onRetype).toHaveBeenCalledTimes(1);
      expect(onRetype.mock.calls[0]?.[0]?.id).toBe("p-1");
      expect(onRetype.mock.calls[0]?.[1]).toBe("DRAFT");
    } finally {
      cleanup();
    }
  });
});

// DEF-176 — the resize MATH: every corner keeps width/height fixed at
// the stamp's aspect while the anchor corner stays pinned. Pure and
// DOM-free so the math is verified directly.
describe("DEF-176 — resizeStampRect maintains the stamp's aspect ratio", () => {
  const START = { x: 50, y: 60, width: 200, height: 80 }; // aspect 2.5

  it("se handle grows from the top-left anchor, height-driven scale keeps the ratio", () => {
    const r = resizeStampRect(START, "se", { x: 20, y: 10 }, 612, 792, 2.5);
    expect(r).toEqual({ x: 50, y: 60, width: 225, height: 90 });
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("nw handle grows from the bottom-right anchor", () => {
    const r = resizeStampRect(START, "nw", { x: -20, y: -10 }, 612, 792, 2.5);
    expect(r).toEqual({ x: 25, y: 50, width: 225, height: 90 });
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("ne handle grows from the bottom-left anchor", () => {
    const r = resizeStampRect(START, "ne", { x: 20, y: -10 }, 612, 792, 2.5);
    expect(r).toEqual({ x: 50, y: 50, width: 225, height: 90 });
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("sw handle grows from the top-right anchor", () => {
    const r = resizeStampRect(START, "sw", { x: -20, y: 10 }, 612, 792, 2.5);
    expect(r).toEqual({ x: 25, y: 60, width: 225, height: 90 });
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("every handle shrinks toward its anchor without breaking the ratio", () => {
    const shrink = { nw: { x: 10, y: 10 }, ne: { x: -10, y: 10 }, sw: { x: 10, y: -10 }, se: { x: -10, y: -10 } };
    for (const h of ["nw", "ne", "sw", "se"] as const) {
      const r = resizeStampRect(START, h, shrink[h], 612, 792, 2.5);
      expect(r.width).toBeLessThan(200);
      expect(r.height).toBeLessThan(80);
      expect(r.width / r.height).toBeCloseTo(2.5, 6);
    }
  });

  it("clamps to the 4 pt minimum instead of inverting on an extreme shrink", () => {
    const r = resizeStampRect(START, "nw", { x: 195, y: 79 }, 612, 792, 2.5);
    expect(r.width).toBeGreaterThanOrEqual(4);
    expect(r.height).toBeGreaterThanOrEqual(4);
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("clamps inside the page on an extreme grow", () => {
    const r = resizeStampRect(START, "se", { x: 1500, y: 300 }, 612, 792, 2.5);
    expect(r.x + r.width).toBeLessThanOrEqual(612);
    expect(r.y + r.height).toBeLessThanOrEqual(792);
    expect(r.width / r.height).toBeCloseTo(2.5, 6);
  });

  it("degenerate start rects return unchanged", () => {
    const start = { x: 10, y: 20, width: 0, height: 0 };
    expect(resizeStampRect(start, "se", { x: 5, y: 5 }, 612, 792, 2.5)).toEqual(start);
  });
});

// DEF-176 — the WIRING: the resize handles capture the pointer on the
// HANDLE (pointer events retarget there), so the move/up handlers must
// live on the selection frame that is the handles' ancestor — not on
// the sibling `.stamp-annotation` surface. Events dispatched on the
// handle bubble through the frame exactly like pointer capture in a
// real browser.
describe("DEF-176 — dragging a corner handle resizes the stamp", () => {
  it("se handle drag parks an aspect-locked pending resize; Confirm applies it via onMove", () => {
    const { host, onMove, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      const handle = host.querySelector<HTMLElement>('[data-stamp-resize-handle="se"]');
      if (handle === null) throw new Error("se handle not rendered");
      // Drag +40/+20 CSS px (cssScale 2 -> +20/+10 pt). The y axis
      // moved 12.5% vs 10% on x, so the height drives the scale:
      // 1.125 -> 200x80 becomes 225x90, anchor (50, 60) pinned.
      press(handle, 300, 200);
      move(handle, 340, 220);
      // Live draft: the surface follows the corner while dragging.
      expect(node.style.left).toBe("100px");
      expect(node.style.top).toBe("120px");
      expect(node.style.width).toBe("450px");
      expect(node.style.height).toBe("180px");
      up(handle, 340, 220);
      // Parked pending: the bar now reads Confirm the move.
      expect(confirmBtn(host).getAttribute("title")).toBe("Confirm the move");
      clickEl(confirmBtn(host));
      expect(onMove).toHaveBeenCalledTimes(1);
      const rect = onMove.mock.calls[0]?.[1] as {
        x: number; y: number; width: number; height: number;
      };
      expect(rect.x).toBe(50);
      expect(rect.y).toBe(60);
      expect(rect.width).toBe(225);
      expect(rect.height).toBe(90);
      expect(rect.width / rect.height).toBeCloseTo(2.5, 6);
    } finally {
      cleanup();
    }
  });

  it("nw handle resize anchors on the bottom-right corner", () => {
    const { host, onMove, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      const handle = host.querySelector<HTMLElement>('[data-stamp-resize-handle="nw"]');
      if (handle === null) throw new Error("nw handle not rendered");
      press(handle, 100, 120);
      move(handle, 60, 100); // delta (-40, -20) px = (-20, -10) pt
      up(handle, 60, 100);
      clickEl(confirmBtn(host));
      expect(onMove).toHaveBeenCalledTimes(1);
      const rect = onMove.mock.calls[0]?.[1] as {
        x: number; y: number; width: number; height: number;
      };
      expect(rect).toEqual({ x: 25, y: 50, width: 225, height: 90 });
    } finally {
      cleanup();
    }
  });

  it("a handle press without movement does NOT park a pending resize", () => {
    const { host, onMove, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      const handle = host.querySelector<HTMLElement>('[data-stamp-resize-handle="se"]');
      if (handle === null) throw new Error("se handle not rendered");
      press(handle, 300, 200);
      up(handle, 300, 200);
      // No pending -> Confirm reads "Clear selection" and just
      // deselects; the engine is never touched.
      expect(confirmBtn(host).getAttribute("title")).toBe("Clear selection");
      clickEl(confirmBtn(host));
      expect(onMove).not.toHaveBeenCalled();
      expect(host.querySelector("[data-content-action-bar='stamp']")).toBeNull();
    } finally {
      cleanup();
    }
  });
});