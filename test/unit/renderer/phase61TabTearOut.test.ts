// @vitest-environment jsdom
// Phase 61 — tab tear-out drag: un-clipped + translucent while outside the bar.
//
// Mirrors phase60TabDrag.test.ts: jsdom has no layout, so `.tab-list` and every
// `[data-tab-id]` rect are stubbed to a 100px row. The REAL pointer handlers in
// AppHeader are driven and the assertions cover the two Phase 61 presentation
// hooks that ride the existing tear-out state:
//   - the tear-out attribute is mirrored onto `.tab-area` (the clip owner);
//   - the dragged tab keeps tracking on BOTH axes while past the threshold;
//   - both the tear-out attribute and the dragging attribute clear on release
//     and when the drag returns inside the strip.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import type { Theme } from "../../../src/renderer/state/theme";

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
      createElement(AppHeader, {
        activeId,
        tabs,
        onActivate,
        onClose: (): void => undefined,
        theme: "frosted" as Theme,
        onThemeChange: (): void => undefined,
        onNewEmptyTab: (): void => undefined,
        onOpenPreferences: (): void => undefined,
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
  return { root: container, onMoveTab, onDetachTab };
}

function tab(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-tab-id='${id}']`);
  if (el === null) throw new Error(`missing tab ${id}`);
  return el;
}

function tabArea(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>(".tab-area");
  if (el === null) throw new Error("missing .tab-area");
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

describe("phase61TabTearOut — the tear-out attribute rides both clip owners", () => {
  it("mirrors data-tab-tearout onto .tab-area while the pointer is past the threshold", () => {
    const { root } = renderHeader({ detach: true, stripBottom: 28 });
    const c = tab(root, "c");
    armDrag(c, 220);
    // Past the threshold (28 + 24 = 52): the strip is in the tear-out state.
    moveTo(120, 100);
    expect(tabArea(root).getAttribute("data-tab-tearout")).toBe("true");
    // The dragged tab still tracks on BOTH axes while outside the bar.
    expect(c.getAttribute("data-tab-dragging")).toBe("true");
    expect(c.getAttribute("data-tab-drag-x")).toBe("-100");
    expect(c.getAttribute("data-tab-drag-y")).toBe("100");
    expect(c.style.transform).toBe("translate3d(-100px, 100px, 0)");
  });

  it("clears the tear-out attribute when the drag returns inside the strip", () => {
    const { root } = renderHeader({ detach: true, stripBottom: 28 });
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120, 100);
    expect(tabArea(root).getAttribute("data-tab-tearout")).toBe("true");
    moveTo(120, 0); // back inside the strip
    expect(tabArea(root).getAttribute("data-tab-tearout")).toBeNull();
    // The dragged tab is still live, just no longer torn out.
    expect(c.getAttribute("data-tab-dragging")).toBe("true");
  });

  it("clears both the tear-out attribute and the dragging attribute on release", () => {
    const { root, onDetachTab } = renderHeader({ detach: true, stripBottom: 28 });
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120, 100);
    releaseAt(120, 100);
    expect(onDetachTab).toHaveBeenCalledWith("c");
    expect(tabArea(root).getAttribute("data-tab-tearout")).toBeNull();
    expect(c.getAttribute("data-tab-dragging")).toBeNull();
    expect(c.style.transform).toBe("");
  });

  it("leaves the tear-out attribute absent for an in-strip drag", () => {
    const { root } = renderHeader({ detach: true, stripBottom: 28 });
    const c = tab(root, "c");
    armDrag(c, 220);
    moveTo(120, 0); // never past the threshold
    expect(tabArea(root).getAttribute("data-tab-tearout")).toBeNull();
  });
});
