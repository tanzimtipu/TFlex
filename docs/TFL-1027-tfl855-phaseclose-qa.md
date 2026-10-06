# TFL-1027 — TFL-855 phase-close QA (Dialogs / Toolboxes / Menus)

Task: phase validation (phase-close). Verdict per success criterion. No product
code or tests were changed; only `e2e/phase_tfl855_phaseclose_qa.spec.cjs`
(new capture spec), `screenshots/phase-tfl855-close/` (16 captures) and this
report were written.

Model: `openrouter/deepseek/deepseek-v4.1-flash` (pinned, correct).

## Verdict summary

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Surface inventory complete | PASS |
| 2 | Shared foundations | PASS |
| 3 | Pilot then migrate | PASS |
| 4 | Preserve behavior | PASS |
| 5 | Accessibility and interaction | PASS |
| 6 | Validation (tests + light/dark screenshots) | PASS |
| 7 | Reviewable deliverable | PASS |

No TFL-855 FAIL -> no new `DEFECTS.md` entry.

## Evidence per criterion

### 1. Surface inventory complete — PASS
`Visual overhaul/Dialogs Toolboxes and Menus/Specifications/surface-inventory.csv`:
68 lines = header + **67 data rows**, **11 columns**. Status counts:
**migrated 48**, **native-exception 19**, **0 unmigrated**. Every
`native-exception` row carries a non-empty `exception_reason`; **4** native
Windows file-picker rows use `surface_type=ExistingNativeSystemDialog`.
Note (LOW, not a phase fail): row 52 ("Theme picker popover", opener
`data-theme-toggle`) is stale — the borderless theme picker was retired by
sibling **TFL-856** (Top Bar and Tabs, commit `ac86812`), not by TFL-855; the
theme command now lives on the app-menu `Toggle Theme` row.

### 2. Shared foundations — PASS
Source inspection: all six primitives exist — `TaskDialog.tsx`,
`PreviewTaskDialog.tsx`, `ContextToolbox.tsx`, `PropertyPopover.tsx`,
`CommandMenu.tsx`, `Tooltip.tsx` — on the additive-only `DialogShell.tsx`
(`headerContext`/`bodyScroll`). Contracts present: header/body/footer slots
(`DialogShell:230-310`; `PropertyPopover:74-78`), content-driven widths
(`TaskDialog` compact/standard, `PropertyPopover width`), bounded single body
scroll (`bodyScroll` -> `modal-body-scroll`, `DialogShell:262-272`),
portal/layer policy (`TfDialog`/`TfPopover`/`TfMenu`/`TfBar` wrappers),
focus/dismiss (`DialogShell` initial focus + Esc stack + backdrop guard;
`PropertyPopover`/`CommandMenu` focus-return; `ContextToolbox` nonmodal Esc),
reduced motion (`Tooltip` `useInstantMotion`; `Tf*` wrappers). Specs:
`interactionSurfaces.test.tsx` + `floatingSurfaces.test.tsx` +
`commandMenu.test.tsx` green.

### 3. Pilot then migrate — PASS
Pilots use the real state/commands: `SplitDialog` -> `TaskDialog`,
`StampDialog` / `CreateFromImagesDialog` -> `PreviewTaskDialog`;
`TitleBar`/`AppHeader`/`pageThumbMenu`/`ActionDock`/`Welcome` -> `CommandMenu`;
`EditOverlay` -> `ContextToolbox`. Complete inventory is migrated (48) or
documented-exception (19). C14 removed only 3 provably-dead rules
(`.context-menu-title`, `.action-dock-menu-picker`, `.action-dock-menu-overflow`)
after their consumers moved (`git diff styles.css` = 27 deletions). Evidence:
CSV + the migrated-surface specs.

