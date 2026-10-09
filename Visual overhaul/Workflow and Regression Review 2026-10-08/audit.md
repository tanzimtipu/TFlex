# Live audit — Jovrel 1.51.1

Priorities: P1 = an unexpectedly broad document-change default; P2 = incorrect state or obstructed workflow; P3 = visual/interaction refinement. A capability gap is a proposed improvement, not proof of incorrect output. Evidence pairs contain a PNG and a TXT accessibility snapshot with the same basename.

## WR01 — Crop starts with an unsolicited inset across all pages

**P1 · confirmed UI state; resulting crop not committed.** Open the fresh 34-page report, then Crop. The page is 612 × 792 PDF points, but the initial rectangle is X 61.2, Y 79.2, width 489.6, height 633.6: a 10% inset on every edge. All pages is the initial scope and Apply crop is enabled before any user adjustment. The dialog explicitly says it updates both CropBox and TrimBox. A user can therefore apply a broad content-hiding change simply by accepting defaults.

Initialize from the existing page box, expose a reset-to-full-page option, and require an actual intended change before Apply. Explicitly identify affected pages and boxes. Cropping is not redaction; do not imply that hidden content is removed.

Evidence: `07-crop-initial-clipped`, `08-crop-default-inset-summary`. Values are recorded in TXT even where the screenshot is scrolled away from the summary.

## WR02 — Crop preview and important controls compete for one scroll region

**P2 · confirmed layout problem.** At the large workspace size, the crop dialog's initial viewport cuts off the lower portion of its preview/handles and the rectangle summary. Scrolling down to inspect dimensions moves scope/instructions out of view. This makes it harder to check the exact result before Apply.

Use a preview fitted to its allocated area, a persistent scope/form section and a sticky action footer. Keep the entire crop outline visible when fitting the preview. At small sizes use a deliberate stacked arrangement rather than an oversized page inside a short body.

Evidence: `07-crop-initial-clipped`, `08-crop-default-inset-summary`.

## WR03 — Crop dimensions are displayed but cannot be entered precisely

**P2 · observed capability gap.** The rectangle summary exposes its values as text, not editable numeric controls. The visible interaction instruction is to drag the dashed rectangle. No numeric margin/rectangle inputs were found in this dialog's observed UI/accessibility tree.

Provide synchronized, labelled X/Y/width/height or margin fields, units, bounds validation, keyboard adjustments and Reset. Preserve mouse dragging. Test conversion between PDF coordinates, rotations and preview coordinates rather than relying on screen pixels.

Evidence: `08-crop-default-inset-summary` TXT.

## WR04 — Crop scope does not offer a straightforward current-page choice

**P2 · observed capability gap.** The dialog presents All pages and Per page (each row independent). Current page, selected pages and a range are not exposed as direct scope options in this no-selection state. “Per page” describes editing behavior rather than which pages will change.

Separate scope from rectangle propagation: Current, Selected (only with a selection), Range and All; then Same rectangle versus Individual rectangles. Show an affected-page count. Reuse the scope control across page operations.

Evidence: `07-crop-initial-clipped`, `08-crop-default-inset-summary`.

## WR05 — Invalid page navigation silently leaves an impossible value

**P2 · confirmed.** Enter 999 in Current page and press Enter in a 34-page document. The input remains 999 / 34 while the document and inspector stay on page 1, with no visible explanation. Entering 10 correctly navigates after rendering settles. Print's page-range dialog already handles 999 with explicit validation, making the inconsistency particularly clear.

Validate against 1–34, announce a useful error, retain the last valid document anchor, and restore its display on cancel/blur according to a consistent input policy. Do not silently reinterpret invalid values.

Evidence: `09-invalid-page-navigation`, `10-valid-page-ten`; compare `05-print-invalid-range`.

## WR06 — Menu Undo/Redo availability disagrees with document history

**P2 · confirmed availability inconsistency; actions not invoked.** In the fresh, unmodified report, Save is disabled with “Saved — no changes to save” and the navigator's Undo last change is disabled with “Nothing to undo”. The application menu nevertheless exposes Undo and Redo as enabled items.

Derive every command surface from the same active-document capability/history state. Visual disabled state, accessibility state and execution guard must agree. Verify tab switching and empty tabs as well as fresh documents.

Evidence: `13-compact-menu`, `20-compact-navigator`.

## WR07 — Theme preference says Dark while the interface is light

