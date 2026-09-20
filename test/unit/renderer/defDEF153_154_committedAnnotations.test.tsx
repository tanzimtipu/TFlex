// @vitest-environment jsdom
//
// DEF-153 / DEF-154 — the unified Acrobat-style interaction model for
// COMMITTED ANNOTATIONS (shapes / ink / arrow / textbox / callout /
// note): hover shows the palm/grab cursor; single click SELECTS and
// makes the content MOVABLE (Confirm/Edit/Delete bar + resize
// handles); double click opens the full edit toolbox; while selected
// a "Double click to edit" hint shows; moved content persists through
// the bar's Confirm (delete + re-create with the same id — the shared
// contract has no annotation move op).
//
// Coverage (behavior):
//   1. Committed shapes render with the grab-cursor surface class and
//      are pointer-interactive.
//   2. Single click on a shape selects it: action bar (Confirm / Edit
//      / Delete) + corner handles + the move hint appear; no editor
//      opens.
//   3. Dragging the shape parks a PENDING move (no engine call), and
//      the bar's Confirm commits it: onDeleteAnnotation(oldId) +
//      onCreate(movedAnnotation with the same id / shifted rect).
//   4. The bar's Delete removes the annotation; its Edit opens the
//      color toolbox for shapes; the buttons stay clickable (a press
//      on the bar never starts a page drag, the click completes).
//   5. Double click on a committed textbox opens its text edit
//      toolbox; Confirm routes a text patch through onEditAnnotation.
//   6. The note icon follows the SAME model as every other kind now
//      (Bug 3): single click SELECTS it (bar + handles), double click
//      opens its editor; dragging the icon moves the note and the
//      bar's Confirm commits delete + re-create.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
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

const TEXTBOX_ANN: Annotation = {
  id: "tbx-1",
  kind: "textbox",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 200, y: 200, width: 160, height: 60 },
  text: "SOME BOX TEXT",
};

const NOTE_ANN: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 60, y: 300 },
  text: "note text",
};

const ARROW_ANN: Annotation = {
  id: "arrow-1",
  kind: "arrow",
  page: 1,
  color: "green",
  createdAt: "2026-01-01T00:00:00.000Z",
  from: { x: 50, y: 50 },
  to: { x: 200, y: 120 },
};

