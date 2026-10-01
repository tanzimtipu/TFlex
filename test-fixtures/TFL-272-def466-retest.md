# TFL-272 — DEF-466 FIX-READY retest (qa, attempt 1)

Verdict: **FAIL to close** — product acceptance green; two frozen unit oracles broken by the fix.
DEF-466 remains **OPEN**.

Fix under test (working tree, TFL-268): `src/renderer/styles.css` `.canvas-overlay`
`container-type: size` (was `inline-size`) + expanded-box `align-items:flex-start;
max-height:calc(100cqh - var(--tf-chrome-y,0px) - 200px); overflow:auto;`.

## Commands and counts
| # | Command | Result |
|---|---------|--------|
| 1 | `npm.cmd run build:renderer` | exit 0 (vite built in 839ms) |
| 2 | `npm.cmd run verify` | exit 0 (conventions clean 319 files; tsc noEmit) |
| 3 | `npm.cmd run test:unit -- <6 notice files>` | 6 files passed, 84 tests passed |
| 4 | `node test-fixtures/adv-p78/probe.cjs multi 30 1024 768` | both insideCanvas true, overlap false, 3D scrollable |
| 4 | `... multi 30 900 600` | both insideCanvas true, overlap false, 3D scrollable |
| 4 | `... multi 30 640 1392` | both insideCanvas true, overlap false (canvas fits box) |
| 5 | `npx.cmd playwright test e2e/phase78_notice_in_canvas.spec.cjs` | 2 passed |
| 6 | `npx.cmd playwright test e2e/phase59_protection_notice.spec.cjs e2e/tfl46_protection_probe.spec.cjs e2e/phase67_notice_geometry.spec.cjs` | 5 passed |
| 7 | `npx.cmd playwright test e2e/phase36_def322_323_retest.spec.cjs e2e/phase36_layout_retest.spec.cjs` | 2 passed / 5 failed (pre-existing, unrelated) |
| 7 | `npm.cmd run test:unit -- <3 pill files>` | **2 failed / 56 passed** |

## Step 4 measurements (probe, working-tree build)
- 1024x768: 3D box top 220.95 bottom 744.95, overlay bottom 768, `escapeBottomPx -23`, height 524,
  `scrollHeight 856 / clientHeight 522`, maxScroll 334, scrolledBy 334, `overflowY:auto`, `scrollable:true`.
  Protection: insideCanvas true, `escapeBottomPx -555`, height 108.95.
- 900x600: 3D box top 220.95 bottom 576.95, overlay bottom 600, `escapeBottomPx -23`, height 356,
  `scrollHeight 856 / clientHeight 354`, scrolledBy 502, `overflowY:auto`, `scrollable:true`.
  Protection: `escapeBottomPx -387`.
- 640x1392: 3D box bottom 1062, overlay bottom 1392, `escapeBottomPx -330`, height 841,
  `scrollHeight 839 / clientHeight 839` (canvas tall enough — full message visible, no clip needed).
  Protection: `escapeBottomPx -1179`.
- `errors:[]` on every size.

## BLOCKER (directly caused by the fix)
The single-mode `.tab-stage[data-multi-mode='false'] .canvas-overlay` rule changed
`container-type: inline-size` -> `size`. Two frozen oracles pin the old literal:
- `test/unit/renderer/phase40_multiPillsHorizontal.test.ts:239`
- `test/unit/renderer/def315_dockPillClearance.test.tsx:893`
Both fail: expected `...container-type:\s*inline-size` — received the new `size`.
QA may not edit unit tests, so closure requires frontend-dev to update these oracles
(or take a different approach).

## Blast radius B e2e — pre-existing failures, not DEF-466
`e2e/phase36_def322_323_retest.spec.cjs` launches maximised and its `setSize` never
calls `unmaximize()`, so `innerWidth` stayed 2560 at every target width and the
`waitForFunction` timed out (reproduced in isolation; scratch log below). The app is
unrelated to the CSS change here. `phase36_layout_retest` fails on a stale rail-width
oracle (rail is now 64px, spec asserts `<=46`) plus the same resize issue.
With `unmaximize()` before `setSize`, the DEF-322 invariants hold at all five widths:

```
w=1440 overlap=false covered=[] OK=true
w=1100 overlap=false covered=[] OK=true
w= 900 overlap=false covered=[] OK=true
w= 760 overlap=false covered=[] OK=true
w= 640 overlap=false covered=[] OK=true
fails=0
```

## Criteria 2/3/4 re-confirmed (unchanged)
`iconPitch=36`, `gapBookIcon=8.15`, `gapBookLayout=8`, `layoutRightInset=12`;
icon-first enter `protIconFrames=2`, `pdf3dIconFrames=3`, `convIconFrames=2`;
dwell 8482ms then collapse; reduced-motion enter `1e-05s`.

## Evidence files
- test-fixtures/TFL-272-build-renderer.txt
- test-fixtures/TFL-272-verify.txt
- test-fixtures/TFL-272-unit.txt
- test-fixtures/TFL-272-probe-scroll-{1024x768,900x600,640x1392}.txt
- test-fixtures/TFL-272-e2e-p78.txt
- test-fixtures/TFL-272-blastA.txt
- test-fixtures/TFL-272-unit-pills.txt
- test-fixtures/TFL-272-resize-probe.txt
- test-fixtures/TFL-272-def322-probe.txt
