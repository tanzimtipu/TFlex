// @vitest-environment jsdom
//
// ADV-246 (diff-pass TFL-1254, Phase 114 chunk C) — rollback / echo coherence.
//
// The acceptance test for the escape the adversary probe found: after a failed
// settings write triggers a restore, a NEWER legitimate `settings.changed` echo
// (a second write issued before the failure that still reached disk) must be
// APPLIED, so the UI converges on disk. Before the fix, `onSettingsRestore` set
// `settingsPersistedRef` without advancing `settingsWriteSeqRef`, so the DEF-037
// echo filter discarded the newer echo against the stale restore snapshot.
//
// This wires the REAL `shouldApplyEcho` (the filter App.tsx's listener uses) to
// the REAL restore bookkeeping (`noteSettingsRestore`) with the exact decision
// inputs from `test-fixtures/tfl1254-adversary/probe_rollback_echo.mjs`.
// The normal (non-restore) path must be untouched — the last test guards it.

import { describe, expect, it } from "vitest";
import { shouldApplyEcho } from "../../../src/renderer/state/settingsEcho";
import { noteSettingsRestore } from "../../../src/renderer/hooks/useSettingsWriteRollback";
import type { AppSettings, AppTheme } from "../../../src/shared/types";

const geom = { x: 0, y: 0, width: 1440, height: 900, maximized: false };
const mk = (theme: AppTheme): AppSettings => ({ theme, geometry: geom, recentFiles: [] });

describe("settings rollback coherence (ADV-246)", () => {
  it("applies a newer legitimate echo after a restore resets the write seq", () => {
    // App-level bookkeeping, modelled exactly like the probe.
    const seq = { current: 0 }; // settingsWriteSeqRef
    const ref: { current: AppSettings | null } = { current: null }; // settingsPersistedRef
    const trackAndSave = (s: AppSettings): void => {
      seq.current += 1;
      ref.current = s;
    };
    const onEcho = (s: AppSettings): boolean => shouldApplyEcho(s, seq.current, ref.current);

    const P = mk("dark"); // last value that actually persisted to disk
    const X = mk("frosted"); // write #1 (FAILS)
    const Z = mk("light"); // write #2 (SUCCEEDS), issued after #1

    trackAndSave(X);
    trackAndSave(Z);
    expect(seq.current).toBe(2);
    expect(onEcho(Z)).toBe(true);

    // The pre-fix bookkeeping (ref = P, seq untouched) drops the newer echo.
    expect(shouldApplyEcho(Z, 2, P)).toBe(false);

    // The shipped restore bookkeeping (ADV-246).
    noteSettingsRestore(seq, ref, P);
    expect(ref.current).toBe(P);
    expect(seq.current).toBe(0);

    // Disk is authoritative again: the newer legitimate echo is APPLIED.
    expect(onEcho(Z)).toBe(true);
    expect(onEcho(P)).toBe(true);
  });

  it("does not weaken the DEF-037 stale-echo filter on the normal path", () => {
    // No restore: a local write advanced the seq, the echo carries OLDER
    // content (theme differs, geometry identical) -> discard.
    const Z = mk("light");
    const X = mk("frosted");
    expect(shouldApplyEcho(X, 2, Z)).toBe(false);
  });
});
