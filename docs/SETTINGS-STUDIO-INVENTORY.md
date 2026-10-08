# Settings Studio inventory and application-model audit (TFL-1226, Phase 114 chunk A)

Scope: a truthful, read-only inventory of every Preferences/Themes surface the
installed app exposes today, the setting behind each control, its application
timing and persistence path, and whether the current application model can
render it truthfully. This document changes no source. It is the input the CTO
uses to write Phase 114 chunks B-F and the seed for qa's CONTROL-INDEX sweep.

All `file:line` anchors below were read in this repo at audit time. Where a
setting has no backing `AppSettings` field, that is stated explicitly (nothing
is invented). "Renderer-only" means the value crosses no new IPC.

The Phase 114 target and its fixed selectors live in
`docs/phase-specs/phase-114.md:59` (CONTROL-INDEX block). This audit predates
the migration: the rows below describe what ships today, not the Studio.

## 1. Entry points / surfaces

Every route that reaches the Preferences state (`prefsOpen`), plus the
keyboard route to the theme state. The single host state is
`const [prefsOpen, setPrefsOpen] = useState(false)` (`src/renderer/App.tsx:1148`).

| # | Surface | Command id / action | Accelerator | Handler `file:line` | Selector reached | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Renderer app-menu model (Edit group) | id `prefs`, action `preferences` | `Ctrl+,` | row `src/renderer/App.tsx:9893` | `.titlebar-menu-row` / `[data-menu-action]` | Source of the popover row rendered by TitleBar and AppHeader |
| 2 | Native application menu (Edit) | action `preferences` | `CmdOrCtrl+,` | `src/main/menu.ts:118-120` (`click: () => send('preferences')`) | OS menu | Main pushes `menu:action` |
| 3 | Menu dispatch | action `preferences` | n/a | `src/renderer/state/menuActions.ts:107,120` (`case 'preferences': ctx.preferences()`) | n/a | Shared dispatcher for native menu, TitleBar popover (`TitleBar.tsx:226`), AppHeader popover (`AppHeader.tsx:246`) |
| 4 | Menu context | `preferences` | n/a | `src/renderer/App.tsx:5510-5512` (`setPrefsOpen(true)`) | n/a | The host handler the dispatcher calls |
| 5 | Command palette | `preferences` | `Ctrl+,` (label only) | `src/renderer/App.tsx:11223` (`preferences: () => setPrefsOpen(true)`); registry `src/renderer/state/toolsRegistry.ts:1311-1319` | palette row | Same host state |
| 6 | Home editable tool row | `preferences` | n/a | `src/renderer/App.tsx:11295` (`preferences: () => setPrefsOpen(true)`); candidates `:11315` | Home tile / picker | Runs only when a Home tile is set to Preferences |
| 7 | Stage Rail gear | n/a (direct) | n/a | `src/renderer/App.tsx:11711` (`onOpenPreferences={() => setPrefsOpen(true)}`); prop `StageRail.tsx:81,161` | `.stage-rail` gear button | Document surfaces only (not Home) |
| 8 | Header / theme control | retired | n/a | `src/renderer/App.tsx:1807-1811` | none | The borderless 4-option theme picker was RETIRED from the title row (Phase 105 chunk C). No live header theme control exists today. |
| 9 | Theme keyboard/menu route | action `toggleTheme` | `Ctrl+Shift+T` | menu row `App.tsx:9900`; native `src/main/menu.ts:128-130`; palette `App.tsx:11222`; Home tile `App.tsx:11301`; handler `onToggleTheme` `App.tsx:1790-1805` | n/a | Reaches the same theme state as the Preferences dropdown, via `applyToggleTheme` |
| 10 | Dialog mount / host wiring | n/a | n/a | `src/renderer/App.tsx:13138-13222` | `[data-prefs-dialog]` | `<PreferencesDialog>`; all setters listed in section 2 |

The Preferences sheet's own trigger inside the sheet queries the app-menu
button for focus return: `document.querySelector('[data-app-menu]')`
(`src/renderer/components/PreferencesDialog.tsx:195`, DEF-611).

