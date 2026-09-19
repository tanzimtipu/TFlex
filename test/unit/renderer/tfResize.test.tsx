// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Phase 20 — the layout-aware size primitive (TfResize):
//   1. the pure helpers (axis mapping, unmeasurable-box guard, tolerance),
//   2. the pure size-drive decision (first measurement = set, every later
//      change = tween — the regression that made the first tab switch jump),
//   3. every duration/easing resolves from the motion tokens,
//   4. the rendered structure is identical under reduced motion.
//
// The interpolation itself is NOT asserted here: jsdom has no layout and
// runs no motion frames. The frame-by-frame rect trace is measured in the
// real Electron harness (screenshots/phase20-chunk2-sign-mid-*.png).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  TfResize,
  paneSwapFor,
  resizeActionFor,
  resizeAxes,
  resizeSizesEqual,
  resizeTargetFor,
  resizeTransitionFor,
} from "../../../src/renderer/components/motion/TfResize";
import {
  MOTION_DURATION,
  MOTION_EASE,
  msToSeconds,
} from "../../../src/renderer/hooks/motionTokens";

function installReducedMotion(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): unknown => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => true,
    }),
  });
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach((): void => {
  installReducedMotion(false);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach((): void => {
  act((): void => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

function renderFrame(marker: string): HTMLElement {
  act((): void => {
    root?.render(
      <TfResize className="probe-frame" axes="height">
        <div className="probe-content">{marker}</div>
      </TfResize>,
    );
  });
  const el = container?.querySelector<HTMLElement>(".probe-frame") ?? null;
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("TfResize — pure size-transition helpers", () => {
  it("maps the axes a target carries", () => {
    expect(resizeAxes("height")).toEqual(["height"]);
    expect(resizeAxes("width")).toEqual(["width"]);
    expect(resizeAxes("both")).toEqual(["width", "height"]);
  });

  it("builds a target only from a measurable box", () => {
    expect(resizeTargetFor({ width: 560, height: 381 }, "height")).toEqual({ height: 381 });
    expect(resizeTargetFor({ width: 560, height: 381 }, "both")).toEqual({
      width: 560,
      height: 381,
    });
    // A layout-less / detached box reports zero: animating to it would
    // collapse the frame, so no target is produced.
    expect(resizeTargetFor({ width: 560, height: 0 }, "height")).toBeNull();
    expect(resizeTargetFor({ width: 0, height: 381 }, "both")).toBeNull();
    expect(resizeTargetFor({ width: 560, height: Number.NaN }, "height")).toBeNull();
  });

  it("treats sub-pixel drift as unchanged so an observer tick never re-tweens", () => {
    expect(resizeSizesEqual({ width: 560, height: 381 }, { width: 560, height: 381.2 }, "height")).toBe(true);
    expect(resizeSizesEqual({ width: 560, height: 381 }, { width: 560, height: 383 }, "height")).toBe(false);
  });

  it("resolves the size tween from the standard duration + layout ease", () => {
    expect(resizeTransitionFor(false)).toEqual({
      duration: msToSeconds(MOTION_DURATION.standard),
      ease: MOTION_EASE.layout,
    });
    expect(resizeTransitionFor(true)).toEqual({
      type: "tween",
      duration: msToSeconds(MOTION_DURATION.reduced),
      ease: "linear",
    });
  });

  it("resolves the pane cross-fade from the fast band on enter/exit eases", () => {
    const swap = paneSwapFor(false);
    expect(swap.initial).toEqual({ opacity: 0 });
    expect(swap.animate.transition).toEqual({
      duration: msToSeconds(MOTION_DURATION.fast),
      ease: MOTION_EASE.enter,
    });
    expect(swap.exit.transition).toEqual({
      duration: msToSeconds(MOTION_DURATION.fast),
      ease: MOTION_EASE.exit,
    });
    const reduced = paneSwapFor(true);
    expect(reduced.animate.transition?.duration).toBe(msToSeconds(MOTION_DURATION.reduced));
    expect(reduced.exit.transition?.duration).toBe(msToSeconds(MOTION_DURATION.reduced));
  });
});

describe("TfResize — the size drive", () => {
  it("sets the FIRST measured target instead of tweening it", () => {
    const target = resizeTargetFor({ width: 560, height: 198 }, "height");
    expect(resizeActionFor(null, target, "x198", false)).toEqual({ kind: "set", target });
  });

  it("tweens EVERY later change, including the first tab switch", () => {
    // The regression this pins: with the declarative `animate` prop motion
    // applies a target that first appears after mount as an instant set, so
    // the FIRST switch jumped. The applied signature is non-null after the
    // mount `set`, so the first change is a `start`.
    const target = resizeTargetFor({ width: 560, height: 262 }, "height");
    const action = resizeActionFor("x198", target, "x262", false);
    expect(action?.kind).toBe("start");
    expect(action).toEqual({
      kind: "start",
      target,
      transition: {
        duration: msToSeconds(MOTION_DURATION.standard),
        ease: MOTION_EASE.layout,
      },
    });
  });

  it("does nothing when the measurement is unchanged or absent", () => {
    const target = resizeTargetFor({ width: 560, height: 262 }, "height");
    expect(resizeActionFor("x262", target, "x262", false)).toBeNull();
    expect(resizeActionFor(null, null, null, false)).toBeNull();
    expect(resizeActionFor("x198", target, null, false)).toBeNull();
  });

  it("reduces every action to an instant set under reduced motion", () => {
    const target = resizeTargetFor({ width: 560, height: 363 }, "height");
    expect(resizeActionFor("x262", target, "x363", true)).toEqual({ kind: "set", target });
  });
});

describe("TfResize — the animated frame", () => {
  it("renders the measured content wrapper and the axis marker", () => {
    const el = renderFrame("a");
    expect(el.getAttribute("data-tf-resize")).toBe("height");
    expect(el.querySelector("[data-tf-resize-inner]")).not.toBeNull();
    expect(el.querySelector(".probe-content")?.textContent).toBe("a");
  });

  it("keeps the same structure under reduced motion", () => {
    installReducedMotion(true);
    const el = renderFrame("a");
    expect(el.getAttribute("data-tf-resize")).toBe("height");
    expect(el.querySelector("[data-tf-resize-inner]")).not.toBeNull();
    expect(el.querySelector(".probe-content")?.textContent).toBe("a");
  });
});
