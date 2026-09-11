# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 397ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 525ms | PASS |
| Tab switch duration | < 300ms | 61ms | PASS |
| Idle memory (main process) | < 400MB | 124.08MB | PASS |
| Idle memory (whole app) | < 400MB | 517.32MB | FAIL* |

\* *Method: Measurements taken via Playwright Electron harness (Phase 5). Fresh production build (npm run build). long.pdf (520 pages) open, 10s idle. Process breakdown: Browser 116.96MB, GPU 111.88MB, Utility 49.37MB, Tab 239.12MB. Note: Whole-app < 400MB target rejected as architecturally unreachable for Electron (DEF-016). Revised Tab budget < 250MB is MET (239.12MB).*

## v1.7.11 deep-sweep re-measure (installed packaged app)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 516ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 477ms | PASS |
| Idle memory (main process RSS) | < 400MB | 142.29MB | PASS |

\* *Method: Playwright Electron harness against the packaged installed exe (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe). long.pdf is 520 pages, opened via the Open PDF dialog, 10s idle. Whole-app memory not re-measured here (the multi-process breakdown and the DEF-016 whole-app target note in the Phase-5 table stand); main-process RSS is comfortably under < 400MB. Recorded by qa during the v1.7.11 full deep sweep.*

## v1.9.0 full e2e suite re-measure (dev build)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 451ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 512ms | PASS |
| Idle memory (main process) | < 400MB | 125.63MB | PASS |

*Method: e2e/perf_retime + sweep_perf via the standard Playwright Electron harness (launchApp dev build, dist 1.9.0), recorded by qa during the v1.9.0 full-suite run (372 tests, Sep 2026). Second 520-page open measured 541ms in the same run.*

## Phase 14 gate re-measure (dev build, Liquid Glass + transparent window)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 572ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 536ms | PASS |
| Idle memory (main process) | < 400MB | 128.63MB | PASS |
| Animation frame rate (Phase 14 SC6: hover springs + palette motion + parallax) | 60fps, no frame drops | avg 60.0fps; p95 frame gap 16.7ms; max gap 16.8ms; 0 frames > 100ms | PASS |

*Method: e2e/perf_retime + e2e/phase14_qa.spec.cjs P14-E rAF frame probe via the standard Playwright Electron harness, dev build built from the current tree (npm run build; includes the Phase-14 transparent window `transparent: true` + `backgroundMaterial: 'acrylic'` and the glass theme). Budgets unchanged vs the 23:13 pre-transparent-window re-time (583/555/125.10MB) — window transparency costs nothing measurable. Recorded by qa at the Phase-14 gate.*

## Phase 14 close re-time (dev build with the DEF-189/DEF-190 fixes)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 547ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 517ms | PASS |
| Idle memory (main process) | < 400MB | 125.78MB | PASS |

*Method: e2e/perf_retime via the standard Playwright Electron harness on the uncommitted Phase-14 fix build (titlebar z-40 stacking fix + stamp selection-chrome page lift; dist rebuilt from the current tree). Unchanged vs the Phase-14 gate row above (572/536/128.63MB) — the fixes cost nothing measurable. Recorded by qa at the DEF-189/DEF-190 final verification (2026-09-13).*

