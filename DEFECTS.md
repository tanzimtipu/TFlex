## DEF-175: Annotation color palette popover is INVISIBLE and click-through in the frosted theme - the frosted backdrop-filter on .ann-toolbar traps the popover's z-index under the page; clicking where the palette should be fires the armed ink tool into the document instead

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 16 (found during the 1.10.1 frosted-rebalance visual acceptance gate; root cause predates the rebalance - verified identical on the pre-rebalance 1.10.0 styles.css via a stash/rebuild/probe/restore experiment, so this is NOT a rebalance regression, but it breaks a core control in the DEFAULT theme and must block release until fixed)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; frosted is the default theme).
2. Open the report.pdf sample.
3. Arm the Ink tool in the annotation toolbar and click the orange color swatch (.ann-color-swatch-main) to open the color palette popover.
4. Look for the palette panel that should hang below the swatch (Built-in swatches / Your colors / Custom pad + hue slider + hex input).

Expected: the color palette popover opens as a visible floating sheet over the page and its swatches/pad/inputs are clickable (this is exactly what the LIGHT theme shows - see screenshots/motion-color-popover.png from the motion-phase era for the correct rendering).

Actual: NO palette is visible anywhere. The element exists in the DOM with a 278x550.4 bounding box (.color-palette at x=414.7, y=144.7), yet document.elementsFromPoint at EVERY one of the 48 candidate points inside that box returns the PAGE's annotation-layer svg as topmost - the popover paints and hit-tests UNDER the opaque page canvas. The full element stack at the palette's own scan point is: svg (annotation-layer) > .annotation-layer > .textLayer > canvas > .pdf-page > .page-slot > .document-content > .document-scroller > BUTTON.color-swatch (the palette's own swatch, index 8 of 22). Clicking where the palette should be therefore lands on the ACTIVE annotation layer: with ink armed, a press+drag at that point DRAWS AN INK STROKE INTO THE USER'S DOCUMENT instead of interacting with the palette (verified in probe: after mouse.down+move from the spec scan point, the palette unmounts via click-outside dismissal while the page received the press). Functional consequence: color picking is unusable in the frosted theme (the default). Note e2e flows that use Playwright .fill() on the hex input still pass (fill bypasses hit-testing) which is why sweep A2 stays green while click-based 147d fails - the surface is phantom, not absent.

Mechanism: the frosted-only rule block (styles.css :root[data-theme="frosted"] .ann-toolbar, line ~504) applies backdrop-filter: blur(18px) saturate(1.15) to .ann-toolbar. backdrop-filter makes the toolbar a STACKING CONTEXT and the CONTAINING BLOCK for its absolutely-positioned descendants, so .color-popover's z-index: 50 only ranks INSIDE the toolbar's context; the toolbar (z auto, early in DOM) then stacks below the later-sibling .document-scroller, burying the entire toolbar subtree - popover included - under the page. Dark/light themes carry no backdrop-filter on the toolbar, so the popover escapes to the root stacking context and renders correctly there (theme-dependent, matching the light-theme evidence). The same trap does NOT bite the theme dropdown popover only because it is short enough to never overlap the document area.

Screenshot: screenshots/def-147-1716-color-palette-open.png (current build, frosted: "palette open" asserted by DOM bbox yet nothing visible in the frame); screenshots/motion-color-popover.png (light theme, correct visible palette for contrast); screenshots/probe-147d-palette-drag.png + probe-147d-final-state.png (probe evidence)

History:
- qa: opened (evidence: live probes on the DEV build v1.10.1 - 48-point elementsFromPoint scan all returning the page stack, click-through press unmounting the palette via click-outside, stash/rebuild experiment reproducing the identical failure on pre-rebalance 1.10.0 styles.css; the three failing 147d keeper specs (def_147_verify_1.7.15/16/17 147d) are symptoms of this defect, not test bugs). Fix direction for frontend-dev: portal .color-popover to the app root (outside the blurred toolbar subtree), or blur a non-ancestor inner layer of the toolbar, or otherwise give the popover a stacking escape; the popup must paint and hit-test above the page in ALL themes.
- qa: CLOSED (retested the portal fix on the DEV build v1.10.1 after a fresh npm.cmd run build; launchApp with no executablePath). (1) NEW KEEPER SPEC e2e/retests/def_175_retest.spec.cjs (1/1 green, 5.5s) re-runs the ORIGINAL repro: frosted default theme asserted -> arm Ink -> open .color-palette (same bbox as the defect, x414.7 y144.7 278x550) -> elementsFromPoint at the palette center now returns an element INSIDE the palette as topmost (was: svg.annotation-layer topmost at all 48 scanned points) -> real mouse click on built-in swatch #3: palette STAYS OPEN (was: unmounted via click-outside dismissal), armed ink color follows to #ef4444 (data-color-current), engine annotations 0 before / 0 after and zero rendered .ann-ink (was: a press+drag drew an ink stroke into the user's document). Screenshots/def-175-retest-palette-open.png (palette visibly floating OVER the page: Built-in 9 swatches / Your colors / Custom pad + hue slider + hex + RGB + Add all rendered) + def-175-retest-after-swatch-click.png (clicked swatch ring-selected, toolbar main swatch orange -> red, page clean, no ink artifact). (2) SYMPTOM SPECS: the three 147d keeper specs (def_147_verify_1.7.15/16/17 147d) all pass 3/3 in 19.0s - palette movable via real drag (hit-testing works). (3) REGRESSION around the shared code path (toolbar popovers / frosted stacking): frost_verify 2/2 (theme dropdown popover still opens + arrow-key navigates in frosted; rebalance alpha contract toolbar 0.80 / rail 0.82 / dialog 0.92 holds); full standard e2e suite re-run: 237 passed / 1 failed, the single failure triaged FLAKE (DEF-134 keeper in gt_verify_1711 - Save->saved-pick race: failed 2x then passed the identical-code re-run; verbatim no-wait probe green with a visible Confirm/Cancel/Delete action bar screenshot; sibling sig specs BUG-1, B1, S1 all green in the same run); A2 custom-hex color round-trip sweep green in the same run.



## DEF-174: Reopened /Highlight renders as a heavy near-opaque orange block - PDF.js paints the baked annotation (no /OP, no /AP) full-opacity on the canvas, then the overlay draws it a second time at 0.35

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the DEF-173 v1.10.0 retest; the reopen half of the original defect's scope note - "the saved native /Highlight renders translucently ... so save/reopen is correct" - is disproven by measurement)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open the report.pdf sample (34 pages).
3. Arm Highlight and drag across the title "TFlex Technical Report" on page 1; release. In-session render is the correct pale 0.35 wash (DEF-173 fix).
4. Save As to a temp file; close the tab; reopen the saved file; scroll to page 1.

Expected: the reopened highlight looks like the in-session render - a translucent highlighter wash (fill-opacity 0.35) over the title, matching DEF-173's Expected ("the saved native /Highlight annotation behaves exactly this way when re-rendered").

Actual: the reopened highlight renders MUCH darker than in-session - a saturated near-opaque orange block. Measured cause, two stacked render sources: (1) the baked /Highlight dict carries NO /OP and NO /AP (keys: /Type /Subtype /Rect /C /TFlexColor /Contents /QuadPoints - annotations.ts:1172-1192 pushes only QuadPoints), so PDF.js synthesizes a full-opacity multiply-blend appearance on the page canvas: canvas pixel sampling under the highlight bbox returns 224,122,45 (= #e07a2d exactly, 14607 px dominant) after reopen vs pure white+black glyphs in-session (control: zero orange on canvas before save); (2) the app's SVG overlay then draws the re-imported annotation a SECOND time at fill-opacity 0.35 on top of the canvas block. Hiding the overlay rect leaves the heavy orange block fully visible (canvas-only evidence). This is the same defect class the backend itself documents for rect/ellipse (annotations.ts:1194-1196: "/IC ... would paint an opaque solid block over page text - the translucent fill is expressed in the /AP appearance stream via ca") - highlight got neither the /AP nor an /OP. Even with /OP 0.35 baked, the overlay's second draw would leave reopen at ~0.58 vs 0.35 in-session; the double-render needs a decision (skip overlay for canvas-rendered native annots, or DISABLE annotationMode on the canvas render) in addition to the /OP-or-/AP fix. The saved FILE itself is correct (native /Highlight + QuadPoints re-parsed with pdf-lib; annotation survives, nothing lost) - this is the render path only.

Screenshot: screenshots/def-173-retest-reopen-page1.png (reopened: heavy block vs in-session pale wash in def-173-retest-page1.png), screenshots/def-173-diag-reopen-overlay-hidden-page.png (overlay rect hidden - canvas alone still paints the near-opaque block)

History:
- qa: opened (diagnostic evidence: e2e/retests/def_173_reopen_diag.spec.cjs - canvas pixel samples in-session vs after reopen, baked dict key dump, overlay-hidden screenshots)
- qa: CLOSED (retested the two-part fix on the DEV build v1.10.0 - app.getVersion() 1.10.0, launchApp with no executablePath; dist REBUILT first because it predated the fix source (dist 6:20PM vs annotations.ts 6:48PM / AnnotationOverlay.tsx 6:52PM), verified the bundle contains HIGHLIGHT_OPACITY=0.35 -> dictEntries.push(["CA", PDFNumber.of(...)]) and the liveAnnTextIds suppression). (1) PRIMARY REPRO FIXED, exact original steps: report.pdf -> arm Highlight -> drag across "TFlex Technical Report" on page 1 -> Save As -> close tab -> reopen -> page 1. (2) IN-SESSION unchanged from DEF-173: mid-drag preview fillOpacity 0.35, committed rect 0.35 on screen, disarm via re-click leaves 0.35 (screenshots/def-173-retest-page1.png). (3) SAVE: pdf-lib re-parse of the saved bytes finds /Highlight with /QuadPoints (8 numbers) + /Rect + /CA 0.35 (was: no /CA) - e2e/retests/def_173_verify_1.10.0.spec.cjs. (4) REOPEN renders ONCE: engine re-imports the highlight (kinds=[highlight]) and the overlay rect is GONE (0 rect.ann-highlight in the pane - parsed-from-file suppression); canvas pixel sample under the recorded highlight bbox returns dominant rgb(244,209,182) x14607 px = exactly 0.35 x #e07a2d Multiply over white (predicted 244,208.5,181.5), NOT the old full-opacity 224,122,45, with 3582 dark glyph pixels proving the title stays readable; visual: the reopened wash (screenshots/def-174-retest-reopen-page1.png) is near-identical to in-session, no heavy block, no ~0.58 double-render. e2e/retests/def_173_reopen_diag.spec.cjs additionally asserts the in-session canvas control (zero orange before save), the baked /CA 0.35 dict keys, and the reopened pale wash (screenshots/def-174-diag-reopen-pale-wash-page.png); both stale DEF-173 specs were updated to assert the NEW behavior (no overlay rect after reopen + pale canvas wash) and are green (1/1 each). (5) MARKUP REGRESSION, explicitly left alone kinds verified via new spec e2e/retests/def_174_markup_regression.spec.cjs (2/2 green) + new fixture test-fixtures/squiggly-native.pdf: Underline + Strikethrough drawn in-session keep SOLID overlay strokes (stroke-opacity 1, width 1.4px), save as native /Underline + /StrikeOut with /QuadPoints and NO /CA (fix is highlight-only), and after reopen both re-import AND still draw their solid overlay strokes (suppression does not leak to stroke kinds); parsed /Squiggly (no toolbar button - parse/save native kind only) re-imports from the fixture and renders canvas-only (3693 red pixels under its bbox, 0 overlay elements - unchanged, no overlay case exists for squiggly). Screenshots/def-174-markup-reopen-page1.png, def-174-squiggly-page1.png.

## DEF-173: Committed highlight annotation renders as an OPAQUE orange block - the highlighted text is unreadable in-session

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the pre-release v1.9.1 frosted-acrylic + physics-motion visual verification sweep, Phases A-D)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath; frosted default theme).
2. Open the report.pdf sample (34 pages).
3. Arm Highlight in the annotation toolbar and drag across the title text "TFlex Technical Report" on page 1; release the mouse.
4. Press Escape to disarm the highlight tool.
5. Observe page 1.

Expected: the committed highlight renders as a translucent highlighter wash over the quads - the highlighted text stays readable underneath, with only the color marking it (the saved native /Highlight annotation behaves exactly this way when re-rendered by PDF.js).