**P2 · reconfirmed from earlier reviews; cause unverified.** Preferences shows Theme = Dark and says it applies immediately and on the next launch, while the app chrome and preference dialog visibly use a light theme. No setting was changed during this inspection.

Investigate hydration, persisted preference, system theme and effective-theme resolution. Display the effective choice truthfully. Apply shared tokens consistently to renderer chrome, dialogs, menus and the print window. Do not merely change the selected label to conceal the mismatch.

Evidence: `14-compact-preferences`.

## WR08 — Switching preference categories moves the dialog controls

**P3 · observed interaction refinement.** General, Documents and Import produce substantially different content heights and recenter the preference dialog. Category tabs and the close control therefore move between selections. This adds unnecessary pointer travel and makes the settings surface feel unstable.

Keep category navigation and header in a stable responsive frame, with content scrolling independently. Allow the frame to shrink to a small viewport without clipping.

Evidence: `14-compact-preferences`, `15-import-preferences`; Documents was inspected live but not separately captured.

## WR09 — Print settings scroll the preview out of sight

**P2 · confirmed layout problem.** In the approximately 808 × 854 print window, scrolling to orientation, duplex and pages-per-sheet moves the preview above the viewport. The user must scroll back to inspect the effect. The sticky action footer works and should be preserved.

Use independently scrolling settings with a fitted, persistent sheet preview at adequate widths. For short/narrow windows offer a deliberate preview/settings switch or compact preview. The preview must represent the selected layout, not merely the source page.

Evidence: `04-print-initial`, `06-print-preview-scrolled-away`.

## WR10 — Print preview lacks visible sheet navigation

**P2 · observed capability gap; no claim about printed output.** Custom range 2–3 yields two pages/two sheets, but only the first preview is visible and no previous/next sheet controls were found in the observed UI/tree. Two-up correctly reduces the reported sheet count to one; this pass did not establish that the composed sheet drawing is correct.

Add sheet navigation and “Sheet N of M”, with preview updates for range, order, orientation, duplex and N-up. Separate source-page count from output-sheet count. Verify actual output with a safe test destination during implementation.

Evidence: `04-print-initial`, `06-print-preview-scrolled-away`; range/count changes observed live.

## WR11 — Fit page does not realign the full page after leaving Book View

**P2 · bounded reproduction; related to previous fit-page complaint.** At the compact size, enter Book View on page 10, advance to 11 and close it. The editor correctly reports page 11 and renders its content, but the top of the page is outside the viewport. Clicking Fit page leaves this alignment unchanged after a subsequent settled observation. The fit scale is displayed as 59%. This is a viewport alignment problem, not a blank-page or wrong-page finding.

When explicitly invoking Fit page, fit and center the complete current page inside the usable canvas, including dock/footer clearance. Recompute after layout changes and Book View exit using the shared page anchor. Preserve a user's manual scroll offset during ordinary browsing, but an explicit fit action must recover a complete page view.

Evidence: `18-book-return-editor`, `19-fit-page-after-book`. Book page continuity itself passes in `16-compact-book-page-ten`, `17-book-page-eleven`.

## WR12 — Wide search/replace form loses visual grouping

**P3 · layout refinement in a surface still awaiting its overhaul.** At maximized size the search field stretches across much of the canvas and result controls sit at the far end; Replace expands a second broad row. Search functionality passed the tested match/no-match/Escape states.

Use a bounded form with grouped query, count and navigation controls, and a consistent expandable replacement section. Preserve keyboard behavior and highlight visibility. Treat this as input to the pending Search and Command Palette work, not proof its unfinished implementation is a regression.

Evidence: `02-search-replace`, `03-search-no-results`.

## Resize limit recommendation

Do not use a large minimum window size to conceal these defects. The approximately 997 × 658 captured compact window already supports working drawers and a bounded menu. Retain a provisional target of **960 × 640 DIPs**, subject to measurement and testing at the supported Windows scaling factors. This pass did not verify the currently enforced minimum or equate capture pixels with DIPs. Test 800 × 600 as a stress case and choose a hard minimum only after measuring header, dialog, dock and canvas constraints. Respect the available monitor work area when scaling makes the preferred size unavailable.

## Evidence interpretation

Screenshots are static captures, not frame-time recordings. A settled refresh was used before assessing page rendering; temporary blank/old accessibility snapshots during transitions were not filed as defects. No claims are made about implementation technology, GPU leaks, contrast ratios or actual print/crop output from this pass. Earlier findings not covered here remain unverified, not automatically resolved.
