// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  EMPTY_ANNOTATION_COLORS,
  makePresetId,
  normalizeHex,
  parseRgb,
  reducer as paletteReducer,
} from "../../../src/renderer/state/colorPalette";

describe("normalizeHex", () => {
  it("accepts 6-digit hex with leading hash and lowercases it", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
  });
  it("accepts 6-digit hex without leading hash and adds it", () => {
    expect(normalizeHex("AABBCC")).toBe("#aabbcc");
  });
  it("expands 3-digit hex to 6-digit form", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
  });
  it("rejects malformed input", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("not a color")).toBeNull();
    expect(normalizeHex("#xyz")).toBeNull();
    expect(normalizeHex("#1234567")).toBeNull();
  });
});

describe("parseRgb", () => {
  it("parses rgb(r, g, b) into hex", () => {
    expect(parseRgb("rgb(170, 187, 204)")).toBe("#aabbcc");
  });
  it("parses rgba(r, g, b, a) ignoring alpha", () => {
    expect(parseRgb("rgba(170, 187, 204, 0.5)")).toBe("#aabbcc");
  });
  it("clamps out-of-range bytes", () => {
    expect(parseRgb("rgb(300, -10, 128)")).toBe("#ff0080");
  });
  it("rejects malformed input", () => {
    expect(parseRgb("not rgb")).toBeNull();
    expect(parseRgb("rgb()")).toBeNull();
    expect(parseRgb("rgb(1,2)")).toBeNull();
  });
});

describe("paletteReducer.add", () => {
  it("appends a preset to the active theme bucket", () => {
    const start = EMPTY_ANNOTATION_COLORS;
    const next = paletteReducer(start, { type: "add", theme: "dark", hex: "#123456" });
    expect(next.dark).toHaveLength(1);
    expect(next.dark[0]?.hex).toBe("#123456");
    expect(next.dark[0]?.id).toBeDefined();
    expect(next.light).toHaveLength(0);
  });
  it("is idempotent for already-present hexes", () => {
    const start = paletteReducer(EMPTY_ANNOTATION_COLORS, {
      type: "add",
      theme: "light",
      hex: "#abcdef",
    });
    const next = paletteReducer(start, { type: "add", theme: "light", hex: "#ABCDEF" });
    expect(next).toBe(start);
  });
  it("rejects malformed hex and returns the same reference", () => {
    const start = EMPTY_ANNOTATION_COLORS;
    const next = paletteReducer(start, { type: "add", theme: "light", hex: "not a color" });
    expect(next).toBe(start);
  });
});

describe("paletteReducer.remove", () => {
  it("drops the preset with the matching id", () => {
    const a = paletteReducer(EMPTY_ANNOTATION_COLORS, { type: "add", theme: "dark", hex: "#111111" });
    const b = paletteReducer(a, { type: "add", theme: "dark", hex: "#222222" });
    const id = b.dark[0]?.id;
    expect(id).toBeDefined();
    const next = paletteReducer(b, { type: "remove", theme: "dark", id });
    expect(next.dark).toHaveLength(1);
    expect(next.dark[0]?.hex).toBe("#222222");
  });
  it("is a no-op when the id isn't present", () => {
    const start = paletteReducer(EMPTY_ANNOTATION_COLORS, {
      type: "add",
      theme: "light",
      hex: "#abcdef",
    });
    const next = paletteReducer(start, { type: "remove", theme: "light", id: "missing" });
    expect(next).toBe(start);
  });
});

describe("paletteReducer.replace", () => {
  it("replaces the bucket with a fresh list", () => {
    const start = paletteReducer(EMPTY_ANNOTATION_COLORS, {
      type: "add",
      theme: "dark",
      hex: "#111111",
    });
    const replacement = [{ id: "p1", hex: "#222222" }];
    const next = paletteReducer(start, { type: "replace", theme: "dark", presets: replacement });
    expect(next.dark).toEqual(replacement);
    // Old entry gone.
    expect(next.dark.find((p) => p.hex === "#111111")).toBeUndefined();
  });
  it("is idempotent when the incoming list matches the existing one", () => {
    const seeded = paletteReducer(EMPTY_ANNOTATION_COLORS, {
      type: "add",
      theme: "light",
      hex: "#abcdef",
    });
    const incoming = seeded.light.map((p) => ({ id: p.id, hex: p.hex }));
    const next = paletteReducer(seeded, { type: "replace", theme: "light", presets: incoming });
    expect(next).toBe(seeded);
  });
});

describe("makePresetId", () => {
  it("returns a non-empty string", () => {
    expect(makePresetId("#aabbcc").length).toBeGreaterThan(0);
  });
});