// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyAnnotationPaletteChange,
  EMPTY_ANNOTATION_COLORS,
  makePresetId,
  normalizeHex,
  parseRgb,
  reducer as paletteReducer,
} from "../../../src/renderer/state/colorPalette";
import type { AnnotationColors as SharedAnnotationColors } from "../../../src/shared/types";
import type { AppSettings } from "../../../src/shared/types";

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

// DEF-037 — stale `settings` closure in App.tsx clobbered the per-theme
// palette persistence. The picker callback now runs inside the
// `setSettings(prev => ...)` updater, so the persisted object is built
// from React's latest pending state (`prev`), not from a render-scope
// capture that may be stale. The pure helper `applyAnnotationPaletteChange`
// is the merge the updater applies; its invariants below pin the bug.
describe("applyAnnotationPaletteChange (DEF-037)", () => {
  const makeSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    ...overrides,
  });

  it("stores the new palette and preserves the input theme (the defect)", () => {
    // The defect: render-scope `settings` had `theme: 'light'` (the
    // user toggled light), then they added a dark palette, then
    // toggled back to dark. The stale `settings` capture still said
    // 'light', so the persist wrote `{ theme: 'light', annotationColors:
    // <dark palette> }` — the wrong theme. The fix routes the merge
    // through `setSettings(prev => ...)`, so `prev` carries the
    // current theme. This test pins that invariant by passing the
    // post-toggle settings and asserting the result preserves it.
    const afterToggleToDark = makeSettings({ theme: 'dark' });
    const darkPalette: SharedAnnotationColors = {
      light: [],
      dark: [{ id: 'd1', hex: '#aabbcc' }],
    };
    const updated = applyAnnotationPaletteChange(afterToggleToDark, darkPalette);
    expect(updated.theme).toBe('dark');
    expect(updated.annotationColors).toEqual(darkPalette);
  });

  it("does not lose the theme when the input settings come from a render where the user toggled it", () => {
    // Simulate the exact race from the defect report:
    //   1. settings render-scope = { theme: 'light', annotationColors: { light: [{ old }] } }
    //   2. User adds a dark-theme color (palette: { light: [{old}], dark: [{new}] })
    //   3. User toggles theme to dark (settings state = { theme: 'dark', ... })
    //   4. Render commits — `settings` in the new render is { theme: 'dark', ... }
    // The previous implementation spread `{ ...settings, annotationColors: next }`
    // from the old render-scope `settings` (theme: 'light'), which would
    // save the wrong theme. The new implementation passes the LATEST
    // settings to the helper, which must preserve the LATEST theme.
    const latest = makeSettings({
      theme: 'dark',
      annotationColors: { light: [{ id: 'old', hex: '#111111' }] },
    });
    const next: SharedAnnotationColors = {
      light: [{ id: 'old', hex: '#111111' }],
      dark: [{ id: 'new', hex: '#aabbcc' }],
    };
    const updated = applyAnnotationPaletteChange(latest, next);
    expect(updated.theme).toBe('dark');
    expect(updated.annotationColors?.dark).toEqual([{ id: 'new', hex: '#aabbcc' }]);
    // The light bucket is preserved from `next`, not clobbered by anything.
    expect(updated.annotationColors?.light).toEqual([{ id: 'old', hex: '#111111' }]);
  });

  it("preserves unrelated settings fields (geometry, recents, prefs)", () => {
    const start = makeSettings({
      theme: 'light',
      recentsCap: 12,
      geometry: { x: 200, y: 250, width: 1600, height: 1000, maximized: true },
      recentFiles: [{ path: '/x.pdf', name: 'x.pdf', openedAt: '2026-01-01T00:00:00Z' }],
    });
    const next: SharedAnnotationColors = { light: [{ id: 'a', hex: '#010203' }], dark: [] };
    const updated = applyAnnotationPaletteChange(start, next);
    expect(updated.theme).toBe('light');
    expect(updated.recentsCap).toBe(12);
    expect(updated.geometry).toEqual(start.geometry);
    expect(updated.recentFiles).toEqual(start.recentFiles);
  });

  it("is idempotent when the new palette is referentially equal to the existing one", () => {
    const palette: SharedAnnotationColors = { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] };
    const start = makeSettings({ annotationColors: palette });
    const next = palette;
    const updated = applyAnnotationPaletteChange(start, next);
    // Same reference → no new object, no downstream persist needed.
    expect(updated).toBe(start);
  });

  it("writes through when the previous settings had no annotationColors", () => {
    // The renderer normalises away a missing palette (settings
    // .annotationColors === undefined) so the picker can render an
    // empty state. The next palette must therefore be written so a
    // later reload doesn't fall back to the same "absent" state.
    const start = makeSettings();
    expect(start.annotationColors).toBeUndefined();
    const next: SharedAnnotationColors = { light: [], dark: [] };
    const updated = applyAnnotationPaletteChange(start, next);
    expect(updated).not.toBe(start);
    expect(updated.annotationColors).toEqual({ light: [], dark: [] });
  });

  it("creates a new settings object when the palette actually changes", () => {
    const start = makeSettings({ annotationColors: { light: [], dark: [] } });
    const next: SharedAnnotationColors = { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] };
    const updated = applyAnnotationPaletteChange(start, next);
    expect(updated).not.toBe(start);
    expect(updated.annotationColors?.light).toEqual([{ id: 'a', hex: '#aabbcc' }]);
  });
});

