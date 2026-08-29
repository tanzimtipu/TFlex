// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECENTS_CAP,
  MAX_RECENTS_CAP,
  MIN_RECENTS_CAP,
  clampRecentsCap,
  preferencesReducer,
} from "../../../src/renderer/state/preferences";
import type { AppSettings } from "../../../src/shared/types";

const makeSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  theme: "dark",
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  ...overrides,
});

describe("preferencesReducer.set-theme-default", () => {
  it("stores the new default", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, { type: "set-theme-default", value: "light" });
    expect(next.themeDefault).toBe("light");
  });
  it("is a no-op when the default is unchanged", () => {
    const s = makeSettings({ themeDefault: "dark" });
    const next = preferencesReducer(s, { type: "set-theme-default", value: "dark" });
    expect(next).toBe(s);
  });
});

describe("preferencesReducer.set-recents-cap", () => {
  it("clamps to the supported range", () => {
    const s = makeSettings();
    const below = preferencesReducer(s, { type: "set-recents-cap", value: 0 });
    expect(below.recentsCap).toBe(MIN_RECENTS_CAP);
    const above = preferencesReducer(s, { type: "set-recents-cap", value: 999 });
    expect(above.recentsCap).toBe(MAX_RECENTS_CAP);
  });
  it("rounds fractional input", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, { type: "set-recents-cap", value: 7.6 });
    expect(next.recentsCap).toBe(7);
  });
  it("is a no-op when the cap equals the current value", () => {
    const s = makeSettings({ recentsCap: 10 });
    const next = preferencesReducer(s, { type: "set-recents-cap", value: 10 });
    expect(next).toBe(s);
  });
});

describe("preferencesReducer.set-tools-palette-layout", () => {
  it("stores the new layout", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-tools-palette-layout",
      value: "grid",
    });
    expect(next.toolsPaletteLayout).toBe("grid");
  });
  it("is a no-op when the layout is unchanged", () => {
    const s = makeSettings({ toolsPaletteLayout: "list" });
    const next = preferencesReducer(s, {
      type: "set-tools-palette-layout",
      value: "list",
    });
    expect(next).toBe(s);
  });
});

describe("preferencesReducer.set-optimize-preset", () => {
  it("stores the new preset", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-optimize-preset",
      value: "compact",
    });
    expect(next.optimizePreset).toBe("compact");
  });
  it("switches from 'none' (the default) to 'compact'", () => {
    // The default is 'none' and is implicit (the field is absent from
    // AppSettings until the user picks something else). Verify that a
    // user-driven switch to 'compact' persists the value.
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-optimize-preset",
      value: "compact",
    });
    expect(next.optimizePreset).toBe("compact");
    expect(next).not.toBe(s);
  });
  it("accepts 'max' as a valid preset", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-optimize-preset",
      value: "max",
    });
    expect(next.optimizePreset).toBe("max");
  });
  it("is a no-op when the preset is unchanged", () => {
    const s = makeSettings({ optimizePreset: "compact" });
    const next = preferencesReducer(s, {
      type: "set-optimize-preset",
      value: "compact",
    });
    expect(next).toBe(s);
  });
});

describe("clampRecentsCap", () => {
  it("clamps below the minimum", () => {
    expect(clampRecentsCap(-5)).toBe(MIN_RECENTS_CAP);
  });
  it("clamps above the maximum", () => {
    expect(clampRecentsCap(999)).toBe(MAX_RECENTS_CAP);
  });
  it("rounds fractions", () => {
    expect(clampRecentsCap(5.9)).toBe(5);
  });
});

describe("constants", () => {
  it("default recents cap is sane", () => {
    expect(DEFAULT_RECENTS_CAP).toBeGreaterThanOrEqual(MIN_RECENTS_CAP);
    expect(DEFAULT_RECENTS_CAP).toBeLessThanOrEqual(MAX_RECENTS_CAP);
  });
});