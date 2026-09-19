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
