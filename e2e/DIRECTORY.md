# E2E Script Directory

## Official Scripts (Current)
- `smoke.spec.cjs`: Basic smoke test, opens a PDF.
- `phase2.spec.cjs`: Verified Phase 2 features (Merge, Reorder, Undo). Updated to use `report.pdf` fixture for outline verification.
- `phase3.spec.cjs`: Phase 3 Annotations E2E.
- `qa-phase3.spec.cjs`: Phase 3 SC evidence (Kinds, Zoom, Panel, Round-trip).
- `qa-phase4.spec.cjs`: Phase 4 SC evidence (Forms, Signatures, Flatten). Updated to handle default checkbox state and shared debouncer.
- `qa-sc1-6.spec.cjs`: Phase 3 SC 1-6 sequential verification.
- `qa-sc2-4.spec.cjs`: Phase 3 SC 2-4 verification.
- `retest_phase1_fixes.spec.cjs`: Retests for Phase 1 defects (004-008). Updated for selector drift and reliable temp user data.
- `walkthrough_p5.spec.cjs`: Full walkthrough of the app in both themes.
- `phase6_verification.spec.cjs`: Official Phase 6 success criteria verification.
- `retest_final.spec.cjs`: Final verification of all resolved defects.

## Support / Library
- `lib/launch.cjs`: Canonical Electron launcher.

## Archived / Spec-Stale / Utility
- `debug_toolbar.spec.cjs`: (DELETED) One-off debug script.
- `full_retest.spec.js`: Large suite, prone to timeouts.
- `harness.cjs` / `harness.js`: (DELETED) Utility scripts.
- `measure_memory.cjs` / `perf_measure.cjs`: Performance measurement scripts.
- `qa_retest_batch2.cjs`: Batch retest script.
- `reproduce_adversary.spec.js`: Adversary finding reproduction.
- `repro_form_save.cjs`: Specific defect reproduction.
- `retest-defects.spec.cjs`: Defect retest suite.
- `retest.spec.cjs`: Generic retest script.
- `retest_009_013.spec.js`: Older defect retests.
- `retest_018_019.spec.cjs`: Older defect retests.
- `retest_def_017.spec.cjs`: Specific defect retest.
- `retest_def_031.spec.cjs`: Specific defect retest.
- `retest_def_033.spec.cjs`: Specific defect retest.
- `retest_def_055_065.spec.cjs`: Batch retest for defects DEF-055 through DEF-065.
- `retest_harness.cjs`: (DELETED) Retest harness.
- `retest_p4_defects.spec.cjs`: Phase 4 defect retests.
- `test.js`: Legacy test script.
