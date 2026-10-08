// @vitest-environment jsdom
//
// Phase 117 — context anchoring: obstacle-aware placement, the too-small /
// occluded fallback, and pointer-capture-loss robustness for the shared
// selection surfaces.
//
//   (a) `placeControlNearAnchor` never returns a box that intersects a
//       chrome obstacle, and `contextControlFits` is false when every
//       placement overlaps;
//   (b) a too-small anchor renders NO floating action bar / comment box
//       (the selected object's properties stay reachable in the Inspector);
//   (c) a lost pointer capture (`pointercancel`) or Escape during an
//       annotation drag ends it and commits NOTHING;
//   (d) selecting an object emits no engine operation (no dirty state).
//
// Setup mirrors the sibling renderer specs (react-dom/client + `act`; the
// repo ships no @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AnnotationOverlay,
  type AnnotationOverlayProps,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import { selectionActionBarBox } from "../../../src/renderer/annotations/AnnotationCommentBox";
import {
  contextControlFits,
  placeControlNearAnchor,
  type ControlAnchorBox,
} from "../../../src/renderer/components/controlPlacement";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

const PAGE_W = 612;
const PAGE_H = 792;
const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };
const ACTION_SIZE = { width: 240, height: 32 };
const PAGE_VIEWPORT = { width: PAGE_W, height: PAGE_H };
const ANCHOR: ControlAnchorBox = { left: 100, top: 300, bottom: 340, right: 250 };

interface CssBoxOut {
  left: number;
  top: number;
  width: number;
  height: number;
}

function intersects(box: CssBoxOut, obstacle: ControlAnchorBox): boolean {
  const right = obstacle.right ?? obstacle.left;
  return (
    box.left < right &&
    box.left + box.width > obstacle.left &&
    box.top < obstacle.bottom &&
    box.top + box.height > obstacle.top
  );
}

function rectAnn(rect = { x: 100, y: 100, width: 150, height: 80 }): Annotation {
  return {
    id: "rect-1",
    kind: "rect",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect,
  };
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
  });
}

interface MountedOverlay {
  host: HTMLElement;
  cleanup: () => void;
}

