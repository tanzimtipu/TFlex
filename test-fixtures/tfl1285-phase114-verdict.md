# TFL-1285 - Phase 114 phase-close verdict (qa)

Task type: Phase validation (phase-close verdict). Verdict per Phase 114
success criterion (`REQUIREMENTS.md:8605-8615`), over the whole phase diff.

## Bottom line

**FAIL.** Criteria 1, 2, 4 and 11 fail because the DEF-641 fix (TFL-1282,
the persistence-status footer) collapses `.settings-studio` to 0px and
overlaps the section navigator in the real app (DEF-646, HIGH). The
Restore-defaults work (DEF-644/DEF-645) is verified and closed.

## Commands and results

- `npm.cmd run verify` -> conventions: clean (405 source files); `tsc --noEmit` exit 0.
- `npx vitest run` the 9 `phase114_*` specs + `test/unit/main/settingsQueueFailure.test.ts`
  -> 10 files / 75 tests passed.
- `npx vitest run test/unit/renderer/phase113_dialogsNotices.test.tsx -t "rail tab"`
  -> 1 passed / 15 skipped (green). The file's stamp-chip test remains a
  concurrent-phase (TFL-1216) failure - out of scope for Phase 114.
- `npx playwright test e2e/phase114_settings_studio.spec.cjs e2e/tfl1280_adversary_restore.spec.cjs
  --config=e2e/playwright.dev.config.js` -> 9 passed, 1 failed (E1). Log `tfl1285_e2e.log`.
- DEF-644 probe: `node test-fixtures/tfl1280-adversary/probe-restore-history.bundle.mjs`
  -> `recentsCap 20`, `recentFiles 15`, `RESULT: history kept as promised.` (was LOSS-5).

## Per criterion

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | One surface; every entry point routes to the single Studio | **FAIL** | Ctrl+, / menu / Stage Rail gear open the Studio (e2e E5, E7), but the navigator cannot be clicked and the body is empty (DEF-646, e2e E1 timeout) |
| 2 | Layout fidelity (720-880 / 176px nav / body chrome) | **FAIL** | `.settings-studio` measures 0px; sheet 89px; DEF-646. E6's stacking/no-overflow assertions pass but the body collapse is a layout violation |
| 3 | Truthful inventory (existing IDs/values, no new field) | PASS | phase114 specs 75 green; no `AppSettings`/IPC change in the diff |
| 4 | Application model (immediate + Close + persistence feedback) | **FAIL** | `[data-prefs-persist-status]` exists (phase114_persistStatus 4/4) but is not visible/usable because DEF-646 collapses the sheet |
| 5 | Theme/pixels (semantic tokens; no PDF-pixel change) | PASS | e2e E2: four themes apply and persist; preference path does not touch page pixels |
| 6 | High contrast (forced-colors overrides fills; focus legible) | PASS | e2e E6 forced-colors capture; phase114_a11y 11 green |
| 7 | Motion (Animations preference; reduced motion wins) | PASS | e2e E3 animations gate; path unchanged this phase |
| 8 | Truthful subsystems (Storage locations browser; default-PDF handoff; next-import defaults) | PASS | phase114_documentsStorage 4 green; phase114_importRestore 10 green |
| 9 | Failure and restore defaults (prior value restored; scope stated; history kept) | PASS | DEF-644 closed (probe + e2e test 1), DEF-645 closed (unit 8/8 + e2e test 3); scope text shipped |
| 10 | Accessibility and adaptation (Escape/focus/200%/labels) | PASS | phase114_a11y 11 green; e2e E5, E6 green (see note under DEF-646 for navigator interaction) |
| 11 | Evidence and flow (inventory, CONTROL-INDEX sweep, runs, screenshots) | **FAIL** | Evidence delivered, but the phase cannot close green: CONTROL-INDEX row 1 FAIL (DEF-646), e2e E1 red |

CONTROL-INDEX sweep: 9 PASS, 1 FAIL (row 1), 1 PASS-with-caveat (row 9) -
see `test-fixtures/tfl1285-phase114-sweep.md`. Expected 10 PASS / 0 FAIL not met.

## Defect dispositions

- DEF-641: left OPEN (not closed) - its TFL-1282 fix introduces DEF-646.
- DEF-644 (ADV-253): CLOSED - history/cap preserved (probe + e2e).
- DEF-645 (ADV-254): CLOSED - double-failure fallback restores last confirmed (unit + e2e).
- DEF-646: filed OPEN, HIGH - the persistence-status footer wrapper collapses the Studio.
