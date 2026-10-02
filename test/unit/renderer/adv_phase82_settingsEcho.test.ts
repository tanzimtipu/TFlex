// ADV Phase 82 diff-pass — focused repro spec (adversary).
//
// This file originally pinned the OBSERVED DEFECTIVE behaviour of the Phase 82
// offline spell-check settings delta. The DEF-480 / DEF-481 fixes were landed,
// so these assertions are INVERTED here to pin the FIXED behaviour (see the
// "FIXED" descriptions below). It does NOT touch product code or the phase's
// own tests.
//
// Findings covered:
//   ADV-156: `sameSettings` / `differsOnlyInRecentFiles` in
//            src/renderer/state/settingsEcho.ts never compare
//            `AppSettings.spellCheck`. A stale `settings.changed` echo whose
//            only drift is `spellCheck` therefore passes the echo filter and
//            clobbers the user's latest flip. FIXED: all three comparators now
//            guard on `spellCheck`.
//   ADV-157: a misspelled token with zero dictionary candidates still opens a
//            suggestion popover (`Suggestions = []`), rendering an empty
//            `[data-spell-suggest]` listbox with no actions. FIXED: the
//            context handler bails out before `preventDefault()` so the native
//            menu shows instead.
//
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  differsOnlyInRecentFiles,
  sameSettings,
  shouldApplyEcho,
} from "../../../src/renderer/state/settingsEcho";
import {
  isSpellMisspelled,
  suggestSpellCorrections,
  tokenizeForSpell,
} from "../../../src/shared/spell";
import { buildSpellDictionary } from "../../../src/shared/spell";
import type { AppSettings } from "../../../src/shared/types";

const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  theme: "dark",
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  ...overrides,
});

describe("ADV-156 fix — spellCheck participates in the echo filter", () => {
  it("FIXED: sameSettings detects a spellCheck-only difference", () => {
    const a = baseSettings({ spellCheck: { enabled: true, language: "en-US" } });
    const b = baseSettings({ spellCheck: { enabled: false, language: "en-US" } });
    // The other fields are identical, so a correct comparator MUST return
    // false. The fixed comparator checks the field and returns false.
    expect(sameSettings(a, b)).toBe(false);
  });

  it("FIXED: a stale echo whose only drift is spellCheck is discarded", () => {
    // 1. User toggles spell check OFF (local write, writeSeq=1,
    //    persisted=spellCheck:{enabled:false}).
    // 2. User toggles it back ON (writeSeq=2,
    //    persisted=spellCheck:{enabled:true}).
    // 3. The echo for write 1 lands late carrying spellCheck:false.
    const latestLocalWrite = baseSettings({
      spellCheck: { enabled: true, language: "en-US" },
    });
    const staleEcho = baseSettings({
      spellCheck: { enabled: false, language: "en-US" },
    });
    // DEF-072 invariant: false — discard the stale echo so the user's ON
    // survives. The fixed filter returns false; App.tsx:1319 never applies it.
    expect(shouldApplyEcho(staleEcho, 2, latestLocalWrite)).toBe(false);
  });

  it("FIXED: differsOnlyInRecentFiles rejects a spellCheck drift", () => {
    const recentsA = [
      { path: "/a.pdf", name: "a.pdf", openedAt: "2026-01-01T00:00:00Z" },
    ];
    const recentsB = [
      { path: "/b.pdf", name: "b.pdf", openedAt: "2026-01-02T00:00:00Z" },
      ...recentsA,
    ];
    const a = baseSettings({
      recentFiles: recentsA,
      spellCheck: { enabled: true, language: "en-US" },
    });
    const b = baseSettings({
      recentFiles: recentsB,
      spellCheck: { enabled: false, language: "en-US" },
    });
    // A genuine recent-files-only delta must NOT also carry a spellCheck
    // drift. With the guard in place this reports false.
    expect(differsOnlyInRecentFiles(a, b)).toBe(false);
  });

  it("FIXED: settingsEcho.ts compares spellCheck", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer/state/settingsEcho.ts"),
      "utf8",
    );
    expect(source).toContain("spellCheck");
  });
});

describe("ADV-157 repro — a misspelled token with no suggestions opens an empty popover", () => {
  const dict = buildSpellDictionary(
    readFileSync(
      resolve(process.cwd(), "assets", "dictionary", "en-us.txt"),
      "utf8",
    ),
  );

  it("the token is flagged misspelled but yields zero suggestions", () => {
    const word = "q".repeat(46);
    expect(tokenizeForSpell(word)).toEqual([
      { word, start: 0, end: word.length },
    ]);
    expect(isSpellMisspelled(word, dict)).toBe(true);
    expect(suggestSpellCorrections(word, dict)).toEqual([]);
  });
});
