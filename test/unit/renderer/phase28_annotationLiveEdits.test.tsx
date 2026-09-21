// @vitest-environment jsdom
//
// Phase 28 (chunk 1) — annotation interaction: arrow geometry, live
// edits (no Confirm gate) and the action-bar colour box.
//
// Coverage:
//   (a) the arrow's VISIBLE leader line stops at the head's BASE (the
//       midpoint of the two wings), never at the tip; the invisible hit
//       line still spans the whole arrow;
//   (b) a move drag COMMITS on pointerup — no Confirm click — and the
//       engine's rect changes;
//   (c) a colour change right after a move applies live and the moved
//       rect is retained (the move is not reverted or dropped);
//   (d) the action bar shows the COLOUR BOX in place of the Edit text,
//       between Confirm and Delete, and a SINGLE click opens the shared
//       picker;
//   (e) the annotation toolbar's dropdown colour no longer patches a
//       SELECTED annotation (DocumentView's onAnnToolAction);
//   plus Cancel reverts the session's changes (undo).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  AnnotationOverlay,
  ARROW_HEAD_PT,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import { arrowHeadBase } from "../../../src/renderer/annotations/geometry";
import {
  ANNOTATION_COLOR_HEX,
  type Annotation,
  type AnnotationToolState,
  type ArrowAnnotation,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT_ANN: Annotation = {
  id: "rect-1",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const ARROW_ANN: ArrowAnnotation = {
  id: "arrow-1",
  kind: "arrow",
  page: 1,
  color: "green",
  createdAt: "2026-01-01T00:00:00.000Z",
  from: { x: 50, y: 50 },
  to: { x: 200, y: 120 },
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

// The popover portals to document.body; unmount every previous surface
// so a stale open popover can't pollute body-level queries.
const liveRoots: ReturnType<typeof createRoot>[] = [];

interface Harness {
  host: HTMLElement;
  onEditAnnotation: ReturnType<typeof vi.fn>;
  onDeleteAnnotation: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function mountOverlay(args: { annotations: Annotation[] }): Harness {
  while (liveRoots.length > 0) {
    const prev = liveRoots.pop();
    if (prev === undefined) continue;
    act((): void => {
      prev.unmount();
    });
  }
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  liveRoots.push(root);
  const onEditAnnotation = vi.fn();
  const onDeleteAnnotation = vi.fn();
  const onCreate = vi.fn();
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={args.annotations}
        tool={SELECT_TOOL}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={onCreate}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        paletteTheme="light"
        annotationPalette={{ light: [], dark: [] }}
      />,
    );
  });
  return {
    host,
    onEditAnnotation,
    onDeleteAnnotation,
    onCreate,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null) throw new Error("annotation layer not found");
  return layer;
}

function pressSurface(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function moveOnLayer(layer: HTMLElement, x: number, y: number): void {
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function releaseOnLayer(layer: HTMLElement, x: number, y: number): void {
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function clickEl(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function dragSurface(layer: HTMLElement, surface: Element, from: [number, number], to: [number, number]): void {
  pressSurface(surface, from[0], from[1]);
  moveOnLayer(layer, to[0], to[1]);
  releaseOnLayer(layer, to[0], to[1]);
}

describe("Phase 28 (a) — the arrow's leader line ends at the head's BASE", () => {
  it("the visible shaft's x2/y2 is the head-base point, not the tip; the hit line still reaches the tip", () => {
    const { host, cleanup } = mountOverlay({ annotations: [ARROW_ANN] });
    try {
      const svg = host.querySelector("g.ann-arrow[data-annotation-id='arrow-1']");
      expect(svg, "arrow renders").not.toBeNull();
      if (svg === null) return;
      const visual = svg.querySelector<SVGLineElement>("line:not(.ann-arrow-hit)");
      const hit = svg.querySelector<SVGLineElement>(".ann-arrow-hit");
      const base = arrowHeadBase(ARROW_ANN.from, ARROW_ANN.to, ARROW_HEAD_PT);
      expect(visual?.getAttribute("x1")).toBe("50");
      expect(visual?.getAttribute("y1")).toBe("50");
      expect(visual?.getAttribute("x2")).toBe(String(base.x));
      expect(visual?.getAttribute("y2")).toBe(String(base.y));
      // Strictly short of the tip on both axes for this diagonal arrow.
      expect(Number(visual?.getAttribute("x2"))).toBeLessThan(200);
      expect(Number(visual?.getAttribute("y2"))).toBeLessThan(120);
      // The invisible grab line is unchanged: full from -> to length.
      expect(hit?.getAttribute("x2")).toBe("200");
      expect(hit?.getAttribute("y2")).toBe("120");
      // The head polygon still has its apex at the tip.
      const head = svg.querySelector<SVGPolygonElement>("polygon:not(.ann-arrow-head-hit)");
      expect(head?.getAttribute("points")?.startsWith("200,120")).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (b) — a move drag COMMITS on pointerup (no Confirm)", () => {
  it("the engine gets ONE in-place `rect` edit with the moved rect, and no delete + re-create", () => {
    const { host, onEditAnnotation, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      dragSurface(layerOf(host), shape, [120, 120], [160, 140]);
      // Committed at pointerup, with no Confirm click anywhere. Phase 30 —
      // ONE geometry op that keeps the annotation's id (no re-create, so
      // no fresh selection event races a follow-up style click).
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(onEditAnnotation.mock.calls[0]?.[0]).toBe("rect-1");
      expect(onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        rect: { x: 140, y: 120, width: 150, height: 80 },
      });
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      // The selection survives so the bar (and the colour box) stays up.
      expect(host.querySelector("[data-content-action-bar]")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Cancel reverts the committed move (undo): the engine gets the ORIGINAL rect back", () => {
    const { host, onEditAnnotation, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      dragSurface(layerOf(host), shape, [120, 120], [160, 140]);
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      clickEl(host.querySelector("[data-content-action$='-cancel']"));
      // Cancel = one more geometry edit restoring the snapshot's rect.
      expect(onEditAnnotation).toHaveBeenCalledTimes(2);
      expect(onEditAnnotation.mock.calls[1]?.[0]).toBe("rect-1");
      expect(onEditAnnotation.mock.calls[1]?.[1]).toEqual({
        rect: { x: 100, y: 100, width: 150, height: 80 },
      });
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (c) — a colour change right after a move applies live and keeps the move", () => {
  it("picking a colour on the bar patches the annotation and the moved rect is retained", () => {
    const { host, onEditAnnotation, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({
      annotations: [RECT_ANN],
    });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      dragSurface(layerOf(host), shape, [120, 120], [160, 140]);
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        rect: { x: 140, y: 120, width: 150, height: 80 },
      });

      // Open the bar's picker and pick a built-in colour.
      clickEl(host.querySelector("[data-ann-color-box]"));
      const swatch = document.body.querySelector<HTMLElement>(
        ".color-popover [data-palette-built-in='red']",
      );
      expect(swatch, "built-in red swatch in the portaled picker").not.toBeNull();
      if (swatch === null) return;
      clickEl(swatch);

      // The colour patch went out for THIS annotation...
      expect(onEditAnnotation).toHaveBeenCalledTimes(2);
      expect(onEditAnnotation.mock.calls[1]?.[0]).toBe("rect-1");
      expect(onEditAnnotation.mock.calls[1]?.[1]).toEqual({ color: "red" });
      // ...and the move was NOT reverted or dropped: no extra engine
      // ops, the draft still carries the moved rect + the new colour.
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      const moved = host.querySelector<SVGElement>(".ann-shape[data-annotation-id='rect-1']");
      expect(moved?.getAttribute("x")).toBe("140");
      expect(moved?.getAttribute("y")).toBe("120");
      expect(moved?.getAttribute("stroke")).toBe(ANNOTATION_COLOR_HEX.red);
      // The colour box now shows the new colour.
      expect(
        host.querySelector("[data-ann-color-box]")?.getAttribute("data-color-current"),
      ).toBe(ANNOTATION_COLOR_HEX.red);
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (d) — the action bar's colour box replaces the Edit text", () => {
  it("shows the colour box between Confirm and Delete, with no Edit text, and a single click opens the picker", () => {
    const { host, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      clickEl(host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      const bar = host.querySelector<HTMLElement>("[data-content-action-bar='ann-rect']");
      expect(bar, "selection bar appears").not.toBeNull();
      if (bar === null) return;
      // No Edit affordance / text anywhere on the bar.
      expect(host.querySelector("[data-content-action$='-edit']")).toBeNull();
      expect(bar.textContent ?? "").not.toMatch(/Edit/);
      // The colour box is a child of the bar, ordered after Confirm and
      // before Delete.
      const box = bar.querySelector("[data-ann-color-box]");
      expect(box, "colour box present").not.toBeNull();
      if (box === null) return;
      const children = Array.from(bar.children);
      const boxIndex = children.indexOf(box.closest("span") as Element);
      const confirmIndex = children.findIndex((c) => c.matches("[data-content-action$='-confirm']"));
      const deleteIndex = children.findIndex((c) => c.matches("[data-content-action$='-delete']"));
      expect(boxIndex).toBeGreaterThan(confirmIndex);
      expect(boxIndex).toBeLessThan(deleteIndex);
      // It shows the annotation's current colour.
      expect(box.getAttribute("data-color-current")).toBe(ANNOTATION_COLOR_HEX.blue);
      // A SINGLE click expands the shared picker (portaled to body).
      clickEl(box);
      const popover = document.body.querySelector(".color-popover");
      expect(popover, "picker opens on one click").not.toBeNull();
      expect(popover?.querySelector(".color-palette")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Confirm is a plain dismiss: the selection clears and nothing else reaches the engine", async () => {
    const { host, onDeleteAnnotation, onCreate, onEditAnnotation, cleanup } = mountOverlay({
      annotations: [RECT_ANN],
    });
    try {
      clickEl(host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      clickEl(host.querySelector("[data-content-action$='-confirm']"));
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      expect(onEditAnnotation).not.toHaveBeenCalled();
      // The bar exits through AnimatePresence; settle its exit frame.
      await act(async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(host.querySelector("[data-content-action-bar]")).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("Phase 28 (e) — the toolbar dropdown colour is scoped to the armed tool", () => {
  it("DocumentView's onAnnToolAction only dispatches the tool action — no selected-annotation patch", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
      "utf8",
    );
    const start = src.indexOf("const onAnnToolAction = useCallback(");
    expect(start, "onAnnToolAction found in DocumentView").toBeGreaterThan(-1);
    const end = src.indexOf("\n  );", start);
    const body = src.slice(start, end === -1 ? start + 400 : end);
    expect(body).toContain("dispatchAnnTool(a)");
    // The Phase-26 interception is reverted: no set-color branch, no
    // annotation patch, no selected-annotation ref.
    expect(body).not.toContain("set-color");
    expect(body).not.toContain("onEditAnnotation");
    expect(body).not.toContain("selectedAnnotationRef");
    // And the toolbar no longer receives the selected annotation's
    // colour as its own (the action bar owns that colour).
    expect(src).not.toContain("selectedColor={selectedAnnotation");
  });
});
