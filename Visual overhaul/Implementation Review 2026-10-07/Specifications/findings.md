# Findings and corrections

P1 = functional access/state defect or release-critical containment; P2 = visual/interaction refinement. Live means directly observed. Inferences are explicitly marked. Fixes are proposals, not verified changes.

## R01 · P1 · Compact inspector cannot reopen

**Evidence:** Live. At approximately 962×620, the automatic collapsed inspector shows Expand inspector. Repeated activation did not open a panel or drawer after settling. Deliver export settings are consequently inaccessible.

**Correction:** Keep the toggle operable at every supported size. Below the dual-panel threshold, open an inspector drawer over the canvas, with a close control and focus return.

[Live screenshot](../Evidence/Live/compact-inspector-cannot-expand.png) · [Accessibility snapshot](../Evidence/Live/compact-inspector-cannot-expand.txt)

## R02 · P1 · Resize resets export choices

**Evidence:** Live. Selected Word export on scanned.pdf. After shrinking and maximizing, PNG was selected and PNG DPI settings appeared.

**Correction:** Store export drafts by document ID outside responsive panel mount/unmount lifecycle. Preserve format, range, filename, options and validation state. Test shrink/restore and tab transitions.

[Live screenshot](../Evidence/Live/deliver-word-export.png) · [Accessibility snapshot](../Evidence/Live/deliver-word-export.txt)

## R03 · P1 · Application menu escapes viewport

**Evidence:** Live. Home application menu opens against the right edge; its content extends outside the window and has a horizontal scrollbar, including maximized mode.

**Correction:** Use a shared collision-aware overlay positioning system. Flip/shift inside an 8px viewport gutter; wrap long labels and keep shortcuts in a bounded column. Vertical scrolling only.

[Live screenshot](../Evidence/Live/home-menu-overflow.png) · [Accessibility snapshot](../Evidence/Live/home-menu-overflow.txt)

## R04 · P1 · Current page and navigator disagree

**Evidence:** Live. Jumping to page 520 renders page 520 and disables Next, but thumbnail navigator remains at pages 1–6. After tab/view transitions an additional captured state showed inspector/input 520 while visible PDF text said Page 150. Re-entering 520 restored the canvas.

**Correction:** Use one document-scoped navigation model. Reveal the viewed thumbnail after committed navigation and restore the corresponding canvas anchor on tab activation. Keep selection separate from viewed page. Audit rendering/scroll restoration before destructive page actions.

[Live screenshot](../Evidence/Live/page-jump-520-settled.png) · [Accessibility snapshot](../Evidence/Live/page-jump-520-settled.txt)

## R05 · P1 · Home command capability mismatch

**Evidence:** Live. Home retains document-only File items. UIA reported Save/Save As/Close Tab available while toolbar Save was disabled. With documents open behind an Empty Home tab, Save a copy remained enabled. Execution was not attempted.

**Correction:** Derive commands from the active surface, never the last document. Home exposes Open, Create from images, Merge, Preferences, Help/About only as applicable. Document-only commands should be absent from Home menus and toolbar; keyboard handlers must also guard context.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R06 · P2 · Home brand touches native edge

**Evidence:** Live. The titlebar product mark touches the left edge; the larger hero brand itself has padding.

**Correction:** Give the titlebar brand a 16px inset and stable alignment with adjacent menu/open controls. Preserve window dragging and native caption hit regions.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R07 · P2 · Home reserves an empty tab strip

**Evidence:** Live. A white tab row remains when no document tabs exist.

**Correction:** Do not mount or reserve the tab row when there are zero document tabs. When Home is active with documents open, retain their colorful navigable tabs without showing active-document commands.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R08 · P2 · Recent metadata columns move between rows

**Evidence:** Live. File type, Missing status, date and action locations vary with each row. Different badge widths and optional actions change alignment.

**Correction:** Use one shared CSS grid track definition for all rows: icon / minmax(0,1fr) filename / type / status / date / actions. Empty cells retain their tracks. Use tabular date numerals and stable action slots. At compact sizes collapse secondary metadata deliberately.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R09 · P2 · Production Home contains development samples

**Evidence:** Live + user product requirement. Explore Jovrel still renders four bundled sample cards. Some sample recent entries say Missing even though the cards open the sample. Opening samples can recreate broken sample-relative MRU entries.

**Correction:** Remove Explore and sample invitation copy from production Home. Development fixtures may remain behind a development flag. Exclude sample opens from production MRU or use a resolvable fixture identity in development. Preserve real missing-file recovery.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R10 · P2 · Orbit design is too faint

**Evidence:** Live visual + user preference. Thin violet/amber arcs have very little visibility against the gray Home canvas. Pause background motion already has a visible label; movement amplitude and global-setting behavior were not quantitatively tested.

