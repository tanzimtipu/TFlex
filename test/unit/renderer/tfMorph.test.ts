// Phase 20 — the morphing-surface primitive: pure FLIP maths.
//
// A menu/popover must read as its trigger box GROWING into the expanded
// box. The surface keeps its final layout; morphFromTrigger returns the
// transform that puts it exactly on the trigger's box for the first frame.
// These tests pin the geometry (no DOM needed): the pinned corner lands on
// the trigger's matching corner, the scaled box matches the trigger box,
// the origin string is the pinned corner, the exit mirrors the enter, and
// degenerate/clamped rects can never produce NaN or a non-positive scale.

import { describe, expect, it } from "vitest";
import {
  morphFromTrigger,
  tfMorph,
  type MorphAnchorCorner,
  type MorphRect,
} from "../../../src/renderer/components/motion/tfPresets";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_OPACITY,
  msToSeconds,
} from "../../../src/renderer/hooks/motionTokens";

function rect(left: number, top: number, width: number, height: number): MorphRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A downward-opening menu anchored under a 28x22 trigger. */
const TRIGGER = rect(1387, 54, 28, 32);
const SURFACE = rect(1215, 86, 200, 510);

/** Where the pinned corner lands after the initial transform. The pinned
 *  corner sits ON the transform-origin, so scale leaves it in place and
 *  only the translate moves it. */
function mappedCorner(
  surface: MorphRect,
  initial: { x?: unknown; y?: unknown },
  corner: MorphAnchorCorner,
): { x: number; y: number } {
  const opensDown = corner.startsWith("top");
  const pinnedRight = corner.endsWith("right");
  return {
    x: (pinnedRight ? surface.right : surface.left) + (initial.x as number),
    y: (opensDown ? surface.top : surface.bottom) + (initial.y as number),
  };
}

/** The corner of the trigger the surface's anchored corner must land on
 *  (the same-named corner, so the first frame is the trigger's box). */
function triggerCorner(trigger: MorphRect, corner: MorphAnchorCorner): { x: number; y: number } {
  const opensDown = corner.startsWith("top");
  const pinnedRight = corner.endsWith("right");
  return {
    x: pinnedRight ? trigger.right : trigger.left,
    y: opensDown ? trigger.top : trigger.bottom,
  };
}

/** The surface's box after the initial transform (the anchored corner is
 *  fixed by the origin; the translate moves it onto the trigger's). */
function transformedRect(
  surface: MorphRect,
  initial: { x?: unknown; y?: unknown; scaleX?: unknown; scaleY?: unknown },
  corner: MorphAnchorCorner,
): { left: number; top: number; width: number; height: number } {
  const opensDown = corner.startsWith("top");
  const pinnedRight = corner.endsWith("right");
  const width = surface.width * (initial.scaleX as number);
  const height = surface.height * (initial.scaleY as number);
  const right = (pinnedRight ? surface.right : surface.left) + (initial.x as number);
  const top = (opensDown ? surface.top : surface.bottom) + (initial.y as number);
  return {
    left: pinnedRight ? right - width : right,
    top: opensDown ? top : top - height,
    width,
    height,
  };
}

const CORNERS: MorphAnchorCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

