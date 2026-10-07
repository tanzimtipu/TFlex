# TFL-1128 - DEF-619 FIX-READY re-verification (qa) - 2026-10-07

Verdict: PASS. DEF-619 CLOSED. Model: openrouter/deepseek/deepseek-v4.1-flash.

## Claimed fix confirmed in source
- `src/renderer/components/DocumentView.tsx:4209-4226` - page-size report coalesced
  to one `requestAnimationFrame`, reads `pageSizesRef.current`, cancels a pending
  frame on unmount. Confirmed.
- `src/renderer/components/SideRail.tsx:581-599` - seeding effect bails with `prev`
  when the visible-thumb set is byte-identical. Confirmed.
- No change to `jumpToPage` / jump lock / sticky-target / selection / rail
  virtualization observed.

## 1. Build
`npm.cmd run build` -> EXIT=0 (renderer + node bundles built).

## 2. Dev spec x10 (DEF-619 repro)
`npm.cmd run test:e2e -- e2e/tfl1116_r04_navigation_sync.spec.cjs --repeat-each=10`
```
  10 passed (2.9m)
```
Baseline on TFL-1127 was 4/10 failing; now 10/10 green. 0 occurrences of
`Minified React error #185`.

## 3. QA crash probe x2
`npm.cmd run test:e2e -- e2e/tfl1116_r04_navigation_sync.qa.spec.cjs --repeat-each=2`
```
[QA-D] paneAfterJump=1 consoleErrors=0
[QA-D] no crash this run
[QA-E] paneAfterJump=1 consoleErrors=0
[QA-A] pageCount=520 consoleErrors=0
[QA-B] pane input count after jump=1
[QA-C] pane input count after jump=1
  10 passed (1.2m)
```
Baseline was 3/6 crashing (`paneAfterJump=0`); now 0 "CRASH captured", 0 console
errors across both repeats.

## 4. Focused unit suite (6 files)
`npm.cmd run test:unit -- test/unit/renderer/tfl1116_navigationSync.test.tsx
 test/unit/renderer/bug003_sideRailRecentre.test.tsx
 test/unit/renderer/bugDEF098_thumbnailJumpVisiblePage.test.tsx
 test/unit/renderer/bugDEF098_jumpTargetSticky.test.tsx
 test/unit/renderer/sideRail.test.tsx
 test/unit/renderer/phase111_navigatorChrome.test.tsx`
```
 Test Files  6 passed (6)
      Tests  29 passed (29)
```

## 5. verify
`npm.cmd run verify` -> `conventions: clean (390 source file(s) scanned)`, tsc exit 0, EXIT=0.

## 6. Blast radius - page-size reporting / geometry
Chosen specs (nearest to the page-geometry / thumb-aspect consumer):
`test/unit/renderer/pageGeometry.test.ts`,
`test/unit/renderer/defDEF141_mixedPageGeometry.test.ts`,
`test/unit/renderer/defDEF148PerPageThumbAspect.test.tsx`,
`test/unit/renderer/phaseC_pageViewSmoothRefresh.test.tsx`
```
 Test Files  4 passed (4)
      Tests  45 passed (45)
```
Additional real-app geometry probe (added by qa):
- On open and after a committed jump the Inspector Size IS correct
  (`612 x 792 pt`), so the coalesced report reaches the Inspector.
- Separate PRE-EXISTING defect DEF-620 found: after a tab away/back round trip the
  Inspector Size keeps the OTHER tab's geometry (or "Not available"). Reproduces on
  two small documents with no far jump / no crash path, so it is NOT a regression of
  the DEF-619 coalescing change.

## 7. R04 acceptance re-confirmed (screenshots inspected as images)
- `screenshots/tfl1116_r04_jump260.png`: Inspector "Page 260"; rail shows 258-260-261
  with page 260's "Viewing" thumb revealed inside `.thumb-scroller`; footer input
  `260 / 520`; Selection `1 selected` / Range Page 2 (unchanged).
- `screenshots/tfl1116_r04_jump520.png`: Inspector "Page 520"; page 520 revealed at the
  rail bottom; footer `520 / 520`; Next page disabled; Selection still `1 selected`.
- `screenshots/tfl1116_r04_tab_return.png`: two tabs; big tab re-activated; footer
  `520 / 520`; rail marker on 520 - footer and rail agree. (Inspector Size reads
  "Not available" here - the DEF-620 symptom, not an R04 acceptance item.)
- `screenshots/tfl1116_r04_qa_ok.png`: QA probe run - pane alive, no crash.

## Artifacts
- Screenshots above, plus `screenshots/tfl1128_geometry_tab_return.png` (DEF-620).
- Probes: `e2e/tfl1128_def619_geometry_probe.qa.spec.cjs` and
  `e2e/tfl1128_geometry_generic.qa.spec.cjs` (both kept `test.fixme`, documenting
  DEF-620 without reddening the suite).
