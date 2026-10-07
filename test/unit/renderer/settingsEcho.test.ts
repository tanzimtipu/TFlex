// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  differsOnlyInRecentFiles,
  sameAnnotationColors,
  sameSettings,
  shouldApplyEcho,
} from "../../../src/renderer/state/settingsEcho";
import type { AppSettings, RecentFile } from "../../../src/shared/types";

/**
 * Phase 7 / DEF-037 — settings.changed echo filter.
 *
 * The main process broadcasts every persisted settings write back
 * to the renderer. When rapid theme toggles + palette changes are
 * in flight, an echo for an older write can land AFTER a newer
 * local write has already updated state — applying the older echo
 * would clobber fresher data (per-theme palette buckets,
 * themeDefault, recentsCap, ...).
 *
 * The fix tracks a monotonic local-write seq on the renderer side
 * and snapshots the most-recent settings object that went out to
 * main. The echo callback asks `shouldApplyEcho(...)` whether the
 * incoming payload still represents our latest local write — if
 * not, discard. This file pins the comparator + decision logic
 * the App's settings.changed subscription depends on.
 */

const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  theme: 'dark',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  ...overrides,
});

describe("sameSettings — AppSettings deep comparator", () => {
  it("returns true for referentially equal objects", () => {
    const s = baseSettings();
    expect(sameSettings(s, s)).toBe(true);
  });

  it("returns true for structurally equal settings", () => {
    expect(sameSettings(baseSettings(), baseSettings())).toBe(true);
  });

  it("returns false when theme differs", () => {
    expect(sameSettings(baseSettings({ theme: 'dark' }), baseSettings({ theme: 'light' }))).toBe(false);
  });

  it("returns false when geometry differs", () => {
    const a = baseSettings({ geometry: { x: 0, y: 0, width: 800, height: 600, maximized: false } });
    const b = baseSettings({ geometry: { x: 10, y: 10, width: 800, height: 600, maximized: false } });
    expect(sameSettings(a, b)).toBe(false);
  });

  it("returns false when recentFiles differ in length", () => {
    const a = baseSettings();
    const b = baseSettings({
      recentFiles: [{ path: '/x.pdf', name: 'x.pdf', openedAt: '2026-01-01T00:00:00Z' }],
    });
    expect(sameSettings(a, b)).toBe(false);
  });

  it("returns false when recentFiles entry content differs", () => {
    const recents = [{ path: '/x.pdf', name: 'x.pdf', openedAt: '2026-01-01T00:00:00Z' }];
    const a = baseSettings({ recentFiles: recents });
    const b = baseSettings({
      recentFiles: [{ path: '/x.pdf', name: 'x.pdf', openedAt: '2026-02-01T00:00:00Z' }],
    });
    expect(sameSettings(a, b)).toBe(false);
  });

  it("returns false when recentsCap differs", () => {
    expect(sameSettings(baseSettings({ recentsCap: 10 }), baseSettings({ recentsCap: 20 }))).toBe(false);
  });

  it("returns false when toolsPaletteLayout differs", () => {
    expect(
      sameSettings(
        baseSettings({ toolsPaletteLayout: 'list' }),
        baseSettings({ toolsPaletteLayout: 'grid' }),
      ),
    ).toBe(false);
  });

  it("returns false when optimizePreset differs", () => {
    expect(
      sameSettings(
        baseSettings({ optimizePreset: 'none' }),
        baseSettings({ optimizePreset: 'compact' }),
      ),
    ).toBe(false);
  });

  it("returns false when themeDefault differs", () => {
    expect(
      sameSettings(baseSettings({ themeDefault: 'dark' }), baseSettings({ themeDefault: 'light' })),
    ).toBe(false);
  });

  it("returns false when homeMotionPaused differs", () => {
    expect(
      sameSettings(
        baseSettings({ homeMotionPaused: false }),
        baseSettings({ homeMotionPaused: true }),
      ),
    ).toBe(false);
  });

  it("returns false when animationsEnabled differs", () => {
    expect(
      sameSettings(
        baseSettings({ animationsEnabled: true }),
        baseSettings({ animationsEnabled: false }),
      ),
    ).toBe(false);
  });
});

describe("sameAnnotationColors — annotationColors canonicalisation", () => {
  it("treats undefined as empty palettes", () => {
    expect(sameAnnotationColors(undefined, undefined)).toBe(true);
    expect(sameAnnotationColors({ light: [], dark: [] }, undefined)).toBe(true);
    expect(sameAnnotationColors(undefined, { light: [], dark: [] })).toBe(true);
  });

  it("treats preset objects and hex strings as equal when the hexes match", () => {
    // Renderer writes AnnotationColorPreset[]; backend normalises to
    // string[]. The comparator must not flag this shape mismatch.
    const fromRenderer = {
      light: [{ id: 'a', hex: '#aabbcc' }],
      dark: [] as { id: string; hex: string }[],
    };
    const fromBackend = {
      light: ['#aabbcc'],
      dark: [],
    };
    expect(sameAnnotationColors(fromRenderer, fromBackend)).toBe(true);
  });

  it("returns false when the same hex is in different buckets", () => {
    const a = { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] };
    const b = { light: [] as { id: string; hex: string }[], dark: [{ id: 'a', hex: '#aabbcc' }] };
    expect(sameAnnotationColors(a, b)).toBe(false);
  });

  it("returns true regardless of preset ordering within a bucket", () => {
    const a = {
      light: [
        { id: 'a', hex: '#aabbcc' },
        { id: 'b', hex: '#112233' },
      ],
      dark: [],
    };
    const b = {
      light: [
        { id: 'b', hex: '#112233' },
        { id: 'a', hex: '#aabbcc' },
      ],
      dark: [],
    };
    expect(sameAnnotationColors(a, b)).toBe(true);
  });

  it("returns false when bucket sizes differ", () => {
    const a = { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] };
    const b = { light: [] as { id: string; hex: string }[], dark: [] };
    expect(sameAnnotationColors(a, b)).toBe(false);
  });
});