## 2. Setting table

Controls rendered today by `src/renderer/components/PreferencesDialog.tsx` in
four categories (General / Documents / Import & conversion / Storage;
`PreferencesDialog.tsx:141-146`, all panels stay mounted, `:377-695`).

`data-prefs-*` hooks preserved exactly through the Phase 59 redesign
(`PreferencesDialog.tsx:7-9`).

| Setting | Control + selector | Backing field | Default / value source `file:line` | Scope | Application timing | Persistence path | Capability predicate | Theme / motion integrated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Theme default | `<select>` `data-prefs-theme-default` (`PreferencesDialog.tsx:400-418`) | `themeDefault` (plus concrete `theme`) | default `frosted`; `state/defaults.ts:12`, `main/services/settings.ts:312-313`; absent resolves to `settings.theme` `App.tsx:13143` | Global appearance | Immediate (live flip) + persists for next launch | `onSetThemeDefault` -> `applyThemeDefault` -> `trackAndSave` `App.tsx:13145-13163` | none (always rendered) | Yes: `resolveThemeDefault` `state/theme.ts:22-30`, `useThemeTransition` |
| Enable animations | `<input type=checkbox>` `data-prefs-animations` (`PreferencesDialog.tsx:427-434`) | `animationsEnabled` | default `true` (ON); reducer `state/preferences.ts:250-257` | Global motion | Immediate (CSS root hook + module store) | `onSetAnimationsEnabled` -> `trackAndSave` `App.tsx:13191-13201` | none; OS reduced motion always wins (`hooks/motionPolicy.ts:33-38`) | Yes: `motionPolicy.ts:58-63`, `useAnimations.ts` |
| Tab style | `<select>` `data-prefs-tab-style` (`PreferencesDialog.tsx:443-452`) | `tabStyle` | default `colorful`; `state/preferences.ts:37`, `main/services/settings.ts:324,354,1463-1464` | Action Dock tabs | Immediate (host state) + persists | `onSetTabStyle` -> reducer -> `trackAndSave` `App.tsx:13214-13220` | `onSetTabStyle !== undefined` gates the row `PreferencesDialog.tsx:436` | No (not motion) |
| Recent-files maximum | `<input type=number>` `data-prefs-recents-cap` (`PreferencesDialog.tsx:465-482`) | `recentsCap` | default `10`; `state/preferences.ts:26`, `main/services/settings.ts:42`; clamp 1..50 `preferences.ts:164-171` | Home recents list | Next launch (list is built at boot) `PreferencesDialog.tsx:24-29,463` | `onSetRecentsCap` -> reducer -> `trackAndSave` `App.tsx:13182-13189` | none | No |
| Windows default-PDF-app handoff | `<button>` `data-prefs-default-pdf` + status `data-prefs-default-pdf-status` (`PreferencesDialog.tsx:498-511`) | none (an action, not a setting) | n/a | OS file association | Immediate (opens Windows settings) | `openDefaultAppsSettings()` IPC `PreferencesDialog.tsx:302-326` | `app?.openDefaultAppsSettings` runtime check `PreferencesDialog.tsx:306` | No |
| Page size | `<select>` `data-prefs-convert-page-size` (`PreferencesDialog.tsx:523-532`) | `convertDefaults.pageSize` | default `a4`; `shared/convert.ts:235-242` | Import pipeline | Next import `PreferencesDialog.tsx:642` | `onSetConvertDefaults` -> `trackAndSave` `App.tsx:13202-13210` | `onSetConvertDefaults?.` optional `PreferencesDialog.tsx:288` | No |
| Margin (mm) | `<input type=number>` `data-prefs-convert-margin` (`PreferencesDialog.tsx:538-555`) | `convertDefaults.marginMm` | default `20`; clamp 5..50 `PreferencesDialog.tsx:97-108`, validator `main/services/settings.ts:679-690` | Import pipeline | Next import | same as above | optional | No |
| Text font | `<select>` `data-prefs-convert-font` (`PreferencesDialog.tsx:561-571`) | `convertDefaults.textFontFamily` | default `Inter`; allowlist `PreferencesDialog.tsx:86-94`, `main/services/settings.ts:659` | Import pipeline | Next import | same as above | optional | No |
| Text font size (pt) | `<input type=number>` `data-prefs-convert-font-size` (`PreferencesDialog.tsx:577-594`) | `convertDefaults.textFontSizePt` | default `11`; clamp 6..48 `PreferencesDialog.tsx:99-116` | Import pipeline | Next import | same as above | optional | No |
| CSV delimiter | `<select>` `data-prefs-convert-delimiter` (`PreferencesDialog.tsx:600-611`) | `convertDefaults.csvDelimiter` | default `auto`; `shared/convert.ts:240` | Import pipeline | Next import | same as above | optional | No |
| Map CSV columns to form fields | `<input type=checkbox>` `data-prefs-convert-csv-mapping` (`PreferencesDialog.tsx:617-624`) | `convertDefaults.csvFormMapping` | default `true`; `shared/convert.ts:241` | Import pipeline | Next import | same as above | optional | No |
| Print HTML backgrounds | `<input type=checkbox>` `data-prefs-convert-html-backgrounds` (`PreferencesDialog.tsx:630-637`) | `convertDefaults.htmlPrintBackgrounds` | default `true`; `shared/convert.ts:242` | Import pipeline | Next import | same as above | optional | No |
| User-data location | `<Button>` `.prefs-path` (`PreferencesDialog.tsx:653-664`) | none (informational) | `AppInfo.storagePaths.userData` `main/index.ts:1230` | OS filesystem | Immediate (opens folder) | `app.openPath` IPC `PreferencesDialog.tsx:291-296` | `tflex?.app?.openPath` runtime check `:294` | No |
| Settings-file location | `<Button>` `.prefs-path` (`PreferencesDialog.tsx:665-676`) | none (informational) | `AppInfo.storagePaths.settings` `main/index.ts:1231` | OS filesystem | Immediate | same as above | runtime check | No |
| Saved-signatures location | `<Button>` `.prefs-path` (`PreferencesDialog.tsx:677-688`) | none (informational) | `AppInfo.storagePaths.signatures` `main/index.ts:1232` | OS filesystem | Immediate | same as above | runtime check | No |