// DEF-037 (reopened) — per-theme bucket experiment.
//
// The reopened defect: rapid theme toggles + palette writes interleaved
// with stale `settings.changed` echoes were letting one per-theme
// bucket clobber the other. The previous merge (a straight replace of
// `settings.annotationColors` with the picker-supplied `next`) lost
// any bucket `next` did not carry — and a stale echo could leave
// `settings.annotationColors` as a partial palette (one bucket
// present, the other missing or empty). The new merge is per-key:
// each bucket in the result prefers `next`, falls back to `current`,
// falls back to empty. The tests below exercise the exact workflow
// from the defect report and pin the invariants the fix depends on.
describe("applyAnnotationPaletteChange — per-theme bucket experiment (DEF-037 reopened)", () => {
  const makeSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    ...overrides,
  });

  it("themeA then themeB — both buckets preserved through add -> toggle -> add -> toggle", () => {
    // Reproduces the exact workflow from the defect report's e2e
    // retest: user adds a color in themeA, toggles to themeB, adds a
    // color in themeB, toggles back to themeA. After the round-trip,
    // BOTH per-theme buckets must be intact. The previous merge
    // dropped the inactive bucket when the picker's `presets` view
    // and the local `settings.annotationColors` disagreed on the
    // inactive bucket's content (e.g., the picker's freshly-mapped
    // view was empty because a stale echo had wiped it).
    let settings = makeSettings({ theme: 'light' });

    // Step 1: user adds light color "#aaaaaa" (picker in light theme).
    // The reducer's `add` mutates only the light bucket; the dark
    // bucket is preserved from the picker's `presets` view (empty
    // here because the local settings have no palette yet).
    settings = applyAnnotationPaletteChange(settings, {
      light: [{ id: 'a-light-1', hex: '#aaaaaa' }],
      dark: [],
    });
    expect(settings.annotationColors?.light).toEqual([{ id: 'a-light-1', hex: '#aaaaaa' }]);
    expect(settings.annotationColors?.dark).toEqual([]);

    // Step 2: user toggles theme to dark. The reducer is NOT
    // involved — this is the theme-toggle path in App.tsx, which
    // spreads `{ ...prev, theme: nextTheme(prev.theme) }` and runs
    // `trackAndPersist`. annotationColors is preserved by reference
    // here because the theme toggle does not touch it.
    settings = { ...settings, theme: 'dark' };

    // Step 3: user adds dark color "#bbbbbb" (picker in dark theme).
    // The picker's `presets` view (in App.tsx) is derived from the
    // LOCAL settings, NOT from main — but the reducer's `next` only
    // mutates the active bucket. The picker's reducer carries the
    // inactive (light) bucket through from `presets`. In production,
    // `presets` is a freshly-mapped view of `settings.annotationColors`
    // — so the inactive bucket's content depends on what App.tsx's
    // mapping produced this render.
    //
    // The previous merge (`{ ...settings, annotationColors: next }`)
    // would REPLACE `settings.annotationColors` entirely with `next`.
    // If `next` carried only the dark bucket (because the picker's
    // mapped view of `settings.annotationColors.light` was empty for
    // any reason), the light bucket content was lost. The new merge
    // preserves the light bucket from `settings.annotationColors` as
    // a fallback, so the round-trip survives.
    settings = applyAnnotationPaletteChange(settings, {
      // Picker's mapped view carries the light bucket forward
      // (preset shape, freshly mapped).
      light: [{ id: 'p-light-1', hex: '#aaaaaa' }],
      // The active-theme bucket receives the new addition.
      dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
    });
    expect(settings.annotationColors?.light).toEqual([{ id: 'p-light-1', hex: '#aaaaaa' }]);
    expect(settings.annotationColors?.dark).toEqual([{ id: 'p-dark-1', hex: '#bbbbbb' }]);

    // Step 4: user toggles theme back to light. annotationColors
    // is preserved by reference again.
    settings = { ...settings, theme: 'light' };

    // Step 5: user opens the picker in light theme and sees their
    // "#aaaaaa" color. Assert the light bucket is still intact.
    expect(settings.annotationColors?.light).toEqual([{ id: 'p-light-1', hex: '#aaaaaa' }]);
    expect(settings.annotationColors?.dark).toEqual([{ id: 'p-dark-1', hex: '#bbbbbb' }]);
  });

  it("preserves an inactive bucket when `next` omits it entirely (echo-after-wipe regression)", () => {
    // The reopened defect: a stale `settings.changed` echo carrying
    // a partial palette lands BEFORE the user's next palette write.
    // The echo handler's `setSettings(s)` overwrites local state with
    // the echo's content (a partial palette — say, dark bucket only,
    // light bucket stripped by a backend migration path). Then the
    // user adds another color; `next` from the picker only carries
    // the active bucket because the picker's reducer's spread of
    // `state` saw an empty/undefined inactive bucket. The previous
    // merge dropped the light bucket entirely. The new merge falls
    // back to `current.light` (which was preserved across the echo
    // because `setSettings(s)` ran AFTER the previous local write,
    // so current still has the light content) and preserves it.
    const before = makeSettings({
      theme: 'dark',
      annotationColors: {
        // String shape (echo normalises preset objects to hex strings).
        light: ['#aaaaaa'],
        dark: ['#bbbbbb'],
      },
    });

    // Picker in dark theme. Simulate the picker's reducer output
    // where the inactive (light) bucket key is undefined because the
    // picker's mapped view of `settings.annotationColors.light` was
    // an empty array that the reducer spread verbatim — the
    // picker's caller treats `next` as a partial palette with only
    // the active-theme bucket populated.
    const next: SharedAnnotationColors = {
      // `next.light` is undefined — the picker caller did not carry
      // it forward (or it was stripped before reaching us).
      dark: [
        { id: 'p-dark-1', hex: '#bbbbbb' },
        { id: 'p-dark-2', hex: '#cccccc' },
      ],
    };
    const after = applyAnnotationPaletteChange(before, next);
    // The fix: per-bucket merge falls back to `current.light` when
    // `next.light` is undefined. The light bucket content is
    // preserved across the partial merge. The new normaliser
    // canonicalises the legacy string shape to preset shape with
    // `legacy-<hex>` ids — the same id convention App.tsx uses on
    // read, so a downstream Remove on this entry would still find it.
    expect(after.annotationColors?.light).toEqual([
      { id: 'legacy-#aaaaaa', hex: '#aaaaaa' },
    ]);
    expect(after.annotationColors?.dark).toEqual([
      { id: 'p-dark-1', hex: '#bbbbbb' },
      { id: 'p-dark-2', hex: '#cccccc' },
    ]);
  });

  it("preserves the inactive bucket when `next` omits it entirely (undefined bucket)", () => {
    // Stronger version of the previous test: `next` has the dark
    // bucket only — the light bucket key is absent. The per-bucket
    // merge uses `current.light` as the fallback. The normaliser
    // converts the legacy string shape into preset shape on the way
    // out so the persist carries the canonical form.
    const before = makeSettings({
      theme: 'light',
      annotationColors: { light: ['#aaaaaa'], dark: ['#bbbbbb'] },
    });
    const next: SharedAnnotationColors = {
      // Picker's reducer built next without the light bucket (the
      // picker's mapped view had `dark` only after a partial echo).
      dark: [{ id: 'p-dark-2', hex: '#cccccc' }],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([
      { id: 'legacy-#aaaaaa', hex: '#aaaaaa' },
    ]);
    expect(after.annotationColors?.dark).toEqual([{ id: 'p-dark-2', hex: '#cccccc' }]);
  });

  it("does not over-write the dark bucket when only the light bucket was added (picker reducer flow)", () => {
    // Sanity check: the reducer's `add` action spreads the inactive
    // bucket from `state` (= picker's `presets` view). The merge
    // must accept that as the new dark bucket. Simulates the
    // picker's exact `onAdd` call site.
    const before = makeSettings({
      theme: 'light',
      annotationColors: { light: ['#aaaaaa'], dark: ['#bbbbbb'] },
    });
    const next: SharedAnnotationColors = {
      // The reducer spread preserves `state.dark` here. In the
      // picker, `state` is `presets` (the mapped view). For this
      // experiment we pass the mapped value directly.
      light: [{ id: 'p-light-2', hex: '#aaaaaa' }, { id: 'p-light-3', hex: '#dddddd' }],
      dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([
      { id: 'p-light-2', hex: '#aaaaaa' },
      { id: 'p-light-3', hex: '#dddddd' },
    ]);
    expect(after.annotationColors?.dark).toEqual([{ id: 'p-dark-1', hex: '#bbbbbb' }]);
  });

  it("idempotency guard survives preset/string shape mismatches (canonical hex compare)", () => {
    // The previous reference-equality check was always false (the
    // picker prop is freshly mapped on every render). The new check
    // compares canonical hex sets across both buckets. When the
    // local state has the preset shape and `next` has the string
    // shape (e.g., the picker somehow echoed its own write back),
    // the canonical comparison must match and the guard returns
    // the input settings unchanged.
    const settings = makeSettings({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'p-light-1', hex: '#aaaaaa' }],
        dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
      },
    });
    const next: SharedAnnotationColors = {
      light: ['#aaaaaa'],
      dark: ['#bbbbbb'],
    };
    const updated = applyAnnotationPaletteChange(settings, next);
    expect(updated).toBe(settings);
  });
});

