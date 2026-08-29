// Phase 10 — image-edit geometry tests.
//
// Pure math; no DOM. The image overlay calls these on every
// pointermove (live preview) and pointerup (final commit). The
// on-screen preview must always match what the engine sees, so
// the math is the contract both paths share.

import { describe, expect, it } from "vitest";
import {
  cropImageRect,
  moveImageRect,
  pageRectToImageLocal,
  rectArea,
  rectContainsRect,
  rectsClose,
  resizeImageRect,
} from "../../../src/renderer/edit/geometry";

const PAGE_W = 612;
const PAGE_H = 792;

describe("moveImageRect", () => {
  it("translates the rect by the delta", () => {
    const moved = moveImageRect(
      { x: 100, y: 100, width: 80, height: 60 },
      { x: 10, y: -20 },
      PAGE_W,
      PAGE_H,
    );
    expect(moved).toEqual({ x: 110, y: 80, width: 80, height: 60 });
  });

  it("clamps to the page so the rect never escapes", () => {
    const moved = moveImageRect(
      { x: 600, y: 780, width: 50, height: 30 },
      { x: 100, y: 100 },
      PAGE_W,
      PAGE_H,
    );
    expect(moved.x + moved.width).toBeLessThanOrEqual(PAGE_W);
    expect(moved.y + moved.height).toBeLessThanOrEqual(PAGE_H);
  });
});

describe("resizeImageRect", () => {
  it("grows the rect when dragging the SE handle down-right", () => {
    const start = { x: 100, y: 100, width: 80, height: 60 };
    const next = resizeImageRect(start, "se", { x: 20, y: 30 }, PAGE_W, PAGE_H);
    expect(next).toEqual({ x: 100, y: 100, width: 100, height: 90 });
  });

  it("shrinks the rect when dragging the NW handle up-left", () => {
    const start = { x: 100, y: 100, width: 80, height: 60 };
    const next = resizeImageRect(start, "nw", { x: -10, y: -20 }, PAGE_W, PAGE_H);
    // The handle moves, so the rect's top-left moves down-right;
    // the right + bottom edges stay anchored.
    expect(next).toEqual({ x: 90, y: 80, width: 90, height: 80 });
  });

  it("enforces a minimum size of 4pt even when the drag would invert", () => {
    const start = { x: 100, y: 100, width: 80, height: 60 };
    // Drag the SE handle 200pt to the left and 200pt up — would
    // produce a negative-size rect. The function pins the result
    // to a 4pt-min rect anchored at the original top-left.
    const next = resizeImageRect(start, "se", { x: -200, y: -200 }, PAGE_W, PAGE_H);
    expect(next.width).toBeGreaterThanOrEqual(4);
    expect(next.height).toBeGreaterThanOrEqual(4);
  });

  it("clamps inside the page so the rect never escapes", () => {
    const start = { x: 0, y: 0, width: 80, height: 60 };
    const next = resizeImageRect(start, "se", { x: 700, y: 800 }, PAGE_W, PAGE_H);
    expect(next.x + next.width).toBeLessThanOrEqual(PAGE_W);
    expect(next.y + next.height).toBeLessThanOrEqual(PAGE_H);
  });
});

describe("cropImageRect", () => {
  it("returns a sub-rect of the image in page coordinates", () => {
    const image = { x: 100, y: 200, width: 200, height: 100 };
    // Crop the central half of the image (local 0.25..0.75).
    const crop = cropImageRect(image, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(crop).toEqual({ x: 150, y: 225, width: 100, height: 50 });
  });

  it("clamps the inner rect to [0, 1] and enforces a min size", () => {
    const image = { x: 0, y: 0, width: 100, height: 100 };
    // Negative + oversized inputs are clamped.
    const crop = cropImageRect(image, { x: -0.5, y: 2, width: 0.5, height: 5 });
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(image.x + image.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(image.y + image.height);
  });
});

describe("pageRectToImageLocal", () => {
  it("maps a page rect back into the image's 0..1 local space", () => {
    const image = { x: 100, y: 200, width: 200, height: 100 };
    const local = pageRectToImageLocal(image, { x: 150, y: 250, width: 100, height: 50 });
    expect(local).toEqual({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
  });
});

describe("rectsClose", () => {
  it("returns true for identical rects", () => {
    expect(rectsClose({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
  });
  it("returns true for rects within the default tolerance", () => {
    expect(rectsClose({ x: 0, y: 0, width: 100, height: 100 }, { x: 0.1, y: 0.1, width: 100, height: 100 })).toBe(true);
  });
  it("returns false for rects outside the default tolerance", () => {
    expect(rectsClose({ x: 0, y: 0, width: 100, height: 100 }, { x: 5, y: 0, width: 100, height: 100 })).toBe(false);
  });
});

describe("rectArea / rectContainsRect", () => {
  it("rectArea returns width * height for positive rects", () => {
    expect(rectArea({ x: 0, y: 0, width: 50, height: 40 })).toBe(2000);
  });
  it("rectArea returns 0 for negative dimensions", () => {
    expect(rectArea({ x: 0, y: 0, width: -10, height: -10 })).toBe(0);
  });
  it("rectContainsRect is true when inner is fully inside outer", () => {
    expect(
      rectContainsRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 10, y: 10, width: 50, height: 50 },
      ),
    ).toBe(true);
  });
  it("rectContainsRect is false when inner sticks out", () => {
    expect(
      rectContainsRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 80, y: 80, width: 50, height: 50 },
      ),
    ).toBe(false);
  });
});
