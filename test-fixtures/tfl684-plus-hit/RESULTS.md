# TFL-684 — "+" hit-target fix: verification evidence

Change under test (working tree, uncommitted):
- `src/renderer/styles.css` — `.tab-list-new` gains `position: relative; z-index: 3`
  (above the active tab's `z-index: 2`, below the dragged tab's `z-index: 60`) so
  the "+" centre is always its own hit target.
- `test/unit/renderer/tfl684TabNewHitTarget.test.ts` — static CSS guard.

## Reproduction (Electron 44, real app, 640px minimum, tabs added wide then narrowed)

Command (the harness exports `ELECTRON_RUN_AS_NODE=1`, which breaks
playwright-core `_electron.launch`; it must be unset):

    env -u ELECTRON_RUN_AS_NODE node test-fixtures/tfl524-adversary/probe-plus-occlusion.cjs

Baseline (pre-fix, from the TFL-677 adversary report, `test-fixtures/tfl524-adversary/REPORT.md`):
- n=11: `elementFromPoint` at "+" centre returned `.tab-close`; raw click CLOSED a tab (11 -> 10); "+" coverage 6/16.
- n=14: identical; raw click CLOSED a tab (14 -> 13); "+" coverage 2/16.

Post-fix result:

    [occl n=11] count=11 tabW=8.17 centerHit=plus plusHits=16/16
    [click n=11] raw click at + centre (313.9,17.0): 11 -> 12 -> opened a tab (OK)
    [occl n=14] count=14 tabW=6 centerHit=plus plusHits=16/16
    [click n=14] raw click at + centre (314.0,17.0): 14 -> 15 -> opened a tab (OK)

Screenshots (this run): `plus-hit-11.png`, `plus-hit-14.png` (produced by
`test-fixtures/tfl684-plus-hit/probe-cdp.cjs`, a CDP variant of the same probe).

## Focused unit test

    npx vitest run test/unit/renderer/tfl684TabNewHitTarget.test.ts test/unit/renderer/tfl678TabClip.test.ts
    -> 2 files, 8 tests passed

## Note on the requested e2e regression test

The issue asks for an e2e spec asserting `elementFromPoint` at the "+" centre.
The frontend-dev hard rules forbid editing `e2e/` (owned by QA). This fix adds
the strongest allowed guard (a static CSS unit test) plus the runnable probe
fixture above; the canonical `e2e/` spec is requested from QA.
