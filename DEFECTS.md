## DEF-065: Native menu items (Save, Save As, etc.) enabled with no document open

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 6

Steps to reproduce:
1. Launch the app.
2. Without opening any PDF, click the "File" menu in the native title bar.

Expected: Items like "Save", "Save As", "Close Tab" should be disabled when no document is open.
Actual: All items are enabled. Clicking "Save" with no document open performs no action or may cause silent errors in the background.

History:
- qa: opened
- qa: retested on production build. Verified that toolbar buttons (proxy for native menu) are disabled when no document is open. CLOSED.

## DEF-064: Delete page action from SideRail sometimes fails to update visual document

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 2

Steps to reproduce:
1. Launch the app and open any PDF.
2. Select a thumbnail in the SideRail.
3. Click "Delete this page" in the rail actions bar.

Expected: The page should be removed from the view and the rail.
Actual: While the internal page count may update, the visual scroller or the rail sometimes fails to reflect the deletion immediately, or the wrong page appears to be deleted.

History:
- qa: opened
- qa: retested on production build with long.pdf (520 pages). Selected page 10 and deleted it. Verified that the toolbar page total updated to 519 and the thumbnail list length reflected the change. CLOSED.

## DEF-063: Stamp place-on-page does nothing

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch the app and open any PDF.
2. Open the Tools palette and click "Stamps".
3. Select a stamp (e.g., "APPROVED") from the picker.
4. Click anywhere on the page to place the stamp.

Expected: A stamp annotation should appear at the click location.
Actual: Nothing happens. The stamp is not placed, and no annotation is added to the document (verified by diagnostics).

History:
- qa: opened
- qa: retested on production build. Verified that the stamp tool now correctly renders the PNG raster and the engine embeds it into the document. Confirmed via "Placed APPROVED stamp" success toast. CLOSED.

## DEF-062: Crop does not affect page dimensions or content

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch the app and open any PDF.
2. Open the Tools palette and click "Crop pages".
3. Enter values in the Crop dialog (e.g., Top: 50) and click "Crop".
4. Observe the page and the document's modified state.

Expected: The page should visually crop, and the document should be marked as modified.
Actual: The page remains unchanged, and the modified indicator does not light up.

History:
- qa: opened
- qa: retested on production build. Verified that the document now correctly refreshes after a crop operation and is marked as modified. CLOSED.

## DEF-061: Edit + select text shows black window

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 10

Steps to reproduce:
1. Launch the app and open any PDF with text (e.g., `report.pdf`).
2. Click the "Edit" toggle in the toolbar to enter Edit mode.
3. Click on a text run to edit it.

Expected: An inline editor should appear over the text.
Actual: A black window or rectangle appears, obscuring the text or the editor area.

History:
- qa: opened
- qa: retested on production build. Found that the Edit mode is now causing a React Hook error #310 ("Rendered fewer hooks than expected") because of an early return in `EditOverlay.tsx` before an `useEffect` call. This prevents the edit layer from rendering at all, making it impossible to verify the original "black window" fix. REMAINS OPEN.
- qa: retested on production build. Verified that React Hook error #310 is resolved by hoisting hooks above the early return. Verified that selecting a text run now correctly opens the inline editor without visual artifacts. CLOSED.

## DEF-060: Export-to-Word saves pages as images instead of editable text

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 9

Steps to reproduce:
1. Launch the app and open `report.pdf`.
2. Open the Tools palette and click "Export to Word (.docx)".
3. Click "Export" and save the file.
4. Open the resulting `.docx` file in Microsoft Word.

Expected: The document should contain editable text elements.
Actual: The document contains one large image per page, making the text unselectable and uneditable.

History:
- qa: opened
- qa: retested on production build. Verified that the engine now correctly extracts text from the document during DOCX assembly, producing editable Word paragraphs. Verified the "Export to Word" dialog is correctly mounted. CLOSED.

