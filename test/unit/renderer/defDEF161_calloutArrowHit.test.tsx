// @vitest-environment jsdom
//
// DEF-161 — the callout's box and arrow are movable INDEPENDENTLY:
//
//   1. The arrow gets the same fat invisible hit surfaces as the
//      standalone arrow (DEF-154): a 10pt transparent shaft line
//      (`.ann-callout-arrow-hit`, pointer-events: stroke) + a wide
//      transparent head polygon (`.ann-callout-arrow-head-hit`,
//      pointer-events: all) inside the callout's arrow SVG.
//   2. Pressing the arrow drags ONLY the anchor (`at`); the box rect
//      never leaves the engine's position. Confirm commits
//      delete + re-create with the moved `at`.
//   3. Pressing the BOX moves ONLY the box rect; the arrow anchor
//      stays fixed (so the annotation keeps pointing at its subject).
//   4. Single click on the arrow selects (bar + handles appear), no
//      toolbox opens; double click opens the text toolbox.
//   5. FEATURE — the committed textbox / callout edit toolbox now
//      carries the shape color editor's swatch row + hex input; swatch
//      picks are committed together with text by the toolbox Confirm.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CALLOUT_ANN: Annotation = {
  id: "callout-1",
  kind: "callout",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  // Anchor above-left of the box; the leader entry is the box's
  // top-left corner (100,100) — see calloutEntryPoint.
  rect: { x: 100, y: 100, width: 120, height: 36 },
  at: { x: 50, y: 60 },
  text: "CALL NOTE",
};


