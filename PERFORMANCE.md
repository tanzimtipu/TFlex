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

