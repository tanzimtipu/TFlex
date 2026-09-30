// @vitest-environment jsdom
//
// DEF-433 residual (TFL-76) — the instant-motion active-tab reveal.
//
// The animated path waits for the `.tab` transform `transitionend`. The
// instant path (reduced motion / Animations OFF) has no long transition to
// wait on, and a single / fixed-delay `scrollIntoView` runs while the strip is
// STILL reflowing, so a reordered active tab settled clipped (QA TFL-75). The
// fix applies the horizontal offset directly and re-applies it on every frame
// until the active tab's content position is stable (bounded).
//
// jsdom has no layout, so the REAL geometry oracle is the checkout e2e probe
// (motion ON/instant). Here we pin (a) the pure reveal math and (b) that the
// instant path schedules the bounded settle loop and applies a reveal to the
// ACTIVE tab.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  activeTabScrollDelta,
  AppHeader,
} from "../../../src/renderer/components/AppHeader";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
import type { Theme } from "../../../src/renderer/state/theme";

describe("DEF-433 — activeTabScrollDelta geometry", () => {
  it("is 0 when the tab is fully inside the viewport", () => {
    expect(activeTabScrollDelta({ left: 20, right: 120 }, { left: 0, right: 160 })).toBe(0);
  });
  it("scrolls left (negative delta) when the tab is clipped on the left", () => {
    expect(activeTabScrollDelta({ left: -44, right: 60 }, { left: 0, right: 160 })).toBe(-44);
  });
  it("scrolls right (positive delta) when the tab is clipped on the right", () => {
    expect(activeTabScrollDelta({ left: 200, right: 300 }, { left: 0, right: 160 })).toBe(140);
  });
  it("prefers the left edge when the tab is wider than the viewport", () => {
    expect(activeTabScrollDelta({ left: -10, right: 200 }, { left: 0, right: 160 })).toBe(-10);
  });
});

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

function pointerXY(type: string, clientX: number): Event {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 0 });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

describe("DEF-433 — the instant path schedules a bounded settle reveal", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let frames: FrameRequestCallback[] = [];
  let root: ReturnType<typeof createRoot>;
  let host: HTMLElement;
  let scrollLeft = 0;

  beforeEach(() => {
    frames = [];
    scrollLeft = 0;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      frames.push(cb);
      return frames.length;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((): void => undefined) as typeof globalThis.cancelAnimationFrame;
    Element.prototype.scrollIntoView = ((): void => undefined) as Element["scrollIntoView"];
    setAnimationsEnabledPreference(false); // Animations OFF -> instant motion
  });

  afterEach(() => {
    act((): void => {
      root?.unmount();
    });
    host?.remove();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    setAnimationsEnabledPreference(true);
  });

  it("re-applies the reveal to the ACTIVE tab until the strip settles", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onMoveTab = vi.fn();
    act((): void => {
      root.render(
        createElement(AppHeader, {
          activeId: "c",
          tabs: TAB_DEFS,
          onActivate: (): void => undefined,
          onClose: (): void => undefined,
          theme: "frosted" as Theme,
          onThemeChange: (): void => undefined,
          onNewEmptyTab: (): void => undefined,
          onOpenPreferences: (): void => undefined,
          onMoveTab,
        }),
      );
    });
    // Squeezed strip: a 160px viewport with three 100px tabs; the active tab
    // `c` (200..300) is clipped off the right edge until it is revealed.
    const list = host.querySelector<HTMLElement>(".tab-list");
    if (list === null) throw new Error("no .tab-list");
    list.getBoundingClientRect = (): DOMRect => rect(0, 160);
    Object.defineProperty(list, "scrollLeft", {
      configurable: true,
      get: (): number => scrollLeft,
      set: (v: number): void => {
        scrollLeft = v;
      },
    });
    TAB_DEFS.forEach((t, i) => {
      const el = host.querySelector<HTMLElement>(`[data-tab-id='${t.id}']`);
      // Viewport-relative, so scrolling the strip moves the box (as the real
      // layout does); the content position stays fixed at i*100.
      if (el !== null) el.getBoundingClientRect = (): DOMRect => rect(i * 100 - scrollLeft, 100);
    });

    const c = host.querySelector<HTMLElement>("[data-tab-id='c']");
    if (c === null) throw new Error("no tab c");
    act((): void => {
      c.dispatchEvent(pointerXY("pointerdown", 250));
    });
    act((): void => {
      window.dispatchEvent(pointerXY("pointermove", 10));
    });
    act((): void => {
      window.dispatchEvent(pointerXY("pointerup", 10));
    });
    expect(onMoveTab).toHaveBeenCalledWith("c", 0);
    // The instant settle loop is scheduled on the frame(s).
    expect(frames.length).toBeGreaterThan(0);

    let guard = 0;
    act((): void => {
      while (frames.length > 0 && guard < 64) {
        frames.shift()?.(0);
        guard += 1;
      }
    });
    // The active tab was revealed by scrolling the strip right by its clip.
    expect(scrollLeft).toBe(140);
  });
});
