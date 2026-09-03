## DEF-140: The floating Edit-mode TOOLBOX (inline editor window) cannot be dragged/moved — it stays stuck over the text box and page content

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (operator-reported BUG 4, reproduced on installed v1.7.13)
- Phase: 14 (Add-box inline editor UX)

Steps to reproduce:
1. Launch TFlex (installed v1.7.13 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages).
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Add box" (`[data-edit-tool="box"]`).
3. Drag a rectangle on page 1 (within the visible viewport) to place a text box; the inline editor (`[data-edit-editor="box"]`) appears. Type text (e.g. "Movable toolbox test") and click Apply (`[aria-label="Apply edit"]`) — a committed text box (`[data-edit-box-id]`) appears.
4. Click the committed text box ONCE. A floating TOOLBOX / inline editor window (`.edit-inline-editor`, `[data-edit-editor="edit"]`, containing the FONT/SIZE/COLOR toolbar row + the textarea) opens at the box location.
5. Press and HOLD the mouse on the toolbox's header / toolbar chrome (the FONT-SIZE-COLOR row — not a button, not the textarea) and drag ~220px right / 120px down, then release.

Expected: The floating toolbox (the inline editor window, together with the text inside) follows the cursor and can be repositioned so it does not cover the text box / page content — the operator's stated intent ("the toolbox along with the text inside should be movable").

Actual: The toolbox does not move at all. `.edit-inline-editor` getBoundingClientRect is UNCHANGED across the whole gesture: BEFORE drag `{x:653,y:455,w:200,h:182}`, MID-DRAG (while the mouse button is held and the cursor is 220px/120px away) `{x:653,y:455,w:200,h:182}`, AFTER release `{x:653,y:455,w:200,h:182}` — moved by `dx=0 dy=0`. The editor's only `onPointerDown` calls `e.stopPropagation()` and sets an inside-press blur-guard flag; there is NO pointermove handler that repositions the window, so the toolbox is stuck and keeps covering the page content while the user drags.
Screenshot: screenshots/bug4-toolbox-middrag.png (toolbox still at its origin while the cursor drags it), screenshots/bug4-toolbox-after-release.png (identical position after release), screenshots/bug4-box-editor-add.png (the add-box editor before commit).

History:
- qa: opened (operator-exact steps on installed v1.7.13; reproduced and measured. The committed box was placed at {x:652.6,y:455.3,w:130,h:80}; single-click reopened the editor at {x:653,y:455,w:200,h:182}; holding+dragging the toolbar chrome 220px/120px left it exactly at {x:653,y:455}, dx=0 dy=0. No pageerror, no editor auto-close.)
- qa: closed (retested on freshly installed v1.7.14 = FileVersion 1.7.14, e2e/retests/def_140_verify_1.7.14.spec.cjs — OPERATOR-EXACT flow, not the state arrays). Open report.pdf sample card -> Edit content toggle -> "Add box" -> drag a rectangle on page 1 -> type "Movable toolbox test" -> Apply -> committed box `[data-edit-box-id]` at {x:652.6,y:455.3,w:130,h:80} -> click the committed box ONCE -> the floating toolbox `.edit-inline-editor` opens at {x:653,y:455,w:200,h:182} (mode edit, identical anchor to the def-140 repro). HOLD + DRAG the toolbar chrome (`[data-edit-drag-handle]`, grabbed at the top-left padding point (658,461) — not a control) 220px right / 120px down: MID-DRAG (mouse still held) the toolbox is already at {x:873,y:575} (dx=220 dy=120 — it follows the cursor WHILE the button is held, not only on release), and AFTER RELEASE it stays at {x:873,y:575} (no snap-back, dx=220 dy=120). The toolbox no longer covers the text box / page content — the operator's stated intent ("the toolbox along with the text inside should be movable") is met. Regression checked: no pageerror (no "Invalid page request"/degreeAngle/NaN/React #310/#520) during the add/commit/click/drag flow. Pinned by the `EditInlineEditor` DEF-140 drag handle: `.edit-inline-toolbar` is the drag handle, `onToolbarPointerDown` records the pointer + rect (bailing out on `select/input/button/.edit-inline-toolbar-actions`), a window `pointermove` repositions the window via a `dragOffset` state applied on top of the anchored left/top, clamped to the viewport, and `pointerup`/`pointercancel` end the drag. Screenshots: screenshots/def-140-box-editor-add.png (add-box editor before commit), def-140-toolbox-middrag.png (toolbox at 873,575 while the cursor drags it clear of the "Mov" box), def-140-toolbox-after-release.png (identical to mid-drag — stays at the new position, no snap-back). CLOSED.)

## DEF-139: Inserting a blank page visually scrambles the document — the live view and thumbnail rail show the last page at position 1/2 instead of the blank, and pages render one slot off until save+reopen

- Status: CLOSED
- Severity: HIGH
- Found by: qa (operator-reported BUG 2, reproduced on installed v1.7.12)
- Phase: 9 (insert blank page regression on installed v1.7.12)

Steps to reproduce:
1. Launch TFlex (installed v1.7.12 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages; page 1 = "TFlex Technical Report" title, pages 2-17 = 8 chapters each + continuation, pages 18-34 = appendix "Page 1".."Page 17").
2. Open the Tools palette -> "Insert pages" (`[data-tool-id="insertPages"]`), keep mode "Blank page", set "Insert at page" to `2` (blank becomes page 2, i.e. inserted AFTER page 1), click Insert.
3. Wait for the ui/proxy to settle (I waited ~3s + scrolled the whole doc).
4. Look at the LEFT THUMBNAIL RAIL and the main viewer: what content does page 1, page 2, page 3 render?

Expected: Page 1 stays the "TFlex Technical Report" title; page 2 is the new BLANK page; page 3 is Chapter 1 ("Chapter 1: The Art of Orchestration"). The blank appears where requested and the document is otherwise unchanged except shifted by one.

Actual: The visible document is SCRAMBLED. `engineState.pageOrder` reports `[0,34,1,2,3,4,5,...]` (35 slots, unique 35) and the rail's `.thumb-item`/`.page-slot` `data-source-page` attributes declare slot 2 -> source 35 (the new blank) and slot 3 -> source 2 — which LOOKS correct. But the RENDERED CONTENT at each slot is wrong:
  - Slot 1 renders the title page ("TFlex Technical Report") — correct.
  - Slot 2 (declared source 35 = the new blank) renders "Page 17" — the LAST page of the document, NOT a blank.
  - Slot 3 (declared source 2 = Chapter 1) renders an EMPTY/blank page, not Chapter 1.
  - Slot 4 (declared source 3) renders "Chapter 1: The Art of Orchestration".
  - Slot 35 (declared source 34) renders "Page 16".
  So every slot from 2 onward is one content-slot off: the new blank does NOT appear as page 2, and the LAST page ("Page 17") content is instead shown at page 2 (and its real content lands one slot late). This is exactly the operator's report (the last page moved to the front / the visible order is wrong).

CRITICAL CONTRAST — the engine's SAVED OUTPUT and the FILE ON DISK are CORRECT. I did `Save As` after the insert and re-parsed the file with pdf.js: saved page 2 = "" (blank), saved page 3 = "Chapter 1: The Art of Orchestration", saved page 35 = "Page 17" — the correct order. So the mismatch is a LIVE-VISUAL (pdf.js proxy render / source-page mapping) defect, NOT a data-corruption defect. Save + re-open the file in TFlex -> the render is CORRECT (slot 2 = blank, slot 3 = Chapter 1, slot 35 = "Page 17").

