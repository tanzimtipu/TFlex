// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import { resolveInitialSettings } from "../../../src/renderer/state/settings";
import { applyTheme, nextTheme } from "../../../src/renderer/state/theme";
import { ok, err } from "../../../src/shared/result";

describe("theme", () => {
  it("nextTheme toggles", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("applyTheme sets data-theme on the document", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("settings bootstrap", () => {
  it("returns the value verbatim when load is ok", () => {
    const r = resolveInitialSettings(
      ok({
        theme: "light",
        geometry: { x: 0, y: 0, width: 800, height: 600, maximized: false },
        recentFiles: [],
      }),
    );
    expect(r.recovered).toBe(false);
    expect(r.settings.theme).toBe("light");
  });

  it("falls back to dark defaults on io error", () => {
    const r = resolveInitialSettings(err("io", "missing"));
    expect(r.recovered).toBe(true);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.settings.theme).toBe("dark");
    expect(r.settings.geometry).toEqual(DEFAULT_SETTINGS.geometry);
    expect(r.settings.recentFiles).toEqual([]);
  });

  it("falls back to dark defaults on corrupt-settings", () => {
    const r = resolveInitialSettings(err("corrupt-settings", "not parseable"));
    expect(r.recovered).toBe(true);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults to dark geometry 1440x900", () => {
    expect(DEFAULT_SETTINGS.geometry.width).toBe(1440);
    expect(DEFAULT_SETTINGS.geometry.height).toBe(900);
  });
});
