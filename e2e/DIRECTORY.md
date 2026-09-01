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
- `retests/remaining_sweep.spec.cjs`: Miscellaneous feature verification.

## Support / Library
- `lib/launch.cjs`: Canonical Electron launcher.
