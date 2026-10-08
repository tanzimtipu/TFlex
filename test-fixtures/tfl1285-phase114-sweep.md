# TFL-1285 - Phase 114 CONTROL-INDEX close sweep (qa)

Source row: REQUIREMENTS.md Phase 114 `CONTROL-INDEX` (`REQUIREMENTS.md:8617`).
Method: named proving test run in this task + real-app e2e
(`e2e/phase114_settings_studio.spec.cjs`, `e2e/tfl1280_adversary_restore.spec.cjs`).
Screenshots under `screenshots/phase114/`. Supersedes
`test-fixtures/tfl1273-control-index-sweep.md` (row 9 was the only FAIL there).

| # | Row (control) | Production handler | Proving test (status) | Verdict |
|---|---------------|--------------------|-----------------------|---------|
| 1 | category navigator `data-prefs-category` | `SettingsStudio.tsx` -> `onSelect` -> `PreferencesDialog.tsx:369` `setCategory` | `phase114_settingsStudio.test.tsx` 18 green; e2e E1 **FAIL** | **FAIL (DEF-646)** |
| 2 | Theme default `data-prefs-theme-default` | `PreferencesDialog.tsx:404-405` `onSetThemeDefault` + `onThemeChange` | `phase114_general.test.tsx` 5 green + e2e E2 green | PASS |
| 3 | Enable animations `data-prefs-animations` | `PreferencesDialog.tsx` `onSetAnimationsEnabled` | e2e E3 green | PASS |
| 4 | Tab style `data-prefs-tab-style` | `PreferencesDialog.tsx:13562-13568` `onSetTabStyle` | `phase114_general.test.tsx` + e2e E3 green | PASS |
| 5 | Recent-files maximum `data-prefs-recents-cap` | `PreferencesDialog.tsx` `commitCap` on blur/Enter | `phase114_general.test.tsx` + e2e E3 green | PASS |
| 6 | import defaults `data-prefs-convert-*` | `PreferencesDialog.tsx` `setConvert` / `commitMargin` / `commitFontSize` | `phase114_importRestore.test.tsx` 10 green | PASS |
| 7 | default-PDF-app `data-prefs-default-pdf` + status | `PreferencesDialog.tsx` `openDefaultApps` | `phase114_documentsStorage.test.tsx` 4 green | PASS |
| 8 | Storage path buttons `.prefs-path` | `PreferencesDialog.tsx` `handleOpenPath` -> `window.tflex.app.openPath` | `phase114_documentsStorage.test.tsx` 4 green | PASS |
| 9 | persistence status `data-prefs-persist-status` | `PreferencesDialog.tsx:735` `role="status"`, `.settings-persist-status` | `phase114_persistStatus.test.tsx` 4 green (exists, role=status, outside `.settings-studio-body`) | PASS (unit) - in-app visibility moot while DEF-646 collapses the sheet |
| 10 | Restore defaults `data-prefs-restore-defaults` | `PreferencesDialog.tsx:482-750` -> host `onRestoreDefaults` (`App.tsx:13578-13583`) | `phase114_importRestore.test.tsx` + e2e E4 green | PASS |
| 11 | Close/Escape `data-prefs-dialog` | `DialogShell` `onClose` + focus return | `phase114_a11y.test.tsx` 11 green + e2e E5 green | PASS |

Result: **9 PASS, 1 FAIL (row 1), 1 PASS-with-caveat (row 9)**. Expected
10 PASS / 0 FAIL was not reached: row 9's control now exists (TFL-1276/1282)
but the DEF-641 fix's footer wrapper collapses `.settings-studio` to 0px and
overlaps the navigator, so e2e E1's real click on `[data-prefs-category]`
times out (DEF-646, HIGH). Rows 2-8, 10, 11 keep working because they are
driven by `selectOption` / `fill` / Escape, which do not hit-test the
collapsed body; the layout defect still leaves the Studio visually broken.
