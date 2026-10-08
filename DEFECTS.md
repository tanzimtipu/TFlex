# Defects

> Read discipline: this is a long-lived evidence ledger, not default agent context. For a
> focused task, search for the assigned `DEF-NNN` and read only that entry. For triage,
> inspect the current `OPEN`, `FIX-READY`, and `DISPUTED` entries first; closed records are
> historical evidence and must not be loaded wholesale.

## DEF-655: Intake dispatch loses a queued file when a row is removed mid-open

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1346 (2026-10-08): `createIntakeModel.dispatch` now iterates a `list.slice()` snapshot and skips any item no longer in the live `list` (`if (!list.includes(item)) continue`), so a mid-dispatch `remove()` affects only that row and no queued file is skipped. Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest `node test-fixtures/tfl1248-adversary/probe-intake-dispatch.mjs` section D -> `skipped ids: []`, `b.pdf ... visited by dispatch? true` (false = silently dropped; was false pre-fix); all three queued PDFs opened. Model regression green in `phase118_intakeModel.test.tsx` (5 files / 53 tests).
- Severity: MEDIUM - A user removing a row while an import is running can silently lose the next queued file; violates the phase's "truthful intake" criterion.
- Found by: adversary (TFL-1248, ADV-251, 2026-10-08)
- Phase: 118
- Source: ADVERSARIAL_REVIEW.md ADV-251

Files:
- `src/renderer/intake/model.ts` (dispatch loop line 262; remove() lines 209-213)

Steps to reproduce:
1. `node test-fixtures/tfl1248-adversary/probe-intake-dispatch.mjs` (section D): queue three ready PDFs a/b/c, start `dispatch`, remove the row being opened.
2. Expected: removing a row affects only that row; the remaining queued files still open, in order.
3. Actual: `dispatch` iterates the live `list` across the `await openPdf`, so the splice makes the iterator skip the next item.

Evidence: probe section D (openPdf calls drop below the queued count).

## DEF-656: Two dispatches during one slow PDF open build the images PDF twice

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1346 (2026-10-08): `dispatch` gained a closure in-flight guard `dispatchInFlight` (a concurrent `dispatch()` returns `{ opened: [], images: [], skipped: [] }`), and image items now enter `converting` at collection time inside the loop; `liveImageItems` is filtered against `list`. Host guard `intakeRunningRef` untouched. Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest `probe-intake-dispatch.mjs` section E -> `openPdf calls=1`, `createFromImages calls=1` (a value of 2 is a duplicate PDF build; was 2 pre-fix). Regression green in `phase118_intakeModel.test.tsx`.
- Severity: LOW - The host already guards with `intakeRunningRef`, so no user-visible duplicate today; the model itself has no in-flight guard (defense-in-depth).
- Found by: adversary (TFL-1248, ADV-252, 2026-10-08)
- Phase: 118
- Source: ADVERSARIAL_REVIEW.md ADV-252

Files:
- `src/renderer/intake/model.ts` (dispatch line 253; image collection line 286)

Steps to reproduce:
1. `node test-fixtures/tfl1248-adversary/probe-intake-dispatch.mjs` (section E): queue `[one.png, two.png, doc.pdf]`, start `dispatch`, start a second `dispatch` while `openPdf` is pending.
2. Expected: `createFromImages` runs exactly once; a second dispatch no-ops or reports busy.
3. Actual: images stay `ready` until after the PDF loop, so the second dispatch re-collects them - `createFromImages calls=2`.

Evidence: probe section E.

## DEF-657: A dropped OS file's resolved on-disk path is discarded, so its PDF route opens by bare basename

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1346 (2026-10-08): `useOsFileDrop.onIntake` now receives `OsDropEntry[]` (`{ path, file }`) carrying the `resolveDroppedPath` result through to the model, and `App.tsx` `onIntakeFiles` stores the resolved path so a dropped file opens by its absolute on-disk path, not its basename. Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest e2e `phase118_intake.spec.cjs` T6 (real CDP `Input.dispatchDragEvent` drop of `dupA/same.pdf` over a colliding `dupB/same.pdf` basename): staged `ready`, then dispatched and opened by its RESOLVED absolute path, queue cleared -> PASS. Source confirms the fix at the right layer: `useOsIntegration.ts:160-170` hand `{ path, file }` to `onIntake`; `App.tsx:2887-2890` `onIntakeFiles` stores `pathOrFile: path`. NOTE: the adversary `probe-intake-drop-path.mjs` section F is a stale oracle - it manually replays the pre-fix `add({ pathOrFile: file })` contract instead of driving the fixed hook/App wiring, so its "PATH LOST" line is not a valid post-fix result.
- Severity: HIGH - The drop route is now wired to the shared open path; a same-named file elsewhere would be opened instead of the dropped file.
- Found by: adversary (TFL-1248, ADV-260, 2026-10-08)
- Phase: 118
- Source: ADVERSARIAL_REVIEW.md ADV-260

Files:
- `src/renderer/hooks/useOsIntegration.ts:150-159`
- `src/renderer/App.tsx:2885`
- `src/renderer/intake/model.ts:149-153`

Steps to reproduce:
1. `node test-fixtures/tfl1248-adversary/probe-intake-drop-path.mjs`.
2. Expected: a dropped file keeps its absolute on-disk path from the drop hook through to the open operation.
3. Actual: `resolveDroppedPath(file)` is used only for a null-check, then the bare `File` is passed on; `openPathFor` falls back to `file.name`, so `dispatch openPdf(path) = "report.pdf"` (basename).

Evidence: probe output section F.

## DEF-644: Intake Tray drop zone: eligible OS drag does not show the drop indication

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1345 (2026-10-08): host `osDragActive` state in `App.tsx` is wired via `onDragActiveChange: setOsDragActive` on `useOsFileDrop` and forwarded through `Welcome` `intakeActive` into `IntakeTray active` -> `data-intake-active`, so an eligible OS file drag shows the drop indication and it clears on drop (spec T2). Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest e2e `phase118_intake.spec.cjs` T2 -> `{overrode:false, activeVisible:true, activeAfterDrop:false, dropPrevented:true}`: the eligible OS drag shows `[data-intake-active]` and it clears on drop, and the drop is intercepted. The `overrode:false` line is only the in-renderer `webUtils.getPathForFile` stub limitation (resolved-path staging skips), not a defect - the resolved-path route is proven by T6.
- Severity: MEDIUM - The visual feedback for dragging files over the drop zone is missing, leading to a poor user experience as the user is unsure if the drop will be successful.
- Found by: qa (TFL-1247 e2e verification, 2026-10-08)
- Phase: 118

Files:
- `e2e/phase118_intake.spec.cjs`

Steps to reproduce:
1. `npm.cmd run dist`
2. `npx playwright test e2e/phase118_intake.spec.cjs --reporter=list`
3. Observe test `T2 drop zone: eligible OS drag shows the drop indication and routes files` failing.
4. Manually drag a file over the Intake Tray drop zone.

Expected: The drop zone shows a visual indication (e.g., a border, a highlight) when a file is dragged over it.

Actual: No visual indication is shown when dragging a file over the drop zone. The test `expect(res.activeVisible).toBe(true)` fails.

Evidence: e2e test output for `T2 drop zone`.

## DEF-645: Intake Tray truthful intake: unsupported files are not correctly staged or rejected with message

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1345 (2026-10-08): the Home tray unmounts when a document opens, so failed/skipped rows vanished; a persistent intake surface (`data-intake-persistent`, class `intake-persistent`) now renders from `App.tsx` whenever `intakeItems.length > 0 && !showWelcomeEffective`, reusing the same model/handlers so failed rows stay reachable with their truthful `data-intake-error` (spec T4). Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest e2e `phase118_intake.spec.cjs` T4 -> staged `unsupported.xyz` / `misleading.png` both `failed` with their own `data-intake-error` message (no bogus Ready), `protected.pdf` `ready` then `failed` ("could not be opened") on dispatch, `report-a.pdf` opened; the failed rows persist in the queue after the good PDF opens (partial failure). PASS.
- Severity: MEDIUM - Unsupported files are not handled as expected; they are neither staged in the list with an error message nor explicitly rejected. This leads to confusion for the user.
- Found by: qa (TFL-1247 e2e verification, 2026-10-08)
- Phase: 118

Files:
- `e2e/phase118_intake.spec.cjs`

Steps to reproduce:
1. `npm.cmd run dist`
2. `npx playwright test e2e/phase118_intake.spec.cjs --reporter=list`
3. Observe test `T4 truthful intake: unsupported / misleading-extension / protected partial errors` failing.
4. Manually drag and drop an unsupported file (e.g., `.xyz`) into the Intake Tray.

Expected: Unsupported files are either staged in the list with an error message indicating they cannot be imported, or they are rejected with a clear message.

Actual: The test `expect(names).toContain('unsupported.xyz')` fails because the array of staged files (`names`) is empty. This suggests unsupported files are not appearing in the intake list at all, with or without an error message.

Evidence: e2e test output for `T4 truthful intake`.

## DEF-647: Annotation flash overlay does not animate as expected

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — test-oracle error, NOT a product
defect.** The overlay DOES play `ann-flash` (1.6s / cubic-bezier(0.4, 0, 1, 1) /
forwards). The prior assertion read the computed style off the ROW and clicked the
row, which carries no click handler; the real Jump control sets `flashId` and mounts
`.ann-flash` on the page. Repointed spec `e2e/def362_flash_verify.spec.cjs` now clicks
`[data-annotation-row] button[aria-label^="Jump"]` and reads `.ann-flash` — PASS.

