// @vitest-environment jsdom
//
// Phase 14 — Liquid Glass ambient state: the window-focus machine, the
// parallax spring math, and the ambient controller that mirrors focus
// onto <html data-window-focus> and publishes the smoothed parallax
// offset as CSS vars on the .tf-ambient layer. These are the phase's
// "unit tests for animation state": the spring integrator and the two
// ambient behaviors are pinned here without a real window.
import { describe, expect, it, vi } from "vitest";
import {
  clampParallax,
  createAmbientController,
  PARALLAX_DAMPING,
  PARALLAX_MAX_PX,
  PARALLAX_STIFFNESS,
  pointerToParallax,
  reduceWindowFocus,
  stepSpring,
  type AmbientWindow,
} from "../../../src/renderer/state/ambient";

/** Minimal window stub matching the controller's structural contract. */
class StubWindow implements AmbientWindow {
  private listeners = new Map<string, (e: Event) => void>();
  innerWidth = 1000;
  innerHeight = 800;

  constructor(private readonly reduced: boolean = false) {}

  matchMedia(query: string): { matches: boolean } {
    return { matches: this.reduced && query.includes("prefers-reduced-motion") };
  }

  addEventListener(type: "focus" | "blur" | "pointermove", fn: (e: Event) => void): void {
    this.listeners.set(type, fn);
  }

  removeEventListener(type: "focus" | "blur" | "pointermove"): void {
    this.listeners.delete(type);
  }

  dispatch(type: "focus" | "blur" | "pointermove", event?: Partial<PointerEvent>): void {
    this.listeners.get(type)?.(event as Event);
  }

  hasListener(type: string): boolean {
    return this.listeners.has(type);
  }
}

function makeLayer(): { el: HTMLElement; vars: Map<string, string> } {
  const el = document.createElement("div");
  const vars = new Map<string, string>();
  el.style.setProperty = (name: string, value: string): void => {
    vars.set(name, value);
  };
  return { el, vars };
}

describe("Phase 14 — window focus machine", () => {
  it("starts focused and any blur defocuses the glass", () => {
    expect(reduceWindowFocus("focused", "blur")).toBe("blurred");
  });

  it("any focus event re-focuses, from either state", () => {
    expect(reduceWindowFocus("blurred", "focus")).toBe("focused");
    expect(reduceWindowFocus("focused", "focus")).toBe("focused");
  });

  it("is idempotent on repeated events", () => {
    expect(reduceWindowFocus("blurred", "blur")).toBe("blurred");
  });
});

describe("Phase 14 — parallax spring", () => {
  it("converges to the target and settles (velocity dies out)", () => {
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < 200; i += 1) {
      state = stepSpring(state, 6, PARALLAX_STIFFNESS, PARALLAX_DAMPING, 16);
    }
    expect(Math.abs(state.value - 6)).toBeLessThan(0.05);
    expect(Math.abs(state.velocity)).toBeLessThan(0.05);
  });

  it("is fluid, not instant: still mid-flight after 5 frames", () => {
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < 5; i += 1) {
      state = stepSpring(state, 6, PARALLAX_STIFFNESS, PARALLAX_DAMPING, 16);
    }
    expect(state.value).toBeGreaterThan(0.5);
    expect(state.value).toBeLessThan(6);
  });

  it("clamps to the +-max drift box", () => {
    expect(clampParallax(99, -99)).toEqual({ x: PARALLAX_MAX_PX, y: -PARALLAX_MAX_PX });
    expect(clampParallax(1, 2)).toEqual({ x: 1, y: 2 });
  });

  it("maps the pointer to a clamped offset from the viewport center", () => {
    expect(pointerToParallax(500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
    expect(pointerToParallax(0, 0, 1000, 800)).toEqual({
      x: -PARALLAX_MAX_PX,
      y: -PARALLAX_MAX_PX,
    });
    expect(pointerToParallax(1000, 800, 1000, 800)).toEqual({
      x: PARALLAX_MAX_PX,
      y: PARALLAX_MAX_PX,
    });
  });

  it("degrades to a zero offset for a degenerate viewport", () => {
    expect(pointerToParallax(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("Phase 14 — ambient controller", () => {
  it("mirrors focus/blur onto the root's data-window-focus attribute", () => {
    const root = document.createElement("div");
    const { el: layer } = makeLayer();
    const win = new StubWindow();
    const controller = createAmbientController({ root, layer, win });
    expect(root.dataset.windowFocus).toBe("focused");
    win.dispatch("blur");
    expect(root.dataset.windowFocus).toBe("blurred");
    win.dispatch("focus");
    expect(root.dataset.windowFocus).toBe("focused");
    controller.destroy();
  });

  it("drives the parallax spring toward the pointer target and settles", () => {
    const root = document.createElement("div");
    const { el: layer, vars } = makeLayer();
    const win = new StubWindow();
    let frameCb: ((time: number) => void) | null = null;
    const controller = createAmbientController({
      root,
      layer,
      win,
      scheduleFrame: (cb): number => {
        frameCb = cb;
        return 1;
      },
      cancelFrame: (): void => {
        frameCb = null;
      },
    });

    win.dispatch("pointermove", { clientX: 1000, clientY: 800 });
    expect(frameCb).not.toBeNull();

    // Pump the frame loop by hand until the spring settles (the
    // controller stops rescheduling once it reaches the target).
    // The reader function sidesteps TS's closure narrowing: the
    // scheduler callback reassigns `frameCb`, so a direct read in
    // this scope would be narrowed to `null` forever.
    const readFrameCb = (): ((time: number) => void) | null => frameCb;
    let time = 0;
    for (let i = 0; i < 400; i += 1) {
      const cb = readFrameCb();
      if (cb === null) break;
      frameCb = null;
      time += 16;
      cb(time);
    }
    expect(frameCb).toBeNull();
    expect(vars.get("--tf-parallax-x")).toBe(PARALLAX_MAX_PX.toFixed(2));
    expect(vars.get("--tf-parallax-y")).toBe(PARALLAX_MAX_PX.toFixed(2));
    controller.destroy();
  });

  it("runs no frame loop under prefers-reduced-motion", () => {
    const root = document.createElement("div");
    const { el: layer, vars } = makeLayer();
    const win = new StubWindow(true);
    const scheduleFrame = vi.fn(() => 1);
    const controller = createAmbientController({ root, layer, win, scheduleFrame });

    expect(win.hasListener("pointermove")).toBe(false);
    win.dispatch("pointermove", { clientX: 1000, clientY: 800 });
    expect(scheduleFrame).not.toHaveBeenCalled();
    expect(vars.size).toBe(0);
    // Focus tracking still works without motion.
    win.dispatch("blur");
    expect(root.dataset.windowFocus).toBe("blurred");
    controller.destroy();
  });

  it("destroy() detaches every listener (no ghost updates)", () => {
    const root = document.createElement("div");
    const { el: layer } = makeLayer();
    const win = new StubWindow();
    const controller = createAmbientController({ root, layer, win });
    controller.destroy();
    expect(win.hasListener("focus")).toBe(false);
    expect(win.hasListener("blur")).toBe(false);
    expect(win.hasListener("pointermove")).toBe(false);
    win.dispatch("blur");
    expect(root.dataset.windowFocus).toBe("focused");
  });

  it("keeps focus tracking alive when the layer is missing", () => {
    const root = document.createElement("div");
    const win = new StubWindow();
    const controller = createAmbientController({ root, layer: null, win });
    win.dispatch("blur");
    expect(root.dataset.windowFocus).toBe("blurred");
    controller.destroy();
  });
});
