# Phase 119 (TFL-1231 chunk J) — phase-close QA verdict

Status: PASS

## Commands (exact counts)
- `npm.cmd run verify` -> EXIT 0 (conventions clean, 412 source files; tsc --noEmit clean).
- `npm.cmd run test:unit -- <the 7 phase119 specs>` -> Test Files 7 passed (7); Tests 50 passed (50).
- `npm.cmd run test:e2e -- e2e/phase119_adaptive_shell.spec.cjs` -> 12 passed (12). 6 shipped shell tests + 5 live probes + 1 performance test, 1 worker, 1.7m.

## Live probe verdicts (all in e2e/phase119_adaptive_shell.spec.cjs)
1. ADV-P119-2 geometry round-trip — PASS. Keyboard-set non-default widths (right 380, left 420) and split ratio 75 all return after collapse+re-expand; `loadSettings()` persisted values stay 380/420/0.75, never reset to defaults.
2. ADV-P119-1 state survival — PASS. An open draft (modified doc + 1 annotation), a page selection, openTabs and activeTabId survive restored<->maximized<->minimum<->restored; every persisted pref is unchanged at minimum and on return; geometry returns 380/420.
3. ADV-P119-5 no mutation — PASS. pageCount 34, currentPage 1, modified, canUndo/canRedo, engine signature and canvas pixel signature are identical before/after 2x panel toggles and a wide->1000->820->560->wide sweep (no new undo entry, no recolor).
4. Emulated scaling (webContents zoom on the real 960x640 window) — PASS. width 680/566 compact, 480/413 tight. At tight (z=1.8, width 413): `data-rail-overflow=true`, standalone "+" collapsed, a labelled "New tab" row leads the All-tabs popover, filenames remain. Rung-4 dock `data-dock-arrows-lane=true` engages from width 566 down.
5. Dialog description — mechanism PASS, runtime OBSERVATION. The DialogShell `description` -> `aria-describedby` wiring is unit-tested (phase119_dialogA11y). At runtime NO shipped dialog has aria-describedby: the only `description=` in renderer source is a SettingsSection; About/Preferences describedBy=null. Titles always present.

## Success-criterion table (REQUIREMENTS.md Phase 119)
| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Measured viewport; logical-px breakpoints; scale vs UI-scale vs zoom distinct | PASS | useDocumentViewport.ts + DocumentView `.workspace-main` data-layout-*; unit layoutTokens "measures the host..."; unit propertiesSurfaces "publishes the measured layout class"; e2e P4 narrow/compact/tight at measured widths; layout.ts records absent app UI-scale |
| 2 | Rail min width + complete All-tabs switcher; utilities collapse before filenames; ellipsis | PASS | unit railOverflow (6); e2e test6 minVisibleTabWidth>=148 at restored/max/min, All-tabs lists all 8; e2e P4 tight; themeContract ellipsis |
| 3 | Dock centred in measured viewport + More overflow + keyboard/pointer scroll | PASS | e2e test1 (centre within 180px, More menu, arrow lane branch); e2e P4 lane; unit dockAdaptive |
| 4 | One active properties surface + labelled collapse/reopen + never both-collapsed-no-recovery | PASS | e2e test2; e2e P1; unit propertiesSurfaces resolveInspectorSurface/resolveContextPanelSurface |
| 5 | Geometry preserved; preferred geometry restored | PASS | e2e P1 + P2 (loadSettings prefs stable) |
| 6 | >=32px fine / ~44px coarse; 200% no overlap/no font shrink; ellipsis+tooltip | PASS | unit layoutTokens (32/44); themeContract no-font-shrink; e2e test4 200% overflow check; e2e P4 tight ellipsis |
| 7 | Framework semantics; focus order; Escape restores opener; dialog trap/inert/title/description; no nested interactive; shortcuts real | PASS (with description observation) | unit dialogA11y (5), unit focusContract (roles, registered accelerators, nested-interactive guard); e2e test3 |
| 8 | Contrast 4.5:1/3:1; forced colors system values; no violet/unique-tab-hue status; reduced motion | PASS | unit themeContract (9); e2e test4 forced-colors + reduced motion; tight forced-colors screenshot |
| 9 | Regression matrix: restored/max/min, display scaling, 200% text, keyboard-only, HC, reduced motion, PDF anchor separate | PASS | e2e tests 1-6 + P1/P2/P3/P4; test5 PDF anchor separate; zoom used as the briefed equivalent for display scaling |
| 10 | Offline; truthful states; no placeholder | PASS | e2e test4 zero http requests; diff surface inventories no placeholder/fixture port |
| 11 | Reuse primitives (no parallel store/override); identity/undo preserved; no PDF recolor/mutation | PASS | e2e P3 (no mutation/recolor/undo); e2e P2 identity; renderer-only diff |
| 12 | Evidence + flow deliverable | PASS | this report, command counts, screenshots, probe verdicts |

## Performance
REQUIREMENTS.md Phase 119 declares NO shell-interaction latency budget (LAYOUT.motionMs=140 is the emphasis transition). Measured wall-clock including Playwright dispatch: nav collapse 50ms, nav expand 301ms, dock More open 282ms, layout-class update after a many:many resize 720ms (the resize helper itself waits 700ms; the observed reclass is the residual).
## Screenshots (screenshots/phase119_*.png) � inspected
full_light, full_dark, compact_light, compact_dark, compact_frosted, tight_light, tight_dark, tight_forcedcolors, tight_dock_arrows, highcontrast, zoom200, rail_overflow, dialog_midtrap, navigator_collapsed, navigator_reopened, dock_more.
Inspected: themes render cleanly; tight shows the ellipsized filename + All-tabs popover with the labelled New tab row; forced-colors uses system black/white with a visible focus ring; 200% shows no horizontal overflow; the dock More menu is centred and legible in light/dark.

## Defects
None. No FAIL or INCONCLUSIVE item; no DEF-NNN filed.

## Findings
- Dialog description OBSERVATION (criterion 7): the DialogShell primitive correctly wires `description` to `aria-describedby` (unit-tested), but no shipped adopter passes a `description` at runtime, so every live dialog exposes only its title. Not filed as a defect: a description is optional in the primitive and every dialog has a correct accessible name; the CTO may choose to require one on a specific dialog.