const INK_ANN: Annotation = {
  id: "ink-1",
  kind: "ink",
  page: 1,
  color: "red",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    { x: 10, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 15 },
  ],
  width: 3,
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function mountOverlay(args: {
  annotations?: Annotation[];
  onEditAnnotation?: (id: string, patch: { text?: string; color?: string }) => void;
  onDeleteAnnotation?: (id: string) => void;
  onCreate?: (a: Annotation) => void;
  tool?: AnnotationToolState;
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
  // jsdom has no pointer capture; stub it like the other overlay tests.
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  const onEditAnnotation = vi.fn(args.onEditAnnotation ?? ((): void => undefined));
  const onDeleteAnnotation = vi.fn(args.onDeleteAnnotation ?? ((): void => undefined));
  const onCreate = vi.fn(args.onCreate ?? ((): void => undefined));
  const tool: AnnotationToolState = args.tool ?? SELECT_TOOL;
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={args.annotations ?? []}
        tool={tool}
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

function doubleClickEl(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

function dragSurface(layer: HTMLElement, surface: Element, from: [number, number], to: [number, number]): void {
  pressSurface(surface, from[0], from[1]);
  moveOnLayer(layer, to[0], to[1]);
  releaseOnLayer(layer, to[0], to[1]);
}

function barConfirm(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>("[data-content-action$='-confirm']");
  if (btn === null) throw new Error("Confirm button not found");
  return btn;
}

describe("DEF-153/154 — committed annotation selection model (rect)", () => {
  it("hover-grab surface class + single click SELECTS: bar (Confirm/Delete), corner handles appear; no editor opens", () => {
    const { host, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      expect(shape, "committed shape renders").not.toBeNull();
      if (shape === null) return;
      // DEF-154 — committed shapes are page-interactive: the surface
      // carries the grab-cursor class (the CSS rule owns the cursor).
      expect(shape.classList.contains("ann-content")).toBe(true);
      clickEl(shape);
      expect(host.querySelector("[data-content-action-bar]"), "bar appears").not.toBeNull();
      expect(host.querySelector("[data-content-action$='-confirm']"), "Confirm on the bar").not.toBeNull();
      expect(host.querySelector("[data-annotation-resize-handle]"), "corner handles appear").not.toBeNull();
      // Phase 26 — no Edit button (the panel Text field / the annotation
      // toolbar own editing) and no cursor hint.
      expect(host.querySelector("[data-content-action$='-edit']")).toBeNull();
      expect(host.querySelector("[data-move-hint]")).toBeNull();
      // Single click must NOT open any editor toolbox.
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(host.querySelector("[data-annotation-color-editor]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("dragging the shape parks a PENDING move (no engine call); the bar's Confirm commits delete + re-create with the shifted rect", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      const layer = layerOf(host);
      if (shape === null) throw new Error("shape not found");
      dragSurface(layer, shape, [120, 120], [160, 140]);
      // DEF-154 — nothing reached the engine at pointerup.
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      // The white eraser-equivalent is the local draft: the shape's
      // rendered rect now sits at the MOVED position (visual), and
      // the bar is up (movable).
      const moved = host.querySelector<HTMLElement>(".ann-shape[data-annotation-id='rect-1']");
      expect(moved?.getAttribute("x")).toBe("140");
      expect(moved?.getAttribute("y")).toBe("120");
      clickEl(barConfirm(host));
      // Confirm = delete the ORIGINAL + re-create with the same id at
      // the moved rect (the contract's only annotation-move path).
      expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
      expect(onDeleteAnnotation.mock.calls[0]?.[0]).toBe("rect-1");
      expect(onCreate).toHaveBeenCalledTimes(1);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(created.id).toBe("rect-1");
      expect((created as { rect: { x: number; y: number; width: number; height: number } }).rect).toEqual({ x: 140, y: 120, width: 150, height: 80 });
    } finally {
      cleanup();
    }
  });

  it("the bar's Delete removes the annotation without a create; the bar is safely clickable (no swallow)", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      clickEl(shape);
      const del = host.querySelector<HTMLButtonElement>("[data-content-action$='-delete']");
      expect(del).not.toBeNull();
      if (del === null) return;
      // Real press chain: the BAR's pointerdown stopPropagation must
      // keep the click flowing (AGENTS.md cross-bubbling guard).
      act((): void => {
        del.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 110, clientY: 190, pointerId: 1 }));
      });
      clickEl(del);
      expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
      expect(onDeleteAnnotation.mock.calls[0]?.[0]).toBe("rect-1");
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("Phase 26 — a shape has no in-canvas colour palette: no Edit button, and double-clicking the shape opens nothing", () => {
    const { host, onEditAnnotation, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      if (shape === null) throw new Error("shape not found");
      clickEl(shape);
      // No Edit affordance on the selection bar any more.
      expect(host.querySelector("[data-content-action$='-edit']")).toBeNull();
      // Double-click opens nothing at all (no colour editor, no editor).
      doubleClickEl(shape, 120, 120);
      expect(host.querySelector("[data-annotation-color-editor]")).toBeNull();
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(host.querySelector("[data-ann-color-edit]")).toBeNull();
      // The selection survives the double-click (it is just a click).
      expect(host.querySelector("[data-content-action-bar]")).not.toBeNull();
      expect(onEditAnnotation).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("a click on an empty page spot deselects / reverts a pending move", async () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [RECT_ANN] });
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      const layer = layerOf(host);
      if (shape === null) throw new Error("shape not found");
      dragSurface(layer, shape, [120, 120], [160, 140]);
      expect(host.querySelector("[data-content-action-bar]")).not.toBeNull();
      // Press the LAYER background (not a surface) in select mode:
      // reverts the pending move and clears the selection.
      pressSurface(layer, 20, 500);
      // Phase C — the selection bar exits through AnimatePresence;
      // settle its exit frame before asserting no stale DOM.
      await act(async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(host.querySelector("[data-content-action-bar]"), "selection cleared").toBeNull();
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      // The shape returned to its ENGINE rect (the draft cleared).
      const back = host.querySelector<HTMLElement>(".ann-shape[data-annotation-id='rect-1']");
      expect(back?.getAttribute("x")).toBe("100");
      expect(back?.getAttribute("y")).toBe("100");
    } finally {
      cleanup();
    }
  });
});

describe("DEF-154 — arrow + ink get the full selection model AND resize handles", () => {
  it("committed arrow renders its invisible shaft + head hit targets and round-trips the pointer model: single click selects -> 4 corner handles + bar appear", () => {
    const { host, cleanup } = mountOverlay({ annotations: [ARROW_ANN] });
    try {
      const arrow = host.querySelector<Element>("g.ann-arrow[data-annotation-id='arrow-1']");
      expect(arrow, "arrow renders").not.toBeNull();
      if (arrow === null) return;
      // DEF-154 — the arrow ships a wide transparent shaft hit line
      // AND a transparent head hit triangle (the visual line and head
      // stay pointer-transparent).
      expect(arrow.querySelector(".ann-arrow-hit")).not.toBeNull();
      expect(arrow.querySelector(".ann-arrow-head-hit")).not.toBeNull();
      // Single click -> selected + movable: bar + 4 corner handles.
      clickEl(arrow);
      expect(host.querySelector("[data-content-action-bar]"), "bar appears").not.toBeNull();
      const handles = host.querySelectorAll("[data-annotation-resize-handle]");
      expect(handles.length, "arrow gets 4 resize handles (DEF-154)").toBe(4);
      // The handles live INSIDE the positioned selection frame (the
      // -5px corner offsets are relative to the frame, so they land
      // on the shape's corners — not the page's).
      const frame = host.querySelector("[data-content-selection-frame]");
      expect(frame, "selection frame wraps ring + handles").not.toBeNull();
      for (const h of handles) {
        expect(frame?.contains(h), "handle is a child of the frame").toBe(true);
      }
      // Single click must NOT open a toolbox.
      expect(host.querySelector("[data-annotation-color-editor]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("dragging the arrow's SE corner handle scales both endpoints into the new bounds (a resize scales the geometry, DEF-154)", () => {
    const { host, cleanup } = mountOverlay({ annotations: [ARROW_ANN] });
    try {
      const arrow = host.querySelector<Element>("g.ann-arrow[data-annotation-id='arrow-1']");
      const layer = layerOf(host);
      if (arrow === null) throw new Error("arrow not found");
      clickEl(arrow);
      const se = host.querySelector<HTMLDivElement>("[data-annotation-resize-handle='se']");
      expect(se, "SE handle").not.toBeNull();
      if (se === null) return;
      // Arrow bounds {50,50,150,70} -> SE corner (200,120). Press the
      // handle there and drag +150/+70: resizeImageRect anchors the
      // top-left and grows the rect to {50,50,300,140} (2x on both
      // axes), and the arrow endpoints scale into the new bounds
      // (to -> 350,190).
      act((): void => {
        se.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 120, pointerId: 3 }));
      });
      moveOnLayer(layer, 350, 190);
      const visual = host.querySelector<SVGLineElement>(
        "g.ann-arrow[data-annotation-id='arrow-1'] line:not(.ann-arrow-hit)",
      );
      expect(visual?.getAttribute("x2")).toBe("350");
      expect(visual?.getAttribute("y2")).toBe("190");
      // The drag is renderer-local: no engine call at pointerup.
      releaseOnLayer(layer, 350, 190);
      expect(host.querySelector("[data-content-action-bar]"), "pending move keeps the bar").not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("single click on ink selects it and a handle drag scales every point (DEF-154)", () => {
    const { host, cleanup } = mountOverlay({ annotations: [INK_ANN] });
    try {
      const ink = host.querySelector<Element>("g.ann-ink[data-annotation-id='ink-1']");
      const layer = layerOf(host);
      if (ink === null) throw new Error("ink not found");
      clickEl(ink);
      const handles = host.querySelectorAll("[data-annotation-resize-handle]");
      expect(handles.length, "ink gets 4 resize handles (DEF-154)").toBe(4);
      const se = host.querySelector<HTMLDivElement>("[data-annotation-resize-handle='se']");
      if (se === null) return;
      // Ink bounds {8.5,8.5,23,13} (padded by stroke width) -> SE corner
      // (31.5,21.5). Press the handle there and drag +23/+13: the
      // bounds DOUBLE, so point (10,10) maps to (11.5,11.5) — the hit
      // path re-renders at the scaled position.
      act((): void => {
        se.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 31.5, clientY: 21.5, pointerId: 4 }));
      });
      moveOnLayer(layer, 54.5, 34.5);
      const hitPath = host.querySelector<SVGPathElement>(
        "g.ann-ink[data-annotation-id='ink-1'] .ann-ink-hit",
      );
      expect(hitPath?.getAttribute("d"), "scaled ink hit path").toMatch(/^M 11\.5 11\.5/);
      releaseOnLayer(layer, 31.5, 21.5);
    } finally {
      cleanup();
    }
  });
});

describe("DEF-153/154 + Phase 26 — committed textbox: select/move, no in-canvas editor", () => {
  it("double-clicking a committed textbox opens NO editor and does not patch anything", () => {
    const { host, onEditAnnotation, cleanup } = mountOverlay({ annotations: [TEXTBOX_ANN] });
    try {
      const tbx = host.querySelector<Element>(".ann-textbox[data-annotation-id='tbx-1']");
      if (tbx === null) throw new Error("textbox not found");
      doubleClickEl(tbx, 250, 220);
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(host.querySelector("[data-annotation-editor-wrap]")).toBeNull();
      expect(host.querySelector("textarea")).toBeNull();
      expect(onEditAnnotation).not.toHaveBeenCalled();
      // A double-click is inert (no editor, no colour palette, no patch).
      expect(host.querySelector("[data-annotation-color-editor]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("dragging the textbox parks a pending move committed by the bar Confirm", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [TEXTBOX_ANN] });
    try {
      const tbx = host.querySelector<Element>(".ann-textbox[data-annotation-id='tbx-1']");
      const layer = layerOf(host);
      if (tbx === null) throw new Error("textbox not found");
      dragSurface(layer, tbx, [220, 220], [260, 240]);
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      clickEl(barConfirm(host));
      expect(onDeleteAnnotation).toHaveBeenCalledWith("tbx-1");
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(created.id).toBe("tbx-1");
      // Moved by the pointer delta (+40,+20) from the engine rect.
      expect((created as { rect: { x: number; y: number; width: number; height: number } }).rect).toEqual({ x: 240, y: 220, width: 160, height: 60 });
    } finally {
      cleanup();
    }
  });
});

describe("DEF-153/154 / Bug 3 — committed note shares the unified selection model", () => {
  it("single click SELECTS the note (bar + handles, NO editor); double click also opens NOTHING", () => {
    const { host, cleanup } = mountOverlay({ annotations: [NOTE_ANN] });
    try {
      const icon = host.querySelector<Element>("[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      pressSurface(icon, 65, 305);
      clickEl(icon);
      // Bug 3 — single click must not enter an edit toolbox.
      expect(host.querySelectorAll("[data-annotation-editor]").length).toBe(0);
      // It selects instead: the Confirm / Delete bar renders.
      expect(
        host.querySelector("[data-content-action-bar='ann-note']"),
        "note shows the action bar on single click",
      ).not.toBeNull();
      // Phase 26 — the double-click is just another click: still no editor.
      doubleClickEl(icon, 65, 305);
      expect(host.querySelectorAll("[data-annotation-editor]").length).toBe(0);
      expect(host.querySelector("[data-annotation-editor-wrap]")).toBeNull();
      expect(host.querySelector("[data-content-action-bar='ann-note']")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("dragging the note icon parks a pending move; the bar Confirm commits delete + re-create with the moved anchor", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({ annotations: [NOTE_ANN] });
    try {
      const icon = host.querySelector<Element>("[data-annotation-id='note-1']");
      const layer = layerOf(host);
      if (icon === null) throw new Error("note icon not found");
      dragSurface(layer, icon, [65, 305], [95, 335]);
      expect(host.querySelector("[data-content-action-bar]"), "note shows the action bar after a move").not.toBeNull();
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      clickEl(barConfirm(host));
      expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
      expect(onDeleteAnnotation.mock.calls[0]?.[0]).toBe("note-1");
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(created.id).toBe("note-1");
      expect(created.kind).toBe("note");
      expect((created as { at: { x: number; y: number } }).at).toEqual({ x: 90, y: 330 });
    } finally {
      cleanup();
    }
  });
});