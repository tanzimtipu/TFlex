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
  engineTextBoxesToPlacements,
  hexToEditColor,
  initialEditState,
  sameTextBoxes,
  type EditState,
  type ImagePlacement,
  type TextBoxPlacement,
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
      selectedTextBox: "t",
      pendingReplace: null,
      placements: [makePlacement()],
      textBoxes: [],
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

describe("editReducer — B5 text-box registry", () => {
  function makeTextBox(overrides: Partial<TextBoxPlacement> = {}): TextBoxPlacement {
    return {
      id: "tb-1",
      page: 1,
      rect: { x: 100, y: 100, width: 180, height: 40 },
      text: "Hello box",
      style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
      background: "white",
      ...overrides,
    };
  }

  it("upsert-text-box appends a new committed box", () => {
    const state = initialEditState;
    const next = editReducer(state, { type: "upsert-text-box", placement: makeTextBox() });
    expect(next.textBoxes).toHaveLength(1);
    expect(next.textBoxes[0]?.text).toBe("Hello box");
  });

  it("upsert-text-box replaces an existing box with the same id", () => {
    const state: EditState = {
      ...initialEditState,
      textBoxes: [makeTextBox()],
    };
    const next = editReducer(state, {
      type: "upsert-text-box",
      placement: makeTextBox({ text: "Updated" }),
    });
    expect(next.textBoxes).toHaveLength(1);
    expect(next.textBoxes[0]?.text).toBe("Updated");
  });

  it("set-text-box-rect moves only the target box's rect", () => {
    const state: EditState = {
      ...initialEditState,
      textBoxes: [makeTextBox({ id: "tb-a" }), makeTextBox({ id: "tb-b" })],
    };
    const next = editReducer(state, {
      type: "set-text-box-rect",
      id: "tb-b",
      rect: { x: 300, y: 120, width: 180, height: 40 },
    });
    expect(next.textBoxes[0]?.rect.x).toBe(100); // unaffected
    expect(next.textBoxes[1]?.rect).toEqual({ x: 300, y: 120, width: 180, height: 40 });
  });

  it("set-text-box-rect is a no-op for an unknown id", () => {
    const state: EditState = { ...initialEditState, textBoxes: [makeTextBox()] };
    const next = editReducer(state, {
      type: "set-text-box-rect",
      id: "missing",
      rect: { x: 9, y: 9, width: 9, height: 9 },
    });
    expect(next).toBe(state);
    expect(next.textBoxes[0]?.rect.x).toBe(100);
  });

  it("select-text-box records the selection and clears cropping", () => {
    const state: EditState = { ...initialEditState, cropping: true };
    const next = editReducer(state, { type: "select-text-box", textBoxId: "tb-1" });
    expect(next.selectedTextBox).toBe("tb-1");
    expect(next.cropping).toBe(false);
  });

  it("set-tool off clears the text-box selection but preserves the registry", () => {
    const state: EditState = {
      ...initialEditState,
      tool: "box",
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    };
    const next = editReducer(state, { type: "set-tool", tool: "off" });
    expect(next.selectedTextBox).toBeNull();
    expect(next.textBoxes).toHaveLength(1);
  });

  it("delete-text-box removes the box and clears its selection (DEF-135/136)", () => {
    const state: EditState = {
      ...initialEditState,
      selectedTextBox: "tb-2",
      textBoxes: [makeTextBox({ id: "tb-1" }), makeTextBox({ id: "tb-2" })],
    };
    const next = editReducer(state, { type: "delete-text-box", id: "tb-2" });
    expect(next.textBoxes).toHaveLength(1);
    expect(next.textBoxes[0]?.id).toBe("tb-1");
    // The deleted box was selected -> selection cleared.
    expect(next.selectedTextBox).toBeNull();
  });

  it("delete-text-box keeps the selection when a different box is deleted", () => {
    const state: EditState = {
      ...initialEditState,
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox({ id: "tb-1" }), makeTextBox({ id: "tb-2" })],
    };
    const next = editReducer(state, { type: "delete-text-box", id: "tb-2" });
    expect(next.textBoxes).toHaveLength(1);
    expect(next.selectedTextBox).toBe("tb-1");
  });

  it("replace-text-boxes adopts the engine list verbatim (DEF-135/136)", () => {
    const state: EditState = {
      ...initialEditState,
      selectedTextBox: "eng-1",
      textBoxes: [makeTextBox(), makeTextBox({ id: "tb-2", page: 2 })],
    };
    const next = editReducer(state, {
      type: "replace-text-boxes",
      boxes: [
        makeTextBox({ id: "eng-1", text: "From engine" }),
        makeTextBox({ id: "eng-2" }),
      ],
    });
    expect(next.textBoxes.map((b) => b.id)).toEqual(["eng-1", "eng-2"]);
    expect(next.textBoxes[0]?.text).toBe("From engine");
    // The still-present engine-named selection survives.
    expect(next.selectedTextBox).toBe("eng-1");
  });

  it("replace-text-boxes clears a selection whose box vanished", () => {
    const state: EditState = {
      ...initialEditState,
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    };
    const next = editReducer(state, {
      type: "replace-text-boxes",
      boxes: [makeTextBox({ id: "tb-2" })],
    });
    expect(next.selectedTextBox).toBeNull();
  });
});

