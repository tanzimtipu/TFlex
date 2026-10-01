# TFL-272 - DEF-466 FIX-READY retest (attempt 2)

Result: PASS -> DEF-466 CLOSED.
Tree: working tree (TFL-268 fix present at src/renderer/styles.css:15998 `container-type: size`, 18965+ bounded box). Not HEAD.
Blocker resolved by TFL-274: the two frozen unit oracles now assert `container-type: size`
(phase40_multiPillsHorizontal.test.ts:239, def315_dockPillClearance.test.tsx:893).

## Step 1-2
- `npm.cmd run build:renderer` -> exit 0 (vite built in 786ms)
- `npm.cmd run verify` -> exit 0 (conventions clean 319 files; tsc --noEmit clean)

## Step 3 - focused unit (6 files)
- `npm.cmd run test:unit -- test/unit/renderer/phase78NoticeInCanvas.test.tsx test/unit/renderer/phase67NoticeCollapse.test.tsx test/unit/renderer/phase59ProtectionNotice.test.tsx test/unit/renderer/phase53_convertImport.test.tsx test/unit/renderer/engineeringSurfaces.test.tsx test/unit/renderer/readingView.test.tsx`
- Result: 6 files passed / 84 tests passed / exit 0

## Step 7 - unit blast B (3 files)
- `npm.cmd run test:unit -- test/unit/renderer/phase40_multiPillsHorizontal.test.ts test/unit/renderer/phase39DockPillBasisParity.test.ts test/unit/renderer/def315_dockPillClearance.test.tsx`
- Result: 3 files passed / 58 tests passed / exit 0 (was 2 failed/56 passed at attempt 1)

## Step 4 - decisive acceptance probe (`node test-fixtures/adv-p78/probe.cjs multi 30 W H`)
- 1024x768: prot insideCanvas:true escapeBottomPx -555; 3D insideCanvas:true escapeBottomPx -23 height 524 scrollHeight 856 > clientHeight 522 maxScroll/scrolledBy 334 overflowY:auto scrollable:true; overlap:false; errors:[]
- 900x600: 3D insideCanvas:true escapeBottomPx -23 height 356 scrollHeight 856 > clientHeight 354 scrolledBy 502 overflowY:auto; overlap:false; errors:[]
- 640x1392: 3D insideCanvas:true escapeBottomPx -330 height 841 scrollHeight==clientHeight 839 (canvas tall enough, fully visible) overflowY:auto; overlap:false; errors:[]
- Logs: test-fixtures/TFL-272b-probe-{1024x768,900x600,640x1392}.txt

## Step 5 - e2e phase78
- `npx.cmd playwright test e2e/phase78_notice_in_canvas.spec.cjs` -> 2 passed / exit 0
- Criteria re-confirmed: iconPitch 36, gapBookIcon 8, dwell 8976ms, reduced-motion 1e-05s

## Step 6 - blast A (notice family)
- `npx.cmd playwright test e2e/phase59_protection_notice.spec.cjs e2e/tfl46_protection_probe.spec.cjs e2e/phase67_notice_geometry.spec.cjs` -> 5 passed / exit 0

## Step 7 - e2e blast B (phase36) - pre-existing / unrelated
- `npx.cmd playwright test e2e/phase36_def322_323_retest.spec.cjs e2e/phase36_layout_retest.spec.cjs` -> 2 passed / 5 failed
- Root cause (unchanged from attempt 1): the app launches maximized and the specs call `setSize` without `unmaximize()`, so `window.innerWidth` stays 2560 and `waitForFunction(innerWidth ~ target)` times out before any DEF-466-relevant path; the rail is also 64px vs the specs' stale `<=46` oracle. Not caused by the container-type change. Pill-ladder invariant recheck under a corrected resize (unmaximize+setSize) held at 1440/1100/900/760/640 (attempt-1 evidence).

## Disposition
- DEF-466: CLOSED (Status updated; one History line appended). No other DEFECTS.md edit.
