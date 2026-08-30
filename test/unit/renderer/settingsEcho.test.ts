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
