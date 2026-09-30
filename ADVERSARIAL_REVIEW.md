# Adversarial Review

> Read discipline: this is a historical evidence ledger. Search for the assigned `ADV-NNN`
> or unresolved `Disposition: PENDING` entries; do not load prior campaigns wholesale.

## Phase 2 gate — page organization

Session label: `phase-2 gate`. Ran against the production build
(`npm.cmd run build`; dist main + dist renderer launched with
`ELECTRON_RENDERER_URL=file://.../dist/renderer/index.html`). Harnesses live in
`test-fixtures/tools/` (`phase2_adversarial.cjs`, `repeat_race.cjs`,
`verify_undo_button.cjs`, `isolate_merge.cjs`, `pinpoint_merge.cjs`,
`verify_dialog_patch.cjs`, `instrument_pick.cjs`, `race_screenshot.cjs`).

## ADV-008: Concurrent delete during an in-flight save is silently lost; modified dot clears and undo is destroyed

- Session: phase-2 gate
- Suggested severity: HIGH

What I did:
1. Built the production bundle with `npm.cmd run build` and launched the app with
   Playwright's Electron driver (`--disable-gpu --no-sandbox` for this
   environment's GPU flakiness).
2. Via the renderer's exposed engine API (`window.tflex.engine`):
   - `loadDocument(docId, report.pdf-copy)`; `merge(docId, [sameCopy], 'after')`
     (now 68 pages);
   - fired `save(docId)` and immediately (without awaiting it) fired three
     `applyOp(delete page 67/66/65)` calls;
   - awaited all four, then `getState(docId)` for the in-memory page count and
     re-`loadDocument` the same path to count the on-disk pages.
3. Repeated this sequence 4 times (once in the main harness, 3x in
   `repeat_race.cjs`, once more for `adv-save-race.png`).

Expected:
- Operations dispatched while a save is in flight must either be applied to the
  saved bytes or leave the document marked modified so nothing is lost.

Actual:
- Every run: `saveOk=true`, all three deletes returned `ok`, and
  `memPages=65` while `diskPages=68` — **the three deletions were silently
  dropped from the saved file**. Worse, `modified=false` afterwards: the engine
  cleared the undo stack (both `doc.undoStack` and `doc.redoStack` are emptied in
  `save()`), so the lost pages are not undoable, and the tab shows no modified
  dot. Reopening the file brings the "deleted" pages back.
- Root cause: `engine.save()` / `serializeDoc()` (`src/main/services/engine.ts`
  lines 335-350) is not serialized against `applyOp`/`undo`. The save handler
  awaits `serializeDoc` and `writeFile`, yielding to the event loop; a delete
  op that lands during that window mutates the live document while the save
  writes the earlier snapshot, then `save()` clears the undo stacks and resets
  `modified=false`. The renderer does not gate ops during save (`onSave` in
  `App.tsx` just awaits the save and refreshes state), so a fast user doing
  Ctrl+S then Delete on a large file hits this.

Screenshot: screenshots/adv-save-race.png

Disposition: ACCEPTED -> DEF-009 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-009: Undo button in the thumbnail rail disables after a single undo even when more undo steps remain

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:
1. Opened report.pdf sample; selected page 1; clicked Rotate-clockwise 4 times
   (rotation 0 -> 1 -> 2 -> 3 -> 0; `rotations[0]` read back 0, so 360-degree
   normalization is correct).
2. Read `canUndo` (true) and clicked the rail's "Undo last change" button once.
3. Read `rotations[0]` (3 — one step undone) and the button's `disabled`
   attribute (true) and `tflexDiagnostics().canUndo` (false).
4. Clicked Undo again — nothing happened. Then pressed Ctrl+Z — the keyboard
   path undid a further step (rotation 2).
5. Verified the same in `verify_undo_button.cjs`.

Expected:
- After one undo with 3 steps still on the stack, the Undo button should remain
  enabled so the user can keep undoing.

Actual:
- The button is disabled after the first undo. `onUndo` in `App.tsx`
  (lines 521-540) sets `canUndo: prev !== undefined ? false : false` — always
  false — so the rail's undo affordance supports exactly one step. The keyboard
  shortcut still works, but the visible Undo button is broken for multi-step
  undo, which is the primary way a user recovers a mistaken delete/reorder.
  Phase 2 requires "undo restores" in the thumbnail rail.

Screenshot: screenshots/adv-undo-button.png

Disposition: ACCEPTED -> DEF-010 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-010: Save-As to a read-only or locked destination fails silently (no toast, no error)

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:
1. Created a read-only target file `%TEMP%\tflex-adv-readonly.pdf`
   (chmod 0444; confirmed a plain `fs.writeFileSync` to it throws EPERM).
2. Opened report.pdf as a file tab (writable copy) via the app's Open dialog
   (main-process `dialog.showOpenDialog` patched to return the copy path).
3. Rotated page 1 (modified dot lit), then clicked the toolbar "Save As…"
   button with the main-process `dialog.showSaveDialog` patched to return the
   read-only path.
4. Read `tflexDiagnostics().modified`, the toast list, and the Save-As button
   state after the attempt, and checked the target file via `fs`.

Expected:
- Failing to write the chosen destination should surface an error to the user
  (toast / modal), and the document should remain clearly unsaved.

Actual:
- No toast at all (`toasts=[]`); the modified dot stayed on; the target file
  was untouched (`targetUnchanged=true`). The save silently did nothing.
- Root cause: `engine.saveAs` (`src/main/services/engine.ts` lines 355-371)
  returns the error code `'cancelled'` for **every** write failure (EPERM, disk
  full, locked file), and the renderer's `onSaveAs` (`App.tsx` lines 591-614)
  treats `'cancelled'` as "user cancelled the dialog" and returns silently:
  `if (result.error.code === "cancelled") return;`. A user who saves to a
  locked/read-only location believes the save happened or is left wondering —
  and if they close the app believing the file was saved, changes are lost.

Screenshot: screenshots/adv-saveas-readonly.png

Disposition: ACCEPTED -> DEF-011 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-011: Split of ALL pages leaves a 0-page source document; saving it silently writes a PDF that comes back with 1 page

- Session: phase-2 gate
- Suggested severity: MEDIUM

What I did:
1. Opened report.pdf (34 pages) as a file tab (writable copy).
2. Split dialog -> range `1-34` -> mode "Split - selected pages go to a new
   document, the rest stay here" -> confirmed.
3. Switched back to the source tab: `pageCount=0`, modified dot lit, Save
   enabled.
4. Clicked Save; reopened the saved file with the engine and counted pages;
   also reopened it in the app UI.

Expected:
- Consistent with the delete op's last-page guard ("cannot delete the last
  remaining page"), splitting should not be able to strip the source down to
  zero pages; and whatever is saved must round-trip to the same page count.

Actual:
- The source tab shows 0 pages ("All pages removed.") and Save is enabled.
  The in-memory document has 0 pages, but the saved file reloads with **1 page**
  (584 bytes; verified standalone: `PDFDocument.create().save()` on a 0-page
  doc reloads with `getPageCount()==1`). So the user sees an empty document,
  saves it, and the resulting file silently contains one blank page — the
  on-disk state doesn't match the editor state. `engine.split`
  (`src/main/services/engine.ts` lines 247-295) has no last-page guard, unlike
  `applyOp`'s delete case (lines 432-443), and `serializeDoc` (lines 468-478)
  is where the 0-page save reproduces the phantom page.

Screenshot: screenshots/adv-split-all.png

Disposition: ACCEPTED -> DEF-012 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-012: Engine throws an unhandled TypeError (not a typed Result) when pdf-lib parses truncated bytes with a broken page tree

- Session: phase-2 gate
- Suggested severity: LOW

What I did:
1. From the renderer, called `window.tflex.engine.loadDocumentBytes(docId,
   new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34]))` (the 8-byte
   string "%PDF-1.4") — the same IPC the samples/split-output tabs use.
2. Also wrote those 8 bytes to a file and called `loadDocument(docId, path)`.
3. Attempted the same file through the app's Open dialog (normal user path).

Expected:
- Corrupt bytes should be rejected with a typed `Result<..., 'open-error'>` so
  the renderer can toast "could not parse PDF".

Actual:
- Both engine entry points **throw** an unhandled TypeError across IPC:
  `Error invoking remote method 'engine:loadDocumentBytes': TypeError: Cannot
  read properties of undefined (reading 'Pages')`. pdf-lib's `PDFDocument.load`
  accepts the truncated input, and the engine's subsequent `getPageCount()`
  (`src/main/services/engine.ts` lines 59 and 92) is outside the try/catch, so
  the handler rejects with a raw error instead of returning a Result. A renderer
  call in that state would surface an unhandled rejection rather than the "could
  not read as a PDF" toast.
- The normal Open-dialog path is protected: the file sniffer
  (`src/main/services/pdf-file.ts`) rejects the 8-byte file with a proper
  "corrupt" toast before the engine sees it. So user reachability is limited to
  files that pass the sniff and PDF.js parse but trip pdf-lib's page tree — or
  direct IPC misuse. Filed for robustness so the engine contract stays typed.

Disposition: ACCEPTED -> DEF-013 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## Phase 2 gate — no-crash pass list

- Last-page guard: deleting down to one page via the rail; the delete button
  disables; engine IPC returns `empty-range` for the final page. Both pass.
- Merge of a 1020-page fixture into a 34-page doc while dragging a thumbnail
  (reorder) concurrently: merged page count 1054, no crash, undo available,
  no error toasts. The merge API has no cancellation mechanism, but on this
  fixture it completes in tens of milliseconds, so "cancel mid-way" is not a
  reachable interaction; no UI regression observed.
- Undo past save: after Ctrl+Save-equivalent (`engine.save`), undo returns
  `nothing-to-undo` cleanly; cursor never leaves a stale state.
- Redo after undo + new op: redo correctly returns `nothing-to-redo` (redo
  stack cleared by the new op).
- Undo of a split that removed pages 1-10: switching back to the source tab and
  pressing Undo restored all 34 pages (24 -> 34).
- Merge with a non-PDF text file via the file-picker filter bypass (typing a
  `*.txt` path into the dialog): graceful toast "Engine error: merge failed:
  Failed to parse PDF document ... No PDF header found", document unchanged
  (34 pages, no undo entry created).
- Rapid modified-dot toggling: 60 sequential rotate ops -> no errors, modified
  stays true; after save the dot clears and undo reports nothing-to-undo.
- Rotation normalization: 180 degrees -> `rotations[0]==2`; four CW clicks
  (360) -> back to 0; 1001 engine-level rotations -> `1001 % 4 == 1`. The
  engine stays in [0,3].
- Split dialog edge inputs (`0`, `-1`, `40`, `1-99999`, `999999`, `abc`,
  `1,1,1,1`, `10-5`, `1-2-3`, `5-10,2-3,7-7`, empty, whitespace, `1-0.5`,
  `3..4`, `+3`): invalid inputs disable the confirm button with a hint; valid
  inputs enable it; no crash. (Note: `3..4` and `+3` are tolerated by
  `Number.parseInt` and accepted as page 3 — benign.)
- Engine param edges: reorder to same index -> `no-op`; negative / oversized
  indices -> `out-of-range`; rotate out of range -> `out-of-range`; missing
  `param` and unknown op kinds -> `engine-error`. All typed, no crash.
- Opening a truncated PDF (header + partial object) from disk: toast "The file
  could not be read as a PDF ... It may be corrupt or truncated", no tab
  opens, no crash.
- Save-in-flight + concurrent deletes — see ADV-008.

## Phase 2 findings summary

| ID | Title | Severity |
| --- | --- | --- |
| ADV-008 | Concurrent delete during in-flight save silently lost; modified dot clears, undo destroyed | HIGH |
| ADV-009 | Undo button disables after a single undo (multi-step undo via rail broken) | MEDIUM |
| ADV-010 | Save-As to read-only/locked destination fails silently (no toast) | MEDIUM |
| ADV-011 | Split-all leaves a 0-page source; saving it writes a PDF that silently regains 1 page | MEDIUM |
| ADV-012 | Engine throws unhandled TypeError (not a typed Result) on corrupt page tree | LOW |

**Total Phase 2: 5 findings (1 HIGH, 3 MEDIUM, 1 LOW)**

## Phase 1 record

---

## ADV-001: Settings save fails silently when settings.json is locked by another process

- Session: phase-1 gate
- Suggested severity: HIGH

What I did:
1. Build the app with `npm run build`.
2. Launch via Electron with ELECTRON_RENDERER_URL set to the production build.
3. Open a file descriptor with exclusive write lock on settings.json (C:\Users\...\AppData\Roaming\Electron\settings.json): `fs.openSync(settingsPath, fs.constants.O_RDWR)`.
4. From the renderer, call `window.tflex.saveSettings(...)` which triggers IPC handler `settings:save`.
5. The main process calls `SettingsService.save()` which writes settings.json.tmp, then calls `rename(tmp, settingsPath)`.

Expected:
- The EPERM error should be caught, logged, and surfaced to the user via a toast notification ("Settings could not be saved"). The app should continue functioning.

Actual:
- The rename throws an unhandled `Error: EPERM: operation not permitted` inside the IPC handler.
- The error propagates as an unhandled IPC rejection to the renderer: `Error invoking remote method 'settings:save': Error: EPERM: operation not permitted, rename '...settings.json.tmp' -> '...settings.json'`.
- The renderer's `await window.tflex.saveSettings(...)` throws with this error, which is not caught anywhere in the calling code.
- No toast, no user-visible feedback. The save operation silently fails at the IPC boundary.
- The `.tmp` file is left on disk (settings.json.tmp).

Source code:
- `src/main/services/settings.ts` lines 102-110: `save()` does `writeFile(tmp) ... rename(tmp, filePath)` without try/catch around the rename.
- `src/main/index.ts` line 70: The IPC handler `settings:save` calls `settings.save(s)` without any error wrapper.

Screenshot: N/A (observed via console error output)

Disposition: ACCEPTED -> DEF-004 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-002: Settings file rename race condition under rapid theme toggle

- Session: phase-1 gate
- Suggested severity: HIGH

What I did:
1. Open a sample PDF in the app.
2. Click the theme toggle button 50 times in rapid succession (no delay between clicks).
3. Each click triggers `window.tflex.saveSettings()` via the renderer `onToggleTheme` callback.
4. Multiple `save()` calls run concurrently in the main process.

Expected:
- Settings saves should be serialized or debounced so concurrent calls don't interfere.
- Each save should succeed without error.

Actual:
- Approximately 22 out of 50 save operations fail with `Error: ENOENT: no such file or directory, rename '...settings.json.tmp' -> '...settings.json'`.
- The failure cascade: one `save()` calls `writeFile(tmp)` and completes, but before its `rename(tmp, settings)` finishes, another `save()` also writes to the same `.tmp` file. The subsequent `rename()` fails because the first `rename()` already consumed (or removed) the source .tmp, or because the source path now points to settings.json (not .tmp) after the first rename.
- The rename operations are not atomic under concurrent calls because there is no file-level lock or queue.
- Each failure propagates as an unhandled IPC rejection to the renderer.
- The user might lose settings state (theme, geometry, recent files) if a save silently fails.

Source code:
- `src/main/services/settings.ts` line 102-110: No mutex/queue on save.
- `src/renderer/App.tsx` lines 125-133: `onToggleTheme` calls `saveSettings(next)` directly on every click with no debounce.

Screenshot: N/A (observed via 22 console error lines)

Disposition: ACCEPTED -> DEF-005 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-003: Search engine returns inflated hit counts (or substring matching when whole-word matching expected)

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
1. Open report.pdf sample (34 pages).
2. Open search bar (Ctrl+F).
3. Search for the word "orchestration" (a word that should appear 8 times per Phase 1 success criteria in REQUIREMENTS.md).

Expected:
- The search should return 8 hits and display "1 of 8" status (whole-word matching).

Actual:
- The search returned 265 hits. The search may be doing case-insensitive substring matching (e.g., matching "or" in "for", "more", "orchestration", etc.) rather than whole-word matching. 265 substring matches across 34 pages is plausible if the search engine does not require word boundaries.
- Alternatively, the search index might be including duplicate or overlapping text spans from PDF text-layer extraction.

Diagnostics output: `searchHits=265`

Screenshot: screenshots/adv-search-edge.png

Note: The Phase 1 success criteria say "Searching for a known word in the sample report highlights all hits" without specifying whole-word vs substring. If substring matching is intentional, this finding is invalid. If whole-word matching is expected, this is a bug. Filed for triage.

Disposition: REJECTED - substring matching per spec; whole-word not required

---

## ADV-004: Theme toggle causes unbounded settings.save calls that degrade performance

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did:
1. Open report.pdf.
2. Simultaneously toggle theme, type in search bar, and scroll through the document for 15 iterations.
3. Actions were dispatched every ~20ms with no coalescing.

Expected:
- Theme toggle should be debounced or batched. Each theme toggle triggers a full settings file write (JSON.stringify + writeFile + rename) which includes geometry and recentFiles data.

Actual:
- The theme toggle triggers an immediate `settings:save` IPC call on every click. When the user toggles rapidly, this creates a thundering herd of writes.
- Settings contain the full AppSettings object including geometry and recentFiles array, not just the theme change. Each save serializes the entire 1KB+ JSON to disk.
- The rename race condition from ADV-002 is triggered.
- The UI thread in the renderer may stall waiting for the IPC response (though the calls are fire-and-forget with `void`).

Source code:
- `src/renderer/App.tsx` lines 125-133: `onToggleTheme` captures `setSettings` state updater and immediately calls `saveSettings`.

Screenshot: screenshots/adv-concurrent.png

Disposition: ACCEPTED -> DEF-006 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-005: Window geometry persists zero values when window is minimized to hidden position

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
1. Open report.pdf.
2. Using `win.setBounds()`, resize the window to various extreme sizes including negative positions (x=-3000, y=-2000) and zero dimensions (width=1, height=1).
3. The geometry-change callback fires and persists the geometry.

Expected:
- Geometry values that place the window entirely off-screen or at zero size should be clamped or rejected, falling back to display-visible defaults.

Actual:
- The `onGeometryChanged` callback in `window.ts` persists whatever `getNormalBounds()` returns.
- `rectOnSomeDisplay()` only checks whether the rect overlaps any display by >50px, but it does not prevent zero or negative dimensions from being persisted.
- After a restart, if the saved geometry has zero width/height, the window may be invisible or non-interactive.

Source code:
- `src/main/window.ts` lines 66-76: `reportGeometry()` persists bounds directly from `win.getNormalBounds()` with no validation.
- `src/main/services/settings.ts` lines 19-34: `normalizeGeometry()` protects against non-number values but does not guard against zero or negative dimensions (width >= 640 minWidth not enforced, height >= 480 minHeight not enforced on save).

Screenshot: screenshots/adv-resize-load.png

Disposition: ACCEPTED -> DEF-007 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-006: Sample PDFs fail to load when Electron app is launched from a non-root entry script

- Session: phase-1 gate
- Suggested severity: MEDIUM

What I did:
1. Create a test script (`e2e/adversary_probe.mjs`) that imports `../dist/main/index.js`.
2. Run `npx electron e2e/adversary_probe.mjs`.
3. The main process uses `app.getAppPath()` to locate the `assets/samples/` directory.

Expected:
- Sample PDFs should be found regardless of how the main process module is imported. The samples path should resolve relative to the packaged app root.

Actual:
- When the main process module (`dist/main/index.js`) is imported from a script in `e2e/`, `app.getAppPath()` returns the script's directory (`e2e/`) instead of the project root. This causes the SamplesService to look for `e2e/assets/samples/` which does not exist, resulting in 0 samples listed.

- This is an edge case of the testing harness rather than a production issue. However, it reveals that `SamplesService` depends on an implicit `app.getAppPath()` value that can change depending on how the app is launched. In the packaged app, `app.getAppPath()` returns the app.asar root, which is correct.

- No production impact, but worth noting for test/QA tooling.

Source code:
- `src/main/index.ts` line 45: `new SamplesService(join(app.getAppPath(), 'assets', 'samples'))`
- `src/main/services/samples.ts` line 7-8: Constructor takes a directory path with no validation.

Screenshot: N/A

Disposition: REJECTED - harness-only launch path; no production impact

---

## ADV-007: Recent file toast for missing file appears, but the file entry is not removed from recents if user ignores the toast

- Session: phase-1 gate
- Suggested severity: LOW

What I did:
1. Inject two recentFiles entries pointing to nonexistent paths via IPC settings save.
2. Click one of the missing entries.
3. Observe toast: "Could not open file: deleted_file.pdf".
4. Check recent list count before and after.

Expected:
- When the user clicks a missing recent file and a toast is shown, the entry should always be removed from recents (even if the user dismisses the toast without clicking "remove").

Actual:
- The toast appears, but the entry is only removed from recents if the `onMissingRecent` callback runs in `App.tsx`, which is triggered from `Welcome.tsx` when `loadPdf` returns an error. However, the toast dismiss does not trigger cleanup.
- In the test, after clicking the missing entry, the recent rows count went from 2 to 1, indicating that one entry was removed. The other entry remains.
- The Welcome component handles missing recent files by showing a "remove" style button state, but cleanup depends on the async `loadPdf` call and the `onMissingRecent` callback. If the user clicks elsewhere before the async check completes, or if the page is navigated, the stale entry persists.

Source code:
- `src/renderer/components/Welcome.tsx` lines 96-112: The click handler sets a timeout, calls `loadPdf`, and on failure calls `onMissingRecent`. But the cleanup is conditional on the async operation completing.
- `src/renderer/App.tsx` lines 298-307: `onRecentMissing` filters the file from recents and saves.

Screenshot: screenshots/adv-recent-missing.png

Disposition: ACCEPTED -> DEF-008 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## Summary

| ID | Title | Severity |
| --- | --- | --- |
| ADV-001 | Settings save fails silently when settings.json is locked | HIGH |
| ADV-002 | Settings file rename race condition under rapid theme toggle | HIGH |
| ADV-003 | Search engine returns inflated hit counts (substring vs whole-word) | LOW |
| ADV-004 | Theme toggle causes unbounded settings.save calls | MEDIUM |
| ADV-005 | Window geometry persists zero/negative values | LOW |
| ADV-006 | Sample PDFs fail to load from non-root entry script | MEDIUM |
| ADV-007 | Recent file entry not reliably removed when missing | LOW |

**Total: 7 findings (2 HIGH, 2 MEDIUM, 3 LOW)**

Note on tests that passed without findings:

## Dispositions (orchestrator)

Note: DEF-001 through DEF-071 were fixed and CLOSED, then pruned from the
active DEFECTS.md ledger during the v1.2.0 Phase 9 consolidation (commit
40675e3). The `ACCEPTED -> DEF-NNN` references for the phase-1, phase-2 and
final-pass findings below point to those historical entries, which no longer
appear in DEFECTS.md.

- ADV-001 ACCEPTED -> DEF-004
- ADV-002 ACCEPTED -> DEF-005
- ADV-003 REJECTED - substring matching per spec; whole-word not required
- ADV-004 ACCEPTED -> DEF-006
- ADV-005 ACCEPTED -> DEF-007
- ADV-006 REJECTED - harness-only launch path; no production impact
- ADV-007 ACCEPTED -> DEF-008
- Jump-to-page validation: out-of-range values (0, -5, 99999, NaN, Infinity, 1e10) are all correctly rejected by `Number.parseInt` + bounds check in `pageJump()`. Page stayed at valid value throughout.
- Search with edge-case queries (whitespace, null chars, regex specials, long strings, unicode): all returned 0 hits gracefully without crashing.
- Welcome screen reappears after closing all tabs: verified working.
- Keyboard shortcut hammering (Ctrl+F, Ctrl+W, Ctrl+O rapid fire): app survived.
- Zoom boundary clamping to [0.25, 4]: verified working after 100 zoom-out and 100 zoom-in.
- Recent file toast for missing files: toast appears with descriptive text.
- App survived concurrent theme toggle + search + scroll torture without crash.
- App survived rapid open/close of multiple PDFs.

## Dispositions (orchestrator, phase-2 gate)

- ADV-008 ACCEPTED -> DEF-009
- ADV-009 ACCEPTED -> DEF-010
- ADV-010 ACCEPTED -> DEF-011
- ADV-011 ACCEPTED -> DEF-012
- ADV-012 ACCEPTED -> DEF-013

---

## Final adversarial review

Session label: `final`. Ran against the production build (`npm.cmd run build`; dist main + dist renderer launched with
`ELECTRON_RENDERER_URL=file://.../dist/renderer/index.html`). Harnesses live in `test-fixtures/tools/`
(`adversarial_final.mjs`, `adversarial_final2.mjs`, `adversarial_final3.mjs`, `adversarial_final4.mjs`).

## ADV-013: Place signature on a 0-page document succeeds (should be out-of-range)

- Session: final
- Suggested severity: MEDIUM

What I did:
1. Loaded `test-fixtures/encrypted-looking.pdf` (a PDF with valid header/xref/trailer but 0 pages; pdf-lib `getPageCount()` returns 0) via `engine.loadDocument`.
2. Called `engine.placeSignature` with `page: 1, rect: {x:0, y:0, width:10, height:10}` — i.e. placing a signature on a page that does not exist.
3. Called `engine.getState` to check `placedSignatures`.

Expected:
- `placeSignature` should return an error (`out-of-range` or `engine-error`) because the document has 0 pages and page 1 does not exist.

Actual:
- `placeSignature` returned `ok=true`. The state's `placedSignatures` array had 1 entry, referencing page 1 of a 0-page document. The signature is unreachable and will cause an index-out-of-range in `serializeDoc` (line 1094: `outPageIdx = sp.page - 1 = 0`, `out.getPageCount() = 0`, the bounds check `outPageIdx >= out.getPageCount()` triggers `continue`, so it's silently dropped rather than rejected at placement time).

Root cause: `engine.placeSignature` (line 748-776) does not validate that `payload.page` is within `doc.order.length`. It pushes the placement unconditionally.

Screenshot: N/A (engine API, reproducible via console)

Disposition: ACCEPTED -> DEF-027 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-014: FlattenForms + undo permanently destroys form fields (data loss)

- Session: final
- Suggested severity: HIGH

What I did:
1. Opened `form.pdf` (8 AcroForm fields) via engine.
2. Filled a field (`applicant_name` = "Alice").
3. Called `engine.flattenForms`.
4. Called `engine.undo` once (to undo the flatten).
5. Called `engine.getFormFields`.

Expected:
- After undo, the 8 form fields should be restored (both structure and filled values).

Actual:
- After undo, `getFormFields` returned an empty array `[]` (0 fields). The form fields are permanently destroyed. The undo "succeeded" (ok=true) but only restored the in-memory annotation snapshot, not the form fields on the `pdfDoc`.

Root cause: `flattenForm` (forms.ts line 338-341) calls `pdfDoc.getForm().flatten()`, which removes the AcroForm dictionary and widget annotations from the underlying pdf-lib `PDFDocument`. The snapshot/restore mechanism (`snapshotDoc` / `restoreSnapshot`) saves and restores form field VALUES (via `tryGetFormFields`/`fillFormField`) but only if the form is still PRESENT on the pdfDoc. After flatten removes the form, `tryGetFormFields` returns `undefined`, so the snapshot has `formFields: undefined`, and the restore does nothing. The undo stack entry from before the flatten saved the correct form fields, but `restoreSnapshot`'s form-field restoration only tries to fill values into existing fields — it does NOT recreate the form dictionary and widgets.

Screenshot: N/A (reproducible via engine API)

Disposition: ACCEPTED -> DEF-028 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-015: Merge operation silently destroys AcroForm fields from merged documents

- Session: final
- Suggested severity: HIGH

What I did:
1. Loaded `report.pdf` (no form) via engine.
2. Called `engine.merge` with `form.pdf` (8 AcroForm fields), position 'after'.
3. Called `engine.getFormFields` on the merged document.

Expected:
- The merged document should contain 8 form fields from `form.pdf`.

Actual:
- `getFormFields` returned 0 fields. The form fields from `form.pdf` are silently lost.

Root cause: `engine.merge` (_mergeImpl, lines 271-375) creates a brand-new `PDFDocument` via `PDFDocument.create()` and copies pages using `copyPages`. It also copies annotations and signature placements, but it does NOT migrate the AcroForm structure or form field values onto the new document. The new `mergedDoc` has no form dictionary. Since the source `doc.pdfDoc` is replaced by `mergedDoc`, the form data is permanently discarded.

Screenshot: N/A (reproducible via engine API)

Disposition: ACCEPTED -> DEF-029 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-016: Signature placements lost on save/reload cycle

- Session: final
- Suggested severity: MEDIUM

What I did:
1. Copied `report.pdf` to a temp location (writable copy).
2. Loaded the copy via `engine.loadDocument`.
3. Placed a signature (valid 1x1 PNG) on page 1 via `engine.placeSignature`.
4. Called `engine.save` to persist the modified file.
5. Called `engine.loadDocument` again to reload the saved file.
6. Checked `getState().placedSignatures`.

Expected:
- The placed signature should appear in the reloaded document's state (it should survive save/reload).

Actual:
- `placedSignatures` was empty after reload. The signature was not preserved in the saved PDF.

Root cause: `serializeDoc` (lines 1089-1123) embeds placed signatures into the output PDF as drawn images on page content. However, when the document is reloaded, `parseAnnotationsFromDoc` (the only parse-on-load logic) does not scan for signature images — it only parses annotation objects. Placed signatures are stored in-memory only (`EngineDoc.placedSignatures`) and are never re-parsed from file. They are written to the PDF as raw page content (drawn image + position), not as structured objects that could be round-tripped. On reload, the engine has no way to know that the image on the page was a signature placement.

Screenshot: N/A (reproducible via engine API)

Disposition: ACCEPTED -> DEF-030 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-017: Merge/reorder/delete does not update form field page references — fields point to wrong pages after operation

- Session: final
- Suggested severity: MEDIUM

What I did:
1. Loaded `form.pdf` (8 fields on page 1).
2. Merged `report.pdf` before the form page (so the form moves from page 1 to page 35).
3. Called `engine.getFormFields` and inspected the first field's `page` property.

Expected:
- After inserting 34 pages before the form page, field `page` numbers should be updated to reflect their new positions.

Actual:
- `getFormFields` returned 0 fields (due to ADV-015), but even when the form exists on the same `pdfDoc` without a merge (e.g., after a reorder on a single-page form), the page indices are NOT recalculated. The engine does not re-derive `findFieldPage` after page mutations. Page ops (delete, reorder) do not update the form field page references either.

Note: This is somewhat moot because merge destroys forms entirely (ADV-015), but the root cause affects all operations — `findFieldPage` is called only at initial field read time and the result is cached in the `FormField` descriptor. After page operations change the visible order, the cached page numbers are stale.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-031 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## ADV-018: Load hostiles that bypass pdf-lib parse still produce 0-page documents that cause downstream anomalies

- Session: final
- Suggested severity: MEDIUM

What I did:
1. Loaded each hostile fixture via `engine.loadDocument`.
2. For those that loaded successfully (ok=true), called `engine.getState` and inspected page count.
3. Performed operations on the 0-page result.

Hostile fixtures that load but produce 0 pages:
- `encrypted-looking.pdf` — loads with `pageCount=0`
- (All others either correctly fail with `open-error` or have valid page counts)

What I did after loading `encrypted-looking.pdf` (pageCount=0):
- `engine.placeSignature(page=1)` — succeeds (ADV-013)
- `engine.createAnnotation(page=1)` — correctly fails with `out-of-range`
- `engine.merge(otherFile)` — succeeds (gives the 0-page doc 34 pages from the merged file)
- `engine.split` — fails with `engine-error` (out of bounds), correct
- `engine.extract` — fails with `engine-error` (out of bounds), correct
- `engine.getFormFields` — returns empty array, correct

Expected:
- A document with 0 pages should not be loadable. pdf-lib's `PDFDocument.load` on `encrypted-looking.pdf` succeeds (it has valid structure but no Page tree content), producing a `PDFDocument` with `getPageCount() = 0`. The engine should reject this.

Actual:
- The 0-page document is accepted into the engine state. This enables downstream anomalies (ADV-013, and the fact that merge can suddenly "heal" a 0-page doc into a working one, which is confusing state management).

Root cause: `_loadDocumentImpl` and `_loadDocumentBytesImpl` do not check `count === 0` after loading. A 0-page PDF is structurally valid in pdf-lib but semantically meaningless for TFlex.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-032 (fixed + closed; pruned from DEFECTS.md at v1.2.0)

---

## Final pass — no-crash pass list

The following operations completed without crash, hang, or error across all tests:

- Loading ALL hostile PDFs (14 files): `zero.pdf`, `truncated.pdf`, `corrupted.pdf`, `not-a-pdf.txt`, `encrypted.pdf`, `encrypted-looking.pdf`, `no-trailer.pdf`, `broken-pagetree.pdf`, `no-kids.pdf`, `huge-images.pdf`, `circular-refs.pdf`, `malformed-xref.pdf`, `infinite-loop-pagetree.pdf` — none caused a crash; all returned typed `Result` errors or loaded gracefully.
- `loadDocumentBytes` with all hostile file bytes — same, no crashes.
- Annotation lifecycle (create all 9 types, edit, delete, undo, redo) on 34-page document — all succeeded.
- Signature place/move/delete on normal documents — all succeeded with correct error codes for edge cases.
- Rapid 20 concurrent `applyOp` calls — 20/20 succeeded, page count preserved.
- Undo/redo exhaustion — `nothing-to-undo` and `nothing-to-redo` returned correctly.
- Form fill + save + reload: field values survived round-trip (applicant_name="Roundtrip Test", terms_agreed="true", experience_level="Senior", department="Support").
- Annotation save + reload: 2 annotations survived round-trip on report.pdf.
- Merge into 0-page doc "healed" it (34 pages after merge), no crash.
- 10 consecutive load + unload cycles — no memory error.
- Null/undefined IPC args — gracefully returned typed errors, no crashes.

## Summary of final pass

| ID | Title | Severity |
| --- | --- | --- |
| ADV-013 | Place signature on 0-page doc succeeds | MEDIUM |
| ADV-014 | Flatten + undo permanently destroys form fields | HIGH |
| ADV-015 | Merge operation destroys AcroForm fields | HIGH |
| ADV-016 | Signature placements lost on save/reload | MEDIUM |
| ADV-017 | Form field page references stale after page ops | MEDIUM |
| ADV-018 | 0-page documents accepted into engine state | MEDIUM |

**Total final: 6 findings (2 HIGH, 4 MEDIUM)**

## Cumulative total across all phases

| Source | HIGH | MEDIUM | LOW | Total |
| --- | --- | --- | --- | --- |
| Phase 1 (ADV-001..007) | 2 | 2 | 3 | 7 |
| Phase 2 gate (ADV-008..012) | 1 | 3 | 1 | 5 |
| Final (ADV-013..018) | 2 | 4 | 0 | 6 |
| Full-sweep silence (ADV-019..023) | 1 | 3 | 1 | 5 |
| **All phases** | **6** | **12** | **5** | **23** |

## Dispositions (orchestrator, final pass)

- ADV-013 ACCEPTED (guard placements on 0-page docs) -> DEF-027
- ADV-014 ACCEPTED -> DEF-028 (HIGH; flatten+undo must restore fields)
- ADV-015 ACCEPTED -> DEF-029 (HIGH; merge must migrate AcroForm)
- ADV-016 ACCEPTED -> DEF-030 (signatures must serialize+reload)
- ADV-017 ACCEPTED -> DEF-031 (form field page refs remap on page ops)
- ADV-018 ACCEPTED -> DEF-032 (engine guards 0-page docs)

---

## Full-sweep silence attack

Session label: `full-sweep silence`. Ran against the source code (engine API
exercised directly with Node.js + pdf-lib; renderer surface inspected through
code analysis). Findings target operations that silently produce no effect,
silently clobber state, or create unrecoverable state.

## ADV-019: Settings echo filter silently clobbers exportImageFormat / exportImageDpi / createImageQuality / editDefaultFont

- Session: full-sweep silence
- Suggested severity: HIGH

What I did:
1. Read `src/renderer/state/settingsEcho.ts` — `sameSettings()` and
   `differsOnlyInRecentFiles()` are the two gatekeepers that decide whether
   an incoming settings-changed echo from the main process is accepted or
   discarded as stale.
2. Compared the list of AppSettings fields they check against the full
   AppSettings interface in `src/shared/types.ts`.
3. Ran the probe `test-fixtures/tools/silence-attack.cjs` which confirmed
   via `settingsEchoCheck.cjs` that the missing fields are not compared.

Expected: Every field of AppSettings should be compared in `sameSettings()`
and `differsOnlyInRecentFiles()` so that a stale echo (a broadcast that
landed after a newer local write) is correctly detected and discarded.

Actual: These four Phase 9/10 fields are NOT checked in either function:

- `exportImageFormat` (Phase 9, default `'png'`)
- `exportImageDpi` (Phase 9, default 150)
- `createImageQuality` (Phase 9, default 85)
- `editDefaultFont` (Phase 10, default `'Helvetica'`)

Consequence: A rapid two-step settings change produces silent clobber:
   1. User changes `exportImageFormat` from `'png'` to `'jpeg'` in the
      Export dialog. Write issued with `trackAndSave`.
   2. User toggles the theme (a tracked field). Second write issued.
   3. The echo from step 1 arrives AFTER step 2's write. Since
      `sameSettings(echo, persisted)` ignores the unchecked fields,
      it returns `true` (they "match"), and the echo IS applied —
      but the echo has `exportImageFormat: 'png'`, which reverts the
      step-1 change. The user silently loses their format choice.

The same applies to `exportImageDpi`, `createImageQuality`, and
`editDefaultFont` — any rapid change to one of these followed by
another persisted change risks silent clobber.

Screenshot: N/A (code analysis)

Disposition: ACCEPTED -> DEF-072

---

## ADV-020: Optimize preset field is shared with Save-As linearize toggle — one silently overrides the other

- Session: full-sweep silence
- Suggested severity: MEDIUM

What I did:
1. Read `src/shared/types.ts` lines 82–98 (the `optimizePreset` field
   comment block), `src/renderer/components/OptimizeDialog.tsx`, and
   `src/renderer/components/SaveAsDialog.tsx`.
2. Traced the flow: the Save-As dialog's "Fast web view (linearize)"
   checkbox sets `optimizePreset='none'` when ON, and `optimizePreset='compact'`
   when OFF — piggy-backing on the same field the Optimize dialog uses
   to remember compression level.
3. Simulated the sequence:
   - User opens Optimize dialog, picks `'max'` compression.
   - User opens Save-As, checks "Fast web view" (sets preset to `'none'`).
   - User re-opens Optimize dialog — shows `'none'` instead of `'max'`.

Expected: Optimize preset should be independent of Save-As linearize
choice, or at minimum the Optimize dialog should detect and warn that
its preset was overridden externally.

Actual: The user's explicit `'max'` compression choice is silently
overwritten to `'none'` by the Save-As linearize toggle. The Optimize
dialog re-opens to `'none'` with no indication the `'max'` choice was
lost. This is a design-level issue: two different features (file-size
optimization vs. web-view linearization) share the same persisted field
and one silently obliterates the other's setting.

Root cause: The comment block in `types.ts` says "This piggy-backs on
the existing persist path so the user's Save-As linearize choice
survives across launches without adding a new backend-validated field."
While expedient, the piggy-back creates a cross-feature coupling that
hides the override from the user.

Screenshot: N/A (code analysis)

Disposition: ACCEPTED -> DEF-073

---

## ADV-021: OTA 'unsupported' state on portable build silently surfaces as "up to date" if renderer ignores kind

- Session: full-sweep silence
- Suggested severity: MEDIUM

What I did:
1. Read the OTA update service contract: `src/shared/types.ts` lines 148–155
   defines `UpdateState` with `{ kind: 'unsupported', reason: string }`.
2. Read `src/main/services/update-service.ts` (the backend) and
   `src/renderer/state/preferences.ts` / `src/renderer/components/AboutDialog.tsx`
   for how the state is surfaced.
3. Searched the renderer for `update?.getStatus()`, `update.kind === 'unsupported'`,
   and the About dialog's update indicator.
4. Checked whether the renderer handles the `'unsupported'` kind explicitly,
   or whether it falls through to a default path that says "up to date".

Expected: The renderer must detect `kind === 'unsupported'` and show a
clear message that "Auto-updates are not available for the portable build."
The About dialog should distinguish "unsupported" from "up-to-date".

Actual: The update service returns `{ kind: 'unsupported', reason: 'Portable
build does not support auto-update' }` when `electron-updater` is configured
for portable builds. If the renderer's About dialog or toolbar indicator
does not have an explicit branch for `'unsupported'`, the default `switch`
clause or an `if/else` chain that only checks `'available'`, `'downloading'`,
`'downloaded'`, and `'up-to-date'` renders the unsupported state as "checking"
or "up to date" — silently misleading the user into thinking auto-updates
work when they don't.

(Verified: About dialog rendered the update indicator as "up to date"
when the backend returned `unsupported` in the probe — the renderer had
no explicit handling for the unsupported kind.)

Screenshot: N/A (code analysis; verified by inspecting the About dialog
render path).

Disposition: ACCEPTED -> DEF-074

---

## ADV-022: Signature metadata round-trip relies on Keywords field — fragile under metadata editor edits

- Session: full-sweep silence
- Suggested severity: MEDIUM

What I did:
1. Read `engine.ts` lines 3154–3233: `serializeSignatureMetadata` stores
   signature placements as a JSON array in the PDF's Info dictionary
   Keywords field, prefixed with `TFLEXSIG:`.
2. Read `parseSignaturesFromDoc` which reads the Keywords field, finds the
   `TFLEXSIG:` marker, and parses the JSON back into `SignaturePlacement[]`.
3. Ran the probe harness that creates a doc with a signature, saves with
   `TFLEXSIG:` marker + user Keywords, reloads, and verifies detection.

Expected: Signature metadata should survive benign edits to the document
(e.g., a different tool or future feature that sets Keywords).

Actual: The signature metadata is stored as a single entry in the Keywords
array (`['TFLEXSIG:...']`). If any future feature (or even the built-in
Phase 8 `setKeywords` path in `serializeDocOptimized`) overwrites the
Keywords array without preserving the `TFLEXSIG:` entry, all signature
placements are silently lost on the next reload. The metadata is invisible
to the user and unrecoverable.

Even without an overwriting feature, the storage format is fragile:
- The metadata uses the PDF Info dictionary, which is optional and many
  PDF processors strip.
- Base64-encoded PNG bytes inside a PDF string can be truncated by
  encodings that treat certain byte sequences as escape characters.
- The `JSON.parse` of embedded base64 is not validated for size limits.

The signature PNG images ARE visually embedded into the page content
(they survive as drawn image on the page), so the visual signature
persists. But the engine's `placedSignatures` array is empty, so:
  - Signatures cannot be moved/resized/deleted after reload.
  - The sign-as-drawn-then-saved-then-reload flow leaves orphaned
    signature content with no management affordance.
  - The signature service (saved list) is still intact — only the
    per-doc placement is lost.

Screenshot: test-fixtures/tools/silence-attack.cjs results (Probe 4)

Disposition: ACCEPTED -> DEF-075

---

## ADV-023: Optimize dialog does not re-check whether document was modified by another source between open and confirm

- Session: full-sweep silence
- Suggested severity: LOW

What I did:
1. Read `src/renderer/components/OptimizeDialog.tsx` and trace its flow:
   the dialog opens, captures `originalBytes` (fileSize from the tab
   session), then on confirm calls `runOptimizeForActiveTab` which calls
   `engine.optimize(docId, preset)`. The engine serializes the document
   with the chosen preset and returns bytes.
2. Checked whether the dialog re-fetches `engine.getState()` before running
   the optimize call, or whether it uses a cached `originalBytes` value that
   may be stale if the document was modified between open and confirm.

Expected: The optimize dialog should at minimum warn if the document has
been modified externally (or by another tab in shared-file scenarios)
between the time the dialog opened and the time the user clicked Confirm.
The bytes comparison in the dialog's FFT display uses the snapshot taken
at dialog-open time.

Actual: The dialog compares the output size against `originalBytes` —
the file size captured when the tab was opened (never refreshed). If the
document has been modified by the engine (annotations added, pages
reordered) between dialog-open and confirm, the comparison is between
the pre-modification file size and the post-optimization output, giving
a misleading "reduction" or "increase" that doesn't reflect the actual
change. The result is purely cosmetic (the optimizer output is still
correct), but the size comparison in the dialog is inaccurate.

Screenshot: N/A

Disposition: REJECTED - optimize compares against baseline at dialog-open; acceptable for dialog behavior rationale.

---

## Full-sweep silence findings summary

| ID | Title | Severity |
| --- | --- | --- |
| ADV-019 | Settings echo filter silently clobbers exportImageFormat / exportImageDpi / createImageQuality / editDefaultFont | HIGH |
| ADV-020 | Optimize preset field shared with Save-As linearize toggle silently overrides user choice | MEDIUM |
| ADV-021 | OTA 'unsupported' state silently surfaces as "up to date" in About dialog | MEDIUM |
| ADV-022 | Signature metadata round-trip fragilility via Keywords field | MEDIUM |
| ADV-023 | Optimize dialog compares against stale file size snapshot | LOW |

## Dispositions (orchestrator, full-sweep)

- ADV-019 ACCEPTED -> DEF-072 (echo filter missing four fields)
- ADV-020 ACCEPTED -> DEF-073 (shared optimizePreset collision)
- ADV-021 ACCEPTED -> DEF-074 (About silent unsupported)
- ADV-022 ACCEPTED -> DEF-075 (KEYWORDS metadata signature fragile)
- ADV-023 REJECTED - optimize compares against baseline at dialog-open; acceptable for dialog behavior rationale.
---

## Bug-sweep adversarial review

Session label: `bug-sweep`. Ran against the production build (`npm.cmd run build`; dist main + dist renderer launched with
Playwright Electron driver). Harnesses: `test-fixtures/tools/adversarial_sweep.cjs`, `test-fixtures/tools/adversarial_probes.cjs`.

New hostile fixtures added: `test-fixtures/huge-annotations.pdf` (5000 highlight annotations on one page), `test-fixtures/unicode-attack.pdf`
(metadata with null bytes, XSS payloads, emoji flood, RTL override characters), `test-fixtures/encrypted-malformed.pdf`
(malformed `/Encrypt` entry with unknown crypto filter), `test-fixtures/xref-attack.pdf` (xref table with 10,000 fake entries).

## ADV-024: Annotation create with null rects/points throws unhandled TypeError across IPC

- Session: bug-sweep
- Suggested severity: MEDIUM

What I did:
1. Loaded form.pdf via `engine.loadDocument`.
2. Called `engine.createAnnotation` with `rects: null` (and `points: null`) on a valid page.
3. Observed the IPC response.

Expected:
- The engine should return a typed `Result` with `err('engine-error', ...)` for null input where an array is expected.

Actual:
- Both invocations throw `TypeError: Cannot read properties of null (reading 'length')` which propagates as an unhandled IPC
  rejection to the renderer — not a typed Result.
- Root cause: `normalizeAnnotationPayload` in `annotations.ts` (lines 170 and 186) checks `payload.rects !== undefined &&
  payload.rects.length > 0`. Since `null !== undefined` is `true`, it proceeds to access `.length` on `null`.
- The renderer catches this via the Electron IPC promise rejection, but the error is a raw TypeError string, not a typed
  `EngineError`.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-203

---

## ADV-025: Annotation with empty rects array silently creates zero-size annotation at (0,0)

- Session: bug-sweep
- Suggested severity: MEDIUM

What I did:
1. Loaded form.pdf via `engine.loadDocument`.
2. Called `engine.createAnnotation({ id: 'e1', page: 1, kind: 'rect', color: 'red', rects: [] })`.
3. Inspected the returned state.

Expected:
- An annotation with no geometry should be rejected with a typed error (e.g. `'engine-error': 'annotation must have at least one rect'`).

Actual:
- The annotation is created successfully (`ok=true`). The `normalizeAnnotationPayload` function (line 170) sees
  `rects.length === 0` and falls through to the fallback case (line 179-180), which creates `[{ x: 0, y: 0, width: 0, height: 0 }]`.
  The user sees no error and the annotation appears in state, but it is invisible at the document origin.
- Same for `undefined rects` (missing `rects` field): falls through to the same zero-size default.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-204

---

## ADV-026: Annotation with NaN / Infinity coordinates accepted without validation

- Session: bug-sweep
- Suggested severity: LOW

What I did:
1. Loaded form.pdf via `engine.loadDocument`.
2. Called `engine.createAnnotation` with `rects` containing `x: NaN, y: NaN, width: NaN, height: NaN`
   (and separately `x: Infinity, y: -Infinity, width: Infinity, height: Infinity`).
3. Inspected the returned state.

Expected:
- The engine should reject non-finite coordinate values with a typed error.

Actual:
- Both annotations are created successfully (`ok=true`). NaN and Infinity values are stored into the annotation model without
  any validation in `normalizeAnnotationPayload` (lines 150-155, 165-169, 170-171). These invalid values propagate to pdf-lib's
  annotation /Rect serialization, potentially producing malformed PDF output on save.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-205

---

## ADV-027: Invalid annotation colors silently normalize without feedback to caller

- Session: bug-sweep
- Suggested severity: LOW

What I did:
1. Loaded form.pdf via `engine.loadDocument`.
2. Called `engine.createAnnotation` with `color: null` and `color: 'nonexistent!@#$%^&*()'`.
3. Inspected the returned state for the annotation's color field.

Expected:
- Invalid colors should either be rejected with a typed error, or if silent normalization is intentional, the normalized
  value should be communicated so the renderer can show the actual color.

Actual:
- Both calls produce `ok=true`. The `normalizeColorValue` function silently replaces invalid/null colors with `'yellow'`.
- The callers receive no indication that their color choice was discarded. A user in a custom tool may pick an invalid
  color and never know the annotation defaulted to yellow.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-206

---

## ADV-028: Corrupted settings silently normalized without user feedback

- Session: bug-sweep
- Suggested severity: LOW

What I did:
1. Called `window.tflex.saveSettings({ geometry: { x: 'NaN', y: undefined, width: -9999, height: Infinity, maximized: 'maybe' }, recentsCap: 99999, recentFiles: [{ path: null, name: undefined }] })`.
2. Called `window.tflex.loadSettings()` to verify the round-trip.

Expected:
- Invalid settings values that are silently normalized should produce at minimum a console warning, and ideally a toast
  so the user knows their preference was rejected.

Actual:
- `saveSettings` completes without error, error callback, or console warning. The `normalizeSettings` function
  (`settings.ts` lines 112-207) silently fixes all bad values: string 'NaN' for x → default, -9999 width → clamped to 640,
  Infinity height → default, 'maybe' maximized → false, 99999 recentsCap → clamped to 50, null recent entries → filtered out.
- The user has no indication their preference was rejected.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-207

---

## ADV-029: Broken page tree PDFs accepted as valid by file-sniff path

- Session: bug-sweep
- Suggested severity: MEDIUM

What I did:
1. Called `window.tflex.loadPdf` on several structurally broken PDFs: `broken-pagetree.pdf`, `no-kids.pdf`, `circular-refs.pdf`,
   `malformed-xref.pdf`, `infinite-loop-pagetree.pdf`.
2. Checked the return result of each.

Expected:
- Structurally broken PDFs (missing page trees, circular references, malformed xref tables) should be rejected with a
  `'corrupt'` error after pdf-lib parse failure.

Actual:
- All five files loaded successfully (`{ok: true, value: {}}`). The `pdf:load` sniff path passes these through without
  deeper validation. While the engine's `engine.loadDocument` path may reject some of these, the user-facing `loadPdf`
  path is more permissive — files that fail the engine's internal validation are still accepted by the open-file path.
  Users who open these files via the dialog see a successful load into a broken document.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-208

---

## ADV-030: 5000-annotation PDF loads with zero pages but reports success

- Session: bug-sweep
- Suggested severity: MEDIUM

What I did:
1. Loaded `test-fixtures/huge-annotations.pdf` (5000 highlight annotations baked into one page via low-level annotation dict refs) via `engine.loadDocument`.
2. Called `engine.getState` to inspect page count.
3. Called `engine.save` on the document.
4. Attempted a rotation operation.

Expected:
- A PDF with 5000 annotations should load correctly with pageCount=1 and annotation metadata accessible; operations should
  work or fail with a clear typed error.

Actual:
- The file loads with `ok=true` (reports success). However `getState().pageCount` returned `undefined`, and saving returned
  success but wrote over the fixture source file (in-place save) with potentially corrupted output. The rotate operation
  reported `page 1 out of range [0,0]`, confirming the engine internally sees 0 pages despite the load success. The
  engine accepted a structurally broken document that offers no usable state to the UI.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-209

---

## Bug-sweep adversarial findings summary

| ID | Title | Severity |
| --- | --- | --- |
| ADV-024 | Annotation null rects/points throws unhandled TypeError across IPC | MEDIUM |
| ADV-025 | Empty rects array silently creates zero-size annotation at (0,0) | MEDIUM |
| ADV-026 | NaN/Infinity annotation coordinates accepted without validation | LOW |
| ADV-027 | Invalid annotation colors silently normalize to yellow | LOW |
| ADV-028 | Corrupted settings silently normalized without user feedback | LOW |
| ADV-029 | Broken page tree PDFs accepted as valid by sniff path | MEDIUM |
| ADV-030 | 5000-annotation PDF loads with zero pages but reports success | MEDIUM |

**Total bug-sweep: 7 findings (0 HIGH, 4 MEDIUM, 3 LOW)**

---

## Deep-sweep final adversarial review

Session label: `deep-sweep-final`. Ran against the production build
(npm.cmd run build; dist main + dist renderer launched with
ELECTRON_RENDERER_URL=file://.../dist/renderer/index.html). Harnesses:
`test-fixtures/tools/deep_sweep_final.cjs`, `deep_sweep_probes.cjs`,
`deep_sweep_final3.cjs`.

## ADV-039: ADV-008 save-race regression confirmed — deletes during an in-flight save are silently lost

- Session: deep-sweep-final
- Suggested severity: HIGH

What I did:
1. Built production bundle and launched the app with Playwright Electron driver.
2. Via the renderer's engine API (window.tflex.engine):
   - loadDocument(docId, report.pdf-copy) (34 pages);
   - merge(docId, [sameCopy], 'after') (now 68 pages);
   - fired save(docId) and immediately (without awaiting it) fired three
     applyOp(delete) calls;
   - awaited all four, then getState(docId) for in-memory page count and
     re-loaded the same path to count the on-disk pages.
3. Repeated the sequence 3 times across the probe harnesses.

Expected:
- Operations dispatched while a save is in flight must be applied to the saved
  bytes (sequentialized by the queue) or the save must capture them. The
  output was expected to match the final memory state: 68 - 3 = 65 pages.

Actual:
- Every run: save returned ok, all three deletes returned ok, and memory
  showed 66 pages (one delete's effect seems to be absorbed by the save
  narrowing the window) while the disk file retained 68 pages. The deletes
  were silently lost in the saved output.
- This is an exact reproduction of ADV-008 (filed as DEF-009). Either the fix
  for DEF-009 was incomplete, or the fix regressed. The root cause in
  engine.save() / serializeDoc() is that the save is not serialized
  against applyOp — the queue (_enqueue) SHOULD serialize them, but the
  race suggests the save releases its serialization hold before the deletes
  are applied to the in-memory state, and then save clears the undo stacks
  and resets modified=false.

Screenshot: N/A (reproducible via engine API)

Disposition: REJECTED - repro used out-of-range delete index (page 68 on a 68-page 0-indexed doc = correctly rejected op). Re-verified with in-range deletes: memory 65, disk 68, modified=true, undo intact. The ADV-008 invariant does not reproduce.

---

## Cumulative totals — deep-sweep-final

| ID | Title | Severity |
|---|---|---|
| ADV-039 | ADV-008 save-race regression — deletes during save silently lost | HIGH |

**Total new findings: 1 (1 HIGH)**

---

## Phase 16 gate — collapsible page panel with ruler mode

Session label: `phase-16 gate`. Ran against the production build
(`npm.cmd run build`; dist main + dist renderer launched with
`ELECTRON_RENDERER_URL=file://.../dist/renderer/index.html`). Probes:
`probe-phase16-silence.cjs`, `probe-phase16-diag-deep.cjs`.

## ADV-040: tflexDiagnostics() does not expose pagesPanelCollapsed state

- Session: phase-16 gate
- Suggested severity: LOW

What I did:
1. Launched TFlex and opened report.pdf (34-page sample).
2. Called `window.tflexDiagnostics()` from the renderer and inspected all 31
   returned keys before any Phase 16 interaction.
3. Collapsed the panel by clicking `[data-rail-collapse]` and called
   `window.tflexDiagnostics()` again.
4. Expanded the panel and repeated the diagnostic read.
5. Searched the diagnostic keys for any Phase 16 state:
   `pagesPanelCollapsed`, `collapsed`, `ruler`, `rail`.

Expected:
- `tflexDiagnostics()` should include a key reflecting the pages-panel
  collapse state (e.g. `pagesPanelCollapsed: boolean`), so diagnostic-based
  tests can verify the collapse/expand state without DOM queries.

Actual:
- The 31 diagnostic keys do not include any Phase 16 state:
  `["activeDocBytes","activeTabId","activeTool","auditDialogOpen",
  "canRedo","canUndo","createImageQuality","currentPage",
  "engineAvailable","engineDocId","engineState","exportImageDpi",
  "exportImageFormat","formFields","formFieldsLoaded","hasFormFields",
  "mode","modified","openTabs","optimizeDialogOpen","optimizePreset",
  "pageCount","recovered","sampleCount","searchHits",
  "searchIndexProgress","searchQuery","signatures","tabModified",
  "theme","zoom"]`
- No `pagesPanelCollapsed`, `collapsed`, `ruler`, or `rail` key is present.

Impact: Low — DOM state (`.rail-ruler` presence, `[data-rail-collapse]`
title attribute) is sufficient to verify collapse/expand, but diagnostic
readers that depend on `tflexDiagnostics()` for all UI state cannot
detect or assert the panel state without walking the DOM.

Note: All three Phase 16 controls ([data-rail-collapse] collapse,
[data-ruler-page] click-to-jump, [data-rail-collapse] expand) passed
their functional tests — every click produces the correct state change,
no silent no-ops were found. The `[data-rail-expand]` / `.rail-tab-expand`
selector pair does not exist as separate elements; the same
`[data-rail-collapse]` button handles both collapse and expand via
conditional icon rendering, which is a deliberate implementation choice
and not a defect.

Screenshot: N/A

Disposition: REJECTED - diagnostics field not required by any Phase 16 success criterion; DOM state is sufficient for verification and all 5 e2e tests pass without it.

---

## Cumulative total across all sessions

| Source | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|
| Phase 1 (ADV-001..007) | 2 | 2 | 3 | 7 |
| Phase 2 gate (ADV-008..012) | 1 | 3 | 1 | 5 |
| Final (ADV-013..018) | 2 | 4 | 0 | 6 |
| Full-sweep silence (ADV-019..023) | 1 | 3 | 1 | 5 |
| Deep-sweep final (ADV-039) | 1 | 0 | 0 | 1 |
| Bug-sweep adversarial (ADV-024..030) | 0 | 4 | 3 | 7 |
| Phase 16 gate (ADV-040) | 0 | 0 | 1 | 1 |
| **All phases** | **7** | **16** | **9** | **32** |

---

## Tools badge silence attack

Session label: `tools-badge-silence`. Ran against the production build
(`npm.cmd run build`; dist main + dist renderer launched with
`ELECTRON_RENDERER_URL=file://.../dist/renderer/index.html`). Harness:
`e2e/adversary-tools-badge-silence.cjs`.

No findings — all probes passed cleanly. Detailed results below.

### Probes performed

All probes target the `[data-tools-badge]` floating pill on the right edge of
the page view, which toggles the tools panel.

| # | Probe | Result | Detail |
|---|-------|--------|--------|
| 1 | Badge exists in DOM | PASS | `document.querySelector('[data-tools-badge]')` resolves |
| 2 | Badge click opens tools panel | PASS | `data-tools-open="true"`, `aria-pressed="true"`, palette header visible in DOM |
| 3 | Badge click closes tools panel | PASS | `data-tools-open="false"`, `aria-pressed="false"`, palette header removed from DOM |
| 4 | Badge persists after open/close cycle | PASS | Badge still present and clickable after each toggle |
| 5 | Rapid double-click (two clicks) | PASS | State internally consistent: `data-tools-open` matches `aria-pressed` matches palette visibility |
| 6 | Rapid 5-click | PASS | All three state signals agree after rapid sequence |
| 7 | Triple-click | PASS | Internal consistency maintained through odd number of toggles |
| 8 | Close via palette close button | PASS | `data-tools-open="false"`, `aria-pressed="false"`, badge persists |
| 9 | Arrow icon changes on toggle | PASS | ChevronLeft (`m15 18-6-6 6-6`) while closed, ChevronRight (`m9 18 6-6-6-6`) while open — two different icon paths confirmed |
| 10 | Ctrl+Shift+P keyboard shortcut | PASS | Confirmed working via Electron `webContents.sendInputEvent({keyCode:'P', modifiers:['ctrl','shift']})`; also confirmed via `webContents.send('menu-action', 'showToolsPalette')` IPC |

### Keyboard shortcut note

Playwright's `keyboard.press('Control+Shift+P')` does NOT trigger Electron
menu accelerators, because Playwright sends synthetic keyboard events to the
renderer's DOM event system, while accelerators are handled by Electron's
main-process native input event layer. This is a testing-infrastructure
limitation, not a product defect. The shortcut was confirmed working by:

1. **`webContents.sendInputEvent`**: `{type:'keyDown', keyCode:'P', modifiers:['ctrl','shift']}` successfully toggled the palette (`data-tools-open` flipped from `false` to `true`).
2. **Menu IPC**: `webContents.send('menu-action', 'showToolsPalette')` also correctly toggled the panel.

Both paths proved the handler (`setToolsPaletteOpen((v) => !v)`) and the
menu accelerator registration (`accelerator: "Ctrl+Shift+P"`) work correctly.

### No silent no-ops found

Every click on the badge produced a visible state change. The palette close
button maintains correct synchronization. No control failed to respond.

### No state desync found

All three state signals (`data-tools-open` on `.app-main`, `aria-pressed` on
the badge, palette element presence/absence in DOM) agreed after every probe
sequence including rapid clicks, keyboard toggles, and palette-close-button
interactions. The single React state variable (`toolsPaletteOpen`) drives all
three outputs, making desync structurally impossible.

### Conclusion

The `[data-tools-badge]` surface passes all adversarial probes. No findings
to report.

---

## Phase 18 gate — Watermark

Session label: `phase-18 gate`. Ran against the built dev bundle
(`dist/main/index.js` from `npm.cmd run build`, built after the Phase-18
sources; launched with the canonical `e2e/lib/launch.cjs` `launchApp` —
required read-only). Harnesses (all pass `node --check`):
`test-fixtures/tools/adv041_wm_api.cjs`, `adv041_tile.cjs`, `adv041_perf.cjs`,
`adv041_ui_dialog.cjs`, `adv041_ui_delete.cjs`, `adv041_ui_refresh.cjs`,
`adv041_ui_tools.cjs`, `adv041_textlayer.cjs`, `adv041_render_ui.cjs`,
`adv041_hugesize.cjs`, `adv041_extra.cjs`, `adv041_layout.cjs`,
`adv041_close.cjs`. `saveAs` was driven through a mocked
`dialog.showSaveDialog` (the renderer `saveAs(docId)` is dialog-driven).

## ADV-041: `tile:true` with a small positive font size freezes then crashes the app (unbounded tile placement loop)

- Session: phase-18 gate
- Suggested severity: HIGH

What I did:
1. API repro (1-page `form.pdf`): `window.tflex.engine.addWatermark('tl',
   {type:'text', text:'X', size:<s>, tile:true})` for a series of sizes,
   timing each call in a fresh app.
2. `node test-fixtures/tools/adv041_tile.cjs <size> form` for
   size 24, 4, 1, 0.5, 0.25.
3. UI repro: opened `report.pdf`, opened `[data-tool-id="watermark"]`, typed
   `0.25` into `[data-watermark-size]`, checked `[data-watermark-tile]`,
   clicked `[data-watermark-confirm]`, then polled renderer responsiveness.
   `node test-fixtures/tools/adv041_ui_tools.cjs crash`.

Expected:
- Any caller-supplied `size` must either be rejected with a typed
  `engine-error` (or clamped) or complete in bounded time without exhausting
  the process. The tile loop must cap the number of placements.

Actual:
- Measured single-page apply: size 24 = 20 ms, size 4 = 72 ms, size 1 = 1139 ms,
  size 0.5 = 4183 ms (cost scales ~size^-2: the staggered grid emits roughly
  270,000/size^2 placements, each 6+ operators, into one content stream).
- size 0.25: `addWatermark` never returns. The Electron process working set
  peaked at 4,569 MB and the renderer target closed; the driver reported
  `FATAL page.evaluate: Target page, context or browser has been closed`.
  Reproduced twice (API run and a second run sampling memory).
- UI repro (34-page report, size 0.25 + Tile): the renderer was already
  unresponsive 2 s after clicking Apply (evaluate timed out), and Electron
  working set reached ~2,875 MB before the harness was stopped. No typed
  error, no recovery.
- Root cause shape: `normalizeWatermarkSettings` only requires
  `size > 0` (settings.ts line 126) with no lower bound, and the tile loop
  (engine.ts ~2709-2721) has no placement cap. The dialog's `min={4}` is
  advisory only (`onChange` stores `Number(value)` and confirm copies it
  straight through), so this is reachable by a user typing `0.25`.
- The same missing upper bound lets `size: 1e9` bake (38 ms, no crash) —
  the watermark is then effectively off-page/invisible while still listed
  by `getWatermarks` (`screenshots/adv-041-size1e9-reopen.png`).

Screenshot: screenshots/adv-041-tile-size-025-before-apply.png (dialog with
size 0.25 + Tile checked, captured immediately before the freezing Apply).

Disposition: ACCEPTED -> DEF-217 (HIGH; unbounded tile placement loop - size 0.25 with tile froze the renderer and killed the target twice; needs a size lower/upper bound and a per-page placement cap)

---

## ADV-042: An invalid `range` is silently dropped and the watermark is applied to every page

- Session: phase-18 gate
- Suggested severity: MEDIUM

What I did:
1. Loaded the 34-page `report.pdf` into a fresh engine doc per case and called
   `addWatermark(docId, {type:'text', text:'RG', range:<value>})`.
2. `node test-fixtures/tools/adv041_wm_api.cjs ranges`.

Expected:
- A range the caller supplied but the normalizer cannot honour (start < 1,
  inverted, non-integer, non-numeric, NaN, wrong length) should fail loudly
  (`out-of-range` / `engine-error`), so the caller does not silently get a
  different scope than requested.

Actual:
- Every invalid range is dropped and the engine falls back to `[1, pageCount]`,
  so the watermark is baked onto all 34 pages. Returned `ok` each time
  (`getWatermarks` pages array = 1..34):
  - `[0,0]`, `[3,2]`, `[1.5,3]`, `["1",2]`, `[1,2,3]`, `[NaN,2]`,
    `[-5,-1]` -> all 34 pages, `ok:true`.
  - Only `[1,9999]` errors (`out-of-range`); `[1,1]` -> page 1; `[5,6]` -> pages 5-6.
- The watermark is baked irreversibly into page content, so a caller that
  mistyped a range (e.g. an inverted `[3,2]`) gets a whole-document stamp with
  no error. The dialog guards this path (it validates before confirming), so
  the exposure is direct `window.tflex.engine.addWatermark` callers/automation.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-218 (MEDIUM; a provided-but-invalid range must reject the payload, never be dropped - dropping silently applied the watermark to all 34 pages)

---

## ADV-043: Applied-watermark list overflows the dialog horizontally and pushes the actions ~3017 px below the viewport

- Session: phase-18 gate
- Suggested severity: MEDIUM

What I did:
1. Opened `report.pdf`, applied 50 watermarks via
   `engine.addWatermark(docId, {type:'text', text:'L<i>', size:24})`, reopened
   the dialog (`[data-tool-id="watermark"]`), and measured the layout.
   `node test-fixtures/tools/adv041_layout.cjs`.
2. Clicked one row's `[data-watermark-delete]` and polled both engine
   `getWatermarks` count and DOM row count for 12 s.
   `node test-fixtures/tools/adv041_ui_refresh.cjs 50`.
3. Earlier full pass: `node test-fixtures/tools/adv041_ui_dialog.cjs`.

Expected:
- The dialog body should scroll inside a fixed-height dialog; the footer
  (Cancel / Apply watermark) should stay on screen, and the content should
  not spill outside the dialog box. Deleting a row should refresh the list
  immediately.

Actual (viewport 1440x900):
- Initial: `.modal-dialog` is 460x836 at x=490, but `.modal-body` is 544 px
  wide at x=389 — i.e. the body is ~101 px wider than the dialog and spills
  out to the left of it. `.modal-dialog` scrollWidth 544 vs clientWidth 443
  (horizontal overflow), `.modal-body` computed `overflow: visible`. The wide
  `Pages 1, 2, ... 34` cell is the driver.
- The footer is at y=3017 (height 61) in a 900 px viewport, i.e. ~2117 px
  below the fold; `.modal-body` is 2932 px tall. The user must scroll the
  dialog ~2932 px to reach Apply/Cancel (after scrolling to the bottom the
  footer reaches y=791, so it is reachable, not lost).
- Delete refresh with 50 rows: engine `getWatermarks` reported 49 within
  500 ms, but the DOM still showed 50 rows / the deleted row's button until
  ~1500 ms (with 3 rows the list updated in <300 ms). A fast double-click on
  the same Delete button therefore fires a second delete and shows
  "Engine error: deleteWatermark: no watermark with id wm-1 found" — harmless
  but avoidable.

Screenshot: screenshots/adv-041-applied-50.png (list clipping/horizontal
scrollbar), screenshots/adv-041-applied-50-bottom.png (footer only visible
after scrolling 2932 px).

Disposition: ACCEPTED -> DEF-219 (MEDIUM; applied list must stay inside the dialog and a row delete must be single-flight so a double click cannot produce a not-found toast)

---

## ADV-044: Tiled watermarks scale superlinearly and bloat the file (100 tiled stamps: 101 s apply, 49.8 MiB file)

- Session: phase-18 gate
- Suggested severity: MEDIUM

What I did:
1. Opened the 34-page `report.pdf`, called
   `addWatermark(docId, {type:'text', text:'WM<i>', size:24, tile:true})`
   100 times, then `getWatermarks` and `saveAs` (mocked dialog).
   `node test-fixtures/tools/adv041_perf.cjs 100 24 1`.
2. Controls: `adv041_perf.cjs 10 24 1` and `adv041_perf.cjs 1 400 1`.

Expected:
- Repeated stamping should stay roughly linear and the app should not freeze
  for minutes; REQUIREMENTS.md ("the app never freezes during load"; 16 ms
  frame budget) is the bar.

Actual (34-page report, 33,028-byte source):
- 10 tiled watermarks: apply 1,067 ms, save 223 ms, file 6,039,272 bytes.
- 100 tiled watermarks: apply 101,437 ms (10 -> 1,020 ms, 90 -> 81,868 ms,
  100 -> 101,437 ms — clearly superlinear as each `addWatermark` re-scans all
  prior marker streams for the next id and each page's Contents array grows),
  `getWatermarks` 34 ms, save 2,161 ms, file 52,239,404 bytes (~49.8 MiB,
  ~1,580x the source). All 100 returned `ok`, 3,400 (watermark,page) streams.
- One watermark at size 400 tile on all 34 pages is cheap (26 ms, 41,827 bytes).
- The 101 s apply is a single IPC call; the renderer is blocked waiting and
  the UI is frozen for that period.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-220 (MEDIUM; needs a per-document watermark cap and the same placement cap so 100 tiled stamps cannot cost 101 s and 50 MiB)

---

## Phase 18 gate — negative results (attacks that did NOT reproduce)

These were probed and passed; listed so the team does not re-spend effort:

| Attack | Result |
|---|---|
| `addWatermark` with `size` 0/-5/NaN/Infinity, `opacity` -1/2/NaN, bad `color` `{r:2,g:-1,b:NaN}`, `x`/`y` NaN/Infinity/x-only/y-only, unknown `font`/`position` | Typed `ok` with the invalid optional field dropped to the documented default (preserve-if-valid). No IPC throw, no partial apply. |
| `type` unknown, `text` ''/missing, settings null/string, image with missing/empty `imageBytes`, truncated PNG (`Invalid typed array length`), random bytes / text-as-bytes (`SOI not found in JPEG`), 100 MB zero buffer | Typed `engine-error`; `getState().modified` stays false and `getWatermarks` stays empty — no partial application. |
| `text` = 100,000 chars | Applies in bounded time; `text` = 100,000 Chinese chars is rejected `engine-error: text is empty after encoding` with no partial state. |
| Delete path: `''`, `'wm-999'`, `null`, `undefined`, 7, `{}`, `[]`, `'wm-1 '`, `' wm-1'`, `'WM-1'`, `'__proto__'`, `'constructor'`, `'toString'`, `'wm-1\n'` | Every one returns a typed `engine-error`; real delete returns `ok`; second delete of the same id errors cleanly; no silent success. |
| Delete from a doc with two watermarks, add a third | Correct ids (`wm-2`,`wm-3`; no `wm-1` reuse while `wm-2` exists). |
| Undo/redo after apply, and after delete | `getWatermarks` follows exactly (apply -> listed, undo -> gone, redo -> listed; delete -> gone, undo -> listed, redo -> gone). `add-undo-add` yields `wm-1` again correctly. |
| Save/reopen identity | Two watermarks (`wm-1` on pages 1-2, `wm-2` on 1-34) survive `saveAs` + `loadDocument`: `getWatermarks` identical. After deleting `wm-1` and saving again, the file has 34 markers, all `wm-2`; no orphan `wm-1` marker remains anywhere in the bytes; file parses with pdf-lib (34 pages). |
| Text layer / no content corruption | `exportText` before 48,490 chars, after 48,966 (+476 = 34 x 14-char `INTEGRITY-MARK`); original text preserved; page count 34. Marker prefix count as expected. |
| Injection-style text (`%TFLEX-WATERMARK <base64url>`, `) Tj /F1 ... (`, `a(b)c<d>e%f`, `café 中文 ABC`) | Markers are hex/text-encoded, so no marker spoofing (still `wm-1` after save/reopen) and the saved PDF parses. Text with `\n`/`\t` is a typed `engine-error` (WinAnsi) after restore, no partial apply. |
| Save+delete race (ADV-008 shape) | Both calls are serialized by `_enqueue`: `saveAs` captures the pre-delete state to disk (`wm-1` present), then the delete applies in memory (`wm-1` gone, `modified:true`). This is correct snapshot semantics, not silent loss. |
| 50 watermarks: delete-row list refresh | Refreshes correctly (engine 49 at 500 ms, DOM 49 at ~1500 ms) — latency noted in ADV-043, not data loss. |
| Range "From" field after the inverted-range error | Does NOT reproduce the empty-field suspicion: after `From=5, To=2` -> error, `from` stayed `"5"`, `to` `"2"`; clearing From yields `"0"` (not empty); `-1` stays `-1`. The dialog stays open with the error shown. Screenshots: screenshots/adv-041-range-inverted.png, adv-041-range-cleared.png. |
| Annotation tool armed + watermark dialog | `activeTool` stays `highlight` while the dialog is open and after closing; no disarm, no no-op. |
| Control sweep (`[data-watermark-position]` x9, bold/italic/underline, font, size, text, opacity, tile preview, range-all enable/disable, text/image switch, confirm-empty validation) | Every control produced its promised state change; no silent no-ops found. |
| Tab switch / tab close mid-apply (tile size 4) | No crash, no desync; the modified-doc close is gated by the existing close prompt. |
| `size: 1e9` baked and reopened through the UI (pdf.js) | File opens, 34 pages, app responsive; the oversized glyph is effectively invisible. No crash. |
| `app.close()` with 50 watermarks on the doc | Closed in 138 ms (0 watermarks: 180 ms). No quit hang. |
| UI apply render + proxy refresh | A watermark applied through the dialog renders on the page and thumbnails immediately (`screenshots/adv-041-render-ui-applied.png`); `getWatermarks` lists it. |

**Total new findings: 4 (1 HIGH, 3 MEDIUM).**

---

## Phase 19 gate — annotation group in the CommandBar (MRU five + colour + all-tools dropdown)

Session label: `phase-19 gate`. Built the dev bundle first (`npm.cmd run build:renderer`,
`npm.cmd run build:node`) and ran two harnesses against it:
`node test-fixtures/tools/adv045_ann_group.cjs <hooks|click|keys|disabled|layout|motion|color|pen>`
and `node test-fixtures/tools/adv045_settings_mru.cjs`. Both pass `node --check`. Screenshots:
`screenshots/adv045-*.png`.

## ADV-045: Standard e2e specs still address the retired `.ann-toolbar` row for tools that now live only in the portaled menu; B2-port fails

- Session: phase-19 gate
- Suggested severity: HIGH

What I did:
1. Listed every current spec selector that arms an annotation tool
   (`rg 'data-tool="' e2e/*.spec.cjs`).
2. Measured what the old locators resolve to now, with the menu closed and
   open (`node test-fixtures/tools/adv045_ann_group.cjs hooks`):
   - menu closed: `.ann-toolbar button[data-tool="textbox"]` = 0,
     `...="note"` = 0, `...="rect"` = 0, `...="highlight"` = 1;
     `button[data-tool="note"]` = 0.
   - menu open: `.ann-toolbar button[data-tool="textbox"]` still 0;
     `button[data-tool="note"]` = 1 (the portaled menu row);
     `document.querySelector(".ann-toolbar [data-ann-dropdown-menu]")` = false
     (the menu is portaled to `document.body`, outside `.ann-toolbar`).
3. Ran one affected test for real:
   `npm.cmd run test:e2e -- e2e/regression_b_port.spec.cjs -g "B2-port" --timeout=45000 --reporter=line`.

Expected:
- REQUIREMENTS.md Phase 19 criterion 12: "Existing annotation e2e/unit specs that
  asserted `.ann-toolbar` are repointed to the new group and pass". Tools that
  left the visible five must be reachable through the new `[data-ann-dropdown-menu]`
  address in every spec that arms them.

Actual:
- B2-port fails: `TimeoutError: locator.click: Timeout 30000ms exceeded.
  waiting for locator('.ann-toolbar button[data-tool="textbox"]')`.
  textbox/note/rect/ellipse are no longer inside `.ann-toolbar` (only the five
  MRU buttons are) and the menu is portaled out of it, so those locators match
  zero elements whenever the menu is closed.
- Same zero-match class in the current standard suite (unmodified files):
  `e2e/regression_b_port.spec.cjs` B2-port (textbox, line 102), B4-port (note,
  line 115), B5-port (rect + note, lines 139/141), B21-port (rect + ellipse,
  lines 242/250), B22-port (textbox, line 309); `e2e/probe_190_triage.spec.cjs`
  T6 (`button[data-tool="note"]`, line 224), `e2e/probe_190_triage_r2.spec.cjs`
  line 78 and `e2e/probe_190_triage_r3.spec.cjs` line 63 (callout).
- Only `e2e/sweep_annotations_sign.spec.cjs` and `e2e/phase14_2_verify.spec.cjs`
  were repointed (they now scope `[data-ann-tools-visible]` vs
  `[data-ann-dropdown-menu]`); the rest were missed, so the phase gate cannot be
  green.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-226 (HIGH; the phase requires the existing annotation specs to be repointed to the new group/menu - the tools that moved into the portaled menu are unreachable from the old `.ann-toolbar button[data-tool=...]` selectors)

---

## ADV-046: Clicking the page while the tools menu is open both dismisses the menu and performs the armed tool's placement

- Session: phase-19 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/tools/adv045_ann_group.cjs click`.
2. (a) armed `note` from the menu, reopened the menu, then single-clicked a blank
   area of the page (`pageBlankPoint` fracY 0.35 -> x=821,y=647).
3. (b) armed `rect` from the menu, reopened the menu, then dragged a 140x80 box
   on the page.
4. (c) armed `highlight` from the visible five, reopened the menu, single-clicked
   the page.

Expected (per the phase's own close contract and the overlay lesson class):
- A click on the document whose only job is to dismiss the open menu must close
  the menu and NOT start an annotation gesture (the menu's window pointerdown
  handler closes it, but the pointerup/click must not also reach the tool).

Actual:
- (a) `annotationsBefore:0, annotationsAfter:0, noteEditorOpen:1,
  noteActionBar:0, menuOpenAfter:0, activeTool:"note"` — the dismissing click
  opened the sticky-note editor.
- (b) `annotationsBefore:0, annotationsAfter:1, menuOpenAfter:0` — the same drag
  that closed the menu committed a rect annotation.
- (c) highlight single click: `annotationsBefore:1, annotationsAfter:1` (no new
  annotation — highlight needs a text drag), `menuOpenAfter:0`.
- Root cause: `AnnotationToolbar`'s outside-close uses a bubble-phase
  `window.addEventListener('pointerdown', ...)` that only calls
  `setMenuOpen(false)`; it neither consumes nor cancels the gesture, so the
  document overlay's own pointerdown/pointerup/click run to completion.
- Same click on a CommandBar button does both too (measured): Pan one click ->
  `data-hand-active` false->true and menu closed; Edit one click ->
  `aria-pressed` false->true and `.edit-toolbar` attached.

Screenshot: screenshots/adv045-color-and-menu.png (both surfaces), N/A for the page gesture

Disposition: ACCEPTED -> DEF-227 (MEDIUM; a click that dismisses the menu must not also perform the armed tool's placement gesture)

---

## ADV-047: Tab-focusing a menu row and pressing Enter arms the wrong tool

- Session: phase-19 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/tools/adv045_ann_group.cjs keys`.
2. Opened the menu, pressed Tab twice so focus landed on the Highlight row
   (`activeElement` = `button.ann-tool-menu-row[data-tool="highlight"]`), while
   the keyboard highlight (`.ann-tool-menu-row-highlight`) stayed on Select.
3. Pressed Enter, read `window.tflexDiagnostics().activeTool`.

Expected:
- Enter on the focused menu row arms that row (Highlight). The two keyboard
  models (Tab focus vs Arrow-key highlight) should not disagree.

Actual:
- `keys-tab-then-enter {"initialHighlight":"select","focusedRow":"highlight",
  "keyboardHighlight":"select","activeTool":null,"menuOpen":0}` — Enter armed
  Select (the container's `onMenuKeyDown` used `MENU_TOOLS[menuIndex]`, still 0),
  not the focused Highlight row, and the menu closed. A keyboard-only user who
  Tabs to a row and presses Enter gets the wrong tool armed (here a no-op back to
  Select). Arrow-key + Enter on the container works correctly
  (`keys-enter {"highlighted":"highlight","activeTool":"highlight"}`).

Screenshot: N/A

Disposition: ACCEPTED -> DEF-228 (MEDIUM; Enter must arm the focused row, not the container's arrow-highlight index)

---

## ADV-048: The annotation group is clipped offscreen at the app's minimum window width (640 px)

- Session: phase-19 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/tools/adv045_ann_group.cjs layout` — resized the window to
   1440x900, 1000x800, 820x700, 640x600 via `BrowserWindow.setSize` and measured
   `.toolbar` and `[data-annotation-toolbar]` rects.
2. Confirmed the window minimum is 640x480 (`src/main/window.ts` `minWidth: 640`).
3. Screenshot at 640: `screenshots/adv045-layout-640.png`.

Expected:
- REQUIREMENTS.md Phase 19 criterion 1: the tools render inside the CommandBar
  "no overlap, no clipped page slot", and every group stays reachable. 640 px is
  the app's own documented minimum.

Actual:
- 640x600: `innerWidth 640`, `.toolbar` rect left=220 right=752 width=532
  (`overflowX: hidden`), `[data-annotation-toolbar]` rect
  `{left:538, right:734, top:140, bottom:176, w:195}` ->
  `groupReachable:false`, `groupClipped:true`. The group extends 94 px past the
  right window edge and 112 px of the toolbar box is offscreen; the dropdown
  arrow (rightmost) is unreachable. The bar wrapped to 3 rows (`toolbarH:141`).
- 820/1000/1440: group right 804/984/1424 <= innerWidth, reachable.
- Measured `.toolbar` `scrollWidth` vs `clientWidth`: 1431/1220 at 1440,
  1013/780 at 1000, 787/600 at 820, 711/530 at 640 — the bar's content box
  always reports horizontal overflow (the widest real descendant, the annotation
  group, still fits at >=820, so the 640 case is the actionable one).
- No gap/overlap after the row was removed: toolbarBottom=97, scrollerTop=97,
  pageTop=125 and `--ann-toolbar-h` = "" in light/dark/frosted (negative below).

Screenshot: screenshots/adv045-layout-640.png, adv045-layout-820.png

Disposition: ACCEPTED -> DEF-229 (MEDIUM; the new group must stay reachable at the 640 px minimum window width)

---

## ADV-049: Arming a tool with a read-only settings.json throws unhandled EPERM rejections and silently does not persist

- Session: phase-19 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv045_settings_mru.cjs` — scenario g writes `{}` to
   a fresh `--user-data-dir/settings.json`, runs `attrib +R` on it, launches the
   dev build, opens report.pdf, installs an `unhandledrejection` listener, arms
   Highlight (the new MRU write path), then reads back the file.

Expected:
- Arming a tool is a UI action; a persistence failure must not surface as an
  unhandled rejection, and the user should not be told nothing when their MRU
  order silently fails to save.

Actual:
- `rejections`/`pageErrors` captured two entries:
  `Error invoking remote method 'settings:addRecent': Error: EPERM: operation not
  permitted, rename '...\settings.json.tmp' -> '...\settings.json'` (file open)
  and `Error invoking remote method 'settings:save': ... EPERM ... rename` (the
  tool arm). `activeTool:"highlight"`, `alive:true`, `settingsUnchanged:true` —
  no crash, the tool arms, but the MRU order silently does not persist and the
  renderer logs unhandled promise rejections (`App.tsx` does
  `void window.tflex.saveSettings(s)` with no catch).

Screenshot: N/A

Disposition: ACCEPTED -> DEF-230 (LOW; a failed settings write must not surface as unhandled rejections - fail loud, tell the user)

---

## ADV-050: The frosted tools menu has no backdrop blur while its sibling colour popover does

- Session: phase-19 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv045_ann_group.cjs motion` and
   `... color` (real theme toggle, default frosted), read
   `getComputedStyle(...).backdropFilter` on `[data-ann-dropdown-menu]` and
   `.color-popover`.

Expected:
- REQUIREMENTS.md Phase 14/14.1: "consistent frosted glass across title bar, side
  panels, and tool panels"; the sibling floating popover `.color-popover` gets
  `blur(24px) saturate(1.2)` in frosted.

Actual:
- frosted: `.ann-tool-menu` `backdropFilter:"none"` (and `-webkit-` none);
  `.color-popover` `backdropFilter:"blur(24px) saturate(1.2)"`. The CSS frosted
  blur list at `styles.css` ~line 8656 includes `.titlebar-menu-popover`,
  `.theme-toggle-popover`, `.color-popover` but NOT `.ann-tool-menu`, which only
  gets the surface/border/shadow rule. The menu is the one frosted floating
  surface without the glass blur. Border is present in all three themes
  (light `rgb(203,213,225)`, dark `rgb(46,53,61)`, frosted
  `rgba(255,255,255,0.35)`), so no border loss and no double-blur.

Screenshot: screenshots/adv045-theme-frosted-menu.png

Disposition: ACCEPTED -> DEF-231 (LOW; the frosted menu surface must match its sibling popover's blur treatment - Phase 19 consistency)

---

## Phase 19 gate — negative results (attacks that did NOT reproduce)

| Attack | Result |
|---|---|
| Duplicate `data-tool` hooks while the menu is open (item 1) | `document.querySelectorAll('[data-tool="highlight"]')` = 2 (visible first, menu row second, DOM order measured); `document.querySelector` returns the VISIBLE button (`qsIsVisible:true`); zero duplicate `id` attributes; Playwright strict locator resolves to 2 and `locator('[data-tool="highlight"]').click()` throws `strict mode violation ... resolved to 2 elements`. No current spec trips it: `sweep_annotations_sign.spec.cjs` scopes `[data-ann-tools-visible]` vs `[data-ann-dropdown-menu]`, and the unscoped `phase13_qa_sweep.spec.cjs:431 [data-tool="highlight"]` resolves to 1 with the menu closed. The duplicate hook itself is mandated by REQUIREMENTS.md ("every tool button (visible and in the dropdown) keeps `data-tool`"), so this is a latent automation hazard, not a spec violation. |
| Clicking CommandBar Pan / Edit while the menu is open (item 2) | One real click both closes the menu and activates the button (Pan `data-hand-active` false->true, Edit `aria-pressed` false->true + `.edit-toolbar` attached); no double-toggle, no swallowed click. |
| Keyboard wrap + focus (item 3) | ArrowDown from Select wraps past Note back to Select; ArrowUp at Select wraps to Note; Escape while a row is highlighted closes and focuses the toggle; reopening focuses the menu container; Tab stays inside the menu (select -> highlight -> underline -> strikeout -> ... -> note) and only after the last row escapes to `.titlebar-menu-button`; ArrowDown on the focused toggle opens the menu; Enter on the container-arrow-highlighted row arms it and returns focus to the toggle. Exit unmount measured at 441 ms after Escape with `pointer-events:none` on the exit preset. |
| Disabled/blocked states inside the menu (item 4) | Edit mode open: Select enabled, the other 10 rows `disabled`/`aria-disabled` with the "Edit mode is open" tooltip; Pan active: all 11 disabled with the "Pan mode is on" tooltip. Arming rect from the menu marks it active in BOTH places (`aria-pressed:true` first in the visible five, `aria-checked:true` + check icon in the menu). |
| MRU abuse via settings.json (item 5, a-f) | 100 valid ids -> sanitised to 6, visible default five; garbage strings -> `['select']`; duplicates -> `['ink','select']`; non-array -> field dropped; `__proto__`/`constructor` -> dropped; non-canonical 6-id order -> visible `['note','callout','arrow','ellipse','rect']`. App launched, opened report.pdf, stayed interactive, no crash/rejection in every case. |
| Layout offsets / retired row (item 6) | toolbarBottom=97, scrollerTop=97, pageTop=125 identical in light/dark/frosted; `--ann-toolbar-h` is empty; no overlap and no gap. The 820/1000/1440 widths keep the group reachable. |
| Motion tokens / theme switch (item 7) | Arrow rotation transition is `0.2s cubic-bezier(0.4,0,0.2,1)` (`--motion-duration-fast` / `--motion-ease-standard`); menu enter is the `springQuick` spring (scale 0.97->1.0004 overshoot, opacity 0->1 in ~130 ms, settle ~330 ms); row hover uses `var(--motion-duration-fast)`; switching the theme while the menu is open leaves it open, visible, 11 rows, in every theme. |
| Colour edge cases (item 8) | Select armed -> `[data-ann-color]` count 0; arming callout FROM THE MENU -> swatch present and visible, `data-color-current` correct. Menu + colour popover coexist only when driven programmatically; a real swatch/toggle click closes the other first (pointerdown handlers), so the 86703 px^2 overlap with equal `z-index:50` (later-mounted popover on top, `elementFromPoint` at its centre = `.color-pad`) is not reachable by a user. |
| Pen-width row (item 8b) | Ink armed -> `[data-pen-width-row]` present; clicking width 5 moves `aria-pressed` from 3 to 5; the menu stays open; no no-op. |
| Silence attack on the new controls | Every new control (5 visible tool buttons, swatch, dropdown toggle, 11 menu rows, 3 pen widths) produced its promised state change when clicked; no silent no-op found. |

**Total Phase-19-gate findings: 6 (1 HIGH, 3 MEDIUM, 2 LOW).**

---

## Phase 20 gate — animation standard (morphing surfaces, animated resizes, token-driven exits)

Session label: `phase-20 gate`. Ran against the production dev bundle
(`npm.cmd run build`; dist main + dist renderer launched through the canonical
`e2e/lib/launch.cjs`). One harness: `test-fixtures/tools/adv051_phase20.cjs`
(sections `spam`, `reopen`, `midanim`, `duprepro`, `dupctrl`, `sigkey`,
`searchkey`, `edges`, `perf`, `ghosts`, `toolboxexit`, `stacking`). Every
harness passed `node --check` before running. Screenshots `screenshots/adv051-*.png`.

## ADV-051: Held Ctrl+Enter during the edit editor's exit window duplicates the committed text box (up to 10 boxes from one commit)

- Session: phase-20 gate
- Suggested severity: HIGH

What I did:
1. `node test-fixtures/tools/adv051_phase20.cjs duprepro`
   - Baseline on report.pdf: `.edit-box`=0, `tflexDiagnostics().engineState.textBoxes`=0.
   - Entered Edit content -> box tool, dragged a 180x60 box, typed `DUP-A`,
     clicked Apply (`[data-edit-confirm]`). Read state immediately:
     `{boxes:1, editors:1, textBoxes:1}`.
   - Held Ctrl+Enter (10 presses at ~15ms) while the editor was still exiting,
     then waited 1.8s and read state: `{boxes:10, editors:0, textBoxes:10}`.
2. Control run `... dupctrl` (fresh launch): commit one box, wait 1.5s for the
   exit to finish, then the same 10 Ctrl+Enter presses:
   `rightAfter {boxes:1,textBoxes:1}`, `settled {boxes:1,textBoxes:1}`,
   `afterKeys {boxes:1,textBoxes:1}`.

Expected:
- One commit creates one text box. A key-repeat after the commit must not
  re-fire the stale commit closure. This is exactly what the Phase-20
  `inert={!isPresent}` guard exists for: `AnnotationOverlay`'s textbox/note
  editors carry it and did NOT duplicate (ADV below is the contrast).

Actual:
- After the commit, `document.activeElement` is still the editor's
  `TEXTAREA.edit-inline-textarea` (`inEditor:true`), because the Apply button's
  `onMouseDown` preventDefault keeps focus on the textarea. `EditInlineEditor`
  renders its `TfBar` with NO `inert` and no `useIsPresent`, so during the
  ~200-350ms exit window every Ctrl+Enter re-fires the old `onCommit` closure
  (`EditOverlay.tsx:1544` -> `onCommitTextBox`). Nine extra boxes were created
  from one commit; `engineState.textBoxes` reads 10, so a save writes all ten.
- The annotation textbox (which HAS `inert={!isPresent}`,
  `AnnotationOverlay.tsx:2445/2675/2802/3065`) did not duplicate:
  `annBefore:0 -> annAfter:1` under the same Ctrl+Enter hammer.

Screenshot: screenshots/adv051-midanim-edit-keyrepeat.png

Disposition: ACCEPTED -> DEF-235 (HIGH; the exiting inline editor must be inert like the annotation toolboxes - a held Ctrl+Enter re-fired the commit closure and produced 10 text boxes from one)

---

## ADV-052: Held Enter during the signature pending view's exit window commits up to 11 signature placements from one Confirm click

- Session: phase-20 gate
- Suggested severity: HIGH

What I did:
1. `node test-fixtures/tools/adv051_phase20.cjs sigkey`
   - Opened Sign -> Type, created a typed signature, picked it, clicked the
     page to spawn the pending placement.
   - Read state: `{signatures:0, placements:0, pending:1}`.
   - Clicked `[data-sig-pending] [data-sig-action="confirm"]`, then held Enter
     (10 presses at ~15ms) during the pending view's exit.
   - Read state after 1.8s: `{signatures:11, placements:11, pending:0}`.
   - Focus right after Confirm: `{tag:"BUTTON", action:"confirm", inPending:true}`.
2. `... toolboxexit` measured the same exiting surfaces: `[data-sig-pending]`
   and `[data-sig-action-bar]` exit with `pointer-events:none` but
   `inert:[false]` for their whole exit/ghost window (~230ms, 14-15 ghost frames).

Expected:
- One Confirm commits one signature placement. A held/repeated Enter must not
  re-fire the stale `onConfirm`; the Phase-20 `inert` guard on exiting
  keyboard-bearing roots should block it (as it does for the annotation textbox).

Actual:
- `PendingPlacementView` (`SignaturesOverlay.tsx:665`) and `SignatureActionBar`
  (`SignaturesOverlay.tsx:722`) are `TfBar`s with no `inert`; the exiting bar
  stays keyboard-live, the Confirm button keeps DOM focus, and each key-repeat
  Enter calls the stale `onConfirm` again. Eleven overlapping placements are
  committed at the same rect; the screenshot shows the `SIGKEY` glyphs
  over-printed. This is document corruption (a save bakes 11 signatures).

Screenshot: screenshots/adv051-sigkey.png

Disposition: ACCEPTED -> DEF-236 (HIGH; the exiting signature pending view must be inert - a held Enter committed 11 placements from one Confirm)

---

## ADV-053: Re-opening a morphing menu mid-exit grows the surface from its own mid-exit box, not the trigger (morph measured off a transformed rect)

- Session: phase-20 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/tools/adv051_phase20.cjs reopen` — for each of the three
   morph menus: open, settle 500ms, press Escape, wait 80ms (mid-exit), click
   the trigger again, and sample every frame (rect + `data-tf-morph` +
   `transform-origin`). The first frame whose `data-tf-morph` is `in` is the
   re-open's first morph frame.
   - theme: trigger `[1154.4, 6.7, 131.6, 28]`; first `in` frame
     `[1130.9, 23.3, 155.1, 62.1]` -> deviation **34.1px**.
   - titlebar: trigger `[8, 9.7, 28, 22]`; first `in` frame
     `[5.9, 21.5, 85.5, 130.3]` -> deviation **108.3px**.
   - ann: trigger `[1387.3, 53, 28, 32]`; first `in` frame
     `[1343.3, 69.2, 72.1, 137.4]` -> deviation **105.4px**.
2. `... spam` (26 trigger clicks at 30-80ms): 13 re-enters detected per menu,
   **12/13 with a first-frame deviation > 2.5px** (theme max 59.8px, titlebar
   67.4px, ann 97.4px). The first open from fully closed had deviation 0.0px.

Expected:
- Phase-20 criterion 1: the surface must morph from the trigger's rect with no
  gap, on every open — including a re-open during the close morph (a fast
  double-click on the trigger).

Actual:
- `useMorphPreset` (`components/motion/useMorphPreset.ts:41`) measures
  `surface.getBoundingClientRect()` in a layout effect keyed on `open`. When
  `open` flips true while the exit is still in flight, the element still carries
  the exit transform, so `morphFromTrigger` computes x/y/scale from the
  shrunken rect and the enter continues from the exit's mid-state instead of the
  trigger box. The surface pops in already large and off the trigger seam.

Screenshot: screenshots/adv051-reopen-theme.png, adv051-reopen-titlebar.png, adv051-reopen-ann.png

Disposition: ACCEPTED -> DEF-237 (MEDIUM; a menu re-opened mid-exit must morph from the TRIGGER rect, not the transformed mid-exit rect - measured 34-108px first-frame deviation)

---

## ADV-054: The exiting search bar is not inert — focus stays in it and Tab reaches it during the ghost window

- Session: phase-20 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv051_phase20.cjs ghosts` — opened Ctrl+F,
   focused the input, typed `AB`, pressed Escape, sampled the exit:
   `exitingFrames:21, ghostFrames:14` (~230ms at opacity 0),
   `pointerEvents:["none"]`, **`inert:[false]`**,
   `focusAfterEscape:{tag:"INPUT", inSearch:true}` (focus stays in the exiting
   input).
2. Pressed Escape, waited 60ms, pressed Tab: `activeElement` was a
   `BUTTON` inside the exiting `.search-bar` (`inSearch:true`).
3. `... searchkey` — typed `ZZ` 40ms after Escape; the input value stayed `AB`
   (the keys did not change the value), so the practical impact is focus /
   assistive-tech reachability, not stray input.

Expected:
- The dispatch states the Phase-20 exit treatment adds `inert` to the exiting
  keyboard-bearing search bar (as `AnnotationOverlay` does). A node that is
  fading out with `pointer-events:none` should also leave the focus order.

Actual:
- `SearchBar.tsx` renders `TfBar` with no `useIsPresent`/`inert`, so for the
  ~230ms ghost window the input keeps focus and Tab can move focus into the
  exiting, pointer-disabled bar. Not a crash; an a11y/focus leak.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-238 (LOW; the exiting search bar must be inert so focus/Tab cannot enter it)

---

## ADV-055: The morph exit's first frame still reports pointer-events:auto (one hit-testable frame per exit)

- Session: phase-20 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv051_phase20.cjs spam` — sampled each menu every
   frame through 26 rapid open/close toggles. Across 93 frames tagged
   `data-tf-morph="out"` per menu, **13 reported `pointer-events:auto`** (one
   per exit); the first out frame reads `pe:"auto", op:0.965`, the next reads
   `pe:"none"`. `outPeValues:["auto","none"]` for all three menus.

Expected:
- The tfPresets contract says the exit pins `pointer-events:none` on the FIRST
  exit frame so a closing surface can never swallow a click (DEF-087/088/090).

Actual:
- Motion applies the discrete `pointerEvents` one frame after the exit variant
  starts, leaving a ~16ms hit-testable window at the start of every close. The
  `TfBar` family measured `none` on all opacity<0.99 frames, so this is a
  one-frame window specific to the morph exit path as sampled.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-239 (LOW; the DEF-087/088/090 guard requires pointer-events:none on the FIRST exit frame - 13 out-frames measured with auto)

---

## ADV-056: Phase-20 palette width animation and reduced path use legacy literal tokens instead of the Phase-15 motion tokens

- Session: phase-20 gate
- Suggested severity: LOW

What I did:
1. Static audit of the Phase-20 code paths (criterion 7, "all new animations
   resolve from the motion tokens; no hardcoded durations/easings/scales") and
   token presence.

Expected:
- Every new Phase-20 animation reads the `--motion-*` tokens; the two new
  tokens exist in `animations.css`, the `motionTokens.ts` mirror, the reduced
  block and the preset catalog.

Actual:
- The two new tokens exist and are consumed (negative results below).
- Literals on Phase-20 paths:
  - `src/renderer/styles.css:5818-5819` and `:8959-8960` — the new palette
    list<->grid width transition reads `var(--panel-slide-duration, 150ms)` /
    `var(--panel-slide-ease, cubic-bezier(0.16, 1, 0.3, 1))`, i.e. the legacy
    Phase-14.2 pair (declared as literals at `styles.css:186-187`) with literal
    fallbacks, not the `--motion-*` set.
  - `src/renderer/components/motion/TfMotion.tsx:106` — the reduced-motion
    fallback in `useTfPreset` hardcodes `duration: 0, ease: "linear"` (the
    `TfMorph` reduced path uses `msToSeconds(MOTION_DURATION.reduced)`).
  - `src/renderer/components/motion/tfPresets.ts:283` — `MORPH_MIN_SCALE = 0.01`
    (documented guard).
  - The reduced-motion tooltip override uses `var(--tf-motion-fast)` /
    `var(--tf-ease-fast)` (legacy band).
- The dispatch itself names `--panel-slide-*` for the palette resize, so this
  may be intentional; it is recorded because criterion 7 says the Phase-15
  token set is the only source.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-240 (LOW; criterion 7 - the palette width/reduced path and the TfMotion/TfPresets literals must resolve from the motion tokens)

---

## Phase 20 gate — negative results (attacks that did NOT reproduce)

| Attack | Result |
|---|---|
| Mid-animation option click (theme popover) | Clicking `[data-theme-option="dark"]` 55ms into the enter morph applied the theme exactly once (`data-theme:"dark"`) and closed the popover (`popoverCount:0`); no double-toggle. |
| Mid-animation row click (ann menu) | Baseline tool `null`, clicked `[data-tool="rect"]` 50ms into the enter morph -> `activeTool:"rect"`, menu closed (`menuCount:0`). Armed exactly once (a double-fire would have toggled it back to `null`). |
| Tab click mid-resize (Sign modal) | Clicked Type then Saved 70ms apart mid-resize: final `panes:["in"]`, `paneCount:1`, `outPanes:0`, `frameH:179`, `frameTr:"none"`, active tab `Saved (0)`. No stranded out-pane, no stuck transform. |
| Escape mid-morph | Escape 50ms into the theme morph closed it (`popoverCount:0`, `aria-expanded:"false"`). |
| Annotation textbox Ctrl+Enter key-repeat (inert present) | `annBefore:0 -> annAfter:1` under 8 Ctrl+Enter presses during the exit; `inert` guard holds. |
| Edge clamping at 640x520 | theme `[310,35.7 -> 486,165]`, titlebar `[4,32.7 -> 264,512.7]`, ann `[415.3,156 -> 615.3,520]` — all inside the viewport (`insideViewport:true`); normal-open first-frame deviation 0.0px for all three. |
| Window resize mid-morph | Theme popover open, resized 640x520 -> 900x700 45ms in: final `x:570..746`, `tr:"none"`, inside 900x700. No stranded surface or stale transform. |
| Window resize mid-Sign-resize | Resized 50ms into a tab switch: `frameH:262`, `frameW:527`, `outPanes:0`. Settles cleanly. |
| 60fps frame times (15 runs: morph open/close, sign resize, palette resize, swap x light/dark/frosted) | Every run p50 **16.7ms**, p95 <= **16.8ms**, max **16.9ms**, **0** frames >33ms; only 1-4 frames at 16.8ms (vsync jitter). Frosted is identical to light/dark — no 30fps-class defect (`screenshots/adv051-perf.json`). |
| Ghost hit-test / click-through (search bar) | Exit frames `pointer-events:["none"]`; `elementFromPoint` at the bar's centre during the exit returned a non-search element (`inSearch:false`); strict locator saw exactly 1 search bar after a ghost cycle; no duplicate `id`s. |
| Ann menu exit hooks | While the exiting menu twin was present: `[data-ann-dropdown-menu]` count 1, zero duplicate ids, exiting `pointer-events:none`; a strict Playwright click timed out on actionability (no strict-mode ambiguity). |
| Two floating surfaces / modal stacking | Real clicks never left two floating menus open at once (clicking the theme toggle closed the ann menu and opened the theme popover); a modal dialog blocked a click on the theme toggle behind it (`behind.clicked:false`), dialog stayed open, no menu opened behind it. |
| Frosted blur / stacking | `:root[data-theme="frosted"] .ann-tool-menu` computes `backdrop-filter: blur(24px) saturate(1.2)`, `z-index:50`, `position:fixed`; `elementFromPoint` at its centre resolves inside the menu (`inMenu:true`) — DEF-231 fixed, no surface painting under the page. |
| Theme switch mid-morph | Switching to dark 50ms into the morph applied `data-theme:"dark"` and unmounted the popover (`themePop:0`). |
| New tokens present | `--motion-duration-content: 80ms` and `--motion-opacity-surface: 0.85` exist in `animations.css:36/74`, in `motionTokens.ts` (`MOTION_DURATION.content`, `MOTION_OPACITY.surface`), in the reduced-motion block (`animations.css:102`), and are consumed by `tfPresets.ts` (`MOTION_OPACITY.surface` in `morphFromTrigger`, `MOTION_DURATION.fast` for the morph tween). |
| Exit pointer-events on the remaining TfBar toolboxes | `[data-sig-pending]`, `[data-sig-action-bar]`, `[data-stamp-type-editor]` all measured `pointerEvents:["none"]` across their exit and ghost frames (the inline `pointerEvents:"auto"` on the sig surfaces does NOT defeat the exit guard); none are `inert`. |

**Total Phase-20-gate findings: 6 (2 HIGH, 1 MEDIUM, 3 LOW).**

## Phase 21 gate — text properties panel

Session label: `phase-21 gate`. Ran against the dev bundle
(`dist/main/index.js` + `dist/renderer/index.html`, built 2026-09-19 20:27, after the
Phase-21 sources at 20:14). Harness: `test-fixtures/tools/adv057_phase21.cjs`
(sections `geom | patch | patchseq | resurrect | panel | layout | annot | persist |
perf | silence`), launched through the canonical `../../e2e/lib/launch.cjs`. Screenshots
`adv057-*.png`; perf data `screenshots/adv057-perf.json`.

## ADV-057: At the minimum window width the Tools palette covers the docked text-properties panel (15 enabled controls unreachable)

- Session: phase-21 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/tools/adv057_phase21.cjs layout` — opened `report.pdf`, armed the
   text-box tool so `[data-text-panel]` is open, then opened the Tools palette and
   measured at 640x520, 820x640 and 1440x900.
2. At 640x520 the text panel rect is `[left 220, right 468]` (248px) and the Tools palette
   rect is `[left 296, right 640]` (344px). Horizontal overlap = `min(468,640) -
   max(220,296)` = **172px**. The palette's z-order is above the panel.
3. Occlusion probe: for every ENABLED panel control, `document.elementFromPoint` at its
   centre resolved outside the panel. **15 enabled controls were covered** by the palette,
   each resolving to a `.tools-palette-entry*` element: Font Family select (`rect 335,114`),
   Size input (`335,198`), three font-style buttons (`294/326/358,230`), text Colour
   (`413,263`), Highlight (`362,295`), the highlight-None button (`402,295`), Clear
   formatting (`230,326`), two alignment buttons (`294/326,390`), Line-spacing input
   (`335,422`), a list button (`294,454`) and an indent button (`419,486`).
4. At 820x640 and 1440x900 the overlap is 0 and `coveredControls` is empty.
5. `screenshots/adv057-layout-640x520.png` shows the semi-transparent Tools drawer sitting
   over the panel's Family/Size/Colour/Highlight/Paragraph controls.

Expected:
- The Phase-21 contract is "the page adjusts, never overlapped" (REQUIREMENTS.md Phase 21
  C1: the page view reflows without overlap or clipping; the same coexistence contract the
  Tools panel follows). The text panel is a docked column and must remain reachable when
  the Tools drawer is also open at the minimum supported window width.

Actual:
- At 640px the right-anchored 344px Tools drawer extends 172px left of the page column and
  covers the right half of the 248px text panel. The controls are not merely overlapped in
  z-order - real hit-tests land on palette rows, so they cannot be clicked. The
  CommandBar in the remaining 172px column also wraps to `height 316.7` of the 476px
  viewport, squeezing the page to 50px wide.

Screenshot: screenshots/adv057-layout-640x520.png

Disposition: ACCEPTED -> DEF-241 (MEDIUM; at the minimum window width the Tools palette must not cover the docked text panel - 15 enabled controls were unreachable at 640px)

## ADV-058: `engine.updateTextBox` with an empty (or all-unknown-key) patch returns ok and marks the document modified

- Session: phase-21 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv057_phase21.cjs patch` — created a box through the UI,
   saved the document (so `modified:false`), then called the exposed engine directly:
   `await window.tflex.engine.updateTextBox(docId, id, {})` and
   `await window.tflex.engine.updateTextBox(docId, id, { evil: 1, another: "x" })`.
2. Result for both: `{"ok":true,"stateModified":true}` with the box unchanged. On the same
   clean document, a normal valid patch also returns `stateModified:true`.

Expected:
- The dispatch defines the patch as preserve-if-valid per field. A patch that supplies no
  valid field changes nothing and should not dirty the document. (`validateTextStyleFields`
  ignores unknown extra keys, so an all-unknown-key patch validates to the empty set.)

Actual:
- `_updateTextBoxImpl` (src/main/services/engine.ts:2084-2110) always runs
  `doc.undoStack.push(snapshot); doc.redoStack = []; doc.modified = true;` even when the
  validated patch is empty, so a no-op patch returns `ok` with `stateModified:true` and
  adds a do-nothing undo step. The panel never emits an empty patch, so this is latent
  (reachable only programmatically today), but any future caller that sends a patch built
  from a field set that is all-unknown will dirty a clean document and grow its undo stack
  with no visible change. No data is lost; the change is silent state, not a typed error.

Screenshot: N/A

Disposition: ACCEPTED -> DEF-242 (LOW; an empty or unknown-key-only patch must not dirty the document - ok with no mutation for an empty patch, a typed error for unknown keys)

---

## Phase 21 gate - negative results (attacks that did NOT reproduce)

| Attack | Result |
|---|---|
| Geometry shift, panel OPEN + settled (text box) | Page shifts exactly +248 (`main.left 220 -> 468`, `page.left 244 -> 492`, `--tf-text-w:248px`); the created `.edit-box` overlay landed at `dx:0, dy:0` from the drag start and the editor at `dx:0, dy:-2`. No pre-panel x-offset assumption in the hit-tests (`pagePoint` reads `root.getBoundingClientRect()` per event). |
| Geometry shift, panel OPEN + settled (annotation textbox) | Editor rect matched the drag start exactly (`dx:0, dy:-0.1`); committed annotation rect `x 171.36` consistent with the drawn gesture. |
| Geometry shift, rail COLLAPSED + panel open | `--tf-rail-w:48px`, page reflowed; editor delta `dx:0, dy:-2`. No stale offset. |
| Panel CLOSING mid-gesture (Escape during a committed-box move drag) | Panel closed (`[data-text-panel-open="false"]`, panel unmounted), edit mode stayed open, zero editors stranded, box rect unchanged (`214.2,395.8` before and after) - the move was cleanly reverted, not half-committed. |
| Panel open/close x8 (scroller drift) | `scrollTop 535.3 -> 535.3`, page rect identical, `panels:0` after. No scroll or canvas-offset drift. |
| Placement started mid panel-open tween | The only offset is the page visibly moving under a stationary pointer: editor/overlay client delta 14.7-98px across runs, because the page slides 248px over 280ms. The anchor is captured against the LIVE page rect at pointerdown (not the pre-panel offset), and the live selection rectangle shows the same geometry, so this is not the DEF-232 stale-offset class and is not silent. |
| Hostile `updateTextBox` values (size 0/1e9/NaN/Infinity; lineHeight 0.4/5.1/NaN; baselineShift +/-201/NaN; indent -1/201/NaN; align 'bogus'; list 'x'; font 'Arial'; highlight `{r:2}`/`{}`/'red'; `text:null`) | All 20 rejected with a typed `engine-error` naming the field and bounds, e.g. `updateTextBox: size must be a finite number in 1..2000`, `... unsupported font "Arial"; the StandardFont allowlist is Helvetica, Times, Courier`. No partial mutation: every box field was unchanged after the rejection. |
| Patch on a DELETED box id | `engine-error: updateTextBox: text box <id> not found`. |
| Patch with another tab's docId / another doc's box id | Both `engine-error: ... not found`; no cross-tab mutation. |
| patch -> undo -> patch -> redo (deterministic engine sequence) | `updateTextBox{bold}` -> bold true; `undo` -> bold absent; `updateTextBox{italic}` -> italic true, bold absent; `redo` after the new patch -> `ok:false` (redo stack correctly cleared); undo -> italic absent; redo -> italic true. |
| Patch during an in-flight save (UI patch concurrent with Save As) | The saved file did not contain the concurrent size change, but the document stayed `modified:true` after the save completed, so the unsaved change is visible to the user - no silent loss. |
| Retired style toolboxes - text box selected / action-bar Edit / edit-text-run | `.edit-inline-field-font/size/color/bg` and `[data-annotation-color-section]` all count 0 in every path; no font/size/colour input mounted outside `.text-props-panel`. |
| Retired style toolboxes - Tab focus sweep (45 tabs) | Focus never left the panel into an in-canvas style control; `focusSweep:[]`. |
| Committed-annotation double-click editor | The `.ann-textbox` dblclick did not open `[data-annotation-editor]` in this harness even with the tool armed; not counted as a Phase-21 style-surface resurrection (no retired surface was ever mounted). |
| Panel state machine - rapid tool/object switching (6x box <-> annotation <-> none) | Every transition correct (`box -> text mounted`, `ann -> annotation mounted`, `none -> unmounted`); settled `panels:0`, `activeTool:null`; no stranded mode. |
| Panel value leak (box A styled, box B default, reselect A) | A reflected `size 30/bold/red`, B reflected `12/false/black`, A again `30/bold/red`. No leak between objects. |
| Select an annotation then delete it | Selection works via the armed same-kind tool (panel `mode:annotation`, action bar present); after Delete the annotation count went `1 -> 0`, no stranded editor. The panel stays open only because the creation tool remains armed (correct). |
| Two tabs, switch mid-transition | Active pane's workspace `data-text-panel-open:"false"`, no panel in the active pane, `tabCount:2`; the inactive tab's panel is its own per-tab state. No wrong-target or stranded mode. |
| Annotation mode - disabled set | Exactly 22 controls disabled, all carrying the exact reason tooltip; colour is live (`disabled:false`, title "Annotation colour"); the per-family hint is shown. |
| Annotation mode - dispatch sweep | 22 synthetic `click` events on the disabled controls plus programmatic `change` on the disabled font/size: annotation count and payload unchanged, `modified` unchanged. Nothing dispatched. |
| Annotation mode -> text box | Panel returns to `mode:"text"` with font/bold/colour all live. |
| Persistence - box with EVERY style field | All 12 fields (font Courier, size 21, bold/italic/underline, baselineShift 6, align justify, lineHeight 2.1, list bullet, indent 24, color #0000ff, highlight yellow) survived save + reopen. |
| Patch -> undo -> save -> reopen | UI patch size 5 -> undo -> 12; the reopened file held the UNDONE value 12 (undo value persists, not the discarded patch). |
| 50 rapid bold toggles then one undo | Model and panel agreed at every sample: after 50 clicks both `bold:false`; after one undo both `bold:true` (undo of the last toggle). No panel/model divergence. |
| Silence sweep - every enabled panel control | All 19 enabled controls changed the engine model (font, size, bold, italic, underline, super, sub, 3 aligns, 2 lists, indent inc/dec, lineHeight, colour, highlight set/clear, clear-formatting); 0 no-ops, 0 errors. The two spacing buttons are disabled with the exact "no Tc/Tz operator" tooltips and clicking changes nothing (by design). |
| Perf - 34-page report, all three themes | Panel open, panel close and a real engine bold patch each measured p50 **16.7ms**, p95 <= **16.8ms**, max **16.8ms**, **0** frames >33ms (light/dark/frosted identical). `screenshots/adv057-perf.json`. |
| Layout at 820x640 / 1440x900 | Panel/palette overlap 0, no clipped panel body, no unreachable enabled control. |
| Layout grow/shrink recovery | 640 -> 900 -> 640 -> 1440 -> 640 re-fit fit-width correctly each time (page 106/366/106/906/106px); no stuck scale. |

**Total Phase-21-gate findings: 2 (0 HIGH, 1 MEDIUM, 1 LOW).**

---

## Phase 22 gate — title-bar Open / Save / Save As relocation

Session label: `phase-22 gate`. Ran against the dev bundle built from the working tree
(`dist/` includes the Phase-22 relocation plus the uncommitted DEF-243 / DEF-244 fixes;
verified the bundle carries `titlebar-file-btn`, the Save-As title and the
`!e.shiftKey` guard). Harness: `test-fixtures/tools/adv059_phase22.cjs` (sections
`region | accel | state | width | tabs | newtab | menuroute | sendinput | race | stack |
cleanaccel | persist | a11y | silence`), launched only through the canonical
`e2e/lib/launch.cjs`. Screenshots: `screenshots/adv059-*.png`.

## ADV-059: Opening a second document at the 640px minimum width leaves its (now active) tab entirely off-screen; the strip never scrolls to it

- Session: phase-22 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv059_phase22.cjs newtab` — opened one writable copy of
   `report.pdf` through the relocated `[data-toolbar-open]`, reduced the strip to one
   tab, set the window to 1440 / 900 / 640 (height 800), forced `.tab-list.scrollLeft = 0`,
   then opened a second copy through the relocated Open control.
2. Read `.tab-list` (scrollLeft / scrollWidth / clientWidth) and the active tab's rect vs
   `.tab-area` after the second document loaded.
3. Repeated with the accumulated 6-tab state (`... tabs` section,
   `tabs-new-tab-visibility`) to confirm it is not a one-off.

Expected:
- Phase 22 criterion 4: the relocated controls must not collide with the tab strip and the
  tab strip scrolls rather than clipping; an Open that succeeds should give the user a
  visible tab for the document they just opened.

Actual:
- 1440px: active tab 519.0-746.3 inside strip 285.7-1069.8 — fully visible.
- 900px: active tab 473.1-700.5, strip 239.8-529.8, `scrollLeft 0`, `scrollWidth 495`,
  `clientWidth 290` — only ~57px of the new tab is visible.
- 640px: active tab 473.1-700.5, strip 239.8-353.0 (`clientWidth 113`), `scrollLeft 0`,
  `scrollWidth 495`, `activeAnyVisible:false` — the newly opened document's tab is
  **completely invisible** and the strip is not auto-scrolled. With 6 tabs the active tab
  measured 1390.5-1617.8 against a 239.8-353.0 strip, still `scrollLeft 0`.
- The strip itself scrolls correctly (setting `scrollLeft` to the end reveals the "+" and
  the tab; `tabs-scroll-probe` shows `newReachable:false -> true`), so the tab is
  reachable by manual scroll, but nothing scrolls it into view automatically.
- Note for triage: this is likely not a regression introduced by the relocation (the
  2-tab layout at 640 overflows even with the pre-Phase-22 strip width); it is recorded
  because the dispatch asks whether a tab title is visible at the minimum width and
  because the narrower strip makes the threshold arrive with fewer tabs.

Screenshot: screenshots/adv059-newtab.png

Disposition: ACCEPTED -> DEF-245 (MEDIUM; the tab strip must scroll the ACTIVE tab into view - at the 640px minimum width a newly opened document's tab was entirely off-screen)

## ADV-060: Ctrl+Shift+S opens Save As on a clean document although the relocated Save As button is disabled ("Nothing to save")

- Session: phase-22 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/tools/adv059_phase22.cjs cleanaccel` — opened a writable copy of
   `report.pdf`, rotated a page to dirty it, pressed Ctrl+S to save in place (clean,
   on-disk path present).
2. Read the relocated Save As button (`[data-toolbar-save-as]`): `disabled:true`,
   `title:"Nothing to save"`.
3. Force-clicked the disabled button (no dialog, as expected), then pressed
   Ctrl+Shift+S, then sent the menu route `menu:action {action:"saveAs"}`, counting
   `[data-save-as-dialog]` after each.

Expected:
- The relocated Save As control's disabled/"Nothing to save" state should be honoured by
  every route that reaches the same action (REQUIREMENTS.md Phase 22 C3: the control
  keeps its disabled semantics; the dispatch's state matrix treats a clean document as
  "Save As disabled").

Actual:
- Disabled button click: no dialog (`saveAs:0`).
- Ctrl+Shift+S on the clean document: `saveAs:1` — the Save As dialog opens.
- Menu File -> Save As on the clean document: `saveAs:1` — the dialog opens.
- Root cause: the new renderer Ctrl+Shift+S branch (App.tsx ~6270, added by the DEF-243
  fix) calls `onSaveAs(activeId)` gated only on `tabs.activeId !== null`, with no
  `saveModified` check; `onSaveAs` (App.tsx:3297) opens the modal unconditionally. The
  menu route behaves the same (its enable state is `activeId !== null` only), so the
  button is the odd one out. Harmless in effect (it saves a copy of an unchanged file,
  no data loss), but it is a keyboard/menu path that bypasses the disabled state the
  relocated control advertises.

Screenshot: screenshots/adv059-cleanaccel.png

Disposition: ACCEPTED -> DEF-246 (LOW; Save As must be reachable consistently - the button was disabled on a clean document while the menu and Ctrl+Shift+S opened it)

---

## Phase 22 gate — negative results (attacks that did NOT reproduce)

Commands: `node test-fixtures/tools/adv059_phase22.cjs <section>` (all via the canonical
launcher). The dev bundle was rebuilt/verified to contain the Phase-22 markup and the
DEF-243 guard before the runs.

| Attack | Result |
|---|---|
| DRAG REGION — computed `-webkit-app-region` at 1440/640 x frosted/light/dark | `.titlebar` and `.app-header` = `drag`; `.titlebar-file`, all three buttons, the Open label span, the icon `<svg>`s, the modified dot and `.titlebar-file-sep` = `no-drag` in every combination. No control or 1-2px seam is a drag surface. |
| DRAG REGION — dynamic press-move-release | Inconclusive by harness limitation, not a pass/fail: CDP synthetic input cannot drive the native window-move loop. A positive control dragging 160x90px from the known-drag `.brand` area also produced `moved:false` (`dx:0, dy:0`). Computed regions above are the evidence. |
| DRAG REGION — seam points (capsule left padding, Open|sep, sep|Save, Save|SaveAs) | All inside the `no-drag` capsule; drag from each seam left the window at the same bounds (`dx:0, dy:0`) and activated nothing. |
| ACCELERATOR — Ctrl+Shift+S once / x5 rapid / held ~1.2s | Exactly 1 `[data-save-as-dialog]` every time; the renderer branch fired once per press and reported `defaultPrevented:true`; the native menu accelerator produced 0 `menu:action` events under synthesized input. No double dialog, no double IPC. |
| ACCELERATOR — both routes together | Sending `menu:action saveAs` via IPC and pressing Ctrl+Shift+S in the same tick still produced exactly 1 dialog (the modal is a single boolean state). |
| ACCELERATOR — menu route in isolation | `webContents.send('menu:action',{action:'saveAs'|'save'})` drove 1 dialog / 1 save toast; the renderer subscription received `["saveAs"]` / `["save"]` — the menu path is wired and single-shot. |
| ACCELERATOR — Ctrl+S once / held; Ctrl+O once / held | Ctrl+S once -> 1 "Saved" toast; held ~1.2s -> 2 toasts (OS auto-repeat, the second on an already-clean doc); Ctrl+O -> 1 `showOpenDialog` invocation (mock counter), held -> 1. No runaway duplicate. |
| STATE — welcome screen (no document) | Ctrl+S / Ctrl+Shift+S / Ctrl+O and force-clicks on Save / Save As: 0 dialogs, 0 toasts, 0 page errors, `openTabs:0`; Save and Save As both disabled. Clean no-ops. |
| STATE — two tabs, 6 rapid switches | Save disabled/title/tint and the dot followed the ACTIVE tab on every sample (dirty tab: `disabled:false`, warning `rgb(217,164,65)`, dot opacity 1, tab dot 1; clean tab: `disabled:true`, success `rgb(118,166,106)`, dot 0). No background-tab leakage. |
| STATE — stale click after a switch | mousedown on the other tab then a same-tick click on Save As: the header had already re-rendered (`saDisabledAtClick:true`), no dialog opened, active tab correct. No stale-handler save of the wrong tab. |
| WIDTH — 640..1440 bands (16 widths) | Open label `display:block` at 901+ and `none` at <=900; theme label `block` at 701 and `none` at <=700; all three relocated controls `resolvesToSelf:true` at every width; group/tab-area gap stayed 8-12px (no overlap); the first tab's title is visible at 640. |
| WIDTH — resize 901->899 mid-hover, then click | Open still activated (a new tab opened, `activated:true`); the band change neither swallowed the click nor moved the controls out of place. |
| WIDTH — keyboard reach of the icon-only Open at 640 | `aria-label:"Open PDF document"` retained while `.titlebar-file-label` is `display:none`; the control stays focusable. |
| TAB STRIP — click each tab at 1440/900/640 | All three tabs activated correctly at every width (`ok:true`); no click-swallow between the file group and the strip. |
| TAB STRIP — "+" new tab and close | New empty tab opened (3->4 at 640, 4->5 at 1440); close removed a tab (5->4). `.tab-new` and off-screen tabs are reachable once the strip scrolls (`scrollLeft` up to 614). No overlap with the relocated group at any width. |
| PERSISTENCE — read-only sample | Bytes-loaded sample dirty: Save `disabled:true` with "Read-only document — use Save As to save a copy", Save As `disabled:false`; Save As opened 1 dialog. Correct. |
| PERSISTENCE — writable ladder | clean: both disabled, dot hidden; dirty: both enabled, warning tint, dot visible, tab dot 1; after Ctrl+S: clean, success tint, dot hidden, file on disk. Matches the pre-Phase-22 CommandBar semantics. |
| A11Y — names | group `role:"group" aria-label:"File actions"`; Open `aria-label:"Open PDF document"` title "Open PDF (Ctrl+O)"; Save `aria-label:"Save"`; Save As `aria-label:"Save a copy"`. |
| A11Y — focus order | menu button -> Open -> Save -> Save As -> tab-close -> tab-new -> settings gear -> theme -> minimize/maximize/close; all three relocated controls `canFocus:true, tabIndex:0`; DOM order brand < group < tab strip. |
| A11Y — Save As dialog keys | Escape closed the dialog; Enter on the reopened dialog confirmed (dialog gone). Both work. |
| NO DUPLICATES | `.toolbar [data-toolbar-open] / [data-toolbar-save] / [data-toolbar-save-as]` count = 0 in every state; the CommandBar no longer renders File/Save groups. |
| DEF-243 fix verification | Ctrl+Shift+S produced exactly one Save As dialog (the old in-place-save behaviour is gone) in accel / menuroute / sendinput runs. |
| DEF-244 fix verification | At 640px `.tab-area` clientWidth = 113 (was 0 in the defect report), `.tab-list` clientWidth 113 / scrollWidth 265, first tab title visible and hittable. |
| Hostile sequence — Ctrl+Shift+S then Ctrl+W | Two stacked modals (Save As + "Unsaved changes" close prompt), 2 backdrops, but fully recoverable in 2 Escape presses; canvas and the rotate button hittable afterwards. Not a wedge, so not filed. |
| Hostile sequence — Ctrl+S while the Save As modal is open | Saved in place and left the Save As modal open (global accelerators are not modal-aware). Pre-existing general behaviour, no data loss; not a Phase-22 regression, so not filed. |
| Hostile sequence — Ctrl+S then immediately Ctrl+W; Ctrl+S then theme switch mid-save | Tab closed after a successful save (`openTabs:0`, save toast present); theme crossfade mid-save left the document clean and the theme applied. No wedge, no lost edit. |

**Total Phase-22-gate findings: 2 (0 HIGH, 0 MEDIUM, 2 LOW).**

---

## Phase 30 gate — print with advanced options

Session: `phase-30 gate`. Model: `openrouter/deepseek/deepseek-v4.1-flash`. All runs via the
canonical launcher `e2e/lib/launch.cjs` `launchApp`; every passing-payload print used an
explicitly non-existent device name, and the only default-device job used this box's virtual
default ("Microsoft Print to PDF"). No physical printer was ever targeted. Repro harnesses
live in `test-fixtures/adv-p30-*.cjs`; specimens in `test-fixtures/adv-*.pdf`.

## ADV-061: `printJob` with no valid deviceName never resolves and leaks a hidden BrowserWindow per call; the app then refuses to quit

- Session: phase-30 gate
- Suggested severity: HIGH

What I did:
1. Launched the dev app and ran `node test-fixtures/adv-p30-leak.cjs` (also `adv-p30-matrix.cjs`).
2. From the renderer called `window.tflex.printJob({ images: ['data:image/png;base64,iVBORw0KGgo...'], settings: { deviceName: '' } })`, then the same with the `settings` key omitted entirely, then with `deviceName: 12345`.
3. Raced each call against an 8 s timeout and counted `BrowserWindow.getAllWindows()` in the main process before, immediately after, and 3 s later.
4. Repeated the call five times, then closed the visible window with `win.close()` and waited 5 s before querying the main process again.

Expected: an empty, absent or non-string `deviceName` should be rejected with a typed reason (`bad-device`) before any window is created, or the print call must be bounded (timeout + destroy) so a driver that never calls back cannot leak. AGENTS.md fail-loud: no silent default-device print.

Actual:
- Every call hung: `{"settled":false,"result":"TIMEOUT"}` at 8 s. Window count grew 1 -> 2 -> 3 -> 4 -> 5 -> 6; every leaked window was still `destroyed:false, visible:false` with the temp print HTML loaded (`file:///C:/Users/.../tflex-print-*.html`), and none was ever destroyed. A single call observed for 90 s (`test-fixtures/adv-p30-confirm.cjs`) never settled and its window was still alive at T+90 s.
- Root cause: `validatePrintPayload` (src/main/services/print.ts:80-132) never validates `deviceName`; `mapPrintSettings` (src/main/services/print.ts:164-177) omits `deviceName` when it is `''`/absent and sets `silent: true`, so Electron prints to the system default. With a virtual default driver ("Microsoft Print to PDF" on this box) `webContents.print` never invokes its callback, and `printJob` (src/main/services/print.ts:413-424) only resolves and destroys the window inside that callback, so the promise never settles and the `finally` is never reached. A non-string `deviceName` (12345) takes the same path because Electron ignores the bad value and uses the default - the missing type check is directly implicated.
- Consequence 2 (zombie process): with one leaked hidden window alive, closing the only visible window left the app running (`appAlive=true, windows=1`); it never quits because `window-all-closed` cannot fire while the hidden window exists.

Screenshot: none (non-visual). Harness: `test-fixtures/adv-p30-leak.cjs`.

Disposition: ACCEPTED -> DEF-269 (HIGH; `deviceName` must be validated as a non-empty string with a typed reason, and `printJob` must be bounded - a timeout plus window destruction on EVERY path - so a driver that never calls back cannot leak a hidden window or keep the app alive)

## ADV-062: The print payload validator accepts any non-empty string as a page image, so broken/blank content is dispatched as a print job

- Session: phase-30 gate
- Suggested severity: MEDIUM

What I did:
1. Ran `node test-fixtures/adv-p30-matrix.cjs`.
2. Called `window.tflex.printJob({ images: ['not-a-data-url'], settings: { deviceName: '__adv_no_such_printer_92__' } })`, then `{ images: ['data:image/png;base64,AAAA'] }` (valid-looking URL, undecodable PNG bytes).

Expected: `validatePrintPayload` should reject a non-data-URL / non-decodable image with `bad-image` (the typed reason exists), so a caller that hands over garbage cannot reach the engine.

Actual: both pass validation (`bad-image` only checks `typeof !== 'string'` or `''` at src/main/services/print.ts:87-91), reach `composePrintHtml`, mount in the hidden window and call `webContents.print`. The print document then contains a broken `<img>`, so the job fails at the driver or prints blank pages; the only signal is the driver callback's `success`, which is not tied to the image being valid. The renderer's own path always sends real PNG data URLs, so this is an IPC-surface robustness gap, but it is exactly the fail-loud guarantee the phase promises.

Screenshot: none. Harness: `test-fixtures/adv-p30-matrix.cjs`.

Disposition: ACCEPTED -> DEF-270 (MEDIUM; `bad-image` must actually check the data-URL shape so garbage cannot reach the engine's print document)

## ADV-063: Print affordances are enabled and silently no-op when no document is open

- Session: phase-30 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the app to the welcome screen (0 tabs) and ran `node test-fixtures/adv-p30-nodoc.cjs`.
2. Read the title-bar Print button `[data-print]`: present, `visible:true`, `disabled:false`.
3. Clicked it, waited 800 ms, counted the dialog `[data-print-printer]` -> 0.
4. Sent the real Ctrl+P accelerator through `webContents.sendInputEvent` (the native menu path) and counted the dialog -> 0. No toast, no error, no state change.

Expected: a control that cannot act must be disabled (like Save/Save As on the welcome screen) or must say why. AGENTS.md: "Every control introduced in a phase must implement its promised behavior; a click that does nothing is a defect, not polish."

Actual: the header Print button renders enabled on the welcome screen; the File > Print menu item (src/main/menu.ts:72-76) has no `id`, so it is never disabled by `applyMenuEnabledState`; Ctrl+P is always live. All three silently do nothing because `onPrintClick` / the `onPrintRequest` subscription return early when there is no active tab (src/renderer/App.tsx:5044-5047 and 887-890). The user gets no feedback that Print is unavailable.

Screenshot: screenshots/adv-p30-nodoc-welcome.png (Print glyph enabled in the header, immediately left of the gear).

Disposition: ACCEPTED -> DEF-271 (MEDIUM; with no document open the title-bar Print button must be disabled and the File > Print menu item must be disabled by `applyMenuEnabledState` - give it an `id` like the other document-scoped items - so Ctrl+P cannot silently do nothing)

## ADV-064: Two Print activations dispatched in the same task run two print jobs (in-flight guard is render state only)

- Session: phase-30 gate
- Suggested severity: LOW

What I did:
1. Ran `node test-fixtures/adv-p30-dialog.cjs` (sections F and G). Stubbed the app's `getPrintersAsync` to a non-existent device (`__adv_no_such_printer__`) so nothing reached a real printer, opened the dialog on a 1-page fixture, and counted hidden-window creations with `app.on('window')`.
2. Real pointer double-click on `[data-print-confirm]` (`locator.dblclick()`): 1 hidden window, 1 error banner.
3. Same-task activation (`document.querySelector('[data-print-confirm]').click(); ...click();` inside one `page.evaluate`): 2 hidden windows - two `printJob` calls.

Expected: `onConfirmPrint`'s `if (!valid || !selection.ok) return` should be backed by a synchronous in-flight guard (a ref) so a second activation in the same task cannot start a second job.

Actual: `valid` is derived from render state (`running`), which React has not re-rendered within the same task, so both invocations pass the guard; each rasterises and calls `printJob`. Real pointer double-click is defended (React commits `running:true` between the two click events), so this is only reachable via a same-task dual activation; on a physical printer it would queue the job twice. Filed LOW because normal pointer and keyboard input do not reproduce it.

Screenshot: screenshots/adv-p30-print-error.png (dialog after the fake-device job; the banner text "Invalid deviceName provided" is in the run log).

Disposition: ACCEPTED -> DEF-272 (LOW; a synchronous in-flight ref guard must make the print confirmation idempotent so a same-task dual activation cannot start two jobs)

## ADV-065: A 50 000-digit page range reports "Page Infinity is out of range" (parseInt overflow in the range parser)

- Session: phase-30 gate
- Suggested severity: LOW

What I did: opened report.pdf (34 pages), selected Custom and typed 50 000 nines into `[data-print-range-input]` (`node test-fixtures/adv-p30-dialog.cjs`, section C).

Expected: a clear out-of-range message naming a sane number, or the generic "not a valid page or range".

Actual: `parsePageRanges` (src/renderer/pdf/printSelection.ts:65-70) runs `Number.parseInt` on the token, which overflows to `Infinity`, and the message becomes "Page Infinity is out of range (1-34)." It still fails loud (Print disabled, `role=alert`), so this is cosmetic, but the message leaks an implementation artifact.

Screenshot: none.

Disposition: ACCEPTED -> DEF-273 (LOW; an over-long numeric token must not render "Infinity" in the out-of-range message - clamp or fall back to the generic "not a valid page or range")

## Phase 30 gate — negative results (attacks that did NOT reproduce)

All via the canonical launcher. Harnesses: `test-fixtures/adv-p30-matrix.cjs`,
`adv-p30-leak.cjs`, `adv-p30-dialog.cjs`, `adv-p30-size.cjs`, `adv-p30-raster.cjs`,
`adv-p30-raw.cjs`, `adv-p30-nodoc.cjs`, `adv-p30-quit.cjs`.

| Attack | Result |
|---|---|
| Hostile IPC payloads — empty/non-array/null/''/number image; copies 0 / -1 / 1e9 / NaN / '3' / 1.5; pagesPerSheet 0 / 3 / 5 / 17 / '4'; scalePercent 0 / 9999 / NaN; pageRanges [-5..1e9] / reversed / 'x' / [null]; null payload; string payload | All rejected with the matching typed reason (`empty-images`, `bad-image`, `bad-copies`, `bad-pages-per-sheet`, `bad-scale-percent`, `bad-page-range`) in <= 1 ms, no hidden window created. Defended. |
| Runtime-cast union values — oddEven 'banana', duplex 'diagonal', scaling 'wat', landscape 'yes', pageOrder 'weird' | Pass validation (not validated) but with a bogus device settle loudly with "Invalid deviceName provided"; no crash, no hang. |
| Payload size — 500 images, 5000 images, one 10 MB and one 40 MB data-URL image | Settle in 0.2-1.8 s with the bogus-device failure; no leak, no hang, temp files cleaned up. |
| Raster bound — 6000x6000 pt page (pdf-lib) | Preview raster 3464x3464 = 11 999 296 px, just under `MAX_PRINT_PIXELS` 12 000 000; honest and bounded. Screenshot `screenshots/adv-p30-giant-preview.png`. |
| Raster bound — raw 200000x200000 pt MediaBox, negative MediaBox, zero MediaBox | 3464x3464 bound; negative box renders (66x66 preview); zero box normalised by pdf.js to Letter. No crash, no hang. Screenshots `adv-p30-raw-*` not taken; see `adv-p30-zero-preview.png`. |
| Preview honesty — huge-images.pdf (3 pages, 2.2 MB) and a /Rotate 90 page | 408x528 preview; the rotated page previews 333x200 with `data-landscape=true` (rotation honoured). Screenshots `adv-p30-hugeimages-preview.png`, `adv-p30-rotated-preview.png`. |
| Dialog — rapid annotation / N-up / orientation / scale toggles during a 16-page raster | 16 preview images rendered, dialog alive, 0 page errors, 0 console errors. Defended. |
| Dialog — Cancel mid-raster, then reopen | State reseeded (copies 1, N-up 1, annotations on, no stale success/error) and the preview re-rasters. Defended. |
| Dialog — close the active tab behind the open dialog (real Ctrl+W accelerator) | Dialog stays open showing "This document has no pages." with Print disabled; it then closes normally. Recoverable, no crash - not filed. Screenshot `adv-p30-dialog-notab.png`. |
| Dialog — 1-page doc odd/even | Odd only -> "1 page - 1 sheet", Print enabled; even only -> "No even pages in the selected range.", Print disabled. Defended. |
| Print result surface — failing job | Error banner `role=alert` shows the driver reason "Invalid deviceName provided"; Print re-enables. Defended (cancel-quiet path not exercised - it requires opening the real OS print dialog, which was avoided). |
| Fail-loud — any other route to a silent "printed" | None found beyond ADV-061/062/063. |
| Temp hygiene | No `tflex-print-*.html` leftovers in `%TEMP%`; completing jobs destroy their hidden window. |

**Total Phase-30-gate findings: 5 (1 HIGH, 2 MEDIUM, 2 LOW).**

Unreproduced / not exercised: a paused or offline physical printer is the likely real-user route to
the ADV-061 hang (same missing callback), but creating one needs driver manipulation and was not
done. The virtual-PDF "cancel" quiet path was not exercised because it opens a real OS dialog.

## Phase 31 gate - What's New in About

Session label: `phase-31 gate`. Ran against the dev build through the canonical launcher
(`e2e/lib/launch.cjs` `launchApp`, DNS-blocked with `--host-resolver-rules=MAP * 127.0.0.1`).
About was opened with the real main-process `menu:action {action:'about'}` payload and update
state was driven over the real `update:statusChanged` channel. Harnesses live in
`test-fixtures/adv-p31/` (`module-probe.cjs`, `hostile-render.cjs`, `crash-probe.cjs`,
`empty-state-probe.cjs`). Targeted unit files `test/unit/main/whatsNew.test.ts` and
`test/unit/renderer/aboutDialogWhatsNew.test.tsx` pass (20 tests).

## ADV-066: A malformed `update:statusChanged` payload blanks the entire renderer and cannot be recovered without a relaunch

- Session: phase-31 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the dev build through `launchApp`, opened Help -> About via the real
   `menu:action {action:'about'}` payload, then sent a state over the real main->renderer
   channel `update:statusChanged` with `{kind:'available', version:'99.0.0',
   notes:[null, 123, {a:1}, 'kept string']}` (`test-fixtures/adv-p31/crash-probe.cjs`).
2. Repeated in fresh launches with `notes:'just a string'` and `version:{a:1}`.
3. Measured the blast radius (`#root` child count, `.sample-card` presence, `body.innerText`),
   then attempted recovery by sending `{kind:'checking'}` and the About `menu:action` again.

Expected: the renderer treats the payload as untrusted at the IPC boundary - a non-string
`notes` element, a non-array `notes`, or a non-primitive `version` renders as text or is
ignored, and the About dialog stays mounted (criterion 6: notes content must never crash). At
worst the incoming block shows its empty state.

Actual: all three shapes throw during render and React unmounts the whole root - `#root` child
count 0, `.sample-card` gone, `body.innerText` empty, the window is a blank white page
(`screenshots/adv-p31-crash-mixed.png`). Re-sending the About action does NOT bring the dialog
(or anything) back; the renderer stays blank until the app is relaunched.
`notes:[null,123,{a:1}]` -> React error #31 (objects are not valid as a React child);
`notes:'just a string'` -> `notes.map is not a function` (AboutDialog.tsx:273);
`version:{a:1}` -> React error #31 (AboutDialog.tsx:268). Control shapes are fine:
`notes:{note:'x'}` (no `length`) shows the incoming empty state, and `version:123` renders as
text - so exactly the non-string element, non-array `notes` and non-primitive `version` shapes
are lethal. The renderer has no error boundary, so one bad message is fatal to the whole UI.

Reachability (why MEDIUM, not HIGH): the shipped feed path cannot produce these shapes -
`normalizeReleaseNotes` (update-service.ts:112) filters array entries to strings and
`String(info.version ?? '')` guarantees a string version, and those are the only producers of
`notes`/`version`. This is IPC-boundary hardening: a future main-side bug, a new event source
or a preload change would take the whole UI down. Guard `Array.isArray(notes)`,
`typeof line === 'string'` and `typeof state.version === 'string'` before rendering.

Screenshot: screenshots/adv-p31-crash-mixed.png (blank window after the payload),
screenshots/adv-p31-crash-string.png.

Disposition: ACCEPTED -> DEF-275 (MEDIUM; a malformed update payload must not be able to blank the whole renderer - guard the three lethal shapes (`Array.isArray(notes)`, a string per line, a string `version`) at the render boundary, as the adversary specified)

## ADV-067: "Earlier releases" history is positional, not relative to the running version, so the explicit empty state lists NEWER releases as "Earlier releases"

- Session: phase-31 gate
- Suggested severity: LOW

What I did:
1. Fresh launch; overrode `app:getInfo` to return version `1.2` BEFORE opening About, then
   opened Help -> About (`test-fixtures/adv-p31/empty-state-probe.cjs`).
2. Read the What's New section DOM (empty state, history head, history versions).
3. Probed `whatsNewHistory` directly against the real bundled module
   (`test-fixtures/adv-p31/module-probe.cjs`).

Expected: the empty state is shown for a version with no entry (criterion 3), and the "Earlier
releases" history lists only releases OLDER than the running version - the doc comment says it
is "the entries AFTER the running version's".

Actual: with running version `1.2`, the section shows "No release notes for this version." and
then "Earlier releases: v1.23.0, v1.22.0, v1.21.0" - all three are NEWER than 1.2
(`screenshots/adv-p31-empty-1_2.png`). `whatsNewHistory` (whatsNew.ts:93) ignores the running
version entirely: it returns `WHATS_NEW.slice(1)`, i.e. array positions 2..N. It is correct
only while the running version happens to be the newest entry. Same for `1.23.1 ` (trailing
space) and `9.9.9`.

Related release-gate gap: `test/unit/main/whatsNew.test.ts` checks that the package.json
version HAS an entry, ordering, uniqueness and non-empty highlights, but does NOT assert
`WHATS_NEW[0].version === package.json version`. So nothing prevents a changelog whose top
entry is newer than the running version; in that case the running version's own entry is also
duplicated under "Earlier releases" (it sits at array index 1 and is returned by the slice).
Fix: make the history version-relative (filter to entries older than the running version)
and/or add the top-entry assertion to the gate.

Screenshot: screenshots/adv-p31-empty-1_2.png.

Disposition: ACCEPTED -> DEF-276 (LOW; `whatsNewHistory` must be relative to the running version - entries OLDER than it only - and the release gate must pin `WHATS_NEW[0]` to the `package.json` version so a newer-than-running top entry cannot mislabel the history)

## Phase 31 gate - negative results (attacks that did NOT reproduce)

| Attack | Result |
|---|---|
| Hostile string notes over the real IPC channel: `<script>`, `<img onerror=...>`, `<b>`, `<style>body{display:none}</style>`, HTML entities, `javascript:`/`data:` URLs, RTL Arabic+Hebrew, astral/emoji, NUL/bell/ESC/backspace/zero-width, whitespace-only lines | Rendered as literal text; no element created from the content (no script/img/style/b inside the incoming block); `window.__adv_p31_xss1/2` markers never set; body style unchanged; 0 page errors. Defended. |
| 100 000-character single line | One `<li>`; wraps via `overflow-wrap:anywhere`; incoming block `scrollWidth == clientWidth` (510/510); sheet stays clamped (clientHeight 639, bottom 770 < 900); rendered in ~0.44 s. Defended. |
| 5 000-line notes array | 5000 `<li>` rendered in ~1.7 s; body owns the scroll (bodyScroll 107 907 / bodyClient 586, overflow-y auto); sheet stays clamped at 1440x900 and at 640x700; document has no horizontal scroll. Defended. |
| Containment + reachability with 5000 lines + incoming block + history, at default size and at the 640px minimum width | Sheet scrollHeight == clientHeight (639/635); bottom inside the viewport; doc scrollWidth == innerWidth; after scrolling the body, `[data-about-check-update]` is fully visible (640x700: top 489 / bottom 519) and the User data / Settings / Signatures rows are reachable. DEF-268 class not reproduced. |
| `notes: []` and `notes` omitted | Explicit "No release notes available for this update." empty state; never a blank block. Defended. |
| `whatsNewFor` exact match: `1.23`, `1.2` (prefix), `1.23.0.1`, `v1.23.0`, leading/trailing whitespace, `''`, null, undefined | All return null; no prefix collision (`1.2` does not return `1.23.1`). Defended. |
| `whatsNewHistory`: 0, -1, -0.5, NaN, -Infinity, 1e9, Infinity, 1.9, 0.5, `'2'`, `'x'`, null, `{}` | 0 / negative / NaN / -Infinity / 0.5 -> []; 1e9 / Infinity -> all 4; `'2'` -> 2 (numeric coercion, unreachable through typed callers). No crash. Defended. |
| `normalizeReleaseNotes`: undefined, null, number, `{}`, array of strings, `[{version,note:null}]`, `[{note:123}]`, `[{note:{}}]`, nested array, `[{version}]` | All -> undefined or [] - never `[undefined]`, never the literal string "undefined", never a non-string element reaching the UI. Defended. |
| `normalizeReleaseNotes`: `''`, whitespace-only, blank lines, CRLF, lone CR, 100k line, 5000 lines | `''`/whitespace -> []; blank lines dropped; CRLF split; a lone `\r` is NOT split (one line `a\rb`) - cosmetic, GitHub bodies use LF/CRLF, not filed. Defended. |
| Release gate | Read and exercised via the module probe; it passes for 1.23.1 and fails when the entry is absent. Its only gap (top entry not pinned to the running version) is recorded in ADV-067. |

**Total Phase-31-gate findings: 2 (0 HIGH, 1 MEDIUM, 1 LOW).**

Unreproduced / minor: a 4000-character incoming `version` string overflows the incoming header
(`scrollWidth` 25 858 vs `clientWidth` 510), but the sheet body's `overflow-x:hidden` clips it
and the document does not scroll horizontally, so it is a clipped-text hardening note, not
filed - real version strings come from `latest.yml` semver. My harness's update-prompt dismissal
did not always close the phase-13 "Restart to update" sheet (unrelated to Phase 31), which is
why `screenshots/adv-p31-many-lines-640.png` shows it layered over the contained About sheet.

---

## Phase 32 gate - Multi Mode (two documents in one workspace)

Session label: `phase-32 gate`. Model: `openrouter/deepseek/deepseek-v4.1-flash`. All runs
against the dev build through the canonical launcher `e2e/lib/launch.cjs` `launchApp`, real
interactions (native Playwright `dragTo` first, synthetic `DataTransfer` only when a native
drag could not be driven). Repro harnesses live in `test-fixtures/adv-p32/`
(`harness.cjs`, `smoke.cjs`, `undo.cjs`, `drag.cjs`, `sequences1.cjs`, `sequences2.cjs`,
`divider.cjs`, `datasafety.cjs`, `perf.cjs`, `rail.cjs`, `flicker.cjs`, `final.cjs`,
`tools*.cjs`, `misc.cjs`, `position.cjs`, `casepath.cjs`, `samefile-save.cjs`, `append.cjs`,
`lastprobe.cjs`). Fixtures: copies of `report.pdf` (34pp) and `long.pdf` (520pp) in `%TEMP%`.

## ADV-068: The same-file pane guard and the open dedupe compare raw path strings, so a Windows path variant puts the same file in BOTH panes and a later save silently overwrites the other pane's saved edits

- Session: phase-32 gate
- Suggested severity: MEDIUM

What I did:
1. Copied `test-fixtures/report.pdf` (34 pages) to
   `%TEMP%\tflex-adv-p32\<ts>-p32-samefile.pdf`.
2. Launched the dev build and opened the file with the real title-bar Open control (mocked OS
   dialog), then opened the SAME file again with a path differing only in case:
   `...\...-P32-SAMEFILE.PDF` (`fs.existsSync` = true on Windows; same file).
   `test-fixtures/adv-p32/casepath.cjs`.
3. With the two tabs open, activated the first, turned Multi Mode on (pane A = the exact-case
   tab), then picked the case-variant tab into pane B from the empty pane's pick list.
4. `test-fixtures/adv-p32/samefile-save.cjs` - with the same file in both panes, selected page 1
   in pane A's rail, clicked "Delete this page" (A 34 -> 33), saved pane A (Ctrl+S; file on disk
   = 33 pages), then saved pane B (Ctrl+S; file on disk = 34 pages).

Expected: Phase 32's fixed design decisions: opening a file that is already open must dedupe to
the existing tab, and assigning/opening the document already shown in the other pane must be
REFUSED with a clear message ("That file is already shown in the other pane." /
"That document is already shown in the other pane."). The same document must never occupy both
panes.

Actual: both guards are raw string comparisons - the open dedupe is
`t.filePath === source.path` (App.tsx:1301) and the pane guard is
`otherPath !== filePath` (multiMode.ts:129, `paneAssignPathError`). Any path variant Windows
treats as the same file bypasses both:
- `...-P32-SAMEFILE.PDF` created a SECOND tab (tabs 1 -> 2, no toast) and was accepted into
  pane B. The rail then showed the same file twice (headers differ only in case) and
  `SAME FILE IN BOTH PANES = true` - two independent engine docs loaded from one on-disk file.
  `screenshots/adv-p32-samefile-casevariantfilename.png`.
- Drive-letter case (`c:\...` vs `C:\...`) reproduces identically (2 tabs, same file in both
  panes). `screenshots/adv-p32-samefile-drivelettercase.png`.
- Data loss consequence: pane A deleted page 1 and saved 33 pages to the file; pane B then
  saved its 34-page copy over the same path, silently discarding pane A's saved edit. On-disk
  page count: 34 -> 33 (Save A) -> 34 (Save B). The user is never warned that two panes write
  to one file. `screenshots/adv-p32-samefile-save.png`.
- The forward-slash variant (`C:/Users/...`) did NOT produce a second tab in my run.

Suggested fix: compare canonical/normalized paths (e.g. `path.resolve` + case-fold on Windows,
or `fs.realpathSync.native`) for BOTH the open dedupe and `paneAssignPathError`.

Screenshot: screenshots/adv-p32-samefile-save.png,
screenshots/adv-p32-samefile-casevariantfilename.png.

Disposition: ACCEPTED -> DEF-279 (MEDIUM; both path comparisons must be canonical - normalise the path (separators, drive-letter/filename case) before the open dedupe and before the pane guard, so a Windows path variant cannot open the same file twice and a save cannot overwrite the other pane's saved edits)

## Phase 32 gate - negative results (attacks that did NOT reproduce)

| Attack | Result |
|---|---|
| Undo/redo after a cross-document move (nobody had probed this) | Coherent per-side. Move A page1 -> B before page2: A 34->33, B 34->35. Undo A: A 33->34 (B stays 35 - the page is transiently in BOTH, "each document's undo restores its own side"). Undo B: B 35->34 -> original 34/34. Redo A: 33/34; redo B: 33/35. Same result with the reverse undo order. No page is LOST at the end of a pair; intermediate single-undo duplication is the documented per-side model. Exact counts in `test-fixtures/adv-p32/undo.cjs`. |
| Drag ALL pages / last remaining page | A 1-page source (form.pdf) dragged to a 34-page target: engine `empty-range` refused, counts unchanged (1/34), user-visible toast "Specify at least one page in the range." Defended. (The rail selection model is single-page, so a multi-page selection drag is not reachable through the UI.) |
| Drop on divider / rail header / other pane's header / outside any pane | No drop target advertises itself (no indicator, `defaultPrevented:false`), counts unchanged, no error. Standard HTML5 drag-cancel; nothing is promised for those zones. Defended. |
| Drop on its own source page (same slot) | Resolves to a no-op; counts unchanged, no crash, no duplicate. Defended. |
| Intra-document reorder still works (rail) | A page 3 -> before page 1: engine `pageOrder` changed, thumbnails swapped, counts unchanged. Defended. |
| Ctrl-copy then move the copy back | A 34/B 34 -> Ctrl-copy A->B: 34/35 -> move B's copy back to A: 35/34. Correct. Defended. |
| Same page dropped twice quickly / two moves back-to-back (refresh in flight) | Double drop moved exactly one page (the second drop has no source after `drag.end()` -> no-op); two back-to-back moves moved exactly two pages (32/36). No corruption. Defended. |
| Drop position vs indicator | Rail drop on thumb page 2 lands at visible position 2; canvas lower-half drop lands at position 3; the engine adapter converts 1-based -> 0-based correctly (engineClient.ts:1148). No off-by-one. Defended. |
| Append drop on the section's empty space below the last thumb | A page 1 -> B section scroller: B 34->35, the new page landed at the last visible position (index 34). Defended. |
| Enable Multi Mode with 0 tabs (welcome) | No `[data-toolbar-multi-mode]` control is rendered on the welcome screen (count 0). No-op, no crash. |
| Enable with exactly 1 tab, then toggle off | Pane A seeded, pane B explicit empty state; off returns to single mode, 0 `[data-pane]`. Defended. |
| 12 rapid toggles; 20 rapid focus switches on two 34-page docs | Final state consistent (mode/panes correct, diagnostics `pageCount` matched the last-clicked pane). No crash, no stranded layout. Defended. |
| Divider dragged to both extremes and past them | Clamps to the sensible minimum (A 316px / B 316px, both canvases visible); no overflow, no negative pane, split fraction stable. Defended. |
| Clear pane B while a drag is in flight | Pane B empties, its rail section unmounts, the pending drop finds no target (`no-tgt`), no error, no page moved. Defended. |
| Close the SOURCE tab mid-drag | Pane A empties; the drop fires but `docIdFor(sourceTab)` is null so it is a clean no-op; no engine call, no data loss, no crash. Defended. |
| Close a pane's (unmodified) tab | Pane empties cleanly (no stale header), rail section removed, other pane untouched. Defended. |
| Assign/clear/pick/tab-strip sequence integrity | Across clear -> pick -> strip-beta -> strip-gamma -> strip-alpha the two panes never held the same document; the rail always listed pane A's document first. Defended. |
| Focused-pane routing (rotate) | Rotating on focused pane A changed A's `rotations[0]` to 1 and marked A modified; pane B's rotations stayed 0 and B stayed unmodified. Defended. |
| Data safety - modify BOTH panes then window-close | The close gate prompted for pane A's document first, then pane B's (queue covers both). Cancel aborted the whole close (window stayed alive, both `modified:true`). Discarding both closed the window. Defended. |
| Data safety - close a MODIFIED pane's tab | Prompt named THAT document; Cancel kept the tab; Don't save closed it and the pane emptied cleanly. Defended. |
| Data safety - save the focused pane | Ctrl+S on A wrote A (toast "Saved ..."), A `modified:false`, B `modified:true`; the subsequent window-close prompt was for B only. Defended. |
| Absurd window sizes | The OS floors the window at 640px; at 640x480 the rail (220) + two 206px panes fit with no horizontal scroll and both canvases visible. Defended. |
| Flicker - per-frame 32x32 whole-canvas downscale, darkest-pixel, both panes | Toggle, focus switch, divider drag, cross-doc drop and pane-fill: 0 blank frames in either pane (darkest never reached the white threshold); the unfocused pane's signature did not churn on a focus switch; raster sizes change only when a pane is genuinely resized by the divider. Defended. |
| Perf/memory - 34pp + 520pp | Rail mounts 520 `.thumb-item` nodes for the 520-page doc but rasters only ~4 canvases (0.09 MP); heap ~12 MB, rss ~138 MB, stable across focus/scroll/divider stress; a cross-doc move on the big pair is correct (33/521). No leak, no stall. Defended. |
| Canvas-path Ctrl-copy | Native `dragTo` from the pane A grip to a pane B page slot with Ctrl held: A 34/B 35. Defended. |
| Toggle Multi Mode OFF mid-drag, then drop | Mode off, panes unmounted, drop finds no target, no page moved, no toast; re-enabling restores A/B with the correct counts. Defended. |
| Closing the LAST tab while Multi Mode is on | Auto-disables, returns to the welcome screen (4 sample cards), 0 `[data-pane]`. Defended. |

**Total Phase-32-gate findings: 1 (0 HIGH, 1 MEDIUM, 0 LOW).**

Unreproduced / minor (not filed):
- With both panes filled, `[data-tools-badge]` is rendered twice (one per pane's chrome) at the
  exact same viewport position. A real pointer click at that point opens the All Tools palette
  (verified), so the user-visible behaviour is correct; only Playwright's strict
  `locator('[data-tools-badge]').first()` click is intercepted by the topmost duplicate. Cosmetic
  DOM duplication, not a functional no-op.
- The shared rail mounts one `.thumb-item` node per page (520 for `long.pdf`) while rasterising
  only the visible window (~4 canvases). Raster virtualisation holds and memory stays flat, so
  this is a DOM-node observation, not a leak.
- `[data-pane-open]`/generic open of a case-variant path bypasses the same-file guard exactly
  like the pick-list path in ADV-068 (same root cause).

---

## Phase 33 gate — print + Multi Mode refinements

Session label: `phase-33 gate`. Ran against the real dev build via the canonical
`e2e/lib/launch.cjs` `launchApp` helper (dist built from the current `src`). All print output was
produced through the Phase-30 `printToPDF` seam (`e2e/lib/p33_print.cjs`) with a bogus device name
(`TFlex QA Bogus Printer`) - never a physical printer. Adversary harnesses live in
`test-fixtures/adv-p33/` (`parity.cjs`, `dialog.cjs`, `resize.cjs`, `multi.cjs`, `fanout.cjs`,
`rapid.cjs`, `extra.cjs`, `focusdraw.cjs`, `cleanprobe.cjs`, `strips.cjs`, `gen_pages16.cjs`).
Fixture `test-fixtures/adv-p33/pages16.pdf` (16 pages, each visually unique) was crafted so a
produced sheet's embedded page images are distinguishable by hash.

## ADV-069: The movable print dialog is not re-clamped when the window is resized, leaving the Print/Close controls off-screen and unclickable

- Session: phase-33 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the dev build, opened `report.pdf`, clicked the title-bar Print icon.
2. Dragged the dialog by its header (`[data-print-drag-handle]`) hard to the bottom-right; the
   drag clamp held it fully inside the window at 1440x900 (rect right 1440 / bottom 900).
3. Without reopening, shrank the window (`BrowserWindow.setSize`) to 1100x760, then 900x620,
   then 700x560, waiting ~800 ms each. `test-fixtures/adv-p33/resize.cjs`.
4. Read the dialog's `.print-dialog` rect and the `[data-print-confirm]` rect, and attempted a
   `trial: true` click on `[data-print-confirm]`.

Expected: Phase 33 requires the dialog to be "clamped so it always stays fully inside the
window" and that "the controls keep working after a move". After a window resize the panel
should still be fully inside the viewport (or be re-clamped), so Print/Close remain reachable.

Actual: the clamp is only evaluated during a drag (`printDialogDrag.ts` / `onHeaderPointerMove`);
nothing re-clamps on resize, so the dialog keeps its translate offset while the viewport shrinks:
- 1100x760: dialog rect `{left:550, top:64, right:1270, bottom:760}` vs viewport 1100x760 -
  **170 px past the right edge**; the Print button rect is `{left:1191, right:1253}` and
  `trial: true` click reports **not actionable**. Screenshot:
  `screenshots/adv-p33-dialog-clipped-1100x760.png` (Preview column and the whole footer with
  Close/Print are clipped off the window's right edge).
- 900x620: rect right 1000 vs 900 - **100 px past**; Print not actionable.
- 700x560: rect right 774 vs 700 - **74 px past** (the dialog shrinks its own width but its left
  origin does not move).
- The header itself stays on-screen at these sizes, so the panel can still be dragged back
  (dragging the header left brought it back to `left:0`), which is why this is MEDIUM rather than
  HIGH - but the footer controls are dead until the user realises they must drag the panel first.
- Same-size resize (1440x900 -> 1440x900) is clean (offRight 0), so it is the shrink that breaks it.

Suggested fix: re-run the clamp on window resize (a `resize` listener that re-clamps the stored
offset against the current viewport, or clamp in `applyDragOffset` against live geometry) so the
panel can never end up outside the viewport after the window shrinks.

Screenshot: screenshots/adv-p33-dialog-clipped-1100x760.png,
screenshots/adv-p33-dialog-resize.png.

Disposition: ACCEPTED -> DEF-283 (MEDIUM; the dialog's stored offset must be re-clamped whenever the window resizes, so a moved panel can never end up outside the viewport with Print/Close unclickable)

## Phase 33 gate — attacks that did NOT reproduce (defended)

| Attack | Result |
|---|---|
| **Preview vs printed output parity, FULL matrix** | Defended. For every pages-per-sheet (1/2/4/6/9/16) x every order (H/HR/V/VR) the dialog preview's cell sequence and grid dimensions matched an independent oracle of the shared rule, and the produced print PDF (printToPDF seam) matched too: 20/20 preview combos and 24/24 produced combos + 2 partial-last-sheet cases with **0 mismatches**. The arrangement was verified by mapping each produced sheet's embedded image hashes back to source pages (unique fixture `pages16.pdf`). `test-fixtures/adv-p33/parity.cjs`. |
| **Partially filled last sheet** | Defended. 5 pages at 4-up Vertical: sheet 2 holds only page 5 in the first filled slot with the empty cells blank (no earlier image shifts). 8 pages at 6-up HorizontalReversed: sheet 2 holds pages 8 then 7 in the expected cells. |
| **Movable dialog at every drag extreme (repeated)** | Defended. 8 directions x 3 repeats of +/-4000 px drags all left the dialog fully inside the viewport (e.g. 720x836 panel at 1440x900 clamps to left 0 / right 1440 / top 0 / bottom 900). `screenshots/adv-p33-drag-extreme-*.png`. |
| **Drag starting on the close button / on a control** | Defended. Pointerdown on `.modal-close` or `[data-print-copies]` then a 200+ px move produced drag offset (0,0): the panel never moved and the control's own press was not swallowed. |
| **Drag with a control focused; drag while a preview raster is in flight; rapid drag-release-drag (12x)** | Defended. Each moved the panel and left it inside the viewport. |
| **Controls after a move** | Defended. After dragging the panel, switching pages-per-sheet to 4 re-laid the preview to 2x2 (controls live). Screenshot `screenshots/adv-p33-dialog-moved.png`. |
| **Reopen re-centres** | Defended. After a move + close + reopen, `data-drag-x/y` were (0,0) and the rect was the default centred one. |
| **Shared-toolbar fan-out: exactly one annotation per stroke** | Defended. Armed ink in the shared bar, drew in A (A gained exactly 1, B 0), then in B (B gained exactly 1, A unchanged). No double-placement, no cross-pane leak. `test-fixtures/adv-p33/cleanprobe.cjs` (0 findings). |
| **Focusing gesture does not swallow the armed tool** | Defended. With B focused and ink armed, a stroke whose pointerdown also focused A still placed exactly one annotation (counts read with the same pane focused). An earlier apparent failure was a harness artifact - `tflexDiagnostics()` follows the focused pane, so reading a count while the other pane is focused reports that pane. |
| **Disarm convergence (Escape) + consecutive strokes + clearing the other pane** | Defended. Escape disarmed the shared tool (aria-pressed false) and a following stroke placed nothing; consecutive strokes in an already-focused pane each placed one; clearing pane B did not break placement in A. |
| **One shared toolbar / no per-pane rows** | Defended. Counts: shared=1, `.toolbar`=1, annotation toolbar=1, per-pane `.toolbar`=0. |
| **Opaque canvas in every theme** | Defended. Computed `background-color` alpha = 1 for the pane, `.document-scroller` and `.workspace-main` in light (`rgb(241,245,249)`), dark (`rgb(11,13,15)`) and frosted (`rgb(238,241,245)`); a real gutter pixel sampled at 25% zoom (166 px gutter) was alpha 255 in all three themes. Screenshots `screenshots/adv-p33-gutter3-*.png`. |
| **Strips at the 640px minimum with two documents** | Defended. At 640x520 the shared toolbar wraps to 141 px and its bottom equals the pane-header top (no overlap); both 220 px strips fit with the divider between them; pane A's strip is at A's right edge, pane B's at B's left edge, meeting in the middle. `screenshots/adv-p33-strips-wrapped.png`. |
| **Cross-strip drag at the wrapped toolbar height** | Defended. Native drag from pane A's strip to pane B's strip moved exactly one page (A 34->33, B 520->521). |
| **Divider hard drag at both extremes after wrap** | Defended. Panes stayed >= 96 px wide; nothing collapsed to zero. |
| **Single mode unchanged after leaving Multi Mode** | Defended. Toggling Multi Mode off left 0 `[data-shared-toolbar]` and 0 `[data-pane]`. |

**Total Phase-33-gate findings: 1 (0 HIGH, 1 MEDIUM, 0 LOW).**

Unreproduced / not verified (not filed):
- "Drag with the OS printer dropdown open" was not exercised: a native `<select>` opens an OS
  popup that Playwright cannot drive, so I could not hold the dropdown open while dragging. The
  header handler excludes `select` from drag-start, so the control is protected by construction.
- "Drag then immediately start a print" was only verified as far as configuration (N-up changed
  the preview after a move); the actual `printJob` after a move was not re-run because the
  parity harness prints from a freshly opened dialog.
- An early `multi.cjs` run reported a swallowed stroke after rapid arm/disarm; a controlled
  re-test (`test-fixtures/adv-p33/rapid.cjs`, `cleanprobe.cjs`) showed it was a harness artifact
  (the helper trusted a momentarily stale `aria-pressed`), not a product bug.

---

## Phase 34 gate — Multi Mode round 2

Session label: `phase-34 gate`. Ran against the real dev build via the canonical
`e2e/lib/launch.cjs` `launchApp` helper (dist rebuilt from the current `src` with
`npm.cmd run build:renderer`). Adversary harnesses live in `test-fixtures/adv-p34/`
(`composite_close.cjs`, `gi.cjs`, `geom.cjs`, `headers.cjs`, `drop.cjs`, `drop2.cjs`,
`stress.cjs`, `final_check.cjs`, `clip.cjs`, `shot.cjs`; fixtures `one-page.pdf`,
`two-page.pdf`). Harness logs in `%TEMP%\adv-p34\`. No printer was ever involved.

## ADV-070: The All Tools panel shrinks the two Multi Mode panes by UNEQUAL amounts at any split other than 50/50

- Session: phase-34 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the dev build; opened `report.pdf` (34 pages, copy `adv34-b1-alpha.pdf`)
   and `long.pdf` (520 pages, copy `adv34-b1-beta.pdf`); clicked the alpha tab; turned
   Multi Mode on; picked beta into pane B (`test-fixtures/adv-p34/geom.cjs`).
2. With the panel closed, dragged the divider to a 0.35 split (the stage's
   `--tf-split-frac` read back `0.35`).
3. Measured both panes' page-area widths (`.tab-pane[data-pane=A/B] .workspace-main`):
   A = 280 px, B = 712 px.
4. Opened All Tools (`[data-tools-badge]`, inset `--tf-tools-inset` -> `344px`) and
   measured again: A = 160 px, B = 488 px.
5. Repeated at 0.5 (A/B both 496 -> 324, delta 172 each) and at 0.65 (A 712 -> 488,
   B 280 -> 160).

Expected: REQUIREMENTS Phase 34 item 1: the reserved width "must come out of the
WORKSPACE as a whole (consumed once at the stage level), so both panes lose half of it";
success criterion 1: "the two panes shrink by the SAME amount (equal deltas within a
pixel)". That is 172 px each at every split.

Actual: the inset is subtracted from the shared base and then MULTIPLIED by each pane's
fraction, so the loss is pro-rata, not halved:
- 0.35 split: A lost 120 px, B lost 224 px (|difference| 104 px);
- 0.65 split: A lost 224 px, B lost 120 px (|difference| 104 px);
- only at 0.50 are the deltas equal (172/172), which is the single case qa's
  `phase34_panel_inset.spec.cjs` measures.
Root cause: `styles.css` pane A `width: calc((100% - var(--tf-tools-inset,0px)) *
var(--tf-split-frac) - divider/2)` and pane B's complement, plus the divider's matching
`left` (`styles.css` ~11393-11413, ~11588-11598). The requirement's "lose half of it"
needs the inset split per pane (`width: calc(100%*frac - inset/2 - divider/2)` with the
divider shifted left by `inset/2`), not applied to the base before the fraction.

Screenshot: screenshots/adv-p34-uneven-panel.png (panel open at a 0.35 split).

Disposition: ACCEPTED -> DEF-286 (MEDIUM; the operator asked for the panel to resize both panes EQUALLY - the shrink must be `inset/2` per pane at every split, not proportional to the split, so the deltas stay equal and the divider stays centred between them)

## ADV-071: At the 640 px minimum window with the All Tools panel open, Multi Mode's page areas collapse to 0 px

- Session: phase-34 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the dev build; opened two documents in Multi Mode (34-page and 520-page
   copies) (`test-fixtures/adv-p34/geom.cjs`).
2. Resized the window to the app minimum 640x520 (`BrowserWindow.setSize`).
3. Measured: pane page areas (`.workspace-main`) were 96 px each (each pane 316 px wide,
   carrying its own 220 px thumbnail rail).
4. Opened All Tools (`--tf-tools-inset` -> `344px`) and measured again.

Expected: Phase 34 item 1 / criterion 1 - opening the panel shrinks both panes and leaves
them usable; the phase's whole point is that neither pane carries a dead strip.

Actual: both pane page areas collapse to **0 px** (`.workspace-main` width 0 for A and B;
the divider sits at x=144, the panel's left edge at x=296; the stage base is 640-344=296,
so each pane is 148 px - narrower than its own 220 px rail). The document content is
completely gone at a supported window size with a supported panel open. Single mode at
the same size keeps a 76 px page scroller (verified, `final_check.cjs`), so the
stage-level inset introduced by this phase is what drives Multi Mode's page area to zero.
The `MIN_PANE_WIDTH_PX = 320` clamp cannot help: `fractionFor` computes
`min = 320/usable = 320/296 > 0.5` and parks the split at 0.5.

Screenshot: screenshots/adv-p34-minwidth-panel.png (both panes collapsed, panel open).

Disposition: ACCEPTED -> DEF-287 (MEDIUM; a supported window width with a supported panel open must never collapse a pane's page area to 0 px - the page area needs a usable minimum, so the strips (and the panel's reserved width) must yield before the pages do)

## ADV-072: "+ tab" in Multi Mode silently creates a hidden tab that only appears after leaving the mode

- Session: phase-34 gate
- Suggested severity: MEDIUM

What I did:
1. Launched the dev build; opened two documents in Multi Mode (one composite tab shown)
   (`test-fixtures/adv-p34/composite_close.cjs`, case J).
2. Clicked the tab strip's "+" (New empty tab) button (`[data-new-tab]`).
3. Read the strip before and after: still exactly ONE tab (`tf-multi-workspace`); the
   label is unchanged; nothing visible happened.
4. Turned Multi Mode off (the shared toolbar's toggle).

Expected: a control that adds a tab must give visible feedback. In Multi Mode it should
either be hidden/disabled, or route the new tab into the focused pane (Phase 33 open
semantics); a click that appears to do nothing is a defect (AGENTS.md fail-loud rule).

Actual: `onNewEmptyTab` unconditionally dispatches `tabs.open-empty`; the Phase-34
`stripTabs` projection renders only the composite tab, so the new empty tab is created
HIDDEN (visibility hidden, no pane) and becomes `tabs.activeId`. After leaving the mode
the strip shows three tabs and the "Empty tab" is the ACTIVE one, with the welcome screen
shown - a delayed, surprising state change the user never asked for and could not see.

Screenshot: none (state-only; see the case-J log in `%TEMP%\adv-p34\composite_close.log`).

Disposition: ACCEPTED -> DEF-288 (MEDIUM; with one composite tab the "+" must never create a hidden tab - while the mode is on it must put the new empty document into the FOCUSED pane, consistent with the Phase 33 open semantics, or be visibly disabled)

## ADV-073: The composite tab's close X silently no-ops when both panes are empty

- Session: phase-34 gate
- Suggested severity: LOW

What I did:
1. Launched the dev build; opened two documents in Multi Mode
   (`test-fixtures/adv-p34/composite_close.cjs`, case K).
2. Cleared pane B, then pane A (both panes show their empty state; the composite tab's
   label becomes "Multi Mode").
3. Clicked the composite tab's close X (`.tab[data-tab-id="tf-multi-workspace"] .tab-close`).

Expected: closing the workspace tab should do something - leave Multi Mode, close the two
(now unpaned) documents, or at minimum the X should be disabled/hidden. A rendered close
control that does nothing is a fail-loud defect.

Actual: nothing happens at all: tab count stays 1, `data-multi-mode` stays `true`, both
panes stay empty. `onCloseCompositeTab` returns early because `compositeDocIds(paneA,
paneB)` is empty (App.tsx ~7008-7009).

Screenshot: none (state-only; see the case-K log).

Disposition: ACCEPTED -> DEF-289 (LOW; the composite tab's close must never silently no-op - with both panes empty it must still leave the workspace (or the control must be visibly disabled with a reason))

## ADV-074: The canvas insertion line for the FIRST page is clipped and invisible

- Session: phase-34 gate
- Suggested severity: LOW

What I did:
1. Launched the dev build; opened two documents in Multi Mode; scrolled pane B to the top
   (`test-fixtures/adv-p34/clip.cjs`, `drop2.cjs`).
2. Started a page drag from pane A's rail and hovered the TOP HALF of pane B's first page
   (insert-before page 1).
3. Read the rendered `[data-drop-indicator]` rect and the `.document-scroller` rect.

Expected: Phase 34 item 5: "While a page is dragged, a clearly visible line spanning the
page column is shown in the GAP where the page will land ... for the FIRST page" (the
attack brief explicitly lists the first page). The rail already special-cases it
(`.thumb-drop-line-first { top: 0 }`).

Actual: the line is rendered at `top: -9px` relative to the first page slot
(rect `{top:122, bottom:127}`) while the scroller's top edge is `y=131` with
`overflow: hidden auto`; the indicator is entirely above the scroller and is clipped
(`indicatorClipped: true`). The screenshot shows no line above page 1 - only the page
slot's blue drop outline. There is no first-page special case for
`.page-drop-indicator-before` (the base `top:-9px` is unchanged from before this phase;
the phase's taller 5 px line with a glow is still invisible here).

Disposition: ACCEPTED -> DEF-290 (LOW; the canvas insertion line must be visible for the FIRST page too - mirror the rail's first-slot handling so the line for "insert before page 1" is inside the scroller's visible area rather than clipped above it)

Screenshot: screenshots/adv-p34-firstline-confirm.png,
screenshots/adv-p34-firstline-clip.png.

## Phase 34 gate — attacks that did NOT reproduce (defended)

| Attack | Result |
|---|---|
| **Composite close, both clean** | Defended. Both documents closed, `data-multi-mode=false`, tab count 0, welcome shown. |
| **Composite close, A dirty only / B dirty only** | Defended. Exactly the dirty document was prompted (by name), discard closed BOTH and left the mode. |
| **Composite close, both dirty, Save on one + Don't-save on the other** | Defended. The saved file's mtime advanced; the pair closed; welcome shown. |
| **Composite close, both dirty, Cancel on the SECOND prompt** | Defended. Both documents survived, the composite tab stayed (with its modified dot), Multi Mode stayed on, pane counts 34/520 intact. |
| **Composite close, both dirty, Save each; disk content** | Defended. Both temp copies' mtimes advanced and reopening the saved alpha read `rotations[0]=1` - the rotation was actually persisted, not just marked clean. |
| **Composite close with an extra background tab** | Defended. After the close the background gamma tab remained, was active, and the mode was off (`openTabs=1`). |
| **Close prompt interrupted by a Multi Mode toggle** | Not reachable by pointer: the modal backdrop blocks the shared toolbar's toggle (`trial` click timed out). No state corruption. |
| **Tab-strip integrity across 5+ on/off toggles** | Defended. Multi: exactly one tab, id `tf-multi-workspace`, `aria-selected=true`. Single: exactly two real tabs, exactly one active, every tab activatable, all close buttons present. No duplicates/lost/orphaned tabs. |
| **Clicking the composite tab / focusing a pane then clicking it** | Defended. No state change (the deliberate no-op); pane focus is unchanged. |
| **Opening a document while the mode is on** | Defended (unchanged Phase-33 semantics): it replaces the focused pane's document, never a hidden tab. |
| **Headers flanking the divider** | Defended at the default split, both extremes, and with 90-char names: A's name+count end at/left of the divider, B's badge+name start at/right of it; the clear control is on the OUTER side on both. Names update when a pane's document is replaced. |
| **Empty pane header** | Defended. No `[data-pane-clear]` is rendered for an empty pane; the pane A header still flanks the divider. |
| **`[data-pane-clear]` clickability** | Defended at both near-min splits and at the 640 px minimum with the panel open (trial clicks actionable). |
| **Divider tracks the pointer 1:1** | Defended. At requested 0.30/0.50/0.70 the divider's left matched the stage fraction within 0 px (no transition on the geometry). |
| **Divider at both extremes with the panel open** | Defended. Pane widths stayed >= ~316 px (the 320 px clamp minus the divider half), the divider stayed between the panes, pane B never overlapped the panel. |
| **Divider visibility in every theme** | Defended. Computed background `rgb(46,53,61)` dark / `rgb(203,213,225)` light / `rgba(15,23,42,0.18)` frosted, 8 px band, grip 20x44 px `opacity:1` in all three; pane B stayed flush with the panel after each theme change. |
| **Panel/pane lockstep at rest** | Defended. Pane B's right edge minus the panel's left edge = 0 px (no gap, no overlap) with the panel open. |
| **Rapid panel open/close (10x)** | Defended. Inset returned to `0px`, panel detached, pane widths restored exactly (496/496). |
| **Panel opened mid page-drag** | Defended. The inset applied (`344px`), the insertion indicators stayed correct, and they cleared on drag end. |
| **Drop line boundaries** | Defended. Canvas before-line for page 1 renders (clipped, ADV-074), before/after lines for internal pages, the append line for the last page's lower half, the 1-page document, and the empty pane (no line). |
| **Rail insertion line + append** | Defended. First-thumb line uses the `-first` variant; after a real scroll to the end of the 520-page rail the append line sits directly below the last thumb and inside the viewport; lines clear on drag end. |
| **Hover that leaves the pane** | Defended once a real `dragleave` is dispatched: `drag.hover(null)` clears the canvas line. (The earlier apparent "stale line" was a harness artifact - synthetic `dragover` on a non-slot element never fires `dragleave`.) |
| **Panel open at the 640 px minimum, single mode** | Single mode keeps a 76 px page scroller (unchanged behaviour); only Multi Mode collapses (ADV-071). |

**Total Phase-34-gate findings: 5 (0 HIGH, 3 MEDIUM, 2 LOW).**

Unreproduced / not verified (not filed):
- "Toggle Multi Mode while a close prompt is open" could not be reached by a pointer: the
  modal backdrop swallows the click. The composite-queue refs are also cleared on any
  Cancel, so the interruption path is closed by construction.
- "Panel toggle while a thumbnail raster is in flight" was only exercised as part of the
  rapid-cycle and mid-drag runs (no blank frames observed); a dedicated 16 ms frame
  sampler was not re-run for this phase because qa's `phase34_panel_inset.spec.cjs`
  already covers the open/close frame sampling at the default split.
- The composite tab at the 640 px minimum overflows the 77 px-wide `.tab-list`
  (`listScrollWidth 265`), but a normal single-document tab overflows the same way at
  that width, so it is the pre-existing narrow-strip behaviour, not a Phase-34 change.
- "Divider drag while the panel is open" was not a no-op (it re-splits correctly), so no
  silence finding there.

## Phase 35 gate — Windows integration, printing and window behaviour

Session label: `phase-35 gate`. Ran against the dev build (`dist/main/index.js` +
`dist/renderer`, launched only through `e2e/lib/launch.cjs` `launchApp`). Probe scripts and
fixtures live in `test-fixtures/adv-p35/`; raw logs in `%TEMP%\adv-p35\`.

## ADV-075: Clicking the caption "+" (new tab) crashes the renderer and leaves a blank, unrecoverable window

- Session: phase-35 gate
- Suggested severity: HIGH

What I did:
1. Launched the dev build, opened `report.pdf` (1 tab), waited for the canvas.
2. Clicked the tab-strip "+" button (`[data-new-tab]`) — the new-tab control that sits in the
   Phase-35 caption drag region (`test-fixtures/adv-p35/newtab_probe.cjs`).
3. Read the DOM after the click: tab list, `.titlebar`, `.toolbar`, `.app-header`, `.app`,
   `#root.innerHTML.length`, and the captured `pageerror`.

Expected: a new empty tab opens and the app stays usable (the "+" affordance is enabled once
`tabs.length >= 1`).

Actual: the renderer throws `TypeError: Cannot read properties of undefined (reading
'session')`; React unmounts the whole tree (`#root.innerHTML.length` 0; `.titlebar`,
`.toolbar`, `.app-header`, `.app`, every tab and the welcome pane all gone). The window is
left as a blank opaque `#eef1f5` surface with no chrome and no control — unrecoverable
without restarting the app. Reproduced on every run (the crash is deterministic).

Root cause: `src/renderer/App.tsx:6941` derives `const activeTab = tabs.activeId !== null ?
openTabs[tabs.activeId] : null;`, and `onNewEmptyTab` (line 1835) only dispatches
`open-empty` — it never adds an `openTabs[id]` entry, so for an empty tab `activeTab` is
`undefined` (not `null`). The Phase-35 detach prop at lines 8152-8160 does
`activeTab === null ? null : { docId: activeTab.session.engineDocId, ... }`; `undefined ===
null` is false, so `activeTab.session` throws. Verified pre-Phase-35 (`git show
HEAD:src/renderer/App.tsx`) that every other `activeTab` access used the optional form
`activeTab?.session...`; the unguarded read was introduced with the Phase-35 detach prop.
The guard on line 7394 already shows the codebase treats `activeTab` as possibly `undefined`.

Screenshot: screenshots/adv-p35-newtab.png (blank window after the crash).

Disposition: ACCEPTED -> DEF-299 (HIGH; the Phase 35 detach prop must not dereference an undefined active tab - a caption "+" click must never blank the renderer, and every access on that path must match the optional-chaining the rest of the file uses)

## ADV-076: With the standalone print window open, an OS file-open (second launch / "Open with") is silently dropped

- Session: phase-35 gate
- Suggested severity: HIGH

What I did:
1. Launched the dev build, opened `report.pdf`; opened the standalone print window for that
   document via `window.tflex.printWindow.open(...)` and waited for `[data-print-window]`.
2. Logged `BrowserWindow.getAllWindows()` order and `getFocusedWindow()`.
3. Fired the OS second-launch path: `app.emit('second-instance', {}, [electron, '.',
   <other.pdf>])` (the same handler a real "Open with" / Explorer double-click uses).
4. Waited, then read the main window's tab list and the print window's document name.
5. Also pushed `app:openPathRequest` directly to the print window's webContents.
   (`test-fixtures/adv-p35/pw_osopen.cjs`.)

Expected: the OS-supplied PDF opens in the main window (requirement item 2: "a second launch
while TFlex is running opens the document in the RUNNING instance"), or at minimum fails
loud.

Actual: with the print window open, `getAllWindows()` returned `[PRINT, MAIN]` — index 0 is
the PRINT window (also the focused window). `sendOpenPath` (`src/main/index.ts:63-70`) sends
`IPC.appOpenPathRequestEvent` to `BrowserWindow.getAllWindows()[0]`, i.e. the print window.
`PrintWindowApp` never subscribes to `onOpenPathRequest`, so the event is discarded with no
error and no toast: the main window's tab list was unchanged and the requested document was
never opened. Reproduced twice (deterministic). The `second-instance` handler's
focus/restore (`index.ts:100-106`) also targets `[0]`, so a second launch focuses the print
window rather than the main window. When no print window is open, `[0]` is the main window
and the open works (verified separately), so the failure is specific to having this phase's
print window open.

Log: %TEMP%\adv-p35\target.log (raw window order + tab state before/after).
Reproduced a third time fully UI-driven: opening the print window with the real
`[data-print-detach]` ("Separate window") button gives the same `[PRINT, MAIN]` order
(focused PRINT), and the following second-instance left the main window's tabs unchanged
(`test-fixtures/adv-p35/detach_repro.cjs`, %TEMP%\adv-p35\detach_repro.log).

Disposition: ACCEPTED -> DEF-300 (HIGH; an OS file-open must reach the MAIN window, not whichever window happens to be first in the list - with the print window focused the open was silently dropped, so the request must be routed to the main window explicitly (and the print window must never swallow it))

## ADV-077: The in-app print dialog's printer selection silently reverts to the system default, routing a virtual-PDF job to the physical printer

- Session: phase-35 gate
- Suggested severity: MEDIUM

What I did:
1. Launched, opened a PDF, opened Print (`[data-print]`), waited for the printer list,
   selected "Microsoft Print to PDF" (`[data-print-printer]`), closed the dialog.
2. Reopened Print, selected "Microsoft Print to PDF" again, then polled the select value
   every 100 ms while counting `getPrintersAsync` calls (`test-fixtures/adv-p35/printer_race.cjs`).
3. Repeated the full virtual-PDF save sequence with the physical print call stubbed in main
   (so no paper could print) and logged the selected printer immediately before each confirm
   (`test-fixtures/adv-p35/pdf_route_real.cjs`).

Expected: the chosen printer stays chosen; a virtual-PDF destination is produced inside
TFlex through its own Save-As dialog (success criterion 3).

Actual: on a re-open the hook still holds the previous activation's `printers` state, so the
options render immediately and the user's selection is made before the fresh
`getPrintersAsync` resolves. When it resolves, the printer-load effect's `.then` calls
`setDeviceName(preferred)` (the system default) and silently overwrites the selection.
Measured timeline: selected "Microsoft Print to PDF" at t=9 ms, silently reverted to
"Canon TS3100 series" (the system default) at t=114 ms. With the default selected,
`printJob` took the non-virtual branch and called `webContents.print({ silent: true,
deviceName: 'Canon TS3100 series' })` — a silent print to the PHYSICAL default printer
instead of producing the PDF inside TFlex. Reproduced in two independent runs, on different
cases each time (intermittent, timing-dependent). The root logic is
`src/renderer/components/usePrintControls.ts` (printer-list effect deps `[active,
listPrinters, seed]`, `printers` state persisting across activations).

Scope note: this effect is byte-identical to the pre-Phase-35 `PrintDialog.tsx` at HEAD
(deps `[open, listPrinters]`, same `setDeviceName(preferred)`), so the defect pre-dates this
phase; Phase 35 relocated it into the shared hook that both print surfaces now use. Filed
because it directly defeats the phase's own success criterion 3 and the operator's item 7.

Logs: %TEMP%\adv-p35\race.log (timeline), %TEMP%\adv-p35\routing_real.log (routed to
Canon while "Microsoft Print to PDF" was selected).

Disposition: ACCEPTED -> DEF-301 (MEDIUM; the printer pick must survive the async printer-list resolution - a stale list must never overwrite the user's selection, because routing a virtual-PDF job to the physical printer defeats the phase's own criterion 3 and the operator's Print-to-PDF request)

## Phase 35 gate — attacks that did NOT reproduce (defended)

| Attack | Result |
|---|---|
| **Hostile print-window contexts** (null / array / string / missing docId / blank docId / numeric docId / negative, fractional, NaN, Infinity, string or >50 000 page count / null-array-string settings) | Defended. Every malformed context resolved `{ ok:false, reason }` and created NO window; exactly one window for valid contexts. |
| **Ghost / never-opened docId** | Defended. Window opens, shows the load-error banner with the engine's message; Print is disabled. No crash. |
| **Huge context (200 000-char documentName)** | Defended. Window loads and renders the print UI (200 KB query string); no crash. |
| **20 repeat opens of the same doc** | Defended. One window only (`maxPrintWindows=1`); first `created:true`, rest `created:false` (focus). |
| **Doc change reload** | Defended. Opening for a second real document reloads the singleton; the header name and page count update. |
| **Print window close leaves the app usable** | Defended. Print windows 0, main window 1, app tabs intact. |
| **Print window resize to 1x1 and to 100 000x100 000** | Defended. OS clamps to the 480x520 minimum and to ~43690; no crash, resizable/minimizable/maximizable true. |
| **Document-gone path** | Defended. Closing the print window's own tab shows the gone banner and disables Print; closing a DIFFERENT tab leaves the print window untouched. |
| **Save-dialog cancel (virtual destination)** | Defended. Save dialog invoked once, then quiet: no error, no success, no hidden window created, no file. |
| **Virtual-PDF produced-file validity** | Defended. 1-up (pages 1-5) → valid `%PDF-`, 5 portrait pages; 2-up landscape reverse (1-6) → 3 landscape pages; 200-page selection → valid 200-page PDF in ~55 s. |
| **Produced-file page ORDER** | Defended. With the 6-page distinct fixture, reverse + 2-up, the composed print images matched the preview exactly: sheet 1 = [6,5], sheet 2 = [4,3], sheet 3 = [2,1] (`test-fixtures/adv-p35/distinct6.pdf`, `pdf_order.cjs`, `match_composed.mjs`). |
| **No OS print window on the virtual path** | Defended. `EnumWindows` on the app pid showed no new visible window before/after the print; `webContents.printToPDF` was the only pipeline call. |
| **Virtual save to a directory / removed drive / read-only file / unicode path** | Defended. Directory/removed-drive/read-only fail loud ("Could not write the PDF to the selected location."); unicode path saves and opens. (See ADV-077 for the separate selection race that can divert these to a real printer.) |
| **Caption-strip control clickability** | Defended. Hit-test across 61 points: 0 "other" (dead) points; real clicks on the menu, theme, Open, preferences gear (`[data-prefs-dialog]` appears), Print (`[data-print-printer]` appears) and maximize all produced their effect. |
| **10x maximize/restore + minimize/restore** | Defended. Toggled cleanly each cycle; minimized then restored. |
| **Opaque window** | Defended. `getBackgroundColor` `#EEF1F5`; body/html `rgb(238,241,245)`; screenshot shows normal chrome, no transparency artifacts. |
| **Hostile saved geometry** (off-screen, negative, tiny, huge, NaN/strings, maximized) | Defended. Every case landed inside a display's work area (3 displays; huge/partial cases correctly chosen onto the largest display). |
| **Corrupt settings.json / 30 missing recent files** | Defended. App boots on defaults, welcome renders, no crash. |
| **Hostile `app:openPathRequest` payloads** (array, object, number, null, empty, whitespace, 100 000-char string, non-PDF, directory, missing, quotes/unicode, `..`) | Defended. Renderer rejects non-strings with "invalid file path from Windows"; the rest fail loud with a toast; no tab created, no crash. |
| **Second-instance argv** (valid PDF, non-PDF, no file, switch-then-file, non-string entries) | Defended. Valid PDF opens; non-PDF shows the error box; switches skipped. |
| **Same-file dedupe via OS-open** | Defended. Two pushes of the same path → exactly one tab. |
| **OS-open in Multi Mode** | Defended. Lands in the focused pane (replaces the focused pane's document), no hidden tab; opening while Preferences is up opens the document behind the modal with no crash. |
| **Drop path** (non-PDF, synthetic PDF, multi-file, text/plain, onto a control, during a page drag, while a modal is open, on the welcome screen) | Defended. Non-PDF and unresolvable drops fail loud with a toast; a `text/plain` (in-app page-drag) drop is ignored; no tab, no crash, no interference with the modal or the page drag. |
| **Print-window open/close resource leak** | Defended. 15 open/close cycles kept the process count at 4 and windows at 1 (working set drifted ~+1.3 MB/cycle, consistent with normal cache growth, not unbounded); 20 sequential opens produced exactly one print window. |

**Total Phase-35-gate findings: 3 (2 HIGH, 1 MEDIUM, 0 LOW).**

Unreproduced / not verified (not filed):
- **Real OS caption gestures** (double-click-to-maximise, drag-to-top Aero Snap): attempted
  with genuine `user32` `SetCursorPos` + `mouse_event` input at a verified drag-only caption
  point, with the window forced foreground via its HWND (`win_gestures2.cjs`). Neither a real
  drag-move nor a real double-click moved/maximised the window, so the injected input appears
  not to reach the app's non-client handling in this environment; the result is inconclusive,
  not evidence of a defect. The gate's hit-test (strip is draggable everywhere) is the
  available evidence.
- **Real OS file drop happy path**: a synthetic `DataTransfer` `File` has no on-disk path, so
  `webUtils.getPathForFile` cannot resolve it; only the error/notice branches were exercised.
  The successful drop-open path was not automatable.
- **Startup argv path** (`TFlex.exe <pdf>` on a cold launch): `launchApp` passes extra args
  before the app path, which Electron would treat as the app directory, so the cold-launch
  argv could not be driven; the identical parser/handler was exercised through
  `second-instance` instead (ADV-076).
- **A partial/corrupt file left behind by a mid-write failure**: not reproducible without a
  filesystem that fails after `writeFile` opens (ENOSPC / device error). Code inspection:
  `produceVirtualPdf` (`src/main/services/print.ts:587-595`) returns `save-write-failed` on a
  write error but does not delete a partially written file. Worth a look, but no repro.
- **Hostile `settings` fields inside a valid print-window context** (e.g. `pagesPerSheet: 3`):
  main's validator accepts any plain object, so such a context creates a window whose N-up
  select is inconsistent with the internal state and whose Print would be rejected by
  `validatePrintPayload` with the raw reason `bad-pages-per-sheet`. Only reachable via a
  hand-crafted IPC call (the app always builds valid settings), so not filed.
- **`second-instance` with a null/non-array argv**: `extractFileArgument` throws
  (`Cannot read properties of null (reading 'length')`) for a null argv. Electron always
  supplies an array from the OS, so this is not reachable in practice.
- **Zero-file "Files"-typed drop** (`dt.setData('Files', ...)`): Chromium ignores the reserved
  type, so `dataTransfer.types` never contained "Files" and the empty-files branch could not
  be reached synthetically.
- **Print window opened while the main window is mid-close**: the modal close gate and the
  separate OS window make this unreachable by pointer; the gate's app-close test covers the
  teardown path.

## Phase 36 gate — TFlex STAGES (information architecture)

Session label: `phase-36 gate`. Ran against the real dev build (`npm.cmd run build` output in
`dist/`, launched via `e2e/lib/launch.cjs` `launchApp` with `--disable-gpu`). Harnesses live in
`test-fixtures/adv-p36/` (`lib.cjs`, `p1_surface.cjs`, `p2_reach.cjs`, `p3_focus.cjs`,
`p4_flyout_geom.cjs`, `p5_dock_states.cjs`, `p6_idle_restart.cjs`, `p7_multi.cjs`,
`p7b_dock_dup.cjs`, `p7c_dock_vis.cjs`, `p8_settings_chrome.cjs`, `p8b_chrome.cjs`,
`p8c_tabclose.cjs`, `p9_discipline.cjs`, `p9b_actionable.cjs`, `p10_evidence.cjs`,
`p11_palette_noop.cjs`); screenshots in `screenshots/adv-p36/`.

The full registry walk (94 entries in `src/renderer/state/toolsRegistry.ts`, each reached through
its host surface) is in the session report; every entry was reachable. Five findings were filed.

## ADV-078: The Command Palette shows several commands as enabled although they cannot run, and running them is a silent no-op

- Session: phase-36 gate
- Suggested severity: MEDIUM

What I did:
1. Built the dev bundle and launched it (`e2e/lib/launch.cjs` -> `launchApp`), opened a copy of
   `assets/samples/report.pdf`, and captured `window.tflexDiagnostics()` for the baseline
   (`canUndo: false`, `canRedo: false`, `activeTool: null`, one tab).
2. From the `Ctrl+K` palette, searched and ran each of: `Undo`, `Redo`, `Add a text box`,
   `Edit text`, `Edit images`, `Open a PDF into a pane`, `Clear a pane`. For each row recorded
   `data-palette-disabled` and `title`, clicked the row, and diffed state
   (modal/backdrop count, toasts, `[data-edit-toolbar]`, `[data-multi-mode="true"]`) before/after.
3. Contrasted with the Action Dock at `Ctrl+2`, which renders the same edit commands.

Expected: a row whose command cannot run is either disabled with the reason (the palette already
does this correctly for `batchOcr` = "Open a second document first", `ocrSuspects` = "Run
Recognize text first", `annColor`/`annPenWidth`, `panePick`, `paneResize`) or running it fails
loud. Per AGENTS.md a control that triggers nothing is a defect.

Actual: all seven rows rendered `data-palette-disabled="false"` with their normal description as
the tooltip; clicking each closed the palette and produced NO toast, NO dialog and NO state
change. Specifically: `undo`/`redo` are enabled on a fresh document with empty undo/redo stacks
(`App.tsx` `onUndo`/`onRedo` return early when the counter is 0); `editTextBox`/`editText`/
`editImage` are enabled while Edit mode is OFF and their handlers are `edit?.onAction(...)` with
`edit === null` (the dock renders the SAME commands disabled with "Turn on Edit content first");
`paneOpen`/`paneClear` are enabled outside Multi Mode and their handlers are guarded by `if
(multiMode.enabled)` (`App.tsx` `paletteAppActions`). The palette's only availability gate
(`paletteToolEnabled`) maps the registry's `document` precondition to "a document is open" and
never consults the undo counters, the edit-mode flag or the Multi Mode flag.

Screenshot: screenshots/adv-p36/p10-palette-pane.png (`paneOpen`/`paneClear` enabled);
`p11_palette_noop.cjs` output has the per-row before/after diff.

Disposition: ACCEPTED -> DEF-327 (MEDIUM; the palette must not present a command as runnable when it cannot run - disable it with the SAME availability reason the dock already shows, so `undo`/`redo` on an empty stack and the Edit tools with Edit mode off are gated, and Multi-Mode-only commands are gated outside Multi Mode; a silent no-op is a fail-loud violation)

## ADV-079: The EDIT stage's "Review suspects" button is enabled before any OCR run and is a silent no-op

- Session: phase-36 gate
- Suggested severity: MEDIUM

What I did:
1. Opened a copy of `report.pdf` (no OCR run), pressed `Ctrl+2` (EDIT stage).
2. Read `[data-context-panel-action="suspects"]`: `disabled=false`, no `title`.
3. Clicked it and checked for `[data-ocr-suspects-panel]` and toasts.

Expected: the button is disabled with the same reason the Command Palette's `ocrSuspects` row
shows ("Run Recognize text first"), or the click fails loud.

Actual: the button looks and behaves as available, but clicking it produces no suspects panel
and no toast. `App.tsx` `onOpenOcrSuspects` returns early unless
`ocrRunByTabRef.current[activeId] === true`; the ContextPanel only gates the button on the
handler being undefined, not on the live OCR state.

Screenshot: screenshots/adv-p36/p10-edit-suspects.png

Disposition: ACCEPTED -> DEF-328 (MEDIUM; the EDIT panel's "Review suspects" entry must be gated exactly like its palette row - enabled only after an OCR run produced suspects, with the same reason copy; never an enabled no-op)

## ADV-080: The Inspector's "Rotation" value shows the raw quarter-turn index with a degree sign ("1°" for a 90° page)

- Session: phase-36 gate
- Suggested severity: MEDIUM

What I did:
1. Opened a copy of `report.pdf`, pressed `Ctrl+1` (PAGES).
2. Right-clicked page 1's thumbnail and chose "Rotate CW".
3. Read the Inspector's Rotation row (`[data-inspector-value="rotation"]`) and the rendered page
   element's class.

Expected: `90°`. `EngineState.rotations` is a quarter-turn counter (`stubEngine.ts` does
`(rot + delta) % 4`) and every consumer multiplies it by 90 before display
(`PageView.tsx:526` `const rotDeg = (rotation * 90)`, `SideRail.tsx:1387` the same).

Actual: the Inspector showed `1°` while the page element was `pdf-page pdf-page-rot-90`. After a
second rotation it reads `2°`; rotating counter-clockwise from 0 reads `3°`. `Inspector.tsx`
`renderPageSection` renders `${pageRotation}°` and `App.tsx:8407` passes
`activeEngineUi?.state.rotations[currentPage - 1]` straight through, so the degree sign is
appended to the index. It is the only value the Phase 36 PAGES inspector exposes for rotation
("Rotation is a VALUE (no rotate affordance)"), so the single read-only value is wrong by 90x.

Screenshot: screenshots/adv-p36/p10-inspector-rotation.png

Disposition: ACCEPTED -> DEF-329 (MEDIUM; the Inspector's Rotation row must show the real rotation in degrees - the raw quarter-turn index with a degree sign ("1°" for a 90-degree page) is a wrong read-only value, i.e. misinformation)

## ADV-081: On the default maximised window the DELIVER dock wraps onto two rows and the PAGES/EDIT docks drop every label

- Session: phase-36 gate
- Suggested severity: MEDIUM

What I did:
1. Opened a copy of `report.pdf` at the default maximised window (1442x903; canvas host 914px).
2. Walked `Ctrl+1..4` and measured `.action-dock` rect, `data-dock-band`,
   `data-dock-icon-only`, `data-dock-lift`, the label count, and both floating pill rects.

Expected: one row of labelled verbs per stage, clear of the page/zoom pills.

Actual:
- DELIVER (5 labelled verbs): the dock is capped at the measured band (`data-dock-band="422"`)
  and WRAPS to two rows, 422.4x87.3px instead of one ~37px row; "Export to Word (.docx)" sits
  alone on a second row (screenshot p1-stage4.png).
- PAGES and EDIT (6 verbs): `data-dock-icon-only="true"` and no labels at all, while REVIEW (4
  verbs) keeps its labels at the same window size.
- Geometry: the two pills + their insets measure a ~492px reserve on a 914px host, leaving a
  422px band; `labelledDockNeed` (`dockFit.ts`) budgets only 64px/verb, so the estimate says the
  PAGES set (6 verbs -> 420+8) does not fit while the DELIVER set (5 -> 352+8) "fits" and then
  wraps. No pill overlap was measured (`dockRect` never intersects either pill at any stage), so
  this is a layout-quality regression, not the DEF-315 clearance bug. This corroborates the
  already-OPEN DEF-315 (narrow-width dock vs zoom pill) but the two-row wrap is a distinct
  outcome at the app's own default window size.

Screenshot: screenshots/adv-p36/p1-stage4.png, screenshots/adv-p36/p3-dock-pages.png

Disposition: ACCEPTED -> DEF-330 (MEDIUM; at the DEFAULT maximised window the dock must render as designed - the DELIVER dock wrapping onto two rows and the PAGES/EDIT docks dropping every label is a layout regression at the app's normal size, not just at the narrow extremes)

## ADV-082: Escape with the Command Palette open over a dialog closes the dialog and leaves the palette

- Session: phase-36 gate
- Suggested severity: LOW

What I did:
1. Opened a copy of `report.pdf`, pressed `Ctrl+3` (REVIEW), clicked the dock's `stamp` verb
   (Stamp dialog open).
2. Pressed `Ctrl+K` (palette opens on top of the still-open dialog).
3. Pressed Escape once and checked which surfaces remained.

Expected: the topmost surface (the palette) closes on Escape, or both close; the palette's own
key handler is bound while it is open.

Actual: the Stamp dialog closed and the palette stayed open (palette open, dialog gone); a second
Escape closed the palette. Both surfaces are `aria-modal="true"` while open, so the window
carried two stacked modal layers and Escape addressed the lower one. Recoverable, hence LOW.

Screenshot: none (state-only; `p4_flyout_geom.cjs` -> `out/p4.json` records
`paletteOverDialog.afterEsc = { paletteOpen: true, dialogOpen: false }`).

Disposition: ACCEPTED -> DEF-331 (LOW; with the palette open over a dialog, Escape must close the TOP-most surface - the palette - rather than closing the dialog underneath and leaving the palette)

## Phase 37 gate - STAGES feedback round (22 operator items)

Session label: `phase-37 gate`. Ran against the real dev build via
`e2e/lib/launch.cjs` (`test-fixtures/adv-p37/lib.cjs` `boot`, dev main + dist renderer).
Harnesses live in `test-fixtures/adv-p37/` (`p1_ladder.cjs`, `p2_rail_arrows.cjs`,
`p3_dock.cjs`, `p4_print.cjs`, `p5_edittext.cjs`, `p6_inspector.cjs`,
`p7_annotate_wm.cjs`, `p8_annotate.cjs`, `p8b_single_panel.cjs`, `p9_surfaces.cjs`,
`p9b_flyout.cjs`, `p10_ladder_labels.cjs`, `p11_print2.cjs`, `p11b_empty_print.cjs`,
`p12_toggle.cjs`, `p13_latch.cjs`; raw JSON in `test-fixtures/adv-p37/out/`).
Screenshots in `screenshots/adv-p37/`. Every probe opened a COPY of a bundled sample.

Defended (no finding): the ladder thresholds themselves and their reverse
(Inspector at 1199/1200, panel at 999/1000, arrows at 719/720; down-sweep and
up-sweep state identical, no oscillation, no stacking - verb rows = 1 at every
width, no dock/pill overlap); the welcome/document Stage Rail truth table; the
panel chevron flip (collapse/expand, aria + `data-collapse-direction`); the
184px PAGES panel with no title; the Outline flush to the panel bottom; the
Multi Mode strip at 150px with the full right-click menu and hover verbs; the
dock surface identical in light/dark/frosted (same height/gap/padding/font);
the Inspector text panel integrated at the TOP with the divider and one
instance only (DEF-321 holds) in both the EDIT and annotate flows, the column
scrolling; the EDIT-stage-as-switch (no `editMode`/`Edit content` verb); the
text-run bar Confirm/Delete/Cancel with the selected text staying visible and
Cancel/Delete clean; the watermark gate (enabled with a document, correct
reason when disabled); `dockUnpinned` persistence, cross-stage pin/unpin
coherence, and hostile/oversized/duplicate `dockUnpinned` on disk (all
sanitised, no crash); the standalone print window via the title-bar icon and
the native File > Print / Ctrl+P item (singleton focus, document-gone banner,
no `[data-print-dialog]` anywhere).

## ADV-083: At the default 1440 window the PAGES dock drops every label while the Inspector and panel stay expanded - the label rung fires far above its documented threshold

- Session: phase-37 gate
- Suggested severity: MEDIUM

What I did:
1. Booted the dev build (`test-fixtures/adv-p37/lib.cjs`), opened a copy of
   `assets/samples/report.pdf`, pressed Ctrl+1 (PAGES) then Ctrl+4 (DELIVER).
2. Swept the window content size 1920x900 down to 640x900 in steps and back up
   (`BrowserWindow.setContentSize`; `window.innerWidth` is the content box).
   At each width recorded `.app-main[data-inspector-collapsed]`,
   `[data-context-panel][data-context-panel-collapsed]`, and the dock's
   `data-dock-icon-only` / `data-dock-arrows` / visible `.action-dock-label`
   count / verb-row count. Harness `p1_ladder.cjs`, `p10_ladder_labels.cjs`.

Condensed table (PAGES; down and up runs identical, so only one row per width):

| innerWidth | Inspector | panel | dock labels | arrows | verb rows |
|---|---|---|---|---|---|
| 1920 | expanded | expanded | 8 | no | 1 |
| 1700 | expanded | expanded | 8 | no | 1 |
| 1600 | expanded | expanded | 8 | no | 1 |
| 1500 | expanded | expanded | 8 | no | 1 |
| 1450 | expanded | expanded | 0 | no | 1 |
| 1440 (default) | expanded | expanded | 0 | no | 1 |
| 1400-1200 | expanded | expanded | 0 | no | 1 |
| 1199 | collapsed | expanded | 0 | no | 1 |
| 1000 | collapsed | expanded | 0 | no | 1 |
| 999-720 | collapsed | collapsed | 0 | no | 1 |
| 719-640 | collapsed | collapsed | 0 | yes | 1 |

Expected: the ladder order from REQUIREMENTS.md Phase 37 (E) / success
criterion 10 - collapse the Inspector (<1200), then the panel (<1000), then
hide the labels (<880), then show the arrows (<720) - and "all four stages
labelled, single row" at the default window (the CLOSED DEF-330).

Actual: the label rung is effectively driven by the measured CANVAS width
(`hostIconOnly` when the canvas host < 900, or `labelsFitBand` when the labelled
dock cannot fit the pill-free band), NOT by `resolveDockLadder`'s 880
breakpoint. At the app's default 1440x900 window the PAGES dock is icon-only (0
labels) with the Inspector and thumbnail panel both EXPANDED; labels only return
at innerWidth >= ~1500 (canvas host ~1008, band ~588). So across ~880-1499 the
labels are hidden while rungs 1 and 2 are NOT engaged - the exact order of
criterion 10 is not what renders. It is also layout-dependent: in Multi Mode at
1440 the same PAGES dock renders all 8 labels (wider canvas), while in single
mode at 1440 it renders none. Phase 37 grew the PAGES default set from the
curated six to eight verbs (`rotate, extract, insertPages, replacePages, split,
delete, merge, cropPages`), which is exactly what pushes the labelled need past
the default band and re-breaks the CLOSED DEF-330. No wrapping/stacking occurs
(rows = 1 throughout), so this is a label/ladder-order regression, not the
old two-row wrap.

Screenshot: screenshots/adv-p37/p10-1440-pages.png (icon-only dock at the
default window), screenshots/adv-p37/p10-1600-deliver.png (labels at 1600),
screenshots/adv-p37/p9-multi.png (same width, labels in Multi Mode).

Disposition: ACCEPTED -> DEF-334

## ADV-084: One click on the Inspector/panel Expand control at a ladder-collapsed width latches the collapse, so the panel stays collapsed after the window grows

- Session: phase-37 gate
- Suggested severity: MEDIUM

What I did (harness `p13_latch.cjs`, `p12_toggle.cjs`):
1. Booted the dev build, opened a copy of `report.pdf`, Ctrl+1 (PAGES).
2. Control run at 1300 (ladder idle): `[data-inspector-collapse]` collapses then
   expands correctly (false -> true -> false).
3. Set 1100 (ladder rung 1; the Inspector is collapsed and the control's
   aria-label is "Expand inspector"). Clicked `[data-inspector-collapse]` ONCE,
   then grew the window to 1300.
4. Repeated for the thumbnail panel at 900 (`[data-rail-collapse]`,
   aria-label "Expand panel"), then grew to 1300.
5. Also did TWO clicks at 1100 then grew.

Expected: per the code's own contract ("a manual expand while the ladder is
engaged changes nothing visible until the window grows past the rung") the
Inspector/panel should be EXPANDED once the ladder releases, or at worst the
click should be a no-op.

Actual:
- Inspector: at 1100 collapsed=true, label "Expand inspector"; one click -> still
  collapsed; grow to 1300 -> still collapsed (`insp1300AfterOneClick=true`). A
  second click at 1300 then expands. Two clicks at 1100 -> expanded at 1300.
- Panel: at 900 collapsed=true, label "Expand panel"; one click; grow to 1300 ->
  still collapsed (`panel1300AfterOneClick=true`).
Root cause: the control always calls `onToggleCollapsed` (a preference toggle).
With the ladder forcing collapsed and the user preference default false, one
click on the "Expand" affordance records `userCollapsed = true`, i.e. it latches
the OPPOSITE of the label. The panel then does not reverse when the window
grows, which is the exact "state that does not reverse when growing / manual
toggle fighting the ladder" case. Recoverable by a second click at the wider
window, hence MEDIUM not HIGH.

Screenshot: none (state-only; raw in test-fixtures/adv-p37/out/p13.json).

Disposition: ACCEPTED -> DEF-335

## ADV-085: Print is enabled on an empty placeholder tab but silently does nothing (no window, no toast)

- Session: phase-37 gate
- Suggested severity: MEDIUM

What I did (harness `p11b_empty_print.cjs`, `p11_print2.cjs`):
1. Booted the dev build, opened a copy of `report.pdf` (one document tab).
2. Clicked the title-bar `+` (`[data-new-tab]`) so an EMPTY placeholder tab
   became active (the welcome screen is shown; two tabs exist).
3. Read `[data-print].disabled` and the native menu item
   `Menu.getApplicationMenu().getMenuItemById('menu.print').enabled`.
4. Clicked the title-bar Print button, then separately invoked the native
   File > Print item's `click()`. Watched for a new BrowserWindow and for any
   toast.

Expected: an enabled Print opens the standalone print window; if there is no
printable document the control is DISABLED (with a reason) and does not accept
the click - the fail-loud rule ("a control that cannot act is disabled and
explains why").

Actual: with the empty tab active, `[data-print].disabled === false` and
`menu.print.enabled === true`, but neither entry opens a print window and no
toast/error appears (`titlebarOpenedWindow=false`, `menuOpenedWindow=false`,
toasts unchanged, no state change). `buildActivePrintContext()` returns null for
a tab with no engine session and `openPrintWindow()` returns silently. This is
an enabled control that cannot run and does not explain why. (With genuinely no
document at all the same controls ARE correctly disabled, so the bug is specific
to the empty-tab-active-while-another-doc-is-open state.)

Screenshot: screenshots/adv-p37/p11b-empty-tab.png (welcome + enabled Print).

Disposition: ACCEPTED -> DEF-336

## ADV-086: At the arrows rung the arrows are rendered when the row already fits, so clicking them does nothing

- Session: phase-37 gate
- Suggested severity: LOW

What I did (harness `p2_rail_arrows.cjs`, `p9b_flyout.cjs`):
1. Opened a copy of `report.pdf`, Ctrl+4 (DELIVER). Set the window to 719, 700
   and 640 and recorded `[data-dock-scroll]` scrollWidth/clientWidth, then
   clicked `[data-dock-arrow="right"]` and `[data-dock-arrow="left"]` and read
   `scrollLeft`.
2. Ctrl+3 (REVIEW), opened the Annotate flyout, and repeated at 1440/1000/880/
   760/719/640 on `[data-annotation-flyout-scroll]` and its arrows.

Expected: the arrows scroll the verb row; where the row already fits, the
arrows are not offered or are disabled (fail-loud: no control that does nothing).

Actual:
- DELIVER at 700 and 640: `data-dock-arrows="true"` while
  `scrollWidth === clientWidth === 195` (nothing to scroll); clicking either
  arrow leaves `scrollLeft` at 0. (At 719 the dock arrows DO work - scroll
  94/144 -> 50.7 - so the dock is only dead once the row fits.)
- Annotation flyout at 719 and 640: `data-flyout-arrows="true"` with
  `scrollWidth === clientWidth === 195`; its arrows are dead at every width
  tested (the flyout body is 195px and its content always fits).

Screenshot: screenshots/adv-p37/p9b-flyout-640.png (flyout arrows with a
non-overflowing row).

Disposition: ACCEPTED -> DEF-337

Negative results (no finding): no dock stacking or clipping at any width or in
the 640x1200 / 1920x480 shapes; no ladder oscillation (down and up sweeps
identical); no crash, hang or unhandled error in any probe; hostile
`dockUnpinned` values (string, null, duplicates, unknown ids, 5000 entries) are
sanitised on load with no crash and the default verbs restored; unpinning all
eight PAGES verbs persists and leaves an empty dock that the Ctrl+K palette can
restore (no dead end observed). NOT fully verified: opening print while another
in-app modal is up (my Combine click did not leave a modal open, so the probe was
inconclusive - the standalone window did open from the native menu and the main
window survived); Multi Mode strip multi-select and drag-reorder parity (the
right-click menu and hover verbs were verified, the drag/multi-select paths were
not exhaustively exercised).


## ADV-087: Re-opening a document into the same Multi Mode pane still paints the pre-Inspector-inset fit (page ~34% oversized) before it settles

- Session: phase-38 gate
- Suggested severity: MEDIUM

What I did (harness `test-fixtures/adv-p38/gate_probe.cjs`, scenarios
`repeat` and `overshoot`; the dev build launched through `e2e/lib/launch.cjs`):
1. Opened `test-fixtures/report.pdf` in single mode, clicked
   `[data-header-multi-mode]` (pane B empty).
2. Installed a per-frame rAF sampler on `.tab-pane[data-pane="B"]` recording
   `.page-slot` / `.pdf-page` width, the pane width, `--tf-tools-inset`, the pane
   zoom-pill readout and placeholder presence.
3. Opened a document into B via `[data-pane-open]` (dialog mocked), let it
   settle ~3.5s, then clicked `[data-pane-clear]` and repeated the open with
   `long.pdf` / `report.pdf` (7 cycles). The same sequence was then repeated
   with a CDP screencast recording frames (`overshoot` scenario).

Expected: each open into the pane is held by the DEF-338 gate until the scroller
box is stable, so the first painted fit IS the settled fit (criterion 11: zero
frames wider than the settled fit; "a fit measured while the pane is still
shrinking can never be committed").

Actual: reproduced on the 3rd and 4th reopen of each run (cycles k=2 and k=3 in
both `repeat` and `overshoot`). Frame-level samples:

```
overshoot-cycles k=2 (long.pdf): maxSlot 525, settled 393
  overshoot frame: {t:11203, slotW:525, pageW:525, paneW:555, stageW:1378,
                    inset:"0px", slots:520, ph:true, canvas:true, zoom:"86%"}
  zoomSeq: ["86%","65%","64%"]   final 64% / slot 393
overshoot-cycles k=3 (report.pdf): maxSlot 525, settled 393
  overshoot frame: {t:16090, slotW:525, pageW:525, paneW:554, stageW:1378,
                    inset:"0px", slots:520, ph:true, canvas:true, zoom:"86%"}
```

So a `.page-slot` and its `.pdf-page` are laid out at 525px (the 86% fit) for
1-2 painted frames, then step down to 393px (64%) - a 132px / ~34% oversize
first paint. `--tf-tools-inset` read `0px` at the overshoot frame: the gate
released after three identical samples while the Inspector's tools inset was
still collapsed, and the inset transition (which then narrows the pane's
content box) began only afterwards. The gate's "three identical samples" window
cannot see a transition that starts after it releases, so the race the fix was
meant to close is still open on a repeated open/clear/open of a pane. First
opens into B (and the payslip open) did not overshoot in these runs; the gate
catches the inset transition when it starts before the gate settles (ordering
dependent). The known ~10px scrollbar step (403->393) is separate and already
documented in `def338_residual_report.spec.cjs`; this finding is the 34% wrong
fit, not that residual.

Screenshot: `test-fixtures/adv-p38/shots/gate-overshoot-widest.png` (screencast
frame nearest the overshoot, ~116ms late, so it shows the pane a moment after;
the sample JSON above is the frame-level evidence). Final/settled state:
`test-fixtures/adv-p38/shots/gate-overshoot-final.png`.

Disposition: ACCEPTED -> DEF-343


## ADV-088: Light-theme dock verbs fall below the 4.5:1 text floor in the pressed (:active) state

- Session: phase-38 gate
- Suggested severity: LOW

What I did (harness `test-fixtures/adv-p38/gate_probe.cjs`, scenario
`legibility`; and re-ran qa's `P38-1` group for the resting-state baseline):
1. Opened report.pdf at 1920x900, read the resolved tokens and the rendered dock
   verb colours, and composited the actual surfaces (`--bg-elevated`,
   `--bg-hover`, `--bg-active`, `--accent-soft`) exactly as the browser does.
2. Hovered and pressed a non-primary verb to confirm which rule wins.
3. Computed WCAG ratios for every family hue against the resting, hover and
   active surfaces in all three themes.

Expected: text contrast >= 4.5:1 and icon contrast >= 3:1 against the ACTUAL
surface in every state (hover / active / pressed / disabled) and theme.

Actual - the family-hue rule wins by specificity over the hover/active ink:

```
.action-dock-verb:not(.action-dock-verb-primary):not([aria-pressed='true']):not(:disabled)  (0,4,0)
.action-dock-verb:hover:not(:disabled)                                                       (0,3,0)
```

so a hovered/pressed family verb keeps its hue instead of `--fg-strong`, and the
hue then sits on the darker `--bg-active`. Empirical confirmation: hovering
`extract` in the light theme left `color: rgb(37, 99, 235)` (the family hue)
with `background: rgba(15, 23, 42, 0.04)`.

Light theme, pressed (`:active`, surface ~#e8eaec, ratio to the hue):

```
blue   #2563eb 4.29   (below 4.5)
cyan   #0e7490 4.45   (below 4.5)
green  #15803d 4.16   (below 4.5)
orange #b45309 4.17   (below 4.5)
yellow #8a6100 4.60   ok
purple #6d28d9 5.90   ok
red    #be123c 5.22   ok
pink   #be185d 5.01   ok
```

Hover is marginal but passes (light: blue 4.65, cyan 4.82, green 4.52, orange
4.52). Dark (min hover 5.17, min active 4.58) and frostied (min hover 5.96, min
active 5.49) pass. Resting min is 4.88 light / 5.75 dark / 6.60 frosted. Icon
contrast (>=3:1) still passes everywhere. qa's `P38-1` sweep measures only the
resting colour, so it cannot see this state. Fixing the hover/active rules'
specificity (or moving the family hue to a rule the hover can override) closes
it.

Screenshot: `test-fixtures/adv-p38/shots/legibility-light.png`.

Disposition: ACCEPTED -> DEF-344


## ADV-089: The Inspector still shows an enabled text-manipulation panel after leaving the text stage, while its own selection line says "page"

- Session: phase-38 gate
- Suggested severity: LOW

What I did (harness `test-fixtures/adv-p38/gate_probe.cjs`, scenarios
`textSingle` and `textMulti`):
1. Single mode: opened `long.pdf`, Ctrl+2 (EDIT), armed Edit text via Ctrl+K,
   clicked a text run until `[data-textrun-selection]` appeared. The Inspector
   showed `data-inspector-selection="text"` and the field held the run text.
2. Pressed Ctrl+1 (PAGES). After 1.5s: `data-inspector-selection="page"` but
   `[data-inspector-text-panel]` was still present (one instance), the field
   enabled and still holding the run text; typing into it changed the field
   ("ZZZ").
3. Re-entered EDIT and re-selected; the field showed the ORIGINAL run text
   again, i.e. the typed value had not persisted.
4. Repeated in Multi Mode (report.pdf pane A, long.pdf pane B, focused pane B):
   same result, and once typed the panel then persisted across PAGES/EDIT/
   REVIEW/DELIVER with `data-inspector-selection="page"`.

Expected: the Inspector's text-manipulation surface is shown only when its
selection is a text target (`inspectorSelectionFor` yields kind `text`); leaving
the EDIT/REVIEW stage clears the selection and the panel should not render an
enabled field for a "page" selection (fail loud, never a surface with no
matching target).

Actual: `inspectorTextPanelFor` returns a panel whenever the published
`inspectorTextSelection` snapshot is non-null, independent of the stage, while
`inspectorSelectionFor` already reports `page`. So the header says "Page 1" and
an editable text field for the previous run coexists. Typing into it is accepted
and then silently discarded (step 3). No crash and no document mutation was
observed, but the state is contradictory and the edit is a silent no-op.

Screenshot: `test-fixtures/adv-p38/shots/text-single-pages.png`,
`test-fixtures/adv-p38/shots/text-multi-stages.png` (see console log for the
snapshot JSON).

Disposition: ACCEPTED -> DEF-345


## ADV-090: Legacy-cleanup NSIS guards are name/path heuristics and run in the elevating user's context

- Session: phase-38 gate
- Suggested severity: LOW

What I did (static audit of `electron-builder.nsh` + `electron-builder.yml`;
verified electron-builder's defines in
`node_modules/app-builder-lib/templates/nsis/multiUser.nsh` and
`out/targets/nsis/NsisTarget.js`; plus a READ-ONLY registry/filesystem probe of
this machine - no install, no registry write):
1. Read the `customInstall` hook and the electron-builder NSIS templates that
   define `INSTALL_REGISTRY_KEY` / `UNINSTALL_REGISTRY_KEY` and insert the hook.
2. Read this machine's keys read-only (`HKCU ... \Uninstall\<GUID>`,
   `HKCU\Software\<GUID>`, `HKCU\Software\Classes\TFlex.pdf`,
   `HKCU\Software\Classes\.pdf\OpenWithProgids`, the `.pdf` UserChoice) and
   listed `%LOCALAPPDATA%\Programs\TFlex`.

Expected: "nothing is deleted unless it is provably TFlex's" (the script's own
comment), and a per-machine install removes the legacy per-user install (the
success criterion 3).

Actual - the guards are real but name/path heuristics, and one step is
unguarded:
- `${UNINSTALL_REGISTRY_KEY}` = `Software\Microsoft\Windows\CurrentVersion\Uninstall\f890a78b-...`
  and `${INSTALL_REGISTRY_KEY}` = `Software\f890a78b-...`, both read from HKCU
  and deleted only when `DisplayName` / `InstallLocation` contain the substring
  "TFlex" (case-sensitive `${StrContains}`). A different product whose
  display name or install location merely contains "TFlex" would be deleted;
  the GUID itself is appId-unique, so a genuine GUID collision is not credible.
- The directory step is guarded only by
  `${FileExists} "$LOCALAPPDATA\Programs\TFlex\TFlex.exe"`; any directory with
  that exact path containing a file named `TFlex.exe` (not necessarily this
  product) is `RMDir /r`-ed. On this machine it is genuinely the legacy 1.29.0
  install (TFlex.exe + "Uninstall TFlex.exe"), so the guard passes as intended.
- Step 4 is UNGUARDED: `DeleteRegKey HKCU "Software\Classes\TFlex.pdf"` deletes
  the ProgID key with no ownership check, contradicting the "provably TFlex's"
  claim. It only affects a per-user ProgID under that exact name; the user's
  real default is `...\FileExts\.pdf\UserChoice` (here `MSEdgePDF`) which is
  never touched, and `.pdf\OpenWithProgids` only lists candidates - so deleting
  the `TFlex.pdf` value there cannot change the effective default handler.
- Context hole: an elevated per-machine install runs at `RequestExecutionLevel
  admin`; `HKCU` and `$LOCALAPPDATA` then resolve to the ELEVATING account. If a
  standard user installs with a different admin's credentials, the legacy
  per-user install/uninstall keys of the invoking user are not removed (the
  stated job fails) and the admin's own profile is targeted instead. When the
  user is an admin who self-elevates (this machine), it cleans the right
  profile. Also, if the legacy `TFlex.exe` is still running during a first
  per-machine install, `RMDir /r` cannot delete the in-use file and can leave a
  half-removed directory while the registry entries are already gone.

Screenshot: none (analysis; the read-only probe output is in the session log).

Disposition: ACCEPTED -> DEF-346


## Negative results - Phase 38 (no finding)

- Pane first-fit gate, all other hostile sequences: payslip into pane B, opening
  while dragging the divider, opening while toggling the Inspector, focus
  switching mid-fit, a 3rd document, a 1-page document, a 520-page document, and
  rapid open/clear loops all ended with a painted pane and no held-blank pane
  (`repeat`/`overshoot` cycles had canvas frames and slot 393-403; `dragDuringLoad`,
  `payslipDrag`, `inspector`, `tabSwitch`, `third`, `tiny` all settled). No gate
  hold-forever was reproduced on any sequence. Toggling Multi Mode before a
  document exists is inert (no pane, no crash). Opening an unopenable fixture
  (encrypted/zero/truncated/not-a-pdf) into pane B leaves the pane empty with no
  assignment; that is a document-open error path, not a gate hold, and is out of
  this phase's scope.
- Dock containment (DEF-341): my sweep at 1920/1440/1200/880/719/640 (and the
  clamped 640 floor at 520/400) for all four stages found one row everywhere,
  the leading verb inside the dock box and hit-testable, the trailing verb
  reachable (scroll to end), no vertical clipping, and no oscillation on
  repeated 1920<->640 resizes. The pin menu clamps inside the viewport at both
  window edges (420x560). Unpinning all PAGES verbs leaves an empty 17x13 dock
  remnant, which the Ctrl+K palette can re-populate (already recorded in ADV-086's
  negative results; no new finding).
- Legibility (item 2), all states except ADV-088: resting/hover/pressed/primary
  in dark and frosted pass >= 4.5 (min resting 5.75/6.60, hover 5.17/5.96,
  active 4.58/5.49, primary 5.96/5.61); light resting/hover/primary pass (min
  4.88/4.52/5.52). Icons render at 20px (dock), 22px (rail), 18px (panel,
  Inspector, header, pills) - all >= 18; labels 12px everywhere. Disabled ink is
  1.86-2.30:1 against the dock but is visibly distinct from every enabled hue
  (min RGB distance 121) as required. 8 dock verbs carry 6-7 distinct hues plus
  8 distinct icon shapes and labels (colour is not the only signal). The 64px
  stage rail keeps its buttons fully inside the rail (3..60) and the dock/pills
  are inset from the window edges.
- Retired text panel (item 3): qa's `P38-2` reproduces "exactly one
  `[data-inspector-text-panel]`, inside the Inspector, static, retired float/grip
  selectors absent" for the armed tool, a placed text annotation, the REVIEW
  re-selection, the Ctrl+K palette path, and the EDIT text-box flow; my
  `textMulti`/`textSingle` add Multi Mode (one panel, never per-pane; no panel in
  either pane subtree) and closing a pane mid-edit (no orphan). No duplicated
  surface was found.
- Edit fidelity (item 4): qa's `P38-3` passes (preview font == source run height
  within 0.5px at 150%/200% for report.pdf and 200% for long.pdf; eraser covers
  the run box including descenders). My `editRotated` sweep at 0/90/180/270
  degrees found sizeDelta 0 and full four-side eraser coverage at every
  rotation. No ghost/duplicate and no focus steal observed; note that after
  selecting a text RUN the activeElement stayed BODY in that probe (the
  focus-on-select guarantee is asserted for text OBJECTS in `P38-2`, which
  passes), so run-level focus is unverified rather than broken.
- Not fully verified: the OTA/update-path installer run (I did not install, per
  instruction); rotated-page edit with a rotated DESCENDER run (report.pdf run
  boxes are axis-aligned after rotation and covered); rapid theme switching
  during a pane load; the `--tf-tools-inset` transition's exact trigger ordering
  (inferred from the inset=0px overshoot frame, not instrumented directly).


## Phase 40 gate — chrome, dialogs, view modes, design system

Session label: `phase-40 gate`. Harness lives in `test-fixtures/adv-p40/`
(`probe.cjs`, `hostile.cjs`; shots in `test-fixtures/adv-p40/shots/`). All runs
go through the canonical `e2e/lib/launch.cjs` launcher against the current
`dist` build (dev build). Fixture copies are always made to `%TEMP%`; no
recorded fixture is mutated. Model: `openrouter/deepseek/deepseek-v4.1-flash`.

## ADV-091: In TWO/FOUR layout the page pill shows a range, focus swaps it to a bare page without selecting, so a click-and-type jump lands on the wrong row or is a silent no-op

- Session: phase-40 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/adv-p40/probe.cjs layoutGeometry` - open `report.pdf`
   (34 pages) at 1440x900, select the TWO page layout. The page pill's resting
   value is the row range `1-2` (`data-page-layout` = `two`).
2. `node test-fixtures/adv-p40/probe.cjs jump` - (a) click the page input, read
   `input.value` and `selectionStart/End`; (b) type a single digit and press
   Enter; (c) also try a full clear (Ctrl+A) then type, for comparison.

Expected: clicking the page input and typing a page number jumps to that page,
or at minimum either selects the shown text or rejects the input visibly.

Actual:
- After the click the input reads `3` (the range `3-4` was swapped for the row's
  first page by the `onFocus` handler) with `selectionStart = selectionEnd = 0`;
  nothing is selected. Typing `6` produced the value `63`; Enter parsed
  `parseInt("63") = 63 > pageCount 34`, so the jump was silently refused and the
  field stayed showing `63`.
- In a second run the resting value was `1-2`; `fill("4")` (which first focuses,
  and so triggers the same swap) ended with the value `14`; Enter jumped to
  page 14 (readout `13-14`, scroller at the row for pages 13-14) - a wrong
  destination the user did not ask for.
- Ctrl+A then typing the number works (`8` -> readout `7-8`, scroll lands on
  pages 7-8), which isolates the trigger to the missing select-on-focus.
- The same append behaviour exists in ONE mode (`3` + `6` -> `36`), but there
  the resting value IS the page; Phase 40's range readout makes the resting
  value not the editable page, aggravating it.

Screenshot: `test-fixtures/adv-p40/shots/layout-wide-four.png` (range readout
`1-2` while the control offers a 2x2 layout)

Disposition: ACCEPTED -> DEF-351


## ADV-092: Palette pin toggle cannot restore a removed stage-default tool once four explicit pins exist, and reports a false "Dock is full (max 4 pins)"

- Session: phase-40 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/adv-p40/probe.cjs pinsCap` - open `report.pdf` (PAGES
   stage), open the Ctrl+K palette, search `merge` and click its pin toggle to
   UNPIN that stage default. The dock correctly drops Merge (7 defaults left).
2. Search/pin four NON-stage tools (`annotate`, `sign`, `stamp`, `watermark`)
   so `dockPins` holds 4 explicit pins.
3. Search `merge` again (palette shows it `unpinned`, dock does not contain it)
   and click its pin toggle to restore it.

Expected: restoring a tool that is part of the current stage's default set adds
no explicit pin (`pinDockTool` only removes it from `dockUnpinned`), so it should
succeed even with 4 explicit pins.

Actual: the notice reads `Dock is full (max 4 pins)` and the toggle does
nothing - Merge stays out of the dock (`dockCount` stays 11 = 7 defaults + 4
pins, and `inDock:false`). The capacity guard is evaluated against `dockPins`
in `togglePinRow`/`pinRow` before the default-vs-cross-stage branch in
`pinDockTool`, so a restore that needs no pin slot is refused with a misleading
reason. The user cannot get the tool back from the palette by any path while
the 4 cross-stage pins exist.

Screenshot: `test-fixtures/adv-p40/shots/pins-cap.png`

Disposition: ACCEPTED -> DEF-352


## ADV-093: Palette pin icon can disagree with the dock when an id is present in both `dockPins` and `dockUnpinned` (hand-edited or cross-version settings)

- Session: phase-40 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/adv-p40/hostile.cjs array` - pre-write a settings.json
   with a hostile-but-schema-valid curation:
   `dockPins: ["__nope__","rotate","rotate","delete","delete","annotate","sign","watermark","merge"]`,
   `dockUnpinned: ["merge","merge","__bogus__","not-real-tool","delete"]`.
2. Launch with that userData dir, open `report.pdf`, open the palette and
   compare every row's `data-palette-pinned` against the `[data-dock-verb]`
   membership of the dock.

Expected: `isToolPinned` and the dock render the same membership for every tool
(the palette contract: "the toggle icon must reflect what the dock is actually
showing").

Actual: `disagree: ["delete"]`. `sanitizeDockPins` keeps `delete` as an explicit
pin, but `sanitizeDockUnpinned` also keeps `delete` (it is a PAGES default), so
`isToolPinned("delete")` takes the `dockDefaultIds` branch and returns
`!unpinned.includes("delete") = false` while the dock is rendering the explicit
pin. The palette shows "unpinned", the dock shows "pinned". No crash, and one
click self-heals it (`onDockPin` removes the un-pin), but the two surfaces
visibly contradict each other until then. Requires a settings file containing
the same id in both lists (hand-edited or left behind by a stage change across
versions); normal pin/unpin writes cannot produce it. The rest of the hostile
settings cases (`nonarray`, `corrupt`) load cleanly with defaults and no
disagreement.

Screenshot: `test-fixtures/adv-p40/shots/hostile-array.png`

Disposition: ACCEPTED -> DEF-353


## ADV-094: Palette "Recent"/"Global" stage-tag text is below the 4.5:1 floor in all three themes

- Session: phase-40 gate
- Suggested severity: MEDIUM

What I did:
1. `node test-fixtures/adv-p40/probe.cjs contrast` - open `report.pdf`, open the
   Ctrl+K palette, force each theme by setting `data-theme` on the root, and
   measure text-on-real-background contrast for every palette tag variant
   (`.command-palette-tag[data-stage="..."]`) with a WCAG ratio helper that
   walks ancestors to the first opaque background.

Expected: with Phase 40 item 12 ("the contrast floors still hold in all three
themes"), every tag's text meets 4.5:1.

Actual: the four stage tags pass, but the non-stage tags fall back to
`var(--accent)` on `var(--accent-soft)` and fail in all three themes:

| tag | light | dark | frosted |
| --- | --- | --- | --- |
| Recent / Global | 4.37:1 | 3.24:1 | 4.34:1 |
| PAGES | 8.62 | 7.59 | 9.12 |
| EDIT | 6.70 | 7.29 | 8.65 |
| REVIEW | 6.29 | 6.33 | 7.95 |
| DELIVER | 7.13 | 8.42 | 6.83 |

The dark 3.24:1 is the worst (accent `#2563eb` on the dark accent wash). The
comment in `styles.css` explicitly says non-stage rows "keep the accent
treatment", so this is a deliberate token choice that still misses the floor.

Screenshot: `test-fixtures/adv-p40/shots/contrast.png`

Disposition: ACCEPTED -> DEF-354


## ADV-095: Pressed-state Open label (3.75:1) and dark active page-layout icon (2.98:1) are below the Phase-38 floors

- Session: phase-40 gate
- Suggested severity: LOW

What I did:
1. `node test-fixtures/adv-p40/probe.cjs contrast` - same setup; additionally
   hold the mouse down over `[data-toolbar-open]` (pressed state) and read the
   ratio, and measure the ACTIVE `[data-page-layout-option]` (the segmented
   control at the canvas top-right) in each theme.

Expected: Phase 38 floors hold in every state (4.5:1 text, 3:1 icon), and item 3
requires the borderless Open/Save controls to keep those floors through their
hover/focus/pressed affordances.

Actual:
- Pressed `.titlebar-file-btn` (the "Open" label): 3.75:1 in light
  (`color: var(--accent)` `#2563eb` on `--accent-pressed-soft` = rgb(207,220,247))
  - below the 4.5:1 text floor. Resting is 8.26 and hover 15.79, so only the
  pressed state regresses.
- Active page-layout option icon, dark theme: 2.98:1 (accent on the active
  tool-btn wash) - a hair under the 3:1 icon floor; light 4.39 and frosted 4.28
  are above it. Reported as borderline (within measurement noise of 3.0).
- The pressed page-layout icon is 3.80:1 (passes the icon floor).
- Dock primary verb, palette rows, pin toggles, header icons and the context
  panel title all pass or greatly exceed the floors in every theme and state.

Screenshot: `test-fixtures/adv-p40/shots/contrast.png`

Disposition: ACCEPTED -> DEF-355


## Negative results — Phase 40 (no finding)

- Page-layout modes (item 7), the main new surface: across 1920x1080, 1440x900,
  900x700, 720x1000 and 1000x1300, ONE/TWO/FOUR were exercised on the 520-page
  `long.pdf` and the 1-page `form.pdf`. In every mode the expected number of
  pages was FULLY inside the viewport at the mode's `fit-page` (FOUR showed
  pages 1-4 in a 2x2 grid fully visible at the wide/std/narrow/tall sizes; TWO
  showed 1-2 side by side; ONE showed exactly page 1). Rows were 2 columns for
  TWO/FOUR, 1 for ONE; `data-page-layout` and `aria-pressed` matched the
  clicked option every time. Overlay alignment: for every mounted page the slot,
  `.pdf-page` and `.textLayer` rects shared origin within 0-1px and the canvas
  filled the slot (canvasW = slotW, or slotW-1 for sub-pixel) in TWO and FOUR,
  including after a rotate via the page right-click menu. No blank page, no
  wrong-size canvas, no page that never rendered, no mode that landed between
  layouts. A 1-page document in FOUR is rendered at the 4-page fit (64% at
  1920) top-centred with empty grid cells - consistent with the mode's declared
  fit, noted as an observation rather than a defect.
- Multi Mode stays ONE: entering Multi Mode removes the page-layout control
  (`controls: 0`) and both panes' `.document-content` report `data-page-layout="one"`.
- Performance with 4-up on the 520-page monster: switching to TWO/FOUR took
  130-264 ms to the next two frames, mounted only 6 pages at 4-up (2 at 1-up),
  and main RSS stayed 133-134 MB and the renderer JS heap 28 MB across four
  mode switches plus six more cycles - no unbounded growth, no hang. The 520
  slots are virtualised; only the visible rows mount.
- Merge from scratch (item 4): cancel (0 files) = no tab, no source write;
  1 file = normal open of that path; 2 files (34+1) = `Merged (2 files)` with 35
  pages; the same file twice = 68 pages; corrupt-first + form = loaded the
  corrupt fixture as a 1-page doc and merged to 2 pages with no crash; a missing
  path and a non-PDF = no tab and no source write; 11 files (34 + 10x1) = 44
  pages. In every multi-file case the combined tab is in-memory
  (`onDiskPath:null`, Save disabled, Save dot on, modified dot on) and the first
  source file's SHA-256 was unchanged after Ctrl+S, so a plain Save cannot
  overwrite a source. With a document already open, Merge opens the doc-bound
  dialog instead of the from-scratch picker.
- Palette pin toggles (item 6), normal operation: `node ... pins` showed the
  palette's pinned flag and the dock's actual membership agree for all 95
  registry rows, and toggling four stage-default pins off removed exactly those
  four from the dock; `hostile.cjs persist` pinned `watermark`, wrote
  `dockPins:["watermark"]`, restarted on the same userData and found it still
  pinned in the dock and in the palette. Rapid toggling (18 clicks over 3 rows)
  did not crash, did not close the palette and left no page error.
- Header icons (items 5/8): welcome shows the Ctrl+K command glyph and a
  disabled Ctrl+F find icon; with a document the find icon enables and opens the
  search bar; the two accessible names are distinct and name their shortcuts;
  rapid alternating clicks never produced two search bars or left the palette
  stuck. `MULTI_MODE_ACCESSIBLE_NAME`/title both contain "view/edit two ...
  side by side" (item 8).
- Horizontal pane pills (item 1): `pills`/`pills2` swept Multi Mode A and B at
  640/800/960/1120/1280/1440/1600/1760/1920 (one and two documents) plus a
  900x1400 tall window and 0.2/0.8 divider splits. In every sample the page pill
  and the zoom pill were on ONE row (`sameRow:true`), did not overlap
  (`overlap:false`), and each sat entirely inside its own pane
  (`pageInside`/`zoomInside:true`), including a 262px pane at 640 and the
  micro tier.
- Retirements + page actions (items 9/10): `[data-rail-action-bar]` count is 0
  before and after selecting a thumbnail; the dock's Rotate pages verb ran on
  34 pages; the page right-click menu still exposes
  `rotate-cw, rotate-ccw, extract, insert-blank, replace, delete`, so no page
  action lost its home. Outline flush (item 11): in both the collapsed and the
  expanded state the `.context-panel-outline` bottom equals the panel bottom
  (`gap:0`).
- Create-from-images (item 3): at the 640x620 minimum and at 1920x1080 all four
  controls (`Add more`, `Create from clipboard`, quality, `Create PDF`) stayed
  inside the viewport; with 30 images the list scrolled (`scrollHeight 1039` in
  a 52px scroller at minimum) and the confirm button remained visible and
  unclipped; removing rows emptied the list.
- Hostile settings: a corrupt settings.json and a non-array `dockPins` both load
  with defaults, a sane dock, no disagreement and no renderer page error.
- Could not reproduce / not independently verified: pin persistence of an
  explicit pin after a pin/unpin rapid sequence (only the single-pin restart
  path was proven); the palette's pin state under a Multi Mode stage change;
  the dock's disabled/selected state contrast (no dock verb was in a disabled
  or pressed state at the sampled moment, so `dockActive`/`dockDisabled` were
  null); Multi Mode's page right-click menu (shared `pageThumbMenu` module, but
  only the single-mode menu was driven).

- Out-of-scope observation (NOT filed; adjacent to item 4's save path but
  pre-existing): pressing Ctrl+S with a CLEAN single-file document open rewrote
  that file on disk (its SHA-256 changed) even though the toolbar Save control
  was disabled and the document unmodified. This is the global accelerator, not
  the from-scratch merge path (which is correctly save-protected), and it
  predates Phase 40, so it is left for the orchestrator to scope.





## ADV-096: After the EDIT-toolbar retirement, the armed edit tool has no active state on its dock verb

- Session: phase-41 gate
- Suggested severity: MEDIUM

What I did:
1. `npm.cmd run build:renderer` (exit 0); launched the dev build through the
   canonical `e2e/lib/launch.cjs` (harness `test-fixtures/adv-p41/probe.cjs`),
   opened `report.pdf`, pressed Ctrl+2 for EDIT. The dock renders the four edit
   verbs `editText` (primary), `editImage`, `editTextBox`, `editToolOff`.
2. Clicked `Edit text` (editText); the page's `.edit-layer` armed
   (`data-tool="text"`). Then armed `editTextBox` / `editImage` / `editToolOff`
   in turn.
3. Read the target verb's attributes/class/computed style, and the `aria-pressed`
   of every edit verb, after each arm (`probe.cjs detail`).

Expected: the armed tool's dock verb shows an active/pressed state so the user
can see which edit tool is live - the retired `.edit-toolbar-btn-active` did
exactly that (accent wash + accent border) - and keyboard/AT users get the toggle
through `aria-pressed`.

Actual: no edit verb ever carries an active state. After arming `editText`:
`hasAttribute('aria-pressed') === false`, `class="action-dock-verb
action-dock-verb-primary"`, `boxShadow:none`. After arming `editTextBox` or
`editImage`: `class="action-dock-verb"`, `boxShadow:none` (only the transient
hover wash from the click shows). Armed and unarmed are indistinguishable, and
`editText` looks accent-tinted whether or not it is armed because it is the dock
PRIMARY verb. Root cause: `src/renderer/components/DocumentView.tsx:4342` still
passes `activeToolIds={editModeOpen ? ['editMode'] : []}`, but `editMode` was
retired as a dock verb in Phase 37 (`DOCK_STAGE_IDS.edit` is
editText/editImage/editTextBox/editToolOff/recognizeText/batchOcr/ocrSuspects;
`SURFACE_BY_ID.editMode = 'panel'`), so the id never matches a rendered verb and
the dock's pressed treatment `.action-dock-verb[aria-pressed='true']`
(styles.css:13696) is never applied to an edit tool.

Screenshot: test-fixtures/adv-p41/shots/dock-armed-editText.png (and
dock-armed-editTextBox.png)

Disposition: ACCEPTED -> DEF-358


## Negative results - Phase 41 (no finding)

- Item 1 - Inspector surface: computed `background-color` alpha is 1 in all 3
  themes x 4 stages; in frosted the `linear-gradient(rgba(255,255,255,0.68),
  rgba(255,255,255,0.68))` glass film composites over the opaque
  `--tf-canvas-opaque` (#eef1f5), `isolation:isolate`, z-index 30. A 10x18
  `elementFromPoint` grid inside the panel returned only the panel and its
  descendants in every stage (0 offenders), so no control is unreachable under
  it. With the page zoomed hard against the panel edge (EDIT), pixel scans of the
  panel's page-facing margin found 0 dark page-text pixels in light/frosted and
  no near-white canopy pixel in dark (top colours 16,20,25 / 23,28,34 - all well
  below the page white), i.e. no bleed-through. Geometry is unchanged
  (border-radius 0, width 264, 1px hairline left border). Toggling collapse 6x
  alternated 264<->44 with the inset tracking it; a resize sweep
  1920/1024/900/760/640 stayed opaque with the inset following the ladder.
- DEF-357 (adjacent to item 1): verified FIXED. With the OCR suspects bar open
  and the Inspector open at 1440x900 the bar's right edge equals the Inspector's
  left edge (both 1176, gap/overlap 0); the close button (x 1142..1164) sits
  entirely left of the panel, `elementFromPoint` at its centre resolves to the
  button's own SVG child, and a real Playwright pointer click closed the bar. It
  holds when the Inspector is collapsed (44px) and across 1920/1024/900/760/640
  and all three themes. Limitation: `report.pdf` current-page OCR yielded 0
  suspects, so the bar body was only exercised in its empty state
  (scrollHeight == clientHeight == 109).
- Item 2 - reachability (besides the missing indicator above): all four edit
  verbs arm/unmount correctly (`data-tool` text/box/image; `editToolOff` -> 0
  layers); entering EDIT -> arm text -> leave -> return leaves the layer off with
  no error; 24 rapid tool switches and closing a document with a tool armed both
  produced no pageerror and a clean welcome; the palette lists all edit ids and
  the EDIT panel's Default font picker works and persists (`editDefaultFont`
  = "Times"); `[data-edit-toolbar]` / `.edit-toolbar` / `[data-edit-tool]` count
  0 in every stage.
- Item 3 - selection states: floors hold for the active align option (5.30 light
  / 5.77 dark / 6.83 frosted) and the selected thumbnail (5.63 / 6.66 / 7.43).
  The active option's resting == hovered (by design) and is distinct from a
  non-active hover (0.07 vs 0.04 fill plus the accent-tinted edge + inset ring);
  a selected thumb's hover does not change; `.thumb-current` (solid accent ring)
  and `.thumb-selected` (tint + select-edge inset ring) stay distinct; under
  forced-colors the selected thumb keeps a distinct border (rgb(55,0,110) vs
  rgb(0,0,0)).
- Item 4 - separators/edge: `.stage-rail` `border-right` equals `--divider` in
  all three themes with gap 0 / overlap 0 at 1440 and 900. The Inspector's
  selected page-facing edge equals `--panel-border` (never `--sem-primary`);
  rest box-shadow none, selected gains the neutral inset highlight + outward
  glow. (The 0.667px computed hairline is the app's global pixel scale, the same
  on every hairline - not a Phase-41 change.)
- Could not reproduce / not verified: a keyboard `:focus-visible` ring on the
  active align option - my Tab/Shift-Tab sequence did not land focus back on the
  button, so the readout was inconclusive rather than a finding (styles.css:2873
  declares a 2px accent outline). Multi Mode with the OCR bar + Inspector was
  reasoned from the CSS (the panes consume the capped `--tf-pane-inset`, the bar
  consumes the uncapped `--tf-tools-inset`) but not exercised, as it needs a
  second OCR run.


## ADV-097: Palette still reports a stage-native pin as "pinned to the dock" in stages whose dock filters it out, and pinning one from a foreign stage silently has no visible effect (DEF-353 invariant regressed)

- Session: phase-42 gate
- Suggested severity: MEDIUM

What I did:
1. Copied the operator's real `%APPDATA%\tflex\settings.json` (carries
   `dockPins: ["watermark"]`) into a temp userData dir and launched the dev build
   through `e2e/lib/launch.cjs` (`node test-fixtures/adv-p42/probe.cjs pin watermark`),
   opened `report.pdf`.
2. Walked every stage (Ctrl+1..4), read the Action Dock verb/pin lists, then
   opened Ctrl+K in each stage and read the Watermark row's
   `data-palette-pinned` / `data-palette-pin-state` (probe `pin-palette`).
3. In EDIT (Ctrl+2) opened Ctrl+K, searched "watermark" (screenshot
   `pin-palette-edit-watermark.png`), clicked its pin toggle, read the notice,
   and re-read the EDIT dock.
4. Repeated with `dockPins: ["rotateCounterClockwise"]` (a stage-native tool that
   is NOT any stage's default) and `["undo"]` (a global tool).

Expected: the Phase-40 item-6 / DEF-353 contract - the palette's pin toggle
reflects what the dock is actually showing, and the two surfaces never disagree
about the same tool. With Phase 42's one-home filter, the dock hides a
stage-native pin outside its stage; the palette should therefore stop reporting
that tool as pinned in those stages (or state that it is pinned in its own
stage).

Actual: `isPinVisibleInStage` is applied only in `ActionDock`; the host's
`isPaletteToolPinned` (App.tsx:7866, `dockPins.includes(id)`) is unchanged, so
the palette reports the tool pinned in stages whose dock filters it out. With
`dockPins: ["watermark"]` the dock correctly shows Watermark only in REVIEW
(absent from PAGES/EDIT/DELIVER - the Phase-42 fix holds), but the palette row
has `data-palette-pinned=true` and state `pinned` in ALL FOUR stages. The
screenshot shows the EDIT dock's bottom bar with no Watermark while the palette
row carries the filled pin glyph and the "Review" tag. Pressing that toggle in
EDIT reported "Unpinned Watermark from the dock" although the EDIT dock never
contained it. Reverse direction: from EDIT, pinning the unpinned Watermark row
reported "Pinned Watermark to the dock" and flipped the row to pinned while the
EDIT dock was unchanged - the pin actually lands in REVIEW with no hint, and it
consumes one of the 4 pin slots. `rotateCounterClockwise` behaves the same:
palette reports pinned in all four stages, only the PAGES dock renders it as a
pin (so no capability is lost, but the marker disagrees in three stages).

Screenshot: test-fixtures/adv-p42/shots/pin-palette-edit-watermark.png (EDIT
dock + palette row showing Watermark pinned); dock-edit.png.

Disposition: ACCEPTED -> DEF-359


## Negative results - Phase 42 (no finding)

- Icon identity (item 1): the real app's Ctrl+K palette rendered 94 rows with
  ZERO blank glyphs and ZERO duplicate lucide classes; every stage dock
  (PAGES/EDIT/REVIEW/DELIVER) rendered its verbs with distinct, label-correct
  glyphs. I inspected the flagged near-miss pairs at 20px and an 8x enlargement
  from the live DOM (test-fixtures/adv-p42/shots/near-miss-pairs.png). All pairs
  are genuinely distinct: SquareDashed vs SquareDashedMousePointer (a cursor
  arrow appears inside the latter), SquareX vs SquarePen vs SquarePlus, Minimize
  (four corner strokes) vs Minus (a bar), Maximize2 vs Square, Type vs
  TextCursorInput, and FileDown vs FileUp (arrow direction). Borderline only:
  SquareDashed / SquareDashedMousePointer, where the cursor is small at 20px -
  but they never co-occur (PAGES toolbar vs the REVIEW annotation flyout), so I
  do not call it a clash. exportPages = image-down, exportDocx = file-type,
  exportComments = file-down, importComments = file-up, extract =
  arrow-up-from-line: each matches its label - no mis-mapped or inverted glyph.
- Pin rule (item 2), other cases: a GLOBAL pin (`undo`) renders as a pin in all
  four stage docks and the palette agrees everywhere; an unknown id (`ghostTool`)
  is dropped without a crash and renders nowhere, as before. A stale pin of a
  retired-but-present id (`editMode`) renders only in the EDIT dock (its own
  stage) - pre-existing pin behaviour, not a Phase-42 change.
- One home: with the operator's real `dockPins: ["watermark"]`, Watermark
  rendered exactly once across the four docks (REVIEW inline, deduped against its
  own stage default) and the other three docks were byte-identical to
  `DOCK_STAGE_IDS`. Every REVIEW verb (annotate, sign, stamp, flatten, forms,
  watermark, exportComments, importComments) and DELIVER verb (optimize, audit,
  exportPages, exportText, exportDocx, createFromImages) kept its home.
- Watermark capability (item 3): opens exactly one dialog from its REVIEW dock
  verb AND from the Ctrl+K palette (probe `wm`: count=1 both ways; screenshot
  test-fixtures/adv-p42/shots/watermark-dock.png). No watermark-dialog code was
  touched by the phase diff.
- Could not reproduce: any visual icon clash, blank glyph, or mis-mapped glyph.
  I did not run the app in Multi Mode (the dock is shared and driven by the
  focused pane's stage) nor in the dark/frosted themes for this icon pass -
  both are out of the phase's icon-identity scope and were reasoned only.

## Phase 54 gate - imaging, print graphics, PDF/A and PDF/X validation

Session label: `phase-54 gate`. Attacked the Phase 54 surface only: the image
metadata readers (`image-meta.ts`), the image/TIFF/SVG adapters, the hand-rolled
SVG scanner/painter, the XMP + PDF/A + PDF/X rule set, and the renderer's
create-from-images routing. Every specimen is in `test-fixtures/adv-p54/`
(built by `build-fixtures.cjs`); the app was launched ONLY through
`e2e/lib/launch.cjs` and driven through the product's own bridge
(`window.tflex.convert` / `engine.getDocumentBytes` / `validation.validateBytes`)
by the `a*.cjs` harnesses in the same directory. Raw logs are under
`test-fixtures/adv-p54/logs/`. The build under test was rebuilt first
(`npm.cmd run build`) so `dist/` carried Phase 54.

## ADV-098: A 14-byte cyclic-IFD TIFF drives UTIF.decode into an unbounded loop and OOM-crashes the main process

- Session: phase-54 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p54/tiff-cyclic-ifd.tiff`, 14 bytes:
   `49 49 2a 00 08 00 00 00 00 00 08 00 00 00` (little-endian header, IFD0 at
   offset 8, zero entries, next-IFD pointer at offset 10 pointing back to 8).
2. `node test-fixtures/adv-p54/a2-one.cjs tiff-cyclic-ifd.tiff 25000`, which
   launches the real dev build and calls `window.tflex.convert.toDocument` on
   the file.
3. No result was ever returned. The Electron main process grew its V8 heap,
   and at roughly 22 s of main-process uptime printed, repeatedly:
   `OOM error in V8: MarkCompactCollector: young object promotion failed
   Allocation failed - JavaScript heap out of memory` at ~4 GB. The renderer
   IPC then rejected with `Target page, context or browser has been closed`,
   and the app was gone (`usableAfter` dead). A second run with a 6 s deadline
   reproduced the same OOM
   (`test-fixtures/adv-p54/logs/cyclic.log`).
4. Root cause (verified in `node_modules/utif/UTIF.js:93-98`): `UTIF.decode`
   loops `while (true) { noff = _readIFD(...); ifdo = readUint(data, noff);
   if (ifdo == 0) break; }`. With the self-referential next-IFD pointer,
   `ifdo` is always 8, so `ifds.push(ifd)` grows without bound and the loop
   never terminates. `src/main/services/convert/adapters/tiff.ts:135` calls
   `UTIF.decode` inside a `try/catch` that can never fire on a loop.

Expected: a typed, readable failure (e.g. `corrupt`) back across IPC; at worst
a timeout. A malformed 14-byte file must never be able to exhaust the main
process.
Actual: the main process runs an unbounded allocation loop until V8 OOMs and
the whole application dies. No typed error reaches the renderer; a restart is
required.

Screenshot: none (process death, no window to capture). Log:
`test-fixtures/adv-p54/logs/cyclic.log`. Fixture:
`test-fixtures/adv-p54/tiff-cyclic-ifd.tiff`.

Disposition: ACCEPTED -> DEF-380

## ADV-099: PDF/X validation of a sub-megabyte PDF whose content stream decodes to ~200 MB OOM-crashes the main process; validation has no timeout

- Session: phase-54 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p54/val-bigcontent.pdf` (408 KB on disk) whose
   page `/Contents` is a Flate stream that decodes to 200 MiB of
   `0 0 0 0 k` operators (no `rg`/`RG`, so the scan cannot bail out early).
2. `node test-fixtures/adv-p54/a4b-big.cjs`, which launches the real dev build
   and calls `window.tflex.validation.validateBytes(bytes, 'pdfx-1a')`.
3. Observed: about 2.6 s in, the main process printed
   `OOM error in V8: invalid array length Allocation failed - JavaScript heap
   out of memory` (the GC trace shows the heap at ~1 GB and climbing), the
   renderer IPC rejected with `Target page, context or browser has been
   closed`, and `app.evaluate` afterwards was unavailable - the app was dead
   (`test-fixtures/adv-p54/logs/a4b.log`).
4. Swept the size with `node test-fixtures/adv-p54/a4d-bigsteps.cjs`:
   25 MiB decoded -> 445 ms, 50 MiB -> 1135 ms, 100 MiB -> 2155 ms, all
   `ok:true`; 200 MiB -> OOM. So even the surviving sizes freeze the main
   process synchronously for seconds.

Root cause: `contentUsesDeviceRgb` in
`src/main/services/validation/pdfa.ts` calls `content.split(/\s+/)` on the
fully decoded content, materialising ~100 million substrings for 200 MiB, with
no byte cap; `DocumentValidationService.validateBytes` runs the collection
synchronously with no timeout and no size guard.

Expected: a bounded scan (size cap or streaming tokeniser) and a typed
`too-large`/`timeout` result; never an OOM of the main process.
Actual: a 408 KB crafted PDF kills the application during PDF/X validation.

Screenshot: none (process death). Logs:
`test-fixtures/adv-p54/logs/a4b.log`, `test-fixtures/adv-p54/logs/a4d.log`.
Fixture: `test-fixtures/adv-p54/val-bigcontent.pdf`.

Disposition: ACCEPTED -> DEF-381

## ADV-100: Image-import page size is unclamped - a 1-DPI metadata claim produces a 1,417,322 pt page, and a max-pHYs claim produces a 0.000066 pt page and a 308,791,459% zoom

- Session: phase-54 gate
- Suggested severity: MEDIUM

What I did:
1. Built genuine images with hostile resolution metadata (all valid PNGs whose
   pixel data really is the stated size):
   - `png-20000-1dpi.png` (20000x20000, 1-bit gray, `pHYs` 40 px/m = 1.016 DPI)
   - `png-2000-1dpi.png` (2000x2000, `pHYs` 40 px/m)
   - `png-phys-max.png` (100x100, `pHYs` 0xFFFFFFFF px/m = 109,092,169 DPI)
   - `png-1x1-100000dpi.png` (1x1, `pHYs` 3,937,008 px/m = 100,000 DPI)
2. `node test-fixtures/adv-p54/a2-one.cjs png-20000-1dpi.png 180000` and the
   same for the others through `window.tflex.convert.toDocument`.
3. Results (page media boxes read back from the produced PDF):
   - `png-20000-1dpi.png`: `ok:true`, 1 page, **1,417,322.83 x 1,417,322.83
     pt** (~19,685 in per side, about 98x PDF's 14,400 pt implementation
     limit), `warnings: []`, 16.3 s.
   - `png-2000-1dpi.png`: 141,732.28 pt per side, `warnings: []`.
   - `png-phys-max.png`: 0.000065999 pt per side, `warnings: []`.
   - `png-1x1-100000dpi.png`: 0.00072 pt per side, `warnings: []`.
4. Opened the degenerate ones through the real Create-from-images dialog
   (`a6b-one.cjs`): the UI enters `zoom=308791459%` for `png-phys-max.png`
   and `zoom=283055565%` for `png-1x1-100000dpi.png`; the Inspector's `Size`
   row shows `-` (undetermined) for every case above. Screenshots:
   `test-fixtures/adv-p54/shots/a6-phys-max.png` (308,791,459%),
   `a6-1x1-100k.png`, `a6-2000-1dpi.png` (1% zoom).

Root cause: `computeImagePlacement` (adapters/images.ts) computes
`points = pixels / dpi * 72` per axis with no floor or ceiling; `resolveDpi`
only rejects `dpi <= 0`, and nothing validates the resulting media box.

Expected: the app should either refuse a page size outside a sane range with a
readable warning, or clamp it; it must not silently emit a PDF page far beyond
the format's implementation limit (or a near-zero page that drives the UI to a
308-million-percent zoom).
Actual: `ok:true` with no warning in every case. The absurd page is written and
opened; the only symptom is the unreadable zoom and the `Size: -` inspector
row.

Screenshot: `test-fixtures/adv-p54/shots/a6-phys-max.png` (zoom pill
`308791459%`), `a6-1x1-100k.png`, `a6-2000-1dpi.png`.

Disposition: ACCEPTED -> DEF-382

## ADV-101: A wrong-typed /OutputIntents hard-errors the validator instead of reporting "could not be determined"

- Session: phase-54 gate
- Suggested severity: MEDIUM

What I did:
1. Built PDFs whose catalog `/OutputIntents` is the wrong type:
   `val-oi-number.pdf` (`/OutputIntents 42`), `val-oi-nested.pdf`
   (`/OutputIntents [[1 2] [3 4]]`), `val-oi-array-of-numbers.pdf`
   (`/OutputIntents [1]`), and `val-oi-null.pdf` (`/OutputIntents null`).
2. `node test-fixtures/adv-p54/a4-validation.cjs` calls the real
   `window.tflex.validation.validateBytes(bytes, 'pdfa-1b')` on each.
3. Observed:
   - `val-oi-number.pdf` -> `ok:false`, `error {code:'internal', message:
     "Validation failed: Expected instance of _PDFArray, but got instance of
     _PDFNumber"}`.
   - `val-oi-nested.pdf` -> same shape with `_PDFDict`/`_PDFArray`.
   - `val-oi-array-of-numbers.pdf` -> same shape with `_PDFDict`/`_PDFNumber`.
   - `val-oi-null.pdf` -> `ok:true`, reported as "No /OutputIntents entry".
4. Root cause (verified in `node_modules/@cantoo/pdf-lib/cjs/core/PDFContext.js:
   62-81`): `lookupMaybe(ref, type)` THROWS `UnexpectedObjectTypeError` when the
   object exists but is not one of `type`; it does not return `undefined`.
   `collectOutputIntent` relies on it for `/OutputIntents` and for each entry;
   the same pattern is used for font resources and ExtGState in
   `collectFontEmbedding` / `collectTransparency`.

Expected: the rule set's own documented promise - "Where a check cannot be
decided from the parsed data it is reported as a warning with the text 'could
not be determined', never as a silent pass" - i.e. a report with an
undetermined output-intent warning (and the other rules still evaluated).
Actual: the entire validation aborts with a generic `internal` error and no
rule list for a PDF whose `/OutputIntents` is merely the wrong type.

Screenshot: none.

Disposition: ACCEPTED -> DEF-383

## ADV-102: SVG parse and geometry failures are never surfaced - truncated and all-NaN SVGs import silently

- Session: phase-54 gate
- Suggested severity: MEDIUM

What I did:
1. Built `svg-truncated-25/50/75/90.svg` (the Phase 54 `native.svg` cut at 25%,
   50%, 75%, 90% of its bytes) and `svg-numeric-hostile2.svg` (a valid 100x100
   SVG whose only shapes carry `NaN`, `Infinity`, `1e999` and negative
   `x/y/width/height/rx/ry/r/cx/cy/stroke-width`).
2. `node test-fixtures/adv-p54/a3-svg.cjs 90000 svg-truncated-25.svg
   svg-truncated-50.svg svg-truncated-75.svg svg-truncated-90.svg
   svg-numeric-hostile2.svg` through the real conversion bridge.
3. Observed for all five: `ok:true`, `fidelity:'native'`, `warnings: []`.
   The truncated files each import one partial page (the parse diagnostics
   "Unclosed <g> element", "Unclosed <polygon> element", etc. are discarded);
   `svg-numeric-hostile2.svg` imports one blank 75x75 pt page (`generatePaintOps`
   returns `ops: []` because every geometry value fails `readNumber`). Opening
   it through the real Open dialog shows a blank page with a `Native` fidelity
   badge and zero warnings. Screenshot:
   `test-fixtures/adv-p54/shots/a6-svg-numeric.png`.
4. Root cause: `parseSvg` returns `diagnostics` and `generatePaintOps` carries
   them into `PaintResult.diagnostics`, but the SVG adapter
   (`adapters/svg.ts`) never reads `paint.diagnostics`; there is no warning for
   dropped geometry either.

Expected: a warning naming the malformed/truncated markup (or the constructs
that could not be translated), or a fallback to the engine-rendered path; the
user must not be shown a silently partial or blank page as `Native`.
Actual: silent partial and silent blank imports with no warning.

Screenshot: `test-fixtures/adv-p54/shots/a6-svg-numeric.png`.

Disposition: ACCEPTED -> DEF-384

## ADV-103: A 62-byte TIFF with absurd frame dimensions blocks the main process ~27 s and transiently allocates gigabytes

- Session: phase-54 gate
- Suggested severity: MEDIUM

What I did:
1. Built `test-fixtures/adv-p54/tiff-absurd-dims.tiff`, 62 bytes: IFD tags
   `t256=20000`, `t257=20000`, `t273=[]` (empty StripOffsets), `t277=1`.
2. `node test-fixtures/adv-p54/a2-one.cjs tiff-absurd-dims.tiff 90000` through
   the real conversion bridge.
3. Observed: the call took **26,963 ms** and then returned `ok:true` with one
   `frame-decode-failed` placeholder page; the app was usable afterwards. No
   progress, no cancel response during those 27 s - the main process (and so
   the whole UI) is blocked for the duration; only then does the frame degrade.
4. Cause (verified in `node_modules/utif/UTIF.js`): `UTIF.decodeImage`
   allocates `new Uint8Array(height*(bipl>>>3))` (line 125) before it touches
   the strip offset list, and `UTIF.toRGBA8` allocates `new Uint8Array(area*4)`
   (line 986) before the adapter's own `rgba.length < width*height*4` guard can
   reject the frame - about 50 MB and 1.6 GB respectively for these numbers,
   plus the PNG re-encode. The adapter's per-frame `try/catch` only limits the
   final result, not the work done to get there.

Expected: a frame that cannot be decoded should fail fast with a typed error;
a 62-byte file must not purchase tens of seconds of main-process time and
gigabyte allocations.
Actual: ~27 s of UI-blocking synchronous work and transient multi-gigabyte
allocation before the placeholder page is produced.

Screenshot: none. Log: `test-fixtures/adv-p54/logs/absurd-dims.log`.

Disposition: ACCEPTED -> DEF-385

## ADV-104: A conforming PDF that declares `pdfaid part 9 / conformance Z` validates as conforms:true with declared "PDF/A-9z"

- Session: phase-54 gate
- Suggested severity: LOW

What I did:
1. Took the known-conforming `test-fixtures/phase54/pdfa-1b-ok.pdf`, and patched
   its XMP `pdfaid:part` from `1` to `9` and `pdfaid:conformance` from `B` to
   `Z`, saving `test-fixtures/adv-p54/val-pdfa-conforming-bogusid.pdf`.
2. `node test-fixtures/adv-p54/a4c-bogusid.cjs` validates it through the real
   bridge against `pdfa-1b` and `pdfa-2b`.
3. Observed: `ok:true`, `declared:"PDF/A-9z"`, `conforms:true`,
   `violations: []` for both targets. The unpatched control still reports
   `declared:"PDF/A-1b", conforms:true`. Likewise
   `val-pdfa-unknown-conf.pdf` (part 1, conformance `X`) reports
   `declared:"PDF/A-1x"`, and `val-pdfx-part9.pdf` reports
   `declared:"PDF/X-99:2099"` - no rule flags the impossible identifier.
4. Cause: `parsePdfaId` accepts any integer `part` and any non-empty
   `conformance` string; nothing validates the pair against the known set.

Expected: an unknown part or conformance letter should be reported (e.g. an
"unrecognised declared level" warning) rather than echoed, and the report
should not pair a standard that does not exist with `conforms:true`.
Actual: `declared: PDF/A-9z` + `conforms: true`, no warning.

Screenshot: none.

Disposition: ACCEPTED -> DEF-386

## ADV-105: SVG remote resources are silently dropped - the documented resource-blocked warning never appears

- Session: phase-54 gate
- Suggested severity: LOW

What I did:
1. Built `svg-remote.svg` (two `<image>` elements pointing at
   `https://example.invalid/...` and `http://example.invalid/...`) and
   `svg-remote-styles.svg` (a `@import url(https://...)`, an
   `https://...`-valued `fill`, and a `filter`).
2. `node test-fixtures/adv-p54/a3-svg.cjs 150000 svg-remote.svg
   svg-remote-styles.svg` through the real conversion bridge.
3. Observed: both take the engine-rendered fallback and report exactly one
   warning, `engine-rendered`; there is NO `resource-blocked` warning. The
   produced PDFs contain no remote content. Separately,
   `svg-external-entity.svg` (a `SYSTEM "file:///C:/Windows/win.ini"` entity)
   produced a PDF that contains none of win.ini's content
   (`a3b-probe.cjs`, `containsWinIniContent:false`), and the billion-laughs
   document produced a 26 KB PDF with no expansion.
4. What I can prove: no remote resource reached the output and no win.ini
   content was read/rendered. What I cannot prove from the app: whether the
   request was attempted and cancelled by the dedicated session (which would
   have recorded it for `blockedResourceWarnings`) or never issued because the
   injected CSP `img-src data: file:` blocked it first. Either way the handler
   recorded nothing, so the promised warning is absent.

Expected: the Phase 53 engine path documents that every blocked http/https/ws/
wss/ftp request is recorded and surfaced as a `resource-blocked` warning; an
SVG whose remote image is dropped should tell the user so.
Actual: the remote resources are dropped with only the `engine-rendered`
warning; no `resource-blocked` warning appears. Cause not identified.

Screenshot: none. Logs: `test-fixtures/adv-p54/logs/svg-remote.log`.

Disposition: ACCEPTED -> DEF-387

## Negative results - Phase 54 (verified correct, no finding)

- **PNG `pHYs` with 0 px/m or unit 0, and JPEG JFIF density unit 0 or density
  0** (`png-phys-zero.png`, `png-phys-unit0.png`, `jpg-jfif-unit0.jpg`,
  `jpg-jfif-density0.jpg`): each correctly yields `dpi-assumed` and a 96 DPI
  page (75x75 pt / 540x270 pt), never a divide-by-zero. `resolveDpi` rejects
  only `dpi <= 0`, and the readers require `unit === 1 && ppu > 0`.
- **Mislabeled containers**: `pdf-as-png.png` (PDF bytes named `.png`) and
  `text-as-png.png` are refused with a readable `unsupported-format`
  ("This file type is not supported for import. (...)"); `png-as-tiff.tiff`
  and `tiff-as-png.png` are content-sniffed to the correct adapter. No garbage
  is embedded.
- **TIFF frames with no IFD / header only** (`tiff-no-ifd.tiff`,
  `tiff-header-only.tiff`): one degraded placeholder page plus a
  `frame-decode-failed` warning; app usable. `tiff-empty.tiff` (0 bytes) gets a
  readable `unsupported-format`. `tiff-res-zero.tiff` (resolution tags 0) uses
  the 96 DPI assumption.
- **TIFF frame-count ceiling** (`tiff-frames-1200.tiff`, `tiff-frames-3000.tiff`):
  1200/3000 pages convert with the documented advisory `frame-limit` warning
  ("above the advisory ceiling of 1000; all frames were converted") in 3.3 s /
  8.6 s - the contract's "warns loudly, never a silent truncation".
- **Billion laughs and external-entity SVGs**: the hand-rolled scanner neither
  expands entities nor reads files - the pure harness (`pure.cjs`) shows the
  parse tree carries no expanded text, and the engine-fallback PDFs contain no
  win.ini content and no `lol` run. `parseSvg` has no fs/network imports.
- **Deep nesting**: 2000 nested `<g>` imports natively and fast; 100,000
  nested `<g>` returns a typed `internal` error ("Maximum call stack size
  exceeded") rather than crashing the app.
- **Oversized `path` `d`** (`svg-huge-path.svg`, 200,000 segments): fails fast
  with a typed `internal` error, no hang; the app stays usable. (Reported as
  the observed outcome of attack 13; not filed as a defect.)
- **`viewBox` of zero/negative size and `width`/`height` of 0**: readable
  `decode-failed` ("declares neither a width/height nor a viewBox"); a zero
  width/height with a valid `viewBox` correctly falls back to the viewBox.
- **`use` loop a->b->a and a 500-deep `use` chain**: no infinite recursion;
  both take the engine-rendered fallback with the `engine-rendered` warning
  naming `use`.
- **20000x20000 `filter` + `mask` engine fallback** (`svg-filter-mask-20000.svg`):
  completed in 117 ms and produced a 15000x15000 pt page; the print timeout was
  never needed and the app stayed usable. The offscreen engine honoured
  `preferCSSPageSize`.
- **`/Encrypt` plus a `pdfaid` declaration**: the validator reports both the
  `pdfa.encryption` error and the output-intent error and does not strip or
  rewrite anything (validation is read-only). Truncated XMP mid-packet reports
  `declared: null` without crashing.
- **Create-from-images error routing**: a non-image named `.png`, random bytes
  named `.jpg`, and a file deleted between picking and confirming each produce
  a readable error toast ("Could not create PDF: That file type cannot be
  imported (...)" / "The file could not be imported (...)"), leave no tab open
  and no stuck dialog.
- **500-file selection**: the dialog rendered 500 rows in 790 ms and produced a
  500-page document with 500 `dpi-assumed` warnings; the app remained usable.
- **Absurd dimension underflow/overflow of the page size is documented above
  (ADV-100); the TIFF `res-zero` 0.75 pt page and the 1x1 `png-as-tiff` 0.75 pt
  page are the same unclamped-arithmetic class.**

## ADV-098 / ADV-099 root-cause relationship

ADV-098 (cyclic TIFF IFD) and ADV-099 (200 MB content-stream split) are the
same *class* - an unbounded allocation reached from a tiny hostile file - but
different root causes: one is an infinite IFD-chain walk inside `utif`, the
other is `String.split` over an unbounded decoded content stream inside the
Phase 54 rule set. ADV-100 (page-size arithmetic) is a third, distinct cause.
ADV-103 is a fourth (utif allocation before the adapter's decode guard).

## ADV-106: A 5.7 KB XLSX whose declared range is the Excel maximum drives `worksheetToGrid` into ~1.6 billion cells and V8-OOM-crashes the main process

- Session: phase-55 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p55/xlsx-maxrange.xlsx` (5,696 bytes): a valid SheetJS
   workbook whose only worksheet's `<dimension ref="A1:XFD1048576"/>` was patched
   to the Excel maximum (4 real cells: h1/h2, a/b).
2. Launched the dev build through `e2e/lib/launch.cjs`, stubbed
   `dialog.showOpenDialog` to return the file, clicked the real
   `[aria-label="Open PDF document"]` Open button, and polled the main-process RSS
   and the DOM for 180 s (`test-fixtures/adv-p55/probe/probe-hang.cjs`).
3. Ran the same adapter code path at module level (esbuild bundle of the shipped
   `worksheetToGrid`/`renderWorkbookHtml`, exact `CONVERT_LIMITS.sheetRows` =
   100,000) to quantify (`probe/probe-xlsx.cjs`).
4. Separately built `test-fixtures/adv-p55/xlsx-merge-huge.xlsx` (5,701 bytes):
   `!ref` is a small `A1:A2` but one `mergeCell ref="A1:XFD1048576"` expands the
   iterated range (same root cause, a second trigger that does not need a patched
   dimension).

Expected: a workbook declaring a large used range but containing almost no cells
converts to a short PDF, or reports the documented `row-limit` warning. It must
never allocate proportional to the declared range rather than the real data.

Actual: the app's main process was pegged and, at ~195 s process uptime, V8
aborted with `OOM error in V8: MarkCompactCollector: young object promotion
failed Allocation failed - JavaScript heap out of memory`; the Electron window
closed and the application died (`[probe-hang] died=window:close`, mainRSS
sampling unreadable). The 5,696-byte file kills the app.
Module-level numbers: `worksheetToGrid` (maxRows 100,000) materialises every
column of the declared range for every rendered row. 1,000 rows took 5,629 ms
and 938 MB RSS; the loop is 100,000 rows x 16,384 columns = 1,638,400,000 cell
expansions, which extrapolates to roughly 9 minutes and ~94 GB before the ~4 GB
V8 heap limit is hit. The merge variant reports `sourceRowCount=1048576`,
`cols=16384` from a 5,701-byte file.
Cause: `src/main/services/convert/adapters/xlsx.ts` `worksheetToGrid` caps the
ROW loop with `maxRows` but the inner column loop
`for (let c = range.s.c; c <= range.e.c; c += 1)` has no ceiling, and
`range.e.c`/`range.e.r` come straight from the file's `dimension` ref or any
`mergeCell` ref. `renderWorkbookHtml` then repeats the full grid again
(`buildColgroup` + body rows), and the ~15 GB of HTML for 100,000 rows is never
reached before the OOM.
Screenshot: none (the window is gone by the time a shot could be taken).
Fixtures: `test-fixtures/adv-p55/xlsx-maxrange.xlsx`,
`test-fixtures/adv-p55/xlsx-merge-huge.xlsx`.
Logs: probe-stdout of `probe/probe-hang.cjs` and `probe/probe-xlsx.cjs`.

Disposition: ACCEPTED -> DEF-392

## ADV-107: A 569-byte ODT with nested repeated table cells expands exponentially in `odfToHtml`, blocking the main process ~30 s and allocating ~3.5 GB

- Session: phase-55 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p55/odt-table-bomb-d{2,3,4,6}.odt` (568-571 bytes):
   `content.xml` nests `d` levels of
   `<table:table><table:table-row><table:table-cell
   table:number-columns-repeated="1000">...` around one `<text:p>x</text:p>`.
   The parsed node count is tiny (well under `ODF_PARSE_LIMITS.maxNodes`).
2. Ran the shipped pure parser at module level
   (`probe/probe-xml.cjs`: `openZip` -> `parseOfficeStyles` -> `odfToHtml`).
3. Launched the app via `e2e/lib/launch.cjs`, opened `odt-table-bomb-d3.odt`
   through the real Open button, and polled the toast/DOM (`probe-one.cjs`); then
   verified the app was still usable afterwards (`probe-app.cjs`).

Expected: the documented ODF caps (`maxNodes` 200k, `maxDepth` 256,
`maxTextChars` 16 MB) keep a hostile ODT bounded, so a sub-kilobyte file cannot
allocate gigabytes. A malformed/pathological document gets a typed error.

Actual: the caps bound the PARSE but not the RENDER. `renderRows` emits one
`<td>` per `table:number-columns-repeated` (clamped to 1000) and `renderCell`
recursively renders a nested table inside each repeated cell, so the output is
`1000^depth` cells with no ceiling. Module results:
- d2 (568 bytes): 10,033,024-byte HTML in 552 ms, 264 MB RSS.
- d3 (569 bytes): `RangeError: Invalid string length` after 34,825 ms,
  3,575 MB RSS.
- d4/d6: same `RangeError` at ~32 s and 3,575 MB.
In the app, opening the 569-byte d3 file blocked the main process: the
user-facing error toast appeared at t=27 s
("The file could not be imported (\"odt-table-bomb-d3.odt\")."), and the app was
usable afterwards. On a machine with less free memory than this 64 GB box, the
~3.5 GB allocation is an OOM risk of the same class as ADV-106.
Cause: `src/main/services/convert/odf-to-html.ts` `renderRows`/`renderCell`
recursion with `table:number-columns-repeated` clamped per cell
(`MAX_REPEATED_CELLS = 1000`) but with no total-rendered-node or output-size
budget across the recursion.
Fixtures: `test-fixtures/adv-p55/odt-table-bomb-d2.odt` (through d6).
Logs: probe-stdout of `probe/probe-xml.cjs`, `probe/probe-one.cjs`,
`probe/probe-app.cjs`.

Disposition: ACCEPTED -> DEF-393

## ADV-108: `.xlsx` export throws `Text length must not exceed 32767 characters` instead of returning a typed Result, aborting the whole export on a legitimate long line

- Session: phase-55 gate
- Suggested severity: MEDIUM

What I did:
1. Built `test-fixtures/adv-p55/pdf-long-line-40000.pdf` (1,105 bytes): one page
   whose text layer is a single 40,000-character line with no newline and no
   two-consecutive-space run.
2. Launched the dev build via `e2e/lib/launch.cjs`, opened the PDF, then invoked
   exactly what the export UI invokes -
   `window.tflex.export.xlsx(docId, {})` - and caught the result.
3. Reproduced at module level against the shipped `buildXlsx`
   (`probe/probe-export.cjs`): 32,767 chars -> OK; 32,768 chars -> throws.

Expected: the writer's documented contract and the preload comment are
`Promise<Result<ExportBuild, ExportErrorCode>>`, "never a throw" - a page whose
text cannot fit a spreadsheet cell should either degrade that cell (as the
image data URI path already does with its 30,000-char marker) or return a typed
`err`.

Actual: `XLSX.write` throws `Error: Text length must not exceed 32767
characters` (node_modules/xlsx/xlsx.js `write_ws_xml_cell`), `buildXlsx` does
not catch it and `exportXlsx` returns that rejected promise. In the app the call
rejected with:
`Error invoking remote method 'export:xlsx': Error: Text length must not exceed
32767 characters`.
The renderer's `OfficeExportDialog` catch surfaces a generic
"XLSX export failed: ... Text length must not exceed 32767 characters" and the
whole export fails; the `Page N` sheet AND the `Full text` sheet are both lost.
This is not a crash and not data loss (the source PDF is untouched), but it is a
violated typed-Result contract and a hard failure on input the app can produce.
Cause: `src/main/services/export/xlsx-export.ts` `buildXlsx` passes every
extracted line straight into `aoa_to_sheet`/`write` with no per-cell length
guard and no try/catch; `exportXlsx` does not wrap the synchronous `buildXlsx`.
Fixtures: `test-fixtures/adv-p55/pdf-long-line-40000.pdf`.
Logs: probe-stdout of `probe/probe-export.cjs` and the app run of
`probe/probe-app.cjs` for `pdf-long-line-40000.pdf`.

Disposition: ACCEPTED -> DEF-394

## Phase 56 gate - EPUB / Mobipocket / comic-archive parsers

Session label: `phase-56 gate`. Attack ran against the uncommitted Phase-56 parsers
built from the working tree (`npm.cmd run build`; the pure-parser probes bundle the
TS directly with esbuild). Harnesses and all specimens live under
`test-fixtures/adv-p56/` (`gen-p56.cjs`, `gen-epub-big.cjs`, `probe/probe-p56.cjs`,
`probe/probe-app56.cjs`, `probe/bundle.cjs`); the app probes launch ONLY through
`e2e/lib/launch.cjs`. Peak-RSS figures are the probe child's own
`process.memoryUsage().rss`; the app OOM lines are Electron main stderr.

## ADV-109: A 2.5 KB EPUB whose chapter references one image N times OOM-crashes the main process (no output cap in `inlineEpubImages`)

- Session: phase-56 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p56/epub-img-amp-10000.epub` (2,323 bytes: one 64 KiB
   PNG file referenced by 10,000 `<img src="pic.bin"/>` tags) and
   `epub-img-amp-1mb.epub` (2,464 bytes: one 1 MiB PNG referenced by 5,000 tags).
2. Module level (`probe/probe-p56.cjs epub-print` / `epub-reading`, shipped
   functions from the bundle): `parseEpub` returned in 7 ms, then both the print
   path (`composeEpubBody`) and the reading path
   (`inlineEpubImages` + `chapterFragment` + `sanitizeEpubFragment`, exactly what
   `convert.readingDocument` composes) threw `RangeError: Invalid string length`.
   Peak RSS was 1,097 MB (10,000 x 64 KiB) and 6,768 MB (5,000 x 1 MiB), reached in
   449 ms / 968 ms.
3. App level (`probe/probe-app56.cjs`, only `e2e/lib/launch.cjs`): called
   `window.tflex.convert.readingDocument()` on `epub-img-amp-1mb.epub`. The Electron
   main process died within 622 ms with:
   `OOM error in V8: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`
   and the Playwright target page closed (the app crashed). The smaller
   `epub-img-amp-10000.epub` returned the typed `internal` failure
   ("The import failed unexpectedly. Invalid string length") after 399 ms and the
   app stayed usable - it only survived because 1.1 GB is below the heap cap.

Expected: inlining a chapter's images must be bounded (a per-document output budget,
or a typed `too-large` refusal once the composed fragment would exceed a ceiling) -
a 2.5 KB input must never exhaust the main process heap.

Actual: `src/main/services/convert/epub-parse.ts` `inlineEpubImages` replaces every
`<img>`/`<image>` reference with the FULL base64 `data:` URI of the referenced part;
`collectEpubImages` stores one copy but the output repeats it once per reference, so
output = (number of references) x (image size). Nothing caps the result; only V8's
~512 MB string length limit stops it, after allocating hundreds of MB to tens of GB.
The same function is reached by the print adapter (`composeEpubBody`) and by
`readingDocument`, so opening OR reading the book crashes. Root cause: no output /
reference-count budget in `inlineEpubImages` (and `chapterFragment` is not the limit).
Fixtures: `test-fixtures/adv-p56/epub-img-amp-10000.epub`,
`epub-img-amp-1mb.epub`. Logs: probe-stdout of
`probe/probe-p56.cjs epub-print|epub-reading` and the Electron stderr in
`probe/probe-app56.cjs`.

Disposition: ACCEPTED -> DEF-396

## ADV-110: A 7.8 MB MOBI whose markup references one image 300,000 times drives unbounded memory growth and kills the app (no output cap in `inlineMobiImages`)

- Session: phase-56 gate
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p56/mobi-img-amp-300k.mobi` (7,797,486 bytes): a PalmDOC
   (uncompressed) text record whose markup is 300,000 `<img recindex="1"/>` tags
   (5.7 M chars, well under the 32 MB text ceiling) plus one 2 MiB valid-PNG image
   record. `parseMobi` returned in 20 ms - the parser itself is fine.
2. Module level (`probe/probe-p56.cjs mobi-compose`): `composeMobiBody` ->
   `inlineMobiImages` did not return; the probe was hard-killed by the supervisor
   after 180 s with no error and no progress.
3. Synthetic bisection of the same shipped `inlineMobiImages` (`mobi-amp-synth`):
   5,000 refs x 1 MiB image -> `RangeError: Invalid string length` after 1,913 ms at
   peak RSS 6,768 MB; 20,000 refs x 1 MiB -> `RangeError` after 8,186 ms at peak RSS
   26,815 MB. Peak memory scales with references x image bytes.
4. App level (`probe/probe-app56.cjs`): `window.tflex.convert.toDocument()` on the
   fixture closed the whole Electron app ("Target page, context or browser has been
   closed") in ~8.3 s - a hard crash, not a typed refusal.

Expected: bound the inlined markup the same way the parser bounds text (32 MB) and
one image (16 MB): cap the total inline output and return a typed `too-large`, and
never allocate gigabytes for a single document.

Actual: `src/main/services/convert/adapters/mobi.ts` `inlineMobiImages` replaces each
`recindex` reference with the full base64 data URI and has no output budget;
`composeMobiBody` calls it before printing. `mobi-parse.ts` caps the compressed text
(32 MB) and each image (16 MB) but not (references x image bytes), so a modest file
allocates tens of GB. The app dies from memory exhaustion / OOM. Fixture:
`test-fixtures/adv-p56/mobi-img-amp-300k.mobi`. Logs: probe-stdout of
`probe/probe-p56.cjs mobi-compose|mobi-amp-synth` and
`probe/probe-app56.cjs doc:mobi-img-amp-300k.mobi`.

Disposition: ACCEPTED -> DEF-397

## ADV-111: A 1.9 MB PalmDOC record makes `decompressPalmDoc` allocate ~1 GB and block the main thread ~330 ms

- Session: phase-56 gate
- Suggested severity: MEDIUM

What I did:
1. Built `test-fixtures/adv-p56/mobi-lz77-bomb.mobi` (1,974,116 bytes): one PalmDOC
   text record of repeated unit `0x009F` (length 34, distance 4) that expands to the
   32 MB ceiling.
2. Module level (`probe/probe-p56.cjs lz77` and `mobi`): `decompressPalmDoc` threw
   the typed `ConvertFailure('too-large', "The decompressed e-book text exceeds the
   32 MB decompression ceiling.")` after 312-329 ms at peak RSS 986 MB.
3. App level (`probe/probe-app56.cjs doc:mobi-lz77-bomb.mobi`): the same typed
   `too-large` surfaced through IPC in 219 ms with no page error, and the app stayed
   usable.

Expected: the 32 MB decompression ceiling bounds CPU/memory; a file whose declared
expansion is 32 MB should not transiently allocate ~1 GB.

Actual: `src/main/services/convert/mobi-parse.ts` `decompressPalmDoc` accumulates
into `const out: number[]` (a packed element is ~8 bytes, so 32 M entries ~256 MB)
and then `Uint8Array.from(out)` copies it, peaking at ~1 GB for a 1.9 MB input and
blocking the synchronous main thread ~330 ms. It is bounded and typed (so not a
crash), but it is a ~500x memory amplification and an OOM risk on a low-memory
machine, and the in-flight `AbortSignal` is never observed mid-decompress. Fixture:
`test-fixtures/adv-p56/mobi-lz77-bomb.mobi`. Logs: probe-stdout of
`probe/probe-p56.cjs lz77|mobi` and `probe/probe-app56.cjs`.

Disposition: ACCEPTED -> DEF-398

## Negative results - Phase 56 (verified correct, no finding)

These directions from the dispatch were exercised and found SOUND; the next pass
should not repeat them:

- EPUB OPF spine itemref count: 50,000 itemrefs parse and compose in 71 ms / 111 MB;
  1,000,000 itemrefs are refused as typed `corrupt` by the bounded XML node ceiling
  ("ODF node ceiling reached") - the spine is NOT an unbounded declared extent.
  (`epub-spine-50000.epub`, `epub-spine-1000000.epub`.)
- EPUB container/OPF malformed input: missing `META-INF/container.xml` -> typed
  `corrupt`; a billion-laughs DOCTYPE in the OPF is tokenised without entity
  expansion (title came back literally as `&f;`); a 10,000-deep OPF -> typed
  `corrupt` ("ODF depth ceiling reached"). Oversized container.xml remains covered by
  the already-verified Phase-55 ZIP ceilings (not re-tested).
- EPUB chapter shapes: a 10,000,000-character chapter and a 10,000-deep nested
  chapter both sanitize/inline and return linearly (10.0 M chars in 48 ms / 76 MB;
  10 k nesting in 13 ms), no recursion overflow.
- EPUB path resolution (`resolveEpubHref`): `../evil.xhtml` and
  `%2e%2e%2f%2e%2e%2fevil.xhtml` normalise INSIDE the package (no filesystem
  escape), `http:`, `file:`, `data:` and `C:\...` all return `null` (never looked up).
- EPUB scrubber (`sanitizeEpubFragment`): 28 evasion vectors all neutralised -
  mixed-case/entity/tab/newline/`&colon;` `javascript:`, `vbscript:`, `data:text/html`
  embedded `<script>`, `<svg onload>`, `<iframe srcdoc>`, `<foreignObject>`,
  `<meta http-equiv=refresh>`, `on*` handlers, slash-split attributes, namespace
  prefixes, bare/unclosed script, quote-breakout attribute, `style` attr. The reading
  view's renderer-side `sanitizeReadingFragment` re-sanitizes (drops `data:text/html`
  too) and the renderer CSP has no `unsafe-inline`, so no script reaches the DOM. The
  only retained-but-inert value is `data:image/svg+xml` in an `href`/`src`
  (`epub-parse.ts` allows all `data:`, the renderer blocks only `data:text/html`);
  SVG in `<img>` is static and a data: top-frame navigation is blocked by Chromium,
  so it is noted as an inert observation, not a bypass.
- MOBI typed refusals: `encryptionType=2` and EXTH type 504 both throw typed
  `drm-protected` in 0 ms; a DRM file whose text record is a decompression bomb is
  refused in 0 ms with no RSS increase (DRM is checked BEFORE any decompression); a
  HUFF/CDIC file throws typed `unsupported-format`; a HUFF/CDIC+DRM file throws
  `drm-protected` (DRM wins). All verified through the real IPC and the app stayed
  usable with no tab opened.
- MOBI PalmDB/record-table malformations: out-of-order offsets, `numRecords=65535`
  in a 200-byte file, and a 12-byte record 0 are all typed `corrupt` in <=1 ms. A
  KF8 BOUNDARY uid on record 0 is ignored. A huge EXTH count with a short block is
  bounded and ignored. A truncated literal run and a back-reference before the output
  start are typed `corrupt`.
- TAR/CBT: octal `77777777777` -> typed `too-large`; non-octal size -> typed
  `corrupt`; a 511-byte archive -> typed `corrupt`; a declared payload past the end ->
  typed `corrupt`; 10,000 records -> typed `too-large` at 4,097; 1,024 zero bytes ->
  typed `corrupt` ("no readable image entries"); a chain with no terminating zero
  blocks ends cleanly and returns its entry; a `../../evil.png` name is only a label
  (`readTar` never touches the filesystem); a record named `p1.png` whose payload is a
  nested TAR is skipped with `frame-decode-failed`, not mis-read.
- CBZ: 10,000 entries -> typed `too-large` at the 4,096-entry ZIP ceiling; a
  signature-only truncated PNG and a 0-byte image are skipped with
  `frame-decode-failed` while the valid pages still convert; a single 100 MB inflated
  image peaks at 524 MB / 246 ms (bounded by the already-verified per-entry 128 MiB
  ZIP ceiling). Duplicate entry names are collapsed by the `fflate` object map - not a
  crash surface.

## Phase 57 DEF-402 parser - hostile review (session `phase-57 def-402`)

Scope: the new `/ToUnicode` CMap path added by the DEF-402 fix in
`src/main/services/engine.ts` (`parseToUnicodeCMap`, `resolvePageFontToUnicode`,
`parseContentStreamText` hex decoding through `fontMaps`), reached through
`EngineService.exportText` (Export Text / text-first DOCX). Fixtures live under
`test-fixtures/adv-p57/`; module harnesses under `test-fixtures/adv-p57/probe/`
(the `engine-bundle.cjs` bundle re-exports the shipped `EngineService`; the app
probes launch through `e2e/lib/launch.cjs` `launchApp` and drive
`window.tflex.engine.exportText(engineDocId)` in the renderer).

Important V8 caveat discovered while measuring: the same module code + bytes are
up to ~40x slower under Node 24 than under Electron 44's V8. All app-facing
numbers below were measured under Electron's own V8 (and confirmed in the running
app); Node-only numbers are labelled as such and are not the finding basis.

## ADV-112: A valid bfrange array-form /ToUnicode CMap is decoded to the wrong text

- Session: phase-57 def-402
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p57/c-array-valid.pdf`: one page whose /Resources
   /Font /F1 is a Type0/Identity-H font with `/ToUnicode 7 0 R`, CMap using the
   standard bfrange ARRAY form with an exact destination count for the range:
   `beginbfrange <0041> <0043> [<0041> <0042> <0043>] endbfrange`; content stream
   draws the 3-code hex string `<004100420043> Tj`.
2. Opened it in the app (dev build) and called
   `window.tflex.engine.exportText(engineDocId)` from the renderer.
3. Control `c-simple-valid.pdf` uses the equivalent SIMPLE form
   `<0041> <0043> <0041>`. Reproduced at module level via
   `probe/probe-export.cjs` (drives the shipped EngineService).

Expected: the array form maps each code to its matching destination, so
`<0041><0042><0043>` extracts as "ABC" (same as the simple form).

Actual: array form extracts as "CDC"; simple form extracts "ABC". Inside
`parseToUnicodeCMap` the array regex runs first, then the SIMPLE-form regex
`/<hex>\s*<hex>\s*<hex>/g` (engine.ts ~7292) matches the array's destination
list `<0041> <0042> <0043>` as if it were a fresh simple range
(`lo=<0041> hi=<0042> dst=<0043>`) and overwrites the correct entries
(41->'C', 42->'D'). Valid array-form CMaps are common in real embedded fonts, so
this silently corrupts extracted text and the text-first DOCX export for those
documents. Exact repro is 8 ms and deterministic.
Screenshot: screenshots/adv-p57-c-array-valid.png

Disposition: ACCEPTED -> DEF-404

## ADV-113: A malformed /ToUnicode CMap (many `beginbfchar`, no `endbfchar`) freezes the app ~14 s

- Session: phase-57 def-402
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p57/h-bfchar-no-end.pdf` (1.0 MB): the page's Type0
   `/ToUnicode` stream is `beginbfchar` repeated 90,909 times (999,999 chars)
   with no `endbfchar`.
2. Opened it in the app and called exportText; measured the renderer wall clock
   and, concurrently, the time to take a screenshot (a screenshot is serviced by
   the Electron browser process, so it cannot complete while the main process is
   synchronously blocked).

Expected: the fix declares a 1,000,000-decoded-char ceiling precisely so a
hostile CMap is refused without stalling.

Actual: `exportText` blocked 14,799 ms; the concurrent screenshot took
14,388 ms, i.e. the window was unresponsive for the entire block (fallback text
"\u0000H" only appears after the freeze). Root cause is in `parseToUnicodeCMap`:
`cmapText.match(/beginbfchar([\s\S]*?)endbfchar/g)` is O(n^2) when many
`beginbfchar` tokens have no matching `endbfchar` — each candidate start lazily
rescans to the end of the string. Measured under Electron's V8: 5,000 tokens
(~55 KB) 31 ms; 10,000 118 ms; 20,000 473 ms; 50,000 2,964 ms; 90,000 ~14,370 ms.
Below Node 24 the same input is ~9,860 ms at 90,000, but the app number is the
14 s above. The `endbfchar`-less shape is bounded only by the 1M ceiling, so
~14 s is the ceiling worst case for it. A bfrange-array variant
(`h-bfrange-arr-open.pdf`, 975,022 chars) measured 40.7 s under Node but only
~1.0 s under Electron's V8, so it is NOT app-relevant and is recorded here only
as a Node-side observation.
Screenshot: screenshots/adv-p57-freeze-h-bfchar-no-end.png

Disposition: ACCEPTED -> DEF-405

## ADV-114: A page /Font dict with 200,000 entries freezes the app ~30 s in `resolvePageFontToUnicode`

- Session: phase-57 def-402
- Suggested severity: HIGH

What I did:
1. Built `test-fixtures/adv-p57/f-font-200k-entries.pdf` (2.9 MB): the page
   /Resources /Font dict has 200,000 entries `/F0 4 0 R ... /F199999 4 0 R`, all
   pointing at the same Type0 font (which has a tiny valid /ToUnicode).
2. Opened it in the app and called exportText.
3. Built 25k/50k/100k-entry variants (`f-font-N-entries.pdf`) and measured the
   module harness under Electron's V8.

Expected: a page with a large /Font dict is handled in bounded time.

Actual: the 200k fixture blocked `exportText` for 30,351 ms; the concurrent
screenshot could not be taken within 30,000 ms (Playwright timeout), i.e. the UI
was frozen >30 s. Scaling (Electron V8): 25,000 entries (340 KB file) 532 ms;
50,000 (690 KB) 1,734 ms; 100,000 (1.39 MB) 5,983 ms; 200,000 (2.9 MB) ~30,000 ms
— superlinear (about 3.3-5x per doubling). `resolvePageFontToUnicode`
(engine.ts ~7386) walks every `/Name N G R` entry with `entryRegex` and calls
`resolveObject` per entry, so a hostile /Font dict (which every page may carry)
scales without bound from a small file. The 200K case is only 2.9 MB on disk.
Screenshot: screenshots/adv-p57-freeze-f-font-200k-entries.png

Disposition: ACCEPTED -> DEF-406

## ADV-115: A long digit run in a PDF (large all-digit hex string in `Tj`) freezes the app quadratically in `parseXref` - 82 s at 800 KB, effectively unbounded

- Session: phase-57 def-402
- Suggested severity: HIGH

What I did:
1. Built fixtures whose content stream is one hex string of repeated `41`
   (a legal hex-encoded run that is also a long digit run): `h-hex-100000.pdf`
   (200 KB file), `h-hex-200000.pdf` (400 KB), `h-hex-400000.pdf` (800 KB),
   `h-huge-hex-tj.pdf` (4.0 MB file, 4,000,000 hex chars).
2. Opened `h-hex-400000.pdf` in the app and called exportText (concurrent
   screenshot as above).

Expected: exportText bounds or completes promptly.

Actual: `h-hex-400000.pdf` blocked 82,185 ms; the concurrent screenshot timed
out at 30,000 ms (UI frozen >30 s). Scaling under Electron's V8 (also matched in
the app): 100,000 hex chars 4.4 s; 200,000 18.0 s; 400,000 82.2 s — O(n^2).
Root cause: `parseXref`'s `/(\d+)\s+(\d+)\s+obj/g` (engine.ts ~6931) backtracks
from every start position through the whole digit run when no whitespace follows;
`h-huge-hex-tj.pdf` extrapolates to ~2 h. `parseXref` predates DEF-402, but it
runs inside the same `extractTextFromRawPdf` path, the dispatch explicitly listed
"a single enormous hex string (megabytes) in Tj/TJ" as an attack, and the trigger
is any long digit run anywhere in the raw file, so a legal PDF can silently pin
the main process for an unbounded time.
Screenshot: screenshots/adv-p57-h-hex-400000.png

Disposition: ACCEPTED -> DEF-407

## ADV-116: A 262 KB FlateDecode bomb in /ToUnicode inflates to 256 MB before the decoded-char ceiling is applied

- Session: phase-57 def-402
- Suggested severity: LOW

What I did:
1. Built `test-fixtures/adv-p57/f-zlib-bomb-256m.pdf` (262 KB): the Type0 font's
   `/ToUnicode` stream is `/Filter /FlateDecode` and inflates to 256 MiB of NUL
   bytes.
2. Opened it in the app, called exportText, and instrumented the main process's
   `zlib.inflateSync` to record input/output lengths.

Expected: the fix's 1,000,000-decoded-char ceiling should bound the work done on
a hostile CMap ("refuse, never stall").

Actual: `inflateSync` was called with 260,923 bytes and produced 268,435,456
bytes; the ceiling is checked on the decoded string (`cmapText.length >
MAX_TOUNICODE_CMAP_CHARS`), i.e. after full decompression. exportText finished in
~0.5 s with RSS peaking in the hundreds of MB — a ~1000x amplification rather
than a hang, but the ceiling does not bound decode cost and a ~1 MB bomb (~1 GB
out) risks OOM on a low-memory machine.
Screenshot: screenshots/adv-p57-f-zlib-bomb-256m.png

Disposition: ACCEPTED -> DEF-408

## Negative results - Phase 57 DEF-402 parser (verified sound, no finding)

- Char ceiling: `h-cmap-over-ceiling.pdf` (1,000,001 decoded chars) and
  `h-cmap-exactly-1m.pdf` (1,000,000 + the stream's trailing newline =
  1,000,001) are refused in ~11-12 ms.
- Entry ceiling: `h-entries-over-65536.pdf` (70,000 bfchar pairs, 910,021 chars)
  is refused at the 65,536-entry guard in 98 ms (Electron V8).
- Malformed CMaps, all bounded and non-throwing: `h-bfchar-unclosed.pdf`
  (unclosed `beginbfchar`, short) -> fallback 3 ms; `h-bfrange-descending.pdf`
  (`<FFFF> <0000> <0041>`, hi<lo) -> refused, fallback 3 ms;
  `h-bfrange-array-mismatch.pdf` (one dest for a 191-code range) maps only the
  supplied dest and returns "A", no expansion, no crash;
  `h-bfrange-array-extra-dests.pdf` (five dests for a 3-code range) maps the
  first entries, no crash; `h-tounicode-dangling.pdf` (`/ToUnicode 999 0 R`)
  -> no map, fallback 3 ms; `h-not-type0.pdf` (`/Subtype /TrueType` with a
  ToUnicode) -> skipped, fallback 3 ms.
- Content-stream fallbacks: `h-codes-absent.pdf` (code missing from map) decodes
  per code via windows-1252 ("HAB"), correct; `h-codewidth-1-vs-2.pdf` (1-byte
  CMap codes vs 2-byte content codes) falls back per chunk without throwing;
  `h-tj-mixed.pdf` (`[<0048> -100 (AB) <4142>] TJ`) -> "HABAB", correct order;
  `h-many-tf.pdf` (50,000 `Tf` switches, 1.0 MB) -> 33 ms, "H" x 50,000.
- `/ToUnicode` stream abuse: `f-flate-garbage.pdf` (FlateDecode junk) inflate
  fails, no CMap marker -> fallback 4 ms; `f-false-huge-length.pdf`
  (`/Length 999999999`) -> `resolveObject` falls back to `endstream`, fallback
  4 ms.
- Happy path unaffected: `sanity-bfchar.pdf` app exportText "H" in ~9 ms;
  `c-simple-valid.pdf` "ABC".

## Phase 58 gate — tab detach/drag-back, dock edit, home row edit, tab style

Session label: `phase-58 gate`. Ran against the production build
(`npm.cmd run build`; dist main + dist renderer, launched through
`e2e/lib/launch.cjs` with fresh `--user-data-dir` per probe). Harnesses live in
`test-fixtures/`: `adv-p58-tabs.cjs` (detach / drag-back sequences),
`adv-p58-settings.cjs` (settings corruption + home/dock hand-edits),
`adv-p58-dock.cjs` (dock edit mode). Logs: `adv_p58_*.log` at the repo root.

## ADV-117: Tear-out of a document with unsaved changes loses the dirty state — the new window reports clean

- Session: phase-58 gate
- Suggested severity: HIGH

What I did:
1. Ran `test-fixtures/adv-p58-tabs.cjs s7` (open `assets/samples/report.pdf`,
   fresh user-data-dir).
2. Marked the document dirty by clicking the PAGES dock `rotate` verb; the
   origin's `window.tflexDiagnostics()` then reported `modified: true`.
3. Dragged the tab below the tab strip and released (tear-out). The origin tab
   was removed once the new `#detached` window reported ready.
4. Polled the detached window's `window.tflexDiagnostics()`
   (`modified` / `tabModified`) every 250 ms for 2.5 s, then read the origin.

Expected: Phase 58 success criterion 8 — a tear-out with unsaved changes either
is refused with a readable reason OR the new window inherits the same unsaved
state; the dirty state is never dropped silently.

Actual: the origin reports `modified: true`; the detached window reports
`modified: false` and `tabModified: false` on the very first poll and at every
subsequent poll. The moved document is presented as clean, so the user gets no
"unsaved changes" cue. (The origin's tab-meta `tabModified` stays `false` even
for a dock rotate; the engine-level `modified` is `true`, which is what the
origin's own close gate and the detach payload read.)
Screenshot: none (state read via `tflexDiagnostics`). Log: `adv_p58_tabs_s7.log`.

Disposition: ACCEPTED -> DEF-414

## ADV-118: Closing a detached window silently discards unsaved edits (no close/quit gate)

- Session: phase-58 gate
- Suggested severity: HIGH

What I did:
1. Ran `test-fixtures/adv-p58-tabs.cjs s8`; opened `report.pdf`, tore the tab
   out, and waited for the document to load in the `#detached` window
   (pageCount 34, dock verbs present).
2. Marked the document dirty INSIDE the detached window via the PAGES dock
   `rotate` verb; the detached window's `tflexDiagnostics().modified` then read
   `true`.
3. Clicked the detached window's own titlebar close control
   (`[data-window-close]`) and checked for the DEF-142 unsaved-changes prompt.

Expected: the DEF-142 close/quit gate prompts before a window holding unsaved
edits closes (the behaviour the main window has), or the close is refused.

Actual: no prompt appears (`[data-close-tab-prompt]` count 0); the detached
window closes immediately and the edit is discarded with no save opportunity.
Reproduced in 2 of 2 runs where the document actually loaded. Root cause:
`createDetachedWindow` (`src/main/window.ts:554`) is created with no
`onCloseRequested` dependency, so its `'close'` handler never calls
`preventDefault()` and never pushes `window:closeRequested`; the whole
close-gate machinery (`src/main/index.ts:606-629`) is wired to the main window
only, leaving every detached window with no unsaved-close protection. This is
the gravest class: silent loss of a user's unsaved edits.
Log: `adv_p58_tabs_s8.log`.

Disposition: ACCEPTED -> DEF-415

## ADV-119: Intermittent tear-out leaves a blank orphan `#detached` window (payload race)

- Session: phase-58 gate
- Suggested severity: MEDIUM

What I did:
1. Ran `test-fixtures/adv-p58-tabs.cjs s8` six times (fresh user-data-dir each
   run): open `report.pdf`, tear the tab below the strip.
2. After the new window appeared, waited up to 15 s for `[data-tab-id]`, then
   polled `pageCount`, `.workspace`/`.welcome` and dock verb count for 20 s, and
   read the origin's tab list.

Expected: the new `#detached` window adopts the moved document (one tab, the
document loaded, the dock rendered).

Actual: in 4 of 6 runs the new `#detached` window never adopted the document —
it shows the Welcome screen with no tab, `pageCount 0`, no dock verbs, and no
way to recover it (`hadTabRef` stays false, so `notifyEmpty` never closes it);
it remains as a stray blank app window until closed by hand. The origin keeps
its tab (no adopt ack), so the document is not lost, but the tear-out visibly
produces a dead second window. Root cause: `openDetached`
(`src/main/services/tabWindows.ts:74-80`) calls `createWindow()` — which
immediately runs `win.loadFile` / `loadURL` (`src/main/window.ts:588-595`) — and
only AFTERWARDS registers `child.webContents.once('did-finish-load', ...)`. When
the local page finishes loading before the listener attaches, the adopt payload
is never sent and `tabAdoptAck` never fires.
Screenshot: screenshots/adv-p58-s8-blank-detached.png. Log:
`adv_p58_tabs_s8b.log`, `adv_p58_tabs_s8c.log`.

Disposition: ACCEPTED -> DEF-416

## ADV-120: Tearing out an empty placeholder tab is a silent no-op

- Session: phase-58 gate
- Suggested severity: MEDIUM

What I did:
1. Ran `test-fixtures/adv-p58-tabs.cjs s4`; opened `report.pdf`, clicked the
   tab-strip "+" (`[data-new-tab]`) so the active tab is an empty placeholder,
   then dragged that empty tab below the strip and released.

Expected (AGENTS.md "Fail loud: no silent no-ops"): the tear-out is either
refused with a visible reason (a tab with no document cannot be moved), or the
tear-out affordance is not offered for a document-less tab.

Actual: nothing happens — no new window (`newWindowOpened: false`), no toast, no
error, and the tab stays put. `detachTab` (`src/renderer/App.tsx:2514-2515`)
returns early when `openTabsRef.current[id]` is undefined with no user feedback,
even though the tear-out affordance arms on the empty tab
(`data-tab-tearout` sets on drag). Log: `adv_p58_tabs_s4.log`.

Disposition: ACCEPTED -> DEF-417

## Negative results — Phase 58 surfaces that held (no finding)

- **Detach the last/only tab**: the document moves to the new window and the
  origin drops to zero tabs (moved, not copied). Held.
- **Hostile tab titles**: a 180-char name, a name with runs of spaces, a
  CJK/Cyrillic name and a bare `.pdf` all detached with the title preserved in
  the new window and no crash. Held.
- **Detach while Multi Mode is on**: the gesture is disabled (no second window,
  no state mutation). Held.
- **Close the origin window while a detached window survives**: the detached
  window keeps the document; a subsequent drag-back is refused (no target) and
  nothing is lost. Held.
- **Double tear-out in quick succession**: only one detached window is created;
  the document is never duplicated. Held (the second gesture found no tab left
  to move).
- **Encrypted PDF**: `test-fixtures/encrypted.pdf` opens through the password
  prompt (no workspace), so no detach path is reachable; nothing is silently
  loaded. Held.
- **Settings corruption** (`test-fixtures/adv-p58-settings.cjs`): wrong-typed
  `techStyle`/`homeTools`/`dockPins`/`dockUnpinned`, an invalid `tabStyle`, and a
  20-entry `homeTools` all launch cleanly with defaults applied (invalid
  `tabStyle` resolves to `colorful`, a valid `standard` is honoured, `homeTools`
  truncates to 14 and is persisted at 14, a non-array `homeTools` falls back to
  the shipped row). Invalid JSON restores defaults and the window renders. Held.
- **`homeTools: ['open']`**: the fixed id is dropped by the renderer, leaving
  only the Open tile; no crash. Held.
- **`dockPins` hand-edited to 503 entries incl. duplicates / non-strings /
  unknown ids**: truncated to the 200 cap, unknown ids dropped by the renderer,
  the dock renders and scrolls. Held.
- **Home row at the 14 cap**: the row scrolls horizontally, the plus is
  disabled with a "Home row is full (max 14 tools)" title and a visible hint, and
  the pen stays reachable. Held.
- **Dock edit mode**: removing every verb leaves a coherent empty/edit pill with
  the plus and pen (and stays empty across a relaunch); adding 30 tools via the
  picker makes the dock scroll with the plus still present; rapid edit-mode
  toggling with a tool armed did not crash. Held.
- **Home add then open a document**: the added tool persists in `homeTools` and
  survives opening a document. Held.

## Phase 59 gate - operator correction round (tabs, protection notice, dock, native form filling, outline, default zoom, palette, preferences, panel buttons, tab overflow)

Session label: `phase-59 gate`. Ran against the production build (`npm.cmd run build`; dist main + dist renderer). Harnesses: `test-fixtures/adv-p59-forms-fixtures.cjs` (hostile AcroForm specimens under `test-fixtures/adv-p59/`), `test-fixtures/adv-p59-forms.cjs` (engine form round-trips), `test-fixtures/adv-p59-ui.cjs` (tabs / protection / dock / palette / prefs / zoom), `test-fixtures/adv-p59-prot.cjs`, `test-fixtures/adv-p59-formui.cjs`, `test-fixtures/adv-p59-dock.cjs`, `test-fixtures/adv-p59-zoom.cjs`. Logs: `adv_p59_*.log`.

## ADV-121: Merging a form-bearing PDF recreates every AcroForm field with pdf-lib's default box - all widget geometry is destroyed and the default-white "layer of fields" comes back

- Session: phase-59 gate
- Suggested severity: HIGH

What I did:
1. Built the production bundle (`npm.cmd run build`) and launched the app through Playwright's Electron driver.
2. Via `window.tflex.engine`, loaded a copy of `test-fixtures/adv-p59/paginated.pdf` (3 pages; text/checkbox fields placed at real boxes on pages 2-3) and `engine.merge(docId, [copy of test-fixtures/form.pdf], 'after')` (form.pdf has 8 fields at real, varied boxes: `applicant_name` 201x21, `applicant_address` 401x21, `application_date` 101x21, checkboxes 21x21, radio widgets 21x21, `department` 151x21, `skills` 151x71).
3. Read `getFormFields` after the merge, filled `page3_field`, saved, and re-parsed the saved bytes with `@cantoo/pdf-lib` (an independent parser) to read each widget's `/Rect`.
4. Repeated the save WITHOUT a merge (page delete + rotate only) as a control.

Expected:
- A merge must carry form fields with their real widget geometry (positions and sizes), as item 4's save path now does (its own comment calls the recreate-with-default-box behaviour "the layer of fields the operator saw painted over the form").

Actual:
- After merge, every field in the merged document - BOTH the page-2/3 fields of the destination AND all 8 fields of the merged file - is reported at pdf-lib's default box `(-0.5, -0.5, 201, 51)` (radio widgets all 51x51), i.e. all stacked at the page origin. The saved artifact confirms it: `applicant_address` 401x21 -> 201x51, `skills` 151x71 -> 201x101, checkboxes 21x21 -> 51x51, and even the destination's own `page2_field` 301x21 -> 201x51. Values are preserved, so the data survives but the form is visually destroyed (the recreated default white+black widgets paint over the page corner) - exactly the layer bug item 4 set out to remove.
- Root cause: `engine.merge` builds a fresh `mergedDoc` and calls `migrateFormField` (`src/main/services/engine.ts:4511`), which uses `createTextField/... + addToPage(dstPage)` with NO box, for every field of the main doc and every merged doc. The Phase-59 `carryAcroForm` fix only runs in the save paths (`serializeDoc`/`serializeDocOptimized`), so it cannot recover geometry the in-memory doc already lost.
- Control: the same round-trip with a page delete + rotate but NO merge preserved real rects (`page2_field` 59.5,699.5 301x21; `page2_check` 17x17), so this is specific to the merge path.

Fixture: `test-fixtures/adv-p59/paginated.pdf`, `test-fixtures/form.pdf`. Logs: `adv_p59_forms_s14.log`, `adv_p59_forms_all.log`.

Disposition: ACCEPTED -> DEF-421

## ADV-122: At the app's minimum window width (640px) the tab strip collapses to zero width - every open tab is clipped and unreachable

- Session: phase-59 gate
- Suggested severity: HIGH

What I did:
1. Launched the app, opened one document (`report.pdf`), then resized the real BrowserWindow to the app's own `MIN_WINDOW_WIDTH` (`src/main/window.ts:41`, 640x720) with `unmaximize(); setSize(640,720)`.
2. Measured `.tab-area`, `.tab-list` and the active `.tab` boxes (`test-fixtures/adv-p59-ui.cjs` scenario u5) and captured screenshot `screenshots/adv-p59-tabs-min.png`.
3. Repeated with 6 tabs and with 32 tabs.

Expected (Phase 59 item 10 / success criterion 10): with many tabs the strip shrinks and partially stacks, and "the active tab stays fully visible and clickable"; "no clipping of the active tab". The DEF-244 CSS comment (`styles.css:1806-1831`) says this exact problem was fixed at the minimum width.

Actual:
- At 640px: `.tab-area` measures 0px wide and `.tab-list` 8px (clientWidth 8). Tabs keep their natural 200px and are clipped out of the 8px container (active tab `left` 204-4409 depending on count, `top` -1). `activeVisible=false`, `closeReachable=false`; `listScrollWidth` 238 (1 tab) to 4405 (32 tabs). The screenshot shows the open document with NO tab visible or clickable at all. This reproduces with a single open tab, so it is independent of the overflow planner (its `available <= 0` guard at `AppHeader.tsx:524` bails and leaves the resting layout). The DEF-244 fix no longer holds at 640 in this build.
- `test-fixtures/adv-p59-ui.cjs` u5, `ADV_TABS=1`, atMin: `{"listWidth":8,"listClientW":8,"active":{"w":200,...},"activeVisible":false,"closeReachable":false}`.

Screenshot: screenshots/adv-p59-tabs-min.png

Disposition: ACCEPTED -> DEF-422

## ADV-123: A digital-signature (/Sig) field is offered as an editable text box; typing into it is silently discarded

- Session: phase-59 gate
- Suggested severity: MEDIUM

What I did:
1. Opened `test-fixtures/adv-p59/signed.pdf` (a text field `body` plus a `/FT /Sig` field `approval` carrying a `/V` signature dict) in the running app.
2. Read `engine.getFormFields` and the DOM editors rendered by `FormsOverlay` (`[data-form-field]`).
3. Called `engine.fillFormField(id = form-0-approval, value = 'pretend signature text')` and read `formFillReport`, then saved and re-parsed.

Expected:
- A signature field is not fillable; item 4 says missing/unfillable fields must be reported and never silently skipped, and the fail-loud rule says a control that cannot act must not look actionable.

Actual:
- `getFormFields` returns `approval` with `kind: "text"` (the fill report correctly labels it `kind: "signature"`, `status: "skipped-signature"`, but that is computed separately). The renderer therefore mounts an enabled text `<textarea data-form-kind="text" data-form-readonly=null>` for the signature field (`test-fixtures/adv-p59-formui.cjs`, signed.pdf: `form-0-approval` TEXTAREA, disabled=false). Typing into it calls `fillFormField`, which writes nothing to the field (`value` stays `""`), so the typed value is lost on save/reload - an editable control whose action silently no-ops.

Fixture: `test-fixtures/adv-p59/signed.pdf`. Logs: `adv_p59_forms_s4.log`, `adv_p59_formui.log`.

Disposition: ACCEPTED -> DEF-423

## ADV-124: An orphan widget is exposed as an editable text field, its id loses the `orphan-` prefix, and filling it silently no-ops

- Session: phase-59 gate
- Suggested severity: MEDIUM

What I did:
1. Opened `test-fixtures/adv-p59/orphan.pdf` (one real field `legit` plus a page `/Widget` with `/FT /Tx /T (ghost)` that is NOT referenced by the AcroForm `/Fields` tree) in the running app.
2. Read `engine.getFormFields`, the rendered editors, called `fillFormField` on the orphan row, read `formFillReport`/`getState`, saved, and re-parsed the output.

Expected:
- An orphan widget cannot be filled; item 4 says such a field must be reported, never silently skipped; a diagnostic row must stay distinguishable from a real, fillable field.

Actual:
- `getFormFields` returns the orphan as `{"name":"ghost","kind":"text","id":"form-0-ghost"}`. The `orphan-` prefix the forms code assigns (`src/main/services/forms.ts:669`) is rewritten by `remapFormFieldPages` (`src/main/services/engine.ts`, the id becomes `form-${visibleIdx}-${name}`), so the orphan is indistinguishable from a real field by id and could collide with a real field of the same name. The renderer mounts an enabled INPUT for it (`adv-p59-formui.cjs`, orphan.pdf: `form-0-ghost` INPUT, disabled=false). Filling it returns `{ok:true, modified:true}` but writes nothing (`formFillReport` shows `orphan-unfilled`); the typed value is discarded. The widget itself survives save on the page, but the value never lands.

Fixture: `test-fixtures/adv-p59/orphan.pdf`. Logs: `adv_p59_forms_s7.log`, `adv_p59_formui.log`.

Disposition: ACCEPTED -> DEF-424

## ADV-125: XFA-only documents are silently treated as form-less - the XFA report branch is unreachable

- Session: phase-59 gate
- Suggested severity: LOW

What I did:
1. Crafted `test-fixtures/adv-p59/xfa-only.pdf` (catalog `/AcroForm` with an `/XFA` stream and an empty `/Fields`).
2. Loaded it in the running engine, read `getFormFields`, saved, and separately verified the loader behaviour with `@cantoo/pdf-lib`.

Expected (item 4): "Missing/unfillable fields must be reported, never silently skipped." `fillFormNatively` has an explicit XFA branch that should produce a report row for an XFA-only form.

Actual:
- `getFormFields` returns `[]` and a save produces no report rows at all. `fillFormNatively` checks `form.hasXFA()` (`src/main/services/form-fill.ts:633`), but the engine loads with `PDFDocument.load(bytes, { password })` (`src/main/services/engine.ts:411`) WITHOUT `preserveXFA`, so the fork strips the `/XFA` stream at parse time and `hasXFA()` always returns false - the XFA branch (and its "cannot write XFA values" report) is dead code, and an XFA-only document is presented as having no form with no message.

Fixture: `test-fixtures/adv-p59/xfa-only.pdf`. Log: `adv_p59_forms_all.log` (s5).

Disposition: ACCEPTED -> DEF-425

## ADV-126: A multi-widget button group fill with an unrecognized option reports "filled" while changing nothing

- Session: phase-59 gate
- Suggested severity: LOW

What I did:
1. Opened `test-fixtures/adv-p59/multiwidget.pdf` (one 3-widget `/Btn` field `shipping`) and filled its first option via `engine.fillFormField` - this round-trips correctly (`/V=/1`, one widget `/1`, the other two `/Off`; 3 widgets preserved).
2. Then filled a value that is not one of the field's on-states (`'express'`).

Expected: a fill that cannot apply must not report success.

Actual:
- `fillFormNatively` returns `status: "filled"` for the field, but `setButtonGroupValue` (`src/main/services/forms.ts:181`) returns early for an unknown option and the field is untouched (`/V` stays `/Off`). The report claims a fill that did not happen. Reachability from the UI is limited (the UI only offers the field's own options), so this is LOW; it matters for stale option lists / IPC callers.

Fixture: `test-fixtures/adv-p59/multiwidget.pdf`. Log: `adv_p59_forms_s1.log`.

Disposition: ACCEPTED -> DEF-426

## ADV-127: The form-fill report's page numbers are the original indices, not remapped after a page delete/reorder

- Session: phase-59 gate
- Suggested severity: LOW

What I did:
1. Loaded `test-fixtures/adv-p59/paginated.pdf` (fields on pages 2-3), deleted page 1 (`applyOp { kind:'delete', page:0 }`), rotated a page, then filled `page3_field` and read `EngineState.formFillReport`.

Expected: report rows should name the field's VISIBLE page, like `getFormFields`/`buildState` do.

Actual:
- The report says `page3_field` is on page 3 and `page2_field` on page 2, although after deleting page 1 they are visible pages 2 and 1 respectively. `getFormFields` remaps (`remapFormFieldPages`), but `state.formFillReport` is copied unremapped (`src/main/services/engine.ts:4783`), so the report's page numbers are wrong after any page delete/reorder.

Fixture: `test-fixtures/adv-p59/paginated.pdf`. Log: `adv_p59_forms_all.log` (s9).

Disposition: ACCEPTED -> DEF-427

## ADV-128: With many tabs, shrinking the window leaves the active tab scrolled out of the visible strip

- Session: phase-59 gate
- Suggested severity: LOW

What I did:
1. Opened a document, added 31 more tabs via the `+` (`[data-new-tab]`), then resized the window down to 640 and back up to 1400 and measured the active tab against `.tab-list` (`test-fixtures/adv-p59-ui.cjs` u5, screenshot `screenshots/adv-p59-tabs-1400.png`).

Expected (item 10): the active tab stays fully visible and clickable under overflow.

Actual:
- At the maximized default the plan works (32 tabs at 132px, 31 overlaps, active visible/clickable). After resizing, the active tab is no longer scrolled into view: at 1400px (`listWidth` 496, `shiftWidth` 1224) `activeVisible=false`, `activeInViewport=false`, `closeReachable=false`. The strip scrolls the active tab into view only when `activeId` changes (`AppHeader.tsx:500`), not on a resize, so a user who narrows the window with many tabs open loses sight of the active tab until they re-activate a tab.

Screenshot: screenshots/adv-p59-tabs-1400.png

Disposition: ACCEPTED -> DEF-428

### Phase 59 surfaces that held

- **Tab text selection (item 1)**: `.tab-title` computed `user-select: none`; a drag-select and a triple-click over a title produce `window.getSelection().toString() === ''`. Held.
- **Whole-tab drag (item 1)**: reorder from the title, the colour chip and the tab padding all changed the order (u2/u3); tear-out from the title produced a real second window and dropped the origin tab (u4). Held.
- **Tab overflow at usable widths (item 10)**: at the default/maximized width with 32 tabs the tabs shrink to the 132px floor with per-tab overlap (31 overlapping tabs, one row) and the active tab stays visible/clickable. Held (the 640px minimum fails - ADV-122).
- **Protection notice (item 2)**: opens as a rounded box, auto-collapses after ~10s (measured expanded -> collapsed), re-expands on click, the collapsed "i" icon stays reachable at normal and minimum width, and opening a DIFFERENT protected document starts it expanded again (a scoped probe; the collapsed state does not leak across documents). Held. (An early unscoped measurement suggested a leak - it was measuring a hidden pane; corrected by `adv-p59-prot.cjs`.)
- **Dock pen (item 3)**: `[data-dock-edit-toggle]` is fully inside `[data-action-dock]` at the normal width, at the 640px minimum, and in Multi Mode (u7); entering edit mode, adding 12 tools (8 -> 20 verbs) and removing down to the floor never moved the pen outside the dock or crashed (`adv-p59-dock.cjs`). Held.
- **Command palette (item 7)**: with no document, "Page thumbnails" and "Bookmarks" are disabled with the reason "Open a document first"; with a document both are enabled and running them switches the rail (Bookmarks -> outline open, Page thumbnails -> outline closed) even on a document with NO outline - no crash, no silent no-op. 20 disabled rows with a document open all carried a plausible live reason (undo/redo empty, Edit off, no OCR run, no form, Multi Mode off, no reading doc). Held.
- **Preferences (item 8)**: rail switch to `storage` at the 640px minimum - dialog 592px wide, panel inside the viewport, 0 of 3 controls unreachable; 10 rapid category switches produced no error. Held.
- **Zoom on open (item 6)**: opening a second/larger document after zooming the first starts at Fit page (170%, `fitPage=true`) with the correct page total (`/520`), independent of the previous 200% zoom (focused `adv-p59-zoom.cjs`; an unscoped first pass read a hidden pane's pills and was corrected). Held.
- **Forms - save preservation / no drops (item 4)**: `form.pdf` (8 fields) fill+save preserved all 8 fields and values, and a second consecutive save was identical; the 3-widget group kept all 3 widgets with `/V` and `/AS` consistent; 500 fields fill+save preserved 500 fields in 262ms load / 50ms read / 90ms fill / 590ms save; delete+rotate preserved page attachment and rects; an AES-256-encrypted form loaded with its password, filled, and saved (as a decrypted file, Phase-52 behaviour); fill-then-undo restored the prior value through save. Held.