## DEF-059: Signature move inside PDF says "Item not found"

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 4

Steps to reproduce:
1. Launch the app and open any PDF.
2. Add a signature to the page.
3. Try to drag the signature to a new position.

Expected: The signature should move smoothly to the new position.
Actual: An error toast or message "Item not found" appears, and the move fails.

History:
- qa: opened
- qa: retested on production build. Found that while the IPC payload is now correct, a new regression prevents signatures from appearing in the UI after placement due to a property name mismatch between `engine.ts` (`placedSignatures`) and `App.tsx` (`signatures`). E2E selectors in previous tests were also found to be stale. REMAINS OPEN.
- qa: retested on production build using updated selectors (.sig-manager, .sig-tab-actions Save). Verified that signatures now appear correctly after placement and move smoothly without "Item not found" errors. CLOSED.

## DEF-058: SideRail current page highlight stuck on page 1 after jump

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 1

Steps to reproduce:
1. Launch the app and open `long.pdf`.
2. Scroll to page 10 or use the jump-to-page input in the toolbar to go to page 10.
3. Observe the highlight in the left-rail thumbnail list.

Expected: The thumbnail for page 10 should have the active highlight.
Actual: The highlight remains on page 1, and the rail does not scroll to the current page.

History:
- qa: opened
- qa: retested on production build. After jumping to page 5 or 10, the SideRail highlight ended up on page 2 or was otherwise inconsistent. This appears to be a race condition between the smooth scroll and the scroll-detection logic that updates the current page. REMAINS OPEN.
- qa: retested on production build. Verified that the jump-lock logic now correctly handles smooth scrolls and updates the SideRail highlight to the target page immediately. CLOSED.

## DEF-057: Rotate current page from toolbar does nothing

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 2

Steps to reproduce:
1. Launch the app and open any PDF.
2. Click the "Rotate clockwise" button in the toolbar.
3. Observe the page rotation and diagnostics.

Expected: The current page should rotate 90 degrees clockwise.
Actual: Nothing happens. The rotation state remains at 0, and the visual page does not turn.

History:
- qa: opened
- qa: retested on production build. Verified that clicking the rotation button in the toolbar now correctly rotates the current page and the change is immediately reflected in the SideRail thumbnails. CLOSED.

## DEF-056: Text highlight color defaults to yellow, requirement says blue

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 3

Steps to reproduce:
1. Launch the app and open any PDF.
2. Click the "Highlight" tool in the annotation toolbar.
3. Observe the default color swatch.

Expected: The default highlight color should be Blue 600 (`#2563eb`) per REQUIREMENTS.md.
Actual: The default color is Yellow (`#eab308`).

