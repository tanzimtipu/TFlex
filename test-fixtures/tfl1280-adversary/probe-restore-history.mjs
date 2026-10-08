// ADV (TFL-1280, Phase 114 chunk H) — "Restore defaults" scope probe.
//
// The Settings Studio's confirm dialog promises, verbatim:
//   "Restores the appearance, tab, recent-files and import settings to their
//    defaults. Your documents, recent-files history, window layout and saved
//    signatures are kept."
// and phase-114.md criterion 9 says Restore defaults "restores settings only,
// never documents, history or user assets".
//
// The renderer's restoreDefaultSettings() spreads the live settings and lowers
// recentsCap to 10 while keeping recentFiles as-is; the whole object goes to the
// real SettingsService.save(), whose normalizeSettings() truncates recentFiles
// to recentsCap (settings.ts:1182, normalizeRecentFiles:427-428). This probe
// drives the REAL service and the REAL restoreDefaultSettings.
//
// Run from the repo root:
//   node --experimental-strip-types test-fixtures/tfl1280-adversary/probe-restore-history.mjs
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  SettingsService,
} from "../../src/main/services/settings.ts";
import { restoreDefaultSettings } from "../../src/renderer/state/defaults.ts";

const dir = await mkdtemp(join(tmpdir(), "tflex-adv1280-"));
const file = join(dir, "settings.json");
const errors = [];
const svc = new SettingsService(file, undefined, (m) => errors.push(m));

const mkRecent = (i) => ({
  path: `C:/docs/report-${i}.pdf`,
  name: `report-${i}.pdf`,
  openedAt: new Date(2024, 0, 1 + i).toISOString(),
});

const HISTORY = 15;
const CAP = 20;

// Seed a legitimate profile: 15 recent files, cap 20 (a user who raised the cap
// and accumulated history).
await svc.save({
  ...DEFAULT_SETTINGS,
  recentsCap: CAP,
  recentFiles: Array.from({ length: HISTORY }, (_, i) => mkRecent(i)),
});

const before = JSON.parse(await readFile(file, "utf8"));
console.log("=== seeded ===");
console.log("  recentsCap         :", before.recentsCap);
console.log("  recentFiles on disk:", before.recentFiles.length);

const current = svc.getCurrent();
const reset = restoreDefaultSettings(current);
console.log("=== restoreDefaultSettings (pure) ===");
console.log("  recentsCap         :", reset.recentsCap);
console.log("  recentFiles in obj :", reset.recentFiles.length, "(pure reset keeps them)");

// The Studio's onRestoreDefaults does applySettings(reset) + trackAndSave(reset),
// i.e. the whole object through the real service.
await svc.save(reset);

const after = JSON.parse(await readFile(file, "utf8"));
console.log("=== after Restore defaults (disk) ===");
console.log("  recentsCap         :", after.recentsCap);
console.log("  recentFiles on disk:", after.recentFiles.length);
console.log("  errors             :", errors.length);

const lost = before.recentFiles.length - after.recentFiles.length;
console.log(
  lost > 0
    ? `RESULT: LOSS — ${lost} recent-files history entries silently dropped, contradicting the scope promise.`
    : "RESULT: history kept as promised.",
);

await rm(dir, { recursive: true, force: true });