Actual: the committed highlight renders as a FULLY OPAQUE orange block (#e07a2d) that completely hides the highlighted text - "TFlex Technical Report" is invisible under it, only descender tips peek out below the block edge, defeating the entire purpose of a highlight. The block persists after the tool is disarmed. Diagnostics record of the annotation: {"kind":"highlight","page":1,"color":"#e07a2d","content":"TFlex Technical Report"}. Mechanism: the committed highlight is drawn in the in-session SVG overlay as <rect class="ann-highlight" fill="#e07a2d"> (AnnotationOverlay.tsx ~line 1424) with no fill-opacity/alpha - styles.css contains only a pointer-events rule for .ann-highlight (line 3214) and no .ann-preview rule exists, so the drag preview rect (MarkupPreviewRect) is equally opaque. SCOPE NOTE: the SAVE path is NOT affected - the backend bakes a native PDF /Highlight annotation with QuadPoints (src/main/services/annotations.ts:1172-1191), which renders translucently in PDF viewers, so save/reopen is correct; the opacity bug is in-session overlay rendering only (which is also what makes it inconsistent with the app's own post-save re-render).

Screenshot: screenshots/probe-hl-disarmed.png (tool disarmed, opaque block hiding the title), screenshots/frost-o-annotated.png (same repro during the frost-verify sweep)

History:
- qa: opened
- qa: CLOSED (retested on the DEV build v1.10.0, dist rebuilt 5/09 6:20PM after the fix source; launchApp with no executablePath; new spec e2e/retests/def_173_verify_1.10.0.spec.cjs, 1/1 green in 12.3s; developer unit test defDEF173_highlightTranslucent 3/3 green via vitest run; fix rule present in the built bundle dist/renderer/assets/index-Deyu2awk.css). (1) PRIMARY REPRO FIXED, same steps as the original repro: open report.pdf -> arm Highlight -> drag across the title "TFlex Technical Report" on page 1 -> committed rect computes fill-opacity 0.35 (was 1/opaque); mid-drag the .ann-preview rect already computes 0.35; engine record {kind:"highlight", page:1, color:"#e07a2d", content:"TFlex Technical Report"} identical to the original diagnostics. (2) VISUAL: screenshots/def-173-retest-page1.png - pale translucent wash, the title fully readable underneath; matches the saved-native-/Highlight look the Expected pinned. (3) CANVAS CONTROL: pixel-sampling the page canvas under the highlight bbox in-session returns ONLY white + black glyphs (zero orange), proving the wash comes solely from the SVG overlay at 0.35 (e2e/retests/def_173_reopen_diag.spec.cjs). (4) DISARM: highlight is a sticky tool - Escape never disarmed it (DocumentView.tsx:1618-1629 Escape only closes search; Toolbar.tsx:51 documents click-again-to-disarm); re-clicking the Highlight button disarms (activeTool null) and the committed rect stays 0.35. The original repro step "Press Escape to disarm" was a wrong premise in the Phase-16 sweep write-up, not a product behavior. (5) SAVE/REOPEN: Save As -> temp file re-parsed with pdf-lib contains the native /Highlight with /QuadPoints (8 numbers) and /Rect; reopen re-imports (engine kinds=[highlight]) and renders - functionally intact, nothing lost. (6) REGRESSION NOTE, NOT THIS DEF: the reopened render is much darker than in-session (canvas paints the baked /Highlight full-opacity - no /OP, no /AP - and the overlay draws it again at 0.35); measured and filed separately as DEF-174, so this entry closes for its titled in-session bug, which is fixed and verified.

## DEF-171: Signature manager ignores Escape - the dialog and its full-screen backdrop stay up, blocking every control behind them until the Close button is used

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 16 (found during the motion-system verification run of the standard e2e suite; reproduced on both the motion build and the pre-motion HEAD c6cd827, so it predates the motion chunks)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open a PDF (repro used assets/samples/report.pdf).
3. Click the "Sign" toolbar button (button[aria-label="Sign tool"]). The Signature manager opens (Draw/Type/Saved tabs) over a dimmed modal backdrop.
4. Press Escape and wait ~800ms.
5. Observe the screen, then try any control behind the dialog (e.g. the theme toggle in the title bar).

Expected: Escape dismisses the Signature manager (every other modal in the app closes on Escape - Insert pages, Merge, crop, etc.), and the workspace behind it becomes interactive again.

Actual: after Escape the dialog is still fully visible and interactive (computed check: .sig-manager present=true, .modal-backdrop present=true), and the full-screen backdrop intercepts all pointer events - Playwright retry-looped 56x for 30s on the theme toggle with "<div class=modal-backdrop> intercepts pointer events" (failure observed during the motion-phase verification run of the standard suite; the committed motion-phase artifact is e2e/motion_verify.spec.cjs - e2e/sweep_visual.spec.cjs itself is untracked). The ONLY way out is the dialog's own Close button: clicking it removes both the dialog and the backdrop (sigVisible=false, backdrop=false). Verified twice on the motion build (e2e/retests/def_171_173_diag.spec.cjs [D1], untracked qa artifact: after Escape {"sigVisible":true,"backdrop":true}; after Close {"sigVisible":false,"backdrop":false}) and the same sweep_visual failure exists on pre-motion HEAD.

Screenshot: screenshots/def-171-sign-escape.png (Signature dialog still open over the dimmed workspace after Escape was pressed)

History:
- qa: opened
- qa: CLOSED (retested on the DEV build v1.9.0, commit e3673fd "motion system, DEF-171 escape fix", dist rebuilt 5/09 12:52AM after the fix source; launchApp with no executablePath; new spec e2e/retests/def_171_escape_retest_190.spec.cjs). (1) PRIMARY REPRO FIXED: open report.pdf -> Sign tool -> Escape on the Draw tab -> after 800ms {"sigVisible":false,"backdrop":false} (was sigVisible=true, backdrop=true) - screenshots/def-171-retest-open-before-escape.png (dialog over dimmed backdrop) and screenshots/def-171-retest-escape-closed.png (clean interactive workspace after Escape). (2) THE ORIGINAL HARM GONE: after Escape the theme toggle click lands - theme flips dark->light with zero Playwright retries (previously 56x "intercepts pointer events"), then toggled back. (3) ALL TABS: Escape with focus INSIDE the Type input (name typed first) closes dialog+backdrop; Escape on the Saved tab closes dialog+backdrop - matching the committed unit test test/unit/renderer/defDEF171_signatureManagerEscape.test.tsx (4/4 green via vitest run: draw canvas / type input / saved tab / window-level dispatch). (4) CLOSE-BUTTON REGRESSION: the dialog's own Close button (the pre-fix only exit) still closes both. (5) NO CROSS-TALK: the Insert pages dialog still Escape-closes normally right after using the signature manager; window-level keydown fires only while the sig manager is open (removed on unmount). Fix inspected in source: SignatureManagerModal.tsx adds a window keydown listener while open (preventDefault + onClose), mirroring the other dialogs' Escape wiring.
- qa: REGRESSION NOTE (not this fix): e2e/sweep_annotations_sign.spec.cjs ran 1/5 against the INSTALLED app - root-caused as the OTA update prompt (installed v1.8.0 detects the newly shipped v1.9.0 and opens the modal UpdatePromptDialog whose full-screen .sheet-backdrop intercepts pointer events; the sweeps never dismiss it). Not a DEF-171 regression: the installed 1.8.0 predates the fix, and S2 (signature place/move/save/reopen lifecycle on the installed app) passed. Filed as DEF-172; evidence e2e/retests/diag_installed_sheet_190.spec.cjs + screenshots/diag-installed-sheet-backdrop.png.

## DEF-172: Standard e2e sweeps targeting the INSTALLED app fail whenever a newer version is published - the OTA update prompt's full-screen backdrop intercepts every pointer event and the sweeps never dismiss it

- Status: OPEN
- Severity: LOW
- Found by: qa
- Phase: 16 (hit while regression-testing the DEF-171 fix; the trigger is the v1.9.0 release itself - the installed v1.8.0 pops the update prompt mid-run)

Steps to reproduce:
1. Have the installed app at v1.8.0 (%LOCALAPPDATA%\Programs\tflex\TFlex.exe) while a newer release v1.9.0 exists in the OTA channel.
2. Run npm.cmd run test:e2e -- e2e/sweep_annotations_sign.spec.cjs (or any sweep that launches the installed app via helpers.cjs launchInstalled).
3. Within ~3s of launch the app shows "Update available - Update to v1.9.0 is available..." (UpdatePromptDialog, .sheet-backdrop full-screen, aria-modal).

Expected: the sweep specs handle this legitimate app state (dismiss the prompt, e.g. press Escape or click Cancel) and run to green; a published update should not break the standard suite.

Actual: 4 of 5 tests fail with Playwright retry-looping 30s on the first click of the test body: "<div tabindex=-1 role=presentation class=sheet-backdrop> intercepts pointer events" (A1 rect arm, A2 pen arm, A3 rail tab, S1 sig action bar). S2 still passed. Root cause confirmed by a read-only probe: e2e/retests/diag_installed_sheet_190.spec.cjs reports the sheet {"sheetClass":"sheet sheet-update-prompt","text":"Update availableUpdate to v1.9.0 is available..."} within 3s of launch - screenshots/diag-installed-sheet-backdrop.png. The prompt itself is by-design modal (UpdatePromptDialog.tsx: aria-modal=true, .sheet-backdrop position:fixed inset:0 z-index:100, closes on Escape/backdrop-click), so the product behavior is correct - this is a qa-suite gap: helpers.cjs/sweep specs must dismiss the update prompt after launch (and the suite will keep breaking on every future release until they do). Minor observation folded in: the sheet copy "you can keep working while it does" clashes with the modal backdrop (the download does run in the background, but the UI blocks until dismissed) - cosmetic. Transient mitigation: install v1.9.0 (no newer release = no prompt), or qa adds a dismissUpdatePrompt step to the sweeps.

Screenshot: screenshots/diag-installed-sheet-backdrop.png

History:
- qa: opened (found during the DEF-171 close regression run; 4 failures on sweep_annotations_sign against installed v1.8.0 root-caused to the update prompt, not to the v1.9.0 code changes)

## DEF-170: A SECOND Extract in the same session orphans its result document - success toast, but no tab opens and the app refocuses the OLD extraction tab (still showing the old doc)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (found during the DEF-167 close retest on the dev build; the extract translation itself (DEF-167) is correct - this is the tab/result handling around it)

Steps to reproduce:
1. Launch TFlex (dev build via e2e/lib/launch.cjs launchApp, no executablePath).
2. Open a multi-page PDF whose pages are visually distinguishable (repro used test-fixtures/marker-3pages.pdf: three pages rendering MARKER-PAGE-1 / 2 / 3).
3. Tools palette -> "Split pages" (Extract is the default mode), enter "3", click Extract. This works: a new tab "marker-3pages.pdf - page 3" opens, active, showing MARKER-PAGE-3 (DEF-167 fixed).
4. Switch back to the SOURCE tab ("marker-3pages.pdf", no "- page N" suffix; note tabs activate on mousedown - a synthetic .click() does not switch).
5. Tools palette -> "Split pages" again, enter "1", click Extract.

Expected: a THIRD tab "marker-3pages.pdf - page 1" opens, active, showing MARKER-PAGE-1, matching the "Extracted 1 page to a new document." toast.

Actual: the toast IS fresh and correct (proven: no toast present at +600ms after confirm, "Extracted 1 page to a new document." at +3.1s - so the engine extraction really ran), but NO third tab ever appears (tab count stays 2, .tab-pane count stays 2). The app instead refocuses the PREVIOUS extraction tab "marker-3pages.pdf - page 3", whose content is still the OLD document (MARKER-PAGE-3). The newly extracted page-1 document is orphaned - unreachable from any UI surface - while the user is looking at the WRONG document with the requested page number in the toast. From the user's seat this masquerades as the old DEF-167 wrong-page bug (asked for page 1, see page 3). Recovery: closing the stale extraction tab ("Don't save" on its close prompt - the orphan is not saved anywhere) makes the next Extract work again (verified: extract "2" then opens tab "- page 2" with MARKER-PAGE-2). Repro + characterization script: e2e/retests/def167_probe_extract3.spec.cjs (sequences A fresh extract OK / B orphan / C recovery after close; its sequence-B expectation is red by design until this is fixed).

Screenshot: screenshots/def-170-repro-second-extract-orphan.png (success toast bottom-right while the focused tab is the OLD "- page 3" doc showing MARKER-PAGE-3; only two tabs), screenshots/def-167-probe-extract3-fresh.png (sequence A: fresh extract of page 3 lands correctly), screenshots/def-167-probe-extract-after-close.png (sequence C recovery)

History:
- qa: opened (found while retesting DEF-167: every SECOND extract in a session drops its result tab, independent of which page was extracted - main-spec flow extract("1") then extract("3") and probe flow extract("3") then extract("1") both orphan the second result)
- qa: CLOSED (retested on the DEV build after rebuilding dist from current source via npm.cmd run build; launchApp with no executablePath; new spec e2e/retests/def170_verify_devbuild.spec.cjs). Root cause of the fix: openEngineBytesAsTab (App.tsx) now passes dedupePath:false so the tabs reducer's same-path dedupe branch (tabs.ts, `action.dedupePath !== false`) does not collapse the second extract result onto the first (both share the synthetic `<extract>marker-3pages.pdf` path); bundle check: dist renderer carries both `dedupePath:!1` at the call site and the `t.dedupePath!==!1` guard. (1) SECOND EXTRACT OPENS ITS TAB: extract("3") -> tab "marker-3pages.pdf â€” page 3" active MARKER-PAGE-3; back to source; extract("1") -> a THIRD tab "marker-3pages.pdf â€” page 1" (own fresh UUID) opens and is ACTIVE showing MARKER-PAGE-1 with its own fresh "Extracted 1 page to a new document." toast - no orphan, no refocus of the old result tab (screenshots/def-170-retest-second-extract-tab.png). (2) EACH TAB OWNS ITS DOC: activating "â€” page 3" shows MARKER-PAGE-3, activating "â€” page 1" shows MARKER-PAGE-1, distinct data-tab-ids (screenshots/def-170-retest-page3-tab-own-doc.png, def-170-retest-page1-tab-own-doc.png); a third extract("2") lands a fourth tab "â€” page 2" active MARKER-PAGE-2 (def-170-retest-third-extract.png). (3) REGRESSION: e2e/retests/def167_probe_extract3.spec.cjs now passes all three sequences (A fresh extract, B the formerly-orphaning second extract, C recovery after close; its sequence-B expectation was red-by-design for this bug and sequence C's tab-count expectation was written against the DEFECTED world where B opened no tab - updated 2->3 with a comment when the fix landed, C's actual contract "fresh extract after closing the old result tab still lands its own active tab" unchanged and green). e2e/retests/def_167_168_169_verify_devbuild.spec.cjs 3/3 green (DEF-167 extract off-by-one still fixed), test/unit/renderer/tabs.test.ts 25/25 green incl. the two DEF-170 reducer unit tests.

## DEF-167: Extract pages delivers the WRONG page (off by one) and rejects any range touching the last page - 1-based dialog numbers reach the 0-based engine untranslated

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (found during the dev-build visual-overhaul e2e run; the offending code predates the redesign - engineClient.ts last modified 3/09, before the 2:44 PM source landing)

Steps to reproduce:
1. Launch TFlex (dev build; the code path exists in any build carrying engineClient.ts without the extract translation).
2. Open a PDF whose pages are visually distinguishable (repro used test-fixtures/marker-3pages.pdf: three pages rendering the text MARKER-PAGE-1 / 2 / 3).
3. Open the Tools palette, click "Split pages" (the Extract/Split dialog; Extract is the default mode).
4. Enter page "1", click Extract.

Expected: the new document contains page 1 (its own tab title even says "marker-3pages.pdf - page 1").

Actual: the new document contains PAGE 2 - the page shows "MARKER-PAGE-2" while the tab is titled "- page 1" and the success toast reads "Extracted 1 page to a new document." (screenshots/def-167-extract-1-lands-page-2.png). The wrong page arrives silently: no warning, and the title/toast assert the requested page. Additionally, any range that includes the LAST page fails outright: entering "3" (of 3) yields the error toast "Engine error: extract page 3 out of bounds for 3 pages" (observed on report.pdf as "extract page 34 out of bounds for 34 pages" during the full_retest run), because the 1-based number equals the 0-based bound.

Root cause: the SplitDialog's parsePageRange returns 1-based page numbers (validated 1..totalPages), and App.tsx onConfirmSplit passes them straight to engine.extract. The engineClient wrapper translates 1-based -> 0-based for split (src/renderer/engine/engineClient.ts:772-781, "The renderer-facing API is 1-based, so translate here") but NOT for extract (src/renderer/engine/engineClient.ts:783-788, raw pass-through). The main-process EngineService.extract indexes doc.order[p] with 0-based semantics and validates p >= surviving (src/main/services/engine.ts:625-630). Evidence: direct engine.extract calls with [3] and [1,2,3] on the 3-page fixture both return "extract page 3 out of bounds for 3 pages" while [0]/[1]/[2] succeed; the UI path with "1" produces page 2.

Fix direction: translate in engineClient.extract the same way split does (pages.map(p => p - 1)), or make the engine contract explicitly 1-based with matching validation; add a regression e2e on marker-3pages.pdf asserting extract("1") renders MARKER-PAGE-1 and extract("3") succeeds.

Screenshot: screenshots/def-167-extract-1-lands-page-2.png

History:
- qa: opened (proven on the dev build via e2e/probe_place_dev.spec.cjs probes 8-12 + the full_retest DEF-012 run's out-of-bounds toast; wrong-page result reproduced twice with the marker fixture)
- qa: CLOSED (retested on the DEV build, launchApp with no executablePath, after rebuilding dist from the current source - the old 2:48 PM dist predated the fix and was stale; e2e/retests/def_167_168_169_verify_devbuild.spec.cjs + e2e/retests/def167_probe_extract3.spec.cjs). (1) OFF-BY-ONE GONE: extract "1" of marker-3pages.pdf now opens tab "marker-3pages.pdf - page 1" (exact title) whose textLayer renders MARKER-PAGE-1 (was MARKER-PAGE-2) - screenshots/def-167-retest-extract-1.png. Bundle check: dist renderer carries the translation (minified `extract(e,t){return this.inner.extract(e,t.map(e=>e-1))}`). (2) LAST-PAGE ERROR GONE: extract "3" of 3 no longer errors - no "out of bounds" toast anywhere; on a FRESH session the extracted tab "marker-3pages.pdf - page 3" opens ACTIVE showing MARKER-PAGE-3 with the success toast (probe sequence A, screenshots/def-167-probe-extract3-fresh.png), and in the repeat-extract flow the "out of bounds" error is equally gone (toast reads success; the tab-opening gap of that repeat flow is a separate finding filed as DEF-170). Regression: extract("1") still lands page 1 after the sequence, and the DEF-167-suggested regression e2e exists (def_167_168_169_verify_devbuild.spec.cjs part 1 + probe spec).

## DEF-168: Radio buttons / checkboxes render browser-default BLUE instead of the orange accent

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (dev-build visual sweep, both themes)

Steps to reproduce:
1. Launch the dev build (dist at 2:48 PM with the orange redesign), open any PDF.
2. Tools palette -> Insert pages; look at the "What to insert" and "Page size" radio groups.

Expected: every interactive control uses the single orange accent (#E07A2D) - the spec's "single accent, no blue" rule; the blue is exactly the leftover default the visual overhaul was meant to remove.

Actual: the selected radio knob is browser-default BLUE (#2563eb-family) in both themes - visible on "Blank page" and "US Letter" in screenshots/visual-dev-dialog-light.png and screenshots/visual-dev-dialog-dark.png. Root cause: styles.css sets `accent-color: var(--accent)` only for the OCR dialog's range slider (.ocr-dialog .modal-range, line 6086); no global `input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); }` exists, so every other native radio/checkbox falls back to the browser default.

Screenshot: screenshots/visual-dev-dialog-light.png

History:
- qa: opened (visual sweep finding; cosmetic, both themes equally affected)
- qa: CLOSED (retested on the DEV build after the dist rebuild, e2e/retests/def_167_168_169_verify_devbuild.spec.cjs DEF-168 test). The fix is the global rule `input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); }` (styles.css:349-352, replacing the OCR-slider-only rule). All 6 native radios of the Insert pages dialog (2x "What to insert" / insert-mode, 4x "Page size" / blank-preset, checked and unchecked) report computed accent-color rgb(224, 122, 45) = #e07a2d = the --accent token, in BOTH themes (dark read with the dialog open; light read after Escape -> .theme-toggle -> reopen; the modal backdrop correctly blocks the header while open, so the theme must be switched between dialog sessions). --accent resolves #e07a2d in both themes; no blue (b > r) anywhere. Screenshots: screenshots/def-168-retest-insert-dialog-dark.png, screenshots/def-168-retest-insert-dialog-light.png (selected knobs visibly orange). Note for the record: the .form-radio / .form-checkbox page-overlay controls are custom-drawn from --accent tokens (styles.css:3714-3767) and were never affected.

## DEF-169: Modal backdrop does not dim the open Tools palette - the palette floats above the overlay at full brightness

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (dev-build visual sweep)

Steps to reproduce:
1. Launch the dev build, open any PDF.
2. Open the Tools palette, click "Insert pages" so the modal dialog opens.

Expected: the modal backdrop dims the whole app behind the dialog, so the dialog is the unambiguous focus layer.

Actual: the workspace, rail and page dim correctly, but the open Tools palette stays at full brightness ABOVE the backdrop (right side of the screen) - the palette's z-index sits over the modal overlay. Both themes show it: screenshots/visual-dev-dialog-dark.png and screenshots/visual-dev-dialog-light.png. Purely cosmetic layering inconsistency; no interaction fault observed.

Screenshot: screenshots/visual-dev-dialog-dark.png

History:
- qa: opened (visual sweep finding; cosmetic)
- qa: CLOSED (retested on the DEV build after the dist rebuild, e2e/retests/def_167_168_169_verify_devbuild.spec.cjs DEF-169 test). The frontend's read is confirmed: the palette was never above the backdrop. Measured with the palette open and the Insert pages modal up: palette z-index 30, .modal-backdrop z-index 800, backdrop rgba(0, 0, 0, 0.45) fixed inset:0; document.elementFromPoint at the palette's center returns the .modal-backdrop itself (the backdrop is the top element covering the palette - nothing of the palette pokes through). Pixel proof over the palette's own bounding rect (281x813 at x=1162): mean luminance 198 baseline (palette open, no modal) -> 27.4 under the modal (ratio 0.10, i.e. the 45% black backdrop plus the dark panel render dims the palette to a tenth). Visual: screenshots/def-169-retest-under-modal.png shows the right-side palette clearly dimmed behind the dialog (vs the un-dimmed baseline screenshots/def-169-retest-baseline.png). The original DEF-169 screenshots were evidently taken/staged before the backdrop painted over the palette region (or mis-cropped); the source z-order (palette 30 < backdrop 800) was already correct.

## DEF-166: Reopening a saved file renders annotation text DOUBLED (baked canvas AP + DOM overlay, offset fonts)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (installed v1.7.26; found during the DEF-164 close verification)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.26), open the report.pdf sample, go to page 4, commit a callout ("VERIFY CALLOUT 1726"), Save As, close the tab, reopen the saved file, go to page 4.

Expected: the reopened callout text reads as one crisp line.

Actual: the annotation text renders TWICE slightly offset: TFlex draws its DOM overlay text (Inter ~13px) and pdf.js also renders the baked FreeText appearance into the page canvas (12pt Helvetica from /DA; the file has no /AP stream, so the viewer generates the appearance) on top of each other - "VERIFY CALLOUT 1726" plus a lighter ghost copy (screenshot def-164-1726-reopened-callout-crop.png). Pre-existing dual render: in v1.7.25 the same canvas AP painted ~129px away from the box as the DEF-164 stray; after the DEF-164 coordinate fix the two renders now coincide, which makes the doubling visible as a blur/ghost instead of a stray line. Same doubling visible on the committed textbox after reopen (def-164-1726-reopened.png). Positions are correct (this is purely a render-fidelity artifact); fix direction: suppress one of the two renders when the saved annotation's own appearance is already displayed.

Screenshot: screenshots/def-164-1726-reopened-callout-crop.png

History:
- qa: opened (visual observation during the DEF-164 close verification on v1.7.26; LOW, cosmetic, reopen-of-saved-file only - the committed state renders single and clean)
- qa: FIX-READY retest FAILED on installed v1.7.27 (app.getVersion 1.7.27, e2e/retests/def_165_166_verify_1.7.27.spec.cjs + e2e/retests/def_166_canvas_extract_1727.spec.cjs). One real improvement: the reopened tab's DOM overlay no longer carries the text (the overlay divs are now empty, html:"" - the v1.7.26 DOM source is gone; def-166-1727-diag evidence). But the doubling is NOT fixed - it moved into the page CANVAS: TFlex's single pdf-page canvas now carries the annotation text TWICE. Extracted canvas crops (no DOM involved): def-166-1727-tflex-canvas-textbox.png shows "VERIFY TB 1727" as two offset interleaved copies, def-166-1727-tflex-canvas-callout.png shows "VERIFY CALLOUT 1727" doubled ("YERYEY CALL OUT 11737"). Third-party proof the FILE is fine: plain pdf.js in real Chromium renders the same saved file's textbox and callout text exactly ONCE (def-166-chromium-textbox-crop.png, def-166-chromium-callout-crop.png; saved /FreeText still has no /AP - DA="/Helv 12 Tf" - so viewers generate one appearance). So both copies are painted by TFlex's own reopen path into the one canvas (its own text draw plus pdf.js's /DA-generated appearance, offset by the font-metric difference). Round-trip position 0.0px; committed state renders single and clean (unchanged). Saved artifact: test-fixtures/annot-text-roundtrip-1727.pdf. Status stays OPEN - in-app reopen still shows doubled/offset text.
- qa: CLOSED (retested on installed v1.7.28 = app.getVersion 1.7.28, e2e/retests/def_165_166_verify_1.7.28.spec.cjs, real mouse). Callout "VERIFY CALLOUT 1728" + textbox "VERIFY TB 1728" committed on page 4 of report.pdf, Save As, close tab, reopen, page 4. (1) SINGLE RENDER SOURCE: the reopened tab's DOM overlay carries NO text (probe: runs=[], paintedWithMarker=false for both kinds) while the page canvas paints the annotation text exactly once - the text now lives in an explicit /AP /N stream baked INTO the saved file (raw pdf-lib dump, e2e/retests/def_166_1728_dict_diag.cjs: callout /AP /N = "q BT /Helv 4 Tf ... rg 1 0 0 1 438.394 453.985 Tm <564552494659> Tj ... ET Q", textbox /Helv 5.259 - the v1.7.26/27 /DA-only file that made every viewer GENERATE its own appearance is gone). (2) THIRD-PARTY WITNESS, same file same scale: plain pdfjs-dist renders the reopened file's callout and textbox regions IDENTICAL to TFlex's own canvas - control crops def-166-1728-pdfjs-control-{callout,textbox}.png vs TFlex canvas crops def-166-1728-tflex-canvas-{callout,textbox}.png are visually the same single-rendered text; self-shift-overlap doubling detector (1..6px shift set, def_166_canvas_witness_1728.cjs at the true page scale 1.8889 px/pt): TFlex canvas maxSelfOverlap 0.675 (callout) / 0.717 (textbox) vs pdf.js single-render control 0.666 / 0.683 - within +0.01/+0.03 of single-render, nowhere near the v1.7.27 interleaved-copy signature. The v1.7.27 doubling is gone. (3) ROUND-TRIP: positions 0.0px both kinds; raw /Rect math still bottom-left EXACT (callout [431.89, 438.28, 521.89, 464.48] + /Callout anchor end (336.60, 522.72) = 792-269.28, dy=0; textbox [110.16, 575.72, 207.52, 601.92]; dlly=dury=0, oldBugSignature=false) - DEF-164 regression green. (4) Third-party scale-2 crops of the SAVED file (def-166-1728-diag-saved-FreeText-{0,1}-scale2.png) show each text once, correctly positioned. Saved artifact preserved: test-fixtures/annot-text-roundtrip-1728.pdf. No pageerrors.

## DEF-165: Saved shapes bake the 10%-alpha overlay fill as a SOLID /IC interior color - third-party viewers render an opaque blue block hiding the page content behind the shape

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15 (installed v1.7.26; found during the DEF-164 verification's visual review)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.26), open the report.pdf sample, go to page 4.
2. Arm the Rectangle tool, drag a ~120x70 screen px rect over body text: the committed overlay shows a blue 1.5px border with a 10% tint (computed style fill = rgba(37, 99, 235, 0.1)); the page text under the rect stays readable.
3. Save As to a temp file, close the tab, reopen the saved file (or open it in Acrobat / Chrome / any pdf.js viewer), go to page 4.

Expected: the saved shape looks like what the user placed - stroked border with a ~10% alpha interior.

Actual: the bake drops the overlay's alpha and writes /IC [0.145, 0.388, 0.922] = #2563eb SOLID on the /Square dict (no /AP stream), so pdf.js and Acrobat paint the interior OPAQUE blue: TFlex's own reopened tab shows a solid blue block covering the body text (screenshots/def-164-rect-committed-crop.png vs def-164-rect-reopened-crop.png), and every third-party viewer does the same. Verified for Circle too (e2e/retests/def_164_circle_ic_diag.spec.cjs: DOM fill rgba(37,99,235,0.1) -> baked /Circle /IC = solid #2563eb). Textbox/callout backgrounds have the inverse gap (10% tint in-app, transparent in third parties) - same lost-alpha root cause, cosmetic there. Fix direction: omit /IC when the shape fill alpha < 1 (or emit an /AP stream that reproduces the alpha via an ExtGState /ca).

Screenshot: screenshots/def-164-rect-reopened-crop.png

History:
- qa: opened (found during the DEF-164 close verification on v1.7.26 - the DEF-164 coordinate flip itself verified correct; the shape fill alpha is a separate save-path gap, likely pre-existing)
- qa: FIX-READY retest FAILED on installed v1.7.27 (app.getVersion 1.7.27, e2e/retests/def_165_166_verify_1.7.27.spec.cjs + e2e/retests/def_165_166_thirdparty.cjs third-party witness). The bake took the right direction - the saved /Square and /Circle now carry an /AP /N appearance stream and /IC is omitted (/IC=null on both) - but the 10% alpha is written as an INLINE content-stream token "0.1 ca 1 CA" inside the /N stream, which is not a valid PDF operator: fill/stroke alpha may only be set through an ExtGState resource invoked with the gs operator. The /AP /Resources /ExtGState dict is absent (gsEntries=[]), so pdf.js ignores the inline token and paints the fill at FULL alpha. Third-party witness on the saved file (pdfjs-dist 4.10.38 render, Node): rect interior opaqueBlueFrac=1.00 textKeptFrac=0.00 meanAbsDiff=127.25; ellipse opaqueBlueFrac=1.00 textKeptFrac=0.00 - the interior is a solid opaque blue block hiding the page text (def-165-thirdparty-saved-rect-interior.png = solid blue vs def-165-thirdparty-baseline-rect-interior.png = pristine page text "orchest/key to r" visible). pdf.js operator-list witness: both annotation-blue fill ops run under ca=1 (v1.7.26's exact bug signature). TFlex's own reopened tab shows the same solid block (in-app canvas interior 100% near-blue). DEF-164 regression still green on this save path: /Rect bottom-left EXACT for both shapes (rect [48.96,343.10,112.49,380.16] = 792-411.84-37.06/792-411.84; ellipse [208.08,348.40,266.32,380.16]). Saved artifact preserved: test-fixtures/annot-shape-alpha-roundtrip-1727.pdf. Fix direction: declare /ca 0.1 in an ExtGState dict under the /AP /N /Resources (e.g. /G1 << /Type /ExtGState /ca 0.1 /CA 1 >>) and invoke "/G1 gs" before the fill in the /N content stream - keep /IC omitted. Status stays OPEN.
- qa: CLOSED (retested on installed v1.7.28 = app.getVersion 1.7.28, e2e/retests/def_165_166_verify_1.7.28.spec.cjs, real mouse). Rect + ellipse committed over body text on page 4 of report.pdf (committed DOM fill rgba(37,99,235,0.1) both), Save As, then verified at every level. (1) DICT: the saved /Square and /Circle /AP /N streams now declare the alpha PROPERLY - /Resources /ExtGState << /G1 << /ca 0.1 /CA 1 >> >> invoked as "/G1 gs" inside the /N content stream before the fill ("q ... rg ... RG /G1 gs 1.5 w ... re B Q"), /IC=null, and the v1.7.27 invalid inline "0.1 ca" token is GONE (inlineCaToken=false both shapes). (2) pdf.js OPERATOR LIST with paint-time ca attribution (validated on the 1727 fixture = paints ca=1, caught; 1728 = paints ca=0.1): both shapes' blue fillStroke ops PAINT under ExtGState ca=0.1. (3) THIRD-PARTY PIXELS (pdfjs-dist render, Node, def_165_166_thirdparty_1728.cjs): rect interior opaqueBlueFrac=0 (was 1.00), textKeptFrac=1.00 (was 0.00), meanAbsDiff=12.3 (was 127); ellipse opaqueBlueFrac=0, textKeptFrac=1.00, meanAbsDiff=11.89 - the interior is translucent, the page text behind both shapes stays visible in a third-party view (def-165-1728-thirdparty-saved-rect-interior.png vs baseline; both bbox near-blue ink deltas 433/613 = the 1.5pt border painted). (4) IN-APP reopen: interior near-blue 1.0%/2.5% (was 100%), round-trip positions 0.0px both kinds. (5) DEF-164 regression: raw /Rect bottom-left EXACT (rect [48.96,343.10,112.49,380.16], ellipse [208.08,348.40,266.32,380.16]; dlly=dury=0, oldBugSignature=false). Saved artifact preserved: test-fixtures/annot-shape-alpha-roundtrip-1728.pdf. Note for the record: the v1.7.27 spec's opl scanner attributed the ca value BEFORE the gs call to the rg token (the blue rg legally precedes "/G1 gs" inside the same q..Q block, but painting happens at B after gs) - a scanner artifact, fixed this round with paint-time attribution; the 1.7.27 pixel evidence (opaqueBlueFrac=1.00) independently confirmed the real bug then. No pageerrors.

## DEF-164: Saved annotations bake /Rect (and /Callout) in TOP-DOWN coordinates - every kind lands ~69pt lower (and the callout anchor mirrored) in any third-party viewer

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 15 (installed v1.7.25; caught by the DEF-160/161/162 verification's save+reopen checks)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.25), open the report.pdf sample, go to page 4.
2. Commit a callout ("VERIFY CALLOUT 1725"), move its box +120/+70 and its arrow anchor +100/+60, Confirm, Save As to a temp file.
3. Parse the saved file: pdfjs `page.getAnnotations()` on page 4 + pdf-lib raw dict dump (e2e/retests/def_161_bake_diag.cjs, def_161_bake_raw.cjs), then render it in any spec-conforming consumer.
4. Re-open the saved file in TFlex and scan the page canvas for annotation-blue pixels (e2e/retests/def_161_canvas_diag.spec.cjs).

Expected: /Rect and /Callout carry PDF user-space coordinates (origin bottom-left, y up): for the moved callout box (engine top-down y 348.73pt) /Rect y should be 417.07..443.27.

Actual: TFlex writes the engine's renderer (top-down) y values verbatim into PDF space: FreeTextCallout /Rect [495.42, 348.73, 585.42, 374.93] (69pt too low) and /Callout anchor [.., 389.54, 285.20] (should be ~506.8 bottom-up - mirrored). The SAME flip on every kind: note /Text /Rect [201.81, 147.98, ...] (should be 620.02..644.02 - ~472pt too low), textbox /FreeText /Rect [201.81, 171.74, ...], Square /Rect [110.84, 264.11, ...], Circle /Rect [282.20, 264.11, ...]. TFlex itself reopens these correctly ONLY because `annotationFromWire` repeats the same flip, so the double error cancels in-app - but the page canvas render proves the file is wrong: the generated FreeText appearance (blue "VERIFY CALLOUT 1725") paints at page-local y 785-835 (exactly the baked /Rect: 792-374.93=417.07pt * 1.889 = 788px) while the app's overlay box sits at 658.7 - a stray blue text line 129px below the box, visible in every reopened saved file (screenshots/def-161-1725-reopened-stray-text.png, def-161-1725-canvas-scan.png). In Acrobat/Chrome/pdf.js every annotation of the saved file renders ~69pt (note: ~472pt) lower than the user placed it, and the callout leader points to a vertically mirrored anchor. Content is NOT lost (all /Contents intact) - the geometry in the file is wrong for every non-TFlex consumer. Fix direction: convert to user space on bake (y_pdf = pageHeight - y_topdown - h for /Rect; pageHeight - y for points) and mirror the conversion on read (keeping the in-app round-trip stable). Fixture: test-fixtures/callout-rect-yflip-bake.pdf.

History:
- qa: opened (verification of DEF-160/161/162 on v1.7.25: save+reopen in-app passed, but the raw saved file carries the flipped /Rect on all five annotation kinds; in-app misplacement visible as the stray canvas-rendered blue text in the reopened tab; pre-existing save-path bug, not introduced by this fix round)
- qa: CLOSED (retested on installed v1.7.26 = app.getVersion 1.7.26, e2e/retests/def_163_164_verify_1.7.26.spec.cjs, real mouse). Note + textbox + callout + rect committed on page 4 of report.pdf, Save As, raw /Annots parsed with pdf-lib on the SAVED file - ALL FOUR kinds carry exact bottom-left values (dlly=0, dury=0, oldBugSignature=false): note /Text /Rect [110.16, 688.80, 134.16, 712.80] (= 792-79.20-24 / 792-79.20 for engine top-down y=79.20 h=24); textbox /FreeText [110.16, 575.72, 207.52, 601.92] (= 792-190.08-26.20 / 792-190.08); callout /FreeText /Rect [431.89, 438.28, 521.89, 464.48] (= 792-327.52-26.20 / 792-327.52) AND /Callout anchor end (336.60, 522.72) = 792-269.28 (v1.7.25 mirrored this as 269.28); Square /Rect [48.96, 343.10, 112.49, 380.16] (= 792-411.84-37.06 / 792-411.84). Third-party witness: pdf.js page.getAnnotations() on the same file returns the same bottom-up rects (e2e/retests/def_161_bake_diag.cjs). TFlex round-trip: all four kinds reopened at page-local distance 0.0px from the pre-save positions (note 208.1,149.6 / textbox 208.1,359 / callout 815.8,618.6 / rect 92.5,777.9), reopened engine re-parses to the same top-down values. Canvas baseline diff (pre-save page-content bands vs reopened canvas bands): zero stray bands - the baked appearances land exactly under their overlays (callout band 607-654 grew 494->772px AT the overlay, rect band 764-862 at the overlay; the v1.7.25 stray ~129px below the box is gone). Screenshots: def-164-1726-committed.png, def-164-1726-reopened.png, def-164-1726-reopened-callout-crop.png, def-164-1726-canvas-scan.png. Saved artifact preserved as test-fixtures/annot-rect-bottomleft-roundtrip-1726.pdf. Residual observations filed separately: DEF-165 (shape /IC solid fill vs the 10% overlay tint), DEF-166 (doubled AP+overlay text on reopen). No pageerrors.

## DEF-163: Committed callout: text longer than the created box overflows and paints over the page content (fixed-height box, no auto-grow)

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 15 (installed v1.7.25)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.25), open the report.pdf sample, scroll to page 4.
2. Arm the Callout tool, drag anchor -> box (~180x110 screen px), type "VERIFY CALLOUT 1725", click Confirm.
3. Look at the committed callout.

Expected: the committed callout box grows with its text (or the text stays contained within the box).

Actual: the box keeps its creation size (170x49.5 px) and the text wraps to 3 lines at the box's font size: only "VERIFY" renders inside the box; "CALLOUT" and "1725" render BELOW the box, overlapping the page's body text. Present at COMMIT time (before any move) and identical after save+reopen. Short texts fit fine ("SWATCH CO" on 2 lines - V5). Root cause direction: the committed callout div takes its height from the creation rect with overflow visible - no auto-grow to fit the text. Likely pre-existing (the DEF-160 repro on v1.7.24 already described "moved callout text ghosting outside the box"); surfaced during the v1.7.25 verification's visual review. Screenshots: def-160-1725-v4-callout-committed.png (3-line spill at commit), def-160-1725-v4-after-confirm-crop.png.

History:
- qa: opened (observed during the DEF-161 move+confirm verification; separate from the tear/revert DEF-161 fixed - the geometry and text content persist correctly)
- qa: CLOSED (retested on installed v1.7.26 = app.getVersion 1.7.26, e2e/retests/def_163_164_verify_1.7.26.spec.cjs, real mouse). The fix is SHRINK-TO-FIT. Long text (288 chars incl. head marker LONGTEXT1726 and tail "tail 42.") in a callout created at 170x49.5px (90x26.2pt): the committed box keeps its created size and the font auto-shrinks (measured fontSize 4px at 189% zoom, ~7 wrapped tiny lines), ALL text inside the box: overBottom=0px, overRight=0px, clipped=0px, full 288/288 chars present - nothing paints over the page content, and nothing is clipped away. TEXTBOX: the committed box auto-grows WIDTH (172 -> 604.4px) and fits the whole text on one tiny line inside it (same 0/0/0 containment, full text). Both hold after Save As + close tab + reopen (0/0/0, text intact - the baked box carries the fitted geometry). SHORT controls regressed nothing: "SHORT 1726" callout and "SHORT TB 1726" textbox fit at normal font with 0/0/0. Screenshots: def-163-1726-long-committed.png, def-163-1726-long-callout-crop.png, def-163-1726-long-textbox-crop.png, def-163-1726-long-reopened.png, def-163-1726-reopen-callout-crop.png, def-163-1726-control-callout.png, def-163-1726-control-textbox.png. Observation for the orchestrator (not a defect against the stated expected outcome "text stays contained within the box"): the chosen resolution shrinks the font to ~4px screen (~2pt) instead of growing the box - contained but very small; grow-the-box would be the more readable behavior if the operator prefers it. No pageerrors.

## DEF-160: Move + Confirm on a committed textbox / rect / ellipse silently REVERTS the move (content snaps back to the old position)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe, FileVersion 1.7.24).
2. Open the report.pdf sample, scroll to page 4.
3. Arm the annotation Text-box tool, click the page, type "MOVE ME TB-42", click Confirm. The committed textbox renders at, say, screen (479, 314).
4. Arm the Select tool, press the textbox, drag it ~150px right / ~100px down (the box follows the cursor LIVE â€” verified), release. The selection bar shows Confirm / Edit / Delete.
5. Click Confirm.

Expected: The textbox commits at the NEW position (the delete + re-create with moved geometry the overlay performs on Confirm).

Actual: The textbox SNAPS BACK to its original position the moment Confirm is clicked. The DOM renders the box at the original rect, the engine state is byte-identical to the pre-move state (rects[0] = the ORIGINAL geometry), no toast, no error. The user's move is silently lost. Measured (e2e/retests/qa_unified_1724_repro.spec.cjs T2/T5): before (479.2, 314.4) -> pending after drag (629.2, 414.4) -> after Confirm (479.2, 314.4); engine rects[0] unchanged (122.4, 118.8). Same revert reproduces for rect and ellipse (T5 matrix: confirmRender.atNewPosition=false, element back at the pre-move rect); save + reopen of a moved textbox keeps the OLD position too (T6). The edit-mode add-box and the edit-text run are NOT affected (T7: both persist the move). Root cause (code): the drag path `moveAnnotation` (src/renderer/annotations/geometry.ts) shifts only the renderer-native geometry key (`rect`, or `at` for note) on a SPREAD copy of the annotation â€” the stale wire-shape `rects[0]` array (added by the IPC round-trip's `annotationFromWire` backfill) stays on the object at its OLD position. `confirmPendingAnn` re-creates via `onCreate({...nextAnn})`; the backend's `normalizeAnnotationPayload` (src/main/services/annotations.ts) prefers `payload.rects` over `payload.rect` when both are present, so the annotation is re-created at the OLD rects[0] position. The fix must clear/rewrite the stale `rects` key when re-creating from a moved annotation (or make the backend prefer `rect` when both are present).

Screenshot: screenshots/def-160-t2-textbox-moved-pending.png (box at the new position pre-confirm), screenshots/def-160-t2-textbox-after-confirm.png (box snapped back to the original spot)

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T2 + T5 matrix: textbox/rect/ellipse revert on Confirm; note/arrow/ink keep the move in-session; add-box and text-run unaffected)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V1 + V2, real mouse). TEXTBOX: commit "VERIFY TB 1725" at screen (479.2, 314.4) -> select + press-drag +150/+100 -> pending DOM rect (629.2, 414.4) EXACT (live mid-drag too) -> Confirm -> STAYS (629.2, 414.4), no snap-back (1.7.24 reverted to 479.2, 314.4); engine rects[0] moved 122.4,118.8 -> 201.8,171.7 (the stale rects shadow that caused the revert is gone); Save As + close tab + reopen -> page-local (381.2, 324.4) IDENTICAL pre/post reopen. RECT + ELLIPSE: press-drag +140/+80 -> pending and post-Confirm both at the new position (before 317.4,508.9 -> after 457.4,588.9; ellipse 641.0,508.9 -> 781.0,588.9), engine rects moved for both; save+reopen keeps both at the moved rects (reopened rects == afterConfirm rects exactly, rect AND ellipse). Screenshots: def-160-1725-v1-textbox-{committed,moved-pending,after-confirm,reopened}.png + crops, def-160-1725-v2-{committed,rect-*,ellipse-*,reopened}.png. Regression: the sibling kinds of the same fix round all retested green - note (V3), callout separate moves + no-tear (V4), dblclick color swatches (V5), standalone-arrow shaft grab control (V4b). No pageerrors.

## DEF-161: Callout: after Move + Confirm the BOX snaps back but the ARROW keeps the moved anchor (callout tears apart; the saved PDF bakes the torn geometry)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.24), open the report.pdf sample, go to page 4.
2. Arm the Callout tool, drag from the anchor (page area) to the box position, type text, Confirm.
3. Arm Select, press the callout BOX, drag it ~140px right / ~90px down (box + arrow move together LIVE â€” correct), release.
4. Click Confirm on the selection bar.

Expected: The whole callout (box + leader arrow) commits at the moved position as one unit.

Actual: The box snaps BACK to its original rect while the arrow KEEPS the moved anchor â€” the leader line now points from the old box into empty page text ("torn apart"). Engine state confirms the split: the recreated callout carries rects[0] at the OLD box position but `at` at the NEW anchor. The saved PDF bakes the same torn geometry (/Rect from the stale rects[0], /Callout end from the moved at), so save + reopen keeps the torn state. Root cause: same stale-`rects` shadow as DEF-160 in the delete + re-create commit, compounded by `moveAnnotation` shifting `at` (anchor) but leaving `rects[0]` stale â€” the backend stores rects[0] (/Rect) and at (/Callout end) independently, so the two halves diverge. Additionally the callout's arrow svg is pointer-events:none with no hit line, so the arrow CANNOT be grabbed/moved separately from the box (pressing the shaft hits the textLayer span beneath) â€” the operator's requested "box and arrow movable separately" is not implemented; today they only move together during the drag, then tear apart on Confirm.

Screenshot: screenshots/def-160-t3-callout-after-confirm.png (box back at the original spot, arrow leader pointing at empty text, moved callout text ghosting outside the box)

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T3 + T5 callout rows; engine dump after confirm shows rects at old box + at at new anchor)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V4 + V5 + control V4b, real mouse). (1) ARROW MOVABLE SEPARATELY: hit-test at t=0.15/0.3/0.5/0.65/0.8 along the shaft lands on line.ann-callout-arrow-hit (pe=stroke, 10px) and at t=0.97 on polygon.ann-callout-arrow-head-hit - ALL inside the callout svg (was: textLayer fallthrough, cannot grab); a real shaft press-drag +100/+60 moves the ANCHOR alone (page-local 635.8,478.7 -> 735.8,538.7, exact drag delta; the box stays put) and the selection bar (Confirm annotation move / Edit / Delete) appears; Confirm keeps the moved anchor with the box unmoved. (2) BOX MOVABLE SEPARATELY: press-drag +120/+70 moves the box alone (1063.8,678.7 -> 1183.8,748.7, exact; anchor unmoved at 735.8,538.7). (3) CONFIRM PERSISTS WITHOUT TEARING: after both moves the leader is 233.2px from the moved box edge (entry distance to box 0px) to the moved anchor; engine rects[0] 431.9,311.7 -> 495.4,348.7 AND at 336.6,253.4 -> 389.5,285.2 - both fields carry the moved geometry (the stale-rects tear is gone). (4) SAVE+REOPEN: box page-local (935.8,658.7) and anchor (735.8,538.7) identical pre/post reopen, leader 233.2 intact. Screenshots: def-160-1725-v4-{callout-committed,anchor-moved-alone,anchor-move-confirmed,box-moved-alone,after-confirm,reopened}.png + crops. (5) OPERATOR FEATURE - dblclick toolboxes: committed TEXTBOX and CALLOUT double-click both open the editor (textarea + Confirm/Cancel/Delete) WITH the 9-color swatch row (yellow..gray) + custom hex input; picking teal moves the active swatch ring; Escape closes. Screenshots def-160-1725-v5-dblclk-{textbox,callout}*.png (V5). Side observation (not a defect): the hex field shows the pre-pick value until blur - the draft syncs on blur only. Control: the STANDALONE arrow's shaft grab still works (V4b: elementFromPoint = line.ann-arrow-hit, DOM + engine move). No pageerrors.

## DEF-162: Sticky note: the move survives Confirm in-session but is silently LOST on save (reopened note sits at the old anchor)

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 15 (installed v1.7.24, unified interaction model)

Steps to reproduce:
1. Launch the installed TFlex (FileVersion 1.7.24), open the report.pdf sample, go to page 4.
2. Arm the Sticky-note tool, click the page, type "NOTE MOVE PERSIST 88", Confirm.
3. Arm Select, press-drag the note icon ~150px right / ~100px down, click Confirm on the selection bar. The icon correctly renders at the new position in-session (unlike DEF-160 kinds).
4. Save As, close the tab, reopen the saved file, go to page 4.

Expected: The note persists at the moved anchor.

Actual: The reopened note sits at the PRE-MOVE anchor (before x=479 -> after-move x=629 -> reopened x=479). Root cause: `moveAnnotation` shifts the note's `at` anchor but the wire-shape `rects[0]` (the icon's 24x24 footprint, backfilled by `annotationFromWire`) stays at the OLD anchor; the backend bakes the note's /Rect from `ann.rects[0]` (stale), and on reopen `annotationFromWire` backfills `at` from `rects[0]` â€” the move never reaches the saved PDF. Same stale-`rects` root cause as DEF-160, surfacing on the save path instead of the confirm path (the note's in-session render reads `at`, so Confirm looks correct).

Screenshot: screenshots/def-160-t8-note-reopened.png

History:
- qa: opened (reproduced on installed v1.7.24, e2e/retests/qa_unified_1724_repro.spec.cjs T8: beforeX=479, afterMoveX=629, reopenedX=479)
- qa: CLOSED (retested on installed v1.7.25 = app.getVersion 1.7.25, e2e/retests/def_160_162_verify_1.7.25.spec.cjs V3, real mouse). Note "NOTE VERIFY 1725" committed at (479.2, 269.5) -> select + press-drag +150/+100 -> pending at the new position -> Confirm -> stays; Save As + close tab + reopen -> page-local (381.2, 279.5) IDENTICAL pre/post reopen (1.7.24 reopened at the PRE-MOVE anchor). Engine: after Confirm BOTH at AND rects[0] sit at the moved anchor (201.8, 148.0) - the stale rects[0] that used to win the bake is rewritten; the reopened engine shows the same values. Screenshots: def-160-1725-v3-note-{committed,moved-pending,after-confirm,reopened}.png + crops. No pageerrors.

## DEF-159: Dark mode: committed annotation text-box text is invisible (near-white on paper-white page)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe` â€” the app's default theme is dark; keep it).
2. Open the report.pdf SAMPLE card, scroll to page 3.
3. Arm the annotation "Text box" tool (T icon in the annotation toolbar), click the page, type "DARK BOX TEXT 42", click Confirm.
4. Look at the committed text box on the page; read its computed colors.

Expected: The committed box's text must be readable over the paper-white page in every theme (DEF-099 keeps pages white in dark mode too).

Actual: The committed `.ann-textbox` text renders `rgb(241, 245, 249)` (`--fg-strong`, near-white) over the white page (`rgb(255, 255, 255)` backdrop) â€” INVISIBLE. Root cause: `DomAnnotation`'s committed textbox div relies on the `.ann-textbox { color: var(--fg-strong) }` UI-theme token, which flips to near-white in dark mode while the surface it floats on stays paper-white. This is the committed-annotation counterpart of DEF-158 (note text) and DEF-157 (callout text).

Full dark-mode faint/invisible text inventory measured on v1.7.22 (effective color vs opaque backdrop):
| Surface | Color | Backdrop | Result |
| --- | --- | --- | --- |
| Committed sticky-note text (`.ann-note-text`) | rgb(241,245,249) | white page | INVISIBLE (DEF-158) |
| Committed annotation text box (`.ann-textbox`) | rgb(241,245,249) | white page | INVISIBLE (this entry) |
| Committed callout text (`.ann-callout`) | rgb(203,213,225) | white page | FAINT (DEF-157) |
| "Drag to move" grip label on hover (`.ann-textbox-grip:hover`) | rgb(241,245,249) | white page through rgba(255,255,255,0.04) tint | INVISIBLE (DEF-156) |
| Action-bar buttons (Confirm/Cancel/Delete) | var(--fg) | dark raised chip | visible â€” OK |
| Editor textareas | var(--fg-strong) | dark input bg | visible â€” OK |
Screenshot: screenshots/def-159-c-dark-inventory.png (page 3 with all three committed kinds in dark mode), screenshots/def-156-c-textbox-editor-dark.png

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs, mechanical faint-text scan of page 3 overlays: 3 elements with luminance > 0.6 over a white backdrop â€” the committed note, callout and textbox texts.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4). All three committed kinds now render dark, readable text over the paper-white page in dark mode: sticky note `.ann-note-text` rgb(15,23,42), annotation text box `.ann-textbox` rgb(15,23,42), callout `.ann-callout` rgb(15,23,42) â€” luminance 0.089 each (was 0.83-0.95 near-white). Mechanical faint-text scan of the page-3 overlays: 0 elements with luminance > 0.6 (was 3). Visually confirmed in screenshots/def-159-1723-dark-inventory.png; close-ups def-158-1723-note-text-dark-crop.png and def-157-1723-callout-dark-crop.png. The callout ARROW remains broken (zero length) â€” that half stays tracked in DEF-157. No pageerrors.

