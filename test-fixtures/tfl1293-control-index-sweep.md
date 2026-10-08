# TFL-1293 - Phase 114 CONTROL-INDEX re-sweep (qa)

Source row: REQUIREMENTS.md Phase 114 `CONTROL-INDEX` (`REQUIREMENTS.md:8617`).
Method: named proving test run in this task plus real-app e2e.
Screenshots under `screenshots/phase114/`. Supersedes
`test-fixtures/tfl1285-phase114-sweep.md` (row 1 FAIL, row 9 PASS-with-caveat).

| # | Row (control) | Production handler | Proving test (status) | Verdict |
|---|---------------|--------------------|-----------------------|---------|
| 1 | category navigator `data-prefs-category` | `SettingsStudio.tsx` -> `onSelect` -> `PreferencesDialog.tsx:369` `setCategory` | `phase114_settingsStudio.test.tsx` 18 green; e2e E1 **PASS** (real click lands; 4/4 panels non-zero, one active) | **PASS** |
| 2 | Theme default `data-prefs-theme-default` | `PreferencesDialog.tsx:404-405` `onSetThemeDefault` + `onThemeChange` | `phase114_general.test.tsx` 5 green + e2e E2 green | PASS |
| 3 | Enable animations `data-prefs-animations` | `PreferencesDialog.tsx` `onSetAnimationsEnabled` | e2e E3 green | PASS |
| 4 | Tab style `data-prefs-tab-style` | `PreferencesDialog.tsx:13562-13568` `onSetTabStyle` | `phase114_general.test.tsx` + e2e E3 green | PASS |
| 5 | Recent-files maximum `data-prefs-recents-cap` | `PreferencesDialog.tsx` `commitCap` on blur/Enter | `phase114_general.test.tsx` + e2e E3 green | PASS |
| 6 | import defaults `data-prefs-convert-*` | `PreferencesDialog.tsx` `setConvert` / `commitMargin` / `commitFontSize` | `phase114_importRestore.test.tsx` 10 green | PASS |
| 7 | default-PDF-app `data-prefs-default-pdf` + status | `PreferencesDialog.tsx` `openDefaultApps` | `phase114_documentsStorage.test.tsx` 4 green | PASS |
| 8 | Storage path buttons `.prefs-path` | `PreferencesDialog.tsx` `handleOpenPath` -> `window.tflex.app.openPath` | `phase114_documentsStorage.test.tsx` 4 green | PASS |
| 9 | persistence status `data-prefs-persist-status` | `PreferencesDialog.tsx:735` `role="status"`, `.settings-persist-status` | `phase114_persistStatus.test.tsx` 4 green (exists, role=status, outside `.settings-studio-body`); e2e S2 green (visible, pinned footer, full + 520px compact) | **PASS** |
| 10 | Restore defaults `data-prefs-restore-defaults` | `PreferencesDialog.tsx:482-750` -> host `onRestoreDefaults` (`App.tsx:13578-13583`) | `phase114_importRestore.test.tsx` + e2e E4 green | PASS |
| 11 | Close/Escape `data-prefs-dialog` | `DialogShell` `onClose` + focus return | `phase114_a11y.test.tsx` 12 green + e2e E5 green | PASS |

Result: **10 PASS, 0 FAIL.** Row 1 is now PASS: the TFL-1290 fix gives the
Studio a definite height (`.settings-studio` 838x436, was 0) so E1's real click
on `[data-prefs-category]` reaches `settings-nav-label`. Row 9 is now PASS
without caveat: the pinned footer is visible and non-scrolling in the real app
(`e2e/tfl1293_scope_footer.spec.cjs` S2), not only in jsdom.

Expected 10 PASS / 0 FAIL reached.
