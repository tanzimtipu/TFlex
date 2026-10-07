// TFL-938 adversary probe — logic-level attacks on the Home motion-pause diff.
// Run: node <bundle>.mjs  (bundle via esbuild from this file).
// Prints a JSON block per attack with PASS/FAIL vs the documented contract.
import { normalizeSettings } from "../../src/main/services/settings";
import {
  shouldApplyEcho,
  sameSettings,
} from "../../src/renderer/state/settingsEcho";
import { shouldAnimateOrbit } from "../../src/renderer/utils/orbitMotion";
import { preferencesReducer } from "../../src/renderer/state/preferences";
import type { AppSettings } from "../../src/shared/types";

const results: Array<Record<string, unknown>> = [];
function record(attack: string, name: string, pass: boolean, detail: unknown): void {
  results.push({ attack, name, pass, detail });
}

const base = (over: Partial<AppSettings> = {}): AppSettings =>
  ({
    theme: "dark",
    geometry: { x: 0, y: 0, width: 1100, height: 800, maximized: false },
    recentFiles: [],
    ...over,
  }) as AppSettings;

// ---------------------------------------------------------------------------
// ATTACK 1 — settings normalization corruption (shared service).
// ---------------------------------------------------------------------------
for (const [label, value] of [
  ["string", "yes"],
  ["number 1", 1],
  ["number 0", 0],
  ["null", null],
  ["array", ["true"]],
  ["object", { value: true }],
] as const) {
  const r = normalizeSettings({
    homeMotionPaused: value,
    animationsEnabled: true,
    theme: "dark",
    recentsCap: 12,
  } as unknown);
  record(
    "1-normalize",
    `rejects homeMotionPaused as ${label}`,
    (r as Record<string, unknown>).homeMotionPaused === undefined,
    {
      homeMotionPaused: (r as Record<string, unknown>).homeMotionPaused,
      animationsEnabled: (r as Record<string, unknown>).animationsEnabled,
      theme: (r as Record<string, unknown>).theme,
      recentsCap: (r as Record<string, unknown>).recentsCap,
    },
  );
}
{
  const r = normalizeSettings({} as unknown) as Record<string, unknown>;
  record(
    "1-normalize",
    "absent field stays absent (consumer default false)",
    r.homeMotionPaused === undefined && !("homeMotionPaused" in r),
    { homeMotionPaused: r.homeMotionPaused, hasKey: "homeMotionPaused" in r },
  );
}
{
  const r = normalizeSettings({
    homeMotionPaused: true,
    animationsEnabled: false,
    theme: "light",
    recentsCap: 7,
  } as unknown) as Record<string, unknown>;
  record(
    "1-normalize",
    "both fields preserved alongside siblings",
    r.homeMotionPaused === true &&
      r.animationsEnabled === false &&
      r.theme === "light" &&
      r.recentsCap === 7,
    r,
  );
}
{
  const r = normalizeSettings({
    homeMotionPaused: "true",
    animationsEnabled: false,
    theme: "light",
  } as unknown) as Record<string, unknown>;
  record(
    "1-normalize",
    "invalid value does not corrupt sibling animationsEnabled",
    r.homeMotionPaused === undefined && r.animationsEnabled === false,
    r,
  );
}

