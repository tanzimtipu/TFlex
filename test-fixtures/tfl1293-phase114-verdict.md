# TFL-1293 - Phase 114 re-verdict after the TFL-1290 layout fix (qa)

Task type: FIX-READY defect retest + CONTROL-INDEX re-sweep. This re-states
only the criteria that FAILed at TFL-1285 (1, 2, 4, 11); the others were PASS
then and are unchanged. Verdict per Phase 114 success criterion
(`REQUIREMENTS.md:8605-8615`).

## Bottom line

The DEF-646 layout regression is fixed. `.settings-studio` measures 838x436
(was 0), the sheet sizes to 525px (was 89px), the nav click lands, and the
persistence footer is pinned and visible full and compact. Criteria 1, 2, 4
and 11 now PASS. DEF-641 and DEF-646 are CLOSED.

## Commands and results

- `npm.cmd run build` -> clean (typecheck + renderer + node builds).
- `npm.cmd run verify` -> conventions clean (406 source files); `tsc --noEmit` exit 0.
- `npx playwright test e2e/phase114_settings_studio.spec.cjs -c e2e/playwright.dev.config.js`
  -> **7 passed** (E1 green; log `test-fixtures/tfl1293_e2e.log`).
  E1 geometry: `studio` 838x436, `shell` 470, sheet 525, persist footer 838x34
  at the sheet bottom, `elementFromPoint` at the nav centre = `settings-nav-label`.
- `npx playwright test e2e/tfl1293_scope_footer.spec.cjs -c e2e/playwright.dev.config.js`
  -> **2 passed** (scope + footer; log `test-fixtures/tfl1293_scope.log`).
- `npx vitest run test/unit/renderer/phase114_persistStatus.test.tsx` -> 4 passed.
- `npx vitest run` the 9 `phase114_*` specs + `test/unit/main/settingsQueueFailure.test.ts`
  -> 10 files / **76 tests passed**.

## Per criterion (the four that failed at TFL-1285)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | One surface; every entry point routes to the single Studio | **PASS** | Ctrl+, / menu (E1, E5) / Stage Rail gear (E7) open the Studio; all four `[data-prefs-category]` panels render non-zero and the real nav click succeeds (E1) |
| 2 | Layout fidelity (720-880 / nav / body chrome) | **PASS** | `.settings-studio` 838x436, sheet 525 (both non-zero, capped by max-height); E6 stacking/no-overflow still green; body scrolls internally |
| 4 | Application model (immediate + Close + persistence feedback) | **PASS** | `[data-prefs-persist-status]` (phase114_persistStatus 4/4) is now visible and pinned in the real app (S2, full + 520px compact); "All changes saved." at rest |
| 11 | Evidence and flow (inventory, CONTROL-INDEX sweep, runs, screenshots) | **PASS** | CONTROL-INDEX 10 PASS / 0 FAIL (`tfl1293-control-index-sweep.md`); e2e 9/9 across the two specs; screenshots `studio-full-footer.png`, `studio-compact-footer.png`, `studio-{general,documents,import,storage}.png` |

Unchanged PASS criteria (3, 5, 6, 7, 8, 9, 10) at TFL-1285: not re-run beyond
the suite above, which stayed green.

## Scope check (item 6)

The fix's only non-`.settings-*` selector is
`.sheet-body-prefs:has(> .settings-studio-shell)`. `sheet-body-prefs` is used by
`PreferencesDialog.tsx:363` alone (every other sheet uses a distinct body class:
`sheet-body-update-prompt`, etc.), and the `:has()` clause additionally requires
a direct `.settings-studio-shell` child, which only the Studio renders. Real-app
check `e2e/tfl1293_scope_footer.spec.cjs` S1: 0 `.sheet-body-prefs` on Home and
0 on a document surface; exactly 1 when the Studio is open, computed
`display:flex`, shell a direct child, `.settings-studio` height 436. No
regression outside the Preferences sheet.

## Defect dispositions

- DEF-641: **CLOSED** - control visible/usable; unit + real-app evidence.
- DEF-646: **CLOSED** - E1 green, geometry non-zero, footer pinned; scope confined.