Drawing on visible page 2 (part 2 of the operator's report): with `[data-tool="ink"]` a stroke drawn on VISIBLE page 2 lands on page 2 in the engine (`annotations = [{kind:ink,page:2}]`) and a rect on VISIBLE page 3 lands on page 3 — so DRAWING TOOLS DO work and the annotation overlay IS placed on the visible slot the user drew on (annotations render as HTML overlays, so the pdf.js canvas hash is unchanged, but the drawn `.ann-ink`/`.ann-rect` elements DO appear on those visible slots). The "no drawing tools work on page 2/3" symptom is NOT reproduced as stated — the ink/rect DO render on the visible pages the user draws on. What IS broken is that those visible slots are showing the WRONG page CONTENT (page 2 shows "Page 17", page 3 shows blank), so a user drawing on "page 2" after an insert-blank is actually drawing on top of a page that displays the last page's content — the annotation is attached to visible page 2 whose underlying/real page content the engine has not re-ordered in the live render.

Root cause direction (for the dev, renderer-side, not engine): the live pdf.js proxy is NOT rebuilt to match the engine's new pageOrder after insert-blank — `DocumentView`/`SideRail` map visible slot -> source via `pageOrder`, and `PageView` renders `doc.getPage(sourcePage)`, but the pdf.js proxy's actual page list still reflects the pre-insert order at live-render time, so `getPage(35)` (slot 2) returns the OLD last page's proxy page ("Page 17") instead of the new blank, and `getPage(2)` (slot 3) returns blank instead of Chapter 1. On save+reopen the proxy is rebuilt from the corrected bytes and the order is right. (The engine/pageOrder/annotations and the saved file are all correct — this is a live proxy/refresh mismatch.)

Screenshot: screenshots/def-139-rail-thumbs-1-4.png (rail: thumb 1 = title, thumb 2 = "Page 17" last-page content NOT blank, thumb 3 = blank, thumb 4 = Chapter 1), screenshots/def-139-live-page2.png (main-view slot 2 = "Page 17"), screenshots/def-139-live-page3.png (main-view slot 3 = blank), screenshots/def-139-live-page35.png (slot 35 = "Page 16", should be "Page 17"); also captured per-slot textLayer ground truth: slot1="TFlex Technical Report...", slot2="Page 17" (src 35), slot3="" (src 2), slot4="Chapter 1..." (src 3), slot35="Page 16" (src 34). The same-flow Save-As re-parse (external pdf.js) is the CONTROL: page2="", page3="Chapter 1...", page35="Page 17".

NOTE on previous verification: DEF-133 (which covers annotation-page-attribution after insert-blank) was CLOSED at this flow, and the DEF-133 note claimed the page-order was correct (blank becomes page 2). That conclusion was made by trusting the `pageOrder`/`data-source-page` ARRAYS — which this reproduction shows is WRONG: the arrays report the correct order while the LIVE RENDERED content shows the wrong page at every slot from 2 onward. This is exactly the "declare correct from pageOrder arrays alone" failure the operator warned about. The page-order claim is NOT correct when inspected visually.

History:
- qa: opened (installed v1.7.12; live view after insert-blank shows last-page "Page 17" at slot 2 and blank at slot 3 while pageOrder[1]=34/data-source-page[2]=35 claims the blank is slot 2; saved bytes + reopen render correctly).
- qa: closed (retested on freshly installed v1.7.13 = FileVersion 1.7.13, exe 10:52 AM, e2e/retests/def_139_verify_1.7.13.spec.cjs — OPERATOR-EXACT VISUAL check, not the state arrays). Open report.pdf sample card -> Tools -> Insert pages -> blank mode -> "Insert at page" = 2 (rank semantics: blank becomes page 2, inserted AFTER page 1) -> Insert. IMMEDIATELY (no save/reopen) the live view and the LEFT THUMBNAIL RAIL are correct: page-slot textLayer ground truth = slot1 "TFlex Technical Report", slot2 "" (BLANK, spanCount 0), slot3 "Chapter 1: The Art of Orchestration", slot35 "Page 17"; rail thumbCount = 35 and the thumbnails visually render thumb1 = title, thumb2 = BLANK (pure white, darkFraction 0), thumb3 = Chapter 1, thumb35 = "Page 17". Arm the Pen ([data-tool="ink"]) and draw on visible page 3 -> `.ann-ink` renders on the slot that shows "Chapter 1: The Art of Orchestration" (inkOnPage3=1, slot3 text still Chapter 1). DELETE PATH (developer note): delete page 2 (the blank) via [data-tool-id="delete"] range mode -> pageCount 35->34 and slot2 IMMEDIATELY renders "Chapter 1: The Art of Orchestration" (the correct next content), slot1 still title, slot3 continuation body. After all of the above page 2 is still BLANK. No save/reopen anywhere; the live render is immediately correct. No unhandled "Invalid page request"/"degreeAngle"/"NaN"/React #310/#520 pageerrors. Screenshots: screenshots/def-139-1713-rail.png, def-139-1713-thumb-1.png / -thumb-2.png / -thumb-3.png / -thumb-35.png, def-139-1713-live-page1.png / -live-page2.png / -live-page3.png / -live-page35.png, def-139-1713-page3-ink.png, def-139-1713-after-delete.png.) CLOSED.



- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 2 (regression on installed v1.7.11)

Steps to reproduce:
1. Launch TFlex (installed v1.7.11 binary = 9dcf83c source), open the report.pdf sample.
2. Click the toolbar "Rotate clockwise" (`[data-toolbar-rotate-cw]`). The page-1 canvas swaps 1156x1496 -> 1496x1156 (landscape); `window.tflexDiagnostics().engineState.rotations[0]` becomes 1.
3. Click "Save As" (`button[aria-label="Save As"]`), confirm the save.
4. Close the tab and re-open the saved file.

Expected: The rotated page stays rotated (renders landscape) after reopen — the /Rotate value written to the PDF is honored. Phase 2 criterion 4: "Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages."

Actual: The page-1 canvas renders 1156x1496 (portrait, aspect 0.773) after reopen, and `engineState.rotations[0]` is 0 — the rotation is silently gone. Reopening the file in TFlex loses the rotation (the saved file itself does carry `/Rotate=90` on page 1 when parsed with pdf-lib into a fresh document, but TFlex does not re-read it into its render/engine model). The user's page transformation is silently discarded on save+reopen.

Screenshot: measured page-1 canvas aspect before save = 1.294 (landscape) vs after reopen = 0.773 (portrait). (SEE `e2e/probe_rotate.spec.cjs`.)

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-138). Open report.pdf, click `[data-toolbar-rotate-cw]` -> `engineState.rotations[0]` becomes 1 and the page-1 canvas swaps to 1496x1156 (aspect 1.294 landscape). Save As to a temp path, then close the tab and re-open the saved file: after reopen `engineState.rotations[0]` is still 1, `rotations[1]` is 0, and the page-1 canvas renders 1496x1156 (aspect 1.294 landscape) — the rotation is no longer silently dropped. Screenshot screenshots/def-138-1712-after-reopen.png. Regression checked: no pageerror during rotate/save/reopen; the rest of the save path is unaffected (a subsequent rotate re-save again round-trips). CLOSED.



## DEF-137: Drawn/created annotations are silently dropped on save — no PDF annotation object, no baked content, not reloadable

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 3 (regression on installed v1.7.11)

Steps to reproduce:
1. Launch TFlex (installed v1.7.11 binary = 9dcf83c source), open the report.pdf sample.
2. Arm the Pen (annotation toolbar `[data-tool="ink"]`) and draw a stroke on page 1.
3. Arm the Sticky note (`[data-tool="note"]`), click a point on page 1, type "DEFECT NOTE 137", confirm (note icon + text render on the page).
4. Verify both annotations are present: `window.tflexDiagnostics().engineState.annotations` has 2 entries (kind "ink" and kind "note" with content "DEFECT NOTE 137"), and the page shows the stroke + note icon + text.
5. Click the toolbar "Save As" (button[aria-label="Save As"]), confirm the save (file is written).
6. Re-open the saved file (close the tab, re-open the saved path).

Expected: The annotations are written into the PDF as standard annotation objects (Phase 3 criterion 4), so they appear when the file is re-opened in TFlex and in any other PDF reader; the note content survives.

Actual: The saved PDF contains ZERO annotation objects and ZERO per-page `/Annots` entries (parsed with pdf-lib: `PDFDocument.load` then enumerating every indirect object yields no `/Type /Annot` dict on any page, and every page's `/Annots` array has size 0). The ink stroke and the note are NOT baked into the page content either. Re-opening the saved file in TFlex shows a completely clean page-1 (no ink stroke, no note icon, no note text) and `engineState.annotations` is `[]`. The user's annotations are silently lost on save. (Note: the saved file is ~1 KB larger than a rotation-only save, consistent with the annotation dicts being registered as orphaned objects that no page `/Annots` references.)

Screenshot: screenshots/def-137-before-save.png (ink stroke + "DEFECT NOTE 137" note visible on page 1) vs screenshots/def-137-after-reopen.png (the same page after save+reopen is clean — both annotations gone).

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-137). Open report.pdf, arm the Pen `[data-tool="ink"]` and draw a stroke on page 1, arm the Sticky note `[data-tool="note"]`, click a point, type "DEFECT NOTE 137", confirm. Pre-save: `engineState.annotations` = [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}]. Save As to a temp path, then close the tab and re-open the saved file. pdf-lib parse of the saved bytes: pageCount 34, per-page /Annots counts [2,0,0,0,0,0], with 1 `/Subtype /Ink` and 1 `/Subtype /Text` (note) annotation object on page 1 — the annotations are real PDF annotation objects, not orphaned. After reopen: `engineState.annotations` hydrates back to [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}], and the page renders `.ann-ink` = 1 and `.ann-note` = 1 with the note text visible (screenshots def-137-1712-before-save.png vs def-137-1712-after-reopen.png — both the ink stroke and the "DEFECT NOTE 137" note render before save AND after reopen). Regression checked: no pageerror during annotate/save/reopen. CLOSED.



## DEF-136: Selecting a placed Add-box text box offers no Delete/Remove option

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle on the page, type "MY BOX", Ctrl+Enter to commit.
4. Click the placed box (either to move or just to select it).

