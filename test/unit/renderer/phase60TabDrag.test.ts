// @vitest-environment jsdom
// Phase 60 — live tab drag (direct manipulation).
//
// Mirrors phase58TabReorder.test.ts: jsdom has no layout, so `.tab-list` and
// every `[data-tab-id]` rect are stubbed to a 100px row. The REAL pointer
// handlers in AppHeader are driven, and the assertions cover the new
// behaviour the static `.tab-drop-marker` could not express:
//   - the dragged tab follows the pointer (live transform / offset state);
//   - the other tabs reflow to open a gap at the computed insertion slot,
//     and the reflow changes when the pointer crosses a midpoint;
//   - the commit contract is unchanged (onMoveTab / onDetachTab / no-op).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";

const TAB_DEFS = [
  { id: "a", title: "a.pdf", modified: false },
  { id: "b", title: "b.pdf", modified: false },
  { id: "c", title: "c.pdf", modified: false },
];

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

function stripRect(bottom: number, width: number): DOMRect {
  return {
    left: 0,
    right: width,
    width,
    top: 0,
    bottom,
    height: bottom,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

function pointerEventXY(type: string, clientX: number, clientY: number, pointerId = 1): Event {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  return e;
}

function pointerEvent(type: string, clientX: number, pointerId = 1): Event {
  return pointerEventXY(type, clientX, 0, pointerId);
}

interface HeaderRender {
  root: HTMLElement;
  onActivate: ReturnType<typeof vi.fn>;
  onMoveTab: ReturnType<typeof vi.fn>;
  onDetachTab: ReturnType<typeof vi.fn>;
}

function renderHeader(opts: {
  activeId?: string;
  tabs?: typeof TAB_DEFS;
  detach?: boolean;
  stripBottom?: number;
} = {}): HeaderRender {
  const activeId = opts.activeId ?? "a";
  const tabs = opts.tabs ?? TAB_DEFS;
  const onActivate = vi.fn();
  const onMoveTab = vi.fn();
  const onDetachTab = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(DocumentRail, {
        activeId,
        tabs,
        onActivate,
        onClose: (): void => undefined,
        onNewEmptyTab: (): void => undefined,
        onMoveTab,
        ...(opts.detach === true ? { onDetachTab } : {}),
      }),
    );
  });
  const width = tabs.length * 100;
  const list = container.querySelector<HTMLElement>(".tab-list");
  if (list !== null) list.getBoundingClientRect = (): DOMRect => stripRect(opts.stripBottom ?? 0, width);
  tabs.forEach((tab, i) => {
    const el = container.querySelector<HTMLElement>(`[data-tab-id='${tab.id}']`);
    if (el !== null) el.getBoundingClientRect = (): DOMRect => rect(i * 100, 100);
  });
  return { root: container, onActivate, onMoveTab, onDetachTab };
}