- Status: OPEN
- Severity: MEDIUM - The animation is a visual cue for navigation, and its absence degrades the user experience.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/def362_flash_verify.spec.cjs`

Steps to reproduce:
1.  Launch the Electron application.
2.  Open `report.pdf`.
3.  Create an ink annotation.
4.  Navigate to the REVIEW stage.
5.  Click the annotation row.
6.  Observe the `.thread-stream-row` element.

Expected: The `.thread-stream-row` element should have an animation with `name: "ann-flash"`, `dur: "1.6s"`, and `ease: "cubic-bezier(0.4, 0, 1, 1)"`.

Actual: The `.thread-stream-row` element has `name: "none"`, `dur: "0s"`, and `ease: "ease"`, indicating no animation is playing.

Evidence:
```
[DEF362] .ann-flash computed: {"name":"none","dur":"0s","ease":"ease","fill":"none","cls":"thread-stream-row"}
Error: the flash plays the ann-flash keyframe

expect(received).toBe(expected) // Object.is equality

Expected: "ann-flash"
Received: "none"
```
Error Context: `test-results\def362_flash_verify-DEF-36-e0ed1--on---motion-duration-flash\error-context.md`

## DEF-646: Intake Tray create-from-images: Confirm button is disabled when it should be enabled

- Status: CLOSED (qa TFL-1249 phase-close, 2026-10-08)
- History:
  - cto: FIX-READY relayed from frontend-dev TFL-1345 (2026-10-08): root cause was the reset effect keyed on `[open, initialQuality]` re-running when the host echoed the edited quality back, which cleared the picked queue; guarded to reset only on a closed->open transition (`wasOpenRef`), so `data-create-confirm` stays enabled with images queued. Regression test added to `phase118_imagesIntake.test.tsx`. Pending qa retest.
  - qa: CLOSED 2026-10-08 (TFL-1249 phase-close). Retest e2e `phase118_intake.spec.cjs` T5 -> after picking two images `data-create-confirm` is enabled (asserted `isDisabled()===false`), reorder/remove/quality wired, confirm built ONE PDF and opened it as a new tab. Regression `phase118_imagesIntake.test.tsx` green (5 files / 53 tests).
- Severity: MEDIUM - The "Create PDF" button in the image creation dialog remains disabled even when it should be active, preventing the user from creating a PDF from images.
- Found by: qa (TFL-1247 e2e verification, 2026-10-08)
- Phase: 118

Files:
- `e2e/phase118_intake.spec.cjs`

Steps to reproduce:
1. `npm.cmd run dist`
2. `npx playwright test e2e/phase118_intake.spec.cjs --reporter=list`
3. Observe test `T5 create-from-images: data-create-* controls, one PDF, disabled Create, clipboard message` failing with a `TimeoutError`.
4. Manually open the "Create PDF from images" dialog, add images.

Expected: After adding images, the "Create PDF" button becomes enabled, allowing the user to proceed.

Actual: The "Create PDF" button remains disabled, leading to a `TimeoutError` in the e2e test when attempting to click it.

Evidence: e2e test output for `T5 create-from-images` (TimeoutError).

## DEF-637: A settings-write rollback drops a newer legitimate settings echo, diverging the UI from disk

- Status: CLOSED
- Severity: MEDIUM - after a failed write's restore, a legitimately newer `settings.changed` echo is discarded while the older restored snapshot is re-applied, so the UI can diverge from disk; the next whole-object write can then overwrite the newer disk value (silent loss of the newer setting).
- Found by: adversary (ADV-246)
- Phase: 114

Files:
- `src/renderer/App.tsx:1901-1905` - `onSettingsRestore` sets `settingsPersistedRef.current = restored` but never advances `settingsWriteSeqRef.current`, so the restore snapshot is assumed newer than any in-flight write.
- `src/renderer/state/settingsEcho.ts:430-459` - `shouldApplyEcho` returns false for a content-mismatched echo when `writeSeq !== 0`.

Steps to reproduce:
1. `node --experimental-strip-types test-fixtures/tfl1254-adversary/probe_rollback_echo.mjs` - models the chunk-C bookkeeping (`settingsWriteSeqRef` -> seq, `settingsPersistedRef` -> ref, `onSettingsRestore` -> ref = disk with seq untouched) and feeds every decision through the REAL `shouldApplyEcho`.

Expected: the echo for the write that actually reached disk (Z) is applied, so the UI converges on the value on disk.

Actual: after write #1 fails and the restore sets `ref = P` (seq stays 2), `shouldApplyEcho(Z, 2, P)` returns false (the newer Z is DROPPED) while `shouldApplyEcho(P, 2, P)` returns true (the stale P is re-applied). Probe output matches the recorded log.

Evidence: `test-fixtures/tfl1254-adversary/probe_rollback_echo.mjs`, `test-fixtures/tfl1254-adversary/probe_rollback_echo.log`, re-run log `test-fixtures/tfl1264-adversary/probe_rollback_echo.log`.

History:
- qa: opened from ADV-246 (reproduced; probe output matches the adversary log).
- cto: FIX-READY relayed from frontend-dev TFL-1262 (2026-10-08): `noteSettingsRestore` sets `settingsPersistedRef` and resets `settingsWriteSeqRef` to 0 on restore, so a legitimately newer echo is applied; `phase114_rollbackCoherence.test.tsx` added (3 spec files, 13 tests, `npm run verify` clean). Pending qa retest.
- qa: CLOSED 2026-10-08 (TFL-1273). The probe now drives the REAL `noteSettingsRestore` (no longer models the pre-fix bookkeeping): `node --experimental-strip-types test-fixtures/tfl1254-adversary/probe_rollback_echo.mjs` -> `echo Z AFTER restore -> true` (newer value applied; was false). Regression `phase114_rollbackCoherence.test.tsx` 2/2 green; e2e `phase114_settings_studio.spec.cjs` 7/7 green.

## DEF-638: When `loadSettings()` fails after a write error, the UI keeps the value that never persisted

- Status: CLOSED
- Severity: LOW - the write-failure rollback is best-effort: when the authoritative re-read rejects or returns `ok:false`, no restore fires, so the optimistically-applied (never-persisted) value stays in the UI with only the generic toast. Narrow: requires the settings store to be unreadable while a write fails.
- Found by: adversary (ADV-247)
- Phase: 114

Files:
- `src/renderer/hooks/useSettingsWriteRollback.ts:28-36` - on `settings:writeError` it calls `onError(message)`, then `loadSettings().then(result => { if (result.ok) onRestore(result.value); }).catch(() => undefined)`; neither the non-`ok` nor the reject branch fires a restore.

Steps to reproduce:
1. `node test-fixtures/tfl1264-adversary/probe_loadfail_keep.mjs` (mirrors the hook body verbatim against a mocked `window.tflex`).
2. Drive `writeError` with `loadSettings()` resolving `{ok:true}`, then `{ok:false}`, then rejecting.

Expected: on any write failure the UI must not keep a value that never persisted (the chunk-C claim: a failed write restores the prior value).

Actual: `{ok:true}` -> `onRestore` fires (claim holds); `{ok:false}` and reject -> `onRestore` NOT called, only the toast, and the unpersisted value stays.

Evidence: `test-fixtures/tfl1264-adversary/probe_loadfail_keep.mjs`, `test-fixtures/tfl1264-adversary/probe_loadfail_keep.log`.

History:
- qa: opened from ADV-247 (reproduced; `{ok:false}` and reject fire no restore).
- cto: FIX-READY relayed from frontend-dev TFL-1262 (2026-10-08): the hook now takes `getLastConfirmed` and restores it when `loadSettings()` resolves `ok:false` or rejects; `phase114_settingsRollback.test.tsx` covers both branches. Pending qa retest.
- qa: CLOSED 2026-10-08 (TFL-1273). Probe mirrors the fixed hook body: `node test-fixtures/tfl1264-adversary/probe_loadfail_keep.mjs` -> `{ok:true}`, `{ok:false}` and reject all call `onRestore` with `keptOptimistic=false` (was: `{ok:false}`/reject fired no restore). Regression `phase114_settingsRollback.test.tsx` 6/6 green.

## DEF-639: A settings write queued behind a failed write is persisted as the rolled-back value, silently dropping the newer change

- Status: CLOSED
- Severity: MEDIUM - after a failed settings write, the next queued write persists the rolled-back value instead of the user's newer change, so the newer setting is silently dropped on disk with only the generic toast (documented change loss in the persistence path).
- Found by: adversary (ADV-248)
- Phase: 114

Files:
- `src/main/services/settings.ts:1578-1583` (committed HEAD 5347365) - `save()` reads `this.current` when the queued `_doSave` task runs, not at call time.
- `src/main/services/settings.ts:1636` - the write-failure catch sets `this.current = structuredClone(this.persisted)` (DEF-230 rollback).

Steps to reproduce:
1. Bundle and run `test-fixtures/tfl1264-adversary/probe_queued_write_drop.mjs` (esbuild command in the probe header); it drives the REAL `SettingsService` queue with committed-HEAD `save()` semantics.
2. The probe persists P (theme `dark`), makes write #1 fail (blocks the atomic tmp path), issues write #1 X (theme `frosted`) then write #2 Z (theme `light`) before #1 settles, then lets #2 land.

Expected: write #2 persists the user's newer value Z (theme `light`); the failed write's rollback does not clobber it.

Actual: write #1's catch rolls `this.current` back to P (`dark`); write #2's task then reads `this.current` = P and persists P. Disk ends `theme=dark`, echoes `dark,dark`; the newer `light` never reaches disk. The same probe against the working tree (which already carries backend-dev's TFL-1263 snapshot-at-call-time fix, uncommitted) keeps Z (`theme=light`), confirming the defect is against the committed HEAD the adversary reviewed.

Evidence: `test-fixtures/tfl1264-adversary/probe_queued_write_drop.mjs`, `test-fixtures/tfl1264-adversary/probe_queued_write_drop.log`.

History:
- qa: opened from ADV-248 (reproduced against committed HEAD 5347365; working tree already carries the TFL-1263 fix, uncommitted).
- cto: FIX-READY relayed from frontend-dev TFL-1263 (2026-10-08): `save()` snapshots the argument at call time and persists the snapshot; `test/unit/main/settingsQueueFailure.test.ts` added (2 files, 197 tests, `npm run verify` clean; negative control discriminates the defect). Pending qa retest.
- qa: CLOSED 2026-10-08 (TFL-1273). Bundle+run `test-fixtures/tfl1264-adversary/probe_queued_write_drop.bundle.mjs`: working-tree `save()` semantics -> `echo themes dark,light` / `disk theme light` / "no defect - newer Z persisted" (committed-HEAD semantics still drop Z, the negative control). Regression `test/unit/main/settingsQueueFailure.test.ts` 2/2 green.

## DEF-640: C4a completion-action change leaves the C2 ActivityShelf component test red

- Status: CLOSED (qa TFL-1274 re-verify, 2026-10-08)
- Severity: MEDIUM - test-only regression that reddens the unit suite. C4a changed `availableCompletionActions` to return only the operation's declared actions, but the C2 component oracle still pins the removed hardcoded set, so `npm run test:unit` fails on one test. No product data impact (the model/store are still unwired into App), but the Activity Shelf work cannot show a green suite.
- Found by: qa (TFL-1270 blast-radius check, 2026-10-08)
- Phase: TFL-1216 C4a

Files:
- `src/renderer/state/activity.ts:302-318` - C4a `availableCompletionActions` returns exactly the declared `completionActions` (undo gated on a non-empty `transactionId`); failed returns `['view-details']`; default `[]`.
- `test/unit/renderer/activityShelf.test.tsx:155-169` - the C2 oracle builds an operation via `createOperation` with no declared actions and expects `['open-result', 'show-in-folder', 'view-details']` (and `undo` with a transaction id). Not updated by C4a; its mtime (2026-10-08T00:24Z) predates the C4a edit window (~01:12Z).

Steps to reproduce:
1. `npm.cmd run test:unit -- test/unit/renderer/activityShelf.test.tsx`.
2. The test `activityShelf completion actions > renders only the actions availableCompletionActions offers, and undo only with a transaction id` fails at `activityShelf.test.tsx:158`.

Expected: the C2 oracle reflects the C4a contract (declared-only actions) and the file is green.

Actual: `Test Files 1 failed (1)`, `Tests 1 failed | 15 passed (16)`; `AssertionError: expected [] to deeply equal [ 'open-result', ...(2) ]` (- open-result, show-in-folder, view-details / + []).

Evidence: `tfl1270_unit_neighbour.log`.

History:
- qa (TFL-1270, 2026-10-08): found via the standing blast-radius check; the two C4a-named test files pass (17/17 and 20/20) and `npm run typecheck` is clean, but this dependent C2 test is red. C4a's brief named only the two test files it modified, so this dependent oracle was missed. Fix is to update the stale oracle (product behaviour is intentional per C4a); not applied by qa.
- frontend-dev (TFL-1272, 2026-10-08): FIX-READY. Updated the stale C2 oracle `test/unit/renderer/activityShelf.test.tsx` to the C4a declared-actions contract; test-only, no product file modified. New test `offers exactly the declared actions, defaults to none, and gates undo on both declaration and a transaction id` drives the real imported `availableCompletionActions` both directly and through `ActivityShelfPanel`, pinning: declared `['view-details']` completed -> `['view-details']`; `[]` -> `[]`; `['undo']` with no transaction id -> `[]`; `['undo']` with a non-empty transaction id -> `['undo']`. `npm.cmd run test:unit -- test/unit/renderer/activityShelf.test.tsx` -> Test Files 1 passed (1), Tests 16 passed (16); `npm.cmd run typecheck` clean. Awaiting qa re-verification to CLOSE.
- qa (TFL-1274, 2026-10-08): CLOSED. Re-verified the fix. Retest commands: `npm.cmd run test:unit -- test/unit/renderer/activityShelf.test.tsx` -> Test Files 1 passed (1), Tests 16 passed (16); `npm.cmd run test:unit -- test/unit/renderer/activityShelfState.test.ts` -> 1 file / 17 passed; `npm.cmd run test:unit -- test/unit/renderer/activityShelfStore.test.ts` -> 1 file / 20 passed; `npm.cmd run typecheck` clean (exit 0). Independent review: the new test drives the REAL imported `availableCompletionActions` (no mock) and pins declared `['view-details']` completed -> `['view-details']`, `[]` -> `[]`, `['undo']` no tx id -> `[]`, `['undo']` with non-empty tx id -> `['undo']`; test count unchanged at 16 (stale assertion replaced, not deleted). Fix scope confirmed test-only: `test/unit/renderer/activityShelf.test.tsx` mtime 2026-10-08T12:29:31+11:00 is the latest-touched file; no product file (`activity.ts`, `activityShelf.ts`, `ActivityShelf.tsx`, App/DocumentView) changed after the C4a window. Activity Shelf cluster (3 files + typecheck) green together.

## DEF-641: The Phase 114 CONTROL-INDEX persistence-status control (`data-prefs-persist-status`) does not exist

- Status: CLOSED (qa TFL-1293 retest, 2026-10-08)
- Severity: MEDIUM - the Phase 114 `CONTROL-INDEX` (REQUIREMENTS.md:8617) names `data-prefs-persist-status` as a Studio control proven by a named test, and success criterion 4 requires immediate settings to show "Close plus persistence feedback". No such element, hook or handler exists in the renderer: immediate settings (theme, animations, tab style) apply with no rendered persistence feedback, only the global write-failure toast. A CONTROL-INDEX row with no production handler is a no-op.
- Found by: qa (TFL-1273 phase validation, 2026-10-08)
- Phase: 114

Files:
- `REQUIREMENTS.md:8617` - CONTROL-INDEX lists "persistence status (`data-prefs-persist-status`)".  `REQUIREMENTS.md:8579` (criterion 4) - "immediate with Close + persistence feedback".
- `docs/SETTINGS-STUDIO-INVENTORY.md:210` - the inventory itself records that `data-prefs-persist-status` "is the remaining selector from `phase-114.md:59` not yet in the source".
- `src/renderer/components/PreferencesDialog.tsx` - contains no `data-prefs-persist-status` (the only `role="status"` line is `data-prefs-default-pdf-status`, `:516`).

Steps to reproduce:
1. `cd "C:\Users\tanzi\OneDrive\App Development\TFlex"`.
2. Search the production renderer for the hook: `grep -rn "data-prefs-persist-status" src/` -> no match.
3. `node -e "const s=require('fs').readFileSync('src/renderer/components/PreferencesDialog.tsx','utf8');console.log(s.includes('data-prefs-persist-status'))"` -> `false`.

Expected: the CONTROL-INDEX row has a real production handler and a proving test, and the Studio shows persistence feedback for its immediate settings.

Actual: no `data-prefs-persist-status` element, hook or handler anywhere in `src/renderer/**`; the row is a no-op and criterion 4's persistence-feedback half is unmet.

Evidence: `test-fixtures/tfl1273-control-index-sweep.md` (row 9 = FAIL), e2e `phase114_settings_studio.spec.cjs`, `screenshots/phase114/studio-general.png`.

History:
- qa (TFL-1273, 2026-10-08): found in the Phase 114 CONTROL-INDEX sweep; filed, not fixed. All other 10 rows PASS.
- cto: FIX-READY relayed from frontend-dev TFL-1276 (2026-10-08): added `[data-prefs-persist-status]` (`role="status"`, `.settings-support`) in the Studio body via a new `persistStatus` prop (default "All changes saved."); App records the failure message in `onSettingsWriteError` and clears it on the next `settings.changed` echo; `phase114_persistStatus.test.tsx` (3 tests) added; `npm run verify` clean; 2 files / 8 tests green. Pending qa retest.
- qa (TFL-1285, 2026-10-08): retest NOT PASSED -> left OPEN. `phase114_persistStatus.test.tsx` is green (4/4: role=status, success/failure text, and the TFL-1282 "not a descendant of the scrolling groups column" guard), so the control itself satisfies the row. But the same TFL-1282 change that pinned the line into a non-scrolling footer collapses the Studio body to 0px and overlaps the section navigator, so the real-app e2e E1 (`[data-prefs-category]` click) times out; filed DEF-646 (HIGH). The row cannot be closed while its fix leaves the Studio unusable.
- qa (TFL-1293, 2026-10-08): CLOSED. DEF-646 fixed (TFL-1290), so the control is now visible and usable in the real app. Retest: `npx vitest run test/unit/renderer/phase114_persistStatus.test.tsx` -> 4 passed (role=status; at-rest "All changes saved."; failure+rollback sentence; not a descendant of the scrolling column). Real-app visibility proven in `e2e/tfl1293_scope_footer.spec.cjs` S2: `[data-prefs-persist-status]` is visible and on screen, sits on the shell footer BELOW the scrolling `.settings-studio-body` (overflow-y auto), inside the sheet bottom, and stays visible/pinned at full and 520px compact width; `screenshots/phase114/studio-full-footer.png` + `studio-compact-footer.png`. Phase 114 CONTROL-INDEX row 9 now PASS (10 PASS / 0 FAIL) - `test-fixtures/tfl1293-control-index-sweep.md`.

## DEF-636: Stale Phase 23 animations-switch assertion reddens verify:full (blocks the 1.51.1 release gate)

- Status: CLOSED (qa TFL-1211 re-verify, 2026-10-08)
- Severity: LOW - test-only. The PreferencesDialog Animations hint copy changed in the visual-overhaul review pass and the Phase 23 unit oracle kept the old string, so `verify:full` (conventions + typecheck + full unit suite) fails on one assertion and blocks the Jovrel 1.51.1 release gate. No product impact; the shipped copy is correct.
- Found by: qa (TFL-1209 release-gate phase validation, 2026-10-08)
- Phase: release OTA TFL-1204 (Jovrel 1.51.1)

Files:
- `test/unit/renderer/phase23_animationsSwitch.test.tsx:113` - asserts `toContain("menus, panels and dialogs appear instantly")` (string unchanged since `e0b817e`, Phase 23).
- `src/renderer/components/PreferencesDialog.tsx:424` - the hint now reads "When off, menus, panels, dialogs and page changes appear without transition animations." (copy changed in `dc68679`, TFL-1146 AR-01..AR-09).

Steps to reproduce:
1. `npm.cmd run verify:full`.
2. `test/unit/renderer/phase23_animationsSwitch.test.tsx > PreferencesDialog Animations control > renders the stored value and the explanatory hint` fails. Suite: Test Files 1 failed | 727 passed (728); Tests 1 failed | 8842 passed (8843). Deterministic: re-run alone -> 1 failed | 9 passed.

Expected: the assertion matches the current shipped hint copy so the release gate is green.

Actual: the test pins the superseded copy, so it fails.
- Command: `npm.cmd run test:unit -- test/unit/renderer/phase23_animationsSwitch.test.tsx` -> 1 failed.

History:
- qa (TFL-1209, 2026-10-08): observed RED on `verify:full`; classified STALE TEST (product copy changed in `dc68679`; test string unchanged since Phase 23); pre-existing at HEAD, NOT caused by the 1.51.1 `WHATS_NEW` entry (`test/unit/main/whatsNew.test.ts` is among the 727 passing). Product and feed items of the gate were GREEN. Routed to the renderer test owner.
- frontend-dev (TFL-1210, 2026-10-08): FIX-READY - updated the stale expected substring at `test/unit/renderer/phase23_animationsSwitch.test.tsx:113` to "menus, panels, dialogs and page changes appear without transition animations", matching `src/renderer/components/PreferencesDialog.tsx:424`. One file, one line; assertion shape retained; product untouched. Evidence: `npm.cmd run test:unit -- test/unit/renderer/phase23_animationsSwitch.test.tsx` -> 1 file passed, 10 passed / 0 failed; `npm.cmd run verify:full` -> exit 0, conventions clean (395 source files), 728 test files passed, 8843 tests passed / 0 failed. doc-maintenance: no changes required. Awaiting qa re-verify.
- qa (TFL-1211, 2026-10-08): CLOSED. Independently re-ran the release gate: `npm.cmd run verify:full` -> exit 0, conventions clean (395 source files), Test Files 728 passed (728), Tests 8843 passed (8843), 0 failed; `test/unit/renderer/phase23_animationsSwitch.test.tsx` 10 passed. Line 113 matches the shipped copy at `src/renderer/components/PreferencesDialog.tsx:424`. Full suite green at release commit 4f7721f.

## DEF-631: Text inspector still scrolls horizontally at normal full-window width; its preview clips a formatting control

- Status: CLOSED (qa TFL-1198 retest, 2026-10-08)
- Severity: MEDIUM - the text inspector's own content still overflows horizontally at a normal full-window width, so a formatting row/preview is cut off and requires a nested horizontal scroll. ER02 (audit P2) is NOT resolved by the R11 panel-shell pass, which only asserts the outer `.inspector-body` has no nested scroll.
- Found by: qa (TFL-1196 ER01..ER24 re-audit, ER02)
- Phase: visual-overhaul correction 3 (TFL-1195), ER02

Files:
- `src/renderer/components/edit/TextPropertiesPanel.tsx` (the re-parented Inspector text panel) - `.text-props-body` carries `overflow-x: auto`; its children overflow the inspector's fixed ~269px width.

Steps to reproduce (HEAD `dc68679`, app v1.51.0, dev build):
1. `npm.cmd run build`; open `report.pdf`; go to Edit (Ctrl+2) and click the "Text" dock verb; click a text run on page 1 to open the text inspector.
2. Inspect the inspector at 1440x900: the nested `.text-props-body` has `scrollWidth 246 > clientWidth 237` with `overflow-x: auto` (a horizontal scrollbar renders), `section.text-props-group` / `div.text-props-btn-row` overflow by ~19px, and `div.text-props-preview` clips its text (`scrollWidth 263 > clientWidth 215`, `overflow-x: hidden`).

Expected: all formatting controls reflow into complete groups at normal width with no nested horizontal scroll and no clipped control (ER02).

Actual: nested horizontal overflow persists; a formatting control/preview is cut off.
- Command: `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "B:"` -> 1 passed, log `[tfl1196-ER02-normal-1440] bodyScrollW=269 bodyClientW=269 bodyOverflowX=hidden controls=25 clipped=0 nested=[text-props-body sw246/cw237 overflowX=auto, text-props-group 236/217, text-props-preview 263/215 hidden, text-props-btn-row 236/217]`.
- Screenshot: screenshots/tfl1196_er02_text_inspector_full.png (horizontal scrollbar visible at the inspector foot).

History:
- qa (TFL-1196, 2026-10-08): classified STILL-PRESENT at HEAD; not verified by `tfl1116_r11_panel_shell.spec.cjs` (that spec passed but measures only the outer panel body).
- orchestrator (TFL-1197, 2026-10-08): FIX-READY - developer reports reflow fix in `styles.css` (min-width:0 + flex-wrap on `.text-props-row`/`.text-props-btn-row`; `.text-props-btn` min-width:0 beats `.btn-icon`; `.text-props-preview` wraps; no `overflow-x:hidden` workaround). Evidence: 5 unit files / 82 tests passed, `npm.cmd run verify` clean, `npm.cmd run build` success; oracle observed bodyOverflowX=hidden, nested=[], clipped=0 at 1440x900 and 985x645. Awaiting qa retest.
- qa (TFL-1198, 2026-10-08): CLOSED. Retested at current working-tree build (HEAD `dc68679` + TFL-1197 changes, app v1.51.0, dev build; inner DIP 1440x900 full and 985x645 compact). Oracle `e2e/tfl1196_er_uncovered_audit.spec.cjs -g "B:"` -> 1 passed (11.0s). Full 1440x900: `{"textPanel":true,"bodyScrollW":269,"bodyClientW":269,"bodyOverflowX":"hidden","controls":25,"clipped":0,"nested":[]}`; compact 985x645 drawer: `{"textPanel":true,"bodyScrollW":348,"bodyClientW":348,"bodyOverflowX":"hidden","controls":25,"clipped":0,"nested":[]}`. All 25 controls present, no nested horizontal overflow, no clipped control, no horizontal scrollbar at both sizes. Screenshots: screenshots/tfl1196_er02_text_inspector_full.png, screenshots/tfl1196_er02_text_inspector_compact.png (inspected; empty is compact, filled shows the two-row list and taller preview).

## DEF-632: Image-creation dialog still opens with a disproportionately empty body

- Status: CLOSED (qa TFL-1198 retest, 2026-10-08)
- Severity: LOW - cosmetic/whitespace polish: with nothing selected the "Create PDF from images" dialog holds a ~588px blank body between the top controls and the footer. ER18 (audit P3, layout refinement).
- Found by: qa (TFL-1196 ER01..ER24 re-audit, ER18)
- Phase: visual-overhaul correction 3 (TFL-1195), ER18

Files:
- `src/renderer/components/ImageCreationDialog.tsx` - the dialog still opens with a disproportionately empty body when no images are selected.

Steps to reproduce (HEAD `dc68679`, app v1.51.0, dev build):
1. `npm.cmd run build`; launch; on Home click "Create PDF from images".
2. Observe the dialog body with no images selected.

Expected: a deliberate empty/drop state with content-driven size (ER18).

Actual: `dialogH=760`, body `588`px, `listPresent=false`, only help text + the Add/Clipboard row + the JPEG-quality fieldset; a large blank gap precedes the footer.
- Command: `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "A:"` -> 1 passed, log `[tfl1196-ER18] {"help":"Pick one or more JPEG or PNG images...","bodyH":588,"listPresent":false,"dialogH":760}`.
- Screenshot: screenshots/tfl1196_er18_image_dialog_full.png.

History:
- qa (TFL-1196, 2026-10-08): classified STILL-PRESENT at HEAD; no existing spec covers ER18.
- orchestrator (TFL-1197, 2026-10-08): FIX-READY - developer reports content-driven height: base `.modal-dialog` now `height:auto; max-height:min(72vh,760px)`, tall height gated on `[data-create-has-files]`; `PreviewTaskDialog` gained backward-compatible `grow?: boolean` (default preserves StampDialog); `CreateFromImagesDialog` passes `grow={files.length>0}`. Evidence: unit tests passed, verify clean, build success; oracle observed bodyH 588->272, dialogH 760->444, listPresent=false. Awaiting qa retest.
- qa (TFL-1198, 2026-10-08): CLOSED. Retested at current working-tree build (HEAD `dc68679` + TFL-1197 changes, app v1.51.0, dev build). Oracle `e2e/tfl1196_er_uncovered_audit.spec.cjs -g "A:"` -> 1 passed (5.9s). Empty state: `{"bodyH":272,"listPresent":false,"hasFilesAttr":false,"growClass":false,"dialogH":444}` (content-driven, well under the old 760, no large blank body). After selection (2 PNGs via the real file chooser): `{"bodyH":588,"listPresent":true,"hasFilesAttr":true,"growClass":true,"dialogH":760}` - the list appears and the layout grows (R18 after-selection). Screenshots: screenshots/tfl1196_er18_empty.png, screenshots/tfl1196_er18_filled.png (inspected; empty is compact, filled shows the two-row list and taller preview).

## DEF-633: All-pages PNG export shows only a single output name with no page-count or naming-scheme explanation

- Status: CLOSED (qa TFL-1200 retest, 2026-10-08)
- Severity: MEDIUM - an information gap that mis-sets export expectations: with All pages + Images PNG the Deliver inspector shows one "Output name" (e.g. `report.png`) and never explains that a 34-page document yields 34 files or the naming scheme. ER20 (audit P2).
- Found by: qa (TFL-1196 ER01..ER24 re-audit, ER20)
- Phase: visual-overhaul correction 3 (TFL-1195), ER20

Files:
- `src/renderer/components/Inspector.tsx:811-816` - the export config renders `Output name` = `exportDefaultName(sourceName, format)` only; `src/renderer/components/exportConfig.ts:194-197` returns `${base}.png` with no per-page expansion text.

Steps to reproduce (HEAD `dc68679`, app v1.51.0, dev build):
1. `npm.cmd run build`; open `report.pdf`; go to Deliver (Ctrl+4).
2. Select Format "Images - PNG (lossless)" and scope "All pages".

Expected: the surface states the selected count and the filename/folder strategy matching real export semantics (ER20).

Actual: only `Output name = <stem>.png` and `Pages = 1-34`; no "34 files" or naming-scheme statement. No export was performed, so no output-loss is claimed.
- Command: `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "C:"` -> 1 passed, log `[tfl1196-ER20-png] {"format":"png","outputName":"1791406954140-report.png","rangeSummary":"1-34"}`, `[tfl1196-ER20-strings] outputName="1791406954140-report.png" rangeSummary="1-34"` (the numeric prefix is the test harness's temp sample-copy name).
- Screenshot: screenshots/tfl1196_er20_21_deliver_full.png.

History:
- qa (TFL-1196, 2026-10-08): classified STILL-PRESENT at HEAD; no existing spec covers ER20.
- orchestrator (TFL-1199, 2026-10-08): FIX-READY - developer adds `exportImageOutputSummary` (`exportConfig.ts`) reusing the real `defaultExportFilename`, and `Inspector.tsx` shows the selected file count (`[data-export-config-output-value]`, e.g. "34 files") plus the naming example (`[data-export-config-output-scheme]`, e.g. "report-page-1.png … report-page-34.png") for image formats; office keeps the single name. Evidence: verify EXIT 0, build EXIT 0, targeted vitest green. Awaiting qa retest.
- qa (TFL-1200, 2026-10-08): CLOSED - retest PASS. `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "C:"` -> 1 passed. With report.pdf (34 pages) + Images PNG + All pages the Deliver surface reads `outputName="34 files"` and `output-scheme="<stem>-page-1.png … <stem>-page-34.png"` from the real `defaultExportFilename`; `rangeSummary="1-34"`. ER20/ER21 sub-cases converted from logging to assertions. Blast radius: `e2e/tfl1116_r21_r26_export_cta.spec.cjs` PASS (invalid range still disables the CTA). Evidence: build EXIT 0; screenshots/tfl1196_er20_21_deliver_full.png; log test-fixtures/tfl1200/e2e_er20_21.log.

## DEF-634: Output checks still read "Not analysed" without a reason or a discoverable next step

- Status: CLOSED (qa TFL-1200 retest, 2026-10-08)
- Severity: LOW - an information gap: Protection and Export fidelity read "Not analysed" and the single added legend "Observations, not blockers." does not explain why the information is unavailable nor offer an analysis path. ER21 (audit P3).
- Found by: qa (TFL-1196 ER01..ER24 re-audit, ER21)
- Phase: visual-overhaul correction 3 (TFL-1195), ER21

Files:
- `src/renderer/components/ContextPanel.tsx:1449-1495` - the legend renders, but `protectionText`/`fidelityText` still fall back to the literal `'Not analysed'` (`:1408`, `:1412`) with no per-row help or link to analysis.

Steps to reproduce (HEAD `dc68679`, app v1.51.0, dev build):
1. `npm.cmd run build`; open `report.pdf`; go to Deliver (Ctrl+4); read the "Output checks" section.

Expected: real analysis or an explanation of why the value is unavailable (ER21).

Actual: `legend="Observations, not blockers."`, `Protection="Not analysed"`, `Export fidelity="Not analysed"`, `OCR="Not run"` - no reason and no next step beyond the separate "Optimize" action.
- Command: `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "C:"` -> 1 passed, log `[tfl1196-ER21-strings] legend="Observations, not blockers." protection="Not analysed" fidelity="Not analysed" ocr="Not run"`.
- Screenshot: screenshots/tfl1196_er20_21_deliver_full.png.

History:
- qa (TFL-1196, 2026-10-08): classified STILL-PRESENT at HEAD (partially mitigated by the legend); no existing spec covers ER21.
- orchestrator (TFL-1199, 2026-10-08): FIX-READY - developer replaces the bare literal with Protection "Not read" + reason (`[data-deliver-protection-reason]`) and Export fidelity "Not applicable" + reason (`[data-deliver-fidelity-reason]`); row hooks and legend kept; no invented analysis feature. Evidence: verify EXIT 0, build EXIT 0, focused vitest green. Awaiting qa retest.
- qa (TFL-1200, 2026-10-08): CLOSED - retest PASS. `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "C:"` -> 1 passed. Surface now reads `Protection="Not read"` + reason "The encryption dictionary has not been read for this document." and `Export fidelity="Not applicable"` + reason "Only office exports (Word, Excel, PowerPoint) carry conversion-limit notes."; the legend "Observations, not blockers." is kept and no "Not analysed" literal remains anywhere in the panel. Truthfulness: `protectionByTab` (App.tsx:2301-2304) is set only when `engine.getDocumentProtection` returns ok+non-null (encrypted), so the null input the Deliver panel receives honestly means "not read", never a fabricated "unencrypted"; for the unencrypted sample the engine returns null, so no false claim. Evidence: build EXIT 0; screenshots/tfl1196_er20_21_deliver_full.png; log test-fixtures/tfl1200/e2e_er20_21.log.

## DEF-635: Stamp dialog still states two incompatible placement workflows

- Status: CLOSED (qa TFL-1200 retest, 2026-10-08)
- Severity: MEDIUM - the dialog's introduction and its page-selector helper contradict each other, so the user cannot tell whether the stamp lands at the next click or is centred on a picked page. ER24 (audit P2, confirmed copy defect).
- Found by: qa (TFL-1196 ER01..ER24 re-audit, ER24)
- Phase: visual-overhaul correction 3 (TFL-1195), ER24

Files:
- `src/renderer/components/StampDialog.tsx:147-151` - help: "After confirming, the next click on a page drops the stamp at that location."
- `src/renderer/components/StampDialog.tsx:204-208` - hint: "The stamp is centered on the picked page at a default size (60 pt tall...)."

Steps to reproduce (HEAD `dc68679`, app v1.51.0, dev build):
1. `npm.cmd run build`; open `report.pdf`; go to Review (Ctrl+3); open the "Stamp" dock verb.
2. Read the introduction paragraph and the "Place on page" helper text.

Expected: instructions and primary label match the actual implementation; if both modes exist, placement mode is explicit (ER24).

Actual: both contradictory strings render together; primary label is "Place on page" with a page selector.
- Command: `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "B:"` -> 1 passed, log `[tfl1196-ER24] {"help":"Pick a built-in stamp. After confirming, the next click on a page drops the stamp at that location. ...","hints":["The stamp is centered on the picked page at a default size (60 pt tall, width derived from the stamp's aspect ratio)."],"confirmLabel":"Place on page","pageSelectPresent":true}`.
- Screenshot: screenshots/tfl1196_er24_stamp_dialog_full.png.

History:
- qa (TFL-1196, 2026-10-08): classified STILL-PRESENT at HEAD; no existing spec covers ER24.
- orchestrator (TFL-1199, 2026-10-08): FIX-READY - developer removes the ignored page picker (`[data-stamp-page-select]`) and the false "centered on the picked page / 60 pt" hint, renames the primary action to "Start placement" (keeps `[data-stamp-confirm]`), and states click-to-place + Escape; `App.tsx` placement handler unchanged. Evidence: verify EXIT 0, build EXIT 0, stampDialog unit green. Awaiting qa retest.
- qa (TFL-1200, 2026-10-08): CLOSED - retest PASS. `npm.cmd run test:e2e -- e2e/tfl1196_er_uncovered_audit.spec.cjs -g "B:"` -> 1 passed: `pageSelectPresent=false`, `confirmLabel="Start placement"`, dialog text contains no "centered on the picked page", no "60 pt", no "Place on page"; the intro states click-to-place + "Press Escape to cancel." Blast radius "F:": `-g "F:"` -> 1 passed - Start placement arms, a page click places exactly one stamp (`[data-stamp-annotation]`=1, canUndo=true), Ctrl+Z Undo removes it (0 remaining) on the disposable sample copy. Unit: stampDialog + phase112_deliver -> 27 passed. Evidence: build EXIT 0; screenshots/tfl1196_er24_stamp_dialog_full.png, tfl1196_stamp_placed.png, tfl1196_stamp_undone.png; logs test-fixtures/tfl1200/e2e_er20_21.log.

## DEF-628: View > Toggle Theme persists the live theme without updating `themeDefault`, so Preferences and the effective shell disagree

- Status: CLOSED (qa TFL-1190, 2026-10-08)
- Severity: MEDIUM - the persisted and effective theme are not coherent: after the Toggle Theme command the shell shows the toggled theme while Preferences "Theme default" still reads the old value, so the two states conflict (the AR-08 failure mode). Relaunch follows `settings.theme`, so the disagreement is user-visible without a relaunch.
- Found by: adversary (ADV-243)
- Phase: visual-overhaul correction 2 (TFL-1146), AR-08

Files:
- `src/renderer/App.tsx:1790-1798` - `onToggleTheme` writes `{ ...prev, theme: nextTheme(prev.theme) }` and never sets `themeDefault`; the Preferences dropdown reads `settings.themeDefault ?? settings.theme` (`App.tsx:13130`).

Steps to reproduce:
1. `npm.cmd run build`; open the app, use View > Toggle Theme once.
2. Inspect the persisted `settings.json` `theme` and `themeDefault`.
3. Open Preferences and read the "Theme default" value, then compare with the shell's effective theme.

Expected: the persisted default and the effective theme agree (no two conflicting states), per AR-08.

Actual: e.g. persisted `theme=light, themeDefault=dark`; Preferences shows Dark over a light shell.

Screenshot: screenshots/adv-243-theme-residue.png

History:
- CTO (TFL-1146, 2026-10-07): filed from adversary diff-pass ADV-243; triage ACCEPTED. Routed to frontend-dev.
- qa (TFL-1190, 2026-10-08): FIX-READY retest PASS, CLOSED. Live View > Toggle Theme x3 through the app menu: persisted `theme === themeDefault === <html data-theme>` at each step (frosted/dark/light); Preferences "Theme default" read `light` over the settled light shell (no Dark-over-light); a Preferences dropdown pick to `dark` applied immediately and persisted `theme=themeDefault=dark` (dropdown path no regression). Command: `npx playwright test e2e/tfl1190_def628_629_630_retest.spec.cjs` -> 4 passed (23.1s); unit `npx vitest run` on the 4 named specs -> 4 files / 61 tests passed. Screenshot: screenshots/tfl1190_def628_prefs.png.

## DEF-629: Extract accepts malformed range tokens with trailing garbage and acts on the leading number

- Status: CLOSED (qa TFL-1190, 2026-10-08)
- Severity: MEDIUM - a syntax-error entry is silently treated as valid and Extract is enabled, bypassing the "whole input must be valid" gate (AR-07): `1abc` -> page 1, `2-3x` -> pages 2-3, `1.9`/`12px` -> page 1.
- Found by: adversary (ADV-244)
- Phase: visual-overhaul correction 2 (TFL-1146), AR-07

Files:
- `src/renderer/engine/types.ts:966-967,982` - `classifyPageRange` parses span endpoints and single tokens with `Number.parseInt`, which drops a non-numeric suffix.

Steps to reproduce:
1. `npm.cmd run build`; open `report.pdf`; go to Extract (Ctrl+E).
2. Type `1abc` (then `2-3x`, `1.9`, `12px`) into the range field.
3. Read the status text and the confirm button state.

Expected: a token with trailing garbage is a syntax error (`malformed`), `pages` null, Extract disabled.

Actual: each classifies as `valid` and Extract is enabled, acting on the leading number.

Screenshot: screenshots/adv-244-range-trailing-garbage.png

History:
- CTO (TFL-1146, 2026-10-07): filed from adversary diff-pass ADV-244; triage ACCEPTED. Routed to frontend-dev.
- qa (TFL-1190, 2026-10-08): FIX-READY retest PASS, CLOSED. Live Extract dialog on bundled report.pdf (34 pages): `1abc`, `2-3x`, `1.9`, `12px` each classified `malformed`, pages null (message "Enter pages like 1-3 or 2,4.", input preserved, Extract disabled); valid inputs `1,3,5-7` -> 5 selected, `007` -> 1 selected, ` 10 - 12 ` -> 3 selected all `valid` with Extract enabled; `empty` wording byte-for-byte unchanged. Command: `npx playwright test e2e/tfl1190_def628_629_630_retest.spec.cjs` -> 4 passed (23.1s); unit 4 files / 61 tests passed. Screenshot: screenshots/tfl1190_def629_malformed.png.

## DEF-630: Out-of-bounds span names only its upper endpoint, never the lower one

- Status: CLOSED (qa TFL-1190, 2026-10-08)
- Severity: LOW - AR-07's `invalidTokens` message is imprecise for a wholly-above-range span: `50-60` -> "Page 60 is outside the document's 1-34 pages." with `50` unnamed; `35-40` -> "Page 40 ...". The gate itself is correct (Extract disabled, pages null).
- Found by: adversary (ADV-245)
- Phase: visual-overhaul correction 2 (TFL-1146), AR-07

Files:
- `src/renderer/engine/types.ts:971-976` - the span branch adds `lo` only when `lo < 1`, never when `lo > totalPages`, so only `hi` is reported.

Steps to reproduce:
1. `npm.cmd run build`; open `report.pdf`; go to Extract (Ctrl+E).
2. Type `50-60`, then `35-40`.

Expected: every offending endpoint is named (both ends of a wholly out-of-bounds span).

Actual: only the upper endpoint is named.

Screenshot: screenshots/adv-245-range-span-endpoint.png

History:
- CTO (TFL-1146, 2026-10-07): filed from adversary diff-pass ADV-245; triage ACCEPTED. Routed to frontend-dev (folded with DEF-629).
- qa (TFL-1190, 2026-10-08): FIX-READY retest PASS, CLOSED. Live Extract dialog: `50-60` -> "Pages 50, 60 are outside the document's 1-34 pages." and `35-40` -> "Pages 35, 40 are outside the document's 1-34 pages." (both ends named); `1-999` -> "Page 999 is outside the document's 1-34 pages." (in-bounds end unnamed). Blast radius: the nearest sibling call site (Delete pages dialog) still gates `50-60`/`1-999` disabled and `2-5` enabled; the 8 call sites share classifyPageRange (pages null on out-of-bounds). Command: `npx playwright test e2e/tfl1190_def628_629_630_retest.spec.cjs` -> 4 passed (23.1s); unit 4 files / 61 tests passed. Screenshots: screenshots/tfl1190_def630_span.png, screenshots/tfl1190_blast_delete.png.

## DEF-618: R03 collision-aware app menu is not content-bounded - stretched full-bleed to the viewport right edge (0px gutter)

- Status: CLOSED (qa TFL-1123, 2026-10-07)
- Severity: MEDIUM - the R03 overflow symptom (horizontal scrollbar / content outside the window) is gone, but the overlay still fails the R03 correction ("8px viewport gutter" both sides; "content-bounded", "bounded column"): it loses its bounded-popover shape, opens far from its trigger, and its width scales with the window. No document/data impact.
- Found by: qa (TFL-1122 focused verification, TFL-1116 C3)
- Phase: visual-overhaul correction (TFL-1116), R03

Files:
- `src/renderer/styles.css:19137` - `.app-menu-popover { position: absolute; top: calc(100% + 4px); right: 0; ... }` (pre-existing rule).
- `src/renderer/components/CommandMenu.tsx:753-763` - the `collisionAware` inline style sets `position: fixed; left; top; maxHeight; maxWidth; overflowX; overflowY` but never clears `right`, so portaling to `document.body` makes `right: 0` viewport-relative and stretches the fixed surface between `left` and the window's right edge.
- `src/renderer/components/overlayPlacement.ts` - `placeOverlay` measures that stretched width and clamps `left` accordingly.

Steps to reproduce:
1. `npm.cmd run build`; launch the app on Home (no document open).
2. Size the window to 960x640 (unmaximize first), click the application menu (`[data-app-menu]`).
3. Read `[data-app-menu-popover]`: `getBoundingClientRect()` and `getComputedStyle(...).right`.

Expected: a content-bounded popover placed near its trigger, keeping the 8px viewport gutter on both sides (per R03's correction).

Actual: the surface is stretched from a clamped `left` to the viewport's right edge - `right` = `window.innerWidth` exactly, `computedStyle.right` = `0px`, right gutter = 0px. Width scales with the window instead of the content: 874.8 (960) / 899.9 (1024) / 965.6 (1280) / 1208.8 (maximized), while the trigger sits at x 646.7-674.7 (960) - the menu opens ~560px left of its trigger. No submenu rows exist in the app menu.

Command output (`npm.cmd run test:e2e -- e2e/tfl1116_r03_app_menu_fit.spec.cjs`):
```
[tfl1122] size=960 {"innerWidth":960,...,"left":85.203125,"right":960,...,"width":874.796875,"rightGutter":0,"cssRight":"0px","triggerLeft":646.65625,"triggerRight":674.65625,...}
1) TFL-1122 R03: application menu stays inside the viewport at every size
   Error: 960: 8px right viewport gutter
   Expected: >= 7
   Received:    0
1 failed
```
The brief's width proxy (`width <= innerWidth - 16`) passes only incidentally because the clamped `left` exceeds 16; asserting the named right gutter directly fails at every size.

Screenshots: screenshots/tfl1116_r03_menu_960.png, `_1024.png`, `_1280.png`, `_max.png` (menu shown as a near-full-width slab).

History:
- qa (TFL-1122, 2026-10-07): opened - independent e2e on the real Electron app at 960x640, 1024x768, 1280x800 and maximized.
- CTO (TFL-1121 reopened, 2026-10-07): FIX-READY - relaying frontend-dev: `CommandMenu.tsx` collisionAware root inline style always sets `right: auto` + `width: max-content` and applies `position/left/top/maxHeight/maxWidth` after measurement; `useOverlayPlacement.ts` measures with `offsetWidth`/`offsetHeight` (layout box, transform-independent) instead of `getBoundingClientRect`; `styles.css` adds `.app-menu-popover.command-menu { right: auto; }` for the first render. DOM contract unchanged.
- qa (TFL-1123, 2026-10-07): FIX-READY re-verification PASS -> CLOSED. Focused unit suite: `Test Files 3 passed (3)`, `Tests 42 passed (42)`, EXIT=0. `npm run verify`: conventions clean (389 source files scanned) + typecheck EXIT=0. `electron.launch` initially failed with `bad option: --remote-debugging-port=0` because the harness exported `ELECTRON_RUN_AS_NODE=1`; after `unset ELECTRON_RUN_AS_NODE` the built app ran: `1 passed` and the DEF-618 probe's right gutter is now non-zero at every size (960: 8.484, 1024: 8.484, 1280: 8.484, max: 8.484), popover width constant 333.5 (content-bounded, previously 874.8/899.9/965.6/1208.8), `position: fixed`, `cssRight: 8.484px`, `overflowX: hidden`, `submenuCount: 0`. Blast-radius neighbours (`titleBarFileMenu.test.tsx`, `pageThumbMenu.test.tsx`): `Test Files 2 passed (2)`, `Tests 12 passed (12)`. Screenshots `screenshots/tfl1116_r03_menu_{960,1024,1280,max}.png` inspected: content-bounded popover near its trigger, ~8px right gutter, fully inside the window.

## DEF-597: Repo-wide typecheck is red - preferencesReducer lacks an ending return (src/renderer/state/preferences.ts)

- Status: CLOSED (qa TFL-961, 2026-10-06)
- Severity: HIGH - build blocker: `npm run typecheck` exits 1, which fails the Phase gate (`npm run verify`) and blocks any phase-close commit until fixed.
- Found by: qa (TFL-959 focused verification, Phase 112 chunk C1)
- Phase: 112 (found while verifying TFL-854 C1; `preferences.ts` is outside the Panels deliverable set - an unowned working-tree edit)
- Files: `src/renderer/state/preferences.ts` (working-tree edit; 947-line diff reported for a 444-line file - suspected CRLF/LF churn plus a real change)

Steps to reproduce:
1. `npm.cmd run typecheck`.

Expected: clean (exit 0).

Actual: exit 1 -
`src/renderer/state/preferences.ts(143,4): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.`
`preferencesReducer(state: AppSettings, action: PreferencesAction): AppSettings` (`:140-143`) switches on `action.type` but no longer returns on every path - a `PreferencesAction` variant is unhandled and there is no exhaustive `default`/`assertNever`.

Command output:
`src/renderer/state/preferences.ts(143,4): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.`

History:
- CTO: filed from the TFL-959 qa report (2026-10-06) - qa did not file it because its brief forbade ledger edits. Routed to frontend-dev as a fix chunk child of TFL-854.
- CTO: FIX-READY - relaying frontend-dev TFL-960 (2026-10-06): normalized `src/renderer/state/preferences.ts` line endings CRLF -> LF to match HEAD, removing ~947 lines of EOL churn; the diff is now 9 insertions (the already-present TFL-938 Home-motion-pause union member + its reducer case), the switch is exhaustive so the reducer returns `AppSettings` on every path, and no command/handler/selector/persistence/settings-key behaviour changed. Evidence: `typecheck` clean (exit 0); `preferences` specs 3 files / 80 tests pass; `npm run verify` clean (381 source files scanned); `git diff --stat` 1 file changed, 9 insertions. doc-maintenance: no changes required.

## DEF-566: annotation-flyout tool icons rest green, not graphite - Phase 103 criterion 3 ("resting icons graphite app-wide; green only for real success") is not met

- Status: CLOSED (qa TFL-843, 2026-10-05)
- Severity: LOW - cosmetic colour on one secondary surface (the Review annotation flyout); no functional, document or data impact. Recorded as a stated-criterion miss that blocks Phase 103 criterion 3, not a workflow break.
- Found by: qa (TFL-840, phase-close verdict)
- Phase: 103 (TFL-824)
- Files: `src/renderer/styles.css:12319-12340` (`.ann-tool-btn[data-tool=...]` colour hooks; unchanged by the Phase 103 diff, so the migration repointed the glyphs but left the per-tool ink)

Steps to reproduce:
1. `npm.cmd run test:e2e -- phase103_ann_colour_probe.spec.cjs`; or launch TFlex, open `report.pdf`, switch to Review, click the `Annotate` dock verb.
2. Read the computed colour of `.ann-tool-btn[data-tool="rect"] svg` and `.ann-tool-btn[data-tool="highlight"] svg`.

Expected: resting annotation-tool glyphs are graphite (`--tf-icon-rest`, `#485164` light / `#B8C0D0` dark), matching the migrated dock / rail / header / title-bar glyphs; green reserved for a real success outcome (criterion 3).

## DEF-648: Missing Sample PDF files prevent e2e tests from running.

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) - false premise, NOT a product
defect.** `assets/samples/` ships report.pdf / form.pdf / long.pdf / scanned.pdf; the spec
referenced empty.pdf / sample-bates.pdf / sample-watermark.pdf / sample-signature.pdf,
which never existed. Spec now uses the real bundled fixtures via `openSamplePath`.

- Status: OPEN
- Severity: HIGH - Blocks all e2e tests that rely on sample PDF files, severely impacting QA verification.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`
- `e2e/lib/helpers.cjs`
- `e2e/lib/launch.cjs`

Steps to reproduce:
1.  Run any e2e test that uses `openSample()` or `openSamplePath()`.

Expected: The sample PDF file (e.g., `empty.pdf`, `report.pdf`, `sample-bates.pdf`) should be found and loaded.

Actual: `Error: Sample not found: C:\Users\tanzi\OneDrive\App Development\TFlex\assets\samples\empty.pdf` (or similar for other sample files). The `C:\Users\tanzi\OneDrive\App Development\TFlex\assets\samples` directory is empty.

Evidence:
```
Error: Sample not found: C:\Users\tanzi\OneDrive\App Development\TFlex\assets\samples\empty.pdf
   at lib\launch.cjs:99
   97 |   const sourcePath = path.join(projectRoot, 'assets', 'samples', sampleName);
   98 |   if (!fs.existsSync(sourcePath)) {
>  99 |     throw new Error(`Sample not found: ${sourcePath}`);
      |           ^
  100 | |   }
  101 |   const tempDir = path.join(os.tmpdir(), 'tflex-e2e-samples');
  102 |   if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    at getSamplePath (C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\lib\launch.cjs:99:11)
    at openSample (C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\lib\helpers.cjs:135:22)
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:121:9
```
Error Context: `test-results\phase116_thread_stream-P11-ac7c4--and-empty-filtered-results\error-context.md`

## DEF-649: Filter bar buttons are not visible or clickable in Thread Stream

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — test-oracle error, NOT a product
defect.** `data-ann-filter` carries the raw kind (`all`, `ink`, `rect`, ...), not
`kind-Ink`; the bar renders one button per kind that has rows. Spec repointed; P116-2 PASS.

- Status: OPEN
- Severity: MEDIUM - The filter bar buttons are essential for filtering annotations, and their non-interactivity degrades the user experience.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`

Steps to reproduce:
1. Launch the Electron application.
2. Open `report.pdf`.
3. Create annotations of different types.
4. Navigate to the REVIEW stage.
5. Observe the filter bar buttons (`[data-ann-filter="kind-Ink"]`, etc.).

Expected: The filter bar buttons should be visible and clickable.

Actual: The filter bar buttons are not visible or clickable, leading to `TimeoutError` when trying to click them.

Evidence:
```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-ann-filter="kind-Ink"]')


   98 |
   99 |   // Filter by 'Ink'
> 100 |   await win.locator('[data-ann-filter="kind-Ink"]').click();
      |                                                 ^
  101 |   rows = await win.locator('[data-annotation-row]');
  102 |   await expect(rows).toHaveCount(1);
  103 |   await expect(rows.first().locator('[data-ann-kind]')).toHaveText('Ink');
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:100:53
```
Error Context: `test-results\phase116_thread_stream-P11-657ea-rs-and-restores-annotations\error-context.md`

## DEF-650: Inspector review actions panel is not visible

**Reconfirmed OPEN (2026-10-08, TFL-1339 final QA run) — GENUINE product gap.** With a
selected annotation (both a text box and an ink shape), the RIGHT inspector's
"Review elements" section always renders the empty hint ("No annotation selected"):
`[data-inspector-review-actions]` and `[data-ann-prop="color"]` never mount. Root cause:
`DocumentView` publishes the annotation-selection snapshot with `mode` from
`textPanelMode = tfTextPanelOpen ? "text" : "annotation"` (DocumentView.tsx:1633), so a
selected annotation that opens the text panel (mode "text") — or a shape annotation
where the panel snapshot is null — never satisfies `selectedReviewAnnotation`'s
`textPanel.mode === 'annotation'` gate (Inspector.tsx:341). Contradicts success
criterion 4 / chunk E ("canvas selection updates the row AND the inspector via the
stable annotation id"). Evidence: run 3 P116-4 soft-fail; ARIA snapshot in
`test-results/phase116_thread_stream-P11-ed764-ions-and-the-colour-control/error-context.md`;
screenshots/phase116-inspector-color.png.

- Status: OPEN
- Severity: MEDIUM - The inspector panel is crucial for managing annotations, and its absence prevents users from interacting with annotation properties.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`

Steps to reproduce:
1. Launch the Electron application.
2. Open `report.pdf`.
3. Create an annotation.
4. Navigate to the REVIEW stage and select the annotation row.

Expected: The inspector review actions panel (`[data-inspector-review-actions]`) should be visible.

Actual: The inspector review actions panel is not visible.

Evidence:
```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-inspector-review-actions]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('[data-inspector-review-actions]') with timeout 5000ms
  - waiting for locator('[data-inspector-review-actions]')


  157 |   await row.click(); // Select the annotation
  158 |
> 159 |   await expect(win.locator('[data-inspector-review-actions]')).toBeVisible();
      |                                                                 ^
  160 |   await expect(win.locator('[data-ann-prop="color"]')).toBeVisible();
  161 |   await expect(win.locator('[data-ann-color-box]')).toBeVisible();
  162 |
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:159:64
```
Error Context: `test-results\phase116_thread_stream-P11-bf8de-selection-and-color-changes\error-context.md`

## DEF-651: Comment input field is not visible in Thread Stream

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — test-path error, NOT a product
defect.** `[data-comment-input]` / `[data-comment-submit]` / `[data-comment-entry]` exist
on the selected annotation's comment box; the earlier spec never selected an annotation.
P116-5 PASS.

- Status: OPEN
- Severity: MEDIUM - Users cannot add comments to annotations, which is a core functionality.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`

Steps to reproduce:
1. Launch the Electron application.
2. Open `report.pdf`.
3. Create an annotation.
4. Navigate to the REVIEW stage and select the annotation row.
5. Observe the comment input field (`[data-comment-input]`).

Expected: The comment input field should be visible and interactive.

Actual: The comment input field is not visible, leading to a `TimeoutError` when trying to fill it.

Evidence:
```
TimeoutError: locator.fill: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-comment-input]')


  186 |
  187 |   // Add a comment via floating box
> 188 |   await win.locator('[data-comment-input]').fill('This is a test comment.');
      |                                           ^
  189 |   await win.locator('[data-comment-submit]').click();
  190 |   await win.waitForTimeout(500);
  191 |
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:188:45
```
Error Context: `test-results\phase116_thread_stream-P11-39608--and-list-level-FDF-actions\error-context.md`

## DEF-652: Delete button for annotation row is not clickable

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — test-oracle error, NOT a product
defect.** The Thread Stream delete control is an IconButton addressed by
`[aria-label^="Delete"]`, not `[data-ann-io="delete"]` (that hook is export/import only).
Spec repointed; P116-6 PASS.

- Status: OPEN
- Severity: MEDIUM - Users cannot delete annotations, impacting their ability to manage documents.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`

Steps to reproduce:
1. Launch the Electron application.
2. Open `report.pdf`.
3. Create an annotation.
4. Navigate to the REVIEW stage.
5. Observe the delete button (`[data-ann-io="delete"]`) within the annotation row.

Expected: The delete button should be visible and clickable.

Actual: The delete button is not clickable, leading to a `TimeoutError`.

Evidence:
```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-annotation-row]').first().locator('[data-ann-io="delete"]')


  219 |
  220 |   // Delete the first row (Ink)
> 221 |   await rows.first().locator('[data-ann-io="delete"]').click();
      |                                                        ^
  222 |   await win.waitForTimeout(500);
  223 |
  224 |   rows = await win.locator('[data-annotation-row]');
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:221:56
```
Error Context: `test-results\phase116_thread_stream-P11-92bdc-fects-only-the-intended-row\error-context.md`

## DEF-653: Theme toggle button is not visible or clickable

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — test-oracle error, NOT a product
defect.** `[data-theme-toggle]` / `[data-theme-option]` were retired in TFL-1116; the live
control is the app menu's `[data-menu-action="toggleTheme"]`. `setTheme` in
`e2e/lib/helpers.cjs` repointed to cycle the real command; P116-screenshots PASS.

- Status: OPEN
- Severity: LOW - Prevents capturing screenshots for different themes, but does not impact core functionality.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/phase116_thread_stream.spec.cjs`
- `e2e/lib/helpers.cjs`

Steps to reproduce:
1. Launch the Electron application.
2. Observe the theme toggle button (`[data-theme-toggle]`).

Expected: The theme toggle button should be visible and clickable.

Actual: The theme toggle button is not visible or clickable, leading to a `TimeoutError`.

Evidence:
```
TimeoutError: page.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-theme-toggle]')


   at lib\helpers.cjs:732

  730 |
  731 | async function setTheme(window, theme) {
> 732 |   await window.click('[data-theme-toggle]');
      |                ^
  733 |   await window.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  734 |   await window.click(`[data-theme-option="${theme}"]`);
  735 |   await window.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
    at setTheme (C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\lib\helpers.cjs:732:16)
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase116_thread_stream.spec.cjs:313:9
```
Error Context: `test-results\phase116_thread_stream-P11-24973-different-themes-and-widths\error-context.md`

## DEF-654: `.workspace` selector not visible after opening sample PDF in e2e tests

**Status: CLOSED (2026-10-08, TFL-1339 final QA run) — harness selector error, NOT a
product defect.** Multi-tab documents keep one `.workspace` / `.pdf-page canvas` per tab
(inactive hidden), so a bare `.first()` tripped strict-mode / resolved to a hidden node.
`openSamplePath` in `e2e/lib/helpers.cjs` now waits on `.workspace:visible` and
`.pdf-page canvas:visible`.

- Status: OPEN
- Severity: HIGH - Blocks an entire suite of e2e tests, severely impacting QA verification.
- Found by: qa (TFL-1339 e2e verification, 2026-10-08)
- Phase: 116

Files:
- `e2e/lib/helpers.cjs`
- `e2e/phase51_gate.spec.cjs`

Steps to reproduce:
1. Run any test in `e2e/phase51_gate.spec.cjs`.

Expected: The application should load the sample PDF and the `.workspace` selector should become visible.

Actual: The `.workspace` selector is not visible, leading to `TimeoutError`.

Evidence:
```
TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.workspace') to be visible


   at lib\helpers.cjs:146

  144 |   }, absolutePath);
  145 |   await window.locator('[data-home-tool="open"]').first().click();
> 146 |   await window.waitForSelector('.workspace', { timeout: 30000 });
      |                ^
  147 | }
  148 |
  149 | async function diag(window) {
    at openSamplePath (C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\lib\helpers.cjs:146:16)
    at C:\Users\tanzi\OneDrive\App Development\TFlex\e2e\phase51_gate.spec.cjs:74:3
```
Error Context: `test-results\phase51_gate-P51-C-item-3--2dba3-do-row-normal-narrow-multi-\error-context.md`
## DEF-658: Empty-document Thread Stream state has no action to open the annotation tools

- Status: OPEN
- Severity: MEDIUM - Success criterion 3 / CONTROL-INDEX require the empty-document
  explanation to carry a working action that opens the existing annotation tools
  (`data-ann-empty-action`); the control is never rendered, so the empty state offers no
  route into Annotate. Adds friction to the primary first-use flow.
- Found by: qa (TFL-1339 final QA run, 2026-10-08)
- Phase: 116

Reproduction:
1. Launch TFlex (dev build) and open a PDF with no annotations (e.g. assets/samples/report.pdf).
2. Go to the REVIEW stage and expand the Context panel.
3. Observe the Annotations section body.

Expected: the empty-document state renders the "No annotations" explanation AND a
button carrying `data-ann-empty-action` that opens the annotation tools
(`onOpenTools`).

Actual: only the two explanation paragraphs render; `[data-ann-empty-action]` does not
exist. The host never supplies `onOpenTools` to the REVIEW `AnnotationsPanel`:
`AnnotationEmptyState` (src/renderer/annotations/ThreadStream.tsx:164) renders the
button only when `onOpenTools` is defined, and neither the App's `ContextPanel` nor its
`DocumentView` passes `onOpenTools` (the only `onOpenTools` wires in App.tsx:12592 /
12729 are for the ActionDock). The Inspector's selection scope is unaffected.

Evidence (run 3, e2e/phase116_thread_stream.spec.cjs:164, P116-3):
```
Error: empty-document action [data-ann-empty-action]
expect(locator).toBeVisible() failed
Locator: locator('[data-ann-empty-action]')
Error: element(s) not found
```
ARIA snapshot: `test-results/phase116_thread_stream-P11-dab3a-iltered-result-are-distinct/error-context.md`
Screenshot: `screenshots/phase116-empty-doc.png`

Files:
- `e2e/phase116_thread_stream.spec.cjs`

## DEF-659: Phase 117 moved Delete behind More but the existing Phase 37 text-box test still asserts the old primary order, so Phase 37 is red

- Status: FIX-READY
- Severity: MEDIUM - The Phase 117 CONTROL-INDEX row "text box / image / text run selection" names the existing Phase 10 / 21 / 37 suites as proof, and Phase 37 (`phase37EditText.test.tsx`) is now failing, so the row is not proven green. No user-facing break was observed in the app (the e2e confirms the new Confirm / Cancel primary + Delete-behind-More behaviour is correct); the failure is a stale assertion the Phase 117 delivery did not update.
- Found by: qa (TFL-1337, Phase 117 focused verification, 2026-10-08). CTO triage 2026-10-08: status FIX-READY; assigned TFL-1349 (frontend-dev).
- Phase: 117
- Source: TFL-1337 chunk G blast-radius run

Files:
- `test/unit/renderer/phase37EditText.test.tsx:289` (asserts `["Confirm", "Delete", "Cancel"]`)
- `src/renderer/components/selectableContent.tsx` (`ContentActionBar` primary row = Confirm / Cancel; Delete inside the separated More menu, Phase 117 ruling 6)

Steps to reproduce:
1. `npm.cmd run test:unit -- test/unit/renderer/defDEF153_154_committedAnnotations.test.tsx test/unit/renderer/bugB10_stampAnnotationSurface.test.tsx test/unit/renderer/def190_stampTypeEditorStacking.test.tsx test/unit/renderer/def366_367_bottomEdgeControls.test.tsx test/unit/renderer/phase48_annotationControlBars.test.tsx test/unit/renderer/phase113_dialogsNotices.test.tsx test/unit/renderer/phase37EditText.test.tsx test/unit/renderer/tfl776_deleted_run_ghost.test.tsx test/unit/renderer/phase28_annotationLiveEdits.test.tsx test/unit/renderer/tfl525_adversary_diffpass.test.tsx test/unit/renderer/bugB5_textBoxMove.test.tsx test/unit/renderer/def332_editBoxMove.test.ts test/unit/renderer/def258_editTextRunStyle.test.ts test/unit/renderer/cropPagesDialog.test.tsx test/unit/renderer/bugB16_cropPreview.test.tsx test/unit/renderer/formsOverlayFillPath.test.tsx test/unit/renderer/phase59FormWidgets.test.tsx test/unit/renderer/pageDrag.test.ts test/unit/renderer/pageDragApply.test.ts test/unit/renderer/pageDragCrossDoc.test.tsx test/unit/renderer/interactionSurfaces.test.tsx`
2. Expected: all named neighbour suites pass (Phase 37 included).
3. Actual: `Test Files 1 failed | 20 passed (21)` / `Tests 1 failed | 213 passed (214)`.

Evidence:
```
FAIL  test/unit/renderer/phase37EditText.test.tsx > Phase 37 item 11 - the box bar is Confirm / Delete / Cancel and Cancel reverts > renders the three verbs in order (no Edit)
AssertionError: expected [ 'Confirm', 'Cancel', 'More' ] to deeply equal [ 'Confirm', 'Delete', 'Cancel' ]
 ```

Note: the E2E `e2e/phase117_selection.spec.cjs` "text box" step confirms the product renders `["Confirm","Cancel","More"]` in the primary row with `data-edit-box-action="delete"` only inside the More menu, i.e. the product matches Phase 117 ruling 6 and the unit test is stale. QA does not edit `test/unit/**`; the owning developer must update the Phase 37 assertion.