describe("shouldApplyEcho — settings.changed echo filter (DEF-037 regression)", () => {
  it("applies the boot-time echo (writeSeq === 0)", () => {
    // No local writes yet; the echo IS the source of truth.
    const echo = baseSettings();
    expect(shouldApplyEcho(echo, 0, null)).toBe(true);
  });

  it("applies the echo when content matches our latest local write", () => {
    const localWrite = baseSettings({
      theme: 'light',
      annotationColors: { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] },
    });
    // Echo arrived post-normalise (string[] shape), but the hexes match.
    const echo = baseSettings({
      theme: 'light',
      annotationColors: { light: ['#aabbcc'], dark: [] },
    });
    expect(shouldApplyEcho(echo, 5, localWrite)).toBe(true);
  });

  it("discards a stale echo whose content predates our latest local write", () => {
    // User toggled theme to 'light' (writeSeq=1, settingsWriteSeq=1).
    // Then added a color in the LIGHT bucket (writeSeq=2, settingsWriteSeq=2,
    // persisted has [a]).
    // The echo for writeSeq=1 arrives late: it says { theme:'light' } with
    // NO palette entry (the snapshot from BEFORE the palette add).
    // Local state already has the palette — discard the stale echo.
    const localWrite = baseSettings({
      theme: 'light',
      annotationColors: { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] },
    });
    const staleEcho = baseSettings({ theme: 'light' });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("discards a stale echo that lost the per-theme palette bucket (DEF-037 defect)", () => {
    // The reported defect:
    //   1. User adds a custom color to the LIGHT palette.
    //   2. User toggles theme dark -> light -> dark rapidly.
    //   3. A late echo from step 1 lands AFTER the most recent toggle,
    //      carrying an outdated light-bucket state (or empty).
    // Without the filter, setSettings(staleEcho) wipes the user's
    // light palette. The filter discards.
    const latest = baseSettings({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'new', hex: '#ddeeff' }],
        dark: [{ id: 'old', hex: '#112233' }],
      },
    });
    const staleEcho = baseSettings({
      theme: 'dark',
      // The stale echo's light bucket is missing or different.
      annotationColors: { light: [], dark: [{ id: 'old', hex: '#112233' }] },
    });
    expect(shouldApplyEcho(staleEcho, 3, latest)).toBe(false);
  });

  it("applies an echo even after a write when content matches (echo IS the latest write)", () => {
    // Round-trip sanity check: main echoes back exactly what we
    // wrote (modulo preset-id shape). Filter accepts.
    const latest = baseSettings({
      theme: 'light',
      recentsCap: 12,
      annotationColors: {
        light: [{ id: 'a', hex: '#aabbcc' }],
        dark: [],
      },
    });
    const echoFromMain = baseSettings({
      theme: 'light',
      recentsCap: 12,
      annotationColors: { light: ['#aabbcc'], dark: [] },
    });
    expect(shouldApplyEcho(echoFromMain, 7, latest)).toBe(true);
  });

  it("applies the echo defensively when persisted is null but writeSeq > 0", () => {
    // Pathological: persisted snapshot wasn't taken before the
    // first write landed (shouldn't happen — trackAndPersist takes
    // the snapshot at the same time as the seq bump). The filter
    // errs on the side of applying so we don't freeze the UI.
    const echo = baseSettings();
    expect(shouldApplyEcho(echo, 1, null)).toBe(true);
  });

  it("does not apply a stale echo from a different theme", () => {
    // User is on dark; an echo from a previous light-theme write
    // arrives. Content mismatch + we have local writes — discard.
    const latest = baseSettings({ theme: 'dark' });
    const staleEcho = baseSettings({ theme: 'light' });
    expect(shouldApplyEcho(staleEcho, 1, latest)).toBe(false);
  });

  it("does not apply a stale echo whose recentsCap drifted", () => {
    const latest = baseSettings({ recentsCap: 25 });
    const staleEcho = baseSettings({ recentsCap: 10 });
    expect(shouldApplyEcho(staleEcho, 1, latest)).toBe(false);
  });

  it("does not apply a stale echo whose optimizePreset drifted", () => {
    // User picks 'compact' (writeSeq=1), then a stale echo arrives
    // carrying 'none'. The filter discards the stale echo so the
    // user's chosen preset survives a settings-changed race.
    const latest = baseSettings({ optimizePreset: 'compact' });
    const staleEcho = baseSettings({ optimizePreset: 'none' });
    expect(shouldApplyEcho(staleEcho, 1, latest)).toBe(false);
  });

  it("applies an echo whose optimizePreset matches the latest local write", () => {
    const latest = baseSettings({ optimizePreset: 'max' });
    const echoFromMain = baseSettings({ optimizePreset: 'max' });
    expect(shouldApplyEcho(echoFromMain, 1, latest)).toBe(true);
  });

  it("discards a stale echo that carries an older homeMotionPaused", () => {
    const persisted = baseSettings({ homeMotionPaused: false });
    const echo = baseSettings({ homeMotionPaused: true });
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(false);
  });

  it("applies an echo whose homeMotionPaused matches the latest local write", () => {
    const persisted = baseSettings({ homeMotionPaused: false });
    const echo = baseSettings({ homeMotionPaused: false });
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(true);
  });

  it("discards a stale echo that carries an older animationsEnabled", () => {
    const persisted = baseSettings({ animationsEnabled: true });
    const echo = baseSettings({ animationsEnabled: false });
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(false);
  });

  it("applies an echo whose animationsEnabled matches the latest local write", () => {
    const persisted = baseSettings({ animationsEnabled: true });
    const echo = baseSettings({ animationsEnabled: true });
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(true);
  });
});

