# Adversarial Review

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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

Disposition: PENDING

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
| **All phases** | **5** | **9** | **4** | **18** |

## Dispositions (orchestrator, final pass)

- ADV-013 ACCEPTED (guard placements on 0-page docs) -> DEF-027
- ADV-014 ACCEPTED -> DEF-028 (HIGH; flatten+undo must restore fields)
- ADV-015 ACCEPTED -> DEF-029 (HIGH; merge must migrate AcroForm)
- ADV-016 ACCEPTED -> DEF-030 (signatures must serialize+reload)
- ADV-017 ACCEPTED -> DEF-031 (form field page refs remap on page ops)
- ADV-018 ACCEPTED -> DEF-032 (engine guards 0-page docs)
