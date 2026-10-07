# TFL-1127 - TFL-1116 C5 / finding R04 focused verification - raw evidence

Verdict: FAIL (intermittent renderer crash). Defect filed: DEF-619 (HIGH).

## Commands and results (all raw output in the sibling .log files)

1. `npm.cmd run test:unit -- test/unit/renderer/tfl1116_navigationSync.test.tsx test/unit/renderer/bug003_sideRailRecentre.test.tsx test/unit/renderer/bugDEF098_thumbnailJumpVisiblePage.test.tsx test/unit/renderer/bugDEF098_jumpTargetSticky.test.tsx test/unit/renderer/sideRail.test.tsx test/unit/renderer/phase111_navigatorChrome.test.tsx`
   - `Test Files  6 passed (6)` / `Tests  29 passed (29)` - 0 failed.

2. `npm.cmd run verify`
   - `conventions: clean (390 source file(s) scanned)` and typecheck exit 0.

3. `npm.cmd run build` exit 0, then `npm.cmd run test:e2e -- e2e/tfl1116_r04_navigation_sync.spec.cjs`
   - 10 runs: 4 FAILED (React error #185 at spec line 146), 6 passed.
   - Failure output: `[ELECTRON-WINDOW] Error: Minified React error #185` then
     `expect(locator).toHaveValue(expected) failed ... Expected: "260" ... Error: element(s) not found`
     at `e2e/tfl1116_r04_navigation_sync.spec.cjs:146:23`.
   - See `dev_spec_fail_run.log` (failing) and `dev_spec_pass_run.log` (passing).

4. Blast radius - `npm.cmd run test:unit -- test/unit/renderer/phase111_pages.test.tsx test/unit/renderer/phase112_pages.test.tsx test/unit/renderer/phase111_navigatorChrome.test.tsx`
   - `Test Files  3 passed (3)` / `Tests  40 passed (40)` - no pages-panel / thumb-strip regression.

5. QA isolation probe `e2e/tfl1116_r04_navigation_sync.qa.spec.cjs` (verbatim dev flow):
   - 3/6 runs crashed (`paneAfterJump=0`, 1 console error). Blank-window capture: `screenshots/tfl1116_r04_qa_crash.png`.
   - See `qa_probe_crash_run.log`.
   - Controls: 40-page doc committed jump crashed 0/6 (`--grep QA-E`); idle 520-page open crashed 0/1;
     tracked non-C5 `e2e/phase109_viewstrip.spec.cjs --grep P109-3` passed.

## Acceptance matrix

| R04 acceptance | Result |
| --- | --- |
| 520-page jump 1 -> 260 -> 520 reveals the viewed thumb, footer agrees, Next disabled at 520 | PASS on non-crashing runs (dev screenshots reproduced; fresh passing captures on disk) |
| Main-view scroll must not recentre the rail | PASS (unit rail gate test) |
| Tab away/back: canvas, input and rail marker agree | PASS on non-crashing runs |
| Selection independent of viewed page | PASS on non-crashing runs |
| Jumps are reliable / app stays mounted | FAIL - React #185 blanks the renderer in ~40-50% of runs |

## Doc-maintenance

CONTROL-INDEX.md already carries a `TFL-1126 (TFL-1116 C5, R04)` entry (lines 119-134): done, not outstanding.

## Model

Pinned model: `openrouter/deepseek/deepseek-v4.1-flash` (tactical tier). No substitution.
