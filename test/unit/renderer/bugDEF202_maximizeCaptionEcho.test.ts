// @vitest-environment jsdom
//
// DEF-202 — the maximize caption went stale ("Maximize" shown while the
// window was already maximized) after a settings write.
//
// Root cause chain:
//   1. Main owns the window geometry. On every `maximize` /
//      `unmaximize` / move / resize it reports bounds + the maximized
//      flag (debounced, `src/main/window.ts`) via a settings save,
//      which broadcasts a `settings:changed` echo to the renderer.
//   2. The renderer's echo filter (`shouldApplyEcho`, DEF-037)
//      discards any echo whose content disagrees with the renderer's
//      latest local write snapshot. A geometry report nearly always
//      disagrees — the window has moved since the last renderer write
//      — so the echo carrying `maximized: true` was dropped and
//      `settings.geometry.maximized` stayed stale.
//   3. The caption read `maximized` straight off `settings.geometry`,
//      so it lagged the real window state.
//
// The fix has two halves, both pinned here:
//   a. `shouldApplyEcho` now accepts geometry-only deltas (main is
//      authoritative for geometry; the renderer never writes it), so
//      `settings.geometry` refreshes from window reports.
//   b. The caption reads a dedicated mirror that updates from EVERY
//      echo BEFORE the filter runs — covering echoes that ALSO carry
//      a stale non-geometry field from a rapid-write race (the filter
//      must still reject those as a whole; the caption must still
//      refresh).

import { describe, expect, it } from "vitest";
import {
  differsOnlyInGeometry,
  shouldApplyEcho,
} from "../../../src/renderer/state/settingsEcho";
import type { AppSettings } from "../../../src/shared/types";

const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  theme: "dark",
  geometry: { x: 10, y: 10, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  ...overrides,
});

describe("DEF-202 — geometry-only echoes are applied (maximize caption sync)", () => {
  it("accepts a maximized echo that arrives after a local settings write", () => {
    // The regression: user toggles the theme (renderer write -> seq=1,
    // snapshot has maximized:false, restored bounds), THEN maximizes
    // the window. Main reports geometry(maximized:true). The old
    // filter discarded that echo; the caption stayed "Maximize".
    const persisted = baseSettings({ theme: "light" });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(true);
  });

  it("accepts an unmaximize echo after a local settings write", () => {
    const persisted = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 10, y: 10, width: 1440, height: 900, maximized: false },
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(true);
  });

  it("accepts a plain window-move echo (bounds changed, maximized flag same)", () => {
    const persisted = baseSettings({ theme: "light" });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 200, y: 120, width: 1440, height: 900, maximized: false },
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(true);
  });

  it("still rejects echoes that drift a NON-geometry field (stale-write guard intact)", () => {
    // Geometry matches the snapshot but the theme is stale — this is
    // the DEF-037 stale-echo case and must keep being discarded.
    const persisted = baseSettings({ theme: "light" });
    const echo = baseSettings({
      theme: "dark",
      geometry: persisted.geometry,
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(false);
  });

  it("still rejects echoes that drift geometry AND another field (mixed delta)", () => {
    // Rapid-write race: main's geometry save merged a stale theme.
    // The filter must reject the payload as a whole (applying it
    // would clobber the newer local theme write).
    const persisted = baseSettings({ theme: "frosted" });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(false);
  });

  it("does not over-accept: recents + geometry delta is not a geometry-only delta", () => {
    const persisted = baseSettings({
      theme: "light",
      recentFiles: [{ path: "a.pdf", name: "a.pdf", openedAt: "2026-01-01T00:00:00Z" }],
    });
    const echo = baseSettings({
      theme: "light",
      recentFiles: [],
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    expect(shouldApplyEcho(echo, 1, persisted)).toBe(false);
  });
});

describe("differsOnlyInGeometry — the acceptance rule behind the filter", () => {
  it("true when ONLY geometry differs", () => {
    const a = baseSettings({ theme: "light" });
    const b = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    expect(differsOnlyInGeometry(a, b)).toBe(true);
  });

  it("false when geometry is identical (that is sameSettings territory)", () => {
    const a = baseSettings({ theme: "light" });
    expect(differsOnlyInGeometry(a, a)).toBe(false);
  });

  it("false when a non-geometry field differs", () => {
    const a = baseSettings({ theme: "light" });
    const b = baseSettings({
      theme: "dark",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    expect(differsOnlyInGeometry(a, b)).toBe(false);
  });
});

describe("DEF-202 — caption mirror policy (App.tsx wiring contract)", () => {
  // The caption reads a dedicated `windowMaximized` mirror that App.tsx
  // updates from EVERY echo, BEFORE the filter gates the full settings
  // apply. App.tsx itself is not unit-mountable (7k lines, full IPC
  // surface), so — like the DEF-044 suite — this pins the wiring
  // policy at the same level of abstraction: a model that mirrors the
  // exact call order of the App.tsx `settings.changed` handler.
  function makeCaptionModel(initial: boolean): {
    maximized: boolean;
    settingsApplied: AppSettings | null;
    onEcho(s: AppSettings, seq: number, persisted: AppSettings | null): void;
  } {
    let maximized = initial;
    let settingsApplied: AppSettings | null = null;
    return {
      get maximized() {
        return maximized;
      },
      get settingsApplied() {
        return settingsApplied;
      },
      onEcho(s, seq, persisted) {
        // Mirrors App.tsx: caption FIRST, from every echo; then the
        // filter decides whether the rest of the payload applies.
        maximized = s.geometry.maximized;
        if (!shouldApplyEcho(s, seq, persisted)) return;
        settingsApplied = s;
      },
    };
  }

  it("caption refreshes on a maximize echo even when the filter applies it", () => {
    const model = makeCaptionModel(false);
    const persisted = baseSettings({ theme: "light" });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    model.onEcho(echo, 1, persisted);
    expect(model.maximized).toBe(true);
    expect(model.settingsApplied).toEqual(echo);
  });

  it("caption refreshes even when the filter REJECTS a mixed-delta echo", () => {
    // The race: local write (theme frosted) lands after main's
    // maximize report was persisted, so the echo carries a stale
    // theme + fresh geometry. The payload is rejected as a whole,
    // but the window state it carried is still real — the caption
    // must not go stale (this is the exact DEF-202 symptom).
    const model = makeCaptionModel(false);
    const persisted = baseSettings({ theme: "frosted" });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    model.onEcho(echo, 1, persisted);
    expect(model.settingsApplied).toBeNull(); // payload rejected
    expect(model.maximized).toBe(true); // caption still refreshed
  });

  it("caption refreshes on unmaximize, again regardless of the filter", () => {
    const model = makeCaptionModel(true);
    const persisted = baseSettings({
      theme: "frosted",
      geometry: { x: 0, y: 0, width: 1920, height: 1080, maximized: true },
    });
    const echo = baseSettings({
      theme: "light",
      geometry: { x: 10, y: 10, width: 1440, height: 900, maximized: false },
    });
    model.onEcho(echo, 1, persisted);
    expect(model.settingsApplied).toBeNull();
    expect(model.maximized).toBe(false);
  });
});