describe("morphFromTrigger — the FLIP maths", () => {
  it("maps the surface's pinned corner onto the trigger's matching corner", () => {
    for (const corner of CORNERS) {
      const morph = morphFromTrigger(TRIGGER, SURFACE, corner);
      const mapped = mappedCorner(SURFACE, morph.initial, corner);
      const target = triggerCorner(TRIGGER, corner);
      expect(mapped.x, `${corner} x`).toBeCloseTo(target.x, 6);
      expect(mapped.y, `${corner} y`).toBeCloseTo(target.y, 6);
    }
  });

  it("scales the surface's box onto the trigger's box (first frame coincides)", () => {
    for (const corner of CORNERS) {
      const morph = morphFromTrigger(TRIGGER, SURFACE, corner);
      expect(morph.initial.scaleX).toBeCloseTo(TRIGGER.width / SURFACE.width, 6);
      expect(morph.initial.scaleY).toBeCloseTo(TRIGGER.height / SURFACE.height, 6);
      // Scaled span == trigger span, so the two boxes coincide exactly.
      expect(SURFACE.width * (morph.initial.scaleX as number)).toBeCloseTo(TRIGGER.width, 6);
      expect(SURFACE.height * (morph.initial.scaleY as number)).toBeCloseTo(TRIGGER.height, 6);
      // ...and the whole transformed box IS the trigger's rect.
      const box = transformedRect(SURFACE, morph.initial, corner);
      expect(box.left, `${corner} left`).toBeCloseTo(TRIGGER.left, 6);
      expect(box.top, `${corner} top`).toBeCloseTo(TRIGGER.top, 6);
      expect(box.width, `${corner} width`).toBeCloseTo(TRIGGER.width, 6);
      expect(box.height, `${corner} height`).toBeCloseTo(TRIGGER.height, 6);
    }
  });

  it("returns the pinned corner as the CSS transform-origin", () => {
    expect(morphFromTrigger(TRIGGER, SURFACE, "top-left").transformOrigin).toBe("top left");
    expect(morphFromTrigger(TRIGGER, SURFACE, "top-right").transformOrigin).toBe("top right");
    expect(morphFromTrigger(TRIGGER, SURFACE, "bottom-left").transformOrigin).toBe("bottom left");
    expect(morphFromTrigger(TRIGGER, SURFACE, "bottom-right").transformOrigin).toBe("bottom right");
  });

  it("starts the surface just short of opaque (not from 0)", () => {
    const morph = morphFromTrigger(TRIGGER, SURFACE, "top-right");
    expect(morph.initial.opacity).toBe(MOTION_OPACITY.surface);
    expect(MOTION_OPACITY.surface).toBeGreaterThan(0);
    expect(MOTION_OPACITY.surface).toBeLessThan(MOTION_OPACITY.visible);
  });

  it("mirrors the enter on exit and pins pointer-events on the first frame", () => {
    for (const corner of CORNERS) {
      const { initial, exit } = morphFromTrigger(TRIGGER, SURFACE, corner);
      expect(exit.x).toBe(initial.x);
      expect(exit.y).toBe(initial.y);
      expect(exit.scaleX).toBe(initial.scaleX);
      expect(exit.scaleY).toBe(initial.scaleY);
      expect(exit.opacity).toBe(MOTION_OPACITY.hidden);
      // The DEF-087/088/090 guard: a closing surface never swallows a click.
      expect(exit.pointerEvents).toBe("none");
      expect(initial.pointerEvents).toBeUndefined();
    }
  });

  it("stays valid for a viewport-clamped final rect (no NaN, no negative scale)", () => {
    // The menu is clamped to the left/top viewport edges, so it overhangs
    // past its trigger on both axes — the morph must still be invertible.
    const clamped = rect(0, 0, 200, 510);
    for (const corner of CORNERS) {
      const morph = morphFromTrigger(TRIGGER, clamped, corner);
      for (const value of [
        morph.initial.x,
        morph.initial.y,
        morph.initial.scaleX,
        morph.initial.scaleY,
      ]) {
        expect(Number.isFinite(value as number)).toBe(true);
      }
      expect(morph.initial.scaleX as number).toBeGreaterThan(0);
      expect(morph.initial.scaleY as number).toBeGreaterThan(0);
    }
  });

  it("degrades gracefully on a degenerate (zero-size) trigger", () => {
    const degenerate = rect(100, 100, 0, 0);
    for (const corner of CORNERS) {
      const morph = morphFromTrigger(degenerate, SURFACE, corner);
      for (const value of [
        morph.initial.x,
        morph.initial.y,
        morph.initial.scaleX,
        morph.initial.scaleY,
      ]) {
        expect(Number.isFinite(value as number)).toBe(true);
      }
      // A zero span can never ask for scale 0 (invisible/non-invertible).
      expect(morph.initial.scaleX as number).toBeGreaterThan(0);
      expect(morph.initial.scaleY as number).toBeGreaterThan(0);
      expect(morph.initial.scaleX as number).toBeLessThanOrEqual(1);
      expect(morph.initial.scaleY as number).toBeLessThanOrEqual(1);
      // The pinned corner still lands on the trigger's corner.
      const mapped = mappedCorner(SURFACE, morph.initial, corner);
      const target = triggerCorner(degenerate, corner);
      expect(mapped.x).toBeCloseTo(target.x, 6);
      expect(mapped.y).toBeCloseTo(target.y, 6);
    }
  });

  it("degrades gracefully on an unmeasurable (zero-size) surface", () => {
    const morph = morphFromTrigger(TRIGGER, rect(0, 0, 0, 0), "top-right");
    expect(morph.initial.scaleX).toBe(1);
    expect(morph.initial.scaleY).toBe(1);
    expect(Number.isFinite(morph.initial.x as number)).toBe(true);
    expect(Number.isFinite(morph.initial.y as number)).toBe(true);
  });
});

describe("tfMorph — the preset factory", () => {
  it("animates to the identity box and ramps opacity to 1", () => {
    const preset = tfMorph(TRIGGER, SURFACE, "top-right");
    expect(preset.animate.x).toBe(0);
    expect(preset.animate.y).toBe(0);
    expect(preset.animate.scaleX).toBe(1);
    expect(preset.animate.scaleY).toBe(1);
    expect(preset.animate.opacity).toBe(MOTION_OPACITY.visible);
    expect(preset.transformOrigin).toBe("top right");
  });

  it("resolves every duration and easing from the motion tokens", () => {
    const preset = tfMorph(TRIGGER, SURFACE, "top-right");
    expect(preset.transition.duration).toBe(msToSeconds(MOTION_DURATION.fast));
    expect(preset.transition.ease).toBe(MOTION_EASE.enter);
    const exitTransition = preset.exit.transition as { duration: number; ease: unknown };
    expect(exitTransition.duration).toBe(msToSeconds(MOTION_DURATION.fast));
    expect(exitTransition.ease).toBe(MOTION_EASE.exit);
  });

  it("carries the reverse morph and the pointer-events guard into exit", () => {
    const preset = tfMorph(TRIGGER, SURFACE, "top-right");
    expect(preset.exit.x).toBe(preset.initial.x);
    expect(preset.exit.scaleY).toBe(preset.initial.scaleY);
    expect(preset.exit.pointerEvents).toBe("none");
    expect(preset.exit.opacity).toBe(MOTION_OPACITY.hidden);
  });
});