Totals: **15 rendered rows** = 11 backed by an `AppSettings` field
(`themeDefault`, `theme`, `animationsEnabled`, `tabStyle`, `recentsCap`, and the
seven `convertDefaults` keys) + 3 informational location rows (no field; from
`AppInfo.storagePaths`) + 1 action row (the default-PDF-app handoff; no field).

Storage paths are loaded on sheet open from `app.getInfo()`
(`PreferencesDialog.tsx:233-245`) with a fallback literal
(`PreferencesDialog.tsx:118-123`) so a missing bridge renders `unavailable`
without a crash.

## 3. Application model verdict per setting

Verdicts: **supported** (the app can render it truthfully today with the model
it already has), **needs a capability-backed extension** (the preference or its
feedback does not exist yet and must be built without inventing capability), or
**unsupported** (cannot be rendered truthfully).

| Setting | Verdict | Reason |
| --- | --- | --- |
| Theme default (+ concrete `theme`) | supported | Atomic write via `applyThemeDefault` (`state/theme.ts:38-47`) keeps `theme` and `themeDefault` coherent; `system` resolves at pick/boot time |
| Enable animations | supported | Persisted boolean, live module store + CSS root hook; OS reduced motion wins (`motionPolicy.ts:33-38`) |
| Tab style | supported | Persisted enum, validated both sides (`preferences.ts:155-163`, `settings.ts:1463-1464`) |
| Recent-files maximum | supported, next-launch | Holds today; a live trim would need a backend `addRecentFile` honour pass (`PreferencesDialog.tsx:24-29`) |
| Windows default-PDF-app handoff | supported | Honest action: opens `ms-settings:defaultapps`, never claims to set the default (`os-links.ts:78-87`, hint `PreferencesDialog.tsx:298-326,493-496`) |
| Import & conversion defaults (7 keys) | supported, next-import | Each validated preserve-if-valid; a present invalid value rejects the whole field (`settings.ts:668-732`) |
| Storage locations (3) | supported | Locations browser only; no cache metric or cleanup exists in the app (`AppInfo.storagePaths`, `main/index.ts:1229-1234`) |
| Persistence-failure rollback | supported (Phase 114 chunk C; hardened TFL-1262) | See 3a: `useSettingsWriteRollback` re-reads the rolled-back settings (falling back to the last confirmed value when the re-read fails) and `App.tsx` applies them through the shared `applySettings` path |
| Restore defaults | supported (Phase 114 chunk E) | See 3b: scoped, confirmed reset composed from the renderer defaults; button `data-prefs-restore-defaults` (`PreferencesDialog.tsx`), host `onRestoreDefaults` (`App.tsx`) |
| Home decorative-motion pause (`homeMotionPaused`) | supported on its own surface | Persisted boolean owned by the Home Screen; NOT rendered in the Preferences sheet today (`App.tsx:11752-11763`, `Welcome.tsx:332-352`) |

