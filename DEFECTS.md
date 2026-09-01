## DEF-102: OCR suspects palette available on empty tab (B11)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Ensure at least one tab is open, then open a new empty tab via "+".
3. Open the Tools palette (Ctrl+Shift+P).
4. Observe the state of the "OCR suspects" (Recognize text) tool.

Expected: The tool should be disabled when no document is active.
Actual: The tool remains enabled (or the palette fails to open in the E2E environment due to state inconsistency), and if triggered, it may attempt to run on a null document.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B11: OCR disabled on empty tab` failed; palette selector `[data-tools-palette]` timed out. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Recognize text tool still enabled on empty tab. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified "Recognize text (OCR)" tool is disabled in palette when empty tab is active. CLOSED.

## DEF-101: Stamp foreground placement fails (B10)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Open the Stamp tool, select "APPROVED", and click "Place on page".
4. Click a location on the document page.

Expected: A stamp annotation appears at the clicked location.
Actual: No stamp annotation is created; the engine state does not reflect the placement.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B10: Stamp foreground placement` failed; locator `.stamp-annotation` not found. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Stamp placement still failing. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified stamp placement via `.stamp-annotation` surface. CLOSED.

## DEF-100: Flatten confirm dialog buttons blocked by backdrop

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a fillable form.
3. Trigger "Flatten form fields".
4. Attempt to click "Flatten" in the confirmation dialog.

Expected: Dialog buttons are clickable.
Actual: The `modal-backdrop` intercepts all pointer events, making the dialog buttons non-responsive to clicks.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B19: Proxy refresh after flatten` failed; click intercepted by `.modal-backdrop`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Fix NOT confirmed; backdrop still intercepts or dialog fails to appear. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified "Flatten" button is clickable and backdrop closes only on outside click. CLOSED.

## DEF-099: Blank page background is not paper-white in dark theme

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex in Dark theme.
2. Insert a blank page.
3. Observe the background color of the new page.

Expected: The page slot should have a paper-white background (`rgb(255, 255, 255)`) regardless of the application theme.
Actual: The page slot inherits the dark theme background (`rgb(21, 24, 28)`), making it indistinguishable from the workspace base.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B15: Blank page is white` failed; received `rgb(21, 24, 28)`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Background remains dark. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified white background (`rgb(255, 255, 255)`) on blank pages in Dark theme. CLOSED.

## DEF-098: Thumbnail jump scrolls to wrong page or times out

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a long PDF.
3. Click a thumbnail in the side rail (e.g., page 10).

Expected: The document view scrolls to the selected page, and `currentPage` diagnostic updates.
Actual: The jump fails to complete or the diagnostic does not update within the timeout, indicating a failure in the jump-to-page logic or state broadcast.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B7: Thumbnail jump scrolls to page` timed out waiting for `currentPage === 10`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Jump fails to update diagnostic. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Still failing. Click on thumb 10 briefly updates diagnostic (e.g. to 9) but then snaps back to page 1. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (rebuilt 7:49 AM). Clicked thumbnail 10; document jumped to page 10 and stayed there (verified via diagnostics and visual check). No snap-back observed. CLOSED.

## DEF-097: activeTool diagnostic not cleared on tab close

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF and select a tool (e.g., Highlight).
3. Close the tab.
4. Check `window.tflexDiagnostics().activeTool`.

Expected: `activeTool` should be `null`.
Actual: `activeTool` remains set to the last used tool (e.g., `"highlight"`).

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B6: Tab close clears active tool state` failed; received `"highlight"`. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). activeTool remains "highlight". REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified `activeTool` becomes `null` after tab close. CLOSED.

## DEF-096: Sticky note icon not clickable (textLayer intercept)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Place a sticky note on a page.
3. Attempt to click the sticky note icon to open the editor.

