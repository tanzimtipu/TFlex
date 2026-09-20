# e2e/archived - retired one-off specs (2026-09-05 standard-suite cleanup)

This directory is EXCLUDED from the standard suite via `playwright.config.js`
(`testIgnore: 'e2e/archived/**'`). Files here are kept for history only; they
are frozen at old behavior models (pre-DEF-153 interaction model, 1.7.4-1.7.28
operator-report eras, or dead selectors/menu paths) and their still-live
contracts have been ported to the current model. Do not run them; do not add
new files here except via a qa cleanup decision.

## Why each file was retired

Top-level one-offs (frozen at the B1-B18 / operator-report eras):

- `bug_sweep_verification.spec.cjs`, `comprehensive_retest_v2.spec.cjs`,
  `final_b_sweep.spec.cjs` - the B1-B20 sweeps. Failing tests died on dead
  selectors (`.sticky-note-icon`, `.docx-export-dialog`, `.edit-layer-active`,
  `.dialog button:text-is("APPROVED")`, `input[name="afterPage"]`,
  `button:has-text("Add note")`) or dead menu actions (`menu:action`
  `flattenForms` / `replacePages`, removed from the main menu). Still-live
  contracts were ported to `../regression_b_port.spec.cjs` (B1 sign-cancel
  disarm, B2 textbox bar unmount, B4 note content round-trip, B5 edit-mode
  mutual exclusion, B6 tab-close tool clear, B10 stamp placement, B15 flatten
  proxy refresh, B17 replace-pages count, B20 palette close). Everything else
  was already covered by the current-model suites: custom hex + round-trip
  (sweep_annotations_sign A2), thumbnail jump (no_op_sweep), close prompt
  (full_retest / bug_sweep B8 port), DOCX dialog (no_op_sweep +
  sweep_edit_forms_export X1), merge dialog (probe_190_triage T7), crop flow
  (sweep_pageops P3), delete dialog (no_op_sweep), blank page insert
  (sweep_pageops P1). The old B11 "OCR disabled on empty tab" premise is gone:
  an empty tab shows the Welcome screen and the tools palette is not
  reachable there (see screenshots/probe190_t3_emptytab.png).
- `diag_probe.spec.cjs`, `discover.spec.cjs` - pure diagnostic dumps, zero
  assertions (diag_probe also hung its teardown window at 2.0m in the 1.9.0
  pre-cleanup run).
- `gt_bug1/gt_bug2/gt_bug2b/gt_bug3b/gt_bug4/gt_bug7/gt_bug8/gt_bug10b/
  gt_bug11/gt_discovery.spec.cjs` - ground-truth diagnostic probes with zero
  assertions (console + screenshots only). Behavior is covered by
  sweep_annotations_sign S1/S2, sweep_edit_forms_export E1, sweep_pageops
  P1/P3, probe_190_triage T1-T7 (keeper) and the DEF-era verify rounds.
- `gt_bug2_docsafety_1717.spec.cjs`, `gt_bug3_docsafety_1717.spec.cjs` -
  report-only (their final verdict line is `expect(true).toBe(true)`);
  superseded by probe_190_triage T1 (DEF-153 edit-text model) and the
  DEF-150/151 verify rounds (toolbox move relocates content exactly once).
- `gt_edittext_1717.spec.cjs` - frozen at the pre-DEF-153 model (asserts
  single-click opens the editor); the current model is asserted by
  probe_190_triage T1 (single click SELECTS, double click opens) and the
  DEF-149/150/151 rounds.
- `gt_addbox_1717.spec.cjs` - superseded by sweep_edit_forms_export E1 and
  the DEF-150/151 verify rounds (add-box commit, move toolbox, one copy).
- `gt_crop_thumb_1717.spec.cjs` - its unique live contract (thumbnail rail
  keeps full page aspect after a per-page crop) was PORTED to
  `../crop_thumbs_port.spec.cjs`; the original had drifted into a one-off
  filename frozen at v1.7.17.
- `probe_annot_persist/probe_annot_types/probe_form/probe_rotate/
  probe_save_state/probe_place_dev.spec.cjs` - diagnostic probes, zero
  assertions; covered by sweep_annotations_sign A2, sweep_edit_forms_export
  F1, sweep_pageops P2 and retests/def_167_168_169_verify_devbuild.