## DEF-158: Dark mode: committed sticky-note text is invisible (near-white on paper-white page)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22, default dark theme).
2. Open the report.pdf SAMPLE card, scroll to page 3.
3. Arm the annotation "Sticky note" tool, click the page, type "DARK NOTE TEXT 42", click Confirm.
4. Look at the note's text label next to the icon.

Expected: The committed note text must be readable over the paper-white page in every theme.

Actual: The `.ann-note-text` label renders `rgb(241, 245, 249)` (`--fg-strong`, near-white) with its semi-transparent color-tint backdrop over the white page (`rgb(255, 255, 255)` effective backdrop) â€” the text is effectively INVISIBLE; only a ghost is discernible. Root cause: the note text style is built in `DomAnnotation` (AnnotationOverlay.tsx, noteTextStyle) with `color: "var(--fg-strong)"` â€” a UI-theme token that flips to near-white in dark mode, while the page underneath stays paper-white (DEF-099). Screenshot: screenshots/def-158-c-note-text-dark-crop.png (close-up), screenshots/def-158-c-note-committed-dark.png, screenshots/def-159-c-dark-inventory.png (full page).

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs: computed color rgb(241,245,249), backdrop rgb(255,255,255).)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4). The committed sticky-note label now renders rgb(15, 23, 42) (dark slate, luminance 0.089) over the white page â€” readable; visually confirmed in screenshots/def-158-1723-note-text-dark-crop.png ("DARK NOTE TEXT 42" in dark text on the light tint band). Regression: the note interaction matrix on v1.7.23 is healthy â€” hover cursor grab, drag moves the icon, click opens the note editor (Confirm/Cancel/Delete) with a "Drag to move" grip (round2 W2 + round5 T5). No pageerrors.

## DEF-157: Callout: the arrow does not render (zero-length line at the box corner) and the committed text is faint in dark mode

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card, scroll to page 2.
2. Arm the annotation "Callout" tool. Drag from the anchor point (where the callout should POINT) to the text-box position (~120px away), type "CALLOUT TEXT", click Confirm.
3. Inspect the committed callout: is there an arrow/leader line from the box to the anchor?
4. (Dark mode) repeat on page 3 and read the callout text color.

Expected: A committed callout renders its text box PLUS the leader line and arrowhead from the box edge to the anchor the user dragged from.

Actual:
  (a) NO arrow renders. The committed callout's SVG line has IDENTICAL start and end points (x1==x2, y1==y2; measured line ["601.12","508.64","601.12","508.64"], length = 0) and the arrowhead polygon degenerates to a dot at the box's top-left corner. Root cause: the engine's `normalizeAnnotationPayload` (src/main/services/annotations.ts) DROPS the callout's `at` anchor â€” the internal AnnModel stores only `rects` (the box rect, from payload.rect) and has no `at` field. When the state round-trips back to the renderer, `annotationFromWire` (engineClient.ts) backfills `at` from `rects[0].x/y` â€” the BOX CORNER â€” so `calloutEntryPoint(boxRect, anchor)` returns the box corner itself and the leader line degenerates to zero length. The arrow is broken for every callout created through the UI, not only after save/reopen.
  (b) In dark mode the committed callout text renders `rgb(203, 213, 225)` (`--fg`, light gray) over the paper-white page â€” FAINT (readable only with effort). Root cause: `.ann-callout` sets no text color; the div inherits the UI theme's `--fg` while floating over the white page.
Screenshots: screenshots/def-157-c-callout-dark-crop.png (no arrow + faint text), screenshots/def-157-b-callout-committed.png (light theme, no arrow), screenshots/def-157-c-callout-committed-dark.png

History:
- qa: opened (probes e2e/retests/qa_pmm_b_matrix_1722.spec.cjs + qa_pmm_c_dark_1722.spec.cjs: lineLen=0 in both light and dark runs; text color rgb(203,213,225) on rgb(255,255,255).)
- qa: retested on installed v1.7.23 = FileVersion 1.7.23 (e2e/retests/def_152_159_verify_1.7.23.spec.cjs V4 + round3 T2). PARTIAL FIX â€” REMAINS OPEN for the arrow only. Part (b) FIXED: the committed callout text now renders rgb(15, 23, 42) (luminance 0.089, dark slate) over the white page â€” readable in dark mode (was rgb(203,213,225)); the mechanical faint-text inventory of the page overlays reports 0 items. Part (a) NOT FIXED: the leader line is STILL zero-length â€” the committed callout's `svg.ann-callout-arrow` line has IDENTICAL start and end points (attrs ["138.72","508.64","138.72","508.64"], length 0) and the arrowhead polygon degenerates to a single repeated point at the anchor; no arrow/leader renders (visually confirmed in screenshots/def-157-1723-callout-dark-crop.png â€” text box only, no leader to the anchor). Remaining steps on v1.7.23: dark theme -> open the report.pdf SAMPLE -> page 3 -> arm annotation Callout -> drag from an anchor ~200px away from the box corner -> type text -> Confirm -> read `svg.ann-callout-arrow` line x1/y1/x2/y2 (still identical). Interaction side note: the committed callout is now fully interactive (grab hover, drag-move, click Confirm/Edit/Delete bar + hint, dblclick editor, bar Delete removes it â€” round3 T2).
- qa: CLOSED (retested on installed v1.7.24 = app.getVersion 1.7.24, e2e/retests/def_154_157_verify_1.7.24.spec.cjs T1+T4 + diagnostic def_157_reopen_diag.spec.cjs). Part (a) FIXED â€” the arrow renders with real length, live AND after save/reopen. LIVE: committed callout's `svg.ann-callout-arrow` line (469,858)->(289,748) page-local, length 210.95px (was 0), arrowhead polygon 3 DISTINCT points (proper filled triangle, was 1 repeated point), and the anchor endpoint sits EXACTLY at the dragged anchor (distance 0.0 page-local); visually confirmed in screenshots/def-157-1724-callout-live.png + def-157-1724-callout-live-arrow-zoom.png (blue leader from the box corner to a filled arrowhead pointing at the anchor). SAVE/REOPEN: Save As to a temp file -> close tab -> reopen -> identical line coords (469,858)->(289,748), length 210.95, 3-point polygon; computed styles intact (line stroke rgb(37,99,235) 1.5px visible, polygon fill blue, box border 1.33px solid rgb(37,99,235) + rgba(37,99,235,0.08) tint + text "CALLOUT SAVE 42") â€” the `at` anchor now survives the engine round-trip. Visually confirmed in screenshots/def-157-1724-reopen-diag-crop.png (box + full leader + arrowhead in one frame) and def-157-1724-callout-reopened.png. Part (b) was fixed on v1.7.23. No pageerrors.

