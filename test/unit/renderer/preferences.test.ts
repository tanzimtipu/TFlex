// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATE_IMAGE_QUALITY,
  DEFAULT_EXPORT_IMAGE_DPI,
  DEFAULT_EXPORT_IMAGE_FORMAT,
  DEFAULT_RECENTS_CAP,
  EXPORT_IMAGE_FORMATS,
  MAX_RECENTS_CAP,
  MIN_RECENTS_CAP,
  clampCreateImageQuality,
  clampExportImageDpi,
  clampRecentsCap,
  preferencesReducer,
  qualityFractionToPercent,
  qualityPercentToFraction,
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

// ---------------------------------------------------------------------------
// Phase 9 — Export image format / DPI / create-image-quality settings
//
// The orchestrator-pinned contract for the AppSettings export +
// create settings:
//   - exportImageFormat is the canonical wire shape (Phase 9 spec);
//     the reducer persists the user's choice across launches.
//   - exportImageDpi is clamped to [72, 600] before persistence.
//   - createImageQuality is stored as a fraction (0..1) so the
//     wire shape matches the backend's `normalizeSettings`
//     validation. Earlier iterations stored an integer percentage
//     [10..100] and the backend's reject-if-invalid pipeline dropped
//     the value on read (DEF-047); the renderer now rounds to 3
//     decimal places on persist so the on-disk value is stable.
//   - All three are preserved across renders without changes (the
//     reducer's equality guard no-ops equal values).
// ---------------------------------------------------------------------------

describe("preferencesReducer.set-export-image-format", () => {
  it("stores the new format", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-format",
      value: "jpeg",
    });
    expect(next.exportImageFormat).toBe("jpeg");
  });
  it("accepts every value in EXPORT_IMAGE_FORMATS", () => {
    for (const f of EXPORT_IMAGE_FORMATS) {
      const s = makeSettings();
      const next = preferencesReducer(s, {
        type: "set-export-image-format",
        value: f,
      });
      expect(next.exportImageFormat).toBe(f);
    }
  });
  it("drops unknown values (preserve-if-valid)", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      // Defensive: a future backend bug ships a value the
      // allowlist doesn't recognise. The reducer must ignore it
      // rather than persisting an invalid value to disk.
      type: "set-export-image-format",
      value: "webp" as never,
    });
    expect(next).toBe(s);
  });
  it("accepts TIFF as a valid Phase 9+ format", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-format",
      value: "tiff",
    });
    expect(next.exportImageFormat).toBe("tiff");
  });
  it("is a no-op when the format is unchanged", () => {
    const s = makeSettings({ exportImageFormat: "png" });
    const next = preferencesReducer(s, {
      type: "set-export-image-format",
      value: "png",
    });
    expect(next).toBe(s);
  });
  it("the first user write materialises the field", () => {
    // Same pattern as the dpi / quality tests: AppSettings is
    // optional, the first user-driven write should land on disk
    // even when the value matches the default.
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-format",
      value: "png",
    });
    expect(next.exportImageFormat).toBe("png");
    expect(next).not.toBe(s);
  });
});

describe("preferencesReducer.set-export-image-dpi", () => {
  it("clamps below the minimum", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-dpi",
      value: 10,
    });
    expect(next.exportImageDpi).toBe(72);
  });
  it("clamps above the maximum", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-dpi",
      value: 1500,
    });
    expect(next.exportImageDpi).toBe(600);
  });
  it("rounds fractional input", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-dpi",
      value: 150.7,
    });
    expect(next.exportImageDpi).toBe(151);
  });
  it("is a no-op when the dpi equals the current value", () => {
    const s = makeSettings({ exportImageDpi: 150 });
    const next = preferencesReducer(s, {
      type: "set-export-image-dpi",
      value: 150,
    });
    expect(next).toBe(s);
  });
  it("the first user write materialises the field (no implicit default)", () => {
    // AppSettings.exportImageDpi is optional. The first user-driven
    // write should always land on disk — even when the value is the
    // default — so the backend's preserve-if-valid pipeline sees an
    // explicit value. Without this, the field stays undefined until
    // the user deviates from the default, which the e2e harness
    // can't observe.
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-export-image-dpi",
      value: 150,
    });
    expect(next.exportImageDpi).toBe(150);
    expect(next).not.toBe(s);
  });
});

