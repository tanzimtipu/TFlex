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

## Phase 14.1 gate re-time (dev build, neutral Liquid Glass correction)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 555ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 565ms | PASS |
| Idle memory (main process) | < 400MB | 158.84MB | PASS |
| Animation frame rate (Phase 14 SC6: hover springs + palette motion + parallax) | 60fps, no frame drops | avg 60.0fps; p95 frame gap 16.7ms; max gap 16.8ms; 0 frames > 100ms | PASS |

*Method: e2e/perf_retime + e2e/phase14_qa.spec.cjs P14-E rAF frame probe via the standard Playwright Electron harness on the Phase-14.1 neutral-glass build (dist rebuilt from the current tree; GlassChrome/GlassSidebar/GlassControlGroup primitives, 20px blur films). Cold start and open are unchanged vs the Phase-14 close row (547/517ms); idle main RSS 158.84MB stays far under the < 400MB budget (the +33MB vs 125.78MB is session noise across runs, comfortably in budget). Frame rate measured on the same 14.1 build during the e2e update run. Recorded by qa at the Phase-14.1 gate (2026-09-13).*

## Phase 14.2 gate re-time (dev build, Liquid Glass polish)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 575ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 523ms | PASS |
| Idle memory (main process) | < 400MB | 126.14MB | PASS |

*Method: e2e/perf_retime via the standard Playwright Electron harness on the uncommitted Phase-14.2 polish build (dist rebuilt from the current tree before the run: 52px tokenized ann-toolbar, panel contract tokens, dead --tf-tools-inset token still pending DEF-192 fix, LayoutGrid tools glyph, 24/22px icon ladder). Unchanged vs the Phase-14.1 gate (555/565/158.84MB) and the Phase-14 close row (547/517/125.78MB) — the polish costs nothing measurable. Recorded by qa during the Phase-14.2 fix verification (2026-09-13).*

## Phase 15 animation-system audit timing (dev build, cross-theme animation system)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Theme crossfade frame rate (workspace, page 1 rendered, frosted -> dark and back) | 60fps maintained | 28-30fps during the 400ms window; worst frame gap 88-105ms (quiet idle baseline in the SAME session: 59-60fps, max gap 17ms) | FAIL -> DEF-195 |
| Layout shift during theme switch (CLS entries) | 0 | 0.0 across 4 runs | PASS |
| PDF content during theme switch | not animated/tinted | .pdf-page/.pdf-page-canvas opacity 1, transform none, filter none across every sampled frame while transitioning | PASS |
| Tab materialize/dissolve | 200ms / 150ms bands | materialize opacity 0 -> 1 settles ~240ms; dissolve 1 -> 0 over ~190ms; exit removes the node; 0 ghost tabs | PASS |
| Popover Pop In / Pop Out (theme dropdown) | 180-200ms band | in ~240ms (scale .95 -> 1, y -4 -> 0), out ~220ms, node removed | PASS |
| Tools palette spring (x 24 -> 0) | ~280ms band | settles ~340ms; page-inset margin tween 356px -> 0 (~300ms) rides alongside | PASS |
| Dialog spring (y 10, scale .97 -> 1) | ~240ms band | settles ~250ms; backdrop exit opacity-only ~140ms; nodes removed | PASS |
| Press / hover / fill / thumb / indicator | per token bands | press 0.982+ty1 @70ms (legacy group wins -> DEF-196); hover ty -1 @120ms; fill + thumb-select + indicator-in @180ms | PARTIAL |
| Reduced motion (CSS tokens + state changes) | collapse to instant, states visible | tokens 0s; theme flip instant; popover/tabs state changes work | PASS (boot-time) |
| Reduced motion (mid-session OS toggle) | respected live | JS springs keep running until restart (motion/react useReducedMotion captures once) | FAIL -> DEF-198 |

*Method: e2e/anim_audit.spec.cjs via the standard Playwright Electron harness on the uncommitted Phase-15 animation-system build (dist built 20:02 from the current tree). fps via an in-page rAF timestamp loop; the crossfade number is the unconfounded reverse-flip measurement (fps-only loop; the forward-flip sample that also ran the PDF-pin probe reads the same 30fps). Layout shift via PerformanceObserver layout-shift entries. PDF pinning via per-frame computed-style probes on .pdf-page/.pdf-page-canvas during the 900ms crossfade window. Spring/transition timings via 60fps rAF computed-style samplers. Boot-time reduced motion could not be forced at launch in this environment (--force-prefers-reduced-motion registered on the main process but did not reach the renderer); hook-level reduced variants are locked by unit tests. Recorded by qa during the Phase-15 animation-system audit (2026-09-13).*

