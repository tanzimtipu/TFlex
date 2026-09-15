// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import {
  resolveInitialSettings,
  settingsRecoveryNotice,
} from "../../../src/renderer/state/settings";
import {
  applyTheme,
  nextTheme,
  resolveThemeDefault,
} from "../../../src/renderer/state/theme";
import { ok, err } from "../../../src/shared/result";

describe("theme", () => {
it("nextTheme cycles all three themes so frosted stays reachable", () => {
    // Phase D — the toggle must return to the DEFAULT theme (frosted):
    // frosted -> dark -> light -> frosted. The old two-state cycle
    // (dark <-> light) trapped frosted users: they could never get
    // back to the default from the keyboard command.
    expect(nextTheme("frosted")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("frosted");
  });

  it("applyTheme sets data-theme on the document", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("frosted");
    expect(document.documentElement.dataset.theme).toBe("frosted");
  });

  // Immediate-apply theme fix: the Preferences dropdown offers four
  // values but the live theme is a concrete AppTheme, so 'system' must
  // resolve to dark/light from the OS preference at choice time.
  it("resolveThemeDefault passes concrete themes through unchanged", () => {
    expect(resolveThemeDefault("light", false)).toBe("light");
    expect(resolveThemeDefault("dark", true)).toBe("dark");
    expect(resolveThemeDefault("frosted", true)).toBe("frosted");
    expect(resolveThemeDefault("light", true)).toBe("light");
  });

  it("resolveThemeDefault maps 'system' to the OS preference", () => {
    expect(resolveThemeDefault("system", true)).toBe("dark");
    expect(resolveThemeDefault("system", false)).toBe("light");
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

it("falls back to frosted defaults on io error", () => {
    const r = resolveInitialSettings(err("io", "missing"));
    expect(r.recovered).toBe(true);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.settings.theme).toBe("frosted");
    expect(r.settings.geometry).toEqual(DEFAULT_SETTINGS.geometry);
    expect(r.settings.recentFiles).toEqual([]);
  });

  it("falls back to frosted defaults on corrupt-settings", () => {
    const r = resolveInitialSettings(err("corrupt-settings", "not parseable"));
    expect(r.recovered).toBe(true);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults to dark geometry 1440x900", () => {
    expect(DEFAULT_SETTINGS.geometry.width).toBe(1440);
    expect(DEFAULT_SETTINGS.geometry.height).toBe(900);
  });
});

describe("DEF-207 — recovered boots surface user feedback (ADV-028)", () => {
  // The renderer-side half of the "settings silently normalized"
  // finding: when the backend cannot read/parse settings.json the
  // renderer boots on defaults (recovered=true), and the App boot
  // wiring must surface that to the user instead of letting the
  // substitution pass unnoticed. These tests pin the flag contract
  // the wiring depends on and the user-facing notice strings the
  // wiring emits.
  it("a valid load never flags recovery (no feedback for normal boots)", () => {
    const r = resolveInitialSettings(
      ok({
        theme: "frosted",
        geometry: { x: 0, y: 0, width: 800, height: 600, maximized: false },
        recentFiles: [],
      }),
    );
    expect(r.recovered).toBe(false);
  });

  it("corrupt and io loads flag recovery (the trigger for the notice)", () => {
    expect(resolveInitialSettings(err("corrupt-settings", "bad json")).recovered).toBe(true);
    expect(resolveInitialSettings(err("io", "unreadable")).recovered).toBe(true);
  });

  it("the recovery notice carries user-facing toast text and a console log line", () => {
    const notice = settingsRecoveryNotice();
    expect(notice.toast.length).toBeGreaterThan(0);
    expect(notice.log.length).toBeGreaterThan(0);
    // The toast must tell the user what actually happened (defaults
    // were restored), not just "an error occurred".
    expect(notice.toast).toContain("default settings");
    expect(notice.toast).toContain("restored");
    // The console line names the culprit file for support diagnosis.
    expect(notice.log).toContain("settings.json");
  });

  it("recovered defaults are a clone — mutating them cannot corrupt the module default", () => {
    const r = resolveInitialSettings(err("corrupt-settings", "bad json"));
    r.settings.geometry.maximized = true;
    expect(DEFAULT_SETTINGS.geometry.maximized).toBe(false);
  });
});