Expected: A placed text box can be deleted (a Delete/Remove action, parity with the Edit-image tool's "Remove" button).
Actual: The box shows only the inline editor (Font / Size / Color / confirm / cancel) and corner handles — there is NO Delete/Remove affordance. The Edit-image tool shows a toolbar with Replace / Crop / Remove; the Edit-toolbox tool has no equivalent, so a committed text box cannot be removed without undoing the whole add. Screenshot: screenshots/def-137-box-selected.png (the selected box's chrome has no Delete/Remove control).
Root cause: `src/renderer/edit/EditOverlay.tsx` `TextBoxView` renders only the box surface + resize handles (no `.edit-box-toolbar`). Only `PlacementToolbar` (the image tool) provides a Delete/Remove button; the box tool has no action bar wired to remove a committed box from the registry / engine.
History:
- qa: opened (ground-truth on installed v1.7.10; box selected => `selected:true`, no `.edit-box-toolbar` / delete button in the box chrome).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place an Add-box, commit, click it -> the inline editor reopens; Escape closes it, leaving the box `.edit-box-selected`. A `.edit-box-toolbar` appears with BOTH `[data-edit-box-action="edit"]` (reopens the editor with the box's committed content) and `[data-edit-box-action="delete"]` (engine.deleteTextBox). Clicking Delete removes the box: the rendered `.edit-box` for that id count = 0 AND the engine registry `EngineState.textBoxes` no longer holds it. Text boxes are an engine-side placement registry (addTextBox / moveTextBox / deleteTextBox + `EngineState.textBoxes`). Screenshots screenshots/def-136-box-toolbar-delete-edit.png, def-136-after-delete.png. CLOSED.

## DEF-135: Moving an Add-box text box that covered text erases that text (white-mask artifact)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle directly over the title run "TFlex Technical Report"; type "MY BOX"; Ctrl+Enter to commit.
4. Drag the box body (e.g. 120px right / 120px down) to move it to a new spot.

Expected: Moving a text box moves the box (and its text) to the new spot, leaving the page content it covered intact.
Actual: The box moves, but the area where the box originally sat is permanently masked with a white rectangle — the title "TFlex Technical Report" is visually erased (blank) even after the box moves away. The string stays in the pdf.js textLayer (so it remains selectable in the DOM), but the painted page no longer shows it. Screenshot: screenshots/def-137-after-move.png (title gone where the box was; "MY BOX" sits at the new spot).
Root cause: `EditOverlay.tsx` `onPointerUp` textBoxMove path -> `onCommitTextBoxMove` -> the host re-bakes the box through the engine's `editImage` mask-and-draw contract (white `drawRectangle` over `oldRect`), which erases whatever content was under the box's ORIGINAL rect. This is the same mask-and-draw limitation as DEF-116/124 (mask, don't strip) now surfaced when moving a box over real content — content under a moved box's old position is lost from the visible page.
History:
- qa: opened (ground-truth on installed v1.7.10; box placed over the title, moved 120px, title area masked/erased).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place an Add-box directly over the title "TFlex Technical Report", commit ("MY BOX"), then drag the box 120px right / 120px down. The title REGION of the page-1 canvas keeps dark-fraction 0.2178 BOTH before and after the move (pixel-identical — NO white-mask artifact), and the "TFlex Technical Report" span stays in the textLayer; the title is visibly intact. Text boxes are now an engine-side placement registry (addTextBox pushes a `TextBoxModel`, no pdfDoc mutation; moveTextBox updates the rect; drawn ONCE at the FINAL rect at save), so moving a box never masks the content under its old rect. Save + re-parse with pdf-lib: valid 34-page PDF. Screenshot screenshots/def-135-after-move.png. CLOSED.

## DEF-134: Dragging a committed signature, then clicking it, reverts to the previous position

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, click toolbar "Sign tool", Type tab -> type "QA" -> Save -> pick the saved signature.
3. Click the page to place, Confirm to commit (placement rect left 200 / top 200).
4. Drag the committed placement 120px right / 60px down (it renders at left 320 / top 260 — the uncommitted move rect).
5. Click the placement again WITHOUT pressing Confirm on the floating action bar.

Expected: The signature keeps the dragged position (the move is applied live); a click should not discard an in-progress move.
Actual: The click reverts the placement back to its PREVIOUS (committed) position — left 200 / top 200 — and the drag result is lost. The new position is not applied; the user must click Confirm, but any incidental click on the placement discards the move. Screenshots: screenshots/def-135-after-drag.png (moved to 320,260) and screenshots/def-135-after-click.png (reverted to 200,200).
Root cause: `SignaturesOverlay.tsx` `onPointerDownPlacement` calls `setPendingMoveRect(null)` at the very top (line ~219) on EVERY new pointerdown on a placement, including a plain click. That clears the held (uncommitted) `pendingMoveRect` before the drag/commit can happen, so the placement re-renders at the committed `p.rect` and the move is discarded.
History:
- qa: opened (ground-truth on installed v1.7.10; placement rect 200,200 -> drag -> 320,260 -> click -> 200,200).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place a typed signature at rect 200,200 and Confirm. Drag 120px right / 60px down -> the placement rect becomes 320,260 (the move is applied LIVE, visible before confirm). Click the placement WITHOUT pressing Confirm -> rect STAYS 320,260 (no revert; dxFromInitial=120). Click Confirm -> the new position 320,260 is committed. Root cause fixed: `onPointerDownPlacement` no longer clears a held `pendingMoveRect` that belongs to the SAME placement (the `SIG_CLICK_TOLERANCE_PX` = 4 click path preserves it), so a post-drag click no longer snaps the signature back. Screenshots screenshots/def-134-after-drag.png, def-134-after-click-no-revert.png, def-134-after-confirm-commit.png. CLOSED.

## DEF-133: After inserting a blank page, drawing an annotation on pages 2/3 silently places it on the wrong page

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf (34 pages), Tools palette -> "Insert pages", blank mode, "Insert at page" = 2, Insert (pageCount 34 -> 35).
3. Scroll to the visible page 2 (the new blank) and confirm the page order is correct: engineState.pageOrder becomes [0,34,1,2,...] — the new blank IS page 2. (The page-order claim does NOT reproduce; see note.)
4. Arm the Pen (annotation toolbar "Pen" / data-tool="ink") and draw a stroke on visible page 2; then draw a Rectangle on visible page 3.

Expected: The ink stroke / rectangle appears on the page the user drew on (visible pages 2 and 3).
Actual: No annotation appears on the page that was drawn on. The engine state records 1 annotation (`engineState.annotations.length === 1`), and the stroke actually renders on the LAST visible page (page 35) — a pen stroke drawn on visible page 2 lands on visible page 35; a rect drawn on visible page 3 lands on page 2. The user's mark is silently placed at the wrong position in the document. Screenshot: screenshots/def-133-pen-misplaced.png (ink drawn on page 2; appears on page 35).
Root cause: `DocumentView.tsx` renders `<PageView pageNumber={sourcePage} ...>` where `sourcePage = visibleToSourcePage(visiblePage, engineState.pageOrder)` (the pdf.js SOURCE page, origIdx+1). `PageView.tsx` passes `page={pageNumber}` (the source page) to `<AnnotationOverlay>`, which stamps the created annotation's `page = sourcePage`. The engine's `annotations.createAnnotation` (`src/main/services/annotations.ts:246`) treats `payload.page` as the VISIBLE page and computes `origIdx = order[visiblePage - 1]`. After a reorder these differ (visible page 2 -> source page 35 / origIdx 34), so the annotation is stored on the WRONG origIdx and rendered on the wrong visible page.
NOTE: The report's "LAST page gets moved to position 2 and the NEW page lands at position 3" page-order claim is NOT reproduced — `pageOrder[1]` === 34 (the new blank), i.e. the blank correctly becomes page 2 and the original last page stays at the end. The defect is the annotation page-number mismatch, which makes drawing tools appear broken on pages 2/3.
History:
- qa: opened (ground-truth on installed v1.7.10; page order correct, but ink on visible page 2 -> page 35, engine annotations = 1).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Insert blank at position 2 -> pageCount 34->35, pageOrder [0,34,1,2,...], the new blank IS visible page 2, unique 35 (insert-blank regression clean, no duplicate). Arm the Pen and draw a stroke on VISIBLE page 2; arm the Rectangle and draw on VISIBLE page 3: engine annotations = [{kind:ink,page:2},{kind:rect,page:3}] — the pen lands on visible page 2 and the rectangle on visible page 3 (was page 35 / page 2). Committed ink is rendered on the visible page-2 slot. Root cause fixed: PageView now threads BOTH `page` (the VISIBLE index, used by every overlay to create content) and `sourcePage` (the pdf.js proxy index, used only by `doc.getPage(sourcePage)` to render), so an overlay no longer stamps the SOURCE page number into the annotation. Screenshot screenshots/def-133-pen-correct-page.png. CLOSED.

## DEF-132: Frameless window cannot be moved by dragging the title bar

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source). The window is created with `frame: false` (no native title bar).
2. Attempt to move the window by pressing and dragging anywhere on the top title bar (the brand / tab strip / empty caption area).

Expected: The window behaves as a normal draggable Windows window — dragging the caption strip moves it (and Aero Snap works at the screen edges).
Actual: The window cannot be moved by dragging the title bar. Sampling the computed `-webkit-app-region` across the title bar yields `draggablePx = 0` and `noDragPx = 60480` — every pixel of the 1442x44 title bar resolves to `no-drag`; the full-width `.titlebar-slot` (1264px, flex:1) and the `.app-header` inside it are both `-webkit-app-region: no-drag`. With `frame: false` there is also no native caption area to grab, so the window has no mouse-drag affordance at all. Screenshot: screenshots/def-132-titlebar-region.png.
Root cause: `src/renderer/styles.css` — `.titlebar { -webkit-app-region: drag }` (line 312) is defeated by `.titlebar > * { -webkit-app-region: no-drag }` (line 317-319), which applies `no-drag` to the `.titlebar-slot` (the direct child that fills the whole bar width) and `.titlebar-controls`/`.titlebar-menu`. The `.app-header` inside the slot also declares `-webkit-app-region: no-drag` (line 282). Because the slot spans the entire bar (the only free drag surface is the leftover padding, which is zero-width given the slot is `flex: 1 1 auto`), there is effectively no draggable caption region. Combined with `frame: false` (src/main/window.ts:64) there is no native caption either — so the window is immovable by mouse.
History:
- qa: opened (ground-truth on installed v1.7.10; region map: titlebar-slot and app-header both no-drag, dragPx=0).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). The `.titlebar` computes `-webkit-app-region: drag`; `.titlebar-slot` and `.app-header` both resolve to `drag` (the DEF-132 `.titlebar > * { no-drag }` rule is gone — only interactive children opt out via scoped `.titlebar-menu-*` / `.titlebar-control*` / `.app-header button,input,select,textarea` rules). Region map over the 1442x44 bar: dragPx=46836, noDragPx=13644, so 72.7% of the caption strip is draggable (was dragPx=0). The frameless window is now movable by dragging the caption strip. Screenshot screenshots/def-132-titlebar-draggable.png. CLOSED.

## DEF-131: "Per page" crop applies the crop to EVERY page, not just the selected one

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages, every page 612x792 pt).
3. Tools palette -> "Crop pages", switch mode to "Per page".
4. On the page-1 editor drag the SE crop handle inward (shrink the box) — summary reads e.g. x 61.2 / y 79.2 / width 285.6 / height 429.6 pt.
5. Click "Apply crop".

Expected: Only page 1 is cropped; pages 2+ keep their full 612x792 box.
Actual: The toast reads `Cropped 1 page.`, but EVERY page renders at the cropped size. Measured `.pdf-page[data-page]` BEFORE crop: pages 1-3 all `1156x1496 px` (`--scale-factor: 1.888`, i.e. full 612x792). AFTER crop: pages 1-3 all `1156x1739 px` (`--scale-factor: 4.047`, i.e. 285.6x429.6). So a per-page crop on page 1 silently cropped the whole document.
Screenshot: screenshots/gt_b11_after_crop.png (before/after page sizes in the run log).

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; per-page crop sent one entry — toast "Cropped 1 page." — yet all pages render cropped after the post-crop proxy refresh).
- qa: retested on installed v1.7.9 (FileVersion 1.7.9, exe 02:56 newer than all src). Crop page 1 per-page (drag SE inward), Apply -> toast "Cropped 1 page."; after the proxy refresh page 1 renders at aspect 0.7458 (=cropped, deviates from full 0.7727) and is NARROWER than pages 2/3, while pages 2 and 3 stay full-aspect 0.7729 and identical to each other — the crop no longer propagates to the other pages. Definite: the post-crop global re-fit scale changes the absolute px of pages 2/3 (the zoom jumps to fit the current page), which is pre-existing fit-to-current-page behaviour, not the crop-propagation bug; the CropBox/TrimBox are NOT copied onto the other leaves (pinned by test/unit/main/def130_131_124.test.ts). Regression checked: save is unaffected, no pageerror. Screenshot screenshots/def-131-after-crop.png. CLOSED.

