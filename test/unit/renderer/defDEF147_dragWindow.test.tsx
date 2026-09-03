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

// DEF-151 — dispatch a pointermove WITHOUT `act`, then read
// `getOffset()` on the SAME line, before React has had a chance to
// re-render. This simulates the packaged-app race (a Confirm click
// landing one render behind the last move): the synchronous ref must
// already hold the moved offset even though the visual state has not
// flushed. The asserted value comes from the ref, not the render, so
// the assertion holds regardless of React's batching.
function rawPointerMove(windowEl: Window, x: number, y: number): void {
  windowEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
}

// A harness that also exposes `getOffset` so the commit-source-of-truth
// contract can be asserted directly.
function mountRefHarness(controlsSelector: string): { el: HTMLElement; getOffset: () => { x: number; y: number } } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let cap: ReturnType<typeof useDragWindow> | null = null;
  act((): void => {
    root.render(
      createElement(function RefHarness(props: { controlsSelector: string }): ReactElement {
        const drag = useDragWindow({ controlsSelector: props.controlsSelector });
        cap = drag;
        return createElement("div", {
          ref: drag.windowRef,
          "data-testid": "dragwin-ref",
          className: drag.dragging ? "dragwin dragging" : "dragwin",
          style: { left: 40 + drag.offset.x, top: 40 + drag.offset.y },
          ...drag.handleProps,
        }, createElement("span", { "data-testid": "chrome-ref" }, "Chrome"));
      }, { controlsSelector }),
    );
  });
  const el = host.querySelector<HTMLElement>("[data-testid='dragwin-ref']");
  if (el === null) throw new Error("window not found");
  el.getBoundingClientRect = (): DOMRect => {
    const left = Number.parseFloat(el.style.left) || 0;
    const top = Number.parseFloat(el.style.top) || 0;
    return {
      left, top, width: 200, height: 120, right: left + 200, bottom: top + 120, x: left, y: top,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect;
  };
  return {
    el,
    getOffset: (): { x: number; y: number } => (cap as NonNullable<typeof cap>).getOffset(),
  };
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

  // DEF-151 — the REF is the commit source of truth. The pointermove
  // handler writes `offsetRef.current` inline, so getOffset() is right
  // the moment the pointer moves, with no dependency on React's render
  // cycle.
  it("DEF-151 — getOffset() holds the moved offset SYNCHRONOUSLY (raw pointermove, before any state flush)", () => {
    const { el, getOffset } = mountRefHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    // Raw dispatch (no act): the ref must already be {+200,+120} on
    // this same line — the exact window the packaged-app Confirm click
    // can land in when the visual state hasn't re-rendered yet.
    rawPointerMove(window, 300, 220);
    expect(getOffset()).toEqual({ x: 200, y: 120 });
    // Another move mid-drag updates the ref inline again.
    rawPointerMove(window, 340, 260);
    expect(getOffset()).toEqual({ x: 240, y: 160 });
  });

  it("DEF-151 — getOffset() survives release and a second drag accumulates from the ref", () => {
    const { el, getOffset } = mountRefHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(window, 300, 220); // +200 / +120
    expect(getOffset()).toEqual({ x: 200, y: 120 });
    pointer(el, "pointerup", { clientX: 300, clientY: 220 });
    // The window stays moved after release; the ref keeps the value a
    // later SEPARATE commit click will read.
    expect(el.classList.contains("dragging")).toBe(false);
    expect(getOffset()).toEqual({ x: 200, y: 120 });
    // Second drag: starts from the LIVE ref position, not a stale 0.
    pointer(el, "pointerdown", { button: 0, clientX: 300, clientY: 220 });
    pointerMove(window, 380, 340); // +80 / +120 on top of {200,120}
    expect(getOffset()).toEqual({ x: 280, y: 240 });
  });

  it("DEF-151 — getOffset() and the committed offset state agree after release", () => {
    const { el, getOffset } = mountRefHarness(".control-btn");
    pointer(el, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(window, 300, 220);
    pointer(el, "pointerup", { clientX: 300, clientY: 220 });
    // After the render, the visual state mirrors the ref exactly.
    expect(el.style.left).toBe(`${40 + 200}px`);
    expect(el.style.top).toBe(`${40 + 120}px`);
    expect(getOffset()).toEqual({ x: 200, y: 120 });
  });
});