### 3a. `settings:writeError` rollback — the renderer keeps the unpersisted value today

On a failed write the main process restores its in-memory `current` to the last
snapshot that reached disk and fires `onWriteError`; it does NOT emit
`settings:changed` (`main/services/settings.ts:1615-1638`: the `catch` restores
`this.persisted` and calls `this.onWriteError?.(msg)`; `onChange` is only called
on the success path at `:1625`).

The renderer writes optimistically: every preferences setter calls
`setSettings(updated)` and only then `trackAndSave(updated)`
(`App.tsx:13145-13222`, `trackAndSave` `:1459-1463`). Historically the only error
signal was a toast: the `settings.writeError` subscription pushed
`Settings could not be saved: <message>` (`App.tsx:1891-1899`). The
`settings.changed` echo filter (`state/settingsEcho.ts:430-458`) never runs on a
failed write because no echo fires, so the renderer's `settings` state kept the
new, unpersisted value while main had rolled back.

**Verdict (audit time): the renderer did NOT keep showing the committed value
after a rollback — wrong way round.** It kept showing the NEW (unpersisted)
value; Phase 114 chunk C/D had to make the UI restore the prior value on a
`settings:writeError` (use the toast as the actionable error). This is the
"restores the prior value in the UI" requirement at `phase-114.md:21,55`. No new
IPC or field is needed — `settings:writeError` already carries the message.

**Resolved (Phase 114 chunk C, TFL-1239; hardened TFL-1262 for ADV-246/247).** The renderer now restores the prior
value: `src/renderer/hooks/useSettingsWriteRollback.ts` reports the error toast,
then re-reads `window.tflex.loadSettings()` and hands the rolled-back settings to
`onRestore`, which applies them through the one shared `applySettings` path in
`App.tsx`. On restore it also resets the local-write seq (`noteSettingsRestore`),
so the DEF-037 echo filter treats disk as authoritative again: a newer legitimate
`settings.changed` echo (a write issued before the failure that still reached
disk) is applied rather than discarded against the stale restore snapshot
(ADV-246). When the re-read resolves `ok:false` or rejects, restore falls back to
the last confirmed settings (`lastConfirmedRef`, updated on every applied echo)
so the UI still drops the unpersisted value (ADV-247). Pinned by
`test/unit/renderer/phase114_settingsRollback.test.tsx` and
`test/unit/renderer/phase114_rollbackCoherence.test.tsx`.

### 3b. Restore defaults — the capability-backed extension

There is no `Restore defaults`, `reset`, or `resetSettings` command, menu row,
palette entry, dialog button or IPC handler anywhere in `src/`. Confirmed by
searching `src/` for reset-to-default verbs: the only matches are unrelated
(per-dialog state resets and password-reset flows in `components/AccountsDialog.tsx`).
The backend has no reset handler either; it exposes only `load` / `save` /
`saveCurrent` / `saveGeometryOnly` / `addRecentFile`
(`main/services/settings.ts:1552-1644`).