**Correction:** Increase visible arc contrast and occupied area modestly, using logo-derived violet/amber. Slow color drift rather than flashing. Separate Home pause state from global animation preference and honor OS reduced motion; test this explicitly.

[Live screenshot](../Evidence/Live/home-with-documents.png) · [Accessibility snapshot](../Evidence/Live/home-with-documents.txt)

## R11 · P2 · Panel scroll ownership is inconsistent

**Evidence:** Live. Navigator scroll body extends to the bottom of its column; canvas footer starts beside it. Inspector body has different bounds. Native arrowed scrollbar appearance is dated.

**Correction:** Implement the same panel shell: fixed header, min-height:0 scroll body, optional fixed footer. All panel bodies stop at a shared workspace baseline above the canvas footer. Use one theme-aware scrollbar style, preserving keyboard/wheel and forced-colors fallback.

[Live screenshot](../Evidence/Live/page-jump-520-settled.png) · [Accessibility snapshot](../Evidence/Live/page-jump-520-settled.txt)

## R12 · P1 · Enabled controls fade almost away

**Evidence:** Live visual. Settled dock and viewing footer become very faint with the pointer away, even when commands are enabled. Hover restores strong contrast.

**Correction:** Remove parent opacity from enabled labels/icons. Reduce chrome elevation/background if desired, keeping controls readable at rest and with keyboard focus. Measure contrast on composited colors, not token hex values alone.

[Live screenshot](../Evidence/Live/page-jump-520-settled.png) · [Accessibility snapshot](../Evidence/Live/page-jump-520-settled.txt)

## R13 · P2 · More versus Tools has ambiguous intent

**Evidence:** Live. Dock More opens stage commands; Tools opens the global command palette with broad results/recents. Their purpose is not clear from the labels.

**Correction:** More contains stage overflow and Customize dock. Replace Tools with clearly labeled All commands only if the global entry is still necessary; otherwise use the header palette entry. Customize dock opens a dedicated eligible-tool chooser, not the global palette.

## R14 · P2 · Dock eligibility is inconsistent across entry points

**Evidence:** Live, partially already addressed. Dedicated Add tool chooser was already filtered to three eligible available entries. Global Tools palette still exposes unrelated/disabled pin affordances. A persisted Open comic view pin is disabled on PDF fixtures. No pins were changed.

**Correction:** Use a single dockEligible capability predicate for chooser, pin affordance and pin execution. Retain user customization, but hide or clearly explain temporarily unavailable persisted pins. Do not reset saved docks. Provide an explicit Done action in customization mode.

## R15 · P2 · Compact dock is needlessly constrained

**Evidence:** Live. At 962×620 the canvas had substantial spare width, but the dock remained around the narrow fitted paper width, with scroll chevrons. At 640-width icon-only scrolling was understandable.

**Correction:** Size dock against canvas viewport width, independently of paper zoom/width. Prioritize core tools and collapse secondary commands into More before adding a horizontally scrolling tool rail. Menus must never scroll horizontally.

[Live screenshot](../Evidence/Live/deliver-962x620.png) · [Accessibility snapshot](../Evidence/Live/deliver-962x620.txt)

## R16 · P2 · Compact context loses stage meaning

**Evidence:** Live. Compact context changes to a page-number rail even in Deliver, replacing output checks/actions with a truncated stage label.

**Correction:** Use a consistent stage launcher that opens the current context drawer. The compact Pages rail can show page numbers; Edit/Review/Deliver must open their stage content rather than inheriting a generic page list.

[Live screenshot](../Evidence/Live/deliver-962x620.png) · [Accessibility snapshot](../Evidence/Live/deliver-962x620.txt)

## R17 · P2 · Empty CropBox is unrelated to Edit selection

**Evidence:** Live. Entering Edit with Select shows CROPBOX / Box — although no crop workflow is active. Closing the OCR suspects panel returns to it.

**Correction:** Use explicit inspector states: none/page, selected text/image/annotation, crop session, OCR review, export. Show crop geometry only during crop selection, with plain label Crop bounds and units/actions. Default Edit offers selection guidance and relevant page facts.

[Live screenshot](../Evidence/Live/edit-empty-cropbox.png) · [Accessibility snapshot](../Evidence/Live/edit-empty-cropbox.txt)

## R18 · P2 · OCR review lacks hierarchy and workflow

**Evidence:** Live. The noisy scanned fixture produced 3708 low-confidence entries after OCR. Rows are dense words plus tiny confidence bars; word selection did not expose an obvious correction action or word highlight. This is not evidence of an OCR engine accuracy defect.

**Correction:** Polish existing OCR surface with page grouping, readable word/confidence columns, count badge and selected row. Highlight/navigation must use actual available word bounds. Add correction/accept/skip only when backed by supported operations; otherwise label navigation-only accurately. Filters and richer validation can join the pending Forms/Selection work.

[Live screenshot](../Evidence/Live/ocr-suspects-3708.png) · [Accessibility snapshot](../Evidence/Live/ocr-suspects-3708.txt)

