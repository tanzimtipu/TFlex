// Phase 10 — Edit-content reducer + model tests.
//
// Pure state transitions, no DOM, no IPC. The reducer is the
// single source of truth for the per-tab Edit state; every
// user gesture the overlay catches lands here before it reaches
// the engine.

import { describe, expect, it } from "vitest";
import {
  clamp,
  clampRectToPage,
  defaultEditTextStyle,
  defaultTextBoxRect,
  editOverlayActive,
  editReducer,
  initialEditState,
  type EditState,
  type ImagePlacement,
} from "../../../src/renderer/edit/model";

function makePlacement(overrides: Partial<ImagePlacement> = {}): ImagePlacement {
  return {
    id: "p-1",
    page: 1,
    rect: { x: 100, y: 100, width: 80, height: 60 },
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    format: "png",
    ...overrides,
  };
}

describe("editReducer — set-tool", () => {
  it("transitions from off to text without dropping placements", () => {
    const start: EditState = {
      ...initialEditState,
      placements: [makePlacement()],
    };
    const next = editReducer(start, { type: "set-tool", tool: "text" });
    expect(next.tool).toBe("text");
    expect(next.placements).toEqual(start.placements);
  });

  it("transitions to off and clears the selection", () => {
    const start: EditState = {
      ...initialEditState,
      tool: "image",
      selectedImage: { id: "p-1" },
    };
    const next = editReducer(start, { type: "set-tool", tool: "off" });
    expect(next.tool).toBe("off");
    expect(next.selectedImage).toBeNull();
    expect(next.pendingReplace).toBeNull();
  });

  it("preserves placements when closing the tool", () => {
    const start: EditState = {
      ...initialEditState,
      tool: "image",
      placements: [makePlacement(), makePlacement({ id: "p-2" })],
    };
    const next = editReducer(start, { type: "set-tool", tool: "off" });
    expect(next.placements).toHaveLength(2);
  });
});

describe("editReducer — select-image / cropping", () => {
  it("set-image-rect updates the matching placement", () => {
    const start: EditState = {
      ...initialEditState,
      tool: "image",
      placements: [makePlacement({ id: "a" }), makePlacement({ id: "b", rect: { x: 0, y: 0, width: 10, height: 10 } })],
    };
    const next = editReducer(start, { type: "set-image-rect", id: "b", rect: { x: 5, y: 5, width: 20, height: 20 } });
    const a = next.placements.find((p) => p.id === "a");
    const b = next.placements.find((p) => p.id === "b");
    expect(a?.rect).toEqual({ x: 100, y: 100, width: 80, height: 60 });
    expect(b?.rect).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it("select-image clears the cropping flag", () => {
    const start: EditState = { ...initialEditState, tool: "image", cropping: true };
    const next = editReducer(start, { type: "select-image", image: { id: "x" } });
    expect(next.cropping).toBe(false);
    expect(next.selectedImage).toEqual({ id: "x" });
  });

  it("set-cropping toggles the flag", () => {
    const start: EditState = { ...initialEditState, tool: "image" };
    const next = editReducer(start, { type: "set-cropping", cropping: true });
    expect(next.cropping).toBe(true);
  });
});

describe("editReducer — upsert / delete placement", () => {
  it("upsert adds a new placement when the id is unknown", () => {
    const next = editReducer(initialEditState, { type: "upsert-placement", placement: makePlacement() });
    expect(next.placements).toHaveLength(1);
  });

  it("upsert replaces an existing placement by id", () => {
    const start: EditState = { ...initialEditState, placements: [makePlacement({ rect: { x: 0, y: 0, width: 10, height: 10 } })] };
    const next = editReducer(start, {
      type: "upsert-placement",
      placement: makePlacement({ rect: { x: 5, y: 5, width: 20, height: 20 } }),
    });
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]?.rect).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it("delete-placement removes the matching id and clears the selection if it pointed at it", () => {
    const start: EditState = {
      ...initialEditState,
      tool: "image",
      placements: [makePlacement({ id: "a" }), makePlacement({ id: "b" })],
      selectedImage: { id: "a" },
    };
    const next = editReducer(start, { type: "delete-placement", id: "a" });
    expect(next.placements).toHaveLength(1);
    expect(next.placements[0]?.id).toBe("b");
    expect(next.selectedImage).toBeNull();
  });

  it("delete-placement keeps the selection when it points at a different id", () => {
    const start: EditState = {
      ...initialEditState,
      tool: "image",
      placements: [makePlacement({ id: "a" }), makePlacement({ id: "b" })],
      selectedImage: { id: "b" },
    };
    const next = editReducer(start, { type: "delete-placement", id: "a" });
    expect(next.selectedImage).toEqual({ id: "b" });
  });
});

describe("editReducer — reset", () => {
  it("drops everything back to the initial state", () => {
    const start: EditState = {
      tool: "image",
      selectedImage: { id: "p" },
      pendingReplace: null,
      placements: [makePlacement()],
      cropping: true,
    };
    const next = editReducer(start, { type: "reset" });
    expect(next).toEqual(initialEditState);
  });
});

describe("editOverlayActive / defaultEditTextStyle", () => {
  it("editOverlayActive is false only for off", () => {
    expect(editOverlayActive("off")).toBe(false);
    expect(editOverlayActive("text")).toBe(true);
    expect(editOverlayActive("box")).toBe(true);
    expect(editOverlayActive("image")).toBe(true);
  });

  it("defaultEditTextStyle returns a 12pt black style for the given font", () => {
    expect(defaultEditTextStyle("Helvetica")).toEqual({
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(defaultEditTextStyle("Times").font).toBe("Times");
    expect(defaultEditTextStyle("Courier").font).toBe("Courier");
  });
});

describe("clamp + clampRectToPage", () => {
  it("clamp is a no-op inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamp pins to the lower bound", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("clamp pins to the upper bound", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("clampRectToPage normalizes a rect that escapes the page", () => {
    expect(
      clampRectToPage({ x: -5, y: 100, width: 50, height: 30 }, 612, 792),
    ).toEqual({ x: 0, y: 100, width: 50, height: 30 });
    expect(
      clampRectToPage({ x: 600, y: 700, width: 50, height: 30 }, 612, 792),
    ).toEqual({ x: 600, y: 700, width: 12, height: 30 });
  });

  it("clampRectToPage preserves a valid in-bounds rect", () => {
    const r = clampRectToPage({ x: 100, y: 200, width: 80, height: 60 }, 612, 792);
    expect(r).toEqual({ x: 100, y: 200, width: 80, height: 60 });
  });
});

describe("defaultTextBoxRect", () => {
  it("clamps the box to the page so a near-edge drag still fits", () => {
    const r = defaultTextBoxRect({ x: 600, y: 770 }, 612, 792);
    // x + width must stay within the page
    expect(r.x + r.width).toBeLessThanOrEqual(612);
    expect(r.y + r.height).toBeLessThanOrEqual(792);
    // Reasonable lower bound so the box is large enough to be useful
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it("uses the default size when the page is small", () => {
    const r = defaultTextBoxRect({ x: 0, y: 0 }, 612, 792);
    // The default size is bounded by pageWidthPt * 0.25, pageHeightPt * 0.06.
    expect(r.width).toBeLessThanOrEqual(180);
    expect(r.height).toBeLessThanOrEqual(48);
  });
});