## DEF-156: Dark mode: the "Drag to move" grip label becomes invisible when the cursor hovers over it

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22, default dark theme), open the report.pdf SAMPLE card, scroll to page 3.
2. Arm the annotation "Text box" tool and click the page so the floating create editor opens ("Type text..." + Confirm/Cancel/Delete bar).
3. Look at the "DRAG TO MOVE" grip strip above the textarea (visible: dark chip, light-gray label). Move the mouse cursor ONTO the grip strip.
4. Watch the label while hovering.

Expected: The grip label stays readable while hovered (it is the affordance that tells the user the window is draggable).

Actual: On hover the label becomes INVISIBLE. Measured computed styles: non-hover grip `background: rgb(21, 24, 28)`, label `rgb(203, 213, 225)` (visible); hover grip `background: rgba(255, 255, 255, 0.04)` and label `rgb(241, 245, 249)` â€” the hover state swaps the opaque dark chip for a nearly transparent tint (the paper-white page shows through, so the strip turns white) while flipping the label to the dark theme's near-white foreground: white-on-white. Root cause: `.ann-textbox-grip:hover { background: var(--bg-hover); color: var(--fg-strong); }` (styles.css) â€” the hover tokens assume the grip sits on a dark UI surface, but it floats over the paper-white page. Contributing fragility: the non-hover rule `color: var(--fg-soft)` references a token that is NOT DEFINED anywhere in the stylesheet (only --fg/--fg-strong/--fg-muted/--fg-faint/--fg-on-accent exist), so the base label color only renders via CSS invalid-var fallback to inherited color. Affects both the textbox and callout create editors (same grip component). Screenshot: screenshots/def-156-c-grip-hover-dark-crop.png (hover state â€” label is a barely-visible white smear over the page text), screenshots/def-156-c-textbox-editor-dark.png (full editor, dark).

History:
- qa: opened (probe e2e/retests/qa_pmm_c_dark_1722.spec.cjs: non-hover vs hover computed styles as above.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V3). The hover state no longer swaps the opaque chip for a transparent tint: non-hover grip bg rgb(10,12,15) / label rgb(203,213,225); HOVER grip bg rgb(21,24,28) (still opaque dark) with label rgb(241,245,249) â€” measured label-vs-backdrop luminance contrast 0.866 (was white-on-white over the page). Visually confirmed in screenshots/def-156-1723-grip-hover-dark-crop.png: "DRAG TO MOVE" clearly readable while the cursor sits on the grip, in dark mode, over a white page.

## DEF-155: Add-box: stale artifact of the moved box lingers at the original rect after drag-release

- Status: CLOSED
- Severity: LOW
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card, scroll to page 1.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box". Drag a ~150x90 box, type "MOVE TEST 88", Apply.
3. Drag the committed box BODY +200/+120 and release; watch the original rect.

Expected: On release the box and its content are at the new rect only; the original rect is immediately clean (the box moves as one unit, no residual copy).

Actual: CONFIRMED, transient. The DOM mirror and registry follow the drag live (mid-drag DOM rect = start+100/+60, pre-release = start+200/+120), but at the instant of release the page CANVAS at the ORIGINAL rect still paints the old baked "MOVE TEST 88" â€” canvas pixel sampling of the old-rect interior reads darkFraction 4.5% at t=0, dropping to 0 by t~150ms â€” and in un-instrumented captures the whole painted frame (box + Edit/Delete bar at the OLD rect) persisted across 80ms/600ms/1600ms screenshots while the DOM already reported the moved rect, before the paint caught up (~2s). Visually: the box appears to sit at the old position after release, then jumps to the new one. Root cause direction: the DEF-145 white eraser cover (`.edit-box-eraser`) unmounts at pointerup (textBoxDrag -> null) BEFORE the async engine mask-and-draw + pdf.js proxy refresh repaints the page, so the pre-move baked text is exposed in that window. Self-heals; no data impact. Screenshots: screenshots/def-155-d-middrag-live.png (drag follows live), screenshots/def-155-d-release-300ms.png / -1800ms.png / -3900ms.png (paint catch-up), screenshots/def-155-a-after-release-600ms.png (un-instrumented capture still showing the old-rect frame).

History:
- qa: opened (probes e2e/retests/qa_pmm_a_addbox_1722.spec.cjs + qa_pmm_d_artifact_1722.spec.cjs: DOM live-follow confirmed; canvas darkFraction at R0 0.0451 -> 0 within ~150ms; painted-frame lag observed up to 1.6s in un-instrumented captures.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V1 + round2 W1 + round3 T1 + round4 T4b). The move flow now has an explicit Confirm step (DEF-152) and NO stale artifact is visible at any instant, in any path: (1) at release the canvas at the old rect still carries the baked text (darkFraction 0.0451) but the `pointer-events:none` `.edit-box-eraser` cover (exactly 150x90 at R0) hides it â€” full-window screenshots at 80ms/600ms/1600ms after release show the box ONLY at the new rect (def-155-1723-release-*.png); (2) clicking Confirm bakes the move: canvas darkR0 0.0451 at t=500ms -> 0.0 from t=750ms, stable through 4s and through a forced scroll-away/scroll-back re-render (def-155-1723b-postconfirm-*.png, def-155-1723b-after-rerender.png, def-155-1723c-*); (3) the release-then-DESELECT path (never clicking Confirm) is also safe â€” the eraser keeps covering R0, the Confirm/Edit/Delete bar stays open, and a forced re-render bakes the move cleanly (darkR0=0, box only at the new spot; def-155-1723d-after-deselect.png / -after-rerender.png); (4) DOCUMENT SAFETY: Save As -> re-open shows exactly ONE visible "MOVE TEST 88" at the moved position (canvas darkFraction 0.233 at the run rect, title control 0.207, old rect 0.0) â€” screenshots/def-155-1723c-reopened-run-crop.png. No pageerrors.

## DEF-154: Rectangle / Ellipse / Arrow / Pen ink: committed shapes cannot be selected, moved, resized or deleted from the page (click-transparent)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card, scroll to page 4/5.
2. Place a Rectangle, an Ellipse, an Arrow and a freehand Pen stroke via the annotation toolbar (each commits immediately on drag-release).
3. With the Select tool armed: hover each committed shape; single-click it; double-click it; press on it and drag.
4. Repeat with the shape's own tool armed.