## DEF-130: Re-inserting a blank page after an undo throws "degreeAngle must be of type number, but was actually of type NaN"

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", blank mode, "Insert at page" = 2 (blank lands after page 1), Insert.
4. Undo (rail "Undo last change") — pageCount returns to 34.
5. Insert a blank page again (same settings).

Expected: The second insert completes cleanly.
Actual: A toast appears: `Could not refresh document proxy: Engine error: getDocumentBytes failed: `degreeAngle` must be of type `number`, but was actually of type `NaN``. The post-insert proxy refresh (`refreshDocProxyFor` -> `engine.getDocumentBytes`) throws.
Screenshot: screenshots/gt_b9_reinsert.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; the reported error string is reproduced verbatim).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Insert blank after page 1 ("2"), Undo -> pageCount 34, re-insert -> pageCount 35, pageOrder [0,34,1,2,...] with no duplicates, thumbCount 35 (proxy refreshed). NO "degreeAngle ... NaN" toast, NO `degreeAngle`/`NaN` pageerror, no React #310. Root cause fixed: insertBlankPage now snapshots the pdfDoc bytes (snapshotDocWithPdf) so undo reverts the pdfDoc too, plus a finite-guard at the serialize site; pinned by test/unit/main/def130_131_124.test.ts. Screenshot screenshots/def-130-after-reinsert.png. CLOSED.

## DEF-129: Insert-blank page at position 1 is impossible — the Insert button is disabled

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", mode "Blank page".
4. Set "Insert at page" to `1`.

Expected: Inserting a blank page at position 1 (before page 1) is allowed.
Actual: The Insert button is `disabled`. Entering `2` enables it. (The dialog hint also states "A blank page cannot be inserted before page 1.")
Screenshot: screenshots/gt_b8_pos1_disabled.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Insert pages -> blank mode -> "Insert at page" = 1: the Insert button is ENABLED (confirmDisabled=false), and Inserting prepends a blank page that becomes page 1 (pageCount 34 -> 35, pageOrder [34,0,1,2,...], unique 35, original page 1 now page 2). The dialog hint now reads "1 inserts before page 1" and the result matches (DEF-122 semantics consistent). No "Invalid page request" pageerror (DEF-121 regression). Pinned by the new `-2` PREPEND sentinel (slot 0 -> afterIndex -2) in App.tsx + test/unit/main/def130_131_124.test.ts. Screenshot screenshots/def-129-after-prepend.png. CLOSED.

## DEF-128: Closing an unsaved SAMPLE (bytes-loaded) tab with "Save" fails with "no on-disk path" instead of offering Save As

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open the report.pdf sample (bytes-loaded, no on-disk path).
3. Make an edit (e.g. rotate a page — toolbar Rotate clockwise) so the tab is modified.
4. Click the tab's close button.
5. In the "Unsaved changes" prompt click "Save".

Expected: The prompt offers Save As (or routes Save to Save As for a bytes-loaded doc) and closes the tab after saving a copy.
Actual: The prompt shows an inline red error `This document has no on-disk path. Use Don't save to discard, or open Save As first.` and stays open — the user cannot save their work first.
Screenshot: screenshots/gt_b7_after_save.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Open report.pdf sample (bytes-loaded), rotate a page (modified=true), click tab close -> the "Unsaved changes" prompt's Save button reads "Save As…" (no inline "no on-disk path" hard-block error). Stubbed the OS save dialog to a temp path and clicked "Save As…": the tab saves-and-closes (prompt gone, 0 tabs), and the saved file is a real, re-parseable 34-page PDF (pdf-lib getPageCount=34). Pinned by test/unit/renderer/bugDEF128_closePromptSaveAs.test.tsx. Screenshot screenshots/def-128-prompt-save-as.png. CLOSED.

## DEF-127: Add-box: dragging a committed text box moves only the surface (text stays put); clicking it does not reopen the editor

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose "Add box".
3. Drag a rectangle on the page; type text ("My test box"); Apply.
4. Drag the committed box 120px right / 60px down.
5. Click the (moved) box.

Expected: The box AND its text move together; clicking the placed box reopens the inline editor.
Actual: Only the dashed `.edit-box` surface moves (its rect goes from 448,345 -> 568,405); the baked text "My test box" stays at the original spot (an empty blue box moves and persists). Clicking the box does NOT reopen the editor (no `.edit-inline-editor` mounts).
Screenshot: screenshots/gt_b5_box_after_drag.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit -> Add box -> drag a box, type "DEF127 MOVABLE BOX", Ctrl+Enter. The committed box surface mirrors its content ([data-edit-box-text-mirror] = "DEF127 MOVABLE BOX" + .edit-box-fill). Re-arm box tool and drag the box: the whole box moves (rect 428,366 -> 538,436, moved=true) AND the text mirror travels with it -> no empty phantom at the old spot (boxCount stays 1). Clicking the moved box reopens the inline editor pre-filled with "DEF127 MOVABLE BOX". Pinned by test/unit/renderer/bugDEF127_textBoxMoveRebake.test.tsx. Screenshots screenshots/def-127-after-drag.png, def-127-click-reopens-editor.png. CLOSED.

## DEF-126: OCR suspects top bar has dead space, overlaps the Tools panel and left thumbnail rail, and is opaque

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open scanned.pdf, Tools palette -> "Recognize text (OCR)", set scope to "Current page", Recognize.
3. After the run the OCR suspects panel opens.

Expected: The suspects bar sits flush below the toolbars, inside the document area, with the doc/tools/rail content reflowing around it and a translucent background.
Actual:
  (a) Dead empty space — the bar's computed `top` is 100px, but the real toolbar (44px) + ann-toolbar (40px) bottom is 84px, leaving a ~16px unexplained gap.
  (b) The bar spans `left:0; right:0` (1442px) over the left thumbnail rail (x 0..220) and over the right Tools palette (x 1162..1442).
  (c) It does not reflow the content — it is an absolute overlay with `max-height:172px; overflow:hidden`, covering the rail/palette/document.
  (d) Background is fully opaque `rgb(14,17,21)` (not translucent).
Screenshot: screenshots/gt_b4_ocr_full.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; layout measured: panel y=144.67, w=1442, bg rgb(14,17,21), top:100px, z-index 40).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). scanned.pdf -> Recognize text -> current page -> OCR; the suspects panel is now a FLOW element (position static) at the very top of app-main: panel.top == appMain.top == 44.67 (flush, no dead gap under the top bar), panel.bottom (192.67) == rail.top (192.67) (the content reflows directly beneath it), background rgba(14,17,21,0.82) = translucent, and true 2D intersection with the left thumbnail rail and the right Tools palette is 0 (overlapRail=0, overlapPalette=0; the palette downshifts via `.app-main:has(.ocr-suspects-panel) .tools-palette`). No longer a stale-offset opaque absolute overlay. Pinned by test/unit/renderer/bugB4_ocrTopBarCss.test.ts. Screenshot screenshots/def-126-suspects-panel.png. CLOSED.

## DEF-125: Sign tool cannot be applied while Edit mode is active, and clicking Sign does not exit Edit mode

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit (toolbar "Edit content"), choose the "Edit text" tool (the per-page `.edit-layer` becomes `edit-layer-active`).
3. Click toolbar "Sign tool", save + pick a signature in the manager.
4. Click the page to place the signature.