describe("preferencesReducer.set-create-image-quality", () => {
  it("stores a valid quality (fraction 0..1)", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: 0.7,
    });
    expect(next.createImageQuality).toBe(0.7);
  });
  it("clamps below the minimum (negative → 0)", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: -0.1,
    });
    expect(next.createImageQuality).toBe(0);
  });
  it("clamps above the maximum (>1 → 1)", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: 1.5,
    });
    expect(next.createImageQuality).toBe(1);
  });
  it("rounds fractional input to 3 decimal places", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: 0.123456,
    });
    expect(next.createImageQuality).toBe(0.123);
  });
  it("is a no-op when the quality equals the current value", () => {
    const s = makeSettings({ createImageQuality: 0.8 });
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: 0.8,
    });
    expect(next).toBe(s);
  });
  it("the first user write materialises the field", () => {
    const s = makeSettings();
    const next = preferencesReducer(s, {
      type: "set-create-image-quality",
      value: 0.85,
    });
    expect(next.createImageQuality).toBe(0.85);
    expect(next).not.toBe(s);
  });
});

describe("Phase 9 defaults", () => {
  it("default export format is png", () => {
    expect(DEFAULT_EXPORT_IMAGE_FORMAT).toBe("png");
  });
  it("default export DPI is 150", () => {
    expect(DEFAULT_EXPORT_IMAGE_DPI).toBe(150);
  });
  it("default create image quality is 0.85", () => {
    expect(DEFAULT_CREATE_IMAGE_QUALITY).toBe(0.85);
  });
});

describe("Phase 9 clamp helpers", () => {
  it("clampExportImageDpi handles boundaries", () => {
    expect(clampExportImageDpi(72)).toBe(72);
    expect(clampExportImageDpi(600)).toBe(600);
    expect(clampExportImageDpi(0)).toBe(72);
    expect(clampExportImageDpi(1500)).toBe(600);
  });
  it("clampCreateImageQuality handles boundaries (0..1 fraction)", () => {
    expect(clampCreateImageQuality(0)).toBe(0);
    expect(clampCreateImageQuality(1)).toBe(1);
    expect(clampCreateImageQuality(-0.5)).toBe(0);
    expect(clampCreateImageQuality(1.5)).toBe(1);
    // 3-decimal-place rounding keeps settings.json clean.
    expect(clampCreateImageQuality(0.123456)).toBe(0.123);
    expect(clampCreateImageQuality(0.85)).toBe(0.85);
  });
});

describe("qualityFractionToPercent / qualityPercentToFraction", () => {
  // The Create dialog displays the persisted fraction as a percentage
  // (10..100) for the user. These helpers do the conversion at the
  // boundary; a round-trip (display -> persist -> display) must be
  // stable so the user's last value is preserved across re-opens.
  it("converts 0.85 -> 85 and back", () => {
    expect(qualityFractionToPercent(0.85)).toBe(85);
    expect(qualityPercentToFraction(85)).toBe(0.85);
  });
  it("clamps out-of-range inputs", () => {
    expect(qualityFractionToPercent(-0.5)).toBe(0);
    expect(qualityFractionToPercent(1.5)).toBe(100);
    expect(qualityPercentToFraction(-50)).toBe(0);
    expect(qualityPercentToFraction(9999)).toBe(1);
  });
  it("rounds fractional percentages (0..1 fractions stay precise)", () => {
    // 0.123 stays 0.123, but as percent it rounds to 12.
    expect(qualityFractionToPercent(0.123)).toBe(12);
    // 12% -> 0.12 (rounded to 2 decimals by the clamp).
    expect(qualityPercentToFraction(12)).toBe(0.12);
  });
  it("every option in EXPORT_IMAGE_FORMATS is a valid allowlist value", () => {
    for (const f of EXPORT_IMAGE_FORMATS) {
      const s = makeSettings();
      const next = preferencesReducer(s, {
        type: "set-export-image-format",
        value: f,
      });
      expect(next.exportImageFormat).toBe(f);
    }
  });
});