describe("DEF-135/136 — engine text-box registry mirror", () => {
  it("engineTextBoxesToPlacements keeps the engine id and parses the hex color", () => {
    const placements = engineTextBoxesToPlacements(
      [
        {
          id: "eng-1",
          page: 2,
          rect: { x: 10, y: 20, width: 180, height: 40 },
          text: "Signed",
          font: "Times",
          size: 14,
          color: "#ff0000",
          background: "white",
        },
      ],
      "Helvetica",
    );
    expect(placements).toHaveLength(1);
    const p = placements[0];
    expect(p).toMatchObject({
      id: "eng-1",
      page: 2,
      rect: { x: 10, y: 20, width: 180, height: 40 },
      text: "Signed",
      background: "white",
    });
    expect(p.style).toEqual({ font: "Times", size: 14, color: { r: 1, g: 0, b: 0 } });
  });

  it("engineTextBoxesToPlacements fills missing style from the default font", () => {
    const placements = engineTextBoxesToPlacements(
      [
        {
          id: "eng-2",
          page: 1,
          rect: { x: 0, y: 0, width: 100, height: 30 },
          text: "Bare",
        },
      ],
      "Courier",
    );
    expect(placements[0]?.style).toEqual({
      font: "Courier",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(placements[0]?.background).toBe("none");
  });

  it("hexToEditColor parses #rrggbb and falls back to black on garbage", () => {
    expect(hexToEditColor("#00ff80")).toEqual({
      r: 0,
      g: 1,
      b: 128 / 255,
    });
    expect(hexToEditColor(undefined)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToEditColor("red")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToEditColor("#fff")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("sameTextBoxes is true only for fully-equivalent lists", () => {
    const a = engineTextBoxesToPlacements(
      [{ id: "e1", page: 1, rect: { x: 1, y: 2, width: 3, height: 4 }, text: "hi", color: "#000000" }],
      "Helvetica",
    );
    const b = engineTextBoxesToPlacements(
      [{ id: "e1", page: 1, rect: { x: 1, y: 2, width: 3, height: 4 }, text: "hi", color: "#000000" }],
      "Helvetica",
    );
    expect(sameTextBoxes(a, b)).toBe(true);
    const moved = engineTextBoxesToPlacements(
      [{ id: "e1", page: 1, rect: { x: 9, y: 2, width: 3, height: 4 }, text: "hi", color: "#000000" }],
      "Helvetica",
    );
    expect(sameTextBoxes(a, moved)).toBe(false);
    expect(sameTextBoxes(a, [])).toBe(false);
  });
});