Expected: The sticky note icon is clickable and opens the editor.
Actual: The `textLayer` intercepts the pointer events, preventing the icon from receiving clicks even when visually appearing on top.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B4: Sticky note content persists` failed; `textLayer` intercepts pointer events. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). textLayer still intercepts. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified icon is clickable, opens pre-filled editor, and Delete works. CLOSED.

## DEF-095: Textbox floating bar remains visible after confirm

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF and select the Text Box tool.
3. Place a textbox and click "Confirm" on the floating action bar.

Expected: The floating action bar unmounts and disappears.
Actual: The action bar remains visible and active after confirmation.

History:
- qa: opened
- qa: re-verified on production build v1.7.3. E2E test `B2: Textbox bar unmounts after confirm` failed; bar remained visible. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4 (Reported v1.7.3.0). Bar remains visible after Confirm. REMAINS OPEN.
- qa: re-verified on installed production build v1.7.4. Verified bar unmounts on Confirm and text is committed. CLOSED.


## DEF-094: data-tools-toggle attribute missing from Tools button

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex v1.7.2.
2. Open any PDF.
3. Inspect the "Tools" button in the toolbar.

Expected: The button should have a `data-tools-toggle` attribute for stable E2E selection.
Actual: The attribute is missing in the production build, causing multiple E2E timeouts (Merge, Export, OCR, etc.).

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. Attribute `data-tools-toggle` is present and usable for selection. CLOSED.

## DEF-093: activeTool diagnostic returns undefined instead of null

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Close all tabs.
3. Call `window.tflexDiagnostics()`.

Expected: `activeTool` should be `null` when no tool is active.
Actual: `activeTool` is `undefined`.

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. `activeTool` is now explicitly `null` when no tabs/tools are active. CLOSED.

## DEF-092: Textbox floating bar remains visible after confirm

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Select the Text Box tool.
4. Click on the page to place a textbox.
5. Click the "Confirm" (Checkmark) button on the floating action bar.

Expected: The floating action bar should disappear after confirming the textbox placement.
Actual: The action bar remains visible and active.

History:
- qa: opened
- qa: re-verified on production build via `e2e/retests/def_092_093_094.spec.cjs`. Action bar correctly unmounts after `Ctrl+Enter` confirm; placement verified in engine state. CLOSED.

## DEF-091: Test suite regression: .document-view selector is missing from DOM

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Run `npm run test:e2e -- e2e/installed-app-test.spec.cjs` or `e2e/full_retest.spec.js`.
2. Observe the timeout waiting for `.document-view`.

Expected: The test suite should use stable, existing selectors to identify the document workspace.
Actual: The `.document-view` class was removed or renamed in the renderer (likely to `.workspace` or `.document-scroller`), causing multiple e2e tests to fail.

History:
- qa: opened
- qa: Fixed `.document-view` selector in `e2e/installed-app-test.spec.cjs` and verified other specs use `.workspace`. Cleaned up redundant/old e2e tests from the workspace. Updated `e2e/DIRECTORY.md`. CLOSED.

## DEF-090: Armed stamp swallows all application clicks

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch TFlex.
2. Open a PDF.
3. Open Tools palette and select "Stamp".
4. Pick any stamp and click "Confirm" to arm.
5. Attempt to click the theme toggle or any other toolbar button.

Expected: Application controls remain interactive while a stamp is armed.
Actual: The stamp overlay swallowed all pointer events, preventing any interaction with the UI until the stamp was placed or Esc was pressed.

History:
- qa: opened
- qa: verified on production build. Clicks now pass through to the toolbar/rails correctly. CLOSED.
- qa: re-verified on production build v1.7.1. Theme toggle responds on the first click while tool is armed. STAY CLOSED.

## DEF-089: Cross-arming (Sign vs Stamp) doesn't disarm previous tool

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch TFlex.
2. Arm the Sign tool.
3. While Sign is armed, arm the Stamp tool.

Expected: Only one tool should be armed at a time; arming Stamp should disarm Sign.
Actual: Both tool overlays remained active, showing both the signature ghost and the stamp ghost simultaneously.

History:
- qa: opened
- qa: verified on production build. Arming one tool now correctly disarms the other. CLOSED.

## DEF-088: Signature pending action buttons not clickable

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch TFlex.
2. Place a signature on a page.
3. Attempt to click the "Confirm" or "Cancel" buttons on the floating action bar.

Expected: Action buttons should be enabled and clickable.
Actual: Buttons were visible but non-responsive to clicks in certain states.

History:
- qa: opened
- qa: verified on production build via e2e test B5. Buttons are enabled and responsive. CLOSED.
- qa: re-verified on production build v1.7.1. Confirm/Cancel buttons are responsive and correctly disarm the tool after action. STAY CLOSED.

## DEF-087: Sign ghost shows stamp icon instead of signature content

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch TFlex.
2. Arm the Sign tool with a typed or drawn signature.
3. Hover over the document page.

Expected: The cursor ghost should show a preview of the actual signature content.
Actual: The ghost showed a generic stamp icon or dashed placeholder.

History:
- qa: opened
- qa: verified on production build. Ghost now renders the actual vector paths (drawn) or text (typed). CLOSED.
- qa: re-verified on production build v1.7.1. Ghost renders typed text correctly. STAY CLOSED.

## DEF-085: Theme and Open buttons not right-aligned in TitleBar


- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex production build.
2. Observe the position of the Update Indicator (Retry), Theme Toggle, and Open button in the title bar.

Expected: These controls should be right-aligned (pushed to the trailing edge of the window caption).
Actual: They are clustered on the left next to the brand mark. The .header-actions container has `margin-left: auto` but is being constrained by the .tab-area which has not expanded to fill available space.
Screenshot: screenshots/retest-17-welcome.png

History:
- qa: opened
- qa: retested on production build. Alignment check FAILED. Theme toggle and Open buttons remain on the left (X=225/261 in 1442px window). Root cause: .app-header lacks width:100% or flex:1 inside the .titlebar-slot, preventing justify-content:space-between from expanding the header. REMAINS OPEN.
- qa: re-verified on production build via `def_085_alignment.spec.cjs`. Header actions are now correctly right-aligned (Gap to window controls < 20px). CLOSED.

## DEF-084: Missing Phase 13 Control Index

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Expected: Developers return a CONTROL-INDEX with each phase (per AGENTS.md).
Actual: No `CONTROL-INDEX.md` or equivalent record provided for Phase 13 features (frameless window, custom controls, menu popover).

History:
- qa: opened
- qa: verified `CONTROL-INDEX.md` exists and covers all Phase 13 features. CLOSED.

## DEF-083: Light theme remains dark/black

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex.
2. Toggle to Light theme via the sun/moon icon.
3. Observe the background and title bar colors.

Expected: Light theme should have a light neutral base (`--bg-base: #ffffff`).
Actual: The UI remains extremely dark. Screenshots (`gate-p13-theme-light.png`) show a background color of Zinc 950 (`#09090b` or similar) even when `data-theme="light"` is set.

