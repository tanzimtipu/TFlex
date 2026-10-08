# TFL-1273 — Phase 114 CONTROL-INDEX sweep (qa)

Source row: REQUIREMENTS.md Phase 114 `CONTROL-INDEX` (`REQUIREMENTS.md:8617`).
Method: static handler trace in the working tree + the named proving test (run in
this task). Screenshots under `screenshots/phase114/`.

| # | Row (control) | Production handler | Proving test (status) | Verdict |
|---|---------------|--------------------|-----------------------|---------|
| 1 | category navigator `data-prefs-category` | `SettingsStudio.tsx:147` -> `onSelect` -> `PreferencesDialog.tsx:356` `setCategory` | `phase114_settingsStudio.test.tsx` (18 green) + e2e `phase114_settings_studio.spec.cjs` E1 (green) | PASS |
| 2 | Theme default `data-prefs-theme-default` | `PreferencesDialog.tsx:386-393` `onSetThemeDefault` + `onThemeChange` | `phase114_general.test.tsx` (5) + `prefsThemeImmediate.test.tsx` (13) + e2e E2 | PASS |
| 3 | Enable animations `data-prefs-animations` | `PreferencesDialog.tsx:414` `onSetAnimationsEnabled` | `phase23_animationsSwitch.test.tsx` (10) + e2e E3 | PASS |
| 4 | Tab style `data-prefs-tab-style` | `PreferencesDialog.tsx:430` `onSetTabStyle` | `prefsDialogRedesign.test.tsx` (16) + e2e E3 | PASS |
| 5 | Recent-files maximum `data-prefs-recents-cap` | `PreferencesDialog.tsx:457-463` `commitCap` on blur/Enter | `phase114_general.test.tsx` + e2e E3 | PASS |
| 6 | import defaults `data-prefs-convert-*` | `PreferencesDialog.tsx:538-659` `setConvert` / `commitMargin` / `commitFontSize` | `prefsConvertDefaults.test.tsx` (5) + `phase114_importRestore.test.tsx` (9) | PASS |
| 7 | default-PDF-app `data-prefs-default-pdf` + status | `PreferencesDialog.tsx:507` `openDefaultApps` -> sets `defaultAppsNotice` | `phase114_documentsStorage.test.tsx` (4) | PASS |
| 8 | Storage path buttons `.prefs-path` | `PreferencesDialog.tsx:303-308` `handleOpenPath` -> `window.tflex.app.openPath` | `phase114_documentsStorage.test.tsx` | PASS |
| 9 | persistence status `data-prefs-persist-status` | **ABSENT** — no element / hook in `src/renderer/**` | none; `docs/SETTINGS-STUDIO-INVENTORY.md:210` states it is "the remaining selector ... not yet in the source" | **FAIL (no-op)** |
| 10 | Restore defaults `data-prefs-restore-defaults` | `PreferencesDialog.tsx:482` -> ConfirmDialog -> host `onRestoreDefaults` (`App.tsx:13256` `restoreDefaultSettings`) | `phase114_importRestore.test.tsx` + e2e E4 | PASS |
| 11 | Close/Escape `data-prefs-dialog` | `DialogShell` `onClose` (`PreferencesDialog.tsx:347`) + focus return (`:230`) | `phase114_a11y.test.tsx` (11) + e2e E5 | PASS |

Result: 10 PASS, 1 FAIL (row 9 — persistence-status control is a no-op; filed
DEF-641, MEDIUM). Row 9 is the only CONTROL-INDEX entry with no production
handler; the immediate-setting persistence-feedback required by success
criterion 4 is therefore not rendered (only the global write-failure toast
exists).