function tab(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-tab-id='${id}']`);
  if (el === null) throw new Error(`missing tab ${id}`);
  return el;
}

function armDrag(el: HTMLElement, clientX: number): void {
  act((): void => {
    el.dispatchEvent(pointerEvent("pointerdown", clientX));
  });
}

function moveTo(clientX: number, clientY = 0): void {
  act((): void => {
    window.dispatchEvent(pointerEventXY("pointermove", clientX, clientY));
  });
}

function releaseAt(clientX: number, clientY = 0): void {
  act((): void => {
    window.dispatchEvent(pointerEventXY("pointerup", clientX, clientY));
  });
}

describe("phase60TabDrag — the dragged tab follows the pointer", () => {
  it("enters the live-drag state and its box translates by the pointer delta", () => {
    const { root } = renderHeader();
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120, 0);
    // The drag is live on the dragged tab itself, and the offset mirrors the
    // pointer travel (220 -> 120 = -100), not a static boundary line.
    expect(c.getAttribute("data-tab-dragging")).toBe("true");
    expect(c.getAttribute("data-tab-drag-x")).toBe("-100");
    expect(c.getAttribute("data-tab-drag-y")).toBe("0");
    expect(c.style.transform).toBe("translate3d(-100px, 0px, 0)");
    // The old static marker is gone from the render.
    expect(root.querySelector(".tab-drop-marker")).toBeNull();
  });

  it("updates the offset continuously as the pointer moves", () => {
    const { root } = renderHeader();
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(200, 0);
    expect(c.getAttribute("data-tab-drag-x")).toBe("-20");
    moveTo(260, 14);
    expect(c.getAttribute("data-tab-drag-x")).toBe("40");
    expect(c.getAttribute("data-tab-drag-y")).toBe("14");
    expect(c.style.transform).toBe("translate3d(40px, 14px, 0)");
  });
});

describe("phase60TabDrag — the other tabs reflow to open the gap", () => {
  it("shifts the tabs between the origin and the computed slot by the dragged width", () => {
    const { root } = renderHeader();
    const a = tab(root, "a");
    const b = tab(root, "b");
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120); // past b's midpoint -> slot 1 (between a and b in the reduced frame)
    expect(b.getAttribute("data-tab-reflow")).toBe("100");
    expect(b.style.transform).toBe("translateX(100px)");
    expect(a.getAttribute("data-tab-reflow")).toBeNull();
    // The dragged tab never carries a reflow offset of its own.
    expect(c.getAttribute("data-tab-reflow")).toBeNull();
  });

  it("changes who opens the gap when the pointer crosses a midpoint", () => {
    const { root } = renderHeader();
    const a = tab(root, "a");
    const b = tab(root, "b");
    armDrag(tab(root, "c"), 220);
    moveTo(120); // slot 1
    expect(a.getAttribute("data-tab-reflow")).toBeNull();
    expect(b.getAttribute("data-tab-reflow")).toBe("100");
    moveTo(10); // crossed a's midpoint -> slot 0
    expect(a.getAttribute("data-tab-reflow")).toBe("100");
    expect(b.getAttribute("data-tab-reflow")).toBe("100");
  });

  it("clears the reflow when the drop lands back on the origin slot", () => {
    const { root } = renderHeader();
    const a = tab(root, "a");
    const b = tab(root, "b");
    armDrag(tab(root, "c"), 220);
    moveTo(120); // slot 1 -> reflow visible
    expect(b.getAttribute("data-tab-reflow")).toBe("100");
    moveTo(280); // past every midpoint -> slot 2 === origin
    expect(a.getAttribute("data-tab-reflow")).toBeNull();
    expect(b.getAttribute("data-tab-reflow")).toBeNull();
  });
});

describe("phase60TabDrag — the commit contract is unchanged", () => {
  it("release still calls onMoveTab with the computed slot and clears the live state", () => {
    const { root, onMoveTab } = renderHeader();
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120);
    releaseAt(120, 0);
    expect(onMoveTab).toHaveBeenCalledWith("c", 1);
    expect(c.getAttribute("data-tab-dragging")).toBeNull();
    expect(c.style.transform).toBe("");
  });

  it("a downward past-threshold release still calls onDetachTab, not onMoveTab", () => {
    const { root, onMoveTab, onDetachTab } = renderHeader({ detach: true, stripBottom: 28 });
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120, 100); // more than 24px below the strip bottom
    releaseAt(120, 100);
    expect(onDetachTab).toHaveBeenCalledWith("c");
    expect(onMoveTab).not.toHaveBeenCalled();
  });

  it("a single-tab non-tear-out release is a harmless no-op (DEF-412)", () => {
    const { root, onMoveTab, onDetachTab } = renderHeader({
      activeId: "solo",
      tabs: [{ id: "solo", title: "solo.pdf", modified: false }] as typeof TAB_DEFS,
      stripBottom: 28,
    });
    const solo = tab(root, "solo");
    armDrag(solo, 50);
    moveTo(50, 100); // no detach handler, no other tab -> no drop slot
    // The single tab still follows the pointer even without a reflow target.
    expect(solo.getAttribute("data-tab-dragging")).toBe("true");
    expect(solo.getAttribute("data-tab-drag-y")).toBe("100");
    releaseAt(50, 100);
    expect(onMoveTab).not.toHaveBeenCalled();
    expect(onDetachTab).not.toHaveBeenCalled();
  });
});