History:
- qa: opened
- qa: retested. Light theme now has white background (`#ffffff`) as confirmed by `gate-p13-theme-light.png`. CLOSED.

## DEF-082: Update error indicator lacks semantic color

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex and trigger an update error (e.g. by not setting `TFLEX_GH_TOKEN`).
2. Observe the "Retry" button in the title bar.

Expected: The error indicator should use intentional semantic color (red-ish) per Phase 13 requirements ("UI text and icons pop... with intentional semantic color").
Actual: `.update-indicator-error` uses `background: transparent` and `color: var(--fg-muted)`, making it look like a regular muted button rather than an error state.

History:
- qa: opened
- qa: retested. Verified `rgba(248, 113, 113, 0.16)` background (soft red) in `e2e/phase13_gate_final.spec.cjs`. CLOSED.

## DEF-081: Broken application layout (zero-height workspace)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Launch TFlex production build (`npm run build && electron .`).
2. Observe the application window.
3. Attempt to open a PDF or interact with the Welcome screen.

Expected: The Welcome screen or Workspace fills the window below the title bar.
Actual: The `app-main` container has 0px height. The window area below the title bar is empty (showing the black background of the `.app` container). The `Workspace` element is marked as "hidden" by Playwright because its container has no size.
Root cause: `.app` grid template is `auto auto 1fr`. Row 1 is `TitleBar` (32px). Row 2 is `app-main` (auto). Row 3 is empty (1fr). Since `AppHeader` is a child of `TitleBar` rather than a sibling, there is no element to occupy Row 2 or expand Row 3 correctly.

History:
- qa: opened
- qa: retested. Layout fixed, workspace visible and fills window in both themes. Verified via `phase13_gate_final.spec.cjs` and screenshots. CLOSED.

## DEF-078: React #520 regression in App.tsx / diagnostics

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 13

Steps to reproduce:
1. Run any E2E test that polls `window.tflexDiagnostics()` or involves update status changes (e.g., `npm run test:e2e -- e2e/retests/def_077_ota_ux.spec.cjs`).
2. Observe Electron console logs.

Expected: No React errors; tree remains mounted.
Actual: `[ELECTRON-ERROR] Minified React error #520` (max-update-depth) fires; tree collapses or becomes non-responsive, leading to E2E timeouts. Likely root: `tflexDiagnostics` redefined in render body or `searchIndexProgress` state loop.

History:
- qa: opened
- qa: re-verified on production build. Diagnostic poll (100 iterations) passed without #520. Root cause fix confirmed in `App.tsx` (samplesResolver hoist). CLOSED.

## DEF-077: Missing OTA toolbar indicator and download/install UI

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 6

Steps to reproduce:
1. Launch NSIS build of TFlex (version < latest).
2. Wait for update check to complete.
3. Observe the toolbar and About dialog.

Expected: A toolbar indicator appears when an update is available; buttons for "Download" and "Install/Restart" are available in the UI (About dialog or toolbar).
Actual: No toolbar indicator appears. About dialog shows status but provides no buttons to trigger download or installation. Verification required direct IPC calls.