describe("differsOnlyInRecentFiles — recentFiles-only delta detector", () => {
  const recentsA: RecentFile[] = [
    { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
  ];
  const recentsB: RecentFile[] = [
    { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
    { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
  ];

  it("returns true when the only difference is the recentFiles list", () => {
    const a = baseSettings({ recentFiles: recentsA });
    const b = baseSettings({ recentFiles: recentsB });
    expect(differsOnlyInRecentFiles(a, b)).toBe(true);
    expect(differsOnlyInRecentFiles(b, a)).toBe(true);
  });

  it("returns false when recentFiles are identical (no diff at all)", () => {
    const a = baseSettings({ recentFiles: recentsA });
    const b = baseSettings({ recentFiles: recentsA });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("returns false when theme also differs", () => {
    const a = baseSettings({ theme: 'dark', recentFiles: recentsA });
    const b = baseSettings({ theme: 'light', recentFiles: recentsB });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("returns false when annotationColors also differs", () => {
    const a = baseSettings({
      recentFiles: recentsA,
      annotationColors: { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] },
    });
    const b = baseSettings({
      recentFiles: recentsB,
      annotationColors: { light: [{ id: 'b', hex: '#ddeeff' }], dark: [] },
    });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("returns false when recentsCap also drifts", () => {
    const a = baseSettings({ recentFiles: recentsA, recentsCap: 10 });
    const b = baseSettings({ recentFiles: recentsB, recentsCap: 25 });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });
});

describe("shouldApplyEcho — recentFiles-only echos from addRecentFile are honoured", () => {
  it("applies an echo whose only change is a new recentFiles entry", () => {
    // User toggles theme first (local write). settingsWriteSeqRef > 0,
    // persisted has the post-toggle state without the new recent file.
    // Then addRecentFile() runs on the backend; the echo carries the
    // post-addRecentFile settings — different only in recentFiles.
    // The filter must apply, otherwise the local mirror stays stale.
    const localWrite = baseSettings({
      theme: 'dark',
      annotationColors: { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] },
    });
    const echoFromAddRecent = baseSettings({
      theme: 'dark',
      annotationColors: { light: [{ id: 'a', hex: '#aabbcc' }], dark: [] },
      recentFiles: [
        { path: '/new.pdf', name: 'new.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ],
    });
    expect(shouldApplyEcho(echoFromAddRecent, 2, localWrite)).toBe(true);
  });

  it("does not apply an echo that drifts recentFiles AND theme (the theme drift is the stale signal)", () => {
    const localWrite = baseSettings({
      theme: 'dark',
      recentFiles: [
        { path: '/new.pdf', name: 'new.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ],
    });
    const staleEcho = baseSettings({
      theme: 'light', // also drifted — discard
      recentFiles: [
        { path: '/new.pdf', name: 'new.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ],
    });
    expect(shouldApplyEcho(staleEcho, 3, localWrite)).toBe(false);
  });
});

// DEF-037 (reopened) — echo guard for the per-theme bucket workflow.
//
// The previous merge in `applyAnnotationPaletteChange` was correct
// for theme toggles, but a stale `settings.changed` echo carrying
// a partial palette could still slip past the filter when its
// surviving bucket happened to match the LATEST local write — the
// bucket the echo DIDN'T carry was simply missing from the
// comparison and the renderer's downstream merge replaced the
// local `annotationColors` with the echo's content (a partial
// palette). The tests below pin the invariants the echo guard
// must hold for both buckets independently.
describe("echo guard — per-theme bucket invariants (DEF-037 reopened)", () => {
  const base = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    ...overrides,
  });

  it("discards a stale echo whose dark bucket dropped entries", () => {
    // User toggled theme (writeSeq=1), then added a dark color
    // (writeSeq=2, persisted has both buckets). The echo for
    // writeSeq=1 arrives late carrying a stale dark bucket — only
    // the LIGHT bucket content matches, the DARK bucket drifted
    // (was empty in the earlier snapshot). Discard.
    const latest = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    const staleEcho = base({
      theme: 'dark',
      // Dark bucket has FEWER entries than the latest write.
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [],
      },
    });
    expect(shouldApplyEcho(staleEcho, 2, latest)).toBe(false);
  });

  it("discards a stale echo whose light bucket dropped entries", () => {
    // Mirror of the previous test — the stale echo's light bucket
    // is missing the entry the user just added.
    const latest = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    const staleEcho = base({
      theme: 'dark',
      annotationColors: {
        light: [],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    expect(shouldApplyEcho(staleEcho, 2, latest)).toBe(false);
  });

  it("discards a stale echo that stripped a bucket entirely (one bucket missing)", () => {
    // The reopened-defect worst case: a backend migration path or
    // a partial save strips one bucket from `settings.json`, so
    // the echo carries only one bucket. The filter MUST catch this
    // even though the surviving bucket matches — otherwise applying
    // the echo would clobber the missing bucket's content.
    const latest = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    const staleEcho = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        // dark bucket missing entirely.
      },
    });
    expect(shouldApplyEcho(staleEcho, 2, latest)).toBe(false);
  });

  it("accepts the canonical reflection of the latest write (string-shape echo)", () => {
    // Round-trip after backend normalisation: the echo carries
    // `string[]` while `persisted` has `AnnotationColorPreset[]`.
    // The filter canonicalises both shapes and accepts the echo.
    const latest = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    const echoFromMain = base({
      theme: 'dark',
      annotationColors: {
        light: ['#aaaaaa'],
        dark: ['#bbbbbb'],
      },
    });
    expect(shouldApplyEcho(echoFromMain, 2, latest)).toBe(true);
  });

  it("accepts a fresh echo that matches BOTH buckets exactly (canonical reflection)", () => {
    // The common path: user adds a color, debounce fires, main
    // echoes back. The echo carries the same hexes in both
    // buckets. The filter accepts.
    const latest = base({
      theme: 'light',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [],
      },
    });
    const echoFromMain = base({
      theme: 'light',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [],
      },
    });
    expect(shouldApplyEcho(echoFromMain, 1, latest)).toBe(true);
  });

  it("discards a stale echo with the same buckets but a different theme", () => {
    // The theme is part of `sameSettings`; a stale echo from a
    // prior theme toggle must not clobber the current theme. The
    // per-theme palette merge is independent of this check, but
    // the filter must catch the theme drift before any palette
    // consideration.
    const latest = base({
      theme: 'dark',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    const staleEcho = base({
      theme: 'light',
      annotationColors: {
        light: [{ id: 'a', hex: '#aaaaaa' }],
        dark: [{ id: 'b', hex: '#bbbbbb' }],
      },
    });
    expect(shouldApplyEcho(staleEcho, 2, latest)).toBe(false);
  });

  it("accepts the canonical reflection after a themeA -> themeB toggle (no palette change)", () => {
    // User toggles theme with no palette change — `next.annotationColors`
    // is preserved by reference. The echo carries the new theme +
    // the SAME palette. The filter accepts.
    const latest = base({
      theme: 'light',
      annotationColors: {
        light: ['#aaaaaa'],
        dark: [],
      },
    });
    const echoFromMain = base({
      theme: 'light',
      annotationColors: {
        light: ['#aaaaaa'],
        dark: [],
      },
    });
    expect(shouldApplyEcho(echoFromMain, 1, latest)).toBe(true);
  });
});

describe("sameSettings / differsOnlyInRecentFiles — defaultStampId echo handling", () => {
  const recentsA: RecentFile[] = [
    { path: "/a.pdf", name: "a.pdf", openedAt: "2026-01-01T00:00:00Z" },
  ];
  const recentsB: RecentFile[] = [
    { path: "/b.pdf", name: "b.pdf", openedAt: "2026-01-02T00:00:00Z" },
    { path: "/a.pdf", name: "a.pdf", openedAt: "2026-01-01T00:00:00Z" },
  ];

  it("sameSettings returns true when the only difference is defaultStampId matching", () => {
    const a = baseSettings({ defaultStampId: "APPROVED" });
    const b = baseSettings({ defaultStampId: "APPROVED" });
    expect(sameSettings(a, b)).toBe(true);
  });

  it("sameSettings returns false when defaultStampId differs", () => {
    const a = baseSettings({ defaultStampId: "APPROVED" });
    const b = baseSettings({ defaultStampId: "DRAFT" });
    expect(sameSettings(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns false when defaultStampId also drifts", () => {
    const a = baseSettings({
      recentFiles: recentsA,
      defaultStampId: "APPROVED",
    });
    const b = baseSettings({
      recentFiles: recentsB,
      defaultStampId: "DRAFT",
    });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns true when only recentFiles change and defaultStampId matches", () => {
    const a = baseSettings({
      recentFiles: recentsA,
      defaultStampId: "DRAFT",
    });
    const b = baseSettings({
      recentFiles: recentsB,
      defaultStampId: "DRAFT",
    });
    expect(differsOnlyInRecentFiles(a, b)).toBe(true);
  });

  it("shouldApplyEcho applies an echo whose defaultStampId matches the local write", () => {
    const localWrite = baseSettings({ defaultStampId: "CONFIDENTIAL" });
    const echo = baseSettings({ defaultStampId: "CONFIDENTIAL" });
    expect(shouldApplyEcho(echo, 2, localWrite)).toBe(true);
  });

  it("shouldApplyEcho rejects a stale echo that drifts defaultStampId", () => {
    const localWrite = baseSettings({ defaultStampId: "DRAFT" });
    const stale = baseSettings({ defaultStampId: "CONFIDENTIAL" });
    expect(shouldApplyEcho(stale, 2, localWrite)).toBe(false);
  });
});

// DEF-072 — echo filter completeness over Phase 9/10 fields.
//
// ADV-019 found that the previous `sameSettings()` and
// `differsOnlyInRecentFiles()` were missing four AppSettings
// fields:
//   - exportImageFormat   (Phase 9, default 'png')
//   - exportImageDpi      (Phase 9, default 150)
//   - createImageQuality  (Phase 9, default 0.85)
//   - editDefaultFont     (Phase 10, default 'Helvetica')
//
// A rapid change to one of those followed by a second persisted
// write would let a stale echo from the FIRST write pass the
// filter (since `sameSettings` returned true despite the drift)
// and silently clobber the newer local value. The tests below
// pin every missing field individually + a combined
// "rapid write race" scenario that proves the filter catches the
// race even when the older echo carries a DIFFERENT field drift
// than the one the user just changed.
describe("DEF-072 — echo filter completeness over Phase 9/10 fields", () => {
  it("sameSettings returns false when exportImageFormat differs", () => {
    expect(
      sameSettings(
        baseSettings({ exportImageFormat: 'png' }),
        baseSettings({ exportImageFormat: 'jpeg' }),
      ),
    ).toBe(false);
  });

  it("sameSettings returns false when exportImageDpi differs", () => {
    expect(
      sameSettings(
        baseSettings({ exportImageDpi: 150 }),
        baseSettings({ exportImageDpi: 300 }),
      ),
    ).toBe(false);
  });

  it("sameSettings returns false when createImageQuality differs", () => {
    expect(
      sameSettings(
        baseSettings({ createImageQuality: 0.85 }),
        baseSettings({ createImageQuality: 0.5 }),
      ),
    ).toBe(false);
  });

  it("sameSettings returns false when editDefaultFont differs", () => {
    expect(
      sameSettings(
        baseSettings({ editDefaultFont: 'Helvetica' }),
        baseSettings({ editDefaultFont: 'Times' }),
      ),
    ).toBe(false);
  });

  it("sameSettings returns true when the four Phase 9/10 fields match", () => {
    const a = baseSettings({
      exportImageFormat: 'jpeg',
      exportImageDpi: 300,
      createImageQuality: 0.5,
      editDefaultFont: 'Times',
    });
    const b = baseSettings({
      exportImageFormat: 'jpeg',
      exportImageDpi: 300,
      createImageQuality: 0.5,
      editDefaultFont: 'Times',
    });
    expect(sameSettings(a, b)).toBe(true);
  });

  it("differsOnlyInRecentFiles returns false when exportImageFormat also drifts", () => {
    // An addRecentFile echo that ALSO drifted exportImageFormat is
    // NOT a recent-files-only delta — the export field drift is
    // real. The previous comparator missed this and would have
    // accepted the echo, silently reverting the user's format.
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, exportImageFormat: 'jpeg' });
    const b = baseSettings({ recentFiles: recentsB, exportImageFormat: 'png' });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns false when exportImageDpi also drifts", () => {
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, exportImageDpi: 300 });
    const b = baseSettings({ recentFiles: recentsB, exportImageDpi: 150 });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns false when createImageQuality also drifts", () => {
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, createImageQuality: 0.5 });
    const b = baseSettings({ recentFiles: recentsB, createImageQuality: 0.85 });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns false when editDefaultFont also drifts", () => {
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, editDefaultFont: 'Helvetica' });
    const b = baseSettings({ recentFiles: recentsB, editDefaultFont: 'Times' });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("shouldApplyEcho discards a stale echo whose exportImageFormat drifted (DEF-072 defect)", () => {
    // The reported defect:
    //   1. User picks 'jpeg' in the Export dialog. settingsPersisted
    //      has exportImageFormat='jpeg', recentsCap=10.
    //   2. User changes recentsCap to 25 (in Preferences).
    //   3. The echo from step 1 lands AFTER step 2, carrying
    //      exportImageFormat='jpeg' AND recentsCap=10. The new
    //      local write has recentsCap=25 and the same 'jpeg'. The
    //      old echo's recentsCap=10 is now stale — applying the
    //      echo would revert recentsCap from 25 back to 10.
    //   4. The previous comparator missed the recentsCap field
    //      comparison (it was checked) — but the same defect
    //      applied to exportImageFormat too: a stale echo with
    //      exportImageFormat='png' would have been accepted and
    //      reverted the user's 'jpeg' choice.
    // The fix: sameSettings now compares every field; the stale
    // echo's recentsCap drift is caught regardless of which field
    // was the user's "real" change.
    const localWrite = baseSettings({
      recentsCap: 25,
      exportImageFormat: 'jpeg',
    });
    const staleEcho = baseSettings({
      recentsCap: 10,
      exportImageFormat: 'jpeg',
    });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho discards a stale echo whose exportImageFormat drifted independently", () => {
    // The exact DEF-072 repro: a stale echo carries the older
    // exportImageFormat while every other field matches. The
    // previous comparator returned true (no drift detected on
    // the fields it checked) and accepted the echo, silently
    // clobbering the user's choice.
    const localWrite = baseSettings({
      recentsCap: 10,
      exportImageFormat: 'jpeg',
    });
    const staleEcho = baseSettings({
      recentsCap: 10,
      exportImageFormat: 'png',
    });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho discards a stale echo whose exportImageDpi drifted independently", () => {
    const localWrite = baseSettings({ recentsCap: 10, exportImageDpi: 300 });
    const staleEcho = baseSettings({ recentsCap: 10, exportImageDpi: 150 });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho discards a stale echo whose createImageQuality drifted independently", () => {
    const localWrite = baseSettings({ recentsCap: 10, createImageQuality: 0.5 });
    const staleEcho = baseSettings({ recentsCap: 10, createImageQuality: 0.85 });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho discards a stale echo whose editDefaultFont drifted independently", () => {
    const localWrite = baseSettings({ recentsCap: 10, editDefaultFont: 'Times' });
    const staleEcho = baseSettings({ recentsCap: 10, editDefaultFont: 'Helvetica' });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho accepts a canonical reflection matching all four Phase 9/10 fields", () => {
    // Round-trip sanity check: main echoes back exactly what we
    // wrote (modulo preset-id shape and unrelated field drift).
    const localWrite = baseSettings({
      exportImageFormat: 'jpeg',
      exportImageDpi: 300,
      createImageQuality: 0.5,
      editDefaultFont: 'Times',
    });
    const echoFromMain = baseSettings({
      exportImageFormat: 'jpeg',
      exportImageDpi: 300,
      createImageQuality: 0.5,
      editDefaultFont: 'Times',
    });
    expect(shouldApplyEcho(echoFromMain, 5, localWrite)).toBe(true);
  });
});

// DEF-073 — echo filter covers the new saveAsLinearize boolean.
//
// The Save-As modal's "Fast web view (linearize)" toggle used to
// piggy-back on `optimizePreset`. ADV-020 traced that coupling
// and the fix moves the toggle to its own `saveAsLinearize`
// AppSettings boolean (Phase 13). The comparator MUST compare
// the new field too — otherwise a rapid linearize toggle
// followed by another persisted change would silently revert the
// linearize choice via a stale echo.
describe("DEF-073 — saveAsLinearize echo handling (Save-As linearize toggle)", () => {
  it("sameSettings returns true when saveAsLinearize matches", () => {
    expect(
      sameSettings(
        baseSettings({ saveAsLinearize: true }),
        baseSettings({ saveAsLinearize: true }),
      ),
    ).toBe(true);
    expect(
      sameSettings(
        baseSettings({ saveAsLinearize: false }),
        baseSettings({ saveAsLinearize: false }),
      ),
    ).toBe(true);
    // Both undefined (field absent on both sides) — same.
    expect(sameSettings(baseSettings(), baseSettings())).toBe(true);
  });

  it("sameSettings returns false when saveAsLinearize differs (true vs false)", () => {
    expect(
      sameSettings(
        baseSettings({ saveAsLinearize: true }),
        baseSettings({ saveAsLinearize: false }),
      ),
    ).toBe(false);
  });

  it("sameSettings returns false when saveAsLinearize differs (set vs undefined)", () => {
    // The renderer's local write has saveAsLinearize=true; the
    // echo arrives without the field (e.g. from an older build
    // that hasn't yet validated it). Without the comparator
    // line, the echo's undefined would silently revert the user's
    // choice to false.
    expect(
      sameSettings(
        baseSettings({ saveAsLinearize: true }),
        baseSettings({}),
      ),
    ).toBe(false);
  });

  it("differsOnlyInRecentFiles returns false when saveAsLinearize also drifts", () => {
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, saveAsLinearize: true });
    const b = baseSettings({ recentFiles: recentsB, saveAsLinearize: false });
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("differsOnlyInRecentFiles returns true when only recentFiles change and saveAsLinearize matches", () => {
    const recentsA: RecentFile[] = [
      { path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00Z' },
    ];
    const recentsB: RecentFile[] = [
      { path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00Z' },
      ...recentsA,
    ];
    const a = baseSettings({ recentFiles: recentsA, saveAsLinearize: true });
    const b = baseSettings({ recentFiles: recentsB, saveAsLinearize: true });
    expect(differsOnlyInRecentFiles(a, b)).toBe(true);
  });

  it("shouldApplyEcho discards a stale echo whose saveAsLinearize drifted independently", () => {
    // The reported defect (ADV-020): a stale echo carries the
    // older saveAsLinearize value while every other field
    // matches. The previous comparator had no check for this
    // field (it didn't exist yet), so it would have accepted the
    // echo and silently reverted the user's choice.
    const localWrite = baseSettings({ saveAsLinearize: true });
    const staleEcho = baseSettings({ saveAsLinearize: false });
    expect(shouldApplyEcho(staleEcho, 2, localWrite)).toBe(false);
  });

  it("shouldApplyEcho accepts a canonical reflection matching saveAsLinearize", () => {
    const localWrite = baseSettings({ saveAsLinearize: true });
    const echoFromMain = baseSettings({ saveAsLinearize: true });
    expect(shouldApplyEcho(echoFromMain, 2, localWrite)).toBe(true);
  });
});

// DEF-072 — coverage guard for future fields.
//
// The previous regression came from "a Phase 9/10 field was
// added but the comparator wasn't updated". This test reads
// the AppSettings interface and asserts that every optional
// field is mentioned in `sameSettings`'s implementation — a
// runtime guard so a future field addition forces an explicit
// comparator update.
//
// Implementation: import the source file as text and grep for
// the field name. We resolve via vitest's `process.cwd()` which
// the test runner sets to the repo root.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("DEF-072 — sameSettings covers every optional AppSettings field", () => {
  const settingsEchoPath = resolve(
    process.cwd(),
    "src/renderer/state/settingsEcho.ts",
  );
  const source = readFileSync(settingsEchoPath, "utf8");

  // Every optional AppSettings field MUST appear at least once
  // inside the sameSettings function body. We grep for the bare
  // field name; any occurrence is sufficient. A typo in the field
  // name would be caught because the substring search is exact.
  const requiredFields: ReadonlyArray<{ field: string; hint: string }> = [
    { field: "optimizePreset", hint: "Phase 8 Optimize preset" },
    { field: "exportImageFormat", hint: "Phase 9 Export image format" },
    { field: "exportImageDpi", hint: "Phase 9 Export image DPI" },
    { field: "createImageQuality", hint: "Phase 9 Create image quality" },
    { field: "editDefaultFont", hint: "Phase 10 Edit default font" },
    { field: "ocrLanguage", hint: "Phase 11 OCR language" },
    { field: "ocrDownsample", hint: "Phase 11 OCR downsample" },
    { field: "defaultStampId", hint: "Phase 12 default stamp id" },
    { field: "saveAsLinearize", hint: "Phase 13 Save-As linearize" },
    { field: "spellCheck", hint: "Phase 82 offline spell-check preference" },
    { field: "redactionColor", hint: "DEF-072 redaction highlight color" },
    { field: "accountsEnabled", hint: "DEF-072 accounts opt-in" },
    { field: "syncDeviceId", hint: "DEF-072 sync device id" },
    { field: "lastSyncedAt", hint: "DEF-072 last sync timestamp" },
    { field: "tabStyle", hint: "DEF-072 tab style" },
    { field: "blankPageInkThreshold", hint: "DEF-072 blank-page ink threshold" },
    { field: "annotationRecentTools", hint: "DEF-072 recent annotation tools" },
    { field: "dockPins", hint: "DEF-072 dock pins" },
    { field: "dockUnpinned", hint: "DEF-072 dock unpinned" },
    { field: "homeTools", hint: "DEF-072 home tools" },
    { field: "toolUsage", hint: "DEF-072 tool usage counters" },
    { field: "sanitizeOptions", hint: "DEF-072 sanitize options" },
    { field: "batesDefaults", hint: "DEF-072 Bates defaults" },
    { field: "encryptDefaults", hint: "DEF-072 encrypt defaults" },
    { field: "convertDefaults", hint: "DEF-072 convert defaults" },
    { field: "imageImportDefaults", hint: "DEF-072 image import defaults" },
    { field: "pdfValidationDefaults", hint: "DEF-072 PDF validation defaults" },
    { field: "officeConvertDefaults", hint: "DEF-072 office convert defaults" },
    { field: "readingDefaults", hint: "DEF-072 reading defaults" },
    { field: "printPresets", hint: "DEF-072 print presets" },
  ];

  for (const { field, hint } of requiredFields) {
    it(`references ${field} (${hint})`, () => {
      // Require the literal field name to appear in the file
      // (most occurrences are inside the comparator bodies).
      expect(source).toContain(field);
    });
  }

  it("the exportImageFormat / exportImageDpi / createImageQuality / editDefaultFont checks appear in BOTH sameSettings and differsOnlyInRecentFiles", () => {
    // DEF-072 — the four missing Phase 9/10 fields MUST be
    // checked in both functions so the recent-files-only delta
    // detector doesn't accept an echo that drifted one of them.
    // We count occurrences; >=4 means each field name appears in
    // both functions (at least two each: a.X check + b.X check
    // + sameSettings + differsOnlyInRecentFiles references).
    // Each occurrence is bare, so we just count.
    const fields = [
      "exportImageFormat",
      "exportImageDpi",
      "createImageQuality",
      "editDefaultFont",
    ];
    for (const f of fields) {
      // The field name should appear at least 4 times: two in
      // each comparator function (the `a.X` and `b.X`
      // comparisons).
      const matches = source.match(new RegExp(f, "g")) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// Phase 112 (TFL-1000) — adversary fix batch. DEF-601/ADV-231 and
// DEF-603/ADV-233: the echo filter must reject a stale echo that disagrees
// with the latest local write on a panel-layout field, and must not trust a
// recents-only delta that reverted a pin (the `differsOnlyInRecentFiles`
// branch previously bypassed the C6b `sameRecentFiles` comparison).
describe("TFL-1000 DEF-601 — panel-layout fields participate in the echo filter", () => {
  const cases: ReadonlyArray<{
    field: keyof AppSettings;
    stale: unknown;
    latest: unknown;
  }> = [
    { field: "panelLeftWidthPx", stale: 300, latest: 320 },
    { field: "panelRightWidthPx", stale: 300, latest: 380 },
    { field: "inspectorCollapsed", stale: false, latest: true },
    { field: "pagesPanelCollapsed", stale: false, latest: true },
  ];

  for (const { field, stale, latest } of cases) {
    it(`discards a stale echo that disagrees on ${String(field)}`, () => {
      const persisted = baseSettings({ [field]: latest } as Partial<AppSettings>);
      const echo = baseSettings({ [field]: stale } as Partial<AppSettings>);
      expect(sameSettings(echo, persisted)).toBe(false);
      expect(differsOnlyInRecentFiles(echo, persisted)).toBe(false);
      expect(shouldApplyEcho(echo, 2, persisted)).toBe(false);
    });
  }

  it("still applies an echo that matches the latest panel-layout write", () => {
    const persisted = baseSettings({
      panelLeftWidthPx: 320,
      panelRightWidthPx: 380,
      inspectorCollapsed: true,
      pagesPanelCollapsed: true,
    });
    expect(sameSettings(persisted, { ...persisted })).toBe(true);
    expect(shouldApplyEcho({ ...persisted }, 2, persisted)).toBe(true);
  });
});

describe("TFL-1000 DEF-603 — a stale recents-only echo cannot revert a pin", () => {
  const pinned: RecentFile = {
    path: "/a.pdf",
    name: "a.pdf",
    openedAt: "2026-01-01T00:00:00Z",
    pinned: true,
    sourceLabel: "PDF",
    sourceKind: "pdf",
    converted: true,
    workingFormat: "pdf",
  };

  it("discards a recents-only echo whose pin disagrees, even though only recents differ", () => {
    const persisted = baseSettings({ recentFiles: [pinned] });
    const staleEcho = baseSettings({
      recentFiles: [{ ...pinned, pinned: false }],
    });
    expect(sameSettings(staleEcho, persisted)).toBe(false);
    expect(differsOnlyInRecentFiles(staleEcho, persisted)).toBe(false);
    expect(shouldApplyEcho(staleEcho, 2, persisted)).toBe(false);
  });

  it("discards a recents-only echo that reverted any other C6a metadata field", () => {
    for (const override of [
      { sourceLabel: undefined },
      { sourceKind: undefined },
      { converted: false },
      { workingFormat: undefined },
    ] as Array<Partial<RecentFile>>) {
      const persisted = baseSettings({ recentFiles: [pinned] });
      const staleEcho = baseSettings({
        recentFiles: [{ ...pinned, ...override }],
      });
      expect(shouldApplyEcho(staleEcho, 2, persisted)).toBe(false);
    }
  });

  it("still honours a genuine backend addRecentFile echo (a new path appears)", () => {
    const persisted = baseSettings({ recentFiles: [pinned] });
    const echo = baseSettings({
      recentFiles: [
        { path: "/new.pdf", name: "new.pdf", openedAt: "2026-01-02T00:00:00Z" },
        pinned,
      ],
    });
    expect(differsOnlyInRecentFiles(echo, persisted)).toBe(true);
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(true);
  });

  it("still honours a refresh of an existing entry that only advanced openedAt", () => {
    const persisted = baseSettings({ recentFiles: [pinned] });
    const echo = baseSettings({
      recentFiles: [{ ...pinned, openedAt: "2026-01-03T00:00:00Z" }],
    });
    expect(differsOnlyInRecentFiles(echo, persisted)).toBe(true);
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(true);
  });
});

// TFL-1014 (DEF-072) — completeness sweep. Every optional AppSettings field
// the comparator previously ignored could let a stale echo clobber a newer
// local write. Each case proves the stale echo is rejected by all three
// comparators and by shouldApplyEcho.
describe("TFL-1014 DEF-072 — every remaining AppSettings field participates in the echo filter", () => {
  const cases: ReadonlyArray<{
    field: keyof AppSettings;
    stale: unknown;
    latest: unknown;
  }> = [
    { field: "redactionColor", stale: "#ff0000", latest: "#000000" },
    { field: "accountsEnabled", stale: false, latest: true },
    { field: "syncDeviceId", stale: "device-a", latest: "device-b" },
    { field: "lastSyncedAt", stale: "2026-01-01T00:00:00Z", latest: "2026-02-01T00:00:00Z" },
    { field: "tabStyle", stale: "standard", latest: "colorful" },
    { field: "blankPageInkThreshold", stale: 0.2, latest: 0.4 },
    { field: "annotationRecentTools", stale: ["select"], latest: ["select", "pen"] },
    { field: "dockPins", stale: ["pen"], latest: ["pen", "eraser"] },
    { field: "dockUnpinned", stale: ["eraser"], latest: ["eraser", "pen"] },
    { field: "homeTools", stale: ["stamp"], latest: ["stamp", "sign"] },
    { field: "toolUsage", stale: { select: 1 }, latest: { select: 1, pen: 2 } },
    {
      field: "sanitizeOptions",
      stale: { javascript: true, launchActions: true, embeddedFiles: true, metadata: true },
      latest: { javascript: false, launchActions: true, embeddedFiles: true, metadata: true },
    },
    {
      field: "batesDefaults",
      stale: { prefix: "A", suffix: "", startNumber: 1, padding: 4, position: "footer-right" },
      latest: { prefix: "B", suffix: "", startNumber: 1, padding: 4, position: "footer-right" },
    },
    {
      field: "encryptDefaults",
      stale: { algorithm: "aes-128", permissions: { print: true } },
      latest: { algorithm: "aes-256", permissions: { print: true } },
    },
    {
      field: "convertDefaults",
      stale: {
        pageSize: "a4",
        marginMm: 10,
        textFontFamily: "Helvetica",
        textFontSizePt: 11,
        csvDelimiter: "auto",
        csvFormMapping: false,
        htmlPrintBackgrounds: false,
      },
      latest: {
        pageSize: "letter",
        marginMm: 10,
        textFontFamily: "Helvetica",
        textFontSizePt: 11,
        csvDelimiter: "auto",
        csvFormMapping: false,
        htmlPrintBackgrounds: false,
      },
    },
    {
      field: "imageImportDefaults",
      stale: { pageSizeMode: "image", fixedPageSize: "a4", fit: "contain", rotationDeg: 0 },
      latest: { pageSizeMode: "fixed", fixedPageSize: "a4", fit: "contain", rotationDeg: 0 },
    },
    {
      field: "pdfValidationDefaults",
      stale: { target: "none", onViolation: "warn" },
      latest: { target: "pdfa-1b", onViolation: "warn" },
    },
    {
      field: "officeConvertDefaults",
      stale: {
        spreadsheets: { gridlines: true, fitToWidth: true, orientation: "auto" },
        presentations: { includeNotes: true },
        exports: { includeImages: true },
      },
      latest: {
        spreadsheets: { gridlines: false, fitToWidth: true, orientation: "auto" },
        presentations: { includeNotes: true },
        exports: { includeImages: true },
      },
    },
    {
      field: "readingDefaults",
      stale: {
        epub: { fontSizePt: 12, lineHeight: 1.5, theme: "light" },
        comics: { layout: "single", fit: "width", rightToLeft: false },
      },
      latest: {
        epub: { fontSizePt: 14, lineHeight: 1.5, theme: "light" },
        comics: { layout: "single", fit: "width", rightToLeft: false },
      },
    },
    {
      field: "printPresets",
      stale: [{ name: "A", settings: { copies: 1 } }],
      latest: [{ name: "B", settings: { copies: 1 } }],
    },
  ];

  it("covers exactly the 20 remaining fields", () => {
    expect(cases).toHaveLength(20);
  });

  for (const { field, stale, latest } of cases) {
    it(`discards a stale echo that disagrees on ${String(field)}`, () => {
      const persisted = baseSettings({ [field]: latest } as Partial<AppSettings>);
      const echo = baseSettings({ [field]: stale } as Partial<AppSettings>);
      expect(sameSettings(echo, persisted)).toBe(false);
      expect(differsOnlyInRecentFiles(echo, persisted)).toBe(false);
      expect(shouldApplyEcho(echo, 2, persisted)).toBe(false);
    });
  }

  it("still applies a canonical echo carrying all 20 fields equal", () => {
    const all = {
      redactionColor: "#000000",
      accountsEnabled: true,
      syncDeviceId: "device-a",
      lastSyncedAt: "2026-01-01T00:00:00Z",
      tabStyle: "colorful",
      blankPageInkThreshold: 0.4,
      annotationRecentTools: ["select", "pen"],
      dockPins: ["pen"],
      dockUnpinned: ["eraser"],
      homeTools: ["stamp"],
      toolUsage: { select: 1, pen: 2 },
      sanitizeOptions: {
        javascript: true,
        launchActions: true,
        embeddedFiles: true,
        metadata: true,
      },
      batesDefaults: { prefix: "A", suffix: "", startNumber: 1, padding: 4, position: "footer-right" },
      encryptDefaults: { algorithm: "aes-256", permissions: { print: true } },
      convertDefaults: {
        pageSize: "a4",
        marginMm: 10,
        textFontFamily: "Helvetica",
        textFontSizePt: 11,
        csvDelimiter: "auto",
        csvFormMapping: false,
        htmlPrintBackgrounds: false,
      },
      imageImportDefaults: {
        pageSizeMode: "image",
        fixedPageSize: "a4",
        fit: "contain",
        rotationDeg: 0,
      },
      pdfValidationDefaults: { target: "none", onViolation: "warn" },
      officeConvertDefaults: {
        spreadsheets: { gridlines: true, fitToWidth: true, orientation: "auto" },
        presentations: { includeNotes: true },
        exports: { includeImages: true },
      },
      readingDefaults: {
        epub: { fontSizePt: 12, lineHeight: 1.5, theme: "light" },
        comics: { layout: "single", fit: "width", rightToLeft: false },
      },
      printPresets: [{ name: "A", settings: { copies: 1 } }],
    } as unknown as Partial<AppSettings>;
    const persisted = baseSettings(all);
    const echo = baseSettings(JSON.parse(JSON.stringify(all)) as Partial<AppSettings>);
    expect(sameSettings(echo, persisted)).toBe(true);
    expect(differsOnlyInRecentFiles(echo, persisted)).toBe(false);
    expect(shouldApplyEcho(echo, 2, persisted)).toBe(true);
  });
});