// ---------------------------------------------------------------------------
// ATTACK 2 — cross-field leakage + stale-echo clobber.
// ---------------------------------------------------------------------------
{
  const start = base({ homeMotionPaused: undefined as unknown as boolean });
  const paused = preferencesReducer(start, {
    type: "set-home-motion-paused",
    value: true,
  });
  const resumed = preferencesReducer(paused, {
    type: "set-home-motion-paused",
    value: false,
  });
  record(
    "2-leak",
    "home-pause toggle never mutates animationsEnabled",
    paused.animationsEnabled === undefined && resumed.animationsEnabled === undefined,
    { pausedAnim: paused.animationsEnabled, resumedAnim: resumed.animationsEnabled },
  );
  const animStart = base({ animationsEnabled: true });
  const animOff = preferencesReducer(animStart, {
    type: "set-animations-enabled",
    value: false,
  });
  record(
    "2-leak",
    "global animations toggle never declares homeMotionPaused",
    !("homeMotionPaused" in animOff),
    { hasHome: "homeMotionPaused" in animOff },
  );
}
{
  // Stale-echo scenario: local write #2 set homeMotionPaused=false; an older
  // echo carrying homeMotionPaused=true (all else equal) must be discarded.
  const latest = base({ homeMotionPaused: false, animationsEnabled: true });
  const staleEcho = base({ homeMotionPaused: true, animationsEnabled: true });
  const applied = shouldApplyEcho(staleEcho, 2, latest);
  record(
    "2-echo",
    "stale echo carrying old homeMotionPaused=true is discarded",
    applied === false,
    {
      shouldApply: applied,
      sameSettingsSaysIdentical: sameSettings(staleEcho, latest),
      staleHome: staleEcho.homeMotionPaused,
      latestHome: latest.homeMotionPaused,
    },
  );
}
{
  // Same class for the pre-existing Animations field.
  const latest = base({ animationsEnabled: false });
  const staleEcho = base({ animationsEnabled: true });
  const applied = shouldApplyEcho(staleEcho, 2, latest);
  record(
    "2-echo",
    "stale echo carrying old animationsEnabled=true is discarded",
    applied === false,
    { shouldApply: applied, sameSettingsSaysIdentical: sameSettings(staleEcho, latest) },
  );
}

// ---------------------------------------------------------------------------
// ATTACK 3 — four-gate truth table.
// ---------------------------------------------------------------------------
{
  const ALL_OPEN = {
    animationsEnabled: true,
    homeMotionPaused: false,
    prefersReduced: false,
    documentHidden: false,
    windowMinimized: false,
    windowBlurred: false,
  };
  const cases: Array<[string, Partial<typeof ALL_OPEN>, boolean]> = [
    ["all open -> animate", {}, true],
    ["reduced motion wins", { prefersReduced: true }, false],
    ["home pause + animations ON -> pinned", { homeMotionPaused: true }, false],
    [
      "home pause + animations OFF -> pinned",
      { homeMotionPaused: true, animationsEnabled: false },
      false,
    ],
    ["document hidden -> pinned", { documentHidden: true }, false],
    ["window minimized -> pinned", { windowMinimized: true }, false],
    ["window blurred -> pinned", { windowBlurred: true }, false],
    [
      "reduced motion beats everything",
      {
        prefersReduced: true,
        animationsEnabled: false,
        homeMotionPaused: true,
        documentHidden: true,
        windowMinimized: true,
        windowBlurred: true,
      },
      false,
    ],
  ];
  for (const [name, over, expected] of cases) {
    const got = shouldAnimateOrbit({ ...ALL_OPEN, ...over });
    record("3-gates", name, got === expected, { got, expected });
  }
}

// ---------------------------------------------------------------------------
// ATTACK 5 (logic half) — reducer idempotency / default state.
// ---------------------------------------------------------------------------
{
  const start = base({ homeMotionPaused: undefined as unknown as boolean });
  const noop = preferencesReducer(start, { type: "set-home-motion-paused", value: false });
  record(
    "5-reducer",
    "resume-from-absent is a no-op (same reference, no write)",
    noop === start,
    { sameRef: noop === start, home: noop.homeMotionPaused },
  );
  const paused = preferencesReducer(start, { type: "set-home-motion-paused", value: true });
  record(
    "5-reducer",
    "pause-from-absent stores true",
    paused.homeMotionPaused === true,
    { home: paused.homeMotionPaused },
  );
}

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.pass === false);
console.log(`\nTOTAL=${results.length} FAILED=${failed.length}`);
