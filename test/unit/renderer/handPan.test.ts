// Phase 13 — Hand (pan) mode helpers.
//
// The pan gesture lives in DocumentView's scroller pointer handlers;
// the interactive-ancestor bail-out and the scroll math live in
// src/renderer/state/handPan.ts so the cross-bubbling contract
// (AGENTS.md: never swallow a click that lands on an interactive
// element) is testable in isolation.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isPanBlockingTarget,
  panScrollPosition,
} from "../../../src/renderer/state/handPan";

function el(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  const node = host.firstElementChild;
  if (node === null) throw new Error("fixture must have a child");
  return node;
}

describe("isPanBlockingTarget — interactive chrome is never swallowed", () => {
  it("bails on buttons, links, inputs, selects, textareas, and role=button", () => {
    expect(isPanBlockingTarget(el("<button>page action</button>"))).toBe(true);
    expect(isPanBlockingTarget(el('<a href="#p2">link</a>'))).toBe(true);
    expect(isPanBlockingTarget(el("<input type='text'>"))).toBe(true);
    expect(isPanBlockingTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isPanBlockingTarget(el("<select><option>1</option></select>"))).toBe(true);
    expect(isPanBlockingTarget(el("<div role='button'></div>"))).toBe(true);
    expect(isPanBlockingTarget(el("<div role='slider'></div>"))).toBe(true);
  });

  it("bails on DESCENDANTS of interactive chrome (the ancestor walk)", () => {
    expect(isPanBlockingTarget(el("<button><svg></svg></button>"))).toBe(true);
    expect(isPanBlockingTarget(el('<a href="#p"><span>text</span></a>'))).toBe(true);
    expect(isPanBlockingTarget(el("<div role='button'><span>icon</span></div>"))).toBe(true);
  });

  it("allows pan drags on page surfaces — page slots, canvases, text-layer spans", () => {
    expect(isPanBlockingTarget(el("<div class='page-slot'></div>"))).toBe(false);
    expect(isPanBlockingTarget(el("<canvas></canvas>"))).toBe(false);
    expect(isPanBlockingTarget(el("<span class='textLayer-span'>word</span>"))).toBe(false);
  });

  it("treats null and non-Element targets as pannable", () => {
    expect(isPanBlockingTarget(null)).toBe(false);
    expect(isPanBlockingTarget(document.createTextNode("x"))).toBe(false);
  });
});

describe("panScrollPosition — invert drag delta into scroll", () => {
  it("inverts the pointer delta (drag right scrolls left, drag down scrolls up)", () => {
    const start = { clientX: 100, clientY: 100, scrollLeft: 40, scrollTop: 200 };
    expect(panScrollPosition(start, 25, 60)).toEqual({ left: 15, top: 140 });
  });

  it("clamps at zero — you cannot scroll past the top/left edge", () => {
    const start = { clientX: 50, clientY: 50, scrollLeft: 10, scrollTop: 5 };
    expect(panScrollPosition(start, 100, 80)).toEqual({ left: 0, top: 0 });
  });

  it("is a pure function of the captured start + the frame delta", () => {
    const start = { clientX: 0, clientY: 0, scrollLeft: 0, scrollTop: 0 };
    const a = panScrollPosition(start, 10, -10);
    const b = panScrollPosition(start, 10, -10);
    expect(a).toEqual(b);
  });
});