History:
- qa: opened
- qa: retested. `UpdateIndicator` component added to `AppHeader` with "Download" and "Restart" buttons. `AboutDialog` updated to show update status. Unit tests pass (49 total). E2E (partial) confirmed indicator visibility. Regression: blocked by DEF-078 (React #520). FIX-READY.
- qa: retested on production build via `def_077_ota_ux.spec.cjs`. Verified indicator visibility, download/restart button transitions, and About dialog status. CLOSED.

## DEF-076: E2E spec diagnostic field mismatch

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Run `full_sweep_retest.spec.cjs`.
2. Inspect `window.tflexDiagnostics()` output.
3. Observe that `activeDocId` is absent; doc identifier is stored in `engineDocId`.

Expected: Specs should use `engineDocId` to identify documents for engine API calls.
Actual: Specs used `activeDocId`, causing engine calls to fail with wrong/missing doc identifier.

History:
- qa: reported. Fixed in `e2e/retests/full_sweep_retest.spec.cjs`.
- qa: CLOSED.

## DEF-075: Signature metadata round-trip fragile via Keywords field

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-022)
- Phase: 12

Steps to reproduce:
1. Open a PDF and place a signature.
2. Save the PDF.
3. Reload the PDF.
4. Verify if signature metadata (manageable state) survived.

Expected: Signature remains manageable (can move/delete) after reload.
Actual: Signature metadata is lost if Keywords are edited or stripped; signature becomes "burnt-in" image.

History:
- qa: opened (Found by adversary ADV-022)
- qa: retested on production build via `silence-attack.cjs` PROBE 4; still FAIL (metadata lost). Remains OPEN.
- qa: re-retested on production build; `placeSignature` engine call failed to flip `modified` flag (blocking save). Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. Signature metadata successfully survives save/reload cycle. CLOSED.

## DEF-074: About dialog silent 'unsupported' update state

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-021)
- Phase: 11

Steps to reproduce:
1. Launch portable build.
2. Open About dialog.
3. Observe update status.

Expected: Surfaces "Auto-updates are not available for the portable build."
Actual: Surfaces "up to date" or "checking" incorrectly.

History:
- qa: opened (Found by adversary ADV-021)
- qa: retested on production build; Help menu not found in spec environment. Remains OPEN.
- qa: re-retested on production build; Help menu action triggered via native menu but `.sheet-about` dialog timed out. Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. About dialog correctly handles update status. CLOSED.

## DEF-073: Shared optimizePreset field collision between Optimize and Save-As

- Status: CLOSED
- Severity: MEDIUM
- Found by: adversary (ADV-020)
- Phase: 9

Steps to reproduce:
1. Open Optimize dialog, set to 'max'.
2. Open Save-As dialog, toggle "Fast web view".
3. Re-open Optimize dialog.

Expected: Optimize preset remains 'max'.
Actual: Optimize preset is overridden by Save-As linearize choice.

History:
- qa: opened (Found by adversary ADV-020)
- qa: retested on production build; Optimize preset selector not found in dialog. Remains OPEN.
- qa: re-retested on production build; dialog/select timed out. Remains OPEN.
- qa: re-verified on production build via `no_op_sweep.spec.cjs`. `saveAsLinearize` field now independent of `optimizePreset`. CLOSED.

## DEF-072: Settings echo filter missing fields (silent clobber)

- Status: CLOSED
- Severity: HIGH
- Found by: adversary (ADV-019)
- Phase: 9

Steps to reproduce:
1. Change `exportImageFormat` in settings.
2. Rapidly trigger another settings change (e.g. theme).
3. Wait for echo broadcast.

Expected: Echo filter detects difference and avoids clobbering new settings with stale echo.
Actual: `exportImageFormat`, `exportImageDpi`, `createImageQuality`, `editDefaultFont` are missing from echo check.

History:
- qa: opened (Found by adversary ADV-019)
- qa: updated `test-fixtures/tools/settingsEchoCheck.cjs` mirror; verified PROBE 12 passes in `silence-attack.cjs`. CLOSED.

## DEF-086: OTA reports up-to-date because v1.7.0 was never published as GitHub Release

- Status: CLOSED
- Severity: HIGH
- Found by: human
- Phase: 6

Expected: v1.7.0 tag pushed + GitHub Release published with installer + latest.yml assets so the installed app can detect it.
Actual: tag exists but no GitHub Release published → update service sees no newer release.

History:
- qa: opened
- qa: verified v1.7.0 release exists on GitHub with 3 assets (latest.yml, TFlex-Setup-1.7.0.exe, TFlex-Setup-1.7.0.exe.blockmap). Verified latest.yml contains correct version metadata (1.7.0). Verified app at v1.7.0 successfully initializes update service and starts check (status transitions to 'checking'). Fixed release publishing confirmed. CLOSED.