- `repro_B1/repro_B2/repro_B3/repro_B4.spec.cjs` - single-target B1-B4
  repros; contracts ported to `../regression_b_port.spec.cjs` (B1/B2/B4) and
  covered by sweep_annotations_sign A2 (B3 custom hex).
- `shot_def137.spec.cjs` - screenshot capture for DEF-137, zero assertions;
  DEF-137 is covered by the keeper verify rounds.

## Why each retests/ file was retired

Classified against the retests pre-run (66 failures / 200 passed on the 1.9.0
dev build, 2026-09-05). Failing tests were frozen at pre-DEF-153 interaction
(single click opened the inline editor; now: single click SELECTS, double
click opens), at pre-redesign pixel detectors (annotation-blue; the accent is
now orange), at designed-motion-agnostic timings, or on dead selectors/menu
paths. Every still-live contract is pinned by a current-model keeper listed
below.

- Empty-tab OCR family (`deep_dive_verification`, `final_probe`,
  `final_verification*`, `fix_verification_1.7.4` B11 variants) - the tools
  palette is not reachable from an empty tab at all (it shows the Welcome
  screen; screenshots/probe190_t3_emptytab.png), so the premise is gone.
- DEF-100 flatten-dialog family (`deep_dive_verification`,
  `final_verification*`) - clicked the removed Forms tool dialog
  (`[data-tool-id="forms"]` + `.modal-footer`); flatten now lives in the
  document toolbar and is pinned by `../regression_b_port.spec.cjs` B15-port.
- DEF-095/097 (`final_verification*`, `def_092_093_094`, `def_105_stays_open`)
  - superseded by B2-port / B6-port and the DEF-153 interaction matrix
  (`def_152_159_verify_1.7.23` V2, `qa_unified_1724_repro`).
- DEF-068/069/073/075 (`full_sweep_retest`) - the same four contracts are
  verified by `../smoke.spec.cjs` (passing) and `../no_op_sweep.spec.cjs`.
- DEF-077 (`def_077_ota_ux`) - asserted the pre-redesign About update copy;
  the About update row is pinned by `qa_redesign_probe6_1728` (passing) and
  the toolbar indicator half of the test passed.
- DEF-139 (`def_139_verify_1.7.13`) - asserted slot 3 renders text without
  scrolling it into view; frozen viewport/zoom assumption. The live contract
  (text renders once in view) is pinned by `../probe_190_triage.spec.cjs` T2.
- DEF-140 + `gt_textbox_toolbox_move_1.7.14` - frozen at the pre-DEF-150
  semantics ("toolbox move must NOT move the text"; the product now moves the
  content with the toolbox). The current relocate contract is pinned by
  B22-port (`../regression_b_port.spec.cjs`) and `qa_unified_1724_repro` T2.
- DEF-148 (`def_148_verify_1.7.18`) - the thumbnail-aspect contract was
  PORTED to `../crop_thumbs_port.spec.cjs`.
- DEF-149/150/151 rounds (`def_149/150/151_verify_*`, 6 files) - each round is
  a superseded variant of the same relocate contract, frozen at the
  single-click-opens-editor step; pinned once by B22-port.
- DEF-155 rounds (`def_152_159_verify_1.7.23` V1, `_round2` W1, `_round3` T1)
  - their own run logs prove the contract HOLDS (old rect settles clean, stays
  clean, clean after re-render, clean after save/reopen). Two frozen premises
  were ported IN PLACE: (a) the early poll samples caught the eraser
  unmount transient (the eraser/selection surface unmounts within the motion
  budget but the settle tail is load-dependent ~0.4-1.5s), so the verdicts now
  wait for the old rect to CLEAR and then require it to STAY clean; (b) the
  doc-safety legs measured the saved box via canvas pixels / textLayer runs -
  under the current model the box round-trips as a LIVE editable annotation
  (edit-mode add-boxes in engineState.textBoxes, rendered through the pdf.js
  annotation layer, not baked into the canvas), so those legs assert the
  engine truth: exactly ONE box survives, old rect clean. Round 4's T4a
  (frozen note-editor create step) was retired in place - the grip-label
  contract lives in round 5 T5; round 5 untouched.
