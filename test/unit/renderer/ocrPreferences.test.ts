// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCR_DOWNSAMPLE,
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_DOWNSAMPLE,
  MIN_OCR_DOWNSAMPLE,
  OCR_LANGUAGES,
  clampOcrDownsample,
  preferencesReducer,
} from "../../../src/renderer/state/preferences";
import type { AppSettings } from "../../../src/shared/types";

/**
 * Phase 11 — OCR preferences reducer. The reducer is the single
 * source of truth for AppSettings.ocrLanguage + ocrDownsample. It
 * is idempotent (an equal value no-ops) so the dialog can fire
 * on every radio toggle without churning.
 *
 * Settings impact for Phase 11 (per REQUIREMENTS.md):
 *   ocrLanguage: ISO-639 allowlist, default 'eng'
 *   ocrDownsample: 72..600, default 300
 * The reducer drops values outside the allowlist / range so the
 * persisted shape stays valid even when a caller sends a bogus
 * value.
 */

function baseSettings(): AppSettings {
  return {
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
  };
}

describe("preferencesReducer — set-ocr-language (Phase 11)", () => {
  it("defaults to eng when unset", () => {
    expect(DEFAULT_OCR_LANGUAGE).toBe('eng');
    expect(OCR_LANGUAGES).toContain(DEFAULT_OCR_LANGUAGE);
  });

  it("persists a valid language choice", () => {
    const next = preferencesReducer(baseSettings(), {
      type: 'set-ocr-language',
      value: 'fra',
    });
    expect(next.ocrLanguage).toBe('fra');
  });

  it("drops values outside the ISO-639 allowlist", () => {
    const next = preferencesReducer(baseSettings(), {
      type: 'set-ocr-language',
      // 'klingon' is not in OCR_LANGUAGES — the reducer must
      // refuse the write.
      value: 'klingon' as never,
    });
    expect(next.ocrLanguage).toBeUndefined();
  });

  it("is idempotent when the value matches the existing one", () => {
    const a = preferencesReducer(baseSettings(), {
      type: 'set-ocr-language',
      value: 'deu',
    });
    const b = preferencesReducer(a, { type: 'set-ocr-language', value: 'deu' });
    expect(a).toBe(b);
  });
});

describe("preferencesReducer — set-ocr-downsample (Phase 11)", () => {
  it("defaults to 300 DPI when unset", () => {
    expect(DEFAULT_OCR_DOWNSAMPLE).toBe(300);
    expect(MIN_OCR_DOWNSAMPLE).toBe(72);
    expect(MAX_OCR_DOWNSAMPLE).toBe(600);
  });

  it("persists a valid DPI choice", () => {
    const next = preferencesReducer(baseSettings(), {
      type: 'set-ocr-downsample',
      value: 450,
    });
    expect(next.ocrDownsample).toBe(450);
  });

  it("clamps values outside [72, 600]", () => {
    expect(clampOcrDownsample(50)).toBe(72);
    expect(clampOcrDownsample(800)).toBe(600);
  });

  it("drops clamped-out-of-range writes that the reducer pre-clamps", () => {
    // The reducer clamps then compares; a clamped value equal to
    // the existing one short-circuits the write. Here there's no
    // prior value, so the clamped 72 still writes (and is allowed).
    const next = preferencesReducer(baseSettings(), {
      type: 'set-ocr-downsample',
      value: 10,
    });
    expect(next.ocrDownsample).toBe(72);
  });

  it("is idempotent when the clamped value matches the existing one", () => {
    const a = preferencesReducer(baseSettings(), {
      type: 'set-ocr-downsample',
      value: 300,
    });
    const b = preferencesReducer(a, { type: 'set-ocr-downsample', value: 300 });
    expect(a).toBe(b);
  });
});