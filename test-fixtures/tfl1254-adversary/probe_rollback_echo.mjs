// ADV-246 / DEF-637 probe (Phase 114 rollback coherence) — exercises the REAL
// shouldApplyEcho AND the REAL noteSettingsRestore used by App.tsx's
// settings.changed listener and onSettingsRestore.
//
// The renderer bookkeeping the chunk-C diff introduces:
//   settingsWriteSeqRef   -> `seq`
//   settingsPersistedRef  -> `ref`
//   onSettingsRestore     -> noteSettingsRestore(seq, ref, disk)
//
// Post-TFL-1262 the restore resets the local-write seq to 0 (disk is the source
// of truth again), so a legitimately newer settings.changed echo (a write issued
// before the failure that still reached disk) is applied instead of being
// dropped against the stale restore snapshot.
//
// Run from the repo root:
//   node --experimental-strip-types test-fixtures/tfl1254-adversary/probe_rollback_echo.mjs
import { shouldApplyEcho } from "../../src/renderer/state/settingsEcho.ts";
import { noteSettingsRestore } from "../../src/renderer/hooks/useSettingsWriteRollback.ts";

const geom = { x: 0, y: 0, width: 1440, height: 900, maximized: false };
const mk = (theme) => ({ theme, geometry: geom, recentFiles: [] });

const seqRef = { current: 0 };          // renderer settingsWriteSeqRef
const refRef = { current: null };       // renderer settingsPersistedRef
const trackAndSave = (s) => { seqRef.current += 1; refRef.current = s; };
const applyRestore = (disk) => { noteSettingsRestore(seqRef, refRef, disk); };

const P = mk("dark");    // last value that actually persisted to disk
const X = mk("frosted"); // write #1 (FAILS)
const Z = mk("light");   // write #2 (SUCCEEDS), issued after #1

trackAndSave(X);
trackAndSave(Z);
console.log("after two writes: seq =", seqRef.current);

console.log("echo Z without restore ->", shouldApplyEcho(Z, seqRef.current, refRef.current), "(expect true)");

applyRestore(P);         // write #1 failed; renderer re-read disk => P, seq resets to 0
console.log("after restore: ref =", JSON.stringify(refRef.current), "seq =", seqRef.current);

const applied = shouldApplyEcho(Z, seqRef.current, refRef.current);
console.log("echo Z AFTER restore ->", applied, "(true = legitimate newer value APPLIED)");
console.log("echo P AFTER restore ->", shouldApplyEcho(P, seqRef.current, refRef.current));
