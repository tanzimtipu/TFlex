## DEF-053: FDF import fails due to %PDF header requirement

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