const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function mountOverlay(args: {
  annotations?: Annotation[];
  onEditAnnotation?: (id: string, patch: { text?: string; color?: string }) => void;
  onDeleteAnnotation?: (id: string) => void;
  onCreate?: (a: Annotation) => void;
}): {
  host: HTMLElement;
  onEditAnnotation: ReturnType<typeof vi.fn>;
  onDeleteAnnotation: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
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
  const onEditAnnotation = vi.fn(args.onEditAnnotation ?? ((): void => undefined));
  const onDeleteAnnotation = vi.fn(args.onDeleteAnnotation ?? ((): void => undefined));
  const onCreate = vi.fn(args.onCreate ?? ((): void => undefined));
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={args.annotations ?? []}
        tool={SELECT_TOOL}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={onCreate}
        onFinishedOneShot={undefined}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
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

function arrowSvg(host: HTMLElement): SVGSVGElement {
  const svg = host.querySelector<SVGSVGElement>(".ann-callout-arrow");
  if (svg === null) throw new Error("callout arrow svg not found");
  return svg;
}

function boxDiv(host: HTMLElement): HTMLElement {
  const div = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
  if (div === null) throw new Error("callout box div not found");
  return div;
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

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}


function dragSurface(layer: HTMLElement, surface: Element, from: [number, number], to: [number, number]): void {
  pressSurface(surface, from[0], from[1]);
  moveOnLayer(layer, to[0], to[1]);
  releaseOnLayer(layer, to[0], to[1]);
}

/** The Confirm button INSIDE a committed textbox / callout edit
 *  toolbox (data-annotation-action, not the selection bar's
 *  data-content-action). */

describe("DEF-161 — callout arrow gets its own hit surface + anchor-only drag", () => {
  it("renders the transparent shaft line + head polygon hit targets inside the callout arrow svg", () => {
    const { host, cleanup } = mountOverlay({ annotations: [CALLOUT_ANN] });
    try {
      const svg = arrowSvg(host);
      const shaft = svg.querySelector(".ann-callout-arrow-hit");
      const head = svg.querySelector(".ann-callout-arrow-head-hit");
      expect(shaft, "transparent shaft hit line exists").not.toBeNull();
      expect(head, "transparent head hit polygon exists").not.toBeNull();
      // The shaft spans the leader line (box entry -> anchor); at
      // cssScale 1 the CSS coords equal the page points.
      expect(shaft?.getAttribute("x1")).toBe("100");
      expect(shaft?.getAttribute("y1")).toBe("100");
      expect(shaft?.getAttribute("x2")).toBe("50");
      expect(shaft?.getAttribute("y2")).toBe("60");
      // The visual line stays pointer-transparent (no surface class).
      const visual = svg.querySelectorAll("line:not(.ann-callout-arrow-hit)");
      expect(visual.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("Phase 28 — dragging the ARROW commits the anchor move on pointerup (no Confirm), box rect untouched", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [CALLOUT_ANN] });
    try {
      const layer = layerOf(host);
      const shaft = arrowSvg(host).querySelector(".ann-callout-arrow-hit");
      if (shaft === null) throw new Error("shaft hit not found");
      // Press mid-shaft (75,80), drag +20/+20 to (95,100).
      dragSurface(layer, shaft, [75, 80], [95, 100]);
      expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
      expect(onDeleteAnnotation.mock.calls[0]?.[0]).toBe("callout-1");
      expect(onCreate).toHaveBeenCalledTimes(1);
      // The arrow re-aims live: the draft moves `at` to (70,80) while
      // the box rect stays put.
      const shaftAfter = arrowSvg(host).querySelector(".ann-callout-arrow-hit");
      expect(shaftAfter?.getAttribute("x2")).toBe("70");
      expect(shaftAfter?.getAttribute("y2")).toBe("80");
      expect(boxDiv(host).style.left).toBe("100px");
      expect(boxDiv(host).style.top).toBe("100px");
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(created.id).toBe("callout-1");
      expect(created.kind).toBe("callout");
      const c = created as { rect: { x: number; y: number; width: number; height: number }; at: { x: number; y: number } };
      expect(c.at).toEqual({ x: 70, y: 80 });
      expect(c.rect).toEqual({ x: 100, y: 100, width: 120, height: 36 });
    } finally {
      cleanup();
    }
  });

  it("dragging the BOX moves ONLY the rect — the arrow anchor stays fixed (independent move)", () => {
    const { host, onCreate, cleanup } = mountOverlay({ annotations: [CALLOUT_ANN] });
    try {
      const layer = layerOf(host);
      dragSurface(layer, boxDiv(host), [120, 120], [150, 140]);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      const c = created as { rect: { x: number; y: number; width: number; height: number }; at: { x: number; y: number } };
      // Delta (30,20) applied to the rect only.
      expect(c.rect).toEqual({ x: 130, y: 120, width: 120, height: 36 });
      expect(c.at).toEqual({ x: 50, y: 60 });
    } finally {
      cleanup();
    }
  });

  it("single click on the arrow SELECTS (bar + handles); no toolbox opens", () => {
    const { host, cleanup } = mountOverlay({ annotations: [CALLOUT_ANN] });
    try {
      const shaft = arrowSvg(host).querySelector(".ann-callout-arrow-hit");
      if (shaft === null) throw new Error("shaft hit not found");
      pressSurface(shaft, 75, 80);
      releaseOnLayer(layerOf(host), 75, 80);
      clickEl(shaft);
      expect(host.querySelector("[data-content-action-bar]"), "bar appears").not.toBeNull();
      expect(host.querySelector("[data-annotation-resize-handle]"), "resize handles appear").not.toBeNull();
      expect(host.querySelector("[data-annotation-color-editor]")).toBeNull();
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
    } finally {
      cleanup();
    }
  });


  it("a press on the arrow never starts a page create-drag (the interactivity bail-out covers the hit classes)", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      annotations: [CALLOUT_ANN],
      onCreate: (): void => undefined,
    });
    try {
      const layer = layerOf(host);
      const shaft = arrowSvg(host).querySelector(".ann-callout-arrow-hit");
      if (shaft === null) throw new Error("shaft hit not found");
      // Arrow press + release with no movement: no create op, the
      // follow-up click is what selects.
      pressSurface(shaft, 75, 80);
      releaseOnLayer(layer, 75, 80);
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

