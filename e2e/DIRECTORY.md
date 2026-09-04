# E2E Script Directory

## Launch rule (2026-09-05)

Every standard/regression/sweep spec launches the DEV build via the canonical
launcher (`launchApp()` with NO executablePath, or `launchDev()` from
`lib/helpers.cjs`). Historical filenames record which binary the defect was
originally verified against - re-running them today tests the current DEV
build (v1.9.0).

Specs that genuinely require the installed/packaged app live ONLY under
`installed/` and are EXCLUDED from the standard suite by
`playwright.config.js` (`testIgnore: ['e2e/installed/**', 'e2e/archived/**']`).
They run only when the orchestrator explicitly asks, via:
`npx playwright test --config=e2e/installed/playwright.installed.config.js`

## Standard suite (2026-09-05 cleanup, version gate 1.9.0)

### Core / smoke
- `smoke.spec.cjs`: smoke + DEF-068/069/070/073/074/075 quick verdicts (DEV).
- `full_retest.spec.js`: DEF-009..013 engine/document-safety regressions, P1
  search, P2 merge/reorder/split (DEV).
- `no_op_sweep.spec.cjs`: no-op sweep of Phase 6-12 controls (new tab "+",
  sign, rotate, delete dialog, DOCX dialog, thumbnail selection, optimize
  preset, DEF-075 round-trip, About) (DEV).
- `phase13_gate_final.spec.cjs`: frameless title bar, menu popover, 520-page
  open perf, swatches, both themes (DEV).
- `perf_retime.spec.cjs` + `sweep_perf.spec.cjs`: cold start / 500-page open /
  idle memory recordings for PERFORMANCE.md (DEV).

### Deep sweeps (current interaction model)
- `sweep_annotations_sign.spec.cjs`: every annotation tool places (A1), custom
  hex color round-trip (A2), annotations panel + note round-trip + delete (A3),
  signature place/move/delete lifecycle (S1), edge placement + cross-page reuse
  + save/reopen (S2).
- `sweep_edit_forms_export.spec.cjs`: edit text run + add box + phantom-surface
  toggles (E1), form fill/flatten-save/reopen value round-trip (F1), DOCX
  text-first export (X1).
- `sweep_pageops.spec.cjs`: insert blank start/middle/end + undo chain (P1),
  reorder/rotate/delete/insert + save/reopen (P2), multi-page per-page crop +
  undo (P3).
- `sweep_settings_frameless.spec.cjs`: theme/recents persistence across restart
  (ST1), custom color persistence (ST2), frameless min/max/restore + drag
  region (FW1).
- `sweep_visual.spec.cjs` / `sweep_visual_dev.spec.cjs`: every major screen in
  both themes + design-token dumps (visual judgment evidence).
- `motion_verify.spec.cjs`: motion tokens, palette/dialog/menu/popover
  entrances, button hover/press, PDF zero-animation, reduced-motion collapse.

### Triage / model guards (keepers)
- `probe_190_triage.spec.cjs` (+ `_r2`, `_r3`): DEF-153 edit-text interaction
  guard (single click SELECTS, double click opens), textLayer lazy-render
  guard, empty-tab surface, activeTool shape, titlebar drag region, note editor
  buttons, merge dialog inputs.

### Ported regression contracts (2026-09-05 cleanup)
- `regression_b_port.spec.cjs`: the still-live B-sweep contracts rewritten for
  the current model - B1 sign-cancel disarm, B2 textbox bar unmount, B4 note
  content round-trip, B5 edit-mode mutual exclusion, B6 tab-close tool clear,
  B10 stamp placement, B15 flatten proxy refresh, B17 replace-pages count,
  B20 palette close, B21 saved shape fill translucent (ExtGState ca 0.1, no
  inline ca token; DEF-165 contract), B22 textbox move + Confirm relocates
  exactly once incl. save/reopen (DEF-149/150/151 + DEF-155 contracts).
- `crop_thumbs_port.spec.cjs`: thumbnail rail keeps full page aspect after a
  per-page crop (the unique live contract of the retired
  `gt_crop_thumb_1717.spec.cjs`).

### In-place ports inside kept files (2026-09-05 cleanup)
The following kept specs had individual tests updated to the CURRENT model
(otherwise unchanged):
- `retests/def_108_115_verify.spec.cjs`: `openTextEditor()` helper now double
  clicks (DEF-153 model) - DEF-108/109/110 live.
- `retests/def_123_131_verify_1.7.9.spec.cjs`: DEF-124 + DEF-127 open the
  editor via double click; all nine DEF-123..131 tests live.
- `retests/gt_verify_1711.spec.cjs`: DEF-135 now clicks the pending Confirm
  bar after the box drag (commit-on-release is gone); title-ink intact check
  passes with identical pre/post dark fraction.
- `retests/gt_sign_edit_title.spec.cjs`: GT-02a/02b/06 open the inline editor
  via double click.
- `retests/operator_bug3_bug4_1.7.13.spec.cjs`: BUG4 opens the toolbox via
  double click on the committed box.
- `retests/gt_repro_1710.spec.cjs`: BUG1 (asserted the since-fixed 1.7.10
  drag-region bug) retired in place; the remaining five tests live.
