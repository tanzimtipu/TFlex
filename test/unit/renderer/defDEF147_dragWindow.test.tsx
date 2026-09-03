// @vitest-environment jsdom
// DEF-147 — every floating context window except the Edit-mode inline
// editor was stuck: no pointermove handler repositioned them, so a
// header/chrome drag moved them dx=0 dy=0. The fix generalizes the
// DEF-140 drag (which qa pinned in def_140_verify_1.7.14.spec.cjs:
// MID-DRAG the window already follows the cursor, AFTER release it
// stays, and presses on controls never start a move) into the shared
// `useDragWindow` hook, and every floating window (signature pending
// action bar, sticky-note editor, textbox editor + action bar, color
// palette popover, stamp dialog) now wires it.
//
// This test pins the HOOK's mechanics directly (all five windows share
// them): whole-window chrome drag moves the window by the pointer
// delta, control presses never start a move, pointerup / pointercancel
// end the drag, and the window clamps within the viewport.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { useDragWindow } from "../../../src/renderer/components/useDragWindow";

function Harness({ controlsSelector }: { controlsSelector: string }): ReactElement {
  const drag = useDragWindow({ controlsSelector });
  // Anchor at (40, 40) — the test reads the window's style left/top.
  return createElement(
    "div",
    {
      ref: drag.windowRef,
      "data-testid": "dragwin",
      className: drag.dragging ? "dragwin dragging" : "dragwin",
      style: { left: 40 + drag.offset.x, top: 40 + drag.offset.y },
      ...drag.handleProps,
    },
    createElement("div", { "data-testid": "control", className: "control-btn" }, "Control"),
    createElement("span", { "data-testid": "chrome" }, "Chrome"),
  );
}

function mountHarness(controlsSelector: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Harness, { controlsSelector }));
  });
  const el = host.querySelector<HTMLElement>("[data-testid='dragwin']");
  if (el === null) throw new Error("window not found");
  // jsdom does no layout — stub the measured rect like the DEF-140
  // test does (anchored at the current inline left/top).
  el.getBoundingClientRect = (): DOMRect => {
    const left = Number.parseFloat(el.style.left) || 0;
    const top = Number.parseFloat(el.style.top) || 0;
    return {
      left,
      top,
      width: 200,
      height: 120,
      right: left + 200,
      bottom: top + 120,
      x: left,
      y: top,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect;
  };
  return el;
}

function pointer(el: HTMLElement | Window, type: string, opts: PointerEventInit = {}): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }));
  });
}

function pointerMove(windowEl: Window, x: number, y: number): void {
  act((): void => {
    windowEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
  });
}

describe("DEF-147 — the shared floating-window drag hook", () => {
  it("dragging the window chrome moves the window by the pointer delta", () => {
    const el = mountHarness(".control-btn, button, input, textarea, select");
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("40px");

    // Press the CHROME (a span that is not a control) and drag.
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(el.classList.contains("dragging")).toBe(true);
    pointerMove(window, 220, 180);
    expect(el.style.left).toBe("160px");
    expect(el.style.top).toBe("120px");
  });

  it("a press on a control never starts a move", () => {
    const el = mountHarness(".control-btn, button, input, textarea, select");
    const control = el.querySelector<HTMLElement>("[data-testid='control']");
    expect(control).not.toBeNull();
    if (control === null) return;
    pointer(control, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(el.classList.contains("dragging")).toBe(false);
    pointerMove(window, 220, 180);
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("40px");
  });

  it("pointerup ends the drag and the window stays put", () => {
    const el = mountHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(window, 160, 140);
    expect(el.style.left).toBe("100px");
    pointer(el, "pointerup", { clientX: 160, clientY: 140 });
    expect(el.classList.contains("dragging")).toBe(false);
    pointerMove(window, 500, 500);
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe("80px");
  });

  it("pointercancel also ends the drag (OS gesture steal)", () => {
    const el = mountHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(el.classList.contains("dragging")).toBe(true);
    pointer(el, "pointercancel");
    expect(el.classList.contains("dragging")).toBe(false);
    pointerMove(window, 400, 300);
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("40px");
  });

  it("dragging beyond a viewport edge clamps the window at that edge", () => {
    const el = mountHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(window, 5100, 5100);
    expect(el.style.left).toBe(`${window.innerWidth - 200}px`);
    expect(el.style.top).toBe(`${window.innerHeight - 120}px`);
    pointer(el, "pointerup", {});
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(window, -4900, -4900);
    expect(el.style.left).toBe("0px");
    expect(el.style.top).toBe("0px");
  });

  it("non-left button presses never start a move", () => {
    const el = mountHarness(".control-btn");
    pointer(el, "pointerdown", { button: 2, clientX: 100, clientY: 100 });
    expect(el.classList.contains("dragging")).toBe(false);
  });
});