// DEF-037 / DEF-043 — strict per-theme bucket isolation.
//
// The in-session leakage reported in DEF-043 ("adding a color in
// light theme makes it visible in dark theme within the same
// session") had two contributing factors:
//   (a) the merge accepted `next` partially and the picker's view
//       could aliase a bucket across themes if upstream paths ever
//       produced a wrong key;
//   (b) the renderer never normalised the bucket shape on write —
//       a stale echo arriving as `string[]` could leave the local
//       state in `string[]` shape, and a subsequent picker round-trip
//       would treat the legacy string as a stale entry to add.
//
// The new `normalizeBucket` in state/colorPalette.ts guarantees:
//   - Each bucket in the result is a FRESH `AnnotationColorPreset[]`
//     (no aliasing between light and dark, no aliasing with the
//     input arrays).
//   - Legacy `string[]` entries become `{ id: 'legacy-<hex>', hex }`,
//     matching the legacy-id convention the App.tsx picker projection
//     already uses on read — so add/remove-by-id stays consistent.
//   - Each bucket dedupes by lower-case hex so a cross-contaminated
//     upstream cannot grow a bucket past its expected size.
//
// The tests below pin the isolation invariants: a partial `next`
// must never overwrite the OTHER bucket's content with stale or
// cross-bucket data, and a write whose buckets cross-contaminate
// must be decontaminated before it reaches `settings.json`.
describe("applyAnnotationPaletteChange — strict per-theme bucket isolation (DEF-043)", () => {
  const makeSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    ...overrides,
  });

  it("writes to settings.annotationColors.light ONLY when next.dark is undefined and current.dark exists", () => {
    // Regression for DEF-043 in-session leakage: picker's `next` only
    // carries the active bucket; the inactive bucket must come from
    // `current`, NOT from the active bucket's content.
    const before = makeSettings({
      theme: 'light',
      annotationColors: {
        light: [{ id: 'p-light-1', hex: '#aaaaaa' }],
        dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
      },
    });
    const next: SharedAnnotationColors = {
      // Picker in light theme adds a new light color; dark bucket
      // is not in `next` because the picker reducer spreads from
      // its own state, which we simulate as undefined here.
      light: [
        { id: 'p-light-1', hex: '#aaaaaa' },
        { id: 'p-light-2', hex: '#cccccc' },
      ],
    };
    const after = applyAnnotationPaletteChange(before, next);
    // Light bucket is updated.
    expect(after.annotationColors?.light).toEqual([
      { id: 'p-light-1', hex: '#aaaaaa' },
      { id: 'p-light-2', hex: '#cccccc' },
    ]);
    // Dark bucket is preserved from `current`. Crucially, the light
    // bucket's content (`#aaaaaa`, `#cccccc`) must NOT appear in the
    // dark bucket — and the pre-existing `#bbbbbb` must NOT be lost.
    expect(after.annotationColors?.dark).toEqual([
      { id: 'p-dark-1', hex: '#bbbbbb' },
    ]);
  });

  it("writes to settings.annotationColors.dark ONLY when next.light is undefined and current.light exists", () => {
    // Mirror of the previous test for the dark bucket.
    const before = makeSettings({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'p-light-1', hex: '#aaaaaa' }],
        dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
      },
    });
    const next: SharedAnnotationColors = {
      dark: [
        { id: 'p-dark-1', hex: '#bbbbbb' },
        { id: 'p-dark-2', hex: '#dddddd' },
      ],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([
      { id: 'p-light-1', hex: '#aaaaaa' },
    ]);
    expect(after.annotationColors?.dark).toEqual([
      { id: 'p-dark-1', hex: '#bbbbbb' },
      { id: 'p-dark-2', hex: '#dddddd' },
    ]);
  });

  it("normalises legacy string[] buckets to preset[] on the way out (DEF-043 normalisation fix)", () => {
    // The backend normalises `AnnotationColorPreset[]` to `string[]`
    // on persist. If a stale echo (or a freshly-loaded settings.json
    // from before the preset-shape migration) brings back a string
    // shape, the merge must convert it to preset shape so the next
    // picker round-trip treats the entry as a tracked preset (the
    // legacy-id pattern from App.tsx's picker projection).
    const before = makeSettings({
      theme: 'dark',
      annotationColors: { light: [], dark: [] },
    });
    const next: SharedAnnotationColors = {
      // Pretend an echo with string shape landed.
      light: ['#aabbcc'],
      dark: ['#112233'],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([
      { id: 'legacy-#aabbcc', hex: '#aabbcc' },
    ]);
    expect(after.annotationColors?.dark).toEqual([
      { id: 'legacy-#112233', hex: '#112233' },
    ]);
  });

  it("lowercases hex on the way out so the persist carries canonical lowercase hexes", () => {
    // The backend expects lowercase hex; the renderer should not
    // round-trip a mixed-case entry back to settings.json. The
    // normaliser lowercases every hex so a stale echo that arrived
    // in upper case is sanitised on the next write.
    const before = makeSettings({
      theme: 'dark',
      annotationColors: { light: [], dark: [] },
    });
    const next: SharedAnnotationColors = {
      light: ['#AABBCC'],
      dark: [{ id: 'p-dark-1', hex: '#DDeEfF' }],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([
      { id: 'legacy-#aabbcc', hex: '#aabbcc' },
    ]);
    expect(after.annotationColors?.dark).toEqual([
      { id: 'p-dark-1', hex: '#ddeeff' },
    ]);
  });

  it("dedupes within a bucket so cross-contamination cannot grow a bucket", () => {
    // Defence-in-depth: even if an upstream path ever aliased
    // content (a future bug), the normaliser dedupes by lower-case
    // hex so a bucket cannot contain the same hex twice. This pins
    // the per-bucket size invariant — a hex that legitimately
    // belongs to `light` cannot be re-added to `light` just because
    // it already appears once.
    const before = makeSettings({
      theme: 'dark',
      annotationColors: { light: [], dark: [] },
    });
    const next = {
      // The same hex appears three times in different shapes. The
      // runtime contract accepts both `string[]` and
      // `AnnotationColorPreset[]` for each bucket; the cast widens
      // the type so we can mix shapes in the test (the real picker
      // does not mix shapes, but the normaliser must still dedupe).
      light: ['#aaaaaa', { id: 'a', hex: '#aaaaaa' }, { id: 'b', hex: '#AAAAAA' }] as unknown as SharedAnnotationColors['light'],
      dark: [] as SharedAnnotationColors['light'],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toHaveLength(1);
    const firstEntry = after.annotationColors?.light?.[0];
    // The normaliser always returns preset-shape entries (never
    // raw strings), so the runtime type is `AnnotationColorPreset`
    // here. The `as unknown as` cast below is a TS-only escape
    // hatch for the union return type.
    const first = firstEntry as unknown as { hex: string } | undefined;
    expect(first?.hex).toBe('#aaaaaa');
  });

  it("never aliases the light and dark buckets to the same reference (isolation invariant)", () => {
    // The single most important isolation invariant: the result's
    // `light` and `dark` arrays MUST be distinct references. If a
    // future refactor accidentally aliases them (e.g. `next` was
    // patched to share arrays between keys), the normaliser breaks
    // the alias by returning fresh arrays.
    const before = makeSettings({
      theme: 'dark',
      annotationColors: { light: [], dark: [] },
    });
    // Construct a malformed `next` whose light and dark are the
    // SAME reference — exactly the aliasing that would cause
    // in-session leakage if the merge trusted the references.
    const shared: ReadonlyArray<{ id: string; hex: string }> = [
      { id: 'p-1', hex: '#aaaaaa' },
    ];
    const next = {
      // The cast is intentional — TypeScript forbids this in the
      // shared types but the runtime invariant is what we test.
      light: shared as unknown as { id: string; hex: string }[],
      dark: shared as unknown as { id: string; hex: string }[],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).not.toBe(after.annotationColors?.dark);
    // And both buckets end up with their own fresh copies.
    expect(after.annotationColors?.light).toEqual([{ id: 'p-1', hex: '#aaaaaa' }]);
    expect(after.annotationColors?.dark).toEqual([{ id: 'p-1', hex: '#aaaaaa' }]);
  });

  it("empty `next` bucket is an intentional clear (overrides current)", () => {
    // The picker reducer can produce `next.light = []` if the user
    // removed every entry in the active bucket via the X button.
    // That is an INTENTIONAL clear and must take precedence over
    // `current.light`'s preserved content — otherwise the user's
    // "remove all" affordance would silently no-op.
    const before = makeSettings({
      theme: 'light',
      annotationColors: {
        light: [{ id: 'p-light-1', hex: '#aaaaaa' }],
        dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
      },
    });
    const next: SharedAnnotationColors = {
      light: [],
      dark: [{ id: 'p-dark-1', hex: '#bbbbbb' }],
    };
    const after = applyAnnotationPaletteChange(before, next);
    expect(after.annotationColors?.light).toEqual([]);
    expect(after.annotationColors?.dark).toEqual([{ id: 'p-dark-1', hex: '#bbbbbb' }]);
  });
});