Expected: Clicking Sign exits Edit mode, or the signature still lands on the page.
Actual: Edit mode stays active (Edit toggle `aria-pressed=true`, edit toolbar present, `.edit-layer` `edit-layer-active`); the signature click produces NO pending placement (`[data-sig-pending]` false, `[data-sig-action-bar]` false, `.sig-placement` 0). The signature cannot be applied while an edit tool is active.
Screenshot: screenshots/gt_b3b_place_attempt.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit toggle -> Edit text tool (.edit-layer-active). Click the Sign tool: Edit mode exits (Edit toggle aria-pressed=false, edit toolbar gone, edit layer no longer active). Create + arm a typed signature, click the page -> the pending placement + action bar appear, and Confirm commits a `.sig-placement` on the page (placementCount=1). No React #310 anywhere. The arm sites (toolbar tflex:sign-button, palette Sign, onSigManagerApply) all call setEditMode(false) guarded by editModeOpenRef; pinned by test/unit/renderer/bugDEF125_signExitsEditMode.test.ts. Screenshot screenshots/def-125-placed-on-page.png. CLOSED.

## DEF-124: Edit-text leaves a faint trace of the old run behind — the white mask does not cover the full glyph rect

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, toggle Edit, choose the "Edit text" tool.
3. Click the subtitle run "A study in PDF orchestration and performance."; the inline editor opens (mode "edit").
4. Replace with a longer string, then "Apply" (Ctrl+Enter or the apply button).

Expected: The old run is fully replaced with no ghost, and is no longer present in the document content.
Actual: The new text renders with a faint gray trace of the OLD run behind/below it — the white mask covers only the pdf.js text-item bbox, not the full painted glyph extents. The page's `.textLayer` still contains the original run string, so the old text remains selectable/searchable in the content stream.
Screenshot: screenshots/gt_b2_clean_zoomed.png (old-run ghost visible behind the new text)

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit -> Edit text -> click the "TFlex Technical Report" title run (editor opens pre-filled), replace with "ZZZ REPLACEMENT 987654", Ctrl+Enter. The new text renders in the live textLayer (proxy refreshed) and the screenshot shows NO faint gray trace of the old run behind/below it (subtitle and title area are clean after the mask is widened). The white mask now covers the old run's bbox + symmetric PAD + font ascent above + descent below (mask width > bbox width and mask height > bbox height, verified in the saved content stream); pinned by test/unit/main/def130_131_124.test.ts. NOTE: mask-and-redraw remains the v1 approach (DEF-116 was REJECTED) — the old run is still in the content stream, but the visual ghost is gone. Screenshot screenshots/def-124-after-edit.png. CLOSED.

## DEF-123: Placed signature click shows only move/resize handles, not the Confirm/Cancel/Delete action bar

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf, click toolbar "Sign tool", Type tab -> type "QA Ground" -> Save, pick the saved signature.
3. Click the page to create a pending placement; the action bar (Confirm/Cancel/Delete) appears.
4. Click Confirm to commit the placement.
5. Click the now-placed signature.

Expected: Clicking a committed placement re-shows the same Confirm/Cancel/Delete action bar (parity with placement time).
Actual: Only the four corner move/resize handles appear (`.sig-handle`). There is NO `[data-sig-action-bar]` and no `[data-sig-action]` buttons for a committed placement.
Screenshot: screenshots/gt_b1_clicked_placed.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Sign tool -> Type "QA Ground" -> Save -> pick; click the page, Confirm to commit. Clicking the committed `.sig-placement` now re-shows the SAME Confirm/Cancel/Delete action bar ([data-sig-action-bar] + confirm/cancel/delete all present) AND selects the placement (corner handles). Dragging the committed placement moves its placeholder rect (568,456 -> 628,501, moved=true) while the bar stays (uncommitted hold), and clicking Confirm commits the move and ends the selection (bar gone, placement still present, no #310). Bar-button press does not start a drag / no swallow. Pinned by test/unit/renderer/bugDEF123_committedSigActionBar.test.tsx. Screenshots screenshots/def-123-after-click-bar.png, def-123-after-drag.png. CLOSED.

## DEF-121: Insert-blank-page (mid-document) throws unhandled pdf.js "Invalid page request" twice

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt + reinstalled 11:24 PM).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", leave mode "Blank page", set "Insert at page" to `1` (which lands the blank right after page 1), click Insert.
4. Watch the renderer console (`pageerror`).

Expected: The insert completes cleanly with no unhandled renderer errors.
Actual: Immediately after the insert (during the post-op pdf.js proxy rebuild / side-rail thumbnail render) the renderer throws `Error: Invalid page request.` from `pdfjs getPage` TWICE. The engine state and rendered result are correct (35 pages, blank at rank 2, pageOrder `[0,34,1,2,...]`, no duplicate pages), and the saved file re-opens as a valid 35-page PDF (document-safety check: save -> reopen -> pageCount 35, unique 35) — so this is NOT corruption. The error also does NOT occur on the append (`end`) path; it is specific to inserting a blank page into the MIDDLE of the document (a reorder). Recorded as an unhandled console error in a core user flow; no visible degradation, but the developer should confirm whether it should be caught.

History:
- qa: opened (ground-truth on installed v1.7.7; reproduced while running e2e/retests/release_gate_117_verify.spec.cjs B7; `pageerror` stack points to pdf.js `getPage` from within the renderer bundle during the post-insert proxy refresh).
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). Mid-document insert no longer throws "Invalid page request": e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 (insert blank at position 1 -> order0 [34,0,1,...], unique 35) asserts the pageerror filter "Invalid page request|degreeAngle|NaN" is empty and it PASSED (badErrors=[]); the re-insert path (DEF-130) also stays clean. Root cause fixed: the render paths now tolerate the temporarily-stale page index via `isInvalidPageRequest` (drop the attempt, let the doc-identity swap in `refreshDocProxyFor` re-run the render effect). Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts — `isInvalidPageRequest` helper (recognizes the rejection, ignores unrelated failures) + PageView.run/SideRail.Thumb guards import it. Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-after-prepend.png. CLOSED.)

## DEF-122: "Insert at page" hint contradicts actual placement — position N inserts AFTER page N, hint says it lands AS page N

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt + reinstalled 11:24 PM).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", mode "Blank page". The field help says: `Page number where the new content lands. Use end to append. 1 means "before page 1"; {totalPages + 1} means "appended after the last page"`.
4. Enter `1` and observe the placed page; then re-insert with `2` and observe.

Expected: Following the hint, entering `1` should make the blank page the FIRST page (before page 1), and entering `2` should make it the SECOND page (page 2).
Actual: Entering `1` makes the blank page the SECOND page (pageOrder `[0,34,1,2,...]`), and entering `2` makes it the THIRD page (pageOrder `[0,1,34,2,...]`). Every numeric position is off by one from the hint: the engine treats the value as "insert AFTER page N" (`afterIndex = N-1` -> `insertAt = N`), so position `N` lands the new page at rank `N+1`. Only the `end` sentinel and the `{totalPages+1}` extreme clamp to a correct append. A user following the written hint (e.g. "insert after page 1" -> entering `2`) gets the page one slot later than intended.

Root cause: InsertPagesDialog.tsx `parsed.position = N - 1` is passed as the engine `afterIndex` (0-based index AFTER which to insert), and `_insertBlankPageImpl` (engine.ts:1284) does `insertAt = afterIndex + 1`. The dialog's user-facing hint describes the value as "the rank the new content lands", which contradicts the engine's "after page N" contract. (The DEF-114 `end`/append fix is unaffected and still correct.)

History:
- qa: opened (ground-truth on installed v1.7.7; the "insert after page 1" flow is asserted in e2e/retests/release_gate_117_verify.spec.cjs B7 via position "1", and the off-by-one was characterized against position "1" and "2").
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). The position value now uses rank semantics — the page number the new content BECOMES — so the hint and the placement agree, and the off-by-one is gone: e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 inserted blank at "1" -> blank becomes page 1 (order0 [34,0,1,...], order[0]=34); DEF-130 inserted at "2" -> blank becomes page 2 (order0 [0,34,1,...]). Slot 0 maps to the engine afterIndex -2 PREPEND sentinel (valid in blank mode, no "cannot insert before page 1" guard) and the dialog min is now 1. DEF-114 append sentinel (end/empty -> -1) unchanged. Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts (slot-to-afterIndex translation + dialog min=1). Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-position1.png. CLOSED.)

## DEF-117: Modal dialogs cannot open — React #310 (Rules of Hooks) from the B3/B6 backdrop refactor; whole UI unmounts to a black window

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7 regression)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45, exe newer than all src).
2. Open report.pdf (34 pages).
3. Click the "Sign" toolbar button (`button[aria-label="Sign tool"]`).

Expected: The Signature manager modal (`.sig-manager`) opens so a signature can be drawn, typed, or a saved one picked and armed for placement.
Actual: The renderer throws `Minified React error #310` ("Rendered more hooks than during the previous render") and the ENTIRE app UI unmounts to a black window (screenshots/def-117-sign-flow-broken.png) — no modal, no toolbar, no page. The identical #310 fires when any other modal-opening control is clicked (Export to Word, Insert pages, Crop pages, Recognize text, Save-As, Optimize, Merge, Split, Stamp, Flatten, etc.), so it is not specific to Sign.

Root cause: The B3/B6 fix re-wired every modal backdrop through the shared `useBackdropClose` hook (src/renderer/components/modalBackdrop.ts). In 21 dialogs the hook is called AFTER the component's `if (!open) return null;` early return (e.g. SignatureManagerModal.tsx:72-77, DocxExportDialog.tsx:132-138, CropPagesDialog.tsx:168-174, InsertPagesDialog.tsx:156-162, OcrDialog.tsx:293-297). That violates the Rules of Hooks: when `open` flips false→true the hook count grows by one (`useRef` inside `useBackdropClose`), so React throws #310. The error is uncaught (no error boundary) and React unmounts the whole root, leaving a black window.