**Verdict: needs a capability-backed extension.** Per `phase-114.md:21,55` it
must state its scope in the UI and restore settings ONLY — never documents,
document history, saved signatures or other user assets. It can compose the
renderer-side defaults (`state/defaults.ts:7-34` +
`DEFAULT_CONVERT_DEFAULTS` `shared/convert.ts:235-242`) and write through the
existing `settings:save` channel; no new field, no new IPC.

**Resolved (Phase 114 chunk E, TFL-1267; amended TFL-1282 for DEF-643 / DEF-644).**
The extension shipped renderer-only. `restoreDefaultSettings(current)`
(`state/defaults.ts`) spreads `current` and sets only the five Studio-surfaced
appearance / tab / import fields (`theme` / `themeDefault` to `frosted`,
`animationsEnabled` true, `tabStyle` `colorful`, `convertDefaults` a fresh
`DEFAULT_CONVERT_DEFAULTS`), preserving `recentFiles`, `recentsCap`, `geometry`
and every other field. **DEF-643:** the reset deliberately does NOT lower
`recentsCap` — the backend trims `recentFiles` to the cap on every save
(`main/services/settings.ts:1182-1190`, `:427-428`), so lowering it here would
silently truncate the history the scope text promises to keep. The General
panel's Reset group (`PreferencesDialog.tsx`) states the truthful scope verbatim
(`RESTORE_DEFAULTS_SCOPE`), opens the shared `ConfirmDialog`
(`title="Restore default settings?"`), and only on confirm calls the host
`onRestoreDefaults` (`App.tsx`), which composes `applySettings(reset, false)` +
`trackAndSave(reset)`. **DEF-644:** that optimistic apply is NOT recorded as the
"last confirmed" snapshot (only a persisted echo / authoritative restore is), so
a failed write plus a failed re-read falls back to the last confirmed settings,
never the unpersisted reset. **TFL-1282 (adversary should-fix):** the
persistence-feedback line (`data-prefs-persist-status`) is pinned outside the
scrolling `.settings-studio-body` as a non-scrolling footer row of
`.settings-studio-shell`, so the honest failure sentence stays visible on the
long panels. No command, menu row, IPC or `AppSettings` field was added. Pinned
by `test/unit/renderer/phase114_importRestore.test.tsx`,
`phase114_settingsRollback.test.tsx` and `phase114_persistStatus.test.tsx`.

## 4. Overlap seams

Each seam has an owning surface. The Studio coordinates with it; it must not
fork or rebuild it (`phase-114.md:14`).

| Seam | Owner surface | Current fork? |
| --- | --- | --- |
| Header theme control (Top Bar and Tabs) | Retired from the title row (Phase 105 chunk C, `App.tsx:1807-1811`). Live routes are View > Toggle Theme (menu row `App.tsx:9900`, native `menu.ts:128-130`, `Ctrl+Shift+T`) and the Preferences dropdown (`data-prefs-theme-default`). Both drive the one handler `onToggleTheme` (`App.tsx:1790`) / `onSetThemeDefault` (`:13145`) into the one store. | No header control exists to fork. The Studio must not re-introduce a header picker or a second theme store. |
| Home decorative motion (Home Screen / `useOrbitMotion`) | `Welcome.tsx` + `hooks/useOrbitMotion.ts` + `utils/orbitMotion.ts`, gate `shouldAnimateOrbit`. Pause is `homeMotionPaused`, owned by the Home Screen toggle (`Welcome.tsx:335-352`, wired `App.tsx:11749-11763`). | No. The Preferences sheet renders no Home-motion control today; the Studio must not fork the pause or the orbit policy. |
| Home recent grid (recent-files list) | `Welcome.tsx` `orbit-desk-recents` grid (`Welcome.tsx:510-537`) over `recentDisplays`; list is built at boot and mutated through `addRecentFile` / echo (`state/settingsEcho.ts:275-321`). | No. `recentsCap` is a General setting (next launch); the Studio must not render its own recents list or trim live. |
| Windows default-PDF-app handoff | Native shell: main `services/os-links.ts:78-87` + handler `main/index.ts:1262`; `IPC.appOpenDefaultAppsSettings` (`shared/ipc.ts:157`). | No fork today. The Preferences Documents section is a presentational entry point that calls the IPC; the Studio keeps that. |
| Storage browsing | Native shell: `app.openPath` handler `main/index.ts:1239-1244`; `AppInfo.storagePaths` `main/index.ts:1229-1234`. | No fork today. The Studio keeps the locations-browser behaviour; it must not add metrics/cleanup. |

