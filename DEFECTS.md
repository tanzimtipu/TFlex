
## DEF-045: Phase 9 features missing from product

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 9

Steps to reproduce:
1. Launch the app and open any PDF.
2. Search the UI (toolbar, Tools palette, menus) for "Insert blank page", "Insert from PDF", "Create from clipboard", or export options for RTF/Word/Plain text/TIFF.
3. Review the source code in `src/main/services/engine.ts` and `src/renderer`.

Expected: All Phase 9 features specified in REQUIREMENTS.md should be implemented and functional.
Actual: The following features are entirely missing from both the UI and the backend engine:
- Create PDF from clipboard content.
- Export PDF pages to TIFF.
- Export text to plain text/RTF.
- Export whole PDF to Word (.docx).
- Insert blank page.
- Insert from another PDF at a chosen position.

History:
- qa: opened
- qa: CLOSED. Re-verified all features functional on production build via reverify_phase9.spec.cjs.

## DEF-046: Racy focus fallback in image picker prevents automation

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 9

Steps to reproduce:
1. Run a Playwright E2E test that attempts to use the "Create from images" dialog.
2. Use `window.waitForEvent('filechooser')` and `fileChooser.setFiles()`.
3. Observe the dialog state after setting files.

Expected: The picked files should populate the list in the dialog.
Actual: The list remains empty ("No images selected"). `src/renderer/utils/pickImageFiles.ts` contains a `focus` event listener on the window that resolves the picker with an empty list after 200ms as a "cancel" fallback. In automated environments, the window regain-focus event often triggers before the `change` event from the file input, causing the picker to return no files.

History:
- qa: opened
- qa: CLOSED. Polling fallback implemented in pickImageFiles.ts. Verified via automation.

## DEF-047: Create PDF from images does not persist quality setting to AppSettings

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 9

Steps to reproduce:
1. Launch the app.
2. Click "Create from images".
3. Change the JPEG quality (e.g. to 90).
4. Close the dialog and reopen it, or check `diag.createImageQuality`.
5. Restart the app.

Expected: The quality choice should be persisted in `AppSettings.createImageQuality`.
Actual: While the dialog has an `onQualityChange` callback, and `App.tsx` has a handler, the implementation in `App.tsx` does not correctly sync it to the backend settings service in a way that survives a restart (verified via code review of `App.tsx` and `createImageQuality` missing from `tflexDiagnostics` in previous runs).

History:
- qa: opened
- qa: CLOSED. Verified persistence through dialog cycles and diagnostics in reverify_phase9.spec.cjs.

## DEF-044: Settings overwrite race condition on app quit

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 7

Steps to reproduce:
1. Launch the app.
2. Toggle the theme (e.g. to Light).
3. Immediately close the app (within 500ms).
4. Restart the app.

Expected: The app should start in the new theme (Light).
Actual: The app restarts in the old theme (Dark). The `window-all-closed` handler in `src/main/index.ts` calls `saveCurrent()` which saves the main process's `current` state. Because the renderer's `settingsSave` IPC is debounced (300ms), it never reaches the main process before quit. `saveCurrent()` therefore writes the stale backend state back to disk, clobbering the change.

History:
- qa: opened
- qa: OPEN. Retested. Theme toggle still lost on rapid quit. `saveCurrent()` in main process does not appear to resolve the race, likely because `app.quit()` is called immediately after without awaiting the async save.
- qa: OPEN. Retested on production build. DEF-044 is NOT fixed. The race condition remains because the renderer's 300ms debounce prevents the main process from receiving the updated settings before `window-all-closed` fires. `saveCurrent()` then persists the stale backend state.
- qa: CLOSED. Retested on production build. Immediate persistence (no renderer debounce) and awaiting `saveCurrent()` in `window-all-closed` resolves the race. Verified via e2e/retest_def_044.spec.cjs.