Expected (operator's Acrobat-style model): hovering a committed shape shows a palm/grab cursor; single-click selects it and makes it movable (with an action bar); double-click opens its edit toolbox; it can be resized and deleted from the page.

Actual: NOTHING is interactive. Every committed shape element reports `pointer-events: none` (rect/ellipse `.ann-shape`, ink `.ann-ink`, arrow `.ann-arrow` line+polygon â€” styles.css), so hover falls through to the textLayer underneath (measured hover cursor = "text" over a text span; "crosshair" while the shape's tool is armed), single-click produces NO selection and NO action bar (0 bars), double-click opens NO toolbox (0 bars), and a press-drag moves NOTHING (geometry before == after; moved=false for rect, ellipse, arrow, ink). There are no resize handles for shapes anywhere. The only delete path is the side AnnotationsPanel row button, which is not the page-canvas interaction the operator specified. The committed annotation text box behaves identically (pe=none, no hover, no select, no move). Root cause: the annotation overlay only implements CREATE for the shape tools; committed SVG shapes are painted `pointer-events: none` with no selection/move/delete affordance on the canvas.

Matrix measured on v1.7.22 (select tool armed):
| Kind | Hover cursor | Click -> bar | Dblclick -> toolbox | Movable | Resizable |
| --- | --- | --- | --- | --- | --- |
| rect | "text" (textLayer fallthrough) | no (0 bars) | no (0 bars) | no | no |
| ellipse | "text" | no | no | no | no |
| arrow | "text" | no | no | no | no |
| ink | "text" | no | no | no | no |
| annotation textbox | "auto"/"text" | no | no | no | no |
| callout | "text" | no | no | no | no |
| sticky note | "pointer" | yes (note editor: Confirm/Cancel/Delete) | same editor | no | no |
| add box (edit tool) | "move" | select + immediate move-drag; release-without-move opens editor | editor | YES (drag follows live) | corner handles when selected |
Screenshots: screenshots/def-154-b-shapes-committed.png, screenshots/def-154-b3-shapes.png

History:
- qa: opened (probes e2e/retests/qa_pmm_b2_note_shapes_1722.spec.cjs + qa_pmm_b3_ellipse_arrow_ink_1722.spec.cjs: pe=none, hover fallthrough, 0 bars, moved=false for all four shape kinds.)
- qa: retested on installed v1.7.23 = FileVersion 1.7.23 (e2e/retests/def_152_159_verify_1.7.23.spec.cjs V2 + round2 W2 + round3 T2/T3, kind-strict element discovery). PARTIAL FIX â€” REMAINS OPEN for (1) the arrow kind and (2) resize. Current matrix, Select tool armed:
  | Kind | Hover cursor | Click -> bar | Dblclick -> toolbox | Movable | Deletable from canvas | Resizable |
  | --- | --- | --- | --- | --- | --- | --- |
  | rect | grab | Confirm/Edit/Delete (.ann-content-action) + "Double click to edit" hint | shape-color-editor | YES | YES (bar Delete) | NO |
  | ellipse | grab | same | shape-color-editor | YES | YES | NO |
  | ink | grab (path.ann-ink-hit, pe=stroke) | same | shape-color-editor | YES | YES | NO |
  | callout | grab | Confirm/Edit/Delete + hint | ann-textbox-wrap editor | YES | YES | n/a |
  | textbox | grab | Confirm/Edit/Delete + hint | ann-textbox-wrap editor | YES | YES (bar Delete) | n/a |
  | note | grab | note editor (Confirm/Cancel/Delete) | same editor | YES (drag) | YES (editor Delete) | n/a |
  | arrow | NO â€” falls through to the textLayer ("auto"/"text") | NO (0 bars, 0 hint) | NO | NO | NO | NO |
  Remaining steps to reproduce on v1.7.23: (1) ARROW â€” arm annotation Arrow, drag a line on the page, arm Select, hover/click/double-click/drag the committed line: elementFromPoint returns the textLayer span, cursor auto/text, no bar, no movement (measured at t=0.3/0.5/0.7 along the diagonal; the `g.ann-arrow` wrapper reports pointer-events:auto but its line/polygon children are not hit-testable). (2) RESIZE â€” select a committed rect/ellipse/ink stroke and scan the DOM for handle-like elements: a document-wide scan for `[class*=handle], [class*=resize], [class*=grip]` finds ONLY the four page-corner `.content-resize-handle` elements (~1000px away); nothing near the selected shape, and dragging where a BR handle would be changes w/h by 0 (the add-box `.edit-box-handle-*` corners are the only content handles that exist). Screenshots: def-154-1723b-rect-selected.png (selected rect: Confirm/Edit/Delete bar + hint, NO handles), def-154-1723c-arrow-selected.png / -arrow-after-delete.png, def-154-1723b-all-committed.png.
- qa: CLOSED (retested on installed v1.7.24 = app.getVersion 1.7.24, e2e/retests/def_154_157_verify_1.7.24.spec.cjs T2+T3). Both remaining halves FIXED. (1) ARROW â€” with Select armed, hover at t=0.3/0.5/0.7 along the line reports cursor "grab" with elementFromPoint = `line.ann-arrow-hit` (pe=stroke) resolving inside `[data-kind="arrow"]` â€” NO textLayer fallthrough at any probe point; single-click opens the Confirm/Edit/Delete action bar; press-drag +70/+45 moves the arrow by exactly (+70,+45); bar Delete removes it (element gone, page visually clean). Screenshots: def-154-1724-arrow-hover.png, -arrow-selected.png (selection rect + handles + Confirm/Edit/Delete bar), -arrow-moved.png, -arrow-after-delete.png. (2) RESIZE â€” selecting a committed rect/ellipse/ink now renders FOUR 10x10 corner handles (.content-resize-handle-nw/ne/sw/se) at the shape's bbox corners (visually confirmed in def-154-1724-rect-selected-crop.png and -ink-selected-crop.png: dark square handles + Confirm/Edit/Delete bar + "Double click to edit" hint), and dragging the SE handle actually resizes the geometry: rect dw/dh +32/+22, ellipse +32/+22, ink +31/+20 (screenshots def-154-1724-{rect,ellipse,ink}-resized.png). Full v1.7.24 matrix: every committed kind (rect, ellipse, arrow, ink, callout, textbox, note) is grab-hover/selectable/movable/deletable per the v1.7.23 round2/round3 results, and shapes/ink are now also resizable â€” the operator's Acrobat-style model is complete. No pageerrors.

## DEF-153: Placeable-content interaction model is inconsistent: no palm/grab hover cursor, no double-click-to-edit toolbox, no "Double click to edit" hint, "Drag to move" grip only on 2 of 4 editors

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22), open the report.pdf SAMPLE card.
2. For each placeable kind, commit one instance and probe: hover cursor (elementFromPoint + computed cursor), single-click, double-click.
3. With a committed add-box selected and being moved (mid-drag and after release), scan every text node in the DOM for a "double click to edit"-style cursor hint.
4. Open each floating editor and check for a "Drag to move" grip label.

Expected (operator's Acrobat-style model, same for every kind): hover -> palm/grab cursor; single-click -> select + movable with a Confirm/Edit/Delete action bar; double-click -> edit toolbox; while movable, a "Double click to edit" cursor message.

Actual: The model is not implemented for most kinds and is inconsistent where it exists:
  (a) NO kind shows a palm/grab cursor on hover over the committed content. Add box shows the 4-arrow `move` cursor; sticky note shows `pointer`; all other kinds fall through to the textLayer (`text`/default) or crosshair while a tool is armed. `cursor: grab` exists only on floating-window CHROME (editor toolbars/bars), never on committed content.
  (b) Double-click opens a toolbox for NO committed kind: add-box dblclick just re-triggers the single-click editor (the editor actually opens on the FIRST click when the release has no movement); committed shapes/callout/textbox are click-transparent (DEF-154); sticky note dblclick = the same note editor its single click already opened.
  (c) The "Double click to edit" cursor message DOES NOT EXIST anywhere in the app â€” a full DOM text scan mid-drag (box selected + movable) and after release found zero matches for /double.?click/i, and a source scan of src/renderer finds no such string.
  (d) The "Drag to move" grip label exists ONLY on the annotation textbox and callout CREATE editors (measured gripLabels=["Drag to move"]). The note editor has NO grip label (drag is invisible chrome), and the add-box/Edit-text inline editor has NO grip label either (its toolbar is grab-able but unlabelled) â€” three different drag affordances for four floating editors.
  (e) Edit text tool: hover = crosshair + underline hint (not grab); single click opens the inline editor (Cancel/Apply) â€” no select+movable state for the text run itself.
Root cause direction: the operator's unified interaction model was never implemented as a shared behavior; each tool family (edit boxes, annotations, note) grew its own ad-hoc hover/select/drag wiring. Screenshots: screenshots/def-153-a-addbox-dblclick.png, screenshots/def-153-b-movable-selected.png, screenshots/def-153-e-edittext-hover.png, screenshots/def-153-e-edittext-toolbox.png

History:
- qa: opened (probes e2e/retests/qa_pmm_a/b/b2/b3/e 1.7.22 specs; hover cursors, dblclick bars and hint scans measured live on the installed binary.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V2 + round2 W2 + round3 T2 + round4 T4a + round5 T5). All five original complaints are fixed:
  (a) hover cursor is now `grab` on every interactive committed kind â€” add-box div.edit-box, edit-text div.edit-text-hover, textbox .ann-textbox, callout .ann-callout, note .ann-note, rect/ellipse .ann-shape, ink path.ann-ink-hit (measured via elementFromPoint + computed cursor; was move/pointer/text fallthrough).
  (b) double-click opens a toolbox on every interactive kind: add-box -> .edit-inline-editor (Cancel/Delete/Apply), edit-text -> .edit-inline-editor (Cancel/Apply), textbox/callout -> .ann-textbox-wrap editor (Confirm/Cancel/Delete), note -> note editor, rect/ellipse/ink -> .shape-color-editor swatch toolbox.
  (c) the "Double click to edit" cursor hint now EXISTS and renders with the selection/drag on add-box, edit-text, textbox, callout, rect, ellipse, ink (and mid-drag on note) â€” full text-node scan hit.
  (d) ALL FOUR floating editors now carry a "Drag to move" grip label: textbox create editor (ann-textbox-grip-label), callout create editor (same), note editor (content-grip + content-grip-label), add-box inline editor (content-grip-inline) â€” screenshots/def-153-1723e-note-editor.png, def-153-1723d-textbox-editor.png.
  (e) edit-text hover is grab (was crosshair) and single-click now selects with a Confirm/Edit/Delete bar (.edit-textrun-bar) + hint.
  Caveats recorded, tracked under DEF-154 (not part of the original (a)-(e) complaints): the ARROW kind is still fully click-transparent (no grab/selection/toolbox â€” DEF-154); resize handles on selection exist only on the add-box (shapes/textbox/callout/note/edit-text show none â€” DEF-154); the note's single-click opens its editor (Confirm/Cancel/Delete) directly rather than a bare select state, but the note is grab-hoverable, drag-movable and dblclick-re-editable. Visual evidence: def-152-1723-actionbar-crop.png (selected add-box with Confirm/Edit/Delete + handles + hint badge), def-153-1723c-callout-selected.png (selected callout with bar + hint).

## DEF-152: Add-box: after drag-moving a box, the box's own action bar offers only Edit + Delete â€” no Confirm

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.22)

Steps to reproduce:
1. Launch TFlex (installed v1.7.22 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card, scroll to page 1.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box". Drag a ~150x90 box on the page, type "MOVE TEST 88", click Apply. A committed `.edit-box` renders.
3. Press on the box BODY and drag it +200/+120 (the drag follows live), then RELEASE the mouse.
4. Inspect the action bar that appears under the box.

Expected (operator's Acrobat-style model): the movable/selected box carries a Confirm / Edit / Delete action bar.

Actual: The bar under the moved box carries EXACTLY two buttons â€” "Edit" (aria "Edit text box", data-edit-box-action=edit) and "Delete" (aria "Delete text box", data-edit-box-action=delete). No Confirm button exists anywhere in the DOM at that moment (confirmAnywhere=false; the floating editor's `data-edit-confirm` affordance only appears after dragging the editor WINDOW). The move is committed silently on release with no explicit confirm step on the box itself. Double-clicking the box opens the floating editor instead, whose buttons are "Cancel / Delete / Apply" (Apply, not Confirm â€” a third action vocabulary). Root cause: `TextBoxToolbar` (src/renderer/edit/EditOverlay.tsx) renders only onEdit/onDelete; the post-move commit is implicit in the pointerup handler. Screenshots: screenshots/def-152-a-actionbar-crop.png (the Edit/Delete bar under the moved box), screenshots/def-152-a-actionbar-after-release.png

History:
- qa: opened (probe e2e/retests/qa_pmm_a_addbox_1722.spec.cjs on the installed binary: box moved dx=200 dy=120; bar buttons = [Edit, Delete]; confirmAnywhere=false.)
- qa: CLOSED (retested on installed v1.7.23 = FileVersion 1.7.23, e2e/retests/def_152_159_verify_1.7.23.spec.cjs V1 + round2 W1/T1). After dragging the committed box body +200/+120 (real mouse; the drag follows live) and releasing, the bar under the moved box now carries EXACTLY three buttons: "Confirm" (aria "Confirm move", data-edit-box-action=confirm), "Edit" (aria "Edit text box") and "Delete" (aria "Delete text box") â€” hasConfirm=true hasEdit=true hasDelete=true. Visually confirmed in screenshots/def-152-1723-actionbar-crop.png (blue Confirm + Edit + red Delete under the selected box, with 4 corner handles and the "Double click to edit" badge). Regression around the fix: Confirm genuinely commits the move (old rect canvas clears by ~750ms and stays clean; saved+reopened file shows exactly ONE visible "MOVE TEST 88" at the moved spot, old rect clean â€” screenshots/def-155-1723c-reopened-run-crop.png); Edit opens the floating editor (dblclick -> .edit-inline-editor Cancel/Delete/Apply); the select state (bar + handles + hint) appears on single-click (round2 W2 addbox). No pageerrors.

## DEF-151: Edit-text: moving the floating toolbox and confirming DUPLICATES the text run (the original stays), and the duplicate is baked into the saved PDF

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 10 (edit content) / 14 (installed v1.7.18)

Steps to reproduce:
1. Launch TFlex (installed v1.7.18 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`) -> wait for the Edit toolbar -> click "Edit text" (`[data-edit-tool="text"]`).
3. Click the page-1 title run "TFlex Technical Report". The inline editor opens pre-filled with that text.
4. Replace it with "NEW TITLE 123", click Apply (`[aria-label="Apply edit"]`). The page renders "NEW TITLE 123".
5. RE-CLICK the edited "NEW TITLE 123" run; the inline editor reopens (now correctly showing "NEW TITLE 123" â€” DEF-149(a) is fixed).
6. GRAB the toolbox chrome (`[data-edit-drag-handle]`, a non-control point) and drag it +200/+120; release. The editor window follows (the Apply control becomes `data-edit-confirm="true"`, aria-label "Confirm move").
7. Confirm (click `[data-edit-confirm]` / Ctrl+Enter). Inspect page 1; then Save-As (`[aria-label="Save As"]`) to a temp path and re-open the saved file; inspect page 1 again.

Expected: Moving the toolbox and confirming RELOCATES the text run â€” it lands at the moved position and the original position is cleared (guardrail #4: the window and its committed content move as one).

Actual: A new "NEW TITLE 123" run commits at the moved rect (x=794, y=444), but the ORIGINAL "NEW TITLE 123" run at (x=594, y=325) is NOT removed. Page 1 now has TWO "NEW TITLE 123" runs (textLayer = "TFlex Technical ReportA study in PDF orchestration and performance.NEW TITLE 123NEW TITLE 123"). DOCUMENT-SAFETY: the duplicate is BAKED into the saved PDF â€” after Save-As -> re-open, page-1 textLayer still contains "NEW TITLE 123" twice (count = 2). The move duplicates rather than relocates the content.
Root cause direction: the move+confirm commit (`EditOverlay.tsx` onCommit -> onCommitTextEdit) draws a new run at `commitRect` (the anchor rect shifted by the toolbox drag offset) but never removes the previously-committed run at the original rect; `engine.editTextRun` masks/overwrites only the ORIGINAL page text it replaced, not a run committed in a previous edit pass â€” so each move+confirm appends another copy.
Screenshot: screenshots/def-149-1718-after-move-confirm.png (two "NEW TITLE 123" â€” top + moved), screenshots/def-149-1718-editor-toolbox-moved.png (toolbox moved, ghost preview at the moved rect). Fixture: test-fixtures/edittext-move-duplicate-bake.pdf (saved output carrying the duplicate).

History:
- qa: opened (reproduced on installed v1.7.18 while retesting DEF-149. Move+confirm with the "Confirm move" affordance AND via Ctrl+Enter both leave the original "NEW TITLE 123" run in place and commit a second copy at the moved rect; page-1 textLayer shows "NEW TITLE 123" twice, and the saved file re-opens with 2 occurrences â€” HIGH (silently bakes duplicate content into the user's document). This is the edit-text counterpart of DEF-150 (add-box duplicate-bake).)
- qa: retested on installed v1.7.19 (e2e/retests/def_149_verify_1.7.19.spec.cjs). STILL FAILS. After editing the title to "NEW TITLE 123" + Apply, re-clicking the run (editor shows the NEW text â€” DEF-149(a) fixed), then moving the toolbox +200/+120 and clicking the "Confirm move" affordance (`data-edit-confirm="true"`, aria-label "Confirm move"): the original "NEW TITLE 123" stays at (x=594,y=325) and a second copy is committed (page-1 textLayer = "â€¦NEW TITLE 123NEW TITLE 123", occurrences=2). The duplicate is BAKED into the saved PDF: pdfjs parse of the saved bytes reports 2 occurrences, and the reopened app tab reports 2. The move duplicates rather than relocates. (The two runs land on the SAME rect on v1.7.19, so the page visually shows a single "NEW TITLE 123", but the text content stream carries two.) Fixture: test-fixtures/edittext-move-duplicate-bake-1719.pdf.)
- qa: retested on installed v1.7.20 (e2e/retests/def_151_verify_1.7.20.spec.cjs). STILL FAILS. Edit title -> "NEW TITLE 123" + Apply, re-click the run (editor shows NEW text â€” DEF-149(a) fixed), drag the toolbox chrome +200/+120 (the editor window moves dx=200 dy=120, ghost preview shows the text at the moved rect), then click the "Confirm move" affordance (`data-edit-confirm="true"`): the committed "NEW TITLE 123" run is at the SAME rect as before the move (posBefore {x:594,y:325} -> posAfter {x:594,y:325}, rect shift dx=0 dy=0) â€” the text does NOT relocate â€” and page-1 textLayer = "â€¦NEW TITLE 123NEW TITLE 123" (occurrences=2). DOCUMENT-SAFETY: the duplicate is BAKED â€” pdfjs parse of the saved bytes lists the page-1 items as ["TFlex Technical Report","","A study in PDF orchestration and performance.","","NEW TITLE 123","","NEW TITLE 123"] (2 occurrences), and the reopened app tab reports 2. The move duplicates rather than relocates; on v1.7.20 both copies land on the SAME rect (594,325) so the page visually shows a single "NEW TITLE 123" but the content stream carries two. Fixture: test-fixtures/edittext-move-duplicate-bake-1720.pdf.)
- qa: CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_151_verify_1.7.21.spec.cjs). ACCEPTANCE = orchestrator-adjudicated mask-only semantics: after edit-text move+confirm the text must RELOCATE by ~the drag delta (dx~200, dy~120) and there must be EXACTLY ONE VISIBLE "NEW TITLE 123" (the old position white-masked, NOT stacked on the original rect); extraction count is NOT asserted to be 1 (the content stream always carries the masked old run â€” documented DEF-116 limitation). RESULT: PASS. Edit title -> "NEW TITLE 123" + Apply, re-click the run (editor shows NEW text), drag the toolbox chrome +200/+120 (the editor window moved dx=200 dy=120; the Apply control flipped to `data-edit-confirm="true"`, aria-label "Confirm move"), click Confirm-move. The committed "NEW TITLE 123" run RELOCATED: run-before {x:594,y:325} -> moved run {x:794,y:444}, shift dx=200 dy=119 (relDx=200 relDy=119) â€” the text follows the toolbox delta. VISIBLE result is ONE run at the new spot: canvas pixel-sampling of the page-1 canvas shows the OLD rect (594,325) white-masked (darkFraction=0.0, no glyphs) and the MOVED rect (794,444) carrying visible dark text (darkFraction=0.1949); visibleCount=1 (the second textLayer span at the old rect is the transparent/masked run, not visible). Document safety: Save-As -> re-open, the VISIBLE result persists (old rect darkFraction=0.0, moved rect darkFraction=0.1949, visibleCount=1; stable across 3 probes 400ms apart). Extraction count on the reopened saved file is 2 in the content stream (masked old run remains, DEF-116) â€” accepted, not asserted. No pageerror ("Invalid page request"/degreeAngle/NaN/React #310/#520). Screenshots: screenshots/def-151-1721-after-move-confirm.png (ONE "NEW TITLE 123" at the moved spot, old rect cleared), screenshots/def-151-1721-saved-reopened.png (same after save+reopen). Regression note: this retest covers the edit-text move+confirm path only; DEF-150 (add-box toolbox move, sibling commit path) was NOT re-verified in this run and remains OPEN.)

## DEF-150: Add-box: moving the floating toolbox does not move the content box (it sticks), and confirming bakes a large duplicate text run into the saved PDF

- Status: CLOSED
- Severity: HIGH
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 3)
- Phase: 10 (edit content / add text box) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Edit content toggle (`[data-toolbar-edit-toggle]`) -> "Add box" (`[data-edit-tool="box"]`). Drag a rectangle on page 1 (~150x90), type "MOVE TEST 88", click Apply. A committed text box (`.edit-box[data-edit-box-id]`) renders at R0.
3. Click the placed box once; the floating inline editor (toolbox) reopens at R0 (mode "edit", rect = R0, text "MOVE TEST 88").
4. GRAB the toolbox chrome (`[data-edit-drag-handle]`, a non-control point) and drag it +200/+120; release. The editor WINDOW follows the cursor.
5. Confirm the editor (Ctrl+Enter / Apply). Inspect the page.

Expected: Moving the toolbox moves the CONTENT with it (the box follows the toolbox), and there is a "Confirm" button to commit the new position (operator's stated intent).

Actual:
  (a) The content box does NOT move with the toolbox â€” after confirming, `.edit-box` stays at its ORIGINAL rect R0 (measured {x:572,y:445,w:150,h:90} unchanged; boxStayedAtOriginal=true, boxMovedWithToolbox=false). The toolbox's drag offset only repositions the editor WINDOW; the commit always uses `textTarget.rect` (the original box rect) and ignores the drag offset.
  (b) There is NO dedicated "Confirm" button to commit a box move â€” only the inline editor's Apply/Ctrl+Enter, which commits at the original rect.
  (c) Confirming after the toolbox move re-bakes a LARGE duplicate "MOVE TEST 88" text run onto the page, overlapping the page content (visually a large "MOVE TEST 88" drawn over the body text). Re-opening a committed box sets `mode = "edit"` (initialText length > 0), so the commit routes through `onCommitTextEdit` (the text-run replacement path, EditOverlay.tsx:942-947) instead of the box-update path. DOCUMENT-SAFETY check: page-1 textLayer contains TWO "MOVE TEST 88" occurrences AFTER the toolbox-move+confirm, and this persists after Save-As -> re-open (verified: 2 occurrences before save AND 2 after re-open of the saved file) â€” the duplicate text run is BAKED into the saved PDF.
  (d) Control (independent path): moving the COMMITTED BOX ITSELF works correctly â€” re-arm the box tool, drag the box +150/+100 + Ctrl+Enter moves it to R1; drag again +80/+60 moves it to R2 (content updates on each move). So the defect is specifically the floating-toolbox move+confirm path, not the direct box-drag path.
Root cause direction: the `drag.offset` from `useDragWindow` (DEF-140/DEF-147) repositions only the `.edit-inline-editor` window (EditInlineEditor.tsx:242); the commit payload (`EditOverlay.tsx:940-972`) always uses `textTarget.rect`, so the content never follows the toolbox. Re-opening a committed box flips to mode "edit", routing the commit to the text-run path and re-baking a duplicate run (appearing at the box rect but at a larger text scale).
Screenshot: screenshots/gt-bug3-1717-editor-toolbox-moved.png (toolbox moved, content box still at original), screenshots/gt-bug3-1717-after-toolbox-move-confirm.png (content box at original + large duplicate "MOVE TEST 88" over the page), screenshots/gt-bug3-docsafety-after-toolbox-confirm.png / gt-bug3-docsafety-reopened.png (duplicate persisted in the reopened saved file), screenshots/gt-bug3-1717-box-move-1-confirm.png / gt-bug3-1717-box-move-2-confirm.png (direct box-drag works â€” the control). Fixture: test-fixtures/duplicate-textbox-toolboxmove-bake.pdf (saved output carrying the duplicate).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_addbox_1717.spec.cjs + e2e/gt_bug3_docsafety_1717.spec.cjs. Moving the toolbox moves the editor window (dx=200 dy=120) but the committed box STAYS at R0. Confirming after the toolbox move re-bakes a large duplicate "MOVE TEST 88"; the saved file re-opens with 2 "MOVE TEST 88" occurrences â€” HIGH (silently bakes duplicate content into the user's document). Direct box-drag + confirm works and updates on subsequent moves (control).)
- qa: CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_150_verify_1.7.21.spec.cjs). ACCEPTANCE = visible-copy semantics per the DEF-151 orchestrator adjudication: after add-box move+confirm the box content must RELOCATE by ~the drag delta (dx~200, dy~120) and there must be EXACTLY ONE VISIBLE "MOVE TEST 88" (old rect cleared, NOT stacked); extraction count is NOT asserted (the task's rule). RESULT: PASS. Add box -> "MOVE TEST 88" -> Apply, re-click the committed box (editor reopens with the box text, mode "edit"), drag the toolbox chrome +200/+120 (the editor window moved dx=200 dy=120; the Apply control flipped to `data-edit-confirm="true"`, aria-label "Confirm move"), click Confirm-move. The committed box RELOCATED: box surface {x:572,y:445} -> {x:772,y:565}, shift dx=200 dy=120 â€” the box follows the toolbox delta. EXACTLY ONE visible copy: `.edit-box[data-edit-box-id]` surfaceCount=1, page-1 content-stream "MOVE TEST 88" runs=1 at the moved rect (distToOld=204, distToMoved=116), and the OLD rect is cleared (the underlying "â€¦orchestration and performance." body text is visible again â€” no box left behind). Document safety: Save-As -> re-open, the box persists as ONE VISIBLE "MOVE TEST 88" at the moved spot (canvas darkFraction=0.2384 at the run rect, visibleCount=1); extraction count on the reopened saved file = 1 (reported INFO only, not asserted â€” the add-box registry path draws the box once, no masked old run). No pageerror ("Invalid page request"/degreeAngle/NaN/React #310/#520). Screenshots: screenshots/def-150-1721-after-confirm.png (ONE "MOVE TEST 88" at the moved spot, old rect cleared), screenshots/def-150-1721-saved-reopened.png (same after save+reopen). This closes the add-box toolbox-move+confirm path (DEF-150); the edit-text sibling (DEF-151) was already CLOSED on v1.7.21.

## DEF-149: Edit-text: re-clicking an edited text run opens the editor with the OLD text, not the new text

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 2)
- Phase: 10 (edit content) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Edit text" (`[data-edit-tool="text"]`).
3. Click the page-1 title run "TFlex Technical Report". The inline editor opens with that text.
4. Replace it with "NEW TITLE 123", click Apply (`[aria-label="Apply edit"]`). The page renders "NEW TITLE 123".
5. Now RE-CLICK the edited text run "NEW TITLE 123". Read the inline editor's textarea value.

Expected: The editor re-opens showing the NEW text "NEW TITLE 123".

Actual: The editor re-opens showing the OLD text "TFlex Technical Report". Measured: after the commit, page-1 textLayer = "TFlex Technical Report A study in PDF orchestration and performance. NEW TITLE 123" (BOTH old and new strings present); clicking the "NEW TITLE 123" span opens the editor with `textareaValue = "TFlex Technical Report"` (the OLD title). Root cause: `engine.editTextRun` (Phase 10) MASKS the old run's rect (white fill) but does NOT remove the old text string from the page content stream, so pdf.js `getTextContent()` returns BOTH the masked OLD text and the NEW text at the same rect. `EditOverlay.onClickTextRun` (`src/renderer/edit/EditOverlay.tsx:256-272`) iterates `getTextItems()` and matches the FIRST run whose rect contains the click point â€” the OLD "TFlex Technical Report" run (it covers the same rect and appears first), so `setTextTarget({ initialText: item.text })` pre-fills the editor with the OLD text.
  Additional observed behavior: moving the floating toolbox and confirming commits at `textTarget.rect` (the ORIGINAL run rect) regardless of the toolbox's drag offset â€” the committed text stays at its original page position (it does NOT move with the toolbox). When I confirmed after a toolbox move, the page textLayer appended another "TFlex Technical Report" (a re-baked duplicate). DOCUMENT-SAFETY check (e2e/gt_bug2_docsafety_1717.spec.cjs): the user's "NEW TITLE 123" edit DOES persist in the saved file (reopened textLayer still contains "NEW TITLE 123"); the masked OLD run remains in the file's text content (a text extractor reads both) and a re-confirm with the stale OLD text adds an additional old-text run â€” but the edit is not silently lost.
Screenshot: screenshots/gt-bug2-1717-after-commit.png (page shows "NEW TITLE 123"), screenshots/gt-bug2-1717-editor-after-reclick.png (editor re-opened showing "TFlex Technical Report"), screenshots/gt-bug2-1717-after-move-confirm.png, screenshots/gt-bug2-docsafety-reopened.png. Fixture: test-fixtures/edittext-old-and-new-runs.pdf (saved output carrying both old and new runs).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_edittext_1717.spec.cjs + e2e/gt_bug2_docsafety_1717.spec.cjs. Re-clicking the edited run opens the editor with the OLD text (textareaValue "TFlex Technical Report"). Toolbox move+confirm leaves content at the original rect and re-bakes an old-text run. The saved file keeps the NEW edit â€” not silently reverted.)
- qa: retested on installed v1.7.18 (e2e/retests/def_149_verify_1.7.18.spec.cjs + diagnostic). Part (a) PASS â€” re-clicking the edited run now opens the editor with "NEW TITLE 123" (the re-click OLD-text bug is FIXED). Part (b) FAIL â€” after moving the toolbox +200/+120 and confirming, a new "NEW TITLE 123" run commits at the moved rect (x=794,y=444) but the ORIGINAL run at (x=594,y=325) is NOT removed: page-1 textLayer now shows "NEW TITLE 123NEW TITLE 123" (2 runs), and the duplicate is BAKED into the saved PDF (reopen still shows 2 occurrences). The move duplicates rather than relocates â€” filed separately as DEF-151. Kept OPEN because not both verification conditions pass.
- qa: retested on installed v1.7.19 (e2e/retests/def_149_verify_1.7.19.spec.cjs). Part (a) PASS â€” re-clicking the edited run opens the editor with "NEW TITLE 123" (not the OLD title). Part (b) FAIL â€” moving the toolbox +200/+120 + Confirm-move leaves the original "NEW TITLE 123" in place and commits a second copy; page-1 textLayer = "â€¦NEW TITLE 123NEW TITLE 123" (2 occurrences), saved-bytes parse = 2, reopened app tab = 2. The move duplicates rather than relocates (DEF-151 still OPEN).
- qa: CLOSED. Part (a) â€” re-clicking an edited text run opens the editor with the NEW text â€” verified PASS on installed v1.7.18 (e2e/retests/def_149_verify_1.7.18.spec.cjs), and it remained PASS on v1.7.19. Part (b) â€” the toolbox move+confirm duplicate/relocate behavior â€” was split out and tracked separately as DEF-151, which is now CLOSED (retested on installed v1.7.21 = FileVersion 1.7.21, e2e/retests/def_151_verify_1.7.21.spec.cjs). Both conditions that kept DEF-149 OPEN are resolved: (a) fixed on v1.7.18, (b) resolved and closed via DEF-151 on v1.7.21.

## DEF-148: "Per page" crop on page 1 makes EVERY thumbnail in the rail render cropped/shrunk to the crop box (uncropped pages 2-4 look cropped too)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (ground-truth reproduction on installed v1.7.17 = FileVersion 1.7.17; operator-reported BUG 1)
- Phase: 12 (crop pages) / 14 (installed v1.7.17)

Steps to reproduce:
1. Launch TFlex (installed v1.7.17 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages, each 612x792).
2. Tools palette -> Crop pages (`[data-tool-id="cropPages"]`) -> `[data-crop-pages-dialog]` -> switch mode to "Per page" (`[data-crop-mode="perPage"]`), page select = 1.
3. Set a distinctive 200x200 pt crop box (move + SE handles) and click Apply (`[data-crop-confirm]`).
4. Inspect the LEFT THUMBNAIL RAIL: thumbnails for pages 1-4.

Expected: Only page 1's thumbnail is the crop box (square); thumbnails for pages 2,3,4 (uncropped) must render as FULL 612x792 pages (wrap aspect ~0.773), exactly as they did before the crop.

Actual: EVERY thumbnail wrap collapses to the crop-box square (aspect 1.0 = 126x126) after cropping page 1; only the page-1 thumb (which IS cropped) should be square. Measured geometry (e2e/gt_crop_thumb_1717.spec.cjs):
  - BEFORE crop: pages 1-4 `.thumb-item .thumb-canvas-wrap` = 126x163 (aspect 0.773) â€” full page.
  - AFTER crop page 1 to 200x200: page 1 wrap = 126x126 (aspect 1.0, correct â€” page 1 is cropped), but pages 2/3/4 wraps ALSO = 126x126 (aspect 1.0) while their `.thumb-canvas` stays 126x163 (buffer 189x244) â€” so `clipped: true` for pages 2/3/4 (the full-page bitmap is clipped into the square by `.thumb-canvas-wrap` overflow:hidden). The thumbnails for the UNCROPPED pages 2,3,4 therefore render clipped/shrunk to the crop box (the operator's "all thumbnails look cropped").
  - MAIN VIEW is NOT affected: after the crop, page-2/3 slots keep 1156x1496 (aspect 0.7727, full) â€” the DEF-141 fix worked for the main view; the thumbnails carry a SEPARATE stale-geometry bug (confirming the operator's suspicion that it's not the DEF-141 class).
Root cause direction (renderer): `src/renderer/components/SideRail.tsx:92` computes a SINGLE `aspect = defaultHeightPt / defaultWidthPt` from `defaultWidthPt`/`defaultHeightPt` = `DocumentView`'s LIVE `firstPageSize` (`DocumentView.tsx:1677-1678`). After a per-page crop of page 1, `firstPageSize` becomes the crop's square (200x200), so `aspect = 1.0`. `Thumb` (`SideRail.tsx:671`) then sizes EVERY thumb wrap as `Math.round(THUMB_WIDTH * aspectRatio)` = 126x126 (square), while the canvas still renders each page's own full geometry via `computeThumbGeometry` (126x163). Every uncropped page's full-page thumbnail is therefore clipped into the crop square. The main view fixed this by using per-page `pageSizes` (DEF-141); the rail was not given the same per-page geometry.
Screenshot: screenshots/gt-bug1-1717-rail-after-crop.png, screenshots/gt-bug1-1717-rail-close.png (rail: thumb 1 = crop square, thumbs 2/3/4 = full-page content clipped into squares), screenshots/gt-bug1-1717-main-after-crop.png (main view pages 2/3 full size â€” the contrasting control).

History:
- qa: opened (ground-truth reproduction on freshly installed v1.7.17. e2e/gt_crop_thumb_1717.spec.cjs. Measured BEFORE/AFTER: pages 2/3/4 wraps 0.773 -> 1.0 aspect, canvas 126x163 clipped into 126x126. Main-view pages 2/3 stayed 1156x1496 (0.7727). Document-safety: purely a live thumbnail-layout defect â€” the saved file and main view are correct (only page 1 carries the crop box), so it is NOT data corruption. The thumbnail rail is the only surface that misrepresents the uncropped pages.)
- qa: closed (retest on installed v1.7.18 = FileVersion 1.7.18 via e2e/retests/def_148_verify_1.7.18.spec.cjs. After cropping page 1 to a 200x200 box (crop box pt {x:123.5,y:159.5,w:200,h:200}), the LEFT THUMBNAIL RAIL now renders correctly: page-1 thumb wrap = 126x126 (aspect 1.0, the crop square â€” correct, page 1 IS cropped), while pages 2/3/4 wraps = 126x163 (aspect 0.773, FULL page) with `clipped: false` for all three. This is exactly the expected/contrasting outcome â€” no uncropped page thumb is clipped/shrunk to the crop box. Visually confirmed via screenshots/def-148-1718-rail-close.png and def-148-1718-rail-after-crop.png (thumb 1 square, thumbs 2/3/4 full portrait). Main view pages 2/3 slots = 1156x1496 (0.7727, full) â€” consistent. Note: the retest spec itself reported a failure on its main-view assertion only because page-4's `.page-slot` returned null after scrollToShow(1) (PDF.js virtualizes off-screen pages; page 4 is not mounted), which is a test-harness artifact, not a product regression â€” the DEF-148 thumbnail behavior under test passed.)

## DEF-147: Floating context windows/editors cannot be dragged â€” only the Edit-mode toolbox is movable (operator: "every toolbox movable with its content")

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (DEF-140 draggable toolbox parity â€” installed v1.7.14)

Steps to reproduce:
1. Launch TFlex (installed v1.7.14 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card.
2. For each floating window below, open it, grab a NON-interactive point of its chrome (a point not covered by a button/input/textarea/select/[role=button], found by scanning the rect with `elementFromPoint`), hold the mouse and drag +160px right / +90px down, then release.
   a. Signature pending action bar: Sign tool -> Draw a signature -> Save -> Saved tab -> pick it -> click the page (`.sig-pending` / `[data-sig-action-bar]` appears).
   b. Sticky-note editor: annotation toolbar "Note" (`[data-tool="note"]`) -> click the page (`.ann-note-editor`, `[data-annotation-editor="note"]`).
   c. Textbox editor + action bar: "Text box" (`[data-tool="textbox"]`) -> click the page (`[data-annotation-editor="textbox"]`, `[data-annotation-action-bar="textbox"]`).
   d. Annotation color palette popover: arm "Pen" (`[data-tool="ink"]`) -> click the swatch (`.ann-color-swatch-main`) -> `.color-palette`.
   e. Stamp dialog: Tools palette -> Stamp (`[data-tool-id="stamp"]`) -> `[data-stamp-dialog] .modal-dialog`.

Expected: The operator's stated intent â€” "every toolbox movable with its content" â€” so each floating window follows the cursor and is repositionable, exactly like the DEF-140 Edit-mode toolbox (which now moves +220/+120).

Actual: NONE of them move. Measured `getBoundingClientRect` is IDENTICAL before/mid/after the drag for all five (moved dx=0 dy=0):
  - `[data-sig-action-bar]` 669,534 -> 669,534 (dx=0 dy=0)
  - `[data-annotation-editor="note"]` 668,487 -> 668,487 (dx=0 dy=0)
  - `[data-annotation-editor="textbox"]` 668,487 -> 668,487 (dx=0 dy=0)
  - `[data-annotation-action-bar="textbox"]` 668,572 -> 668,572 (dx=0 dy=0)
  - `.color-palette` 391,126 -> 391,126 (dx=0 dy=0)
  - `[data-stamp-dialog] .modal-dialog` 491,51 -> 491,51 (dx=0 dy=0)
Only `EditInlineEditor` (DEF-140, its `.edit-inline-editor`) is draggable; the sticky-note editor, textbox editor, textbox action bar, signature pending action bar, annotation color palette popover and stamp dialog are all stuck. Each has no pointermove window-reposition handler â€” e.g. SignaturesOverlay only has a pointerdown click/defensive bail-out list (`.sig-action-bar, .sig-action-btn, .sig-pending, ...`, line ~381) with no move/reposition; AnnotationOverlay's `.ann-*` editors/action bars are absolutely-positioned anchored to the page/annotation and have no drag-to-move; ColorPalette `.color-palette` and the stamp modal `.modal-dialog` are static boxes with no drag handle.
Screenshot: screenshots/gt-item1b-note-editor-open.png (note editor), gt-item1c-textbox-open.png (textbox editor+bar), gt-item1d-color-palette-open.png (palette popover), gt-item1e-stamp-dialog-open.png (stamp dialog), gt-item1a-sig-pending-open.png (sig pending bar) â€” each verified at its origin before and after dragging (moved dx=0).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14 with a chrome-point scan that avoids controls. All five floating windows report dx=dy=0 â€” the toolbox parity the operator asked for is missing on every window except the Edit-mode inline editor.)
- qa: retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_147_verify_1.7.15.spec.cjs (isolated per-window app launch, chrome-point drag +160/+90 avoiding controls). PARTIAL FIX â€” two windows now move, four still do NOT:
  - note editor `[data-annotation-editor="note"]`: MOVED dx=160 dy=90 (was stuck) â€” FIXED.
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED dx=160 dy=90 â€” FIXED.
  - signature pending action bar `[data-sig-action-bar]`: STUCK dx=0 dy=0 (rect 669,534 unchanged).
  - textbox editor `[data-annotation-editor="textbox"]`: STUCK dx=0 dy=0 (rect 668,487 unchanged) even though its action bar moves.
  - annotation color palette `.color-palette`: STUCK dx=0 dy=0 (rect 391,126 unchanged, 279x550 popover).
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: STUCK dx=0 dy=0 (rect 491,51 unchanged, 460x801 modal).
   The operator's stated intent ("every toolbox movable with its content") is therefore only PARTIALLY met: the note editor and textbox action bar are movable, but the signature pending action bar, the textbox editor, the annotation color palette popover and the stamp dialog still have no pointermove window-reposition handler (dragging their chrome leaves the rect unchanged). Screenshots: def-147-1715-sig-pending-open.png / def-147-1715-note-editor-open.png (moves) / def-147-1715-textbox-open.png / def-147-1715-color-palette-open.png / def-147-1715-stamp-dialog-open.png. REMAINS OPEN â€” genuine failure.)
- qa: retested on freshly installed v1.7.16 = FileVersion 1.7.16, e2e/retests/def_147_verify_1.7.16.spec.cjs (isolated per-window app launch, chrome-point drag +160/+90 avoiding controls, rect captured BOTH mid-drag (button held) and after release). MORE FIXED â€” but TWO windows STILL do NOT move (dx=dy=0 mid-drag AND after), so the operator's intent is STILL only partially met:
  - sticky-note editor `[data-annotation-editor="note"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays â€” STILL FIXED (regression clean).
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 668,572 -> 828,662) and stays â€” STILL FIXED.
  - annotation color palette `.color-palette`: NOW MOVES mid-drag dx=160 dy=90 (rect 391,126 -> 551,216) and stays â€” FIXED since 1.7.15.
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: NOW MOVES mid-drag dx=160 dy=51 (rect 491,51 -> 651,102; dy clamped by viewport bottom at the 460x801 modal) and stays â€” FIXED since 1.7.15.
  - signature pending action bar `[data-sig-action-bar]`: STILL STUCK â€” mid-drag and after both dx=0 dy=0 (rect 669,534 unchanged). DOM probe confirms a real non-interactive chrome point exists (e.g. 690,537 / 875,537 are `sig-action-bar` background, not buttons) yet dragging it leaves the rect unchanged â€” no pointermove window-reposition handler. Screenshots: def-147-1716-sig-pending-open.png, def-147-1716-sig-middrag-stuck.png (mid-drag, rect still 669,534).
  - textbox editor `[data-annotation-editor="textbox"]`: STILL STUCK â€” mid-drag and after both dx=0 dy=0 (rect 668,487 unchanged) even though its action bar moves. DOM probe identifies the root cause precisely: the `[data-annotation-editor="textbox"]` element IS the `textarea.ann-editor.ann-textbox-editor` itself (170x81, rect == the textarea rect, `elementFromPoint` returns the textarea/interactive across its entire area). It has NO separate drag chrome / wrapper â€” every grab point lands on the textarea (which selects text/caret instead of repositioning the window), so there is literally no way to grab it as a window. This is a genuine failure of the "textbox editor wrapper movable" requirement, not a harness false-negative. Screenshots: def-147-1716-textbox-open.png, def-147-1716-textbox-middrag-stuck.png (mid-drag, rect still 668,487).
  Net on v1.7.16: 4 of 6 measured windows/toolbars are movable (note editor, textbox action bar, color palette, stamp dialog â€” the latter two newly fixed), but the signature pending action bar and the textbox editor wrapper still cannot be dragged. REMAINS OPEN â€” genuine, still-incomplete failure.)
- qa: CLOSED (retested on freshly installed v1.7.17 = FileVersion 1.7.17, e2e/retests/def_147_verify_1.7.17.spec.cjs â€” isolated per-window app launch, chrome/grip-point drag +160/+90 avoiding controls, rect captured BOTH mid-drag (button held) and after release). ALL SIX windows now move â€” the operator's stated intent ("every toolbox movable with its content") is now FULLY met, and the two remaining stuck windows are FIXED:
  - signature pending action bar `[data-sig-action-bar]`: MOVED mid-drag dx=160 dy=90 (rect 669,534 -> 829,624) and stays â€” FIXED. (The bar now has minWidth:260 + 8px/12px padding in the drag-hook chrome runway, so a chrome press at the top padding (685,537) starts the whole-window move; previously every press collapsed onto a button.)
  - sticky-note editor `[data-annotation-editor="note"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays â€” still fixed (regression clean).
  - textbox editor `[data-annotation-editor="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 668,487 -> 828,577) and stays â€” FIXED. The editor now exposes a real draggable grip strip `[data-annotation-editor-handle="textbox"]` ("DRAG TO MOVE") above the textarea; dragging the GRIP STRIP (grab point 680,489 â€” NOT the textarea) moves the whole window (grip + textarea + action bar). The action bar, a child of the wrapper, is displaced by the same delta (dx=160 dy=90) as the editor â€” it rides with the window.
  - textbox action bar `[data-annotation-action-bar="textbox"]`: MOVED mid-drag dx=160 dy=90 (rect 828,689 -> 988,779) and stays â€” FIXED; its own chrome press (840,692) bubbles to the wrapper's drag hook and moves the whole editor window as one unit.
  - annotation color palette `.color-palette`: MOVED mid-drag dx=160 dy=90 (rect 391,126 -> 551,216) and stays â€” still fixed.
  - stamp dialog `[data-stamp-dialog] .modal-dialog`: MOVED mid-drag dx=160 dy=51 (rect 491,51 -> 651,102; dy clamped by the viewport bottom at the 460x801 modal) and stays â€” still fixed.
  Regression / no-op checked: none of the six drag presses was on a control (all grabbed chrome points were verified non-interactive via elementFromPoint), no pageerror, and mid-drag (button held) all six were already at their displaced rect (parity with the DEF-140 inline editor, no release-only snap). Screenshots: def-147-1717-*.png (open + mid-drag for each of the six). â‰¤5 tests, 5 passed. CLOSED.)

## DEF-146: Committed Add-box text is visually truncated to a few characters after move+confirm (oversized default box font clipped by overflow)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "an artifact appears on screen after moving a textbox and confirming")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Add box" (`[data-edit-tool="box"]`).
3. Drag a rectangle on page 1 (~140x90 px), type "ARTIFACT CHECK 88", click Apply (`[aria-label="Apply edit"]`). The committed text box (`[data-edit-box-id]`) renders.
4. Re-arm the box tool, drag the box ~170px right / 110px down, then Ctrl+Enter to confirm the move.
5. Inspect the box on the page.

Expected: The committed box renders its full text "ARTIFACT CHECK 88" legibly at the new position.

Actual: The box renders only "AR" (the first 2 characters). The committed box's text mirror `.edit-box-text[data-edit-box-text-mirror]` has `font-size: 71.7778px` (the default box font, near the SIZE_MAX=72 cap) inside a small 140x90 box with `overflow: hidden; white-space: pre-wrap`, so the rest of "TIFACT CHECK 88" is clipped out of view. The full string IS still present in the page textLayer (page 1 textLayer = "...ARTIFACT CHECK 88"), so the stored content is intact but the on-screen box is visually truncated. Confirmed identically at commit (before moving) and after move+confirm â€” the artifact is the box mirror's oversized default font. This is the same class as the DEF-113 content-drop, now reappearing as a live playbox truncation. (Screenshot shows box rendering only "AR".) Note: I did not save+reopen to test whether the clipped rendering also lands in the saved PDF â€” flagged for the fix dispatch.
Screenshot: screenshots/gt-item8-after-confirm.png (box shows "AR"), gt-item8-after-commit.png, gt-item8-probe.png.

History:
- qa: opened (operator-reported "artifact after moving a textbox and confirming"; reproduced on installed v1.7.14. The artifact is the committed box text rendered as "AR" because the mirror font is 71.78px in a 140x90 box with overflow:hidden. `data-edit-box-text-mirror` line in DOM: font-size 71.7778px, overflow hidden. The full committed content is intact in the textLayer.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_146_verify_1.7.15.spec.cjs). Edit -> Add box -> place a ~150x90 box on page 1, type "ARTIFACT CHECK 88", Apply. The committed box holds its FULL text in the mirror (`data-edit-box-text-mirror` = "ARTIFACT CHECK 88") and renders it legibly â€” the computed mirror font is 23.89px (auto-FITTED to the box, not the oversized ~71.8px default), so the whole string is visible inside the box (confirmed visually: def-146-1715-after-commit.png shows "ARTIFACT" / "CHECK 88" wrapped and fully visible, NOT clipped to "AR"). After re-arming the box tool, dragging the box +170/+110 and Ctrl+Enter confirming the move, the box still renders the full "ARTIFACT CHECK 88" (font 23.89px) â€” the artifact is gone. Page-1 textLayer contains the full string. No pageerror. The mirror font now auto-fits (wrap at box width, shrink so every line fits the box height) instead of rendering the box.rect.height*0.8 default at overflow:hidden. CLOSED.)

## DEF-145: Dragging a committed Add-box text box leaves a transient stale text copy at its original position until the mouse is released

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "dragging a TEXTBOX keeps a copy of the text at its ORIGINAL position until the mouse button is released")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Edit toggle -> "Add box" -> drag a rectangle on page 1, type "STALE CHECK BOX", Apply.
3. Re-arm the box tool, click the committed box and drag it ~180px right / 120px down. Hold the mouse button (do NOT release) and inspect the page.

Expected: The box (and its text) move together with no residual text at the old spot.

Actual: While the mouse button is held, the box surface AND its `.edit-box-text-mirror` move to the new rect (mirror rect 595,426 -> 775,546, dx=180 dy=120), but the page still paints a faint stale copy of "STALE CHECK BOX" at the ORIGINAL position (visible in the mid-drag screenshot just above the moved box) because the pdf.js proxy is not refreshed until mouseup re-commits the box at the new rect. On mouseup the proxy refreshes and the stale copy disappears (after-drag screenshot is clean). So the stale-at-origin text is a transient visual artifact confined to the duration of the drag.
Screenshot: screenshots/gt-item6-middrag.png (stale "STALE CHECK BOX" at the original spot while the box surface is at the new spot), gt-item6-after-drag.png (clean after release).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Mid-drag the page textLayer still paints the pre-move box string at the original rect; it clears on mouseup.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_145_verify_1.7.15.spec.cjs). Edit -> Add box -> place a box on page 1, type "STALE CHECK BOX", Ctrl+Enter (committed box at {595,425,140,90}). Re-arm the box tool, grab the committed box center and drag +180/+120 HOLDING the button: MID-DRAG (before release) the box surface is already at {775,545} (dx=180 dy=120) AND its `[data-edit-box-text-mirror]` is at {775,546} (dx=180 dy=120, aligned with the surface) â€” only ONE live text mirror (no second/stale copy). The ORIGINAL position {595,425} is empty (verified in def-145-1715-middrag.png â€” box moved, origin clean, no residual "STALE CHECK BOX" at the old spot). After release nothing snaps back. The box AND its text travel together while the button is held; no stale-at-origin text copy. (Note: `[data-edit-box-id]` also matches the "Edit | Delete" action-bar toolbar, so the raw element count can exceed 1 â€” that is the toolbar, not a duplicate box.) No pageerror. CLOSED.)

