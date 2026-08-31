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