## R19 · P2 · OCR suspect list needs a bounded rendering audit

**Evidence:** Live; performance inference. The accessibility tree exposed thousands of suspect rows. This suggests the list may not be virtualized, but no timing or memory benchmark was performed.

**Correction:** Inspect renderer implementation. Use a virtualized list with stable keys and accessible navigation if it currently mounts all rows. Profile 3708 and 10000 entries; do not report a performance fix without measurements.

[Live screenshot](../Evidence/Live/ocr-suspects-3708.png) · [Accessibility snapshot](../Evidence/Live/ocr-suspects-3708.txt)

## R20 · P2 · Review repeats document summaries

**Evidence:** Live, partially already addressed. Left shows annotation list/empty state and right shows selection-specific empty state, which is the correct basic separation. Bates numbering, watermarks and signatures statuses still repeat on both sides.

**Correction:** Keep left for review inventory/navigation and document summary actions; right for the selected annotation properties/thread. Put document-wide stamps/signatures summaries in one place. Do not rebuild both sides as identical lists.

[Live screenshot](../Evidence/Live/review-list-and-inspector.png) · [Accessibility snapshot](../Evidence/Live/review-list-and-inspector.txt)

## R21 · P2 · Export CTA has tiny label and dark icon

**Evidence:** Live visual. Word export button has white label but a dark low-contrast icon and small typography. It is in the scrolling settings body. Actual output was not generated.

**Correction:** Use a 40px minimum height primary action, 13–14px semibold white label and currentColor white icon. Place CTA in a fixed inspector footer, with a concise format/range summary. Validate enabled/disabled contrast and short-height reachability.

[Live screenshot](../Evidence/Live/deliver-word-export.png) · [Accessibility snapshot](../Evidence/Live/deliver-word-export.txt)

## R22 · P2 · Range validation gives the wrong explanation

**Evidence:** Live. Extract/split page input 0,521 on a 520-page fixture disabled Extract, but helper said Enter at least one page.

**Correction:** Distinguish empty, malformed, out-of-bounds and valid states. For this case say Page numbers must be between 1 and 520. Keep typed input intact, link the error to its field and do not run the operation.

## R23 · P2 · Outline target badges are faint

**Evidence:** Live visual. Eight long bookmark titles wrap and navigate correctly, but their page badges are barely visible.

**Correction:** Use readable secondary text for page badges, align the target column, and preserve wrapping/ellipsis behavior and keyboard navigation. Do not replace the functioning tree unnecessarily.

[Live screenshot](../Evidence/Live/outline-eight-bookmarks.png) · [Accessibility snapshot](../Evidence/Live/outline-eight-bookmarks.txt)

## R24 · P2 · Spread page field is ambiguous

**Evidence:** Live + clarification required. Four-page layout rendered pages 7–10 while Current page input still read 7–8. Inspector showed Page 7. Two-page first-page inspector behavior alone is not a defect.

**Correction:** Define focused page separately from visible range. Label jump field Page with one focused number and show Visible 7–10 separately, or make the current field accurately describe the full visible group. Page actions must explicitly state their targets.

[Live screenshot](../Evidence/Live/four-page-range-label.png) · [Accessibility snapshot](../Evidence/Live/four-page-range-label.txt)

## R25 · P2 · Book View restarts at page one

**Evidence:** Live. Entered Book View from report page 7 and it displayed Page 1 of 34, with Previous disabled. Closing returned to page 7.

**Correction:** Seed Book View from the active page/anchor. Returning should retain the reading location reached in Book View. If separate locations are a deliberate requirement, expose that behavior clearly; default recommendation is continuity.

[Live screenshot](../Evidence/Live/book-view-resets-to-page-one.png) · [Accessibility snapshot](../Evidence/Live/book-view-resets-to-page-one.txt)

## R26 · P2 · Typography and empty states are uneven

**Evidence:** Live visual. Panel help and control labels are small and washed out relative to large whitespace. Deliver output-checks explanatory paragraph occupies valuable compact space.

**Correction:** Use shared type tokens: panel titles 16, body 14, controls 13, helper 12 DIP. Shorten preflight prose to user-facing status; keep implementation explanations in help. Disabled states and empty states must remain distinguishable.

[Live screenshot](../Evidence/Live/review-list-and-inspector.png) · [Accessibility snapshot](../Evidence/Live/review-list-and-inspector.txt)

## What already works

Vivid active document colors are present. Real recent-file type badges are accurate in this build. Home action rows wrap and recent content becomes one column at narrow sizes. Fit page renders the document at compact and full widths. Outline bookmark navigation works, and Next disables at page 520. Extract/split rejects an invalid range and Escape dismisses its dialog. The dedicated dock Add chooser already filters available tools. Expanded panels restore when sufficient width returns. Preserve these behaviors while fixing the failures.