## 5. `data-prefs-*` control map

Every hook rendered today and the handler it fires. This is the seed for the
Phase 114 CONTROL-INDEX sweep (the target selectors qa will sweep are listed in
`phase-114.md:59`; the hooks below are what exists now and must keep working).

| Selector | Element | Handler fired | `file:line` |
| --- | --- | --- | --- |
| `data-prefs-dialog` | `DialogShell` sheet root | `onClose` -> `setPrefsOpen(false)` | `PreferencesDialog.tsx:337`; host `App.tsx:13140` |
| `data-prefs-category={general\|documents\|import\|storage}` | category rail `role=tab` buttons | `selectCategory(cat.id)` (roving tabindex) | `PreferencesDialog.tsx:364,198-219` |
| `data-prefs-panel={...}` | `role=tabpanel` containers | visibility only (`hidden={!isActive}`) | `PreferencesDialog.tsx:387-389` |
| `data-prefs-theme-default` | theme `<select>` | `onSetThemeDefault(next)` + `onThemeChange(next)` | `PreferencesDialog.tsx:404-412`; host `App.tsx:13145,13168` |
| `data-prefs-animations` | animations checkbox | `onSetAnimationsEnabled(checked)` | `PreferencesDialog.tsx:432`; host `App.tsx:13191` |
| `data-prefs-tab-style` | tab-style `<select>` | `onSetTabStyle(value)` | `PreferencesDialog.tsx:447`; host `App.tsx:13214` |
| `data-prefs-recents-cap` | recents `<input type=number>` | `commitCap()` on blur/Enter -> `onSetRecentsCap` | `PreferencesDialog.tsx:247-254,474-480`; host `App.tsx:13182` |
| `data-prefs-default-pdf-section` | Documents section wrapper | none (container) | `PreferencesDialog.tsx:489` |
| `data-prefs-default-pdf` | `Make Jovrel the default PDF app` button | `openDefaultApps()` | `PreferencesDialog.tsx:501,302-326` |
| `data-prefs-default-pdf-status` | `role=status` outcome line | none (shows `defaultAppsNotice`) | `PreferencesDialog.tsx:509` |
| `data-prefs-convert-section` | Import section wrapper | none (container) | `PreferencesDialog.tsx:517` |
| `data-prefs-convert-page-size` | page-size `<select>` | `setConvert('pageSize', ...)` | `PreferencesDialog.tsx:527,284-289` |
| `data-prefs-convert-margin` | margin `<input type=number>` | `commitMargin()` on blur/Enter | `PreferencesDialog.tsx:256-268,547-553` |
| `data-prefs-convert-font` | font `<select>` | `setConvert('textFontFamily', ...)` | `PreferencesDialog.tsx:565` |
| `data-prefs-convert-font-size` | font-size `<input type=number>` | `commitFontSize()` on blur/Enter | `PreferencesDialog.tsx:270-282,586-592` |
| `data-prefs-convert-delimiter` | delimiter `<select>` | `setConvert('csvDelimiter', ...)` | `PreferencesDialog.tsx:604` |
| `data-prefs-convert-csv-mapping` | mapping checkbox | `setConvert('csvFormMapping', ...)` | `PreferencesDialog.tsx:622` |
| `data-prefs-convert-html-backgrounds` | backgrounds checkbox | `setConvert('htmlPrintBackgrounds', ...)` | `PreferencesDialog.tsx:635` |
| `data-prefs-restore-defaults` | Reset group button (chunk E) | opens `ConfirmDialog`; on confirm fires host `onRestoreDefaults` | `PreferencesDialog.tsx` (chunk E); host `App.tsx` |
| `data-prefs-persist-status` | `role=status` persistence-feedback line (DEF-641) | none (shows the host `persistStatus`; at-rest default `All changes saved.`) | `PreferencesDialog.tsx` (Studio body); host `App.tsx` |
| `.prefs-path` (no `data-` hook today) | three Storage location buttons | `handleOpenPath(paths.userData\|settings\|signatures)` | `PreferencesDialog.tsx:291-296,653-688` |