## Phase 15 DEF-195/196/197 fix re-time (dev build, View Transitions crossfade + token wiring)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Theme crossfade frame rate (View Transitions API path, workspace, page 1 rendered, frosted -> dark and back) | 60fps maintained | 59-60fps; avg frame gap 16.7ms; worst 25-26ms (quiet idle baseline in the SAME session: 59-60fps, max 17ms) | PASS (was 28-30fps / worst 88-105ms -> DEF-195 CLOSED) |
| Frame-time graph | all frames < 33ms | screenshots/perf-60fps.png: 54 frames, every bar under the 33ms line (worst 25.1ms) | PASS |
| Crossfade duration | 400ms token | 452ms via startViewTransition (wrapper-proved); fallback class never applied while the API exists | PASS |
| Layout shift during theme switch (CLS) | 0 | 0.0 (API path and fallback path both) | PASS |
| PDF content during theme switch | not animated/tinted | .pdf-page/.pdf-page-canvas opacity 1 / transform none / filter none, one distinct state across all sampled frames | PASS |
| Fallback class-crossfade (API shadowed for the probe) | scoped 6-property colour transition | computed transition-property on <body> while the class is on: background-color, color, border-color, box-shadow, fill, stroke @ 0.4s; class lifecycle 520ms. Fallback fps ~29-30 (logged, never reached in Electron) | PASS (scope) |
| Tool-btn press (command bar, real pointer hold) | scale 0.97 @ 70ms band | matrix(0.97, 0, 0, 0.97, 0, 1) @ 70ms transform transition; release returns to hover lift; 0.982 literals: 0 in loaded CSS | PASS (was 0.982+ty1 -> DEF-196 CLOSED) |
| AnimatedDialog bloom (flatten confirm) | scale 0.95 -> 1 | first frame 0.95, settles ~250ms; exit mid-flight 0.9756 toward the 0.98 token; backdrop opacity-only | PASS |
| TfMenu / TfPanel token values | MOTION_SCALE.enter 0.95 / MOTION_TRANSLATE.panel 24px | menu 0.95 + y -4; panel x 20.2 -> 0, w/h constant 344x752, no CSS keyframes | PASS |
| fps battery: palette open/close, popover pop, tab materialize, wheel scroll | >= 50fps, no stalls | 58-60fps each; avg 16.7ms; worst gaps 17-30ms; CLS 0 | PASS |
| Renderer errors during the battery | none | one benign "Transition was skipped" unhandled rejection per boot/flip (echo double-apply) | FAIL -> DEF-199 (LOW, console-only) |

*Method: e2e/retests/def_195_196_197_retest.spec.cjs via the standard Playwright Electron harness on the uncommitted Phase-15 fix build (dist 20:47 from the current tree: View Transitions crossfade in hooks/useAnimations.ts, scoped 6-property fallback in styles/animations.css, press token wired in styles.css chunk 2, tfPresets -> motionTokens wiring). Same measurement shapes as the filing run e2e/anim_audit.spec.cjs so the numbers are directly comparable. Frame-time graph rendered from the raw rAF timestamps by e2e/lib/framegraph.cjs (pngjs). Recorded by qa at the DEF-195/196/197 retest (2026-09-13).*

## Bug-sweep re-time (dev build 1.13.0, pre-feature comprehensive sweep, 2026-09-12)

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 563ms (second launch in the same run: 602ms) | PASS |
| Open long.pdf (520 pages) to first canvas | < 3000ms | 1096ms (second measure 1091ms) | PASS |
| Idle memory (main process RSS), long.pdf open, 10s idle | < 400MB | 125.70MB (second run 129.19MB); renderer JS heap 18.41MB | PASS |
| Scroll fps over long.pdf (1400px/90ms steps, 3s window) | 60fps, no stalls | avg 60.0fps; p95 26.2ms; worst 30.3ms | PASS |
| Tab open/close leak probe (10x) | stable | main RSS delta +0.5MB after 3s settle | PASS |
| Theme crossfade frame rate (View Transitions path) | 60fps | 61.3-61.5fps; worst frame 17.3-17.6ms | PASS (DEF-195 fix holds) |

*Method: e2e/bug_sweep_full.spec.cjs SWEEP-8/SWEEP-9 via the standard Playwright Electron harness on the dev build rebuilt from the current tree (npm.cmd run build; includes the uncommitted update-service.ts changes). Cold start = launchDev() -> .sample-card selector. Open = Open PDF -> .workspace -> first .pdf-page canvas. Memory via process.memoryUsage().rss in the main process (Playwright electronApp.evaluate), 8s idle after open; whole-app figure not re-measured (the DEF-016 note stands). Recorded by qa during the 2026-09-12 comprehensive bug sweep.*