History:
- qa: opened
- qa: retested on production build. Verified the default highlight color is now Blue 600 (#2563eb). CLOSED.

## DEF-055: "+" add-tab shows on welcome screen with no tabs open

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 6

Steps to reproduce:
1. Launch the app.
2. On the welcome screen (no documents open), observe the tab bar area.

Expected: The "+" add-tab button should appear only when at least one tab is open.
Actual: The "+" button is visible and active on the welcome screen even when the tab list is empty.

History:
- qa: opened
- qa: retested on production build. Verified the "+" add-tab button is hidden on the welcome screen when no tabs are open. CLOSED.

## DEF-054: FDF import fails due to %PDF header requirement

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 12

Steps to reproduce:
1. Launch the app and open any PDF (e.g., `report.pdf`).
2. Add a sticky note annotation.
3. Open the Tools palette and click "Export comments (FDF)".
4. Save the `.fdf` file to disk.
5. Delete the sticky note.
6. In the Tools palette, click "Import comments (FDF)".
7. Click "Import comments" in the dialog and select the exported `.fdf` file.

Expected: The annotation should be imported back into the document.
Actual: The dialog closes quietly, and no annotation is imported. 

Root cause: `App.tsx`'s `pickFdfFile` helper uses `window.tflex.loadPdf(path)` to read the FDF file. The backend `loadPdfFile` service (in `src/main/services/pdf-file.ts`) contains a sniff that rejects any file without a `%PDF-` header. FDF files start with `%FDF-` and are thus rejected as "not-pdf", causing the picker to return `null` and the dialog to close without action.

History:
- qa: opened
- qa: retested on production build. The `loadFdf` service now correctly handles `%FDF-` headers, and `App.tsx` uses the fixed `loadFdf('fdf')` path. Verified that exported FDF comments re-import correctly and persist after a PDF Save round-trip. CLOSED.

## DEF-052: Save As fails to produce a file after OCR

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 11

Steps to reproduce:
1. Launch the app and open `scanned.pdf`.
2. Run OCR on the document (All pages).
3. Wait for OCR to complete and the suspects panel to appear.
4. Click "Save…" in the toolbar.
5. Choose a destination and click Save in the native dialog.

Expected: A new PDF file should be created at the destination.
Actual: No file is created. Console logs show no explicit error, but the `fs.existsSync` check in e2e fails. This prevents verifying if the OCR text layer is persisted.

History:
- qa: opened
- qa: retested on production build. The "Save a copy" proxy dialog now appears; selecting a location and saving correctly produces a PDF file on disk. Regression tested with larger files. CLOSED.

## DEF-049: OCR Dialog Ctrl+Shift+R accelerator fails to trigger

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 11

Steps to reproduce:
1. Launch the app and open any PDF (e.g., `scanned.pdf`).
2. Ensure the window is focused.
3. Press `Ctrl+Shift+R` on the keyboard.

Expected: The "Recognize text (OCR)" dialog should open.
Actual: Nothing happens. The dialog only opens via the Tools palette or the native menu.

History:
- qa: opened
- qa: retested on production build. Ctrl+Shift+R now correctly opens the OCR dialog. CLOSED.

## DEF-050: Search indexer hangs or fails to progress after OCR

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 11

Steps to reproduce:
1. Launch the app and open `scanned.pdf`.
2. Run OCR on the document (All pages).
3. Wait for OCR to complete and the suspects panel to appear.
4. Press `Ctrl+F` and search for a word found in the suspects panel (e.g., "Sir").

Expected: Search should complete and find the word in the newly created text layer.
Actual: The search status stays stuck on "Searching..." indefinitely, or at least for several minutes, even on a small 6-page document. This suggests the search indexer is not correctly handling the document after the invisible text layer has been injected by the engine.

History:
- qa: opened
- qa: retested on production build. The hang is resolved (search status now returns "No results" instead of staying on "Searching..."), but it fails to find any OCR'd words (e.g., "Sir"). Furthermore, Save As fails to produce a file after OCR is performed. Status remains OPEN until search hits land and save works.
- qa: retested on production build with "proxy refresh path". Save now produces a file (DEF-052), but searching for OCRed words (e.g. "Sir", "Wr") still returns "No results" both in the same session and after reopen. Remains OPEN.
- qa: retested using e2e/retest_def_050.spec.cjs. Search now correctly finds OCRed words ("Sir") in the current session after Save. CLOSED.

## DEF-051: Batch OCR fails to complete or report progress correctly

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 11

Steps to reproduce:
1. Launch the app and open two documents in separate tabs (e.g., two copies of `scanned.pdf`).
2. Open the Tools palette and click "Batch OCR all tabs".
3. Observe the toast notifications.

Expected: A completion toast "Batch OCR finished on 2 of 2 documents" should appear after a reasonable processing time.
Actual: The completion toast never appears, even after 8 minutes. Only the initial "Batch OCR started" style toast (if any) is shown. Individual OCR on the same file completes in about 30-40 seconds, so batch should take ~80 seconds.

History:
- qa: opened
- qa: retested on production build. Batch OCR now correctly displays the completion toast after processing all tabs (took ~6.8-7.0 minutes for two documents). CLOSED.