Phase 114 chunks C/D/E migrated the four categories onto the Studio
primitives; the `data-prefs-*` hooks above are unchanged (the audit's
`file:line` anchors point at the pre-migration source). The extension hooks
`data-prefs-restore-defaults` (chunk E) and `data-prefs-persist-status`
(DEF-641, criterion 4 persistence feedback) both exist in the Studio source.

## 6. Unsupported-capability list

Reference behaviours the app cannot support truthfully; they must never be
rendered.

1. **Silently setting the default PDF handler.** The app only opens Windows'
   Default-apps page (`os-links.ts:35,78-87`); Windows does not allow an
   installer to set it. No control may claim the app changed the default.
2. **Storage cache metrics or cleanup actions.** `AppInfo.storagePaths` is the
   only storage data the backend exposes (`main/index.ts:1229-1234`; the
   `cache` path is not even rendered). There is no size, usage, or cleanup IPC.
3. **A `Restore defaults` action today.** No command, handler or IPC exists
   (section 3b). It is a capability-backed extension (settings-only), not a
   current capability. *(Resolved Phase 114 chunk E, TFL-1267: shipped
   renderer-only with no new command/IPC — see 3b.)*
4. **A fabricated "Apply"/"Cancel" footer for immediate settings.** Theme,
   animations, tab style and the location buttons apply immediately
   (`phase-114.md:16`); the correct model is Close plus persistence feedback.
5. **Network / cloud settings.** The app is offline-first by scope
   (`phase-114.md:13`); no network configuration belongs in the Studio.
6. **New density or layout controls.** Explicitly out of scope
   (`phase-114.md:9,16`); no panel-width, compact-mode or spacing preference is
   offered beyond what ships.
7. **Live OS theme tracking for `System`.** `resolveThemeDefault` resolves
   `system` at decision time (`state/theme.ts:22-30`); there is no live
   `prefers-color-scheme` watcher that re-applies mid-session, so the Studio
   must not claim it follows the OS continuously.
8. **Invented settings, timings, selectors or scope.** Every row above is
   anchored to live code; anything without a `file:line` must not be rendered.
9. **A re-introduced header theme picker.** Retired in Phase 105 chunk C
   (`App.tsx:1807-1811`); the Studio must not fork the theme control back into
   the Top Bar or Tabs.
10. **Any preference that recolors PDF page pixels or changes document
    content.** Preferences only change chrome (`phase-114.md:17,51`).

## Verification and method

This is an audit-and-record task: no file under `src/`, `test/`, `e2e/`,
`scripts/` or any config was changed. `npm.cmd run typecheck` is run to prove
the source is unchanged and must pass unchanged (result recorded in the task
report, not here).

Sources read in full or at the anchored ranges: `components/PreferencesDialog.tsx`;
`App.tsx` (9893, 11223, 11295, 13138-13222, 1883-1899, plus 1148, 1408-1600,
1785-1837, 5485-5512, 9866-9926, 11690-11768); `state/preferences.ts`;
`state/theme.ts`; `state/settings.ts`; `state/settingsEcho.ts`; `state/defaults.ts`;
`hooks/motionPolicy.ts`; `hooks/useOrbitMotion.ts`; `main/services/settings.ts`;
`shared/types.ts` (`AppSettings`); `shared/ipc.ts` (settings + app channels);
`shared/convert.ts`; plus `main/menu.ts`, `main/index.ts`, `main/services/os-links.ts`,
`state/menuActions.ts`, `state/toolsRegistry.ts`, `components/Welcome.tsx`,
`components/StageRail.tsx`, `docs/phase-specs/phase-114.md`.



