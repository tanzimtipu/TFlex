# TFL-274 — update two frozen unit oracles pinning `.canvas-overlay container-type`

## Change
DEF-466 fix (TFL-268) changed the single-mode rule in `src/renderer/styles.css:15998`
from `container-type: inline-size` to `container-type: size` (so `100cqh` resolves
against the real canvas). Two frozen oracles still pinned the old literal:

1. `test/unit/renderer/phase40_multiPillsHorizontal.test.ts:239`
   - `container-type:\s*inline-size` -> `container-type:\s*size`
2. `test/unit/renderer/def315_dockPillClearance.test.tsx:893`
   - `container-type:\s*inline-size` -> `container-type:\s*size`

Both still assert the layer is the `canvas-pills` query container (unchanged);
only the axis scope moved from inline to both (needed for the `cqh` consumer).

## Verification
Command:
```
npx.cmd vitest run test/unit/renderer/phase40_multiPillsHorizontal.test.ts test/unit/renderer/def315_dockPillClearance.test.tsx
```
Result:
```
Test Files  2 passed (2)
     Tests  51 passed (51)
  Duration  2.27s
```

## Full renderer unit sweep (context, not gating)
`npx.cmd vitest run test/unit/renderer` -> 452 passed files / 4854 passed tests,
3 failed files / 6 failed tests. The 6 failures are all in
`phase52Dialogs.test.tsx` / `phase53_conversionNoticeInspectorHitTest.test.ts` /
`phase53_protectionNoticeInspectorHitTest.test.ts`, failing on
`[data-protection-collapse]` / `[data-conversion-collapse]` DOM presence. They
are caused by other tasks' in-flight uncommitted edits to
`ProtectionNotice.tsx` / `ConversionNotice.tsx` / `useNoticeCollapse.ts`, are
unrelated to `container-type`, and none reference the changed literal.

## Commit state
Left uncommitted per the frontend-dev role layer ("git-agent is the only
committer"). `def315_dockPillClearance.test.tsx` also carries other tasks'
uncommitted edits, so it must not be committed by this task.