### 4. Preserve behavior — PASS
Commands still present: File menu shows Open/Merge/Save/Save As/**Close Tab**
(screenshot `tfl855-file-menu-*`); app menu shows Undo/Redo/Preferences/Toggle
Theme/Command Palette/Multi Mode/Find/**Recognize Text (OCR)**/Check for
Update/About (screenshot `tfl855-app-menu-*`). Migrated-surface specs green:
`titleBarFileMenu`, `appHeaderAppMenu`, `pageThumbMenu`, `phase58HomeTools`,
`phase36AnnotationFlyout`, `phase28_annotationComments`. Spot check:
Split (extract/split + range + count), Stamp (choices + live preview +
placement), Create images (Add/Paste/encoding + empty-state Content-driven
size) all render with real content.

### 5. Accessibility and interaction — PASS
Specs assert: modal focus/return + Esc stack (`interactionSurfaces`), nonmodal
no-trap + canvas pointerdown preserved (`floatingSurfaces:152,175`), menu
keyboard model Home/End/arrows/Tab/Escape + outside-pointerdown without
swallowing + focus-return to opener (`commandMenu.test.tsx`), disabled reasons
exposed via `aria-describedby` (`commandMenu:313`). e2e DEF-601/602/603 retest:
**3 passed** (`e2e/phase105_def601_602_603_retest.spec.cjs`).

### 6. Validation — PASS
- Command: `npm.cmd run test:unit -- <the 9 phase specs>`
  Result: **Test Files 9 passed (9), Tests 121 passed (121)**.
- Command: `npm.cmd run verify` -> `conventions: clean (383 files)` + `tsc`
  clean.
- Screenshots: `e2e/phase_tfl855_phaseclose_qa.spec.cjs` (new, launched only via
  `e2e/lib/launch.cjs`) captured 8 migrated surfaces in **light + dark** (16
  full-window PNGs under `screenshots/phase-tfl855-close/`), each inspected as
  an image: Welcome picker, File menu, app menu, dock More, dock Add-a-tool,
  Split, Stamp, Create-from-images. Chrome, typography, spacing and contrast
  are correct and consistent across both themes; menus render the shipped
  `.titlebar-menu-*` DOM; dialog header context line, bounded body and
  content-driven empty body all present.

### 7. Reviewable deliverable — PASS
Uncommitted TFL-855 changes are present for git-agent (12 tracked files +
6 new primitives + 6 new unit specs + new e2e spec + CSV + CONTROL-INDEX).
`CONTROL-INDEX.md` carries the C5/C7/C8/C9/C10/C11 migration entries; the
category spec/prompt (`Specifications/live-app-refinements.md`,
`Implementation/live-app-refinement-prompt.md`) is synchronized with the
implemented lifecycles. Screenshots and this report are on the Artifacts board.

## Known EXTERNAL reds — attribution

| Red | Verdict | Owner |
|-----|---------|-------|
| `phase43_gate` P43-1a / P43-1b | FOREIGN — selector `[data-page-layout-control]` (ViewStrip) gone; Phase 109 drift | ViewStrip / TFL-856-TopBar |
| `phase43_gate` P43-4 | FOREIGN — selector `[data-header-multi-mode]` (Multi-Mode) drift | Phase 105 Multi-Mode |
| `phase43_gate` P43-5 | FOREIGN — selector `[data-theme-toggle]` retired by TFL-856 (`ac86812`); not TFL-855 | TFL-856 Top Bar and Tabs |
| `phase36SurfaceDiscipline` ruling 1 | FOREIGN — test helper reads inline `[data-dock-verb]` only; verbs live in the More overflow (CommandMenu) | Phase 37/104 dock-verb drift |
| `phase36MultiChrome` (3) | FOREIGN — same inline-only dock-verb set drift | Phase 37/104 |
| `foundationGuards.test.ts` | **GREEN now** — the brief's DEF-598/DEF-600 red no longer reproduces (run passed) | n/a (stale brief note) |

None of the above blocks any TFL-855 criterion; none is attributed to TFL-855.

## Screenshot index (`screenshots/phase-tfl855-close/`)
`tfl855-{welcome-picker,file-menu,app-menu,dock-more,dock-add,split,stamp,create-images}-{light,dark}.png`
