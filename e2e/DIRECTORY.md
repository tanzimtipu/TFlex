# E2E Script Directory

## Official Suites (Current)
- `smoke.spec.cjs`: Basic smoke test, verifies samples and document opening.
- `no_op_sweep.spec.cjs`: Comprehensive sweep of application controls and Phase 6-12 features.
- `phase13_gate_final.spec.cjs`: Verification of Phase 13 features (frameless window, custom controls).
- `full_retest.spec.js`: Regression suite covering historical defects (DEF-009 through P2).
- `installed-app-test.spec.cjs`: Verification of features on the packaged/installed app.
- `perf_retime.spec.cjs`: Performance budget verification (cold start, long doc opening, idle memory).

## Retest Suites
- `retests/full_sweep_retest.spec.cjs`: Verification of resolved defects DEF-068 through DEF-075.
- `retests/def_077_ota_ux.spec.cjs`: Verification of OTA update UI (UpdateIndicator, About dialog).
- `retests/def_085_alignment.spec.cjs`: Verification of title bar control alignment.
- `retests/def_079_080.spec.cjs`: Verification of OTA IPC surface stability.
- `retests/def_108_115_verify.spec.cjs`: Decisive verification of DEF-108..DEF-115 on the installed app (edit-text live render, size arrow/spinner, context-window bar press, DOCX page range, OCR form value, add-box live render, insert blank page end, crop no-flash).
- `retests/release_gate_117_verify.spec.cjs`: v1.7.7 release-gate verification on the installed app — DEF-117 fix (all dialogs open without #310), B1 (sign re-click handles), B3/B6 (drag-out stays open + backdrop click closes), B4 (OCR suspects top bar), B5 (add-box movable + font live), B7 (insert blank after page 1 -> 35 pages, no dup), B8a (crop mode-switch no flicker), B8b (per-page crop only the adjusted page), B8c (undo after page op reverts), B10 (restore icon distinct).
- `retests/def_123_131_verify_1.7.9.spec.cjs`: v1.7.9 verification of the nine defects the release claims fixed — DEF-123 (committed sign action bar + drag/commit), DEF-124 (edit-text mask, no ghost), DEF-125 (Sign exits Edit mode), DEF-126 (OCR suspects bar flush/translucent/no overlap), DEF-127/127b (text box mirrors content, drags as a unit, click reopens editor), DEF-128 (close unsaved sample tab offers Save As), DEF-129 (insert blank at position 1 prepends as page 1), DEF-130 (insert/undo/re-insert, no NaN), DEF-131 (per-page crop only the selected page). All 9 PASS.
- `retests/verif_zoom_jump_crop_1.7.10.spec.cjs`: v1.7.10 verification of the post-crop zoom-jump fix (`fitAnchor` split) — fit-width crop page 1 keeps uncropped pages at their previous absolute px and undo has no reverse jump, fit-page crop keeps them, an explicit fit-width click after a crop re-fits to the current page, and manual zoom stays exact across a crop. All 4 PASS.
- `retests/remaining_sweep.spec.cjs`: Miscellaneous feature verification.

## Support / Library
- `lib/launch.cjs`: Canonical Electron launcher.
