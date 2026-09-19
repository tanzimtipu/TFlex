// Phase 21 — text-style value model + edit-reducer style-update tests.
//
// Pure unit coverage for the panel's value conversions (selection-aware
// defaults, preserve-if-valid patch merge, clamps) and the new
// `patch-text-box-style` reducer action that keeps the renderer mirror in
// sync with the engine.

import { describe, expect, it } from "vitest";
import {
  applyPatchToValues,
  defaultTextStyleValues,
  editTextStyleFromValues,
  isNoHighlight,
  textStyleValuesFromStyle,
  valuesToPatch,
  clampFontSize,
  clampIndent,
  clampLineHeight,
  editColorToHex,
  TEXT_NO_HIGHLIGHT,
} from "../../../src/renderer/edit/textStyle";
import {
  editReducer,
  engineTextBoxesToPlacements,
  initialEditState,
  sameTextBoxes,
  type EditState,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";

function placement(overrides: Partial<TextBoxPlacement> = {}): TextBoxPlacement {
  return {
    id: "tb-1",
    page: 1,
    rect: { x: 10, y: 10, width: 100, height: 30 },
    text: "hello",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "none",
    ...overrides,
  };
}

describe("Phase 21 — text-style value model", () => {
  it("falls back to the documented defaults for every absent field", () => {
    const v = textStyleValuesFromStyle({ font: "Times", size: 9, color: { r: 0, g: 0, b: 1 } });
    expect(v.bold).toBe(false);
    expect(v.italic).toBe(false);
    expect(v.underline).toBe(false);
    expect(v.align).toBe("left");
    expect(v.lineHeight).toBe(1.2);
    expect(v.list).toBe("none");
    expect(v.indent).toBe(0);
    expect(v.baselineShift).toBe(0);
    expect(v.highlight).toBeNull();
  });

  it("normalises the white no-highlight sentinel back to null", () => {
    const v = textStyleValuesFromStyle({
      font: "Helvetica",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
      highlight: { ...TEXT_NO_HIGHLIGHT },
    });
    expect(v.highlight).toBeNull();
    expect(isNoHighlight(undefined)).toBe(true);
    expect(isNoHighlight({ r: 0, g: 0, b: 0 })).toBe(false);
  });

  it("merges a patch preserve-if-valid and clamps supplied values", () => {
    const v = applyPatchToValues(defaultTextStyleValues("Helvetica"), {
      bold: true,
      size: 9000,
      lineHeight: 0.1,
      indent: 999,
      baselineShift: -900,
      align: "justify",
      list: "number",
    });
    expect(v.bold).toBe(true);
    expect(v.size).toBe(2000);
    expect(v.lineHeight).toBe(0.5);
    expect(v.indent).toBe(200);
    expect(v.baselineShift).toBe(-200);
    expect(v.align).toBe("justify");
    expect(v.list).toBe("number");
    // Untouched fields keep their previous value.
    expect(v.italic).toBe(false);
    expect(v.font).toBe("Helvetica");
  });

  it("valuesToPatch writes every field and represents no-highlight as a null removal", () => {
    const patch = valuesToPatch(defaultTextStyleValues("Courier"));
    expect(patch.font).toBe("Courier");
    expect(patch.size).toBe(12);
    expect(patch.highlight).toBeNull();
    expect(patch.align).toBe("left");
    expect(patch.lineHeight).toBe(1.2);
  });

  it("clamps each bounded field", () => {
    expect(clampFontSize(0)).toBe(1);
    expect(clampFontSize(1e6)).toBe(2000);
    expect(clampLineHeight(0)).toBe(0.5);
    expect(clampLineHeight(99)).toBe(5);
    expect(clampIndent(-10)).toBe(0);
    expect(clampIndent(500)).toBe(200);
  });

  it("serialises EditColor to #rrggbb", () => {
    expect(editColorToHex({ r: 1, g: 0.5, b: 0 })).toBe("#ff8000");
  });

  it("drops the band on an explicit highlight: null and preserves on absent", () => {
    const withBand = applyPatchToValues(defaultTextStyleValues("Helvetica"), {
      highlight: { r: 1, g: 1, b: 0 },
    });
    expect(withBand.highlight).toEqual({ r: 1, g: 1, b: 0 });
    // Explicit removal.
    expect(applyPatchToValues(withBand, { highlight: null }).highlight).toBeNull();
    // Absent preserves.
    expect(applyPatchToValues(withBand, { bold: true }).highlight).toEqual({ r: 1, g: 1, b: 0 });
  });

  it("threads a pending no-selection edit into the creation style (addTextBox path)", () => {
    const pending = applyPatchToValues(defaultTextStyleValues("Helvetica"), {
      size: 24,
      color: { r: 1, g: 0, b: 0 },
      align: "center",
      highlight: { r: 1, g: 1, b: 0 },
    });
    const creationStyle = editTextStyleFromValues(pending);
    expect(creationStyle.font).toBe("Helvetica");
    expect(creationStyle.size).toBe(24);
    expect(creationStyle.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(creationStyle.align).toBe("center");
    expect(creationStyle.highlight).toEqual({ r: 1, g: 1, b: 0 });
    // A removed band is OMITTED from the creation payload (the model /
    // payload fields keep `EditColor`; removal is a patch operation only).
    const noBand = editTextStyleFromValues(applyPatchToValues(pending, { highlight: null }));
    expect("highlight" in noBand).toBe(false);
  });
});

describe("Phase 21 — reducer style update", () => {
  it("applies a patch to the matching committed box only", () => {
    const state: EditState = {
      ...initialEditState,
      textBoxes: [placement(), placement({ id: "tb-2" })],
      selectedTextBox: "tb-1",
    };
    const next = editReducer(state, {
      type: "patch-text-box-style",
      id: "tb-1",
      patch: { bold: true, align: "center", size: 24, highlight: { r: 1, g: 1, b: 0 } },
    });
    const one = next.textBoxes.find((b) => b.id === "tb-1");
    const two = next.textBoxes.find((b) => b.id === "tb-2");
    expect(one?.style.bold).toBe(true);
    expect(one?.style.align).toBe("center");
    expect(one?.style.size).toBe(24);
    expect(one?.style.highlight).toEqual({ r: 1, g: 1, b: 0 });
    expect(two?.style.bold).toBeUndefined();
  });

  it("drops the band from the local mirror on an explicit highlight: null", () => {
    const withBand = placement({
      style: { ...placement().style, highlight: { r: 1, g: 1, b: 0 } },
    });
    const state: EditState = {
      ...initialEditState,
      textBoxes: [withBand],
      selectedTextBox: "tb-1",
    };
    const next = editReducer(state, {
      type: "patch-text-box-style",
      id: "tb-1",
      patch: { highlight: null },
    });
    expect(next.textBoxes[0]?.style.highlight).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    const state: EditState = { ...initialEditState, textBoxes: [placement()] };
    const next = editReducer(state, {
      type: "patch-text-box-style",
      id: "missing",
      patch: { bold: true },
    });
    expect(next).toBe(state);
  });

  it("sameTextBoxes detects a style-only change", () => {
    const a = [placement()];
    const b = [placement({ style: { ...a[0].style, bold: true } })];
    expect(sameTextBoxes(a, b)).toBe(false);
    expect(sameTextBoxes(a, [placement()])).toBe(true);
  });

  it("engineTextBoxesToPlacements carries the Phase-21 style fields", () => {
    const out = engineTextBoxesToPlacements(
      [
        {
          id: "e1",
          page: 2,
          rect: { x: 1, y: 2, width: 3, height: 4 },
          text: "x",
          font: "Times",
          size: 15,
          color: "#ff0000",
          bold: true,
          align: "right",
          lineHeight: 1.4,
          highlight: { r: 0, g: 1, b: 0 },
          list: "bullet",
          indent: 12,
        },
      ],
      "Helvetica",
    );
    expect(out[0]?.style.bold).toBe(true);
    expect(out[0]?.style.align).toBe("right");
    expect(out[0]?.style.lineHeight).toBe(1.4);
    expect(out[0]?.style.highlight).toEqual({ r: 0, g: 1, b: 0 });
    expect(out[0]?.style.list).toBe("bullet");
    expect(out[0]?.style.indent).toBe(12);
  });
});