## DEF-144: Drawn signatures render as a thick black filled blob when ghosted/placed â€” stroke thickness is not preserved (and no image-import option exists)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "drawn signature ghost/placed result is too big/thick; no way to add a signature from an image file")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Sign tool (`button[aria-label="Sign tool"]`) -> Draw tab -> draw a thin stroke on the "Draw your signature" canvas (360x120).
3. Save -> Saved tab -> pick the saved signature -> hover the page (ghost preview) -> click the page -> Confirm (placed).
4. Compare the drawn stroke (thin line) to the ghost preview and the placed result.

Expected: The ghost/placement preserves the drawn stroke's appearance proportionally â€” a thin pen line, scaled, matching the box aspect; the whole signature visible.

Actual: The ghost and the placed signature both render as a THICK BLACK FILLED blob (a heavy barbell/dumbbell shape), not the thin stroke that was drawn. Measured ghost/placed rect = 121x42 (aspect 2.88 â€” proportionally correct, so NOT "too big" in dimension), but the stroke weight is rendered far too thick, so the signature reads as a solid black mass. The drawn-canvas screenshot shows a thin line; the placed/ghost screenshot shows the same stroke as a filled shape. (The box aspect IS preserved and the whole signature fits, so "box needs to expand" is NOT reproduced; the thickness IS reproduced.)
   Confirmed separately: the Signature manager exposes only Draw / Type / Saved tabs â€” no "import from image" / "from file" / upload control (tabs = ["Draw","Type","Saved (0)"]). Image-import is NOT in the Phase 4 requirements ("create by drawing or typing"), so it is out of scope rather than a bug â€” noted here as confirmed-absent.
Screenshot: screenshots/gt-item5-drawn-canvas.png (thin stroke drawn), gt-item5-ghost.png (ghost thick blob), gt-item5-placed.png (placed thick blob), gt-item5-pending.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Thin drawn stroke -> ghost/placed thick filled blob. Box aspect preserved (2.88) so not "too big"; thickness is the reproduced defect. Image import confirmed absent, and it is out of scope per Phase 4.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_144_verify_1.7.15.spec.cjs). Draw a thin curved stroke on the 360x120 Draw canvas -> Save -> pick -> hover to ghost -> click to place -> confirm. GHOST svg: viewBox "0 0 64 22", path strokeWidth = 0.427 (was ~13.5 in v1.7.14), fill="none" (a stroked polyline, NOT a filled shape), rect 121x42 (aspect 2.88 â€” proportionally correct, signature fully visible). PLACED svg: identical strokeWidth 0.427, fill="none", rect 121x42 (aspect 2.88). Both ghost and placed render as a THIN pen stroke, not a thick black filled blob. Confirmed visually (def-144-1715-drawn-canvas.png = thin stroke on the canvas, def-144-1715-ghost.png / def-144-1715-placed.png = thin stroke on the page). The signature manager still exposes only Draw / Type / Saved tabs (no image import â€” out of scope, noted). No pageerror. `scaledStrokeWidth` (DRAW_PEN_WIDTH * min(sx,sy)) now scales the stroke thickness WITH the points instead of dividing by the scale. CLOSED.)

## DEF-143: Signature Saved tab shows duplicates of the FIRST signature after saving several, and delete is inconsistent (count vs rendered rows)

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "add four signatures 1/2/3/4 â€” what renders? delete first then delete again")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Sign tool -> Type tab -> type "1" -> Save; type "2" -> Save; type "3" -> Save; type "4" -> Save.
3. Switch to the "Saved" tab. Inspect each row.
4. Click Delete (`.sig-saved-delete`) on the FIRST row; inspect. Click Delete on the (new) first row AGAIN; inspect.

Expected: The Saved tab lists four DISTINCT signatures "1","2","3","4" (each showing its own content), and deleting removes exactly the clicked one each time with a consistent count.

Actual: The Saved tab shows FOUR rows but every row renders the SAME signature "1" (label/thumbnail "1" â€” a duplicate of the first). On the first delete the list becomes inconsistent: the badge reads "Saved (3)" but SIX rows render ("1","1","1","2","3","4") â€” stale duplicates of "1" persist alongside the correct "2","3","4". Deleting again leaves the same inconsistent 6-row list. Root cause direction: `TypeTab.onSave` (src/renderer/signatures/SignatureManagerModal.tsx:398-402) calls `getSignatureService().save(source, trimmed)` and takes `const sig = next[0]` â€” but `SignatureService.save` (src/main/services/signature-service.ts:48-50) `return this.list()` after `push`, which is OLDEST-FIRST, so `next[0]` is always the FIRST-ever signature. Every new Save therefore appends the first signature to the modal's local list, so the Saved tab shows N copies of the first signature. The persisted service list is correct; the modal's local `saved` mirror is wrong, and the count badge can disagree with the rendered row count after a delete.
Screenshot: screenshots/gt-item4-saved-four.png (4 identical "1" rows), gt-item4-after-delete-first.png (badge "Saved (3)" but 6 rows), gt-item4-after-delete-again.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Saved tab after 4 typed saves = 4 rows all "1"; delete-first -> badge "Saved (3)" but 6 rows. Root cause pinned to `next[0]` in TypeTab.onSave against an oldest-first list.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_143_verify_1.7.15.spec.cjs). Type tab -> save "1","2","3","4" -> Saved tab: badge "Saved (4)" and FOUR DISTINCT rows labels [1,2,3,4] (thumbnails each "1"/"2"/"3"/"4", delete aria-labels "Delete 1".."Delete 4") â€” NO duplicates. Delete the FIRST row -> EXACTLY 3 rows, labels [2,3,4], badge "Saved (3)". Click delete on the (new) FIRST AGAIN -> EXACTLY 2 rows, labels [3,4], badge "Saved (2)". Count is consistent with rendered rows at every step; the badge no longer disagrees with the row count. No pageerror. The `next[0]` oldest-first mirror bug is fixed (the modal's local `saved` list now appends the actual new signature). Screenshots: def-143-1715-saved-four.png (4 distinct rows), def-143-1715-after-delete-first.png (3 rows 2/3/4), def-143-1715-after-delete-again.png (2 rows 3/4). CLOSED.)

## DEF-142: Closing the app (window X) with an unsaved document does NOT prompt to save â€” edits are silently discarded

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "close the APP with an unsaved document open â€” does it prompt to save? currently no prompt")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card.
2. Make an edit so the document is modified (click the toolbar Rotate clockwise `[data-toolbar-rotate-cw]`); confirm `tflexDiagnostics().modified === true`.
3. Click the window close button (`.titlebar-control-close` / `[data-window-close]` â€” the app's window X), NOT a tab close.

Expected: Since the tab is modified/unsaved, the app prompts "Save changes?" (Save / Don't save / Cancel) before quitting, mirroring the tab-close prompt (CloseTabPromptDialog).

Actual: The window closes outright with NO prompt. After the X click the target page is destroyed (`windowAlive=false`, `promptInDom="WINDOW-GONE"`, `closedEvent=closeCount=0`) and no save/close prompt element ever mounts. The user's unsaved edit is silently lost. Root cause direction: the unsaved-check lives only in the per-tab `closeTab` path (`src/renderer/App.tsx` closeTab, line ~1105, which gates on `tabMeta.modified`/`engineModified` and shows CloseTabPromptDialog). The window close IPC `window:close` -> `BrowserWindow.fromWebContents(event.sender)?.close()` (`src/main/index.ts:121-123`) and the frameless caption button `tflex.closeWindow()` (`src/renderer/components/TitleBar.tsx:199`, `src/preload/preload.ts:320`) route straight to `win.close()` with no `beforeunload` / `will-prevent-unload` / modified gate, so the whole app quits ignoring unsaved state.
Screenshot: screenshots/gt-item3-modified-before-close.png (modified=true before X), gt-item3-after-close-click.png (window gone).

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. modified=true, X click -> window closes, no 'Save changes' prompt, no will-prevent-unload.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_142_verify_1.7.15.spec.cjs). (a) Open report.pdf sample, Rotate CW (modified=true), click the window X ([data-window-close]): the window STAYS ALIVE and the "Unsaved changes" CloseTabPromptDialog mounts with buttons [Cancel, "Don't save", "Save Asâ€¦"] (the sample is bytes-loaded, so Save routes to Save-As). Cancel -> prompt dismissed, window stays open. Second X -> prompt reappears; "Don't save" -> confirmClose(true) -> window closes (closedEvent fired). (b) Fresh app: X -> prompt -> Save ("Save Asâ€¦") with the OS save dialog stubbed to a temp path -> the save runs and the window closes; the saved file re-parses (pdf-lib) as a valid 34-page PDF. The gate (main `onCloseRequested` preventDefault + `window:closeRequested` -> renderer CloseTabPromptDialog -> `confirmClose(true)`) closes the DEF-142 "silent discard" hole: every close path now prompts on unsaved edits and Save/Don't-save/Cancel all work. Screenshots: def-142-1715-modified-before-close.png, def-142-1715-prompt.png (the "Unsaved changes" dialog with Cancel / Don't save / Save As), def-142-1715-after-cancel.png. CLOSED.)

## DEF-141: "Per page" crop on page 1 collapses EVERY page-slot to the crop's box in the live view â€” the doc renders as stacked/clipped squares

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (installed v1.7.14; operator-reported "crop PAGE 1 stacks the pages below to overlap each other; the smaller the crop, the denser the stack")

Steps to reproduce:
1. Launch TFlex (installed v1.7.14), open the report.pdf SAMPLE card (34 pages, each 612x792).
2. Tools palette -> Crop pages (`[data-tool-id="cropPages"]`) -> `[data-crop-pages-dialog]` -> switch mode to "Per page" (`[data-crop-mode="perPage"]`) -> page select = 1.
3. Set a SMALL crop box (150x150 pt via the move + SE handles), click Apply (`[data-crop-confirm]`).
4. Scroll the continuous view to page 1 and inspect the sizes of pages 1-6.

Expected: Only page 1 is cropped to 150x150; pages 2-34 keep their full 612x792 render box (aspect 0.773).

Actual: EVERY page-slot collapses to the crop box size. After the small crop, `.page-slot[data-page=1..6]` are ALL 283x283 px (square, the crop's aspect) with `--scale-factor` still 1.888 (the full-page scale), so each full page's 612x792 content is rendered at 1.888 (1156x1496) but clipped/stacked into a 283x283 square â€” only the top-left slice of each page is visible. Page-1 slot text = "A study in PDF orc" (cropped), page-2 slot text = "Chapter 1: The Art of Orchestration..." (full, clipped), page-3 = "key to maintaining...". The smaller the crop, the smaller every slot becomes (150x150 crop -> 283x283 slots; 300x400 crop -> 139x185 slots) â€” the "density" scales with crop size. So the doc is visually scrambled/stacked. (The SLOT boxes themselves have an 18px gap, so there is no literal box-overlap; the "stack" is the full-page content clipped into the crop-size square. The saved file is CORRECT â€” pdf-lib re-parse of a Save gives pageCount 34 and only page 1 with a non-full CropBox (150x150); pages 2,3 are full 612x792 â€” so this is a live proxy/layout defect, not data corruption.)
Screenshot: screenshots/gt-item2-small-crop-scroll.png, gt-item2-small-crop-stack.png (cropped strip + full page-2 content clipped into the next square), gt-item2-medium-crop-scroll.png, gt-item2-probe-scroll.png.

History:
- qa: opened (operator-reported; reproduced on installed v1.7.14. Per-page crop on page 1 collapses every page-slot to the crop box (283x283 for a 150x150 crop) with the full-page content clipped into the square; saved file correct (only page 1 CropBox). Live view is scrambled â€” the DEF-131/DEF-139 class regression.)
- qa: closed (retested on freshly installed v1.7.15 = FileVersion 1.7.15, e2e/retests/def_141_verify_1.7.15.spec.cjs â€” OPERATOR-EXACT small-crop flow). Basis: BEFORE crop pages 2/3 slots = 1156x1496 (aspect 0.7727). Crop page 1 to 150x150 pt (centered) via the per-page editor -> Apply ("Cropped 1 page."). AFTER crop: page-1 slot = 283.4x283.4 (aspect 0.9996 = the crop, correctly crocod only on page 1) while page-2 slot = 1156x1496 (aspect 0.7727), page-3 = 1156x1496 (0.7727), page-4 = 1156x1496 (0.7727) â€” pages 2/3/4 KEEP their FULL 612x792 render box; NO collapse to the crop square. Content-based overlap between consecutive slots = -18px (an 18px gap, NO stacking/overlap). Document-safety re-parse: Save As -> pdf-lib load = pageCount 34, only page 1 carries a non-full CropBox (150x150), pages 2/3 full 612x792 â€” the saved file is correct. No pageerror. The live view no longer scrambles/stack; the DEF-131/DEF-139 class regression is gone. Screenshots: def-141-1715-small-crop-scroll.png (page-1 cropped, page-2 full "Chapter 1"), def-141-1715-small-crop-stack.png (below the crop, full-size pages, no overlap). CLOSED.)

## DEF-140: The floating Edit-mode TOOLBOX (inline editor window) cannot be dragged/moved â€” it stays stuck over the text box and page content

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa (operator-reported BUG 4, reproduced on installed v1.7.13)
- Phase: 14 (Add-box inline editor UX)