- DEF-165/166 rounds (`def_165_166_verify_1.7.27/28`) - the saved-fill
  contract HOLDS (their own [TP]/[DICT] logs show ExtGState ca=0.1, no inline
  ca token, textKeptFrac=1); the tests failed on frozen annotation-blue pixel
  detectors and the pre-DEF-153 textbox create step. Ported (dict-based,
  color-independent) as B21-port; DEF-166's once-only round-trip as B22-port.
- DEF-157 (`def_154_157_verify` T1/T4 era diags `def_157_reopen_diag`,
  `def_161_stray_diag`, `def_161_canvas_diag`, `def_164_*_diag`,
  `def_166_reopen_diag_1727`, `def_166_canvas_extract_1727`) - zero-assert
  diagnostics or frozen flows; the callout/committed-shape interactions are
  pinned by `def_152_159` V2/V4 and `qa_unified_1724_repro`.
- `def167_probe_extract3` - DEF-167 evidence probe asserting the BUG (extract
  off-by-one); DEF-167 is CLOSED and pinned by
  `def_167_168_169_verify_devbuild`.
- `def_171_173_diag`, `debug_dom`, `qa_discover_1722`,
  `qa_redesign_discovery_1728` - zero/one-assert discovery dumps; the surfaces
  they discovered are pinned by phase13/no-op/smoke keepers.
- `qa_redesign_probe2/3/4_1728` - dead text locators
  (`button:has-text("Application menu")` - the menu button is icon-only with
  an aria-label). The menu popover and About surfaces are pinned by
  `../phase13_gate_final.spec.cjs` SC2, `../smoke.spec.cjs` DEF-074 and
  `qa_redesign_probe5/6_1728`.
- `textonly_toolbox_verify_1.7.22` - frozen at single-click-opens-editor and
  the v1.7.22 toolbox visual; the toolbox action buttons are pinned by round 5
  T5 and the redesign probes.