- `retests/def_152_159_verify_1.7.23*.spec.cjs` (rounds 1-3): the DEF-155
  old-rect-cleanliness verdicts now wait for the eraser unmount to SETTLE
  (load-dependent ~0.4-1.5s under the designed motion tokens) and then require
  the old rect to STAY clean, and the doc-safety legs assert the engine truth
  (exactly ONE box survives the round-trip as a live editable annotation -
  add-boxes in engineState.textBoxes, rendered through the pdf.js annotation
  layer, not baked into the canvas). Round 4's T4a (frozen note-editor create
  step) was retired in place - the grip-label contract lives in round 5 T5;
  round 5 is unchanged and passing.
- `retests/dialog_repros.spec.cjs`: BUG-11's fixed behavior (palette Delete
  opens the dialog) is now pinned; the flaky thumbnail observation step was
  removed.
- `retests/def_154_157_verify_1.7.24.spec.cjs`: T1/T4 drag the callout anchor
  inside the visible viewport band (the page slot is 1496 CSS px in a 903px
  viewport, so the old 0.50h anchor landed at the bottom edge where the drag
  never reached the page). Callout arrow live-render + save/reopen contracts
  pass.
- `retests/def_163_164_verify_1.7.26.spec.cjs`: DEF-163's commit-time
  auto-fit containment unchanged (passing); the reopen leg now asserts the
  round-tripped ENGINE geometry (reopened boxes are baked pdf.js annotation
  appearances with no DOM surface to measure) plus saved-file parse.
- `retests/release_gate_117_verify.spec.cjs`: B4's never-covered contract is
  asserted with a real hit test (the explicit z-index is gone - layering is
  by stacking order); B7 uses the current RANK dialog semantics (position 2 =
  "after page 1"; def_129/130 pin position 1 = prepend); B8b measures pages
  1..3 per-stop with virtualization-aware scrolling (as sweep_pageops P3).

## Installed-App Suite (excluded from the standard suite)
- `installed/installed-app-test.spec.cjs`: Verification of features on the packaged/installed app.
- `installed/installed_verification.spec.cjs`: Behavior-first fixes verified on the installed app.
- `installed/diag_installed_sheet_190.spec.cjs`: Diagnoses the installed 1.8.0 app's update-prompt sheet.
- `installed/ota_bug9_live.spec.cjs`: Live OTA update flow against the installed app + real GitHub release.
- `installed/def_079_080.spec.cjs`: OTA update flow on the packaged (win-unpacked) build.
- `installed/playwright.installed.config.js`: Runner config for the above.

## Other kept retest suites (passing, DEV build)
- `retests/def_098_verification.spec.cjs`, `def_103_shapes.spec.cjs`,
  `def_106_file.spec.cjs`, `def_092_093_094` (retired, see archived), and the
  DEF-era verify rounds from `def_108_115_verify` through
  `def_165_166_verify_1.7.28` (retired rounds moved to archived, see below),
  `def_167_168_169_verify_devbuild.spec.cjs`, `def_170_verify_devbuild.spec.cjs`,
  `def_171_escape_retest_190.spec.cjs`, `def_171_173_diag` (retired),
  `box_actionbar_verify_1.7.22`, `textonly_toolbox_verify_1.7.22` (retired),
  `qa_unified_1724_repro`, `qa_pmm_*_1722`, `qa_redesign_probe5/6_1728`,
  `release_gate_117_verify`, `verify_1712_sweep`, `verif_zoom_jump_crop_1.7.10`
  (retired), `operator_*`, `gt_*`, `sign_repros`, `edit_repros`,
  `dialog_repros`, `color_note_repros`, `ocr_crop_repros`, `tab_ocr_extra`,
  `remaining_sweep` (retired), `b2_isolation`, `b3_rig`, `b3_save_reopen`,
  `b6_probe`, `b14_overlap`.

## Archived specs (`e2e/archived/`, excluded from the standard run)

Retired 2026-09-05. Full rationale per file in `e2e/archived/README.md`:
- Top level: the three B-sweeps (`bug_sweep_verification`,
  `comprehensive_retest_v2`, `final_b_sweep`), the GT/probe one-off
  diagnostics (`gt_bug*`, `gt_addbox_1717`, `gt_crop_thumb_1717`,
  `gt_edittext_1717`, `gt_discovery`, `probe_annot_*`, `probe_form`,
  `probe_place_dev`, `probe_rotate`, `probe_save_state`, `repro_B*`,
  `shot_def137`), and the two teardown/dump probes (`diag_probe` - which also
  hung its teardown window - and `discover`).
- retests/: era-frozen verify rounds and dead-premise suites (`fix_verification_1.7.4`,
  `final_probe`, `final_verification*`, `full_sweep_retest`, `deep_dive_verification`,
  `def_077_ota_ux`, `def_092_093_094`, `def_105_stays_open`, `def_139_verify_1.7.13`,
  `def_140_verify_1.7.14`, `def_148..151` relocate rounds, `def_165_166` rounds,
  `textonly_toolbox_verify_1.7.22`, `verif_zoom_jump_crop_1.7.10`,
  `remaining_sweep`, `gt_textbox_toolbox_move_1.7.14`, the zero-assert
  `*_diag` probes, `qa_discover_1722`, `qa_redesign_probe2/3/4_1728`), each
  mapped to its current-model replacement in `e2e/archived/README.md`.

## Support / Library
- `lib/launch.cjs`: Canonical Electron launcher. No executablePath -> DEV build; an explicit executablePath is used only by the installed-app suite.
- `lib/helpers.cjs`: `launchDev()` (standard), `launchInstalled()` (installed-app specs ONLY), plus shared driving helpers (`openSample`, `diag`, `shot`, `scrollToPage`, `hardClose`).