Steps to reproduce:
1. Launch TFlex (installed v1.7.13 binary, `C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe`), open the report.pdf SAMPLE card (34 pages).
2. Click the Edit content toggle (`[data-toolbar-edit-toggle]`), wait for the Edit toolbar, click "Add box" (`[data-edit-tool="box"]`).
3. Drag a rectangle on page 1 (within the visible viewport) to place a text box; the inline editor (`[data-edit-editor="box"]`) appears. Type text (e.g. "Movable toolbox test") and click Apply (`[aria-label="Apply edit"]`) â€” a committed text box (`[data-edit-box-id]`) appears.
4. Click the committed text box ONCE. A floating TOOLBOX / inline editor window (`.edit-inline-editor`, `[data-edit-editor="edit"]`, containing the FONT/SIZE/COLOR toolbar row + the textarea) opens at the box location.
5. Press and HOLD the mouse on the toolbox's header / toolbar chrome (the FONT-SIZE-COLOR row â€” not a button, not the textarea) and drag ~220px right / 120px down, then release.

Expected: The floating toolbox (the inline editor window, together with the text inside) follows the cursor and can be repositioned so it does not cover the text box / page content â€” the operator's stated intent ("the toolbox along with the text inside should be movable").

Actual: The toolbox does not move at all. `.edit-inline-editor` getBoundingClientRect is UNCHANGED across the whole gesture: BEFORE drag `{x:653,y:455,w:200,h:182}`, MID-DRAG (while the mouse button is held and the cursor is 220px/120px away) `{x:653,y:455,w:200,h:182}`, AFTER release `{x:653,y:455,w:200,h:182}` â€” moved by `dx=0 dy=0`. The editor's only `onPointerDown` calls `e.stopPropagation()` and sets an inside-press blur-guard flag; there is NO pointermove handler that repositions the window, so the toolbox is stuck and keeps covering the page content while the user drags.
Screenshot: screenshots/bug4-toolbox-middrag.png (toolbox still at its origin while the cursor drags it), screenshots/bug4-toolbox-after-release.png (identical position after release), screenshots/bug4-box-editor-add.png (the add-box editor before commit).

History:
- qa: opened (operator-exact steps on installed v1.7.13; reproduced and measured. The committed box was placed at {x:652.6,y:455.3,w:130,h:80}; single-click reopened the editor at {x:653,y:455,w:200,h:182}; holding+dragging the toolbar chrome 220px/120px left it exactly at {x:653,y:455}, dx=0 dy=0. No pageerror, no editor auto-close.)
- qa: closed (retested on freshly installed v1.7.14 = FileVersion 1.7.14, e2e/retests/def_140_verify_1.7.14.spec.cjs â€” OPERATOR-EXACT flow, not the state arrays). Open report.pdf sample card -> Edit content toggle -> "Add box" -> drag a rectangle on page 1 -> type "Movable toolbox test" -> Apply -> committed box `[data-edit-box-id]` at {x:652.6,y:455.3,w:130,h:80} -> click the committed box ONCE -> the floating toolbox `.edit-inline-editor` opens at {x:653,y:455,w:200,h:182} (mode edit, identical anchor to the def-140 repro). HOLD + DRAG the toolbar chrome (`[data-edit-drag-handle]`, grabbed at the top-left padding point (658,461) â€” not a control) 220px right / 120px down: MID-DRAG (mouse still held) the toolbox is already at {x:873,y:575} (dx=220 dy=120 â€” it follows the cursor WHILE the button is held, not only on release), and AFTER RELEASE it stays at {x:873,y:575} (no snap-back, dx=220 dy=120). The toolbox no longer covers the text box / page content â€” the operator's stated intent ("the toolbox along with the text inside should be movable") is met. Regression checked: no pageerror (no "Invalid page request"/degreeAngle/NaN/React #310/#520) during the add/commit/click/drag flow. Pinned by the `EditInlineEditor` DEF-140 drag handle: `.edit-inline-toolbar` is the drag handle, `onToolbarPointerDown` records the pointer + rect (bailing out on `select/input/button/.edit-inline-toolbar-actions`), a window `pointermove` repositions the window via a `dragOffset` state applied on top of the anchored left/top, clamped to the viewport, and `pointerup`/`pointercancel` end the drag. Screenshots: screenshots/def-140-box-editor-add.png (add-box editor before commit), def-140-toolbox-middrag.png (toolbox at 873,575 while the cursor drags it clear of the "Mov" box), def-140-toolbox-after-release.png (identical to mid-drag â€” stays at the new position, no snap-back). CLOSED.)

## DEF-139: Inserting a blank page visually scrambles the document â€” the live view and thumbnail rail show the last page at position 1/2 instead of the blank, and pages render one slot off until save+reopen

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

Actual: The visible document is SCRAMBLED. `engineState.pageOrder` reports `[0,34,1,2,3,4,5,...]` (35 slots, unique 35) and the rail's `.thumb-item`/`.page-slot` `data-source-page` attributes declare slot 2 -> source 35 (the new blank) and slot 3 -> source 2 â€” which LOOKS correct. But the RENDERED CONTENT at each slot is wrong:
  - Slot 1 renders the title page ("TFlex Technical Report") â€” correct.
  - Slot 2 (declared source 35 = the new blank) renders "Page 17" â€” the LAST page of the document, NOT a blank.
  - Slot 3 (declared source 2 = Chapter 1) renders an EMPTY/blank page, not Chapter 1.
  - Slot 4 (declared source 3) renders "Chapter 1: The Art of Orchestration".
  - Slot 35 (declared source 34) renders "Page 16".
  So every slot from 2 onward is one content-slot off: the new blank does NOT appear as page 2, and the LAST page ("Page 17") content is instead shown at page 2 (and its real content lands one slot late). This is exactly the operator's report (the last page moved to the front / the visible order is wrong).

CRITICAL CONTRAST â€” the engine's SAVED OUTPUT and the FILE ON DISK are CORRECT. I did `Save As` after the insert and re-parsed the file with pdf.js: saved page 2 = "" (blank), saved page 3 = "Chapter 1: The Art of Orchestration", saved page 35 = "Page 17" â€” the correct order. So the mismatch is a LIVE-VISUAL (pdf.js proxy render / source-page mapping) defect, NOT a data-corruption defect. Save + re-open the file in TFlex -> the render is CORRECT (slot 2 = blank, slot 3 = Chapter 1, slot 35 = "Page 17").

Drawing on visible page 2 (part 2 of the operator's report): with `[data-tool="ink"]` a stroke drawn on VISIBLE page 2 lands on page 2 in the engine (`annotations = [{kind:ink,page:2}]`) and a rect on VISIBLE page 3 lands on page 3 â€” so DRAWING TOOLS DO work and the annotation overlay IS placed on the visible slot the user drew on (annotations render as HTML overlays, so the pdf.js canvas hash is unchanged, but the drawn `.ann-ink`/`.ann-rect` elements DO appear on those visible slots). The "no drawing tools work on page 2/3" symptom is NOT reproduced as stated â€” the ink/rect DO render on the visible pages the user draws on. What IS broken is that those visible slots are showing the WRONG page CONTENT (page 2 shows "Page 17", page 3 shows blank), so a user drawing on "page 2" after an insert-blank is actually drawing on top of a page that displays the last page's content â€” the annotation is attached to visible page 2 whose underlying/real page content the engine has not re-ordered in the live render.

Root cause direction (for the dev, renderer-side, not engine): the live pdf.js proxy is NOT rebuilt to match the engine's new pageOrder after insert-blank â€” `DocumentView`/`SideRail` map visible slot -> source via `pageOrder`, and `PageView` renders `doc.getPage(sourcePage)`, but the pdf.js proxy's actual page list still reflects the pre-insert order at live-render time, so `getPage(35)` (slot 2) returns the OLD last page's proxy page ("Page 17") instead of the new blank, and `getPage(2)` (slot 3) returns blank instead of Chapter 1. On save+reopen the proxy is rebuilt from the corrected bytes and the order is right. (The engine/pageOrder/annotations and the saved file are all correct â€” this is a live proxy/refresh mismatch.)

Screenshot: screenshots/def-139-rail-thumbs-1-4.png (rail: thumb 1 = title, thumb 2 = "Page 17" last-page content NOT blank, thumb 3 = blank, thumb 4 = Chapter 1), screenshots/def-139-live-page2.png (main-view slot 2 = "Page 17"), screenshots/def-139-live-page3.png (main-view slot 3 = blank), screenshots/def-139-live-page35.png (slot 35 = "Page 16", should be "Page 17"); also captured per-slot textLayer ground truth: slot1="TFlex Technical Report...", slot2="Page 17" (src 35), slot3="" (src 2), slot4="Chapter 1..." (src 3), slot35="Page 16" (src 34). The same-flow Save-As re-parse (external pdf.js) is the CONTROL: page2="", page3="Chapter 1...", page35="Page 17".

NOTE on previous verification: DEF-133 (which covers annotation-page-attribution after insert-blank) was CLOSED at this flow, and the DEF-133 note claimed the page-order was correct (blank becomes page 2). That conclusion was made by trusting the `pageOrder`/`data-source-page` ARRAYS â€” which this reproduction shows is WRONG: the arrays report the correct order while the LIVE RENDERED content shows the wrong page at every slot from 2 onward. This is exactly the "declare correct from pageOrder arrays alone" failure the operator warned about. The page-order claim is NOT correct when inspected visually.

History:
- qa: opened (installed v1.7.12; live view after insert-blank shows last-page "Page 17" at slot 2 and blank at slot 3 while pageOrder[1]=34/data-source-page[2]=35 claims the blank is slot 2; saved bytes + reopen render correctly).
- qa: closed (retested on freshly installed v1.7.13 = FileVersion 1.7.13, exe 10:52 AM, e2e/retests/def_139_verify_1.7.13.spec.cjs â€” OPERATOR-EXACT VISUAL check, not the state arrays). Open report.pdf sample card -> Tools -> Insert pages -> blank mode -> "Insert at page" = 2 (rank semantics: blank becomes page 2, inserted AFTER page 1) -> Insert. IMMEDIATELY (no save/reopen) the live view and the LEFT THUMBNAIL RAIL are correct: page-slot textLayer ground truth = slot1 "TFlex Technical Report", slot2 "" (BLANK, spanCount 0), slot3 "Chapter 1: The Art of Orchestration", slot35 "Page 17"; rail thumbCount = 35 and the thumbnails visually render thumb1 = title, thumb2 = BLANK (pure white, darkFraction 0), thumb3 = Chapter 1, thumb35 = "Page 17". Arm the Pen ([data-tool="ink"]) and draw on visible page 3 -> `.ann-ink` renders on the slot that shows "Chapter 1: The Art of Orchestration" (inkOnPage3=1, slot3 text still Chapter 1). DELETE PATH (developer note): delete page 2 (the blank) via [data-tool-id="delete"] range mode -> pageCount 35->34 and slot2 IMMEDIATELY renders "Chapter 1: The Art of Orchestration" (the correct next content), slot1 still title, slot3 continuation body. After all of the above page 2 is still BLANK. No save/reopen anywhere; the live render is immediately correct. No unhandled "Invalid page request"/"degreeAngle"/"NaN"/React #310/#520 pageerrors. Screenshots: screenshots/def-139-1713-rail.png, def-139-1713-thumb-1.png / -thumb-2.png / -thumb-3.png / -thumb-35.png, def-139-1713-live-page1.png / -live-page2.png / -live-page3.png / -live-page35.png, def-139-1713-page3-ink.png, def-139-1713-after-delete.png.) CLOSED.



- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 2 (regression on installed v1.7.11)

Steps to reproduce:
1. Launch TFlex (installed v1.7.11 binary = 9dcf83c source), open the report.pdf sample.
2. Click the toolbar "Rotate clockwise" (`[data-toolbar-rotate-cw]`). The page-1 canvas swaps 1156x1496 -> 1496x1156 (landscape); `window.tflexDiagnostics().engineState.rotations[0]` becomes 1.
3. Click "Save As" (`button[aria-label="Save As"]`), confirm the save.
4. Close the tab and re-open the saved file.

Expected: The rotated page stays rotated (renders landscape) after reopen â€” the /Rotate value written to the PDF is honored. Phase 2 criterion 4: "Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages."

Actual: The page-1 canvas renders 1156x1496 (portrait, aspect 0.773) after reopen, and `engineState.rotations[0]` is 0 â€” the rotation is silently gone. Reopening the file in TFlex loses the rotation (the saved file itself does carry `/Rotate=90` on page 1 when parsed with pdf-lib into a fresh document, but TFlex does not re-read it into its render/engine model). The user's page transformation is silently discarded on save+reopen.

Screenshot: measured page-1 canvas aspect before save = 1.294 (landscape) vs after reopen = 0.773 (portrait). (SEE `e2e/probe_rotate.spec.cjs`.)

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-138). Open report.pdf, click `[data-toolbar-rotate-cw]` -> `engineState.rotations[0]` becomes 1 and the page-1 canvas swaps to 1496x1156 (aspect 1.294 landscape). Save As to a temp path, then close the tab and re-open the saved file: after reopen `engineState.rotations[0]` is still 1, `rotations[1]` is 0, and the page-1 canvas renders 1496x1156 (aspect 1.294 landscape) â€” the rotation is no longer silently dropped. Screenshot screenshots/def-138-1712-after-reopen.png. Regression checked: no pageerror during rotate/save/reopen; the rest of the save path is unaffected (a subsequent rotate re-save again round-trips). CLOSED.



## DEF-137: Drawn/created annotations are silently dropped on save â€” no PDF annotation object, no baked content, not reloadable

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

Screenshot: screenshots/def-137-before-save.png (ink stroke + "DEFECT NOTE 137" note visible on page 1) vs screenshots/def-137-after-reopen.png (the same page after save+reopen is clean â€” both annotations gone).

History:
- qa: opened
- qa: closed (retested on installed v1.7.12 binary = FileVersion 1.7.12, e2e/retests/verify_1712_sweep.spec.cjs DEF-137). Open report.pdf, arm the Pen `[data-tool="ink"]` and draw a stroke on page 1, arm the Sticky note `[data-tool="note"]`, click a point, type "DEFECT NOTE 137", confirm. Pre-save: `engineState.annotations` = [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}]. Save As to a temp path, then close the tab and re-open the saved file. pdf-lib parse of the saved bytes: pageCount 34, per-page /Annots counts [2,0,0,0,0,0], with 1 `/Subtype /Ink` and 1 `/Subtype /Text` (note) annotation object on page 1 â€” the annotations are real PDF annotation objects, not orphaned. After reopen: `engineState.annotations` hydrates back to [{kind ink,page 1},{kind note,content "DEFECT NOTE 137",page 1}], and the page renders `.ann-ink` = 1 and `.ann-note` = 1 with the note text visible (screenshots def-137-1712-before-save.png vs def-137-1712-after-reopen.png â€” both the ink stroke and the "DEFECT NOTE 137" note render before save AND after reopen). Regression checked: no pageerror during annotate/save/reopen. CLOSED.



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
Actual: The box shows only the inline editor (Font / Size / Color / confirm / cancel) and corner handles â€” there is NO Delete/Remove affordance. The Edit-image tool shows a toolbar with Replace / Crop / Remove; the Edit-toolbox tool has no equivalent, so a committed text box cannot be removed without undoing the whole add. Screenshot: screenshots/def-137-box-selected.png (the selected box's chrome has no Delete/Remove control).
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
Actual: The box moves, but the area where the box originally sat is permanently masked with a white rectangle â€” the title "TFlex Technical Report" is visually erased (blank) even after the box moves away. The string stays in the pdf.js textLayer (so it remains selectable in the DOM), but the painted page no longer shows it. Screenshot: screenshots/def-137-after-move.png (title gone where the box was; "MY BOX" sits at the new spot).
Root cause: `EditOverlay.tsx` `onPointerUp` textBoxMove path -> `onCommitTextBoxMove` -> the host re-bakes the box through the engine's `editImage` mask-and-draw contract (white `drawRectangle` over `oldRect`), which erases whatever content was under the box's ORIGINAL rect. This is the same mask-and-draw limitation as DEF-116/124 (mask, don't strip) now surfaced when moving a box over real content â€” content under a moved box's old position is lost from the visible page.
History:
- qa: opened (ground-truth on installed v1.7.10; box placed over the title, moved 120px, title area masked/erased).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Place an Add-box directly over the title "TFlex Technical Report", commit ("MY BOX"), then drag the box 120px right / 120px down. The title REGION of the page-1 canvas keeps dark-fraction 0.2178 BOTH before and after the move (pixel-identical â€” NO white-mask artifact), and the "TFlex Technical Report" span stays in the textLayer; the title is visibly intact. Text boxes are now an engine-side placement registry (addTextBox pushes a `TextBoxModel`, no pdfDoc mutation; moveTextBox updates the rect; drawn ONCE at the FINAL rect at save), so moving a box never masks the content under its old rect. Save + re-parse with pdf-lib: valid 34-page PDF. Screenshot screenshots/def-135-after-move.png. CLOSED.

## DEF-134: Dragging a committed signature, then clicking it, reverts to the previous position

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source).
2. Open report.pdf, click toolbar "Sign tool", Type tab -> type "QA" -> Save -> pick the saved signature.
3. Click the page to place, Confirm to commit (placement rect left 200 / top 200).
4. Drag the committed placement 120px right / 60px down (it renders at left 320 / top 260 â€” the uncommitted move rect).
5. Click the placement again WITHOUT pressing Confirm on the floating action bar.

Expected: The signature keeps the dragged position (the move is applied live); a click should not discard an in-progress move.
Actual: The click reverts the placement back to its PREVIOUS (committed) position â€” left 200 / top 200 â€” and the drag result is lost. The new position is not applied; the user must click Confirm, but any incidental click on the placement discards the move. Screenshots: screenshots/def-135-after-drag.png (moved to 320,260) and screenshots/def-135-after-click.png (reverted to 200,200).
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
3. Scroll to the visible page 2 (the new blank) and confirm the page order is correct: engineState.pageOrder becomes [0,34,1,2,...] â€” the new blank IS page 2. (The page-order claim does NOT reproduce; see note.)
4. Arm the Pen (annotation toolbar "Pen" / data-tool="ink") and draw a stroke on visible page 2; then draw a Rectangle on visible page 3.

Expected: The ink stroke / rectangle appears on the page the user drew on (visible pages 2 and 3).
Actual: No annotation appears on the page that was drawn on. The engine state records 1 annotation (`engineState.annotations.length === 1`), and the stroke actually renders on the LAST visible page (page 35) â€” a pen stroke drawn on visible page 2 lands on visible page 35; a rect drawn on visible page 3 lands on page 2. The user's mark is silently placed at the wrong position in the document. Screenshot: screenshots/def-133-pen-misplaced.png (ink drawn on page 2; appears on page 35).
Root cause: `DocumentView.tsx` renders `<PageView pageNumber={sourcePage} ...>` where `sourcePage = visibleToSourcePage(visiblePage, engineState.pageOrder)` (the pdf.js SOURCE page, origIdx+1). `PageView.tsx` passes `page={pageNumber}` (the source page) to `<AnnotationOverlay>`, which stamps the created annotation's `page = sourcePage`. The engine's `annotations.createAnnotation` (`src/main/services/annotations.ts:246`) treats `payload.page` as the VISIBLE page and computes `origIdx = order[visiblePage - 1]`. After a reorder these differ (visible page 2 -> source page 35 / origIdx 34), so the annotation is stored on the WRONG origIdx and rendered on the wrong visible page.
NOTE: The report's "LAST page gets moved to position 2 and the NEW page lands at position 3" page-order claim is NOT reproduced â€” `pageOrder[1]` === 34 (the new blank), i.e. the blank correctly becomes page 2 and the original last page stays at the end. The defect is the annotation page-number mismatch, which makes drawing tools appear broken on pages 2/3.
History:
- qa: opened (ground-truth on installed v1.7.10; page order correct, but ink on visible page 2 -> page 35, engine annotations = 1).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). Insert blank at position 2 -> pageCount 34->35, pageOrder [0,34,1,2,...], the new blank IS visible page 2, unique 35 (insert-blank regression clean, no duplicate). Arm the Pen and draw a stroke on VISIBLE page 2; arm the Rectangle and draw on VISIBLE page 3: engine annotations = [{kind:ink,page:2},{kind:rect,page:3}] â€” the pen lands on visible page 2 and the rectangle on visible page 3 (was page 35 / page 2). Committed ink is rendered on the visible page-2 slot. Root cause fixed: PageView now threads BOTH `page` (the VISIBLE index, used by every overlay to create content) and `sourcePage` (the pdf.js proxy index, used only by `doc.getPage(sourcePage)` to render), so an overlay no longer stamps the SOURCE page number into the annotation. Screenshot screenshots/def-133-pen-correct-page.png. CLOSED.

## DEF-132: Frameless window cannot be moved by dragging the title bar

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.10)

Steps to reproduce:
1. Launch TFlex (installed v1.7.10 binary = 0dab4cb source). The window is created with `frame: false` (no native title bar).
2. Attempt to move the window by pressing and dragging anywhere on the top title bar (the brand / tab strip / empty caption area).

Expected: The window behaves as a normal draggable Windows window â€” dragging the caption strip moves it (and Aero Snap works at the screen edges).
Actual: The window cannot be moved by dragging the title bar. Sampling the computed `-webkit-app-region` across the title bar yields `draggablePx = 0` and `noDragPx = 60480` â€” every pixel of the 1442x44 title bar resolves to `no-drag`; the full-width `.titlebar-slot` (1264px, flex:1) and the `.app-header` inside it are both `-webkit-app-region: no-drag`. With `frame: false` there is also no native caption area to grab, so the window has no mouse-drag affordance at all. Screenshot: screenshots/def-132-titlebar-region.png.
Root cause: `src/renderer/styles.css` â€” `.titlebar { -webkit-app-region: drag }` (line 312) is defeated by `.titlebar > * { -webkit-app-region: no-drag }` (line 317-319), which applies `no-drag` to the `.titlebar-slot` (the direct child that fills the whole bar width) and `.titlebar-controls`/`.titlebar-menu`. The `.app-header` inside the slot also declares `-webkit-app-region: no-drag` (line 282). Because the slot spans the entire bar (the only free drag surface is the leftover padding, which is zero-width given the slot is `flex: 1 1 auto`), there is effectively no draggable caption region. Combined with `frame: false` (src/main/window.ts:64) there is no native caption either â€” so the window is immovable by mouse.
History:
- qa: opened (ground-truth on installed v1.7.10; region map: titlebar-slot and app-header both no-drag, dragPx=0).
- qa: retested on installed v1.7.11 (FileVersion 1.7.11, exe 05:42 newer than all src). The `.titlebar` computes `-webkit-app-region: drag`; `.titlebar-slot` and `.app-header` both resolve to `drag` (the DEF-132 `.titlebar > * { no-drag }` rule is gone â€” only interactive children opt out via scoped `.titlebar-menu-*` / `.titlebar-control*` / `.app-header button,input,select,textarea` rules). Region map over the 1442x44 bar: dragPx=46836, noDragPx=13644, so 72.7% of the caption strip is draggable (was dragPx=0). The frameless window is now movable by dragging the caption strip. Screenshot screenshots/def-132-titlebar-draggable.png. CLOSED.

## DEF-131: "Per page" crop applies the crop to EVERY page, not just the selected one

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages, every page 612x792 pt).
3. Tools palette -> "Crop pages", switch mode to "Per page".
4. On the page-1 editor drag the SE crop handle inward (shrink the box) â€” summary reads e.g. x 61.2 / y 79.2 / width 285.6 / height 429.6 pt.
5. Click "Apply crop".

Expected: Only page 1 is cropped; pages 2+ keep their full 612x792 box.
Actual: The toast reads `Cropped 1 page.`, but EVERY page renders at the cropped size. Measured `.pdf-page[data-page]` BEFORE crop: pages 1-3 all `1156x1496 px` (`--scale-factor: 1.888`, i.e. full 612x792). AFTER crop: pages 1-3 all `1156x1739 px` (`--scale-factor: 4.047`, i.e. 285.6x429.6). So a per-page crop on page 1 silently cropped the whole document.
Screenshot: screenshots/gt_b11_after_crop.png (before/after page sizes in the run log).

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; per-page crop sent one entry â€” toast "Cropped 1 page." â€” yet all pages render cropped after the post-crop proxy refresh).
- qa: retested on installed v1.7.9 (FileVersion 1.7.9, exe 02:56 newer than all src). Crop page 1 per-page (drag SE inward), Apply -> toast "Cropped 1 page."; after the proxy refresh page 1 renders at aspect 0.7458 (=cropped, deviates from full 0.7727) and is NARROWER than pages 2/3, while pages 2 and 3 stay full-aspect 0.7729 and identical to each other â€” the crop no longer propagates to the other pages. Definite: the post-crop global re-fit scale changes the absolute px of pages 2/3 (the zoom jumps to fit the current page), which is pre-existing fit-to-current-page behaviour, not the crop-propagation bug; the CropBox/TrimBox are NOT copied onto the other leaves (pinned by test/unit/main/def130_131_124.test.ts). Regression checked: save is unaffected, no pageerror. Screenshot screenshots/def-131-after-crop.png. CLOSED.