Affected dialogs (21, all with the hook after `if (!open) return null;`): SignatureManagerModal, DocxExportDialog, CropPagesDialog, InsertPagesDialog, OcrDialog, DeletePageDialog, RenumberPagesDialog, ReplacePagesDialog, SaveAsDialog, OptimizeDialog, AuditSpaceDialog, MergeDialog, SplitDialog, ExportDialog, TextExportDialog, CreateFromImagesDialog, StampDialog, CommentExportDialog, CommentImportDialog, CloseTabPromptDialog, FlattenConfirmDialog.

Impact: This blocks the v1.7.7 verification of B1 (sign placement + re-click handles), B3/B6 (DOCX/Crop/Insert dialog stays open on a text-selection drag-out; genuine backdrop click still closes), B4 (OCR suspects panel as a top bar + no overlapping white text after OCR), B7 (insert blank page after page 1 shows exactly 35 thumbnails with no duplicate / stray "Page 17"), B8a (crop mode-switch no flicker) and B8b (per-page crop crops only the adjusted page). None of those flows can be exercised because the modal they live in never mounts. Repro note: B1/B3/B6/B7/B8a/B8b all timeout at `waitForSelector` for their dialog/modal, and each is accompanied by React #310 in `pageerror`.

Screenshot: screenshots/def-117-sign-flow-broken.png (black window after the Sign click; the #310 was captured in the renderer `pageerror`). Same black-window result captured at screenshots/gt-bug10-restored.png vicinity (any dialog open) and temp probes (b4_ocr.png).

History:
- qa: opened (ground-truth reproduction on installed v1.7.7, rebuilt 22:45). Reproduced via the Sign toolbar button, the Tools-palette Sign entry, a direct `window.dispatchEvent(new CustomEvent('tflex:sign-button'))`, and the Export-to-Word tool — all yield React #310 and a black-unmounted UI. The `useBackdropClose` hook is placed after `if (!open) return null;` in all 21 dialogs above; before the B3/B6 change these dialogs used a plain non-hook `closeOnBackdrop` (e.g. `git diff` on SignatureManagerModal.tsx shows `useRef` now added after the early return).
- qa: re-verified on installed v1.7.7 (reinstalled 11:24 PM, exe 23:24 newer than all src) via e2e/retests/release_gate_117_verify.spec.cjs (10 tests, all PASS). Source-level check: all 21 dialogs now place `useBackdropClose` BEFORE the `if (!open) return null;` guard (verified by scanning each dialog: hook line < early-return line). Runtime: opened Sign, DOCX, Crop, Insert and OCR dialogs in sequence — each mount (`.modal-backdrop` present, app not black) and `pageerror` captures ZERO React #310/#520 hook errors across the whole run. The entire DEF-117-blocked surface is now exercisable and verified: B1 (sign re-click shows select handles), B3/B6 (DOCX + Insert stay open on a text-selection drag-out; a genuine backdrop click still closes), B4 (OCR suspects panel renders as a full-width TOP BAR at z-index 40 above the tools palette 30, y=145, not behind it), B7 (insert blank after page 1 -> 35 pages, no duplicate, blank at rank 2, save+reopen valid), B8a (crop mode/page switch keeps the canvas node stable, no opacity-0 flash, no jump to 612x792), B8b (per-page crop crops only page 1 — toast "Cropped 1 page." + page 1 renders smaller than unadjusted pages 2/3), B8c (undo after a page op visually reverts), B10 (maximize/restore icon distinct from minimize). CLOSED.

## DEF-120: Undo (Ctrl+Z) after a page-mutating op does not refresh the pdf.js proxy — visual stays stale

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf.
3. Rotate page 1 via the toolbar "Rotate clockwise" button; confirm the page paints landscape.
4. Press Ctrl+Z.

Expected: The page visually reverts — the pdf.js proxy repaints the pre-rotate state (portrait).
Actual: Before the fix, the engine's undo reverted the model but the renderer's pdf.js `doc` proxy was never rebuilt, so the canvas kept painting the PRE-undo bytes and the page stayed stale.

Root cause: `App.onUndo`/`onRedo` updated the engine UI mirror (`setEngineUiFor`) but never called `refreshDocProxyFor`, so the visible page did not reflect the reverted engine state.

History:
- qa: opened (B8c ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). The undo-refresh mechanism is now exercised: rotate page 1 -> `engineState.rotations[0]` 0 -> 1 and the page canvas swaps 1156x1496 -> 1496x1156 (proxy refreshed, paints rotated page); Ctrl+Z -> `rotations[0]` back to 0, `modified` false, `canRedo` true, and the canvas swaps back to 1156x1496 (proxy refreshed, visual reverts). The `onUndo`/`onRedo` handlers now invoke `refreshDocProxyForRef.current` after `setEngineUiFor` (pinned by test/unit/renderer/bugB8c_undoRedoProxyRefresh.test.ts). NOTE: the named crop/delete variants are separately blocked by DEF-117 (their dialogs cannot open); the undo proxy-refresh itself is verified and working. CLOSED.

## DEF-119: Max/restore titlebar icon is identical to the minimize icon when the window is maximized

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf.
3. Click the maximize window control, then inspect the restore (maximize) button glyph vs the minimize glyph.

Expected: When maximized, the button's glyph is a distinct "restore down" overlapping-squares icon (and the tooltip reads "Restore window"), NOT the two inward arrows used by minimize.
Actual (pre-fix): `maximized ? Minimize2 : Maximize2` reused the minimize icon when maximized, so the two window controls were visually identical.

Root cause: TitleBar.tsx picked `Minimize2` for the maximize button while maximized, duplicating the minimize glyph.

History:
- qa: opened (B10 ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). `[data-window-maximize]` now renders `Copy` (two overlapping squares) when maximized — `maximized maxLabel= Restore window`, and `minimize svg outerHTML !== maximize svg outerHTML` (`distinct=true`). When restored it renders `Maximize2` with label "Maximize window" and also differs from minimize. Verified programmatically via the titlebar controls and visually. CLOSED.

## DEF-118: Committed add-box text is not selectable/movable in Edit mode; editor does not preview the chosen font

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf, click the Edit toggle, then the "Add box" tool.
3. Drag/place a text box, type "MOVABLE BOX 999" and press Ctrl+Enter to confirm.
4. Switch back into the box tool and try to drag the committed box; also pick Times/Courier in the editor before committing.

Expected: The committed box renders its full text live and is draggable/movable in Edit mode; the Font dropdown live-updates the editor textarea's fontFamily.
Actual (pre-fix): `engine.addTextBox` baked the box into the PDF and the renderer kept no registry, so the mouse could not drag a committed box (and it also did not render live, DEF-113).

Root cause: No per-tab text-box registry. The "box" tool now renders committed boxes as selectable `.edit-box` surfaces with corner handles; pointerdown selects and starts a move drag, pointermove dispatches `set-text-box-rect`.

History:
- qa: opened (B5 ground-truth)
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). Committed box renders full text live (`.textLayer` contains "MOVABLE BOX 999"; full string, no truncated fragment). In the box tool the committed box is a `.edit-box` surface that MOVES when dragged: rect left/top 428/395 -> 548/495 (moved=true, size 240x140 unchanged, clamped to page). Font picker live: selecting Times makes the editor textarea `fontFamily = "Times New Roman", Times, serif` and Courier makes it `"Courier New", Courier, monospace` before commit (the Font dropdown feeds the textarea's computed fontFamily live). Pinned by test/unit/renderer/bugB5_textBoxMove.test.tsx. CLOSED.

## DEF-116: Edit-text leaves the original run in the PDF — old title remains searchable/selectable after the edit

- Status: REJECTED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.6 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click the "TFlex Technical Report" title run so the inline editor opens pre-filled.
4. Replace the text with "ZZZ REPLACEMENT TEXT 123" and press Ctrl+Enter to confirm.

Expected: The edited run is replaced — the old "TFlex Technical Report" text is removed from the document, so it is no longer selectable/searchable/copyable and no longer present in the saved file.
Actual: The canvas paints the NEW title (DEF-108 is fixed), but the engine edits by MASKING the old run with a white rectangle and DRAWING the new text on top (`engine._editTextRunImpl`). The original "TFlex Technical Report" string stays in the PDF content stream; after the proxy refresh the live `.textLayer` still contains a visible-size stale span for "TFlex Technical Report" (x594,y327,w461,h45) at the SAME location as the new span (x594,y325,w515,h36). Selecting/copying the title area surfaces the hidden old title, and the saved PDF still contains the original run. (The app's own search index is rebuilt from the proxy and does NOT match the old title, so in-app Ctrl+F is correct; the issue is the document's own content.)
Root cause: `_editTextRunImpl` (engine.ts:1645) masks the old rect with `page.drawRectangle({color: rgb(1,1,1)})` instead of removing the original glyphs; pdf-lib's drawRectangle does not delete the underlying text operators, so pdf.js still extracts the masked old run into the textLayer.
Screenshot: screenshots/def-108-after-commit.png (shows new title live; the stale old-title span is in the textLayer), also screenshots/probe-108-search-old.png

History:
- qa: opened (discovered during DEF-108 retest on installed v1.7.6)
- orchestrator: REJECTED - pdf-lib has no content-stream tokenizer; stripping old text operators is a hand-rolled ~500-line high-risk rewrite. Mask-and-redraw is visually correct (old text hidden, only exposed by selection/extraction). Documented as v1 limitation; native dependency (qpdf/pdfcpu) is a future-phase item.

## DEF-115: Crop box adjustment flashes a larger crop-window artifact on commit

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Open the Tools palette -> "Crop pages" and wait for the crop editor to render the page.
4. Drag the SE corner handle of the crop box so the box grows, then release (commit).

Expected: The crop box updates smoothly with no visual flash; the page preview stays scaled and painted continuously.
Actual: Immediately after the mouseup commit the crop editor REMOUNTS — the page canvas disappears (opacity flashes to 0) and its CSS size jumps to the full unscaled 612x792 for one frame (a "larger crop window" artifact) before settling to the correct ~360x466. Verified by sampling post-commit frames: frame 0 yields canvasTag=null (new canvas node), canvasOpacity=0, canvasRect 612x792; frame 1+ settle to opacity 1, rect 360x466.
Root cause: CropPagesDialog.tsx line 268 renders `<CropEditor key={...currentBox.x-y-width-height}>`; the key embeds the box coordinates, so every committed box change unmounts/remounts CropEditor, recreating the canvas (previewReady false -> opacity 0) and briefly leaving the canvas at its intrinsic 612x792 CSS size before the render effect sets the scaled rect.
Screenshot: screenshots/gt-bug8-post-0.png (also gt-bug8-crop-open.png, gt-bug8-before-mouseup.png, gt-bug8-crop-after-drag.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Drag SE handle then release; canvas keeps `data-canvas-tag=CANVAS-A` across all 6 post-commit frames (no remount), computed opacity stays `1` (no 0-flash), canvas rect stays 360x466 (never jumps to the intrinsic 612x792). `CropEditor` key is now mode+page only. CLOSED.

## DEF-114: Insert blank page with "end"/empty position lands at the FRONT, not the end

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf (34 pages).
3. Open the Tools palette -> "Insert pages".
4. Leave mode as "Blank page" and type `end` into the "Insert at page" field (the field help says `end` = append; clearing the field maps to the same sentinel). Click Insert.

Expected: The blank page is appended as the LAST page (page 35); the existing 34 pages keep their order.
Actual: The blank page is inserted as the FIRST page of the visible order. `tflexDiagnostics().engineState.pageOrder` becomes `[34,0,1,2,…,33]` (the newly added blank origIdx 34 at index 0), and the view/rail render a scrambled result (blank page at the front, two blank-looking thumbs, a mislabeled "Page N"). Note the engine page count is correct (34 -> 35); this is NOT a literal two-page duplication, but an incorrect placement that scrambles the document. Inserting with the DEFAULT numeric position ("35") works correctly (pageOrder ends with 34).
Root cause: InsertPagesDialog.tsx maps `end`/empty to `position:-1` ("appended at end"), but onInsertPagesConfirm (App.tsx:3019) passes that value straight to `engine.insertBlankPage(docId, position, …)`; engine `_insertBlankPageImpl` (engine.ts:1215) treats `afterIndex = -1` as "insert before the first page" (`insertAt = 0`). Two different -1 contracts collide.
Screenshot: screenshots/gt-bug7-after.png (also gt-bug7-before.png, gt-bug7-insert-dialog.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Blank mode + position `end`: engineState pageCount 34 -> 35, modified=true, pageOrder=[0,1,...,33,34] — first=0 and last=34 (the new origIdx-34 blank page is the FINAL element, not the front). `_insertBlankPageImpl` now maps afterIndex<0 to `doc.order.length` (append). CLOSED.

## DEF-113: Add Box text is not rendered in the live view after confirming

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Click the Edit toggle, then the "Add box" tool.
4. Drag on the page to place a text box, type "HELLO BOX ADDED 456" in the editor and press Ctrl+Enter to confirm.

Expected: The committed text box renders its text on the page in the live document view.
Actual: The editor closes and the engine `modified` flag flips to true, but the new text is NOT rendered — the pdf.js textLayer contains no element with "HELLO BOX ADDED 456" and the page canvas still shows the pre-edit content. The edit only becomes visible after a save/reopen (the engine wrote it, the live view is stale).
Root cause: App.tsx `handleAddTextBox` (line 1785) calls `engine.addTextBox` + `noteOpApplied` but never rebuilds the renderer pdf.js `doc` proxy (unlike the OCR path which calls `refreshDocProxyFor` in `onOcrConfirm`). The DocumentView continues to render the pre-edit document.
Screenshot: screenshots/gt-bug5-after-commit.png (also gt-bug5-box-editor-open.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). The proxy IS now rebuilt (handleAddTextBox calls refreshDocProxyFor), so the box text DOES appear in the live canvas — but only "HELL" of the committed "HELLO BOX ADDED 456" renders. Committed textarea value was verified as the full "HELLO BOX ADDED 456"; the `.textLayer` after commit contains a single span "HELL" (visible SIZE_BIG, x548,y568,w161,h64) and no span with the full string; the DOM has no element with the full text; engine `annotations=[]`. Reproduced with BOTH a small box (200x214 CSS) and a large box (800x388 CSS) — always "HELL". Root cause is now the default font size for a new box, `EditInlineEditor`/`EditOverlay` `size = Math.round(textTarget.rect.height * 0.8)` (capped at SIZE_MAX=72), which is enormous for a box whose height is large; `wrapTextToWidth` hard-breaks "HELLO" -> "HELL"+"O" when "HELLO" exceeds the box width, and the box height only fits that first fragment line, SILENTLY DROPPING the rest of the user's text. Content is lost in the committed box. REMAINS OPEN (severity raised to HIGH — committed content silently dropped).
- qa: re-verified on installed v1.7.6 (rebuilt 17:29). Add box in report.pdf, type "HELLO BOX ADDED 456" + Ctrl+Enter: the editor closes (count=0) and the FULL committed text renders live — the `.textLayer` contains a single span "HELLO BOX ADDED 456" (boxTextVisibleFull=true, joined=true, truncatedOnly=false; no lone "HELL" fragment). Screenshot screenshots/def-113-after-commit.png shows the full string on the page at a normal legible size. The oversized default box font is gone — the box no longer hard-breaks and drops content. CLOSED.

## DEF-112: OCR does not make form field values (e.g. "John Doe") searchable

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open form.pdf (the page visibly shows a "John Doe" text field, plus "Engineering" and a listbox with "TypeScript" highlighted).
3. Open the Tools palette -> "Recognize text (OCR)", set scope to "Current page", click "Recognize text".
4. Wait for completion, then try to search (Ctrl+F) for "John Doe".

Expected: OCR makes the form's field value "John Doe" searchable/selectable.
Actual: OCR completes and the rebuilt textLayer gains the static content ("JavaScript", "Node.js", "React", "PDF Spec") but NOT the form field values — after-OCR textLayer = [ "TFlex Application Form", "TFlex", "Application", "Form", "JavaScript", "Node.js", "React", "PDF", "Spec" ]; `hasJohnDoe=false`; searching "John Doe" returns 0 hits. "John Doe", "Engineering" and "TypeScript" stay unsearchable.
Root cause: src/renderer/pdf/ocrRasterize.ts `rasterizeOnePage` (line 134) renders via `pdfPage.render({ canvasContext, viewport })` with pdf.js defaults (no `renderInteractiveForms`), so interactive AcroForm field-value appearance streams are never painted into the OCR PNG; tesseract therefore never sees "John Doe" and never writes it into the invisible text layer.
Screenshot: screenshots/gt-bug4-form-before-ocr.png, gt-bug4-after-ocr.png, gt-bug4-search-john-doe.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). `window.tflex.engine.getFormFields` returns 8 fields INCLUDING `applicant_name` = "John Doe" (and `department`="Engineering"), and the FormsOverlay renders `[data-form-field="form-0-applicant_name"]` with value "John Doe" — so the renderer form state DOES hold the value and OCR seeds it into AnnotationStorage (seedAnnotationStorage) with `annotationMode: AnnotationMode.ENABLE_STORAGE`. Yet after OCR the `.textLayer` is ["TFlex Application Form","TFlex"," ","Application"," ","Form","[]","JavaScript","TypeScript","Node.js","React"] — `hasJohnDoe=false`; searching "John Doe" returns 0 hits. The form-field appearance is still NOT baked into the OCR raster. REMAINS OPEN.
- qa: re-verified on installed v1.7.6 (rebuilt 17:29). Filled applicant_name with "John Doe" (renderer form state confirmed hasJohnDoe=true), ran OCR current page. After OCR the rebuilt `.textLayer` contains "John"," ","Doe" (joined "John Doe"), and Ctrl+F "John Doe" returns searchHits=1, searchIndexProgress built=1/total=1, search status "1 of 1". Screenshot screenshots/def-112-search-john-doe.png shows the search bar with "John Doe" and "1 of 1". The e2e assertion was updated to use `window.tflexDiagnostics().searchHits` (>=1) instead of the old per-span regex, because the textLayer splits "John"/"Doe" across spans. CLOSED.

## DEF-111: DOCX export ignores the selected page range and exports ALL pages

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf (34 pages).
3. Open the Tools palette -> "Export to Word (.docx)".
4. Set the "Page range" field to `1` (a single page), then click "Export".

Expected: The resulting .docx contains only page 1 (0 page breaks, one image/paragraph).
Actual: The export succeeds but produces a 34-page .docx — the extracted word/document.xml has 33 `<w:br w:type="page"/>` breaks (34 pages) and 34 `<w:t>` text runs; the file is byte-identical in size (56376) to the all-pages default export. The page range is ignored.
Root cause: src/main/services/engine.ts `_createDocxFromDocImpl` (line 1461) iterates `for (let vi = 0; vi < doc.order.length; vi++)` over the ENTIRE visible document (all `doc.order` pages), and only consults the passed `entries` to decide text-vs-image per page — it never uses `entries` to restrict the page set. The dialog's `runEngineExport` does limit `entries` to the range, but the assembly step re-expands to the whole doc.
Screenshot: screenshots/gt-bug3-docx-dialog.png, gt-bug3-docx-after-export.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Exporting page range "1" on report.pdf produces a real .docx (will-download state=completed, 2607 bytes, valid OOXML PK) whose extracted word/document.xml contains 0 `<w:br w:type="page"/>` page-break marks (exactly 1 page) and 0 `<w:t>` text runs (one image) — no `inner` error, dialog no error. `_createDocxFromDocImpl` now respects `entries` as the page set. CLOSED.

## DEF-110: Edit context-window bar press registers as an outside click and closes the editor

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click a text run so the inline editor opens (textarea pre-filled).
4. Press (mousedown/up) on a NON-focusable label inside the editor's toolbar bar (e.g. the "Font" label span), WITHOUT clicking outside the editor.

Expected: The editor stays mounted — a click on its own chrome is not an outside click. Context windows should only close on an explicit close/Cancel.
Actual: Pressing the "Font" label span closes the editor (`[data-edit-editor]` count -> 0); it is treated as an outside click. The textarea's onBlur fires because focus leaves the textarea to the body (relatedTarget null), the blur guard only bails when the new focus target is inside `.edit-inline-editor`, and a non-focusable label has no focusable target, so it commits/cancels and unmounts.
Root cause: EditInlineEditor.tsx `onTextareaBlur` (line 133) + the toolbar bar's non-focusable labels. There is no text-drag-outside / bar-press guard equivalent to InsertPagesDialog's B17 `backdropDownRef`. (Note: a text highlight-drag that starts inside the textarea and releases OUTSIDE the editor did NOT close it in the same test — the bar chrome press is the deterministically-reproducing path.)
Screenshot: screenshots/gt-bug6-after-bar-click.png (also gt-bug6-editor-open.png, gt-bug6-after-drag-outside.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Pressing (mousedown/up) on the editor's own "Font" label (non-focusable chrome) leaves `[data-edit-editor="edit"]` mounted (count=1 after press); a positive control on the explicit Cancel button closes it (count=0). The editor now guards bar chrome via `insidePressRef` set on the editor's `onPointerDown`. CLOSED.

## DEF-109: Edit inline editor size (arrow/spinner) control is inert

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool, and click a text run so the inline editor opens.
3. Focus the "Font size (pt)" number input. Press the up-arrow key, and also click the native spin-arrow zone.

Expected: The size value increments via the keyboard up-arrow and the spinner arrows.
Actual: The value stays at 19 after ArrowUp and after a spin-arrow click (`before=19, afterArrowUp=19, afterSpinClick=19`); the only way to change it is to select-all and type a new number (fill('48') -> 48). The editor stays open after these interactions (so it is not the outside-click path).
Root cause: EditInlineEditor.tsx line 214 sets `onMouseDown={(e): void => e.preventDefault()}` on the size `<input type="number">` (the Bug-9 focus guard). preventDefault on mousedown suppresses the native spinner/arrow auto-increment (and Chromium's arrow-up on a focused number input), so the arrows do nothing; direct typing bypasses mousedown and works.
Screenshot: screenshots/gt-bug2b-size-control.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Focus the size input: ArrowUp increments 19 -> 20; the native spinner up-arrow increments 19 -> 20 -> 21 when clicked on the top-right hit zone; the editor stays mounted throughout. The `onMouseDown preventDefault` was removed from the number input. CLOSED.

## DEF-108: Edit-text confirm does not render the updated text in the live view

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click the "TFlex Technical Report" title run so the inline editor opens pre-filled.
4. Replace the text with "ZZZ REPLACEMENT TEXT 123" and press Ctrl+Enter to confirm.

Expected: The title on the page updates to the new text in the live document view.
Actual: The editor closes and the engine `modified` flag flips to true, but the live pdf.js textLayer still reports the old run ("TFlex Technical Report" present, "ZZZ REPLACEMENT TEXT 123" absent). The canvas continues to paint the original text; the edit only appears after a save/reopen.
Root cause: App.tsx `handleEditTextRun` (line 1759) calls `engine.editTextRun` + `noteOpApplied` but never rebuilds the renderer pdf.js `doc` proxy (contrast the OCR path, `onOcrConfirm`, which calls `refreshDocProxyFor`). The DocumentView keeps rendering the stale pre-edit proxy.
Screenshot: screenshots/gt-bug2a-before-commit.png, gt-bug2a-after-commit.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Edit the title to "ZZZ REPLACEMENT TEXT 123" + Ctrl+Enter: the editor closes (count 0), `modified` = true, the canvas paints the NEW title, and the live `.textLayer` contains "ZZZ REPLACEMENT TEXT 123" (newVisible=true). `handleEditTextRun` now rebuilds the pdf.js proxy via `refreshDocProxyFor`. CLOSED. (NOTE: the original masked run still remains as hidden text in the PDF/textLayer — filed separately as DEF-116.)

## DEF-107: OCR suspects panel overlaps annotation/shapes toolbar (B14)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open the scanned.pdf sample.
3. Open the Tools palette and choose "Recognize text (OCR)".
4. Set scope to "Current page" and click Recognize.
5. Wait for the OCR suspects panel to open on the right.

Expected: The OCR suspects panel opens in its own space and does not overlap the annotation/shapes toolbar (`.ann-toolbar`).
Actual: The panel (x1162-1442, y45-904) overlaps the annotation/shapes toolbar (x220-1442, y89-129) by 280x40 px; the toolbar's right portion (Shapes group area) sits behind/in the panel. Verified by a true 2D intersection check across the OCR-suspects panel and `.ann-toolbar`. (Note: the panel correctly does NOT open on an empty tab and does NOT persist to a new tab.)
Screenshot: screenshots/b14-precise-overlap.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). OCR suspects panel now opens at y=145, below the `.ann-toolbar` (y89-129, h40); true 2D intersection check gives overlapH=0, overlaps=false. CLOSED.

## DEF-106: DOCX export crashes with "Cannot read properties of undefined (reading 'inner')" (B12)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Open the Tools palette and choose "Export to Word (docx)".
4. In the "Export to Word" dialog leave the defaults (Page range 1-34, Resolution DPI 150) and click "Export".

Expected: The export completes without error and produces a .docx.
Actual: The dialog shows a red status message "DOCX export failed: Cannot read properties of undefined (reading 'inner')" and no document is produced. Reproducible on every run.
Screenshot: screenshots/bug12-after-export.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). DOCX export completes with no error (dialog status null, no `inner` error, no console/page errors) and produces a real non-empty .docx — captured via main-process `will-download`, state `completed`, size 56376 bytes, valid OOXML ZIP (PK magic). CLOSED.

## DEF-105: Edit mode click on a text run does not open the text editor (B6)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Click the Edit toolbar toggle, then the "Edit text" tool.
4. Hover over a text run (e.g. the "TFlex Technical Report" title). A dashed hover border and "Click a text run to replace it" hint appear.
5. Click that text run.

Expected: A text editor (textarea) opens loaded with the run's text so it can be edited.
Actual: No editor appears. After the click, `[data-edit-editor="text"]`, `[data-edit-textarea]`, `.edit-overlay`, and any input/textarea are all absent; `activeTool` stays null. The hover affordance shows but the click is inert.
Screenshot: screenshots/b6-click-after.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). Edit-mode click on a text run opens the text editor pre-loaded with that run's text ("TFlex Technical Report"), and the editor is STILL present after a 3s wait — it does not auto-close. CLOSED.

## DEF-104: Sticky note text renders vertically, not co-located inside the note (B4/B5)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Select the Note tool and click a point on the page.
4. In the note editor type "Hello sticky note" and Confirm.
5. Observe the placed sticky note.

Expected: The note text renders horizontally, wrapped and co-located inside/with the note marker.
Actual: The text is stored and the marker is clickable (opens the pre-filled editor), but the text renders as a narrow vertical column (`.ann-note-text` ~48px wide x ~431px tall) — one character per line — beside the marker rather than as wrapped text in a note container. Violates "text visible inside / icon+text co-located".
Screenshot: screenshots/bug4-committed-note.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). Note text now renders horizontally, wrapped (210x48 px) and co-located inside/with the note marker; clicking the note icon opens the pre-filled editor (editorOpenAfterClick=true). CLOSED.

## DEF-103: After signing, Text Box/Rectangle/Circle tools stop placing annotations (B2)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.5 build).
2. Open report.pdf.
3. Arm the Sign tool (Type "QA Suite", Save, pick the saved signature).
4. Click a point on the page and Confirm on the floating action bar to place the signature (Sign mode exits, ghost gone).
5. Click the Text Box tool (it activates, aria-pressed=true), then click another point on the page.

Expected: A Text Box action bar / editor appears so the user can type; Rectangle and Ellipse also place normally afterwards.
Actual: The tools activate but clicking the page creates nothing — no textbox bar, no editor, no committed annotation, no lingering signature pending state. Verified via isolation: a Text Box single-click creates the bar on a fresh doc, but does NOT after a Sign placement (bar=1 fresh vs bar=0 after sign). Rectangle/Ellipse clicks likewise place nothing.
Screenshot: screenshots/b2-after-sign-textbox.png

History:
- qa: opened
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). After a Sign placement + confirm, Text Box places (bar=1, editor=1, aria-pressed=true), and Rectangle (.ann rect=1) and Ellipse (.ann ellipse=1) also place; engine annotations = ["rect","ellipse"]. Sign mode exits (aria-pressed false). CLOSED.

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
