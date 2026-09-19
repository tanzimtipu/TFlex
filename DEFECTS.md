# Defects

> Read discipline: this is a long-lived evidence ledger, not default agent context. For a
> focused task, search for the assigned `DEF-NNN` and read only that entry. For triage,
> inspect the current `OPEN`, `FIX-READY`, and `DISPUTED` entries first; closed records are
> historical evidence and must not be loaded wholesale.

## DEF-240: Phase-20 palette width/reduced path and TfMotion/TfPresets used legacy literals instead of motion tokens

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-056)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf`.
2. Static audit the Phase-20 animation paths: the palette list<->grid width transition, the `TfMotion` reduced fallback and the reduced tooltip override.
3. Check the `--motion-*` token presence in `animations.css` / `motionTokens.ts` and the consumers.

Expected: every new Phase-20 animation resolves from the Phase-15 motion tokens (criterion 7); no hardcoded durations/easings/scales.
Actual: the palette width transition read the legacy `var(--panel-slide-duration, 150ms)` / `var(--panel-slide-ease, cubic-bezier(0.16,1,0.3,1))` pair (`styles.css:5818-5819`, `:8959-8960`); `TfMotion.tsx:106` hardcoded `duration: 0, ease: "linear"` in the reduced fallback; the reduced tooltip used `var(--tf-motion-fast)` / `var(--tf-ease-fast)`; `MORPH_MIN_SCALE = 0.01` was an undocumented literal.

History:
- qa: opened (2026-09-19; accepted from ADV-056, LOW; criterion 7 token hygiene)
- qa: CLOSED (2026-09-19 FIX-READY retest). `--motion-ease-panel` is registered (`animations.css:61`; `motionTokens.ts` `MOTION_EASE.panel`); `--panel-slide-duration: var(--motion-duration-micro)` and `--panel-slide-ease: var(--motion-ease-panel)` (`styles.css:190-191`); `TfMotion.tsx` reduced duration is `msToSeconds(MOTION_DURATION.reduced)` (`:114`, `:340`); `MORPH_MIN_SCALE`, `ease:"linear"` and the reduced tooltip `--tf-motion-fast`/`--tf-ease-fast` pair are kept and documented as non-motion (`tfPresets.ts:284-289`, `styles.css:8521`).

## DEF-239: The morph exit's first frame still reports pointer-events:auto (one hit-testable frame per exit)

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-055)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf`.
2. Run `node test-fixtures/tools/adv051_phase20.cjs spam` - 26 rapid open/close toggles per morph menu (theme, titlebar, ann), sampling rect/opacity/pointer-events/`data-tf-morph` every frame.
3. Count the frames tagged `data-tf-morph="out"` whose computed `pointer-events` is `auto`.

Expected: the exit pins `pointer-events:none` on the FIRST exit frame (the DEF-087/088/090 guard), so a closing surface can never swallow a click.
Actual: across 93 out-frames per menu, 13 reported `pointer-events:auto` (one per exit); the first out frame read `pe:"auto", op:0.965` and the next `pe:"none"`; `outPeValues:["auto","none"]` for all three menus.

History:
- qa: opened (2026-09-19; accepted from ADV-055, LOW)
- qa: CLOSED (2026-09-19 FIX-READY retest). `spam` now reports `outPeValues:["none"]` and `exitFramesWithoutPointerNone:0` for theme/titlebar/ann (outFrameCount 93/93/94, every out-frame `pe:"none"`, first out frames `{op:0.962,pe:"none"}`, `{op:0.948,pe:"none"}`, `{op:0.941,pe:"none"}`).

## DEF-238: The exiting search bar is not inert - focus stays in it and Tab reaches it during the ghost window

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-054)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf`.
2. Press Ctrl+F, focus the search input, type `AB`, press Escape; sample the exit frames (pointer-events/inert/focus).
3. Press Escape, wait 60ms, press Tab; read `document.activeElement` (`node test-fixtures/tools/adv051_phase20.cjs ghosts` / `searchkey`).

Expected: the exiting keyboard-bearing search bar is inert; focus leaves it and Tab cannot enter it (the phase exit treatment).
Actual: 21 exiting / 14 ghost frames reported `inert:[false]`; `focusAfterEscape` stayed `{tag:"INPUT", inSearch:true}`; 60ms after Escape Tab landed on a `BUTTON` inside the exiting `.search-bar` (`inSearch:true`). Typing `ZZ` did not change the value (focus/a11y leak, not stray input).

History:
- qa: opened (2026-09-19; accepted from ADV-054, LOW)
- qa: CLOSED (2026-09-19 FIX-READY retest). `ghosts`: 22 exiting frames `inert:[true]`, `pointerEvents:["none"]`, `focusAfterEscape {tag:"BODY", inSearch:false}`, and Tab 60ms after Escape lands on a `DIV` with `inSearch:false`. `searchkey`: `atEscape {activeTag:"BODY", activeInSearch:false, value:"AB"}`, typing `ZZ` leaves the value `AB`, bar unmounts.

## DEF-237: Re-opening a morphing menu mid-exit grows the surface from its own mid-exit box, not the trigger

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-053)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf`.
2. For each morph menu (theme `[data-theme-toggle]`, titlebar `[data-menu-button]`, ann `[data-ann-dropdown-toggle]`): open it, settle 500ms, press Escape, wait 80ms (mid-exit), click the trigger again, and sample rect + `data-tf-morph` + `transform-origin` every frame (`node test-fixtures/tools/adv051_phase20.cjs reopen`; rapid-toggle control `spam`).
3. Compare the first frame whose `data-tf-morph` is `in` against the trigger rect.

Expected: Phase-20 criterion 1 - the surface morphs from the TRIGGER rect with no gap on every open, including a re-open during the close morph.
Actual: the first `in` frame was measured off the shrunken mid-exit rect: theme deviated 34.1px (trigger `[1154.4,6.7,131.6,28]` vs `[1130.9,23.3,155.1,62.1]`), titlebar 108.3px, ann 105.4px; in the rapid-toggle control 12/13 re-enters exceeded 2.5px (max 59.8/67.4/97.4px) while the first open from fully closed was 0.0px. `useMorphPreset` measured `surface.getBoundingClientRect()` while the exit transform was still applied.
Screenshot: screenshots/adv051-reopen-theme.png, screenshots/adv051-reopen-titlebar.png, screenshots/adv051-reopen-ann.png

History:
- qa: opened (2026-09-19; accepted from ADV-053, MEDIUM; morph measured off the transformed mid-exit rect)
- qa: CLOSED (2026-09-19 FIX-READY retest). `reopen` first `in` frame equals the trigger rect exactly for all three menus - theme `[1154.4,6.7,131.6,28]`, titlebar `[8,9.7,28,22]`, ann `[1387.3,53,28,32]` - `deviationPx 0.0` each (the morph now measures the final layout rect). `spam`: 13/13 re-enters, `firstFrameDevs` all 0, `maxDev 0.0px`, `entersOver2_5px 0`.

## DEF-236: Held Enter during the signature pending view's exit window commits up to 11 signature placements from one Confirm

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-052)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf`.
2. Sign (`button[data-icon="sign"]`) -> Type, create a typed signature, pick it, click page 1 to spawn the pending placement (`[data-sig-pending]`).
3. Click `[data-sig-pending] [data-sig-action="confirm"]`, then hold Enter (10 presses at ~15ms) during the pending view's exit; wait 1.8s and read `engineState.signatures` / `[data-placement-id]` (`node test-fixtures/tools/adv051_phase20.cjs sigkey`).

Expected: one Confirm commits one signature placement; a held/repeated Enter cannot re-fire the stale `onConfirm` (the exiting keyboard-bearing root is inert).
Actual: 11 signatures / 11 placements from one Confirm; the exiting `PendingPlacementView` / `SignatureActionBar` stayed keyboard-live with the Confirm button focused, and a save would bake 11 overlapping placements (document corruption).
Screenshot: screenshots/adv051-sigkey.png

History:
- qa: opened (2026-09-19; accepted from ADV-052, HIGH)
- qa: CLOSED (2026-09-19 FIX-READY retest). `sigkey`: `before {signatures:0, placements:0, pending:1}` -> after Confirm plus 10 held Enters `after {signatures:1, placements:1, pending:0}`; focus immediately after Confirm is `BODY` (`inPending:false`), so the inert guard plus the one-shot Confirm guard stop the re-fire.

## DEF-235: Held Ctrl+Enter during the edit editor's exit window duplicates the committed text box (up to 10 boxes from one commit)

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-051)
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`); open `report.pdf` (baseline `.edit-box`=0, `engineState.textBoxes`=0).
2. Edit content -> box tool (`[data-edit-tool="box"]`), drag a 180x60 box, type `DUP-A`, click Apply (`[data-edit-confirm]`).
3. Immediately hold Ctrl+Enter (10 presses at ~15ms) while the inline editor is still exiting, wait 1.8s, then read `.edit-box` / `engineState.textBoxes` (`node test-fixtures/tools/adv051_phase20.cjs duprepro` scenario A; fresh-launch control `dupctrl`).

Expected: one commit creates one text box; a key-repeat after the commit cannot re-fire the stale commit closure (the exiting inline editor is inert, as the annotation textbox editors already were).
Actual: `{boxes:10, editors:0, textBoxes:10}` - nine extra boxes from one commit; `document.activeElement` stayed on the editor's `TEXTAREA.edit-inline-textarea` because the Apply `onMouseDown` preventDefault kept focus there, so every Ctrl+Enter re-fired the old `onCommit` closure during the ~200-350ms exit. A save writes all ten.
Screenshot: screenshots/adv051-midanim-edit-keyrepeat.png

History:
- qa: opened (2026-09-19; accepted from ADV-051, HIGH)
- qa: CLOSED (2026-09-19 FIX-READY retest). `duprepro` scenario A: `rightAfterA {boxes:1, editors:1, textBoxes:1}` -> after 10 Ctrl+Enter presses during the exit `afterA {boxes:1, editors:0, textBoxes:1}`; focus right after Apply is `BODY` (`inEditor:false`), not the textarea, so the shared `inert={!isPresent}` plus the one-shot commit guard stop the duplication. (The harness's scenario B timeout is a harness-flow artifact - see the phase-20 retest report: its drag starts on scenario A's committed box and hits the move branch, moving it exactly +180/+60 with `boxToolbar:1`.)

## DEF-233: The frosted tools palette width still jumps on the list<->grid swap while the page inset and badge slide

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 20

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper); open the bundled `report.pdf`; leave the theme at the default frosted.
2. Open the Tools palette (`[data-tools-toggle]`), then switch layout list->grid (`[data-tools-layout="grid"]`) and back.
3. Sample `.tools-palette` width, `.document-scroller` right edge and `.tools-badge-tracker` right edge per rAF for 800ms (`npm.cmd run test:e2e -- e2e/phase20_verify.spec.cjs -g C2b`).

Expected: the palette width tweens 344px<->380px over `--panel-slide-duration`/`--panel-slide-ease` in lockstep with its two siblings (criterion 2), as it does in light and dark.

Actual: in frosted the computed `transition-property` on `.tools-palette` is `backdrop-filter, -webkit-backdrop-filter`, not `width`. The frosted rule `:root[data-theme="frosted"] .tools-palette` (styles.css:731, transition at :744) has higher specificity than the Phase-20 base `.tools-palette` rule (styles.css:5761, transition at :5804), so it REPLACES the width transition instead of merging. Measured palette widths are only [344,380] (a single-frame jump) while `.document-scroller` right and `.tools-badge-tracker` right each interpolate over 7 distinct values. Light and dark are correct (7 palette width values, 7 inset/badge values).
Screenshot: screenshots/phase20-verify-palette-resize.png

History:
- qa: opened (Phase 20 criterion 2 validation; the default theme is frosted, so the shipped build shows the panel snapping while the page/badge slide.)
- qa: CLOSED (FIX-READY retest). `e2e/def233_234_retest.spec.cjs` frame-sampled the list<->grid swap in all three themes. Frosted now reports computed `transition-property: backdrop-filter, -webkit-backdrop-filter, width` (duration 0.18s, 0.18s, 0.15s) and interpolates palette widths [344,363,372,377,378,379,380] on grid and [380,361,352,348,346,345,344] on list - identical series to light/dark, with the page inset and badge each showing the matching 7-value series in lockstep. Phase-20 C2b now passes (12/12).

## DEF-234: Reduced motion - the inline editor's first painted frame carries the non-reduced y:-2 travel

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 20

Steps to reproduce:
1. Launch TFlex (canonical `launchApp`), then set CDP `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce` on the window and confirm `matchMedia(...).matches === true`.
2. Open `report.pdf`, enter Edit mode (`button[aria-label="Edit content"]`), arm `[data-edit-tool="box"]`, drag on page 1 to create a text box.
3. Sample `[data-edit-editor]` computed transform every frame during the mount (`npm.cmd run test:e2e -- e2e/phase20_verify.spec.cjs -g C6`).

Expected: the reduced-motion path is opacity-only, so the editor never travels (criterion 6).

Actual: the first mounted frame's computed transform is `matrix(1, 0, 0, 1, 0, -2)` (the non-reduced TfBar initial `y: -MOTION_TRANSLATE.micro`), then `none` for every subsequent frame - a one-frame 2px reduced-motion leak. The morph, Sign tabs and palette resize all collapse cleanly (no travel / instant size). Structure is unchanged (the editor mounts/unmounts correctly).

History:
- qa: opened (Phase 20 criterion 6 validation; one-frame 2px travel leak on the edit inline editor under emulated reduced motion.)
- qa: CLOSED (FIX-READY retest). Under CDP `prefers-reduced-motion: reduce` the inline editor mounted 67 frames with first transform `none` and distinct transforms `["none"]` (animation-name `none`), then unmounted structurally (0 nodes after Cancel). Tooltip member of the class: reduced first frame `matrix(1,0,0,1,-25.63,0)` (pure centring, no scale/translateY) settling to opacity 1 / visibility visible; no-preference first frame `matrix(0.98,0,0,0.98,-25.63,3)` settling to `matrix(1,0,0,1,-25.63,0)` - normal entrance unchanged. Phase-20 C6 now passes (12/12).

## DEF-232: The DEF-221 edit-text move is lost on page 2 (dense paragraph) - the run is not masked and the saved file keeps it at the original rect

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 19 (release 1.19.0 validation)

Steps to reproduce:
1. Install `release\TFlex-Setup-1.19.0.exe /S`, then launch the INSTALLED `%LOCALAPPDATA%\Programs\tflex\TFlex.exe` via `e2e/lib/launch.cjs` with `executablePath`; open the bundled `report.pdf`; scroll to page 2.
2. Arm Edit mode (`[data-toolbar-edit-toggle]`) -> `[data-edit-tool="text"]`.
3. Double-click the dense body run "orchestration layer correctly handles multiple page streams. Strategic orchestration is"; drag `[data-edit-drag-handle]` +150/+120 until `[data-edit-confirm]="true"`; click `[data-edit-confirm="true"]`.
4. Probe the original run rect (canvas px [136,264,849,23]) and the +150/+120 rect; then Save As to a temp path, close the tab, reopen the saved file and probe both again.
Commands: `npm.cmd run test:e2e -- e2e/release_1_19_0_installed.spec.cjs -g "REGRESSION DEF-221"` (installed 1.19.0) and the original `npm.cmd run test:e2e -- e2e/release_1_18_1_installed.spec.cjs -g "DEF-221"` against the same installed exe.

Expected: the DEF-221 contract holds - the old run rect is masked (dark 0), the band above is byte-identical, and the saved/reopened file carries the run only at the new position.

Actual: On the INSTALLED 1.19.0 build the page-2 dense run is never masked. Live, old rect dark stays 4458 (was reported 0 at the 1.18.1 closure) and the moved rect stays at the underlying text (2660 -> 2660); after Save As + close + reopen the old rect is still 4458, so the move is absent from the saved file. The page-2 canvas shows no change at all after Confirm (`modified:true`, no toast, editor closes). The original 1.18.1 spec test 3 - which passed 5/5 on installed 1.18.1 - now fails identically (Expected 0, Received 4458). The dev suite's dense-paragraph case (`e2e/def221_222_leftover_thumb_flicker.spec.cjs` test 3) reproduces it on the 1.19.0 tree (run band 4458 -> 4458), while its page-1 move case still passes (old rect 2867 -> 0, moved text 1973). Introduced by Phase 19 commit `4600ae6` (which changed `DocumentView.tsx` and `styles.css`, not `EditOverlay.tsx`).
Screenshot: screenshots/release-1190-handle-640.png (release context)

History:
- qa: opened (release 1.19.0 installed-build validation; the mandated DEF-221 regression spot-check fails. HIGH - a page-2 text edit is silently lost on save.)
- qa: CLOSED (2026-09-19 release 1.19.0 rebuilt-installer retest). Installed `release\TFlex-Setup-1.19.0.exe /S` over the prior 1.19.0; installed exe FileVersion 1.19.0, `app.getVersion()==='1.19.0'`. Dense page-2 run move +150/+120: old rect dark 4458 -> 0 live, band above byte-identical (hash 1712841557, dark 4193), moved dark 2660 -> 5407; after Save As + close + reopen old rect dark 0, moved present at the NEW rect (dark 5407, hash 1158894619), band above hash unchanged (1712841557). Sibling paths with the page-2 top below the chrome line (stale readout currentPage=1 at commit): text box `PAGE2 BOX` registered and reopened on page 2, page-1 rect hash 282248805 unchanged; image placement move old canvas-px {170,400,220,80} -> new {470,540,220,80}, reopened old rect 99.0% white (112/17600 dark, 160-px boundary AA residue), image present at the new rect (dark 10895, hash changed), page-1 whole-canvas hash 2114593833 unchanged. `e2e/release_1_19_0_installed.spec.cjs` 14/14 passed; GATE 0 `verify:full` 262 files / 3245 tests green.

## DEF-231: The frosted tools menu has no backdrop blur while its sibling colour popover does

- Status: CLOSED
- Severity: LOW
- Found by: qa (ADV-050)
- Phase: 19

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper, no executablePath); open the bundled report.pdf; set the theme to frosted.
2. Open `[data-ann-dropdown-toggle]`.
3. Read `getComputedStyle(document.querySelector('[data-ann-dropdown-menu]')).backdropFilter` and compare with `.color-popover`.

Expected: the frosted `.ann-tool-menu` surface matches its sibling `.color-popover` (`blur(24px) saturate(1.2)`) - Phase 14/14.1 "consistent frosted glass across ... tool panels".
Actual: pre-fix `.ann-tool-menu` `backdropFilter:"none"` while `.color-popover` was `blur(24px) saturate(1.2)`; `.ann-tool-menu` was missing from the frosted blur list at `styles.css` ~8656 (it only got the surface/border/shadow rule).
Screenshot: screenshots/adv045-theme-frosted-menu.png

History:
- qa: opened (Phase 19 validation; ADV-050. The one frosted floating surface without the glass blur.)
- qa: CLOSED (2026-09-18 retest, post-fix `.ann-tool-menu` added to the frosted blur list `styles.css:8651/8661`). `adv045_ann_group.cjs motion` frosted: `.ann-tool-menu` `backdropFilter:"blur(24px) saturate(1.2)"` == `.color-popover`; `color` section `menuBackdrop`==`popBackdrop`=="blur(24px) saturate(1.2)". Screenshot screenshots/def-231-retest-frosted.png - the open menu reads as the same frosted pane as the colour popover.)

## DEF-230: Arming a tool with a read-only settings.json throws unhandled EPERM rejections and silently does not persist

- Status: CLOSED
- Severity: LOW
- Found by: qa (ADV-049)
- Phase: 19

Steps to reproduce:
1. `node test-fixtures/tools/adv045_settings_mru.cjs g` - writes `{}` to a fresh `--user-data-dir/settings.json`, marks it read-only (`attrib +R`), launches the dev build, opens report.pdf, installs an `unhandledrejection` listener, arms Highlight (the MRU write path), then reads the file back.
2. Observe the captured rejections and whether any user feedback appears.

Expected: no unhandled rejection; the last persisted settings state retained; the user told the write failed.
Actual: pre-fix two unhandled rejections - `Error invoking remote method 'settings:addRecent': Error: EPERM: operation not permitted, rename '...settings.json.tmp' -> '...settings.json'` and the same for `settings:save`; `activeTool:"highlight"`, `alive:true`, file unchanged, no toast.
Screenshot: N/A

History:
- qa: opened (Phase 19 validation; ADV-049. Fail-loud rule: a persistence failure must not surface as an unhandled rejection and must tell the user.)
- qa: CLOSED (2026-09-18 retest, post-fix `_doSave` catch restores `this.current = structuredClone(this.persisted)`, emits `settings:writeError`, and App.tsx toasts it). Scenario g: `rejections:[]`, `pageErrors:[]`, `alive:true`, `settingsUnchanged:true`; 3 error toasts, text `Settings could not be saved: EPERM: operation not permitted, rename '<udd>\settings.json.tmp' -> '<udd>\settings.json'`. Backend in-memory rollback verified directly: after clearing the read-only bit, a forced `addRecentFile` save (which merges `this.current`) wrote `annotationRecentTools` absent (`rollbackProbe:"absent"`) - the failed promotion did not survive in memory. Note: the renderer's optimistic visible order still shows the attempted promotion (`visibleAfterArm:["highlight","select",...]`) until restart; the persisted state and the settings service are correct.)

## DEF-229: The annotation group is clipped offscreen at the app's minimum window width (640 px)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ADV-048)
- Phase: 19

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper); open the bundled report.pdf.
2. `node test-fixtures/tools/adv045_ann_group.cjs layout` - resize the window via `BrowserWindow.setSize` to 1440x900, 1000x800, 820x700, 640x600 and measure `.toolbar` and `[data-annotation-toolbar]`.
3. Inspect the 640x600 measurements and screenshot.

Expected: REQUIREMENTS.md Phase 19 criterion 1 - every group stays reachable at the app's own documented 640 px minimum (`src/main/window.ts` `minWidth: 640`); no overlap, no clipped page slot.
Actual: at 640x600 the group is `{left:541,right:736}` while `innerWidth:640` -> `groupReachable:false`, `groupClipped:true`; the `.toolbar` box is `left:220 right:752 width:532` with `overflowX:"hidden"` (the available track is only 420 px), so 112 px of the bar and the dropdown arrow are offscreen. The bar wrapped to 3 rows (`toolbarH:141`). 820/1000/1440 remain reachable.
Screenshot: screenshots/adv045-layout-640.png

History:
- qa: opened (Phase 19 validation; ADV-048. The dropdown arrow is unreachable at the documented minimum width.)
- qa: RETEST FAILED (2026-09-18, post-fix `.toolbar { min-width: 0 }` + wrapping, `styles.css:2398`). Clean-session `layout` run: 640x600 `toolbarCW:532 toolbarSW:714`, `.toolbar` `left:220 right:752 width:532`, group `{left:541,right:736,w:195}` -> `groupReachable:false`, `groupClipped:true` (was right:734 pre-fix - effectively unchanged). The `min-width:0` on `.toolbar` did not make the containing `.workspace-main`/`.workspace` chain shrink: the toolbar still renders 532 px wide in a 420 px track, so the last capsule overflows the 640 px viewport. Screenshot screenshots/def-229-retest-640.png - the "All Tools" pill is cut at the right window edge. Left OPEN; the fix is incomplete.)
- qa: CLOSED (2026-09-18 retest2, post-fix `min-width:0` added to `.titlebar` (`styles.css:1084`) and `.workspace` (`styles.css:2025`), keeping `.workspace-main`/`.toolbar`). Clean-session `layout` run - 1440x900: `toolbarH:53`, group `{left:1229,right:1424}`, reachable/clipped `true/false`; 1000x800: `toolbarH:97`, group `{789,984}` `true/false`; 820x700: `toolbarH:141`, group `{609,804}` `true/false`; 640x600: `toolbarH:185`, group `{left:429,right:624,w:195}` -> `groupReachable:true`, `groupClipped:false`, `toolbarCW:420 toolbarSW:567` (was 532/714). Bar-bottom == scroller-top at every width (97/141/185/229). At 640x600 `elementFromPoint` at the group centre hits the group (`inGroup:true`), a real Playwright click on the visible Highlight button arms it (`activeTool:"highlight"`), and the open dropdown menu rect `{left:415,right:615,top:180,bottom:600}` is fully inside the 640x600 viewport. Titlebar confirm: at 640 `.titlebar` spans `0..640` (`barScrollW:640`, no horizontal overflow), brand `56..128`, `.tab-list` `clientW:141 scrollW:250` (scrolls, not clipped), all three window controls `insideViewport:true` and `hitsSelf:true` via `elementFromPoint`; at 1440 bar spans `0..1440`, brand w72, all controls inside. `e2e/phase19_annotation_group.spec.cjs` 11/11 passed. New focused test `e2e/retests/def229_retest.spec.cjs` passed. Screenshots: screenshots/def-229-retest2-640.png (4-row wrapped bar, group fully visible at right edge, menu flush to viewport bottom), screenshots/def-229-titlebar-640.png (brand/tab/window controls intact, tab strip scrollbar visible).)

## DEF-228: Tab-focusing a menu row and pressing Enter arms the wrong tool

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ADV-047)
- Phase: 19

Steps to reproduce:
1. `node test-fixtures/tools/adv045_ann_group.cjs keys`.
2. Open the menu, press Tab twice so focus lands on the Highlight row (`button.ann-tool-menu-row[data-tool="highlight"]`), then press Enter; read `window.tflexDiagnostics().activeTool`.
3. Repeat with Space on a Tab-focused row.

Expected: Enter and Space arm the row that has DOM focus; the Arrow-key highlight + Enter path keeps working.
Actual: pre-fix `keys-tab-then-enter` gave `focusedRow:"highlight"` but `activeTool:null` (the container's `onMenuKeyDown` armed `MENU_TOOLS[menuIndex]`, still Select) and closed the menu - a keyboard-only user gets the wrong tool.
Screenshot: N/A

History:
- qa: opened (Phase 19 validation; ADV-047. Tab focus and arrow highlight disagreed.)
- qa: CLOSED (2026-09-18 retest, post-fix `focusedMenuRowTool(e.target)` in `AnnotationToolbar.tsx:299-316`). `keys-tab-then-enter` `{focusedRow:"highlight", activeTool:"highlight", menuOpen:0}`; `keys-tab-then-space` `{focusedRow:"underline", activeTool:"underline", menuOpen:0}`; `keys-enter` (ArrowDown+Enter) `{highlighted:"highlight", activeTool:"highlight"}`.)

## DEF-227: Clicking the page while the tools menu is open both dismisses it and performs the armed tool's placement

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ADV-046)
- Phase: 19

Steps to reproduce:
1. `node test-fixtures/tools/adv045_ann_group.cjs click`.
2. (a) arm Note from the menu, reopen the menu, single-click a blank page area; (b) arm Rect, reopen the menu, drag a 140x80 box on the page; (c) arm Highlight, reopen the menu, single-click the page.
3. Read the annotation count / note editor and whether the menu closed.

Expected: a click whose only job is to dismiss the open menu closes it and places nothing; the next click places.
Actual: pre-fix (a) opened the sticky-note editor (`noteEditorOpen:1`) and (b) the same drag that closed the menu committed a rect (`annotationsAfter:1`) - the outside-close handler neither consumed nor cancelled the gesture.
Screenshot: N/A

History:
- qa: opened (Phase 19 validation; ADV-046. The dismiss click leaked into the overlay's placement path.)
- qa: CLOSED (2026-09-18 retest, post-fix capture-phase `markMenuDismissPointer` + overlay `consumeMenuDismissPointer` (`menuDismissGuard.ts`, `AnnotationOverlay.tsx:697`)). `click` harness: (a) `{annotationsBefore:0, annotationsAfter:0, noteEditorOpen:0, noteActionBar:0, menuOpenAfter:0}`; (b) rect drag `{annotationsBefore:0, annotationsAfter:0, rectActionBar:0, menuOpenAfter:0}`; (c) highlight `0 -> 0`. A dismissing click on a CommandBar control still completes: Pan `data-hand-active` false->true, Edit `aria-pressed` false->true + `.edit-toolbar` mounted, menu closed - no double-toggle, no swallowed click.)

## DEF-226: Standard e2e specs still address the retired `.ann-toolbar` row for tools that now live only in the portaled menu; B2-port fails

- Status: CLOSED
- Severity: HIGH
- Found by: qa (ADV-045)
- Phase: 19

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper); open the bundled report.pdf.
2. Run `npm.cmd run test:e2e -- e2e/regression_b_port.spec.cjs -g B2-port`.
3. `node test-fixtures/tools/adv045_ann_group.cjs hooks` to measure what the old locators resolve to.

Expected: REQUIREMENTS.md Phase 19 criterion 12 - existing annotation e2e specs are repointed to the new group/menu and pass.
Actual: pre-repoint B2-port `TimeoutError` after 30s waiting for `.ann-toolbar button[data-tool="textbox"]`; hooks measured `.ann-toolbar button[data-tool="textbox"]=0`, `note=0`, `rect=0`, `highlight=1`, and `menuIsInsideAnnToolbar:false` (the menu portals to `document.body`). Same zero-match class in regression_b_port B2/B4/B5/B21/B22 and probe_190_triage T6/_r2/_r3 and other non-archived specs.
Screenshot: N/A

History:
- qa: opened (Phase 19 validation; ADV-045. textbox/note/rect/ellipse/arrow/callout moved to `[data-ann-dropdown-menu]`, outside `.ann-toolbar`.)
- qa: CLOSED (2026-09-18 retest). Repointed every non-archived spec that armed a tool via `.ann-toolbar button[data-tool=...]` through the shared `armAnnotationTool` helper (`e2e/lib/helpers.cjs`; visible five first, otherwise open `[data-ann-dropdown-menu]` and click the row). Repointed: `regression_b_port.spec.cjs` (B2/B4/B5/B6/B21/B22; B5 asserts the menu rows disabled), `probe_190_triage.spec.cjs` (T6), `probe_190_triage_r2.spec.cjs` (R1), `probe_190_triage_r3.spec.cjs` (R3), `sweep_annotations_sign.spec.cjs`, `sweep_visual.spec.cjs`, `sweep_settings_frameless.spec.cjs`, `motion_verify.spec.cjs`, `anim_audit.spec.cjs`, and retests `b2_isolation`, `b3_rig`, `b3_save_reopen`, `color_note_repros`, `def_103_shapes`, `def_210_pen_retest`, `def_211_ghost_dialog_retest`, `def_211_probe_place`, `sign_repros`, `gt_repro_1710`, `gt_verify_1711`, `operator_b123_repro`, `verify_1712_sweep`, `def_154_157_verify_1.7.24`. Also corrected the stale save-path selector `[aria-label="Save As"]` -> `[data-toolbar-save-as]` (renamed in Phase 13; it was masked behind the tool failure) in the repointed specs. Results: `regression_b_port.spec.cjs` 11/11; `probe_190_triage` T6 pass; `_r2` R1 pass; `_r3` R3 pass. No `e2e/archived/**` touched.)
- qa: follow-up (2026-09-18; sweep_annotations_sign's pre-existing stale Save As selector repointed to [data-toolbar-save-as]; A2/S2 now pass; the earlier repoint claim covered only armTool)

## DEF-225: The all-tools annotation dropdown opens flush at the far-left viewport edge instead of under its arrow

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (Phase 19 validation, 2026-09-18)
- Phase: 19

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper, no executablePath); open the bundled report.pdf sample; size the window 1440x900.
2. Click `[data-ann-dropdown-toggle]` (the chevron at the far right of the CommandBar's Annotate group).
3. Observe where the portaled `[data-ann-dropdown-menu]` renders.

Expected: the menu opens anchored under its arrow - right-aligned to the toggle's right edge, 6px below it (`anchor.right - width`), as the placement effect in `AnnotationToolbar.tsx` intends.
Actual: the menu renders flush at the left viewport edge, detached from its trigger and overlapping the Tools group and the page. Measured: `[data-ann-dropdown-menu]` inline `style.left="0px"`, bounding rect left=0 / right=200, while the toggle's right=1415 and `window.innerWidth`=1440. Reproduces identically in light, dark and frosted. Root cause: `.ann-tool-menu` has no `position: fixed` (unlike `.color-popover` at `src/renderer/styles.css:6383`), so the placement effect measures `el.offsetWidth` while the portaled div is still statically positioned as a `document.body` child - it reports the full body width (1440), so `Math.max(anchor.right - width, 0)` collapses to 0.
Screenshot: screenshots/phase19-group-frosted.png, screenshots/phase19-menu.png (menu at the left edge)

History:
- qa: opened (Phase 19 validation; `e2e/phase19_annotation_group.spec.cjs` test "anchoring: dropdown opens right-aligned under its arrow, not at the far-left edge" fails - 10/11 of the spec passes, only this anchoring test fails. MEDIUM - the menu still lists/arms every tool, but it opens detached at the far-left edge over the Tools group and page, materially degrading the dropdown workflow.)
- qa: CLOSED (2026-09-18 retest, post-fix `position: fixed` on `.ann-tool-menu`; `npm.cmd run build` clean). Strengthened anchoring test in `e2e/phase19_annotation_group.spec.cjs`: at 1440x900 the menu rect is left=1215 / right=1415 / top=92 / bottom=602 (200x510), toggle right=1415 / bottom=85 - right edges align exactly, top = toggle bottom + 7 (6px offset + rounding), inlineLeft=1215.33px, fully inside the 1440x900 viewport (was left=0 / right=200). Clamp on resize to 820x700 while open: menu left=595 / right=795 / top=179 / bottom=669 (200x490) inside 820x700, right edge re-aligned to the reflowed toggle (right=795). Whole spec: 11/11 passed. Screenshot: screenshots/def-225-retest.png - menu sits directly under and right-aligned with the chevron arrow, 6px below, not overlapping the Tools group.)

## DEF-224: The image placement's SE resize handle is half-clipped so only its inner quadrant is draggable

- Status: CLOSED
- Severity: LOW
- Found by: qa (class sweep, 2026-09-18)
- Phase: 18

Steps to reproduce:
1. Launch TFlex (installed build via the canonical `launchApp` helper with `executablePath`). Open the bundled report.pdf sample; scroll to page 2 (dense paragraph).
2. Arm Edit mode (`[data-toolbar-edit-toggle]`) -> click `[data-edit-tool="image"]`.
3. Drag a rect just below a text line; pick `test-fixtures/red.png` in the file chooser. The placement commits.
4. Click the `.edit-image-placement` body to select it; the four corner handles (`.edit-image-handle-se` etc.) mount at -5px outside the box.
5. Probe with `elementFromPoint` at the SE handle's OUTER corner quadrant (~3px outside the placement's SE corner, i.e. `placement.right + 3, placement.bottom + 3`).
6. Drag from that outer quadrant by +70/+50 and release.

Expected: The SE handle is fully hit-testable - `elementFromPoint` at the outer corner quadrant returns `.edit-image-handle-se` (not the placement or the page host) - and a drag from that outer quadrant resizes the placement and commits to the engine.

Actual: Pre-fix (1.18.0 tree), `.edit-image-placement` carried `overflow: hidden`; the handle is 10x10 at `right:-5px; bottom:-5px`, so its outer 5x5 half was clipped and the outer-corner point hit-tested to the host div - only the inner quadrant was draggable. Fix (source-verified, `src/renderer/styles.css:7034-7066`): the placement no longer clips (`overflow: hidden` removed; `.edit-image-placement-img` rounds its own corners instead). Post-fix verification on the INSTALLED 1.18.1 build (spec `e2e/release_1_18_1_installed.spec.cjs`, test 5): outer-corner `elementFromPoint` returned class `"edit-image-handle edit-image-handle-se"` (`isHandle=true`); drag from that outer quadrant grew the overlay 509x40 -> 579x90 and the resize committed - the saved/reopened file carries the image at the new rect (dark 52,110).
Screenshot: screenshots/release-1181-handle.png (SE handle fully visible, protruding outside the placement corner)

History:
- qa: opened (found in the class sweep 2026-09-18; pre-fix outer-corner `elementFromPoint` returned the host div, not `.edit-image-handle-se` - the placement's `overflow: hidden` clipped the handle's outer half. LOW - only the inner quadrant of the SE handle was draggable; resize still worked from there.)
- qa: CLOSED (verified on the installed 1.18.1 build - outer-corner `elementFromPoint` returned `.edit-image-handle-se` (`isHandle=true`); drag from the outer quadrant grew the overlay 509x40 -> 579x90 and the resize committed; reopened file image at the new rect dark 52,110. Spec `e2e/release_1_18_1_installed.spec.cjs` test 5, 5/5 passed.)

## DEF-223: Moving an image placement in Edit mode is a silent no-op - the saved PDF keeps the image at its original rect

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 18

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper, no executablePath). Open the bundled report.pdf sample; scroll to page 2 (dense paragraph).
2. Arm Edit mode (`[data-toolbar-edit-toggle]`) -> click `[data-edit-tool="image"]`.
3. Drag a rect on the page just below a text line; pick `test-fixtures/red.png` in the file chooser. The image placement appears and its engine op commits.
4. Drag the `.edit-image-placement` body +110/+90 CSS px; release. The overlay moves.
5. Inspect the OLD and TARGET rects, then Save As to a temp path, close the tab, reopen the saved file and inspect both rects again.

Expected: The image relocates to the dragged position; the old rect is masked and the target rect carries the image, in the live canvas and in the saved/reopened file (the same contract the text-run and text-box move paths meet).

Actual: The overlay moves but the engine never receives the move. Measured on the dev build (2026-09-18), spec `e2e/class_sweep_def221_222.spec.cjs` (test A1c), fixed canvas-px rects:
- DOM overlay: `.edit-image-placement` before `{x:380,y:608.4,w:509,h:40}` -> after `{x:490,y:698.4,w:509,h:40}` (the drag is recognised and the mirror moves).
- Engine/proxy: MutationObserver on all 34 `.thumb-canvas` across the drag = 0 mutations; no toast. The doc proxy is never rebuilt, i.e. no engine op fired.
- Reopen: Save As -> close -> reopen. OLD rect dark 4,914 -> 4,914 (live) -> **20,360** (reopened = the full red image is still at the original rect); TARGET rect dark 2,967 -> 2,967 -> 2,967 (underlying text unchanged, no image). The move is lost from the saved file.
- Band ABOVE the image is byte-stable (4,193 -> 4,193 -> 4,193), so this is not the DEF-221 mask-anchor class.
Mechanism (source-verified, `src/renderer/edit/EditOverlay.tsx`): the image-move branch resolves `placement = placementsForPage.find(...)` (line 835) and `placementNow = edit.placements.find(...)` (line 838) - both are the CURRENT placements after the drag - then early-returns on `rectsClose(newRect, placement.rect)` (line 841), which compares the new rect with itself. `onCommitImageEdit` is never called. The resize branch (lines 854-860) has the identical self-comparison; resize was not measured in this sweep.
Screenshot: screenshots/class-sweep-a1c-after.png (overlay moved down), screenshots/class-sweep-a1c-reopen.png (reopened file has the image back at the original rect)

History:
- qa: opened (2026-09-18; Class-sweep pre-1.18.1. A1c image-move path: overlay moves, engine gets no op (0 thumb mutations), reopened file keeps the image at the old rect (20,360 dark) and leaves the target empty (2,967). Band above stable, so not Class A. Source: EditOverlay.tsx:835-841 self-compares the placement rect and returns before committing. HIGH - the user's move is silently lost on save.)
- qa: CLOSED (2026-09-18 retest, post-fix `EditOverlay.tsx` imageDrag.startRect). Spec `e2e/class_sweep_def221_222.spec.cjs` B1/B2 (+ A1c) all pass. MOVE: overlay mirror `{x:380,y:608.4}` -> `{x:490,y:698.4}` (+110/+90); old rect dark 4,914 -> 4,914 (live, canvas is the pre-edit render by design) -> 0 (reopened, nearWhite=20,360/20,360 = fully white); target 2,967 -> 2,967 -> 20,360 (image); band above 4,193 stable; frame strips around the old rect byte-identical to before (hashes equal), so the white mask is exactly the old rect - no padding, no neighbour erasure. RESIZE (SE handle +70/+50): overlay 509x40 -> 579x90; reopened old 20,360 (image), new 52,110 (image), region beyond the new rect unchanged 71->71; above 4,193 stable. Flash: 0 thumb width/height-zero mutations, 0 zero-width/zero-painted main-canvas frames on both commits. Screenshots: screenshots/def-223-retest-{before,after,reopen}.png. Class A INCONCLUSIVE from the pre-1.18.1 sweep is now resolved: editImage's mask is clean (old rect only). Note: image placements have no live proxy refresh (the DOM overlay is the live surface; the canvas shows the edit after save/reopen) - pre-existing behaviour, not a move failure.)

## DEF-221: Moving a text run in Edit mode leaves an empty box at the original location after Confirm

- Status: CLOSED
- Severity: HIGH
- Found by: qa (operator-reported)
- Phase: 18

Steps to reproduce:
1. Launch TFlex (dev build via the canonical `launchApp` helper, no executablePath). Open the bundled report.pdf sample from the welcome card; scroll to page 1.
2. Arm Edit mode (`[data-toolbar-edit-toggle]`) -> `.edit-toolbar` mounts; click `[data-edit-tool="text"]`.
3. Double-click a body text run on page 1; the inline editor opens (`.edit-inline-editor[data-edit-editor="edit"]`) pre-filled with "A study in PDF orchestration and performance.".
4. Drag the editor grip `[data-edit-drag-handle]` ~+150/+120 so `[data-edit-confirm]` flips to "true"; click `[data-edit-confirm="true"]`.
5. Inspect the run's ORIGINAL location, then Save As to a temp path, close the tab, reopen the saved file and inspect it again.

Expected: The run relocates to the new position and the original location is clean - no residual white box and no erased neighbouring content. A plain in-place edit (no move) must leave no leftover.

Actual: After Confirm the ORIGINAL run location is left as a pure-white rectangular mask. Measured on the dev build (2026-09-18), spec `e2e/def221_222_leftover_thumb_flicker.spec.cjs`:
- DOM probe ~1.2s after Confirm: every candidate overlay is GONE - `[data-edit-box-eraser]` exists=false, `.edit-textrun-selection`=false, `.edit-text-hover`=false, `.edit-box`=false, `.edit-inline-editor`=false. (Pre-Confirm the eraser sat at the original rect {x:546,y:483,w:549,h:26}, computed background rgb(255,255,255), border `0px none`, opacity 1 - it can paint, but it unmounts correctly.) So the leftover is NOT a renderer overlay.
- Page-1 canvas pixel probe at the ORIGINAL run rect (fixed canvas px [302,290,548,26], immune to the post-edit layout shift caused by the "Undo last change" strip): BEFORE meanRGB [204,204,204], near-white 9,791/14,248, dark-glyph 2,867; AFTER meanRGB [255,255,255], near-white 14,248/14,248, dark-glyph 0. Uniformly white where glyph pixels were -> a white patch.
- Dense-paragraph probe (page 2, run "orchestration layer correctly handles multiple page streams. Strategic orchestration is" at y=551.7): BEFORE run-band dark 4,458 and the band immediately ABOVE the run dark 3,287; AFTER run-band dark 0 AND above-band dark 0. The mask is taller than the run (it extends up by the new text's font ascent) and erases the line above as well - the white box is punched through the paragraph.
- BAKED vs RENDERER: Save As -> close tab -> reopen the saved file. The original location is STILL uniformly white (fixed-px meanRGB [255,255,255], near-white 14,248/14,248, dark 0) and no DOM overlay exists. The white box is BAKED into the PDF (baked=true).
Mechanism: `engine.editTextRun` with the DEF-151 `oldRect` (src/main/services/engine.ts:1772-1816) draws a white rectangle (`drawRectangle`, fill rgb(1,1,1), no border) at `maskRect = payload.oldRect`, padded by the new text's font ascent/descent + PAD=2. That white mask is the "empty box"; it is part of the re-serialized PDF bytes, so it survives save+reopen. The renderer's `.edit-box-eraser` is only a transient cover and unmounts after the proxy refresh.
Screenshot: screenshots/def-221-before.png (run present before the move), screenshots/def-221-leftover-box.png (original location pure white after Confirm), screenshots/def-221-leftover-box-reopened.png (still white in the reopened saved file), screenshots/def-221-dense-after.png (white gap + neighbouring line partially erased on a dense paragraph)

History:
- qa: opened (2026-09-18; operator-reported. Dev-build repro via e2e/def221_222_leftover_thumb_flicker.spec.cjs. Move+Confirm leaves a baked white mask at the old rect: page-1 fixed-px BEFORE dark 2,867 / near-white 9,791 -> AFTER dark 0 / near-white 14,248, still white after Save As+reopen (baked=true). On a dense paragraph the mask also erases the line above (dark 3,287 -> 0). The renderer eraser/selection/editor all unmount, so the leftover is the engine's baked white rectangle. Control C (plain in-place edit, no move) leaves NO leftover. HIGH - baked into the saved file and erases neighbouring document content.)
- qa: retest FAILED (2026-09-18; FIX-READY retest via e2e/def221_222_leftover_thumb_flicker.spec.cjs, dev build). Band above NOT unchanged on the dense paragraph: above-band dark 3,287 -> 2,921. Row profile shows the 6 rows nearest the run (canvas 256-261) go exactly 0 while rows 246-255 are byte-identical; span geometry places those rows inside the line-above's own box (line-above span viewport y=526 h=23 -> 526..549; run span y=552; mask top ~viewport 544), so the neighbouring line's baseline/descender rows are still erased. The removed DEF-124 ascent/descent widening cut the erasure from 100% to ~11%, but the renderer's oldRect (target.rect) sits ~4-6px above the rendered textLayer span, so the tightened mask still clips the line above. Page-1 move: old-rect fixed-px dark 6, not 0 - 6 residual descender px ('y'/'p') on the old rect's bottom row, still 6 after Save As + reopen (baked). Run band 4,458->0 and below band 3,035->3,035 are correct; the moved text renders at the new position (dark 1,973). Control C (plain in-place edit) passed: text redrawn (fixed-px dark 1,979), band above 0->0, no leftover overlay. Screenshots: def-221-retest.png, def-221-dense-above-before.png / -after.png. Stays OPEN.)
- qa: CLOSED (2026-09-18; FIX-READY retest #2, dev build rebuilt via `npm.cmd run build`, spec `e2e/def221_222_leftover_thumb_flicker.spec.cjs` - 3/3 passed. Acceptance met. Page-1 move +150/+120: old-rect fixed-px dark 2,867 -> **0** (was 6 residual descender px pre-fix); band above 0 -> 0 (this run has no neighbour above - retention is pinned by the dense case). Moved text dark 1,973 -> 1,973 with byte-identical row profile [0,45,52,27,26,194,244,156,137,149,160,127,129,140,206,162,4,4,6,5,0,...], firstDarkRow 1 / lastDarkRow 19, centroid [670.6,419.3] - baseline unchanged, not clipped. Dense page 2: run band 4,458 -> **0**; band ABOVE 3,287 -> **3,287 byte-identical**, rows [298,262,240,332,364,224,226,261,288,426,319,6,9,8,14,10] unchanged (was 3,287 -> 2,921 pre-fix). Below band 3,035 -> 3,018: only the single boundary row immediately under the old run (row idx 3, the run's own descender zone) changed 54 -> 37; rows idx 6+ byte-identical [46,384,493,298,267,244,317,334,238,239] - the 17 px are the old run's own descenders now covered by the ink-anchored mask (same effect that took the page-1 old rect 6 -> 0), not neighbour erasure. Save As -> close -> reopen: old rect dark **0**, band above **0**, moved text 1,973 with identical rows (baked, no leftover, no neighbour loss). Control C (plain in-place edit): text redrawn 1,973 fixed-px, band above 0 -> 0, no leftover. DEF-222 re-confirmed: MutationObserver over 34 `.thumb-canvas` during Confirm = 10 mutations, zeroWidthSets 0 / zeroHeightSets 0 (was 5+5 zeroing); unmount removes all canvases. Screenshot `def-221-retest2.png`: old location + band above clean white; dense-above pair visually identical - paragraph "structures requires careful management of internal objects..." fully intact. Run-close: `npm.cmd run verify` exit 0 (conventions clean, tsc clean); targeted unit 4 files / 218 tests passed (def130_131_124 12, engine 195, sideRail 6, thumbGeometry 5).)

## DEF-222: The thumbnail panel flickers when a text-run edit is confirmed

- Status: CLOSED
- Severity: LOW
- Found by: qa (operator-reported)
- Phase: 18

Steps to reproduce:
1. Launch TFlex (dev build via `launchApp`); open report.pdf; scroll to page 1.
2. Arm Edit mode (`[data-toolbar-edit-toggle]`) -> click `[data-edit-tool="text"]`.
3. Double-click a body text run; drag `[data-edit-drag-handle]` +150/+120 (so `[data-edit-confirm]`="true"); click `[data-edit-confirm="true"]` and watch the thumbnail panel.

Expected: The thumbnails update without a visible blank/flash.

Actual: Confirming the edit blanks and repaints every rendered thumbnail. Measured on the dev build (2026-09-18), same spec:
- MutationObserver on all 34 mounted `.thumb-canvas` nodes: at t=116ms after the Confirm click the 5 RENDERED canvases (idx 0..4) had `width=0` AND `height=0` set (bitmap released), then restored to `width=189`/`height=244` at t=119ms - one wave, 20 attribute mutations (5 zero-width + 5 zero-height + 5 restores). The rAF poll independently saw the page-1 thumb canvas at `width=0` for ~1 frame (189->0@116ms, 0->189@131ms).
- Node identity is unchanged: 34 `.thumb-canvas` nodes before and after, 34/34 the SAME nodes, 0 replaced, and `.thumb-placeholder` stays constant at 29 (no placeholder appears). So the flicker is a canvas clear->async repaint on the SAME nodes, not an unmount->placeholder.
- The 5-shot screenshot burst of `.thumb-scroller` at ~200ms cadence (screenshots/def-222-thumb-0..4.png) is identical in all 5 - the flash lasts ~3ms (blank) to ~15ms (observed), shorter than the cadence.
Mechanism: `ThumbCanvas`'s effect (src/renderer/components/SideRail.tsx:913-992) depends on `[shouldRender, doc, page, width]`. When the edit commit calls `refreshDocProxyFor` and swaps the pdf.js `doc` proxy, the effect cleanup sets `canvas.width=0; canvas.height=0` (lines 987-990) to release the bitmap, and the new effect only repaints after `await doc.getPage(page)` resolves - so every rendered thumbnail is blank in between. It fires ONCE, coinciding with the proxy rebuild.
Screenshot: screenshots/def-222-thumb-0.png .. def-222-thumb-4.png (5-shot burst, no visible blank at that cadence)

History:
- qa: opened (2026-09-18; operator-reported. Dev-build repro via e2e/def221_222_leftover_thumb_flicker.spec.cjs. MutationObserver: all 5 rendered `.thumb-canvas` zeroed at t=116ms, restored t=119ms; same nodes, no placeholder. Transient blank/repaint of the thumbnail canvases when `refreshDocProxyFor` swaps the doc proxy. LOW - cosmetic, no document change, ~3-15ms.)
- qa: CLOSED (2026-09-18; FIX-READY retest passed via e2e/def221_222_leftover_thumb_flicker.spec.cjs, dev build. MutationObserver on all 34 `.thumb-canvas` during Confirm: zeroWidthSets 0, zeroHeightSets 0 (previously 5 zero-width + 5 zero-height + restores = 20 mutations; now 10 mutations, all non-zero restore sets width=189/height=244 at t=113-114ms). rAF probe (136 frames): zeroW 0, width constant 189, clearedFrames 0, minOp 1600/1600 -> the page-1 canvas is never zeroed or blanked in any sampled frame. Node identity 34/34 same, 0 replaced, `.thumb-placeholder` constant 29. True unmount: closing the tab removes every thumb canvas (remaining 0); the explicit width/height zeroing record was not captured across the unmount (the canvas ref detaches before passive cleanup) but with the nodes gone no backing store is retained. Flash not capturable; def-222-retest.png shows all thumbnails painted. Screenshots: def-222-retest.png, def-222-thumb-0..4.png.)

## DEF-220: Tiled watermarks scale superlinearly - 100 tiled stamps cost ~101 s of blocked IPC and a ~50 MiB file

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-044)
- Phase: 18

Steps to reproduce:
1. Launch TFlex (dev build via the canonical launchApp helper).
2. Open the 34-page sample report.pdf (source file 33,028 bytes).
3. Apply 100 tiled text watermarks through the engine API: `window.tflex.engine.addWatermark(docId, {type:'text', text:'WM<i>', size:24, tile:true})` for i=0..99, then `getWatermarks` and `saveAs`. Harness: `node test-fixtures/tools/adv041_perf.cjs 100 24 1` (control: `node test-fixtures/tools/adv041_perf.cjs 10 24 1`).

Expected: A document has a bounded number of watermarks and a bounded placement count, with a typed limit error instead of an unbounded op; file-size growth stays proportional.
Actual: Reproduced on the current tree (2026-09-18). No watermark-count cap and no placement cap: all 100 `addWatermark` calls return `ok` (0 failures), 3,400 (watermark,page) content streams. Measured:
- 10 tiled @24 pt: apply 1,032 ms, save 241 ms, saved file 6,039,275 bytes (~5.8 MiB).
- 100 tiled @24 pt: apply 100,587 ms (checkpoints: 10 -> 1,081 ms, 20 -> 3,947 ms, 30 -> 8,842 ms, 40 -> 15,762 ms, 50 -> 24,731 ms, 60 -> 35,499 ms, 70 -> 48,596 ms, 80 -> 64,238 ms, 90 -> 81,638 ms, 100 -> 100,586 ms - clearly superlinear as each addWatermark re-scans prior marker streams), getWatermarks 33 ms, save 2,173 ms, saved file 52,239,404 bytes (~49.8 MiB, ~1,582x the 33,028-byte source).
- The 101 s apply is a single blocked IPC round trip; the renderer waits and the UI is frozen for the whole duration. Shares its root cause with DEF-217 (no size/placement bounds) and DEF-218 (invalid optional fields silently dropped).

History:
- qa: CLOSED (2026-09-18; retest - `node test-fixtures/tools/adv041_perf.cjs 10 24 1`: apply 1136 ms, save 238 ms, 10 watermarks / 340 page placements, file 6,039,272 B (~5.8 MiB), 0 failures. `node test-fixtures/tools/adv041_perf.cjs 100 24 1`: 90 failures (first 10 ok, 11th+ rejected with the typed "already has 10 watermarks (maximum)" error), total apply 1333 ms, save 222 ms, file 6,039,272 B - not 101 s / 50 MiB, wall time low seconds.)
- backend-dev: FIX-READY (2026-09-18; covered by the same limits as DEF-217 - MAX_WATERMARKS_PER_DOC=10 makes the 100-tiled-stamp case impossible (the 11th apply returns the typed "already has 10 watermarks (maximum)" engine-error with nothing mutated), and MAX_WATERMARK_PLACEMENTS_PER_PAGE=5000 bounds each apply so the per-call cost stays proportional. The size bound (1..2000) also removes the tiny-size blow-up that made the 100-stamp case superlinear. The 10-tiled-on-34-pages control still succeeds and measures ~1 s apply / ~6 MB. Evidence: `npm.cmd run verify` exit 0; `npm.cmd run test:unit -- test/unit/main/watermark.test.ts` 37/37 passed (includes the 11th-watermark cap test). qa retest owed.)
- qa: opened (2026-09-17; accepted from ADV-044 - reproduced on current tree: `adv041_perf.cjs 10 24 1` apply 1032 ms / 6,039,275 B file; `adv041_perf.cjs 100 24 1` apply 100,587 ms superlinear / 52,239,404 B file (~1582x source), 100/100 ok, 3400 (watermark,page) streams, 0 failures)

## DEF-219: The applied-watermarks list overflows the dialog and pushes its actions ~3000 px below the viewport; a fast double delete shows a spurious not-found toast

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-043)
- Phase: 18

Steps to reproduce:
1. Launch TFlex; open the 34-page sample report.pdf.
2. Apply 50 watermarks through the engine API: `window.tflex.engine.addWatermark(docId, {type:'text', text:'L<i>', size:24})` for i=0..49.
3. Open Tools palette -> Watermark (viewport 1440x900) and inspect the applied-watermarks list. Harness: `node test-fixtures/tools/adv041_layout.cjs` and `node test-fixtures/tools/adv041_ui_delete.cjs 50`.
4. Click one row's Delete, then quickly click the first row's Delete again while the deleted row is still present in the DOM.

Expected: The applied list stays inside the dialog (scrolls within it), the footer/Apply row stays reachable, and a row's Delete is single-flight (a second click while the first is in flight cannot fire a delete for an already-deleted id).
Actual: Reproduced on the current tree (2026-09-18, viewport 1440x900, 50 watermarks).
- Layout: `.modal-dialog` is 460x836 at x=490, but `.modal-body` is 544 px wide starting at x=389 - ~101 px wider than the dialog and spilling out to its left. Dialog scrollWidth 544 vs clientWidth 443 (horizontal overflow), `.modal-body` computed `overflow: visible`, body height 2,932 px. The footer (Cancel / Apply watermark, height 61) sits at y=3017 in the 900 px viewport, ~2,117 px below the fold; only after scrolling the dialog ~2,932 px does it reach y=791 (reachable, not lost, but effectively buried). The wide "Pages 1, 2, ... 34" cell is the width driver.
- Delete refresh: after clicking Delete on wm-1 the DOM list still showed all 50 rows (including wm-1's Delete button) through every 300 ms poll up to ~1.9 s, while the engine-side delete had already landed (a reopened dialog lists 49 rows). A fast second click on the still-present row therefore fired a second delete of the already-deleted id, surfacing the toast "Engine error: deleteWatermark: no watermark with id wm-2 found" (observed toast sequence: "Watermark deleted.", "Watermark deleted.", "Engine error: deleteWatermark: no watermark with id wm-2 found").
Screenshot: screenshots/adv-041-applied-50-bottom.png (recaptured 2026-09-18 by the layout harness: 50-row list spilling past the dialog's left edge, footer only visible at the bottom after the ~2,932 px scroll), screenshots/adv-041-applied-50.png (dialog body overflowing its box at the top)

History:
- qa: CLOSED (2026-09-18; retest - `node test-fixtures/tools/adv041_layout.cjs` raw: 1440x900, dialog 460x836 @ x=490 with scrollWidth 459 == clientWidth 459, body 459 @ x=491 (sw 443 == cw 443), footer y 807 bottom 868 <= 900, dialog body scrolls internally (sh 1381/ch 721 auto). `npm.cmd run test:e2e -- e2e/def217_219_retest.spec.cjs` 5/5 passed: 10-row dialog sw 459 == cw 459, footer bottom 867 <= 900, list sh 1158 > ch 180 overflow-y auto; 0-row dialog sw 459 == cw 459, footer bottom 867; Apply and Cancel both elementFromPoint-hittable at 0 and 10 rows; same-tick double delete -> exactly one row removed (10 -> 9, engine 9), one "Watermark deleted." toast, no "no watermark with id" toast. Screenshot screenshots/def-219-retest.png: dialog contained, X/Y/Tile row wrapped, footer Cancel/Apply visible.)
- qa: OPEN - retest PARTIAL (2026-09-18; delete single-flight FIXED: same-tick double click on wm-1 -> exactly 9 rows remain, engine count 9, one "Watermark deleted." toast, no "no watermark with id ... found" toast, app responsive. Containment NOT fixed at the new 10-row maximum: viewport 1440x900, `.modal-dialog` 460 px at x=490 but `dialog.scrollWidth`=544 > `clientWidth`=443 and `.modal-body` 544 px at x=389 (101 px wider, same as pre-fix); footer at y=1409 (bottom 1470), outside the 900 px viewport; page itself not scrolled (doc 900/900). The applied list DOES scroll internally (list 180 px, scrollHeight 1158 > clientHeight 180, overflow-y auto). Baseline with 0 applied rows already overflows identically (body 544, footer bottom 1218), so the remaining overflow is not caused by the applied list - the fix does not meet the stated containment criteria. `node test-fixtures/tools/adv041_layout.cjs` and the `e2e/def217_219_retest.spec.cjs` layout test both fail at "dialog scrollWidth <= clientWidth" (544 vs 443). Screenshot: screenshots/def-219-retest.png (body clipped/left-shifted, footer not visible).)
- frontend-dev: FIX-READY (2026-09-18; the applied rows now live in their own `.watermark-applied-list` scroll area (`max-height: 180px; overflow-y: auto;`) and `.watermark-applied-row` is `min-width: 0; flex-wrap: wrap;` so the list can never widen the dialog or push the footer below the viewport (styles.css, inside the existing `.watermark-*` block, no new motion values). Delete is now single-flight: the dialog gained `busyWatermarkId?: string | null` and the matching row renders its Delete button `disabled` + `aria-busy="true"`; App tracks `deletingWatermarkId` with a `deleteInFlightRef` guard that returns immediately while a delete is in flight and clears it in a `finally`, so a double click can no longer fire a second delete and surface the spurious "no watermark with id ... found" toast. Note the 50-row repro is no longer reachable by design after DEF-220's 10-watermark document cap; the containment fix is verified at the new maximum (10 rows). Tests: test/unit/renderer/watermarkDialog.test.tsx 3 -> 6 (busy-row disabled/enabled pair, size 2001 rejected, size 0 rejected). Evidence: `npm.cmd run verify` exit 0; `npm.cmd run test:unit -- test/unit/renderer/watermarkDialog.test.tsx test/unit/renderer/tools-palette-watermark.test.tsx` 12/12 passed. qa retest owed.)
- qa: opened (2026-09-17; accepted from ADV-043 - reproduced: body 544 px wide at x=389 vs 460 px dialog at x=490 (101 px overflow), dialog scrollWidth 544 vs clientWidth 443, footer at y=3017 in the 900 px viewport (2,932 px scroll to reach it, y=791 after scroll); fast double delete produced the "no watermark with id wm-2 found" toast)

## DEF-218: A provided-but-invalid watermark page range is silently dropped, so the watermark is applied to every page

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-042)
- Phase: 18

Steps to reproduce:
1. Launch TFlex; load the 34-page sample report.pdf into a fresh engine document.
2. For each value below, call `window.tflex.engine.addWatermark(docId, {type:'text', text:'RG', range:<value>})` (fresh document per case): [0,0], [3,2], [1.5,3], ["1",2], [1,2,3], [NaN,2], [-5,-1], plus controls [1,9999] (out-of-bounds), [1,1] and [5,6] (valid). Harness: `node test-fixtures/tools/adv041_wm_api.cjs ranges`.

Expected: A range that is present but invalid (start < 1, inverted, non-integer, non-numeric, NaN, wrong length) must reject the payload with a typed engine-error, so the caller does not silently get a different scope than requested.
Actual: Reproduced on the current tree (2026-09-18). Every malformed range is silently dropped by `normalizeWatermarkSettings` (fallback `[1, 34]`) and the watermark is baked irreversibly onto all 34 pages, returning `ok` each time (document marked modified, getWatermarks pages = 1..34):
- `[0,0]` -> ok, pages 1..34
- `[3,2]` -> ok, pages 1..34
- `[1.5,3]` -> ok, pages 1..34
- `["1",2]` -> ok, pages 1..34
- `[1,2,3]` -> ok, pages 1..34
- `[NaN,2]` -> ok, pages 1..34
- `[-5,-1]` -> ok, pages 1..34
- `[1,9999]` -> rejected `out-of-range` ("addWatermark: range [1,9999] out of bounds for 34 pages") - the only check that fires
- `[1,1]` -> ok, page 1; `[5,6]` -> ok, pages 5-6 (valid controls)
Screenshot: N/A

History:
- qa: CLOSED (2026-09-18; retest - `node test-fixtures/tools/adv041_wm_api.cjs ranges`: [0,0], [3,2], [1.5,3], ["1",2], [1,2,3], [NaN,2], [-5,-1] each return typed engine-error "addWatermark: settings are invalid" with applied:false and 0 watermarks (nothing stamped); [1,9999] still returns the separate out-of-range error "addWatermark: range [1,9999] out of bounds for 34 pages"; valid controls honour exactly their pages - [1,1] -> pages [1], [5,6] -> pages [5,6].)
- backend-dev: FIX-READY (2026-09-18; covered by the same validation-contract fix as DEF-217 - a present-but-invalid `range` now rejects the whole payload instead of being dropped, so a mistyped range can no longer silently stamp every page. Rejected cases: [0,0], [3,2], [1.5,3], ['1',2], [1,2,3], [NaN,2], [-5,-1]; accepted controls [2,2] and [5,6]; out-of-bounds [1,9] on a 2-page doc still returns the separate `out-of-range` error. Regression pin added in the unit suite: `range: [3,2]` -> typed `engine-error` and NO pages stamped. Evidence: `npm.cmd run verify` exit 0; `npm.cmd run test:unit -- test/unit/main/watermark.test.ts` 37/37 passed. qa retest owed.)
- qa: opened (2026-09-17; accepted from ADV-042 - reproduced: all seven malformed ranges return ok and bake the watermark onto pages 1..34; only [1,9999] errors with out-of-range; valid controls [1,1] and [5,6] honor the range)

## DEF-217: A tiled text watermark with a tiny size freezes and then crashes the app (unbounded tile placement loop)

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-041)
- Phase: 18

Steps to reproduce:
1. Launch TFlex; open a PDF (the 1-page sample form.pdf suffices; also reproducible on the 34-page report.pdf).
2. UI path: Tools palette -> Watermark; put "X" in the text field; tick Tile; set Size = 0.25 (the dialog's `min={4}` is advisory - typing a smaller number is accepted); click Apply watermark.
3. API path (equivalent): `window.tflex.engine.addWatermark(docId, {type:'text', text:'X', size:0.25, tile:true})`.
4. Harness: `node test-fixtures/tools/adv041_tile.cjs 0.25 form` (controls: `... 1 form`, `... 0.5 form`).

Expected: A bounded, responsive apply (or a clear typed limit error); the app stays alive.
Actual: Reproduced on the current tree (2026-09-18). `normalizeWatermarkSettings` accepts any `size > 0` with no lower bound and the tile loop emits ~270,000/size^2 placements with no cap, so apply cost scales ~size^-2. Measured single-page apply on form.pdf:
- size 1 -> `addWatermark` ok in 1,059 ms
- size 0.5 -> ok in 3,819 ms
- size 0.25 -> never returns: the renderer becomes unresponsive and the Electron target dies; the harness FATALs with `page.evaluate: Target page, context or browser has been closed` (that target-closed exit IS the reproduction; the adversary measured the Electron working set peaking at 4,569 MB in the same scenario).
No typed error, no recovery. The same missing bound is unbounded in the other direction: `size: 1e9` also bakes (invisible off-page glyph) without complaint.
Screenshot: screenshots/adv-041-tile-size-025-before-apply.png (Watermark dialog with Size 0.25 + Tile checked, captured immediately before the freezing Apply; the dialog body is also visible overflowing its box)

History:
- qa: CLOSED (2026-09-18; retest - `node test-fixtures/tools/adv041_tile.cjs 0.25 form` / `0.5 form` -> typed engine-error "addWatermark: settings are invalid" (1 ms), `1 form` -> typed engine-error "tiling at this size would place more than 5000 copies on page 1" (9 ms); app alive, no target death. `e2e/def217_219_retest.spec.cjs` API test confirms each rejected payload leaves modified:false and 0 watermarks; 10 valid applies then the 11th returns "already has 10 watermarks (maximum)" with exactly 10 kept. UI half: dialog Tile + Size 0.25 + Apply shows "The watermark size must be between 4 and 2000 points." with no toast and no engine call.)
- backend-dev: FIX-READY (2026-09-18; `normalizeWatermarkSettings` now rejects a PRESENT-but-invalid payload instead of dropping the field (absent fields still default): range must be exactly 2 integers with start >= 1 and start <= end; size must be finite and within MIN_WATERMARK_SIZE=1 .. MAX_WATERMARK_SIZE=2000; x/y must come as a finite pair; color r/g/b finite in [0,1]; font/position/type from their allow-lists; boolean flags must be booleans. Invalid payload -> typed `engine-error` "addWatermark: settings are invalid" with NOTHING mutated. New exported limits in settings.ts: MIN_WATERMARK_SIZE=1, MAX_WATERMARK_SIZE=2000, MAX_WATERMARK_PLACEMENTS_PER_PAGE=5000, MAX_WATERMARKS_PER_DOC=10. Engine guards before any mutation: the 11th watermark on a document -> "addWatermark: this document already has 10 watermarks (maximum)"; the tile branch computes its row/col counts arithmetically (no loop) and rejects above 5000 placements per page -> "addWatermark: tiling at this size would place more than 5000 copies on page <n> (increase the size or turn tiling off)". The dialog additionally refuses size outside 4..2000 in-dialog. Tests: 28 -> 37 in test/unit/main/watermark.test.ts (9 added: per-field rejects, opacity clamp controls, tiny-tile untouched-no-mutation, placement cap at size 1 + tile, legit size-24 tile still succeeds, 11th-watermark cap, inverted-range pin). Evidence: `npm.cmd run verify` exit 0; `npm.cmd run test:unit -- test/unit/main/watermark.test.ts` 37/37 passed. qa retest owed.)
- qa: opened (2026-09-17; accepted from ADV-041 - reproduced: size 1 = 1,059 ms ok, size 0.5 = 3,819 ms ok, size 0.25 never returns and the renderer target closed ("Target page, context or browser has been closed"); no typed limit error)

## DEF-216: Phase 18 Watermark "Apply watermark" is a dead path - the engine:addWatermark channel is never registered in main and never exposed in preload

- Status: CLOSED
- Severity: HIGH
- Found by: qa (phase-18 gate triage)
- Phase: 18

Steps to reproduce:
1. Build the dev bundle: `npm.cmd run build:renderer` + `npm.cmd run build:node` (the full `npm.cmd run build` halts in typecheck on the known DEF-215 errors before it reaches bundling).
2. Launch the dev build through the canonical `launchApp` helper from `e2e/lib/launch.cjs` (spec: `e2e/verify/def216_watermark_deadpath.spec.cjs`).
3. On the welcome screen, open the bundled `report.pdf` sample.
4. Open the Tools palette (`[data-tools-toggle]`, the "All Tools" badge) and click the `Watermark` entry (`[data-tool-id="watermark"]`).
5. In the Watermark dialog (`[data-watermark-dialog]`), type "CONFIDENTIAL" into the text field (`[data-watermark-text]`).
6. Click "Apply watermark" (`[data-watermark-confirm]`).

Expected: The engine bakes the watermark into the document and the host shows the info toast "Watermark applied." with the baked watermark visible on the page (the Phase 18 promise).
Actual: The dialog closes and an ERROR toast is shown instead: `Engine error: watermark requires the Phase 18 backend update` (DOM class `toast toast-error`); nothing is baked onto the page. Root cause, confirmed at HEAD: the IPC channel `engineAddWatermark` = `"engine:addWatermark"` is declared at `src/shared/ipc.ts:144`, but (a) `src/main/index.ts` has NO `ipcMain.handle` registration for it — the engine handler block (~lines 176-360) ends at `engineImportFdf` — and (b) `src/preload/preload.ts` exposes no `addWatermark` method on the engine bridge (the bridge ends at `importFdf`; the `addStamp` block, ~lines 294-299, is the last Phase 12 entry). `engineClient.addWatermark` therefore hits its `missingPhase18()` guard (`src/renderer/engine/engineClient.ts:1211`, message at `:639`) and returns `err("engine-error", "watermark requires the Phase 18 backend update")`, which `onWatermarkConfirm` in `src/renderer/App.tsx` surfaces as the error toast via `describeEngineError`.
Screenshot: screenshots/def-216-watermark-deadpath.png

History:
- qa: opened (2026-09-17; phase-18 gate triage - new spec e2e/verify/def216_watermark_deadpath.spec.cjs, 0 passed/1 failed)
- qa: CLOSED (2026-09-17; retest after the backend fix - `npm.cmd run test:e2e -- e2e/verify/def216_watermark_deadpath.spec.cjs` 1 passed/0 failed (5.4s, exit 0); toast now "Watermark applied." (class toast-info, isError=false); the baked "CONFIDENTIAL" watermark is visible on page 1 and its thumbnail; addWatermark is registered in src/main/index.ts and exposed in src/preload/preload.ts; screenshot screenshots/def-216-retest.png)

## DEF-215: `npm run verify` fails at HEAD - two stale Phase-17 PreferencesDialog specs reference props the redesigned component no longer declares

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (phase-18 gate triage)
- Phase: 18 (gate)

Steps to reproduce:
1. On the current HEAD tree, run `npm.cmd run verify` (which is `node scripts/check-conventions.mjs && npm run typecheck`).

Expected: Exit code 0 — "conventions: clean" plus a clean typecheck (`tsc --noEmit -p tsconfig.json`).
Actual: Exit code 1. Conventions pass ("conventions: clean (135 source file(s) scanned)") but typecheck fails with exactly two TS2322 errors:
  - `test/unit/renderer/prefsAppearanceCategory.test.tsx(54,9)` — Property 'toolsPaletteLayout' does not exist on type 'IntrinsicAttributes & PreferencesDialogProps'.
  - `test/unit/renderer/prefsGeneralCategory.test.tsx(56,11)` — Property 'showWelcomeOnStartup' does not exist on type 'IntrinsicAttributes & PreferencesDialogProps'.
Exact compiler output (verbatim from `npm.cmd run verify` at HEAD):
    test/unit/renderer/prefsAppearanceCategory.test.tsx(54,9): error TS2322: Type '{ open: true; onClose: () => void; themeDefault: "dark"; recentsCap: number; onSetThemeDefault: (v: ThemeDefault) => void; onThemeChange: (v: ThemeDefault) => void; ... 4 more ...; onSetPagesPanelCollapsed: ((v: boolean) => void) | undefined; }' is not assignable to type 'IntrinsicAttributes & PreferencesDialogProps'.
      Property 'toolsPaletteLayout' does not exist on type 'IntrinsicAttributes & PreferencesDialogProps'.
    test/unit/renderer/prefsGeneralCategory.test.tsx(56,11): error TS2322: Type '{ open: boolean; onClose: () => void; themeDefault: "dark"; recentsCap: number; onSetThemeDefault: () => void; onThemeChange: (v: ThemeDefault) => void; onSetRecentsCap: () => void; showWelcomeOnStartup: boolean | undefined; ... 5 more ...; onSetDefaultPdfHandler: (() => void) | undefined; }' is not assignable to type 'IntrinsicAttributes & PreferencesDialogProps'.
      Property 'showWelcomeOnStartup' does not exist on type 'IntrinsicAttributes & PreferencesDialogProps'.
The two specs test the OLD Phase-17 sidebar-navigation PreferencesDialog that the single-panel redesign (commit 855ad17) removed: the redesign dropped `toolsPaletteLayout` / `showWelcomeOnStartup` from `PreferencesDialogProps` but left the two unit specs behind, so the phase-gate typecheck cannot pass at HEAD.

History:
- qa: opened (2026-09-17; phase-18 gate triage - reproduction of the two TS2322 errors on the current HEAD tree)
- frontend-dev: FIX-READY (2026-09-17; deleted the two obsolete specs `test/unit/renderer/prefsAppearanceCategory.test.tsx` + `prefsGeneralCategory.test.tsx` (they test the removed sidebar-navigation design) and added `test/unit/renderer/prefsDialogRedesign.test.tsx` with 5 tests pinning the redesigned single-panel dialog: dialog mounts, the three section titles in order (Appearance / Recent files / Storage locations), the theme select offers exactly Light/Dark/Frosted/System default, changing it fires onSetThemeDefault + onThemeChange, and entering 25 in the recents-cap input lanes to onSetRecentsCap(25). `PreferencesDialog.tsx` untouched. Evidence: `npm.cmd run verify` exit 0 ("conventions: clean (135 source file(s) scanned)" + clean tsc); targeted run `npm.cmd run test:unit -- test/unit/renderer/preferences.test.ts test/unit/renderer/prefsDialogRedesign.test.tsx test/unit/renderer/prefsThemeImmediate.test.tsx` = 3 files / 68 tests passed. qa retest owed.)
- qa: CLOSED (2026-09-18; run-close retest of the red gate - `npm.cmd run verify` exit 0 with conventions clean + clean tsc; the two stale specs `prefsAppearanceCategory.test.tsx` / `prefsGeneralCategory.test.tsx` are gone and `prefsDialogRedesign.test.tsx` (5 tests) is present; targeted run `npm.cmd run test:unit -- test/unit/renderer/prefsDialogRedesign.test.tsx test/unit/renderer/preferences.test.ts test/unit/renderer/prefsThemeImmediate.test.tsx` = 3 files / 68 tests passed. The status was set CLOSED by the retest batch; this History line restores the required close record, citing the evidence re-verified by the run-close QA pass, item 2.)

## DEF-214: Installed v1.16.1 ships without the annotation toolbar - and the Edit toggle is missing from the CommandBar, so the edit toolbar is unreachable

- Status: CLOSED
- Severity: HIGH
- Found by: qa (user report, installed v1.16.1)
- Phase: installed v1.16.1 (release build)

Steps to reproduce:
1. Launch the installed TFlex v1.16.1 (`%LOCALAPPDATA%\Programs\tflex\TFlex.exe`, FileVersion 1.16.1 — the task referenced `%LOCALAPPDATA%\tflex\TFlex.exe`, but that path does not exist; the NSIS install lives under `%LOCALAPPDATA%\Programs\tflex\`).
2. On the welcome screen, click the "report" sample card (or open any PDF).
3. Wait for the PDF page canvas to render, then inspect the workspace chrome below the CommandBar, and the DOM for `.ann-toolbar`, `.edit-toolbar`, `[data-toolbar-edit-toggle]`.

Expected: `.ann-toolbar` (text markup / pen / text box / shapes / note / color swatch tools) is mounted directly below the CommandBar whenever a document is open (current source mounts it unconditionally: `src/renderer/components/DocumentView.tsx` line ~2056); the CommandBar carries the "Edit content" toggle (`data-toolbar-edit-toggle`), and arming it mounts `.edit-toolbar`.
Actual: `.ann-toolbar` is NOT in the DOM at all (not merely hidden — no element exists); `[data-toolbar-edit-toggle]` is also absent from the CommandBar, so Edit mode cannot be armed and `.edit-toolbar` can never mount. The CommandBar itself renders correctly (Open, page nav, save/save-as, zoom, search, rotate, pan, delete, sign, optimize, audit all present), the PDF canvas renders (34-page report.pdf), and there are ZERO renderer console errors and ZERO uncaught page errors — the renderer did not crash; the toolbar components simply never mounted. `.workspace-main` children are exactly: `div.toolbar`, `div.document-scroller`, `button.tools-badge-tracker` — no toolbar row between the CommandBar and the page. User-confirmed symptom: annotation/edit toolbars not visible when opening PDFs in the installed v1.16.1 (About dialog confirms 1.16.1).

Screenshot: screenshots/missing-toolbars.png (installed v1.16.1 with report.pdf open: CommandBar present, page canvas directly below it, no annotation toolbar row)

History:
- qa: opened (2026-09-15; reproduced on the actually installed v1.16.1 build. Evidence run: `npm.cmd run test:e2e -- e2e/investigate_missing_toolbars.spec.cjs` — the spec was repointed from launchDev to the canonical launchApp() pointed at the installed exe; probe output: `ann-toolbar = NOT IN DOM`, `edit-toolbar = NOT IN DOM`, `.toolbar (CommandBar) = IN DOM`, `CommandBar Edit toggle [data-toolbar-edit-toggle] not found`, console errors after open: none, 1 passed / 4.6s. State B (arm Edit mode) could not be executed because the toggle itself is missing from the installed CommandBar. Dev-build status for this spec was out of scope for this run; whether the current source reproduces it (i.e. the release was built from a regressed renderer) is for the developer to triage.)
- frontend-dev: WORKING AS INTENDED (investigation result: this was a packaging integrity issue where the v1.16.1 installer was built from a stale renderer bundle containing code from a mid-refactor state, not a code defect. The defect is resolved in v1.16.2 and v1.17.0 which are built from clean source. The packaging process needs guards to prevent this issue from happening again.)
- qa: CLOSED (2026-09-16; re-verified on the v1.17.0 release artifact per the release defect-disposition rule. Ran `npm.cmd run test:e2e -- e2e/def214_reverify_v1170.spec.cjs` with TFLEX_PACKAGED_EXE pointed at `release\win-unpacked\TFlex.exe` (FileVersion 1.17.0 — the same payload the NSIS installer and portable build ship), launched through the canonical launchApp() from a clean build of the v1.17.0 HEAD tree: open the bundled report sample → `.ann-toolbar` present in the DOM and visible (1220x52, directly below the CommandBar), `[data-toolbar-edit-toggle]` present in the CommandBar (count 1), arming it mounts `.edit-toolbar` (1220x39), zero renderer console errors and zero uncaught page errors after open. The v1.16.1 failure mode (toolbars absent from the DOM entirely) does not reproduce on the v1.17.0 artifact. Packaging-side guard (Pre-Release Verification Checklist incl. bundle spot-check + installer test) recorded in AGENTS_NOTES 2026-09-15. Screenshots: screenshots/def214-v1170-ann-toolbar.png, screenshots/def214-v1170-editmode.png.)

## DEF-212: Preferences "Theme default" dropdown is missing the Frosted option — only Light / Dark / Match system are offered

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 6+ (post-v1 Preferences theme dropdown feature)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs).
2. Click the settings gear `[data-open-preferences]` in the title bar (or Edit → Preferences / Ctrl+,).
3. The Preferences sheet opens; locate the "Appearance → Theme default" dropdown.
4. Expand the dropdown.

Expected: The theme-default dropdown offers all four promised options — Light, Dark, Frosted and a system option — so the user can persist any of them as the startup theme (Phase 6 contract: "Preferences (theme default, …)"; the feature spec for this dispatch promises Light/Dark/Frosted/System default).
Actual: The dropdown offers exactly three options: "Light" (value `light`), "Dark" (value `dark`), "Match system" (value `system`). There is no "Frosted" entry anywhere in the Preferences sheet, so Frosted cannot be set as the default startup theme from Preferences — it is only reachable at runtime via the title-bar theme popover. Secondary: the system option is labeled "Match system" rather than the promised "System default" label.
Screenshot: screenshots/def-212-prefs-theme-dialog.png (Preferences sheet, Theme default dropdown showing "Dark"; the evidence run logged OPTIONS_EVIDENCE ["Light","Dark","Match system"] with values light/dark/system)

History:
- qa: opened (2026-09-15; e2e/theme_dropdown_exists.spec.cjs FAILED — `expect(options).toContain('Frosted')` against the actual option list ['Light','Dark','Match system']; the select control itself exists and opens, but one of the four promised options is absent)
- qa: CLOSED (2026-09-15 retest after frontend-dev added Frosted + backend-dev settings persistence fix). Retested the exact repro: e2e/theme_dropdown_exists.spec.cjs PASSED — options now ['Light', 'Dark', 'Frosted', 'System default'] (secondary label issue also fixed). Regression: new e2e/theme_frosted_persist.spec.cjs 2/2 PASSED — (1) Frosted selectable, `themeDefault: "frosted"` re-parsed from settings.json on disk, dropdown still shows Frosted after app restart; (2) persisted themeDefault applies on next launch (boot theme followed themeDefault 'frosted' over a persisted theme 'dark'). Fresh evidence: screenshots/def-212-closed-frosted-selected.png (dialog visually clean, Frosted selected, header pill reads "Frosted Glass"). Follow-up edge case filed as DEF-213.

## DEF-213: Preferences "Theme default" shows "Dark" when the field is absent, and re-selecting Dark is a silent no-op

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 6+ (post-v1 Preferences theme dropdown feature; surfaced during DEF-212 retest)

Steps to reproduce:
1. Launch TFlex with a fresh profile (no settings.json — e.g. new install; in e2e: launchApp with an empty userData dir).
2. The app boots with the Frosted theme (factory default). Open Preferences via the gear button.
3. Look at the "Appearance → Theme default" dropdown: it displays "Dark".
4. Select "Dark" in the dropdown (re-selecting the displayed value), wait, then close the app and read settings.json in the profile directory.

Expected: The dropdown shows the default the app actually boots with (Frosted on a factory profile); explicitly selecting "Dark" persists `themeDefault: "dark"` so the choice is stored.
Actual: The dropdown displays "Dark" while the app actually boots Frosted (display mismatch for an absent field). Selecting "Dark" persists nothing — settings.json contains no `themeDefault` key at all (the reducer treats an absent field as already 'dark' and returns state unchanged; the renderer still calls trackAndSave, which rewrites the file with unchanged defaults). Selecting Light / Frosted / System default persists correctly, so the impact is limited to the displayed-value no-op and the wrong displayed default. Code refs for the developer: `src/renderer/state/preferences.ts:134` (`state.themeDefault ?? 'dark'`) and `src/renderer/App.tsx:7120` (`settings.themeDefault ?? 'dark'`).
Screenshot: (none — evidence is on-disk state; repro spec e2e/probe_theme_persist.spec.cjs logs settings.json before/after the Dark selection: after select, DOM select value = 'dark' but file content is unchanged defaults with no themeDefault)

History:
- qa: opened (2026-09-15; found by the e2e probe run while verifying DEF-212 persistence — selecting Dark on a fresh profile left settings.json without themeDefault, confirmed while the app was still running, so it is not a quit-time clobber)
- frontend-dev: FIX-READY (2026-09-17; the implicit default now follows the concrete booted theme instead of the hardcoded 'dark': `src/renderer/state/preferences.ts:134` is now `state.themeDefault ?? state.theme` and `src/renderer/App.tsx:7141` is now `settings.themeDefault ?? settings.theme` (the file had drifted from :7120 to :7141 since the report). On a factory profile `theme` is 'frosted' (src/main/services/settings.ts:169) and `themeDefault` is only written when the persisted value is a valid string (:250), so the dropdown now shows Frosted — the theme the app actually boots — and explicitly picking Dark produces `{...state, themeDefault:'dark'}` instead of the identity no-op. Unit tests added in `test/unit/renderer/preferences.test.ts` (`set-theme-default` describe): factory shape theme:'frosted' + pick 'dark' -> themeDefault 'dark' and result !== input; pick 'frosted' -> identity (no redundant persist). The stale comment at the old lines 49-51 was updated to name the concrete `theme` as the implicit default. Evidence: `npm.cmd run verify` exit 0; `npm.cmd run test:unit -- test/unit/renderer/preferences.test.ts test/unit/renderer/prefsDialogRedesign.test.tsx test/unit/renderer/prefsThemeImmediate.test.tsx` = 68 tests passed. qa retest owed.)
- qa: CLOSED (2026-09-17; retest via `npm.cmd run test:e2e -- e2e/probe_theme_persist.spec.cjs` (fresh empty user-data profile) 1 passed/0 failed (1.7s, exit 0). Assertion 1: fresh-profile "Theme default" select value = `frosted` (pre-fix `dark`). Assertion 2: after selecting `dark`, settings.json read WHILE the app was still running = `{"theme":"frosted","geometry":{"x":100,"y":100,"width":1440,"height":900,"maximized":false},"recentFiles":[],"themeDefault":"dark"}` — the `"themeDefault":"dark"` key is now present (pre-fix it was a silent no-op, key absent); post-quit content identical, so it was a live write. Screenshot screenshots/def-213-retest.png (Preferences open on the fresh profile, the theme-default dropdown showing Frosted).)

## DEF-211: Ghost annotation remains interactive when dialog opens — annotation tool not disarmed before dialog mount

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (tool-disarm regression sweep)
- Phase: 15/16 (live regression)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open any PDF (e.g., report.pdf).
2. Arm an annotation tool in the toolbar (e.g., "Text box", "Note", or "Pen").
3. Place the ghost on a page (click on page 1) so the annotation is in a pending/unconfirmed state.
4. Without confirming the annotation (do NOT click "Confirm" on the floating action bar, do NOT press Escape), open a dialog from the toolbar, menu or Tools palette: "Insert Pages", "Optimize", "Save As", "Merge", "Split/Extract", "Delete Pages", "About", "Preferences", or any other modal dialog.

Expected: Before the dialog mounts, the active annotation tool is DISARMED — the ghost and any pending overlay are removed, the action bar disappears, and the underlying document canvas becomes non-interactive for annotation purposes. The dialog then opens cleanly on a neutral workspace with no overlay artifacts.
Actual (pre-fix): The dialog mounted OVER the live ghost/pending annotation; the ghost annotation overlay remained interactive in the background, and the pending action bar could remain visible over the dialog backdrop.

Screenshot: screenshots/def-211-t1-insert-pages.png (dialog open, no ghost overlay), def-211-t1-ghost-armed.png (ghost before the dialog), def-211-t1-insert-pages-moment.png (dialog-mount instant), def-211-t2-optimize.png, def-211-t2-ghost-armed.png, def-211-t3-saveas.png, def-211-t3-ghost-armed.png

History:
- qa: opened (2026-09-14; reported incomplete from DEF-090/DEF-088 cross-bubbling rule sweep; no prior tracking entry exists)
- frontend-dev: FIX-READY (2026-09-14; DocumentView.tsx wrapped with forwardRef + useImperativeHandle exposing disarmAnnotationTool; App.tsx wires per-tab refs and calls disarm before 20+ dialog openers; typecheck + build:renderer clean)
- qa: CLOSED (2026-09-14 retest on the rebuilt dev build, dist rebuilt fresh via `npm run build` so the working-tree fix is in the bundle; evidence: e2e/retests/def_211_ghost_dialog_retest.spec.cjs — 3 scenarios, 3/3 pass, 24.3s, zero renderer pageerrors. T1 Insert Pages over a pending Text-box ghost (Tools palette -> insertPages): ghost+action bar confirmed present pre-dialog, tflexDiagnostics().activeTool flips to the disarmed value (null; the only path an armed tool reaches it is disarmAnnotationTool()) and the ghost DOM (editor + action bar) is gone once the dialog mounts; the dialog's own controls respond (from-PDF radio reveals Pick button; close via the sheet X). T2 Optimize over a pending Note ghost: same disarm verified, Cancel button responds. T3 Save As sheet over a Text-box ghost on a modified doc: sheet mounts clean, the linearize checkbox toggles, Cancel closes cleanly. Post-close the canvas is neutral (a click places no ghost) and the re-armed tool still functions. Regression note: a mid-run triage probe (e2e/retests/def_211_probe_place.spec.cjs) initially suggested "placement does not land" — that was the retest's own viewport-clamping bug (page slot is taller than the window at fit-width; the click landed below the window), not a product issue; the probe kept as a placement sanity test.)

## DEF-210: Pen tool (freehand ink) throws engine error on every stroke — normalizeAnnotationPayload has no branch for points-only ink payloads

- Status: CLOSED
- Severity: HIGH
- Found by: user (live usage)
- Phase: 15 (live regression)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs).
2. Open any PDF (e.g., report.pdf).
3. Arm the Pen tool in the annotation toolbar.
4. Draw a short stroke on page 1 and release.

Expected: the stroke commits as an ink annotation and renders on the page.
Actual: an engine-error toast appears with message "Annotation requires at least one rect" and no annotation is created.

Actual (fixed behavior, verified 2026-09-13): no toast of any kind at the stroke checkpoint (the only toast in the entire run was the info toast "Saved a copy of ...report.pdf."). The stroke commits — exactly one engine annotation { kind:'ink', page:1, points:11, width:3, rects[0]: {x:214.20, y:237.60, w:122.40, h:95.04} } whose rects[0] numerically equals the points' min/max extent (<0.5pt), proving the derived-bbox branch runs. The committed `.ann-ink.ann-content` overlay path renders on page 1 (stroke #2563eb, 3pt); the annotations panel lists "Pen stroke / Page 1"; window.tflexDiagnostics().engineState.annotations shows the ink annotation. Disarm: Escape sets activeTool=null and clicking Highlight sets activeTool=highlight — the ink line stays visible through both. Round-trip: Save As -> close tab -> reopen; pdf-lib re-parse of the saved file finds exactly one /Ink annotation with /InkList of 11 points and /Rect [214.2000129474924, 459.36121409398015, 336.60003884247726, 554.400857961777] equal to the InkList min/max extent (PDF bottom-left space, y-flipped) — the fix's derivation persisted in the file; after reopen the engine state again holds 1 ink annotation with the same 11 points and the overlay re-renders (also visible in the page-1 thumbnail). Zero renderer pageerrors. Evidence run: e2e/retests/def_210_pen_retest.spec.cjs (1 passed, 10.6s). Allowlist half verified first-hand: test/unit/main/annotations.test.ts 100/100 pass.

Screenshot: screenshots/def-210-stroke-committed.png (stroke renders, Pen armed, no toast), def-210-annotations-panel.png (panel row), def-210-disarm-escape.png (disarmed, line persists), def-210-reopened.png (saved file reopened with the stroke)

Root cause: `normalizeAnnotationPayload` in `src/main/services/annotations.ts` checked geometry sources in order: `rect` → `at` → `rects[]` → `from`+`to` (arrow) → throw. The renderer's pen commit sends `{ kind: 'ink', points[], width }` with no rect field, so it fell into the throw branch before the `points` validation was ever reached. Additionally, `normalizeKind` silently cast unknown kinds (e.g. `'pen'`) through, which would corrupt the saved PDF.

Fix: backend-dev — added an `else if` branch in `normalizeAnnotationPayload` that derives `/Rect` from the points' min/max extent when `points` is a non-empty array. Rewrote `normalizeKind` with an `ANN_KINDS` allowlist so unknown kinds are rejected at create with a typed `engine-error`.
Files changed: `src/main/services/annotations.ts` (normalizeAnnotationPayload lines 229-253, normalizeKind lines 286-312, plus new ANN_KINDS set). Unit tests added: 5 new tests in `test/unit/main/annotations.test.ts`. Full suite: 3086/3086 pass.
History:
- user: reported live during usage
- backend-dev: FIX-READY (2026-09-13; derived bbox from points extent; kind allowlist enforced)
- qa: CLOSED (2026-09-13 retest on the rebuilt dev bundle, dist rebuilt with npm run build; e2e evidence e2e/retests/def_210_pen_retest.spec.cjs, screenshots above; note: the committed ink stroke renders full-opacity blue #2563eb — the "translucent" wording in the retest request describes the shipped look loosely, opacity applies to markup fills only, not a defect)

## DEF-209: A PDF with >1000 annotations on one page opens into a broken shell — the open must be refused with a clear limit error

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-030)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp).
2. Open test-fixtures/huge-annotations.pdf (5000 baked highlight annotations on one page; pdf-lib parses it as 1 page) via the Open flow.
3. Watch the open result and the fixture file.

Expected: a clear refusal — the per-page annotation count exceeds the renderer's mirror limit (1000), so the document must not open; the user sees a limit error; the fixture is not written to.

Actual (fixed behavior, verified 2026-09-13): the open is refused with the toast "Too many annotations on page 1 (1000 max). The document was not opened.", no .workspace mounts (no hollow tab), the fixture file is byte-identical after the attempt (size unchanged — the ADV-030 in-place-save corruption path cannot reoccur from an open), and zero renderer pageerrors. The app stays usable (a good PDF still opens afterwards — verified in the same spec family). Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 6; unit contract test/unit/renderer/bugDEF209_annotationPageLimit.test.ts (9 tests) green in the full unit run. MAX_ANNOTATIONS_PER_PAGE = 1000 in src/renderer/annotations/model.ts; the check runs on the seeded engine state in App.tsx.

Screenshot: screenshots/def-209-retest.png (limit toast, welcome screen, no workspace)

History:
- qa: opened (accepted from ADV-030)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, dist rebuilt from the current tree; new fixture evidence above)

## DEF-208: Zero-page / broken page-tree PDFs open as hollow tabs — they must be rejected with the corrupt-file error

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-029)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp).
2. Open test-fixtures/zero-page.pdf — a crafted valid-%PDF-header document with an EMPTY page tree (/Count 0, /Kids []; verified with pdfjs-dist: getDocument resolves it with numPages=0, so it passes the main-process %PDF- sniff and reaches the renderer parser, exactly the ADV-029 gap).
3. Watch the open result. Repeat with test-fixtures/zero.pdf (0 bytes).

Expected: "The file could not be read as a PDF (...). It may be corrupt or truncated." and no tab.

Actual (fixed behavior, verified 2026-09-13): zero-page.pdf is rejected by openPdfDocument (src/renderer/pdf/pdfjs.ts: a resolved proxy with numPages===0 is destroyed and mapped to the shared 'corrupt' code) with the exact toast above; no .workspace mounts. The 0-byte file also errors (no tab). A good PDF still opens afterwards in the same session, and there are zero renderer pageerrors. The other ADV-029 fixtures (no-kids/circular-refs/infinite-loop-pagetree/malformed-xref) resolve to numPages=1 under pdf.js 4.10 (it recovers their trees) and broken-pagetree.pdf throws at parse — the zero-page fixture is the one that isolates the DEF-208 guard. Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 5; unit contract test/unit/renderer/bugDEF208_zeroPagePdf.test.ts (4 tests) green in the full unit run.

Screenshot: screenshots/def-208-retest.png (corrupt toast, welcome screen, no workspace)

History:
- qa: opened (accepted from ADV-029)
- qa: CLOSED (2026-09-13 retest on the fixed dev build; new fixture test-fixtures/zero-page.pdf added by qa for the numPages=0 path)

## DEF-207: Corrupted settings.json recovers silently — the user is never told their preferences were discarded

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-028)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Create a user-data dir whose settings.json is not valid JSON (e.g. '{"theme": "dark",,,, broken').
2. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp with that user-data dir).
3. Watch boot.

Expected: the app boots on defaults AND tells the user the settings file could not be read.

Actual (fixed behavior, verified 2026-09-13): the boot surfaces the error toast "Settings file could not be read — default settings were restored." (plus the console warning '[settings] settings.json could not be read; default settings were restored.') and the theme is the frosted default. Negative control in the same spec: a VALID settings.json ({"theme":"dark"}) boots with NO recovery toast and the dark theme is preserved — the toast fires only on real corruption/io failure, not on first boot (missing file) or valid content. Scope note, as designed and documented in src/renderer/state/settings.ts: this covers whole-file recovery; per-field normalization (one invalid value fixed inside normalizeSettings) remains silent because the wire contract carries no corrected-fields signal. Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 4; unit contract test/unit/renderer/settings.test.ts "DEF-207 — recovered boots surface user feedback" green in the full unit run.

Screenshot: screenshots/def-207-retest.png (recovery toast bottom-right, frosted defaults restored)

History:
- qa: opened (accepted from ADV-028)
- qa: CLOSED (2026-09-13 retest on the fixed dev build; corrupt + valid-file negative control both verified)

## DEF-206: Invalid annotation colors silently normalize to yellow — the caller's color choice is discarded without feedback

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-027)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp).
2. Load form.pdf through the engine IPC (window.tflex.engine.loadDocument).
3. Call window.tflex.engine.createAnnotation with color 'nonexistent!@#$%^&*()' and again with color null (otherwise-valid rect geometry).
4. Inspect the IPC results.

Expected: invalid colors must be rejected with a typed error, not silently defaulted to yellow.

Actual (fixed behavior, verified 2026-09-13): both calls return {ok:false, error:{code:'engine-error', message:'Invalid annotation color: nonexistent!@#$%^&*()'}} and 'Invalid annotation color: null' respectively (normalizeColorValue in src/main/services/annotations.ts throws; createAnnotation catches and maps to the typed engine-error). Control: the same call with a valid hex (#ff0000) still succeeds (ok=true), and engine getState afterwards contains exactly the 1 valid annotation — nothing leaked from the rejected calls. Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 3 (full results JSON logged); unit contract test/unit/main/annotations.test.ts ADV-024..027 describe block green in the full unit run.

Screenshot: screenshots/def-203-retest.png (app healthy after the invalid-call battery; API-level evidence is the results log)

History:
- qa: opened (accepted from ADV-027)
- qa: CLOSED (2026-09-13 retest on the fixed dev build)

## DEF-205: NaN / Infinity annotation coordinates are accepted without validation and can reach the PDF object stream

- Status: CLOSED
- Severity: LOW
- Found by: adversary (ADV-026)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp).
2. Load form.pdf through the engine IPC (window.tflex.engine.loadDocument).
3. Call window.tflex.engine.createAnnotation with rects [{x:NaN,y:NaN,width:NaN,height:NaN}], then [{x:Infinity,y:-Infinity,width:Infinity,height:Infinity}], then a zero-size rect [{x:10,y:10,width:0,height:0}].
4. Inspect the IPC results.

Expected: non-finite and degenerate coordinates must be rejected with a validation error before reaching pdf-lib serialization.

Actual (fixed behavior, verified 2026-09-13): NaN and Infinity rects return {ok:false, code:'engine-error', message:'Rect coordinates must be finite non-negative numbers'}; the zero-size rect returns 'Rect must have positive width and height' (a zero-size rect is the invisible-annotation-at-(0,0) class from ADV-025). isFiniteNonNegative + validateRect in src/main/services/annotations.ts gate every rect and point. Control: the valid annotation still creates (ok=true) and only it exists in engine state. Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 3; unit contract test/unit/main/annotations.test.ts (NaN/Infinity/negative/zero-size cases) green in the full unit run.

Screenshot: screenshots/def-203-retest.png

History:
- qa: opened (accepted from ADV-026)
- qa: CLOSED (2026-09-13 retest on the fixed dev build)

## DEF-204: Empty rects array silently creates an invisible zero-size annotation at (0,0)

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-025)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp).
2. Load form.pdf through the engine IPC (window.tflex.engine.loadDocument).
3. Call window.tflex.engine.createAnnotation with rects: [] and again with no geometry field at all (kind 'note', no at/rect/rects).
4. Inspect the IPC results and the engine state.

Expected: geometry-less annotations must be rejected with a typed error; nothing may be created.

Actual (fixed behavior, verified 2026-09-13): both calls return {ok:false, error:{code:'engine-error', message:'Annotation requires at least one rect'}} — the old zero-size [{x:0,y:0,width:0,height:0}] fallback is gone (normalizeAnnotationPayload's final else throws; src/main/services/annotations.ts). Engine state afterwards contains exactly the 1 control annotation from the valid call (stateAnnCount=1). Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 3; unit contract test/unit/main/annotations.test.ts (empty rects / missing geometry) green in the full unit run.

Screenshot: screenshots/def-203-retest.png

History:
- qa: opened (accepted from ADV-025)
- qa: CLOSED (2026-09-13 retest on the fixed dev build)

## DEF-203: createAnnotation with null rects/points throws an unhandled TypeError across IPC instead of returning a typed error

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-024)
- Phase: bug sweep 2026-09-12

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp) with the renderer pageerror stream observed.
2. Load form.pdf through the engine IPC (window.tflex.engine.loadDocument).
3. Call window.tflex.engine.createAnnotation with rects: null (highlight kind, valid page) and with from: null, to: null (arrow kind).
4. Inspect the IPC results and the renderer console.

Expected: a typed Result failure (engine-error), no thrown TypeError, no unhandled IPC rejection.

Actual (fixed behavior, verified 2026-09-13): null rects returns {ok:false, error:{code:'engine-error', message:'Annotation requires at least one rect'}} (the `!= null` + Array.isArray guard replaces the old `!== undefined && .length` crash); null arrow endpoints return 'Point must be { x, y }'. Both are typed Results — threw=false, code='engine-error', and no pageerror containing 'Cannot read properties of null' or any TypeError reached the renderer console. Control: a valid createAnnotation still succeeds (ok=true) and only that one annotation is in engine state. Evidence run: e2e/retests/def_201_209_retest.spec.cjs test 3 (all nine invalid+control results logged); unit contract test/unit/main/annotations.test.ts ADV-024 cases (null rects, non-array rects) green in the full unit run.

Screenshot: screenshots/def-203-retest.png

History:
- qa: opened (accepted from ADV-024)
- qa: CLOSED (2026-09-13 retest on the fixed dev build)

## DEF-202: Maximize caption does not flip to "Restore window" when a renderer settings write preceded the maximize — the window maximizes (and persists maximized=true) but the title bar keeps the stale caption

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: bug sweep 2026-09-12 (regression of a Phase-13 contract locked by e2e/retests/def180_maximize_glyph.spec.cjs; unrelated to DEF-180's font-weight subject despite the spec filename)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; dist built from the current tree, v1.13.0).
2. Perform any renderer settings write — e.g. open the theme dropdown (.theme-toggle) and pick Dark, wait ~500ms for the write + echo to settle.
3. Click the maximize window control ([data-window-maximize]).
4. Poll the button's aria-label/title for up to 6s.

Expected: the window maximizes, settings.json persists geometry.maximized=true, and the caption/glyph flips to "Restore window" (the boot-path behavior verified working: with NO prior settings write, maximize flips the caption immediately — the writeSeq=0 echo applied path).

Actual: the window DOES maximize (isMaximized=true) and settings.json DOES carry maximized=true, but the caption stays "Maximize window" — the renderer-side caption echo does not fire when a settings write preceded the maximize. Deterministic: failed in the full standard suite run AND in the isolated re-run (npx playwright test e2e/retests/def180_maximize_glyph.spec.cjs): `[A no-write] isMaximized=true label=Restore window` (path A green), `[B after-write] isMaximized=true caption=Maximize window settings.json geometry.maximized=true` (path B red, "caption must flip to Restore window after a prior settings write too"). Restore-then-poll in path A also works ("Maximize window" restored). Only the after-write maximize caption is stale.

Suspected mechanism (for the developer): the settings echo round-trip (App.tsx settings.changed handler) re-applies window state from the echo and clobbers/stales the renderer's maximized flag on the path where a settings write just landed; the live 'maximize' window event may be overwritten by the echo's stale geometry. The glyph check in path A (restore glyph distinct from minimize) passed, so the defect is specific to the post-write echo path.

Fix direction: ensure the renderer's maximized state is driven by the window-state IPC events (maximize/unmaximize), not by settings-echo geometry, or dedupe the echo when the state already matches (same class as DEF-199's echo dedupe).

Screenshot: none (caption is text evidence; the keeper's poll output above is the record).

History:
- qa: opened (found during the 2026-09-12 comprehensive bug sweep; keeper e2e/retests/def180_maximize_glyph.spec.cjs failing on dev build 1.13.0 from the current tree; reproduced twice, deterministic)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, dist rebuilt 00:24 from the current tree). Both proofs green: (1) the keeper e2e/retests/def180_maximize_glyph.spec.cjs now passes BOTH paths — [A no-write] isMaximized=true label=Restore window (restore glyph distinct, restore-back label=Maximize window) and [B after-write] isMaximized=true caption=Restore window settings.json geometry.maximized=true — the caption flips after a prior settings write too; (2) new spec e2e/retests/def_201_209_retest.spec.cjs test 2 (theme flip dark -> maximize): caption polled to "Restore window", BrowserWindow.isMaximized()=true, settings.json geometry.maximized=true, restore click flips back to "Maximize window". Visual: screenshots/def-202-retest.png (maximized, dark theme, restore glyph in the title bar). Unit contract bugDEF202_maximizeCaptionEcho.test.ts 12/12 green in the full unit run.

## DEF-201: Preferences sheet ignores Escape — the modal backdrop stays up and blocks every control until the X button is used

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: bug sweep 2026-09-12 (found during the pre-feature comprehensive sweep)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; frosted default theme).
2. Open any PDF sample (report.pdf) or stay on the Welcome screen.
3. Click the settings gear (`.header-gear` / `[data-open-preferences]`) in the title bar.
4. Press Escape.

Expected: the Preferences sheet closes on Escape, exactly like every other modal in the app (Insert pages, Stamp, Optimize, Audit, Merge, Extract, Split, Signature manager, Save-As all dismiss on Escape — DEF-171 already established Escape as the contract for floating surfaces after the DEF-171 signature-manager fix).

Actual: nothing happens. PreferencesDialog.tsx (204 lines) registers no keydown handler — the sheet closes ONLY via the X button (`aria-label="Close preferences"`) or a click on the backdrop itself. The full-screen `.sheet-backdrop` (position:fixed inset:0, z-index:100, aria-modal) stays up and intercepts every pointer event, so the Tools button, command bar and page are all unclickable until the user finds the X. Verified live during the sweep: `[SW2][DEF-201] prefs closes on Escape=false`, then the X button closes it (`prefs closes via X button=true`); the sweep's first run died on exactly this (the .sheet-backdrop intercepted the following [data-tools-toggle] click for 30s).

Note: AboutDialog and UpdatePromptDialog were not probed for Escape in this sweep and may share the gap; PreferencesDialog is the confirmed instance.

Fix direction: add a keydown Escape -> onClose effect to PreferencesDialog (same pattern the other sheets use).

Screenshot: screenshots/bug-sweep-2026-09-12/13-preferences-dialog.png (sheet open and modal over the workspace)

History:
- qa: opened (found during the 2026-09-12 comprehensive bug sweep; evidence run e2e/bug_sweep_full.spec.cjs SWEEP-2)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, e2e/retests/def_201_209_retest.spec.cjs test 1, passed). report.pdf workspace -> [data-open-preferences] -> sheet open (screenshots/def-201-prefs-open.png) -> Escape: [data-prefs-dialog] removed within the 3s assert window ("prefs closed on Escape=true"), and the backdrop no longer blocks the UI — the immediate next click on the command bar's Tools toggle opened the palette ("workspace interactive after Escape=true", screenshots/def-201-retest.png). Zero renderer pageerrors beyond the separately-tracked DEF-199 console noise. X-button close path unchanged (PreferencesDialog unit contract green in the full unit run).

## DEF-200: A pressed .btn stays at the hover lift — .btn:hover:not([disabled]) (0,3,0) outranks the .btn:active press rule (0,2,0) while the pointer is down, so the press transform never applies to the .btn family

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (found during the DEF-196/197 retest, 2026-09-13)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open form.pdf, click the "Flatten form fields" tool button.
2. In the Flatten dialog, hover the Cancel (.btn) button and hold the mouse down ~200ms.
3. Read getComputedStyle(button).transform while held (e2e/retests/def_195_196_197_retest.spec.cjs logs it as "[197] .btn pressed (hover-mask probe, DEF-200)").

Expected: the shared press group (styles.css ~8082) — translateY(1px) scale(var(--motion-scale-press)) while pressed — the button settles down+in like every tool-btn does (measured 0.97 + ty 1).

Actual: computed transform stays matrix(1, 0, 0, 1, 0, -1) — the hover lift. Root cause: .btn:active (styles.css ~1680) and the press group's .btn:active (~8082) are specificity (0,2,0), while .btn:hover:not([disabled]) (~8043) is (0,3,0); while the pointer is down BOTH :hover and :active match, the hover rule outranks, and the press transform never applies. The pressed-wash background still applies (feedback is visible) and both press rules DO read the token — only the transform is masked. Measured unaffected families on the same build: .tool-btn (0.97 + ty 1 @70ms) and .tab-new (0.97 + ty 1) — their :active selectors carry :not(...) guards, so the masking class is narrower than the whole press group; every press-group member whose :active selector lacks a :not() guard while its :hover has one is suspect (.tab-close, .sample-card, .modal-close, .toast-close, ... — only .btn measured here).

Note: DEF-196's own subject (the tool-btn press token) is verified fixed; this is the residual cascade gap the retest surfaced while regression-testing around that fix. Fix direction: give .btn:active the same :not([disabled]) guard as its :hover (both then (0,3,0), press later in source wins) or drop the redundant standalone rule at ~1680.

Screenshot: none needed (computed-value evidence in the spec log; the pressed dialog is visible in screenshots/def-197-retest.png).

History:
- qa: opened (found during the DEF-196 retest regression sweep, 2026-09-13)
- qa: re-verified OPEN (bug sweep 2026-09-12, dev build 1.13.0 from the current tree): e2e/bug_sweep_full.spec.cjs SWEEP-8 re-measured the flatten-dialog Cancel press — computed transform matrix(1, 0, 0, 1, 0, -1) (scale 1.0, hover lift, no press compression) while the pointer is held; the tool-btn control on the same build measures 0.97 + ty 1, so the .btn masking gap persists. Cascade confirmed in the built CSS: .btn:hover:not([disabled]) (0,3,0) at a later source position than both .btn:active rules (0,2,0).
- frontend-dev: FIX-READY (2026-09-14; shared press-group `.btn:active` changed to `.btn:active:not([disabled])` at line 8088, specificity now (0,3,0) matching hover rule; press group is later in source so it wins. Verified live: held Cancel button measures `matrix(0.97, 0, 0, 0.97, 0, 1)` — scale 0.97 + translateY 1px. Build pass, verify pass, 3089/3089 unit tests pass. Screenshot: screenshots/def-200-verify.png)
- qa: CLOSED (2026-09-13 retest on the rebuilt dev build, e2e/retests/def_200_retest.spec.cjs, passed). CSSOM guard on the loaded stylesheet: the guarded `.btn:active:not([disabled])` press rule is present, no unguarded `.btn:active` rule remains, and `--motion-scale-press` resolves to 0.97 on :root. Live real-pointer hold on the flatten dialog's Cancel (.btn): hover = matrix(1, 0, 0, 1, 0, -1) (the lift), pressed = matrix(0.97, 0, 0, 0.97, 0, 1) — scale 0.97 (--motion-scale-press) + the 1px press settle, exactly the expected value (pre-fix: matrix(1, 0, 0, 1, 0, -1), hover lift only). Regression control on the same build: the command-bar .tool-btn press (DEF-196 subject) still measures matrix(0.97, 0, 0, 0.97, 0, 1). Screenshot: screenshots/def-200-retest.png (pressed Cancel with the pressed wash, dialog open over form.pdf).

## DEF-199: Every theme application echo starts a second View Transition that skips the first — unhandled "Transition was skipped" rejection in the renderer console at boot and on every theme flip

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (found during the DEF-195 retest)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs) with the console/pageerror stream observed.
2. Optionally wrap document.startViewTransition to count calls (e2e/retests/def_195_196_197_retest.spec.cjs does).
3. Boot the app (no interaction) and/or open the theme popover and click a theme option.

Expected: one View Transition per theme application, no renderer errors.

Actual: document.startViewTransition is invoked TWICE per user theme flip (measured calls: 2 every flip) and once more at boot — the UI flip writes settings, the settings-echo handler (App.tsx settings.changed -> setTheme) re-applies the same theme through useThemeTransition, and the second startViewTransition SKIPS the first (Chromium skips an older transition when a new one begins). The skip rejects the first transition's finished promise, which the app never holds, so Chromium surfaces an unhandled rejection as a pageerror: "Transition was skipped" — present at every boot in every one of the 4 retest tests and after every theme flip. No visual impact: the second transition renders the full 400ms crossfade (measured 452ms, blend visible in screenshots/def-195-retest.png) and CLS stays 0; the only cost is console noise on every flip plus a cut of the first transition's partial blend at the echo instant if a flip is ever re-triggered mid-crossfade.

Fix direction: deduplicate the apply (skip the echo when the theme already matches, e.g. an identity check in setTheme or in the settings.changed handler) and/or hold/ignore the VT promise so a skip is handled, not an unhandled rejection.

Screenshot: none (console-level; the visible crossfade is unaffected).

History:
- qa: opened (found during the DEF-195 retest, 2026-09-13; reproduced in every launch of e2e/retests/def_195_196_197_retest.spec.cjs)
- qa: re-verified OPEN (bug sweep 2026-09-12, dev build 1.13.0 from the current tree): e2e/bug_sweep_full.spec.cjs SWEEP-10 counted document.startViewTransition calls per user theme flip = 2 (echo defect still live) with 1 "Transition was skipped" pageerror in the same flip; SWEEP-8 measured the visible crossfade healthy at 61fps so the visual impact remains zero — console noise only.
- frontend-dev: FIX-READY (2026-09-14; fix already present in working tree — `useAnimations.ts:useThemeTransition` has two-guard identity dedupe `lastAppliedRef` + `data-theme` attribute check at lines 441-448, and the VT promise is caught with `.finished.catch` at lines 478-481. `App.tsx` `settings.changed` handler also gates with `document.documentElement.getAttribute("data-theme") !== s.theme` at lines 742-744. Build pass, verify pass, 3089/3089 unit tests pass. Awaiting qa retest.)
- qa: CLOSED (2026-09-14 retest on dev build 1.13.1 from current tree): `e2e/retests/def_195_196_197_retest.spec.cjs` all 4 tests pass — startViewTransition calls = 1 per theme flip (was 2), renderer errors (all) = `[]` for every test including boot and multiple flips, zero "Transition was skipped" pageerrors. DEF-199 filter in the spec now sees empty arrays before and after filtering. Unit suite 3090/3090 pass.)

## DEF-195: Theme crossfade drops to ~30fps during the 400ms flip (idle baseline 59-60fps in the same session) — "60fps maintained" fails

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf (frosted theme, page 1 rendered).
2. Run `npx playwright test e2e/anim_audit.spec.cjs -g "A1"` — it measures a quiet idle fps baseline, then flips theme frosted -> dark while sampling rAF.
3. Read the logged numbers: quiet baseline fps vs crossfade fps (fps-only rAF loop, no getComputedStyle probing).

Expected: The 400ms theme crossfade runs at ~60fps (REQUIREMENTS: "no frame drops during animations; 60fps maintained"; audit checklist: "60fps maintained").

Actual: idle workspace measures 59-60fps (avg frame gap 16.7ms, max 17ms); during the crossfade the same rAF loop drops to 28-30fps with worst frame gaps of 88-105ms. Reproduced 4 consecutive runs (fps 28, 30, 30, 28), both directions (frosted->dark and dark->frosted), with a fps-only sampler (no instrumentation bias — the quiet baseline in the same session hits 60). Secondary symptom: the transitioning class is removed 545-572ms after the flip instead of the expected 450ms (400ms token + 50ms grace) because the removal callback is delayed by the same jank.

Root cause direction: src/renderer/styles/animations.css lines 260-274 — `html.tf-theme-transitioning body *:not(.pdf-page)...` puts NINE transition properties (!important) on EVERY element in the tree for the whole crossfade window; the workspace recalc/repaints the entire chrome (frosted backdrop-filter surfaces re-rasterize during the blend). The PDF canvas is correctly excluded (measured constant across all frames, CLS=0).

Screenshot: screenshots/anim-theme-crossfade.png (mid-crossfade frame)
Evidence run: e2e/anim_audit.spec.cjs A1 (fps logs: quiet {fps:59-60, avgDelta:16.7, maxDelta:17} vs crossfade {fps:28-30, avgDelta:33, maxDelta:88-105})

History:
- qa: opened (Phase-15 animation-system audit, 2026-09-13; 4 consecutive reproductions)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, e2e/retests/def_195_196_197_retest.spec.cjs, 4/4 passed). The crossfade now runs through the View Transitions API: a wrapper around document.startViewTransition proves the API path is invoked on every runtime flip, the fallback class NEVER appears while the API is available, VT duration 452ms (token 400), PDF page/canvas computed styles constant across every sampled frame, CLS 0. Unconfounded crossfade fps (fps-only rAF, same shape as the filing): 59-60fps, avg frame gap 16.7ms, worst 25-26ms — was 28-30fps / avg 33ms / worst 88-105ms; the quiet idle baseline in the same session is 59-60fps (identical to the crossfade now). Frame-time graph: screenshots/perf-60fps.png (54 frames, every bar under the 33ms jank line, budget line 16.7ms). Visible crossfade blend captured mid-flight in screenshots/def-195-retest.png (titlebar/rail mid-blend frosted->dark, popover still frosted, PDF page white/pinned). Fallback path (API shadowed for the probe): class applied and removed within 520ms, computed transition-property on <body> while the class is on = exactly background-color, color, border-color, box-shadow, fill, stroke at 0.4s each (screenshots/def-195-retest-fallback.png). Honest note: the class-based fallback still measures ~29-30fps (avg 33.7ms, max 92ms) on this machine if ever reached — Electron never reaches it (startViewTransition is always available); logged, not a reopen. New LOW finding from this retest filed separately as DEF-199 (echo double-apply skips the first VT; console-only, no visual impact).

## DEF-196: The canonical press token never applies to the tool buttons — animations.css `.tool-btn:active` press rule is dead in the cascade (measured press stays legacy translateY(1px) scale(0.982) @70ms)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf.
2. Hold the mouse down on any enabled command-bar `.tool-btn` for 200ms and read `getComputedStyle(el).transform`.
3. Compare against `--motion-scale-press` (0.97) which animations.css claims owns the press scale.

Expected: src/renderer/styles/animations.css line 234 — `.tool-btn:active:not([disabled]) { transform: scale(var(--motion-scale-press)) }` — "the press value can never drift from the motion system" (comment in the same file). Press = scale(0.97).

Actual: computed transform is `matrix(0.982, 0, 0, 0.982, 0, 1)` — the legacy press-settle group in styles.css (`.btn:active, .tool-btn:active:not([disabled]), ... { transform: translateY(1px) scale(0.982); }`, ~line 8071-8098) wins the cascade: same specificity (0,3,0), later in source order (animations.css is imported first). The animations.css rule never applies to any tool button. Meanwhile `.btn:active` (styles.css line ~1678, updated in this changeset) DOES read the token (0.97) — so the app ships TWO press languages: 0.97 for `.btn`, 0.982 + translateY(1px) @70ms for the tool-btn/tab/close family.

Note: the press still FEELS fine (0.982@70ms is the tuned Phase-4 band) — the defect is the dead token rule and the false comment in animations.css, i.e. the cross-theme system does not actually own the value it claims to own.

Evidence run: e2e/anim_audit.spec.cjs A4 ("tool-btn pressed: matrix(0.982, 0, 0, 0.982, 0, 1) => scale 0.982 ty 1 (token=0.97; legacy group=0.982+ty1)")

History:
- qa: opened (Phase-15 animation-system audit, 2026-09-13)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, e2e/retests/def_195_196_197_retest.spec.cjs, 4/4 passed). Live press on the command-bar .tool-btn measured with a real pointer hold: hover translateY(-1px), pressed matrix(0.97, 0, 0, 0.97, 0, 1) — scale = --motion-scale-press (0.97) + the 1px settle — over a 70ms transform transition (the instant band), release eases back to the hover lift; a second tool button presses at 0.97 too. The element resolves --motion-scale-press to .97. CSSOM sweep over every loaded rule: ZERO 0.982 declarations remain; all three press rules now read var(--motion-scale-press) — animations.css .tool-btn:active:not([disabled]) { scale(var(--motion-scale-press)) }, the standalone .btn:active, and the shared press group (translateY(1px) scale(var(--motion-scale-press))). Screenshot: screenshots/def-196-retest.png (pressed state with the pressed wash). One press language now, at the token. Residual finding from the regression sweep filed separately as DEF-200: the .btn family's press TRANSFORM is still masked while pressed by its own (0,3,0) :hover rule (the token VALUE is wired everywhere; the .btn cascade masking is a distinct, narrower defect).

## DEF-197: The cross-theme animation system's canonical layer is largely unwired — the named animations ship with hardcoded spring values from a parallel preset system instead

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15

What exists vs what the audit checklist names:
1. animations.css defines the full `.anim-*` utility set (bloom/pop/drop/slide/tab/materialize/lift/press) — NONE of these classes is used by any component (grep: only animations.css itself references them). Dead code.
2. AnimatedDialog.tsx and AnimatedPanel.tsx (the useBloomAnimation/useSlideAnimation wrappers) are defined but imported by NO component. Only AnimatedTab is wired (AppHeader strip) and the theme popover uses usePopAnimation — those two DO work (measured live).
3. The surfaces the checklist names actually animate through src/renderer/components/motion/tfPresets.ts, which hardcodes ~14 literal motion constants (scale 0.96/0.97/0.95, y ±4/-3/8/-2/-6, x 24/-18, spring stiffness 420/560/1000, damping 34/38/50) that read NEITHER the CSS tokens nor motionTokens.ts.
4. Because of that, the checklist's timings do not match the shipped app (all measured live in e2e/anim_audit.spec.cjs):
   - "Dialog Open: Bloom In (scale 0.95 -> 1, 200ms)" -> actual TfDialog spring: y 10 -> 0, scale 0.97 -> 1, settles ~240ms.
   - "Popover Open: Pop In (scale 0.95 -> 1, 180ms)" -> theme popover plays the real Pop In (0.95 -> 1 over ~240ms tween), but titlebar menu + color popover run TfMenu/TfPopover (scale 0.96/0.97, y -4/-3, spring ~180ms band) — popovers of the SAME category animate by two different systems.
   - "Dropdown: Drop Reveal (translateY -8px -> 0, 180ms)" -> actual drop travel is -4px (TfMenu) — no -8px anywhere.
   - "Sidebar Open: Slide In (280ms)" -> actual TfPanel spring x 24 -> 0 settling ~340ms; "Slide Out (220ms)" -> actual exit x -> 18 spring; no 220ms token exists (the only literal 220ms in the codebase is an unrelated spring-hover box-shadow/transform rule, styles.css ~line 8935).
   - "Button Press: scale 0.97, 100ms" -> measured 0.982 + translateY(1px) @70ms (see DEF-196).
   - "Button Hover: Luminous 150ms" -> measured translateY(-1px) @ --tf-motion-fast 120ms.
   - "Toggle On: Selection Fill (150ms)" -> measured 180ms (--tf-motion-normal).
   - "Thumbnail Select: Selection Bloom (150ms)" -> measured thumb-select @ 180ms.
   - "Tab Switch: Crossfade (200ms)" -> .tab transitions background/color/box-shadow @ 180ms (legacy alias --motion-normal).
   - Tooltip Micro Fade Lift 120ms — MATCHES (legacy token).

What DOES hold: cross-THEME consistency is real (all motion values are :root-level; zero redeclarations inside [data-theme] blocks — measured live; the only per-theme motion value is the sanctioned --motion-elevation-color shadow-strength channel). The app is not janky from this — it is a wiring/contract gap, not a broken animation.

Expected: the audit checklist's named animations and the animations.css header contract ("every NEW surface ... consumes ONLY this --motion-* system") match the shipped behavior.

Actual: the canonical token layer is consumed by exactly three things (theme crossfade, `.btn:active` press scale, AnimatedTab/theme popover variants); everything else rides the hardcoded TfMotion presets, and the checklist numbers match neither system.

Evidence run: e2e/anim_audit.spec.cjs A1-A4 measured values (quoted above); unit test test/unit/renderer/animationsTokens.test.ts pins tokens<->motionTokens.ts but nothing pins the PRESETS to tokens.

History:
- qa: opened (Phase-15 animation-system audit, 2026-09-13)
- qa: CLOSED (2026-09-13 retest on the fixed dev build, e2e/retests/def_195_196_197_retest.spec.cjs, 4/4 passed). The canonical layer is measured live in production: (1) AnimatedPanel IS the docked pages rail — data-animated-panel="side-rail" mounts and settles to transform none / opacity 1; (2) AnimatedDialog IS the flatten-forms confirm — data-animated-dialog="flatten-confirm" (FlattenConfirmDialog.tsx): bloom starts at scale 0.95 = MOTION_SCALE.enter (the old preset hardcoded 0.97), settles ~250ms, exit sampled mid-flight at scale 0.9756 travelling toward the 0.98 MOTION_SCALE.exit token (old hardcoded 0.985), backdrop opacity-only 0 -> 1; (3) TfMenu initial scale 0.95 + y -4 (was the hardcoded 0.96); (4) TfPanel slide x 20.2 -> 0 (MOTION_TRANSLATE.panel 24px travel) with width/height constant 344x752 through the whole tween and zero CSS keyframes; (5) token values resolve live: press .97 / enter .95 / exit .98 / translate-panel 24px / crossfade .4s, zero redeclarations inside any [data-theme] block; (6) the .anim-* utilities resolve (tf-anim-pop-in @ 0.2s computed on a probe element); (7) tfPresets.ts reads every scale/travel from motionTokens.ts (source inspected; pinned by the new unit contract test/unit/renderer/def197_canonicalLayerWired.test.tsx). Visual: screenshots/def-197-retest.png (AnimatedDialog open + AnimatedPanel rail in the same frame). Remaining notes, not blockers: the .anim-* utility set still has NO production consumer (dormant-but-working utility layer); the audit checklist's sketch numbers disagree with the token table the same phase established (dialog bloom 200ms vs --motion-duration-standard 250ms; dropdown travel -8px vs --motion-translate-small 4px) — the shipped app follows the token table, which is the canonical contract this defect pointed at.

## DEF-198: Mid-session prefers-reduced-motion changes are not picked up by the JS motion layer — springs keep running until app restart

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs) with the OS reduced-motion setting OFF, open report.pdf.
2. Emulate/enable prefers-reduced-motion WHILE the app is running (test: `win.emulateMedia({ reducedMotion: 'reduce' })`; e2e/anim_audit.spec.cjs A5).
3. Verify the CSS side collapsed (measured: --motion-duration-* resolve 0s; styles.css catch-all collapses transitions to 0.01ms — works).
4. Click the theme toggle and sample `.theme-toggle-popover` with rAF.

Expected: the popover's Pop In collapses (no scale travel, instant state change) — the useAnimations.ts contract says "Every hook degrades under prefers-reduced-motion".

Actual: the popover still springs scale 0.95 -> 1 over ~240ms under active reduced motion. Root cause: motion/react 13.2.0's `useReducedMotion` does `useState(prefersReducedMotion.current)` — the value is captured ONCE at first call and the module-level matchMedia listener updates only the ref, never React state, so every hook in the app keeps its boot-time value until remount. The CSS token collapse (the other half of the system) DOES react live, so the theme crossfade is visually instant; the JS-driven springs (popover, dialog, palette, tabs) are not.

Scope: boot-time reduced motion (the normal user scenario — the OS setting predates the session) is handled correctly and is locked by test/unit/renderer/useAnimations.test.tsx. The gap is only a MID-SESSION toggle of the OS setting. Fix direction: subscribe to the media query in-app (a tiny effect flipping a context/state) instead of relying on useReducedMotion's reactivity.

Evidence run: e2e/anim_audit.spec.cjs A5 (popover samples: full 0.95 -> 1 scale travel over ~240ms while matchMedia('(prefers-reduced-motion: reduce)').matches === true)

History:
- qa: opened (Phase-15 animation-system audit, 2026-09-13)
- qa: re-verified OPEN (bug sweep 2026-09-12, dev build 1.13.0 from the current tree): e2e/bug_sweep_full.spec.cjs SWEEP-10 emulated prefers-reduced-motion: reduce MID-SESSION and sampled the theme popover — CSS tokens collapse correctly (--motion-duration-standard 0s, crossfade 0s) but the popover still travels scale 0.05 (~0.95 -> 1) over ~240ms, i.e. the JS spring keeps running until restart, exactly as filed.
- frontend-dev: FIX-READY (2026-09-14; fix already present in working tree — `useAnimations.ts` implements `useLiveReducedMotion()` with a live `matchMedia("(prefers-reduced-motion: reduce)")` subscription that flips React state on every OS `change` event (lines 101-118). Every animation hook in the file (usePopMotion, useSlideMotion, useBloomMotion, etc.) consumes `useLiveReducedMotion()` instead of motion/react's stale `useReducedMotion`. Build pass, verify pass, 3089/3089 unit tests pass. Existing unit test `test/unit/renderer/useAnimations.test.tsx` verifies boot-time reduced-motion; awaiting qa retest for mid-session flip.)
- qa: CLOSED (2026-09-14 retest on dev build 1.13.1 from current tree): `e2e/anim_audit.spec.cjs` A5 passes — after emulating `prefers-reduced-motion: reduce` mid-session, popover enter frames show `transform: none` on every sampled frame (no scale travel), instant `opacity: 0 → 1` collapse (was ~0.95→1 scale spring over ~240ms). CSS tokens also collapse to `0s`. Empty tab close works under mid-session reduce. Unit suite 3090/3090 pass.)

## DEF-191: Phase-14.2 Fix 3 does not hold in the frosted theme — the Open button's ghost capsule still paints (translucent film + hairline + shadow extend ~17px past the blue button)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14.2

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs; default frosted theme), open report.pdf.
2. Look at the command bar's leading blue "Open" button.
3. Measure the File group capsule vs the button: `getComputedStyle` on `.toolbar-group.commandbar-group-open` and its box vs `.commandbar-open`.

Expected: Phase 14.2 Fix 3 — "clean single-layer button; blue accent only, no ghost element". The 14.2 override (src/renderer/styles.css line ~1717: `.toolbar-group.commandbar-group-open { background: transparent; border-color: transparent; box-shadow: none; }`) should make the capsule paint nothing so the blue button is the only visible layer.

Actual: the capsule still paints a full ghost layer: background `rgba(255, 255, 255, 0.55)`, border `rgba(255, 255, 255, 0.25)`, and the box-shadow `rgba(255,255,255,0.55) 0 1px 0 inset, rgba(0,0,0,0.08) 0 1px 2px` — and the capsule is 101.55px wide while the button is 84.22px (btnH = groupH = 36), so the translucent film rim + luminous top edge + drop shadow are visibly painted around the blue button (screenshot). Root cause: specificity — the fix rule is (0,2,0) while the frosted film `:root[data-theme="frosted"] .glass-control-group` (styles.css ~line 9106) is (0,3,0), so the fix loses ONLY in frosted; light/dark measure clean (the same override beats their (0,1,0) base rule).

Screenshot: screenshots/fix3-open-button.png (frosted; the translucent rim around the blue button)

Evidence run: e2e/phase14_2_verify.spec.cjs "fix3: Open button is a clean single layer (frosted)" — measured values in the run log (5 consecutive runs, stable).

History:
- qa: opened (Phase 14.2 verification, 2026-09-13; reproduced identically across 5 runs on dist rebuilt from the current tree)
- qa: CLOSED (2026-09-13 retest on the dev build; dist 17:43 carries the fix — `:root[data-theme=frosted] .toolbar-group.commandbar-group-open{background:0 0;border-color:#0000;box-shadow:none}`). Measured (e2e/retests/def_191_194_retest.spec.cjs, DEF-191 test, passed): File capsule background rgba(0,0,0,0) alpha 0, border rgba(0,0,0,0), box-shadow none, and both ::before/::after paint nothing; the button keeps rgb(37,99,235) + white. Hover re-measured after a real hover: the capsule STILL paints nothing (the 0-4-0 film hover variant stays overridden by the 0-5-0 clean rule) — the lighter rgb(59,130,246) on hover is the button's own hover wash, not a ghost layer. The group box keeps 101.55px vs the button's 84.22px, but that ~17.3px is layout padding that paints NOTHING (the filing's mismatch only mattered because the film painted there) — the visible rim/hairline/shadow are gone. Visual: screenshots/def-191-retest.png (rest) + def-191-retest-hover.png — clean solid blue capsule, no film. The clean-button contract also hold-checks in dark and light inside the DEF-192 test.

## DEF-192: Phase-14.2 Fix 4 is dead in EVERY theme — the page view never adjusts when the Tools panel opens (margin stays 0; the panel mounts OVER the document, occluding ~306px of the page)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14.2

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf (any theme — frosted default, dark, and light all reproduce).
2. Click the "All tools" grid button in the command bar.
3. Measure: `.document-scroller` computed margin-right, `.workspace-main` computed `--tf-tools-inset`, and the rects of `[data-tools-palette]` vs `.pdf-page[data-page="1"]`.

Expected: Phase 14.2 Fix 4 — in ALL themes the open Tools panel pushes the page view: scroller margin-right = panel width + 12px gap (356px), scroller width shrinks, the canvas ends BESIDE the panel.

Actual: with `data-tools-open="true"` on `.app-main`, the scroller's margin-right stays `0px`, `--tf-tools-inset` reads `0px` on `.workspace-main`, and the palette mounts flush over the page: dark/light palette left 1096 vs page right 1402 (306px of page occluded — the subtitle text is cut off under the panel's left edge, screenshots); frosted palette left 1080 vs page right 1386 (same 306px). The page does not move at all.

Root cause (CSS): `.workspace-main` re-declares `--tf-tools-inset: 0px` on itself (src/renderer/styles.css ~line 1999) while the open-state value is declared on the ANCESTOR (`.app-main[data-tools-open="true"] { --tf-tools-inset: calc(344px + 12px); }`, ~line 2013). A self-declaration always beats the inherited value, so the registered-property transition on `.workspace-main` never sees a change and the consumed `margin-right: var(--tf-tools-inset)` on `.document-scroller` is permanently 0. Fix direction: remove the `--tf-tools-inset: 0px` self-declaration from `.workspace-main` (the @property's `initial-value: 0px` already provides it) so the `.app-main[data-tools-open]` value inherits down and the transition animates it.

Note: this also undoes the Phase-14.1 frosted behavior where the canvas ended beside the Tools card (DEF-183's fix) — the white page now extends under the glass card again in frosted.

Screenshot: screenshots/fix4-dynamic-dark.png, screenshots/fix4-dynamic-light.png, screenshots/fix4-dynamic-frosted.png (panel over page in all three; compare with the -closed.png variants)

Evidence run: e2e/phase14_2_verify.spec.cjs (frosted battery + dark + light tests; measured snapshots in the run logs, 5 consecutive runs)

History:
- qa: opened (Phase 14.2 verification, 2026-09-13)
- qa: CLOSED (2026-09-13 retest, e2e/retests/def_191_194_retest.spec.cjs DEF-192 test, passed). Closed -> open -> re-closed measured in ALL THREE themes: dark margin-right 0 -> 356px (.workspace-main insetVar 356px, scroller 1220 -> 864 wide), page right edge 1402 -> 1046 and the page reflowed 1154 -> 798px wide (fit-width re-zoom 181% -> 130%); palette left 1096 vs page right 1046 — 50px clear, NO occlusion; re-closed restores 0px and the full-width page. Light: identical numbers (palette 1096 vs page 1046). Frosted: margin 0 -> 356, scroller 1176 -> 820, page right 1386 -> 1030, palette left 1080 vs page right 1030 — 50px clear; re-closed restores 0px/1110px. The dead token is gone: `.workspace-main` no longer self-declares `--tf-tools-inset`, the `.app-main[data-tools-open]` driver (calc(344px + 12px) = 356px) inherits down, and the page lands beside the panel instead of under it. Visual: screenshots/def-192-retest.png (dark), -light.png, -frosted.png (page beside the panel in all three), plus the -closed baselines for each theme.

## DEF-193: Phase-14.2 Fix 5 animates only the PANEL — the page never participates, so panel and page do not animate together (rAF sampler: margin constant 0px across 46 frames while the palette tweens 300ms)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14.2

Steps to reproduce:
1. Launch TFlex (dev build), open report.pdf (frosted or dark).
2. Start a requestAnimationFrame sampler recording `getComputedStyle(.document-scroller).marginRight`, the palette's computed opacity/transform, and frame timestamps (e2e/phase14_2_verify.spec.cjs FIX 5 test does exactly this).
3. Click the "All tools" button; sample for ~750ms.

Expected: Fix 5 — the panel AND the page view animate TOGETHER on the same 300ms ease-out (the `.workspace-main` transition `--tf-tools-inset 0.3s cubic-bezier(0.16, 1, 0.3, 1)` drives the scroller's margin while TfPanel tweens the palette).

Actual: the transition declaration IS present and correct (computed transition string `--tf-tools-inset 0.3s cubic-bezier(0.16, 1, 0.3, 1)`), and the palette's own enter motion is healthy: opacity 0 -> 1 and translateX 24px -> 0 over ~300ms ease-out. But the page's margin-right stays 0.000px through every one of the 46 rAF samples (t=8ms..759ms) — the page never moves, so there is no simultaneous panel+page motion and no 300ms page slide to measure. Same dead token as DEF-192 (`.workspace-main` self-declares `--tf-tools-inset: 0px`, so the transitioned property never changes value). The close direction is identical (palette tweens out, page static).

Screenshot: screenshots/fix5-anim-frame-00..06.png (frame sequence: the palette slides/fades in over a static page)

Evidence run: e2e/phase14_2_verify.spec.cjs fix5 test (rAF sampler logs; reproducible across runs)

History:
- qa: opened (Phase 14.2 verification, 2026-09-13; same root cause as DEF-192 — fixing the token restore should fix both)
- qa: CLOSED (2026-09-13 retest, rAF sampler with the same shape as the filing spec, e2e/retests/def_191_194_retest.spec.cjs DEF-193 test, passed). Declared transition confirmed: `--tf-tools-inset 0.3s cubic-bezier(0.16, 1, 0.3, 1)` on `.workspace-main` (--panel-slide-duration .3s). OPEN-frosted: margin 0 -> 356px with 11 distinct intermediate values, strictly monotonic (no jumps), movement 74ms -> 232ms; the palette enters on the same curve (first mounted sample t=51ms opacity 0 translateX 24px); 7 rAF samples show panel AND page mid-flight in the SAME frame window; settle order palette 232ms / margin 232ms — the same frame, not sequential. CLOSE-frosted: margin 356 -> 0, movement 67 -> 218ms, 9 together-samples. OPEN-dark: 0 -> 356, movement 69 -> 220ms, 11 values, 7 together-samples, settle palette 238ms / margin 220ms. Visual: screenshots/def-193-retest-frame-00..06.png — frame 0 catches mid-flight (page still at 181% fit-width with the panel translucent and offset; page right edge and panel both in motion), frames 1-6 settled at the reflowed 123% layout beside the opaque panel; composite strip screenshots/def-193-retest-frames.png. Note for the record: a full-window Playwright capture takes ~200-240ms, so only frame 0 lands inside the 300ms tween — the rAF curve (overlapping motion windows, monotonic, settle-together) is the quantitative proof.

## DEF-194: Phase-14.2 Fix 6 — command-bar icons still render ~14.7px, not 22px (the svg flex-item shrinks to the button's content box because `.tool-btn` never resets the UA button padding)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14.2

Steps to reproduce:
1. Launch TFlex (dev build), open report.pdf (any theme).
2. Measure every `.toolbar .tool-btn > svg`: computed width/height and getBoundingClientRect.
3. Compare with `.ann-toolbar .ann-tool-btn > svg` and `.side-rail` button svgs.

Expected: Fix 6 — command bar icons render at 22px (spec: 20px minimum), matching the 24px annotation-toolbar and 22px sidebar glyphs.

Actual: ALL 20 command-bar tool svgs carry width="22" height="22" attributes but LAY OUT at 14.6667 x 22 CSS px (computed style and rect agree; the 24/24 viewBox glyph is letterboxed down to a ~14.7px drawing — visibly smaller than the annotation bar's true 24px glyphs, screenshots). The 22px attribute and even an inline `style.width = '22px'` are ignored; the value is pinned by layout. Isolation probes (e2e/retests/diag_cmd_icon_width*.spec.cjs, 7 probes):
- a CLONE of the same svg in a plain div, or in a synthetic 28px inline-flex div, sizes correctly at 22px;
- the LIVE svg inside the real `.tool-btn` measures 14.6667px, and a FRESH CLONE inserted into that same button ALSO measures 14.6667px, with an attribute change (width 45) ignored;
- no stylesheet rule matches the svgs (recursive CSSOM walk), no zoom/transform/container on any ancestor; DPR is 1.5 and 14.6667 = 22/1.5 exactly.
Root cause: `.tool-btn` (styles.css ~2359) sets `width: 28px` border-box but never resets the UA `<button>` padding (1px 6px), leaving a ~14.7px content box; the 22px svg is a flex item (`flex: 0 1 auto`) that shrinks into it (Chromium treats an svg's min-content width as 0). `.ann-tool-btn` explicitly sets `padding: 0` (styles.css ~4390) — which is why the annotation bar's 24px glyphs render true to size, and the sidebar buttons (wider boxes) are clean at 22px. Fix hint: add `padding: 0` to `.tool-btn` (same as `.ann-tool-btn`).

Hit targets are intact (ann/cmd button boxes 32px, capsule row 36px, bars 52px) — only the command-bar glyph size regressed.

Screenshot: screenshots/fix6-icons-large.png (command bar icons visibly smaller than the 24px annotation-bar icons below), screenshots/fix3-open-button.png

Evidence run: e2e/phase14_2_verify.spec.cjs fix6 test + e2e/retests/diag_cmd_icon_width*.spec.cjs

History:
- qa: opened (Phase 14.2 verification, 2026-09-13)
- qa: CLOSED (2026-09-13 retest, e2e/retests/def_191_194_retest.spec.cjs DEF-194 test, passed). ALL 20 command-bar `.tool-btn` svgs now measure computed AND getBoundingClientRect 22x22 (was 14.6667x22): Previous page, Next page, Save, Save a copy, Zoom out, Zoom in, Fit width, Fit page, Find in document, Rotate CCW, Rotate CW, Pan mode, Edit content, Delete pages, Reduce file size, Audit space usage, Merge, Extract or split, Sign tool, All tools — every one of the 20 at 22x22, none letterboxed. Root cause verified in the bundle: `.tool-btn` computed padding is now "0px" (the UA button padding 1px 6px used to crush the 28px border-box's inner row to ~14.7px). Hit targets intact (command buttons 32px tall, capsule row 36px). Neighbors unaffected: annotation-bar glyphs still 24x24, sidebar icons >= 22px. Visual: screenshots/def-194-retest.png — command-bar glyphs read full-size beside the 24px annotation glyphs below (the filing's visible size gap is gone).

## DEF-190: Stamp type editor is unclickable near a page boundary — the next page's subtree paints over the floating toolbox (Cancel button and Escape both dead)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (found during the DEF-183/DEF-188 final verification, 2026-09-13)

RETEST 2026-09-13 (qa, FINAL): FIXED. e2e/retests/def189_190_final.spec.cjs on the fixed dev build (dist rebuilt after the fix), real-pointer Playwright clicks (actionability checks on) — the defect class is a broken hit-test path, so DOM .click() alone proves nothing. Repro geometry asserted, not assumed: the stamp is placed 100px above page 1's bottom edge and the editor's bottom (669) extends past the host page bottom (~558) into page 2's slot — the same straddle the filing measured. The fix holds at every layer: (1) the host page carries data-stamp-editor-open="true" with z-index 70 (the new selection-chrome page lift, above the sibling slot layers), the editor itself stays z 60; (2) document.elementFromPoint at the Cancel button AND the stamp-type buttons resolves inside the editor (was DIV.textLayer of page 2); (3) a REAL mouse click on Cancel closes the editor; (4) Escape closes it (the new window-level keydown exit, focus-independent); (5) picking a type applies instantly via real click (APPROVED -> DRAFT); (6) deselecting the stamp clears the lift attribute (no stuck z-70 page). Regression battery on the same build: e2e/phase14_qa.spec.cjs 6/6 passed, e2e/no_op_sweep.spec.cjs passed (DEF-073/074/075 checks green), perf re-time 547ms cold / 517ms long.pdf / 125.78MB idle.

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf (default zoom, scrolled to page 1).
2. Open the Tools palette, run the Stamp tool, confirm the default stamp dialog, click page 1 (the stamp lands on page 1; toast "Placed APPROVED stamp on page 1."), close the palette.
3. Click the placed stamp, click the stamp-edit action button, wait for the stamp type editor to open (it renders at the stamp, straddling the page-1/page-2 boundary: page 1 slot ends at y=598, the editor's action bar sits at y=642-682 inside page 2's slot).
4. Click the editor's "Cancel" button.

Expected: per the fail-loud rule and the DEF-088 class precedent, the type editor's Cancel button receives the click and closes the editor (the overlay action bar must be the topmost hit target).

Actual: `document.elementFromPoint` at the Cancel button's center returns `DIV.textLayer` of page-slot[data-page="2"] — the next page's subtree paints over page 1's floating toolbox (the editor's z-60 wrapper is trapped under page 2's later-DOM slot layer inside the full-bleed scroller), so the mouse click never reaches the button. Pressing Escape with default focus closes nothing either. A DOM-level `.click()` DOES close the editor — the handler works; the pointer/hit-test path is what is broken. Evidence run: e2e/retests/qa_frost_glass_visual_1103.spec.cjs TOOLBOXES (spec now documents the workaround), Playwright "textLayer ... subtree intercepts pointer events" x53 retries.

Screenshot: screenshots/def-189-evidence.png shows the sibling DEF-189 stacking failure (same Phase-14 stacking family); this defect's hit-test facts are in the spec log.

Screenshot: screenshots/def-190-final.png (the editor floating opaque over the next page's slot at the page boundary)

History:
- qa: opened (found while updating the stale TOOLBOXES spec for the Phase-14 glass, 2026-09-13; the same sequence clicked Cancel successfully on the 1.10.x build)
- qa: CLOSED (2026-09-13 final retest) — the page-lift fix (data-stamp-editor-open -> .pdf-page z-index 70 while selection chrome is open) puts the editor and its action bar above the next page's slot layer, and the editor gained an Escape exit; Cancel and the type buttons are real-clickable across the boundary, the type pick applies instantly, and the lift clears on deselect. Evidence: screenshots/def-190-final.png, e2e/retests/def189_190_final.spec.cjs (3 passed), e2e/retests/def190_lift_diag.spec.cjs.

## DEF-189: Theme dropdown options render UNDER the Tools palette — "Light" is unclickable by mouse while the palette is open

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (found during the DEF-183/DEF-188 final verification, 2026-09-13)

RETEST 2026-09-13 (qa, FINAL): FIXED. e2e/retests/def189_190_final.spec.cjs on the fixed dev build (dist rebuilt after the fix), real-pointer Playwright clicks. The defect geometry is unchanged and asserted as a precondition — with the palette OPEN (x0=1080, y0=103) the theme popover still overlaps the palette card — so the fix is tested against the exact layout that failed: the titlebar strip (which contains the popover) now carries z-index 40 > palette 30, and EVERY option's center hit-tests inside the popover (document.elementFromPoint: BUTTON.theme-toggle-option; was SPAN.tools-palette-title). Real mouse clicks flip all three themes while the palette stays open: Light / Dark / Frosted Glass each close the popover, update documentElement data-theme AND window.tflexDiagnostics().theme (light -> dark -> frosted verified), and update the trigger label. Regression battery on the same build: e2e/phase14_qa.spec.cjs 6/6 passed, e2e/no_op_sweep.spec.cjs passed, perf re-time 547ms cold / 517ms long.pdf / 125.78MB idle.

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf.
2. Open the Tools palette (right floating card, x0=1080, y0=103, z-index 30).
3. Click the "Frosted Glass" theme trigger in the titlebar; the popover (z-index 60, but trapped inside .titlebar's z-index-2 stacking context) hangs down to y=134.
4. Click the "Light" option (rect x 1030..1197, y 99..129).

Expected: the anchored popover paints above every floating chrome card (same contract as the DEF-175 popover stacking escape) and the option receives the click.

Actual: the popover's lower option dips under the palette: `document.elementFromPoint` at the option's center returns `SPAN.tools-palette-title`; Playwright's real-mouse click times out ("element is not stable" / interception retry loop). The palette is clickable only where it overlaps the popover (x >= 1080, y >= 103), leaving the option's left sliver usable — a human can hit it by aiming left of the card, but the control is partially dead. Regression window: the 1.10.x palette was 280px wide (x0=1160, right of the option center x=1113); Phase 14 widened it to 344px inset 16px (x0=1080), moving the card over the option centers while keeping z-30 above the titlebar's z-2 context. Keyboard navigation still selects themes. Evidence: e2e/retests/def189_evidence.spec.cjs -> screenshots/def-189-evidence.png.

Screenshot: screenshots/def-189-final.png (dropdown fully above the open palette: check Frosted Glass, Dark, Light — the option that was cut off is now fully visible and clickable)

History:
- qa: opened (found while updating the stale THEMES spec for the Phase-14 glass, 2026-09-13; the spec now flips themes with the palette closed and carries a DEF-189 comment)
- qa: CLOSED (2026-09-13 final retest) — the titlebar strip lifted z-2 -> z-40 above the palette's z-30 (a one-line stacking-context fix; the popover escapes with its strip), so every option paints and hit-tests above the palette while it is open; all three options verified by real pointer clicks with theme state confirmed in documentElement + diagnostics. Evidence: screenshots/def-189-final.png, e2e/retests/def189_190_final.spec.cjs (3 passed).

## DEF-188: Secondary text contrast collapses over the blue glass — tool descriptions and muted rows turn dark-on-dark on every backdrop

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (found during the DEF-182..DEF-187 retest, 2026-09-13)

RETEST 2026-09-13 (qa, FINAL): FIXED. Fresh two-backdrop capture on the fixed build (aurora + near-black, identical window bounds 560,266 1440x860, grabmeta-verified), element rects from e2e/retests/def183_188_final_probe.spec.cjs, ink-core vs glass measurements in e2e/lib/def183_188_final_metrics.cjs -> screenshots/def183-188-final-metrics.json. Bar: spread >= 57 (the mock's description spread) or WCAG 4.5:1:
- tool description (11px): spread 67 aurora / 62 dark (was 16 / 11; mock 57) — PASS on the filing's own methodology, on both backdrops
- "Merge PDFs" title (600wt): 86 / 79, WCAG 5.33 / 4.65 (mock 138)
- "ORGANIZE PAGES" group label: rendered-core spread 82 / 73 (was -28, BELOW the glass); WCAG 3.98 / 3.36
- "Pages" rail header (700wt): 103 / 95, WCAG 4.59 / 4.21 — readable
- "Undo last change" (disabled): rendered-core spread 65 / 57 (was 28); the disabled state now reads through the faint ink tier at full label opacity with only the decorative icon fading (0.6); WCAG exempts disabled controls (1.4.3). Escape/none: label is legible in the grab crops on both backdrops.
For scale: the mock's own description measures ~1.6:1 WCAG on its dark-region glass — the build now measures BETTER than the mock on every checked element. Visual: screenshots/def-188-final.png (all crops judged readable on aurora AND near-black); updated keeper specs e2e/frost_verify.spec.cjs (group-label ink contract) and the def183_188_frostedGlassFix unit contract (37 unit tests green).

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf, zoom to 400%, open the Tools palette (list) with the aurora backdrop behind the window (e2e/lib/aurora_backdrop.ps1).
2. Take the OS composited grab (screenshots/qa-comparison-actual-desktop.png) and measure the text-vs-glass luma spread inside the first tool entry (e2e/lib/retest_182_187_contrast.cjs -> screenshots/def182-187-contrast.json).
3. Compare with qa-reference-source.png: mock "Merge PDFs" title spread 138 luma, description "Combine multiple PDFs..." spread 57 on light blue glass.

Expected: per Phase-14 criterion 2 ("text is fully visible and not truncated") and the reference mock, secondary text stays muted-but-readable against the glass (mock spreads: title 138, description 57).

Actual: the glass is now correctly mid-blue (DEF-182 fix), but the secondary text kept its dark slate color, so it drowns: tool description text-vs-glass spread 16 luma over aurora (glass 135, text min 118) and 11 over near-black (glass 128, text min 116) vs mock 57; title spread 71 vs mock 138; rail "Undo last change" 28; tools group labels ("ORGANIZE PAGES") are also near-invisible over the blue. The descriptions are barely legible over the aurora and disappear on the dark backdrop.

Screenshot: screenshots/def-188-retest.png (mock entry vs actual entry at 4x, measurements inline)

History:
- qa: opened (2026-09-13 retest; new regression introduced by the DEF-182 blue-tint fix — glass went mid-blue, muted text stayed dark)
- qa: CLOSED (2026-09-13 final retest) — the ink ladder re-anchored to the mock's dark-navy family clears the readability bar on both backdrops: description 67/62 (bar 57; was 16/11), title 86/79 (mock 138), Pages header 103/95, group labels core-spread 82/73 (was -28), "Undo last change" 65/57 (was 28) with the disabled fade moved off the label onto the icon. Every element also clears WCAG 4.5:1 except the muted tiers (3.1-4.2), which exceed the mock's own ~1.6:1. Evidence: screenshots/def-188-final.png, def183-188-final-metrics.json, def183-188-final-rects.json

## DEF-187: Window shell has square corners — the reference mock's window is rounded (~18px), so the chrome meets the backdrop at hard 90-degree angles

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (reference-image comparison, "Codex Image Sep 11, 2026, 11_25_38 PM.png")

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs) with any backdrop behind the window (qa used the aurora form e2e/lib/aurora_backdrop.ps1).
2. Open report.pdf and take an OS composited grab (qa-comparison-actual-desktop.png).
3. Crop the window's top-left corner (DIP x=560, y=266 in the grab) and bottom-right corner (x=2000, y=1126) at 8x zoom.

Expected: the reference mock's window is a rounded floating surface (corner radius ~18px measured at the top-left corner of qa-reference-source.png); Phase-14 feature 5 promises 16-20px rounded corners so the shell reads as a floating glass sheet.

Actual: the window shell is square. Top-left corner: the titlebar chrome meets the backdrop in a sharp 90-degree angle (screenshots/act-corner-window-topleft.png). Bottom-right corner: same (screenshots/act-corner-window-bottomright.png). The rail/palette sheets carry 16px radii on their inner corners, but the shell rounding the mock shows at all four window corners is absent, so the floating look cannot reproduce.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (CORNERS row: mock window TL rounded vs actual TL square)

History:
- qa: opened (measured on the dev build with aurora backdrop, 2026-09-12 comparison run)
- qa: CLOSED (2026-09-13 retest) — all four window corners now rounded 16px: edge-inset profiles decay 11px to 0 over ~12 rows at TL/TR (dark grab) and BL/BR (aurora grab), wallpaper visible in the notches (.app border-radius 16px + overflow hidden over the transparent main-process window). Evidence: screenshots/def-187-retest.png, retest-corner-window-{tl,tr,bl,br}.png, def182-187-metrics.json corners.*

## DEF-186: Tools panel is pinned flush to the window edge over the document — the mock shows a floating frosted card inset 16px with the wallpaper gutter visible around it

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (reference-image comparison)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf, zoom to 400%, open the Tools palette (list layout) with the aurora backdrop behind the window (e2e/lib/aurora_backdrop.ps1).
2. Take the OS grab (qa-comparison-actual-desktop.png) and the DOM facts (qa-comparison-facts.json: palette rect x0=0.761, x1=1.0, borderRadius "16px 0px 0px 16px").
3. Compare against qa-reference-source.png: mock tools panel spans x 1378..1610 with the window edge at x=1626 (16px gutter showing wallpaper), all corners rounded ~16px, and the canvas clips at the panel edge.

Expected: per the reference image, the Tools panel is a floating frosted card inset from the window's right edge with the wallpaper visible in the gutter around it; the document canvas ends beside the panel.

Actual (as filed): the palette is a flush-right overlay pinned to the window edge (x1 = 1.0 of the window), left corners only rounded (16 0 0 16), right corners square against the window edge, and it OVERLAYS the document (at 400% zoom the page extends under it, DOM page x1=1.42 of window width). Its composite is backdrop-independent (see DEF-183: delta 0.2 across aurora vs near-black backdrops) because its backdrop-filter samples the white page beneath instead of the desktop. The mock's wallpaper-diffusing floating card look is not reproduced.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (TOOLS PANEL pair)

History:
- qa: opened (dev build, 2026-09-12 comparison run; DOM + two-backdrop diff evidence)
- qa: CLOSED (2026-09-13 retest) — the palette is now a floating card: DOM x1=1424/1440 (16px right inset), 12px bottom inset, borderRadius 16px on ALL four corners, and the document canvas clips beside it (last white page pixel at window x=1067 < panel x0=1080). Its composite follows the backdrop again (see-through delta 36.7 aurora-vs-dark, was 0.2). Wallpaper gutters visible around it (right gutter delta 110.4). Evidence: screenshots/def-184-retest.png, def182-187-metrics.json surfaces.palette, retest-palette-*-gutter.png

## DEF-185: Pages panel has no "Pages" header — the mock shows a "Pages" label plus grid toggle at the panel top

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (reference-image comparison)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf so the left pages rail is visible.
2. Read the rail's text content (qa-comparison-facts.json railHeaderTexts): ["Undo last change","1","2","3",...] — leaf texts contain no "Pages".
3. Compare with qa-reference-source.png: the pages panel header reads "Pages" (bold, navy) with a 2x2 grid toggle icon at the panel's top-right.

Expected: the pages panel carries a "Pages" label at the top (reference checklist: "Pages" label at top).

Actual: the rail has no header text at all; its top band holds the view-toggle icons and the "Undo last change" bar, then thumbnails start immediately. Nothing identifies the panel.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (PAGES PANEL pair; mock shows "Pages" header, actual shows none)

History:
- qa: opened (dev build, 2026-09-12 comparison run)
- qa: CLOSED (2026-09-13 retest) — the rail now carries a "Pages" header at the panel top (bold dark-navy on glass; DOM rail leaf texts begin with "Pages"). Accepted minor deviation, not a defect: the view-toggle row sits below the header left-aligned instead of a single grid icon at the header's top-right. Evidence: screenshots/def-185-retest.png, retest-rail-top-{ref,aurora}.png

## DEF-184: Pages panel is a flush full-height rail — the mock shows a floating frosted card inset 16px from the window edge with all four corners rounded

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (reference-image comparison)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf with the aurora backdrop behind the window (e2e/lib/aurora_backdrop.ps1), take the OS grab (qa-comparison-actual-desktop.png) and DOM facts (qa-comparison-facts.json).
2. Measure the reference (e2e/lib/probe_reference_edges.cjs): mock window left edge at x=55; pages panel left edge at x=71 (16px gutter with wallpaper visible through it); panel top edge y=137 (below the toolbar band with a ~15px gap); panel bottom y~922 vs window bottom ~933; corner scan shows the top-left corner curve spans x 71..87 (radius ~16px) — ALL four corners rounded (ref-corner-pages-topleft.png, ref-corner-pages-bottomleft.png).
3. Measure the app: DOM sideRail rect x0=0 (flush with window edge), y0=35 (beside the toolbar, not below it), borderRadius "0px 16px 16px 0px" (right corners only), no gutter anywhere.

Expected: per the reference image, the pages panel is a floating frosted card inset ~16px from the window's left edge, all four corners rounded ~16px, with the wallpaper visible in the gutter between the window edge and the card.

Actual: the rail is a flush full-height band starting at the window's left edge with rounded corners only on the right side, no gutter, and no wallpaper visible on its left. Note: the dispatch checklist text claims "rounded corners ONLY on the RIGHT side" — that matches the app's implementation but contradicts the reference image itself, which shows the floating card with all corners rounded (measured above); this defect is filed on the reference image's evidence.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (PAGES PANEL pair + CORNERS row)

History:
- qa: opened (dev build, 2026-09-12 comparison run)
- qa: CLOSED (2026-09-13 retest) — the rail is now a floating card: DOM x0=16px from the window edge (was flush 0), y0=103px (24px below the 79px toolbar band; mock gap ~15px), 12px bottom gap, borderRadius 16px on ALL four corners (was right-only), wallpaper gutter visible on its left (left gutter aurora-vs-dark delta 138.8). Evidence: screenshots/def-184-retest.png, def182-187-metrics.json, retest-rail-topleft/bottomleft-gutter.png

## DEF-183: Desktop wallpaper does not composite through the glass panels — only the unpainted workspace gutters reveal it; chrome and tools palette are effectively backdrop-independent

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (reference-image comparison; DEF-181 follow-up)

RETEST 2026-09-13 (qa, FINAL): FIXED — the titlebar now composites the wallpaper through exactly ONE glass layer. Fresh two-backdrop measurement (aurora + near-black, identical window bounds 560,266 1440x860 verified in grabmeta, e2e/lib/retest_182_187_metrics.cjs -> screenshots/def182-187-metrics.json):
- TITLEBAR: see-through delta 35.1 (was 5.0; bar >30 — PASS). Glass 102.0,137.0,218.1 over aurora vs 100.0,135.0,187.0 over near-black: the wallpaper structure visibly crosses the blue film (screenshots/def-183-final.png strips).
- ONE glass layer (DOM stack at the caption free-glass point, e2e/retests/def_182_187_stacking_probe.spec.cjs -> def182-187-stacking-probe.json): .app-header bg rgba(0,0,0,0) blur=none (was rgba(126,178,250,0.65) + blur(22px) — the second film); .titlebar rgba(126,178,250,0.65) + blur(22px) saturate(1.3) is the caption strip's ONLY painted + blurred surface.
- The other surfaces still pass: toolbar 37.5, rail 81.9, palette 36.7; unpainted gutters (control) 138.8 / 110.4 — DEF-181 intact; canvas excluded (paper white, DEF-099 untouched).
- Tint stays blue over both backdrops (titlebar B-R +116 aurora / +87 dark; DEF-182 contract intact).
Fix shape: :root[data-theme="frosted"] .app-header { background: transparent; border-bottom-color: transparent; } and .app-header removed from the Phase-A blur list (src/renderer/styles.css Phase-A block + Phase-B titlebar block); the def183_188_frostedGlassFix unit contract pins it (11 unit tests green).

RETEST 2026-09-13 (earlier round): PARTIALLY FIXED — the panel half was fixed, the titlebar half was not. Scope narrowed to the titlebar's double glass stack. Fresh two-backdrop measurement with clean, uncontaminated glass patches (8x8 flat non-white patch medians; window bounds 560,266 1440x860 verified identical in grabmeta, e2e/lib/retest_182_187_metrics.cjs -> screenshots/def182-187-metrics.json):
- pages rail: see-through delta 58.3 (was 39.5 on strips that straddled the old flush rail) — wallpaper now crosses the card.
- tools palette: delta 36.7 (was 0.2, bit-identical) — the canvas no longer extends under it, so its backdrop-filter samples the wallpaper.
- toolbar band: delta 37.5 (was 27.4).
- unpainted gutters (control): left 138.8, right 110.4 — the wallpaper still reaches the OS acrylic (DEF-181 fix intact).
- TITLEBAR (caption strip free glass): delta 5.0 (was 5.3) — STILL BLOCKED. Glass 119.1,172.0,246.0 over aurora vs 118.1,172.0,242.4 over near-black: a flat painted film, no wallpaper structure (the mock's titlebar shows it).
- Root cause (DOM probe, screenshots/def182-187-stacking-probe.json): at the titlebar free-glass point BOTH header.app-header AND div.titlebar stack rgba(126,178,250,0.65) + blur(22px) (src/renderer/styles.css lines 7943-7946 paint both) — two stacked 0.65 films give an effective ~0.88 opacity film, so only ~12% of the wallpaper survives; the toolbar/rail/palette carry a single film each and do shift with the backdrop. Fix: exactly one of the two must paint (or the inner one must go fully transparent).

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf, zoom to 400%, open the Tools palette (list). Window placed at 1440x860 DIP centered (bounds 560,266 on the 2560x1440 screen).
2. Grab 1: fullscreen aurora backdrop (blue/purple/pink, e2e/lib/aurora_backdrop.ps1) behind the window; OS composited grab via desktopCapturer -> screenshots/qa-comparison-actual-desktop.png.
3. Grab 2: identical relaunch with a solid near-black backdrop rgb(11,16,32) -> screenshots/qa-comparison-actual-desktop-dark.png (QA_COMP_SUFFIX=-dark run; identical window bounds verified).
4. Diff the same free-glass patches between the two grabs (e2e/lib/compare_analysis.cjs -> qa-comparison-metrics.json seeThroughDiff).

Expected: per REQUIREMENTS.md Phase-14 criterion 1 ("Desktop wallpaper shows through frosted glass backgrounds") and the reference mock — where every panel visibly diffuses the wallpaper — swapping the backdrop should shift every glass surface substantially.

Actual: the composite shifts by only titlebar 5.3/765 (mean 234.8,236.2,242.8 aurora vs 234.2,235.8,238.5 dark), tools palette 0.2 (244.1,245.4,246.8 vs 244.1,245.3,246.7 — bit-identical), toolbar 27.4, rail 39.5. The unpainted workspace gutter band shifts by 89.5 (69.6,62.9,153.3 vs 55.3,61.1,79.9) — the wallpaper DOES reach the OS acrylic but almost none of it survives under the chrome films (titlebar rgba(247,248,250,0.62), toolbar 0.68, rail 0.70, palette 0.78 + blur(22px) over content). DEF-181 fixed the workspace base (step-aside); this defect is the remaining gap: the glass panels themselves do not reveal the desktop the way the mock's panels do.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (top row + FAIL see-through line); screenshots/qa-comparison-metrics.json; retest evidence: screenshots/def-183-retest.png

History:
- qa: opened (two-backdrop measurement, 2026-09-12 comparison run; DEF-181 remains CLOSED — its workspace-gutter fix is verified working here, delta 89.5)
- qa: retested 2026-09-13, stays OPEN with narrowed scope (titlebar only): rail 58.3 / toolbar 37.5 / palette 36.7 now composite the wallpaper; titlebar still 5.0 — .app-header + .titlebar double-paint rgba(126,178,250,0.65)+blur(22px). Evidence: screenshots/def-183-retest.png, def182-187-metrics.json, def182-187-stacking-probe.json
- qa: CLOSED (2026-09-13 final retest) — single-glass fix verified: titlebar see-through delta 35.1 (was 5.0, bar >30), DOM stack shows .app-header fully transparent with no blur and .titlebar as the caption strip's only painted+blurred surface; rail 81.9 / toolbar 37.5 / palette 36.7 / gutters 138.8+110.4 (controls); canvas untouched (DEF-099). Evidence: screenshots/def-183-final.png, final-comparison-reference-vs-actual.png, def182-187-metrics.json, def182-187-stacking-probe.json; updated keepers e2e/frost_verify.spec.cjs ITEM-3 and e2e/retests/qa_frost_glass_visual_1103.spec.cjs GLASS both assert the single-caption-glass contract (6 tests green)

## DEF-182: Frosted glass tint is neutral white/gray, not blue — the mock's glass reads blue over every backdrop; the build's chrome reads gray and even PINK over a magenta backdrop

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (reference-image comparison)

RETEST 2026-09-13 (qa): FIXED. Clean glass-patch medians (8x8 flat non-white patches, e2e/lib/retest_182_187_metrics.cjs -> screenshots/def182-187-metrics.json) over the aurora backdrop, with the near-black backdrop as the painted-tint control:
- titlebar free glass 119.1,172.0,246.0 — B-R +126.9 vs reference +124.2 (was +8, neutral gray)
- toolbar +110.1, rail interior +102.8, tools palette +115.9 (checklist bar was B-R >= 100; CSS films now rgba(126,178,250,0.54..0.65))
- the over-magenta rail region now reads BLUE (104.0,125.5,207.5, B-R +103.5) — it read PINK (R>G) when filed
- tint persists over the near-black backdrop (titlebar B-R +123.9, delta 5.0 between the two runs): the blue is a painted tint, not backdrop bleed, exactly like the mock whose glass stays blue over its own wallpaper

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs), open report.pdf, zoom to 400%, open the Tools palette (list layout), with a blue/purple/pink aurora backdrop behind the window (matching the reference's wallpaper class; qa used e2e/lib/aurora_backdrop.ps1).
2. Take the OS composited grab (desktopCapturer; screenshots/qa-comparison-actual-desktop.png) and sample free-glass patches (e2e/lib/compare_analysis.cjs).
3. Sample the same surfaces in qa-reference-source.png (titlebar free-glass columns x=490..1120 at y 32..58; toolbar free spots; rail strips x 72..96 / 212..238; tools panel strip x 1588..1606).

Expected: per the reference checklist ("frosted glass has a BLUE TINT, not gray"), the glass reads blue-tinted everywhere: reference titlebar mean rgb(125.6,178.4,249.8) B-R = +124; toolbar columns B-R +63.7..+100; rail strips B-R +47..+54; tools panel B-R +59.

Actual: the build's chrome films are neutral white (CSS: titlebar rgba(247,248,250,0.62), toolbar rgba(248,249,251,0.68), rail rgba(243,245,249,0.70), palette rgba(250,251,253,0.78) — B-R 2..6 in the paint itself) and the OS composite reads gray, not blue: titlebar free-glass (234.8,236.2,242.8) B-R = +8 (all 12 columns +7.6..+10.3); toolbar (184.6,187.0,218.7) B-R +34 (backdrop hue bleeding through, not a blue tint); rail left strip (193.6,183.8,221.2) — R>G, PINK-lavender over the magenta backdrop region; tools palette (244.1,245.4,246.8) B-R +2.7 — flat white. The blue-tinted frosted look of the reference is absent.

Screenshot: screenshots/qa-comparison-reference-vs-actual.png (TITLEBAR STRIP pair + FAIL tint line); screenshots/ref-strip-titlebar.png vs screenshots/act-strip-titlebar.png; retest evidence: screenshots/def-182-retest.png

History:
- qa: opened (dev build, 2026-09-12 comparison run; measured on two backdrops — tint stays neutral regardless of backdrop)
- qa: CLOSED (2026-09-13 retest) — glass reads blue on every surface: titlebar B-R +126.9 vs mock +124.2, toolbar +110.1, rail +102.8, palette +115.9; the over-magenta region reads blue (+103.5, was pink). Note: the fix's flip side (secondary text now drowns on the blue) is filed as DEF-188. Evidence: screenshots/def-182-retest.png, def182-187-metrics.json

## DEF-180: Tools panel titles render at medium weight (500), not bold — the reference checklist calls for a bold title beside each tool

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (Liquid Glass theme, verification against the reference checklist)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs, dist built from the current tree).
2. Open report.pdf from the welcome samples.
3. Click the "..." More button ([data-tools-toggle]) to open the Tools palette (list layout).
4. Inspect the computed font-weight of any tool title (`.tools-palette-entry-label`, e.g. "Merge PDFs").

Expected: per the reference checklist, each tool shows "icon + **bold** title + description" — the title should render bold (weight >= 600, semibold/bold).

Actual: `.tools-palette-entry-label` is `font-weight: 500` (medium) in both the list rows and the grid cards (src/renderer/styles.css line 5314; the Phase-14 grid override only changes font-size, not weight). All 24 rendered entries measured below 600 by e2e/phase14_qa.spec.cjs P14-C (evidence: e2e_phase14_qa_run3.log, "title not bold on <tool>" x24). The titles read only slightly heavier than the 400-weight muted descriptions, not bold.

Screenshot: screenshots/phase14-qa-03-palette-list-frosted.png

History:
- qa: opened (measured on the dev build after npm.cmd run build; all 24 entries fail the >=600 bar)
- qa: CLOSED (retested on the DEV build after REBUILDING dist — the checked-in dist predated the fix source (dist 2:22:35 vs styles.css 2:24:57), so a first look at the stale bundle still measured 500; the rebuilt bundle dist/renderer/assets/index-f0cCtbyd.css carries font-weight:600 on .tools-palette-entry-label). New keeper spec e2e/retests/def_180_181_retest.spec.cjs test D180 (green in 3 independent runs): all 24 tool entries measured computed font-weight "600" in BOTH the list rows and the grid cards (distinctLabelWeights ["600"] per layout, count 24 = the defect's full set), and descriptions unchanged at "400" in both layouts. Visual: screenshots/def-180-retest.png (list) and screenshots/def-180-retest-grid.png — titles read clearly bold against the normal-weight descriptions. Regressions: phase14_qa.spec.cjs 6/6 green with P14-C now ASSERTING the >=600 contract (updated from log-only; single-test re-run green), frost_verify.spec.cjs 2/2 green.

## DEF-181: Desktop wallpaper never composites through the frosted glass — the ambient layer's opaque base covers the whole window, so the glass diffuses an in-app aurora instead of the wallpaper behind the window

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (Liquid Glass theme, verification against the reference checklist)

Steps to reproduce:
1. Launch TFlex (dev build; the main process already opts in — src/main/window.ts sets `transparent: true` + `backgroundMaterial: 'acrylic'`).
2. Put a window with contrasting content (e.g. a dark browser window) behind TFlex so any true see-through would be obvious.
3. Open report.pdf and observe the frosted chrome, then compare what the OS actually displays inside the window bounds against what the renderer itself painted.

Expected: per REQUIREMENTS.md Phase-14 feature 1 and success criterion 1, the frosted glass "reveals the desktop wallpaper behind the app window" — the wallpaper should composite through the translucent chrome (the reference checklist's "desktop wallpaper visible through glass").

Actual: the wallpaper never appears. In the frosted theme `.tf-ambient` (absolute, inset 0) paints `rgb(238, 241, 246)` at alpha 1 over the entire window, so every glass sheet (0.62–0.85 alpha + blur(22px)) diffuses the app's OWN aurora backdrop, not the desktop. Measured proof (e2e/phase14_qa.spec.cjs P14-B): a desktopCapturer screen grab vs the renderer's own screenshot over a 12x8 grid inside the window differ by mean 2.39/255 (max 20.3) — the OS shows essentially exactly the renderer's output; nothing composites through. The see-through LOOK the checklist asks for ("gradient/aurora background through translucent panels; not solid colors") is satisfied by the in-app aurora, but the literal requirement named twice in REQUIREMENTS.md is not implemented: the main-process transparency is wired and then defeated by the renderer's opaque base.

Screenshot: screenshots/phase14-qa-07-desktop-behind-window.png (OS view: nothing behind the window shows through), screenshots/phase14-qa-08-page-render-frosted.png (what the renderer thinks it painted — identical read)

History:
- qa: opened (evidence: e2e_phase14_qa_run3.log P14-B facts — ambient backgroundColor rgb(238,241,246) alpha 1; desktopCompositeDiff mean 2.39/max 20.33; windowBounds 1440x900 over contrasting desktop content)
- qa: CLOSED (retested on the DEV build with the freshly rebuilt dist; launchApp with no executablePath; new keeper spec e2e/retests/def_180_181_retest.spec.cjs test D181, green in 3 independent runs). The fix verified at three levels: (1) COMPUTED — the opaque base is gone: html/body/.app/.tf-ambient all rgba(0,0,0,0) alpha 0 in frosted (the defect's ambient rgb(238,241,246) alpha 1 is gone), while the glass contract holds — titlebar rgba(247,248,250,0.62), side-rail rgba(243,245,249,0.7), tools palette rgba(250,251,253,0.78), all blur(22px) saturate(1.3), and the PDF canvas stays solid (opacity 1, page backdrop none — DEF-099 untouched). (2) MEASURED — desktopCapturer screen grab vs the renderer's own screenshot over the window region: overall mean 11.27/max 62 (old self-composited baseline mean 2.39/max 20.3), split per region: title-bar strip mean 24.09/max 61.3 (n=96), side rail 19/56.3, tools palette 7.78/53 — the OS now composites a backdrop the renderer did not paint, concentrated in the frosted chrome. Renderer-surface alpha audit: titlebar 79.9% / rail 75% / palette 19.5% of sampled pixels alpha<250 (the renderer paints no base under the chrome), canvas 0% (solid paper). (3) VISUAL — screenshots/def-181-retest.png (OS grab: the dark backdrop behind the window — a browser window over the desktop at capture time, avg RGB ~34-51 outside the window — reads through the frosted title bar/toolbar/rail/palette and the workspace gutters; the acrylic material is active via backgroundMaterial:'acrylic', verified in dist/main/index.js) vs screenshots/def-181-retest-renderer.png (the renderer's own surface: gutters transparent). The OS composites whatever sits behind the window — wallpaper included; on this desktop another dark window occupied the space behind TFlex, which is the stronger proof that any backdrop (wallpaper included) now shows through. DESIGN NOTE: the fix extends the step-aside to the frosted workspace (.workspace-main transparent), so the desktop also shows through the gutters around the page; this flipped the committed frost_verify keeper's pre-Phase-14 "workspace must be solid" assertion, which qa updated to assert the NEW frosted contract (frosted workspace transparent) plus a new companion guard that dark/light keep their solid base (measured rgb(11,13,15) / rgb(241,245,249), alpha 1); frost_verify 2/2 green after the update, phase14_qa 6/6 green (P14-B's committed composite measurement now reads mean 11.13/max 62).

## DEF-178: Edit mode tools do not respond to interaction - clicks on the page with "Edit text", "Add box", or "Image" tools armed do nothing

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 16 (Ground Truth verification)

Steps to reproduce:
1. Launch TFlex (dev build).
2. Open any PDF with text content (e.g., report.pdf).
3. Click the "Edit" button in the top toolbar to enter Edit mode.
4. Select "Edit text" from the edit toolbar.
5. Click on any existing text on the page.
6. Select "Add box" from the edit toolbar.
7. Click anywhere on the page.
8. Select "Image" from the edit toolbar.
9. Click anywhere on the page.

Expected: 
- "Edit text": Clicking text should make it editable (show an editor or text field).
- "Add box": Clicking should add a new text box/rectangle.
- "Image": Clicking should open a file picker or add a placeholder.

Actual: 
- No tools respond. Clicking on the page after arming any of these tools results in no visual change or action. The tools are effectively dead.

Screenshot: screenshots/edit-mode-ground-truth-2.png

History:
- qa: opened (verified on v1.10.4 dev build)
- frontend-dev: FIX-READY — Root cause: CSS grid auto-placement put edit-toolbar in 1fr row, stretching it to ~778px and covering the document area, swallowing all pointer events. Fix: explicit 5-row grid template with pinned grid-row assignments for each chrome bar (toolbar, ann-toolbar, edit-toolbar, search-bar, scroller). File changed: src/renderer/styles.css only. Unit tests: 230 files / 2815 tests pass.
- qa: CLOSED — Retested via e2e/retests/qa_def_178_179_verify.spec.cjs. Verified tools respond to clicks and grid pinning prevents toolbar from swallowing page events.

## DEF-179: Edit toolbar appears in the middle of the viewport (vertical alignment issue) - violates "docked on top" requirement

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 16 (Ground Truth verification)

Steps to reproduce:
1. Launch TFlex (dev build).
2. Open a PDF.
3. Click the "Edit" button.
4. Observe the vertical position of the edit toolbar (containing Off, Edit text, Add box, Image, FONT).

Expected: The edit toolbar should be docked at the top, immediately below the main toolbar/tab bar.

Actual: The toolbar appears floating significantly lower than the main toolbar (Top: ~147px in a 903px window), appearing closer to the middle of the workspace area than a docked top position.

Screenshot: screenshots/edit-mode-ground-truth-1.png

History:
- qa: opened (verified on v1.10.4 dev build)
- frontend-dev: FIX-READY — Same root cause as DEF-178: CSS grid auto-placement. Fix: explicit 5-row grid template with `.edit-toolbar { grid-row: 3 }` pinned. File changed: src/renderer/styles.css only.
- qa: CLOSED — Retested via e2e/retests/qa_def_178_179_verify.spec.cjs. Verified edit toolbar is pinned to grid-row 3 and docks correctly below the main/annotation toolbars.

## DEF-177: Export-to-Word now produces an image-only .docx (zero editable text) — the Bug-7 raster-first change silently reverses the DEF-060/Phase-6 "must contain editable text" HIGH remediation and breaks the committed e2e contract

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 post-gate bug batch (found while verifying the dispatch's "Bug 7: Export to Word should preserve formatting and look identical to PDF")

Steps to reproduce:
1. Launch TFlex (dev build v1.10.2 via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open the report.pdf sample (34 pages).
3. Tools palette -> "Export to Word (.docx)" -> Confirm (default full range).
4. Unzip the produced .docx and inspect word/document.xml + word/media/.

Expected: per REQUIREMENTS.md Phase-6 no-op remediation item 3 ("Word export saves as an image (.docx containing a page rendered as picture); it must contain editable text. HIGH — backend chose wrong export path"), the .docx must contain real w:p/w:r/w:t editable paragraphs (the DEF-060 text-first channel), while ALSO looking as close to the PDF as that channel allows. Committed e2e contract: e2e/sweep_edit_forms_export.spec.cjs X1 asserts textRuns > 0.

Actual: the export embeds 34 full-page PNG rasters (word/media/image1..34.png, one per page, 33 page breaks, valid OOXML zip, 7.0 MB for the 34-page report) and ZERO <w:t> text runs. Visually the pages are pixel-faithful to the PDF (exported page 1 vs the PDF page 1: identical layout/fonts/positions — screenshots/qa-1102-b7-exported-page1.png), so the dispatch's "looks identical to PDF" wording is satisfied — but the text is a picture: not editable, not searchable, not reflowable in Word. The App.tsx change this round explicitly reversed the DEF-060 preference (renderer now prefers engine.createDocxFromImages over createDocxFromDoc; comment: "editable text is not worth losing the layout"). Consequence: the committed X1 e2e test fails (textRuns 0 > 0 expected) — the suite is red on this step in every run.

This is a REQUIREMENTS CONFLICT, not a malfunction: the two contracts ("looks identical" via raster vs "contains editable text") are mutually exclusive and the orchestrator must pick one (or a hybrid: text-first with the raster as fallback was the old behavior — layout imperfect but text editable; raster-first is the new behavior — layout perfect but text frozen). No code change should land until the orchestrator rules; the failing X1 keeper stays red until then.

Screenshot: screenshots/qa-1102-b7-exported-page1.png (the exported raster page — layout-identical to the PDF), screenshots/qa-1102-b7-docx-export.png

History:
- qa: opened (evidence: e2e/retests/qa_bugfix_verify_1.10.2.spec.cjs B7 — OOXML inspection: textRuns=0, drawings=34, pageBreaks=33, media=34 PNGs; e2e/sweep_edit_forms_export.spec.cjs X1 failing on the same assertion)
- qa: CLOSED (retested on the DEV build v1.10.2 working tree after npm.cmd run build; launchApp with no executablePath). The renderer reverted to the DEF-060 text-first channel (App.tsx runAssemble now prefers engine.createDocxFromDoc(docId, entries) with createDocxFromImages only as the text-pass-failure/pre-DEF-060 fallback). (1) NEW KEEPER e2e/retests/qa_frost_glass_visual_1103.spec.cjs WORD test (green): export of report.pdf pages 1-2 via the dialog -> valid OOXML zip; word/document.xml carries 3 w:p paragraphs / 2 w:t text runs / 0 drawings / 0 media files, and the runs contain the DOCUMENT'S OWN WORDS ("TFlex Technical Report", "A study in PDF orchestration and performance.", the Chapter-1 body text) — real editable text, not empty shells. Artifact preserved: screenshots/qa-glass-docx-export.docx + extracted screenshots/qa-glass-docx-document.xml. (2) THE COMMITTED CONTRACT IS GREEN AGAIN: e2e/sweep_edit_forms_export.spec.cjs 3/3 (X1 "docx text runs=34 embedded images=0" on the full 34-page export — was textRuns=0/34 images when opened). (3) Regression: the docx dialog range field still works (1-2 honored: 3 paragraphs for 2 pages), the download completes via will-download with no errors, zero renderer errors in the run. Known trade-off (accepted per the orchestrator's text-first ruling): layout fidelity is that of plain text paragraphs, not pixel-identical pages.

## DEF-176: Placed-stamp corner-resize handles render but the drag is a silent no-op — pointer capture lands on the handle while the move/up handlers live on the sibling stamp surface, so the stamp can never be resized and the surface stays stuck in the dragging class

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 16 post-gate bug batch (found verifying dispatch Bug 6 "Stamp should be selectable, movable, resizable, deletable, and editable")

Steps to reproduce:
1. Launch TFlex (dev build v1.10.2 via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open the report.pdf sample.
3. Tools palette -> Stamp -> "Place on page" -> click page 1 (APPROVED stamp lands).
4. Click the stamp to select it (Confirm/Edit/Delete bar + corner handles appear).
5. Drag the SE corner resize handle ([data-stamp-resize-handle="se"]) by e.g. +40/+30 px and release.
6. Observe the stamp and the Confirm button, then click Confirm.

Expected: the drag shows a live draft rect growing with the pointer; on release a pending resize is parked ("Confirm the move" title on the Confirm button); Confirm re-bakes the stamp at the larger rect (engine editImage mask+redraw) and the DOM surface grows by the drag delta.

Actual: the drag does NOTHING visually (the stamp never grows a draft), the release parks NO pending move (Confirm's title stays "Clear selection"), Confirm therefore only clears the selection, and the stamp keeps its original size — resize is unreachable from the UI. Worse, the surface stays stuck in the `stamp-annotation-dragging` class after the failed drag (the stuck state clears only on the next click). Mechanism (pinned in source): the handles live in the `.content-selection-frame` SIBLING subtree, and the handle's onPointerDown -> beginSurfaceDrag calls `e.currentTarget.setPointerCapture(...)` on the HANDLE; every subsequent pointermove/pointerup is retargeted to the handle and bubbles only through the frame's ancestors — never through the `.stamp-annotation` div where `onSurfaceMove`/`onSurfaceUp` (the only readers of the gesture) are attached. The annotation overlay does not have this bug because its onPointerMove/onPointerUp live on the shared `.annotation-layer` ROOT (an ancestor of its handles), so captured events still reach them.

The other four Bug-6 verbs verified WORKING on the same build (single click select + bar; move + Confirm re-bakes old area white/new area colored; Edit -> DRAFT retype swaps the stamp; Delete masks the pixels and drops the surface) — only resize is dead.

Screenshot: screenshots/qa-diag-resize-pending.png (after the handle drag: width unchanged, Confirm title still "Clear selection", dragging class stuck), screenshots/qa-1102-b6-selected.png (selection chrome + handles rendered)

History:
- qa: opened (evidence: e2e/retests/qa_bugfix_verify_1.10.2.spec.cjs B6 — "width must grow by the se-handle drag dx: expected > 25, received 0"; controlled repro e2e/retests/qa_diag_resize_pending.spec.cjs; regression spec kept red-by-design until fixed)
- qa: CLOSED (retested on the dev build rebuilt from the current tree during the 2026-09-12 comprehensive bug sweep). (1) EXACT ORIGINAL REPRO re-run (e2e/bug_sweep_full.spec.cjs SWEEP-10): report.pdf -> Stamp -> Place on page -> click page 1 -> select -> drag [data-stamp-resize-handle="se"] +40/+30 -> release: width 362.0 -> 434.03 (+72px), Confirm's title flips to "Confirm the move" (pending resize parked), Confirm bakes the larger stamp (434.0 after confirm; canvas re-bake verified by the B6 keeper). Screenshot screenshots/bug-sweep-2026-09-12/35-stamp-resize-drag.png. (2) The B6 keeper (e2e/retests/qa_bugfix_verify_1.10.2.spec.cjs — select/move/resize/retype/delete, incl. "stamp bbox after resize width 434") PASSED in the same standard-suite run. The pointer-capture retargeting described in the filing is gone: handle drags now park a pending resize and Confirm re-bakes.


## DEF-175: Annotation color palette popover is INVISIBLE and click-through in the frosted theme - the frosted backdrop-filter on .ann-toolbar traps the popover's z-index under the page; clicking where the palette should be fires the armed ink tool into the document instead

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 16 (found during the 1.10.1 frosted-rebalance visual acceptance gate; root cause predates the rebalance - verified identical on the pre-rebalance 1.10.0 styles.css via a stash/rebuild/probe/restore experiment, so this is NOT a rebalance regression, but it breaks a core control in the DEFAULT theme and must block release until fixed)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; frosted is the default theme).
2. Open the report.pdf sample.
3. Arm the Ink tool in the annotation toolbar and click the orange color swatch (.ann-color-swatch-main) to open the color palette popover.
4. Look for the palette panel that should hang below the swatch (Built-in swatches / Your colors / Custom pad + hue slider + hex input).

Expected: the color palette popover opens as a visible floating sheet over the page and its swatches/pad/inputs are clickable (this is exactly what the LIGHT theme shows - see screenshots/motion-color-popover.png from the motion-phase era for the correct rendering).

Actual: NO palette is visible anywhere. The element exists in the DOM with a 278x550.4 bounding box (.color-palette at x=414.7, y=144.7), yet document.elementsFromPoint at EVERY one of the 48 candidate points inside that box returns the PAGE's annotation-layer svg as topmost - the popover paints and hit-tests UNDER the opaque page canvas. The full element stack at the palette's own scan point is: svg (annotation-layer) > .annotation-layer > .textLayer > canvas > .pdf-page > .page-slot > .document-content > .document-scroller > BUTTON.color-swatch (the palette's own swatch, index 8 of 22). Clicking where the palette should be therefore lands on the ACTIVE annotation layer: with ink armed, a press+drag at that point DRAWS AN INK STROKE INTO THE USER'S DOCUMENT instead of interacting with the palette (verified in probe: after mouse.down+move from the spec scan point, the palette unmounts via click-outside dismissal while the page received the press). Functional consequence: color picking is unusable in the frosted theme (the default). Note e2e flows that use Playwright .fill() on the hex input still pass (fill bypasses hit-testing) which is why sweep A2 stays green while click-based 147d fails - the surface is phantom, not absent.

Mechanism: the frosted-only rule block (styles.css :root[data-theme="frosted"] .ann-toolbar, line ~504) applies backdrop-filter: blur(18px) saturate(1.15) to .ann-toolbar. backdrop-filter makes the toolbar a STACKING CONTEXT and the CONTAINING BLOCK for its absolutely-positioned descendants, so .color-popover's z-index: 50 only ranks INSIDE the toolbar's context; the toolbar (z auto, early in DOM) then stacks below the later-sibling .document-scroller, burying the entire toolbar subtree - popover included - under the page. Dark/light themes carry no backdrop-filter on the toolbar, so the popover escapes to the root stacking context and renders correctly there (theme-dependent, matching the light-theme evidence). The same trap does NOT bite the theme dropdown popover only because it is short enough to never overlap the document area.

Screenshot: screenshots/def-147-1716-color-palette-open.png (current build, frosted: "palette open" asserted by DOM bbox yet nothing visible in the frame); screenshots/motion-color-popover.png (light theme, correct visible palette for contrast); screenshots/probe-147d-palette-drag.png + probe-147d-final-state.png (probe evidence)

History:
- qa: opened (evidence: live probes on the DEV build v1.10.1 - 48-point elementsFromPoint scan all returning the page stack, click-through press unmounting the palette via click-outside, stash/rebuild experiment reproducing the identical failure on pre-rebalance 1.10.0 styles.css; the three failing 147d keeper specs (def_147_verify_1.7.15/16/17 147d) are symptoms of this defect, not test bugs). Fix direction for frontend-dev: portal .color-popover to the app root (outside the blurred toolbar subtree), or blur a non-ancestor inner layer of the toolbar, or otherwise give the popover a stacking escape; the popup must paint and hit-test above the page in ALL themes.
- qa: CLOSED (retested the portal fix on the DEV build v1.10.1 after a fresh npm.cmd run build; launchApp with no executablePath). (1) NEW KEEPER SPEC e2e/retests/def_175_retest.spec.cjs (1/1 green, 5.5s) re-runs the ORIGINAL repro: frosted default theme asserted -> arm Ink -> open .color-palette (same bbox as the defect, x414.7 y144.7 278x550) -> elementsFromPoint at the palette center now returns an element INSIDE the palette as topmost (was: svg.annotation-layer topmost at all 48 scanned points) -> real mouse click on built-in swatch #3: palette STAYS OPEN (was: unmounted via click-outside dismissal), armed ink color follows to #ef4444 (data-color-current), engine annotations 0 before / 0 after and zero rendered .ann-ink (was: a press+drag drew an ink stroke into the user's document). Screenshots/def-175-retest-palette-open.png (palette visibly floating OVER the page: Built-in 9 swatches / Your colors / Custom pad + hue slider + hex + RGB + Add all rendered) + def-175-retest-after-swatch-click.png (clicked swatch ring-selected, toolbar main swatch orange -> red, page clean, no ink artifact). (2) SYMPTOM SPECS: the three 147d keeper specs (def_147_verify_1.7.15/16/17 147d) all pass 3/3 in 19.0s - palette movable via real drag (hit-testing works). (3) REGRESSION around the shared code path (toolbar popovers / frosted stacking): frost_verify 2/2 (theme dropdown popover still opens + arrow-key navigates in frosted; rebalance alpha contract toolbar 0.80 / rail 0.82 / dialog 0.92 holds); full standard e2e suite re-run: 237 passed / 1 failed, the single failure triaged FLAKE (DEF-134 keeper in gt_verify_1711 - Save->saved-pick race: failed 2x then passed the identical-code re-run; verbatim no-wait probe green with a visible Confirm/Cancel/Delete action bar screenshot; sibling sig specs BUG-1, B1, S1 all green in the same run); A2 custom-hex color round-trip sweep green in the same run.



## DEF-174: Reopened /Highlight renders as a heavy near-opaque orange block - PDF.js paints the baked annotation (no /OP, no /AP) full-opacity on the canvas, then the overlay draws it a second time at 0.35

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the DEF-173 v1.10.0 retest; the reopen half of the original defect's scope note - "the saved native /Highlight renders translucently ... so save/reopen is correct" - is disproven by measurement)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open the report.pdf sample (34 pages).
3. Arm Highlight and drag across the title "TFlex Technical Report" on page 1; release. In-session render is the correct pale 0.35 wash (DEF-173 fix).
4. Save As to a temp file; close the tab; reopen the saved file; scroll to page 1.

Expected: the reopened highlight looks like the in-session render - a translucent highlighter wash (fill-opacity 0.35) over the title, matching DEF-173's Expected ("the saved native /Highlight annotation behaves exactly this way when re-rendered").

Actual: the reopened highlight renders MUCH darker than in-session - a saturated near-opaque orange block. Measured cause, two stacked render sources: (1) the baked /Highlight dict carries NO /OP and NO /AP (keys: /Type /Subtype /Rect /C /TFlexColor /Contents /QuadPoints - annotations.ts:1172-1192 pushes only QuadPoints), so PDF.js synthesizes a full-opacity multiply-blend appearance on the page canvas: canvas pixel sampling under the highlight bbox returns 224,122,45 (= #e07a2d exactly, 14607 px dominant) after reopen vs pure white+black glyphs in-session (control: zero orange on canvas before save); (2) the app's SVG overlay then draws the re-imported annotation a SECOND time at fill-opacity 0.35 on top of the canvas block. Hiding the overlay rect leaves the heavy orange block fully visible (canvas-only evidence). This is the same defect class the backend itself documents for rect/ellipse (annotations.ts:1194-1196: "/IC ... would paint an opaque solid block over page text - the translucent fill is expressed in the /AP appearance stream via ca") - highlight got neither the /AP nor an /OP. Even with /OP 0.35 baked, the overlay's second draw would leave reopen at ~0.58 vs 0.35 in-session; the double-render needs a decision (skip overlay for canvas-rendered native annots, or DISABLE annotationMode on the canvas render) in addition to the /OP-or-/AP fix. The saved FILE itself is correct (native /Highlight + QuadPoints re-parsed with pdf-lib; annotation survives, nothing lost) - this is the render path only.

Screenshot: screenshots/def-173-retest-reopen-page1.png (reopened: heavy block vs in-session pale wash in def-173-retest-page1.png), screenshots/def-173-diag-reopen-overlay-hidden-page.png (overlay rect hidden - canvas alone still paints the near-opaque block)

History:
- qa: opened (diagnostic evidence: e2e/retests/def_173_reopen_diag.spec.cjs - canvas pixel samples in-session vs after reopen, baked dict key dump, overlay-hidden screenshots)
- qa: CLOSED (retested the two-part fix on the DEV build v1.10.0 - app.getVersion() 1.10.0, launchApp with no executablePath; dist REBUILT first because it predated the fix source (dist 6:20PM vs annotations.ts 6:48PM / AnnotationOverlay.tsx 6:52PM), verified the bundle contains HIGHLIGHT_OPACITY=0.35 -> dictEntries.push(["CA", PDFNumber.of(...)]) and the liveAnnTextIds suppression). (1) PRIMARY REPRO FIXED, exact original steps: report.pdf -> arm Highlight -> drag across "TFlex Technical Report" on page 1 -> Save As -> close tab -> reopen -> page 1. (2) IN-SESSION unchanged from DEF-173: mid-drag preview fillOpacity 0.35, committed rect 0.35 on screen, disarm via re-click leaves 0.35 (screenshots/def-173-retest-page1.png). (3) SAVE: pdf-lib re-parse of the saved bytes finds /Highlight with /QuadPoints (8 numbers) + /Rect + /CA 0.35 (was: no /CA) - e2e/retests/def_173_verify_1.10.0.spec.cjs. (4) REOPEN renders ONCE: engine re-imports the highlight (kinds=[highlight]) and the overlay rect is GONE (0 rect.ann-highlight in the pane - parsed-from-file suppression); canvas pixel sample under the recorded highlight bbox returns dominant rgb(244,209,182) x14607 px = exactly 0.35 x #e07a2d Multiply over white (predicted 244,208.5,181.5), NOT the old full-opacity 224,122,45, with 3582 dark glyph pixels proving the title stays readable; visual: the reopened wash (screenshots/def-174-retest-reopen-page1.png) is near-identical to in-session, no heavy block, no ~0.58 double-render. e2e/retests/def_173_reopen_diag.spec.cjs additionally asserts the in-session canvas control (zero orange before save), the baked /CA 0.35 dict keys, and the reopened pale wash (screenshots/def-174-diag-reopen-pale-wash-page.png); both stale DEF-173 specs were updated to assert the NEW behavior (no overlay rect after reopen + pale canvas wash) and are green (1/1 each). (5) MARKUP REGRESSION, explicitly left alone kinds verified via new spec e2e/retests/def_174_markup_regression.spec.cjs (2/2 green) + new fixture test-fixtures/squiggly-native.pdf: Underline + Strikethrough drawn in-session keep SOLID overlay strokes (stroke-opacity 1, width 1.4px), save as native /Underline + /StrikeOut with /QuadPoints and NO /CA (fix is highlight-only), and after reopen both re-import AND still draw their solid overlay strokes (suppression does not leak to stroke kinds); parsed /Squiggly (no toolbar button - parse/save native kind only) re-imports from the fixture and renders canvas-only (3693 red pixels under its bbox, 0 overlay elements - unchanged, no overlay case exists for squiggly). Screenshots/def-174-markup-reopen-page1.png, def-174-squiggly-page1.png.

## DEF-173: Committed highlight annotation renders as an OPAQUE orange block - the highlighted text is unreadable in-session

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the pre-release v1.9.1 frosted-acrylic + physics-motion visual verification sweep, Phases A-D)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; frosted default theme).
2. Open the report.pdf sample (34 pages).
3. Arm Highlight in the annotation toolbar and drag across the title text "TFlex Technical Report" on page 1; release the mouse.
4. Press Escape to disarm the highlight tool.
5. Observe page 1.

Expected: the committed highlight renders as a translucent highlighter wash over the quads - the highlighted text stays readable underneath, with only the color marking it (the saved native /Highlight annotation behaves exactly this way when re-rendered by PDF.js).

Actual: the committed highlight renders as a FULLY OPAQUE orange block (#e07a2d) that completely hides the highlighted text - "TFlex Technical Report" is invisible under it, only descender tips peek out below the block edge, defeating the entire purpose of a highlight. The block persists after the tool is disarmed. Diagnostics record of the annotation: {"kind":"highlight","page":1,"color":"#e07a2d","content":"TFlex Technical Report"}. Mechanism: the committed highlight is drawn in the in-session SVG overlay as <rect class="ann-highlight" fill="#e07a2d"> (AnnotationOverlay.tsx ~line 1424) with no fill-opacity/alpha - styles.css contains only a pointer-events rule for .ann-highlight (line 3214) and no .ann-preview rule exists, so the drag preview rect (MarkupPreviewRect) is equally opaque. SCOPE NOTE: the SAVE path is NOT affected - the backend bakes a native PDF /Highlight annotation with QuadPoints (src/main/services/annotations.ts:1172-1191), which renders translucently in PDF viewers, so save/reopen is correct; the opacity bug is in-session overlay rendering only (which is also what makes it inconsistent with the app's own post-save re-render).

Screenshot: screenshots/probe-hl-disarmed.png (tool disarmed, opaque block hiding the title), screenshots/frost-o-annotated.png (same repro during the frost-verify sweep)

History:
- qa: opened
- qa: CLOSED (retested on the DEV build v1.10.0, dist rebuilt 5/09 6:20PM after the fix source; launchApp with no executablePath; new spec e2e/retests/def_173_verify_1.10.0.spec.cjs, 1/1 green in 12.3s; developer unit test defDEF173_highlightTranslucent 3/3 green via vitest run; fix rule present in the built bundle dist/renderer/assets/index-Deyu2awk.css). (1) PRIMARY REPRO FIXED, same steps as the original repro: open report.pdf -> arm Highlight -> drag across the title "TFlex Technical Report" on page 1 -> committed rect computes fill-opacity 0.35 (was 1/opaque); mid-drag the .ann-preview rect already computes 0.35; engine record {kind:"highlight", page:1, color:"#e07a2d", content:"TFlex Technical Report"} identical to the original diagnostics. (2) VISUAL: screenshots/def-173-retest-page1.png - pale translucent wash, the title fully readable underneath; matches the saved-native-/Highlight look the Expected pinned. (3) CANVAS CONTROL: pixel-sampling the page canvas under the highlight bbox in-session returns ONLY white + black glyphs (zero orange), proving the wash comes solely from the SVG overlay at 0.35 (e2e/retests/def_173_reopen_diag.spec.cjs). (4) DISARM: highlight is a sticky tool - Escape never disarmed it (DocumentView.tsx:1618-1629 Escape only closes search; Toolbar.tsx:51 documents click-again-to-disarm); re-clicking the Highlight button disarms (activeTool null) and the committed rect stays 0.35. The original repro step "Press Escape to disarm" was a wrong premise in the Phase-16 sweep write-up, not a product behavior. (5) SAVE/REOPEN: Save As -> temp file re-parsed with pdf-lib contains the native /Highlight with /QuadPoints (8 numbers) and /Rect; reopen re-imports (engine kinds=[highlight]) and renders - functionally intact, nothing lost. (6) REGRESSION NOTE, NOT THIS DEF: the reopened render is much darker than in-session (canvas paints the baked /Highlight full-opacity - no /OP, no /AP - and the overlay draws it again at 0.35); measured and filed separately as DEF-174, so this entry closes for its titled in-session bug, which is fixed and verified.

## DEF-171: Signature manager ignores Escape - the dialog and its full-screen backdrop stay up, blocking every control behind them until the Close button is used

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the motion-system verification run of the standard e2e suite; reproduced on both the motion build and the pre-motion HEAD c6cd827, so it predates the motion chunks)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open a PDF (repro used assets/samples/report.pdf).
3. Click the "Sign" toolbar button (button[aria-label="Sign tool"]). The Signature manager opens (Draw/Type/Saved tabs) over a dimmed modal backdrop.
4. Press Escape and wait ~800ms.
5. Observe the screen, then try any control behind the dialog (e.g. the theme toggle in the title bar).

Expected: Escape dismisses the Signature manager (every other modal in the app closes on Escape - Insert pages, Merge, crop, etc.), and the workspace behind it becomes interactive again.

Actual: after Escape the dialog is still fully visible and interactive (computed check: .sig-manager present=true, .modal-backdrop present=true), and the full-screen backdrop intercepts all pointer events - Playwright retry-looped 56x for 30s on the theme toggle with "<div class=modal-backdrop> intercepts pointer events" (failure observed during the motion-phase verification run of the standard suite; the committed motion-phase artifact is e2e/motion_verify.spec.cjs - e2e/sweep_visual.spec.cjs itself is untracked). The ONLY way out is the dialog's own Close button: clicking it removes both the dialog and the backdrop (sigVisible=false, backdrop=false). Verified twice on the motion build (e2e/retests/def_171_173_diag.spec.cjs [D1], untracked qa artifact: after Escape {"sigVisible":true,"backdrop":true}; after Close {"sigVisible":false,"backdrop":false}) and the same sweep_visual failure exists on pre-motion HEAD.

Screenshot: screenshots/def-171-sign-escape.png (Signature dialog still open over the dimmed workspace after Escape was pressed)

History:
- qa: opened
- qa: CLOSED (retested on the DEV build v1.9.0, commit e3673fd "motion system, DEF-171 escape fix", dist rebuilt 5/09 12:52AM after the fix source; launchApp with no executablePath; new spec e2e/retests/def_171_escape_retest_190.spec.cjs). (1) PRIMARY REPRO FIXED: open report.pdf -> Sign tool -> Escape on the Draw tab -> after 800ms {"sigVisible":false,"backdrop":false} (was sigVisible=true, backdrop=true) - screenshots/def-171-retest-open-before-escape.png (dialog over dimmed backdrop) and screenshots/def-171-retest-escape-closed.png (clean interactive workspace after Escape). (2) THE ORIGINAL HARM GONE: after Escape the theme toggle click lands - theme flips dark->light with zero Playwright retries (previously 56x "intercepts pointer events"), then toggled back. (3) ALL TABS: Escape with focus INSIDE the Type input (name typed first) closes dialog+backdrop; Escape on the Saved tab closes dialog+backdrop - matching the committed unit test test/unit/renderer/defDEF171_signatureManagerEscape.test.tsx (4/4 green via vitest run: draw canvas / type input / saved tab / window-level dispatch). (4) CLOSE-BUTTON REGRESSION: the dialog's own Close button (the pre-fix only exit) still closes both. (5) NO CROSS-TALK: the Insert pages dialog still Escape-closes normally right after using the signature manager; window-level keydown fires only while the sig manager is open (removed on unmount). Fix inspected in source: SignatureManagerModal.tsx adds a window keydown listener while open (preventDefault + onClose), mirroring the other dialogs' Escape wiring.
- qa: REGRESSION NOTE (not this fix): e2e/sweep_annotations_sign.spec.cjs ran 1/5 against the INSTALLED app - root-caused as the OTA update prompt (installed v1.8.0 detects the newly shipped v1.9.0 and opens the modal UpdatePromptDialog whose full-screen .sheet-backdrop intercepts pointer events; the sweeps never dismiss it). Not a DEF-171 regression: the installed 1.8.0 predates the fix, and S2 (signature place/move/save/reopen lifecycle on the installed app) passed. Filed as DEF-172; evidence e2e/retests/diag_installed_sheet_190.spec.cjs + screenshots/diag-installed-sheet-backdrop.png.

## DEF-172: Standard e2e sweeps targeting the INSTALLED app fail whenever a newer version is published - the OTA update prompt's full-screen backdrop intercepts every pointer event and the sweeps never dismiss it

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 16 (hit while regression-testing the DEF-171 fix; the trigger is the v1.9.0 release itself - the installed v1.8.0 pops the update prompt mid-run)

Steps to reproduce:
1. Have the installed app at v1.8.0 (%LOCALAPPDATA%\Programs\tflex\TFlex.exe) while a newer release v1.9.0 exists in the OTA channel.
2. Run npm.cmd run test:e2e -- e2e/sweep_annotations_sign.spec.cjs (or any sweep that launches the installed app via helpers.cjs launchInstalled).
3. Within ~3s of launch the app shows "Update available - Update to v1.9.0 is available..." (UpdatePromptDialog, .sheet-backdrop full-screen, aria-modal).

Expected: the sweep specs handle this legitimate app state (dismiss the prompt, e.g. press Escape or click Cancel) and run to green; a published update should not break the standard suite.

Actual: 4 of 5 tests fail with Playwright retry-looping 30s on the first click of the test body: "<div tabindex=-1 role=presentation class=sheet-backdrop> intercepts pointer events" (A1 rect arm, A2 pen arm, A3 rail tab, S1 sig action bar). S2 still passed. Root cause confirmed by a read-only probe: e2e/retests/diag_installed_sheet_190.spec.cjs reports the sheet {"sheetClass":"sheet sheet-update-prompt","text":"Update availableUpdate to v1.9.0 is available..."} within 3s of launch - screenshots/diag-installed-sheet-backdrop.png. The prompt itself is by-design modal (UpdatePromptDialog.tsx: aria-modal=true, .sheet-backdrop position:fixed inset:0 z-index:100, closes on Escape/backdrop-click), so the product behavior is correct - this is a qa-suite gap: helpers.cjs/sweep specs must dismiss the update prompt after launch (and the suite will keep breaking on every future release until they do). Minor observation folded in: the sheet copy "you can keep working while it does" clashes with the modal backdrop (the download does run in the background, but the UI blocks until dismissed) - cosmetic. Transient mitigation: install v1.9.0 (no newer release = no prompt), or qa adds a dismissUpdatePrompt step to the sweeps.

Screenshot: screenshots/diag-installed-sheet-backdrop.png

History:
- qa: opened (found during the DEF-171 close regression run; 4 failures on sweep_annotations_sign against installed v1.8.0 root-caused to the update prompt, not to the v1.9.0 code changes)
- qa: re-verified OPEN (bug sweep 2026-09-12): the qa-suite gap is unchanged — e2e/lib/helpers.cjs still has no update-prompt dismissal step, and the version gap that triggers the prompt still exists (installed app ProductVersion 1.12.1 vs the v1.13.0 repo/OTA channel), so any sweep run against the installed exe would hit the same full-screen sheet backdrop mid-run. Not re-triggered live in this sweep (standard suite runs the dev build); the mitigation options from the filing (dismissUpdatePrompt step in the sweeps, or matching the installed version) are still unimplemented.
- qa: CLOSED (test-infrastructure fix, 2026-09-13). (1) FIX: e2e/lib/helpers.cjs gains dismissUpdatePrompt(window, timeoutMs=20000) - polls for the prompt ([data-update-prompt] / .sheet-update-prompt, falling back to a .sheet-backdrop whose .sheet-title is exactly "Update available"/"Restart to update"), dismisses via the dialog's Cancel/Later/OK button, then Escape, then the sheet X (fail-loud if it survives all three), and returns false without throwing when no prompt appears; it fast-exits via window.tflex.update.getStatus() once the state is up-to-date/error/unsupported so an up-to-date installed launch pays ~0ms instead of the full poll window. launchInstalled() now calls it after the .sample-card wait, so every installed-app launch is sweep-safe by construction. (2) The exact live repro (newer release published) is not triggerable today (installed v1.13.1 == channel latest; the public releases API returned 404), so the dismiss path was proven against the REAL installed app with the exact UpdatePromptDialog DOM mounted live (.sheet-backdrop + .sheet.sheet-update-prompt, "Update available" title, data-update-prompt-cancel with a working onClose): elementFromPoint at the viewport center landed inside the backdrop (the DEF-172 harm), dismissUpdatePrompt detected it in 1-2ms and dismissed it in 32-169ms, and a real .sample-card click then landed and opened the workspace (375-1091ms). (3) REGRESSION SPEC e2e/installed/def_172_update_prompt_dismiss.spec.cjs (installed config only): 5/5 green (A: no-prompt run exits in 5-11ms with no backdrop; B: dismiss + control-returned proof; the spec polls the interception proof because the app restores window geometry right after launch, which briefly skews elementFromPoint). (4) Callers updated: launchInstalled (wired in), e2e/installed/installed_verification.spec.cjs beforeEach, e2e/installed/installed-app-test.spec.cjs beforeAll; ota_bug9_live and the diag_installed_sheet_190 probe deliberately NOT updated (they exist to observe the prompt itself). Residual watch: when the next release ships, the first installed-app sweep is the real-prompt confirmation; if it still trips, reopen with those steps.

## DEF-170: A SECOND Extract in the same session orphans its result document - success toast, but no tab opens and the app refocuses the OLD extraction tab (still showing the old doc)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (found during the DEF-167 close retest on the dev build; the extract translation itself (DEF-167) is correct - this is the tab/result handling around it)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open a multi-page PDF whose pages are visually distinguishable (repro used test-fixtures/marker-3pages.pdf: three pages rendering MARKER-PAGE-1 / 2 / 3).
3. Tools palette -> "Split pages" (Extract is the default mode), enter "3", click Extract. This works: a new tab "marker-3pages.pdf - page 3" opens, active, showing MARKER-PAGE-3 (DEF-167 fixed).
4. Switch back to the SOURCE tab ("marker-3pages.pdf", no "- page N" suffix; note tabs activate on mousedown - a synthetic .click() does not switch).
5. Tools palette -> "Split pages" again, enter "1", click Extract.

Expected: a THIRD tab "marker-3pages.pdf - page 1" opens, active, showing MARKER-PAGE-1, matching the "Extracted 1 page to a new document." toast.

Actual: the toast IS fresh and correct (proven: no toast present at +600ms after confirm, "Extracted 1 page to a new document." at +3.1s - so the engine extraction really ran), but NO third tab ever appears (tab count stays 2, .tab-pane count stays 2). The app instead refocuses the PREVIOUS extraction tab "marker-3pages.pdf - page 3", whose content is still the OLD document (MARKER-PAGE-3). The newly extracted page-1 document is orphaned - unreachable from any UI surface - while the user is looking at the WRONG document with the requested page number in the toast. From the user's seat this masquerades as the old DEF-167 wrong-page bug (asked for page 1, see page 3). Recovery: closing the stale extraction tab ("Don't save" on its close prompt - the orphan is not saved anywhere) makes the next Extract work again (verified: extract "2" then opens tab "- page 2" with MARKER-PAGE-2). Repro + characterization script: e2e/retests/def167_probe_extract3.spec.cjs (sequences A fresh extract OK / B orphan / C recovery after close; its sequence-B expectation is red by design until this is fixed).

Screenshot: screenshots/def-170-repro-second-extract-orphan.png (success toast bottom-right while the focused tab is the OLD "- page 3" doc showing MARKER-PAGE-3; only two tabs), screenshots/def-167-probe-extract3-fresh.png (sequence A: fresh extract of page 3 lands correctly), screenshots/def-167-probe-extract-after-close.png (sequence C recovery)

History:
- qa: opened (found while retesting DEF-167: every SECOND extract in a session drops its result tab, independent of which page was extracted - main-spec flow extract("1") then extract("3") and probe flow extract("3") then extract("1") both orphan the second result)
- qa: CLOSED (retested on the DEV build after rebuilding dist from current source via npm.cmd run build; launchApp with no executablePath; new spec e2e/retests/def170_verify_devbuild.spec.cjs). Root cause of the fix: openEngineBytesAsTab (App.tsx) now passes dedupePath:false so the tabs reducer's same-path dedupe branch (tabs.ts, `action.dedupePath !== false`) does not collapse the second extract result onto the first (both share the synthetic `<extract>marker-3pages.pdf` path); bundle check: dist renderer carries both `dedupePath:!1` at the call site and the `t.dedupePath!==!1` guard. (1) SECOND EXTRACT OPENS ITS TAB: extract("3") -> tab "marker-3pages.pdf — page 3" active MARKER-PAGE-3; back to source; extract("1") -> a THIRD tab "marker-3pages.pdf — page 1" (own fresh UUID) opens and is ACTIVE showing MARKER-PAGE-1 with its own fresh "Extracted 1 page to a new document." toast - no orphan, no refocus of the old result tab (screenshots/def-170-retest-second-extract-tab.png). (2) EACH TAB OWNS ITS DOC: activating "— page 3" shows MARKER-PAGE-3, activating "— page 1" shows MARKER-PAGE-1, distinct data-tab-ids (screenshots/def-170-retest-page3-tab-own-doc.png, def-170-retest-page1-tab-own-doc.png); a third extract("2") lands a fourth tab "— page 2" active MARKER-PAGE-2 (def-170-retest-third-extract.png). (3) REGRESSION: e2e/retests/def167_probe_extract3.spec.cjs now passes all three sequences (A fresh extract, B the formerly-orphaning second extract, C recovery after close; its sequence-B expectation was red-by-design for this bug and sequence C's tab-count expectation was written against the DEFECTED world where B opened no tab - updated 2->3 with a comment when the fix landed, C's actual contract "fresh extract after closing the old result tab still lands its own active tab" unchanged and green). e2e/retests/def_167_168_169_verify_devbuild.spec.cjs 3/3 green (DEF-167 extract off-by-one still fixed), test/unit/renderer/tabs.test.ts 25/25 green incl. the two DEF-170 reducer unit tests.

## DEF-167: Extract pages delivers the WRONG page (off by one) and rejects any range touching the last page - 1-based dialog numbers reach the 0-based engine untranslated

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (found during the dev-build visual-overhaul e2e run; the offending code predates the redesign - engineClient.ts last modified 3/09, before the 2:44 PM source landing)

Steps to reproduce:
1. Launch TFlex (dev build; the code path exists in any build carrying engineClient.ts without the extract translation).
2. Open a PDF whose pages are visually distinguishable (repro used test-fixtures/marker-3pages.pdf: three pages rendering the text MARKER-PAGE-1 / 2 / 3).
3. Open the Tools palette, click "Split pages" (the Extract/Split dialog; Extract is the default mode).
4. Enter page "1", click Extract.

Expected: the new document contains page 1 (its own tab title even says "marker-3pages.pdf - page 1").

Actual: the new document contains PAGE 2 - the page shows "MARKER-PAGE-2" while the tab is titled "- page 1" and the success toast reads "Extracted 1 page to a new document." (screenshots/def-167-extract-1-lands-page-2.png). The wrong page arrives silently: no warning, and the title/toast assert the requested page. Additionally, any range that includes the LAST page fails outright: entering "3" (of 3) yields the error toast "Engine error: extract page 3 out of bounds for 3 pages" (observed on report.pdf as "extract page 34 out of bounds for 34 pages" during the full_retest run), because the 1-based number equals the 0-based bound.

Root cause: the SplitDialog's parsePageRange returns 1-based page numbers (validated 1..totalPages), and App.tsx onConfirmSplit passes them straight to engine.extract. The engineClient wrapper translates 1-based -> 0-based for split (src/renderer/engine/engineClient.ts:772-781, "The renderer-facing API is 1-based, so translate here") but NOT for extract (src/renderer/engine/engineClient.ts:783-788, raw pass-through). The main-process EngineService.extract indexes doc.order[p] with 0-based semantics and validates p >= surviving (src/main/services/engine.ts:625-630). Evidence: direct engine.extract calls with [3] and [1,2,3] on the 3-page fixture both return "extract page 3 out of bounds for 3 pages" while [0]/[1]/[2] succeed; the UI path with "1" produces page 2.

Fix direction: translate in engineClient.extract the same way split does (pages.map(p => p - 1)), or make the engine contract explicitly 1-based with matching validation; add a regression e2e on marker-3pages.pdf asserting extract("1") renders MARKER-PAGE-1 and extract("3") succeeds.

Screenshot: screenshots/def-167-extract-1-lands-page-2.png

History:
- qa: opened (proven on the dev build via e2e/probe_place_dev.spec.cjs probes 8-12 + the full_retest DEF-012 run's out-of-bounds toast; wrong-page result reproduced twice with the marker fixture)
- qa: CLOSED (retested on the DEV build, launchApp with no executablePath, after rebuilding dist from the current source - the old 2:48 PM dist predated the fix and was stale; e2e/retests/def_167_168_169_verify_devbuild.spec.cjs + e2e/retests/def167_probe_extract3.spec.cjs). (1) OFF-BY-ONE GONE: extract "1" of marker-3pages.pdf now opens tab "marker-3pages.pdf - page 1" (exact title) whose textLayer renders MARKER-PAGE-1 (was MARKER-PAGE-2) - screenshots/def-167-retest-extract-1.png. Bundle check: dist renderer carries the translation (minified `extract(e,t){return this.inner.extract(e,t.map(e=>e-1))}`). (2) LAST-PAGE ERROR GONE: extract "3" of 3 no longer errors - no "out of bounds" toast anywhere; on a FRESH session the extracted tab "marker-3pages.pdf - page 3" opens ACTIVE showing MARKER-PAGE-3 with the success toast (probe sequence A, screenshots/def-167-probe-extract3-fresh.png), and in the repeat-extract flow the "out of bounds" error is equally gone (toast reads success; the tab-opening gap of that repeat flow is a separate finding filed as DEF-170). Regression: extract("1") still lands page 1 after the sequence, and the DEF-167-suggested regression e2e exists (def_167_168_169_verify_devbuild.spec.cjs part 1 + probe spec).

## DEF-168: Radio buttons / checkboxes render browser-default BLUE instead of the orange accent

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (dev-build visual sweep, both themes)

Steps to reproduce:
1. Launch the dev build (dist at 2:48 PM with the orange redesign), open any PDF.
2. Tools palette -> Insert pages; look at the "What to insert" and "Page size" radio groups.

Expected: every interactive control uses the single orange accent (#E07A2D) - the spec's "single accent, no blue" rule; the blue is exactly the leftover default the visual overhaul was meant to remove.

Actual: the selected radio knob is browser-default BLUE (#2563eb-family) in both themes - visible on "Blank page" and "US Letter" in screenshots/visual-dev-dialog-light.png and screenshots/visual-dev-dialog-dark.png. Root cause: styles.css sets `accent-color: var(--accent)` only for the OCR dialog's range slider (.ocr-dialog .modal-range, line 6086); no global `input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); }` exists, so every other native radio/checkbox falls back to the browser default.

Screenshot: screenshots/visual-dev-dialog-light.png

History:
- qa: opened (visual sweep finding; cosmetic, both themes equally affected)
- qa: CLOSED (retested on the DEV build after the dist rebuild, e2e/retests/def_167_168_169_verify_devbuild.spec.cjs DEF-168 test). The fix is the global rule `input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); }` (styles.css:349-352, replacing the OCR-slider-only rule). All 6 native radios of the Insert pages dialog (2x "What to insert" / insert-mode, 4x "Page size" / blank-preset, checked and unchecked) report computed accent-color rgb(224, 122, 45) = #e07a2d = the --accent token, in BOTH themes (dark read with the dialog open; light read after Escape -> .theme-toggle -> reopen; the modal backdrop correctly blocks the header while open, so the theme must be switched between dialog sessions). --accent resolves #e07a2d in both themes; no blue (b > r) anywhere. Screenshots: screenshots/def-168-retest-insert-dialog-dark.png, screenshots/def-168-retest-insert-dialog-light.png (selected knobs visibly orange). Note for the record: the .form-radio / .form-checkbox page-overlay controls are custom-drawn from --accent tokens (styles.css:3714-3767) and were never affected.

## DEF-169: Modal backdrop does not dim the open Tools palette - the palette floats above the overlay at full brightness

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (dev-build visual sweep)

Steps to reproduce:
1. Launch the dev build, open any PDF.
2. Open the Tools palette, click "Insert pages" so the modal dialog opens.

Expected: the modal backdrop dims the whole app behind the dialog, so the dialog is the unambiguous focus layer.

Actual: the workspace, rail and page dim correctly, but the open Tools palette stays at full brightness ABOVE the backdrop (right side of the screen) - the palette's z-index sits over the modal overlay. Both themes show it: screenshots/visual-dev-dialog-dark.png and screenshots/visual-dev-dialog-light.png. Purely cosmetic layering inconsistency; no interaction fault observed.

Screenshot: screenshots/visual-dev-dialog-dark.png

History:
- qa: opened (visual sweep finding; cosmetic)
- qa: CLOSED (retested on the DEV build after the dist rebuild, e2e/retests/def_167_168_169_verify_devbuild.spec.cjs DEF-169 test). The frontend's read is confirmed: the palette was never above the backdrop. Measured with the palette open and the Insert pages modal up: palette z-index 30, .modal-backdrop z-index 800, backdrop rgba(0, 0, 0, 0.45) fixed inset:0; document.elementFromPoint at the palette's center returns the .modal-backdrop itself (the backdrop is the top element covering the palette - nothing of the palette pokes through). Pixel proof over the palette's own bounding rect (281x813 at x=1162): mean luminance 198 baseline (palette open, no modal) -> 27.4 under the modal (ratio 0.10, i.e. the 45% black backdrop plus the dark panel render dims the palette to a tenth). Visual: screenshots/def-169-retest-under-modal.png shows the right-side palette clearly dimmed behind the dialog (vs the un-dimmed baseline screenshots/def-169-retest-baseline.png). The original DEF-169 screenshots were evidently taken/staged before the backdrop painted over the palette region (or mis-cropped); the source z-order (palette 30 < backdrop 800) was already correct.

## DEF-166: Reopening a saved file renders annotation text DOUBLED (baked canvas AP + DOM overlay, offset fonts)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (installed v1.7.26; found during the DEF-164 close verification)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.26), open the report.pdf sample, go to page 4, commit a callout ("VERIFY CALLOUT 1726"), Save As, close the tab, reopen the saved file, go to page 4.

Expected: the reopened callout text reads as one crisp line.

Actual: the annotation text renders TWICE slightly offset: TFlex draws its DOM overlay text (Inter ~13px) and pdf.js also renders the baked FreeText appearance into the page canvas (12pt Helvetica from /DA; the file has no /AP stream, so the viewer generates the appearance) on top of each other - "VERIFY CALLOUT 1726" plus a lighter ghost copy (screenshot def-164-1726-reopened-callout-crop.png). Pre-existing dual render: in v1.7.25 the same canvas AP painted ~129px away from the box as the DEF-164 stray; after the DEF-164 coordinate fix the two renders now coincide, which makes the doubling visible as a blur/ghost instead of a stray line. Same doubling visible on the committed textbox after reopen (def-164-1726-reopened.png). Positions are correct (this is purely a render-fidelity artifact); fix direction: suppress one of the two renders when the saved annotation's own appearance is already displayed.

Screenshot: screenshots/def-164-1726-reopened-callout-crop.png

History:
- qa: opened (visual observation during the DEF-164 close verification on v1.7.26; LOW, cosmetic, reopen-of-saved-file only - the committed state renders single and clean)
- qa: FIX-READY retest FAILED on installed v1.7.27 (app.getVersion 1.7.27, e2e/retests/def_165_166_verify_1.7.27.spec.cjs + e2e/retests/def_166_canvas_extract_1727.spec.cjs). One real improvement: the reopened tab's DOM overlay no longer carries the text (the overlay divs are now empty, html:"" - the v1.7.26 DOM source is gone; def-166-1727-diag evidence). But the doubling is NOT fixed - it moved into the page CANVAS: TFlex's single pdf-page canvas now carries the annotation text TWICE. Extracted canvas crops (no DOM involved): def-166-1727-tflex-canvas-textbox.png shows "VERIFY TB 1727" as two offset interleaved copies, def-166-1727-tflex-canvas-callout.png shows "VERIFY CALLOUT 1727" doubled ("YERYEY CALL OUT 11737"). Third-party proof the FILE is fine: plain pdf.js in real Chromium renders the same saved file's textbox and callout text exactly ONCE (def-166-chromium-textbox-crop.png, def-166-chromium-callout-crop.png; saved /FreeText still has no /AP - DA="/Helv 12 Tf" - so viewers generate one appearance). So both copies are painted by TFlex's own reopen path into the one canvas (its own text draw plus pdf.js's /DA-generated appearance, offset by the font-metric difference). Round-trip position 0.0px; committed state renders single and clean (unchanged). Saved artifact: test-fixtures/annot-text-roundtrip-1727.pdf. Status stays OPEN - in-app reopen still shows doubled/offset text.
- qa: CLOSED (retested on installed v1.7.28 = app.getVersion 1.7.28, e2e/retests/def_165_166_verify_1.7.28.spec.cjs, real mouse). Callout "VERIFY CALLOUT 1728" + textbox "VERIFY TB 1728" committed on page 4 of report.pdf, Save As, close tab, reopen, page 4. (1) SINGLE RENDER SOURCE: the reopened tab's DOM overlay carries NO text (probe: runs=[], paintedWithMarker=false for both kinds) while the page canvas paints the annotation text exactly once - the text now lives in an explicit /AP /N stream baked INTO the saved file (raw pdf-lib dump, e2e/retests/def_166_1728_dict_diag.cjs: callout /AP /N = "q BT /Helv 4 Tf ... rg 1 0 0 1 438.394 453.985 Tm <564552494659> Tj ... ET Q", textbox /Helv 5.259 - the v1.7.26/27 /DA-only file that made every viewer GENERATE its own appearance is gone). (2) THIRD-PARTY WITNESS, same file same scale: plain pdfjs-dist renders the reopened file's callout and textbox regions IDENTICAL to TFlex's own canvas - control crops def-166-1728-pdfjs-control-{callout,textbox}.png vs TFlex canvas crops def-166-1728-tflex-canvas-{callout,textbox}.png are visually the same single-rendered text; self-shift-overlap doubling detector (1..6px shift set, def_166_canvas_witness_1728.cjs at the true page scale 1.8889 px/pt): TFlex canvas maxSelfOverlap 0.675 (callout) / 0.717 (textbox) vs pdf.js single-render control 0.666 / 0.683 - within +0.01/+0.03 of single-render, nowhere near the v1.7.27 interleaved-copy signature. The v1.7.27 doubling is gone. (3) ROUND-TRIP: positions 0.0px both kinds; raw /Rect math still bottom-left EXACT (callout [431.89, 438.28, 521.89, 464.48] + /Callout anchor end (336.60, 522.72) = 792-269.28, dy=0; textbox [110.16, 575.72, 207.52, 601.92]; dlly=dury=0, oldBugSignature=false) - DEF-164 regression green. (4) Third-party scale-2 crops of the SAVED file (def-166-1728-diag-saved-FreeText-{0,1}-scale2.png) show each text once, correctly positioned. Saved artifact preserved: test-fixtures/annot-text-roundtrip-1728.pdf. No pageerrors.

## DEF-165: Saved shapes bake the 10%-alpha overlay fill as a SOLID /IC interior color - third-party viewers render an opaque blue block hiding the page content behind the shape

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15 (installed v1.7.26; found during the DEF-164 verification's visual review)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.26), open the report.pdf sample, go to page 4.
2. Arm the Rectangle tool, drag a ~120x70 screen px rect over body text: the committed overlay shows a blue 1.5px border with a 10% tint (computed style fill = rgba(37, 99, 235, 0.1)); the page text under the rect stays readable.
3. Save As to a temp file, close the tab, reopen the saved file (or open it in Acrobat / Chrome / any pdf.js viewer), go to page 4.

Expected: the saved shape looks like what the user placed - stroked border with a ~10% alpha interior.

Actual: the bake drops the overlay's alpha and writes /IC [0.145, 0.388, 0.922] = #2563eb SOLID on the /Square dict (no /AP stream), so pdf.js and Acrobat paint the interior OPAQUE blue: TFlex's own reopened tab shows a solid blue block covering the body text (screenshots/def-164-rect-committed-crop.png vs def-164-rect-reopened-crop.png), and every third-party viewer does the same. Verified for Circle too (e2e/retests/def_164_circle_ic_diag.spec.cjs: DOM fill rgba(37,99,235,0.1) -> baked /Circle /IC = solid #2563eb). Textbox/callout backgrounds have the inverse gap (10% tint in-app, transparent in third parties) - same lost-alpha root cause, cosmetic there. Fix direction: omit /IC when the shape fill alpha < 1 (or emit an /AP stream that reproduces the alpha via an ExtGState /ca).

Screenshot: screenshots/def-164-rect-reopened-crop.png

History:
- qa: opened (found during the DEF-164 close verification on v1.7.26 - the DEF-164 coordinate flip itself verified correct; the shape fill alpha is a separate save-path gap, likely pre-existing)
- qa: FIX-READY retest FAILED on installed v1.7.27 (app.getVersion 1.7.27, e2e/retests/def_165_166_verify_1.7.27.spec.cjs + e2e/retests/def_165_166_thirdparty.cjs third-party witness). The bake took the right direction - the saved /Square and /Circle now carry an /AP /N appearance stream and /IC is omitted (/IC=null on both) - but the 10% alpha is written as an INLINE content-stream token "0.1 ca 1 CA" inside the /N stream, which is not a valid PDF operator: fill/stroke alpha may only be set through an ExtGState resource invoked with the gs operator. The /AP /Resources /ExtGState dict is absent (gsEntries=[]), so pdf.js ignores the inline token and paints the fill at FULL alpha. Third-party witness on the saved file (pdfjs-dist 4.10.38 render, Node): rect interior opaqueBlueFrac=1.00 textKeptFrac=0.00 meanAbsDiff=127.25; ellipse opaqueBlueFrac=1.00 textKeptFrac=0.00 - the interior is a solid opaque blue block hiding the page text (def-165-thirdparty-saved-rect-interior.png = solid blue vs def-165-thirdparty-baseline-rect-interior.png = pristine page text "orchest/key to r" visible). pdf.js operator-list witness: both annotation-blue fill ops run under ca=1 (v1.7.26's exact bug signature). TFlex's own reopened tab shows the same solid block (in-app canvas interior 100% near-blue). DEF-164 regression still green on this save path: /Rect bottom-left EXACT for both shapes (rect [48.96,343.10,112.49,380.16] = 792-411.84-37.06/792-411.84; ellipse [208.08,348.40,266.32,380.16]). Saved artifact preserved: test-fixtures/annot-shape-alpha-roundtrip-1727.pdf. Fix direction: declare /ca 0.1 in an ExtGState dict under the /AP /N /Resources (e.g. /G1 << /Type /ExtGState /ca 0.1 /CA 1 >>) and invoke "/G1 gs" before the fill in the /N content stream - keep /IC omitted. Status stays OPEN.
- qa: CLOSED (retested on installed v1.7.28 = app.getVersion 1.7.28, e2e/retests/def_165_166_verify_1.7.28.spec.cjs, real mouse). Rect + ellipse committed over body text on page 4 of report.pdf (committed DOM fill rgba(37,99,235,0.1) both), Save As, then verified at every level. (1) DICT: the saved /Square and /Circle /AP /N streams now declare the alpha PROPERLY - /Resources /ExtGState << /G1 << /ca 0.1 /CA 1 >> >> invoked as "/G1 gs" inside the /N content stream before the fill ("q ... rg ... RG /G1 gs 1.5 w ... re B Q"), /IC=null, and the v1.7.27 invalid inline "0.1 ca" token is GONE (inlineCaToken=false both shapes). (2) pdf.js OPERATOR LIST with paint-time ca attribution (validated on the 1727 fixture = paints ca=1, caught; 1728 = paints ca=0.1): both shapes' blue fillStroke ops PAINT under ExtGState ca=0.1. (3) THIRD-PARTY PIXELS (pdfjs-dist render, Node, def_165_166_thirdparty_1728.cjs): rect interior opaqueBlueFrac=0 (was 1.00), textKeptFrac=1.00 (was 0.00), meanAbsDiff=12.3 (was 127); ellipse opaqueBlueFrac=0, textKeptFrac=1.00, meanAbsDiff=11.89 - the interior is translucent, the page text behind both shapes stays visible in a third-party view (def-165-1728-thirdparty-saved-rect-interior.png vs baseline; both bbox near-blue ink deltas 433/613 = the 1.5pt border painted). (4) IN-APP reopen: interior near-blue 1.0%/2.5% (was 100%), round-trip positions 0.0px both kinds. (5) DEF-164 regression: raw /Rect bottom-left EXACT (rect [48.96,343.10,112.49,380.16], ellipse [208.08,348.40,266.32,380.16]; dlly=dury=0, oldBugSignature=false). Saved artifact preserved: test-fixtures/annot-shape-alpha-roundtrip-1728.pdf. Note for the record: the v1.7.27 spec's opl scanner attributed the ca value BEFORE the gs call to the rg token (the blue rg legally precedes "/G1 gs" inside the same q..Q block, but painting happens at B after gs) - a scanner artifact, fixed this round with paint-time attribution; the 1.7.27 pixel evidence (opaqueBlueFrac=1.00) independently confirmed the real bug then. No pageerrors.

## DEF-164: Saved annotations bake /Rect (and /Callout) in TOP-DOWN coordinates - every kind lands ~69pt lower (and the callout anchor mirrored) in any third-party viewer

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15 (installed v1.7.25; caught by the DEF-160/161/162 verification's save+reopen checks)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.25), open the report.pdf sample, go to page 4.
2. Commit a callout ("VERIFY CALLOUT 1725"), move its box +120/+70 and its arrow anchor +100/+60, Confirm, Save As to a temp file.
3. Parse the saved file: pdfjs `page.getAnnotations()` on page 4 + pdf-lib raw dict dump (e2e/retests/def_161_bake_diag.cjs, def_161_bake_raw.cjs), then render it in any spec-conforming consumer.
4. Re-open the saved file in TFlex and scan the page canvas for annotation-blue pixels (e2e/retests/def_161_canvas_diag.spec.cjs).

Expected: /Rect and /Callout carry PDF user-space coordinates (origin bottom-left, y up): for the moved callout box (engine top-down y 348.73pt) /Rect y should be 417.07..443.27.

Actual: TFlex writes the engine's renderer (top-down) y values verbatim into PDF space: FreeTextCallout /Rect [495.42, 348.73, 585.42, 374.93] (69pt too low) and /Callout anchor [.., 389.54, 285.20] (should be ~506.8 bottom-up - mirrored). The SAME flip on every kind: note /Text /Rect [201.81, 147.98, ...] (should be 620.02..644.02 - ~472pt too low), textbox /FreeText /Rect [201.81, 171.74, ...], Square /Rect [110.84, 264.11, ...], Circle /Rect [282.20, 264.11, ...]. TFlex itself reopens these correctly ONLY because `annotationFromWire` repeats the same flip, so the double error cancels in-app - but the page canvas render proves the file is wrong: the generated FreeText appearance (blue "VERIFY CALLOUT 1725") paints at page-local y 785-835 (exactly the baked /Rect: 792-374.93=417.07pt * 1.889 = 788px) while the app's overlay box sits at 658.7 - a stray blue text line 129px below the box, visible in every reopened saved file (screenshots/def-161-1725-reopened-stray-text.png, def-161-1725-canvas-scan.png). In Acrobat/Chrome/pdf.js every annotation of the saved file renders ~69pt (note: ~472pt) lower than the user placed it, and the callout leader points to a vertically mirrored anchor. Content is NOT lost (all /Contents intact) - the geometry in the file is wrong for every non-TFlex consumer. Fix direction: convert to user space on bake (y_pdf = pageHeight - y_topdown - h for /Rect; pageHeight - y for points) and mirror the conversion on read (keeping the in-app round-trip stable). Fixture: test-fixtures/callout-rect-yflip-bake.pdf.

History:
- qa: opened (verification of DEF-160/161/162 on v1.7.25: save+reopen in-app passed, but the raw saved file carries the flipped /Rect on all five annotation kinds; in-app misplacement visible as the stray canvas-rendered blue text in the reopened tab; pre-existing save-path bug, not introduced by this fix round)
- qa: CLOSED (retested on installed v1.7.26 = app.getVersion 1.7.26, e2e/retests/def_163_164_verify_1.7.26.spec.cjs, real mouse). Note + textbox + callout + rect committed on page 4 of report.pdf, Save As, raw /Annots parsed with pdf-lib on the SAVED file - ALL FOUR kinds carry exact bottom-left values (dlly=0, dury=0, oldBugSignature=false): note /Text /Rect [110.16, 688.80, 134.16, 712.80] (= 792-79.20-24 / 792-79.20 for engine top-down y=79.20 h=24); textbox /FreeText [110.16, 575.72, 207.52, 601.92] (= 792-190.08-26.20 / 792-190.08); callout /FreeText /Rect [431.89, 438.28, 521.89, 464.48] (= 792-327.52-26.20 / 792-327.52) AND /Callout anchor end (336.60, 522.72) = 792-269.28 (v1.7.25 mirrored this as 269.28); Square /Rect [48.96, 343.10, 112.49, 380.16] (= 792-411.84-37.06 / 792-411.84). Third-party witness: pdf.js page.getAnnotations() on the same file returns the same bottom-up rects (e2e/retests/def_161_bake_diag.cjs). TFlex round-trip: all four kinds reopened at page-local distance 0.0px from the pre-save positions (note 208.1,149.6 / textbox 208.1,359 / callout 815.8,618.6 / rect 92.5,777.9), reopened engine re-parses to the same top-down values. Canvas baseline diff (pre-save page-content bands vs reopened canvas bands): zero stray bands - the baked appearances land exactly under their overlays (callout band 607-654 grew 494->772px AT the overlay, rect band 764-862 at the overlay; the v1.7.25 stray ~129px below the box is gone). Screenshots: def-164-1726-committed.png, def-164-1726-reopened.png, def-164-1726-reopened-callout-crop.png, def-164-1726-canvas-scan.png. Saved artifact preserved as test-fixtures/annot-rect-bottomleft-roundtrip-1726.pdf. Residual observations filed separately: DEF-165 (shape /IC solid fill vs the 10% overlay tint), DEF-166 (doubled AP+overlay text on reopen). No pageerrors.

## DEF-163: Committed callout: text longer than the created box overflows and paints over the page content (fixed-height box, no auto-grow)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (installed v1.7.25)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.25), open the report.pdf sample, scroll to page 4.
2. Arm the Callout tool, drag anchor -> box (~180x110 screen px), type "VERIFY CALLOUT 1725", click Confirm.
3. Look at the committed callout.

Expected: the committed callout box grows with its text (or the text stays contained within the box).

Actual: the box keeps its creation size (170x49.5 px) and the text wraps to 3 lines at the box's font size: only "VERIFY" renders inside the box; "CALLOUT" and "1725" render BELOW the box, overlapping the page's body text. Present at COMMIT time (before any move) and identical after save+reopen. Short texts fit fine ("SWATCH CO" on 2 lines - V5). Root cause direction: the committed callout div takes its height from the creation rect with overflow visible - no auto-grow to fit the text. Likely pre-existing (the DEF-160 repro on v1.7.24 already described "moved callout text ghosting outside the box"); surfaced during the v1.7.25 verification's visual review. Screenshots: def-160-1725-v4-callout-committed.png (3-line spill at commit), def-160-1725-v4-after-confirm-crop.png.

History:
- qa: opened (observed during the DEF-161 move+confirm verification; separate from the tear/revert DEF-161 fixed - the geometry and text content persist correctly)
- qa: CLOSED (retested on installed v1.7.26 = app.getVersion 1.7.26, e2e/retests/def_163_164_verify_1.7.26.spec.cjs, real mouse). The fix is SHRINK-TO-FIT. Long text (288 chars incl. head marker LONGTEXT1726 and tail "tail 42.") in a callout created at 170x49.5px (90x26.2pt): the committed box keeps its created size and the font auto-shrinks (measured fontSize 4px at 189% zoom, ~7 wrapped tiny lines), ALL text inside the box: overBottom=0px, overRight=0px, clipped=0px, full 288/288 chars present - nothing paints over the page content, and nothing is clipped away. TEXTBOX: the committed box auto-grows WIDTH (172 -> 604.4px) and fits the whole text on one tiny line inside it (same 0/0/0 containment, full text). Both hold after Save As + close tab + reopen (0/0/0, text intact - the baked box carries the fitted geometry). SHORT controls regressed nothing: "SHORT 1726" callout and "SHORT TB 1726" textbox fit at normal font with 0/0/0. Screenshots: def-163-1726-long-committed.png, def-163-1726-long-callout-crop.png, def-163-1726-long-textbox-crop.png, def-163-1726-long-reopened.png, def-163-1726-reopen-callout-crop.png, def-163-1726-control-callout.png, def-163-1726-control-textbox.png. Observation for the orchestrator (not a defect against the stated expected outcome "text stays contained within the box"): the chosen resolution shrinks the font to ~4px screen (~2pt) instead of growing the box - contained but very small; grow-the-box would be the more readable behavior if the operator prefers it. No pageerrors.

## DEF-160: Move + Confirm on a committed textbox / rect / ellipse silently REVERTS the move (content snaps back to the old position)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe, FileVersion 1.7.24).
2. Open the report.pdf sample, scroll to page 4.
3. Arm the annotation Text-box tool, click the page, type "MOVE ME TB-42", click Confirm. The committed textbox renders at, say, screen (479, 314).
4. Arm the Select tool, press the textbox, drag it ~150px right / ~100px down (the box follows the cursor LIVE — verified), release. The selection bar shows Confirm / Edit / Delete.
5. Click Confirm.

Expected: The textbox commits at the NEW position (the delete + re-create with moved geometry the overlay performs on Confirm).

Actual: The textbox SNAPS BACK to its original position the moment Confirm is clicked. The DOM renders the box at the original rect, the engine state is byte-identical to the pre-move state (rects[0] = the ORIGINAL geometry), no toast, no error. The user's move is silently lost. Measured (e2e/retests/qa_unified_1724_repro.spec.cjs T2/T5): before (479.2, 314.4) -> pending after drag (629.2, 414.4) -> after Confirm (479.2, 314.4); engine rects[0] unchanged (122.4, 118.8). Same revert reproduces for rect and ellipse (T5 matrix: confirmRender.atNewPosition=false, element back at the pre-move rect); save + reopen of a moved textbox keeps the OLD position too (T6). The edit-mode add-box and the edit-text run are NOT affected (T7: both persist the move). Root cause (code): the drag path `moveAnnotation` (src/renderer/annotations/geometry.ts) shifts only the renderer-native geometry key (`rect`, or `at` for note) on a SPREAD copy of the annotation — the stale wire-shape `rects[0]` array (added by the IPC round-trip's `annotationFromWire` backfill) stays on the object at its OLD position. `confirmPendingAnn` re-creates via `onCreate({...nextAnn})`; the backend's `normalizeAnnotationPayload` (src/main/services/annotations.ts) prefers `payload.rects` over `payload.rect` when both are present, so the annotation is re-created at the OLD rects[0] position. The fix must clear/rewrite the stale `rects` key when re-creating from a moved annotation (or make the backend prefer `rect` when both are present).

Screenshot: screenshots/def-160-t2-textbox-moved-pending.png (box at the new position pre-confirm), screenshots/def-160-t2-textbox-after-confirm.png (box snapped back to the original spot)

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T2 + T5 matrix: textbox/rect/ellipse revert on Confirm; note/arrow/ink keep the move in-session; add-box and text-run unaffected)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V1 + V2, real mouse). TEXTBOX: commit "VERIFY TB 1725" at screen (479.2, 314.4) -> select + press-drag +150/+100 -> pending DOM rect (629.2, 414.4) EXACT (live mid-drag too) -> Confirm -> STAYS (629.2, 414.4), no snap-back (1.7.24 reverted to 479.2, 314.4); engine rects[0] moved 122.4,118.8 -> 201.8,171.7 (the stale rects shadow that caused the revert is gone); Save As + close tab + reopen -> page-local (381.2, 324.4) IDENTICAL pre/post reopen. RECT + ELLIPSE: press-drag +140/+80 -> pending and post-Confirm both at the new position (before 317.4,508.9 -> after 457.4,588.9; ellipse 641.0,508.9 -> 781.0,588.9), engine rects moved for both; save+reopen keeps both at the moved rects (reopened rects == afterConfirm rects exactly, rect AND ellipse). Screenshots: def-160-1725-v1-textbox-{committed,moved-pending,after-confirm,reopened}.png + crops, def-160-1725-v2-{committed,rect-*,ellipse-*,reopened}.png. Regression: the sibling kinds of the same fix round all retested green - note (V3), callout separate moves + no-tear (V4), dblclick color swatches (V5), standalone-arrow shaft grab control (V4b). No pageerrors.

## DEF-161: Callout: after Move + Confirm the BOX snaps back but the ARROW keeps the moved anchor (callout tears apart; the saved PDF bakes the torn geometry)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.24), open the report.pdf sample, go to page 4.
2. Arm the Callout tool, drag from the anchor (page area) to the box position, type text, Confirm.
3. Arm Select, press the callout BOX, drag it ~140px right / ~90px down (box + arrow move together LIVE — correct), release.
4. Click Confirm on the selection bar.

Expected: The whole callout (box + leader arrow) commits at the moved position as one unit.

Actual: The box snaps BACK to its original rect while the arrow KEEPS the moved anchor — the leader line now points from the old box into empty page text ("torn apart"). Engine state confirms the split: the recreated callout carries rects[0] at the OLD box position but `at` at the NEW anchor. The saved PDF bakes the same torn geometry (/Rect from the stale rects[0], /Callout end from the moved at), so save + reopen keeps the torn state. Root cause: same stale-`rects` shadow as DEF-160 in the delete + re-create commit, compounded by `moveAnnotation` shifting `at` (anchor) but leaving `rects[0]` stale — the backend stores rects[0] (/Rect) and at (/Callout end) independently, so the two halves diverge. Additionally the callout's arrow svg is pointer-events:none with no hit line, so the arrow CANNOT be grabbed/moved separately from the box (pressing the shaft hits the textLayer span beneath) — the operator's requested "box and arrow movable separately" is not implemented; today they only move together during the drag, then tear apart on Confirm.

Screenshot: screenshots/def-160-t3-callout-after-confirm.png (box back at the original spot, arrow leader pointing at empty text, moved callout text ghosting outside the box)

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T3 + T5 callout rows; engine dump after confirm shows rects at old box + at at new anchor)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V4 + V5 + control V4b, real mouse). (1) ARROW MOVABLE SEPARATELY: hit-test at t=0.15/0.3/0.5/0.65/0.8 along the shaft lands on line.ann-callout-arrow-hit (pe=stroke, 10px) and at t=0.97 on polygon.ann-callout-arrow-head-hit - ALL inside the callout svg (was: textLayer fallthrough, cannot grab); a real shaft press-drag +100/+60 moves the ANCHOR alone (page-local 635.8,478.7 -> 735.8,538.7, exact drag delta; the box stays put) and the selection bar (Confirm annotation move / Edit / Delete) appears; Confirm keeps the moved anchor with the box unmoved. (2) BOX MOVABLE SEPARATELY: press-drag +120/+70 moves the box alone (1063.8,678.7 -> 1183.8,748.7, exact; anchor unmoved at 735.8,538.7). (3) CONFIRM PERSISTS WITHOUT TEARING: after both moves the leader is 233.2px from the moved box edge (entry distance to box 0px) to the moved anchor; engine rects[0] 431.9,311.7 -> 495.4,348.7 AND at 336.6,253.4 -> 389.5,285.2 - both fields carry the moved geometry (the stale-rects tear is gone). (4) SAVE+REOPEN: box page-local (935.8,658.7) and anchor (735.8,538.7) identical pre/post reopen, leader 233.2 intact. Screenshots: def-160-1725-v4-{callout-committed,anchor-moved-alone,anchor-move-confirmed,box-moved-alone,after-confirm,reopened}.png + crops. (5) OPERATOR FEATURE - dblclick toolboxes: committed TEXTBOX and CALLOUT double-click both open the editor (textarea + Confirm/Cancel/Delete) WITH the 9-color swatch row (yellow..gray) + custom hex input; picking teal moves the active swatch ring; Escape closes. Screenshots def-160-1725-v5-dblclk-{textbox,callout}*.png (V5). Side observation (not a defect): the hex field shows the pre-pick value until blur - the draft syncs on blur only. Control: the STANDALONE arrow's shaft grab still works (V4b: elementFromPoint = line.ann-arrow-hit, DOM + engine move). No pageerrors.

## DEF-162: Sticky note: the move survives Confirm in-session but is silently LOST on save (reopened note sits at the old anchor)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.24), open the report.pdf sample, go to page 4.
2. Arm the Sticky-note tool, click the page, type "NOTE MOVE PERSIST 88", Confirm.
3. Arm Select, press-drag the note icon ~150px right / ~100px down, click Confirm on the selection bar. The icon correctly renders at the new position in-session (unlike DEF-160 kinds).
4. Save As, close the tab, reopen the saved file, go to page 4.

Expected: The note persists at the moved anchor.

Actual: The reopened note sits at the PRE-MOVE anchor (before x=479 -> after-move x=629 -> reopened x=479). Root cause: `moveAnnotation` shifts the note's `at` anchor but the wire-shape `rects[0]` (the icon's 24x24 footprint, backfilled by `annotationFromWire`) stays at the OLD anchor; the backend bakes the note's /Rect from `ann.rects[0]` (stale), and on reopen `annotationFromWire` backfills `at` from `rects[0]` — the move never reaches the saved PDF. Same stale-`rects` root cause as DEF-160, surfacing on the save path instead of the confirm path (the note's in-session render reads `at`, so Confirm looks correct).

Screenshot: screenshots/def-160-t8-note-reopened.png

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T8: beforeX=479, afterMoveX=629, reopenedX=479)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V3, real mouse). Note "NOTE VERIFY 1725" committed at (479.2, 269.5) -> select + press-drag +150/+100 -> pending at the new position -> Confirm -> stays; Save As + close tab + reopen -> page-local (381.2, 279.5) IDENTICAL pre/post reopen (1.7.24 reopened at the PRE-MOVE anchor). Engine: after Confirm BOTH at AND rects[0] sit at the moved anchor (201.8, 148.0) - the stale rects[0] that used to win the bake is rewritten; the reopened engine shows the same values. Screenshots: def-160-1725-v3-note-{committed,moved-pending,after-confirm,reopened}.png + crops. No pageerrors.

## DEF-159: Dark mode: committed annotation text-box text is invisible (near-white on paper-white page)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe` — the app's default theme is dark; keep it).
2. Open the report.pdf SAMPLE card, scroll to page 3.
3. Arm the annotation "Text box" tool (T icon in the annotation toolbar), click the page, type "DARK BOX TEXT 42", click Confirm.
4. Look at the committed text box on the page; read its computed colors.

Expected: The committed box's text must be readable over the paper-white page in every theme (DEF-099 keeps pages white in dark mode too).

Actual: The committed `.ann-textbox` text renders `rgb(241, 245, 249)` (`--fg-strong`, near-white) over the white page (`rgb(255, 255, 255)` backdrop) — INVISIBLE. Root cause: `DomAnnotation`'s committed textbox div relies on the `.ann-textbox { color: var(--fg-strong) }` UI-theme token, which flips to near-white in dark mode while the surface it floats on stays paper-white. This is the committed-annotation counterpart of DEF-158 (note text) and DEF-157 (callout text).

Full dark-mode faint/invisible text inventory measured on v1.7.22 (effective color vs opaque backdrop):
| Surface | Color | Backdrop | Result |
| --- | --- | --- | --- |
| Committed sticky-note text (`.ann-note-text`) | rgb(241,245,249) | white page | INVISIBLE (DEF-158) |
| Committed annotation text box (`.ann-textbox`) | rgb(241,245,249) | white page | INVISIBLE (this entry) |
| Committed callout text (`.ann-callout`) | rgb(203,213,225) | white page | FAINT (DEF-157) |
| "Drag to move" grip label on hover (`.ann-textbox-grip:hover`) | rgb(241,245,249) | white page through rgba(255,255,255,0.04) tint | INVISIBLE (DEF-156) |
| Action-bar buttons (Confirm/Cancel/Delete) | var(--fg) | dark raised chip | visible — OK |
| Editor textareas | var(--fg-strong) | dark input bg | visible — OK |
Screenshot: screenshots/def-159-c-dark-inventory.png (page 3 with all three committed kinds in dark mode), screenshots/def-156-c-textbox-editor-dark.png

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs, mechanical faint-text scan of page 3 overlays: 3 elements with luminance > 0.6 over a white backdrop — the committed note, callout and textbox texts.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4). All three committed kinds now render dark, readable text over the paper-white page in dark mode: sticky note `.ann-note-text` rgb(15,23,42), annotation text box `.ann-textbox` rgb(15,23,42), callout `.ann-callout` rgb(15,23,42) — luminance 0.089 each (was 0.83-0.95 near-white). Mechanical faint-text scan of the page-3 overlays: 0 elements with luminance > 0.6 (was 3). Visually confirmed in screenshots/def-159-1723-dark-inventory.png; close-ups def-158-1723-note-text-dark-crop.png and def-157-1723-callout-dark-crop.png. The callout ARROW remains broken (zero length) — that half stays tracked in DEF-157. No pageerrors.

## DEF-158: Dark mode: committed sticky-note text is invisible (near-white on paper-white page)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22, default dark theme).
2. Open the report.pdf SAMPLE card, scroll to page 3.
3. Arm the annotation "Sticky note" tool, click the page, type "DARK NOTE TEXT 42", click Confirm.
4. Look at the note's text label next to the icon.

Expected: The committed note text must be readable over the paper-white page in every theme.

Actual: The `.ann-note-text` label renders `rgb(241, 245, 249)` (`--fg-strong`, near-white) with its semi-transparent color-tint backdrop over the white page (`rgb(255, 255, 255)` effective backdrop) — the text is effectively INVISIBLE; only a ghost is discernible. Root cause: the note text style is built in `DomAnnotation` (AnnotationOverlay.tsx, noteTextStyle) with `color: "var(--fg-strong)"` — a UI-theme token that flips to near-white in dark mode, while the page underneath stays paper-white (DEF-099). Screenshot: screenshots/def-158-c-note-text-dark-crop.png (close-up), screenshots/def-158-c-note-committed-dark.png, screenshots/def-159-c-dark-inventory.png (full page).

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs: computed color rgb(241,245,249), backdrop rgb(255,255,255).)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4). The committed sticky-note label now renders rgb(15, 23, 42) (dark slate, luminance 0.089) over the white page — readable; visually confirmed in screenshots/def-158-1723-note-text-dark-crop.png ("DARK NOTE TEXT 42" in dark text on the light tint band). Regression: the note interaction matrix on v1.7.23 is healthy — hover cursor grab, drag moves the icon, click opens the note editor (Confirm/Cancel/Delete) with a "Drag to move" grip (round2 W2 + round5 T5). No pageerrors.

## DEF-157: Callout: the arrow does not render (zero-length line at the box corner) and the committed text is faint in dark mode

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card, scroll to page 2.
2. Arm the annotation "Callout" tool. Drag from the anchor point (where the callout should POINT) to the text-box position (~120px away), type "CALLOUT TEXT", click Confirm.
3. Inspect the committed callout: is there an arrow/leader line from the box to the anchor?
4. (Dark mode) repeat on page 3 and read the callout text color.

Expected: A committed callout renders its text box PLUS the leader line and arrowhead from the box edge to the anchor the user dragged from.

Actual:
  (a) NO arrow renders. The committed callout's SVG line has IDENTICAL start and end points (x1==x2, y1==y2; measured line ["601.12","508.64","601.12","508.64"], length = 0) and the arrowhead polygon degenerates to a dot at the box's top-left corner. Root cause: the engine's `normalizeAnnotationPayload` (src/main/services/annotations.ts) DROPS the callout's `at` anchor — the internal AnnModel stores only `rects` (the box rect, from payload.rect) and has no `at` field. When the state round-trips back to the renderer, `annotationFromWire` (engineClient.ts) backfills `at` from `rects[0].x/y` — the BOX CORNER — so `calloutEntryPoint(boxRect, anchor)` returns the box corner itself and the leader line degenerates to zero length. The arrow is broken for every callout created through the UI, not only after save/reopen.
  (b) In dark mode the committed callout text renders `rgb(203, 213, 225)` (`--fg`, light gray) over the paper-white page — FAINT (readable only with effort). Root cause: `.ann-callout` sets no text color; the div inherits the UI theme's `--fg` while floating over the white page.
Screenshots: screenshots/def-157-c-callout-dark-crop.png (no arrow + faint text), screenshots/def-157-b-callout-committed.png (light theme, no arrow), screenshots/def-157-c-callout-committed-dark.png

History:
- qa: opened (probes e2e/retests/qa_pmm_b_matrix_1722.spec.cjs + qa_pmm_c_dark_1722.spec.cjs: lineLen=0 in both light and dark runs; text color rgb(203,213,225) on rgb(255,255,255).)
- qa: retested on installed v1.7.23 = FileVersion 1.7.23 (e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4 + round3 T2). PARTIAL FIX — REMAINS OPEN for the arrow only. Part (b) FIXED: the committed callout text now renders rgb(15, 23, 42) (luminance 0.089, dark slate) over the white page — readable in dark mode (was rgb(203,213,225)); the mechanical faint-text inventory of the page overlays reports 0 items. Part (a) NOT FIXED: the leader line is STILL zero-length — the committed callout's `svg.ann-callout-arrow` line has IDENTICAL start and end points (attrs ["138.72","508.64","138.72","508.64"], length 0) and the arrowhead polygon degenerates to a single repeated point at the anchor; no arrow/leader renders (visually confirmed in screenshots/def-157-1723-callout-dark-crop.png — text box only, no leader to the anchor). Remaining steps on v1.7.23: dark theme -> open the report.pdf SAMPLE -> page 3 -> arm annotation Callout -> drag from an anchor ~200px away from the box corner -> type text -> Confirm -> read `svg.ann-callout-arrow` line x1/y1/x2/y2 (still identical). Interaction side note: the committed callout is now fully interactive (grab hover, drag-move, click Confirm/Edit/Delete bar + hint, dblclick editor, bar Delete removes it — round3 T2).
- qa: CLOSED (retested on installed v1.7.24 = app.getVersion 1.7.24, e2e/retests/def_154_157_verify_1.7.24.spec.cjs T1+T4 + diagnostic def_157_reopen_diag.spec.cjs). Part (a) FIXED — the arrow renders with real length, live AND after save/reopen. LIVE: committed callout's `svg.ann-callout-arrow` line (469,858)->(289,748) page-local, length 210.95px (was 0), arrowhead polygon 3 DISTINCT points (proper filled triangle, was 1 repeated point), and the anchor endpoint sits EXACTLY at the dragged anchor (distance 0.0 page-local); visually confirmed in screenshots/def-157-1724-callout-live.png + def-157-1724-callout-live-arrow-zoom.png (blue leader from the box corner to a filled arrowhead pointing at the anchor). SAVE/REOPEN: Save As to a temp file -> close tab -> reopen -> identical line coords (469,858)->(289,748), length 210.95, 3-point polygon; computed styles intact (line stroke rgb(37,99,235) 1.5px visible, polygon fill blue, box border 1.33px solid rgb(37,99,235) + rgba(37,99,235,0.08) tint + text "CALLOUT SAVE 42") — the `at` anchor now survives the engine round-trip. Visually confirmed in screenshots/def-157-1724-reopen-diag-crop.png (box + full leader + arrowhead in one frame) and def-157-1724-callout-reopened.png. Part (b) was fixed on v1.7.23. No pageerrors.

## DEF-156: Dark mode: the "Drag to move" grip label becomes invisible when the cursor hovers over it

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22, default dark theme), open the report.pdf SAMPLE card, scroll to page 3.
2. Arm the annotation "Text box" tool and click the page so the floating create editor opens ("Type text..." + Confirm/Cancel/Delete bar).
3. Look at the "DRAG TO MOVE" grip strip above the textarea (visible: dark chip, light-gray label). Move the mouse cursor ONTO the grip strip.
4. Watch the label while hovering.

Expected: The grip label stays readable while hovered (it is the affordance that tells the user the window is draggable).

Actual: On hover the label becomes INVISIBLE. Measured computed styles: non-hover grip `background: rgb(21, 24, 28)`, label `rgb(203, 213, 225)` (visible); hover grip `background: rgba(255, 255, 255, 0.04)` and label `rgb(241, 245, 249)` — the hover state swaps the opaque dark chip for a nearly transparent tint (the paper-white page shows through, so the strip turns white) while flipping the label to the dark theme's near-white foreground: white-on-white. Root cause: `.ann-textbox-grip:hover { background: var(--bg-hover); color: var(--fg-strong); }` (styles.css) — the hover tokens assume the grip sits on a dark UI surface, but it floats over the paper-white page. Contributing fragility: the non-hover rule `color: var(--fg-soft)` references a token that is NOT DEFINED anywhere in the stylesheet (only --fg/--fg-strong/--fg-muted/--fg-faint/--fg-on-accent exist), so the base label color only renders via CSS invalid-var fallback to inherited color. Affects both the textbox and callout create editors (same grip component). Screenshot: screenshots/def-156-c-grip-hover-dark-crop.png (hover state — label is a barely-visible white smear over the page text), screenshots/def-156-c-textbox-editor-dark.png (full editor, dark).

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs: non-hover vs hover computed styles as above.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V3). The hover state no longer swaps the opaque chip for a transparent tint: non-hover grip bg rgb(10,12,15) / label rgb(203,213,225); HOVER grip bg rgb(21,24,28) (still opaque dark) with label rgb(241,245,249) — measured label-vs-backdrop luminance contrast 0.866 (was white-on-white over the page). Visually confirmed in screenshots/def-156-1723-grip-hover-dark-crop.png: "DRAG TO MOVE" clearly readable while the cursor sits on the grip, in dark mode, over a white page.

## DEF-155: Add-box: stale artifact of the moved box lingers at the original rect after drag-release

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card, scroll to page 1.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box". Drag a ~150x90 box, type "MOVE TEST 88", Apply.
3. Drag the committed box BODY +200/+120 and release; watch the original rect.

Expected: On release the box and its content are at the new rect only; the original rect is immediately clean (the box moves as one unit, no residual copy).

Actual: CONFIRMED, transient. The DOM mirror and registry follow the drag live (mid-drag DOM rect = start+100/+60, pre-release = start+200/+120), but at the instant of release the page CANVAS at the ORIGINAL rect still paints the old baked "MOVE TEST 88" — canvas pixel sampling of the old-rect interior reads darkFraction 4.5% at t=0, dropping to 0 by t~150ms — and in un-instrumented captures the whole painted frame (box + Edit/Delete bar at the OLD rect) persisted across 80ms/600ms/1600ms screenshots while the DOM already reported the moved rect, before the paint caught up (~2s). Visually: the box appears to sit at the old position after release, then jumps to the new one. Root cause direction: the DEF-145 white eraser cover (`.edit-box-eraser`) unmounts at pointerup (textBoxDrag -> null) BEFORE the async engine mask-and-draw + pdf.js proxy refresh repaints the page, so the pre-move baked text is exposed in that window. Self-heals; no data impact. Screenshots: screenshots/def-155-d-middrag-live.png (drag follows live), screenshots/def-155-d-release-300ms.png / -1800ms.png / -3900ms.png (paint catch-up), screenshots/def-155-a-after-release-600ms.png (un-instrumented capture still showing the old-rect frame).

History:
- qa: opened (probes e2e/retests/qa_pmm_a_addbox_1722.spec.cjs + qa_pmm_d_artifact_1722.spec.cjs: DOM live-follow confirmed; canvas darkFraction at R0 0.0451 -> 0 within ~150ms; painted-frame lag observed up to 1.6s in un-instrumented captures.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V1 + round2 W1 + round3 T1 + round4 T4b). The move flow now has an explicit Confirm step (DEF-152) and NO stale artifact is visible at any instant, in any path: (1) at release the canvas at the old rect still carries the baked text (darkFraction 0.0451) but the `pointer-events:none` `.edit-box-eraser` cover (exactly 150x90 at R0) hides it — full-window screenshots at 80ms/600ms/1600ms after release show the box ONLY at the new rect (def-155-1723-release-*.png); (2) clicking Confirm bakes the move: canvas darkR0 0.0451 at t=500ms -> 0.0 from t=750ms, stable through 4s and through a forced scroll-away/scroll-back re-render (def-155-1723b-postconfirm-*.png, def-155-1723b-after-rerender.png, def-155-1723c-*); (3) the release-then-DESELECT path (never clicking Confirm) is also safe — the eraser keeps covering R0, the Confirm/Edit/Delete bar stays open, and a forced re-render bakes the move cleanly (darkR0=0, box only at the new spot; def-155-1723d-after-deselect.png / -after-rerender.png); (4) DOCUMENT SAFETY: Save As -> re-open shows exactly ONE visible "MOVE TEST 88" at the moved position (canvas darkFraction 0.233 at the run rect, title control 0.207, old rect 0.0) — screenshots/def-155-1723c-reopened-run-crop.png. No pageerrors.

## DEF-154: Rectangle / Ellipse / Arrow / Pen ink: committed shapes cannot be selected, moved, resized or deleted from the page (click-transparent)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card, scroll to page 4/5.
2. Place a Rectangle, an Ellipse, an Arrow and a freehand Pen stroke via the annotation toolbar (each commits immediately on drag-release).
3. With the Select tool armed: hover each committed shape; single-click it; double-click it; press on it and drag.
4. Repeat with the shape's own tool armed.

Expected (operator's Acrobat-style model): hovering a committed shape shows a palm/grab cursor; single-click selects it and makes it movable (with an action bar); double-click opens its edit toolbox; it can be resized and deleted from the page.

Actual: NOTHING is interactive. Every committed shape element reports `pointer-events: none` (rect/ellipse `.ann-shape`, ink `.ann-ink`, arrow `.ann-arrow` line+polygon — styles.css), so hover falls through to the textLayer underneath (measured hover cursor = "text" over a text span; "crosshair" while the shape's tool is armed), single-click produces NO selection and NO action bar (0 bars), double-click opens NO toolbox (0 bars), and a press-drag moves NOTHING (geometry before == after; moved=false for rect, ellipse, arrow, ink). There are no resize handles for shapes anywhere. The only delete path is the side AnnotationsPanel row button, which is not the page-canvas interaction the operator specified. The committed annotation text box behaves identically (pe=none, no hover, no select, no move). Root cause: the annotation overlay only implements CREATE for the shape tools; committed SVG shapes are painted `pointer-events: none` with no selection/move/delete affordance on the canvas.

Matrix measured on v1.7.22 (select tool armed):
| Kind | Hover cursor | Click -> bar | Dblclick -> toolbox | Movable | Resizable |
| --- | --- | --- | --- | --- | --- |
| rect | "text" (textLayer fallthrough) | no (0 bars) | no (0 bars) | no | no |
| ellipse | "text" | no | no | no | no |
| arrow | "text" | no | no | no | no |
| ink | "text" | no | no | no | no |
| annotation textbox | "auto"/"text" | no | no | no | no |
| callout | "text" | no | no | no | no |
| sticky note | "pointer" | yes (note editor: Confirm/Cancel/Delete) | same editor | no | no |
| add box (edit tool) | "move" | select + immediate move-drag; release-without-move opens editor | editor | YES (drag follows live) | corner handles when selected |
Screenshots: screenshots/def-154-b-shapes-committed.png, screenshots/def-154-b3-shapes.png

History:
- qa: opened (probes e2e/retests/qa_pmm_b2_note_shapes_1722.spec.cjs + qa_pmm_b3_ellipse_arrow_ink_1722.spec.cjs: pe=none, hover fallthrough, 0 bars, moved=false for all four shape kinds.)
- qa: retested on installed v1.7.23 = FileVersion 1.7.23 (e2e/retests/def_152_159_verify_1.7.23.spec.cjs V2 + round2 W2 + round3 T2/T3, kind-strict element discovery). PARTIAL FIX — REMAINS OPEN for (1) the arrow kind and (2) resize. Current matrix, Select tool armed:
  | Kind | Hover cursor | Click -> bar | Dblclick -> toolbox | Movable | Deletable from canvas | Resizable |
  | --- | --- | --- | --- | --- | --- | --- |
  | rect | grab | Confirm/Edit/Delete (.ann-content-action) + "Double click to edit" hint | shape-color-editor | YES | YES (bar Delete) | NO |
  | ellipse | grab | same | shape-color-editor | YES | YES | NO |
  | ink | grab (path.ann-ink-hit, pe=stroke) | same | shape-color-editor | YES | YES | NO |
  | callout | grab | Confirm/Edit/Delete + hint | ann-textbox-wrap editor | YES | YES | n/a |
  | textbox | grab | Confirm/Edit/Delete + hint | ann-textbox-wrap editor | YES | YES (bar Delete) | n/a |
  | note | grab | note editor (Confirm/Cancel/Delete) | same editor | YES (drag) | YES (editor Delete) | n/a |
  | arrow | NO — falls through to the textLayer ("auto"/"text") | NO (0 bars, 0 hint) | NO | NO | NO | NO |
  Remaining steps to reproduce on v1.7.23: (1) ARROW — arm annotation Arrow, drag a line on the page, arm Select, hover/click/double-click/drag the committed line: elementFromPoint returns the textLayer span, cursor auto/text, no bar, no movement (measured at t=0.3/0.5/0.7 along the diagonal; the `g.ann-arrow` wrapper reports pointer-events:auto but its line/polygon children are not hit-testable). (2) RESIZE — select a committed rect/ellipse/ink stroke and scan the DOM for handle-like elements: a document-wide scan for `[class*=handle], [class*=resize], [class*=grip]` finds ONLY the four page-corner `.content-resize-handle` elements (~1000px away); nothing near the selected shape, and dragging where a BR handle would be changes w/h by 0 (the add-box `.edit-box-handle-*` corners are the only content handles that exist). Screenshots: def-154-1723b-rect-selected.png (selected rect: Confirm/Edit/Delete bar + hint, NO handles), def-154-1723c-arrow-selected.png / -arrow-after-delete.png, def-154-1723b-all-committed.png.
- qa: CLOSED (retested on installed v1.7.24 = app.getVersion 1.7.24, e2e/retests/def_154_157_verify_1.7.24.spec.cjs T2+T3). Both remaining halves FIXED. (1) ARROW — with Select armed, hover at t=0.3/0.5/0.7 along the line reports cursor "grab" with elementFromPoint = `line.ann-arrow-hit` (pe=stroke) resolving inside `[data-kind="arrow"]` — NO textLayer fallthrough at any probe point; single-click opens the Confirm/Edit/Delete action bar; press-drag +70/+45 moves the arrow by exactly (+70,+45); bar Delete removes it (element gone, page visually clean). Screenshots: def-154-1724-arrow-hover.png, -arrow-selected.png (selection rect + handles + Confirm/Edit/Delete bar), -arrow-moved.png, -arrow-after-delete.png. (2) RESIZE — selecting a committed rect/ellipse/ink now renders FOUR 10x10 corner handles (.content-resize-handle-nw/ne/sw/se) at the shape's bbox corners (visually confirmed in def-154-1724-rect-selected-crop.png and -ink-selected-crop.png: dark square handles + Confirm/Edit/Delete bar + "Double click to edit" hint), and dragging the SE handle actually resizes the geometry: rect dw/dh +32/+22, ellipse +32/+22, ink +31/+20 (screenshots def-154-1724-{rect,ellipse,ink}-resized.png). Full v1.7.24 matrix: every committed kind (rect, ellipse, arrow, ink, callout, textbox, note) is grab-hover/selectable/movable/deletable per the v1.7.23 round2/round3 results, and shapes/ink are now also resizable — the operator's Acrobat-style model is complete. No pageerrors.

## DEF-153: Placeable-content interaction model is inconsistent: no palm/grab hover cursor, no double-click-to-edit toolbox, no "Double click to edit" hint, "Drag to move" grip only on 2 of 4 editors

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card.
2. For each placeable kind, commit one instance and probe: hover cursor (elementFromPoint + computed cursor), single-click, double-click.
3. With a committed add-box selected and being moved (mid-drag and after release), scan every text node in the DOM for a "double click to edit"-style cursor hint.
4. Open each floating editor and check for a "Drag to move" grip label.

Expected (operator's Acrobat-style model, same for every kind): hover -> palm/grab cursor; single-click -> select + movable with a Confirm/Edit/Delete action bar; double-click -> edit toolbox; while movable, a "Double click to edit" cursor message.

Actual: The model is not implemented for most kinds and is inconsistent where it exists:
  (a) NO kind shows a palm/grab cursor on hover over the committed content. Add box shows the 4-arrow `move` cursor; sticky note shows `pointer`; all other kinds fall through to the textLayer (`text`/default) or crosshair while a tool is armed. `cursor: grab` exists only on floating-window CHROME (editor toolbars/bars), never on committed content.
  (b) Double-click opens a toolbox for NO committed kind: add-box dblclick just re-triggers the single-click editor (the editor actually opens on the FIRST click when the release has no movement); committed shapes/callout/textbox are click-transparent (DEF-154); sticky note dblclick = the same note editor its single click already opened.
  (c) The "Double click to edit" cursor message DOES NOT EXIST anywhere in the app — a full DOM text scan mid-drag (box selected + movable) and after release found zero matches for /double.?click/i, and a source scan of src/renderer finds no such string.
  (d) The "Drag to move" grip label exists ONLY on the annotation textbox and callout CREATE editors (measured gripLabels=["Drag to move"]). The note editor has NO grip label (drag is invisible chrome), and the add-box/Edit-text inline editor has NO grip label either (its toolbar is grab-able but unlabelled) — three different drag affordances for four floating editors.
  (e) Edit text tool: hover = crosshair + underline hint (not grab); single click opens the inline editor (Cancel/Apply) — no select+movable state for the text run itself.
Root cause direction: the operator's unified interaction model was never implemented as a shared behavior; each tool family (edit boxes, annotations, note) grew its own ad-hoc hover/select/drag wiring. Screenshots: screenshots/def-153-a-addbox-dblclick.png, screenshots/def-153-b-movable-selected.png, screenshots/def-153-e-edittext-hover.png, screenshots/def-153-e-edittext-toolbox.png

History:
- qa: opened (probes e2e/retests/qa_pmm_a/b/b2/b3/e 1.7.22 specs; hover cursors, dblclick bars and hint scans measured live on the installed binary.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V2 + round2 W2 + round3 T2 + round4 T4a + round5 T5). All five original complaints are fixed:
  (a) hover cursor is now `grab` on every interactive committed kind — add-box div.edit-box, edit-text div.edit-text-hover, textbox .ann-textbox, callout .ann-callout, note .ann-note, rect/ellipse .ann-shape, ink path.ann-ink-hit (measured via elementFromPoint + computed cursor; was move/pointer/text fallthrough).
  (b) double-click opens a toolbox on every interactive kind: add-box -> .edit-inline-editor (Cancel/Delete/Apply), edit-text -> .edit-inline-editor (Cancel/Apply), textbox/callout -> .ann-textbox-wrap editor (Confirm/Cancel/Delete), note -> note editor, rect/ellipse/ink -> .shape-color-editor swatch toolbox.
  (c) the "Double click to edit" cursor hint now EXISTS and renders with the selection/drag on add-box, edit-text, textbox, callout, rect, ellipse, ink (and mid-drag on note) — full text-node scan hit.
  (d) ALL FOUR floating editors now carry a "Drag to move" grip label: textbox create editor (ann-textbox-grip-label), callout create editor (same), note editor (content-grip + content-grip-label), add-box inline editor (content-grip-inline) — screenshots/def-153-1723e-note-editor.png, def-153-1723d-textbox-editor.png.
  (e) edit-text hover is grab (was crosshair) and single-click now selects with a Confirm/Edit/Delete bar (.edit-textrun-bar) + hint.
  Caveats recorded, tracked under DEF-154 (not part of the original (a)-(e) complaints): the ARROW kind is still fully click-transparent (no grab/selection/toolbox — DEF-154); resize handles on selection exist only on the add-box (shapes/textbox/callout/note/edit-text show none — DEF-154); the note's single-click opens its editor (Confirm/Cancel/Delete) directly rather than a bare select state, but the note is grab-hoverable, drag-movable and dblclick-re-editable. Visual evidence: def-152-1723-actionbar-crop.png (selected add-box with Confirm/Edit/Delete + handles + hint badge), def-153-1723c-callout-selected.png (selected callout with bar + hint).

## DEF-152: Add-box: after drag-moving a box, the box's own action bar offers only Edit + Delete — no Confirm

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card, scroll to page 1.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box". Drag a ~150x90 box on the page, type "MOVE TEST 88", click Apply. A committed `.edit-box` renders.
3. Press on the box BODY and drag it +200/+120 (the drag follows live), then RELEASE the mouse.
4. Inspect the action bar that appears under the box.

Expected (operator's Acrobat-style model): the movable/selected box carries a Confirm / Edit / Delete action bar.

Actual: The bar under the moved box carries EXACTLY two buttons — "Edit" (aria "Edit text box", data-edit-box-action=edit) and "Delete" (aria "Delete text box", data-edit-box-action=delete). No Confirm button exists anywhere in the DOM at that moment (confirmAnywhere=false; the floating editor's `data-edit-confirm` affordance only appears after dragging the editor WINDOW). The move is committed silently on release with no explicit confirm step on the box itself. Double-clicking the box opens the floating editor instead, whose buttons are "Cancel / Delete / Apply" (Apply, not Confirm — a third action vocabulary). Root cause: `TextBoxToolbar` (src/renderer/edit/EditOverlay.tsx) renders only onEdit/onDelete; the post-move commit is implicit in the pointerup handler. Screenshots: screenshots/def-152-a-actionbar-crop.png (the Edit/Delete bar under the moved box), screenshots/def-152-a-actionbar-after-release.png

History:
- qa: opened (probe e2e/retests/qa_pmm_a_addbox_1722.spec.cjs on the installed binary: box moved dx=200 dy=120; bar buttons = [Edit, Delete]; confirmAnywhere=false.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V1 + round2 W1/T1). After dragging the committed box body +200/+120 (real mouse; the drag follows live) and releasing, the bar under the moved box now carries EXACTLY three buttons: "Confirm" (aria "Confirm move", data-edit-box-action=confirm), "Edit" (aria "Edit text box") and "Delete" (aria "Delete text box") — hasConfirm=true hasEdit=true hasDelete=true. Visually confirmed in screenshots/def-152-1723-actionbar-crop.png (blue Confirm + Edit + red Delete under the selected box, with 4 corner handles and the "Double click to edit" badge). Regression around the fix: Confirm genuinely commits the move (old rect canvas clears by ~750ms and stays clean; saved+reopened file shows exactly ONE visible "MOVE TEST 88" at the moved spot, old rect clean — screenshots/def-155-1723c-reopened-run-crop.png); Edit opens the floating editor (dblclick -> .edit-inline-editor Cancel/Delete/Apply); the select state (bar + handles + hint) appears on single-click (round2 W2 addbox). No pageerrors.

## DEF-151: Edit-text: moving the floating toolbox and confirming DUPLICATES the text run (the original stays), and the duplicate is baked into the saved PDF

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 10 (edit content) / 14 (installed v1.7.18)

Steps to reproduce:
1. Launch TFlex (installed v1.7.18 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`) -> wait for the Edit toolbar -> click "Edit text" (`[data-edit-tool="text"]`).
3. Click the page-1 title run "TFlex Technical Report". The inline editor opens pre-filled with that text.
4. Replace it with "NEW TITLE 123", click Apply (`[aria-label="Apply edit"]`). The page renders "NEW TITLE 123".
5. RE-CLICK the edited "NEW TITLE 123" run; the inline editor reopens (now correctly showing "NEW TITLE 123" — DEF-149(a) is fixed).
6. GRAB the toolbox chrome (`[data-edit-drag-handle]`, a non-control point) and drag it +200/+120; release. The editor window follows (the Apply control becomes `data-edit-confirm="true"`, aria-label "Confirm move").
7. Confirm (click `[data-edit-confirm]` / Ctrl+Enter). Inspect page 1; then Save-As (`[aria-label="Save As"]`) to a temp path and re-open the saved file; inspect page 1 again.

Expected: Moving the toolbox and confirming RELOCATES the text run — it lands at the moved position and the original position is cleared (guardrail #4: the window and its committed content move as one).

Actual: A new "NEW TITLE 123" run commits at the moved rect (x=794, y=444), but the ORIGINAL "NEW TITLE 123" run at (x=594, y=325) is NOT removed. Page 1 now has TWO "NEW TITLE 123" runs (textLayer = "TFlex Technical ReportA study in PDF orchestration and performance.NEW TITLE 123NEW TITLE 123"). DOCUMENT-SAFETY: the duplicate is BAKED into the saved PDF — after Save-As -> re-open, page-1 textLayer still contains "NEW TITLE 123" twice (count = 2). The move duplicates rather than relocates the content.
Root cause direction: the move+confirm commit (`EditOverlay.tsx` onCommit -> onCommitTextEdit) draws a new run at `commitRect` (the anchor rect shifted by the toolbox drag offset) but never removes the previously-committed run at the original rect; `engine.editTextRun` masks/overwrites only the ORIGINAL page text it replaced, not a run committed in a previous edit pass — so each move+confirm appends another copy.
Screenshot: screenshots/def-149-1718-after-move-confirm.png (two "NEW TITLE 123" — top + moved), screenshots/def-149-1718-editor-toolbox-moved.png (toolbox moved, ghost preview at the moved rect). Fixture: test-fixtures/edittext-move-duplicate-bake.pdf (saved output carrying the duplicate).

History:
- qa: opened (reproduced on installed v1.7.18 while retesting DEF-149. Move+confirm with the "Confirm move" affordance AND via Ctrl+Enter both leave the original "NEW TITLE 123" run in place and commit a second copy at the moved rect; page-1 textLayer shows "NEW TITLE 123" twice, and the saved file re-opens with 2 occurrences — HIGH (silently bakes duplicate content into the user's document). This is the edit-text counterpart of DEF-150 (add-box duplicate-bake).)
- qa: retested on installed v1.7.19 (e2e/retests/def_149_verify_1.7.19.spec.cjs). STILL FAILS. After editing the title to "NEW TITLE 123" + Apply, re-clicking the run (editor shows the NEW text — DEF-149(a) fixed), then moving the toolbox +200/+120 and clicking the "Confirm move" affordance (`data-edit-confirm="true"`, aria-label "Confirm move"): the original "NEW TITLE 123" stays at (x=594,y=325) and a second copy is committed (page-1 textLayer = "…NEW TITLE 123NEW TITLE 123", occurrences=2). The duplicate is BAKED into the saved PDF: pdfjs parse of the saved bytes reports 2 occurrences, and the reopened app tab reports 2. The move duplicates rather than relocates. (The two runs land on the SAME rect on v1.7.19, so the page visually shows a single "NEW TITLE 123", but the text content stream carries two.) Fixture: test-fixtures/edittext-move-duplicate-bake-1719.pdf.)
- qa: retested on installed v1.7.20 (e2e/retests/def_151_verify_1.7.20.spec.cjs). STILL FAILS. Edit title -> "NEW TITLE 123" + Apply, re-click the run (editor shows NEW text — DEF-149(a) fixed), drag the toolbox chrome +200/+120 (the editor window moves dx=200 dy=120, ghost preview shows the text at the moved rect), then click the "Confirm move" affordance (`data-edit-confirm="true"`): the committed "NEW TITLE 123" run is at the SAME rect as before the move (posBefore {x:594,y:325} -> posAfter {x:594,y:325}, rect shift dx=0 dy=0) — the text does NOT relocate — and page-1 textLayer = "…NEW TITLE 123NEW TITLE 123" (occurrences=2). DOCUMENT-SAFETY: the duplicate is BAKED — pdfjs parse of the saved bytes lists the page-1 items as ["TFlex Technical Report","","A study in PDF orchestration and performance.","","NEW TITLE 123","","NEW TITLE 123"] (2 occurrences), and the reopened app tab reports 2. The move duplicates rather than relocates; on v1.7.20 both copies land on the SAME rect (594,325) so the page visually shows a single "NEW TITLE 123" but the content stream carries two. Fixture: test-fixtures/edittext-move-duplicate-bake-1720.pdf.)
- qa: CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_151_verify_1.7.21.spec.cjs). ACCEPTANCE = orchestrator-adjudicated mask-only semantics: after edit-text move+confirm the text must RELOCATE by ~the drag delta (dx~200, dy~120) and there must be EXACTLY ONE VISIBLE "NEW TITLE 123" (the old position white-masked, NOT stacked on the original rect); extraction count is NOT asserted to be 1 (the content stream always carries the masked old run — documented DEF-116 limitation). RESULT: PASS. Edit title -> "NEW TITLE 123" + Apply, re-click the run (editor shows NEW text), drag the toolbox chrome +200/+120 (the editor window moved dx=200 dy=120; the Apply control flipped to `data-edit-confirm="true"`, aria-label "Confirm move"), click Confirm-move. The committed "NEW TITLE 123" run RELOCATED: run-before {x:594,y:325} -> moved run {x:794,y:444}, shift dx=200 dy=119 (relDx=200 relDy=119) — the text follows the toolbox delta. VISIBLE result is ONE run at the new spot: canvas pixel-sampling of the page-1 canvas shows the OLD rect (594,325) white-masked (darkFraction=0.0, no glyphs) and the MOVED rect (794,444) carrying visible dark text (darkFraction=0.1949); visibleCount=1 (the second textLayer span at the old rect is the transparent/masked run, not visible). Document safety: Save-As -> re-open, the VISIBLE result persists (old rect darkFraction=0.0, moved rect darkFraction=0.1949, visibleCount=1; stable across 3 probes 400ms apart). Extraction count on the reopened saved file is 2 in the content stream (masked old run remains, DEF-116) — accepted, not asserted. No pageerror ("Invalid page request"/degreeAngle/NaN/React #310/#520). Screenshots: screenshots/def-151-1721-after-move-confirm.png (ONE "NEW TITLE 123" at the moved spot, old rect cleared), screenshots/def-151-1721-saved-reopened.png (same after save+reopen). Regression note: this retest covers the edit-text move+confirm path only; DEF-150 (add-box toolbox move, sibling commit path) was NOT re-verified in this run and remains OPEN.)

## DEF-150: Add-box: moving the floating toolbox does not move the content box (it sticks), and confirming bakes a large duplicate text run into the saved PDF

- Status: CLOSED
- Severity: HIGH
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 3)
- Phase: 10 (edit content / add text box) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box" (`[data-edit-tool="box"]`). Drag a rectangle on page 1 (~150x90), type "MOVE TEST 88", click Apply. A committed text box (`.edit-box[data-edit-box-id]`) renders at R0.
3. Click the placed box once; the floating inline editor (toolbox) reopens at R0 (mode "edit", rect = R0, text "MOVE TEST 88").
4. GRAB the toolbox chrome (`[data-edit-drag-handle]`, a non-control point) and drag it +200/+120; release. The editor WINDOW follows the cursor.
5. Confirm the editor (Ctrl+Enter / Apply). Inspect the page.

Expected: Moving the toolbox moves the CONTENT with it (the box follows the toolbox), and there is a "Confirm" button to commit the new position (operator's stated intent).

Actual:
  (a) The content box does NOT move with the toolbox — after confirming, `.edit-box` stays at its ORIGINAL rect R0 (measured {x:572,y:445,w:150,h:90} unchanged; boxStayedAtOriginal=true, boxMovedWithToolbox=false). The toolbox's drag offset only repositions the editor WINDOW; the commit always uses `textTarget.rect` (the original box rect) and ignores the drag offset.
  (b) There is NO dedicated "Confirm" button to commit a box move — only the inline editor's Apply/Ctrl+Enter, which commits at the original rect.
  (c) Confirming after the toolbox move re-bakes a LARGE duplicate "MOVE TEST 88" text run onto the page, overlapping the page content (visually a large "MOVE TEST 88" drawn over the body text). Re-opening a committed box sets `mode = "edit"` (initialText length > 0), so the commit routes through `onCommitTextEdit` (the text-run replacement path, EditOverlay.tsx:942-947) instead of the box-update path. DOCUMENT-SAFETY check: page-1 textLayer contains TWO "MOVE TEST 88" occurrences AFTER the toolbox-move+confirm, and this persists after Save-As -> re-open (verified: 2 occurrences before save AND 2 after re-open of the saved file) — the duplicate text run is BAKED into the saved PDF.
  (d) Control (independent path): moving the COMMITTED BOX ITSELF works correctly — re-arm the box tool, drag the box +150/+100 + Ctrl+Enter moves it to R1; drag again +80/+60 moves it to R2 (content updates on each move). So the defect is specifically the floating-toolbox move+confirm path, not the direct box-drag path.
Root cause direction: the `drag.offset` from `useDragWindow` (DEF-140/DEF-147) repositions only the `.edit-inline-editor` window (EditInlineEditor.tsx:242); the commit payload (`EditOverlay.tsx:940-972`) always uses `textTarget.rect`, so the content never follows the toolbox. Re-opening a committed box flips to mode "edit", routing the commit to the text-run path and re-baking a duplicate run (appearing at the box rect but at a larger text scale).
Screenshot: screenshots/gt-bug3-1717-editor-toolbox-moved.png (toolbox moved, content box still at original), screenshots/gt-bug3-1717-after-toolbox-move-confirm.png (content box at original + large duplicate "MOVE TEST 88" over the page), screenshots/gt-bug3-docsafety-after-toolbox-confirm.png / gt-bug3-docsafety-reopened.png (duplicate persisted in the reopened saved file), screenshots/gt-bug3-1717-box-move-1-confirm.png / gt-bug3-1717-box-move-2-confirm.png (direct box-drag works — the control). Fixture: test-fixtures/duplicate-textbox-toolboxmove-bake.pdf (saved output carrying the duplicate).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_addbox_1717.spec.cjs + e2e/gt_bug3_docsafety_1717.spec.cjs. Moving the toolbox moves the editor window (dx=200 dy=120) but the committed box STAYS at R0. Confirming after the toolbox move re-bakes a large duplicate "MOVE TEST 88"; the saved file re-opens with 2 "MOVE TEST 88" occurrences — HIGH (silently bakes duplicate content into the user's document). Direct box-drag + confirm works and updates on subsequent moves (control).)
- qa: CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_150_verify_1.7.21.spec.cjs). ACCEPTANCE = visible-copy semantics per the DEF-151 orchestrator adjudication: after add-box move+confirm the box content must RELOCATE by ~the drag delta (dx~200, dy~120) and there must be EXACTLY ONE VISIBLE "MOVE TEST 88" (old rect cleared, NOT stacked); extraction count is NOT asserted (the task's rule). RESULT: PASS. Add box -> "MOVE TEST 88" -> Apply, re-click the committed box (editor reopens with the box text, mode "edit"), drag the toolbox chrome +200/+120 (the editor window moved dx=200 dy=120; the Apply control flipped to `data-edit-confirm="true"`, aria-label "Confirm move"), click Confirm-move. The committed box RELOCATED: box surface {x:572,y:445} -> {x:772,y:565}, shift dx=200 dy=120 — the box follows the toolbox delta. EXACTLY ONE visible copy: `.edit-box[data-edit-box-id]` surfaceCount=1, page-1 content-stream "MOVE TEST 88" runs=1 at the moved rect (distToOld=204, distToMoved=116), and the OLD rect is cleared (the underlying "…orchestration and performance." body text is visible again — no box left behind). Document safety: Save-As -> re-open, the box persists as ONE VISIBLE "MOVE TEST 88" at the moved spot (canvas darkFraction=0.2384 at the run rect, visibleCount=1); extraction count on the reopened saved file = 1 (reported INFO only, not asserted — the add-box registry path draws the box once, no masked old run). No pageerror ("Invalid page request"/degreeAngle/NaN/React #310/#520). Screenshots: screenshots/def-150-1721-after-confirm.png (ONE "MOVE TEST 88" at the moved spot, old rect cleared), screenshots/def-150-1721-saved-reopened.png (same after save+reopen). This closes the add-box toolbox-move+confirm path (DEF-150); the edit-text sibling (DEF-151) was already CLOSED on v1.7.21.

## DEF-149: Edit-text: re-clicking an edited text run opens the editor with the OLD text, not the new text

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 2)
- Phase: 10 (edit content) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Edit text" (`[data-edit-tool="text"]`).
3. Click the page-1 title run "TFlex Technical Report". The inline editor opens with that text.
4. Replace it with "NEW TITLE 123", click Apply (`[aria-label="Apply edit"]`). The page renders "NEW TITLE 123".
5. Now RE-CLICK the edited text run "NEW TITLE 123". Read the inline editor's textarea value.

Expected: The editor re-opens showing the NEW text "NEW TITLE 123".

Actual: The editor re-opens showing the OLD text "TFlex Technical Report". Measured: after the commit, page-1 textLayer = "TFlex Technical Report A study in PDF orchestration and performance. NEW TITLE 123" (BOTH old and new strings present); clicking the "NEW TITLE 123" span opens the editor with `textareaValue = "TFlex Technical Report"` (the OLD title). Root cause: `engine.editTextRun` (Phase 10) MASKS the old run's rect (white fill) but does NOT remove the old text string from the page content stream, so pdf.js `getTextContent()` returns BOTH the masked OLD text and the NEW text at the same rect. `EditOverlay.onClickTextRun` (`src/renderer/edit/EditOverlay.tsx:256-272`) iterates `getTextItems()` and matches the FIRST run whose rect contains the click point — the OLD "TFlex Technical Report" run (it covers the same rect and appears first), so `setTextTarget({ initialText: item.text })` pre-fills the editor with the OLD text.
  Additional observed behavior: moving the floating toolbox and confirming commits at `textTarget.rect` (the ORIGINAL run rect) regardless of the toolbox's drag offset — the committed text stays at its original page position (it does NOT move with the toolbox). When I confirmed after a toolbox move, the page textLayer appended another "TFlex Technical Report" (a re-baked duplicate). DOCUMENT-SAFETY check (e2e/gt_bug2_docsafety_1717.spec.cjs): the user's "NEW TITLE 123" edit DOES persist in the saved file (reopened textLayer still contains "NEW TITLE 123"); the masked OLD run remains in the file's text content (a text extractor reads both) and a re-confirm with the stale OLD text adds an additional old-text run — but the edit is not silently lost.
Screenshot: screenshots/gt-bug2-1717-after-commit.png (page shows "NEW TITLE 123"), screenshots/gt-bug2-1717-editor-after-reclick.png (editor re-opened showing "TFlex Technical Report"), screenshots/gt-bug2-1717-after-move-confirm.png, screenshots/gt-bug2-docsafety-reopened.png. Fixture: test-fixtures/edittext-old-and-new-runs.pdf (saved output carrying both old and new runs).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_edittext_1717.spec.cjs + e2e/gt_bug2_docsafety_1717.spec.cjs. Re-clicking the edited run opens the editor with the OLD text (textareaValue "TFlex Technical Report"). Toolbox move+confirm leaves content at the original rect and re-bakes an old-text run. The saved file keeps the NEW edit — not silently reverted.)
- qa: retested on installed v1.7.18 (e2e/retests/def_149_verify_1.7.18.spec.cjs + diagnostic). Part (a) PASS — re-clicking the edited run now opens the editor with "NEW TITLE 123" (the re-click OLD-text bug is FIXED). Part (b) FAIL — after moving the toolbox +200/+120 and confirming, a new "NEW TITLE 123" run commits at the moved rect (x=794,y=444) but the ORIGINAL run at (x=594,y=325) is NOT removed: page-1 textLayer now shows "NEW TITLE 123NEW TITLE 123" (2 runs), and the duplicate is BAKED into the saved PDF (reopen still shows 2 occurrences). The move duplicates rather than relocates — filed separately as DEF-151. Kept OPEN because not both verification conditions pass.
- qa: retested on installed v1.7.19 (e2e/retests/def_149_verify_1.7.19.spec.cjs). Part (a) PASS — re-clicking the edited run opens the editor with "NEW TITLE 123" (not the OLD title). Part (b) FAIL — moving the toolbox +200/+120 + Confirm-move leaves the original "NEW TITLE 123" in place and commits a second copy; page-1 textLayer = "…NEW TITLE 123NEW TITLE 123" (2 occurrences), saved-bytes parse = 2, reopened app tab = 2. The move duplicates rather than relocates (DEF-151 still OPEN).
- qa: CLOSED. Part (a) — re-clicking an edited text run opens the editor with the NEW text — verified PASS on installed v1.7.18 (e2e/retests/def_149_verify_1.7.18.spec.cjs), and it remained PASS on v1.7.19. Part (b) — the toolbox move+confirm duplicate/relocate behavior — was split out and tracked separately as DEF-151, which is now CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_151_verify_1.7.21.spec.cjs). Both conditions that kept DEF-149 OPEN are resolved: (a) fixed on v1.7.18, (b) resolved and closed via DEF-151 on v1.7.21.

## DEF-148: "Per page" crop on page 1 makes EVERY thumbnail in the rail render cropped/shrunk to the crop box (uncropped pages 2-4 look cropped too)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 1)
- Phase: 12 (crop pages) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages, each 612x792).
2. Tools palette -> Crop pages (`[data-tool-id="cropPages"]`) -> `[data-crop-pages-dialog]` -> switch mode to "Per page" (`[data-crop-mode="perPage"]`), page select = 1.
3. Set a distinctive 200x200 pt crop box (move + SE handles) and click Apply (`[data-crop-confirm]`).
4. Inspect the LEFT THUMBNAIL RAIL: thumbnails for pages 1-4.

Expected: Only page 1's thumbnail is the crop box (square); thumbnails for pages 2,3,4 (uncropped) must render as FULL 612x792 pages (wrap aspect ~0.773), exactly as they did before the crop.

Actual: EVERY thumbnail wrap collapses to the crop-box square (aspect 1.0 = 126x126) after cropping page 1; only the page-1 thumb (which IS cropped) should be square. Measured geometry (e2e/gt_crop_thumb_1717.spec.cjs):
  - BEFORE crop: pages 1-4 `.thumb-item .thumb-canvas-wrap` = 126x163 (aspect 0.773) — full page.
  - AFTER crop page 1 to 200x200: page 1 wrap = 126x126 (aspect 1.0, correct — page 1 is cropped), but pages 2/3/4 wraps ALSO = 126x126 (aspect 1.0) while their `.thumb-canvas` stays 126x163 (buffer 189x244) — so `clipped: true` for pages 2/3/4 (the full-page bitmap is clipped into the square by `.thumb-canvas-wrap` overflow:hidden). The thumbnails for the UNCROPPED pages 2,3,4 therefore render clipped/shrunk to the crop box (the operator's "all thumbnails look cropped").
  - MAIN VIEW is NOT affected: after the crop, page-2/3 slots keep 1156x1496 (aspect 0.7727, full) — the DEF-141 fix worked for the main view; the thumbnails carry a SEPARATE stale-geometry bug (confirming the operator's suspicion that it's not the DEF-141 class).
Root cause direction (renderer): `src/renderer/components/SideRail.tsx:92` computes a SINGLE `aspect = defaultHeightPt / defaultWidthPt` from `defaultWidthPt`/`defaultHeightPt` = `DocumentView`'s LIVE `firstPageSize` (`DocumentView.tsx:1677-1678`). After a per-page crop of page 1, `firstPageSize` becomes the crop's square (200x200), so `aspect = 1.0`. `Thumb` (`SideRail.tsx:671`) then sizes EVERY thumb wrap as `Math.round(THUMB_WIDTH * aspectRatio)` = 126x126 (square), while the canvas still renders each page's own full geometry via `computeThumbGeometry` (126x163). Every uncropped page's full-page thumbnail is therefore clipped into the crop square. The main view fixed this by using per-page `pageSizes` (DEF-141); the rail was not given the same per-page geometry.
Screenshot: screenshots/gt-bug1-1717-rail-after-crop.png, screenshots/gt-bug1-1717-rail-close.png (rail: thumb 1 = crop square, thumbs 2/3/4 = full-page content clipped into squares), screenshots/gt-bug1-1717-main-after-crop.png (main view pages 2/3 full size — the contrasting control).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_crop_thumb_1717.spec.cjs. Measured BEFORE/AFTER: pages 2/3/4 wraps 0.773 -> 1.0 aspect, canvas 126x163 clipped into 126x126. Main-view pages 2/3 stayed 1156x1496 (0.7727). Document-safety: purely a live thumbnail-layout defect — the saved file and main view are correct (only page 1 carries the crop box), so it is NOT data corruption. The thumbnail rail is the only surface that misrepresents the uncropped pages.)
- qa: closed (retest on installed v1.7.18 = FileVersion 1.7.18 via e2e/retests/def_148_verify_1.7.18.spec.cjs. After cropping page 1 to a 200x200 box (crop box pt {x:123.5,y:159.5,w:200,h:200}), the LEFT THUMBNAIL RAIL now renders correctly: page-1 thumb wrap = 126x126 (aspect 1.0, the crop square — correct, page 1 IS cropped), while pages 2/3/4 wraps = 126x163 (aspect 0.773, FULL page) with `clipped: false` for all three. This is exactly the expected/contrasting outcome — no uncropped page thumb is clipped/shrunk to the crop box. Visually confirmed via screenshots/def-148-1718-rail-close.png and def-148-1718-rail-after-crop.png (thumb 1 square, thumbs 2/3/4 full portrait). Main view pages 2/3 slots = 1156x1496 (0.7727, full) — consistent. Note: the retest spec itself reported a failure on its main-view assertion only because page-4's `.page-slot` returned null after scrollToShow(1) (PDF.js virtualizes off-screen pages; page 4 is not mounted), which is a test-harness artifact, not a product regression — the DEF-148 thumbnail behavior under test passed.)

## DEF-147: Floating context windows/editors cannot be dragged — only the Edit-mode toolbox is movable (operator: "every toolbox movable with its content")

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (DEF-140 draggable toolbox parity — installed v1.7.14)

Steps to reproduce:
1. Launch TFlex (installed v1.7.14 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. For each floating window below, open it, grab a NON-interactive point of its chrome (a point not covered by a button/input/textarea/select/[role=button], found by scanning the rect with `elementFromPoint`), hold the mouse and drag +160px right / +90px down, then release.
   a. Signature pending action bar: Sign tool -> Draw a signature -> Save -> Saved tab -> pick it -> click the page (`.sig-pending` / `[data-sig-action-bar]` appears).
   b. Sticky-note editor: annotation toolbar "Note" (`[data-tool="note"]`) -> click the page (`.ann-note-editor`, `[data-annotation-editor="note"]`).
   c. Textbox editor + action bar: "Text box" (`[data-tool="textbox"]`) -> click the page (`[data-annotation-editor="textbox"]`, `[data-annotation-action-bar="textbox"]`).
   d. Annotation color palette popover: arm "Pen" (`[data-tool="ink"]`) -> click the swatch (`.ann-color-swatch-main`) -> `.color-palette`.
   e. Stamp dialog: Tools palette -> Stamp (`[data-tool-id="stamp"]`) -> `[data-stamp-dialog] .modal-dialog`.

Expected: The operator's stated intent — "every toolbox movable with its content" — so each floating window follows the cursor and is repositionable, exactly like the DEF-140 Edit-mode toolbox (which now moves +220/+120).

Actual: NONE of them move. Measured `getBoundingClientRect` is IDENTICAL before/mid/after the drag for all five (moved dx=0 dy=0):
  - `[data-sig-action-bar]` 669,534 -> 669,534 (dx=0 dy=0)
  - `[data-annotation-editor="note"]` 668,487 -> 668,487 (dx=0 dy=0)
  - `[data-annotation-editor="textbox"]` 668,487 -> 668,487 (dx=0 dy=0)
  - `[data-annotation-action-bar="textbox"]` 668,572 -> 668,572 (dx=0 dy=0)
  - `.color-palette` 391,126 -> 391,126 (dx=0 dy=0)
  - `[data-stamp-dialog] .modal-dialog` 491,51 -> 491,51 (dx=0 dy=0)
Only `EditInlineEditor` (DEF-140, its `.edit-inline-editor`) is draggable; the sticky-note editor, textbox editor, textbox action bar, signature pending action bar, annotation color palette popover and stamp dialog are all stuck. Each has no pointermove window-reposition handler — e.g. SignaturesOverlay only has a pointerdown click/defensive bail-out list (`.sig-action-bar, .sig-action-btn, .sig-pending, ...`, line ~381) with no move/reposition; AnnotationOverlay's `.ann-*` editors/action bars are absolutely-positioned anchored to the page/annotation and have no drag-to-move; ColorPalette `.color-palette` and the stamp modal `.modal-dialog` are static boxes with no drag handle.
Screenshot: screenshots/gt-item1b-note-editor-open.png (note editor), gt-item1c-textbox-open.png (textbox editor+bar), gt-item1d-color-palette-open.png (palette popover), gt-item1e-stamp-dialog-open.png (stamp dialog), gt-item1a-sig-pending-open.png (sig pending bar) — each verified at its origin before and after dragging (moved dx=0).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14 with a chrome-point scan that avoids controls. All five floating windows report dx=dy=0 — the toolbox parity the operator asked for is missing on every window except the Edit-mode inline editor.)
- qa: retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_147_verify_1.7.15.spec.cjs (isolated per-window app launch, chrome-point drag +160/+90 avoiding controls). PARTIAL FIX — two windows now move, four still do NOT:
  - note editor `[data-annotation-editor="note"]`: MOVED dx=160 dy=90 (was stuck) — FIXED.
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED dx=160 dy=90 — FIXED.
  - signature pending action bar `[data-sig-action-bar]`: STUCK dx=0 dy=0 (rect 669,534 unchanged).
  - textbox editor `[data-annotation-editor="textbox"]`: STUCK dx=0 dy=0 (rect 668,487 unchanged) even though its action bar moves.
  - annotation color palette `.color-palette`: STUCK dx=0 dy=0 (rect 391,126 unchanged, 279x550 popover).
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: STUCK dx=0 dy=0 (rect 491,51 unchanged, 460x801 modal).
   The operator's stated intent ("every toolbox movable with its content") is therefore only PARTIALLY met: the note editor and textbox action bar are movable, but the signature pending action bar, the textbox editor, the annotation color palette popover and the stamp dialog still have no pointermove window-reposition handler (dragging their chrome leaves the rect unchanged). Screenshots: def-147-1715-sig-pending-open.png / def-147-1715-note-editor-open.png (moves) / def-147-1715-textbox-open.png / def-147-1715-color-palette-open.png / def-147-1715-stamp-dialog-open.png. REMAINS OPEN — genuine failure.)
- qa: retested on freshly installed v1.7.16 = FileVersion 1.7.16, e2e/retests/def_147_verify_1.7.16.spec.cjs (isolated per-window app launch, chrome-point drag +160/+90 avoiding controls, rect captured BOTH mid-drag (button held) and after release). MORE FIXED — but TWO windows STILL do NOT move (dx=dy=0 mid-drag AND after), so the operator's intent is STILL only partially met:
  - sticky-note editor `[data-annotation-editor="note"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays — STILL FIXED (regression clean).
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 668,572 -> 828,662) and stays — STILL FIXED.
  - annotation color palette `.color-palette`: NOW MOVES mid-drag dx=160 dy=90 (rect 391,126 -> 551,216) and stays — FIXED since 1.7.15.
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: NOW MOVES mid-drag dx=160 dy=51 (rect 491,51 -> 651,102; dy clamped by viewport bottom at the 460x801 modal) and stays — FIXED since 1.7.15.
  - signature pending action bar `[data-sig-action-bar]`: STILL STUCK — mid-drag and after both dx=0 dy=0 (rect 669,534 unchanged). DOM probe confirms a real non-interactive chrome point exists (e.g. 690,537 / 875,537 are `sig-action-bar` background, not buttons) yet dragging it leaves the rect unchanged — no pointermove window-reposition handler. Screenshots: def-147-1716-sig-pending-open.png, def-147-1716-sig-middrag-stuck.png (mid-drag, rect still 669,534).
  - textbox editor `[data-annotation-editor="textbox"]`: STILL STUCK — mid-drag and after both dx=0 dy=0 (rect 668,487 unchanged) even though its action bar moves. DOM probe identifies the root cause precisely: the `[data-annotation-editor="textbox"]` element IS the `textarea.ann-editor.ann-textbox-editor` itself (170x81, rect == the textarea rect, `elementFromPoint` returns the textarea/interactive across its entire area). It has NO separate drag chrome / wrapper — every grab point lands on the textarea (which selects text/caret instead of repositioning the window), so there is literally no way to grab it as a window. This is a genuine failure of the "textbox editor wrapper movable" requirement, not a harness false-negative. Screenshots: def-147-1716-textbox-open.png, def-147-1716-textbox-middrag-stuck.png (mid-drag, rect still 668,487).
  Net on v1.7.16: 4 of 6 measured windows/toolbars are movable (note editor, textbox action bar, color palette, stamp dialog — the latter two newly fixed), but the signature pending action bar and the textbox editor wrapper still cannot be dragged. REMAINS OPEN — genuine, still-incomplete failure.)
- qa: CLOSED (retested on freshly installed v1.7.17 = FileVersion 1.7.17, e2e/retests/def_147_verify_1.7.17.spec.cjs — isolated per-window app launch, chrome/grip-point drag +160/+90 avoiding controls, rect captured BOTH mid-drag (button held) and after release). ALL SIX windows now move — the operator's stated intent ("every toolbox movable with its content") is now FULLY met, and the two remaining stuck windows are FIXED:
  - signature pending action bar `[data-sig-action-bar]`: MOVED mid-drag dx=160 dy=90 (rect 669,534 -> 829,624) and stays — FIXED. (The bar now has minWidth:260 + 8px/12px padding in the drag-hook chrome runway, so a chrome press at the top padding (685,537) starts the whole-window move; previously every press collapsed onto a button.)
  - sticky-note editor `[data-annotation-editor="note"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays — still fixed (regression clean).
  - textbox editor `[data-annotation-editor="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays — FIXED. The editor now exposes a real draggable grip strip `[data-annotation-editor-handle="textbox"]` ("DRAG TO MOVE") above the textarea; dragging the GRIP STRIP (grab point 680,489 — NOT the textarea) moves the whole window (grip + textarea + action bar). The action bar, a child of the wrapper, is displaced by the same delta (dx=160 dy=90) as the editor — it rides with the window.
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 828,689 -> 988,779) and stays — FIXED; its own chrome press (840,692) bubbles to the wrapper's drag hook and moves the whole editor window as one unit.
  - annotation color palette `.color-palette`: MOVED mid-drag dx=160 dy=90 (rect 391,126 -> 551,216) and stays — still fixed.
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: MOVED mid-drag dx=160 dy=51 (rect 491,51 -> 651,102; dy clamped by the viewport bottom at the 460x801 modal) and stays — still fixed.
  Regression / no-op checked: none of the six drag presses was on a control (all grabbed chrome points were verified non-interactive via elementFromPoint), no pageerror, and mid-drag (button held) all six were already at their displaced rect (parity with the DEF-140 inline editor, no release-only snap). Screenshots: def-147-1717-*.png (open + mid-drag for each of the six). ≤5 tests, 5 passed. CLOSED.)

## DEF-146: Committed Add-box text is visually truncated to a few characters after move+confirm (oversized default box font clipped by overflow)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "an artifact appears on screen after moving a textbox and confirming")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Add box" (`[data-edit-tool="box"]`).
3. Drag a rectangle on page 1 (~140x90 px), type "ARTIFACT CHECK 88", click Apply (`[aria-label="Apply edit"]`). The committed text box (`[data-edit-box-id]`) renders.
4. Re-arm the box tool, drag the box ~170px right / 110px down, then Ctrl+Enter to confirm the move.
5. Inspect the box on the page.

Expected: The committed box renders its full text "ARTIFACT CHECK 88" legibly at the new position.

Actual: The box renders only "AR" (the first 2 characters). The committed box's text mirror `.edit-box-text[data-edit-box-text-mirror]` has `font-size: 71.7778px` (the default box font, near the SIZE_MAX=72 cap) inside a small 140x90 box with `overflow: hidden; white-space: pre-wrap`, so the rest of "TIFACT CHECK 88" is clipped out of view. The full string IS still present in the page textLayer (page 1 textLayer = "...ARTIFACT CHECK 88"), so the stored content is intact but the on-screen box is visually truncated. Confirmed identically at commit (before moving) and after move+confirm — the artifact is the box mirror's oversized default font. This is the same class as the DEF-113 content-drop, now reappearing as a live playbox truncation. (Screenshot shows box rendering only "AR".) Note: I did not save+reopen to test whether the clipped rendering also lands in the saved PDF — flagged for the fix dispatch.
Screenshot: screenshots/gt-item8-after-confirm.png (box shows "AR"), gt-item8-after-commit.png, gt-item8-probe.png.

History:
- qa: opened (operator-reported "artifact after moving a textbox and confirming"; reproduced on installed v1.7.14. The artifact is the committed box text rendered as "AR" because the mirror font is 71.78px in a 140x90 box with overflow:hidden. `data-edit-box-text-mirror` line in DOM: font-size 71.7778px, overflow hidden. The full committed content is intact in the textLayer.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_146_verify_1.7.15.spec.cjs). Edit -> Add box -> place a ~150x90 box on page 1, type "ARTIFACT CHECK 88", Apply. The committed box holds its FULL text in the mirror (`data-edit-box-text-mirror` = "ARTIFACT CHECK 88") and renders it legibly — the computed mirror font is 23.89px (auto-FITTED to the box, not the oversized ~71.8px default), so the whole string is visible inside the box (confirmed visually: def-146-1715-after-commit.png shows "ARTIFACT" / "CHECK 88" wrapped and fully visible, NOT clipped to "AR"). After re-arming the box tool, dragging the box +170/+110 and Ctrl+Enter confirming the move, the box still renders the full "ARTIFACT CHECK 88" (font 23.89px) — the artifact is gone. Page-1 textLayer contains the full string. No pageerror. The mirror font now auto-fits (wrap at box width, shrink so every line fits the box height) instead of rendering the box.rect.height*0.8 default at overflow:hidden. CLOSED.)

## DEF-145: Dragging a committed Add-box text box leaves a transient stale text copy at its original position until the mouse is released

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "dragging a TEXTBOX keeps a copy of the text at its ORIGINAL position until the mouse button is released")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Edit toggle -> "Add box" -> drag a rectangle on page 1, type "STALE CHECK BOX", Apply.
3. Re-arm the box tool, click the committed box and drag it ~180px right / 120px down. Hold the mouse button (do NOT release) and inspect the page.

Expected: The box (and its text) move together with no residual text at the old spot.

Actual: While the mouse button is held, the box surface AND its `.edit-box-text-mirror` move to the new rect (mirror rect 595,426 -> 775,546, dx=180 dy=120), but the page still paints a faint stale copy of "STALE CHECK BOX" at the ORIGINAL position (visible in the mid-drag screenshot just above the moved box) because the pdf.js proxy is not refreshed until mouseup re-commits the box at the new rect. On mouseup the proxy refreshes and the stale copy disappears (after-drag screenshot is clean). So the stale-at-origin text is a transient visual artifact confined to the duration of the drag.
Screenshot: screenshots/gt-item6-middrag.png (stale "STALE CHECK BOX" at the original spot while the box surface is at the new spot), gt-item6-after-drag.png (clean after release).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Mid-drag the page textLayer still paints the pre-move box string at the original rect; it clears on mouseup.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_145_verify_1.7.15.spec.cjs). Edit -> Add box -> place a box on page 1, type "STALE CHECK BOX", Ctrl+Enter (committed box at {595,425,140,90}). Re-arm the box tool, grab the committed box center and drag +180/+120 HOLDING the button: MID-DRAG (before release) the box surface is already at {775,545} (dx=180 dy=120) AND its `[data-edit-box-text-mirror]` is at {775,546} (dx=180 dy=120, aligned with the surface) — only ONE live text mirror (no second/stale copy). The ORIGINAL position {595,425} is empty (verified in def-145-1715-middrag.png — box moved, origin clean, no residual "STALE CHECK BOX" at the old spot). After release nothing snaps back. The box AND its text travel together while the button is held; no stale-at-origin text copy. (Note: `[data-edit-box-id]` also matches the "Edit | Delete" action-bar toolbar, so the raw element count can exceed 1 — that is the toolbar, not a duplicate box.) No pageerror. CLOSED.)

## DEF-144: Drawn signatures render as a thick black filled blob when ghosted/placed — stroke thickness is not preserved (and no image-import option exists)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "drawn signature ghost/placed result is too big/thick; no way to add a signature from an image file")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Sign tool (`button[aria-label="Sign tool"]`) -> Draw tab -> draw a thin stroke on the "Draw your signature" canvas (360x120).
3. Save -> Saved tab -> pick the saved signature -> hover the page (ghost preview) -> click the page -> Confirm (placed).
4. Compare the drawn stroke (thin line) to the ghost preview and the placed result.

Expected: The ghost/placement preserves the drawn stroke's appearance proportionally — a thin pen line, scaled, matching the box aspect; the whole signature visible.

Actual: The ghost and the placed signature both render as a THICK BLACK FILLED blob (a heavy barbell/dumbbell shape), not the thin stroke that was drawn. Measured ghost/placed rect = 121x42 (aspect 2.88 — proportionally correct, so NOT "too big" in dimension), but the stroke weight is rendered far too thick, so the signature reads as a solid black mass. The drawn-canvas screenshot shows a thin line; the placed/ghost screenshot shows the same stroke as a filled shape. (The box aspect IS preserved and the whole signature fits, so "box needs to expand" is NOT reproduced; the thickness IS reproduced.)
   Confirmed separately: the Signature manager exposes only Draw / Type / Saved tabs — no "import from image" / "from file" / upload control (tabs = ["Draw","Type","Saved (0)"]). Image-import is NOT in the Phase 4 requirements ("create by drawing or typing"), so it is out of scope rather than a bug — noted here as confirmed-absent.
Screenshot: screenshots/gt-item5-drawn-canvas.png (thin stroke drawn), gt-item5-ghost.png (ghost thick blob), gt-item5-placed.png (placed thick blob), gt-item5-pending.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Thin drawn stroke -> ghost/placed thick filled blob. Box aspect preserved (2.88) so not "too big"; thickness is the reproduced defect. Image import confirmed absent, and it is out of scope per Phase 4.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_144_verify_1.7.15.spec.cjs). Draw a thin curved stroke on the 360x120 Draw canvas -> Save -> pick -> hover to ghost -> click to place -> confirm. GHOST svg: viewBox "0 0 64 22", path strokeWidth = 0.427 (was ~13.5 in v1.7.14), fill="none" (a stroked polyline, NOT a filled shape), rect 121x42 (aspect 2.88 — proportionally correct, signature fully visible). PLACED svg: identical strokeWidth 0.427, fill="none", rect 121x42 (aspect 2.88). Both ghost and placed render as a THIN pen stroke, not a thick black filled blob. Confirmed visually (def-144-1715-drawn-canvas.png = thin stroke on the canvas, def-144-1715-ghost.png / def-144-1715-placed.png = thin stroke on the page). The signature manager still exposes only Draw / Type / Saved tabs (no image import — out of scope, noted). No pageerror. `scaledStrokeWidth` (DRAW_PEN_WIDTH * min(sx,sy)) now scales the stroke thickness WITH the points instead of dividing by the scale. CLOSED.)

## DEF-143: Signature Saved tab shows duplicates of the FIRST signature after saving several, and delete is inconsistent (count vs rendered rows)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "add four signatures 1/2/3/4 — what renders? delete first then delete again")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Sign tool -> Type tab -> type "1" -> Save; type "2" -> Save; type "3" -> Save; type "4" -> Save.
3. Switch to the "Saved" tab. Inspect each row.
4. Click Delete (`.sig-saved-delete`) on the FIRST row; inspect. Click Delete on the (new) first row AGAIN; inspect.

Expected: The Saved tab lists four DISTINCT signatures "1","2","3","4" (each showing its own content), and deleting removes exactly the clicked one each time with a consistent count.

Actual: The Saved tab shows FOUR rows but every row renders the SAME signature "1" (label/thumbnail "1" — a duplicate of the first). On the first delete the list becomes inconsistent: the badge reads "Saved (3)" but SIX rows render ("1","1","1","2","3","4") — stale duplicates of "1" persist alongside the correct "2","3","4". Deleting again leaves the same inconsistent 6-row list. Root cause direction: `TypeTab.onSave` (src/renderer/signatures/SignatureManagerModal.tsx:398-402) calls `getSignatureService().save(source, trimmed)` and takes `const sig = next[0]` — but `SignatureService.save` (src/main/services/signature-service.ts:48-50) `return this.list()` after `push`, which is OLDEST-FIRST, so `next[0]` is always the FIRST-ever signature. Every new Save therefore appends the first signature to the modal's local list, so the Saved tab shows N copies of the first signature. The persisted service list is correct; the modal's local `saved` mirror is wrong, and the count badge can disagree with the rendered row count after a delete.
Screenshot: screenshots/gt-item4-saved-four.png (4 identical "1" rows), gt-item4-after-delete-first.png (badge "Saved (3)" but 6 rows), gt-item4-after-delete-again.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Saved tab after 4 typed saves = 4 rows all "1"; delete-first -> badge "Saved (3)" but 6 rows. Root cause pinned to `next[0]` in TypeTab.onSave against an oldest-first list.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_143_verify_1.7.15.spec.cjs). Type tab -> save "1","2","3","4" -> Saved tab: badge "Saved (4)" and FOUR DISTINCT rows labels [1,2,3,4] (thumbnails each "1"/"2"/"3"/"4", delete aria-labels "Delete 1".."Delete 4") — NO duplicates. Delete the FIRST row -> EXACTLY 3 rows, labels [2,3,4], badge "Saved (3)". Click delete on the (new) FIRST AGAIN -> EXACTLY 2 rows, labels [3,4], badge "Saved (2)". Count is consistent with rendered rows at every step; the badge no longer disagrees with the row count. No pageerror. The `next[0]` oldest-first mirror bug is fixed (the modal's local `saved` list now appends the actual new signature). Screenshots: def-143-1715-saved-four.png (4 distinct rows), def-143-1715-after-delete-first.png (3 rows 2/3/4), def-143-1715-after-delete-again.png (2 rows 3/4). CLOSED.)

## DEF-142: Closing the app (window X) with an unsaved document does NOT prompt to save — edits are silently discarded

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "close the APP with an unsaved document open — does it prompt to save? currently no prompt")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Make an edit so the document is modified (click the toolbar Rotate clockwise `[data-toolbar-rotate-cw]`); confirm `tflexDiagnostics().modified === true`.
3. Click the window close button (`.titlebar-control-close` / `[data-window-close]` — the app's window X), NOT a tab close.

Expected: Since the tab is modified/unsaved, the app prompts "Save changes?" (Save / Don't save / Cancel) before quitting, mirroring the tab-close prompt (CloseTabPromptDialog).

Actual: The window closes outright with NO prompt. After the X click the target page is destroyed (`windowAlive=false`, `promptInDom="WINDOW-GONE"`, `closedEvent=closeCount=0`) and no save/close prompt element ever mounts. The user's unsaved edit is silently lost. Root cause direction: the unsaved-check lives only in the per-tab `closeTab` path (`src/renderer/App.tsx` closeTab, line ~1105, which gates on `tabMeta.modified`/`engineModified` and shows CloseTabPromptDialog). The window close IPC `window:close` -> `BrowserWindow.fromWebContents(event.sender)?.close()` (`src/main/index.ts:121-123`) and the frameless caption button `tflex.closeWindow()` (`src/renderer/components/TitleBar.tsx:199`, `src/preload/preload.ts:320`) route straight to `win.close()` with no `beforeunload` / `will-prevent-unload` / modified gate, so the whole app quits ignoring unsaved state.
Screenshot: screenshots/gt-item3-modified-before-close.png (modified=true before X), gt-item3-after-close-click.png (window gone).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. modified=true, X click -> window closes, no 'Save changes' prompt, no will-prevent-unload.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_142_verify_1.7.15.spec.cjs). (a) Open report.pdf sample, Rotate CW (modified=true), click the window X ([data-window-close]): the window STAYS ALIVE and the "Unsaved changes" CloseTabPromptDialog mounts with buttons [Cancel, "Don't save", "Save As…"] (the sample is bytes-loaded, so Save routes to Save-As). Cancel -> prompt dismissed, window stays open. Second X -> prompt reappears; "Don't save" -> confirmClose(true) -> window closes (closedEvent fired). (b) Fresh app: X -> prompt -> Save ("Save As…") with the OS save dialog stubbed to a temp path -> the save runs and the window closes; the saved file re-parses (pdf-lib) as a valid 34-page PDF. The gate (main `onCloseRequested` preventDefault + `window:closeRequested` -> renderer CloseTabPromptDialog -> `confirmClose(true)`) closes the DEF-142 "silent discard" hole: every close path now prompts on unsaved edits and Save/Don't-save/Cancel all work. Screenshots: def-142-1715-modified-before-close.png, def-142-1715-prompt.png (the "Unsaved changes" dialog with Cancel / Don't save / Save As), def-142-1715-after-cancel.png. CLOSED.)

## DEF-141: "Per page" crop on page 1 collapses EVERY page-slot to the crop's box in the live view — the doc renders as stacked/clipped squares

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "crop PAGE 1 stacks the pages below to overlap each other; the smaller the crop, the denser the stack")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card (34 pages, each 612x792).
2. Tools palette -> Crop pages (`[data-tool-id="cropPages"]`) -> `[data-crop-pages-dialog]` -> switch mode to "Per page" (`[data-crop-mode="perPage"]`) -> page select = 1.
3. Set a SMALL crop box (150x150 pt via the move + SE handles), click Apply (`[data-crop-confirm]`).
4. Scroll the continuous view to page 1 and inspect the sizes of pages 1-6.

Expected: Only page 1 is cropped to 150x150; pages 2-34 keep their full 612x792 render box (aspect 0.773).

Actual: EVERY page-slot collapses to the crop box size. After the small crop, `.page-slot[data-page=1..6]` are ALL 283x283 px (square, the crop's aspect) with `--scale-factor` still 1.888 (the full-page scale), so each full page's 612x792 content is rendered at 1.888 (1156x1496) but clipped/stacked into a 283x283 square — only the top-left slice of each page is visible. Page-1 slot text = "A study in PDF orc" (cropped), page-2 slot text = "Chapter 1: The Art of Orchestration..." (full, clipped), page-3 = "key to maintaining...". The smaller the crop, the smaller every slot becomes (150x150 crop -> 283x283 slots; 300x400 crop -> 139x185 slots) — the "density" scales with crop size. So the doc is visually scrambled/stacked. (The SLOT boxes themselves have an 18px gap, so there is no literal box-overlap; the "stack" is the full-page content clipped into the crop-size square. The saved file is CORRECT — pdf-lib re-parse of a Save gives pageCount 34 and only page 1 with a non-full CropBox (150x150); pages 2,3 are full 612x792 — so this is a live proxy/layout defect, not data corruption.)
Screenshot: screenshots/gt-item2-small-crop-scroll.png, gt-item2-small-crop-stack.png (cropped strip + full page-2 content clipped into the next square), gt-item2-medium-crop-scroll.png, gt-item2-probe-scroll.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Per-page crop on page 1 collapses every page-slot to the crop box (283x283 for a 150x150 crop) with the full-page content clipped into the square; saved file correct (only page 1 CropBox). Live view is scrambled — the DEF-131/DEF-139 class regression.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_141_verify_1.7.15.spec.cjs — OPERATOR-EXACT small-crop flow). Basis: BEFORE crop pages 2/3 slots = 1156x1496 (aspect 0.7727). Crop page 1 to 150x150 pt (centered) via the per-page editor -> Apply ("Cropped 1 page."). AFTER crop: page-1 slot = 283.4x283.4 (aspect 0.9996 = the crop, correctly crocod only on page 1) while page-2 slot = 1156x1496 (aspect 0.7727), page-3 = 1156x1496 (0.7727), page-4 = 1156x1496 (0.7727) — pages 2/3/4 KEEP their FULL 612x792 render box; NO collapse to the crop square. Content-based overlap between consecutive slots = -18px (an 18px gap, NO stacking/overlap). Document-safety re-parse: Save As -> pdf-lib load = pageCount 34, only page 1 carries a non-full CropBox (150x150), pages 2/3 full 612x792 — the saved file is correct. No pageerror. The live view no longer scrambles/stack; the DEF-131/DEF-139 class regression is gone. Screenshots: def-141-1715-small-crop-scroll.png (page-1 cropped, page-2 full "Chapter 1"), def-141-1715-small-crop-stack.png (below the crop, full-size pages, no overlap). CLOSED.)

## DEF-140: The floating Edit-mode TOOLBOX (inline editor window) cannot be dragged/moved — it stays stuck over the text box and page content

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (operator-reported BUG 4, reproduced on installed v1.7.13)
- Phase: 14 (Add-box inline editor UX)

Steps to reproduce:
1. Launch TFlex (installed v1.7.13 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages).
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Add box" (`[data-edit-tool="box"]`).
3. Drag a rectangle on page 1 (within the visible viewport) to place a text box; the inline editor (`[data-edit-editor="box"]`) appears. Type text (e.g. "Movable toolbox test") and click Apply (`[aria-label="Apply edit"]`) — a committed text box (`[data-edit-box-id]`) appears.
4. Click the committed text box ONCE. A floating TOOLBOX / inline editor window (`.edit-inline-editor`, `[data-edit-editor="edit"]`, containing the FONT/SIZE/COLOR toolbar row + the textarea) opens at the box location.
5. Press and HOLD the mouse on the toolbox's header / toolbar chrome (the FONT-SIZE-COLOR row — not a button, not the textarea) and drag ~220px right / 120px down, then release.

Expected: The floating toolbox (the inline editor window, together with the text inside) follows the cursor and can be repositioned so it does not cover the text box / page content — the operator's stated intent ("the toolbox along with the text inside should be movable").

Actual: The toolbox does not move at all. `.edit-inline-editor` getBoundingClientRect is UNCHANGED across the whole gesture: BEFORE drag `{x:653,y:455,w:200,h:182}`, MID-DRAG (while the mouse button is held and the cursor is 220px/120px away) `{x:653,y:455,w:200,h:182}`, AFTER release `{x:653,y:455,w:200,h:182}` — moved by `dx=0 dy=0`. The editor's only `onPointerDown` calls `e.stopPropagation()` and sets an inside-press blur-guard flag; there is NO pointermove handler that repositions the window, so the toolbox is stuck and keeps covering the page content while the user drags.
Screenshot: screenshots/bug4-toolbox-middrag.png (toolbox still at its origin while the cursor drags it), screenshots/bug4-toolbox-after-release.png (identical position after release), screenshots/bug4-box-editor-add.png (the add-box editor before commit).

History:
- qa: opened (operator-exact steps on installed v1.7.13; reproduced and measured. The committed box was placed at {x:652.6,y:455.3,w:130,h:80}; single-click reopened the editor at {x:653,y:455,w:200,h:182}; holding+dragging the toolbar chrome 220px/120px left it exactly at {x:653,y:455}, dx=0 dy=0. No pageerror, no editor auto-close.)
- qa: closed (retested on freshly installed v1.7.14 = FileVersion 1.7.14, e2e/retests/def_140_verify_1.7.14.spec.cjs — OPERATOR-EXACT flow, not the state arrays). Open report.pdf sample card -> Edit content toggle -> "Add box" -> drag a rectangle on page 1 -> type "Movable toolbox test" -> Apply -> committed box `[data-edit-box-id]` at {x:652.6,y:455.3,w:130,h:80} -> click the committed box ONCE -> the floating toolbox `.edit-inline-editor` opens at {x:653,y:455,w:200,h:182} (mode edit, identical anchor to the def-140 repro). HOLD + DRAG the toolbar chrome (`[data-edit-drag-handle]`, grabbed at the top-left padding point (658,461) — not a control) 220px right / 120px down: MID-DRAG (mouse still held) the toolbox is already at {x:873,y:575} (dx=220 dy=120 — it follows the cursor WHILE the button is held, not only on release), and AFTER RELEASE it stays at {x:873,y:575} (no snap-back, dx=220 dy=120). The toolbox no longer covers the text box / page content — the operator's stated intent ("the toolbox along with the text inside should be movable") is met. Regression checked: no pageerror (no "Invalid page request"/degreeAngle/NaN/React #310/#520) during the add/commit/click/drag flow. Pinned by the `EditInlineEditor` DEF-140 drag handle: `.edit-inline-toolbar` is the drag handle, `onToolbarPointerDown` records the pointer + rect (bailing out on `select/input/button/.edit-inline-toolbar-actions`), a window `pointermove` repositions the window via a `dragOffset` state applied on top of the anchored left/top, clamped to the viewport, and `pointerup`/`pointercancel` end the drag. Screenshots: screenshots/def-140-box-editor-add.png (add-box editor before commit), def-140-toolbox-middrag.png (toolbox at 873,575 while the cursor drags it clear of the "Mov" box), def-140-toolbox-after-release.png (identical to mid-drag — stays at the new position, no snap-back). CLOSED.)

## DEF-139: Inserting a blank page visually scrambles the document — the live view and thumbnail rail show the last page at position 1/2 instead of the blank, and pages render one slot off until save+reopen

- Status: CLOSED
- Severity: HIGH
- Found by: qa (operator-reported BUG 2, reproduced on installed v1.7.12)
- Phase: 9 (insert blank page regression on installed v1.7.12)

Steps to reproduce:
1. Launch TFlex (installed v1.7.12 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages; page 1 = "TFlex Technical Report" title, pages 2-17 = 8 chapters each + continuation, pages 18-34 = appendix "Page 1".."Page 17").
2. Open the Tools palette -> "Insert pages" (`[data-tool-id="insertPages"]`), keep mode "Blank page", set "Insert at page" to `2` (blank becomes page 2, i.e. inserted AFTER page 1), click Insert.
3. Wait for the ui/proxy to settle (I waited ~3s + scrolled the whole doc).
4. Look at the LEFT THUMBNAIL RAIL and the main viewer: what content does page 1, page 2, page 3 render?

Expected: Page 1 stays the "TFlex Technical Report" title; page 2 is the new BLANK page; page 3 is Chapter 1 ("Chapter 1: The Art of Orchestration"). The blank appears where requested and the document is otherwise unchanged except shifted by one.

Actual: The visible document is SCRAMBLED. `engineState.pageOrder` reports `[0,34,1,2,3,4,5,...]` (35 slots, unique 35) and the rail's `.thumb-item`/`.page-slot` `data-source-page` attributes declare slot 2 -> source 35 (the new blank) and slot 3 -> source 2 — which LOOKS correct. But the RENDERED CONTENT at each slot is wrong:
  - Slot 1 renders the title page ("TFlex Technical Report") — correct.
  - Slot 2 (declared source 35 = the new blank) renders "Page 17" — the LAST page of the document, NOT a blank.
  - Slot 3 (declared source 2 = Chapter 1) renders an EMPTY/blank page, not Chapter 1.
  - Slot 4 (declared source 3) renders "Chapter 1: The Art of Orchestration".
  - Slot 35 (declared source 34) renders "Page 16".
  So every slot from 2 onward is one content-slot off: the new blank does NOT appear as page 2, and the LAST page ("Page 17") content is instead shown at page 2 (and its real content lands one slot late). This is exactly the operator's report (the last page moved to the front / the visible order is wrong).

CRITICAL CONTRAST — the engine's SAVED OUTPUT and the FILE ON DISK are CORRECT. I did `Save As` after the insert and re-parsed the file with pdf.js: saved page 2 = "" (blank), saved page 3 = "Chapter 1: The Art of Orchestration", saved page 35 = "Page 17" — the correct order. So the mismatch is a LIVE-VISUAL (pdf.js proxy render / source-page mapping) defect, NOT a data-corruption defect. Save + re-open the file in TFlex -> the render is CORRECT (slot 2 = blank, slot 3 = Chapter 1, slot 35 = "Page 17").

Drawing on visible page 2 (part 2 of the operator's report): with `[data-tool="ink"]` a stroke drawn on VISIBLE page 2 lands on page 2 in the engine (`annotations = [{kind:ink,page:2}]`) and a rect on VISIBLE page 3 lands on page 3 — so DRAWING TOOLS DO work and the annotation overlay IS placed on the visible slot the user drew on (annotations render as HTML overlays, so the pdf.js canvas hash is unchanged, but the drawn `.ann-ink`/`.ann-rect` elements DO appear on those visible slots). The "no drawing tools work on page 2/3" symptom is NOT reproduced as stated — the ink/rect DO render on the visible pages the user draws on. What IS broken is that those visible slots are showing the WRONG page CONTENT (page 2 shows "Page 17", page 3 shows blank), so a user drawing on "page 2" after an insert-blank is actually drawing on top of a page that displays the last page's content — the annotation is attached to visible page 2 whose underlying/real page content the engine has not re-ordered in the live render.

Root cause direction (for the dev, renderer-side, not engine): the live pdf.js proxy is NOT rebuilt to match the engine's new pageOrder after insert-blank — `DocumentView`/`SideRail` map visible slot -> source via `pageOrder`, and `PageView` renders `doc.getPage(sourcePage)`, but the pdf.js proxy's actual page list still reflects the pre-insert order at live-render time, so `getPage(35)` (slot 2) returns the OLD last page's proxy page ("Page 17") instead of the new blank, and `getPage(2)` (slot 3) returns blank instead of Chapter 1. On save+reopen the proxy is rebuilt from the corrected bytes and the order is right. (The engine/pageOrder/annotations and the saved file are all correct — this is a live proxy/refresh mismatch.)

Screenshot: screenshots/def-139-rail-thumbs-1-4.png (rail: thumb 1 = title, thumb 2 = "Page 17" last-page content NOT blank, thumb 3 = blank, thumb 4 = Chapter 1), screenshots/def-139-live-page2.png (main-view slot 2 = "Page 17"), screenshots/def-139-live-page3.png (main-view slot 3 = blank), screenshots/def-139-live-page35.png (slot 35 = "Page 16", should be "Page 17"); also captured per-slot textLayer ground truth: slot1="TFlex Technical Report...", slot2="Page 17" (src 35), slot3="" (src 2), slot4="Chapter 1..." (src 3), slot35="Page 16" (src 34). The same-flow Save-As re-parse (external pdf.js) is the CONTROL: page2="", page3="Chapter 1...", page35="Page 17".

NOTE on previous verification: DEF-133 (which covers annotation-page-attribution after insert-blank) was CLOSED at this flow, and the DEF-133 note claimed the page-order was correct (blank becomes page 2). That conclusion was made by trusting the `pageOrder`/`data-source-page` ARRAYS — which this reproduction shows is WRONG: the arrays report the correct order while the LIVE RENDERED content shows the wrong page at every slot from 2 onward. This is exactly the "declare correct from pageOrder arrays alone" failure the operator warned about. The page-order claim is NOT correct when inspected visually.

History:
- qa: opened (installed v1.7.12; live view after insert-blank shows last-page "Page 17" at slot 2 and blank at slot 3 while pageOrder[1]=34/data-source-page[2]=35 claims the blank is slot 2; saved bytes + reopen render correctly).
- qa: closed (retested on freshly installed v1.7.13 = FileVersion 1.7.13, exe 10:52 AM, e2e/retests/def_139_verify_1.7.13.spec.cjs — OPERATOR-EXACT VISUAL check, not the state arrays). Open report.pdf sample card -> Tools -> Insert pages -> blank mode -> "Insert at page" = 2 (rank semantics: blank becomes page 2, inserted AFTER page 1) -> Insert. IMMEDIATELY (no save/reopen) the live view and the LEFT THUMBNAIL RAIL are correct: page-slot textLayer ground truth = slot1 "TFlex Technical Report", slot2 "" (BLANK, spanCount 0), slot3 "Chapter 1: The Art of Orchestration", slot35 "Page 17"; rail thumbCount = 35 and the thumbnails visually render thumb1 = title, thumb2 = BLANK (pure white, darkFraction 0), thumb3 = Chapter 1, thumb35 = "Page 17". Arm the Pen ([data-tool="ink"]) and draw on visible page 3 -> `.ann-ink` renders on the slot that shows "Chapter 1: The Art of Orchestration" (inkOnPage3=1, slot3 text still Chapter 1). DELETE PATH (developer note): delete page 2 (the blank) via [data-tool-id="delete"] range mode -> pageCount 35->34 and slot2 IMMEDIATELY renders "Chapter 1: The Art of Orchestration" (the correct next content), slot1 still title, slot3 continuation body. After all of the above page 2 is still BLANK. No save/reopen anywhere; the live render is immediately correct. No unhandled "Invalid page request"/"degreeAngle"/"NaN"/React #310/#520 pageerrors. Screenshots: screenshots/def-139-1713-rail.png, def-139-1713-thumb-1.png / -thumb-2.png / -thumb-3.png / -thumb-35.png, def-139-1713-live-page1.png / -live-page2.png / -live-page3.png / -live-page35.png, def-139-1713-page3-ink.png, def-139-1713-after-delete.png.) CLOSED.



- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 2 (regression on installed v1.7.11)

Steps to reproduce:
1. Launch TFlex (installed v1.7.11 binary = 9dcf83c source), open the report.pdf sample.
2. Click the toolbar "Rotate clockwise" (`[data-toolbar-rotate-cw]`). The page-1 canvas swaps 1156x1496 -> 1496x1156 (landscape); `window.tflexDiagnostics().engineState.rotations[0]` becomes 1.
3. Click "Save As" (`button[aria-label="Save As"]`), confirm the save.
4. Close the tab and re-open the saved file.

Expected: The rotated page stays rotated (renders landscape) after reopen — the /Rotate value written to the PDF is honored. Phase 2 criterion 4: "Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages."

Actual: The page-1 canvas renders 1156x1496 (portrait, aspect 0.773) after reopen, and `engineState.rotations[0]` is 0 — the rotation is silently gone. Reopening the file in TFlex loses the rotation (the saved file itself does carry `/Rotate=90` on page 1 when parsed with pdf-lib into a fresh document, but TFlex does not re-read it into its render/engine model). The user's page transformation is silently discarded on save+reopen.

Screenshot: measured page-1 canvas aspect before save = 1.294 (landscape) vs after reopen = 0.773 (portrait). (SEE `e2e/probe_rotate.spec.cjs`.)

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-138). Open report.pdf, click `[data-toolbar-rotate-cw]` -> `engineState.rotations[0]` becomes 1 and the page-1 canvas swaps to 1496x1156 (aspect 1.294 landscape). Save As to a temp path, then close the tab and re-open the saved file: after reopen `engineState.rotations[0]` is still 1, `rotations[1]` is 0, and the page-1 canvas renders 1496x1156 (aspect 1.294 landscape) — the rotation is no longer silently dropped. Screenshot screenshots/def-138-1712-after-reopen.png. Regression checked: no pageerror during rotate/save/reopen; the rest of the save path is unaffected (a subsequent rotate re-save again round-trips). CLOSED.



## DEF-137: Drawn/created annotations are silently dropped on save — no PDF annotation object, no baked content, not reloadable

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 3 (regression on installed v1.7.11)

Steps to reproduce:
1. Launch TFlex (installed v1.7.11 binary = 9dcf83c source), open the report.pdf sample.
2. Arm the Pen (annotation toolbar `[data-tool="ink"]`) and draw a stroke on page 1.
3. Arm the Sticky note (`[data-tool="note"]`), click a point on page 1, type "DEFECT NOTE 137", confirm (note icon + text render on the page).
4. Verify both annotations are present: `window.tflexDiagnostics().engineState.annotations` has 2 entries (kind "ink" and kind "note" with content "DEFECT NOTE 137"), and the page shows the stroke + note icon + text.
5. Click the toolbar "Save As" (button[aria-label="Save As"]), confirm the save (file is written).
6. Re-open the saved file (close the tab, re-open the saved path).

Expected: The annotations are written into the PDF as standard annotation objects (Phase 3 criterion 4), so they appear when the file is re-opened in TFlex and in any other PDF reader; the note content survives.

Actual: The saved PDF contains ZERO annotation objects and ZERO per-page `/Annots` entries (parsed with pdf-lib: `PDFDocument.load` then enumerating every indirect object yields no `/Type /Annot` dict on any page, and every page's `/Annots` array has size 0). The ink stroke and the note are NOT baked into the page content either. Re-opening the saved file in TFlex shows a completely clean page-1 (no ink stroke, no note icon, no note text) and `engineState.annotations` is `[]`. The user's annotations are silently lost on save. (Note: the saved file is ~1 KB larger than a rotation-only save, consistent with the annotation dicts being registered as orphaned objects that no page `/Annots` references.)

Screenshot: screenshots/def-137-before-save.png (ink stroke + "DEFECT NOTE 137" note visible on page 1) vs screenshots/def-137-after-reopen.png (the same page after save+reopen is clean — both annotations gone).

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-137). Open report.pdf, arm the Pen `[data-tool="ink"]` and draw a stroke on page 1, arm the Sticky note `[data-tool="note"]`, click a point, type "DEFECT NOTE 137", confirm. Pre-save: `engineState.annotations` = [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}]. Save As to a temp path, then close the tab and re-open the saved file. pdf-lib parse of the saved bytes: pageCount 34, per-page /Annots counts [2,0,0,0,0,0], with 1 `/Subtype /Ink` and 1 `/Subtype /Text` (note) annotation object on page 1 — the annotations are real PDF annotation objects, not orphaned. After reopen: `engineState.annotations` hydrates back to [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}], and the page renders `.ann-ink` = 1 and `.ann-note` = 1 with the note text visible (screenshots def-137-1712-before-save.png vs def-137-1712-after-reopen.png — both the ink stroke and the "DEFECT NOTE 137" note render before save AND after reopen). Regression checked: no pageerror during annotate/save/reopen. CLOSED.



## DEF-136: Selecting a placed Add-box text box offers no Delete/Remove option

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle on the page, type "MY BOX", Ctrl+Enter to commit.
4. Click the placed box (either to move or just to select it).

Expected: A placed text box can be deleted (a Delete/Remove action, parity with the Edit-image tool's "Remove" button).
Actual: The box shows only the inline editor (Font / Size / Color / confirm / cancel) and corner handles — there is NO Delete/Remove affordance. The Edit-image tool shows a toolbar with Replace / Crop / Remove; the Edit-toolbox tool has no equivalent, so a committed text box cannot be removed without undoing the whole add. Screenshot: screenshots/def-137-box-selected.png (the selected box's chrome has no Delete/Remove control).
Root cause: `src/renderer/edit/EditOverlay.tsx` `TextBoxView` renders only the box surface + resize handles (no `.edit-box-toolbar`). Only `PlacementToolbar` (the image tool) provides a Delete/Remove button; the box tool has no action bar wired to remove a committed box from the registry / engine.
History:
- qa: opened (ground-truth on installed v1.7.10; box selected => `selected:true`, no `.edit-box-toolbar` / delete button in the box chrome).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place an Add-box, commit, click it -> the inline editor reopens; Escape closes it, leaving the box `.edit-box-selected`. A `.edit-box-toolbar` appears with BOTH `[data-edit-box-action="edit"]` (reopens the editor with the box's committed content) and `[data-edit-box-action="delete"]` (engine.deleteTextBox). Clicking Delete removes the box: the rendered `.edit-box` for that id count = 0 AND the engine registry `EngineState.textBoxes` no longer holds it. Text boxes are an engine-side placement registry (addTextBox / moveTextBox / deleteTextBox + `EngineState.textBoxes`). Screenshots screenshots/def-136-box-toolbar-delete-edit.png, def-136-after-delete.png. CLOSED.

## DEF-135: Moving an Add-box text box that covered text erases that text (white-mask artifact)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle directly over the title run "TFlex Technical Report"; type "MY BOX"; Ctrl+Enter to commit.
4. Drag the box body (e.g. 120px right / 120px down) to move it to a new spot.

Expected: Moving a text box moves the box (and its text) to the new spot, leaving the page content it covered intact.
Actual: The box moves, but the area where the box originally sat is permanently masked with a white rectangle — the title "TFlex Technical Report" is visually erased (blank) even after the box moves away. The string stays in the pdf.js textLayer (so it remains selectable in the DOM), but the painted page no longer shows it. Screenshot: screenshots/def-137-after-move.png (title gone where the box was; "MY BOX" sits at the new spot).
Root cause: `EditOverlay.tsx` `onPointerUp` textBoxMove path -> `onCommitTextBoxMove` -> the host re-bakes the box through the engine's `editImage` mask-and-draw contract (white `drawRectangle` over `oldRect`), which erases whatever content was under the box's ORIGINAL rect. This is the same mask-and-draw limitation as DEF-116/124 (mask, don't strip) now surfaced when moving a box over real content — content under a moved box's old position is lost from the visible page.
History:
- qa: opened (ground-truth on installed v1.7.10; box placed over the title, moved 120px, title area masked/erased).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place an Add-box directly over the title "TFlex Technical Report", commit ("MY BOX"), then drag the box 120px right / 120px down. The title REGION of the page-1 canvas keeps dark-fraction 0.2178 BOTH before and after the move (pixel-identical — NO white-mask artifact), and the "TFlex Technical Report" span stays in the textLayer; the title is visibly intact. Text boxes are now an engine-side placement registry (addTextBox pushes a `TextBoxModel`, no pdfDoc mutation; moveTextBox updates the rect; drawn ONCE at the FINAL rect at save), so moving a box never masks the content under its old rect. Save + re-parse with pdf-lib: valid 34-page PDF. Screenshot screenshots/def-135-after-move.png. CLOSED.

## DEF-134: Dragging a committed signature, then clicking it, reverts to the previous position

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, click toolbar "Sign tool", Type tab -> type "QA" -> Save -> pick the saved signature.
3. Click the page to place, Confirm to commit (placement rect left 200 / top 200).
4. Drag the committed placement 120px right / 60px down (it renders at left 320 / top 260 — the uncommitted move rect).
5. Click the placement again WITHOUT pressing Confirm on the floating action bar.

Expected: The signature keeps the dragged position (the move is applied live); a click should not discard an in-progress move.
Actual: The click reverts the placement back to its PREVIOUS (committed) position — left 200 / top 200 — and the drag result is lost. The new position is not applied; the user must click Confirm, but any incidental click on the placement discards the move. Screenshots: screenshots/def-135-after-drag.png (moved to 320,260) and screenshots/def-135-after-click.png (reverted to 200,200).
Root cause: `SignaturesOverlay.tsx` `onPointerDownPlacement` calls `setPendingMoveRect(null)` at the very top (line ~219) on EVERY new pointerdown on a placement, including a plain click. That clears the held (uncommitted) `pendingMoveRect` before the drag/commit can happen, so the placement re-renders at the committed `p.rect` and the move is discarded.
History:
- qa: opened (ground-truth on installed v1.7.10; placement rect 200,200 -> drag -> 320,260 -> click -> 200,200).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place a typed signature at rect 200,200 and Confirm. Drag 120px right / 60px down -> the placement rect becomes 320,260 (the move is applied LIVE, visible before confirm). Click the placement WITHOUT pressing Confirm -> rect STAYS 320,260 (no revert; dxFromInitial=120). Click Confirm -> the new position 320,260 is committed. Root cause fixed: `onPointerDownPlacement` no longer clears a held `pendingMoveRect` that belongs to the SAME placement (the `SIG_CLICK_TOLERANCE_PX` = 4 click path preserves it), so a post-drag click no longer snaps the signature back. Screenshots screenshots/def-134-after-drag.png, def-134-after-click-no-revert.png, def-134-after-confirm-commit.png. CLOSED.

## DEF-133: After inserting a blank page, drawing an annotation on pages 2/3 silently places it on the wrong page

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf (34 pages), Tools palette -> "Insert pages", blank mode, "Insert at page" = 2, Insert (pageCount 34 -> 35).
3. Scroll to the visible page 2 (the new blank) and confirm the page order is correct: engineState.pageOrder becomes [0,34,1,2,...] — the new blank IS page 2. (The page-order claim does NOT reproduce; see note.)
4. Arm the Pen (annotation toolbar "Pen" / data-tool="ink") and draw a stroke on visible page 2; then draw a Rectangle on visible page 3.

Expected: The ink stroke / rectangle appears on the page the user drew on (visible pages 2 and 3).
Actual: No annotation appears on the page that was drawn on. The engine state records 1 annotation (`engineState.annotations.length === 1`), and the stroke actually renders on the LAST visible page (page 35) — a pen stroke drawn on visible page 2 lands on visible page 35; a rect drawn on visible page 3 lands on page 2. The user's mark is silently placed at the wrong position in the document. Screenshot: screenshots/def-133-pen-misplaced.png (ink drawn on page 2; appears on page 35).
Root cause: `DocumentView.tsx` renders `<PageView pageNumber={sourcePage} ...>` where `sourcePage = visibleToSourcePage(visiblePage, engineState.pageOrder)` (the pdf.js SOURCE page, origIdx+1). `PageView.tsx` passes `page={pageNumber}` (the source page) to `<AnnotationOverlay>`, which stamps the created annotation's `page = sourcePage`. The engine's `annotations.createAnnotation` (`src/main/services/annotations.ts:246`) treats `payload.page` as the VISIBLE page and computes `origIdx = order[visiblePage - 1]`. After a reorder these differ (visible page 2 -> source page 35 / origIdx 34), so the annotation is stored on the WRONG origIdx and rendered on the wrong visible page.
NOTE: The report's "LAST page gets moved to position 2 and the NEW page lands at position 3" page-order claim is NOT reproduced — `pageOrder[1]` === 34 (the new blank), i.e. the blank correctly becomes page 2 and the original last page stays at the end. The defect is the annotation page-number mismatch, which makes drawing tools appear broken on pages 2/3.
History:
- qa: opened (ground-truth on installed v1.7.10; page order correct, but ink on visible page 2 -> page 35, engine annotations = 1).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Insert blank at position 2 -> pageCount 34->35, pageOrder [0,34,1,2,...], the new blank IS visible page 2, unique 35 (insert-blank regression clean, no duplicate). Arm the Pen and draw a stroke on VISIBLE page 2; arm the Rectangle and draw on VISIBLE page 3: engine annotations = [{kind:ink,page:2},{kind:rect,page:3}] — the pen lands on visible page 2 and the rectangle on visible page 3 (was page 35 / page 2). Committed ink is rendered on the visible page-2 slot. Root cause fixed: PageView now threads BOTH `page` (the VISIBLE index, used by every overlay to create content) and `sourcePage` (the pdf.js proxy index, used only by `doc.getPage(sourcePage)` to render), so an overlay no longer stamps the SOURCE page number into the annotation. Screenshot screenshots/def-133-pen-correct-page.png. CLOSED.

## DEF-132: Frameless window cannot be moved by dragging the title bar

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source). The window is created with `frame: false` (no native title bar).
2. Attempt to move the window by pressing and dragging anywhere on the top title bar (the brand / tab strip / empty caption area).

Expected: The window behaves as a normal draggable Windows window — dragging the caption strip moves it (and Aero Snap works at the screen edges).
Actual: The window cannot be moved by dragging the title bar. Sampling the computed `-webkit-app-region` across the title bar yields `draggablePx = 0` and `noDragPx = 60480` — every pixel of the 1442x44 title bar resolves to `no-drag`; the full-width `.titlebar-slot` (1264px, flex:1) and the `.app-header` inside it are both `-webkit-app-region: no-drag`. With `frame: false` there is also no native caption area to grab, so the window has no mouse-drag affordance at all. Screenshot: screenshots/def-132-titlebar-region.png.
Root cause: `src/renderer/styles.css` — `.titlebar { -webkit-app-region: drag }` (line 312) is defeated by `.titlebar > * { -webkit-app-region: no-drag }` (line 317-319), which applies `no-drag` to the `.titlebar-slot` (the direct child that fills the whole bar width) and `.titlebar-controls`/`.titlebar-menu`. The `.app-header` inside the slot also declares `-webkit-app-region: no-drag` (line 282). Because the slot spans the entire bar (the only free drag surface is the leftover padding, which is zero-width given the slot is `flex: 1 1 auto`), there is effectively no draggable caption region. Combined with `frame: false` (src/main/window.ts:64) there is no native caption either — so the window is immovable by mouse.
History:
- qa: opened (ground-truth on installed v1.7.10; region map: titlebar-slot and app-header both no-drag, dragPx=0).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). The `.titlebar` computes `-webkit-app-region: drag`; `.titlebar-slot` and `.app-header` both resolve to `drag` (the DEF-132 `.titlebar > * { no-drag }` rule is gone — only interactive children opt out via scoped `.titlebar-menu-*` / `.titlebar-control*` / `.app-header button,input,select,textarea` rules). Region map over the 1442x44 bar: dragPx=46836, noDragPx=13644, so 72.7% of the caption strip is draggable (was dragPx=0). The frameless window is now movable by dragging the caption strip. Screenshot screenshots/def-132-titlebar-draggable.png. CLOSED.

## DEF-131: "Per page" crop applies the crop to EVERY page, not just the selected one

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages, every page 612x792 pt).
3. Tools palette -> "Crop pages", switch mode to "Per page".
4. On the page-1 editor drag the SE crop handle inward (shrink the box) — summary reads e.g. x 61.2 / y 79.2 / width 285.6 / height 429.6 pt.
5. Click "Apply crop".

Expected: Only page 1 is cropped; pages 2+ keep their full 612x792 box.
Actual: The toast reads `Cropped 1 page.`, but EVERY page renders at the cropped size. Measured `.pdf-page[data-page]` BEFORE crop: pages 1-3 all `1156x1496 px` (`--scale-factor: 1.888`, i.e. full 612x792). AFTER crop: pages 1-3 all `1156x1739 px` (`--scale-factor: 4.047`, i.e. 285.6x429.6). So a per-page crop on page 1 silently cropped the whole document.
Screenshot: screenshots/gt_b11_after_crop.png (before/after page sizes in the run log).

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; per-page crop sent one entry — toast "Cropped 1 page." — yet all pages render cropped after the post-crop proxy refresh).
- qa: retested on installed v1.7.9 (FileVersion 1.7.9, exe 02:56 newer than all src). Crop page 1 per-page (drag SE inward), Apply -> toast "Cropped 1 page."; after the proxy refresh page 1 renders at aspect 0.7458 (=cropped, deviates from full 0.7727) and is NARROWER than pages 2/3, while pages 2 and 3 stay full-aspect 0.7729 and identical to each other — the crop no longer propagates to the other pages. Definite: the post-crop global re-fit scale changes the absolute px of pages 2/3 (the zoom jumps to fit the current page), which is pre-existing fit-to-current-page behaviour, not the crop-propagation bug; the CropBox/TrimBox are NOT copied onto the other leaves (pinned by test/unit/main/def130_131_124.test.ts). Regression checked: save is unaffected, no pageerror. Screenshot screenshots/def-131-after-crop.png. CLOSED.

## DEF-130: Re-inserting a blank page after an undo throws "degreeAngle must be of type number, but was actually of type NaN"

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", blank mode, "Insert at page" = 2 (blank lands after page 1), Insert.
4. Undo (rail "Undo last change") — pageCount returns to 34.
5. Insert a blank page again (same settings).

Expected: The second insert completes cleanly.
Actual: A toast appears: `Could not refresh document proxy: Engine error: getDocumentBytes failed: `degreeAngle` must be of type `number`, but was actually of type `NaN``. The post-insert proxy refresh (`refreshDocProxyFor` -> `engine.getDocumentBytes`) throws.
Screenshot: screenshots/gt_b9_reinsert.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; the reported error string is reproduced verbatim).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Insert blank after page 1 ("2"), Undo -> pageCount 34, re-insert -> pageCount 35, pageOrder [0,34,1,2,...] with no duplicates, thumbCount 35 (proxy refreshed). NO "degreeAngle ... NaN" toast, NO `degreeAngle`/`NaN` pageerror, no React #310. Root cause fixed: insertBlankPage now snapshots the pdfDoc bytes (snapshotDocWithPdf) so undo reverts the pdfDoc too, plus a finite-guard at the serialize site; pinned by test/unit/main/def130_131_124.test.ts. Screenshot screenshots/def-130-after-reinsert.png. CLOSED.

## DEF-129: Insert-blank page at position 1 is impossible — the Insert button is disabled

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", mode "Blank page".
4. Set "Insert at page" to `1`.

Expected: Inserting a blank page at position 1 (before page 1) is allowed.
Actual: The Insert button is `disabled`. Entering `2` enables it. (The dialog hint also states "A blank page cannot be inserted before page 1.")
Screenshot: screenshots/gt_b8_pos1_disabled.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Insert pages -> blank mode -> "Insert at page" = 1: the Insert button is ENABLED (confirmDisabled=false), and Inserting prepends a blank page that becomes page 1 (pageCount 34 -> 35, pageOrder [34,0,1,2,...], unique 35, original page 1 now page 2). The dialog hint now reads "1 inserts before page 1" and the result matches (DEF-122 semantics consistent). No "Invalid page request" pageerror (DEF-121 regression). Pinned by the new `-2` PREPEND sentinel (slot 0 -> afterIndex -2) in App.tsx + test/unit/main/def130_131_124.test.ts. Screenshot screenshots/def-129-after-prepend.png. CLOSED.

## DEF-128: Closing an unsaved SAMPLE (bytes-loaded) tab with "Save" fails with "no on-disk path" instead of offering Save As

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open the report.pdf sample (bytes-loaded, no on-disk path).
3. Make an edit (e.g. rotate a page — toolbar Rotate clockwise) so the tab is modified.
4. Click the tab's close button.
5. In the "Unsaved changes" prompt click "Save".

Expected: The prompt offers Save As (or routes Save to Save As for a bytes-loaded doc) and closes the tab after saving a copy.
Actual: The prompt shows an inline red error `This document has no on-disk path. Use Don't save to discard, or open Save As first.` and stays open — the user cannot save their work first.
Screenshot: screenshots/gt_b7_after_save.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Open report.pdf sample (bytes-loaded), rotate a page (modified=true), click tab close -> the "Unsaved changes" prompt's Save button reads "Save As…" (no inline "no on-disk path" hard-block error). Stubbed the OS save dialog to a temp path and clicked "Save As…": the tab saves-and-closes (prompt gone, 0 tabs), and the saved file is a real, re-parseable 34-page PDF (pdf-lib getPageCount=34). Pinned by test/unit/renderer/bugDEF128_closePromptSaveAs.test.tsx. Screenshot screenshots/def-128-prompt-save-as.png. CLOSED.

## DEF-127: Add-box: dragging a committed text box moves only the surface (text stays put); clicking it does not reopen the editor

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle on the page; type text ("My test box"); Apply.
4. Drag the committed box 120px right / 60px down.
5. Click the (moved) box.

Expected: The box AND its text move together; clicking the placed box reopens the inline editor.
Actual: Only the dashed `.edit-box` surface moves (its rect goes from 448,345 -> 568,405); the baked text "My test box" stays at the original spot (an empty blue box moves and persists). Clicking the box does NOT reopen the editor (no `.edit-inline-editor` mounts).
Screenshot: screenshots/gt_b5_box_after_drag.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit -> Add box -> drag a box, type "DEF127 MOVABLE BOX", Ctrl+Enter. The committed box surface mirrors its content ([data-edit-box-text-mirror] = "DEF127 MOVABLE BOX" + .edit-box-fill). Re-arm box tool and drag the box: the whole box moves (rect 428,366 -> 538,436, moved=true) AND the text mirror travels with it -> no empty phantom at the old spot (boxCount stays 1). Clicking the moved box reopens the inline editor pre-filled with "DEF127 MOVABLE BOX". Pinned by test/unit/renderer/bugDEF127_textBoxMoveRebake.test.tsx. Screenshots screenshots/def-127-after-drag.png, def-127-click-reopens-editor.png. CLOSED.

## DEF-126: OCR suspects top bar has dead space, overlaps the Tools panel and left thumbnail rail, and is opaque

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open scanned.pdf, Tools palette -> "Recognize text (OCR)", set scope to "Current page", Recognize.
3. After the run the OCR suspects panel opens.

Expected: The suspects bar sits flush below the toolbars, inside the document area, with the doc/tools/rail content reflowing around it and a translucent background.
Actual:
  (a) Dead empty space — the bar's computed `top` is 100px, but the real toolbar (44px) + ann-toolbar (40px) bottom is 84px, leaving a ~16px unexplained gap.
  (b) The bar spans `left:0; right:0` (1442px) over the left thumbnail rail (x 0..220) and over the right Tools palette (x 1162..1442).
  (c) It does not reflow the content — it is an absolute overlay with `max-height:172px; overflow:hidden`, covering the rail/palette/document.
  (d) Background is fully opaque `rgb(14,17,21)` (not translucent).
Screenshot: screenshots/gt_b4_ocr_full.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; layout measured: panel y=144.67, w=1442, bg rgb(14,17,21), top:100px, z-index 40).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). scanned.pdf -> Recognize text -> current page -> OCR; the suspects panel is now a FLOW element (position static) at the very top of app-main: panel.top == appMain.top == 44.67 (flush, no dead gap under the top bar), panel.bottom (192.67) == rail.top (192.67) (the content reflows directly beneath it), background rgba(14,17,21,0.82) = translucent, and true 2D intersection with the left thumbnail rail and the right Tools palette is 0 (overlapRail=0, overlapPalette=0; the palette downshifts via `.app-main:has(.ocr-suspects-panel) .tools-palette`). No longer a stale-offset opaque absolute overlay. Pinned by test/unit/renderer/bugB4_ocrTopBarCss.test.ts. Screenshot screenshots/def-126-suspects-panel.png. CLOSED.

## DEF-125: Sign tool cannot be applied while Edit mode is active, and clicking Sign does not exit Edit mode

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose the "Edit text" tool (the per-page `.edit-layer` becomes `edit-layer-active`).
3. Click toolbar "Sign tool", save + pick a signature in the manager.
4. Click the page to place the signature.

Expected: Clicking Sign exits Edit mode, or the signature still lands on the page.
Actual: Edit mode stays active (Edit toggle `aria-pressed=true`, edit toolbar present, `.edit-layer` `edit-layer-active`); the signature click produces NO pending placement (`[data-sig-pending]` false, `[data-sig-action-bar]` false, `.sig-placement` 0). The signature cannot be applied while an edit tool is active.
Screenshot: screenshots/gt_b3b_place_attempt.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit toggle -> Edit text tool (.edit-layer-active). Click the Sign tool: Edit mode exits (Edit toggle aria-pressed=false, edit toolbar gone, edit layer no longer active). Create + arm a typed signature, click the page -> the pending placement + action bar appear, and Confirm commits a `.sig-placement` on the page (placementCount=1). No React #310 anywhere. The arm sites (toolbar tflex:sign-button, palette Sign, onSigManagerApply) all call setEditMode(false) guarded by editModeOpenRef; pinned by test/unit/renderer/bugDEF125_signExitsEditMode.test.ts. Screenshot screenshots/def-125-placed-on-page.png. CLOSED.

## DEF-124: Edit-text leaves a faint trace of the old run behind — the white mask does not cover the full glyph rect

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit, choose the "Edit text" tool.
3. Click the subtitle run "A study in PDF orchestration and performance."; the inline editor opens (mode "edit").
4. Replace with a longer string, then "Apply" (Ctrl+Enter or the apply button).

Expected: The old run is fully replaced with no ghost, and is no longer present in the document content.
Actual: The new text renders with a faint gray trace of the OLD run behind/below it — the white mask covers only the pdf.js text-item bbox, not the full painted glyph extents. The page's `.textLayer` still contains the original run string, so the old text remains selectable/searchable in the content stream.
Screenshot: screenshots/gt_b2_clean_zoomed.png (old-run ghost visible behind the new text)

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit -> Edit text -> click the "TFlex Technical Report" title run (editor opens pre-filled), replace with "ZZZ REPLACEMENT 987654", Ctrl+Enter. The new text renders in the live textLayer (proxy refreshed) and the screenshot shows NO faint gray trace of the old run behind/below it (subtitle and title area are clean after the mask is widened). The white mask now covers the old run's bbox + symmetric PAD + font ascent above + descent below (mask width > bbox width and mask height > bbox height, verified in the saved content stream); pinned by test/unit/main/def130_131_124.test.ts. NOTE: mask-and-redraw remains the v1 approach (DEF-116 was REJECTED) — the old run is still in the content stream, but the visual ghost is gone. Screenshot screenshots/def-124-after-edit.png. CLOSED.

## DEF-123: Placed signature click shows only move/resize handles, not the Confirm/Cancel/Delete action bar

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, click toolbar "Sign tool", Type tab -> type "QA Ground" -> Save, pick the saved signature.
3. Click the page to create a pending placement; the action bar (Confirm/Cancel/Delete) appears.
4. Click Confirm to commit the placement.
5. Click the now-placed signature.

Expected: Clicking a committed placement re-shows the same Confirm/Cancel/Delete action bar (parity with placement time).
Actual: Only the four corner move/resize handles appear (`.sig-handle`). There is NO `[data-sig-action-bar]` and no `[data-sig-action]` buttons for a committed placement.
Screenshot: screenshots/gt_b1_clicked_placed.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Sign tool -> Type "QA Ground" -> Save -> pick; click the page, Confirm to commit. Clicking the committed `.sig-placement` now re-shows the SAME Confirm/Cancel/Delete action bar ([data-sig-action-bar] + confirm/cancel/delete all present) AND selects the placement (corner handles). Dragging the committed placement moves its placeholder rect (568,456 -> 628,501, moved=true) while the bar stays (uncommitted hold), and clicking Confirm commits the move and ends the selection (bar gone, placement still present, no #310). Bar-button press does not start a drag / no swallow. Pinned by test/unit/renderer/bugDEF123_committedSigActionBar.test.tsx. Screenshots screenshots/def-123-after-click-bar.png, def-123-after-drag.png. CLOSED.

## DEF-121: Insert-blank-page (mid-document) throws unhandled pdf.js "Invalid page request" twice

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt + reinstalled 11:24 PM).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", leave mode "Blank page", set "Insert at page" to `1` (which lands the blank right after page 1), click Insert.
4. Watch the renderer console (`pageerror`).

Expected: The insert completes cleanly with no unhandled renderer errors.
Actual: Immediately after the insert (during the post-op pdf.js proxy rebuild / side-rail thumbnail render) the renderer throws `Error: Invalid page request.` from `pdfjs getPage` TWICE. The engine state and rendered result are correct (35 pages, blank at rank 2, pageOrder `[0,34,1,2,...]`, no duplicate pages), and the saved file re-opens as a valid 35-page PDF (document-safety check: save -> reopen -> pageCount 35, unique 35) — so this is NOT corruption. The error also does NOT occur on the append (`end`) path; it is specific to inserting a blank page into the MIDDLE of the document (a reorder). Recorded as an unhandled console error in a core user flow; no visible degradation, but the developer should confirm whether it should be caught.

History:
- qa: opened (ground-truth on installed v1.7.7; reproduced while running e2e/retests/release_gate_117_verify.spec.cjs B7; `pageerror` stack points to pdf.js `getPage` from within the renderer bundle during the post-insert proxy refresh).
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). Mid-document insert no longer throws "Invalid page request": e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 (insert blank at position 1 -> order0 [34,0,1,...], unique 35) asserts the pageerror filter "Invalid page request|degreeAngle|NaN" is empty and it PASSED (badErrors=[]); the re-insert path (DEF-130) also stays clean. Root cause fixed: the render paths now tolerate the temporarily-stale page index via `isInvalidPageRequest` (drop the attempt, let the doc-identity swap in `refreshDocProxyFor` re-run the render effect). Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts — `isInvalidPageRequest` helper (recognizes the rejection, ignores unrelated failures) + PageView.run/SideRail.Thumb guards import it. Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-after-prepend.png. CLOSED.)

## DEF-122: "Insert at page" hint contradicts actual placement — position N inserts AFTER page N, hint says it lands AS page N

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt + reinstalled 11:24 PM).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", mode "Blank page". The field help says: `Page number where the new content lands. Use end to append. 1 means "before page 1"; {totalPages + 1} means "appended after the last page"`.
4. Enter `1` and observe the placed page; then re-insert with `2` and observe.

Expected: Following the hint, entering `1` should make the blank page the FIRST page (before page 1), and entering `2` should make it the SECOND page (page 2).
Actual: Entering `1` makes the blank page the SECOND page (pageOrder `[0,34,1,2,...]`), and entering `2` makes it the THIRD page (pageOrder `[0,1,34,2,...]`). Every numeric position is off by one from the hint: the engine treats the value as "insert AFTER page N" (`afterIndex = N-1` -> `insertAt = N`), so position `N` lands the new page at rank `N+1`. Only the `end` sentinel and the `{totalPages+1}` extreme clamp to a correct append. A user following the written hint (e.g. "insert after page 1" -> entering `2`) gets the page one slot later than intended.

Root cause: InsertPagesDialog.tsx `parsed.position = N - 1` is passed as the engine `afterIndex` (0-based index AFTER which to insert), and `_insertBlankPageImpl` (engine.ts:1284) does `insertAt = afterIndex + 1`. The dialog's user-facing hint describes the value as "the rank the new content lands", which contradicts the engine's "after page N" contract. (The DEF-114 `end`/append fix is unaffected and still correct.)

History:
- qa: opened (ground-truth on installed v1.7.7; the "insert after page 1" flow is asserted in e2e/retests/release_gate_117_verify.spec.cjs B7 via position "1", and the off-by-one was characterized against position "1" and "2").
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). The position value now uses rank semantics — the page number the new content BECOMES — so the hint and the placement agree, and the off-by-one is gone: e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 inserted blank at "1" -> blank becomes page 1 (order0 [34,0,1,...], order[0]=34); DEF-130 inserted at "2" -> blank becomes page 2 (order0 [0,34,1,...]). Slot 0 maps to the engine afterIndex -2 PREPEND sentinel (valid in blank mode, no "cannot insert before page 1" guard) and the dialog min is now 1. DEF-114 append sentinel (end/empty -> -1) unchanged. Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts (slot-to-afterIndex translation + dialog min=1). Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-position1.png. CLOSED.)

## DEF-117: Modal dialogs cannot open — React #310 (Rules of Hooks) from the B3/B6 backdrop refactor; whole UI unmounts to a black window

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7 regression)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45, exe newer than all src).
2. Open report.pdf (34 pages).
3. Click the "Sign" toolbar button (`button[aria-label="Sign tool"]`).

Expected: The Signature manager modal (`.sig-manager`) opens so a signature can be drawn, typed, or a saved one picked and armed for placement.
Actual: The renderer throws `Minified React error #310` ("Rendered more hooks than during the previous render") and the ENTIRE app UI unmounts to a black window (screenshots/def-117-sign-flow-broken.png) — no modal, no toolbar, no page. The identical #310 fires when any other modal-opening control is clicked (Export to Word, Insert pages, Crop pages, Recognize text, Save-As, Optimize, Merge, Split, Stamp, Flatten, etc.), so it is not specific to Sign.

Root cause: The B3/B6 fix re-wired every modal backdrop through the shared `useBackdropClose` hook (src/renderer/components/modalBackdrop.ts). In 21 dialogs the hook is called AFTER the component's `if (!open) return null;` early return (e.g. SignatureManagerModal.tsx:72-77, DocxExportDialog.tsx:132-138, CropPagesDialog.tsx:168-174, InsertPagesDialog.tsx:156-162, OcrDialog.tsx:293-297). That violates the Rules of Hooks: when `open` flips false→true the hook count grows by one (`useRef` inside `useBackdropClose`), so React throws #310. The error is uncaught (no error boundary) and React unmounts the whole root, leaving a black window.

Affected dialogs (21, all with the hook after `if (!open) return null;`): SignatureManagerModal, DocxExportDialog, CropPagesDialog, InsertPagesDialog, OcrDialog, DeletePageDialog, RenumberPagesDialog, ReplacePagesDialog, SaveAsDialog, OptimizeDialog, AuditSpaceDialog, MergeDialog, SplitDialog, ExportDialog, TextExportDialog, CreateFromImagesDialog, StampDialog, CommentExportDialog, CommentImportDialog, CloseTabPromptDialog, FlattenConfirmDialog.

Impact: This blocks the v1.7.7 verification of B1 (sign placement + re-click handles), B3/B6 (DOCX/Crop/Insert dialog stays open on a text-selection drag-out; genuine backdrop click still closes), B4 (OCR suspects panel as a top bar + no overlapping white text after OCR), B7 (insert blank page after page 1 shows exactly 35 thumbnails with no duplicate / stray "Page 17"), B8a (crop mode-switch no flicker) and B8b (per-page crop crops only the adjusted page). None of those flows can be exercised because the modal they live in never mounts. Repro note: B1/B3/B6/B7/B8a/B8b all timeout at `waitForSelector` for their dialog/modal, and each is accompanied by React #310 in `pageerror`.

Screenshot: screenshots/def-117-sign-flow-broken.png (black window after the Sign click; the #310 was captured in the renderer `pageerror`). Same black-window result captured at screenshots/gt-bug10-restored.png vicinity (any dialog open) and temp probes (b4_ocr.png).

History:
- qa: opened (ground-truth reproduction on installed v1.7.7, rebuilt 22:45). Reproduced via the Sign toolbar button, the Tools-palette Sign entry, a direct `window.dispatchEvent(new CustomEvent('tflex:sign-button'))`, and the Export-to-Word tool — all yield React #310 and a black-unmounted UI. The `useBackdropClose` hook is placed after `if (!open) return null;` in all 21 dialogs above; before the B3/B6 change these dialogs used a plain non-hook `closeOnBackdrop` (e.g. `git diff` on SignatureManagerModal.tsx shows `useRef` now added after the early return).
- qa: re-verified on installed v1.7.7 (reinstalled 11:24 PM, exe 23:24 newer than all src) via e2e/retests/release_gate_117_verify.spec.cjs (10 tests, all PASS). Source-level check: all 21 dialogs now place `useBackdropClose` BEFORE the `if (!open) return null;` guard (verified by scanning each dialog: hook line < early-return line). Runtime: opened Sign, DOCX, Crop, Insert and OCR dialogs in sequence — each mount (`.modal-backdrop` present, app not black) and `pageerror` captures ZERO React #310/#520 hook errors across the whole run. The entire DEF-117-blocked surface is now exercisable and verified: B1 (sign re-click shows select handles), B3/B6 (DOCX + Insert stay open on a text-selection drag-out; a genuine backdrop click still closes), B4 (OCR suspects panel renders as a full-width TOP BAR at z-index 40 above the tools palette 30, y=145, not behind it), B7 (insert blank after page 1 -> 35 pages, no duplicate, blank at rank 2, save+reopen valid), B8a (crop mode/page switch keeps the canvas node stable, no opacity-0 flash, no jump to 612x792), B8b (per-page crop crops only page 1 — toast "Cropped 1 page." + page 1 renders smaller than unadjusted pages 2/3), B8c (undo after a page op visually reverts), B10 (maximize/restore icon distinct from minimize). CLOSED.

## DEF-120: Undo (Ctrl+Z) after a page-mutating op does not refresh the pdf.js proxy — visual stays stale

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf.
3. Rotate page 1 via the toolbar "Rotate clockwise" button; confirm the page paints landscape.
4. Press Ctrl+Z.

Expected: The page visually reverts — the pdf.js proxy repaints the pre-rotate state (portrait).
Actual: Before the fix, the engine's undo reverted the model but the renderer's pdf.js `doc` proxy was never rebuilt, so the canvas kept painting the PRE-undo bytes and the page stayed stale.

Root cause: `App.onUndo`/`onRedo` updated the engine UI mirror (`setEngineUiFor`) but never called `refreshDocProxyFor`, so the visible page did not reflect the reverted engine state.

History:
- qa: opened (B8c ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). The undo-refresh mechanism is now exercised: rotate page 1 -> `engineState.rotations[0]` 0 -> 1 and the page canvas swaps 1156x1496 -> 1496x1156 (proxy refreshed, paints rotated page); Ctrl+Z -> `rotations[0]` back to 0, `modified` false, `canRedo` true, and the canvas swaps back to 1156x1496 (proxy refreshed, visual reverts). The `onUndo`/`onRedo` handlers now invoke `refreshDocProxyForRef.current` after `setEngineUiFor` (pinned by test/unit/renderer/bugB8c_undoRedoProxyRefresh.test.ts). NOTE: the named crop/delete variants are separately blocked by DEF-117 (their dialogs cannot open); the undo proxy-refresh itself is verified and working. CLOSED.

## DEF-119: Max/restore titlebar icon is identical to the minimize icon when the window is maximized

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf.
3. Click the maximize window control, then inspect the restore (maximize) button glyph vs the minimize glyph.

Expected: When maximized, the button's glyph is a distinct "restore down" overlapping-squares icon (and the tooltip reads "Restore window"), NOT the two inward arrows used by minimize.
Actual (pre-fix): `maximized ? Minimize2 : Maximize2` reused the minimize icon when maximized, so the two window controls were visually identical.

Root cause: TitleBar.tsx picked `Minimize2` for the maximize button while maximized, duplicating the minimize glyph.

History:
- qa: opened (B10 ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). `[data-window-maximize]` now renders `Copy` (two overlapping squares) when maximized — `maximized maxLabel= Restore window`, and `minimize svg outerHTML !== maximize svg outerHTML` (`distinct=true`). When restored it renders `Maximize2` with label "Maximize window" and also differs from minimize. Verified programmatically via the titlebar controls and visually. CLOSED.

## DEF-118: Committed add-box text is not selectable/movable in Edit mode; editor does not preview the chosen font

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf, click the Edit toggle, then the "Add box" tool.
3. Drag/place a text box, type "MOVABLE BOX 999" and press Ctrl+Enter to confirm.
4. Switch back into the box tool and try to drag the committed box; also pick Times/Courier in the editor before committing.

Expected: The committed box renders its full text live and is draggable/movable in Edit mode; the Font dropdown live-updates the editor textarea's fontFamily.
Actual (pre-fix): `engine.addTextBox` baked the box into the PDF and the renderer kept no registry, so the mouse could not drag a committed box (and it also did not render live, DEF-113).

Root cause: No per-tab text-box registry. The "box" tool now renders committed boxes as selectable `.edit-box` surfaces with corner handles; pointerdown selects and starts a move drag, pointermove dispatches `set-text-box-rect`.

History:
- qa: opened (B5 ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). Committed box renders full text live (`.textLayer` contains "MOVABLE BOX 999"; full string, no truncated fragment). In the box tool the committed box is a `.edit-box` surface that MOVES when dragged: rect left/top 428/395 -> 548/495 (moved=true, size 240x140 unchanged, clamped to page). Font picker live: selecting Times makes the editor textarea `fontFamily = "Times New Roman", Times, serif` and Courier makes it `"Courier New", Courier, monospace` before commit (the Font dropdown feeds the textarea's computed fontFamily live). Pinned by test/unit/renderer/bugB5_textBoxMove.test.tsx. CLOSED.

## DEF-116: Edit-text leaves the original run in the PDF — old title remains searchable/selectable after the edit

- Status: REJECTED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.6 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click the "TFlex Technical Report" title run so the inline editor opens pre-filled.
4. Replace the text with "ZZZ REPLACEMENT TEXT 123" and press Ctrl+Enter to confirm.

Expected: The edited run is replaced — the old "TFlex Technical Report" text is removed from the document, so it is no longer selectable/searchable/copyable and no longer present in the saved file.
Actual: The canvas paints the NEW title (DEF-108 is fixed), but the engine edits by MASKING the old run with a white rectangle and DRAWING the new text on top (`engine._editTextRunImpl`). The original "TFlex Technical Report" string stays in the PDF content stream; after the proxy refresh the live `.textLayer` still contains a visible-size stale span for "TFlex Technical Report" (x594,y327,w461,h45) at the SAME location as the new span (x594,y325,w515,h36). Selecting/copying the title area surfaces the hidden old title, and the saved PDF still contains the original run. (The app's own search index is rebuilt from the proxy and does NOT match the old title, so in-app Ctrl+F is correct; the issue is the document's own content.)
Root cause: `_editTextRunImpl` (engine.ts:1645) masks the old rect with `page.drawRectangle({color: rgb(1,1,1)})` instead of removing the original glyphs; pdf-lib's drawRectangle does not delete the underlying text operators, so pdf.js still extracts the masked old run into the textLayer.
Screenshot: screenshots/def-108-after-commit.png (shows new title live; the stale old-title span is in the textLayer), also screenshots/probe-108-search-old.png

History:
- qa: opened (discovered during DEF-108 retest on installed v1.7.6)
- orchestrator: REJECTED - pdf-lib has no content-stream tokenizer; stripping old text operators is a hand-rolled ~500-line high-risk rewrite. Mask-and-redraw is visually correct (old text hidden, only exposed by selection/extraction). Documented as v1 limitation; native dependency (qpdf/pdfcpu) is a future-phase item.

## DEF-115: Crop box adjustment flashes a larger crop-window artifact on commit

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Open the Tools palette -> "Crop pages" and wait for the crop editor to render the page.
4. Drag the SE corner handle of the crop box so the box grows, then release (commit).

Expected: The crop box updates smoothly with no visual flash; the page preview stays scaled and painted continuously.
Actual: Immediately after the mouseup commit the crop editor REMOUNTS — the page canvas disappears (opacity flashes to 0) and its CSS size jumps to the full unscaled 612x792 for one frame (a "larger crop window" artifact) before settling to the correct ~360x466. Verified by sampling post-commit frames: frame 0 yields canvasTag=null (new canvas node), canvasOpacity=0, canvasRect 612x792; frame 1+ settle to opacity 1, rect 360x466.
Root cause: CropPagesDialog.tsx line 268 renders `<CropEditor key={...currentBox.x-y-width-height}>`; the key embeds the box coordinates, so every committed box change unmounts/remounts CropEditor, recreating the canvas (previewReady false -> opacity 0) and briefly leaving the canvas at its intrinsic 612x792 CSS size before the render effect sets the scaled rect.
Screenshot: screenshots/gt-bug8-post-0.png (also gt-bug8-crop-open.png, gt-bug8-before-mouseup.png, gt-bug8-crop-after-drag.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Drag SE handle then release; canvas keeps `data-canvas-tag=CANVAS-A` across all 6 post-commit frames (no remount), computed opacity stays `1` (no 0-flash), canvas rect stays 360x466 (never jumps to the intrinsic 612x792). `CropEditor` key is now mode+page only. CLOSED.

## DEF-114: Insert blank page with "end"/empty position lands at the FRONT, not the end

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf (34 pages).
3. Open the Tools palette -> "Insert pages".
4. Leave mode as "Blank page" and type `end` into the "Insert at page" field (the field help says `end` = append; clearing the field maps to the same sentinel). Click Insert.

Expected: The blank page is appended as the LAST page (page 35); the existing 34 pages keep their order.
Actual: The blank page is inserted as the FIRST page of the visible order. `tflexDiagnostics().engineState.pageOrder` becomes `[34,0,1,2,…,33]` (the newly added blank origIdx 34 at index 0), and the view/rail render a scrambled result (blank page at the front, two blank-looking thumbs, a mislabeled "Page N"). Note the engine page count is correct (34 -> 35); this is NOT a literal two-page duplication, but an incorrect placement that scrambles the document. Inserting with the DEFAULT numeric position ("35") works correctly (pageOrder ends with 34).
Root cause: InsertPagesDialog.tsx maps `end`/empty to `position:-1` ("appended at end"), but onInsertPagesConfirm (App.tsx:3019) passes that value straight to `engine.insertBlankPage(docId, position, …)`; engine `_insertBlankPageImpl` (engine.ts:1215) treats `afterIndex = -1` as "insert before the first page" (`insertAt = 0`). Two different -1 contracts collide.
Screenshot: screenshots/gt-bug7-after.png (also gt-bug7-before.png, gt-bug7-insert-dialog.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Blank mode + position `end`: engineState pageCount 34 -> 35, modified=true, pageOrder=[0,1,...,33,34] — first=0 and last=34 (the new origIdx-34 blank page is the FINAL element, not the front). `_insertBlankPageImpl` now maps afterIndex<0 to `doc.order.length` (append). CLOSED.

## DEF-113: Add Box text is not rendered in the live view after confirming

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Click the Edit toggle, then the "Add box" tool.
4. Drag on the page to place a text box, type "HELLO BOX ADDED 456" in the editor and press Ctrl+Enter to confirm.

Expected: The committed text box renders its text on the page in the live document view.
Actual: The editor closes and the engine `modified` flag flips to true, but the new text is NOT rendered — the pdf.js textLayer contains no element with "HELLO BOX ADDED 456" and the page canvas still shows the pre-edit content. The edit only becomes visible after a save/reopen (the engine wrote it, the live view is stale).
Root cause: App.tsx `handleAddTextBox` (line 1785) calls `engine.addTextBox` + `noteOpApplied` but never rebuilds the renderer pdf.js `doc` proxy (unlike the OCR path which calls `refreshDocProxyFor` in `onOcrConfirm`). The DocumentView continues to render the pre-edit document.
Screenshot: screenshots/gt-bug5-after-commit.png (also gt-bug5-box-editor-open.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). The proxy IS now rebuilt (handleAddTextBox calls refreshDocProxyFor), so the box text DOES appear in the live canvas — but only "HELL" of the committed "HELLO BOX ADDED 456" renders. Committed textarea value was verified as the full "HELLO BOX ADDED 456"; the `.textLayer` after commit contains a single span "HELL" (visible SIZE_BIG, x548,y568,w161,h64) and no span with the full string; the DOM has no element with the full text; engine `annotations=[]`. Reproduced with BOTH a small box (200x214 CSS) and a large box (800x388 CSS) — always "HELL". Root cause is now the default font size for a new box, `EditInlineEditor`/`EditOverlay` `size = Math.round(textTarget.rect.height * 0.8)` (capped at SIZE_MAX=72), which is enormous for a box whose height is large; `wrapTextToWidth` hard-breaks "HELLO" -> "HELL"+"O" when "HELLO" exceeds the box width, and the box height only fits that first fragment line, SILENTLY DROPPING the rest of the user's text. Content is lost in the committed box. REMAINS OPEN (severity raised to HIGH — committed content silently dropped).
- qa: re-verified on installed v1.7.6 (rebuilt 17:29). Add box in report.pdf, type "HELLO BOX ADDED 456" + Ctrl+Enter: the editor closes (count=0) and the FULL committed text renders live — the `.textLayer` contains a single span "HELLO BOX ADDED 456" (boxTextVisibleFull=true, joined=true, truncatedOnly=false; no lone "HELL" fragment). Screenshot screenshots/def-113-after-commit.png shows the full string on the page at a normal legible size. The oversized default box font is gone — the box no longer hard-breaks and drops content. CLOSED.

## DEF-112: OCR does not make form field values (e.g. "John Doe") searchable

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open form.pdf (the page visibly shows a "John Doe" text field, plus "Engineering" and a listbox with "TypeScript" highlighted).
3. Open the Tools palette -> "Recognize text (OCR)", set scope to "Current page", click "Recognize text".
4. Wait for completion, then try to search (Ctrl+F) for "John Doe".

Expected: OCR makes the form's field value "John Doe" searchable/selectable.
Actual: OCR completes and the rebuilt textLayer gains the static content ("JavaScript", "Node.js", "React", "PDF Spec") but NOT the form field values — after-OCR textLayer = [ "TFlex Application Form", "TFlex", "Application", "Form", "JavaScript", "Node.js", "React", "PDF", "Spec" ]; `hasJohnDoe=false`; searching "John Doe" returns 0 hits. "John Doe", "Engineering" and "TypeScript" stay unsearchable.
Root cause: src/renderer/pdf/ocrRasterize.ts `rasterizeOnePage` (line 134) renders via `pdfPage.render({ canvasContext, viewport })` with pdf.js defaults (no `renderInteractiveForms`), so interactive AcroForm field-value appearance streams are never painted into the OCR PNG; tesseract therefore never sees "John Doe" and never writes it into the invisible text layer.
Screenshot: screenshots/gt-bug4-form-before-ocr.png, gt-bug4-after-ocr.png, gt-bug4-search-john-doe.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). `window.tflex.engine.getFormFields` returns 8 fields INCLUDING `applicant_name` = "John Doe" (and `department`="Engineering"), and the FormsOverlay renders `[data-form-field="form-0-applicant_name"]` with value "John Doe" — so the renderer form state DOES hold the value and OCR seeds it into AnnotationStorage (seedAnnotationStorage) with `annotationMode: AnnotationMode.ENABLE_STORAGE`. Yet after OCR the `.textLayer` is ["TFlex Application Form","TFlex"," ","Application"," ","Form","[]","JavaScript","TypeScript","Node.js","React"] — `hasJohnDoe=false`; searching "John Doe" returns 0 hits. The form-field appearance is still NOT baked into the OCR raster. REMAINS OPEN.
- qa: re-verified on installed v1.7.6 (rebuilt 17:29). Filled applicant_name with "John Doe" (renderer form state confirmed hasJohnDoe=true), ran OCR current page. After OCR the rebuilt `.textLayer` contains "John"," ","Doe" (joined "John Doe"), and Ctrl+F "John Doe" returns searchHits=1, searchIndexProgress built=1/total=1, search status "1 of 1". Screenshot screenshots/def-112-search-john-doe.png shows the search bar with "John Doe" and "1 of 1". The e2e assertion was updated to use `window.tflexDiagnostics().searchHits` (>=1) instead of the old per-span regex, because the textLayer splits "John"/"Doe" across spans. CLOSED.

## DEF-111: DOCX export ignores the selected page range and exports ALL pages

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf (34 pages).
3. Open the Tools palette -> "Export to Word (.docx)".
4. Set the "Page range" field to `1` (a single page), then click "Export".

Expected: The resulting .docx contains only page 1 (0 page breaks, one image/paragraph).
Actual: The export succeeds but produces a 34-page .docx — the extracted word/document.xml has 33 `<w:br w:type="page"/>` breaks (34 pages) and 34 `<w:t>` text runs; the file is byte-identical in size (56376) to the all-pages default export. The page range is ignored.
Root cause: src/main/services/engine.ts `_createDocxFromDocImpl` (line 1461) iterates `for (let vi = 0; vi < doc.order.length; vi++)` over the ENTIRE visible document (all `doc.order` pages), and only consults the passed `entries` to decide text-vs-image per page — it never uses `entries` to restrict the page set. The dialog's `runEngineExport` does limit `entries` to the range, but the assembly step re-expands to the whole doc.
Screenshot: screenshots/gt-bug3-docx-dialog.png, gt-bug3-docx-after-export.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Exporting page range "1" on report.pdf produces a real .docx (will-download state=completed, 2607 bytes, valid OOXML PK) whose extracted word/document.xml contains 0 `<w:br w:type="page"/>` page-break marks (exactly 1 page) and 0 `<w:t>` text runs (one image) — no `inner` error, dialog no error. `_createDocxFromDocImpl` now respects `entries` as the page set. CLOSED.

## DEF-110: Edit context-window bar press registers as an outside click and closes the editor

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click a text run so the inline editor opens (textarea pre-filled).
4. Press (mousedown/up) on a NON-focusable label inside the editor's toolbar bar (e.g. the "Font" label span), WITHOUT clicking outside the editor.

Expected: The editor stays mounted — a click on its own chrome is not an outside click. Context windows should only close on an explicit close/Cancel.
Actual: Pressing the "Font" label span closes the editor (`[data-edit-editor]` count -> 0); it is treated as an outside click. The textarea's onBlur fires because focus leaves the textarea to the body (relatedTarget null), the blur guard only bails when the new focus target is inside `.edit-inline-editor`, and a non-focusable label has no focusable target, so it commits/cancels and unmounts.
Root cause: EditInlineEditor.tsx `onTextareaBlur` (line 133) + the toolbar bar's non-focusable labels. There is no text-drag-outside / bar-press guard equivalent to InsertPagesDialog's B17 `backdropDownRef`. (Note: a text highlight-drag that starts inside the textarea and releases OUTSIDE the editor did NOT close it in the same test — the bar chrome press is the deterministically-reproducing path.)
Screenshot: screenshots/gt-bug6-after-bar-click.png (also gt-bug6-editor-open.png, gt-bug6-after-drag-outside.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Pressing (mousedown/up) on the editor's own "Font" label (non-focusable chrome) leaves `[data-edit-editor="edit"]` mounted (count=1 after press); a positive control on the explicit Cancel button closes it (count=0). The editor now guards bar chrome via `insidePressRef` set on the editor's `onPointerDown`. CLOSED.

## DEF-109: Edit inline editor size (arrow/spinner) control is inert

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool, and click a text run so the inline editor opens.
3. Focus the "Font size (pt)" number input. Press the up-arrow key, and also click the native spin-arrow zone.

Expected: The size value increments via the keyboard up-arrow and the spinner arrows.
Actual: The value stays at 19 after ArrowUp and after a spin-arrow click (`before=19, afterArrowUp=19, afterSpinClick=19`); the only way to change it is to select-all and type a new number (fill('48') -> 48). The editor stays open after these interactions (so it is not the outside-click path).
Root cause: EditInlineEditor.tsx line 214 sets `onMouseDown={(e): void => e.preventDefault()}` on the size `<input type="number">` (the Bug-9 focus guard). preventDefault on mousedown suppresses the native spinner/arrow auto-increment (and Chromium's arrow-up on a focused number input), so the arrows do nothing; direct typing bypasses mousedown and works.
Screenshot: screenshots/gt-bug2b-size-control.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Focus the size input: ArrowUp increments 19 -> 20; the native spinner up-arrow increments 19 -> 20 -> 21 when clicked on the top-right hit zone; the editor stays mounted throughout. The `onMouseDown preventDefault` was removed from the number input. CLOSED.

## DEF-108: Edit-text confirm does not render the updated text in the live view

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click the "TFlex Technical Report" title run so the inline editor opens pre-filled.
4. Replace the text with "ZZZ REPLACEMENT TEXT 123" and press Ctrl+Enter to confirm.

Expected: The title on the page updates to the new text in the live document view.
Actual: The editor closes and the engine `modified` flag flips to true, but the live pdf.js textLayer still reports the old run ("TFlex Technical Report" present, "ZZZ REPLACEMENT TEXT 123" absent). The canvas continues to paint the original text; the edit only appears after a save/reopen.
Root cause: App.tsx `handleEditTextRun` (line 1759) calls `engine.editTextRun` + `noteOpApplied` but never rebuilds the renderer pdf.js `doc` proxy (contrast the OCR path, `onOcrConfirm`, which calls `refreshDocProxyFor`). The DocumentView keeps rendering the stale pre-edit proxy.
Screenshot: screenshots/gt-bug2a-before-commit.png, gt-bug2a-after-commit.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Edit the title to "ZZZ REPLACEMENT TEXT 123" + Ctrl+Enter: the editor closes (count 0), `modified` = true, the canvas paints the NEW title, and the live `.textLayer` contains "ZZZ REPLACEMENT TEXT 123" (newVisible=true). `handleEditTextRun` now rebuilds the pdf.js proxy via `refreshDocProxyFor`. CLOSED. (NOTE: the original masked run still remains as hidden text in the PDF/textLayer — filed separately as DEF-116.)

## DEF-107: OCR suspects panel overlaps annotation/shapes toolbar (B14)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open the scanned.pdf sample.
3. Open the Tools palette and choose "Recognize text (OCR)".
4. Set scope to "Current page" and click Recognize.
5. Wait for the OCR suspects panel to open on the right.

Expected: The OCR suspects panel opens in its own space and does not overlap the annotation/shapes toolbar (`.ann-toolbar`).
Actual: The panel (x1162-1442, y45-904) overlaps the annotation/shapes toolbar (x220-1442, y89-129) by 280x40 px; the toolbar's right portion (Shapes group area) sits behind/in the panel. Verified by a true 2D intersection check across the OCR-suspects panel and `.ann-toolbar`. (Note: the panel correctly does NOT open on an empty tab and does NOT persist to a new tab.)
Screenshot: screenshots/b14-precise-overlap.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). OCR suspects panel now opens at y=145, below the `.ann-toolbar` (y89-129, h40); true 2D intersection check gives overlapH=0, overlaps=false. CLOSED.

## DEF-106: DOCX export crashes with "Cannot read properties of undefined (reading 'inner')" (B12)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Open the Tools palette and choose "Export to Word (docx)".
4. In the "Export to Word" dialog leave the defaults (Page range 1-34, Resolution DPI 150) and click "Export".

Expected: The export completes without error and produces a .docx.
Actual: The dialog shows a red status message "DOCX export failed: Cannot read properties of undefined (reading 'inner')" and no document is produced. Reproducible on every run.
Screenshot: screenshots/bug12-after-export.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). DOCX export completes with no error (dialog status null, no `inner` error, no console/page errors) and produces a real non-empty .docx — captured via main-process `will-download`, state `completed`, size 56376 bytes, valid OOXML ZIP (PK magic). CLOSED.

## DEF-105: Edit mode click on a text run does not open the text editor (B6)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Click the Edit toolbar toggle, then the "Edit text" tool.
4. Hover over a text run (e.g. the "TFlex Technical Report" title). A dashed hover border and "Click a text run to replace it" hint appear.
5. Click that text run.

Expected: A text editor (textarea) opens loaded with the run's text so it can be edited.
Actual: No editor appears. After the click, `[data-edit-editor="text"]`, `[data-edit-textarea]`, `.edit-overlay`, and any input/textarea are all absent; `activeTool` stays null. The hover affordance shows but the click is inert.
Screenshot: screenshots/b6-click-after.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). Edit-mode click on a text run opens the text editor pre-loaded with that run's text ("TFlex Technical Report"), and the editor is STILL present after a 3s wait — it does not auto-close. CLOSED.

## DEF-104: Sticky note text renders vertically, not co-located inside the note (B4/B5)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Select the Note tool and click a point on the page.
4. In the note editor type "Hello sticky note" and Confirm.
5. Observe the placed sticky note.

Expected: The note text renders horizontally, wrapped and co-located inside/with the note marker.
Actual: The text is stored and the marker is clickable (opens the pre-filled editor), but the text renders as a narrow vertical column (`.ann-note-text` ~48px wide x ~431px tall) — one character per line — beside the marker rather than as wrapped text in a note container. Violates "text visible inside / icon+text co-located".
Screenshot: screenshots/bug4-committed-note.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). Note text now renders horizontally, wrapped (210x48 px) and co-located inside/with the note marker; clicking the note icon opens the pre-filled editor (editorOpenAfterClick=true). CLOSED.

## DEF-103: After signing, Text Box/Rectangle/Circle tools stop placing annotations (B2)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Arm the Sign tool (Type "QA Suite", Save, pick the saved signature).
4. Click a point on the page and Confirm on the floating action bar to place the signature (Sign mode exits, ghost gone).
5. Click the Text Box tool (it activates, aria-pressed=true), then click another point on the page.

Expected: A Text Box action bar / editor appears so the user can type; Rectangle and Ellipse also place normally afterwards.
Actual: The tools activate but clicking the page creates nothing — no textbox bar, no editor, no committed annotation, no lingering signature pending state. Verified via isolation: a Text Box single-click creates the bar on a fresh doc, but does NOT after a Sign placement (bar=1 fresh vs bar=0 after sign). Rectangle/Ellipse clicks likewise place nothing.
Screenshot: screenshots/b2-after-sign-textbox.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). After a Sign placement + confirm, Text Box places (bar=1, editor=1, aria-pressed=true), and Rectangle (.ann rect=1) and Ellipse (.ann ellipse=1) also place; engine annotations = ["rect","ellipse"]. Sign mode exits (aria-pressed false). CLOSED.

## DEF-102: OCR suspects palette available on empty tab (B11)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Ensure at least one tab is open, then open a new empty tab via "+".
3. Open the Tools palette (Ctrl+Shift+P).
4. Observe the state of the "OCR suspects" (Recognize text) tool.

Expected: The tool should be disabled when no document is active.
Actual: The tool remains enabled (or the palette fails to open in the E2E environment due to state inconsistency), and if triggered, it may attempt to run on a null document.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B11: OCR disabled on empty tab` failed; palette selector `[data-tools-palette]` timed out. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Recognize text tool still enabled on empty tab. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified "Recognize text (OCR)" tool is disabled in palette when empty tab is active. CLOSED.

## DEF-101: Stamp foreground placement fails (B10)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Open the Stamp tool, select "APPROVED", and click "Place on page".
4. Click a location on the document page.

Expected: A stamp annotation appears at the clicked location.
Actual: No stamp annotation is created; the engine state does not reflect the placement.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B10: Stamp foreground placement` failed; locator `.stamp-annotation` not found. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Stamp placement still failing. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified stamp placement via `.stamp-annotation` surface. CLOSED.

## DEF-100: Flatten confirm dialog buttons blocked by backdrop

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a fillable form.
3. Trigger "Flatten form fields".
4. Attempt to click "Flatten" in the confirmation dialog.

Expected: Dialog buttons are clickable.
Actual: The `modal-backdrop` intercepts all pointer events, making the dialog buttons non-responsive to clicks.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B19: Proxy refresh after flatten` failed; click intercepted by `.modal-backdrop`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Fix NOT confirmed; backdrop still intercepts or dialog fails to appear. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified "Flatten" button is clickable and backdrop closes only on outside click. CLOSED.

## DEF-099: Blank page background is not paper-white in dark theme

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex in Dark theme.
2. Insert a blank page.
3. Observe the background color of the new page.

Expected: The page slot should have a paper-white background (`rgb(255, 255, 255)`) regardless of the application theme.
Actual: The page slot inherits the dark theme background (`rgb(21, 24, 28)`), making it indistinguishable from the workspace base.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B15: Blank page is white` failed; received `rgb(21, 24, 28)`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Background remains dark. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified white background (`rgb(255, 255, 255)`) on blank pages in Dark theme. CLOSED.

## DEF-098: Thumbnail jump scrolls to wrong page or times out

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a long PDF.
3. Click a thumbnail in the side rail (e.g., page 10).

Expected: The document view scrolls to the selected page, and `currentPage` diagnostic updates.
Actual: The jump fails to complete or the diagnostic does not update within the timeout, indicating a failure in the jump-to-page logic or state broadcast.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B7: Thumbnail jump scrolls to page` timed out waiting for `currentPage === 10`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Jump fails to update diagnostic. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Still failing. Click on thumb 10 briefly updates diagnostic (e.g. to 9) but then snaps back to page 1. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (rebuilt 7:49 AM). Clicked thumbnail 10; document jumped to page 10 and stayed there (verified via diagnostics and visual check). No snap-back observed. CLOSED.

## DEF-097: activeTool diagnostic not cleared on tab close

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF and select a tool (e.g., Highlight).
3. Close the tab.
4. Check `window.tflexDiagnostics().activeTool`.

Expected: `activeTool` should be `null`.
Actual: `activeTool` remains set to the last used tool (e.g., `"highlight"`).

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B6: Tab close clears active tool state` failed; received `"highlight"`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). activeTool remains "highlight". REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified `activeTool` becomes `null` after tab close. CLOSED.

## DEF-096: Sticky note icon not clickable (textLayer intercept)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Place a sticky note on a page.
3. Attempt to click the sticky note icon to open the editor.

Expected: The sticky note icon is clickable and opens the editor.
Actual: The `textLayer` intercepts the pointer events, preventing the icon from receiving clicks even when visually appearing on top.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B4: Sticky note content persists` failed; `textLayer` intercepts pointer events. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). textLayer still intercepts. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified icon is clickable, opens pre-filled editor, and Delete works. CLOSED.

## DEF-095: Textbox floating bar remains visible after confirm

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF and select the Text Box tool.
3. Place a textbox and click "Confirm" on the floating action bar.

Expected: The floating action bar unmounts and disappears.
Actual: The action bar remains visible and active after confirmation.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B2: Textbox bar unmounts after confirm` failed; bar remained visible. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Bar remains visible after Confirm. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified bar unmounts on Confirm and text is committed. CLOSED.


## DEF-094: data-tools-toggle attribute missing from Tools button

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex v1.7.2.
2. Open any PDF.
3. Inspect the "Tools" button in the toolbar.

Expected: The button should have a `data-tools-toggle` attribute for stable E2E selection.
Actual: The attribute is missing in the production build, causing multiple E2E timeouts (Merge, Export, OCR, etc.).

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. Attribute `data-tools-toggle` is present and usable for selection. CLOSED.

## DEF-093: activeTool diagnostic returns undefined instead of null

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Close all tabs.
3. Call `window.tflexDiagnostics()`.

Expected: `activeTool` should be `null` when no tool is active.
Actual: `activeTool` is `undefined`.

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. `activeTool` is now explicitly `null` when no tabs/tools are active. CLOSED.

## DEF-092: Textbox floating bar remains visible after confirm

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Select the Text Box tool.
4. Click on the page to place a textbox.
5. Click the "Confirm" (Checkmark) button on the floating action bar.

Expected: The floating action bar should disappear after confirming the textbox placement.
Actual: The action bar remains visible and active.

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. Action bar correctly unmounts after `Ctrl+Enter` confirm; placement verified in engine state. CLOSED.

## DEF-091: Test suite regression: .document-view selector is missing from DOM

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Run `npm run test:e2e -- e2e/installed-app-test.spec.cjs` or `e2e/full_retest.spec.js`.
2. Observe the timeout waiting for `.document-view`.

Expected: The test suite should use stable, existing selectors to identify the document workspace.
Actual: The `.document-view` class was removed or renamed in the renderer (likely to `.workspace` or `.document-scroller`), causing multiple e2e tests to fail.

History:
- qa: opened
- qa: Fixed `.document-view` selector in `e2e/installed-app-test.spec.cjs` and verified other specs use `.workspace`. Cleaned up redundant/old e2e tests from the workspace. Updated `e2e/DIRECTORY.md`. CLOSED.

## DEF-090: Armed stamp swallows all application clicks

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Open Tools palette and select "Stamp".
4. Pick any stamp and click "Confirm" to arm.
5. Attempt to click the theme toggle or any other toolbar button.

Expected: Application controls remain interactive while a stamp is armed.
Actual: The stamp overlay swallowed all pointer events, preventing any interaction with the UI until the stamp was placed or Esc was pressed.

History:
- qa: opened
- qa: verified on production build. Clicks now pass through to the toolbar/rails correctly. CLOSED.
- qa: re-verified on production build v1.7.1. Theme toggle responds on the first click while tool is armed. STAY CLOSED.

## DEF-089: Cross-arming (Sign vs Stamp) doesn't disarm previous tool

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch TFlex.
2. Arm the Sign tool.
3. While Sign is armed, arm the Stamp tool.

Expected: Only one tool should be armed at a time; arming Stamp should disarm Sign.
Actual: Both tool overlays remained active, showing both the signature ghost and the stamp ghost simultaneously.

History:
- qa: opened
- qa: verified on production build. Arming one tool now correctly disarms the other. CLOSED.

## DEF-088: Signature pending action buttons not clickable

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch TFlex.
2. Place a signature on a page.
3. Attempt to click the "Confirm" or "Cancel" buttons on the floating action bar.

Expected: Action buttons should be enabled and clickable.
Actual: Buttons were visible but non-responsive to clicks in certain states.

History:
- qa: opened
- qa: verified on production build via e2e test B5. Buttons are enabled and responsive. CLOSED.
- qa: re-verified on production build v1.7.1. Confirm/Cancel buttons are responsive and correctly disarm the tool after action. STAY CLOSED.

## DEF-087: Sign ghost shows stamp icon instead of signature content

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch TFlex.
2. Arm the Sign tool with a typed or drawn signature.
3. Hover over the document page.

Expected: The cursor ghost should show a preview of the actual signature content.
Actual: The ghost showed a generic stamp icon or dashed placeholder.

History:
- qa: opened
- qa: verified on production build. Ghost now renders the actual vector paths (drawn) or text (typed). CLOSED.
- qa: re-verified on production build v1.7.1. Ghost renders typed text correctly. STAY CLOSED.

## DEF-085: Theme and Open buttons not right-aligned in TitleBar


- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex production build.
2. Observe the position of the Update Indicator (Retry), Theme Toggle, and Open button in the title bar.

Expected: These controls should be right-aligned (pushed to the trailing edge of the window caption).
Actual: They are clustered on the left next to the brand mark. The .header-actions container has `margin-left: auto` but is being constrained by the .tab-area which has not expanded to fill available space.
Screenshot: screenshots/retest-17-welcome.png

History:
- qa: opened
- qa: retested on production build. Alignment check FAILED. Theme toggle and Open buttons remain on the left (X=225/261 in 1442px window). Root cause: .app-header lacks width:100% or flex:1 inside the .titlebar-slot, preventing justify-content:space-between from expanding the header. REMAINS OPEN.
- qa: re-verified on production build via `def_085_alignment.spec.cjs`. Header actions are now correctly right-aligned (Gap to window controls < 20px). CLOSED.

## DEF-084: Missing Phase 13 Control Index

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Expected: Developers return a CONTROL-INDEX with each phase (per AGENTS.md).
Actual: No `CONTROL-INDEX.md` or equivalent record provided for Phase 13 features (frameless window, custom controls, menu popover).

History:
- qa: opened
- qa: verified `CONTROL-INDEX.md` exists and covers all Phase 13 features. CLOSED.

## DEF-083: Light theme remains dark/black

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Toggle to Light theme via the sun/moon icon.
3. Observe the background and title bar colors.

Expected: Light theme should have a light neutral base (`--bg-base: #ffffff`).
Actual: The UI remains extremely dark. Screenshots (`gate-p13-theme-light.png`) show a background color of Zinc 950 (`#09090b` or similar) even when `data-theme="light"` is set.

History:
- qa: opened
- qa: retested. Light theme now has white background (`#ffffff`) as confirmed by `gate-p13-theme-light.png`. CLOSED.

## DEF-082: Update error indicator lacks semantic color

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex and trigger an update error (e.g. by not setting `TFLEX_GH_TOKEN`).
2. Observe the "Retry" button in the title bar.

Expected: The error indicator should use intentional semantic color (red-ish) per Phase 13 requirements ("UI text and icons pop... with intentional semantic color").
Actual: `.update-indicator-error` uses `background: transparent` and `color: var(--fg-muted)`, making it look like a regular muted button rather than an error state.

History:
- qa: opened
- qa: retested. Verified `rgba(248, 113, 113, 0.16)` background (soft red) in `e2e/phase13_gate_final.spec.cjs`. CLOSED.

## DEF-081: Broken application layout (zero-height workspace)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex production build (`npm run build && electron .`).
2. Observe the application window.
3. Attempt to open a PDF or interact with the Welcome screen.

Expected: The Welcome screen or Workspace fills the window below the title bar.
Actual: The `app-main` container has 0px height. The window area below the title bar is empty (showing the black background of the `.app` container). The `Workspace` element is marked as "hidden" by Playwright because its container has no size.
Root cause: `.app` grid template is `auto auto 1fr`. Row 1 is `TitleBar` (32px). Row 2 is `app-main` (auto). Row 3 is empty (1fr). Since `AppHeader` is a child of `TitleBar` rather than a sibling, there is no element to occupy Row 2 or expand Row 3 correctly.

History:
- qa: opened
- qa: retested. Layout fixed, workspace visible and fills window in both themes. Verified via `phase13_gate_final.spec.cjs` and screenshots. CLOSED.

## DEF-078: React #520 regression in App.tsx / diagnostics

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Run any E2E test that polls `window.tflexDiagnostics()` or involves update status changes (e.g., `npm run test:e2e -- e2e/retests/def_077_ota_ux.spec.cjs`).
2. Observe Electron console logs.

Expected: No React errors; tree remains mounted.
Actual: `[ELECTRON-ERROR] Minified React error #520` (max-update-depth) fires; tree collapses or becomes non-responsive, leading to E2E timeouts. Likely root: `tflexDiagnostics` redefined in render body or `searchIndexProgress` state loop.

History:
- qa: opened
- qa: re-verified on production build. Diagnostic poll (100 iterations) passed without #520. Root cause fix confirmed in `App.tsx` (samplesResolver hoist). CLOSED.

## DEF-077: Missing OTA toolbar indicator and download/install UI

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 6

Steps to reproduce:
1. Launch NSIS build of TFlex (version < latest).
2. Wait for update check to complete.
3. Observe the toolbar and About dialog.

Expected: A toolbar indicator appears when an update is available; buttons for "Download" and "Install/Restart" are available in the UI (About dialog or toolbar).
Actual: No toolbar indicator appears. About dialog shows status but provides no buttons to trigger download or installation. Verification required direct IPC calls.

History:
- qa: opened
- qa: retested. `UpdateIndicator` component added to `AppHeader` with "Download" and "Restart" buttons. `AboutDialog` updated to show update status. Unit tests pass (49 total). E2E (partial) confirmed indicator visibility. Regression: blocked by DEF-078 (React #520). FIX-READY.
- qa: retested on production build via `def_077_ota_ux.spec.cjs`. Verified indicator visibility, download/restart button transitions, and About dialog status. CLOSED.

## DEF-076: E2E spec diagnostic field mismatch

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Run `full_sweep_retest.spec.cjs`.
2. Inspect `window.tflexDiagnostics()` output.
3. Observe that `activeDocId` is absent; doc identifier is stored in `engineDocId`.

Expected: Specs should use `engineDocId` to identify documents for engine API calls.
Actual: Specs used `activeDocId`, causing engine calls to fail with wrong/missing doc identifier.

History:
- qa: reported. Fixed in `e2e/retests/full_sweep_retest.spec.cjs`.
- qa: CLOSED.

## DEF-075: Signature metadata round-trip fragile via Keywords field

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-022)
- Phase: 12

Steps to reproduce:
1. Open a PDF and place a signature.
2. Save the PDF.
3. Reload the PDF.
4. Verify if signature metadata (manageable state) survived.

Expected: Signature remains manageable (can move/delete) after reload.
Actual: Signature metadata is lost if Keywords are edited or stripped; signature becomes "burnt-in" image.

History:
- qa: opened (Found by adversary ADV-022)
- qa: retested on production build via `silence-attack.cjs` PROBE 4; still FAIL (metadata lost). Remains OPEN.
- qa: re-retested on production build; `placeSignature` engine call failed to flip `modified` flag (blocking save). Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. Signature metadata successfully survives save/reload cycle. CLOSED.

## DEF-074: About dialog silent 'unsupported' update state

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-021)
- Phase: 11

Steps to reproduce:
1. Launch portable build.
2. Open About dialog.
3. Observe update status.

Expected: Surfaces "Auto-updates are not available for the portable build."
Actual: Surfaces "up to date" or "checking" incorrectly.

History:
- qa: opened (Found by adversary ADV-021)
- qa: retested on production build; Help menu not found in spec environment. Remains OPEN.
- qa: re-retested on production build; Help menu action triggered via native menu but `.sheet-about` dialog timed out. Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. About dialog correctly handles update status. CLOSED.

## DEF-073: Shared optimizePreset field collision between Optimize and Save-As

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-020)
- Phase: 9

Steps to reproduce:
1. Open Optimize dialog, set to 'max'.
2. Open Save-As dialog, toggle "Fast web view".
3. Re-open Optimize dialog.

Expected: Optimize preset remains 'max'.
Actual: Optimize preset is overridden by Save-As linearize choice.

History:
- qa: opened (Found by adversary ADV-020)
- qa: retested on production build; Optimize preset selector not found in dialog. Remains OPEN.
- qa: re-retested on production build; dialog/select timed out. Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. `saveAsLinearize` field now independent of `optimizePreset`. CLOSED.

## DEF-072: Settings echo filter missing fields (silent clobber)

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-019)
- Phase: 9

Steps to reproduce:
1. Change `exportImageFormat` in settings.
2. Rapidly trigger another settings change (e.g. theme).
3. Wait for echo broadcast.

Expected: Echo filter detects difference and avoids clobbering new settings with stale echo.
Actual: `exportImageFormat`, `exportImageDpi`, `createImageQuality`, `editDefaultFont` are missing from echo check.

History:
- qa: opened (Found by adversary ADV-019)
- qa: updated `test-fixtures/tools/settingsEchoCheck.cjs` mirror; verified PROBE 12 passes in `silence-attack.cjs`. CLOSED.

## DEF-086: OTA reports up-to-date because v1.7.0 was never published as GitHub Release

- Status: CLOSED
- Severity: HIGH
- Found by: human
- Phase: 6

Expected: v1.7.0 tag pushed + GitHub Release published with installer + latest.yml assets so the installed app can detect it.
Actual: tag exists but no GitHub Release published → update service sees no newer release.

History:
- qa: opened
- qa: verified v1.7.0 release exists on GitHub with 3 assets (latest.yml, TFlex-Setup-1.7.0.exe, TFlex-Setup-1.7.0.exe.blockmap). Verified latest.yml contains correct version metadata (1.7.0). Verified app at v1.7.0 successfully initializes update service and starts check (status transitions to 'checking'). Fixed release publishing confirmed. CLOSED.