## DEF-130: Re-inserting a blank page after an undo throws "degreeAngle must be of type number, but was actually of type NaN"

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7)

Steps to reproduce:
1. Launch TFlex (installed v1.7.8 binary = v1.7.7 code).
2. Open report.pdf (34 pages).
3. Tools palette -> "Insert pages", blank mode, "Insert at page" = 2 (blank lands after page 1), Insert.
4. Undo (rail "Undo last change") â€” pageCount returns to 34.
5. Insert a blank page again (same settings).

Expected: The second insert completes cleanly.
Actual: A toast appears: `Could not refresh document proxy: Engine error: getDocumentBytes failed: `degreeAngle` must be of type `number`, but was actually of type `NaN``. The post-insert proxy refresh (`refreshDocProxyFor` -> `engine.getDocumentBytes`) throws.
Screenshot: screenshots/gt_b9_reinsert.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code; the reported error string is reproduced verbatim).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Insert blank after page 1 ("2"), Undo -> pageCount 34, re-insert -> pageCount 35, pageOrder [0,34,1,2,...] with no duplicates, thumbCount 35 (proxy refreshed). NO "degreeAngle ... NaN" toast, NO `degreeAngle`/`NaN` pageerror, no React #310. Root cause fixed: insertBlankPage now snapshots the pdfDoc bytes (snapshotDocWithPdf) so undo reverts the pdfDoc too, plus a finite-guard at the serialize site; pinned by test/unit/main/def130_131_124.test.ts. Screenshot screenshots/def-130-after-reinsert.png. CLOSED.

## DEF-129: Insert-blank page at position 1 is impossible â€” the Insert button is disabled

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
3. Make an edit (e.g. rotate a page â€” toolbar Rotate clockwise) so the tab is modified.
4. Click the tab's close button.
5. In the "Unsaved changes" prompt click "Save".

Expected: The prompt offers Save As (or routes Save to Save As for a bytes-loaded doc) and closes the tab after saving a copy.
Actual: The prompt shows an inline red error `This document has no on-disk path. Use Don't save to discard, or open Save As first.` and stays open â€” the user cannot save their work first.
Screenshot: screenshots/gt_b7_after_save.png

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Open report.pdf sample (bytes-loaded), rotate a page (modified=true), click tab close -> the "Unsaved changes" prompt's Save button reads "Save Asâ€¦" (no inline "no on-disk path" hard-block error). Stubbed the OS save dialog to a temp path and clicked "Save Asâ€¦": the tab saves-and-closes (prompt gone, 0 tabs), and the saved file is a real, re-parseable 34-page PDF (pdf-lib getPageCount=34). Pinned by test/unit/renderer/bugDEF128_closePromptSaveAs.test.tsx. Screenshot screenshots/def-128-prompt-save-as.png. CLOSED.

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
  (a) Dead empty space â€” the bar's computed `top` is 100px, but the real toolbar (44px) + ann-toolbar (40px) bottom is 84px, leaving a ~16px unexplained gap.
  (b) The bar spans `left:0; right:0` (1442px) over the left thumbnail rail (x 0..220) and over the right Tools palette (x 1162..1442).
  (c) It does not reflow the content â€” it is an absolute overlay with `max-height:172px; overflow:hidden`, covering the rail/palette/document.
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

## DEF-124: Edit-text leaves a faint trace of the old run behind â€” the white mask does not cover the full glyph rect

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
Actual: The new text renders with a faint gray trace of the OLD run behind/below it â€” the white mask covers only the pdf.js text-item bbox, not the full painted glyph extents. The page's `.textLayer` still contains the original run string, so the old text remains selectable/searchable in the content stream.
Screenshot: screenshots/gt_b2_clean_zoomed.png (old-run ghost visible behind the new text)

History:
- qa: opened (ground-truth on installed v1.7.8 = v1.7.7 code).
- qa: retested on installed v1.7.9 (exe 02:56 newer than all src). Report.pdf, Edit -> Edit text -> click the "TFlex Technical Report" title run (editor opens pre-filled), replace with "ZZZ REPLACEMENT 987654", Ctrl+Enter. The new text renders in the live textLayer (proxy refreshed) and the screenshot shows NO faint gray trace of the old run behind/below it (subtitle and title area are clean after the mask is widened). The white mask now covers the old run's bbox + symmetric PAD + font ascent above + descent below (mask width > bbox width and mask height > bbox height, verified in the saved content stream); pinned by test/unit/main/def130_131_124.test.ts. NOTE: mask-and-redraw remains the v1 approach (DEF-116 was REJECTED) â€” the old run is still in the content stream, but the visual ghost is gone. Screenshot screenshots/def-124-after-edit.png. CLOSED.

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
Actual: Immediately after the insert (during the post-op pdf.js proxy rebuild / side-rail thumbnail render) the renderer throws `Error: Invalid page request.` from `pdfjs getPage` TWICE. The engine state and rendered result are correct (35 pages, blank at rank 2, pageOrder `[0,34,1,2,...]`, no duplicate pages), and the saved file re-opens as a valid 35-page PDF (document-safety check: save -> reopen -> pageCount 35, unique 35) â€” so this is NOT corruption. The error also does NOT occur on the append (`end`) path; it is specific to inserting a blank page into the MIDDLE of the document (a reorder). Recorded as an unhandled console error in a core user flow; no visible degradation, but the developer should confirm whether it should be caught.

History:
- qa: opened (ground-truth on installed v1.7.7; reproduced while running e2e/retests/release_gate_117_verify.spec.cjs B7; `pageerror` stack points to pdf.js `getPage` from within the renderer bundle during the post-insert proxy refresh).
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). Mid-document insert no longer throws "Invalid page request": e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 (insert blank at position 1 -> order0 [34,0,1,...], unique 35) asserts the pageerror filter "Invalid page request|degreeAngle|NaN" is empty and it PASSED (badErrors=[]); the re-insert path (DEF-130) also stays clean. Root cause fixed: the render paths now tolerate the temporarily-stale page index via `isInvalidPageRequest` (drop the attempt, let the doc-identity swap in `refreshDocProxyFor` re-run the render effect). Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts â€” `isInvalidPageRequest` helper (recognizes the rejection, ignores unrelated failures) + PageView.run/SideRail.Thumb guards import it. Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-after-prepend.png. CLOSED.)

## DEF-122: "Insert at page" hint contradicts actual placement â€” position N inserts AFTER page N, hint says it lands AS page N

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
- qa: closed (retested on installed v1.7.9, exe 02:56 newer than all src). The position value now uses rank semantics â€” the page number the new content BECOMES â€” so the hint and the placement agree, and the off-by-one is gone: e2e e2e/retests/def_123_131_verify_1.7.9.spec.cjs DEF-129 inserted blank at "1" -> blank becomes page 1 (order0 [34,0,1,...], order[0]=34); DEF-130 inserted at "2" -> blank becomes page 2 (order0 [0,34,1,...]). Slot 0 maps to the engine afterIndex -2 PREPEND sentinel (valid in blank mode, no "cannot insert before page 1" guard) and the dialog min is now 1. DEF-114 append sentinel (end/empty -> -1) unchanged. Pinned by test/unit/renderer/defDEF121_122_insertRefreshGuard.test.ts (slot-to-afterIndex translation + dialog min=1). Unit suite green: 187 files / 2369 tests. Screenshot screenshots/def-129-position1.png. CLOSED.)

## DEF-117: Modal dialogs cannot open â€” React #310 (Rules of Hooks) from the B3/B6 backdrop refactor; whole UI unmounts to a black window

- Status: CLOSED
- Severity: HIGH
- Found by: qa
- Phase: 14 (v1.7.7 regression)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45, exe newer than all src).
2. Open report.pdf (34 pages).
3. Click the "Sign" toolbar button (`button[aria-label="Sign tool"]`).

Expected: The Signature manager modal (`.sig-manager`) opens so a signature can be drawn, typed, or a saved one picked and armed for placement.
Actual: The renderer throws `Minified React error #310` ("Rendered more hooks than during the previous render") and the ENTIRE app UI unmounts to a black window (screenshots/def-117-sign-flow-broken.png) â€” no modal, no toolbar, no page. The identical #310 fires when any other modal-opening control is clicked (Export to Word, Insert pages, Crop pages, Recognize text, Save-As, Optimize, Merge, Split, Stamp, Flatten, etc.), so it is not specific to Sign.

Root cause: The B3/B6 fix re-wired every modal backdrop through the shared `useBackdropClose` hook (src/renderer/components/modalBackdrop.ts). In 21 dialogs the hook is called AFTER the component's `if (!open) return null;` early return (e.g. SignatureManagerModal.tsx:72-77, DocxExportDialog.tsx:132-138, CropPagesDialog.tsx:168-174, InsertPagesDialog.tsx:156-162, OcrDialog.tsx:293-297). That violates the Rules of Hooks: when `open` flips falseâ†’true the hook count grows by one (`useRef` inside `useBackdropClose`), so React throws #310. The error is uncaught (no error boundary) and React unmounts the whole root, leaving a black window.

Affected dialogs (21, all with the hook after `if (!open) return null;`): SignatureManagerModal, DocxExportDialog, CropPagesDialog, InsertPagesDialog, OcrDialog, DeletePageDialog, RenumberPagesDialog, ReplacePagesDialog, SaveAsDialog, OptimizeDialog, AuditSpaceDialog, MergeDialog, SplitDialog, ExportDialog, TextExportDialog, CreateFromImagesDialog, StampDialog, CommentExportDialog, CommentImportDialog, CloseTabPromptDialog, FlattenConfirmDialog.

Impact: This blocks the v1.7.7 verification of B1 (sign placement + re-click handles), B3/B6 (DOCX/Crop/Insert dialog stays open on a text-selection drag-out; genuine backdrop click still closes), B4 (OCR suspects panel as a top bar + no overlapping white text after OCR), B7 (insert blank page after page 1 shows exactly 35 thumbnails with no duplicate / stray "Page 17"), B8a (crop mode-switch no flicker) and B8b (per-page crop crops only the adjusted page). None of those flows can be exercised because the modal they live in never mounts. Repro note: B1/B3/B6/B7/B8a/B8b all timeout at `waitForSelector` for their dialog/modal, and each is accompanied by React #310 in `pageerror`.

Screenshot: screenshots/def-117-sign-flow-broken.png (black window after the Sign click; the #310 was captured in the renderer `pageerror`). Same black-window result captured at screenshots/gt-bug10-restored.png vicinity (any dialog open) and temp probes (b4_ocr.png).

History:
- qa: opened (ground-truth reproduction on installed v1.7.7, rebuilt 22:45). Reproduced via the Sign toolbar button, the Tools-palette Sign entry, a direct `window.dispatchEvent(new CustomEvent('tflex:sign-button'))`, and the Export-to-Word tool â€” all yield React #310 and a black-unmounted UI. The `useBackdropClose` hook is placed after `if (!open) return null;` in all 21 dialogs above; before the B3/B6 change these dialogs used a plain non-hook `closeOnBackdrop` (e.g. `git diff` on SignatureManagerModal.tsx shows `useRef` now added after the early return).
- qa: re-verified on installed v1.7.7 (reinstalled 11:24 PM, exe 23:24 newer than all src) via e2e/retests/release_gate_117_verify.spec.cjs (10 tests, all PASS). Source-level check: all 21 dialogs now place `useBackdropClose` BEFORE the `if (!open) return null;` guard (verified by scanning each dialog: hook line < early-return line). Runtime: opened Sign, DOCX, Crop, Insert and OCR dialogs in sequence â€” each mount (`.modal-backdrop` present, app not black) and `pageerror` captures ZERO React #310/#520 hook errors across the whole run. The entire DEF-117-blocked surface is now exercisable and verified: B1 (sign re-click shows select handles), B3/B6 (DOCX + Insert stay open on a text-selection drag-out; a genuine backdrop click still closes), B4 (OCR suspects panel renders as a full-width TOP BAR at z-index 40 above the tools palette 30, y=145, not behind it), B7 (insert blank after page 1 -> 35 pages, no duplicate, blank at rank 2, save+reopen valid), B8a (crop mode/page switch keeps the canvas node stable, no opacity-0 flash, no jump to 612x792), B8b (per-page crop crops only page 1 â€” toast "Cropped 1 page." + page 1 renders smaller than unadjusted pages 2/3), B8c (undo after a page op visually reverts), B10 (maximize/restore icon distinct from minimize). CLOSED.

## DEF-120: Undo (Ctrl+Z) after a page-mutating op does not refresh the pdf.js proxy â€” visual stays stale

- Status: CLOSED
- Severity: MEDIUM
- Found by: qa
- Phase: 14 (v1.7.7 fix)

Steps to reproduce:
1. Launch TFlex (installed v1.7.7, rebuilt 22:45).
2. Open report.pdf.
3. Rotate page 1 via the toolbar "Rotate clockwise" button; confirm the page paints landscape.
4. Press Ctrl+Z.

Expected: The page visually reverts â€” the pdf.js proxy repaints the pre-rotate state (portrait).
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
- qa: re-verified on installed v1.7.7 (rebuilt 22:45). `[data-window-maximize]` now renders `Copy` (two overlapping squares) when maximized â€” `maximized maxLabel= Restore window`, and `minimize svg outerHTML !== maximize svg outerHTML` (`distinct=true`). When restored it renders `Maximize2` with label "Maximize window" and also differs from minimize. Verified programmatically via the titlebar controls and visually. CLOSED.

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

## DEF-116: Edit-text leaves the original run in the PDF â€” old title remains searchable/selectable after the edit

- Status: REJECTED
- Severity: MEDIUM
- Found by: qa
- Phase: 14

Steps to reproduce:
1. Launch TFlex (installed v1.7.6 build).
2. Open report.pdf, click the Edit toggle, then the "Edit text" tool.
3. Click the "TFlex Technical Report" title run so the inline editor opens pre-filled.
4. Replace the text with "ZZZ REPLACEMENT TEXT 123" and press Ctrl+Enter to confirm.

Expected: The edited run is replaced â€” the old "TFlex Technical Report" text is removed from the document, so it is no longer selectable/searchable/copyable and no longer present in the saved file.
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
Actual: Immediately after the mouseup commit the crop editor REMOUNTS â€” the page canvas disappears (opacity flashes to 0) and its CSS size jumps to the full unscaled 612x792 for one frame (a "larger crop window" artifact) before settling to the correct ~360x466. Verified by sampling post-commit frames: frame 0 yields canvasTag=null (new canvas node), canvasOpacity=0, canvasRect 612x792; frame 1+ settle to opacity 1, rect 360x466.
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
Actual: The blank page is inserted as the FIRST page of the visible order. `tflexDiagnostics().engineState.pageOrder` becomes `[34,0,1,2,â€¦,33]` (the newly added blank origIdx 34 at index 0), and the view/rail render a scrambled result (blank page at the front, two blank-looking thumbs, a mislabeled "Page N"). Note the engine page count is correct (34 -> 35); this is NOT a literal two-page duplication, but an incorrect placement that scrambles the document. Inserting with the DEFAULT numeric position ("35") works correctly (pageOrder ends with 34).
Root cause: InsertPagesDialog.tsx maps `end`/empty to `position:-1` ("appended at end"), but onInsertPagesConfirm (App.tsx:3019) passes that value straight to `engine.insertBlankPage(docId, position, â€¦)`; engine `_insertBlankPageImpl` (engine.ts:1215) treats `afterIndex = -1` as "insert before the first page" (`insertAt = 0`). Two different -1 contracts collide.
Screenshot: screenshots/gt-bug7-after.png (also gt-bug7-before.png, gt-bug7-insert-dialog.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Blank mode + position `end`: engineState pageCount 34 -> 35, modified=true, pageOrder=[0,1,...,33,34] â€” first=0 and last=34 (the new origIdx-34 blank page is the FINAL element, not the front). `_insertBlankPageImpl` now maps afterIndex<0 to `doc.order.length` (append). CLOSED.

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
Actual: The editor closes and the engine `modified` flag flips to true, but the new text is NOT rendered â€” the pdf.js textLayer contains no element with "HELLO BOX ADDED 456" and the page canvas still shows the pre-edit content. The edit only becomes visible after a save/reopen (the engine wrote it, the live view is stale).
Root cause: App.tsx `handleAddTextBox` (line 1785) calls `engine.addTextBox` + `noteOpApplied` but never rebuilds the renderer pdf.js `doc` proxy (unlike the OCR path which calls `refreshDocProxyFor` in `onOcrConfirm`). The DocumentView continues to render the pre-edit document.
Screenshot: screenshots/gt-bug5-after-commit.png (also gt-bug5-box-editor-open.png)

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). The proxy IS now rebuilt (handleAddTextBox calls refreshDocProxyFor), so the box text DOES appear in the live canvas â€” but only "HELL" of the committed "HELLO BOX ADDED 456" renders. Committed textarea value was verified as the full "HELLO BOX ADDED 456"; the `.textLayer` after commit contains a single span "HELL" (visible SIZE_BIG, x548,y568,w161,h64) and no span with the full string; the DOM has no element with the full text; engine `annotations=[]`. Reproduced with BOTH a small box (200x214 CSS) and a large box (800x388 CSS) â€” always "HELL". Root cause is now the default font size for a new box, `EditInlineEditor`/`EditOverlay` `size = Math.round(textTarget.rect.height * 0.8)` (capped at SIZE_MAX=72), which is enormous for a box whose height is large; `wrapTextToWidth` hard-breaks "HELLO" -> "HELL"+"O" when "HELLO" exceeds the box width, and the box height only fits that first fragment line, SILENTLY DROPPING the rest of the user's text. Content is lost in the committed box. REMAINS OPEN (severity raised to HIGH â€” committed content silently dropped).
- qa: re-verified on installed v1.7.6 (rebuilt 17:29). Add box in report.pdf, type "HELLO BOX ADDED 456" + Ctrl+Enter: the editor closes (count=0) and the FULL committed text renders live â€” the `.textLayer` contains a single span "HELLO BOX ADDED 456" (boxTextVisibleFull=true, joined=true, truncatedOnly=false; no lone "HELL" fragment). Screenshot screenshots/def-113-after-commit.png shows the full string on the page at a normal legible size. The oversized default box font is gone â€” the box no longer hard-breaks and drops content. CLOSED.

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
Actual: OCR completes and the rebuilt textLayer gains the static content ("JavaScript", "Node.js", "React", "PDF Spec") but NOT the form field values â€” after-OCR textLayer = [ "TFlex Application Form", "TFlex", "Application", "Form", "JavaScript", "Node.js", "React", "PDF", "Spec" ]; `hasJohnDoe=false`; searching "John Doe" returns 0 hits. "John Doe", "Engineering" and "TypeScript" stay unsearchable.
Root cause: src/renderer/pdf/ocrRasterize.ts `rasterizeOnePage` (line 134) renders via `pdfPage.render({ canvasContext, viewport })` with pdf.js defaults (no `renderInteractiveForms`), so interactive AcroForm field-value appearance streams are never painted into the OCR PNG; tesseract therefore never sees "John Doe" and never writes it into the invisible text layer.
Screenshot: screenshots/gt-bug4-form-before-ocr.png, gt-bug4-after-ocr.png, gt-bug4-search-john-doe.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). `window.tflex.engine.getFormFields` returns 8 fields INCLUDING `applicant_name` = "John Doe" (and `department`="Engineering"), and the FormsOverlay renders `[data-form-field="form-0-applicant_name"]` with value "John Doe" â€” so the renderer form state DOES hold the value and OCR seeds it into AnnotationStorage (seedAnnotationStorage) with `annotationMode: AnnotationMode.ENABLE_STORAGE`. Yet after OCR the `.textLayer` is ["TFlex Application Form","TFlex"," ","Application"," ","Form","[]","JavaScript","TypeScript","Node.js","React"] â€” `hasJohnDoe=false`; searching "John Doe" returns 0 hits. The form-field appearance is still NOT baked into the OCR raster. REMAINS OPEN.
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
Actual: The export succeeds but produces a 34-page .docx â€” the extracted word/document.xml has 33 `<w:br w:type="page"/>` breaks (34 pages) and 34 `<w:t>` text runs; the file is byte-identical in size (56376) to the all-pages default export. The page range is ignored.
Root cause: src/main/services/engine.ts `_createDocxFromDocImpl` (line 1461) iterates `for (let vi = 0; vi < doc.order.length; vi++)` over the ENTIRE visible document (all `doc.order` pages), and only consults the passed `entries` to decide text-vs-image per page â€” it never uses `entries` to restrict the page set. The dialog's `runEngineExport` does limit `entries` to the range, but the assembly step re-expands to the whole doc.
Screenshot: screenshots/gt-bug3-docx-dialog.png, gt-bug3-docx-after-export.png

History:
- qa: opened (ground-truth reproduction on installed v1.7.5)
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Exporting page range "1" on report.pdf produces a real .docx (will-download state=completed, 2607 bytes, valid OOXML PK) whose extracted word/document.xml contains 0 `<w:br w:type="page"/>` page-break marks (exactly 1 page) and 0 `<w:t>` text runs (one image) â€” no `inner` error, dialog no error. `_createDocxFromDocImpl` now respects `entries` as the page set. CLOSED.

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

Expected: The editor stays mounted â€” a click on its own chrome is not an outside click. Context windows should only close on an explicit close/Cancel.
Actual: Pressing the "Font" label span closes the editor (`[data-edit-editor]` count -> 0); it is treated as an outside click. The textarea's onBlur fires because focus leaves the textarea to the body (relatedTarget null), the blur guard only bails when the new focus target is inside `.edit-inline-editor`, and a non-focusable label has no focusable target, so it commits/cancels and unmounts.
Root cause: EditInlineEditor.tsx `onTextareaBlur` (line 133) + the toolbar bar's non-focusable labels. There is no text-drag-outside / bar-press guard equivalent to InsertPagesDialog's B17 `backdropDownRef`. (Note: a text highlight-drag that starts inside the textarea and releases OUTSIDE the editor did NOT close it in the same test â€” the bar chrome press is the deterministically-reproducing path.)
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
- qa: re-verified on installed v1.7.6 (exe 1:05 PM, newer than src). Edit the title to "ZZZ REPLACEMENT TEXT 123" + Ctrl+Enter: the editor closes (count 0), `modified` = true, the canvas paints the NEW title, and the live `.textLayer` contains "ZZZ REPLACEMENT TEXT 123" (newVisible=true). `handleEditTextRun` now rebuilds the pdf.js proxy via `refreshDocProxyFor`. CLOSED. (NOTE: the original masked run still remains as hidden text in the PDF/textLayer â€” filed separately as DEF-116.)

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
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). DOCX export completes with no error (dialog status null, no `inner` error, no console/page errors) and produces a real non-empty .docx â€” captured via main-process `will-download`, state `completed`, size 56376 bytes, valid OOXML ZIP (PK magic). CLOSED.

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
- qa: re-verified on installed build v1.7.5 (rebuilt 11:23 AM; SHA matches win-unpacked). Edit-mode click on a text run opens the text editor pre-loaded with that run's text ("TFlex Technical Report"), and the editor is STILL present after a 3s wait â€” it does not auto-close. CLOSED.

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
Actual: The text is stored and the marker is clickable (opens the pre-filled editor), but the text renders as a narrow vertical column (`.ann-note-text` ~48px wide x ~431px tall) â€” one character per line â€” beside the marker rather than as wrapped text in a note container. Violates "text visible inside / icon+text co-located".
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
Actual: The tools activate but clicking the page creates nothing â€” no textbox bar, no editor, no committed annotation, no lingering signature pending state. Verified via isolation: a Text Box single-click creates the bar on a fresh doc, but does NOT after a Sign placement (bar=1 fresh vs bar=0 after sign). Rectangle/Ellipse clicks likewise place nothing.
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
Actual: tag exists but no GitHub Release published â†’ update service sees no newer release.

History:
- qa: opened
- qa: verified v1.7.0 release exists on GitHub with 3 assets (latest.yml, TFlex-Setup-1.7.0.exe, TFlex-Setup-1.7.0.exe.blockmap). Verified latest.yml contains correct version metadata (1.7.0). Verified app at v1.7.0 successfully initializes update service and starts check (status transitions to 'checking'). Fixed release publishing confirmed. CLOSED.
