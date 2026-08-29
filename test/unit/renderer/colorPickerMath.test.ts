// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hexToHsl,
  hslToHex,
  pickFromHueSlider,
  pickFromPad,
  type Hsl,
} from "../../../src/renderer/state/colorPalette";

describe("hslToHex", () => {
  it("returns pure red for (h=0, s=1, v=1)", () => {
    expect(hslToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
  });

  it("returns pure green for (h=120, s=1, v=1)", () => {
    expect(hslToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
  });

  it("returns pure blue for (h=240, s=1, v=1)", () => {
    expect(hslToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
  });

  it("returns white for (h=any, s=0, v=1)", () => {
    expect(hslToHex({ h: 0, s: 0, v: 1 })).toBe("#ffffff");
    expect(hslToHex({ h: 180, s: 0, v: 1 })).toBe("#ffffff");
    expect(hslToHex({ h: 300, s: 0, v: 1 })).toBe("#ffffff");
  });

  it("returns black for (h=any, s=any, v=0)", () => {
    expect(hslToHex({ h: 0, s: 1, v: 0 })).toBe("#000000");
    expect(hslToHex({ h: 200, s: 0, v: 0 })).toBe("#000000");
  });

  it("returns an exact mid-gray for s=0, v=0.5", () => {
    expect(hslToHex({ h: 0, s: 0, v: 0.5 })).toBe("#808080");
  });

  it("clamps s > 1 and s < 0 instead of overflowing", () => {
    expect(hslToHex({ h: 0, s: 2, v: 1 })).toBe("#ff0000");
    expect(hslToHex({ h: 0, s: -3, v: 1 })).toBe("#ffffff");
  });

  it("clamps v > 1 and v < 0 instead of overflowing", () => {
    expect(hslToHex({ h: 0, s: 1, v: 2 })).toBe("#ff0000");
    expect(hslToHex({ h: 0, s: 1, v: -1 })).toBe("#000000");
  });

  it("wraps negative hues by adding 360", () => {
    // -120 is equivalent to 240 (pure blue).
    expect(hslToHex({ h: -120, s: 1, v: 1 })).toBe(
      hslToHex({ h: 240, s: 1, v: 1 }),
    );
  });

  it("wraps hues > 360 by subtracting 360", () => {
    expect(hslToHex({ h: 480, s: 1, v: 1 })).toBe(
      hslToHex({ h: 120, s: 1, v: 1 }),
    );
  });

  it("produces six evenly spaced hexes around the wheel", () => {
    // 0, 60, 120, 180, 240, 300 should be red, yellow, green, cyan,
    // blue, magenta.
    const expected = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
    for (let i = 0; i < 6; i += 1) {
      expect(hslToHex({ h: i * 60, s: 1, v: 1 })).toBe(expected[i]);
    }
  });
});

describe("hexToHsl", () => {
  it("parses pure red back into (h≈0, s=1, v=1)", () => {
    const out = hexToHsl("#ff0000");
    expect(out).not.toBeNull();
    // Hue wraps to either 0 or 360; both are equivalent.
    expect(out!.h === 0 || out!.h === 360).toBe(true);
    expect(out!.s).toBeCloseTo(1, 5);
    expect(out!.v).toBeCloseTo(1, 5);
  });

  it("parses pure green back into (h≈120, s=1, v=1)", () => {
    const out = hexToHsl("#00ff00");
    expect(out).not.toBeNull();
    expect(out!.h).toBeCloseTo(120, 5);
    expect(out!.s).toBeCloseTo(1, 5);
    expect(out!.v).toBeCloseTo(1, 5);
  });

  it("parses pure blue back into (h≈240, s=1, v=1)", () => {
    const out = hexToHsl("#0000ff");
    expect(out).not.toBeNull();
    expect(out!.h).toBeCloseTo(240, 5);
    expect(out!.s).toBeCloseTo(1, 5);
    expect(out!.v).toBeCloseTo(1, 5);
  });

  it("parses white into (s=0, v=1) at any hue", () => {
    const out = hexToHsl("#ffffff");
    expect(out).not.toBeNull();
    expect(out!.s).toBe(0);
    expect(out!.v).toBe(1);
  });

  it("parses black into (s=0, v=0) at any hue", () => {
    const out = hexToHsl("#000000");
    expect(out).not.toBeNull();
    expect(out!.s).toBe(0);
    expect(out!.v).toBe(0);
  });

  it("parses mid-gray (#808080) as (s=0, v=0.5)", () => {
    const out = hexToHsl("#808080");
    expect(out).not.toBeNull();
    expect(out!.s).toBe(0);
    expect(out!.v).toBeCloseTo(128 / 255, 5);
  });

  it("expands a #rgb hex before parsing", () => {
    // #abc == #aabbcc.
    expect(hexToHsl("#abc")).toEqual(hexToHsl("#aabbcc"));
  });

  it("returns null on garbage", () => {
    expect(hexToHsl("not a color")).toBeNull();
    expect(hexToHsl("#xyz")).toBeNull();
    expect(hexToHsl("#1234567")).toBeNull();
    expect(hexToHsl("")).toBeNull();
  });

  it("round-trips hslToHex → hexToHsl for a spread of hues", () => {
    const samples: Hsl[] = [
      { h: 0, s: 1, v: 1 },
      { h: 30, s: 0.7, v: 0.9 },
      { h: 60, s: 1, v: 1 },
      { h: 137, s: 0.55, v: 0.45 },
      { h: 195, s: 0.8, v: 0.8 },
      { h: 240, s: 1, v: 1 },
      { h: 310, s: 0.5, v: 0.65 },
      { h: 359, s: 1, v: 1 },
    ];
    for (const sample of samples) {
      const hex = hslToHex(sample);
      const back = hexToHsl(hex);
      expect(back).not.toBeNull();
      // The round-trip loses 1 LSB of precision per channel (rgb 0..255
      // → hsl back to rgb), so allow ~3/255 worth of hue drift when
      // saturation and value are high; more lenient at low saturation
      // (the hue is ill-defined near gray, so it's allowed to be off).
      const hueDrift = Math.min(
        Math.abs((back!.h - sample.h + 360) % 360),
        Math.abs((sample.h - back!.h + 360) % 360),
      );
      const tolerance = sample.s < 0.05 ? 180 : 5;
      expect(hueDrift).toBeLessThanOrEqual(tolerance);
      expect(back!.s).toBeCloseTo(sample.s, 1);
      expect(back!.v).toBeCloseTo(sample.v, 1);
    }
  });
});

describe("pickFromPad", () => {
  it("returns s=0, v=1 at the top-left corner (white)", () => {
    expect(pickFromPad(0, 0, 200, 200)).toEqual({ s: 0, v: 1 });
  });

  it("returns s=1, v=1 at the top-right corner (pure hue)", () => {
    expect(pickFromPad(200, 0, 200, 200)).toEqual({ s: 1, v: 1 });
  });

  it("returns s=0, v=0 at the bottom-left corner (black)", () => {
    expect(pickFromPad(0, 200, 200, 200)).toEqual({ s: 0, v: 0 });
  });

  it("returns s=1, v=0 at the bottom-right corner", () => {
    expect(pickFromPad(200, 200, 200, 200)).toEqual({ s: 1, v: 0 });
  });

  it("returns s=0.5 at the horizontal center", () => {
    expect(pickFromPad(100, 50, 200, 200).s).toBeCloseTo(0.5, 5);
  });

  it("returns v=0.5 at the vertical center", () => {
    expect(pickFromPad(50, 100, 200, 200).v).toBeCloseTo(0.5, 5);
  });

  it("clamps negative x and y to the edges", () => {
    expect(pickFromPad(-50, -50, 200, 200)).toEqual({ s: 0, v: 1 });
  });

  it("clamps over-large x and y to the edges", () => {
    expect(pickFromPad(9999, 9999, 200, 200)).toEqual({ s: 1, v: 0 });
  });

  it("clamps independently in x and y", () => {
    expect(pickFromPad(-10, 9999, 200, 200)).toEqual({ s: 0, v: 0 });
    expect(pickFromPad(9999, -10, 200, 200)).toEqual({ s: 1, v: 1 });
  });

  it("returns s=0, v=1 when the pad has zero size (defensive)", () => {
    expect(pickFromPad(50, 50, 0, 0)).toEqual({ s: 0, v: 1 });
    expect(pickFromPad(50, 50, 0, 200)).toEqual({ s: 0, v: 1 });
    expect(pickFromPad(50, 50, 200, 0)).toEqual({ s: 0, v: 1 });
  });
});

describe("pickFromHueSlider", () => {
  it("returns 0 at the left edge", () => {
    expect(pickFromHueSlider(0, 360)).toBe(0);
  });

  it("returns 180 at the horizontal middle", () => {
    expect(pickFromHueSlider(180, 360)).toBe(180);
  });

  it("returns 360 at the right edge", () => {
    expect(pickFromHueSlider(360, 360)).toBe(360);
  });

  it("clamps x < 0 to the left edge", () => {
    expect(pickFromHueSlider(-50, 360)).toBe(0);
  });

  it("clamps x > width to the right edge", () => {
    expect(pickFromHueSlider(9999, 360)).toBe(360);
  });

  it("returns 0 when the slider has zero width (defensive)", () => {
    expect(pickFromHueSlider(50, 0)).toBe(0);
  });

  it("scales linearly across arbitrary widths", () => {
    expect(pickFromHueSlider(100, 400)).toBe(90);
    expect(pickFromHueSlider(50, 100)).toBe(180);
  });
});

describe("end-to-end pad pick at a fixed hue", () => {
  // The pad picks saturation / value only; the hue comes from the
  // slider. Composing pickFromPad with hslToHex at a fixed hue gives
  // the user-visible "I clicked here" color. Pinning a few known
  // samples here locks the contract between the geometry and the
  // visual output.

  it("top-left of the pad = white regardless of hue", () => {
    for (const h of [0, 90, 180, 270]) {
      const { s, v } = pickFromPad(0, 0, 200, 200);
      expect(hslToHex({ h, s, v })).toBe("#ffffff");
    }
  });

  it("bottom-left of the pad = black regardless of hue", () => {
    for (const h of [0, 90, 180, 270]) {
      const { s, v } = pickFromPad(0, 200, 200, 200);
      expect(hslToHex({ h, s, v })).toBe("#000000");
    }
  });

  it("top-right of the pad = the pure hue", () => {
    expect(hslToHex({ h: 0, ...pickFromPad(200, 0, 200, 200) })).toBe("#ff0000");
    expect(hslToHex({ h: 120, ...pickFromPad(200, 0, 200, 200) })).toBe("#00ff00");
    expect(hslToHex({ h: 240, ...pickFromPad(200, 0, 200, 200) })).toBe("#0000ff");
  });

  it("mid-pad at hue=240 lands on a mid-saturation blue", () => {
    // (s=0.5, v=0.5, h=240) → a darker, desaturated blue.
    const hex = hslToHex({ h: 240, ...pickFromPad(100, 100, 200, 200) });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    // Sanity: hue is still in the blue family — the blue channel
    // dominates over red and green.
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});