- `verif_zoom_jump_crop_1.7.10` - asserted pages 1-3 measurable
  simultaneously; the virtualized workspace no longer mounts three ~1500px
  slots at once (the same measurement problem `sweep_pageops` P3 solved with
  per-stop merged measurement). The crop-zoom contract was re-verified during
  cleanup: crop page 1 keeps uncropped pages at identical absolute px
  (evidence in the archived spec's last run and `sweep_pageops` P3).
- `remaining_sweep` - a soft `console.table` diagnostic with stale flows;
  its items are pinned by no_op_sweep / sweep_* / B-ports.
- `gt_sign_edit_title` GT-02a/02b/06, `operator_bug3_bug4` BUG4,
  `gt_verify_1711` DEF-135 - PORTED IN PLACE (kept, passing), not retired:
  double-click/Confirm steps added for the DEF-153/152 model. Listed here for
  traceability of the cleanup decisions.

## Phase-26 dead-selector sweep (2026-09-21)

Phase 26 retired the in-canvas editors (`[data-edit-editor]`,
`[data-edit-textarea]`, `[data-edit-confirm]`, `.edit-inline-editor`,
`[data-annotation-editor]`, `.shape-color-editor`): text entry now goes
through the floating text-properties panel field (`[data-txt-text]`, session
commits on blur) and shape colour through `[data-ann-color]` / the action
bar. These historical retests drove the retired surfaces and would fail if
run; their still-live contracts are pinned by the current keepers
(`phase21_text_panel`, `phase24_annotation_styles`, `phase26_panel_text_edit`,
`phase28_29_verify`, `regression_b_port` B21/B22, `sweep_*`, `probe_190_triage`).

Archived in the sweep (40):

Inline-editor / add-box records:
- `b6_probe`, `probe_box_artifact_1.7.14`, `qa_pmm_d_artifact_1722`,
  `qa_pmm_e_edittext_1722` - zero-assert DOM probes of the retired editor.
- `edit_repros` (BUG-6/16), `gt_repro1_annot_edit` (Bug 2/5),
  `gt_sign_edit_title` (GT-02/05/06), `operator_b123_repro` BUG4,
  `operator_bug3_bug4_1.7.13` BUG4, `operator_text_manip_repro` TOOL1-4 -
  inline-editor behaviour (stays open, drag grip, font/size controls).
- `def_108_115_verify` DEF-108/109/110/113, `def_123_131_verify_1.7.9`
  DEF-124/127, `release_gate_117_verify` B5 - inline-editor legs of mixed
  batches (surviving DOCX/OCR/crop/blank-page/signature legs covered by
  `sweep_edit_forms_export`, `sweep_pageops`, `sweep_annotations_sign`).
- `def_152_159_verify_1.7.23` (+round2-5), `def_160_162_verify_1.7.25`,
  `qa_unified_1724_repro`, `qa_pmm_a_addbox_1722`,
  `qa_pmm_b2_note_shapes_1722` - the DEF-152..162 move/confirm matrix driving
  the retired editor; the live contract is pinned by `phase28_29_verify` C2
  and `regression_b_port` B22.

Annotation-editor records (`[data-annotation-editor]`):
- `def_147_verify_1.7.15/16/17`, `gt_movability_1.7.14` - movable-editor
  contract; the editors no longer exist.
- `def_251_252_retest`, `def_253_retest`, `def_254_255_retest`,
  `diag_phase24_failures` - panel-lifecycle retests driving the retired
  editor; the live contract is pinned by `phase24_annotation_styles` /
  `phase26_panel_text_edit` and `def256/257/258/260`.
- `def_154_157_verify_1.7.24`, `def_163_164_verify_1.7.26`,
  `verify_1712_sweep` DEF-137, `qa_bugfix_verify_1.10.2`,
  `qa_frost_glass_visual_1103`, `qa_pmm_c_dark_1722`, `gt_verify_1711`,
  `def_211_probe_place` - callout/note/auto-fit/frosted legs driving the
  retired editor; live contracts pinned by `phase28_29_verify` C1,
  `phase27_fonts_spacing`, `sweep_annotations_sign`, `phase13/23`.

Top-level:
- `def221_222_leftover_thumb_flicker` (DEF-221/222), `def235_240_harness_flows`
  (DEF-235..240) - drove the retired inline editor; the live leftover-box /
  harness-flow contracts are pinned by `sweep_pageops` /
  `class_sweep_def221_222`.

Repointed in place, kept passing (2026-09-21):
- `retests/def_145_verify_1.7.15`, `retests/def_146_verify_1.7.15`,
  `retests/box_actionbar_verify_1.7.22` - text entry moved to the panel
  `[data-txt-text]` field (blur commits) and the title-bar Save As
  `[data-toolbar-save-as]`; contracts unchanged.

Left alone (reference the retired selectors only in negative/guarded checks
and still pass): `retests/b2_isolation`, `retests/color_note_repros`,
`retests/def_211_ghost_dialog_retest`, `retests/qa_def_178_179_verify`,
`retests/qa_pmm_b3_ellipse_arrow_ink_1722`, `retests/sign_repros`.

## Version-frozen installed-release specs (retired 2026-09-21, release gate 1.23.0)

These top-level `release_1_1x_installed.spec.cjs` files were collected by the
STANDARD suite (root `playwright.config.js` ignores only `e2e/installed/**` and
`e2e/archived/**`), but every one of them launches the NSIS-installed
`%LOCALAPPDATA%\Programs\TFlex\TFlex.exe` and pins the version it was written
for. Once the installed build advances past that version the version gate fails
on every run, so they were dead weight in the standard suite. Archived here:

- `release_1_18_0_installed.spec.cjs`, `release_1_18_1_installed.spec.cjs`,
  `release_1_19_0_installed.spec.cjs`, `release_1_20_0_installed.spec.cjs`,
  `release_1_21_0_installed.spec.cjs` - version gates 1.18.0 / 1.18.1 / 1.19.0 /
  1.20.0 / 1.21.0; superseded release by release.
- `release_1_22_0_installed.spec.cjs` - version gate 1.22.0 AND written against
  the retired Phase-26 in-canvas editor (`[data-annotation-editor="textbox"]` on
  the placement and click legs). Superseded by
  `../release_1_23_0_installed.spec.cjs`, which re-covers the same Phase-24/25/
  26/27/28/29 + DEF-214/watermark surface on the installed build with the
  panel-field editor model.

The current installed-release gate is `../release_1_23_0_installed.spec.cjs`
(KEPT at top level, deliberately not archived); it must be repointed/rewritten
for each new release, as this file's own version gate shows.