function mountOverlay(
  annotations: Annotation[],
  extra: Partial<AnnotationOverlayProps> = {},
): MountedOverlay {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "900px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 900, width: 800, height: 900,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const props: AnnotationOverlayProps = {
    page: 1,
    widthPt: PAGE_W,
    heightPt: PAGE_H,
    cssScale: 1,
    annotations,
    tool: SELECT_TOOL,
    flashId: null,
    getTextItems: (): never[] => [],
    onCreate: (): void => undefined,
    onAddComment: (): void => undefined,
    onDeleteAnnotation: (): void => undefined,
    onTextFocusRequest: (): void => undefined,
    onDisarmTool: (): void => undefined,
    onFinishedOneShot: (): void => undefined,
    ...extra,
  };
  act((): void => {
    root.render(<AnnotationOverlay {...props} />);
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function click(el: Element | null): void {
  if (el === null) throw new Error("expected a clickable element");
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 117 — obstacle-aware context placement", () => {
  it("flips to the clear side when the preferred side covers an obstacle", () => {
    const belowObstacle: ControlAnchorBox = { left: 100, top: 344, bottom: 376, right: 340 };
    const placed = placeControlNearAnchor({
      anchor: ANCHOR,
      size: ACTION_SIZE,
      viewport: PAGE_VIEWPORT,
      obstacles: [belowObstacle],
    });
    expect(
      intersects({ left: placed.left, top: placed.top, ...ACTION_SIZE }, belowObstacle),
      "placement must not intersect the obstacle",
    ).toBe(false);
    expect(placed.top, "flipped above the anchor").toBeLessThan(ANCHOR.top);
  });

  it("keeps the historic result when there are no obstacles", () => {
    const placed = placeControlNearAnchor({ anchor: ANCHOR, size: ACTION_SIZE, viewport: PAGE_VIEWPORT });
    expect(placed.top).toBe(ANCHOR.bottom + 4);
    expect(placed.left).toBe(ANCHOR.left);
  });

  it("still clamps into the viewport when every side overlaps", () => {
    const cover: ControlAnchorBox = { left: 0, top: 0, bottom: PAGE_H, right: PAGE_W };
    const placed = placeControlNearAnchor({
      anchor: ANCHOR,
      size: ACTION_SIZE,
      viewport: PAGE_VIEWPORT,
      obstacles: [cover],
    });
    expect(placed.top).toBeGreaterThanOrEqual(4);
    expect(placed.top + ACTION_SIZE.height).toBeLessThanOrEqual(PAGE_H - 4 + 0.001);
    expect(placed.left + ACTION_SIZE.width).toBeLessThanOrEqual(PAGE_W - 4 + 0.001);
  });

  it("contextControlFits is false only when no side fits clear (or the anchor is tiny)", () => {
    const belowObstacle: ControlAnchorBox = { left: 100, top: 344, bottom: 376, right: 340 };
    const cover: ControlAnchorBox = { left: 0, top: 0, bottom: PAGE_H, right: PAGE_W };
    expect(contextControlFits(ANCHOR, ACTION_SIZE, PAGE_VIEWPORT, [])).toBe(true);
    expect(contextControlFits(ANCHOR, ACTION_SIZE, PAGE_VIEWPORT, [belowObstacle])).toBe(true);
    expect(contextControlFits(ANCHOR, ACTION_SIZE, PAGE_VIEWPORT, [cover])).toBe(false);
    const tiny: ControlAnchorBox = { left: 100, top: 100, bottom: 102, right: 102 };
    expect(contextControlFits(tiny, ACTION_SIZE, PAGE_VIEWPORT, [])).toBe(false);
  });

  it("selectionActionBarBox clears the obstacle in page-view coordinates", () => {
    const bounds = { x: 100, y: 300, width: 150, height: 40 };
    const obstacle: ControlAnchorBox = { left: 100, top: 344, bottom: 376, right: 340 };
    const bar = selectionActionBarBox(bounds, 1, PAGE_W, PAGE_H, [obstacle]);
    expect(intersects(bar, obstacle)).toBe(false);
  });
});

describe("Phase 117 — too-small / occluded anchor fallback", () => {
  it("renders no floating action bar or comment box for a too-small anchor", () => {
    const tiny = rectAnn({ x: 100, y: 100, width: 2, height: 2 });
    const h = mountOverlay([tiny], { onAddComment: (): void => undefined });
    try {
      click(h.host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      // The selection still exists (shared chrome), but no floating bar.
      expect(h.host.querySelector("[data-selection-boundary]")).not.toBeNull();
      expect(h.host.querySelector("[data-content-action-bar]")).toBeNull();
      expect(h.host.querySelector("[data-ann-comment-box]")).toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("renders the action bar for a normal-sized anchor", () => {
    const h = mountOverlay([rectAnn()]);
    try {
      click(h.host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      expect(h.host.querySelector("[data-content-action-bar]")).not.toBeNull();
    } finally {
      h.cleanup();
    }
  });
});

describe("Phase 117 — pointer-capture loss and Escape cancel a drag", () => {
  function dragShape(
    host: HTMLElement,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): Element {
    const shape = host.querySelector(".ann-shape[data-annotation-id='rect-1']");
    if (shape === null) throw new Error("expected the committed rect surface");
    act((): void => {
      shape.dispatchEvent(pointerEvent("pointerdown", fromX, fromY));
    });
    act((): void => {
      shape.dispatchEvent(pointerEvent("pointermove", toX, toY));
    });
    return shape;
  }

  it("pointercancel ends the drag and commits nothing", () => {
    const onEditAnnotation = vi.fn();
    const h = mountOverlay([rectAnn()], { onEditAnnotation });
    try {
      const shape = dragShape(h.host, 120, 120, 260, 300);
      act((): void => {
        window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
      });
      act((): void => {
        shape.dispatchEvent(pointerEvent("pointerup", 260, 300));
      });
      expect(onEditAnnotation, "a cancelled drag never commits").not.toHaveBeenCalled();
      expect(h.host.querySelector("[data-content-action-bar]"), "selection survives").not.toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("Escape during a drag cancels it and commits nothing", () => {
    const onEditAnnotation = vi.fn();
    const h = mountOverlay([rectAnn()], { onEditAnnotation });
    try {
      const shape = dragShape(h.host, 120, 120, 260, 300);
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      act((): void => {
        shape.dispatchEvent(pointerEvent("pointerup", 260, 300));
      });
      expect(onEditAnnotation, "Escape cancels without committing").not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});

describe("Phase 117 — selection is not a document change", () => {
  it("selecting an object emits no engine operation", () => {
    const onEditAnnotation = vi.fn();
    const onCreate = vi.fn();
    const onDeleteAnnotation = vi.fn();
    const h = mountOverlay([rectAnn()], { onEditAnnotation, onCreate, onDeleteAnnotation });
    try {
      click(h.host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      expect(h.host.querySelector("[data-content-action-bar]"), "selection happened").not.toBeNull();
      expect(onEditAnnotation, "selection is not an edit").not.toHaveBeenCalled();
      expect(onCreate, "selection is not a create").not.toHaveBeenCalled();
      expect(onDeleteAnnotation, "selection is not a delete").not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});
